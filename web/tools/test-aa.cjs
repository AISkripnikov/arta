// Тест поста «ЗЕНИТКА»: настоящий указатель (page.mouse) по органам поста + проверка game.state и приборов.
//   cd web && node tools/test-aa.cjs [--no-build] [--w 844 --h 390] [--shots]   (код выхода ≠ 0 при провале)
// Кадры шагаются вручную (engine.debug.step без отрисовки) — быстро и детерминированно даже на программном WebGL.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');

const WEB = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const flag = (k) => argv.includes('--' + k);
const num = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? Number(argv[i + 1]) : d; };
const W = num('w', 844), H = num('h', 390);
const RAID_MISSION = 23;             // «Генеральное сражение»: налёт трёх самолётов на 110-й секунде

const PAGE_HELPERS = `(() => {
  const { engine, game, stations } = window.__dev;
  const st = stations[0], c = st.controls, V3 = engine.THREE.Vector3;
  engine.stop();
  const denied = [], events = [];
  game.on('denied', (d) => denied.push(d.action + ': ' + d.reason));
  game.on('plane', (e) => events.push(Object.assign({ ev: 'plane' }, e)));
  game.on('raid', (e) => events.push(Object.assign({ ev: 'raid' }, e)));
  game.on('aa', (e) => events.push(Object.assign({ ev: 'aa' }, e)));
  window.T = {
    denied, events,
    adv(sec, dt = 0.05) { for (let t = 0; t < sec - 1e-9; t += dt) engine.debug.step(dt, false); },
    // шагать, пока условие не выполнится (не дольше max секунд игрового времени)
    until(fn, max = 400) { let t = 0; while (!fn() && t < max) { engine.debug.step(0.05, false); t += 0.05; } return fn(); },
    scr(name, x = 0, y = 0, z = 0) {
      const o = st.hotspots[name]; o.updateWorldMatrix(true, false);
      const s = engine.input.toScreen(new V3(x, y, z).applyMatrix4(o.matrixWorld)); return [s.x, s.y];
    },
    snap() {
      const s = game.state, a = s.aa;
      return {
        phase: s.phase, bearing: a.bearing, elevation: a.elevation, firing: a.firing, heat: a.heat, jammed: a.jammed, ammo: a.ammo,
        raid: s.raid ? { phase: s.raid.phase, planes: s.raid.planes.map((p) => Object.assign({}, p)) } : null,
        gHeat: c.gHeat.value, cAmmo: c.cAmmo.value, cBearing: c.cBearing.value, cElev: c.cElev.value,
        lampHot: c.lampHot.state, lampAir: c.lampAir.state, lampClear: c.lampClear.state,
        pressed: c.fireBtn.pressed, latched: c.fireBtn.latched, sky: c.sky.visible, shutter: c.shutter.object3D.visible,
        target: c.targetPlate.text, info: Object.assign({}, c.info), denied: denied.length, lastDenied: denied[denied.length - 1] || null,
        calls: engine.debug.stats().calls, events: events.length,
      };
    },
  };
})()`;

(async () => {
  if (!flag('no-build')) execFileSync('node', ['build.mjs', '--dev', 'st-aa'], { cwd: WEB, stdio: 'ignore' });
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
  const shot = async (name) => { if (flag('shots')) { await ev('window.__dev.engine.debug.step(1/60, true)'); await page.screenshot({ path: path.join(WEB, '.dev/st-aa', 't_' + name + '.png') }); } };
  const drag = async (name, dx, dy, steps = 12) => {
    const [x, y] = await scr(name);
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= steps; i++) await page.mouse.move(x + dx * i / steps, y + dy * i / steps);
    await page.mouse.up(); await adv(0.1);
  };

  try {
    await page.goto('file://' + path.join(WEB, '.dev/st-aa/index.html'));
    await page.waitForFunction('window.__dev && window.__dev.engine && window.__dev.stations', null, { timeout: 120000 });
    await page.waitForTimeout(500);              // несколько настоящих кадров (обычный цикл движка)
    await page.evaluate(PAGE_HELPERS);
    await adv(0.3);

    console.log('1. контракт поста, тихое состояние');
    const meta = await ev(`const st = window.__dev.stations[0]; return { id: st.id, title: st.title, keys: Object.keys(st.hotspots).sort(), isGroup: !!st.group.isGroup,
      lights: (() => { let n = 0; st.group.traverse(o => { if (o.isLight) n++; }); return n; })() }`);
    check('id/title/group', meta.id === 'aa' && meta.title === 'ЗЕНИТКА' && meta.isGroup, meta);
    check('hotspots: aaFire, aaPad, aaSlewB, aaSlewE, aaTrigger', meta.keys.join() === 'aaFire,aaPad,aaSlewB,aaSlewE,aaTrigger', meta.keys);
    check('пост не добавляет источников света', meta.lights === 0, meta.lights);
    let s = await snap();
    check('фаза playing, налёта нет', s.phase === 'playing' && !s.raid, s);
    check('небо видно, заслонка убрана (пост текущий)', s.sky && !s.shutter, s);
    check('«ЧИСТО» горит, «ВОЗДУХ» и «ПЕРЕГРЕВ» нет', s.lampClear === true && s.lampAir === false && s.lampHot === false, s);
    check('счётчики: патроны 400, пеленг и угол = state.aa', s.cAmmo === 400 && Math.abs(s.cBearing - s.bearing) < 0.6 && Math.abs(s.cElev - s.elevation) < 0.6, s);
    check('шильдик: целей нет, стрелки нет', /ЦЕЛЕЙ НЕТ/.test(s.target) && !s.info.arrow, s);
    check('вызовов отрисовки ≤ 120', s.calls <= 120, s.calls);
    const pts = {};
    for (const k of ['aaPad', 'aaFire', 'aaSlewB', 'aaSlewE']) pts[k] = await scr(k);
    check('органы в безопасной зоне экрана', Object.values(pts).every(([x, y]) => x > 8 && x < W - 8 && y > 44 && y < H - 60), pts);
    await shot('idle');

    console.log('2. планшет наводки: перетаскивание по небу');
    let b0 = s.bearing, e0 = s.elevation;
    await drag('aaPad', 90, 0);
    s = await snap();
    check('палец вправо → пеленг растёт', s.bearing > b0 + 2 && Math.abs(s.elevation - e0) < 0.01, { b0, s: s.bearing, e: s.elevation });
    b0 = s.bearing;
    await drag('aaPad', 0, -50);
    s = await snap();
    check('палец вверх → угол места растёт', s.elevation > e0 + 1.5 && Math.abs(s.bearing - b0) < 0.01, { e0, e: s.elevation });
    e0 = s.elevation;
    await drag('aaPad', -120, 40);
    s = await snap();
    check('палец влево-вниз → пеленг и угол убывают', ((s.bearing - b0 + 540) % 360 - 180) < -2 && s.elevation < e0 - 1, { b0, e0, b: s.bearing, e: s.elevation });
    check('счётчики следуют', Math.abs(((s.cBearing - s.bearing + 540) % 360) - 180) < 0.6 && Math.abs(s.cElev - s.elevation) < 0.6, s);
    await drag('aaPad', 0, 3000 / 12, 12);                    // далеко вниз — упор 0°
    s = await snap();
    check('угол места не уходит ниже 0°', s.elevation >= 0 && s.elevation < e0, s.elevation);

    console.log('3. рычаги привода');
    b0 = s.bearing; e0 = s.elevation;
    {
      const [x, y] = await scr('aaSlewB');
      await page.mouse.move(x, y); await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(x + 6 * i, y);
      await adv(0.5);
      const mid = await snap();
      check('рычаг пеленга вправо: пеленг растёт, пока держим', ((mid.bearing - b0 + 540) % 360 - 180) > 3, { b0, b: mid.bearing });
      await page.mouse.up(); await adv(0.1);
      const b1 = (await snap()).bearing; await adv(0.4);
      check('отпустили — привод встал', Math.abs((await snap()).bearing - b1) < 0.01);
    }
    {
      const [x, y] = await scr('aaSlewE');
      await page.mouse.move(x, y); await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(x, y - 6 * i);
      await adv(0.5);
      const mid = await snap();
      check('рычаг угла вверх: угол растёт', mid.elevation > e0 + 2, { e0, e: mid.elevation });
      await page.mouse.up(); await adv(0.1);
    }

    console.log('4. гашетка: удержание, отпускание, защёлка');
    {
      const [x, y] = await scr('aaFire');
      await page.mouse.move(x, y); await page.mouse.down();
      await page.waitForTimeout(420);                           // дольше порога защёлки (350 мс)
      await adv(1.5);
      s = await snap();
      check('держим — firing, нагрев растёт, патроны уходят', s.firing && s.heat > 0.15 && s.ammo < 400 && s.pressed, s);
      check('трассы летят, прибор нагрева идёт', s.info.tracers > 0 && s.info.shooting && s.gHeat > 5, s);
      await shot('firing');
      const h1 = s.heat;
      await page.mouse.up(); await adv(1);
      s = await snap();
      check('отпустили — огонь прекращён, остывает', !s.firing && !s.latched && !s.pressed && s.heat < h1, s);
      await adv(0.6);
      check('трассы погасли', (await snap()).info.tracers === 0);
      // короткое касание — защёлка
      await page.mouse.down(); await page.mouse.up(); await adv(0.5);
      s = await snap();
      check('короткое касание — защёлка: стреляет без пальца', s.firing && s.latched && !s.pressed, s);
      await page.mouse.down(); await page.mouse.up(); await adv(0.2);
      s = await snap();
      check('второе касание — отбой', !s.firing && !s.latched, s);
      // уход с поста снимает гашетку
      await page.mouse.down(); await page.mouse.up(); await adv(0.2);
      await ev('window.__dev.stations[0].onLeave()'); await adv(0.1);
      s = await snap();
      check('onLeave() снимает гашетку', !s.firing && !s.latched, s);
      await ev('window.__dev.stations[0].onEnter()'); await adv(0.1);
      // два пальца (настоящие касания через CDP): один ведёт прицел, второй давит гашетку — и наоборот
      const cdp = await page.context().newCDPSession(page);
      const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([tx, ty, id]) => ({ x: Math.round(tx), y: Math.round(ty), id })) });
      const dB = (a, b) => ((a - b + 540) % 360) - 180;
      await adv(5);
      const [px, py] = await scr('aaPad');
      const a0 = (await snap()).ammo;
      await touch('touchStart', [[px, py, 1]]);
      await touch('touchMove', [[px + 30, py, 1]]);
      await touch('touchStart', [[px + 30, py, 1], [x, y, 2]]);
      await page.waitForTimeout(420); await adv(0.6);
      s = await snap();
      check('палец на планшете + второй на гашетке: огонь идёт', s.firing && s.pressed && s.ammo < a0, s);
      const b1 = s.bearing;
      await touch('touchMove', [[px + 70, py, 1], [x, y, 2]]); await page.waitForTimeout(80); await adv(0.1);
      s = await snap();
      check('…и прицел при этом ведётся первым пальцем', s.firing && dB(s.bearing, b1) > 1, { b1, b: s.bearing, firing: s.firing });
      await touch('touchEnd', [[x, y, 2]]); await page.waitForTimeout(80); await adv(0.3);     // touchEnd со списком — сняты перечисленные пальцы
      s = await snap();
      check('сняли второй палец — огонь прекращён, планшет ещё держим', !s.firing && !s.latched && !s.pressed, s);
      await touch('touchEnd', []); await adv(0.2);
      await touch('touchStart', [[x, y, 1]]);
      await page.waitForTimeout(420); await adv(0.3);
      const b2 = (await snap()).bearing;
      await touch('touchStart', [[x, y, 1], [px, py, 2]]);
      await touch('touchMove', [[x, y, 1], [px - 25, py, 2]]);
      await touch('touchMove', [[x, y, 1], [px - 60, py, 2]]); await page.waitForTimeout(80); await adv(0.1);
      s = await snap();
      check('гашетку держим — второй палец ведёт прицел', s.firing && dB(s.bearing, b2) < -1, { b2, b: s.bearing, firing: s.firing });
      await touch('touchEnd', [[x, y, 1]]); await page.waitForTimeout(80); await adv(0.2);
      s = await snap();
      check('сняли палец с гашетки — отбой', !s.firing && !s.latched && !s.pressed, s);
      await touch('touchEnd', []); await adv(5);
    }

    console.log('5. перегрев');
    {
      const [x, y] = await scr('aaFire');
      await ev('window.__dev.game.state.aa.heat = 0');
      await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(400);
      const jam = await ev('return T.until(() => window.__dev.game.state.aa.jammed, 12)');
      s = await snap();
      check('длинная очередь → клин', jam && s.jammed && s.heat > 0.8, s);
      check('лампа «ПЕРЕГРЕВ» мигает, гашетка сброшена', s.lampHot === 'blink' && !s.firing, s);
      await page.mouse.up(); await adv(0.1);
      const d0 = s.denied;
      await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up(); await adv(0.1);
      s = await snap();
      check('при клине гашетка отказывает', !s.firing && s.denied > d0, s);
      await shot('jam');
      const cool = await ev('return T.until(() => !window.__dev.game.state.aa.jammed, 12)');
      check('остыл — клин снят, лампа гаснет', cool && (await snap()).lampHot === false);
    }

    console.log('6. налёт: лампы, целеуказание, сбитие');
    await ev(`const g = window.__dev.game; g.quit(); g.startMission(${RAID_MISSION}); g.begin(); T.events.length = 0;`);
    const warned = await ev(`return T.until(() => T.events.some(e => e.ev === 'raid' && e.phase === 'warning'))`);
    await adv(0.3);
    s = await snap();
    check('предупреждение: «ВОЗДУХ» мигает, «ЧИСТО» гаснет', warned && s.lampAir === 'blink' && s.lampClear === false && s.phase === 'playing', s);
    const started = await ev('return T.until(() => !!window.__dev.game.state.raid, 30)');
    await adv(6);
    s = await snap();
    check('налёт начался: «ВОЗДУХ» горит', started && s.raid && s.raid.phase === 'inbound' && s.lampAir === true, s);
    check('шильдик даёт пеленг и угол цели', /ЦЕЛЬ \d{3}° УГОЛ \d+°/.test(s.target), s.target);
    // увести прицел в сторону: самолётов в поле нет, стрелка показывает, куда вести
    await ev('const g = window.__dev.game, p = g.state.raid.planes[0]; g.aimAA({ bearing: p.bearing - 40, elevation: p.elevation })');
    await adv(0.1);
    s = await snap();
    const ang = await ev('return window.__dev.stations[0].controls.arrow.rotation.z');
    check('прицел в стороне: стрелка включена и смотрит вправо', s.info.seek && Math.abs(ang) < 0.5 && s.info.planes === 0, { info: s.info, ang });
    // довести до подхода на дальность огня и посадить первый самолёт на ось
    await ev('T.until(() => window.__dev.game.state.raid.planes[0].range <= 4.2, 30)');
    await ev('const g = window.__dev.game, p = g.state.raid.planes[0]; g.aimAA({ bearing: p.bearing + 0.8, elevation: p.elevation - 0.5 })');
    await adv(0.1);
    s = await snap();
    check('самолёт в кольце: модель видна, стрелка погасла', s.info.planes >= 1 && !s.info.arrow && !s.info.seek, s.info);
    await shot('raid');
    {
      const [x, y] = await scr('aaFire');
      const id = s.raid.planes[0].id;
      await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(400);
      // сопровождаем цель, как это делал бы наводчик, пока идёт очередь
      const down = await ev(`return T.until(() => { const g = window.__dev.game, p = g.state.raid && g.state.raid.planes[0]; if (p && p.alive) g.aimAA({ bearing: p.bearing, elevation: p.elevation }); return T.events.some(e => e.ev === 'plane' && e.down); }, 6)`);
      await page.mouse.up(); await adv(0.3);
      s = await snap();
      const evd = await ev(`return T.events.find(e => e.ev === 'plane' && e.down)`);
      check('самолёт на оси под огнём сбит → событие plane {down}', down && evd && evd.id === id && s.raid.planes[0].alive === false, { evd, p: s.raid && s.raid.planes[0] });
      check('сбитый падает и горит (модель ещё видна)', s.info.falling >= 1, s.info);
      await shot('down');
      await adv(4);
      check('через несколько секунд упал — модель убрана', (await snap()).info.falling === 0);
    }
    // бомбёжка: вспышка в проёме
    const bombed = await ev(`return T.until(() => T.events.some(e => e.ev === 'plane' && e.bombed) || !window.__dev.game.state.raid, 60)`);
    s = await snap();
    const wasBombed = await ev(`return T.events.some(e => e.ev === 'plane' && e.bombed)`);
    check('отбомбившийся самолёт → вспышка в проёме', bombed && wasBombed && s.info.flash > 0.3, { wasBombed, flash: s.info.flash, phase: s.phase });
    await shot('bomb');
    const over = await ev(`return T.until(() => !window.__dev.game.state.raid || window.__dev.game.state.phase !== 'playing', 90)`);
    await adv(0.2);
    s = await snap();
    check('налёт кончился: «ЧИСТО»', over && (s.phase !== 'playing' || (s.lampClear === true && s.lampAir === false)), s);
    check('вызовов отрисовки ≤ 120 за весь налёт', s.calls <= 120, s.calls);

    console.log('7. сосед по кольцу: небо не рисуется');
    const hid = await ev(`const st = window.__dev.stations[0]; st.onLeave(); return { sky: st.controls.sky.visible, shutter: st.controls.shutter.object3D.visible }`);
    check('после onLeave(): небо скрыто, заслонка закрыта', hid.sky === false && hid.shutter === true, hid);

    check('нет ошибок и предупреждений в консоли', problems.length === 0, problems.slice(0, 5));
  } catch (e) {
    failed++; console.log('  FAIL исключение теста: ' + (e && e.stack || e));
  } finally {
    await browser.close();
  }
  console.log(`\n${failed ? 'ПРОВАЛ' : 'УСПЕХ'}: ${passed} пройдено, ${failed} провалено`);
  process.exit(failed ? 1 : 0);
})();
