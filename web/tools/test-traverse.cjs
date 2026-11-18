// Тест поста «ПОВОРОТ»: настоящий ввод указателем по органам + проверка game.state и показаний приборов.
//   cd web && node build.mjs --dev st-traverse && node tools/test-traverse.cjs [ширина высота]     (по умолчанию 844 390; код возврата ≠ 0 при ошибке)
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const W = +process.argv[2] || 844, H = +process.argv[3] || 390;
  const p = await b.newPage({ viewport: { width: W, height: H } });
  p.setDefaultTimeout(180000);
  const problems = [];
  p.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.type() + ': ' + m.text()); });
  await p.goto('file://' + path.resolve(__dirname, '../.dev/st-traverse/index.html'));
  await p.waitForFunction('window.__dev', null, { timeout: 180000 });
  await p.waitForTimeout(1200);

  let failed = 0, passed = 0;
  const ok = (cond, name, info) => { if (cond) { passed++; console.log('  ok  ' + name); } else { failed++; console.log('FAIL  ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); } };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;

  // цикл кадров останавливаем и шагаем вручную: тест не зависит от скорости программного WebGL
  await p.evaluate(() => {
    const { engine, game } = window.__dev;
    engine.stop();
    window.__denied = [];
    game.on('denied', (d) => window.__denied.push(d.action + ': ' + d.reason));
    window.__servo = [];
    const servo = engine.audio.servo;
    engine.audio.servo = function (l) { window.__servo.push(l); return servo.apply(this, arguments); };
    engine.debug.step(0.016, true);
  });
  const step = (n = 1, dt = 0.05) => p.evaluate(([n, dt]) => { for (let i = 0; i < n; i++) window.__dev.engine.debug.step(dt, false); }, [n, dt]);
  const st = () => p.evaluate(() => {
    const { game, stations } = window.__dev, s = game.state;
    return { turret: { ...s.turret }, phase: s.phase, denied: window.__denied.length, lastDenied: window.__denied[window.__denied.length - 1] || null, servoLast: window.__servo[window.__servo.length - 1], i: stations[0].inspect() };
  });
  const pos = (name) => p.evaluate((name) => {
    const { engine, stations } = window.__dev, v = new engine.THREE.Vector3();
    stations[0].hotspots[name].getWorldPosition(v);
    const s = engine.input.toScreen(v); return { x: s.x, y: s.y };
  }, name);
  // точка на ободе маховика: a — угол от верхней точки по часовой для игрока, рад
  const rim = (a) => p.evaluate((a) => {
    const { engine, stations } = window.__dev, r = stations[0].hotspots.fineWheelRim;
    const R = r.position.y, v = new engine.THREE.Vector3(R * Math.sin(a), R * Math.cos(a), r.position.z);
    r.parent.updateWorldMatrix(true, false); r.parent.localToWorld(v);
    const s = engine.input.toScreen(v); return { x: s.x, y: s.y };
  }, a);
  async function turnWheel(fromDeg, toDeg) {           // ведём палец по ободу шагами по 1°
    const dir = Math.sign(toDeg - fromDeg), a0 = await rim(fromDeg * Math.PI / 180);
    await p.mouse.move(a0.x, a0.y); await p.mouse.down();
    for (let d = fromDeg + dir; dir > 0 ? d <= toDeg : d >= toDeg; d += dir) {
      const q = await rim(d * Math.PI / 180); await p.mouse.move(q.x, q.y);
    }
    await step(1); await p.mouse.up(); await step(2);
  }

  const names = await p.evaluate(() => Object.keys(window.__dev.stations[0].hotspots));
  console.log('hotspots:', names.join(', '));
  for (const k of ['brakeLever', 'slewLever', 'fineWheel', 'fineWheelRim']) {
    const q = await pos(k);
    ok(q.x > 20 && q.x < W - 20 && q.y > 44 && q.y < H - 60, `орган ${k} в зоне управления`, q);
  }

  // ---- 1. исходное состояние: стопор ----
  let s = await st();
  ok(s.phase === 'playing' && s.turret.brake === true, 'бой идёт, башня на стопоре', s.turret);
  ok(s.i.lampBrake === true && s.i.lampFree === false && s.i.leverFree === false, 'лампа СТОПОР горит, рычаг в положении СТОПОР', s.i);
  ok(s.i.setCounter === null && s.i.bugVisible === false && s.i.lampAligned === false, 'нет записи — ЗАДАНО пусто, метки нет');

  // ---- 2. отказ: привод на стопоре (одно сообщение за жест) ----
  const sl = await pos('slewLever');
  await p.mouse.move(sl.x, sl.y); await p.mouse.down(); await p.mouse.move(sl.x + 30, sl.y, { steps: 4 }); await p.mouse.move(sl.x + 60, sl.y, { steps: 4 });
  await step(12);
  s = await st();
  ok(s.denied === 1 && /стопор/i.test(s.lastDenied || ''), 'привод на стопоре: ровно один отказ за жест', [s.denied, s.lastDenied]);
  ok(s.turret.bearing === 0, 'башня не повернулась', s.turret);
  ok(s.i.lampBrake === 'blink', 'лампа СТОПОР мигает', s.i.lampBrake);
  ok(!s.i.servo, 'привод молчит на стопоре', s.i.servo);
  await p.mouse.up(); await step(2);
  // ---- 3. отказ: маховик на стопоре ----
  await turnWheel(0, 60);
  s = await st();
  ok(s.denied === 2, 'маховик на стопоре: ровно один отказ за жест', s.denied);
  ok(s.turret.bearing === 0 && near(s.i.wheelAngle, 0, 1e-6), 'маховик на стопоре не проворачивается', [s.turret.bearing, s.i.wheelAngle]);
  await step(45);
  s = await st();
  ok(s.i.lampBrake === true, 'мигание прекращается, лампа СТОПОР снова горит ровно', s.i.lampBrake);

  // ---- 4. рычаг стопора: касание → СВОБОДНО ----
  const bl = await pos('brakeLever');
  await p.mouse.move(bl.x, bl.y); await p.mouse.down(); await p.mouse.up(); await step(8);
  s = await st();
  ok(s.turret.brake === false, 'касание рычага снимает стопор', s.turret);
  ok(s.i.lampBrake === false && s.i.lampFree === true && s.i.leverFree === true, 'лампа СВОБОДНО горит, СТОПОР погасла', s.i);

  // ---- 5. привод: вправо на полный ход ----
  await p.mouse.move(sl.x, sl.y); await p.mouse.down(); await p.mouse.move(sl.x + 40, sl.y, { steps: 4 }); await p.mouse.move(sl.x + 90, sl.y, { steps: 4 });
  await step(20);                                              // 1 с
  s = await st();
  ok(s.i.slew === 1 && s.turret.bearing > 10.5 && s.turret.bearing <= 12.01, 'привод вправо: ≈12°/с', [s.i.slew, s.turret.bearing]);
  ok(s.i.pressure > 60, 'давление растёт при работе привода', s.i.pressure);
  ok(s.i.servo > 0.9 && s.servoLast > 0.9, 'звук привода следует за скоростью', [s.i.servo, s.servoLast]);
  ok(near(s.i.cardDeg, s.turret.bearing, 1e-6) && near(s.i.bearingCounter, s.turret.bearing, 1e-6), 'картушка и счётчик следуют за пеленгом', s.i);
  const pHigh = s.i.pressure;
  await p.mouse.up(); await step(40);
  let s2 = await st();
  ok(s2.i.slew === 0 && s2.i.servo === 0 && s2.servoLast === 0, 'рычаг отпущен: привод остановлен, звук 0', s2.i);
  ok(s2.turret.bearing === s.turret.bearing, 'после отпускания башня стоит', [s.turret.bearing, s2.turret.bearing]);
  ok(s2.i.pressure < pHigh - 15, 'давление спадает', [pHigh, s2.i.pressure]);
  // малый ход влево: медленно и точно
  const b0 = s2.turret.bearing;
  await p.mouse.move(sl.x, sl.y); await p.mouse.down(); await p.mouse.move(sl.x - 14, sl.y, { steps: 4 });
  await step(20);
  s = await st();
  const dv = s.turret.bearing - b0;
  ok(s.i.slew < 0 && s.i.slew > -0.6 && dv < -0.05 && dv > -4, 'привод влево на малом ходу: медленно (квадратичная характеристика)', [s.i.slew, dv]);
  ok(near(dv, -s.i.slew * s.i.slew * 12, 0.15), 'скорость = v²·12°/с', [dv, s.i.slew]);
  await p.mouse.up(); await step(2);
  ok((await st()).denied === 2, 'без стопора отказов нет');

  // ---- 6. маховик точной наводки: 1° на оборот, доли 0.01° не теряются ----
  s = await st();
  await turnWheel(0, 90);
  s2 = await st();
  ok(near(s2.turret.bearing - s.turret.bearing, 0.25, 0.03), 'четверть оборота по часовой = +0.25°', s2.turret.bearing - s.turret.bearing);
  await turnWheel(90, -90);
  s = await st();
  ok(near(s.turret.bearing - s2.turret.bearing, -0.5, 0.04), 'пол-оборота против часовой = −0.50°', s.turret.bearing - s2.turret.bearing);
  ok(near(s.i.wheelAngle, -Math.PI / 2, 0.2), 'маховик идёт за пальцем', s.i.wheelAngle);

  // ---- 7. запись пеленга на планшете → ЗАДАНО, метка, рассогласование, СОВМЕЩЕНО ----
  const rec = await p.evaluate(() => {
    const { game } = window.__dev; let n = 0;
    while (!game.state.targets.some((t) => t.reported) && n++ < 600) game.update(0.5);
    const t = game.state.targets.find((t) => t.reported); if (!t) return null;
    game.selectTarget(t.id); game.setAlidade({ bearing: 47.3, range: 8 }); const r = game.recordMeasurement();
    game.rotateTurret(41.87 - game.state.turret.bearing);
    return { r, b: game.state.turret.bearing };
  });
  ok(rec && rec.r.ok, 'пеленг цели записан на планшете', rec);
  await step(60);
  s = await st();
  ok(s.i.setCounter === 47.3 && s.i.bugVisible, 'ЗАДАНО = 047.3, метка на картушке', s.i);
  ok(near(s.i.error, s.turret.bearing - 47.3, 1e-6) && near(s.i.bugDeg, 47.3 - s.turret.bearing, 1e-6), 'рассогласование и метка = разность пеленгов', s.i);
  ok(s.i.lampAligned === false, 'СОВМЕЩЕНО не горит при рассогласовании');
  await p.evaluate(() => { const g = window.__dev.game; g.rotateTurret(-100); }); await step(3);
  s = await st();
  ok(s.i.error === -10, 'прибор рассогласования ограничен ±10°', s.i.error);
  await p.evaluate(() => { const g = window.__dev.game; g.rotateTurret(47.34 - g.state.turret.bearing); }); await step(3);
  s = await st();
  ok(s.i.lampAligned === true, 'СОВМЕЩЕНО горит в пределах ±0.05°', [s.turret.bearing, s.i.error]);
  await p.evaluate(() => { const g = window.__dev.game; g.rotateTurret(0.03); }); await step(3);
  s = await st();
  ok(s.i.lampAligned === false, 'СОВМЕЩЕНО гаснет при 0.07°', [s.turret.bearing, s.i.error]);
  // доводка маховиком до совмещения
  await turnWheel(0, -25);
  s = await st();
  ok(s.i.lampAligned === true && near(s.turret.bearing, 47.3, 0.05), 'доводка маховиком: СОВМЕЩЕНО', [s.turret.bearing, s.i.error]);

  // ---- 8. рычаг стопора: протяжка вверх → СТОПОР; внешнее изменение состояния ----
  const bl2 = await pos('brakeLever');
  await p.mouse.move(bl2.x, bl2.y); await p.mouse.down(); await p.mouse.move(bl2.x, bl2.y - 30, { steps: 5 }); await p.mouse.move(bl2.x, bl2.y - 70, { steps: 5 }); await p.mouse.up(); await step(8);
  s = await st();
  ok(s.turret.brake === true && s.i.lampBrake === true && s.i.lampFree === false && s.i.leverFree === false, 'протяжка рычага вверх ставит на стопор', [s.turret, s.i.lampBrake, s.i.leverFree]);
  const chk = await p.evaluate(() => window.__dev.game.state.checklist.traversed);
  ok(chk === true, 'игра отмечает «наведено по пеленгу»', chk);
  await p.evaluate(() => window.__dev.game.setBrake(false)); await step(3);
  s = await st();
  ok(s.i.leverFree === true && s.i.lampFree === true, 'рычаг и лампы повторяют state.turret.brake (изменён извне)', s.i);

  // ---- 9. новый бой: состояние заменено, пост читает его заново ----
  await p.evaluate(() => { const g = window.__dev.game; g.startMission(1); }); await step(3);
  s = await st();
  ok(s.phase === 'briefing' && s.i.setCounter === null && !s.i.bugVisible && s.i.lampBrake === true && s.i.leverFree === false && s.i.cardDeg === s.turret.bearing, 'перезапуск задания: показания сброшены', [s.phase, s.i]);
  const d0 = s.denied;
  await p.mouse.move(sl.x, sl.y); await p.mouse.down(); await p.mouse.move(sl.x + 60, sl.y, { steps: 6 }); await step(6); await p.mouse.up(); await step(2);
  s = await st();
  ok(s.denied === d0 && s.i.servo === 0, 'вне боя (инструктаж) привод молчит и не вызывает отказов', [s.denied, d0]);
  await p.evaluate(() => { const g = window.__dev.game; g.begin(); g.setBrake(false); }); await step(2);
  await p.mouse.move(sl.x, sl.y); await p.mouse.down(); await p.mouse.move(sl.x - 90, sl.y, { steps: 8 }); await step(10);
  s = await st();
  ok(s.turret.bearing > 353 && s.turret.bearing < 355 && near(s.i.bearingCounter, s.turret.bearing, 1e-6), 'в новом бою привод вращает новую башню (через 0° → 354°)', s.turret);
  // уход с поста во время работы привода
  await p.evaluate(() => window.__dev.stations[0].onLeave()); await step(4);
  s2 = await st();
  ok(s2.i.servo === 0 && s2.servoLast === 0 && s2.turret.bearing === s.turret.bearing, 'onLeave глушит привод; удерживаемый рычаг больше не действует', [s2.i.servo, s2.turret.bearing]);
  await p.mouse.up(); await step(2);
  await p.evaluate(() => window.__dev.stations[0].onEnter());
  await p.mouse.move(sl.x, sl.y); await p.mouse.down(); await p.mouse.move(sl.x + 90, sl.y, { steps: 8 }); await step(10);
  s = await st();
  ok(s.turret.bearing > 359 || s.turret.bearing < 1, 'новый жест после возврата на пост снова работает', s.turret);
  await p.mouse.up(); await step(2);
  await p.evaluate(() => { const g = window.__dev.game; g.quit(); }); await step(5);
  s = await st();
  ok(s.phase === 'menu', 'выход в меню без ошибок', s.phase);
  const calls = await p.evaluate(() => { const e = window.__dev.engine; e.debug.step(0.016, true); return e.debug.stats().calls; });
  ok(calls <= 120, 'вызовов отрисовки ≤ 120', calls);

  ok(problems.length === 0, 'нет ошибок и предупреждений в консоли', problems);
  await b.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
