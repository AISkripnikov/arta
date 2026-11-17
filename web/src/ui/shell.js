// DOM-оболочка: меню, HUD, блокнот, брифинг, итоги. Общие эффекты (звук выстрела, тряска, вспышки).
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export const STATIONS = [
  { id: 'plot', title: 'ПЛАНШЕТ', check: 'measured' },
  { id: 'computer', title: 'ВЫЧИСЛИТЕЛЬ', check: 'computed' },
  { id: 'loading', title: 'ЗАРЯЖАНИЕ', check: 'loaded' },
  { id: 'traverse', title: 'ПОВОРОТ', check: 'traversed' },
  { id: 'elevation', title: 'ПОДЪЁМ', check: 'elevated' },
  { id: 'fire', title: 'ОГОНЬ', check: 'armed' },
];

const HOWTO = `
<h2>КАК ИГРАТЬ</h2>
<p>Вы — оператор башни береговой батареи. Цель не видна: разведка сообщает её координаты, а вы сами проходите всю процедуру выстрела, переходя между шестью постами (кнопки внизу или свайп по пустому месту).</p>
<h3>1. ПЛАНШЕТ</h3><p>Перетащите фишку цели на карту по координатам X и Y из донесения. Наведите на неё линейку-алидаду и визир, считайте пеленг и дальность, нажмите «ЗАПИСАТЬ».</p>
<h3>2. ВЫЧИСЛИТЕЛЬ</h3><p>Маховиком наберите дальность, выберите заряд (зелёные лампы — достаёт) и потяните рычаг: получите угол возвышения и время полёта.</p>
<h3>3. ЗАРЯЖАНИЕ</h3><p>Ствол — не выше 3°. Откройте затвор, подайте снаряд (ОФ — фугасный, ББ — бронебойный по броне), дошлите его, подайте столько зарядов, сколько выбрали на вычислителе, закройте затвор.</p>
<h3>4. ПОВОРОТ</h3><p>Снимите стопор, разверните башню на записанный пеленг (рычаг привода — быстро, маховик — точно), поставьте стопор.</p>
<h3>5. ПОДЪЁМ</h3><p>Маховиком поднимите ствол на вычисленный угол.</p>
<h3>6. ОГОНЬ</h3><p>Проверьте лампы готовности, откройте крышку, взведите цепь стрельбы и дёрните спуск.</p>
<h3>КОРРЕКТИРОВКА</h3><p>После разрыва корректировщик доложит отклонение. Перелёт — уменьшите дальность на вычислителе и пересчитайте угол; ушло вправо — доверните башню влево. Один градус на 10 км — это около 175 м в сторону.</p>
<h3>ДВИЖУЩИЕСЯ ЦЕЛИ</h3><p>Стреляйте с упреждением — в точку, где цель окажется через время подготовки плюс время полёта снаряда.</p>`;

const DIFF_HINT = [
  'Курсант: визир сам примагничивается к фишке, корректировщик даёт готовые поправки, противник бьёт слабее.',
  'Командир: всё вручную. Корректировщик сообщает только отклонение в метрах.',
];

export function createShell({ engine, game }) {
  const s = game.state;
  const sfx = (name, ...a) => { try { const f = engine.audio && engine.audio[name]; if (f) f.apply(engine.audio, a); } catch (e) { /* звук не критичен */ } };
  let pendingUpdate = 0;
  let dirty = true, lastRender = 0, notebookOpen = false, unread = 0, dialogDismiss = null, radioTimer = 0, toastTimer = 0;

  // ---------- экраны ----------
  const screens = ['loading', 'menu', 'missions', 'dialog', 'notebook'];
  function show(id) { screens.forEach((n) => $(n).classList.toggle('show', n === id)); notebookOpen = id === 'notebook'; if (id !== 'dialog') dialogDismiss = null; }
  function dialog(html, buttons, dismiss) {
    $('dlgBody').innerHTML = html; $('dlgBody').scrollTop = 0;
    const box = $('dlgBtns'); box.innerHTML = '';
    buttons.forEach((b) => {
      const el = document.createElement('button');
      el.className = 'btn' + (b.primary ? ' primary' : '') + (b.ghost ? ' ghost' : '');
      el.textContent = b.text;
      el.onclick = () => { sfx('tick'); b.fn(); };
      box.appendChild(el);
    });
    show('dialog');
    dialogDismiss = dismiss || null;
  }
  const closeAll = () => show(null);

  // ---------- меню ----------
  function refreshMenu() {
    document.querySelectorAll('#diffSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.diff === s.difficulty));
    document.querySelectorAll('#soundSeg button').forEach((b) => b.classList.toggle('on', (b.dataset.sound === '1') === !game.save.muted));
    $('diffHint').textContent = DIFF_HINT[s.difficulty];
  }
  function showMenu() {
    // скачанное обновление игры применяем, когда игрок вышел в меню
    if (pendingUpdate) { pendingUpdate = 0; location.href = 'arta://apply-update'; return; }
    $('hud').classList.add('hidden'); refreshMenu(); show('menu'); sfx('ambient', false);
  }
  function showMissions() {
    const grid = $('missionGrid'); grid.innerHTML = '';
    game.campaign.forEach((m, i) => {
      const locked = i >= game.save.unlocked, st = game.save.stars[i] || 0;
      const el = document.createElement('button');
      el.className = 'm-card' + (locked ? ' locked' : '');
      el.innerHTML = `<span class="num">ЗАДАНИЕ ${i + 1}${locked ? ' · ЗАКРЫТО' : ''}</span><span class="nm">${esc(m.name.toUpperCase())}</span><span class="st">${'★'.repeat(st)}<i>${'★'.repeat(3 - st)}</i></span>`;
      if (!locked) el.onclick = () => { sfx('tick'); game.startMission(i); };
      grid.appendChild(el);
    });
    show('missions');
  }
  function briefingHtml() {
    const m = s.mission;
    const list = s.targets.map((t) => `<li>${esc(t.name)}${t.armored ? ' — бронирована, нужен ББ' : ''}${t.moving ? ' — движется' : ''}</li>`).join('');
    return `<h2>${m.index != null ? 'ЗАДАНИЕ ' + (m.index + 1) + '. ' : ''}${esc(m.name.toUpperCase())}</h2><p>${esc(m.brief)}</p>` +
      `<h3>ЦЕЛИ</h3><ul>${list}</ul><p class="dim">Боезапас: ОФ ${s.shells.he}, ББ ${s.shells.ap}. Сложность: ${game.difficulties[s.difficulty]}.</p>`;
  }
  function showBriefing() {
    $('hud').classList.add('hidden');
    dialog(briefingHtml(), [
      { text: 'К БОЮ', primary: true, fn: () => game.begin() },
      { text: 'НАЗАД', ghost: true, fn: () => game.quit() },
    ]);
  }
  function showPause() {
    if (s.phase !== 'playing') return;
    game.pause(true);
    const resume = () => { game.pause(false); closeAll(); };
    dialog(`<h2>ПАУЗА</h2><p class="dim">${esc(s.mission.name)} · ${game.difficulties[s.difficulty]}</p>`, [
      { text: 'ПРОДОЛЖИТЬ', primary: true, fn: resume },
      { text: 'ЗАДАЧА', fn: () => dialog(briefingHtml(), [{ text: 'ЗАКРЫТЬ', primary: true, fn: showPauseAgain }], showPauseAgain) },
      { text: 'КАК ИГРАТЬ', fn: () => dialog(HOWTO, [{ text: 'ЗАКРЫТЬ', primary: true, fn: showPauseAgain }], showPauseAgain) },
      { text: 'В МЕНЮ', ghost: true, fn: () => { game.pause(false); game.quit(); } },
    ], resume);
  }
  function showPauseAgain() { game.pause(false); showPause(); }
  function showResult(e) {
    const st = e.stats;
    const html = `<h2>${e.won ? 'ЗАДАНИЕ ВЫПОЛНЕНО' : 'ЗАДАНИЕ ПРОВАЛЕНО'}</h2>` +
      (e.won ? `<div class="stars">${'★'.repeat(e.stars)}<i>${'★'.repeat(3 - e.stars)}</i></div>` : `<p class="bad">${esc(e.reason || '')}</p>`) +
      `<table class="stats"><tr><td>Выстрелов</td><td>${st.shots}</td></tr><tr><td>Норматив на «отлично»</td><td>${st.par}</td></tr>` +
      `<tr><td>Уничтожено целей</td><td>${st.destroyed} / ${st.total}</td></tr><tr><td>Прочность батареи</td><td>${st.integrity}%</td></tr>` +
      `<tr><td>Время</td><td>${game.fmt.time(st.time)}</td></tr></table>`;
    const idx = s.mission.index, btns = [];
    if (e.won && idx != null && idx + 1 < game.campaign.length) btns.push({ text: 'СЛЕДУЮЩЕЕ', primary: true, fn: () => game.startMission(idx + 1) });
    if (s.mission.skirmish) btns.push({ text: 'НОВЫЙ БОЙ', primary: !btns.length, fn: () => game.startSkirmish() });
    else btns.push({ text: 'ПОВТОРИТЬ', primary: !btns.length, fn: () => game.startMission(idx) });
    btns.push({ text: 'В МЕНЮ', ghost: true, fn: () => game.quit() });
    dialog(html, btns);
  }

  // ---------- HUD ----------
  const nav = $('nav');
  STATIONS.forEach((st, i) => {
    const b = document.createElement('button');
    b.dataset.station = st.id;
    b.innerHTML = `<span class="n">${i + 1}</span><span>${st.title}</span>`;
    nav.appendChild(b);
  });
  function goto(id) { if (engine.current !== id) { sfx('tick'); engine.gotoStation(id); } dirty = true; }
  function neighbor(dir) {
    const i = STATIONS.findIndex((st) => st.id === engine.current);
    goto(STATIONS[(i + dir + STATIONS.length) % STATIONS.length].id);
  }

  function nextStep() {
    const c = s.checklist, b = s.breech;
    if (s.flight.length && !b.shell && !b.open) return { st: null, text: 'Снаряд в полёте — ждите доклада корректировщика' };
    if (!s.activeTarget) return { st: null, text: 'Ждите донесения разведки' };
    if (!c.measured) return { st: 'plot', text: 'ПЛАНШЕТ: поставьте фишку по координатам, наведите алидаду, «ЗАПИСАТЬ»' };
    if (!c.computed) return { st: 'computer', text: 'ВЫЧИСЛИТЕЛЬ: наберите дальность, выберите заряд, потяните рычаг' };
    if (!c.loaded) {
      if (!b.open && !b.shell && s.turret.elevation > game.C.LOAD_ANGLE) return { st: 'elevation', text: 'ПОДЪЁМ: опустите ствол до ' + game.C.LOAD_ANGLE + '° — иначе затвор не открыть' };
      if (!b.open && !b.shell) return { st: 'loading', text: 'ЗАРЯЖАНИЕ: откройте затвор' };
      if (!b.shell) return { st: 'loading', text: 'ЗАРЯЖАНИЕ: подайте снаряд' };
      if (!b.rammed) return { st: 'loading', text: 'ЗАРЯЖАНИЕ: дошлите снаряд' };
      if (b.charges < s.computer.charge) return { st: 'loading', text: 'ЗАРЯЖАНИЕ: подайте заряды — нужно ' + s.computer.charge + ', подано ' + b.charges };
      if (b.charges > s.computer.charge) return { st: 'loading', text: 'ЗАРЯЖАНИЕ: лишний заряд! Нужно ' + s.computer.charge };
      return { st: 'loading', text: 'ЗАРЯЖАНИЕ: закройте затвор' };
    }
    if (b.charges !== s.computer.charge) return { st: 'loading', text: 'Заряжено ' + b.charges + ', а расчёт на заряд ' + s.computer.charge + ' — пересчитайте или перезарядите' };
    if (!c.traversed) return { st: 'traverse', text: s.turret.brake && Math.abs(s.turret.bearing - (s.plot.recorded[s.activeTarget] || {}).bearing) > 2 ? 'ПОВОРОТ: снимите стопор и разверните башню на записанный пеленг' : 'ПОВОРОТ: выставьте пеленг и поставьте стопор' };
    if (!c.elevated) return { st: 'elevation', text: 'ПОДЪЁМ: поднимите ствол на ' + s.computer.elevation.toFixed(2) + '°' };
    if (!c.armed) return { st: 'fire', text: 'ОГОНЬ: откройте крышку и взведите цепь стрельбы' };
    return { st: 'fire', text: 'ОГОНЬ: дёргайте спуск!' };
  }

  function renderHud() {
    $('hTime').textContent = game.fmt.time(s.time);
    const hi = $('hInt'); hi.style.width = Math.max(0, s.integrity) + '%'; hi.className = s.integrity <= 35 ? 'crit' : s.integrity <= 65 ? 'warn' : '';
    $('hHe').textContent = s.shells.he; $('hAp').textContent = s.shells.ap;
    const a = s.targets.find((t) => t.id === s.activeTarget);
    $('hTarget').textContent = a ? a.label + ' · ' + a.name.toUpperCase() : '—';
    $('hSpeed').textContent = '×' + s.speed; $('hSpeed').classList.toggle('on', s.speed > 1);
    $('hUnread').style.display = unread ? 'block' : 'none'; $('hUnread').textContent = unread;

    const rec = a ? s.plot.recorded[a.id] : null, cp = s.computer, parts = [];
    if (rec) parts.push(`<b>ПЕЛЕНГ</b> ${rec.bearing.toFixed(1)}° <b>ДАЛЬН.</b> ${game.fmt.km(rec.range)}`);
    if (cp.elevation != null) parts.push(`<b>ЗАРЯД</b> ${cp.charge} <b>УГОЛ</b> ${cp.elevation.toFixed(2)}° <b>ПОЛЁТ</b> ${cp.tof.toFixed(1)} с${cp.stale ? ' <b>(УСТАРЕЛО)</b>' : ''}`);
    $('memo').innerHTML = parts.join(' &nbsp;·&nbsp; ') || '<b>ЗАМЕРОВ НЕТ</b>';

    const step = nextStep(), hints = s.mission && (s.mission.tutorial || s.difficulty === 0);
    $('hint').textContent = hints ? step.text : '';
    nav.querySelectorAll('button').forEach((b, i) => {
      const st = STATIONS[i];
      b.classList.toggle('on', engine.current === st.id);
      b.classList.toggle('done', !!s.checklist[st.check]);
      b.classList.toggle('next', hints && step.st === st.id);
    });
    const fc = $('flightChip');
    if (s.flight.length) { const rem = Math.min(...s.flight.map((f) => f.tof - f.t)); fc.innerHTML = 'СНАРЯД В ПОЛЁТЕ <b>' + Math.max(0, rem).toFixed(0) + ' с</b>'; fc.classList.remove('hidden'); }
    else fc.classList.add('hidden');
  }

  function renderNotebook() {
    const box = $('nbTargets'); box.innerHTML = '';
    s.targets.filter((t) => t.reported).forEach((t) => {
      const r = t.reported, rec = s.plot.recorded[t.id];
      const el = document.createElement('button');
      el.className = 'nb-t' + (t.id === s.activeTarget ? ' on' : '') + (t.alive ? '' : ' dead');
      el.innerHTML = `<b>${t.label}</b> — ${esc(t.name)}${t.armored ? ' (броня, ББ)' : ''}${t.alive ? '' : t.escaped ? ' — ушла' : ' — уничтожена'}` +
        `<span class="co">X ${game.fmt.km(r.x)}  Y ${game.fmt.km(r.y)}${t.moving ? `  курс ${String(Math.round(r.course)).padStart(3, '0')}°  ${Math.round(r.speed)} км/ч` : ''}</span>` +
        `<span class="dimx">донесение от ${game.fmt.time(r.time)}</span>` +
        (rec ? `<span class="ms">замер: пеленг ${rec.bearing.toFixed(1)}°, дальность ${game.fmt.km(rec.range)} км</span>` : '');
      if (t.alive) el.onclick = () => { game.selectTarget(t.id); renderNotebook(); };
      box.appendChild(el);
    });
    if (!box.firstChild) box.innerHTML = '<div>Донесений пока нет.</div>';
    const cp = s.computer, kv = (k, v) => `<div class="nb-kv"><span>${k}</span><b>${v}</b></div>`;
    $('nbComputer').innerHTML = kv('Дальность', game.fmt.km(cp.range) + ' км') + kv('Заряд', cp.charge) +
      kv('Угол возвышения', cp.elevation != null ? cp.elevation.toFixed(2) + '°' + (cp.stale ? ' (устарело)' : '') : '—') + kv('Время полёта', cp.tof != null ? cp.tof.toFixed(1) + ' с' : '—');
    const bt = s.mission.battery;
    $('nbBattery').innerHTML = kv('Координаты', 'X ' + game.fmt.km(bt.x) + '  Y ' + game.fmt.km(bt.y)) + kv('Пеленг башни', s.turret.bearing.toFixed(2) + '°') + kv('Угол ствола', s.turret.elevation.toFixed(2) + '°') +
      kv('В стволе', (s.breech.shell ? (s.breech.shell === 'he' ? 'ОФ' : 'ББ') : 'пусто') + (s.breech.charges ? ', зарядов ' + s.breech.charges : ''));
    $('nbRadio').innerHTML = s.radio.slice().reverse().map((m) => `<div class="nb-msg ${m.kind}"><span class="t">${game.fmt.time(m.time)}</span><b>${m.from}</b>${esc(m.text)}</div>`).join('') || '<div>Эфир молчит.</div>';
  }

  function toast(text) {
    const el = $('toast'); el.textContent = text; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }
  function flash(kind) { const el = $('flash'); el.className = ''; void el.offsetWidth; el.className = kind; }

  // ---------- события игры ----------
  game.on('state', () => { dirty = true; });
  game.on('phase', (ph) => {
    if (ph === 'menu') showMenu();
    else if (ph === 'briefing') showBriefing();
    else if (ph === 'playing') { closeAll(); $('hud').classList.remove('hidden'); unread = 0; $('radio').className = ''; engine.gotoStation('plot', { instant: true }); sfx('ambient', true); dirty = true; }
  });
  game.on('missionEnd', (e) => { sfx('alarm', false); setTimeout(() => { if (s.phase === 'won' || s.phase === 'lost') showResult(e); }, 1400); });
  game.on('radio', (m) => {
    sfx('radio');
    if (!notebookOpen) unread++;
    const el = $('radio'); el.innerHTML = `<b>${m.from}</b>${esc(m.text)}`; el.className = 'show ' + m.kind;
    clearTimeout(radioTimer); radioTimer = setTimeout(() => { el.className = ''; }, 7000);
    dirty = true;
  });
  game.on('denied', (d) => { sfx('buzz'); toast(d.reason); });
  game.on('fired', () => { sfx('fire'); try { engine.shake(0.06, 0.7); } catch (e) { /* нет тряски */ } flash('fire'); if (navigator.vibrate) try { navigator.vibrate(150); } catch (e) { /* нет вибро */ } });
  game.on('impact', () => sfx('impactFar'));
  game.on('batteryHit', (h) => { sfx('impactFar'); if (h.damage > 0) { flash('hit'); try { engine.shake(0.04, 0.5); } catch (e) { /* нет тряски */ } if (navigator.vibrate) try { navigator.vibrate(300); } catch (e) { /* нет вибро */ } toast('ПОПАДАНИЕ ПО БАТАРЕЕ: −' + h.damage + '%'); } });
  engine.on('station', () => { dirty = true; });
  engine.on('swipe', (dir) => { if (s.phase === 'playing' && !s.paused) neighbor(dir > 0 ? 1 : -1); });

  engine.onFrame((dt, time) => {
    if (!dirty && !s.flight.length) return;
    const now = time != null ? time * 1000 : performance.now();
    if (now - lastRender < 110 && lastRender <= now) return;
    lastRender = now; dirty = false;
    if (s.phase === 'playing') { renderHud(); if (notebookOpen) renderNotebook(); }
  });

  // ---------- действия ----------
  const ACT = {
    campaign: showMissions,
    skirmish: () => game.startSkirmish(),
    howto: () => dialog(HOWTO, [{ text: 'ПОНЯТНО', primary: true, fn: showMenu }], showMenu),
    toMenu: showMenu,
    pause: showPause,
    notebook: () => { unread = 0; renderNotebook(); show('notebook'); dirty = true; },
    closeNotebook: () => { closeAll(); dirty = true; },
    speed: () => { game.setSpeed(s.speed === 1 ? 3 : 1); },
    nextTarget: () => {
      const list = s.targets.filter((t) => t.alive && t.reported); if (!list.length) return;
      const i = list.findIndex((t) => t.id === s.activeTarget);
      game.selectTarget(list[(i + 1) % list.length].id);
    },
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act],[data-station],[data-diff],[data-sound]');
    if (!el) return;
    const d = el.dataset;
    if (d.act) { sfx('tick'); ACT[d.act] && ACT[d.act](); }
    else if (d.station) goto(d.station);
    else if (d.diff) { game.setDifficulty(+d.diff); refreshMenu(); sfx('tick'); }
    else if (d.sound) { game.setMuted(d.sound === '0'); sfx('setMuted', game.save.muted); refreshMenu(); sfx('tick'); }
  });
  $('dialog').addEventListener('click', (e) => { if (e.target === $('dialog') && dialogDismiss) dialogDismiss(); });
  window.addEventListener('keydown', (e) => {
    if (s.phase !== 'playing') return;
    if (e.key === 'ArrowRight') neighbor(1); else if (e.key === 'ArrowLeft') neighbor(-1);
    else if (/^[1-6]$/.test(e.key)) goto(STATIONS[+e.key - 1].id);
  });

  // системная кнопка «Назад» и сворачивание приложения (вызываются из MainActivity)
  window.onBackButton = () => {
    if (notebookOpen) { ACT.closeNotebook(); return true; }
    if ($('dialog').classList.contains('show')) { if (dialogDismiss) dialogDismiss(); return true; }
    if ($('missions').classList.contains('show')) { showMenu(); return true; }
    if (s.phase === 'playing') { showPause(); return true; }
    return false;
  };
  window.onAppPause = () => { if (s.phase === 'playing' && !s.paused) showPause(); };

  // Обновление «по воздуху» (см. MainActivity/Updater): приложение спрашивает, можно ли перезапустить игру сейчас.
  window.onUpdateReady = (version) => {
    if (s.phase === 'menu') return true;
    pendingUpdate = version;
    toast('ОБНОВЛЕНИЕ ИГРЫ ЗАГРУЖЕНО — УСТАНОВИТСЯ ПРИ ВЫХОДЕ В МЕНЮ');
    return false;
  };
  window.onAppInfo = (info) => { const el = $('verInfo'); if (el && info) el.textContent = 'ВЕРСИЯ ИГРЫ ' + info.game + (info.bundled ? '' : ' · ОБНОВЛЕНО ПО СЕТИ'); };

  sfx('setMuted', game.save.muted);
  showMenu();
  return { showMenu, goto, toast };
}
