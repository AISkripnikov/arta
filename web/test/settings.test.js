// Настройки (полный набор), сброс настроек, сброс прогресса, автосохранение, скорость по умолчанию, свои в зоне поражения.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/game/index.js';
import { RAD, tick, noWind, start } from './bot.js';

const mem = (init) => { const m = {}; if (init) m['arta2.save'] = JSON.stringify(init); return { mem: m, get: (k) => m[k] || null, set: (k, v) => { m[k] = v; } }; };
const stored = (st) => JSON.parse(st.mem['arta2.save']);
const DEF = { sens: 1, invert: false, lefty: false, vibro: true, vibroPower: 'high', hints: 'new', autosave: true, speed: 1, confirmFriendly: true,
  crewPanel: 'full', volFx: 100, volAmb: 70, volRadio: 100, volMusic: 60, text: 1, quality: 'auto', qualityChosen: false, fps: 60, nightTint: 'normal', showFps: false,
  shake: true };
/** Сохранение с прогрессом во всех полях. */
const rich = (extra) => ({ unlocked: 12, stars: [3, 2, 1, 3, 3, 3, 3, 3, 3, 3, 3], records: [{ stars: 3, shots: 2, time: 50, integrity: 100, difficulty: 0 }],
  difficulty: 1, muted: true, xp: 2400, survivalBest: { waves: 5, kills: 14 }, upgrades: { hoist: 2, armor: 1 },
  daily: { date: '2026-11-18', score: 4321, stars: 3 }, ...(extra || {}) });

test('настройки: полный набор по умолчанию и области значений', () => {
  const g = createGame({ storage: mem() });
  assert.deepEqual(g.settings(), DEF);
  assert.deepEqual(Object.keys(g.SETTINGS).sort(), Object.keys(DEF).sort());
  for (const k of Object.keys(DEF)) assert.deepEqual(g.SETTINGS[k].def, DEF[k], k);
  const good = { sens: [0.6, 1.6, 1.2], invert: [true, false], lefty: [true, false], vibro: [false, true], vibroPower: ['low', 'high'],
    hints: ['all', 'off', 'new'], autosave: [false, true], speed: [2, 1], confirmFriendly: [false, true], crewPanel: ['compact', 'off', 'full'],
    volFx: [0, 100, 35], volAmb: [0, 100, 35], volRadio: [0, 100, 35], volMusic: [0, 100, 35], text: [1.15, 1.3, 1], quality: ['mid', 'low', 'high', 'auto'],
    qualityChosen: [false, true], fps: [30, 60], nightTint: ['soft', 'normal'], showFps: [true, false], shake: [false, true] };
  const bad = { sens: ['1', NaN, null], invert: [1, 'да', null], lefty: [1, 0], vibro: ['1', undefined], vibroPower: ['mid', true, 1],
    hints: [0, true, false, 'on', null], autosave: [1, null], speed: [3, 0, '2', 1.5], confirmFriendly: ['true', 2], crewPanel: ['hidden', true, 0],
    volFx: [-1, 101, '50', NaN, null], volAmb: [-0.5, 100.5, Infinity], volRadio: [1000, 'громко'], volMusic: [-1, 100.5, '60', NaN, null], text: [1.2, '1', 2],
    quality: ['ultra', 'AUTO', 2, true, null], qualityChosen: [1, 'да', null], fps: [45, '30', 120], nightTint: ['off', true], showFps: [1, 'да'], shake: [0, 1, 'нет', null] };
  assert.deepEqual(Object.keys(good).sort(), Object.keys(DEF).sort()); assert.deepEqual(Object.keys(bad).sort(), Object.keys(DEF).sort());
  for (const k of Object.keys(DEF)) {
    for (const v of good[k]) { assert.equal(g.setSetting(k, v).ok, true, k + '=' + v); assert.equal(g.settings()[k], v, k); }
    const before = g.settings()[k];
    for (const v of bad[k]) { assert.equal(g.setSetting(k, v).ok, false, k + '=' + String(v)); assert.equal(g.settings()[k], before, k + ' не изменилось'); }
  }
  // громкость округляется до целого
  assert.ok(g.setSetting('volFx', 49.6).ok); assert.equal(g.settings().volFx, 50);
  assert.ok(g.setSetting('volMusic', 12.4).ok); assert.equal(g.settings().volMusic, 12);
  // области значений для интерфейса: качество — в том порядке, в каком его показывает экран настроек
  assert.deepEqual(g.SETTINGS.quality.list, ['auto', 'high', 'mid', 'low']);
});

test('настройки: неизвестный ключ — отказ с событием denied, без события settings и без записи', () => {
  const st = mem(); const g = createGame({ storage: st });
  const ev = [], den = []; g.on('settings', (e) => ev.push(e)); g.on('denied', (e) => den.push(e));
  for (const k of ['volume', 'sound', 'muted', 'difficulty', '__proto__', 'constructor', 'toString', '']) assert.equal(g.setSetting(k, true).ok, false, k);
  assert.equal(g.setSetting('quality', 'ultra').ok, false);
  assert.equal(ev.length, 0); assert.equal(den.length, 9); assert.ok(den.every((d) => d.action === 'setSetting'));
  assert.equal(st.mem['arta2.save'], undefined, 'ничего не записано');
  assert.deepEqual(g.settings(), DEF); assert.deepEqual(Object.keys(g.save.settings), Object.keys(DEF));
});

test('настройки: сохраняются между запусками; событие settings несёт копию', () => {
  const st = mem(); const g = createGame({ storage: st });
  const ev = []; g.on('settings', (e) => ev.push(e));
  const want = { invert: true, vibroPower: 'low', hints: 'off', autosave: false, speed: 2, confirmFriendly: false, crewPanel: 'compact', volFx: 40, volAmb: 0,
    volRadio: 55, volMusic: 25, quality: 'low', fps: 30, nightTint: 'soft', showFps: true, shake: false };
  for (const k of Object.keys(want)) assert.ok(g.setSetting(k, want[k]).ok);
  assert.equal(ev.length, Object.keys(want).length);
  const all = { ...DEF, ...want, qualityChosen: true };      // выбор качества помечается сам
  assert.deepEqual(ev[ev.length - 1], all);
  ev[0].quality = 'сломано'; assert.equal(g.settings().quality, 'low', 'событие отдаёт копию');
  assert.deepEqual(stored(st).settings, all);
  assert.deepEqual(createGame({ storage: st }).settings(), all);
});

test('качество графики: «авто» по умолчанию; прежнее «высокое» без отметки о выборе один раз становится «авто»', () => {
  // новая игра
  const g0 = createGame({ storage: mem() });
  assert.equal(g0.settings().quality, 'auto'); assert.equal(g0.settings().qualityChosen, false);
  // сохранение прежней версии: 'high' было умолчанием — игрок его не выбирал
  const st = mem(rich({ settings: { sens: 1.4, quality: 'high', volFx: 10 } }));
  const g = createGame({ storage: st });
  assert.deepEqual(g.settings(), { ...DEF, sens: 1.4, volFx: 10 });
  assert.equal(g.settings().quality, 'auto'); assert.equal(g.settings().qualityChosen, false);
  // пока ничего не записано, повторная загрузка даёт то же самое; запись сохраняет уже 'auto'
  assert.equal(createGame({ storage: st }).settings().quality, 'auto');
  assert.ok(g.setSetting('volFx', 20).ok);
  assert.equal(stored(st).settings.quality, 'auto'); assert.equal(stored(st).settings.qualityChosen, false);
  // игрок сам выбирает «ВЫСОКОЕ» — выбор помечается и переживает перезапуск (перенос одноразовый)
  const ev = []; g.on('settings', (e) => ev.push(e));
  assert.ok(g.setSetting('quality', 'high').ok);
  assert.equal(ev.length, 1); assert.equal(ev[0].quality, 'high'); assert.equal(ev[0].qualityChosen, true);
  assert.equal(stored(st).settings.quality, 'high'); assert.equal(stored(st).settings.qualityChosen, true);
  const again = createGame({ storage: st });
  assert.equal(again.settings().quality, 'high'); assert.equal(again.settings().qualityChosen, true);
  assert.equal(createGame({ storage: st }).settings().quality, 'high', 'и при следующих запусках');
  // выбор «АВТО» — тоже выбор; отказ (негодное значение) отметку не ставит
  const g2 = createGame({ storage: mem() });
  assert.equal(g2.setSetting('quality', 'ultra').ok, false); assert.equal(g2.settings().qualityChosen, false);
  assert.ok(g2.setSetting('quality', 'auto').ok); assert.equal(g2.settings().quality, 'auto'); assert.equal(g2.settings().qualityChosen, true);
  // 'mid' и 'low' из прежних сохранений не трогаются (отметки нет — и не появляется)
  for (const q of ['mid', 'low']) {
    const s = createGame({ storage: mem(rich({ settings: { quality: q } })) }).settings();
    assert.equal(s.quality, q); assert.equal(s.qualityChosen, false);
  }
  // отметка — только настоящее true: «что-то истинное» выбором не считается
  for (const flag of [1, 'true', null, {}]) {
    const s = createGame({ storage: mem({ settings: { quality: 'high', qualityChosen: flag } }) }).settings();
    assert.equal(s.quality, 'auto', String(flag)); assert.equal(s.qualityChosen, false, String(flag));
  }
  assert.equal(createGame({ storage: mem({ settings: { quality: 'high', qualityChosen: true } }) }).settings().quality, 'high');
  // совсем старое сохранение без настроек — 'auto'
  assert.equal(createGame({ storage: mem({ unlocked: 3, stars: [1, 1] }) }).settings().quality, 'auto');
  // «по умолчанию» и сброс прогресса с настройками возвращают 'auto' и снимают отметку
  assert.ok(again.resetSettings().ok);
  assert.equal(again.settings().quality, 'auto'); assert.equal(again.settings().qualityChosen, false);
  assert.equal(createGame({ storage: st }).settings().quality, 'auto');
  const g3 = createGame({ storage: mem(rich({ settings: { quality: 'high', qualityChosen: true } })) });
  assert.ok(g3.resetProgress().ok); assert.equal(g3.settings().quality, 'high', 'сброс прогресса без настроек выбор не трогает');
  assert.ok(g3.resetProgress({ settings: true }).ok); assert.equal(g3.settings().quality, 'auto'); assert.equal(g3.settings().qualityChosen, false);
});

test('старые сохранения: четыре прежние настройки целы, новые — по умолчанию; мусор отбрасывается', () => {
  const g = createGame({ storage: mem({ unlocked: 5, stars: [3, 3, 2, 1], xp: 700, muted: true, settings: { sens: 1.4, text: 1.3, lefty: true, vibro: false } }) });
  assert.deepEqual(g.settings(), { ...DEF, sens: 1.4, text: 1.3, lefty: true, vibro: false });
  assert.equal(g.save.muted, true); assert.equal(g.save.xp, 700); assert.equal(g.save.unlocked, 5);
  // совсем старое: настроек нет вовсе
  assert.deepEqual(createGame({ storage: mem({ unlocked: 3, stars: [1, 1] }) }).settings(), DEF);
  // прежнее правило чтения: lefty — «истинное», vibro — выключена только явным false
  assert.deepEqual(createGame({ storage: mem({ settings: { lefty: 1, vibro: null } }) }).settings(), { ...DEF, lefty: true, vibro: true });
  assert.deepEqual(createGame({ storage: mem({ settings: { lefty: 0, vibro: false } }) }).settings(), { ...DEF, lefty: false, vibro: false });
  // мусор: каждое негодное значение — по умолчанию, годные остаются; лишние ключи не протекают
  const g2 = createGame({ storage: mem({ settings: { sens: 99, text: 7, quality: 'ultra', fps: 144, volFx: -5, volAmb: 30, volRadio: '80', speed: 3, crewPanel: 'off',
    hints: 'нет', showFps: true, nightTint: 5, vibroPower: null, чужое: 1 } }) });
  assert.deepEqual(g2.settings(), { ...DEF, volAmb: 30, crewPanel: 'off', showFps: true });
  assert.deepEqual(createGame({ storage: mem({ settings: 'строка' }) }).settings(), DEF);
  assert.deepEqual(createGame({ storage: mem({ settings: [1, 2] }) }).settings(), DEF);
});

test('resetSettings: всё по умолчанию и звук включён; прогресс и сложность не тронуты', () => {
  const st = mem(rich({ settings: { sens: 1.4, quality: 'low', volFx: 10, speed: 2, lefty: true } }));
  const g = createGame({ storage: st });
  const ev = []; g.on('settings', (e) => ev.push(e));
  assert.equal(g.save.muted, true);
  assert.deepEqual(g.resetSettings(), { ok: true });
  assert.deepEqual(g.settings(), DEF); assert.equal(g.save.muted, false);
  assert.equal(ev.length, 1); assert.deepEqual(ev[0], DEF);
  assert.equal(g.save.xp, 2400); assert.equal(g.save.unlocked, 12); assert.equal(g.save.upgrades.hoist, 2); assert.equal(g.state.difficulty, 1);
  const again = createGame({ storage: st });
  assert.deepEqual(again.settings(), DEF); assert.equal(again.save.muted, false); assert.equal(again.save.xp, 2400);
});

test('resetProgress: стирает каждое поле прогресса, настройки/звук/сложность остаются', () => {
  const st = mem(rich({ settings: { sens: 1.4, quality: 'low', volFx: 10, hints: false }, устаревшее: 7 }));
  const g = createGame({ storage: st });
  // сохранённый бой
  assert.ok(g.startMission(0).ok); g.begin(); tick(g, 5); assert.ok(g.suspend().ok); g.quit({ keep: true });
  assert.ok(g.resumeInfo()); assert.ok(g.points() > 0); assert.equal(g.rank().index > 0, true);
  const ev = []; for (const n of ['save', 'upgrades', 'settings', 'phase', 'state']) g.on(n, () => ev.push(n));
  const mine = { ...DEF, sens: 1.4, quality: 'low', volFx: 10, hints: 'off' };      // прежний выключатель false → 'off'
  assert.deepEqual(g.resetProgress(), { ok: true });
  assert.deepEqual(ev, ['save', 'upgrades', 'state']);
  const sv = g.save;
  assert.equal(sv.unlocked, 1); assert.deepEqual(sv.stars, []); assert.deepEqual(sv.records, []); assert.equal(sv.xp, 0);
  assert.equal(sv.survivalBest, null); assert.equal(sv.daily, null); assert.equal(sv.resume, null); assert.equal(sv.points, 0);
  assert.deepEqual(sv.upgrades, { hoist: 0, range: 0, spotter: 0, armor: 0, magazine: 0, repair: 0 });
  assert.equal('устаревшее' in sv, false, 'лишние поля прежних версий тоже стёрты');
  assert.equal(g.resumeInfo(), null); assert.equal(g.points(), 0); assert.equal(g.rank().index, 0); assert.equal(g.rank().xp, 0);
  assert.ok(g.upgrades().every((u) => u.level === 0));
  assert.equal(g.dailyInfo('2026-11-18').best, null);
  // что остаётся
  assert.deepEqual(g.settings(), mine); assert.equal(sv.muted, true); assert.equal(sv.difficulty, 1); assert.equal(g.state.difficulty, 1);
  // открыто только первое задание
  assert.equal(g.startMission(1).ok, false); assert.ok(g.startMission(0).ok); g.quit();
  assert.equal(g.restore().ok, false, 'продолжать нечего');
  // записано на диск и переживает перезапуск
  const disk = stored(st);
  assert.equal(disk.unlocked, 1); assert.equal(disk.xp, 0); assert.equal(disk.resume, null); assert.equal(disk.daily, null); assert.deepEqual(disk.stars, []);
  const again = createGame({ storage: st });
  assert.equal(again.save.unlocked, 1); assert.equal(again.save.xp, 0); assert.equal(again.resumeInfo(), null); assert.equal(again.points(), 0);
  assert.deepEqual(again.settings(), mine); assert.equal(again.save.muted, true); assert.equal(again.state.difficulty, 1);
  // после сброса игра работает: бой, улучшения снова копятся с нуля
  assert.equal(again.buyUpgrade('hoist').ok, false);
});

test('resetProgress({settings:true}): вместе с настройками, звуком и сложностью', () => {
  const st = mem(rich({ settings: { sens: 1.4, quality: 'low', volFx: 10 } }));
  const g = createGame({ storage: st });
  const ev = []; for (const n of ['save', 'upgrades', 'settings', 'state']) g.on(n, (e) => ev.push([n, e]));
  assert.deepEqual(g.resetProgress({ settings: true }), { ok: true });
  assert.deepEqual(ev.map((e) => e[0]), ['save', 'upgrades', 'settings', 'state']);
  assert.deepEqual(ev[2][1], DEF);
  assert.deepEqual(g.settings(), DEF); assert.equal(g.save.muted, false); assert.equal(g.save.difficulty, 0); assert.equal(g.state.difficulty, 0);
  assert.equal(g.save.xp, 0); assert.equal(g.save.unlocked, 1);
  const again = createGame({ storage: st });
  assert.deepEqual(again.settings(), DEF); assert.equal(again.save.muted, false); assert.equal(again.state.difficulty, 0); assert.equal(again.save.xp, 0);
  // {settings:false} и без аргумента — одно и то же
  const g3 = createGame({ storage: mem(rich({ settings: { quality: 'mid' } })) });
  assert.ok(g3.resetProgress({ settings: false }).ok); assert.equal(g3.settings().quality, 'mid'); assert.equal(g3.save.muted, true);
});

test('resetProgress из любой фазы: идущий бой, инструктаж, итоги — бой бросается, сохранённый бой стёрт', () => {
  for (const where of ['briefing', 'playing', 'paused', 'lost']) {
    const st = mem(rich()); const g = createGame({ storage: st });
    const ph = []; g.on('phase', (p) => ph.push(p));
    assert.ok(g.startMission(3).ok);
    if (where !== 'briefing') { g.begin(); tick(g, 16); assert.ok(g.save.resume, 'автосохранение есть'); }
    if (where === 'paused') g.pause(true);
    if (where === 'lost') { g.state.integrity = 0; g.state.targets.forEach((t) => { if (t.gun) t.gun.next = 0; }); for (let i = 0; i < 4000 && g.state.phase === 'playing'; i++) g.update(0.25); }
    ph.length = 0;
    assert.ok(g.resetProgress().ok, where);
    assert.equal(g.state.phase, 'menu', where); assert.equal(g.state.mission, null); assert.deepEqual(ph, ['menu']);
    assert.equal(g.save.resume, null); assert.equal(g.save.xp, 0); assert.equal(g.save.unlocked, 1);
    g.update(1); g.update(1);       // такт после сброса ничего не пишет и не падает
    assert.equal(stored(st).resume, null); assert.equal(stored(st).xp, 0);
    assert.ok(g.startMission(0).ok); g.begin(); tick(g, 3); assert.equal(g.state.phase, 'playing');
  }
  // из меню фаза не «мигает»
  const g = createGame({ storage: mem(rich()) }); const ph = []; g.on('phase', (p) => ph.push(p));
  g.resetProgress(); assert.deepEqual(ph, []);
});

test('автосохранение выключено: периодической записи нет, suspend() пишет; включили обратно — пишет снова', () => {
  const st = mem(); const g = createGame({ storage: st });
  assert.ok(g.setSetting('autosave', false).ok);
  g.startMission(0); g.begin();
  tick(g, 50);
  assert.equal(g.state.phase, 'playing'); assert.equal(g.save.resume, null); assert.equal(g.resumeInfo(), null); assert.equal(stored(st).resume, null);
  // сохранение по требованию (кнопка «СОХРАНИТЬ», уход в фон) работает всегда
  assert.ok(g.suspend().ok);
  const t0 = g.resumeInfo().time; assert.ok(t0 >= 49 && t0 <= 51);
  tick(g, 40); assert.equal(g.resumeInfo().time, t0, 'само не перезаписывается');
  assert.ok(g.setSetting('autosave', true).ok);
  tick(g, 16); assert.ok(g.resumeInfo().time > t0 + 30, 'после включения пишет снова');
  // по умолчанию — каждые 15 с
  const g2 = createGame({ storage: mem() }); g2.startMission(0); g2.begin();
  tick(g2, 14); assert.equal(g2.save.resume, null); tick(g2, 2); assert.ok(g2.save.resume);
  // выход с сохранением и возврат в тот же момент при выключенном автосохранении
  const st3 = mem(); const g3 = createGame({ storage: st3 }); g3.setSetting('autosave', false);
  g3.startMission(0); g3.begin(); tick(g3, 33);
  const time = g3.state.time; g3.suspend(); g3.quit({ keep: true });
  const g4 = createGame({ storage: st3 }); assert.ok(g4.restore().ok);
  assert.equal(g4.state.phase, 'playing'); assert.ok(Math.abs(g4.state.time - time) < 1e-9);
});

test('скорость боя по умолчанию: применяется в begin(); restore() возвращает скорость, с которой бой записан; setSpeed понимает ×1, ×2, ×3', () => {
  const st = mem(); const g = createGame({ storage: st });
  g.startMission(0); g.begin(); assert.equal(g.state.speed, 1); g.quit();
  assert.ok(g.setSetting('speed', 2).ok);
  g.startMission(0); assert.equal(g.state.speed, 1, 'до начала боя — ×1'); g.begin(); assert.equal(g.state.speed, 2);
  const t0 = g.state.time; g.update(0.1); assert.ok(Math.abs(g.state.time - t0 - 0.2) < 1e-9, 'время идёт вдвое быстрее');
  g.setSpeed(3); assert.equal(g.state.speed, 3); g.setSpeed(1); assert.equal(g.state.speed, 1); g.setSpeed(2); assert.equal(g.state.speed, 2);
  g.setSpeed(7); assert.equal(g.state.speed, 1);
  // смена настройки посреди боя текущую скорость не трогает
  g.setSpeed(3); g.setSetting('speed', 1); assert.equal(g.state.speed, 3); g.setSetting('speed', 2);
  g.suspend(); g.quit({ keep: true });
  const g2 = createGame({ storage: st }); assert.ok(g2.restore().ok); assert.equal(g2.state.speed, 3, 'продолженный бой — с той же скоростью, что при записи');
  g2.quit(); g2.startSurvival(); g2.begin(); assert.equal(g2.state.speed, 2);
  g2.quit(); g2.startDaily('2026-11-18'); g2.begin(); assert.equal(g2.state.speed, 2);
});

test('свои в зоне поражения: friendsInDanger / friendInDanger — по замеру, по вычислителю, по наводке', () => {
  const g = start(30, null, 0); const s = g.state; tick(g, 8); noWind(g);
  s.targets.forEach((t) => { t.hunt.next = 1e9; t.gun = null; }); s.friends.forEach((f) => { f.speed = 0; });
  assert.equal(g.FRIEND_ZONE, 0.4);
  const bat = s.mission.battery, f = s.friends[1], t = s.targets.find((q) => q.active) || s.targets[0];
  const polar = (x, y) => ({ bearing: ((Math.atan2(x - bat.x, y - bat.y) / RAD) + 360) % 360, range: Math.hypot(x - bat.x, y - bat.y) });
  // соседей по конвою разводим: F1 — в 0.3 км от F2 (для проверки порядка), F3 — далеко
  s.friends[0].x = f.x + 0.3; s.friends[0].y = f.y + 0.2; s.friends[2].x = f.x - 3; s.friends[2].y = f.y;
  const calc = () => { for (let c = 1; c <= 8; c++) { g.setComputerCharge(c); if (g.compute().ok) return true; } return false; };
  // нет выбранной цели / нет замера — никого
  s.activeTarget = null; assert.deepEqual(g.friendsInDanger(), []); assert.equal(g.friendInDanger(), null);
  s.activeTarget = t.id; assert.equal(g.friendInDanger(), null);
  // замер в 0.3 км от своего — в зоне; в 0.5 км — нет
  g.setAlidade(polar(f.x + 0.3, f.y)); assert.ok(g.recordMeasurement().ok);
  assert.deepEqual(g.friendsInDanger().map((q) => q.id), ['F1', 'F2'], 'оба в зоне, ближайший к прицелу — первым'); assert.equal(g.friendInDanger(), 'F1');
  g.setAlidade(polar(f.x - 0.3, f.y)); assert.ok(g.recordMeasurement().ok);
  assert.deepEqual(g.friendsInDanger().map((q) => q.id), [f.id]); assert.equal(g.friendInDanger(), f.id);
  assert.equal(g.friendsInDanger()[0], f, 'те же объекты, что в state.friends');
  s.friends[0].x = f.x + 3;       // дальше F1 не мешает
  g.setAlidade(polar(f.x, f.y - 0.5)); assert.ok(g.recordMeasurement().ok);
  assert.equal(g.friendInDanger(), null);
  // замер в стороне, но дальность вычислителя по тому же пеленгу выводит точку на своего
  const p = polar(f.x, f.y);
  g.setAlidade({ bearing: p.bearing, range: p.range - 1.5 }); assert.ok(g.recordMeasurement().ok); assert.equal(g.friendInDanger(), null);
  g.setComputerRange(p.range); assert.ok(calc());
  assert.equal(g.friendInDanger(), f.id);
  // расчёт устарел — точка вычислителя не считается
  s.computer.stale = true; assert.equal(g.friendInDanger(), null); s.computer.stale = false;
  // осветительный и дымовой своим не вредят: список есть, а подтверждать нечего
  s.breech.shell = 'smoke'; assert.equal(g.friendInDanger(), null); assert.equal(g.friendsInDanger().length, 1);
  s.breech.shell = 'illum'; assert.equal(g.friendInDanger(), null);
  s.breech.shell = 'he'; assert.equal(g.friendInDanger(), f.id);
  s.breech.shell = null;
  // потопленный, дошедший — не считаются
  f.arrived = true; assert.equal(g.friendInDanger(), null); f.arrived = false;
  f.alive = false; assert.equal(g.friendInDanger(), null); f.alive = true;
  // фактическая наводка заряженного орудия (замер далеко)
  g.setAlidade({ bearing: (p.bearing + 40) % 360, range: p.range }); assert.ok(g.recordMeasurement().ok); assert.ok(calc());
  assert.equal(g.friendInDanger(), null);
  s.turret.bearing = p.bearing; s.checklist.loaded = true; assert.equal(g.friendInDanger(), f.id);
  s.checklist.loaded = false; assert.equal(g.friendInDanger(), null);
  // вне боя — никого и без ошибок
  g.quit(); assert.deepEqual(g.friendsInDanger(), []); assert.equal(g.friendInDanger(), null);
  assert.equal(createGame({ storage: mem() }).friendInDanger(), null);
});

test('продолженный бой: скорость времени и пост — те же, что при записи; новый бой — с планшета и скоростью из настроек', () => {
  const st = mem();
  const g = createGame({ storage: st });
  assert.ok(g.startMission(0).ok); g.begin();
  assert.equal(g.state.station, 'plot'); assert.equal(g.state.speed, 1);
  assert.equal(g.setStation('').ok, false); assert.equal(g.setStation(7).ok, false); assert.equal(g.setStation('<b>').ok, false);
  assert.equal(g.state.station, 'plot', 'негодный пост не записан');
  assert.ok(g.setStation('fire').ok); g.setSpeed(3); g.update(0.5);
  assert.ok(g.suspend().ok); g.quit({ keep: true });
  // тот же сеанс
  assert.ok(g.restore().ok);
  assert.equal(g.state.speed, 3); assert.equal(g.state.station, 'fire'); assert.equal(g.state.paused, false);
  // после перезапуска игры
  const g2 = createGame({ storage: st });
  assert.ok(g2.restore().ok);
  assert.equal(g2.state.speed, 3); assert.equal(g2.state.station, 'fire');
  // испорченные значения в старом снимке не ломают бой
  const snap = JSON.parse(JSON.stringify(g2.save.resume.snap)); snap.state.speed = 9; delete snap.state.station;
  g2.setSetting('speed', 2);
  assert.ok(g2.restore(snap).ok);
  assert.equal(g2.state.speed, 2); assert.equal(g2.state.station, 'plot');
  // новый бой
  g2.quit(); assert.ok(g2.startMission(0).ok); g2.begin();
  assert.equal(g2.state.speed, 2); assert.equal(g2.state.station, 'plot');
});
