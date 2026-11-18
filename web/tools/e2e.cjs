// Сквозная проверка боевой сборки. Три сценария подряд на одной странице:
//  1) первое задание проходится действиями игры — оболочка показывает итог (опыт, звание);
//  2) из итога открывается «РАЗБОР БОЯ» — карта не пустая, строк столько же, сколько выстрелов, строка подсвечивается;
//  3) «ОБОРОНА» — первая волна уничтожается действиями игры, должна прийти вторая.
//   node tools/e2e.cjs [итог.png]   (рядом кладутся <итог>-debrief.png и <итог>-survival.png)
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true })).newPage();
  p.setDefaultTimeout(300000);
  const shot = process.argv[2] || '/tmp/e2e.png', shotOf = (tag) => shot.replace(/(\.png)?$/, '-' + tag + '.png');
  let errs = 0;
  const fail = (msg) => { errs++; console.log('FAIL', msg); };
  p.on('pageerror', e => { errs++; console.log('PAGEERROR', e.message); });
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') { errs++; console.log('CONSOLE', m.text()); } });
  await p.goto('file://' + path.resolve(__dirname, '../../app/src/main/assets/www/index.html'));
  await p.waitForFunction(() => window.__arta);
  // первое открытие после обновления — окно «ЧТО НОВОГО»
  if (await p.isVisible('#dialog.show')) await p.click('#dlgBtns .btn');
  const menu = await p.evaluate(() => ({ rank: document.getElementById('rankName').innerText + ' ' + document.getElementById('rankXp').innerText, survival: !!document.querySelector('[data-act=survival]') }));
  console.log('menu', JSON.stringify(menu));
  if (!/ЗВАНИЕ: \S+/.test(menu.rank) || !menu.survival) fail('в меню нет звания или кнопки «ОБОРОНА»');

  // ---------- 1. первое задание ----------
  await p.click('[data-act=campaign]'); await p.click('.m-card'); await p.click('#dlgBtns .btn');
  const res = await p.evaluate(async () => {
    const { game, engine } = __arta, s = game.state, RAD = Math.PI / 180;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const until = async (f) => { for (let i = 0; i < 3000 && !f(); i++) { game.update(0.1); await sleep(0); } return f(); };
    window.__e2e = { sleep, until };
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
    return { fired: f.ok, check, phase: s.phase, shots: s.shots, dialog: document.getElementById('dlgBody').innerText.replace(/\n+/g, ' | ').slice(0, 260), hud: document.getElementById('memo').innerText,
      shells: document.getElementById('hShells').innerText, btns: [...document.querySelectorAll('#dlgBtns .btn')].map((x) => x.textContent) };
  });
  console.log(JSON.stringify(res, null, 1));
  await p.screenshot({ path: shot });
  if (res.phase !== 'won') fail('задание не выиграно');
  if (!/ОПЫТ \+\d+/.test(res.dialog)) fail('в итогах нет опыта');
  if (!res.btns.includes('РАЗБОР БОЯ')) fail('в итогах нет кнопки «РАЗБОР БОЯ»');

  // ---------- 2. разбор боя ----------
  if (res.btns.includes('РАЗБОР БОЯ')) {
    await p.click('#dlgBtns .btn:has-text("РАЗБОР БОЯ")');
    await p.click('#dbfTable tr[data-n]');
    const dbf = await p.evaluate(() => {
      const c = document.getElementById('dbfCanvas'), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data, seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 7) seen.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3));
      const r = c.getBoundingClientRect(), side = document.getElementById('dbfTable').getBoundingClientRect();
      return { visible: document.getElementById('debrief').classList.contains('show'), size: c.width, colors: seen.size, rows: document.querySelectorAll('#dbfTable tr[data-n]').length,
        on: document.querySelectorAll('#dbfTable tr.on').length, selected: __arta.game.state.history.length, fits: r.bottom <= innerHeight && side.right <= innerWidth && r.width > 150 && side.width > 200,
        first: (document.querySelector('#dbfTable tr[data-n]') || {}).innerText };
    });
    console.log('debrief', JSON.stringify(dbf));
    await p.screenshot({ path: shotOf('debrief') });
    if (!dbf.visible || dbf.colors < 5) fail('карта разбора пуста');
    if (dbf.rows !== res.shots || dbf.rows !== dbf.selected) fail('строк в таблице разбора не столько, сколько выстрелов');
    if (dbf.on !== 1) fail('строка разбора не подсветилась');
    if (!dbf.fits) fail('разбор не помещается на экран');
    await p.click('[data-act=debriefZoom]');
    await p.click('[data-act=closeDebrief]');
    if (!(await p.isVisible('#dialog.show'))) fail('после разбора не вернулись к итогам');
  }
  await p.click('#dlgBtns .btn:has-text("В МЕНЮ")');

  // ---------- 3. оборона ----------
  await p.click('[data-act=survival]'); await p.click('#dlgBtns .btn');
  const sv = await p.evaluate(async () => {
    const { game, engine } = __arta, s = game.state, RAD = Math.PI / 180, { until } = window.__e2e;
    const bat = s.mission.battery, log = [];
    const idle = async () => until(() => !s.breech.busy);
    /** Полный выстрел действиями игры по истинному положению цели (с упреждением), без рассеивания. */
    async function shootAt(t) {
      const aim = (tof) => { const v = t.moving ? (t.speed / 3600) * tof : 0; return { x: t.x + v * Math.sin(t.course * RAD), y: t.y + v * Math.cos(t.course * RAD) }; };
      const lay = (q) => { const dx = q.x - bat.x, dy = q.y - bat.y; return { rng: Math.hypot(dx, dy), brg: ((Math.atan2(dx, dy) / RAD) + 360) % 360 }; };
      const type = t.armored ? 'ap' : s.shells.he > 0 ? 'he' : 'shrap';
      if (!(s.shells[type] > 0)) return 'нет снарядов ' + type;
      const r0 = lay(aim(30)).rng;
      let ch = 0;
      for (let n = 1; n <= 6 && !ch; n++) { const l = game.chargeRange(n); if (r0 > l.min + 0.4 && r0 < l.max - 0.4) ch = n; }
      if (!ch) return 'вне досягаемости';
      if (t.reported || t.area) game.selectTarget(t.id);
      engine.gotoStation('loading', { instant: true });
      if (s.turret.elevation > game.C.LOAD_ANGLE) game.elevate(game.C.LOAD_ANGLE - s.turret.elevation);
      game.openBreech(); await idle(); game.hoistShell(type); await idle(); game.ramShell(); await idle();
      for (let i = 0; i < ch; i++) { game.addCharge(); await idle(); }
      game.closeBreech(); await idle();
      if (!t.alive) { game.openBreech(); await idle(); game.unload(); await idle(); game.closeBreech(); await idle(); return 'цель выбыла'; }
      let sol = null, q = null;
      for (let i = 0, tof = 30; i < 4; i++) { q = lay(aim(tof)); game.setComputerRange(q.rng); game.setComputerCharge(ch); sol = game.compute(); if (!sol.ok) break; tof = sol.tof; }
      if (!sol || !sol.ok) { game.openBreech(); await idle(); game.unload(); await idle(); game.closeBreech(); await idle(); return 'нет решения'; }
      game.setAlidade({ bearing: q.brg, range: q.rng }); if (t.reported || t.area) { game.setPin(t.id, Math.max(0, Math.min(20, aim(sol.tof).x)), Math.max(0, Math.min(20, aim(sol.tof).y))); game.recordMeasurement(); }
      engine.gotoStation('fire', { instant: true });
      game.setBrake(false); game.rotateTurret(q.brg + (sol.windBearing || 0) - s.turret.bearing); game.setBrake(true);
      game.elevate(sol.elevation - s.turret.elevation);
      game.arm(true);
      const R = Math.random; Math.random = () => 0.25; let f; try { f = game.fire(); } finally { Math.random = R; }
      if (!f.ok) return 'отказ: ' + f.reason;
      await until(() => !s.flight.length);
      return t.alive ? 'hp ' + t.hp : 'уничтожена';
    }
    const wave1 = s.targets.map((t) => t.id);
    await until(() => s.targets.some((t) => t.active));
    for (let i = 0; i < 30 && s.wave < 2 && s.phase === 'playing'; i++) {
      const t = s.targets.filter((x) => x.alive && x.active).sort((a, c) => (c.moving ? 1 : 0) - (a.moving ? 1 : 0))[0];
      if (!t) { await until(() => s.wave >= 2 || s.phase !== 'playing' || s.targets.some((x) => x.alive && x.active)); continue; }
      const r = await shootAt(t); log.push(t.id + ':' + r);
      if (/вне|нет/.test(r)) { for (let k = 0; k < 100; k++) game.update(0.1); }
    }
    for (let i = 0; i < 50 && document.getElementById('hTimeK').innerText !== 'ВОЛНА ' + s.wave; i++) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => setTimeout(r, 500));
    return { wave: s.wave, phase: s.phase, kills: s.kills, shots: s.shots, integrity: s.integrity, log, wave1, ids: s.targets.map((t) => t.id), shells: { ...s.shells },
      hudWave: document.getElementById('hTimeK').innerText, hudShells: document.getElementById('hShells').innerText, wind: document.getElementById('hWind').innerText };
  });
  console.log('survival', JSON.stringify(sv));
  await p.screenshot({ path: shotOf('survival') });
  if (sv.wave < 2 || sv.phase !== 'playing') fail('вторая волна обороны не началась');
  if (sv.kills < 1) fail('в обороне не уничтожено ни одной цели');
  if (!sv.ids.every((id) => !sv.wave1.includes(id))) fail('во второй волне остались цели первой');
  if (sv.hudWave !== 'ВОЛНА ' + sv.wave) fail('HUD не показывает номер волны: ' + sv.hudWave);
  if (!/ОСВ/.test(sv.hudShells)) fail('HUD не показывает пополненные снаряды: ' + sv.hudShells);
  await p.evaluate(() => __arta.game.quit());

  console.log('errors', errs);
  await b.close();
  process.exit(errs ? 1 : 0);
})();
