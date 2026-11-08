const {
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits: P,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const cfg = require('../config');
const { currentLogChannelId } = require('../logger');

const T = cfg.tickets;
const TOPIC = 'ticket:'; // el topic del canal guarda quién lo abrió → no depende del disco
const busy = new Set(); // evita doble click creando 2 tickets

function staffRoleIds(guild) {
  const byName = guild.roles.cache.filter((r) => T.staffRoleNames.includes(r.name)).map((r) => r.id);
  return [...new Set([...T.staffRoles.filter((id) => guild.roles.cache.has(id)), ...byName])];
}

function isStaff(member) {
  if (!member) return false;
  if (member.id === member.guild.ownerId || member.permissions.has(P.Administrator)) return true;
  return staffRoleIds(member.guild).some((r) => member.roles.cache.has(r));
}

function openTickets(guild) {
  return guild.channels.cache.filter((c) => c.parentId === T.categoryId && c.topic?.startsWith(TOPIC));
}

function slug(name) {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w-]/g, '')
      .replace(/_+/g, '-')
      .slice(0, 80) || 'user'
  );
}

/* ---------- Panel ---------- */
function panelPayload() {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🎫 Soporte — Abrir ticket')
    .setDescription(
      '¿Necesitas ayuda, reportar a alguien o hablar con el staff?\nDale al botón de abajo y se abrirá un canal privado solo para ti y el staff.'
    )
    .setFooter({ text: 'AirProtect • Tickets' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tk_open').setLabel('Abrir ticket').setEmoji('🎫').setStyle(ButtonStyle.Primary)
  );
  return { embeds: [embed], components: [row] };
}

async function ensurePanel(guild) {
  const ch = await guild.channels.fetch(T.panelChannelId).catch(() => null);
  if (!ch?.isTextBased()) return console.error('[tickets] No encuentro el canal del panel', T.panelChannelId);
  const msgs = await ch.messages.fetch({ limit: 30 }).catch(() => null);
  const existing = msgs?.find(
    (m) => m.author.id === guild.client.user.id && m.components.some((r) => r.components.some((c) => c.customId === 'tk_open'))
  );
  if (existing) return;
  await ch.send(panelPayload());
  console.log('[tickets] Panel enviado');
}

/* ---------- Abrir ---------- */
async function openTicket(i) {
  const guild = i.guild;
  if (busy.has(i.user.id)) return i.reply({ content: '⏳ Ya estoy creando tu ticket...', flags: MessageFlags.Ephemeral });
  busy.add(i.user.id);
  try {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const mine = openTickets(guild).find((c) => c.topic === TOPIC + i.user.id);
    if (mine) return i.editReply(`Ya tienes un ticket abierto: ${mine}`);

    // número más bajo libre entre los tickets abiertos (01, 02, ...)
    const used = new Set(openTickets(guild).map((c) => Number(c.name.split('-').pop())));
    let n = 1;
    while (used.has(n)) n++;
    const number = String(n).padStart(2, '0');
    const staff = staffRoleIds(guild);
    const allow = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];

    const ch = await guild.channels.create({
      name: `${slug(i.user.username)}-${number}`,
      type: ChannelType.GuildText,
      parent: T.categoryId,
      topic: TOPIC + i.user.id,
      permissionOverwrites: [
        { id: guild.id, deny: [P.ViewChannel] },
        { id: i.user.id, allow },
        { id: guild.client.user.id, allow: [...allow, P.ManageChannels, P.ManageMessages] },
        ...staff.map((id) => ({ id, allow: [...allow, P.ManageMessages] })),
      ],
      reason: `Ticket de ${i.user.tag}`,
    });

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`🎫 Ticket #${number}`)
      .setDescription(`${i.user} gracias por abrir ticket, en breve alguien del staff te atenderá.\nMientras, explica con detalle en qué te ayudamos.`)
      .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tk_claim').setLabel('Atender').setEmoji('🙋').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('tk_close').setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Danger)
    );
    const msg = await ch.send({
      content: `${i.user} ${staff.map((r) => `<@&${r}>`).join(' ')}`,
      embeds: [embed],
      components: [row],
      allowedMentions: { users: [i.user.id], roles: staff },
    });
    msg.pin().catch(() => {});

    await i.editReply(`✅ Ticket creado: ${ch}`);
  } finally {
    busy.delete(i.user.id);
  }
}

/* ---------- Atender ---------- */
async function claimTicket(i) {
  if (!isStaff(i.member)) return i.reply({ content: '❌ Solo el staff puede atender tickets.', flags: MessageFlags.Ephemeral });
  const row = ActionRowBuilder.from(i.message.components[0]);
  row.components[0].setDisabled(true).setLabel(`Atendido por ${i.member.displayName}`.slice(0, 80));
  await i.update({ components: [row] });
  await i.channel.send(`🙋 ${i.user} va a atender este ticket.`);
}

/* ---------- Cerrar ---------- */
async function askClose(i) {
  if (!isStaff(i.member)) return i.reply({ content: '❌ Solo el staff puede cerrar tickets.', flags: MessageFlags.Ephemeral });
  const modal = new ModalBuilder()
    .setCustomId('tk_close_modal')
    .setTitle('Cerrar ticket')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('¿Quedó solucionado? Explica')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Ej: Solucionado, se le devolvió el rol.')
          .setRequired(true)
          .setMaxLength(1000)
      )
    );
  await i.showModal(modal);
}

async function buildTranscript(ch) {
  const all = [];
  let before;
  for (let n = 0; n < 10; n++) {
    const batch = await ch.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch?.size) break;
    all.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return all
    .reverse()
    .map((m) => {
      const t = new Date(m.createdTimestamp).toISOString().replace('T', ' ').slice(0, 19);
      const files = m.attachments.map((a) => ` [archivo: ${a.url}]`).join('');
      const embeds = m.embeds.map((e) => ` [embed: ${e.title || e.description || ''}]`).join('');
      return `[${t}] ${m.author.tag}: ${m.content}${files}${embeds}`;
    })
    .join('\n');
}

async function closeTicket(i) {
  if (!isStaff(i.member)) return i.reply({ content: '❌ Solo el staff puede cerrar tickets.', flags: MessageFlags.Ephemeral });
  const ch = i.channel;
  const reason = i.fields.getTextInputValue('reason');
  const creatorId = ch.topic?.startsWith(TOPIC) ? ch.topic.slice(TOPIC.length) : null;
  const secs = T.closeDelayMs / 1000;

  await i.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xe74c3c)
        .setDescription(`🔒 Ticket cerrado por ${i.user}.\n**Motivo:** ${reason}\n\nEste canal se elimina en **${secs} segundos**.`),
    ],
  });

  const transcript = await buildTranscript(ch).catch(() => '');
  const logCh = await i.guild.channels.fetch(T.logChannelId || currentLogChannelId()).catch(() => null);
  if (logCh?.isTextBased()) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('🎫 Ticket cerrado')
      .addFields(
        { name: 'Ticket', value: `#${ch.name} (\`${ch.id}\`)`, inline: true },
        { name: 'Creator', value: creatorId ? `<@${creatorId}>` : 'desconocido', inline: true },
        { name: 'Closed By', value: `${i.user}`, inline: true },
        { name: 'Reason', value: reason.slice(0, 1024) }
      )
      .setTimestamp()
      .setFooter({ text: 'AirProtect • Tickets' });
    await logCh
      .send({
        embeds: [embed],
        files: transcript ? [new AttachmentBuilder(Buffer.from(transcript, 'utf8'), { name: `${ch.name}.txt` })] : [],
      })
      .catch((e) => console.error('[tickets] log', e.message));
  }

  setTimeout(() => ch.delete(`Ticket cerrado por ${i.user.tag}`).catch(() => {}), T.closeDelayMs);
}

/* ---------- Init ---------- */
function init(client) {
  client.on(Events.InteractionCreate, (i) => {
    if (i.guildId !== cfg.guildId) return;
    const run = async () => {
      if (i.isButton()) {
        if (i.customId === 'tk_open') return openTicket(i);
        if (i.customId === 'tk_claim') return claimTicket(i);
        if (i.customId === 'tk_close') return askClose(i);
      } else if (i.isModalSubmit() && i.customId === 'tk_close_modal') return closeTicket(i);
    };
    run().catch((e) => {
      console.error('[tickets]', e);
      const msg = { content: `❌ Error: ${e.message}`, flags: MessageFlags.Ephemeral };
      if (i.deferred) i.editReply(msg).catch(() => {});
      else if (!i.replied) i.reply(msg).catch(() => {});
    });
  });
}

module.exports = { init, ensurePanel };
