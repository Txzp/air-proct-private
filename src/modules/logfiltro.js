// /logfiltro: pide un usuario + tipo de log y muestra sus logs (solo a quien usa el comando)
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const cfg = require('../config');
const { currentLogChannelId } = require('../logger');
const { isStaff } = require('./tickets');
const { isTrusted } = require('../trust');

// tipo -> palabras clave que deben estar en el título del log
const TYPES = {
  todos: null,
  entradas_salidas: ['entró', 'salió', 'bienvenid', 'se fue'],
  moderacion: ['expulsad', 'banead', 'ban ', 'aislad', 'warn', 'silenci', 'nuke', 'kick', 'timeout'],
  mensajes: ['mensaje'],
  voz: ['voz', 'transmit'],
  roles: ['rol', 'roles'],
  canales: ['canal'],
};

const defs = [
  new SlashCommandBuilder()
    .setName('logfiltro')
    .setDescription('Ver los logs de un usuario')
    .addUserOption((o) => o.setName('usuario').setDescription('De quién quieres ver los logs').setRequired(true))
    .addStringOption((o) =>
      o
        .setName('tipo')
        .setDescription('Qué tipo de log')
        .setRequired(true)
        .addChoices(
          { name: '🗂️ Todos', value: 'todos' },
          { name: '📥 Entradas / salidas', value: 'entradas_salidas' },
          { name: '🔨 Moderación (ban/kick/warn/mute)', value: 'moderacion' },
          { name: '💬 Mensajes (borrados/editados)', value: 'mensajes' },
          { name: '🔊 Voz', value: 'voz' },
          { name: '🏷️ Roles', value: 'roles' },
          { name: '📁 Canales', value: 'canales' }
        )
    )
    .toJSON(),
];
const names = ['logfiltro'];

function matchesUser(embed, id, tag) {
  const d = embed.data.description || '';
  const f = embed.data.footer?.text || '';
  const fields = (embed.data.fields || []).map((x) => `${x.name} ${x.value}`).join(' ');
  const hay = `${d} ${f} ${fields}`;
  return hay.includes(id) || (tag && hay.includes(tag));
}

function matchesType(embed, type) {
  if (type === 'todos' || !TYPES[type]) return true;
  const title = (embed.data.title || '').toLowerCase();
  return TYPES[type].some((k) => title.includes(k));
}

async function scanChannel(guild, channelId, user, type, out, max) {
  const ch = await guild.channels.fetch(channelId).catch(() => null);
  if (!ch?.isTextBased()) return;
  let before;
  for (let n = 0; n < 8 && out.length < max; n++) {
    const batch = await ch.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch?.size) break;
    for (const m of batch.values()) {
      if (m.author.id !== guild.client.user.id) continue;
      for (const e of m.embeds) {
        if (matchesUser(e, user.id, user.tag) && matchesType(e, type)) {
          out.push({ embed: e, at: m.createdTimestamp, url: m.url });
        }
      }
    }
    before = batch.last().id;
    if (batch.size < 100) break;
  }
}

async function handle(i) {
  if (!isStaff(i.member) && !isTrusted(i.guild, i.user.id)) {
    return i.reply({ content: '❌ Solo el staff puede ver los logs de alguien.', flags: MessageFlags.Ephemeral });
  }
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const user = i.options.getUser('usuario');
  const type = i.options.getString('tipo');

  const out = [];
  const MAX = 40;
  // busca en el canal de logs del bot y en el del server
  await scanChannel(i.guild, currentLogChannelId(), user, type, out, MAX).catch(() => {});
  await scanChannel(i.guild, cfg.serverLogs.channelId, user, type, out, MAX).catch(() => {});

  if (!out.length) {
    return i.editReply(`No encontré logs de ${user} para **${type.replace('_', ' / ')}**. (Solo busco en los mensajes recientes de los canales de logs.)`);
  }

  out.sort((a, b) => b.at - a.at);
  const top = out.slice(0, 10);
  const resumen = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🗂️ Logs de ${user.username}`)
    .setDescription(
      `**Tipo:** ${type.replace(/_/g, ' / ')} • **Encontrados:** ${out.length}${out.length > 10 ? ' (mostrando los 10 más recientes)' : ''}\n` +
        top
          .map((x) => `• **${(x.embed.data.title || 'Log').replace(/\n/g, ' ')}** — <t:${Math.floor(x.at / 1000)}:R> · [ir](${x.url})`)
          .join('\n')
    )
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .setFooter({ text: 'AirProtect • Solo tú ves esto' });

  // además los 5 embeds completos más recientes
  const full = top.slice(0, 5).map((x) => EmbedBuilder.from(x.embed));
  return i.editReply({ embeds: [resumen, ...full] });
}

module.exports = { defs, names, handle };
