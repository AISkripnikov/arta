import { CHANGELOG } from '../changelog.js';
import { createDebrief } from './debrief.js';
import { createSettings } from './settings.js';
import { createUpgrades } from './upgrades.js';
import { todayKey, dailyMenuText, dailyResultHtml, resumeHtml } from './daily.js';
import { createCrew, crewStateText } from './crew.js';
// DOM-оболочка: меню, HUD, блокнот, брифинг, итоги. Общие эффекты (звук выстрела, тряска, вспышки).
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export const STATIONS = [
  { id: 'plot', title: 'ПЛАНШЕТ', check: 'measured' },
  { id: 'computer', title: 'ВЫЧИСЛИТЕЛЬ', short: 'ВЫЧИСЛ.', check: 'computed' },
  { id: 'loading', title: 'ЗАРЯЖАНИЕ', short: 'ЗАРЯЖ.', check: 'loaded' },
  { id: 'traverse', title: 'ПОВОРОТ', check: 'traversed' },
  { id: 'elevation', title: 'ПОДЪЁМ', check: 'elevated' },
  { id: 'fire', title: 'ОГОНЬ', check: 'armed' },
  { id: 'observe', title: 'НАБЛЮДЕНИЕ', short: 'НАБЛЮД.' },
  { id: 'aa', title: 'ЗЕНИТКА' },
];

const HOWTO = `
<h2>КАК ИГРАТЬ</h2>
<p>Вы — оператор башни береговой батареи. Цель не видна: разведка сообщает её координаты, а вы сами проходите всю процедуру выстрела, переходя между восемью постами (кнопки внизу или свайп по пустому месту).</p>
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
<h3>РАЗБОР БОЯ</h3><p>После боя кнопка «РАЗБОР БОЯ» открывает карту: истинный путь каждой цели, все ваши разрывы по номерам и таблица выстрелов. Коснитесь строки — разрыв подсветится на карте.</p>
<h3>7. НАБЛЮДЕНИЕ</h3><p>Стереотруба с сеткой: деления через полградуса. Маховик поворачивает трубу, рычаг меняет увеличение ×4/×10, «НА ЦЕЛЬ» — довернуть на выбранную цель, «ЗАСЕЧЬ ПЕЛЕНГ» — провести линию на планшете. Если разрыв лёг в поле зрения трубы, расчёт сразу докладывает: правее или левее цели (в градусах), перелёт или недолёт. Ночью это работает, пока район освещён: осветите район → пост НАБЛЮДЕНИЕ → поправка по сетке. В тумане труба видит на 4 км.</p>
<h3>8. ЗЕНИТКА</h3><p>По команде «ВОЗДУХ!» — к зенитному автомату (красная плашка вверху экрана). Ведите прицел одним пальцем, держите самолёт в кольце и давите гашетку другим (или коротко коснитесь её — автомат бьёт сам, второе касание — отбой): упреждение не нужно, секунда с небольшим в кольце — самолёт сбит. Ствол греется: при перегреве автомат клинит, пока не остынет. Патронов 400 на бой. Прорвавшийся самолёт бомбит «Утёс»: −12% прочности и возможен отказ узла башни.</p>
<h3>РАСЧЁТ</h3><p>Значки Н, З, Р у края экрана — наводчик, заряжающий и радист. Полоска — усталость: уставший работает на четверть медленнее, раненый (после попадания по батарее) — в полтора раза. Коснитесь значка раненого — аптечка вернёт его в строй. Уставший отдыхает сам, когда не работает; аптечка снимет и усталость — для этого коснитесь его значка дважды. Аптечек две на бой (в ОБОРОНЕ — три, за каждую отбитую волну дают ещё одну, но не больше трёх).</p>
<h3>СВОИ СИЛЫ</h3><p>Свои катера и транспорты отмечены на планшете и в блокноте. Разрыв ближе 250 м от своего корабля — попадание по своим; за каждый потопленный вами корабль — минус звезда. Плашка «СВОИ В ЗОНЕ ПОРАЖЕНИЯ» предупреждает, что точка прицеливания рядом со своими. Конвой: доведите транспорты до порта или уничтожьте охотников; дымовой снаряд рядом с транспортом сбивает охотникам прицел.</p>
<h3>СНАБЖЕНИЕ</h3><p>За каждые 150 опыта расчёт получает очко снабжения. В меню, кнопка «СНАБЖЕНИЕ»: шесть улучшений башни по три уровня (2, 3 и 4 очка) — быстрый элеватор, дальномер, второй корректировщик, броня, погреб, ремонтная партия. «СБРОСИТЬ» возвращает все очки.</p>
<h3>ЗАДАНИЕ ДНЯ</h3><p>Каждый день — один бой, одинаковый у всех игроков. Попытки не ограничены, в зачёт идёт лучший счёт: звёзды, прочность батареи, время и расход снарядов; за огонь по своим — штраф.</p>
<h3>СОХРАНЕНИЕ БОЯ</h3><p>Бой записывается сам каждые 15 секунд и когда игру сворачивают. В паузе — «ВЫЙТИ С СОХРАНЕНИЕМ»; в меню появится «ПРОДОЛЖИТЬ БОЙ».</p>
<h3>НАСТРОЙКИ</h3><p>В меню и в паузе: чувствительность маховиков, размер надписей, режим для левши (кнопки и подсказки меняются сторонами), вибрация и звук.</p>`;

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
  const screens = ['loading', 'menu', 'missions', 'dialog', 'notebook', 'debrief', 'upgrades', 'settings'];
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
  // настройки (чувствительность, размер надписей, левша, вибрация) и снабжение (улучшения башни) — отдельные модули
  const settingsUi = createSettings({ game, engine, show, sfx });
  const vibro = settingsUi.vibrate;
  const upgradesUi = createUpgrades({ game, show, dialog, sfx, onClose: () => showMenu() });
  const crewUi = createCrew({ game, box: $('crew'), toast: (t) => toast(t), sfx, vibro });

  // ---------- журнал боя для разбора: чего нет в missionEnd (пути своих, бомбы, разрывы, замеченные в трубу) ----------
  let blog = null, raidUntil = -1;
  function resetLog() { blog = { friends: {}, bombs: [], observed: {}, next: 0 }; raidUntil = -1; }
  function sampleFriends(force) {
    if (!blog || (!force && s.time < blog.next)) return;
    blog.next = s.time + 4;
    (s.friends || []).forEach((f) => {
      const tr = blog.friends[f.id] || (blog.friends[f.id] = []), last = tr[tr.length - 1];
      if (!last || Math.hypot(last.x - f.x, last.y - f.y) > 0.02) tr.push({ t: s.time, x: f.x, y: f.y });
    });
  }
  resetLog();

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
    // снабжение, задание дня, сохранённый бой
    const pts = upgradesUi.points(), ub = $('upBadge');
    ub.textContent = pts; ub.classList.toggle('show', upgradesUi.affordable() > 0); $('upgradesBtn').title = 'Очков снабжения: ' + pts;
    $('dailyInfo').textContent = dailyMenuText(game);
    let ri = null; try { ri = game.resumeInfo(); } catch (e) { /* нет сохранения */ }
    $('resumeBox').classList.toggle('hidden', !ri); if (ri) $('resumeBtn').innerHTML = resumeHtml(game, ri);
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
      const SEC = { 0: 'ЧАСТЬ I · БЕРЕГОВАЯ ОБОРОНА', 8: 'ЧАСТЬ II · КОНТРБАТАРЕЙНАЯ БОРЬБА', 16: 'ЧАСТЬ III · ОСТРОВА В ОГНЕ', 24: 'ЧАСТЬ IV · НОЧЬ И ТУМАН', 30: 'ЧАСТЬ V · КОНВОЙ' };
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
    if (m.night) cond.push('<b>НОЧЬ</b> — разведка даёт только квадрат; подсветите цель осветительным снарядом (ОСВ). Порядок: осветите район → пост НАБЛЮДЕНИЕ → поправка по сетке.');
    if (m.weather === 'fog') cond.push('<b>ТУМАН</b> — донесения реже и грубее (до 100 м), корректировка до 50 м.');
    if (m.weather === 'storm') cond.push('<b>ШТОРМ</b> — ветер меняется по ходу боя, пересчитывайте решение после сводки МЕТЕО.');
    if (m.noSpotter) cond.push('<b>БЕЗ КОРРЕКТИРОВЩИКА</b> — об отклонениях доложит только свой расчёт: наведите трубу поста НАБЛЮДЕНИЕ на цель.');
    if (m.raids && m.raids.length) cond.push('<b>ВОЗДУХ</b> — возможен налёт авиации: по команде «ВОЗДУХ!» — к посту ЗЕНИТКА.');
    const fr = s.friends || [];
    if (m.convoy) cond.push('<b>КОНВОЙ</b> — доведите транспорты до порта или уничтожьте всех охотников. Потеряете весь конвой — задание провалено.');
    if (fr.length) cond.push('<b>СВОИ В РАЙОНЕ</b> — ' + fr.map((f) => esc(f.name || f.label)).join(', ') + '. Разрыв ближе 250 м от своего корабля — попадание по своим, минус звезда за каждый потопленный.');
    if (m.survival) cond.push('<b>ОБОРОНА</b> — волна за волной. За отбитую волну: +25% прочности и снаряды. Прорыв цели: −25%.');
    return `<h2>${m.index != null ? 'ЗАДАНИЕ ' + (m.index + 1) + '. ' : m.daily && m.title ? esc(m.title) + '. ' : ''}${esc(m.name.toUpperCase())}</h2><p>${esc(m.brief || '')}</p>` +
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
      { text: 'НАСТРОЙКИ', fn: () => settingsUi.open(showPauseAgain) },
      { text: 'ВЫЙТИ С СОХРАНЕНИЕМ', fn: () => { game.pause(false); game.suspend(); game.quit({ keep: true }); } },
      { text: 'ВЫЙТИ БЕЗ СОХРАНЕНИЯ', ghost: true, fn: () => { game.pause(false); game.quit(); } },
    ], resume);
  }
  function showPauseAgain() { game.pause(false); showPause(); }
  let lastEnd = null;
  const friendState = (f) => (f.arrived ? 'дошёл до порта' : !f.alive ? 'потоплен' : f.hp < f.maxHp ? 'повреждён, на плаву' : 'цел');
  /** Строки итогов: конвой, огонь по своим, налёты. */
  function forcesRows(st) {
    const m = s.mission || {}, bad = (k, v) => `<tr><td>${k}</td><td class="bad">${v}</td></tr>`, row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    let h = '';
    if (st.convoyTotal > 0) h += (st.convoyLost > 0 ? bad : row)('Конвой', (st.convoyArrived > 0 ? 'дошло ' + st.convoyArrived + ' из ' + st.convoyTotal : 'цело ' + (st.convoyTotal - (st.convoyLost || 0)) + ' из ' + st.convoyTotal) + (st.convoyLost > 0 ? ', потеряно ' + st.convoyLost : ''));
    if ((s.friends || []).length || st.friendlyHits > 0) h += (st.friendlyHits > 0 ? bad : row)('Попаданий по своим', st.friendlyHits || 0);
    if (st.friendlyKills > 0) h += bad('Своих потоплено вашим огнём', st.friendlyKills + ' (−' + st.friendlyKills + ' ★)');
    if ((m.raids && m.raids.length) || st.planesDown > 0 || st.bombs > 0) h += row('Самолётов сбито', st.planesDown || 0) + (st.bombs > 0 ? bad : row)('Бомб по батарее', st.bombs || 0);
    return h;
  }
  function friendsResultHtml() {
    const fr = s.friends || [];
    return fr.length ? `<p class="fr-list" id="resFriends">СВОИ СИЛЫ: ${fr.map((f) => esc(f.name || f.label) + ' — ' + friendState(f)).join('; ')}.</p>` : '';
  }
  function showResult(e) {
    lastEnd = e;
    const st = e.stats || {}, sv = e.survival, m = s.mission || {};
    const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    let html;
    if (sv) {
      html = `<h2>ОБОРОНА ОКОНЧЕНА</h2><p class="bad">${esc(e.reason || '')}</p><table class="stats">` +
        row('Отбито волн', sv.waves) + row('Уничтожено целей', sv.kills) + row('Выстрелов', st.shots != null ? st.shots : s.shots) + row('Время', game.fmt.time(st.time != null ? st.time : s.time)) +
        forcesRows(st) + (sv.best ? row('Лучший результат', sv.best.waves + ' ' + plural(sv.best.waves, 'волна', 'волны', 'волн') + ', ' + sv.best.kills + ' ' + plural(sv.best.kills, 'цель', 'цели', 'целей')) : '') + '</table>' +
        (sv.isNew && sv.waves > 0 ? `<p class="rec">★ НОВЫЙ РЕКОРД ОБОРОНЫ${sv.previous ? ` (был: ${sv.previous.waves} ${plural(sv.previous.waves, 'волна', 'волны', 'волн')})` : ''}</p>` : '');
    } else {
      html = `<h2>${e.won ? 'ЗАДАНИЕ ВЫПОЛНЕНО' : 'ЗАДАНИЕ ПРОВАЛЕНО'}</h2>` +
        (e.won ? `<div class="stars">${'★'.repeat(e.stars)}<i>${'★'.repeat(3 - e.stars)}</i></div>` : `<p class="bad">${esc(e.reason || '')}</p>`) +
        '<table class="stats">' + row('Выстрелов', st.shots + (st.combatShots != null && st.combatShots !== st.shots ? ` (боевых ${st.combatShots})` : '')) + row('Норматив на «отлично»', st.par) +
        row('Уничтожено целей', st.destroyed + ' / ' + st.total) + row('Прочность батареи', st.integrity + '%') + row('Время', game.fmt.time(st.time)) + forcesRows(st) + '</table>' +
        (e.record ? (e.record.isNew ? `<p class="rec">★ НОВЫЙ РЕКОРД ЗАДАНИЯ${e.record.previous ? ` (был: ${e.record.previous.shots} выстр., ${game.fmt.time(e.record.previous.time)})` : ''}</p>`
          : `<p class="dim">Рекорд задания: ${e.record.best.shots} выстр., ${game.fmt.time(e.record.best.time)}, ★${e.record.best.stars}</p>`) : '');
    }
    html += friendsResultHtml();
    html += dailyResultHtml(e.daily);
    // опыт и звание расчёта
    const rk = e.rank || getRank();
    if (e.rankUp) html += `<div class="rankup">НОВОЕ ЗВАНИЕ: ${esc(rk.name)}</div>`;
    html += `<div class="xp"><div class="rank-l"><span>ОПЫТ +${e.xpGained || 0} · ${esc(rk.name)}</span><span>${rk.next != null ? rk.xp + ' / ' + rk.next : rk.xp}</span></div><div class="rank-bar"><i style="width:${rankPct(rk)}%"></i></div></div>`;
    if (e.points > 0) html += `<p class="dim pts">Очков снабжения: ${e.points} — улучшения башни в меню, «СНАБЖЕНИЕ».</p>`;
    const idx = m.index, btns = [];
    if (e.won && idx != null && idx + 1 < game.campaign.length) btns.push({ text: 'СЛЕДУЮЩЕЕ', primary: true, fn: () => game.startMission(idx + 1) });
    if (m.survival) btns.push({ text: 'ЕЩЁ РАЗ', primary: !btns.length, fn: () => game.startSurvival() });
    else if (m.daily) btns.push({ text: 'ЕЩЁ РАЗ', primary: !btns.length, fn: () => game.startDaily(m.daily) });
    else if (m.skirmish || idx == null) btns.push({ text: 'НОВЫЙ БОЙ', primary: !btns.length, fn: () => game.startSkirmish() });
    else btns.push({ text: 'ПОВТОРИТЬ', primary: !btns.length, fn: () => game.startMission(idx) });
    btns.push({ text: 'РАЗБОР БОЯ', fn: showDebrief });
    btns.push({ text: 'В МЕНЮ', ghost: true, fn: () => game.quit() });
    dialog(html, btns);
  }

  // ---------- разбор боя ----------
  const debrief = createDebrief({ game, canvas: $('dbfCanvas'), table: $('dbfTable'), legend: $('dbfLegend'), zoomBtn: $('dbfZoom') });
  function showDebrief() {
    if (!lastEnd) return;
    sampleFriends(true);
    (s.impacts || []).forEach((i) => { if (i.observed) blog.observed[i.n] = true; });
    show('debrief'); debrief.open(lastEnd, s, blog);
  }
  function closeDebrief() { if (lastEnd && (s.phase === 'won' || s.phase === 'lost')) showResult(lastEnd); else showMenu(); }

  // ---------- HUD ----------
  const nav = $('nav');
  STATIONS.forEach((st, i) => {
    const b = document.createElement('button');
    b.dataset.station = st.id;
    b.innerHTML = `<span class="n">${i + 1}</span><span>${st.short || st.title}</span>`;
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
  const hasHot = (stId, name) => { const st = stations.find((x) => x && x.id === stId); return !!(st && st.hotspots && st.hotspots[name]); };
  /** Первый существующий орган управления из списка (посты дописываются — имён может не быть). */
  const pickHot = (stId, ...names) => names.find((n) => hasHot(stId, n)) || null;
  const visible = (id) => { try { return !!game.visible(id); } catch (e) { return false; } };
  const brgTo = (x, y) => { const bat = s.mission.battery; return ((Math.atan2(x - bat.x, y - bat.y) * 180 / Math.PI) + 360) % 360; };
  /** Свои рядом с точкой прицеливания (замер и/или решение вычислителя): ближе 0.4 км. */
  function friendsInZone() {
    const fr = (s.friends || []).filter((f) => f.alive && !f.arrived && !f.sunk);
    if (!fr.length || !s.activeTarget || !s.mission) return [];
    const rec = s.plot.recorded[s.activeTarget], cp = s.computer, bat = s.mission.battery, R = Math.PI / 180, pts = [];
    const pt = (brg, rng) => pts.push({ x: bat.x + rng * Math.sin(brg * R), y: bat.y + rng * Math.cos(brg * R) });
    if (rec) { pt(rec.bearing, rec.range); if (cp.elevation != null && !cp.stale) pt(rec.bearing, cp.range); }
    if (cp.elevation != null && s.checklist.loaded) pt(s.turret.bearing - (cp.windBearing || 0), cp.range);
    return fr.filter((f) => pts.some((p) => Math.hypot(p.x - f.x, p.y - f.y) < 0.4));
  }
  /** Подсказка зенитного поста, пока идёт налёт (null — налёта нет или стрелять нечем). */
  function raidStep() {
    const rd = s.raid, aa = s.aa;
    if (!rd || !aa || rd.phase !== 'inbound') return null;
    const live = (rd.planes || []).filter((p) => p.alive && !p.attacked);
    if (!live.length || aa.ammo <= 0) return null;
    if (aa.jammed) return { st: 'aa', text: 'ЗЕНИТКА: клин — ствол перегрет! Отпустите гашетку, автомат остынет' };
    const R = Math.PI / 180, cone = (game.C && game.C.AA_CONE) || 2.2;
    const sep = (p) => Math.acos(Math.max(-1, Math.min(1, Math.sin(p.elevation * R) * Math.sin(aa.elevation * R) + Math.cos(p.elevation * R) * Math.cos(aa.elevation * R) * Math.cos((p.bearing - aa.bearing) * R)))) / R;
    if (live.some((p) => sep(p) < cone)) return { st: 'aa', hot: pickHot('aa', 'aaFire', 'aaTrigger'), text: 'ЗЕНИТКА: самолёт в кольце — давите гашетку «ОГОНЬ»!' };
    return { st: 'aa', hot: pickHot('aa', 'aaPad'), text: 'ВОЗДУХ! ЗЕНИТКА: ведите прицел пальцем — самолёт в кольцо, вторым пальцем давите гашетку' };
  }
  /** Снаряд в полёте: когда корректировщик не поможет, а цель видна в оптику — к трубе. */
  function observeStep() {
    const m = s.mission, lr = s.lastReport, at = s.targets.find((t) => t.id === s.activeTarget);
    if (!s.flight.some((f) => f.shell !== 'illum' && f.shell !== 'smoke')) {
      if (m.night && s.flight.some((f) => f.shell === 'illum')) return { st: null, text: 'Осветительный в полёте. Дальше: пост НАБЛЮДЕНИЕ — в свете цель и разрывы видны в трубу, поправка по сетке' };
      return null;
    }
    if (!at || !at.alive || !(m.noSpotter || m.night || (lr && (lr.blind || lr.dark))) || !visible(at.id)) return null;
    const off = Math.abs(ang(s.scope.bearing, brgTo(at.x, at.y)));
    let fov = 16; try { fov = game.scopeFov(); } catch (e) { /* старая логика */ }
    if (off > fov * 0.4) {
      const btn = pickHot('observe', 'toTargetButton');
      return { st: 'observe', hot: btn || pickHot('observe', 'scopeWheel'), text: 'НАБЛЮДЕНИЕ: наведите трубу на цель' + (btn ? ' (кнопка «НА ЦЕЛЬ» или маховик)' : ' маховиком') + ' — расчёт доложит, куда лёг снаряд' };
    }
    return { st: 'observe', text: 'НАБЛЮДЕНИЕ: труба на цели — ждите разрыва и снимите поправку по сетке' };
  }
  function nextStep() {
    const c = s.checklist, b = s.breech, cp = s.computer;
    const air = raidStep();
    if (air) return air;
    if (s.flight.length && !b.shell && !b.open && !(b.busy && b.busy.kind === 'auto')) return observeStep() || { st: null, text: 'Снаряд в полёте — следите за картой на ПЛАНШЕТЕ и ждите доклада' };
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
    if (friendsInZone().length && b.shell !== 'illum' && b.shell !== 'smoke') return { st: 'fire', hot: 'fireLever', warn: true, text: 'ОГОНЬ: СВОИ В ЗОНЕ ПОРАЖЕНИЯ! Проверьте замер на ПЛАНШЕТЕ — или стреляйте на свой риск' };
    return { st: 'fire', hot: 'fireLever', text: b.shell === 'illum' ? 'ОГОНЬ: осветительный в стволе — спуск вниз! Затем пост НАБЛЮДЕНИЕ → поправка по сетке' : blind && needIllum ? 'ОГОНЬ: цель не освещена — лучше сначала осветительный. Спуск — вниз' : 'ОГОНЬ: потяните спуск вниз!' };
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

  const shellSeen = {}; let shKey = '', wxKey = '', windChangedAt = -1e9, obKey = '', forcesKey = '', raidOn = false;
  const DEV = (v, plus, minus) => (v > 0 ? plus : minus) + ' ' + Math.abs(Math.round(v)) + ' м';
  /** Коротко: что доложил корректировщик (state.lastReport). */
  function spotterBrief() {
    const lr = s.lastReport;
    if (s.reportDue != null) return 'доклад в пути…';
    if (!lr || lr.special) return '';
    if (lr.blind) return 'нет — только свой глаз';
    if (lr.dark) return 'не видит (темно)';
    if (!lr.observed) return 'разрыв не наблюдал';
    const p = []; if (lr.over) p.push(DEV(lr.over, 'перелёт', 'недолёт')); if (lr.right) p.push(DEV(lr.right, 'вправо', 'влево'));
    return (lr.bracket ? 'вилка · ' : '') + (p.join(', ') || 'в цель');
  }
  /** Коротко: что видел свой наблюдатель в трубу (state.scope.last). */
  function scopeBrief() {
    const o = s.scope && s.scope.last; if (!o) return '';
    if (o.targetId == null || o.dBearing == null) return '№ ' + o.n + ': целей рядом не видно';
    const d = Math.abs(o.dBearing).toFixed(1).replace('.', ',');
    return '№ ' + o.n + ' · Ц' + o.targetId + ': ' + (o.over === 0 ? 'попадание' : (Math.abs(o.dBearing) < 0.05 ? 'по направлению верно' : (o.dBearing > 0 ? 'правее ' : 'левее ') + d + '°') + ', ' + (o.over > 0 ? 'перелёт' : 'недолёт'));
  }
  function reportBrief() {
    const a = spotterBrief(), b = scopeBrief();
    return (a ? '<b>КОРР.</b> ' + esc(a) : '') + (a && b ? ' &nbsp;·&nbsp; ' : '') + (b ? '<b>ТРУБА</b> ' + esc(b) : '');
  }
  /** Тревога, свои в зоне поражения, конвой. */
  function renderForces() {
    raidOn = s.phase === 'playing' && (!!(s.raid && s.raid.phase === 'inbound') || s.time < raidUntil);
    const zone = friendsInZone(), conv = (s.friends || []).filter((f) => f.convoy);
    const key = (raidOn ? 1 : 0) + (engine.current === 'aa' ? 'a' : '') + '|' + zone.map((f) => f.id).join() + '|' + conv.map((f) => f.hp + (f.alive ? 'a' : 'x') + (f.arrived ? 'h' : '')).join();
    if (key === forcesKey) return;
    forcesKey = key;
    $('hud').classList.toggle('raid', raidOn && engine.current !== 'aa');
    $('raidBanner').classList.toggle('hidden', !raidOn || engine.current === 'aa');
    const fw = $('ffWarn'); fw.classList.toggle('hidden', !zone.length);
    if (zone.length) fw.textContent = '⚠ СВОИ В ЗОНЕ ПОРАЖЕНИЯ · ' + zone.map((f) => f.label).join(', ');
    const cc = $('convoyChip'); cc.classList.toggle('hidden', !conv.length);
    if (conv.length) cc.innerHTML = '<span>КОНВОЙ</span>' + conv.map((f) => `<i class="${!f.alive ? 'lost' : f.arrived ? 'home' : f.hp < f.maxHp ? 'dmg' : ''}"></i>`).join('');
  }
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
    const ob = reportBrief(); if (ob !== obKey) { obKey = ob; $('obs').innerHTML = ob; }
    renderForces();
    crewUi.render();

    const step = nextStep(), hints = s.mission && (s.mission.tutorial || s.difficulty === 0);
    $('hint').textContent = hints ? step.text : ''; $('hint').classList.toggle('warn', !!(hints && step.warn));
    hlStep = hints ? step : null;
    renderFaults();
    nav.querySelectorAll('button').forEach((b, i) => {
      const st = STATIONS[i];
      b.classList.toggle('on', engine.current === st.id);
      b.classList.toggle('done', !!(st.check && s.checklist[st.check]));
      b.classList.toggle('next', hints && step.st === st.id);
      b.classList.toggle('alarm', st.id === 'aa' && raidOn && engine.current !== 'aa');
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
    $('hud').classList.toggle('hasfaults', box.children.length > 0);
    $('hud').style.setProperty('--fn', String(Math.max(1, box.children.length)));
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
    // свои силы — известны точно
    const fr = s.friends || [];
    $('nbFriends').innerHTML = fr.length ? '<h3>СВОИ СИЛЫ</h3>' + fr.map((f) => `<div class="nb-f${f.alive ? '' : ' dead'}"><b>${f.label}</b> — ${esc(f.name)}` +
      (f.convoy ? '<span class="tag">КОНВОЙ</span>' : '') + (f.arrived ? '<span class="tag">ДОШЁЛ</span>' : !f.alive ? '<span class="tag bad">ПОТОПЛЕН</span>' : f.hp < f.maxHp ? '<span class="tag bad">ПОВРЕЖДЁН</span>' : '') +
      (f.alive ? `<span class="co">X ${game.fmt.km(f.x)}  Y ${game.fmt.km(f.y)}${f.speed > 0 ? `  курс ${String(Math.round(f.heading)).padStart(3, '0')}°  ${Math.round(f.speed)} км/ч` : f.arrived ? '' : '  стоит'}  прочность ${f.hp}/${f.maxHp}</span>` : '') + '</div>').join('') : '';
    const rep = (k, v) => `<div class="nb-rep"><b>${k}</b>${esc(v)}</div>`, lr = s.lastReport;
    $('nbObs').innerHTML = rep('КОРРЕКТИРОВЩИК', s.reportDue != null ? 'доклад в пути…' : lr && lr.text ? lr.text : spotterBrief() || 'докладов пока нет') +
      rep('СВОЙ ГЛАЗ (ТРУБА)', scopeBrief() || 'разрывов в трубу не наблюдали — наведите пост НАБЛЮДЕНИЕ на цель') +
      (s.mission.night ? '<div class="nb-rep">Ночью: осветите район → пост НАБЛЮДЕНИЕ → поправка по сетке.</div>' : '');
    const cr = s.crew || {};
    $('nbCrew').innerHTML = ['gunner', 'loader', 'radio'].filter((r) => cr[r]).map((r) => { const m = cr[r]; return `<div class="nb-kv"><span>${m.title[0] + m.title.slice(1).toLowerCase()} ${esc(m.name)}</span><b class="${m.state}">${crewStateText(m)}${m.state === 'wounded' ? ' ' + Math.max(0, Math.ceil(m.woundedUntil - s.time)) + ' с' : ''} · усталость ${Math.round(m.fatigue * 100)}%</b></div>`; }).join('') +
      kv('Аптечки', s.medkits != null ? s.medkits : '—');
    const aa = s.aa, pl = s.raid ? (s.raid.planes || []).filter((p) => p.alive && !p.attacked).length : 0;
    $('nbAA').innerHTML = aa ? kv('Патроны', aa.ammo + ' / ' + ((game.C && game.C.AA_AMMO) || 400)) + kv('Нагрев ствола', Math.round(aa.heat * 100) + '%' + (aa.jammed ? ' — КЛИН' : '')) +
      kv('Воздух', s.raid && s.raid.phase === 'inbound' ? 'НАЛЁТ: в воздухе ' + pl : s.mission.night ? 'ночью налётов нет' : 'чисто') +
      (s.stats ? kv('Сбито / бомб по батарее', (s.stats.planesDown || 0) + ' / ' + (s.stats.bombs || 0)) : '') : '';
    let ups = []; try { ups = game.upgrades().filter((u) => u.level > 0); } catch (e) { /* старая логика */ }
    $('nbUp').innerHTML = '<h3>СНАБЖЕНИЕ</h3>' + (ups.length ? ups.map((u) => kv(esc(u.title[0] + u.title.slice(1).toLowerCase()) + ' · ур. ' + u.level, esc(u.effect || ''))).join('') : '<div>Улучшений башни нет — «СНАБЖЕНИЕ» в меню.</div>');
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
    else if (ph === 'playing') { closeAll(); $('hud').classList.remove('hidden'); unread = 0; lastEnd = null; Object.keys(shellSeen).forEach((k) => delete shellSeen[k]); Object.keys(SH()).forEach((k) => { if (s.shells[k] > 0) shellSeen[k] = true; }); shKey = wxKey = obKey = forcesKey = ''; windChangedAt = -1e9; resetLog(); crewUi.render(true); $('radio').className = ''; engine.gotoStation('plot', { instant: true }); sfx('ambient', true); dirty = true; }
  });
  game.on('missionEnd', (e) => { sfx('alarm', false); lastEnd = e; raidUntil = -1; sampleFriends(true); forcesKey = ''; renderForces(); nav.querySelectorAll('button.alarm').forEach((b) => b.classList.remove('alarm')); setTimeout(() => { if ((s.phase === 'won' || s.phase === 'lost') && lastEnd === e) showResult(e); }, 1400); });
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
  game.on('fired', () => { sfx('fire'); try { engine.shake(0.06, 0.7); } catch (e) { /* нет тряски */ } flash('fire'); vibro('shot'); });
  // гром нашего разрыва доходит с задержкой и тем тише, чем дальше
  game.on('impact', (e) => {
    if (e.observed && blog) blog.observed[e.n] = true;
    const bat = s.mission && s.mission.battery;
    const d = bat ? Math.hypot(e.x - bat.x, e.y - bat.y) : 8;
    setTimeout(() => sfx('thunder', 1.3 - d / 20), Math.min(3500, d * 260) / (s.speed || 1));
  });
  // налёт: тревога, плашка «НА ЗЕНИТКУ», итог налёта
  game.on('raid', (e) => {
    if (e.phase === 'warning') { raidUntil = s.time + (e.eta || 10) + 1; sfx('siren'); vibro('fault'); }
    else if (e.phase === 'start') { raidUntil = Math.max(raidUntil, s.time + 1); sfx('siren'); }
    else if (e.phase === 'end') { raidUntil = -1; toast((e.bombed ? 'НАЛЁТ ОКОНЧЕН' : 'НАЛЁТ ОТБИТ') + ': СБИТО ' + (e.shot || 0) + ', ПРОРВАЛОСЬ ' + (e.bombed || 0)); }
    forcesKey = ''; dirty = true;
  });
  game.on('plane', (e) => {
    if (e.down) toast('САМОЛЁТ СБИТ!');
    else if (e.bombed && blog) blog.bombs.push({ t: s.time, id: e.id, from: s.raid ? s.raid.from : 0 });
  });
  game.on('aa', (e) => { if (e.jammed) { sfx('buzz'); toast('ЗЕНИТКА: КЛИН — СТВОЛ ПЕРЕГРЕТ'); } });
  game.on('observed', () => { dirty = true; });
  game.on('report', () => { dirty = true; });
  // свои силы
  game.on('friend', (e) => {
    const f = (s.friends || []).find((x) => x.id === e.id), nm = f ? f.label : 'СВОИ';
    if (e.sunk) { flash('hit'); toast(e.by === 'own' ? nm + ' ПОТОПЛЕН ВАШИМ ОГНЁМ!' : nm + ' ПОТОПЛЕН ПРОТИВНИКОМ'); }
    else if (e.hit && e.by === 'own') { vibro('hit'); toast('ОГОНЬ ПО СВОИМ! ПОПАДАНИЕ: ' + nm); }
    else if (e.hit) toast(nm + ' ПОД ОГНЁМ' + (s.shells.smoke > 0 ? ' — ПРИКРОЙТЕ ДЫМОВЫМ СНАРЯДОМ' : ''));
    else if (e.arrived) toast(nm + ' ДОШЁЛ ДО ПОРТА');
    sampleFriends(true); forcesKey = ''; dirty = true;
  });
  game.on('incoming', (e) => { sfx('whistle', e.eta * 0.92 / (s.speed || 1)); });
  game.on('fault', (e) => { if (!e.fixed) { vibro('fault'); sfx('alarm', true); setTimeout(() => sfx('alarm', false), 1600); } faultsKey = ''; });
  $('flightChip').addEventListener('click', () => { if (s.phase === 'playing') goto('plot'); });
  game.on('batteryHit', (h) => { sfx(h.damage > 0 ? 'impactNear' : 'impactFar'); if (h.damage > 0) { flash('hit'); try { engine.shake(0.04, 0.5); } catch (e) { /* нет тряски */ } vibro(h.by === 'air' ? 'bomb' : 'hit'); toast((h.escape ? 'ЦЕЛЬ ПРОРВАЛАСЬ: −' : 'ПОПАДАНИЕ ПО БАТАРЕЕ: −') + h.damage + '%'); } });
  engine.on('station', () => { $('hud').dataset.st = engine.current || ''; dirty = true; });
  engine.on('swipe', (dir) => { if (s.phase === 'playing' && !s.paused) neighbor(dir > 0 ? 1 : -1); });

  const baseExposure = engine.renderer.toneMappingExposure || 1;
  let flick = 0, nightOn = false;
  engine.onFrame((dt) => {
    if (s.phase === 'playing') { placeHighlight(); sampleFriends(false); } else hl.style.display = 'none';
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
    if (!dirty && !s.flight.length && !s.raid) return;
    const now = time != null ? time * 1000 : performance.now();
    if (now - lastRender < 110 && lastRender <= now) return;
    lastRender = now; dirty = false;
    if (s.phase === 'playing') { renderHud(); if (notebookOpen) renderNotebook(); }
  });

  // ---------- действия ----------
  const ACT = {
    campaign: showMissions,
    skirmish: () => game.startSkirmish(),
    daily: () => game.startDaily(todayKey()),
    upgrades: () => upgradesUi.open(),
    settings: () => settingsUi.open(showMenu),
    resume: () => { const r = game.restore(); if (!r || !r.ok) { game.discardResume(); refreshMenu(); } },
    discardResume: () => { game.discardResume(); refreshMenu(); },
    survival: () => game.startSurvival(),
    debriefZoom: () => debrief.toggleZoom(),
    closeDebrief,
    howto: () => dialog(HOWTO, [{ text: 'ПОНЯТНО', primary: true, fn: showMenu }], showMenu),
    news: () => showNews(CHANGELOG, true),
    toMenu: showMenu,
    pause: showPause,
    toAA: () => { if (s.phase === 'playing') goto('aa'); },
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
    else if (/^[1-8]$/.test(e.key)) goto(STATIONS[+e.key - 1].id);
  });

  // системная кнопка «Назад» и сворачивание приложения (вызываются из MainActivity)
  window.onBackButton = () => {
    if (notebookOpen) { ACT.closeNotebook(); return true; }
    if ($('debrief').classList.contains('show')) { closeDebrief(); return true; }
    if ($('dialog').classList.contains('show')) { if (dialogDismiss) dialogDismiss(); return true; }
    if ($('missions').classList.contains('show')) { showMenu(); return true; }
    if (settingsUi.isOpen()) { settingsUi.close(); return true; }
    if (upgradesUi.isOpen()) { upgradesUi.close(); return true; }
    if (s.phase === 'playing') { showPause(); return true; }
    return false;
  };
  // уход в фон: бой сразу записывается (save.resume) — если систему выгрузит игру, меню предложит «ПРОДОЛЖИТЬ БОЙ»
  const suspend = () => { if (s.phase === 'playing') try { game.suspend(); } catch (e) { /* сохранить не удалось */ } };
  window.onAppPause = () => { suspend(); if (s.phase === 'playing' && !s.paused) showPause(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });
  window.addEventListener('pagehide', suspend);

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
  return { showMenu, goto, toast, nextStep, showDebrief, debrief, settings: settingsUi, upgrades: upgradesUi, vibro, crew: crewUi, friendsInZone };
}
