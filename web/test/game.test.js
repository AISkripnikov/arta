import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/game/index.js';
import { solve, chargeRange, shoot } from '../src/game/ballistics.js';
import { CAMPAIGN, makeMap, isLand } from '../src/game/missions.js';

const RAD = Math.PI / 180;
const norm = (a) => ((a % 360) + 360) % 360;
function tick(game, seconds, step = 0.1) { for (let t = 0; t < seconds && game.state.phase === 'playing'; t += step) game.update(step); }
function waitBreech(game) { let n = 0; while (game.state.breech.busy && n++ < 1000) game.update(0.1); }

/** Пересечение двух пеленгов звукометрии. */
function intersect([a, b]) {
  const da = [Math.sin(a.bearing * RAD), Math.cos(a.bearing * RAD)], db = [Math.sin(b.bearing * RAD), Math.cos(b.bearing * RAD)];
  const den = da[0] * db[1] - da[1] * db[0];
  const k = ((b.x - a.x) * db[1] - (b.y - a.y) * db[0]) / den;
  return { x: a.x + da[0] * k, y: a.y + da[1] * k };
}

function unlockAll() { const mem = {}; return { get: (k) => mem[k] || JSON.stringify({ unlocked: 99, stars: [], difficulty: 1 }), set: (k, v) => { mem[k] = v; } }; }

/** Полная процедура одного выстрела снарядом type в точку aim(tof) → {x,y}. target — цель для записи замера (или null). */
function fireShellRaw(game, type, aim, target, opts, must) {
  const s = game.state, bat = s.mission.battery, b = s.breech;
  // 1. замер с упреждением: несколько приближений по времени полёта
  let tof = 30, sol, charge, brg, rng;
  const measure = () => {
    for (let i = 0; i < 4; i++) {
      const p = aim(tof);
      const dx = p.x - bat.x, dy = p.y - bat.y;
      rng = Math.hypot(dx, dy); brg = norm(Math.atan2(dx, dy) / RAD);
      charge = [1, 2, 3, 4, 5, 6].find((n) => { const l = chargeRange(n); return rng >= l.min && rng <= l.max - 0.3; });
      must(charge, 'нет заряда для дальности ' + rng);
      sol = solve(rng, charge); tof = sol.tof;
    }
  };
  measure();
  // 2. зарядить (если орудие уже заряжено тем же — только поправить число зарядов)
  if (!(b.shell === type && b.rammed && !b.open && b.charges === charge)) {
    game.elevate(-s.turret.elevation);
    must(game.openBreech().ok); waitBreech(game);
    if (b.shell && b.shell !== type) { must(game.unload().ok); waitBreech(game); }
    if (!b.shell) {
      must(game.hoistShell(type).ok, 'hoist ' + type); waitBreech(game);
      must(game.ramShell().ok); waitBreech(game);
    }
    measure();      // заряжание заняло время — упреждение заново
    while (b.charges > charge) { must(game.removeCharge().ok); waitBreech(game); }
    while (b.charges < charge) { must(game.addCharge().ok); waitBreech(game); }
    must(game.closeBreech().ok); waitBreech(game);
  }
  if (opts.loadOnly) return { ok: true, charge };
  if (target) {
    game.selectTarget(target.id);
    if (opts.pin) game.setPin(target.id, opts.pin.x, opts.pin.y);
    game.setAlidade({ bearing: brg, range: rng });
    must(game.recordMeasurement().ok);
  }
  game.setComputerRange(rng); game.setComputerCharge(charge);
  let res = game.compute(); must(res.ok, 'compute');
  // 3. наводка; если за это время сменился ветер (шторм) — пересчитать и довернуть
  for (let k = 0; k < 3; k++) {
    if (s.computer.stale) { res = game.compute(); must(res.ok, 'recompute'); }
    game.setBrake(false);
    let d = norm(brg + res.windBearing - s.turret.bearing); if (d > 180) d -= 360;
    must(game.rotateTurret(d).ok);
    game.setBrake(true);
    game.elevate(res.elevation - s.turret.elevation);
    must(Math.abs(s.turret.elevation - res.elevation) < 0.011);
    if (!s.computer.stale) break;
  }
  // 4. огонь и ожидание разрыва
  game.arm(true);
  const f = game.fire(); must(f.ok, 'fire: ' + f.reason);
  let guard = 0;
  while ((s.flight.length || (s.breech.busy && s.fire.burstLeft > 0)) && s.phase === 'playing' && guard++ < 8000) game.update(0.05);
  f.charge = charge;
  return f;
}
const ENDED = Symbol('бой окончен');
/** Бой может кончиться посреди процедуры (батарею разбили) — тогда выстрела нет, возвращаем null. */
function fireShell(game, type, aim, target, opts = {}) {
  const s = game.state;
  const must = (cond, msg) => { if (s.phase !== 'playing') throw ENDED; assert.ok(cond, msg); };
  try { return fireShellRaw(game, type, aim, target, opts, must); } catch (e) { if (e === ENDED) return null; throw e; }
}
/** Бот: выстрел по цели по донесениям разведки (corr — накопленная поправка, км). */
function engage(game, t, corr) {
  const s = game.state;
  const type = t.armored ? 'ap' : t.kind === 'landing' && s.shells.shrap > 0 ? 'shrap' : s.shells.he > 0 ? 'he' : s.shells.shrap > 0 ? 'shrap' : 'ap';
  const pinAt = t.reported.sound ? intersect(t.reported.sound) : t.reported;
  const f = fireShell(game, type, (tof) => {
    const p = t.reported.sound ? intersect(t.reported.sound) : game.predict(t.id, t.moving ? tof + 7 : 0);
    return { x: p.x + (corr ? corr.dx : 0), y: p.y + (corr ? corr.dy : 0) };
  }, t, { pin: pinAt });
  if (f && corr) { corr.charge = f.charge; corr.at = { x: pinAt.x, y: pinAt.y }; }
  return s.shots;
}

const PRI = (t) => (t.end === 'land' || t.end === 'escape' || t.end === 'dive' ? 3 : t.spotter ? 2 : t.gun ? 1 : 0);
/** Один ход бота: осветить / задымить / выстрелить. → false, если пока нечего делать. */
function botStep(game, corr) {
  const s = game.state, bat = s.mission.battery;
  // сначала те, кто стреляет и убегает
  const known = s.targets.filter((x) => x.alive && (x.reported || x.area) && !x.moved).sort((a, b) => PRI(b) - PRI(a));
  // дым: батарее досталось, а орудия противника не прикрыты
  if (s.shells.smoke > 0 && s.integrity < 75 && !s.smokes.length) {
    const g = known.find((x) => x.gun && (x.reported || x.area));
    if (g) {
      const p = g.reported && g.reported.sound ? intersect(g.reported.sound) : game.predict(g.id, 0);
      const L = Math.hypot(p.x - bat.x, p.y - bat.y);
      fireShell(game, 'smoke', () => ({ x: bat.x + (p.x - bat.x) / L * 2.5, y: bat.y + (p.y - bat.y) / L * 2.5 }), null);
      return true;
    }
  }
  for (const t of known) {
    const c = corr[t.id] || (corr[t.id] = { dx: 0, dy: 0, key: null, blind: false });
    const r = t.reported;
    if (s.mission.night && t.locate === 'recon' && !t.lit) {
      // ночь: нет точных координат (или они устарели, или промах без наблюдения) — сначала свет
      const need = !r || r.rough || (t.moving && s.time - r.time > 100) || c.blind;
      if (need) {
        if (s.shells.illum <= 0) { if (!r) continue; }
        else {
          const p = game.predict(t.id, 45);
          fireShell(game, 'illum', () => p, t);
          c.blind = false;
          return true;
        }
      }
    }
    if (!r) continue;
    const key = JSON.stringify(r.sound || [r.x, r.y]);
    if (c.key !== key || t.moving) { c.dx = 0; c.dy = 0; c.key = key; }   // новая засечка — поправки сначала
    engage(game, t, c);
    // поправка по докладу корректировщика (как сделал бы игрок)
    const rep = s.lastReport;
    if (rep && rep.targetId === t.id && t.alive) {
      if (rep.dark) c.blind = true;
      else if (!t.moving && rep.observed) {
        const L = Math.hypot(t.x - bat.x, t.y - bat.y), ux = (t.x - bat.x) / L, uy = (t.y - bat.y) / L;
        c.dx -= (rep.over * ux + rep.right * uy) / 1000;
        c.dy -= (rep.over * uy - rep.right * ux) / 1000;
      }
    }
    return true;
  }
  // делать нечего, но кочующая батарея вот-вот объявится — заранее зарядить орудие под её остров
  const w = s.targets.find((x) => x.alive && x.locate === 'sound' && x.moved && corr[x.id] && corr[x.id].at);
  if (w && !s.breech.shell && !s.breech.busy && s.shells.he > 0) fireShell(game, 'he', () => corr[w.id].at, null, { loadOnly: true });
  return false;
}

/** Тихий выстрел: без рассеивания (гауссов шум обнуляется при Math.random() = 0.25). */
function quiet(fn) { const R = Math.random; Math.random = () => 0.25; try { return fn(); } finally { Math.random = R; } }
function fireQuiet(game, type, x, y, target) {
  const s = game.state;
  const realFire = game.fire;
  game.fire = () => quiet(realFire);
  try { return fireShell(game, type, () => ({ x, y }), target || null); } finally { game.fire = realFire; }
}
const noWind = (game) => { game.state.mission.wind = { speed: 0, from: 0 }; };

test('баллистика: решение вычислителя попадает в заданную дальность', () => {
  for (let n = 1; n <= 6; n++) {
    const l = chargeRange(n);
    for (const f of [0.05, 0.3, 0.6, 0.95]) {
      const R = l.min + (l.max - l.min) * f, s = solve(R, n);
      assert.ok(s.ok);
      const hit = shoot(37, s.elevation, n);
      assert.ok(Math.abs(hit.range - R) < 0.012, `заряд ${n} R=${R.toFixed(2)} → ${hit.range.toFixed(3)}`);
    }
    assert.equal(solve(l.max + 0.2, n).ok, false);
    assert.equal(solve(l.min - 0.2, n).ok, false);
  }
  // диапазоны перекрываются и растут
  for (let n = 1; n < 6; n++) assert.ok(chargeRange(n + 1).min < chargeRange(n).max && chargeRange(n + 1).max > chargeRange(n).max);
});

test('карта: батарея на суше, острова в море', () => {
  for (const def of CAMPAIGN) {
    const m = makeMap(def.seed);
    assert.ok(isLand(m, m.battery.x, m.battery.y));
    assert.ok(m.islands.length >= 3);
    for (const o of m.islands) { assert.ok(isLand(m, o.x, o.y)); assert.ok(Math.hypot(o.x - m.battery.x, o.y - m.battery.y) < 19.5, 'остров в пределах досягаемости'); }
  }
});

test('правила заряжания и блокировки', () => {
  const game = createGame({ storage: unlockAll() });
  const denied = []; game.on('denied', (d) => denied.push(d.action));
  game.startMission(0); game.begin(); tick(game, 8);
  const s = game.state;
  assert.equal(game.fire().ok, false);
  assert.equal(game.rotateTurret(5).ok, false, 'стопор держит башню');
  game.elevate(10);
  assert.equal(game.openBreech().ok, false, 'на большом угле затвор не открыть');
  game.elevate(-10);
  assert.ok(game.openBreech().ok);
  assert.equal(game.hoistShell('he').ok, false, 'механизм занят');
  waitBreech(game); assert.equal(s.breech.open, true);
  assert.equal(game.elevate(10).ok, false, 'при открытом затворе ствол не поднять');
  assert.equal(game.addCharge().ok, false, 'без снаряда заряд не подать');
  assert.equal(game.hoistShell('ap').ok, false, 'ББ нет в первом задании');
  const he0 = s.shells.he;
  assert.ok(game.hoistShell('he').ok); waitBreech(game);
  assert.equal(s.shells.he, he0 - 1);
  assert.equal(game.closeBreech().ok, false, 'снаряд на лотке');
  assert.ok(game.ramShell().ok); waitBreech(game);
  assert.ok(game.addCharge().ok); waitBreech(game);
  assert.ok(game.addCharge().ok); waitBreech(game);
  assert.ok(game.removeCharge().ok); waitBreech(game);
  assert.equal(s.breech.charges, 1);
  assert.ok(game.unload().ok); waitBreech(game);
  assert.equal(s.shells.he, he0); assert.equal(s.breech.shell, null);
  assert.equal(game.arm(true).ok, false, 'при открытом затворе цепь не взвести');
  assert.ok(denied.includes('fire') && denied.includes('rotateTurret'));
  // вычислитель
  game.setComputerRange(7.55); game.setComputerCharge(2);
  assert.deepEqual(game.chargeStates(), ['out', 'ok', 'ok', 'ok', 'ok', 'ok']);
  const r = game.compute(); assert.ok(r.ok && r.elevation > 5);
  game.setComputerRange(7.6); assert.equal(s.computer.stale, true);
  game.setComputerCharge(1); assert.equal(game.compute().ok, false); assert.equal(s.computer.elevation, null);
});

for (let diff = 0; diff <= 1; diff++) {
  CAMPAIGN.forEach((def, idx) => {
    test(`прохождение: ${idx + 1}. ${def.name} (сложность ${diff})`, () => {
      let wins = 0; const RUNS = +process.env.RUNS || 6, log = [];
      for (let run = 0; run < RUNS; run++) {
        const game = createGame({ storage: unlockAll() });
        game.setDifficulty(diff);
        assert.ok(game.startMission(idx).ok); game.begin();
        const s = game.state; let end = null; game.on('missionEnd', (e) => { end = e; });
        for (let i = 0; i < 60 && !s.targets.some((t) => t.reported || t.area); i++) tick(game, 1);
        assert.ok(s.targets.some((t) => t.reported || t.area), 'есть донесения');
        const corr = {};
        let guard = 0;
        while (s.phase === 'playing' && guard++ < 90) {
          if (!botStep(game, corr)) { tick(game, 3); guard--; if (s.time > 1800) break; continue; }
          tick(game, 0.5);
        }
        tick(game, 5);
        if (end && end.won) wins++;
        log.push(end ? (end.won ? `победа ★${end.stars} выстр.${end.stats.shots}/${end.stats.par} проч.${end.stats.integrity} t=${Math.round(end.stats.time)}` : 'поражение: ' + end.reason) : 'не завершено');
      }
      console.log(`   ${def.name} [${diff}]: ` + log.join(' | '));
      assert.ok(wins >= RUNS - Math.ceil(RUNS / 6), `бот должен стабильно выигрывать (${wins}/${RUNS})`);
    });
  });
}

test('доклад корректировщика: знаки отклонений', () => {
  const game = createGame({ storage: unlockAll() });
  game.setDifficulty(0); game.startMission(0); game.begin(); tick(game, 8);
  const s = game.state, t = s.targets[0], bat = s.mission.battery;
  const dx = t.x - bat.x, dy = t.y - bat.y, rng = Math.hypot(dx, dy), brg = norm(Math.atan2(dx, dy) / RAD);
  const fireAt = (r, b) => {
    game.elevate(-s.turret.elevation); game.openBreech(); waitBreech(game); game.hoistShell('he'); waitBreech(game); game.ramShell(); waitBreech(game);
    const ch = [1, 2, 3, 4, 5, 6].find((n) => r <= chargeRange(n).max - 0.3 && r >= chargeRange(n).min);
    for (let i = 0; i < ch; i++) { game.addCharge(); waitBreech(game); }
    game.closeBreech(); waitBreech(game);
    game.setBrake(false); let d = norm(b - s.turret.bearing); if (d > 180) d -= 360; game.rotateTurret(d); game.setBrake(true);
    game.elevate(solve(r, ch).elevation - s.turret.elevation); game.arm(true); assert.ok(game.fire().ok);
    let g = 0; while (s.flight.length && g++ < 5000) game.update(0.05);
    return s.lastReport;
  };
  let rep = fireAt(rng + 0.5, brg + 1);   // дальше и правее
  assert.ok(rep.over > 350 && rep.over < 650, 'перелёт ' + rep.over);
  assert.ok(rep.right > 0, 'вправо ' + rep.right);
  assert.match(rep.text, /перелёт/); assert.match(rep.text, /вправо/); assert.match(rep.text, /Поправка: дальность −/);
  rep = fireAt(rng - 0.4, brg - 1);
  assert.ok(rep.over < -250 && rep.right < 0);
  assert.match(rep.text, /недолёт/); assert.match(rep.text, /влево/);
});


test('ветер: вычислитель даёт поправки, с ними снаряд ложится в цель', () => {
  const game = createGame({ storage: unlockAll() });
  game.setDifficulty(1); game.startMission(7); game.begin();
  const s = game.state;
  for (let i = 0; i < 100; i++) game.update(0.1);
  s.mission.wind = { from: 270, speed: 10 };          // западный ветер: сносит на восток
  const bat = s.mission.battery, X = bat.x + 3, Y = bat.y + 11;
  const rng = Math.hypot(X - bat.x, Y - bat.y), brg = norm(Math.atan2(X - bat.x, Y - bat.y) / RAD);
  const t = s.targets[0]; game.selectTarget(t.id);
  game.setAlidade({ bearing: brg, range: rng }); game.recordMeasurement();
  game.setComputerRange(rng); game.setComputerCharge(5);
  const res = game.compute();
  assert.ok(res.ok);
  assert.ok(res.windBearing < -0.3, 'доворот против сноса влево: ' + res.windBearing);
  const shootAt = (b) => {
    game.elevate(-s.turret.elevation); game.openBreech(); waitBreech(game); game.hoistShell('he'); waitBreech(game); game.ramShell(); waitBreech(game);
    for (let i = 0; i < 5; i++) { game.addCharge(); waitBreech(game); }
    game.closeBreech(); waitBreech(game);
    game.setBrake(false); let d = norm(b - s.turret.bearing); if (d > 180) d -= 360; game.rotateTurret(d); game.setBrake(true);
    game.elevate(res.elevation - s.turret.elevation); game.arm(true);
    const n0 = s.impacts.length; assert.ok(game.fire().ok);
    let g = 0; while (s.impacts.length === n0 && g++ < 5000) game.update(0.05);
    const im = s.impacts[s.impacts.length - 1]; return Math.hypot(im.x - X, im.y - Y) * 1000;
  };
  const missNo = shootAt(brg);              // без поправки пеленга
  const missYes = shootAt(brg + res.windBearing);
  assert.ok(missNo > 100, 'без поправки промах заметный: ' + missNo.toFixed(0));
  assert.ok(missYes < 60, 'с поправкой близко: ' + missYes.toFixed(0));
});

test('планшет: ось алидады на постах, линии, запись только от батареи', () => {
  const game = createGame({ storage: unlockAll() });
  game.setDifficulty(1); game.startMission(8); game.begin();
  const s = game.state;
  for (let i = 0; i < 300 && !s.targets.some((t) => t.reported); i++) game.update(0.1);
  assert.equal(game.pivots().length, 3);
  assert.ok(game.setPivot(1).ok);
  game.setAlidade({ bearing: 12.3 }); game.drawLine();
  game.setPivot(2); game.setAlidade({ bearing: 340 }); game.drawLine();
  assert.equal(s.plot.lines.length, 2);
  assert.equal(s.plot.lines[0].from, 'ЗВ-1');
  assert.equal(game.recordMeasurement().ok, false, 'запись не от батареи запрещена');
  game.setPivot(0); assert.ok(game.recordMeasurement().ok);
  game.clearLines(); assert.equal(s.plot.lines.length, 0);
  assert.equal(game.setPivot(5).ok, false);
});

test('повреждения, ремонт, очередь, рекорды', () => {
  const store = unlockAll();
  const game = createGame({ storage: store });
  game.startMission(0); game.begin();
  const s = game.state;
  for (let i = 0; i < 80; i++) game.update(0.1);
  s.faults.drive = true;
  game.setBrake(false);
  assert.equal(game.rotateTurret(5, { power: true }).ok, false, 'привод не работает');
  assert.ok(game.rotateTurret(0.5).ok, 'маховик работает');
  assert.ok(game.repair('drive').ok); assert.equal(game.repair('drive').ok, false, 'бригада занята');
  for (let i = 0; i < 260; i++) game.update(0.1);
  assert.equal(s.faults.drive, false); assert.equal(s.repair, null);
  assert.equal(game.repair('hoist').ok, false, 'исправное не чинят');
  game.setBrake(true);
  // очередь из трёх
  game.setBurst(3);
  game.elevate(-s.turret.elevation); game.openBreech(); waitBreech(game); game.hoistShell('he'); waitBreech(game); game.ramShell(); waitBreech(game);
  game.addCharge(); waitBreech(game); game.addCharge(); waitBreech(game); game.closeBreech(); waitBreech(game);
  game.elevate(20); game.arm(true);
  const he0 = s.shells.he;
  assert.ok(game.fire().ok);
  for (let i = 0; i < 400 && s.shots < 3; i++) game.update(0.1);
  assert.equal(s.shots, 3, 'очередь — три выстрела');
  assert.equal(s.shells.he, he0 - 2);
  assert.equal(s.fire.burstLeft, 0);
});

test('рекорд задания сохраняется и улучшается', () => {
  const mem = {};
  const st = { get: (k) => mem[k] || JSON.stringify({ unlocked: 99, stars: [], difficulty: 0 }), set: (k, v) => { mem[k] = v; } };
  let rec = null;
  const g1 = createGame({ storage: st }); g1.on('missionEnd', (e) => { rec = e.record; });
  g1.startMission(0); g1.begin();
  for (let i = 0; i < 80; i++) g1.update(0.1);
  const t = g1.state.targets[0]; engage(g1, t, null);
  for (let i = 0; i < 80; i++) g1.update(0.1);
  assert.ok(rec && rec.isNew && rec.best.shots === 1);
  const g2 = createGame({ storage: st });
  assert.equal(g2.save.records[0].shots, 1, 'рекорд пережил перезапуск');
});

// ======================= НОВЫЕ ВОЗМОЖНОСТИ =======================
const start = (idx, patch, diff = 0, storage) => {
  const game = createGame({ storage: storage || unlockAll() });
  game.setDifficulty(diff);
  assert.ok(game.startMission(idx).ok);
  if (patch) patch(game.state);
  game.begin();
  return game;
};

test('снаряды: осветительный и дымовой не наносят урона, создают свет и завесу', () => {
  const game = start(1, (s) => { Object.assign(s.shells, { illum: 2, smoke: 3 }); });
  const s = game.state, bat = s.mission.battery; tick(game, 12);
  assert.deepEqual(Object.keys(game.SHELLS), ['he', 'ap', 'illum', 'smoke', 'shrap']);
  assert.equal(s.shells.shrap, 0, 'нет в описании — 0');
  const t = s.targets[0], hp = t.hp;
  fireQuiet(game, 'illum', t.x, t.y, t);
  assert.equal(s.lights.length, 1); assert.equal(t.hp, hp); assert.ok(t.alive);
  const L = s.lights[0];
  assert.ok(Math.abs(L.until - s.time - 60) < 1 && Math.hypot(L.x - t.x, L.y - t.y) < 0.05);
  assert.ok(game.lit(t.x + 1.4, t.y)); assert.equal(game.lit(t.x + 1.7, t.y), false);
  assert.match(s.lastReport.text, /Осветительный/); assert.equal(s.lastReport.observed, false);
  // дым: в 2.5 км по пеленгу 10° — завеса; в 6 км — нет
  fireQuiet(game, 'smoke', bat.x + 2.5 * Math.sin(10 * RAD), bat.y + 2.5 * Math.cos(10 * RAD));
  assert.equal(s.smokes.length, 1);
  assert.ok(Math.abs(s.smokes[0].bearing - 10) < 0.3 && Math.abs(s.smokes[0].until - s.time - 60) < 1);
  fireQuiet(game, 'smoke', bat.x, bat.y + 6);
  assert.equal(s.smokes.length, 1, 'далёкий дым завесы не даёт');
  assert.match(s.lastReport.text, /слишком далеко/);
  tick(game, 62);
  assert.equal(s.lights.length, 0); assert.equal(s.smokes.length, 0);
  assert.equal(s.history.length, 3); assert.ok(s.targets.every((q) => q.alive && q.hp === q.maxHp));
});

test('дым: орудия за завесой попадают заметно реже', () => {
  const run = (withSmoke) => {
    const game = start(2, null, 1); const s = game.state; tick(game, 12);
    const g = s.targets.find((q) => q.gun), bat = s.mission.battery;
    g.gun.period = 1; g.gun.p = 0.5; g.gun.next = 0;
    if (withSmoke) {
      const b = norm(Math.atan2(g.x - bat.x, g.y - bat.y) / RAD + 20);
      s.smokes.push({ x: bat.x, y: bat.y + 2, bearing: b, until: 1e9 });
      assert.equal(game.smoked(g.id), true);
    } else assert.equal(game.smoked(g.id), false);
    let hits = 0; game.on('batteryHit', (e) => { if (e.damage > 0) hits++; });
    for (let i = 0; i < 4000 && s.phase === 'playing'; i++) { s.integrity = 100; game.update(0.1); }
    return hits;
  };
  const plain = run(false), smoked = run(true);
  assert.ok(plain > 100 && smoked < plain * 0.65, `без дыма ${plain}, с дымом ${smoked}`);
});

test('шрапнель: десант — в тройном радиусе, прочее — только прямым, броню не берёт', () => {
  // десант
  let game = start(4, (s) => { s.shells.shrap = 4; }); let s = game.state; noWind(game); tick(game, 12);
  const boat = s.targets[0]; boat.speed = 0;
  fireQuiet(game, 'shrap', boat.x + boat.radius * 2.5, boat.y, boat);
  assert.equal(boat.alive, false, 'катера выкошены в 2.5 радиуса');
  // баржа: рядом — ничего, прямое — 1
  game = start(1, (st) => { st.shells.shrap = 4; }); s = game.state; tick(game, 12);
  const depot = s.targets[1]; depot.hp = depot.maxHp = 2;
  fireQuiet(game, 'shrap', depot.x + depot.radius * 1.5, depot.y, depot);
  assert.equal(depot.hp, 2, 'близкий разрыв шрапнели постройке не вредит');
  fireQuiet(game, 'shrap', depot.x, depot.y, depot);
  assert.equal(depot.hp, 1, 'прямое попадание — урон 1');
  // броня + проверка конца боя: остались только бесполезные снаряды
  let end = null;
  game = start(2, (st) => { Object.assign(st.shells, { he: 0, ap: 0, shrap: 2, illum: 1, smoke: 0 }); }); s = game.state;
  game.on('missionEnd', (e) => { end = e; }); tick(game, 12);
  const bunker = s.targets.find((q) => q.armored), soft = s.targets.find((q) => !q.armored);
  fireQuiet(game, 'shrap', bunker.x, bunker.y, bunker);
  assert.equal(bunker.hp, bunker.maxHp); assert.match(s.lastReport.text, /броня не пробита/);
  tick(game, 4); assert.equal(s.phase, 'playing', 'шрапнель ещё может достать склад');
  soft.alive = false; soft.hp = 0;
  game.elevate(-s.turret.elevation); assert.ok(game.openBreech().ok); waitBreech(game); tick(game, 4);
  assert.equal(s.phase, 'lost', 'шрапнель и свет ДОТу не страшны — боезапас считается израсходованным');
  assert.match(end.reason, /Боезапас/);
});

test('ночь: квадрат → свет → точное донесение; без света корректировщик слеп', () => {
  const game = start(1, (s) => { s.mission.night = true; s.shells.illum = 3; });
  const s = game.state; const areaEv = []; game.on('area', (e) => areaEv.push(e));
  tick(game, 14);
  assert.equal(s.mission.areas.length, 2); assert.equal(areaEv.length, 2);
  for (const t of s.targets) {
    assert.equal(t.reported, null, 'ночью разведка сама цель не сообщает');
    const a = s.mission.areas.find((q) => q.targetId === t.id);
    assert.ok(a.x1 - a.x0 === 2 && a.y1 - a.y0 === 2 && a.x0 % 2 === 0 && a.y0 % 2 === 0);
    assert.ok(t.x >= a.x0 && t.x <= a.x1 && t.y >= a.y0 && t.y <= a.y1, 'цель внутри квадрата');
    assert.deepEqual(t.area, { x0: a.x0, y0: a.y0, x1: a.x1, y1: a.y1 });
  }
  assert.ok(s.radio.some((m) => /в квадрате X \d\d–\d\d, Y \d\d–\d\d/.test(m.text)));
  assert.ok(s.activeTarget != null, 'цель с квадратом можно выбрать');
  const t = s.targets[0], c = game.predict(t.id);
  assert.ok(c.area && c.x === (t.area.x0 + t.area.x1) / 2);
  // фугас вслепую: доклада об отклонении нет
  fireQuiet(game, 'he', c.x + 0.9, c.y + 0.9, t);
  if (t.alive) { assert.equal(s.lastReport.dark, true); assert.equal(s.lastReport.observed, false); assert.match(s.lastReport.text, /не освещена/); }
  // свет
  fireQuiet(game, 'illum', c.x, c.y, t);
  assert.equal(t.lit, true); assert.ok(t.reported && !t.reported.rough);
  assert.equal(t.reported.x, t.x); assert.equal(t.reported.y, t.y);
  assert.ok(s.radio.some((m) => m.from === 'РАЗВЕДКА' && m.text.startsWith(t.label)));
  const rep = { ...t.reported };
  tick(game, 62);
  assert.equal(t.lit, false); assert.deepEqual(t.reported, rep, 'свет погас — последнее донесение осталось');
});

test('ночь: цель выдаёт себя вспышкой — грубое донесение до 0,5 км', () => {
  const game = start(2, (s) => { s.mission.night = true; }, 1);
  const s = game.state, g = s.targets.find((q) => q.gun);
  tick(game, 14); assert.equal(g.reported, null);
  g.gun.next = s.time + 1; tick(game, 2);
  const r = g.reported;
  assert.ok(r && r.rough === true, 'донесение по вспышке');
  assert.ok(r.x * 2 === Math.round(r.x * 2) && r.y * 2 === Math.round(r.y * 2), 'округлено до 0.5 км');
  assert.ok(Math.abs(r.x - g.x) <= 0.2501 && Math.abs(r.y - g.y) <= 0.2501);
  assert.ok(s.radio.some((m) => /По вспышке/.test(m.text)));
  // свет заменяет грубое донесение точным
  s.lights.push({ x: g.x, y: g.y, until: s.time + 60 }); tick(game, 0.2);
  assert.ok(!g.reported.rough && g.reported.x === g.x);
});

test('вилка: два снаряда, два разрыва, один доклад', () => {
  const game = start(0); const s = game.state, bat = s.mission.battery; tick(game, 8);
  const t = s.targets[0], L = Math.hypot(t.x - bat.x, t.y - bat.y), ux = (t.x - bat.x) / L, uy = (t.y - bat.y) / L;
  assert.ok(game.setSalvo(true).ok); assert.equal(s.fire.salvo, true);
  const he0 = s.shells.he, radio0 = s.radio.filter((m) => m.from === 'КОРРЕКТИРОВЩИК').length;
  const events = []; game.on('impact', (e) => events.push(e));
  // цель между разрывами по дальности, но в 300 м левее точки прицеливания
  const f = fireQuiet(game, 'he', t.x + uy * 0.3, t.y - ux * 0.3, t);
  assert.equal(f.salvo, true);
  assert.equal(s.shells.he, he0 - 2); assert.equal(s.shots, 2); assert.equal(s.impacts.length, 2);
  const [a, b] = s.impacts;
  assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 0.3) < 0.02, 'разнос ±0.15 км');
  assert.equal(a.pair, b.n); assert.equal(b.pair, a.n);
  assert.equal(s.history[0].pair, 2); assert.equal(s.history[1].pair, 1);
  assert.equal(s.lastReport.bracket, true);
  assert.match(s.lastReport.text, /ВИЛКА! Цель между разрывами, вправо 300/);
  assert.match(s.lastReport.text, /Поправка/);
  assert.equal(s.radio.filter((m) => m.from === 'КОРРЕКТИРОВЩИК').length, radio0 + 1, 'доклад один');
  assert.equal(events.length, 2); assert.equal(events[0].report, null); assert.ok(events[1].report);
  assert.equal(s.history[0].reportText, s.history[1].reportText);
  // оба с перелётом — обычный доклад по ближнему
  fireQuiet(game, 'he', t.x + ux * 0.5, t.y + uy * 0.5, t);
  assert.equal(s.lastReport.bracket, false); assert.match(s.lastReport.text, /перелёт 350/);
  // нет второго снаряда — одиночный выстрел и сообщение
  s.shells.he = 1; s.shells.ap = 1;      // ББ в погребе — чтобы бой не кончился «без боезапаса»
  const f2 = fireQuiet(game, 'he', t.x + ux * 0.5, t.y + uy * 0.5, t);
  assert.equal(f2.salvo, false); assert.equal(s.shots, 5);
  assert.ok(s.radio.some((m) => /Вилка невозможна/.test(m.text)));
  // вилка + очередь: каждый выстрел очереди — пара
  s.shells.he = 6; game.setBurst(2);
  fireQuiet(game, 'he', t.x + ux * 0.5, t.y + uy * 0.5, t);
  for (let i = 0; i < 1200 && (s.flight.length || s.breech.busy); i++) game.update(0.1);
  assert.equal(s.shots, 9); assert.equal(s.shells.he, 2);
  game.setSalvo(false); assert.equal(s.fire.salvo, false);
});

test('звания: опыт копится и сохраняется, расчёт работает быстрее', () => {
  const mem = { 'arta2.save': JSON.stringify({ unlocked: 99, stars: [], difficulty: 0, xp: 250 }) };
  const st = { get: (k) => mem[k], set: (k, v) => { mem[k] = v; } };
  const g1 = createGame({ storage: st }); let end = null; g1.on('missionEnd', (e) => { end = e; });
  assert.deepEqual(g1.rank(), { index: 0, name: 'МАТРОС', xp: 250, next: 300, bonus: 0 });
  assert.equal(g1.ranks.length, 6);
  g1.startMission(0); g1.begin(); tick(g1, 8);
  g1.openBreech(); assert.ok(Math.abs(g1.state.breech.busy.dur - 1.2) < 1e-9); waitBreech(g1); g1.closeBreech(); waitBreech(g1);
  const corr = {};
  for (let i = 0; i < 8 && g1.state.phase === 'playing'; i++) { botStep(g1, corr); tick(g1, 3); }
  assert.ok(end && end.won);
  assert.equal(end.xpGained, end.stars * 100 + 20);
  assert.equal(end.rank.xp, 250 + end.xpGained); assert.equal(end.rankUp, true); assert.equal(end.rank.name, 'СТАРШИНА');
  assert.equal(JSON.parse(mem['arta2.save']).xp, 250 + end.xpGained, 'опыт сохранён');
  mem['arta2.save'] = JSON.stringify({ unlocked: 99, stars: [], difficulty: 0, xp: 1700 });
  const g2 = createGame({ storage: st });
  assert.deepEqual(g2.rank(), { index: 3, name: 'ЛЕЙТЕНАНТ', xp: 1700, next: 2800, bonus: 0.15 });
  g2.startMission(0); g2.begin(); tick(g2, 8);
  g2.openBreech(); assert.ok(Math.abs(g2.state.breech.busy.dur - 1.2 * 0.85) < 1e-9, 'затвор быстрее на 15%');
  g2.state.faults.lights = true; g2.repair('lights');
  assert.ok(Math.abs(g2.state.repair.dur - 25 * 0.85) < 1e-9, 'ремонт быстрее на 15%');
  mem['arta2.save'] = JSON.stringify({ xp: 99999 });
  assert.deepEqual(createGame({ storage: st }).rank(), { index: 5, name: 'КАПИТАН 3 РАНГА', xp: 99999, next: null, bonus: 0.25 });
});

test('оборона: волны, пополнение, прорывы, поражение только при нулевой прочности, рекорд', () => {
  const mem = {}; const st = { get: (k) => mem[k], set: (k, v) => { mem[k] = v; } };
  const game = createGame({ storage: st }); let end = null; game.on('missionEnd', (e) => { end = e; });
  const waves = []; game.on('wave', (e) => waves.push(e));
  assert.ok(game.startSurvival().ok); assert.equal(game.state.phase, 'briefing');
  game.begin();
  const s = game.state;
  assert.equal(s.mission.survival, true); assert.equal(s.mission.night, false); assert.equal(s.wave, 1);
  assert.ok(s.targets.length >= 2 && s.targets.length <= 4);
  tick(game, 30);
  // волна 1: одну цель сбиваем по-настоящему, остальные «снимаем»
  const corr = {};
  for (let i = 0; i < 6 && s.kills === 0 && s.phase === 'playing'; i++) botStep(game, corr);
  assert.ok(s.kills >= 1, 'бот уничтожил цель');
  const ids1 = s.targets.map((t) => t.id), maxId = Math.max(...ids1);
  s.integrity = 50; const before = { ...s.shells };
  s.targets.forEach((t) => { t.alive = false; });
  tick(game, 0.3);
  assert.equal(s.integrity, 75, '+25 прочности');
  assert.deepEqual(s.shells, { he: before.he + 6, ap: before.ap + 3, illum: before.illum + 1, smoke: before.smoke + 1, shrap: before.shrap + 1 });
  assert.equal(s.phase, 'playing'); assert.equal(s.wave, 1);
  s.integrity = 90; tick(game, 0.3); assert.equal(s.integrity, 90, 'награда за волну — один раз');
  tick(game, 11);
  assert.equal(s.wave, 2);
  assert.ok(s.targets.length >= 2 && s.targets.every((t) => t.id > maxId && t.alive), 'новые цели, id растут');
  assert.ok(s.mission.wind.speed > 0, 'со второй волны — ветер');
  assert.deepEqual(waves.map((w) => [w.wave, w.cleared]), [[1, true], [2, false]]);
  // прорыв: цель ушла — минус 25, но бой продолжается
  tick(game, 60);
  const esc = (t) => { Object.assign(t, { active: true, moving: true, speed: 10, end: 'escape', pathLeft: 0, gun: null }); };
  s.integrity = 60; esc(s.targets[0]); tick(game, 0.2);
  assert.equal(s.integrity, 35); assert.equal(s.phase, 'playing'); assert.equal(s.targets[0].escaped, true);
  // прочность кончилась — поражение
  s.integrity = 20; esc(s.targets[1]); tick(game, 0.2);
  assert.equal(s.phase, 'lost'); assert.ok(end && !end.won);
  assert.equal(end.survival.waves, 1); assert.equal(end.survival.kills, s.kills); assert.equal(end.survival.isNew, true);
  assert.equal(end.xpGained, 50);
  const saved = JSON.parse(mem['arta2.save']);
  assert.deepEqual(saved.survivalBest, { waves: 1, kills: s.kills }); assert.equal(saved.xp, 50);
  assert.deepEqual(createGame({ storage: st }).save.survivalBest, { waves: 1, kills: s.kills });
});

test('оборона: бот держится несколько волн без сбоев', () => {
  for (let diff = 0; diff <= 1; diff++) {
    const game = createGame({ storage: unlockAll() }); game.setDifficulty(diff);
    game.startSurvival(); game.begin();
    const s = game.state, corr = {}; let guard = 0;
    while (s.phase === 'playing' && s.wave < 4 && s.time < 2500 && guard++ < 400) { if (!botStep(game, corr)) tick(game, 3); else tick(game, 0.5); }
    console.log(`   оборона [${diff}]: волна ${s.wave}, уничтожено ${s.kills}, прочность ${Math.round(s.integrity)}, t=${Math.round(s.time)}`);
    assert.ok(s.wave >= 2, 'первая волна отбита');
    assert.equal(new Set(Object.keys(s.tracks)).size, Object.keys(s.tracks).length);
  }
});

test('туман: координаты до 0,1 км, разведка вдвое реже, отклонения до 50 м', () => {
  const game = start(3, (s) => { s.mission.weather = 'fog'; }, 0);
  const s = game.state; noWind(game); tick(game, 14);
  assert.ok(s.radio.some((m) => m.from === 'МЕТЕО' && /Туман/.test(m.text)));
  for (const t of s.targets) {
    const r = t.reported;
    assert.ok(Math.abs(r.x * 10 - Math.round(r.x * 10)) < 1e-9 && Math.abs(r.y * 10 - Math.round(r.y * 10)) < 1e-9, 'до 0.1 км');
    assert.ok(Math.abs(t.nextRecon - r.time - 60) < 1e-9, 'интервал разведки ×2 (30 → 60 с)');
  }
  const barge = s.targets[1], bat = s.mission.battery;
  const L = Math.hypot(barge.x - bat.x, barge.y - bat.y), ux = (barge.x - bat.x) / L, uy = (barge.y - bat.y) / L;
  fireQuiet(game, 'he', barge.x + ux * 0.43 + uy * 0.18, barge.y + uy * 0.43 - ux * 0.18, barge);
  const rep = s.lastReport;
  assert.equal(rep.over, 450); assert.equal(rep.right, 200);
  assert.match(rep.text, /перелёт 450, вправо 200/);
});

test('шторм: ветер меняется, расчёт устаревает', () => {
  const game = start(3, (s) => { s.mission.weather = 'storm'; }, 1);
  const s = game.state; const winds = []; game.on('wind', (e) => winds.push(e));
  tick(game, 10);
  const w0 = { ...s.mission.wind };
  game.setComputerRange(9); game.setComputerCharge(3); assert.ok(game.compute().ok);
  assert.equal(s.computer.stale, false);
  tick(game, 69); assert.equal(winds.length, 0, 'раньше 80 с ветер не меняется');
  tick(game, 33);
  assert.equal(winds.length, 1); assert.equal(s.computer.stale, true); assert.equal(s.checklist.computed, false);
  const w = s.mission.wind;
  assert.ok(w.speed >= 2 && w.speed <= 14 && Math.abs(w.speed - w0.speed) <= 3);
  let d = Math.abs(w.from - w0.from); if (d > 180) d = 360 - d; assert.ok(d <= 40);
  assert.ok(s.radio.some((m) => m.from === 'МЕТЕО' && /Ветер меняется/.test(m.text)));
  assert.ok(game.compute().ok); assert.equal(s.computer.stale, false);
  tick(game, 115); assert.equal(winds.length, 2, 'и снова через 80–110 с');
});

test('журнал боя: все выстрелы и следы целей', () => {
  const game = start(3, null, 0); const s = game.state; let end = null; game.on('missionEnd', (e) => { end = e; });
  tick(game, 14);
  game.setSalvo(true);
  const corr = {};
  for (let i = 0; i < 40 && s.phase === 'playing'; i++) { if (i === 2) game.setSalvo(false); if (!botStep(game, corr)) tick(game, 3); else tick(game, 0.5); }
  tick(game, 5);
  assert.ok(end, 'бой окончен');
  assert.equal(end.history, s.history); assert.equal(end.tracks, s.tracks);
  assert.equal(s.history.length, s.shots); assert.equal(end.stats.shots, s.shots);
  s.history.forEach((h, i) => {
    assert.equal(h.n, i + 1);
    for (const k of ['time', 'charges', 'bearing', 'elevation', 'x', 'y']) assert.equal(typeof h[k], 'number', k);
    assert.ok(['he', 'ap', 'illum', 'smoke', 'shrap'].includes(h.shell)); assert.equal(typeof h.hit, 'boolean');
    assert.ok('targetId' in h && 'reportText' in h && 'pair' in h);
    if (h.pair != null) assert.equal(s.history[h.pair - 1].pair, h.n);
  });
  assert.ok(s.history.some((h) => h.pair != null) && s.history.some((h) => h.hit && h.reportText));
  for (const t of s.targets) {
    const tr = s.tracks[t.id];
    assert.ok(tr && tr.length >= 2, 'след цели ' + t.id);
    assert.ok(tr.every((p, i) => typeof p.x === 'number' && (i === 0 || p.t >= tr[i - 1].t)));
    if (t.moving) {
      assert.ok(tr.length >= 3);
      for (let i = 1; i < tr.length - 1; i++) assert.ok(tr[i].t - tr[i - 1].t <= 10.5, 'шаг следа ~10 с');
      assert.ok(Math.hypot(tr[tr.length - 1].x - tr[0].x, tr[tr.length - 1].y - tr[0].y) > 0.05);
    }
    const last = tr[tr.length - 1];
    assert.ok(Math.hypot(last.x - t.x, last.y - t.y) < 0.02, 'последняя точка — где цель погибла');
  }
});

test('сохранение прежней версии (24 задания пройдены, новых полей нет): открыта Часть IV, опыт 0', () => {
  const old = { unlocked: 24, stars: Array(24).fill(2), records: [], difficulty: 1, muted: true };
  const mem = { 'arta2.save': JSON.stringify(old) };
  const game = createGame({ storage: { get: (k) => mem[k] || null, set: (k, v) => { mem[k] = v; } } });
  assert.equal(game.save.unlocked, 25);
  assert.equal(game.save.xp, 0);
  assert.equal(game.save.survivalBest, null);
  assert.equal(game.rank().index, 0);
  assert.equal(game.startMission(24).ok, true);
  assert.equal(game.startMission(25).ok, false);
});

test('«вилка» в журнале: текст о попадании — только у попавшего снаряда пары', () => {
  const game = createGame({ storage: null });
  game.save.unlocked = 30;
  game.startMission(0); game.begin();
  for (let i = 0; i < 200; i++) game.update(0.1);
  const s = game.state, t = s.targets[0], bat = s.mission.battery;
  // цель — ровно под ближним снарядом пары: дальний ложится в 300 м за ней
  const dx = t.x - bat.x, dy = t.y - bat.y, range = Math.hypot(dx, dy) + 0.15, brg = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
  game.setComputerRange(range); game.setComputerCharge(game.chargeStates().indexOf('ok') + 1);
  const sol = game.compute();
  const wait = () => { for (let i = 0; i < 400 && s.breech.busy; i++) game.update(0.1); };
  game.openBreech(); wait(); game.hoistShell('he'); wait(); game.ramShell(); wait();
  for (let i = 0; i < s.computer.charge; i++) { game.addCharge(); wait(); }
  game.closeBreech(); wait();
  game.setBrake(false); game.rotateTurret(brg + s.computer.windBearing - s.turret.bearing); game.setBrake(true);
  game.elevate(sol.elevation - s.turret.elevation);
  game.setSalvo(true); game.arm(true);
  assert.equal(game.fire().ok, true);
  const hist = s.history;
  for (let i = 0; i < 800 && hist[0].x == null; i++) game.update(0.1);
  assert.equal(hist.length, 2);
  assert.equal(hist[0].pair, 2); assert.equal(hist[1].pair, 1);
  for (const h of hist) { if (!h.hit) assert.ok(!/уничтожена|Попадание/.test(h.reportText || ''), 'у промахнувшегося снаряда нет текста о попадании: ' + h.reportText); }
});
