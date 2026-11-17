// Canvas-текстуры: текст, шум, карты нормалей, свечение.
import * as THREE from 'three';
import { fontCss, fontState } from './fonts.js';

let maxAniso = 4;
/** Движок сообщает предел анизотропии рендерера. */
export function setMaxAnisotropy(v) { maxAniso = Math.max(1, Math.min(8, v || 1)); }

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

/**
 * THREE.CanvasTexture с правильным цветовым пространством.
 * opts: { srgb=true, repeat=false, aniso=4, mipmaps=true }
 */
export function canvasTexture(canvas, opts = {}) {
  const { srgb = true, repeat = false, aniso = 4, mipmaps = true } = opts;
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = Math.min(aniso, maxAniso);
  t.generateMipmaps = mipmaps;
  t.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

// ---------- текст ----------

let measureCtx = null;
function mctx() { return measureCtx || (measureCtx = makeCanvas(4, 4).getContext('2d')); }

/** Все надписи в игре — прописные. */
export function upper(text) { return String(text == null ? '' : text).toLocaleUpperCase('ru-RU'); }

function setFont(ctx, capPx, weight, spacingEm) {
  const px = capPx / fontState.capRatio;
  ctx.font = fontCss(px, weight);
  if ('letterSpacing' in ctx) ctx.letterSpacing = (px * spacingEm).toFixed(2) + 'px';
  return px;
}

/**
 * Размер блока текста. capPx — высота прописной буквы в пикселях.
 * opts: { weight=600, spacing=0.04 (em), lineGap=0.6 (доля cap между строками) }
 * → { width, height, lines, widths }
 */
export function measureLabel(text, capPx, opts = {}) {
  const { weight = 600, spacing = 0.04, lineGap = 0.6 } = opts;
  const ctx = mctx();
  setFont(ctx, capPx, weight, spacing);
  const lines = upper(text).split('\n');
  const widths = lines.map(l => ctx.measureText(l).width);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  return {
    lines, widths,
    width: Math.max(0, ...widths),
    height: lines.length * capPx + (lines.length - 1) * capPx * lineGap,
  };
}

/**
 * Рисует (многострочный) текст с центром блока в (cx, cy).
 * opts: { color, weight, spacing, lineGap, align:'center'|'left'|'right', maxWidth, upper=true }
 * Слишком длинные строки сжимаются по горизонтали до maxWidth.
 */
export function drawLabel(ctx, text, cx, cy, capPx, opts = {}) {
  const { color = '#e8e0c8', weight = 600, spacing = 0.04, lineGap = 0.6, align = 'center', maxWidth = 0 } = opts;
  const lines = (opts.upper === false ? String(text) : upper(text)).split('\n');
  ctx.save();
  setFont(ctx, capPx, weight, spacing);
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const pitch = capPx * (1 + lineGap);
  const total = lines.length * capPx + (lines.length - 1) * capPx * lineGap;
  let y = cy - total / 2 + capPx;
  let maxW = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width;
    // letterSpacing добавляет хвост после последней буквы — компенсируем при центрировании
    const tail = ('letterSpacing' in ctx) ? (capPx / fontState.capRatio) * spacing : 0;
    const vis = Math.max(0, w - tail);
    const k = maxWidth > 0 && vis > maxWidth ? maxWidth / vis : 1;
    const dw = vis * k;
    const x = align === 'left' ? cx : align === 'right' ? cx - dw : cx - dw / 2;
    if (k !== 1) { ctx.save(); ctx.translate(x, y); ctx.scale(k, 1); ctx.fillText(line, 0, 0); ctx.restore(); }
    else ctx.fillText(line, x, y);
    maxW = Math.max(maxW, dw);
    y += pitch;
  }
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.restore();
  return { width: maxW, height: total };
}

export function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- шум ----------

export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Периодический value-noise size×size, решётка cx×cy; значения 0..1. */
export function tileNoise(size, cx, cy, rnd) {
  const lat = new Float32Array(cx * cy);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = y / size * cy, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
    const y0 = (iy % cy) * cx, y1 = ((iy + 1) % cy) * cx;
    for (let x = 0; x < size; x++) {
      const fx = x / size * cx, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
      const x0 = ix % cx, x1 = (ix + 1) % cx;
      const a = lat[y0 + x0] + (lat[y0 + x1] - lat[y0 + x0]) * sx;
      const b = lat[y1 + x0] + (lat[y1 + x1] - lat[y1 + x0]) * sx;
      out[y * size + x] = a + (b - a) * sy;
    }
  }
  return out;
}

/** Фрактальный шум (сумма октав), 0..1. */
export function fbm(size, cx, cy, octaves, rnd) {
  const out = new Float32Array(size * size);
  let amp = 1, sum = 0;
  for (let o = 0; o < octaves; o++) {
    const n = tileNoise(size, Math.min(size, cx << o), Math.min(size, cy << o), rnd);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    sum += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= sum;
  return out;
}

/** Карта нормалей (canvas) из карты высот Float32Array size×size (с заворотом по краям). */
export function normalMapFromHeight(height, size, strength = 2) {
  const c = makeCanvas(size, size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size, yp = ((y + 1) % size) * size, yc = y * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size, xp = (x + 1) % size;
      const dx = (height[yc + xp] - height[yc + xm]) * strength;
      const dy = (height[yp + x] - height[ym + x]) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (yc + x) * 4;
      d[i] = (0.5 - 0.5 * dx * inv) * 255;      // nx = -dh/du
      d[i + 1] = (0.5 + 0.5 * dy * inv) * 255;  // ny = -dh/dv = +dh/dy(canvas), т.к. flipY
      d[i + 2] = (0.5 + 0.5 * inv) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Мягкий радиальный ореол (для спрайтов свечения и «пятен света»). */
export function glowCanvas(size = 128, power = 2.2) {
  const c = makeCanvas(size, size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data, h = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.min(1, Math.hypot(x + 0.5 - h, y + 0.5 - h) / h);
    const v = Math.pow(1 - r, power);
    const i = (y * size + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = Math.round(255 * v); d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Готовая текстура с текстом на прозрачном или цветном фоне.
 * opts: { w, h (px), cap (px), color, bg, weight } → THREE.Texture
 */
export function textTexture(text, opts = {}) {
  const { cap = 40, color = '#e8e0c8', bg = null, weight = 600, pad = 0.6 } = opts;
  const m = measureLabel(text, cap, { weight });
  const w = opts.w || Math.ceil(m.width + cap * pad * 2), h = opts.h || Math.ceil(m.height + cap * pad * 2);
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  drawLabel(ctx, text, w / 2, h / 2, cap, { color, weight, maxWidth: w - cap * 0.4 });
  const t = canvasTexture(c);
  t.userData = { w, h };
  return t;
}
