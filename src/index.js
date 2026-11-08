const http = require('http');
const { Client, GatewayIntentBits, Partials, Events, ActivityType, PermissionFlagsBits } = require('discord.js');
const cfg = require('./config');
const logger = require('./logger');
const antispam = require('./modules/antispam');
const antinuke = require('./modules/antinuke');
const antiraid = require('./modules/antiraid');
const commands = require('./modules/commands');

if (!cfg.token) {
  console.error('Falta DISCORD_TOKEN en las variables de entorno.');
  process.exit(1);
}

/* ---------- Servidor web (Render + UptimeRobot) ---------- */
let ready = false;
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(ready ? 'AirProtect online 🛡️' : 'AirProtect iniciando...');
  })
  .listen(cfg.port, () => console.log(`[web] Escuchando en el puerto ${cfg.port}`));

/* ---------- Cliente ---------- */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildEmojisAndStickers,
  ],
  partials: [Partials.GuildMember],
});

logger.init(client);
antispam.init(client);
antiraid.init(client);
commands.init(client);

client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] Conectado como ${c.user.tag}`);
  c.user.setPresence({ activities: [{ name: 'protegiendo el server 🛡️', type: ActivityType.Watching }], status: 'online' });

  // Bot de un solo server: sale de cualquier otro
  for (const g of c.guilds.cache.values()) if (g.id !== cfg.guildId) await g.leave().catch(() => {});

  const guild = await c.guilds.fetch(cfg.guildId).catch(() => null);
  if (!guild) {
    console.error(`[bot] No estoy en el server ${cfg.guildId}. Invítame primero.`);
    return;
  }
  await guild.members.fetch().catch((e) => console.error('[bot] No pude cargar miembros (¿activaste SERVER MEMBERS INTENT?)', e.message));
  await guild.roles.fetch().catch(() => {});
  await guild.channels.fetch().catch(() => {});
  await antinuke.init(c, guild);
  await commands.register(guild).catch((e) => console.error('[bot] Error registrando comandos:', e.message));

  ready = true;
  const me = guild.members.me;
  const issues = [];
  if (!me.permissions.has(PermissionFlagsBits.Administrator)) issues.push('❌ No tengo **Administrador**.');
  const above = guild.roles.cache.filter((r) => r.position > me.roles.highest.position).size;
  if (above) issues.push(`⚠️ Hay **${above}** roles por encima del mío: súbeme arriba del todo o no podré frenar a quien los tenga.`);
  logger.log(issues.length ? 'warn' : 'ok', 'AirProtect en línea', issues.join('\n') || 'Todo listo. Anti-spam, anti-nuke y anti-raid activos.');
});

client.on(Events.GuildCreate, (g) => {
  if (g.id !== cfg.guildId) g.leave().catch(() => {});
});

client.on(Events.Error, (e) => console.error('[client]', e));
process.on('unhandledRejection', (e) => console.error('[unhandled]', e));
process.on('uncaughtException', (e) => console.error('[uncaught]', e));

client.login(cfg.token);
