// Фон: зацикленные живые слои на шине amb, плавно перетекающие друг в друга, и редкие случайные звуки.
//   room      — тон башни: вентиляция (НЧ-шум с дрожью лопастей), гул сети 50/100/150 Гц, море сквозь броню
//   machinery — пост заряжания: гул агрегатов 31 Гц и «пыхтение» компрессора
//   air       — открытый воздух (наблюдение, зенитка): ветер с плавающей полосой, накат прибоя, свист порывов в шторм
//   rain      — дождь по броне: петля капель из банка + шипение
//   tension   — напряжение боя: низкое биение 55/58 Гц с медленным пульсом, растёт с огнём противника
// Случайные звуки (по таймеру, пока фон включён): скрипы и капли; в тумане — далёкий ревун; в шторм — дальний гром.
// Ночью всё тише и глуше, в тумане — глуше.
import { builder } from './loops.js';

const OPEN = { observe: 1, aa: 1 };
const LEVEL = 0.085;                      // общий уровень фона: на 5+ дБ тише щелчков органов управления (tools/test-audio.cjs)

export function createAmbience(core) {
  const st = { on: false, station: '', weather: 'clear', night: false, tension: 0 };
  const layers = {};                    // name → { b, out, level }
  let master = null, tone = null, evTimer = 0;

  const BUILD = {
    room(b, dest) {
      const out = b.gain(0, dest);
      const vent = b.gain(0.2, out); b.noise(b.filter('lowpass', 180, 0.6, vent)); b.osc('sine', 6.3, b.gain(0.06, vent.gain));
      b.noise(b.filter('bandpass', 620, 0.5, b.gain(0.17, out)), 0.8);                  // воздух в коробах: слышно и в динамике телефона
      b.osc('sine', 50, b.gain(0.04, out)); b.osc('triangle', 100.3, b.gain(0.05, out)); b.osc('sawtooth', 150.2, b.filter('lowpass', 700, 0.7, b.gain(0.03, out)));
      const sea = b.gain(0.26, out); b.noise(b.filter('bandpass', 150, 0.7, sea), 0.5); b.osc('sine', 0.11, b.gain(0.18, sea.gain));
      return out;
    },
    machinery(b, dest) {
      const out = b.gain(0, dest);
      b.osc('sawtooth', 31, b.filter('lowpass', 420, 1, b.gain(0.07, out)));
      const chug = b.gain(0.14, out); b.noise(b.filter('bandpass', 320, 4, chug)); b.osc('sine', 7.2, b.gain(0.06, chug.gain));
      b.osc('triangle', 297, b.gain(0.006, out));
      return out;
    },
    air(b, dest) {
      const out = b.gain(0, dest);
      const wind = b.gain(0.16, out), wf = b.filter('bandpass', 480, 1.1, wind); b.noise(wf);
      b.osc('sine', 0.13, b.gain(170, wf.frequency)); b.osc('sine', 0.071, b.gain(0.08, wind.gain));
      const surf = b.gain(0.07, out); b.noise(b.filter('lowpass', 1400, 0.5, surf), 0.5); b.osc('sine', 0.093, b.gain(0.06, surf.gain));
      const gust = b.gain(0, out), gm = b.gain(0.5, gust), gf = b.filter('bandpass', 2200, 8, gm); b.noise(gf, 1.3);
      b.osc('sine', 0.23, b.gain(0.5, gm.gain)); b.osc('sine', 0.17, b.gain(500, gf.frequency));
      out._gust = gust; out._wind = wf;
      return out;
    },
    rain(b, dest) {
      const out = b.gain(0, dest);
      b.noise(b.filter('highpass', 5000, 0.5, b.gain(0.022, out)), 1.2);
      b.noise(b.filter('bandpass', 1100, 0.6, b.gain(0.03, out)), 0.7);
      const attach = () => {
        if (!layers.rain || layers.rain.out !== out) return;
        const buf = core.bank && core.bank.get('rainLoop', 0);
        if (!buf) { core.whenReady('rainLoop', attach); return; }
        const s = core.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.connect(b.gain(core.recipeGain('rainLoop'), out)); s.start(0); b.nodes.push(s); b.srcs.push(s);
      };
      out._attach = attach;
      return out;
    },
    tension(b, dest) {
      const out = b.gain(0, dest), pulse = b.gain(0.6, out);
      b.osc('sine', 55, b.gain(0.05, pulse)); b.osc('sine', 58.3, b.gain(0.04, pulse)); b.osc('sawtooth', 110.4, b.filter('lowpass', 500, 0.7, b.gain(0.05, pulse)));
      b.osc('sawtooth', 116.9, b.filter('lowpass', 420, 0.7, b.gain(0.04, pulse)));
      b.osc('sine', 1.1, b.gain(0.3, pulse.gain));
      b.noise(b.filter('bandpass', 180, 2, b.gain(0.1, out)), 0.6);
      return out;
    },
  };

  function targets() {
    if (!st.on) return {};
    const open = OPEN[st.station] ? 1 : 0, storm = st.weather === 'storm', fog = st.weather === 'fog';
    const wx = storm ? 1.7 : fog ? 0.3 : 0.75;
    return {
      room: open ? 0.55 : 1,
      machinery: st.station === 'loading' ? 1 : 0,
      air: (open ? 1 : 0.14) * wx,
      rain: storm ? (open ? 1 : 0.6) : 0,
      tension: Math.max(0, Math.min(1, st.tension)),
    };
  }

  function apply(tc) {
    const ctx = core.ctx; if (!ctx) return;
    const t = ctx.currentTime, tg = targets();
    if (st.on && !master) {
      master = ctx.createGain(); master.gain.value = LEVEL * (st.night ? 0.7 : 1); tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.Q.value = 0.5; tone.frequency.value = 9000;
      master.connect(tone); tone.connect(core.input('amb', 'dry'));
    }
    if (master) {
      master.gain.setTargetAtTime(LEVEL * (st.night ? 0.7 : 1), t, tc);
      tone.frequency.setTargetAtTime(st.weather === 'fog' ? 2200 : st.night ? 5000 : 9000, t, tc);
    }
    for (const name of Object.keys(BUILD)) {
      const want = tg[name] || 0, cur = layers[name];
      if (want > 0 && !cur) {
        const b = builder(core), out = BUILD[name](b, master);
        layers[name] = { b, out };
        if (out._attach) out._attach();
      }
      const l = layers[name];
      if (!l) continue;
      l.out.gain.setTargetAtTime(want, t, want > 0 ? tc : Math.min(tc, 0.5));
      if (name === 'air' && want > 0) { l.out._gust.gain.setTargetAtTime(st.weather === 'storm' ? 0.03 : 0.004, t, tc); l.out._wind.Q.setTargetAtTime(st.weather === 'storm' ? 0.8 : 1.1, t, tc); }
      if (want <= 0) { delete layers[name]; l.b.end(t + Math.min(tc, 0.5) * 5 + 0.2); }
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
    on(b) { st.on = !!b; apply(st.on ? 0.8 : 0.3); },
    /** Задать обстановку: { station, weather: 'clear'|'fog'|'storm', night, tension 0…1 } — только названные поля. */
    set(o) {
      if (!o) return;
      if (o.station != null) st.station = String(o.station);
      if (o.weather != null) st.weather = o.weather === 'storm' || o.weather === 'fog' ? o.weather : 'clear';
      if (o.night != null) st.night = !!o.night;
      if (o.tension != null) st.tension = Math.max(0, Math.min(1, +o.tension || 0));
      if (st.on) apply(1.0);
    },
    reset() { clearTimeout(evTimer); evTimer = 0; master = tone = null; for (const k of Object.keys(layers)) delete layers[k]; },
    dispose() { clearTimeout(evTimer); evTimer = 0; },
  };
}
