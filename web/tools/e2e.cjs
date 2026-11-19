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
//   node tools/e2e.cjs [итог.png]   (рядом кладутся <итог>-debrief.png и <итог>-survival.png)
const { chromium } = require('playwright');
const path = require('path');
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
  await p.addInitScript(() => { window.__ready = 0; window.ArtaNative = { ready() { window.__ready++; }, applyUpdate() {} }; });
  await p.goto('file://' + path.resolve(__dirname, '../../app/src/main/assets/www/index.html'));
  await p.waitForFunction(() => window.__arta);
  // самый первый запуск: до меню идёт вступительный ролик; запуск подтверждается, пока он ещё на экране
  const boot = await p.evaluate(() => ({ intro: !!__arta.shell.intro, playing: __arta.shell.introPlaying, el: !!document.getElementById('arta-intro'), skip: !!document.querySelector('#arta-intro [data-ai=skip]') }));
  await p.waitForFunction(() => window.__ready === 1, null, { timeout: 30000 }).catch(() => {});
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
    ['game', '#setDiff [data-val="1"]', 'difficulty', 1], ['game', '#setHints [data-val="0"]', 'hints', false], ['game', '#setAutosave [data-val="0"]', 'autosave', false],
    ['game', '#setSpeed [data-val="2"]', 'speed', 2], ['game', '#setConfirm [data-val="0"]', 'confirmFriendly', false], ['game', '#setCrew [data-val="compact"]', 'crewPanel', 'compact'],
    ['game', '#setCrew [data-val="off"]', 'crewPanel', 'off'],
    ['ctrl', '#setInvert [data-val="1"]', 'invert', true], ['ctrl', '#setLefty [data-val="1"]', 'lefty', true], ['ctrl', '#setLefty [data-val="0"]', 'lefty', false],
    ['ctrl', '#setSens [data-val="1.3"]', 'sens', 1.3], ['ctrl', '#setVibroPower [data-val="low"]', 'vibroPower', 'low'], ['ctrl', '#setVibro [data-val="0"]', 'vibro', false],
    ['sound', '#setSound [data-val="0"]', 'sound', false], ['sound', '#setSound [data-val="1"]', 'sound', true], ['sound', '#setVolFx [data-step="-10"]', 'volFx', 90],
    ['sound', '#setVolAmb [data-step="10"]', 'volAmb', 80], ['sound', '#setVolRadio [data-step="-10"]', 'volRadio', 90],
    ['screen', '#setText [data-val="1.15"]', 'text', 1.15], ['screen', '#setQuality [data-val="mid"]', 'quality', 'mid'], ['screen', '#setQuality [data-val="low"]', 'quality', 'low'],
    ['screen', '#setFps [data-val="30"]', 'fps', 30], ['screen', '#setNight [data-val="soft"]', 'nightTint', 'soft'], ['screen', '#setShowFps [data-val="1"]', 'showFps', true],
  ];
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
      invert: engine.settings.invert, sens: engine.settings.sens, q: engine.quality, cap: engine.frameCap, frames, free, slow, maxDt, rtW, buses: engine.audio.buses, muted: engine.audio.muted,
      body: document.body.className, fps: !fm.classList.contains('hidden') && fm.offsetWidth > 0 && fm.textContent, night: getComputedStyle(document.getElementById('night')).transitionProperty,
      rcol: getComputedStyle(document.querySelector('#crew .crew-chip')).display };
  });
  console.log('settings-engine', JSON.stringify(eng));
  if (eng.volRadio !== 25 || eng.bar !== '25%' || eng.label !== '25') fail('ползунок громкости радио не встал на 25: ' + eng.volRadio + ' ' + eng.bar);
  if (!eng.powerOff) fail('сила вибрации доступна при выключенной вибрации');
  if (eng.invert !== true || eng.sens !== 1.3) fail('инверсия или чувствительность не дошли до движка');
  if (eng.q.tier !== 'low' || eng.q.pixelRatio !== 1 || eng.q.rtScale !== 0.5 || eng.rtW !== 256) fail('качество «экономное» не дошло до движка: ' + JSON.stringify(eng.q) + ' окуляр ' + eng.rtW);
  if (eng.cap !== 30 || eng.frames > 34) fail('ограничение 30 кадров не работает: ' + eng.cap + ', кадров за секунду ' + eng.frames);
  if (eng.free < 5 || eng.slow < 1 || eng.slow > 4 || eng.maxDt > 0.0501) fail('пропуск кадров не работает: без предела ' + eng.free + ' кадров за 1,5 с, с пределом 2 к/с — ' + eng.slow + ', dt до ' + eng.maxDt);
  if (Math.abs(eng.buses.fx - 0.9) > 1e-6 || Math.abs(eng.buses.amb - 80 / 70) > 1e-6 || Math.abs(eng.buses.radio - 0.25) > 1e-6 || eng.muted) fail('громкости не дошли до звука: ' + JSON.stringify(eng.buses));
  if (!/crew-off/.test(eng.body) || !/night-soft/.test(eng.body) || !/text-l/.test(eng.body) || eng.rcol !== 'none') fail('классы настроек не применены: ' + eng.body);
  if (!/^\d+ К\/С$/.test(eng.fps || '')) fail('счётчик кадров не показан: ' + eng.fps);
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
    return { diff: Object.keys(D).filter((k) => st[k] !== D[k].def), n: Object.keys(D).length, q: engine.quality.tier, cap: engine.frameCap, invert: engine.settings.invert, body: document.body.className.trim(),
      buses: engine.audio.buses, shown: document.getElementById('settings').classList.contains('show'), fps: document.getElementById('fpsMeter').classList.contains('hidden'), difficulty: game.state.difficulty }; });
  console.log('settings-defaults', JSON.stringify(def));
  if (def.diff.length || def.n < 18) fail('«по умолчанию» не вернуло настройки: ' + def.diff.join());
  if (def.q !== 'high' || def.cap !== 0 || def.invert || def.body || !def.fps || def.buses.fx !== 1 || def.buses.amb !== 1 || def.buses.radio !== 1) fail('«по умолчанию» не дошло до движка: ' + JSON.stringify(def));
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
  await p.evaluate(() => localStorage.removeItem('arta2.intro'));
  await p.reload();
  await p.waitForFunction(() => window.__arta);
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
  await p.evaluate(() => __arta.game.setSetting('hints', false));
  await p.waitForFunction(() => document.getElementById('hint').textContent === '' && !document.querySelector('#nav button.next'), null, { timeout: 20000 }).catch(() => fail('подсказки не выключились настройкой'));
  await p.evaluate(() => __arta.game.setSetting('hints', true));
  await p.waitForFunction(() => document.getElementById('hint').textContent !== '', null, { timeout: 20000 }).catch(() => fail('подсказки не включились обратно'));
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
      const m = document.getElementById('memo'), o = document.getElementById('obs'), h = document.getElementById('hint'), keep = [m.innerHTML, o.innerHTML, h.innerHTML];
      m.textContent = 'ЦЕЛЬ 1 · ПЕЛЕНГ 012,4° · ДАЛЬНОСТЬ 9,85 КМ · УГОЛ 25,11° · ЗАРЯД 2'; o.textContent = 'КОРР. №1: ПЕРЕЛЁТ 350, ВПРАВО 120';
      h.textContent = 'ПОДЪЁМ: держите «НА УГОЛ ЗАРЯЖАНИЯ» — ствол должен опуститься до 3°';
      out.hintCut = h.scrollWidth - h.clientWidth;
      m.innerHTML = keep[0]; o.innerHTML = keep[1]; h.innerHTML = keep[2];
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
  await p.waitForFunction(() => __arta.engine.current === 'aa', null, { timeout: 30000 }).catch(() => {});
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
  const pr2 = await progress(), q2 = await p.evaluate(() => ({ q: __arta.engine.quality.tier, set: __arta.game.settings().quality, seg: (document.querySelector('#diffSeg button.on') || {}).textContent }));
  console.log('wipe-all', JSON.stringify({ chkOn, pr2, q2 }));
  if (!chkOn || pr2.xp !== 0 || pr2.sens !== 1 || pr2.difficulty !== 0 || q2.q !== 'high' || q2.set !== 'high' || q2.seg !== 'КУРСАНТ') fail('сброс с настройками не вернул настройки: ' + JSON.stringify({ pr2, q2 }));

  // ---------- 7. находки проверки: настоящий ролик, двойные касания, прерванные запуск и удержание (чистое хранилище, 740×360) ----------
  {
    const q = await (await b.newContext({ viewport: { width: 740, height: 360 }, hasTouch: true })).newPage();
    q.setDefaultTimeout(120000); humanPace(q);
    q.on('pageerror', (e) => { errs++; console.log('PAGEERROR(7)', e.message); });
    await q.addInitScript(() => { window.ArtaNative = { ready() {}, applyUpdate() {} }; });
    const url = 'file://' + path.resolve(__dirname, '../../app/src/main/assets/www/index.html');
    const st = () => q.evaluate(() => ({ phase: __arta.game.state.phase, shown: [...document.querySelectorAll('.show')].map((e) => e.id).filter((id) => ['menu', 'settings', 'dialog', 'missions', 'upgrades'].includes(id)),
      intro: __arta.shell.introPlaying, el: !!document.getElementById('arta-intro'), hud: !document.getElementById('hud').classList.contains('hidden'), news: localStorage.getItem('arta2.news') }));
    const center = async (sel) => { const bx = await q.locator(sel).first().boundingBox(); return [bx.x + bx.width / 2, bx.y + bx.height / 2]; };
    const dtap = async (sel, gap) => { const [x, y] = await center(sel); await q.touchscreen.tap(x, y); await q.waitForTimeout(gap); await q.touchscreen.tap(x, y); };
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
    await dtap('#dlgBtns .btn.primary', 150); await q.waitForTimeout(250);
    const e1 = await st();
    await q.evaluate(() => __arta.engine.gotoStation('plot', { instant: true }));
    await q.waitForTimeout(200);
    await q.click('#resumeBtn');
    await q.waitForFunction(() => __arta.game.state.phase === 'playing' && !document.getElementById('hud').classList.contains('hidden'));
    await q.waitForTimeout(200);
    const e2 = await q.evaluate(() => ({ station: __arta.engine.current, saved: __arta.game.state.station, speed: __arta.game.state.speed, tab: (document.querySelector('#nav button.on') || {}).dataset }));
    console.log('save-dtap-resume', JSON.stringify({ e1, e2 }));
    if (e1.shown.join() !== 'menu' || e1.phase !== 'menu') fail('двойное касание «СОХРАНИТЬ И ВЫЙТИ В МЕНЮ» открыло экран под пальцем: ' + JSON.stringify(e1));
    if (e2.station !== 'fire' || e2.saved !== 'fire' || e2.speed !== 3) fail('«ПРОДОЛЖИТЬ БОЙ» вернуло не на тот пост или не с той скоростью: ' + JSON.stringify(e2));
    // новый бой после продолженного — снова с планшета и со скоростью из настроек
    await q.evaluate(() => { const g = __arta.game; g.quit(); g.startMission(0); g.begin(); });
    const e3 = await q.evaluate(() => ({ station: __arta.engine.current, speed: __arta.game.state.speed }));
    if (e3.station !== 'plot' || e3.speed !== 1) fail('новый бой начался не с планшета или не со скоростью по умолчанию: ' + JSON.stringify(e3));
    await q.evaluate(() => __arta.game.quit());
    await q.close();
  }

  console.log('errors', errs);
  await b.close();
  process.exit(errs ? 1 : 0);
})();
