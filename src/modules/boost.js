const { Events, AttachmentBuilder, EmbedBuilder, MessageType } = require('discord.js');
const cfg = require('../config');
const { renderCard } = require('./welcome');

const recent = new Map(); // userId -> timestamp (evita doble mensaje)
const BOOST_TYPES = [MessageType.GuildBoost, MessageType.GuildBoostTier1, MessageType.GuildBoostTier2, MessageType.GuildBoostTier3];

async function announce(member) {
  const now = Date.now();
  if (now - (recent.get(member.id) || 0) < 2 * 60_000) return;
  recent.set(member.id, now);

  const guild = await member.guild.fetch().catch(() => member.guild);
  const ch = await guild.channels.fetch(cfg.boost.channelId).catch(() => null);
  if (!ch?.isTextBased()) return console.error('[boost] No encuentro el canal', cfg.boost.channelId);

  const count = guild.premiumSubscriptionCount ?? 0;
  const tier = guild.premiumTier ?? 0;
  const png = await renderCard(member, {
    badge: '💎 NUEVO BOOST',
    subtitle: `${count} boost${count === 1 ? '' : 's'} • Nivel ${tier}`,
    ring: ['#ff73fa', '#b57bff', '#5865f2'],
    tint: ['rgba(255,115,250,0.35)', 'rgba(120,60,220,0.25)', 'rgba(88,101,242,0.35)'],
    sparkles: true,
  });

  const emoji = guild.emojis.cache.find((e) => e.name.toLowerCase().includes(cfg.boost.emojiName.toLowerCase()));
  const embed = new EmbedBuilder()
    .setColor(0xff73fa)
    .setDescription(`¡Gracias por boostear **${cfg.welcome.serverName}**! Gracias a ti el server sigue creciendo 💜`)
    .setImage('attachment://boost.png')
    .setFooter({ text: `${count} boosts • Nivel ${tier}` })
    .setTimestamp();

  await ch.send({
    content: `${member} acaba de boostear el server ${emoji ? emoji.toString() : '💎'}`,
    embeds: [embed],
    files: [new AttachmentBuilder(png, { name: 'boost.png' })],
    allowedMentions: { users: [member.id] },
  });
}

function init(client) {
  // 1er boost de alguien
  client.on(Events.GuildMemberUpdate, (oldM, newM) => {
    if (newM.guild.id !== cfg.guildId || oldM.partial) return;
    if (!oldM.premiumSince && newM.premiumSince) announce(newM).catch((e) => console.error('[boost]', e));
  });
  // Boosts repetidos (mensaje de sistema de Discord)
  client.on(Events.MessageCreate, (m) => {
    if (m.guildId !== cfg.guildId || !BOOST_TYPES.includes(m.type) || !m.member) return;
    announce(m.member).catch((e) => console.error('[boost]', e));
  });
}

module.exports = { init, announce };
