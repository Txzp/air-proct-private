const { Events, ChannelType, PermissionFlagsBits: P } = require('discord.js');
const cfg = require('../config');
const store = require('../store');
const { isTrusted } = require('../trust');
const { log } = require('../logger');

const S = cfg.antiSpam;
const tracker = new Map(); // userId -> [{ t, id, channelId }]
const webhookTracker = new Map(); // webhookId -> [{ t, id }]
const INVITE_RE = /(discord\.gg|discord(app)?\.com\/invite|dsc\.gg)\/[\w-]+/i;

function fmt(ms) {
  return ms >= 60_000 ? `${ms / 60_000} min` : `${ms / 1000} s`;
}

async function deleteMessages(guild, items) {
  const byChannel = new Map();
  for (const it of items) {
    if (!byChannel.has(it.channelId)) byChannel.set(it.channelId, []);
    byChannel.get(it.channelId).push(it.id);
  }
  for (const [chId, ids] of byChannel) {
    const ch = guild.channels.cache.get(chId);
    if (!ch?.isTextBased()) continue;
    await ch.bulkDelete(ids, true).catch(() => {});
  }
}

async function strike(member, reason, items = []) {
  const guild = member.guild;
  const now = Date.now();
  const rec = store.data.strikes[member.id] || { count: 0, last: 0 };
  if (now - rec.last > S.strikeResetMs) rec.count = 0;
  rec.count += 1;
  rec.last = now;
  store.data.strikes[member.id] = rec;
  store.save();

  const final = rec.count > S.freeStrikes;
  const duration = final ? S.finalTimeoutMs : S.strikeTimeoutMs;
  const label = final ? 'Sanción final' : `Oportunidad ${rec.count}/${S.freeStrikes}`;

  // Borra los mensajes del spam en paralelo con el silencio
  const [res] = await Promise.allSettled([
    member.timeout(duration, `AirProtect: ${reason} (${label})`),
    deleteMessages(guild, items),
  ]);

  log(final ? 'danger' : 'spam', `Spam detectado — ${label}`, `${member} (\`${member.user.tag}\`) fue silenciado **${fmt(duration)}**.`, [
    { name: 'Motivo', value: reason, inline: true },
    { name: 'Veces', value: String(rec.count), inline: true },
    { name: 'ID', value: member.id, inline: true },
    ...(res.status === 'rejected' ? [{ name: '❗ No se pudo silenciar', value: res.reason?.message || 'Error' }] : []),
  ]);

  member
    .send(
      final
        ? `🔇 **AirProtect:** volviste a hacer spam en **${guild.name}**. Ya usaste tus ${S.freeStrikes} oportunidades, silenciado **5 minutos**.`
        : `🔇 **AirProtect:** spam detectado en **${guild.name}**. Silenciado **60 segundos** (oportunidad ${rec.count}/${S.freeStrikes}).`
    )
    .catch(() => {});
}

async function handleWebhook(message) {
  const now = Date.now();
  const arr = (webhookTracker.get(message.webhookId) || []).filter((x) => now - x.t < S.webhookWindowMs);
  arr.push({ t: now, id: message.id, channelId: message.channelId });
  webhookTracker.set(message.webhookId, arr);
  if (arr.length < S.webhookMessages) return;
  webhookTracker.delete(message.webhookId);

  const hooks = await message.guild.fetchWebhooks().catch(() => null);
  const hook = hooks?.get(message.webhookId);
  if (hook && isTrusted(message.guild, hook.owner?.id)) return;
  await Promise.allSettled([hook?.delete('AirProtect: spam por webhook'), deleteMessages(message.guild, arr)]);
  log('danger', 'Webhook de spam eliminado', `Un webhook mandó ${arr.length} mensajes en ${S.webhookWindowMs / 1000}s en <#${message.channelId}> y fue borrado.`, [
    { name: 'Webhook', value: `${hook?.name || 'desconocido'} (\`${message.webhookId}\`)` },
    { name: 'Creado por', value: hook?.owner ? `<@${hook.owner.id}>` : 'desconocido' },
  ]);
}

/* ---------- Honeypot ---------- */
let honeypotId = cfg.honeypot.channelId;

async function ensureHoneypot(guild) {
  let ch = honeypotId && (await guild.channels.fetch(honeypotId).catch(() => null));
  if (!ch) ch = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === cfg.honeypot.channelName);
  if (!ch) {
    ch = await guild.channels
      .create({
        name: cfg.honeypot.channelName,
        type: ChannelType.GuildText,
        position: 0,
        topic: '⚠️ NO escribas aquí. Canal trampa de AirProtect: cualquier mensaje = silencio de 5 minutos.',
        permissionOverwrites: [{ id: guild.id, allow: [P.ViewChannel, P.SendMessages] }],
        reason: 'AirProtect: canal honeypot',
      })
      .catch((e) => (console.error('[honeypot] No pude crear el canal:', e.message), null));
    if (ch) {
      await ch
        .send('🚫 **No escribas en este canal.**\nEs una trampa para bots y cuentas de spam: cualquier mensaje aquí = **silencio de 5 minutos**.')
        .catch(() => {});
      log('info', 'Honeypot creado', `Canal trampa: ${ch}`);
    }
  }
  if (ch) honeypotId = ch.id;
}

async function honeypotHit(message) {
  const member = message.member;
  await message.delete().catch(() => {});
  const ok = await member
    ?.timeout(cfg.honeypot.timeoutMs, 'AirProtect: escribió en el canal honeypot')
    .then(() => true)
    .catch(() => false);
  log('danger', 'Honeypot activado', `${member ?? message.author} (\`${message.author.tag}\`) escribió en el canal trampa${ok ? ' y fue silenciado **5 minutos**.' : ', pero no pude silenciarlo.'}`, [
    { name: 'Mensaje', value: (message.content || '[sin texto]').slice(0, 500) },
    { name: 'ID', value: message.author.id, inline: true },
  ]);
  member?.send(`🚫 **AirProtect:** escribiste en el canal trampa de **${message.guild.name}**. Silenciado 5 minutos.`).catch(() => {});
}

async function onMessage(message) {
  if (!message.guild || message.guild.id !== cfg.guildId) return;
  if (message.webhookId) return handleWebhook(message);
  if (message.author.id === message.client.user.id) return;
  if (isTrusted(message.guild, message.author.id)) return;
  const member = message.member;
  if (!member) return;
  if (message.channelId === honeypotId) return honeypotHit(message);

  const now = Date.now();

  // Menciones masivas
  const mentions = message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 5 : 0);
  if (mentions >= S.maxMentions) {
    return strike(member, `Menciones masivas (${mentions})`, [{ id: message.id, channelId: message.channelId }]);
  }

  // Invitaciones a otros servers
  if (S.antiInvite && INVITE_RE.test(message.content || '')) {
    await message.delete().catch(() => {});
    log('warn', 'Invitación borrada', `${member} intentó mandar una invitación en <#${message.channelId}>.`, [
      { name: 'Mensaje', value: (message.content || '').slice(0, 500) },
    ]);
  }

  // 10 mensajes seguidos dentro de la ventana
  const arr = (tracker.get(member.id) || []).filter((x) => now - x.t < S.windowMs);
  arr.push({ t: now, id: message.id, channelId: message.channelId });
  tracker.set(member.id, arr);
  if (arr.length >= S.messages) {
    tracker.delete(member.id);
    await strike(member, `${arr.length} mensajes en ${S.windowMs / 1000}s`, arr);
  }
}

function init(client) {
  client.on(Events.MessageCreate, (m) => onMessage(m).catch((e) => console.error('[antispam]', e)));
  // Limpieza de memoria
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of tracker) if (!v.length || now - v[v.length - 1].t > S.windowMs) tracker.delete(k);
    for (const [k, v] of webhookTracker) if (!v.length || now - v[v.length - 1].t > S.webhookWindowMs) webhookTracker.delete(k);
  }, 60_000).unref();
}

module.exports = { init, ensureHoneypot };
