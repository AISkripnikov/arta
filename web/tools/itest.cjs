// Интерактивный тест движка на стенде «Галерея» (Playwright, мышь + синтетические касания).
//   node build.mjs --dev gallery && node tools/itest.cjs
// Цикл движка остановлен; кадры шагаются вручную без отрисовки (SwiftShader медленный).
const { chromium } = require('playwright');
const path = require('path');

let passed = 0, failed = 0;
const ok = (cond, name, info) => { if (cond) { passed++; console.log('  ok   ' + name + (info !== undefined ? '  [' + info + ']' : '')); } else { failed++; console.log('  FAIL ' + name + (info !== undefined ? '  [' + info + ']' : '')); } };
const near = (a, b, eps) => Math.abs(a - b) <= eps;

(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const problems = [];
  p.on('pageerror', e => problems.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push('CONSOLE.' + m.type() + ': ' + m.text()); });
  await p.goto('file://' + path.resolve(__dirname, '..', '.dev', 'gallery', 'index.html'));
  await p.waitForFunction('window.__dev', null, { timeout: 120000 });
  await p.waitForTimeout(1500);

  console.log('загрузка');
  ok(problems.length === 0, 'нет ошибок и предупреждений в консоли при загрузке', problems.join(' | ') || undefined);
  const info = await p.evaluate(() => ({ font: window.__dev.engine.fonts.loaded, cap: window.__dev.engine.fonts.capRatio, cur: window.__dev.engine.current, n: window.__dev.engine.stations.length }));
  ok(info.font === true, 'шрифт Oswald загружен', 'capRatio=' + info.cap.toFixed(3));
  ok(info.n === 6 && info.cur === 'plot', 'шесть постов, текущий — plot');

  // --- помощники на странице ---
  await p.evaluate(() => {
    const e = window.__dev.engine, T = e.THREE;
    e.stop();
    window.T = {
      step(sec) { const n = Math.max(1, Math.round(sec * 60)); for (let i = 0; i < n; i++) e.debug.step(1 / 60, false); },
      // экранная точка: локальная точка объекта
      scr(obj, x = 0, y = 0, z = 0) { obj.updateWorldMatrix(true, false); const s = e.input.toScreen(new T.Vector3(x, y, z).applyMatrix4(obj.matrixWorld)); return [s.x, s.y]; },
      c(id) { return window.__dev.stations[id].controls; },
      go(id) { e.gotoStation(id, { instant: true }); this.step(0.05); },
      events: [],
    };
    e.on('swipe', d => window.T.events.push('swipe:' + d));
    e.on('station', id => window.T.events.push('station:' + id));
    e.on('arrive', id => window.T.events.push('arrive:' + id));
    window.T.step(0.1);
  });
  const ev = (js, arg) => p.evaluate(js, arg);
  const step = sec => ev(s => window.T.step(s), sec);
  const drag = async (pts, opts = {}) => {
    await p.mouse.move(pts[0][0], pts[0][1]);
    await p.mouse.down();
    for (let i = 1; i < pts.length; i++) await p.mouse.move(pts[i][0], pts[i][1]);
    if (opts.hold) await step(opts.hold);
    if (!opts.keep) await p.mouse.up();
  };
  const tap = async (x, y) => { await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.up(); };
  const line = (a, b, n = 12) => Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);

  // ================= маховик =================
  console.log('маховик');
  for (const [id, name] of [['traverse', 'wFine'], ['computer', 'wRange']]) {
    await ev(i => window.T.go(i), id);
    if (id === 'traverse') {      // снять стопор, иначе пост отказывает (но onTurn всё равно приходит)
      await ev(() => { const c = window.T.c('traverse'); c.leverBrake.set(true); c.state.brake = false; });
    }
    // точки по окружности в плоскости маховика: от «12 часов» по часовой на 200°
    const res = await ev(([i, n]) => {
      const w = window.T.c(i)[n], H = w.wheel.position.z, r = w.radius * 0.8, pts = [];
      for (let a = 0; a <= 200; a += 4) { const f = (90 - a) * Math.PI / 180; pts.push(window.T.scr(w.object3D, r * Math.cos(f), r * Math.sin(f), H)); }
      return { pts, angle: w.angle, rot: w.wheel.rotation.z };
    }, [id, name]);
    const before = await ev(i => { const s = window.T.c(i).state; return { range: s.range, bearing: s.bearing }; }, id);
    await drag(res.pts);
    const after = await ev(([i, n]) => { const w = window.T.c(i)[n], s = window.T.c(i).state; return { angle: w.angle, rot: w.wheel.rotation.z, range: s.range, bearing: s.bearing, turning: w.turning }; }, [id, name]);
    const d = after.angle - res.angle, want = 200 * Math.PI / 180;
    ok(near(d, want, 0.03), id + ': сумма onTurn = +200° при вращении по часовой', (d * 180 / Math.PI).toFixed(2) + '°');
    ok(near(after.rot - res.rot, -want, 0.03), id + ': маховик повернулся визуально 1:1 (рукоятка за пальцем)');
    ok(after.turning === false, id + ': onEnd после отпускания');
    if (id === 'computer') ok(near(after.range - before.range, d / (2 * Math.PI) * 2, 1e-6), 'computer: дальность изменилась на сумму приращений (2 км/оборот)', (after.range - before.range).toFixed(4));
    else ok(near(after.bearing - before.bearing, d / (2 * Math.PI) * 1, 1e-6), 'traverse: пеленг изменился на сумму приращений (1°/оборот)', (after.bearing - before.bearing).toFixed(4));
    // против часовой — знак минус
    const res2 = await ev(([i, n]) => {
      const w = window.T.c(i)[n], H = w.wheel.position.z, r = w.radius * 0.8, pts = [];
      for (let a = 0; a <= 90; a += 4.5) { const f = (0 + a) * Math.PI / 180; pts.push(window.T.scr(w.object3D, r * Math.cos(f), r * Math.sin(f), H)); }
      return { pts, angle: w.angle };
    }, [id, name]);
    await drag(res2.pts);
    const a2 = await ev(([i, n]) => window.T.c(i)[n].angle, [id, name]);
    ok(near(a2 - res2.angle, -Math.PI / 2, 0.03), id + ': против часовой на 90° → −90°', ((a2 - res2.angle) * 180 / Math.PI).toFixed(2) + '°');
    // проход пальца через ступицу: без скачков
    const res3 = await ev(([i, n]) => {
      const w = window.T.c(i)[n], H = w.wheel.position.z, r = w.radius * 0.9;
      window.__turns = []; const orig = w.spin;       // приращения читаем по angle между событиями мыши
      return { a: window.T.scr(w.object3D, -r, 0.004, H), b: window.T.scr(w.object3D, r, 0.004, H), angle: w.angle };
    }, [id, name]);
    const pts = line(res3.a, res3.b, 40);
    await p.mouse.move(pts[0][0], pts[0][1]); await p.mouse.down();
    let prev = res3.angle, maxStep = 0;
    for (let i = 1; i < pts.length; i++) {
      await p.mouse.move(pts[i][0], pts[i][1]);
      const a = await ev(([i2, n]) => window.T.c(i2)[n].angle, [id, name]);
      maxStep = Math.max(maxStep, Math.abs(a - prev)); prev = a;
    }
    await p.mouse.up();
    ok(maxStep < 0.6 && Math.abs(prev - res3.angle) < Math.PI + 0.2, id + ': проход через ступицу без скачка', 'макс. шаг ' + (maxStep * 180 / Math.PI).toFixed(1) + '°, всего ' + ((prev - res3.angle) * 180 / Math.PI).toFixed(1) + '°');
  }
  // spin(): визуально, без события
  {
    const r = await ev(() => { const c = window.T.c('computer'), w = c.wRange, r0 = c.state.range, a0 = w.angle, z0 = w.wheel.rotation.z; w.spin(1); return { dr: c.state.range - r0, da: w.angle - a0, dz: w.wheel.rotation.z - z0 }; });
    ok(r.dr === 0 && near(r.da, 1, 1e-9) && near(r.dz, -1, 1e-9), 'spin(1): поворот без onTurn');
  }

  // ================= барабанный счётчик =================
  console.log('счётчик');
  {
    await step(3);
    const r = await ev(() => { const c = window.T.c('computer'); return { v: c.cRange.value, s: c.cRange.shown, range: c.state.range }; });
    ok(near(r.v, Math.round(r.range * 100) / 100, 1e-9) && near(r.s, r.v, 1e-6), 'счётчик дошёл до заданного значения', r.s.toFixed(2) + ' = ' + r.v.toFixed(2));
    const r2 = await ev(() => {
      const c = window.T.c('computer').cElev; c.setValue(12.34); const mid = [];
      for (let i = 0; i < 8; i++) { window.T.step(0.05); mid.push(+c.shown.toFixed(3)); }
      window.T.step(3); const end = c.shown; c.setValue(7.5, { instant: true });
      return { mid, end, v: c.value, inst: c.shown };
    });
    const mono = r2.mid.every((v, i) => i === 0 || v >= r2.mid[i - 1]) && r2.mid[0] > 0 && r2.mid[0] < 12.34;
    ok(mono && near(r2.end, 12.34, 1e-6), 'setValue: плавная прокрутка до 12.34', r2.mid.join(' → '));
    ok(r2.v === 7.5 && r2.inst === 7.5, 'setValue(…, {instant}) — сразу');
    const r3 = await ev(() => { const c = window.T.c('traverse').cBearing; c.setValue(359.5, { instant: true }); c.setValue(0.5); window.T.step(0.05); const s = c.shown; window.T.step(3); return { s, end: c.shown }; });
    ok((r3.s > 359.5 || r3.s < 0.5) && near(r3.end, 0.5, 1e-6), 'wrap: 359.5 → 0.5 крутится через ноль', r3.s.toFixed(3));
  }

  // ================= рычаги =================
  console.log('рычаг');
  {
    await ev(() => window.T.go('computer'));
    const g = await ev(() => { const l = window.T.c('computer').leverCompute; return { top: window.T.scr(l.handle), pulls: window.T.c('computer').state.pulls }; });
    // длина хода на экране: спроецируем нижнее положение рукояти
    const geo = await ev(() => {
      const l = window.T.c('computer').leverCompute, o = l.object3D, L = l.handle.position.z, s = Math.sin(38 * Math.PI / 180), cz = Math.cos(38 * Math.PI / 180);
      const pz = l.handle.parent.position.z;
      return { up: window.T.scr(o, 0, L * s, pz + L * cz), down: window.T.scr(o, 0, -L * s, pz + L * cz) };
    });
    const full = [geo.down[0] - geo.up[0], geo.down[1] - geo.up[1]];
    // неполная протяжка (40 %) — не срабатывает
    await drag(line(g.top, [g.top[0] + full[0] * 0.4, g.top[1] + full[1] * 0.4], 8));
    await step(1);
    let s = await ev(() => ({ pulls: window.T.c('computer').state.pulls, t: window.T.c('computer').leverCompute.travel }));
    ok(s.pulls === g.pulls && near(s.t, 0, 0.01), 'momentary: неполная протяжка не вызывает onPull, рычаг вернулся', 'travel=' + s.t.toFixed(3));
    // касание — не срабатывает
    await tap(g.top[0], g.top[1]); await step(1);
    s = await ev(() => ({ pulls: window.T.c('computer').state.pulls }));
    ok(s.pulls === g.pulls, 'momentary: касание не вызывает onPull');
    // полная протяжка, с «дёрганьем» в конце — ровно один onPull
    const end = [g.top[0] + full[0] * 1.15, g.top[1] + full[1] * 1.15];
    await drag([...line(g.top, end, 12), ...line(end, [g.top[0] + full[0] * 0.95, g.top[1] + full[1] * 0.95], 3), ...line([g.top[0] + full[0] * 0.95, g.top[1] + full[1] * 0.95], end, 3)], { keep: true });
    s = await ev(() => ({ pulls: window.T.c('computer').state.pulls, t: window.T.c('computer').leverCompute.travel }));
    ok(s.pulls === g.pulls + 1 && s.t > 0.95, 'momentary: полная протяжка → onPull один раз', 'pulls=' + s.pulls + ', travel=' + s.t.toFixed(2));
    await p.mouse.up(); await step(1.2);
    s = await ev(() => ({ t: window.T.c('computer').leverCompute.travel, elev: window.T.c('computer').cElev.value }));
    ok(near(s.t, 0, 0.01), 'momentary: возврат пружиной', 'travel=' + s.t.toFixed(3));
    ok(s.elev > 0, 'рычаг «ВЫЧИСЛИТЬ» записал угол в счётчик', s.elev);
    await drag(line(g.top, end, 12)); await step(1.2);
    s = await ev(() => ({ pulls: window.T.c('computer').state.pulls }));
    ok(s.pulls === g.pulls + 2, 'momentary: второе протягивание → второй onPull');

    // toggle
    await ev(() => { window.T.go('traverse'); const c = window.T.c('traverse'); c.leverBrake.set(false); c.state.brake = true; window.T.step(1); });
    const tg = await ev(() => {
      const l = window.T.c('traverse').leverBrake, o = l.object3D, L = l.handle.position.z, sn = Math.sin(38 * Math.PI / 180), cz = Math.cos(38 * Math.PI / 180), pz = l.handle.parent.position.z;
      return { up: window.T.scr(o, 0, L * sn, pz + L * cz), down: window.T.scr(o, 0, -L * sn, pz + L * cz) };
    });
    await drag(line(tg.up, [tg.down[0], tg.down[1] + 6], 10)); await step(1);
    s = await ev(() => { const c = window.T.c('traverse'); return { on: c.leverBrake.on, brake: c.state.brake, t: c.leverBrake.travel }; });
    ok(s.on === true && s.brake === false && near(s.t, 1, 0.01), 'toggle: перетаскивание вниз → on, onChange(true)', 'travel=' + s.t.toFixed(2));
    await tap(tg.down[0], tg.down[1]); await step(1);
    s = await ev(() => { const c = window.T.c('traverse'); return { on: c.leverBrake.on, brake: c.state.brake, t: c.leverBrake.travel }; });
    ok(s.on === false && s.brake === true && near(s.t, 0, 0.01), 'toggle: касание переключает обратно', 'travel=' + s.t.toFixed(2));
    const silent = await ev(() => { const c = window.T.c('traverse'); c.leverBrake.set(true); window.T.step(1); return { on: c.leverBrake.on, brake: c.state.brake, t: c.leverBrake.travel }; });
    ok(silent.on === true && silent.brake === true && near(silent.t, 1, 0.01), 'toggle: set(true) без события onChange');
    await ev(() => { const c = window.T.c('traverse'); c.state.brake = false; });
  }

  // ================= рычаг привода =================
  console.log('рычаг привода');
  {
    const g = await ev(() => {
      const c = window.T.c('traverse'), l = c.slew; window.__slew = [];
      const st = window.__dev.stations.traverse, orig = st.update;
      st.update = function (dt, t) { window.__slew.push(c.state.slew); return orig.call(this, dt, t); };
      const L = l.handle.position.y;
      return { top: window.T.scr(l.handle), right: window.T.scr(l.object3D, L * Math.sin(32 * Math.PI / 180), L, 0.03), b0: c.state.bearing };
    });
    const dx = g.right[0] - g.top[0];
    await p.mouse.move(g.top[0], g.top[1]); await p.mouse.down();
    await p.mouse.move(g.top[0] + dx * 0.5, g.top[1]); await step(0.3);
    let s = await ev(() => { const c = window.T.c('traverse'); return { v: c.slew.value, st: c.state.slew, held: c.slew.held }; });
    ok(s.v > 0.3 && s.v < 0.7 && s.st === s.v && s.held, 'полхода вправо → onInput ≈ +0.5 каждый кадр', s.v.toFixed(3));
    await p.mouse.move(g.top[0] + dx * 3, g.top[1] + 5); await step(0.3);
    s = await ev(() => ({ v: window.T.c('traverse').slew.value }));
    ok(s.v === 1, 'за упор вправо → ровно +1', s.v);
    await p.mouse.move(g.top[0] - dx * 3, g.top[1]); await step(0.3);
    s = await ev(() => ({ v: window.T.c('traverse').slew.value }));
    ok(s.v === -1, 'за упор влево → ровно −1', s.v);
    await p.mouse.up();
    s = await ev(() => { const c = window.T.c('traverse'); return { v: c.slew.value, st: c.state.slew, pos: c.slew.position }; });
    ok(s.v === 0 && s.st === 0 && s.pos < -0.5, 'отпускание: onInput(0) сразу, рычаг ещё отклонён', 'pos=' + s.pos.toFixed(2));
    await step(1.5);
    s = await ev(() => { const c = window.T.c('traverse'); return { pos: c.slew.position, all: window.__slew, b: c.state.bearing, press: c.gPressure.value }; });
    ok(s.pos === 0, 'рычаг вернулся в ноль пружиной');
    ok(s.all.length > 20 && s.all.every(v => v >= -1 && v <= 1), 'все значения onInput в [−1, 1]', s.all.length + ' кадров');
    ok(s.b !== g.b0, 'привод повернул башню (slewLever → счётчик/прибор)', g.b0.toFixed(2) + ' → ' + s.b.toFixed(2));
  }

  // ================= галетный переключатель =================
  console.log('галетный переключатель');
  {
    await ev(() => window.T.go('computer'));
    const g = await ev(() => {
      const c = window.T.c('computer'), sel = c.selector, o = sel.object3D, R = 0.045;
      const pt = deg => { const a = deg * Math.PI / 180; return window.T.scr(o, Math.sin(a) * R * 0.8, Math.cos(a) * R * 0.8, 0.02); };
      const path = (a0, a1) => { const out = []; const n = Math.ceil(Math.abs(a1 - a0) / 3); for (let i = 0; i <= n; i++) out.push(pt(a0 + (a1 - a0) * i / n)); return out; };
      // положения: шаг 45°, value i ↔ угол (i − 2.5)·45°
      return { v: sel.value, fwd: path(-22.5, 67.5), back: path(67.5, -112.5), far: path(-112.5, 200), labels: [0, 1, 2, 3, 4, 5].map(i => window.T.scr(o, ...sel.labelPoint(i))), knob: window.T.scr(o, 0, 0, 0.03) };
    });
    ok(g.v === 2, 'начальное положение 2 (подпись «3»)');
    await drag(g.fwd); await step(0.6);
    let s = await ev(() => { const c = window.T.c('computer'); return { v: c.selector.value, st: c.state.charge }; });
    ok(s.v === 4 && s.st === 4, 'поворот на +90° по часовой → два щелчка вперёд (2 → 4)', s.v);
    await drag(g.back); await step(0.6);
    s = await ev(() => { const c = window.T.c('computer'); return { v: c.selector.value, st: c.state.charge }; });
    ok(s.v === 0 && s.st === 0, 'поворот на −180° → положение 0 (4 → 0)', s.v);
    await drag(g.far); await step(0.6);
    s = await ev(() => ({ v: window.T.c('computer').selector.value }));
    ok(s.v === 5, 'поворот дальше упора останавливается на последнем положении', s.v);
    for (const i of [1, 3, 0, 5]) {
      await tap(g.labels[i][0], g.labels[i][1]); await step(0.4);
      s = await ev(() => { const c = window.T.c('computer'); return { v: c.selector.value, st: c.state.charge }; });
      ok(s.v === i && s.st === i, 'касание подписи «' + (i + 1) + '» → положение ' + i);
    }
    await tap(g.knob[0], g.knob[1]); await step(0.4);
    s = await ev(() => ({ v: window.T.c('computer').selector.value, lamps: window.T.c('computer').chargeLamps.map(l => l.state) }));
    ok(s.v === 0, 'касание ручки → следующее положение (по кругу 5 → 0)');
    ok(s.lamps.some(Boolean) && s.lamps.some(x => !x), 'лампы зарядов отражают состояние', s.lamps.map(x => x ? 1 : 0).join(''));
  }

  // ================= кнопка =================
  console.log('кнопка');
  {
    await ev(() => window.T.go('loading'));
    const g = await ev(() => { const c = window.T.c('loading'); return { plus: window.T.scr(c.bPlus.object3D, 0, 0, 0.02), minus: window.T.scr(c.bMinus.object3D, 0, 0, 0.02), n: c.state.charges }; });
    await tap(g.plus[0], g.plus[1]);
    let s = await ev(() => ({ n: window.T.c('loading').state.charges }));
    ok(s.n === g.n + 1, 'короткое нажатие → onPress один раз', s.n);
    await p.mouse.move(g.minus[0], g.minus[1]); await p.mouse.down(); await step(0.3);
    s = await ev(() => ({ n: window.T.c('loading').state.charges, pressed: window.T.c('loading').bMinus.pressed }));
    ok(s.n === 0 && s.pressed, 'удержание < 0.4 с — повторов ещё нет');
    await p.mouse.up();
    await p.mouse.move(g.plus[0], g.plus[1]); await p.mouse.down();
    const seq = [];
    for (let i = 0; i < 6; i++) { await step(0.2); seq.push(await ev(() => window.T.c('loading').state.charges)); }
    await p.mouse.up(); await step(0.5);
    s = await ev(() => ({ n: window.T.c('loading').state.charges, shown: window.T.c('loading').cCharges.value, pressed: window.T.c('loading').bPlus.pressed }));
    ok(seq[0] === 1 && seq[2] > seq[1] && seq[5] >= 5, 'hold: автоповтор onPress при удержании', seq.join(','));
    const after = s.n; await step(0.5);
    s = await ev(() => ({ n: window.T.c('loading').state.charges, shown: window.T.c('loading').cCharges.value, pressed: window.T.c('loading').bPlus.pressed }));
    ok(s.n === after && !s.pressed && s.shown === s.n, 'после отпускания повторы прекращаются; счётчик = ' + s.n);
    const lit = await ev(() => { const b = window.T.c('fire').bAlarm; b.setLit(true); const a = b.lit; b.setLit(false); return a && !b.lit; });
    ok(lit, 'setLit(true/false)');
  }

  // ================= тумблер и крышка =================
  console.log('тумблер, крышка');
  {
    await ev(() => window.T.go('computer'));
    const g = await ev(() => { const t = window.T.c('computer').tFine, o = t.object3D; return { c: window.T.scr(o, 0, 0, 0.03), l: window.T.scr(o, -0.11, 0, 0), r: window.T.scr(o, 0.11, 0, 0) }; });
    await tap(g.c[0], g.c[1]);
    let s = await ev(() => { const c = window.T.c('computer'); return { v: c.tFine.value, st: c.state.fine }; });
    ok(s.v === 1 && s.st === 1, 'тумблер: касание переключает (0 → 1), onChange(1)');
    await tap(g.r[0], g.r[1]);
    s = await ev(() => ({ v: window.T.c('computer').tFine.value }));
    ok(s.v === 1, 'тумблер: касание подписи текущего положения ничего не меняет');
    await tap(g.l[0], g.l[1]);
    s = await ev(() => { const c = window.T.c('computer'); return { v: c.tFine.value, st: c.state.fine }; });
    ok(s.v === 0 && s.st === 0, 'тумблер: касание подписи «ГРУБО» → 0');
    await drag(line(g.c, [g.c[0] + 30, g.c[1]], 5));
    s = await ev(() => ({ v: window.T.c('computer').tFine.value }));
    ok(s.v === 1, 'тумблер: перетаскивание вправо → 1');
    await drag(line(g.c, [g.c[0] - 30, g.c[1]], 5));
    s = await ev(() => ({ v: window.T.c('computer').tFine.value }));
    ok(s.v === 0, 'тумблер: перетаскивание влево → 0');

    await ev(() => window.T.go('fire'));
    const f = await ev(() => { const c = window.T.c('fire'); return { t: window.T.scr(c.tArm.object3D, 0, 0, 0.04), open: c.guard.open, armed: c.state.armed, en: c.tArm.enabled }; });
    ok(f.open === false && f.en === false, 'крышка закрыта, тумблер под ней заблокирован');
    await tap(f.t[0], f.t[1]); await step(0.8);
    s = await ev(() => { const c = window.T.c('fire'); return { open: c.guard.open, armed: c.state.armed, v: c.tArm.value }; });
    ok(s.open === true && s.armed === false && s.v === 0, 'касание по закрытой крышке открывает её, тумблер не тронут');
    await tap(f.t[0], f.t[1]); await step(0.5);
    s = await ev(() => { const c = window.T.c('fire'); return { open: c.guard.open, armed: c.state.armed, v: c.tArm.value, lamp: c.ready[4].state }; });
    ok(s.open === true && s.armed === true && s.v === 1 && s.lamp === 'blink', 'крышка открыта → тумблер «ЦЕПЬ» взводится, лампа мигает');
    // спуск: выстрел
    const tr = await ev(() => {
      const l = window.T.c('fire').trigger, o = l.object3D, L = l.handle.position.z, sn = Math.sin(38 * Math.PI / 180), cz = Math.cos(38 * Math.PI / 180), pz = l.handle.parent.position.z;
      return { up: window.T.scr(o, 0, L * sn, pz + L * cz), down: window.T.scr(o, 0, -L * sn, pz + L * cz) };
    });
    await drag(line(tr.up, [tr.down[0], tr.down[1] + 8], 10)); await step(0.1);
    s = await ev(() => { const c = window.T.c('fire'); return { shots: c.state.shots, cam: window.__dev.engine.camera.position.toArray() }; });
    await step(2);
    const cam2 = await ev(() => window.__dev.engine.camera.position.toArray());
    ok(s.shots === 1, 'спуск при взведённой цепи → выстрел');
    ok(Math.hypot(s.cam[0] - cam2[0], s.cam[1] - cam2[1], s.cam[2] - cam2[2]) > 0.002, 'shake(): камера тряслась и успокоилась');
    // закрыть крышку: касание по откинутой крышке
    const lid = await ev(() => { const c = window.T.c('fire'); return window.T.scr(c.guard.lid, 0, -0.07, 0.05); });
    await tap(lid[0], lid[1]); await step(0.8);
    s = await ev(() => { const c = window.T.c('fire'); return { open: c.guard.open, armed: c.state.armed, en: c.tArm.enabled }; });
    ok(s.open === false && s.armed === false && s.en === false, 'касание по откинутой крышке закрывает её (цепь снята)');
    const dr = await ev(() => { const c = window.T.c('fire'); return window.T.scr(c.guard.object3D, 0, -0.03, 0.1); });
    await drag(line(dr, [dr[0], dr[1] - 40], 5)); await step(0.8);
    s = await ev(() => ({ open: window.T.c('fire').guard.open }));
    ok(s.open === true, 'крышка: перетаскивание вверх открывает');
    await ev(() => { window.T.c('fire').guard.set(false); window.T.step(0.8); });
  }

  // ================= ввод только у текущего поста =================
  console.log('посты и ввод');
  {
    await ev(() => { window.T.go('plot'); window.__dev.engine.setCameraPose({ position: [0, 1.55, 2.3], target: [0, 1.25, 0], fov: 62 }, 0); window.T.step(0.1); });
    const g = await ev(() => {
      const e = window.__dev.engine, w = window.T.c('computer').wRange, H = w.wheel.position.z, r = w.radius * 0.8, pts = [];
      for (let a = 0; a <= 120; a += 6) { const f = (90 - a) * Math.PI / 180; pts.push(window.T.scr(w.object3D, r * Math.cos(f), r * Math.sin(f), H)); }
      const w2 = window.T.c('plot').wRange, pts2 = [], H2 = w2.wheel.position.z;
      for (let a = 0; a <= 120; a += 6) { const f = (90 - a) * Math.PI / 180; pts2.push(window.T.scr(w2.object3D, r * Math.cos(f), r * Math.sin(f), H2)); }
      return { pts, pts2, a: w.angle, a2: w2.angle, vis: window.__dev.stations.computer.group.visible, far: window.__dev.stations.traverse.group.visible };
    });
    const onScreen = g.pts.every(q => q[0] > 0 && q[0] < 844 && q[1] > 0 && q[1] < 390);
    ok(g.vis === true && g.far === false, 'соседний пост виден, дальний скрыт');
    ok(onScreen, 'маховик соседнего поста в кадре (общий вид)');
    await drag(g.pts);
    let s = await ev(() => ({ a: window.T.c('computer').wRange.angle }));
    ok(s.a === g.a, 'ввод у соседнего (не текущего) поста игнорируется');
    await drag(g.pts2);
    s = await ev(() => ({ a: window.T.c('plot').wRange.angle }));
    ok(near(s.a - g.a2, 120 * Math.PI / 180, 0.05), 'тот же жест у текущего поста работает (и в доп. виде камеры)', ((s.a - g.a2) * 180 / Math.PI).toFixed(1) + '°');
    await ev(() => { window.__dev.engine.setCameraPose(null, 0); window.T.step(0.1); });
  }

  // ================= перелёт =================
  {
    const r = await ev(() => {
      const e = window.__dev.engine, log = window.__dev.log; log.length = 0; window.T.events.length = 0;
      const cam0 = e.camera.position.toArray();
      let resolved = null; e.gotoStation('computer').then(v => { resolved = v; });
      const flying0 = e.flying, cur = e.current, logNow = log.slice();
      window.T.step(0.35);
      const mid = e.camera.position.toArray(), flyingMid = e.flying, visMid = [e.getStation('plot').group.visible, e.getStation('computer').group.visible];
      window.__res = () => resolved;
      return { cam0, mid, flying0, flyingMid, cur, logNow, visMid };
    });
    ok(r.cur === 'computer' && r.logNow.join(',') === 'leave:plot,enter:computer,station:computer', 'gotoStation: onLeave → onEnter → событие station', r.logNow.join(','));
    ok(r.flying0 && r.flyingMid, 'камера в полёте (engine.flying)');
    const radMid = Math.hypot(r.mid[0], r.mid[2]);
    ok(radMid > 0.5 && radMid < 1.1 && r.visMid[0] && r.visMid[1], 'траектория — по дуге вокруг центра, оба поста видны', 'радиус в середине ' + radMid.toFixed(2) + ' м');
    // во время полёта органы не реагируют
    const w = await ev(() => { const c = window.T.c('computer'); return { p: window.T.scr(c.tFine.object3D, 0, 0, 0.03), v: c.tFine.value }; });
    await tap(w.p[0], w.p[1]);
    let s = await ev(() => ({ v: window.T.c('computer').tFine.value }));
    ok(s.v === w.v, 'во время перелёта касания органов игнорируются');
    await step(0.6); await p.waitForTimeout(20);
    s = await ev(() => { const e = window.__dev.engine; return { flying: e.flying, cam: e.camera.position.toArray(), ev: window.T.events.slice(), res: window.__res(), want: e.stationToWorld('computer', [0, 1.42, 1.25]).toArray() }; });
    ok(!s.flying && s.res === true && s.ev.join(',') === 'station:computer,arrive:computer', 'перелёт завершён за ~0.7 с: Promise и событие arrive', s.ev.join(','));
    ok(Math.hypot(s.cam[0] - s.want[0], s.cam[1] - s.want[1], s.cam[2] - s.want[2]) < 1e-6, 'камера встала в позу поста');
    // дополнительный вид и возврат
    s = await ev(() => { const e = window.__dev.engine; e.setCameraPose({ position: [0.3, 1.2, 0.8], target: [0.3, 0.95, 0], fov: 30 }, 0.3); window.T.step(0.5); const a = e.camera.position.toArray(), f = e.camera.fov, w = e.stationToWorld('computer', [0.3, 1.2, 0.8]).toArray(); e.setCameraPose(null, 0.3); window.T.step(0.5); return { d: Math.hypot(a[0] - w[0], a[1] - w[1], a[2] - w[2]), f, f2: e.camera.fov }; });
    ok(s.d < 1e-6 && near(s.f, 30, 1e-6) && near(s.f2, 46, 1e-6), 'setCameraPose(pose, t) и setCameraPose(null) работают');
  }

  // ================= свайп =================
  console.log('свайп');
  {
    await ev(() => { window.T.events.length = 0; });
    // пустое место — панель без органов (правый верхний угол пульта)
    const empty = [640, 70];
    await drag(line(empty, [empty[0] - 160, empty[1] + 10], 6));
    let s = await ev(() => window.T.events.slice());
    ok(s.filter(x => x.startsWith('swipe')).join(',') === 'swipe:1' && s.includes('station:loading'), 'свайп влево по пустому месту → swipe(+1), стенд перешёл к следующему посту', s.join(','));
    await ev(() => { window.T.step(1.2); window.T.events.length = 0; });
    await drag(line([300, 70 + 0], [470, 75], 6));
    s = await ev(() => window.T.events.slice());
    ok(s.filter(x => x.startsWith('swipe')).join(',') === 'swipe:-1' && s.includes('station:computer'), 'свайп вправо → swipe(−1), возврат к предыдущему посту', s.join(','));
    await ev(() => { window.T.step(1.2); window.T.go('computer'); window.T.events.length = 0; });
    await drag(line(empty, [empty[0] - 40, empty[1]], 4));
    await drag(line(empty, [empty[0] + 5, empty[1] + 150], 6));
    s = await ev(() => window.T.events.slice());
    ok(s.length === 0, 'короткое или вертикальное движение — не свайп');
    const w = await ev(() => { const c = window.T.c('computer'); return { p: window.T.scr(c.wRange.object3D, 0, 0.1, c.wRange.wheel.position.z), a: c.wRange.angle }; });
    await drag(line(w.p, [w.p[0] + 170, w.p[1]], 8));
    s = await ev(() => ({ ev: window.T.events.slice(), a: window.T.c('computer').wRange.angle, cur: window.__dev.engine.current }));
    ok(s.ev.length === 0 && s.cur === 'computer' && s.a !== w.a, 'перетаскивание, начатое на органе, свайпом не считается (маховик повернулся)');
  }

  // ================= мультитач =================
  console.log('мультитач');
  {
    const g = await ev(() => {
      const w = window.T.c('computer').wRange, H = w.wheel.position.z, r = w.radius * 0.8, pts = [];
      for (let a = 0; a <= 180; a += 5) { const f = (90 - a) * Math.PI / 180; pts.push(window.T.scr(w.object3D, r * Math.cos(f), r * Math.sin(f), H)); }
      return { pts, a: w.angle, t: window.T.scr(window.T.c('computer').tFine.object3D, 0, 0, 0.03), tv: window.T.c('computer').tFine.value };
    });
    const half = Math.floor(g.pts.length / 2);
    await p.mouse.move(g.pts[0][0], g.pts[0][1]); await p.mouse.down();
    for (let i = 1; i <= half; i++) await p.mouse.move(g.pts[i][0], g.pts[i][1]);
    // второй палец: касание тумблера во время вращения
    await ev(([x, y]) => {
      const cv = window.__dev.engine.canvas, mk = (type) => new PointerEvent(type, { pointerId: 77, pointerType: 'touch', isPrimary: false, clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: 1 });
      cv.dispatchEvent(mk('pointerdown')); cv.dispatchEvent(mk('pointermove')); cv.dispatchEvent(mk('pointerup')); cv.dispatchEvent(mk('pointercancel'));
    }, g.t);
    for (let i = half + 1; i < g.pts.length; i++) await p.mouse.move(g.pts[i][0], g.pts[i][1]);
    await p.mouse.up();
    const s = await ev(() => ({ a: window.T.c('computer').wRange.angle, tv: window.T.c('computer').tFine.value, busy: window.__dev.engine.input.busy }));
    ok(near(s.a - g.a, Math.PI, 0.03), 'второй палец не ломает перетаскивание маховика', ((s.a - g.a) * 180 / Math.PI).toFixed(1) + '°');
    ok(s.tv === g.tv && !s.busy, 'второй палец во время перетаскивания игнорируется');
    // настоящая отмена касания
    const c0 = await ev(() => window.T.c('computer').wRange.turning);
    await p.mouse.move(g.pts[0][0], g.pts[0][1]); await p.mouse.down();
    await ev(() => { const cv = window.__dev.engine.canvas; cv.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', bubbles: true })); });
    const c1 = await ev(() => ({ t: window.T.c('computer').wRange.turning, busy: window.__dev.engine.input.busy }));
    await p.mouse.up();
    ok(c0 === false && c1.t === false && c1.busy === false, 'pointercancel корректно завершает перетаскивание');
  }

  // ================= прочее =================
  console.log('прочее');
  {
    const r = await ev(() => {
      const e = window.__dev.engine, out = {};
      out.matCache = e.mat.paint('#3d4a57') === e.mat.paint('#3d4a57', { wear: 0.5 }) && e.mat.steel === e.mat.steel && e.mat.emissive('#ff0000', 2) === e.mat.emissive(0xff0000, 2) && e.mat.paint('#3d4a57') !== e.mat.paint('#2b343d');
      out.mats = ['steel', 'darkSteel', 'nickel', 'bakelite', 'ivory', 'copper', 'rubber', 'glass', 'ochre', 'floor', 'wall'].every(k => e.mat[k] && e.mat[k].isMaterial);
      out.ui = ['panel', 'plate', 'handwheel', 'drumCounter', 'lamp', 'lever', 'slewLever', 'rotarySelector', 'gauge', 'pushButton', 'toggle', 'cover', 'pipe', 'cageLamp', 'rivetRow', 'cable'].filter(k => typeof e.ui[k] !== 'function');
      out.audio = ['tick', 'ratchet', 'clunk', 'leverPull', 'switchFlip', 'buzz', 'servo', 'hoist', 'ram', 'breech', 'fire', 'impactFar', 'radio', 'alarm', 'ambient', 'setMuted'].filter(k => typeof e.audio[k] !== 'function');
      let threw = null;
      try { for (const k of ['tick', 'ratchet', 'clunk', 'leverPull', 'switchFlip', 'buzz', 'hoist', 'ram', 'breech', 'fire', 'impactFar', 'radio']) e.audio[k](); e.audio.servo(0.5); e.audio.servo(0); e.audio.alarm(true); e.audio.alarm(false); e.audio.ambient(true); e.audio.ambient(false); e.audio.setMuted(true); e.audio.setMuted(false); } catch (err) { threw = String(err); }
      out.threw = threw; out.audioReady = e.audio.ready;
      const g = e.ui.gauge({ min: 0, max: 100 }); g.setValue(100); const mids = []; for (let i = 0; i < 8; i++) { window.T.step(0.04); mids.push(+g.shown.toFixed(1)); } window.T.step(2);
      g.setBug(50); g.setBug(null); out.gauge = { mids, end: g.shown }; g.dispose();
      const pl = e.ui.plate('проба', { style: 'ivory' }); out.plate = pl.text + '|' + (pl.w > 0.05); pl.setText('другой'); out.plate2 = pl.text; pl.dispose();
      const pp = e.input.planePoint({ ray: new e.THREE.Ray(new e.THREE.Vector3(0, 0, 5), new e.THREE.Vector3(0, 0, -1)) }, new e.THREE.Vector3(0, 0, 1), new e.THREE.Vector3(0, 0, 1));
      out.plane = pp && pp.z === 1;
      return out;
    });
    ok(r.matCache && r.mats, 'engine.mat: все материалы есть, одинаковые вызовы → один объект');
    ok(r.ui.length === 0, 'engine.ui: все 16 фабрик на месте', r.ui.join(','));
    ok(r.audio.length === 0 && r.threw === null, 'engine.audio: все функции есть и не бросают исключений', 'контекст создан: ' + r.audioReady);
    ok(r.gauge.mids[0] > 0 && r.gauge.mids[0] < 60 && near(r.gauge.end, 100, 0.01), 'gauge: стрелка идёт к значению с демпфированием (лёгкий переброс)', r.gauge.mids.join(' → '));
    ok(r.plate === 'проба|true' && r.plate2 === 'другой', 'plate.setText');
    ok(r.plane === true, 'input.planePoint');
  }

  ok(problems.length === 0, 'нет ошибок и предупреждений в консоли за весь тест', problems.join(' | ') || undefined);
  console.log('\nИТОГО: ' + passed + ' пройдено, ' + failed + ' провалено');
  await b.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
