// Непрерывные и параметрические звуки, которые нельзя просчитать заранее: высота и громкость следуют за игрой.
// Дёшево для слабого телефона: живых генераторов шума нет; тоны — генераторы с собственной гладкой формой волны
// (PeriodicWave: несколько гармоник с быстрым спадом — без «пилы», без искажения и без наложения спектров), петли — из банка.
//
//   slew(level)            гул привода наведения: мотор (гармоники) через НЧ-фильтр, высота и яркость следуют за level
//   gear(speed)            шестерни маховика: петля «зубьев» из банка, скорость петли = частота зубьев
//   hoist(on) / hoistShot  элеватор: петля цепи из банка + мотор с разгоном и выбегом
//   aa(on)                 очередь спарки: петля из банка, по отпусканию — хвост aaTail
//   drone(level, approach) самолёты: два мотора с медленным биением (рассинхрон), допплер по approach
//   siren(on) / sirenShot  ручная сирена: два ротора (в малую терцию), раскрутка и выбег
//   alarm(on)              ревун неисправности: двухтональный гудок с пульсацией
//   staticBed(level)       открытый канал радио: очень тихий тёмный шорох (петля банка)
//   whistle(dur, kind)     свист снаряда/бомбы с падающей высотой и нарастанием
//   flyby(dur, from, to)   пролёт самолёта над башней с допплером и панорамой
// Записи (samples.js): привод — петля мотора slewLoop, самолёты — петля винта planeLoop, сирена — sirenLoop/sirenShot;
// высота следует за игрой через playbackRate. Пока записи нет — те же звуки живыми генераторами.

const clamp01 = (v) => Math.max(0, Math.min(1, +v || 0));
// гладкие формы волны: амплитуды гармоник 1…n
const W_MOTOR = [1, 0.5, 0.3, 0.16, 0.09, 0.05, 0.03];
const W_ENGINE = [1, 0.7, 0.45, 0.32, 0.2, 0.13, 0.08, 0.05, 0.03];
const W_HORN = [1, 0.6, 0.42, 0.28, 0.18, 0.11, 0.07, 0.04];
const W_SIREN = [1, 0.3, 0.12, 0.05];
const waves = new WeakMap();
function wave(ctx, amps) {
  let m = waves.get(ctx); if (!m) waves.set(ctx, m = new Map());
  let w = m.get(amps);
  if (!w) { const re = new Float32Array(amps.length + 1), im = new Float32Array(amps.length + 1); amps.forEach((a, i) => { im[i + 1] = a; }); w = ctx.createPeriodicWave(re, im); m.set(amps, w); }
  return w;
}

/** Сборщик живых узлов: помнит всё созданное, чтобы разом остановить и отсоединить. */
export function builder(core) {
  const ctx = core.ctx, b = { nodes: [], srcs: [], ctx };
  const reg = (n) => { b.nodes.push(n); return n; };
  b.gain = (v, dest) => { const g = reg(ctx.createGain()); g.gain.value = v; if (dest) g.connect(dest); return g; };
  b.filter = (type, f, q, dest) => { const n = reg(ctx.createBiquadFilter()); n.type = type; n.frequency.value = f; n.Q.value = q; if (dest) n.connect(dest); return n; };
  b.osc = (type, f, dest, at) => { const o = reg(ctx.createOscillator()); o.type = type; o.frequency.value = f; if (dest) o.connect(dest); o.start(at || 0); b.srcs.push(o); return o; };
  b.wave = (amps, f, dest, at) => { const o = b.osc('sine', f, dest, at); try { o.setPeriodicWave(wave(ctx, amps)); } catch (e) { /* синус */ } return o; };
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
  /** Источник-петля записи name (или null), подключённый к dest; старт со случайного места. */
  function recLoop(b, name, dest) {
    const buf = core.bank && core.bank.get(name, 0);
    if (!buf) return null;
    const src = b.nodes[b.nodes.push(core.ctx.createBufferSource()) - 1];
    src.buffer = buf; src.loop = true; src.connect(dest); src.start(0, core.rnd() * buf.duration); b.srcs.push(src);
    return src;
  }
  L.slew = levelLoop(core, (b) => {
    const out = b.gain(0, core.input('fx', 'rec')), f = b.filter('lowpass', 300, 0.9, out);
    const rec = recLoop(b, 'slewLoop', f);
    if (rec) {
      return { b, out, update(l, t) {                // мотор: обороты и яркость следуют за level
        rec.playbackRate.setTargetAtTime(0.7 + 0.55 * l, t, 0.08);
        f.frequency.setTargetAtTime(500 + 2200 * l, t, 0.08);
        out.gain.setTargetAtTime(l > 0 ? G('slewLoop') * (0.45 + 0.55 * l) : 0, t, 0.07);
      } };
    }
    const m = b.wave(W_MOTOR, 48, f);
    return { b, out, update(l, t) {
      m.frequency.setTargetAtTime(48 + 70 * l, t, 0.08);
      f.frequency.setTargetAtTime(280 + 700 * l, t, 0.08);
      out.gain.setTargetAtTime(l > 0 ? 0.03 + 0.05 * l : 0, t, 0.07);
    } };
  }, 0.4);

  // ----- шестерни маховика: петля «зубьев» из банка (16 зубьев на круг), частота зубьев 12…72 в секунду -----
  let gear = null;
  L.gear = (speed) => {
    const s = clamp01(speed), ctx = core.ctx, t = ctx.currentTime;
    if (s > 0 && !gear) {
      const buf = core.bank && core.bank.get('gearLoop', 0);
      if (!buf) return;
      const b = builder(core), g = b.gain(0, core.input('fx', 'in'));
      const src = b.nodes[b.nodes.push(ctx.createBufferSource()) - 1]; src.buffer = buf; src.loop = true; src.connect(g); src.start(t); b.srcs.push(src);
      gear = { b, g, src };
    }
    if (!gear) return;
    gear.src.playbackRate.setTargetAtTime((12 + 60 * s) / 32, t, 0.06);
    gear.g.gain.setTargetAtTime(s > 0 ? G('gearLoop') * (0.6 + 0.6 * s) : 0, t, 0.05);
    if (s <= 0) { gear.b.end(t + 0.35); gear = null; }
  };
  L.gear.active = () => !!gear;
  L.gear.drop = () => { gear = null; };

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
    const b = builder(core), g = b.gain(0, core.input('fx', 'in')), lp = b.filter('lowpass', 420, 0.8, g);
    const o = b.wave(W_MOTOR, f0, lp, at);
    o.frequency.setValueAtTime(f0, at); o.frequency.setTargetAtTime(f1, at, rise);
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(gain, at + 0.08);
    return { b, stop(end) {
      o.frequency.setTargetAtTime(f0 * 0.7, end, 0.12);
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
    const out = b.gain(0, core.input('fx', 'out')), pn = b.pan(0, out), f = b.filter('lowpass', 380, 0.7, pn);
    const rec = recLoop(b, 'planeLoop', f);
    if (rec) {
      return { b, out, update(l, t, approach, pan) {
        const a = approach == null ? null : clamp01(approach), k = a == null ? 0.85 + 0.25 * l : doppler(a);
        const near = a == null ? l : l * (0.25 + 0.75 * Math.exp(-Math.pow((a - 0.5) * 3.2, 2)));
        rec.playbackRate.setTargetAtTime(k, t, 0.3);
        f.frequency.setTargetAtTime(500 + 3500 * near, t, 0.3);
        if (pn.pan) pn.pan.setTargetAtTime(pan == null ? (a == null ? 0 : (a - 0.5) * 1.6) : Math.max(-1, Math.min(1, pan)), t, 0.2);
        out.gain.setTargetAtTime(l > 0 ? G('planeLoop') * (0.12 + 0.88 * near * near) : 0, t, 0.25);
      } };
    }
    const o1 = b.wave(W_ENGINE, 92, f), o2 = b.wave(W_ENGINE, 93.4, b.gain(0.7, f));        // два мотора: медленное биение ~1.4 Гц
    return { b, out, update(l, t, approach, pan) {
      const a = approach == null ? null : clamp01(approach), k = a == null ? 1 + 0.45 * l : doppler(a) * 1.25;
      const near = a == null ? l : l * (0.25 + 0.75 * Math.exp(-Math.pow((a - 0.5) * 3.2, 2)));
      o1.frequency.setTargetAtTime(88 * k, t, 0.3); o2.frequency.setTargetAtTime(89.3 * k, t, 0.3);
      f.frequency.setTargetAtTime(300 + 900 * near, t, 0.3);
      if (pn.pan) pn.pan.setTargetAtTime(pan == null ? (a == null ? 0 : (a - 0.5) * 1.6) : Math.max(-1, Math.min(1, pan)), t, 0.2);
      out.gain.setTargetAtTime(l > 0 ? 0.02 + 0.16 * near * near : 0, t, 0.25);
    } };
  }, 1.4);

  /** Пролёт над башней: dur с, панорама from → to. Расписан заранее. */
  L.flyby = (dur, from, to, gain) => {
    const ctx = core.ctx, t = ctx.currentTime + 0.01, b = builder(core), end = t + dur;
    const out = b.gain(0, core.input('fx', 'out')), pn = b.pan(from, out), f = b.filter('lowpass', 300, 0.7, pn);
    const rec = recLoop(b, 'planeLoop', f);
    const oscs = rec ? [] : [b.wave(W_ENGINE, 88, f, t), b.wave(W_ENGINE, 89.3, b.gain(0.7, f), t)];
    if (rec) gain *= G('planeLoop') / 0.18;
    const N = 24, gv = new Float32Array(N), fv = new Float32Array(N), cv = new Float32Array(N), pv = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = i / (N - 1), bell = Math.exp(-Math.pow((a - 0.5) * 3.4, 2));
      gv[i] = gain * 1.2 * (0.03 + 0.97 * bell) * Math.min(1, a * 8, (1 - a) * 8); fv[i] = doppler(a) * (rec ? 1 : 1.25); cv[i] = rec ? 600 + 4000 * bell : 300 + 1200 * bell; pv[i] = from + (to - from) * a;
    }
    out.gain.setValueCurveAtTime(gv, t, dur);
    f.frequency.setValueCurveAtTime(cv, t, dur);
    if (pn.pan) pn.pan.setValueCurveAtTime(pv, t, dur);
    if (rec) rec.playbackRate.setValueCurveAtTime(fv, t, dur);
    else [88, 89.3].forEach((base, i) => { oscs[i].frequency.setValueCurveAtTime(fv.map((x) => x * base), t, dur); });
    b.end(end + 0.05);
    return dur;
  };

  // ----- сирена -----
  function sirenVoice(b) {
    const out = b.gain(0, core.input('fx', 'out')), lp = b.filter('lowpass', 1400, 0.7, out);
    const rec = recLoop(b, 'sirenLoop', lp);
    if (rec) {
      lp.frequency.value = 2400;
      return { out, spin(t, level, tc) {          // запись: обороты ротора — скорость петли (раскрутка снизу, выбег вниз)
        rec.playbackRate.setTargetAtTime(0.45 + 0.55 * level, t, tc);
        out.gain.setTargetAtTime(G('sirenLoop') * Math.pow(level, 1.2), t, tc);
      } };
    }
    const o1 = b.wave(W_SIREN, 60, b.gain(0.55, lp)), o2 = b.wave(W_SIREN, 72, b.gain(0.4, lp));
    return { out, spin(t, level, tc) {            // level 0…1 — обороты ротора
      o1.frequency.setTargetAtTime(90 + 520 * level, t, tc); o2.frequency.setTargetAtTime((90 + 520 * level) * 1.19, t, tc);
      out.gain.setTargetAtTime(0.15 * Math.pow(level, 1.5), t, tc);
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
    const shot = core.bank && core.bank.get('sirenShot', 0);
    if (shot) {                                    // запись: завывания городской сирены (~4.5 с из записи, плавные края)
      const t = core.ctx.currentTime + 0.01, b = builder(core), g = b.gain(0, core.input('fx', 'out'));
      const s = b.nodes[b.nodes.push(core.ctx.createBufferSource()) - 1]; s.buffer = shot; s.connect(g); b.srcs.push(s);
      const len = Math.min(5, shot.duration);
      s.start(t, Math.max(0, Math.min(shot.duration - len, core.rnd() * (shot.duration - len))));
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(G('sirenShot'), t + 0.5);
      g.gain.setValueAtTime(G('sirenShot'), t + len - 0.9); g.gain.linearRampToValueAtTime(0, t + len);
      b.end(t + len + 0.05);
      return;
    }
    const t = core.ctx.currentTime + 0.01, b = builder(core), v = sirenVoice(b);
    for (let i = 0; i < 3; i++) { v.spin(t + i * 1.35, 1, 0.26); v.spin(t + i * 1.35 + 0.75, i === 2 ? 0 : 0.5, i === 2 ? 0.5 : 0.3); }
    b.end(t + 5.2);
  };

  // ----- ревун неисправности -----
  let alarm = null;
  /** Ревун неисправности: петля банка (два гладких тона с пульсацией). */
  L.alarm = (on) => {
    const t = core.ctx.currentTime + 0.005;
    if (on && !alarm) {
      const a = alarm = { loop: null };
      const attach = () => { if (alarm !== a || a.loop) return; a.loop = bufLoop('alarmLoop', core.ctx.currentTime + 0.005, { gain: G('alarmLoop'), fade: 0.04 }); if (!a.loop) core.whenReady('alarmLoop', attach); };
      attach();
    } else if (!on && alarm) {
      const a = alarm; alarm = null;
      if (a.loop) a.loop.stop(t, 0.12);
    }
  };

  // ----- радиоэфир -----
  L.staticBed = levelLoop(core, (b) => {
    const out = b.gain(0, core.input('radio', 'in')), buf = core.bank && core.bank.get('etherBed', 0);
    if (buf) { const src = b.nodes[b.nodes.push(core.ctx.createBufferSource()) - 1]; src.buffer = buf; src.loop = true; src.connect(out); src.start(0, core.rnd() * buf.duration); b.srcs.push(src); }
    return { b, out, update(l, t) { out.gain.setTargetAtTime(G('etherBed') * l, t, 0.15); } };
  }, 0.6);

  // ----- свист снаряда и бомбы -----
  L.whistle = (dur, kind, pan) => {
    const ctx = core.ctx, t = ctx.currentTime + 0.005, b = builder(core), bomb = kind === 'bomb';
    dur = Math.max(0.3, Math.min(8, +dur || 2.2));
    const out = b.gain(0, b.pan(pan || 0, core.input('fx', 'out')));
    const f0 = bomb ? 2000 : 1500, f1 = bomb ? 600 : 420, peak = bomb ? 0.24 : 0.24;
    out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(peak, t + dur * 0.92); out.gain.linearRampToValueAtTime(0, t + dur);
    const fall = (p, a, c) => { p.setValueAtTime(a, t); p.exponentialRampToValueAtTime(c, t + dur); };
    const o1 = b.osc('sine', f0, b.gain(0.6, out), t), o2 = b.osc('sine', f0 * 1.02, b.gain(0.35, out), t);
    fall(o1.frequency, f0, f1); fall(o2.frequency, f0 * 1.02, f1 * 1.025);
    b.osc('sine', bomb ? 19 : 11, b.gain(0.02, out.gain), t);                       // дрожь: снаряд вращается
    b.end(t + dur + 0.05);
    return dur;
  };

  /** Какие петли сейчас звучат (для проверок: после выхода из боя всё должно быть false). */
  L.state = () => ({ slew: L.slew.active(), gear: L.gear.active(), hoist: !!hoist, aa: !!aa, drone: L.drone.active(), siren: !!siren, alarm: !!alarm, static: L.staticBed.active() });
  L.reset = () => { hoist = aa = siren = alarm = null; clearTimeout(sirenTimer); L.slew.drop(); L.gear.drop(); L.drone.drop(); L.staticBed.drop(); };
  return L;
}
