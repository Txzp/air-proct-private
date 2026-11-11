const { Events, EmbedBuilder, AuditLogEvent: A, PermissionsBitField, AttachmentBuilder } = require('discord.js');
const cfg = require('../config');

const L = cfg.serverLogs;
const C = { green: 0x2ecc71, red: 0xe74c3c, yellow: 0xf1c40f, blue: 0x5865f2, purple: 0x9b59b6, gray: 0x95a5a6, orange: 0xe67e22 };
const DAY = 24 * 60 * 60_000;

/* ---------- Envío en cola (aguanta ráfagas sin rate limit) ---------- */
let client = null;
const queue = [];
let sending = false;

async function flush() {
  if (sending) return;
  sending = true;
  while (queue.length) {
    const batch = [];
    let files = [];
    // agrupa hasta 10 embeds (los que traen archivo van solos)
    while (queue.length && batch.length < 10) {
      if (queue[0].files?.length && batch.length) break;
      const item = queue.shift();
      batch.push(item.embed);
      if (item.files?.length) {
        files = item.files;
        break;
      }
    }
    try {
      const ch = await client.channels.fetch(L.channelId).catch(() => null);
      if (ch?.isTextBased()) await ch.send({ embeds: batch, files, allowedMentions: { parse: [] } });
    } catch (e) {
      console.error('[serverlogs]', e.message);
    }
    await new Promise((r) => setTimeout(r, 1100));
  }
  sending = false;
}

function send(embed, files) {
  embed.setTimestamp();
  queue.push({ embed, files });
  flush();
}

const E = (color, title) => new EmbedBuilder().setColor(color).setTitle(title);
const t = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;
const cut = (s, n = 1000) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
const code = (s) => cut(String(s).replace(/```/g, 'ˋˋˋ'), 1000) || '—';
const ignored = (channelId) => channelId === L.channelId || L.ignoreChannels.includes(channelId);

/* ---------- Formateo de cambios del registro de auditoría ---------- */
function permDiff(oldV, newV) {
  const o = new PermissionsBitField(BigInt(oldV ?? 0));
  const n = new PermissionsBitField(BigInt(newV ?? 0));
  const added = n.toArray().filter((p) => !o.has(p));
  const removed = o.toArray().filter((p) => !n.has(p));
  const out = [];
  if (added.length) out.push(`✅ ${added.join(', ')}`);
  if (removed.length) out.push(`❌ ${removed.join(', ')}`);
  return out.join('\n');
}

const hex = (v) => (v ? `#${Number(v).toString(16).padStart(6, '0')}` : 'ninguno');
const yn = (v) => (v ? 'sí' : 'no');
const SKIP_KEYS = new Set(['permission_overwrites', 'position', 'id', 'type', 'flags', 'permissions_new', 'available', 'guild_id', 'inviter_id', 'uses', 'channel_id', 'application_id', 'default_reaction_emoji', 'available_tags', 'theme_colors', 'colors']);

function renderChange(c, entry) {
  const { key, old: o, new: n } = c;
  if (SKIP_KEYS.has(key)) return null;
  switch (key) {
    case 'name':
      return `**Nombre:** ${o ?? '—'} → ${n ?? '—'}`;
    case 'color':
      return `**Color:** ${hex(o)} → ${hex(n)}`;
    case 'icon_hash':
      return `**Icono:** ${o ? 'cambiado' : 'añadido'}${n ? '' : ' (quitado)'}`;
    case 'unicode_emoji':
      return `**Emoji del rol:** ${o || 'ninguno'} → ${n || 'ninguno'}`;
    case 'permissions':
      return `**Permisos:**\n${permDiff(o, n) || 'sin cambios'}`;
    case 'allow':
      return permDiff(o, n) ? `**Permitidos:**\n${permDiff(o, n)}` : null;
    case 'deny':
      return permDiff(o, n) ? `**Denegados:**\n${permDiff(o, n)}` : null;
    case 'hoist':
      return `**Mostrar separado:** ${yn(o)} → ${yn(n)}`;
    case 'mentionable':
      return `**Mencionable:** ${yn(o)} → ${yn(n)}`;
    case 'topic':
      return `**Tema:** ${cut(o, 200) || '—'} → ${cut(n, 200) || '—'}`;
    case 'nsfw':
      return `**NSFW:** ${yn(o)} → ${yn(n)}`;
    case 'rate_limit_per_user':
      return `**Modo lento:** ${o || 0}s → ${n || 0}s`;
    case 'bitrate':
      return `**Bitrate:** ${(o || 0) / 1000}kbps → ${(n || 0) / 1000}kbps`;
    case 'user_limit':
      return `**Límite de usuarios:** ${o || '∞'} → ${n || '∞'}`;
    case 'nick':
      return `**Apodo:** ${o || '—'} → ${n || '—'}`;
    case 'communication_disabled_until':
      return n ? `**Aislado hasta:** ${t(Date.parse(n), 'f')} (${t(Date.parse(n))})` : '**Aislamiento quitado**';
    case 'mute':
      return `**Silenciado en voz:** ${yn(o)} → ${yn(n)}`;
    case 'deaf':
      return `**Ensordecido:** ${yn(o)} → ${yn(n)}`;
    case 'avatar_hash':
      return '**Avatar del server cambiado**';
    case 'banner_hash':
      return '**Banner cambiado**';
    case 'splash_hash':
      return '**Fondo de invitación cambiado**';
    case 'vanity_url_code':
      return `**URL personalizada:** ${o || '—'} → ${n || '—'}`;
    case 'description':
      return `**Descripción:** ${cut(o, 200) || '—'} → ${cut(n, 200) || '—'}`;
    case 'code':
      return `**Código:** ${n ?? o}`;
    case 'max_uses':
      return `**Usos máximos:** ${n ?? o ?? '∞'}`;
    case 'max_age':
      return `**Expira en:** ${(n ?? o) ? `${(n ?? o) / 3600} h` : 'nunca'}`;
    case 'temporary':
      return null;
    default:
      if (key.startsWith('$')) return null;
      return `**${key}:** ${cut(JSON.stringify(o ?? '—'), 150)} → ${cut(JSON.stringify(n ?? '—'), 150)}`;
  }
}

function targetText(entry, guild) {
  const id = entry.targetId;
  const name = entry.changes.find((c) => c.key === 'name');
  const nm = name?.new ?? name?.old ?? entry.target?.name;
  switch (entry.targetType) {
    case 'Channel':
    case 'Thread':
      return guild.channels.cache.has(id) ? `<#${id}> (\`${nm || id}\`)` : `#${nm || id}`;
    case 'Role':
      return guild.roles.cache.has(id) ? `<@&${id}> (\`${nm || id}\`)` : `@${nm || id}`;
    case 'User':
      return `<@${id}> (\`${entry.target?.tag || entry.target?.username || id}\`)`;
    case 'Emoji':
      return `:${nm || entry.target?.name || id}:`;
    case 'Invite':
      return `\`${entry.target?.code || entry.changes.find((c) => c.key === 'code')?.new || entry.changes.find((c) => c.key === 'code')?.old || '?'}\``;
    case 'Guild':
      return 'el servidor';
    default:
      return nm ? `\`${nm}\`` : id ? `\`${id}\`` : '';
  }
}

const ACTIONS = {
  [A.ChannelCreate]: [C.green, '📁 Canal creado'],
  [A.ChannelUpdate]: [C.yellow, '📁 Canal editado'],
  [A.ChannelDelete]: [C.red, '📁 Canal eliminado'],
  [A.ChannelOverwriteCreate]: [C.yellow, '🔐 Permisos de canal añadidos'],
  [A.ChannelOverwriteUpdate]: [C.yellow, '🔐 Permisos de canal editados'],
  [A.ChannelOverwriteDelete]: [C.yellow, '🔐 Permisos de canal quitados'],
  [A.RoleCreate]: [C.green, '🏷️ Rol creado'],
  [A.RoleUpdate]: [C.yellow, '🏷️ Rol editado'],
  [A.RoleDelete]: [C.red, '🏷️ Rol eliminado'],
  [A.MemberRoleUpdate]: [C.blue, '🎭 Roles de miembro'],
  [A.MemberUpdate]: [C.blue, '👤 Miembro editado'],
  [A.MemberKick]: [C.red, '👢 Miembro expulsado'],
  [A.MemberBanAdd]: [C.red, '🔨 Miembro baneado'],
  [A.MemberBanRemove]: [C.green, '🔓 Ban quitado'],
  [A.MemberPrune]: [C.red, '🧹 Limpieza de miembros'],
  [A.MemberMove]: [C.blue, '🔀 Miembros movidos de voz'],
  [A.MemberDisconnect]: [C.orange, '🔌 Miembros desconectados de voz'],
  [A.BotAdd]: [C.purple, '🤖 Bot añadido'],
  [A.GuildUpdate]: [C.purple, '🏠 Servidor editado'],
  [A.EmojiCreate]: [C.green, '😀 Emoji creado'],
  [A.EmojiUpdate]: [C.yellow, '😀 Emoji editado'],
  [A.EmojiDelete]: [C.red, '😀 Emoji eliminado'],
  [A.StickerCreate]: [C.green, '🖼️ Sticker creado'],
  [A.StickerUpdate]: [C.yellow, '🖼️ Sticker editado'],
  [A.StickerDelete]: [C.red, '🖼️ Sticker eliminado'],
  [A.InviteCreate]: [C.green, '🔗 Invitación creada'],
  [A.InviteDelete]: [C.red, '🔗 Invitación eliminada'],
  [A.WebhookCreate]: [C.purple, '🪝 Webhook creado'],
  [A.WebhookUpdate]: [C.yellow, '🪝 Webhook editado'],
  [A.WebhookDelete]: [C.red, '🪝 Webhook eliminado'],
  [A.ThreadCreate]: [C.green, '🧵 Hilo creado'],
  [A.ThreadUpdate]: [C.yellow, '🧵 Hilo editado'],
  [A.ThreadDelete]: [C.red, '🧵 Hilo eliminado'],
  [A.MessagePin]: [C.blue, '📌 Mensaje fijado'],
  [A.MessageUnpin]: [C.gray, '📌 Mensaje desfijado'],
  [A.MessageBulkDelete]: [C.red, '🗑️ Mensajes borrados en masa'],
  [A.IntegrationCreate]: [C.purple, '🧩 Integración añadida'],
  [A.IntegrationDelete]: [C.red, '🧩 Integración quitada'],
};

// Borrados de mensajes por moderadores (para decir quién borró)
const modDeletes = []; // { executorId, targetId, channelId, t }

async function onAudit(entry, guild) {
  if (guild.id !== cfg.guildId) return;
  if (entry.action === A.MessageDelete) {
    modDeletes.push({ executorId: entry.executorId, targetId: entry.targetId, channelId: entry.extra?.channel?.id, t: Date.now() });
    while (modDeletes.length > 50) modDeletes.shift();
    return;
  }
  const meta = ACTIONS[entry.action];
  if (!meta) return;

  const lines = [];
  let thumb = null;

  if (entry.action === A.MemberRoleUpdate) {
    const add = entry.changes.find((c) => c.key === '$add')?.new || [];
    const rem = entry.changes.find((c) => c.key === '$remove')?.new || [];
    add.forEach((r) => lines.push(`➕ <@&${r.id}> (\`${r.name}\`)`));
    rem.forEach((r) => lines.push(`➖ <@&${r.id}> (\`${r.name}\`)`));
  } else if ([A.MemberMove, A.MemberDisconnect].includes(entry.action)) {
    lines.push(`**Cantidad:** ${entry.extra?.count ?? '?'}`);
    if (entry.extra?.channel) lines.push(`**Canal:** <#${entry.extra.channel.id}>`);
  } else if ([A.MessagePin, A.MessageUnpin].includes(entry.action)) {
    lines.push(`**Canal:** <#${entry.extra?.channel?.id}> • [ir al mensaje](https://discord.com/channels/${guild.id}/${entry.extra?.channel?.id}/${entry.extra?.messageId})`);
  } else if (entry.action === A.MessageBulkDelete) {
    lines.push(`**Cantidad:** ${entry.extra?.count ?? '?'}`);
  } else if (entry.action === A.MemberPrune) {
    lines.push(`**Expulsados:** ${entry.extra?.removed ?? '?'} • inactivos ${entry.extra?.days ?? '?'} días`);
  } else if (/creado|creada|eliminado|eliminada|añadido/.test(meta[1])) {
    // crear/borrar: el objetivo ya muestra el nombre; solo datos útiles (sin "→ —")
    for (const c of entry.changes) {
      const v = c.new ?? c.old;
      if (v === undefined || v === null || v === '' || SKIP_KEYS.has(c.key) || c.key === 'name') continue;
      if (c.key === 'type' && entry.targetType === 'Channel') continue;
      if (c.key === 'topic') lines.push(`**Tema:** ${cut(v, 200)}`);
      else if (c.key === 'permissions' && v !== '0') lines.push(`**Permisos:** ${new PermissionsBitField(BigInt(v)).toArray().join(', ') || 'ninguno'}`);
      else if (c.key === 'color' && v) lines.push(`**Color:** ${hex(v)}`);
      else if (c.key === 'user_limit' && v) lines.push(`**Límite de usuarios:** ${v}`);
      else if (c.key === 'code') lines.push(`**Código:** \`${v}\``);
      else if (c.key === 'max_uses') lines.push(`**Usos máximos:** ${v || '∞'}`);
      else if (c.key === 'max_age') lines.push(`**Expira en:** ${v ? `${v / 3600} h` : 'nunca'}`);
    }
  } else {
    for (const c of entry.changes) {
      const r = renderChange(c, entry);
      if (r) lines.push(r);
    }
    // nada importante cambió (ej. solo posición) → no registrar
    if (!lines.length && /editado|editados/.test(meta[1])) return;
  }

  if ([A.ChannelOverwriteCreate, A.ChannelOverwriteUpdate, A.ChannelOverwriteDelete].includes(entry.action)) {
    const ex = entry.extra;
    const who = ex ? (ex.user || ex.tag ? `<@${ex.id}>` : ex.id === guild.id ? '@everyone' : `<@&${ex.id}>`) : '?';
    lines.unshift(`**Para:** ${who}`);
  }

  if (entry.targetType === 'Role' && entry.changes.some((c) => c.key === 'icon_hash')) {
    thumb = guild.roles.cache.get(entry.targetId)?.iconURL({ size: 128 }) || null;
  }
  if (entry.targetType === 'Guild' && entry.changes.some((c) => c.key === 'icon_hash')) thumb = guild.iconURL({ size: 256 });
  if (entry.targetType === 'User') thumb = entry.target?.displayAvatarURL?.({ size: 128 }) || null;

  const embed = E(meta[0], meta[1]).setDescription(cut(`**Objetivo:** ${targetText(entry, guild)}\n**Por:** ${entry.executorId ? `<@${entry.executorId}>` : 'desconocido'}${entry.reason ? `\n**Razón:** ${cut(entry.reason, 300)}` : ''}${lines.length ? `\n\n${lines.join('\n')}` : ''}`, 4000));
  if (thumb) embed.setThumbnail(thumb);
  embed.setFooter({ text: `ID: ${entry.targetId || '—'}` });
  send(embed);
}

/* ---------- Invitaciones (saber con qué invite entró alguien) ---------- */
const inviteUses = new Map();
let vanityUses = 0;

async function cacheInvites(guild) {
  const invites = await guild.invites.fetch().catch(() => null);
  if (invites) {
    inviteUses.clear();
    invites.forEach((i) => inviteUses.set(i.code, { uses: i.uses ?? 0, inviter: i.inviterId }));
  }
  const vanity = await guild.fetchVanityData().catch(() => null);
  if (vanity) vanityUses = vanity.uses;
}

async function findUsedInvite(guild) {
  const invites = await guild.invites.fetch().catch(() => null);
  let used = null;
  if (invites) {
    for (const i of invites.values()) {
      const prev = inviteUses.get(i.code);
      if ((i.uses ?? 0) > (prev?.uses ?? 0)) used = { code: i.code, inviter: i.inviterId, uses: i.uses };
    }
    // invitaciones de 1 uso desaparecen al usarse
    if (!used) {
      for (const [codeKey, v] of inviteUses) if (!invites.has(codeKey)) used = { code: codeKey, inviter: v.inviter, uses: v.uses + 1, gone: true };
    }
    inviteUses.clear();
    invites.forEach((i) => inviteUses.set(i.code, { uses: i.uses ?? 0, inviter: i.inviterId }));
  }
  if (!used) {
    const vanity = await guild.fetchVanityData().catch(() => null);
    if (vanity && vanity.uses > vanityUses) used = { code: vanity.code, vanity: true, uses: vanity.uses };
    if (vanity) vanityUses = vanity.uses;
  }
  return used;
}

// Nombres de canales de voz (los temporales se borran y quedan como "unknown")
const voiceNames = new Map();

/* ---------- Eventos ---------- */
function init(c) {
  client = c;

  client.on(Events.GuildAuditLogEntryCreate, (entry, guild) => onAudit(entry, guild).catch((e) => console.error('[serverlogs]', e)));

  client.on(Events.InviteCreate, (i) => i.guild?.id === cfg.guildId && inviteUses.set(i.code, { uses: i.uses ?? 0, inviter: i.inviterId }));
  client.on(Events.InviteDelete, (i) => i.guild?.id === cfg.guildId && setTimeout(() => inviteUses.delete(i.code), 3000));

  // Entradas
  client.on(Events.GuildMemberAdd, async (m) => {
    if (m.guild.id !== cfg.guildId) return;
    const age = Date.now() - m.user.createdTimestamp;
    const inv = await findUsedInvite(m.guild).catch(() => null);
    const invText = inv
      ? inv.vanity
        ? `URL personalizada \`${inv.code}\``
        : `\`${inv.code}\` de ${inv.inviter ? `<@${inv.inviter}>` : 'desconocido'} (${inv.uses} usos)${inv.gone ? ' — invitación de un solo uso' : ''}`
      : 'desconocida';
    send(
      E(C.green, m.user.bot ? '🤖 Bot entró' : '📥 Miembro entró')
        .setThumbnail(m.user.displayAvatarURL({ size: 128 }))
        .setDescription(`${m} (\`${m.user.tag}\`)`)
        .addFields(
          { name: 'Cuenta creada', value: `${t(m.user.createdTimestamp, 'D')} (${t(m.user.createdTimestamp)})${age < 7 * DAY ? '\n⚠️ **Cuenta nueva**' : ''}`, inline: true },
          { name: 'Invitación', value: invText, inline: true },
          { name: 'Miembros', value: String(m.guild.memberCount), inline: true }
        )
        .setFooter({ text: `ID: ${m.id}` })
    );
  });

  // Salidas
  client.on(Events.GuildMemberRemove, (m) => {
    if (m.guild.id !== cfg.guildId) return;
    const roles = m.roles?.cache.filter((r) => r.id !== m.guild.id).map((r) => `<@&${r.id}>`) || [];
    send(
      E(C.red, m.user?.bot ? '🤖 Bot salió' : '📤 Miembro salió')
        .setThumbnail(m.user?.displayAvatarURL({ size: 128 }) || null)
        .setDescription(`${m} (\`${m.user?.tag || m.id}\`)`)
        .addFields(
          { name: 'Estuvo desde', value: m.joinedTimestamp ? `${t(m.joinedTimestamp, 'D')} (${t(m.joinedTimestamp)})` : 'desconocido', inline: true },
          { name: 'Miembros', value: String(m.guild.memberCount), inline: true },
          { name: `Roles (${roles.length})`, value: cut(roles.join(' '), 1000) || 'ninguno' }
        )
        .setFooter({ text: `ID: ${m.id}` })
    );
  });

  // Cambios de perfil (nombre, avatar) y boosts
  client.on(Events.GuildMemberUpdate, (o, n) => {
    if (n.guild.id !== cfg.guildId || o.partial) return;
    if (o.avatar !== n.avatar) {
      send(E(C.blue, '🖼️ Avatar del server cambiado').setDescription(`${n} (\`${n.user.tag}\`)`).setThumbnail(n.displayAvatarURL({ size: 256 })).setFooter({ text: `ID: ${n.id}` }));
    }
    if (!o.premiumSince && n.premiumSince) send(E(0xff73fa, '💎 Nuevo boost').setDescription(`${n} empezó a boostear el server`).setFooter({ text: `ID: ${n.id}` }));
    if (o.premiumSince && !n.premiumSince) send(E(C.gray, '💎 Boost terminado').setDescription(`${n} dejó de boostear`).setFooter({ text: `ID: ${n.id}` }));
  });

  client.on(Events.UserUpdate, (o, n) => {
    const guild = client.guilds.cache.get(cfg.guildId);
    if (!guild?.members.cache.has(n.id) || o.partial) return;
    const lines = [];
    if (o.username !== n.username) lines.push(`**Usuario:** ${o.username} → ${n.username}`);
    if (o.globalName !== n.globalName) lines.push(`**Nombre visible:** ${o.globalName || '—'} → ${n.globalName || '—'}`);
    if (o.avatar !== n.avatar) lines.push('**Avatar cambiado**');
    if (!lines.length) return;
    send(E(C.blue, '👤 Perfil actualizado').setDescription(`<@${n.id}>\n\n${lines.join('\n')}`).setThumbnail(n.displayAvatarURL({ size: 128 })).setFooter({ text: `ID: ${n.id}` }));
  });

  // Mensajes borrados
  client.on(Events.MessageDelete, (msg) => {
    if (msg.guildId !== cfg.guildId || ignored(msg.channelId) || msg.author?.bot) return;
    const mod = modDeletes.find((d) => d.channelId === msg.channelId && d.targetId === msg.author?.id && Date.now() - d.t < 8000);
    const embed = E(C.red, '🗑️ Mensaje borrado').setDescription(
      `**Autor:** ${msg.author ? `<@${msg.author.id}> (\`${msg.author.tag}\`)` : 'desconocido (no estaba en caché)'}\n**Canal:** <#${msg.channelId}>${mod ? `\n**Borrado por:** <@${mod.executorId}>` : ''}`
    );
    if (msg.partial || msg.content == null) embed.addFields({ name: 'Contenido', value: '*No estaba en caché (mensaje viejo o de antes de reiniciar el bot)*' });
    else if (msg.content) embed.addFields({ name: 'Contenido', value: code(msg.content) });
    if (msg.attachments?.size) embed.addFields({ name: 'Archivos', value: cut(msg.attachments.map((a) => `[${a.name}](${a.proxyURL})`).join('\n'), 1000) });
    if (msg.stickers?.size) embed.addFields({ name: 'Stickers', value: msg.stickers.map((s) => s.name).join(', ') });
    embed.setFooter({ text: `Mensaje ${msg.id}${msg.author ? ` • Usuario ${msg.author.id}` : ''}` });
    send(embed);
  });

  client.on(Events.MessageBulkDelete, (msgs, channel) => {
    if (channel.guildId !== cfg.guildId || ignored(channel.id)) return;
    const lines = [...msgs.values()]
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map((m) => `[${new Date(m.createdTimestamp).toISOString().slice(0, 19).replace('T', ' ')}] ${m.author?.tag || '?'}: ${m.content ?? '(no en caché)'}`);
    send(E(C.red, '🗑️ Mensajes borrados en masa').setDescription(`**Canal:** ${channel}\n**Cantidad:** ${msgs.size}`), [
      new AttachmentBuilder(Buffer.from(lines.join('\n'), 'utf8'), { name: `borrados-${channel.name}.txt` }),
    ]);
  });

  // Mensajes editados
  client.on(Events.MessageUpdate, (o, n) => {
    if (n.guildId !== cfg.guildId || ignored(n.channelId) || n.author?.bot) return;
    if (!o.partial && o.content === n.content) return; // solo cargó un embed
    if (n.content == null) return;
    send(
      E(C.yellow, '✏️ Mensaje editado')
        .setDescription(`**Autor:** <@${n.author.id}> (\`${n.author.tag}\`)\n**Canal:** <#${n.channelId}> • [ir al mensaje](${n.url})`)
        .addFields({ name: 'Antes', value: o.partial || o.content == null ? '*No estaba en caché*' : code(o.content) }, { name: 'Después', value: code(n.content) })
        .setFooter({ text: `Usuario ${n.author.id}` })
    );
  });

  // Voz
  client.on(Events.VoiceStateUpdate, (o, n) => {
    if (n.guild.id !== cfg.guildId) return;
    const who = `<@${n.id}> (\`${n.member?.user.tag || n.id}\`)`;
    const vc = (state) => (state.channel ? `<#${state.channelId}> (\`${state.channel.name}\`)` : `\`${voiceNames.get(state.channelId) || state.channelId}\``);
    if (n.channel) voiceNames.set(n.channelId, n.channel.name);
    if (!o.channelId && n.channelId) send(E(C.green, '🔊 Entró a voz').setDescription(`${who}\n**Canal:** ${vc(n)}`).setFooter({ text: `ID: ${n.id}` }));
    else if (o.channelId && !n.channelId) send(E(C.red, '🔇 Salió de voz').setDescription(`${who}\n**Canal:** ${vc(o)}${o.channel ? '' : ' *(ya borrado)*'}`).setFooter({ text: `ID: ${n.id}` }));
    else if (o.channelId !== n.channelId) send(E(C.blue, '🔀 Cambió de canal de voz').setDescription(`${who}\n${vc(o)} → ${vc(n)}`).setFooter({ text: `ID: ${n.id}` }));
    else if (!o.streaming && n.streaming) send(E(C.purple, '📺 Empezó a transmitir').setDescription(`${who}\n**Canal:** <#${n.channelId}>`).setFooter({ text: `ID: ${n.id}` }));
  });
}

async function start(guild) {
  await cacheInvites(guild);
  console.log(`[serverlogs] Activo en ${L.channelId} (${inviteUses.size} invitaciones en caché)`);
}

module.exports = { init, start };
