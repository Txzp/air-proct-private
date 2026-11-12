const cfg = require('./config');
const store = require('./store');

function isOwner(guild, id) {
  return id === guild.ownerId || cfg.ownerIds.includes(id);
}

function hasTrustedRole(guild, id) {
  const m = guild.members.cache.get(id);
  return Boolean(m && cfg.trustedRoles.some((r) => m.roles.cache.has(r)));
}

function isTrusted(guild, id) {
  if (!id) return false;
  return (
    id === guild.client.user.id ||
    isOwner(guild, id) ||
    cfg.whitelist.includes(id) ||
    store.data.whitelist.includes(id) ||
    hasTrustedRole(guild, id)
  );
}

// ¿Puede meter/autorizar bots? Solo owner del server, whitelist y roles botAuthRoles (Owner/own).
function canAddBots(guild, id) {
  if (!id) return false;
  if (isOwner(guild, id) || cfg.whitelist.includes(id) || store.data.whitelist.includes(id)) return true;
  const m = guild.members.cache.get(id);
  return Boolean(m && cfg.botAuthRoles.some((r) => m.roles.cache.has(r)));
}

// Id actual de un rol protegido (por si fue recreado)
function roleId(id) {
  let cur = id;
  const seen = new Set();
  while (store.data.roleRemap[cur] && !seen.has(cur)) {
    seen.add(cur);
    cur = store.data.roleRemap[cur];
  }
  return cur;
}

function protectedRoleIds() {
  return Object.values(cfg.protectedRoles).map(roleId);
}

module.exports = { isOwner, isTrusted, canAddBots, roleId, protectedRoleIds };
