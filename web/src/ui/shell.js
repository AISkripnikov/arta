import { CHANGELOG } from '../changelog.js';
import { createDebrief } from './debrief.js';
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
<h3>3. ЗАРЯЖАНИЕ</h3><p>Ствол — не выше 3°. Откройте затвор, галетником выберите тип снаряда (ОФ — фугасный, ББ — бронебойный по броне, ОСВ, ДЫМ, ШРП) и подайте его, дошлите его, подайте столько зарядов, сколько выбрали на вычислителе, закройте затвор.</p>
<h3>4. ПОВОРОТ</h3><p>Снимите стопор, разверните башню на записанный пеленг (рычаг привода — быстро, маховик — точно), поставьте стопор.</p>
<h3>5. ПОДЪЁМ</h3><p>Маховиком поднимите ствол на вычисленный угол.</p>
<h3>6. ОГОНЬ</h3><p>Проверьте лампы готовности, откройте крышку, взведите цепь стрельбы и дёрните спуск.</p>
<h3>КОРРЕКТИРОВКА</h3><p>После разрыва корректировщик доложит отклонение. Перелёт — уменьшите дальность на вычислителе и пересчитайте угол; ушло вправо — доверните башню влево. Один градус на 10 км — это около 175 м в сторону.</p>
<h3>КАРТА ПЛАНШЕТА</h3><p>После выстрела на карте видна трасса летящего снаряда, а после разрыва — круг с номером выстрела. Через пару секунд самолёт-разведчик присылает аэрофотоснимок района разрыва: воронка или всплеск, сама цель, дома и лес. Рассмотрите его под ЛУПОЙ — так видно, насколько снаряд лёг от цели.</p>
<h3>НОВЫЕ ЦЕЛИ</h3><p>РЛС противника наводит его батареи — пока она цела, они бьют точнее. Подводная лодка через несколько километров погружается и уходит. Береговой форт — только бронебойными, три попадания. Танкер выдерживает три попадания.</p>
<h3>КОНТРБАТАРЕЙНАЯ БОРЬБА</h3><p>Скрытые батареи противника не видит разведка. Их засекают по звуку залпа два поста звукометрии на берегу (ЗВ-1, ЗВ-2): каждый сообщает только пеленг. На планшете от постов проведены линии — батарея там, где они пересекаются. Кочующие батареи после нескольких залпов меняют позицию — ждите новой засечки. Каждый ваш выстрел помогает противнику точнее засечь «Утёс».</p>
<h3>ВЕТЕР</h3><p>Метеопост сообщает ветер в начале боя. Вычислитель сам учитывает его в угле возвышения и выдаёт поправку пеленга: на посту ПОВОРОТ счётчик «ЗАДАНО» показывает пеленг уже с поправкой, а строка внизу экрана — как он получен.</p>
<h3>ЗАСЕЧКА НА «КОМАНДИРЕ»</h3><p>Линии пеленгов звукометрии вы прокладываете сами: коснитесь знака поста (ЗВ-1) на карте — на него переедет ось алидады, — поверните алидаду на сообщённый пеленг и нажмите «ЛИНИЯ». То же для второго поста. Коснитесь «УТЁС», чтобы вернуть ось на батарею перед замером.</p>
<h3>ОЧЕРЕДЬ</h3><p>Переключатель «ОЧЕРЕДЬ» на посту ОГОНЬ: 2 или 3 выстрела подряд на одних установках — расчёт сам перезаряжает. Выгодно после пристрелки, когда снаряды ложатся у цели.</p>
<h3>ПОВРЕЖДЕНИЯ</h3><p>Попадания противника могут вывести из строя привод поворота, элеватор снарядов или освещение. Слева вверху появится сообщение — нажмите «ЧИНИТЬ», ремонтная команда справится за 25 секунд.</p>
<h3>ДВИЖУЩИЕСЯ ЦЕЛИ</h3><p>Стреляйте с упреждением — в точку, где цель окажется через время подготовки плюс время полёта снаряда.</p>
<h3>НОВЫЕ СНАРЯДЫ</h3><p>ОСВ — осветительный: урона не наносит, минуту освещает круг радиусом 1,5 км. ДЫМ — дымовой: положите его в 1–4 км от батареи в сторону орудий противника — минуту они будут бить по «Утёсу» намного хуже. ШРП — шрапнель: накрывает десантные баржи на большой площади, по остальным целям слабее фугасного, броню не берёт.</p>
<h3>НОЧЬ</h3><p>Ночью разведка не видит цель: штаб даёт только квадрат 2×2 км. Поставьте фишку в центр квадрата и выпустите туда осветительный снаряд — пока цель в свете, разведка даёт точные координаты, а корректировщик видит разрывы. Если противник стреляет сам, его засекают «по вспышке» — грубо, с точностью до полукилометра.</p>
<h3>ПОГОДА</h3><p>ТУМАН: донесения приходят вдвое реже, координаты округлены до 100 м, отклонения — до 50 м. ШТОРМ: ветер меняется каждые полторы минуты — метеопост сообщит, решение вычислителя устареет, потяните рычаг ещё раз и доверните башню. Погода и текущий ветер показаны вверху экрана.</p>
<h3>ВИЛКА</h3><p>Тумблер «ВИЛКА» на посту ОГОНЬ: залп двумя стволами, один снаряд ложится на 150 м ближе, другой — на 150 м дальше точки наводки. Если цель оказалась между разрывами — дальность взята верно, остаётся поправить направление. Расходует два снаряда.</p>
<h3>ЗВАНИЯ</h3><p>За победы расчёт получает опыт: звёзды и уничтоженные цели. С каждым званием — от матроса до капитана 3 ранга — расчёт на 5% быстрее работает у затвора и чинит повреждения.</p>
<h3>ОБОРОНА</h3><p>Бой без конца: противник идёт волнами. Отбили волну — батарею подлатают и подвезут снаряды. Прорвавшаяся цель стоит 25% прочности. Сколько волн продержитесь?</p>
<h3>РАЗБОР БОЯ</h3><p>После боя кнопка «РАЗБОР БОЯ» открывает карту: истинный путь каждой цели, все ваши разрывы по номерам и таблица выстрелов. Коснитесь строки — разрыв подсветится на карте.</p>`;

const DIFF_HINT = [
  'Курсант: визир сам примагничивается к фишке, корректировщик даёт готовые поправки, противник бьёт слабее.',
  'Командир: всё вручную. Корректировщик сообщает только отклонение в метрах.',
];

export function createShell({ engine, game, stations = [] }) {
  const s = game.state;
  const sfx = (name, ...a) => { try { const f = engine.audio && engine.audio[name]; if (f) f.apply(engine.audio, a); } catch (e) { /* звук не критичен */ } };
  let pendingUpdate = 0;
  let dirty = true, lastRender = 0, notebookOpen = false, unread = 0, dialogDismiss = null, radioTimer = 0, toastTimer = 0;

  // ---------- экраны ----------
  const screens = ['loading', 'menu', 'missions', 'dialog', 'notebook', 'debrief'];
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

  // ---------- звание ----------
  const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many; };
  function getRank() { try { return game.rank(); } catch (e) { return { index: 0, name: 'МАТРОС', xp: (game.save && game.save.xp) || 0, next: null, bonus: 0 }; } }
  function rankPct(rk) {
    if (rk.next == null) return 100;
    const prev = (game.ranks && game.ranks[rk.index] && game.ranks[rk.index].xp) || 0;
    return Math.max(0, Math.min(100, ((rk.xp - prev) / Math.max(1, rk.next - prev)) * 100));
  }
  const SH = () => game.SHELLS || { he: { name: 'ОФ' }, ap: { name: 'ББ' } };
  const shellName = (k) => (SH()[k] || {}).name || String(k).toUpperCase();
  const WX = { fog: 'ТУМАН', storm: 'ШТОРМ' };
  const windText = (w) => (w && w.speed > 0.05 ? String(Math.round(w.from)).padStart(3, '0') + '° ' + (Math.round(w.speed * 10) / 10) + ' м/с' : 'штиль');

  // ---------- меню ----------
  function refreshMenu() {
    document.querySelectorAll('#diffSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.diff === s.difficulty));
    document.querySelectorAll('#soundSeg button').forEach((b) => b.classList.toggle('on', (b.dataset.sound === '1') === !game.save.muted));
    $('diffHint').textContent = DIFF_HINT[s.difficulty];
    const rk = getRank();
    $('rankName').textContent = 'ЗВАНИЕ: ' + rk.name;
    $('rankXp').textContent = rk.next != null ? rk.xp + ' / ' + rk.next : rk.xp + ' · ВЫСШЕЕ';
    $('rankBar').style.width = rankPct(rk) + '%';
    const sb = game.save.survivalBest;
    $('survBest').textContent = sb ? 'РЕКОРД: ' + sb.waves + ' ' + plural(sb.waves, 'ВОЛНА', 'ВОЛНЫ', 'ВОЛН') + ' · ' + sb.kills + ' ' + plural(sb.kills, 'ЦЕЛЬ', 'ЦЕЛИ', 'ЦЕЛЕЙ') : '';
  }
  function showMenu() {
    $('hud').classList.add('hidden'); refreshMenu(); show('menu'); sfx('ambient', false);
    // скачанное обновление игры применяем, когда игрок вышел в меню
    if (pendingUpdate) { pendingUpdate = 0; try { window.ArtaNative.applyUpdate(); } catch (e) { /* не в приложении */ } }
  }
  function showMissions() {
    const grid = $('missionGrid'); grid.innerHTML = '';
    game.campaign.forEach((m, i) => {
      const SEC = { 0: 'ЧАСТЬ I · БЕРЕГОВАЯ ОБОРОНА', 8: 'ЧАСТЬ II · КОНТРБАТАРЕЙНАЯ БОРЬБА', 16: 'ЧАСТЬ III · ОСТРОВА В ОГНЕ', 24: 'ЧАСТЬ IV · НОЧЬ И ТУМАН' };
      if (SEC[i]) { const h = document.createElement('div'); h.className = 'm-sec'; h.textContent = SEC[i]; grid.appendChild(h); }
      const locked = i >= game.save.unlocked, st = game.save.stars[i] || 0;
      const el = document.createElement('button');
      el.className = 'm-card' + (locked ? ' locked' : '');
      const rc = game.save.records && game.save.records[i];
      el.innerHTML = `<span class="num">ЗАДАНИЕ ${i + 1}${locked ? ' · ЗАКРЫТО' : (m.night ? ' · НОЧЬ' : '') + (WX[m.weather] ? ' · ' + WX[m.weather] : '')}</span><span class="nm">${esc(m.name.toUpperCase())}</span><span class="st">${'★'.repeat(st)}<i>${'★'.repeat(3 - st)}</i>${rc ? `<em>${rc.shots} ВЫСТР. · ${game.fmt.time(rc.time)}</em>` : ''}</span>`;
      if (!locked) el.onclick = () => { sfx('tick'); game.startMission(i); };
      grid.appendChild(el);
    });
    show('missions');
  }
  function briefingHtml() {
    const m = s.mission;
    const list = s.targets.map((t) => `<li>${esc(t.name)}${t.armored ? ' — бронирована, нужен ББ' : ''}${t.moving ? ' — движется' : ''}</li>`).join('');
    const stock = Object.keys(SH()).filter((k) => s.shells[k] > 0).map((k) => shellName(k) + ' ' + s.shells[k]).join(', ') || 'нет';
    const cond = [];
    if (m.night) cond.push('<b>НОЧЬ</b> — разведка даёт только квадрат; подсветите цель осветительным снарядом (ОСВ).');
    if (m.weather === 'fog') cond.push('<b>ТУМАН</b> — донесения реже и грубее (до 100 м), корректировка до 50 м.');
    if (m.weather === 'storm') cond.push('<b>ШТОРМ</b> — ветер меняется по ходу боя, пересчитывайте решение после сводки МЕТЕО.');
    if (m.survival) cond.push('<b>ОБОРОНА</b> — волна за волной. За отбитую волну: +25% прочности и снаряды. Прорыв цели: −25%.');
    return `<h2>${m.index != null ? 'ЗАДАНИЕ ' + (m.index + 1) + '. ' : ''}${esc(m.name.toUpperCase())}</h2><p>${esc(m.brief || '')}</p>` +
      (cond.length ? `<h3>УСЛОВИЯ</h3><ul>${cond.map((c) => `<li>${c}</li>`).join('')}</ul>` : '') +
      `<h3>${m.survival ? 'ПЕРВАЯ ВОЛНА' : 'ЦЕЛИ'}</h3><ul>${list}</ul><p class="dim">Боезапас: ${stock}. Ветер: ${windText(m.wind)}. Сложность: ${game.difficulties[s.difficulty]}. Звание расчёта: ${getRank().name.toLowerCase()}.</p>`;
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
  let lastEnd = null;
  function showResult(e) {
    lastEnd = e;
    const st = e.stats || {}, sv = e.survival, m = s.mission || {};
    const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    let html;
    if (sv) {
      html = `<h2>ОБОРОНА ОКОНЧЕНА</h2><p class="bad">${esc(e.reason || '')}</p><table class="stats">` +
        row('Отбито волн', sv.waves) + row('Уничтожено целей', sv.kills) + row('Выстрелов', st.shots != null ? st.shots : s.shots) + row('Время', game.fmt.time(st.time != null ? st.time : s.time)) +
        (sv.best ? row('Лучший результат', sv.best.waves + ' ' + plural(sv.best.waves, 'волна', 'волны', 'волн') + ', ' + sv.best.kills + ' ' + plural(sv.best.kills, 'цель', 'цели', 'целей')) : '') + '</table>' +
        (sv.isNew && sv.waves > 0 ? `<p class="rec">★ НОВЫЙ РЕКОРД ОБОРОНЫ${sv.previous ? ` (был: ${sv.previous.waves} ${plural(sv.previous.waves, 'волна', 'волны', 'волн')})` : ''}</p>` : '');
    } else {
      html = `<h2>${e.won ? 'ЗАДАНИЕ ВЫПОЛНЕНО' : 'ЗАДАНИЕ ПРОВАЛЕНО'}</h2>` +
        (e.won ? `<div class="stars">${'★'.repeat(e.stars)}<i>${'★'.repeat(3 - e.stars)}</i></div>` : `<p class="bad">${esc(e.reason || '')}</p>`) +
        '<table class="stats">' + row('Выстрелов', st.shots + (st.combatShots != null && st.combatShots !== st.shots ? ` (боевых ${st.combatShots})` : '')) + row('Норматив на «отлично»', st.par) +
        row('Уничтожено целей', st.destroyed + ' / ' + st.total) + row('Прочность батареи', st.integrity + '%') + row('Время', game.fmt.time(st.time)) + '</table>' +
        (e.record ? (e.record.isNew ? `<p class="rec">★ НОВЫЙ РЕКОРД ЗАДАНИЯ${e.record.previous ? ` (был: ${e.record.previous.shots} выстр., ${game.fmt.time(e.record.previous.time)})` : ''}</p>`
          : `<p class="dim">Рекорд задания: ${e.record.best.shots} выстр., ${game.fmt.time(e.record.best.time)}, ★${e.record.best.stars}</p>`) : '');
    }
    // опыт и звание расчёта
    const rk = e.rank || getRank();
    if (e.rankUp) html += `<div class="rankup">НОВОЕ ЗВАНИЕ: ${esc(rk.name)}</div>`;
    html += `<div class="xp"><div class="rank-l"><span>ОПЫТ +${e.xpGained || 0} · ${esc(rk.name)}</span><span>${rk.next != null ? rk.xp + ' / ' + rk.next : rk.xp}</span></div><div class="rank-bar"><i style="width:${rankPct(rk)}%"></i></div></div>`;
    const idx = m.index, btns = [];
    if (e.won && idx != null && idx + 1 < game.campaign.length) btns.push({ text: 'СЛЕДУЮЩЕЕ', primary: true, fn: () => game.startMission(idx + 1) });
    if (m.survival) btns.push({ text: 'ЕЩЁ РАЗ', primary: !btns.length, fn: () => game.startSurvival() });
    else if (m.skirmish || idx == null) btns.push({ text: 'НОВЫЙ БОЙ', primary: !btns.length, fn: () => game.startSkirmish() });
    else btns.push({ text: 'ПОВТОРИТЬ', primary: !btns.length, fn: () => game.startMission(idx) });
    btns.push({ text: 'РАЗБОР БОЯ', fn: showDebrief });
    btns.push({ text: 'В МЕНЮ', ghost: true, fn: () => game.quit() });
    dialog(html, btns);
  }

  // ---------- разбор боя ----------
  const debrief = createDebrief({ game, canvas: $('dbfCanvas'), table: $('dbfTable'), legend: $('dbfLegend'), zoomBtn: $('dbfZoom') });
  function showDebrief() { if (!lastEnd) return; show('debrief'); debrief.open(lastEnd, s); }
  function closeDebrief() { if (lastEnd && (s.phase === 'won' || s.phase === 'lost')) showResult(lastEnd); else showMenu(); }

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

  const ang = (a, b) => { let d = ((a - b) % 360 + 360) % 360; if (d > 180) d -= 360; return d; };
  const loadingStation = stations.find((x) => x && x.id === 'loading');
  /** Следующий шаг процедуры: пост, текст подсказки и орган управления для подсветки. */
  function nextStep() {
    const c = s.checklist, b = s.breech, cp = s.computer;
    if (s.flight.length && !b.shell && !b.open && !(b.busy && b.busy.kind === 'auto')) return { st: null, text: 'Снаряд в полёте — следите за картой на ПЛАНШЕТЕ и ждите доклада' };
    if (b.busy && b.busy.kind === 'auto') return { st: null, text: 'Очередь: расчёт перезаряжает орудие' };
    if (!s.activeTarget) {
      if (s.mission.survival && !s.targets.some((t) => t.alive)) return { st: null, text: 'Волна отбита — ждите следующую' };
      if (s.targets.some((t) => t.alive && (t.reported || t.area))) return { st: null, text: 'Выберите цель: кнопка «ЦЕЛЬ ▸» вверху' };
      return { st: null, text: 'Ждите донесения разведки или звукометрии' };
    }
    const at = s.targets.find((t) => t.id === s.activeTarget);
    // ночь: о цели известен только квадрат (или грубая засечка по вспышке) — сначала осветительный
    const blind = !!(s.mission.night && at && at.alive && at.locate !== 'sound' && !at.lit && (!at.reported || at.reported.rough));
    const needIllum = blind && s.shells.illum + (b.shell === 'illum' ? 1 : 0) > 0 && !s.flight.some((f) => f.shell === 'illum');
    const wantShell = at && at.armored ? 'ap' : needIllum ? 'illum' : at && at.kind === 'landing' && s.shells.shrap > 0 ? 'shrap' : 'he';
    const rec = s.plot.recorded[s.activeTarget];
    if (!c.measured) {
      const pin = s.plot.pins[s.activeTarget];
      const sound = at && at.reported && at.reported.sound;
      if (!pin) return { st: 'plot', hot: 'pin' + s.activeTarget, text: sound ? 'ПЛАНШЕТ: перетащите фишку на пересечение пеленгов звукометрии'
        : at && !at.reported && at.area ? 'НОЧЬ: цель не видна. ПЛАНШЕТ: поставьте фишку в центр квадрата — туда пойдёт осветительный снаряд'
          : at && at.reported && at.reported.rough ? 'ПЛАНШЕТ: фишку — на засечку «по вспышке» (грубо, ±0,5 км)' : 'ПЛАНШЕТ: перетащите фишку на карту по координатам X и Y из донесения' };
      if (s.plot.pivot) return { st: 'plot', text: 'ПЛАНШЕТ: коснитесь знака «УТЁС», чтобы вернуть ось алидады на батарею' };
      const bat = s.mission.battery, A = s.plot.alidade, R = Math.PI / 180;
      const sx = bat.x + A.range * Math.sin(A.bearing * R), sy = bat.y + A.range * Math.cos(A.bearing * R);
      if (Math.hypot(sx - pin.x, sy - pin.y) > 0.03) return { st: 'plot', hot: 'sight', text: 'ПЛАНШЕТ: наведите визир алидады на фишку (тяните визир или крутите маховики)' };
      return { st: 'plot', hot: 'btnRecord', text: 'ПЛАНШЕТ: нажмите «ЗАПИСАТЬ»' };
    }
    if (!c.computed) {
      if (Math.abs(cp.range - rec.range) > 0.005) return { st: 'computer', hot: 'rangeWheel', text: 'ВЫЧИСЛИТЕЛЬ: маховиком наберите дальность ' + game.fmt.km(rec.range) + ' км' };
      if (game.chargeStates()[cp.charge - 1] !== 'ok') return { st: 'computer', hot: 'chargeSelector', text: 'ВЫЧИСЛИТЕЛЬ: выберите заряд с зелёной лампой' };
      return { st: 'computer', hot: 'computeLever', text: cp.stale && cp.elevation != null && s.mission.weather === 'storm' ? 'ВЫЧИСЛИТЕЛЬ: ветер сменился — потяните рычаг «ВЫЧИСЛИТЬ» ещё раз' : 'ВЫЧИСЛИТЕЛЬ: потяните рычаг «ВЫЧИСЛИТЬ» вниз' };
    }
    if (!c.loaded) {
      if (!b.open && !b.shell && s.turret.elevation > game.C.LOAD_ANGLE) return { st: 'elevation', hot: 'loadAngleButton', text: 'ПОДЪЁМ: держите «НА УГОЛ ЗАРЯЖАНИЯ» — ствол должен опуститься до ' + game.C.LOAD_ANGLE + '°' };
      if (!b.open && !b.shell) return { st: 'loading', hot: 'breechLever', text: 'ЗАРЯЖАНИЕ: откройте затвор рычагом' };
      if (!b.shell) {
        const why = wantShell === 'ap' ? ' (цель бронирована)' : wantShell === 'illum' ? ' — выпустите осветительный снаряд в район цели' : wantShell === 'shrap' ? ' (шрапнель — по десанту)' : '';
        const picked = loadingStation && loadingStation.controls ? loadingStation.controls.shellType : null;
        return { st: 'loading', hot: picked && picked !== wantShell ? 'shellSelector' : 'hoistButton', text: 'ЗАРЯЖАНИЕ: галетником выберите ' + shellName(wantShell) + ' и нажмите «ПОДАТЬ СНАРЯД»' + why };
      }
      if (!b.rammed) return { st: 'loading', hot: 'ramLever', text: 'ЗАРЯЖАНИЕ: дошлите снаряд рычагом «ДОСЛАТЬ»' };
      if (b.charges < cp.charge) return { st: 'loading', hot: 'chargePlus', text: 'ЗАРЯЖАНИЕ: подайте заряды — нужно ' + cp.charge + ', подано ' + b.charges };
      if (b.charges > cp.charge) return { st: 'loading', hot: 'chargeMinus', text: 'ЗАРЯЖАНИЕ: лишний заряд! Нужно ' + cp.charge };
      return { st: 'loading', hot: 'breechLever', text: 'ЗАРЯЖАНИЕ: закройте затвор' };
    }
    if (b.charges !== cp.charge) return { st: 'loading', text: 'Заряжено ' + b.charges + ', а расчёт на заряд ' + cp.charge + ' — пересчитайте или перезарядите' };
    if (!c.traversed) {
      const want = ((rec.bearing + (cp.windBearing || 0)) % 360 + 360) % 360, err = ang(s.turret.bearing, want);
      const wtxt = cp.windBearing ? ' (' + rec.bearing.toFixed(1) + '° ' + (cp.windBearing > 0 ? '+' : '−') + Math.abs(cp.windBearing).toFixed(1) + '° на ветер)' : '';
      if (Math.abs(err) > 0.5) {
        if (s.turret.brake) return { st: 'traverse', hot: 'brakeLever', text: 'ПОВОРОТ: снимите стопор' };
        return { st: 'traverse', hot: Math.abs(err) > 3 && !s.faults.drive ? 'slewLever' : 'fineWheel', text: 'ПОВОРОТ: разверните башню на ' + want.toFixed(1) + '°' + wtxt };
      }
      return { st: 'traverse', hot: 'brakeLever', text: 'ПОВОРОТ: поставьте стопор' };
    }
    if (!c.elevated) return { st: 'elevation', hot: 'elevWheel', text: 'ПОДЪЁМ: поднимите ствол маховиком на ' + cp.elevation.toFixed(2) + '°' };
    if (!c.armed) return { st: 'fire', hot: 'armCover', text: 'ОГОНЬ: откройте красную крышку и взведите цепь стрельбы' };
    return { st: 'fire', hot: 'fireLever', text: b.shell === 'illum' ? 'ОГОНЬ: осветительный в стволе — потяните спуск вниз!' : blind && needIllum ? 'ОГОНЬ: цель не освещена — лучше сначала осветительный. Спуск — вниз' : 'ОГОНЬ: потяните спуск вниз!' };
  }

  // ---------- подсветка органа управления ----------
  const hl = document.createElement('div');
  hl.id = 'highlight';
  document.getElementById('hud').appendChild(hl);
  const _hv = new engine.THREE.Vector3(), _hs = {};
  let hlStep = null;
  function placeHighlight() {
    const st = hlStep;
    const station = st && st.hot && stations.find((x) => x.id === st.st);
    const obj = station && station.hotspots && station.hotspots[st.hot];
    if (!obj || !obj.getWorldPosition || engine.current !== st.st || engine.flying || s.phase !== 'playing' || s.paused) { hl.style.display = 'none'; return; }
    // фишку берут за ручку-диск — подсвечиваем её
    const handle = /^pin\d+$/.test(st.hot) && station.api && station.api.pinHandleWorld ? station.api.pinHandleWorld(+st.hot.slice(3)) : null;
    if (handle) _hv.copy(handle); else obj.getWorldPosition(_hv);
    const sc = engine.input.toScreen(_hv, _hs);
    const W = window.innerWidth, H = window.innerHeight;
    if (sc.behind || sc.x < -20 || sc.y < -20 || sc.x > W + 20 || sc.y > H + 20) { hl.style.display = 'none'; return; }
    hl.style.display = 'block';
    hl.style.left = (sc.x - 32) + 'px'; hl.style.top = (sc.y - 32) + 'px';
  }

  const shellSeen = {}; let shKey = '', wxKey = '', windChangedAt = -1e9;
  function renderHud() {
    // пост — в атрибуте HUD: на посту ОГОНЬ строка радио уходит влево, чтобы не закрывать смотровую щель
    const hudEl = $('hud'); if (hudEl.dataset.st !== engine.current) hudEl.dataset.st = engine.current || '';
    $('hTime').textContent = game.fmt.time(s.time);
    const hi = $('hInt'); hi.style.width = Math.max(0, s.integrity) + '%'; hi.className = s.integrity <= 35 ? 'crit' : s.integrity <= 65 ? 'warn' : '';
    // снаряды: только те типы, что есть (или были) в этом бою
    const keys = Object.keys(SH());
    keys.forEach((k) => { if (s.shells[k] > 0) shellSeen[k] = true; });
    const shHtml = keys.filter((k) => shellSeen[k]).map((k) => `<span${s.shells[k] > 0 ? '' : ' class="zero"'}><b>${shellName(k)}</b> ${s.shells[k] || 0}</span>`).join('');
    if (shHtml !== shKey) { shKey = shHtml; $('hShells').innerHTML = shHtml; }
    $('hTimeK').textContent = s.mission.survival ? 'ВОЛНА ' + (s.wave || 1) : 'ВРЕМЯ';
    const m = s.mission, wxHtml = (m.night ? '<i class="night">НОЧЬ</i>' : '') + (WX[m.weather] ? `<i class="${m.weather}">${WX[m.weather]}</i>` : '') || 'ВЕТЕР';
    if (wxHtml !== wxKey) { wxKey = wxHtml; $('hWx').innerHTML = wxHtml; }
    $('hWind').textContent = windText(m.wind).toUpperCase(); $('hWind').classList.toggle('chg', s.time < windChangedAt + 12);
    const a = s.targets.find((t) => t.id === s.activeTarget);
    $('hTarget').textContent = a ? a.label + ' · ' + a.name.toUpperCase() : '—';
    $('hSpeed').textContent = '×' + s.speed; $('hSpeed').classList.toggle('on', s.speed > 1);
    $('hUnread').style.display = unread ? 'block' : 'none'; $('hUnread').textContent = unread;

    const rec = a ? s.plot.recorded[a.id] : null, cp = s.computer, parts = [];
    if (rec) {
      const wb = cp.elevation != null && !cp.stale ? cp.windBearing || 0 : 0;
      parts.push(`<b>ПЕЛЕНГ</b> ${rec.bearing.toFixed(1)}°` + (wb ? ` ${wb > 0 ? '+' : '−'} ${Math.abs(wb).toFixed(1)}° <b>ВЕТЕР</b> = ${(((rec.bearing + wb) % 360 + 360) % 360).toFixed(1)}°` : '') + ` <b>ДАЛЬН.</b> ${game.fmt.km(rec.range)}`);
    }
    if (cp.elevation != null) parts.push(`<b>ЗАРЯД</b> ${cp.charge} <b>УГОЛ</b> ${cp.elevation.toFixed(2)}° <b>ПОЛЁТ</b> ${cp.tof.toFixed(1)} с${cp.stale ? ' <b>(УСТАРЕЛО)</b>' : ''}`);
    const fr = s.fire || {};
    if (fr.salvo || fr.burst > 1) parts.push((fr.salvo ? '<b>ВИЛКА</b> ±150 м' : '') + (fr.salvo && fr.burst > 1 ? ' ' : '') + (fr.burst > 1 ? `<b>ОЧЕРЕДЬ</b> ${fr.burstLeft > 0 ? fr.burstLeft + '/' : ''}${fr.burst}` : ''));
    $('memo').innerHTML = parts.join(' &nbsp;·&nbsp; ') || '<b>ЗАМЕРОВ НЕТ</b>';

    const step = nextStep(), hints = s.mission && (s.mission.tutorial || s.difficulty === 0);
    $('hint').textContent = hints ? step.text : '';
    hlStep = hints ? step : null;
    renderFaults();
    nav.querySelectorAll('button').forEach((b, i) => {
      const st = STATIONS[i];
      b.classList.toggle('on', engine.current === st.id);
      b.classList.toggle('done', !!s.checklist[st.check]);
      b.classList.toggle('next', hints && step.st === st.id);
    });
    const fc = $('flightChip');
    if (s.flight.length) { const rem = Math.min(...s.flight.map((f) => f.tof - f.t)); fc.innerHTML = 'СНАРЯД В ПОЛЁТЕ <b>' + Math.max(0, rem).toFixed(0) + ' с</b>' + (engine.current !== 'plot' ? ' · НА КАРТЕ ▸' : ''); fc.classList.remove('hidden'); }
    else fc.classList.add('hidden');
  }

  const FAULT_NAMES = { drive: 'ПРИВОД ПОВОРОТА', hoist: 'ЭЛЕВАТОР СНАРЯДОВ', lights: 'ОСВЕЩЕНИЕ' };
  let faultsKey = '';
  function renderFaults() {
    const f = s.faults || {}, r = s.repair;
    const key = JSON.stringify(f) + (r ? r.kind + Math.floor((r.t / r.dur) * 20) : '');
    if (key === faultsKey) return;
    faultsKey = key;
    const box = $('faults');
    box.innerHTML = '';
    Object.keys(FAULT_NAMES).filter((k) => f[k]).forEach((k) => {
      const el = document.createElement('button');
      el.className = 'fault' + (r && r.kind === k ? ' fixing' : '');
      el.innerHTML = '⚠ ' + FAULT_NAMES[k] + (r && r.kind === k ? ` <i>РЕМОНТ ${Math.round((r.t / r.dur) * 100)}%</i>` : r ? ' <i>ОЖИДАЕТ</i>' : ' <b>ЧИНИТЬ</b>');
      el.onclick = () => { sfx('tick'); game.repair(k); };
      box.appendChild(el);
    });
  }

  const smoked = (id) => { try { return !!(s.smokes && s.smokes.length && game.smoked(id)); } catch (e) { return false; } };
  function renderNotebook() {
    const box = $('nbTargets'); box.innerHTML = '';
    const fog = s.mission.weather === 'fog';
    s.targets.filter((t) => t.reported || t.area).forEach((t) => {
      const r = t.reported, rec = s.plot.recorded[t.id], a = t.area;
      const el = document.createElement('button');
      el.className = 'nb-t' + (t.id === s.activeTarget ? ' on' : '') + (t.alive ? '' : ' dead');
      const p2 = (v) => String(Math.round(v)).padStart(2, '0');
      const areaTxt = a ? `<span class="ar">квадрат X ${p2(a.x0)}–${p2(a.x1)}, Y ${p2(a.y0)}–${p2(a.y1)}</span>` : '';
      let body;
      if (!r) body = areaTxt + '<span class="dimx">точных координат нет — нужен осветительный снаряд</span>';
      else if (r.sound) body = `<span class="co">${r.sound.map((q) => q.name + ' (X ' + game.fmt.km(q.x) + ' Y ' + game.fmt.km(q.y) + ') → ' + game.fmt.brg(q.bearing)).join('<br>')}</span><span class="dimx">донесение от ${game.fmt.time(r.time)}</span>`;
      else body = (r.rough ? areaTxt : '') + `<span class="co">${r.rough ? '≈ ' : ''}X ${game.fmt.km(r.x)}  Y ${game.fmt.km(r.y)}${t.moving && !r.rough ? `  курс ${String(Math.round(r.course)).padStart(3, '0')}°  ${Math.round(r.speed)} км/ч` : ''}</span>` +
        `<span class="dimx">${r.rough ? 'по вспышке, ±0,5 км · ' : fog ? 'туман, до 0,1 км · ' : ''}донесение от ${game.fmt.time(r.time)}${s.mission.night && t.locate !== 'sound' && !r.rough && !t.lit && t.alive ? ' · свет погас, не обновляется' : ''}</span>`;
      el.innerHTML = `<b>${t.label}</b> — ${esc(t.name)}${t.armored ? ' (броня, ББ)' : ''}${t.alive ? '' : t.escaped ? ' — ушла' : ' — уничтожена'}` +
        (t.alive && t.lit ? '<span class="tag">ОСВЕЩЕНА</span>' : '') + (t.alive && r && r.rough ? '<span class="tag">ГРУБО</span>' : '') + (t.alive && smoked(t.id) ? '<span class="tag">В ДЫМУ</span>' : '') + body +
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
      kv('В стволе', (s.breech.shell ? shellName(s.breech.shell) : 'пусто') + (s.breech.charges ? ', зарядов ' + s.breech.charges : '')) +
      kv('Ветер', windText(s.mission.wind) + (s.mission.weather === 'storm' ? ' (шторм, меняется)' : '')) +
      (s.mission.night || s.mission.weather === 'fog' ? kv('Условия', [s.mission.night ? 'ночь' : '', s.mission.weather === 'fog' ? 'туман' : ''].filter(Boolean).join(', ')) : '') +
      ((s.lights || []).length ? kv('Осветительные горят', s.lights.map((l) => Math.max(0, Math.round(l.until - s.time)) + ' с').join(', ')) : '') +
      ((s.smokes || []).length ? kv('Дымовая завеса', s.smokes.map((l) => game.fmt.brg(l.bearing) + ' · ' + Math.max(0, Math.round(l.until - s.time)) + ' с').join(', ')) : '') +
      kv('Расчёт', getRank().name.toLowerCase());
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
    else if (ph === 'playing') { closeAll(); $('hud').classList.remove('hidden'); unread = 0; lastEnd = null; Object.keys(shellSeen).forEach((k) => delete shellSeen[k]); Object.keys(SH()).forEach((k) => { if (s.shells[k] > 0) shellSeen[k] = true; }); shKey = wxKey = ''; windChangedAt = -1e9; $('radio').className = ''; engine.gotoStation('plot', { instant: true }); sfx('ambient', true); dirty = true; }
  });
  game.on('missionEnd', (e) => { sfx('alarm', false); lastEnd = e; setTimeout(() => { if ((s.phase === 'won' || s.phase === 'lost') && lastEnd === e) showResult(e); }, 1400); });
  game.on('wind', () => { windChangedAt = s.time; dirty = true; });
  game.on('wave', (w) => { if (w && w.cleared) flash('wave'); dirty = true; });
  game.on('radio', (m) => {
    sfx('radio');
    if (!notebookOpen) unread++;
    const el = $('radio'); el.innerHTML = `<b>${m.from}</b>${esc(m.text)}`; el.className = 'show ' + m.kind;
    clearTimeout(radioTimer); radioTimer = setTimeout(() => { el.className = ''; }, 7000);
    dirty = true;
  });
  game.on('denied', (d) => { sfx('buzz'); toast(d.reason); });
  game.on('fired', () => { sfx('fire'); try { engine.shake(0.06, 0.7); } catch (e) { /* нет тряски */ } flash('fire'); if (navigator.vibrate) try { navigator.vibrate(150); } catch (e) { /* нет вибро */ } });
  // гром нашего разрыва доходит с задержкой и тем тише, чем дальше
  game.on('impact', (e) => {
    const bat = s.mission && s.mission.battery;
    const d = bat ? Math.hypot(e.x - bat.x, e.y - bat.y) : 8;
    setTimeout(() => sfx('thunder', 1.3 - d / 20), Math.min(3500, d * 260) / (s.speed || 1));
  });
  game.on('incoming', (e) => { sfx('whistle', e.eta * 0.92 / (s.speed || 1)); });
  game.on('fault', (e) => { if (!e.fixed) { sfx('alarm', true); setTimeout(() => sfx('alarm', false), 1600); } faultsKey = ''; });
  $('flightChip').addEventListener('click', () => { if (s.phase === 'playing') goto('plot'); });
  game.on('batteryHit', (h) => { sfx(h.damage > 0 ? 'impactNear' : 'impactFar'); if (h.damage > 0) { flash('hit'); try { engine.shake(0.04, 0.5); } catch (e) { /* нет тряски */ } if (navigator.vibrate) try { navigator.vibrate(300); } catch (e) { /* нет вибро */ } toast((h.escape ? 'ЦЕЛЬ ПРОРВАЛАСЬ: −' : 'ПОПАДАНИЕ ПО БАТАРЕЕ: −') + h.damage + '%'); } });
  engine.on('station', () => { $('hud').dataset.st = engine.current || ''; dirty = true; });
  engine.on('swipe', (dir) => { if (s.phase === 'playing' && !s.paused) neighbor(dir > 0 ? 1 : -1); });

  const baseExposure = engine.renderer.toneMappingExposure || 1;
  let flick = 0, nightOn = false;
  engine.onFrame((dt) => {
    if (s.phase === 'playing') placeHighlight(); else hl.style.display = 'none';
    // отказ освещения: в башне темно, аварийный свет мигает
    const dark = s.phase === 'playing' && s.faults && s.faults.lights;
    flick = Math.max(0, flick - dt);
    if (dark && Math.random() < dt * 0.8) flick = 0.12 + Math.random() * 0.2;
    // ночь: боевое красное освещение — приглушаем сцену и накладываем красный фильтр (вместе с отказом света — ещё темнее)
    const night = (s.phase === 'playing' || s.phase === 'won' || s.phase === 'lost') && !!(s.mission && s.mission.night);
    if (night !== nightOn) { nightOn = night; $('night').classList.toggle('on', night); }
    const target = (dark ? (flick > 0 ? 0.12 : 0.27) : 1) * (night ? 0.82 : 1);
    engine.renderer.toneMappingExposure += (baseExposure * target - engine.renderer.toneMappingExposure) * Math.min(1, dt * (flick > 0 ? 30 : 4));
  });
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
    survival: () => game.startSurvival(),
    debriefZoom: () => debrief.toggleZoom(),
    closeDebrief,
    howto: () => dialog(HOWTO, [{ text: 'ПОНЯТНО', primary: true, fn: showMenu }], showMenu),
    news: () => showNews(CHANGELOG, true),
    toMenu: showMenu,
    pause: showPause,
    notebook: () => { unread = 0; renderNotebook(); show('notebook'); dirty = true; },
    closeNotebook: () => { closeAll(); dirty = true; },
    speed: () => { game.setSpeed(s.speed === 1 ? 3 : 1); },
    nextTarget: () => {
      const list = s.targets.filter((t) => t.alive && (t.reported || t.area)); if (!list.length) return;
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
    if ($('debrief').classList.contains('show')) { closeDebrief(); return true; }
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
  if (window.__appInfo) window.onAppInfo(window.__appInfo);

  // ---------- «ЧТО НОВОГО» ----------
  const NEWS_KEY = 'arta2.news';
  const readSeen = () => { try { return +(localStorage.getItem(NEWS_KEY) || 0); } catch (e) { return 0; } };
  const markSeen = () => { try { localStorage.setItem(NEWS_KEY, String(CHANGELOG[0].id)); } catch (e) { /* хранилище недоступно */ } };
  function showNews(list, all) {
    const html = '<h2>ЧТО НОВОГО</h2>' + list.map((e, i) =>
      `<h3>${esc(e.title.toUpperCase())}${all && i === 0 ? ' · ТЕКУЩАЯ ВЕРСИЯ' : ''}</h3><ul>${e.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`).join('');
    markSeen();
    dialog(html, [{ text: 'ПОНЯТНО', primary: true, fn: showMenu }], showMenu);
  }
  /** После обновления — один раз показать то, чего игрок ещё не видел (не больше трёх последних выпусков). */
  function maybeShowNews() {
    const seen = readSeen(), fresh = CHANGELOG.filter((e) => e.id > seen);
    if (!fresh.length || s.phase !== 'menu') return;
    showNews(fresh.slice(0, 3), false);
  }

  sfx('setMuted', game.save.muted);
  showMenu();
  maybeShowNews();
  return { showMenu, goto, toast, nextStep, showDebrief, debrief };
}
