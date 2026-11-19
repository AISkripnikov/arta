// Игровая логика «АРТА: Башня». Чистый JS без DOM и THREE. Контракт — src/game/README.md.
// Все отложенные действия — ДАННЫЕ ({ t, a: имя, p: аргументы }), а не замыкания: бой целиком сохраняется в JSON (snapshot/restore).
import { solve, shoot, chargeRange, CHARGE_V0 } from './ballistics.js';
import { TOPICS, topicById, nextStep as stepOf, describe, TOPIC_HOLD, TOPIC_MIN, STEP_MISSIONS } from './hints.js';
import { CAMPAIGN, KINDS, FRIEND_KINDS, MAP, makeMap, coastAt, isLand, skirmishDef, soundPosts, survivalDef, survivalWave, dailyDef, rng } from './missions.js';

const C = Object.freeze({ LOAD_ANGLE: 3, EL_MIN: -2, EL_MAX: 45, CHARGES: CHARGE_V0.length, MAP, RANGE_MIN: 0.01, RANGE_MAX: 22,
  AA_EL_MAX: 80, AA_CONE: 2.2, AA_RANGE: 4.5, AA_AMMO: 400, SCOPE_ZOOMS: [4, 10], VIS_CLEAR: 16, VIS_FOG: 4, FRIEND_HIT: 0.25 });
const RAD = Math.PI / 180;
const DUR = { open: 1.2, close: 1.2, hoist: 2.5, ram: 1.8, charge: 0.9, uncharge: 0.6, unload: 2.0, auto: 9 };
const KW = 0.5;            // снос снаряда ветром: метров на (м/с × с полёта)
const REPAIR_TIME = 25;    // с на устранение одной неисправности
const FAULTS = {
  drive: { name: 'привод поворота башни', fix: 'Наводите маховиком точной наводки.' },
  hoist: { name: 'элеватор подачи снарядов', fix: 'Подача снаряда идёт втрое дольше.' },
  lights: { name: 'электроосвещение башни', fix: 'В башне темно.' },
};
const SHELLS = Object.freeze({
  he: { name: 'ОФ', title: 'Фугасный', plural: 'Фугасные' },
  ap: { name: 'ББ', title: 'Бронебойный', plural: 'Бронебойные' },
  illum: { name: 'ОСВ', title: 'Осветительный', plural: 'Осветительные' },
  smoke: { name: 'ДЫМ', title: 'Дымовой', plural: 'Дымовые' },
  shrap: { name: 'ШРП', title: 'Шрапнель', plural: 'Шрапнельные' },
});
const SHELL_TYPES = Object.keys(SHELLS);
const RANKS = Object.freeze([
  { name: 'МАТРОС', xp: 0 }, { name: 'СТАРШИНА', xp: 300 }, { name: 'МИЧМАН', xp: 800 },
  { name: 'ЛЕЙТЕНАНТ', xp: 1600 }, { name: 'КАПИТАН-ЛЕЙТЕНАНТ', xp: 2800 }, { name: 'КАПИТАН 3 РАНГА', xp: 4500 },
]);
const LIGHT_RADIUS = 1.5, LIGHT_TIME = 60;          // осветительный: км и с
const SMOKE_MIN = 1, SMOKE_MAX = 4, SMOKE_TIME = 60, SMOKE_ARC = 25, SMOKE_K = 0.4;
const SALVO_SPREAD = 0.15;                          // «вилка»: ± км по дальности
const AREA = 2;                                     // ночью штаб даёт квадрат 2×2 км
const WAVE_PAUSE = 10, ESCAPE_COST = 25;            // оборона
const RESUPPLY = { he: 6, ap: 3, illum: 1, smoke: 1, shrap: 1 };
const DIFF = [
  { name: 'Курсант', dmg: 0.6, grace: 90, reconEvery: 30 },
  { name: 'Командир', dmg: 1.0, grace: 60, reconEvery: 45 },
];
// --- новое ---
const SINK_TIME = 18;                               // с: корабль уходит под воду
const SPOT_DELAY = 3;                               // с: доклад корректировщика об отклонении приходит не сразу
const FLASH_TIME = 6;                               // с: вспышку выстрела видно в трубу
const XP_PER_POINT = 150, UPG_COST = [2, 3, 4], UPG_MAX = 3;
const pc = (v) => Math.round(v * 100) + '%';
const UPGRADES = Object.freeze({
  hoist: { title: 'БЫСТРЫЙ ЭЛЕВАТОР', desc: 'Подача и досылание снаряда быстрее на 12% за уровень.', eff: (l) => 'подача и досылание −' + pc(0.12 * l) },
  range: { title: 'ДАЛЬНОМЕР', desc: 'Ошибка донесений разведки меньше на 25% за уровень: туман, засечки по вспышке, пеленги звукометрии.', eff: (l) => 'ошибка донесений −' + pc(0.25 * l) },
  spotter: { title: 'ВТОРОЙ КОРРЕКТИРОВЩИК', desc: 'Доклад об отклонении разрыва приходит на 25% быстрее за уровень.', eff: (l) => 'задержка доклада −' + pc(0.25 * l) },
  armor: { title: 'БРОНЯ', desc: 'Урон батарее от снарядов и бомб меньше на 10% за уровень.', eff: (l) => 'урон батарее −' + pc(0.1 * l) },
  magazine: { title: 'ПОГРЕБ', desc: 'В начале боя за каждый уровень: +2 ОФ, +1 ББ, +1 ОСВ.', eff: (l) => '+' + 2 * l + ' ОФ, +' + l + ' ББ, +' + l + ' ОСВ' },
  repair: { title: 'РЕМОНТНАЯ ПАРТИЯ', desc: 'Ремонт неисправностей быстрее на 20% за уровень.', eff: (l) => 'время ремонта −' + pc(0.2 * l) },
});
const UPG_IDS = Object.keys(UPGRADES);
const CREW = Object.freeze({
  gunner: { title: 'НАВОДЧИК', name: 'Громов' },
  loader: { title: 'ЗАРЯЖАЮЩИЙ', name: 'Седых' },
  radio: { title: 'РАДИСТ', name: 'Вяткин' },
});
const CREW_ROLES = Object.keys(CREW);
const CREW_VOICE = {
  gunner: { tired: 'Руки отваливаются, командир. Навожу медленнее.', wounded: 'Задело! Навожу одной рукой.', ok: 'Наводчик в строю.' },
  loader: { tired: 'Выдохся. Заряжаю медленнее.', wounded: 'Осколок в плечо! Заряжать буду, но не быстро.', ok: 'Заряжающий в строю.' },
  radio: { tired: 'В ушах звенит. Доклады принимаю с задержкой.', wounded: 'Контузило… Связь держу, но медленно.', ok: 'Радист в строю.' },
};
const TIRED = 0.8, TIRED_K = 1.25, WOUND_K = 1.6, WOUND_TIME = 45, WOUND_P = 0.2;
const HUNT_RANGE = 6, HUNT_STANDOFF = 2, HUNT_P = 0.35, HUNT_SMOKE = 1.2;
const PLANE_SPEED = 0.22, PLANE_START = 7, PLANE_DROP = 0.4, BOMB_DMG = 12, BOMB_FAULT = 0.35, PLANE_KILL = 1.2, PLANE_XP = 15;
const AA_HEAT = 0.16, AA_COOL = 0.12, AA_UNJAM = 0.4, AA_RATE = 8;
const AUTOSAVE = 15, SNAP_V = 1;
const TEXT_SIZES = [1, 1.15, 1.3];
const DETECT_FLASH = 8;       // с: батарею засекают в момент первого своего разрыва, но не позже этого после первого выстрела
const HARASS_MIN = 0.6, HARASS_MAX = 2.5;      // км: куда ложатся снаряды беспокоящего огня (пока батарея не засечена)
const HINT_MODES = ['new', 'all', 'off'];
const FRIEND_ZONE = 0.4;      // км: свои ближе этого к точке прицеливания — «в зоне поражения»
/** Настройки: значение по умолчанию и область допустимых значений. Логика их хранит и проверяет; применяет — интерфейс
 *  (кроме autosave и speed — их учитывает сама логика). */
const bool = (def) => ({ def, ok: (v) => typeof v === 'boolean' });
const oneOf = (def, list) => ({ def, ok: (v) => list.includes(v), list });
const vol = (def) => ({ def, ok: (v) => typeof v === 'number' && v >= 0 && v <= 100, fix: (v) => Math.round(v) });
const SETTINGS = {
  // управление
  sens: { def: 1, ok: (v) => typeof v === 'number' && v >= 0.6 && v <= 1.6, fix: (v) => Math.round(v * 20) / 20 },
  invert: bool(false), lefty: bool(false), vibro: bool(true), vibroPower: oneOf('high', ['low', 'high']),
  // игра
  hints: oneOf('new', HINT_MODES), autosave: bool(true), speed: oneOf(1, [1, 2]), confirmFriendly: bool(true), crewPanel: oneOf('full', ['full', 'compact', 'off']),
  // звук
  volFx: vol(100), volAmb: vol(70), volRadio: vol(100),
  // экран
  text: oneOf(1, TEXT_SIZES), quality: oneOf('high', ['high', 'mid', 'low']), fps: oneOf(60, [60, 30]), nightTint: oneOf('normal', ['normal', 'soft']), showFps: bool(false),
};
const SETTING_KEYS = Object.keys(SETTINGS);
const settingDefaults = () => { const o = {}; for (const k of SETTING_KEYS) o[k] = SETTINGS[k].def; return o; };
/** Настройки из сохранения: чего нет или что не проходит проверку — по умолчанию. */
function loadSettings(st) {
  const o = settingDefaults();
  if (st && typeof st === 'object') for (const k of SETTING_KEYS) { const d = SETTINGS[k], v = st[k]; if (d.ok(v)) o[k] = d.fix ? d.fix(v) : v; }
  return o;
}
const freshSave = () => ({ unlocked: 1, stars: [], records: [], difficulty: 0, muted: false, xp: 0, survivalBest: null,
  upgrades: {}, points: 0, settings: {}, daily: null, resume: null, learned: {} });

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
const stock = (def) => { const o = {}; for (const k of SHELL_TYPES) o[k] = (def && def[k]) || 0; return o; };
const rankIndex = (xp) => { let i = 0; while (i < RANKS.length - 1 && xp >= RANKS[i + 1].xp) i++; return i; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const dec = (v) => String(v).replace('.', ',');
/** Угол между двумя направлениями (пеленг, возвышение), °. */
function angSep(b1, e1, b2, e2) {
  const c = Math.sin(e1 * RAD) * Math.sin(e2 * RAD) + Math.cos(e1 * RAD) * Math.cos(e2 * RAD) * Math.cos((b1 - b2) * RAD);
  return Math.acos(clamp(c, -1, 1)) / RAD;
}

export function createGame(opts = {}) {
  const storage = opts.storage || null;
  const listeners = new Map();
  const on = (ev, fn) => { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); return () => listeners.get(ev).delete(fn); };
  const emit = (ev, data) => { const s = listeners.get(ev); if (s) [...s].forEach((fn) => fn(data)); };
  const changed = () => emit('state', state);

  const RADIO_KEEP = 150;
  // ---------- сохранение ----------
  const save = freshSave();
  delete save.learned;      // есть ли в сохранении изученные темы — узнаём по самому сохранению (ниже)
  try { const raw = storage && storage.get('arta2.save'); if (raw) Object.assign(save, JSON.parse(raw)); } catch (e) { /* нет сохранения */ }
  if (!(save.xp >= 0)) save.xp = 0;
  if (!Array.isArray(save.stars)) save.stars = [];
  if (!Array.isArray(save.records)) save.records = [];
  // сохранение из прежней версии: кампания стала длиннее — задание после последнего пройденного должно быть открыто
  for (let i = 0; i < save.stars.length; i++) if (save.stars[i] > 0) save.unlocked = Math.max(save.unlocked || 1, Math.min(CAMPAIGN.length, i + 2));
  if (!(save.unlocked >= 1)) save.unlocked = 1;
  { // новые поля: чего нет в старом сохранении — по умолчанию
    const u = save.upgrades && typeof save.upgrades === 'object' ? save.upgrades : {};
    save.upgrades = {};
    for (const id of UPG_IDS) save.upgrades[id] = clamp(Math.round(u[id]) || 0, 0, UPG_MAX);
    // прежние версии хранили lefty/vibro как «что-то истинное/ложное» — приводим к булевым до проверки
    const st = save.settings && typeof save.settings === 'object' ? { ...save.settings } : {};
    if ('lefty' in st) st.lefty = !!st.lefty;
    if ('vibro' in st) st.vibro = st.vibro !== false;
    // «подсказки обучения» были выключателем: вкл → «только новое», выкл → «нет»
    if (st.hints === true) st.hints = 'new'; else if (st.hints === false) st.hints = 'off';
    save.settings = loadSettings(st);
    if (!save.daily || typeof save.daily !== 'object' || !save.daily.date) save.daily = null;
    if (!save.resume || typeof save.resume !== 'object' || !save.resume.snap) save.resume = null;
    // изученные темы подсказок. Сохранение прежней версии (поля нет): знакомым считаем только то, что было в уже пройденных
    // заданиях (и «общие» механики, если пройдено задание не раньше их появления); новые механики (fresh) — никому.
    const L = save.learned && typeof save.learned === 'object' && !Array.isArray(save.learned) ? save.learned : null;
    save.learned = {};
    if (L) { for (const tp of TOPICS) if (L[tp.id] === true) save.learned[tp.id] = true; }
    else {
      save.stars.forEach((st2, i) => {
        if (!(st2 > 0) || !CAMPAIGN[i]) return;
        const d = describe(CAMPAIGN[i], save.difficulty);
        for (const tp of TOPICS) if (!tp.fresh && !tp.menu && ((tp.intro && tp.intro(d)) || (tp.since != null && i >= tp.since))) save.learned[tp.id] = true;
      });
      if (UPG_IDS.some((id) => save.upgrades[id] > 0)) save.learned.upgrades = true;
    }
  }
  const upg = (id) => save.upgrades[id] || 0;
  const spent = () => UPG_IDS.reduce((a, id) => a + UPG_COST.slice(0, upg(id)).reduce((x, y) => x + y, 0), 0);
  const points = () => Math.floor((save.xp || 0) / XP_PER_POINT) - spent();
  save.points = points();
  const persist = () => { save.points = points(); try { if (storage) storage.set('arta2.save', JSON.stringify(save)); } catch (e) { /* игнорируем */ } };

  const newCrew = () => { const o = {}; for (const k of CREW_ROLES) o[k] = { role: k, title: CREW[k].title, name: CREW[k].name, state: 'ok', fatigue: 0, woundedUntil: 0 }; return o; };
  /** Всё, что относится к одному бою (сбрасывается при запуске задания). */
  const freshBattle = () => ({
    paused: false, speed: 1, station: 'plot', time: 0, integrity: 100, shots: 0,
    shells: stock(null), lights: [], smokes: [], history: [], tracks: {}, wave: 0, kills: 0,
    targets: [], activeTarget: null, flight: [], impacts: [], radio: [], lastReport: null, reportDue: null,
    plot: { pins: {}, alidade: { bearing: 0, range: 5 }, recorded: {}, pivot: 0, lines: [] },
    computer: { range: 5, charge: 1, elevation: null, tof: null, stale: false, windRange: 0, windBearing: 0 },
    faults: { drive: false, hoist: false, lights: false }, repair: null,
    turret: { bearing: 0, brake: true, elevation: 0 },
    breech: { open: false, shell: null, rammed: false, charges: 0, busy: null },
    fire: { armed: false, burst: 1, burstLeft: 0, salvo: false },
    checklist: { measured: false, computed: false, loaded: false, traversed: false, elevated: false, armed: false },
    scope: { bearing: 0, zoom: 4, last: null },
    friends: [], raid: null, raidWarn: null,
    aa: { bearing: 0, elevation: 20, firing: false, heat: 0, jammed: false, ammo: C.AA_AMMO },
    crew: newCrew(), medkits: 0,
    detected: false, detectedAt: null, detectTold: null, windChangedAt: null, topic: null,
    stats: { friendlyHits: 0, friendlyKills: 0, convoyLost: 0, convoyArrived: 0, planesDown: 0, bombs: 0 },
  });
  const state = { phase: 'menu', difficulty: save.difficulty, mission: null, ...freshBattle() };
  /** Служебное состояние боя — тоже только данные (уходит в снимок). */
  const freshSys = () => ({ events: [], flightId: 0, endScheduled: false, nextId: 1, waveBusy: false, waveIds: [], wavesCleared: 0,
    pending: 0, planeId: 0, aaAcc: 0, nextAuto: AUTOSAVE, detectDue: false, harassSaid: false, topicAcc: 0 });
  let sys = freshSys();
  let drove = false;        // наводчик крутил маховики с прошлого такта
  const rankNow = () => rankIndex(save.xp);
  const crewK = () => 1 - 0.05 * rankNow();     // множитель длительностей: выучка расчёта
  function rank() {
    const i = rankNow();
    return { index: i, name: RANKS[i].name, xp: save.xp, next: RANKS[i + 1] ? RANKS[i + 1].xp : null, bonus: r2(0.05 * i) };
  }

  /** Отложить действие: a — имя из таблицы ACTIONS, p — аргументы (только JSON). */
  const at = (delay, a, p) => sys.events.push({ t: state.time + delay, a, p: p === undefined ? null : p });
  const say = (delay, from, text, kind) => at(delay, 'radio', { from, text, kind: kind || 'info' });
  const ok = () => ({ ok: true });
  const deny = (action, reason) => { emit('denied', { action, reason }); return { ok: false, reason }; };
  const playing = () => state.phase === 'playing';
  const target = (id) => state.targets.find((t) => t.id === id) || null;
  const friend = (id) => state.friends.find((f) => f.id === id) || null;
  const active = () => target(state.activeTarget);

  function radio(from, text, kind = 'info') {
    const msg = { time: state.time, from, text, kind };
    state.radio.push(msg);
    if (state.radio.length > RADIO_KEEP) state.radio.splice(0, state.radio.length - RADIO_KEEP);     // журнал не растёт без конца (оборона, снимок боя)
    // радист принимает донесения — устаёт
    if (from === 'КОРРЕКТИРОВЩИК' || from === 'РАЗВЕДКА' || from === 'ЗВУКОМЕТРИЯ') state.crew.radio.fatigue = Math.min(1, state.crew.radio.fatigue + 0.03);
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
    Object.assign(state, freshBattle(), {
      phase: 'briefing', shells: stock(def.shells), wave: def.survival ? 1 : 0,
      mission: { id: def.id, index, name: def.name, brief: def.brief, battery: { x: bat.x, y: bat.y }, mapSeed: def.seed, map, tutorial: !!def.tutorial, skirmish: !!def.skirmish,
        survival: !!def.survival, night: !!def.night, weather: def.weather || 'clear', areas: [],
        daily: def.daily || null, title: def.title || null, noSpotter: !!def.noSpotter, convoy: !!(def.friends && def.friends.some((f) => f.convoy)),
        raids: def.raids && !def.night ? def.raids.map((r) => ({ at: r.at, planes: clamp(r.planes, 1, 4), from: r.from })) : [] },
    });
    sys = freshSys();
    // улучшение «ПОГРЕБ»
    const mg = upg('magazine');
    state.shells.he += 2 * mg; state.shells.ap += mg; state.shells.illum += mg;
    state.medkits = def.survival ? 3 : 2;
    map.posts = def.survival || def.targets.some((td) => td.locate === 'sound') ? soundPosts(map, bat) : [];
    const w = def.wind || [0, 0];
    let ws = Math.round(w[0] + Math.random() * (w[1] - w[0]));
    if (def.weather === 'storm') ws = clamp(ws, 2, 14);
    state.mission.wind = { speed: ws, from: ws ? Math.round(Math.random() * 35) * 10 : 0 };
    const defs = def.survival ? survivalWave(1, state.difficulty).targets : def.targets;
    sys.waveIds = spawnTargets(defs).map((t) => t.id);
    spawnFriends(def.friends);
    state.turret.bearing = 0;
    updateChecklist();
  }

  /** Создать цели по описаниям (id продолжают расти). → массив новых целей. */
  function spawnTargets(defs) {
    const map = state.mission.map, bat = state.mission.battery, made = [];
    const usedIslands = new Set(state.targets.filter((t) => t.alive && t.islandRef >= 0).map((t) => t.islandRef));
    defs.forEach((td) => {
      const i = sys.nextId++ - 1;
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
      const hunts = !!td.hunts && k.speed > 0;
      const t = {
        id: i + 1, label: 'ЦЕЛЬ ' + (i + 1), name: k.name, kind: td.kind, armored: k.armored, hp: k.hp, maxHp: k.hp, radius: k.radius,
        alive: true, escaped: false, reported: null, moving: k.speed > 0, spotter: !!k.spotter,
        x: r2(x), y: r2(y), course: 0, speed: k.speed, end: hunts ? 'hunt' : k.end || null, pathLeft: td.path || 0, pathLen: td.path || 0,
        gun: k.gun ? { ...k.gun, next: 0 } : null, nextRecon: 0,
        locate: td.locate === 'sound' ? 'sound' : 'recon', relocateEvery: td.relocate || 0, salvos: 0, silentUntil: 0,
        delay: td.delay || 0, islandRef: islandIdx,
        active: false, lit: false, area: null, nextTrack: 0,
        heading: Math.floor(Math.random() * 360), sinking: null, sunk: false, burning: false, firedAt: null,
        hunts, hunt: hunts ? { next: 0 } : null,
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
        t.heading = t.course;
      }
      state.targets.push(t); made.push(t);
    });
    return made;
  }

  /** Свои корабли. path — точки [dx, dy] от батареи; near — индекс цели, мимо которой ходит дозор (поперёк линии огня). */
  function spawnFriends(defs) {
    const bat = state.mission.battery, map = state.mission.map;
    const used = {};
    const fix = (list) => list.map((q) => {
      const x = clamp(q.x, 0.5, MAP - 0.5); let y = clamp(q.y, 0, MAP - 0.5);
      y = Math.max(y, coastAt(map, x) + 0.6);       // не на нашем берегу
      return { x: r2(x), y: r2(y) };
    });
    (defs || []).forEach((fd, i) => {
      const k = FRIEND_KINDS[fd.kind] || FRIEND_KINDS.patrol;
      let pts;
      if (fd.near != null) {
        const t = state.targets[fd.near] || state.targets[0];
        const L = Math.hypot(t.x - bat.x, t.y - bat.y) || 1, ux = (t.x - bat.x) / L, uy = (t.y - bat.y) / L;
        const off0 = fd.offset == null ? 0.3 : fd.offset, span = fd.span || 1.6;
        const leg = (off) => { const cx = t.x - ux * off, cy = t.y - uy * off; return [{ x: cx - uy * span, y: cy + ux * span }, { x: cx + uy * span, y: cy - ux * span }]; };
        const dry = (q) => { for (let k = 0; k <= 40; k++) { const u = k / 40; if (isLand(map, q[0].x + (q[1].x - q[0].x) * u, q[0].y + (q[1].y - q[0].y) * u)) return true; } return false; };
        pts = fix(leg(off0));
        // цель на острове: дозор не ходит по суше — отодвигаем галс к батарее (в сторону моря), пока он не ляжет на воду
        for (let off = off0 + 0.2; dry(pts) && off <= Math.min(off0 + 4, L - 2); off += 0.2) pts = fix(leg(off));
      } else pts = fix((fd.path || [[0, 4]]).map((q) => ({ x: bat.x + q[0], y: bat.y + q[1] })));
      const n = used[fd.kind] = (used[fd.kind] || 0) + 1;
      const f = {
        id: 'F' + (i + 1), label: 'СВОИ ' + (i + 1), name: k.name + ' «' + k.names[(n - 1) % k.names.length] + '»', kind: fd.kind,
        x: pts[0].x, y: pts[0].y, path: pts.length > 1 ? pts : null, leg: 1, dir: 1, loop: !!fd.loop,
        speed: pts.length > 1 ? fd.speed || k.speed : 0, hp: k.hp, maxHp: k.hp, alive: true,
        heading: pts.length > 1 ? Math.round(bearingTo(pts[1].x - pts[0].x, pts[1].y - pts[0].y)) : (i * 97 + 40) % 360,
        convoy: !!fd.convoy, arrived: false, sinking: null, sunk: false, burning: false,
      };
      state.friends.push(f);
    });
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
  /** Режим «ОБОРОНА»: бесконечные волны. */
  function startSurvival() {
    setupMission(survivalDef(), null);
    emit('phase', state.phase); changed();
    return ok();
  }
  // ---------- задание дня ----------
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const dailyBest = (dateKey) => (save.daily && save.daily.date === dateKey ? { score: save.daily.score, stars: save.daily.stars } : null);
  function dailyInfo(dateKey) {
    if (!DATE_RE.test(String(dateKey))) return null;
    const def = dailyDef(dateKey);
    return { date: dateKey, title: def.title, name: def.name, brief: def.brief, best: dailyBest(dateKey) };
  }
  function startDaily(dateKey) {
    if (!DATE_RE.test(String(dateKey))) return deny('startDaily', 'Неверная дата');
    const def = dailyDef(dateKey);
    // расстановка целей и ветер — тоже от даты: на время подготовки подменяем генератор случайных чисел
    const R = Math.random; Math.random = rng(def.seed * 31 + 7);
    try { setupMission(def, null); } finally { Math.random = R; }
    emit('phase', state.phase); changed();
    return ok();
  }
  function begin() {
    if (state.phase !== 'briefing') return deny('begin', 'Задание не выбрано');
    state.phase = 'playing';
    state.speed = save.settings.speed;       // скорость боя по умолчанию — из настроек
    if (save.resume) { save.resume = null; persist(); }
    const wd = state.mission.wind;
    if (wd.speed) say(1.8, 'МЕТЕО', 'Ветер ' + String(wd.from).padStart(3, '0') + '° (откуда дует), ' + wd.speed + ' м/с. Вычислитель учитывает его автоматически — поправку пеленга вносите на посту ПОВОРОТ.');
    say(1, 'ШТАБ', 'Батарея «Утёс», к бою. Координаты батареи: X ' + fmtKm(state.mission.battery.x) + ', Y ' + fmtKm(state.mission.battery.y) + '.');
    const M = state.mission;
    if (M.night) say(2.2, 'ШТАБ', 'Ночь. Разведка целей не видит — даём только квадрат 2×2 км. Осветительный снаряд (ОСВ) над квадратом откроет цель на минуту; вспышка выстрела выдаст её примерно.');
    if (M.weather === 'fog') say(2.2, 'МЕТЕО', 'Туман. Донесения разведки — реже и с точностью до ' + dec(fogQ()) + ' км; корректировщик видит разрывы с точностью до 50 м.');
    if (M.weather === 'storm') { say(2.2, 'МЕТЕО', 'Шторм. Ветер неустойчив — следите за сводками и пересчитывайте установки.'); at(80 + Math.random() * 30, 'windShift'); }
    if (M.survival) say(2.2, 'ШТАБ', 'Оборона. Волна 1 на подходе.', 'bad');
    if (M.noSpotter) say(2.8, 'ШТАБ', 'Корректировщик на связь не вышел. Разрывы наблюдайте сами — пост НАБЛЮДЕНИЕ.', 'bad');
    if (state.friends.length) {
      const cv = state.friends.filter((f) => f.convoy).length;
      say(3, 'ШТАБ', cv ? 'В вашей полосе наш конвой: ' + cv + ' ед. Положение своих на планшете известно всегда. Не дайте противнику их потопить — и сами не заденьте.'
        : 'В районе целей работают свои: ' + state.friends.map((f) => f.name).join(', ') + '. Разрыв ближе 250 м от своего — попадание по нему.');
    }
    schedule(state.targets);
    if (!M.night) M.raids.forEach((r) => { at(Math.max(0.5, r.at - 10), 'raidWarn', { from: r.from }); at(Math.max(10.5, r.at), 'raidStart', { planes: r.planes, from: r.from }); });
    if (M.map.posts.length) {
      const P = M.map.posts;
      say(2.5, 'ЗВУКОМЕТРИЯ', 'Посты на позициях. ' + P.map((q) => q.name + ': X ' + fmtKm(q.x) + ', Y ' + fmtKm(q.y)).join('; ') + '. Ждём залпа противника.');
    }
    emit('phase', state.phase); touch();
    return ok();
  }
  /** Расписать появление целей и их первый огонь (от текущего момента). */
  function schedule(list) {
    const d = DIFF[state.difficulty];
    let k = 0;
    list.forEach((t, i) => {
      if (t.locate === 'recon') {
        const when = 3.5 + (k++) * 3 + t.delay;
        at(when, 'activate', { id: t.id });
        if (t.gun) t.gun.next = state.time + d.grace + t.delay + i * 7 + Math.random() * t.gun.period;
        if (t.hunt) t.hunt.next = state.time + when + 25 + Math.random() * 10;
      } else {
        t.active = true; track(t);
        if (t.gun) {
          // скрытая батарея: её засекают звукометристы по первому залпу
          t.gun.next = state.time + 12 + t.delay + i * 9 + Math.random() * 8;
          t.firstSalvo = true;
        }
      }
    });
  }
  /** Точка следа цели для разбора боя (истинное положение). */
  function track(t) {
    const tr = state.tracks[t.id] || (state.tracks[t.id] = []);
    const last = tr[tr.length - 1];
    if (last && last.t === r1(state.time)) { last.x = r2(t.x); last.y = r2(t.y); }
    else tr.push({ t: r1(state.time), x: r2(t.x), y: r2(t.y) });
    t.nextTrack = state.time + 10;
  }
  function setWind(from, speed, prefix) {
    state.mission.wind = { speed, from: speed ? from : 0 };
    state.windChangedAt = state.time;
    const c = state.computer;
    if (c.elevation != null) c.stale = true;
    radio('МЕТЕО', (prefix || 'Ветер ') + (speed ? String(Math.round(from)).padStart(3, '0') + '° (откуда дует), ' + speed + ' м/с.' : 'штиль.') + (c.stale ? ' Расчёт устарел — пересчитайте.' : ''), 'info');
    emit('wind', { from: state.mission.wind.from, speed });
    touch();
  }

  // ---------- отложенные действия (таблица) ----------
  const ACTIONS = {
    radio(p) { radio(p.from, p.text, p.kind); },
    /** Шторм: ветер меняется. */
    windShift() {
      if (!playing()) return;
      const w = state.mission.wind;
      const from = norm360(Math.round(w.from + (Math.random() * 2 - 1) * 40));
      const speed = clamp(Math.round(w.speed + (Math.random() * 2 - 1) * 3), 2, 14);
      setWind(from, speed, 'Ветер меняется: ');
      at(80 + Math.random() * 30, 'windShift');
    },
    /** Цель разведки выходит «в игру». */
    activate(p) {
      const t = target(p.id);
      if (!playing() || !t || !t.alive) return;
      if (t.delay && !state.mission.survival) radio('ШТАБ', 'Внимание! Обнаружена новая цель.', 'bad');
      t.active = true; track(t);
      if (state.mission.night) announceArea(t, true); else recon(t, true);
    },
    finish(p) { finish(p.won, p.reason); },
    nextWave(p) { nextWave(p.n); },
    /** Снаряд противника долетел до батареи. */
    enemyShell(p) {
      if (!playing()) return;
      // промах; пока батарея не засечена, попаданий не бывает вовсе (беспокоящий огонь наугад: miss — км от батареи)
      if (!p.hit || !state.detected) { emit('batteryHit', { damage: 0, by: p.by, ...(p.blind ? { blind: true, miss: p.miss } : {}) }); return; }
      const dmg = Math.max(1, Math.round(p.dmg * DIFF[state.difficulty].dmg * (0.7 + Math.random() * 0.6) * armorK()));
      if (hitBattery(dmg, p.by, null, 'Батарея уничтожена огнём противника.')) breakSomething(dmg);
    },
    /** Снаряд охотника долетел до нашего корабля. */
    friendShell(p) {
      if (!playing()) return;
      const f = friend(p.id);
      if (!f || !f.alive || f.arrived) return;
      if (p.hit) hurtFriend(f, 1, 'enemy'); else emit('friend', { id: f.id, miss: true, by: 'enemy' });
      checkEnd();
    },
    /** Доклад корректировщика дошёл до батареи. */
    report(p) {
      sys.pending = Math.max(0, sys.pending - 1);
      if (!sys.pending) state.reportDue = null;
      if (!playing()) return;
      state.lastReport = p.report;
      radio('КОРРЕКТИРОВЩИК', p.report.text, 'report');
      emit('report', p.report);
    },
    raidWarn(p) {
      if (!playing()) return;
      radio(CREW.radio.title, 'ВОЗДУХ! Самолёты противника, пеленг ' + fmtBrg(p.from) + '. Расчёт — к зенитке!', 'bad');
      state.raidWarn = { from: p.from, until: state.time + 10 };
      emit('raid', { phase: 'warning', from: p.from, eta: 10 });
    },
    /** Противник засёк батарею (не позже DETECT_FLASH с после первого выстрела; обычно раньше — по первому разрыву). */
    detect() { detect(); },
    /** «Бьют наугад» — только если к моменту доставки батарею ещё не засекли (иначе строка была бы неправдой). */
    harass() { if (playing() && !state.detected) radio('ШТАБ', 'Противник ведёт беспокоящий огонь наугад — нас пока не видят.', 'info'); },
    raidStart(p) { raidStart(p.planes, p.from); },
    raidEnd() {
      const R = state.raid;
      if (!playing() || !R || R.phase !== 'over') return;
      const shot = R.planes.filter((q) => !q.alive).length, bombed = R.planes.filter((q) => q.attacked).length;
      state.raid = null;
      radio('ШТАБ', 'Налёт окончен. Сбито: ' + shot + ', отбомбились: ' + bombed + '.', bombed ? 'info' : 'good');
      emit('raid', { phase: 'end', shot, bombed });
    },
  };

  // ---------- ночь: квадраты, свет, вспышки ----------
  /** Освещена ли точка осветительным снарядом. */
  function lit(x, y) { return state.lights.some((l) => l.until > state.time && Math.hypot(l.x - x, l.y - y) <= LIGHT_RADIUS); }
  const sq = (v) => clamp(Math.floor(v / AREA) * AREA, 0, MAP - AREA);
  function announceArea(t, first) {
    const x0 = sq(t.x), y0 = sq(t.y);
    t.area = { x0, y0, x1: x0 + AREA, y1: y0 + AREA };
    const A = state.mission.areas, i = A.findIndex((a) => a.targetId === t.id);
    const rec = { targetId: t.id, ...t.area };
    if (i >= 0) A[i] = rec; else A.push(rec);
    if (state.activeTarget == null || !(active() && active().alive)) state.activeTarget = t.id;
    const where = 'в квадрате X ' + pad(x0, 2) + '–' + pad(x0 + AREA, 2) + ', Y ' + pad(y0, 2) + '–' + pad(y0 + AREA, 2);
    radio('ШТАБ', first ? t.label + ' — ' + t.name.toLowerCase() + ', ' + where + '. Точных координат нет: подсветите.' : t.label + ' перешла: теперь ' + where + '.', 'recon');
    emit('area', { targetId: t.id, ...t.area });
    touch();
  }
  function dropArea(t) {
    const A = state.mission.areas, i = A.findIndex((a) => a.targetId === t.id);
    if (i >= 0) A.splice(i, 1);
    t.area = null;
  }
  // улучшение «ДАЛЬНОМЕР»: ошибки донесений меньше
  const reconK = () => 1 - 0.25 * upg('range');
  const fogQ = () => r2(0.1 * reconK() + 1e-9) || 0.01;
  const flashQ = () => 0.5 * reconK();
  const quant = (v, q) => r2(Math.round(v / q) * q);
  /** «По вспышке»: грубое донесение (до 0,5 км) о ночной цели, открывшей огонь. */
  function flashReport(t) {
    const r = t.reported;
    if (t.lit || (r && !r.rough && !(t.moving && state.time - r.time > 45))) return;
    const q = flashQ();
    const nx = quant(t.x, q), ny = quant(t.y, q);
    const same = r && r.rough && r.x === nx && r.y === ny;
    t.reported = { x: nx, y: ny, course: 0, speed: 0, time: state.time, rough: true };
    if (state.activeTarget == null) state.activeTarget = t.id;
    if (!same) radio('РАЗВЕДКА', 'По вспышке: ' + t.label + ' — ' + t.name.toLowerCase() + ', примерно X ' + fmtKm(nx) + ', Y ' + fmtKm(ny) + ' (±' + dec(q) + ' км).', 'recon');
    emit('recon', t);
  }
  function quit(o) {
    // сохранённый бой пропадает, только если бросают идущий бой без сохранения (выход из инструктажа или итогов его не трогает)
    if (!(o && o.keep) && state.phase === 'playing' && save.resume) { save.resume = null; persist(); }
    state.phase = 'menu'; state.mission = null; state.targets = []; state.flight = []; state.friends = []; state.raid = null; sys.events = [];
    emit('phase', state.phase); changed();
    return ok();
  }
  function pause(b) { state.paused = !!b; changed(); return ok(); }
  function setSpeed(n) { state.speed = n === 3 ? 3 : n === 2 ? 2 : 1; changed(); return ok(); }
  /** Интерфейс сообщает, на каком посту игрок (id поста): попадает в снимок боя, чтобы «ПРОДОЛЖИТЬ БОЙ» вернул на тот же пост. */
  function setStation(id) { if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,23}$/.test(id)) return deny('setStation', 'Нет такого поста'); state.station = id; return ok(); }
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
    const fog = state.mission.weather === 'fog', q = fogQ(), rr = fog ? (v) => quant(v, q) : r2;
    t.reported = { x: rr(t.x), y: rr(t.y), course: t.course, speed: t.speed, time: state.time };
    t.nextRecon = state.time + DIFF[state.difficulty].reconEvery * (fog ? 2 : 1);
    if (state.activeTarget == null) state.activeTarget = t.id;
    // охотник всё время доворачивает на конвой — о мелких поворотах по радио не сообщаем
    const turned = prev && (t.hunts ? Math.abs(angDiff(prev.course, t.course)) > 25 : prev.course !== t.course);
    if (announce || (prev && (prev.rough || turned))) radio('РАЗВЕДКА', reconText(t), 'recon');
    emit('recon', t);
    touch();
  }
  /** Прогноз положения цели по последнему донесению через tAhead секунд от текущего момента. */
  function predict(targetId, tAhead = 0) {
    const t = target(targetId);
    if (!t || !t.reported || t.reported.x == null) return t && t.area && !t.reported ? { x: (t.area.x0 + t.area.x1) / 2, y: (t.area.y0 + t.area.y1) / 2, area: true } : null;
    const r = t.reported, dt = (state.time - r.time + tAhead) / 3600, d = r.speed * dt;
    return { x: r.x + d * Math.sin(r.course * RAD), y: r.y + d * Math.cos(r.course * RAD) };
  }

  // ---------- звукометрия ----------
  /** Пеленг с поста звукометрии на цель (° до 0.1; на «Командире» — с небольшой ошибкой). */
  function soundBearing(post, t) {
    const err = state.difficulty === 0 ? 0 : gauss() * 0.12 * reconK();
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
    if (state.activeTarget == null || !(active() && active().alive)) state.activeTarget = t.id;
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
    say(4, 'ЗВУКОМЕТРИЯ', t.label + ' замолчала — похоже, меняет позицию. Ждите новой засечки.', 'bad');
  }

  // ---------- планшет ----------
  function selectTarget(id) {
    const t = target(id);
    if (!t || !(t.reported || t.area)) return deny('selectTarget', 'Цель не обнаружена');
    if (!t.alive) return deny('selectTarget', t.escaped ? 'Цель ушла' : 'Цель уничтожена');
    state.activeTarget = id; touch(); return ok();
  }
  function setPin(id, x, y) {
    const t = target(id);
    if (!t || !(t.reported || t.area)) return deny('setPin', 'Цель не обнаружена');
    if (!t.alive) return deny('setPin', t.escaped ? 'Цель ушла' : 'Цель уничтожена');
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
  function pushLine(l) { const L = state.plot.lines; L.push(l); if (L.length > 6) L.shift(); }
  /** Провести карандашом линию вдоль алидады (для засечки по пеленгам). */
  function drawLine() {
    const P = pivots(), p = P[state.plot.pivot] || P[0];
    if (!p) return deny('drawLine', 'Бой не идёт');
    pushLine({ from: p.name, x: p.x, y: p.y, bearing: state.plot.alidade.bearing });
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

  // ---------- наблюдательный пост ----------
  function setScope(v) {
    const sc = state.scope;
    if (v && v.bearing != null && isFinite(v.bearing)) sc.bearing = norm360(r2(v.bearing)) % 360;
    if (v && v.zoom != null) sc.zoom = +v.zoom >= 7 ? 10 : 4;
    changed(); return ok();
  }
  const scopeFov = () => 64 / state.scope.zoom;      // 16° при ×4, 6,4° при ×10
  /** Предел оптической видимости, км. */
  const visLimit = () => (state.mission && state.mission.weather === 'fog' ? C.VIS_FOG : C.VIS_CLEAR);
  /** Видна ли цель (id — число) или свой корабль (id — 'F1') в оптику. */
  function visible(id) {
    const m = state.mission;
    if (!m) return false;
    const isT = typeof id !== 'string', o = isT ? target(id) : friend(id);
    if (!o || o.sunk || o.escaped) return false;
    if (isT && !o.active) return false;
    const flash = o.firedAt != null && state.time - o.firedAt <= FLASH_TIME;
    if (isT && o.locate === 'sound' && !flash) return false;
    if (Math.hypot(o.x - m.battery.x, o.y - m.battery.y) > visLimit()) return false;
    if (m.night) return flash || lit(o.x, o.y);
    return true;
  }
  /** Провести на планшете пеленг трубы и передать его по радио. */
  function scopeMark() {
    if (!playing()) return deny('scopeMark', 'Бой не идёт');
    const bat = state.mission.battery, b = r1(state.scope.bearing);
    pushLine({ from: 'scope', x: bat.x, y: bat.y, bearing: b });
    radio('РАСЧЁТ', 'Наблюдательный пост: пеленг ' + fmtBrg(b) + ' нанесён на планшет.');
    emit('scopeMark', { bearing: b });
    changed(); return ok();
  }
  /** Свой глаз: разрыв в поле зрения трубы. → true, если наблюдался. */
  function observe(sh, hits) {
    const m = state.mission, bat = m.battery, sc = state.scope;
    const d = Math.hypot(sh.x - bat.x, sh.y - bat.y), bb = bearingTo(sh.x - bat.x, sh.y - bat.y);
    if (Math.abs(angDiff(bb, sc.bearing)) > scopeFov() / 2 || d > visLimit()) return false;
    if (m.night && !lit(sh.x, sh.y)) return false;
    // ближайшая к разрыву видимая цель противника (поражённая этим снарядом — тоже)
    const hitIds = hits.map((h) => h.target.id);
    const near = state.targets.filter((t) => (t.alive || hitIds.includes(t.id)) && visible(t.id))
      .sort((a, b) => Math.hypot(a.x - sh.x, a.y - sh.y) - Math.hypot(b.x - sh.x, b.y - sh.y))[0] || null;
    let text;
    if (!near) {
      sc.last = { n: sh.n, dBearing: null, over: null, targetId: null, t: state.time };
      text = 'разрыв № ' + sh.n + ' по пеленгу ' + fmtBrg(bb) + ', целей рядом не вижу.';
    } else {
      const hit = hitIds.includes(near.id);
      const dB = r1(angDiff(bb, bearingTo(near.x - bat.x, near.y - bat.y)));
      const over = hit ? 0 : d > Math.hypot(near.x - bat.x, near.y - bat.y) ? 1 : -1;
      sc.last = { n: sh.n, dBearing: dB, over, targetId: near.id, t: state.time };
      text = hit ? 'разрыв № ' + sh.n + ' — попадание, ' + near.label + '!'
        : 'разрыв № ' + sh.n + ' — ' + near.label + ': ' + (dB ? (dB > 0 ? 'правее на ' : 'левее на ') + dec(Math.abs(dB).toFixed(1)) + '°, ' : 'по пеленгу точно, ') + (over > 0 ? 'перелёт.' : 'недолёт.');
    }
    radio('РАСЧЁТ', 'НАБЛЮДАЮ: ' + text, 'report');
    emit('observed', sc.last);
    return true;
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

  // ---------- расчёт: усталость, ранения ----------
  /** Во сколько раз медленнее работает боец: 1 | 1.25 (устал) | 1.6 (ранен). */
  const crewFactor = (role) => { const m = state.crew[role]; return !m ? 1 : m.state === 'wounded' ? WOUND_K : m.state === 'tired' ? TIRED_K : 1; };
  function crewState(m, st, quiet) {
    if (m.state === st) return;
    m.state = st;
    if (!quiet) radio(m.title, CREW_VOICE[m.role][st], st === 'ok' ? 'good' : 'bad');
    emit('crew', { role: m.role, state: st });
  }
  function crewTick(dt) {
    const cr = state.crew;
    const work = { gunner: drove, loader: !!state.breech.busy, radio: state.reportDue != null };
    drove = false;
    for (const k of CREW_ROLES) {
      const m = cr[k];
      if (k === 'gunner' && work[k]) m.fatigue = Math.min(1, m.fatigue + 0.02 * dt);
      else if (!work[k]) m.fatigue = Math.max(0, m.fatigue - 0.01 * dt);
      crewState(m, state.time < m.woundedUntil ? 'wounded' : m.fatigue > TIRED ? 'tired' : 'ok');
    }
  }
  function woundRoll() {
    if (Math.random() >= WOUND_P) return;
    const m = state.crew[CREW_ROLES[Math.floor(Math.random() * CREW_ROLES.length)]];
    m.woundedUntil = state.time + WOUND_TIME;
    if (m.state === 'wounded') return;
    crewState(m, 'wounded');
  }
  /** Аптечка: рану снять сразу, усталость — в ноль. */
  function treat(role) {
    const m = state.crew[role];
    if (!playing()) return deny('treat', 'Бой не идёт');
    if (!m) return deny('treat', 'Нет такого бойца');
    if (state.medkits <= 0) return deny('treat', 'Аптечек нет');
    if (m.state === 'ok') return deny('treat', m.title + ' в строю — аптечка не нужна');
    state.medkits--;
    m.woundedUntil = 0; m.fatigue = 0;
    crewState(m, 'ok', true);
    radio(m.title, 'Перевязали. Снова в строю, командир!', 'good');
    touch(); return ok();
  }

  // ---------- наводка ----------
  function setBrake(b) { state.turret.brake = !!b; touch(); return ok(); }
  function rotateTurret(delta, opts) {
    if (state.turret.brake) return deny('rotateTurret', 'Башня на стопоре');
    if (opts && opts.power && state.faults.drive) return deny('rotateTurret', 'Привод поворота повреждён — только маховик точной наводки');
    if (!isFinite(delta)) return ok();
    if (delta) drove = true;
    state.turret.bearing = norm360(Math.round((state.turret.bearing + delta / crewFactor('gunner')) * 100) / 100) % 360;
    touch(); return ok();
  }
  function elevate(delta) {
    if (!isFinite(delta)) return ok();
    const d = delta / crewFactor('gunner');
    if (state.breech.open && state.turret.elevation + d > C.LOAD_ANGLE) return deny('elevate', 'Затвор открыт — ствол заблокирован');
    if (delta) drove = true;
    state.turret.elevation = r2(clamp(state.turret.elevation + d, C.EL_MIN, C.EL_MAX));
    touch(); return ok();
  }

  // ---------- заряжание ----------
  /** Чем кончается операция затвора (busy.kind → действие; busy.arg — данные). */
  const BREECH_DONE = {
    open(b) { b.open = true; state.fire.armed = false; },
    close(b) { b.open = false; },
    hoist(b, a) { b.shell = a.type; b.rammed = false; },
    ram(b) { b.rammed = true; loaded(); },
    charge(b) { b.charges++; },
    uncharge(b) { b.charges--; },
    unload(b) { if (b.shell) state.shells[b.shell]++; b.shell = null; b.rammed = false; b.charges = 0; },
    // очередь: расчёт сам перезарядил тем же снарядом и зарядом — огонь на тех же установках
    auto(b, a) {
      const F = state.fire;
      b.shell = a.shell; b.rammed = true; b.charges = a.charges; loaded();
      if (!playing() || !state.turret.brake) { F.burstLeft = 0; return; }
      F.armed = true;
      const r = fire();
      if (!r.ok) F.burstLeft = 0;
    },
  };
  const loaded = () => { const m = state.crew.loader; m.fatigue = Math.min(1, m.fatigue + 0.06); };
  function busy(kind, arg) {
    const b = state.breech;
    const fast = kind === 'hoist' || kind === 'ram' || kind === 'auto' ? 1 - 0.12 * upg('hoist') : 1;
    b.busy = { kind, t: 0, dur: DUR[kind] * crewK() * fast * crewFactor('loader') * (kind === 'hoist' && state.faults.hoist ? 3 : 1), arg: arg || null };
    emit('breech', b); touch();
    return ok();
  }
  const breechFree = (action) => (state.breech.busy ? deny(action, 'Механизм занят') : null);
  function openBreech() {
    const b = state.breech;
    if (breechFree('openBreech')) return { ok: false, reason: 'Механизм занят' };
    if (b.open) return ok();
    if (state.turret.elevation > C.LOAD_ANGLE) return deny('openBreech', 'Опустите ствол на угол заряжания (не выше ' + C.LOAD_ANGLE + '°)');
    return busy('open');
  }
  function closeBreech() {
    const b = state.breech;
    if (breechFree('closeBreech')) return { ok: false, reason: 'Механизм занят' };
    if (!b.open) return ok();
    if (b.shell && !b.rammed) return deny('closeBreech', 'Снаряд на лотке — дошлите его');
    return busy('close');
  }
  function hoistShell(type) {
    const b = state.breech;
    if (breechFree('hoistShell')) return { ok: false, reason: 'Механизм занят' };
    if (!SHELLS[type]) return deny('hoistShell', 'Неизвестный тип снаряда');
    if (!b.open) return deny('hoistShell', 'Затвор закрыт');
    if (b.shell) return deny('hoistShell', 'Снаряд уже подан');
    if (!(state.shells[type] > 0)) return deny('hoistShell', SHELLS[type].plural + ' снаряды кончились');
    state.shells[type]--;
    if (state.shells[type] === 0) radio(CREW.loader.title, SHELLS[type].title + ' — последний, командир. Больше таких нет.', 'bad');
    return busy('hoist', { type });
  }
  function ramShell() {
    const b = state.breech;
    if (breechFree('ramShell')) return { ok: false, reason: 'Механизм занят' };
    if (!b.open) return deny('ramShell', 'Затвор закрыт');
    if (!b.shell) return deny('ramShell', 'На лотке нет снаряда');
    if (b.rammed) return deny('ramShell', 'Снаряд уже дослан');
    return busy('ram');
  }
  function addCharge() {
    const b = state.breech;
    if (breechFree('addCharge')) return { ok: false, reason: 'Механизм занят' };
    if (!b.open) return deny('addCharge', 'Затвор закрыт');
    if (!b.rammed) return deny('addCharge', 'Сначала дошлите снаряд');
    if (b.charges >= C.CHARGES) return deny('addCharge', 'Камора полна');
    return busy('charge');
  }
  function removeCharge() {
    const b = state.breech;
    if (breechFree('removeCharge')) return { ok: false, reason: 'Механизм занят' };
    if (!b.open) return deny('removeCharge', 'Затвор закрыт');
    if (b.charges <= 0) return deny('removeCharge', 'Зарядов нет');
    return busy('uncharge');
  }
  function unload() {
    const b = state.breech;
    if (breechFree('unload')) return { ok: false, reason: 'Механизм занят' };
    if (!b.open) return deny('unload', 'Затвор закрыт');
    if (!b.shell && !b.charges) return deny('unload', 'Орудие не заряжено');
    return busy('unload');
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
    const b = state.breech;
    const shellType = b.shell, charges = b.charges;
    // «вилка»: второй ствол бьёт таким же снарядом из погреба
    let twin = false;
    if (state.fire.salvo) {
      if (state.shells[shellType] > 0) { state.shells[shellType]--; twin = true; }
      else radio('РАСЧЁТ', 'Вилка невозможна: второго снаряда этого типа нет. Выстрел одиночный.', 'bad');
    }
    const sh = launch(shellType, charges, twin ? -SALVO_SPREAD : 0, 0);
    let sh2 = null;
    if (twin) {
      sh2 = launch(shellType, charges, SALVO_SPREAD, sh.tof);
      sh.pair = sh2.n; sh2.pair = sh.n;
      state.history[sh.n - 1].pair = sh2.n; state.history[sh2.n - 1].pair = sh.n;
    }
    // каждый наш выстрел помогает противнику засечь батарею
    // (осветительные и дымовые не в счёт)
    if (shellType !== 'illum' && shellType !== 'smoke') for (const e of state.targets) if (e.alive && e.gun) e.gun.p = Math.min(0.75, e.gun.p + 0.04);
    // вспышка первого выстрела (любого снаряда) выдаёт батарею: засекут по первому разрыву, но не позже DETECT_FLASH с
    if (!state.detected && !sys.detectDue) { sys.detectDue = true; at(DETECT_FLASH, 'detect'); }
    b.shell = null; b.rammed = false; b.charges = 0;
    state.fire.armed = false;
    emit('fired', { id: sh.id, n: sh.n, tof: sh.tof, shell: sh.shell, charges: sh.charges, salvo: twin, ids: twin ? [sh.id, sh2.id] : [sh.id] });
    emit('breech', b);
    // очередь: расчёт сам перезаряжает тем же снарядом и зарядом и стреляет на тех же установках
    const F = state.fire;
    if (F.burstLeft === 0 && F.burst > 1) F.burstLeft = F.burst - 1;
    else if (F.burstLeft > 0) F.burstLeft--;
    if (F.burstLeft > 0) {
      if (state.shells[shellType] <= 0) { F.burstLeft = 0; radio('РАСЧЁТ', 'Очередь прервана: кончились снаряды этого типа.', 'bad'); }
      else { state.shells[shellType]--; busy('auto', { shell: shellType, charges }); }
    }
    touch();
    return { ok: true, tof: sh.tof, salvo: twin };
  }
  /** Один снаряд уходит из ствола. offset — сдвиг точки падения вдоль пеленга, км («вилка»). */
  function launch(shell, charges, offset, tofFixed) {
    const t = state.turret, bat = state.mission.battery;
    const noise = { v: gauss() * 0.0012, el: gauss() * 0.02, az: gauss() * 0.03 };
    const res = shoot(t.bearing, t.elevation, charges, noise);
    const tof = tofFixed || res.tof;
    const n = ++state.shots;
    const wp = windParts(t.bearing), B = t.bearing * RAD;
    const wa = wp.along * tof * KW / 1000 + offset, wc = wp.cross * tof * KW / 1000;    // км сноса
    const sh = { id: ++sys.flightId, n, t: 0, tof, shell, charges, pair: null,
      x: bat.x + res.dx + wa * Math.sin(B) + wc * Math.cos(B),
      y: bat.y + res.dy + wa * Math.cos(B) - wc * Math.sin(B), bearing: t.bearing, elevation: t.elevation };
    state.flight.push(sh);
    state.history.push({ n, time: r1(state.time), shell, charges, bearing: t.bearing, elevation: t.elevation, x: null, y: null, hit: false, targetId: null, reportText: null, pair: null });
    return sh;
  }
  /** Противник засёк батарею: с этого момента его орудия бьют прицельно (до конца боя; в обороне — на все волны). */
  function detect() {
    if (!playing() || state.detected) return;
    state.detected = true; state.detectedAt = r1(state.time);
    // прицельный огонь начинается не мгновенно: каждому орудию — новая задержка первого выстрела (не раньше уже назначенного)
    for (const t of state.targets) if (t.alive && t.gun) t.gun.next = Math.max(t.gun.next, state.time + 6 + Math.random() * t.gun.period * 0.5);
    // стрелять по батарее пока некому (первая волна обороны без орудий) — игроку скажем, когда появится первое орудие (detectNotice)
    const armed = state.targets.some((t) => t.alive && t.gun);
    if (armed) { state.detectTold = state.detectedAt; radio('ШТАБ', 'Противник засёк батарею по вспышке — ждите ответного огня.', 'bad'); }
    emit('detected', { time: state.detectedAt, armed });
    touch();
  }
  /** Батарею засекли, когда стрелять по ней было некому: о засечке сообщаем один раз — с появлением первой цели с орудиями. */
  function detectNotice() {
    if (!playing() || !state.detected || state.detectTold != null || !state.targets.some((t) => t.alive && t.gun)) return;
    state.detectTold = r1(state.time);
    radio('ШТАБ', 'Батарея давно засечена — орудия противника бьют прицельно с первого залпа.', 'bad');
    emit('detected', { time: state.detectedAt, armed: true, late: true });
  }
  /** «Вилка»: залп двумя стволами с разносом ±0,15 км по дальности. */
  function setSalvo(v) { state.fire.salvo = !!v; changed(); return ok(); }
  /** Сколько выстрелов в очереди (1…3). */
  function setBurst(n) { state.fire.burst = clamp(Math.round(n), 1, 3); state.fire.burstLeft = 0; changed(); return ok(); }

  // ---------- повреждения и ремонт ----------
  const armorK = () => 1 - 0.1 * upg('armor');
  /** Отказ узла: с вероятностью dmg·0.07 (или заданной p). */
  function breakSomething(dmg, p) {
    const ok2 = Object.keys(FAULTS).filter((k) => !state.faults[k]);
    if (!ok2.length || Math.random() > (p == null ? dmg * 0.07 : p)) return;
    const k = ok2[Math.floor(Math.random() * ok2.length)];
    state.faults[k] = true;
    radio('ШТАБ', 'Повреждение! Отказал ' + FAULTS[k].name + '. ' + FAULTS[k].fix + ' Отправьте ремонтную команду.', 'bad');
    emit('fault', { kind: k });
  }
  /** Урон батарее (уже с учётом брони). → false, если бой на этом кончился. */
  function hitBattery(dmg, by, extra, lostReason) {
    state.integrity = Math.max(0, state.integrity - dmg);
    emit('batteryHit', { damage: dmg, by, ...(extra || {}) });
    if (state.integrity <= 0) { radio('ШТАБ', 'Батарея разбита!', 'bad'); finish(false, lostReason); return false; }
    woundRoll();
    if (state.integrity <= 35 && !state.mission.warned) { state.mission.warned = true; radio('ШТАБ', 'Батарея получила тяжёлые повреждения! Подавите огневые точки противника.', 'bad'); }
    return true;
  }
  function repair(kind) {
    if (!playing()) return deny('repair', 'Бой не идёт');
    if (!state.faults[kind]) return deny('repair', 'Этот узел исправен');
    if (state.repair) return deny('repair', 'Ремонтная команда уже занята');
    state.repair = { kind, t: 0, dur: REPAIR_TIME * crewK() * (1 - 0.2 * upg('repair')) };
    radio('РАСЧЁТ', 'Ремонтная команда приступила: ' + FAULTS[kind].name + '.');
    touch(); return ok();
  }

  // ---------- свои ----------
  const friendVoice = (f) => (f.convoy ? 'КОНВОЙ' : 'ДОЗОР');
  /** Попадание по своему кораблю. by: 'own' | 'enemy'. */
  function hurtFriend(f, dmg, by) {
    const S = state.stats;
    f.hp = Math.max(0, f.hp - dmg); f.burning = true;
    if (by === 'own') S.friendlyHits++;
    if (f.hp > 0) {
      radio(friendVoice(f), by === 'own' ? f.name + ': «Утёс», прекратить огонь! Бьёте по своим!' : f.name + ': попадание, держимся на плаву!', 'bad');
      emit('friend', { id: f.id, hit: true, by });
      return;
    }
    f.alive = false; f.sinking = { since: state.time, dur: SINK_TIME };
    if (by === 'own') S.friendlyKills++;
    if (f.convoy) S.convoyLost++;
    radio('ШТАБ', by === 'own' ? f.name + ' потоплен вашим огнём! Под трибунал пойдёте, командир.' : f.name + ' потоплен противником!', 'bad');
    emit('friend', { id: f.id, hit: true, by });
    emit('friend', { id: f.id, sunk: true, by });
  }
  function friendsTick(dt) {
    for (const f of state.friends) {
      if (!f.alive || f.arrived || !f.path || f.speed <= 0) continue;
      let ds = (f.speed / 3600) * dt, guard = 0;
      while (ds > 0 && guard++ < 8) {
        const w = f.path[f.leg], dx = w.x - f.x, dy = w.y - f.y, L = Math.hypot(dx, dy);
        if (L > ds) { f.x += (dx / L) * ds; f.y += (dy / L) * ds; f.heading = Math.round(bearingTo(dx, dy)); break; }
        f.x = w.x; f.y = w.y; ds -= L;
        if (f.loop) { if (f.leg + f.dir < 0 || f.leg + f.dir >= f.path.length) f.dir = -f.dir; f.leg += f.dir; }
        else if (f.leg < f.path.length - 1) f.leg++;
        else {
          f.speed = 0;
          if (f.convoy) {
            f.arrived = true; state.stats.convoyArrived++;
            radio('КОНВОЙ', f.name + ' дошёл до порта. Спасибо, «Утёс»!', 'good');
            emit('friend', { id: f.id, arrived: true });
            checkEnd();
          }
          break;
        }
      }
    }
  }
  /** Ближайший к точке корабль конвоя, который ещё в пути. */
  function convoyNear(x, y) {
    let best = null, bd = 1e9;
    for (const f of state.friends) {
      if (!f.convoy || !f.alive || f.arrived) continue;
      const d = Math.hypot(f.x - x, f.y - y);
      if (d < bd) { bd = d; best = f; }
    }
    return best ? { f: best, d: bd } : null;
  }

  // ---------- налёт и зенитка ----------
  const planeEl = (range) => 6 + 29 * (1 - clamp((range - PLANE_DROP) / (PLANE_START - PLANE_DROP), 0, 1));
  function raidStart(n, from) {
    state.raidWarn = null;
    if (!playing()) return;
    n = clamp(Math.round(n) || 2, 1, 4);
    const planes = [];
    for (let i = 0; i < n; i++) {
      const range = PLANE_START + i * 0.5;
      planes.push({ id: ++sys.planeId, bearing: r1(norm360(from + (i - (n - 1) / 2) * 5 + (Math.random() - 0.5) * 2)), elevation: r1(planeEl(range)), range, alive: true, attacked: false, hit: 0 });
    }
    if (state.raid) { state.raid.planes.push(...planes); state.raid.phase = 'inbound'; }
    else state.raid = { phase: 'inbound', planes, from };
    radio('ШТАБ', 'Налёт! Самолётов: ' + n + ', заходят с пеленга ' + fmtBrg(from) + '.', 'bad');
    emit('raid', { phase: 'start', planes: n, from });
  }
  function raidTick(dt) {
    const R = state.raid, a = state.aa;
    // автомат
    if (a.jammed && a.heat < AA_UNJAM) { a.jammed = false; radio('РАСЧЁТ', 'Зенитный автомат остыл — можно стрелять.', 'good'); emit('aa', { jammed: false }); }
    const shooting = a.firing && !a.jammed && a.ammo > 0 && playing();
    if (shooting) {
      a.heat = Math.min(1, a.heat + AA_HEAT * dt);
      sys.aaAcc += AA_RATE * dt;
      const n = Math.floor(sys.aaAcc);
      if (n) { sys.aaAcc -= n; a.ammo = Math.max(0, a.ammo - n); if (a.ammo === 0) radio('РАСЧЁТ', 'Зенитные патроны кончились!', 'bad'); }
      if (a.heat >= 1) { a.jammed = true; radio('РАСЧЁТ', 'Зенитный автомат заклинило — перегрев! Пусть остынет.', 'bad'); emit('aa', { jammed: true }); }
    } else a.heat = Math.max(0, a.heat - AA_COOL * dt);
    if (!R) return;
    for (const p of R.planes) {
      if (!p.alive) continue;
      if (shooting && p.range <= C.AA_RANGE && angSep(a.bearing, a.elevation, p.bearing, p.elevation) < C.AA_CONE) {
        p.hit += dt;
        if (p.hit >= PLANE_KILL) {
          p.alive = false; p.downAt = state.time; state.stats.planesDown++;
          radio('РАСЧЁТ', 'Самолёт сбит!', 'good');
          emit('plane', { id: p.id, down: true });
          continue;
        }
      }
      if (!p.attacked) {
        p.range -= PLANE_SPEED * dt;
        if (p.range <= PLANE_DROP) {
          // бомбы; дальше самолёт проходит над батареей и уходит
          p.range = PLANE_DROP; p.attacked = true; p.bearing = norm360(p.bearing + 180); state.stats.bombs++;
          emit('plane', { id: p.id, bombed: true });
          const dmg = Math.max(1, Math.round(BOMB_DMG * armorK()));
          radio('ШТАБ', 'Бомбы на батарее! −' + dmg + ' прочности.', 'bad');
          if (!hitBattery(dmg, 'air', { plane: p.id }, 'Батарея разбита авиацией противника.')) return;
          breakSomething(dmg, BOMB_FAULT);
        }
      } else p.range += PLANE_SPEED * 1.4 * dt;
      p.elevation = r1(planeEl(p.range));
    }
    if (R.phase === 'inbound' && R.planes.every((p) => !p.alive || p.attacked)) { R.phase = 'over'; at(6, 'raidEnd'); }
  }
  function aimAA(v) {
    const a = state.aa;
    if (v && v.bearing != null && isFinite(v.bearing)) a.bearing = norm360(r2(v.bearing)) % 360;
    if (v && v.elevation != null && isFinite(v.elevation)) a.elevation = r2(clamp(v.elevation, 0, C.AA_EL_MAX));
    changed(); return ok();
  }
  const slewAA = (dB, dE) => aimAA({ bearing: state.aa.bearing + (dB || 0), elevation: state.aa.elevation + (dE || 0) });
  function fireAA(on2) {
    const a = state.aa;
    if (on2 && !playing()) return deny('fireAA', 'Бой не идёт');
    if (on2 && a.jammed) { a.firing = false; return deny('fireAA', 'Автомат заклинило — перегрев'); }
    if (on2 && a.ammo <= 0) { a.firing = false; return deny('fireAA', 'Зенитные патроны кончились'); }
    a.firing = !!on2; changed(); return ok();
  }

  /** Действие одного снаряда в точке падения. → { hits, note, friendly } (note — что случилось с опорной целью). */
  function strike(sh, ref) {
    const bat = state.mission.battery, hits = [], friendly = [];
    let note = null;
    if (sh.shell === 'illum') {
      const l = { x: r2(sh.x), y: r2(sh.y), until: state.time + LIGHT_TIME, n: sh.n };
      state.lights.push(l); emit('light', l);
      return { hits, note: 'illum', friendly };
    }
    if (sh.shell === 'smoke') {
      const d = Math.hypot(sh.x - bat.x, sh.y - bat.y);
      const cover = d >= SMOKE_MIN && d <= SMOKE_MAX;       // прикрывает батарею
      const cv = convoyNear(sh.x, sh.y), convoy = !!(cv && cv.d <= HUNT_SMOKE);   // прикрывает конвой
      if (!cover && !convoy) return { hits, note: d < SMOKE_MIN ? 'smokeNear' : 'smokeFar', friendly };
      const sm = { x: r2(sh.x), y: r2(sh.y), bearing: r1(bearingTo(sh.x - bat.x, sh.y - bat.y)), until: state.time + SMOKE_TIME, n: sh.n, cover, convoy };
      state.smokes.push(sm); emit('smoke', sm);
      return { hits, note: 'smoke', friendly };
    }
    state.targets.forEach((t) => {
      if (!t.alive) return;
      const d = Math.hypot(t.x - sh.x, t.y - sh.y);
      let dmg = 0, nt = null;
      if (sh.shell === 'ap') { if (d <= t.radius) dmg = t.armored ? 2 : 1; }
      else if (t.armored) { if (d <= t.radius) nt = 'armor'; }
      else if (sh.shell === 'shrap') {
        if (t.kind === 'landing') { if (d <= t.radius * 3) dmg = t.hp; }
        else if (d <= t.radius) dmg = 1;
      }
      else if (d <= t.radius) dmg = 2;
      else if (d <= t.radius * 1.8) dmg = 1;
      if (dmg) {
        t.hp = Math.max(0, t.hp - dmg);
        t.burning = t.maxHp > 1 && t.hp < t.maxHp;
        if (t.hp <= 0) { t.alive = false; t.sinking = { since: state.time, dur: SINK_TIME }; state.kills++; dropArea(t); track(t); }
        hits.push({ target: t, damage: dmg, destroyed: !t.alive });
      }
      if (t === ref) note = dmg ? 'hit' : nt;
    });
    // свои: разрыв ближе 250 м — попадание
    state.friends.forEach((f) => {
      if (!f.alive || f.arrived) return;
      const d = Math.hypot(f.x - sh.x, f.y - sh.y);
      if (d > C.FRIEND_HIT) return;
      const dmg = d <= 0.1 ? 2 : 1;
      hurtFriend(f, dmg, 'own');
      friendly.push({ id: f.id, damage: dmg, destroyed: !f.alive });
    });
    return { hits, note, friendly };
  }
  /** Отклонение разрыва от цели, м: over (+ перелёт), right (+ вправо). В тумане — с точностью до 50 м. */
  function deviation(sh, ref) {
    const bat = state.mission.battery, q = state.mission.weather === 'fog' ? 50 : 10;
    const ux0 = ref.x - bat.x, uy0 = ref.y - bat.y, L = Math.hypot(ux0, uy0) || 1, ux = ux0 / L, uy = uy0 / L;
    const ex = (sh.x - ref.x) * 1000, ey = (sh.y - ref.y) * 1000;
    const o = ex * ux + ey * uy, r = ex * uy - ey * ux;
    return { o, r, q, L, dist: Math.hypot(ex, ey), over: Math.round(o / q) * q, right: Math.round(r / q) * q };
  }
  const sg = (v, n) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(n);
  const fixHint = (over, right, L) => (state.difficulty === 0 && (over || right)
    ? ' Поправка: дальность ' + sg(-over / 1000, 2) + ' км, пеленг ' + sg(-(right / (L * 1000)) / RAD, 1) + '°.' : '');
  /** Падение одного снаряда или пары («вилка»): урон, один доклад корректировщика, записи в журнал. */
  function impact(group) {
    if (!state.detected) detect();       // первый свой разрыв — батарея засечена
    const night = state.mission.night, noSpotter = state.mission.noSpotter;
    let ref = active();
    const first = group[0];
    if (!ref || !ref.alive) ref = state.targets.filter((t) => t.alive && (t.reported || t.area)).sort((a, b) => Math.hypot(a.x - first.x, a.y - first.y) - Math.hypot(b.x - first.x, b.y - first.y))[0] || null;
    const res = group.map((sh) => strike(sh, ref));
    const hits = [].concat(...res.map((r) => r.hits));
    const notes = res.map((r) => r.note);
    if (notes.includes('illum')) lightScan();

    let report = null, text = null;
    const special = notes.find((n) => n === 'illum' || n === 'smoke' || n === 'smokeNear' || n === 'smokeFar');
    if (special) {
      if (special === 'illum') {
        const seen = state.targets.filter((t) => t.alive && t.lit);
        text = 'Осветительный горит.' + (night ? (seen.length ? ' В свете: ' + seen.map((t) => t.label).join(', ') + '.' : ' Целей в свете не видно.') : ' Днём от него толку нет.');
      } else if (notes.includes('smoke')) {
        const sm = state.smokes[state.smokes.length - 1];
        const cov = sm.cover ? state.targets.filter((t) => t.alive && t.gun && smoked(t)).length : 0;
        text = 'Дымовая завеса поставлена по пеленгу ' + fmtBrg(sm.bearing) + '.' + (sm.convoy ? ' Конвой прикрыт от огня охотников.' : '') +
          (cov ? ' Прикрывает батарею от огня: ' + cov + '.' : sm.convoy ? '' : ' Но орудий противника за ней нет.');
      } else text = 'Дым лёг ' + (special === 'smokeNear' ? 'слишком близко' : 'слишком далеко') + ' — батарею не прикрывает. Кладите завесу в 1–4 км от «Утёса».';
      report = { targetId: ref ? ref.id : null, over: 0, right: 0, text, time: state.time, observed: false, special: first.shell };
    } else if (ref) {
      const dv = group.map((sh) => deviation(sh, ref));
      const near = dv.reduce((a, b2) => (b2.dist < a.dist ? b2 : a));
      let over = near.over, right = near.right, observed = near.dist <= 3000, bracket = false, dark = false, blind = false;
      if (notes.includes('hit')) text = null;
      else if (noSpotter) { blind = true; observed = false; over = 0; right = 0; text = null; }
      else if (night && ref.locate === 'recon' && !lit(ref.x, ref.y)) {
        dark = true; observed = false; over = 0; right = 0;
        text = ref.label + ': цель не освещена — разрыв относительно цели не наблюдаю.';
      }
      else if (notes.includes('armor')) text = ref.label + ': попадание, броня не пробита! Нужен бронебойный.';
      else if (near.dist > 3000) text = ref.label + ': разрыва не наблюдаю. Проверьте установки.';
      else if (dv.length === 2 && dv[0].o * dv[1].o < 0) {
        // цель между разрывами по дальности
        bracket = true;
        const q = near.q;
        over = Math.round((dv[0].o + dv[1].o) / 2 / q) * q; right = Math.round((dv[0].r + dv[1].r) / 2 / q) * q;
        text = ref.label + ': ВИЛКА! Цель между разрывами' + (right ? ', ' + (right > 0 ? 'вправо ' : 'влево ') + Math.abs(right) : '') + '.' + fixHint(over, right, near.L);
      } else {
        const parts = [];
        if (over) parts.push((over > 0 ? 'перелёт ' : 'недолёт ') + Math.abs(over));
        if (right) parts.push((right > 0 ? 'вправо ' : 'влево ') + Math.abs(right));
        text = ref.label + ': ' + (parts.join(', ') || 'накрытие, без поражения') + '.' + fixHint(over, right, near.L);
      }
      report = { targetId: ref.id, over, right, text, time: state.time, observed, bracket, dark, blind };
    }
    // доклад с текстом идёт по радио с задержкой; попадания видны сразу
    if (report) {
      if (text) {
        const delay = SPOT_DELAY * (1 - 0.25 * upg('spotter')) * crewFactor('radio');
        report.delay = r2(delay);
        sys.pending++; state.reportDue = state.time + delay;
        at(delay, 'report', { report });
      } else { report.delay = 0; state.lastReport = report; }
    }
    const said = text ? [text] : [];
    hits.forEach((h) => {
      const m = h.destroyed ? h.target.label + ' (' + h.target.name.toLowerCase() + ') уничтожена!' : 'Попадание! ' + h.target.label + ' повреждена, продолжайте огонь.';
      radio(noSpotter ? 'РАЗВЕДКА' : 'КОРРЕКТИРОВЩИК', m, 'good'); said.push(m); h.msg = m;
      if (h.destroyed) emit('targetDestroyed', h.target);
    });
    const cur = active();
    if (!cur || !cur.alive) { const nx = state.targets.find((t) => t.alive && (t.reported || t.area)); if (nx) state.activeTarget = nx.id; }
    const seen = (q) => q.locate === 'sound' || (q.reported && (!night || q.lit || !q.alive));
    group.forEach((sh, gi) => {
      const mine = res[gi].hits;
      const observed = !special && observe(sh, mine);
      // «снимок» окрестностей разрыва для аэрофото на планшете: что было рядом в этот момент
      const snap = state.targets.filter((q) => Math.hypot(q.x - sh.x, q.y - sh.y) < 1.2 && seen(q))
        .map((q) => ({ id: q.id, kind: q.kind, x: q.x, y: q.y, course: q.course, moving: q.moving, alive: q.alive, damaged: q.hp < q.maxHp, armored: q.armored }));
      const craters = state.impacts.filter((q) => Math.hypot(q.x - sh.x, q.y - sh.y) < 1).map((q) => ({ x: q.x, y: q.y, n: q.n }));
      state.impacts.push({ n: sh.n, x: sh.x, y: sh.y, time: state.time, shell: sh.shell, hit: mine.length > 0, targetId: ref ? ref.id : null, snap, craters, land: isLand(state.mission.map, sh.x, sh.y), pair: sh.pair, observed });
      if (state.impacts.length > 40) state.impacts.shift();
      const h = state.history[sh.n - 1];
      if (h) Object.assign(h, { x: r2(sh.x), y: r2(sh.y), hit: mine.length > 0, targetId: mine.length ? mine[0].target.id : (ref ? ref.id : null), reportText: (group.length > 1 ? [text].concat(mine.map((q) => q.msg)).filter(Boolean).join(' ') : said.join(' ')) || null, impactTime: r1(state.time) });
      // доклад прикладываем к последнему снаряду группы, чтобы интерфейс не показал его дважды
      emit('impact', { report: gi === group.length - 1 ? report : null, hits: mine, friendly: res[gi].friendly, x: sh.x, y: sh.y, shell: sh.shell, n: sh.n, pair: sh.pair, observed });
    });
    touch();
    checkEnd();
  }
  /** Прикрыта ли батарея дымом от огня этой цели. */
  function smoked(t) {
    const bat = state.mission.battery, b = bearingTo(t.x - bat.x, t.y - bat.y);
    return state.smokes.some((sm) => sm.until > state.time && sm.cover !== false && Math.abs(angDiff(b, sm.bearing)) <= SMOKE_ARC);
  }
  /** Ночь: кто попал в свет — того видит разведка. */
  function lightScan() {
    if (!state.mission.night) return;
    for (const t of state.targets) {
      if (!t.alive || !t.active || t.locate !== 'recon') continue;
      const L = lit(t.x, t.y);
      if (L && !t.lit) { t.lit = true; recon(t, true); }
      else if (!L && t.lit) { t.lit = false; emit('recon', t); }
    }
  }

  // ---------- конец задания ----------
  function checkEnd() {
    if (!playing() || sys.endScheduled) return;
    const end = (won, reason) => { sys.endScheduled = true; at(2, 'finish', { won, reason: reason || null }); };
    // конвой: все потоплены — поражение; все уцелевшие дошли — победа
    const conv = state.friends.filter((f) => f.convoy);
    if (conv.length) {
      const live = conv.filter((f) => f.alive);
      if (!live.length) return end(false, 'Конвой уничтожен.');
      if (live.every((f) => f.arrived)) return end(true);
    }
    const alive = state.targets.filter((t) => t.alive);
    const surv = state.mission.survival;
    if (!alive.length) { if (!surv) end(true); return; }
    const b = state.breech, inFlight = state.flight.length > 0, loadedNow = !!b.shell;
    if (inFlight || loadedNow) return;
    // осветительные и дымовые вреда не наносят; фугас и шрапнель не берут броню
    const anySoft = alive.some((t) => !t.armored), S = state.shells;
    const canHurt = S.ap > 0 || ((S.he > 0 || S.shrap > 0) && anySoft);
    // конвой ещё идёт — без снарядов бой продолжается: он может дойти сам
    if (!canHurt && !conv.some((f) => f.alive && !f.arrived)) end(false, 'Боезапас израсходован, цели не уничтожены.');
  }
  /** Счёт задания дня. */
  function dailyScore(won, stars, stats) {
    if (!won) return 0;
    return Math.max(0, 1000 * stars + 6 * stats.integrity + Math.max(0, 600 - Math.round(stats.time)) + Math.max(0, 400 - 20 * stats.combatShots)
      - 300 * stats.friendlyHits - 100 * stats.bombs);
  }
  function finish(won, reason) {
    if (!playing()) return;
    state.phase = won ? 'won' : 'lost';
    state.aa.firing = false;
    const surv = state.mission.survival, S = state.stats;
    state.targets.forEach((t) => { if (t.alive && t.active) track(t); });
    let par = 0;
    state.targets.forEach((t) => { par += Math.ceil(t.maxHp / 2) + 1 + (t.moving ? 1 : 0); });
    const n = state.targets.length;
    // в зачёт идут только боевые выстрелы: осветительные и дымовые оценку не портят
    const combat = state.history.filter((h) => h.shell !== 'illum' && h.shell !== 'smoke').length;
    let stars = !won ? 0 : combat <= par && state.integrity >= 60 ? 3 : combat <= par + n * 2 ? 2 : 1;
    // потеря корабля конвоя — минус звезда; каждый потопленный своим огнём — ещё минус звезда
    if (won) stars = Math.max(1, stars - (S.convoyLost > 0 ? 1 : 0) - S.friendlyKills);
    const idx = state.mission.index;
    if (won && idx != null) {
      save.stars[idx] = Math.max(save.stars[idx] || 0, stars);
      save.unlocked = Math.max(save.unlocked, Math.min(CAMPAIGN.length, idx + 2));
    }
    const destroyed = surv ? state.kills : state.targets.filter((t) => !t.alive && !t.escaped).length;
    const stats = { shots: state.shots, combatShots: combat, par, time: state.time, integrity: Math.round(state.integrity), destroyed, total: n,
      friendlyHits: S.friendlyHits, friendlyKills: S.friendlyKills, convoyLost: S.convoyLost, convoyArrived: S.convoyArrived,
      convoyTotal: state.friends.filter((f) => f.convoy).length, planesDown: S.planesDown, bombs: S.bombs, detectedAt: state.detectedAt };
    let record = null;
    if (won && idx != null) {
      const old = save.records[idx] || null;
      const better = !old || stars > old.stars || (stars === old.stars && (stats.shots < old.shots || (stats.shots === old.shots && stats.time < old.time)));
      if (better) save.records[idx] = { stars, shots: stats.shots, time: Math.round(stats.time), integrity: stats.integrity, difficulty: state.difficulty };
      record = { best: save.records[idx], isNew: better, previous: old };
    }
    let survival = null;
    if (surv) {
      const old = save.survivalBest || null, cur = { waves: sys.wavesCleared, kills: state.kills };
      const better = !old || cur.waves > old.waves || (cur.waves === old.waves && cur.kills > old.kills);
      if (better) save.survivalBest = cur;
      survival = { waves: cur.waves, kills: cur.kills, best: save.survivalBest, isNew: better, previous: old };
    }
    let daily = null;
    const date = state.mission.daily;
    if (date) {
      const score = dailyScore(won, stars, stats), old = dailyBest(date);
      const isNew = won && (!old || score > old.score);
      if (isNew) save.daily = { date, score, stars };
      daily = { date, score, best: dailyBest(date), isNew, previous: old };
    }
    // опыт расчёта и звание
    const before = rankNow();
    const xpGained = (surv ? 50 * sys.wavesCleared : won ? stars * 100 + 20 * destroyed : 0) + PLANE_XP * S.planesDown;
    save.xp = (save.xp || 0) + xpGained;
    save.resume = null;
    const rk = rank();
    persist();
    emit('phase', state.phase);
    emit('missionEnd', { won, stars, reason: reason || null, stats, record, survival, daily, xpGained, rank: rk, rankUp: rk.index > before, points: points(), history: state.history, tracks: state.tracks });
    changed();
  }

  // ---------- оборона ----------
  function waveCleared() {
    sys.waveBusy = true; sys.wavesCleared++;
    const n = state.wave;
    state.integrity = Math.min(100, state.integrity + 25);
    state.medkits = Math.min(3, state.medkits + 1);
    for (const k of SHELL_TYPES) state.shells[k] += RESUPPLY[k];
    radio('ШТАБ', 'Волна ' + n + ' отбита! Батарею подлатали (+25), подвезли снаряды. Следующая волна — через ' + WAVE_PAUSE + ' секунд.', 'good');
    emit('wave', { wave: n, cleared: true });
    at(WAVE_PAUSE, 'nextWave', { n });
  }
  const sinkingNow = (t) => !!t.sinking && !t.sunk;
  /** Оборона: убрать цели прошлых волн вместе с их следами; выбранная цель не должна указывать в пустоту. */
  function dropTargets(keep) {
    for (const t of state.targets) if (!keep(t)) delete state.tracks[t.id];
    state.targets = state.targets.filter(keep);
    if (state.activeTarget != null && !active()) state.activeTarget = null;
  }
  function nextWave(n) {
    if (!playing()) return;
    for (const t of state.targets) if (!t.alive) { delete state.plot.pins[t.id]; delete state.plot.recorded[t.id]; }
    // те, кто ещё тонет, остаются до конца погружения
    dropTargets((t) => t.alive || sinkingNow(t));
    state.plot.lines = [];
    state.wave = n + 1;
    const w = survivalWave(state.wave, state.difficulty);
    const old = state.mission.wind;
    if (w.wind.speed && (w.wind.speed !== old.speed || w.wind.from !== old.from)) setWind(w.wind.from, w.wind.speed, 'Ветер ');
    const made = spawnTargets(w.targets);
    sys.waveIds = made.map((t) => t.id);
    schedule(made);
    if (!(active() && active().alive)) state.activeTarget = null;
    radio('ШТАБ', 'Волна ' + state.wave + ' на подходе!', 'bad');
    detectNotice();
    // каждая третья волна — с авиацией
    if (state.wave % 3 === 0) {
      const from = Math.round(300 + Math.random() * 120) % 360, planes = Math.min(4, 2 + Math.floor((state.wave - 3) / 3));
      at(10, 'raidWarn', { from }); at(20, 'raidStart', { planes, from });
    }
    emit('wave', { wave: state.wave, cleared: false });
    sys.waveBusy = false;
    touch();
  }
  /** Цель ушла / высадилась. → true, если бой на этом кончился. */
  function lost(t, from, msg, reason) {
    t.alive = false; t.escaped = true; dropArea(t); track(t);
    radio(from, msg, 'bad');
    if (!state.mission.survival) { finish(false, reason); return true; }
    state.integrity = Math.max(0, state.integrity - ESCAPE_COST);
    emit('batteryHit', { damage: ESCAPE_COST, by: t.id, escape: true });
    if (state.integrity <= 0) { radio('ШТАБ', 'Оборона прорвана!', 'bad'); finish(false, 'Оборона прорвана: противник прошёл мимо батареи.'); return true; }
    radio('ШТАБ', 'Прорыв противника: −' + ESCAPE_COST + ' прочности.', 'bad');
    return false;
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
      if (b.busy.t >= b.busy.dur) { const job = b.busy; b.busy = null; BREECH_DONE[job.kind](b, job.arg); emit('breech', b); checkEnd(); }
    }
    // ремонт
    if (state.repair) {
      const r = state.repair; r.t += dt; dirty = true;
      if (r.t >= r.dur) { state.faults[r.kind] = false; state.repair = null; radio('РАСЧЁТ', 'Исправлено: ' + FAULTS[r.kind].name + '.', 'good'); emit('fault', { kind: r.kind, fixed: true }); }
    }
    // снаряды в полёте (пара «вилки» падает вместе)
    for (const sh of state.flight) { sh.t += dt; dirty = true; }
    for (;;) {
      const sh = state.flight.find((q) => q.t >= q.tof);
      if (!sh) break;
      const group = [sh];
      if (sh.pair != null) { const mate = state.flight.find((q) => q.n === sh.pair); if (mate) group.push(mate); }
      group.sort((a, b2) => a.n - b2.n);
      state.flight = state.flight.filter((q) => !group.includes(q));
      impact(group);
      if (!playing()) return;
    }
    // свет и дым гаснут
    if (state.lights.length && state.lights.some((l) => l.until <= state.time)) { state.lights = state.lights.filter((l) => l.until > state.time); dirty = true; }
    if (state.smokes.length && state.smokes.some((l) => l.until <= state.time)) { state.smokes = state.smokes.filter((l) => l.until > state.time); dirty = true; }
    // цели
    const map = state.mission.map, bat = state.mission.battery, night = state.mission.night;
    if (night) lightScan();
    let gone = false;
    for (const t of state.targets) {
      if (!t.alive) {
        if (sinkingNow(t) && state.time >= t.sinking.since + t.sinking.dur) { t.sunk = true; dirty = true; if (state.mission.survival && !sys.waveIds.includes(t.id)) gone = true; }
        continue;
      }
      if (!t.active) continue;
      const sees = t.locate === 'recon' && (!night || t.lit);      // разведка видит цель
      if (t.moving) {
        const prey = t.hunts ? convoyNear(t.x, t.y) : null;
        if (prey) t.course = Math.round(prey.d > HUNT_STANDOFF ? bearingTo(prey.f.x - t.x, prey.f.y - t.y) : prey.f.heading);
        const ds = (t.speed / 3600) * dt;
        t.x += ds * Math.sin(t.course * RAD); t.y += ds * Math.cos(t.course * RAD);
        t.pathLeft -= ds;
        const out = t.x < 0.3 || t.x > MAP - 0.3 || t.y > MAP - 0.3;
        if (t.end === 'hunt') {
          if (out) { t.x = clamp(t.x, 0.3, MAP - 0.3); t.y = Math.min(t.y, MAP - 0.3); if (!prey) t.course = norm360(t.course + 180); }
        } else if (t.end === 'land') {
          if (t.y <= coastAt(map, t.x) + 0.25) { if (lost(t, 'ШТАБ', 'Десант высадился на берег!', 'Десант противника высадился на берег.')) return; continue; }
        } else if (t.end === 'patrol') {
          if (t.pathLeft <= 0 || out) { t.course = norm360(t.course + 180); t.pathLeft = t.pathLen; track(t); if (sees) recon(t, false); }
        } else if (t.pathLeft <= 0 || out) {
          if (t.end === 'dive') { if (lost(t, 'РАЗВЕДКА', t.label + ': подводная лодка погрузилась!', 'Подводная лодка противника погрузилась и ушла.')) return; continue; }
          if (lost(t, 'РАЗВЕДКА', t.label + ' ушла из зоны огня.', t.name + ' противника ушёл из-под огня.')) return;
          continue;
        }
        t.heading = t.course;
        if (sees && state.time >= t.nextRecon) recon(t, false);
        if (night && t.locate === 'recon' && !t.lit && t.area && (t.x < t.area.x0 || t.x > t.area.x1 || t.y < t.area.y0 || t.y > t.area.y1)) announceArea(t, false);
        if (state.time >= t.nextTrack) track(t);
        // охотник бьёт по ближайшему кораблю конвоя
        if (prey && state.time >= t.hunt.next && prey.d <= HUNT_RANGE) {
          t.hunt.next = state.time + 14 + Math.random() * 6;
          t.firedAt = state.time;
          if (night) flashReport(t);
          const f = prey.f;
          const cover = state.smokes.some((sm) => sm.until > state.time && Math.hypot(sm.x - f.x, sm.y - f.y) <= HUNT_SMOKE);
          const hit = Math.random() < HUNT_P * (cover ? SMOKE_K : 1);
          emit('friendFire', { by: t.id, at: f.id, eta: 2 });
          at(2, 'friendShell', { by: t.id, id: f.id, hit });
        }
        dirty = true;
      }
      if (t.gun && state.time >= t.gun.next && state.time >= t.silentUntil) {
        t.gun.next = state.time + t.gun.period * (0.8 + Math.random() * 0.4);
        if (Math.hypot(t.x - bat.x, t.y - bat.y) <= t.gun.range) {
          t.salvos++; t.firedAt = state.time;
          if (t.locate === 'sound') soundReport(t);
          else if (night) flashReport(t);
          const ranging = t.firstSalvo; t.firstSalvo = false;
          if (!state.detected) {
            // батарея не засечена: беспокоящий огонь наугад — снаряд ложится в 0,6–2,5 км, вреда нет; залп слышат звукометристы,
            // вспышку видно ночью — всё как у настоящего выстрела
            if (!sys.harassSaid) { sys.harassSaid = true; at(3, 'harass'); }
            emit('incoming', { by: t.id, eta: 2.4, blind: true });
            at(2.4, 'enemyShell', { by: t.id, hit: false, dmg: 0, blind: true, miss: r2(HARASS_MIN + Math.random() * (HARASS_MAX - HARASS_MIN)) });
          } else {
            // РЛС противника наводит его огонь; дымовая завеса сбивает прицел
            const spot = state.targets.some((q) => q.alive && q.spotter) ? 0.18 : 0;
            const hit = !ranging && Math.random() < Math.min(0.9, t.gun.p + spot) * (smoked(t) ? SMOKE_K : 1);
            emit('incoming', { by: t.id, eta: 2.4 });
            at(2.4, 'enemyShell', { by: t.id, hit, dmg: t.gun.dmg });
          }
          if (t.relocateEvery && t.salvos % t.relocateEvery === 0) { relocate(t); track(t); }
          dirty = true;
        }
      }
    }
    if (gone) dropTargets((t) => t.alive || !t.sunk || sys.waveIds.includes(t.id));
    // свои корабли
    if (state.friends.length) {
      friendsTick(dt); dirty = true;
      for (const f of state.friends) if (!f.alive && sinkingNow(f) && state.time >= f.sinking.since + f.sinking.dur) f.sunk = true;
    }
    // налёт, зенитка
    if (state.raid || state.aa.firing || state.aa.heat > 0) { raidTick(dt); dirty = true; if (!playing()) return; }
    // расчёт
    crewTick(dt);
    // подсказки: темы «НОВОЕ»
    topicsTick(Math.min(dtReal, 0.25));
    // оборона: волна отбита?
    if (state.mission.survival && !sys.waveBusy && sys.waveIds.length && sys.waveIds.every((id) => { const q = target(id); return !q || !q.alive; })) waveCleared();
    // отложенные действия
    if (sys.events.length) {
      const due = sys.events.filter((e) => e.t <= state.time).sort((a, b2) => a.t - b2.t);
      if (due.length) {
        sys.events = sys.events.filter((e) => e.t > state.time);
        for (const e of due) { if (state.phase === 'menu') break; const fn = ACTIONS[e.a]; if (fn) fn(e.p || {}); }
        dirty = true;
      }
    }
    // автосохранение боя
    if (playing() && save.settings.autosave && state.time >= sys.nextAuto) { sys.nextAuto = state.time + AUTOSAVE; writeResume(); }
    if (dirty) touch();
  }

  // ---------- снимок боя ----------
  /** Весь идущий бой — обычный JSON. */
  function snapshot() {
    if (!playing()) return null;
    return clone({ v: SNAP_V, state, sys });
  }
  /** Продолжить бой из снимка (по умолчанию — из save.resume). */
  function restore(snap) {
    const sn = snap || (save.resume && save.resume.snap);
    if (!sn || sn.v !== SNAP_V || !sn.state || !sn.sys || sn.state.phase !== 'playing' || !sn.state.mission) return deny('restore', 'Нет сохранённого боя');
    const c = clone(sn);
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, { phase: 'menu', difficulty: save.difficulty, mission: null, ...freshBattle() }, c.state);
    sys = Object.assign(freshSys(), c.sys);
    sys.nextAuto = state.time + AUTOSAVE;
    state.paused = false; state.aa.firing = false;
    if (![1, 2, 3].includes(state.speed)) state.speed = save.settings.speed;      // скорость — та, что была в момент записи
    if (typeof state.station !== 'string') state.station = 'plot';
    // снимок прежней версии (без правила засечки): батарея, которая уже стреляла, считается засечённой
    if (c.state.detected === undefined) { state.detected = state.shots > 0; state.detectedAt = state.detected ? r1(state.time) : null; }
    // снимок до появления detectTold: если есть кому стрелять по батарее — о засечке уже сообщали
    if (c.state.detectTold === undefined) state.detectTold = state.detected && state.targets.some((t) => t.alive && t.gun) ? state.detectedAt : null;
    if (state.topic && !topicById(state.topic.id)) state.topic = null;
    drove = false;
    updateChecklist();
    emit('phase', state.phase); emit('restored', resumeInfo());
    // бой сохранён в те 10 с, когда «ВОЗДУХ!» уже объявлен, а самолётов ещё нет: тревогу повторяем для интерфейса
    const rw = state.raidWarn;
    if (rw && !state.raid && rw.until > state.time) emit('raid', { phase: 'warning', from: rw.from, eta: rw.until - state.time, restored: true });
    changed();
    return ok();
  }
  const battleKind = () => { const m = state.mission; return m.survival ? 'survival' : m.daily ? 'daily' : m.skirmish ? 'skirmish' : 'campaign'; };
  function writeResume() {
    const m = state.mission;
    save.resume = { snap: snapshot(), title: m.title || m.name, savedAt: r1(state.time), kind: battleKind(), integrity: Math.round(state.integrity) };
    persist();
  }
  /** Сохранить идущий бой (выход с сохранением, приложение уходит в фон). */
  function suspend() {
    if (!playing()) return deny('suspend', 'Бой не идёт');
    writeResume();
    return ok();
  }
  function discardResume() { if (save.resume) { save.resume = null; persist(); } return ok(); }
  function resumeInfo() {
    const r = save.resume;
    return r ? { title: r.title, time: r.savedAt, integrity: r.integrity, kind: r.kind } : null;
  }

  // ---------- улучшения ----------
  function upgrades() {
    return UPG_IDS.map((id) => {
      const u = UPGRADES[id], level = upg(id);
      return { id, title: u.title, desc: u.desc, level, max: UPG_MAX, cost: level < UPG_MAX ? UPG_COST[level] : null, effect: level ? u.eff(level) : 'не установлено', next: level < UPG_MAX ? u.eff(level + 1) : null };
    });
  }
  const inBattle = () => state.phase === 'playing' || state.phase === 'briefing';
  // сохранённый бой несёт в снимке «ПОГРЕБ» того набора, с которым начат: пока он не закончен или не сброшен, набор не меняем
  const RESUME_LOCK = 'Сначала закончите или сбросьте сохранённый бой';
  function buyUpgrade(id) {
    if (!UPGRADES[id]) return deny('buyUpgrade', 'Нет такого улучшения');
    if (inBattle()) return deny('buyUpgrade', 'Улучшения ставят между боями');
    if (save.resume) return deny('buyUpgrade', RESUME_LOCK);
    const level = upg(id);
    if (level >= UPG_MAX) return deny('buyUpgrade', 'Улучшение уже на высшем уровне');
    if (points() < UPG_COST[level]) return deny('buyUpgrade', 'Не хватает очков снабжения');
    save.upgrades[id] = level + 1;
    persist(); emit('upgrades', upgrades()); changed();
    return ok();
  }
  function resetUpgrades() {
    if (inBattle()) return deny('resetUpgrades', 'Улучшения меняют между боями');
    if (save.resume) return deny('resetUpgrades', RESUME_LOCK);
    for (const id of UPG_IDS) save.upgrades[id] = 0;
    persist(); emit('upgrades', upgrades()); changed();
    return ok();
  }

  // ---------- настройки ----------
  const settings = () => ({ ...save.settings });
  /** Изменить одну настройку. Неизвестный ключ или значение вне области — отказ, ничего не меняется.
   *  Исключение: sens вне 0.6…1.6 обрезается до границы (маховик настройки может «перелететь»). */
  function setSetting(key, value) {
    const d = Object.prototype.hasOwnProperty.call(SETTINGS, key) ? SETTINGS[key] : null;
    if (!d) return deny('setSetting', 'Нет такой настройки');
    let v = value;
    if (key === 'sens') { if (typeof v !== 'number' || !isFinite(v)) return deny('setSetting', 'Неверное значение'); v = clamp(v, 0.6, 1.6); }
    if (!d.ok(v)) return deny('setSetting', 'Неверное значение');
    save.settings[key] = d.fix ? d.fix(v) : v;
    persist(); emit('settings', settings());
    return ok();
  }
  /** Все настройки — по умолчанию (и звук включён). Сложность и прогресс не трогает. */
  function resetSettings() {
    save.settings = settingDefaults(); save.muted = false;
    persist(); emit('settings', settings()); changed();
    return ok();
  }
  /** Стереть весь прогресс (звёзды, рекорды, открытые задания, опыт, улучшения, оборону, задание дня, сохранённый бой).
   *  Настройки, звук и сложность остаются, если не передано { settings: true }. Идущий бой сначала бросается. */
  function resetProgress(o) {
    const all = !!(o && o.settings);
    if (state.phase !== 'menu') quit();
    const keep = { settings: save.settings, muted: save.muted, difficulty: save.difficulty };
    for (const k of Object.keys(save)) delete save[k];
    Object.assign(save, freshSave(), all ? { settings: settingDefaults() } : keep);
    for (const id of UPG_IDS) save.upgrades[id] = 0;
    state.difficulty = save.difficulty;
    persist();
    emit('save', save); emit('upgrades', upgrades());
    if (all) emit('settings', settings());
    changed();
    return ok();
  }

  // ---------- подсказки ----------
  /** Что показывать в этом бою: 'steps' — процедура по шагам, 'topics' — только темы «НОВОЕ», 'off' — ничего. */
  function hintMode() {
    if (!playing()) return 'off';
    const h = save.settings.hints;
    if (h === 'off') return 'off';
    if (h === 'all') return 'steps';
    const i = state.mission.index;
    return i != null && i < STEP_MISSIONS ? 'steps' : 'topics';
  }
  const topicCtx = () => ({ s: state, m: state.mission, t: state.time, a: active(), g: game, d: state.difficulty, since: state.topic ? state.topic.since : state.time });
  const ask = (fn, c) => { try { return !!fn(c); } catch (e) { return false; } };
  function learn(id) {
    if (save.learned[id]) return;
    save.learned[id] = true; persist();
    emit('topic', { id, learned: true });
  }
  /** Темы «НОВОЕ»: одна на экране; гаснет по действию игрока, через TOPIC_HOLD с или когда механика ушла — и считается изученной. */
  function topicsTick(dtReal) {
    sys.topicAcc += dtReal;
    if (state.topic) state.topic.shown += dtReal;
    if (sys.topicAcc < 0.2) return;
    sys.topicAcc = 0;
    const mode = hintMode();
    if (mode === 'off') { state.topic = null; return; }
    const c = topicCtx();
    const steps = mode === 'steps';
    // пошаговые подсказки сами ведут игрока через часть механик (тема с steps): встретилась — знакома. Остальные темы
    // (засечка, свой глаз, ремонт, аптечка, очередь…) шаги не объясняют — они показываются и в режиме шагов
    if (steps) for (const q of TOPICS) if (q.steps && !save.learned[q.id] && ask(q.when, c)) learn(q.id);
    // очередь: самая срочная из тех, чья механика сейчас перед игроком (опасность > наводка > удобство; дальше — порядок списка)
    const pick = (minPri, urgent) => {
      let best = null;
      for (const q of TOPICS) if (!q.menu && !(steps && q.steps) && !save.learned[q.id] && (urgent ? q.urgent : q.pri > minPri) && (!best || q.pri > best.pri) && ask(q.when, c) && !(q.done && ask(q.done, c))) best = q;
      return best;
    };
    const show = (q) => { state.topic = { id: q.id, since: state.time, shown: 0 }; emit('topic', { id: q.id, learned: false }); emit('state', state); };
    const cur = state.topic, tp = cur && topicById(cur.id);
    if (cur) {
      const on = !!tp && !(steps && tp.steps) && ask(tp.when, c);
      const over = !tp || (steps && tp.steps) || (tp.done && ask(tp.done, c)) || cur.shown >= Math.min(TOPIC_HOLD, tp.hold || TOPIC_HOLD) || (!on && cur.shown >= TOPIC_MIN);
      if (!over) {
        // более срочная тема не ждёт, пока догорит менее срочная: та уходит неизученной и вернётся позже.
        // Тревога (urgent: налёт, свои под прицелом) вытесняет сразу и любую не-тревогу, даже того же приоритета (отказ узла,
        // ранение); остальные — только более срочные и когда текущая пробыла на экране TOPIC_MIN
        const up = (!tp.urgent && pick(0, true)) || pick(tp.pri);
        if (up && (up.urgent || cur.shown >= TOPIC_MIN)) show(up);
        return;
      }
      state.topic = null;
      if (tp) learn(tp.id);
      emit('state', state);
    }
    let best = pick(0);
    // по шагам: пока игроку есть что делать по процедуре, новое не отвлекает — кроме опасности
    if (best && steps && best.pri < 3 && ask(() => stepOf(game).st, c)) best = null;
    if (best) show(best);
  }
  /** Тема «НОВОЕ», которая сейчас активна: { id, title, more, warn, dom, station } | null. В режиме шагов строка подсказки может
   *  показывать шаг процедуры, а тема — идти только объяснением в строке радио. */
  function topicInfo() {
    if (hintMode() === 'off') return null;
    const tp = state.topic && topicById(state.topic.id);
    if (!tp) return null;
    return { id: tp.id, title: tp.title, more: typeof tp.text === 'function' ? tp.text(topicCtx()) : tp.text, warn: tp.pri >= 3, dom: tp.dom || null, station: tp.st || null };
  }
  const noHint = () => ({ kind: null, id: null, title: null, text: '', more: '', station: null, hotspot: null, dom: null, warn: false });
  /** Подсказка для экрана боя: { kind: 'step' | 'topic' | null, id, title, text, more, station, hotspot, dom, warn }.
   *  ui (необязательно) — { hasHot(пост, имя) → bool, shellType() } от интерфейса: какие органы управления есть на постах. */
  function hint(ui) {
    const mode = hintMode();
    if (mode === 'off') return noHint();
    const tp = state.topic && topicById(state.topic.id);
    if (mode === 'steps') {
      const st = stepOf(game, ui);
      // шаг есть — в строке он; игроку нечего делать (снаряд в полёте, ждём донесения) — строку занимает активная тема
      if (st.st || !tp) return { ...noHint(), kind: 'step', id: (st.st || 'wait') + (st.hot ? ':' + st.hot : ''), text: st.text, station: st.st || null, hotspot: st.hot || null, warn: !!st.warn };
    }
    if (!tp) return noHint();
    const c = topicCtx(), has = ui && ui.hasHot ? ui.hasHot : () => true;
    let hot = null;
    if (tp.st && tp.hot) { let names = []; try { names = typeof tp.hot === 'function' ? tp.hot(c) : tp.hot; } catch (e) { names = []; } hot = names.find((n) => has(tp.st, n)) || null; }
    const more = typeof tp.text === 'function' ? tp.text(c) : tp.text;
    return { kind: 'topic', id: tp.id, title: tp.title, text: 'НОВОЕ · ' + tp.title, more, station: tp.st || null, hotspot: hot, dom: tp.dom || null, warn: tp.pri >= 3 };
  }
  /** Следующий шаг процедуры выстрела (для пошаговых подсказок): { st, hot, text, warn? } | null вне боя. */
  const nextStep = (ui) => (playing() ? stepOf(game, ui) : null);
  /** Темы, которые вводит текущее задание и которых игрок ещё не знает — блок «НОВОЕ В ЭТОМ ЗАДАНИИ» инструктажа. */
  function briefTopics() {
    if (!state.mission || save.settings.hints === 'off') return [];
    const d = describe(state, state.difficulty);
    return TOPICS.filter((tp) => !tp.menu && tp.intro && !save.learned[tp.id] && ask(tp.intro, d)).map((tp) => ({ id: tp.id, title: tp.title, brief: tp.brief || '', text: typeof tp.text === 'string' ? tp.text : '' }));
  }
  /** Подсказка для меню (всплывающая строка): сейчас одна — «хватает очков на улучшение». → { id, title, text } | null. */
  function menuHint() {
    if (state.phase !== 'menu' || save.settings.hints === 'off' || save.learned.upgrades || save.resume) return null;
    const pts = points();
    if (!UPG_IDS.some((id) => upg(id) < UPG_MAX && UPG_COST[upg(id)] <= pts)) return null;
    const tp = topicById('upgrades');
    return { id: tp.id, title: tp.title, text: tp.text };
  }
  /** Отметить тему изученной (меню показало свою подсказку). */
  function learnTopic(id) { if (!topicById(id)) return deny('learnTopic', 'Нет такой темы'); learn(id); return ok(); }
  /** Игрок сам убрал тему с экрана — изучена. */
  function dismissTopic() { const t = state.topic; if (!t) return deny('dismissTopic', 'Подсказки нет'); state.topic = null; if (topicById(t.id)) learn(t.id); changed(); return ok(); }
  /** «Показать обучение заново»: все темы снова новые. */
  function resetLearned() { save.learned = {}; state.topic = null; persist(); changed(); return ok(); }

  // ---------- свои в зоне поражения ----------
  /** Свои ближе FRIEND_ZONE км к точке прицеливания (замер выбранной цели, решение вычислителя, фактическая наводка
   *  заряженного орудия) → массив своих из state.friends, ближайший к прицелу — первым. Вид снаряда не учитывает. */
  function friendsInDanger() {
    if (!state.mission || state.activeTarget == null) return [];
    const fr = state.friends.filter((f) => f.alive && !f.arrived && !f.sunk);
    if (!fr.length) return [];
    const rec = state.plot.recorded[state.activeTarget], cp = state.computer, bat = state.mission.battery, pts = [];
    const pt = (brg, rng) => pts.push({ x: bat.x + rng * Math.sin(brg * RAD), y: bat.y + rng * Math.cos(brg * RAD) });
    if (rec) { pt(rec.bearing, rec.range); if (cp.elevation != null && !cp.stale) pt(rec.bearing, cp.range); }
    if (cp.elevation != null && state.checklist.loaded) pt(state.turret.bearing - (cp.windBearing || 0), cp.range);
    const near = (f) => Math.min(...pts.map((p) => Math.hypot(p.x - f.x, p.y - f.y)));
    return fr.map((f) => ({ f, d: near(f) })).filter((q) => q.d < FRIEND_ZONE).sort((a, b2) => a.d - b2.d).map((q) => q.f);
  }
  /** Кого заденет выстрел: id ближайшего к прицелу своего или null. Осветительный и дымовой снаряд своим не вредят → null. */
  function friendInDanger() {
    const sh = state.breech.shell;
    if (sh === 'illum' || sh === 'smoke') return null;
    const z = friendsInDanger();
    return z.length ? z[0].id : null;
  }

  /** Где сейчас снаряд (вид сверху): доля пути и точка. Горизонтальная скорость падает из-за сопротивления. */
  function shellPosition(sh) {
    const bat = state.mission.battery, c = 1.1;
    const f = Math.min(1, (1 - Math.exp(-c * sh.t / sh.tof)) / (1 - Math.exp(-c)));
    return { f, x: bat.x + (sh.x - bat.x) * f, y: bat.y + (sh.y - bat.y) * f };
  }

  const game = {
    state, save, C, on, campaign: CAMPAIGN, difficulties: DIFF.map((d) => d.name),
    SHELLS, ranks: RANKS, rank, lit, smoked: (id) => { const t = target(id); return !!(t && state.mission && smoked(t)); }, setSalvo, startSurvival,
    update, startMission, startSkirmish, begin, quit, pause, setSpeed, setStation, setDifficulty, setMuted,
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
    // наблюдательный пост
    setScope, scopeFov, visible, scopeMark,
    // улучшения
    UPGRADES, upgrades, buyUpgrade, resetUpgrades, points,
    // расчёт
    CREW, crewFactor, treat,
    // зенитка
    aimAA, slewAA, fireAA,
    // задание дня
    dailyInfo, startDaily,
    // настройки и сохранение боя
    settings, setSetting, resetSettings, resetProgress, SETTINGS: clone(Object.fromEntries(SETTING_KEYS.map((k) => [k, { def: SETTINGS[k].def, list: SETTINGS[k].list || null }]))),
    snapshot, restore, suspend, discardResume, resumeInfo,
    friendsInDanger, friendInDanger, FRIEND_ZONE,
    // подсказки
    hint, hintMode, topicInfo, nextStep, briefTopics, menuHint, learnTopic, dismissTopic, resetLearned,
    TOPICS: TOPICS.map((tp) => ({ id: tp.id, pri: tp.pri, title: tp.title, station: tp.st || null, hot: Array.isArray(tp.hot) ? tp.hot.slice() : tp.hot ? ['pin1'] : [], dom: tp.dom || null, menu: !!tp.menu })),
  };
  return game;
}
