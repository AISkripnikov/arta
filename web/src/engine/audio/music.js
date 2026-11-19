// Музыка меню (шина music): редкая, медленная, тёмная. Строится на ходу — файла или готового буфера нет, поэтому
// минута музыки не стоит памяти. Круг 64 с: четыре аккорда по 16 с (ре минор — си-бемоль — соль минор — ля без терции).
//   подклад  — «струнные»: по две расстроенные пилы на ноту через НЧ-фильтр, атака 3 с, уход 4.5 с; уход аккорда
//              перекрывается атакой следующего, в том числе на стыке круга, поэтому шва нет;
//   литавры  — далёкие редкие удары на тонике аккорда;
//   рожок    — простой минорный мотив из четырёх нот приглушённым «медным» голосом (k.brass), по фразе на аккорд.
// События ставятся по времени звука небольшими порциями вперёд (таймер раз в 0.4 с), так что пауза страницы или
// сворачивание ничего не ломают. При начале боя музыка уходит (см. audio.js: фон башни глушит музыку).
import { timpani } from './catalogue.js';

const LOOP = 64;
const CHORDS = [
  [0, [73.42, 110, 174.61, 220]],          // Dm
  [16, [58.27, 87.31, 146.83, 233.08]],    // B♭
  [32, [49, 98, 146.83, 196]],             // Gm
  [48, [55, 82.41, 110, 164.81]],          // A (без терции)
];
const DRUMS = [[0, 73.42, 0.5], [15, 73.42, 0.25], [15.5, 73.42, 0.35], [16, 58.27, 0.5], [32, 49, 0.5], [40, 49, 0.25], [47.5, 55, 0.3], [48, 55, 0.5], [60, 55, 0.3], [62, 55, 0.4]];
const HORN = [
  [6, 220, 2], [8.2, 293.66, 2.4], [10.8, 261.63, 1.2], [12.1, 220, 3],
  [22, 174.61, 2], [24.2, 233.08, 2.4], [26.8, 220, 1.2], [28.1, 174.61, 3],
  [38, 196, 2], [40.2, 233.08, 2.4], [42.8, 220, 1.2], [44.1, 196, 3],
  [52, 164.81, 2.4], [54.6, 220, 2.6], [57.6, 329.63, 4],
];

export function createMusic(core) {
  let out = null, origin = 0, upto = 0, timer = 0, playing = false, live = [];

  function chord(k, t, notes) {
    const ctx = core.ctx, dur = 16, g = k.gain(0, out), lp = k.filter('lowpass', 380, 0.8, g);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.055, t + 3); g.gain.setValueAtTime(0.055, t + dur - 0.5); g.gain.linearRampToValueAtTime(0, t + dur + 4);
    lp.frequency.setValueAtTime(330, t); lp.frequency.linearRampToValueAtTime(620, t + 8); lp.frequency.linearRampToValueAtTime(330, t + dur + 4);
    notes.forEach((f, i) => {
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det + i * 1.5;
        const og = k.gain(i === 0 ? 0.5 : 0.36, lp); o.connect(og); k.nodes.push(o); k.srcs.push(o);
        o.start(t); o.stop(t + dur + 4.05);
      }
    });
    k.end = Math.max(k.end, t + dur + 4.05);
  }

  /** Поставить все события со временем начала в [from, to). */
  function schedule(from, to) {
    for (let n = Math.max(0, Math.floor((from - origin) / LOOP)); origin + n * LOOP < to; n++) {
      const base = origin + n * LOOP;
      const put = (at, fn) => {
        const t = base + at;
        if (t < from || t >= to) return;
        const k = core.kit(n * 131 + Math.round(at * 10));
        fn(k, t);
        k.bin = core.trash(k.nodes, k.end + 0.1); live.push(k);
      };
      for (const [at, notes] of CHORDS) put(at, (k, t) => chord(k, t, notes));
      for (const [at, f, g] of DRUMS) put(at, (k, t) => timpani(k, t, out, f, g * 0.16));
      for (const [at, f, d] of HORN) put(at, (k, t) => k.brass(t, d, { f, gain: 0.03, attack: 0.16, rel: 0.5, bright: 2.4, vib: 0.003, dest: out }));
    }
  }
  function tick() {
    const ctx = core.ctx; if (!playing || !ctx) return;
    const now = ctx.currentTime;
    live = live.filter((k) => k.end > now);
    if (core.audible()) { const to = now + 1.6; if (to > upto) { schedule(upto, to); upto = to; } }
  }

  return {
    get playing() { return playing; },
    start() {
      const ctx = core.ctx; if (playing || !ctx) return;
      const t = ctx.currentTime;
      playing = true;
      out = ctx.createGain(); out.gain.value = 0; out.connect(core.input('music', 'out'));
      origin = upto = t + 0.05; live = [];
      if (core.offline) { out.gain.value = 1; schedule(origin, origin + core.offline); return; }
      out.gain.setTargetAtTime(1, t, 0.6);
      tick(); timer = setInterval(tick, 400);
    },
    stop(fade) {
      const ctx = core.ctx; if (!playing || !ctx) return;
      const t = ctx.currentTime, tc = fade == null ? 0.5 : Math.max(0.02, fade);
      playing = false; clearInterval(timer); timer = 0;
      out.gain.setTargetAtTime(0, t, tc);
      for (const k of live) { k.stopAll(t + tc * 5); k.bin.end = Math.min(k.bin.end, t + tc * 5 + 0.1); }
      core.trash([out], t + tc * 5 + 0.2);
      live = []; out = null;
    },
    reset() { clearInterval(timer); timer = 0; playing = false; live = []; out = null; },
  };
}
