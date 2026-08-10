// ─── Reply · состояние и сохранение ─────────────────────────────────────────

import { CHARACTERS, DAILY_SURPRISES, shuffle } from './data.js';
import { getSeason } from './seasons.js';

const KEY = 'reply_state_v1';

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function defaultState() {
  return {
    onboarded: false,
    user: {
      name: '', gender: 'male', targetGender: 'all', birthday: '', age: 24, city: 'Москва',
      avatarEmoji: '😊', avatarLabel: 'Тёплый', avatarImg: 'assets/avatars/user-1.png', avatarHue: 0,
      mbti: 'ENFP', values: ['Честность', 'Свобода', 'Творчество'], habits: ['Кофе по утрам', 'Вечерние прогулки'],
      about: '', interests: ['Кофе', 'Путешествия', 'Музыка'], goals: 'Серьёзные отношения',
    },
    theme: 'dark',       // 'dark' | 'light' | 'auto'
    filters: {           // фильтры в ленте свайпов
      gender: 'all',     // 'all' | 'female' | 'male'
      city: 'all',       // 'all' | 'Москва' | 'Санкт-Петербург' | ...
      minAge: 18,
      maxAge: 35,
    },
    surpriseDay: null,   // дата последнего полученного сюрприза дня
    surpriseItem: null,  // текущий сюрприз
    premium: false,
    premiumDiscount: false,  // v1.2.7: пользователь забрал скидку 50% в воронке отмены
    sound: true,
    day: todayStr(),
    deck: [],            // id персонажей на сегодня
    swiped: {},          // charId -> 'like'|'pass'
    matched: [],         // id персонажей, с кем есть мэтч
    activeMatch: null,   // charId текущего запланированного свидания
    planned: [],         // запланированные свидания: [{id, charId, dateISO, time, locationId, activities}]
    dates: [],           // завершённые свидания
    memories: [],        // карточки воспоминаний
    diary: [],           // дневник отношений
    letters: [],         // письма после свиданий
    gallery: [],         // совместные фото
    relations: {},       // charId -> {stats, datesCount, mood}
    achievements: [],
    streak: 0,
    lastDateDay: null,
    flameOutfit: 'fire', // fire | ice | neon | gold | pink — как в Duolingo/TikTok
    lastBirthdayShown: null, // YYYY-MM-DD когда показывали поздравление
    dailyGiftDay: null, // YYYY-MM-DD последнего дневного подарка
    collections: {       // коллекции: собранные предметы живой вселенной
      locations: [],     // id локаций, где были свидания
      dishes: [],        // названия заказанных блюд
      activities: [],    // id использованных активностей
      chars: [],         // id заметченных персонажей
      seasons: [],       // id сезонов, в которые проходили свидания
      photos: 0,         // число совместных фото
    },
    story: {},           // charId -> {chapter, since} — текущая глава истории
  };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const def = defaultState();
    // миграция: старый формат одного плана → массив планов
    if (parsed.planned && !Array.isArray(parsed.planned)) {
      const p = parsed.planned;
      if (!p.id) p.id = 'p' + Date.now();
      parsed.planned = [p];
    }
    if (!parsed.planned) parsed.planned = [];
    if (!parsed.filters) parsed.filters = def.filters;
    if (!parsed.theme) parsed.theme = 'dark';
    // свежие карточки на новый день
    if (parsed.day !== def.day) {
      parsed.day = def.day;
      parsed.deck = [];
      parsed.swiped = {};
    }
    return { ...def, ...parsed, user: { ...def.user, ...(parsed.user || {}) } };
  } catch (e) {
    return defaultState();
  }
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

export function getState() { return state; }

export function resetAll() {
  state = defaultState();
  save();
}

export function setUser(patch) {
  state.user = { ...state.user, ...patch };
  save();
}

// ─── Темы оформления ────────────────────────────────────────────────────────

export function getTheme() {
  return state.theme || 'dark';
}

export function setTheme(theme) {
  state.theme = theme;
  applyTheme(theme);
  save();
}

export function applyTheme(theme = state.theme) {
  const isLight = theme === 'light' || (theme === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  document.body.classList.toggle('theme-light', isLight);
}

// ─── Фильтры ленты ──────────────────────────────────────────────────────────

export function getFilters() {
  return state.filters || { gender: 'all', city: 'all', minAge: 18, maxAge: 35 };
}

export function setFilters(patch) {
  state.filters = { ...(state.filters || {}), ...patch };
  save();
}

// ─── Сюрприз дня ────────────────────────────────────────────────────────────

export function getDailySurprise() {
  const today = todayStr();
  const alreadyClaimed = state.surpriseDay === today;
  if (!state.surpriseItem || state.surpriseDay !== today) {
    const idx = Math.abs(today.split('-').reduce((acc, n) => acc * 31 + Number(n), 0)) % DAILY_SURPRISES.length;
    state.surpriseItem = DAILY_SURPRISES[idx];
  }
  return { item: state.surpriseItem, claimed: alreadyClaimed };
}

export function claimDailySurprise() {
  const today = todayStr();
  state.surpriseDay = today;
  unlock('surprise_hunter');
  save();
  return getDailySurprise().item;
}

// ─── Управление Premium ─────────────────────────────────────────────────────

export function isPremium() { return state.premium; }

export function setPremium(val) {
  state.premium = !!val;
  if (state.premium) unlock('premium');
  save();
  return state.premium;
}

export function togglePremium() {
  return setPremium(!state.premium);
}

export function cancelPremium() {
  return setPremium(false);
}

// ─── Ежедневная колода ──────────────────────────────────────────────────────

export function getDeck() {
  if (!state.deck || state.deck.length === 0) {
    state.deck = shuffle(CHARACTERS.map((c) => c.id));
    save();
  }
  return state.deck;
}

export function getFilteredDeck() {
  const allIds = getDeck();
  const f = getFilters();
  return allIds.filter((id) => {
    const ch = CHARACTERS.find((c) => c.id === id);
    if (!ch) return false;
    if (f.gender && f.gender !== 'all' && ch.gender && ch.gender !== f.gender) return false;
    if (f.city && f.city !== 'all' && ch.city !== f.city) return false;
    if (f.minAge && ch.age < f.minAge) return false;
    if (f.maxAge && ch.age > f.maxAge) return false;
    return true;
  });
}

// показать новую подборку (сброс свайпов, мэтчи сохраняются)
export function refreshDeck() {
  state.deck = shuffle(CHARACTERS.map((c) => c.id));
  state.swiped = {};
  save();
  return state.deck;
}

export function remainingToday() {
  const deck = getFilteredDeck();
  return deck.filter((id) => !state.swiped[id]).length;
}

export function nextCard() {
  const deck = getFilteredDeck();
  const next = deck.find((id) => !state.swiped[id]);
  return next ? CHARACTERS.find((c) => c.id === next) : null;
}

export function swipe(id, dir) {
  state.swiped[id] = dir;
  if (dir === 'like') {
    if (!state.matched.includes(id)) state.matched.push(id);
    if (!state.activeMatch) state.activeMatch = id;
    collect('chars', id);
  }
  save();
  return state.matched.includes(id);
}

export function isMatched(id) {
  return state.matched.includes(id);
}

// ─── Планирование свиданий (можно несколько, но не в одно время) ────────────

export function planDate({ charId, dateISO, time, locationId, activities, planId }) {
  const existing = state.planned.find((p) => p.charId === charId);
  const rec = {
    id: planId || existing?.id || 'p' + Date.now(),
    charId, dateISO, time, locationId,
    activities: activities || [],
  };
  if (existing) Object.assign(existing, rec);
  else state.planned.push(rec);
  state.activeMatch = charId;
  save();
  return rec;
}

export function hasPlanFor(charId) {
  return state.planned.find((p) => p.charId === charId) || null;
}

// конфликт по дате+времени с другими персонажами (исключая excludeCharId)
export function planConflict(dateISO, time, excludeCharId) {
  return state.planned.find((p) => p.charId !== excludeCharId && p.dateISO === dateISO && p.time === time) || null;
}

export function getPlan(id) {
  return state.planned.find((p) => p.id === id) || null;
}

export function removePlan(id) {
  state.planned = state.planned.filter((p) => p.id !== id);
  save();
}

export function clearPlanned() {
  state.planned = [];
  save();
}

export function nextUpcoming() {
  if (!state.planned.length) return null;
  const now = Date.now();
  return state.planned
    .map((p) => ({ ...p, ts: new Date(p.dateISO + 'T' + p.time + ':00').getTime() }))
    .sort((a, b) => a.ts - b.ts)[0] || null;
}

export function plannedDateTime(p) {
  if (!p) return null;
  return new Date(p.dateISO + 'T' + p.time + ':00');
}

// ─── Завершение свидания ────────────────────────────────────────────────────

export function finishDate({ planId, durationMin, stats, orders, activitiesUsed, moments, topics, bestMoment }) {
  const p = state.planned.find((x) => x.id === planId) || state.planned[0];
  if (!p) return null;
  const charId = p.charId;
  const rel = state.relations[charId] || { stats: { trust: 0, comfort: 0, humor: 0, sympathy: 0, romance: 0 }, datesCount: 0, mood: '😊' };
  for (const k of Object.keys(rel.stats)) {
    rel.stats[k] = Math.min(100, rel.stats[k] + Math.round((stats?.[k] || 0) / 2));
  }
  rel.datesCount += 1;
  state.relations[charId] = rel;

  const d = new Date();
  const dateRec = {
    id: 'd' + Date.now(),
    charId, locationId: p.locationId,
    dateLabel: new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }),
    timeLabel: p.time,
    durationMin,
    orders: orders || [],
    activitiesUsed: activitiesUsed || [],
    moments: moments || [],
    topics: topics || [],
    bestMoment: bestMoment || 'Мне было очень легко с тобой.',
    stats: { ...(stats || {}) },
    ts: d.toISOString(),
  };
  state.dates.push(dateRec);
  state.memories.unshift({ id: 'm' + Date.now(), type: 'date', dateId: dateRec.id, ts: d.toISOString() });
  collect('locations', p.locationId);
  collect('seasons', getSeason().id);
  (p.activities || []).forEach((a) => collect('activities', a));
  state.planned = state.planned.filter((x) => x.id !== p.id);
  if (state.activeMatch === charId) state.activeMatch = nextUpcoming()?.charId || null;
  const today = todayStr();
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  if (state.lastDateDay === today) { /* уже учтено сегодня */ }
  else if (state.lastDateDay === yesterday) state.streak += 1;
  else state.streak = 1;
  state.lastDateDay = today;
  unlock('first_date');
  save();
  return dateRec;
}

// ─── Воспоминания, дневник, письма, галерея ─────────────────────────────────

export function addDiary(text, mood) {
  state.diary.unshift({ id: 'y' + Date.now(), text, mood: mood || '😌', ts: new Date().toISOString() });
  save();
}

export function addLetter(charId, text) {
  state.letters.unshift({ id: 'l' + Date.now(), charId, text, ts: new Date().toISOString() });
  save();
}

export function addGallery(dataUrl, caption) {
  state.gallery.unshift({ id: 'g' + Date.now(), dataUrl, caption, ts: new Date().toISOString() });
  save();
}

export function unlock(id) {
  if (!state.achievements.includes(id)) {
    state.achievements.push(id);
    save();
    return true;
  }
  return false;
}

// ─── Коллекции ──────────────────────────────────────────────────────────────
// collect('locations', locId) — массивы дедуплицируются;
// collect('photos') — без значения: просто счётчик.

export function collect(kind, value) {
  const c = state.collections;
  if (!c) { state.collections = defaultState().collections; return false; }
  if (kind === 'photos') {
    c.photos = (c.photos || 0) + 1;
    save();
    return true;
  }
  const arr = c[kind];
  if (!Array.isArray(arr)) return false;
  if (!arr.includes(value)) {
    arr.push(value);
    save();
    return true;
  }
  return false;
}

export function collectionCount() {
  const c = state.collections || {};
  return (c.locations?.length || 0) + (c.dishes?.length || 0) + (c.activities?.length || 0) + (c.chars?.length || 0) + (c.seasons?.length || 0) + (c.photos || 0);
}

// ─── Главы истории ──────────────────────────────────────────────────────────
// фиксирует текущую главу для персонажа; возвращает { changed, chapter }
export function setChapter(charId, chapter) {
  const prev = state.story?.[charId];
  const cur = prev && prev.chapter;
  if (cur === chapter) return { changed: false, chapter };
  state.story = { ...(state.story || {}), [charId]: { chapter, since: Date.now() } };
  save();
  return { changed: !cur, chapter };
}

export function relationOf(charId) {
  return state.relations[charId] || { stats: { trust: 0, comfort: 0, humor: 0, sympathy: 0, romance: 0 }, datesCount: 0, mood: '😊' };
}

export function compatibilityWith(charId) {
  const ch = CHARACTERS.find((c) => c.id === charId);
  const rel = relationOf(charId);
  const dates = state.dates.filter((dd) => dd.charId === charId).length;
  const base = ch ? ch.compatibility : 80;
  return Math.min(99, base + dates * 1 + Math.round((rel.stats.sympathy + rel.stats.trust) / 20));
}

// ─── Огонёк-стрик (Duolingo/TikTok) ────────────────────────────────────────
export const FLAME_STYLES = {
  fire: { emoji: '🔥', name: 'Огонь', color: '#f59e0b' },
  ice:  { emoji: '🧊', name: 'Лёд', color: '#38bdf8' },
  neon: { emoji: '⚡', name: 'Неон', color: '#a78bfa' },
  gold: { emoji: '🌟', name: 'Золото', color: '#fbbf24' },
  pink: { emoji: '💖', name: 'Розовый', color: '#ec4899' },
};
export function getFlame() {
  const s = state.streak || 0;
  let level = 1;
  if (s >= 14) level = 5;
  else if (s >= 7) level = 4;
  else if (s >= 3) level = 3;
  else if (s >= 1) level = 2;
  const outfit = FLAME_STYLES[state.flameOutfit] || FLAME_STYLES.fire;
  const size = level === 5 ? '🔥👑' : level === 4 ? '🔥🔥' : level >= 3 ? '🔥' : '✨';
  return { streak: s, level, outfit, icon: outfit.emoji, size, name: outfit.name };
}
export function setFlameOutfit(style) {
  if (!FLAME_STYLES[style]) return false;
  state.flameOutfit = style;
  save();
  return true;
}

// ─── День рождения и дневной подарок ───────────────────────────────────────
export function isBirthdayToday() {
  const b = state.user?.birthday;
  if (!b) return false;
  const d = new Date(b);
  const n = new Date();
  return d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}
export function shouldShowBirthday() {
  if (!isBirthdayToday()) return false;
  const today = todayStr();
  return state.lastBirthdayShown !== today;
}
export function markBirthdayShown() {
  state.lastBirthdayShown = todayStr();
  save();
}
export function isDailyGiftAvailable() {
  const today = todayStr();
  return state.dailyGiftDay !== today;
}
export function claimDailyGift() {
  const today = todayStr();
  if (state.dailyGiftDay === today) return false;
  state.dailyGiftDay = today;
  // лёгкий буст стрика
  if (state.streak === 0) state.streak = 1;
  save();
  return true;
}
