// Bots guardianes: cuentas extra que se quedan afk en un vc para que no se quede vacío.
// Discord solo deja 1 vc por bot → cada guardián cuida uno. Se piden con !gvc.
const { Client, GatewayIntentBits, Events, ActivityType } = require('discord.js');
const { joinVoiceChannel, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const cfg = require('./config');
const db = require('./discordStore');

const guards = []; // { n, client, ready, channelId, conn, pinned }
const assigned = () => db.get('guardAssign', {}); // n -> channelId

function setChannel(g, channelId) {
  g.channelId = channelId;
  if (channelId) assigned()[g.n] = channelId;
  else delete assigned()[g.n];
  db.markDirty();
}

function release(g) {
  const conn = g.conn;
  g.conn = null;
  setChannel(g, null);
  conn?.destroy();
  setPresence(g);
}

function setPresence(g) {
  g.client.user?.setPresence({
    activities: [{ name: g.channelId ? '🛡️ cuidando un vc' : '😴 disponible (!gvc)', type: ActivityType.Watching }],
    status: g.channelId ? 'online' : 'idle',
  });
}

async function connect(g, announce = false) {
  const guild = g.client.guilds.cache.get(cfg.guildId);
  const ch = guild && (await guild.channels.fetch(g.channelId).catch(() => null));
  if (!ch?.isVoiceBased()) {
    if (g.pinned) setTimeout(() => connect(g), 60_000);
    else release(g); // el vc ya no existe → queda libre
    return;
  }
  g.conn?.destroy();
  const conn = joinVoiceChannel({
    channelId: ch.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    group: g.client.user.id, // cada bot su propia conexión en el mismo server
    selfDeaf: true,
    selfMute: true,
  });
  g.conn = conn;
  conn.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([entersState(conn, VoiceConnectionStatus.Signalling, 5000), entersState(conn, VoiceConnectionStatus.Connecting, 5000)]);
    } catch {
      if (g.conn !== conn) return;
      conn.destroy();
      g.conn = null;
      if (g.channelId) setTimeout(() => connect(g), 5000); // lo sacaron o se cayó → vuelve si el vc sigue
    }
  });
  conn.on('error', (e) => console.error(`[guard${g.n}]`, e.message));
  setPresence(g);
  if (announce) {
    await entersState(conn, VoiceConnectionStatus.Ready, 15_000).catch(() => {});
    await ch.send({ content: `Protegiendo ${ch} 😊`, allowedMentions: { parse: [] } }).catch(() => {});
  }
}

function startOne(n, token, pinnedChannel) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  const g = { n, client, ready: false, channelId: null, conn: null, pinned: Boolean(pinnedChannel), pinnedChannel };
  guards.push(g);

  client.once(Events.ClientReady, async (c) => {
    console.log(`[guard${n}] Conectado como ${c.user.tag}`);
    for (const gu of c.guilds.cache.values()) if (gu.id !== cfg.guildId) gu.leave().catch(() => {});
    await c.guilds.fetch(cfg.guildId).catch(() => null);
    g.ready = true;
    if (g.pinned) {
      g.channelId = g.pinnedChannel;
      connect(g);
    } else setPresence(g);
  });
  // si borran el vc donde está → queda libre
  client.on(Events.ChannelDelete, (ch) => {
    if (ch.id === g.channelId && !g.pinned) release(g);
  });
  client.on(Events.Error, (e) => console.error(`[guard${n}]`, e.message));
  client.login(token).catch((e) => console.error(`[guard${n}] Token inválido:`, e.message));
}

function start() {
  cfg.guards.forEach((gc, i) => gc.token && startOne(i + 1, gc.token, gc.channelId));
  console.log(`[guard] ${guards.length} guardianes configurados`);
}

// Tras cargar la base de datos: vuelven a los vc donde estaban antes del reinicio
async function restore() {
  for (let t = 0; t < 30 && guards.some((g) => !g.ready); t++) await new Promise((r) => setTimeout(r, 1000));
  for (const g of guards) {
    const ch = assigned()[g.n];
    if (g.ready && !g.pinned && ch) {
      g.channelId = ch;
      connect(g);
    }
  }
}

/* ---------- !gvc ---------- */
async function onMessage(message) {
  if (!message.guild || message.guild.id !== cfg.guildId || message.author.bot) return;
  const cmd = (message.content || '').trim().toLowerCase();
  if (cmd !== '!gvc' && cmd !== '!gvc off') return;
  const vc = message.member?.voice.channel;
  const reply = (content) => message.reply({ content, allowedMentions: { repliedUser: false } }).catch(() => {});
  if (!vc) return reply('ni estas en vc pndj');

  const here = guards.find((g) => g.channelId === vc.id);
  if (cmd === '!gvc off') {
    if (!here) return reply('No hay ningún guardián en tu vc 🤨');
    if (here.pinned) return reply('Ese guardián está fijo en este vc, no se puede quitar 🔒');
    release(here);
    return reply(`👋 ${here.client.user} se fue de ${vc}`);
  }

  if (here) return reply(`Ya está ${here.client.user} cuidando este vc 😎`);
  const free = guards.filter((g) => g.ready && !g.channelId && !g.pinned);
  if (!free.length) return reply('No hay nadie disponible f mi bro 😔');
  if (!vc.permissionsFor(vc.guild.members.me)?.has('Connect')) return reply('No puedo entrar a ese vc 💀');

  const g = free[Math.floor(Math.random() * free.length)];
  setChannel(g, vc.id);
  await connect(g, true);
}

function init(mainClient) {
  mainClient.on(Events.MessageCreate, (m) => onMessage(m).catch((e) => console.error('[guard]', e)));
}

function shutdown() {
  for (const g of guards) {
    g.conn?.destroy();
    g.client.destroy();
  }
}

module.exports = { start, restore, init, shutdown };
