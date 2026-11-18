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
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
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
  const tap = async (p) => { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.up(); };
  /** Тащит фишку за ручку-диск так, чтобы остриё пришло в (x, y) км; порог начала перетаскивания (5 px) компенсируется. */
  const dragPinTo = async (id, x, y) => {
    const h = await at('T.handle(' + id + ')');
    const c = await at('(() => { const o = T.st.api.handleOffsetKm; return T.chart(' + x + ' + o.x, ' + y + ' + o.y); })()');
    const L = Math.hypot(c.x - h.x, c.y - h.y) || 1, k = (L + 5.5) / L;
    await drag(h, { x: h.x + (c.x - h.x) * k, y: h.y + (c.y - h.y) * k }, 10);
  };
  /** Двойное касание. Кадры на время жеста остановлены: при программном рендере между касаниями иначе проходит > 0.45 с. */
  const doubleTap = async (p) => {
    await page.evaluate(() => window.__dev.engine.stop());
    await tap(p); await tap(p);
    await page.evaluate(() => window.__dev.engine.start());
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
    await doubleTap(p);
    await step(30, 0.05);
    s = await snap();
    ok(s.loupe === true, 'двойное касание карты включает лупу');
    const c = { x: W / 2, y: 190 };
    await doubleTap(c);
    await step(30, 0.05);
    s = await snap();
    ok(s.loupe === false && s.fov > 40, 'двойное касание под лупой — обратно', [s.loupe, s.fov, await at('T.st.api._dbg')]);
  }

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
    await dragPinTo(id, r.x, r.y);
    s = await snap();
    ok(s.pins[id] && Math.hypot(s.pins[id].x - r.x, s.pins[id].y - r.y) < 0.3, 'после перезапуска фишка снова ставится на карту', [s.pins, r]);
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
