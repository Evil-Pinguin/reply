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
const LATCH_KEY = 'reply_ai_latch_v1'; // timestamp — до какого момента не пробуем эндпоинт
const LATCH_MS = 60 * 1000;            // мёртвый эндпоинт не трогаем 1 минуту

// Временная защёлка в памяти + localStorage (если доступен). Нужна, чтобы
// мёртвый /api/ai не долбился каждым сообщением, но при этом оживший
// эндпоинт (или добавленный ключ) подхватывался без перезагрузки страницы.
let memLatchUntil = 0;
let lastError = null; // {type, detail}
export function getLastAIError(){ return lastError; }
function setLastError(type, detail){ lastError = {type, detail, at: Date.now()}; }

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
  memLatchUntil = Date.now() + LATCH_MS;
  try { localStorage.setItem(LATCH_KEY, String(memLatchUntil)); } catch (e) { /* ignore */ }
}

function clearLatch() {
  memLatchUntil = 0;
  try { localStorage.removeItem(LATCH_KEY); } catch (e) { /* ignore */ }
}

function isLatched() {
  if (Date.now() < memLatchUntil) return true;
  try {
    const t = Number(localStorage.getItem(LATCH_KEY));
    if (t > Date.now()) return true;
  } catch (e) { /* ignore */ }
  return false;
}

function parseReply(data) {
  if (!data || !data.ok || !data.reply) return null;
  const reply = String(data.reply).trim();
  return reply || null;
}

// POST-вызов. Вернёт: реплику | 'no_key' (сервер жив, но нет ключа) | null (недоступен)
// таймаут 7с — чтобы локальный мозг не ждал 30с пока Groq висит
async function postAI(payload) {
  let res;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const to = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 7000) : null;
  try {
    res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl ? ctrl.signal : undefined,
    });
  } catch (e) {
    if (to) clearTimeout(to);
    return null;
  }
  if (to) clearTimeout(to);
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    if (data.error === 'no_key') { setLastError('no_key', data.hint||''); return 'no_key'; }
    if (data.error === 'groq_error') { setLastError('groq_error', data.detail||''); return { error:'groq_error', detail:data.detail||''}; }
    setLastError(data.error||'unknown', data.detail||JSON.stringify(data).slice(0,200));
    return { error: data.error||'unknown', detail: data.detail||'' };
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
    stats: p.stats || null,
    topics: (p.topics || []).slice(-6),
    evaluations: (p.evaluations || []).slice(-6).map(e=>({type:e.type, note:String(e.note||'').slice(0,80), text:String(e.text||'').slice(0,80)})),
    moments: (p.moments || []).slice(-6),
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
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const to = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 7000) : null;
  try {
    const q = encodeURIComponent(toB64(JSON.stringify(compactPayload(payload))));
    res = await fetch('/api/ai?q=' + q, { method: 'GET', signal: ctrl ? ctrl.signal : undefined });
  } catch (e) {
    if (to) clearTimeout(to);
    return null;
  }
  if (to) clearTimeout(to);
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    if (data.error === 'no_key') { setLastError('no_key', data.hint||''); return 'no_key'; }
    if (data.error === 'groq_error') { setLastError('groq_error', data.detail||''); return { error:'groq_error', detail:data.detail||''}; }
    setLastError(data.error||'unknown', data.detail||'');
    return { error: data.error||'unknown', detail: data.detail||'' };
  }
  return parseReply(data);
}

// основной вызов: возвращает реплику персонажа или null при любой ошибке
// v1.3.3: помнит что было хорошо/плохо/странно/ужасно через evaluations/moments/stats
export async function askAI({ character, location, season, chapter, user, history, text, initiative, stats, topics, evaluations, moments }) {
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
    stats: stats || null,
    topics: topics || [],
    evaluations: evaluations || [],
    moments: moments || [],
  };

  let reply = await postAI(payload);
  if (reply === null) reply = await getAI(payload); // fallback для прокси без POST

  if (reply === 'no_key') { setLastError('no_key',''); return null; }
  if (reply && typeof reply === 'object' && reply.error) {
    // groq_error или другая ошибка — защёлкиваем но сохраняем detail
    if (reply.error === 'groq_error') { /* keep lastError */ }
    latchUnavailable();
    return null;
  }
  if (reply) {
    clearLatch();
    lastError = null;
    markAIUsed();
    return reply;
  }
  latchUnavailable(); // эндпоинт недоступен — не пробуем минуту
  return null;
}
