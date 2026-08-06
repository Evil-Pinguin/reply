// ─── Reply AI · внешний генеративный ИИ (Groq) ──────────────────────────────
// Клиентский модуль: отправляет контекст разговора на /api/ai (прокси
// dev-сервера server.py), который ходит в Groq. Ключ API живёт только на
// сервере (переменная окружения или gitignored файл groq_key.txt) — в
// браузер и в репозиторий ключ не попадает.
//
// Если ИИ недоступен (нет ключа / сеть / ошибка) — модуль возвращает null,
// и чат прозрачно переключается на встроенный локальный «мозг».
//
// Устойчивость к превью-прокси: основной способ — POST /api/ai; если прокси
// не отдаёт POST (404), делаем один fallback-запрос GET /api/ai?q=… (base64).
// Если и он недоступен — ставим «защёлку» сессии, чтобы не долбить мёртвый
// эндпоинт каждым сообщением.

const MODE_KEY = 'reply_ai_mode_v1'; // 'groq' | 'off'
const AI_FLAG_KEY = 'reply_ai_used_v1';
const LATCH_KEY = 'reply_ai_latch_v1'; // '1' — эндпоинт недоступен в этой сессии

export function getAIMode() {
  try {
    return localStorage.getItem(MODE_KEY) || 'groq';
  } catch (e) {
    return 'groq';
  }
}

export function setAIMode(mode) {
  try {
    localStorage.setItem(MODE_KEY, mode === 'off' ? 'off' : 'groq');
  } catch (e) { /* ignore */ }
}

export function aiEnabled() {
  return getAIMode() !== 'off';
}

export function markAIUsed() {
  try { localStorage.setItem(AI_FLAG_KEY, '1'); } catch (e) { /* ignore */ }
}

export function aiWasUsed() {
  try { return localStorage.getItem(AI_FLAG_KEY) === '1'; } catch (e) { return false; }
}

function latchUnavailable() {
  try { localStorage.setItem(LATCH_KEY, '1'); } catch (e) { /* ignore */ }
}

function isLatched() {
  try { return localStorage.getItem(LATCH_KEY) === '1'; } catch (e) { return false; }
}

function parseReply(data) {
  if (!data || !data.ok || !data.reply) return null;
  const reply = String(data.reply).trim();
  return reply || null;
}

// POST-вызов. Вернёт: реплику | 'no_key' (сервер жив, но нет ключа) | null (недоступен)
async function postAI(payload) {
  let res;
  try {
    res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    if (data.error === 'no_key' || data.error === 'groq_error') return 'no_key';
    return null;
  }
  return parseReply(data);
}

// GET-fallback для превью-прокси, которые не отдают POST.
// Пейлоад компактный (история 6 ходов, короткие тексты), чтобы URL был коротким.
function compactPayload(p) {
  return {
    character: {
      id: p.character?.id || '',
      name: p.character?.name || '',
      emoji: p.character?.avatarEmoji || '😊',
      commStyle: p.character?.commStyle || '',
      temperament: p.character?.temperament || '',
      mood: p.character?.mood || '',
      personality: p.character?.personality || {},
    },
    location: p.location ? { id: p.location.id, name: p.location.name, emoji: p.location.emoji } : null,
    season: p.season || null,
    chapter: p.chapter || null,
    user: p.user ? { name: String(p.user.name || '').slice(0, 60) } : null,
    history: (p.history || []).slice(-6).map((h) => ({
      role: h.role,
      text: String(h.text || '').slice(0, 240),
    })),
    text: String(p.text || '').slice(0, 300),
    initiative: !!p.initiative,
  };
}

function toB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

async function getAI(payload) {
  let res;
  try {
    const q = encodeURIComponent(toB64(JSON.stringify(compactPayload(payload))));
    res = await fetch('/api/ai?q=' + q, { method: 'GET' });
  } catch (e) {
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    if (data.error === 'no_key' || data.error === 'groq_error') return 'no_key';
    return null;
  }
  return parseReply(data);
}

// основной вызов: возвращает реплику персонажа или null при любой ошибке
export async function askAI({ character, location, season, chapter, user, history, text, initiative }) {
  if (!aiEnabled()) return null;
  if (isLatched()) return null; // эндпоинт уже проверен и недоступен

  const payload = {
    character,
    location,
    season,
    chapter,
    user,
    history: (history || []).slice(-16),
    text,
    initiative: !!initiative,
  };

  let reply = await postAI(payload);
  if (reply === null) reply = await getAI(payload); // fallback для прокси без POST

  if (reply === 'no_key') return null;      // сервер жив, ключа нет — не защёлкиваем
  if (reply) {
    markAIUsed();
    return reply;
  }
  latchUnavailable(); // эндпоинт недоступен — больше не пробуем в этой сессии
  return null;
}
