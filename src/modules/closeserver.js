// Cierre del server (una sola vez): patea a todos los de roles bajos y borra TODOS los
// canales y categorías. Se activa con CLOSE_SERVER=on en Render (para que NO pase en cada deploy).
const cfg = require('../config');
const db = require('../discordStore');
const { isTrusted } = require('../trust');
const { log } = require('../logger');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(guild) {
  if (!cfg.closeServer.enabled) return;
  if (db.get('closeServerDone', false)) return console.log('[close] Ya se hizo antes, no repito');
  console.log('[close] === CERRANDO EL SERVER ===');

  // 1) Kick a todos los de roles bajos (menos owner, staff de confianza y bots)
  let kicked = 0;
  for (const m of guild.members.cache.values()) {
    if (m.id === guild.ownerId || cfg.ownerIds.includes(m.id) || m.user.bot || isTrusted(guild, m.id)) continue;
    if (!m.kickable) continue;
    await m.kick('AirProtect: cierre del server').then(() => kicked++).catch(() => {});
    await sleep(350);
  }
  console.log(`[close] ${kicked} miembros expulsados`);

  // 2) Borrar TODOS los canales y categorías
  let del = 0;
  for (const ch of [...guild.channels.cache.values()]) {
    await ch.delete('AirProtect: cierre del server').then(() => del++).catch(() => {});
    await sleep(150);
  }
  console.log(`[close] ${del} canales/categorías borrados`);

  db.set('closeServerDone', true);
  await db.save().catch(() => {});
  try {
    log('danger', 'Server cerrado', `Se expulsó a ${kicked} miembros y se borraron ${del} canales/categorías.`);
  } catch {}

  // DM al owner/manager
  for (const id of cfg.ownerIds) {
    const u = await guild.client.users.fetch(id).catch(() => null);
    await u?.send(`✅ **Server cerrado.** Expulsé a **${kicked}** miembros y borré **${del}** canales/categorías.`).catch(() => {});
  }
}

module.exports = { run };
