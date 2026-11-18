// Тест поста «НАБЛЮДЕНИЕ»: настоящий указатель (page.mouse) по органам поста + проверка game.state и приборов.
//   cd web && node tools/test-observe.cjs [--no-build] [--w 844 --h 390] [--shots]   (код выхода ≠ 0 при провале)
// Кадры шагаются вручную (engine.debug.step без отрисовки) — быстро и детерминированно даже на программном WebGL.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');

const WEB = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const flag = (k) => argv.includes('--' + k);
const num = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? Number(argv[i + 1]) : d; };
const W = num('w', 844), H = num('h', 390);

const PAGE_HELPERS = `(() => {
  const { engine, game, stations } = window.__dev;
  const st = stations[0], c = st.controls, V3 = engine.THREE.Vector3, D = Math.PI / 180;
  engine.stop();
  const denied = [];
  game.on('denied', (d) => denied.push(d.action + ': ' + d.reason));
  window.T = {
    denied,
    adv(sec, dt = 0.05) { for (let t = 0; t < sec - 1e-9; t += dt) engine.debug.step(dt, false); },
    // экранные координаты объекта-ориентира (CSS px)
    scr(name, x = 0, y = 0, z = 0) {
      const o = st.hotspots[name]; o.updateWorldMatrix(true, false);
      const s = engine.input.toScreen(new V3(x, y, z).applyMatrix4(o.matrixWorld)); return [s.x, s.y];
    },
    brgTo(o) { const b = game.state.mission.battery; return (Math.atan2(o.x - b.x, o.y - b.y) / D + 360) % 360; },
    // поставить цель/своего в заданный пеленг и дальность (для вида в трубу)
    place(o, brg, km, extra) {
      const b = game.state.mission.battery;
      Object.assign(o, { x: b.x + Math.sin(brg * D) * km, y: b.y + Math.cos(brg * D) * km }, extra || {});
      return o;
    },
    snap() {
      const s = game.state;
      return {
        phase: s.phase, bearing: s.scope.bearing, zoom: s.scope.zoom, fov: game.scopeFov(), counter: c.cBearing.value,
        lever: c.zoomLever.on, lampTarget: c.lampTarget.state, lampBurst: c.lampBurst.state, plate: c.lastPlate.text,
        lines: s.plot.lines.map((l) => [l.from, l.bearing]), view: Object.assign({}, c.view.info), close: c.close,
        wheelAngle: c.wheel.angle, denied: denied.length, calls: engine.debug.stats().calls, turret: s.turret.bearing,
      };
    },
  };
})()`;

(async () => {
  if (!flag('no-build')) execFileSync('node', ['build.mjs', '--dev', 'st-observe'], { cwd: WEB, stdio: 'ignore' });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true })).newPage();
  page.setDefaultTimeout(180000);
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push('console.' + m.type() + ': ' + m.text()); });

  let failed = 0, passed = 0;
  const check = (name, cond, info) => {
    if (cond) { passed++; console.log('  ok   ' + name); } else { failed++; console.log('  FAIL ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
  };
  const ev = (js) => page.evaluate('(() => {' + js + '})()');
  const snap = () => ev('return T.snap()');
  const adv = (s) => ev(`T.adv(${s})`);
  const scr = (name, x = 0, y = 0, z = 0) => ev(`return T.scr('${name}', ${x}, ${y}, ${z})`);
  const tap = async (name) => { const [x, y] = await scr(name); await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up(); await adv(0.4); return [x, y]; };
  const near = (a, b, eps) => Math.abs(((a - b + 540) % 360) - 180) <= eps;
  const shot = async (name) => { if (flag('shots')) { await ev('window.__dev.engine.debug.step(1/60, true)'); await page.screenshot({ path: path.join(WEB, '.dev/st-observe', 't_' + name + '.png') }); } };
  // провернуть маховик: палец идёт по дуге вокруг ступицы (deg > 0 — по часовой для игрока)
  const turnWheel = async (deg) => {
    const [cx, cy] = await scr('scopeWheel');
    const [rx, ry] = await scr('scopeWheel', 0.1, 0, 0);
    const R = Math.hypot(rx - cx, ry - cy), n = Math.max(6, Math.round(Math.abs(deg) / 6));
    await page.mouse.move(cx + R, cy); await page.mouse.down();
    for (let i = 1; i <= n; i++) { const a = (deg * i / n) * Math.PI / 180; await page.mouse.move(cx + R * Math.cos(a), cy + R * Math.sin(a)); }
    await page.mouse.up();
    await adv(0.2);
  };

  await page.goto('file://' + path.join(WEB, '.dev/st-observe/index.html'));
  await page.waitForFunction('window.__dev && window.__dev.engine && window.__dev.stations', null, { timeout: 120000 });
  await page.waitForTimeout(600);                // несколько настоящих кадров (обычный цикл движка)
  await page.evaluate(PAGE_HELPERS);
  await adv(0.3);

  console.log('1. контракт поста, исходное состояние');
  const meta = await ev(`const st = window.__dev.stations[0]; return { id: st.id, title: st.title, keys: Object.keys(st.hotspots).sort(), isGroup: !!st.group.isGroup,
    lights: (() => { let n = 0; st.group.traverse(o => { if (o.isLight) n++; }); return n; })() }`);
  check('id/title/group', meta.id === 'observe' && meta.title === 'НАБЛЮДЕНИЕ' && meta.isGroup, meta);
  check('hotspots: scopeWheel, zoomLever, markButton, toTargetButton (+ scopeMarkBtn, eyepiece)',
    ['scopeWheel', 'zoomLever', 'markButton', 'toTargetButton', 'scopeMarkBtn', 'eyepiece'].every((k) => meta.keys.includes(k)), meta.keys);
  check('пост не добавляет источников света', meta.lights === 0, meta.lights);
  let s = await snap();
  check('фаза playing, труба ×4, поле зрения 16°', s.phase === 'playing' && s.zoom === 4 && s.fov === 16 && s.lever === false, s);
  check('вызовов отрисовки ≤ 120', s.calls > 0 && s.calls <= 120, s.calls);
  check('сцена трубы нарисована, день', s.view.renders > 0 && s.view.mode === 'dclear', s.view);
  const P = { wheel: await scr('scopeWheel'), lever: await scr('zoomLever'), mark: await scr('markButton'), to: await scr('toTargetButton'), eye: await scr('eyepiece') };
  const inSafe = ([x, y]) => x > 24 && x < W - 24 && y > 40 + 8 && y < H - 56 - 8;
  check('органы внутри зоны управления', Object.values(P).every(inSafe), P);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  check('кнопки и рычаг не слипаются (≥ 44 px)', dist(P.mark, P.to) >= 44 && dist(P.lever, P.mark) >= 44 && dist(P.lever, P.to) >= 44, P);
  const eyeBox = await ev(`const { engine, stations } = window.__dev, g = stations[0].controls.glass, V3 = engine.THREE.Vector3; g.updateWorldMatrix(true, false);
    const r = g.geometry.parameters.radius, q = (x, y) => engine.input.toScreen(new V3(x, y, 0).applyMatrix4(g.matrixWorld));
    return { x0: q(-r, 0).x, x1: q(r, 0).x, y0: q(0, r).y, y1: q(0, -r).y }`);
  check('окуляр: ≥ 150 px в поперечнике, над нижней панелью', eyeBox.x1 - eyeBox.x0 >= 150 && eyeBox.y1 < H - 56 && eyeBox.y0 > 20, eyeBox);
  await adv(1);
  const r1 = (await snap()).view.renders;
  check('сцена трубы рисуется не чаще ~30 раз/с', r1 - s.view.renders >= 10 && r1 - s.view.renders <= 34, [s.view.renders, r1]);

  console.log('2. маховик пеленга');
  const b0 = s.bearing;
  await turnWheel(120);
  s = await snap();
  check('по часовой: пеленг трубы растёт (треть оборота ≈ 2° при ×4)', near(s.bearing, b0 + 2, 0.5), [b0, s.bearing]);
  check('счётчик показывает пеленг трубы, маховик идёт за пальцем', near(s.counter, s.bearing, 0.011) && Math.abs(s.wheelAngle) > 1.5, [s.counter, s.bearing, s.wheelAngle]);
  await turnWheel(-240);
  s = await snap();
  check('против часовой: пеленг убывает (через 0 → 35x°)', near(s.bearing, b0 - 2, 0.5), [b0, s.bearing]);

  console.log('3. кратность');
  await tap('zoomLever');
  s = await snap();
  check('рычаг вниз: ×10, поле зрения 6,4°, сцена перестроена', s.zoom === 10 && s.fov === 6.4 && s.lever === true && s.view.fov === 6.4, s);
  const b1 = s.bearing;
  await turnWheel(180);
  s = await snap();
  check('при ×10 привод тоньше: пол-оборота ≈ 1°', near(s.bearing, b1 + 1, 0.3), [b1, s.bearing]);
  await tap('zoomLever');
  s = await snap();
  check('рычаг вверх: снова ×4', s.zoom === 4 && s.lever === false && s.view.fov === 16, s);
  await ev('window.__dev.game.setScope({ zoom: 10 }); T.adv(0.2)');
  s = await snap();
  check('рычаг следует за game.state.scope.zoom', s.lever === true, s.lever);
  await ev('window.__dev.game.setScope({ zoom: 4 }); T.adv(0.2)');

  console.log('4. «ЗАСЕЧЬ ПЕЛЕНГ»');
  await tap('markButton');
  s = await snap();
  const ln = s.lines[s.lines.length - 1];
  check('на планшете линия от трубы с её пеленгом', !!ln && ln[0] === 'scope' && near(ln[1], s.bearing, 0.06), [s.lines, s.bearing]);

  console.log('5. «НА ЦЕЛЬ»');
  await ev(`const g = window.__dev.game; g.setBrake(false); g.rotateTurret(40 - g.state.turret.bearing); g.setBrake(true); g.state.activeTarget = null; g.setScope({ bearing: 300 }); T.adv(0.2)`);
  s = await snap();
  const tb = s.turret;
  await tap('toTargetButton');
  await adv(3);
  s = await snap();
  check('без активной цели труба доворачивается на пеленг башни', near(s.bearing, tb, 0.02), [s.bearing, tb]);
  // активная цель с донесением: труба идёт на пеленг донесения
  const want = await ev(`const g = window.__dev.game, s = g.state; let n = 0;
    while (!(s.targets[0].reported && s.targets[0].reported.x != null) && n++ < 2400) T.adv(0.05);
    const t = s.targets[0]; if (!t.reported) return null;
    g.selectTarget(t.id); g.setScope({ bearing: (T.brgTo(t.reported) + 150) % 360 }); T.adv(0.2);
    return { id: s.activeTarget, brg: T.brgTo(t.reported), ctl: window.__dev.stations[0].controls.targetBearing() }`);
  check('цель донесена и выбрана', !!want && want.id != null && near(want.ctl, want.brg, 1e-6), want);
  await tap('toTargetButton');
  await adv(0.5);
  const midway = (await snap()).bearing;
  await adv(3);
  s = await snap();
  check('труба плавно (не скачком) приходит на пеленг донесения', !!want && near(s.bearing, want.brg, 0.02) && !near(midway, want.brg, 5), [midway, s.bearing, want]);

  console.log('6. цель в поле зрения, вид в трубу');
  // цель ставится заведомо видимой: день, 7 км, истинное место — на пеленге 5° (в море, внутри карты)
  await ev(`const g = window.__dev.game, s = g.state, t = s.targets[0]; t.active = true; T.place(t, 5, 7, { kind: 'destroyer', heading: 100 });
    g.setScope({ bearing: 35, zoom: 4 }); T.adv(0.3)`);
  s = await snap();
  check('цель вне поля зрения: лампа «ЦЕЛЬ В ПОЛЕ ЗРЕНИЯ» погашена', s.lampTarget === false && s.view.inView === false, [s.lampTarget, s.view]);
  await ev('window.__dev.game.setScope({ bearing: 6 }); T.adv(0.3)');
  s = await snap();
  check('цель в поле зрения: лампа горит, модель корабля в сцене', s.lampTarget === true && s.view.inView === true && s.view.ships >= 1, [s.lampTarget, s.view]);
  await shot('target');
  await ev('window.__dev.game.setScope({ zoom: 10 }); T.adv(0.3)');
  s = await snap();
  check('×10: цель в 1° от оси ещё в поле (±3,2°)', s.lampTarget === true, [s.lampTarget, s.view]);
  await ev('window.__dev.game.setScope({ bearing: 10 }); T.adv(0.3)');
  s = await snap();
  check('×10: цель в 5° от оси — вне поля', s.lampTarget === false, [s.lampTarget, s.view]);
  // тонущая цель видна, пока не скрылась; затем модель пропадает
  await ev(`const g = window.__dev.game, s = g.state, t = s.targets[0]; g.setScope({ bearing: 5, zoom: 10 });
    t.alive = false; t.burning = true; t.sinking = { since: s.time, dur: 18 }; T.adv(0.3)`);
  s = await snap();
  check('тонущая цель ещё видна в трубу, но лампа «цель» гаснет', s.view.ships === 1 && s.lampTarget === false, [s.view, s.lampTarget]);
  await shot('sinking');
  await ev(`const s = window.__dev.game.state, t = s.targets[0]; t.sunk = true; T.adv(0.3)`);
  s = await snap();
  check('затонувшая цель исчезла', s.view.ships === 0, s.view);

  console.log('7. разрывы и своё наблюдение');
  const sp = await ev(`const g = window.__dev.game, s = g.state, b = s.mission.battery, a = 5.3 * Math.PI / 180, v = window.__dev.stations[0].controls.view;
    const r = [v.impact({ x: b.x + Math.sin(a) * 6.8, y: b.y + Math.cos(a) * 6.8, shell: 'he', hits: [] }), v.impact({ x: 1, y: 1, shell: 'illum' })];
    T.adv(0.5); return r`);
  s = await snap();
  check('всплеск своего снаряда стоит в сцене (осветительный — нет)', sp[0] === true && sp[1] === false && s.view.splashes === 1, [sp, s.view]);
  await shot('splash');
  await adv(4);
  s = await snap();
  check('всплеск опал', s.view.splashes === 0, s.view);
  check('своих наблюдений нет: лампа погашена, табличка «РАЗРЫВОВ НЕ НАБЛЮДАЛИ»', s.lampBurst === false && /НЕ НАБЛЮДАЛИ/.test(s.plate), [s.lampBurst, s.plate]);
  await ev(`const s = window.__dev.game.state; s.scope.last = { n: 3, dBearing: 0.4, over: 1, targetId: 1, t: s.time }; T.adv(0.2)`);
  s = await snap();
  check('scope.last → лампа «РАЗРЫВ ЗАМЕЧЕН» и табличка «№ 3 · ВПРАВО 0,4° · ПЕРЕЛЁТ»', s.lampBurst !== false && /№ 3/.test(s.plate) && /ВПРАВО 0,4°/.test(s.plate) && /ПЕРЕЛЁТ/.test(s.plate), [s.lampBurst, s.plate]);
  await ev(`const s = window.__dev.game.state; s.scope.last = { n: 4, dBearing: -1.2, over: -1, targetId: 1, t: s.time }; T.adv(0.2)`);
  s = await snap();
  check('влево/недолёт', /№ 4/.test(s.plate) && /ВЛЕВО 1,2°/.test(s.plate) && /НЕДОЛЁТ/.test(s.plate), s.plate);
  await adv(9);
  s = await snap();
  check('через 8 с лампа «РАЗРЫВ ЗАМЕЧЕН» гаснет, табличка остаётся', s.lampBurst === false && /№ 4/.test(s.plate), [s.lampBurst, s.plate]);

  console.log('8. окуляр: тащить и прильнуть');
  await ev('window.__dev.game.setScope({ bearing: 100, zoom: 4 }); T.adv(0.2)');
  const [ex, ey] = await scr('eyepiece');
  await page.mouse.move(ex, ey); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(ex + 6 * i, ey);
  await page.mouse.up(); await adv(0.2);
  s = await snap();
  const span = eyeBox.x1 - eyeBox.x0;
  check('палец вправо на 48 px: картинка идёт за пальцем (пеленг убывает на 48/Ø·16°)', near(s.bearing, 100 - 48 / span * 16, 0.4) && s.close === false, [s.bearing, span]);
  await tap('eyepiece');
  await adv(0.6);
  s = await snap();
  check('касание окуляра — придвинуться, пеленг не меняется', s.close === true && near(s.bearing, 100 - 48 / span * 16, 0.4), [s.close, s.bearing]);
  await shot('close');
  await ev('window.__dev.stations[0].controls.setClose(false); T.adv(0.6)');

  console.log('9. ночь, туман; настоящий цикл кадров');
  await ev('const g = window.__dev.game; g.quit(); g.startMission(24); g.begin(); T.adv(0.6)');
  s = await snap();
  check('ночное задание: сцена перестроена на ночь, кораблей без света не видно', s.view.mode === 'nclear' && s.view.ships === 0 && s.lampTarget === false, s.view);
  const lit = await ev(`const g = window.__dev.game, s = g.state, t = s.targets[0]; t.active = true; T.place(t, 60, 6);
    s.lights.push({ x: t.x + 0.2, y: t.y, until: s.time + 40, n: 99 }); g.setScope({ bearing: 60, zoom: 10 }); T.adv(0.4); return g.visible(t.id)`);
  s = await snap();
  check('цель под «люстрой» видна в трубу, огонь «люстры» в сцене', lit === true && s.view.ships === 1 && s.view.flares === 1 && s.lampTarget === true, [lit, s.view]);
  await shot('night');
  await ev('const g = window.__dev.game; g.quit(); g.startMission(25); g.begin(); T.adv(0.6)');
  s = await snap();
  check('туман: дымка', s.view.mode === 'dfog', s.view);
  check('вызовов отрисовки ≤ 120', s.calls > 0 && s.calls <= 120, s.calls);
  await ev('window.__dev.engine.start()');
  await page.waitForTimeout(1500);
  check('нет ошибок и предупреждений в консоли', problems.length === 0, problems);

  await browser.close();
  console.log(`\n${failed ? 'ПРОВАЛ' : 'УСПЕХ'}: ${passed} проверок прошло, ${failed} не прошло (${W}×${H})`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
