// Тест взаимодействия поста «ПОДЪЁМ»: настоящий указатель (мышь) по органам + проверка game.state.
//   cd web && node build.mjs --dev st-elevation && node tools/test-elevation.cjs [--w 844] [--h 390] [--dpr 1] [--shots <каталог>]
// Код возврата ≠ 0 при любой неудаче, ошибке страницы или сообщении console.error/warning.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const opt = { w: 844, h: 390, dpr: 1, shots: null };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--shots') opt.shots = path.resolve(args[++i]);
  else if (args[i].startsWith('--')) opt[args[i].slice(2)] = Number(args[++i]);
}
const page0 = path.resolve(__dirname, '..', '.dev', 'st-elevation', 'index.html');

let failed = 0, passed = 0;
const problems = [];
function check(name, cond, info) {
  if (cond) { passed++; console.log('  ok   ' + name); } else { failed++; console.log('  FAIL ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: opt.w, height: opt.h }, deviceScaleFactor: opt.dpr });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push('console.' + m.type() + ': ' + m.text()); });
  await page.goto('file://' + page0);
  await page.waitForFunction('window.__dev && window.__dev.stations && window.__dev.stations.length > 0');
  await page.waitForTimeout(1200);

  await page.evaluate(() => {
    const { engine, game, stations } = window.__dev, st = stations[0], THREE = engine.THREE;
    const T = window.__t = { denied: [] };
    game.on('denied', d => T.denied.push(d.action + ': ' + d.reason));
    T.st = st;
    // экранная точка: локальные координаты объекта-органа → CSS px
    T.pt = (name, local = [0, 0, 0]) => {
      const o = st.hotspots[name];
      o.updateWorldMatrix(true, false);
      const s = engine.input.toScreen(o.localToWorld(new THREE.Vector3(...local)));
      return { x: s.x, y: s.y };
    };
    T.step = (n = 1, dt = 0.05) => { for (let i = 0; i < n; i++) engine.debug.step(dt, false); };
    T.el = () => game.state.turret.elevation;
    T.setEl = v => { const r = game.elevate(v - game.state.turret.elevation); T.step(2); return r.ok; };
    T.waitBreech = () => { for (let i = 0; i < 400 && game.state.breech.busy; i++) game.update(0.05); T.step(2); return game.state.breech.open; };
    T.view = () => {
      const c = st.controls;
      return {
        el: game.state.turret.elevation, counter: c.cElev.value, target: c.cTarget.value, shutter: c.shutter.object3D.visible,
        bug: c.bug.visible, bugDeg: c.bug.rotation.z * 180 / Math.PI, tiltDeg: c.tilt.rotation.z * 180 / Math.PI,
        err: c.gError.value, aligned: c.lampAligned.state, load: c.lampLoad.state, stale: c.lampStale.state,
        lock: c.lockBar.visible, lit: c.bDrive.lit, fine: c.fine,
      };
    };
  });
  const ev = (js) => page.evaluate('(()=>{const T=window.__t,{engine,game}=window.__dev;' + js + '})()');
  const view = () => ev('return T.view()');
  const denied = () => ev('const d=T.denied.slice(); T.denied.length=0; return d');
  const shot = async (name, clip) => {
    if (!opt.shots) return;
    fs.mkdirSync(opt.shots, { recursive: true });
    await ev('T.step(40)');
    await page.waitForTimeout(700);                                   // дать настоящему кадру отрисоваться
    await page.screenshot({ path: path.join(opt.shots, `${name}-${opt.w}x${opt.h}.png`), clip });
  };
  const tap = async (name, local) => { const p = await ev(`return T.pt(${JSON.stringify(name)}, ${JSON.stringify(local || [0, 0, 0])})`); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(40); await page.mouse.up(); await ev('T.step(3)'); return p; };
  // круговое движение по маховику: turns > 0 — по часовой (для игрока)
  const R = await ev('return T.st.controls.wheel.radius');
  async function turnWheel(turns, { startDeg = 60, keepDown = false } = {}) {
    const n = Math.max(8, Math.ceil(Math.abs(turns) * 40));
    const pts = await ev(`const out=[]; for(let i=0;i<=${n};i++){const a=(${startDeg})*Math.PI/180-(${turns})*2*Math.PI*i/${n}; out.push(T.pt('elevWheel',[${R}*Math.cos(a),${R}*Math.sin(a),0.04]));} return out`);
    await page.mouse.move(pts[0].x, pts[0].y);
    await page.mouse.down();
    for (let i = 1; i < pts.length; i++) await page.mouse.move(pts[i].x, pts[i].y);
    if (!keepDown) { await page.mouse.up(); await ev('T.step(3)'); }
  }

  // ---------------------------------------------------------------- геометрия и зона управления
  console.log('layout ' + opt.w + '×' + opt.h);
  const keys = await ev('return Object.keys(T.st.hotspots)');
  check('hotspots present', ['elevWheel', 'gearToggle', 'gearCoarse', 'gearFine', 'loadAngleButton'].every(k => keys.includes(k)), keys);
  const safe = { x0: 4, x1: opt.w - 4, y0: 40, y1: opt.h - 56 };
  for (const k of keys) {
    const p = await ev(`return T.pt(${JSON.stringify(k)})`);
    check(`hotspot ${k} inside safe zone`, p.x > safe.x0 && p.x < safe.x1 && p.y > safe.y0 && p.y < safe.y1, p);
  }
  {
    const rim = await ev(`const o=[]; for(let i=0;i<12;i++){const a=i/12*2*Math.PI; o.push(T.pt('elevWheel',[${R}*Math.cos(a),${R}*Math.sin(a),0.04]));} return o`);
    check('wheel rim inside safe zone', rim.every(p => p.x > safe.x0 && p.y > safe.y0 && p.y < safe.y1), rim.map(p => [Math.round(p.x), Math.round(p.y)]));
  }
  check('station meta', await ev("return T.st.id==='elevation' && T.st.title==='ПОДЪЁМ' && !!T.st.group && !!T.st.camera"));
  await denied();

  // ---------------------------------------------------------------- маховик, ГРУБО
  console.log('handwheel');
  await ev('T.setEl(0)');
  await turnWheel(0.25);
  let v = await view();
  check('coarse: quarter turn clockwise raises ≈ 2.5°', near(v.el, 2.5, 0.25), v.el);
  check('counter follows state', near(v.counter, v.el, 1e-6), v);
  await ev('T.step(30)');
  v = await view();
  check('barrel model follows state', near(v.tiltDeg, v.el, 0.05), v);
  const up = v.el;
  await turnWheel(-0.25);
  v = await view();
  check('coarse: quarter turn counter-clockwise lowers back', near(v.el, up - 2.5, 0.25), v.el);
  await ev('T.setEl(10)');
  await turnWheel(1);
  check('coarse: full turn = 10°', near((await view()).el, 20, 0.5), (await view()).el);

  // ---------------------------------------------------------------- тумблер ГРУБО / ТОЧНО
  console.log('gear toggle');
  await tap('gearFine');
  check('tap on «ТОЧНО» label selects fine', (await view()).fine === 1);
  await ev('T.setEl(10)');
  await turnWheel(0.5);
  v = await view();
  check('fine: half turn = 0.25°', near(v.el, 10.25, 0.04), v.el);
  await turnWheel(-0.5);
  check('fine: half turn back', near((await view()).el, 10, 0.04), (await view()).el);
  await tap('gearToggle');
  check('tap on the toggle flips back to coarse', (await view()).fine === 0);
  await tap('gearToggle');
  check('tap on the toggle flips to fine', (await view()).fine === 1);
  await tap('gearCoarse');
  check('tap on «ГРУБО» label selects coarse', (await view()).fine === 0);
  check('no denials so far', (await denied()).length === 0);

  // ---------------------------------------------------------------- упоры −2° и 45°
  console.log('hard stops');
  await ev('T.setEl(43)');
  await turnWheel(0.6);
  check('upper stop: exactly 45°', (await view()).el === 45, (await view()).el);
  await ev('T.setEl(-1)');
  await turnWheel(-0.5);
  check('lower stop: exactly −2°', (await view()).el === -2, (await view()).el);
  await ev('T.step(30)');
  await shot('min-angle');
  check('hard stops give no denials', (await denied()).length === 0);

  // ---------------------------------------------------------------- приборы: задание, рассогласование, лампы
  console.log('indicators');
  v = await view();
  check('no solution: repeater shuttered, bug hidden, not aligned', v.shutter === true && v.bug === false && v.aligned === false, v);
  check('load-angle lamp lit at −2°', v.load === true, v);
  const sol = await ev('game.setComputerRange(5); const r=game.compute(); T.step(40); return r');
  check('compute ok', sol.ok && sol.elevation > 3, sol);
  v = await view();
  check('repeater shows computed elevation', v.shutter === false && near(v.target, sol.elevation, 1e-6) && v.bug === true && near(v.bugDeg, sol.elevation, 0.05), v);
  check('error gauge clamps at −2', near(v.err, -2, 1e-6), v.err);
  await ev(`T.setEl(${sol.elevation} - 0.6); T.step(30)`);
  v = await view();
  check('error gauge = current − computed', near(v.err, -0.6, 0.011) && v.aligned === false, v);
  check('load-angle lamp off above 3°', v.load === false, v);
  await shot('off-target');
  await ev(`T.setEl(${sol.elevation} + 5)`);
  check('error gauge clamps at +2', near((await view()).err, 2, 1e-6));
  await ev(`T.setEl(${sol.elevation} + 0.03)`);
  check('0.03° off: not aligned', (await view()).aligned === false);
  await ev(`T.setEl(${sol.elevation} + 0.02)`);
  check('0.02° off: «СОВМЕЩЕНО»', (await view()).aligned === true, await view());
  await ev(`T.setEl(${sol.elevation}); T.step(30)`);
  v = await view();
  check('exact: aligned, error 0, checklist.elevated', v.aligned === true && near(v.err, 0, 1e-6) && await ev('return game.state.checklist.elevated'), v);
  await shot('aligned');
  check('stale lamp off', v.stale === false, v.stale);
  await ev('game.setComputerRange(4.6); T.step(3)');
  v = await view();
  check('inputs changed: «РАСЧЁТ УСТАРЕЛ» blinks', v.stale === 'blink', v.stale);
  await ev('game.compute(); T.step(3)');
  v = await view();
  check('recomputed: stale lamp off, repeater updated', v.stale === false && near(v.target, await ev('return game.state.computer.elevation'), 1e-6), v);
  await ev('T.setEl(3)');
  check('load-angle lamp lit at exactly 3°', (await view()).load === true);
  await ev('T.setEl(3.01)');
  check('load-angle lamp off at 3.01°', (await view()).load === false);
  await denied();

  // ---------------------------------------------------------------- силовой привод «НА УГОЛ ЗАРЯЖАНИЯ»
  console.log('power drive');
  await ev('T.setEl(20)');
  let p = await ev("return T.pt('loadAngleButton')");
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await ev('T.step(20)');                                             // 1 с игрового времени
  v = await view();
  check('hold 1 s: lowers ≈ 8°', near(v.el, 12, 0.6), v.el);
  check('button lit while driving', v.lit === true, v);
  await shot('power-drive');
  await page.mouse.up();
  await ev('T.step(3)');
  const stopAt = (await view()).el;
  await ev('T.step(20)');
  v = await view();
  check('release stops the drive', v.el === stopAt && v.lit === false, v);
  await page.mouse.down();
  await ev('T.step(60)');
  v = await view();
  check('drive stops exactly at 0°', v.el === 0 && v.lit === false, v);
  await page.mouse.up();
  await ev('T.setEl(-2)');
  await page.mouse.down();
  await ev('T.step(20)');
  v = await view();
  check('from −2° the drive raises to 0°', v.el === 0, v.el);
  await page.mouse.up();
  await ev('T.step(3)');
  check('power drive gives no denials', (await denied()).length === 0);
  // привод не ведёт к вычисленному углу: он идёт только к 0°
  check('drive target is 0°, not the computed angle', (await view()).el === 0 && (await view()).target > 3);

  // ---------------------------------------------------------------- блокировка при открытом затворе
  console.log('breech interlock');
  const opened = await ev('T.setEl(1); game.openBreech(); return T.waitBreech()');
  check('breech open', opened === true);
  check('lock bar shown on the sector', (await view()).lock === true);
  await turnWheel(0.5, { keepDown: true });                           // грубо: +5° — упрёмся в 3°
  v = await view();
  check('breech open: wheel stops exactly at 3°', v.el === 3, v.el);
  let d = await denied();
  check('one denial per gesture', d.length === 1 && /elevate/.test(d[0]), d);
  {
    const pts = await ev(`const out=[]; for(let i=0;i<=30;i++){const a=(60-180-i*9)*Math.PI/180; out.push(T.pt('elevWheel',[${R}*Math.cos(a),${R}*Math.sin(a),0.04]));} return out`);
    for (const q of pts) await page.mouse.move(q.x, q.y);              // продолжаем давить тем же жестом
    await page.mouse.up(); await ev('T.step(3)');
  }
  check('same gesture keeps pushing: still 3°, no more denials', (await view()).el === 3 && (await denied()).length === 0);
  await turnWheel(0.3);
  d = await denied();
  check('new gesture against the lock: one more denial', (await view()).el === 3 && d.length === 1, d);
  await shot('breech-lock');
  await turnWheel(-0.2);
  check('lowering with the breech open works', near((await view()).el, 1, 0.25) && (await denied()).length === 0, (await view()).el);
  p = await ev("return T.pt('loadAngleButton')");
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await ev('T.step(20)'); await page.mouse.up(); await ev('T.step(3)');
  check('power drive works with the breech open', (await view()).el === 0 && (await denied()).length === 0, (await view()).el);
  const closed = await ev('game.closeBreech(); return T.waitBreech()');
  check('breech closed → lock bar hidden', closed === false && (await view()).lock === false);
  await turnWheel(0.5);
  check('breech closed: wheel free again', near((await view()).el, 5, 0.4) && (await denied()).length === 0, (await view()).el);

  // ---------------------------------------------------------------- пауза, перезапуск задания, меню
  console.log('lifecycle');
  await ev('game.pause(true); T.step(2)');
  const before = (await view()).el;
  await turnWheel(0.25);
  check('paused: wheel does nothing, no denial', (await view()).el === before && (await denied()).length === 0);
  await ev('game.pause(false); T.step(2)');
  await ev('game.startMission(1); T.step(3)');
  check('briefing: no crash, wheel inert', await ev("return game.state.phase==='briefing'"));
  await turnWheel(0.2);
  await ev('game.begin(); T.step(40)');
  v = await view();
  check('new mission: displays follow the NEW state objects', near(v.counter, v.el, 1e-6) && near(v.tiltDeg, v.el, 0.05) && v.shutter === true && v.bug === false && v.stale === false, v);
  const e0 = v.el;
  await turnWheel(0.25);
  v = await view();
  check('new mission: wheel drives the new turret', near(v.el - e0, 2.5, 0.25) && near(v.counter, v.el, 1e-6), v);
  await ev('game.quit(); T.step(5)');
  check('menu: no crash', await ev("return game.state.phase==='menu'"));
  await turnWheel(0.2);
  p = await ev("return T.pt('loadAngleButton')");
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await ev('T.step(5)'); await page.mouse.up();
  await ev('T.st.onLeave(); T.st.onEnter(); T.step(5)');
  check('menu: controls inert, no denials', (await denied()).length === 0);
  await ev('game.startMission(0); game.begin(); T.step(10)');
  await turnWheel(0.25);
  check('after menu → mission: works again', near((await view()).el, 2.5, 0.3), (await view()).el);
  const stats = await ev('T.step(1, 0.016); engine.debug.step(0.016, true); return engine.debug.stats()');
  check('draw calls ≤ 120 (station + room)', stats.calls <= 120, stats);
  console.log('  draw calls: ' + stats.calls + ', triangles: ' + stats.triangles);

  check('no page errors / console warnings', problems.length === 0, problems);
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
