// Тест поста «ОГОНЬ»: настоящий указатель (page.mouse) по органам поста + проверка game.state и приборов.
//   cd web && node tools/test-fire.cjs [--no-build] [--w 844 --h 390] [--shots]   (код выхода ≠ 0 при провале)
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
  const st = stations[0], c = st.controls, V3 = engine.THREE.Vector3;
  engine.stop();
  const denied = [];
  game.on('denied', (d) => denied.push(d.action + ': ' + d.reason));
  window.T = {
    denied,
    adv(sec, dt = 0.05) { for (let t = 0; t < sec - 1e-9; t += dt) engine.debug.step(dt, false); },
    idle() { let n = 0; while (game.state.breech.busy && n++ < 4000) engine.debug.step(0.05, false); },
    load(shell = 'he', n = 3) {
      game.elevate(2 - game.state.turret.elevation); game.openBreech(); T.idle(); game.hoistShell(shell); T.idle(); game.ramShell(); T.idle();
      for (let i = 0; i < n; i++) { game.addCharge(); T.idle(); }
      game.closeBreech(); T.idle();
    },
    aim(b, e) { game.setBrake(false); game.rotateTurret(b - game.state.turret.bearing); game.setBrake(true); game.elevate(e - game.state.turret.elevation); },
    untilImpact() { let n = 0; while (game.state.flight.length && n++ < 6000) engine.debug.step(0.05, false); },
    // экранные координаты объекта-ориентира (CSS px)
    scr(name, x = 0, y = 0, z = 0) {
      const o = st.hotspots[name]; o.updateWorldMatrix(true, false);
      const s = engine.input.toScreen(new V3(x, y, z).applyMatrix4(o.matrixWorld)); return [s.x, s.y];
    },
    // сводка состояния поста и игры
    snap() {
      const s = game.state, rd = {};
      c.readyLamps.forEach((l) => { rd[l.key] = l.state; });
      return {
        phase: s.phase, armed: s.fire.armed, shots: s.shots, flight: s.flight.length, breechOpen: s.breech.open,
        ready: rd, truth: game.fireReadiness(),
        toggle: c.armToggle.value, cover: c.armCover.open, armLamp: c.armLamp.on,
        bearing: c.cBearing.value, elev: c.cElev.value, charges: c.cCharges.value,
        he: c.lampHE.state, ap: c.lampAP.state, flightLamp: c.lampFlight.state, watch: c.watch.value,
        lines: c.telegraph.lines, busy: c.telegraph.busy, flare: c.flare.visible, leverTravel: c.fireLever.travel,
        denied: denied.length, lastDenied: denied[denied.length - 1] || null,
        calls: engine.debug.stats().calls,
      };
    },
  };
})()`;

(async () => {
  if (!flag('no-build')) execFileSync('node', ['build.mjs', '--dev', 'st-fire'], { cwd: WEB, stdio: 'ignore' });
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
  const tap = async (name) => { const [x, y] = await scr(name); await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up(); await adv(0.6); return [x, y]; };
  const pull = async (dist = 130) => {           // протянуть спусковой рычаг вниз и отпустить
    const [x, y] = await scr('fireLever');
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= 13; i++) await page.mouse.move(x, y + dist * i / 13);
    const mid = await ev('return window.__dev.stations[0].controls.fireLever.travel');
    await page.mouse.up();
    await adv(0.1, 0.02);
    return mid;
  };
  const shot = async (name) => { if (flag('shots')) { await ev('window.__dev.engine.debug.step(1/60, true)'); await page.screenshot({ path: path.join(WEB, '.dev/st-fire', 't_' + name + '.png') }); } };

  await page.goto('file://' + path.join(WEB, '.dev/st-fire/index.html'));
  await page.waitForFunction('window.__dev && window.__dev.engine && window.__dev.stations', null, { timeout: 120000 });
  await page.waitForTimeout(600);                // несколько настоящих кадров (обычный цикл движка)
  await page.evaluate(PAGE_HELPERS);
  await adv(0.3);

  console.log('1. исходное состояние, контракт поста');
  const meta = await ev(`const st = window.__dev.stations[0]; return { id: st.id, title: st.title, keys: Object.keys(st.hotspots).sort(), cam: st.camera, isGroup: !!st.group.isGroup,
    lights: (() => { let n = 0; st.group.traverse(o => { if (o.isLight) n++; }); return n; })(),
    box: (() => { const b = new window.__dev.engine.THREE.Box3().setFromObject(st.group); st.group.worldToLocal(b.min); return 0; })() }`);
  check('id/title/group', meta.id === 'fire' && meta.title === 'ОГОНЬ' && meta.isGroup, meta);
  check('hotspots: armCover, armToggle, burstSelector, fireLever', meta.keys.join() === 'armCover,armToggle,burstSelector,fireLever', meta.keys);
  check('пост не добавляет источников света', meta.lights === 0, meta.lights);
  let s = await snap();
  check('фаза playing', s.phase === 'playing', s.phase);
  check('табло = fireReadiness()', JSON.stringify(s.ready) === JSON.stringify(s.truth), s);
  check('табло: затвор и стопор зелёные, остальные красные', s.ready.breech && s.ready.brake && !s.ready.shell && !s.ready.charge && !s.ready.armed, s.ready);
  check('крышка закрыта, тумблер снят, плафон погашен', !s.cover && s.toggle === 0 && !s.armLamp, s);
  check('секундомер на нуле, лампа полёта погашена', s.watch === 0 && s.flightLamp === false, s);
  check('вызовов отрисовки ≤ 120', s.calls > 0 && s.calls <= 120, s.calls);
  // органы в зоне управления и не слипаются
  const P = { cover: await scr('armCover'), toggle: await scr('armToggle'), lever: await scr('fireLever') };
  const inSafe = ([x, y]) => x > 24 && x < W - 24 && y > 40 + 8 && y < H - 56 - 8;
  check('органы внутри зоны управления', inSafe(P.cover) && inSafe(P.toggle) && inSafe(P.lever), P);
  check('рычаг и крышка разнесены (≥ 60 px)', Math.hypot(P.cover[0] - P.lever[0], P.cover[1] - P.lever[1]) >= 60, P);
  const leverEnd = await scr('fireLever');
  check('ход рычага вниз остаётся над нижней панелью', leverEnd[1] + 110 < H - 56 + 30, leverEnd);

  console.log('2. спуск без готовности — один отказ на одно протягивание');
  let d0 = s.denied;
  let mid = await pull();
  s = await snap();
  check('рычаг дошёл до упора под указателем', mid >= 0.88, mid);
  check('выстрела нет, отказ ровно один («Орудие не заряжено»)', s.shots === 0 && s.denied === d0 + 1 && /не заряжено/i.test(s.lastDenied), s);
  await adv(1);
  s = await snap();
  check('рычаг вернулся пружиной', s.leverTravel < 0.05, s.leverTravel);
  check('отказов больше не добавилось', s.denied === d0 + 1, s.denied);
  // короткое касание рычага — только качнуть, без действия
  await tap('fireLever');
  s = await snap();
  check('касание рычага без протяжки ничего не вызывает', s.denied === d0 + 1 && s.shots === 0, s);

  console.log('3. крышка и тумблер «ЦЕПЬ СТРЕЛЬБЫ»');
  // закрытая крышка перехватывает касание по месту тумблера
  await tap('armToggle');
  s = await snap();
  check('касание по закрытой крышке открывает её, цепь не взводится', s.cover === true && s.armed === false && s.toggle === 0, s);
  await tap('armToggle');
  s = await snap();
  check('тумблер взводит цепь (game.arm(true))', s.armed === true && s.toggle === 1 && s.ready.armed === true && s.armLamp === true, s);
  await shot('armed');
  await tap('armToggle');
  s = await snap();
  check('повторное касание снимает цепь', s.armed === false && s.toggle === 0 && s.ready.armed === false && s.armLamp === false, s);
  await tap('armToggle');
  await tap('armCover');                          // крышка откинута — ориентир переехал вместе с ней
  s = await snap();
  check('закрытие крышки сбрасывает цепь', s.cover === false && s.armed === false && s.toggle === 0, s);
  // перетаскивание крышки вверх — открыть
  { const [x, y] = await scr('armCover'); await page.mouse.move(x, y); await page.mouse.down(); for (let i = 1; i <= 6; i++) await page.mouse.move(x, y - i * 6); await page.mouse.up(); await adv(0.6); }
  s = await snap();
  check('крышка открывается протяжкой вверх', s.cover === true && s.armed === false, s);

  // сенсорный ввод (pointerType = touch): одно касание — одно переключение
  for (const want of [true, false]) {
    const [x, y] = await scr('armToggle'); await page.touchscreen.tap(x, y); await adv(0.6);
    s = await snap();
    check('касание пальцем: цепь ' + (want ? 'взведена' : 'снята'), s.armed === want && s.toggle === (want ? 1 : 0), s);
  }

  console.log('4. отказ взведения при открытом затворе — тумблер отщёлкивается обратно');
  await ev('game = window.__dev.game; game.openBreech(); T.idle(); T.adv(0.2)');
  s = await snap(); d0 = s.denied;
  check('табло: затвор красный', s.ready.breech === false && s.breechOpen === true, s);
  await tap('armToggle');
  s = await snap();
  check('game.arm отказал один раз, цепь не взведена, тумблер вернулся', s.denied === d0 + 1 && /затвор/i.test(s.lastDenied) && !s.armed && s.toggle === 0, s);

  console.log('5. заряжание и репитеры');
  await ev(`const g = window.__dev.game; g.hoistShell('he'); T.adv(0.3);`);
  s = await snap();
  await ev(`const g = window.__dev.game; T.idle(); T.adv(0.3);`);
  const onTray = await snap();
  check('снаряд на лотке: лампа «ОФ» мигает', onTray.he === 'blink' && onTray.ap === false && onTray.ready.shell === false, onTray);
  await ev(`const g = window.__dev.game; g.ramShell(); T.idle(); for (let i = 0; i < 3; i++) { g.addCharge(); T.idle(); } g.closeBreech(); T.idle(); T.aim(127.35, 21.4); T.adv(3);`);
  s = await snap();
  check('лампа «ОФ» горит, «ББ» нет', s.he === true && s.ap === false, s);
  check('счётчик «ЗАРЯДОВ» = 3', s.charges === 3, s.charges);
  check('репитеры: пеленг 127.35, угол 21.40', Math.abs(s.bearing - 127.35) < 1e-6 && Math.abs(s.elev - 21.4) < 1e-6, s);
  check('табло: всё зелёное, кроме цепи', s.ready.shell && s.ready.charge && s.ready.breech && s.ready.brake && !s.ready.armed, s.ready);

  console.log('6. отказы спуска: цепь не взведена; башня не на стопоре');
  d0 = s.denied;
  await pull(); await adv(1);
  s = await snap();
  check('без цепи — отказ, выстрела нет', s.shots === 0 && s.denied === d0 + 1 && /цепь/i.test(s.lastDenied), s);
  await tap('armToggle');
  await ev('window.__dev.game.setBrake(false); T.adv(0.2)');
  s = await snap(); d0 = s.denied;
  check('цепь взведена, стопор снят — лампа «СТОПОР» красная', s.armed && s.ready.brake === false, s);
  await pull(); await adv(1);
  s = await snap();
  check('без стопора — отказ, выстрела нет', s.shots === 0 && s.denied === d0 + 1 && /стопор/i.test(s.lastDenied), s);
  await ev('window.__dev.game.setBrake(true); T.adv(0.2)');

  console.log('7. выстрел');
  d0 = s.denied;
  await shot('ready');
  await pull();
  s = await snap();
  check('game.fire() прошёл: выстрел №1, снаряд в полёте, отказов нет', s.shots === 1 && s.flight === 1 && s.denied === d0, s);
  check('цепь снята игрой — тумблер отщёлкнулся', s.armed === false && s.toggle === 0 && s.ready.armed === false, s);
  check('вспышка в смотровой щели', s.flare === true, s.flare);
  check('лампа «СНАРЯД В ПОЛЁТЕ», секундомер пошёл', s.flightLamp !== false && s.watch > 5, s);
  check('лента: «ВЫСТРЕЛ №1»', s.lines.length === 1 && s.lines[0] === 'ВЫСТРЕЛ №1', s.lines);
  check('табло: снаряд и заряд красные', !s.ready.shell && !s.ready.charge, s.ready);
  await shot('fired');
  const w0 = s.watch;
  await adv(2);
  s = await snap();
  check('крышка захлопнулась после выстрела', s.cover === false, s);
  check('вспышка погасла, лампы «ОФ/ББ» погашены, «ЗАРЯДОВ» = 0', s.flare === false && s.he === false && s.ap === false && s.charges === 0, s);
  check('секундомер считает вниз', s.watch < w0 - 1.5 && s.watch > 0, [w0, s.watch]);
  check('лента допечатана', s.busy === false, s);
  await shot('flight');

  console.log('8. цепь взведена извне / снята открытием затвора');
  await ev('window.__dev.game.arm(true); T.adv(0.6)');
  s = await snap();
  check('game.arm(true) извне: тумблер поднят, крышка откинута', s.armed && s.toggle === 1 && s.cover === true, s);
  await ev('const g = window.__dev.game; g.elevate(2 - g.state.turret.elevation); g.openBreech(); T.idle(); T.adv(0.4)');
  s = await snap();
  check('затвор открыт — цепь снята, тумблер вернулся', s.breechOpen && !s.armed && s.toggle === 0, s);
  await ev('const g = window.__dev.game; g.closeBreech(); T.idle();');

  console.log('9. разрыв и доклад корректировщика');
  await ev('T.untilImpact(); T.adv(6)');
  s = await snap();
  check('снарядов в полёте нет: лампа погашена, секундомер на нуле', s.flight === 0 && s.flightLamp === false && s.watch === 0, s);
  check('лента: доклад после «ВЫСТРЕЛ №1»', s.lines.length >= 2 && s.lines[0] === 'ВЫСТРЕЛ №1' && /ЦЕЛЬ|РАЗРЫВ/.test(s.lines[1]), s.lines);
  check('строки ленты — ПРОПИСНЫМИ', s.lines.every((l) => l === l.toUpperCase()), s.lines);
  await shot('report');

  console.log('10. прямое попадание (доклад без текста → строка о попадании)');
  const hit = await ev(`const g = window.__dev.game, s = g.state, t = s.targets.find(x => x.alive), b = s.mission.battery;
    const dx = t.x - b.x, dy = t.y - b.y, range = Math.hypot(dx, dy), brg = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    let sol = null, n = 0; for (n = 1; n <= 6; n++) { sol = g.solve(range, n); if (sol.ok) break; }
    T.load('he', n); T.aim(brg, sol.elevation); g.arm(true); T.adv(0.6);
    return { range, brg, n, el: sol.elevation, moving: t.moving, armed: s.fire.armed };`);
  check('подготовка второго выстрела', hit.armed === true, hit);
  await pull();
  await ev('T.untilImpact(); T.adv(8)');
  s = await snap();
  check('выстрел №2 произведён рычагом', s.shots === 2, s);
  check('лента: «ВЫСТРЕЛ №2» и строка о попадании/уничтожении', s.lines.includes('ВЫСТРЕЛ №2') && s.lines.some((l) => /ПОПАДАНИЕ|УНИЧТОЖЕНА/.test(l)), s.lines);
  await shot('hit');

  console.log('11. новое задание: лента очищена, пост читает новое состояние');
  await ev('const g = window.__dev.game; g.arm(true); T.adv(0.6); g.startMission(0); g.begin(); T.adv(0.6)');
  s = await snap();
  check('лента пуста, крышка закрыта, тумблер снят', s.lines.length === 0 && s.cover === false && s.toggle === 0 && !s.armed, s);
  check('счётчики сброшены по новому состоянию', s.charges === 0 && s.shots === 0 && s.watch === 0, s);
  await tap('armCover'); await tap('armToggle');
  s = await snap();
  check('органы работают с новым state (цепь взведена)', s.armed === true && s.toggle === 1 && s.ready.armed === true, s);
  await ev(`T.aim(42.5, 10); T.adv(3)`);
  s = await snap();
  check('репитеры следуют новому state.turret', Math.abs(s.bearing - 42.5) < 1e-6 && Math.abs(s.elev - 10) < 1e-6, s);

  console.log('12. другие фазы игры: меню, брифинг, свободный бой');
  await ev('const g = window.__dev.game; g.quit(); T.adv(0.5)');
  s = await snap();
  check('меню: пост обновляется без ошибок, тумблер повторяет state.fire.armed', s.phase === 'menu' && s.toggle === (s.armed ? 1 : 0) && JSON.stringify(s.ready) === JSON.stringify(s.truth), s);
  d0 = s.denied;
  await pull(); await adv(0.5);
  s = await snap();
  check('спуск в меню — один отказ («Бой не идёт»)', s.denied === d0 + 1 && s.shots === 0, s);
  await ev('const g = window.__dev.game; g.startMission(1); T.adv(0.5)');
  s = await snap();
  check('брифинг: без ошибок, лента пуста', s.phase === 'briefing' && s.lines.length === 0, s);
  await ev('const g = window.__dev.game; g.quit(); g.startSkirmish(); g.begin(); T.adv(0.5)');
  s = await snap();
  check('свободный бой: playing, табло = fireReadiness()', s.phase === 'playing' && JSON.stringify(s.ready) === JSON.stringify(s.truth), s);

  console.log('13. настоящий цикл кадров');
  await ev('window.__dev.engine.start()');
  await page.waitForTimeout(1500);
  check('нет ошибок и предупреждений в консоли', problems.length === 0, problems);

  await browser.close();
  console.log(`\n${failed ? 'ПРОВАЛ' : 'УСПЕХ'}: ${passed} проверок прошло, ${failed} не прошло (${W}×${H})`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
