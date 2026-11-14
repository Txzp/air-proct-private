const { Events, AttachmentBuilder, EmbedBuilder, MessageType } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const cfg = require('../config');
const { FONT_STACK } = require('./welcome');

const FONT = FONT_STACK || 'Poppins, DejaVu, Emoji, sans-serif';
const recent = new Map(); // userId -> timestamp (evita doble mensaje)
const BOOST_TYPES = [MessageType.GuildBoost, MessageType.GuildBoostTier1, MessageType.GuildBoostTier2, MessageType.GuildBoostTier3];

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Banner dedicado de boost, estilo Nitro
async function renderBoost(member, count, tier) {
  const W = 1000;
  const H = 360;
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  roundRect(ctx, 0, 0, W, H, 28);
  ctx.clip();

  // Fondo: banner del usuario o degradado Nitro
  const user = await member.user.fetch(true).catch(() => member.user);
  const bannerUrl = user.bannerURL?.({ size: 1024, extension: 'png' });
  const banner = bannerUrl ? await loadImage(bannerUrl).catch(() => null) : null;
  if (banner) {
    const s = Math.max(W / banner.width, H / banner.height);
    ctx.drawImage(banner, (W - banner.width * s) / 2, (H - banner.height * s) / 2, banner.width * s, banner.height * s);
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#3a1263');
    g.addColorStop(0.5, '#5b1a8a');
    g.addColorStop(1, '#2a0f45');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // Tinte rosa Nitro
  const tint = ctx.createLinearGradient(0, 0, W, H);
  tint.addColorStop(0, 'rgba(255,115,250,0.38)');
  tint.addColorStop(0.5, 'rgba(120,60,220,0.3)');
  tint.addColorStop(1, 'rgba(20,10,30,0.55)');
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, W, H);

  // Destellos
  for (let i = 0; i < 60; i++) {
    ctx.save();
    ctx.globalAlpha = Math.random() * 0.6 + 0.2;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(Math.random() * W, Math.random() * H, Math.random() * 2.4 + 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Avatar con aro Nitro
  const cx = 165;
  const cy = 150;
  const R = 92;
  const avatar = await loadImage(member.displayAvatarURL({ size: 256, extension: 'png', forceStatic: true })).catch(() => null);
  if (avatar) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R + 7, 0, Math.PI * 2);
    const ring = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    ring.addColorStop(0, '#ff73fa');
    ring.addColorStop(1, '#b57bff');
    ctx.fillStyle = ring;
    ctx.shadowColor = '#ff73fa';
    ctx.shadowBlur = 35;
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatar, cx - R, cy - R, R * 2, R * 2);
    ctx.restore();
  }

  // Textos a la derecha
  const x0 = 300;
  ctx.textAlign = 'left';
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 12;

  ctx.font = `30px ${FONT}`;
  ctx.fillStyle = '#ff9af5';
  ctx.fillText('💜 NUEVO BOOST', x0, 92);

  const name = member.displayName || user.globalName || user.username;
  let size = 52;
  ctx.font = `${size}px ${FONT}`;
  while (ctx.measureText(name).width > W - x0 - 60 && size > 26) ctx.font = `${(size -= 2)}px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(name, x0, 155);

  ctx.font = `26px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText(`¡Gracias por impulsar ${cfg.welcome.serverName}!`, x0, 205);

  // Pastillas con stats
  ctx.shadowBlur = 0;
  const pill = (x, label) => {
    ctx.font = `24px ${FONT}`;
    const w = ctx.measureText(label).width + 36;
    roundRect(ctx, x, 240, w, 46, 23);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,146,245,0.7)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 18, 264);
    ctx.textBaseline = 'alphabetic';
    return x + w + 14;
  };
  let px = x0;
  px = pill(px, `🚀 ${count} boost${count === 1 ? '' : 's'}`);
  pill(px, `⭐ Nivel ${tier}`);

  return c.encode('png');
}

async function announce(member, force = false) {
  const now = Date.now();
  if (!force && now - (recent.get(member.id) || 0) < 2 * 60_000) return;
  recent.set(member.id, now);

  const guild = await member.guild.fetch().catch(() => member.guild);
  const ch = await guild.channels.fetch(cfg.boost.channelId).catch(() => null);
  if (!ch?.isTextBased()) return console.error('[boost] No encuentro el canal', cfg.boost.channelId);

  const count = guild.premiumSubscriptionCount ?? 0;
  const tier = guild.premiumTier ?? 0;
  const emojiName = cfg.boost.emojiName || 'boost';
  const emoji = guild.emojis.cache.find((e) => e.name?.toLowerCase().includes(emojiName.toLowerCase()));

  const embed = new EmbedBuilder()
    .setColor(0xff73fa)
    .setDescription(`¡Gracias por boostear **${cfg.welcome.serverName}**! Gracias a ti el server sigue creciendo 💜`)
    .setFooter({ text: `${count} boosts • Nivel ${tier} • AirProtect` })
    .setTimestamp();

  const files = [];
  try {
    const png = await renderBoost(member, count, tier);
    files.push(new AttachmentBuilder(png, { name: 'boost.png' }));
    embed.setImage('attachment://boost.png');
  } catch (e) {
    // si la imagen falla, igual se manda el mensaje (ya no se queda sin anunciar)
    console.error('[boost] render falló:', e.message);
  }

  await ch
    .send({
      content: `${member} acaba de boostear el server ${emoji ? emoji.toString() : '💎'}`,
      embeds: [embed],
      files,
      allowedMentions: { users: [member.id] },
    })
    .catch((e) => console.error('[boost] send:', e.message));
}

function init(client) {
  // 1er boost de alguien (premiumSince pasa de null a fecha)
  client.on(Events.GuildMemberUpdate, (oldM, newM) => {
    if (newM.guild.id !== cfg.guildId) return;
    if (!oldM.premiumSince && newM.premiumSince) announce(newM).catch((e) => console.error('[boost]', e));
  });
  // Boosts (mensaje de sistema de Discord) — cubre repetidos y primeros
  client.on(Events.MessageCreate, (m) => {
    if (m.guildId !== cfg.guildId || !BOOST_TYPES.includes(m.type) || !m.member) return;
    announce(m.member).catch((e) => console.error('[boost]', e));
  });
}

module.exports = { init, announce, renderBoost };
