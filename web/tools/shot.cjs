// Снимок страницы в headless Chromium с WebGL (SwiftShader).
//   node tools/shot.cjs <dir|index.html> <out.png> [--w 844] [--h 390] [--dpr 2] [--wait 1500] [--eval "js"]... 
// Каждый --eval выполняется на странице по порядку (можно await), после каждого — пауза 300 мс.
// <dir> — стенд (.dev/st-fire: window.__dev) или полная сборка игры (боевая либо личная, node build.mjs --out <dir>:
// window.__arta). «-» вместо каталога — сборка из переменной ARTA_WWW (без неё — боевая, app/src/main/assets/www).
// В полной сборке (в каталоге есть style.css) вступительный ролик и окно «ЧТО НОВОГО» считаются просмотренными — сразу меню;
// --fresh 1 оставляет хранилище чистым (первый запуск: ролик).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const a = process.argv.slice(2);
  let target = path.resolve(a[0] === '-' ? (process.env.ARTA_WWW || path.join(__dirname, '../../app/src/main/assets/www')) : a[0]);
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
  const fullGame = fs.existsSync(path.join(path.dirname(target), 'style.css'));
  const out = path.resolve(a[1]);
  const opt = { w: 844, h: 390, dpr: 2, wait: 1500 }, evals = [];
  for (let i = 2; i < a.length; i++) {
    if (a[i] === '--eval') evals.push(a[++i]);
    else if (a[i].startsWith('--')) opt[a[i].slice(2)] = Number(a[++i]);
  }
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: opt.w, height: opt.h }, deviceScaleFactor: opt.dpr, hasTouch: true });
  if (fullGame && !opt.fresh) await ctx.addInitScript(() => { try { localStorage.setItem('arta2.intro', '1'); localStorage.setItem('arta2.news', '999'); } catch (e) { /* хранилище недоступно */ } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(180000);
  p.on('pageerror', e => console.log('PAGEERROR:', e.message));
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE.' + m.type() + ':', m.text()); });
  await p.goto('file://' + target);
  await p.waitForTimeout(opt.wait);
  for (const js of evals) { const r = await p.evaluate('(async()=>{' + js + '})()'); if (r !== undefined) console.log('EVAL →', JSON.stringify(r)); await p.waitForTimeout(300); }
  await p.screenshot({ path: out });
  console.log('saved', out);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
