// Vc temporales propios (reemplazo gratis de TempVoice)
const {
  Events,
  ChannelType,
  PermissionFlagsBits: P,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const cfg = require('../config');
const db = require('../discordStore');
const { isTrusted } = require('../trust');

const T = cfg.tempVc;
const vcs = () => db.get('tempVcs', {}); // channelId -> { ownerId, createdAt, emptySince, panelId }
const creating = new Set();

/* ---------- Canal "Vc Creator" ---------- */
async function ensureCreator(guild) {
  const state = db.get('tempVcCreator', {});
  let ch = state.channelId ? guild.channels.cache.get(state.channelId) : null;
  if (!ch) ch = guild.channels.cache.find((c) => c.type === ChannelType.GuildVoice && c.parentId === T.categoryId && c.name === T.creatorName) || null;
  if (!ch) {
    ch = await guild.channels.create({
      name: T.creatorName,
      type: ChannelType.GuildVoice,
      parent: T.categoryId,
      reason: 'AirProtect: creador de vc',
    });
    console.log('[tempvc] Vc Creator creado', ch.id);
  }
  if (state.channelId !== ch.id) {
    state.channelId = ch.id;
    db.markDirty();
  }
  return ch;
}

const creatorId = () => db.get('tempVcCreator', {}).channelId;

/* ---------- Panel ---------- */
function panel(ownerId, ch) {
  const hidden = ch?.permissionOverwrites.cache.get(ch.guild.id)?.deny.has(P.ViewChannel);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setDescription(`**Vc Own:** <@${ownerId}>\n\n-# Usa \`!vcpanel\` para volver a sacar este panel (solo el owner)\n-# Usa \`!gvc\` para un bot afk`);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tv_name').setEmoji('✏️').setLabel('Nombre / status').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('tv_limit').setEmoji('👥').setLabel('Límite').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tv_hide').setEmoji(hidden ? '👁️' : '🙈').setLabel(hidden ? 'Mostrar' : 'Ocultar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tv_kick').setEmoji('👢').setLabel('Sacar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tv_delete').setEmoji('🗑️').setLabel('Borrar').setStyle(ButtonStyle.Danger)
  );
  // sin content = sin ping
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

async function refreshPanel(ch) {
  const info = vcs()[ch.id];
  if (!info) return;
  const msg = info.panelId ? await ch.messages.fetch(info.panelId).catch(() => null) : null;
  const payload = panel(info.ownerId, ch);
  if (msg) await msg.edit(payload).catch(() => {});
  else {
    const m = await ch.send(payload).catch(() => null);
    if (m) {
      info.panelId = m.id;
      db.markDirty();
    }
  }
}

/* ---------- Crear ---------- */
async function createFor(member) {
  const guild = member.guild;
  // ya tiene uno → lo mandamos ahí
  const existing = Object.entries(vcs()).find(([id, v]) => v.ownerId === member.id && guild.channels.cache.has(id));
  if (existing) {
    await member.voice.setChannel(existing[0]).catch(() => {});
    return;
  }
  if (creating.has(member.id)) return;
  creating.add(member.id);
  try {
    const creator = guild.channels.cache.get(creatorId());
    const ch = await guild.channels.create({
      name: `🎧┆${member.displayName}`.slice(0, 100),
      type: ChannelType.GuildVoice,
      parent: T.categoryId,
      bitrate: creator?.bitrate,
      permissionOverwrites: [
        ...(guild.channels.cache.get(T.categoryId)?.permissionOverwrites.cache.map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield })) || []),
        { id: member.id, allow: [P.ViewChannel, P.Connect, P.Speak, P.Stream, P.UseVAD, P.SendMessages, P.ReadMessageHistory] },
        { id: guild.client.user.id, allow: [P.ViewChannel, P.Connect, P.ManageChannels, P.MoveMembers, P.SendMessages, P.EmbedLinks] },
      ],
      reason: `AirProtect: vc de ${member.user.tag}`,
    });
    vcs()[ch.id] = { ownerId: member.id, createdAt: Date.now(), emptySince: null, panelId: null };
    db.markDirty();
    await member.voice.setChannel(ch).catch(() => {});
    await refreshPanel(ch);
  } catch (e) {
    console.error('[tempvc] crear', e.message);
  } finally {
    creating.delete(member.id);
  }
}

/* ---------- Limpieza de vc vacíos ---------- */
async function deleteIfEmpty(ch) {
  if (!ch || !vcs()[ch.id]) return;
  if (ch.members.size > 0) return; // hay alguien (persona o bot) → se queda
  await ch.delete('AirProtect: vc vacío').catch(() => {});
  delete vcs()[ch.id];
  db.markDirty();
}

async function sweep(guild) {
  for (const id of Object.keys(vcs())) {
    const ch = guild.channels.cache.get(id);
    if (!ch) {
      delete vcs()[id];
      db.markDirty();
      continue;
    }
    await deleteIfEmpty(ch);
  }
}

/* ---------- Botones ---------- */
function canManage(i, info) {
  return info && (i.user.id === info.ownerId || isTrusted(i.guild, i.user.id));
}

async function onInteraction(i) {
  const id = i.customId || '';
  if (!id.startsWith('tv_')) return;
  const ch = i.guild.channels.cache.get(i.channelId);
  const info = vcs()[i.channelId];
  if (!info || !ch) return i.reply({ content: '❌ Este vc ya no está registrado.', flags: MessageFlags.Ephemeral });
  if (!canManage(i, info)) return i.reply({ content: `❌ Solo el dueño del vc (<@${info.ownerId}>) puede usar esto.`, flags: MessageFlags.Ephemeral });

  const everyone = i.guild.id;
  switch (id) {
    case 'tv_name': {
      const modal = new ModalBuilder()
        .setCustomId('tv_name_modal')
        .setTitle('✏️ Tu vc')
        .addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Nombre del vc').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(90).setValue(ch.name.replace(/^🎧┆/, ''))),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('status').setLabel('Status (lo que sale debajo del vc)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(450).setPlaceholder('Ej: jugando Roblox 🎮 (vacío = no se cambia)'))
        );
      return i.showModal(modal);
    }
    case 'tv_name_modal': {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const name = i.fields.getTextInputValue('name').trim();
      const status = i.fields.getTextInputValue('status').trim();
      const out = [];
      if (name && `🎧┆${name}` !== ch.name) {
        await Promise.race([ch.setName(`🎧┆${name}`.slice(0, 100)), new Promise((_, r) => setTimeout(() => r(new Error('limite')), 5000))])
          .then(() => out.push('✅ Nombre cambiado'))
          .catch(() => out.push('⏳ Discord solo deja cambiar el nombre 2 veces cada 10 min, intenta en un rato'));
      }
      if (status) {
        await i.client.rest
          .put(`/channels/${ch.id}/voice-status`, { body: { status } })
          .then(() => out.push(status ? '✅ Status puesto' : '✅ Status quitado'))
          .catch((e) => out.push(`❌ No pude poner el status (${e.message})`));
      }
      return i.editReply(out.join('\n') || 'Sin cambios.');
    }
    case 'tv_limit': {
      const modal = new ModalBuilder()
        .setCustomId('tv_limit_modal')
        .setTitle('👥 Límite de personas')
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('limit').setLabel('Número (0 = sin límite)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2).setValue(String(ch.userLimit || 0))));
      return i.showModal(modal);
    }
    case 'tv_limit_modal': {
      const n = parseInt(i.fields.getTextInputValue('limit'), 10);
      if (Number.isNaN(n) || n < 0 || n > 99) return i.reply({ content: '❌ Pon un número del 0 al 99.', flags: MessageFlags.Ephemeral });
      await ch.setUserLimit(n);
      return i.reply({ content: n ? `👥 Límite: **${n}**` : '👥 Sin límite', flags: MessageFlags.Ephemeral });
    }
    case 'tv_hide': {
      const hidden = ch.permissionOverwrites.cache.get(everyone)?.deny.has(P.ViewChannel);
      await ch.permissionOverwrites.edit(everyone, { ViewChannel: hidden ? null : false });
      await refreshPanel(ch);
      return i.reply({ content: hidden ? '👁️ Vc visible' : '🙈 Vc oculto', flags: MessageFlags.Ephemeral });
    }
    case 'tv_kick':
      return i.reply({
        content: '👢 ¿A quién saco del vc?',
        components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${id}_sel`).setPlaceholder('Elige a alguien').setMaxValues(1))],
        flags: MessageFlags.Ephemeral,
      });
    case 'tv_kick_sel': {
      const target = await i.guild.members.fetch(i.values[0]).catch(() => null);
      if (!target || target.id === info.ownerId || target.user.bot) return i.update({ content: '❌ No puedes sacar a esa persona.', components: [] });
      await ch.permissionOverwrites.edit(target.id, { Connect: false });
      if (target.voice.channelId === ch.id) await target.voice.disconnect('Sacado por el dueño del vc').catch(() => {});
      return i.update({ content: `👢 ${target} fuera y ya no puede volver a entrar.`, components: [] });
    }
    case 'tv_delete':
      await i.reply({ content: '🗑️ Borrando el vc...', flags: MessageFlags.Ephemeral });
      delete vcs()[ch.id];
      db.markDirty();
      return ch.delete(`Borrado por ${i.user.tag}`).catch(() => {});
  }
}

/* ---------- Init ---------- */
async function onMessage(message) {
  if (!message.guild || message.guild.id !== cfg.guildId || message.author.bot) return;
  if ((message.content || '').trim().toLowerCase() !== '!vcpanel') return;
  const vc = message.member?.voice.channel;
  const info = vc && vcs()[vc.id];
  if (!vc || !info) return message.reply({ content: 'ni estas en vc pndj', allowedMentions: { repliedUser: false } }).catch(() => {});
  if (info.ownerId !== message.author.id && !isTrusted(message.guild, message.author.id)) {
    return message.reply({ content: 'ese vc ni es tuyo pndj 😭', allowedMentions: { repliedUser: false } }).catch(() => {});
  }
  const m = await vc.send(panel(info.ownerId, vc)).catch(() => null);
  if (m) {
    info.panelId = m.id;
    db.markDirty();
  }
  if (message.channelId !== vc.id) message.react('✅').catch(() => {});
}

function init(client) {
  client.on(Events.VoiceStateUpdate, (o, n) => {
    if (n.guild.id !== cfg.guildId) return;
    // alguien (persona o bot) salió de un vc temporal → si quedó vacío, se borra
    if (o.channelId && o.channelId !== n.channelId && vcs()[o.channelId]) {
      setTimeout(() => deleteIfEmpty(o.guild.channels.cache.get(o.channelId)).catch(() => {}), 3000);
    }
    if (n.member?.user.bot) return;
    if (n.channelId && n.channelId === creatorId() && o.channelId !== n.channelId) createFor(n.member).catch((e) => console.error('[tempvc]', e));
  });
  client.on(Events.MessageCreate, (m) => onMessage(m).catch((e) => console.error('[tempvc]', e)));
  client.on(Events.ChannelDelete, (ch) => {
    if (vcs()[ch.id]) {
      delete vcs()[ch.id];
      db.markDirty();
    }
  });
  client.on(Events.InteractionCreate, (i) => {
    if (i.guildId !== cfg.guildId || !(i.isButton() || i.isModalSubmit() || i.isUserSelectMenu())) return;
    onInteraction(i).catch((e) => {
      console.error('[tempvc]', e);
      const m = { content: `❌ ${e.message}`, flags: MessageFlags.Ephemeral };
      if (i.deferred) i.editReply(m).catch(() => {});
      else if (!i.replied) i.reply(m).catch(() => {});
    });
  });
}

async function start(guild) {
  const creator = await ensureCreator(guild);
  // quien ya esté esperando en el creador
  for (const m of creator.members.values()) if (!m.user.bot) await createFor(m).catch(() => {});
  await sweep(guild).catch(() => {});
  setInterval(() => sweep(guild).catch((e) => console.error('[tempvc] sweep', e.message)), 60_000).unref();
}

module.exports = { init, start, isTempVc: (id) => Boolean(vcs()[id]) };
