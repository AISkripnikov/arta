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
  // таблицы по столбцам: индексы решётки и вес — один раз на вызов
  const X0 = new Int32Array(size), X1 = new Int32Array(size), SX = new Float32Array(size);
  for (let x = 0; x < size; x++) {
    const fx = x / size * cx, ix = Math.floor(fx), tx = fx - ix;
    X0[x] = ix % cx; X1[x] = (ix + 1) % cx; SX[x] = tx * tx * (3 - 2 * tx);
  }
  for (let y = 0; y < size; y++) {
    const fy = y / size * cy, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
    const y0 = (iy % cy) * cx, y1 = ((iy + 1) % cy) * cx, row = y * size;
    for (let x = 0; x < size; x++) {
      const x0 = X0[x], x1 = X1[x], sx = SX[x];
      const p = lat[y0 + x0], q = lat[y1 + x0];
      const a = p + (lat[y0 + x1] - p) * sx;
      const b = q + (lat[y1 + x1] - q) * sx;
      out[row + x] = a + (b - a) * sy;
    }
  }
  return out;
}

/** Билинейное увеличение периодического поля r×r до size×size (с заворотом). */
export function upsampleField(src, r, size) {
  if (r === size) return src;
  const out = new Float32Array(size * size), k = r / size;
  const X0 = new Int32Array(size), X1 = new Int32Array(size), WX = new Float32Array(size);
  for (let x = 0; x < size; x++) {
    const f = (x + 0.5) * k - 0.5, i = Math.floor(f);
    X0[x] = (i + r) % r; X1[x] = (i + 1 + r) % r; WX[x] = f - i;
  }
  for (let y = 0; y < size; y++) {
    const f = (y + 0.5) * k - 0.5, j = Math.floor(f), wy = f - j;
    const r0 = ((j + r) % r) * r, r1 = ((j + 1 + r) % r) * r, row = y * size;
    for (let x = 0; x < size; x++) {
      const x0 = X0[x], x1 = X1[x], wx = WX[x];
      const a = src[r0 + x0] + (src[r0 + x1] - src[r0 + x0]) * wx;
      const b = src[r1 + x0] + (src[r1 + x1] - src[r1 + x0]) * wx;
      out[row + x] = a + (b - a) * wy;
    }
  }
  return out;
}

/**
 * Быстрый фрактальный шум: октавы считаются в разрешении «4 пикселя на клетку самой мелкой решётки» (не больше size),
 * затем поле одним проходом увеличивается до size. Для крупного шума на больших текстурах в разы быстрее fbm().
 */
export function fbmFast(size, cx, cy, octaves, rnd) {
  const lastL = Math.max(cx, cy) << (octaves - 1);
  let r = 16;
  while (r < lastL * 4 && r < size) r <<= 1;
  r = Math.min(r, size);
  return upsampleField(fbm(r, cx, cy, octaves, rnd), r, size);
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

/**
 * THREE.DataTexture RGBA8 из Uint8Array size×size (без премультипликации — альфа годится под данные).
 * opts: { srgb=false, repeat=true, aniso=4, mipmaps=true }. Строка 0 массива — v = 0 (низ).
 */
export function dataTexture(data, size, opts = {}) {
  const { srgb = false, repeat = true, aniso = 4, mipmaps = true } = opts;
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = Math.min(aniso, maxAniso);
  t.generateMipmaps = mipmaps;
  t.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/** Заменить данные DataTexture (размер может измениться: старая GL-текстура освобождается). */
export function replaceData(t, data, size) {
  if (t.image && t.image.width !== size) t.dispose();
  t.image = { data, width: size, height: size };
  t.needsUpdate = true;
  return t;
}

/** Память текстуры на GPU, байт (RGBA8, с мип-уровнями ≈ ×4/3). */
export function textureBytes(t) {
  const img = t && t.image;
  if (!img) return 0;
  const w = img.width || 0, h = img.height || 0;
  return Math.round(w * h * 4 * (t.generateMipmaps ? 4 / 3 : 1));
}

/**
 * Карта нормалей (RGBA8, линейная) из карты высот size×size с заворотом по краям, в out (Uint8Array) со смещением 0.
 * Строка 0 — v = 0 (DataTexture без flipY): зелёный канал — наклон вдоль +v (соглашение OpenGL, как ждёт three).
 */
export function normalDataFromHeight(height, size, strength = 2, out = new Uint8Array(size * size * 4)) {
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size, yp = ((y + 1) % size) * size, yc = y * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size, xp = (x + 1) % size;
      const dx = (height[yc + xp] - height[yc + xm]) * strength;
      const dy = (height[yp + x] - height[ym + x]) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (yc + x) * 4;
      out[i] = (0.5 - 0.5 * dx * inv) * 255;
      out[i + 1] = (0.5 - 0.5 * dy * inv) * 255;
      out[i + 2] = (0.5 + 0.5 * inv) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Штрих в поле Float32 size×size с заворотом: значение v (max с тем, что было), толщина ~1–2 px. */
export function strokeField(field, size, x0, y0, x1, y1, v, width = 1) {
  const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(len * 1.5));
  const w = Math.max(0, Math.round(width - 1));
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t);
    for (let oy = -w; oy <= w; oy++) for (let ox = -w; ox <= w; ox++) {
      const k = (((y + oy) % size + size) % size) * size + (((x + ox) % size + size) % size);
      const vv = (ox || oy) ? v * 0.6 : v;
      if (field[k] < vv) field[k] = vv;
    }
  }
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
