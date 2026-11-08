const { Events, AuditLogEvent, PermissionFlagsBits: P } = require('discord.js');
const cfg = require('../config');
const store = require('../store');
const { isTrusted, roleId, protectedRoleIds } = require('../trust');
const { log, currentLogChannelId } = require('../logger');

const DANGEROUS =
  P.Administrator | P.ManageGuild | P.ManageRoles | P.ManageChannels | P.BanMembers | P.KickMembers | P.ManageWebhooks;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const counters = new Map(); // `${userId}:${tipo}` -> [timestamps]
const punished = new Set();
const channelSnap = new Map(); // canales borrados (para recrearlos)
const roleSnap = new Map(); // roles borrados (para recrearlos)
const channelRemap = new Map(); // id viejo -> id nuevo
const roleMembers = new Map(); // roleId -> Set(userIds)
const created = new Map(); // userId -> [{ kind, id, t }] lo que creó un sospechoso
const bannedBy = new Map(); // userId -> [{ id, t }]

function hit(id, type) {
  const k = `${id}:${type}`;
  const now = Date.now();
  const arr = (counters.get(k) || []).filter((t) => now - t < cfg.antiNuke.windowMs);
  arr.push(now);
  counters.set(k, arr);
  return arr.length;
}

function remember(map, userId, item) {
  const now = Date.now();
  const arr = (map.get(userId) || []).filter((x) => now - x.t < 5 * 60_000);
  arr.push({ ...item, t: now });
  map.set(userId, arr);
}

/* ---------- Respaldo de miembros por rol ---------- */
function addRoleMember(rid, uid) {
  if (!roleMembers.has(rid)) roleMembers.set(rid, new Set());
  roleMembers.get(rid).add(uid);
}
function persistProtected() {
  for (const rid of protectedRoleIds()) store.data.roleMembers[rid] = [...(roleMembers.get(rid) || [])];
  store.save();
}

/* ---------- Snapshots ---------- */
function snapChannel(ch) {
  return {
    name: ch.name,
    type: ch.type,
    topic: ch.topic ?? undefined,
    nsfw: ch.nsfw ?? undefined,
    rateLimitPerUser: ch.rateLimitPerUser ?? undefined,
    bitrate: ch.bitrate ?? undefined,
    userLimit: ch.userLimit ?? undefined,
    parentId: ch.parentId ?? null,
    position: ch.rawPosition,
    overwrites: ch.permissionOverwrites
      ? ch.permissionOverwrites.cache.map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield }))
      : [],
  };
}

async function waitFor(map, id, tries = 15) {
  for (let i = 0; i < tries; i++) {
    if (map.has(id)) return map.get(id);
    await sleep(200);
  }
  return null;
}

async function restoreChannel(guild, oldId) {
  const s = await waitFor(channelSnap, oldId);
  if (!s) return;
  channelSnap.delete(oldId);

  let parent = s.parentId;
  if (parent && !guild.channels.cache.has(parent)) {
    // la categoría también fue borrada: esperamos a que se recree
    for (let i = 0; i < 15 && !channelRemap.has(parent); i++) await sleep(300);
    parent = channelRemap.get(parent) || null;
  }
  const overwrites = s.overwrites
    .map((o) => ({ ...o, id: roleId(o.id) }))
    .filter((o) => guild.roles.cache.has(o.id) || guild.members.cache.has(o.id));

  try {
    const ch = await guild.channels.create({
      name: s.name,
      type: s.type,
      topic: s.topic,
      nsfw: s.nsfw,
      rateLimitPerUser: s.rateLimitPerUser,
      bitrate: s.bitrate,
      userLimit: s.userLimit,
      parent,
      permissionOverwrites: overwrites,
      reason: 'AirProtect: canal restaurado',
    });
    channelRemap.set(oldId, ch.id);
    if (oldId === currentLogChannelId()) {
      store.data.logChannelId = ch.id;
      store.save();
    }
    ch.setPosition(s.position).catch(() => {});
    log('ok', 'Canal restaurado', `Se recreó **#${s.name}** → ${ch}`);
  } catch (e) {
    log('warn', 'No se pudo restaurar canal', `#${s.name}: ${e.message}`);
  }
}

async function restoreRole(guild, oldId) {
  const s = await waitFor(roleSnap, oldId);
  if (!s) return;
  roleSnap.delete(oldId);
  try {
    const role = await guild.roles.create({
      name: s.name,
      color: s.color,
      hoist: s.hoist,
      mentionable: s.mentionable,
      permissions: s.permissions,
      unicodeEmoji: s.unicodeEmoji || undefined,
      reason: 'AirProtect: rol restaurado',
    });
    role.setPosition(s.position).catch(() => {});

    const isProtected = Object.values(cfg.protectedRoles).map(roleId).includes(oldId);
    if (isProtected) {
      store.data.roleRemap[oldId] = role.id;
      store.save();
    }
    log('ok', 'Rol restaurado', `Se recreó **@${s.name}** → ${role}. Devolviendo el rol a ${s.members.length} miembros...`);

    let ok = 0;
    for (const uid of s.members) {
      const m = guild.members.cache.get(uid) || (await guild.members.fetch(uid).catch(() => null));
      if (!m) continue;
      if (await m.roles.add(role, 'AirProtect: rol restaurado').then(() => true).catch(() => false)) ok++;
    }
    log('ok', 'Miembros restaurados', `${ok}/${s.members.length} miembros recuperaron ${role}.`);
    if (isProtected) persistProtected();
  } catch (e) {
    log('warn', 'No se pudo restaurar rol', `@${s.name}: ${e.message}`);
  }
}

/* ---------- Castigo ---------- */
async function punish(guild, userId, member, isBot, type, count) {
  if (punished.has(userId)) return;
  punished.add(userId);
  setTimeout(() => punished.delete(userId), 60_000);

  const reason = `AirProtect: anti-nuke (${type} x${count})`;
  const actions = [];

  if (isBot) {
    // 1) dejarlo sin permisos al instante (rol de integración) y 2) banearlo
    const botRole = member?.roles.botRole;
    await Promise.allSettled([
      botRole?.setPermissions(0n, reason),
      guild.members.ban(userId, { reason, deleteMessageSeconds: 3600 }),
    ]).then((r) => {
      if (botRole) actions.push(r[0].status === 'fulfilled' ? 'Permisos del bot quitados' : 'No se pudieron quitar permisos');
      actions.push(r[1].status === 'fulfilled' ? 'Bot baneado' : `Ban falló: ${r[1].reason?.message}`);
    });
  } else if (cfg.antiNuke.humanPunishment === 'ban') {
    await guild.members
      .ban(userId, { reason })
      .then(() => actions.push('Baneado'))
      .catch((e) => actions.push(`Ban falló: ${e.message}`));
  } else if (member) {
    const keep = member.roles.cache.filter((r) => r.managed).map((r) => r.id);
    await member.roles
      .set(keep, reason)
      .then(() => actions.push('Roles quitados'))
      .catch((e) => actions.push(`No se pudieron quitar roles: ${e.message}`));
    await member
      .timeout(28 * 24 * 60 * 60_000, reason)
      .then(() => actions.push('Aislado 28 días'))
      .catch(() => {});
  }

  // Deshacer lo que creó / baneó
  const mine = created.get(userId) || [];
  let undone = 0;
  for (const c of mine) {
    const target = c.kind === 'channel' ? guild.channels.cache.get(c.id) : guild.roles.cache.get(c.id);
    if (target && (await target.delete('AirProtect: limpieza de nuke').then(() => true).catch(() => false))) undone++;
  }
  created.delete(userId);
  const bans = bannedBy.get(userId) || [];
  let unbanned = 0;
  for (const b of bans) if (await guild.members.unban(b.id, 'AirProtect: ban de un nuker revertido').then(() => true).catch(() => false)) unbanned++;
  bannedBy.delete(userId);
  if (undone) actions.push(`${undone} canales/roles creados borrados`);
  if (unbanned) actions.push(`${unbanned} baneos revertidos`);

  log('danger', isBot ? 'BOT NUKER DETENIDO' : 'Intento de nuke detenido', `<@${userId}> (\`${userId}\`) ${isBot ? '🤖 bot' : '👤 usuario'}`, [
    { name: 'Acción detectada', value: `${type} ×${count}`, inline: true },
    { name: 'Respuesta', value: actions.join('\n') || 'Ninguna (sin permisos suficientes)' },
  ]);
}

/* ---------- Auditoría ---------- */
async function onAudit(entry, guild) {
  if (guild.id !== cfg.guildId) return;
  const ex = entry.executorId;
  if (!ex || isTrusted(guild, ex)) return;

  const A = AuditLogEvent;
  const member = guild.members.cache.get(ex) || (await guild.members.fetch(ex).catch(() => null));
  const isBot = Boolean(member?.user.bot ?? entry.executor?.bot);
  let type = null;
  let instant = false;
  const tasks = [];

  switch (entry.action) {
    case A.ChannelDelete:
      type = 'channelDelete';
      tasks.push(restoreChannel(guild, entry.targetId));
      break;
    case A.ChannelCreate:
      type = 'channelCreate';
      remember(created, ex, { kind: 'channel', id: entry.targetId });
      break;
    case A.RoleDelete:
      type = 'roleDelete';
      tasks.push(restoreRole(guild, entry.targetId));
      break;
    case A.RoleCreate:
      type = 'roleCreate';
      remember(created, ex, { kind: 'role', id: entry.targetId });
      break;
    case A.RoleUpdate: {
      const perm = entry.changes.find((c) => c.key === 'permissions');
      if (!perm) break;
      const oldP = BigInt(perm.old ?? 0);
      const newP = BigInt(perm.new ?? 0);
      if ((newP & ~oldP) & DANGEROUS) {
        type = 'dangerousPerm';
        instant = true;
        const role = guild.roles.cache.get(entry.targetId);
        tasks.push(role?.setPermissions(oldP, 'AirProtect: permisos peligrosos revertidos'));
      }
      break;
    }
    case A.MemberRoleUpdate: {
      const add = entry.changes.find((c) => c.key === '$add')?.new || [];
      const rem = entry.changes.find((c) => c.key === '$remove')?.new || [];
      const target = guild.members.cache.get(entry.targetId);
      const bad = add.filter((r) => (guild.roles.cache.get(r.id)?.permissions.bitfield ?? 0n) & DANGEROUS);
      if (bad.length) {
        type = 'dangerousPerm';
        instant = true;
        tasks.push(target?.roles.remove(bad.map((r) => r.id), 'AirProtect: rol peligroso dado por alguien no autorizado'));
      } else if (rem.some((r) => protectedRoleIds().includes(r.id))) {
        type = 'roleStrip';
      }
      break;
    }
    case A.MemberBanAdd:
      type = 'ban';
      remember(bannedBy, ex, { id: entry.targetId });
      break;
    case A.MemberKick:
      type = 'kick';
      break;
    case A.MemberPrune:
      type = 'prune';
      instant = true;
      break;
    case A.EmojiDelete:
      type = 'emojiDelete';
      break;
    case A.WebhookCreate:
      type = 'webhookCreate';
      tasks.push(
        guild.fetchWebhooks().then((h) => h.get(entry.targetId)?.delete('AirProtect: webhook no autorizado')).catch(() => {})
      );
      log('warn', 'Webhook no autorizado borrado', `<@${ex}> creó un webhook y fue eliminado. (Añádelo a /whitelist si es de confianza)`);
      break;
    case A.BotAdd:
      type = 'botAdd';
      instant = true;
      tasks.push(guild.members.kick(entry.targetId, 'AirProtect: bot añadido por alguien no autorizado').catch(() => {}));
      break;
    case A.GuildUpdate: {
      type = 'guildUpdate';
      instant = true;
      const name = entry.changes.find((c) => c.key === 'name');
      if (name?.old) tasks.push(guild.setName(name.old, 'AirProtect: cambio no autorizado revertido'));
      break;
    }
    case A.IntegrationCreate:
      type = 'integrationCreate';
      instant = true;
      break;
    default:
      return;
  }
  if (!type) return;

  const count = hit(ex, type);
  const limit = cfg.antiNuke.limits[type] ?? 1;
  // Un bot no autorizado haciendo CUALQUIER acción destructiva = castigo inmediato
  if (isBot || instant || count >= limit) tasks.push(punish(guild, ex, member, isBot, type, count));
  else if (count === limit - 1)
    log('warn', 'Actividad sospechosa', `<@${ex}> hizo **${type}** ×${count}. Una más y será castigado.`);

  await Promise.allSettled(tasks.filter(Boolean));
}

/* ---------- Init ---------- */
async function init(client, guild) {
  for (const m of guild.members.cache.values()) for (const rid of m.roles.cache.keys()) if (rid !== guild.id) addRoleMember(rid, m.id);
  // mezclar con lo guardado (por si el bot se reinició)
  for (const [rid, ids] of Object.entries(store.data.roleMembers)) ids.forEach((id) => addRoleMember(rid, id));
  persistProtected();

  client.on(Events.GuildMemberUpdate, (oldM, newM) => {
    if (newM.guild.id !== cfg.guildId) return;
    for (const rid of newM.roles.cache.keys()) if (rid !== newM.guild.id) addRoleMember(rid, newM.id);
    if (oldM.partial) return;
    // Quitar del respaldo con retraso: si un nuker quita roles masivamente y luego borra el rol,
    // el respaldo todavía tiene a todos para devolverlo.
    for (const rid of oldM.roles.cache.keys()) {
      if (newM.roles.cache.has(rid)) continue;
      setTimeout(() => {
        const cur = newM.guild.members.cache.get(newM.id);
        if (cur && !cur.roles.cache.has(rid)) {
          roleMembers.get(rid)?.delete(newM.id);
          if (protectedRoleIds().includes(rid)) persistProtected();
        }
      }, 10 * 60_000).unref();
    }
    if (protectedRoleIds().some((r) => !oldM.roles.cache.has(r) && newM.roles.cache.has(r))) persistProtected();
  });

  client.on(Events.ChannelDelete, (ch) => {
    if (ch.guildId !== cfg.guildId || ch.isThread?.()) return;
    channelSnap.set(ch.id, snapChannel(ch));
    setTimeout(() => channelSnap.delete(ch.id), 5 * 60_000).unref();
  });

  client.on(Events.GuildRoleDelete, (role) => {
    if (role.guild.id !== cfg.guildId) return;
    roleSnap.set(role.id, {
      name: role.name,
      color: role.color,
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions: role.permissions.bitfield,
      unicodeEmoji: role.unicodeEmoji,
      position: role.position,
      members: [...(roleMembers.get(role.id) || store.data.roleMembers[role.id] || [])],
    });
    setTimeout(() => roleSnap.delete(role.id), 5 * 60_000).unref();
  });

  client.on(Events.GuildAuditLogEntryCreate, (entry, g) => onAudit(entry, g).catch((e) => console.error('[antinuke]', e)));
}

module.exports = { init, roleMembers };
