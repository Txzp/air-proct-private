const { Events } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const cfg = require('../config');
const db = require('../discordStore');
const { isTrusted } = require('../trust');
const { isStaff } = require('./tickets');

let guildRef = null;
let wantedChannelId = null; // canal donde el bot "vive"
let reconnecting = false;

function connect(channel) {
  const conn = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: true,
  });
  conn.removeAllListeners(VoiceConnectionStatus.Disconnected);
  conn.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      // ¿se está moviendo o reconectando solo?
      await Promise.race([entersState(conn, VoiceConnectionStatus.Signalling, 5000), entersState(conn, VoiceConnectionStatus.Connecting, 5000)]);
    } catch {
      conn.destroy();
      if (wantedChannelId) setTimeout(() => rejoin(), 5000); // lo sacaron o se cayó → vuelve
    }
  });
  conn.on('error', (e) => console.error('[voice]', e.message));
  return conn;
}

async function rejoin() {
  if (reconnecting || !wantedChannelId || !guildRef) return;
  reconnecting = true;
  try {
    const ch = await guildRef.channels.fetch(wantedChannelId).catch(() => null);
    if (!ch?.isVoiceBased()) {
      console.log('[voice] El canal ya no existe, me quedo fuera');
      setWanted(null);
      return;
    }
    connect(ch);
  } finally {
    reconnecting = false;
  }
}

function setWanted(id) {
  wantedChannelId = id;
  db.get('voice', {}).channelId = id;
  db.markDirty();
}

async function onMessage(message) {
  if (!message.guild || message.guild.id !== cfg.guildId || message.author.bot) return;
  const cmd = (message.content || '').trim().toLowerCase();
  if (cmd !== '!pjoin' && cmd !== '!pleave') return;

  if (cmd === '!pjoin') {
    const vc = message.member?.voice.channel;
    if (!vc) return message.reply('Métete a un vc primero we 😭').catch(() => {});
    if (!vc.joinable) return message.reply('No tengo permiso para entrar a ese vc 💀').catch(() => {});
    setWanted(vc.id);
    connect(vc);
    return message.reply(`Ya llegué a ${vc} y aquí me quedo 😎`).catch(() => {});
  }

  // !pleave: staff o alguien que esté en el mismo vc
  const conn = getVoiceConnection(message.guild.id);
  if (!conn) return message.reply('Ni estoy en vc we 🤨').catch(() => {});
  const sameVc = message.member?.voice.channelId === wantedChannelId;
  if (!sameVc && !isTrusted(message.guild, message.author.id) && !isStaff(message.member)) {
    return message.reply('Solo alguien de mi vc o el staff me puede sacar 😤').catch(() => {});
  }
  setWanted(null);
  conn.destroy();
  return message.reply('Ya me voy, bye 👋').catch(() => {});
}

function init(client) {
  client.on(Events.MessageCreate, (m) => onMessage(m).catch((e) => console.error('[voice]', e)));
}

// Al arrancar: vuelve al vc donde estaba antes del reinicio
async function start(guild) {
  guildRef = guild;
  wantedChannelId = db.get('voice', {}).channelId || null;
  if (wantedChannelId) await rejoin();
}

module.exports = { init, start };
