// ─── Reply · входная точка ──────────────────────────────────────────────────

import { init } from './ui.js';
import { sound } from './audio.js';

window.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('app');
  init(root);
  // первый жест — инициализация аудио
  const unlock = () => sound.ensure();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
});
