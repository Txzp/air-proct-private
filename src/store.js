const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'store.json');

const data = {
  whitelist: [],
  strikes: {}, // userId -> { count, last }
  roleMembers: {}, // roleId protegido -> [userIds]
  roleRemap: {}, // id viejo -> id nuevo (si un rol protegido fue recreado)
  logChannelId: null, // si el canal de logs fue recreado
  lockdown: null, // estado previo de permisos para /unlock
};

try {
  if (fs.existsSync(FILE)) Object.assign(data, JSON.parse(fs.readFileSync(FILE, 'utf8')));
} catch (e) {
  console.error('[store] No se pudo leer store.json:', e.message);
}

let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('[store] No se pudo guardar:', e.message);
    }
  }, 500);
}

module.exports = { data, save };
