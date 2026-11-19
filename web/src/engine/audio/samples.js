// Записанные звуки (CC0 / CC-BY, источники и обработка — static/CREDITS-AUDIO.md, сборка — tools/sfx-make.py и
// tools/sfx-pack.mjs). Они подменяют синтезированные буферы банка по тем же именам рецептов: весь API движка прежний.
//
// ЗАГРУЗКА. Игра в WebView открыта с file:// — fetch к файлам там не работает, XHR к file:// запрещён настройкой WebView
// по умолчанию (allowFileAccessFromFileURLs = false). Поэтому mp3 лежат в static/sfx/pack<N>.js как base64 и
// подключаются тегом <script> (это работает и на file://, и по http). Пакеты грузятся по одному после первого касания,
// каждый звук декодируется отдельно (decodeAudioData в OfflineAudioContext нужной частоты — гулким звукам хватает
// 11 кГц, глухому фону — 8 кГц: вчетверо меньше памяти), затем: срез тишины по краям, бесшовная склейка петель (перекрёстное
// затухание конца в начало), нормирование пика к 0.98 и множитель громкости из таблицы.
// Пока записи нет (первые секунды, сбой загрузки), играет синтезированный рецепт — как раньше.

// Имя рецепта → { f: варианты (файлы), g: множитель громкости к громкости рецепта (CAT[name].g), sr: частота буфера,
// loop: петля (перекрёстная склейка, с), p: пакет (1 — бой и органы управления, 2 — воздух, зенитка, радио, 3 — фон) }.
// Имена без рецепта в каталоге (slewLoop, planeLoop, sirenLoop, sirenShot) берут громкость из g как есть.
// mute: рецепт молчит, если записан соседний (хвост выстрела уже в записи выстрела).
const LO = 11025, MID = 16000, HI = 22050, BED = 8000, AIR = 11025;
export const SFX = {
  gun: { f: ['gun_a', 'gun_b', 'gun_c'], sr: LO, g: 1, p: 1 },
  gunTail: { mute: 'gun' },
  impWater: { f: ['wat_a', 'wat_b', 'wat_c'], sr: LO, g: 1.6, p: 1 },
  impLand: { f: ['land_a', 'land_c'], sr: LO, g: 1.5, p: 1 },
  impSteel: { f: ['steel_a', 'steel_b'], sr: LO, g: 0.9, p: 1 },
  enemyGun: { f: ['egun_a', 'egun_b'], sr: LO, g: 1.4, p: 1 },
  nearMiss: { f: ['near_a', 'near_b'], sr: LO, g: 0.95, p: 1 },
  turretHit: { f: ['hit_a', 'hit_b'], sr: LO, g: 0.95, p: 1 },
  bombBurst: { f: ['near_a', 'land_c'], sr: LO, g: 0.95, p: 1 },
  farThunder: { f: ['thunder_a'], sr: LO, g: 1.2, p: 3 },
  breechOpen: { f: ['bopen_a', 'bopen_b'], sr: MID, g: 0.85, p: 1 },
  breechClose: { f: ['bclose_a', 'bclose_b'], sr: MID, g: 0.85, p: 1 },
  introDoor: { f: ['bclose_a'], sr: MID, g: 0.9, p: 1 },
  ram: { f: ['ram_a', 'ram_b'], sr: MID, g: 0.85, p: 1 },
  charge: { f: ['charge_a', 'charge_b'], sr: MID, g: 0.9, p: 1 },
  unload: { f: ['unload'], sr: MID, g: 0.8, p: 1 },
  hoistStart: { f: ['hoist_start'], sr: MID, g: 0.8, p: 1 },
  hoistLoop: { f: ['hoist_loop'], sr: MID, g: 0.8, loop: 0.25, p: 1 },
  hoistStop: { f: ['hoist_stop'], sr: MID, g: 0.8, p: 1 },
  tick: { f: ['tick_a', 'tick_b', 'tick_c'], sr: HI, g: 0.9, p: 1 },
  detent: { f: ['det_a', 'det_b', 'det_c'], sr: HI, g: 0.9, p: 1 },
  clunk: { f: ['clunk_a', 'clunk_b'], sr: MID, g: 0.8, p: 1 },
  lever: { f: ['lever_a', 'lever_b'], sr: MID, g: 0.9, p: 1 },
  toggle: { f: ['toggle_a', 'toggle_b'], sr: HI, g: 0.9, p: 1 },
  button: { f: ['button_a', 'button_b'], sr: HI, g: 0.9, p: 1 },
  selector: { f: ['sel_a', 'sel_b'], sr: HI, g: 0.9, p: 1 },
  relay: { f: ['relay_a', 'relay_b'], sr: HI, g: 0.9, p: 1 },
  cover: { f: ['cover_a', 'cover_b'], sr: HI, g: 0.9, p: 1 },
  drum: { f: ['drum_a', 'drum_b', 'drum_c'], sr: HI, g: 0.9, p: 1 },
  bell: { f: ['bell'], sr: HI, g: 0.8, p: 1 },
  paper: { f: ['paper_a', 'paper_b'], sr: HI, g: 0.9, p: 1 },
  pin: { f: ['pin'], sr: HI, g: 0.9, p: 1 },
  loupe: { f: ['loupe'], sr: HI, g: 0.9, p: 1 },
  aaShot: { f: ['aa_a', 'aa_b', 'aa_c'], sr: MID, g: 0.9, p: 2 },
  aaLoop: { f: ['aa_loop'], sr: MID, g: 0.95, loop: 0.25, p: 2 },
  aaTail: { f: ['aa_tail'], sr: MID, g: 0.9, p: 2 },
  jam: { f: ['jam'], sr: MID, g: 0.8, p: 2 },
  overheat: { f: ['overheat'], sr: MID, g: 0.9, p: 2 },
  slewLoop: { f: ['slew_loop'], sr: LO, g: 0.08, loop: 0.4, p: 1 },
  planeLoop: { f: ['plane_loop'], sr: LO, g: 0.2, loop: 0.4, p: 2 },
  sirenShot: { f: ['siren_shot'], sr: LO, g: 0.22, p: 2 },
  sirenLoop: { f: ['siren_loop'], sr: LO, g: 0.2, loop: 0.6, p: 2 },
  sqOpen: { f: ['sq_open'], sr: MID, g: 0.8, p: 2 },
  sqClose: { f: ['sq_close'], sr: MID, g: 0.8, p: 2 },
  etherBed: { f: ['ether'], sr: 16000, g: 1.2, loop: 0.5, p: 2 },
  roomBed: { f: ['bed_room'], sr: BED, g: 0.7, loop: 1.0, p: 3 },
  machineBed: { f: ['bed_machine'], sr: BED, g: 0.6, loop: 1.0, p: 3 },
  airBed: { f: ['bed_air'], sr: AIR, g: 0.7, loop: 1.2, p: 3 },
  stormBed: { f: ['bed_storm'], sr: AIR, g: 0.95, loop: 1.2, p: 3 },
  tensionBed: { f: ['bed_tension'], sr: BED, g: 0.55, loop: 1.0, p: 3 },
  windBed: { f: ['bed_wind'], sr: BED, g: 0.9, loop: 1.0, p: 3 },
  creak: { f: ['creak_a', 'creak_b', 'creak_c'], sr: MID, g: 0.9, p: 3 },
};
export const PACKS = [1, 2, 3];

/** Список файлов пакета p (для tools/sfx-pack.mjs). */
export function packFiles(p) {
  const out = [];
  for (const k of Object.keys(SFX)) { const e = SFX[k]; if (e.p === p) for (const f of e.f) if (!out.includes(f)) out.push(f); }
  return out;
}

const PEAK = 0.98;

function b64bytes(s) {
  const bin = atob(s), n = bin.length, u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

/**
 * @param ctx  контекст (createBuffer, частота)
 * @param o    { base — путь к пакетам ('sfx/'); onReady(name) — появился буфер рецепта; onFail(names) — записи не будет;
 *               idle — пауза между декодированиями, мс; data — { файл: base64 } уже загруженные пакеты (тест) }
 */
export function createSamples(ctx, o = {}) {
  const OAC = typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext);
  const files = {};                   // файл → AudioBuffer
  const raw = Object.assign({}, o.data || null);   // файл → base64 (ещё не декодирован)
  const failed = {};                  // пакет → true
  const bad = {};                     // файл → true: не декодировался
  let started = false, loading = null, dead = !OAC || typeof atob === 'undefined', bytes = 0, busy = false, timer = 0, waiters = [], pendingPacks = 0;
  const queue = [];                   // файлы к декодированию по порядку важности
  const users = {};                   // файл → [имена рецептов]
  for (const k of Object.keys(SFX)) { const e = SFX[k]; if (e.f) for (const f of e.f) (users[f] || (users[f] = [])).push(k); }
  const entryOf = (f) => SFX[users[f][0]];

  function post(f, buf) {
    const e = entryOf(f), ch = buf.numberOfChannels, sr = buf.sampleRate;
    const data = []; for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
    let s = 0, end = buf.length - 1;
    const loud = (i) => { for (let c = 0; c < ch; c++) if (Math.abs(data[c][i]) > 2e-4) return true; return false; };
    while (s < end && !loud(s)) s++;
    while (end > s && !loud(end)) end--;
    let len = end - s + 1;
    const xf = e.loop ? Math.min(Math.floor(len / 3), Math.round(e.loop * sr)) : 0;
    if (xf) len -= xf;                // петля: последние xf отсчётов вплетаются в начало (равная мощность)
    let peak = 0;
    const out = ctx.createBuffer(ch, Math.max(1, len), sr);
    for (let c = 0; c < ch; c++) {
      const d = out.getChannelData(c), x = data[c];
      for (let i = 0; i < len; i++) d[i] = x[s + i];
      for (let i = 0; i < xf; i++) { const w = i / xf, a = Math.sin(w * Math.PI / 2), b = Math.cos(w * Math.PI / 2); d[i] = x[s + i] * a + x[s + len + i] * b; }
      if (!xf) {                       // разовый: короткие края без щелчка
        const fi = Math.min(len >> 1, Math.round(0.002 * sr)), fo = Math.min(len >> 1, Math.round(0.01 * sr));
        for (let i = 0; i < fi; i++) d[i] *= i / fi;
        for (let i = 0; i < fo; i++) d[len - 1 - i] *= i / fo;
      }
      let mean = 0; if (xf) { for (let i = 0; i < len; i++) mean += d[i]; mean /= len; for (let i = 0; i < len; i++) d[i] -= mean; }
      for (let i = 0; i < len; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
    }
    const k = peak > 1e-6 ? PEAK / peak : 0;
    for (let c = 0; c < ch; c++) { const d = out.getChannelData(c); for (let i = 0; i < len; i++) d[i] *= k; }
    return out;
  }

  function decodeOne(f) {
    const b64 = raw[f]; delete raw[f];
    if (!b64) return Promise.resolve();
    const e = entryOf(f), sr = Math.min(ctx.sampleRate, e.sr || ctx.sampleRate);
    const lose = () => {               // файл не декодировался: его рецепты вернутся в банк синтеза
      if (bad[f]) return; bad[f] = true;
      if (o.onFail) { try { o.onFail(users[f].slice()); } catch (er) { /* тихо */ } }
    };
    let arr; try { arr = b64bytes(b64); } catch (err) { lose(); return Promise.resolve(); }
    const dc = new OAC(1, 1, sr);
    return new Promise((res) => {
      const no = () => { lose(); res(); };
      const ok = (buf) => {
        try {
          if (!dead && buf) {
            const b = post(f, buf); files[f] = b; bytes += b.length * b.numberOfChannels * 4;
            for (const name of users[f]) if (o.onReady && ready(name)) { try { o.onReady(name); } catch (er) { /* тихо */ } }
          }
          else if (!dead) lose();
        } catch (er) { lose(); }
        res();
      };
      try {
        const p = dc.decodeAudioData(arr, ok, no);
        if (p && p.then) p.then(() => {}, no);
      } catch (er) { no(); }
    });
  }
  // рецепт готов, когда готовы все его варианты (иначе случайный выбор то запись, то синтез)
  function ready(name) { const e = SFX[name]; return !!(e && e.f && e.f.every((f) => files[f])); }

  function pump() {
    timer = 0;
    if (busy || dead) return;
    const f = queue.shift();
    if (!f) { if (!pendingPacks) { const w = waiters; waiters = []; w.forEach((fn) => fn()); } return; }
    busy = true;
    decodeOne(f).then(() => { busy = false; schedule(); });
  }
  function schedule() { if (dead || timer || busy) return; if (o.idle === 0) pump(); else timer = setTimeout(pump, o.idle == null ? 15 : o.idle); }
  function enqueue(names) { for (const f of names) if (raw[f] && !files[f] && !queue.includes(f)) queue.push(f); schedule(); }

  function fail(p) {
    if (failed[p]) return; failed[p] = true;
    const lost = Object.keys(SFX).filter((k) => SFX[k].p === p && !ready(k));
    if (o.onFail && lost.length) { try { o.onFail(lost); } catch (e) { /* тихо */ } }
  }
  function loadPack(p) {
    const list = packFiles(p);
    if (list.every((f) => raw[f] || files[f])) { enqueue(list); return Promise.resolve(); }
    if (typeof document === 'undefined' || !document.createElement) { fail(p); return Promise.resolve(); }
    pendingPacks++;
    return new Promise((res) => {
      const prev = window.__artaSfx;
      window.__artaSfx = (name, b64) => { if (!files[name]) raw[name] = b64; };
      const s = document.createElement('script');
      const done = (ok) => {
        pendingPacks--;
        window.__artaSfx = prev;
        try { s.remove(); } catch (e) { /* тихо */ }
        if (!ok || !list.some((f) => raw[f])) fail(p); else enqueue(list);
        schedule();
        res();
      };
      s.onload = () => done(true); s.onerror = () => done(false);
      s.async = true; s.src = (o.base == null ? 'sfx/' : o.base) + 'pack' + p + '.js';
      (document.head || document.body || document.documentElement).appendChild(s);
    });
  }

  return {
    /** Начать загрузку (после первого касания). Пакеты — по одному, по порядку важности. */
    start() {
      if (started || dead) return; started = true;
      let chain = Promise.resolve();
      for (const p of PACKS) chain = chain.then(() => loadPack(p)).then(() => new Promise((r) => setTimeout(r, 30)));
      loading = chain;
    },
    /** Буфер записи для рецепта (вариант по r 0…1) или null. */
    get(name, r) {
      const e = SFX[name];
      if (!e || !e.f || !ready(name)) return null;
      return files[e.f[Math.floor((r == null ? Math.random() : r) * e.f.length) % e.f.length]];
    },
    /** Рецепт молчит, потому что его звук уже есть в записи соседа (хвост выстрела). */
    muted(name) { const e = SFX[name]; return !!(e && e.mute && ready(e.mute)); },
    /** Запись для рецепта будет (есть в таблице и её пакет не провалился) — банку его просчитывать не нужно. */
    covers(name) {
      const e = SFX[name], src = e && (e.mute ? SFX[e.mute] : e);
      return !dead && !!src && !failed[src.p] && !src.f.some((f) => bad[f]);
    },
    ready,
    gain(name) { const e = SFX[name]; return e && e.g != null ? e.g : 1; },
    /** Обещание: всё загружено и декодировано (или не удалось). */
    all() {
      if (dead) return Promise.resolve();
      this.start();
      return (loading || Promise.resolve()).then(() => new Promise((res) => {
        if (dead || (!queue.length && !busy && !pendingPacks)) res(); else { waiters.push(res); schedule(); }
      }));
    },
    get bytes() { return bytes; },
    get count() { return Object.keys(files).length; },
    get failed() { return Object.keys(failed).map(Number); },
    dispose() { dead = true; clearTimeout(timer); queue.length = 0; },
  };
}
