// Сквозная проверка боевой сборки. Три сценария подряд на одной странице:
//  1) первое задание проходится действиями игры — оболочка показывает итог (опыт, звание);
//  2) из итога открывается «РАЗБОР БОЯ» — карта не пустая, строк столько же, сколько выстрелов, строка подсвечивается;
//  0) меню: кнопки, «СНАБЖЕНИЕ» (покупка и сброс), «НАСТРОЙКИ» (размер надписей, левша), сохранённый бой (перезагрузка → «ПРОДОЛЖИТЬ БОЙ»);
//  3) «ОБОРОНА» — первая волна уничтожается действиями игры, должна прийти вторая;
//  4) «ЗАДАНИЕ ДНЯ» — брифинг и начало боя;
//  5) конвой с налётом — значки расчёта и аптечка, свои в блокноте, тревога «ВОЗДУХ!» → пост ЗЕНИТКА, итоги и разбор со своими.
//  0б) «НАСТРОЙКИ»: пять вкладок, каждый орган меняет game.settings(), качество/кадры/инверсия/громкости доходят до движка,
//      «по умолчанию», вёрстка 740×360 с самым крупным шрифтом (правша и левша);
//  0в) кнопка «СОХРАНИТЬ» в бою: «сохранить и продолжить», «сохранить и выйти» → «ПРОДОЛЖИТЬ БОЙ» возвращает в ту же минуту;
//      верхняя панель с новой кнопкой не переполняется; настройки из паузы; подсказки выкл;
//  6) «СБРОСИТЬ ПРОГРЕСС»: два шага, удержание красной кнопки, меню с нуля, ролик (подставной) запускается заново.
//  7) находки проверки (чистое хранилище, 740×360, настоящий ролик): прерванный первый запуск, двойные касания «ПРОПУСТИТЬ» и
//      «СОХРАНИТЬ И ВЫЙТИ», закрытое окно во время удержания сброса, высота «ГОТОВО», пост и скорость после «ПРОДОЛЖИТЬ БОЙ».
//  8) подсказки и засечка (чистое хранилище, открытая кампания): задание 1 — по шагам; задание 4 — пусто, пока не встретилось
//      новое, затем «НОВОЕ ·» с объяснением в строке радио и кольцом, гаснет после действия; касание строки показывает объяснение снова; «ПО ШАГАМ» и «ВЫКЛ»; блок «НОВОЕ В ЭТОМ
//      ЗАДАНИИ»; органы управления тем существуют на постах; плашка «НАС НЕ ВИДЯТ» → выстрел → «ЗАСЕЧЕНЫ».
//   node tools/e2e.cjs [итог.png] [--www <каталог сборки>] [--tier low|mid|high]   (рядом кладутся <итог>-debrief.png и <итог>-survival.png)
// Какая сборка проверяется: --www <dir> или переменная ARTA_WWW=<dir> (личная сборка: node build.mjs --out <dir>);
// без них — боевая, app/src/main/assets/www.
const { chromium } = require('playwright');
const path = require('path');
// Уровень качества: в игре по умолчанию «АВТО», и на программном WebGL (SwiftShader, ~4 к/с) он за 15–40 с сам уходит на
// «экономное» — проверки, ждущие игрового времени, на старте с «высокого» не успевают. Поэтому каждая страница стартует так,
// будто «АВТО» уже подобрал уровень на этом устройстве (localStorage['arta2.autoTier'], пока пусто): --tier low|mid|high
// (по умолчанию low). Настройка остаётся «АВТО» — проверки «АВТО» сравнивают действующий уровень с подобранным.
// Ожидания опрашивают условие по таймеру (polling: 100): игра перерисовывает кадр только при изменениях,
// и в безголовом браузере кадры анимации при этом приходят редко — опрос «по кадрам» почти останавливался.
const TIER = (() => { const i = process.argv.indexOf('--tier'); const t = i >= 0 ? process.argv.splice(i, 2)[1] : 'low'; if (!['low', 'mid', 'high'].includes(t)) { console.error('--tier low|mid|high'); process.exit(1); } return t; })();
const seedTier = (pg) => pg.addInitScript((t) => { try { if (!localStorage.getItem('arta2.autoTier')) localStorage.setItem('arta2.autoTier', t); } catch (e) { /* нет хранилища */ } }, TIER);
{ const i = process.argv.indexOf('--www'); if (i >= 0) { process.env.ARTA_WWW = process.argv[i + 1] || ''; process.argv.splice(i, 2); } }
const WWW = path.join(path.resolve(process.env.ARTA_WWW || path.join(__dirname, '../../app/src/main/assets/www')), 'index.html');
if (!require('fs').existsSync(WWW)) { console.error('нет сборки: ' + WWW + ' (node build.mjs или node build.mjs --out <dir>)'); process.exit(1); }
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true })).newPage();
  p.setDefaultTimeout(300000);
  // Игра гасит второе касание двойного нажатия: ~0,3 с после смены экрана нажатие в том же месте не срабатывает. Человек так
  // быстро по новому экрану не попадает, а проверка — попадает, поэтому перед каждым click ждём, пока защита отпустит.
  // Сами двойные касания проверяются в разделе 7 настоящими touchscreen.tap, без этого ожидания.
  const humanPace = (pg) => { const click = pg.click.bind(pg); pg.click = async (...a) => { await pg.waitForFunction(() => !(window.__arta && __arta.shell && __arta.shell.tapGuard > 0)); return click(...a); }; };
  humanPace(p);
  const shot = process.argv[2] || '/tmp/e2e.png', shotOf = (tag) => shot.replace(/(\.png)?$/, '-' + tag + '.png');
  let errs = 0;
  const fail = (msg) => { errs++; console.log('FAIL', msg); };
  p.on('pageerror', e => { errs++; console.log('PAGEERROR', e.message); });
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') { errs++; console.log('CONSOLE', m.text()); } });
  // приложение ждёт ArtaNative.ready() — подтверждение, что версия игры запустилась; ролик не должен его задерживать
  await seedTier(p); await p.addInitScript(() => { window.__ready = 0; window.ArtaNative = { ready() { window.__ready++; }, applyUpdate() {} }; });
  await p.goto('file://' + WWW);
  await p.waitForFunction(() => window.__arta);
  // самый первый запуск: до меню идёт вступительный ролик; запуск подтверждается, пока он ещё на экране
  const boot = await p.evaluate(() => ({ intro: !!__arta.shell.intro, playing: __arta.shell.introPlaying, el: !!document.getElementById('arta-intro'), skip: !!document.querySelector('#arta-intro [data-ai=skip]') }));
  await p.waitForFunction(() => window.__ready === 1, null, { polling: 100, timeout: 30000 }).catch(() => {});
  const boot2 = await p.evaluate(() => ({ ready: window.__ready, playing: __arta.shell.introPlaying }));
  console.log('boot', JSON.stringify({ boot, boot2 }));
  if (!boot.intro || !boot.playing || !boot.el || !boot.skip) fail('при первом запуске нет вступительного ролика с кнопкой «ПРОПУСТИТЬ»: ' + JSON.stringify(boot));
  if (boot2.ready !== 1 || !boot2.playing) fail('ArtaNative.ready() не вызван во время ролика (или ролик кончился раньше): ' + JSON.stringify(boot2));
  // первый запуск: если подключён вступительный ролик — пропускаем его кнопкой «ПРОПУСТИТЬ»
  const skipIntro = async () => {
    for (let i = 0; i < 20 && await p.evaluate(() => !!(__arta.shell && __arta.shell.introPlaying)); i++) {
      const sk = p.locator('text=ПРОПУСТИТЬ').first();
      if (await sk.count()) await sk.click({ timeout: 3000 }).catch(() => {});
      await p.waitForTimeout(250);
    }
    if (await p.evaluate(() => !!(__arta.shell && __arta.shell.introPlaying))) fail('вступительный ролик не пропускается кнопкой «ПРОПУСТИТЬ»');
  };
  await skipIntro();
  const boot3 = await p.evaluate(() => ({ menu: document.getElementById('menu').classList.contains('show'), el: !!document.getElementById('arta-intro'), seen: __arta.shell.intro.seen(), news: document.getElementById('dialog').classList.contains('show') }));
  if (!boot3.menu || boot3.el || !boot3.seen || boot3.news) fail('после ролика не открылось чистое меню (новичку «ЧТО НОВОГО» не показываем): ' + JSON.stringify(boot3));
  // первое открытие после обновления — окно «ЧТО НОВОГО»
  if (await p.isVisible('#dialog.show')) await p.click('#dlgBtns .btn');
  const menu = await p.evaluate(() => ({ rank: document.getElementById('rankName').innerText + ' ' + document.getElementById('rankXp').innerText, survival: !!document.querySelector('[data-act=survival]') }));
  console.log('menu', JSON.stringify(menu));
  if (!/ЗВАНИЕ: \S+/.test(menu.rank) || !menu.survival) fail('в меню нет звания или кнопки «ОБОРОНА»');

  // ---------- 0. меню: новые кнопки, снабжение, настройки, сохранённый бой ----------
  const btnsNew = await p.evaluate(() => ['daily', 'upgrades', 'settings'].filter((a) => { const el = document.querySelector('#menu [data-act=' + a + ']'); return !el || !el.offsetWidth; }));
  if (btnsNew.length) fail('в меню нет кнопок: ' + btnsNew.join(', '));
  const dailyTxt = await p.innerText('#dailyBtn');
  if (!/ЗАДАНИЕ ДНЯ/.test(dailyTxt) || !/\d\d\.\d\d/.test(dailyTxt)) fail('кнопка задания дня без даты: ' + dailyTxt);
  if (await p.isVisible('#resumeBox')) fail('«ПРОДОЛЖИТЬ БОЙ» показано без сохранённого боя');
  // снабжение: опыт подбрасываем, покупаем, сбрасываем
  const xp0 = await p.evaluate(() => { const g = __arta.game, x = g.save.xp; g.save.xp = 2000; return x; });
  await p.click('[data-act=upgrades]');
  const up0 = await p.evaluate(() => ({ cards: document.querySelectorAll('#upGrid .up-card').length, pts: +document.getElementById('upPoints').innerText, real: __arta.game.points(),
    fits: [...document.querySelectorAll('#upGrid .up-card')].every((c) => { const r = c.getBoundingClientRect(); return r.bottom <= innerHeight && r.right <= innerWidth && c.scrollHeight <= c.clientHeight + 1; }) }));
  await p.click('#upGrid [data-buy=hoist]');
  const up1 = await p.evaluate(() => ({ pts: +document.getElementById('upPoints').innerText, level: __arta.game.upgrades()[0].level, pips: document.querySelectorAll('#upGrid [data-up=hoist] .up-pips i.on').length }));
  await p.click('#upReset'); await p.click('#dlgBtns .btn:has-text("СБРОСИТЬ")');
  const up2 = await p.evaluate(() => ({ pts: +document.getElementById('upPoints').innerText, level: __arta.game.upgrades()[0].level, shown: document.getElementById('upgrades').classList.contains('show') }));
  console.log('upgrades', JSON.stringify({ up0, up1, up2 }));
  if (up0.cards !== 6 || up0.pts !== 13 || up0.pts !== up0.real) fail('экран снабжения: не шесть карточек или неверные очки');
  if (!up0.fits) fail('карточки снабжения не помещаются');
  if (up1.level !== 1 || up1.pips !== 1 || up1.pts !== up0.pts - 2) fail('улучшение не куплено');
  if (up2.level !== 0 || up2.pts !== up0.pts || !up2.shown) fail('сброс улучшений не вернул очки');
  await p.click('#upgrades [data-upact=close]');
  const badge = await p.evaluate(() => document.getElementById('upBadge').classList.contains('show') && document.getElementById('upBadge').innerText);
  if (badge !== '13') fail('нет значка очков на кнопке «СНАБЖЕНИЕ»: ' + badge);
  await p.evaluate((x) => { __arta.game.save.xp = x; }, xp0);
  // настройки: пять вкладок; размер надписей, левша, чувствительность
  const tab = (t) => p.click('#setTabs [data-settab=' + t + ']');
  await p.click('[data-act=settings]');
  const tabs = await p.evaluate(() => ({ names: [...document.querySelectorAll('#setTabs button')].map((x) => x.textContent).join(), on: (document.querySelector('#setTabs button.on') || {}).textContent,
    panes: document.querySelectorAll('#setList .set-pane').length, shown: [...document.querySelectorAll('#setList .set-pane')].filter((x) => x.offsetHeight > 0).length }));
  if (tabs.names !== 'ИГРА,УПРАВЛЕНИЕ,ЗВУК,ЭКРАН,ДАННЫЕ' || tabs.on !== 'ИГРА' || tabs.panes !== 5 || tabs.shown !== 1) fail('вкладки настроек: ' + JSON.stringify(tabs));
  await tab('screen'); await p.click('#setText [data-val="1.3"]'); await tab('ctrl'); await p.click('#setLefty [data-val="1"]'); await p.click('#setSens [data-val="1.6"]');
  const set1 = await p.evaluate(() => ({ ts: getComputedStyle(document.documentElement).getPropertyValue('--ts').trim(), xl: document.body.classList.contains('text-xl'), lefty: document.body.classList.contains('lefty'),
    sens: __arta.engine.settings.sens, saved: __arta.game.settings(), dir: getComputedStyle(document.getElementById('topbar')).flexDirection,
    fits: [...document.querySelectorAll('#settings .set-pane.on .set-row')].every((o) => o.getBoundingClientRect().right <= innerWidth) && document.querySelector('#settings .sheet').getBoundingClientRect().bottom <= innerHeight }));
  console.log('settings', JSON.stringify(set1));
  if (set1.ts !== '1.3' || !set1.xl) fail('размер надписей не применился');
  if (!set1.lefty || set1.dir !== 'row-reverse') fail('режим для левши не применился');
  if (set1.sens !== 1.6 || set1.saved.sens !== 1.6 || set1.saved.text !== 1.3 || set1.saved.lefty !== true) fail('настройки не сохранены');
  if (!set1.fits) fail('экран настроек не помещается');
  await tab('screen'); await p.click('#setText [data-val="1"]'); await tab('ctrl'); await p.click('#setLefty [data-val="0"]'); await p.click('#setSens [data-val="1"]');
  await p.click('#settings [data-setclose]');
  const set2 = await p.evaluate(() => ({ cls: document.body.className, sens: __arta.engine.settings.sens, menu: document.getElementById('menu').classList.contains('show') }));
  if (/lefty|text-xl/.test(set2.cls) || set2.sens !== 1 || !set2.menu) fail('настройки не вернулись к обычным: ' + JSON.stringify(set2));

  // ---------- 0б. настройки: каждый орган каждой вкладки меняет game.settings() и доходит до движка ----------
  await p.click('[data-act=settings]');
  const valueOf = (key) => p.evaluate((k) => { const g = __arta.game; return k === 'difficulty' ? g.state.difficulty : k === 'sound' ? !g.save.muted : g.settings()[k]; }, key);
  const CASES = [
    ['game', '#setDiff [data-val="1"]', 'difficulty', 1], ['game', '#setHints [data-val="all"]', 'hints', 'all'], ['game', '#setHints [data-val="off"]', 'hints', 'off'], ['game', '#setAutosave [data-val="0"]', 'autosave', false],
    ['game', '#setSpeed [data-val="2"]', 'speed', 2], ['game', '#setConfirm [data-val="0"]', 'confirmFriendly', false], ['game', '#setCrew [data-val="compact"]', 'crewPanel', 'compact'],
    ['game', '#setCrew [data-val="off"]', 'crewPanel', 'off'],
    ['ctrl', '#setInvert [data-val="1"]', 'invert', true], ['ctrl', '#setLefty [data-val="1"]', 'lefty', true], ['ctrl', '#setLefty [data-val="0"]', 'lefty', false],
    ['ctrl', '#setSens [data-val="1.3"]', 'sens', 1.3], ['ctrl', '#setVibroPower [data-val="low"]', 'vibroPower', 'low'], ['ctrl', '#setVibro [data-val="0"]', 'vibro', false],
    ['sound', '#setSound [data-val="0"]', 'sound', false], ['sound', '#setSound [data-val="1"]', 'sound', true], ['sound', '#setVolFx [data-step="-10"]', 'volFx', 90],
    ['sound', '#setVolAmb [data-step="10"]', 'volAmb', 60], ['sound', '#setVolRadio [data-step="-10"]', 'volRadio', 90], ['sound', '#setVolMusic [data-step="10"]', 'volMusic', 70],
    ['screen', '#setText [data-val="1.15"]', 'text', 1.15], ['screen', '#setQuality [data-val="high"]', 'quality', 'high'], ['screen', '#setQuality [data-val="auto"]', 'quality', 'auto'],
    ['screen', '#setQuality [data-val="mid"]', 'quality', 'mid'], ['screen', '#setQuality [data-val="low"]', 'quality', 'low'],
    ['screen', '#setFps [data-val="30"]', 'fps', 30], ['screen', '#setNight [data-val="soft"]', 'nightTint', 'soft'], ['screen', '#setShowFps [data-val="1"]', 'showFps', true],
    ['screen', '#setShake [data-val="0"]', 'shake', false],
  ];
  // качество: «АВТО» — по умолчанию и подсвечено; порядок кнопок; выбор в меню помечается (qualityChosen); 'auto' доходит до движка («АВТО» подбирает уровень само — на SwiftShader за секунды уходит вниз; настоящий подбор проверяет tools/test-quality.cjs)
  await tab('screen');
  const q0 = await p.evaluate(() => { const { game, engine } = __arta; return { set: game.settings().quality, chosen: game.settings().qualityChosen, auto: engine.qualityAuto, tier: engine.quality.tier, autoTier: engine.debug.stats().autoTier,
    seg: [...document.querySelectorAll('#setQuality button')].map((x) => x.textContent).join('/'), on: (document.querySelector('#setQuality button.on') || {}).textContent,
    note: document.querySelector('[data-row="setQuality"] small').textContent, shake: engine.settings.shake, music: engine.audio.buses.music,
    labels: ['setVolMusic', 'setShake'].map((id) => document.querySelector('[data-row="' + id + '"] b').textContent).join('|'),
    panes: ['setVolMusic', 'setShake'].map((id) => document.querySelector('[data-row="' + id + '"]').parentNode.dataset.pane).join() }; });
  if (q0.set !== 'auto' || q0.chosen !== false || q0.auto !== true || !['high', 'mid', 'low'].includes(q0.tier) || q0.tier !== q0.autoTier || q0.on !== 'АВТО') fail('качество по умолчанию не «АВТО»: ' + JSON.stringify(q0));
  if (q0.seg !== 'АВТО/ВЫСОКОЕ/СРЕДНЕЕ/ЭКОНОМНОЕ' || !q0.note.startsWith('АВТО само снижает качество, если телефон не успевает')) fail('строка качества: ' + q0.seg + ' · ' + q0.note);
  if (q0.shake !== true || q0.music !== 1 || q0.labels !== 'ГРОМКОСТЬ МУЗЫКИ|ТРЯСКА КАМЕРЫ ПРИ ВЫСТРЕЛЕ' || q0.panes !== 'sound,screen') fail('музыка и тряска по умолчанию: ' + JSON.stringify(q0));
  await p.click('#setQuality [data-val="high"]');
  const q1 = await p.evaluate(() => ({ chosen: __arta.game.settings().qualityChosen, auto: __arta.engine.qualityAuto, tier: __arta.engine.quality.tier }));
  if (q1.chosen !== true || q1.auto !== false || q1.tier !== 'high') fail('выбор «ВЫСОКОЕ» не помечен или не дошёл до движка: ' + JSON.stringify(q1));
  await p.click('#setQuality [data-val="auto"]');
  if (await p.evaluate(() => __arta.engine.qualityAuto !== true || __arta.engine.quality.tier !== __arta.engine.debug.stats().autoTier || __arta.game.settings().qualityChosen !== true)) fail('выбор «АВТО» не дошёл до движка (или не вернул подобранный уровень)');
  const setBad = [];
  for (const [t, sel, key, want] of CASES) {
    await tab(t); await p.click(sel);
    const got = await valueOf(key);
    if (got !== want) setBad.push(sel + ' → ' + key + ' = ' + JSON.stringify(got) + ', ждали ' + JSON.stringify(want));
    else if (!/data-step/.test(sel) && !(await p.evaluate((q) => document.querySelector(q).classList.contains('on'), sel))) setBad.push(sel + ' не подсвечен');
  }
  if (setBad.length) fail('настройки не меняются: ' + setBad.join('; '));
  // ползунок громкости: касание шкалы на четверти длины → 25; сила вибрации недоступна при выключенной вибрации
  await tab('sound');
  const barBox = await p.locator('#setVolRadio .sld-bar').boundingBox();
  await p.mouse.click(barBox.x + barBox.width * 0.25, barBox.y + barBox.height / 2);
  await tab('ctrl');
  // смена уровня качества (их только что перебрали все) перестраивает шейдеры и текстуры — на программном WebGL это
  // секунды; замер пропуска кадров начинаем, когда движок снова рисует ровно (6 кадров после последней смены)
  await p.evaluate(() => new Promise((r) => { let n = 0; const off = __arta.engine.onFrame(() => { if (++n >= 6) { off(); r(); } }); }));
  await p.waitForTimeout(1300);                // даём движку отрисовать секунду с ограничением 30 кадров
  const eng = await p.evaluate(async () => {
    const { engine, game } = __arta, st = game.settings(), fm = document.getElementById('fpsMeter');
    let frames = 0; const off = engine.onFrame(() => { frames++; });
    await new Promise((r) => setTimeout(r, 1000)); off();
    // программный рендер сам медленнее 30 к/с — пропуск кадров проверяем на заведомо низком пределе (2 к/с), потом возвращаем 30
    let free = 0, slow = 0, maxDt = 0;
    engine.setFrameCap(0); let off2 = engine.onFrame(() => { free++; }); await new Promise((r) => setTimeout(r, 1500)); off2();
    engine.setFrameCap(2); off2 = engine.onFrame((dt) => { slow++; maxDt = Math.max(maxDt, dt); }); await new Promise((r) => setTimeout(r, 1500)); off2();
    engine.setFrameCap(30);
    let rtW = 0; engine.getStation('observe').group.traverse((o) => { const m = o.material && o.material.map; if (m && m.isRenderTargetTexture) rtW = m.image.width; });
    return { volRadio: st.volRadio, bar: document.querySelector('#setVolRadio .sld-bar i').style.width, label: document.querySelector('#setVolRadio .sld-bar b').textContent,
      powerOff: [...document.querySelectorAll('#setVibroPower button')].every((x) => x.disabled),
      invert: engine.settings.invert, sens: engine.settings.sens, shake: engine.settings.shake, qAuto: engine.qualityAuto, q: engine.quality, cap: engine.frameCap, frames, free, slow, maxDt, rtW, buses: engine.audio.buses, muted: engine.audio.muted,
      body: document.body.className, fps: !fm.classList.contains('hidden') && fm.textContent, fpsSeen: fm.offsetWidth > 0, night: getComputedStyle(document.getElementById('night')).transitionProperty,
      rcol: getComputedStyle(document.querySelector('#crew .crew-chip')).display };
  });
  console.log('settings-engine', JSON.stringify(eng));
  if (eng.volRadio !== 25 || eng.bar !== '25%' || eng.label !== '25') fail('ползунок громкости радио не встал на 25: ' + eng.volRadio + ' ' + eng.bar);
  if (!eng.powerOff) fail('сила вибрации доступна при выключенной вибрации');
  if (eng.invert !== true || eng.sens !== 1.3) fail('инверсия или чувствительность не дошли до движка');
  if (eng.q.tier !== 'low' || eng.q.pixelRatio !== 1 || eng.q.rtScale !== 0.5 || eng.rtW !== 256 || eng.qAuto !== false) fail('качество «экономное» не дошло до движка: ' + JSON.stringify(eng.q) + ' окуляр ' + eng.rtW);
  if (eng.shake !== false) fail('выключенная тряска камеры не дошла до движка');
  if (eng.cap !== 30 || eng.frames > 34) fail('ограничение 30 кадров не работает: ' + eng.cap + ', кадров за секунду ' + eng.frames);
  if (eng.free < 5 || eng.slow < 1 || eng.slow > 4 || eng.maxDt > 0.0501) fail('пропуск кадров не работает: без предела ' + eng.free + ' кадров за 1,5 с, с пределом 2 к/с — ' + eng.slow + ', dt до ' + eng.maxDt);
  if (Math.abs(eng.buses.fx - 0.9) > 1e-6 || Math.abs(eng.buses.amb - 60 / 70) > 1e-6 || Math.abs(eng.buses.radio - 0.25) > 1e-6 || Math.abs(eng.buses.music - 70 / 60) > 1e-6 || eng.muted) fail('громкости не дошли до звука: ' + JSON.stringify(eng.buses));
  if (!/crew-off/.test(eng.body) || !/night-soft/.test(eng.body) || !/text-l/.test(eng.body) || eng.rcol !== 'none') fail('классы настроек не применены: ' + eng.body);
  if (!/^\d+ К\/С$/.test(eng.fps || '')) fail('счётчик кадров не включён: ' + eng.fps);
  if (eng.fpsSeen) fail('счётчик кадров виден на экране настроек вне боя (закрывает органы)');
  // вёрстка: 740×360, самый крупный шрифт, правша и левша — все вкладки помещаются, длинная вкладка прокручивается до конца
  await p.setViewportSize({ width: 740, height: 360 });
  await tab('screen'); await p.click('#setText [data-val="1.3"]');
  const setLay = [];
  let scrolls = 0;
  for (const lefty of [0, 1]) {
    await tab('ctrl'); await p.click('#setLefty [data-val="' + lefty + '"]');
    for (const t of ['game', 'ctrl', 'sound', 'screen', 'data']) {
      await tab(t);
      const r = await p.evaluate(() => {
        const sh = document.querySelector('#settings .sheet').getBoundingClientRect(), list = document.getElementById('setList'), bad = [];
        if (sh.left < 0 || sh.top < 0 || sh.right > innerWidth || sh.bottom > innerHeight) bad.push('окно за экраном');
        [...document.querySelectorAll('#settings .sheet-head > *, #setTabs button')].forEach((e) => { const q = e.getBoundingClientRect(); if (q.width < 1 || q.left < sh.left || q.right > sh.right + 0.5 || q.top < sh.top || q.bottom > sh.bottom) bad.push('шапка: ' + (e.textContent || e.id)); });
        const rows = [...document.querySelectorAll('#setList .set-pane.on .set-row')].filter((e) => e.offsetHeight > 0);
        rows.forEach((row) => [...row.children].forEach((e) => { const q = e.getBoundingClientRect(); if (q.left < sh.left || q.right > sh.right + 0.5 || e.scrollWidth > e.clientWidth + 1) bad.push(row.dataset.row + ': ' + (e.id || e.className)); }));
        rows.forEach((row) => row.querySelectorAll('.seg button, .sld-b, .set-act').forEach((e) => { if (e.getBoundingClientRect().height < 34) bad.push(row.dataset.row + ': кнопка ниже 34 px'); }));
        const scroll = list.scrollHeight > list.clientHeight + 1;
        list.scrollTop = list.scrollHeight;
        const last = rows[rows.length - 1].getBoundingClientRect(), lb = list.getBoundingClientRect();
        if (last.bottom > lb.bottom + 1 || lb.bottom > sh.bottom) bad.push('последняя строка не докручивается');
        list.scrollTop = 0;
        return { bad, scroll, rows: rows.length };
      });
      if (r.scroll) scrolls++;
      if (r.bad.length || !r.rows) setLay.push((lefty ? 'левша ' : '') + t + ': ' + (r.bad.join(', ') || 'нет строк'));
    }
  }
  await p.screenshot({ path: shotOf('settings') });
  console.log('settings-layout', JSON.stringify({ setLay, scrolls }));
  if (setLay.length) fail('настройки 740×360, крупный шрифт: ' + setLay.join('; '));
  if (!scrolls) fail('настройки 740×360: ни одна вкладка не прокручивается (а должна — строк больше, чем высота экрана)');
  await p.setViewportSize({ width: 844, height: 390 });
  // «ДАННЫЕ»: ролик (подставной — проверяем, что оболочка его зовёт), настройки по умолчанию
  const fakeIntro = () => p.evaluate(() => { window.__intro = { played: 0, resets: 0, marked: 0 };
    __arta.shell.setIntro({ play(o) { window.__intro.played++; setTimeout(o.onDone, 60); }, seen: () => true, markSeen() { window.__intro.marked++; }, reset() { window.__intro.resets++; } }); });
  // сперва настоящий ролик по кнопке «ПОСМОТРЕТЬ РОЛИК»: идёт поверх настроек, «ПРОПУСТИТЬ» возвращает в них
  await tab('data'); await p.click('#setIntro');
  const re0 = await p.evaluate(() => ({ playing: __arta.shell.introPlaying, el: !!document.getElementById('arta-intro') }));
  await skipIntro();
  if (!re0.playing || !re0.el || !(await p.isVisible('#settings.show')) || await p.evaluate(() => !!document.getElementById('arta-intro'))) fail('«ПОСМОТРЕТЬ РОЛИК» не показал ролик или не вернул в настройки: ' + JSON.stringify(re0));
  await fakeIntro();
  await tab('game'); await tab('data');
  await p.click('#setIntro');
  await p.waitForFunction(() => window.__intro.played === 1 && !__arta.shell.introPlaying);
  if (!(await p.isVisible('#settings.show'))) fail('после ролика не вернулись в настройки');
  const dataTab = await p.evaluate(() => ({ rows: [...document.querySelectorAll('#setList .set-pane.on .set-row')].filter((e) => e.offsetHeight > 0).map((e) => e.dataset.row).join(), ver: document.getElementById('setVer').textContent,
    wipe: document.getElementById('setWipe').textContent }));
  if (dataTab.rows !== 'setIntro,setTutorial,setUpReset,setDefaults,setWipe,setVerRow' || dataTab.wipe !== 'СБРОСИТЬ ПРОГРЕСС') fail('вкладка «ДАННЫЕ»: ' + JSON.stringify(dataTab));
  await p.click('#setDefaults'); await p.click('#dlgBtns .btn:has-text("ВОССТАНОВИТЬ")');
  const def = await p.evaluate(() => { const { game, engine } = __arta, st = game.settings(), D = game.SETTINGS;
    return { diff: Object.keys(D).filter((k) => st[k] !== D[k].def), n: Object.keys(D).length, q: engine.quality.tier, autoTier: engine.debug.stats().autoTier, qAuto: engine.qualityAuto, qSet: st.quality, shake: engine.settings.shake, cap: engine.frameCap, invert: engine.settings.invert, body: document.body.className.trim(),
      buses: engine.audio.buses, shown: document.getElementById('settings').classList.contains('show'), fps: document.getElementById('fpsMeter').classList.contains('hidden'), difficulty: game.state.difficulty }; });
  console.log('settings-defaults', JSON.stringify(def));
  if (def.diff.length || def.n < 21) fail('«по умолчанию» не вернуло настройки: ' + def.diff.join());
  if (!['high', 'mid', 'low'].includes(def.q) || def.q !== def.autoTier || def.cap !== 0 || def.invert || def.body || !def.fps || def.buses.fx !== 1 || Math.abs(def.buses.amb - 50 / 70) > 1e-6 || def.buses.radio !== 1) fail('«по умолчанию» не дошло до движка: ' + JSON.stringify(def));
  if (def.qSet !== 'auto' || def.qAuto !== true || def.shake !== true || def.buses.music !== 1) fail('«по умолчанию»: качество «АВТО», тряска и музыка не дошли до движка: ' + JSON.stringify(def));
  if (!def.shown || def.difficulty !== 1) fail('«по умолчанию» закрыло настройки или сменило сложность');
  await tab('game'); await p.click('#setDiff [data-val="0"]');
  await p.click('#settings [data-setclose]');
  if (!(await p.isVisible('#menu.show')) || await p.evaluate(() => __arta.game.state.difficulty) !== 0) fail('после настроек не вернулись в меню на «Курсанте»');
  // сохранённый бой: начать, свернуть, перезагрузить страницу, продолжить
  await p.click('[data-act=campaign]'); await p.click('.m-card'); await p.click('#dlgBtns .btn');
  const sv0 = await p.evaluate(async () => {
    const { game } = __arta, s = game.state;
    const until = async (f) => { for (let i = 0; i < 3000 && !f(); i++) { game.update(0.1); await new Promise((r) => setTimeout(r, 0)); } return f(); };
    await until(() => s.targets[0].reported);
    const t = s.targets[0];
    game.setPin(t.id, t.reported.x, t.reported.y);
    game.openBreech(); await until(() => !s.breech.busy); game.hoistShell('he'); await until(() => !s.breech.busy);
    s.integrity = 77;
    window.dispatchEvent(new Event('pagehide'));          // уход в фон → game.suspend()
    return { time: s.time, id: t.id, pin: s.plot.pins[t.id], info: game.resumeInfo() };
  });
  // игрок, который уже играл, обновился до версии с роликом (отметки о показе ещё нет): ролик не навязываем, а считаем показанным
  // запись localStorage уходит из страницы в браузер не сразу: перед перезагрузкой даём ей дойти (на телефоне уход в фон длится дольше)
  await p.waitForTimeout(1500);
  await p.evaluate(() => localStorage.removeItem('arta2.intro'));
  await p.waitForTimeout(500);
  const keep = await p.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]))));
  await p.reload();
  await p.waitForFunction(() => window.__arta);
  // безголовый Chromium на file:// изредка теряет ВСЁ хранилище при перезагрузке (воспроизводится и на старых сборках;
  // сама игра хранилище целиком не чистит). Тогда возвращаем снимок и перезагружаем ещё раз — проверка ниже та же.
  if (await p.evaluate(() => localStorage.length === 0)) {
    console.log('среда потеряла localStorage при перезагрузке — повтор с тем же сохранением');
    await p.evaluate((k) => { for (const [n, v] of Object.entries(JSON.parse(k))) localStorage.setItem(n, v); }, keep);
    await p.waitForTimeout(1000);
    await p.reload();
    await p.waitForFunction(() => window.__arta);
  }
  if (await p.evaluate(() => __arta.shell.introPlaying || !!document.getElementById('arta-intro') || !__arta.shell.intro.seen())) fail('игроку с сохранённым боем ролик показан насильно (или не отмечен показанным)');
  await skipIntro();
  if (await p.isVisible('#dialog.show')) await p.click('#dlgBtns .btn');
  const rb = await p.evaluate(() => ({ shown: !document.getElementById('resumeBox').classList.contains('hidden'), text: document.getElementById('resumeBtn').innerText.replace(/\n+/g, ' | '), phase: __arta.game.state.phase }));
  await p.click('#resumeBtn');
  await p.waitForFunction(() => !document.getElementById('hud').classList.contains('hidden') && document.getElementById('hTime').innerText !== '');
  const sv1 = await p.evaluate(() => { const s = __arta.game.state; return { phase: s.phase, time: s.time, integrity: s.integrity, pin: s.plot.pins[s.targets[0].id], shell: s.breech.shell, open: s.breech.open,
    hudTime: document.getElementById('hTime').innerText, bar: document.getElementById('hInt').style.width, station: __arta.engine.current }; });
  console.log('resume', JSON.stringify({ sv0, rb, sv1 }));
  await p.screenshot({ path: shotOf('resume') });
  if (!sv0.info || !rb.shown || !/ПРОДОЛЖИТЬ БОЙ/.test(rb.text) || rb.phase !== 'menu') fail('после перезагрузки меню не предлагает продолжить бой');
  if (sv1.phase !== 'playing' || sv1.time < sv0.time - 0.01 || sv1.time > sv0.time + 8) fail('время боя не перенеслось: ' + sv0.time + ' → ' + sv1.time);
  if (sv1.integrity !== 77 || sv1.bar !== '77%') fail('прочность не перенеслась');
  if (!sv1.pin || Math.abs(sv1.pin.x - sv0.pin.x) > 1e-6 || sv1.shell !== 'he' || !sv1.open) fail('фишка планшета или затвор не восстановились');
  // пауза → «СОХРАНИТЬ И ВЫЙТИ В МЕНЮ» → в меню снова есть бой → «сбросить»
  await p.click('[data-act=pause]');
  const pauseBtns = await p.evaluate(() => [...document.querySelectorAll('#dlgBtns .btn')].map((x) => x.textContent));
  if (!pauseBtns.includes('НАСТРОЙКИ') || !pauseBtns.includes('СОХРАНИТЬ И ВЫЙТИ В МЕНЮ') || !pauseBtns.includes('ВЫЙТИ БЕЗ СОХРАНЕНИЯ')) fail('в паузе нет настроек или выхода с сохранением: ' + pauseBtns.join(', '));
  // настройки из паузы: то, что меняют только между боями, недоступно и подписано
  await p.click('#dlgBtns .btn:has-text("НАСТРОЙКИ")');
  await tab('game');
  const inBattle = await p.evaluate(() => ({ diff: [...document.querySelectorAll('#setDiff button')].every((x) => x.disabled), note: document.querySelector('[data-row=setDiff] .set-lock').textContent,
    hints: [...document.querySelectorAll('#setHints button')].some((x) => x.disabled), paused: __arta.game.state.paused }));
  await p.click('#setDiff [data-val="1"]', { force: true });
  await tab('data');
  const inBattle2 = await p.evaluate(() => ({ wipe: document.getElementById('setWipe').disabled, tut: document.getElementById('setTutorial').disabled, defaults: document.getElementById('setDefaults').disabled, difficulty: __arta.game.state.difficulty }));
  if (!inBattle.diff || !/меню/.test(inBattle.note) || inBattle.hints || !inBattle.paused) fail('настройки из паузы: сложность не заблокирована: ' + JSON.stringify(inBattle));
  if (!inBattle2.wipe || !inBattle2.tut || inBattle2.defaults || inBattle2.difficulty !== 0) fail('настройки из паузы: «ДАННЫЕ»: ' + JSON.stringify(inBattle2));
  await p.click('#settings [data-setclose]');
  if (!(await p.isVisible('#dialog.show')) || !/ПАУЗА/.test(await p.innerText('#dlgBody'))) fail('из настроек не вернулись в паузу');
  await p.click('#dlgBtns .btn:has-text("СОХРАНИТЬ И ВЫЙТИ В МЕНЮ")');
  const kept = await p.evaluate(() => ({ phase: __arta.game.state.phase, shown: !document.getElementById('resumeBox').classList.contains('hidden'), info: __arta.game.resumeInfo() }));
  if (kept.phase !== 'menu' || !kept.shown || !kept.info || kept.info.integrity !== 77) fail('выход с сохранением не оставил бой: ' + JSON.stringify(kept));
  await p.click('#resumeDrop');
  if (await p.isVisible('#resumeBox') || await p.evaluate(() => !!__arta.game.resumeInfo())) fail('«сбросить» не убрало сохранённый бой');

  // ---------- 0в. кнопка «СОХРАНИТЬ» в бою ----------
  await p.click('[data-act=campaign]'); await p.click('.m-card'); await p.click('#dlgBtns .btn');
  await p.waitForFunction(() => !document.getElementById('hud').classList.contains('hidden') && document.getElementById('hint').textContent !== '');
  const run = (sec) => p.evaluate(async (n) => { const g = __arta.game; for (let i = 0; i < n * 10; i++) { g.update(0.1); if (i % 20 === 0) await new Promise((r) => setTimeout(r, 0)); } return g.state.time; }, sec);
  const t1 = await run(20);
  const sb0 = await p.evaluate(() => { const el = document.getElementById('hSave'), r = el.getBoundingClientRect(), tb = document.getElementById('topbar').getBoundingClientRect();
    return { text: el.innerText.trim(), glyph: !!el.querySelector('svg'), in: r.width >= 40 && r.left >= 0 && r.right <= innerWidth && r.top >= tb.top && r.bottom <= tb.bottom + 1, hint: document.getElementById('hint').textContent.length }; });
  if (sb0.text !== 'СОХРАНИТЬ' || !sb0.glyph || !sb0.in) fail('кнопка «СОХРАНИТЬ» не видна в верхней панели: ' + JSON.stringify(sb0));
  // подсказки обучения выкл → строки подсказки и подсветки вкладки нет; вкл → возвращаются
  await p.evaluate(() => __arta.game.setSetting('hints', 'off'));
  await p.waitForFunction(() => document.getElementById('hint').textContent === '' && !document.querySelector('#nav button.next'), null, { polling: 100, timeout: 20000 }).catch(() => fail('подсказки не выключились настройкой'));
  await p.evaluate(() => __arta.game.setSetting('hints', 'new'));
  await p.waitForFunction(() => document.getElementById('hint').textContent !== '', null, { polling: 100, timeout: 20000 }).catch(() => fail('подсказки не включились обратно'));
  // «СОХРАНИТЬ И ПРОДОЛЖИТЬ»: бой на паузе, пока открыт лист; запись есть, бой идёт дальше, сообщение со временем
  await p.click('#hSave');
  const sheet = await p.evaluate(() => ({ paused: __arta.game.state.paused, head: document.querySelector('#dlgBody h2').textContent, info: document.getElementById('saveInfo').textContent,
    btns: [...document.querySelectorAll('#dlgBtns .btn')].map((x) => x.textContent), primary: document.querySelector('#dlgBtns .btn.primary').textContent }));
  await p.click('#dlgBtns .btn:has-text("СОХРАНИТЬ И ПРОДОЛЖИТЬ")');
  const sc = await p.evaluate(() => { const g = __arta.game, s = g.state, t = document.getElementById('toast');
    return { phase: s.phase, paused: s.paused, info: g.resumeInfo(), raw: !!g.save.resume, time: s.time, toast: t.textContent, ok: t.classList.contains('ok') && t.classList.contains('show'), dialog: document.getElementById('dialog').classList.contains('show') }; });
  console.log('save-continue', JSON.stringify({ sheet, sc }));
  if (!sheet.paused || sheet.head !== 'СОХРАНИТЬ БОЙ' || sheet.btns.join('|') !== 'СОХРАНИТЬ И ВЫЙТИ В МЕНЮ|СОХРАНИТЬ И ПРОДОЛЖИТЬ|ОТМЕНА' || sheet.primary !== 'СОХРАНИТЬ И ВЫЙТИ В МЕНЮ') fail('лист сохранения: ' + JSON.stringify(sheet));
  if (!/ПРИСТРЕЛКА · 00:\d\d · ПРОЧНОСТЬ 100%/.test(sheet.info)) fail('лист сохранения без задания, времени и прочности: ' + sheet.info);
  if (sc.phase !== 'playing' || sc.paused || sc.dialog) fail('после «сохранить и продолжить» бой не идёт');
  if (!sc.raw || !sc.info || Math.abs(sc.info.time - t1) > 3) fail('«сохранить и продолжить» не записало бой: ' + JSON.stringify(sc.info) + ' при времени ' + t1);
  if (!sc.ok || !/^БОЙ СОХРАНЁН · \d\d:\d\d$/.test(sc.toast)) fail('нет сообщения «БОЙ СОХРАНЁН · мм:сс»: ' + sc.toast);
  // «ОТМЕНА» снимает паузу и ничего не пишет
  await p.click('#hSave'); await p.click('#dlgBtns .btn:has-text("ОТМЕНА")');
  if (await p.evaluate(() => __arta.game.state.paused || __arta.game.state.phase !== 'playing')) fail('«ОТМЕНА» в листе сохранения не вернула в бой');
  // верхняя панель с новой кнопкой: 740×360, самый крупный шрифт, все пять типов снарядов, правша и левша
  await p.evaluate(() => { const g = __arta.game; g.setSetting('text', 1.3); Object.assign(g.state.shells, { he: 12, ap: 10, illum: 4, smoke: 4, shrap: 6 }); g.state.time += 600; g.update(0.05); });
  await p.setViewportSize({ width: 740, height: 360 });
  const tbBad = [];
  for (const lefty of [false, true]) {
    await p.evaluate((l) => __arta.game.setSetting('lefty', l), lefty);
    await p.waitForFunction((l) => document.body.classList.contains('lefty') === l && /ШРП/.test(document.getElementById('hShells').textContent) && /^1\d:/.test(document.getElementById('hTime').textContent), lefty);
    const r = await p.evaluate(() => { const tb = document.getElementById('topbar'), q = (id) => document.getElementById(id), cut = (e) => e.scrollWidth > e.clientWidth + 1;
      const kids = [...tb.children].map((c) => c.getBoundingClientRect()), sv = q('hSave').getBoundingClientRect(), bar = q('hInt').parentNode.getBoundingClientRect();
      return { over: tb.scrollWidth - tb.clientWidth, out: kids.filter((k) => k.left < -0.5 || k.right > innerWidth + 0.5 || k.width < 1).length, save: Math.round(sv.width), label: q('hSave').querySelector('span').offsetWidth > 0,
        cut: ['hTime', 'hShells', 'hWind'].filter((id) => cut(q(id))), bar: Math.round(bar.width), nav: document.querySelectorAll('#nav button').length, navCut: [...document.querySelectorAll('#nav button')].filter((x) => x.getBoundingClientRect().right > innerWidth + 0.5).length }; });
    if (r.over > 0 || r.out || r.save < 40 || !r.label || r.cut.length || r.bar < 40 || r.nav !== 8 || r.navCut) tbBad.push((lefty ? 'левша: ' : '') + JSON.stringify(r));
  }
  await p.screenshot({ path: shotOf('topbar') });
  await p.evaluate(() => { const g = __arta.game; g.setSetting('lefty', false); g.setSetting('text', 1); });
  await p.setViewportSize({ width: 844, height: 390 });
  if (tbBad.length) fail('верхняя панель 740×360 с кнопкой «СОХРАНИТЬ» не помещается: ' + tbBad.join('; '));
  // «СОХРАНИТЬ И ВЫЙТИ В МЕНЮ» → меню: «ПРОДОЛЖИТЬ БОЙ» — главная кнопка с заданием, временем и прочностью → возврат в ту же минуту
  const t2 = await p.evaluate(() => { const s = __arta.game.state; s.integrity = 66; return s.time; });
  await p.click('#hSave'); await p.click('#dlgBtns .btn:has-text("СОХРАНИТЬ И ВЫЙТИ В МЕНЮ")');
  const sx = await p.evaluate(() => ({ phase: __arta.game.state.phase, menu: document.getElementById('menu').classList.contains('show'), shown: !document.getElementById('resumeBox').classList.contains('hidden'),
    text: document.getElementById('resumeBtn').innerText.replace(/\n+/g, ' | '), primary: document.getElementById('resumeBtn').classList.contains('primary'), campaign: document.querySelector('#menu [data-act=campaign]').classList.contains('primary'),
    hud: document.getElementById('hud').classList.contains('hidden') }));
  await p.click('#resumeBtn');
  await p.waitForFunction(() => !document.getElementById('hud').classList.contains('hidden') && __arta.game.state.phase === 'playing');
  const sr = await p.evaluate(() => { const s = __arta.game.state; return { time: s.time, integrity: s.integrity, paused: s.paused, shells: s.shells.shrap, save: !document.getElementById('hSave').classList.contains('hidden') }; });
  console.log('save-exit', JSON.stringify({ t2, sx, sr }));
  if (sx.phase !== 'menu' || !sx.menu || !sx.shown || !sx.hud) fail('«сохранить и выйти» не вывело в меню с сохранённым боем');
  if (!/ПРОДОЛЖИТЬ БОЙ \| ПРИСТРЕЛКА · 1\d:\d\d · ПРОЧНОСТЬ 66%/.test(sx.text) || !sx.primary || sx.campaign) fail('«ПРОДОЛЖИТЬ БОЙ» не главная кнопка или без задания, времени и прочности: ' + JSON.stringify(sx));
  if (sr.time < t2 - 0.01 || sr.time > t2 + 8 || sr.integrity !== 66 || sr.paused || sr.shells !== 6 || !sr.save) fail('«ПРОДОЛЖИТЬ БОЙ» вернуло не в ту минуту: ' + t2 + ' → ' + JSON.stringify(sr));
  await p.evaluate(() => __arta.game.quit());
  if (await p.evaluate(() => document.querySelector('#menu [data-act=campaign]').classList.contains('primary')) !== true) fail('без сохранённого боя «КАМПАНИЯ» не главная кнопка');

  // ---------- 1. первое задание ----------
  await p.click('[data-act=campaign]'); await p.click('.m-card'); await p.click('#dlgBtns .btn');
  const res = await p.evaluate(async () => {
    const { game, engine } = __arta, s = game.state, RAD = Math.PI / 180;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const until = async (f) => { for (let i = 0; i < 3000 && !f(); i++) { game.update(0.1); await sleep(0); } return f(); };
    window.__e2e = { sleep, until };
    await until(() => s.targets[0].reported);
    const t = s.targets[0], bat = s.mission.battery;
    engine.gotoStation('plot', { instant: true });
    game.setPin(t.id, t.reported.x, t.reported.y);
    const dx = t.reported.x - bat.x, dy = t.reported.y - bat.y, rng = Math.hypot(dx, dy), brg = ((Math.atan2(dx, dy) / RAD) + 360) % 360;
    game.setAlidade({ bearing: brg, range: rng }); game.recordMeasurement();
    engine.gotoStation('computer', { instant: true });
    game.setComputerRange(rng); const ch = game.chargeStates().indexOf('ok') + 1; game.setComputerCharge(ch); const sol = game.compute();
    engine.gotoStation('loading', { instant: true });
    game.openBreech(); await until(() => !s.breech.busy); game.hoistShell('he'); await until(() => !s.breech.busy);
    game.ramShell(); await until(() => !s.breech.busy);
    for (let i = 0; i < ch; i++) { game.addCharge(); await until(() => !s.breech.busy); }
    game.closeBreech(); await until(() => !s.breech.busy);
    engine.gotoStation('traverse', { instant: true });
    game.setBrake(false); game.rotateTurret(s.plot.recorded[t.id].bearing - s.turret.bearing); game.setBrake(true);
    engine.gotoStation('elevation', { instant: true });
    game.elevate(sol.elevation - s.turret.elevation);
    engine.gotoStation('fire', { instant: true });
    const check = { ...s.checklist };
    game.arm(true); const f = game.fire();
    await until(() => s.phase !== 'playing');
    await sleep(2500);
    return { fired: f.ok, check, phase: s.phase, shots: s.shots, dialog: document.getElementById('dlgBody').innerText.replace(/\n+/g, ' | ').slice(0, 260), hud: document.getElementById('memo').innerText,
      shells: document.getElementById('hShells').innerText, btns: [...document.querySelectorAll('#dlgBtns .btn')].map((x) => x.textContent) };
  });
  console.log(JSON.stringify(res, null, 1));
  await p.screenshot({ path: shot });
  if (res.phase !== 'won') fail('задание не выиграно');
  if (!/ОПЫТ \+\d+/.test(res.dialog)) fail('в итогах нет опыта');
  if (!res.btns.includes('РАЗБОР БОЯ')) fail('в итогах нет кнопки «РАЗБОР БОЯ»');

  // ---------- 2. разбор боя ----------
  if (res.btns.includes('РАЗБОР БОЯ')) {
    await p.click('#dlgBtns .btn:has-text("РАЗБОР БОЯ")');
    await p.click('#dbfTable tr[data-n]');
    const dbf = await p.evaluate(() => {
      const c = document.getElementById('dbfCanvas'), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data, seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 7) seen.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3));
      const r = c.getBoundingClientRect(), side = document.getElementById('dbfTable').getBoundingClientRect();
      return { visible: document.getElementById('debrief').classList.contains('show'), size: c.width, colors: seen.size, rows: document.querySelectorAll('#dbfTable tr[data-n]').length,
        on: document.querySelectorAll('#dbfTable tr.on').length, selected: __arta.game.state.history.length, fits: r.bottom <= innerHeight && side.right <= innerWidth && r.width > 150 && side.width > 200,
        first: (document.querySelector('#dbfTable tr[data-n]') || {}).innerText };
    });
    console.log('debrief', JSON.stringify(dbf));
    await p.screenshot({ path: shotOf('debrief') });
    if (!dbf.visible || dbf.colors < 5) fail('карта разбора пуста');
    if (dbf.rows !== res.shots || dbf.rows !== dbf.selected) fail('строк в таблице разбора не столько, сколько выстрелов');
    if (dbf.on !== 1) fail('строка разбора не подсветилась');
    if (!dbf.fits) fail('разбор не помещается на экран');
    await p.click('[data-act=debriefZoom]');
    await p.click('[data-act=closeDebrief]');
    if (!(await p.isVisible('#dialog.show'))) fail('после разбора не вернулись к итогам');
  }
  await p.click('#dlgBtns .btn:has-text("В МЕНЮ")');

  // ---------- 3. оборона ----------
  await p.click('[data-act=survival]'); await p.click('#dlgBtns .btn');
  // кнопка «СОХРАНИТЬ» работает и в обороне, и в задании дня
  const saveHere = async (kind) => {
    await p.click('#hSave'); await p.click('#dlgBtns .btn:has-text("СОХРАНИТЬ И ПРОДОЛЖИТЬ")');
    const r = await p.evaluate(() => ({ info: __arta.game.resumeInfo(), phase: __arta.game.state.phase, paused: __arta.game.state.paused, toast: document.getElementById('toast').textContent }));
    if (!r.info || r.phase !== 'playing' || r.paused || !/БОЙ СОХРАНЁН/.test(r.toast)) fail('«СОХРАНИТЬ» не работает (' + kind + '): ' + JSON.stringify(r));
  };
  await saveHere('оборона');
  const sv = await p.evaluate(async () => {
    const { game, engine } = __arta, s = game.state, RAD = Math.PI / 180, { until } = window.__e2e;
    const bat = s.mission.battery, log = [];
    const idle = async () => until(() => !s.breech.busy);
    /** Полный выстрел действиями игры по истинному положению цели (с упреждением), без рассеивания. */
    async function shootAt(t) {
      const aim = (tof) => { const v = t.moving ? (t.speed / 3600) * tof : 0; return { x: t.x + v * Math.sin(t.course * RAD), y: t.y + v * Math.cos(t.course * RAD) }; };
      const lay = (q) => { const dx = q.x - bat.x, dy = q.y - bat.y; return { rng: Math.hypot(dx, dy), brg: ((Math.atan2(dx, dy) / RAD) + 360) % 360 }; };
      const type = t.armored ? 'ap' : s.shells.he > 0 ? 'he' : 'shrap';
      if (!(s.shells[type] > 0)) return 'нет снарядов ' + type;
      const r0 = lay(aim(30)).rng;
      let ch = 0;
      for (let n = 1; n <= 6 && !ch; n++) { const l = game.chargeRange(n); if (r0 > l.min + 0.4 && r0 < l.max - 0.4) ch = n; }
      if (!ch) return 'вне досягаемости';
      if (t.reported || t.area) game.selectTarget(t.id);
      engine.gotoStation('loading', { instant: true });
      if (s.turret.elevation > game.C.LOAD_ANGLE) game.elevate(game.C.LOAD_ANGLE - s.turret.elevation);
      game.openBreech(); await idle(); game.hoistShell(type); await idle(); game.ramShell(); await idle();
      for (let i = 0; i < ch; i++) { game.addCharge(); await idle(); }
      game.closeBreech(); await idle();
      if (!t.alive) { game.openBreech(); await idle(); game.unload(); await idle(); game.closeBreech(); await idle(); return 'цель выбыла'; }
      let sol = null, q = null;
      for (let i = 0, tof = 30; i < 4; i++) { q = lay(aim(tof)); game.setComputerRange(q.rng); game.setComputerCharge(ch); sol = game.compute(); if (!sol.ok) break; tof = sol.tof; }
      if (!sol || !sol.ok) { game.openBreech(); await idle(); game.unload(); await idle(); game.closeBreech(); await idle(); return 'нет решения'; }
      game.setAlidade({ bearing: q.brg, range: q.rng }); if (t.reported || t.area) { game.setPin(t.id, Math.max(0, Math.min(20, aim(sol.tof).x)), Math.max(0, Math.min(20, aim(sol.tof).y))); game.recordMeasurement(); }
      engine.gotoStation('fire', { instant: true });
      game.setBrake(false); game.rotateTurret(q.brg + (sol.windBearing || 0) - s.turret.bearing); game.setBrake(true);
      game.elevate(sol.elevation - s.turret.elevation);
      game.arm(true);
      const R = Math.random; Math.random = () => 0.25; let f; try { f = game.fire(); } finally { Math.random = R; }
      if (!f.ok) return 'отказ: ' + f.reason;
      await until(() => !s.flight.length);
      return t.alive ? 'hp ' + t.hp : 'уничтожена';
    }
    const wave1 = s.targets.map((t) => t.id);
    await until(() => s.targets.some((t) => t.active));
    for (let i = 0; i < 30 && s.wave < 2 && s.phase === 'playing'; i++) {
      const t = s.targets.filter((x) => x.alive && x.active).sort((a, c) => (c.moving ? 1 : 0) - (a.moving ? 1 : 0))[0];
      if (!t) { await until(() => s.wave >= 2 || s.phase !== 'playing' || s.targets.some((x) => x.alive && x.active)); continue; }
      const r = await shootAt(t); log.push(t.id + ':' + r);
      if (/вне|нет/.test(r)) { for (let k = 0; k < 100; k++) game.update(0.1); }
    }
    for (let i = 0; i < 50 && document.getElementById('hTimeK').innerText !== 'ВОЛНА ' + s.wave; i++) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => setTimeout(r, 500));
    return { wave: s.wave, phase: s.phase, kills: s.kills, shots: s.shots, integrity: s.integrity, log, wave1, ids: s.targets.filter((t) => t.alive).map((t) => t.id), shells: { ...s.shells },
      hudWave: document.getElementById('hTimeK').innerText, hudShells: document.getElementById('hShells').innerText, wind: document.getElementById('hWind').innerText };
  });
  console.log('survival', JSON.stringify(sv));
  await p.screenshot({ path: shotOf('survival') });
  if (sv.wave < 2 || sv.phase !== 'playing') fail('вторая волна обороны не началась');
  if (sv.kills < 1) fail('в обороне не уничтожено ни одной цели');
  if (!sv.ids.every((id) => !sv.wave1.includes(id))) fail('во второй волне остались живые цели первой');
  if (sv.hudWave !== 'ВОЛНА ' + sv.wave) fail('HUD не показывает номер волны: ' + sv.hudWave);
  if (!/ОСВ/.test(sv.hudShells)) fail('HUD не показывает пополненные снаряды: ' + sv.hudShells);
  await p.evaluate(() => __arta.game.quit());

  // ---------- 4. задание дня ----------
  await p.click('[data-act=daily]');
  const dl0 = await p.evaluate(() => ({ phase: __arta.game.state.phase, head: (document.querySelector('#dlgBody h2') || {}).innerText }));
  await p.click('#dlgBtns .btn');
  const dl1 = await p.evaluate(() => { const s = __arta.game.state, d = new Date(), p2 = (n) => String(n).padStart(2, '0');
    return { phase: s.phase, daily: s.mission.daily, today: d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()), index: s.mission.index, targets: s.targets.length, hud: !document.getElementById('hud').classList.contains('hidden') }; });
  console.log('daily', JSON.stringify({ dl0, dl1 }));
  if (dl0.phase !== 'briefing' || !/ЗАДАНИЕ ДНЯ/.test(dl0.head || '')) fail('брифинг задания дня не открылся');
  if (dl1.phase !== 'playing' || dl1.daily !== dl1.today || dl1.index !== null || dl1.targets < 3 || !dl1.hud) fail('задание дня не началось');
  await saveHere('задание дня');
  await p.evaluate(() => __arta.game.quit());

  // ---------- 5. конвой с налётом (задание 32 «Воздух!»): расчёт и аптечка, свои в блокноте, тревога → зенитка, итог и разбор ----------
  // Задание 32 — дальше третьего: по умолчанию здесь только темы «НОВОЕ» (их проверяет раздел 8). Раздел 5 проверяет пошаговую
  // подсказку зенитного поста и её вёрстку, поэтому идёт в режиме «ПО ШАГАМ».
  await p.evaluate(() => __arta.game.setSetting('hints', 'all'));
  const hudFits = () => p.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect(), c = r('rcol');
    const chips = [...document.querySelectorAll('#crew .crew-chip')];
    return { chips: chips.length, names: chips.map((x) => x.querySelector('.nm').textContent).join(','), kits: document.querySelector('#crewKits b').textContent,
      inside: c.top >= 40 && c.bottom <= innerHeight - 56 && c.right <= innerWidth && c.left >= innerWidth - 60 && c.width > 30 };
  });
  await p.evaluate(() => { const g = __arta.game; window.__unl = g.save.unlocked; g.save.unlocked = 36; g.startMission(31); });
  const cvBrief = await p.innerText('#dlgBody');
  if (!/КОНВОЙ/.test(cvBrief) || !/ВОЗДУХ/.test(cvBrief)) fail('брифинг конвоя без условий «КОНВОЙ» и «ВОЗДУХ»');
  await p.click('#dlgBtns .btn');
  await p.waitForFunction(() => document.querySelectorAll('#crew .crew-chip').length === 3 && document.querySelector('#crew .nm').textContent);
  const crew0 = await hudFits();
  // раним заряжающего: значок краснеет, касание тратит аптечку и возвращает в строй
  await p.evaluate(() => { const s = __arta.game.state; s.crew.loader.state = 'wounded'; s.crew.loader.woundedUntil = s.time + 45; __arta.game.update(0.05); });
  await p.waitForFunction(() => document.querySelector('#crew [data-role=loader]').classList.contains('wounded'));
  await p.click('#crew [data-role=loader]');
  await p.waitForFunction(() => document.querySelector('#crew [data-role=loader]').classList.contains('ok'));
  const crew1 = await p.evaluate(() => ({ state: __arta.game.state.crew.loader.state, kits: __arta.game.state.medkits, shown: document.querySelector('#crewKits b').textContent }));
  // тот же столбик на узком экране 740×360
  await p.setViewportSize({ width: 740, height: 360 });
  const crewSmall = await hudFits();
  await p.setViewportSize({ width: 844, height: 390 });
  console.log('crew', JSON.stringify({ crew0, crew1, crewSmall }));
  // уставший: первое касание — только справка (аптечка цела), второе подряд — аптечка
  const tired = await p.evaluate(() => {
    const g = __arta.game, s = g.state, m = s.crew.gunner, el = document.querySelector('#crew [data-role=gunner]');
    m.fatigue = 0.9; m.state = 'tired';
    const k0 = s.medkits; el.click();
    const r = { k0, k1: s.medkits, st1: m.state, toast: document.getElementById('toast').textContent };
    m.fatigue = 0.9; m.state = 'tired';          // такт между касаниями мог снять усталость
    el.click();
    r.k2 = s.medkits; r.st2 = m.state; s.medkits = k0;
    return r;
  });
  console.log('tired', JSON.stringify(tired));
  if (tired.k1 !== tired.k0 || tired.st1 !== 'tired' || !/УСТАЛ/.test(tired.toast)) fail('касание уставшего сразу тратит аптечку: ' + JSON.stringify(tired));
  if (tired.k2 !== tired.k0 - 1 || tired.st2 !== 'ok') fail('второе касание уставшего не лечит: ' + JSON.stringify(tired));
  // 16:9 (640×360): ни один орган постов не закрыт HUD (столбик расчёта сжат в полоску); левша + крупный шрифт: кнопки ремонта не лежат
  // на крышке и тумблере цепи стрельбы; тревога и радиострока не задевают стопку неисправностей; подсказка не обрезана из-за «своего глаза»
  await p.setViewportSize({ width: 640, height: 360 });
  const lay = await p.evaluate(async () => {
    const { engine, game } = __arta, s = game.state, V = new engine.THREE.Vector3(), out = { covered: [], lefty: [], overlap: [] };
    const wait = (fn, ms = 4000) => new Promise((res) => { const t0 = Date.now(); (function f() { if (fn() || Date.now() - t0 > ms) res(); else setTimeout(f, 50); })(); });
    const hud = document.getElementById('hud'), R = (id) => document.getElementById(id).getBoundingClientRect();
    const hit = (a, b) => a.width > 0 && b.width > 0 && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    const under = (id, keys) => {
      const st = engine.stations.find((x) => x.id === id), res = [];
      for (const k of keys || Object.keys(st.hotspots || {})) {
        const o = st.hotspots[k]; if (!o || !o.getWorldPosition) continue;
        o.getWorldPosition(V); const sc = engine.input.toScreen(V, {});
        if (sc.behind || sc.x < 0 || sc.y < 0 || sc.x > innerWidth || sc.y > innerHeight) continue;
        const el = document.elementFromPoint(sc.x, sc.y);
        if (el && el.tagName !== 'CANVAS') res.push(id + '.' + k + ' под ' + (el.id || el.className));
      }
      return res;
    };
    const go = async (id) => { engine.gotoStation(id, { instant: true }); await wait(() => hud.dataset.st === id); await new Promise((r) => setTimeout(r, 250)); };
    const was = engine.current;
    await wait(() => R('rcol').width < 30);
    out.rcolW = R('rcol').width;
    for (const id of ['plot', 'computer', 'loading', 'traverse', 'elevation', 'fire', 'observe', 'aa']) { await go(id); out.covered.push(...under(id)); }
    // подсказка в нижней строке
    {
      // (меряем строку шага: если в этот момент в строке тема «НОВОЕ», её начертание на время замера снимаем)
      const m = document.getElementById('memo'), o = document.getElementById('obs'), h = document.getElementById('hint'), keep = [m.innerHTML, o.innerHTML, h.innerHTML, h.className]; h.className = '';
      m.textContent = 'ЦЕЛЬ 1 · ПЕЛЕНГ 012,4° · ДАЛЬНОСТЬ 9,85 КМ · УГОЛ 25,11° · ЗАРЯД 2'; o.textContent = 'КОРР. №1: ПЕРЕЛЁТ 350, ВПРАВО 120';
      h.textContent = 'ПОДЪЁМ: держите «НА УГОЛ ЗАРЯЖАНИЯ» — ствол должен опуститься до 3°';
      out.hintCut = h.scrollWidth - h.clientWidth;
      m.innerHTML = keep[0]; o.innerHTML = keep[1]; h.innerHTML = keep[2]; h.className = keep[3];
    }
    // две неисправности, крупный шрифт
    game.setSetting('text', 1.3);
    s.faults.drive = true; s.faults.hoist = true;
    await go('plot');
    await wait(() => document.querySelectorAll('#faults .fault').length === 2 && hud.classList.contains('hasfaults'));
    for (const lefty of [false, true]) {
      game.setSetting('lefty', lefty);
      await wait(() => document.body.classList.contains('lefty') === lefty);
      const rb = document.getElementById('raidBanner'), radio = document.getElementById('radio');
      const hid = rb.classList.contains('hidden'), raid = hud.classList.contains('raid'), txt = radio.innerHTML;
      rb.classList.remove('hidden'); hud.classList.add('raid');
      radio.innerHTML = '<b>ШТАБ</b>Налёт! Самолётов: 2, заходят с пеленга 335.0°. Всем постам — к бою, зенитный расчёт на место.';
      if (hit(R('raidBanner'), R('faults'))) out.overlap.push((lefty ? 'левша: ' : '') + 'тревога на неисправностях');
      if (hit(R('radio'), R('faults'))) out.overlap.push((lefty ? 'левша: ' : '') + 'радио под неисправностями');
      if (hit(R('raidBanner'), R('rcol'))) out.overlap.push((lefty ? 'левша: ' : '') + 'тревога на столбике расчёта');
      rb.classList.toggle('hidden', hid); hud.classList.toggle('raid', raid); radio.innerHTML = txt;
    }
    await go('fire');
    out.lefty = under('fire', ['armCover', 'armToggle']);
    out.faultsFire = (() => { const r = R('faults'); return [Math.round(r.left), Math.round(r.right)]; })();
    game.setSetting('lefty', false); game.setSetting('text', 1);
    s.faults.drive = false; s.faults.hoist = false;
    await go(was);
    return out;
  });
  console.log('layout', JSON.stringify(lay));
  if (!(lay.rcolW < 30)) fail('16:9: столбик расчёта не сжат: ' + lay.rcolW);
  if (lay.covered.length) fail('16:9: органы постов закрыты HUD: ' + lay.covered.join('; '));
  if (lay.hintCut > 24) fail('подсказка обрезана на ' + lay.hintCut + ' px');
  if (lay.overlap.length) fail('наложение в HUD: ' + lay.overlap.join('; '));
  if (lay.lefty.length || lay.faultsFire[0] > 100) fail('левша, пост ОГОНЬ: неисправности на органах цепи стрельбы: ' + lay.lefty.join('; ') + ' ' + lay.faultsFire);
  await p.setViewportSize({ width: 844, height: 390 });
  if (crew0.chips !== 3 || !/ГРОМОВ,СЕДЫХ,ВЯТКИН/.test(crew0.names) || crew0.kits !== '2') fail('значки расчёта или счётчик аптечек не показаны');
  if (!crew0.inside || !crewSmall.inside) fail('столбик расчёта не помещается у края экрана');
  if (crew1.state !== 'ok' || crew1.kits !== 1 || crew1.shown !== '1') fail('аптечка по касанию значка не сработала: ' + JSON.stringify(crew1));
  // свои силы в блокноте, значок конвоя в HUD
  await p.click('[data-act=notebook]');
  const nbk = await p.evaluate(() => ({ friends: document.getElementById('nbFriends').innerText.replace(/\n+/g, ' | ').slice(0, 200), cards: document.querySelectorAll('#nbFriends .nb-f').length, n: __arta.game.state.friends.length,
    crew: document.getElementById('nbCrew').innerText.replace(/\n+/g, ' | '), aa: document.getElementById('nbAA').innerText.replace(/\n+/g, ' | '), obs: document.getElementById('nbObs').innerText.length,
    convoy: !document.getElementById('convoyChip').classList.contains('hidden') && document.querySelectorAll('#convoyChip i').length }));
  console.log('notebook', JSON.stringify(nbk));
  if (!/СВОИ СИЛЫ/.test(nbk.friends) || !/СВОИ 1/.test(nbk.friends) || nbk.cards !== nbk.n || nbk.n < 1) fail('в блокноте нет своих сил');
  if (!/Громов/.test(nbk.crew) || !/Аптечки/.test(nbk.crew) || !/Патроны/.test(nbk.aa) || !nbk.obs) fail('в блокноте нет экипажа, зенитки или докладов');
  if (!nbk.convoy) fail('в HUD нет значка конвоя');
  await p.click('[data-act=closeNotebook]');
  // выстрел рядом со своими: спуск (engine.guards.fire, его зовёт пост ОГОНЬ) сперва спрашивает «СВОИ В ЗОНЕ. ОГОНЬ?»
  const ff0 = await p.evaluate(async () => {
    const { game, engine } = __arta, s = game.state, RAD = Math.PI / 180, { until } = window.__e2e;
    await until(() => s.targets.some((t) => t.alive && t.reported));
    const t = s.targets.find((x) => x.alive && x.reported), f = s.friends.find((x) => x.alive && !x.arrived), bat = s.mission.battery;
    game.selectTarget(t.id);
    const dx = f.x - bat.x, dy = f.y - bat.y, rng = Math.hypot(dx, dy), brg = ((Math.atan2(dx, dy) / RAD) + 360) % 360;
    game.setPin(t.id, f.x, f.y); game.setAlidade({ bearing: brg, range: rng }); game.recordMeasurement();
    if (s.turret.elevation > game.C.LOAD_ANGLE) game.elevate(game.C.LOAD_ANGLE - s.turret.elevation);
    game.openBreech(); await until(() => !s.breech.busy); game.hoistShell('he'); await until(() => !s.breech.busy); game.ramShell(); await until(() => !s.breech.busy);
    game.addCharge(); await until(() => !s.breech.busy); game.closeBreech(); await until(() => !s.breech.busy);
    game.setBrake(true); game.arm(true);
    window.__ff = { fired: 0 };
    const rd = game.fireReadiness(), danger = game.friendInDanger();
    engine.guards.fire(() => { window.__ff.fired++; });
    return { rd, danger, friend: f.id, label: f.label, fired: window.__ff.fired, paused: s.paused, guard: typeof engine.guards.fire, warn: document.getElementById('ffWarn').textContent };
  });
  const ffDlg = await p.evaluate(() => ({ shown: document.getElementById('dialog').classList.contains('show'), head: (document.querySelector('#dlgBody h2') || {}).textContent, body: document.getElementById('dlgBody').innerText,
    btns: [...document.querySelectorAll('#dlgBtns .btn')].map((x) => x.textContent).join('|') }));
  if (ffDlg.shown) await p.click('#dlgBtns .btn:has-text("ОТСТАВИТЬ")');
  const ff1 = await p.evaluate(() => ({ fired: window.__ff.fired, paused: __arta.game.state.paused, shown: document.getElementById('dialog').classList.contains('show') }));
  await p.evaluate(() => __arta.engine.guards.fire(() => { window.__ff.fired++; }));
  if (await p.isVisible('#dialog.show')) await p.click('#dlgBtns .btn:has-text("ОГОНЬ")');
  const ff2 = await p.evaluate(() => { const g = __arta.game, r = { fired: window.__ff.fired, paused: g.state.paused };
    g.setSetting('confirmFriendly', false); __arta.engine.guards.fire(() => { window.__ff.fired++; });
    r.silent = window.__ff.fired; r.noDialog = !document.getElementById('dialog').classList.contains('show');
    g.setSetting('confirmFriendly', true);
    // осветительный своим не вредит — вопроса нет; разряжаем орудие и снимаем замер, чтобы дальше бой шёл как раньше
    g.arm(false); return r; });
  await p.evaluate(async () => { const { game } = __arta, s = game.state, { until } = window.__e2e; game.openBreech(); await until(() => !s.breech.busy); game.unload(); await until(() => !s.breech.busy); game.closeBreech(); await until(() => !s.breech.busy);
    const t = s.targets.find((x) => x.id === s.activeTarget); if (t && t.reported) { game.setPin(t.id, t.reported.x, t.reported.y); } });
  console.log('friendly', JSON.stringify({ ff0, ffDlg, ff1, ff2 }));
  if (ff0.guard !== 'function' || ff0.danger !== ff0.friend) fail('свои в зоне не определены или нет перехватчика спуска: ' + JSON.stringify(ff0));
  if (ff0.fired !== 0 || !ff0.paused || !ffDlg.shown || ffDlg.head !== 'СВОИ В ЗОНЕ. ОГОНЬ?' || ffDlg.btns !== 'ОТСТАВИТЬ|ОГОНЬ' || !ffDlg.body.includes(ff0.label)) fail('нет вопроса «СВОИ В ЗОНЕ. ОГОНЬ?»: ' + JSON.stringify(ffDlg));
  if (ff1.fired !== 0 || ff1.paused || ff1.shown) fail('«ОТСТАВИТЬ» не отменило выстрел: ' + JSON.stringify(ff1));
  if (ff2.fired !== 1 || ff2.paused) fail('«ОГОНЬ» не пропустило выстрел: ' + JSON.stringify(ff2));
  if (ff2.silent !== 2 || !ff2.noDialog) fail('с выключенным подтверждением спуск всё равно спрашивает');
  // налёт: ждём предупреждения — плашка, вкладка ЗЕНИТКА мигает; касание плашки ведёт на пост
  const rd0 = await p.evaluate(async () => {
    const { game } = __arta, s = game.state, { until } = window.__e2e;
    let warned = false; const off = game.on('raid', (e) => { if (e.phase === 'warning') warned = true; });
    await until(() => warned || s.phase !== 'playing'); off();
    for (let i = 0; i < 60 && document.getElementById('raidBanner').classList.contains('hidden'); i++) await new Promise((r) => setTimeout(r, 100));
    const el = document.getElementById('raidBanner'), r = el.getBoundingClientRect();
    return { warned, phase: s.phase, time: s.time, shown: !el.classList.contains('hidden'), text: el.innerText, tab: document.querySelector('#nav [data-station=aa]').classList.contains('alarm'), top: r.top, hint: document.getElementById('hint').innerText };
  });
  if (rd0.shown) await p.click('#raidBanner');
  await p.waitForFunction(() => __arta.engine.current === 'aa', null, { polling: 100, timeout: 30000 }).catch(() => {});
  const rd1 = await p.evaluate(async () => {
    const { game, engine } = __arta, s = game.state, { until } = window.__e2e;
    const at = engine.current;
    let ended = null; const off = game.on('raid', (e) => { if (e.phase === 'end') ended = e; });
    await until(() => s.raid && s.raid.phase === 'inbound');
    for (let i = 0; i < 40 && !/ЗЕНИТКА/.test(document.getElementById('hint').innerText); i++) await new Promise((r) => setTimeout(r, 100));   // HUD перерисовывается по кадрам
    const hint = document.getElementById('hint').innerText;
    await until(() => ended || s.phase !== 'playing'); off();
    for (let i = 0; i < 30 && !document.getElementById('raidBanner').classList.contains('hidden'); i++) await new Promise((r) => setTimeout(r, 100));
    return { at, hint, ended, phase: s.phase, hidden: document.getElementById('raidBanner').classList.contains('hidden'), toast: document.getElementById('toast').textContent, integrity: s.integrity, bombs: s.stats.bombs };
  });
  console.log('raid', JSON.stringify({ rd0, rd1 }));
  await p.screenshot({ path: shotOf('raid') });
  if (!rd0.warned || !rd0.shown || !/ВОЗДУХ/.test(rd0.text) || !rd0.tab) fail('тревога «ВОЗДУХ!» не показана (плашка или вкладка)');
  if (rd1.at !== 'aa') fail('касание плашки не привело на пост ЗЕНИТКА: ' + rd1.at);
  if (!/ЗЕНИТКА/.test(rd1.hint)) fail('во время налёта нет подсказки зенитного поста: ' + rd1.hint);
  if (!rd1.ended || !rd1.hidden) fail('после налёта плашка не убрана');
  if (rd1.ended && /ОТБИТ/.test(rd1.toast) && rd1.ended.bombed) fail('«НАЛЁТ ОТБИТ» при прорвавшихся самолётах: ' + rd1.toast);
  if (rd1.phase === 'playing' && !/НАЛЁТ (ОТБИТ|ОКОНЧЕН): СБИТО \d+, ПРОРВАЛОСЬ \d+/.test(rd1.toast)) fail('нет итога налёта: ' + rd1.toast);
  // конвой доходит до порта → победа, итоги со своими силами, разбор боя с их путями
  const cv = await p.evaluate(async () => {
    const { game } = __arta, s = game.state, { until, sleep } = window.__e2e;
    if (s.phase === 'playing') {
      for (let i = 0; i < 80; i++) game.update(0.1);
      s.friends.filter((f) => f.convoy && f.alive).forEach((f) => { const e = f.path[f.path.length - 1]; f.leg = f.path.length - 1; f.x = e.x - 0.02; f.y = e.y; });
      await until(() => s.phase !== 'playing');
    }
    for (let i = 0; i < 60 && !document.getElementById('dialog').classList.contains('show'); i++) await sleep(100);
    return { phase: s.phase, stats: { ...s.stats }, dialog: document.getElementById('dlgBody').innerText.replace(/\n+/g, ' | ').slice(0, 520), friends: (document.getElementById('resFriends') || {}).innerText || '',
      btns: [...document.querySelectorAll('#dlgBtns .btn')].map((x) => x.textContent) };
  });
  console.log('convoy', JSON.stringify(cv));
  await p.screenshot({ path: shotOf('convoy') });
  if (cv.phase !== 'won' && cv.phase !== 'lost') fail('бой с конвоем не закончился');
  if (!/Конвой/.test(cv.dialog) || !/Попаданий по своим/.test(cv.dialog) || !/Самолётов сбито/.test(cv.dialog) || !/СВОИ СИЛЫ/.test(cv.friends)) fail('в итогах нет конвоя, огня по своим или налёта');
  if (cv.btns.includes('РАЗБОР БОЯ')) {
    await p.click('#dlgBtns .btn:has-text("РАЗБОР БОЯ")');
    const dbf2 = await p.evaluate(() => {
      const c = document.getElementById('dbfCanvas'), o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
      const og = o.getContext('2d', { willReadFrequently: true }); og.drawImage(c, 0, 0);
      const d = og.getImageData(0, 0, c.width, c.height).data; let blue = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 150 && d[i + 1] > 150 && d[i + 2] > 220) blue++;
      return { visible: document.getElementById('debrief').classList.contains('show'), blue, legend: document.getElementById('dbfLegend').innerText, sum: (document.querySelector('#dbfTable .dbf-sum') || {}).innerText || '' };
    });
    console.log('debrief2', JSON.stringify(dbf2));
    await p.screenshot({ path: shotOf('debrief2') });
    if (!dbf2.visible || dbf2.blue < 20 || !/СВОИ/.test(dbf2.legend) || !/СВОИ/.test(dbf2.sum)) fail('в разборе боя нет своих сил');
    await p.click('[data-act=closeDebrief]');
  } else fail('в итогах конвоя нет кнопки «РАЗБОР БОЯ»');
  await p.click('#dlgBtns .btn:has-text("В МЕНЮ")');
  await p.evaluate(() => { __arta.game.save.unlocked = Math.max(window.__unl, 2); });

  await p.evaluate(() => __arta.game.setSetting('hints', 'new'));
  // ---------- 6. «СБРОСИТЬ ПРОГРЕСС»: список потерь, галочка «И НАСТРОЙКИ», удержание красной кнопки ----------
  const holdWipe = async (ms) => { const bx = await p.locator('#wipeHold').boundingBox(); await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2); await p.mouse.down(); await p.waitForTimeout(ms); await p.mouse.up(); };
  const openWipe = async () => { await p.click('[data-act=settings]'); await tab('data'); await p.click('#setWipe'); };
  const progress = () => p.evaluate(() => { const g = __arta.game, sv = g.save; return { stars: (sv.stars || []).reduce((n, v) => n + (v || 0), 0), xp: sv.xp, unlocked: sv.unlocked, records: (sv.records || []).filter(Boolean).length,
    points: g.points(), ups: g.upgrades().reduce((n, u) => n + u.level, 0), resume: !!g.resumeInfo(), surv: sv.survivalBest, daily: sv.daily, sens: g.settings().sens, muted: sv.muted, difficulty: g.state.difficulty }; });
  await fakeIntro();                            // страницу перезагружали — подставной ролик ставим заново
  // готовим прогресс: опыт, улучшение, сохранённый бой, своя настройка и сложность
  await p.evaluate(() => { const g = __arta.game; g.save.xp = Math.max(g.save.xp, 900); g.buyUpgrade('hoist'); g.setSetting('sens', 1.3); g.setDifficulty(1); localStorage.setItem('arta2.tutorial', '1'); });
  await p.click('[data-act=campaign]'); await p.click('.m-card'); await p.click('#dlgBtns .btn');
  await p.waitForFunction(() => __arta.game.state.phase === 'playing');
  await p.click('#hSave'); await p.click('#dlgBtns .btn:has-text("СОХРАНИТЬ И ВЫЙТИ В МЕНЮ")');
  const pr0 = await progress();
  await openWipe();
  const w1 = await p.evaluate(() => ({ head: document.querySelector('#dlgBody h2').textContent, list: [...document.querySelectorAll('#wipeList li')].map((x) => x.textContent), chk: document.getElementById('wipeSettings').innerText.trim(),
    btns: [...document.querySelectorAll('#dlgBtns .btn')].map((x) => x.textContent).join('|') }));
  await p.click('#dlgBtns .btn:has-text("ОТМЕНА")');
  const w1c = await p.evaluate(() => document.getElementById('settings').classList.contains('show'));
  await p.click('#setWipe'); await p.click('#dlgBtns .btn:has-text("ДАЛЬШЕ")');
  const w2 = await p.evaluate(() => ({ head: document.querySelector('#dlgBody h2').textContent, hold: document.getElementById('wipeHold').innerText.trim(), h: document.getElementById('wipeHold').offsetHeight,
    btns: [...document.querySelectorAll('#dlgBtns .btn')].map((x) => x.textContent).join('|') }));
  // короткое нажатие и простой щелчок ничего не стирают
  await holdWipe(500); await p.click('#wipeHold');
  const prShort = await progress(), fillShort = await p.evaluate(() => document.querySelector('#wipeHold i').style.width);
  const played0 = await p.evaluate(() => window.__intro.played);
  await holdWipe(2500);
  await p.waitForFunction(() => document.getElementById('menu').classList.contains('show') && !__arta.shell.introPlaying);
  const pr1 = await progress();
  const m1 = await p.evaluate(() => ({ rank: document.getElementById('rankName').innerText, xp: document.getElementById('rankXp').innerText, resume: !document.getElementById('resumeBox').classList.contains('hidden'),
    badge: document.getElementById('upBadge').classList.contains('show'), dialog: document.getElementById('dialog').classList.contains('show'), settings: document.getElementById('settings').classList.contains('show'),
    phase: __arta.game.state.phase, tut: localStorage.getItem('arta2.tutorial'), news: localStorage.getItem('arta2.news'), intro: { ...window.__intro } }));
  await p.click('[data-act=campaign]');
  const cards = await p.evaluate(() => ({ open: document.querySelectorAll('.m-card:not(.locked)').length, lit: [...document.querySelector('.m-card .st').childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('') }));
  await p.click('#missions [data-act=toMenu]');
  console.log('wipe', JSON.stringify({ pr0, w1, w2, prShort, fillShort, pr1, m1, cards }));
  await p.screenshot({ path: shotOf('wipe') });
  if (pr0.stars < 1 || pr0.xp < 900 || pr0.ups !== 1 || !pr0.resume || pr0.records < 1) fail('перед сбросом нет прогресса для проверки: ' + JSON.stringify(pr0));
  if (w1.head !== 'СБРОСИТЬ ПРОГРЕСС?' || w1.list.length !== 5 || !w1.list[0].includes('звёзды кампании: ' + pr0.stars) || !/опыт: \d+/.test(w1.list[1]) || !/ПРИСТРЕЛКА/i.test(w1.list[4]) || !/И НАСТРОЙКИ/.test(w1.chk) || w1.btns !== 'ОТМЕНА|ДАЛЬШЕ') fail('первый шаг сброса: ' + JSON.stringify(w1));
  if (!w1c) fail('«ОТМЕНА» на первом шаге сброса не вернула в настройки');
  if (!/УДЕРЖИВАЙТЕ/.test(w2.hold) || w2.h < 44 || w2.btns !== 'ОТМЕНА') fail('второй шаг сброса: ' + JSON.stringify(w2));
  if (prShort.xp !== pr0.xp || prShort.stars !== pr0.stars || fillShort !== '0%') fail('короткое нажатие стёрло прогресс или полоса не сбросилась: ' + fillShort);
  if (pr1.stars !== 0 || pr1.xp !== 0 || pr1.unlocked !== 1 || pr1.records !== 0 || pr1.ups !== 0 || pr1.points !== 0 || pr1.resume || pr1.surv || pr1.daily) fail('сброс не стёр прогресс: ' + JSON.stringify(pr1));
  if (pr1.sens !== 1.3 || pr1.difficulty !== 1) fail('сброс без галочки тронул настройки или сложность: ' + JSON.stringify(pr1));
  if (m1.phase !== 'menu' || m1.dialog || m1.settings || m1.resume || m1.badge || !/МАТРОС/.test(m1.rank) || !/^0 \//.test(m1.xp)) fail('после сброса меню не перерисовано с нуля: ' + JSON.stringify(m1));
  if (m1.tut !== null || m1.intro.resets !== 1 || m1.intro.played !== played0 + 1) fail('сброс не очистил отметки интерфейса или не запустил ролик: ' + JSON.stringify(m1));
  if (cards.open !== 1 || cards.lit !== '') fail('после сброса кампания не с начала: ' + JSON.stringify(cards));
  // с галочкой «И НАСТРОЙКИ»: настройки и сложность тоже возвращаются к исходным
  await p.evaluate(() => { __arta.game.save.xp = 300; __arta.game.setSetting('quality', 'low'); });
  await openWipe(); await p.click('#wipeSettings');
  const chkOn = await p.evaluate(() => document.getElementById('wipeSettings').classList.contains('on'));
  await p.click('#dlgBtns .btn:has-text("ДАЛЬШЕ")');
  await holdWipe(2500);
  await p.waitForFunction(() => document.getElementById('menu').classList.contains('show') && !__arta.shell.introPlaying);
  const pr2 = await progress(), q2 = await p.evaluate(() => ({ q: __arta.engine.quality.tier, autoTier: __arta.engine.debug.stats().autoTier, auto: __arta.engine.qualityAuto, set: __arta.game.settings().quality, chosen: __arta.game.settings().qualityChosen, seg: (document.querySelector('#diffSeg button.on') || {}).textContent }));
  console.log('wipe-all', JSON.stringify({ chkOn, pr2, q2 }));
  if (!chkOn || pr2.xp !== 0 || pr2.sens !== 1 || pr2.difficulty !== 0 || q2.q !== q2.autoTier || q2.auto !== true || q2.set !== 'auto' || q2.chosen !== false || q2.seg !== 'КУРСАНТ') fail('сброс с настройками не вернул настройки: ' + JSON.stringify({ pr2, q2 }));

  // ---------- 7. находки проверки: настоящий ролик, двойные касания, прерванные запуск и удержание (чистое хранилище, 740×360) ----------
  {
    const q = await (await b.newContext({ viewport: { width: 740, height: 360 }, hasTouch: true })).newPage();
    q.setDefaultTimeout(120000); humanPace(q);
    q.on('pageerror', (e) => { errs++; console.log('PAGEERROR(7)', e.message); });
    await seedTier(q); await q.addInitScript(() => { window.ArtaNative = { ready() {}, applyUpdate() {} }; });
    const url = 'file://' + WWW;
    const st = () => q.evaluate(() => ({ phase: __arta.game.state.phase, shown: [...document.querySelectorAll('.show')].map((e) => e.id).filter((id) => ['menu', 'settings', 'dialog', 'missions', 'upgrades'].includes(id)),
      intro: __arta.shell.introPlaying, el: !!document.getElementById('arta-intro'), hud: !document.getElementById('hud').classList.contains('hidden'), news: localStorage.getItem('arta2.news') }));
    const center = async (sel) => { const bx = await q.locator(sel).first().boundingBox(); return [bx.x + bx.width / 2, bx.y + bx.height / 2]; };
    // Двойное касание: два касания через gap мс. Время касаний задаём явно и ответа страницы на первое не ждём: touchscreen.tap()
    // возвращается только после обработки нажатия, и на медленном программном рендере «150 мс» растягивались до 0,5 с
    // (второе касание тогда честно попадало в кнопку нового экрана — проверка падала через раз).
    const cdp = await q.context().newCDPSession(q);
    const dtap = async (sel, gap) => {
      await q.waitForFunction(() => !(__arta.shell.tapGuard > 0));
      const [x, y] = await center(sel), t0 = Date.now() / 1000;
      const send = (type, ms) => new Promise((r) => setTimeout(r, ms)).then(() => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }], timestamp: t0 + ms / 1000 }));
      await Promise.all([send('touchStart', 0), send('touchEnd', 30), send('touchStart', gap), send('touchEnd', gap + 30)]);
    };
    const introGone = () => q.waitForFunction(() => !__arta.shell.introPlaying && !document.getElementById('arta-intro'));
    // 7а. первый запуск прерван в первые секунды ролика → при следующем запуске ролик показывается снова
    await q.goto(url); await q.waitForFunction(() => window.__arta && __arta.shell.introPlaying);
    const a0 = await st();
    await q.reload(); await q.waitForFunction(() => window.__arta && __arta.shell);
    const a1 = await st();
    console.log('intro-interrupted', JSON.stringify({ a0, a1 }));
    if (a0.news !== null) fail('новости помечены прочитанными до конца ролика: ' + a0.news);
    if (!a1.intro || !a1.el) fail('после прерванного первого запуска ролик не показан заново: ' + JSON.stringify(a1));
    // 7б. двойное касание «ПРОПУСТИТЬ»: второе касание не проходит к меню под гаснущим роликом
    await dtap('#arta-intro [data-ai=skip]', 120); await introGone();
    const b1 = await st();
    if (b1.shown.join() !== 'menu' || b1.news === null) fail('двойное касание «ПРОПУСТИТЬ» при первом запуске: не чистое меню или новости не помечены: ' + JSON.stringify(b1));
    // 7в. то же при повторном просмотре из настроек: возвращаемся в настройки, «ГОТОВО» ведёт в меню
    await q.evaluate(() => __arta.game.setSetting('text', 1.3));
    await q.click('[data-act=settings]'); await q.click('[data-settab=data]');
    const done = await q.evaluate(() => { const r = document.querySelector('#settings [data-setclose]').getBoundingClientRect(); return { h: r.height, in: r.top >= 0 && r.right <= innerWidth + 0.5 }; });
    if (done.h < 36 || !done.in) fail('кнопка «ГОТОВО» в настройках ниже 36 px или вне экрана: ' + JSON.stringify(done));
    for (const t of ['game', 'ctrl', 'sound', 'screen', 'data']) {
      await q.click('[data-settab=' + t + ']');
      const lat = await q.evaluate(() => (document.querySelector('#setList .set-pane.on').innerText.match(/[A-Za-z]{2,}/g) || []).join(' '));
      if (lat) fail('латиница в тексте вкладки настроек «' + t + '»: ' + lat);
    }
    await q.click('#setIntro'); await q.waitForFunction(() => __arta.shell.introPlaying && document.querySelector('#arta-intro [data-ai=skip]'));
    await q.waitForTimeout(400);
    await dtap('#arta-intro [data-ai=skip]', 120); await introGone();
    const c1 = await st();
    await q.touchscreen.tap(...await center('#settings [data-setclose]')); await q.waitForTimeout(100);
    const c2 = await st(), backOk = await q.evaluate(() => window.onBackButton());
    console.log('intro-replay', JSON.stringify({ done, c1, c2, backOk }));
    if (c1.shown.join() !== 'settings') fail('после ролика из настроек (двойное «ПРОПУСТИТЬ») открыты не настройки: ' + JSON.stringify(c1));
    if (c2.shown.join() !== 'menu' || c2.phase !== 'menu') fail('«ГОТОВО» после ролика из настроек не вывело в меню (пустой экран): ' + JSON.stringify(c2));
    // настройки закрыли, пока ролик шёл (как бывало из-за касания насквозь): «ГОТОВО» всё равно ведёт в меню
    await q.click('[data-act=settings]'); await q.click('#setIntro'); await q.waitForFunction(() => __arta.shell.introPlaying);
    await q.evaluate(() => { __arta.shell.settings.close(); __arta.shell.intro.skip(); }); await introGone();
    await q.click('#settings [data-setclose]');
    const c3 = await st();
    if (c3.shown.join() !== 'menu') fail('настройки, закрытые под роликом: «ГОТОВО» не вывело в меню: ' + JSON.stringify(c3));
    await q.evaluate(() => __arta.game.setSetting('text', 1));
    // 7г. удержание красной кнопки: окно закрыли («Назад») на 0,7 с — прогресс не стирается
    await q.evaluate(() => { __arta.game.save.xp = 500; });
    await q.click('[data-act=settings]'); await q.click('[data-settab=data]'); await q.click('#setWipe'); await q.click('#dlgBtns .btn:has-text("ДАЛЬШЕ")');
    { const [x, y] = await center('#wipeHold'); await q.mouse.move(x, y); await q.mouse.down(); }
    await q.waitForTimeout(700);
    await q.evaluate(() => window.onBackButton());
    const d0 = await st();
    await q.waitForTimeout(2200);
    const d1 = await st(), xp1 = await q.evaluate(() => __arta.game.save.xp);
    await q.mouse.up();
    console.log('wipe-dismissed', JSON.stringify({ d0, d1, xp1 }));
    if (d0.shown.join() !== 'settings') fail('«Назад» во время удержания не вернул в настройки: ' + JSON.stringify(d0));
    if (xp1 !== 500 || d1.intro || d1.shown.join() !== 'settings') fail('прогресс стёрт после закрытия окна во время удержания: xp ' + xp1 + ' ' + JSON.stringify(d1));
    await q.click('#settings [data-setclose]');
    // 7д. бой: пост ОГОНЬ, скорость ×3 → «СОХРАНИТЬ И ВЫЙТИ В МЕНЮ» двойным касанием → меню (не экран под пальцем) → тот же пост и скорость
    await q.click('[data-act=campaign]'); await q.click('.m-card'); await q.click('#dlgBtns .btn');
    await q.waitForFunction(() => __arta.game.state.phase === 'playing' && __arta.engine.current === 'plot');
    await q.evaluate(() => { __arta.engine.gotoStation('fire', { instant: true }); __arta.game.setSpeed(3); });
    await q.waitForFunction(() => __arta.engine.current === 'fire' && __arta.game.state.station === 'fire');
    await q.click('#hSave'); await q.waitForTimeout(400);
    // программный рендер рисует кадр по 100–300 мс: второе касание доходит до страницы с опозданием — как на слабом телефоне.
    // Для верности первое нажатие ещё и задерживаем на 450 мс: защита считает по времени касания, а не по времени обработки.
    await q.evaluate(() => document.addEventListener('click', () => { if (!window.__stalled) { window.__stalled = 1; const t = performance.now(); while (performance.now() - t < 450); } }, { once: true }));
    await dtap('#dlgBtns .btn.primary', 150); await q.waitForTimeout(250);
    const e1 = await st();
    if (e1.shown.join() !== 'menu' || e1.phase !== 'menu') { fail('двойное касание «СОХРАНИТЬ И ВЫЙТИ В МЕНЮ» открыло экран под пальцем: ' + JSON.stringify(e1)); await q.evaluate(() => __arta.shell.showMenu()); }
    await q.evaluate(() => __arta.engine.gotoStation('plot', { instant: true }));
    await q.waitForTimeout(200);
    await q.click('#resumeBtn');
    await q.waitForFunction(() => __arta.game.state.phase === 'playing' && !document.getElementById('hud').classList.contains('hidden'));
    await q.waitForTimeout(200);
    const e2 = await q.evaluate(() => ({ station: __arta.engine.current, saved: __arta.game.state.station, speed: __arta.game.state.speed, tab: (document.querySelector('#nav button.on') || {}).dataset }));
    console.log('save-dtap-resume', JSON.stringify({ e1, e2 }));
    if (e2.station !== 'fire' || e2.saved !== 'fire' || e2.speed !== 3) fail('«ПРОДОЛЖИТЬ БОЙ» вернуло не на тот пост или не с той скоростью: ' + JSON.stringify(e2));
    // новый бой после продолженного — снова с планшета и со скоростью из настроек
    await q.evaluate(() => { const g = __arta.game; g.quit(); g.startMission(0); g.begin(); });
    const e3 = await q.evaluate(() => ({ station: __arta.engine.current, speed: __arta.game.state.speed }));
    if (e3.station !== 'plot' || e3.speed !== 1) fail('новый бой начался не с планшета или не со скоростью по умолчанию: ' + JSON.stringify(e3));
    // 7е. счётчик кадров: в бою — слева внизу над полосой постов и ничего не перехватывает; под окном настроек не лежит поверх органов; в меню не виден
    await q.evaluate(() => __arta.game.setSetting('showFps', true));
    const fpsBox = () => q.evaluate(() => { const fm = document.getElementById('fpsMeter'), r = fm.getBoundingClientRect(), nav = document.getElementById('bottombar').getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { w: r.width, x: r.left, r: r.right, b: r.bottom, navTop: nav.top, pe: getComputedStyle(fm).pointerEvents, text: fm.textContent, onTop: !!top && top.id === 'fpsMeter', under: top ? top.id || top.className : null }; });
    const f1 = await fpsBox();
    if (!(f1.w > 0) || !/^\d+ К\/С$/.test(f1.text) || f1.x > 40 || f1.b > f1.navTop + 0.5 || f1.navTop - f1.b > 12 || f1.pe !== 'none') fail('счётчик кадров в бою не слева внизу над полосой постов: ' + JSON.stringify(f1));
    await q.evaluate(() => __arta.engine.gotoStation('fire', { instant: true }));
    await q.waitForFunction(() => document.getElementById('hud').dataset.st === 'fire');
    const f1f = await fpsBox();
    if (!(f1f.w > 0) || f1f.r < 700 || f1f.b > f1f.navTop + 0.5) fail('счётчик кадров на посту ОГОНЬ не справа внизу (слева — неисправности): ' + JSON.stringify(f1f));
    await q.evaluate(() => __arta.shell.settings.open(null, { battle: true, tab: 'screen' }));
    const f2 = await q.evaluate(() => { const fm = document.getElementById('fpsMeter'), r = fm.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { shown: document.getElementById('settings').classList.contains('show'), covered: !!top && !!top.closest('#settings') }; });
    if (!f2.shown || !f2.covered) fail('счётчик кадров лежит поверх экрана настроек: ' + JSON.stringify(f2));
    await q.evaluate(() => { __arta.shell.settings.close(); __arta.game.quit(); });
    await q.waitForFunction(() => document.getElementById('menu').classList.contains('show'));
    const f3 = await q.evaluate(() => document.getElementById('fpsMeter').offsetWidth);
    if (f3 !== 0) fail('счётчик кадров виден в меню: ' + f3);
    await q.evaluate(() => __arta.game.setSetting('showFps', false));
    console.log('fps-meter', JSON.stringify({ f1, f1f, f2, f3 }));
    await q.close();
  }

  // ---------- 8. подсказки: по шагам в первых трёх заданиях, дальше — только «НОВОЕ»; засечка батареи ----------
  {
    const r = await (await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true })).newPage();
    r.setDefaultTimeout(120000); humanPace(r);
    r.on('pageerror', (e) => { errs++; console.log('PAGEERROR(8)', e.message); });
    r.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { errs++; console.log('CONSOLE(8)', m.text()); } });
    // игрок с открытой кампанией, который ещё ничего не изучил (xp > 0 — ролик не показывается)
    await seedTier(r); await r.addInitScript(() => { window.ArtaNative = { ready() {}, applyUpdate() {} }; if (!localStorage.getItem('arta2.save')) localStorage.setItem('arta2.save', JSON.stringify({ unlocked: 36, stars: [], xp: 10, learned: {} })); });
    await r.goto('file://' + WWW);
    await r.waitForFunction(() => window.__arta && __arta.shell);
    if (await r.isVisible('#dialog.show')) await r.click('#dlgBtns .btn');
    const hud = () => r.evaluate(() => { const g = __arta.game, hl = document.getElementById('highlight'), tp = document.getElementById('radio'), nx = document.querySelector('#nav button.next'), dc = document.getElementById('detChip');
      return { hint: document.getElementById('hint').textContent, cls: document.getElementById('hint').className, ring: hl.style.display === 'block', next: nx ? nx.dataset.station : null,
        topic: /show/.test(tp.className) && /topic/.test(tp.className) ? tp.textContent : '', mode: g.hintMode(), kind: g.hint().kind, id: g.hint().id, time: g.state.time, learned: Object.keys(g.save.learned).sort().join(), det: dc.offsetWidth > 0 ? dc.textContent : '', detCls: dc.className }; });
    const startMission = async (i) => { await r.evaluate((n) => __arta.game.startMission(n), i); await r.waitForSelector('#dialog.show'); };
    // 8а. задание 1: в инструктаже — строка о засечке и нет блока «НОВОЕ»; в бою — шаги, вкладка поста, кольцо
    await startMission(0);
    const b1 = await r.evaluate(() => ({ text: document.getElementById('dlgBody').innerText, box: !!document.getElementById('briefNew') }));
    if (b1.box || !/после вашего первого выстрела/.test(b1.text)) fail('инструктаж задания 1: нет строки о засечке или лишний блок «НОВОЕ»: ' + JSON.stringify(b1).slice(0, 300));
    await r.click('#dlgBtns .btn');
    await r.waitForFunction(() => document.getElementById('hint').textContent !== '' && document.getElementById('highlight').style.display === 'block' && document.querySelector('#nav button.next'), null, { polling: 100, timeout: 60000 }).catch(() => fail('задание 1: нет пошаговой подсказки с кольцом'));
    const h1 = await hud();
    if (h1.mode !== 'steps' || h1.kind !== 'step' || /НОВОЕ/.test(h1.hint) || !/ПЛАНШЕТ/.test(h1.hint) || h1.next !== 'plot' || h1.topic || /topic/.test(h1.cls) || h1.det) fail('задание 1: подсказки не по шагам: ' + JSON.stringify(h1));
    await r.evaluate(() => __arta.game.quit());
    // 8б. задание 4: блок «НОВОЕ В ЭТОМ ЗАДАНИИ»; в бою пусто, пока разведка молчит; потом «НОВОЕ ·»
    await startMission(3);
    const b4 = await r.evaluate(() => { const el = document.getElementById('briefNew'); return el ? { head: el.querySelector('h3').textContent, items: [...el.querySelectorAll('li')].map((x) => x.textContent) } : null; });
    if (!b4 || b4.head !== 'НОВОЕ В ЭТОМ ЗАДАНИИ' || !b4.items.some((t) => /^ДВИЖУЩАЯСЯ ЦЕЛЬ — .+\.$/.test(t)) || !b4.items.some((t) => /^ПОПРАВКА НА ВЕТЕР — /.test(t)) || b4.items.length > 7) fail('инструктаж задания 4: блок «НОВОЕ В ЭТОМ ЗАДАНИИ»: ' + JSON.stringify(b4));
    await r.screenshot({ path: shotOf('brief-new') });
    await r.evaluate(() => { const g = __arta.game; g.begin(); g.pause(true); });
    await r.waitForFunction(() => !document.getElementById('hud').classList.contains('hidden'));
    // обвязка перерисовывается по кадрам, а программный WebGL бывает медленнее кадра в секунду: ждём перерисовки, а не 0,6 с
    await r.waitForFunction(() => document.getElementById('hint').textContent === '' && !document.querySelector('#nav button.next'), null, { polling: 100, timeout: 20000 }).catch(() => {});
    await r.waitForTimeout(300);
    const h4a = await hud();
    if (h4a.mode !== 'topics' || h4a.hint !== '' || h4a.ring || h4a.next || h4a.topic || h4a.kind !== null || h4a.time > 3 || h4a.det) fail('задание 4: до появления нового подсказок быть не должно: ' + JSON.stringify(h4a));
    await r.evaluate(() => __arta.game.pause(false));
    await r.waitForFunction(() => /^НОВОЕ · /.test(document.getElementById('hint').textContent) && /show topic/.test(document.getElementById('radio').className) && document.getElementById('highlight').style.display === 'block', null, { polling: 100, timeout: 90000 }).catch(() => fail('задание 4: подсказка «НОВОЕ ·» не появилась'));
    const h4b = await hud();
    // строка радио выезжает на место за 0,25 с (transform) — меряем, когда она встала
    const settled = () => r.waitForFunction(() => { const el = document.getElementById('radio'), cs = getComputedStyle(el); return +cs.opacity > 0.99 && new DOMMatrix(cs.transform).m42 === 0; }, null, { polling: 100, timeout: 15000 }).catch(() => fail('строка радио не встала на место'));
    await settled();
    const box = await r.evaluate(() => { const t = document.getElementById('radio').getBoundingClientRect(), nav = document.getElementById('bottombar').getBoundingClientRect(), top = document.getElementById('topbar').getBoundingClientRect();
      return { l: t.left, r: t.right, t: t.top, b: t.bottom, navTop: nav.top, topBottom: top.bottom, w: innerWidth, pe: getComputedStyle(document.getElementById('radio')).pointerEvents }; });
    if (h4b.hint !== 'НОВОЕ · ДВИЖУЩАЯСЯ ЦЕЛЬ' || !/topic/.test(h4b.cls) || !/упреждени/.test(h4b.topic) || h4b.next !== 'plot' || h4b.id !== 'lead' || /lead/.test(h4b.learned)) fail('задание 4: тема о движущейся цели: ' + JSON.stringify(h4b));
    if (box.l < 0 || box.r > box.w || box.b > box.navTop + 0.5 || box.t < box.topBottom || box.b - box.t > 70 || box.pe !== 'none') fail('объяснение темы (строка радио) не помещается или перехватывает касания: ' + JSON.stringify(box));
    await r.screenshot({ path: shotOf('topic') });
    // действие игрока (замер) — тема гаснет и считается изученной; следующая по очереди — «ЦЕЛЬ УХОДИТ», её убирает касание
    await r.evaluate(() => { const g = __arta.game; g.setAlidade({ bearing: 5, range: 9 }); g.recordMeasurement(); });
    await r.waitForFunction(() => __arta.game.save.learned.lead === true && document.getElementById('hint').textContent !== 'НОВОЕ · ДВИЖУЩАЯСЯ ЦЕЛЬ', null, { polling: 100, timeout: 30000 }).catch(() => fail('тема не погасла после действия игрока'));
    await r.waitForFunction(() => document.getElementById('hint').textContent === 'НОВОЕ · ЦЕЛЬ УХОДИТ', null, { polling: 100, timeout: 30000 }).catch(() => fail('следующая тема очереди не показана'));
    await r.waitForFunction(() => document.getElementById('highlight').style.display !== 'block', null, { polling: 100, timeout: 30000 }).catch(() => fail('у темы без органа управления осталось кольцо'));
    const h4c = await hud();
    // объяснение ушло со строки радио — касание строки «НОВОЕ · …» внизу показывает его снова
    await r.evaluate(() => { document.getElementById('radio').className = ''; });
    await r.click('#hint');
    const again = await hud();
    if (!/^НОВОЕ · ЦЕЛЬ УХОДИТ.*выйдет из зоны огня/.test(again.topic)) fail('касание строки «НОВОЕ» не показало объяснение: ' + JSON.stringify(again));
    // тема убрана (как по истечении времени) — подсказок больше нет
    await r.evaluate(() => __arta.game.dismissTopic());
    await r.waitForFunction(() => document.getElementById('hint').textContent === '' && !document.querySelector('#hint.topic'), null, { polling: 100, timeout: 30000 }).catch(() => fail('убранная тема осталась на экране'));
    const h4d = await hud();
    if (h4c.ring || h4c.id !== 'escape' || !/escape/.test(h4d.learned) || !/lead/.test(h4d.learned) || h4d.kind !== null || h4d.ring || h4d.next) fail('после изученных тем подсказок быть не должно: ' + JSON.stringify({ h4c, h4d }));
    if (JSON.parse(await r.evaluate(() => localStorage.getItem('arta2.save'))).learned.lead !== true) fail('изученная тема не записана в сохранение');
    // 8в. «ПО ШАГАМ» возвращает шаги и в задании 4; «ВЫКЛ» прячет всё
    await r.evaluate(() => __arta.game.setSetting('hints', 'all'));
    await r.waitForFunction(() => /^[А-ЯЁ]+: /.test(document.getElementById('hint').textContent) && document.querySelector('#nav button.next'), null, { polling: 100, timeout: 30000 }).catch(() => fail('«ПО ШАГАМ» не вернуло пошаговые подсказки'));
    const hAll = await hud();
    await r.evaluate(() => __arta.game.setSetting('hints', 'off'));
    await r.waitForFunction(() => document.getElementById('hint').textContent === '' && !document.querySelector('#nav button.next') && document.getElementById('highlight').style.display !== 'block', null, { polling: 100, timeout: 30000 }).catch(() => fail('«ВЫКЛ» не спрятало подсказки'));
    const hOff = await hud();
    if (hAll.kind !== 'step' || /НОВОЕ/.test(hAll.hint) || hAll.topic || hOff.kind !== null || hOff.mode !== 'off') fail('режимы подсказок: ' + JSON.stringify({ hAll, hOff }));
    // настройка на экране: три положения, «ВЫКЛ» отмечено
    await r.evaluate(() => { __arta.game.pause(true); __arta.shell.settings.open(null, { battle: true, tab: 'game' }); });
    const seg = await r.evaluate(() => [...document.querySelectorAll('#setHints button')].map((x) => x.textContent + (x.classList.contains('on') ? '*' : '')));
    if (seg.join() !== 'НОВОЕ,ПО ШАГАМ,ВЫКЛ*') fail('настройка «ПОДСКАЗКИ»: ' + seg.join());
    await r.click('#setHints [data-val="new"]');
    await r.evaluate(() => { __arta.shell.settings.close(); __arta.game.pause(false); });
    if (await r.evaluate(() => __arta.game.settings().hints) !== 'new') fail('настройка «ПОДСКАЗКИ» не переключилась на «НОВОЕ»');
    // в задании 1 и «ВЫКЛ» ничего не показывает
    await r.evaluate(() => { const g = __arta.game; g.quit(); g.setSetting('hints', 'off'); g.startMission(0); g.begin(); });
    await r.waitForFunction(() => __arta.game.state.time > 5);
    await r.waitForTimeout(400);
    const hOff1 = await hud();
    if (hOff1.hint !== '' || hOff1.ring || hOff1.next) fail('«ВЫКЛ»: в задании 1 подсказки остались: ' + JSON.stringify(hOff1));
    await r.evaluate(() => { const g = __arta.game; g.quit(); g.setSetting('hints', 'new'); });
    // 8г. у каждой темы пост и орган управления (или элемент обвязки) существуют на самом деле
    const missing = await r.evaluate(() => { const { game, engine } = __arta, bad = [];
      for (const t of game.TOPICS) {
        const st = t.station ? engine.stations.find((x) => x.id === t.station) : null;
        if (t.station && !st) bad.push(t.id + ': нет поста ' + t.station);
        for (const h of t.hot) if (!st || !st.hotspots || !st.hotspots[h]) bad.push(t.id + ': нет органа ' + h);
        if (t.dom && !document.getElementById(t.dom)) bad.push(t.id + ': нет элемента #' + t.dom);
      }
      return bad; });
    if (missing.length) fail('темы подсказок указывают на несуществующее: ' + missing.join('; '));
    // 8д. засечка: задание 3 «Бетон» идёт по шагам; плашка «НАС НЕ ВИДЯТ» → выстрел → «ЗАСЕЧЕНЫ», строка и запись в блокноте
    await r.evaluate(() => { const g = __arta.game; g.startMission(2); g.begin(); });
    await r.waitForFunction(() => document.getElementById('detChip').offsetWidth > 0, null, { polling: 100, timeout: 60000 }).catch(() => fail('нет плашки «НАС НЕ ВИДЯТ»'));
    const d0 = await hud();
    await r.click('[data-act=notebook]');
    const nb0 = await r.innerText('#nbBattery'); await r.click('[data-act=closeNotebook]');
    if (d0.det !== 'НАС НЕ ВИДЯТ' || d0.detCls !== 'calm' || d0.kind !== 'step' || !/нас не видит/.test(nb0)) fail('до выстрела: ' + JSON.stringify(d0) + ' / ' + nb0.slice(0, 200));
    const shot1 = await r.evaluate(async () => {
      const g = __arta.game, s = g.state, sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const until = async (f) => { for (let i = 0; i < 3000 && !f(); i++) { g.update(0.1); await sleep(0); } return f(); };
      const ev = []; g.on('detected', (e) => ev.push(e)); window.__det = ev;
      s.targets.forEach((t) => { if (t.gun) t.gun.next = s.time + 500; });
      g.elevate(-s.turret.elevation); g.openBreech(); await until(() => !s.breech.busy); g.hoistShell('he'); await until(() => !s.breech.busy);
      g.ramShell(); await until(() => !s.breech.busy); g.addCharge(); await until(() => !s.breech.busy); g.closeBreech(); await until(() => !s.breech.busy);
      g.elevate(20); g.setBrake(true); g.arm(true);
      const f = g.fire(), before = s.detected;
      await until(() => s.detected);
      return { fired: f.ok, before, detected: s.detected, events: ev.length, integrity: s.integrity, radio: s.radio.some((m) => /засёк батарею по вспышке/.test(m.text)), toast: document.getElementById('toast').textContent };
    });
    await r.waitForFunction(() => document.getElementById('detChip').textContent === 'ЗАСЕЧЕНЫ', null, { polling: 100, timeout: 30000 }).catch(() => fail('плашка не сменилась на «ЗАСЕЧЕНЫ»'));
    const d1 = await hud();
    await r.click('[data-act=notebook]');
    const nb1 = await r.innerText('#nbBattery'); await r.click('[data-act=closeNotebook]');
    if (!shot1.fired || shot1.before || !shot1.detected || shot1.events !== 1 || shot1.integrity !== 100 || !shot1.radio || !/ЗАСЁК БАТАРЕЮ/.test(shot1.toast) || !/det/.test(d1.detCls) || !/засёк батарею в \d\d:\d\d/.test(nb1)) fail('засечка: ' + JSON.stringify({ shot1, d1 }) + ' / ' + nb1.slice(0, 200));
    // 8е. значок засечки постоянный, поэтому проверяется пересечением прямоугольников (у него pointer-events: none, и
    // elementFromPoint из раздела 5 его не видит): все 8 постов × 640/740/844 px × надписи 1 и 1.3 × правша/левша × оба состояния.
    // Положение органов на экране зависит только от поста и размера экрана, прямоугольник значка — только от настроек, поэтому
    // посты обходим один раз на размер (программный WebGL медленный), а пары «орган × прямоугольник» перебираем все.
    // Заодно — другие видимые элементы обвязки, не ловящие касания и лежащие над постами (кроме строки радио и всплывающих).
    const geo = []; let geoN = 0;
    // разрыв позади — засечку больше ничто не меняет (часы боя двигаем сами: на медленном программном WebGL они отстают от настоящих)
    await r.evaluate(async () => { const g = __arta.game, s = g.state; for (let i = 0; i < 3000 && (s.flight.length || s.reportDue != null) && s.phase === 'playing'; i++) { g.update(0.1); if (i % 40 === 0) await new Promise((res) => setTimeout(res, 0)); } });
    if (await r.evaluate(() => { const s = __arta.game.state; return s.phase !== 'playing' || s.flight.length > 0; })) fail('задание 3: снаряд не долетел или бой окончен');
    for (const [w, hgt] of [[640, 360], [740, 360], [844, 390]]) {
      await r.setViewportSize({ width: w, height: hgt });
      const g1 = await r.evaluate(async (w) => {
        const { engine, game } = __arta, s = game.state, V = new engine.THREE.Vector3(), hudEl = document.getElementById('hud'), dc = document.getElementById('detChip'), bad = [];
        const wait = (fn, ms = 15000) => new Promise((res) => { const t0 = Date.now(); (function f() { if (fn() || Date.now() - t0 > ms) res(!!fn()); else setTimeout(f, 40); })(); });
        const frame = () => new Promise((res) => requestAnimationFrame(() => res()));
        const inside = (q, x, y) => x > q.left - 4 && x < q.right + 4 && y > q.top - 4 && y < q.bottom + 4;
        s.targets.forEach((t) => { if (t.gun) t.gun.next = s.time + 900; });
        game.setSetting('text', 1); game.setSetting('lefty', false);
        const pts = [];
        for (const id of ['plot', 'computer', 'loading', 'traverse', 'elevation', 'fire', 'observe', 'aa']) {
          engine.gotoStation(id, { instant: true }); await wait(() => hudEl.dataset.st === id && !engine.flying); await frame();
          const st = engine.stations.find((x) => x.id === id); let k0 = pts.length;
          for (const k of Object.keys(st.hotspots || {})) {
            const o = st.hotspots[k]; if (!o || !o.getWorldPosition) continue;
            o.getWorldPosition(V); const sc = engine.input.toScreen(V, {});
            if (!sc.behind && sc.x >= 0 && sc.y >= 0 && sc.x <= innerWidth && sc.y <= innerHeight) pts.push([id + '.' + k, sc.x, sc.y]);
          }
          if (pts.length - k0 < 4) bad.push(w + ' ' + id + ': органов на экране ' + (pts.length - k0));
          for (const el of hudEl.querySelectorAll('#rstack > *, #rcol > *, #faults > *, #raidBanner')) {
            const q = el.getBoundingClientRect(), cs = getComputedStyle(el);
            if (q.width > 0 && q.height > 0 && cs.pointerEvents === 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0 && !['crew', 'convoyChip'].includes(el.id))
              for (let i = k0; i < pts.length; i++) if (inside(q, pts[i][1], pts[i][2])) bad.push(w + ': ' + pts[i][0] + ' под #' + (el.id || el.className));
          }
        }
        let n = 0;
        for (const text of [1, 1.3]) for (const lefty of [false, true]) for (const det of [false, true]) {
          game.setSetting('text', text); game.setSetting('lefty', lefty);
          s.detected = det; s.detectedAt = s.detectTold = det ? s.time - 20 : null;
          const okc = await wait(() => dc.className === (det ? 'det' : 'calm') && document.body.classList.contains('lefty') === lefty);
          const tag = w + ' т' + text + (lefty ? ' левша' : '') + (det ? ' засечены' : ' не видят');
          const c = dc.getBoundingClientRect(), tb = document.getElementById('topbar').getBoundingClientRect();
          if (!okc || !(c.width >= 10 && c.height >= 8)) { bad.push(tag + ': значка засечки нет'); continue; }
          if (c.top < tb.top || c.bottom > tb.bottom || c.left < 0 || c.right > innerWidth) bad.push(tag + ': значок вне верхней панели ' + [c.left, c.top, c.right, c.bottom].map(Math.round));
          const cell = dc.closest('.tb-cell').getBoundingClientRect(), bar = dc.parentNode.querySelector('.bar').getBoundingClientRect();
          if (c.left < cell.left || c.right > cell.right || bar.width < 30) bad.push(tag + ': значок не помещается в ячейке «ПРОЧНОСТЬ» (полоса ' + Math.round(bar.width) + ' px)');
          for (const [k, x, y] of pts) { n++; if (inside(c, x, y)) bad.push(tag + ': ' + k + ' под значком засечки'); }
        }
        game.setSetting('text', 1); game.setSetting('lefty', false); s.detected = true; s.detectedAt = s.detectTold = s.time - 20;
        return { bad, n, pts: pts.length };
      }, w);
      geo.push(...g1.bad); geoN += g1.n;
      if (g1.n !== g1.pts * 8 || g1.pts < 40) geo.push(w + ': проверено пар ' + g1.n + ' при ' + g1.pts + ' органах');
    }
    await r.setViewportSize({ width: 844, height: 390 });
    if (geo.length) fail('значок засечки / несенсорные элементы HUD закрывают органы постов: ' + geo.slice(0, 12).join('; ') + (geo.length > 12 ? ' … всего ' + geo.length : ''));
    // 8ж. оборона: батарею засекли, пока стрелять по ней было некому — с первой вооружённой волной приходит строка штаба,
    // всплывающая строка и мигающий значок (а не молча «ЗАСЕЧЕНЫ»)
    const late = await r.evaluate(async () => {
      const g = __arta.game, s = g.state, sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      g.quit(); g.startSurvival(); g.begin();
      const ev = []; g.on('detected', (e) => ev.push(e));
      for (let i = 0; i < 100; i++) g.update(0.1);
      s.targets.forEach((t) => { t.gun = null; });
      s.detected = true; s.detectedAt = s.time; s.detectTold = null;         // как после выстрела в волне без орудий
      g.update(0.1);
      for (let i = 0; i < 300 && document.getElementById('detChip').className !== 'hidden'; i++) await sleep(50);      // ждём кадра перерисовки
      const quiet = { chip: document.getElementById('detChip').className, radio: s.radio.some((m) => /засёк|засечена/.test(m.text)) };
      for (let w = 0; w < 8 && s.detectTold == null && s.phase === 'playing'; w++) {
        s.integrity = 100; s.targets.forEach((q) => { q.alive = false; q.sinking = { since: s.time, dur: 18 }; if (q.gun) q.gun.next = s.time + 900; });
        const was = s.wave; for (let i = 0; i < 400 && s.wave === was; i++) g.update(0.1);
        s.targets.forEach((q) => { if (q.gun) q.gun.next = s.time + 900; });
      }
      for (let i = 0; i < 120 && document.getElementById('detChip').className !== 'det fresh'; i++) await sleep(50);   // мигает 8 с — кадр успеет
      return { quiet, wave: s.wave, told: s.detectTold != null, events: ev.map((e) => !!e.late), radio: s.radio.filter((m) => /Батарея давно засечена/.test(m.text)).length,
        toast: document.getElementById('toast').textContent, chip: document.getElementById('detChip').className };
    });
    if (late.quiet.chip !== 'hidden' || late.quiet.radio || !late.told || late.radio !== 1 || late.events.join() !== 'true' || !/БАТАРЕЯ ЗАСЕЧЕНА/.test(late.toast) || late.chip !== 'det fresh') fail('оборона: о давней засечке не сообщили с первой вооружённой волной: ' + JSON.stringify(late));
    // 8з. пост ОГОНЬ, 740×360, левша, самые крупные надписи: объяснение темы не лежит на спуске, «ВИЛКЕ», «ОЧЕРЕДИ» и крышке цепи;
    // зона касания строки «НОВОЕ · …» не ниже 36 px, касание над строкой показывает объяснение; вытесненное донесением — возвращается
    await r.setViewportSize({ width: 740, height: 360 });
    await r.evaluate(() => { const g = __arta.game; g.quit(); for (const t of g.TOPICS) if (t.id !== 'burst') g.learnTopic(t.id); g.setSetting('text', 1.3); g.setSetting('lefty', true); g.startMission(3); g.begin(); __arta.engine.gotoStation('fire', { instant: true }); });
    await r.waitForFunction(() => { const g = __arta.game, s = g.state, t = s.targets.find((x) => x.alive && x.reported); g.update(0.1); if (!t) return false; if (!s.activeTarget) g.selectTarget(t.id);
      s.lastReport = { targetId: s.activeTarget, over: 60, right: -40, text: 'x', time: s.time, observed: true };
      return s.topic && s.topic.id === 'burst' && document.getElementById('hud').dataset.st === 'fire' && /show topic/.test(document.getElementById('radio').className) && document.getElementById('info').classList.contains('hastopic'); }, null, { polling: 100, timeout: 120000 }).catch(() => fail('тема «ОЧЕРЕДЬ» на посту ОГОНЬ не показана'));
    await settled();
    const fireBox = () => r.evaluate(() => { const { engine } = __arta, rd = document.getElementById('radio'), q = rd.getBoundingClientRect(), st = engine.stations.find((x) => x.id === 'fire'), V = new engine.THREE.Vector3(), cov = [];
      const zs = getComputedStyle(document.getElementById('info'), '::after'), hint = document.getElementById('hint').getBoundingClientRect(), bb = document.getElementById('bottombar').getBoundingClientRect();
      const zone = { l: bb.left + parseFloat(zs.left), t: bb.top + parseFloat(zs.top), w: parseFloat(zs.width), h: parseFloat(zs.height) };
      for (const k of ['fireLever', 'burstSelector', 'bracketToggle', 'armCover', 'armToggle']) { const o = st.hotspots[k]; o.getWorldPosition(V); const sc = engine.input.toScreen(V, {});
        if (sc.x > q.left - 4 && sc.x < q.right + 4 && sc.y > q.top - 4 && sc.y < q.bottom + 4) cov.push(k + ' под объяснением');
        if (sc.x > zone.l - 4 && sc.x < zone.l + zone.w + 4 && sc.y > zone.t - 4 && sc.y < zone.t + zone.h + 4) cov.push(k + ' под зоной касания'); }
      return { cls: rd.className, text: rd.textContent.slice(0, 40), box: [q.left, q.top, q.right, q.bottom].map(Math.round), top: document.getElementById('topbar').getBoundingClientRect().bottom, navTop: bb.top, w: innerWidth, cov,
        zone, hint: { l: hint.left, t: hint.top, r: hint.right, b: hint.bottom }, crew: Math.round(document.getElementById('rcol').getBoundingClientRect().right) }; });
    const fb = await fireBox();
    if (!/show topic/.test(fb.cls) || fb.cov.length || fb.box[0] < fb.crew || fb.box[2] > fb.w / 2 || fb.box[1] < fb.top || fb.box[3] > fb.navTop) fail('левша, пост ОГОНЬ: объяснение темы закрывает органы или не помещается: ' + JSON.stringify(fb));
    if (!(fb.zone.h >= 36) || fb.zone.l > fb.hint.l + 1 || fb.zone.l + fb.zone.w < fb.hint.r - 1 || fb.zone.t > fb.hint.t - 12 || fb.zone.t + fb.zone.h < fb.hint.b) fail('зона касания строки «НОВОЕ · …» мала или не накрывает строку: ' + JSON.stringify({ zone: fb.zone, hint: fb.hint }));
    await r.screenshot({ path: shotOf('topic-fire-lefty') });
    await r.evaluate(() => { document.getElementById('radio').className = ''; });
    await r.touchscreen.tap((fb.hint.l + fb.hint.r) / 2, fb.hint.t - 11);          // на 11 px выше самой строки
    await r.waitForFunction(() => /show topic/.test(document.getElementById('radio').className), null, { polling: 100, timeout: 5000 }).catch(() => fail('касание над строкой «НОВОЕ · …» не показало объяснение'));
    const st0 = await r.evaluate(() => __arta.engine.current);
    await r.touchscreen.tap((fb.hint.l + fb.hint.r) / 2, fb.hint.b + 12);           // ниже зоны — вкладка поста, как и раньше
    await r.waitForFunction((was) => __arta.engine.current !== was, st0, { polling: 100, timeout: 8000 }).catch(() => fail('касание под строкой «НОВОЕ · …» не дошло до вкладки поста'));
    // донесение сразу после показа: объяснение вытеснено (на экране было < 5 с) и возвращается, когда эфир освободится
    await r.evaluate(() => { __arta.engine.gotoStation('fire', { instant: true }); document.getElementById('hint').click(); });
    await r.waitForFunction(() => /show topic/.test(document.getElementById('radio').className));
    await r.evaluate(() => __arta.game.scopeMark());
    const pre = await r.evaluate(() => document.getElementById('radio').className + '|' + document.getElementById('radio').textContent.slice(0, 30));
    await r.waitForFunction(() => /show topic/.test(document.getElementById('radio').className) && /ОЧЕРЕДЬ/.test(document.getElementById('radio').textContent), null, { polling: 100, timeout: 20000 }).catch(() => fail('объяснение темы, вытесненное донесением, не вернулось'));
    if (/topic/.test(pre) || !/РАСЧЁТ/.test(pre)) fail('донесение не сменило объяснение темы: ' + pre);
    // правша на том же экране: объяснение слева, органы открыты
    await r.evaluate(() => { __arta.game.setSetting('lefty', false); document.getElementById('hint').click(); });
    await r.waitForFunction(() => !document.body.classList.contains('lefty') && /show topic/.test(document.getElementById('radio').className));
    await r.waitForFunction(() => document.getElementById('radio').getBoundingClientRect().left < innerWidth / 4);
    await settled();
    const fbR = await fireBox();
    if (fbR.cov.length || fbR.box[2] > fbR.w / 2 || fbR.box[3] > fbR.navTop || !(fbR.zone.h >= 36) || fbR.zone.l + fbR.zone.w < fbR.hint.r - 1) fail('правша, пост ОГОНЬ: объяснение темы или зона касания: ' + JSON.stringify(fbR));
    // 8и. инструктаж последнего задания: строки «НОВОЕ» — что это и что делать, а не «уже случилось»; тема только для «Командира» — только на нём
    await r.evaluate(() => { const g = __arta.game; g.quit(); g.setSetting('text', 1); g.resetLearned(); g.setDifficulty(0); g.startMission(35); });
    await r.waitForSelector('#briefNew');
    const b36 = await r.evaluate(() => [...document.querySelectorAll('#briefNew li')].map((x) => x.textContent));
    const b9 = await r.evaluate(() => { const g = __arta.game, out = {}; for (const d of [0, 1]) { g.quit(); g.setDifficulty(d); g.startMission(8); out[d] = g.briefTopics().map((x) => x.id); } g.quit(); g.setDifficulty(0); return out; });
    if (b36.some((t) => /Отказал узел башни\.|Охотник бьёт по транспорту\.|Противник увидел вспышку|Точка прицеливания ближе 400 м от своего корабля\.$/.test(t)) || !b36.some((t) => /^ПОВРЕЖДЕНИЕ БАШНИ — Попадания могут вывести из строя/.test(t)))
      fail('инструктаж задания 36: строки «НОВОЕ» читаются как свершившийся факт: ' + JSON.stringify(b36));
    if (b9[0].includes('soundManual') || !b9[0].includes('sound') || !b9[1].includes('soundManual')) fail('тема «ЛИНИИ ПЕЛЕНГОВ ВРУЧНУЮ» в инструктаже не по сложности: ' + JSON.stringify(b9));
    await r.setViewportSize({ width: 844, height: 390 });
    console.log('review', JSON.stringify({ geo: geo.length, geoPairs: geoN, late, fire: fb.box, fireR: fbR.box, zone: fb.zone, b36: b36.slice(0, 3) }));
    console.log('hints', JSON.stringify({ h1: h1.hint, h4a: h4a.hint, h4b: h4b.hint, box, h4d: h4d.learned, hAll: hAll.hint, seg, d0: d0.det, d1: d1.det, shot1 }));
    await r.close();
  }

  console.log('errors', errs);
  await b.close();
  process.exit(errs ? 1 : 0);
})();
