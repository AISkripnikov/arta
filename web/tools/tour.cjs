// Обзор полной сборки игры: меню и все восемь постов в бою. node tools/tour.cjs <outDir> [w h] [--www <каталог сборки>]
// Какая сборка: --www <dir> или переменная ARTA_WWW=<dir> (личная сборка: node build.mjs --out <dir>); без них — боевая,
// app/src/main/assets/www. Снимки: <outDir>/0-menu.png, 0-brief.png, st-<пост>.png (каталог создаётся).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
{ const i = process.argv.indexOf('--www'); if (i >= 0) { process.env.ARTA_WWW = process.argv[i + 1] || ''; process.argv.splice(i, 2); } }
const WWW = path.join(path.resolve(process.env.ARTA_WWW || path.join(__dirname, '../../app/src/main/assets/www')), 'index.html');
if (!fs.existsSync(WWW)) { console.error('нет сборки: ' + WWW + ' (node build.mjs или node build.mjs --out <dir>)'); process.exit(1); }
if (!process.argv[2]) { console.error('usage: node tools/tour.cjs <outDir> [w h] [--www <dir>]'); process.exit(1); }
fs.mkdirSync(process.argv[2], { recursive: true });
(async () => {
  const out = process.argv[2], w = +process.argv[3] || 844, h = +process.argv[4] || 390;
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const cx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true });
  // обзор снимает меню и посты: вступительный ролик и окно «ЧТО НОВОГО» считаем уже просмотренными
  await cx.addInitScript(() => { try { localStorage.setItem('arta2.intro', '1'); localStorage.setItem('arta2.news', '999'); } catch (e) { /* хранилище недоступно */ } });
  const p = await cx.newPage();
  p.setDefaultTimeout(180000);
  let errs = 0;
  p.on('pageerror', e => { errs++; console.log('PAGEERROR', e.message); });
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') { errs++; console.log('CONSOLE', m.text()); } });
  await p.goto('file://' + WWW);
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
