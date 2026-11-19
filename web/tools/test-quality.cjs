// Тест качества «АВТО» и уровней графики на стенде поста ОГОНЬ (настоящий цикл кадров движка).
//   cd web && node tools/test-quality.cjs [--no-build]   (код выхода ≠ 0 при провале; ~40 с)
// Проверяет:
//   1. настоящий подбор: на программном WebGL кадр идёт сотни мс — «АВТО» само спускается high → mid → low, шлёт 'quality'
//      на каждой ступени, запоминает уровень в localStorage, повторный setQuality('auto') подбор не сбрасывает;
//   2. явный уровень выключает подбор; возврат в «АВТО» берёт подобранный уровень;
//   3. подъём (поданными интервалами engine.debug.autoFeed): 30 с с запасом — одна ступень вверх, и только один раз за запуск;
//   4. что включено на каждом уровне: тени, постобработка, частицы; на low — ни одного прохода сверх основного.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');

const WEB = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
let failed = 0;
const fail = (m) => { failed++; console.log('FAIL:', m); };
const ok = (m) => console.log('ok  ', m);

(async () => {
  if (!argv.includes('--no-build')) execFileSync('node', ['build.mjs', '--dev', 'st-fire'], { cwd: WEB, stdio: 'ignore' });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => fail('pageerror: ' + e.message));
    await page.addInitScript(() => { try { localStorage.removeItem('arta2.autoTier'); } catch (e) { /* нет хранилища */ } });
    await page.goto('file://' + path.join(WEB, '.dev/st-fire/index.html'));
    await page.waitForFunction(() => window.__dev && window.__dev.engine && window.__dev.engine.running, null, { timeout: 120000 });

    // 4. уровни: что включено (цикл стоит, кадры вручную)
    const tiers = await page.evaluate(() => {
      const { engine } = window.__dev; engine.stop();
      const out = {};
      for (const t of ['high', 'mid', 'low']) {
        engine.setQuality(t);
        engine.shadowsDirty();
        engine.fx.dust({ amount: 1 });
        engine.debug.step(1 / 60); engine.debug.step(1 / 60);
        engine.shadowsDirty(); engine.debug.step(0.1);
        const s = engine.debug.stats();
        engine.fx.clear(); engine.debug.step(1 / 60);       // основной проход без частиц (пыль — свой вызов отрисовки)
        out[t] = { q: { ...engine.quality }, post: engine.post.active, shadowCalls: s.shadowCalls, postPasses: s.postPasses, particles: s.particles,
          callsFx: s.calls, calls: engine.debug.stats().calls, cast: !!engine.lights.key.castShadow };
      }
      return out;
    });
    const H = tiers.high, M = tiers.mid, L = tiers.low;
    if (!(H.post && H.cast && H.shadowCalls > 0 && H.postPasses >= 5 && H.particles > 0 && H.q.shadow === 1024 && H.q.grain)) fail('high: ' + JSON.stringify(H));
    else ok('high: тени 1024 (' + H.shadowCalls + ' выз.), постобработка ' + H.postPasses + ' прох., частиц ' + H.particles);
    if (!(M.post && M.cast && M.shadowCalls > 0 && M.postPasses >= 3 && M.postPasses < H.postPasses && M.particles > 0 && M.particles < H.particles && M.q.shadow === 512 && !M.q.grain)) fail('mid: ' + JSON.stringify(M));
    else ok('mid: тени 512, постобработка ' + M.postPasses + ' прох., частиц ' + M.particles);
    if (!(!L.post && !L.cast && L.shadowCalls === 0 && L.postPasses === 0 && L.particles === 0)) fail('low: ' + JSON.stringify(L));
    else ok('low: без теней, без постобработки, без частиц');
    if (!(H.calls === L.calls && M.calls === L.calls && L.calls <= 120 && H.callsFx === H.calls + 1)) fail('вызовы основного прохода зависят от уровня или > 120 (или частицы стоят не один вызов): ' + JSON.stringify([H.calls, M.calls, L.calls, H.callsFx]));
    else ok('основной проход: ' + L.calls + ' вызовов на всех уровнях, все частицы — +1 вызов');

    // 1. настоящий подбор в цикле кадров
    await page.evaluate(() => {
      const { engine } = window.__dev;
      engine.setQuality('high');
      window.__q = [];
      engine.on('quality', (q) => window.__q.push(q.tier));
      engine.setQuality('auto');
      engine.start();
    });
    const t0 = Date.now();
    await page.waitForFunction(() => window.__dev.engine.quality.tier === 'low', null, { timeout: 150000, polling: 500 }).catch(() => {});
    const a1 = await page.evaluate(() => ({ tier: window.__dev.engine.quality.tier, events: window.__q.slice(), auto: window.__dev.engine.qualityAuto,
      stored: localStorage.getItem('arta2.autoTier'), stats: window.__dev.engine.debug.stats() }));
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (a1.tier !== 'low' || a1.events.join() !== 'mid,low' || !a1.auto || a1.stored !== 'low' || a1.stats.autoDowns !== 2) fail('подбор вниз: ' + JSON.stringify(a1));
    else ok('подбор вниз за ' + secs + ' с: события ' + a1.events.join(' → ') + ', окно ' + a1.stats.autoMs + ' мс, запомнено ' + a1.stored);
    const a2 = await page.evaluate(() => { const e = window.__dev.engine; e.setQuality('auto'); return { tier: e.quality.tier, auto: e.qualityAuto, n: window.__q.length }; });
    if (a2.tier !== 'low' || !a2.auto) fail('повторный setQuality(auto) сбросил подбор: ' + JSON.stringify(a2));
    else ok('повторный setQuality(auto) подбор не сбрасывает');

    // 2. явный уровень выключает подбор и держится
    const b1 = await page.evaluate(() => new Promise((res) => { const e = window.__dev.engine; e.setQuality('high');
      setTimeout(() => res({ tier: e.quality.tier, auto: e.qualityAuto }), 9000); }));
    if (b1.tier !== 'high' || b1.auto) fail('явный high не удержался: ' + JSON.stringify(b1));
    else ok('явный «высокое» держится 9 с при медленных кадрах, qualityAuto = false');
    const b2 = await page.evaluate(() => { const e = window.__dev.engine; e.stop(); e.setQuality('auto'); return { tier: e.quality.tier, auto: e.qualityAuto }; });
    if (b2.tier !== 'low' || !b2.auto) fail('возврат в АВТО не взял подобранный уровень: ' + JSON.stringify(b2));
    else ok('возврат в «АВТО» — подобранный уровень low');

    // 3. подъём: один раз за запуск
    const c1 = await page.evaluate(() => {
      const e = window.__dev.engine;
      e.debug.autoFeed(16, 200, 4);                       // выдержка после смены уровня
      const s1 = e.debug.autoFeed(16, 62 * 33, 4);        // ~33 с с запасом
      const t1 = e.quality.tier;
      e.debug.autoFeed(16, 62 * 40, 4);                   // ещё 40 с — второй подъём не положен
      const t2 = e.quality.tier;
      const busy = e.debug.autoFeed(16, 62 * 31, 20);     // CPU занят (логика 20 мс) — тоже не подъём
      return { t1, ups: s1.autoUps, t2, t3: busy.tier, stored: localStorage.getItem('arta2.autoTier') };
    });
    if (c1.t1 !== 'mid' || c1.ups !== 1 || c1.t2 !== 'mid' || c1.t3 !== 'mid' || c1.stored !== 'mid') fail('подъём: ' + JSON.stringify(c1));
    else ok('подъём low → mid после 30 с с запасом, второй раз — нет');
    const c2 = await page.evaluate(() => { const e = window.__dev.engine; e.debug.autoFeed(16, 120, 4); const s = e.debug.autoFeed(40, 62 * 5, 4); return { tier: e.quality.tier, downs: s.autoDowns }; });
    if (c2.tier !== 'low') fail('спуск после подъёма: ' + JSON.stringify(c2));
    else ok('медленные кадры после подъёма — снова low');
  } finally {
    await browser.close();
  }
  console.log(failed ? 'test-quality: ПРОВАЛ (' + failed + ')' : 'test-quality: всё в порядке');
  process.exit(failed ? 1 : 0);
})();
