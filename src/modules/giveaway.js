const {
  Events,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');
require('./welcome'); // registra las fuentes (Poppins + emojis)
const cfg = require('../config');
const store = require('../store');
const { isTrusted } = require('../trust');
const { isStaff } = require('./tickets');

const FONT = 'Poppins, DejaVu, Emoji, sans-serif';
const GOLD = 0xf5c542;
const MAX_MS = 30 * 24 * 60 * 60_000;

if (!store.data.giveaways) store.data.giveaways = {};
const G = () => store.data.giveaways;

/* ---------- Utilidades ---------- */
function parseDuration(text) {
  const s = text.toLowerCase().replace(/\s+/g, '');
  const units = { s: 1e3, seg: 1e3, segundo: 1e3, segundos: 1e3, m: 6e4, min: 6e4, minuto: 6e4, minutos: 6e4, h: 36e5, hr: 36e5, hora: 36e5, horas: 36e5, d: 864e5, dia: 864e5, dias: 864e5, día: 864e5, días: 864e5, w: 6048e5, semana: 6048e5, semanas: 6048e5 };
  let total = 0;
  const re = /(\d+(?:\.\d+)?)([a-zñáéíóú]+)/g;
  let m;
  let matched = '';
  while ((m = re.exec(s))) {
    const u = units[m[2]];
    if (!u) return null;
    total += parseFloat(m[1]) * u;
    matched += m[0];
  }
  if (matched !== s) {
    if (/^\d+$/.test(s)) return parseInt(s, 10) * 6e4; // solo número = minutos
    return null;
  }
  return total || null;
}

function fmtDuration(ms) {
  const d = Math.floor(ms / 864e5);
  const h = Math.floor((ms % 864e5) / 36e5);
  const m = Math.floor((ms % 36e5) / 6e4);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ') || `${Math.round(ms / 1000)}s`;
}

const canManage = (member) => isTrusted(member.guild, member.id) || isStaff(member);

function sample(arr, n) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

/* ---------- Banner ---------- */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx, text, max, start, min) {
  let size = start;
  ctx.font = `${size}px ${FONT}`;
  while (ctx.measureText(text).width > max && size > min) {
    size -= 2;
    ctx.font = `${size}px ${FONT}`;
  }
  if (ctx.measureText(text).width > max) {
    while (text.length > 3 && ctx.measureText(text + '…').width > max) text = text.slice(0, -1);
    text += '…';
  }
  return text;
}

function renderBanner(gw, ended = false, winnerNames = []) {
  const W = 1000;
  const H = 340;
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  roundRect(ctx, 0, 0, W, H, 26);
  ctx.clip();

  // Fondo
  const bg = ctx.createLinearGradient(0, 0, W, H);
  if (ended) {
    bg.addColorStop(0, '#1b2a1f');
    bg.addColorStop(1, '#0d1410');
  } else {
    bg.addColorStop(0, '#2a1446');
    bg.addColorStop(0.55, '#1a0f2e');
    bg.addColorStop(1, '#3b1530');
  }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Brillos de fondo
  const glow = (x, y, r, color) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  glow(140, 60, 320, ended ? 'rgba(87,242,135,0.25)' : 'rgba(255,115,250,0.28)');
  glow(880, 300, 360, ended ? 'rgba(245,197,66,0.18)' : 'rgba(245,197,66,0.22)');

  // Confeti
  const colors = ['#f5c542', '#ff73fa', '#57f287', '#5865f2', '#ffffff', '#ff8a65'];
  for (let i = 0; i < 70; i++) {
    ctx.save();
    ctx.translate(Math.random() * W, Math.random() * H);
    ctx.rotate(Math.random() * Math.PI);
    ctx.globalAlpha = Math.random() * 0.55 + 0.25;
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(-5, -2, 10 + Math.random() * 8, 4);
    ctx.restore();
  }

  // Regalo
  ctx.font = `120px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ended ? '🏆' : '🎁', 140, 175);

  // Badge
  ctx.textAlign = 'left';
  ctx.font = `22px ${FONT}`;
  const badge = ended ? '✅  GIVEAWAY TERMINADO' : '🎉  GIVEAWAY';
  const bw = ctx.measureText(badge).width + 40;
  roundRect(ctx, 260, 52, bw, 42, 21);
  ctx.fillStyle = ended ? 'rgba(87,242,135,0.18)' : 'rgba(245,197,66,0.18)';
  ctx.fill();
  ctx.strokeStyle = ended ? 'rgba(87,242,135,0.7)' : 'rgba(245,197,66,0.75)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = ended ? '#7dffa6' : '#ffd866';
  ctx.fillText(badge, 280, 74);

  // Título
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 14;
  ctx.fillStyle = '#ffffff';
  const title = fitText(ctx, gw.title, W - 300, 62, 30);
  ctx.fillText(title, 260, 150);

  // Línea inferior
  ctx.shadowBlur = 8;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  let sub;
  if (ended) sub = winnerNames.length ? `Ganador${winnerNames.length > 1 ? 'es' : ''}: ${winnerNames.join(', ')}` : 'Sin ganadores';
  else sub = gw.winners === 'random' ? '🎲 Ganador sorpresa del server' : `🏆 ${gw.winners} ganador${gw.winners > 1 ? 'es' : ''}`;
  ctx.fillText(fitText(ctx, sub, W - 300, 30, 18), 260, 215);

  ctx.shadowBlur = 0;
  ctx.font = `20px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText(`${cfg.welcome.serverName} • AirProtect`, 260, 275);

  return c.encode('png');
}

/* ---------- Mensaje ---------- */
function buildEmbed(gw, msgId) {
  const winnersText = gw.winners === 'random' ? '🎲 Sorpresa (alguien random del server)' : `**${gw.winners}**`;
  const e = new EmbedBuilder()
    .setColor(gw.ended ? 0x57f287 : GOLD)
    .setAuthor({ name: gw.ended ? 'GIVEAWAY TERMINADO' : 'GIVEAWAY ACTIVO' })
    .setTitle(`🎉 ${gw.title}`)
    .setImage('attachment://giveaway.png')
    .setFooter({ text: `${gw.winners === 'random' ? 'random' : `${gw.winners} ganadores`} • ID ${msgId || '—'}` })
    .setTimestamp(gw.endsAt);
  const desc = gw.desc ? `>>> ${gw.desc}\n\n` : '';
  if (!gw.ended) {
    e.setDescription(
      `${desc}⏰ **Termina:** <t:${Math.floor(gw.endsAt / 1000)}:R> (<t:${Math.floor(gw.endsAt / 1000)}:f>)\n` +
        `👑 **Host:** <@${gw.hostId}>\n` +
        `🏆 **Ganadores:** ${winnersText}\n` +
        `👥 **Participantes:** **${gw.entrants.length}**\n\n` +
        (gw.winners === 'random' ? '*El ganador sale de todo el server, participes o no 👀*' : '*Dale al botón de abajo para participar* 👇')
    );
  } else {
    const w = gw.winnerIds.length ? gw.winnerIds.map((id) => `<@${id}>`).join(', ') : 'Nadie 😭';
    e.setDescription(
      `${desc}🏆 **Ganador${gw.winnerIds.length > 1 ? 'es' : ''}:** ${w}\n` +
        `👑 **Host:** <@${gw.hostId}>\n` +
        `👥 **Participantes:** **${gw.entrants.length}**\n` +
        `⏰ **Terminó:** <t:${Math.floor(gw.endsAt / 1000)}:R>`
    );
  }
  return e;
}

function buildRow(gw) {
  if (gw.ended) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('gw_done').setLabel(`Terminado · ${gw.entrants.length}`).setEmoji('🎉').setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId('gw_list').setLabel('Participantes').setEmoji('👥').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('gw_reroll').setLabel('Reroll').setEmoji('🔁').setStyle(ButtonStyle.Primary)
    );
  }
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('gw_join').setLabel(`Participar · ${gw.entrants.length}`).setEmoji('🎉').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('gw_list').setLabel('Participantes').setEmoji('👥').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('gw_end').setLabel('Terminar').setEmoji('⏹️').setStyle(ButtonStyle.Danger)
  );
}

/* ---------- Ediciones con debounce (muchos clicks seguidos) ---------- */
const pendingEdit = new Map();
function scheduleEdit(client, msgId) {
  if (pendingEdit.has(msgId)) return;
  pendingEdit.set(
    msgId,
    setTimeout(async () => {
      pendingEdit.delete(msgId);
      const gw = G()[msgId];
      if (!gw || gw.ended) return;
      const ch = await client.channels.fetch(gw.channelId).catch(() => null);
      const msg = await ch?.messages.fetch(msgId).catch(() => null);
      await msg?.edit({ embeds: [buildEmbed(gw, msgId)], components: [buildRow(gw)] }).catch(() => {});
    }, 2500)
  );
}

/* ---------- Terminar ---------- */
async function pickWinners(guild, gw) {
  if (gw.winners === 'random') {
    const pool = guild.members.cache.filter((m) => !m.user.bot).map((m) => m.id);
    return sample(pool, 1);
  }
  return sample(gw.entrants, Math.min(gw.winners, gw.entrants.length));
}

async function finish(client, msgId, { reroll = false } = {}) {
  const gw = G()[msgId];
  if (!gw) return;
  if (gw.ending) return;
  gw.ending = true;
  try {
    const guild = client.guilds.cache.get(cfg.guildId);
    const ch = await client.channels.fetch(gw.channelId).catch(() => null);
    const msg = await ch?.messages.fetch(msgId).catch(() => null);

    gw.winnerIds = await pickWinners(guild, gw);
    if (!reroll) gw.endsAt = Math.min(gw.endsAt, Date.now());
    gw.ended = true;
    store.save();

    const names = await Promise.all(gw.winnerIds.map(async (id) => (await guild.members.fetch(id).catch(() => null))?.displayName || 'alguien'));
    const png = await renderBanner(gw, true, names);
    if (msg) {
      await msg
        .edit({ embeds: [buildEmbed(gw, msgId)], components: [buildRow(gw)], files: [new AttachmentBuilder(png, { name: 'giveaway.png' })], attachments: [] })
        .catch((e) => console.error('[giveaway] edit', e.message));
    }

    const mentions = gw.winnerIds.map((id) => `<@${id}>`).join(', ');
    const announce = new EmbedBuilder()
      .setColor(gw.winnerIds.length ? 0x57f287 : 0xed4245)
      .setDescription(
        gw.winnerIds.length
          ? `🎊 ${reroll ? '**Reroll!** ' : ''}Felicidades ${mentions}, ${gw.winnerIds.length > 1 ? 'ganaron' : 'ganaste'} **${gw.title}**!\n` +
              (gw.winners === 'random' ? '🎲 *Elegido al azar de todo el server*\n' : '') +
              `Habla con <@${gw.hostId}> para reclamar tu premio 🏆`
          : `😭 Nadie participó en **${gw.title}**, no hay ganador.`
      );
    if (ch) {
      await (msg
        ? msg.reply({ content: mentions || undefined, embeds: [announce], allowedMentions: { users: gw.winnerIds } })
        : ch.send({ content: mentions || undefined, embeds: [announce], allowedMentions: { users: gw.winnerIds } })
      ).catch(() => {});
    }

    const link = msg?.url || `https://discord.com/channels/${cfg.guildId}/${gw.channelId}/${msgId}`;
    // DM al host
    const host = await client.users.fetch(gw.hostId).catch(() => null);
    await host
      ?.send({
        embeds: [
          new EmbedBuilder()
            .setColor(GOLD)
            .setTitle(`🎉 Tu giveaway ${reroll ? 'tuvo reroll' : 'terminó'}`)
            .setDescription(
              `**${gw.title}** en **${guild.name}**\n\n` +
                `🏆 **Ganador${gw.winnerIds.length > 1 ? 'es' : ''}:** ${gw.winnerIds.length ? gw.winnerIds.map((id) => `<@${id}>`).join(', ') : 'nadie'}\n` +
                `👥 **Participantes:** ${gw.entrants.length}\n\n[Ver giveaway](${link})`
            )
            .setTimestamp(),
        ],
      })
      .catch(() => {});
    // DM a los ganadores
    for (const id of gw.winnerIds) {
      const u = await client.users.fetch(id).catch(() => null);
      await u
        ?.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle('🎊 ¡Ganaste un giveaway!')
              .setDescription(`Ganaste **${gw.title}** en **${guild.name}** 🏆\nHabla con <@${gw.hostId}> para reclamarlo.\n\n[Ver giveaway](${link})`)
              .setTimestamp(),
          ],
        })
        .catch(() => {});
    }
  } finally {
    gw.ending = false;
    store.save();
  }
}

/* ---------- Comando /pcreate ---------- */
const defs = [new SlashCommandBuilder().setName('pcreate').setDescription('Crear un giveaway 🎉').toJSON()];
const names = ['pcreate'];

async function handle(i) {
  if (!canManage(i.member)) return i.reply({ content: '❌ Solo roles altos pueden crear giveaways.', flags: MessageFlags.Ephemeral });
  const modal = new ModalBuilder()
    .setCustomId('gw_create')
    .setTitle('🎉 Crear giveaway')
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Título / Premio').setPlaceholder('Ej: Nitro Boost 1 mes').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('winners').setLabel('Ganadores (número o "random")').setPlaceholder('1, 2, 3... o random').setStyle(TextInputStyle.Short).setRequired(true).setValue('1').setMaxLength(6)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('duration').setLabel('Duración').setPlaceholder('Ej: 10m, 1h, 2d, 1h30m').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desc').setLabel('Descripción (opcional)').setPlaceholder('Requisitos, detalles del premio...').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(800))
    );
  await i.showModal(modal);
}

async function onCreate(i) {
  const title = i.fields.getTextInputValue('title').trim();
  const wRaw = i.fields.getTextInputValue('winners').trim().toLowerCase();
  const durRaw = i.fields.getTextInputValue('duration').trim();
  const desc = (i.fields.getTextInputValue('desc') || '').trim();

  let winners;
  if (['random', 'rand', 'aleatorio', 'r'].includes(wRaw)) winners = 'random';
  else {
    winners = parseInt(wRaw, 10);
    if (!winners || winners < 1 || winners > 20) return i.reply({ content: '❌ Ganadores debe ser un número del 1 al 20 o `random`.', flags: MessageFlags.Ephemeral });
  }
  const ms = parseDuration(durRaw);
  if (!ms || ms < 10_000 || ms > MAX_MS) return i.reply({ content: '❌ Duración inválida. Usa algo como `30s`, `10m`, `1h`, `2d` o `1h30m` (máx. 30 días).', flags: MessageFlags.Ephemeral });

  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const gw = { channelId: i.channelId, title, desc, winners, endsAt: Date.now() + ms, hostId: i.user.id, entrants: [], ended: false, winnerIds: [] };
  const png = await renderBanner(gw);
  const msg = await i.channel.send({
    embeds: [buildEmbed(gw)],
    components: [buildRow(gw)],
    files: [new AttachmentBuilder(png, { name: 'giveaway.png' })],
  });
  G()[msg.id] = gw;
  store.save();
  await msg.edit({ embeds: [buildEmbed(gw, msg.id)] }).catch(() => {});
  await i.editReply(`✅ Giveaway creado: ${msg.url}\nDura **${fmtDuration(ms)}** • Ganadores: **${winners === 'random' ? 'random' : winners}**`);
}

/* ---------- Botones ---------- */
async function onButton(i) {
  const id = i.customId;
  const gwId = id.startsWith('gw_leave:') ? id.split(':')[1] : i.message.id;
  const gw = G()[gwId];
  if (!gw) return i.reply({ content: '❌ Este giveaway ya no existe (el bot se reinició o se borró).', flags: MessageFlags.Ephemeral });

  if (id === 'gw_join') {
    if (gw.ended) return i.reply({ content: 'Este giveaway ya terminó 😭', flags: MessageFlags.Ephemeral });
    if (gw.entrants.includes(i.user.id)) {
      return i.reply({
        content: '🎉 Ya estás participando. ¿Quieres salirte?',
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`gw_leave:${gwId}`).setLabel('Salir del giveaway').setStyle(ButtonStyle.Danger))],
        flags: MessageFlags.Ephemeral,
      });
    }
    gw.entrants.push(i.user.id);
    store.save();
    scheduleEdit(i.client, gwId);
    return i.reply({ content: `✅ ¡Estás dentro de **${gw.title}**! Suerte 🍀 (participantes: ${gw.entrants.length})`, flags: MessageFlags.Ephemeral });
  }

  if (id.startsWith('gw_leave:')) {
    if (gw.ended) return i.update({ content: 'El giveaway ya terminó.', components: [] });
    gw.entrants = gw.entrants.filter((u) => u !== i.user.id);
    store.save();
    scheduleEdit(i.client, gwId);
    return i.update({ content: '👋 Saliste del giveaway.', components: [] });
  }

  if (id === 'gw_list') {
    const list = gw.entrants.slice(-60).map((u) => `<@${u}>`).join(' ');
    return i.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(GOLD)
          .setTitle(`👥 Participantes (${gw.entrants.length})`)
          .setDescription(list ? `${list}${gw.entrants.length > 60 ? `\n…y ${gw.entrants.length - 60} más` : ''}` : 'Nadie todavía 😭'),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (id === 'gw_end' || id === 'gw_reroll') {
    if (i.user.id !== gw.hostId && !canManage(i.member)) return i.reply({ content: '❌ Solo el host o el staff.', flags: MessageFlags.Ephemeral });
    if (id === 'gw_end' && gw.ended) return i.reply({ content: 'Ya terminó.', flags: MessageFlags.Ephemeral });
    await i.reply({ content: id === 'gw_end' ? '⏹️ Terminando giveaway...' : '🔁 Haciendo reroll...', flags: MessageFlags.Ephemeral });
    await finish(i.client, gwId, { reroll: id === 'gw_reroll' });
    return i.editReply('✅ Listo.').catch(() => {});
  }
}

/* ---------- Recuperar giveaways tras un redeploy (Render borra el disco) ---------- */
async function recover(guild) {
  let n = 0;
  for (const ch of guild.channels.cache.values()) {
    if (!ch.isTextBased?.() || ch.isThread?.() || !ch.viewable) continue;
    const msgs = await ch.messages.fetch({ limit: 30 }).catch(() => null);
    if (!msgs) continue;
    for (const m of msgs.values()) {
      if (m.author.id !== guild.client.user.id || G()[m.id]) continue;
      const join = m.components[0]?.components?.find((c) => c.customId === 'gw_join');
      const e = m.embeds[0];
      if (!join || !e?.timestamp) continue;
      const footer = e.footer?.text || '';
      const d = e.description || '';
      G()[m.id] = {
        channelId: ch.id,
        title: (e.title || 'Giveaway').replace(/^🎉\s*/, ''),
        desc: d.startsWith('>>> ') ? d.slice(4).split('\n\n⏰')[0] : '',
        winners: footer.startsWith('random') ? 'random' : parseInt(footer, 10) || 1,
        endsAt: Date.parse(e.timestamp),
        hostId: d.match(/Host:\*\* <@!?(\d+)>/)?.[1] || guild.ownerId,
        entrants: [],
        ended: false,
        winnerIds: [],
        recovered: true,
      };
      n++;
    }
  }
  if (n) {
    store.save();
    console.log(`[giveaway] Recuperados ${n} giveaways activos (participantes reiniciados)`);
  }
}

/* ---------- Init ---------- */
function init(client) {
  client.on(Events.InteractionCreate, (i) => {
    if (i.guildId !== cfg.guildId) return;
    const run = async () => {
      if (i.isModalSubmit() && i.customId === 'gw_create') return onCreate(i);
      if (i.isButton() && i.customId.startsWith('gw_')) return onButton(i);
    };
    run().catch((e) => {
      console.error('[giveaway]', e);
      const m = { content: `❌ Error: ${e.message}`, flags: MessageFlags.Ephemeral };
      if (i.deferred) i.editReply(m).catch(() => {});
      else if (!i.replied) i.reply(m).catch(() => {});
    });
  });

  // Revisa cada 5 s qué giveaways ya terminaron; limpia los viejos (> 7 días terminados)
  setInterval(() => {
    const now = Date.now();
    for (const [msgId, gw] of Object.entries(G())) {
      if (!gw.ended && gw.endsAt <= now) finish(client, msgId).catch((e) => console.error('[giveaway]', e));
      if (gw.ended && now - gw.endsAt > 7 * 864e5) {
        delete G()[msgId];
        store.save();
      }
    }
  }, 5000).unref();
}

module.exports = { init, recover, defs, names, handle, parseDuration, renderBanner };
