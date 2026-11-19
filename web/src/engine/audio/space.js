// Пространство: два импульсных отклика для свёрточной реверберации (считаются в коде, без файлов) и кривая
// выходного ограничителя.
//   «стальная комната» — короткий плотный металлический отклик башни (~0.85 с): ранние отражения от близких
//     стен, плотный хвост, поверх — слабый звон собственных частот брони;
//   «открытое море»    — длинный рассеянный хвост (~3.2 с): медленное нарастание, темнеет со временем, редкие
//     отзвуки от воды и берега. Для далёких разрывов и орудий.
import { rng } from './kit.js';

function fill(ctx, seconds, rate, seed, fn) {
  const len = Math.floor(seconds * rate), buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) fn(buf.getChannelData(ch), len, rng(seed + ch * 101), ch);
  return buf;
}

/** Стальная комната. pre — предзадержка (с): сухой сигнал шины эффектов запаздывает на компрессоре. */
export function steelRoomIR(ctx, rate, seconds = 0.85) {
  return fill(ctx, seconds, rate, 311, (d, len, r, ch) => {
    const pre = Math.floor(0.008 * rate), rt = seconds * 0.8;
    // плотный хвост: шум с экспоненциальным спадом; верх гаснет быстрее (однополюсный фильтр с падающей частотой среза)
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / rate, e = Math.pow(10, -3 * t / rt);
      const a = 0.18 + 0.72 * Math.exp(-t * 5);             // доля верхних частот
      lp += a * ((r() * 2 - 1) - lp);
      d[i] = lp * e * Math.min(1, t / 0.004);
    }
    // ранние отражения: стены в 1–4 м
    for (let n = 0; n < 14; n++) {
      const at = pre + Math.floor((0.003 + r() * 0.03) * rate), g = (r() > 0.5 ? 1 : -1) * (0.9 - n * 0.045) * (0.6 + 0.4 * r());
      if (at + 2 < len) { d[at] += g; d[at + 1] += g * 0.5; }
    }
    // звон брони: затухающие синусы на собственных частотах листа
    const modes = [173, 262, 391, 517, 664, 842, 1090, 1380, 1730, 2210, 2840];
    for (let m = 0; m < modes.length; m++) {
      const f = modes[m] * (1 + (ch ? 0.007 : -0.005)), ph = r() * 6.283, dec = rt * (0.9 - m * 0.05), g = 0.05 / (1 + m * 0.25);
      const w = 6.283185 * f / rate;
      for (let i = pre; i < len; i++) { const t = (i - pre) / rate; d[i] += g * Math.sin(w * (i - pre) + ph) * Math.pow(10, -3 * t / dec); }
    }
    const fade = Math.floor(0.03 * rate);
    for (let i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;
  });
}

/** Открытое море. */
export function openSeaIR(ctx, rate, seconds = 3.2) {
  return fill(ctx, seconds, rate, 977, (d, len, r, ch) => {
    const pre = Math.floor(0.03 * rate), rt = seconds * 0.85;
    let lp = 0, lp2 = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / rate, e = Math.pow(10, -3 * t / rt) * (1 - Math.exp(-t / 0.09));
      const a = 0.05 + 0.3 * Math.exp(-t * 1.4);            // чем дальше хвост, тем темнее
      lp += a * ((r() * 2 - 1) - lp); lp2 += a * (lp - lp2);
      d[i] = lp2 * e * 3;
    }
    // отзвуки от воды и скал: размытые группы
    for (let n = 0; n < 5; n++) {
      const at = pre + Math.floor((0.22 + r() * 0.9 + (ch ? 0.013 : 0)) * rate), w = Math.floor((0.02 + r() * 0.03) * rate), g = 0.5 - n * 0.07;
      let s = 0;
      for (let i = 0; i < w && at + i < len; i++) { s += 0.2 * ((r() * 2 - 1) - s); d[at + i] += s * g * Math.sin(Math.PI * i / w); }
    }
    const fade = Math.floor(0.2 * rate);
    for (let i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;
  });
}

/**
 * Кривая выходного ограничителя (WaveShaper после компрессора-лимитера). Вход узла — уровень/2, так что кривая
 * покрывает уровни до ±2. До knee сигнал не меняется, выше — плавно прижимается к потолку ceil (< −1 дБ).
 */
export function clipCurve(knee = 0.6, ceil = 0.8) {
  const n = 4097, c = new Float32Array(n), span = ceil - knee;
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1) * 2 - 1) * 2, a = Math.abs(u);
    c[i] = Math.sign(u) * (a <= knee ? a : knee + span * Math.tanh((a - knee) / span));
  }
  return c;
}
