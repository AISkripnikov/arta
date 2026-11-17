// Снимки стенда «Галерея» по постам за один запуск браузера (цикл движка остановлен, кадры — вручную).
//   node tools/gshot.cjs <outPrefix> [--ids plot,fire] [--w 844 --h 390 --dpr 2] [--eval "js"] [--q "?debug"]
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const a = process.argv.slice(2);
  const prefix = path.resolve(a[0]);
  const opt = { w: 844, h: 390, dpr: 2, ids: 'plot,computer,loading,traverse,elevation,fire', eval: '', q: '', dev: 'gallery' };
  for (let i = 1; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); opt[k] = (k === 'ids' || k === 'eval' || k === 'q' || k === 'dev') ? a[++i] : Number(a[++i]); }
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: opt.w, height: opt.h }, deviceScaleFactor: opt.dpr, hasTouch: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('PAGEERROR:', e.message));
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE.' + m.type() + ':', m.text()); });
  await p.goto('file://' + path.resolve('.dev', opt.dev, 'index.html') + opt.q);
  await p.waitForFunction('window.__dev', null, { timeout: 120000 });
  await p.evaluate('window.__dev.engine.stop()');
  for (const id of opt.ids.split(',')) {
    const r = await p.evaluate('(async()=>{ const e = window.__dev.engine; e.gotoStation("' + id + '", { instant: true });' + opt.eval +
      '; for (let i = 0; i < (' + (opt.nostep ? 0 : 12) + '); i++) e.debug.step(0.1, false); e.debug.step(0.0001); return e.debug.stats(); })()');
    await p.waitForTimeout(200);
    const file = prefix + '_' + id + '.png';
    await p.screenshot({ path: file, timeout: 180000 });
    console.log(file, JSON.stringify(r));
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
