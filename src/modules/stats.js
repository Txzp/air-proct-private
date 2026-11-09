const cfg = require('../config');
const { roleId } = require('../trust');

const S = cfg.stats;
let message = null;
let lastContent = '';
let running = false;

async function build(client) {
  const guild = client.guilds.cache.get(cfg.guildId);
  // withCounts trae miembros y conectados aproximados sin necesitar el intent de presencias
  const fresh = await client.guilds.fetch({ guild: cfg.guildId, withCounts: true, force: true }).catch(() => null);
  const boyId = roleId(cfg.protectedRoles.boy);
  const girlId = roleId(cfg.protectedRoles.girl);
  const boys = guild.roles.cache.get(boyId)?.members.size ?? 0;
  const girls = guild.roles.cache.get(girlId)?.members.size ?? 0;
  const total = fresh?.approximateMemberCount ?? guild.memberCount;
  const online = fresh?.approximatePresenceCount ?? '?';
  return [`<@&${boyId}> -> ${boys}`, `<@&${girlId}> -> ${girls}`, '', `Miembros Total: ${total}`, `Online: ${online}`].join('\n');
}

async function findMessage(ch, client) {
  const msgs = await ch.messages.fetch({ limit: 30 }).catch(() => null);
  return msgs?.find((m) => m.author.id === client.user.id && !m.embeds.length && m.content.includes('Miembros Total:')) || null;
}

async function tick(client) {
  if (running) return;
  running = true;
  try {
    const ch = await client.channels.fetch(S.channelId).catch(() => null);
    if (!ch?.isTextBased()) return;
    const content = await build(client);
    if (content === lastContent && message) return;
    if (!message) message = await findMessage(ch, client);
    const payload = { content, allowedMentions: { parse: [] } }; // muestra los roles sin pingear
    if (message) {
      message = await message.edit(payload).catch(async (e) => {
        if (e.code === 10008) return ch.send(payload); // lo borraron → uno nuevo
        throw e;
      });
    } else message = await ch.send(payload);
    lastContent = content;
  } catch (e) {
    console.error('[stats]', e.message);
  } finally {
    running = false;
  }
}

function start(client) {
  tick(client);
  setInterval(() => tick(client), S.intervalMs).unref();
}

module.exports = { start };
