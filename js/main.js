// ─── Reply · входная точка v1.3.2 · спиннер загрузки ────────────────────────

import { init } from './ui.js';
import { sound } from './audio.js';
import { applyTheme } from './state.js';

window.addEventListener('DOMContentLoaded', () => {
  try { applyTheme(); } catch (e) { console.error(e); }
  const root = document.getElementById('app');
  if (!root) return;
  try {
    init(root);
  } catch (e) {
    console.error('init failed', e);
    // fallback — простой splash со спиннером, без кнопок сброса
    root.innerHTML = `
      <div class="screen splash">
        <div class="logo-bubble">💬</div>
        <h1 class="logo-text">Reply</h1>
        <div class="spinner" style="margin:20px auto;"></div>
        <p class="splash-sub">Загружаем первое свидание...</p>
      </div>`;
    // пробуем ещё раз через секунду
    setTimeout(() => {
      try { init(root); } catch (e2) { console.error(e2); }
    }, 1000);
  }
  const unlock = () => {
    try { sound.ensure(); } catch (e) {}
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
});
