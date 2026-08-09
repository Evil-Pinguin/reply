// ─── Reply · чат и «мозг» собеседника (генеративный движок) ────────────────

import { BOT, QUESTIONS, TRIVIA, ACTIVITIES as ACTS_LIST, rand, rnd } from './data.js';
import { relationOf } from './state.js';
import { sound } from './audio.js';
import { getSeason, seasonLine } from './seasons.js';
import { chapterFor, chapterLine } from './chapters.js';
import { askAI, aiEnabled } from './ai.js';

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
  { id: 'games', nom: 'игры', re: /игр|играть|гейм|консол|квест|нард|шахмат|дота/ },
  { id: 'weather', nom: 'погода', re: /погод|дожд|солнц|снег|ветер|облак|холодн|тепло|закат|рассвет|осень/ },
  { id: 'sport', nom: 'спорт', re: /спорт|бег|трен|зал|плав|велосипед|йог|фитнес|футбол|лыж/ },
  { id: 'deep', nom: 'жизнь', re: /боюсь|страшно|смысл|одиночеств|смерт|страх|грустн|философ|душа|время/ },
];

const INTENT_RE = {
  greet: /(привет|здравств|салют|добрый вечер|добрый день|доброе утро|рад тебя видеть|хай|йо|ку)/i,
  howareyou: /(как ты|как дела|как настроение|как жизнь|что нового|как ты вообще|как проходит твой)/i,
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

const FOLLOWUPS = [
  (top) => `А вот ${top} — это отдельная тема. Что тебя в ней больше всего цепляет?`,
  (top) => `Слушай, а расскажи про ${top}? Я могу слушать бесконечно`,
  (top) => `А ты давно в этом?` ,
  (top) => `Помню, ты про это заговорил(а) — и я сразу понял(а), что будет интересно`,
  () => 'А у тебя как с этим?',
  () => 'Расскажи подробнее, мне правда важно',
  () => 'А ты что об этом думаешь?',
  () => 'Что тебя в этом больше всего зацепило?',
  () => 'А если бы можно было выбрать — ты бы что сделал(а)?',
  () => 'Теперь твоя очередь: что-нибудь ещё расскажешь?',
];

const GENERIC_TOPIC = {
  books: ['Книги — это способ прожить чужие жизни, не вставая с кресла', 'Я читаю перед сном — иначе не засыпаю', 'Иногда книга попадает в нужный момент — и это магия'],
  art: ['Искусство — это когда чувствуешь, что кто-то тебя понял', 'Люблю рассматривать картины и придумывать их истории', 'Красота вокруг — это то, что спасает в любой день'],
  games: ['Игры — это такие маленькие приключения, которые можно разделить с кем-то', 'Я не геймер-экстремал, но люблю уютные игры', 'В играх можно побыть кем угодно — это и притягивает'],
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
    this.memoryUsed = false;
    this.memory = [];          // память разговора {role,text,topics,kw}
    this.history = [];         // полный диалог {role:'user'|'assistant', text} для внешнего ИИ
    this.usedActivities = new Set(); // активности, уже предложенные/запущенные
    this.season = getSeason();       // текущий сезон живого мира
    this.chapter = chapterFor(character.id); // глава истории отношений
    this.aiQuiet = false;      // после сбоя внешнего ИИ не долбим сервер
    this.aiQuietAt = 0;        // время последней неудачной попытки (ретрай раз в 2 мин)
    this.dead = false;
    this._usedIdx = {};        // чтобы не повторять фразы подряд
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
    // ведём полный диалог для внешнего ИИ (системные заметки не записываем)
    if (opts.record !== false) {
      this.history.push({ role: 'assistant', text });
      if (this.history.length > 40) this.history = this.history.slice(-40);
    }
    const delay = opts.delay !== undefined ? opts.delay : this._delay(text);
    this.onPartnerSays(text, { ...opts, delay });
  }

  // ── внешний ИИ (Groq) с тихим фолбэком ────────────────────────────────────
  // после неудачи «затихаем», но раз в ~2 минуты пробуем снова:
  // если ключ добавили/эндпоинт ожил — ИИ подхватывается без перезагрузки
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
    });
    if (reply) {
      this.aiQuiet = false;
      this.aiQuietAt = 0;
      return reply;
    }
    this.aiQuiet = true;
    this.aiQuietAt = Date.now(); // ключа нет или сервер недоступен — локальный мозг
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

  // выбор без повторов подряд
  _pickNoRepeat(pool, key) {
    if (!pool.length) return '';
    const last = this._usedIdx[key] ?? -1;
    let i = Math.floor(Math.random() * pool.length);
    if (i === last && pool.length > 1) i = (i + 1) % pool.length;
    this._usedIdx[key] = i;
    return pool[i];
  }

  // ── анализ и композиция ответа ────────────────────────────────────────────
  _compose(a, text) {
    const parts = [];
    const views = this.char.views || {};
    const top = a.topics[0];

    // открывающая фраза по тону
    let opener;
    if (a.negative) opener = this._pickNoRepeat(OPENER_NEG, 'op-neg');
    else if (a.positive) opener = this._pickNoRepeat(OPENER_POS, 'op-pos');
    else if (a.isQuestion) opener = this._pickNoRepeat(OPENER_Q, 'op-q');
    else opener = this._pickNoRepeat(OPENER_NEUTRAL, 'op-n');
    parts.push(opener);

    // личный взгляд персонажа по теме (или общий)
    let content = null;
    if (top && views[top.id]) content = this._pickNoRepeat(views[top.id], 'view-' + top.id);
    else if (top && BOT.topics[top.id]) content = pick(BOT.topics[top.id]);
    else if (top && GENERIC_TOPIC[top.id]) content = this._pickNoRepeat(GENERIC_TOPIC[top.id], 'gen-' + top.id);
    if (content) {
      parts.push(this._emojiLine(content));
      this.topics.add(top.id);
    }

    // живой мир: иногда заметить сезон или главу истории
    if (chance(0.1) && !(top && top.id === 'weather')) {
      parts.push(this._emojiLine(seasonLine()));
    } else if (chance(0.08)) {
      parts.push(this._emojiLine(chapterLine(this.char.id).line));
    }

    // если пользователь поделился личным — отреагировать с интересом
    if (a.personal && !a.isQuestion && chance(0.7)) {
      const reacts = [
        'Спасибо, что делишься этим со мной',
        'Мне правда интересно то, что ты рассказываешь',
        'Я чувствую, что это важно для тебя',
        'Хочу знать о тебе ещё больше',
      ];
      parts.push(this._pickNoRepeat(reacts, 'pers'));
    }

    // сочувствие
    if (a.negative && chance(0.8)) {
      const warm = [
        'Если захочешь выговориться — я рядом',
        'Может, согреть тебе настроение?',
        'Хорошо, что ты это рассказываешь, а не держишь в себе',
      ];
      parts.push(this._pickNoRepeat(warm, 'warm'));
      this._addStat('trust', 1);
    }

    // вопрос в ответ (если тема известна — привязать к ней)
    if (a.isQuestion || chance(this.person.talk * 0.75)) {
      const fu = pick(FOLLOWUPS);
      if (top) parts.push(fu(top.nom));
      else parts.push(fu(null));
    }

    let reply = parts.filter(Boolean).join(' ');
    // иногда многоточия и вставные «ну», «слушай»
    if (chance(0.15) && !a.isQuestion) reply = 'Слушай, ' + reply.charAt(0).toLowerCase() + reply.slice(1);
    return reply;
  }

  _remember(a) {
    // отослать к памяти разговора: «кстати, ты говорил(а) про X»
    const currentIds = a.topics.map((t) => t.id);
    const prev = this.memory.find((m) => m.role === 'user' && m.topics.length && !currentIds.includes(m.topics[0].id));
    if (prev && chance(0.3)) {
      const nom = prev.topics[0].nom;
      const lines = [
        `Кстати, ты раньше говорил(а) про ${nom} — я всё думал(а) об этом`,
        `Помнишь, ты упоминал(а) ${nom}? Мне захотелось вернуться к этой теме`,
        `А помнишь, мы говорили про ${nom}? Я потом ещё размышлял(а)`,
      ];
      this._say(this._emojiLine(pick(lines)), { emote: 'think', emoji: '💭' });
      this._addStat('comfort', 1);
      return true;
    }
    return false;
  }

  async userSaid(raw) {
    const text = raw.trim();
    if (!text) return;
    this.msgCount++;
    this._addStat('comfort', 1);

    const a = analyze(text);
    this.memory.push({ role: 'user', text, topics: a.topics, kw: a.keywords });
    if (this.memory.length > 24) this.memory.shift();
    this.history.push({ role: 'user', text });
    if (this.history.length > 40) this.history = this.history.slice(-40);

    // ── интенты (короткие живые реакции) ──
    if (INTENT_RE.joke.test(text)) {
      this._addStat('humor', 2);
      const r = pick([
        'Ахахах 😂 Ты меня раскусил(а)',
        'Окей, это смешно. Записываю в цитаты',
        'Я чуть не поперхнулся(ась) от смеха!',
        'Твои шутки опасны. Мне нравится 😄',
        'Ладно, это было неожиданно смешно',
      ]);
      this._say(r, { emote: 'laugh', emoji: '😂' });
      this._scheduleSecond(a);
      return;
    }
    if (INTENT_RE.compliment.test(text)) {
      this._addStat('romance', 2); this._addStat('sympathy', 1);
      const r = pick([
        'Ахах, спасибо… Ты умеешь смущать 😳',
        'Это я-то?.. Ну, если ты так говоришь, я в это поверю',
        'Так, я покраснел(а). Это всё ты',
        'Говори ещё. Я записываю ✍️',
        'От такого комплимента даже вечер стал теплее',
      ]);
      this._say(r, { emote: 'blush', emoji: '😳' });
      return;
    }
    if (INTENT_RE.thanks.test(text)) {
      this._addStat('trust', 1);
      this._say(pick([
        'Всегда пожалуйста. Для тебя — хоть каждый день',
        'Не благодари, мне самому(ой) приятно',
        'Это мелочь. Но приятно, что ты заметил(а)',
        'Я рад(а), что тебе хорошо',
      ]), { emote: 'happy' });
      return;
    }
    if (INTENT_RE.sorry.test(text)) {
      this._say(pick([
        'Всё нормально, правда 😊',
        'Да ладно, я уже забыл(а). Рассказывай дальше',
        'За это я тебя прощаю. Но только один раз 😄',
        'Ничего страшного, ты мне всё равно нравишься',
      ]), { emote: 'happy' });
      return;
    }
    if (INTENT_RE.bye.test(text)) {
      this._say(pick([
        'Куда ты?.. Ладно, шучу. Но возвращайся',
        'Уже? А мне так хорошо… До встречи!',
        'Беги-беги. Я буду ждать следующего свидания 😊',
        'Напиши мне, когда дойдёшь. Правда, я буду скучать',
      ]), { emote: 'happy' });
      return;
    }
    if (INTENT_RE.love.test(text) || INTENT_RE.flirt.test(text)) {
      this._addStat('romance', 3); this._addStat('sympathy', 1);
      this._say(pick([
        'Ого… Так, мне нужно сесть. Точнее, я уже сижу. Но всё равно',
        'Ты сейчас серьёзно?.. У меня мурашки',
        'Я… не ожидал(а). Но мне очень приятно. Правда',
        'Если это флирт — то у тебя отлично получается 😌',
      ]), { emote: 'blush', emoji: '💗' });
      return;
    }
    if (INTENT_RE.howareyou.test(text)) {
      const moods = [
        this.stats.romance > 8 ? 'Лучше всех. Ты рядом, музыка играет — чего ещё желать' : null,
        this.stats.humor > 8 ? 'Супер! С тобой даже самый обычный вечер — как приключение' : null,
        'Если честно, волновался(ась) перед встречей. Теперь — спокойно',
        'Хорошо! Я как раз думал(а), о чём тебя спросить',
        'Тепло. Наверное, это из-за этого места… или из-за тебя',
      ].filter(Boolean);
      this._say(this._emojiLine(pick(moods)), { emote: 'happy' });
      return;
    }
    if (INTENT_RE.greet.test(text) && this.msgCount <= 3) {
      this._say(pick([
        'Привет-привет! Я уже заскучал(а) тут 😊',
        'Ну наконец-то! Я думал(а), ты потерялся(ась) 😄',
        'Привет! Сижу, улыбаюсь — и это твоя работа',
        'Здравствуй! Я как раз собирался(ась) тебе писать',
      ]), { emote: 'happy', emoji: '👋' });
      return;
    }

    // ── генеративный ответ: сначала внешний ИИ (Groq), фолбэк — локальный мозг ──
    let reply = await this._tryAI(text);
    if (reply !== null) {
      this._say(this._emojiLine(reply), { emote: a.negative ? 'shy' : a.positive ? 'happy' : a.isQuestion ? 'think' : 'happy', ai: true });
    } else {
      const local = this._compose(a, text);
      const emote = a.negative ? 'shy' : a.positive ? 'happy' : a.isQuestion ? 'think' : 'happy';
      this._say(this._emojiLine(local), { emote });
      // иногда вернуться к тому, о чём говорили раньше
      if (chance(0.18)) this._remember(a);
    }
    this._scheduleSecond(a);
  }

  // вторая короткая реплика — как живой человек, который дописывает
  _scheduleSecond(a) {
    if (!chance(this.person.talk * 0.3)) return;
    setTimeout(() => {
      const pool = [
        'Ну и ещё… ты мне нравишься, если что',
        'Кстати, а ты уже выбрал(а), что будешь заказывать?',
        'Мне нравится, как мы разговариваем',
        'Я, наверное, скажу глупость, но мне хорошо',
        'А знаешь, что я подумал(а)? Это лучший вечер за неделю',
        'Не обращай внимания, я просто размышляю вслух',
        'Слушай, а ты когда-нибудь загадывал(а) желания на закате?',
      ];
      this._say(this._emojiLine(pick(pool)), { emote: 'think', emoji: '💭' });
      this._addStat('comfort', 1);
    }, this._delay('') + 2600 + Math.random() * 2500);
  }

  _lastDateMemo() {
    return 'ты заказывал(а) ' + pick(['тирамису', 'капучино', 'что-то невероятно вкусное']) + ' в ' + pick(['нашем месте', 'том ресторане']) + '?';
  }

  // ── события свидания ──────────────────────────────────────────────────────
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

    // инициативы персонажа: партнёр сам пишет, предлагает активности,
    // вспоминает прошлое, говорит о сезоне и главе истории
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
    // не перебиваем активный диалог слишком часто
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

    // внешний ИИ может написать инициативу сам (кроме предложений активности:
    // у них есть интерактивная кнопка в чате)
    const aiPromise = kind === 'proposal' ? Promise.resolve(null) : this._tryAIInitiative();
    aiPromise.then((aiLine) => {
      if (this.dead) return;
      if (aiLine) {
        this._say(this._emojiLine(aiLine), { emote, ai: true });
        this._addStat('comfort', 1);
        return;
      }
      // локальные инициативы
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
          'Я рассказывал(а) друзьям про наше первое свидание. Они сказали, что мы слишком милые 😄',
          'А помнишь, что ты тогда рассказывал(а)? Я запомнил(а) навсегда',
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
      // spontaneous
      const pool = [
        'Я сейчас поймал(а) себя на мысли, что мне хорошо. Просто хорошо, без причин',
        'Слушай, а ты веришь в знаки? Вот наша встреча — точно знак',
        'У меня есть вопрос, но я стесняюсь… Ладно, потом',
        'Знаешь, что я понял(а)? С тобой даже молчать — приятно',
        'А хочешь, потом устроим ещё одно свидание? Я уже придумал(а), куда',
      ];
      this._say(this._emojiLine(pick(pool)), { emote: this.person.shy > 0.3 ? 'blush' : 'happy' });
      this._addStat('comfort', 1);
    });
  }

  // ── активности ────────────────────────────────────────────────────────────
  trigger(id) {
    this.usedActivities.add(id);
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
      this._say('Вау, верно! Ты гений. Я впечатлён(а) 🏆', { emote: 'happy' });
    } else {
      this._addStat('humor', 1);
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
    if (win) { this._addStat('humor', 2); reply = 'Ого, ты выиграл(а)! Ладно, справедливо 😤'; }
    else if (draw) { this._addStat('humor', 1); reply = 'Ничья! Значит, мы одинаковые'; }
    else { this._addStat('humor', 2); reply = 'Ха! Моя победа. Следующий раунд за мной 😎'; }
    const finished = this.game.round >= 3;
    const res = { type: 'gameResult', partnerMove, win, draw, finished, finalWin: this.game.wins >= 2 };
    this.game = finished ? null : this.game;
    setTimeout(() => {
      this._say(reply, { emote: win ? 'happy' : 'laugh' });
      if (finished) {
        setTimeout(() => this._say(finalWin ? 'Итог: победа за мной! Но ты играл(а) красиво' : 'Ладно, твоя взяла. Я поддамся в следующий раз 😄', { emote: 'happy' }), 1600);
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
    this._say(pick([
      'Ого, отличный выбор! 😍',
      'Ммм, это выглядит божественно',
      'Ты угадал(а) мои мысли!',
      'Я как раз на это смотрел(а)!',
      'Заказывай! Я поделюсь, если поделишься ты 😄',
      'Мне кажется, это будет вкусно. Особенно если есть вдвоём',
    ]), { emote: 'happy', emoji: '😋' });
  }

  photoDone() {
    this._addStat('sympathy', 2); this._addStat('romance', 1);
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

// ─── Панель чата ────────────────────────────────────────────────────────────

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
    el.querySelector('.ch-expand').addEventListener('click', () => {
      el.classList.toggle('expanded');
      this.onExpand && this.onExpand(el.classList.contains('expanded'));
      this.scrollDown();
    });
    el.querySelector('.chat-handle').addEventListener('click', () => {
      el.classList.toggle('expanded');
      this.scrollDown();
    });
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
