const { Events, AuditLogEvent } = require('discord.js');
const cfg = require('../config');
const { isTrusted } = require('../trust');
const { log } = require('../logger');

const R = cfg.antiRaid;
const DAY = 24 * 60 * 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = { raidUntil: 0, joins: [] };

function raidActive() {
  return Date.now() < state.raidUntil;
}

function setRaid(on, by = 'automático') {
  state.raidUntil = on ? Date.now() + R.raidModeMs : 0;
  log(on ? 'danger' : 'ok', on ? 'MODO RAID ACTIVADO' : 'Modo raid desactivado', on
    ? `Activado (${by}). Durante ${R.raidModeMs / 60_000} min se expulsan cuentas con menos de ${R.raidMinAccountAgeDays} días.`
    : `Desactivado (${by}).`);
}

async function onJoin(member) {
  const guild = member.guild;
  if (guild.id !== cfg.guildId) return;

  // ---- Bots: solo entran si los añadió alguien de confianza ----
  if (member.user.bot) {
    if (isTrusted(guild, member.id)) return;
    let adder = null;
    for (let i = 0; i < 4 && !adder; i++) {
      const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 5 }).catch(() => null);
      adder = logs?.entries.find((e) => e.targetId === member.id)?.executorId || null;
      if (!adder) await sleep(400);
    }
    if (adder && isTrusted(guild, adder)) {
      log('info', 'Bot añadido', `${member} fue añadido por <@${adder}> (de confianza).`);
      return;
    }
    await member.kick('AirProtect: bot no autorizado').catch(() => {});
    log('danger', 'Bot no autorizado expulsado', `${member} (\`${member.id}\`) entró y fue expulsado al instante.`, [
      { name: 'Añadido por', value: adder ? `<@${adder}>` : 'desconocido' },
    ]);
    return;
  }

  if (isTrusted(guild, member.id)) return;

  // ---- Humanos: detección de raid por oleada de entradas ----
  const now = Date.now();
  state.joins = state.joins.filter((t) => now - t < R.windowMs);
  state.joins.push(now);
  if (!raidActive() && state.joins.length >= R.joins) setRaid(true, `${state.joins.length} entradas en ${R.windowMs / 1000}s`);

  // ---- Durante la alerta/raid: patea a CUALQUIERA que entre + DM ----
  if (raidActive()) {
    const invite = R.rejoinInvite;
    const dm =
      '```ansi\n\u001b[2;31mDiscord Alert:\u001b[0m Desactiva cualquier cosa que esté causando la alerta en tu cuenta.\n```\n' +
      `Cuando estés listo, vuelve a unirte 👉 ${invite}`;
    await member.send(dm).catch(() => {});
    const ok = await member.kick('AirProtect: entró durante una alerta de raid').then(() => true).catch(() => false);
    log('danger', 'Expulsado durante alerta', `${member} (\`${member.user.tag}\`) entró durante la alerta de raid y ${ok ? 'fue expulsado' : 'NO se pudo expulsar'}.`, [
      { name: 'Edad de la cuenta', value: `${((now - member.user.createdTimestamp) / DAY).toFixed(1)} días`, inline: true },
    ]);
    return;
  }

  const ageDays = (now - member.user.createdTimestamp) / DAY;
  const minAge = raidActive() ? Math.max(R.raidMinAccountAgeDays, R.minAccountAgeDays) : R.minAccountAgeDays;
  if (minAge > 0 && ageDays < minAge) {
    await member
      .send(`🛡️ **AirProtect:** tu cuenta es muy nueva para entrar a **${guild.name}** ahora mismo. Intenta más tarde.`)
      .catch(() => {});
    await member.kick(`AirProtect: cuenta nueva (${ageDays.toFixed(1)} días)${raidActive() ? ' durante raid' : ''}`).catch(() => {});
    log('warn', 'Cuenta nueva expulsada', `${member.user.tag} (\`${member.id}\`) — cuenta de ${ageDays.toFixed(1)} días.`);
  }
}

function init(client) {
  client.on(Events.GuildMemberAdd, (m) => onJoin(m).catch((e) => console.error('[antiraid]', e)));
}

module.exports = { init, setRaid, raidActive, state };
