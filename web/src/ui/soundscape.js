// Звуковая обстановка: события игры → engine.audio. Логики и картинки здесь нет; органы управления звучат сами
// (engine/controls/*), механика постов — в самих постах (loading.js, traverse.js, elevation.js, aa.js — привод).
//
// СОСТОЯНИЯ (проверяются каждый кадр; вызов уходит в звук только при смене):
//   ролик         — тишина: ни музыки, ни фона (у ролика свои звуки)
//   меню, брифинг — музыка меню; фон башни выключен
//   бой           — фон башни: пост (заряжание — механизмы, наблюдение и зенитка — открытый воздух), погода, ночь,
//                   напряжение (растёт от огня противника и налёта, спадает само); музыка молчит
//   пауза в бою   — фон и эффекты приглушены, петли стоят
//   итог боя      — фон уходит, звучит победа/поражение; в меню возвращается музыка
// ПЕТЛИ, выведенные из состояния игры (не могут «зависнуть»: при выходе из боя, паузе, восстановлении — гаснут/встают сами):
//   элеватор (breech.busy 'hoist', пока люлька идёт вверх) · очередь зенитки (state.aa: гашетка нажата, нет клина, есть патроны) ·
//   гул самолётов (ближайший самолёт: громкость по дальности, допплер по подходу/уходу, панорама по пеленгу) ·
//   сирена (state.raidWarn — 10 с до налёта) · ревун неисправности (1.6 с после отказа)
// ПАНОРАМА: пеленг источника относительно того, куда смотрит игрок: на посту ЗЕНИТКА — ось автомата, на НАБЛЮДЕНИИ — труба,
//   на остальных — ствол башни. Слева −, справа +.
const SHIPS = { barge: 1, transport: 1, landing: 1, destroyer: 1, cruiser: 1, minelayer: 1, submarine: 1, tanker: 1, battleship: 1, patrol: 1 };
const RADIO_CLASS = {
  'ШТАБ': 'hq', 'РАЗВЕДКА': 'hq', 'КОРРЕКТИРОВЩИК': 'spotter', 'ЗВУКОМЕТРИЯ': 'spotter', 'МЕТЕО': 'meteo',
  'РАСЧЁТ': 'crew', 'НАВОДЧИК': 'crew', 'ЗАРЯЖАЮЩИЙ': 'crew', 'РАДИСТ': 'crew', 'КОНВОЙ': 'convoy', 'ДОЗОР': 'convoy',
};
const PAN_BREECH = -0.35;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap180 = (a) => { a = ((a + 180) % 360 + 360) % 360; return a - 180; };

export function createSoundscape({ engine, game, shell = null, stations = [] }) {
  const audio = engine.audio, s = game.state, offs = [];
  const A = (name, ...a) => { try { const f = audio && audio[name]; if (typeof f === 'function') return f.apply(audio, a); } catch (e) { /* звук не обязателен */ } return 0; };
  // уровень звука следует за качеством графики: слабый телефон (low) — без реверберации, фон из двух слоёв, моно
  try { if (engine.quality) A('setTier', engine.quality.tier); if (engine.on) offs.push(engine.on('quality', (q) => A('setTier', q && q.tier))); } catch (e) { /* без уровня */ }
  const near = (id) => { const st = stations.find((x) => x && x.id === id); return !!(st && st.group && st.group.visible); };
  const battle = () => s.phase === 'playing';
  const live = () => s.phase === 'playing' && !s.paused;
  const speed = () => s.speed || 1;

  // ----- где что -----
  function bat() { return (s.mission && s.mission.battery) || { x: 10, y: 0 }; }
  function bearingTo(x, y) { const b = bat(); return (Math.atan2(x - b.x, y - b.y) / DEG + 360) % 360; }
  function rangeTo(x, y) { const b = bat(); return Math.hypot(x - b.x, y - b.y); }
  /** Куда смотрит игрок (°): ось зенитки, труба или ствол башни. */
  function facing() {
    const cur = engine.current;
    if (cur === 'aa' && s.aa) return +s.aa.bearing || 0;
    if (cur === 'observe' && s.scope) return +s.scope.bearing || 0;
    return (s.turret && +s.turret.bearing) || 0;
  }
  const panOf = (bearing, k = 0.8) => Math.sin(wrap180(bearing - facing()) * DEG) * k;
  const targetById = (id) => (s.targets || []).find((t) => t.id === id) || (s.friends || []).find((f) => f.id === id) || null;
  const planeById = (id) => (s.raid && s.raid.planes ? s.raid.planes.find((p) => p.id === id) : null);

  // ----- обстановка и музыка -----
  let mode = null, sentAmb = {}, tension = 0, sentTension = -1, ducked = null;
  function wantMode() {
    if (shell && shell.introPlaying) return 'intro';
    if (s.phase === 'playing') return 'battle';
    if (s.phase === 'won' || s.phase === 'lost') return 'end';
    return 'menu';                                    // меню и брифинг
  }
  function stopLoops() {
    A('hoistRun', false); A('aaFire', false, 0); A('planeDrone', 0); A('sirenRun', false); A('alarm', false);
    A('gear', 0); A('servo', 0); A('radioStatic', 0);
    hoistOn = aaOn = sirenOn = alarmOn = false; droneSent = null; alarmUntil = 0;
  }
  function setMode(m) {
    const prev = mode; mode = m;
    if (prev === 'battle') stopLoops();
    if (m === 'battle') {
      sentAmb = {}; tension = 0; sentTension = -1;
      A('music', false);
      syncAmbience();
      A('ambient', true);
    } else {
      A('ambient', false);
      A('music', m === 'menu');
    }
  }
  function syncAmbience() {
    const m = s.mission || {}, want = { station: engine.current || 'plot', weather: m.weather || 'clear', night: !!m.night };
    const diff = {};
    for (const k of Object.keys(want)) if (sentAmb[k] !== want[k]) diff[k] = sentAmb[k] = want[k];
    if (Object.keys(diff).length) A('ambience', diff);
  }
  const addTension = (v) => { tension = clamp(tension + v, 0, 1); };

  // ----- петли из состояния -----
  let hoistOn = false, hoistJob = null, hoistHeard = false, aaOn = false, sirenOn = false, alarmOn = false, alarmUntil = 0;
  let droneSent = null, droneT = 0, autoJob = null, autoP = 0, heatPrev = 0;
  const whistled = new Set();
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

  function loops(dt) {
    const on = live(), b = s.breech, job = b && b.busy;
    // элеватор: цепь и мотор, пока люлька идёт вверх; слышно, если пост ЗАРЯЖАНИЕ (или соседний) был рядом, когда подача началась
    if (job !== hoistJob) { hoistJob = job; hoistHeard = !!job && near('loading'); }
    const p = job ? clamp(job.t / (job.dur || 1), 0, 1) : 0;
    let wantHoist = on && !!job && ((job.kind === 'hoist' && hoistHeard && p < 0.8) || (job.kind === 'auto' && p >= 0.1 && p < 0.38));
    if (wantHoist !== hoistOn) { hoistOn = wantHoist; A('hoistRun', wantHoist); }
    // автоперезарядка очереди: расчёт сам открывает затвор, подаёт, досылает, кладёт заряды и закрывает
    if (job && job.kind === 'auto') {
      if (autoJob !== job) { autoJob = job; autoP = -1; }
      if (on) {
        const g = near('loading') ? 1 : 0.55, o = { gain: g, pan: engine.current === 'loading' ? PAN_BREECH : 0 }, n = (job.arg && job.arg.charges) | 0;
        const cross = (at) => autoP < at && p >= at;
        if (cross(0)) A('breechOpen', o);
        if (cross(0.38)) A('stopper', o);
        if (cross(0.46)) A('ram', o);
        for (let i = 0; i < Math.min(6, n); i++) if (cross(0.56 + i * 0.05)) A('charge', o);
        if (cross(0.88)) A('breechClose', o);
        autoP = p;
      }
    } else autoJob = null;

    // зенитка: очередь, пока автомат реально стреляет; перегрев — шипение один раз на подходе к клину
    const a = s.aa;
    const wantAA = on && !!a && !!a.firing && !a.jammed && a.ammo > 0;
    if (wantAA !== aaOn) { aaOn = wantAA; A('aaFire', wantAA, 0); }
    const heat = a ? +a.heat || 0 : 0;
    if (on && heatPrev < 0.85 && heat >= 0.85 && !a.jammed) A('overheat', { gain: 0.6 });
    heatPrev = heat;

    // самолёты: гул ближайшего, свист бомбы перед сбросом
    let lvl = 0, appr = 0.5, pan = 0;
    if (on && s.raid && s.raid.planes) {
      let best = null;
      for (const q of s.raid.planes) if (q.alive && (!best || q.range < best.range)) best = q;
      if (best) {
        lvl = clamp(1 - best.range / 8, 0.06, 1) * (engine.current === 'aa' ? 1 : 0.6);
        appr = best.attacked ? 0.5 + 0.5 * clamp((best.range - 0.4) / 3, 0, 1) : 0.5 * clamp(1 - (best.range - 0.4) / 6.6, 0, 1);
        pan = panOf(best.bearing, 0.7);
      }
      for (const q of s.raid.planes) {
        if (!q.alive || q.attacked || whistled.has(q.id) || q.range > 0.4 + 0.22 * 1.6) continue;
        whistled.add(q.id);
        A('bombWhistle', clamp((q.range - 0.4) / 0.22, 0.4, 1.8) / speed(), panOf(q.bearing, 0.6));
      }
    }
    droneT -= dt;
    const d = droneSent;
    if (lvl === 0 ? d && d.l > 0 : !d || (droneT <= 0 && (Math.abs(d.l - lvl) > 0.02 || Math.abs(d.a - appr) > 0.02 || Math.abs(d.p - pan) > 0.05))) {
      droneSent = { l: lvl, a: appr, p: pan }; droneT = 0.15;
      A('planeDrone', lvl, appr, pan);
    }

    // сирена: 10 с предупреждения перед налётом
    const wantSiren = on && !!s.raidWarn && s.raidWarn.until > s.time;
    if (wantSiren !== sirenOn) { sirenOn = wantSiren; A('sirenRun', wantSiren); }
    // ревун: 1.6 с после отказа узла
    const wantAlarm = on && now() < alarmUntil;
    if (wantAlarm !== alarmOn) { alarmOn = wantAlarm; A('alarm', wantAlarm); }
  }

  // ----- кадр -----
  offs.push(engine.onFrame((dt) => {
    const m = wantMode();
    if (m !== mode) setMode(m);
    // пауза и окно поверх боя: фон и эффекты тише
    const duck = m === 'battle' && !!s.paused;
    if (duck !== ducked) { ducked = duck; A('duckBus', 'amb', duck ? 0.35 : 1); A('duckBus', 'fx', duck ? 0.5 : 1); }
    if (m !== 'battle') return;
    syncAmbience();
    // напряжение: спадает само (~50 с с максимума), в налёте не ниже 0.5
    if (!s.paused) tension = Math.max(0, tension - dt * 0.02);
    const t = s.raid && s.raid.phase === 'inbound' ? Math.max(tension, 0.5) : tension;
    if (Math.abs(t - sentTension) > 0.05 || (t === 0 && sentTension !== 0)) { sentTension = t; A('tension', Math.round(t * 100) / 100); }
    loops(dt);
  }));
  offs.push(engine.on('station', () => { A('gear', 0); }));

  // ----- события боя -----
  offs.push(game.on('phase', (ph) => { if (ph === 'playing') whistled.clear(); }));
  // свой выстрел: орудие (с шелестом снаряда и приглушением фона); вилка — второй ствол следом
  offs.push(game.on('fired', (e) => {
    if (!battle()) return;
    A('fire');
    if (e && e.salvo) A('play', 'gun', { when: 0.09, gain: 0.6 });
  }));
  // свой разрыв: всплеск / разрыв на берегу / попадание в корабль; задержка и глухота — по дальности
  offs.push(game.on('impact', (e) => {
    if (!battle() || !e) return;
    const range = rangeTo(e.x, e.y), hit = (e.hits && e.hits[0] && e.hits[0].target) || null;
    const fr = e.friendly && e.friendly.length ? targetById(e.friendly[0].id) : null, tgt = hit || fr;
    let land = false; try { land = !!game.isLand(e.x, e.y); } catch (err) { land = false; }
    const kind = tgt ? (SHIPS[tgt.kind] ? 'steel' : 'land') : land ? 'land' : 'water';
    const soft = e.shell === 'illum' || e.shell === 'smoke';
    A('impact', { range, kind, pan: panOf(bearingTo(e.x, e.y)), delay: Math.min(3.5, range * 0.26) / speed(), gain: soft ? 0.35 : 1 });
  }));
  // уничтожена: вторичный взрыв (погреб, котлы) чуть позже первого разрыва
  offs.push(game.on('targetDestroyed', (t) => {
    if (!battle() || !t) return;
    const range = rangeTo(t.x, t.y);
    A('impact', { range, kind: SHIPS[t.kind] ? 'steel' : 'land', pan: panOf(bearingTo(t.x, t.y)), delay: (Math.min(3.5, range * 0.26) + 0.7) / speed(), gain: 0.6 });
  }));
  // противник выстрелил: далёкий залп; по засечённой батарее — свист, который ложится вместе с разрывом
  offs.push(game.on('incoming', (e) => {
    if (!battle() || !e) return;
    const t = targetById(e.by), range = t ? rangeTo(t.x, t.y) : 10, pan = t ? panOf(bearingTo(t.x, t.y)) : 0;
    A('enemyGun', { range: e.blind ? range * 1.4 : range, pan });
    if (!e.blind) A('whistle', (e.eta || 2.4) * 0.92 / speed(), pan * 0.6);
    addTension(e.blind ? 0.08 : 0.22);
  }));
  // разрыв у батареи: попадание — лязг брони; промах — близкий разрыв; беспокоящий огонь — по удалению; бомба — разрыв бомбы
  offs.push(game.on('batteryHit', (h) => {
    if (!battle() || !h || h.escape) return;          // «цель прорвалась» — штраф, а не разрыв (строку озвучит toast)
    let pan = 0;
    if (h.by === 'air') { const q = planeById(h.plane); pan = q ? panOf(q.bearing, 0.5) : 0; } else { const t = targetById(h.by); pan = t ? panOf(bearingTo(t.x, t.y), 0.6) : 0; }
    if (h.by === 'air') { A('bombBurst', { pan, gain: h.damage > 0 ? 1 : 0.7 }); addTension(0.3); return; }
    if (h.damage > 0) { A('turretHit', { pan }); addTension(0.35); return; }
    const miss = h.blind ? +h.miss || 1.5 : 0.4;
    if (miss < 1.2) A('nearMiss', { pan, gain: clamp(0.35 + 0.6 * (1.2 - miss) / 0.8, 0.35, 0.95) });
    else A('impactFar', { pan, lp: clamp(2400 / miss, 500, 2000), gain: 0.8 });
  }));
  offs.push(game.on('fault', (e) => {
    if (!battle() || !e) return;
    if (e.fixed) { A('relay'); A('stopper', { gain: 0.4 }); return; }
    A('fault', { pan: e.kind === 'hoist' ? 0.3 : e.kind === 'drive' ? 0.4 : 0 });
    alarmUntil = now() + 1.6;
  }));
  offs.push(game.on('detected', () => { if (battle() && (s.targets || []).some((t) => t.alive && t.gun)) { A('detected'); addTension(0.15); } }));
  // радио: окраска посылки по отправителю, тревожное — срочным вариантом
  offs.push(game.on('radio', (m) => { if (!m) return; A('radioMsg', RADIO_CLASS[m.from] || 'hq', m.kind === 'bad'); }));
  // свои силы
  offs.push(game.on('friend', (e) => {
    if (!battle() || !e) return;
    const f = targetById(e.id);
    if (e.hit && e.by === 'own') A('friendlyFire');
    else if (e.hit && f) A('impact', { range: rangeTo(f.x, f.y), kind: 'steel', pan: panOf(bearingTo(f.x, f.y)), delay: 0, gain: 0.7 });
  }));
  offs.push(game.on('friendFire', (e) => {
    if (!battle() || !e) return;
    const t = targetById(e.by);
    if (t) A('enemyGun', { range: rangeTo(t.x, t.y), pan: panOf(bearingTo(t.x, t.y)) });
  }));
  // налёт
  offs.push(game.on('raid', (e) => { if (e && e.phase === 'start') addTension(0.3); }));
  offs.push(game.on('plane', (e) => {
    if (!battle() || !e) return;
    const q = planeById(e.id);
    if (e.down && q) A('impact', { range: q.range, kind: 'water', pan: panOf(q.bearing, 0.7), delay: Math.min(3, 0.6 + q.range * 0.4) / speed(), gain: 0.8 });
    else if (e.bombed && q) { const p = panOf(q.bearing, 0.8); A('flyby', { dur: 3.2 / Math.sqrt(speed()), from: p, to: -p * 0.8, gain: 0.8 }); }
  }));
  offs.push(game.on('aa', (e) => {
    if (!battle() || !e) return;
    if (e.jammed) { A('jam'); A('overheat'); } else A('relay');
  }));
  // оборона: волна отбита — короткий перезвон; пришла новая — звонок телеграфа
  offs.push(game.on('wave', (w) => {
    if (!battle() || !w) return;
    if (w.cleared) A('dailyRecord'); else { A('bell', 3); addTension(0.2); }
  }));
  offs.push(game.on('topic', (t) => { if (t && !t.learned && battle()) A('hintNew'); }));
  // итог боя: победа или поражение, затем звание и рекорд дня
  offs.push(game.on('missionEnd', (e) => {
    if (!e) return;
    // стингер — вместе с окном итогов (оболочка показывает его через 1.4 с): сперва дозвучит последний разрыв
    const later = (ms, name) => setTimeout(() => { if (s.phase === 'won' || s.phase === 'lost') A(name); }, ms);
    later(1400, e.won ? 'missionWon' : 'missionLost');
    if (e.rankUp) later(4400, 'rankUp');
    if ((e.daily && e.daily.isNew) || (e.survival && e.survival.isNew && e.survival.waves > 0)) later(e.rankUp ? 6400 : 4600, 'dailyRecord');
  }));

  return {
    /** Для проверок: текущее состояние обстановки. */
    get state() { return { mode, tension, ducked, hoist: hoistOn, aa: aaOn, siren: sirenOn, alarm: alarmOn, drone: droneSent ? droneSent.l : 0, amb: Object.assign({}, sentAmb) }; },
    dispose() { for (const off of offs) { try { off(); } catch (e) { /* уже снят */ } } offs.length = 0; stopLoops(); A('ambient', false); A('music', false); },
  };
}
