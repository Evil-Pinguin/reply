// ─── Reply AI · внешний генеративный ИИ (Groq) ──────────────────────────────
// Клиентский модуль: отправляет контекст разговора на /api/ai (прокси
// dev-сервера server.py), который ходит в Groq. Ключ API живёт только на
// сервере (переменная окружения или gitignored файл groq_key.txt) — в
// браузер и в репозиторий ключ не попадает.
//
// Если ИИ недоступен (нет ключа / сеть / ошибка) — модуль возвращает null,
// и чат прозрачно переключается на встроенный локальный «мозг».

const MODE_KEY = 'reply_ai_mode_v1'; // 'groq' | 'off'
const AI_FLAG_KEY = 'reply_ai_used_v1';

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

// основной вызов: возвращает реплику персонажа или null при любой ошибке
export async function askAI({ character, location, season, chapter, user, history, text, initiative }) {
  if (!aiEnabled()) return null;
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        character: {
          id: character.id,
          name: character.name,
          emoji: character.avatarEmoji || '😊',
          personality: character.personality || {},
          commStyle: character.commStyle || '',
          temperament: character.temperament || '',
          mood: character.mood || '',
          views: character.views || {},
          catchphrases: character.catchphrases || [],
          interests: character.interests || [],
        },
        location: location ? { id: location.id, name: location.name, emoji: location.emoji, music: location.music } : null,
        season: season ? { id: season.id, name: season.name, emoji: season.emoji } : null,
        chapter: chapter ? { id: chapter.id, name: chapter.name, emoji: chapter.emoji } : null,
        user: user ? { name: user.name || '', age: user.age || '', about: user.about || '' } : null,
        history: (history || []).slice(-16),
        text,
        initiative: !!initiative,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.ok || !data.reply) return null;
    const reply = String(data.reply).trim();
    if (!reply) return null;
    markAIUsed();
    return reply;
  } catch (e) {
    return null;
  }
}
