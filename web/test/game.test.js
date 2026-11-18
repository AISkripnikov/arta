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

/** Бот проходит полную процедуру выстрела по донесениям разведки. */
function engage(game, t, corr) {
  const s = game.state, bat = s.mission.battery;
  // 1. зарядить (ствол на угол заряжания)
  game.elevate(-s.turret.elevation);
  assert.ok(game.openBreech().ok); waitBreech(game);
  const type = t.armored ? 'ap' : (s.shells.he > 0 ? 'he' : 'ap');
  assert.ok(game.hoistShell(type).ok, 'hoist'); waitBreech(game);
  assert.ok(game.ramShell().ok); waitBreech(game);
  // 2. замер с упреждением: два приближения по времени полёта
  let tof = 30, sol, charge, brg, rng;
  for (let i = 0; i < 4; i++) {
    const lead = t.moving ? tof + 12 : 0;
    const p = t.reported.sound ? intersect(t.reported.sound) : game.predict(t.id, lead);
    const dx = p.x - bat.x + (corr ? corr.dx : 0), dy = p.y - bat.y + (corr ? corr.dy : 0);
    rng = Math.hypot(dx, dy); brg = norm(Math.atan2(dx, dy) / RAD);
    charge = [1, 2, 3, 4, 5, 6].find((n) => { const l = chargeRange(n); return rng >= l.min && rng <= l.max - 0.3; });
    assert.ok(charge, 'нет заряда для дальности ' + rng);
    sol = solve(rng, charge); tof = sol.tof;
  }
  game.selectTarget(t.id);
  const pinAt = t.reported.sound ? intersect(t.reported.sound) : t.reported;
  game.setPin(t.id, pinAt.x, pinAt.y);
  game.setAlidade({ bearing: brg, range: rng });
  assert.ok(game.recordMeasurement().ok);
  game.setComputerRange(rng); game.setComputerCharge(charge);
  const res = game.compute(); assert.ok(res.ok, 'compute');
  for (let i = 0; i < charge; i++) { assert.ok(game.addCharge().ok); waitBreech(game); }
  assert.ok(game.closeBreech().ok); waitBreech(game);
  // 3. наводка
  game.setBrake(false);
  let d = norm(brg + res.windBearing - s.turret.bearing); if (d > 180) d -= 360;
  assert.ok(game.rotateTurret(d).ok);
  game.setBrake(true);
  game.elevate(res.elevation - s.turret.elevation);
  assert.ok(Math.abs(s.turret.elevation - res.elevation) < 0.011);
  // 4. дождаться расчётного момента и выстрелить
  if (t.moving) { /* подготовка заняла время; остаток до 12 с дожидаемся */ }
  game.arm(true);
  const f = game.fire(); assert.ok(f.ok, 'fire: ' + f.reason);
  const shots = s.shots;
  let guard = 0;
  while (s.flight.length && s.phase === 'playing' && guard++ < 5000) game.update(0.05);
  return shots;
}

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
      let wins = 0; const RUNS = 6, log = [];
      for (let run = 0; run < RUNS; run++) {
        const game = createGame({ storage: unlockAll() });
        game.setDifficulty(diff);
        assert.ok(game.startMission(idx).ok); game.begin();
        const s = game.state; let end = null; game.on('missionEnd', (e) => { end = e; });
        for (let i = 0; i < 60 && !s.targets.some((t) => t.reported); i++) tick(game, 1);
        assert.ok(s.targets.some((t) => t.reported), 'есть донесения');
        const corr = {};
        let guard = 0;
        while (s.phase === 'playing' && guard++ < 60) {
          // сначала те, кто стреляет и убегает
          const t = s.targets.filter((x) => x.alive && x.reported && !x.moved).sort((a, b) => (b.end === 'land' || b.end === 'escape' || b.end === 'dive' ? 3 : b.spotter ? 2 : b.gun ? 1 : 0) - (a.end === 'land' || a.end === 'escape' || a.end === 'dive' ? 3 : a.spotter ? 2 : a.gun ? 1 : 0))[0];
          if (!t) { tick(game, 3); guard--; if (s.time > 1500) break; continue; }
          const c = corr[t.id] || (corr[t.id] = { dx: 0, dy: 0, key: null });
          const key = JSON.stringify(t.reported.sound || [t.reported.x, t.reported.y]);
          if (c.key !== key || t.moving) { c.dx = 0; c.dy = 0; c.key = key; }   // новая засечка — поправки сначала
          engage(game, t, c);
          // поправка по докладу корректировщика (как сделал бы игрок)
          const rep = s.lastReport;
          if (rep && rep.targetId === t.id && t.alive && !t.moving && rep.observed) {
            const bat = s.mission.battery, L = Math.hypot(t.x - bat.x, t.y - bat.y), ux = (t.x - bat.x) / L, uy = (t.y - bat.y) / L;
            c.dx -= (rep.over * ux + rep.right * uy) / 1000;
            c.dy -= (rep.over * uy - rep.right * ux) / 1000;
          }
          tick(game, 0.5);
        }
        tick(game, 5);
        if (end && end.won) wins++;
        log.push(end ? (end.won ? `победа ★${end.stars} выстр.${end.stats.shots}/${end.stats.par} проч.${end.stats.integrity} t=${Math.round(end.stats.time)}` : 'поражение: ' + end.reason) : 'не завершено');
      }
      console.log(`   ${def.name} [${diff}]: ` + log.join(' | '));
      assert.ok(wins >= RUNS - 1, `бот должен стабильно выигрывать (${wins}/${RUNS})`);
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
