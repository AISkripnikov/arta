// Тест вступительного ролика (ui/intro.js) на стенде: настоящие касания, ускоренное время.
//   node build.mjs --dev intro && node tools/test-intro.cjs
const { chromium } = require('playwright');
const path = require('path');

let failed = 0, passed = 0;
const ok = (cond, name, extra) => {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};
const URL = 'file://' + path.resolve(__dirname, '../.dev/intro/index.html');

async function open(browser, W, H, hash) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.type() + ': ' + m.text()); });
  // учёт подписок, кадров и звуковых узлов — до загрузки страницы
  await page.addInitScript(() => {
    const L = window.__leak = { listeners: 0, raf: 0, started: new Set(), stopped: new Set() };
    for (const tgt of [window, document]) {
      const add = tgt.addEventListener.bind(tgt), rem = tgt.removeEventListener.bind(tgt);
      tgt.addEventListener = (...a) => { L.listeners++; return add(...a); };
      tgt.removeEventListener = (...a) => { L.listeners--; return rem(...a); };
    }
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (fn) => raf((t) => { L.raf++; fn(t); });
    const P = window.AudioScheduledSourceNode && window.AudioScheduledSourceNode.prototype;
    if (P) {
      const st = P.start, sp = P.stop;
      P.start = function (...a) { L.started.add(this); return st.apply(this, a); };
      P.stop = function (...a) { L.stopped.add(this); return sp.apply(this, a); };
    }
  });
  await page.goto(URL + '#auto=0' + (hash || ''));
  await page.waitForFunction(() => window.__intro && window.__intro.fonts);
  return { ctx, page, problems };
}
const gone = (page) => page.evaluate(() => !document.getElementById('arta-intro') && !document.getElementById('arta-intro-css') && !document.querySelector('.ai'));

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

  // ---------- 1. отметка «просмотрен» ----------
  console.log('отметка о просмотре');
  let { ctx, page, problems } = await open(browser, 844, 390);
  const flags = await page.evaluate(() => {
    const i = window.__intro.intro, r = {};
    r.fresh = i.seen(); i.markSeen(); r.marked = i.seen(); r.key = localStorage.getItem('arta2.intro');
    i.reset(); r.reset = i.seen(); r.keyAfter = localStorage.getItem('arta2.intro');
    return r;
  });
  ok(flags.fresh === false, 'на чистом хранилище ролик не просмотрен', flags);
  ok(flags.marked === true && flags.key === '1', 'markSeen() пишет arta2.intro = 1', flags);
  ok(flags.reset === false && !flags.keyAfter, 'reset() снимает отметку', flags);

  // ---------- 2. ролик до конца на ускоренном времени ----------
  console.log('ролик до конца');
  await page.mouse.click(300, 200);                       // первое касание — будит звук, как в игре
  const base = await page.evaluate(() => ({ listeners: window.__leak.listeners }));
  await page.evaluate(() => { window.__intro.play({ rate: 12 }); });
  const lay = await page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
    const root = document.getElementById('arta-intro');
    return { root: r('#arta-intro'), cv: r('.ai-cv'), skip: r('.ai-skip'), z: +getComputedStyle(root).zIndex, top: document.elementFromPoint(400, 150) === document.querySelector('.ai-cv'),
      cvw: document.querySelector('.ai-cv').width, playing: window.__intro.intro.isPlaying() };
  });
  ok(lay.root && lay.root.w === 844 && lay.root.h === 390 && lay.top, 'слой закрывает весь экран и лежит сверху', lay);
  ok(lay.z > 1000, 'z-index выше экранов игры', lay.z);
  ok(lay.skip && lay.skip.h >= 44 && lay.skip.w >= 100 && lay.skip.r <= 844 && lay.skip.x > 600, '«ПРОПУСТИТЬ» — под палец, справа вверху', lay.skip);
  ok(lay.cvw <= 1280 && lay.cvw >= 800, 'холст не шире 1280 точек', lay.cvw);
  ok(lay.playing, 'isPlaying() во время показа');
  const seenScenes = new Set(); let sawTitle = false, sawText = false, sawWho = false, maxProg = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    const s = await page.evaluate(() => {
      const h = window.__intro.handle, st = h && h.state();
      if (!st) return null;
      const m = /scaleX\(([\d.]+)\)/.exec(document.querySelector('.ai-prog').style.transform || '');
      return { ...st, text: document.querySelector('.ai-txt .on').textContent, who: document.querySelector('.ai-who').textContent, prog: m ? +m[1] : 0,
        titleOn: document.querySelector('.ai-title').classList.contains('on') };
    });
    if (!s) break;
    seenScenes.add(s.scene); if (s.titleOn) sawTitle = true; if (s.text.length > 5) sawText = true; if (s.who) sawWho = true; maxProg = Math.max(maxProg, s.prog);
    await page.waitForTimeout(60);
  }
  await page.waitForFunction(() => window.__intro.done.length > 0, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(400);
  const end = await page.evaluate(() => ({ done: window.__intro.done.slice(), seen: window.__intro.intro.seen(), key: localStorage.getItem('arta2.intro'), playing: window.__intro.intro.isPlaying(), listeners: window.__leak.listeners }));
  ok(seenScenes.size === 6, 'показаны все шесть сцен', [...seenScenes]);
  ok(sawText && sawWho, 'субтитры печатаются, у реплик есть имя говорящего');
  ok(sawTitle, 'в конце — заставка «АРТА · БАШНЯ»');
  ok(maxProg > 0.97, 'полоса хода дошла до конца', maxProg);
  ok(end.done.length === 1 && end.done[0].skipped === false && end.done[0].reason === 'end', 'onDone вызван ровно один раз', end.done);
  ok(await gone(page), 'слой и стили убраны');
  ok(end.seen && end.key === '1' && !end.playing, 'ролик отмечен просмотренным');
  ok(end.listeners === base.listeners, 'обработчики окна и документа сняты', { before: base.listeners, after: end.listeners });
  const raf1 = await page.evaluate(() => window.__leak.raf); await page.waitForTimeout(300);
  const raf2 = await page.evaluate(() => window.__leak.raf);
  ok(raf1 === raf2, 'кадровый цикл остановлен', { raf1, raf2 });
  const au = await page.evaluate(() => { const L = window.__leak; let loose = 0; L.started.forEach((n) => { if (!L.stopped.has(n)) loose++; }); return { started: L.started.size, loose, ready: window.__intro.audio.ready }; });
  ok(au.loose === 0, 'все звуковые источники остановлены', au);
  if (au.ready) ok(au.started > 10, 'звук ролика играл (ветер, разрывы, эфир)', au); else console.log('  --   звук в этом браузере недоступен, проверка звука пропущена');

  // ---------- 3. пропуск ----------
  console.log('пропуск и касания');
  await page.evaluate(() => { window.__intro.done.length = 0; window.__intro.intro.reset(); window.__intro.play(); });
  await page.waitForTimeout(300);
  const motion = await page.evaluate(async () => {
    const cv = document.querySelector('.ai-cv'), tmp = document.createElement('canvas');
    tmp.width = cv.width; tmp.height = cv.height;
    const g = tmp.getContext('2d', { willReadFrequently: true });       // читаем копию, холст ролика не трогаем
    const grab = () => { g.drawImage(cv, 0, 0); return g.getImageData(0, 0, tmp.width, tmp.height).data; };
    const a = grab(); await new Promise((r) => setTimeout(r, 500)); const b = grab();
    let diff = 0, lit = 0; for (let i = 0; i < a.length; i += 16) { if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 12) diff++; if (b[i] + b[i + 1] + b[i + 2] > 60) lit++; }
    return { diff, lit, n: a.length / 16 };
  });
  ok(motion.lit > motion.n * 0.15, 'на холсте есть картинка', motion);
  ok(motion.diff > motion.n * 0.01, 'картинка движется', motion);
  const s0 = await page.evaluate(() => window.__intro.handle.state().scene);
  await page.touchscreen.tap(300, 180);
  const s1 = await page.evaluate(() => window.__intro.handle.state().scene);
  ok(s0 === 0 && s1 === 1, 'касание экрана — следующая сцена', { s0, s1 });
  await page.evaluate(() => { window.__second = 0; window.__intro.intro.play({ onDone: () => window.__second++ }); });
  ok(await page.evaluate(() => document.querySelectorAll('.ai').length) === 1, 'повторный play() не создаёт второй слой');
  // двойное касание «ПРОПУСТИТЬ»: пока ролик гаснет, второе касание не должно проходить к экрану под ним
  const skipAt = await page.evaluate(() => {
    const u = document.createElement('button'); u.id = 'under'; u.style.cssText = 'position:fixed;inset:0;z-index:1;opacity:0'; window.__under = 0;
    for (const n of ['pointerdown', 'click']) u.addEventListener(n, () => window.__under++);
    document.body.appendChild(u);
    const r = document.querySelector('.ai-skip').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.touchscreen.tap(skipAt.x, skipAt.y);
  await page.waitForTimeout(120);
  const fading = await page.evaluate(([x, y]) => { const st = window.__intro.handle.state(), el = document.elementFromPoint(x, y), root = document.getElementById('arta-intro');
    return { closing: !!(st && st.closing), covered: !!(root && el && root.contains(el)) }; }, [skipAt.x, skipAt.y]);
  await page.touchscreen.tap(skipAt.x, skipAt.y);
  await page.waitForFunction(() => window.__intro.done.length > 0);
  await page.waitForTimeout(300);
  const under = await page.evaluate(() => { const n = window.__under; document.getElementById('under').remove(); return n; });
  ok(fading.closing && fading.covered && under === 0, 'гаснущий ролик не пропускает касания к экрану под ним', { fading, under });
  const sk = await page.evaluate(() => ({ done: window.__intro.done.slice(), second: window.__second, seen: window.__intro.intro.seen() }));
  ok(sk.done.length === 1 && sk.done[0].skipped === true, '«ПРОПУСТИТЬ»: onDone один раз, skipped = true', sk.done);
  ok(sk.second === 1, 'onDone повторного play() тоже вызван один раз', sk.second);
  ok(await gone(page), 'после пропуска слой убран');
  ok(sk.seen, 'пропущенный ролик считается просмотренным');
  await page.evaluate(() => window.__intro.handle.skip());   // пропуск после конца ничего не ломает
  ok((await page.evaluate(() => window.__intro.done.length)) === 1, 'skip() после конца не вызывает onDone снова');

  // ---------- 4. кнопка «К БОЮ», клавиши, mark:false ----------
  await page.evaluate(() => { window.__intro.done.length = 0; window.__intro.intro.reset(); window.__intro.play({ mark: false }); window.__intro.handle.seek(5, 5.9); });
  await page.waitForSelector('.ai-title.on');
  await page.waitForTimeout(950);
  await page.tap('.ai-go');
  await page.waitForFunction(() => window.__intro.done.length > 0);
  const go = await page.evaluate(() => ({ done: window.__intro.done.slice(), seen: window.__intro.intro.seen() }));
  ok(go.done.length === 1 && go.done[0].skipped === false, '«К БОЮ» завершает ролик', go.done);
  ok(go.seen === false, 'mark: false не ставит отметку');
  await page.evaluate(() => { window.__intro.done.length = 0; window.__intro.play(); });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__intro.done.length > 0);
  ok((await page.evaluate(() => window.__intro.done[0].skipped)) === true, 'Escape пропускает ролик');
  await page.waitForTimeout(200);
  ok(await gone(page), 'слой убран');
  ok(problems.length === 0, 'нет ошибок и предупреждений в консоли', problems);
  await ctx.close();

  // ---------- 5. 740×360, крупные надписи, левша ----------
  console.log('740×360, крупные надписи, левша');
  ({ ctx, page, problems } = await open(browser, 740, 360, '&ts=1.3&lefty=1'));
  await page.evaluate(() => { window.__intro.play(); window.__intro.handle.pause(true); });
  const fit = async () => page.evaluate(() => {
    const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
    const txt = document.querySelector('.ai-txt');
    return { skip: r('.ai-skip'), band: r('.ai-band'), txt: r('.ai-txt'), who: r('.ai-who'), go: r('.ai-go'), t1: r('.ai-t1'), ch: r('.ai-ch'), over: document.documentElement.scrollWidth > innerWidth || txt.scrollWidth > txt.clientWidth + 1,
      lines: Math.round(txt.getBoundingClientRect().height / parseFloat(getComputedStyle(txt).lineHeight)), fs: parseFloat(getComputedStyle(txt).fontSize) };
  });
  let worst = null;
  for (const [sc, at] of [[0, 7.5], [1, 7.5], [2, 7.5], [3, 9], [4, 7.9], [5, 5.5]]) {
    await page.evaluate(([sc, at]) => window.__intro.handle.seek(sc, at), [sc, at]);
    await page.waitForTimeout(120);
    const f = await fit();
    if (!worst || f.band.h > worst.band.h) worst = f;
    if (f.over || f.lines > 2 || f.txt.x < 0 || f.txt.r > 740 || f.band.b > 360.5 || f.who.y < f.band.y) ok(false, 'субтитры сцены ' + (sc + 1) + ' помещаются', f);
  }
  ok(worst && worst.band.h <= 360 * 0.36 && worst.lines <= 2, 'субтитры всех сцен — не больше двух строк, лента ниже трети экрана', worst && { band: worst.band.h, lines: worst.lines, fs: worst.fs });
  ok(Math.abs(worst.fs - 15 * 1.3) < 0.6, 'размер надписей следует --ts', worst.fs);
  ok(worst.skip.x < 40 && worst.skip.r < 370 && worst.skip.h >= 44, 'левша: «ПРОПУСТИТЬ» слева', worst.skip);
  ok(worst.ch.x > 370 && worst.ch.r <= 740, 'левша: название сцены справа', worst.ch);
  await page.evaluate(() => window.__intro.handle.seek(5, 7));
  await page.waitForTimeout(1100);
  const tl = await fit();
  ok(tl.t1.x >= 0 && tl.t1.r <= 740 && tl.go.h >= 44 && tl.go.b < tl.who.y && tl.go.y >= tl.t1.b && tl.t1.y >= 0, 'заставка и «К БОЮ» помещаются и не лезут на субтитры', { t1: tl.t1, go: tl.go, who: tl.who.y });
  ok(!(tl.skip.r > tl.t1.x && tl.skip.b > tl.t1.y), '«ПРОПУСТИТЬ» не закрывает заставку', { skip: tl.skip, t1: tl.t1 });
  await page.evaluate(() => window.__intro.handle.skip());
  await page.waitForFunction(() => window.__intro.done.length > 0);
  ok(problems.length === 0, 'нет ошибок и предупреждений в консоли', problems);
  await ctx.close();

  // ---------- 6. книжная ориентация ----------
  console.log('книжная ориентация');
  ({ ctx, page, problems } = await open(browser, 390, 844));
  await page.evaluate(() => { window.__intro.play(); window.__intro.handle.pause(true); window.__intro.handle.seek(5, 7); });
  await page.waitForTimeout(1100);
  const pt = await page.evaluate(() => {
    const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left, r: b.right, y: b.top, b: b.bottom }; };
    return { t1: r('.ai-t1'), go: r('.ai-go'), skip: r('.ai-skip'), txt: r('.ai-txt'), sw: document.documentElement.scrollWidth };
  });
  ok(pt.t1.x >= 0 && pt.t1.r <= 390 && pt.go.r <= 390 && pt.skip.r <= 390 && pt.txt.r <= 390 && pt.sw <= 390, 'в книжной ориентации ничего не вылезает', pt);
  await page.tap('.ai-go');
  await page.waitForFunction(() => window.__intro.done.length > 0);
  ok(problems.length === 0, 'нет ошибок и предупреждений в консоли', problems);
  await ctx.close();

  await browser.close();
  console.log(`\nintro: ${passed} ok, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
