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

/* ---------- Raid spam ---------- */
const inviteWarns = new Map();
const DAY = 24 * 60 * 60_000;

function preview(content) {
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  const uniq = [...new Set(lines)];
  const shown = uniq.slice(0, 3).join('\n').slice(0, 400);
  return lines.length > 3 ? `${shown}\n… (${lines.length} líneas)` : shown || '[sin texto]';
}

function isRaidSpam(content) {
  if (content.length < 200) return false;
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  const counts = new Map();
  for (const l of lines) counts.set(l, (counts.get(l) || 0) + 1);
  const maxRepeat = Math.max(0, ...counts.values());
  const headings = lines.filter((l) => /^#{1,3}\s/.test(l)).length;
  return maxRepeat >= 6 || headings >= 6 || (content.length >= 1500 && counts.size <= 3);
}

async function raidSpamHit(message, hasInvite) {
  const member = message.member;
  const ageDays = (Date.now() - message.author.createdTimestamp) / DAY;
  const items = (tracker.get(member.id) || []).concat({ id: message.id, channelId: message.channelId });
  tracker.delete(member.id);
  await deleteMessages(message.guild, items);
  await message.delete().catch(() => {});

  // Cuenta nueva = cuenta de raid → fuera. Cuenta normal → silencio 5 min.
  let action;
  if (ageDays < 7 && member.kickable) {
    await member.send(`🛡️ **AirProtect:** fuiste expulsado de **${message.guild.name}** por mensaje de raid.`).catch(() => {});
    action = (await member.kick('AirProtect: mensaje de raid (cuenta nueva)').then(() => true).catch(() => false))
      ? '👢 Expulsado (cuenta nueva)'
      : '❗ No se pudo expulsar';
  } else {
    action = (await member.timeout(S.finalTimeoutMs, 'AirProtect: mensaje de raid').then(() => true).catch(() => false))
      ? '🔇 Silenciado 5 minutos'
      : '❗ No se pudo silenciar';
  }

  log('danger', 'Intento de raid bloqueado', `${member} (\`${message.author.tag}\`) mandó un muro de spam${hasInvite ? ' con invitación' : ''} en <#${message.channelId}>.`, [
    { name: 'Acción', value: action, inline: true },
    { name: 'Edad de la cuenta', value: `${ageDays.toFixed(1)} días`, inline: true },
    { name: 'ID', value: member.id, inline: true },
    { name: 'Vista previa', value: preview(message.content || '') },
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

  const content = message.content || '';
  const hasInvite = S.antiInvite && INVITE_RE.test(content);

  // Mensajes de raid: muro de texto repetido / títulos gigantes (con o sin invite)
  if (isRaidSpam(content)) return raidSpamHit(message, hasInvite);

  // Invitaciones a otros servers: 1ª vez aviso, si repite en 30 min cuenta como oportunidad
  if (hasInvite) {
    await message.delete().catch(() => {});
    const now = Date.now();
    const prev = inviteWarns.get(member.id) || 0;
    inviteWarns.set(member.id, now);
    if (now - prev < 30 * 60_000) {
      return strike(member, 'Invitaciones repetidas', []);
    }
    log('warn', 'Invitación borrada', `${member} intentó mandar una invitación en <#${message.channelId}>. (Si repite → silencio)`, [
      { name: 'Mensaje', value: preview(content) },
    ]);
    message.channel
      .send({ content: `${member} no se permiten invitaciones de otros servers 🛡️`, allowedMentions: { users: [member.id] } })
      .then((m) => setTimeout(() => m.delete().catch(() => {}), 8000))
      .catch(() => {});
    return;
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
