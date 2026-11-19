// Засечка батареи (противник видит «Утёс» только после первого выстрела) и подсказки: пошаговые в первых трёх заданиях,
// дальше — темы «НОВОЕ» по одной на новую механику.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/game/index.js';
import { solve } from '../src/game/ballistics.js';
import { TOPICS, topicById, describe, nextStep, STEP_MISSIONS, TOPIC_HOLD, TOPIC_MIN } from '../src/game/hints.js';
import { CAMPAIGN } from '../src/game/missions.js';
import { RAD, norm, tick, start, unlockAll, fireQuiet, noWind, waitBreech } from './bot.js';

const withRandom = (v, fn) => { const R = Math.random; Math.random = () => v; try { return fn(); } finally { Math.random = R; } };
const mem = (init) => { const m = {}; if (init) m['arta2.save'] = JSON.stringify(init); return { mem: m, get: (k) => m[k] || null, set: (k, v) => { m[k] = v; } }; };
const stored = (st) => JSON.parse(st.mem['arta2.save']);
const allLearned = (...except) => { const o = {}; for (const t of TOPICS) if (!except.includes(t.id)) o[t.id] = true; return o; };
/** Игра с открытой кампанией и заданным набором изученных тем. */
const game = (learned, extra) => createGame({ storage: mem({ unlocked: 99, stars: [], difficulty: 0, learned: learned || {}, ...(extra || {}) }) });
const begin = (g, idx, patch) => { assert.ok(g.startMission(idx).ok); if (patch) patch(g.state); g.begin(); return g; };

// ======================= ЗАСЕЧКА БАТАРЕИ =======================
test('засечка: до первого своего выстрела противник бьёт наугад — ни урона, ни ран, ни отказов; эфир — один раз', () => {
  const g = start(2, null, 1), s = g.state; tick(g, 12);
  assert.equal(s.detected, false); assert.equal(s.detectedAt, null);
  const gun = s.targets.find((t) => t.gun);
  const hits = [], inc = [], crew = [], faults = [];
  g.on('batteryHit', (e) => hits.push(e)); g.on('incoming', (e) => inc.push(e)); g.on('crew', (e) => crew.push(e)); g.on('fault', (e) => faults.push(e));
  gun.gun.p = 0.9;
  for (let i = 0; i < 12; i++) { gun.gun.next = s.time; withRandom(i % 2 ? 0 : 0.999, () => tick(g, 3)); }     // Math.random = 0 раньше значило «попал и ранил»
  assert.ok(inc.length >= 12 && hits.length >= 11, 'залпы идут: ' + inc.length + ' / ' + hits.length);
  assert.ok(inc.every((e) => e.blind === true && e.by === gun.id && e.eta === 2.4));
  assert.ok(hits.every((e) => e.damage === 0 && e.blind === true && e.miss >= 0.6 && e.miss <= 2.5), JSON.stringify(hits.slice(0, 3)));
  assert.equal(s.integrity, 100); assert.deepEqual(crew, []); assert.deepEqual(faults, []);
  assert.equal(s.radio.filter((m) => /беспокоящий огонь наугад/.test(m.text)).length, 1);
  assert.ok(s.radio.some((m) => m.from === 'ШТАБ' && m.text === 'Противник ведёт беспокоящий огонь наугад — нас пока не видят.'));
  assert.equal(s.detected, false);
  assert.ok(gun.firedAt != null && gun.salvos >= 12, 'вспышки и счёт залпов — как у настоящих выстрелов');
});

test('засечка: первый выстрел → через 8 с (снаряд ещё летит) батарея засечена; огонь противника — не сразу, но потом попадает', () => {
  const g = start(2, null, 1), s = g.state; noWind(g); tick(g, 12);
  const gun = s.targets.find((t) => t.gun), depot = s.targets.find((t) => !t.gun);
  gun.gun.next = 1e9;
  // орудие «готово» выстрелить сразу после засечки — засечка должна отодвинуть его выстрел
  const ev = []; let firedAt = null, atDetect = null; g.on('fired', () => { if (firedAt == null) { firedAt = s.time; gun.gun.next = s.time + 8.3; } });
  g.on('detected', (e) => { ev.push(e); atDetect = { integrity: s.integrity, wait: gun.gun.next - s.time, flying: s.flight.length }; gun.gun.next = 1e9; });
  const realUpdate = g.update; let seenAt = null;
  g.update = (dt) => { const r = realUpdate(dt); if (seenAt == null && s.detected) seenAt = s.time; return r; };
  fireQuiet(g, 'he', depot.x + 0.6, depot.y + 0.6, depot);
  g.update = realUpdate;
  const h = s.history[0];
  assert.ok(h.impactTime - h.time > 8.5, 'снаряд летел дольше 8 с: ' + (h.impactTime - h.time));
  assert.equal(s.detected, true); assert.equal(ev.length, 1);
  assert.ok(Math.abs(seenAt - firedAt - 8) < 0.3, 'засечена через 8 с после выстрела: ' + (seenAt - firedAt));
  assert.ok(Math.abs(s.detectedAt - seenAt) < 0.3); assert.equal(ev[0].time, s.detectedAt);
  assert.equal(s.radio.filter((m) => m.from === 'ШТАБ' && m.text === 'Противник засёк батарею по вспышке — ждите ответного огня.').length, 1);
  assert.equal(atDetect.integrity, 100); assert.equal(atDetect.flying, 1, 'снаряд ещё в полёте');
  assert.ok(atDetect.wait >= 6 - 1e-9 && atDetect.wait <= 6 + gun.gun.period * 0.5 + 1e-9, 'мгновенного ответа нет — новая задержка первого выстрела: ' + atDetect.wait);
  assert.equal(s.integrity, 100);
  // прицельный огонь: теперь попадает
  const hits = []; g.on('batteryHit', (e) => hits.push(e));
  gun.gun.next = s.time; gun.gun.p = 0.9; withRandom(0.5, () => tick(g, 3));
  assert.ok(hits.length === 1 && hits[0].damage > 0 && !hits[0].blind, JSON.stringify(hits));
  assert.ok(s.integrity < 100);
  // второй выстрел повторной засечки не даёт
  fireQuiet(g, 'he', depot.x + 0.6, depot.y + 0.6, depot);
  assert.equal(ev.length, 1);
});

test('засечка: новая задержка первого прицельного выстрела — не меньше 6 с; назначенный позже выстрел не приближается', () => {
  const g = start(5, (st) => { st.shells.smoke = 1; }, 1), s = g.state; noWind(g); tick(g, 12);
  const guns = s.targets.filter((t) => t.gun); assert.equal(guns.length, 2);
  guns[0].gun.next = s.time; guns[1].gun.next = s.time + 500;
  let checked = 0;
  g.on('detected', () => { checked++; assert.ok(guns[0].gun.next >= s.time + 6 - 1e-9, 'не раньше 6 с'); assert.ok(guns[1].gun.next > s.time + 400 && guns[1].gun.next < s.time + 500, 'позже назначенный выстрел остаётся на месте'); });
  const R = Math.random;
  // близкий выстрел: снаряд падает раньше 8 с — засечка в момент разрыва
  const bat = s.mission.battery, rng = 1.2, sol = solve(rng, 1); assert.ok(sol.ok && sol.tof < 7, 'время полёта ' + sol.tof);
  let seenAt = null; const realUpdate = g.update; g.update = (dt) => { const r = realUpdate(dt); if (seenAt == null && s.detected) seenAt = s.time; return r; };
  fireQuiet(g, 'smoke', bat.x, bat.y + rng, null);
  g.update = realUpdate; Math.random = R;
  const h = s.history[0];
  assert.equal(s.detected, true); assert.equal(checked, 1);
  assert.ok(Math.abs(seenAt - h.impactTime) < 0.3 && h.impactTime - h.time < 7.5, 'засечка по разрыву (дымовой тоже выдаёт): ' + seenAt + ' / ' + h.impactTime);
});

test('засечка: скрытые батареи засекаются звукометрией и без нашего огня — тупика нет; налёт от засечки не зависит', () => {
  const g = start(9, null, 1), s = g.state;      // «Огневой налёт»: только две скрытые батареи
  tick(g, 90);
  assert.equal(s.detected, false); assert.equal(s.integrity, 100);
  assert.ok(s.targets.every((t) => t.reported && t.reported.sound), 'обе батареи засечены по звуку');
  assert.ok(s.radio.some((m) => m.from === 'ЗВУКОМЕТРИЯ' && /Засечён залп/.test(m.text)));
  // бомбы падают и на незасечённую батарею
  const hits = []; g.on('batteryHit', (e) => hits.push(e));
  s.targets.forEach((t) => { t.gun.next = 1e9; });
  s.raid = { phase: 'inbound', from: 0, planes: [{ id: 1, bearing: 0, elevation: 30, range: 0.45, alive: true, attacked: false, hit: 0 }] };
  tick(g, 0.5);
  assert.ok(hits.length === 1 && hits[0].by === 'air' && hits[0].damage === 12); assert.equal(s.detected, false);
});

test('засечка: РЛС и рост точности не дают попаданий до засечки; после — работают как раньше', () => {
  const g = start(16, null, 1), s = g.state; tick(g, 12);      // «Глаза противника»: РЛС + батарея
  const gun = s.targets.find((t) => t.gun); assert.ok(s.targets.some((t) => t.spotter && t.alive));
  let dmg = 0; g.on('batteryHit', (e) => { dmg += e.damage; });
  gun.gun.period = 1; gun.gun.p = 0.75;
  for (let i = 0; i < 600; i++) { s.integrity = 100; g.update(0.1); }
  assert.equal(dmg, 0);
  s.detected = true; s.detectedAt = s.time;
  for (let i = 0; i < 600 && s.phase === 'playing'; i++) { s.integrity = 100; g.update(0.1); }
  assert.ok(dmg > 0);
});

test('засечка в снимке боя: отложенная засечка и флаг переживают restore; старый снимок со стрелявшей батареей — засечён', () => {
  const g = start(2, null, 1), s = g.state; noWind(g); tick(g, 12);
  s.targets.forEach((t) => { if (t.gun) t.gun.next = 1e9; });
  const depot = s.targets.find((t) => !t.gun);
  let snap = null; g.on('fired', () => { snap = null; });
  const realFire = g.fire; g.fire = () => { const r = realFire(); if (r.ok) snap = JSON.parse(JSON.stringify(g.snapshot())); return r; };
  fireQuiet(g, 'he', depot.x + 0.6, depot.y + 0.6, depot); g.fire = realFire;
  assert.ok(snap && snap.state.detected === false && snap.sys.events.some((e) => e.a === 'detect'), 'засечка в пути — данные в sys.events');
  const g2 = createGame({ storage: unlockAll() }); const ev = []; g2.on('detected', (e) => ev.push(e));
  assert.ok(g2.restore(snap).ok); assert.equal(g2.state.detected, false);
  tick(g2, 9); assert.equal(g2.state.detected, true); assert.equal(ev.length, 1);
  // засечённый бой остаётся засечённым
  const snap2 = JSON.parse(JSON.stringify(g2.snapshot())); const g3 = createGame({ storage: unlockAll() });
  assert.ok(g3.restore(snap2).ok); assert.equal(g3.state.detected, true); assert.equal(g3.state.detectedAt, g2.state.detectedAt);
  // снимок прежней версии: поля нет
  const old = JSON.parse(JSON.stringify(snap2)); delete old.state.detected; delete old.state.detectedAt;
  const g4 = createGame({ storage: unlockAll() }); assert.ok(g4.restore(old).ok); assert.equal(g4.state.detected, true);
  old.state.shots = 0; const g5 = createGame({ storage: unlockAll() }); assert.ok(g5.restore(old).ok); assert.equal(g5.state.detected, false);
});

test('засечка: в обороне держится на все волны; в итогах боя — время засечки', () => {
  const g = createGame({ storage: unlockAll() }); g.setDifficulty(0); g.startSurvival(); g.begin();
  const s = g.state; tick(g, 20);
  assert.equal(s.detected, false);
  const t = s.targets.find((q) => q.alive && q.reported);
  fireQuiet(g, 'smoke', s.mission.battery.x, s.mission.battery.y + 2.5, null);
  assert.equal(s.detected, true, 'дымовой снаряд тоже выдаёт батарею');
  const at = s.detectedAt;
  s.targets.forEach((q) => { q.alive = false; q.sinking = { since: s.time, dur: 18 }; });
  tick(g, 14); assert.equal(s.wave, 2); assert.ok(t);
  assert.equal(s.detected, true); assert.equal(s.detectedAt, at);
  let end = null; g.on('missionEnd', (e) => { end = e; });
  s.integrity = 1;
  s.raid = { phase: 'inbound', from: 0, planes: [{ id: 1, bearing: 0, elevation: 30, range: 0.45, alive: true, attacked: false, hit: 0 }] };
  tick(g, 0.5);
  assert.ok(end && end.stats.detectedAt === at, JSON.stringify(end && end.stats));
});

test('засечка: задание дня и свободный бой начинаются незасечёнными', () => {
  const g = createGame({ storage: unlockAll() });
  g.startDaily('2026-11-19'); g.begin(); assert.equal(g.state.detected, false); g.quit();
  g.startSkirmish(); g.begin(); assert.equal(g.state.detected, false);
});

// ======================= ПОДСКАЗКИ: РЕЖИМЫ =======================
test('подсказки: по шагам — в заданиях 1–3, дальше и в других режимах — только темы; «все» и «нет»', () => {
  assert.equal(STEP_MISSIONS, 3);
  const g = game(allLearned());
  assert.equal(g.settings().hints, 'new'); assert.equal(g.hintMode(), 'off'); assert.equal(g.hint().kind, null);
  for (let i = 0; i < 7; i++) {
    begin(g, i); tick(g, 1);
    assert.equal(g.hintMode(), i < 3 ? 'steps' : 'topics', 'задание ' + (i + 1));
    const h = g.hint();
    if (i < 3) { assert.equal(h.kind, 'step'); assert.ok(h.text.length > 5); } else assert.deepEqual(h, { kind: null, id: null, title: null, text: '', more: '', station: null, hotspot: null, dom: null, warn: false });
    g.quit();
  }
  const others = [() => g.startSkirmish(), () => g.startSurvival(), () => g.startDaily('2026-11-19')];
  for (const go of others) { go(); assert.equal(g.hintMode(), 'off', 'инструктаж'); g.begin(); tick(g, 1); assert.equal(g.hintMode(), 'topics'); assert.equal(g.hint().kind, null); g.quit(); }
  // «все»: шаги везде
  assert.ok(g.setSetting('hints', 'all').ok);
  for (const i of [0, 3, 20, 35]) { begin(g, i); tick(g, 1); assert.equal(g.hintMode(), 'steps'); assert.equal(g.hint().kind, 'step'); g.quit(); }
  for (const go of others) { go(); g.begin(); tick(g, 1); assert.equal(g.hint().kind, 'step'); g.quit(); }
  // «нет»: ничего, даже в учебном задании
  assert.ok(g.setSetting('hints', 'off').ok);
  for (const i of [0, 1, 2, 3]) { begin(g, i); tick(g, 8); assert.equal(g.hintMode(), 'off'); assert.equal(g.hint().kind, null); assert.equal(g.state.topic, null); assert.deepEqual(g.briefTopics(), []); g.quit(); }
  // сложность режим не меняет
  assert.ok(g.setSetting('hints', 'new').ok); g.setDifficulty(1);
  begin(g, 1); tick(g, 1); assert.equal(g.hint().kind, 'step'); g.quit();
});

test('подсказки по шагам: пост и орган управления; интерфейс может сказать, каких органов нет', () => {
  const g = game(); begin(g, 0); tick(g, 6);
  let h = g.hint();
  assert.deepEqual([h.kind, h.station, h.hotspot, h.id], ['step', 'plot', 'pin1', 'plot:pin1']); assert.match(h.text, /^ПЛАНШЕТ: перетащите фишку/);
  assert.deepEqual(g.nextStep(), nextStep(g));
  const t = g.state.targets[0];
  g.setPin(1, t.x, t.y); h = g.hint(); assert.equal(h.hotspot, 'sight');
  // свой глаз ночью: кнопки «НА ЦЕЛЬ» на посту нет — подсказка ведёт к маховику
  g.quit(); assert.ok(g.setSetting('hints', 'all').ok); begin(g, 24); const s = g.state; tick(g, 6);
  const a = s.targets.find((q) => q.id === s.activeTarget);
  s.lights.push({ x: a.x, y: a.y, until: s.time + 60, n: 0 }); tick(g, 0.2); assert.equal(a.lit, true);
  s.flight.push({ id: 99, n: 99, t: 0, tof: 500, shell: 'he', charges: 3, x: a.x, y: a.y, bearing: 0, elevation: 10, pair: null });
  s.scope.bearing = norm(Math.atan2(a.x - s.mission.battery.x, a.y - s.mission.battery.y) / RAD + 90);
  assert.equal(g.hint().hotspot, 'toTargetButton');
  assert.equal(g.hint({ hasHot: (st, n) => n !== 'toTargetButton' }).hotspot, 'scopeWheel');
});

// ======================= ПОДСКАЗКИ: ТЕМЫ =======================
const ctx = (g) => ({ s: g.state, m: g.state.mission, t: g.state.time, a: g.state.targets.find((t) => t.id === g.state.activeTarget) || null, g, d: g.state.difficulty, since: g.state.time });
const sel = (g, f) => { const t = g.state.targets.find(f); assert.ok(t, 'цель найдена'); assert.ok(g.selectTarget(t.id).ok); return t; };
const soundTarget = (diff) => { const g = start(8, null, diff), s = g.state; tick(g, 4); const t = s.targets.find((q) => q.locate === 'sound'); t.gun.next = s.time; tick(g, 1); assert.ok(t.reported && t.reported.sound); g.selectTarget(t.id); return g; };
const windy = () => { const g = start(3, null, 0), s = g.state; tick(g, 6); s.mission.wind = { speed: 9, from: 90 }; s.targets.forEach((t) => { t.speed = 0; }); const a = sel(g, (t) => t.kind === 'transport'); g.setAlidade({ bearing: 0, range: 9 }); assert.ok(g.recordMeasurement().ok); g.setComputerRange(9); g.setComputerCharge(g.chargeStates().indexOf('ok') + 1); assert.ok(g.compute().ok); assert.ok(a); return g; };
/** Для каждой темы — состояние боя, в котором её механика перед игроком. */
const CRAFT = {
  raid: () => { const g = start(3); g.state.raidWarn = { from: 0, until: g.state.time + 10 }; return g; },
  friendZone: () => { const g = start(32), s = g.state; tick(g, 6); const f = s.friends[0], bat = s.mission.battery; sel(g, (t) => t.kind === 'barge');
    g.setAlidade({ bearing: norm(Math.atan2(f.x - bat.x, f.y - bat.y) / RAD), range: Math.hypot(f.x - bat.x, f.y - bat.y) }); assert.ok(g.recordMeasurement().ok); return g; },
  convoySmoke: () => { const g = start(30), s = g.state; tick(g, 6); s.targets.find((t) => t.hunts && t.active).firedAt = s.time; return g; },
  faults: () => { const g = start(3); g.state.faults.drive = true; return g; },
  wounded: () => { const g = start(3); g.state.crew.loader.state = 'wounded'; return g; },
  detected: () => { const g = start(2), s = g.state; s.detected = true; s.detectedAt = s.detectTold = s.time; return g; },
  enemyFire: () => { const g = start(2); tick(g, 8); g.state.integrity = 91; return g; },
  landing: () => { const g = start(4); tick(g, 6); return g; },
  aaHeat: () => { const g = start(3); g.state.aa.heat = 0.7; return g; },
  night: () => { const g = start(24); tick(g, 6); return g; },
  flash: () => { const g = start(28), s = g.state; tick(g, 6); const t = s.targets.find((q) => q.gun && q.locate === 'recon'); t.gun.next = s.time; tick(g, 1); assert.ok(t.reported && t.reported.rough); return g; },
  armor: () => { const g = start(2); tick(g, 8); sel(g, (t) => t.armored); return g; },
  sound: () => soundTarget(0),
  soundManual: () => soundTarget(1),
  relocate: () => { const g = start(10), s = g.state; tick(g, 4); const t = s.targets.find((q) => q.relocateEvery); for (let i = 0; i < 3; i++) { t.gun.next = s.time; tick(g, 1); } assert.equal(t.moved, true); return g; },
  shrap: () => { const g = start(12); tick(g, 6); sel(g, (t) => t.kind === 'landing'); return g; },
  lead: () => { const g = start(3); tick(g, 6); sel(g, (t) => t.moving); return g; },
  escape: () => { const g = start(3); tick(g, 6); return g; },
  submarine: () => { const g = start(17); tick(g, 6); return g; },
  radar: () => { const g = start(16); tick(g, 8); return g; },
  fort: () => { const g = start(18); tick(g, 8); return g; },
  tanker: () => { const g = start(19); tick(g, 6); return g; },
  wind: windy,
  stale: () => { const g = windy(), s = g.state; tick(g, 1); const w = s.mission.wind; s.mission.weather = 'storm'; s.radio.length = 0; g.setSpeed(1);
    // смена ветра в шторм — отложенное действие windShift; ставим его на «сейчас» через снимок
    const sn = JSON.parse(JSON.stringify(g.snapshot())); sn.sys.events.push({ t: sn.state.time, a: 'windShift', p: null }); assert.ok(g.restore(sn).ok); tick(g, 0.3);
    assert.ok(g.state.computer.stale && g.state.windChangedAt != null && w); return g; },
  noSpotter: () => start(33),
  smoke: () => { const g = start(26), s = g.state; tick(g, 8); s.detected = true; s.targets.find((t) => t.gun && t.active).firedAt = s.time; return g; },
  stealth: () => start(2),
  fog: () => start(25),
  convoy: () => start(30),
  friends: () => start(32),
  waves: () => start(12),
  survival: () => { const g = createGame({ storage: unlockAll() }); g.startSurvival(); g.begin(); return g; },
  observe: () => { const g = start(1), s = g.state; tick(g, 6); const a = sel(g, (t) => t.kind === 'barge'); s.flight.push({ id: 99, n: 99, t: 0, tof: 500, shell: 'he', charges: 3, x: a.x, y: a.y, bearing: 0, elevation: 10, pair: null }); return g; },
  burst: () => { const g = start(1), s = g.state; tick(g, 6); const a = sel(g, (t) => t.kind === 'barge'); s.lastReport = { targetId: a.id, over: 50, right: -30, text: 'x', observed: true, time: s.time }; return g; },
  bracket: () => { const g = start(1), s = g.state; tick(g, 6); const a = sel(g, (t) => t.kind === 'barge'); s.shots = 2; s.lastReport = { targetId: a.id, over: -340, right: 0, text: 'x', observed: true, time: s.time }; return g; },
  fatigue: () => { const g = start(3); g.state.crew.gunner.state = 'tired'; return g; },
};

test('темы: у каждой механики есть тема; предикат ложен в учебном бою и истинен в своём состоянии', () => {
  const battle = TOPICS.filter((t) => !t.menu);
  assert.deepEqual(Object.keys(CRAFT).sort(), battle.map((t) => t.id).sort(), 'каждая боевая тема проверена');
  const base = start(0, null, 0); noWind(base); tick(base, 6);
  for (const tp of battle) {
    assert.equal(!!tp.when(ctx(base)), false, tp.id + ': в «Пристрелке» без ветра темы нет');
    const g = CRAFT[tp.id](); const c = ctx(g);
    assert.equal(g.state.phase, 'playing', tp.id);
    assert.equal(!!tp.when(c), true, tp.id + ': в своём состоянии тема есть');
    if (tp.done) assert.equal(!!tp.done(c), false, tp.id + ': действие ещё не сделано');
  }
});

test('темы: тексты — русские, 1–3 предложения; пост и орган управления — из известных; порядок — по срочности', () => {
  const ST = ['plot', 'computer', 'loading', 'traverse', 'elevation', 'fire', 'observe', 'aa'];
  const g = game();
  assert.deepEqual(g.TOPICS.map((t) => t.id), TOPICS.map((t) => t.id));
  let pri = 3;
  for (const tp of TOPICS) {
    assert.ok(tp.pri <= pri, tp.id + ': список идёт от опасности к удобству'); pri = tp.pri;
    assert.ok(!/[A-Za-z]/.test(tp.title + tp.text), tp.id + ': без латиницы');
    assert.ok(tp.title === tp.title.toUpperCase() && tp.title.length <= 30, tp.id);
    const n = tp.text.split(/[.!?](?:\s|$)/).filter((x) => x.trim()).length;
    assert.ok(n >= 1 && n <= 3 && tp.text.length <= 190, tp.id + ': ' + n + ' предл., ' + tp.text.length + ' зн.');
    if (tp.st) assert.ok(ST.includes(tp.st), tp.id);
    if (tp.hot) assert.ok(tp.st, tp.id + ': орган управления — только вместе с постом');
    assert.ok(!tp.hold || tp.hold <= TOPIC_HOLD);
    assert.equal(topicById(tp.id), tp);
  }
  assert.equal(topicById('toString'), null);
  for (const need of ['lead', 'armor', 'sound', 'soundManual', 'relocate', 'waves', 'wind', 'burst', 'faults', 'enemyFire', 'radar', 'submarine', 'fort', 'tanker', 'night', 'flash',
    'smoke', 'shrap', 'fog', 'stale', 'bracket', 'observe', 'noSpotter', 'friends', 'friendZone', 'convoySmoke', 'raid', 'aaHeat', 'fatigue', 'wounded', 'upgrades', 'detected', 'stealth']) assert.ok(topicById(need), need);
});

test('тема: появляется, когда механика перед игроком; гаснет по действию; изученное сохраняется и больше не показывается', () => {
  const st = mem({ unlocked: 99, stars: [], difficulty: 0, learned: allLearned('lead', 'escape') });
  const g = createGame({ storage: st }); const ev = []; g.on('topic', (e) => ev.push(e.id + (e.learned ? '+' : '')));
  begin(g, 3); const s = g.state; noWind(g);
  tick(g, 2); assert.equal(g.hint().kind, null, 'пока разведка молчит — подсказок нет'); assert.equal(s.topic, null);
  tick(g, 4);
  let h = g.hint();
  assert.deepEqual([h.kind, h.id, h.station, h.hotspot], ['topic', 'lead', 'plot', 'pin1']);
  assert.equal(h.text, 'НОВОЕ · ДВИЖУЩАЯСЯ ЦЕЛЬ'); assert.match(h.more, /упреждени/); assert.equal(h.title, 'ДВИЖУЩАЯСЯ ЦЕЛЬ');
  assert.equal(g.hint({ hasHot: () => false }).hotspot, null);
  assert.equal(g.save.learned.lead, undefined);
  tick(g, 10); assert.equal(g.hint().id, 'lead', 'держится, пока игрок не сделал замер');
  g.setAlidade({ bearing: 10, range: 9 }); assert.ok(g.recordMeasurement().ok); tick(g, 0.5);
  assert.equal(g.save.learned.lead, true); assert.equal(stored(st).learned.lead, true);
  h = g.hint(); assert.equal(h.id, 'escape'); assert.equal(h.hotspot, null);
  tick(g, 19); assert.equal(g.hint().id, 'escape'); tick(g, 1.5);
  assert.equal(g.hint().kind, null); assert.equal(g.save.learned.escape, true);
  assert.deepEqual(ev, ['lead', 'lead+', 'escape', 'escape+']);
  // новый запуск: всё изучено — тем нет
  const g2 = createGame({ storage: st }); begin(g2, 3); tick(g2, 30);
  assert.equal(g2.hint().kind, null); assert.equal(g2.state.topic, null);
});

test('тема без действия держится 40 с настоящего времени (и на ×3), а с ушедшей механикой — не меньше 6 с', () => {
  assert.equal(TOPIC_HOLD, 40); assert.equal(TOPIC_MIN, 6);
  const g = game(allLearned('armor')); begin(g, 2); const s = g.state; g.setSetting('hints', 'all'); tick(g, 8); g.setSetting('hints', 'new');
  // задание 3 идёт по шагам; тему проверяем в свободном бою с той же целью
  g.quit(); g.resetLearned(); for (const id of Object.keys(allLearned('armor'))) g.learnTopic(id);
  g.startSkirmish(); const k = g.state;      // цели правим до начала боя: скрытая батарея иначе не получит донесения
  k.targets.forEach((t) => { t.gun = null; t.speed = 0; t.moving = false; t.end = null; t.kind = 'depot'; t.armored = false; t.delay = 0; t.spotter = false; t.locate = 'recon'; t.relocateEvery = 0; });
  k.mission.wind = { speed: 0, from: 0 }; k.shells.ap = 4; g.begin();
  tick(g, 12); assert.equal(g.hint().kind, null, JSON.stringify(k.topic));
  const a = k.targets.find((t) => t.id === k.activeTarget); a.armored = true; g.setSpeed(3);
  tick(g, 0.5); assert.equal(g.hint().id, 'armor'); assert.equal(g.hint().hotspot, 'shellSelector'); assert.equal(g.hint().station, 'loading');
  tick(g, 38.5); assert.equal(g.hint().id, 'armor', '39 с — ещё на экране'); assert.equal(g.save.learned.armor, undefined);
  tick(g, 1.5); assert.equal(g.hint().kind, null); assert.equal(g.save.learned.armor, true);
  // механика ушла сразу — тема всё равно видна 6 с
  g.resetLearned(); for (const id of Object.keys(allLearned('faults'))) g.learnTopic(id);
  g.setSpeed(1); k.faults.lights = true; tick(g, 0.5); assert.equal(g.hint().id, 'faults'); assert.equal(g.hint().dom, 'faults'); assert.equal(g.hint().warn, true);
  k.faults.lights = false; tick(g, 4.5); assert.equal(g.hint().id, 'faults'); tick(g, 1.5); assert.equal(g.hint().kind, null); assert.equal(g.save.learned.faults, true);
  assert.ok(s);
});

test('очередь тем: по одной, самая срочная первой — опасность, потом наводка, потом удобство', () => {
  const g = game(allLearned()); const seen = []; g.on('topic', (e) => { if (!e.learned) seen.push(e.id); });
  g.startSkirmish(); const s = g.state;
  s.targets.forEach((t, i) => { t.gun = null; t.kind = 'transport'; t.moving = true; t.speed = 1; t.end = 'patrol'; t.pathLeft = t.pathLen = 50; t.armored = false; t.spotter = false; t.locate = 'recon'; t.relocateEvery = 0; t.delay = i ? 5 : 0; });
  s.mission.wind = { speed: 0, from: 0 }; g.begin();
  tick(g, 12);
  assert.equal(g.hint().kind, null);
  g.resetLearned(); for (const id of Object.keys(allLearned('faults', 'lead', 'waves', 'raid', 'fatigue'))) g.learnTopic(id);
  s.crew.loader.fatigue = 1; s.faults.hoist = true; s.raidWarn = { from: 0, until: s.time + 3 };
  const order = [];
  for (let i = 0; i < 400; i++) {
    s.crew.loader.fatigue = 1; tick(g, 0.5);
    const h = g.hint(); if (h.kind === 'topic' && order[order.length - 1] !== h.id) order.push(h.id);
  }
  assert.deepEqual(order, seen, 'на экране по одной теме');
  assert.deepEqual(seen, ['raid', 'faults', 'lead', 'waves', 'fatigue']);
  assert.equal(g.hint().kind, null); assert.deepEqual(Object.keys(g.save.learned).length, TOPICS.length);
});

test('задания 1–3 и режим «все»: без показа засчитывается только то, что объясняют сами шаги; остальное остаётся новым', () => {
  // темы, которые шаги ведут сами
  assert.deepEqual(TOPICS.filter((t) => t.steps).map((t) => t.id).sort(), ['armor', 'night', 'noSpotter', 'raid', 'shrap', 'sound', 'soundManual', 'stale', 'wind']);
  const g = game(); const ev = []; g.on('topic', (e) => ev.push(e));
  begin(g, 2); tick(g, 9);
  // «Бетон»: есть орудия. Тема «НАС НЕ ВИДЯТ» — не из шагов: она показана (пока ждали разведку), а не засчитана молча;
  // с появлением шага строка подсказки снова его
  assert.equal(g.hint().kind, 'step'); assert.equal(g.state.topic.id, 'stealth'); assert.equal(g.topicInfo().id, 'stealth');
  assert.equal(g.save.learned.stealth, undefined, 'тема о засечке не засчитана молча');
  assert.deepEqual(ev.filter((e) => !e.learned), [{ id: 'stealth', learned: false }]);
  // бронированная цель выбрана: шаг «выберите ББ (цель бронирована)» объясняет её сам — тема засчитана без показа
  const arm = g.state.targets.find((t) => t.armored); assert.ok(arm); tick(g, 6); g.selectTarget(arm.id); tick(g, 1);
  assert.equal(g.save.learned.armor, true); assert.equal(g.state.topic.id, 'stealth');
  assert.deepEqual(ev.filter((e) => e.learned), [{ id: 'armor', learned: true }], 'молча засчитана только тема из шагов');
  // игроку нечего делать (снаряд в полёте) — в строке подсказки тема «СВОЙ ГЛАЗ», её объяснение доступно; с новым шагом строка снова его
  const s = g.state; s.targets.forEach((t) => { if (t.gun) t.gun.next = s.time + 900; });
  const vis = s.targets.find((t) => t.alive && g.visible(t.id)); assert.ok(vis, 'днём цель видна в трубу'); g.selectTarget(vis.id);
  fireQuiet(g, 'he', vis.x, vis.y, null, { loadOnly: true });
  g.elevate(20 - s.turret.elevation); g.setBrake(true); g.arm(true); assert.ok(g.fire().ok); tick(g, 1.5);
  assert.ok(s.flight.length > 0);
  const h = g.hint(); assert.equal(h.kind, 'topic', JSON.stringify(h)); assert.equal(h.id, 'observe'); assert.equal(h.station, 'observe');
  assert.equal(g.topicInfo().id, 'observe'); assert.ok(/наведите трубу/.test(g.topicInfo().more));
  assert.equal(g.save.learned.observe, undefined); assert.equal(g.save.learned.stealth, true, 'первый выстрел — тема о скрытности закрыта');
  // засечка (опасность) вытесняет «свой глаз», тот остаётся неизученным
  tick(g, 9); assert.equal(s.detected, true); assert.equal(g.topicInfo().id, 'detected'); assert.equal(g.save.learned.observe, undefined);
  g.quit(); g.setSetting('hints', 'all'); begin(g, 3); tick(g, 9);
  assert.equal(g.save.learned.lead, undefined, 'упреждение шаги не объясняют'); assert.equal(g.hint().kind, 'step');
  // опасность не ждёт паузы в процедуре: отказ узла показывается объяснением, строка остаётся за шагом
  g.state.faults.hoist = true; tick(g, 0.5);
  assert.equal(g.state.topic && g.state.topic.id, 'faults'); assert.equal(g.hint().kind, 'step'); assert.equal(g.topicInfo().id, 'faults'); assert.equal(g.topicInfo().warn, true);
  g.setSetting('hints', 'off'); assert.equal(g.topicInfo(), null);
  // «нет» — ничего не засчитывается
  const q = game(); q.setSetting('hints', 'off'); begin(q, 3); tick(q, 9); assert.deepEqual(q.save.learned, {});
});

test('старые сохранения: подсказки вкл/выкл → «новое»/«нет»; знакомо только то, что было в пройденных заданиях', () => {
  assert.equal(createGame({ storage: mem({ settings: { hints: true } }) }).settings().hints, 'new');
  assert.equal(createGame({ storage: mem({ settings: { hints: false } }) }).settings().hints, 'off');
  assert.equal(createGame({ storage: mem({ settings: { hints: 'all' } }) }).settings().hints, 'all');
  assert.equal(createGame({ storage: mem({ settings: { hints: 'да' } }) }).settings().hints, 'new');
  assert.equal(createGame({ storage: mem({ settings: {} }) }).settings().hints, 'new');
  // новичок
  assert.deepEqual(createGame({ storage: mem() }).save.learned, {});
  // ветеран: пройдены задания 1–6 (до «Дуэли»)
  const vet = createGame({ storage: mem({ unlocked: 7, stars: [3, 3, 2, 1, 1, 2], xp: 900, upgrades: { hoist: 1 } }) }).save.learned;
  for (const id of ['armor', 'enemyFire', 'faults', 'wounded', 'lead', 'escape', 'wind', 'landing', 'upgrades']) assert.equal(vet[id], true, id);
  for (const id of ['stealth', 'detected', 'night', 'sound', 'fog', 'raid', 'convoy', 'burst', 'bracket', 'observe', 'radar']) assert.equal(vet[id], undefined, id + ' — ещё не встречалось');
  // тот, кто прошёл всю кампанию, не знает только правила засечки
  const all = createGame({ storage: mem({ unlocked: 36, stars: CAMPAIGN.map(() => 1), xp: 5000, upgrades: { armor: 2 } }) }).save.learned;
  // (и ручных линий пеленгов, если играл на «Курсанте»: там их рисует планшет)
  assert.deepEqual(TOPICS.filter((t) => !all[t.id]).map((t) => t.id).sort(), ['detected', 'soundManual', 'stealth', 'survival']);
  const allCmd = createGame({ storage: mem({ unlocked: 36, stars: CAMPAIGN.map(() => 1), xp: 5000, difficulty: 1 }) }).save.learned;
  assert.deepEqual(TOPICS.filter((t) => !allCmd[t.id]).map((t) => t.id).sort(), ['detected', 'stealth', 'survival', 'upgrades']);
  // сохранение новой версии: набор как есть, чужие ключи и не-true отброшены
  const cur = createGame({ storage: mem({ stars: [3, 3, 3, 3, 3, 3], learned: { lead: true, wind: 1, чужое: true, __proto__: true } }) }).save.learned;
  assert.deepEqual(cur, { lead: true });
  assert.deepEqual(createGame({ storage: mem({ stars: [3, 3, 3, 3], learned: {} }) }).save.learned, {}, 'пустой набор — тоже набор');
  // describe: описание кампании и состояние боя дают одно и то же
  const g = game(); begin(g, 30);
  const a = describe(CAMPAIGN[30]), b = describe(g.state);
  for (const k of ['night', 'fog', 'storm', 'raids', 'survival', 'noSpotter', 'friends', 'convoy']) assert.equal(a[k], b[k], k);
  assert.deepEqual(a.tg.map((t) => [t.kind, t.sound, t.relocate, t.delay, t.hunts]), b.tg.map((t) => [t.kind, t.sound, t.relocate, t.delay, t.hunts]));
});

test('сброс: resetProgress и «показать обучение заново» (resetLearned) стирают изученное; learnTopic', () => {
  const st = mem({ unlocked: 9, stars: [1, 1, 1, 1], learned: { lead: true, wind: true } }); const g = createGame({ storage: st });
  assert.deepEqual(g.resetLearned(), { ok: true }); assert.deepEqual(g.save.learned, {}); assert.deepEqual(stored(st).learned, {});
  assert.deepEqual(createGame({ storage: st }).save.learned, {}, 'после перезапуска ветерану ничего не засчитывается заново');
  assert.ok(g.learnTopic('fog').ok); assert.equal(g.learnTopic('нет такой').ok, false); assert.deepEqual(stored(st).learned, { fog: true });
  assert.ok(g.resetProgress().ok); assert.deepEqual(g.save.learned, {}); assert.deepEqual(stored(st).learned, {});
  assert.deepEqual(createGame({ storage: st }).save.learned, {});
});

test('инструктаж: «НОВОЕ В ЭТОМ ЗАДАНИИ» — темы задания, которых игрок не знает; меню — подсказка про снабжение', () => {
  const g = game(); assert.ok(g.startMission(3).ok);
  let bt = g.briefTopics();
  assert.deepEqual(bt.map((t) => t.id).sort(), ['escape', 'lead', 'wind']);
  assert.ok(bt.every((t) => t.title && t.text && !/[A-Za-z]/.test(t.title + t.text)));
  g.learnTopic('lead'); assert.deepEqual(g.briefTopics().map((t) => t.id).sort(), ['escape', 'wind']);
  g.quit(); assert.deepEqual(g.briefTopics(), []);
  assert.ok(g.startMission(0).ok); assert.deepEqual(g.briefTopics(), [], 'в «Пристрелке» новых механик нет'); g.quit();
  assert.ok(g.startMission(2).ok); assert.ok(g.briefTopics().some((t) => t.id === 'stealth') && g.briefTopics().some((t) => t.id === 'armor')); g.quit();
  g.startSurvival(); assert.ok(g.briefTopics().some((t) => t.id === 'survival')); g.quit();
  // меню
  assert.equal(g.menuHint(), null, 'очков нет');
  const rich = game({}, { xp: 320 }); assert.equal(rich.points(), 2);
  assert.deepEqual(rich.menuHint(), { id: 'upgrades', title: 'ОЧКИ СНАБЖЕНИЯ', text: topicById('upgrades').text });
  rich.setSetting('hints', 'off'); assert.equal(rich.menuHint(), null); rich.setSetting('hints', 'new');
  assert.ok(rich.learnTopic('upgrades').ok); assert.equal(rich.menuHint(), null);
  assert.ok(waitBreech);
});

test('тема в снимке боя: показанная тема переживает restore; незнакомый id отбрасывается', () => {
  const g = game(allLearned('lead')); begin(g, 3); tick(g, 6); assert.equal(g.hint().id, 'lead');
  const sn = JSON.parse(JSON.stringify(g.snapshot()));
  const g2 = game(allLearned('lead')); assert.ok(g2.restore(sn).ok); assert.equal(g2.hint().id, 'lead');
  sn.state.topic.id = 'нет'; const g3 = game(allLearned('lead')); assert.ok(g3.restore(sn).ok); assert.equal(g3.state.topic, null);
  // dismissTopic: тема убрана с экрана и считается изученной; без темы — отказ
  assert.deepEqual(g2.dismissTopic(), { ok: true }); assert.equal(g2.state.topic, null); assert.equal(g2.save.learned.lead, true); assert.equal(g2.hint().kind, null);
  assert.equal(g2.dismissTopic().ok, false); tick(g2, 3); assert.equal(g2.hint().kind, null);
});

// ======================= НАХОДКИ ПРОВЕРКИ =======================
test('засечка: строка «бьют наугад» не приходит, если за 3 с до доставки батарею уже засекли', () => {
  const g = start(2, null, 1), s = g.state; tick(g, 12);
  const gun = s.targets.find((t) => t.gun);
  gun.gun.next = s.time; tick(g, 0.3);
  assert.ok(gun.salvos >= 1, 'первый залп наугад дан'); assert.equal(s.radio.some((m) => /наугад/.test(m.text)), false, 'строка ещё в пути');
  const g2 = start(2, null, 1), s2 = g2.state; tick(g2, 12);
  const gun2 = s2.targets.find((t) => t.gun); s2.targets.forEach((t) => { if (t.gun) t.gun.next = s2.time + 900; });
  // орудие заряжено и наведено заранее; противник даёт залп наугад, мы стреляем — засечка придёт раньше, чем строка штаба
  fireQuiet(g2, 'he', gun2.x, gun2.y + 3, null, { loadOnly: true }); g2.elevate(20 - s2.turret.elevation); g2.setBrake(true); g2.arm(true);
  gun2.gun.next = s2.time; tick(g2, 0.2); assert.ok(gun2.salvos >= 1);
  s2.targets.forEach((t) => { if (t.gun) t.gun.next = s2.time + 900; });
  assert.ok(g2.fire().ok); tick(g2, 1); assert.equal(s2.detected, false);
  s2.flight.forEach((f) => { f.tof = f.t + 0.3; });                                   // разрыв через 0,3 с — засечка по первому разрыву
  tick(g2, 1); assert.equal(s2.detected, true, 'засечены раньше, чем дошла строка');
  tick(g2, 6);
  assert.ok(s2.radio.some((m) => /засёк батарею по вспышке/.test(m.text)));
  assert.equal(s2.radio.some((m) => /наугад/.test(m.text)), false, JSON.stringify(s2.radio.map((m) => m.text)));
  // а без засечки строка приходит, как раньше
  const g3 = start(2, null, 1), s3 = g3.state; tick(g3, 12); const gun3 = s3.targets.find((t) => t.gun); gun3.gun.next = s3.time; tick(g3, 4);
  assert.equal(s3.radio.filter((m) => /нас пока не видят/.test(m.text)).length, 1);
});

test('оборона: засечка в волне без орудий не молчит — о ней сообщают с первой вооружённой волной, один раз', () => {
  const g = createGame({ storage: mem({ unlocked: 99, stars: [], difficulty: 1, learned: allLearned('detected') }) }); g.startSurvival(); g.begin();
  const s = g.state, ev = []; g.on('detected', (e) => ev.push(e)); tick(g, 20);
  s.targets.forEach((t) => { t.gun = null; });                                        // первая волна — без орудий
  fireQuiet(g, 'smoke', s.mission.battery.x, s.mission.battery.y + 2.5, null);
  assert.equal(s.detected, true); assert.equal(s.detectTold, null, 'сообщать пока некому');
  assert.deepEqual(ev.map((e) => [e.armed, !!e.late]), [[false, false]]);
  assert.equal(s.radio.some((m) => /засёк|засечена/.test(m.text)), false);
  assert.equal(topicById('detected').when(ctx(g)), false);
  // следующие волны: пока орудий нет — тишина; пришли орудия — строка штаба, событие с late, тема «БАТАРЕЯ ЗАСЕЧЕНА»
  let told = 0, guard = 0;
  while (s.detectTold == null && guard++ < 8 && s.phase === 'playing') {
    s.integrity = 100; s.targets.forEach((q) => { q.alive = false; q.sinking = { since: s.time, dur: 18 }; });
    const w = s.wave; tick(g, 14); assert.equal(s.wave, w + 1);
    told = s.radio.filter((m) => /Батарея давно засечена/.test(m.text)).length;
    assert.equal(told > 0, s.targets.some((t) => t.alive && t.gun), 'строка — ровно когда появилось орудие (волна ' + s.wave + ')');
  }
  assert.equal(told, 1); assert.ok(s.detectTold != null && s.detectTold > s.detectedAt + 10);
  assert.deepEqual(ev.map((e) => [e.armed, !!e.late]), [[false, false], [true, true]]);
  assert.equal(topicById('detected').when(ctx(g)), true);
  tick(g, 1); assert.equal(g.hint().id, 'detected');
  // дальше не повторяется; снимок хранит отметку; снимок прежней версии (без неё) считается «уже сообщали»
  const snap = JSON.parse(JSON.stringify(g.snapshot()));
  s.targets.forEach((q) => { q.alive = false; q.sinking = { since: s.time, dur: 18 }; }); tick(g, 14);
  assert.equal(s.radio.filter((m) => /Батарея давно засечена/.test(m.text)).length, 1); assert.equal(ev.length, 2);
  const g2 = game(allLearned()); assert.ok(g2.restore(snap).ok); assert.equal(g2.state.detectTold, snap.state.detectTold);
  delete snap.state.detectTold; const g3 = game(allLearned()); assert.ok(g3.restore(snap).ok); assert.equal(g3.state.detectTold, g3.state.detectedAt);
});

test('«ПО ШАГАМ» на «Командире»: звукометрия ведёт через ручные линии пеленгов, тема о них засчитана шагами', () => {
  const g = createGame({ storage: mem({ unlocked: 99, stars: [], difficulty: 1, learned: {}, settings: { hints: 'all' } }) });
  begin(g, 8); const s = g.state; tick(g, 4);
  const t = s.targets.find((q) => q.locate === 'sound'); t.gun.next = s.time; tick(g, 1); assert.ok(t.reported && t.reported.sound); g.selectTarget(t.id); tick(g, 0.5);
  assert.equal(g.hintMode(), 'steps'); assert.deepEqual(s.plot.lines, []);
  const shown = []; g.on('topic', (e) => { if (!e.learned) shown.push(e.id); });
  const P = g.pivots(), seen = [];
  for (const q of t.reported.sound) {
    let h = g.hint(); seen.push(h.text);
    assert.equal(h.station, 'plot'); assert.ok(h.text.includes('знака поста ' + q.name), h.text); assert.ok(!/пересечени/.test(h.text));
    assert.ok(g.setPivot(P.findIndex((p) => p.name === q.name)).ok);
    h = g.hint(); assert.equal(h.hotspot, 'bearingWheel'); assert.ok(h.text.includes(q.name) && h.text.includes(g.fmt.brg(q.bearing)), h.text);
    g.setAlidade({ bearing: q.bearing });
    h = g.hint(); assert.equal(h.hotspot, 'btnLine'); assert.ok(/«ЛИНИЯ»/.test(h.text));
    assert.ok(g.drawLine().ok);
  }
  // обе линии есть — теперь фишка на пересечение, потом ось назад на «УТЁС»
  let h = g.hint(); assert.equal(h.hotspot, 'pin' + t.id); assert.ok(/пересечение пеленгов/.test(h.text));
  g.setPin(t.id, t.x, t.y); h = g.hint(); assert.ok(/«УТЁС»/.test(h.text), h.text);
  g.setPivot(0); assert.equal(g.hint().hotspot, 'sight');
  tick(g, 0.5); assert.equal(g.save.learned.soundManual, true); assert.ok(!shown.includes('soundManual') && !shown.includes('sound'), shown.join());
  // «Курсант»: линии рисует планшет — шаг сразу про фишку; тема о ручных линиях не засчитывается и в инструктаж не попадает
  const k = createGame({ storage: mem({ unlocked: 99, stars: [], difficulty: 0, learned: {}, settings: { hints: 'all' } }) });
  assert.ok(k.startMission(8).ok); const bk = k.briefTopics().map((x) => x.id);
  assert.ok(bk.includes('sound') && !bk.includes('soundManual'), bk.join());
  k.begin(); tick(k, 4); const tk = k.state.targets.find((q) => q.locate === 'sound'); tk.gun.next = k.state.time; tick(k, 1); k.selectTarget(tk.id); tick(k, 0.5);
  assert.equal(k.hint().hotspot, 'pin' + tk.id); assert.ok(/пересечение пеленгов/.test(k.hint().text)); assert.equal(k.save.learned.soundManual, undefined);
  g.quit(); assert.ok(g.startMission(8).ok); assert.ok(!g.briefTopics().some((x) => x.id === 'soundManual'), 'изучено');
  const c = createGame({ storage: mem({ unlocked: 99, stars: [], difficulty: 1, learned: {} }) }); assert.ok(c.startMission(8).ok);
  assert.ok(c.briefTopics().some((x) => x.id === 'soundManual'), 'на «Командире» — в инструктаже');
});

test('срочная тема вытесняет менее срочную: налёт — сразу, остальное — после 6 с; вытесненная остаётся новой', () => {
  const g = game(allLearned('waves', 'raid', 'faults', 'lead')); const seen = []; g.on('topic', (e) => seen.push(e.id + (e.learned ? '+' : '')));
  g.startSkirmish(); const s = g.state;
  s.targets.forEach((t, i) => { t.gun = null; t.kind = 'transport'; t.moving = false; t.speed = 0; t.end = 'patrol'; t.armored = false; t.spotter = false; t.locate = 'recon'; t.relocateEvery = 0; t.delay = i ? 500 : 0; });
  s.mission.wind = { speed: 0, from: 0 }; g.begin(); tick(g, 1);
  assert.equal(g.hint().id, 'waves');
  // «ВОЗДУХ!» через 2 с после появления темы об удобстве: тема о налёте — сразу же
  tick(g, 1); s.raidWarn = { from: 0, until: s.time + 10 }; tick(g, 0.4);
  assert.equal(g.hint().id, 'raid'); assert.equal(g.save.learned.waves, undefined);
  s.aa.firing = true; tick(g, 0.4); s.aa.firing = false; s.raidWarn = null;
  assert.equal(g.save.learned.raid, true); assert.equal(g.hint().id, 'waves', 'вытесненная тема вернулась');
  // опасность без пометки urgent (отказ узла): ждёт, пока текущая пробудет на экране TOPIC_MIN
  const since = s.topic.shown; s.faults.hoist = true; tick(g, 2);
  assert.ok(since < 1 && g.hint().id === 'waves', 'раньше 6 с не мелькает');
  tick(g, TOPIC_MIN - 1.5); assert.equal(g.hint().id, 'faults'); assert.equal(g.save.learned.waves, undefined);
  // тревога вытесняет и тему того же приоритета (отказ узла — тоже «опасность»), сразу
  g.resetLearned(); for (const id of Object.keys(allLearned('waves', 'raid', 'faults', 'lead'))) g.learnTopic(id);
  s.faults.hoist = true; tick(g, 0.4); if (g.hint().id !== 'faults') tick(g, TOPIC_MIN + 0.5); assert.equal(g.hint().id, 'faults');
  s.raidWarn = { from: 0, until: s.time + 10 }; tick(g, 0.4); assert.equal(g.hint().id, 'raid'); assert.equal(g.save.learned.faults, undefined);
  s.raidWarn = null; g.dismissTopic(); tick(g, 0.4); assert.equal(g.hint().id, 'faults', 'отказ узла вернулся');
  // равный или меньший приоритет не вытесняет
  s.faults.hoist = false; g.dismissTopic(); tick(g, 0.4); assert.equal(g.hint().id, 'waves');
  s.targets[0].moving = true; s.targets[0].speed = 1; tick(g, 8);
  if (topicById('lead').when(ctx(g))) assert.equal(g.hint().id, 'lead', 'наводка важнее удобства');
  assert.deepEqual(seen.filter((x) => !x.endsWith('+')).slice(0, 4), ['waves', 'raid', 'waves', 'faults']);
});

test('инструктаж: у каждой темы с intro есть своя строка brief — что это и что делать, без «уже случилось»', () => {
  for (const tp of TOPICS) {
    if (!tp.intro) { assert.equal(tp.brief, undefined, tp.id); continue; }
    assert.ok(typeof tp.brief === 'string' && tp.brief.length >= 30 && tp.brief.length <= 125, tp.id + ': ' + (tp.brief || '').length);
    assert.ok(!/[A-Za-z]/.test(tp.brief) && /[.!]$/.test(tp.brief), tp.id);
    assert.ok(!/^(Отказал|Охотник бьёт|Противник увидел|Точка прицеливания ближе|Батарея замолчала|Эта цель)/.test(tp.brief), tp.id + ': звучит как свершившийся факт');
  }
  const g = game(); assert.ok(g.startMission(35).ok);
  const list = g.briefTopics(); assert.ok(list.length > 3);
  for (const x of list) assert.equal(x.brief, topicById(x.id).brief);
});
