// Бот-игрок и общие помощники тестов (не тест: имя файла не *.test.js).
// Бот пользуется только тем, что знает игрок: донесения, доклады, планшет со своими, труба, зенитка.
import assert from 'node:assert/strict';
import { createGame } from '../src/game/index.js';
import { solve, chargeRange } from '../src/game/ballistics.js';

export const RAD = Math.PI / 180;
export const norm = (a) => ((a % 360) + 360) % 360;
export function tick(game, seconds, step = 0.1) { for (let t = 0; t < seconds && game.state.phase === 'playing'; t += step) game.update(step); }
export function waitBreech(game) { let n = 0; while (game.state.breech.busy && n++ < 1000) game.update(0.1); }
/** Дождаться доклада корректировщика (он приходит с задержкой). */
export function waitReport(game) { let n = 0; const s = game.state; while (s.reportDue != null && s.phase === 'playing' && n++ < 400) game.update(0.05); }
/** Навести ствол / башню: раненый или уставший наводчик крутит медленнее — доводим в несколько приёмов. */
export function elevTo(game, v) { const t = game.state.turret; for (let i = 0; i < 60 && Math.abs(t.elevation - v) > 0.005; i++) if (!game.elevate(v - t.elevation).ok) break; }
export function turnTo(game, brg) {
  const t = game.state.turret;
  for (let i = 0; i < 60; i++) {
    let d = norm(brg - t.bearing); if (d > 180) d -= 360;
    if (Math.abs(d) < 0.005) break;
    if (!game.rotateTurret(d).ok) return false;
  }
  return true;
}

/** Пересечение двух пеленгов звукометрии. */
export function intersect([a, b]) {
  const da = [Math.sin(a.bearing * RAD), Math.cos(a.bearing * RAD)], db = [Math.sin(b.bearing * RAD), Math.cos(b.bearing * RAD)];
  const den = da[0] * db[1] - da[1] * db[0];
  const k = ((b.x - a.x) * db[1] - (b.y - a.y) * db[0]) / den;
  return { x: a.x + da[0] * k, y: a.y + da[1] * k };
}

export function unlockAll() { const mem = {}; return { mem, get: (k) => mem[k] || JSON.stringify({ unlocked: 99, stars: [], difficulty: 1 }), set: (k, v) => { mem[k] = v; } }; }

/** Зенитчик: перед каждым тактом наводит автомат точно на ближайший самолёт и бьёт очередями (перегрев не допускает). */
export function autoAA(game) {
  const real = game.update, s = game.state;
  let cooling = false;
  game.update = (dt) => {
    const R = s.raid, a = s.aa;
    if (s.phase === 'playing') {
      const p = R ? R.planes.filter((q) => q.alive && !q.attacked).sort((x, y) => x.range - y.range)[0] : null;
      if (a.heat > 0.85) cooling = true; else if (a.heat < 0.45) cooling = false;
      if (p) game.aimAA({ bearing: p.bearing, elevation: p.elevation });
      const want = !!p && p.range <= game.C.AA_RANGE && !cooling && !a.jammed && a.ammo > 0;
      if (want !== a.firing) game.fireAA(want);
    }
    return real(dt);
  };
  return game;
}

/** Свой корабль окажется ближе lim км от точки p в ближайшие tof секунд? (своих игрок видит на планшете всегда) */
export function friendNear(game, p, tof, lim = 0.4) {
  return game.state.friends.some((f) => {
    if (!f.alive || f.arrived) return false;
    for (let k = 0; k <= 4; k++) {
      const d = (f.speed / 3600) * (tof + 6) * (k / 4);
      if (Math.hypot(f.x + d * Math.sin(f.heading * RAD) - p.x, f.y + d * Math.cos(f.heading * RAD) - p.y) < lim) return true;
    }
    return false;
  });
}

/** Полная процедура одного выстрела снарядом type в точку aim(tof) → {x,y}. target — цель для записи замера (или null). */
export function fireShellRaw(game, type, aim, target, opts, must) {
  const s = game.state, bat = s.mission.battery, b = s.breech;
  waitBreech(game);
  // 1. замер с упреждением: несколько приближений по времени полёта
  let tof = 30, sol, charge, brg, rng, pt;
  const measure = () => {
    for (let i = 0; i < 4; i++) {
      const p = pt = aim(tof);
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
    elevTo(game, 0);
    must(game.openBreech().ok, 'open'); waitBreech(game);
    if (b.shell && b.shell !== type) { must(game.unload().ok); waitBreech(game); }
    if (!b.shell) { must(game.hoistShell(type).ok, 'hoist ' + type); waitBreech(game); }
    if (!b.rammed) { must(game.ramShell().ok); waitBreech(game); }
    measure();      // заряжание заняло время — упреждение заново
    while (b.charges > charge) { must(game.removeCharge().ok); waitBreech(game); }
    while (b.charges < charge) { must(game.addCharge().ok); waitBreech(game); }
    must(game.closeBreech().ok); waitBreech(game);
  }
  if (opts.loadOnly) return { ok: true, charge };
  // свои рядом с точкой прицеливания — не стреляем (орудие остаётся заряженным)
  if (type !== 'illum' && type !== 'smoke' && !opts.unsafe && friendNear(game, pt, tof)) return { ok: false, blocked: true, charge };
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
    must(turnTo(game, brg + res.windBearing));
    game.setBrake(true);
    elevTo(game, res.elevation);
    must(Math.abs(s.turret.elevation - res.elevation) < 0.011, 'ствол наведён');
    if (!s.computer.stale) break;
  }
  if (!opts.noScope) game.setScope({ bearing: brg, zoom: 4 });     // труба — туда же: свой глаз увидит разрыв
  // 4. огонь и ожидание разрыва и доклада
  game.arm(true);
  const f = game.fire(); must(f.ok, 'fire: ' + f.reason);
  let guard = 0;
  while ((s.flight.length || (s.breech.busy && s.fire.burstLeft > 0)) && s.phase === 'playing' && guard++ < 8000) game.update(0.05);
  waitReport(game);
  f.charge = charge;
  return f;
}
export const ENDED = Symbol('бой окончен');
/** Бой может кончиться посреди процедуры (батарею разбили) — тогда выстрела нет, возвращаем null. */
export function fireShell(game, type, aim, target, opts = {}) {
  const s = game.state;
  const must = (cond, msg) => { if (s.phase !== 'playing') throw ENDED; assert.ok(cond, msg); };
  try { return fireShellRaw(game, type, aim, target, opts, must); } catch (e) { if (e === ENDED) return null; throw e; }
}
/** Бот: выстрел по цели по донесениям разведки (corr — накопленная поправка, км). → результат выстрела | null. */
export function engage(game, t, corr) {
  const s = game.state;
  const type = t.armored ? 'ap' : t.kind === 'landing' && s.shells.shrap > 0 ? 'shrap' : s.shells.he > 0 ? 'he' : s.shells.shrap > 0 ? 'shrap' : 'ap';
  const pinAt = t.reported.sound ? intersect(t.reported.sound) : t.reported;
  const f = fireShell(game, type, (tof) => {
    const p = t.reported.sound ? intersect(t.reported.sound) : game.predict(t.id, t.moving ? tof + 7 : 0);
    return { x: p.x + (corr ? corr.dx : 0), y: p.y + (corr ? corr.dy : 0) };
  }, t, { pin: pinAt });
  if (f && corr) { corr.charge = f.charge; corr.at = { x: pinAt.x, y: pinAt.y }; }
  return f;
}

export const PRI = (t) => (t.hunts ? 4 : t.end === 'land' || t.end === 'escape' || t.end === 'dive' ? 3 : t.spotter ? 2 : t.gun ? 1 : 0);
/** Один ход бота: осветить / задымить / выстрелить. → false, если пока нечего делать. */
export function botStep(game, corr) {
  const s = game.state, bat = s.mission.battery;
  // сначала охотники на конвой, потом те, кто убегает и стреляет
  const known = s.targets.filter((x) => x.alive && (x.reported || x.area) && !x.moved).sort((a, b) => PRI(b) - PRI(a));
  // дым: батарее досталось, а орудия противника не прикрыты
  if (s.shells.smoke > 0 && s.integrity < 75 && !s.smokes.some((q) => q.cover)) {
    const g = known.find((x) => x.gun && (x.reported || x.area));
    if (g) {
      const p = g.reported && g.reported.sound ? intersect(g.reported.sound) : game.predict(g.id, 0);
      const L = Math.hypot(p.x - bat.x, p.y - bat.y);
      fireShell(game, 'smoke', () => ({ x: bat.x + (p.x - bat.x) / L * 2.5, y: bat.y + (p.y - bat.y) / L * 2.5 }), null);
      return true;
    }
  }
  // дым для конвоя: транспорт уже подбит, охотники живы
  if (s.shells.smoke > 0 && !s.smokes.some((q) => q.convoy) && s.targets.some((x) => x.alive && x.hunts && x.active)) {
    const f = s.friends.filter((q) => q.convoy && q.alive && !q.arrived && q.hp < q.maxHp).sort((a, b) => a.hp - b.hp)[0];
    if (f) {
      fireShell(game, 'smoke', (tof) => { const d = (f.speed / 3600) * (tof + 20); return { x: f.x + d * Math.sin(f.heading * RAD), y: f.y + d * Math.cos(f.heading * RAD) }; }, null);
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
    const f = engage(game, t, c);
    if (f && f.blocked) continue;        // рядом свои — пока займёмся другой целью
    // поправка по докладу корректировщика (как сделал бы игрок)
    const rep = s.lastReport;
    if (rep && rep.targetId === t.id && t.alive) {
      const L = Math.hypot(t.x - bat.x, t.y - bat.y), ux = (t.x - bat.x) / L, uy = (t.y - bat.y) / L;
      const sl = s.scope.last;
      if (rep.dark) c.blind = true;
      else if (!t.moving && rep.observed) {
        c.dx -= (rep.over * ux + rep.right * uy) / 1000;
        c.dy -= (rep.over * uy - rep.right * ux) / 1000;
      } else if (!t.moving && sl && sl.n === s.shots && sl.targetId === t.id && sl.over) {
        // корректировщик молчит — правим по своему наблюдению в трубу: пеленг точно, дальность — шагом
        const right = sl.dBearing * RAD * L, over = sl.over * 0.12;
        c.dx -= over * ux + right * uy;
        c.dy -= over * uy - right * ux;
      }
    }
    return true;
  }
  // делать нечего, но кочующая батарея вот-вот объявится — заранее зарядить орудие под её остров
  const w = s.targets.find((x) => x.alive && x.locate === 'sound' && x.moved && corr[x.id] && corr[x.id].at);
  if (w && !s.breech.shell && !s.breech.busy && s.shells.he > 0) fireShell(game, 'he', () => corr[w.id].at, null, { loadOnly: true });
  return false;
}
/** Бот ведёт бой до конца (или пока stop() не скажет хватит). → число ходов. */
export function playBot(game, corr = {}, stop = null, maxSteps = 90) {
  const s = game.state;
  let guard = 0;
  while (s.phase === 'playing' && guard++ < maxSteps && !(stop && stop())) {
    if (!botStep(game, corr)) { tick(game, 3); guard--; if (s.time > 1800) break; continue; }
    tick(game, 0.5);
  }
  return guard;
}

/** Тихий выстрел: без рассеивания (гауссов шум обнуляется при Math.random() = 0.25). */
export function quiet(fn) { const R = Math.random; Math.random = () => 0.25; try { return fn(); } finally { Math.random = R; } }
export function fireQuiet(game, type, x, y, target, opts) {
  const realFire = game.fire;
  game.fire = () => quiet(realFire);
  try { return fireShell(game, type, () => ({ x, y }), target || null, { unsafe: true, ...(opts || {}) }); } finally { game.fire = realFire; }
}
export const noWind = (game) => { game.state.mission.wind = { speed: 0, from: 0 }; };

export const start = (idx, patch, diff = 0, storage) => {
  const game = createGame({ storage: storage || unlockAll() });
  game.setDifficulty(diff);
  assert.ok(game.startMission(idx).ok);
  if (patch) patch(game.state);
  game.begin();
  return game;
};
