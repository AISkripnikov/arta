// Экран «НАСТРОЙКИ» (пять вкладок) и применение настроек. Логика их только хранит и проверяет (game.settings(),
// game.setSetting) и сама применяет лишь autosave и speed; всё остальное применяет этот модуль и оболочка:
//   sens, invert   → engine.settings (маховики и рычаги привода)
//   shake          → engine.settings.shake (тряска камеры: engine.shake)
//   text           → CSS-переменные --ts (полный масштаб), --tsc (не больше 1.15: кнопки, меню), --tsb (панели HUD) на <html>
//   lefty          → класс body.lefty (зеркалит обвязку HUD; 3D-посты не трогает)
//   crewPanel      → классы body.crew-compact / body.crew-off (столбик расчёта)
//   nightTint      → класс body.night-soft (красный фильтр ночного боя слабее)
//   volFx/Amb/Radio/Music → engine.audio.setBus (эффекты, фон башни, радио, музыка); общий звук — game.setMuted + audio.setMuted
//   quality, fps   → engine.setQuality ('auto' | 'high' | 'mid' | 'low'), engine.setFrameCap; qualityChosen ставит сама логика
//   showFps        → плашка #fpsMeter
//   vibro, vibroPower → vibrate(kind)
//   hints ('new' | 'all' | 'off') → учитывает логика (game.hint()); confirmFriendly → читает оболочка (вопрос «СВОИ В ЗОНЕ. ОГОНЬ?»)
// Вкладка «ДАННЫЕ»: ролик, обучение, сброс улучшений, настройки по умолчанию, сброс прогресса (два шага, удержание 2 с).
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const SENS = [0.6, 0.8, 1, 1.3, 1.6];
const TEXT = [[1, 'ОБЫЧНЫЙ'], [1.15, 'КРУПНЫЙ'], [1.3, 'ОЧЕНЬ КРУПНЫЙ']];
const BAR = { 1: 1, 1.15: 1.06, 1.3: 1.12 };
const YES_NO = [[1, 'ВКЛ'], [0, 'ВЫКЛ']];
/** Рисунки вибрации, мс (для силы «СИЛЬНАЯ»; «СЛАБАЯ» — вдвое короче). */
export const VIBRO = { shot: 40, hit: 120, bomb: 80, fault: [30, 40, 30] };
/** Время удержания красной кнопки сброса прогресса, мс. */
export const WIPE_HOLD_MS = 2000;
/** Ключи localStorage, которые ведёт интерфейс (не игровая логика): стираются при сбросе прогресса. */
export const UI_KEYS = ['arta2.news', 'arta2.tutorial'];
const ONLY_MENU = 'Только из главного меню, между боями.';

const TABS = [['game', 'ИГРА'], ['ctrl', 'УПРАВЛЕНИЕ'], ['sound', 'ЗВУК'], ['screen', 'ЭКРАН'], ['data', 'ДАННЫЕ']];
// строка: { id, key, type: 'bool' | 'num' | 'str' | 'vol' | 'act', label, note, items, lock (только из меню) }
const ROWS = {
  game: [
    { id: 'setDiff', key: 'difficulty', type: 'num', label: 'СЛОЖНОСТЬ', lock: true, items: [[0, 'КУРСАНТ'], [1, 'КОМАНДИР']],
      note: 'Курсант: визир сам встаёт на фишку, готовые поправки, противник слабее. Командир: всё вручную.' },
    { id: 'setHints', key: 'hints', type: 'str', label: 'ПОДСКАЗКИ', items: [['new', 'НОВОЕ'], ['all', 'ПО ШАГАМ'], ['off', 'ВЫКЛ']],
      note: 'Новое: по шагам — в первых трёх заданиях, дальше подсказка появляется, только когда в бою встретилось незнакомое. По шагам: строка «что делать дальше» и кольцо в каждом бою.' },
    { id: 'setAutosave', key: 'autosave', type: 'bool', label: 'АВТОСОХРАНЕНИЕ БОЯ', note: 'Запись боя каждые 15 секунд. Когда игру сворачивают, бой записывается всегда.' },
    { id: 'setSpeed', key: 'speed', type: 'num', label: 'СКОРОСТЬ БОЯ ПО УМОЛЧАНИЮ', items: [[1, '×1'], [2, '×2']], note: 'С какой скоростью времени начинается бой. В бою её меняет кнопка «×» вверху.' },
    { id: 'setConfirm', key: 'confirmFriendly', type: 'bool', label: 'ПОДТВЕРЖДАТЬ ВЫСТРЕЛ ПО СВОИМ', note: 'Свой корабль ближе 400 м от точки прицеливания — спуск сперва спросит: «СВОИ В ЗОНЕ. ОГОНЬ?»' },
    { id: 'setCrew', key: 'crewPanel', type: 'str', label: 'РАСЧЁТ НА ЭКРАНЕ', items: [['full', 'ПОЛНОСТЬЮ'], ['compact', 'КОМПАКТНО'], ['off', 'СКРЫТЬ']],
      note: 'Значки наводчика, заряжающего и радиста у края экрана. Скрытый значок появится сам, если боец ранен.' },
  ],
  ctrl: [
    { id: 'setSens', key: 'sens', type: 'num', label: 'ЧУВСТВИТЕЛЬНОСТЬ МАХОВИКОВ', items: SENS.map((v) => [v, String(v).replace('.', ',') + '×']), note: 'Насколько охотно маховики и рычаг привода отзываются на ход пальца.' },
    { id: 'setInvert', key: 'invert', type: 'bool', label: 'ИНВЕРСИЯ МАХОВИКОВ', note: 'Тот же ход пальца крутит маховик в обратную сторону.' },
    { id: 'setLefty', key: 'lefty', type: 'bool', label: 'РЕЖИМ ДЛЯ ЛЕВШИ', note: 'Кнопки, значки и подсказки на экране боя меняются сторонами.' },
    { id: 'setVibro', key: 'vibro', type: 'bool', label: 'ВИБРАЦИЯ', note: 'Отдача выстрела, попадания по батарее, тревога.' },
    { id: 'setVibroPower', key: 'vibroPower', type: 'str', label: 'СИЛА ВИБРАЦИИ', items: [['low', 'СЛАБАЯ'], ['high', 'СИЛЬНАЯ']], note: 'Слабая — толчки вдвое короче.', needs: 'vibro' },
  ],
  sound: [
    { id: 'setSound', key: 'sound', type: 'bool', label: 'ЗВУК', note: 'Весь звук игры разом.' },
    { id: 'setVolFx', key: 'volFx', type: 'vol', label: 'ГРОМКОСТЬ ЭФФЕКТОВ', note: 'Выстрел, механизмы, разрывы, тревога.', needs: 'sound' },
    { id: 'setVolAmb', key: 'volAmb', type: 'vol', label: 'ГРОМКОСТЬ ФОНА БАШНИ', note: 'Гул вентиляции и трансформаторов в бою.', needs: 'sound' },
    { id: 'setVolRadio', key: 'volRadio', type: 'vol', label: 'ГРОМКОСТЬ РАДИО', note: 'Вызов радиста: донесения, доклады, команды штаба.', needs: 'sound' },
    { id: 'setVolMusic', key: 'volMusic', type: 'vol', label: 'ГРОМКОСТЬ МУЗЫКИ', note: 'Музыка в меню и в бою.', needs: 'sound' },
  ],
  screen: [
    { id: 'setText', key: 'text', type: 'num', label: 'РАЗМЕР НАДПИСЕЙ', items: TEXT, note: 'Радио, подсказки, блокнот, окна.' },
    { id: 'setQuality', key: 'quality', type: 'str', label: 'КАЧЕСТВО ГРАФИКИ', items: [['auto', 'АВТО'], ['high', 'ВЫСОКОЕ'], ['mid', 'СРЕДНЕЕ'], ['low', 'ЭКОНОМНОЕ']],
      note: 'АВТО само снижает качество, если телефон не успевает. Ниже качество — меньше греется телефон.' },
    { id: 'setFps', key: 'fps', type: 'num', label: 'ОГРАНИЧЕНИЕ КАДРОВ', items: [[60, '60'], [30, '30']], note: '30 кадров в секунду берегут батарею.' },
    { id: 'setNight', key: 'nightTint', type: 'str', label: 'КРАСНЫЙ СВЕТ НОЧЬЮ', items: [['normal', 'ОБЫЧНЫЙ'], ['soft', 'СЛАБЫЙ']], note: 'Яркость красного фильтра в ночных боях.' },
    { id: 'setShake', key: 'shake', type: 'bool', label: 'ТРЯСКА КАМЕРЫ ПРИ ВЫСТРЕЛЕ', note: 'Камера вздрагивает от выстрела башни и от близких разрывов.' },
    { id: 'setShowFps', key: 'showFps', type: 'bool', label: 'СЧЁТЧИК КАДРОВ', note: 'Число кадров в секунду — в бою, слева внизу над полосой постов.' },
  ],
  data: [
    { id: 'setIntro', act: 'intro', type: 'act', label: 'ВСТУПИТЕЛЬНЫЙ РОЛИК', btn: 'ПОСМОТРЕТЬ РОЛИК', lock: true, note: 'Как лейтенант принял башню батареи «Утёс».' },
    { id: 'setTutorial', act: 'tutorial', type: 'act', label: 'ОБУЧЕНИЕ', btn: 'ПОКАЗАТЬ ЗАНОВО', lock: true, note: 'Включит подсказки, покажет заново всё «НОВОЕ» и откроет учебное задание «Пристрелка».' },
    { id: 'setUpReset', act: 'upreset', type: 'act', label: 'УЛУЧШЕНИЯ БАШНИ', btn: 'СБРОСИТЬ УЛУЧШЕНИЯ', lock: true, note: 'Снять все улучшения и вернуть очки снабжения.' },
    { id: 'setDefaults', act: 'defaults', type: 'act', label: 'НАСТРОЙКИ', btn: 'ВОССТАНОВИТЬ ПО УМОЛЧАНИЮ', note: 'Вернуть все настройки к исходным. Прогресс и сложность не меняются.' },
    { id: 'setWipe', act: 'wipe', type: 'act', label: 'ПРОГРЕСС', btn: 'СБРОСИТЬ ПРОГРЕСС', danger: true, lock: true, note: 'Стереть звёзды, звание, улучшения, рекорды и сохранённый бой.' },
    { id: 'setVerRow', type: 'info', label: 'ВЕРСИЯ ИГРЫ', note: 'Обновления приходят сами при запуске игры и ставятся при выходе в меню.' },
  ],
};
const ALL = [].concat(...TABS.map(([t]) => ROWS[t]));

/**
 * hooks (все необязательны): dialog(html, buttons, dismiss), toast(text), menu() — показать главное меню, hasIntro(), playIntro(), startTutorial(),
 * afterWipe({ settings }), stats() → { stars, starsMax, unlocked, rank, xp, upLevels, records, resume }.
 */
export function createSettings({ game, engine, show, sfx, dialog, hooks = {} }) {
  let back = null, battle = false, tab = 'game', built = false, ambTimer = 0, fpsTimer = 0, version = '';
  let cur = { sens: 1, invert: false, lefty: false, vibro: true, vibroPower: 'high', hints: 'new', autosave: true, speed: 1, confirmFriendly: true, crewPanel: 'full',
    volFx: 100, volAmb: 70, volRadio: 100, volMusic: 60, text: 1, quality: 'auto', qualityChosen: false, fps: 60, nightTint: 'normal', showFps: false, shake: true };
  const read = () => { try { cur = Object.assign(cur, game.settings()); } catch (e) { /* старая логика без настроек */ } return cur; };
  const call = (obj, name, ...a) => { try { if (obj && typeof obj[name] === 'function') return obj[name](...a); } catch (e) { /* не критично */ } return undefined; };
  /** Значение строки: настройки + два «чужих» ключа (сложность и общий звук хранятся в сохранении отдельно). */
  const valueOf = (key, st) => (key === 'difficulty' ? game.state.difficulty : key === 'sound' ? !game.save.muted : st[key]);

  function apply() {
    const st = read(), root = document.documentElement, body = document.body;
    if (engine.settings) { engine.settings.sens = st.sens; engine.settings.invert = !!st.invert; engine.settings.shake = st.shake !== false; }
    root.style.setProperty('--ts', String(st.text));
    root.style.setProperty('--tsc', String(Math.min(st.text, 1.15)));
    root.style.setProperty('--tsb', String(BAR[st.text] || 1));
    body.classList.toggle('lefty', !!st.lefty);
    body.classList.toggle('text-l', st.text === 1.15);
    body.classList.toggle('text-xl', st.text === 1.3);
    body.classList.toggle('crew-compact', st.crewPanel === 'compact');
    body.classList.toggle('crew-off', st.crewPanel === 'off');
    body.classList.toggle('night-soft', st.nightTint === 'soft');
    // громкости: 100 % эффектов и радио, 70 % фона и 60 % музыки — уровни, на которых звук был записан (шина = 1)
    call(engine.audio, 'setBus', 'fx', st.volFx / 100);
    call(engine.audio, 'setBus', 'amb', st.volAmb / 70);
    call(engine.audio, 'setBus', 'radio', st.volRadio / 100);
    call(engine.audio, 'setBus', 'music', st.volMusic / 60);
    call(engine, 'setQuality', st.quality);
    call(engine, 'setFrameCap', st.fps === 30 ? 30 : 0);
    const fm = $('fpsMeter');
    if (fm) {
      fm.classList.toggle('hidden', !st.showFps);
      clearInterval(fpsTimer); fpsTimer = 0;
      if (st.showFps) {
        const tickFps = () => { let f = 0; try { f = engine.debug.stats().fps; } catch (e) { /* нет счётчика */ } fm.textContent = Math.round(f) + ' К/С'; };
        tickFps(); fpsTimer = setInterval(tickFps, 500);
      }
    }
  }

  // ---------- разметка ----------
  const enc = (v) => (v === true ? 1 : v === false ? 0 : v);
  const seg = (r) => `<div class="seg" id="${r.id}">` + (r.items || YES_NO).map(([v, label]) => `<button data-set="${r.key}" data-val="${enc(v)}">${label}</button>`).join('') + '</div>';
  const vol = (r) => `<div class="sld" id="${r.id}" data-vol="${r.key}"><button class="sld-b" data-step="-10" aria-label="Тише">−</button>` +
    '<div class="sld-bar"><i></i><b>0</b></div>' + `<button class="sld-b" data-step="10" aria-label="Громче">+</button></div>`;
  const act = (r) => `<button class="btn small set-act${r.danger ? ' danger' : ''}" id="${r.id}" data-setact="${r.act}">${r.btn}</button>`;
  function build() {
    $('setTabs').innerHTML = TABS.map(([t, label]) => `<button data-settab="${t}">${label}</button>`).join('');
    $('setList').innerHTML = TABS.map(([t]) => `<div class="set-pane" data-pane="${t}">` + ROWS[t].map((r) =>
      `<div class="set-row" data-row="${r.id}"><div class="set-l"><b>${r.label}</b><small>${esc(r.note || '')}</small><small class="set-lock"></small></div>` +
      (r.type === 'vol' ? vol(r) : r.type === 'act' ? act(r) : r.type === 'info' ? '<span class="set-v" id="setVer"></span>' : seg(r)) + '</div>').join('') + '</div>').join('');
    built = true;
  }
  /** Привести экран в соответствие настройкам, не пересоздавая разметку (ползунок может быть под пальцем). */
  function sync() {
    if (!built) build();
    const st = read();
    document.querySelectorAll('#setTabs button').forEach((b) => b.classList.toggle('on', b.dataset.settab === tab));
    document.querySelectorAll('#setList .set-pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === tab));
    ALL.forEach((r) => {
      const row = document.querySelector(`#setList [data-row="${r.id}"]`); if (!row) return;
      const lock = !!(r.lock && battle), off = lock || (r.needs ? !valueOf(r.needs, st) : false);
      row.classList.toggle('off', off);
      row.querySelector('.set-lock').textContent = lock ? ONLY_MENU : '';
      row.querySelectorAll('button').forEach((b) => { b.disabled = off; });
      if (r.type === 'vol') {
        const v = Math.round(st[r.key]);
        row.querySelector('.sld-bar i').style.width = v + '%'; row.querySelector('.sld-bar b').textContent = v;
      } else if (r.type === 'act') {
        if (r.act === 'intro') row.classList.toggle('hidden', !(hooks.hasIntro && hooks.hasIntro()));
      } else if (r.type !== 'info') {
        const v = valueOf(r.key, st);
        let on = v;
        if (r.key === 'sens') on = SENS.reduce((a, x) => (Math.abs(x - v) < Math.abs(a - v) ? x : a), 1);
        row.querySelectorAll('[data-set]').forEach((b) => b.classList.toggle('on', b.dataset.val === String(enc(on))));
      }
    });
    const ver = $('setVer'); if (ver) ver.textContent = version || '—';
  }

  function vibrate(kind) {
    if (!cur.vibro) return;
    let p = VIBRO[kind] || kind;
    if (cur.vibroPower === 'low') p = Array.isArray(p) ? p.map((x) => Math.max(10, Math.round(x / 2))) : Math.max(10, Math.round(p / 2));
    try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* вибрации нет */ }
  }

  // ---------- изменение ----------
  function set(key, val) {
    if (key === 'difficulty') { if (battle) return; game.setDifficulty(val); }
    else if (key === 'sound') { game.setMuted(!val); sfx('setMuted', game.save.muted); }
    else { const r = game.setSetting(key, val); if (r && r.ok === false) return; }
    apply(); sync();
    // сразу дать услышать и почувствовать
    if (key === 'vibro' ? val : key === 'vibroPower') vibrate('shot');
    if (key === 'volFx') sfx('clunk');
    else if (key === 'volRadio') sfx('radio');
    else if (key === 'volAmb') { sfx('ambient', true); clearTimeout(ambTimer); ambTimer = setTimeout(() => { if (game.state.phase !== 'playing') sfx('ambient', false); }, 2500); }
  }
  const parse = (r, raw) => (r.type === 'bool' ? raw === '1' : r.type === 'num' ? +raw : raw);

  $('settings').addEventListener('click', (e) => {
    const el = e.target.closest('[data-set],[data-setclose],[data-settab],[data-step],[data-setact]');
    if (!el || el.disabled) return;
    const d = el.dataset;
    if (d.setclose != null) { sfx('tick'); close(); return; }
    if (d.settab) { sfx('tick'); tab = d.settab; sync(); $('setList').scrollTop = 0; return; }
    if (d.setact) { sfx('tick'); ACTIONS[d.setact] && ACTIONS[d.setact](); return; }
    if (d.step) { const key = el.parentNode.dataset.vol; set(key, Math.max(0, Math.min(100, Math.round(read()[key]) + +d.step))); return; }
    const r = ALL.find((x) => x.key === d.set); if (!r) return;
    sfx('tick');
    set(r.key, parse(r, d.val));
  });
  // ползунки громкости: касание или перетаскивание по шкале, шаг 5
  let drag = null;
  const slide = (e) => {
    const box = drag.bar.getBoundingClientRect();
    const v = Math.max(0, Math.min(100, Math.round(((e.clientX - box.left) / Math.max(1, box.width)) * 20) * 5));
    if (v !== Math.round(read()[drag.key])) set(drag.key, v);
  };
  $('settings').addEventListener('pointerdown', (e) => {
    const bar = e.target.closest('.sld-bar'); if (!bar || bar.parentNode.querySelector('button').disabled) return;
    drag = { bar, key: bar.parentNode.dataset.vol, id: e.pointerId };
    try { bar.setPointerCapture(e.pointerId); } catch (err) { /* нет захвата */ }
    slide(e); e.preventDefault();
  });
  $('settings').addEventListener('pointermove', (e) => { if (drag && e.pointerId === drag.id) slide(e); });
  const drop = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
  $('settings').addEventListener('pointerup', drop); $('settings').addEventListener('pointercancel', drop);

  // ---------- вкладка «ДАННЫЕ» ----------
  const reopen = () => { sync(); show('settings'); };
  const ask = (html, buttons) => { if (dialog) dialog(html, buttons, reopen); };
  function wipeStep2(withSettings) {
    let abort = () => {};
    const cancel = () => { abort(); reopen(); };
    if (dialog) dialog('<h2>СТЕРЕТЬ ПРОГРЕСС</h2><p>Отменить это будет нельзя. Чтобы подтвердить, удерживайте красную кнопку две секунды.</p>' +
      (withSettings ? '<p class="dim">Настройки тоже вернутся к исходным.</p>' : '<p class="dim">Настройки останутся как есть.</p>') +
      '<button class="hold-btn" id="wipeHold"><i></i><span>УДЕРЖИВАЙТЕ · СТЕРЕТЬ ПРОГРЕСС</span></button>',
    [{ text: 'ОТМЕНА', primary: true, fn: cancel }], cancel);
    const btn = $('wipeHold'), fill = btn.querySelector('i');
    let t0 = 0, raf = 0, done = false;
    const stop = () => { if (done) return; cancelAnimationFrame(raf); raf = 0; t0 = 0; fill.style.width = '0%'; btn.classList.remove('holding'); };
    abort = stop;
    const step = () => {
      if (!t0 || done) return;
      // окно закрыли, пока палец держал кнопку («Назад», «ОТМЕНА» вторым пальцем, касание мимо окна) — удержание не считается
      if (!btn.isConnected || !$('dialog').classList.contains('show')) { stop(); return; }
      const k = Math.min(1, (performance.now() - t0) / WIPE_HOLD_MS);
      fill.style.width = (k * 100).toFixed(1) + '%';
      if (k >= 1) { done = true; btn.classList.remove('holding'); wipe(withSettings); return; }
      raf = requestAnimationFrame(step);
    };
    btn.addEventListener('pointerdown', (e) => { if (done) return; e.preventDefault(); t0 = performance.now(); btn.classList.add('holding'); try { btn.setPointerCapture(e.pointerId); } catch (err) { /* нет захвата */ } cancelAnimationFrame(raf); raf = requestAnimationFrame(step); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => btn.addEventListener(n, stop));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  function wipe(withSettings) {
    sfx('clunk');
    const r = game.resetProgress({ settings: !!withSettings });
    if (r && r.ok === false) { reopen(); return; }
    UI_KEYS.forEach((k) => { try { localStorage.removeItem(k); } catch (e) { /* хранилище недоступно */ } });
    if (withSettings) sfx('setMuted', game.save.muted);
    apply(); back = null; battle = false;
    if (hooks.afterWipe) hooks.afterWipe({ settings: !!withSettings }); else show(null);
  }
  const ACTIONS = {
    // ролик вернёт на этот же экран; «куда по ГОТОВО» сохраняем — на случай, если экран настроек успели закрыть
    intro: () => { if (battle || !hooks.playIntro) return; const b = back; hooks.playIntro(() => { back = b; battle = false; reopen(); }); },
    tutorial: () => {
      if (battle || !hooks.startTutorial) return;
      // выключенные подсказки включаем («НОВОЕ»), а всё изученное снова становится новым
      if (read().hints === 'off') game.setSetting('hints', 'new');
      try { game.resetLearned(); } catch (e) { /* старая логика */ }
      apply();
      back = null; hooks.startTutorial();
    },
    upreset: () => ask('<h2>СБРОСИТЬ УЛУЧШЕНИЯ?</h2><p>Все улучшения башни будут сняты, потраченные очки снабжения вернутся полностью.</p>', [
      { text: 'СБРОСИТЬ', primary: true, fn: () => { const r = game.resetUpgrades(); reopen(); if (r && r.ok === false && hooks.toast) hooks.toast(r.reason); } },
      { text: 'ОТМЕНА', ghost: true, fn: reopen },
    ]),
    defaults: () => ask('<h2>НАСТРОЙКИ ПО УМОЛЧАНИЮ?</h2><p>Все настройки игры, управления, звука и экрана вернутся к исходным. Прогресс и сложность не изменятся.</p>', [
      { text: 'ВОССТАНОВИТЬ', primary: true, fn: () => { game.resetSettings(); sfx('setMuted', game.save.muted); apply(); reopen(); } },
      { text: 'ОТМЕНА', ghost: true, fn: reopen },
    ]),
    wipe: () => {
      if (battle) return;
      const s = (hooks.stats && hooks.stats()) || {};
      const li = [
        `звёзды кампании: ${s.stars || 0}${s.starsMax ? ' из ' + s.starsMax : ''}, открыто заданий: ${s.unlocked || 1}`,
        `звание «${esc(s.rank || 'матрос')}» и опыт: ${s.xp || 0}`,
        `улучшения башни${s.upLevels ? ' (уровней: ' + s.upLevels + ')' : ''} и очки снабжения`,
        `рекорды заданий${s.records ? ' (' + s.records + ')' : ''}, «ОБОРОНЫ» и «ЗАДАНИЯ ДНЯ»`,
        'сохранённый бой' + (s.resume ? ': ' + esc(s.resume) : ' (сейчас его нет)'),
      ];
      ask('<h2>СБРОСИТЬ ПРОГРЕСС?</h2><p>Игра начнётся с начала. Будет стёрто:</p><ul id="wipeList">' + li.map((t) => `<li>${t}</li>`).join('') + '</ul>' +
        '<button class="chk" id="wipeSettings" aria-pressed="false"><i></i><span>И НАСТРОЙКИ — вернуть к исходным</span></button>', [
        { text: 'ОТМЕНА', primary: true, fn: reopen },
        { text: 'ДАЛЬШЕ', fn: () => wipeStep2($('wipeSettings').classList.contains('on')) },
      ]);
      const chk = $('wipeSettings');
      chk.addEventListener('click', () => { sfx('tick'); const on = chk.classList.toggle('on'); chk.setAttribute('aria-pressed', String(on)); });
    },
  };

  game.on('settings', () => { apply(); if (isOpen()) sync(); });

  /** onBack — куда вернуться по «ГОТОВО»; opts.battle — открыто из паузы: то, что меняют только между боями, недоступно. */
  function open(onBack, opts) { back = onBack || null; battle = !!(opts && opts.battle); if (opts && opts.tab) tab = opts.tab; sync(); $('setList').scrollTop = 0; show('settings'); }
  function close() { const b = back; back = null; clearTimeout(ambTimer); if (game.state.phase !== 'playing') sfx('ambient', false); if (b) b(); else if (game.state.phase === 'menu' && hooks.menu) hooks.menu(); else show(null); }
  function isOpen() { return $('settings').classList.contains('show'); }
  /** Строка версии для вкладки «ДАННЫЕ» (приходит от приложения). */
  function setVersion(text) { version = text || ''; if (built) sync(); }

  apply();
  return { open, close, isOpen, apply, vibrate, sync, setVersion, get tab() { return tab; }, get current() { return read(); } };
}
