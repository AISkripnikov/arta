// Тест звукового движка (engine/audio.js): слушать нельзя — значит, меряем.
//   node tools/test-audio.cjs [--table файл.txt] [--wiring | --no-wiring]
// В конце (или только это — --wiring) — проводка звука в игре: личная полная сборка в .dev/audio-game, сценарий боя действиями
// игры, журнал вызовов engine.audio.trace() и состояние петель audio.debug().loops (см. wiring() ниже).
// Сам собирает движок (esbuild) в .dev/audio-test и открывает его в безголовом Chromium. Каждый звук каталога
// (audio.catalogue) играется через настоящий тракт — шины, реверберации, компрессор, лимитер — в OfflineAudioContext,
// результат разбирается: тишина, пик, постоянная составляющая, длительность, спектр, громкость, баланс между
// категориями, швы петель. Отдельно, на живом AudioContext: 200 быстрых звуков не оставляют узлов, пауза страницы.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const outDir = path.resolve(__dirname, '../.dev/audio-test');
const tableIdx = process.argv.indexOf('--table');
const ONLY_WIRING = process.argv.includes('--wiring'), NO_WIRING = process.argv.includes('--no-wiring');
const tableFile = tableIdx >= 0 ? process.argv[tableIdx + 1] : null;

let failed = 0, passed = 0;
const ok = (cond, name, extra) => {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};
// много однотипных проверок: печатаем только сводку и провалы
function group(name, rows, pred, show) {
  const bad = rows.filter((r) => !pred(r));
  ok(bad.length === 0, name + ' (' + rows.length + ')', bad.slice(0, 12).map(show));
}

// ---------- ожидания ----------
// Спектральный центр тяжести, Гц [мин, макс], по категориям; отдельные звуки — в CEN.
const CEN_CAT = {
  gun: [40, 700], hit: [50, 1200], far: [30, 2600], aa: [150, 3500], machine: [80, 5500], control: [300, 7000],
  radio: [500, 3400], air: [60, 1800], amb: [30, 1500], ambfx: [30, 3000], ui: [150, 5000], music: [60, 900], intro: [40, 4500],
};
const CEN = {
  fault: [1500, 9000], overheat: [3000, 11000], paper: [1500, 9000], loupe: [2000, 11000], whistle: [400, 3500], bombWhistle: [600, 5000],
  shellWhoosh: [200, 2500], missionLost: [80, 900], clunk: [100, 2500], leverPull: [100, 2500], pin: [200, 3000], drip: [800, 4000], 'ambient:storm': [100, 6000], introKey: [300, 6000], introHiss: [1000, 5000],
  hintNew: [1000, 7000], dailyRecord: [800, 7000], uiTap: [300, 6000], bell: [900, 7000],
};
// «короткие и тихие»: щелчки интерфейса и приборов
const TICKS = ['tick', 'ratchet', 'detent', 'relay', 'drumTick', 'uiTap', 'pin', 'button', 'switchFlip', 'selector', 'introKey'];
// порядок категорий по громкости (медиана интегральной громкости, дБ): каждая следующая тише
const RANK = ['gun', 'hit', 'aa', 'machine', 'control', 'amb'];

(async () => {
  // ---------- сборка ----------
  const esbuild = require('esbuild');
  fs.mkdirSync(outDir, { recursive: true });
  await esbuild.build({
    stdin: {
      contents: `
        import { createAudio, CATALOGUE } from './src/engine/audio.js';
        import { createBank } from './src/engine/audio/bank.js';
        import { makeNoise } from './src/engine/audio/kit.js';
        import { steelRoomIR, openSeaIR } from './src/engine/audio/space.js';
        import { CAT } from './src/engine/audio/catalogue.js';
        window.__A = { createAudio, CATALOGUE, createBank, makeNoise, steelRoomIR, openSeaIR, CAT };`,
      resolveDir: path.resolve(__dirname, '..'), loader: 'js',
    },
    bundle: true, format: 'iife', target: ['chrome80'], outfile: path.join(outDir, 'app.js'), logLevel: 'warning',
  });
  fs.writeFileSync(path.join(outDir, 'index.html'), '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script src="app.js"></script></body></html>');

  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  if (ONLY_WIRING) {
    await wiring(browser);
    await browser.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(240000);
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.type() + ': ' + m.text()); });
  // учёт живых источников — до загрузки страницы
  await page.addInitScript(() => {
    const L = window.__live = { started: 0, ended: 0, noStop: 0, set: new Set() };
    const P = window.AudioScheduledSourceNode && window.AudioScheduledSourceNode.prototype;
    if (P) {
      const st = P.start, sp = P.stop;
      P.start = function (...a) {
        if (this.context instanceof AudioContext) { L.started++; L.set.add(this); this.addEventListener('ended', () => { L.ended++; L.set.delete(this); }); }
        this.__started = true; return st.apply(this, a);
      };
      P.stop = function (...a) { this.__stopped = true; return sp.apply(this, a); };
    }
  });
  await page.goto('file://' + path.join(outDir, 'index.html'));
  await page.waitForFunction(() => window.__A);

  // ---------- инструменты разбора (в странице) ----------
  await page.evaluate(() => {
    const A = window.__A, T = window.__T = { sets: {}, T0: 0.256 };
    const dB = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);
    T.setup = async (rate) => {
      const base = new OfflineAudioContext(1, 1, rate), t0 = performance.now();
      const noise = A.makeNoise(base, 2, rate, 7);
      const bank = A.createBank(base, noise, { idle: 0 });
      await bank.all();
      const irRoom = A.steelRoomIR(base, rate), irSea = A.openSeaIR(base, rate);
      T.sets[rate] = { noise, bank, irRoom, irSea };
      const irBytes = (irRoom.length + irSea.length) * 2 * 4, noiseBytes = noise.length * 4;
      return { ms: Math.round(performance.now() - t0), bankBytes: bank.bytes, irBytes, noiseBytes, total: bank.bytes + irBytes + noiseBytes, sounds: bank.total, roomSec: irRoom.duration, seaSec: irSea.duration };
    };
    function fft(re, im) {
      const n = re.length;
      for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
      for (let len = 2; len <= n; len <<= 1) {
        const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
          let cr = 1, ci = 0;
          for (let k = 0; k < len / 2; k++) {
            const a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
            re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
            const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
          }
        }
      }
    }
    // истинный пик: 4-кратная передискретизация (оконный sinc) вокруг самых громких отсчётов
    function truePeak(ch, peak) {
      let tp = peak; const n = ch.length, H = 16;
      for (let i = H; i < n - H; i++) {
        if (Math.abs(ch[i]) < peak * 0.7) continue;
        for (let p = 1; p < 4; p++) {
          const fr = p / 4; let s = 0;
          for (let k = -H + 1; k <= H; k++) { const x = k - fr, w = 0.5 + 0.5 * Math.cos(Math.PI * x / H); s += ch[i + k] * (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) * w; }
          if (Math.abs(s) > tp) tp = Math.abs(s);
        }
      }
      return tp;
    }
    T.analyze = (buf) => {
      const rate = buf.sampleRate, L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L, n = L.length;
      const m = new Float32Array(n);
      let peak = 0, sum = 0, nan = 0, first = -1, last = -1, maxDiff = 0, maxDiffAt = 0;
      for (let i = 0; i < n; i++) {
        const l = L[i], r = R[i];
        if (!(l === l) || !(r === r) || !isFinite(l) || !isFinite(r)) { nan++; continue; }
        const a = Math.max(Math.abs(l), Math.abs(r)); if (a > peak) peak = a;
        m[i] = (l + r) / 2; sum += m[i];
        if (a > 0.001) { if (first < 0) first = i; last = i; }
        if (i) { const d = Math.abs(m[i] - m[i - 1]); if (d > maxDiff) { maxDiff = d; maxDiffAt = i; } }
      }
      const tp = Math.max(truePeak(L, peak), truePeak(R, peak));
      // «эффективная» длина: от первого до последнего отсчёта выше пика − 30 дБ
      let e0 = -1, e1 = -1; const thr = peak * 0.0316;
      for (let i = 0; i < n; i++) if (Math.max(Math.abs(L[i]), Math.abs(R[i])) > thr) { if (e0 < 0) e0 = i; e1 = i; }
      // интегральная громкость: средняя мощность по блокам 50 мс выше −55 дБ; кратковременная: максимум по окну 400 мс
      const blk = Math.floor(rate * 0.05), pows = [];
      for (let i = 0; i + blk <= n; i += blk) { let p = 0; for (let k = 0; k < blk; k++) p += (L[i + k] * L[i + k] + R[i + k] * R[i + k]) / 2; pows.push(p / blk); }
      const gate = Math.pow(10, -55 / 10), act = pows.filter((p) => p > gate);
      const rms = act.length ? Math.sqrt(act.reduce((a, b) => a + b, 0) / act.length) : 0;
      let st = 0; for (let i = 0; i < pows.length; i++) { let s = 0, c = 0; for (let k = i; k < Math.min(pows.length, i + 8); k++) { s += pows[k]; c++; } if (c === 8 || pows.length < 8) st = Math.max(st, s / 8); }
      const all = Math.sqrt(pows.reduce((a, b) => a + b, 0) / Math.max(1, pows.length));
      // спектр: усреднённая мощность по кадрам 4096 (окно Ханна)
      const N = 4096, spec = new Float64Array(N / 2), re = new Float64Array(N), im = new Float64Array(N);
      const from = Math.max(0, first), to = Math.max(from + N, last + 1);
      for (let s = from; s < to; s += N / 2) {
        for (let i = 0; i < N; i++) { const x = s + i < n ? m[s + i] : 0; re[i] = x * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); im[i] = 0; }
        fft(re, im);
        for (let i = 0; i < N / 2; i++) spec[i] += re[i] * re[i] + im[i] * im[i];
      }
      let tot = 0, cen = 0, low = 0, sub = 0, high = 0, mid = 0; const hz = rate / N;
      for (let i = 1; i < N / 2; i++) { const f = i * hz, p = spec[i]; tot += p; cen += p * f; if (f < 90) low += p; if (f >= 28 && f <= 75) sub += p; if (f > 4000) high += p; if (f >= 300 && f <= 6000) mid += p; }
      return {
        peak: dB(peak), tp: dB(tp), dc: sum / n, nan, start: first < 0 ? -1 : first / rate, dur: first < 0 ? 0 : (last - first + 1) / rate, eff: e0 < 0 ? 0 : (e1 - e0 + 1) / rate,
        rms: dB(rms), st: dB(Math.sqrt(st)), all: dB(all), cen: tot ? cen / tot : 0, low: tot ? low / tot : 0, sub: tot ? sub / tot : 0, high: tot ? high / tot : 0,
        subDb: dB(rms * Math.sqrt(tot ? sub / tot : 0)), midDb: dB(rms * Math.sqrt(tot ? mid / tot : 0)), mid: tot ? mid / tot : 0, maxDiff, maxDiffAt: maxDiffAt / rate, endDb: dB(Math.max(Math.abs(L[n - 1]), Math.abs(R[n - 1]))),
      };
    };
    // сыграть элемент каталога через настоящий тракт; steps — [[t, fn, args]…] действия по ходу просчёта
    T.render = async (e, rate, o = {}) => {
      const oc = new OfflineAudioContext(2, Math.ceil(((o.win || e.win) + T.T0) * rate), rate);
      const a = A.createAudio({ context: oc, shared: T.sets[rate], seed: o.seed || 5 });
      if (o.before) o.before(a);
      // звук запускается не в нуле, а через T0: компрессор WebAudio первые миллисекунды жизни контекста «раскрывается» из тишины
      oc.suspend(T.T0).then(() => { if (e.pre) a[e.pre[0]](e.pre[1]); T.ret = a[e.fn](...e.args); oc.resume(); });
      for (const [t, fn, args] of (o.steps || [])) oc.suspend(T.T0 + t).then(() => { a[fn](...args); oc.resume(); });
      const full = await oc.startRendering();
      const i0 = Math.round(T.T0 * rate), buf = new AudioBuffer({ length: full.length - i0, numberOfChannels: 2, sampleRate: rate });
      for (let ch = 0; ch < 2; ch++) buf.copyToChannel(full.getChannelData(ch).subarray(i0), ch);
      T.lastBuf = buf;
      const r = T.analyze(buf);
      r.nodes = a.debug().nodes;
      return r;
    };
    T.slice = (t0, t1) => {              // разбор куска последнего просчёта
      const b = T.lastBuf, r = b.sampleRate, i0 = Math.floor(t0 * r), i1 = Math.min(b.length, Math.floor(t1 * r));
      const c = new AudioBuffer({ length: Math.max(1, i1 - i0), numberOfChannels: 2, sampleRate: r });
      for (let ch = 0; ch < 2; ch++) c.copyToChannel(b.getChannelData(ch).subarray(i0, i1), ch);
      return T.analyze(c);
    };
    // шов петли в буфере банка: скачок между последним и первым отсчётом против обычных скачков внутри
    T.seam = (rate, name) => {
      const d = T.sets[rate].bank.variants(name)[0].getChannelData(0), n = d.length, diffs = new Float32Array(n - 1);
      let mx = 0; for (let i = 1; i < n; i++) { diffs[i - 1] = Math.abs(d[i] - d[i - 1]); if (diffs[i - 1] > mx) mx = diffs[i - 1]; }
      const sorted = Array.from(diffs).sort((a, b) => a - b), p999 = sorted[Math.floor(sorted.length * 0.999)];
      return { seam: Math.abs(d[0] - d[n - 1]), max: mx, p999, sec: n / T.sets[rate].bank.variants(name)[0].sampleRate };
    };
    // наибольший скачок вблизи моментов times (±w с) в последнем просчёте против наибольшего скачка вообще
    T.jumps = (times, w) => {
      const b = T.lastBuf, r = b.sampleRate, L = b.getChannelData(0), R = b.getChannelData(1);
      let near = 0, all = 0;
      for (let i = 1; i < b.length; i++) {
        const d = Math.max(Math.abs(L[i] - L[i - 1]), Math.abs(R[i] - R[i - 1])), t = i / r;
        if (d > all) all = d;
        if (times.some((x) => Math.abs(t - x) <= w) && d > near) near = d;
      }
      return { near, all };
    };
  });

  // ---------- 1. просчёт банка и память ----------
  console.log('банк звуков');
  const RATE = 48000;
  const setup = await page.evaluate((r) => window.__T.setup(r), RATE);
  console.log('  --   просчитано ' + setup.sounds + ' буферов за ' + setup.ms + ' мс; банк ' + (setup.bankBytes / 1048576).toFixed(2) + ' МБ, отклики ' + (setup.irBytes / 1048576).toFixed(2) + ' МБ, шум ' + (setup.noiseBytes / 1048576).toFixed(2) + ' МБ');
  ok(setup.total <= 12 * 1048576, 'вся память буферов ≤ 12 МБ при 48 кГц', (setup.total / 1048576).toFixed(2) + ' МБ');
  ok(setup.roomSec >= 0.7 && setup.roomSec <= 1.0, 'отклик «стальная комната» 0.7–1.0 с', setup.roomSec);
  ok(setup.seaSec >= 3 && setup.seaSec <= 4, 'отклик «открытое море» 3–4 с', setup.seaSec);
  const bankInfo = await page.evaluate((r) => {
    const A = window.__A, b = window.__T.sets[r].bank, out = [];
    for (const name of Object.keys(A.CAT)) {
      const vs = b.variants(name); let peak = 0, nan = 0;
      for (const v of vs) { const d = v.getChannelData(0); for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (!(a === a)) nan++; if (a > peak) peak = a; } }
      out.push({ name, n: vs.length, want: A.CAT[name].v || 1, peak, nan, sec: vs[0] ? vs[0].duration : 0, d: A.CAT[name].d });
    }
    return out;
  }, RATE);
  group('каждый рецепт просчитан во все варианты', bankInfo, (r) => r.n === r.want, (r) => r.name + ' ' + r.n + '/' + r.want);
  group('буферы нормированы, без NaN, не длиннее рецепта', bankInfo, (r) => r.nan === 0 && r.peak > 0.9 && r.peak <= 1 && r.sec <= r.d + 0.08, (r) => [r.name, r.peak, r.sec]);
  const heavy = ['gun', 'nearMiss', 'turretHit', 'aaShot', 'breechOpen', 'breechClose', 'ram', 'bombBurst'];
  group('у тяжёлых звуков 2–3 варианта', bankInfo.filter((r) => heavy.includes(r.name)), (r) => r.n >= 2, (r) => r.name);

  // ---------- 2. каждый звук каталога через настоящий тракт ----------
  console.log('каталог через тракт (OfflineAudioContext, ' + RATE + ' Гц)');
  const cat = await page.evaluate(() => window.__A.CATALOGUE.map((e) => ({ id: e.id, cat: e.cat, win: e.win, dur: e.dur, loop: !!e.loop, fn: e.fn })));
  const rows = [];
  for (const e of cat) {
    const r = await page.evaluate(([id, rate]) => window.__T.render(window.__A.CATALOGUE.find((x) => x.id === id), rate), [e.id, RATE]);
    rows.push(Object.assign({}, e, r));
  }
  const api = await page.evaluate(() => { const a = window.__A.createAudio(); return Object.keys(a).filter((k) => typeof a[k] === 'function'); });
  const service = ['unlock', 'setMuted', 'setVolume', 'setBus', 'busNode', 'suspend', 'resume', 'dispose', 'prerender', 'play', 'debug', 'introVolume', 'introStop',
    'stopper', 'lever', 'toggle', 'slew', 'nearMiss', 'ambience', 'tension', 'trace', 'duckBus'];   // служебные и вторые имена тех же звуков
  const covered = new Set(cat.map((e) => e.fn));
  const missing = api.filter((k) => !covered.has(k) && !service.includes(k));
  ok(missing.length === 0, 'в каталоге есть каждая звуковая функция движка', missing);
  const legacy = ['tick', 'ratchet', 'clunk', 'leverPull', 'switchFlip', 'buzz', 'servo', 'hoist', 'ram', 'breech', 'fire', 'whistle', 'impactNear', 'thunder', 'impactFar', 'radio',
    'alarm', 'ambient', 'suspend', 'resume', 'dispose', 'unlock', 'setMuted', 'setVolume', 'setBus', 'busNode', 'aaBurst', 'planeDrone', 'bombHit', 'siren',
    'introVolume', 'introWind', 'introHiss', 'introGuns', 'introWhistle', 'introBlast', 'introDoor', 'introMorse', 'introKey', 'introTitle', 'introStop'];
  ok(legacy.every((k) => api.includes(k)), 'все прежние имена API на месте', legacy.filter((k) => !api.includes(k)));

  const show = (r) => r.id + ' ' + JSON.stringify({ peak: +r.peak.toFixed(1), tp: +r.tp.toFixed(1), dur: +r.dur.toFixed(2), rms: +r.rms.toFixed(1), cen: Math.round(r.cen), dc: +r.dc.toExponential(1) });
  group('не тишина', rows, (r) => r.peak > -50 && r.rms > -60, show);
  group('без NaN и бесконечностей', rows, (r) => r.nan === 0, show);
  group('истинный пик ≤ −1 дБ после лимитера', rows, (r) => r.tp <= -1, show);
  group('нет постоянной составляющей (|среднее| < 0.002)', rows, (r) => Math.abs(r.dc) < 0.002, show);

  const byId = {}; rows.forEach((r) => { byId[r.id] = r; });
  const sec = {}; cat.forEach((e) => { sec[e.id] = e.dur; });
  group('длительность в ожидаемом окне', rows, (r) => r.dur >= sec[r.id][0] && r.dur <= sec[r.id][1], (r) => r.id + ' ' + r.dur.toFixed(2) + ' не в ' + JSON.stringify(sec[r.id]));
  group('разовые звуки затихают до конца окна (хвост < −60 дБ)', rows.filter((r) => !r.loop), (r) => r.endDb < -60, (r) => r.id + ' ' + r.endDb.toFixed(1));
  group('непрерывные звуки начинаются сразу (≤ 0.15 с)', rows.filter((r) => r.loop), (r) => r.start >= 0 && r.start <= 0.15, (r) => r.id + ' ' + r.start);
  group('спектральный центр в задуманной полосе', rows, (r) => { const w = CEN[r.id] || CEN_CAT[r.cat]; return r.cen >= w[0] && r.cen <= w[1]; }, (r) => r.id + ' ' + Math.round(r.cen) + ' не в ' + JSON.stringify(CEN[r.id] || CEN_CAT[r.cat]));
  group('каждый звук слышен в динамике телефона (полоса 0.3–6 кГц выше −60 дБ)', rows, (r) => r.midDb > -60, (r) => r.id + ' ' + r.midDb.toFixed(1));

  console.log('главный калибр');
  const gun = byId.fire, events = rows.filter((r) => r.id !== 'fire' && r.cat !== 'intro');
  ok(gun.sub >= 0.2 && gun.subDb >= -30, 'в выстреле настоящий суб-бас: полоса 28–75 Гц ≥ 20 % энергии и выше −30 дБ', { share: +gun.sub.toFixed(2), dB: +gun.subDb.toFixed(1) });
  ok(gun.midDb >= -30, 'и середина, слышная в телефоне (0.3–6 кГц выше −30 дБ)', +gun.midDb.toFixed(1));
  const louder = events.filter((r) => r.rms >= gun.rms || r.st >= gun.st);
  ok(louder.length === 0, 'выстрел — самое громкое событие (и интегрально, и за 400 мс)', louder.map((r) => [r.id, +r.rms.toFixed(1), +r.st.toFixed(1)]));
  ok(gun.dur >= 2.5, 'длинный хвост выстрела (≥ 2.5 с)', gun.dur);

  console.log('щелчки и баланс');
  group('щелчки приборов и интерфейса короткие (≤ 0.25 с до −30 дБ от пика) и тихие (пик ≤ −14 дБ, 400 мс ≤ −40 дБ)', rows.filter((r) => TICKS.includes(r.id)),
    (r) => r.eff <= 0.25 && r.peak <= -14 && r.st <= -40, (r) => [r.id, +r.eff.toFixed(2), +r.peak.toFixed(1), +r.st.toFixed(1)]);
  const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
  const med = {}; for (const c of Object.keys(CEN_CAT)) { const list = rows.filter((r) => r.cat === c).map((r) => r.rms); if (list.length) med[c] = median(list); }
  console.log('  --   медианы интегральной громкости по категориям, дБ: ' + RANK.map((c) => c + ' ' + med[c].toFixed(1)).join(' > '));
  for (let i = 1; i < RANK.length; i++) ok(med[RANK[i - 1]] > med[RANK[i]] + 1, 'баланс: ' + RANK[i - 1] + ' громче ' + RANK[i] + ' (больше чем на 1 дБ)', [med[RANK[i - 1]], med[RANK[i]]]);
  const beds = rows.filter((r) => r.cat === 'amb');
  group('фон не доходит до лимитера (пик ≤ −14 дБ) и тише радио', beds, (r) => r.peak <= -14 && r.rms < byId.radio.rms - 6, show);
  ok(byId['ambient:night'].rms < byId['ambient:room'].rms - 1, 'ночью фон тише', [byId['ambient:night'].rms, byId['ambient:room'].rms]);
  ok(byId['ambient:tension'].rms > byId['ambient:room'].rms + 0.5, 'напряжение боя добавляет слой', [byId['ambient:tension'].rms, byId['ambient:room'].rms]);
  ok(byId['ambient:storm'].cen > byId['ambient:observe'].cen && byId['ambient:storm'].rms > byId['ambient:observe'].rms + 1, 'шторм громче и ярче ясной погоды', [byId['ambient:storm'].rms, byId['ambient:observe'].rms]);
  ok(byId['ambient:fog'].high < byId['ambient:observe'].high, 'туман глуше ясной погоды', [byId['ambient:fog'].high, byId['ambient:observe'].high]);
  ok(byId['ambient:observe'].cen > byId['ambient:room'].cen * 0.9 && byId['ambient:loading'].low > byId['ambient:room'].low, 'пост меняет окраску фона (наблюдение — воздух, заряжание — механизмы)');
  const urg = ['hq', 'spotter', 'crew', 'meteo', 'convoy'];
  ok(urg.every((c) => byId['radioMsg:' + c + '!'].rms > byId['radioMsg:' + c].rms && byId['radioMsg:' + c + '!'].cen > byId['radioMsg:' + c].cen), 'срочное сообщение громче и выше обычного — у каждого отправителя');
  const cens = urg.map((c) => Math.round(byId['radioMsg:' + c].cen)).sort((a, b) => a - b);
  ok(cens.every((c, i) => !i || c - cens[i - 1] >= 15), 'у отправителей разная окраска посылки (центры спектра различаются)', cens);

  // ---------- 3. швы петель ----------
  console.log('петли');
  for (const name of ['hoistLoop', 'aaLoop', 'rainLoop']) {
    const sm = await page.evaluate(([r, n]) => window.__T.seam(r, n), [RATE, name]);
    ok(sm.seam <= Math.max(sm.p999 * 3, sm.max * 0.25), 'петля ' + name + ' (' + sm.sec.toFixed(2) + ' с): нет скачка на шве', sm);
  }
  // через тракт: второй и третий круги петли звучат одинаково (нет провала или щелчка на стыке)
  for (const [id, len] of [['hoistRun', 0.96], ['aaFire', 0.88]]) {
    const r = await page.evaluate(async ([id, rate, len]) => {
      const T = window.__T; await T.render(window.__A.CATALOGUE.find((x) => x.id === id), rate, { win: 0.3 + len * 3.2 });
      return [T.slice(0.3 + len, 0.3 + len * 2).all, T.slice(0.3 + len * 2, 0.3 + len * 3).all];
    }, [id, RATE, len]);
    ok(Math.abs(r[0] - r[1]) < 0.7, id + ': соседние круги петли равны по громкости', r);
  }
  const mus = await page.evaluate(async (rate) => {
    const T = window.__T; await T.render(window.__A.CATALOGUE.find((x) => x.id === 'music'), rate);
    const blocks = []; for (let t = 4; t < 71; t++) blocks.push(T.slice(t, t + 1).all);
    return { blocks, seam: T.jumps([64], 0.08), ref: T.jumps([16], 0.08), a: T.slice(4, 12).all, b: T.slice(64, 72).all, before: T.slice(60, 64).all, after: T.slice(64, 68).all };
  }, RATE);
  const mm = median(mus.blocks);
  ok(Math.min(...mus.blocks) > mm - 9 && Math.max(...mus.blocks) < mm + 9, 'музыка: круг 64 с без провалов и всплесков (посекундная громкость в пределах ±9 дБ от медианы)', { min: Math.min(...mus.blocks), max: Math.max(...mus.blocks), mm });
  ok(mus.seam.near <= mus.ref.near * 2 + 1e-4, 'музыка: на стыке круга (64 с) нет скачка — не больше, чем на обычной смене аккорда', mus);
  ok(Math.abs(mus.before - mus.after) < 6, 'музыка: громкость до и после стыка круга близка', [mus.before, mus.after]);

  // ---------- 4. включение/выключение по ходу ----------
  console.log('пуск и останов');
  const run = (id, o) => page.evaluate(async ([id, rate, o]) => {
    const T = window.__T, e = window.__A.CATALOGUE.find((x) => x.id === id);
    const before = o.before ? (a) => o.before.forEach(([fn, args]) => a[fn](...args)) : null;
    const r = await T.render(e, rate, { win: o.win, steps: o.steps, before });
    return { r, parts: (o.parts || []).map(([a, b]) => { const s = T.slice(a, b); return { all: s.all, peak: s.peak }; }) };
  }, [id, RATE, o]);
  let x = await run('aaFire', { win: 5, steps: [[1, 'aaFire', [false]]], parts: [[0.2, 0.9], [1.1, 1.5], [4.4, 5]] });
  ok(x.parts[1].all > -55 && x.parts[1].all < x.parts[0].all - 3, 'aaFire(false): очередь обрывается, остаётся хвост (дозвон, гильзы)', x.parts);
  ok(x.parts[2].peak < -70, 'aaFire: после хвоста тишина', x.parts[2]);
  x = await run('hoistRun', { win: 4, steps: [[1.2, 'hoistRun', [false]]], parts: [[0.3, 1.1], [1.25, 1.6], [3.4, 4]] });
  ok(x.parts[1].all > -60 && x.parts[2].peak < -70, 'hoistRun(false): тормоз и выбег, затем тишина', x.parts);
  for (const [id, fn, args, quietFrom, win] of [['servo', 'servo', [0], 2.2, 3], ['gear', 'gear', [0], 2, 3], ['planeDrone', 'planeDrone', [0], 4, 5], ['sirenRun', 'sirenRun', [false], 7, 8],
    ['alarm', 'alarm', [false], 2, 3], ['radioStatic', 'radioStatic', [0], 2.5, 3.5], ['ambient:storm', 'ambient', [false], 4.2, 5], ['music', 'music', [false], 6, 7]]) {
    x = await run(id, { win, steps: [[1, fn, args]], parts: [[0.3, 0.9], [quietFrom, win]] });
    ok(x.parts[0].all > -60 && x.parts[1].peak < -70, id + ': выключается и затихает до тишины', x.parts);
  }
  x = await run('ambient:room', { win: 5, before: [['setBus', ['fx', 0]]], steps: [[1.5, 'fire', []]], parts: [[0.5, 1.4], [1.62, 1.9], [4.2, 5]] });
  ok(x.parts[1].all < x.parts[0].all - 5, 'выстрел кратко приглушает фон (больше чем на 5 дБ)', x.parts);
  ok(Math.abs(x.parts[2].all - x.parts[0].all) < 2.5, 'и фон возвращается (через ~2.5 с — в пределах 2.5 дБ)', x.parts);
  x = await run('music', { win: 13, before: [['setBus', ['amb', 0]]], steps: [[3, 'ambient', [true]], [9, 'ambient', [false]]], parts: [[1, 3], [8, 9], [11, 13]] });
  ok(x.parts[0].all > -60 && x.parts[1].peak < -70, 'начало боя (фон включён) глушит музыку меню', x.parts);
  ok(x.parts[2].all > -60, 'после боя музыка возвращается сама', x.parts);

  // ---------- 5. громкости ----------
  console.log('звук выкл и шины');
  x = await run('fire', { win: 3, before: [['setMuted', [true]]], parts: [] });
  ok(x.r.peak < -120, 'setMuted(true): полная тишина', x.r.peak);
  x = await run('ambient:storm', { win: 3, steps: [[1, 'setMuted', [true]]], parts: [[0.3, 0.9], [1.3, 3]] });
  ok(x.parts[0].all > -60 && x.parts[1].peak < -90, 'звук выключается мгновенно (через 0.3 с — тишина)', x.parts);
  for (const [id, busName] of [['fire', 'fx'], ['ambient:room', 'amb'], ['radio', 'radio'], ['music', 'music'], ['creak', 'amb'], ['uiTap', 'fx']]) {
    x = await run(id, { win: 3, before: [['setBus', [busName, 0]]], parts: [] });
    ok(x.r.peak < -120, 'setBus(' + busName + ', 0) глушит ' + id + ' вместе с эхом', x.r.peak);
  }
  x = await run('radio', { win: 2, before: [['setBus', ['radio', 2]]], parts: [] });
  ok(x.r.rms > byId.radio.rms + 4 && x.r.tp <= -1, 'setBus(radio, 2): громче примерно вдвое, пик по-прежнему под потолком', [x.r.rms, byId.radio.rms, x.r.tp]);
  // всё разом на предельных громкостях: потолок держится
  x = await page.evaluate(async (rate) => {
    const T = window.__T;
    const e = { win: 5, fn: 'fire', args: [] };
    return T.render(e, rate, { before: (a) => { a.setVolume(1); for (const b of ['fx', 'amb', 'radio', 'music']) a.setBus(b, 2); },
      steps: [[0.01, 'turretHit', []], [0.02, 'bombBurst', []], [0.03, 'aaFire', [true]], [0.04, 'ambient', [true]], [0.05, 'siren', []], [0.06, 'radioMsg', ['hq', true]], [0.1, 'fire', []], [0.2, 'impactNear', []]] });
  }, RATE);
  ok(x.tp <= -1 && x.nan === 0, 'всё сразу на предельной громкости: истинный пик ≤ −1 дБ, без NaN', +x.tp.toFixed(2));

  // ---------- 6. 44.1 кГц ----------
  console.log('44.1 кГц');
  const s44 = await page.evaluate(() => window.__T.setup(44100));
  ok(s44.total <= 12 * 1048576, 'память буферов ≤ 12 МБ при 44.1 кГц', (s44.total / 1048576).toFixed(2));
  for (const id of ['fire', 'tick', 'ambient:storm', 'radioMsg:meteo', 'hoist', 'aaFire', 'missionWon']) {
    const r = await page.evaluate(([id, rate]) => window.__T.render(window.__A.CATALOGUE.find((q) => q.id === id), rate), [id, 44100]);
    const ref = byId[id];
    ok(r.nan === 0 && r.tp <= -1 && Math.abs(r.rms - ref.rms) < 2.5 && Math.abs(r.dur - ref.dur) < 0.35, id + ' при 44.1 кГц звучит так же (громкость ±2.5 дБ, длительность ±0.35 с)', { rms: [r.rms, ref.rms], dur: [r.dur, ref.dur] });
  }

  // ---------- 7. живой контекст: запасной путь, утечки, пауза ----------
  console.log('живой AudioContext');
  const liveOk = await page.evaluate(async () => {
    const a = window.__a = window.__A.createAudio();
    const calls = ['tick', 'fire', 'ambient', 'alarm', 'music', 'servo'];
    let threw = 0; for (const k of calls) { try { a[k](true); } catch (e) { threw++; } }      // до unlock — тихо и без исключений
    const early = a.ready;
    a.alarm(false); a.ambient(false); a.music(false);
    a.unlock();
    await new Promise((r) => setTimeout(r, 300));
    const t0 = a.debug();
    return { threw, early, ready: a.ready, state: t0.state };
  });
  ok(liveOk.threw === 0 && liveOk.early === false, 'до unlock() вызовы молчат и не бросают исключений', liveOk);
  if (!liveOk.ready || liveOk.state !== 'running') console.log('  --   живой AudioContext в этом браузере не идёт (' + liveOk.state + ') — проверки живого звука пропущены');
  else {
    // запасной путь: банк ещё не готов — звук играет вживую
    const fb = await page.evaluate(async () => {
      const a = window.__a, d0 = a.debug();
      a.fire(); a.impactNear(); a.tick(); a.radio(); a.missionWon(); a.breech('open');
      const d1 = a.debug();
      await a.prerender();
      const d2 = a.debug();
      return { pending0: d0.bankPending, voices: d1.voices, nodes: d1.nodes, pending2: d2.bankPending, bytes: d2.bufferBytes, total: d2.bankTotal };
    });
    ok(fb.voices >= 6 && fb.nodes > 6, 'пока банк не готов, звуки играют вживую (запасной путь)', fb);
    ok(fb.pending2 === 0 && fb.bytes > 4e6 && fb.bytes <= 12 * 1048576, 'банк досчитан в фоне, память ≤ 12 МБ', fb);
    const wait0 = () => page.waitForFunction(() => { const d = window.__a.debug(); return d.nodes === 0 && d.voices === 0 && window.__live.set.size === 0; }, null, { timeout: 15000 }).then(() => true, () => false);
    ok(await wait0(), 'после отзвучки не остаётся ни узлов, ни источников', await page.evaluate(() => [window.__a.debug(), window.__live.set.size]));
    const rapid = await page.evaluate(async () => {
      const a = window.__a, names = ['tick', 'detent', 'clunk', 'toggle', 'button', 'relay', 'drum', 'uiTap', 'aaShot', 'ram'];
      let maxVoices = 0, played = 0;
      for (let i = 0; i < 200; i++) {
        if (a.play(names[i % names.length], { force: true, pan: (i % 5 - 2) / 2 })) played++;
        maxVoices = Math.max(maxVoices, a.debug().voices);
        if (i % 4 === 3) await new Promise((r) => setTimeout(r, 12));
      }
      return { maxVoices, played, started: window.__live.started };
    });
    ok(rapid.played === 200, '200 быстрых звуков подряд сыграны', rapid);
    ok(rapid.maxVoices <= 28, 'число одновременных голосов ограничено (≤ 28; лишние гаснут за 40 мс)', rapid.maxVoices);
    ok(await wait0(), '200 быстрых звуков не оставили живых узлов и источников', await page.evaluate(() => [window.__a.debug(), window.__live.set.size]));
    const cyc = await page.evaluate(async () => {
      const a = window.__a; let threw = 0;
      a.ambience({ station: 'aa', weather: 'storm', tension: 0.7 });
      for (let i = 0; i < 12; i++) {
        try {
          a.servo(0.5); a.gear(0.6); a.hoistRun(true); a.aaFire(true); a.planeDrone(0.8, i / 12); a.sirenRun(true); a.alarm(true); a.radioStatic(1); a.ambient(true); a.music(true); a.introWind(0.6); a.introHiss(0.6);
          a.whistle(0.4); a.flyby({ dur: 1 }); a.hoist(0.5); a.siren(); a.bell(2);
          await new Promise((r) => setTimeout(r, 60));
          a.servo(0); a.gear(0); a.hoistRun(false); a.aaFire(false); a.planeDrone(0); a.sirenRun(false); a.alarm(false); a.radioStatic(0); a.ambient(false); a.music(false); a.introStop();
          await new Promise((r) => setTimeout(r, 30));
        } catch (e) { threw++; }
      }
      return { threw, live: window.__live.set.size };
    });
    ok(cyc.threw === 0, '12 кругов «включить всё — выключить всё» без исключений', cyc);
    ok(await wait0(), 'после выключения всех петель, фона и музыки не остаётся узлов и источников', await page.evaluate(() => [window.__a.debug(), window.__live.set.size]));
    const unstopped = await page.evaluate(() => window.__live.started - window.__live.ended);
    ok(unstopped === 0, 'каждый запущенный источник завершился', unstopped);
    const sus = await page.evaluate(async () => {
      const a = window.__a, w = (ms) => new Promise((r) => setTimeout(r, ms));
      a.suspend(); await w(250); const s1 = a.debug().state;
      a.tick(); a.fire(); a.ambient(true); await w(250); const s2 = a.debug().state, v2 = a.debug().voices;
      a.resume(); await w(300); const s3 = a.debug().state, amb = a.debug().ambient;
      a.ambient(false); a.dispose(); a.tick(); a.fire(); a.ambient(true);
      return { s1, s2, v2, s3, amb, after: a.ready };
    });
    ok(sus.s1 === 'suspended' && sus.s2 === 'suspended' && sus.v2 === 0, 'suspend(): контекст спит, разовые звуки его не будят', sus);
    ok(sus.s3 === 'running' && sus.amb === true, 'resume(): контекст идёт, включённый за время паузы фон на месте', sus);
    ok(sus.after === false, 'dispose(): дальше все вызовы молчат', sus);
  }
  ok(problems.length === 0, 'нет ошибок и предупреждений в консоли', problems.slice(0, 5));
  if (!NO_WIRING) await wiring(browser);
  const f1 = (x) => (x <= -179 ? '  -inf' : x.toFixed(1).padStart(6));
  const lines = ['звук                кат.      пик    ист.пик  длит.  эфф.   инт.   400мс  центр  <90Гц  >4кГц  0.3–6к'];
  for (const r of rows) lines.push(r.id.padEnd(20) + r.cat.padEnd(8) + f1(r.peak) + '  ' + f1(r.tp) + '  ' + r.dur.toFixed(2).padStart(5) + '  ' + r.eff.toFixed(2).padStart(5) + ' ' + f1(r.rms) + ' ' + f1(r.st) + '  ' + String(Math.round(r.cen)).padStart(5) + '  ' + (r.low * 100).toFixed(0).padStart(4) + '%  ' + (r.high * 100).toFixed(0).padStart(4) + '% ' + f1(r.midDb));
  console.log(lines.join('\n'));
  if (tableFile) fs.writeFileSync(tableFile, lines.join('\n') + '\n');
  if (problems.length) console.log(problems.slice(0, 10));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

// ---------- 8. проводка звука в игре ----------
// Полная игра (личная сборка), сценарий боя действиями game.*; журнал вызовов engine.audio.trace() — что, когда и с какими
// аргументами позвала игра, audio.debug().loops — какие петли звучат. Проверяются последовательности, а не громкость.
async function wiring(browser) {
  console.log('проводка звука в игре (полная сборка, сценарий боя)');
  const root = path.resolve(__dirname, '..'), dir = path.join(root, '.dev/audio-game');
  require('child_process').execFileSync(process.execPath, ['build.mjs', '--out', dir], { cwd: root, stdio: 'pipe' });
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('arta2.intro', '1'); localStorage.setItem('arta2.news', '999'); } catch (e) { /* хранилище недоступно */ }
    window.ArtaNative = { ready() {}, applyUpdate() {} };
  });
  const pg = await ctx.newPage();
  pg.setDefaultTimeout(300000);
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto('file://' + path.join(dir, 'index.html'));
  await pg.waitForFunction(() => window.__arta && window.__arta.soundscape);
  await pg.evaluate(() => {
    const { engine, game } = window.__arta, a = engine.audio;
    engine.setQuality('low');                       // программная отрисовка: «АВТО» само ушло бы на экономное — задаём явно
    a.trace(true); a.unlock();
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const frames = async (n) => { for (let i = 0; i < n; i++) await frame(); };
    // время боя вперёд шагами по 0.1 с; кадр движка (и звуковая обстановка) — каждые every шагов
    const step = async (cond, maxSec = 300, every = 4, dt = 0.1) => { for (let i = 0; i < maxSec / dt && !cond(); i++) { game.update(dt); if (i % every === every - 1) await frame(); } await frames(2); return !!cond(); };
    const wait = async (cond, ms = 20000) => { const t0 = performance.now(); while (!cond() && performance.now() - t0 < ms) await frame(); return !!cond(); };
    const calls = (n, since = 0) => a.trace().filter((e) => e.t >= since && (!n || e.n === n || (Array.isArray(n) && n.includes(e.n))));
    const loopsOff = () => { const l = a.debug().loops; return Object.keys(l).filter((k) => l[k]); };
    window.__W = { frame, frames, step, wait, calls, loopsOff, ss: () => window.__arta.soundscape.state, dbg: () => a.debug() };
  });

  // меню: музыка (state-вызов до первого касания запомнен и применён при unlock)
  const m0 = await pg.evaluate(async () => {
    const W = window.__W, a = window.__arta.engine.audio;
    await W.wait(() => a.musicPlaying, 8000);
    return { mode: W.ss().mode, music: a.musicPlaying, ctx: W.dbg().state, amb: W.dbg().ambient };
  });
  ok(m0.mode === 'menu' && m0.music && !m0.amb, 'игра: в меню играет музыка, фона башни нет', m0);

  // бой: задание 1 полностью — заряжание, выстрел, разрыв, победа
  const b1 = await pg.evaluate(async () => {
    const { game, engine } = window.__arta, a = engine.audio, s = game.state, W = window.__W, RAD = Math.PI / 180, t0 = performance.now();
    game.startMission(0); await W.frames(3);
    const brief = { mode: W.ss().mode, music: a.musicPlaying };
    game.begin(); await W.wait(() => W.ss().mode === 'battle'); await W.frames(3);
    const start = { music: a.musicPlaying, amb: W.dbg().ambient, ambience: W.calls('ambience', t0).map((e) => e.a[0]) };
    const tSt = performance.now();
    engine.gotoStation('loading', { instant: true }); await W.frames(3);
    const st = { ambience: W.calls('ambience', tSt).map((e) => e.a[0]), gear: W.calls('gear', tSt).map((e) => e.a[0]) };
    await W.step(() => s.targets[0].reported, 120);
    const t = s.targets[0], bat = s.mission.battery;
    game.setPin(t.id, t.reported.x, t.reported.y);
    const dx = t.reported.x - bat.x, dy = t.reported.y - bat.y, rng = Math.hypot(dx, dy), brg = ((Math.atan2(dx, dy) / RAD) + 360) % 360;
    game.setAlidade({ bearing: brg, range: rng }); game.recordMeasurement();
    game.setComputerRange(rng); const ch = game.chargeStates().indexOf('ok') + 1; game.setComputerCharge(ch); const sol = game.compute();
    const tL = performance.now(), free = () => !s.breech.busy;
    let hoistSeen = false;
    game.openBreech(); await W.step(free, 20, 1, 0.1);
    game.hoistShell('he');
    for (let i = 0; i < 300 && s.breech.busy; i++) { game.update(0.05); await W.frame(); if (W.dbg().loops.hoist) hoistSeen = true; }
    await W.frames(3);
    const hoistAfter = W.dbg().loops.hoist;
    game.ramShell(); await W.step(free, 20, 1, 0.1);
    for (let i = 0; i < ch; i++) { game.addCharge(); await W.step(free, 20, 1, 0.1); }
    game.closeBreech(); await W.step(free, 20, 1, 0.1);
    engine.gotoStation('traverse', { instant: true });
    game.setBrake(false); game.rotateTurret(s.plot.recorded[t.id].bearing - s.turret.bearing); game.setBrake(true);
    engine.gotoStation('elevation', { instant: true });
    game.elevate(sol.elevation - s.turret.elevation);
    engine.gotoStation('fire', { instant: true }); await W.frames(2);
    const tF = performance.now();
    game.arm(true); const f = game.fire();
    await W.step(() => s.phase !== 'playing', 60, 2);
    await W.wait(() => W.ss().mode === 'end', 5000); await W.wait(() => W.calls(['missionWon', 'missionLost'], tL).length > 0, 8000); await W.frames(3);
    const SEQ = ['breechOpen', 'hoistRun', 'ram', 'charge', 'breechClose', 'fire', 'impact', 'missionWon', 'missionLost'];
    const seq = W.calls(SEQ, tL).map((e) => e.n + (e.n === 'hoistRun' ? ':' + e.a[0] : ''));
    const imp = W.calls('impact', tF).map((e) => e.a[0]);
    const end = { phase: s.phase, mode: W.ss().mode, amb: W.dbg().ambient, loops: W.loopsOff() };
    game.quit(); await W.wait(() => W.ss().mode === 'menu'); await W.wait(() => a.musicPlaying, 8000);
    const menu = { mode: W.ss().mode, music: a.musicPlaying, amb: W.dbg().ambient, loops: W.loopsOff() };
    return { brief, start, st, hoistSeen, hoistAfter, fired: f.ok, seq, imp, end, menu };
  });
  console.log('  бой 1: ' + JSON.stringify({ seq: b1.seq, imp: b1.imp, st: b1.st, end: b1.end }));
  ok(b1.brief.mode === 'menu' && b1.brief.music, 'игра: на брифинге музыка ещё играет', b1.brief);
  ok(!b1.start.music && b1.start.amb && b1.start.ambience.some((o) => o && o.station === 'plot' && o.weather), 'игра: начало боя — музыка уходит, фон башни с постом и погодой', b1.start);
  ok(b1.st.ambience.some((o) => o && o.station === 'loading') && b1.st.gear.includes(0), 'игра: смена поста меняет окраску фона (и глушит шестерни)', b1.st);
  const ix = (n) => b1.seq.indexOf(n);
  ok(b1.fired && ix('breechOpen') >= 0 && ix('breechOpen') < ix('hoistRun:true') && ix('hoistRun:true') < ix('hoistRun:false') && ix('hoistRun:false') < ix('ram') &&
    ix('ram') < ix('charge') && ix('charge') < ix('breechClose') && ix('breechClose') < ix('fire') && ix('fire') < ix('impact'), 'игра: заряжание → выстрел → разрыв звучат по порядку', b1.seq);
  ok(b1.hoistSeen && !b1.hoistAfter, 'игра: петля элеватора звучит, пока люлька идёт, и гаснет с концом подачи', { seen: b1.hoistSeen, after: b1.hoistAfter });
  ok(b1.imp.length > 0 && b1.imp.every((o) => ['water', 'land', 'steel'].includes(o.kind) && o.range > 0 && o.delay > 0 && o.delay <= 3.5), 'игра: разрыв — по тому, во что попали, с задержкой по дальности', b1.imp);
  ok(ix('missionWon') > ix('impact') || ix('missionLost') > ix('impact'), 'игра: итог боя озвучен (победа/поражение)', b1.seq);
  ok(b1.end.mode === 'end' && !b1.end.amb && b1.end.loops.length === 0, 'игра: после боя фон выключен, петель нет', b1.end);
  ok(b1.menu.mode === 'menu' && b1.menu.music && !b1.menu.amb && b1.menu.loops.length === 0, 'игра: в меню снова музыка', b1.menu);

  // задание 31 «Воздух!»: прицельный огонь противника, налёт, зенитка, пауза, выход посреди петель
  const b2 = await pg.evaluate(async () => {
    const { game, engine } = window.__arta, a = engine.audio, s = game.state, W = window.__W, t0 = performance.now();
    game.save.unlocked = Math.max(game.save.unlocked, 32);
    game.startMission(31); game.begin(); await W.wait(() => W.ss().mode === 'battle'); await W.frames(2);
    s.detected = true; s.detectedAt = s.time;          // батарею «засекли» сразу: огонь противника — прицельный
    engine.gotoStation('aa', { instant: true }); await W.frames(2);
    const ev = { incoming: [], hits: [] };
    const offs = [game.on('incoming', (e) => ev.incoming.push({ t: performance.now(), blind: !!e.blind })), game.on('batteryHit', (e) => ev.hits.push({ t: performance.now(), d: e.damage, by: e.by }))];
    await W.step(() => s.raidWarn && s.raidWarn.until > s.time, 80);
    await W.frames(3);
    const warn = { siren: W.dbg().loops.siren, calls: W.calls('sirenRun', t0).map((e) => e.a[0]) };
    await W.step(() => s.raid && s.raid.phase === 'inbound', 20);
    await W.frames(4);
    const tens = W.calls('tension', t0);
    const inbound = { siren: W.dbg().loops.siren, sirenCalls: W.calls('sirenRun', t0).map((e) => e.a[0]), drone: W.dbg().loops.drone, droneCalls: W.calls('planeDrone', t0).filter((e) => e.a[0] > 0).length, tension: tens.length ? tens[tens.length - 1].a[0] : 0 };
    const tA = performance.now();
    game.aimAA({ bearing: s.raid.planes[0].bearing, elevation: s.raid.planes[0].elevation });
    game.fireAA(true); await W.frames(4);
    const aaOn = W.dbg().loops.aa;
    game.pause(true); await W.frames(4);
    const paused = { aa: W.dbg().loops.aa, duck: W.dbg().duck, ducked: W.ss().ducked };
    game.pause(false); await W.frames(4);
    const resumed = { aa: W.dbg().loops.aa, duck: W.dbg().duck };
    game.fireAA(false); await W.frames(4);
    const aaOff = W.dbg().loops.aa;
    const aaCalls = W.calls('aaFire', tA).map((e) => e.a[0]);
    // самолёты долетают (не сбиваем): свист бомбы, разрыв, пролёт над башней
    await W.step(() => !s.raid || s.raid.planes.every((q) => q.attacked || !q.alive), 60, 2);
    await W.step(() => ev.hits.some((h) => h.by !== 'air') && ev.incoming.some((i) => !i.blind), 150, 4);
    offs.forEach((f) => f());
    const air = { whistle: W.calls('bombWhistle', t0).length, burst: W.calls('bombBurst', t0).length, flyby: W.calls('flyby', t0).length, bombed: s.stats.bombs };
    const fire = W.calls(['enemyGun', 'whistle', 'turretHit', 'nearMiss', 'impactFar'], t0).map((e) => e.n);
    const tension = W.calls('tension', t0).map((e) => e.a[0]);
    // выход посреди петель: очередь зенитки и элеватор
    engine.gotoStation('loading', { instant: true }); await W.frames(2);
    game.fireAA(true);
    if (!s.breech.busy && !s.breech.open) game.openBreech();
    await W.step(() => !s.breech.busy, 20, 1);
    if (!s.breech.shell) game.hoistShell(s.shells.he > 0 ? 'he' : 'ap');
    for (let i = 0; i < 6; i++) { game.update(0.05); await W.frame(); }
    const before = W.loopsOff();
    game.quit(); await W.wait(() => W.ss().mode === 'menu'); await W.frames(6);
    const after = { loops: W.loopsOff(), amb: W.dbg().ambient, music: a.musicPlaying, mode: W.ss().mode };
    return { warn, inbound, aaOn, paused, resumed, aaOff, aaCalls, air, ev: { inc: ev.incoming.length, hits: ev.hits.map((h) => h.by + ':' + h.d) }, fire, tension, before, after };
  });
  console.log('  бой 31: ' + JSON.stringify(b2));
  ok(b2.warn.siren && b2.warn.calls.includes(true), 'игра: «ВОЗДУХ!» — сирена воет все 10 с предупреждения', b2.warn);
  ok(!b2.inbound.siren && b2.inbound.sirenCalls.join() === 'true,false' && b2.inbound.drone && b2.inbound.droneCalls > 0, 'игра: налёт — сирена стихла, гул самолётов', b2.inbound);
  ok(b2.inbound.tension >= 0.5, 'игра: во время налёта фон напряжённый', b2.inbound.tension);
  ok(b2.aaOn && !b2.paused.aa && b2.resumed.aa && !b2.aaOff && b2.aaCalls.join() === 'true,false,true,false', 'игра: очередь зенитки — пока жмут гашетку; на паузе молчит', { on: b2.aaOn, paused: b2.paused, resumed: b2.resumed, off: b2.aaOff, calls: b2.aaCalls });
  ok(b2.paused.ducked && b2.paused.duck.amb < 0.5 && b2.resumed.duck.amb === 1, 'игра: пауза приглушает фон, продолжение возвращает', { p: b2.paused.duck, r: b2.resumed.duck });
  ok(b2.air.bombed > 0 && b2.air.whistle >= b2.air.bombed && b2.air.burst >= b2.air.bombed && b2.air.flyby >= b2.air.bombed, 'игра: прорвавшийся самолёт — свист бомбы, разрыв, пролёт', b2.air);
  const eg = b2.fire.indexOf('enemyGun'), wh = b2.fire.indexOf('whistle', eg), hit = Math.max(b2.fire.indexOf('turretHit', wh), b2.fire.indexOf('nearMiss', wh));
  ok(eg >= 0 && wh > eg && hit > wh, 'игра: огонь противника — далёкий залп, свист, разрыв у батареи', { fire: b2.fire.slice(0, 12), ev: b2.ev });
  ok(b2.tension.some((v) => v > 0.2) && b2.tension.length < 200, 'игра: напряжение растёт от огня и шлётся без лишних вызовов', b2.tension.length);
  ok(b2.before.includes('aa'), 'игра: перед выходом очередь зенитки звучит', b2.before);
  ok(b2.after.loops.length === 0 && !b2.after.amb && b2.after.music && b2.after.mode === 'menu', 'игра: выход в меню посреди очереди и подачи — все петли стихли, снова музыка', b2.after);

  // сохранённый бой: выйти с сохранением на посту НАБЛЮДЕНИЕ, продолжить — фон того же поста
  const r3 = await pg.evaluate(async () => {
    const { game, engine } = window.__arta, a = engine.audio, W = window.__W;
    game.startSkirmish(); game.begin(); await W.wait(() => W.ss().mode === 'battle');
    engine.gotoStation('observe', { instant: true }); await W.frames(3);
    game.suspend(); game.quit({ keep: true }); await W.wait(() => W.ss().mode === 'menu'); await W.frames(3);
    const menu = { music: a.musicPlaying, amb: W.dbg().ambient };
    const t0 = performance.now();
    game.restore(); await W.wait(() => W.ss().mode === 'battle'); await W.frames(4);
    const r = { station: engine.current, amb: W.dbg().ambient, music: a.musicPlaying, ambience: W.calls('ambience', t0).map((e) => e.a[0]) };
    // ролик: тишина — ни музыки, ни фона
    game.quit(); await W.wait(() => W.ss().mode === 'menu');
    const sh = window.__arta.shell; let intro = null;
    if (sh.intro) {
      sh.playIntro(() => {}); await W.frames(4);
      intro = { mode: W.ss().mode, music: a.musicPlaying, amb: W.dbg().ambient };
      try { sh.intro.skip(); } catch (e) { /* пропуска нет */ }
      await W.wait(() => !sh.introPlaying, 10000); await W.frames(4);
      intro.after = { mode: W.ss().mode, music: a.musicPlaying };
    }
    return { menu, r, intro, trace: a.trace().length };
  });
  console.log('  продолжение и ролик: ' + JSON.stringify(r3));
  ok(r3.menu.music && !r3.menu.amb && r3.r.station === 'observe' && r3.r.amb && !r3.r.music && r3.r.ambience.some((o) => o && o.station === 'observe'), 'игра: «ПРОДОЛЖИТЬ БОЙ» — фон поста, на котором сохранились', r3);
  if (r3.intro) ok(r3.intro.mode === 'intro' && !r3.intro.music && !r3.intro.amb && r3.intro.after.mode === 'menu' && r3.intro.after.music, 'игра: во время ролика музыка и фон молчат, после — музыка меню', r3.intro);
  ok(errs.length === 0, 'игра: без ошибок на странице', errs.slice(0, 5));
  await ctx.close();
}
