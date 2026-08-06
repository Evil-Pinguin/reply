// ─── Reply · главы истории ──────────────────────────────────────────────────
// Отношения с каждым персонажем проходят главы: от первой искры до «своих».
// Глава вычисляется из статистики отношений + количества свиданий.

import { relationOf } from './state.js';

export const CHAPTERS = [
  { id: 'spark',    name: 'Искра',    emoji: '✨', need: 0,  desc: 'Вы только познакомились и строите первые планы' },
  { id: 'steps',    name: 'Первые шаги', emoji: '🌱', need: 15, desc: 'Первое свидание позади — теперь есть общая история' },
  { id: 'warmth',   name: 'Тепло',    emoji: '🔥', need: 30, desc: 'Рядом с вами легко: общие темы и общие шутки' },
  { id: 'trust',    name: 'Доверие',  emoji: '🤝', need: 45, desc: 'Секреты перестают быть секретами' },
  { id: 'closeness', name: 'Близость', emoji: '💞', need: 60, desc: 'Вы уже «вы» для друзей. Почти семья' },
  { id: 'ours',     name: 'Свои люди', emoji: '🏡', need: 75, desc: 'Всё сложилось. Дальше — только вместе' },
];

// балл истории: среднее по шкалам + бонус за каждое свидание
export function scoreFor(charId) {
  const rel = relationOf(charId);
  const vals = Object.values(rel.stats || {});
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  return Math.min(100, Math.round(avg + (rel.datesCount || 0) * 6));
}

export function chapterIndexFor(charId) {
  const score = scoreFor(charId);
  let idx = 0;
  for (let i = 0; i < CHAPTERS.length; i++) {
    if (score >= CHAPTERS[i].need) idx = i;
  }
  return idx;
}

export function chapterFor(charId) {
  return CHAPTERS[chapterIndexFor(charId)];
}

// прогресс внутри истории: { index, chapter, next, percent }
export function chapterProgress(charId) {
  const score = scoreFor(charId);
  const idx = chapterIndexFor(charId);
  const cur = CHAPTERS[idx];
  const next = CHAPTERS[idx + 1] || null;
  const percent = next
    ? Math.min(100, Math.round(((score - cur.need) / (next.need - cur.need)) * 100))
    : 100;
  return { index: idx, chapter: cur, next, percent, score };
}

// реплики персонажа в зависимости от текущей главы
export const CHAPTER_LINES = {
  spark: [
    'Мне с тобой интересно. Это редкость — сразу так попасть в волну',
    'Кажется, это начало какой-то хорошей истории…',
  ],
  steps: [
    'Наше первое свидание уже позади. Уже есть что вспоминать 😊',
    'Я поймал(а) себя на том, что жду наших встреч',
  ],
  warmth: [
    'С тобой легко. Я даже не подбираю слова — это лучший признак',
    'Начинаю привыкать к тебе. Это опасно? 😄',
  ],
  trust: [
    'Тебе я могу рассказать то, что обычно держу при себе',
    'Спасибо, что ты есть. Серьёзно, я это ценю',
  ],
  closeness: [
    'Иногда я ловлю себя на мысли, что мы уже «мы»',
    'Мне кажется, я уже знаю тебя лучше, чем многих друзей',
  ],
  ours: [
    'С тобой я — дома. Где бы мы ни были',
    'Знаешь, что самое красивое? Что всё это началось с одного свайпа 😌',
  ],
};

export function chapterLine(charId) {
  const ch = chapterFor(charId);
  const pool = CHAPTER_LINES[ch.id] || CHAPTER_LINES.spark;
  return { line: pool[Math.floor(Math.random() * pool.length)], chapter: ch };
}
