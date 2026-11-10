const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const cfg = require('../config');
const db = require('../discordStore');

const B = cfg.vcBoard;
let totals = {}; // userId -> ms acumulados
let lastTick = Date.now();
let message = null;
let lastContent = '';

function fmt(ms) {
  const h = Math.floor(ms / 36e5);
  const m = Math.floor((ms % 36e5) / 6e4);
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function inVoice(guild) {
  const afk = guild.afkChannelId;
  return [...guild.voiceStates.cache.values()].filter((vs) => vs.channelId && vs.channelId !== afk && !vs.member?.user.bot);
}

// Suma el tiempo transcurrido a todos los que están en vc ahora mismo
function accumulate(guild) {
  const now = Date.now();
  const delta = Math.min(now - lastTick, B.tickMs * 3); // tras un reinicio no inventa horas
  lastTick = now;
  if (delta <= 0) return;
  for (const vs of inVoice(guild)) totals[vs.id] = (totals[vs.id] || 0) + delta;
  db.markDirty();
}

function totalOf(id) {
  return totals[id] || 0;
}

async function getChannel(guild) {
  const state = db.get('vcBoard', {});
  let ch = state.channelId ? guild.channels.cache.get(state.channelId) : null;
  if (!ch) ch = guild.channels.cache.find((c) => c.parentId === B.categoryId && c.name === B.channelName) || null;
  if (!ch) {
    ch = await guild.channels.create({
      name: B.channelName,
      type: ChannelType.GuildText,
      parent: B.categoryId,
      topic: '🏆 Los que más tiempo llevan en vc. Se actualiza solo.',
      permissionOverwrites: [
        { id: guild.id, allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages, P.AddReactions, P.CreatePublicThreads] },
        { id: guild.client.user.id, allow: [P.ViewChannel, P.SendMessages, P.ManageMessages] },
      ],
      reason: 'AirProtect: leaderboard de vc',
    });
    console.log('[vcboard] Canal creado', ch.id);
  }
  if (state.channelId !== ch.id) {
    state.channelId = ch.id;
    db.markDirty();
  }
  return ch;
}

function build(guild) {
  const live = new Set(inVoice(guild).map((vs) => vs.id));
  const rows = Object.entries(totals)
    .filter(([, ms]) => ms >= 60_000)
    .sort((a, b) => b[1] - a[1])
    .slice(0, B.top);
  const medals = ['🥇', '🥈', '🥉'];
  const lines = rows.map(([id, ms], i) => `${medals[i] || `**${i + 1}.**`} <@${id}> -> **${fmt(ms)}**${live.has(id) ? ' 🔴' : ''}`);
  return [
    '# 🏆 Leaderboard VC',
    '',
    ...(lines.length ? lines : ['*Nadie ha estado en vc todavía... ¿qué esperan? 😭*']),
    '',
    `-# 🔴 = en vc ahora • Se actualiza solo • <t:${Math.floor(Date.now() / 1000)}:R>`,
  ].join('\n');
}

async function render(guild) {
  const ch = await getChannel(guild);
  const content = build(guild);
  // compara sin la línea del "hace X" para no editar de más
  const core = content.split('\n').slice(0, -1).join('\n');
  if (core === lastContent && message) return;
  if (!message) {
    const msgs = await ch.messages.fetch({ limit: 20 }).catch(() => null);
    message = msgs?.find((m) => m.author.id === guild.client.user.id && m.content.includes('Leaderboard VC')) || null;
  }
  const payload = { content, allowedMentions: { parse: [] } };
  if (message) {
    message = await message.edit(payload).catch(async (e) => {
      if (e.code === 10008) return ch.send(payload);
      throw e;
    });
  } else message = await ch.send(payload);
  lastContent = core;
}

async function start(guild, sessions) {
  totals = db.get('vcTotals', {});
  // Primera vez: arranca con lo que ya llevan los que están en vc ahora
  if (!Object.keys(totals).length && sessions) {
    for (const [id, s] of sessions) totals[id] = Math.max(0, Date.now() - s.start);
    db.markDirty();
  }
  lastTick = Date.now();
  await render(guild).catch((e) => console.error('[vcboard]', e.message));
  setInterval(() => accumulate(guild), B.tickMs).unref();
  setInterval(() => render(guild).catch((e) => console.error('[vcboard]', e.message)), B.renderMs).unref();
}

// Antes de apagarse, suma lo último
function flush(guild) {
  if (guild) accumulate(guild);
}

module.exports = { start, flush, totalOf, fmt };
