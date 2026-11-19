// Петли фона, просчитанные прямо в JS (без OfflineAudioContext): тёмный шум (розовый/коричневый через пологие НЧ-фильтры),
// медленное движение, тональный гул на сетке 12.5 Гц (50/75/100/150 Гц — никакие два слоя не дают медленных биений).
// Каждая петля — моно-буфер L секунд при низкой частоте дискретизации (8–12 кГц: выше 4–6 кГц в них просто ничего нет).
// Шум сшивается равномощным перекрёстным затуханием (конец петли переходит в её же начало без шва и провала), тоны и
// медленные модуляторы кратны 1/L — периодичны в петле сами.
//
// Петли по 10 с.
//   roomBed     вентиляция (коричневый шум ≤ 300 Гц, медленное дыхание) · гул сети 50/100/150 · море сквозь броню (≤ 160 Гц, накаты)
//   machineBed  пост заряжания: гул агрегатов 25 Гц с гармониками до 200 Гц · мягкое «пыхтение» компрессора (НЧ-шум, 0.5 Гц)
//   airBed      открытый воздух: ветер (розовый шум в плавающей полосе 250–700 Гц) · прибой (≤ 500 Гц, накаты 0.083 Гц)
//   stormBed    шторм: сильнее ветер, ниже прибой, порывы; капли по броне (модальные «тики» 700–2200 Гц)
//   tensionBed  напряжение боя: далёкий гул (≤ 110 Гц) с медленным пульсом 0.5 Гц · тон 75 Гц
//   etherBed    открытый канал радио: очень тихий тёмный шорох 300–1800 Гц (не «шипение»)
//   windBed     ролик: ветер с моря и прибой
import { rng } from './kit.js';

const TAU = Math.PI * 2;

/** Одно-полюсный НЧ-фильтр «на месте». */
function lp1(d, rate, f) {
  const a = 1 - Math.exp(-TAU * f / rate); let y = 0;
  for (let i = 0; i < d.length; i++) { y += a * (d[i] - y); d[i] = y; }
  return d;
}
/** Двухполюсный НЧ (RBJ, Q 0.707) «на месте», n раз подряд. */
function lp2(d, rate, f, n = 1, q = 0.707) {
  const w = TAU * f / rate, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al;
  const b0 = (1 - c) / 2 / a0, b1 = (1 - c) / a0, b2 = b0, a1 = -2 * c / a0, a2 = (1 - al) / a0;
  for (let k = 0; k < n; k++) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < d.length; i++) { const x = d[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y; }
  }
  return d;
}
/** Двухполюсный ВЧ (RBJ) «на месте». */
function hp2(d, rate, f, q = 0.707) {
  const w = TAU * f / rate, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al;
  const b0 = (1 + c) / 2 / a0, b1 = -(1 + c) / a0, b2 = b0, a1 = -2 * c / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < d.length; i++) { const x = d[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y; }
  return d;
}
/** Розовый шум (Пол Келлет, упрощённый). */
function pink(n, r) {
  const d = new Float32Array(n); let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) { const w = r() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
  return d;
}
/** Коричневый шум (интеграл белого с утечкой). */
function brown(n, r) {
  const d = new Float32Array(n); let y = 0;
  for (let i = 0; i < n; i++) { y = 0.996 * y + (r() * 2 - 1) * 0.06; d[i] = y; }
  return d;
}
/** Нормировать к СКЗ 1 (уровни слоёв внутри петли задаются явно). */
function unit(d) {
  let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
  const k = s > 0 ? 1 / Math.sqrt(s / d.length) : 0;
  for (let i = 0; i < d.length; i++) d[i] *= k;
  return d;
}
/** Сшить шум длиной len + X в бесшовную петлю len (равномощное перекрёстное затухание на первых X отсчётах). */
function seam(d, len, X) {
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = d[i];
  for (let i = 0; i < X; i++) { const a = (Math.PI / 2) * (i / X); out[i] = d[i] * Math.sin(a) + d[i + len] * Math.cos(a); }
  return out;
}
/** Шум для петли: gen(n) → массив n отсчётов (уже отфильтрованный), сшитый в петлю len. Разгон фильтров отрезается. */
function noiseLoop(len, rate, gen) {
  const X = Math.floor(rate * 1.5), pre = Math.floor(rate * 1);
  const d = gen(len + X + pre);
  return unit(seam(d.subarray(pre), len, X));
}
/** Медленная модуляция 0…1, периодичная в петле: k циклов на петлю. */
const slow = (i, len, k, ph = 0) => 0.5 - 0.5 * Math.cos(TAU * k * i / len + ph);

/** Тон, периодичный в петле (частота округлена до кратной 1/L). */
function addTone(out, rate, f, amp, ph = 0) {
  const L = out.length / rate, ff = Math.round(f * L) / L, w = TAU * ff / rate;
  for (let i = 0; i < out.length; i++) out[i] += amp * Math.sin(w * i + ph);
}

export const BEDS = {
  roomBed(rate, r) {
    const len = Math.round(10 * rate);
    const vent = noiseLoop(len, rate, (n) => lp2(hp2(brown(n, r), rate, 30), rate, 260, 2));
    const sea = noiseLoop(len, rate, (n) => lp2(hp2(brown(n, r), rate, 40), rate, 150, 2));
    const duct = noiseLoop(len, rate, (n) => lp2(hp2(pink(n, r), rate, 280), rate, 750, 2));    // воздух в коробах: мягко, слышно и в телефоне
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const breathe = 0.85 + 0.15 * slow(i, len, 3), swell = 0.45 + 0.55 * slow(i, len, 2, 1.3);
      out[i] = vent[i] * 0.5 * breathe + sea[i] * 0.42 * swell + duct[i] * 0.24 * breathe;
    }
    addTone(out, rate, 50, 0.1); addTone(out, rate, 100, 0.07, 1); addTone(out, rate, 150, 0.025, 2); addTone(out, rate, 200, 0.02, 3); addTone(out, rate, 300, 0.012, 4);
    return out;
  },
  machineBed(rate, r) {
    const len = Math.round(10 * rate);
    const chug = noiseLoop(len, rate, (n) => lp2(hp2(brown(n, r), rate, 30), rate, 220, 2));
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) { const p = Math.pow(slow(i, len, 6), 2); out[i] = chug[i] * (0.15 + 0.45 * p); }      // 0.5 Гц
    [[25, 0.3], [50, 0.22], [75, 0.12], [100, 0.08], [125, 0.04], [150, 0.03], [200, 0.02], [250, 0.015], [300, 0.015], [350, 0.01]].forEach(([f, a], k) => addTone(out, rate, f, a, k * 0.7));
    return out;
  },
  airBed(rate, r) { return air(rate, r, false); },
  stormBed(rate, r) { return air(rate, r, true); },
  tensionBed(rate, r) {
    const len = Math.round(10 * rate);
    const rum = noiseLoop(len, rate, (n) => lp2(hp2(brown(n, r), rate, 30), rate, 110, 2));
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) { const pulse = Math.pow(slow(i, len, 6), 3); out[i] = rum[i] * (0.35 + 0.65 * pulse); }
    const tone = new Float32Array(len); addTone(tone, rate, 75, 0.35); addTone(tone, rate, 150, 0.08, 1); addTone(tone, rate, 225, 0.05, 2); addTone(tone, rate, 375, 0.025, 3);
    for (let i = 0; i < len; i++) out[i] += tone[i] * (0.5 + 0.5 * slow(i, len, 3));
    return out;
  },
  etherBed(rate, r) {
    const len = Math.round(6 * rate);
    const n0 = noiseLoop(len, rate, (n) => lp2(hp2(pink(n, r), rate, 300), rate, 1500, 2));
    for (let i = 0; i < len; i++) n0[i] *= 0.8 + 0.2 * slow(i, len, 2);
    return n0;
  },
  windBed(rate, r) { return air(rate, r, false, 1.4); },
};

function air(rate, r, storm, surfK = 1) {
  const len = Math.round(10 * rate);
  const lo = noiseLoop(len, rate, (n) => lp2(hp2(pink(n, r), rate, 220), rate, 520, 2));        // ровная полоса ветра
  const hi = noiseLoop(len, rate, (n) => lp2(hp2(pink(n, r), rate, 500), rate, storm ? 1300 : 900, 2));   // порывы: чуть выше
  const surf = noiseLoop(len, rate, (n) => lp2(hp2(brown(n, r), rate, 30), rate, storm ? 420 : 320, 2));
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const g1 = slow(i, len, 1), g2 = slow(i, len, 3, 0.8), gust = Math.pow(slow(i, len, storm ? 5 : 2, 2.1), 2);
    const wave = Math.pow(slow(i, len, 1, 0.4), 1.5);
    out[i] = lo[i] * (0.35 + 0.25 * g1 + 0.15 * g2) + hi[i] * (storm ? 0.35 : 0.12) * gust + surf[i] * (storm ? 0.55 : 0.35) * surfK * (0.3 + 0.7 * wave);
  }
  if (storm) {                                                    // капли по броне: короткие затухающие синусы
    const n = 260;
    for (let k = 0; k < n; k++) {
      const at = Math.floor(r() * len), f = 700 + r() * 1500, a = 0.08 + r() * 0.18, dec = 0.012 + r() * 0.02, m = Math.floor(dec * 5 * rate), w = TAU * f / rate;
      for (let j = 0; j < m; j++) out[(at + j) % len] += a * Math.sin(w * j) * Math.exp(-j / (dec * rate)) * Math.min(1, j / (0.002 * rate));
    }
  }
  return out;
}
