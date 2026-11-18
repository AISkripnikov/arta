// Сквозная проверка боевой сборки. Три сценария подряд на одной странице:
//  1) первое задание проходится действиями игры — оболочка показывает итог (опыт, звание);
//  2) из итога открывается «РАЗБОР БОЯ» — карта не пустая, строк столько же, сколько выстрелов, строка подсвечивается;
//  0) меню: кнопки, «СНАБЖЕНИЕ» (покупка и сброс), «НАСТРОЙКИ» (размер надписей, левша), сохранённый бой (перезагрузка → «ПРОДОЛЖИТЬ БОЙ»);
//  3) «ОБОРОНА» — первая волна уничтожается действиями игры, должна прийти вторая;
//  4) «ЗАДАНИЕ ДНЯ» — брифинг и начало боя;
//  5) конвой с налётом — значки расчёта и аптечка, свои в блокноте, тревога «ВОЗДУХ!» → пост ЗЕНИТКА, итоги и разбор со своими.
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

  // ---------- 0. меню: новые кнопки, снабжение, настройки, сохранённый бой ----------
  const btnsNew = await p.evaluate(() => ['daily', 'upgrades', 'settings'].filter((a) => { const el = document.querySelector('#menu [data-act=' + a + ']'); return !el || !el.offsetWidth; }));
  if (btnsNew.length) fail('в меню нет кнопок: ' + btnsNew.join(', '));
  const dailyTxt = await p.innerText('#dailyBtn');
  if (!/ЗАДАНИЕ ДНЯ/.test(dailyTxt) || !/\d\d\.\d\d/.test(dailyTxt)) fail('кнопка задания дня без даты: ' + dailyTxt);
  if (await p.isVisible('#resumeBox')) fail('«ПРОДОЛЖИТЬ БОЙ» показано без сохранённого боя');
  // снабжение: опыт подбрасываем, покупаем, сбрасываем
  const xp0 = await p.evaluate(() => { const g = __arta.game, x = g.save.xp; g.save.xp = 2000; return x; });
  await p.click('[data-act=upgrades]');
  const up0 = await p.evaluate(() => ({ cards: document.querySelectorAll('#upGrid .up-card').length, pts: +document.getElementById('upPoints').innerText, real: __arta.game.points(),
    fits: [...document.querySelectorAll('#upGrid .up-card')].every((c) => { const r = c.getBoundingClientRect(); return r.bottom <= innerHeight && r.right <= innerWidth && c.scrollHeight <= c.clientHeight + 1; }) }));
  await p.click('#upGrid [data-buy=hoist]');
  const up1 = await p.evaluate(() => ({ pts: +document.getElementById('upPoints').innerText, level: __arta.game.upgrades()[0].level, pips: document.querySelectorAll('#upGrid [data-up=hoist] .up-pips i.on').length }));
  await p.click('#upReset'); await p.click('#dlgBtns .btn:has-text("СБРОСИТЬ")');
  const up2 = await p.evaluate(() => ({ pts: +document.getElementById('upPoints').innerText, level: __arta.game.upgrades()[0].level, shown: document.getElementById('upgrades').classList.contains('show') }));
  console.log('upgrades', JSON.stringify({ up0, up1, up2 }));
  if (up0.cards !== 6 || up0.pts !== 13 || up0.pts !== up0.real) fail('экран снабжения: не шесть карточек или неверные очки');
  if (!up0.fits) fail('карточки снабжения не помещаются');
  if (up1.level !== 1 || up1.pips !== 1 || up1.pts !== up0.pts - 2) fail('улучшение не куплено');
  if (up2.level !== 0 || up2.pts !== up0.pts || !up2.shown) fail('сброс улучшений не вернул очки');
  await p.click('#upgrades [data-upact=close]');
  const badge = await p.evaluate(() => document.getElementById('upBadge').classList.contains('show') && document.getElementById('upBadge').innerText);
  if (badge !== '13') fail('нет значка очков на кнопке «СНАБЖЕНИЕ»: ' + badge);
  await p.evaluate((x) => { __arta.game.save.xp = x; }, xp0);
  // настройки: размер надписей, левша, чувствительность
  await p.click('[data-act=settings]');
  await p.click('#setText [data-val="1.3"]'); await p.click('#setLefty [data-val="1"]'); await p.click('#setSens [data-val="1.6"]');
  const set1 = await p.evaluate(() => ({ ts: getComputedStyle(document.documentElement).getPropertyValue('--ts').trim(), xl: document.body.classList.contains('text-xl'), lefty: document.body.classList.contains('lefty'),
    sens: __arta.engine.settings.sens, saved: __arta.game.settings(), dir: getComputedStyle(document.getElementById('topbar')).flexDirection,
    fits: [...document.querySelectorAll('#settings .opt')].every((o) => o.getBoundingClientRect().right <= innerWidth) && document.querySelector('#settings .sheet').getBoundingClientRect().bottom <= innerHeight }));
  console.log('settings', JSON.stringify(set1));
  if (set1.ts !== '1.3' || !set1.xl) fail('размер надписей не применился');
  if (!set1.lefty || set1.dir !== 'row-reverse') fail('режим для левши не применился');
  if (set1.sens !== 1.6 || set1.saved.sens !== 1.6 || set1.saved.text !== 1.3 || set1.saved.lefty !== true) fail('настройки не сохранены');
  if (!set1.fits) fail('экран настроек не помещается');
  await p.click('#setText [data-val="1"]'); await p.click('#setLefty [data-val="0"]'); await p.click('#setSens [data-val="1"]');
  await p.click('#settings [data-setclose]');
  const set2 = await p.evaluate(() => ({ cls: document.body.className, sens: __arta.engine.settings.sens, menu: document.getElementById('menu').classList.contains('show') }));
  if (/lefty|text-xl/.test(set2.cls) || set2.sens !== 1 || !set2.menu) fail('настройки не вернулись к обычным: ' + JSON.stringify(set2));
  // сохранённый бой: начать, свернуть, перезагрузить страницу, продолжить
  await p.click('[data-act=campaign]'); await p.click('.m-card'); await p.click('#dlgBtns .btn');
  const sv0 = await p.evaluate(async () => {
    const { game } = __arta, s = game.state;
    const until = async (f) => { for (let i = 0; i < 3000 && !f(); i++) { game.update(0.1); await new Promise((r) => setTimeout(r, 0)); } return f(); };
    await until(() => s.targets[0].reported);
    const t = s.targets[0];
    game.setPin(t.id, t.reported.x, t.reported.y);
    game.openBreech(); await until(() => !s.breech.busy); game.hoistShell('he'); await until(() => !s.breech.busy);
    s.integrity = 77;
    window.dispatchEvent(new Event('pagehide'));          // уход в фон → game.suspend()
    return { time: s.time, id: t.id, pin: s.plot.pins[t.id], info: game.resumeInfo() };
  });
  await p.reload();
  await p.waitForFunction(() => window.__arta);
  if (await p.isVisible('#dialog.show')) await p.click('#dlgBtns .btn');
  const rb = await p.evaluate(() => ({ shown: !document.getElementById('resumeBox').classList.contains('hidden'), text: document.getElementById('resumeBtn').innerText.replace(/\n+/g, ' | '), phase: __arta.game.state.phase }));
  await p.click('#resumeBtn');
  await p.waitForFunction(() => !document.getElementById('hud').classList.contains('hidden') && document.getElementById('hTime').innerText !== '');
  const sv1 = await p.evaluate(() => { const s = __arta.game.state; return { phase: s.phase, time: s.time, integrity: s.integrity, pin: s.plot.pins[s.targets[0].id], shell: s.breech.shell, open: s.breech.open,
    hudTime: document.getElementById('hTime').innerText, bar: document.getElementById('hInt').style.width, station: __arta.engine.current }; });
  console.log('resume', JSON.stringify({ sv0, rb, sv1 }));
  await p.screenshot({ path: shotOf('resume') });
  if (!sv0.info || !rb.shown || !/ПРОДОЛЖИТЬ БОЙ/.test(rb.text) || rb.phase !== 'menu') fail('после перезагрузки меню не предлагает продолжить бой');
  if (sv1.phase !== 'playing' || sv1.time < sv0.time - 0.01 || sv1.time > sv0.time + 8) fail('время боя не перенеслось: ' + sv0.time + ' → ' + sv1.time);
  if (sv1.integrity !== 77 || sv1.bar !== '77%') fail('прочность не перенеслась');
  if (!sv1.pin || Math.abs(sv1.pin.x - sv0.pin.x) > 1e-6 || sv1.shell !== 'he' || !sv1.open) fail('фишка планшета или затвор не восстановились');
  // пауза → «ВЫЙТИ С СОХРАНЕНИЕМ» → в меню снова есть бой → «сбросить»
  await p.click('[data-act=pause]');
  const pauseBtns = await p.evaluate(() => [...document.querySelectorAll('#dlgBtns .btn')].map((x) => x.textContent));
  if (!pauseBtns.includes('НАСТРОЙКИ') || !pauseBtns.includes('ВЫЙТИ С СОХРАНЕНИЕМ')) fail('в паузе нет настроек или выхода с сохранением: ' + pauseBtns.join(', '));
  await p.click('#dlgBtns .btn:has-text("ВЫЙТИ С СОХРАНЕНИЕМ")');
  const kept = await p.evaluate(() => ({ phase: __arta.game.state.phase, shown: !document.getElementById('resumeBox').classList.contains('hidden'), info: __arta.game.resumeInfo() }));
  if (kept.phase !== 'menu' || !kept.shown || !kept.info || kept.info.integrity !== 77) fail('выход с сохранением не оставил бой: ' + JSON.stringify(kept));
  await p.click('#resumeDrop');
  if (await p.isVisible('#resumeBox') || await p.evaluate(() => !!__arta.game.resumeInfo())) fail('«сбросить» не убрало сохранённый бой');

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
    return { wave: s.wave, phase: s.phase, kills: s.kills, shots: s.shots, integrity: s.integrity, log, wave1, ids: s.targets.filter((t) => t.alive).map((t) => t.id), shells: { ...s.shells },
      hudWave: document.getElementById('hTimeK').innerText, hudShells: document.getElementById('hShells').innerText, wind: document.getElementById('hWind').innerText };
  });
  console.log('survival', JSON.stringify(sv));
  await p.screenshot({ path: shotOf('survival') });
  if (sv.wave < 2 || sv.phase !== 'playing') fail('вторая волна обороны не началась');
  if (sv.kills < 1) fail('в обороне не уничтожено ни одной цели');
  if (!sv.ids.every((id) => !sv.wave1.includes(id))) fail('во второй волне остались живые цели первой');
  if (sv.hudWave !== 'ВОЛНА ' + sv.wave) fail('HUD не показывает номер волны: ' + sv.hudWave);
  if (!/ОСВ/.test(sv.hudShells)) fail('HUD не показывает пополненные снаряды: ' + sv.hudShells);
  await p.evaluate(() => __arta.game.quit());

  // ---------- 4. задание дня ----------
  await p.click('[data-act=daily]');
  const dl0 = await p.evaluate(() => ({ phase: __arta.game.state.phase, head: (document.querySelector('#dlgBody h2') || {}).innerText }));
  await p.click('#dlgBtns .btn');
  const dl1 = await p.evaluate(() => { const s = __arta.game.state, d = new Date(), p2 = (n) => String(n).padStart(2, '0');
    return { phase: s.phase, daily: s.mission.daily, today: d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()), index: s.mission.index, targets: s.targets.length, hud: !document.getElementById('hud').classList.contains('hidden') }; });
  console.log('daily', JSON.stringify({ dl0, dl1 }));
  if (dl0.phase !== 'briefing' || !/ЗАДАНИЕ ДНЯ/.test(dl0.head || '')) fail('брифинг задания дня не открылся');
  if (dl1.phase !== 'playing' || dl1.daily !== dl1.today || dl1.index !== null || dl1.targets < 3 || !dl1.hud) fail('задание дня не началось');
  await p.evaluate(() => __arta.game.quit());

  // ---------- 5. конвой с налётом (задание 32 «Воздух!»): расчёт и аптечка, свои в блокноте, тревога → зенитка, итог и разбор ----------
  const hudFits = () => p.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect(), c = r('rcol');
    const chips = [...document.querySelectorAll('#crew .crew-chip')];
    return { chips: chips.length, names: chips.map((x) => x.querySelector('.nm').textContent).join(','), kits: document.querySelector('#crewKits b').textContent,
      inside: c.top >= 40 && c.bottom <= innerHeight - 56 && c.right <= innerWidth && c.left >= innerWidth - 60 && c.width > 30 };
  });
  await p.evaluate(() => { const g = __arta.game; window.__unl = g.save.unlocked; g.save.unlocked = 36; g.startMission(31); });
  const cvBrief = await p.innerText('#dlgBody');
  if (!/КОНВОЙ/.test(cvBrief) || !/ВОЗДУХ/.test(cvBrief)) fail('брифинг конвоя без условий «КОНВОЙ» и «ВОЗДУХ»');
  await p.click('#dlgBtns .btn');
  await p.waitForFunction(() => document.querySelectorAll('#crew .crew-chip').length === 3 && document.querySelector('#crew .nm').textContent);
  const crew0 = await hudFits();
  // раним заряжающего: значок краснеет, касание тратит аптечку и возвращает в строй
  await p.evaluate(() => { const s = __arta.game.state; s.crew.loader.state = 'wounded'; s.crew.loader.woundedUntil = s.time + 45; __arta.game.update(0.05); });
  await p.waitForFunction(() => document.querySelector('#crew [data-role=loader]').classList.contains('wounded'));
  await p.click('#crew [data-role=loader]');
  await p.waitForFunction(() => document.querySelector('#crew [data-role=loader]').classList.contains('ok'));
  const crew1 = await p.evaluate(() => ({ state: __arta.game.state.crew.loader.state, kits: __arta.game.state.medkits, shown: document.querySelector('#crewKits b').textContent }));
  // тот же столбик на узком экране 740×360
  await p.setViewportSize({ width: 740, height: 360 });
  const crewSmall = await hudFits();
  await p.setViewportSize({ width: 844, height: 390 });
  console.log('crew', JSON.stringify({ crew0, crew1, crewSmall }));
  // уставший: первое касание — только справка (аптечка цела), второе подряд — аптечка
  const tired = await p.evaluate(() => {
    const g = __arta.game, s = g.state, m = s.crew.gunner, el = document.querySelector('#crew [data-role=gunner]');
    m.fatigue = 0.9; m.state = 'tired';
    const k0 = s.medkits; el.click();
    const r = { k0, k1: s.medkits, st1: m.state, toast: document.getElementById('toast').textContent };
    m.fatigue = 0.9; m.state = 'tired';          // такт между касаниями мог снять усталость
    el.click();
    r.k2 = s.medkits; r.st2 = m.state; s.medkits = k0;
    return r;
  });
  console.log('tired', JSON.stringify(tired));
  if (tired.k1 !== tired.k0 || tired.st1 !== 'tired' || !/УСТАЛ/.test(tired.toast)) fail('касание уставшего сразу тратит аптечку: ' + JSON.stringify(tired));
  if (tired.k2 !== tired.k0 - 1 || tired.st2 !== 'ok') fail('второе касание уставшего не лечит: ' + JSON.stringify(tired));
  // 16:9 (640×360): ни один орган постов не закрыт HUD (столбик расчёта сжат в полоску); левша + крупный шрифт: кнопки ремонта не лежат
  // на крышке и тумблере цепи стрельбы; тревога и радиострока не задевают стопку неисправностей; подсказка не обрезана из-за «своего глаза»
  await p.setViewportSize({ width: 640, height: 360 });
  const lay = await p.evaluate(async () => {
    const { engine, game } = __arta, s = game.state, V = new engine.THREE.Vector3(), out = { covered: [], lefty: [], overlap: [] };
    const wait = (fn, ms = 4000) => new Promise((res) => { const t0 = Date.now(); (function f() { if (fn() || Date.now() - t0 > ms) res(); else setTimeout(f, 50); })(); });
    const hud = document.getElementById('hud'), R = (id) => document.getElementById(id).getBoundingClientRect();
    const hit = (a, b) => a.width > 0 && b.width > 0 && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    const under = (id, keys) => {
      const st = engine.stations.find((x) => x.id === id), res = [];
      for (const k of keys || Object.keys(st.hotspots || {})) {
        const o = st.hotspots[k]; if (!o || !o.getWorldPosition) continue;
        o.getWorldPosition(V); const sc = engine.input.toScreen(V, {});
        if (sc.behind || sc.x < 0 || sc.y < 0 || sc.x > innerWidth || sc.y > innerHeight) continue;
        const el = document.elementFromPoint(sc.x, sc.y);
        if (el && el.tagName !== 'CANVAS') res.push(id + '.' + k + ' под ' + (el.id || el.className));
      }
      return res;
    };
    const go = async (id) => { engine.gotoStation(id, { instant: true }); await wait(() => hud.dataset.st === id); await new Promise((r) => setTimeout(r, 250)); };
    const was = engine.current;
    await wait(() => R('rcol').width < 30);
    out.rcolW = R('rcol').width;
    for (const id of ['plot', 'computer', 'loading', 'traverse', 'elevation', 'fire', 'observe', 'aa']) { await go(id); out.covered.push(...under(id)); }
    // подсказка в нижней строке
    {
      const m = document.getElementById('memo'), o = document.getElementById('obs'), h = document.getElementById('hint'), keep = [m.innerHTML, o.innerHTML, h.innerHTML];
      m.textContent = 'ЦЕЛЬ 1 · ПЕЛЕНГ 012,4° · ДАЛЬНОСТЬ 9,85 КМ · УГОЛ 25,11° · ЗАРЯД 2'; o.textContent = 'КОРР. №1: ПЕРЕЛЁТ 350, ВПРАВО 120';
      h.textContent = 'ПОДЪЁМ: держите «НА УГОЛ ЗАРЯЖАНИЯ» — ствол должен опуститься до 3°';
      out.hintCut = h.scrollWidth - h.clientWidth;
      m.innerHTML = keep[0]; o.innerHTML = keep[1]; h.innerHTML = keep[2];
    }
    // две неисправности, крупный шрифт
    game.setSetting('text', 1.3);
    s.faults.drive = true; s.faults.hoist = true;
    await go('plot');
    await wait(() => document.querySelectorAll('#faults .fault').length === 2 && hud.classList.contains('hasfaults'));
    for (const lefty of [false, true]) {
      game.setSetting('lefty', lefty);
      await wait(() => document.body.classList.contains('lefty') === lefty);
      const rb = document.getElementById('raidBanner'), radio = document.getElementById('radio');
      const hid = rb.classList.contains('hidden'), raid = hud.classList.contains('raid'), txt = radio.innerHTML;
      rb.classList.remove('hidden'); hud.classList.add('raid');
      radio.innerHTML = '<b>ШТАБ</b>Налёт! Самолётов: 2, заходят с пеленга 335.0°. Всем постам — к бою, зенитный расчёт на место.';
      if (hit(R('raidBanner'), R('faults'))) out.overlap.push((lefty ? 'левша: ' : '') + 'тревога на неисправностях');
      if (hit(R('radio'), R('faults'))) out.overlap.push((lefty ? 'левша: ' : '') + 'радио под неисправностями');
      if (hit(R('raidBanner'), R('rcol'))) out.overlap.push((lefty ? 'левша: ' : '') + 'тревога на столбике расчёта');
      rb.classList.toggle('hidden', hid); hud.classList.toggle('raid', raid); radio.innerHTML = txt;
    }
    await go('fire');
    out.lefty = under('fire', ['armCover', 'armToggle']);
    out.faultsFire = (() => { const r = R('faults'); return [Math.round(r.left), Math.round(r.right)]; })();
    game.setSetting('lefty', false); game.setSetting('text', 1);
    s.faults.drive = false; s.faults.hoist = false;
    await go(was);
    return out;
  });
  console.log('layout', JSON.stringify(lay));
  if (!(lay.rcolW < 30)) fail('16:9: столбик расчёта не сжат: ' + lay.rcolW);
  if (lay.covered.length) fail('16:9: органы постов закрыты HUD: ' + lay.covered.join('; '));
  if (lay.hintCut > 24) fail('подсказка обрезана на ' + lay.hintCut + ' px');
  if (lay.overlap.length) fail('наложение в HUD: ' + lay.overlap.join('; '));
  if (lay.lefty.length || lay.faultsFire[0] > 100) fail('левша, пост ОГОНЬ: неисправности на органах цепи стрельбы: ' + lay.lefty.join('; ') + ' ' + lay.faultsFire);
  await p.setViewportSize({ width: 844, height: 390 });
  if (crew0.chips !== 3 || !/ГРОМОВ,СЕДЫХ,ВЯТКИН/.test(crew0.names) || crew0.kits !== '2') fail('значки расчёта или счётчик аптечек не показаны');
  if (!crew0.inside || !crewSmall.inside) fail('столбик расчёта не помещается у края экрана');
  if (crew1.state !== 'ok' || crew1.kits !== 1 || crew1.shown !== '1') fail('аптечка по касанию значка не сработала: ' + JSON.stringify(crew1));
  // свои силы в блокноте, значок конвоя в HUD
  await p.click('[data-act=notebook]');
  const nbk = await p.evaluate(() => ({ friends: document.getElementById('nbFriends').innerText.replace(/\n+/g, ' | ').slice(0, 200), cards: document.querySelectorAll('#nbFriends .nb-f').length, n: __arta.game.state.friends.length,
    crew: document.getElementById('nbCrew').innerText.replace(/\n+/g, ' | '), aa: document.getElementById('nbAA').innerText.replace(/\n+/g, ' | '), obs: document.getElementById('nbObs').innerText.length,
    convoy: !document.getElementById('convoyChip').classList.contains('hidden') && document.querySelectorAll('#convoyChip i').length }));
  console.log('notebook', JSON.stringify(nbk));
  if (!/СВОИ СИЛЫ/.test(nbk.friends) || !/СВОИ 1/.test(nbk.friends) || nbk.cards !== nbk.n || nbk.n < 1) fail('в блокноте нет своих сил');
  if (!/Громов/.test(nbk.crew) || !/Аптечки/.test(nbk.crew) || !/Патроны/.test(nbk.aa) || !nbk.obs) fail('в блокноте нет экипажа, зенитки или докладов');
  if (!nbk.convoy) fail('в HUD нет значка конвоя');
  await p.click('[data-act=closeNotebook]');
  // налёт: ждём предупреждения — плашка, вкладка ЗЕНИТКА мигает; касание плашки ведёт на пост
  const rd0 = await p.evaluate(async () => {
    const { game } = __arta, s = game.state, { until } = window.__e2e;
    let warned = false; const off = game.on('raid', (e) => { if (e.phase === 'warning') warned = true; });
    await until(() => warned || s.phase !== 'playing'); off();
    for (let i = 0; i < 60 && document.getElementById('raidBanner').classList.contains('hidden'); i++) await new Promise((r) => setTimeout(r, 100));
    const el = document.getElementById('raidBanner'), r = el.getBoundingClientRect();
    return { warned, phase: s.phase, time: s.time, shown: !el.classList.contains('hidden'), text: el.innerText, tab: document.querySelector('#nav [data-station=aa]').classList.contains('alarm'), top: r.top, hint: document.getElementById('hint').innerText };
  });
  if (rd0.shown) await p.click('#raidBanner');
  await p.waitForFunction(() => __arta.engine.current === 'aa', null, { timeout: 30000 }).catch(() => {});
  const rd1 = await p.evaluate(async () => {
    const { game, engine } = __arta, s = game.state, { until } = window.__e2e;
    const at = engine.current;
    let ended = null; const off = game.on('raid', (e) => { if (e.phase === 'end') ended = e; });
    await until(() => s.raid && s.raid.phase === 'inbound');
    for (let i = 0; i < 40 && !/ЗЕНИТКА/.test(document.getElementById('hint').innerText); i++) await new Promise((r) => setTimeout(r, 100));   // HUD перерисовывается по кадрам
    const hint = document.getElementById('hint').innerText;
    await until(() => ended || s.phase !== 'playing'); off();
    for (let i = 0; i < 30 && !document.getElementById('raidBanner').classList.contains('hidden'); i++) await new Promise((r) => setTimeout(r, 100));
    return { at, hint, ended, phase: s.phase, hidden: document.getElementById('raidBanner').classList.contains('hidden'), toast: document.getElementById('toast').textContent, integrity: s.integrity, bombs: s.stats.bombs };
  });
  console.log('raid', JSON.stringify({ rd0, rd1 }));
  await p.screenshot({ path: shotOf('raid') });
  if (!rd0.warned || !rd0.shown || !/ВОЗДУХ/.test(rd0.text) || !rd0.tab) fail('тревога «ВОЗДУХ!» не показана (плашка или вкладка)');
  if (rd1.at !== 'aa') fail('касание плашки не привело на пост ЗЕНИТКА: ' + rd1.at);
  if (!/ЗЕНИТКА/.test(rd1.hint)) fail('во время налёта нет подсказки зенитного поста: ' + rd1.hint);
  if (!rd1.ended || !rd1.hidden) fail('после налёта плашка не убрана');
  if (rd1.ended && /ОТБИТ/.test(rd1.toast) && rd1.ended.bombed) fail('«НАЛЁТ ОТБИТ» при прорвавшихся самолётах: ' + rd1.toast);
  if (rd1.phase === 'playing' && !/НАЛЁТ (ОТБИТ|ОКОНЧЕН): СБИТО \d+, ПРОРВАЛОСЬ \d+/.test(rd1.toast)) fail('нет итога налёта: ' + rd1.toast);
  // конвой доходит до порта → победа, итоги со своими силами, разбор боя с их путями
  const cv = await p.evaluate(async () => {
    const { game } = __arta, s = game.state, { until, sleep } = window.__e2e;
    if (s.phase === 'playing') {
      for (let i = 0; i < 80; i++) game.update(0.1);
      s.friends.filter((f) => f.convoy && f.alive).forEach((f) => { const e = f.path[f.path.length - 1]; f.leg = f.path.length - 1; f.x = e.x - 0.02; f.y = e.y; });
      await until(() => s.phase !== 'playing');
    }
    for (let i = 0; i < 60 && !document.getElementById('dialog').classList.contains('show'); i++) await sleep(100);
    return { phase: s.phase, stats: { ...s.stats }, dialog: document.getElementById('dlgBody').innerText.replace(/\n+/g, ' | ').slice(0, 520), friends: (document.getElementById('resFriends') || {}).innerText || '',
      btns: [...document.querySelectorAll('#dlgBtns .btn')].map((x) => x.textContent) };
  });
  console.log('convoy', JSON.stringify(cv));
  await p.screenshot({ path: shotOf('convoy') });
  if (cv.phase !== 'won' && cv.phase !== 'lost') fail('бой с конвоем не закончился');
  if (!/Конвой/.test(cv.dialog) || !/Попаданий по своим/.test(cv.dialog) || !/Самолётов сбито/.test(cv.dialog) || !/СВОИ СИЛЫ/.test(cv.friends)) fail('в итогах нет конвоя, огня по своим или налёта');
  if (cv.btns.includes('РАЗБОР БОЯ')) {
    await p.click('#dlgBtns .btn:has-text("РАЗБОР БОЯ")');
    const dbf2 = await p.evaluate(() => {
      const c = document.getElementById('dbfCanvas'), o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
      const og = o.getContext('2d', { willReadFrequently: true }); og.drawImage(c, 0, 0);
      const d = og.getImageData(0, 0, c.width, c.height).data; let blue = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 150 && d[i + 1] > 150 && d[i + 2] > 220) blue++;
      return { visible: document.getElementById('debrief').classList.contains('show'), blue, legend: document.getElementById('dbfLegend').innerText, sum: (document.querySelector('#dbfTable .dbf-sum') || {}).innerText || '' };
    });
    console.log('debrief2', JSON.stringify(dbf2));
    await p.screenshot({ path: shotOf('debrief2') });
    if (!dbf2.visible || dbf2.blue < 20 || !/СВОИ/.test(dbf2.legend) || !/СВОИ/.test(dbf2.sum)) fail('в разборе боя нет своих сил');
    await p.click('[data-act=closeDebrief]');
  } else fail('в итогах конвоя нет кнопки «РАЗБОР БОЯ»');
  await p.click('#dlgBtns .btn:has-text("В МЕНЮ")');
  await p.evaluate(() => { __arta.game.save.unlocked = Math.max(window.__unl, 2); });

  console.log('errors', errs);
  await b.close();
  process.exit(errs ? 1 : 0);
})();
