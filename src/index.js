const http = require('http');
const { Client, GatewayIntentBits, Partials, Events, ActivityType, PermissionFlagsBits } = require('discord.js');
const cfg = require('./config');
const logger = require('./logger');
const antispam = require('./modules/antispam');
const antinuke = require('./modules/antinuke');
const antiraid = require('./modules/antiraid');
const commands = require('./modules/commands');
const tickets = require('./modules/tickets');
const welcome = require('./modules/welcome');
const boost = require('./modules/boost');
const warns = require('./modules/warns');
const mg = require('./modules/mg');
const stats = require('./modules/stats');
const serverlogs = require('./modules/serverlogs');
const vctime = require('./modules/vctime');
const giveaway = require('./modules/giveaway');
const vcboard = require('./modules/vcboard');
const db = require('./discordStore');
const voice = require('./modules/voice');
const guards = require('./guards');
const tempvc = require('./modules/tempvc');

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
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildInvites,
  ],
  partials: [Partials.GuildMember, Partials.Message, Partials.Channel, Partials.User],
});

logger.init(client);
antispam.init(client);
antiraid.init(client);
commands.init(client);
tickets.init(client);
welcome.init(client);
boost.init(client);
mg.init(client);
serverlogs.init(client);
vctime.init(client);
giveaway.init(client);
voice.init(client);
tempvc.init(client);

client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] Conectado como ${c.user.tag}`);
  c.user.setPresence({ activities: [{ name: 'Protegiendo 0km 👁️', type: ActivityType.Watching }], status: 'online' });

  for (const g of c.guilds.cache.values()) console.log(`[bot] Estoy en: ${g.name} — ID ${g.id}${g.id === cfg.guildId ? ' ✅ (protegido)' : ''}`);
  await initGuild(c);
});

async function initGuild(c) {
  if (ready) return;
  const guild = await c.guilds.fetch(cfg.guildId).catch(() => null);
  if (!guild) {
    console.error(`[bot] No estoy en el server ${cfg.guildId}. Invítame ahí o corrige GUILD_ID.`);
    return;
  }
  await guild.members.fetch().catch((e) => console.error('[bot] No pude cargar miembros (¿activaste SERVER MEMBERS INTENT?)', e.message));
  await guild.roles.fetch().catch(() => {});
  await guild.channels.fetch().catch(() => {});
  await antinuke.init(c, guild);
  await commands.register(guild).catch((e) => console.error('[bot] Error registrando comandos:', e.message));
  await tickets.ensurePanel(guild).catch((e) => console.error('[tickets]', e.message));
  await antispam.ensureHoneypot(guild).catch((e) => console.error('[honeypot]', e.message));
  await warns.rebuild(guild).catch((e) => console.error('[warns]', e.message));
  stats.start(c);
  await vctime.start(guild).catch((e) => console.error('[vctime]', e.message));
  await giveaway.recover(guild).catch((e) => console.error('[giveaway]', e.message));
  await db.load(guild).catch((e) => console.error('[db]', e.message));
  db.start();
  await vcboard.start(guild, vctime.sessions).catch((e) => console.error('[vcboard]', e.message));
  await voice.start(guild).catch((e) => console.error('[voice]', e.message));
  await tempvc.start(guild).catch((e) => console.error('[tempvc]', e.message));
  await serverlogs.start(guild).catch((e) => console.error('[serverlogs]', e.message));

  ready = true;
  const me = guild.members.me;
  const issues = [];
  if (!me.permissions.has(PermissionFlagsBits.Administrator)) issues.push('❌ No tengo **Administrador**.');
  const above = guild.roles.cache.filter((r) => r.position > me.roles.highest.position && !cfg.trustedRoles.includes(r.id) && !r.managed).size;
  if (above) issues.push(`⚠️ Hay **${above}** roles por encima del mío: súbeme arriba del todo o no podré frenar a quien los tenga.`);
  logger.log(issues.length ? 'warn' : 'ok', 'AirProtect en línea', issues.join('\n') || 'Todo listo. Anti-spam, anti-nuke y anti-raid activos.');
}

client.on(Events.GuildCreate, async (g) => {
  console.log(`[bot] Me invitaron a: ${g.name} — ID ${g.id}${g.id === cfg.guildId ? ' ✅ (protegido)' : ' (no es el server protegido, me quedo pero sin proteger)'}`);
  if (g.id === cfg.guildId) await initGuild(client);
  else if (cfg.leaveOtherGuilds) g.leave().catch(() => {});
});

client.on(Events.Error, (e) => console.error('[client]', e));
// Render manda SIGTERM antes de reiniciar/redeployar: guardamos todo antes de salir
let shuttingDown = false;
async function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[bot] ${sig} recibido, guardando datos...`);
  try {
    vcboard.flush(client.guilds.cache.get(cfg.guildId));
    db.markDirty();
    await Promise.race([db.save(), new Promise((r) => setTimeout(r, 8000))]);
    guards.shutdown();
  } catch (e) {
    console.error('[bot] Error al guardar:', e.message);
  }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (e) => console.error('[unhandled]', e));
process.on('uncaughtException', (e) => console.error('[uncaught]', e));

client.login(cfg.token);
guards.start();
