// Набор синтеза: всё, из чего собираются звуки каталога. Работает в любом BaseAudioContext — и в живом,
// и в OfflineAudioContext (предварительный просчёт буферов). Случайность — своя, с зерном: просчёт повторяем.
//
// Правило для test-intro и для утечек: каждый запущенный источник сразу получает stop(время) — «вечных» источников
// набор не создаёт. Все созданные узлы записываются в k.nodes, чтобы голос мог их разом отсоединить.

/** Генератор случайных чисел с зерном (mulberry32). */
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Белый шум, моно. Белый шум не имеет шва при зацикливании (отсчёты независимы). */
export function makeNoise(ctx, seconds, rate, seed) {
  const r = rng(seed || 7), len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(1, len, rate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
  return buf;
}

const curves = {};
/** Кривая насыщения tanh(x·drive), нормированная к 1. */
export function satCurve(drive) {
  const key = Math.round(drive * 10);
  if (curves[key]) return curves[key];
  const n = 1024, c = new Float32Array(n), norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) c[i] = Math.tanh((i / (n - 1) * 2 - 1) * drive) / norm;
  return (curves[key] = c);
}

// Собственные частоты (отношения к основной): стальной лист, брусок, колокол.
export const PLATE = [1, 1.58, 2.24, 2.92, 3.47, 4.26, 5.1, 6.2, 7.4, 8.9, 10.7, 12.3];
export const BAR = [1, 2.76, 5.4, 8.93, 13.34];
export const BELL = [0.5, 1, 1.19, 1.5, 2, 2.51, 3.01, 4.17, 5.43, 6.8];

export function makeKit(ctx, { seed = 1, lite = false, noise = null } = {}) {
  const rnd = rng(seed);
  const rv = (a, b) => a + rnd() * (b - a);
  const nodes = [];
  const reg = (n) => { nodes.push(n); return n; };
  const srcs = [];
  const k = { ctx, rnd, rv, lite, nodes, srcs, end: 0, lastSrc: null, PLATE, BAR, BELL };
  const noiseBuf = noise || makeNoise(ctx, 2, ctx.sampleRate, 7);
  const minF = 20, maxF = ctx.sampleRate * 0.45;
  const cf = (f) => Math.max(minF, Math.min(maxF, f));

  function started(src, t, stopAt) {
    src.start(t); src.stop(stopAt); srcs.push(src);
    if (stopAt > k.end) { k.end = stopAt; k.lastSrc = src; }
  }
  k.gain = (v, dest) => { const g = reg(ctx.createGain()); g.gain.value = v; if (dest) g.connect(dest); return g; };
  k.filter = (type, f, q, dest) => {
    const n = reg(ctx.createBiquadFilter()); n.type = type; n.frequency.value = cf(f); n.Q.value = q == null ? 0.7 : q;
    if (dest) n.connect(dest); return n;
  };
  /** Насыщение (вес, «грязь»): drive 1…6. Возвращает входной узел. */
  k.shaper = (drive, dest) => { const n = reg(ctx.createWaveShaper()); n.curve = satCurve(drive); if (dest) n.connect(dest); return n; };
  k.pan = (v, dest) => {
    if (!ctx.createStereoPanner) return dest;
    const n = reg(ctx.createStereoPanner()); n.pan.value = Math.max(-1, Math.min(1, v)); n.connect(dest); return n;
  };
  /** Огибающая «удар»: линейная атака a, экспоненциальный спад d. */
  k.env = (param, t, a, peak, d) => {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(Math.max(0.0001, peak), t + a);
    param.exponentialRampToValueAtTime(0.0001, t + a + d);
  };
  /** Огибающая «полка»: атака a, удержание h, спад r (линейно). */
  k.ahr = (param, t, a, h, r, peak) => {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.setValueAtTime(peak, t + a + h);
    param.linearRampToValueAtTime(0, t + a + h + r);
  };
  /**
   * Шум через фильтр. o: type, f, f2 (сдвиг частоты к концу), q, gain, attack, hold (полка вместо удара), rel, rate, dest.
   * Возвращает узел усиления (можно модулировать).
   */
  k.noise = (t, dur, o = {}) => {
    const src = reg(ctx.createBufferSource()); src.buffer = noiseBuf; src.loop = true;
    if (o.rate) src.playbackRate.value = o.rate;
    const fl = k.filter(o.type || 'bandpass', o.f || 1000, o.q == null ? 1 : o.q);
    fl.frequency.setValueAtTime(cf(o.f || 1000), t);
    if (o.f2) fl.frequency.exponentialRampToValueAtTime(cf(o.f2), t + dur);
    const g = k.gain(0, o.dest), a = o.attack == null ? 0.002 : o.attack, peak = o.gain == null ? 0.3 : o.gain;
    let stop;
    if (o.hold != null) { const r = o.rel == null ? 0.05 : o.rel; k.ahr(g.gain, t, a, o.hold, r, peak); stop = t + a + o.hold + r; }
    else { k.env(g.gain, t, a, peak, dur); stop = t + a + dur; }
    src.connect(fl); fl.connect(g);
    src.start(t, rnd() * 1.7); src.stop(stop + 0.02); srcs.push(src);
    if (stop + 0.02 > k.end) { k.end = stop + 0.02; k.lastSrc = src; }
    return g;
  };
  /** Тон со сдвигом высоты. o: type, f, f2, gain, attack, hold, rel, dest, lin (линейный сдвиг). Возвращает { osc, g }. */
  k.tone = (t, dur, o = {}) => {
    const osc = reg(ctx.createOscillator()); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f || 440, t);
    if (o.f2) { if (o.lin) osc.frequency.linearRampToValueAtTime(o.f2, t + dur); else osc.frequency.exponentialRampToValueAtTime(Math.max(8, o.f2), t + dur); }
    const g = k.gain(0, o.dest), a = o.attack == null ? 0.003 : o.attack, peak = o.gain == null ? 0.3 : o.gain;
    let stop;
    if (o.hold != null) { const r = o.rel == null ? 0.05 : o.rel; k.ahr(g.gain, t, a, o.hold, r, peak); stop = t + a + o.hold + r; }
    else { k.env(g.gain, t, a, peak, dur); stop = t + a + dur; }
    osc.connect(g);
    started(osc, t, stop + 0.02);
    return { osc, g };
  };
  /**
   * Модальный синтез: банк затухающих резонансов (лязг, звон брони, колокол).
   * o: f — основная частота, ratios — отношения мод, decay — затухание основной (с), damp — насколько быстрее гаснут
   * верхние моды (0…1.5), gain, tilt — спад амплитуд по номеру (0…1), jit — разброс частот, n — число мод, dest.
   */
  k.modal = (t, o = {}) => {
    const ratios = o.ratios || PLATE, n = Math.min(lite ? 4 : (o.n || ratios.length), ratios.length);
    const f0 = o.f || 300, decay = o.decay || 0.5, damp = o.damp == null ? 0.7 : o.damp, tilt = o.tilt == null ? 0.6 : o.tilt;
    const jit = o.jit == null ? 0.012 : o.jit, peak = o.gain == null ? 0.3 : o.gain;
    const bus = k.gain(1, o.dest);
    for (let i = 0; i < n; i++) {
      const f = f0 * ratios[i] * (1 + rv(-jit, jit));
      if (f > maxF) break;
      const d = Math.max(0.012, decay / Math.pow(ratios[i] / ratios[0], damp));
      k.tone(t, d, { f, gain: peak * Math.pow(1 / (i + 1), tilt) * rv(0.7, 1), attack: o.attack == null ? 0.0015 : o.attack, dest: bus });
    }
    return bus;
  };
  /** ЧМ-синтез (скрежет, искра, металл). o: fc, fc2, ratio, index, index2, gain, attack, hold, rel, type, dest. */
  k.fm = (t, dur, o = {}) => {
    const fc = o.fc || 200, fmod = fc * (o.ratio || 1.41);
    const car = k.tone(t, dur, { type: o.type || 'sine', f: fc, f2: o.fc2, gain: o.gain, attack: o.attack, hold: o.hold, rel: o.rel, dest: o.dest });
    const mod = reg(ctx.createOscillator()); mod.frequency.value = fmod;
    const mg = k.gain(0, car.osc.frequency), i1 = (o.index == null ? 3 : o.index) * fmod, i2 = (o.index2 == null ? 0 : o.index2) * fmod;
    mg.gain.setValueAtTime(i1, t); mg.gain.linearRampToValueAtTime(i2, t + dur);
    mod.connect(mg);
    started(mod, t, t + dur + (o.attack || 0.003) + (o.hold || 0) + (o.rel || 0) + 0.03);
    return car;
  };
  /**
   * Гребенчатый резонатор с обратной связью (цепи, дребезг незакреплённого железа). Возвращает входной узел.
   * f ≤ ~340 Гц: задержка в петле обратной связи не может быть короче одного блока (128 отсчётов).
   */
  k.comb = (dest, o = {}) => {
    const inp = k.gain(1), d = reg(ctx.createDelay(0.05)), fb = k.gain(o.fb == null ? 0.5 : o.fb), lp = k.filter('lowpass', o.damp || 4500, 0.5);
    d.delayTime.value = Math.max(130 / ctx.sampleRate, 1 / (o.f || 250));
    inp.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d);
    const wet = k.gain(o.wet == null ? 0.7 : o.wet, dest); d.connect(wet);
    inp.connect(dest);
    return inp;
  };
  /** Медленный генератор на параметр: с t0 по t1. */
  k.lfo = (param, freq, depth, t0, t1, type) => {
    const o = reg(ctx.createOscillator()); o.type = type || 'sine'; o.frequency.value = freq;
    const g = k.gain(depth, param); o.connect(g); started(o, t0, t1);
    return o;
  };
  /** Отсоединить всё созданное (вызывает голос, когда отзвучал). */
  /** Досрочно остановить все источники в момент at (музыка при выключении). */
  k.stopAll = (at) => { for (const s of srcs) { try { s.stop(at); } catch (e) { /* уже остановлен */ } } };
  k.dispose = () => { srcs.length = 0; for (const n of nodes) { try { n.disconnect(); } catch (e) { /* уже отсоединён */ } } nodes.length = 0; };

  // ----- составные элементы: из них собраны рецепты каталога -----
  /** Удар-«тело»: синус с падением высоты (вес выстрела, упора, разрыва). */
  k.thump = (t, o = {}) => k.tone(t, o.dur || 0.2, { f: o.f || 100, f2: o.f2 || (o.f || 100) * 0.45, gain: o.gain == null ? 0.6 : o.gain, attack: o.attack == null ? 0.003 : o.attack, dest: o.dest });
  /** Короткий щелчок: шум верхних частот. */
  k.click = (t, o = {}) => k.noise(t, o.dur || 0.008, { type: o.type || 'highpass', f: o.f || 3000, q: o.q == null ? 0.7 : o.q, gain: o.gain == null ? 0.3 : o.gain, attack: 0.0008, dest: o.dest });
  /** Дребезг: n щелчков со случайными промежутками и убывающей силой. o: n, gap [мин, макс], f [мин, макс], q, gain. */
  k.rattle = (t, o = {}) => {
    const n = lite ? Math.min(3, o.n || 6) : (o.n || 6), gap = o.gap || [0.05, 0.14], fr = o.f || [1800, 4500];
    let x = t;
    for (let i = 0; i < n; i++) {
      k.noise(x, o.len || 0.03, { type: 'bandpass', f: rv(fr[0], fr[1]), q: o.q || 6, gain: (o.gain || 0.1) * (1 - 0.7 * i / n) * rv(0.6, 1), attack: 0.001, dest: o.dest });
      x += rv(gap[0], gap[1]) * (o.slow ? 1 + i * o.slow : 1);
    }
    return x;
  };
  /** Осыпающиеся обломки: редкие звонкие удары, всё реже и тише. */
  k.debris = (t, o = {}) => {
    const n = lite ? 3 : (o.n || 10), span = o.span || 1.5, fr = o.f || [1200, 3200];
    for (let i = 0; i < n; i++) {
      const x = t + span * Math.pow((i + rnd()) / n, 1.5), g = (o.gain || 0.08) * (1 - 0.6 * i / n);
      k.modal(x, { ratios: BAR, n: 3, f: rv(fr[0], fr[1]), decay: rv(0.04, 0.1), gain: g, dest: o.dest });
      k.click(x, { f: 2500, gain: g * 0.8, dest: o.dest });
    }
  };
  /** «Медный» голос (фанфара, рожок): две пилы с расстройкой → фильтр, яркость следует за громкостью. */
  k.brass = (t, dur, o = {}) => {
    const f = o.f || 293.7, peak = o.gain == null ? 0.2 : o.gain, a = o.attack == null ? 0.05 : o.attack, r = o.rel == null ? 0.18 : o.rel;
    const g = k.gain(0, o.dest), fl = k.filter('lowpass', 500, 1.2, g), bright = o.bright || 4;
    k.ahr(g.gain, t, a, Math.max(0.01, dur - a), r, peak);
    fl.frequency.setValueAtTime(cf(f * 1.2), t);
    fl.frequency.linearRampToValueAtTime(cf(f * bright), t + a * 1.4);
    fl.frequency.setTargetAtTime(cf(f * bright * 0.6), t + a * 1.4, 0.25);
    fl.frequency.setTargetAtTime(cf(f * 1.2), t + dur, r * 0.5);
    const stop = t + dur + r + 0.03;
    for (const det of (lite ? [0] : [-5, 6])) {
      const osc = reg(ctx.createOscillator()); osc.type = 'sawtooth'; osc.frequency.value = f; osc.detune.value = det;
      osc.connect(fl); started(osc, t, stop);
      if (o.vib) k.lfo(osc.frequency, 5.2, f * o.vib, t + Math.min(0.3, dur * 0.4), stop);
    }
    return g;
  };
  return k;
}
