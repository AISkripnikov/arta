// Тест взаимодействия поста «ПЛАНШЕТ»: настоящий ввод указателем по органам, проверка game.state.
//   node build.mjs --dev st-plot && node tools/test-plot.cjs
const { chromium } = require('playwright');
const path = require('path');

const W = 844, H = 390;
let failed = 0, passed = 0;
const ok = (cond, name, extra) => {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};
const near = (a, b, tol) => Math.abs(a - b) <= tol + 1e-9;

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.type() + ': ' + m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '../.dev/st-plot/index.html') + '#m=3&d=0');
  await page.waitForFunction(() => window.__dev && window.__dev.stations && window.__dev.stations[0], null, { timeout: 120000 });

  // ---- помощники на странице ----
  await page.evaluate(() => {
    const { engine, game, stations } = window.__dev;
    const st = stations[0], THREE = engine.THREE;
    window.T = {
      denied: [],
      st,
      step(n = 2, dt = 0.03) { for (let i = 0; i < n; i++) engine.debug.step(dt, i === n - 1); },
      scr(v) { const p = engine.input.toScreen(v); return { x: p.x, y: p.y }; },
      hot(name) { const o = st.hotspots[name]; o.updateWorldMatrix(true, false); return this.scr(o.getWorldPosition(new THREE.Vector3())); },
      chart(x, y) { return this.scr(st.api.chartToWorld(x, y)); },
      handle(id) { return this.scr(st.api.pinHandleWorld(id)); },
      sight() { const s = game.state, b = s.mission.battery, a = s.plot.alidade, r = a.bearing * Math.PI / 180; return { x: b.x + a.range * Math.sin(r), y: b.y + a.range * Math.cos(r) }; },
      ctl(name) { return st.hotspots[name].userData.control; },
      /** Попадает ли точка экрана в плашку «ОБЗОР» / «К ВИЗИРУ» (они перехватывают касание). */
      onPlate(x, y) {
        const r = engine.canvas.getBoundingClientRect(), rc = new THREE.Raycaster();
        engine.camera.updateMatrixWorld();
        rc.setFromCamera(new THREE.Vector2(x / r.width * 2 - 1, -(y / r.height) * 2 + 1), engine.camera);
        return ['btnOverview', 'btnToSight'].some((n) => st.hotspots[n].visible && rc.intersectObject(st.hotspots[n], true).length > 0);
      },
      snap() {
        const s = game.state;
        return JSON.parse(JSON.stringify({ phase: s.phase, active: s.activeTarget, pins: s.plot.pins, al: s.plot.alidade, rec: s.plot.recorded, time: s.time, diff: s.difficulty,
          targets: s.targets.map((t) => ({ id: t.id, reported: t.reported, moving: t.moving, alive: t.alive })), bat: s.mission && s.mission.battery,
          lamps: { aligned: this.ctl('lampAligned').state, recorded: this.ctl('lampRecorded').state, fresh: this.ctl('lampNew').state },
          counters: { b: this.ctl('counterBearing').value, r: this.ctl('counterRange').value, x: this.ctl('counterX').value, y: this.ctl('counterY').value },
          loupe: st.api.loupe, lead: st.api.leadVisible, denied: this.denied.slice(), fov: engine.camera.fov }));
      },
    };
    game.on('denied', (d) => window.T.denied.push(d.action));
  });
  const snap = async (frames = 2) => page.evaluate((n) => { window.T.step(n); return window.T.snap(); }, frames);
  const step = (n, dt) => page.evaluate(([a, b]) => window.T.step(a, b), [n, dt || 0.03]);
  const at = (expr) => page.evaluate('(() => { const T = window.T; return ' + expr + '; })()');
  const drag = async (a, b, steps = 6, hold = 0) => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) await page.mouse.move(a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps);
    if (hold) await page.waitForTimeout(hold);
    await page.mouse.up();
  };
  // настоящие события касания (через CDP): порог начала перетаскивания у пальца — 10 px
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }] : [] });
  const touchDrag = async (a, b, steps = 10) => {
    await touch('touchStart', a);
    for (let i = 1; i <= steps; i++) await touch('touchMove', { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps });
    await touch('touchEnd');
  };
  const touchTap = async (p) => { await touch('touchStart', p); await touch('touchEnd'); };
  const tap = async (p) => { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.up(); };
  /** Тащит фишку за ручку-диск так, чтобы остриё пришло в (x, y) км; порог начала перетаскивания (5 px) компенсируется. */
  const dragPinTo = async (id, x, y, finger = false) => {
    const h = await at('T.handle(' + id + ')');
    const c = await at('(() => { const o = T.st.api.handleOffsetKm; return T.chart(' + x + ' + o.x, ' + y + ' + o.y); })()');
    const L = Math.hypot(c.x - h.x, c.y - h.y) || 1, k = (L + (finger ? 10.5 : 5.5)) / L;
    await (finger ? touchDrag : drag)(h, { x: h.x + (c.x - h.x) * k, y: h.y + (c.y - h.y) * k }, 12);
  };
  /**
   * Двойное касание; want — ожидаемое состояние лупы после него. Кадры на время жеста остановлены, и всё же на
   * загруженной машине между касаниями может пройти больше 0.45 с — тогда жест повторяется (до трёх раз).
   */
  const doubleTap = async (p, want) => {
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.__dev.engine.stop());
      await tap(p); await tap(p);
      await page.evaluate(() => window.__dev.engine.start());
      if ((await at('T.st.api.loupe')) === want) return;
      await page.waitForTimeout(600);
    }
  };
  const inSafe = (p) => p.x > 4 && p.x < W - 4 && p.y > 40 && p.y < H - 56;

  // ---- 0. до донесений: отказ «ЗАПИСАТЬ», стрелки без фишки молчат ----
  console.log('до донесений разведки');
  let s = await snap(3);
  ok(s.phase === 'playing' && s.active == null, 'задание идёт, активной цели ещё нет', [s.phase, s.active]);
  await tap(await at("T.hot('btnRecord')"));
  s = await snap();
  ok(s.denied.length === 1 && s.denied[0] === 'recordMeasurement', '«ЗАПИСАТЬ» без цели → один отказ', s.denied);
  await tap(await at("T.hot('btnXPlus')"));
  s = await snap();
  ok(s.denied.length === 1 && Object.keys(s.pins).length === 0, 'стрелка без фишки ничего не вызывает', s.denied);

  // все органы — в зоне управления
  const names = ['bearingWheel', 'rangeWheel', 'btnXMinus', 'btnXPlus', 'btnYMinus', 'btnYPlus', 'btnRecord', 'btnLoupe', 'tray', 'counterBearing', 'counterRange', 'counterX', 'counterY', 'lampAligned', 'lampRecorded', 'lampNew'];
  for (const size of [[844, 390], [740, 416]]) {
    await page.setViewportSize({ width: size[0], height: size[1] });
    await step(3);
    const pts = await page.evaluate((ns) => ns.map((n) => window.T.hot(n)), names);
    const bad = names.filter((n, i) => !(pts[i].x > 30 && pts[i].x < size[0] - 30 && pts[i].y > 40 + 12 && pts[i].y < size[1] - 56 - 12));
    ok(bad.length === 0, 'органы в зоне управления ' + size.join('×'), bad);
    const rim = await at("(() => { const o = T.st.hotspots.bearingWheel; o.updateWorldMatrix(true,false); const E = window.__dev.engine.THREE; return [T.scr(o.localToWorld(new E.Vector3(-0.16,0,0))), T.scr(o.localToWorld(new E.Vector3(0,-0.16,0)))]; })()");
    ok(rim[0].x > 2 && rim[1].y < size[1] - 56, 'обод маховика целиком виден ' + size.join('×'), rim);
  }
  await page.setViewportSize({ width: W, height: H });
  await step(3);

  // ---- 1. донесения: фишки в лотке, выбор касанием ----
  console.log('фишки');
  await page.evaluate(() => { const g = window.__dev.game; for (let i = 0; i < 600 && !g.state.targets.every((t) => t.reported); i++) g.update(0.05); });
  s = await snap(3);
  ok(s.targets.every((t) => t.reported) && s.active === 1, 'цели сообщены, активна цель 1', s.active);
  ok(s.lamps.fresh === true, 'лампа «НОВОЕ ДОНЕСЕНИЕ» горит, пока фишка не поставлена');
  const moving = s.targets.find((t) => t.moving), other = s.targets.find((t) => t.id !== moving.id);
  await tap(await at('T.handle(' + other.id + ')'));
  s = await snap();
  ok(s.active === other.id, 'касание фишки в лотке выбирает цель ' + other.id, s.active);
  await tap(await at('T.handle(' + moving.id + ')'));
  s = await snap();
  ok(s.active === moving.id && s.denied.length === 1, 'касание другой фишки — цель ' + moving.id);

  // перетаскивание из лотка на карту
  const rep = moving.reported;
  {
    await dragPinTo(moving.id, rep.x, rep.y);
  }
  s = await snap();
  let pin = s.pins[moving.id];
  ok(pin && Math.hypot(pin.x - rep.x, pin.y - rep.y) < 0.3, 'фишка перетащена из лотка к точке донесения (±0.3 км в основном виде)', [pin, rep]);
  ok(near(s.counters.x, pin.x, 0.006) && near(s.counters.y, pin.y, 0.006), 'счётчики X, Y показывают фишку', s.counters);
  ok(s.lamps.fresh === false, 'лампа «НОВОЕ ДОНЕСЕНИЕ» гаснет после постановки фишки');

  // стрелки: одиночное нажатие и автоповтор
  await tap(await at("T.hot('btnXPlus')"));
  s = await snap();
  ok(near(s.pins[moving.id].x, pin.x + 0.01, 1e-6) && s.pins[moving.id].y === pin.y, 'стрелка X+ → +0.01 км', [pin, s.pins[moving.id]]);
  await tap(await at("T.hot('btnYPlus')"));
  await tap(await at("T.hot('btnXMinus')"));
  s = await snap();
  ok(near(s.pins[moving.id].x, pin.x, 1e-6) && near(s.pins[moving.id].y, pin.y + 0.01, 1e-6), 'стрелки X− и Y+', [pin, s.pins[moving.id]]);
  {
    const p = await at("T.hot('btnYMinus')");
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    await step(40, 0.05);                                  // 2 с удержания
    await page.mouse.up();
  }
  s = await snap();
  ok(s.pins[moving.id].y < pin.y - 0.05, 'удержание Y− — автоповтор', [pin.y, s.pins[moving.id].y]);
  // точная установка стрелок не проверяем дальше — ставим фишку ровно по донесению (как довёл бы игрок)
  await page.evaluate(([id, x, y]) => window.__dev.game.setPin(id, x, y), [moving.id, rep.x, rep.y]);
  s = await snap();
  ok(s.lead === true, '«Курсант»: отметки упреждения у движущейся цели видны');

  // ---- 2. алидада ----
  console.log('алидада');
  const turn = async (name, deg) => {
    const c = await at("T.hot('" + name + "')");
    const o = await at("(() => { const o = T.st.hotspots." + name + "; o.updateWorldMatrix(true,false); const E = window.__dev.engine.THREE; return [T.scr(o.localToWorld(new E.Vector3(0.12,0,0))), T.scr(o.localToWorld(new E.Vector3(0,0.12,0)))]; })()");
    const ax = { x: o[0].x - c.x, y: o[0].y - c.y }, ay = { x: o[1].x - c.x, y: o[1].y - c.y };
    const pt = (a) => ({ x: c.x + ax.x * Math.cos(a) + ay.x * Math.sin(a), y: c.y + ax.y * Math.cos(a) + ay.y * Math.sin(a) });
    const n = Math.max(6, Math.round(Math.abs(deg) / 6));
    await page.mouse.move(pt(0).x, pt(0).y); await page.mouse.down();
    for (let i = 1; i <= n; i++) { const p = pt(-deg * Math.PI / 180 * i / n); await page.mouse.move(p.x, p.y); }   // по часовой: угол в плоскости убывает
    await page.mouse.up();
  };
  await page.evaluate(() => window.__dev.game.setAlidade({ bearing: 40, range: 3 }));
  let b0 = (await snap()).al;
  await turn('bearingWheel', 180);
  s = await snap();
  ok(near(s.al.bearing - b0.bearing, 1.0, 0.25) && s.al.range === b0.range, 'маховик «ПЕЛЕНГ»: пол-оборота по часовой ≈ +1°', [b0, s.al]);
  await turn('bearingWheel', -90);
  let s2 = await snap();
  ok(near(s2.al.bearing - s.al.bearing, -0.5, 0.2), 'маховик «ПЕЛЕНГ» против часовой ≈ −0.5°', [s.al, s2.al]);
  await turn('rangeWheel', 180);
  s = await snap();
  ok(near(s.al.range - s2.al.range, 0.1, 0.03) && s.al.bearing === s2.al.bearing, 'маховик «ДАЛЬНОСТЬ»: пол-оборота ≈ +0.10 км', [s2.al, s.al]);
  ok(near(s.counters.b, s.al.bearing, 0.06) && near(s.counters.r, s.al.range, 0.006), 'счётчики «ПЕЛЕНГ» и «ДАЛЬНОСТЬ» следуют за алидадой', s.counters);

  // линейка: поворот перетаскиванием (дальность не меняется); берёмся подальше от фишек и визира
  {
    const bat = s.bat, r = 6, rad = Math.PI / 180;
    const pb = Math.atan2(rep.x - bat.x, rep.y - bat.y) / rad;
    const base = [300, 330, 0, 30, 60].sort((a, b) => Math.abs(((b - pb + 540) % 360) - 180) - Math.abs(((a - pb + 540) % 360) - 180))[0];
    const to = base + (((base - pb + 540) % 360) - 180 > 0 ? 15 : -15);
    await page.evaluate((b) => window.__dev.game.setAlidade({ bearing: b, range: 1.5 }), base);
    await step(2);
    const p0 = await at('T.chart(' + (bat.x + r * Math.sin(base * rad)) + ',' + (bat.y + r * Math.cos(base * rad)) + ')');
    const p1 = await at('T.chart(' + (bat.x + r * Math.sin(to * rad)) + ',' + (bat.y + r * Math.cos(to * rad)) + ')');
    await drag(p0, p1, 10);
    s = await snap();
    ok(near((((s.al.bearing - to) % 360 + 540) % 360) - 180, 0, 5) && s.al.range === 1.5, 'линейку можно повернуть перетаскиванием', [base, to, s.al]);
    ok(s.pins[moving.id].x === rep.x && s.pins[moving.id].y === rep.y, 'фишка при этом не тронута', s.pins);
  }

  // визир: перетаскивание к фишке, на «Курсанте» примагничивается
  {
    const sk = await at('T.sight()');
    const p0 = await at('T.chart(' + sk.x + ',' + sk.y + ')'), p1 = await at('T.chart(' + rep.x + ',' + rep.y + ')');
    // жест «съедает» порог начала перетаскивания — компенсируем вдоль пути
    const L = Math.hypot(p1.x - p0.x, p1.y - p0.y), k = (L + 5.5) / L;
    await drag(p0, { x: p0.x + (p1.x - p0.x) * k, y: p0.y + (p1.y - p0.y) * k }, 12);
  }
  s = await snap();
  {
    const dx = rep.x - s.bat.x, dy = rep.y - s.bat.y;
    const eb = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360, er = Math.hypot(dx, dy);
    ok(near(s.al.bearing, eb, 3) && near(s.al.range, er, 0.5), 'визир перетащен к фишке', [s.al, eb, er]);
  }
  // точное совмещение под лупой. Визир ставим в стороне от фишки: когда они совпадают, касание в центре берёт фишку
  await page.evaluate(([x, y]) => { const g = window.__dev.game, b = g.state.mission.battery; const dx = x - b.x, dy = y - b.y; g.setAlidade({ bearing: Math.atan2(dx, dy) * 180 / Math.PI, range: Math.hypot(dx, dy) }); }, [rep.x + 0.45, rep.y + 0.4]);
  s = await snap();
  ok(s.lamps.aligned === false, 'визир в 0.6 км от фишки — «СОВМЕЩЕНО» не горит');
  await tap(await at("T.hot('btnLoupe')"));
  await step(30, 0.05);
  s = await snap();
  ok(s.loupe === true && s.fov < 20, 'кнопка «ЛУПА» включает крупный план', [s.loupe, s.fov]);
  {
    const sk = await at('T.sight()');
    const p0 = await at('T.chart(' + sk.x + ',' + sk.y + ')'), p1 = await at('T.chart(' + (rep.x + 0.06) + ',' + (rep.y - 0.05) + ')');
    ok(inSafe(p0), 'визир под лупой в кадре', p0);
    const L = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1, k = (L + 5.5) / L;
    await drag(p0, { x: p0.x + (p1.x - p0.x) * k, y: p0.y + (p1.y - p0.y) * k }, 12);
  }
  await step(20, 0.05);
  s = await snap();
  {
    const sk = await at('T.sight()');
    ok(Math.hypot(sk.x - rep.x, sk.y - rep.y) <= 0.03, '«Курсант»: визир, отпущенный в 0.15 км от фишки, садится на неё', [sk, rep, s.al]);
    ok(s.lamps.aligned === true, 'лампа «СОВМЕЩЕНО» горит');
  }
  // под лупой фишка двигается точно
  {
    const h = await at('T.handle(' + moving.id + ')');
    const a = await at('T.chart(10, 10)'), b = await at('T.chart(10.2, 10)');
    const pxKm = (b.x - a.x) / 0.2;
    ok(pxKm > 100, 'под лупой 0.01 км ≥ 1 px', pxKm);
    await drag(h, { x: h.x + 5.5 + pxKm * 0.2, y: h.y }, 10);
    await step(20, 0.05);
    s = await snap();
    ok(near(s.pins[moving.id].x, rep.x + 0.2, 0.03) && near(s.pins[moving.id].y, rep.y, 0.02), 'под лупой фишка сдвинута на 0.20 км', [s.pins[moving.id], rep]);
    ok(s.lamps.aligned === false, 'лампа «СОВМЕЩЕНО» погасла: фишка ушла от визира');
  }
  await tap(await at("T.hot('btnOverview')"));
  await step(30, 0.05);
  s = await snap();
  ok(s.loupe === false && s.fov > 40, 'плашка «ОБЗОР» возвращает основной вид', [s.loupe, s.fov]);
  {
    const p = await at('T.chart(15, 15)');
    await doubleTap(p, true);
    await step(30, 0.05);
    s = await snap();
    ok(s.loupe === true, 'двойное касание карты включает лупу');
    const c = { x: W / 2, y: 190 };
    await doubleTap(c, false);
    await step(30, 0.05);
    s = await snap();
    ok(s.loupe === false && s.fov > 40, 'двойное касание под лупой — обратно', [s.loupe, s.fov]);
  }

  // ---- 2б. лупа: карту двигают пальцем ----
  console.log('лупа: карта под пальцем');
  {
    const view = () => at('T.st.api.loupeView');
    const plateShown = () => at("(() => { const o = T.st.hotspots.btnToSight; for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; })()");
    /** Пустое место листа возле центра кадра: под пальцем ни фишки, ни визира, ни линейки; путь пальца d (км) в кадре. */
    const findEmpty = async (v, d) => {
      for (const [ox, oy] of [[0.9, -0.5], [-0.9, -0.5], [0.9, 0.45], [-0.9, 0.45], [0.4, -0.75], [-0.4, 0.7], [1.4, 0], [-1.4, 0], [0, -0.8], [1.6, -0.6], [-1.6, 0.6]]) {
        const q = { x: v.x + ox, y: v.y + oy };
        if ((await at('T.st.api.pickAt(' + q.x + ',' + q.y + ')')) !== 'none') continue;
        const sa = await at('T.chart(' + q.x + ',' + q.y + ')'), sb = await at('T.chart(' + (q.x + d.x) + ',' + (q.y + d.y) + ')');
        if (inSafe(sa) && inSafe(sb) && !(await at('T.onPlate(' + sa.x + ',' + sa.y + ')'))) return { q, sa, sb };
      }
      return null;
    };
    /** Перетаскивание мышью с компенсацией порога (5 px «съедаются»); hold — пауза перед отпусканием (без инерции). */
    const panBy = async (e, hold = 150, gap = 0) => {
      const L = Math.hypot(e.sb.x - e.sa.x, e.sb.y - e.sa.y) || 1, k = (L + 5) / L;
      const b = { x: e.sa.x + (e.sb.x - e.sa.x) * k, y: e.sa.y + (e.sb.y - e.sa.y) * k };
      await page.mouse.move(e.sa.x, e.sa.y); await page.mouse.down();
      for (let i = 1; i <= 8; i++) { await page.mouse.move(e.sa.x + (b.x - e.sa.x) * i / 8, e.sa.y + (b.y - e.sa.y) * i / 8); if (gap) await page.waitForTimeout(gap); }
      if (hold) await page.waitForTimeout(hold);
      await page.mouse.up();
    };
    await tap(await at("T.hot('btnLoupe')"));
    await step(30, 0.05);
    s = await snap();
    const pin0 = s.pins[moving.id], al0 = s.al;
    let v0 = await view();
    ok(s.loupe && !v0.panned && !(await plateShown()) && near(v0.x, pin0.x, 0.01) && near(v0.y, pin0.y, 0.01), 'лупа открыта у фишки, плашки «К ВИЗИРУ» нет', [v0, pin0]);
    // 1) перетаскивание по пустому месту двигает кадр ровно на путь пальца (по карте), фишка и алидада на месте
    let d = { x: -0.6, y: 0.4 }, e = await findEmpty(v0, d);
    ok(!!e, 'под лупой нашлось пустое место для пальца', v0);
    await panBy(e);
    await step(3);
    let v1 = await view();
    s = await snap();
    ok(near(v1.x, v0.x - d.x, 0.02) && near(v1.y, v0.y - d.y, 0.02), 'карта идёт за пальцем 1:1 (сдвиг 0.72 км ±0.02)', [v0, v1, d]);
    ok(v1.panned && (await plateShown()) && s.loupe, 'карта отведена — видна плашка «К ВИЗИРУ», лупа не снята', v1);
    ok(s.pins[moving.id].x === pin0.x && s.pins[moving.id].y === pin0.y && s.al.bearing === al0.bearing && s.al.range === al0.range, 'фишка и алидада при этом не тронуты', [s.pins[moving.id], s.al]);
    {
      const tags = await at('[T.st.group.getObjectByName("chartBoard")].length');
      if (process.env.PLOT_SHOT) { await step(2); await page.screenshot({ path: process.env.PLOT_SHOT }); }
      ok(tags === 1, 'снимок кадра');
    }
    // 2) «К ВИЗИРУ» возвращает кадр к фишке активной цели
    await tap(await at("T.hot('btnToSight')"));
    await step(30, 0.05);
    v1 = await view();
    ok(!v1.panned && near(v1.x, pin0.x, 0.01) && near(v1.y, pin0.y, 0.01) && !(await plateShown()), 'плашка «К ВИЗИРУ» возвращает кадр к фишке', [v1, pin0]);
    // 3) отвели чуть-чуть — фишку за ручку всё равно тащит палец, кадр за ней больше не едет
    d = { x: 0.25, y: -0.2 }; e = await findEmpty(v1, d);
    await panBy(e);
    await step(3);
    v0 = await view();
    {
      const h = await at('T.handle(' + moving.id + ')');
      const a = await at('T.chart(10, 10)'), b = await at('T.chart(10.2, 10)'), pxKm = (b.x - a.x) / 0.2;
      ok(inSafe(h) && v0.panned, 'фишка в кадре отведённой лупы', [h, v0]);
      await drag(h, { x: h.x + 5.5 + pxKm * 0.2, y: h.y }, 10, 120);
      await step(20, 0.05);
      s = await snap();
      v1 = await view();
      ok(near(s.pins[moving.id].x, pin0.x + 0.2, 0.03) && near(s.pins[moving.id].y, pin0.y, 0.02), 'под отведённой лупой фишка тащится пальцем (+0.20 км), а не карта', [s.pins[moving.id], pin0]);
      ok(v1.panned && near(v1.x, v0.x, 1e-6) && near(v1.y, v0.y, 1e-6), 'кадр отведённой лупы за фишкой не едет', [v0, v1]);
    }
    // 4) бросок: карта едет дальше по инерции и останавливается
    d = { x: 0.7, y: 0 }; e = await findEmpty(v1, d);
    await panBy(e, 0, 18);
    const vr = await view();
    await step(60, 0.05);
    let v2 = await view();
    ok(vr.flinging && !v2.flinging && v1.x - v2.x > d.x + 0.15 && near(v2.y, v1.y, 0.08), 'бросок пальцем: карта едет по инерции и останавливается', [v1, vr, v2]);
    // 5) короткое касание пустого места кадр не двигает
    e = await findEmpty(v2, { x: 0, y: 0 });
    await tap(e.sa);
    await step(4);
    v1 = await view();
    ok((await at('T.st.api.loupe')) && near(v1.x, v2.x, 1e-6) && near(v1.y, v2.y, 1e-6), 'касание под лупой карту не двигает', [v2, v1]);
    await page.waitForTimeout(600);                         // не сложилось бы в двойное касание
    // 6) вышли из лупы и вернулись — снова по центру фишки
    await tap(await at("T.hot('btnOverview')"));
    await step(30, 0.05);
    await tap(await at("T.hot('btnLoupe')"));
    await step(30, 0.05);
    v1 = await view();
    s = await snap();
    ok(s.loupe && !v1.panned && near(v1.x, s.pins[moving.id].x, 0.01) && near(v1.y, s.pins[moving.id].y, 0.01), 'повторная лупа — снова у фишки', [v1, s.pins[moving.id]]);
    // 7) край листа: кадр упирается в рамку, бросок у края гаснет
    await tap(await at("T.hot('btnOverview')"));
    await step(30, 0.05);
    await page.waitForTimeout(600);
    await doubleTap(await at('T.chart(1.3, 10)'), true);
    await step(30, 0.05);
    v0 = await view();
    ok(v0.x < 2 && !v0.panned, 'двойное касание у края — лупа у края листа', v0);
    d = { x: 1.5, y: 0 }; e = await findEmpty(v0, d);
    await panBy(e);
    await step(3);
    v1 = await view();
    ok(near(v1.x, 0, 0.005) && near(v1.y, v0.y, 0.02), 'кадр упирается в край карты', [v0, v1]);
    e = await findEmpty(v1, { x: 1.2, y: 0 });
    await panBy(e, 0, 18);
    await step(40, 0.05);
    v2 = await view();
    ok(near(v2.x, 0, 0.005) && !v2.flinging, 'бросок к краю: кадр стоит у края', v2);
    await tap(await at("T.hot('btnOverview')"));
    await step(30, 0.05);
    s = await snap();
    ok(!s.loupe && s.fov > 40, 'лупа снята', s.fov);
  }

  // оболочка сама вернула основной вид (повторный gotoStation) — пост снимает лупу
  await tap(await at("T.hot('btnLoupe')"));
  await step(40, 0.05);
  await page.evaluate(() => window.__dev.engine.gotoStation('plot'));
  await step(40, 0.05);
  s = await snap();
  ok(s.loupe === false && s.fov > 40, 'основной вид, заданный извне, снимает лупу', [s.loupe, s.fov]);

  // ---- 3. запись ----
  console.log('запись');
  await page.evaluate(([id, x, y]) => window.__dev.game.setPin(id, x, y), [moving.id, rep.x, rep.y]);
  await tap(await at("T.hot('btnRecord')"));
  s = await snap();
  ok(s.rec[moving.id] && s.rec[moving.id].bearing === s.al.bearing && s.rec[moving.id].range === s.al.range, '«ЗАПИСАТЬ» → замер в state.plot.recorded', s.rec);
  ok(s.lamps.recorded === true, 'лампа «ЗАПИСАНО» горит');
  await turn('rangeWheel', 540);                           // дальше 0.15 км — иначе «Курсант» вернёт визир на фишку
  s = await snap();
  ok(s.lamps.recorded === false, 'лампа «ЗАПИСАНО» гаснет, когда алидаду сдвинули');

  // маховик тоже примагничивает (отпускание рядом с фишкой)
  await page.evaluate(([x, y]) => { const g = window.__dev.game, b = g.state.mission.battery; const dx = x - b.x, dy = y - b.y; g.setAlidade({ bearing: Math.atan2(dx, dy) * 180 / Math.PI, range: Math.hypot(dx, dy) + 0.1 }); }, [rep.x, rep.y]);
  await turn('rangeWheel', 20);
  s = await snap();
  ok(s.lamps.aligned === true, '«Курсант»: после маховика визир рядом с фишкой примагничен', s.al);

  // ---- 4. «Командир»: без примагничивания и без отметок упреждения ----
  console.log('сложность «Командир»');
  await page.evaluate(([x, y]) => { const g = window.__dev.game, b = g.state.mission.battery; g.setDifficulty(1); const dx = x - b.x, dy = y - b.y; g.setAlidade({ bearing: Math.atan2(dx, dy) * 180 / Math.PI, range: Math.hypot(dx, dy) + 0.1 }); }, [rep.x, rep.y]);
  await turn('rangeWheel', 20);
  s = await snap();
  ok(s.diff === 1 && s.lamps.aligned === false && s.lead === false, 'нет примагничивания и отметок упреждения', [s.al, s.lead]);
  await page.evaluate(() => window.__dev.game.setDifficulty(0));

  // ---- 5. новое донесение о движущейся цели ----
  console.log('новое донесение');
  {
    const p = await at("T.hot('btnXPlus')");
    await tap(p);                                           // фишку двигали «сейчас»
    s = await snap();
    ok(s.lamps.fresh === false, 'после подвижки фишки лампа не горит');
    const t0 = s.targets.find((t) => t.id === moving.id).reported.time;
    await page.evaluate(([id, t0]) => { const g = window.__dev.game; for (let i = 0; i < 4000 && g.state.targets.find((t) => t.id === id).reported.time === t0 && g.state.phase === 'playing'; i++) g.update(0.05); }, [moving.id, t0]);
    s = await snap();
    const t1 = s.targets.find((t) => t.id === moving.id).reported.time;
    ok(t1 > t0 && s.lamps.fresh === true, 'пришло новое донесение → лампа «НОВОЕ ДОНЕСЕНИЕ»', [t0, t1, s.phase, s.lamps]);
  }

  // ---- 6. перезапуск задания ----
  console.log('перезапуск задания');
  await tap(await at("T.hot('btnLoupe')"));
  await step(10, 0.05);
  await page.evaluate(() => { const g = window.__dev.game; g.startMission(1); });
  s = await snap(4);
  ok(s.phase === 'briefing' && s.loupe === false && Object.keys(s.pins).length === 0, 'новое задание: лупа снята, фишек нет', [s.phase, s.loupe]);
  await page.evaluate(() => { const g = window.__dev.game; g.begin(); for (let i = 0; i < 600 && !g.state.targets.every((t) => t.reported); i++) g.update(0.05); });
  await step(30, 0.05);
  s = await snap();
  {
    const id = s.active, r = s.targets.find((t) => t.id === id).reported;
    await dragPinTo(id, r.x, r.y, true);
    s = await snap();
    ok(s.pins[id] && Math.hypot(s.pins[id].x - r.x, s.pins[id].y - r.y) < 0.3, 'после перезапуска фишка ставится на карту пальцем (касание)', [s.pins, r]);
    const x0 = s.pins[id].x;
    await touchTap(await at("T.hot('btnXPlus')"));
    s = await snap();
    ok(near(s.pins[id].x, x0 + 0.01, 1e-6), 'касание стрелки X+ пальцем → +0.01 км', [x0, s.pins[id].x]);
    const o2 = s.targets.find((t) => t.id !== id);
    if (o2) {
      await touchTap(await at('T.handle(' + o2.id + ')'));
      s = await snap();
      ok(s.active === o2.id, 'касание пальцем фишки в лотке выбирает цель ' + o2.id, s.active);
    }
  }
  // ---- 7. ночь: квадрат поиска, фишка — только после света осветительного ----
  console.log('ночное задание');
  {
    const n = await page.evaluate(() => {
      const g = window.__dev.game; g.startMission(24); g.begin();
      for (let i = 0; i < 600 && !g.state.mission.areas.length; i++) g.update(0.05);
      window.T.step(4);
      const st = window.T.st, a = g.state.mission.areas[0], t = a && g.state.targets.find((q) => q.id === a.targetId);
      return { night: g.state.mission.night, area: a, areas: st.api.areas, tint: st.api.overlay.tint, reported: t && t.reported, pin: a && st.api.pinVisible(a.targetId) };
    });
    ok(n.night && n.area && n.areas.includes(n.area.targetId) && n.tint === 'night', 'ночь: квадрат поиска цели показан на карте', n);
    ok(n.reported === null && n.pin === true, 'ночь: донесения нет, но фишка цели есть — её ставят в квадрат под осветительный', [n.reported, n.pin]);
    const m = await page.evaluate((id) => {
      const g = window.__dev.game, t = g.state.targets.find((q) => q.id === id);
      g.state.lights.push({ x: t.x, y: t.y, until: g.state.time + 60, n: 0 });          // свет осветительного над целью
      for (let i = 0; i < 400 && !t.reported; i++) g.update(0.05);
      window.T.step(4);
      const st = window.T.st, r = { reported: t.reported, pin: st.api.pinVisible(id), areas: st.api.areas, lights: st.api.overlay.lights };
      // фишку — на донесение; свет гаснет → пометка «?»
      g.setPin(id, t.reported.x, t.reported.y);
      g.state.lights.forEach((l) => { l.until = g.state.time + 0.1; });
      for (let i = 0; i < 20; i++) g.update(0.05);
      window.T.step(4);
      r.after = { lit: t.lit, pin: st.api.pinVisible(id), mark: st.api.overlay.marks[id], lights: st.api.overlay.lights };
      return r;
    }, n.area.targetId);
    ok(m.reported && m.pin === true && m.lights === 1, 'цель в свете осветительного → донесение и фишка', m);
    ok(!m.areas.includes(n.area.targetId), 'после точного донесения квадрат снят', m.areas);
    ok(m.after.lit === false && m.after.pin === true && m.after.mark === 'lost' && m.after.lights === 0, 'свет погас: фишка остаётся с пометкой «?»', m.after);
  }
  // оборона: номера целей растут без конца — фишка должна быть и у цели с номером больше шести
  {
    const v = await page.evaluate(() => {
      const g = window.__dev.game; g.quit(); g.startSurvival(); g.begin();
      for (let i = 0; i < 600 && !g.state.targets.some((q) => q.reported); i++) g.update(0.05);
      const t = g.state.targets.find((q) => q.reported);
      if (!t) return null;
      const old = t.id; t.id = 17; t.label = 'ЦЕЛЬ 17'; if (g.state.activeTarget === old) g.state.activeTarget = 17;
      window.T.step(4);
      const st = window.T.st;
      return { pin: st.api.pinVisible(17), hot: !!st.hotspots.pin17, oldGone: !st.hotspots['pin' + old], handle: !!st.api.pinHandleWorld(17) };
    });
    ok(v && v.pin && v.hot && v.oldGone && v.handle, 'оборона: у цели № 17 есть фишка, фишка ушедшего номера убрана', v);
  }
  // ---- 8. конвой: свои корабли, пеленг и сектор трубы, тонущая цель, снимок со своим ----
  console.log('конвой, труба, налёт');
  {
    const v = await page.evaluate(() => {
      const g = window.__dev.game, st = window.T.st, T = window.T; g.quit(); g.startMission(30); g.begin();
      for (let i = 0; i < 800 && !g.state.targets.some((q) => q.reported); i++) g.update(0.05);
      T.step(4);
      const r = { n: g.state.friends.length, friends: st.api.friends, courses: st.api.overlay.courses, lines0: st.api.scopeLines };
      g.setScope({ bearing: 33, zoom: 10 });
      T.step(3);
      r.scope = st.api.scope;
      r.mark = g.scopeMark(); g.setScope({ bearing: 350 }); g.scopeMark();
      T.step(3);
      r.lines = st.api.scopeLines; r.stateLines = g.state.plot.lines.map((q) => q.from);
      return r;
    });
    ok(v.n >= 3 && v.friends.length === v.n && v.friends.every((f) => f.state === 'ok' && !f.ring) && v.courses === v.n, 'свои корабли конвоя на карте с курсами', v);
    ok(v.scope && near(v.scope.bearing, 33, 0.01) && near(v.scope.fov, 6.4, 0.01), 'сектор трубы на карте следует за state.scope', v.scope);
    ok(v.lines0 === 0 && v.mark && v.mark.ok && v.lines === 2 && v.stateLines.every((q) => q === 'scope'), 'game.scopeMark() → пеленг трубы на карте', v);
    await tap(await at("T.hot('btnErase')"));
    const e = await page.evaluate(() => { window.T.step(3); return { lines: window.T.st.api.scopeLines, st: window.__dev.game.state.plot.lines.length }; });
    ok(e.lines === 0 && e.st === 0, '«СТЕРЕТЬ» убирает и пеленги трубы', e);

    // свой корабль нельзя ни выбрать, ни утащить
    const f0 = v.friends[0], act0 = await at('window.__dev.game.state.activeTarget');
    const fp = await at('T.chart(' + f0.x + ',' + f0.y + ')');
    await tap(fp);
    await drag(fp, { x: fp.x + 30, y: fp.y - 20 }, 6);
    const w = await page.evaluate((id) => {
      const g = window.__dev.game, st = window.T.st, T = window.T, f = g.state.friends.find((q) => q.id === id);
      const r = { active: g.state.activeTarget, x: f.x, y: f.y, pins: Object.keys(g.state.plot.pins).length };
      st.api.setLoupe(true); T.step(30, 0.05);
      r.ring = st.api.friends.every((q) => q.ring);
      st.api.setLoupe(false); T.step(30, 0.05);
      // снимок разрыва рядом со своим
      g.state.impacts.push({ n: 99, x: f.x + 0.3, y: f.y - 0.2, time: g.state.time - 3, shell: 'he', hit: false, targetId: null, snap: [], craters: [], land: false, pair: null, observed: false });
      T.step(4);
      r.photo = st.api.photoFriends(99);
      // потоплен и дошёл
      const fs = g.state.friends;
      fs[0].alive = false; fs[0].sinking = { since: g.state.time, dur: 18 }; fs[1].arrived = true; fs[1].speed = 0;
      T.step(3);
      r.states = st.api.friends.map((q) => q.state);
      fs[0].alive = true; fs[0].sinking = null; fs[1].arrived = false;
      // цель поражена: фишка серая со знаком «тонет», потом — крест
      const t = g.state.targets.find((q) => q.reported);
      g.setPin(t.id, t.reported.x, t.reported.y);
      T.step(2); r.row0 = st.api.pinRow(t.id);
      t.alive = false; t.sinking = { since: g.state.time, dur: 18 };
      T.step(3); r.row1 = st.api.pinRow(t.id); r.sinking = st.api.overlay.sinking.includes(t.id); r.pin1 = st.api.pinVisible(t.id);
      t.sunk = true;
      T.step(3); r.row2 = st.api.pinRow(t.id); r.sinking2 = st.api.overlay.sinking.includes(t.id); r.pin2 = st.api.pinVisible(t.id);
      return r;
    }, f0.id);
    ok(w.active === act0 && near(w.x, f0.x, 0.3) && near(w.y, f0.y, 0.3) && w.pins === 0, 'свой корабль не выбирается и не перетаскивается', [w.active, act0, w.pins]);
    ok(w.ring === true, 'под лупой у своих — круг 0.25 км');
    ok(w.photo.includes(f0.id), 'на аэрофотоснимке рядом со своим кораблём он виден', w.photo);
    ok(w.states[0] === 'sunk' && w.states[1] === 'arrived', 'потопленный свой — крест, дошедший — галочка', w.states);
    ok(w.row0 < 2 && w.row1 === 3 && w.sinking && w.pin1, 'поражённая цель: фишка серая со знаком «ТОНЕТ», пока не скрылась', w);
    ok(w.row2 === 2 && !w.sinking2 && w.pin2, 'затонула — обычная поражённая фишка с крестом', w);
  }
  // налёт: штамп «ВОЗДУХ» с предупреждения и до конца, самолёты на карте (за рамкой — на её краю)
  {
    const v = await page.evaluate(() => {
      const g = window.__dev.game, st = window.T.st, T = window.T; g.quit(); g.startMission(31); g.begin();
      let warned = false;
      const off = g.on('raid', (e) => { if (e.phase === 'warning') warned = true; });
      T.step(3);
      const r = { before: st.api.raid };
      for (let i = 0; i < 2400 && !warned && g.state.phase === 'playing'; i++) g.update(0.05);
      T.step(3); r.warn = st.api.raid; r.warned = warned;
      for (let i = 0; i < 600 && !g.state.raid && g.state.phase === 'playing'; i++) g.update(0.05);
      T.step(3); r.start = st.api.raid; r.n = g.state.raid ? g.state.raid.planes.length : 0;
      if (g.state.raid) { g.state.raid.planes[0].range = 40; T.step(3); r.far = st.api.raid.planes[0]; }
      off();
      g.quit(); T.step(3); r.after = st.api.raid; r.friends = st.api.friends.length;
      return r;
    });
    ok(v.before === null && v.warned && v.warn && v.warn.stamp && v.warn.phase === 'warning', 'предупреждение о налёте → штамп «ВОЗДУХ»', [v.before, v.warn]);
    ok(v.start && v.start.stamp && v.start.phase === 'inbound' && v.n >= 2 && v.start.planes.length === v.n, 'налёт: самолёты на карте', v.start);
    ok(v.far && v.far.off && v.far.x >= 0 && v.far.x <= 20 && v.far.y >= 0 && v.far.y <= 20, 'самолёт за рамкой карты показан на её краю', v.far);
    ok(v.after === null && v.friends === 0, 'после выхода штамп и свои корабли сняты', [v.after, v.friends]);
  }
  await page.evaluate(() => { const g = window.__dev.game; g.quit(); });
  s = await page.evaluate(() => { window.T.step(3); return { phase: window.__dev.game.state.phase, mission: !!window.__dev.game.state.mission }; });
  ok(true, 'выход в меню без ошибок (' + s.phase + ')');
  ok(s && (await at('T.denied.length')) === 1, 'за весь тест — единственный отказ (намеренный)', await at('T.denied'));
  ok(problems.length === 0, 'нет ошибок и предупреждений в консоли', problems);

  await browser.close();
  console.log('\n' + passed + ' проверок пройдено, ' + failed + ' провалено');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
