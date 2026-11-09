const { Events } = require('discord.js');
const cfg = require('../config');

const M = cfg.mg;
const API = 'https://openrouter.ai/api/v1';
const PREFERRED = ['deepseek-chat-v3', 'llama-4', 'llama-3.3-70b', 'gemma-4-31b', 'qwen3', 'deepseek-chat', 'deepseek-v3', 'gemma-3-27b', 'qwen', 'mistral-small', 'llama', 'gemma', 'mistral', 'deepseek'];

const SYSTEM = `Eres "AirProtect", el bot del server de Discord "${cfg.welcome.serverName}". Hablas como un compa mexicano del server: relajado, chistoso, con slang (we, bro, alv, nmms, qué pedo, simón, nel, xd).
Reglas:
- Respuestas CORTAS: 1 a 2 frases, como un mensaje de chat. Nada de listas ni textos largos.
- Sigue la vibra: si te dicen "como andas we" respondes algo como "aquí cagando we, ¿y tú qué?".
- Puedes ser grosero de broma entre compas, pero nunca racista, homofóbico, ni ataques de verdad a nadie. Nada sexual.
- Si te preguntan algo en serio (dudas, ayuda), responde bien pero con tu estilo.
- No digas que eres una IA ni menciones modelos. Nunca uses @everyone ni @here.
- Responde en el idioma del mensaje (casi siempre español).`;

let models = [];
let modelsAt = 0;
const history = new Map(); // channelId -> [{ role, content }]
const cooldown = new Map(); // userId -> timestamp

async function loadModels() {
  if (!M.apiKey) return [];
  if (M.model) return (models = [M.model]);
  if (models.length && Date.now() - modelsAt < 6 * 60 * 60_000) return models;
  try {
    const res = await fetch(`${API}/models`);
    const { data } = await res.json();
    const free = data
      .filter((m) => m.id.endsWith(':free') || (m.pricing?.prompt === '0' && m.pricing?.completion === '0'))
      .filter((m) => !/vision|embed|guard|audio|image/i.test(m.id))
      .map((m) => m.id);
    const score = (id) => {
      if (/[^\d](1\.?\d?b|2b|3b)[^\d]?/i.test(id)) return 200; // modelos diminutos al final
      const i = PREFERRED.findIndex((p) => id.toLowerCase().includes(p));
      return i === -1 ? 99 : i;
    };
    models = free.sort((a, b) => score(a) - score(b)).slice(0, 10);
    modelsAt = Date.now();
    console.log('[mg] Modelos gratis:', models.join(', ') || 'ninguno');
  } catch (e) {
    console.error('[mg] No pude listar modelos:', e.message);
  }
  return models;
}

function clean(text) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/@(everyone|here)/g, '@​$1')
    .trim()
    .slice(0, 1800);
}

async function callOpenRouter(model, messages) {
  const res = await fetch(`${API}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${M.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'AirProtect' },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 1200, // espacio de sobra por si el modelo "piensa" antes de responder
      temperature: 0.9,
      reasoning: { effort: 'low', exclude: true }, // que piense poco y no mande el razonamiento
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => ({}));
  const text = clean(json.choices?.[0]?.message?.content || '');
  if (res.ok && text) return text;
  const err = json.error?.metadata?.raw || json.error?.message || (res.ok ? 'respuesta vacía' : `HTTP ${res.status}`);
  throw new Error(String(err).slice(0, 160));
}

// Respaldo opcional: Groq (gratis, muy rápido) si pones GROQ_API_KEY
async function callGroq(messages) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${M.groqKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: M.groqModel, messages, max_tokens: 300, temperature: 0.9 }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => ({}));
  const text = clean(json.choices?.[0]?.message?.content || '');
  if (res.ok && text) return text;
  throw new Error(json.error?.message || `HTTP ${res.status}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const badUntil = new Map(); // modelo -> hasta cuándo se salta (falló hace poco)

async function ask(messages) {
  const list = await loadModels();
  let lastErr = 'sin modelos disponibles';
  // 2 vueltas: si todos fallan la primera, espera un poco y reintenta (los free se saturan a ratos)
  for (let round = 0; round < 2; round++) {
    const now = Date.now();
    const order = [...list.filter((m) => (badUntil.get(m) || 0) < now), ...list.filter((m) => (badUntil.get(m) || 0) >= now)];
    for (const model of order) {
      try {
        const text = await callOpenRouter(model, messages);
        badUntil.delete(model);
        return text;
      } catch (e) {
        lastErr = e.message;
        badUntil.set(model, Date.now() + 2 * 60_000);
        console.warn(`[mg] ${model} falló: ${e.message}`);
      }
    }
    if (M.groqKey) {
      try {
        return await callGroq(messages);
      } catch (e) {
        lastErr = e.message;
        console.warn(`[mg] groq falló: ${e.message}`);
      }
    }
    if (round === 0) await sleep(2000);
  }
  throw new Error(lastErr);
}

async function onMessage(message) {
  if (!message.guild || message.guild.id !== cfg.guildId || message.author.bot) return;
  const content = message.content || '';
  if (!content.toLowerCase().startsWith(M.prefix)) return;
  if (M.channelId && message.channelId !== M.channelId) return;

  const prompt = content.slice(M.prefix.length).trim();
  if (!prompt) return message.reply('¿Qué onda? Escribe algo después de `!mg` we 😂').catch(() => {});

  if (!M.apiKey && !M.groqKey) return message.reply('No tengo cerebro conectado todavía (falta `OPENROUTER_API_KEY`) 💀').catch(() => {});

  const now = Date.now();
  if (now - (cooldown.get(message.author.id) || 0) < M.cooldownMs) {
    return message.react('⏳').catch(() => {});
  }
  cooldown.set(message.author.id, now);

  const hist = history.get(message.channelId) || [];
  const userMsg = { role: 'user', content: `${message.member?.displayName || message.author.username}: ${prompt.slice(0, 800)}` };
  await message.channel.sendTyping().catch(() => {});

  try {
    const answer = await ask([{ role: 'system', content: SYSTEM }, ...hist, userMsg]);
    await message.reply({ content: answer, allowedMentions: { repliedUser: true, parse: [] } });
    hist.push(userMsg, { role: 'assistant', content: answer });
    history.set(message.channelId, hist.slice(-M.memory * 2));
  } catch (e) {
    console.error('[mg]', e.message);
    await message.reply('Se me fue el internet del cerebro we, intenta en un ratito 😵').catch(() => {});
  }
}

function init(client) {
  client.on(Events.MessageCreate, (m) => onMessage(m).catch((e) => console.error('[mg]', e)));
  if (M.apiKey) loadModels();
  else if (M.groqKey) console.log('[mg] Usando solo Groq');
}

module.exports = { init };
