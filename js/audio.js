// ─── Reply · звук (WebAudio) ────────────────────────────────────────────────

import { getState } from './state.js';

class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ambientNodes = [];
    this.muted = false;
    // контекст создаётся ТОЛЬКО после жеста пользователя (автоплей-политика):
    // ждём первое нажатие/клавишу и инициализируемся в этот момент
    this._boundEnsure = () => {
      try { this.ensure(); } catch (e) { /* noop */ }
    };
    ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => {
      window.addEventListener(ev, this._boundEnsure, { once: true, passive: true });
    });
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(this.ctx.destination);
      } catch (e) {
        this.ctx = null;
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      try {
        const p = this.ctx.resume();
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* noop */ }
    }
    return this.ctx;
  }

  enabled() {
    return getState().sound && !this.muted;
  }

  // простой «поп»
  blip(freq = 660, dur = 0.08, type = 'sine', vol = 0.12, slide = 0) {
    if (!this.enabled()) return;
    // не создаём контекст здесь: до первого жеста звуков нет, и это нормально
    // (иначе Chrome блокирует AudioContext и сыпет предупреждениями)
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    try {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, ctx.currentTime);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), ctx.currentTime + dur);
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.connect(g).connect(this.master);
      o.start();
      o.stop(ctx.currentTime + dur + 0.02);
    } catch (e) { /* noop */ }
  }

  pop() { this.blip(520, 0.07, 'sine', 0.1, 180); }
  like() { this.blip(660, 0.09, 'sine', 0.12, 220); setTimeout(() => this.blip(880, 0.12, 'sine', 0.1, 160), 70); }
  nope() { this.blip(300, 0.1, 'sine', 0.1, -120); }
  match() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => setTimeout(() => this.blip(f, 0.22, 'sine', 0.13, 60), i * 90));
  }
  send() { this.blip(880, 0.05, 'triangle', 0.07, 120); }
  receive() { this.blip(440, 0.09, 'sine', 0.09, -60); }
  click() { this.blip(700, 0.04, 'triangle', 0.06); }
  coin() { this.blip(988, 0.08, 'sine', 0.1, 120); setTimeout(() => this.blip(1319, 0.16, 'sine', 0.1), 80); }
  tada() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => this.blip(f, 0.2, 'sine', 0.12), i * 100));
  }

  // ─── Амбиент локации ──────────────────────────────────────────────────────
  stopAmbient() {
    this.ambientNodes.forEach((n) => {
      try { n.stop(); } catch (e) { /* noop */ }
    });
    this.ambientNodes = [];
  }

  startAmbient(kind) {
    this.stopAmbient();
    const ctx = this.ensure();
    if (!ctx) return;
    const master = this.master;

    if (kind === 'rain') {
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 0.4;
      const g = ctx.createGain(); g.gain.value = 0.06;
      src.connect(bp).connect(g).connect(master);
      src.start();
      this.ambientNodes.push(src);
    }

    if (kind === 'snow' || kind === 'leaves' || kind === 'petals') {
      const len = ctx.sampleRate * 1.5;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 900;
      const g = ctx.createGain(); g.gain.value = 0.02;
      src.connect(lp).connect(g).connect(master);
      src.start();
      this.ambientNodes.push(src);
    }

    // тёплый «пэд» — медленные аккорды
    const chords = kind === 'stars' ? [220, 261.6, 329.6] : [196, 246.9, 293.7];
    chords.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = f * 1.005;
      const g = ctx.createGain();
      g.gain.value = 0.016;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.03;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.01;
      lfo.connect(lfoG).connect(g.gain);
      o.connect(g); o2.connect(g);
      g.connect(master);
      o.start(); o2.start(); lfo.start();
      this.ambientNodes.push(o, o2, lfo);
    });
  }
}

export const sound = new Sound();
