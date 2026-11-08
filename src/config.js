require('dotenv').config();

const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
const bool = (v, def) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));
const num = (v, def) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? def : Number(v));

module.exports = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.GUILD_ID || '1566683072953323611',
  logChannelId: process.env.LOG_CHANNEL_ID || '1568900069648892025',
  port: num(process.env.PORT, 3000),
  leaveOtherGuilds: bool(process.env.LEAVE_OTHER_GUILDS, false), // true = se sale de servers que no sean GUILD_ID

  // Roles importantes del server (se respaldan sus miembros y se recrean si los borran)
  protectedRoles: {
    boy: process.env.ROLE_BOY || '1567686054579011745',
    girl: process.env.ROLE_GIRL || '1567686174024274070',
  },

  // Roles de confianza: quien tenga uno de estos roles es ignorado por el anti-nuke/anti-spam
  trustedRoles: list(process.env.TRUSTED_ROLE_IDS).length
    ? list(process.env.TRUSTED_ROLE_IDS)
    : [
        '1566683311164624996', // own (admins)
        '1568104847390285975', // Manager
        '1568486463975333959', // Bots (bots ya aprobados)
      ],

  // Dueños del bot (pueden manejar la whitelist). El dueño del server siempre cuenta.
  ownerIds: list(process.env.OWNER_IDS),
  // Usuarios / bots de confianza iniciales (también se pueden añadir con /whitelist)
  whitelist: list(process.env.WHITELIST_IDS),

  antiSpam: {
    messages: num(process.env.SPAM_MESSAGES, 15), // 15 mensajes...
    windowMs: num(process.env.SPAM_WINDOW_MS, 10_000), // ...dentro de 10 segundos
    freeStrikes: 3, // 3 oportunidades
    strikeTimeoutMs: 60_000, // silencio de 60 s en cada oportunidad
    finalTimeoutMs: 5 * 60_000, // a partir de la 4ª vez: 5 minutos
    strikeResetMs: num(process.env.SPAM_STRIKE_RESET_MS, 60 * 60_000), // las oportunidades se reinician tras 1 h limpio
    maxMentions: num(process.env.SPAM_MAX_MENTIONS, 5), // menciones masivas en un solo mensaje
    antiInvite: bool(process.env.ANTI_INVITE, true), // borra invitaciones de otros servers
    webhookMessages: 8, // un webhook que mande 8 mensajes...
    webhookWindowMs: 5_000, // ...en 5 s se elimina
  },

  antiNuke: {
    windowMs: num(process.env.NUKE_WINDOW_MS, 15_000),
    // Límite de acciones por persona (no whitelist) dentro de la ventana antes de castigar.
    // Los BOTS que no estén en whitelist se castigan a la PRIMERA acción destructiva.
    limits: {
      channelDelete: 2,
      channelCreate: 4,
      roleDelete: 2,
      roleCreate: 4,
      ban: 3,
      kick: 4,
      emojiDelete: 4,
      webhookCreate: 2,
      roleStrip: 5,
    },
    // Qué hacer con un HUMANO que se pasa del límite: "strip" (quitar roles + aislar 28 días) o "ban"
    humanPunishment: (process.env.NUKE_HUMAN_PUNISHMENT || 'strip').toLowerCase(),
  },

  // Canal trampa: quien escriba ahí (cuentas spam / selfbots) se silencia 5 min
  honeypot: {
    channelId: process.env.HONEYPOT_CHANNEL_ID || '', // vacío = el bot lo crea solo
    channelName: process.env.HONEYPOT_CHANNEL_NAME || '🚫・no-escribir',
    timeoutMs: 5 * 60_000,
  },

  tickets: {
    panelChannelId: process.env.TICKET_PANEL_CHANNEL_ID || '1566962055125270679',
    categoryId: process.env.TICKET_CATEGORY_ID || '1566962002297880667',
    logChannelId: process.env.TICKET_LOG_CHANNEL_ID || '', // vacío = canal de logs de AirProtect
    closeDelayMs: 5_000,
    // Roles que atienden y pueden cerrar tickets
    staffRoles: list(process.env.TICKET_STAFF_ROLE_IDS).length
      ? list(process.env.TICKET_STAFF_ROLE_IDS)
      : ['1568104847390285975', '1566683311164624996'], // Manager, own
    staffRoleNames: ['Soporte'], // también se buscan por nombre (Soporte)
  },

  welcome: {
    channelId: process.env.WELCOME_CHANNEL_ID || '1566954709372239923',
    serverName: process.env.WELCOME_SERVER_NAME || '0km',
    emojiName: process.env.WELCOME_EMOJI || 'hola',
  },

  antiRaid: {
    joins: num(process.env.RAID_JOINS, 8), // 8 entradas...
    windowMs: num(process.env.RAID_WINDOW_MS, 10_000), // ...en 10 s = raid
    raidModeMs: num(process.env.RAID_MODE_MS, 10 * 60_000), // modo raid dura 10 min
    raidMinAccountAgeDays: num(process.env.RAID_MIN_ACCOUNT_AGE_DAYS, 7), // en modo raid se expulsan cuentas nuevas
    minAccountAgeDays: num(process.env.MIN_ACCOUNT_AGE_DAYS, 0), // siempre (0 = desactivado)
  },
};
