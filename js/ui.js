// ─── Reply · интерфейс и экраны ─────────────────────────────────────────────

import {
  APP, AVATARS, INTERESTS, GOALS, CITIES, MBTI_TYPES, MBTI_INFO, VALUES_LIST,
  HABITS_LIST, DAILY_SURPRISES, CHARACTERS, LOCATIONS, TIME_SLOTS,
  ACTIVITIES, ACHIEVEMENTS as _ACH, rand, shuffle, getChar, getLoc,
} from './data.js';
import {
  getState, setUser, getDeck, getFilteredDeck, remainingToday, nextCard, swipe, isMatched,
  planDate, hasPlanFor, planConflict, getPlan, removePlan, nextUpcoming,
  plannedDateTime, finishDate, addDiary, addLetter,
  addGallery, unlock, relationOf, compatibilityWith, togglePremium, setPremium, cancelPremium, resetAll,
  refreshDeck, save, collect, setChapter, collectionCount,
  getTheme, setTheme, applyTheme, getFilters, setFilters, getDailySurprise, claimDailySurprise,
} from './state.js';
import { sound } from './audio.js';
import { floatEmoji, burstHearts, confetti } from './effects.js';
import { DateScene } from './scene.js';
import { ChatBrain, ChatPanel } from './chat.js';
import { drawShareCard, drawDatePhoto } from './cards.js';
import { SEASONS, getSeason } from './seasons.js';
import { CHAPTERS, chapterProgress, chapterFor } from './chapters.js';
import { getAIMode, setAIMode, aiWasUsed } from './ai.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let app;
let current = null;      // текущая сессия экрана (таймеры, сцена…)
let currentTab = 'discover';
const cleanups = [];

function onGlobal(fn) { cleanups.push(fn); return fn; }
function clearScreen() {
  if (current?.destroy) { try { current.destroy(); } catch (e) { /* noop */ } }
  current = null;
  cleanups.splice(0).forEach((fn) => { try { fn(); } catch (e) { /* noop */ } });
  app.innerHTML = '';
}

export function init(root) {
  app = root;
  attachDelegated(root);
  const st = getState();
  if (!st.onboarded) return show('splash');
  return show('main');
}

// Глобальное делегирование кликов: capture-фаза + pointerup + fallback по координатам.
// Работает, даже если клик съедается перекрывающим слоем или обработчиком ниже.
function attachDelegated(root) {
  let lastKey = null;
  let lastTime = 0;
  const keyOf = (el) => {
    const id = el.dataset.plan || el.dataset.wait || el.dataset.cancel || el.dataset.meet || el.dataset.liOpen || '';
    const cardChar = el.closest && el.closest('[data-char]');
    return id + ':' + (cardChar ? cardChar.dataset.char : '');
  };

  const runAction = (el) => {
    if (!el || el.disabled) return false;
    if (el.dataset.wait) {
      show('waiting', { planId: el.dataset.wait });
    } else if (el.dataset.cancel) {
      removePlan(el.dataset.cancel);
      toast('Свидание отменено', '🗓');
      renderMain({ tab: 'dates' });
    } else if (el.dataset.plan) {
      show('planner', { charId: el.dataset.plan });
    } else if (el.dataset.meet) {
      const ch = getChar(el.dataset.meet);
      swipe(ch.id, 'like');
      maybeUnlock('first_match');
      sound.match();
      toast(`Это взаимно! ${ch.name} уже ждёт свидания`, '💞');
      show('planner', { charId: ch.id });
    } else if (el.hasAttribute('data-li-open')) {
      const item = el.closest('.letter-item');
      const txt = item && item.querySelector('.li-text');
      if (!txt) return true;
      txt.classList.toggle('open');
      el.textContent = txt.classList.contains('open') ? 'свернуть' : 'открыть';
    }
    return true;
  };

  const findTarget = (e) => {
    // 1) прямой предок по data-атрибутам
    const el = e.target && e.target.closest
      ? e.target.closest('[data-plan],[data-wait],[data-cancel],[data-meet],[data-li-open]')
      : null;
    if (el) return el;
    // 2) карточка заметченного персонажа целиком
    const card = e.target && e.target.closest ? e.target.closest('.rel-item[data-char]') : null;
    if (card) {
      const btn = card.querySelector('button[data-plan], button[data-wait]');
      return btn && !btn.disabled ? btn : null;
    }
    // 3) fallback по координатам: верхний элемент под пальцем
    if (e.clientX !== undefined && e.clientY !== undefined && typeof document.elementFromPoint === 'function') {
      try {
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        if (hit && hit !== e.target) {
          const viaHit = hit.closest('[data-plan],[data-wait],[data-cancel],[data-meet],[data-li-open]');
          if (viaHit) return viaHit;
        }
      } catch (err) { /* jsdom не реализует elementFromPoint */ }
    }
    return null;
  };

  const handle = (e) => {
    const el = findTarget(e);
    if (!el) return;
    const key = keyOf(el);
    const now = Date.now();
    // защита от двойного срабатывания click+pointerup только для той же кнопки
    if (key === lastKey && now - lastTime < 350) return;
    if (runAction(el)) {
      lastKey = key;
      lastTime = now;
      e.preventDefault();
      e.stopPropagation();
    }
  };

  root.addEventListener('click', handle, true);       // capture — до любых stopPropagation
  root.addEventListener('pointerup', handle, true);   // мгновенная реакция на тап
  root.addEventListener('touchend', (e) => {          // iOS-fallback
    if (!e.changedTouches) return;
    const pt = { clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY };
    const el = findTarget(pt);
    if (el && runAction(el)) {
      lastAction = Date.now();
      e.preventDefault();
    }
  }, true);
}

export function show(name, opts = {}) {
  clearScreen();
  app.style.display = 'block';
  sound.click();
  const renders = {
    splash: renderSplash,
    onboarding: renderOnboarding,
    main: renderMain,
    planner: renderPlanner,
    waiting: renderWaiting,
    date: renderDate,
    recap: renderRecap,
    premium: renderPremium,
  };
  (renders[name] || renderMain)(opts);
}

// ─── Тост и достижения ──────────────────────────────────────────────────────

let toastTimer;
export function toast(text, emoji = '✨') {
  let t = $('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    app.appendChild(t);
  }
  t.innerHTML = `<span class="t-emoji">${emoji}</span><span>${esc(text)}</span>`;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

let achQueue = [];
let achShowing = false;
function achPopup(a) {
  achQueue.push(a);
  if (achShowing) return;
  achShowing = true;
  const pop = () => {
    const item = achQueue.shift();
    if (!item) { achShowing = false; return; }
    const el = document.createElement('div');
    el.className = 'ach-pop';
    el.innerHTML = `<div class="ach-emoji">${item.emoji}</div><div class="ach-body"><div class="ach-name">${item.name}</div><div class="ach-desc">${item.desc}</div></div>`;
    app.appendChild(el);
    sound.coin();
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => { el.remove(); pop(); }, 400); }, 2600);
  };
  pop();
}

function maybeUnlock(id) {
  const a = _ACH.find((x) => x.id === id);
  if (a && unlock(id)) achPopup(a);
}

// ─── SPLASH ─────────────────────────────────────────────────────────────────


// ─── МОДАЛЬНЫЕ ОКНА: MBTI, СЮРПРИЗ, ФИЛЬТРЫ, ДОБРОЙ НОЧИ ───────────────────

function openMbtiModal(type) {
  const info = MBTI_INFO[type] || { name: type, emoji: '🧬', tag: 'Тип личности', desc: 'Уникальный психологический тип.', match: 'Все открытые типы' };
  const sheet = document.createElement('div');
  sheet.className = 'sheet-layer top';
  sheet.innerHTML = `
    <div class="overlay"></div>
    <div class="sheet mbti-sheet" style="padding: 20px 18px 24px;">
      <div class="sheet-handle"></div>
      <div style="text-align:center; padding: 6px 0 14px;">
        <div style="font-size: 40px; margin-bottom: 4px;">${info.emoji}</div>
        <h2 style="font-family: var(--disp); font-size: 19px; font-weight: 800; color: var(--txt);">${type} · ${esc(info.name)}</h2>
        <div style="display:inline-block; font-size: 11.5px; font-weight: 700; color: #ff5e7e; background: rgba(255,94,126,0.15); padding: 4px 12px; border-radius: 999px; margin-top: 6px;">${esc(info.tag)}</div>
      </div>
      <p style="font-size: 13.5px; line-height: 1.5; color: var(--txt); margin-bottom: 14px;">${esc(info.desc)}</p>
      <div style="padding: 12px 14px; border-radius: var(--r-sm); background: var(--card); border: 1px solid var(--stroke); margin-bottom: 18px;">
        <div style="font-size: 10.5px; font-weight: 800; color: var(--mut); text-transform: uppercase; margin-bottom: 4px;">Идеальная совместимость</div>
        <div style="font-size: 14px; font-weight: 700; color: #fbbf24;">💞 ${esc(info.match)}</div>
      </div>
      <button class="btn btn-primary" id="mbtiClose">Понятно ✨</button>
    </div>`;
  app.appendChild(sheet);
  $('.overlay', sheet).addEventListener('click', () => sheet.remove());
  $('#mbtiClose', sheet).addEventListener('click', () => sheet.remove());
}

function openDailySurprise(onClaim) {
  const { item, claimed } = getDailySurprise();
  const sheet = document.createElement('div');
  sheet.className = 'sheet-layer top';
  sheet.innerHTML = `
    <div class="overlay"></div>
    <div class="sheet surprise-sheet" style="padding: 20px 18px 24px;">
      <div class="sheet-handle"></div>
      <div class="surprise-card">
        <div class="surprise-emoji">${item.emoji}</div>
        <h2 style="font-family: var(--disp); font-size: 18px; font-weight: 800; margin-bottom: 6px;">${esc(item.title)}</h2>
        <p style="font-size: 13.5px; color: var(--txt); line-height: 1.45;">${esc(item.desc)}</p>
        <div class="surprise-bonus">✨ ${esc(item.bonus)}</div>
      </div>
      ${claimed ? `
        <p style="text-align:center; font-size: 12.5px; color: var(--mut); margin-bottom: 14px;">Вы уже забрали сегодняшний подарок. Новый сюрприз будет доступен завтра!</p>
        <button class="btn btn-primary" id="surpClose">Отлично ✨</button>
      ` : `
        <button class="btn btn-primary" id="surpClaim">Забрать сюрприз 🎁</button>
      `}
    </div>`;
  app.appendChild(sheet);
  $('.overlay', sheet).addEventListener('click', () => sheet.remove());
  $('#surpClose', sheet)?.addEventListener('click', () => sheet.remove());
  $('#surpClaim', sheet)?.addEventListener('click', () => {
    claimDailySurprise();
    sound.tada();
    confetti(app);
    toast(`Получено: ${item.title}`, item.emoji);
    sheet.remove();
    if (onClaim) onClaim();
  });
}

function openFiltersSheet(onApply) {
  const f = { ...getFilters() };
  const sheet = document.createElement('div');
  sheet.className = 'sheet-layer top';
  sheet.innerHTML = `
    <div class="overlay"></div>
    <div class="sheet filter-sheet" style="padding: 20px 18px 24px;">
      <div class="sheet-handle"></div>
      <div class="sheet-title">🎛️ Фильтры поиска</div>
      
      <p class="ob-label">Кого показывать</p>
      <div class="gender-selector" id="fltGender">
        <button class="gender-btn ${f.gender === 'all' ? 'sel' : ''}" data-v="all">💫 Всех</button>
        <button class="gender-btn ${f.gender === 'female' ? 'sel' : ''}" data-v="female">👩 Девушек</button>
        <button class="gender-btn ${f.gender === 'male' ? 'sel' : ''}" data-v="male">👨 Парней</button>
      </div>

      <p class="ob-label" style="margin-top:14px;">Город</p>
      <div class="chips-wrap" id="fltCity">
        <button class="chip ${f.city === 'all' ? 'on' : ''}" data-v="all">Все города</button>
        ${CITIES.map((c) => `<button class="chip ${f.city === c ? 'on' : ''}" data-v="${c}">${c}</button>`).join('')}
      </div>

      <p class="ob-label" style="margin-top:14px;">Возраст: <b id="fltAgeLabel">${f.minAge} – ${f.maxAge} лет</b></p>
      <div style="display:flex; gap:10px; align-items:center; margin-top:4px;">
        <input type="range" id="fltMinAge" min="18" max="35" value="${f.minAge}" style="flex:1;">
        <input type="range" id="fltMaxAge" min="18" max="35" value="${f.maxAge}" style="flex:1;">
      </div>

      <div class="edit-actions" style="margin-top:20px;">
        <button class="btn btn-primary" id="fltApply">Применить</button>
        <button class="btn btn-ghost" id="fltReset">Сбросить</button>
      </div>
    </div>`;
  app.appendChild(sheet);
  $('.overlay', sheet).addEventListener('click', () => sheet.remove());

  $$('#fltGender button', sheet).forEach((b) => {
    b.addEventListener('click', () => {
      $$('#fltGender button', sheet).forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      f.gender = b.dataset.v;
      sound.pop();
    });
  });

  $$('#fltCity button', sheet).forEach((b) => {
    b.addEventListener('click', () => {
      $$('#fltCity button', sheet).forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      f.city = b.dataset.v;
      sound.pop();
    });
  });

  const minSlider = $('#fltMinAge', sheet);
  const maxSlider = $('#fltMaxAge', sheet);
  const updateAge = () => {
    let min = Number(minSlider.value);
    let max = Number(maxSlider.value);
    if (min > max) { [min, max] = [max, min]; }
    f.minAge = min; f.maxAge = max;
    $('#fltAgeLabel', sheet).textContent = `${min} – ${max} лет`;
  };
  minSlider.addEventListener('input', updateAge);
  maxSlider.addEventListener('input', updateAge);

  $('#fltApply', sheet).addEventListener('click', () => {
    setFilters(f);
    sound.pop();
    toast('Фильтры применены', '🎛️');
    sheet.remove();
    if (onApply) onApply();
  });

  $('#fltReset', sheet).addEventListener('click', () => {
    const def = { gender: 'all', city: 'all', minAge: 18, maxAge: 35 };
    setFilters(def);
    sound.pop();
    toast('Фильтры сброшены', '🔄');
    sheet.remove();
    if (onApply) onApply();
  });
}

function openGoodNightModal() {
  unlock('night_owl');
  const sheet = document.createElement('div');
  sheet.className = 'sheet-layer top';
  sheet.innerHTML = `
    <div class="overlay"></div>
    <div class="sheet" style="text-align:center; padding: 24px 20px;">
      <div class="sheet-handle"></div>
      <div style="font-size: 44px; margin-bottom: 10px;">🌙✨</div>
      <h2 style="font-family: var(--disp); font-size: 18px; font-weight: 800; margin-bottom: 8px;">Доброй ночи в Reply</h2>
      <p style="font-size: 14px; color: var(--txt); line-height: 1.5; margin-bottom: 16px;">
        Город засыпает, и ночные разговоры становятся самыми искренними. Пусть завтрашний день принесёт новые тёплые встречи!
      </p>
      <div style="padding: 8px 14px; border-radius: 999px; background: rgba(139,92,246,0.18); border: 1px solid rgba(139,92,246,0.3); font-size: 12px; font-weight: 700; color: #c4b5fd; display: inline-block; margin-bottom: 16px;">
        🏆 Достижение: Полуночник 🌙
      </div>
      <button class="btn btn-primary" id="gnClose">Сладких снов 💫</button>
    </div>`;
  app.appendChild(sheet);
  $('.overlay', sheet).addEventListener('click', () => sheet.remove());
  $('#gnClose', sheet).addEventListener('click', () => sheet.remove());
  sound.pop();
}

function renderSplash() {
  app.innerHTML = `
    <div class="screen splash">
      <div class="splash-glow"></div>
      <div class="logo-bubble">💬</div>
      <h1 class="logo-text">Reply</h1>
      <p class="splash-tag">Не чат.<br>Настоящее первое свидание.</p>
      <button class="btn btn-primary btn-lg splash-cta">Начать</button>
      <p class="splash-sub">Место, где переписка становится воспоминанием</p>
      <a href="/api/download" class="splash-zip-link" download="reply-project.zip">💾 Скачать проект (ZIP)</a>
    </div>`;
  const btn = $('.splash-cta');
  setTimeout(() => btn.classList.add('ready'), 300);
  btn.addEventListener('click', () => {
    sound.like();
    const st = getState();
    if (st.onboarded) show('main');
    else show('onboarding');
  });
}

// ─── ОНБОРДИНГ ──────────────────────────────────────────────────────────────

function renderOnboarding() {
  const steps = 4;
  let step = 0;
  
  // загрузка черновика из localStorage
  let draft = {
    name: '', gender: 'male', targetGender: 'all', birthday: '2000-05-15', age: 24, city: 'Москва',
    avatarEmoji: '😊', avatarLabel: 'Тёплый', avatarImg: 'assets/avatars/user-1.png', avatarHue: 0,
    mbti: 'ENFP', values: ['Честность', 'Свобода'], habits: ['Кофе по утрам'],
    about: '', interests: ['Кофе', 'Музыка'], goals: 'Серьёзные отношения',
  };
  try {
    const raw = localStorage.getItem('reply_onboarding_draft');
    if (raw) Object.assign(draft, JSON.parse(raw));
  } catch (e) { /* ignore */ }

  const saveDraft = () => {
    try { localStorage.setItem('reply_onboarding_draft', JSON.stringify(draft)); } catch (e) { /* ignore */ }
  };

  app.innerHTML = `
    <div class="screen onboarding">
      <div class="ob-dots"></div>
      <div class="ob-body"></div>
      <div class="ob-actions">
        <button class="btn btn-ghost ob-back" style="visibility:hidden">Назад</button>
        <button class="btn btn-primary ob-next" disabled>Далее</button>
      </div>
    </div>`;

  const body = $('.ob-body');
  const dots = $('.ob-dots');
  const backBtn = $('.ob-back');
  const nextBtn = $('.ob-next');

  const calcAge = (bdate) => {
    if (!bdate) return 24;
    const diff = Date.now() - new Date(bdate).getTime();
    return Math.max(18, Math.floor(diff / (365.25 * 24 * 3600 * 1000)));
  };

  const stepsFn = [
    // 1 — знакомство
    () => {
      body.innerHTML = `
        <div class="ob-step">
          <div class="ob-emoji big">👋</div>
          <h2>Давайте знакомиться</h2>
          <p class="ob-sub">Как вас зовут и откуда вы?</p>
          
          <div class="field"><input id="ob-name" placeholder="Ваше имя" maxlength="20" value="${esc(draft.name)}"></div>
          
          <p class="ob-label">Ваш пол</p>
          <div class="gender-selector" id="ob-gender">
            <button class="gender-btn ${draft.gender === 'male' ? 'sel' : ''}" data-v="male">👨 Парень</button>
            <button class="gender-btn ${draft.gender === 'female' ? 'sel' : ''}" data-v="female">👩 Девушка</button>
            <button class="gender-btn ${draft.gender === 'other' ? 'sel' : ''}" data-v="other">✨ Другое</button>
          </div>

          <p class="ob-label" style="margin-top:12px;">Кого вы ищете</p>
          <div class="gender-selector" id="ob-target-gender">
            <button class="gender-btn ${draft.targetGender === 'female' ? 'sel' : ''}" data-v="female">👩 Девушек</button>
            <button class="gender-btn ${draft.targetGender === 'male' ? 'sel' : ''}" data-v="male">👨 Парней</button>
            <button class="gender-btn ${draft.targetGender === 'all' ? 'sel' : ''}" data-v="all">💫 Всех</button>
          </div>

          <div class="field-row" style="margin-top:12px;">
            <div class="field">
              <label class="ob-label">Дата рождения</label>
              <input id="ob-bday" type="date" value="${esc(draft.birthday || '2000-05-15')}">
            </div>
            <div class="field">
              <label class="ob-label">Город</label>
              <input id="ob-city" placeholder="Город" maxlength="20" value="${esc(draft.city)}">
            </div>
          </div>

          <div class="chips-wrap" id="ob-city-chips" style="margin-top:4px;">
            ${CITIES.map((c) => `<button class="chip ${draft.city === c ? 'on' : ''}">${c}</button>`).join('')}
          </div>
          <div id="ob-age-badge" style="font-size:12px; color:#ff8e53; font-weight:700; margin-top:8px;"></div>
        </div>`;

      const check = () => {
        draft.name = $('#ob-name')?.value.trim();
        draft.birthday = $('#ob-bday')?.value;
        draft.age = calcAge(draft.birthday);
        draft.city = $('#ob-city')?.value.trim();
        $('#ob-age-badge').textContent = draft.age ? `Возраст: ${draft.age} лет` : '';
        saveDraft();
        nextBtn.disabled = !(draft.name && draft.age >= 18 && draft.city);
      };

      $$('#ob-gender button').forEach((b) => {
        b.addEventListener('click', () => {
          $$('#ob-gender button').forEach((x) => x.classList.remove('sel'));
          b.classList.add('sel');
          draft.gender = b.dataset.v;
          saveDraft();
          sound.pop();
        });
      });

      $$('#ob-target-gender button').forEach((b) => {
        b.addEventListener('click', () => {
          $$('#ob-target-gender button').forEach((x) => x.classList.remove('sel'));
          b.classList.add('sel');
          draft.targetGender = b.dataset.v;
          saveDraft();
          sound.pop();
        });
      });

      $$('#ob-city-chips button').forEach((b) => {
        b.addEventListener('click', () => {
          $('#ob-city').value = b.textContent;
          draft.city = b.textContent;
          $$('#ob-city-chips button').forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
          check();
          sound.pop();
        });
      });

      $('#ob-name').addEventListener('input', check);
      $('#ob-bday').addEventListener('input', check);
      $('#ob-city').addEventListener('input', check);
      check();
    },
    // 2 — аватар
    () => {
      body.innerHTML = `
        <div class="ob-step">
          <div class="ob-emoji big">🎭</div>
          <h2>Создайте персонажа</h2>
          <p class="ob-sub">Каким вы будете в мире Reply?</p>
          <div class="avatar-grid"></div>
        </div>`;
      const grid = $('.avatar-grid');
      AVATARS.forEach((a) => {
        const b = document.createElement('button');
        b.className = 'avatar-opt' + (a.img === draft.avatarImg && (a.hue || 0) === (draft.avatarHue || 0) ? ' sel' : '');
        b.innerHTML = `<img class="ao-img" src="${a.img}" alt="" style="${a.hue ? `filter:hue-rotate(${a.hue}deg)` : ''}"><span class="ao-label">${a.label}</span>`;
        b.addEventListener('click', () => {
          $$('.avatar-opt', grid).forEach((x) => x.classList.remove('sel'));
          b.classList.add('sel');
          draft.avatarEmoji = a.emoji;
          draft.avatarLabel = a.label;
          draft.avatarImg = a.img;
          draft.avatarHue = a.hue || 0;
          saveDraft();
          nextBtn.disabled = false;
          sound.pop();
        });
        grid.appendChild(b);
      });
      nextBtn.disabled = !draft.avatarImg;
    },
    // 3 — MBTI, ценности, о себе
    () => {
      body.innerHTML = `
        <div class="ob-step">
          <div class="ob-emoji big">🧬</div>
          <h2>Личность и ценности</h2>
          <p class="ob-sub">Выберите свой тип MBTI и расскажите о себе</p>
          
          <p class="ob-label">Ваш тип личности MBTI</p>
          <div class="mbti-grid" id="ob-mbti"></div>
          <div id="ob-mbti-desc" style="font-size:12px; color:#c4b5fd; font-weight:600; padding:8px 10px; background:rgba(139,92,246,0.12); border-radius:10px; margin-top:8px;"></div>

          <p class="ob-label" style="margin-top:14px;">Ценности (до 3)</p>
          <div class="chips-wrap" id="ob-values"></div>

          <p class="ob-label" style="margin-top:14px;">Привычки (до 2)</p>
          <div class="chips-wrap" id="ob-habits"></div>

          <p class="ob-label" style="margin-top:14px;">Интересы (до 6)</p>
          <div class="chips-wrap" id="ob-interests"></div>

          <p class="ob-label" style="margin-top:14px;">Цель знакомства</p>
          <div class="chips-wrap" id="ob-goals"></div>

          <p class="ob-label" style="margin-top:14px;">О себе</p>
          <div class="field"><textarea id="ob-about" rows="3" maxlength="140" placeholder="Пара слов о себе…">${esc(draft.about)}</textarea></div>
        </div>`;

      const mg = $('#ob-mbti');
      const md = $('#ob-mbti-desc');
      MBTI_TYPES.forEach((t) => {
        const inf = MBTI_INFO[t] || { name: t, tag: '' };
        const b = document.createElement('div');
        b.className = 'mbti-card' + (draft.mbti === t ? ' sel' : '');
        b.innerHTML = `<span class="mbti-code">${t}</span><span class="mbti-role">${inf.name}</span>`;
        b.addEventListener('click', () => {
          $$('.mbti-card', mg).forEach((x) => x.classList.remove('sel'));
          b.classList.add('sel');
          draft.mbti = t;
          md.textContent = `✨ ${t} (${inf.name}): ${inf.tag}. Совместимость: ${inf.match}`;
          saveDraft();
          sound.pop();
        });
        mg.appendChild(b);
      });
      const curInf = MBTI_INFO[draft.mbti || 'ENFP'];
      md.textContent = `✨ ${draft.mbti || 'ENFP'} (${curInf?.name}): ${curInf?.tag}. Совместимость: ${curInf?.match}`;

      // ценности
      const vw = $('#ob-values');
      VALUES_LIST.forEach((v) => {
        const c = document.createElement('button');
        c.className = 'chip' + ((draft.values || []).includes(v) ? ' on' : '');
        c.textContent = v;
        c.addEventListener('click', () => {
          const arr = draft.values || [];
          const idx = arr.indexOf(v);
          if (idx >= 0) arr.splice(idx, 1);
          else if (arr.length < 3) arr.push(v);
          else { toast('Максимум 3 ценности', '💎'); return; }
          draft.values = arr;
          c.classList.toggle('on', arr.includes(v));
          saveDraft();
          sound.pop();
        });
        vw.appendChild(c);
      });

      // привычки
      const hw = $('#ob-habits');
      HABITS_LIST.forEach((h) => {
        const c = document.createElement('button');
        c.className = 'chip' + ((draft.habits || []).includes(h) ? ' on' : '');
        c.textContent = h;
        c.addEventListener('click', () => {
          const arr = draft.habits || [];
          const idx = arr.indexOf(h);
          if (idx >= 0) arr.splice(idx, 1);
          else if (arr.length < 2) arr.push(h);
          else { toast('Максимум 2 привычки', '🌿'); return; }
          draft.habits = arr;
          c.classList.toggle('on', arr.includes(h));
          saveDraft();
          sound.pop();
        });
        hw.appendChild(c);
      });

      // интересы
      const iw = $('#ob-interests');
      INTERESTS.forEach((it) => {
        const c = document.createElement('button');
        c.className = 'chip' + ((draft.interests || []).includes(it) ? ' on' : '');
        c.textContent = it;
        c.addEventListener('click', () => {
          const arr = draft.interests || [];
          const idx = arr.indexOf(it);
          if (idx >= 0) arr.splice(idx, 1);
          else if (arr.length < 6) arr.push(it);
          else { toast('Максимум 6 интересов', '🙈'); return; }
          draft.interests = arr;
          c.classList.toggle('on', arr.includes(it));
          saveDraft();
          sound.pop();
        });
        iw.appendChild(c);
      });

      // цель
      const gw = $('#ob-goals');
      GOALS.forEach((g) => {
        const c = document.createElement('button');
        c.className = 'chip' + (draft.goals === g ? ' on' : '');
        c.textContent = g;
        c.addEventListener('click', () => {
          $$('.chip', gw).forEach((x) => x.classList.remove('on'));
          c.classList.add('on');
          draft.goals = g;
          saveDraft();
          sound.pop();
        });
        gw.appendChild(c);
      });

      $('#ob-about').addEventListener('input', (e) => {
        draft.about = e.target.value.trim();
        saveDraft();
      });

      nextBtn.disabled = false;
    },
    // 4 — финал
    () => {
      body.innerHTML = `
        <div class="ob-step">
          <div class="ob-avatar-final"><img src="${draft.avatarImg}" alt="" style="${draft.avatarHue ? `filter:hue-rotate(${draft.avatarHue}deg)` : ''}"></div>
          <h2>Добро пожаловать, ${esc(draft.name)}!</h2>
          <p class="ob-sub">Ваш профиль готов. Пора открывать тёплые встречи в Reply!</p>
          <div class="ob-summary">
            <div><span>📍</span>${esc(draft.city)} · ${draft.age} лет</div>
            <div><span>🧬</span>MBTI: <b>${esc(draft.mbti)}</b> (${MBTI_INFO[draft.mbti]?.name || ''})</div>
            <div><span>🎯</span>${esc(draft.goals)}</div>
            <div><span>💎</span>Ценности: ${(draft.values || []).join(', ') || 'Честность'}</div>
          </div>
        </div>`;
      nextBtn.textContent = 'Войти в Reply ❤️';
      nextBtn.disabled = false;
    },
  ];

  const render = () => {
    $$('.ob-dot', dots).forEach((d, i) => d.classList.toggle('on', i === step));
    stepsFn[step]();
    backBtn.style.visibility = step === 0 ? 'hidden' : 'visible';
    nextBtn.textContent = step === steps - 1 ? 'Войти в Reply ❤️' : 'Далее';
  };

  for (let i = 0; i < steps; i++) {
    const d = document.createElement('div');
    d.className = 'ob-dot' + (i === 0 ? ' on' : '');
    dots.appendChild(d);
  }

  backBtn.addEventListener('click', () => { if (step > 0) { step--; sound.pop(); render(); } });
  nextBtn.addEventListener('click', () => {
    if (step < steps - 1) { step++; sound.pop(); render(); }
    else {
      setUser({
        name: draft.name, gender: draft.gender, targetGender: draft.targetGender,
        birthday: draft.birthday, age: draft.age, city: draft.city,
        avatarEmoji: draft.avatarEmoji, avatarLabel: draft.avatarLabel, avatarImg: draft.avatarImg, avatarHue: draft.avatarHue || 0,
        mbti: draft.mbti, values: draft.values, habits: draft.habits,
        about: draft.about, interests: draft.interests, goals: draft.goals,
      });
      const st = getState();
      st.onboarded = true;
      try { localStorage.removeItem('reply_onboarding_draft'); } catch (e) { /* ignore */ }
      save();
      sound.tada();
      toast('Профиль создан. Добро пожаловать!', '🎉');
      show('main');
    }
  });
  render();
}

function shell(contentHtml) {
  return `
    <div class="screen main-screen">
      ${contentHtml}
      <nav class="bottom-nav">
        <button data-tab="discover" class="nav-btn on"><span>🧭</span><em>Люди</em></button>
        <button data-tab="dates" class="nav-btn"><span>📅</span><em>Свидания</em></button>
        <button data-tab="memories" class="nav-btn"><span>📖</span><em>История</em></button>
        <button data-tab="collections" class="nav-btn"><span>🎁</span><em>Коллекции</em></button>
        <button data-tab="profile" class="nav-btn"><span>👤</span><em>Профиль</em></button>
      </nav>
    </div>`;
}

function renderMain(opts = {}) {
  const tab = opts.tab || currentTab;
  currentTab = tab; // синхронизируем глобальную вкладку с реально отрисованной
  app.innerHTML = shell(`<div class="tab-content" id="tabContent"></div>`);
  const tc = $('#tabContent');
  $$('.nav-btn').forEach((b) => {
    b.classList.toggle('on', b.dataset.tab === tab);
    b.addEventListener('click', () => {
      if (b.dataset.tab === currentTab) return;
      currentTab = b.dataset.tab;
      sound.pop();
      renderMain({ tab: currentTab });
    });
  });
  const renders = { discover: tabDiscover, dates: tabDates, memories: tabMemories, collections: tabCollections, profile: tabProfile };
  (renders[tab] || tabDiscover)(tc);
}

// ─── ТАБ: ЛЮДИ (свайпы) ─────────────────────────────────────────────────────

function tabDiscover(tc) {
  const st = getState();
  const daily = getDailySurprise();
  const f = getFilters();
  const hasFilter = f.gender !== 'all' || f.city !== 'all' || f.minAge > 18 || f.maxAge < 35;

  tc.innerHTML = `
    <header class="topbar">
      <div class="tb-logo">Reply<span class="tb-dot"></span></div>
      <div class="tb-right">
        <span class="streak" title="Серия свиданий">🔥 ${st.streak}</span>
        <button class="tb-icon tb-surprise ${daily.claimed ? '' : 'pulse'}" id="btnSurprise" title="Сюрприз дня">🎁</button>
        <button class="tb-icon" id="btnNight" title="Ночной режим">🌙</button>
        <button class="tb-icon tb-filter ${hasFilter ? 'has-filter' : ''}" id="btnFilter" title="Фильтры">🎛️</button>
        <button class="tb-icon" data-act="settings" title="Настройки">⚙️</button>
      </div>
    </header>
    <div class="discover-wrap">
      <div class="deck-info">
        <p class="deck-count">Сегодня <b>${remainingToday()}</b> из ${getFilteredDeck().length} людей по фильтрам</p>
        <div class="deck-dots">${'<i></i>'.repeat(Math.min(10, getFilteredDeck().length))}</div>
      </div>
      <div class="deck" id="deck"></div>
      <div class="deck-actions">
        <button class="da-btn da-pass" title="Пропустить">✕</button>
        <button class="da-btn da-star" title="Супер-лайк">⭐</button>
        <button class="da-btn da-like" title="Нравится">❤️</button>
      </div>
    </div>`;

  $('[data-act="settings"]').addEventListener('click', openSettings);
  $('#btnSurprise').addEventListener('click', () => openDailySurprise(() => tabDiscover(tc)));
  $('#btnNight').addEventListener('click', openGoodNightModal);
  $('#btnFilter').addEventListener('click', () => openFiltersSheet(() => tabDiscover(tc)));

  $('.da-pass').addEventListener('click', () => actOn('pass'));
  $('.da-like').addEventListener('click', () => actOn('like'));
  $('.da-star').addEventListener('click', () => { sound.like(); actOn('like', true); });

  const deck = $('#deck');
  let busy = false;

  const drawDots = () => {
    const n = remainingToday();
    const total = Math.min(10, getFilteredDeck().length);
    $$('.deck-dots i').forEach((d, i) => d.classList.toggle('on', i < n));
    $('.deck-count').innerHTML = `Сегодня <b>${n}</b> из ${getFilteredDeck().length} людей по фильтрам`;
  };

  const cardHtml = (ch, i) => {
    const scale = 1 - i * 0.055;
    const ty = i * 14;
    const mbtiInf = MBTI_INFO[ch.mbti] || { name: ch.mbti };
    return `
      <div class="swipe-card" data-id="${ch.id}" style="z-index:${10 - i}; transform:translateY(${ty}px) scale(${scale})">
        <div class="sc-photo">
          <img src="${ch.photo}" alt="${esc(ch.name)}">
          <div class="sc-status">Сейчас: ${ch.status.icon} ${esc(ch.status.text)}</div>
          ${ch.voice ? `<button class="sc-voice-btn" data-voice="${ch.voice}" title="Послушать голос">🎙️ Голос</button>` : ''}
        </div>
        <div class="sc-body">
          <div class="sc-name">${esc(ch.name)}, ${ch.age} <span class="sc-badge">${ch.badge}</span></div>
          <div class="sc-city">📍 ${esc(ch.city)} · <button class="sc-mbti-btn" data-mbti="${ch.mbti}">🧬 ${ch.mbti} · ${esc(mbtiInf.name)} ℹ️</button></div>
          <p class="sc-bio">${esc(ch.bio)}</p>
          <div class="sc-chips">
            ${ch.interests.slice(0, 3).map((x) => `<span class="mini-chip">${esc(x)}</span>`).join('')}
            ${(ch.values || []).slice(0, 2).map((v) => `<span class="mini-chip" style="border-color:rgba(251,191,36,0.35); color:#fde68a;">💎 ${esc(v)}</span>`).join('')}
          </div>
          <div class="sc-match"><span class="sc-heart">❤️</span> Совместимость ${ch.compatibility}% · «${esc(ch.matchLine)}»</div>
        </div>
        <div class="stamp stamp-like">♥</div>
        <div class="stamp stamp-pass">✕</div>
      </div>`;
  };

  const renderDeck = () => {
    deck.innerHTML = '';
    const ids = getFilteredDeck();
    const cards = ids.filter((id) => !st.swiped[id]);
    if (!cards.length) {
      deck.innerHTML = `
        <div class="deck-empty">
          <div class="de-emoji">🌙</div>
          <h3>На сегодня всё</h3>
          <p>Мы показали всех, кого подобрали по фильтрам. Хотите посмотреть ещё?</p>
          <button class="btn btn-primary" data-go="refresh">Показать ещё людей 🔄</button>
          ${hasFilter ? `<button class="btn btn-ghost-sm" data-go="reset-filter">Сбросить фильтры 🎛️</button>` : ''}
          <button class="btn btn-ghost-sm" data-go="memories">Посмотреть воспоминания</button>
        </div>`;
      $('[data-go="refresh"]').addEventListener('click', () => { refreshDeck(); sound.pop(); renderDeck(); });
      $('[data-go="reset-filter"]')?.addEventListener('click', () => {
        setFilters({ gender: 'all', city: 'all', minAge: 18, maxAge: 35 });
        sound.pop();
        tabDiscover(tc);
      });
      $('[data-go="memories"]').addEventListener('click', () => { currentTab = 'memories'; renderMain({ tab: 'memories' }); });
      $('.deck-actions').style.display = 'none';
      drawDots();
      return;
    }
    const top = cards.slice(0, 3);
    top.forEach((id, i) => {
      const ch = getChar(id);
      const wrap = document.createElement('div');
      wrap.innerHTML = cardHtml(ch, i);
      const el = wrap.firstElementChild;
      
      // MBTI кнопка
      $('.sc-mbti-btn', el)?.addEventListener('click', (e) => {
        e.stopPropagation();
        openMbtiModal(ch.mbti);
      });

      // Голосовая кнопка
      $('.sc-voice-btn', el)?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (ch.voice) {
          const a = new Audio(ch.voice);
          a.play().catch(() => {});
          toast(`Голос: ${ch.name}`, '🎙️');
        }
      });

      deck.appendChild(el);
    });
    attachSwipe(deck.querySelector('.swipe-card'), (dir) => actOn(dir));
    drawDots();
  };

  const actOn = (dir, superLike = false) => {
    if (busy) return;
    const top = deck.querySelector('.swipe-card');
    if (!top) return;
    busy = true;
    if (dir === 'like') sound.like(); else sound.nope();
    top.classList.add('fly-' + dir);
    setTimeout(() => {
      const ch = getChar(top.dataset.id);
      swipe(ch.id, dir);
      if (dir === 'like') {
        burstHearts(deck);
        setTimeout(() => showMatch(ch), 650);
        return;
      }
      busy = false;
      renderDeck();
    }, 450);
  };

  const attachSwipe = (el, cb) => {
    let sx = 0, sy = 0, dx = 0, active = false;
    const stamps = { like: el.querySelector('.stamp-like'), pass: el.querySelector('.stamp-pass') };
    const move = (x, y) => {
      dx = x - sx;
      const dy = y - sy;
      el.style.transform = `translate(${dx}px, ${dy * 0.25}px) rotate(${dx / 14}deg)`;
      const k = Math.min(1, Math.abs(dx) / 90);
      if (stamps.like) { stamps.like.style.opacity = dx > 0 ? k : 0; }
      if (stamps.pass) { stamps.pass.style.opacity = dx < 0 ? k : 0; }
    };
    el.addEventListener('pointerdown', (e) => {
      if (busy) return;
      active = true; sx = e.clientX; sy = e.clientY;
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => { if (active) move(e.clientX, e.clientY); });
    const end = (e) => {
      if (!active) return;
      active = false;
      if (dx > 90) { el.style.transition = 'transform .4s'; el.style.transform = 'translate(120%, -40px) rotate(22deg)'; setTimeout(() => cb('like'), 260); }
      else if (dx < -90) { el.style.transition = 'transform .4s'; el.style.transform = 'translate(-120%, -40px) rotate(-22deg)'; setTimeout(() => cb('pass'), 260); }
      else { el.style.transition = 'transform .2s'; el.style.transform = ''; if (stamps.like) stamps.like.style.opacity = 0; if (stamps.pass) stamps.pass.style.opacity = 0; }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };

  renderDeck();
}

// ─── МЭТЧ ───────────────────────────────────────────────────────────────────

function showMatch(ch) {
  clearScreen();
  app.innerHTML = `
    <div class="screen match-screen">
      <div class="match-bg-glow"></div>
      <div class="match-content">
        <div class="match-heart">❤️</div>
        <h1 class="match-title">Это взаимно!</h1>
        <p class="match-sub">Вы понравились друг другу</p>
        <div class="match-photos">
          <div class="mp-user"><img src="${getState().user.avatarImg || ''}" alt=""></div>
          <div class="mp-heart">💞</div>
          <div class="mp-photo"><img src="${ch.photo}" alt=""></div>
        </div>
        <div class="match-names"><b>${esc(getState().user.name)}</b> + <b>${esc(ch.name)}, ${ch.age}</b></div>
        <p class="match-line">«${esc(ch.matchLine)}»</p>
        <button class="btn btn-primary btn-lg" id="mPlan">❤️ Назначить свидание</button>
        <button class="btn btn-ghost" id="mLater">Смотреть дальше</button>
      </div>
    </div>`;
  sound.match();
  confetti(app);
  const heartEl = $('.match-heart');
  setTimeout(() => { if (heartEl && heartEl.isConnected) burstHearts(heartEl); }, 500);
  const st = getState();
  $('#mPlan').addEventListener('click', () => {
    const existing = hasPlanFor(ch.id);
    if (existing) {
      sound.pop();
      show('waiting', { planId: existing.id });
    } else {
      sound.coin();
      show('planner', { charId: ch.id });
    }
  });
  $('#mLater').addEventListener('click', () => show('main', { tab: 'discover' }));
}

// ─── ПЛАНИРОВАНИЕ ───────────────────────────────────────────────────────────

function renderPlanner({ charId }) {
  const ch = getChar(charId);
  const st = getState();
  const existing = hasPlanFor(charId);
  const plan = {
    charId,
    dateISO: existing?.dateISO || null,
    time: existing?.time || null,
    locationId: existing?.locationId || null,
    activities: existing ? [...existing.activities] : [],
  };
  const days = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  let step = 0;

  app.innerHTML = `
    <div class="screen planner">
      <header class="pl-head">
        <button class="pl-back">←</button>
        <div class="pl-title">Свидание с <b>${esc(ch.name)}</b></div>
        <div class="pl-steps"><i class="on"></i><i></i><i></i><i></i></div>
      </header>
      <div class="pl-body"></div>
      <div class="pl-actions"><button class="btn btn-primary btn-lg pl-next" disabled>Далее</button></div>
    </div>`;

  const body = $('.pl-body');
  const nextBtn = $('.pl-next');
  const backBtn = $('.pl-back');
  const stepsEls = $$('.pl-steps i');

  const render = () => {
    stepsEls.forEach((s, i) => s.classList.toggle('on', i <= step));
    if (step === 0) renderStepTime();
    if (step === 1) renderStepLocation();
    if (step === 2) renderStepActivities();
    if (step === 3) renderStepSummary();
    nextBtn.textContent = step === 3 ? 'Забронировать 💘' : 'Далее';
    nextBtn.disabled = step === 0 ? !(plan.dateISO && plan.time) : step === 1 ? !plan.locationId : step === 2 ? !plan.activities.length : false;
  };

  const renderStepTime = () => {
    body.innerHTML = `
      <div class="pl-step">
        <div class="pl-emoji">📅</div>
        <h2>Когда встретимся?</h2>
        <p class="pl-sub">Выберите день</p>
        <div class="day-chips"></div>
        <p class="pl-sub">Выберите время</p>
        <div class="time-chips"></div>
        <div class="time-conflict" hidden></div>
      </div>`;
    const dc = $('.day-chips');
    const conflictEl = $('.time-conflict');
    const checkConflict = () => {
      if (!plan.dateISO || !plan.time) { conflictEl.hidden = true; return; }
      const c = planConflict(plan.dateISO, plan.time, charId);
      if (c) {
        conflictEl.hidden = false;
        conflictEl.innerHTML = `⚠️ Это время уже занято — у вас свидание с <b>${esc(getChar(c.charId).name)}</b> в этот же день и час. Выберите другое время.`;
      } else {
        conflictEl.hidden = true;
      }
      nextBtn.disabled = !(plan.dateISO && plan.time) || !!c;
    };
    days.forEach((d, i) => {
      const b = document.createElement('button');
      const wd = d.toLocaleDateString('ru-RU', { weekday: 'short' });
      b.className = 'day-chip';
      b.innerHTML = `<span class="dc-wd">${wd}</span><span class="dc-d">${d.getDate()}</span><span class="dc-m">${d.toLocaleDateString('ru-RU', { month: 'short' })}</span>`;
      if (plan.dateISO && d.toISOString().slice(0, 10) === plan.dateISO) b.classList.add('on');
      b.addEventListener('click', () => {
        $$('.day-chip', dc).forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        plan.dateISO = d.toISOString().slice(0, 10);
        sound.pop();
        checkConflict();
      });
      dc.appendChild(b);
    });
    const tc = $('.time-chips');
    TIME_SLOTS.forEach((t) => {
      const b = document.createElement('button');
      b.className = 'time-chip';
      b.textContent = t;
      if (plan.time === t) b.classList.add('on');
      b.addEventListener('click', () => {
        $$('.time-chip', tc).forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        plan.time = t;
        sound.pop();
        checkConflict();
      });
      tc.appendChild(b);
    });
    checkConflict();
  };

  const renderStepLocation = () => {
    body.innerHTML = `
      <div class="pl-step">
        <div class="pl-emoji">📍</div>
        <h2>Куда пойдём?</h2>
        <p class="pl-sub">Каждая локация живёт своей жизнью: музыка, погода, атмосфера</p>
        <div class="loc-grid"></div>
      </div>`;
    const grid = $('.loc-grid');
    LOCATIONS.forEach((l) => {
      const locked = l.premium && !st.premium;
      const b = document.createElement('button');
      b.className = 'loc-card';
      b.style.background = `linear-gradient(160deg, ${l.sky[0]}, ${l.sky[l.sky.length - 1]})`;
      b.innerHTML = `
        <span class="lc-emoji">${locked ? '🔒' : l.emoji}</span>
        <span class="lc-name">${l.name}</span>
        <span class="lc-tag">${l.tag}</span>
        ${locked ? '<span class="lc-prem">Premium</span>' : ''}`;
      if (plan.locationId === l.id) b.classList.add('on');
      b.addEventListener('click', () => {
        if (locked) { openPremium(); return; }
        $$('.loc-card', grid).forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        plan.locationId = l.id;
        plan.activities = plan.activities.filter((a) => {
          const act = ACTIVITIES.find((x) => x.id === a);
          return !act.locations || act.locations.includes(l.id);
        });
        nextBtn.disabled = false;
        sound.pop();
      });
      grid.appendChild(b);
    });
  };

  const renderStepActivities = () => {
    body.innerHTML = `
      <div class="pl-step">
        <div class="pl-emoji">🎯</div>
        <h2>Что будем делать?</h2>
        <p class="pl-sub">Доступны только выбранные активности</p>
        <div class="act-grid"></div>
      </div>`;
    const grid = $('.act-grid');
    const loc = getLoc(plan.locationId);
    ACTIVITIES.forEach((a) => {
      const fits = !a.locations || a.locations.includes(plan.locationId);
      if (!fits) return;
      const locked = a.premium && !st.premium;
      const b = document.createElement('button');
      b.className = 'act-opt';
      if (plan.activities.includes(a.id)) b.classList.add('on');
      b.innerHTML = `<span class="ao-emoji">${a.emoji}</span><span class="ao-name">${a.name}</span>${locked ? '<span class="ao-lock">🔒</span>' : ''}`;
      b.addEventListener('click', () => {
        if (locked) { openPremium(); return; }
        const i = plan.activities.indexOf(a.id);
        if (i >= 0) { plan.activities.splice(i, 1); b.classList.remove('on'); }
        else {
          if (plan.activities.length >= 5) { toast('Максимум 5 активностей', '🙈'); return; }
          plan.activities.push(a.id);
          b.classList.add('on');
        }
        nextBtn.disabled = !plan.activities.length;
        sound.pop();
      });
      grid.appendChild(b);
    });
  };

  const renderStepSummary = () => {
    const loc = getLoc(plan.locationId);
    const d = new Date(plan.dateISO + 'T00:00');
    const otherPlans = getState().planned.filter((p) => p.charId !== charId).length;
    body.innerHTML = `
      <div class="pl-step">
        <div class="pl-emoji">💘</div>
        <h2>Всё готово</h2>
        <p class="pl-sub">Проверьте планы на наше первое свидание</p>
        <div class="summary-card">
          <div class="sum-row"><span class="sum-emoji">${loc.emoji}</span><div><b>${loc.name}</b><small>${loc.tag}</small></div></div>
          <div class="sum-row"><span class="sum-emoji">📅</span><div><b>${d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</b><small>${plan.time}</small></div></div>
          <div class="sum-row"><span class="sum-emoji">🎯</span><div><b>Активности</b><small>${plan.activities.map((a) => ACTIVITIES.find((x) => x.id === a)?.emoji).join(' ')}</small></div></div>
        </div>
        <div class="sum-note">💡 До свидания чат останется закрытым — появится только на месте${otherPlans ? `. Также у вас запланировано ещё ${otherPlans} свидание(й).` : ''}</div>
      </div>`;
  };

  nextBtn.addEventListener('click', () => {
    if (step < 3) { step++; sound.pop(); render(); }
    else {
      const conflict = planConflict(plan.dateISO, plan.time, charId);
      if (conflict) {
        toast('Это время уже занято другим свиданием', '⚠️');
        step = 0; sound.pop(); render();
        return;
      }
      planDate(plan);
      unlock('planner');
      sound.tada();
      toast(existing ? 'Свидание обновлено!' : 'Свидание запланировано!', '💘');
      show('waiting', { planId: hasPlanFor(charId)?.id });
    }
  });
  backBtn.addEventListener('click', () => {
    if (step === 0) show('main', { tab: 'dates' });
    else { step--; sound.pop(); render(); }
  });
  render();
}

// ─── ОЖИДАНИЕ ───────────────────────────────────────────────────────────────

function renderWaiting(opts = {}) {
  const st = getState();
  const p = (opts.planId && getPlan(opts.planId)) || nextUpcoming();
  if (!p) { show('main', { tab: 'dates' }); return; }
  const ch = getChar(p.charId);
  const loc = getLoc(p.locationId);
  const target = plannedDateTime(p);
  let audio = null;

  app.innerHTML = `
    <div class="screen waiting">
      <button class="wait-back">←</button>
      <div class="wait-bg"><img src="${ch.photo}" alt=""></div>
      <div class="wait-shade"></div>
      <div class="wait-content">
        <div class="wait-card">
          <div class="wc-photo"><img src="${ch.photo}" alt=""><div class="wc-online">● ${esc(ch.name)} уже готова встречаться с вами</div></div>
          <h2 class="wc-name">${esc(ch.name)}, ${ch.age}</h2>
          <p class="wc-line">«${esc(ch.waitLine || ch.greeting)}»</p>
          <div class="wc-chips">
            <span class="wc-chip">📅 ${new Date(p.dateISO + 'T00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</span>
            <span class="wc-chip">🕖 ${p.time}</span>
            <span class="wc-chip">${loc.emoji} ${loc.name}</span>
          </div>
          <div class="wc-voice">
            <button class="wv-play">▶</button>
            <div class="wv-label">${esc(ch.waitVoiceLabel || 'Голосовое от ' + ch.name)}</div>
          </div>
        </div>
        <div class="wait-count">
          <p class="wc-title">До вашего свидания</p>
          <div class="count-nums"><span id="cH">--</span><i>:</i><span id="cM">--</span><i>:</i><span id="cS">--</span></div>
          <p class="wc-sub">Чат откроется в назначенное время. А пока — маленькая интрига 😉</p>
          <button class="btn btn-primary btn-lg wait-start" disabled>Начать свидание ✨</button>
          <button class="btn btn-ghost wait-now">Начать сейчас (демо)</button>
          <button class="btn btn-ghost-sm wait-edit">Изменить план</button>
          <button class="btn btn-ghost-sm wait-cancel">Отменить свидание</button>
        </div>
      </div>
    </div>`;

  const startBtn = $('.wait-start');
  const cH = $('#cH'), cM = $('#cM'), cS = $('#cS');

  const tick = () => {
    const diff = target.getTime() - Date.now();
    if (diff <= 0) {
      cH.textContent = '00'; cM.textContent = '00'; cS.textContent = '00';
      startBtn.disabled = false;
      startBtn.classList.add('glow');
      sound.receive();
      clearInterval(timer);
      return;
    }
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    cH.textContent = String(h).padStart(2, '0');
    cM.textContent = String(m).padStart(2, '0');
    cS.textContent = String(s).padStart(2, '0');
  };
  const timer = setInterval(tick, 1000);
  tick();
  current = { destroy: () => { clearInterval(timer); if (audio) { audio.pause(); audio = null; } } };

  $('.wait-back').addEventListener('click', () => show('main', { tab: 'dates' }));
  startBtn.addEventListener('click', () => { sound.tada(); show('date', { planId: p.id }); });
  $('.wait-now').addEventListener('click', () => { sound.tada(); show('date', { planId: p.id }); });
  $('.wait-edit').addEventListener('click', () => show('planner', { charId: p.charId }));
  $('.wait-cancel').addEventListener('click', () => {
    removePlan(p.id);
    toast('Свидание отменено', '🗓');
    show('main', { tab: 'dates' });
  });

  const vp = $('.wv-play');
  vp.addEventListener('click', () => {
    if (audio && !audio.paused) { audio.pause(); vp.textContent = '▶'; return; }
    if (!audio) { audio = new Audio(ch.voice); audio.addEventListener('ended', () => { vp.textContent = '▶'; }); }
    vp.textContent = '⏸';
    audio.play().catch(() => { vp.textContent = '▶'; });
  });
}

// ─── СВИДАНИЕ ───────────────────────────────────────────────────────────────

function renderDate(opts = {}) {
  const st = getState();
  const p = (opts.planId && getPlan(opts.planId)) || nextUpcoming();
  if (!p) { show('main', { tab: 'dates' }); return; }
  const ch = getChar(p.charId);
  const loc = getLoc(p.locationId);

  app.innerHTML = `
    <div class="screen date-screen">
      <div class="scene-wrap"></div>
      <div class="chat-wrap"></div>
    </div>`;

  const sceneWrap = $('.scene-wrap');
  const chatWrap = $('.chat-wrap');
  let sheetLayer = null; // создаётся лениво — только когда открывается панель

  const getSheet = () => {
    if (!sheetLayer) {
      sheetLayer = document.createElement('div');
      sheetLayer.className = 'sheet-layer';
      app.appendChild(sheetLayer);
    }
    return sheetLayer;
  };

  const scene = new DateScene(sceneWrap, { location: loc, user: st.user, character: ch });
  const brain = new ChatBrain({
    character: ch, location: loc, activities: p.activities, user: st.user,
    onPartnerSays: (text, o) => partnerSays(text, o),
    onSystem: (t) => panel.addMessage('partner', t, { kind: 'system' }),
    onStats: () => { /* прогресс накапливается в brain.stats */ },
    onPropose: (activityId) => runActivity(activityId),
  });

  const panel = new ChatPanel(chatWrap, {
    scene, brain, character: ch,
    onSend: (text) => {
      scene.emote('user', 'sip', 1400);
      brain.userSaid(text);
    },
    onMenu: openMenuSheet,
    onActivity: runActivity,
    onFinish: openFinishModal,
    onVoice: () => {
      panel.addMessage('user', '🎤 Голосовое сообщение', {});
      brain.userVoice();
    },
    onPropose: (activityId) => runActivity(activityId),
  });

  const START = Date.now();
  const LIMIT = st.premium ? Infinity : 30 * 60 * 1000;
  let warned = false;
  let ended = false;

  const timer = setInterval(() => {
    const elapsed = Date.now() - START;
    if (LIMIT === Infinity) { panel.setTimer('∞ безлимит'); return; }
    const left = LIMIT - elapsed;
    if (left <= 0) {
      panel.setTimer('00:00');
      if (!ended) endDate();
      return;
    }
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    panel.setTimer(`⏳ ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    if (!warned && left < 5 * 60 * 1000) {
      warned = true;
      panel.addMessage('partner', '⏳ Осталось 5 минут. Жаль… Время летит, когда хорошо', { kind: 'system' });
      panel.addMessage('partner', 'Может, продолжим?.. Ну или хотя бы ещё 5 минут 😊', {});
      sound.receive();
    }
  }, 1000);

  let aiNoted = false;
  function partnerSays(text, o) {
    panel.typing(true);
    scene.setTyping(true);
    setTimeout(() => {
      panel.typing(false);
      scene.setTyping(false);
      if (o.ai && !aiNoted) {
        aiNoted = true;
        panel.addMessage('partner', '✨ Ответы генерирует внешний ИИ (Groq)', { kind: 'system' });
        maybeUnlock('ai_talk');
      }
      panel.addMessage('partner', text, { emote: o.emoji, kind: o.kind, ai: o.ai });
      scene.emote('partner', o.emote || 'happy');
      if (o.emoji) scene.reactionEmoji('partner', o.emoji);
      sound.receive();
      if (o.emote === 'love') panel.setMood('🥰 Влюблённый');
      if (o.emote === 'think') panel.setMood('🤔 Задумчивый');
      if (o.emote === 'laugh') panel.setMood('😊 Весёлый');
      if (o.emote === 'blush') panel.setMood('🥰 Влюблённый');
    }, o.delay || 1200);
  }

  function runActivity(id) {
    if (id === 'music') {
      if (!musicOn) {
        brain.trigger('music');
        scene.startMusic();
        musicOn = true;
        panel.addMessage('partner', '🎵 Музыка играет. Это лучший саундтрек', { kind: 'system' });
      } else {
        scene.stopMusic();
        musicOn = false;
        panel.addMessage('partner', '🎵 Ладно, тишина — тоже музыка', { kind: 'system' });
      }
      return;
    }
    const res = brain.trigger(id);
    if (!res) return;
    switch (res.type) {
      case 'order': orderItem(res.item); break;
      case 'sunset': scene.setPhase('sunset'); panel.addMessage('partner', '🌇 Небо розовеет…', { kind: 'system' }); break;
      case 'stars': scene.setPhase('night'); panel.addMessage('partner', '🌠 Небо загорается звёздами…', { kind: 'system' }); unlock('star_gazer'); break;
      case 'flower':
        scene.addDish({ emoji: '🌹', name: 'Цветок' });
        scene.reactionEmoji('partner', '🥰');
        moments.flowers++;
        maybeUnlock('gift');
        break;
      case 'photo': doPhoto(); break;
      case 'film': scene.el?.classList.add('film-mode'); panel.addMessage('partner', '🎬 Начинается фильм…', { kind: 'system' }); break;
      case 'ducks': floatEmoji(sceneWrap, '🦆', 6); break;
      case 'quiz': openQuizSheet(res.q); break;
      case 'game': openGameSheet(); break;
      case 'voice': {
        panel.addMessage('partner', '', { kind: 'voice', secs: 16, src: ch.voice });
        break;
      }
    }
  }

  let musicOn = false;

  function orderItem(item) {
    panel.addMessage('partner', `🍽 Официант несёт ${item.name.toLowerCase()}…`, { kind: 'system' });
    scene.addDish(item, () => {
      panel.addMessage('partner', 'Ваш заказ на столе!', { kind: 'system' });
      brain.orderFood(item);
      moments.orders.push({ emoji: item.emoji, name: item.name });
      collect('dishes', item.name);
      maybeUnlock('first_order');
    });
  }

  function openMenuSheet() {
    const sheet = getSheet();
    sheet.innerHTML = `
      <div class="overlay"></div>
      <div class="sheet menu-sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">${loc.emoji} Меню · ${loc.name}</div>
        <div class="menu-list"></div>
      </div>`;
    const list = $('.menu-list', sheet);
    loc.menu.forEach((m) => {
      const card = document.createElement('div');
      card.className = 'menu-card';
      card.innerHTML = `
        <div class="mc-emoji">${m.emoji}</div>
        <div class="mc-info"><b>${m.name}</b><small>${m.desc}</small></div>
        <div class="mc-right"><span class="mc-price">${m.price} ₽</span><button class="mc-order">Заказать</button></div>`;
      $('.mc-order', card).addEventListener('click', () => {
        sheet.innerHTML = '';
        sound.coin();
        orderItem(m);
      });
      list.appendChild(card);
    });
    $('.overlay', sheet).addEventListener('click', () => { sheet.innerHTML = ''; });
  }

  function openQuizSheet(q) {
    getSheet().innerHTML = `
      <div class="overlay"></div>
      <div class="sheet quiz-sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">❓ Викторина</div>
        <p class="qz-q">${q.q}</p>
        <div class="qz-opts"></div>
      </div>`;
    const opts = $('.qz-opts', getSheet());
    q.a.forEach((a, i) => {
      const b = document.createElement('button');
      b.className = 'qz-opt';
      b.textContent = a;
      b.addEventListener('click', () => {
        const res = brain.answerQuiz(i);
        $$('.qz-opt', opts).forEach((x) => x.classList.remove('on'));
        b.classList.add(res.ok ? 'ok' : 'bad');
        if (res.ok) maybeUnlock('quiz_master');
        setTimeout(() => { getSheet().innerHTML = ''; }, 1500);
      });
      opts.appendChild(b);
    });
  }

  function openGameSheet() {
    getSheet().innerHTML = `
      <div class="overlay"></div>
      <div class="sheet game-sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">🎯 Камень-ножницы-бумага</div>
        <p class="qz-q">Лучший из трёх раундов. Победитель выбирает следующий тост!</p>
        <div class="gm-moves">
          <button class="gm-move" data-m="✊">✊</button>
          <button class="gm-move" data-m="✋">✋</button>
          <button class="gm-move" data-m="✌️">✌️</button>
        </div>
        <div class="gm-result"></div>
      </div>`;
    $$('.gm-move', getSheet()).forEach((b) => {
      b.addEventListener('click', () => {
        const res = brain.playGame(b.dataset.m);
        if (!res) return;
        const resEl = $('.gm-result', getSheet());
        resEl.innerHTML = `<div class="gm-face">${res.partnerMove}</div><div class="gm-text">${res.win ? 'Ты выиграл! 🎉' : res.draw ? 'Ничья 🤝' : 'Моя победа 😎'}</div>`;
        if (res.finished) {
          setTimeout(() => { getSheet().innerHTML = ''; }, 2600);
        }
      });
    });
  }

  function doPhoto() {
    getSheet().innerHTML = `
      <div class="overlay"></div>
      <div class="sheet photo-sheet">
        <div class="sheet-title">📸 Улыбнитесь!</div>
        <div class="ph-count">3</div>
        <p class="qz-q">Готовим плёнку…</p>
      </div>`;
    let n = 3;
    const counter = $('.ph-count', getSheet());
    const iv = setInterval(() => {
      n--;
      if (n <= 0) {
        clearInterval(iv);
        getSheet().innerHTML = `
          <div class="flash"></div>
          <div class="overlay"></div>
          <div class="sheet photo-sheet result">
            <img class="ph-img" alt="">
            <div class="sheet-title">Наше первое фото 📸</div>
            <div class="ph-actions">
              <button class="btn btn-primary" id="phSave">Сохранить в профиль</button>
              <button class="btn btn-ghost" id="phClose">Закрыть</button>
            </div>
          </div>`;
        drawDatePhoto(loc, ch, st.user).then((url) => {
          $('.ph-img', getSheet()).src = url;
          $('#phSave', getSheet()).addEventListener('click', () => {
            addGallery(url, `${loc.emoji} Свидание с ${ch.name}`);
            collect('photos');
            maybeUnlock('photo');
            brain.photoDone();
            getSheet().innerHTML = '';
            toast('Фото сохранено в профиль', '📸');
          });
        });
        $('#phClose', getSheet()).addEventListener('click', () => { getSheet().innerHTML = ''; });
      } else {
        counter.textContent = n;
        sound.click();
      }
    }, 700);
  }

  function openFinishModal() {
    if (ended) return;
    getSheet().innerHTML = `
      <div class="overlay"></div>
      <div class="modal">
        <div class="modal-emoji">🌙</div>
        <h3>Завершить свидание?</h3>
        <p>${LIMIT === Infinity ? 'Свидание безлимитное — вы можете продолжить сколько захотите.' : 'Время встречи подходит к концу. Не хочется, да?'}</p>
        <div class="modal-actions">
          <button class="btn btn-primary" id="mStay">Продолжить</button>
          <button class="btn btn-ghost" id="mEnd">Завершить</button>
        </div>
        ${LIMIT === Infinity ? '' : '<button class="btn btn-premium-link" id="mExtend">✨ Продлить +15 мин (Premium)</button>'}
      </div>`;
    $('#mStay', getSheet()).addEventListener('click', () => { getSheet().innerHTML = ''; });
    $('#mEnd', getSheet()).addEventListener('click', () => { endDate(); });
    const ext = $('#mExtend', getSheet());
    if (ext) ext.addEventListener('click', () => {
      getSheet().innerHTML = '';
      openPremium(() => {});
    });
  }

  function endDate() {
    if (ended) return;
    ended = true;
    clearInterval(timer);
    const elapsed = Math.min(LIMIT === Infinity ? Math.round((Date.now() - START) / 60000) : 30, Math.max(3, Math.round((Date.now() - START) / 60000)));
    if (brain.msgCount >= 20) maybeUnlock('chatter');
    finishDate({
      planId: p.id,
      durationMin: elapsed,
      stats: brain.stats,
      orders: moments.orders,
      activitiesUsed: p.activities,
      moments: moments,
      topics: [...brain.topics],
    });
    // глава истории: зафиксировать и поздравить, если открылась новая
    const prog = chapterProgress(p.charId);
    const storyRes = setChapter(p.charId, prog.chapter.id);
    if (storyRes.changed) {
      maybeUnlock('chapter');
      toast(`📖 Новая глава: ${prog.chapter.emoji} ${prog.chapter.name}`, '📖');
    }
    // коллекции: порог предметов и сезоны
    if (collectionCount() >= 10) maybeUnlock('collector');
    if ((getState().collections?.seasons?.length || 0) >= 2) maybeUnlock('season_traveler');
    const ch2 = getChar(p.charId);
    addDiary(ch2.diary[0], '😌');
    addLetter(p.charId, ch2.letter);
    sound.tada();
    show('recap', { charId: p.charId });
  }

  const moments = { orders: [], flowers: 0 };
  brain.start();
  scene.ambientAudio();

  current = {
    destroy: () => {
      clearInterval(timer);
      brain.destroy();
      scene.destroy();
    },
  };
}

// ─── ИТОГИ СВИДАНИЯ ─────────────────────────────────────────────────────────

function renderRecap({ charId }) {
  const st = getState();
  const ch = getChar(charId);
  const last = st.dates[st.dates.length - 1];
  const rel = relationOf(charId);
  const compat = compatibilityWith(charId);
  let shareUrl = null;

  app.innerHTML = `
    <div class="screen recap">
      <div class="recap-head">
        <div class="rh-emoji">📸</div>
        <h1>Свидание прошло</h1>
        <p class="rh-sub">Это было красиво. Сохраните этот момент.</p>
      </div>
      <div class="recap-scroll">
        <div class="share-card-wrap"><img class="share-card" alt="Карточка свидания"></div>
        <div class="stat-card">
          <h3>Ваши чувства</h3>
          <div class="stat-bars"></div>
        </div>
        <div class="red-flags">
          <h3>💬 Разбор вечера</h3>
          <div class="rf-block"><b>Что было хорошо</b><p id="rfGood"></p></div>
          <div class="rf-block"><b>Что было забавно</b><p id="rfFunny"></p></div>
          <div class="rf-block"><b>Темы, которые зацепили</b><p id="rfTopics"></p></div>
        </div>
        <div class="letter-card">
          <div class="lc-envelope">💌</div>
          <h3>Письмо после свидания</h3>
          <p class="lc-text">${esc(ch.letter)}</p>
          <div class="lc-sign">— ${esc(ch.name)}</div>
        </div>
        <div class="recap-actions">
          <button class="btn btn-primary btn-lg" id="rShare">⬇️ Скачать карточку</button>
          <button class="btn btn-ghost" id="rMem">К воспоминаниям</button>
          <button class="btn btn-ghost" id="rNext">Продолжить</button>
        </div>
      </div>
    </div>`;

  const statNames = { trust: 'Доверие', comfort: 'Комфорт', humor: 'Юмор', sympathy: 'Симпатия', romance: 'Романтика' };
  const statEmoji = { trust: '❤️', comfort: '😊', humor: '😂', sympathy: '✨', romance: '🔥' };
  const bars = $('.stat-bars');
  Object.keys(statNames).forEach((k) => {
    const v = Math.min(100, Math.round((last.stats?.[k] || 0) + rel.stats[k] * 0.6));
    const row = document.createElement('div');
    row.className = 'stat-row';
    row.innerHTML = `<span class="sr-label">${statEmoji[k]} ${statNames[k]}</span><div class="sr-track"><div class="sr-fill" style="width:0%"></div></div><span class="sr-val">${v}%</span>`;
    bars.appendChild(row);
    requestAnimationFrame(() => requestAnimationFrame(() => { $('.sr-fill', row).style.width = v + '%'; }));
  });

  const topicsLabel = { travel: 'путешествия', work: 'работа', food: 'еда', coffee: 'кофе', music: 'музыка', film: 'кино', dream: 'мечты', deep: 'глубокие темы', joke: 'юмор', pet: 'животные', hobby: 'хобби', weather: 'погода', love: 'романтика', flirt: 'флирт', chat: 'просто разговоры' };
  const topics = (last.topics || []).filter((t) => topicsLabel[t]).map((t) => topicsLabel[t]);
  $('#rfGood').textContent = [
    `Вы обменялись ${Math.max(4, last.durationMin * 3)} сообщениями и смеялись над общими шутками.`,
    last.orders.length ? `Заказ: ${last.orders.map((o) => o.emoji + ' ' + o.name).join(', ')}.` : 'Заказов не было — но это не главное.',
    compat > 85 ? `Совместимость выросла до ${compat}%. Это серьёзно.` : 'Вы узнали друг друга лучше — и это главное.',
  ].join(' ');
  $('#rfFunny').textContent = last.moments?.flowers ? `Вы подарили цветок, и ${ch.name} немного смутился(ась). Это было мило.` : 'Было пару неловких пауз — но они делают свидания настоящими.';
  $('#rfTopics').textContent = topics.length ? topics.slice(0, 5).join(' · ') : 'погода, кофе и всё на свете';

  drawShareCard(last, st.user).then((url) => {
    shareUrl = url;
    $('.share-card').src = url;
  });

  $('#rShare').addEventListener('click', () => {
    if (!shareUrl) return;
    const a = document.createElement('a');
    a.href = shareUrl;
    a.download = 'reply-date.png';
    a.click();
    toast('Карточка сохраняется…', '📸');
  });
  $('#rMem').addEventListener('click', () => { currentTab = 'memories'; show('main', { tab: 'memories' }); });
  $('#rNext').addEventListener('click', () => { currentTab = 'dates'; show('main', { tab: 'dates' }); });
}

// ─── ТАБ: СВИДАНИЯ ──────────────────────────────────────────────────────────

function tabDates(tc) {
  const st = getState();
  let html = `<header class="topbar"><div class="tb-logo">Reply<span class="tb-dot"></span></div><div class="tb-right"><span class="streak">🔥 ${st.streak}</span></div></header>`;

  // ── запланированные свидания (их может быть несколько, но не в одно время)
  const plans = [...(st.planned || [])]
    .map((p) => ({ ...p, ts: plannedDateTime(p)?.getTime() || 0 }))
    .sort((a, b) => a.ts - b.ts);
  if (plans.length) {
    html += `<h3 class="sec-title">Запланировано</h3><div class="upcoming-list">`;
    plans.forEach((p) => {
      const ch = getChar(p.charId);
      const loc = getLoc(p.locationId);
      const diff = p.ts - Date.now();
      const count = diff <= 0
        ? 'время пришло!'
        : diff < 3600000
          ? `через ${Math.max(1, Math.round(diff / 60000))} мин`
          : `через ${Math.floor(diff / 3600000)} ч ${Math.round((diff % 3600000) / 60000)} мин`;
      html += `
        <div class="upcoming-card">
          <div class="uc-photo"><img src="${ch.photo}"><div class="uc-count">${count}</div></div>
          <div class="uc-body">
            <b>${esc(ch.name)}, ${ch.age}</b>
            <p>${loc ? loc.emoji + ' ' + loc.name : ''} · ${new Date(p.dateISO + 'T00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} в ${p.time}</p>
            <div class="uc-actions">
              <button type="button" class="btn btn-primary" data-wait="${p.id}">Перейти к ожиданию</button>
              <button type="button" class="btn btn-ghost-sm" data-cancel="${p.id}">Отменить</button>
            </div>
          </div>
        </div>`;
    });
    html += `</div>`;
  }

  // ── связи
  html += `<h3 class="sec-title">Ваши связи</h3><div class="rel-list">`;
  const list = st.matched.length ? st.matched : [];
  if (!list.length) {
    html += '<div class="empty-note">Пока пусто. Познакомьтесь с кем-нибудь — и он появится здесь.</div>';
  } else {
    list.forEach((id) => {
      const ch = getChar(id);
      const rel = relationOf(id);
      const plannedWith = hasPlanFor(id);
      html += `
        <div class="rel-item" data-char="${id}">
          <img class="ri-photo" src="${ch.photo}">
          <div class="ri-info"><b>${esc(ch.name)}, ${ch.age}</b><small>❤️ ${compatibilityWith(id)}% · ${rel.datesCount ? rel.datesCount + ' свидание(й)' : 'ждут первого свидания'}</small></div>
          <button type="button" class="btn btn-small ${plannedWith ? 'disabled' : ''}" ${plannedWith ? `data-wait="${plannedWith.id}"` : `data-plan="${id}"`}>${plannedWith ? '✅ Запланировано' : 'Свидание 💘'}</button>
        </div>`;
    });
  }
  html += `</div>`;

  // ── ещё не знакомы: можно сразу познакомиться и позвать на свидание
  const others = CHARACTERS.filter((c) => !st.matched.includes(c.id));
  if (others.length) {
    html += `<h3 class="sec-title">Ещё не знакомы</h3><div class="rel-list">`;
    others.forEach((ch) => {
      html += `
        <div class="rel-item">
          <img class="ri-photo" src="${ch.photo}">
          <div class="ri-info"><b>${esc(ch.name)}, ${ch.age}</b><small>❤️ ${ch.compatibility}% · ${esc(ch.city)}</small></div>
          <button type="button" class="btn btn-small" data-meet="${ch.id}">Познакомиться 💘</button>
        </div>`;
    });
    html += `</div>`;
  }

  // ── прошлые
  if (st.dates.length) {
    html += `<h3 class="sec-title">Прошлые свидания</h3><div class="past-list">`;
    st.dates.slice().reverse().forEach((d) => {
      const c = getChar(d.charId);
      const l = getLoc(d.locationId);
      html += `
        <div class="past-item">
          <div class="pi-emoji">${l ? l.emoji : '💘'}</div>
          <div class="pi-info"><b>${esc(c.name)}</b><small>${d.dateLabel} · ${d.timeLabel} · ${d.durationMin} мин</small></div>
          <div class="pi-stats">${Object.entries(d.stats || {}).slice(0, 3).map(([k, v]) => `${k === 'romance' ? '🔥' : k === 'humor' ? '😂' : '❤️'} ${Math.round(v)}`).join(' ')}</div>
        </div>`;
    });
    html += `</div>`;
  }

  // ── один innerHTML; клики обрабатываются делегированием (attachDelegated)
  tc.innerHTML = html;
}

// ─── ТАБ: ВОСПОМИНАНИЯ ──────────────────────────────────────────────────────

function tabMemories(tc) {
  const st = getState();
  let html = `<header class="topbar"><div class="tb-logo">Reply<span class="tb-dot"></span></div><div class="tb-right"><span class="streak">🔥 ${st.streak}</span></div></header>
  <h2 class="page-title">📖 История</h2>`;

  // главы истории отношений: у каждого заметченного персонажа своя
  const matchedChars = st.matched.map((id) => getChar(id)).filter(Boolean);
  if (matchedChars.length) {
    html += `<h3 class="sec-title">Главы истории</h3><div class="chapters-list">`;
    matchedChars.forEach((ch) => {
      const prog = chapterProgress(ch.id);
      const ch2 = chapterFor(ch.id);
      html += `
        <div class="chapter-card" data-chapter-card="${ch.id}">
          <div class="chp-avatar">${ch.avatarImg ? `<img src="${ch.avatarImg}" alt="">` : ch.avatarEmoji}</div>
          <div class="chp-info">
            <b>${esc(ch.name)} · ${ch2.emoji} ${esc(ch2.name)}</b>
            <div class="chp-bar"><i style="width:${prog.percent}%"></i></div>
            <small>${prog.next ? `До главы «${esc(prog.next.name)}» — ${prog.next.need - prog.score} баллов` : 'История пройдена 💞'}</small>
          </div>
        </div>`;
    });
    html += `</div>`;
  }

  if (!st.memories.length && !st.diary.length && !st.letters.length && !matchedChars.length) {
    html += `<div class="empty-state">
      <div class="es-emoji">💌</div>
      <h3>Пока нет воспоминаний</h3>
      <p>Проведите первое свидание — и здесь появится карточка с лучшими моментами.</p>
      <button class="btn btn-primary" id="goDiscover">Найти людей</button>
    </div>`;
    tc.innerHTML = html;
    $('#goDiscover', tc).addEventListener('click', () => { currentTab = 'discover'; renderMain({ tab: 'discover' }); });
    return;
  }

  // письма
  if (st.letters.length) {
    html += `<h3 class="sec-title">Письма</h3><div class="letters-list">`;
    st.letters.forEach((l) => {
      const ch = getChar(l.charId);
      html += `
        <div class="letter-item" data-letter="${l.id}">
          <div class="li-env">💌</div>
          <div class="li-info"><b>${esc(ch.name)}</b><small>${new Date(l.ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</small></div>
          <span class="li-open" data-li-open="1">открыть</span>
          <div class="li-text">${esc(l.text)}</div>
        </div>`;
    });
    html += `</div>`;
  }

  // дневник
  if (st.diary.length) {
    html += `<h3 class="sec-title">Дневник отношений</h3><div class="diary-list">`;
    st.diary.forEach((y) => {
      html += `<div class="diary-item"><span class="di-mood">${y.mood}</span><p>${esc(y.text)}</p><small>${new Date(y.ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</small></div>`;
    });
    html += `</div>`;
  }

  // карточки моментов
  if (st.memories.length) {
    html += `<h3 class="sec-title">Моменты</h3><div class="mem-grid">`;
    st.memories.forEach((m) => {
      const rec = st.dates.find((d) => d.id === m.dateId);
      if (!rec) return;
      const ch = getChar(rec.charId);
      const l = getLoc(rec.locationId);
      html += `
        <div class="mem-card" style="background:${l ? `linear-gradient(160deg, ${l.sky[0]}, ${l.sky[l.sky.length - 1]})` : ''}">
          <div class="mc-top"><span>${l ? l.emoji : '💘'}</span><span class="mc-heart">❤️</span></div>
          <div class="mc-mid"><div class="mc-title">${esc(ch.name)}</div><div class="mc-loc">${l ? l.name : ''}</div></div>
          <div class="mc-bottom"><span>${rec.dateLabel}</span><span>${rec.durationMin} мин</span></div>
        </div>`;
    });
    html += `</div>`;
  }

  // клики по письмам обрабатываются делегированием (attachDelegated)
  tc.innerHTML = html;
}

// ─── ТАБ: КОЛЛЕКЦИИ ─────────────────────────────────────────────────────────

function tabCollections(tc) {
  const st = getState();
  const col = st.collections || {};
  const locTotal = LOCATIONS.length;
  const actTotal = ACTIVITIES.length;
  const dishTotal = LOCATIONS.reduce((n, l) => n + (l.menu?.length || 0), 0);
  const charTotal = CHARACTERS.length;
  const seasonTotal = SEASONS.length;

  const collItem = (emoji, name, on) => `
    <div class="coll-item ${on ? 'on' : 'off'}">
      <span class="ci-emoji">${emoji}</span><span class="ci-name">${esc(name)}</span>
      ${on ? '' : '<span class="ci-lock">🔒</span>'}
    </div>`;

  let html = `
    <header class="topbar"><div class="tb-logo">Reply<span class="tb-dot"></span></div>
      <div class="tb-right"><span class="streak">🔥 ${st.streak}</span></div>
    </header>
    <h2 class="page-title">🎁 Коллекции</h2>
    <div class="coll-summary">
      <div class="coll-total">${collectionCount()}<small>предметов собрано</small></div>
      <div class="coll-tags">
        <span>📍 ${col.locations?.length || 0}/${locTotal}</span>
        <span>🍽 ${col.dishes?.length || 0}/${dishTotal}</span>
        <span>🎮 ${col.activities?.length || 0}/${actTotal}</span>
        <span>📸 ${col.photos || 0}</span>
      </div>
    </div>`;

  // места свиданий
  html += `<h3 class="sec-title">Места свиданий</h3><div class="coll-grid">`;
  LOCATIONS.forEach((l) => {
    html += collItem(l.emoji, l.name, (col.locations || []).includes(l.id));
  });
  html += `</div>`;

  // времена года
  html += `<h3 class="sec-title">Времена года <small class="sec-hint">свидание в каждый сезон</small></h3><div class="coll-grid seasons">`;
  SEASONS.forEach((s) => {
    html += collItem(s.emoji, s.name, (col.seasons || []).includes(s.id));
  });
  html += `</div>`;

  // блюда
  html += `<h3 class="sec-title">Блюда и напитки</h3><div class="coll-grid dishes">`;
  LOCATIONS.forEach((l) => {
    (l.menu || []).forEach((m) => {
      html += collItem(m.emoji, m.name, (col.dishes || []).includes(m.name));
    });
  });
  html += `</div>`;

  // активности
  html += `<h3 class="sec-title">Активности</h3><div class="coll-grid activities">`;
  ACTIVITIES.forEach((a) => {
    html += collItem(a.emoji, a.name, (col.activities || []).includes(a.id));
  });
  html += `</div>`;

  // персонажи
  html += `<h3 class="sec-title">Персонажи</h3><div class="coll-grid chars">`;
  CHARACTERS.forEach((c) => {
    html += collItem(c.avatarEmoji || '👤', c.name, (col.chars || []).includes(c.id));
  });
  html += `</div>`;

  html += `<div class="empty-note">Коллекции пополняются сами: ходите на свидания, заказывайте блюда, пробуйте активности и фотографируйтесь 📸</div>`;
  tc.innerHTML = html;
}

// ─── ТАБ: ПРОФИЛЬ ───────────────────────────────────────────────────────────

function tabProfile(tc) {
  const st = getState();
  const u = st.user;
  const datesCount = st.dates.length;
  const achievements = st.achievements.length;
  const mbtiInf = MBTI_INFO[u.mbti || 'ENFP'] || { name: u.mbti || 'ENFP' };

  let html = `
    <header class="topbar"><div class="tb-logo">Reply<span class="tb-dot"></span></div>
      <div class="tb-right">
        <span class="streak">🔥 ${st.streak}</span>
        <button class="tb-icon" data-act="settings2">⚙️</button>
      </div>
    </header>
    <div class="profile">
      <div class="prof-cover">
        <div class="pc-gradient"></div>
        <div class="pc-avatar"><img src="${u.avatarImg || ''}" alt="" style="${u.avatarHue ? `filter:hue-rotate(${u.avatarHue}deg)` : ''}"></div>
      </div>
      <div class="prof-body">
        <div class="prof-name-row">
          <h2 class="prof-name">${esc(u.name)}, ${esc(u.age)} <span class="prof-verify">✓</span></h2>
          <button class="prof-edit" data-edit-profile="1" title="Редактировать профиль">✏️</button>
        </div>
        <p class="prof-city">📍 ${esc(u.city)} · ${esc(u.avatarLabel)}</p>
        <p class="prof-about">${esc(u.about || '')}</p>
        <div class="prof-stats">
          <div class="ps"><b>${compatTop()}</b><span>Совместимость</span></div>
          <div class="ps"><b>${datesCount}</b><span>Свиданий</span></div>
          <div class="ps"><b>${achievements}</b><span>Наград</span></div>
          <div class="ps"><b>${st.streak}</b><span>Серия 🔥</span></div>
        </div>
        <div class="prof-card">
          <div class="pc-row" id="profMbtiRow" style="cursor:pointer;">
            <span>🧬</span>
            <div><b>${u.mbti || 'ENFP'} · ${esc(mbtiInf.name)}</b><small>Тип личности (MBTI) — нажми для деталей</small></div>
          </div>
          <div class="pc-row"><span>🎯</span><div><b>${esc(u.goals || 'Серьёзные отношения')}</b><small>Цель знакомства</small></div></div>
          <div class="pc-row"><span>💎</span><div><b>${(u.values || []).join(', ') || 'Честность, Свобода'}</b><small>Ценности</small></div></div>
          <div class="pc-row"><span>🌿</span><div><b>${(u.habits || []).join(', ') || 'Кофе по утрам'}</b><small>Привычки</small></div></div>
        </div>

        <h3 class="sec-title">Интересы</h3>
        <div class="chips-wrap static">${(u.interests || []).map((x) => `<span class="chip on">${esc(x)}</span>`).join('')}</div>

        <h3 class="sec-title">Галерея</h3>
        <div class="gallery-grid">${st.gallery.length ? st.gallery.map((g) => `<img src="${g.dataUrl}" alt="">`).join('') : '<div class="empty-note">Совместные фото появятся здесь после свиданий 📸</div>'}</div>

        ${st.premium ? `
          <div class="premium-badge-row" style="margin-top:14px;">
            <div class="premium-badge">👑 Reply Premium активна</div>
            <button class="btn btn-ghost-sm" id="profCancelPrem" style="margin-top:8px;">Отменить Premium</button>
          </div>
        ` : `
          <div class="prem-card">
            <div class="prem-emoji">👑</div>
            <b>Reply Premium</b>
            <p>Безлимитные свидания, эксклюзивные локации, совместный просмотр фильмов и многое другое.</p>
            <button class="btn btn-gold" data-prem="1">Открыть Premium</button>
          </div>`}

        <h3 class="sec-title" style="margin-top:20px;">🏆 Достижения (${achievements} из ${_ACH.length})</h3>
        <div class="ach-grid">
          ${_ACH.map((a) => {
            const unl = st.achievements.includes(a.id);
            return `
              <div class="ach-card ${unl ? 'unlocked' : 'locked'}">
                <div class="ach-emoji">${a.emoji}</div>
                <div class="ach-info">
                  <b>${esc(a.name)}</b>
                  <small>${esc(a.desc)}</small>
                </div>
              </div>`;
          }).join('')}
        </div>

        <div style="margin-top:24px; text-align:center;">
          <a href="/api/download" class="btn btn-outline" download="reply-project.zip" style="display:inline-flex; width:auto; padding:10px 20px;">💾 Скачать проект (ZIP)</a>
        </div>
      </div>
    </div>`;

  tc.innerHTML = html;
  
  $('#profMbtiRow', tc)?.addEventListener('click', () => openMbtiModal(u.mbti || 'ENFP'));
  $('#profCancelPrem', tc)?.addEventListener('click', () => {
    cancelPremium();
    sound.pop();
    toast('Подписка Premium отключена', '👑');
    tabProfile(tc);
  });

  const premBtn = tc.querySelector('[data-prem="1"]');
  if (premBtn) premBtn.addEventListener('click', openPremium);
  tc.querySelector('[data-act="settings2"]').addEventListener('click', openSettings);
  tc.querySelector('[data-edit-profile="1"]')?.addEventListener('click', openEditProfile);

  function compatTop() {
    if (!st.matched.length) return '—';
    return Math.max(...st.matched.map((id) => compatibilityWith(id))) + '%';
  }
}

// ─── PREMIUM ────────────────────────────────────────────────────────────────

function renderPremium() {
  const st = getState();
  const features = [
    ['⏰', 'Свидания без ограничения по времени'],
    ['⏳', 'Продление встречи в один тап'],
    ['🏔', 'Эксклюзивные локации: планетарий, горы, яхта'],
    ['🎬', 'Совместный просмотр фильмов'],
    ['🎲', 'Настольные игры на свиданиях'],
    ['🎙', 'Голосовые заметки и свидания'],
    ['🎨', 'Светлая и тёмная темы оформления'],
    ['🌟', 'Специальные подарки живого мира'],
    ['🔮', 'Приоритет генерации ответов ИИ'],
  ];
  let yearly = true;

  const render = () => {
    const price = yearly ? '1 990 ₽' : '299 ₽';
    const per = yearly ? '/год' : '/месяц';
    app.innerHTML = `
      <div class="screen premium">
        <div class="prem-bg"></div>
        <div class="prem-content">
          <div class="prem-hero">
            <div class="prem-crown">👑</div>
            <h1>Reply Premium</h1>
            <p>${st.premium ? 'Ваша подписка активна и дарит все привилегии!' : 'Больше времени. Больше эмоций. Больше свиданий.'}</p>
          </div>
          <div class="prem-features">${features.map(([e, t]) => `<div class="pf-row"><span>${e}</span>${t}</div>`).join('')}</div>
          ${!st.premium ? `
            <div class="plan-toggle">
              <button class="${yearly ? 'on' : ''}" data-y="1">Год <span class="plan-sale">-45%</span></button>
              <button class="${!yearly ? 'on' : ''}" data-y="0">Месяц</button>
            </div>
            <div class="plan-price"><b>${price}</b><span>${per}</span></div>
            <button class="btn btn-gold btn-lg" id="premBuy">Оформить подписку за 0 ₽</button>
          ` : `
            <div style="text-align:center; padding:14px; background:rgba(251,191,36,0.15); border-radius:14px; margin-bottom:14px;">
              <b style="color:#fbbf24;">👑 Статус Premium активен</b>
            </div>
            <button class="btn btn-ghost" id="premCancel" style="color:#ff5e7e;">Отменить Premium</button>
          `}
          <button class="btn btn-ghost" id="premBack">Вернуться назад</button>
          <p class="prem-fine">Отмена в любой момент. Premium расширяет возможности, но Reply остаётся бесплатным для всех.</p>
        </div>
      </div>`;

    $$('.plan-toggle button').forEach((b) => {
      b.addEventListener('click', () => {
        yearly = !!Number(b.dataset.y);
        sound.pop();
        render();
      });
    });

    $('#premBuy')?.addEventListener('click', () => {
      setPremium(true);
      sound.tada();
      confetti(app);
      achPopup(_ACH.find((x) => x.id === 'premium') || { emoji: '👑', name: 'Reply Premium', desc: 'Добро пожаловать в клуб' });
      setTimeout(() => { toast('Premium активирована!', '👑'); show('main', { tab: 'profile' }); }, 1200);
    });

    $('#premCancel')?.addEventListener('click', () => {
      cancelPremium();
      sound.pop();
      toast('Подписка отменена', '👑');
      render();
    });

    $('#premBack').addEventListener('click', () => show('main', { tab: 'profile' }));
  };
  render();
}

function openPremium(cb) {
  show('premium');
}

// ─── РЕДАКТИРОВАНИЕ ПРОФИЛЯ ─────────────────────────────────────────────────

function openEditProfile() {
  const u = getState().user;
  const draft = {
    ...u,
    interests: [...(u.interests || [])],
    values: [...(u.values || [])],
    habits: [...(u.habits || [])],
  };
  const sheet = document.createElement('div');
  sheet.className = 'sheet-layer top';

  const render = () => {
    sheet.innerHTML = `
      <div class="overlay"></div>
      <div class="sheet edit-sheet" style="padding: 20px 18px 24px; max-height:88vh; overflow-y:auto;">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Редактировать профиль</div>
        
        <div class="field"><label class="ob-label">Имя</label><input id="ed-name" value="${esc(draft.name)}" maxlength="20"></div>
        
        <p class="ob-label">Пол</p>
        <div class="gender-selector" id="ed-gender">
          <button class="gender-btn ${draft.gender === 'male' ? 'sel' : ''}" data-v="male">👨 Парень</button>
          <button class="gender-btn ${draft.gender === 'female' ? 'sel' : ''}" data-v="female">👩 Девушка</button>
          <button class="gender-btn ${draft.gender === 'other' ? 'sel' : ''}" data-v="other">✨ Другое</button>
        </div>

        <p class="ob-label" style="margin-top:12px;">Кого ищете</p>
        <div class="gender-selector" id="ed-target-gender">
          <button class="gender-btn ${draft.targetGender === 'female' ? 'sel' : ''}" data-v="female">👩 Девушек</button>
          <button class="gender-btn ${draft.targetGender === 'male' ? 'sel' : ''}" data-v="male">👨 Парней</button>
          <button class="gender-btn ${draft.targetGender === 'all' ? 'sel' : ''}" data-v="all">💫 Всех</button>
        </div>

        <div class="field-row" style="margin-top:12px;">
          <div class="field"><label class="ob-label">Возраст</label><input id="ed-age" type="number" min="18" max="99" value="${esc(draft.age)}"></div>
          <div class="field"><label class="ob-label">Город</label><input id="ed-city" value="${esc(draft.city)}" maxlength="20"></div>
        </div>

        <div class="field"><label class="ob-label">О себе</label><textarea id="ed-about" rows="3" maxlength="140" placeholder="Пара слов о себе">${esc(draft.about || '')}</textarea></div>
        
        <p class="ob-label">Аватар</p>
        <div class="avatar-grid ed-avatars"></div>

        <p class="ob-label" style="margin-top:12px;">Тип MBTI</p>
        <div class="mbti-grid ed-mbti"></div>

        <p class="ob-label" style="margin-top:12px;">Ценности (до 3)</p>
        <div class="chips-wrap ed-values"></div>

        <p class="ob-label" style="margin-top:12px;">Привычки (до 2)</p>
        <div class="chips-wrap ed-habits"></div>

        <p class="ob-label" style="margin-top:12px;">Интересы (до 6)</p>
        <div class="chips-wrap ed-interests"></div>

        <p class="ob-label" style="margin-top:12px;">Цель знакомства</p>
        <div class="chips-wrap ed-goals"></div>

        <div class="edit-actions" style="margin-top:20px;">
          <button class="btn btn-primary" id="edSave">Сохранить</button>
          <button class="btn btn-ghost" id="edCancel">Отмена</button>
        </div>
      </div>`;
    $('.overlay', sheet).addEventListener('click', () => sheet.remove());

    $$('#ed-gender button', sheet).forEach((b) => {
      b.addEventListener('click', () => {
        $$('#ed-gender button', sheet).forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        draft.gender = b.dataset.v;
        sound.pop();
      });
    });

    $$('#ed-target-gender button', sheet).forEach((b) => {
      b.addEventListener('click', () => {
        $$('#ed-target-gender button', sheet).forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        draft.targetGender = b.dataset.v;
        sound.pop();
      });
    });

    // аватары
    const ag = $('.ed-avatars', sheet);
    AVATARS.forEach((a) => {
      const b = document.createElement('button');
      b.className = 'avatar-opt' + (a.img === draft.avatarImg && (a.hue || 0) === (draft.avatarHue || 0) ? ' sel' : '');
      b.innerHTML = `<img class="ao-img" src="${a.img}" alt="" style="${a.hue ? `filter:hue-rotate(${a.hue}deg)` : ''}"><span class="ao-label">${a.label}</span>`;
      b.addEventListener('click', () => {
        $$('.avatar-opt', ag).forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        draft.avatarEmoji = a.emoji;
        draft.avatarLabel = a.label;
        draft.avatarImg = a.img;
        draft.avatarHue = a.hue || 0;
        sound.pop();
      });
      ag.appendChild(b);
    });

    // MBTI
    const mg = $('.ed-mbti', sheet);
    MBTI_TYPES.forEach((t) => {
      const inf = MBTI_INFO[t] || { name: t };
      const b = document.createElement('div');
      b.className = 'mbti-card' + (draft.mbti === t ? ' sel' : '');
      b.innerHTML = `<span class="mbti-code">${t}</span><span class="mbti-role">${inf.name}</span>`;
      b.addEventListener('click', () => {
        $$('.mbti-card', mg).forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        draft.mbti = t;
        sound.pop();
      });
      mg.appendChild(b);
    });

    // ценности
    const vw = $('.ed-values', sheet);
    VALUES_LIST.forEach((v) => {
      const c = document.createElement('button');
      c.className = 'chip' + ((draft.values || []).includes(v) ? ' on' : '');
      c.textContent = v;
      c.addEventListener('click', () => {
        const arr = draft.values || [];
        const idx = arr.indexOf(v);
        if (idx >= 0) arr.splice(idx, 1);
        else if (arr.length < 3) arr.push(v);
        else { toast('Максимум 3 ценности', '💎'); return; }
        draft.values = arr;
        c.classList.toggle('on', arr.includes(v));
        sound.pop();
      });
      vw.appendChild(c);
    });

    // привычки
    const hw = $('.ed-habits', sheet);
    HABITS_LIST.forEach((h) => {
      const c = document.createElement('button');
      c.className = 'chip' + ((draft.habits || []).includes(h) ? ' on' : '');
      c.textContent = h;
      c.addEventListener('click', () => {
        const arr = draft.habits || [];
        const idx = arr.indexOf(h);
        if (idx >= 0) arr.splice(idx, 1);
        else if (arr.length < 2) arr.push(h);
        else { toast('Максимум 2 привычки', '🌿'); return; }
        draft.habits = arr;
        c.classList.toggle('on', arr.includes(h));
        sound.pop();
      });
      hw.appendChild(c);
    });

    // интересы
    const iw = $('.ed-interests', sheet);
    INTERESTS.forEach((it) => {
      const c = document.createElement('button');
      c.className = 'chip' + ((draft.interests || []).includes(it) ? ' on' : '');
      c.textContent = it;
      c.addEventListener('click', () => {
        const arr = draft.interests || [];
        const i = arr.indexOf(it);
        if (i >= 0) arr.splice(i, 1);
        else if (arr.length < 6) arr.push(it);
        else { toast('Максимум 6 интересов', '🙈'); return; }
        draft.interests = arr;
        c.classList.toggle('on', arr.includes(it));
        sound.pop();
      });
      iw.appendChild(c);
    });

    // цель знакомства
    const gw = $('.ed-goals', sheet);
    GOALS.forEach((g) => {
      const c = document.createElement('button');
      c.className = 'chip' + (draft.goals === g ? ' on' : '');
      c.textContent = g;
      c.addEventListener('click', () => {
        $$('.chip', gw).forEach((x) => x.classList.remove('on'));
        c.classList.add('on');
        draft.goals = g;
        sound.pop();
      });
      gw.appendChild(c);
    });

    $('#edSave', sheet).addEventListener('click', () => {
      draft.name = $('#ed-name', sheet).value.trim();
      draft.age = $('#ed-age', sheet).value.trim();
      draft.city = $('#ed-city', sheet).value.trim();
      draft.about = $('#ed-about', sheet).value.trim();
      if (!draft.name || !draft.age || !draft.city) { toast('Заполните имя, возраст и город', '⚠️'); return; }
      setUser({ ...draft });
      sound.coin();
      toast('Профиль обновлён', '✨');
      sheet.remove();
      currentTab = 'profile';
      renderMain({ tab: 'profile' });
    });
    $('#edCancel', sheet).addEventListener('click', () => sheet.remove());
  };

  render();
  app.appendChild(sheet);
}

// ─── НАСТРОЙКИ ──────────────────────────────────────────────────────────────

function openSettings() {
  const st = getState();
  const curTheme = getTheme();
  const sheet = document.createElement('div');
  sheet.className = 'sheet-layer top';
  sheet.innerHTML = `
    <div class="overlay"></div>
    <div class="sheet settings-sheet" style="padding: 20px 18px 24px;">
      <div class="sheet-handle"></div>
      <div class="sheet-title">Настройки</div>
      
      <p class="ob-label">Тема оформления</p>
      <div class="theme-selector" id="setThemeGroup">
        <button class="theme-btn ${curTheme === 'dark' ? 'sel' : ''}" data-t="dark">🌙 Тёмная</button>
        <button class="theme-btn ${curTheme === 'light' ? 'sel' : ''}" data-t="light">☀️ Светлая</button>
        <button class="theme-btn ${curTheme === 'auto' ? 'sel' : ''}" data-t="auto">⚙️ Авто</button>
      </div>

      <div class="set-row" style="margin-top:14px;"><span>🔊 Звуки интерфейса</span><button class="toggle ${st.sound ? 'on' : ''}" id="setSound"></button></div>
      <div class="set-row"><span>🤖 ИИ-собеседник (Groq)</span><button class="toggle ${getAIMode() !== 'off' ? 'on' : ''}" id="setAI"></button></div>
      <p class="prem-fine">ИИ подключён, если у dev-сервера есть ключ Groq (GROQ_API_KEY или groq_key.txt). Без ключа чат работает на локальном «мозге».</p>
      
      <div class="set-row" style="margin-top:10px;">
        <span>👑 Reply Premium</span>
        <b style="color:#fbbf24">${st.premium ? 'активна' : 'нет'}</b>
      </div>
      ${st.premium ? `
        <button class="btn btn-ghost" id="setCancelPrem" style="color:#ff5e7e; margin-top:4px;">Отменить подписку Premium</button>
      ` : `
        <button class="btn btn-gold" id="setOpenPrem" style="margin-top:6px;">✨ Активировать Premium (0 ₽)</button>
      `}

      <div style="margin-top:16px; display:flex; flex-direction:column; gap:8px;">
        <button class="btn btn-ghost" id="setNight">🌙 Пожелать доброй ночи</button>
        <a href="/api/download" class="btn btn-outline" download="reply-project.zip" style="text-align:center;">💾 Скачать архив проекта (ZIP)</a>
        <button class="btn btn-ghost" id="setReset" style="color:var(--mut2);">Сбросить все данные</button>
      </div>
      <p class="prem-fine" style="text-align:center; margin-top:12px;">Reply v1.2 · полная версия · живой мир + ИИ Groq + сезоны + главы</p>
    </div>`;
  app.appendChild(sheet);
  $('.overlay', sheet).addEventListener('click', () => sheet.remove());

  $$('#setThemeGroup button', sheet).forEach((b) => {
    b.addEventListener('click', () => {
      $$('#setThemeGroup button', sheet).forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      setTheme(b.dataset.t);
      sound.pop();
      toast(`Тема: ${b.textContent}`, '🎨');
    });
  });

  $('#setSound', sheet).addEventListener('click', () => {
    st.sound = !st.sound;
    save();
    $('#setSound', sheet).classList.toggle('on', st.sound);
    if (st.sound) sound.pop();
  });

  $('#setAI', sheet).addEventListener('click', () => {
    setAIMode(getAIMode() !== 'off' ? 'off' : 'groq');
    $('#setAI', sheet).classList.toggle('on', getAIMode() !== 'off');
    toast(getAIMode() !== 'off' ? 'Внешний ИИ включён' : 'Внешний ИИ выключен', '🤖');
  });

  $('#setOpenPrem', sheet)?.addEventListener('click', () => {
    sheet.remove();
    openPremium();
  });

  $('#setCancelPrem', sheet)?.addEventListener('click', () => {
    cancelPremium();
    sound.pop();
    toast('Подписка Premium отменена', '👑');
    sheet.remove();
    openSettings();
  });

  $('#setNight', sheet)?.addEventListener('click', () => {
    sheet.remove();
    openGoodNightModal();
  });

  $('#setReset', sheet).addEventListener('click', () => {
    if (confirm('Точно сбросить весь прогресс?')) {
      resetAll();
      sheet.remove();
      show('splash');
    }
  });
}

// ─── ПОРТ РЕГИСТРАЦИИ ───────────────────────────────────────────────────────

window.__replyDebug = { show };
