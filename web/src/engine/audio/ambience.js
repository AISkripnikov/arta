// Фон: слои — готовые бесшовные петли банка (beds.js; тёмный шум, медленное движение, гул на сетке 12.5 Гц), плавно
// перетекающие друг в друга. Во время боя у фона нет ни одного живого генератора: слой = источник-петля + усиление,
// весь фон — ещё одно усиление и один НЧ-фильтр (ночь, туман).
//   room      — тон башни: вентиляция, гул сети 50/100/150 Гц, море сквозь броню
//   machinery — пост заряжания: гул агрегатов 25 Гц с гармониками, «пыхтение» компрессора 0.5 Гц
//   air       — открытый воздух (наблюдение, зенитка): ветер, прибой; в шторм — шторм (сильнее ветер, порывы, капли по броне)
//   tension   — напряжение боя: далёкий гул с медленным пульсом, тон 75 Гц
// Уровень звука (setTier): high — до 4 слоёв, mid — 3, low — 2 самых громких.
// Случайные звуки (по таймеру, пока фон включён): скрипы и капли; в тумане — далёкий ревун; в шторм — дальний гром.
// Ночью всё тише и глуше, в тумане — глуше.
const OPEN = { observe: 1, aa: 1 };
const LEVEL = 0.038;                      // общий уровень фона: на 5+ дБ тише щелчков органов управления (tools/test-audio.cjs)
const MAXL = { high: 4, mid: 3, low: 2 };
const BUF = { room: 'roomBed', machinery: 'machineBed', air: 'airBed', storm: 'stormBed', tension: 'tensionBed' };

export function createAmbience(core) {
  const st = { on: false, station: '', weather: 'clear', night: false, tension: 0 };
  const layers = {};                    // name → { g, src }
  let master = null, tone = null, evTimer = 0;

  function targets() {
    if (!st.on) return {};
    const open = OPEN[st.station] ? 1 : 0, storm = st.weather === 'storm', fog = st.weather === 'fog';
    const wx = fog ? 0.55 : 1;
    const tg = {
      room: open ? 0.55 : 1,
      machinery: st.station === 'loading' ? 1 : 0,
      air: storm ? 0 : (open ? 1 : 0.2) * wx,
      storm: storm ? (open ? 1 : 0.22) : 0,
      tension: Math.max(0, Math.min(1, st.tension)),
    };
    // слабый телефон: только самые громкие слои
    const keep = Object.keys(tg).filter((k) => tg[k] > 0).sort((a, b) => tg[b] - tg[a]).slice(0, MAXL[core.tier] || 4);
    for (const k of Object.keys(tg)) if (!keep.includes(k)) tg[k] = 0;
    return tg;
  }

  function startLayer(name) {
    const ctx = core.ctx, buf = core.bank && core.bank.get(BUF[name], 0);
    if (!buf) { core.whenReady(BUF[name], () => { if (st.on && layers[name] && !layers[name].src) { attach(layers[name], name); apply(1.5); } }); return { g: null, src: null }; }
    const l = { g: null, src: null }; attach(l, name); return l;
  }
  function attach(l, name) {
    const ctx = core.ctx, buf = core.bank.get(BUF[name], 0);
    l.g = ctx.createGain(); l.g.gain.value = 0; l.g.connect(master);
    l.src = ctx.createBufferSource(); l.src.buffer = buf; l.src.loop = true; l.src.connect(l.g);
    l.src.start(ctx.currentTime, core.rnd() * buf.duration);        // свой случайный сдвиг: петли слоёв не совпадают швами
  }

  function apply(tc) {
    const ctx = core.ctx; if (!ctx) return;
    const t = ctx.currentTime, tg = targets();
    if (st.on && !master) {
      master = ctx.createGain(); master.gain.value = LEVEL * (st.night ? 0.78 : 1); tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.Q.value = 0.5; tone.frequency.value = 6000;
      master.connect(tone); tone.connect(core.input('amb', 'dry'));
    }
    if (master) {
      master.gain.setTargetAtTime(LEVEL * (st.night ? 0.78 : 1), t, tc);
      tone.frequency.setTargetAtTime(st.weather === 'fog' ? 2200 : st.night ? 3500 : 6000, t, tc);
    }
    for (const name of Object.keys(BUF)) {
      const want = tg[name] || 0;
      if (want > 0 && !layers[name]) layers[name] = startLayer(name);
      const l = layers[name];
      if (!l) continue;
      const lvl = want * core.recipeGain(BUF[name]);
      if (l.g) l.g.gain.setTargetAtTime(lvl, t, want > 0 ? tc : Math.min(tc, 0.5));
      if (want <= 0) {
        delete layers[name];
        if (l.src) { const end = t + Math.min(tc, 0.5) * 5 + 0.2; try { l.src.stop(end); } catch (e) { /* уже */ } core.trash([l.src, l.g], end); }
      }
    }
    if (!st.on && master) { const m = master, f = tone; master = tone = null; core.trash([m, f], t + 3.2); }
    events();
  }

  // ----- редкие случайные звуки -----
  function fireEvent() {
    evTimer = 0;
    if (!st.on) return;
    if (core.audible()) {
      const r = core.rnd(), pan = core.rnd() * 1.6 - 0.8, g = (st.night ? 0.8 : 1) * (0.5 + core.rnd() * 0.5);
      const open = OPEN[st.station];
      if (st.weather === 'storm' && r < 0.3) core.play('farThunder', { gain: g, pan: pan * 0.5 });
      else if (st.weather === 'fog' && r < 0.22) core.play('foghorn', { gain: g, pan: pan * 0.6, lp: 900 });
      else if (r < 0.62 || open) { if (!open || r < 0.35) core.play('creak', { gain: g, pan }); }
      else core.play('drip', { gain: g, pan });
    }
    events();
  }
  function events() {
    if (core.offline) return;
    if (st.on && !evTimer) evTimer = setTimeout(fireEvent, 3500 + core.rnd() * 7000);
    else if (!st.on && evTimer) { clearTimeout(evTimer); evTimer = 0; }
  }

  return {
    state: st,
    /** Включить/выключить фон. */
    on(b) { st.on = !!b; apply(st.on ? 0.25 : 0.3); },
    /** Задать обстановку: { station, weather: 'clear'|'fog'|'storm', night, tension 0…1 } — только названные поля. */
    set(o) {
      if (!o) return;
      if (o.station != null) st.station = String(o.station);
      if (o.weather != null) st.weather = o.weather === 'storm' || o.weather === 'fog' ? o.weather : 'clear';
      if (o.night != null) st.night = !!o.night;
      if (o.tension != null) st.tension = Math.max(0, Math.min(1, +o.tension || 0));
      if (st.on) apply(1.0);
    },
    /** Уровень звука сменился (setTier): пересобрать набор слоёв. */
    retier() { if (st.on) apply(1.0); },
    reset() { clearTimeout(evTimer); evTimer = 0; master = tone = null; for (const k of Object.keys(layers)) delete layers[k]; },
    dispose() { clearTimeout(evTimer); evTimer = 0; },
  };
}
