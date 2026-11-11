// Bots "guardianes": cuentas extra que solo se sientan en un vc para que nunca se quede vacío.
// Discord solo deja 1 vc por bot, así que cada guardián cuida uno.
const { Client, GatewayIntentBits, Events, ActivityType } = require('discord.js');
const { joinVoiceChannel, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const cfg = require('./config');

const guards = []; // { n, client, channelId, conn }

function connect(g) {
  const guild = g.client.guilds.cache.get(cfg.guildId);
  const ch = guild?.channels.cache.get(g.channelId);
  if (!ch?.isVoiceBased()) {
    console.log(`[guard${g.n}] No encuentro el vc ${g.channelId}, reintento en 1 min`);
    setTimeout(() => connect(g), 60_000);
    return;
  }
  g.conn = joinVoiceChannel({
    channelId: ch.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    group: g.client.user.id, // cada bot su propia conexión en el mismo server
    selfDeaf: true,
    selfMute: true,
  });
  g.conn.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([entersState(g.conn, VoiceConnectionStatus.Signalling, 5000), entersState(g.conn, VoiceConnectionStatus.Connecting, 5000)]);
    } catch {
      g.conn.destroy();
      setTimeout(() => connect(g), 5000); // lo sacaron o se cayó → vuelve
    }
  });
  g.conn.on(VoiceConnectionStatus.Ready, () => console.log(`[guard${g.n}] En ${ch.name}`));
  g.conn.on('error', (e) => console.error(`[guard${g.n}]`, e.message));
}

function startOne(n, token, channelId) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  const g = { n, client, channelId, conn: null };
  guards.push(g);

  client.once(Events.ClientReady, async (c) => {
    console.log(`[guard${n}] Conectado como ${c.user.tag}`);
    c.user.setPresence({ activities: [{ name: `🛡️ cuidando el vc`, type: ActivityType.Watching }], status: 'idle' });
    for (const gu of c.guilds.cache.values()) if (gu.id !== cfg.guildId) gu.leave().catch(() => {});
    await c.guilds.fetch(cfg.guildId).catch(() => null);
    connect(g);
  });
  // Si el canal se borra y se vuelve a crear con otro id, el owner cambia GUARD_CHANNEL_n
  client.on(Events.Error, (e) => console.error(`[guard${n}]`, e.message));
  client.login(token).catch((e) => console.error(`[guard${n}] Token inválido:`, e.message));
}

function start() {
  for (const [n, g] of cfg.guards.entries()) {
    if (g.token) startOne(n + 1, g.token, g.channelId);
  }
  if (!guards.length) console.log('[guard] Sin guardianes configurados');
}

function shutdown() {
  for (const g of guards) {
    g.conn?.destroy();
    g.client.destroy();
  }
}

module.exports = { start, shutdown };
