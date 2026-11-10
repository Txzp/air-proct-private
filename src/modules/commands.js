const { Events, SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags } = require('discord.js');
const cfg = require('../config');
const store = require('../store');
const { isOwner, isTrusted, protectedRoleIds } = require('../trust');
const { log } = require('../logger');
const antiraid = require('./antiraid');
const warns = require('./warns');
const mj = require('./mj');
const giveaway = require('./giveaway');

const defs = [
  new SlashCommandBuilder()
    .setName('whitelist')
    .setDescription('Gestiona usuarios/bots de confianza (ignorados por el anti-nuke)')
    .addSubcommand((s) => s.setName('add').setDescription('Añadir a la whitelist').addUserOption((o) => o.setName('usuario').setDescription('Usuario o bot').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Quitar de la whitelist').addUserOption((o) => o.setName('usuario').setDescription('Usuario o bot').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('Ver la whitelist')),
  new SlashCommandBuilder().setName('lockdown').setDescription('Bloquea todos los canales de texto').addStringOption((o) => o.setName('motivo').setDescription('Motivo')),
  new SlashCommandBuilder().setName('unlock').setDescription('Quita el bloqueo de canales'),
  new SlashCommandBuilder()
    .setName('raidmode')
    .setDescription('Activa o desactiva el modo raid manualmente')
    .addStringOption((o) => o.setName('estado').setDescription('on / off').setRequired(true).addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })),
  new SlashCommandBuilder().setName('strikes').setDescription('Ver las oportunidades de spam de alguien').addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true)),
  new SlashCommandBuilder().setName('resetstrikes').setDescription('Reinicia las oportunidades de spam').addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true)),
  new SlashCommandBuilder().setName('status').setDescription('Estado de AirProtect'),
].map((c) => c.setDefaultMemberPermissions(PermissionFlagsBits.Administrator).toJSON())
  .concat(warns.defs, mj.defs, giveaway.defs); // /warn, /warns, /clearwarns: visibles para el staff (se valida por rol)

const LOCK_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildVoice];

function prevState(ch, id) {
  const ow = ch.permissionOverwrites.cache.get(id);
  if (!ow) return null;
  if (ow.allow.has(PermissionFlagsBits.SendMessages)) return true;
  if (ow.deny.has(PermissionFlagsBits.SendMessages)) return false;
  return null;
}

async function lockdown(guild, reason) {
  const saved = {};
  const targets = [guild.id, ...protectedRoleIds()];
  for (const ch of guild.channels.cache.values()) {
    if (!LOCK_TYPES.includes(ch.type)) continue;
    saved[ch.id] = {};
    for (const t of targets) {
      if (t !== guild.id && !ch.permissionOverwrites.cache.has(t)) continue;
      saved[ch.id][t] = prevState(ch, t);
      await ch.permissionOverwrites.edit(t, { SendMessages: false }, { reason }).catch(() => {});
    }
  }
  store.data.lockdown = saved;
  store.save();
  return Object.keys(saved).length;
}

async function unlock(guild) {
  const saved = store.data.lockdown || {};
  let n = 0;
  for (const [chId, perms] of Object.entries(saved)) {
    const ch = guild.channels.cache.get(chId);
    if (!ch) continue;
    for (const [t, v] of Object.entries(perms)) await ch.permissionOverwrites.edit(t, { SendMessages: v }, { reason: 'AirProtect: unlock' }).catch(() => {});
    n++;
  }
  store.data.lockdown = null;
  store.save();
  return n;
}

async function onInteraction(i) {
  if (!i.isChatInputCommand() || i.guildId !== cfg.guildId) return;
  const guild = i.guild;
  const reply = (content, ephemeral = true) => i.reply({ content, flags: ephemeral ? MessageFlags.Ephemeral : undefined });

  if (warns.names.includes(i.commandName)) return warns.handle(i);
  if (mj.names.includes(i.commandName)) return mj.handle(i);
  if (giveaway.names.includes(i.commandName)) return giveaway.handle(i);
  if (!isTrusted(guild, i.user.id)) return reply('🛡️ Solo el dueño y la whitelist pueden usar AirProtect.');

  switch (i.commandName) {
    case 'whitelist': {
      const sub = i.options.getSubcommand();
      if (sub === 'list') {
        const ids = [...new Set([...cfg.whitelist, ...store.data.whitelist])];
        return reply(ids.length ? ids.map((id) => `• <@${id}> \`${id}\``).join('\n') : 'La whitelist está vacía (solo el dueño es de confianza).');
      }
      if (!isOwner(guild, i.user.id)) return reply('Solo el dueño del server / del bot puede cambiar la whitelist.');
      const u = i.options.getUser('usuario');
      if (sub === 'add') {
        if (!store.data.whitelist.includes(u.id)) store.data.whitelist.push(u.id);
        store.save();
        log('info', 'Whitelist', `${i.user} añadió a ${u} (\`${u.id}\`).`);
        return reply(`✅ ${u} ahora es de confianza.`);
      }
      store.data.whitelist = store.data.whitelist.filter((x) => x !== u.id);
      store.save();
      log('info', 'Whitelist', `${i.user} quitó a ${u} (\`${u.id}\`).`);
      return reply(`🗑️ ${u} ya no está en la whitelist.`);
    }
    case 'lockdown': {
      await i.deferReply();
      const motivo = i.options.getString('motivo') || 'Sin motivo';
      const n = await lockdown(guild, `AirProtect lockdown: ${motivo}`);
      log('danger', 'LOCKDOWN', `${i.user} bloqueó ${n} canales. Motivo: ${motivo}`);
      return i.editReply(`🔒 Server bloqueado (${n} canales). Usa \`/unlock\` para abrir.`);
    }
    case 'unlock': {
      await i.deferReply();
      const n = await unlock(guild);
      log('ok', 'Unlock', `${i.user} desbloqueó ${n} canales.`);
      return i.editReply(`🔓 Canales desbloqueados (${n}).`);
    }
    case 'raidmode': {
      const on = i.options.getString('estado') === 'on';
      antiraid.setRaid(on, `manual por ${i.user.tag}`);
      return reply(on ? '🚨 Modo raid activado.' : '✅ Modo raid desactivado.', false);
    }
    case 'strikes': {
      const u = i.options.getUser('usuario');
      const rec = store.data.strikes[u.id];
      return reply(rec ? `${u}: **${rec.count}** veces (última <t:${Math.floor(rec.last / 1000)}:R>).` : `${u} no tiene strikes.`);
    }
    case 'resetstrikes': {
      const u = i.options.getUser('usuario');
      delete store.data.strikes[u.id];
      store.save();
      return reply(`♻️ Strikes de ${u} reiniciados.`);
    }
    case 'status': {
      const me = guild.members.me;
      const top = me.roles.highest;
      const higher = guild.roles.cache.filter((r) => r.position > top.position && !cfg.trustedRoles.includes(r.id) && !r.managed).size;
      const e = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🛡️ AirProtect — estado')
        .addFields(
          { name: 'Ping', value: `${i.client.ws.ping} ms`, inline: true },
          { name: 'Encendido', value: `<t:${Math.floor((Date.now() - i.client.uptime) / 1000)}:R>`, inline: true },
          { name: 'Modo raid', value: antiraid.raidActive() ? '🚨 activo' : 'apagado', inline: true },
          { name: 'Lockdown', value: store.data.lockdown ? '🔒 activo' : 'no', inline: true },
          { name: 'Whitelist', value: String(new Set([...cfg.whitelist, ...store.data.whitelist]).size), inline: true },
          { name: 'Administrador', value: me.permissions.has(PermissionFlagsBits.Administrator) ? '✅' : '❌ (dámelo)', inline: true },
          { name: 'Posición de mi rol', value: higher === 0 ? '✅ Arriba del todo' : `⚠️ Hay ${higher} roles encima de mí — súbeme al tope` }
        );
      return i.reply({ embeds: [e], flags: MessageFlags.Ephemeral });
    }
  }
}

async function register(guild) {
  await guild.commands.set(defs);
}

function init(client) {
  client.on(Events.InteractionCreate, (i) =>
    onInteraction(i).catch((e) => {
      console.error('[commands]', e);
      if (i.isRepliable() && !i.replied) i.reply({ content: `❌ ${e.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    })
  );
}

module.exports = { init, register };
