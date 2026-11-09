const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const cfg = require('../config');
const store = require('../store');
const { isTrusted } = require('../trust');
const { isStaff } = require('./tickets');
const { log, currentLogChannelId } = require('../logger');

const defs = [
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Da un warn a un usuario')
    .addUserOption((o) => o.setName('usuario').setDescription('A quién').setRequired(true))
    .addStringOption((o) => o.setName('mensaje').setDescription('Motivo del warn').setRequired(true).setMaxLength(500)),
  new SlashCommandBuilder()
    .setName('warns')
    .setDescription('Ver los warns de un usuario')
    .addUserOption((o) => o.setName('usuario').setDescription('A quién').setRequired(true)),
  new SlashCommandBuilder()
    .setName('clearwarns')
    .setDescription('Borra los warns de un usuario')
    .addUserOption((o) => o.setName('usuario').setDescription('A quién').setRequired(true)),
].map((c) => c.toJSON());

const names = defs.map((d) => d.name);

function fmt(ms) {
  if (ms >= 24 * 60 * 60_000) return `${ms / (24 * 60 * 60_000)} día(s)`;
  if (ms >= 60 * 60_000) return `${ms / (60 * 60_000)} hora(s)`;
  return `${ms / 60_000} min`;
}

async function handle(i) {
  const guild = i.guild;
  const ephemeral = (content) => i.reply({ content, flags: MessageFlags.Ephemeral });
  if (!isTrusted(guild, i.user.id) && !isStaff(i.member)) return ephemeral('❌ Solo el staff puede usar este comando.');

  const user = i.options.getUser('usuario');
  const list = store.data.warns[user.id] || [];

  if (i.commandName === 'warns') {
    if (!list.length) return ephemeral(`${user} no tiene warns ✅`);
    const lines = list.map((w, n) => `**${n + 1}.** ${w.reason}\n└ por <@${w.by}> • <t:${Math.floor(w.at / 1000)}:R>`);
    return i.reply({
      embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle(`⚠️ Warns de ${user.username} (${list.length})`).setDescription(lines.join('\n').slice(0, 4000))],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (i.commandName === 'clearwarns') {
    delete store.data.warns[user.id];
    store.save();
    log('ok', 'Warns borrados', `${i.user} borró los warns de ${user} (\`${user.id}\`).`);
    return ephemeral(`♻️ Warns de ${user} borrados.`);
  }

  // /warn
  if (user.bot) return ephemeral('❌ No puedes darle warn a un bot.');
  if (user.id === i.user.id) return ephemeral('❌ No puedes darte warn a ti mismo.');
  if (isTrusted(guild, user.id) && !isTrusted(guild, i.user.id)) return ephemeral('❌ No puedes darle warn a un admin.');
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return ephemeral('❌ Ese usuario no está en el server.');

  const reason = i.options.getString('mensaje');
  list.push({ reason, by: i.user.id, at: Date.now() });
  store.data.warns[user.id] = list;
  store.save();
  const count = list.length;

  // Castigo automático
  const ms = cfg.warns.punishments[count];
  let punishment = null;
  if (ms) {
    punishment = (await member.timeout(ms, `AirProtect: ${count} warns`).then(() => true).catch(() => false))
      ? `🔇 Aislado **${fmt(ms)}** por llegar a ${count} warns`
      : `❗ Llegó a ${count} warns pero no pude aislarlo`;
  }

  // DM al usuario
  const dm = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`⚠️ Recibiste un warn en ${guild.name}`)
    .addFields(
      { name: 'Motivo', value: reason },
      { name: 'Warns totales', value: String(count), inline: true },
      { name: 'Staff', value: i.member.displayName, inline: true }
    )
    .setTimestamp();
  if (punishment) dm.addFields({ name: 'Sanción', value: punishment.replace(/\*\*/g, '') });
  const dmOk = await user.send({ embeds: [dm] }).then(() => true).catch(() => false);

  // Mensaje público en el canal
  const pub = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setDescription(`⚠️ ${user} recibió un **warn** (#${count})\n**Motivo:** ${reason}${punishment ? `\n${punishment}` : ''}`)
    .setFooter({ text: `Por ${i.member.displayName}` });
  await i.reply({ content: `${user}`, embeds: [pub], allowedMentions: { users: [user.id] } });

  log('warn', `Warn #${count}`, `${user} (\`${user.id}\`) recibió un warn de ${i.user}.`, [
    { name: 'Motivo', value: reason },
    { name: 'DM', value: dmOk ? 'Enviado ✅' : 'DMs cerrados ❌', inline: true },
    ...(punishment ? [{ name: 'Sanción', value: punishment, inline: true }] : []),
  ]);
}

// Render free borra el disco en cada deploy → reconstruye los warns leyendo el canal de logs
async function rebuild(guild) {
  if (Object.keys(store.data.warns).length) return;
  const ch = await guild.channels.fetch(currentLogChannelId()).catch(() => null);
  if (!ch?.isTextBased()) return;
  const msgs = [];
  let before;
  for (let n = 0; n < 20; n++) {
    const batch = await ch.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch?.size) break;
    msgs.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  const warns = {};
  for (const m of msgs.reverse()) {
    if (m.author.id !== guild.client.user.id) continue;
    for (const e of m.embeds) {
      const title = e.title || '';
      const id = (e.description || '').match(/\(`(\d{15,21})`\)/)?.[1];
      if (!id) continue;
      if (title.includes('Warns borrados')) delete warns[id];
      else if (title.includes('Warn #')) {
        const by = (e.description.match(/warn de <@!?(\d+)>/) || [])[1] || 'desconocido';
        const reason = e.fields.find((f) => f.name === 'Motivo')?.value || 'Sin motivo';
        (warns[id] ||= []).push({ reason, by, at: m.createdTimestamp });
      }
    }
  }
  store.data.warns = warns;
  store.save();
  const total = Object.values(warns).reduce((a, b) => a + b.length, 0);
  if (total) console.log(`[warns] Reconstruidos ${total} warns desde los logs`);
}

module.exports = { defs, names, handle, rebuild };
