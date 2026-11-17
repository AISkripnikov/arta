// Замер времени кадра в headless Chromium (SwiftShader): node tools/perf.cjs .dev/gallery [--dpr 2] [--eval "js перед замером"]
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const a = process.argv.slice(2);
  const target = path.join(path.resolve(a[0]), 'index.html');
  const opt = { w: 844, h: 390, dpr: 2 }; const evals = [];
  for (let i = 1; i < a.length; i++) { if (a[i] === '--eval') evals.push(a[++i]); else if (a[i].startsWith('--')) opt[a[i].slice(2)] = Number(a[++i]); }
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: opt.w, height: opt.h }, deviceScaleFactor: opt.dpr, hasTouch: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('PAGEERROR:', e.message));
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE.' + m.type() + ':', m.text()); });
  await p.goto('file://' + target);
  await p.waitForFunction('window.__dev', null, { timeout: 60000 });
  for (const js of evals) await p.evaluate('(async()=>{' + js + '})()');
  const r = await p.evaluate(async () => {
    const e = window.__dev.engine; e.stop();
    const gl = e.renderer.getContext(), px = new Uint8Array(4);
    const out = {};
    for (const id of e.stations.map(s => s.id)) {
      e.gotoStation(id, { instant: true });
      e.debug.step(0.016); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = performance.now(), N = 3;
      for (let i = 0; i < N; i++) { e.debug.step(0.016); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
      const s = e.debug.stats();
      out[id] = { ms: +((performance.now() - t0) / N).toFixed(1), calls: s.calls, tris: s.triangles };
    }
    return out;
  });
  console.log(JSON.stringify(r));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
