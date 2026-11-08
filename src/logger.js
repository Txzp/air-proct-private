const { EmbedBuilder } = require('discord.js');
const cfg = require('./config');
const store = require('./store');

const COLORS = { info: 0x5865f2, ok: 0x2ecc71, warn: 0xf1c40f, danger: 0xe74c3c, spam: 0xe67e22 };
const ICONS = { info: '🛡️', ok: '✅', warn: '⚠️', danger: '🚨', spam: '🔇' };

let client = null;
const queue = [];
let sending = false;

function init(c) {
  client = c;
}

function currentLogChannelId() {
  return store.data.logChannelId || cfg.logChannelId;
}

async function flush() {
  if (sending) return;
  sending = true;
  while (queue.length) {
    const embeds = queue.splice(0, 10); // hasta 10 embeds por mensaje (aguanta ataques masivos)
    try {
      const ch = await client.channels.fetch(currentLogChannelId()).catch(() => null);
      if (ch?.isTextBased()) await ch.send({ embeds });
      else embeds.forEach((e) => console.log('[log]', e.data.title, '-', e.data.description));
    } catch (e) {
      console.error('[logger]', e.message);
    }
  }
  sending = false;
}

function log(level, title, description, fields = []) {
  console.log(`[${level}] ${title} — ${description || ''}`);
  if (!client) return;
  const embed = new EmbedBuilder()
    .setColor(COLORS[level] ?? COLORS.info)
    .setTitle(`${ICONS[level] ?? ''} ${title}`.trim())
    .setTimestamp()
    .setFooter({ text: 'AirProtect' });
  if (description) embed.setDescription(String(description).slice(0, 4000));
  if (fields.length) embed.addFields(fields.slice(0, 25).map((f) => ({ ...f, value: String(f.value).slice(0, 1024) || '—' })));
  queue.push(embed);
  flush();
}

module.exports = { init, log, currentLogChannelId };
