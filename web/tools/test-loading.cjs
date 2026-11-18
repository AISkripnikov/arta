// Тест взаимодействия поста «ЗАРЯЖАНИЕ»: настоящие события указателя по органам управления (координаты — проекция
// hotspots камерой движка) и проверка game.state, включая отказы.   node tools/test-loading.cjs [--w 844 --h 390]
// Перед запуском: node build.mjs --dev st-loading
const { chromium } = require('playwright');
const path = require('path');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const W = arg('w', 844), H = arg('h', 390);
let failed = 0, passed = 0;
const check = (ok, msg, extra) => { if (ok) { passed++; console.log('  ok   ' + msg); } else { failed++; console.log('  FAIL ' + msg + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } };

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '../.dev/st-loading/index.html'));
  await page.waitForFunction(() => window.__dev && window.__dev.stations && window.__dev.stations[0], null, { timeout: 120000 });
  await page.evaluate(() => {
    const { game, engine, stations } = window.__dev;
    window.__denied = [];
    game.on('denied', (d) => window.__denied.push(d.action + ': ' + d.reason));
    window.__st = stations[0];
    // перемотка игрового времени (программный WebGL медленный) + несколько кадров движка, чтобы пост перечитал состояние
    window.__ff = (sec) => { for (let t = 0; t < sec; t += 0.05) game.update(0.05); for (let i = 0; i < 4; i++) engine.debug.step(0.05, false); };
    window.__frames = (n = 30, dt = 1 / 30) => { for (let i = 0; i < n; i++) engine.debug.step(dt, false); };   // внимание: кадры двигают и игровое время
  });
  await page.waitForTimeout(500);

  const ev = (fn, a) => page.evaluate(fn, a);
  const pos = (name) => ev((n) => {
    const { engine } = window.__dev, o = window.__st.hotspots[n], v = new engine.THREE.Vector3();
    o.updateWorldMatrix(true, false); v.setFromMatrixPosition(o.matrixWorld);
    const s = engine.input.toScreen(v); return { x: s.x, y: s.y };
  }, name);
  const state = () => ev(() => { const s = window.__dev.game.state, c = window.__st.controls; return {
    breech: { open: s.breech.open, shell: s.breech.shell, rammed: s.breech.rammed, charges: s.breech.charges, busy: s.breech.busy && s.breech.busy.kind },
    shells: { ...s.shells }, denied: window.__denied.length, lastDenied: window.__denied[window.__denied.length - 1] || null,
    lever: c.breechLever.on, type: c.shellType,
    lamps: { angle: c.lampAngle.state, closed: c.lampClosed.state, busy: c.lampBusy.state },
    counters: { he: c.cHe.value, ap: c.cAp.value, charges: c.cCharges.value, computed: c.cComputed.value },
    shellVisible: c.gun.shell.visible, recoilZ: c.gun.recoil.position.z, tilt: c.gun.gunPivot.rotation.x, trayY: c.gun.tray.position.y,
  }; });
  const frames = (n, dt) => ev(([k, d]) => window.__frames(k, d || 1 / 30), [n, dt]);
  const ff = (sec) => ev((t) => window.__ff(t), sec);
  const tap = async (name) => { const p = await pos(name); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(40); await page.mouse.up(); await page.waitForTimeout(60); await frames(3, 0.01); };
  const drag = async (name, dy) => {
    const p = await pos(name);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(p.x, p.y + dy * i / 10); await page.waitForTimeout(15); }
    await page.mouse.up(); await page.waitForTimeout(60); await frames(3, 0.01);
  };
  const safe = async () => {                       // все органы управления — в зоне между панелями HUD
    const names = ['breechLever', 'shellToggle', 'hoistButton', 'ramLever', 'chargePlus', 'chargeMinus', 'unloadButton'];
    for (const n of names) { const p = await pos(n); check(p.x > 20 && p.x < W - 20 && p.y > 40 + 12 && p.y < H - 56 - 12, `«${n}» в зоне управления (${Math.round(p.x)}, ${Math.round(p.y)})`); }
  };

  console.log(`ЗАРЯЖАНИЕ — тест взаимодействия (${W}×${H})`);
  await frames(5);
  let s = await state();
  check(!s.breech.open && s.lamps.closed === true && s.lamps.angle === true && s.lamps.busy === false, 'исходное состояние: затвор закрыт, лампы «УГОЛ», «ЗАТВОР ЗАКРЫТ» горят', s);
  check(s.counters.he === s.shells.he && s.counters.ap === s.shells.ap && s.counters.charges === 0, 'счётчики снарядов и зарядов соответствуют состоянию', s.counters);
  check(s.trayY < -0.3 && !s.shellVisible, 'лоток опущен, снаряда нет');
  await safe();
  const comp = await ev(() => { window.__dev.game.setComputerCharge(4); window.__frames(3); return window.__st.controls.cComputed.value; });
  check(comp === 4, 'репитер «ПО РАСЧЁТУ» повторяет заряд вычислителя', comp);

  // --- отказы при закрытом затворе
  let d0 = s.denied;
  await tap('hoistButton'); s = await state();
  check(s.denied === d0 + 1 && !s.breech.busy && !s.breech.shell, 'подача при закрытом затворе — отказ', s.lastDenied);
  d0 = s.denied; await drag('ramLever', 120); s = await state();
  check(s.denied === d0 + 1 && !s.breech.busy, 'досылка при закрытом затворе — один отказ за протяжку', s.lastDenied);
  d0 = s.denied; await tap('chargePlus'); await tap('chargeMinus'); await tap('unloadButton'); s = await state();
  check(s.denied === d0 + 3 && !s.breech.busy, 'заряд +/−, разрядить при закрытом затворе — отказы', s.denied - d0);

  // --- ствол выше угла заряжания: рычаг затвора отскакивает, ровно один отказ за жест
  await ev(() => { window.__dev.game.elevate(12); window.__frames(20); });
  s = await state();
  check(s.lamps.angle === false && s.tilt > 0.15, 'ствол поднят: лампа «УГОЛ ЗАРЯЖАНИЯ» погасла, казённик наклонён', { tilt: s.tilt });
  d0 = s.denied; await drag('breechLever', 120); s = await state();
  check(s.denied === d0 + 1 && !s.breech.open && !s.breech.busy && s.lever === false, 'открыть затвор на угле 12° — один отказ, рычаг вернулся', { denied: s.denied - d0, lever: s.lever, last: s.lastDenied });
  await ev(() => { window.__dev.game.elevate(-12); window.__frames(20); });

  // --- открыть затвор протяжкой рычага вниз
  d0 = (await state()).denied; await drag('breechLever', 120); s = await state();
  check(s.breech.busy === 'open' && s.lever === true && s.lamps.busy === true && s.lamps.closed === false && s.denied === d0, 'рычаг «ЗАТВОР» вниз — затвор открывается, «МЕХАНИЗМ ЗАНЯТ»', s.breech);
  d0 = s.denied; await tap('hoistButton'); s = await state();
  check(s.denied === d0 + 1 && s.breech.busy === 'open', 'подача во время работы механизма — отказ «занят»', s.lastDenied);
  await ff(1.3); s = await state();
  check(s.breech.open && !s.breech.busy && s.lever === true && s.trayY > -0.01 && s.lamps.busy === false, 'затвор открыт, лоток поднят', s.breech);

  // --- тип снаряда и подача
  await tap('shellToggle'); s = await state();
  check(s.type === 'ap', 'тумблер: касание — ББ', s.type);
  await tap('shellToggle'); s = await state();
  check(s.type === 'he', 'тумблер: касание — снова ОФ', s.type);
  await tap('shellToggle');
  const ap0 = (await state()).shells.ap;
  await tap('hoistButton'); s = await state();
  check(s.breech.busy === 'hoist' && s.shells.ap === ap0 - 1 && s.shellVisible, 'кнопка «ПОДАТЬ СНАРЯД» — ББ едет на элеваторе', s.breech);
  await ff(2.6); s = await state();
  check(s.breech.shell === 'ap' && !s.breech.rammed && s.shellVisible && s.counters.ap === ap0 - 1, 'снаряд ББ на лотке, счётчик ББ уменьшился', s.breech);
  d0 = s.denied; await tap('breechLever'); s = await state();
  check(s.denied === d0 + 1 && s.breech.open && s.lever === true, 'закрыть затвор со снарядом на лотке — отказ, рычаг остался «ОТКРЫТ»', s.lastDenied);
  d0 = s.denied; await tap('chargePlus'); s = await state();
  check(s.denied === d0 + 1 && s.breech.charges === 0, 'заряд до досылки — отказ', s.lastDenied);

  // --- досылка
  await tap('ramLever'); s = await state();
  check(!s.breech.busy && !s.breech.rammed, 'касание рычага «ДОСЛАТЬ» без протяжки ничего не делает');
  await drag('ramLever', 120); s = await state();
  check(s.breech.busy === 'ram', 'рычаг «ДОСЛАТЬ» вниз — досылка', s.breech);
  await ff(1.9); s = await state();
  check(s.breech.rammed && !s.breech.busy, 'снаряд дослан', s.breech);

  // --- заряды
  for (let i = 1; i <= 3; i++) { await tap('chargePlus'); await ff(1.0); }
  s = await state();
  check(s.breech.charges === 3 && s.counters.charges === 3, '«ЗАРЯД +» ×3 — три картуза', s.breech);
  await tap('chargeMinus'); await ff(0.7); s = await state();
  check(s.breech.charges === 2 && s.counters.charges === 2, '«ЗАРЯД −» — два картуза', s.breech);
  await tap('chargePlus'); d0 = (await state()).denied; await tap('chargePlus'); s = await state();
  check(s.denied === d0 + 1, '«ЗАРЯД +» во время подачи картуза — отказ', s.lastDenied);
  await ff(1.0);

  // --- закрыть затвор протяжкой вверх
  await drag('breechLever', -120); s = await state();
  check(s.breech.busy === 'close' && s.lever === false, 'рычаг «ЗАТВОР» вверх — затвор закрывается', s.breech);
  await ff(1.3); s = await state();
  check(!s.breech.open && s.lamps.closed === true && s.trayY < -0.3 && s.breech.charges === 3, 'затвор закрыт, орудие заряжено (ББ, 3 заряда)', s.breech);

  // --- выстрел: откат
  const fired = await ev(() => { const g = window.__dev.game; g.setBrake(true); g.arm(true); const r = g.fire(); window.__frames(3); return r; });
  s = await state();
  check(fired && fired.ok && s.recoilZ > 0.2, 'выстрел: казённик откатился', { fired, recoilZ: s.recoilZ });
  await frames(60); s = await state();
  check(Math.abs(s.recoilZ) < 1e-6 && !s.breech.shell && s.breech.charges === 0, 'накат завершён, орудие пусто', { recoilZ: s.recoilZ });

  // --- разряжание
  await tap('breechLever'); await ff(1.3);
  await tap('shellToggle'); await tap('hoistButton'); await ff(2.6);
  await drag('ramLever', 120); await ff(1.9); await tap('chargePlus'); await ff(1.0);
  s = await state(); const he1 = s.shells.he;
  check(s.breech.shell === 'he' && s.breech.rammed && s.breech.charges === 1, 'заряжено ОФ + 1 заряд (затвор открыт касанием рычага)', s.breech);
  await tap('unloadButton'); s = await state();
  check(s.breech.busy === 'unload', '«РАЗРЯДИТЬ» — идёт разряжание', s.breech);
  await ff(2.1); s = await state();
  check(!s.breech.shell && s.breech.charges === 0 && s.shells.he === he1 + 1 && !s.shellVisible && s.counters.he === he1 + 1, 'разряжено: снаряд вернулся в погреб', s.breech);

  // --- перезапуск задания: пост читает новое состояние, без ошибок
  await ev(() => { const g = window.__dev.game; g.startMission(1); window.__frames(3); g.begin(); window.__frames(10); });
  s = await state();
  check(!s.breech.open && s.lever === false && s.lamps.closed === true && s.counters.he === s.shells.he && s.trayY < -0.3, 'новое задание: рычаг и приборы сброшены', { lever: s.lever, counters: s.counters, shells: s.shells });
  await drag('breechLever', 120); s = await state();
  check(s.breech.busy === 'open', 'после перезапуска рычаг работает с новым состоянием', s.breech);
  await ev(() => { const g = window.__dev.game; g.quit(); window.__frames(5); });
  check(true, 'фаза меню — кадры без исключений');

  check(errors.length === 0, 'нет ошибок и предупреждений консоли', errors);
  console.log(`\n${failed ? 'ПРОВАЛ' : 'УСПЕХ'}: ${passed} проверок пройдено, ${failed} не пройдено`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
