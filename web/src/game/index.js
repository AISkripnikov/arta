// Игровая логика «АРТА: Башня». Чистый JS без DOM и THREE. Контракт — docs/DESIGN.md §6.
import { solve, shoot, chargeRange, CHARGE_V0 } from './ballistics.js';
import { CAMPAIGN, KINDS, MAP, makeMap, coastAt, isLand, skirmishDef, soundPosts } from './missions.js';

const C = Object.freeze({ LOAD_ANGLE: 3, EL_MIN: -2, EL_MAX: 45, CHARGES: CHARGE_V0.length, MAP, RANGE_MIN: 0.01, RANGE_MAX: 22 });
const RAD = Math.PI / 180;
const DUR = { open: 1.2, close: 1.2, hoist: 2.5, ram: 1.8, charge: 0.9, uncharge: 0.6, unload: 2.0, auto: 9 };
const KW = 0.5;            // снос снаряда ветром: метров на (м/с × с полёта)
const REPAIR_TIME = 25;    // с на устранение одной неисправности
const FAULTS = {
  drive: { name: 'привод поворота башни', fix: 'Наводите маховиком точной наводки.' },
  hoist: { name: 'элеватор подачи снарядов', fix: 'Подача снаряда идёт втрое дольше.' },
  lights: { name: 'электроосвещение башни', fix: 'В башне темно.' },
};
const DIFF = [
  { name: 'Курсант', dmg: 0.6, grace: 90, reconEvery: 30 },
  { name: 'Командир', dmg: 1.0, grace: 60, reconEvery: 45 },
];

const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const norm360 = (a) => ((a % 360) + 360) % 360;
const angDiff = (a, b) => { let d = norm360(a - b); if (d > 180) d -= 360; return d; };
const pad = (v, n) => String(v).padStart(n, '0');
const fmtKm = (v) => { const s = r2(v).toFixed(2); return s.length < 5 ? '0' + s : s; };
const fmtBrg = (b) => { const v = (Math.round(b * 10) / 10).toFixed(1); return v.padStart(5, '0') + '°'; };
const fmtTime = (t) => pad(Math.floor(t / 60), 2) + ':' + pad(Math.floor(t % 60), 2);
const gauss = () => { const u = 1 - Math.random(), v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const bearingTo = (dx, dy) => norm360(Math.atan2(dx, dy) / RAD);

export function createGame(opts = {}) {
  const storage = opts.storage || null;
  const listeners = new Map();
  const on = (ev, fn) => { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); return () => listeners.get(ev).delete(fn); };
  const emit = (ev, data) => { const s = listeners.get(ev); if (s) [...s].forEach((fn) => fn(data)); };
  const changed = () => emit('state', state);

  // ---------- сохранение ----------
  const save = { unlocked: 1, stars: [], records: [], difficulty: 0, muted: false };
  try { const raw = storage && storage.get('arta2.save'); if (raw) Object.assign(save, JSON.parse(raw)); } catch (e) { /* нет сохранения */ }
  const persist = () => { try { if (storage) storage.set('arta2.save', JSON.stringify(save)); } catch (e) { /* игнорируем */ } };

  const state = {
    phase: 'menu', paused: false, speed: 1, difficulty: save.difficulty, time: 0,
    mission: null, integrity: 100, shells: { he: 0, ap: 0 }, targets: [], activeTarget: null,
    plot: { pins: {}, alidade: { bearing: 0, range: 5 }, recorded: {}, pivot: 0, lines: [] },
    computer: { range: 5, charge: 1, elevation: null, tof: null, stale: false, windRange: 0, windBearing: 0 },
    faults: { drive: false, hoist: false, lights: false }, repair: null,
    turret: { bearing: 0, brake: true, elevation: 0 },
    breech: { open: false, shell: null, rammed: false, charges: 0, busy: null },
    fire: { armed: false, burst: 1, burstLeft: 0 },
    flight: [], impacts: [], radio: [], lastReport: null,
    checklist: { measured: false, computed: false, loaded: false, traversed: false, elevated: false, armed: false },
    shots: 0,
  };
  let events = [];      // отложенные события { t, fn }
  let flightId = 0, endScheduled = false;

  const at = (delay, fn) => events.push({ t: state.time + delay, fn });
  const ok = () => ({ ok: true });
  const deny = (action, reason) => { emit('denied', { action, reason }); return { ok: false, reason }; };
  const playing = () => state.phase === 'playing';
  const target = (id) => state.targets.find((t) => t.id === id) || null;
  const active = () => target(state.activeTarget);

  function radio(from, text, kind = 'info') {
    const msg = { time: state.time, from, text, kind };
    state.radio.push(msg);
    emit('radio', msg);
  }

  function updateChecklist() {
    const c = state.checklist, a = active(), rec = a ? state.plot.recorded[a.id] : null;
    const cp = state.computer, b = state.breech, t = state.turret;
    c.measured = !!rec;
    c.computed = cp.elevation != null && !cp.stale;
    c.loaded = !b.open && !!b.shell && b.rammed && b.charges > 0;
    const wind = cp.elevation != null && !cp.stale ? cp.windBearing || 0 : 0;
    c.traversed = t.brake && !!rec && Math.abs(angDiff(t.bearing, rec.bearing + wind)) <= 0.5;
    c.elevated = c.computed && Math.abs(t.elevation - cp.elevation) <= 0.05;
    c.armed = state.fire.armed;
  }
  const touch = () => { updateChecklist(); changed(); };

  // ---------- запуск задания ----------
  function setupMission(def, index) {
    const map = makeMap(def.seed);
    const bat = map.battery;
    Object.assign(state, {
      phase: 'briefing', paused: false, speed: 1, time: 0, integrity: 100, shots: 0,
      shells: { he: def.shells.he, ap: def.shells.ap },
      mission: { id: def.id, index, name: def.name, brief: def.brief, battery: { x: bat.x, y: bat.y }, mapSeed: def.seed, map, tutorial: !!def.tutorial, skirmish: !!def.skirmish },
      targets: [], activeTarget: null, flight: [], impacts: [], radio: [], lastReport: null,
      plot: { pins: {}, alidade: { bearing: 0, range: 5 }, recorded: {}, pivot: 0, lines: [] },
      computer: { range: 5, charge: 1, elevation: null, tof: null, stale: false, windRange: 0, windBearing: 0 },
      faults: { drive: false, hoist: false, lights: false }, repair: null,
      turret: { bearing: 0, brake: true, elevation: 0 },
      breech: { open: false, shell: null, rammed: false, charges: 0, busy: null },
      fire: { armed: false, burst: 1, burstLeft: 0 },
    });
    events = []; endScheduled = false;
    map.posts = def.targets.some((td) => td.locate === 'sound') ? soundPosts(map, bat) : [];
    const w = def.wind || [0, 0], ws = Math.round(w[0] + Math.random() * (w[1] - w[0]));
    state.mission.wind = { speed: ws, from: ws ? Math.round(Math.random() * 35) * 10 : 0 };
    const usedIslands = new Set();
    def.targets.forEach((td, i) => {
      const k = KINDS[td.kind];
      let x, y, tries = 0, islandIdx = -1;
      if (k.site === 'island') {
        // ближайший к желаемой дальности свободный остров
        const want = td.range ? (td.range[0] + td.range[1]) / 2 : 11;
        const cand = map.islands.map((o, j) => ({ o, j, d: Math.hypot(o.x - bat.x, o.y - bat.y) }))
          .filter((c) => !usedIslands.has(c.j) && c.d < 19)
          .sort((a, b) => Math.abs(a.d - want) - Math.abs(b.d - want))[0] || { o: map.islands[0], j: 0 };
        usedIslands.add(cand.j); islandIdx = cand.j;
        x = cand.o.x + (Math.random() - 0.5) * 0.3; y = cand.o.y + (Math.random() - 0.5) * 0.2;
      } else {
        const sec = td.bearing || [315, 45];
        const span = norm360(sec[1] - sec[0]);
        do {
          const b = norm360(sec[0] + Math.random() * span), d = td.range[0] + Math.random() * (td.range[1] - td.range[0]);
          x = bat.x + d * Math.sin(b * RAD); y = bat.y + d * Math.cos(b * RAD);
        } while (++tries < 300 && (x < 0.8 || x > MAP - 0.8 || y > MAP - 0.8 || y < coastAt(map, x) + 1.5 || isLand(map, x, y) ||
          state.targets.some((t) => Math.hypot(t.x - x, t.y - y) < 1.2)));
      }
      const t = {
        id: i + 1, label: 'ЦЕЛЬ ' + (i + 1), name: k.name, kind: td.kind, armored: k.armored, hp: k.hp, maxHp: k.hp, radius: k.radius,
        alive: true, escaped: false, reported: null, moving: k.speed > 0,
        x: r2(x), y: r2(y), course: 0, speed: k.speed, end: k.end || null, pathLeft: td.path || 0, pathLen: td.path || 0,
        gun: k.gun ? { ...k.gun, next: 0 } : null, nextRecon: 0,
        locate: td.locate === 'sound' ? 'sound' : 'recon', relocateEvery: td.relocate || 0, salvos: 0, silentUntil: 0,
        delay: td.delay || 0, islandRef: islandIdx,
      };
      if (t.moving) {
        if (k.end === 'land') t.course = bearingTo(bat.x + (Math.random() - 0.5) * 3 - t.x, coastAt(map, t.x) - t.y);
        else {
          // курс поперёк линии «батарея → цель», в сторону середины карты
          const los = bearingTo(t.x - bat.x, t.y - bat.y);
          const side = t.x > MAP / 2 ? -90 : 90;
          t.course = Math.round(norm360(los + side + (Math.random() - 0.5) * 40));
        }
        t.course = Math.round(t.course);
      }
      state.targets.push(t);
    });
    state.turret.bearing = 0;
    updateChecklist();
  }

  function startMission(index) {
    const def = CAMPAIGN[index];
    if (!def) return deny('startMission', 'Нет такого задания');
    if (index >= save.unlocked) return deny('startMission', 'Задание ещё закрыто');
    setupMission(def, index);
    emit('phase', state.phase); changed();
    return ok();
  }
  function startSkirmish() {
    setupMission(skirmishDef(state.difficulty), null);
    emit('phase', state.phase); changed();
    return ok();
  }
  function begin() {
    if (state.phase !== 'briefing') return deny('begin', 'Задание не выбрано');
    state.phase = 'playing';
    const d = DIFF[state.difficulty];
    const wd = state.mission.wind;
    if (wd.speed) at(1.8, () => radio('МЕТЕО', 'Ветер ' + String(wd.from).padStart(3, '0') + '° (откуда дует), ' + wd.speed + ' м/с. Вычислитель учитывает его автоматически — поправку пеленга вносите на посту ПОВОРОТ.'));
    at(1, () => radio('ШТАБ', 'Батарея «Утёс», к бою. Координаты батареи: X ' + fmtKm(state.mission.battery.x) + ', Y ' + fmtKm(state.mission.battery.y) + '.'));
    let k = 0;
    state.targets.forEach((t, i) => {
      if (t.locate === 'recon') {
        at(3.5 + (k++) * 3 + t.delay, () => {
          if (t.delay) radio('ШТАБ', 'Внимание! Обнаружена новая цель.', 'bad');
          recon(t, true);
        });
        if (t.gun) t.gun.next = d.grace + t.delay + i * 7 + Math.random() * t.gun.period;
      } else if (t.gun) {
        // скрытая батарея: её засекают звукометристы по первому залпу
        t.gun.next = 12 + t.delay + i * 9 + Math.random() * 8;
        t.firstSalvo = true;
      }
    });
    if (state.mission.map.posts.length) {
      const P = state.mission.map.posts;
      at(2.5, () => radio('ЗВУКОМЕТРИЯ', 'Посты на позициях. ' + P.map((q) => q.name + ': X ' + fmtKm(q.x) + ', Y ' + fmtKm(q.y)).join('; ') + '. Ждём залпа противника.'));
    }
    emit('phase', state.phase); touch();
    return ok();
  }
  function quit() {
    state.phase = 'menu'; state.mission = null; state.targets = []; state.flight = []; events = [];
    emit('phase', state.phase); changed();
    return ok();
  }
  function pause(b) { state.paused = !!b; changed(); return ok(); }
  function setSpeed(n) { state.speed = n === 3 ? 3 : 1; changed(); return ok(); }
  function setDifficulty(d) { state.difficulty = save.difficulty = d ? 1 : 0; persist(); changed(); return ok(); }
  function setMuted(b) { save.muted = !!b; persist(); return ok(); }

  // ---------- разведка ----------
  function reconText(t) {
    const r = t.reported;
    if (r.sound) return t.label + ' — ' + t.name.toLowerCase() + '. ' + r.sound.map((q) => q.name + ': пеленг ' + fmtBrg(q.bearing)).join(', ') + '.';
    let s = t.label + ' — ' + t.name.toLowerCase() + '. X ' + fmtKm(r.x) + ', Y ' + fmtKm(r.y) + '.';
    if (t.moving) s += ' Курс ' + pad(Math.round(r.course), 3) + '°, скорость ' + Math.round(r.speed) + ' км/ч.';
    return s;
  }
  function recon(t, announce) {
    if (!t.alive || t.locate === 'sound') return;
    const prev = t.reported;
    t.reported = { x: r2(t.x), y: r2(t.y), course: t.course, speed: t.speed, time: state.time };
    t.nextRecon = state.time + DIFF[state.difficulty].reconEvery;
    if (state.activeTarget == null) state.activeTarget = t.id;
    if (announce || (prev && prev.course !== t.course)) radio('РАЗВЕДКА', reconText(t), 'recon');
    emit('recon', t);
    touch();
  }
  /** Прогноз положения цели по последнему донесению через tAhead секунд от текущего момента. */
  function predict(targetId, tAhead = 0) {
    const t = target(targetId);
    if (!t || !t.reported || t.reported.x == null) return null;
    const r = t.reported, dt = (state.time - r.time + tAhead) / 3600, d = r.speed * dt;
    return { x: r.x + d * Math.sin(r.course * RAD), y: r.y + d * Math.cos(r.course * RAD) };
  }

  // ---------- звукометрия ----------
  /** Пеленг с поста звукометрии на цель (° до 0.1; на «Командире» — с небольшой ошибкой). */
  function soundBearing(post, t) {
    const err = state.difficulty === 0 ? 0 : gauss() * 0.12;
    return Math.round(norm360(bearingTo(t.x - post.x, t.y - post.y) + err) * 10) / 10;
  }
  function soundReport(t) {
    if (!t.alive) return;
    if (t.reported && !t.moved) {
      radio('ЗВУКОМЕТРИЯ', t.label + ' ведёт огонь. Пеленги прежние.', 'recon');
      return;
    }
    const posts = state.mission.map.posts;
    const bearings = posts.map((q) => ({ name: q.name, x: q.x, y: q.y, bearing: soundBearing(q, t) }));
    const first = !t.reported;
    t.moved = false;
    t.reported = { x: null, y: null, sound: bearings, course: 0, speed: 0, time: state.time };
    if (state.activeTarget == null || !target(state.activeTarget).alive) state.activeTarget = t.id;
    radio('ЗВУКОМЕТРИЯ', (first ? 'Засечён залп! ' : 'Новая позиция! ') + reconText(t), 'recon');
    emit('recon', t);
  }
  /** Батарея снимается и уходит на новую позицию на том же острове. */
  function relocate(t) {
    if (!t.alive) return;
    const map = state.mission.map, o = map.islands[t.islandRef] || map.islands[0];
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.35 + Math.random() * 0.45;
      const u = Math.cos(a) * o.rx * r, v = Math.sin(a) * o.ry * r, c = Math.cos(o.rot), sn = Math.sin(o.rot);
      const x = o.x + u * c - v * sn, y = o.y + u * sn + v * c;
      if (Math.hypot(x - t.x, y - t.y) > 0.3 && isLand(map, x, y)) { t.x = r2(x); t.y = r2(y); break; }
    }
    t.moved = true;
    t.silentUntil = state.time + 45;
    t.gun.next = state.time + 45 + Math.random() * 15;
    t.firstSalvo = false;
    at(4, () => radio('ЗВУКОМЕТРИЯ', t.label + ' замолчала — похоже, меняет позицию. Ждите новой засечки.', 'bad'));
  }

  // ---------- планшет ----------
  function selectTarget(id) {
    const t = target(id);
    if (!t || !t.reported) return deny('selectTarget', 'Цель не обнаружена');
    state.activeTarget = id; touch(); return ok();
  }
  function setPin(id, x, y) {
    const t = target(id);
    if (!t || !t.reported) return deny('setPin', 'Цель не обнаружена');
    state.plot.pins[id] = { x: r2(clamp(x, 0, MAP)), y: r2(clamp(y, 0, MAP)) };
    changed(); return ok();
  }
  function setAlidade(v) {
    const a = state.plot.alidade;
    if (v.bearing != null && isFinite(v.bearing)) a.bearing = norm360(r1(v.bearing)) % 360;
    if (v.range != null && isFinite(v.range)) a.range = r2(clamp(v.range, 0, 25));
    changed(); return ok();
  }
  /** Точки, где может стоять ось алидады: 0 — батарея, 1… — посты звукометрии. */
  function pivots() {
    const m = state.mission;
    if (!m) return [];
    return [{ name: 'УТЁС', x: m.battery.x, y: m.battery.y }].concat(m.map.posts || []);
  }
  function setPivot(i) {
    const P = pivots();
    if (!P[i]) return deny('setPivot', 'Нет такой точки');
    state.plot.pivot = i; changed(); return ok();
  }
  /** Провести карандашом линию вдоль алидады (для засечки по пеленгам). */
  function drawLine() {
    const P = pivots(), p = P[state.plot.pivot] || P[0];
    if (!p) return deny('drawLine', 'Бой не идёт');
    const L = state.plot.lines;
    L.push({ from: p.name, x: p.x, y: p.y, bearing: state.plot.alidade.bearing });
    if (L.length > 6) L.shift();
    changed(); return ok();
  }
  function clearLines() { state.plot.lines = []; changed(); return ok(); }

  function recordMeasurement() {
    const a = active();
    if (!playing() || !a) return deny('recordMeasurement', 'Нет активной цели');
    if (state.plot.pivot) return deny('recordMeasurement', 'Ось алидады не на батарее — переставьте её на «УТЁС»');
    const al = state.plot.alidade;
    state.plot.recorded[a.id] = { bearing: al.bearing, range: al.range, time: state.time };
    emit('recorded', { targetId: a.id, bearing: al.bearing, range: al.range });
    touch(); return ok();
  }

  // ---------- вычислитель ----------
  function setComputerRange(km) {
    const c = state.computer, v = r2(clamp(km, C.RANGE_MIN, C.RANGE_MAX));
    if (v !== c.range) { c.range = v; if (c.elevation != null) c.stale = true; touch(); }
    return ok();
  }
  function setComputerCharge(n) {
    const c = state.computer, v = clamp(Math.round(n), 1, C.CHARGES);
    if (v !== c.charge) { c.charge = v; if (c.elevation != null) c.stale = true; touch(); }
    return ok();
  }
  function chargeStates() {
    const out = [];
    for (let n = 1; n <= C.CHARGES; n++) { const l = chargeRange(n); out.push(state.computer.range >= l.min && state.computer.range <= l.max ? 'ok' : 'out'); }
    return out;
  }
  /** Составляющие ветра вдоль и поперёк направления стрельбы, м/с (+ попутный, + сносит вправо). */
  function windParts(bearing) {
    const w = state.mission && state.mission.wind;
    if (!w || !w.speed) return { along: 0, cross: 0 };
    const to = (w.from + 180) * RAD, b = bearing * RAD;
    return { along: w.speed * Math.cos(to - b), cross: w.speed * Math.sin(to - b) };
  }
  /** Направление стрельбы для поправок: записанный пеленг активной цели, иначе текущий пеленг башни. */
  function firingBearing() {
    const rec = state.activeTarget != null ? state.plot.recorded[state.activeTarget] : null;
    return rec ? rec.bearing : state.turret.bearing;
  }
  function compute() {
    const c = state.computer;
    let res = solve(c.range, c.charge);
    let dR = 0, dB = 0;
    if (res.ok) {
      const wp = windParts(firingBearing());
      if (wp.along || wp.cross) {
        // ветер сносит снаряд: стреляем на столько же ближе/дальше и доворачиваем против сноса
        for (let i = 0; i < 3 && res.ok; i++) { dR = -wp.along * res.tof * KW / 1000; res = solve(c.range + dR, c.charge); }
        if (res.ok) dB = -Math.atan2(wp.cross * res.tof * KW, c.range * 1000) / RAD;
      }
    }
    if (!res.ok) { c.elevation = null; c.tof = null; c.stale = false; c.windRange = 0; c.windBearing = 0; touch(); return deny('compute', res.reason); }
    c.elevation = res.elevation; c.tof = res.tof; c.stale = false;
    c.windRange = r2(dR); c.windBearing = r1(dB);
    emit('computed', res); touch();
    return { ...res, windRange: c.windRange, windBearing: c.windBearing };
  }

  // ---------- наводка ----------
  function setBrake(b) { state.turret.brake = !!b; touch(); return ok(); }
  function rotateTurret(delta, opts) {
    if (state.turret.brake) return deny('rotateTurret', 'Башня на стопоре');
    if (opts && opts.power && state.faults.drive) return deny('rotateTurret', 'Привод поворота повреждён — только маховик точной наводки');
    if (!isFinite(delta)) return ok();
    state.turret.bearing = norm360(Math.round((state.turret.bearing + delta) * 100) / 100) % 360;
    touch(); return ok();
  }
  function elevate(delta) {
    if (!isFinite(delta)) return ok();
    if (state.breech.open && state.turret.elevation + delta > C.LOAD_ANGLE) return deny('elevate', 'Затвор открыт — ствол заблокирован');
    state.turret.elevation = r2(clamp(state.turret.elevation + delta, C.EL_MIN, C.EL_MAX));
    touch(); return ok();
  }

  // ---------- заряжание ----------
  function busy(kind, done) {
    const b = state.breech;
    b.busy = { kind, t: 0, dur: DUR[kind] * (kind === 'hoist' && state.faults.hoist ? 3 : 1), done };
    emit('breech', b); touch();
    return ok();
  }
  const breechFree = (action) => (state.breech.busy ? deny(action, 'Механизм занят') : null);
  function openBreech() {
    const b = state.breech;
    if (breechFree('openBreech')) return { ok: false, reason: 'Механизм занят' };
    if (b.open) return ok();
    if (state.turret.elevation > C.LOAD_ANGLE) return deny('openBreech', 'Опустите ствол на угол заряжания (не выше ' + C.LOAD_ANGLE + '°)');
    return busy('open', () => { b.open = true; state.fire.armed = false; });
  }
  function closeBreech() {
    const b = state.breech;
    if (breechFree('closeBreech')) return { ok: false, reason: 'Механизм занят' };
    if (!b.open) return ok();
    if (b.shell && !b.rammed) return deny('closeBreech', 'Снаряд на лотке — дошлите его');
    return busy('close', () => { b.open = false; });
  }
  function hoistShell(type) {
    const b = state.breech;
    if (breechFree('hoistShell')) return { ok: false, reason: 'Механизм занят' };
    if (type !== 'he' && type !== 'ap') return deny('hoistShell', 'Неизвестный тип снаряда');
    if (!b.open) return deny('hoistShell', 'Затвор закрыт');
    if (b.shell) return deny('hoistShell', 'Снаряд уже подан');
    if (state.shells[type] <= 0) return deny('hoistShell', type === 'he' ? 'Фугасные снаряды кончились' : 'Бронебойные снаряды кончились');
    state.shells[type]--;
    return busy('hoist', () => { b.shell = type; b.rammed = false; });
  }
  function ramShell() {
    const b = state.breech;
    if (breechFree('ramShell')) return { ok: false, reason: 'Механизм занят' };
    if (!b.open) return deny('ramShell', 'Затвор закрыт');
    if (!b.shell) return deny('ramShell', 'На лотке нет снаряда');
    if (b.rammed) return deny('ramShell', 'Снаряд уже дослан');
    return busy('ram', () => { b.rammed = true; });
  }
  function addCharge() {
    const b = state.breech;
    if (breechFree('addCharge')) return { ok: false, reason: 'Механизм занят' };
    if (!b.open) return deny('addCharge', 'Затвор закрыт');
    if (!b.rammed) return deny('addCharge', 'Сначала дошлите снаряд');
    if (b.charges >= C.CHARGES) return deny('addCharge', 'Камора полна');
    return busy('charge', () => { b.charges++; });
  }
  function removeCharge() {
    const b = state.breech;
    if (breechFree('removeCharge')) return { ok: false, reason: 'Механизм занят' };
    if (!b.open) return deny('removeCharge', 'Затвор закрыт');
    if (b.charges <= 0) return deny('removeCharge', 'Зарядов нет');
    return busy('uncharge', () => { b.charges--; });
  }
  function unload() {
    const b = state.breech;
    if (breechFree('unload')) return { ok: false, reason: 'Механизм занят' };
    if (!b.open) return deny('unload', 'Затвор закрыт');
    if (!b.shell && !b.charges) return deny('unload', 'Орудие не заряжено');
    return busy('unload', () => { if (b.shell) state.shells[b.shell]++; b.shell = null; b.rammed = false; b.charges = 0; });
  }

  // ---------- огонь ----------
  function arm(v) {
    if (v && state.breech.open) return deny('arm', 'Затвор открыт');
    state.fire.armed = !!v; touch(); return ok();
  }
  function fireReadiness() {
    const b = state.breech;
    return { shell: !!b.shell && b.rammed, charge: b.charges > 0, breech: !b.open && !b.busy, brake: state.turret.brake, armed: state.fire.armed };
  }
  function fire() {
    if (!playing()) return deny('fire', 'Бой не идёт');
    const rd = fireReadiness();
    if (!rd.breech) return deny('fire', 'Затвор не закрыт');
    if (!rd.shell) return deny('fire', 'Орудие не заряжено');
    if (!rd.charge) return deny('fire', 'Нет заряда в каморе');
    if (!rd.brake) return deny('fire', 'Башня не на стопоре');
    if (!rd.armed) return deny('fire', 'Цепь стрельбы не взведена');
    const b = state.breech, t = state.turret;
    const noise = { v: gauss() * 0.0012, el: gauss() * 0.02, az: gauss() * 0.03 };
    const res = shoot(t.bearing, t.elevation, b.charges, noise);
    state.shots++;
    const wp = windParts(t.bearing), B = t.bearing * RAD;
    const wa = wp.along * res.tof * KW / 1000, wc = wp.cross * res.tof * KW / 1000;    // км сноса
    const sh = { id: ++flightId, n: state.shots, t: 0, tof: res.tof, shell: b.shell, charges: b.charges,
      x: state.mission.battery.x + res.dx + wa * Math.sin(B) + wc * Math.cos(B),
      y: state.mission.battery.y + res.dy + wa * Math.cos(B) - wc * Math.sin(B), bearing: t.bearing, elevation: t.elevation };
    state.flight.push(sh);
    // каждый наш выстрел помогает противнику засечь батарею
    for (const e of state.targets) if (e.alive && e.gun) e.gun.p = Math.min(0.75, e.gun.p + 0.04);
    const shellType = b.shell, charges = b.charges;
    b.shell = null; b.rammed = false; b.charges = 0;
    state.fire.armed = false;
    emit('fired', { id: sh.id, n: sh.n, tof: sh.tof, shell: sh.shell, charges: sh.charges });
    emit('breech', b);
    // очередь: расчёт сам перезаряжает тем же снарядом и зарядом и стреляет на тех же установках
    const F = state.fire;
    if (F.burstLeft === 0 && F.burst > 1) F.burstLeft = F.burst - 1;
    else if (F.burstLeft > 0) F.burstLeft--;
    if (F.burstLeft > 0) {
      if (state.shells[shellType] <= 0) { F.burstLeft = 0; radio('РАСЧЁТ', 'Очередь прервана: кончились снаряды этого типа.', 'bad'); }
      else {
        state.shells[shellType]--;
        busy('auto', () => {
          b.shell = shellType; b.rammed = true; b.charges = charges;
          if (!playing() || !state.turret.brake) { F.burstLeft = 0; return; }
          state.fire.armed = true;
          const r = fire();
          if (!r.ok) F.burstLeft = 0;
        });
      }
    }
    touch();
    return { ok: true, tof: sh.tof };
  }
  /** Сколько выстрелов в очереди (1…3). */
  function setBurst(n) { state.fire.burst = clamp(Math.round(n), 1, 3); state.fire.burstLeft = 0; changed(); return ok(); }

  // ---------- повреждения и ремонт ----------
  function breakSomething(dmg) {
    const ok2 = Object.keys(FAULTS).filter((k) => !state.faults[k]);
    if (!ok2.length || Math.random() > dmg * 0.07) return;
    const k = ok2[Math.floor(Math.random() * ok2.length)];
    state.faults[k] = true;
    radio('ШТАБ', 'Повреждение! Отказал ' + FAULTS[k].name + '. ' + FAULTS[k].fix + ' Отправьте ремонтную команду.', 'bad');
    emit('fault', { kind: k });
  }
  function repair(kind) {
    if (!playing()) return deny('repair', 'Бой не идёт');
    if (!state.faults[kind]) return deny('repair', 'Этот узел исправен');
    if (state.repair) return deny('repair', 'Ремонтная команда уже занята');
    state.repair = { kind, t: 0, dur: REPAIR_TIME };
    radio('РАСЧЁТ', 'Ремонтная команда приступила: ' + FAULTS[kind].name + '.');
    touch(); return ok();
  }

  function impact(sh) {
    const bat = state.mission.battery;
    const hits = [];
    let ref = active();
    if (!ref || !ref.alive) ref = state.targets.filter((t) => t.alive && t.reported).sort((a, b) => Math.hypot(a.x - sh.x, a.y - sh.y) - Math.hypot(b.x - sh.x, b.y - sh.y))[0] || null;
    let refNote = null;
    state.targets.forEach((t) => {
      if (!t.alive) return;
      const d = Math.hypot(t.x - sh.x, t.y - sh.y);
      let dmg = 0, note = null;
      if (sh.shell === 'ap') { if (d <= t.radius) dmg = t.armored ? 2 : 1; }
      else if (t.armored) { if (d <= t.radius) note = 'armor'; }
      else if (d <= t.radius) dmg = 2;
      else if (d <= t.radius * 1.8) dmg = 1;
      if (dmg) { t.hp = Math.max(0, t.hp - dmg); if (t.hp <= 0) t.alive = false; hits.push({ target: t, damage: dmg, destroyed: !t.alive }); }
      if (t === ref) refNote = dmg ? 'hit' : note;
    });

    let report = null;
    if (ref) {
      const ux0 = ref.x - bat.x, uy0 = ref.y - bat.y, L = Math.hypot(ux0, uy0) || 1, ux = ux0 / L, uy = uy0 / L;
      const ex = (sh.x - ref.x) * 1000, ey = (sh.y - ref.y) * 1000;
      const over = Math.round((ex * ux + ey * uy) / 10) * 10, right = Math.round((ex * uy - ey * ux) / 10) * 10;
      const dist = Math.hypot(ex, ey);
      let text;
      if (refNote === 'hit') text = null;
      else if (refNote === 'armor') text = ref.label + ': попадание, броня не пробита! Нужен бронебойный.';
      else if (dist > 3000) text = ref.label + ': разрыва не наблюдаю. Проверьте установки.';
      else {
        const parts = [];
        if (over) parts.push((over > 0 ? 'перелёт ' : 'недолёт ') + Math.abs(over));
        if (right) parts.push((right > 0 ? 'вправо ' : 'влево ') + Math.abs(right));
        text = ref.label + ': ' + (parts.join(', ') || 'накрытие, без поражения') + '.';
        if (state.difficulty === 0 && parts.length) {
          const dR = -over / 1000, dB = -(right / (L * 1000)) / RAD;
          const sg = (v, n) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(n);
          text += ' Поправка: дальность ' + sg(dR, 2) + ' км, пеленг ' + sg(dB, 1) + '°.';
        }
      }
      report = { targetId: ref.id, over, right, text, time: state.time, observed: dist <= 3000 };
      state.lastReport = report;
      if (text) radio('КОРРЕКТИРОВЩИК', text, 'report');
    }
    hits.forEach((h) => {
      if (h.destroyed) { radio('КОРРЕКТИРОВЩИК', h.target.label + ' (' + h.target.name.toLowerCase() + ') уничтожена!', 'good'); emit('targetDestroyed', h.target); }
      else radio('КОРРЕКТИРОВЩИК', 'Попадание! ' + h.target.label + ' повреждена, продолжайте огонь.', 'good');
    });
    const cur = active();
    if (!cur || !cur.alive) { const nx = state.targets.find((t) => t.alive && t.reported); if (nx) state.activeTarget = nx.id; }
    state.impacts.push({ n: sh.n, x: sh.x, y: sh.y, time: state.time, shell: sh.shell, hit: hits.length > 0, targetId: ref ? ref.id : null });
    if (state.impacts.length > 40) state.impacts.shift();
    emit('impact', { report, hits, x: sh.x, y: sh.y, shell: sh.shell, n: sh.n });
    touch();
    checkEnd();
  }

  // ---------- конец задания ----------
  function checkEnd() {
    if (!playing() || endScheduled) return;
    const alive = state.targets.filter((t) => t.alive);
    if (!alive.length) { endScheduled = true; at(2, () => finish(true)); return; }
    const b = state.breech, inFlight = state.flight.length > 0, loaded = !!b.shell;
    if (inFlight || loaded) return;
    const anySoft = alive.some((t) => !t.armored);
    const canHurt = state.shells.ap > 0 || (state.shells.he > 0 && anySoft);
    if (!canHurt) { endScheduled = true; at(2, () => finish(false, 'Боезапас израсходован, цели не уничтожены.')); }
  }
  function finish(won, reason) {
    if (!playing()) return;
    state.phase = won ? 'won' : 'lost';
    let par = 0;
    state.targets.forEach((t) => { par += Math.ceil(t.maxHp / 2) + 1 + (t.moving ? 1 : 0); });
    const n = state.targets.length;
    const stars = !won ? 0 : state.shots <= par && state.integrity >= 60 ? 3 : state.shots <= par + n * 2 ? 2 : 1;
    const idx = state.mission.index;
    if (won && idx != null) {
      save.stars[idx] = Math.max(save.stars[idx] || 0, stars);
      save.unlocked = Math.max(save.unlocked, Math.min(CAMPAIGN.length, idx + 2));
      persist();
    }
    const stats = { shots: state.shots, par, time: state.time, integrity: Math.round(state.integrity), destroyed: state.targets.filter((t) => !t.alive && !t.escaped).length, total: n };
    let record = null;
    if (won && idx != null) {
      const old = save.records[idx] || null;
      const better = !old || stars > old.stars || (stars === old.stars && (stats.shots < old.shots || (stats.shots === old.shots && stats.time < old.time)));
      if (better) {
        save.records[idx] = { stars, shots: stats.shots, time: Math.round(stats.time), integrity: stats.integrity, difficulty: state.difficulty };
        persist();
      }
      record = { best: save.records[idx], isNew: better, previous: old };
    }
    emit('phase', state.phase);
    emit('missionEnd', { won, stars, reason: reason || null, stats, record });
    changed();
  }

  // ---------- такт ----------
  function update(dtReal) {
    if (!playing() || state.paused || !(dtReal > 0)) return;
    const dt = Math.min(dtReal, 0.25) * state.speed;
    state.time += dt;
    let dirty = false;

    // механизмы заряжания
    const b = state.breech;
    if (b.busy) {
      b.busy.t += dt; dirty = true;
      if (b.busy.t >= b.busy.dur) { const done = b.busy.done; b.busy = null; done(); emit('breech', b); checkEnd(); }
    }
    // ремонт
    if (state.repair) {
      const r = state.repair; r.t += dt; dirty = true;
      if (r.t >= r.dur) { state.faults[r.kind] = false; state.repair = null; radio('РАСЧЁТ', 'Исправлено: ' + FAULTS[r.kind].name + '.', 'good'); emit('fault', { kind: r.kind, fixed: true }); }
    }
    // снаряды в полёте
    for (let i = state.flight.length - 1; i >= 0; i--) {
      const sh = state.flight[i]; sh.t += dt; dirty = true;
      if (sh.t >= sh.tof) { state.flight.splice(i, 1); impact(sh); if (!playing()) return; }
    }
    // цели
    const map = state.mission.map, bat = state.mission.battery, d = DIFF[state.difficulty];
    for (const t of state.targets) {
      if (!t.alive || (!t.reported && t.locate !== 'sound')) continue;
      if (t.moving) {
        const ds = (t.speed / 3600) * dt;
        t.x += ds * Math.sin(t.course * RAD); t.y += ds * Math.cos(t.course * RAD);
        t.pathLeft -= ds;
        const out = t.x < 0.3 || t.x > MAP - 0.3 || t.y > MAP - 0.3;
        if (t.end === 'land') {
          if (t.y <= coastAt(map, t.x) + 0.25) { t.alive = false; t.escaped = true; radio('ШТАБ', 'Десант высадился на берег!', 'bad'); finish(false, 'Десант противника высадился на берег.'); return; }
        } else if (t.end === 'patrol') {
          if (t.pathLeft <= 0 || out) { t.course = norm360(t.course + 180); t.pathLeft = t.pathLen; recon(t, false); }
        } else if (t.pathLeft <= 0 || out) {
          t.alive = false; t.escaped = true;
          radio('РАЗВЕДКА', t.label + ' ушла из зоны огня.', 'bad');
          finish(false, t.name + ' противника ушёл из-под огня.'); return;
        }
        if (state.time >= t.nextRecon) recon(t, false);
        dirty = true;
      }
      if (t.gun && state.time >= t.gun.next && (t.reported || t.locate === 'sound') && state.time >= t.silentUntil) {
        t.gun.next = state.time + t.gun.period * (0.8 + Math.random() * 0.4);
        if (Math.hypot(t.x - bat.x, t.y - bat.y) <= t.gun.range) {
          t.salvos++;
          if (t.locate === 'sound') soundReport(t);
          const ranging = t.firstSalvo; t.firstSalvo = false;
          const hit = !ranging && Math.random() < t.gun.p;
          emit('incoming', { by: t.id, eta: 2.4 });
          at(2.4, () => {
            if (!playing()) return;
            if (hit) {
              const dmg = Math.round(t.gun.dmg * d.dmg * (0.7 + Math.random() * 0.6));
              state.integrity = Math.max(0, state.integrity - dmg);
              emit('batteryHit', { damage: dmg, by: t.id });
              if (state.integrity <= 0) { radio('ШТАБ', 'Батарея разбита!', 'bad'); finish(false, 'Батарея уничтожена огнём противника.'); return; }
              breakSomething(dmg);
              if (state.integrity <= 35 && !state.mission.warned) { state.mission.warned = true; radio('ШТАБ', 'Батарея получила тяжёлые повреждения! Подавите огневые точки противника.', 'bad'); }
            } else emit('batteryHit', { damage: 0, by: t.id });
          });
          if (t.relocateEvery && t.salvos % t.relocateEvery === 0) relocate(t);
          dirty = true;
        }
      }
    }
    // отложенные события
    if (events.length) {
      const due = events.filter((e) => e.t <= state.time).sort((a, b2) => a.t - b2.t);
      if (due.length) { events = events.filter((e) => e.t > state.time); for (const e of due) { if (state.phase === 'menu') break; e.fn(); } dirty = true; }
    }
    if (dirty) touch();
  }

  /** Где сейчас снаряд (вид сверху): доля пути и точка. Горизонтальная скорость падает из-за сопротивления. */
  function shellPosition(sh) {
    const bat = state.mission.battery, c = 1.1;
    const f = Math.min(1, (1 - Math.exp(-c * sh.t / sh.tof)) / (1 - Math.exp(-c)));
    return { f, x: bat.x + (sh.x - bat.x) * f, y: bat.y + (sh.y - bat.y) * f };
  }

  const game = {
    state, save, C, on, campaign: CAMPAIGN, difficulties: DIFF.map((d) => d.name),
    update, startMission, startSkirmish, begin, quit, pause, setSpeed, setDifficulty, setMuted,
    selectTarget, setPin, setAlidade, recordMeasurement, predict, shellPosition,
    pivots, setPivot, drawLine, clearLines, windParts, firingBearing, setBurst, repair, FAULTS,
    setComputerRange, setComputerCharge, chargeStates, compute,
    setBrake, rotateTurret, elevate,
    openBreech, closeBreech, hoistShell, ramShell, addCharge, removeCharge, unload,
    arm, fire, fireReadiness,
    solve, chargeRange,
    isLand: (x, y) => (state.mission ? isLand(state.mission.map, x, y) : false),
    coastAt: (x) => (state.mission ? coastAt(state.mission.map, x) : 0),
    fmt: { km: fmtKm, time: fmtTime, brg: fmtBrg },
  };
  return game;
}
