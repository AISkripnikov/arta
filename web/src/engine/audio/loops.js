// Непрерывные и параметрические звуки, которые нельзя просчитать заранее: высота и громкость следуют за игрой.
// Все собраны из нескольких живых узлов (генераторы, шум, фильтры) и освобождаются, когда уровень падает до нуля.
//
//   slew(level)            гул привода наведения: пила + меандр через резонансный НЧ-фильтр, суб-тон, вой редуктора
//   gear(speed)            шестерни маховика: шум в узкой полосе, порубленный частотой зубьев, + тон зацепления
//   hoist(on) / hoistShot  элеватор: петля цепи из банка + живой мотор с разгоном и выбегом
//   aa(on)                 очередь спарки: петля из банка, по отпусканию — хвост aaTail
//   drone(level, approach) самолёты: две пилы с биением, винт (дрожь громкости), допплер по approach
//   siren(on) / sirenShot  ручная сирена: два ротора (в малую терцию), раскрутка и выбег
//   alarm(on)              ревун неисправности: хриплый двухтональный гудок с пульсацией
//   staticBed(level)       радиоэфир: полосовой шум, треск, плавающий свист несущей
//   whistle(dur, kind)     свист снаряда/бомбы с падающей высотой и нарастанием
//   flyby(dur, from, to)   пролёт самолёта над башней с допплером и панорамой

const clamp01 = (v) => Math.max(0, Math.min(1, +v || 0));

/** Сборщик живых узлов: помнит всё созданное, чтобы разом остановить и отсоединить. */
export function builder(core) {
  const ctx = core.ctx, b = { nodes: [], srcs: [], ctx };
  const reg = (n) => { b.nodes.push(n); return n; };
  b.gain = (v, dest) => { const g = reg(ctx.createGain()); g.gain.value = v; if (dest) g.connect(dest); return g; };
  b.filter = (type, f, q, dest) => { const n = reg(ctx.createBiquadFilter()); n.type = type; n.frequency.value = f; n.Q.value = q; if (dest) n.connect(dest); return n; };
  b.osc = (type, f, dest, at) => { const o = reg(ctx.createOscillator()); o.type = type; o.frequency.value = f; if (dest) o.connect(dest); o.start(at || 0); b.srcs.push(o); return o; };
  b.noise = (dest, rate, at) => { const s = reg(ctx.createBufferSource()); s.buffer = core.noise; s.loop = true; if (rate) s.playbackRate.value = rate; if (dest) s.connect(dest); s.start(at || 0, core.rnd() * 1.7); b.srcs.push(s); return s; };
  b.pan = (v, dest) => { if (!ctx.createStereoPanner) return b.gain(1, dest); const n = reg(ctx.createStereoPanner()); n.pan.value = v; n.connect(dest); return n; };
  b.shaper = (curve, dest) => { const n = reg(ctx.createWaveShaper()); n.curve = curve; if (dest) n.connect(dest); return n; };
  /** Остановить все источники в момент end и отдать узлы на уборку. */
  b.end = (end) => { for (const s of b.srcs) { try { s.stop(end); } catch (e) { /* уже остановлен */ } } core.trash(b.nodes, end); };
  return b;
}

/** Звук с уровнем: строится при первом level > 0, при level = 0 затухает и освобождается. */
function levelLoop(core, build, release) {
  let v = null;
  const set = (level, a, c) => {
    level = clamp01(level);
    if (!v) { if (level <= 0) return; v = build(builder(core)); }
    const t = core.ctx.currentTime;
    v.update(level, t, a, c);
    if (level <= 0) { const d = v; v = null; d.out.gain.setTargetAtTime(0, t, release / 4); d.b.end(t + release + 0.1); }
  };
  set.active = () => !!v;
  set.drop = () => { v = null; };
  return set;
}

export function createLoops(core, satCurve) {
  const L = {};

  // ----- привод наведения -----
  L.slew = levelLoop(core, (b) => {
    const out = b.gain(0, core.input('fx', 'in')), f = b.filter('lowpass', 300, 3, out);
    const o1 = b.osc('sawtooth', 48, f), o2 = b.osc('square', 97, b.gain(0.5, f));
    const sub = b.osc('sine', 24, b.gain(0.9, out));
    const wg = b.gain(0, out), whine = b.osc('triangle', 400, wg);
    const bg = b.gain(0, out); b.noise(b.filter('bandpass', 2400, 1.5, bg));
    return { b, out, update(l, t) {
      o1.frequency.setTargetAtTime(48 + 70 * l, t, 0.08); o2.frequency.setTargetAtTime(97 + 141 * l, t, 0.08);
      sub.frequency.setTargetAtTime(24 + 35 * l, t, 0.08); whine.frequency.setTargetAtTime(380 + 900 * l, t, 0.1);
      f.frequency.setTargetAtTime(260 + 900 * l, t, 0.08);
      wg.gain.setTargetAtTime(0.12 * l, t, 0.1); bg.gain.setTargetAtTime(0.1 * l, t, 0.1);
      out.gain.setTargetAtTime(l > 0 ? 0.02 + 0.04 * l : 0, t, 0.07);
    } };
  }, 0.4);

  // ----- шестерни маховика -----
  L.gear = levelLoop(core, (b) => {
    const out = b.gain(0, core.input('fx', 'in')), am = b.gain(0.5, out), bp = b.filter('bandpass', 900, 4, am);
    b.noise(bp);
    const teeth = b.osc('square', 20, b.gain(0.5, am.gain));
    const mesh = b.osc('triangle', 160, b.gain(0.12, am));
    return { b, out, update(s, t) {
      teeth.frequency.setTargetAtTime(12 + 60 * s, t, 0.06); mesh.frequency.setTargetAtTime((12 + 60 * s) * 8, t, 0.06);
      bp.frequency.setTargetAtTime(600 + 1500 * s, t, 0.06);
      out.gain.setTargetAtTime(s > 0 ? 0.12 + 0.2 * s : 0, t, 0.05);
    } };
  }, 0.25);

  // ----- петли из банка -----
  /** Запустить петлю из банка в момент at; null, если буфер ещё не готов. */
  function bufLoop(name, at, o) {
    const buf = core.bank && core.bank.get(name, 0);
    if (!buf) return null;
    const b = builder(core), g = b.gain(0, core.input(o.bus || 'fx', o.space || 'in'));
    const src = b.nodes[b.nodes.push(core.ctx.createBufferSource()) - 1];
    src.buffer = buf; src.loop = true; src.connect(g); src.start(at); b.srcs.push(src);
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(o.gain, at + (o.fade || 0.02));
    return { b, g, src, stop(end, fade) { g.gain.setValueAtTime(o.gain, end); g.gain.linearRampToValueAtTime(0, end + fade); b.end(end + fade + 0.05); } };
  }
  function motor(at, f0, f1, gain, rise) {
    const b = builder(core), g = b.gain(0, core.input('fx', 'in')), lp = b.filter('lowpass', 520, 2, g);
    const o = b.osc('sawtooth', f0, lp, at), o2 = b.osc('square', f0 * 2.02, b.gain(0.35, lp), at);
    o.frequency.setValueAtTime(f0, at); o.frequency.setTargetAtTime(f1, at, rise); o2.frequency.setValueAtTime(f0 * 2.02, at); o2.frequency.setTargetAtTime(f1 * 2.02, at, rise);
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(gain, at + 0.08);
    return { b, stop(end) {
      o.frequency.setTargetAtTime(f0 * 0.7, end, 0.12); o2.frequency.setTargetAtTime(f0 * 1.4, end, 0.12);
      g.gain.setTargetAtTime(0, end, 0.09); b.end(end + 0.5);
    } };
  }
  const G = (name) => core.recipeGain(name);

  let hoist = null;
  /** Элеватор подачи: on/off. */
  L.hoist = (on) => {
    const t = core.ctx.currentTime + 0.005;
    if (on && !hoist) {
      const h = hoist = { m: motor(t, 34, 75, 0.07, 0.12), chain: null };
      core.play('hoistStart');
      const attach = () => { if (hoist !== h || h.chain) return; h.chain = bufLoop('hoistLoop', core.ctx.currentTime + 0.01, { gain: G('hoistLoop'), fade: 0.08 }); if (!h.chain) core.whenReady('hoistLoop', attach); };
      attach();
    } else if (!on && hoist) {
      const h = hoist; hoist = null;
      h.m.stop(t); if (h.chain) h.chain.stop(t, 0.06);
      core.play('hoistStop');
    }
  };
  /** Элеватор на заданное время (старый hoist()): всё расписано по времени звука, без таймеров. */
  L.hoistShot = (dur) => {
    const t = core.ctx.currentTime + 0.005, end = t + dur;
    motor(t, 34, 75, 0.07, 0.12).stop(end);
    core.play('hoistStart');
    const ch = bufLoop('hoistLoop', t + 0.08, { gain: G('hoistLoop'), fade: 0.08 });
    if (ch) ch.stop(end, 0.06);
    else core.play('hoistLoop', { when: 0.08 });               // банк ещё не готов: один круг цепи вживую
    core.play('hoistStop', { when: dur });
  };

  let aa = null;
  /** Очередь зенитной спарки: on/off. */
  L.aa = (on, pan) => {
    const t = core.ctx.currentTime + 0.005;
    if (on && !aa) {
      const a = aa = { loop: null };
      const attach = () => {
        if (aa !== a || a.loop) return;
        a.loop = bufLoop('aaLoop', core.ctx.currentTime + 0.005, { gain: G('aaLoop'), fade: 0.004, space: 'big' });
        if (!a.loop) { core.play('aaShot'); core.whenReady('aaLoop', attach); }
      };
      attach();
    } else if (!on && aa) {
      const a = aa; aa = null;
      if (a.loop) a.loop.stop(t, 0.05);
      core.play('aaTail', { pan });
    }
  };
  L.aaActive = () => !!aa;

  // ----- самолёты -----
  // approach: 0 — далеко и приближается, 0.5 — над башней, 1 — уходит. Высота по Допплеру, громкость и яркость — колоколом.
  const doppler = (a) => 1 + 0.11 * Math.tanh((0.5 - a) * 7);
  L.drone = levelLoop(core, (b) => {
    const out = b.gain(0, core.input('fx', 'out')), pn = b.pan(0, out), prop = b.gain(0.75, pn), f = b.filter('lowpass', 380, 1.4, prop);
    const o1 = b.osc('sawtooth', 92, f), o2 = b.osc('sawtooth', 97.5, f), o3 = b.osc('square', 46, b.gain(0.4, f));
    const beat = b.osc('sine', 23, b.gain(0.25, prop.gain));
    b.noise(b.filter('bandpass', 900, 0.8, b.gain(0.15, prop)));
    return { b, out, update(l, t, approach, pan) {
      const a = approach == null ? null : clamp01(approach), k = a == null ? 1 + 0.45 * l : doppler(a) * 1.25;
      const near = a == null ? l : l * (0.25 + 0.75 * Math.exp(-Math.pow((a - 0.5) * 3.2, 2)));
      o1.frequency.setTargetAtTime(88 * k, t, 0.3); o2.frequency.setTargetAtTime(93 * k, t, 0.3); o3.frequency.setTargetAtTime(44 * k, t, 0.3);
      beat.frequency.setTargetAtTime(21 * k, t, 0.3);
      f.frequency.setTargetAtTime(300 + 1100 * near, t, 0.3);
      if (pn.pan) pn.pan.setTargetAtTime(pan == null ? (a == null ? 0 : (a - 0.5) * 1.6) : Math.max(-1, Math.min(1, pan)), t, 0.2);
      out.gain.setTargetAtTime(l > 0 ? 0.015 + 0.13 * near * near : 0, t, 0.25);
    } };
  }, 1.4);

  /** Пролёт над башней: dur с, панорама from → to. Расписан заранее. */
  L.flyby = (dur, from, to, gain) => {
    const ctx = core.ctx, t = ctx.currentTime + 0.01, b = builder(core), end = t + dur;
    const out = b.gain(0, core.input('fx', 'out')), pn = b.pan(from, out), prop = b.gain(0.75, pn), f = b.filter('lowpass', 300, 1.4, prop);
    const oscs = [b.osc('sawtooth', 88, f, t), b.osc('sawtooth', 93, f, t), b.osc('square', 44, b.gain(0.4, f), t)];
    const beat = b.osc('sine', 21, b.gain(0.25, prop.gain), t);
    b.noise(b.filter('bandpass', 900, 0.8, b.gain(0.15, prop)), 1, t);
    const N = 24, gv = new Float32Array(N), fv = new Float32Array(N), cv = new Float32Array(N), pv = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = i / (N - 1), bell = Math.exp(-Math.pow((a - 0.5) * 3.4, 2));
      gv[i] = gain * (0.03 + 0.97 * bell) * Math.min(1, a * 8, (1 - a) * 8); fv[i] = doppler(a) * 1.25; cv[i] = 300 + 1500 * bell; pv[i] = from + (to - from) * a;
    }
    out.gain.setValueCurveAtTime(gv, t, dur);
    f.frequency.setValueCurveAtTime(cv, t, dur);
    if (pn.pan) pn.pan.setValueCurveAtTime(pv, t, dur);
    [88, 93, 44, 21].forEach((base, i) => { const p = (i < 3 ? oscs[i] : beat).frequency; p.setValueCurveAtTime(fv.map((x) => x * base), t, dur); });
    b.end(end + 0.05);
    return dur;
  };

  // ----- сирена -----
  function sirenVoice(b) {
    const out = b.gain(0, core.input('fx', 'out')), bp = b.filter('bandpass', 900, 0.7, out), sat = b.shaper(satCurve(2), bp);
    const o1 = b.osc('sawtooth', 60, b.gain(0.5, sat)), o2 = b.osc('sawtooth', 72, b.gain(0.4, sat));
    return { out, bp, spin(t, level, tc) {            // level 0…1 — обороты ротора
      o1.frequency.setTargetAtTime(90 + 520 * level, t, tc); o2.frequency.setTargetAtTime((90 + 520 * level) * 1.19, t, tc);
      bp.frequency.setTargetAtTime(500 + 700 * level, t, tc); out.gain.setTargetAtTime(0.15 * Math.pow(level, 1.5), t, tc);
    } };
  }
  let siren = null, sirenTimer = 0;
  /** Сирена воздушной тревоги: on — раскрутить и выть (обороты плавают), off — выбег. */
  L.siren = (on) => {
    const t = core.ctx.currentTime;
    if (on && !siren) {
      const b = builder(core), v = sirenVoice(b); siren = { b, v, up: true };
      v.spin(t, 1, 0.7);
      const wave = () => { if (!siren) return; siren.up = !siren.up; siren.v.spin(core.ctx.currentTime, siren.up ? 1 : 0.62, siren.up ? 0.6 : 0.9); sirenTimer = setTimeout(wave, siren.up ? 2600 : 1500); };
      sirenTimer = setTimeout(wave, 2600);
    } else if (!on && siren) {
      const s = siren; siren = null; clearTimeout(sirenTimer);
      s.v.spin(t, 0, 1.1); s.b.end(t + 4.5);
    }
  };
  /** Три завывания (~4.5 с) — расписаны заранее. */
  L.sirenShot = () => {
    const t = core.ctx.currentTime + 0.01, b = builder(core), v = sirenVoice(b);
    for (let i = 0; i < 3; i++) { v.spin(t + i * 1.35, 1, 0.26); v.spin(t + i * 1.35 + 0.75, i === 2 ? 0 : 0.5, i === 2 ? 0.5 : 0.3); }
    b.end(t + 5.2);
  };

  // ----- ревун неисправности -----
  let alarm = null;
  L.alarm = (on) => {
    const t = core.ctx.currentTime;
    if (on && !alarm) {
      const b = builder(core), out = b.gain(0, core.input('fx', 'in')), pulse = b.gain(0.6, out), bp = b.filter('bandpass', 760, 1.1, pulse), sat = b.shaper(satCurve(3), bp);
      const o1 = b.osc('sawtooth', 370, b.gain(0.5, sat)), o2 = b.osc('sawtooth', 466, b.gain(0.4, sat));
      const lfo = b.osc('square', 1.6, null), lg = b.gain(40, o1.frequency); lfo.connect(lg); b.gain(50, o2.frequency); lfo.connect(b.nodes[b.nodes.length - 1]);
      b.osc('sine', 1.6, b.gain(0.4, pulse.gain));
      out.gain.setTargetAtTime(0.17, t, 0.04);
      alarm = { b, out };
    } else if (!on && alarm) {
      const a = alarm; alarm = null;
      a.out.gain.setTargetAtTime(0, t, 0.05); a.b.end(t + 0.4);
    }
  };

  // ----- радиоэфир -----
  L.staticBed = levelLoop(core, (b) => {
    const out = b.gain(0, core.input('radio', 'in'));
    b.noise(b.filter('bandpass', 1900, 0.7, b.gain(0.5, out)));
    const cg = b.gain(0, out); b.noise(b.filter('highpass', 3000, 0.7, cg), 0.6);
    b.osc('sawtooth', 7.3, b.gain(0.5, cg.gain));                                   // треск: шум, порубленный пилой
    const car = b.osc('sine', 1420, b.gain(0.03, out)); b.osc('sine', 0.7, b.gain(60, car.frequency));
    return { b, out, update(l, t) { out.gain.setTargetAtTime(0.05 * l, t, 0.15); } };
  }, 0.6);

  // ----- свист снаряда и бомбы -----
  L.whistle = (dur, kind, pan) => {
    const ctx = core.ctx, t = ctx.currentTime + 0.005, b = builder(core), bomb = kind === 'bomb';
    dur = Math.max(0.3, Math.min(8, +dur || 2.2));
    const out = b.gain(0, b.pan(pan || 0, core.input('fx', 'out')));
    const f0 = bomb ? 2500 : 1500, f1 = bomb ? 700 : 420, peak = bomb ? 0.2 : 0.2;
    out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(peak, t + dur * 0.92); out.gain.linearRampToValueAtTime(0, t + dur);
    const fall = (p, a, c) => { p.setValueAtTime(a, t); p.exponentialRampToValueAtTime(c, t + dur); };
    const o1 = b.osc(bomb ? 'triangle' : 'sine', f0, b.gain(0.6, out), t), o2 = b.osc('sine', f0 * 1.02, b.gain(0.35, out), t);
    fall(o1.frequency, f0, f1); fall(o2.frequency, f0 * 1.02, f1 * 1.025);
    const bp = b.filter('bandpass', f0 * 1.7, 3, b.gain(0.7, out)); b.noise(bp, 1, t); fall(bp.frequency, f0 * 1.7, f1 * 1.7);
    b.osc('sine', bomb ? 19 : 11, b.gain(0.02, out.gain), t);                       // дрожь: снаряд вращается
    b.end(t + dur + 0.05);
    return dur;
  };

  /** Какие петли сейчас звучат (для проверок: после выхода из боя всё должно быть false). */
  L.state = () => ({ slew: L.slew.active(), gear: L.gear.active(), hoist: !!hoist, aa: !!aa, drone: L.drone.active(), siren: !!siren, alarm: !!alarm, static: L.staticBed.active() });
  L.reset = () => { hoist = aa = siren = alarm = null; clearTimeout(sirenTimer); L.slew.drop(); L.gear.drop(); L.drone.drop(); L.staticBed.drop(); };
  return L;
}
