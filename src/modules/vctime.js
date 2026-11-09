const { Events, EmbedBuilder } = require('discord.js');
const cfg = require('../config');

const V = cfg.vcTime;
const sessions = new Map(); // userId -> { start, channelId, approx }
const lastSession = new Map(); // userId -> { ms, channelId, end }

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

const NOTES = [
  [5 * 60_000, ['apenas llegaste y ya presumes 😭', 'ni calentó el micro todavía 🎤', '¿eso es todo? mi abuela dura más en llamada 💀', 'entró, vio y ya se quiere ir 😭']],
  [30 * 60_000, ['vas bien, pero no te emociones 🤨', 'ya agarrando confianza el pndj 😂', 'media hora y ya se siente streamer 💀', 'ni para una partida completa alcanza 😭']],
  [2 * 60 * 60_000, ['este pndj no toca pasto o que? 😭', 'ya hasta la silla tiene tu forma 💀', 'sal a que te dé el sol tantito we ☀️', '¿y la tarea? ah verdad 😭']],
  [5 * 60 * 60_000, ['ya págale renta a Discord 💀', 'tu mamá ya te dio por desaparecido 😭', 'el pasto ya ni te reconoce 🌱', 'este ya vive aquí, denle su rol de mueble 🛋️']],
  [Infinity, ['llamen a su familia, no ha salido del vc 💀', 'esto ya es un caso para la ONU 😭', 'Discord te debería pagar a ti we 💸', 'ya ni es persona, es parte del canal 🧱']],
];

function note(ms) {
  return pick(NOTES.find(([max]) => ms < max)[1]);
}

function startSession(id, channelId, approx = false) {
  sessions.set(id, { start: Date.now(), channelId, approx });
}

function endSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  lastSession.set(id, { ms: Date.now() - s.start, channelId: s.channelId, end: Date.now(), approx: s.approx });
  sessions.delete(id);
}

async function onMessage(message) {
  if (!message.guild || message.guild.id !== cfg.guildId || message.author.bot) return;
  const content = (message.content || '').trim().toLowerCase();
  if (!/^!vc\s+time\b/.test(content)) return;

  const target = message.mentions.members.first() || message.member;
  const self = target.id === message.author.id;
  const voice = target.voice;
  const s = sessions.get(target.id);
  const embed = new EmbedBuilder().setColor(0x57f287);

  if (voice?.channelId && s) {
    const ms = Date.now() - s.start;
    let n = note(ms);
    if (voice.selfDeaf || voice.serverDeaf) n += ' y encima afk, ni escucha 💀';
    else if (voice.selfMute || voice.serverMute) n += ' y ni habla el mudo 🤐';
    embed
      .setDescription(`${target} **${self ? 'tienes' : 'tiene'} ${fmt(ms)}${s.approx ? '+' : ''} en vc**\n\n*${n}*`)
      .addFields({ name: '🔊 Vc Channel', value: `<#${voice.channelId}>`, inline: true }, { name: '⏱️ Desde', value: `<t:${Math.floor(s.start / 1000)}:t>`, inline: true });
  } else {
    const last = lastSession.get(target.id);
    if (last) {
      embed
        .setColor(0xfee75c)
        .setDescription(`${target} **${self ? 'no estás' : 'no está'} en vc**, la última vez ${self ? 'duraste' : 'duró'} **${fmt(last.ms)}${last.approx ? '+' : ''}**\n\n*${note(last.ms)}*`)
        .addFields({ name: '🔊 Vc Channel', value: `<#${last.channelId}>`, inline: true }, { name: '👋 Salió', value: `<t:${Math.floor(last.end / 1000)}:R>`, inline: true });
    } else {
      embed
        .setColor(0xed4245)
        .setDescription(`${target} **${self ? 'no estás' : 'no está'} en vc** 🤨\n\n*${pick(['¿miedo a hablar o qué? 😭', 'ni ha pisado un vc el antisocial 💀', 'métete a vc we, no muerden 😂'])}*`);
    }
  }

  const reply = await message.reply({ embeds: [embed], allowedMentions: { parse: [], repliedUser: false } }).catch(() => null);
  setTimeout(() => {
    reply?.delete().catch(() => {});
    message.delete().catch(() => {});
  }, V.deleteAfterMs);
}

function init(client) {
  client.on(Events.VoiceStateUpdate, (o, n) => {
    if (n.guild.id !== cfg.guildId || n.member?.user.bot) return;
    if (!o.channelId && n.channelId) startSession(n.id, n.channelId);
    else if (o.channelId && !n.channelId) endSession(n.id);
    else if (o.channelId !== n.channelId && n.channelId) {
      const s = sessions.get(n.id);
      if (s) s.channelId = n.channelId; // cambiar de vc no reinicia el tiempo
      else startSession(n.id, n.channelId);
    }
  });
  client.on(Events.MessageCreate, (m) => onMessage(m).catch((e) => console.error('[vctime]', e)));
}

// Al arrancar: recupera desde cuándo está cada quien en vc leyendo los logs del server
// ("🔊 Entró a voz"). Si no hay registro, cuenta desde ahora y se marca con "+".
async function recoverFromLogs(guild, ids) {
  const found = new Map();
  const ch = await guild.channels.fetch(cfg.serverLogs.channelId).catch(() => null);
  if (!ch?.isTextBased()) return found;
  const pending = new Set(ids);
  const done = new Set();
  let before;
  for (let n = 0; n < 30 && pending.size; n++) {
    const batch = await ch.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch?.size) break;
    for (const m of batch.values()) {
      // los mensajes vienen del más nuevo al más viejo
      if (m.author.id !== guild.client.user.id) continue;
      for (const e of m.embeds) {
        const id = e.footer?.text?.match(/^ID: (\d+)$/)?.[1];
        if (!id || !pending.has(id) || done.has(id)) continue;
        if (e.title?.includes('Entró a voz')) {
          found.set(id, m.createdTimestamp);
          done.add(id);
          pending.delete(id);
        } else if (e.title?.includes('Salió de voz')) {
          // salió después de su última entrada registrada → no se sabe cuándo volvió
          done.add(id);
          pending.delete(id);
        }
      }
    }
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return found;
}

async function start(guild) {
  const inVc = [...guild.voiceStates.cache.values()].filter((vs) => vs.channelId && !vs.member?.user.bot);
  const known = await recoverFromLogs(guild, inVc.map((vs) => vs.id)).catch(() => new Map());
  for (const vs of inVc) {
    if (sessions.has(vs.id)) continue;
    const since = known.get(vs.id);
    if (since) sessions.set(vs.id, { start: since, channelId: vs.channelId, approx: false });
    else startSession(vs.id, vs.channelId, true);
  }
  console.log(`[vctime] ${inVc.length} en vc, ${known.size} recuperados desde los logs`);
}

module.exports = { init, start };
