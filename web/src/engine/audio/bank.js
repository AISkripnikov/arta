// Банк заранее просчитанных звуков: каждый рецепт каталога один раз играется в OfflineAudioContext и остаётся
// моно-буфером. Проигрывание такого звука — один источник и один-два узла: дёшево и без заиканий на телефоне.
// Просчёт идёт в фоне по одному звуку с паузами (сам рендер браузер выполняет в своём потоке); пока буфера нет,
// audio.js играет тот же рецепт вживую в облегчённом виде. Запрошенный, но ещё не готовый звук идёт вне очереди.
import { makeKit, rng } from './kit.js';
import { CAT } from './catalogue.js';
import { openSeaIR } from './space.js';

const PEAK = 0.98;
// срез верхов по пространству (Гц), если у рецепта нет своего lp
const LP = { in: 5500, big: 5500, out: 2400, ui: 8000, dry: 7000, intro: 5000 };

const irs = {};
function seaIR(oc, r) { return irs[r] || (irs[r] = openSeaIR(oc, r, 2.5)); }

function finish(ctx, rendered, rec, rate) {
  const src = rendered.getChannelData(0);
  let len = src.length, out;
  if (rec.loop) {
    // бесшовная петля: хвост за пределами длины петли складывается с её началом
    len = Math.round(rec.loop * rate); out = new Float32Array(len);
    for (let i = 0; i < src.length; i++) out[i % len] += src[i];
  } else {
    // обрезать тишину в конце (−72 дБ) и сгладить срез
    let last = len - 1;
    while (last > 0 && Math.abs(src[last]) < 0.00025) last--;
    len = Math.min(len, last + 1 + Math.floor(0.004 * rate));
    out = src.subarray(0, len);
    const fade = Math.min(len, Math.floor(0.004 * rate));
    for (let i = 0; i < fade; i++) out[len - 1 - i] *= i / fade;
  }
  let peak = 0;
  for (let i = 0; i < len; i++) { const a = Math.abs(out[i]); if (a > peak) peak = a; }
  const k = peak > 1e-6 ? PEAK / peak : 0;
  const buf = ctx.createBuffer(1, len, rate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = out[i] * k;
  return buf;
}

/**
 * @param ctx   любой контекст (нужен для createBuffer и частоты дискретизации)
 * @param noise общий буфер белого шума
 * @param o     { onReady(name) — буфер появился; idle — пауза между просчётами, мс }
 */
export function createBank(ctx, noise, o = {}) {
  const rate = ctx.sampleRate, OAC = (typeof window !== 'undefined') && (window.OfflineAudioContext || window.webkitOfflineAudioContext);
  const store = {};                       // name → [AudioBuffer…]
  const queue = [];                       // { name, v }
  let busy = false, timer = 0, bytes = 0, dead = !OAC, started = false, waiters = [];
  const names = Object.keys(CAT).sort((a, b) => (CAT[a].pr == null ? 5 : CAT[a].pr) - (CAT[b].pr == null ? 5 : CAT[b].pr));
  for (const name of names) for (let v = 0; v < (CAT[name].v || 1); v++) queue.push({ name, v });
  const total = queue.length;

  function store1(name, buf) {
    (store[name] || (store[name] = [])).push(buf);
    bytes += buf.length * 4;
    if (o.onReady) { try { o.onReady(name); } catch (e) { /* тихо */ } }
  }
  function renderOne(job) {
    const rec = CAT[job.name];
    // далёкие звуки (над морем) темнее и с долгим хвостом: хватает 8 кГц; хвост «открытого моря» запекается сюда же
    const far = rec.sp === 'out' && !rec.pcm && rec.bus !== 'music', tail = rec.tail != null ? rec.tail : far ? 0.6 : 0;
    const r = Math.max(8000, Math.min(rate, Math.round(rate * Math.min(rec.sr || 1, far ? 1 / 6 : 1))));
    let seed = 1000 + job.v * 7919;
    for (let i = 0; i < job.name.length; i++) seed = (seed * 31 + job.name.charCodeAt(i)) | 0;
    if (rec.pcm) {                        // петля фона, просчитанная прямо в JS (beds.js): уже бесшовная
      const d = rec.pcm(r, rng(seed >>> 0), job.v);
      let peak = 0; for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
      let mean = 0; for (let i = 0; i < d.length; i++) mean += d[i]; mean /= d.length;
      const k = peak > 1e-6 ? PEAK / (peak + Math.abs(mean)) : 0, buf = ctx.createBuffer(1, d.length, r), out = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) out[i] = (d[i] - mean) * k;
      store1(job.name, buf);
      return Promise.resolve();
    }
    const oc = new OAC(1, Math.ceil((rec.d + (tail ? 2.6 : 0) + 0.06) * r), r);
    const kit = makeKit(oc, { seed, noise });
    // общий срез верхов: сталь башни глушит верх (нет ничего выше ~5.5 кГц, кроме коротких щелчков органов управления)
    const lpf = rec.lp === 0 ? 0 : Math.min(r * 0.4, rec.lp || LP[rec.sp || 'in'] || 5500);
    let dest = oc.destination;
    if (tail) {                          // хвост: свёртка просчитывается здесь, один раз — в игре свёртки «моря» нет
      const cv = oc.createConvolver(), wet = oc.createGain(), dry = oc.createGain(), inp = oc.createGain();
      cv.normalize = true; cv.buffer = seaIR(oc, r); wet.gain.value = tail; dry.gain.value = 1;
      inp.connect(dry); inp.connect(cv); cv.connect(wet); dry.connect(dest); wet.connect(dest); dest = inp;
    }
    if (lpf) { const a = oc.createBiquadFilter(), b = oc.createBiquadFilter(); a.type = b.type = 'lowpass'; a.frequency.value = b.frequency.value = lpf; a.Q.value = 0.6; b.Q.value = 0.55; a.connect(b); b.connect(dest); dest = a; }
    rec.fn(kit, 0.002, dest, job.v);
    const done = (rendered) => {
      kit.dispose();
      if (dead) return;
      store1(job.name, finish(ctx, rendered, rec, r));
    };
    const p = oc.startRendering();
    if (p && p.then) return p.then(done);
    return new Promise((res) => { oc.oncomplete = (e) => { done(e.renderedBuffer); res(); }; });   // старый WebKit
  }
  function pump() {
    timer = 0;
    if (busy || dead) return;
    const job = queue.shift();
    if (!job) { const w = waiters; waiters = []; w.forEach((f) => f()); return; }
    busy = true;
    let p;
    try { p = renderOne(job); } catch (e) { p = Promise.resolve(); }
    p.catch(() => { /* не вышло — этот звук останется живым */ }).then(() => { busy = false; schedule(); });
  }
  function schedule() {
    if (dead || timer || busy) return;
    if (o.idle === 0) pump(); else timer = setTimeout(pump, o.idle == null ? 40 : o.idle);
  }

  return {
    rate,
    /** Начать фоновый просчёт (после первого касания). */
    start() { if (!started) { started = true; schedule(); } },
    /** Буфер звука (случайный вариант по числу r 0…1) или null, если ещё не готов; тогда звук идёт вне очереди. */
    get(name, r) {
      const list = store[name];
      if (list && list.length) return list[Math.floor((r == null ? Math.random() : r) * list.length) % list.length];
      if (!dead && started) {
        const i = queue.findIndex((j) => j.name === name);
        if (i > 0) { const mine = queue.filter((j) => j.name === name); for (let n = queue.length - 1; n >= 0; n--) if (queue[n].name === name) queue.splice(n, 1); queue.unshift(...mine); }
      }
      return null;
    },
    variants(name) { return store[name] || []; },
    /** Обещание: весь каталог просчитан. */
    all() { return new Promise((res) => { if (dead || (!queue.length && !busy)) res(); else { waiters.push(res); this.start(); } }); },
    get bytes() { return bytes; },
    get pending() { return queue.length + (busy ? 1 : 0); },
    get total() { return total; },
    dispose() { dead = true; clearTimeout(timer); queue.length = 0; },
  };
}
