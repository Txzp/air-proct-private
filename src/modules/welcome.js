const path = require('path');
const { Events, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const cfg = require('../config');

const FONTS = path.join(__dirname, '..', '..', 'assets', 'fonts');
GlobalFonts.registerFromPath(path.join(FONTS, 'Poppins-Bold.ttf'), 'Poppins');
GlobalFonts.registerFromPath(path.join(FONTS, 'DejaVuSans-Bold.ttf'), 'DejaVu');
GlobalFonts.registerFromPath(path.join(FONTS, 'NotoColorEmoji.ttf'), 'Emoji');
const FONT_STACK = 'Poppins, DejaVu, Emoji, sans-serif';

const W = 1000;
const H = 420;

function coverImage(ctx, img, w, h) {
  const scale = Math.max(w / img.width, h / img.height);
  const iw = img.width * scale;
  const ih = img.height * scale;
  ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function renderCard(member) {
  const user = await member.user.fetch(true).catch(() => member.user); // trae banner y color
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  roundRect(ctx, 0, 0, W, H, 28);
  ctx.clip();

  // Fondo: banner del usuario, o degradado con su color de perfil
  const bannerUrl = user.bannerURL({ size: 1024, extension: 'png' });
  let drewBanner = false;
  if (bannerUrl) {
    const banner = await loadImage(bannerUrl).catch(() => null);
    if (banner) {
      coverImage(ctx, banner, W, H);
      drewBanner = true;
    }
  }
  if (!drewBanner) {
    const accent = user.hexAccentColor || '#5865f2';
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, accent);
    g.addColorStop(1, '#0d0d14');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // Capa oscura para que se lea el texto
  const shade = ctx.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, 'rgba(0,0,0,0.25)');
  shade.addColorStop(1, 'rgba(0,0,0,0.65)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  // Foto de perfil al centro
  const R = 95;
  const cx = W / 2;
  const cy = 165;
  const avatar = await loadImage(member.displayAvatarURL({ size: 512, extension: 'png', forceStatic: true })).catch(() => null);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 25;
  ctx.beginPath();
  ctx.arc(cx, cy, R + 7, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  if (avatar) ctx.drawImage(avatar, cx - R, cy - R, R * 2, R * 2);
  else {
    ctx.fillStyle = '#2b2d31';
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  }
  ctx.restore();

  // DisplayName en blanco
  const name = member.displayName || user.globalName || user.username;
  let size = 56;
  ctx.font = `${size}px ${FONT_STACK}`;
  while (ctx.measureText(name).width > W - 120 && size > 26) {
    size -= 2;
    ctx.font = `${size}px ${FONT_STACK}`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.75)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(name, cx, 325);

  ctx.shadowBlur = 8;
  ctx.font = `24px ${FONT_STACK}`;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText(`Miembro #${member.guild.memberCount}`, cx, 375);

  return canvas.encode('png');
}

async function onJoin(member) {
  if (member.guild.id !== cfg.guildId || member.user.bot) return;
  const ch = await member.guild.channels.fetch(cfg.welcome.channelId).catch(() => null);
  if (!ch?.isTextBased()) return;

  const emoji = member.guild.emojis.cache.find((e) => e.name === cfg.welcome.emojiName);
  const png = await renderCard(member);
  const file = new AttachmentBuilder(png, { name: 'welcome.png' });
  const embed = new EmbedBuilder().setColor(0xff7ad9).setImage('attachment://welcome.png');

  await ch.send({
    content: `${member} **Bienvenid@ a ${cfg.welcome.serverName}** ${emoji ? emoji.toString() : '👋'}`,
    embeds: [embed],
    files: [file],
    allowedMentions: { users: [member.id] },
  });
}

function init(client) {
  client.on(Events.GuildMemberAdd, (m) =>
    // pequeño retraso: si el anti-raid lo expulsa, no se da la bienvenida
    setTimeout(() => {
      if (!m.guild.members.cache.has(m.id)) return;
      onJoin(m).catch((e) => console.error('[welcome]', e));
    }, 2500)
  );
}

module.exports = { init, renderCard };
