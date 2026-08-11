// ─── Reply · состояние и сохранение ─────────────────────────────────────────

import { CHARACTERS, DAILY_SURPRISES, DAILY_LIKE_LIMIT, shuffle } from './data.js';
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
      mbti: 'ENFP', values: [], habits: [],
      about: '', interests: [], goals: '',
    },
    theme: 'dark',       // 'dark' | 'light' | 'auto'
    filters: {           // фильтры в ленте свайпов
      gender: 'all',     // 'all' | 'female' | 'male'
      city: 'all',       // 'all' | 'Москва' | 'Санкт-Петербург' | ...
      minAge: 18,
      maxAge: 60,
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
    likesDay: '', // день учёта лайков
    likesUsed: 0,         // сколько лайков использовано сегодня (лимит 5, отказы безлимит)
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
    // v1.2.9: свежие карточки и сброс лайков при новом дне
    const today = (()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');})();
    if (parsed.day !== today) {
      parsed.day = today;
      parsed.deck = [];
      parsed.swiped = {};
    }
    if (parsed.likesDay !== today) {
      parsed.likesDay = today;
      parsed.likesUsed = 0;
    }
    if (typeof parsed.likesUsed !== 'number') parsed.likesUsed = 0;
    if (!parsed.likesDay) parsed.likesDay = today;
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
  try { return (state && state.theme) || 'dark'; } catch(e){ return 'dark'; }
}

export function setTheme(theme) {
  try {
    if (!state) state = { theme: 'dark' };
    state.theme = theme;
    applyTheme(theme);
    save();
  } catch(e){ console.error('setTheme',e); }
}

export function applyTheme(theme) {
  try {
    const t = theme || (state && state.theme) || 'dark';
    const isLight = t === 'light' || (t === 'auto' && typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.toggle('theme-light', isLight);
    }
  } catch(e){ console.error('applyTheme',e); }
}

// ─── Фильтры ленты ──────────────────────────────────────────────────────────

export function getFilters() {
  return state.filters || { gender: 'all', city: 'all', minAge: 18, maxAge: 60 };
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

// ─── Лимит лайков v1.2.9: 5 лайков/день, отказы безлимит ────────────────────
function _todayStrLocal(){
  const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
export function getLikesUsed(){
  const today=_todayStrLocal();
  if (state.likesDay !== today){ state.likesDay = today; state.likesUsed = 0; save(); }
  return state.likesUsed || 0;
}
export function getLikesRemaining(){
  const used=getLikesUsed();
  const limit=DAILY_LIKE_LIMIT||5;
  const bonus=state.premium?2:0;
  return Math.max(0, limit+bonus-used);
}
export function canLike(){ return getLikesRemaining()>0; }

export function swipe(id, dir) {
  if (dir==='like' && !canLike()) return false;
  state.swiped[id] = dir;
  if (dir === 'like') {
    state.likesUsed = (state.likesUsed||0)+1;
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

// ─── Огонёк-стрик (Duolingo/TikTok) v1.2.8 ─────────────────────────────────
export const FLAME_STYLES = {
  fire: { emoji: '🔥', name: 'Огонь', color: '#f59e0b', desc: 'Классика — тёплая и яркая' },
  ice:  { emoji: '🧊', name: 'Лёд',   color: '#38bdf8', desc: 'Холодная решимость' },
  neon: { emoji: '⚡', name: 'Неон',  color: '#a78bfa', desc: 'Энергия ночи' },
  gold: { emoji: '🌟', name: 'Золото', color: '#fbbf24', desc: 'Для легендарных серий' },
  pink: { emoji: '💖', name: 'Розовый', color: '#ec4899', desc: 'Мягкая любовь к ритуалу' },
};

export const FLAME_LEVELS = [
  { level: 1, name: 'Искра',   min: 0,  max: 0,  icon: '✨',   next: 1,  reward: 'До огонька остался 1 день' },
  { level: 2, name: 'Огонёк',  min: 1,  max: 2,  icon: '🔥',   next: 3,  reward: 'Ты зажёг огонёк! 3 дня → Пламя' },
  { level: 3, name: 'Пламя',   min: 3,  max: 6,  icon: '🔥',   next: 7,  reward: 'Пламя разгорается. 7 дней → Костёр' },
  { level: 4, name: 'Костёр',  min: 7,  max: 13, icon: '🔥🔥', next: 14, reward: 'Вау, костёр! 14 дней → Легенда 👑' },
  { level: 5, name: 'Легенда', min: 14, max: Infinity, icon: '🔥👑', next: null, reward: 'Ты легенда Reply. Огонёк с короной 👑' },
];

function _levelForStreak(s) {
  for (let i = FLAME_LEVELS.length - 1; i >= 0; i--) {
    if (s >= FLAME_LEVELS[i].min) return FLAME_LEVELS[i];
  }
  return FLAME_LEVELS[0];
}

export function getFlame() {
  const s = state.streak || 0;
  const lvl = _levelForStreak(s);
  const outfit = FLAME_STYLES[state.flameOutfit] || FLAME_STYLES.fire;
  // иконка — это стиль (outfit emoji), но размер/корона берётся из уровня
  const levelIcon = lvl.icon;
  const size = levelIcon;
  // прогресс до следующего уровня
  let progress = 100;
  let toNext = 0;
  let nextName = null;
  if (lvl.next !== null) {
    const nextLvl = FLAME_LEVELS.find((x) => x.min === lvl.next);
    const span = (nextLvl ? nextLvl.min : lvl.next) - lvl.min;
    const done = s - lvl.min;
    progress = span > 0 ? Math.min(99, Math.max(0, Math.round((done / span) * 100))) : 0;
    toNext = (nextLvl ? nextLvl.min : lvl.next) - s;
    nextName = nextLvl ? nextLvl.name : null;
  }
  return {
    streak: s,
    level: lvl.level,
    levelName: lvl.name,
    levelDef: lvl,
    outfit,
    icon: outfit.emoji, // иконка стиля
    levelIcon,          // иконка уровня
    size,
    name: outfit.name,
    progress,         // 0-100 до следующего уровня
    toNext,           // дней до следующего
    nextName,
    nextThreshold: lvl.next,
    desc: lvl.reward,
  };
}

export function getFlameProgress() {
  const f = getFlame();
  return { level: f.level, streak: f.streak, progress: f.progress, toNext: f.toNext, nextName: f.nextName };
}

export function setFlameOutfit(style) {
  if (!FLAME_STYLES[style]) return false;
  state.flameOutfit = style;
  save();
  return true;
}

// ─── День рождения и дневной подарок v1.2.8 ─────────────────────────────────
// birthday может быть YYYY-MM-DD или MM-DD; парсим устойчиво
function _parseBirthday(bStr) {
  if (!bStr || typeof bStr !== 'string') return null;
  const s = bStr.trim();
  if (!s) return null;
  // поддержка YYYY-MM-DD
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) {
    const m = Number(iso[2]); const d = Number(iso[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return { m: m - 1, d };
  }
  const md = /^(\d{1,2})-(\d{1,2})$/.exec(s);
  if (md) {
    const m = Number(md[1]); const d = Number(md[2]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return { m: m - 1, d };
  }
  // fallback через Date
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return { m: d.getMonth(), d: d.getDate() };
  } catch (e) {}
  return null;
}

export function isBirthdayToday() {
  const b = state.user?.birthday;
  const parsed = _parseBirthday(b);
  if (!parsed) return false;
  const n = new Date();
  return parsed.m === n.getMonth() && parsed.d === n.getDate();
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
  if (state.dailyGiftDay === today) return { ok: false, leveled: false, prev: state.streak, now: state.streak };
  const prevStreak = state.streak || 0;
  const prevLevel = _levelForStreak(prevStreak).level;
  state.dailyGiftDay = today;
  // лёгкий буст стрика: если был 0 — становится 1; иначе если заходили вчера — уже учтётся в finishDate,
  // а если пропустили — даём +1 как подарок за возвращение
  if (state.streak === 0) state.streak = 1;
  else if (state.lastDateDay !== today) {
    // бонусный день за ежедневный вход
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    if (state.lastDateDay !== yesterday) {
      state.streak = Math.max(1, state.streak + 1);
    }
  }
  save();
  const nowLevel = _levelForStreak(state.streak).level;
  return { ok: true, leveled: nowLevel > prevLevel, prev: prevStreak, now: state.streak, prevLevel, nowLevel };
}
// удобный хелпер: сколько дней до ДР
export function daysUntilBirthday() {
  const b = _parseBirthday(state.user?.birthday);
  if (!b) return null;
  const now = new Date();
  let next = new Date(now.getFullYear(), b.m, b.d);
  if (next < now) next = new Date(now.getFullYear() + 1, b.m, b.d);
  const diff = Math.ceil((next - now) / 864e5);
  return diff;
}
