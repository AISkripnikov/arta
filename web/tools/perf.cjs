// Замер времени кадра и числа вызовов отрисовки в headless Chromium (SwiftShader — программный WebGL: цифры годятся
// только для сравнения «до/после» на этой же машине, не как кадры в секунду на телефоне).
//
//   node tools/perf.cjs <каталог> [--w 844] [--h 390] [--dpr 2] [--frames 12] [--quality high,mid,low] [--mission 3]
//                                 [--throttle 4] (замедление CPU через CDP) [--live 4] (живой цикл: к/с по постам --stations, покой и стрельба)
//                                 [--sim 5] [--seed 1] [--aim 1] [--stations fire,aa] [--json файл.json] [--txt файл.txt]
//                                 [--eval "js перед замером"]...
//
//   <каталог> — стенд (.dev/gallery, .dev/st-fire: на странице window.__dev) или полная игра (каталог боевой или личной
//               сборки: window.__arta). Не указан — берётся ARTA_WWW, иначе app/src/main/assets/www.
//   Полная игра: ролик и «ЧТО НОВОГО» считаются просмотренными, запускается задание --mission (по умолчанию 3, как в
//   tools/tour.cjs), бой проматывается на --sim секунд (логика без отрисовки), потом идёт замер. Чтобы сцена была одна и
//   та же от запуска к запуску: перед заданием Math.random подменяется генератором с зерном --seed, а башня и труба
//   наблюдения наводятся на первую цель (--aim 0 — не наводить) — в смотровой щели и окуляре есть корабль, их 3D-слой рисуется.
//   --quality  — список уровней качества через запятую (engine.setQuality); без него меряется текущий уровень и печатается
//               одна строка JSON { пост: {...} }, с ним — { уровень: { пост: {...} } } и таблица. Качество «АВТО» (в полной
//               игре оно по умолчанию) на время замера выключается: каждый уровень ставится явно и сам не меняется.
//   --json/--txt — записать результат (с шапкой meta) и таблицу в файлы.
//
// Что в цифрах (на каждый пост; цикл движка остановлен, кадры шагаются вручную engine.debug.step(1/60)):
//   ms       — медиана времени кадра, мс: логика + все проходы отрисовки + ожидание конца работы GPU (readPixels);
//   min, max — самый быстрый и самый медленный кадр из --frames;
//   logic    — медиана шага без основной отрисовки (engine.debug.step(dt, false)): логика постов и их текстуры-виды;
//   calls    — вызовы отрисовки ОСНОВНОГО прохода: всё, что нарисовано вызовами renderer.render(engine.scene, engine.camera)
//              за кадр, БЕЗ прохода карты теней (three рисует её внутри того же render; движок считает её отдельно —
//              engine.debug.stats().shadowCalls). Это то же число, что engine.debug.stats().calls в тестах постов (≤ 120);
//   shadow   — вызовы прохода карты теней при её перерисовке (перед замером карта перерисовывается принудительно; в обычном
//              кадре она перерисовывается только когда что-то сдвинулось, не чаще 15 раз в секунду); shadowFrames — в скольких
//              из замеренных кадров карта перерисовывалась (0 — сцена стояла);
//   post     — вызовы полноэкранных проходов постобработки (0 — цепочки нет: уровень low);
//   callsAll — все вызовы отрисовки кадра: основной проход + тени + текстуры-виды постов (щель, окуляр) + постобработка;
//              passes — сколько раз за кадр вызван renderer.render;
//   tris     — треугольники основного прохода; trisAll — всех проходов.
//   calls, callsAll, passes, tris, trisAll — по самому тяжёлому из замеренных кадров: виды постов перерисовываются не
//   каждый кадр (щель — раз в 0,16 с игрового времени), поэтому --frames по умолчанию 12 (0,2 с): перерисовка в замер попадает.
// Сравнивать «до/после» — одной и той же командой, когда машина не занята другими браузерами.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const a = process.argv.slice(2);
  const STR = new Set(['quality', 'json', 'txt', 'stations']);
  const opt = { w: 844, h: 390, dpr: 2, frames: 12, mission: 3, sim: 5, seed: 1, aim: 1, quality: '', json: '', txt: '', stations: '', throttle: 1, live: 0 }; const evals = [];
  let dir = null;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--eval') evals.push(a[++i]);
    else if (a[i].startsWith('--')) { const k = a[i].slice(2); opt[k] = STR.has(k) ? String(a[++i]) : Number(a[++i]); }
    else if (dir == null) dir = a[i];
  }
  dir = path.resolve(dir || process.env.ARTA_WWW || path.join(__dirname, '../../app/src/main/assets/www'));
  const target = fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? path.join(dir, 'index.html') : dir;
  const tiers = opt.quality ? opt.quality.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let r, scene = null;
  try {
    const ctx = await b.newContext({ viewport: { width: opt.w, height: opt.h }, deviceScaleFactor: opt.dpr, hasTouch: true });
    await ctx.addInitScript(() => { try { localStorage.setItem('arta2.intro', '1'); localStorage.setItem('arta2.news', '999'); } catch (e) { /* хранилище недоступно */ } });
    // один уровень: «АВТО» сразу стартует с него (без замера устройства и без смены уровня с перестройкой текстур перед замером)
    if (tiers.length === 1) await ctx.addInitScript((t) => { try { localStorage.setItem('arta2.autoTier', t); } catch (e) { /* хранилище недоступно */ } }, tiers[0]);
    const p = await ctx.newPage();
    p.setDefaultTimeout(300000);
    p.on('pageerror', e => console.log('PAGEERROR:', e.message));
    p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE.' + m.type() + ':', m.text()); });
    await p.goto('file://' + target + (process.env.Q || ''));
    await p.waitForFunction('window.__dev || window.__arta', null, { timeout: 120000 });
    // полная игра: в бой (на стендах задание уже идёт)
    scene = await p.evaluate(({ mission, sim, seed, aim }) => {
      if (window.__dev || !window.__arta) return null;
      const { game, engine } = window.__arta;
      engine.stop();
      // одна и та же сцена при каждом запуске: случайность боя — от зерна (mulberry32)
      let a = (seed >>> 0) || 1;
      Math.random = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      game.save.unlocked = 99; game.startMission(mission); game.begin();
      for (let t = 0; t < sim; t += 0.05) engine.debug.step(0.05, false);
      const st = game.state, bat = st.mission && st.mission.battery, tg = (st.targets || []).find((t) => !t.sunk && !t.sinking && isFinite(t.x) && isFinite(t.y));
      let bearing = null;
      if (aim && bat && tg) {
        bearing = Math.round((((Math.atan2(tg.x - bat.x, tg.y - bat.y) * 180 / Math.PI) % 360 + 360) % 360) * 100) / 100 % 360;
        st.turret.bearing = bearing;
        if (st.scope) st.scope.bearing = bearing;
        for (let i = 0; i < 4; i++) engine.debug.step(0.05, false);
      }
      return { mission: st.mission && st.mission.name, time: Math.round(st.time * 10) / 10, targets: (st.targets || []).length, aimed: bearing, night: !!(st.mission && st.mission.night), weather: (st.mission && st.mission.weather) || 'clear' };
    }, { mission: opt.mission, sim: opt.sim, seed: opt.seed, aim: opt.aim });
    for (const js of evals) await p.evaluate('(async()=>{' + js + '})()');
    // замедление процессора (CDP), как у слабого телефона: только на время замера (загрузка идёт с обычной скоростью)
    if (opt.throttle > 1) { const cdp = await ctx.newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate: opt.throttle }); }
    r = await p.evaluate(async ({ tiers, frames, only }) => {
      const host = window.__dev || window.__arta;
      const e = host.engine; e.stop();
      const R = e.renderer, gl = R.getContext(), px = new Uint8Array(4);
      // счётчики вызовов по проходам: renderer.info сбрасывается на каждом renderer.render, поэтому считаем сами
      const info = R.info, autoReset = info.autoReset, render0 = R.render;
      let acc = null;
      info.autoReset = false;
      R.render = function (scene, camera) {
        const c0 = info.render.calls, t0 = info.render.triangles;
        const out = render0.apply(R, arguments);
        if (acc) {
          const c = info.render.calls - c0, t = info.render.triangles - t0;
          acc.passes++; acc.callsAll += c; acc.trisAll += t;
          if (scene === e.scene && camera === e.camera) { acc.calls += c; acc.tris += t; }
        }
        return out;
      };
      const sync = () => { R.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
      const med = (v) => { const s = v.slice().sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
      const r1 = (v) => Math.round(v * 10) / 10;
      const ids = e.stations.map((s) => s.id).filter((id) => !only.length || only.includes(id));
      const measure = () => {
        const out = {};
        for (const id of ids) {
          e.gotoStation(id, { instant: true });
          for (let i = 0; i < 3; i++) { info.reset(); e.debug.step(1 / 60); sync(); }
          // проход теней: один раз перерисовываем карту принудительно и считаем её вызовы (в замер кадра он не входит)
          let shadow = 0, shadowFrames = 0, postCalls = 0;
          const dstats = () => (e.debug.stats ? e.debug.stats() : {});
          if (e.shadowsDirty) {
            for (let i = 0; i < 6 && !shadow; i++) { e.shadowsDirty(); info.reset(); e.debug.step(1 / 15); sync(); shadow = dstats().shadowCalls || 0; }
            for (let i = 0; i < 2; i++) { info.reset(); e.debug.step(1 / 60); sync(); }
          }
          const ms = [], lg = [];
          let last = null;
          for (let i = 0; i < frames; i++) {
            info.reset(); acc = { passes: 0, calls: 0, tris: 0, callsAll: 0, trisAll: 0 };
            const t0 = performance.now();
            e.debug.step(1 / 60); sync();
            ms.push(performance.now() - t0);
            const ds = dstats(), sh = ds.shadowCalls || 0;
            if (sh) { shadowFrames++; acc.calls -= sh; }
            postCalls = Math.max(postCalls, ds.postCalls || 0);
            if (!last || acc.callsAll > last.callsAll || (acc.callsAll === last.callsAll && acc.trisAll > last.trisAll)) last = acc;      // самый тяжёлый кадр
            acc = null;
          }
          for (let i = 0; i < Math.max(3, frames >> 1); i++) { info.reset(); const t0 = performance.now(); e.debug.step(1 / 60, false); sync(); lg.push(performance.now() - t0); }
          out[id] = { ms: r1(med(ms)), min: r1(Math.min(...ms)), max: r1(Math.max(...ms)), logic: r1(med(lg)), calls: last.calls, shadow, shadowFrames, post: postCalls, tris: last.tris, callsAll: last.callsAll, trisAll: last.trisAll, passes: last.passes };
        }
        return out;
      };
      let results;
      const before = e.quality && e.quality.tier, auto = !!e.qualityAuto;
      // качество «АВТО» (умолчание полной игры) на время замера замораживаем на действующем уровне: меряем уровень, а не подбор
      if (auto && before && !tiers.length) e.setQuality(before);
      if (tiers.length) {
        results = {};
        for (const q of tiers) {
          e.setQuality(q);
          for (let i = 0; i < 2; i++) { e.debug.step(1 / 60); sync(); }
          results[q] = measure();
        }
        if (before) e.setQuality(before);
      } else results = measure();
      R.render = render0; info.autoReset = autoReset;
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        results,
        meta: {
          kind: window.__dev ? 'stand' : 'game', quality: before || null, auto, pixelRatio: e.pixelRatio || null,
          canvas: [R.domElement.width, R.domElement.height], webgl2: !!R.capabilities.isWebGL2,
          gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
          phase: host.game && host.game.state ? host.game.state.phase : null,
        },
      };
    }, { tiers, frames: opt.live ? 0 : Math.max(1, opt.frames | 0), only: opt.live ? ['__none__'] : opt.stations ? opt.stations.split(',').map((s) => s.trim()).filter(Boolean) : [] });
    // --live S: настоящий цикл кадров (рисование по требованию) — на каждом уровне и посту S с покоя и S со стрельбой
    if (opt.live) {
      r.live = {};
      const liveIds = (opt.stations || 'fire,plot').split(',').map((s) => s.trim()).filter(Boolean);
      for (const q of (tiers.length ? tiers : [r.meta.quality || 'high'])) {
        r.live[q] = {};
        for (const id of liveIds) {
          for (const mode of ['idle', 'fire']) {
            await p.evaluate(({ q, id, mode }) => {
              const host = window.__dev || window.__arta, e = host.engine, game = host.game;
              e.stop(); e.setQuality(q); e.gotoStation(id, { instant: true });
              window.__perfFire && clearInterval(window.__perfFire); window.__perfFire = 0;
              if (mode === 'fire' && game) {
                const shoot = () => {
                  const s = game.state, b = s.breech;
                  if (!s.shells || !b) return;
                  b.shell = 'he'; b.rammed = true; b.charges = Math.max(1, b.charges || 2); b.open = false; b.busy = false;
                  s.turret.brake = true; s.fire.armed = true; if (s.shells.he < 5) s.shells.he = 20;
                  try { game.fire(); } catch (err) { /* не выстрелило */ }
                };
                shoot(); window.__perfFire = setInterval(shoot, 1500);
              }
              e.start();
            }, { q, id, mode });
            await p.waitForTimeout(opt.warm || 4000);     // выдержка: смена уровня, сборка шейдеров, текстуры
            const s0 = await p.evaluate(() => { const s = (window.__dev || window.__arta).engine.debug.stats(); return { t: performance.now(), r: s.rendered, f: s.frames || 0 }; });
            const t0 = Date.now();
            await p.evaluate(() => { window.__perfN = 0; const e = (window.__dev || window.__arta).engine; window.__perfOff = e.onFrame(() => { window.__perfN++; }); return 0; });
            await p.waitForTimeout(opt.live * 1000);
            const s1 = await p.evaluate(() => { const e = (window.__dev || window.__arta).engine, s = e.debug.stats(); try { window.__perfOff && window.__perfOff(); } catch (err) { /* нет отписки */ }
              clearInterval(window.__perfFire); window.__perfFire = 0; e.stop(); return { t: performance.now(), r: s.rendered, n: window.__perfN, frameMs: s.frameMs, tier: s.tier }; });
            const sec = (s1.t - s0.t) / 1000, rendered = s1.r - s0.r;
            r.live[q][id + ':' + mode] = { renderFps: +(rendered / sec).toFixed(1), stepFps: +(s1.n / sec).toFixed(1), msPerRendered: +(sec * 1000 / Math.max(1, rendered)).toFixed(1), cpuMs: +s1.frameMs.toFixed(1), tier: s1.tier, wall: Date.now() - t0 };
          }
        }
      }
    }
  } finally { await b.close(); }
  if (opt.live) {
    const out = { meta: { cmd: 'node tools/perf.cjs ' + a.join(' '), w: opt.w, h: opt.h, dpr: opt.dpr, throttle: opt.throttle || 1, canvas: r.meta.canvas, gpu: r.meta.gpu, date: new Date().toISOString() }, live: r.live };
    const lines = ['Живой цикл (' + opt.live + ' с на замер) · ' + opt.w + '×' + opt.h + ' dpr ' + opt.dpr + ' · замедление CPU ×' + (opt.throttle || 1),
      'уровень   пост:режим        нарисовано к/с  шагов к/с  мс на нарисованный кадр  логика мс'];
    for (const q of Object.keys(r.live)) for (const k of Object.keys(r.live[q])) { const v = r.live[q][k];
      lines.push(String(q).padEnd(9) + ' ' + k.padEnd(16) + String(v.renderFps).padStart(14) + String(v.stepFps).padStart(11) + String(v.msPerRendered).padStart(25) + String(v.cpuMs).padStart(11)); }
    console.log(lines.join('\n'));
    if (opt.json) fs.writeFileSync(path.resolve(opt.json), JSON.stringify(out, null, 1) + '\n');
    if (opt.txt) fs.writeFileSync(path.resolve(opt.txt), lines.join('\n') + '\n');
    return;
  }

  const meta = { cmd: 'node tools/perf.cjs ' + a.join(' '), dir, w: opt.w, h: opt.h, dpr: opt.dpr, frames: opt.frames, ...(r.meta.kind === 'game' ? { mission: opt.mission, sim: opt.sim, seed: opt.seed, scene } : {}), ...r.meta, date: new Date().toISOString() };
  const groups = tiers.length ? r.results : { [meta.quality || 'текущее']: r.results };
  const pad = (s, n) => String(s).padEnd(n), lpad = (s, n) => String(s).padStart(n);
  const lines = [];
  lines.push(`Замер кадра: ${meta.kind === 'game' ? 'полная игра, задание ' + meta.mission : 'стенд'} · ${meta.w}×${meta.h} dpr ${meta.dpr} · ${meta.frames} кадров на пост · ${meta.gpu}`);
  lines.push('ms — медиана кадра (мс, SwiftShader); calls — вызовы основного прохода (без теней); тень — проход карты теней при перерисовке; all — все вызовы кадра (+ тени, текстуры-виды, постобработка)');
  const tierNames = Object.keys(groups), ids = Object.keys(groups[tierNames[0]] || {});
  lines.push(pad('пост', 11) + tierNames.map((q) => lpad(q + ': ms', 11) + lpad('calls', 6) + lpad('тень', 5) + lpad('all', 5)).join(' |'));
  for (const id of ids) lines.push(pad(id, 11) + tierNames.map((q) => { const v = groups[q][id]; return lpad(v.ms.toFixed(1), 11) + lpad(v.calls, 6) + lpad(v.shadow || 0, 5) + lpad(v.callsAll, 5); }).join(' |'));
  const avg = (q, k) => ids.reduce((s, id) => s + groups[q][id][k], 0) / Math.max(1, ids.length);
  lines.push(pad('в среднем', 11) + tierNames.map((q) => lpad(avg(q, 'ms').toFixed(1), 11) + lpad(Math.round(avg(q, 'calls')), 6) + lpad(Math.round(avg(q, 'shadow') || 0), 5) + lpad(Math.round(avg(q, 'callsAll')), 5)).join(' |'));
  if (tiers.length) console.log(lines.join('\n')); else console.log(JSON.stringify(r.results));
  if (opt.json) fs.writeFileSync(path.resolve(opt.json), JSON.stringify({ meta, results: r.results }, null, 1) + '\n');
  if (opt.txt) fs.writeFileSync(path.resolve(opt.txt), lines.join('\n') + '\n');
})().catch(e => { console.error(e); process.exit(1); });
