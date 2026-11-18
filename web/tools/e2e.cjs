// Сквозная проверка боевой сборки: задание проходится действиями игры, оболочка должна показать итог.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true })).newPage();
  p.setDefaultTimeout(300000);
  let errs = 0;
  p.on('pageerror', e => { errs++; console.log('PAGEERROR', e.message); });
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') { errs++; console.log('CONSOLE', m.text()); } });
  await p.goto('file://' + path.resolve(__dirname, '../../app/src/main/assets/www/index.html'));
  await p.waitForFunction(() => window.__arta);
  // первое открытие после обновления — окно «ЧТО НОВОГО»
  if (await p.isVisible('#dialog.show')) await p.click('#dlgBtns .btn');
  await p.click('[data-act=campaign]'); await p.click('.m-card'); await p.click('#dlgBtns .btn');
  const res = await p.evaluate(async () => {
    const { game, engine } = __arta, s = game.state, RAD = Math.PI / 180;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const until = async (f) => { for (let i = 0; i < 3000 && !f(); i++) { game.update(0.1); await sleep(0); } return f(); };
    const order = ['plot', 'computer', 'loading', 'traverse', 'elevation', 'fire'];
    await until(() => s.targets[0].reported);
    const t = s.targets[0], bat = s.mission.battery;
    engine.gotoStation('plot', { instant: true });
    game.setPin(t.id, t.reported.x, t.reported.y);
    const dx = t.reported.x - bat.x, dy = t.reported.y - bat.y, rng = Math.hypot(dx, dy), brg = ((Math.atan2(dx, dy) / RAD) + 360) % 360;
    game.setAlidade({ bearing: brg, range: rng }); game.recordMeasurement();
    engine.gotoStation('computer', { instant: true });
    game.setComputerRange(rng); const ch = game.chargeStates().indexOf('ok') + 1; game.setComputerCharge(ch); const sol = game.compute();
    engine.gotoStation('loading', { instant: true });
    game.openBreech(); await until(() => !s.breech.busy); game.hoistShell('he'); await until(() => !s.breech.busy);
    game.ramShell(); await until(() => !s.breech.busy);
    for (let i = 0; i < ch; i++) { game.addCharge(); await until(() => !s.breech.busy); }
    game.closeBreech(); await until(() => !s.breech.busy);
    engine.gotoStation('traverse', { instant: true });
    game.setBrake(false); game.rotateTurret(s.plot.recorded[t.id].bearing - s.turret.bearing); game.setBrake(true);
    engine.gotoStation('elevation', { instant: true });
    game.elevate(sol.elevation - s.turret.elevation);
    engine.gotoStation('fire', { instant: true });
    const check = { ...s.checklist };
    game.arm(true); const f = game.fire();
    await until(() => s.phase !== 'playing');
    await sleep(2500);
    return { fired: f.ok, check, phase: s.phase, shots: s.shots, dialog: document.getElementById('dlgBody').innerText.replace(/\n+/g, ' | ').slice(0, 220), hud: document.getElementById('memo').innerText };
  });
  console.log(JSON.stringify(res, null, 1));
  await p.screenshot({ path: process.argv[2] || '/tmp/e2e.png' });
  console.log('errors', errs);
  await b.close();
  process.exit(errs || res.phase !== 'won' ? 1 : 0);
})();
