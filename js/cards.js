// ─── Reply · генерация карточек (canvas) ────────────────────────────────────

import { getChar, getLoc } from './data.js';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxW, lh) {
  const words = String(text).split(' ');
  let line = '';
  const lines = [];
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  lines.push(line);
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
  return lines.length * lh;
}

function grain(ctx, w, h, n = 1600) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
  }
}

function vignette(ctx, w, h) {
  const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.85);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(10,5,20,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function loadImg(src) {
  return new Promise((res) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

// Шеринг-карточка после свидания (вертикальная, как сторис)
export async function drawShareCard(dateRec, user) {
  const W = 1080, H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const loc = getLoc(dateRec.locationId);
  const ch = getChar(dateRec.charId);

  // фон — градиент локации
  const sky = loc ? loc.sky : ['#1a0f1e', '#0b0712'];
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, sky[0]);
  g.addColorStop(1, sky[sky.length - 1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // «свет» от свечей
  const glow = ctx.createRadialGradient(W / 2, H * 0.42, 60, W / 2, H * 0.42, 520);
  glow.addColorStop(0, 'rgba(255,180,110,0.35)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // декоративные эмодзи
  ctx.font = '110px serif';
  ctx.textAlign = 'center';
  ctx.globalAlpha = 0.16;
  ['🕯️', '✨', '💫', '🌙'].forEach((e, i) => {
    ctx.fillText(e, 90 + i * 300, 200 + (i % 2) * 260);
  });
  ctx.globalAlpha = 1;

  // фото персонажа (если доступно)
  if (ch) {
    const img = await loadImg(ch.photo);
    if (img) {
      ctx.save();
      const size = 430;
      const x = W / 2 - size / 2, y = 210;
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 70;
      ctx.beginPath();
      ctx.arc(W / 2, y + size / 2, size / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, x, y, size, size);
      ctx.restore();
      // кольцо
      ctx.beginPath();
      ctx.arc(W / 2, y + size / 2, size / 2 + 10, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 6;
      ctx.stroke();
    }
  }

  // заголовок
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '700 66px Manrope, sans-serif';
  ctx.fillText('📸', W / 2, 120);
  ctx.font = '700 64px "Unbounded", sans-serif';
  ctx.fillText('Наше первое свидание', W / 2, H * 0.64);
  ctx.font = '500 56px Manrope, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(`${loc ? loc.emoji + ' ' : ''}${loc ? loc.name : 'Reply'}`, W / 2, H * 0.64 + 96);

  // детали
  ctx.font = '500 44px Manrope, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText(`${dateRec.dateLabel} · ${dateRec.timeLabel}`, W / 2, H * 0.64 + 170);
  ctx.fillText(`⏳ ${dateRec.durationMin} минут`, W / 2, H * 0.64 + 240);

  // заказы
  if (dateRec.orders && dateRec.orders.length) {
    ctx.font = '500 40px Manrope, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    const orderLine = 'Заказали: ' + dateRec.orders.map((o) => o.emoji + ' ' + o.name).slice(0, 3).join(' · ');
    wrapText(ctx, orderLine, W / 2, H * 0.64 + 330, W - 160, 52);
  }

  // лучший момент
  ctx.font = '500 40px Manrope, sans-serif';
  ctx.fillStyle = 'rgba(255,220,230,0.95)';
  const quote = '«' + (dateRec.bestMoment || 'Мне было очень легко с тобой.') + '»';
  const y0 = H * 0.64 + 470;
  const qh = wrapText(ctx, quote, W / 2, y0, W - 180, 52);

  // совместимость
  const comp = 88;
  ctx.font = '600 46px Manrope, sans-serif';
  ctx.fillStyle = '#ff8fa8';
  ctx.fillText(`Совместимость ${comp}%`, W / 2, y0 + qh + 90);
  ctx.fillText('❤️', W / 2, y0 + qh + 170);

  ctx.font = '500 34px Manrope, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText('Reply · не чат, а первое свидание', W / 2, H - 70);

  grain(ctx, W, H);
  vignette(ctx, W, H);
  return canvas.toDataURL('image/png');
}

// «Фотография» со сцены свидания (POV-кадр)
export async function drawDatePhoto(loc, char, user) {
  const S = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');
  const sky = loc ? loc.sky : ['#241408', '#120a06'];
  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, sky[0]);
  g.addColorStop(1, sky[sky.length - 1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  // горизонт/пол
  ctx.fillStyle = 'rgba(10,6,18,0.55)';
  ctx.fillRect(0, S * 0.62, S, S * 0.38);

  // стол
  ctx.fillStyle = '#3a2418';
  roundRect(ctx, S * 0.2, S * 0.68, S * 0.6, S * 0.1, 22);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  roundRect(ctx, S * 0.2, S * 0.68, S * 0.6, S * 0.02, 10);
  ctx.fill();

  // свеча
  ctx.font = '120px serif';
  ctx.textAlign = 'center';
  ctx.fillText('🕯️', S * 0.5, S * 0.6);

  // персонажи (аватары-картинки, если доступны; иначе эмодзи)
  ctx.textAlign = 'center';
  const drawAvatar = async (avatarImg, emojiFallback, x, size) => {
    if (avatarImg) {
      const img = await loadImg(avatarImg);
      if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, S * 0.62, size / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, x - size / 2, S * 0.62 - size / 2, size, size);
        ctx.restore();
        return;
      }
    }
    ctx.font = '240px serif';
    ctx.fillText(emojiFallback, x, S * 0.66);
  };
  await drawAvatar(user.avatarImg, user.avatarEmoji, S * 0.32, 230);
  await drawAvatar(char.avatarImg, char.avatarEmoji, S * 0.68, 230);

  // подпись
  ctx.font = '700 54px "Unbounded", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 20;
  ctx.fillText('наше первое свидание', S / 2, S * 0.14);
  ctx.font = '500 40px Manrope, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText(`${loc ? loc.emoji + ' ' + loc.name : 'Reply'} · ${char.name}`, S / 2, S * 0.14 + 70);
  ctx.fillText('Reply ❤️', S / 2, S * 0.93);
  ctx.shadowBlur = 0;

  grain(ctx, S, S);
  vignette(ctx, S, S);
  return canvas.toDataURL('image/png');
}
