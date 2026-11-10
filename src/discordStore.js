// Almacenamiento que sobrevive a los redeploys de Render: guarda un JSON como archivo
// adjunto en un canal oculto del server (solo lo ve el bot y los admins).
const { ChannelType, PermissionFlagsBits: P, AttachmentBuilder } = require('discord.js');
const cfg = require('./config');

const NAME = 'airprotect-data';
let channel = null;
let guildRef = null;
let message = null;
let data = {};
let dirty = false;
let saving = null;
let loadFailed = false; // si no se pudo leer, NO se guarda encima (no borrar datos buenos)

async function getChannel(guild) {
  if (channel) return channel;
  channel = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === NAME) || null;
  if (!channel) {
    channel = await guild.channels.create({
      name: NAME,
      type: ChannelType.GuildText,
      topic: '🔒 Datos internos de AirProtect. No borrar.',
      permissionOverwrites: [
        { id: guild.id, deny: [P.ViewChannel] },
        { id: guild.client.user.id, allow: [P.ViewChannel, P.SendMessages, P.AttachFiles, P.ReadMessageHistory] },
      ],
      reason: 'AirProtect: almacenamiento de datos',
    });
  }
  return channel;
}

async function load(guild) {
  guildRef = guild;
  const ch = await getChannel(guild);
  const msgs = await ch.messages.fetch({ limit: 20 }).catch(() => null);
  message = msgs?.find((m) => m.author.id === guild.client.user.id && m.attachments.some((a) => a.name === 'db.json')) || null;
  if (message) {
    const url = message.attachments.find((a) => a.name === 'db.json').url;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        data = await (await fetch(url)).json();
        loadFailed = false;
        break;
      } catch (e) {
        loadFailed = true;
        console.error(`[db] No pude leer db.json (intento ${attempt + 1}):`, e.message);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  console.log(`[db] Cargado (${Object.keys(data).length} claves)`);
  return data;
}

function get(key, def) {
  if (data[key] === undefined) data[key] = def;
  return data[key];
}

function markDirty() {
  dirty = true;
}

async function save() {
  if (!dirty || !guildRef) return;
  if (loadFailed) return console.error('[db] No se guarda: los datos no se pudieron cargar al arrancar');
  if (saving) return saving;
  dirty = false;
  saving = (async () => {
    const file = new AttachmentBuilder(Buffer.from(JSON.stringify(data)), { name: 'db.json' });
    try {
      await getChannel(guildRef);
      if (message) message = await message.edit({ content: `💾 Guardado <t:${Math.floor(Date.now() / 1000)}:R>`, files: [file], attachments: [] });
      else message = await channel.send({ content: '💾 Datos de AirProtect', files: [file] });
    } catch (e) {
      dirty = true;
      if (e.code === 10008) message = null; // borraron el mensaje → se crea otro
      if (e.code === 10003) {
        channel = null; // borraron el canal → se recrea en el próximo guardado
        message = null;
      }
      console.error('[db] Error guardando:', e.message);
    } finally {
      saving = null;
    }
  })();
  return saving;
}

function start(intervalMs = 2 * 60_000) {
  setInterval(() => save(), intervalMs).unref();
}

module.exports = { load, get, markDirty, save, start, NAME };
