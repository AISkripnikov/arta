// engine.audio — синтезированный звук (WebAudio, без файлов). DESIGN §5.4.
// Контекст создаётся лениво при первом касании (unlock()). Ни одна функция не бросает исключений:
// если звук недоступен — все вызовы тихо ничего не делают.

export function createAudio() {
  let ctx = null, master = null, comp = null, noiseBuf = null;
  let failed = false, muted = false, volume = 0.8;
  const last = {};                       // ограничение частоты однотипных щелчков
  let servoNode = null, alarmNode = null, ambientNode = null;
  let wantAmbient = false, wantAlarm = false;

  function ensure() {
    if (ctx || failed) return !!ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { failed = true; return false; }
      ctx = new AC({ latencyHint: 'interactive' });
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 18; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.2;
      master = ctx.createGain();
      master.gain.value = muted ? 0 : volume;
      master.connect(comp); comp.connect(ctx.destination);
      const len = Math.floor(ctx.sampleRate * 2);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      if (wantAmbient) api.ambient(true);
      if (wantAlarm) api.alarm(true);
      return true;
    } catch (e) { failed = true; ctx = null; return false; }
  }

  // безопасная обёртка: звук не должен ломать игру
  const safe = (fn) => function () {
    try { if (!ctx) return; if (ctx.state === 'suspended') ctx.resume(); return fn.apply(null, arguments); } catch (e) { /* тихо */ }
  };
  const limited = (name, minGap) => { const t = ctx.currentTime; if (t - (last[name] || -1) < minGap) return false; last[name] = t; return true; };

  // ----- примитивы -----
  function env(g, t, a, peak, d) {      // атака a, экспоненциальный спад d
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function noise(t, dur, { type = 'bandpass', f = 1000, f2 = null, q = 1, gain = 0.3, attack = 0.002, dest = master } = {}) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.setValueAtTime(f, t); flt.Q.value = q;
    if (f2) flt.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    const g = ctx.createGain(); env(g, t, attack, gain, dur);
    src.connect(flt); flt.connect(g); g.connect(dest);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + attack + 0.05);
  }
  function tone(t, dur, { type = 'sine', f = 440, f2 = null, gain = 0.3, attack = 0.003, dest = master } = {}) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(10, f2), t + dur);
    const g = ctx.createGain(); env(g, t, attack, gain, dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + attack + 0.05);
  }
  const now = () => ctx.currentTime + 0.005;
  const rv = (a, b) => a + Math.random() * (b - a);

  function fadeNode(node, to, time) {
    const t = ctx.currentTime;
    node.gain.cancelScheduledValues(t);
    node.gain.setTargetAtTime(to, t, time);
  }

  const api = {
    /** Создать/разбудить AudioContext. Вызывается движком при первом касании. */
    unlock() { try { if (ensure() && ctx.state === 'suspended') ctx.resume(); } catch (e) { /* тихо */ } },
    get ready() { return !!ctx; },
    get muted() { return muted; },
    setMuted(b) { muted = !!b; try { if (ctx) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.03); } catch (e) { /* тихо */ } },
    setVolume(v) { volume = Math.max(0, Math.min(1, v)); try { if (ctx && !muted) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.03); } catch (e) { /* тихо */ } },

    /** Лёгкий щелчок (деление счётчика, кнопка, фиксатор). */
    tick: safe(() => {
      if (!limited('tick', 0.028)) return;
      const t = now();
      noise(t, 0.012, { type: 'highpass', f: 3500, gain: 0.16, attack: 0.001 });
      tone(t, 0.02, { type: 'triangle', f: rv(2100, 2500), gain: 0.05, attack: 0.001 });
    }),
    /** Трещотка маховика. */
    ratchet: safe(() => {
      if (!limited('ratchet', 0.035)) return;
      const t = now();
      noise(t, 0.018, { type: 'bandpass', f: rv(1500, 2100), q: 2.5, gain: 0.32, attack: 0.001 });
      tone(t, 0.03, { type: 'square', f: rv(300, 380), gain: 0.03, attack: 0.001 });
    }),
    /** Глухой удар механизма (фиксация, упор). */
    clunk: safe(() => {
      if (!limited('clunk', 0.05)) return;
      const t = now();
      tone(t, 0.14, { f: 120, f2: 52, gain: 0.5 });
      noise(t, 0.05, { type: 'lowpass', f: 900, gain: 0.3 });
      noise(t, 0.015, { type: 'highpass', f: 2500, gain: 0.1 });
    }),
    /** Ход рычага: скольжение и упор. */
    leverPull: safe(() => {
      const t = now();
      noise(t, 0.16, { type: 'bandpass', f: 900, f2: 300, q: 1.2, gain: 0.18, attack: 0.02 });
      tone(t + 0.13, 0.16, { f: 105, f2: 48, gain: 0.55 });
      noise(t + 0.13, 0.05, { type: 'lowpass', f: 1200, gain: 0.32 });
      tone(t + 0.14, 0.25, { type: 'triangle', f: 620, gain: 0.03 });
    }),
    /** Тумблер. */
    switchFlip: safe(() => {
      if (!limited('switch', 0.04)) return;
      const t = now();
      noise(t, 0.01, { type: 'highpass', f: 2800, gain: 0.3, attack: 0.001 });
      noise(t + 0.022, 0.014, { type: 'bandpass', f: 1700, q: 2, gain: 0.26, attack: 0.001 });
      tone(t + 0.022, 0.03, { f: 190, gain: 0.12 });
    }),
    /** Зуммер отказа. */
    buzz: safe(() => {
      if (!limited('buzz', 0.25)) return;
      const t = now();
      tone(t, 0.3, { type: 'sawtooth', f: 112, gain: 0.16, attack: 0.01 });
      tone(t, 0.3, { type: 'square', f: 168, gain: 0.07, attack: 0.01 });
    }),
    /** Гул привода; level 0..1, вызывать каждый кадр или при изменении. 0 — затихает. */
    servo: safe((level = 0) => {
      level = Math.max(0, Math.min(1, +level || 0));
      if (!servoNode) {
        if (level <= 0) return;
        const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        o1.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.Q.value = 3; g.gain.value = 0;
        o1.connect(f); o2.connect(f); f.connect(g); g.connect(master); o1.start(); o2.start();
        servoNode = { o1, o2, f, gain: g.gain };
      }
      const t = ctx.currentTime;
      servoNode.o1.frequency.setTargetAtTime(48 + 70 * level, t, 0.08);
      servoNode.o2.frequency.setTargetAtTime(97 + 141 * level, t, 0.08);
      servoNode.f.frequency.setTargetAtTime(260 + 900 * level, t, 0.08);
      servoNode.gain.setTargetAtTime(level > 0 ? 0.05 + 0.1 * level : 0, t, 0.07);
    }),
    /** Элеватор подачи: мотор и цепь, ~1.6 с. */
    hoist: safe(() => {
      const t = now(), dur = 1.6;
      tone(t, dur, { type: 'sawtooth', f: 62, f2: 96, gain: 0.12, attack: 0.15 });
      noise(t, dur, { type: 'bandpass', f: 500, f2: 800, q: 0.8, gain: 0.07, attack: 0.2 });
      for (let i = 0; i < 12; i++) noise(t + 0.12 + i * 0.12, 0.02, { type: 'bandpass', f: rv(1300, 1900), q: 3, gain: 0.14, attack: 0.001 });
      tone(t + dur - 0.05, 0.16, { f: 110, f2: 50, gain: 0.45 });
    }),
    /** Досылатель: пневматический толчок и удар. */
    ram: safe(() => {
      const t = now();
      noise(t, 0.45, { type: 'bandpass', f: 2600, f2: 500, q: 0.7, gain: 0.3, attack: 0.03 });
      tone(t + 0.36, 0.25, { f: 90, f2: 38, gain: 0.7 });
      noise(t + 0.36, 0.09, { type: 'lowpass', f: 700, gain: 0.45 });
      noise(t + 0.55, 0.5, { type: 'highpass', f: 3000, gain: 0.05, attack: 0.1 });
    }),
    /** Затвор: тяжёлый лязг. */
    breech: safe(() => {
      const t = now();
      noise(t, 0.3, { type: 'bandpass', f: 700, f2: 250, q: 1, gain: 0.2, attack: 0.05 });
      for (const [dt, g] of [[0.3, 0.7], [0.42, 0.35]]) {
        tone(t + dt, 0.22, { f: 96, f2: 42, gain: g });
        noise(t + dt, 0.06, { type: 'lowpass', f: 1500, gain: g * 0.6 });
        for (const f of [412, 655, 1093, 1711]) tone(t + dt, rv(0.25, 0.5), { f: f * rv(0.98, 1.02), gain: 0.035 * g });
      }
    }),
    /** Выстрел главного калибра. */
    fire: safe(() => {
      const t = now();
      const shaper = ctx.createWaveShaper(), n = 256, curve = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(x * 3); }
      shaper.curve = curve;
      const out = ctx.createGain(); out.gain.value = 0.9;
      shaper.connect(out); out.connect(master);
      noise(t, 0.09, { type: 'highpass', f: 800, gain: 0.9, attack: 0.001, dest: shaper });
      noise(t, 1.6, { type: 'lowpass', f: 1400, f2: 90, q: 0.5, gain: 1.0, attack: 0.004, dest: shaper });
      tone(t, 1.1, { f: 95, f2: 26, gain: 1.0, attack: 0.004, dest: shaper });
      noise(t + 0.25, 2.6, { type: 'lowpass', f: 220, f2: 60, gain: 0.35, attack: 0.3 });   // раскат
      for (let i = 0; i < 5; i++) noise(t + 0.5 + i * rv(0.12, 0.22), 0.03, { type: 'bandpass', f: rv(2000, 4200), q: 5, gain: 0.05 }); // дребезг
    }),
    /** Далёкий разрыв. */
    impactFar: safe(() => {
      const t = now();
      noise(t, 1.5, { type: 'lowpass', f: 300, f2: 55, gain: 0.5, attack: 0.03 });
      tone(t, 0.8, { f: 58, f2: 28, gain: 0.4, attack: 0.02 });
      noise(t + 0.5, 2.0, { type: 'lowpass', f: 130, f2: 50, gain: 0.16, attack: 0.5 });
    }),
    /** Радио: щелчок тангенты, шипение, тон вызова. */
    radio: safe(() => {
      if (!limited('radio', 0.3)) return;
      const t = now();
      noise(t, 0.02, { type: 'highpass', f: 2000, gain: 0.2, attack: 0.001 });
      noise(t + 0.02, 0.42, { type: 'bandpass', f: 1900, q: 0.9, gain: 0.07, attack: 0.02 });
      tone(t + 0.06, 0.09, { type: 'square', f: 1180, gain: 0.035 });
      tone(t + 0.2, 0.12, { type: 'square', f: 880, gain: 0.035 });
      noise(t + 0.46, 0.02, { type: 'highpass', f: 2000, gain: 0.14, attack: 0.001 });
    }),
    /** Тревога (ревун): on/off. */
    alarm(on) {
      wantAlarm = !!on;
      try {
        if (!ctx) return;
        if (on && !alarmNode) {
          const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), f = ctx.createBiquadFilter(), g = ctx.createGain();
          o.type = 'sawtooth'; o.frequency.value = 420; lfo.type = 'square'; lfo.frequency.value = 1.6; lg.gain.value = 90;
          f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 1.2; g.gain.value = 0;
          lfo.connect(lg); lg.connect(o.frequency); o.connect(f); f.connect(g); g.connect(master);
          o.start(); lfo.start();
          alarmNode = { o, lfo, gain: g.gain };
          fadeNode(g, 0.13, 0.05);
        } else if (!on && alarmNode) {
          const a = alarmNode; alarmNode = null;
          a.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
          a.o.stop(ctx.currentTime + 0.4); a.lfo.stop(ctx.currentTime + 0.4);
        }
      } catch (e) { /* тихо */ }
    },
    /** Фон башни: гул вентиляции и трансформаторов. */
    ambient(on) {
      wantAmbient = !!on;
      try {
        if (!ctx) return;
        if (on && !ambientNode) {
          const g = ctx.createGain(); g.gain.value = 0; g.connect(master);
          const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
          const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 210; f.Q.value = 0.6;
          const ng = ctx.createGain(); ng.gain.value = 0.5;
          src.connect(f); f.connect(ng); ng.connect(g);
          const h1 = ctx.createOscillator(), h2 = ctx.createOscillator(), hg = ctx.createGain();
          h1.frequency.value = 50; h2.frequency.value = 100.6; h2.type = 'triangle'; hg.gain.value = 0.16;
          h1.connect(hg); h2.connect(hg); hg.connect(g);
          src.start(); h1.start(); h2.start();
          ambientNode = { src, h1, h2, gain: g.gain };
          fadeNode(g, 0.1, 0.8);
        } else if (!on && ambientNode) {
          const a = ambientNode; ambientNode = null;
          a.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
          const t = ctx.currentTime + 1.5; a.src.stop(t); a.h1.stop(t); a.h2.stop(t);
        }
      } catch (e) { /* тихо */ }
    },
    /** Приостановить/возобновить весь звук (сворачивание приложения). */
    suspend() { try { if (ctx && ctx.state === 'running') ctx.suspend(); } catch (e) { /* тихо */ } },
    resume() { try { if (ctx && ctx.state === 'suspended') ctx.resume(); } catch (e) { /* тихо */ } },
    /** Освободить контекст. */
    dispose() { try { if (ctx) ctx.close(); } catch (e) { /* тихо */ } ctx = null; servoNode = alarmNode = ambientNode = null; },
  };
  return api;
}
