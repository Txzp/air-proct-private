const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { isTrusted } = require('../trust');
const { isStaff } = require('./tickets');
const { log } = require('../logger');

const defs = [
  new SlashCommandBuilder()
    .setName('mj')
    .setDescription('El bot dice un mensaje por ti (oculto)')
    .addStringOption((o) => o.setName('mensaje').setDescription('Lo que dirá el bot').setRequired(true).setMaxLength(2000))
    .toJSON(),
];
const names = ['mj'];

async function handle(i) {
  if (!isTrusted(i.guild, i.user.id) && !isStaff(i.member)) {
    return i.reply({ content: '❌ Solo roles altos pueden usar esto.', flags: MessageFlags.Ephemeral });
  }
  const text = i.options.getString('mensaje').replace(/\\n/g, '\n');
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  // Sin @everyone/@here ni pings de roles masivos; menciones a usuarios sí
  await i.channel.send({ content: text, allowedMentions: { parse: ['users'] } });
  await i.deleteReply().catch(() => {}); // no queda ni rastro del comando para nadie
  log('info', '/mj usado', `${i.user} hizo hablar al bot en <#${i.channelId}>.`, [{ name: 'Mensaje', value: text.slice(0, 1000) }]);
}

module.exports = { defs, names, handle };
