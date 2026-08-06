// ─── Reply · сцена свидания ─────────────────────────────────────────────────

import { Particles } from './effects.js';
import { sound } from './audio.js';
import { getSeason } from './seasons.js';

function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

const TABLE_EXTRAS = {
  cafe: ['🕯️', '🌿'],
  restaurant: ['🕯️', '🌹'],
  picnic: ['🧺', '🌼'],
  bench: ['🪴', '🕯️'],
  beach: ['🏖️', '🦩'],
  cinema: ['🍿', '🎬'],
  gallery: ['🗿', '🖼️'],
  tatami: ['🍵', '🌸'],
  library: ['📚', '🕯️'],
  arcade: ['🕹️', '👾'],
  planetarium: ['🔭', '🌌'],
  cabin: ['🔥', '🪵'],
  yacht: ['⚓', '🥂'],
};

const GROUND = {
  park: '#2e5b3e', garden: '#3f5f52', beach: '#c9a06a', cabin: '#182c44',
  yacht: '#123a4a', embankment: '#1c2240',
};

export class DateScene {
  constructor(container, { location, user, character }) {
    this.container = container;
    this.el = container;
    this.loc = location;
    this.user = user;
    this.char = character;
    this.container.innerHTML = '';
    this.container.classList.add('scene');
    this.container.dataset.phase = 'day';
    this.container.dataset.table = location.table;

    // небо
    this.sky = h('div', 'scene-sky');
    this.sky.style.background = `linear-gradient(180deg, ${location.sky.join(', ')})`;
    this.container.appendChild(this.sky);

    // сезон живого мира: лёгкий тон + бейдж
    this.season = getSeason();
    const tint = h('div', 'scene-season');
    tint.style.background = `radial-gradient(120% 80% at 50% 0%, ${this.season.glow}, transparent 60%)`;
    this.container.appendChild(tint);
    const chip = h('div', 'season-chip');
    chip.innerHTML = `${this.season.emoji} ${this.season.name}`;
    chip.title = 'Сейчас за окном';
    this.container.appendChild(chip);

    // солнце / луна
    this.heaven = h('div', 'scene-heaven');
    const sun = location.weather === 'snow' ? '🌙' : (location.weather === 'stars' ? '🌙' : this.season.heaven || '☀️');
    this.heaven.textContent = sun;
    this.container.appendChild(this.heaven);

    // горизонт (город / деревья / горы)
    this.horizon = h('div', 'scene-horizon');
    this.container.appendChild(this.horizon);

    // пропсы локации (разбросаны по сцене)
    this.propsEl = h('div', 'scene-props');
    const allProps = [...(location.props || []), ...(location.ambient || [])];
    allProps.forEach((p, i) => {
      const el = h('div', 'prop');
      el.textContent = p;
      const side = i % 2 === 0 ? 6 + (i % 3) * 6 : 74 - (i % 3) * 6;
      const top = 8 + ((i * 13) % 26);
      el.style.left = side + '%';
      el.style.top = top + '%';
      el.style.animationDelay = (i * 0.7) + 's';
      this.propsEl.appendChild(el);
    });
    this.container.appendChild(this.propsEl);

    // сцена со столиком
    this.stage = h('div', 'stage');
    this.stage.innerHTML = `
      <div class="char char-user" data-side="user">
        <div class="char-shadow"></div>
        <div class="char-head">${user.avatarImg ? `<img src="${user.avatarImg}" alt="">` : `<span>${user.avatarEmoji}</span>`}</div>
        <div class="char-body"></div>
        <div class="char-bubble"></div>
      </div>
      <div class="table-wrap">
        <div class="table-glow"></div>
        <div class="table"></div>
        <div class="table-extra"></div>
        <div class="dish-zone"></div>
        <div class="waiter"></div>
      </div>
      <div class="char char-partner" data-side="partner">
        <div class="char-shadow"></div>
        <div class="char-head">${character.avatarImg ? `<img src="${character.avatarImg}" alt="">` : `<span>${character.avatarEmoji}</span>`}</div>
        <div class="char-body"></div>
        <div class="char-bubble"></div>
      </div>
    `;
    this.container.appendChild(this.stage);

    // экстра столика
    const extra = this.stage.querySelector('.table-extra');
    (TABLE_EXTRAS[location.table] || ['🕯️']).forEach((e) => {
      const el = h('span', 't-extra');
      el.textContent = e;
      extra.appendChild(el);
    });

    // земля
    this.groundEl = h('div', 'scene-ground');
    const g = GROUND[location.id] || '#151019';
    this.groundEl.style.background = `linear-gradient(180deg, transparent, ${g} 30%)`;
    this.container.appendChild(this.groundEl);

    // виньетка
    this.container.appendChild(h('div', 'scene-vignette'));

    // погодные частицы
    const weatherMap = {
      rain: 'rain', leaves: 'leaves', snow: 'snow', stars: 'stars',
      petals: 'petals', fireflies: 'fireflies',
    };
    if (weatherMap[location.weather]) {
      this.particles = new Particles(this.container, weatherMap[location.weather]);
    } else if (this.season.particles) {
      // у локаций без своей погоды — сезонные частицы (лепестки/листья/снег)
      this.particles = new Particles(this.container, this.season.particles, { count: 40 });
    }

    // реклама «сейчас играет»
    this.nowPlaying = h('div', 'now-playing');
    this.nowPlaying.innerHTML = `<span class="np-eq"><i></i><i></i><i></i><i></i></span><span>${location.music}</span>`;
    this.container.appendChild(this.nowPlaying);
    this.nowPlaying.classList.add('on');

    // референсы
    this.userEl = this.stage.querySelector('.char-user');
    this.partnerEl = this.stage.querySelector('.char-partner');
    this.dishZone = this.stage.querySelector('.dish-zone');
    this.waiter = this.stage.querySelector('.waiter');

    if (location.table === 'cinema' || location.table === 'planetarium') {
      this.userEl.classList.add('recline');
      this.partnerEl.classList.add('recline');
    }

    // стартовая анимация
    requestAnimationFrame(() => {
      this.userEl.classList.add('anim-bob');
      this.partnerEl.classList.add('anim-bob');
      this.emote('partner', 'wave');
    });
  }

  // ── анимации персонажей ──────────────────────────────────────────────────
  emote(side, anim, ms = 2200) {
    const el = side === 'user' ? this.userEl : this.partnerEl;
    if (anim === 'idle') {
      el.classList.remove('anim-bob'); el.classList.add('anim-bob');
      return;
    }
    el.classList.remove('anim-bob');
    el.classList.add('anim-' + anim);
    setTimeout(() => {
      el.classList.remove('anim-' + anim);
      el.classList.add('anim-bob');
    }, ms);
  }

  reactionEmoji(side, emoji) {
    const el = side === 'user' ? this.userEl : this.partnerEl;
    const b = el.querySelector('.char-bubble');
    b.textContent = emoji;
    b.classList.add('show');
    setTimeout(() => b.classList.remove('show'), 1800);
  }

  bubble(side, text, ms = 4200) {
    const el = side === 'user' ? this.userEl : this.partnerEl;
    const b = el.querySelector('.char-bubble');
    b.innerHTML = text;
    b.classList.add('show', 'text');
    clearTimeout(this._bubbleT);
    this._bubbleT = setTimeout(() => b.classList.remove('show', 'text'), ms);
  }

  setTyping(on) {
    this.partnerEl.classList.toggle('typing', !!on);
  }

  // ── мир ───────────────────────────────────────────────────────────────────
  addDish(item, cb) {
    this.emote('user', 'sip', 1600);
    this.waiter.innerHTML = '';
    const w = h('div', 'waiter-fig');
    w.innerHTML = `<span class="w-face">🧑‍🍳</span><span class="w-dish">${item.emoji}</span>`;
    this.waiter.appendChild(w);
    this.waiter.classList.add('go');
    sound.pop();
    setTimeout(() => {
      const dish = h('div', 'dish');
      dish.textContent = item.emoji;
      this.dishZone.appendChild(dish);
      while (this.dishZone.children.length > 5) this.dishZone.firstChild.remove();
      this.waiter.classList.remove('go');
      this.waiter.innerHTML = '';
      if (cb) cb();
    }, 900);
  }

  setPhase(phase) {
    this.container.dataset.phase = phase;
    if (phase === 'sunset') this.heaven.textContent = '🌇';
    if (phase === 'night') this.heaven.textContent = '🌙';
  }

  startMusic() {
    this.nowPlaying.classList.add('boost');
  }

  stopMusic() {
    this.nowPlaying.classList.remove('boost');
  }

  ambientAudio() {
    const map = { rain: 'rain', snow: 'snow', leaves: 'leaves', petals: 'petals', stars: 'stars', fireflies: 'fireflies' };
    const kind = map[this.loc.weather] || (this.loc.table === 'cinema' || this.loc.table === 'planetarium' ? 'stars' : null);
    if (kind) sound.startAmbient(kind);
  }

  destroy() {
    if (this.particles) this.particles.destroy();
    sound.stopAmbient();
    this.container.innerHTML = '';
    this.container.classList.remove('scene');
  }
}
