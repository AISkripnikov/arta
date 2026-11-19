// Тесты восьми новых возможностей: снимок боя, труба, корабли, улучшения, расчёт, свои, налёт, задание дня, настройки.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/game/index.js';
import { CAMPAIGN, dailyDef, isLand } from '../src/game/missions.js';
import { RAD, norm, tick, waitBreech, waitReport, unlockAll, botStep, playBot, autoAA, fireQuiet, noWind, start, elevTo, turnTo, friendNear } from './bot.js';

/** Настройки по умолчанию (полный список — см. README, раздел 8). */
const DEF = { sens: 1, invert: false, lefty: false, vibro: true, vibroPower: 'high', hints: 'new', autosave: true, speed: 1, confirmFriendly: true, crewPanel: 'full', volFx: 100, volAmb: 50, volRadio: 100, volMusic: 60, text: 1, quality: 'auto', qualityChosen: false, fps: 60, nightTint: 'normal', showFps: false, shake: true };
const mem = (init) => { const m = {}; if (init) m['arta2.save'] = JSON.stringify(init); return { mem: m, get: (k) => m[k] || null, set: (k, v) => { m[k] = v; } }; };
const brgTo = (bat, o) => norm(Math.atan2(o.x - bat.x, o.y - bat.y) / RAD);
const withRandom = (v, fn) => { const R = Math.random; Math.random = () => v; try { return fn(); } finally { Math.random = R; } };
/** В снимке только JSON: ни функций, ни undefined, ни NaN/Infinity. */
function plain(o, path = 'snap') {
  if (o === null) return;
  const t = typeof o;
  if (t === 'number') { assert.ok(Number.isFinite(o), path + ' — не конечное число'); return; }
  if (t === 'string' || t === 'boolean') return;
  assert.equal(t, 'object', path + ' — ' + t);
  for (const k of Object.keys(o)) plain(o[k], path + '.' + k);
}
/** Снять снимок в первый такт, когда выполнится условие. */
function capture(game, cond) {
  const real = game.update, box = { snap: null };
  game.update = (dt) => { real(dt); if (!box.snap && game.state.phase === 'playing' && cond(game.state)) box.snap = game.snapshot(); };
  return box;
}
/** Сыграть бой ботом, по дороге снять снимок; восстановить его в НОВОЙ игре с тем же хранилищем и доиграть. */
function scenario(begin, cond, diff = 0) {
  const store = unlockAll();
  const g1 = autoAA(createGame({ storage: store }));
  g1.setDifficulty(diff); begin(g1); g1.begin();
  let end1 = null; g1.on('missionEnd', (e) => { end1 = e; });
  const box = capture(g1, cond);
  playBot(g1); tick(g1, 5);
  assert.ok(box.snap, 'снимок снят');
  const snap = box.snap;
  plain(snap);
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap, 'снимок переживает JSON без потерь');
  const g2 = autoAA(createGame({ storage: store }));
  assert.equal(g2.state.phase, 'menu');
  assert.ok(g2.restore(JSON.parse(JSON.stringify(snap))).ok);
  assert.equal(g2.state.phase, 'playing');
  const again = g2.snapshot();
  again.sys.nextAuto = snap.sys.nextAuto; again.state.aa.firing = snap.state.aa.firing; again.state.paused = snap.state.paused;
  assert.deepEqual(again, snap, 'восстановленный бой — тот же самый');
  let end2 = null; g2.on('missionEnd', (e) => { end2 = e; });
  playBot(g2); tick(g2, 5);
  return { g1, g2, end1, end2, snap };
}
/** Бот надёжен, но не всесилен: сценарий «обе партии выиграны» допускает одну переигровку. */
function bothWin(begin, cond, check, diff = 0) {
  let r = null;
  for (let i = 0; i < 3; i++) {
    r = scenario(begin, cond, diff);
    if (check) check(r);
    if (r.end1 && r.end1.won && r.end2 && r.end2.won) return r;
  }
  assert.fail('исходный и восстановленный бой должны кончаться победой: ' + JSON.stringify([r.end1 && r.end1.reason, r.end2 && r.end2.reason]));
}

// ======================= 8. СНИМОК БОЯ =======================
test('снимок: снаряд в полёте → новая игра → бот доигрывает и побеждает', () => {
  const r = bothWin((g) => g.startMission(3), (s) => s.flight.length > 0 && s.flight[0].t > 3, (q) => {
    assert.equal(q.snap.state.flight.length, 1);
    assert.equal(q.snap.state.history.length, q.snap.state.shots);
  });
  assert.equal(r.end2.stats.shots, r.g2.state.history.length, 'журнал выстрелов продолжился');
  assert.ok(r.g2.state.history[0].x != null, 'снаряд из снимка долетел');
});

test('снимок: затвор занят (подача снаряда) — операция завершается после восстановления', () => {
  bothWin((g) => g.startMission(1), (s) => !!s.breech.busy && s.breech.busy.kind === 'hoist' && s.breech.busy.t > 0.5, (q) => {
    const b = q.snap.state.breech.busy;
    assert.equal(b.kind, 'hoist'); assert.deepEqual(b.arg, { type: 'he' });
  });
  // прямо: восстановили — подача дошла до конца, снаряд на лотке
  const g = start(0); tick(g, 6);
  g.openBreech(); waitBreech(g); g.hoistShell('he'); tick(g, 1);
  const snap = g.snapshot();
  const g2 = createGame({ storage: unlockAll() });
  assert.ok(g2.restore(snap).ok);
  assert.equal(g2.state.breech.shell, null); assert.equal(g2.state.breech.busy.kind, 'hoist');
  waitBreech(g2);
  assert.equal(g2.state.breech.shell, 'he'); assert.equal(g2.state.breech.rammed, false);
});

test('снимок: очередь (автоперезарядка) и ожидаемый доклад корректировщика продолжаются', () => {
  const g = start(0); const s = g.state; tick(g, 6); noWind(g);
  const t = s.targets[0];
  g.setBurst(3);
  const box = capture(g, (q) => !!q.breech.busy && q.breech.busy.kind === 'auto' && q.shots === 1);
  fireQuiet(g, 'he', t.x + 1, t.y + 1, t);
  assert.ok(box.snap, 'снят посреди очереди');
  assert.deepEqual(box.snap.state.breech.busy.arg, { shell: 'he', charges: s.history[0].charges });
  const g2 = createGame({ storage: unlockAll() }); const s2 = g2.state;
  assert.ok(g2.restore(box.snap).ok);
  for (let i = 0; i < 600 && s2.shots < 3; i++) g2.update(0.1);
  assert.equal(s2.shots, 3, 'очередь достреляна'); assert.equal(s2.fire.burstLeft, 0);
  // доклад корректировщика в пути — тоже данные
  g.setBurst(1);
  const box2 = capture(g, (q) => q.reportDue != null);
  fireQuiet(g, 'he', t.x + 1, t.y + 1, t);
  assert.ok(box2.snap && box2.snap.sys.events.some((e) => e.a === 'report' && /перелёт/.test(e.p.report.text)));
  const g3 = createGame({ storage: unlockAll() }); const s3 = g3.state;
  const reports = []; g3.on('report', (r) => reports.push(r));
  assert.ok(g3.restore(box2.snap).ok);
  const before = s3.lastReport && s3.lastReport.time;
  assert.ok(s3.reportDue != null);
  tick(g3, 4);
  assert.equal(reports.length, 1); assert.equal(s3.reportDue, null);
  assert.ok(s3.lastReport.time !== before && /перелёт/.test(s3.lastReport.text), 'доклад дошёл после восстановления');
});

test('снимок: пауза между волнами обороны — следующая волна приходит после восстановления', () => {
  const store = unlockAll();
  const g1 = autoAA(createGame({ storage: store })); g1.setDifficulty(0);
  g1.startSurvival(); g1.begin();
  const s1 = g1.state;
  const box = capture(g1, (s) => s.wave === 1 && s.targets.length > 0 && s.targets.every((t) => !t.alive));
  playBot(g1, {}, () => s1.wave >= 2, 60);
  if (!box.snap) { s1.targets.forEach((t) => { t.alive = false; }); tick(g1, 0.3); }   // бот не справился — волну снимаем сами
  const snap = box.snap;
  assert.ok(snap, 'снимок в паузе');
  plain(snap); assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap);
  assert.equal(snap.sys.waveBusy, true);
  assert.ok(snap.sys.events.some((e) => e.a === 'nextWave'), 'приход волны — отложенное действие-данные');
  const g2 = autoAA(createGame({ storage: store })); const s2 = g2.state;
  const waves = []; g2.on('wave', (e) => waves.push(e));
  assert.ok(g2.restore(snap).ok);
  const maxId = Math.max(...snap.state.targets.map((t) => t.id));
  assert.equal(s2.wave, 1);
  tick(g2, 11);
  assert.equal(s2.wave, 2); assert.deepEqual(waves, [{ wave: 2, cleared: false }]);
  assert.ok(s2.targets.filter((t) => t.alive).length >= 2 && s2.targets.filter((t) => t.alive).every((t) => t.id > maxId));
  let end = null; g2.on('missionEnd', (e) => { end = e; });
  playBot(g2, {}, () => s2.wave >= 3 || s2.time > snap.state.time + 500, 40);
  assert.ok(s2.phase === 'playing' || (end && end.survival), 'бой идёт дальше без сбоев');
  if (end) assert.ok(end.survival.waves >= 1, 'отбитая до снимка волна засчитана');
});

test('снимок: налёт на подходе — самолёты долетают (или сбиты) в восстановленном бою', () => {
  const r = bothWin((g) => g.startMission(31), (s) => !!s.raid && s.raid.phase === 'inbound' && s.raid.planes.some((p) => p.range < 6), (q) => {
    assert.equal(q.snap.state.raid.planes.length, 2);
    assert.ok(q.snap.sys.events.some((e) => e.a === 'raidStart'), 'второй налёт ещё впереди — тоже в снимке');
  });
  assert.ok(r.end2.stats.planesDown >= 2, 'зенитчик сбил самолёты из снимка: ' + r.end2.stats.planesDown);
  // без зенитки: бомбы падают и в восстановленном бою
  const g3 = createGame({ storage: unlockAll() });
  assert.ok(g3.restore(r.snap).ok);
  const ev = []; g3.on('plane', (e) => ev.push(e)); g3.on('raid', (e) => ev.push(e));
  const i0 = g3.state.integrity;
  tick(g3, 45);
  assert.equal(ev.filter((e) => e.bombed === true).length, 2);
  assert.ok(ev.some((e) => e.phase === 'end' && e.bombed === 2 && e.shot === 0));
  assert.ok(g3.state.integrity <= i0 - 24);
});

test('снимок в 10 с тревоги «ВОЗДУХ!»: после восстановления тревога повторяется с оставшимся временем', () => {
  const g = createGame({ storage: unlockAll() });
  g.startMission(31); g.begin();
  let n = 0; while (!g.state.raidWarn && n++ < 2000) g.update(0.1);
  assert.ok(g.state.raidWarn && !g.state.raid, 'тревога объявлена, самолётов ещё нет');
  tick(g, 3);
  const snap = g.snapshot();
  const g2 = createGame({ storage: unlockAll() });
  const ev = []; g2.on('raid', (e) => ev.push(e));
  assert.ok(g2.restore(snap).ok);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].phase, 'warning'); assert.equal(ev[0].restored, true);
  assert.ok(ev[0].eta > 5 && ev[0].eta < 8, 'осталось около 7 с: ' + ev[0].eta);
  tick(g2, 9);
  assert.ok(g2.state.raid && g2.state.raid.phase === 'inbound' && g2.state.raidWarn === null, 'налёт начался, тревога снята');
  assert.equal(ev.filter((e) => e.phase === 'start').length, 1);
  // вне тревоги восстановление событий налёта не шлёт
  const g3 = createGame({ storage: unlockAll() }), ev3 = []; g3.on('raid', (e) => ev3.push(e));
  assert.ok(g3.restore(g2.snapshot()).ok); assert.equal(ev3.length, 0);
});

test('сохранение боя: suspend, автосохранение каждые 15 с, resumeInfo, сброс в конце боя', () => {
  const store = unlockAll();
  const g = createGame({ storage: store }); g.setDifficulty(0);
  assert.equal(g.resumeInfo(), null);
  assert.equal(g.suspend().ok, false, 'вне боя сохранять нечего');
  g.startMission(1); g.begin();
  tick(g, 14); assert.equal(g.save.resume, null);
  tick(g, 1.5);
  assert.ok(g.save.resume, 'автосохранение на 15-й секунде');
  assert.equal(g.save.resume.kind, 'campaign'); assert.equal(g.save.resume.title, 'Два ориентира');
  assert.ok(Math.abs(g.save.resume.savedAt - 15) < 0.5);
  tick(g, 6); assert.ok(g.save.resume.savedAt < 16, 'между автосохранениями не пишет');
  assert.ok(g.suspend().ok);
  assert.ok(Math.abs(g.save.resume.savedAt - g.state.time) < 0.11);
  assert.deepEqual(g.resumeInfo(), { title: 'Два ориентира', time: g.save.resume.savedAt, integrity: 100, kind: 'campaign' });
  const t0 = g.state.time;
  g.quit({ keep: true });
  // «приложение перезапущено»
  const g2 = autoAA(createGame({ storage: store }));
  assert.deepEqual(g2.resumeInfo(), { title: 'Два ориентира', time: Math.round(t0 * 10) / 10, integrity: 100, kind: 'campaign' });
  assert.ok(g2.restore().ok, 'restore() без аргумента берёт save.resume');
  assert.ok(Math.abs(g2.state.time - t0) < 0.11); assert.equal(g2.state.mission.name, 'Два ориентира');
  let end = null; g2.on('missionEnd', (e) => { end = e; });
  playBot(g2); tick(g2, 5);
  assert.ok(end && end.won);
  assert.equal(g2.save.resume, null, 'в конце боя сохранение сброшено');
  assert.equal(JSON.parse(store.mem['arta2.save']).resume, null);
  assert.equal(g2.restore().ok, false);
  // discardResume и обычный quit()
  g2.startMission(0); g2.begin(); tick(g2, 3); g2.suspend(); assert.ok(g2.resumeInfo());
  g2.discardResume(); assert.equal(g2.resumeInfo(), null);
  g2.suspend(); g2.quit(); assert.equal(g2.resumeInfo(), null, 'выход без сохранения');
  assert.equal(g2.snapshot(), null, 'вне боя снимка нет');
  assert.equal(g2.restore({ v: 99 }).ok, false);
});

// ======================= 1. НАБЛЮДАТЕЛЬНЫЙ ПОСТ =======================
test('труба: поле зрения, видимость днём/в тумане/ночью, пеленг на планшет', () => {
  const g = start(1); const s = g.state, bat = s.mission.battery; tick(g, 12);
  assert.deepEqual(s.scope, { bearing: 0, zoom: 4, last: null });
  assert.equal(g.scopeFov(), 16);
  g.setScope({ zoom: 10, bearing: 370.5 }); assert.equal(g.scopeFov(), 6.4); assert.equal(s.scope.bearing, 10.5);
  g.setScope({ zoom: 4 });
  const [a, b] = s.targets;
  assert.equal(g.visible(a.id), true); assert.equal(g.visible(b.id), true);
  assert.equal(g.visible(77), false); assert.equal(g.visible('F1'), false);
  s.mission.weather = 'fog'; assert.equal(g.visible(a.id), false, 'в тумане дальше 4 км не видно');
  a.x = bat.x + 1; a.y = bat.y + 3; assert.equal(g.visible(a.id), true);
  s.mission.weather = 'clear';
  s.mission.night = true; assert.equal(g.visible(a.id), false, 'ночью без света не видно');
  s.lights.push({ x: a.x, y: a.y, until: s.time + 60, n: 0 }); assert.equal(g.visible(a.id), true); assert.equal(g.visible(b.id), false);
  b.firedAt = s.time; assert.equal(g.visible(b.id), true, 'вспышка выстрела');
  tick(g, 6.5); assert.equal(g.visible(b.id), false, 'через 6 с вспышка погасла');
  s.mission.night = false;
  b.alive = false; b.sinking = { since: s.time, dur: 18 }; assert.equal(g.visible(b.id), true, 'тонущего ещё видно');
  b.sunk = true; assert.equal(g.visible(b.id), false);
  a.escaped = true; assert.equal(g.visible(a.id), false, 'ушедшая/погрузившаяся');
  // пеленг трубы на планшет
  for (let i = 0; i < 8; i++) { g.setScope({ bearing: 10 + i }); assert.ok(g.scopeMark().ok); }
  assert.equal(s.plot.lines.length, 6, 'не больше шести линий');
  assert.deepEqual(s.plot.lines[5], { from: 'scope', x: bat.x, y: bat.y, bearing: 17 });
  assert.equal(s.plot.lines[0].bearing, 12);
  assert.ok(s.radio.some((m) => m.from === 'РАСЧЁТ' && /пеленг 017.0°/.test(m.text)));
  // скрытая батарея видна только пока стреляет
  const g2 = start(8); tick(g2, 5);
  const h = g2.state.targets.find((t) => t.locate === 'sound');
  assert.equal(g2.visible(h.id), false);
  h.firedAt = g2.state.time; assert.equal(g2.visible(h.id), true);
});

test('свой глаз: разрыв в поле зрения трубы — НАБЛЮДАЮ сразу, знаки отклонения', () => {
  const g = start(0); const s = g.state, bat = s.mission.battery; tick(g, 8); noWind(g);
  const t = s.targets[0], L = Math.hypot(t.x - bat.x, t.y - bat.y), ux = (t.x - bat.x) / L, uy = (t.y - bat.y) / L;
  const seen = []; g.on('impact', (e) => seen.push({ observed: e.observed, radio: s.radio.some((m) => /НАБЛЮДАЮ/.test(m.text)), pending: s.reportDue != null }));
  // перелёт 400 м и вправо 300 м; труба смотрит на цель
  fireQuiet(g, 'he', t.x + ux * 0.4 + uy * 0.3, t.y + uy * 0.4 - ux * 0.3, t);
  assert.deepEqual(seen[0], { observed: true, radio: true, pending: true }, 'свой доклад — в момент разрыва, корректировщик ещё молчит');
  const last = s.scope.last;
  assert.equal(last.n, 1); assert.equal(last.targetId, t.id); assert.equal(last.over, 1);
  assert.ok(Math.abs(last.dBearing - Math.atan2(0.3, L + 0.4) / RAD) < 0.11 && last.dBearing > 0, 'вправо, °: ' + last.dBearing);
  assert.equal(s.impacts[0].observed, true);
  assert.ok(s.radio.some((m) => m.from === 'РАСЧЁТ' && /НАБЛЮДАЮ: разрыв № 1 — ЦЕЛЬ 1: правее на \d,\d°, перелёт\./.test(m.text)));
  // недолёт и влево
  fireQuiet(g, 'he', t.x - ux * 0.5 - uy * 0.2, t.y - uy * 0.5 + ux * 0.2, t);
  assert.equal(s.scope.last.over, -1); assert.ok(s.scope.last.dBearing < 0); assert.equal(s.scope.last.n, 2);
  // труба смотрит в сторону — не наблюдал, last прежний
  g.setScope({ bearing: s.scope.bearing + 40 });
  fireQuiet(g, 'he', t.x + ux * 0.5, t.y + uy * 0.5, t, { noScope: true });
  assert.equal(seen[2].observed, false); assert.equal(s.scope.last.n, 2); assert.equal(s.impacts[2].observed, false);
  // ×10: поле 6,4° — разрыв в 5° от оси уже не виден
  g.setScope({ bearing: brgTo(bat, t) + 5, zoom: 10 });
  fireQuiet(g, 'he', t.x + ux * 0.5, t.y + uy * 0.5, t, { noScope: true });
  assert.equal(seen[3].observed, false);
  g.setScope({ zoom: 4 });
  fireQuiet(g, 'he', t.x + ux * 0.5, t.y + uy * 0.5, t, { noScope: true });
  assert.equal(seen[4].observed, true, 'при ×4 (16°) тот же разрыв виден');
  // попадание
  fireQuiet(g, 'he', t.x, t.y, t);
  assert.equal(s.scope.last.over, 0); assert.equal(s.scope.last.targetId, t.id);
  assert.ok(s.radio.some((m) => /НАБЛЮДАЮ: разрыв № 6 — попадание, ЦЕЛЬ 1!/.test(m.text)));
});

test('свой глаз ночью: только по освещённой цели; корректировщика нет — доклад blind', () => {
  const g = start(33, null, 0); const s = g.state; tick(g, 8); noWind(g);
  assert.equal(s.mission.noSpotter, true); assert.equal(s.mission.night, true);
  assert.ok(s.radio.some((m) => /Корректировщик на связь не вышел/.test(m.text)));
  const t = s.targets[0]; t.speed = 0; t.hunt.next = 1e9; s.targets[1].delay = 1e9;
  s.friends.forEach((f) => { f.speed = 0; });
  // без света: ни корректировщика, ни своего наблюдения
  fireQuiet(g, 'he', t.x + 0.4, t.y + 0.4, t);
  assert.equal(s.lastReport.blind, true); assert.equal(s.lastReport.observed, false); assert.equal(s.lastReport.text, null);
  assert.equal(s.scope.last, null); assert.equal(s.impacts[0].observed, false);
  assert.equal(s.radio.some((m) => m.from === 'КОРРЕКТИРОВЩИК'), false);
  // свет над целью: свой глаз работает
  s.lights.push({ x: t.x, y: t.y, until: s.time + 600, n: 0 }); tick(g, 0.3);
  assert.equal(t.lit, true); assert.equal(g.visible(t.id), true);
  const bat = s.mission.battery, L = Math.hypot(t.x - bat.x, t.y - bat.y), ux = (t.x - bat.x) / L, uy = (t.y - bat.y) / L;
  fireQuiet(g, 'he', t.x - ux * 0.4, t.y - uy * 0.4, t);
  assert.equal(s.lastReport.blind, true);
  assert.equal(s.scope.last.over, -1); assert.equal(s.scope.last.targetId, t.id); assert.equal(s.impacts[1].observed, true);
  // бот по одним своим наблюдениям добивает стоящую цель
  const corr = {};
  for (let i = 0; i < 10 && t.alive && s.phase === 'playing'; i++) botStep(g, corr);
  assert.equal(t.alive, false, 'цель уничтожена без корректировщика');
});

// ======================= 2. КОРАБЛИ =======================
test('корабли: курс, пожар, 18 с под воду, потом sunk', () => {
  const g = start(5, null, 0); const s = g.state; tick(g, 12); noWind(g);
  for (const t of s.targets) {
    assert.ok(Number.isInteger(t.heading) && t.heading >= 0 && t.heading < 360, 'heading у каждой цели');
    assert.equal(t.sinking, null); assert.equal(t.sunk, false); assert.equal(t.burning, false);
    if (t.moving) assert.equal(t.heading, t.course);
  }
  const d = s.targets.find((t) => t.kind === 'destroyer'); d.speed = 0;
  const dead = []; g.on('targetDestroyed', (t) => dead.push(t.id));
  fireQuiet(g, 'he', d.x + d.radius * 1.5, d.y, d);
  assert.equal(d.hp, 1); assert.equal(d.alive, true); assert.equal(d.burning, true, 'повреждённый горит');
  fireQuiet(g, 'he', d.x, d.y, d);
  assert.equal(d.alive, false); assert.deepEqual(dead, [d.id]);
  assert.ok(d.sinking && d.sinking.dur === 18 && d.sunk === false);
  assert.ok(s.targets.includes(d), 'потопленный остаётся в списке');
  const since = d.sinking.since;
  assert.equal(g.visible(d.id), true);
  tick(g, since + 17 - s.time); assert.equal(d.sunk, false);
  tick(g, 1.5); assert.equal(d.sunk, true); assert.equal(d.sinking.since, since);
  assert.equal(g.visible(d.id), false);
  // одно-hp цель не «горит»
  const g2 = start(0); tick(g2, 8); const b = g2.state.targets[0];
  fireQuiet(g2, 'he', b.x, b.y, b);
  assert.equal(b.alive, false); assert.equal(b.burning, false); assert.ok(b.sinking);
});

// ======================= 3. УЛУЧШЕНИЯ =======================
test('улучшения: очки снабжения, покупка, сброс, сохранение', () => {
  const st = mem({ unlocked: 99, xp: 1500, stars: [] });
  const g = createGame({ storage: st });
  assert.equal(g.points(), 10); assert.equal(g.save.points, 10);
  const list = g.upgrades();
  assert.deepEqual(list.map((u) => u.id), ['hoist', 'range', 'spotter', 'armor', 'magazine', 'repair']);
  assert.deepEqual(list.map((u) => u.title), ['БЫСТРЫЙ ЭЛЕВАТОР', 'ДАЛЬНОМЕР', 'ВТОРОЙ КОРРЕКТИРОВЩИК', 'БРОНЯ', 'ПОГРЕБ', 'РЕМОНТНАЯ ПАРТИЯ']);
  for (const u of list) { assert.equal(u.level, 0); assert.equal(u.max, 3); assert.equal(u.cost, 2); assert.ok(u.desc && u.effect); }
  const ev = []; g.on('upgrades', (e) => ev.push(e));
  assert.ok(g.buyUpgrade('hoist').ok); assert.equal(g.points(), 8); assert.equal(g.upgrades()[0].cost, 3);
  assert.ok(g.buyUpgrade('hoist').ok); assert.equal(g.points(), 5); assert.equal(g.upgrades()[0].cost, 4);
  assert.ok(g.buyUpgrade('hoist').ok); assert.equal(g.points(), 1);
  assert.equal(g.upgrades()[0].cost, null); assert.equal(g.upgrades()[0].level, 3); assert.match(g.upgrades()[0].effect, /36%/);
  assert.equal(g.buyUpgrade('hoist').ok, false, 'выше третьего уровня нет');
  assert.equal(g.buyUpgrade('armor').reason, 'Не хватает очков снабжения');
  assert.equal(g.buyUpgrade('nope').ok, false);
  assert.equal(ev.length, 3);
  assert.deepEqual(JSON.parse(st.mem['arta2.save']).upgrades, { hoist: 3, range: 0, spotter: 0, armor: 0, magazine: 0, repair: 0 });
  const g2 = createGame({ storage: st });
  assert.equal(g2.upgrades()[0].level, 3); assert.equal(g2.points(), 1);
  g2.startMission(0);
  assert.equal(g2.buyUpgrade('range').ok, false, 'в бою улучшения не ставят'); assert.equal(g2.resetUpgrades().ok, false);
  g2.quit();
  assert.ok(g2.resetUpgrades().ok); assert.equal(g2.points(), 10); assert.equal(g2.upgrades()[0].level, 0);
});

test('улучшения: действие каждого', () => {
  const st = mem({ unlocked: 99, xp: 0, stars: [], difficulty: 0, upgrades: { hoist: 3, range: 2, spotter: 2, armor: 3, magazine: 2, repair: 1 } });
  const g = createGame({ storage: st }); const s = g.state;
  g.startMission(26);      // туман? нет: 26 — шторм; берём туманное задание ниже
  g.quit();
  g.startMission(25); assert.equal(s.mission.weather, 'fog');
  assert.deepEqual(s.shells, { he: 22 + 4, ap: 0 + 2, illum: 0 + 2, smoke: 0, shrap: 0 }, 'ПОГРЕБ: +2 ОФ, +1 ББ, +1 ОСВ за уровень');
  g.begin(); tick(g, 14);
  // ДАЛЬНОМЕР: в тумане шаг координат 0,05 км вместо 0,1
  for (const t of s.targets.filter((q) => q.reported)) for (const v of [t.reported.x, t.reported.y]) assert.ok(Math.abs(v * 20 - Math.round(v * 20)) < 1e-6, 'шаг 0,05: ' + v);
  assert.ok(s.radio.some((m) => m.from === 'МЕТЕО' && /до 0,05 км/.test(m.text)));
  // ЭЛЕВАТОР: подача и досылание −36%, остальное без изменений
  g.openBreech(); assert.ok(Math.abs(s.breech.busy.dur - 1.2) < 1e-9); waitBreech(g);
  g.hoistShell('he'); assert.ok(Math.abs(s.breech.busy.dur - 2.5 * 0.64) < 1e-9); waitBreech(g);
  g.ramShell(); assert.ok(Math.abs(s.breech.busy.dur - 1.8 * 0.64) < 1e-9); waitBreech(g);
  // РЕМОНТ −20%
  s.faults.lights = true; g.repair('lights'); assert.ok(Math.abs(s.repair.dur - 25 * 0.8) < 1e-9);
  // КОРРЕКТИРОВЩИК: задержка доклада 3 с → 1,5 с
  const barge = s.targets.find((q) => q.kind === 'barge');
  let rep = null; g.on('impact', (e) => { rep = e.report || rep; });
  fireQuiet(g, 'he', barge.x + 0.5, barge.y + 0.5, barge);
  assert.equal(rep.delay, 1.5);
  // БРОНЯ −30%: бомба 12 → 8; снаряд противника
  const hits = []; g.on('batteryHit', (e) => hits.push(e.damage));
  s.integrity = 100;
  s.raid = { phase: 'inbound', from: 0, planes: [{ id: 1, bearing: 0, elevation: 30, range: 0.45, alive: true, attacked: false, hit: 0 }] };
  tick(g, 0.5);
  assert.deepEqual(hits, [8]); assert.equal(s.integrity, 92);
  // без улучшений: бомба 12, доклад через 3 с
  const g0 = start(0); tick(g0, 5); const h0 = []; g0.on('batteryHit', (e) => h0.push(e.damage));
  g0.state.raid = { phase: 'inbound', from: 0, planes: [{ id: 1, bearing: 0, elevation: 30, range: 0.45, alive: true, attacked: false, hit: 0 }] };
  tick(g0, 0.5); assert.deepEqual(h0, [12]);
});

// ======================= 4. РАСЧЁТ =======================
test('расчёт: усталость, ранения, аптечки, голоса в эфире', () => {
  const g = start(0); const s = g.state; tick(g, 6);
  assert.deepEqual(Object.keys(s.crew), ['gunner', 'loader', 'radio']);
  assert.deepEqual(s.crew.loader, { role: 'loader', title: 'ЗАРЯЖАЮЩИЙ', name: 'Седых', state: 'ok', fatigue: 0, woundedUntil: 0 });
  assert.equal(s.crew.gunner.title, 'НАВОДЧИК'); assert.equal(s.crew.radio.title, 'РАДИСТ');
  assert.equal(s.medkits, 2);
  const ev = []; g.on('crew', (e) => ev.push(e));
  // заряжающий: +0.06 за снаряд
  g.openBreech(); waitBreech(g); g.hoistShell('he'); waitBreech(g); g.ramShell(); waitBreech(g);
  assert.ok(Math.abs(s.crew.loader.fatigue - 0.06) < 0.002);
  tick(g, 2); assert.ok(Math.abs(s.crew.loader.fatigue - 0.04) < 0.003, 'отдыхает 0.01/с');
  // устал: затвор в 1.25 раза медленнее, голос в эфире
  s.crew.loader.fatigue = 0.9; tick(g, 0.1);
  assert.equal(s.crew.loader.state, 'tired'); assert.deepEqual(ev, [{ role: 'loader', state: 'tired' }]);
  assert.equal(g.crewFactor('loader'), 1.25);
  assert.ok(s.radio.some((m) => m.from === 'ЗАРЯЖАЮЩИЙ' && m.kind === 'bad'));
  g.addCharge(); assert.ok(Math.abs(s.breech.busy.dur - 0.9 * 1.25) < 1e-9); waitBreech(g);
  // наводчик: +0.02 за секунду работы маховиками
  g.setBrake(false);
  for (let i = 0; i < 100; i++) { g.rotateTurret(0.1); g.update(0.1); }
  assert.ok(Math.abs(s.crew.gunner.fatigue - 0.2) < 0.01, 'наводчик: ' + s.crew.gunner.fatigue);
  assert.ok(Math.abs(s.turret.bearing - 10) < 0.01);
  // ранен: наводка в 1.6 раза медленнее
  s.crew.gunner.woundedUntil = s.time + 45; tick(g, 0.1);
  assert.equal(s.crew.gunner.state, 'wounded'); assert.equal(g.crewFactor('gunner'), 1.6);
  const b0 = s.turret.bearing; g.rotateTurret(16); assert.ok(Math.abs(s.turret.bearing - b0 - 10) < 0.011);
  const e0 = s.turret.elevation; g.closeBreech(); waitBreech(g); g.elevate(8); assert.ok(Math.abs(s.turret.elevation - e0 - 5) < 0.011);
  assert.ok(turnTo(g, 123.4)); assert.ok(Math.abs(s.turret.bearing - 123.4) < 0.011, 'в несколько приёмов наводится точно');
  elevTo(g, 17.31); assert.ok(Math.abs(s.turret.elevation - 17.31) < 0.011);
  // аптечка
  assert.ok(g.treat('gunner').ok);
  assert.equal(s.crew.gunner.state, 'ok'); assert.equal(s.crew.gunner.fatigue, 0); assert.equal(s.medkits, 1);
  assert.ok(s.radio.some((m) => m.from === 'НАВОДЧИК' && m.kind === 'good'));
  assert.equal(g.treat('gunner').ok, false, 'здоровому аптечка не нужна'); assert.equal(s.medkits, 1);
  s.crew.loader.fatigue = 0.95; tick(g, 0.1);
  assert.ok(g.treat('loader').ok); assert.equal(s.crew.loader.fatigue, 0); assert.equal(s.medkits, 0);
  s.crew.radio.woundedUntil = s.time + 45; tick(g, 0.1);
  assert.equal(g.treat('radio').reason, 'Аптечек нет');
  // рана проходит сама через 45 с
  tick(g, 45.2); assert.equal(s.crew.radio.state, 'ok');
  assert.deepEqual(ev.slice(-2), [{ role: 'radio', state: 'wounded' }, { role: 'radio', state: 'ok' }]);
  assert.equal(g.treat('nobody').ok, false);
});

test('расчёт: попадание по батарее ранит с вероятностью 20%; раненый радист задерживает доклады', () => {
  const g = start(2, null, 1); const s = g.state; tick(g, 12);
  const gun = s.targets.find((t) => t.gun);
  const ev = []; g.on('crew', (e) => ev.push(e));
  s.detected = true;                        // батарея уже засечена: до первого своего выстрела противник не попадает
  gun.gun.next = s.time; gun.gun.p = 0.9;
  withRandom(0, () => tick(g, 3));          // 0 < 0.2 — ранение; индекс 0 — наводчик
  assert.deepEqual(ev, [{ role: 'gunner', state: 'wounded' }]);
  assert.ok(Math.abs(s.crew.gunner.woundedUntil - s.time - 45) < 4);
  assert.ok(s.radio.some((m) => m.from === 'НАВОДЧИК' && /Задело/.test(m.text)));
  gun.gun.next = s.time; ev.length = 0;
  withRandom(0.5, () => tick(g, 3));        // попадание без ранения (0.5 < 0.9, но 0.5 ≥ 0.2)
  assert.deepEqual(ev, []);
  // радист: +0.03 за принятое донесение; ранен — доклад корректировщика идёт в 1.6 раза дольше
  gun.gun = null; s.targets.forEach((t) => { t.gun = null; });
  const f0 = s.crew.radio.fatigue;
  s.crew.radio.woundedUntil = s.time + 500; tick(g, 0.1);
  const soft = s.targets.find((t) => !t.armored);
  let rep = null; g.on('impact', (e) => { rep = e.report || rep; });
  fireQuiet(g, 'he', soft.x + 0.4, soft.y + 0.4, soft);
  assert.equal(rep.delay, 4.8);
  assert.ok(s.crew.radio.fatigue > 0 || f0 > 0);
  // оборона: три аптечки
  const sv = createGame({ storage: unlockAll() }); sv.startSurvival(); assert.equal(sv.state.medkits, 3);
});

// ======================= 5. СВОИ =======================
test('свои: всегда известны, не цели; огонь по своим — попадание, счётчики, минус звёзды', () => {
  const g = start(30, null, 0); const s = g.state; tick(g, 8); noWind(g);
  assert.equal(s.mission.convoy, true);
  assert.equal(s.friends.length, 3);
  assert.deepEqual(s.friends.map((f) => [f.id, f.label, f.kind, f.convoy, f.hp, f.alive, f.arrived]), [['F1', 'СВОИ 1', 'transport', true, 3, true, false], ['F2', 'СВОИ 2', 'transport', true, 3, true, false], ['F3', 'СВОИ 3', 'transport', true, 3, true, false]]);
  assert.match(s.friends[0].name, /^Транспорт «.+»$/);
  assert.ok(s.friends.every((f) => f.heading === 90 && f.speed > 0 && f.path.length === 2));
  assert.equal(g.selectTarget('F1').ok, false); assert.equal(g.visible('F1'), true);
  assert.ok(s.radio.some((m) => m.from === 'ШТАБ' && /конвой/.test(m.text)));
  const x0 = s.friends[0].x; tick(g, 10); assert.ok(s.friends[0].x > x0 + 0.05, 'конвой идёт');
  s.targets.forEach((t) => { t.hunt.next = 1e9; t.gun = null; });
  s.friends.forEach((f) => { f.speed = 0; });
  const f = s.friends[0], ev = [], imp = [];
  g.on('friend', (e) => ev.push(e)); g.on('impact', (e) => imp.push(e.friendly));
  assert.equal(friendNear(g, { x: f.x + 0.3, y: f.y }, 30), true);
  fireQuiet(g, 'he', f.x + 0.2, f.y - 0.05, null);
  assert.equal(f.hp, 2); assert.equal(f.burning, true);
  assert.deepEqual(s.stats.friendlyHits, 1); assert.deepEqual(ev, [{ id: 'F1', hit: true, by: 'own' }]);
  assert.deepEqual(imp[0], [{ id: 'F1', damage: 1, destroyed: false }]);
  assert.ok(s.radio.some((m) => m.from === 'КОНВОЙ' && /Бьёте по своим/.test(m.text)));
  fireQuiet(g, 'he', f.x + 0.4, f.y, null);
  assert.equal(f.hp, 2, 'дальше 250 м — мимо');
  fireQuiet(g, 'he', f.x, f.y, null);
  assert.equal(f.alive, false); assert.ok(f.sinking && !f.sunk);
  assert.deepEqual(s.stats, { friendlyHits: 2, friendlyKills: 1, convoyLost: 1, convoyArrived: 0, planesDown: 0, bombs: 0 });
  assert.deepEqual(ev.slice(-1), [{ id: 'F1', sunk: true, by: 'own' }]);
  assert.equal(s.phase, 'playing');
  // победа: 3 звезды − 1 (потерян корабль конвоя) − 1 (потоплен своим огнём)
  let end = null; g.on('missionEnd', (e) => { end = e; });
  s.targets.forEach((t) => { t.alive = false; });
  elevTo(g, 0); g.openBreech(); waitBreech(g); tick(g, 3);
  assert.ok(end && end.won); assert.equal(end.stars, 1);
  assert.equal(end.stats.friendlyKills, 1); assert.equal(end.stats.convoyLost, 1); assert.equal(end.stats.convoyTotal, 3);
});

test('свои: охотники бьют по конвою, дым у транспорта сбивает им прицел', () => {
  const g = start(30, null, 0); const s = g.state; tick(g, 8);
  const h = s.targets[0]; assert.equal(h.hunts, true); assert.equal(h.end, 'hunt'); assert.equal(h.active, true);
  assert.equal(s.targets[1].active, false, 'второй охотник придёт позже');
  // идёт на ближайший корабль конвоя
  tick(g, 3);
  const near = s.friends.slice().sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y))[0];
  const d0 = Math.hypot(near.x - h.x, near.y - h.y);
  assert.ok(d0 > 2 && d0 < 9, 'до конвоя ' + d0);
  let dc = norm(h.course - brgTo(h, near)); if (dc > 180) dc -= 360;
  assert.ok(Math.abs(dc) <= 1, 'курс охотника — на транспорт'); assert.equal(h.heading, h.course);
  h.x = near.x; h.y = near.y + 4; tick(g, 0.2);
  const fire = [], ev = []; g.on('friendFire', (e) => fire.push(e)); g.on('friend', (e) => ev.push(e));
  const hp = () => s.friends.reduce((a, f) => a + f.hp, 0);
  // выстрел попадает при random < 0.35
  h.hunt.next = s.time;
  withRandom(0.2, () => tick(g, 2.5));
  assert.equal(fire.length, 1); assert.equal(fire[0].by, h.id); assert.equal(fire[0].at, near.id);
  assert.equal(hp(), 8); assert.deepEqual(ev, [{ id: near.id, hit: true, by: 'enemy' }]);
  assert.ok(Math.abs(s.time - h.firedAt) < 3); assert.equal(g.visible(h.id), true);
  assert.ok(h.hunt.next > s.time + 10 && h.hunt.next < s.time + 21, 'следующий выстрел через 14–20 с');
  // дым в 1 км от транспорта: 0.2 ≥ 0.35·0.4 — промах
  s.smokes.push({ x: near.x + 1, y: near.y, bearing: 0, until: s.time + 60, n: 0, cover: false, convoy: true });
  h.hunt.next = s.time;
  withRandom(0.2, () => tick(g, 2.5));
  assert.equal(fire.length, 2); assert.equal(hp(), 8, 'за дымом промах');
  assert.deepEqual(ev.slice(-1), [{ id: near.id, miss: true, by: 'enemy' }]);
  // дымовой снаряд рядом с транспортом (дальше 4 км от батареи) — завеса для конвоя, но не для батареи
  s.smokes.length = 0; s.targets.forEach((t) => { t.hunt.next = 1e9; }); s.friends.forEach((f) => { f.speed = 0; });
  const far = s.friends[2], bat = s.mission.battery;
  assert.ok(Math.hypot(far.x - bat.x, far.y - bat.y) > 4.2);
  fireQuiet(g, 'smoke', far.x, far.y + 0.3, null);
  assert.equal(s.smokes.length, 1); assert.equal(s.smokes[0].convoy, true); assert.equal(s.smokes[0].cover, false);
  assert.match(s.lastReport.text, /Конвой прикрыт/);
});

test('конвой: дошёл — победа; потоплен весь — поражение; потеря корабля стоит звезду', () => {
  // все дошли
  let g = start(30, null, 0), s = g.state; tick(g, 6);
  let end = null; g.on('missionEnd', (e) => { end = e; });
  const arrived = []; g.on('friend', (e) => { if (e.arrived) arrived.push(e.id); });
  s.targets.forEach((t) => { t.hunt.next = 1e9; });
  s.friends.forEach((f) => { f.x = f.path[1].x - 0.03; });
  tick(g, 12);
  assert.deepEqual(arrived.sort(), ['F1', 'F2', 'F3']);
  assert.ok(s.friends.every((f) => f.arrived && f.alive));
  assert.ok(end && end.won, 'конвой дошёл — победа, хотя противник жив'); assert.equal(end.stars, 3);
  assert.equal(end.stats.convoyArrived, 3); assert.equal(end.stats.destroyed, 0);
  // один потоплен, остальные дошли: победа, но звезда снята
  g = start(30, null, 0); s = g.state; tick(g, 6); end = null; g.on('missionEnd', (e) => { end = e; });
  s.targets.forEach((t) => { t.hunt.next = 1e9; });
  s.friends[1].hp = 1; s.targets[0].hunt.next = s.time; s.targets[0].x = s.friends[1].x; s.targets[0].y = s.friends[1].y + 1.5;
  withRandom(0, () => tick(g, 2.5));
  s.targets[0].hunt.next = 1e9;
  assert.equal(s.friends[1].alive, false); assert.equal(s.phase, 'playing');
  s.friends.forEach((f) => { f.x = f.path[1].x - 0.03; });
  tick(g, 12);
  assert.ok(end && end.won); assert.equal(end.stars, 2); assert.equal(end.stats.convoyLost, 1); assert.equal(end.stats.convoyArrived, 2);
  // потоплены все
  g = start(30, null, 0); s = g.state; tick(g, 6); end = null; g.on('missionEnd', (e) => { end = e; });
  s.friends.forEach((f) => { f.hp = 1; });
  const h = s.targets[0];
  for (let i = 0; i < 3 && s.phase === 'playing'; i++) {
    const f = s.friends.find((q) => q.alive); h.x = f.x; h.y = f.y + 1.5; h.hunt.next = s.time;
    withRandom(0, () => tick(g, 2.3));
  }
  tick(g, 3);
  assert.ok(end && !end.won); assert.match(end.reason, /Конвой уничтожен/); assert.equal(end.stats.convoyLost, 3);
  // без снарядов бой не кончается, пока конвой в пути
  g = start(30, (st) => { Object.assign(st.shells, { he: 0, ap: 0, smoke: 0 }); }, 0); s = g.state; tick(g, 6);
  s.targets.forEach((t) => { t.hunt.next = 1e9; });
  elevTo(g, 0); g.openBreech(); waitBreech(g); tick(g, 5);
  assert.equal(s.phase, 'playing');
});

test('дозор: катер ходит мимо цели, бот ждёт и по своим не попадает', () => {
  for (let diff = 0; diff <= 1; diff++) {
    const g = autoAA(start(32, null, diff)); const s = g.state;
    const p = s.friends[0];
    assert.equal(p.kind, 'patrol'); assert.equal(p.convoy, false); assert.equal(p.loop, true); assert.equal(p.hp, 2);
    const t0 = s.targets[0];
    const dmin = Math.min(...[0, 0.25, 0.5, 0.75, 1].map((k) => Math.hypot(p.path[0].x + (p.path[1].x - p.path[0].x) * k - t0.x, p.path[0].y + (p.path[1].y - p.path[0].y) * k - t0.y)));
    assert.ok(dmin < 0.4, 'маршрут дозора проходит у самой цели: ' + dmin);
    let end = null; g.on('missionEnd', (e) => { end = e; });
    playBot(g); tick(g, 5);
    assert.ok(end, 'бой окончен');
    assert.equal(end.stats.friendlyHits, 0, 'бот по своим не стреляет');
    assert.equal(p.alive, true);
  }
});

// ======================= 6. НАЛЁТ И ЗЕНИТКА =======================
test('налёт: предупреждение за 10 с, заход, бомбы, конец', () => {
  assert.ok(CAMPAIGN.every((d) => !(d.night && d.raids)), 'ночью налётов нет');
  assert.ok(CAMPAIGN.filter((d, i) => i < 30 && d.raids).length <= 3, 'в старых заданиях налётов не больше трёх');
  const g = start(31, null, 1); const s = g.state;
  const ev = []; g.on('raid', (e) => ev.push({ t: Math.round(s.time), ...e })); g.on('plane', (e) => ev.push(e));
  const hits = []; g.on('batteryHit', (e) => { if (e.by === 'air') hits.push(e); });
  s.targets.forEach((t) => { t.gun = null; if (t.hunt) t.hunt.next = 1e9; });
  assert.deepEqual(s.mission.raids[0], { at: 50, planes: 2, from: 335 });
  assert.deepEqual(s.aa, { bearing: 0, elevation: 20, firing: false, heat: 0, jammed: false, ammo: 400 });
  tick(g, 39); assert.equal(ev.length, 0); assert.equal(s.raid, null);
  tick(g, 2);
  assert.deepEqual(ev, [{ t: 40, phase: 'warning', from: 335, eta: 10 }]);
  assert.ok(s.radio.some((m) => m.from === 'РАДИСТ' && /^ВОЗДУХ!/.test(m.text)));
  tick(g, 10);
  assert.deepEqual(ev[1], { t: 50, phase: 'start', planes: 2, from: 335 });
  const R = s.raid; assert.equal(R.phase, 'inbound'); assert.equal(R.planes.length, 2);
  for (const p of R.planes) {
    assert.ok(p.range > 6.5 && p.range < 7.6 && p.alive && !p.attacked);
    assert.ok(Math.abs(norm(p.bearing - 335 + 180) - 180) < 6, 'пеленги чуть разные');
    assert.ok(p.elevation >= 6 && p.elevation < 8);
  }
  assert.notEqual(R.planes[0].bearing, R.planes[1].bearing);
  const r0 = R.planes[0].range; tick(g, 10);
  assert.ok(Math.abs(r0 - R.planes[0].range - 2.2) < 0.05, 'скорость 0.22 км/с');
  assert.ok(R.planes[0].elevation > 14 && R.planes[0].elevation < 18, 'угол места растёт');
  const i0 = s.integrity;
  withRandom(0.99, () => tick(g, 24));            // без отказов и ранений
  assert.equal(hits.length, 2); assert.ok(hits.every((h) => h.damage === 12));
  assert.equal(s.integrity, i0 - 24);
  assert.ok(R.planes.every((p) => p.attacked && p.alive));
  assert.equal(ev.filter((e) => e.bombed).length, 2);
  assert.equal(R.phase, 'over');
  tick(g, 7);
  assert.equal(s.raid, null);
  assert.deepEqual(ev.filter((e) => e.phase === 'end').map((e) => [e.shot, e.bombed]), [[0, 2]]);
  assert.equal(s.stats.bombs, 2);
  // бомба с вероятностью 35% ломает узел башни
  const g2 = start(0); tick(g2, 5);
  g2.state.raid = { phase: 'inbound', from: 0, planes: [{ id: 1, bearing: 0, elevation: 30, range: 0.45, alive: true, attacked: false, hit: 0 }] };
  withRandom(0.3, () => tick(g2, 0.5));
  assert.equal(Object.values(g2.state.faults).filter(Boolean).length, 1);
});

test('зенитка: кольцо 2.2°, 1.2 с на самолёт, перегрев и клин, патроны', () => {
  const g = start(31, null, 0); const s = g.state, a = s.aa;
  s.targets.forEach((t) => { t.gun = null; if (t.hunt) t.hunt.next = 1e9; });
  const ev = []; g.on('plane', (e) => ev.push(e)); g.on('raid', (e) => { if (e.phase === 'end') ev.push(e); });
  // наводка
  g.aimAA({ bearing: 370, elevation: 95 }); assert.equal(a.bearing, 10); assert.equal(a.elevation, 80);
  g.slewAA(-20, -100); assert.equal(a.bearing, 350); assert.equal(a.elevation, 0);
  tick(g, 68);
  const [p1, p2] = s.raid.planes;
  assert.ok(p1.range < 4.5);
  // мимо кольца (3°) — урона нет
  g.aimAA({ bearing: p1.bearing, elevation: p1.elevation - 3 }); assert.ok(g.fireAA(true).ok);
  tick(g, 1); assert.equal(p1.hit, 0); assert.ok(a.heat > 0.15 && a.heat < 0.18); assert.equal(a.ammo, 392);
  // в кольце — 1.2 с и сбит
  for (let i = 0; i < 14 && p1.alive; i++) { g.aimAA({ bearing: p1.bearing, elevation: p1.elevation + 1.5 }); g.update(0.1); }
  assert.equal(p1.alive, false); assert.deepEqual(ev, [{ id: p1.id, down: true }]);
  assert.ok(p1.hit >= 1.2 && p1.hit < 1.35);
  for (let i = 0; i < 40 && p2.alive; i++) { g.aimAA({ bearing: p2.bearing, elevation: p2.elevation }); g.update(0.1); }
  assert.equal(p2.alive, false);
  g.fireAA(false);
  const h0 = a.heat; tick(g, 1); assert.ok(Math.abs(h0 - a.heat - 0.12) < 0.02, 'остывает 0.12/с');
  assert.equal(s.raid.phase, 'over'); assert.equal(s.stats.planesDown, 2);
  tick(g, 6); assert.equal(s.raid, null);
  assert.deepEqual(ev[2], { phase: 'end', shot: 2, bombed: 0 });
  assert.equal(a.heat, 0, 'за паузу остыл');
  // перегрев: ≥ 1 — клин до 0.4
  const aaEv = []; g.on('aa', (e) => aaEv.push(e));
  a.heat = 0; g.fireAA(true); tick(g, 6); assert.equal(a.jammed, false); assert.ok(a.heat > 0.94);
  tick(g, 0.5); assert.equal(a.jammed, true); assert.deepEqual(aaEv, [{ jammed: true }]);
  const am = a.ammo; tick(g, 2); assert.equal(a.ammo, am, 'заклинивший автомат не стреляет'); assert.ok(a.heat < 0.8);
  assert.equal(g.fireAA(true).ok, false);
  tick(g, 3.2); assert.equal(a.jammed, false); assert.ok(a.heat < 0.4); assert.deepEqual(aaEv[1], { jammed: false });
  // патроны кончаются
  a.ammo = 5; g.fireAA(true); tick(g, 1); assert.equal(a.ammo, 0);
  assert.equal(g.fireAA(true).reason, 'Зенитные патроны кончились');
  // главный калибр во время налёта работает; за сбитых — опыт
  const g2 = autoAA(start(31, null, 0)); let end = null; g2.on('missionEnd', (e) => { end = e; });
  playBot(g2); tick(g2, 5);
  assert.ok(end && end.won && end.stats.planesDown >= 2 && end.stats.bombs === 0);
  assert.equal(end.xpGained, end.stars * 100 + 20 * end.stats.destroyed + 15 * end.stats.planesDown);
});

test('оборона: налёт на каждой третьей волне, аптечка за волну', () => {
  const g = createGame({ storage: unlockAll() }); g.setDifficulty(0); g.startSurvival(); g.begin();
  const s = g.state; const raids = []; g.on('raid', (e) => raids.push({ wave: s.wave, ...e }));
  s.medkits = 1;
  const clear = () => { s.targets.forEach((t) => { t.alive = false; }); tick(g, 0.3); };
  clear(); assert.equal(s.medkits, 2); tick(g, 11); assert.equal(s.wave, 2);
  clear(); assert.equal(s.medkits, 3); tick(g, 11); assert.equal(s.wave, 3);
  s.targets.forEach((t) => { t.gun = null; t.speed = 0; });
  tick(g, 12); assert.deepEqual(raids.map((r) => r.phase), ['warning']);
  tick(g, 10);
  assert.deepEqual(raids.map((r) => [r.wave, r.phase]), [[3, 'warning'], [3, 'start']]);
  assert.equal(s.raid.planes.length, 2);
  clear(); assert.equal(s.medkits, 3, 'не больше трёх');
});

// ======================= 7. ЗАДАНИЕ ДНЯ =======================
test('задание дня: одна дата — одно задание; счёт и лучший результат', () => {
  const date = '2026-11-18';
  assert.deepEqual(dailyDef(date), dailyDef(date));
  const defs = ['2026-11-18', '2026-11-19', '2026-11-20', '2026-12-01', '2027-01-05', '2027-03-08'].map(dailyDef);
  assert.ok(new Set(defs.map((d) => JSON.stringify(d.targets))).size >= 5, 'разные даты — разные задания');
  for (let i = 0; i < 60; i++) {
    const d = dailyDef('2027-02-' + String(1 + (i % 28)).padStart(2, '0') + (i >= 28 ? 'x' : ''));
    assert.ok(d.targets.length >= 3 && d.targets.length <= 5); assert.ok(!d.night);
    assert.ok(['clear', 'fog', 'storm'].includes(d.weather));
    assert.ok(new Set(d.targets.map((t) => t.kind)).size >= 3, 'состав смешанный');
    if (d.raids) assert.ok(d.raids.length === 1 && d.raids[0].planes >= 2 && d.raids[0].planes <= 3);
    if (d.friends) assert.deepEqual(d.friends.map((f) => f.kind), ['patrol']);
  }
  const st = mem({ unlocked: 1, stars: [] });
  const a = createGame({ storage: st }), b = createGame({ storage: mem() });
  const info = a.dailyInfo(date);
  assert.deepEqual(info, b.dailyInfo(date));
  assert.equal(info.date, date); assert.equal(info.title, 'ЗАДАНИЕ ДНЯ · 18.11'); assert.equal(info.best, null); assert.ok(info.brief.length > 40);
  assert.equal(a.dailyInfo('вчера'), null); assert.equal(a.startDaily('2026-1-1').ok, false);
  assert.ok(a.startDaily(date).ok); assert.ok(b.startDaily(date).ok);
  assert.equal(a.state.phase, 'briefing'); assert.equal(a.state.mission.daily, date); assert.equal(a.state.mission.index, null); assert.equal(a.state.mission.night, false);
  const pos = (g) => JSON.stringify([g.state.targets.map((t) => [t.kind, t.x, t.y, t.course]), g.state.mission.wind, g.state.friends.map((f) => [f.x, f.y]), g.state.mission.raids, g.state.shells]);
  assert.equal(pos(a), pos(b), 'расстановка одинакова на всех устройствах');
  // играем несколько дат ботом
  let wins = 0, played = 0; const log = [];
  for (const d of ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23']) {
    const g = autoAA(createGame({ storage: st })); g.setDifficulty(0);
    g.startDaily(d); g.begin();
    let end = null; g.on('missionEnd', (e) => { end = e; });
    playBot(g); tick(g, 5);
    played++;
    log.push(d.slice(5) + ' ' + g.state.mission.weather + ' ' + g.state.targets.map((t) => t.kind).join('+') + ': ' + (end ? (end.won ? '★' + end.stars + ' счёт ' + end.daily.score : end.reason) : 'не окончено'));
    if (!end) continue;
    assert.equal(end.daily.date, d);
    if (end.won) {
      wins++;
      const S = end.stats;
      assert.equal(end.daily.score, Math.max(0, 1000 * end.stars + 6 * S.integrity + Math.max(0, 600 - Math.round(S.time)) + Math.max(0, 400 - 20 * S.combatShots) - 300 * S.friendlyHits - 100 * S.bombs));
      assert.equal(end.daily.isNew, true);
      assert.deepEqual(g.save.daily, { date: d, score: end.daily.score, stars: end.stars }, 'хранится только лучший результат этой даты');
      assert.deepEqual(g.dailyInfo(d).best, { score: end.daily.score, stars: end.stars });
      assert.equal(g.dailyInfo('2020-01-01').best, null);
      assert.equal(end.record, null); assert.ok(end.xpGained > 0);
    } else { assert.equal(end.daily.score, 0); assert.equal(end.daily.isNew, false); }
  }
  console.log('   задание дня: ' + log.join(' | '));
  assert.ok(wins >= played - 2, 'бот выигрывает большинство заданий дня: ' + wins + '/' + played);
  // худший результат той же даты лучший не затирает
  const g = autoAA(createGame({ storage: st })); g.setDifficulty(0);
  g.save.daily = { date, score: 99999, stars: 3 };
  g.startDaily(date); g.begin(); let end = null; g.on('missionEnd', (e) => { end = e; });
  playBot(g); tick(g, 5);
  assert.ok(end); assert.equal(end.daily.isNew, false); assert.deepEqual(end.daily.best, { score: 99999, stars: 3 });
  assert.equal(g.save.daily.score, 99999);
});

// ======================= 8. НАСТРОЙКИ, СТАРЫЕ СОХРАНЕНИЯ =======================
test('настройки: значения по умолчанию, проверка, событие, сохранение', () => {
  const st = mem();
  const g = createGame({ storage: st });
  assert.deepEqual(g.settings(), DEF);
  const ev = []; g.on('settings', (e) => ev.push(e));
  assert.ok(g.setSetting('sens', 5).ok); assert.equal(g.settings().sens, 1.6);
  assert.ok(g.setSetting('sens', 0.1).ok); assert.equal(g.settings().sens, 0.6);
  assert.ok(g.setSetting('sens', 1.23).ok); assert.equal(g.settings().sens, 1.25);
  assert.equal(g.setSetting('sens', 'быстро').ok, false);
  assert.equal(g.setSetting('text', 1.2).ok, false); assert.ok(g.setSetting('text', 1.3).ok); assert.ok(g.setSetting('text', 1.15).ok);
  assert.ok(g.setSetting('lefty', true).ok); assert.ok(g.setSetting('vibro', false).ok);
  assert.equal(g.setSetting('volume', 3).ok, false);
  assert.equal(ev.length, 7); assert.deepEqual(ev[6], { ...DEF, sens: 1.25, text: 1.15, lefty: true, vibro: false });
  assert.deepEqual(createGame({ storage: st }).settings(), { ...DEF, sens: 1.25, text: 1.15, lefty: true, vibro: false });
  assert.deepEqual(g.save.settings, g.settings());
});

test('старое сохранение (xp, звёзды, рекорды, оборона) загружается, новые поля — по умолчанию', () => {
  const old = { unlocked: 30, stars: Array(30).fill(3), records: [{ stars: 3, shots: 1, time: 40, integrity: 100, difficulty: 1 }], difficulty: 1, muted: true, xp: 1000, survivalBest: { waves: 4, kills: 11 } };
  const st = mem(old);
  const g = createGame({ storage: st });
  assert.equal(g.save.xp, 1000); assert.equal(g.save.stars.length, 30); assert.deepEqual(g.save.records[0], old.records[0]);
  assert.deepEqual(g.save.survivalBest, { waves: 4, kills: 11 }); assert.equal(g.save.muted, true); assert.equal(g.state.difficulty, 1);
  assert.equal(g.save.unlocked, 31, 'открыта Часть V');
  assert.equal(g.campaign.length, 36);
  assert.deepEqual(g.save.upgrades, { hoist: 0, range: 0, spotter: 0, armor: 0, magazine: 0, repair: 0 });
  assert.equal(g.points(), 6);
  assert.deepEqual(g.save.settings, DEF);
  assert.equal(g.save.daily, null); assert.equal(g.save.resume, null); assert.equal(g.resumeInfo(), null);
  assert.ok(g.startMission(30).ok); assert.equal(g.startMission(31).ok, false);
  // мусор в новых полях не ломает загрузку
  const g2 = createGame({ storage: mem({ upgrades: { hoist: 9, armor: 'x' }, settings: { sens: 99, text: 7 }, daily: 5, resume: 'да' }) });
  assert.deepEqual(g2.save.upgrades, { hoist: 3, range: 0, spotter: 0, armor: 0, magazine: 0, repair: 0 });
  assert.deepEqual(g2.save.settings, DEF);
  assert.equal(g2.save.daily, null); assert.equal(g2.save.resume, null);
});

// ---------- замечания проверки ----------
test('сохранённый бой: улучшения не меняют, пока он не закончен или не сброшен', () => {
  const st = mem({ unlocked: 99, xp: 150 * 9 });
  const g = createGame({ storage: st });
  for (let i = 0; i < 3; i++) assert.ok(g.buyUpgrade('magazine').ok);
  g.startMission(5); g.begin(); tick(g, 5);
  const he = g.state.shells.he;
  assert.ok(g.suspend().ok); g.quit({ keep: true });
  assert.equal(g.resetUpgrades().ok, false);
  assert.equal(g.buyUpgrade('armor').ok, false);
  assert.equal(g.upgrades().find((u) => u.id === 'magazine').level, 3);
  assert.ok(g.restore().ok);
  assert.equal(g.state.shells.he, he);
  g.quit({ keep: true });
  g.discardResume();
  assert.ok(g.resetUpgrades().ok);
  assert.equal(g.points(), 9);
});

test('сохранённый бой: выход из инструктажа его не трогает, брошенный бой — стирает', () => {
  const g = createGame({ storage: mem({ unlocked: 99 }) });
  g.startMission(5); g.begin(); tick(g, 20);
  g.suspend(); g.quit({ keep: true });
  assert.ok(g.resumeInfo());
  g.startMission(0); g.quit();
  assert.ok(g.resumeInfo(), 'НАЗАД из инструктажа не стирает сохранённый бой');
  assert.ok(g.restore().ok);
  tick(g, 16);
  assert.ok(g.resumeInfo());
  g.quit();
  assert.equal(g.resumeInfo(), null, 'бой брошен без сохранения');
});

test('задание дня: дозорный катер не ходит по островам', () => {
  let withFriend = 0;
  for (let i = 0; i < 400; i++) {
    const d = new Date(Date.UTC(2026, 10, 18) + i * 864e5).toISOString().slice(0, 10);
    const g = createGame({ storage: unlockAll() });
    g.startDaily(d);
    const map = g.state.mission.map;
    for (const f of g.state.friends) {
      withFriend++;
      const p = f.path; assert.ok(p, d);
      for (let k = 0; k <= 20; k++) assert.ok(!isLand(map, p[0].x + (p[1].x - p[0].x) * k / 20, p[0].y + (p[1].y - p[0].y) * k / 20), d + ': путь своего по суше');
    }
  }
  assert.ok(withFriend > 60);
});

test('оборона: мёртвую цель выбрать нельзя; журнал и следы не растут без конца; такт не падает', () => {
  const g = createGame({ storage: unlockAll() });
  g.setDifficulty(0); g.startSurvival(); g.begin();
  let denied = 0;
  for (let w = 0; w < 14 && g.state.phase === 'playing'; w++) {
    for (let i = 0; i < 600 && g.state.targets.some((t) => t.alive && !t.active); i++) g.update(0.1);
    tick(g, 2);
    let last = null;
    for (const t of g.state.targets) if (t.alive) { t.hp = 0; t.alive = false; t.sinking = { since: g.state.time, dur: 18 }; g.state.kills++; last = t; }
    g.state.integrity = 100;
    if (last) { assert.equal(g.selectTarget(last.id).ok, false); assert.equal(g.setPin(last.id, 5, 5).ok, false); denied++; g.state.activeTarget = last.id; }   // «промах» вызывающего кода
    tick(g, 70);                   // обломок тонет и уходит из списка, скрытые батареи новой волны стреляют
    g.state.integrity = 100;
    const a = g.state.activeTarget;
    assert.ok(a == null || g.state.targets.some((t) => t.id === a), 'выбранная цель существует');
  }
  assert.ok(denied > 5);
  assert.ok(g.state.wave > 8, 'волны идут: ' + g.state.wave);
  assert.ok(g.state.radio.length <= 150, 'радио: ' + g.state.radio.length);
  const ids = new Set(g.state.targets.map((t) => String(t.id)));
  for (const id of Object.keys(g.state.tracks)) assert.ok(ids.has(id), 'след убранной цели ' + id);
});
