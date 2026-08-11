// ─── Reply · чат и «мозг» собеседника (генеративный движок) ────────────────

import { BOT, QUESTIONS, TRIVIA, ACTIVITIES as ACTS_LIST, rand, rnd } from './data.js';
import { relationOf } from './state.js';
import { sound } from './audio.js';
import { getSeason, seasonLine } from './seasons.js';
import { chapterFor, chapterLine } from './chapters.js';
import { askAI, aiEnabled, getLastAIError } from './ai.js';

const ACTS = new Map(ACTS_LIST.map((a) => [a.id, a]));

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function chance(p) { return Math.random() < p; }

// ─── Темы и анализ сообщения ────────────────────────────────────────────────

const TOPIC_DEFS = [
  { id: 'travel', nom: 'путешествия', re: /путешеств|поездк|поехать|отпуск|заграниц|билет|побыв|съезд|аэропорт|поезд/ },
  { id: 'music', nom: 'музыка', re: /музык|песн|трек|плейлист|групп|концерт|исполнител|гитар|пианин|наушник|мелоди|клип/ },
  { id: 'film', nom: 'кино', re: /фильм|кино|сериал|посмотрел|трейлер|мульт|аниме|сеанс|актер|режиссер/ },
  { id: 'food', nom: 'еда', re: /еда|вкусн|голод|меню|заказ|поесть|попробу|блюд|десерт|съел|готов|рецепт|кухн|печь|борщ/ },
  { id: 'coffee', nom: 'кофе', re: /кофе|чай|капучино|латте|матча|американо|раф|эспрессо/ },
  { id: 'work', nom: 'работа', re: /работ|учёб|офис|проект|дедлайн|начальник|коллег|занят|смен|стаж/ },
  { id: 'dream', nom: 'мечты', re: /мечта|цель|хочу стать|план на|амбици|хотел/ },
  { id: 'pet', nom: 'животные', re: /кот|кошк|собак|животн|питом|хомяк|попугай|щенок|котенок|котик/ },
  { id: 'hobby', nom: 'хобби', re: /хобби|увлеч|люблю делать|свободное время|чем занимаешься|выходн/ },
  { id: 'books', nom: 'книги', re: /книг|чита|автор|роман|рассказ|поэт|стих|библиотек/ },
  { id: 'art', nom: 'искусство', re: /искусств|картин|рис|выставк|музей|галере|художник|твор/ },
  { id: 'games', nom: 'игры', re: /игр|играть|гейм|консол|квест|нард|шахмат|дота|геншин|genshin|мобилк|примогем/ },
  { id: 'weather', nom: 'погода', re: /погод|дожд|солнц|снег|ветер|облак|холодн|тепло|закат|рассвет|осень/ },
  { id: 'sport', nom: 'спорт', re: /спорт|бег|трен|зал|плав|велосипед|йог|фитнес|футбол|лыж/ },
  { id: 'deep', nom: 'жизнь', re: /боюсь|страшно|смысл|одиночеств|смерт|страх|грустн|философ|душа|время/ },
];

const INTENT_RE = {
  greet: /(привет|здравств|салют|добрый вечер|добрый день|доброе утро|рад тебя видеть|хай|йо|ку)/i,
  howareyou: /(как ты|как дела|как настроение|как жизнь|что нового|как ты вообще|как проходит твой)/i,
  name: /(как тебя зовут|как твое имя|как зовут|кто ты|ты кто|твое имя|как тебя называть)/i,
  compliment: /(красив|мил|симпатич|прекрасн|нравишься|очаровательн|обворожительн|шикарн|потрясн|классно выглядишь|ты такая|ты такой|у тебя красивые|обалден)/i,
  thanks: /(спасибо|благодар|выручил|мило с твоей стороны)/i,
  sorry: /(прости|извини|виноват|неловко|ляпнул)/i,
  bye: /(пока|до встречи|до завтра|спокойной ночи|бывай|увидимся)/i,
  love: /(я тебя люблю|влюбил|влюбилась|влюблен|влюблена)/i,
  flirt: /(поцелуй|обним|скучал|скучала|флирт|ты мне нравишься|хочу тебя обнять|нравлюсь тебе)/i,
  joke: /(хаха|ахах|лол|кек|😂|😄|шутк|анекдот|смешно|рассмеши|прикол|мем)/i,
};

const STOPWORDS = new Set(['если','когда','чтобы','потому','такой','такая','такие','очень','совсем','может','можно','нужно','просто','вообще','сегодня','завтра','вчера','себя','потом','сейчас','здесь','этот','этот','этой','этого','который','которая','какой','какая','какие','быть','был','была','было','были','будет','есть','нет','только','даже','уже','ещё','тоже','меня','тебя','мне','тебе','мой','моя','мои','твой','твоя','свой','своя','хорошо','плохо','также','прямо','очень']);

function detectTopics(text) {
  const t = text.toLowerCase();
  const found = [];
  for (const d of TOPIC_DEFS) {
    if (d.re.test(t)) found.push(d);
    if (found.length >= 2) break;
  }
  return found;
}

function extractKeywords(text) {
  const t = text.toLowerCase();
  const words = t.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3 && !STOPWORDS.has(w));
  return words.slice(0, 2);
}

function analyze(text) {
  const t = text.toLowerCase();
  return {
    topics: detectTopics(t),
    keywords: extractKeywords(t),
    isQuestion: /\?\s*$/.test(t) || /^(что|как|зачем|почему|где|когда|кто|какой|расскажи|хочешь|любишь|нравится|есть)\b/i.test(t),
    positive: /(нравится|люблю|класс|отлично|здорово|круто|весело|прикольно|супер|хорошо|рад|счастлив|обожаю|кайф|замечательно|прекрасно)/.test(t),
    negative: /(не нравится|ненавижу|плохо|ужасно|грустно|скучно|устал|устала|сложно|тяжело|обидно|расстроен|расстроена|плохой|не получилось|бесит)/.test(t),
    personal: /(я |у меня|мне |моя |мои |мой |моего|моем)/.test(t),
  };
}

// ─── Пул открывающих фраз и связок (собираются в живые ответы) ───────────────

const OPENER_POS = [
  'Ого, это здорово!', 'Слушай, а это же классно!', 'Улыбаюсь от твоих слов', 'Мне нравится, что ты об этом говоришь',
  'Вот это настроение!', 'Приятно такое слышать', 'О, я сразу зауважал(а) тебя ещё больше',
];
const OPENER_NEG = [
  'Ой… мне жаль.', 'Звучит непросто.', 'Я тебя понимаю.', 'Хочется тебя обнять, честно.',
  'Это обидно, когда так.', 'Слушай… сочувствую.',
];
const OPENER_Q = [
  'Хм, интересный вопрос.', 'Дай подумаю…', 'Хороший вопрос!', 'А вот это я как раз обдумывал(а) недавно.',
  'Ты задаёшь правильные вопросы.', 'Хм…',
];
const OPENER_NEUTRAL = [
  'Слушаю тебя.', 'Правда?', 'Ого.', 'Ммм.', 'Интересно.', 'Вот это поворот.', 'Рассказывай-рассказывай.',
];

const FOLLOWUPS_TOPIC = [
  (top) => `А вот ${top} — это отдельная тема. Что тебя в ней больше всего цепляет?`,
  (top) => `Слушай, а расскажи про ${top}? Я могу слушать бесконечно`,
  (top) => `А ты давно в этом?`,
  (top) => `Помню, ты про это заговорил(а) — и я сразу понял(а), что будет интересно`,
];
const FOLLOWUPS_GENERIC = [
  () => 'А у тебя как с этим?',
  () => 'Расскажи подробнее, мне правда важно',
  () => 'А ты что об этом думаешь?',
  () => 'Что тебя в этом больше всего зацепило?',
  () => 'А если бы можно было выбрать — ты бы что сделал(а)?',
  () => 'Теперь твоя очередь: что-нибудь ещё расскажешь?',
  () => 'Мне правда интересно — продолжи?',
  () => 'Звучит так, будто за этим есть история. Расскажешь?',
];

const GENERIC_TOPIC = {
  books: ['Книги — это способ прожить чужие жизни, не вставая с кресла', 'Я читаю перед сном — иначе не засыпаю', 'Иногда книга попадает в нужный момент — и это магия'],
  art: ['Искусство — это когда чувствуешь, что кто-то тебя понял', 'Люблю рассматривать картины и придумывать их истории', 'Красота вокруг — это то, что спасает в любой день'],
  games: ['Игры — это такие маленькие приключения, которые можно разделить с кем-то', 'Геншин? О, я как раз фармлю примогемы — кто твой мейн?', 'В играх можно побыть кем угодно — это и притягивает'],
  weather: ['Дождь за окном — лучший повод никуда не спешить', 'Мне нравится любая погода, если рядом нужный человек', 'Закаты — моё слабое место, всегда останавливаюсь посмотреть'],
  sport: ['Движение — это жизнь, звучит банально, но правда', 'Я не профи, но люблю гулять и плавать', 'Спорт для меня — это скорее про энергию, чем про рекорды'],
  deep: ['Мне кажется, главное — не бояться быть собой', 'Иногда я думаю об этом ночью. Спасает музыка', 'Глубокие темы — мои любимые, они делают нас ближе'],
};

// ─── Генеративный мозг собеседника ──────────────────────────────────────────

export class ChatBrain {
  constructor({ character, location, activities, user, onPartnerSays, onSystem, onStats, onVoice, onPropose }) {
    this.char = character;
    this.loc = location;
    this.activities = activities || [];
    this.user = user || null;
    this.onPartnerSays = onPartnerSays;
    this.onSystem = onSystem;
    this.onStats = onStats;
    this.onVoice = onVoice;
    this.onPropose = onPropose;
    this.stats = { trust: 0, comfort: 0, humor: 0, sympathy: 0, romance: 0 };
    this.topics = new Set();
    this.usedQuestions = [];
    this.usedEvents = [];
    this.msgCount = 0;
    this.timers = [];
    this.quiz = null;
    this.game = null;
    this.person = character.personality;
    this.rel = relationOf(character.id);
    this.memory = [];
    this.history = [];
    this.usedActivities = new Set();
    this.season = getSeason();
    this.chapter = chapterFor(character.id);
    this.aiQuiet = false;
    this.aiQuietAt = 0;
    this.dead = false;
    this._usedIdx = {};
    this.evaluations = []; // v1.3.3: помнит что было хорошо/плохо/странно/ужасно
    this.momentsLog = []; // логи действий: заказ, цветок и тд
  }

  _addStat(k, v) {
    this.stats[k] = (this.stats[k] || 0) + v;
    if (this.onStats) this.onStats(k, v);
  }

  _delay(text) {
    let d = 900 + Math.min(1800, text.length * 28);
    if (this.person.shy > 0.3) d += 500;
    if (this.person.think && rnd(this.person.think)) d += 900;
    if (rnd(0.06)) d += 6000;
    return d;
  }

  _say(text, opts = {}) {
    if (this.dead) return;
    if (opts.record !== false) {
      this.history.push({ role: 'assistant', text });
      if (this.history.length > 40) this.history = this.history.slice(-40);
    }
    const delay = opts.delay !== undefined ? opts.delay : this._delay(text);
    this.onPartnerSays(text, { ...opts, delay });
  }

  async _tryAI(text) {
    if (!aiEnabled()) return null;
    if (this.aiQuiet && Date.now() - this.aiQuietAt < 120000) return null;
    const reply = await askAI({
      character: this.char,
      location: this.loc,
      season: this.season,
      chapter: this.chapter,
      user: this.user,
      history: this.history,
      text,
      stats: this.stats,
      topics: Array.from(this.topics),
      evaluations: this.evaluations.slice(-8),
      moments: this.momentsLog.slice(-8),
    });
    if (reply) {
      this.aiQuiet = false;
      this.aiQuietAt = 0;
      return reply;
    }
    this.aiQuiet = true;
    this.aiQuietAt = Date.now();
    return null;
  }

  async _tryAIInitiative() {
    if (!aiEnabled()) return null;
    if (this.aiQuiet && Date.now() - this.aiQuietAt < 120000) return null;
    const reply = await askAI({
      character: this.char,
      location: this.loc,
      season: this.season,
      chapter: this.chapter,
      user: this.user,
      history: this.history,
      initiative: true,
      stats: this.stats,
      topics: Array.from(this.topics),
      evaluations: this.evaluations.slice(-8),
      moments: this.momentsLog.slice(-8),
    });
    if (reply) {
      this.aiQuiet = false;
      this.aiQuietAt = 0;
      return reply;
    }
    this.aiQuiet = true;
    this.aiQuietAt = Date.now();
    return null;
  }

  _emojiLine(text) {
    if (chance(this.person.emoji)) {
      const em = pick(['😊', '😄', '🙃', '✨', '💭', '🥰', '😌', '🌙', '🎶']);
      return text + ' ' + em;
    }
    return text;
  }

  _pickNoRepeat(pool, key) {
    if (!pool.length) return '';
    const last = this._usedIdx[key] ?? -1;
    let i = Math.floor(Math.random() * pool.length);
    if (i === last && pool.length > 1) i = (i + 1) % pool.length;
    this._usedIdx[key] = i;
    return pool[i];
  }

  _isGibberish(text, a) {
    const t = text.trim().toLowerCase();
    if (t.length < 2) return false;
    if (a.topics.length || a.isQuestion || a.positive || a.negative || a.personal) return false;
    if (t.includes(' ')) return false;
    if (/^(привет|пока|геншин|genshin|спасибо|да|нет|ок|ага|угу|хай|йо)$/i.test(t)) return false;
    if (t.length >= 4 && t.length <= 14 && /^[a-zа-яё0-9]+$/i.test(t)) {
      const vowels = (t.match(/[aeiouаеёиоуыэюя]/gi) || []).length;
      if (vowels / t.length < 0.22) return true;
      if (t.length >= 8) return true;
    }
    if (/^(.)\1{3,}/.test(t)) return true;
    if (/^[^aeiouаеёиоуыэюя]{5,}$/.test(t)) return true;
    return false;
  }

  // оценка сообщения: хорошо/плохо/странно/ужасно — чтобы ИИ помнил
  _evaluate(text, a) {
    const t = text.toLowerCase();
    let type = null;
    let note = '';
    if (this._isGibberish(text, a)) {
      type = 'strange';
      note = 'Пользователь написал что-то непонятное/шифр';
    } else if (/(ужасно|кошмар|отвратительно|ужас|ненавижу)/i.test(t)) {
      type = 'terrible';
      note = 'Пользователь считает что-то ужасным';
    } else if (a.negative) {
      type = 'bad';
      note = 'Пользователь расстроен или ему что-то не понравилось';
    } else if (/(странно|чудно|необычно|подозрительно)/i.test(t)) {
      type = 'strange';
      note = 'Пользователь считает что-то странным';
    } else if (a.positive || /(спасибо|классно|круто|отлично|здорово|кайф|супер)/i.test(t)) {
      type = 'good';
      note = 'Пользователь доволен, ему что-то понравилось';
    }
    if (type) {
      this.evaluations.push({ type, note, text: text.slice(0,120), ts: Date.now() });
      if (this.evaluations.length > 20) this.evaluations.shift();
      this.momentsLog.push({ kind: 'eval', type, text: text.slice(0,80) });
      if (this.momentsLog.length > 20) this.momentsLog.shift();
    }
    return type;
  }

  // v1.3.3: только ИИ, без шаблонного локального мозга
  async userSaid(raw) {
    const text = raw.trim();
    if (!text) return;
    this.msgCount++;
    this._addStat('comfort', 1);

    const a = analyze(text);
    this._evaluate(text, a);
    this.memory.push({ role: 'user', text, topics: a.topics, kw: a.keywords });
    if (this.memory.length > 24) this.memory.shift();
    this.history.push({ role: 'user', text });
    if (this.history.length > 40) this.history = this.history.slice(-40);
    if (a.topics.length) a.topics.forEach(t=>this.topics.add(t.id));

    // только Groq, без шаблона (по просьбе) — v1.3.4 с памятью хорошо/плохо/странно/ужасно
    const reply = await this._tryAI(text);
    if (reply) {
      this._say(this._emojiLine(reply), { emote: a.negative ? 'shy' : a.positive ? 'happy' : a.isQuestion ? 'think' : 'happy', ai: true });
    } else {
      const lastErr = getLastAIError ? getLastAIError() : null;
      if (lastErr && lastErr.type === 'no_key') {
        this._say('🤖 Groq ключ не задан. На Vercel: Settings → Environment Variables → GROQ_API_KEY=gsk_... → Redeploy. Локально: GROQ_API_KEY=... python3 server.py', { emote: 'think', emoji: '🤖', kind: 'system' });
      } else if (lastErr && lastErr.type === 'groq_error') {
        const det = (lastErr.detail||'').slice(0,200);
        this._say(`🤖 Groq ошибка: ${det||'модель недоступна'}. Попробуй позже. На Vercel проверь ключ и логи функции /api/ai.`, { emote: 'think', emoji: '🤖', kind: 'system' });
      } else {
        this._say('🤖 Groq сейчас недоступен в превью Arena (сеть закрыта). Локально: GROQ_API_KEY=... python3 server.py → http://localhost:8080 — там живой Llama 3.3 (openai/gpt-oss-120b). Он помнит что было хорошо/плохо/странно/ужасно.', { emote: 'think', emoji: '🤖', kind: 'system' });
      }
    }
  }

  _lastDateMemo() {
    return 'ты заказывал(а) ' + pick(['тирамису', 'капучино', 'что-то невероятно вкусное']) + ' в ' + pick(['нашем месте', 'том ресторане']) + '?';
  }

  start() {
    setTimeout(() => {
      const greets = [
        `Привет! Я уже здесь. ${this.loc.name} — отличный выбор, кстати`,
        `Ну что, я на месте! ${this.loc.emoji} Ты как раз вовремя`,
        `Привет! Уже устроился(ась) с комфортом. Присоединяйся!`,
        `Здравствуй! Сижу и думаю: «как же хорошо, что мы это придумали»`,
      ];
      this._say(pick(greets), { emote: 'happy', emoji: '👋', delay: 1500 });
      this._addStat('comfort', 1);
    }, 1200);

    if (this.activities.includes('questions')) {
      setTimeout(() => this.startQuestions(), 6000);
    }

    const evLoop = () => {
      const t = setTimeout(() => {
        if (this.loc.randomEvents && this.loc.randomEvents.length) {
          const ev = pick(this.loc.randomEvents);
          if (!this.usedEvents.includes(ev)) {
            this.usedEvents.push(ev);
            this.onSystem(ev.icon + ' ' + ev.text);
            setTimeout(() => {
              this._say(ev.reply, { emote: 'happy', emoji: '✨' });
              this._addStat('comfort', 1);
              this._addStat('humor', 0.5);
            }, 2200);
          }
        }
        evLoop();
      }, 60000 + Math.random() * 60000);
      this.timers.push(t);
    };
    evLoop();

    const initLoop = () => {
      const t = setTimeout(() => {
        this._initiative();
        initLoop();
      }, 35000 + Math.random() * 45000);
      this.timers.push(t);
    };
    initLoop();
  }

  _initiative() {
    if (this.msgCount < 2) return;
    if (this._lastInit && Date.now() - this._lastInit < 30000) return;
    this._lastInit = Date.now();

    const availActs = (this.activities || []).filter((id) => !this.usedActivities.has(id));
    const relDates = this.rel.datesCount || 0;

    const kinds = [];
    if (availActs.length && chance(0.45)) kinds.push('proposal');
    if (relDates > 0 && chance(0.5)) kinds.push('memory');
    if (chance(0.35)) kinds.push('season');
    if (this.chapter && this.chapter.id !== 'spark' && chance(0.3)) kinds.push('chapter');
    kinds.push('spontaneous');
    const kind = pick(kinds);

    const emote = kind === 'memory' ? 'think' : kind === 'chapter' ? 'love' : 'happy';
    const aiPromise = kind === 'proposal' ? Promise.resolve(null) : this._tryAIInitiative();
    aiPromise.then((aiLine) => {
      if (this.dead) return;
      if (aiLine) {
        this._say(this._emojiLine(aiLine), { emote, ai: true });
        this._addStat('comfort', 1);
        return;
      }
      if (kind === 'proposal') {
        const id = pick(availActs);
        const act = ACTS.get(id);
        if (!act) return;
        const pool = [
          `Слушай, а давай ${act.name.toLowerCase()}? ${act.emoji} Я как раз об этом думал(а)`,
          `Знаешь, что сейчас было бы идеально? ${act.name} ${act.emoji} Как думаешь?`,
          `Мне тут пришло в голову: ${act.name.toLowerCase()} ${act.emoji} Составишь компанию?`,
        ];
        this._say(this._emojiLine(pick(pool)), { emote: 'think', kind: 'proposal', activityId: id, label: '💡 Давай!' });
        this._addStat('comfort', 1);
        return;
      }
      if (kind === 'memory') {
        const pool = [
          'Помнишь наше прошлое свидание? Я до сих пор вспоминаю, как мы смеялись',
          'Когда вспоминаю, как мы встретились… до сих пор мурашки',
        ];
        this._say(this._emojiLine(pick(pool)), { emote: 'think', emoji: '💭' });
        this._addStat('trust', 1);
        return;
      }
      if (kind === 'season') {
        this._say(this._emojiLine(seasonLine()), { emote: 'happy' });
        this._addStat('comfort', 1);
        return;
      }
      if (kind === 'chapter') {
        const cl = chapterLine(this.char.id);
        this._say(this._emojiLine(cl.line), { emote: 'love' });
        this._addStat('romance', 1);
        return;
      }
      const pool = [
        'Я сейчас поймал(а) себя на мысли, что мне хорошо. Просто хорошо, без причин',
        'Слушай, а ты веришь в знаки? Вот наша встреча — точно знак',
        'Знаешь, что я понял(а)? С тобой даже молчать — приятно',
      ];
      this._say(this._emojiLine(pick(pool)), { emote: this.person.shy > 0.3 ? 'blush' : 'happy' });
      this._addStat('comfort', 1);
    });
  }

  trigger(id) {
    this.usedActivities.add(id);
    // логируем как хорошее действие для памяти ИИ
    this.evaluations.push({ type: 'good', note: `Пользователь выбрал активность ${id}`, text: id, ts: Date.now() });
    this.momentsLog.push({ kind: 'activity', id, type: 'good' });
    switch (id) {
      case 'coffee': case 'dessert': {
        const item = this.loc.menu.find((m) => (id === 'coffee' ? /кофе|латте|капучино|матча|американо|шоколад/i.test(m.name) : /десерт|торт|пирог|тирамису|чизкейк|сорбет|дайфуку|печенье/i.test(m.name))) || this.loc.menu[1];
        return { type: 'order', item };
      }
      case 'questions': this.startQuestions(); return null;
      case 'quiz': return this.startQuiz();
      case 'minigame': return this.startGame();
      case 'music':
        this._addStat('comfort', 2); this._addStat('romance', 1);
        this._say('Отличная идея. Я как раз подобрал(а) плейлист для этого вечера 🎧', { emote: 'happy' });
        return { type: 'music' };
      case 'sunset':
        this._addStat('romance', 3); this._addStat('comfort', 1);
        this._say('Смотри, небо уже розовеет… Идеальный момент. Спасибо, что предложил(а)', { emote: 'love', emoji: '🌇' });
        return { type: 'sunset' };
      case 'stars':
        this._addStat('romance', 2); this._addStat('trust', 1);
        this._say('Звёзды… Глядя на них, все проблемы кажутся маленькими', { emote: 'love', emoji: '🌠' });
        return { type: 'stars' };
      case 'flower':
        this._addStat('romance', 4); this._addStat('sympathy', 2);
        this._say('Это мне?! 🌹 Я… спасибо. Правда, очень приятно', { emote: 'blush', emoji: '🌹' });
        return { type: 'flower' };
      case 'photo':
        this._addStat('sympathy', 3); this._addStat('romance', 2);
        this._say('Давай! Встань ближе. Это будет наше первое совместное фото 🤳', { emote: 'happy', emoji: '📸' });
        return { type: 'photo' };
      case 'film':
        this._addStat('romance', 2);
        this._say('Тссс… начинается 🤫 (Но я всё равно буду шептать тебе комментарии)', { emote: 'happy' });
        return { type: 'film' };
      case 'ducks':
        this._addStat('humor', 2); this._addStat('comfort', 1);
        this._say('Осторожно, они чувствуют хлеб за километр. Сейчас будет очередь 🦆', { emote: 'laugh' });
        return { type: 'ducks' };
      case 'art':
        this._addStat('trust', 2); this._addStat('comfort', 1);
        this._say('Смотри на эту картину… Я вижу в ней что-то своё. А ты?', { emote: 'think' });
        return { type: 'art' };
      case 'arcade':
        this._addStat('humor', 2); this._addStat('sympathy', 1);
        this._say('Спорим, я поставлю рекорд? Хотя нет, не спорю — боюсь проиграть 🕹️', { emote: 'laugh' });
        return { type: 'arcade' };
      case 'tea':
        this._addStat('trust', 2); this._addStat('comfort', 2);
        this._say('Чайная церемония — это про замедлиться. Идеально для нас', { emote: 'happy' });
        return { type: 'tea' };
      case 'board':
        this._addStat('humor', 3); this._addStat('comfort', 2);
        this._say('Настолки — это законный повод подкалывать друг друга. Я начинаю 🎲', { emote: 'laugh' });
        return { type: 'board' };
      case 'movie_coop':
        this._addStat('romance', 3); this._addStat('comfort', 2);
        this._say('Совместный просмотр — это моя любовь. Выбирай фильм, я за попкорном 🍿', { emote: 'happy' });
        return { type: 'movie_coop' };
      case 'voice_date':
        this._addStat('romance', 2); this._addStat('trust', 2);
        return { type: 'voice' };
      default: return null;
    }
  }

  startQuestions() {
    if (!this.activities.includes('questions')) return;
    if (this._lastQ && Date.now() - this._lastQ < 8000) return;
    this._lastQ = Date.now();
    const avail = QUESTIONS.filter((q) => !this.usedQuestions.includes(q));
    if (!avail.length) return;
    const q = pick(avail);
    this.usedQuestions.push(q);
    this._addStat('trust', 2); this._addStat('comfort', 1);
    this.onSystem('🃏 Карточка вопроса');
    this._say(q, { emote: 'think', emoji: '🃏', kind: 'question' });
  }

  startQuiz() {
    if (this.quiz) return;
    const t = pick(TRIVIA);
    this.quiz = { ...t, round: 0 };
    this._addStat('humor', 1);
    this.onSystem('❓ Викторина · раунд 1');
    this._say(t.q, { emote: 'think', emoji: '❓' });
    return { type: 'quiz', q: t };
  }

  answerQuiz(idx) {
    if (!this.quiz) return null;
    const q = this.quiz;
    const ok = idx === q.ok;
    this.quiz = null;
    if (ok) {
      this._addStat('humor', 2); this._addStat('sympathy', 1);
      this.evaluations.push({ type: 'good', note: 'Пользователь правильно ответил в викторине', text: q.q.slice(0,60), ts: Date.now() });
      this._say('Вау, верно! Ты гений. Я впечатлён(а) 🏆', { emote: 'happy' });
    } else {
      this._addStat('humor', 1);
      this.evaluations.push({ type: 'bad', note: 'Пользователь ошибся в викторине', text: q.q.slice(0,60), ts: Date.now() });
      this._say(`Ахах, почти! Правильный ответ: ${q.a[q.ok]} 😄`, { emote: 'laugh' });
    }
    return { type: 'quizResult', ok };
  }

  startGame() {
    if (this.game) return null;
    this.game = { wins: 0, round: 0 };
    this._addStat('humor', 1);
    this.onSystem('🎯 Мини-игра · камень-ножницы-бумага');
    this._say('Давай! Три раунда. Победитель выбирает следующий тост 🥂', { emote: 'laugh' });
    return { type: 'game' };
  }

  playGame(move) {
    if (!this.game) return null;
    const moves = ['✊', '✋', '✌️'];
    const partnerMove = pick(moves);
    const win = (move === '✊' && partnerMove === '✌️') || (move === '✋' && partnerMove === '✊') || (move === '✌️' && partnerMove === '✋');
    const draw = move === partnerMove;
    this.game.round++;
    if (win) this.game.wins++;
    let reply;
    if (win) { this._addStat('humor', 2); reply = 'Ого, ты выиграл(а)! Ладно, справедливо 😤'; this.evaluations.push({ type: 'good', note: 'Пользователь выиграл в игре', ts: Date.now() }); }
    else if (draw) { this._addStat('humor', 1); reply = 'Ничья! Значит, мы одинаковые'; }
    else { this._addStat('humor', 2); reply = 'Ха! Моя победа. Следующий раунд за мной 😎'; this.evaluations.push({ type: 'bad', note: 'Пользователь проиграл в игре', ts: Date.now() }); }
    const finished = this.game.round >= 3;
    const res = { type: 'gameResult', partnerMove, win, draw, finished, finalWin: this.game.wins >= 2 };
    this.game = finished ? null : this.game;
    setTimeout(() => {
      this._say(reply, { emote: win ? 'happy' : 'laugh' });
      if (finished) {
        setTimeout(() => this._say(this.game?.wins>=2 ? 'Итог: победа за мной! Но ты играл(а) красиво' : 'Ладно, твоя взяла. Я поддамся в следующий раз 😄', { emote: 'happy' }), 1600);
      }
    }, 900);
    return res;
  }

  voiceMessage() {
    const label = `${this.char.voice}`;
    this._addStat('romance', 1);
    return { type: 'voice', src: label };
  }

  orderFood(item) {
    this._addStat('comfort', 1);
    this._addStat('sympathy', 0.5);
    this.evaluations.push({ type: 'good', note: `Заказ: ${item.name}`, text: item.name, ts: Date.now() });
    this.momentsLog.push({ kind: 'order', name: item.name, type: 'good' });
    this._say(pick([
      'Ого, отличный выбор! 😍',
      'Ммм, это выглядит божественно',
      'Ты угадал(а) мои мысли!',
    ]), { emote: 'happy', emoji: '😋' });
  }

  photoDone() {
    this._addStat('sympathy', 2); this._addStat('romance', 1);
    this.evaluations.push({ type: 'good', note: 'Совместное фото сделано', ts: Date.now() });
    this._say('Смотри, какой кадр! Это теперь наша история 📸', { emote: 'love', emoji: '📸' });
  }

  userVoice() {
    this._addStat('comfort', 1);
    this._say('Голосовое?.. Хм, у тебя приятный голос. Неожиданно', { emote: 'blush', emoji: '😳' });
  }

  filmStarted() {
    this._addStat('romance', 1);
  }

  destroy() {
    this.dead = true;
    this.timers.forEach(clearTimeout);
  }
}


// ─── Панель чата ─// ─── Панель чата ────────────────────────────────────────────────────────────

export class ChatPanel {
  constructor(container, { scene, brain, character, onSend, onMenu, onActivity, onExpand, onFinish, onVoice, onPropose }) {
    this.container = container;
    this.scene = scene;
    this.brain = brain;
    this.char = character;
    this.onSend = onSend;
    this.onMenu = onMenu;
    this.onActivity = onActivity;
    this.onExpand = onExpand;
    this.onFinish = onFinish;
    this.onVoice = onVoice;
    this.onPropose = onPropose;
    this.el = null;
    this.messagesEl = null;
    this.inputEl = null;
    this.typingEl = null;
    this.render();
  }

  render() {
    const el = document.createElement('div');
    el.className = 'chat-sheet';
    el.innerHTML = `
      <div class="chat-handle"></div>
      <div class="chat-head">
        <div class="ch-avatar">${this.char.avatarImg ? `<img src="${this.char.avatarImg}" alt="">` : this.char.avatarEmoji}</div>
        <div class="ch-info">
          <div class="ch-name">${this.char.name} <span class="ch-online">● в сети</span></div>
          <div class="ch-mood">${this.char.mood}</div>
        </div>
        <div class="ch-timer">⏳ 30:00</div>
        <button class="ch-btn ch-expand" title="Развернуть">⤢</button>
      </div>
      <div class="chat-actions">
        <button class="act-chip act-menu">📋 Меню</button>
        <div class="act-scroll"></div>
        <button class="act-chip act-finish">🚪 Завершить</button>
      </div>
      <div class="chat-messages"></div>
      <div class="chat-input">
        <button class="ci-voice">🎤</button>
        <input class="ci-field" type="text" placeholder="Напишите что-нибудь…" autocomplete="off">
        <button class="ci-send">➤</button>
      </div>
    `;
    this.container.appendChild(el);
    this.el = el;
    this.messagesEl = el.querySelector('.chat-messages');
    this.inputEl = el.querySelector('.ci-field');
    this.typingEl = null;
    this.timerEl = el.querySelector('.ch-timer');
    const scrollEl = el.querySelector('.act-scroll');

    // активности
    this.brain.activities.forEach((id) => {
      const act = ACTS.get(id);
      if (!act) return;
      const chip = document.createElement('button');
      chip.className = 'act-chip';
      chip.innerHTML = `${act.emoji} ${act.name}`;
      chip.addEventListener('click', () => this.onActivity && this.onActivity(id));
      scrollEl.appendChild(chip);
    });
    if (!scrollEl.children.length) scrollEl.style.display = 'none';

    el.querySelector('.act-menu').addEventListener('click', () => this.onMenu && this.onMenu());
    el.querySelector('.act-finish').addEventListener('click', () => this.onFinish && this.onFinish());
    const toggleFullscreen = () => {
      const isExp = el.classList.toggle('expanded');
      // стрелка ⤢ — покрывает весь экран чатом, повтор — возвращает
      const ds = this.container.closest ? this.container.closest('.date-screen') : document.querySelector('.date-screen');
      const target = ds || document.querySelector('.date-screen');
      if (target) target.classList.toggle('chat-expanded', isExp);
      const btn = el.querySelector('.ch-expand');
      if (btn) btn.textContent = isExp ? '⤡' : '⤢';
      if (this.onExpand) this.onExpand(isExp);
      this.scrollDown();
    };
    el.querySelector('.ch-expand').addEventListener('click', toggleFullscreen);
    el.querySelector('.chat-handle').addEventListener('click', toggleFullscreen);
    el.querySelector('.ci-send').addEventListener('click', () => this.submit());
    el.querySelector('.ci-voice').addEventListener('click', () => this.onVoice && this.onVoice());
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.submit();
    });
  }

  submit() {
    const text = this.inputEl.value.trim();
    if (!text) return;
    this.inputEl.value = '';
    this.addMessage('user', text);
    sound.send();
    this.onSend && this.onSend(text);
  }

  addMessage(from, text, opts = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + (from === 'user' ? 'msg-user' : 'msg-partner');

    if (opts.kind === 'system') {
      wrap.className = 'msg-system';
      wrap.innerHTML = `<span>${text}</span>`;
    } else if (opts.kind === 'proposal') {
      wrap.className = 'msg msg-partner msg-proposal';
      wrap.innerHTML = `
        <div class="msg-bubble proposal-bubble">
          <div class="q-tag">💡 ${opts.tag || 'Инициатива'}</div>
          ${text.replace(/</g, '&lt;')}
          <button class="prop-btn">${opts.label || 'Давай!'}</button>
        </div>`;
      const btn = wrap.querySelector('.prop-btn');
      btn.addEventListener('click', () => {
        btn.disabled = true;
        btn.textContent = '✅';
        this.onPropose && this.onPropose(opts.activityId);
      });
    } else if (opts.kind === 'voice') {
      wrap.innerHTML = `
        <div class="msg-bubble voice-bubble">
          <button class="vb-play">▶</button>
          <div class="vb-wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
          <span class="vb-time">0:${opts.secs || 18}</span>
        </div>`;
      const btn = wrap.querySelector('.vb-play');
      let audio = null;
      btn.addEventListener('click', () => {
        if (audio && !audio.paused) { audio.pause(); btn.textContent = '▶'; return; }
        if (!audio) { audio = new Audio(opts.src); audio.addEventListener('ended', () => { btn.textContent = '▶'; wrap.classList.remove('playing'); }); }
        btn.textContent = '⏸';
        wrap.classList.add('playing');
        audio.play();
      });
    } else if (opts.kind === 'question') {
      wrap.innerHTML = `<div class="msg-bubble"><div class="q-tag">🃏 Вопрос</div>${text}</div>`;
    } else {
      // v1.2.7: без плашек AI — реплики внешней модели неотличимы от живого общения
      wrap.innerHTML = `<div class="msg-bubble">${text.replace(/</g, '&lt;')}</div>`;
      if (opts.emoji && opts.emoji !== '👋') {
        const e = document.createElement('div');
        e.className = 'msg-reaction';
        e.textContent = opts.emoji;
        wrap.appendChild(e);
        setTimeout(() => e.classList.add('pop'), 50);
      }
    }
    this.messagesEl.appendChild(wrap);
    this.scrollDown();
    return wrap;
  }

  typing(on) {
    if (on) {
      if (!this.typingEl) {
        this.typingEl = document.createElement('div');
        this.typingEl.className = 'msg msg-partner';
        this.typingEl.innerHTML = '<div class="msg-bubble typing-dots"><i></i><i></i><i></i></div>';
        this.messagesEl.appendChild(this.typingEl);
        this.scrollDown();
      }
    } else if (this.typingEl) {
      this.typingEl.remove();
      this.typingEl = null;
    }
  }

  scrollDown() {
    requestAnimationFrame(() => {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    });
  }

  setTimer(text) {
    if (this.timerEl) this.timerEl.textContent = text;
  }

  setMood(mood) {
    const m = this.el.querySelector('.ch-mood');
    if (m) m.textContent = mood;
  }
}
