// Обзор боевой сборки: меню и все шесть постов в бою. node tools/tour.cjs <outDir> [w h]
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const out = process.argv[2], w = +process.argv[3] || 844, h = +process.argv[4] || 390;
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true })).newPage();
  p.setDefaultTimeout(180000);
  let errs = 0;
  p.on('pageerror', e => { errs++; console.log('PAGEERROR', e.message); });
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') { errs++; console.log('CONSOLE', m.text()); } });
  await p.goto('file://' + path.resolve(__dirname, '../../app/src/main/assets/www/index.html'));
  await p.waitForFunction(() => window.__arta, null, { timeout: 120000 });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: out + '/0-menu.png' });
  await p.evaluate(() => { __arta.game.save.unlocked = 9; __arta.game.startMission(3); });
  await p.waitForTimeout(600); await p.screenshot({ path: out + '/0-brief.png' });
  await p.evaluate(() => __arta.game.begin());
  await p.waitForTimeout(9000);
  for (const id of ['plot', 'computer', 'loading', 'traverse', 'elevation', 'fire', 'observe', 'aa']) {
    await p.evaluate((id) => __arta.engine.gotoStation(id, { instant: true }), id);
    await p.waitForTimeout(1200);
    await p.screenshot({ path: out + '/st-' + id + '.png' });
  }
  console.log('errors', errs);
  await b.close();
})();
