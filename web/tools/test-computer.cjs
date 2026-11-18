// Тест взаимодействия поста «ВЫЧИСЛИТЕЛЬ»: настоящие события указателя по экранным координатам органов.
//   cd web && node build.mjs --dev st-computer && node tools/test-computer.cjs [--w 844 --h 390] [--shots <каталог>]
// Цикл движка остановлен, кадры идут вручную (engine.debug.step) — тест не зависит от скорости программного WebGL.
// Код возврата ≠ 0 при любой неудаче, ошибке страницы или предупреждении в консоли.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const opt = { w: 844, h: 390, shots: '' };
for (let i = 0; i < args.length; i++) if (args[i].startsWith('--')) { const k = args[i].slice(2); opt[k] = k === 'shots' ? args[++i] : Number(args[++i]); }

let failed = 0, passed = 0;
const check = (cond, msg, extra) => {
  if (cond) { passed++; console.log('  ok   ' + msg); } else { failed++; console.log('  FAIL ' + msg + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};
const near = (a, b, eps) => Math.abs(a - b) <= eps;

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: opt.w, height: opt.h }, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  const problems = [];
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.type() + ': ' + m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '..', '.dev', 'st-computer', 'index.html'));
  await page.waitForFunction('window.__dev && window.__dev.stations', null, { timeout: 180000 });

  // ---- помощники на странице ----
  await page.evaluate(() => {
    const { engine, game, stations } = window.__dev;
    const st = stations.find(s => s.id === 'computer');
    engine.stop();
    const T = engine.THREE;
    const t = { denied: [], computed: 0 };
    game.on('denied', d => t.denied.push(d));
    game.on('computed', () => t.computed++);
    t.step = (n = 1, dt = 0.05) => { for (let i = 0; i < n; i++) engine.debug.step(dt, false); };
    t.render = () => engine.debug.step(0.0001, true);
    /** Экранные координаты точки [x,y,z], заданной в локальных координатах объекта. */
    t.scr = (obj, p = [0, 0, 0]) => {
      obj.updateWorldMatrix(true, false);
      const w = obj.localToWorld(new T.Vector3(p[0], p[1], p[2]));
      const s = engine.input.toScreen(w);
      return { x: s.x, y: s.y };
    };
    t.hot = (name, p) => t.scr(st.hotspots[name], p);
    t.snap = () => {
      const c = st.controls, cp = game.state.computer;
      return {
        phase: game.state.phase, range: cp.range, charge: cp.charge, elevation: cp.elevation, tof: cp.tof, stale: cp.stale,
        fine: c.fine.value, selector: c.selector.value, computing: c.computing, leverTravel: c.lever.travel,
        cRange: c.cRange.value, cElev: c.cElev.value, cTof: c.cTof.value, cRepeat: c.cRepeat.value,
        shElev: c.shutters.elevation.closed, shTof: c.shutters.tof.closed, shRepeat: c.shutters.repeater.closed,
        ready: c.lampReady.state, staleLamp: c.lampStale.state, out: c.lampOut.state, busy: c.lampBusy.state,
        chargeLamps: c.chargeLamps.map(l => l.state), denied: t.denied.length, computed: t.computed,
        lastDenied: t.denied[t.denied.length - 1] || null,
      };
    };
    t.st = st;
    window.__t = t;
    t.step(4);
  });
  const ev = (js) => page.evaluate(js);
  const snap = () => ev('window.__t.snap()');
  const step = (n = 1, dt = 0.05) => ev(`window.__t.step(${n}, ${dt})`);
  const hot = (name, p) => ev(`window.__t.hot(${JSON.stringify(name)}, ${JSON.stringify(p || [0, 0, 0])})`);
  const tap = async (pt) => { await page.mouse.move(pt.x, pt.y); await page.mouse.down(); await page.mouse.up(); await step(2); };
  let shotN = 0;
  const shot = async (name) => {
    if (!opt.shots) return;
    fs.mkdirSync(opt.shots, { recursive: true });
    await ev('window.__t.render()');
    await page.waitForTimeout(150);
    const file = path.join(opt.shots, String(++shotN).padStart(2, '0') + '-' + name + '-' + opt.w + 'x' + opt.h + '.png');
    await page.screenshot({ path: file });
    console.log('  shot ' + file);
  };
  /** Повернуть маховик дальности на turns оборотов (+ по часовой для игрока) настоящим круговым движением. */
  const turnWheel = async (turns, stepsPerTurn = 48) => {
    const pts = await ev(`(() => { const t = window.__t, o = t.st.controls.wheel.object3D, r = t.st.controls.wheel.radius * 0.8, out = [];
      const n = Math.max(2, Math.round(Math.abs(${turns}) * ${stepsPerTurn}));
      for (let i = 0; i <= n; i++) { const a = Math.PI / 2 - (${turns}) * 2 * Math.PI * i / n; out.push(t.scr(o, [Math.cos(a) * r, Math.sin(a) * r, 0.03])); }
      return out; })()`);
    await page.mouse.move(pts[0].x, pts[0].y);
    await page.mouse.down();
    for (let i = 1; i < pts.length; i++) await page.mouse.move(pts[i].x, pts[i].y);
    await page.mouse.up();
    await step(3);
  };
  /** Протянуть рычаг «ВЫЧИСЛИТЬ» вниз до упора и отпустить. */
  const pullLever = async (holdMoves = 0) => {
    const p = await hot('computeLever');
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    for (let i = 1; i <= 14; i++) await page.mouse.move(p.x, p.y + i * 12);
    for (let i = 0; i < holdMoves; i++) await page.mouse.move(p.x + (i % 2), p.y + 14 * 12);
    const s = await snap();
    await page.mouse.up();
    return s;
  };

  // ================================================================== 1. исходное состояние
  console.log('1. исходное состояние');
  let s = await snap();
  check(s.phase === 'playing', 'идёт задание', s.phase);
  check(s.range === 5 && s.charge === 1 && s.elevation === null, 'входы по умолчанию: 5.00 км, заряд 1, решения нет', s);
  check(near(s.cRange, 5, 1e-6), 'счётчик «ДАЛЬНОСТЬ, КМ» = 5.00', s.cRange);
  check(s.shElev && s.shTof, 'счётчики результата закрыты шторками «НЕТ РЕШЕНИЯ»');
  check(s.shRepeat, 'репитер замера пуст («НЕТ ЗАМЕРА»)');
  check(!s.ready && !s.staleLamp && !s.out, 'лампы состояния погашены', [s.ready, s.staleLamp, s.out]);
  check(s.chargeLamps.every(l => l === 'ok'), 'на 5.00 км все шесть зарядов достают (зелёные)', s.chargeLamps);
  const keys = await ev('Object.keys(window.__t.st.hotspots)');
  check(['rangeWheel', 'fineToggle', 'chargeSelector', 'computeLever', 'chargeLamp1', 'chargeLamp6'].every(k => keys.includes(k)), 'hotspots на месте', keys);
  // всё интерактивное — в зоне управления (верх 40 px, низ 56 px)
  const zone = await ev(`(() => { const t = window.__t, c = t.st.controls, out = {};
    const add = (k, o, pts) => { out[k] = pts.map(p => t.scr(o, p)); };
    const r = c.wheel.radius; add('wheel', c.wheel.object3D, [[-r, 0, 0], [r, 0, 0], [0, r, 0], [0, -r, 0]]);
    add('toggle', c.fine.object3D, [[0, 0.09, 0], [0, -0.09, 0]]);
    add('selector', c.selector.object3D, [0, 1, 2, 3, 4, 5].map(i => c.selector.labelPoint(i)));
    add('lamps', t.st.group, []); out.lamps = c.chargeLamps.map(l => t.scr(l.object3D));
    add('lever', c.lever.object3D, [[0, 0.1, 0.24], [0, -0.1, 0.24], [0, -0.12, 0]]); out.lever.push(t.hot('computeLever', [0.06, 0, 0]), t.hot('computeLever', [-0.06, 0, 0]));
    add('counters', t.st.group, []); out.counters = [c.cRange, c.cElev, c.cTof, c.cRepeat, c.lampReady, c.lampStale, c.lampOut].map(x => t.scr(x.object3D));
    return out; })()`);
  for (const [k, pts] of Object.entries(zone)) {
    const bad = pts.filter(p => p.x < 6 || p.x > opt.w - 6 || p.y < 44 || p.y > opt.h - 58);
    check(bad.length === 0, 'в зоне управления: ' + k, bad);
  }
  await shot('initial');

  // ================================================================== 2. маховик дальности
  console.log('2. маховик «ДАЛЬНОСТЬ» и тумблер «ГРУБО/ТОЧНО»');
  await turnWheel(1);
  s = await snap();
  check(near(s.range, 6, 0.04), 'ГРУБО: оборот по часовой = +1 км', s.range);
  await turnWheel(-0.5);
  s = await snap();
  check(near(s.range, 5.5, 0.06), 'ГРУБО: пол-оборота против часовой = −0.5 км', s.range);
  await tap(await hot('fineToggle'));
  s = await snap();
  check(s.fine === 1, 'касание тумблера → ТОЧНО', s.fine);
  const r0 = s.range;
  await turnWheel(1, 180);                                  // 2° на шаг = 0.0006 км: без накопления дробной части ход бы пропал
  s = await snap();
  check(near(s.range - r0, 0.1, 0.011), 'ТОЧНО: медленный оборот = +0.10 км (дробная часть копится)', +(s.range - r0).toFixed(3));
  await turnWheel(-2, 60);
  s = await snap();
  check(near(s.range - r0, -0.1, 0.012), 'ТОЧНО: два оборота назад = −0.20 км', +(s.range - r0).toFixed(3));
  await step(30);
  s = await snap();
  check(near(s.cRange, s.range, 1e-6), 'счётчик дальности следует за state.computer.range', [s.cRange, s.range]);
  await tap(await hot('fineToggle'));
  s = await snap();
  check(s.fine === 0, 'второе касание → ГРУБО', s.fine);
  // упор шкалы: ниже RANGE_MIN не уходит и отказов не шлёт
  await ev('window.__dev.game.setComputerRange(0.3)');
  await turnWheel(-1);
  s = await snap();
  check(near(s.range, 0.01, 1e-6) && s.denied === 0, 'нижний упор 0.01 км без отказов', [s.range, s.denied]);
  await ev('window.__dev.game.setComputerRange(5)');
  await step(2);

  // ================================================================== 3. галетник заряда и лампы
  console.log('3. галетник «ЗАРЯД» и лампы зарядов');
  const labelPt = (i) => ev(`(() => { const t = window.__t, c = t.st.controls.selector; return t.scr(c.object3D, c.labelPoint(${i})); })()`);
  await tap(await labelPt(3));
  s = await snap();
  check(s.charge === 4 && s.selector === 3, 'касание цифры 4 → заряд 4', [s.charge, s.selector]);
  await tap(await hot('chargeSelector', [0, 0, 0.03]));
  s = await snap();
  check(s.charge === 5, 'касание ручки → следующее положение (5)', s.charge);
  await tap(await hot('chargeLamp2'));
  s = await snap();
  check(s.charge === 2 && s.selector === 1, 'касание лампы 2 → заряд 2, галетник повернулся', [s.charge, s.selector]);
  // перетаскивание ручки галетника к положению 6
  {
    const c0 = await hot('chargeSelector', [0, 0, 0.03]);
    const from = await labelPt(1), to = await labelPt(5);
    const k = 0.55, P = (q) => ({ x: c0.x + (q.x - c0.x) * k, y: c0.y + (q.y - c0.y) * k });
    const a = P(from), b = P(to);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    for (let i = 1; i <= 16; i++) {
      // по дуге через верх (положения 3–4)
      const mid = await labelPt(2 + Math.min(3, Math.floor(i / 4)));
      const m = P(mid);
      await page.mouse.move(m.x, m.y);
    }
    await page.mouse.move(b.x, b.y); await page.mouse.up(); await step(2);
    s = await snap();
    check(s.charge === 6, 'перетаскивание ручки → заряд 6', s.charge);
  }
  await ev('window.__dev.game.setComputerRange(9.5)'); await step(2);
  s = await snap();
  const expectStates = await ev('window.__dev.game.chargeStates()');
  check(JSON.stringify(s.chargeLamps) === JSON.stringify(expectStates) && s.chargeLamps.includes('out') && s.chargeLamps.includes('ok'),
    'лампы зарядов = game.chargeStates() на 9.50 км', [s.chargeLamps, expectStates]);
  check(s.denied === 0, 'до сих пор ни одного отказа', s.lastDenied);

  // ================================================================== 4. расчёт
  console.log('4. рычаг «ВЫЧИСЛИТЬ»: успешный расчёт');
  await ev('window.__dev.game.setComputerRange(7.55); window.__dev.game.setComputerCharge(3)'); await step(2);
  // касание без протяжки расчёт не запускает
  await tap(await hot('computeLever'));
  s = await snap();
  check(s.computed === 0 && s.elevation === null, 'касание рычага без протяжки расчёт не запускает', s.computed);
  await step(20);
  let held = await pullLever(6);
  check(held.computed === 1 && held.elevation !== null, 'протяжка рычага вниз → game.compute() ровно один раз (удержание не повторяет)', [held.computed, held.elevation]);
  check(held.computing, 'идёт «счёт» (механизм крутится)');
  await step(1);
  s = await snap();
  check(s.busy === true && s.shElev && !s.ready, 'во время счёта: лампа «СЧЁТ» горит, результат ещё закрыт, «ГОТОВО» не горит', [s.busy, s.shElev, s.ready]);
  await shot('computing');
  await step(10);                                            // 0.55 с — всё ещё считает
  s = await snap();
  check(s.computing && s.shElev, 'через 0.5 с всё ещё считает', s.computing);
  await step(16);                                            // всего ≈1.35 с
  s = await snap();
  check(!s.computing && !s.shElev && !s.shTof, 'через ~1.2 с счёт окончен, шторки открываются', [s.computing, s.shElev]);
  await step(60);
  s = await snap();
  const sol = await ev('window.__dev.game.solve(7.55, 3)');
  check(near(s.cElev, sol.elevation, 1e-6) && near(s.cTof, sol.tof, 1e-6), 'счётчики показывают угол и время полёта из game.state', [s.cElev, s.cTof, sol]);
  check(s.ready === true && !s.staleLamp && !s.out && !s.busy, 'горит «ГОТОВО», остальные погашены', [s.ready, s.staleLamp, s.out, s.busy]);
  check(s.leverTravel < 0.05, 'рычаг вернулся вверх', s.leverTravel);
  check((await ev('window.__dev.game.state.checklist.computed')) === true, 'checklist.computed = true');
  await shot('ready');

  console.log('5. «УСТАРЕЛО»');
  await turnWheel(0.25);
  s = await snap();
  check(s.stale === true && s.staleLamp === true && !s.ready, 'поворот маховика после расчёта → «УСТАРЕЛО»', [s.stale, s.staleLamp, s.ready]);
  check(!s.shElev && near(s.cElev, sol.elevation, 1e-6), 'старый результат остаётся на счётчиках', s.cElev);
  await shot('stale');
  await pullLever(); await step(40); await step(40);
  s = await snap();
  check(s.computed === 2 && s.ready === true && !s.staleLamp && near(s.cElev, s.elevation, 1e-6), 'повторный расчёт → снова «ГОТОВО»', [s.computed, s.ready, s.cElev, s.elevation]);

  // ================================================================== 6. отказ
  console.log('6. «ВНЕ ДАЛЬНОСТИ» и отказ расчёта');
  await tap(await hot('chargeLamp1'));
  await ev('window.__dev.game.setComputerRange(15)'); await step(3);
  s = await snap();
  check(s.charge === 1 && s.out === true && s.staleLamp === true, 'заряд 1 на 15 км: горит «ВНЕ ДАЛЬНОСТИ» (и «УСТАРЕЛО»)', [s.charge, s.out, s.staleLamp]);
  check(s.chargeLamps[0] === 'out' && s.chargeLamps[5] === 'ok', 'лампа заряда 1 красная, заряда 6 зелёная', s.chargeLamps);
  const d0 = s.denied;
  held = await pullLever(8);
  await step(3);
  s = await snap();
  check(s.denied === d0 + 1 && s.lastDenied.action === 'compute', 'протяжка рычага → ровно один отказ compute', [s.denied - d0, s.lastDenied]);
  check(s.elevation === null && s.shElev && s.shTof && !s.ready && !s.staleLamp && !s.computing, 'решение сброшено: «НЕТ РЕШЕНИЯ», «ГОТОВО»/«УСТАРЕЛО» погашены', s);
  check(s.out === 'blink' || s.out === true, 'красная лампа «ВНЕ ДАЛЬНОСТИ» горит/мигает', s.out);
  await step(8);
  await shot('out-of-range');
  await step(60);
  s = await snap();
  check(s.denied === d0 + 1, 'без новых действий отказы не повторяются', s.denied - d0);
  await tap(await hot('chargeLamp6')); await step(2);
  s = await snap();
  check(s.charge === 6 && s.out === false, 'заряд 6 достаёт: «ВНЕ ДАЛЬНОСТИ» гаснет', [s.charge, s.out]);

  // ================================================================== 7. репитер замера
  console.log('7. репитер «ЗАМЕР: ДАЛЬНОСТЬ»');
  const rec = await ev(`(() => { const g = window.__dev.game, s = g.state; const t = s.targets.find(x => x.reported) || null;
    if (!t) return null; g.selectTarget(t.id); g.setAlidade({ bearing: 41.5, range: 8.37 }); const r = g.recordMeasurement(); return { id: t.id, ok: r.ok, rec: s.plot.recorded[t.id] }; })()`);
  if (rec && rec.ok) {
    await step(40);
    s = await snap();
    check(!s.shRepeat && near(s.cRepeat, 8.37, 1e-6), 'репитер показывает записанную дальность 8.37', [s.shRepeat, s.cRepeat]);
    await shot('repeater');
  } else {
    check(false, 'не удалось записать замер (нет сообщённой цели?)', rec);
  }

  // ================================================================== 8. новое задание, меню
  console.log('8. перезапуск задания и другие фазы');
  await ev('window.__dev.game.startMission(2)'); await step(3);
  s = await snap();
  check(s.phase === 'briefing' && s.range === 5 && s.charge === 1 && s.elevation === null, 'брифинг нового задания: состояние сброшено', s);
  check(near(s.cRange, 5, 1e-6) && s.selector === 0 && s.shElev && s.shRepeat && !s.ready && !s.out, 'приборы перечитали новое состояние', s);
  await ev('window.__dev.game.begin()'); await step(2);
  await turnWheel(2);
  s = await snap();
  check(near(s.range, 7, 0.05), 'после перезапуска маховик работает с новым state.computer', s.range);
  await tap(await labelPt(2));
  await pullLever(); await step(40); await step(30);
  s = await snap();
  check(s.elevation !== null && s.ready === true && near(s.cElev, s.elevation, 1e-6), 'расчёт в новом задании', [s.elevation, s.ready, s.cElev]);
  await ev('window.__dev.game.quit()'); await step(10);
  s = await snap();
  check(s.phase === 'menu', 'выход в меню без ошибок', s.phase);
  await ev('window.__dev.game.startMission(0); window.__dev.game.begin()'); await step(10);
  s = await snap();
  check(s.phase === 'playing' && s.elevation === null && s.shElev, 'снова задание: результат пуст', s);
  const stats = await ev('(() => { window.__t.render(); return window.__dev.engine.debug.stats(); })()');
  check(stats.calls <= 135, 'вызовов отрисовки (пост + помещение) ≤ 135', stats.calls);
  console.log('  кадр: ' + JSON.stringify(stats));

  check(problems.length === 0, 'нет ошибок и предупреждений в консоли', problems);
  await browser.close();
  console.log(`\n${failed ? 'ПРОВАЛ' : 'УСПЕХ'}: пройдено ${passed}, провалено ${failed} (${opt.w}×${opt.h})`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
