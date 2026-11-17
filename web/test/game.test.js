import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/game/index.js';
import { solve, chargeRange, shoot } from '../src/game/ballistics.js';
import { CAMPAIGN, makeMap, isLand } from '../src/game/missions.js';

const RAD = Math.PI / 180;
const norm = (a) => ((a % 360) + 360) % 360;
function tick(game, seconds, step = 0.1) { for (let t = 0; t < seconds && game.state.phase === 'playing'; t += step) game.update(step); }
function waitBreech(game) { let n = 0; while (game.state.breech.busy && n++ < 1000) game.update(0.1); }

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
    const p = game.predict(t.id, lead);
    const dx = p.x - bat.x + (corr ? corr.dx : 0), dy = p.y - bat.y + (corr ? corr.dy : 0);
    rng = Math.hypot(dx, dy); brg = norm(Math.atan2(dx, dy) / RAD);
    charge = [1, 2, 3, 4, 5, 6].find((n) => { const l = chargeRange(n); return rng >= l.min && rng <= l.max - 0.3; });
    assert.ok(charge, 'нет заряда для дальности ' + rng);
    sol = solve(rng, charge); tof = sol.tof;
  }
  game.selectTarget(t.id);
  game.setPin(t.id, t.reported.x, t.reported.y);
  game.setAlidade({ bearing: brg, range: rng });
  assert.ok(game.recordMeasurement().ok);
  game.setComputerRange(rng); game.setComputerCharge(charge);
  const res = game.compute(); assert.ok(res.ok, 'compute');
  for (let i = 0; i < charge; i++) { assert.ok(game.addCharge().ok); waitBreech(game); }
  assert.ok(game.closeBreech().ok); waitBreech(game);
  // 3. наводка
  game.setBrake(false);
  let d = norm(brg - s.turret.bearing); if (d > 180) d -= 360;
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
        tick(game, 15);
        assert.ok(s.targets.every((t) => t.reported), 'все цели сообщены');
        let guard = 0;
        while (s.phase === 'playing' && guard++ < 40) {
          // сначала те, кто стреляет и убегает
          const t = s.targets.filter((x) => x.alive).sort((a, b) => (b.end === 'land' || b.end === 'escape' ? 2 : b.gun ? 1 : 0) - (a.end === 'land' || a.end === 'escape' ? 2 : a.gun ? 1 : 0))[0];
          if (!t) { tick(game, 3); continue; }
          engage(game, t, null);
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
