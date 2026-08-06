// ─── Reply · частицы и спецэффекты ──────────────────────────────────────────

// Канвас с частицами: дождь, листья, снег, звёзды, светлячки, лепестки
export class Particles {
  constructor(container, kind, opts = {}) {
    this.container = container;
    this.kind = kind;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'fx-canvas';
    this.ctx = this.canvas.getContext('2d');
    this.parts = [];
    this.running = true;
    this.count = opts.count || 60;
    this.resize();
    container.appendChild(this.canvas);
    window.addEventListener('resize', () => this.resize());
    this.spawn();
    this.loop = requestAnimationFrame(() => this.tick());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.running = false; cancelAnimationFrame(this.loop); }
      else { this.running = true; this.loop = requestAnimationFrame(() => this.tick()); }
    });
  }

  resize() {
    const r = this.container.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(r.width));
    this.canvas.height = Math.max(1, Math.floor(r.height));
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
  }

  spawn() {
    const n = this.kind === 'stars' ? Math.round(this.count * 0.6) : this.count;
    for (let i = 0; i < n; i++) {
      this.parts.push(this.make(true));
    }
  }

  make(anywhere = false) {
    const w = this.canvas.width, h = this.canvas.height;
    const base = {
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : -20,
      s: 1 + Math.random() * 2.4,
      vx: (Math.random() - 0.5) * 0.6,
      vy: 0.8 + Math.random() * 2.2,
      a: 0.5 + Math.random() * 0.5,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.05,
    };
    switch (this.kind) {
      case 'rain': return { ...base, vy: 9 + Math.random() * 7, vx: -1.5 - Math.random() * 1.5, s: 1, len: 10 + Math.random() * 14 };
      case 'leaves': return { ...base, vy: 1.2 + Math.random(), vx: (Math.random() - 0.5) * 1.4, sway: Math.random() * 0.05, c: ['#c96f2f', '#d9a03f', '#a4562c', '#7a9e4f'][Math.floor(Math.random() * 4)] };
      case 'snow': return { ...base, vy: 0.5 + Math.random() * 1.2, vx: (Math.random() - 0.5) * 0.5, c: 'rgba(255,255,255,0.9)' };
      case 'petals': return { ...base, vy: 0.8 + Math.random() * 1.2, vx: (Math.random() - 0.5) * 1.2, c: ['#ffb7c5', '#ffd6e0', '#ff9eb3'][Math.floor(Math.random() * 3)] };
      case 'stars': return { ...base, vy: 0, vx: 0, tw: Math.random() * 0.05, ph: Math.random() * 6.28 };
      case 'fireflies': return { ...base, vy: (Math.random() - 0.5) * 0.3, vx: (Math.random() - 0.5) * 0.3, tw: Math.random() * 0.08, c: '#ffe28a', ph: Math.random() * 6.28 };
      case 'sparks': return { ...base, vy: -(0.5 + Math.random()), vx: (Math.random() - 0.5), tw: 0.1, c: '#ffd76a', ph: Math.random() * 6.28 };
      default: return base;
    }
  }

  tick() {
    if (!this.running) return;
    const { ctx } = this;
    const w = this.canvas.width, h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      p.x += p.vx; p.y += p.vy;
      p.rot += p.vr || 0;
      if (p.sway) p.x += Math.sin(p.y * p.sway * 20) * 0.4;
      if (p.tw) p.a = 0.35 + Math.abs(Math.sin(p.ph + performance.now() * p.tw)) * 0.65;
      if (p.y > h + 30 || p.x < -40 || p.x > w + 40) {
        this.parts[i] = this.make(false);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = p.a;
      ctx.translate(p.x, p.y);
      if (this.kind === 'rain') {
        ctx.rotate(Math.atan2(p.vy, p.vx) + Math.PI / 2);
        ctx.strokeStyle = 'rgba(180,210,255,0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, p.len); ctx.stroke();
      } else if (this.kind === 'stars') {
        ctx.fillStyle = '#fff8e0';
        ctx.shadowColor = '#fff8e0'; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(0, 0, p.s, 0, 6.28); ctx.fill();
      } else if (this.kind === 'fireflies' || this.kind === 'sparks') {
        ctx.fillStyle = p.c;
        ctx.shadowColor = p.c; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(0, 0, p.s, 0, 6.28); ctx.fill();
      } else {
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.s * 2.4, p.s * 1.1, 0, 0, 6.28);
        ctx.fill();
      }
      ctx.restore();
    }
    this.loop = requestAnimationFrame(() => this.tick());
  }

  destroy() {
    cancelAnimationFrame(this.loop);
    this.canvas.remove();
  }
}

// ─── Всплывающие сердечки / эмодзи ──────────────────────────────────────────
export function floatEmoji(parent, emoji, count = 8, cls = 'float-heart') {
  const frag = document.createDocumentFragment();
  const els = [];
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = emoji;
    el.style.left = (10 + Math.random() * 80) + '%';
    el.style.animationDelay = (Math.random() * 0.6) + 's';
    el.style.fontSize = (16 + Math.random() * 18) + 'px';
    els.push(el);
    frag.appendChild(el);
  }
  parent.appendChild(frag);
  setTimeout(() => els.forEach((e) => e.remove()), 3400);
}

export function burstHearts(el) {
  floatEmoji(el, '❤️', 10);
  setTimeout(() => floatEmoji(el, '💗', 6), 250);
}

// ─── Конфетти (простой вариант) ─────────────────────────────────────────────
export function confetti(parent, count = 120) {
  const colors = ['#ff5e7e', '#ff8e53', '#8b5cf6', '#f9a8d4', '#fbbf24', '#34d399', '#60a5fa'];
  const frag = document.createDocumentFragment();
  const els = [];
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-bit';
    el.style.left = Math.random() * 100 + '%';
    el.style.top = -10 + 'px';
    el.style.background = colors[Math.floor(Math.random() * colors.length)];
    el.style.transform = 'rotate(' + Math.random() * 360 + 'deg)';
    el.style.animationDuration = (2 + Math.random() * 2.5) + 's';
    el.style.animationDelay = (Math.random() * 0.8) + 's';
    el.style.width = (6 + Math.random() * 6) + 'px';
    el.style.height = (10 + Math.random() * 8) + 'px';
    els.push(el);
    frag.appendChild(el);
  }
  parent.appendChild(frag);
  setTimeout(() => els.forEach((e) => e.remove()), 6200);
}
