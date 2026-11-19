// engine.audio — синтезированный звук башни (WebAudio, без файлов). DESIGN §5.4.
// Контекст создаётся лениво при первом касании (unlock()). Ни одна функция не бросает исключений:
// если звук недоступен — все вызовы тихо ничего не делают.
//
// УСТРОЙСТВО (модули в ./audio/):
//   kit.js        набор синтеза: шум через фильтры, тоны со сдвигом, модальный банк, ЧМ, гребёнка, насыщение
//   catalogue.js  рецепты разовых звуков и таблица слоёв
//   bank.js       предварительный просчёт рецептов в буферы (OfflineAudioContext), в фоне после первого касания
//   loops.js      живые петли и параметрические звуки (привод, шестерни, элеватор, очередь, самолёт, сирена, свист)
//   ambience.js   фон башни: слои по посту, погоде, ночи, напряжению боя + редкие случайные звуки
//   music.js      тема меню (строится на ходу)
//   space.js      импульсные отклики «стальная комната» и «открытое море», кривая ограничителя
//
// ТРАКТ: голос → вход пространства шины → { сухой → громкость шины ; посылы → две свёрточные реверберации }
//        fx: → мягкий компрессор шины;  radio: → полоса «динамика» 350–3200 Гц;  amb, music: без компрессии
//        всё → срез инфразвука 22 Гц → общая громкость/«звук выкл» → лимитер → мягкий ограничитель (потолок −1.9 дБ)
// Пространства (сухой / комната / море): in 1/0.4/0 · big 1/0.5/0.3 · out 0.75/0.05/0.6 · ui 1/0.05/0.04 · dry 1/0/0.
// Голоса: не больше 28 разом (лишний — самый тихий и старый — гаснет за 10 мс); каждый разовый звук останавливает
// свои источники по времени и отсоединяет узлы после отзвучки (уборка раз в 1.5 с и при каждом новом звуке).
//
// ПАНОРАМА: необязательный аргумент pan −1 (слева) … 0 … +1 (справа) у «уличных» и тяжёлых звуков.
import { makeKit, makeNoise, satCurve, rng } from './audio/kit.js';
import { steelRoomIR, openSeaIR, clipCurve } from './audio/space.js';
import { CAT, RADIO_CLASSES } from './audio/catalogue.js';
import { createBank } from './audio/bank.js';
import { createLoops } from './audio/loops.js';
import { createAmbience } from './audio/ambience.js';
import { createMusic } from './audio/music.js';

const SPACES = { in: [1, 0.4, 0], big: [1, 0.5, 0.3], out: [0.75, 0.05, 0.6], ui: [1, 0.05, 0.04], dry: [1, 0, 0], intro: [1, 0.15, 0.4] };
const BUSES = ['fx', 'amb', 'radio', 'music'];
const MAX_VOICES = 28;
// Компрессор WebAudio сам добавляет «компенсирующее» усиление; эти множители возвращают тихим звукам единичный уровень.
const FX_COMP = { threshold: -12, knee: 10, ratio: 2.5, attack: 0.004, release: 0.22, makeup: 0.7 };
const LIMITER = { threshold: -5, knee: 0, ratio: 20, attack: 0.002, release: 0.14, makeup: 0.82 };
const LIVE_GAIN = 0.55;                  // рецепт вживую не нормирован — приглушить до уровня буфера
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * @param opts.context готовый контекст (OfflineAudioContext в tools/test-audio.cjs) — тогда unlock не нужен
 * @param opts.shared  { noise, bank, irRoom, irSea } — общие буферы для нескольких экземпляров (тест)
 * @param opts.seed    зерно случайности (тест)
 */
export function createAudio(opts = {}) {
  const offline = opts.context ? opts.context.length / opts.context.sampleRate : 0;
  const shared = opts.shared || {};
  const rnd = opts.seed != null ? rng(opts.seed) : Math.random;
  let ctx = null, out = null, pre = null, noise = null, bank = null, roomConv = null, seaConv = null;
  const vol = {};                          // шина → [сухой, посыл в комнату, посыл в море] (GainNode)
  const inputs = {};                       // 'шина/пространство' → входной узел
  const bus = { fx: 1, amb: 1, radio: 1, music: 1 };
  let failed = false, muted = false, volume = 0.8, paused = false;
  const last = {};                         // ограничение частоты однотипных звуков
  let voices = [], garbage = [], sweeper = 0, irTimer = 0, extra = 0;
  const ready = {};                        // имя → [колбэки]: кто ждёт буфер из банка
  let wantAmbient = false, wantAlarm = false, wantMusic = false;

  // ----- ядро для модулей -----
  const core = {
    get ctx() { return ctx; }, get noise() { return noise; }, get bank() { return bank; },
    offline, rnd,
    input, play, trash(nodes, end) { const bin = { end, nodes }; garbage.push(bin); return bin; },
    kit: (seed) => makeKit(ctx, { seed: seed || Math.floor(rnd() * 1e9), noise }),
    recipeGain: (name) => (CAT[name] ? CAT[name].g : 0),
    whenReady(name, cb) { (ready[name] || (ready[name] = [])).push(cb); },
    audible: () => !!ctx && !paused && (offline || ctx.state === 'running'),
  };
  const loops = createLoops(core, satCurve);
  const amb = createAmbience(core);
  const music = createMusic(core);

  function ensure() {
    if (ctx || failed) return !!ctx;
    try {
      if (opts.context) ctx = opts.context;
      else {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { failed = true; return false; }
        ctx = new AC({ latencyHint: 'interactive' });
      }
      const rate = ctx.sampleRate;
      noise = shared.noise || makeNoise(ctx, 2, rate, 7);
      // выход: срез инфразвука → громкость → лимитер → мягкий ограничитель
      pre = ctx.createGain();
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 22; hp.Q.value = 0.7;
      out = ctx.createGain(); out.gain.value = muted ? 0 : volume;
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = LIMITER.threshold; lim.knee.value = LIMITER.knee; lim.ratio.value = LIMITER.ratio; lim.attack.value = LIMITER.attack; lim.release.value = LIMITER.release;
      const post = ctx.createGain(); post.gain.value = LIMITER.makeup * 0.5;
      const clip = ctx.createWaveShaper(); clip.curve = clipCurve(0.6, 0.8);
      pre.connect(hp); hp.connect(out); out.connect(lim); lim.connect(post); post.connect(clip); clip.connect(ctx.destination);
      // реверберации
      roomConv = ctx.createConvolver(); seaConv = ctx.createConvolver();
      const roomRet = ctx.createGain(), seaRet = ctx.createGain(); roomRet.gain.value = 1.4; seaRet.gain.value = 1.1;
      roomConv.connect(roomRet); roomRet.connect(pre); seaConv.connect(seaRet); seaRet.connect(pre);
      const irs = () => {
        irTimer = 0;
        try {
          roomConv.buffer = shared.irRoom || steelRoomIR(ctx, rate);
          seaConv.buffer = shared.irSea || openSeaIR(ctx, rate);
          extra = (roomConv.buffer.length + seaConv.buffer.length) * 2 * 4 + noise.length * 4;
        } catch (e) { /* без реверберации */ }
      };
      if (offline) irs(); else irTimer = setTimeout(irs, 80);
      // шины
      for (const name of BUSES) {
        const v = vol[name] = [ctx.createGain(), ctx.createGain(), ctx.createGain()];
        v.forEach((g) => { g.gain.value = bus[name]; });
        v[1].connect(roomConv); v[2].connect(seaConv);
        if (name === 'fx') {
          const c = ctx.createDynamicsCompressor(), cg = ctx.createGain();
          c.threshold.value = FX_COMP.threshold; c.knee.value = FX_COMP.knee; c.ratio.value = FX_COMP.ratio; c.attack.value = FX_COMP.attack; c.release.value = FX_COMP.release;
          cg.gain.value = FX_COMP.makeup;
          v[0].connect(c); c.connect(cg); cg.connect(pre);
        } else v[0].connect(pre);
      }
      // банк
      bank = shared.bank || createBank(ctx, noise, {
        onReady(name) { const list = ready[name]; if (list) { delete ready[name]; list.forEach((f) => { try { f(); } catch (e) { /* тихо */ } }); } },
      });
      if (!offline) {
        // своя страховка на сворачивание (движок делает то же самое; вызовы идемпотентны)
        if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', onVis);
        setTimeout(() => { if (bank) bank.start(); }, 250);
        sweeper = setInterval(() => { try { if (ctx && ctx.state === 'running') sweep(ctx.currentTime); } catch (e) { /* тихо */ } }, 1500);
      }
      amb.set({});
      if (wantAmbient) api.ambient(true);
      if (wantAlarm) api.alarm(true);
      if (wantMusic) api.music(true);
      return true;
    } catch (e) { failed = true; ctx = null; return false; }
  }

  function onVis() { try { if (document.hidden) api.suspend(); else api.resume(); } catch (e) { /* тихо */ } }

  /** Вход шины в заданном пространстве (сухой сигнал + посылы в реверберации). */
  function input(busName, space) {
    const key = busName + '/' + space;
    if (inputs[key]) return inputs[key];
    const s = SPACES[space] || SPACES.in, v = vol[busName] || vol.fx, inp = ctx.createGain();
    s.forEach((lvl, i) => { if (lvl > 0) { const g = ctx.createGain(); g.gain.value = lvl; inp.connect(g); g.connect(v[i]); } });
    let head = inp;
    if (busName === 'radio') {             // «динамик» радиостанции: узкая полоса и лёгкое искажение
      const h = ctx.createBiquadFilter(), l = ctx.createBiquadFilter(), sh = ctx.createWaveShaper();
      h.type = 'highpass'; h.frequency.value = 350; h.Q.value = 0.8; l.type = 'lowpass'; l.frequency.value = 3200; l.Q.value = 0.9; sh.curve = satCurve(1.5);
      h.connect(l); l.connect(sh); sh.connect(inp); head = h;
    }
    return (inputs[key] = head);
  }

  // Громкость меняется сразу: быстрый подход за ~50 мс (без щелчка) и точная установка значения следом.
  function setNow(param, v) {
    const t = ctx.currentTime;
    param.cancelScheduledValues(t); param.setTargetAtTime(v, t, 0.012); param.setValueAtTime(v, t + 0.07);
  }
  function setBusGain(name) { for (const g of vol[name]) setNow(g.gain, bus[name]); }
  /** Кратко приглушить шину: до depth за 30 мс, держать hold, вернуть за ~3·rel. */
  function duck(name, depth, hold, rel) {
    const t = ctx.currentTime;
    for (const g of vol[name]) { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(bus[name] * depth, t, 0.03); g.gain.setTargetAtTime(bus[name], t + hold, rel); }
  }

  // ----- голоса -----
  function drop(nodes) { for (const n of nodes) { try { n.disconnect(); } catch (e) { /* уже */ } } }
  function sweep(t) {
    if (voices.length) voices = voices.filter((v) => { if (v.end + 0.05 < t) { drop(v.nodes); return false; } return true; });
    if (garbage.length) garbage = garbage.filter((v) => { if (v.end + 0.05 < t) { drop(v.nodes); return false; } return true; });
  }
  function steal(t) {
    let vi = -1;
    for (let i = 0; i < voices.length; i++) if (!voices[i].dying && (vi < 0 || voices[i].prio < voices[vi].prio)) vi = i;
    if (vi < 0) return;
    const v = voices[vi]; v.dying = true;
    try {
      v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, 0.006);
      if (v.src) v.src.stop(t + 0.04); else if (v.kit) v.kit.stopAll(t + 0.04);
    } catch (e) { /* тихо */ }
    v.end = t + 0.045;
  }
  /**
   * Сыграть рецепт каталога. o: gain (множитель), rate (высота), pan, when (задержка, с), lp (НЧ-срез, Гц),
   * bus, space, dest (свой узел назначения), force (без ограничения частоты). Возвращает длительность, с (0 — не сыграно).
   */
  function play(name, o) {
    const rec = CAT[name];
    if (!rec || !ctx) return 0;
    o = o || {};
    const now = ctx.currentTime, when = Math.max(0, +o.when || 0);
    if (rec.gap && !o.force) { if (now + when - (last[name] == null ? -9 : last[name]) < rec.gap) return 0; last[name] = now + when; }
    sweep(now);
    const live = voices.reduce((n, v) => n + (v.dying ? 0 : 1), 0);
    if (live >= MAX_VOICES) steal(now);
    const t = now + 0.005 + when;
    const dest = o.dest || input(o.bus || rec.bus || 'fx', o.space || rec.sp || 'in');
    const jit = rec.jit == null ? 0.03 : rec.jit;
    const rate = clamp((+o.rate || 1) * (1 + (rnd() * 2 - 1) * jit), 0.25, 4);
    const gain = rec.g * (o.gain == null ? 1 : Math.max(0, +o.gain || 0)) * (0.9 + 0.1 * rnd());
    const nodes = [], g = ctx.createGain(); nodes.push(g);
    let tail = g, head = g;
    if (o.pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = clamp(+o.pan || 0, -1, 1); g.connect(p); tail = p; nodes.push(p); }
    tail.connect(dest);
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = clamp(+o.lp, 60, 16000); f.Q.value = 0.5; f.connect(g); head = f; nodes.push(f); }
    const v = { nodes, g, prio: gain, end: 0 };
    const buf = bank && bank.get(name, rnd());
    if (buf) {
      const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate; src.connect(head);
      g.gain.value = gain;
      v.end = t + buf.duration / rate + 0.02; src.start(t); src.stop(v.end);
      nodes.push(src); v.src = src;
    } else {
      const k = makeKit(ctx, { seed: Math.floor(rnd() * 1e9) + 1, lite: true, noise });
      g.gain.value = gain * LIVE_GAIN;
      rec.fn(k, t, head, Math.floor(rnd() * (rec.v || 1)));
      v.end = k.end + 0.02; v.kit = k;
      for (const n of k.nodes) nodes.push(n);
    }
    voices.push(v);
    return v.end - now;
  }

  // ----- обёртки: звук не должен ломать игру -----
  // one — разовые звуки: при свёрнутой странице молчат; если контекст уснул сам — будят.
  const one = (fn) => function () {
    try { if (!ctx || paused) return; if (!offline && ctx.state === 'suspended') ctx.resume(); return fn.apply(null, arguments); } catch (e) { /* тихо */ }
  };
  // hold — состояния (петли, фон): запоминаются и при свёрнутой странице.
  const hold = (fn) => function () { try { if (!ctx) return; return fn.apply(null, arguments); } catch (e) { /* тихо */ } };
  // ролик: только при идущем контексте (до первого касания — тихо)
  const isafe = (fn) => function () { try { if (!core.audible()) return; return fn.apply(null, arguments); } catch (e) { /* тихо */ } };
  const P = (name, o) => one((a) => play(name, Object.assign({}, o, a && typeof a === 'object' ? a : null)));
  const pan01 = (o) => (o && typeof o === 'object' ? o : {});

  const api = {
    // ================= служебное =================
    /** Создать/разбудить AudioContext. Вызывается движком при первом касании. */
    unlock() { try { if (ensure() && !offline && !paused && ctx.state === 'suspended') ctx.resume(); } catch (e) { /* тихо */ } },
    get ready() { return !!ctx; },
    get muted() { return muted; },
    setMuted(b) { muted = !!b; try { if (ctx) setNow(out.gain, muted ? 0 : volume); } catch (e) { /* тихо */ } },
    setVolume(v) { volume = clamp(+v || 0, 0, 1); try { if (ctx && !muted) setNow(out.gain, volume); } catch (e) { /* тихо */ } },
    /** Громкость шины: name = 'fx' (эффекты) | 'amb' (фон башни) | 'radio' (радио) | 'music' (музыка); v = 0…2 (1 — как записано). */
    setBus(name, v) {
      if (!Object.prototype.hasOwnProperty.call(bus, name)) return;
      bus[name] = clamp(+v || 0, 0, 2);
      try { if (ctx) setBusGain(name); } catch (e) { /* тихо */ }
    },
    /** Текущие громкости шин { fx, amb, radio, music }. */
    get buses() { return { fx: bus.fx, amb: bus.amb, radio: bus.radio, music: bus.music }; },
    /** Узел шины (GainNode) для подключения своих источников: 'fx' | 'amb' | 'radio' | 'music'; null, пока звук не разбужен. */
    busNode(name) { try { return ctx && vol[name] ? input(name, 'in') : null; } catch (e) { return null; } },
    /** Приостановить/возобновить весь звук (сворачивание приложения). Пока приостановлено, разовые звуки не играют. */
    suspend() { paused = true; try { if (ctx && !offline && ctx.state === 'running') ctx.suspend(); } catch (e) { /* тихо */ } },
    resume() { paused = false; try { if (ctx && !offline && ctx.state === 'suspended') ctx.resume(); } catch (e) { /* тихо */ } },
    /** Освободить контекст. */
    dispose() {
      clearInterval(sweeper); clearTimeout(irTimer);
      try { if (!offline && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis); } catch (e) { /* тихо */ }
      try { amb.dispose(); amb.reset(); music.reset(); loops.reset(); if (bank && !shared.bank) bank.dispose(); if (ctx && !offline) ctx.close(); } catch (e) { /* тихо */ }
      ctx = null; bank = null; voices = []; garbage = [];
      for (const k of Object.keys(inputs)) delete inputs[k];
    },
    /** Обещание: все звуки каталога просчитаны в буферы (игре ждать не нужно — до готовности звук играет вживую). */
    prerender() { try { return bank ? bank.all() : Promise.resolve(); } catch (e) { return Promise.resolve(); } },
    /** Сыграть рецепт каталога по имени: play('clunk', { gain, rate, pan, when, lp }). */
    play: one((name, o) => play(name, o)),
    /** Счётчики для тестов и плашки отладки. */
    debug() {
      const t = ctx ? ctx.currentTime : 0;
      if (ctx) sweep(t);
      return {
        voices: voices.reduce((n, v) => n + (v.dying ? 0 : 1), 0), dying: voices.reduce((n, v) => n + (v.dying ? 1 : 0), 0), nodes: voices.reduce((n, v) => n + v.nodes.length, 0) + garbage.reduce((n, v) => n + v.nodes.length, 0),
        inputs: Object.keys(inputs).length, bankBytes: bank ? bank.bytes : 0, bankPending: bank ? bank.pending : 0, bankTotal: bank ? bank.total : 0,
        bufferBytes: (bank ? bank.bytes : 0) + extra, state: ctx ? ctx.state : 'none', rate: ctx ? ctx.sampleRate : 0, paused,
        music: music.playing, ambient: amb.state.on,
      };
    },

    // ================= органы управления =================
    /** Лёгкий щелчок (деление счётчика, кнопка, фиксатор). */
    tick: P('tick'),
    /** Трещотка маховика (старое имя) — то же, что detent(). */
    ratchet: P('detent'),
    /** Щелчок фиксатора маховика: pitch — высота (0.7…1.5), vel — сила (0…1.5). */
    detent: one((pitch, vel) => play('detent', { rate: clamp(pitch == null ? 1 : +pitch || 1, 0.5, 2), gain: clamp(vel == null ? 1 : +vel || 0, 0, 1.5) })),
    /** Шестерни маховика: speed 0…1 — частота зубьев и громкость следуют за скоростью; 0 — стихает. Вызывать при изменении. */
    gear: hold((speed) => loops.gear(speed)),
    /** Глухой удар механизма (фиксация, упор, тормоз). */
    clunk: P('clunk'),
    stopper: P('clunk'),
    /** Ход рычага: скольжение и упор. */
    leverPull: P('lever'),
    lever: P('lever'),
    /** Тумблер. */
    switchFlip: P('toggle'),
    toggle: P('toggle'),
    /** Кнопка: нажатие и возврат. */
    button: P('button'),
    /** Щелчок галетного переключателя. */
    selector: P('selector'),
    /** Предохранительная крышка: скрип петли и щелчок. */
    cover: P('cover'),
    /** Щелчок реле (загорелась/погасла лампа). */
    relay: P('relay'),
    /** Щелчок барабанчика счётчика. */
    drumTick: P('drum'),
    /** Зуммер отказа. */
    buzz: P('buzz'),
    /** Звонок машинного телеграфа: n ударов (1…4). */
    bell: one((n) => { n = clamp(Math.round(+n || 1), 1, 4); for (let i = 0; i < n; i++) play('bell', { when: i * 0.24, force: i > 0 }); }),
    /** Шорох линейки/бумаги по планшету. */
    paper: P('paper'),
    /** Булавка в планшет. */
    pin: P('pin'),
    /** Лупа: латунь и стекло. */
    loupe: P('loupe'),
    /** Гул привода; level 0..1, вызывать каждый кадр или при изменении. 0 — затихает. */
    servo: hold((level) => loops.slew(level)),
    slew: hold((level) => loops.slew(level)),

    // ================= заряжание =================
    /** Элеватор подачи: мотор и цепь, ~1.6 с (разовый; для удержания — hoistRun). */
    hoist: one((dur) => loops.hoistShot(clamp(+dur || 1.6, 0.4, 8))),
    /** Элеватор, пока держат: on/off (пуск контактора, цепь, мотор с разгоном; стоп — тормоз и выбег). */
    hoistRun: hold((on) => loops.hoist(!!on)),
    /** Досылатель: пневматический толчок и удар. */
    ram: P('ram'),
    /** Затвор: без аргумента или 'close' — закрытие, 'open' — открытие. */
    breech: one((kind) => play(kind === 'open' ? 'breechOpen' : 'breechClose')),
    breechOpen: P('breechOpen'),
    breechClose: P('breechClose'),
    /** Картуз лёг в камору. */
    charge: P('charge'),
    /** Разряжание: цепь вниз, звон поддона. */
    unload: P('unload'),

    // ================= главный калибр =================
    /** Выстрел главного калибра (изнутри башни): фон и музыка кратко приглушаются, ~1.5 с звенит в ушах. */
    fire: one(() => {
      play('gun'); play('gunTail'); play('whoosh', { when: 0.06, gain: 0.6 });
      duck('amb', 0.3, 0.35, 0.45); duck('music', 0.35, 0.35, 0.6);
    }),
    /** Шелест уходящего снаряда. */
    shellWhoosh: P('whoosh'),
    /**
     * Разрыв своего снаряда вдали. o: range — дальность, км (задержка, глухота и громкость по ней); kind — 'water'
     * (всплеск) | 'land' (разрыв на берегу) | 'steel' (попадание в корабль); pan; delay — своя задержка, с (0 — сразу;
     * по умолчанию min(3.5, range·0.26)). Возвращает задержку.
     */
    impact: one((o) => {
      o = pan01(o);
      const range = clamp(o.range == null ? 8 : +o.range || 0, 0, 40), delay = o.delay == null ? Math.min(3.5, range * 0.26) : Math.max(0, +o.delay || 0);
      play(o.kind === 'water' ? 'impWater' : o.kind === 'steel' ? 'impSteel' : 'impLand', { when: delay, pan: o.pan, gain: 1.5 / (1 + range / 7), lp: 7000 / (1 + range * 0.45), force: true });
      return delay;
    }),
    /** Далёкий раскат (vol 0…1.3) — гром разрыва нашего снаряда (старое имя; новое — impact). */
    thunder: one((v) => { const g = clamp(v == null ? 1 : +v || 0, 0.15, 1.3); play('impLand', { gain: 0.5 + 0.7 * g, lp: 250 + 900 * g, force: true }); }),
    /** Далёкий залп противника: o { range, км; pan }. */
    enemyGun: one((o) => { o = pan01(o); const range = clamp(o.range == null ? 10 : +o.range || 0, 0, 40); play('enemyGun', { pan: o.pan, gain: 1.6 / (1 + range / 8), lp: 2500 / (1 + range * 0.2) }); }),
    /** Свист подлетающего снаряда противника (dur, с; pan). Высота падает, громкость растёт к концу. */
    whistle: one((dur, pan) => loops.whistle(dur == null ? 2.2 : dur, 'shell', pan)),
    /** Близкий разрыв у батареи: удар грунта, дребезг, осыпающаяся пыль. o { pan, gain }. */
    impactNear: P('nearMiss'),
    nearMiss: P('nearMiss'),
    /** Далёкий разрыв (перелёт/недолёт противника). */
    impactFar: one((o) => play('impLand', Object.assign({ gain: 0.9, lp: 1400 }, pan01(o)))),
    /** Попадание в башню: огромный лязг, звон, обломки. Фон кратко приглушается. o { pan }. */
    turretHit: one((o) => { play('turretHit', pan01(o)); duck('amb', 0.35, 0.3, 0.5); duck('music', 0.4, 0.3, 0.6); }),
    /** Неисправность: электрический треск и шипение пара. */
    fault: P('fault'),
    /** Тревога (ревун): on/off. */
    alarm(on) { wantAlarm = !!on; try { if (ctx) loops.alarm(!!on); } catch (e) { /* тихо */ } },

    // ================= радио =================
    /** Радио: щелчок тангенты, шипение, тон вызова (старое имя: посылка штаба). */
    radio: P('radio_hq'),
    /** Сообщение по радио: cls — 'hq' | 'spotter' | 'crew' | 'meteo' | 'convoy'; urgent — срочное (дважды, выше, жёстче). */
    radioMsg: one((cls, urgent) => play('radio_' + (RADIO_CLASSES.indexOf(cls) >= 0 ? cls : 'hq') + (urgent ? '_u' : ''))),
    /** Шумоподавитель: open — открылся, иначе закрылся. */
    squelch: one((open) => play(open ? 'sqOpen' : 'sqClose')),
    /** Постоянный шум эфира: level 0…1 (0 — выключить). */
    radioStatic: hold((level) => loops.staticBed(level)),

    // ================= зенитка и воздух =================
    /** Один выстрел зенитного автомата (вызывать ~8 раз/с, пока идёт очередь) — старое имя; новое — aaFire(on). */
    aaBurst: P('aaShot'),
    /** Очередь спарки: on — петля очереди, off — дозвон стволов и гильзы. pan — для хвоста. */
    aaFire: hold((on, pan) => loops.aa(!!on, pan)),
    /** Перегрев стволов: шипение. */
    overheat: P('overheat'),
    /** Клин автомата. */
    jam: P('jam'),
    /**
     * Гул самолётов: level 0..1 (0 — затихает). Необязательные approach 0…1 (0 — приближается, 0.5 — над башней,
     * 1 — уходит: высота по Допплеру, громкость колоколом) и pan. Вызывать при изменении или каждый кадр.
     */
    planeDrone(level, approach, pan) { try { if (ctx) loops.drone(level, approach, pan); } catch (e) { /* тихо */ } },
    /** Пролёт самолёта над башней: o { dur = 4 с, from = −1, to = 1 (панорама), gain = 1 }. Возвращает длительность. */
    flyby: one((o) => { o = pan01(o); return loops.flyby(clamp(+o.dur || 4, 1, 12), o.from == null ? -1 : clamp(+o.from, -1, 1), o.to == null ? 1 : clamp(+o.to, -1, 1), 0.18 * (o.gain == null ? 1 : +o.gain)); }),
    /** Свист падающей бомбы (dur, с; pan). */
    bombWhistle: one((dur, pan) => loops.whistle(dur == null ? 1.4 : dur, 'bomb', pan)),
    /** Разрыв авиабомбы. o { pan, gain }. */
    bombBurst: P('bombBurst'),
    /** Близкий разрыв авиабомбы: короткий свист и разрыв (старое имя). */
    bombHit: one(() => { if (play('bombBurst', { when: 0.24 })) loops.whistle(0.3, 'bomb'); }),
    /** Сирена воздушной тревоги: три завывания (~4.5 с), не чаще раза в 5 с. */
    siren: one(() => { const t = ctx.currentTime; if (t - (last.siren == null ? -9 : last.siren) < 5) return; last.siren = t; loops.sirenShot(); }),
    /** Ручная сирена, пока крутят: on — раскрутка и вой, off — выбег (~4 с). */
    sirenRun: hold((on) => loops.siren(!!on)),

    // ================= фон =================
    /** Фон башни: on/off. Обстановку задаёт ambience(). Пока фон включён (бой), музыка меню молчит. */
    ambient(on) {
      wantAmbient = !!on;
      try {
        if (!ctx) return;
        amb.on(wantAmbient);
        if (wantAmbient) music.stop(0.4); else if (wantMusic) music.start();
      } catch (e) { /* тихо */ }
    },
    /**
     * Обстановка фона (только названные поля): station — id поста ('loading' — механизмы; 'observe', 'aa' — открытый
     * воздух, ветер и прибой); weather — 'clear' | 'fog' | 'storm'; night — тише и глуше; tension 0…1 — напряжение боя.
     */
    ambience(o) { try { amb.set(o); } catch (e) { /* тихо */ } },
    /** Напряжение боя 0…1 (растёт с огнём противника) — то же, что ambience({ tension }). */
    tension(v) { try { amb.set({ tension: v }); } catch (e) { /* тихо */ } },
    /** Случайные звуки фона по одному (играют и сами, пока фон включён). o { pan, gain }. */
    creak: P('creak'), drip: P('drip'), foghorn: P('foghorn'), farThunder: P('farThunder'),

    // ================= интерфейс =================
    uiTap: P('uiTap'), dialogOpen: P('dlgOpen'), dialogClose: P('dlgClose'), toast: P('toast'), saveDone: P('saveDone'),
    hintNew: P('hintNew'), friendlyFire: P('friendly'), detected: P('detected'), missionWon: P('won'), missionLost: P('lost'),
    rankUp: P('rankUp'), dailyRecord: P('daily'),

    // ================= музыка =================
    /** Музыка меню: on/off. Сама молчит, пока включён фон башни (ambient(true)), и возвращается после ambient(false). */
    music(on) {
      wantMusic = !!on;
      try { if (!ctx) return; if (wantMusic && !wantAmbient) music.start(); else music.stop(wantMusic ? 0.4 : 0.8); } catch (e) { /* тихо */ }
    },
    get musicPlaying() { return music.playing; },
  };

  // ----- вступительный ролик (ui/intro.js) -----
  // Все звуки ролика идут через собственную шину introBus → fx: громкость ролика задаётся отдельно (introVolume),
  // а introStop() гасит всё разом. До первого касания (ctx == null) вызовы тихо ничего не делают.
  let introBus = null, introDry = null, introVol = 1, introWindNode = null, introHissNode = null;
  const ibus = (dry) => {
    if (!introBus) {
      introBus = ctx.createGain(); introBus.gain.value = introVol; introBus.connect(input('fx', 'intro'));
      introDry = ctx.createGain(); introDry.gain.value = introVol; introDry.connect(input('fx', 'dry'));      // без эха: стук клавиш, морзянка
    }
    return dry ? introDry : introBus;
  };
  const stopSrcs = (n, at) => { for (const s of n.srcs) { try { s.stop(at); } catch (e) { /* тихо */ } } garbage.push({ end: at, nodes: n.nodes }); };
  const mk = () => {
    const n = { nodes: [], srcs: [] };
    n.gain = (v, dest) => { const g = ctx.createGain(); g.gain.value = v; if (dest) g.connect(dest); n.nodes.push(g); return g; };
    n.flt = (type, f, q, dest) => { const x = ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; x.connect(dest); n.nodes.push(x); return x; };
    n.noise = (dest, rate) => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; s.playbackRate.value = rate || 1; s.connect(dest); s.start(0, rnd() * 1.7); n.nodes.push(s); n.srcs.push(s); return s; };
    n.osc = (type, f, dest) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.connect(dest); o.start(); n.nodes.push(o); n.srcs.push(o); return o; };
    return n;
  };
  /** Громкость шины ролика 0..1. */
  api.introVolume = function (v) {
    introVol = clamp(+v || 0, 0, 1);
    try { if (ctx && introBus) { introBus.gain.setTargetAtTime(introVol, ctx.currentTime, 0.05); introDry.gain.setTargetAtTime(introVol, ctx.currentTime, 0.05); } } catch (e) { /* тихо */ }
  };
  /** Ветер с моря: level 0..1 (0 — затихает и освобождается). Можно вызывать каждый кадр. */
  api.introWind = function (level) {
    try {
      level = clamp(+level || 0, 0, 1);
      if (!ctx || (level > 0 && !core.audible())) return;
      if (level > 0 && !introWindNode) {
        const n = mk(); n.g = n.gain(0, ibus());
        const f = n.flt('bandpass', 420, 0.9, n.g); n.noise(f);
        n.osc('sine', 0.13, n.gain(170, f.frequency));
        const hi = n.gain(0.25, n.g), hf = n.flt('bandpass', 1500, 4, hi); n.noise(hf, 1.3);          // свист в снастях
        n.osc('sine', 0.21, n.gain(400, hf.frequency)); n.osc('sine', 0.17, n.gain(0.2, hi.gain));
        n.noise(n.flt('lowpass', 900, 0.5, n.gain(0.35, n.g)), 0.5);                                   // прибой
        introWindNode = n;
      }
      if (!introWindNode) return;
      const t = ctx.currentTime;
      introWindNode.g.gain.setTargetAtTime(0.42 * level, t, 0.4);
      if (level <= 0) { const n = introWindNode; introWindNode = null; stopSrcs(n, t + 1.5); }
    } catch (e) { /* тихо */ }
  };
  /** Шипение эфира: level 0..1 (0 — выключить). */
  api.introHiss = function (level) {
    try {
      level = clamp(+level || 0, 0, 1);
      if (!ctx || (level > 0 && !core.audible())) return;
      if (level > 0 && !introHissNode) {
        const n = mk(); n.g = n.gain(0, ibus());
        n.noise(n.flt('bandpass', 2300, 0.7, n.g));
        const cg = n.gain(0, n.g); n.noise(n.flt('highpass', 3000, 0.7, cg), 0.6); n.osc('sawtooth', 6.1, n.gain(0.35, cg.gain));
        const o = n.osc('sine', 1420, n.gain(0.12, n.g)); n.osc('sine', 0.7, n.gain(60, o.frequency));
        introHissNode = n;
      }
      if (!introHissNode) return;
      const t = ctx.currentTime;
      introHissNode.g.gain.setTargetAtTime(0.1 * level, t, 0.15);
      if (level <= 0) { const n = introHissNode; introHissNode = null; stopSrcs(n, t + 0.8); }
    } catch (e) { /* тихо */ }
  };
  /** Далёкая канонада: два-три глухих раската. */
  api.introGuns = isafe(() => { play('enemyGun', { dest: ibus(), gain: 1.5, lp: 1200 }); });
  /** Свист падающего снаряда (~0.5 с). */
  api.introWhistle = isafe(() => { play('introWhistle', { dest: ibus() }); });
  /** Близкий разрыв: power 0..1. */
  api.introBlast = isafe((power) => { play('nearMiss', { dest: ibus(), gain: 0.4 + 0.5 * clamp(power == null ? 1 : +power || 0, 0, 1) }); });
  /** Броневая дверь: скрип петель и удар упора. */
  api.introDoor = isafe(() => { play('introDoor', { dest: ibus() }); });
  /** Морзянка: несколько посылок. */
  api.introMorse = isafe(() => { play('introMorse', { dest: ibus(true) }); });
  /** Стук печатающейся буквы субтитров. */
  api.introKey = isafe(() => { play('introKey', { dest: ibus(true) }); });
  /** Финальный удар под заставку. */
  api.introTitle = isafe(() => { play('introTitle', { dest: ibus() }); });
  /** Конец ролика: погасить петли и хвосты разовых звуков. Шина остаётся (один узел усиления) и оживает при следующем introVolume(). */
  api.introStop = function () {
    try {
      api.introWind(0); api.introHiss(0);
      if (ctx && introBus) { introBus.gain.setTargetAtTime(0, ctx.currentTime, 0.12); introDry.gain.setTargetAtTime(0, ctx.currentTime, 0.12); }
    } catch (e) { /* тихо */ }
  };

  /**
   * Перечень всего каталога для tools/test-audio.cjs: [{ id, fn, args, cat, win — сколько секунд слушать,
   * dur: [мин, макс] — ожидаемая длительность звучания, loop — непрерывный звук, off — чем выключить }].
   */
  api.catalogue = CATALOGUE;

  if (opts.context) ensure();
  return api;
}

const E = (id, cat, win, dur, fn, args, x) => Object.assign({ id, cat, win, dur, fn: fn || id, args: args || [] }, x);
export const CATALOGUE = [
  // главный калибр и снаряды
  E('fire', 'gun', 6, [2.5, 6]),
  E('shellWhoosh', 'far', 4, [0.6, 4]),
  E('impact:water', 'far', 5, [1, 5], 'impact', [{ range: 6, kind: 'water', delay: 0 }]),
  E('impact:land', 'far', 5, [1, 5], 'impact', [{ range: 6, kind: 'land', delay: 0 }]),
  E('impact:steel', 'far', 5, [1, 5], 'impact', [{ range: 6, kind: 'steel', delay: 0 }]),
  E('thunder', 'far', 5, [1, 5], 'thunder', [1]),
  E('enemyGun', 'far', 6, [1.5, 6], 'enemyGun', [{ range: 9 }]),
  E('whistle', 'far', 5, [1.6, 5], 'whistle', [2.2]),
  E('impactNear', 'hit', 6, [2, 6]),
  E('impactFar', 'far', 5, [1, 5]),
  E('turretHit', 'hit', 7, [2.5, 7]),
  E('fault', 'machine', 3, [0.8, 3]),
  E('alarm', 'machine', 2, [1.9, 2], 'alarm', [true], { loop: 1 }),
  // заряжание
  E('breechOpen', 'machine', 3, [0.8, 2.6]), E('breechClose', 'machine', 3, [0.8, 2.6]), E('breech', 'machine', 3, [0.8, 2.6]),
  E('hoist', 'machine', 4, [1.5, 3.2]),
  E('hoistRun', 'machine', 2, [1.9, 2], 'hoistRun', [true], { loop: 1 }),
  E('ram', 'machine', 3, [0.7, 2.6]), E('charge', 'machine', 2, [0.12, 1.6]), E('unload', 'machine', 3, [0.8, 2.6]),
  // органы управления
  E('tick', 'control', 1.2, [0.01, 0.9]), E('ratchet', 'control', 1.2, [0.01, 0.9]),
  E('detent', 'control', 1.2, [0.01, 0.9], 'detent', [1.2, 0.8]),
  E('gear', 'machine', 2, [1.9, 2], 'gear', [0.6], { loop: 1 }),
  E('clunk', 'control', 2, [0.1, 1.4]), E('leverPull', 'control', 2, [0.2, 1.5]), E('switchFlip', 'control', 1.2, [0.02, 0.9]),
  E('button', 'control', 1.2, [0.02, 0.9]), E('selector', 'control', 1.2, [0.02, 0.9]), E('cover', 'control', 1.5, [0.08, 1.1]),
  E('relay', 'control', 1.2, [0.005, 0.8]), E('drumTick', 'control', 1.2, [0.005, 0.8]),
  E('buzz', 'control', 2, [0.25, 1.3]), E('bell', 'control', 3.5, [0.6, 3], 'bell', [2]),
  E('paper', 'control', 1.2, [0.1, 0.5]), E('pin', 'control', 1.2, [0.01, 0.4]), E('loupe', 'control', 1.2, [0.05, 0.5]),
  E('servo', 'machine', 2, [1.9, 2], 'servo', [0.7], { loop: 1 }),
  // радио
  E('radio', 'radio', 2, [0.5, 1.8]),
  ...RADIO_CLASSES.map((c) => E('radioMsg:' + c, 'radio', 2, [0.5, 1.8], 'radioMsg', [c, false])),
  ...RADIO_CLASSES.map((c) => E('radioMsg:' + c + '!', 'radio', 2.2, [0.7, 2], 'radioMsg', [c, true])),
  E('squelch:open', 'radio', 1.2, [0.03, 1], 'squelch', [true]), E('squelch:close', 'radio', 1.2, [0.03, 1], 'squelch', [false]),
  E('radioStatic', 'radio', 2, [1.9, 2], 'radioStatic', [1], { loop: 1 }),
  // зенитка и воздух
  E('aaBurst', 'aa', 3, [0.3, 3]),
  E('aaFire', 'aa', 2, [1.9, 2], 'aaFire', [true], { loop: 1 }),
  E('overheat', 'machine', 3, [1, 2.8]), E('jam', 'machine', 2, [0.2, 1.6]),
  E('planeDrone', 'air', 3, [2.8, 3], 'planeDrone', [0.9, 0.5], { loop: 1 }),
  E('flyby', 'air', 8, [3, 7.5], 'flyby', [{ dur: 4 }]),
  E('bombWhistle', 'far', 4, [1, 4], 'bombWhistle', [1.4]),
  E('bombBurst', 'hit', 7, [2, 7]), E('bombHit', 'hit', 7, [2, 7]),
  E('siren', 'air', 8, [4, 8]),
  E('sirenRun', 'air', 4, [3.5, 4], 'sirenRun', [true], { loop: 1 }),
  // фон
  E('ambient:room', 'amb', 4, [3.9, 4], 'ambient', [true], { loop: 1, pre: ['ambience', { station: 'plot', weather: 'clear', night: false, tension: 0 }] }),
  E('ambient:loading', 'amb', 4, [3.9, 4], 'ambient', [true], { loop: 1, pre: ['ambience', { station: 'loading' }] }),
  E('ambient:observe', 'amb', 4, [3.9, 4], 'ambient', [true], { loop: 1, pre: ['ambience', { station: 'observe' }] }),
  E('ambient:fog', 'amb', 4, [3.9, 4], 'ambient', [true], { loop: 1, pre: ['ambience', { station: 'observe', weather: 'fog' }] }),
  E('ambient:storm', 'amb', 4, [3.9, 4], 'ambient', [true], { loop: 1, pre: ['ambience', { station: 'aa', weather: 'storm' }] }),
  E('ambient:night', 'amb', 4, [3.9, 4], 'ambient', [true], { loop: 1, pre: ['ambience', { station: 'plot', night: true }] }),
  E('ambient:tension', 'amb', 4, [3.9, 4], 'ambient', [true], { loop: 1, pre: ['ambience', { station: 'plot', tension: 1 }] }),
  E('creak', 'ambfx', 3, [0.3, 2.6]), E('drip', 'ambfx', 2, [0.02, 1.5]), E('foghorn', 'ambfx', 8, [2.5, 8]), E('farThunder', 'ambfx', 9, [2.5, 9]),
  // интерфейс
  E('uiTap', 'ui', 1.2, [0.005, 0.5]), E('dialogOpen', 'ui', 1.5, [0.1, 1]), E('dialogClose', 'ui', 1.5, [0.1, 1]), E('toast', 'ui', 1.5, [0.1, 1]),
  E('saveDone', 'ui', 2, [0.3, 1.5]), E('hintNew', 'ui', 2.5, [0.3, 2]), E('friendlyFire', 'ui', 2.5, [0.5, 1.8]), E('detected', 'ui', 3.5, [0.8, 3.2]),
  E('missionWon', 'ui', 6, [2.6, 5.5]), E('missionLost', 'ui', 7, [3, 6.5]), E('rankUp', 'ui', 4, [1.2, 3.6]), E('dailyRecord', 'ui', 3.5, [0.8, 3]),
  // музыка
  E('music', 'music', 72, [70, 72], 'music', [true], { loop: 1 }),
  // ролик
  E('introGuns', 'intro', 6, [1.5, 6]), E('introWhistle', 'intro', 4, [0.3, 4]), E('introBlast', 'intro', 6, [2, 6], 'introBlast', [1]),
  E('introDoor', 'intro', 4, [1, 4]), E('introMorse', 'intro', 3, [1.2, 2.2]), E('introKey', 'intro', 1.2, [0.005, 0.5]), E('introTitle', 'intro', 6, [2, 6]),
  E('introWind', 'intro', 3, [2.8, 3], 'introWind', [0.75], { loop: 1 }), E('introHiss', 'intro', 3, [2.8, 3], 'introHiss', [0.85], { loop: 1 }),
];
