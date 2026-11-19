// engine.mat — библиотека материалов (DESIGN §5.2). Все материалы кэшируются: одинаковые вызовы возвращают один объект.
//
// Поверхности — процедурные наборы PBR-текстур, сгенерированные в коде (без файлов), один раз, общие для всех постов:
//   paint  — крашеная сталь: RGBA «пачка» данных + карта нормалей (повтор mat.WEAR_REPEAT м):
//            R — оттенок/выгорание краски (0.8 = ×1), G — блеск, B — поле ржавчины и потёков, A — поле износа (сколы, царапины).
//            Порог скола и ржавчины задаёт сам материал (wear 0…1) в шейдере, поэтому три степени износа делят одну текстуру.
//            Шейдер ещё затемняет низ (грязь от настила до ~0.55 м) и верх под потолком — в мировых координатах.
//   floor  — рифлёный настил: цвет (sRGB) + блеск в A, карта нормалей «чечевицы»; вытертые до металла вершины, ржавчина в
//            низинах, масляные пятна.
//   metal  — металлы, бакелит, стекло: R — затенение (aoMap), G — шероховатость (roughnessMap), B — металличность
//            (metalnessMap); штрихи шлифовки (на телах вращения — проточка кольцами), отпечатки пальцев, побежалость;
//            карта нормалей — микрориски.
//   knurl  — карта нормалей накатки (рукоятки, ручки галетников).
// Разрешение — по уровню качества (engine.quality.tier): paint 1024 / 512 / 256, остальное 512 / 256 / 128 (накатка 256 / 256 / 128).
// Текстуры создаются заглушками 4×4 и наполняются в первом кадре движка уже под действующий уровень (mat.bind(engine) из
// room.js); смена уровня перегенерирует наборы по одному за кадр. Время и память — mat.stats().
import * as THREE from 'three';
import {
  makeCanvas, canvasTexture, mulberry32, fbmFast as fbm, tileNoise, glowCanvas,
  dataTexture, replaceData, textureBytes, normalDataFromHeight, strokeField,
} from './textures.js';

export const PALETTE = {
  panel: '#3d4a57', panelDark: '#2b343d', frame: '#1d2329', floor: '#15191d',
  ochre: '#d39a1e', bakelite: '#16171a', nickel: '#b9c0c4',
  ivory: '#e8e0c8', ink: '#1a1a1a', redZone: '#c0392b',
  copper: '#b06a3c', steel: '#59636d',
  lampGreen: '#4be36a', lampRed: '#ff4a3a', lampAmber: '#ffb347', lampWhite: '#fff3d6',
  plateBlack: '#111316', plateRed: '#8f1d14',
  drumDigit: '#f2efe6', drum: '#0c0d0e',
  brass: '#b39553',            // (расш.) латунь — только мелкие детали орудия (обтюратор, гильзы), не оправы приборов
  rust: '#5b3a27',             // (расш.) ржавчина (шейдер износа)
};

const NAMED = {
  green: PALETTE.lampGreen, red: PALETTE.lampRed, amber: PALETTE.lampAmber, white: PALETTE.lampWhite,
  ochre: PALETTE.ochre, black: PALETTE.bakelite, ivory: PALETTE.ivory, steel: PALETTE.steel, panel: PALETTE.panel,
};
/** 'green' | '#4be36a' | 0x4be36a → THREE.Color */
export function toColor(c) {
  if (c && c.isColor) return c.clone();
  if (typeof c === 'string' && NAMED[c]) c = NAMED[c];
  return new THREE.Color(c);
}

const WEAR_REPEAT = 0.8;                                  // метров на повтор текстуры краски
const TIER_SCALE = { high: 1, mid: 0.5, low: 0.25 };
const sstep = (a, b, x) => { const t = (x - a) / (b - a); return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); };
const b255 = v => (v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0);

// ------------------------------------------------------------------ генераторы (S — сторона, степень двойки)

/** Крашеная сталь: { pack, normal } (Uint8Array RGBA). */
function genPaint(S, seed) {
  const rnd = mulberry32(seed), N = S * S;
  const big = fbm(S, 3, 3, 4, rnd), mid = fbm(S, 12, 12, 3, rnd), fine = fbm(S, 56, 56, 2, rnd);
  const streak = fbm(S, 40, 2, 2, rnd);                   // вертикальные потёки
  const rustN = fbm(S, 6, 6, 3, rnd);
  const grit = tileNoise(S, Math.max(8, S >> 2), Math.max(8, S >> 2), rnd);
  const wear = new Float32Array(N);
  for (let i = 0; i < N; i++) { const w = (fine[i] * 0.62 + mid[i] * 0.38 - 0.5) / 0.4; wear[i] = w < 0 ? 0 : w > 1 ? 1 : w; }
  // царапины: в поле износа, часть видна только на сильно изношенной краске
  const ks = S / 512;
  for (let s = 0; s < 70; s++) {
    const x = rnd() * S, y = rnd() * S, a = (rnd() - 0.5) * 1.1 + (rnd() < 0.55 ? 0 : Math.PI / 2), len = (6 + rnd() * 44) * ks;
    strokeField(wear, S, x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, 0.66 + rnd() * 0.3, S >= 1024 ? 2 : 1);
  }
  const pack = new Uint8Array(N * 4), h = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const w = wear[i], b = big[i] - 0.5, m = mid[i] - 0.5, g = grit[i] - 0.5;
    const drip = sstep(0.58, 0.75, streak[i]) * 0.05;
    const alb = 0.8 * (1 + b * 0.24 + m * 0.07 + g * 0.05 - drip);
    const gloss = 0.42 - b * 0.3 - m * 0.16 - drip * 2.5 + g * 0.05;
    const rs = sstep(0.56, 0.8, rustN[i] * 0.75 + fine[i] * 0.25);
    const rd = sstep(0.56, 0.8, streak[i]) * sstep(0.35, 0.62, rustN[i]);
    const rust = Math.min(1, rs * 0.8 + rd * 0.55 + Math.max(0, w - 0.6) * 0.5);
    const k = i * 4;
    pack[k] = b255(alb); pack[k + 1] = b255(gloss); pack[k + 2] = b255(rust); pack[k + 3] = b255(w);
    h[i] = g * 0.07 + b * 0.5 + m * 0.25 - sstep(0.66, 0.7, w) * 0.45 - sstep(0.74, 0.78, w) * 0.25;
  }
  return { pack, normal: normalDataFromHeight(h, S, 2.0 * ks) };
}

/** Рифлёный настил: { pack (sRGB цвет + блеск в A), normal }. */
function genFloor(S, seed) {
  const rnd = mulberry32(seed), N = S * S, cells = 8, cell = S / cells, ks = S / 512;
  const h = new Float32Array(N);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = Math.floor(x / cell), j = Math.floor(y / cell);
    const u = (x + 0.5) / cell - i - 0.5, v = (y + 0.5) / cell - j - 0.5;
    const s = (i + j) % 2 ? 1 : -1;
    const ur = (u + s * v) * 0.7071, vr = (-s * u + v) * 0.7071;
    const d = (ur / 0.40) * (ur / 0.40) + (vr / 0.115) * (vr / 0.115);
    h[y * S + x] = d < 1 ? Math.pow(1 - d, 0.6) : 0;
  }
  const grime = fbm(S, 4, 4, 4, rnd), grit = tileNoise(S, Math.max(8, S * 0.4 | 0), Math.max(8, S * 0.4 | 0), rnd);
  const oil = fbm(S, 3, 3, 3, rnd), rustN = fbm(S, 10, 10, 2, rnd), scuff = fbm(S, 2, 24, 2, rnd);
  const pack = new Uint8Array(N * 4), hh = new Float32Array(N);
  const seamW = Math.max(1.5, 2.5 * ks);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, lent = h[i];
    const edge = Math.min(x, S - 1 - x, y, S - 1 - y);
    const seam = edge < seamW ? 1 : 0, lip = edge >= seamW && edge < seamW * 2.2 ? 1 : 0;
    let v = 0.6 + (grime[i] - 0.5) * 0.36 + (grit[i] - 0.5) * 0.08;
    const worn = lent * (0.55 + 0.45 * sstep(0.35, 0.7, scuff[i]));        // вытертые до металла вершины
    v = v * (1 - worn * 0.15) + worn * 0.42;
    const rust = sstep(0.55, 0.75, rustN[i]) * (1 - lent) * (0.6 + 0.4 * sstep(0.5, 0.7, grime[i]));
    const o = sstep(0.6, 0.74, oil[i]);
    let r = v, g = v, bl = v * 1.03;
    if (rust > 0) { r = r * (1 - rust) + v * 1.05 * rust; g = g * (1 - rust) + v * 0.62 * rust; bl = bl * (1 - rust) + v * 0.42 * rust; }
    const dark = 1 - o * 0.45 - seam * 0.7 + lip * 0.08;
    r *= dark; g *= dark; bl *= dark * (1 - o * 0.05);
    let gloss = 0.3 + worn * 0.55 + o * 0.45 - rust * 0.25 + (grit[i] - 0.5) * 0.1 - seam * 0.2;
    const k = i * 4;
    pack[k] = b255(r); pack[k + 1] = b255(g); pack[k + 2] = b255(bl); pack[k + 3] = b255(gloss);
    hh[i] = lent * 1.0 + (grit[i] - 0.5) * 0.06 - seam * 0.5;
  }
  return { pack, normal: normalDataFromHeight(hh, S, 2.4 * ks) };
}

/** Металл: { pack (R — затенение, G — шероховатость, B — металличность), normal }. */
function genMetal(S, seed) {
  const rnd = mulberry32(seed), N = S * S, ks = S / 512;
  const brushed = fbm(S, 2, 128, 2, rnd);                 // штрихи вдоль u (на телах вращения — кольца проточки)
  const groove = tileNoise(S, 3, Math.max(16, S >> 1), rnd);
  const tarn = fbm(S, 3, 3, 3, rnd), blot = fbm(S, 10, 10, 2, rnd);
  // отпечатки пальцев: эллипсы с папиллярными дугами
  const fp = new Float32Array(N);
  for (let p = 0; p < 9; p++) {
    const cx = rnd() * S, cy = rnd() * S, rx = S * (0.018 + rnd() * 0.016), ry = rx * (1.25 + rnd() * 0.3), an = rnd() * Math.PI;
    const ca = Math.cos(an), sa = Math.sin(an), freq = 2 * Math.PI / Math.max(1.6, 2.4 * ks), amp = 0.6 + rnd() * 0.4;
    const R = Math.ceil(ry + 2);
    for (let oy = -R; oy <= R; oy++) for (let ox = -R; ox <= R; ox++) {
      const u = (ox * ca + oy * sa) / rx, v = (-ox * sa + oy * ca) / ry, d = u * u + v * v;
      if (d >= 1) continue;
      const ridge = 0.5 + 0.5 * Math.sin(Math.sqrt(ox * ox * 0.8 + oy * oy * 1.2) * freq);
      const k = (((Math.round(cy) + oy) % S + S) % S) * S + (((Math.round(cx) + ox) % S + S) % S);
      fp[k] = Math.max(fp[k], amp * (1 - d) * (0.35 + 0.65 * ridge));
    }
  }
  const pack = new Uint8Array(N * 4), h = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = sstep(0.52, 0.8, tarn[i]), bb = blot[i] - 0.5;
    const ao = 1 - t * 0.3 - bb * 0.16;
    const rough = 0.6 + (brushed[i] - 0.5) * 0.34 + t * 0.32 + fp[i] * 0.3 + bb * 0.12;
    const metal = 1 - sstep(0.62, 0.86, tarn[i]) * 0.22;
    const k = i * 4;
    pack[k] = b255(ao); pack[k + 1] = b255(rough); pack[k + 2] = b255(metal); pack[k + 3] = 255;
    h[i] = (groove[i] - 0.5) * 0.5 + (brushed[i] - 0.5) * 0.35 + fp[i] * 0.08;
  }
  return { pack, normal: normalDataFromHeight(h, S, 1.2 * ks) };
}
const METAL_G = 0.68;           // средняя шероховатость в карте metal.G: material.roughness = цель / METAL_G

/** Накатка (ромбическая): { normal }. 16 ромбов на повтор. */
function genKnurl(S) {
  const N = S * S, n = 16, h = new Float32Array(N);
  const tri = x => Math.abs(x - Math.floor(x) - 0.5);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S * n, v = y / S * n;
    h[y * S + x] = Math.min(tri(u + v), tri(u - v));
  }
  return { normal: normalDataFromHeight(h, S, 3.2 * S / 256) };
}

/** Линза лампы: на «горящей» — горячий центр и спираль нити (emissiveMap), на погашенной — тёмная нить за стеклом (map). */
function bulbCanvas(lit) {
  const S = 128, c = makeCanvas(S, S), ctx = c.getContext('2d'), h = S / 2;
  const img = ctx.createImageData(S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const r = Math.hypot(x + 0.5 - h, y + 0.5 - h) / h;
    let v = lit ? 0.5 + 0.5 * Math.exp(-r * r * 3.2) - 0.12 * sstep(0.75, 1, r) : 0.92 - 0.25 * sstep(0.7, 1, r) + 0.06 * Math.exp(-r * r * 6);
    const i = (y * S + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = b255(v); d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // нить: две стойки и спираль между ними
  ctx.lineCap = 'round';
  ctx.strokeStyle = lit ? 'rgba(255,255,255,0.95)' : 'rgba(25,22,18,0.75)';
  ctx.lineWidth = lit ? 3.2 : 2.2;
  ctx.beginPath(); ctx.moveTo(h - 30, h + 26); ctx.lineTo(h - 22, h - 4); ctx.moveTo(h + 30, h + 26); ctx.lineTo(h + 22, h - 4); ctx.stroke();
  ctx.lineWidth = lit ? 4 : 2.6;
  ctx.beginPath();
  for (let i = 0; i <= 64; i++) {
    const t = i / 64, x = h - 22 + 44 * t, y = h - 4 + Math.sin(t * Math.PI * 14) * 5.5;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.stroke();
  if (lit) {                                                // ореол вокруг нити
    const g = ctx.createRadialGradient(h, h - 4, 2, h, h - 4, 34);
    g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  }
  return c;
}

// ------------------------------------------------------------------ шейдер износа краски

const WEAR_GLSL_HEAD = `
varying vec3 vWP;
uniform vec4 uWear;     // x — порог скола (поле A), y — порог ржавчины (поле B), z — сила ржавчины, w — сила грязи у пола
uniform vec3 uRust;
uniform vec3 uBare;
`;
// общий кусок: из пачки wp получаем цвет краски, долю скола и ржавчины
const WEAR_GLSL_BODY = `
  float vWY = vWP.y;
  float wVar = sin( vWP.x * 2.1 + vWP.z * 1.3 + 0.7 ) * sin( vWP.z * 1.7 - vWP.x * 0.9 + vWP.y * 1.3 );   // крупная вариация по месту: рвёт повтор текстуры
  float wChip = smoothstep( uWear.x, uWear.x + 0.018, wp.a );
  float wLip = smoothstep( uWear.x - 0.04, uWear.x, wp.a ) * ( 1.0 - wChip );
  float wRust = smoothstep( uWear.y - wVar * 0.07, uWear.y + 0.22, wp.b ) * uWear.z * ( 1.0 - wChip * 0.6 );
  float wLow = 1.0 - smoothstep( 0.0, 0.6, vWY );
  vec3 wCol = diffuseColor.rgb * wp.r * ( 1.25 + wVar * 0.06 );
  wCol *= 1.0 - wLip * 0.45;
  wCol = mix( wCol, uRust * ( 0.55 + 0.6 * wp.r ), wRust * 0.8 );
  wCol = mix( wCol, uBare * ( 0.7 + 0.45 * wp.r ), wChip );
  wCol *= 1.0 - uWear.w * wLow * ( 0.6 + 0.4 * wp.b );
  wCol *= 1.0 - 0.3 * smoothstep( 2.05, 2.6, vWY );
  diffuseColor.rgb = wCol;
`;
const WEAR_VERT = `
#include <project_vertex>
{
  vec4 wyP = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    wyP = instanceMatrix * wyP;
  #endif
  vWP = ( modelMatrix * wyP ).xyz;
}`;

function patchVertex(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
    .replace('#include <project_vertex>', WEAR_VERT);
}
function bindWearUniforms(shader, mtl) {
  const u = mtl.userData.wearUniforms;
  shader.uniforms.uWear = u.uWear; shader.uniforms.uRust = u.uRust; shader.uniforms.uBare = u.uBare;
}
/** Phong: пачка — в слоте specularMap (three заводит её UV), блеск — сила блика. */
function wearPhong(shader) {
  bindWearUniforms(shader, this);
  patchVertex(shader);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + WEAR_GLSL_HEAD)
    .replace('#include <specularmap_fragment>', `
  vec4 wp = texture2D( specularMap, vSpecularMapUv );
  ${WEAR_GLSL_BODY}
  float specularStrength = ( wp.g * ( 1.0 - wRust * 0.85 ) * ( 1.0 - wLow * uWear.w * 0.6 ) + wChip * 0.45 ) * 1.1;
`);
}
/** Standard: пачка — в слоте roughnessMap; скол — голый металл (metalness). */
function wearStandard(shader) {
  bindWearUniforms(shader, this);
  patchVertex(shader);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + WEAR_GLSL_HEAD)
    .replace('#include <roughnessmap_fragment>', `
  vec4 wp = texture2D( roughnessMap, vRoughnessMapUv );
  ${WEAR_GLSL_BODY}
  float roughnessFactor = clamp( roughness * ( 1.45 - wp.g * 1.1 ) + wRust * 0.4 + wLow * uWear.w * 0.25 - wChip * 0.25, 0.04, 1.0 );
`)
    .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = mix( metalness, 0.85, wChip );');
}
/** Металлы: шероховатость, металличность и затенение лежат в одной текстуре — одна выборка вместо трёх. */
const AO_PACKED = THREE.ShaderChunk.aomap_fragment.replace('texture2D( aoMap, vAoMapUv ).r', 'texelRoughness.r');
function metalPacked(shader) {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <metalnessmap_fragment>', `float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
  metalnessFactor *= texelRoughness.b;
#endif`)
    .replace('#include <aomap_fragment>', AO_PACKED);
}
/** Настил: цвет и блеск из одной sRGB-текстуры (map.rgb, map.a). */
function floorPhong(shader) {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <map_fragment>', `
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  diffuseColor.rgb *= sampledDiffuseColor.rgb;
  float floorGloss = sampledDiffuseColor.a;`)
    .replace('#include <specularmap_fragment>', 'float specularStrength = floorGloss;');
}

// ------------------------------------------------------------------ библиотека

export function createMaterials() {
  const cache = new Map();
  const memo = (key, make) => {
    let m = cache.get(key);
    if (!m) { m = make(); m.name = m.name || key; cache.set(key, m); }
    return m;
  };
  const texCache = new Map();
  const tex = (key, make) => { let t = texCache.get(key); if (!t) { t = make(); texCache.set(key, t); } return t; };

  // ---- процедурные наборы: заглушки сразу, данные — в realize() ----
  const flat = (r, g, b, a) => { const d = new Uint8Array(4 * 4 * 4); for (let i = 0; i < 16; i++) d.set([r, g, b, a], i * 4); return d; };
  const NORMAL0 = () => flat(128, 128, 255, 255);
  const SETS = {
    paint: { base: 1024, seed: 1234, gen: genPaint, size: 4,
      tex: { pack: dataTexture(flat(204, 107, 0, 0), 4, { aniso: 4 }), normal: dataTexture(NORMAL0(), 4, { aniso: 4 }) } },
    floor: { base: 512, seed: 4242, gen: genFloor, size: 4,
      tex: { pack: dataTexture(flat(150, 150, 155, 90), 4, { srgb: true, aniso: 8 }), normal: dataTexture(NORMAL0(), 4, { aniso: 8 }) } },
    metal: { base: 512, seed: 99, gen: genMetal, size: 4,
      tex: { pack: dataTexture(flat(255, 173, 255, 255), 4, { aniso: 4 }), normal: dataTexture(NORMAL0(), 4, { aniso: 4 }) } },
    knurl: { base: 256, min: 128, seed: 7, gen: genKnurl, size: 4,
      tex: { normal: dataTexture(NORMAL0(), 4, { aniso: 4 }) } },
  };
  const stats = { tier: null, genMs: 0, sets: {}, regenerations: 0 };
  function sizeFor(set, tier) {
    const s = Math.round(set.base * (TIER_SCALE[tier] || 1));
    return Math.max(set.min || 64, s);
  }
  function realizeSet(name, tier) {
    const set = SETS[name], S = sizeFor(set, tier);
    if (set.size === S) return false;
    const t0 = performance.now();
    const out = set.gen(S, set.seed);
    for (const k of Object.keys(set.tex)) replaceData(set.tex[k], out[k], S);
    set.size = S;
    const ms = performance.now() - t0;
    stats.sets[name] = { size: S, ms: Math.round(ms) };
    stats.genMs += ms; stats.regenerations++;
    return true;
  }
  /** Наполнить (или перегенерировать) все наборы под уровень качества. */
  function realize(tier) {
    stats.tier = tier;
    for (const name of Object.keys(SETS)) realizeSet(name, tier);
  }

  // ---- мелкие нормали: на уровне low выключены (экономия заливки), см. setDetail ----
  // 2 — все карты нормалей (high), 1 — только у металлов, бакелита и накатки (mid: крашеные поверхности занимают почти весь
  // экран, их рельеф — самая дорогая часть заливки), 0 — ни у кого (low)
  let detail = 2;
  const DETAIL = { high: 2, mid: 1, low: 0 };
  function setDetail(level) {
    level = typeof level === 'boolean' ? (level ? 2 : 0) : Math.max(0, Math.min(2, level | 0));
    if (level === detail) return;
    detail = level;
    cache.forEach(m => {
      const n = m.userData && m.userData.detailNormal;
      if (!n) return;
      const want = level >= (m.userData.wearUniforms ? 2 : 1) ? n : null;
      if (m.normalMap !== want) { m.normalMap = want; m.needsUpdate = true; }
    });
  }

  // ---- краска ----
  const rustLin = toColor(PALETTE.rust), bareLin = new THREE.Color(0.14, 0.145, 0.15);
  /** Степень износа → пороги шейдера: x — скол, y — ржавчина, z — сила ржавчины, w — грязь у пола. */
  function wearVec(wear, rust = 1, grime = 0.35) {
    const w = Math.max(0, Math.min(1, wear));
    return new THREE.Vector4(0.86 - 0.16 * w, 0.9 - 0.26 * w, rust * (0.15 + 0.55 * w), grime);
  }
  function wearUniforms(wear, o = {}) {
    return { uWear: { value: wearVec(wear, o.rust == null ? 1 : o.rust, o.grime == null ? 0.35 : o.grime) },
      uRust: { value: rustLin.clone() }, uBare: { value: (o.bare || bareLin).clone() } };
  }
  /**
   * (расш.) Наложить износ краски на свой MeshPhongMaterial или MeshStandardMaterial: сколы до металла, ржавчина, потёки,
   * грязь у пола. opts: { wear=0.5, rust=1, grime=0.35, normalScale=0.45 }. Нужны UV «в метрах» (geom.boxUV(g, mat.WEAR_REPEAT)).
   */
  function applyWear(m, opts = {}) {
    const wear = opts.wear == null ? 0.5 : opts.wear;
    m.userData.wearUniforms = wearUniforms(wear, opts);
    const t = SETS.paint.tex;
    if (m.isMeshStandardMaterial) { m.roughnessMap = t.pack; m.onBeforeCompile = wearStandard; m.customProgramCacheKey = () => 'wearS'; }
    else { m.specularMap = t.pack; m.onBeforeCompile = wearPhong; m.customProgramCacheKey = () => 'wearP'; }
    m.normalMap = detail >= 2 ? t.normal : null; m.userData.detailNormal = t.normal;
    const ns = opts.normalScale == null ? 0.45 : opts.normalScale;
    m.normalScale = new THREE.Vector2(ns, ns);
    m.needsUpdate = true;
    return m;
  }

  // Крашеные поверхности занимают почти весь экран, поэтому для них — MeshPhongMaterial (без карты окружения): это
  // примерно вдвое дешевле по заливке, чем MeshStandardMaterial; металлы и глянец остаются на PBR.
  function painted(key, hex, wear, extra = {}, wopts = {}) {
    return memo(key, () => applyWear(new THREE.MeshPhongMaterial(Object.assign({
      color: toColor(hex), specular: new THREE.Color(0x5a5a5a), shininess: 26,
    }, extra)), Object.assign({ wear }, wopts)));
  }

  // ---- металлы ----
  function metal(key, o) {
    return memo(key, () => {
      const t = SETS.metal.tex, rmap = o.roughness / METAL_G <= 1;
      const m = new THREE.MeshStandardMaterial({
        color: o.color, roughness: rmap ? o.roughness / METAL_G : o.roughness, metalness: o.metalness,
        roughnessMap: rmap ? t.pack : null, metalnessMap: o.metalness > 0 ? t.pack : null, aoMap: o.ao === false ? null : t.pack, aoMapIntensity: o.ao == null ? 1 : o.ao || 0,
        normalMap: o.normal === false ? null : (o.knurl ? SETS.knurl.tex.normal : t.normal),
        envMapIntensity: o.env == null ? 1 : o.env,
      });
      if (m.normalMap) { const s = o.normalScale == null ? 0.35 : o.normalScale; m.normalScale = new THREE.Vector2(s, s); m.userData.detailNormal = m.normalMap; if (detail < 1) m.normalMap = null; }
      if (m.roughnessMap) { m.onBeforeCompile = metalPacked; m.customProgramCacheKey = () => 'metalPacked'; }
      if (o.extra) Object.assign(m, o.extra);
      return m;
    });
  }

  const mat = {
    PALETTE,
    /** Метров на один повтор текстуры краски (для boxUV). */
    WEAR_REPEAT,

    /** Крашеный металл с потёртостями. wear 0..1 — три ступени (<0.34, <0.7, выше): сколы, ржавчина и потёки растут с износом. */
    paint(hex = PALETTE.panel, opts = {}) {
      const w = opts.wear == null ? 0.5 : opts.wear;
      const lvl = w < 0.34 ? 0 : w < 0.7 ? 1 : 2;
      const c = toColor(hex);
      return painted('paint:' + c.getHexString() + ':' + lvl, c, [0.2, 0.5, 0.85][lvl]);
    },

    /** Самосветящийся материал (не зависит от освещения). intensity > 1 — «пересвет» для ламп. */
    emissive(hex = PALETTE.lampWhite, intensity = 1) {
      const c = toColor(hex);
      return memo('emissive:' + c.getHexString() + ':' + (+intensity).toFixed(3), () =>
        new THREE.MeshBasicMaterial({ color: c.multiplyScalar(intensity) }));
    },

    get steel() { return metal('steel', { color: 0x9aa2a9, roughness: 0.4, metalness: 0.92 }); },
    get darkSteel() { return metal('darkSteel', { color: 0x434b53, roughness: 0.55, metalness: 0.8 }); },
    get nickel() { return metal('nickel', { color: toColor(PALETTE.nickel).multiplyScalar(1.22), roughness: 0.22, metalness: 1, normalScale: 0.2 }); },
    /** (расш.) Латунь: обтюратор, гильзы, переговорная труба. На оправы приборов не ставить (§3: оправы — никель). */
    get brass() { return metal('brass', { color: toColor(PALETTE.brass).multiplyScalar(1.15), roughness: 0.32, metalness: 1, normalScale: 0.25 }); },
    /** (расш.) Сталь в смазке: тёмная, с влажным блеском (затвор, направляющие). */
    get greased() { return metal('greased', { color: 0x2c3034, roughness: 0.2, metalness: 0.75, normalScale: 0.15, env: 1.2 }); },
    get bakelite() {
      return metal('bakelite', { color: toColor(PALETTE.bakelite), roughness: 0.4, metalness: 0, env: 0.6, ao: 0.6, normalScale: 0.08 });
    },
    /** (расш.) Бакелит с накаткой (рукоятки, ручки галетников; UV тел вращения: u — по окружности). */
    get knurled() {
      return metal('knurled', { color: toColor(PALETTE.bakelite), roughness: 0.45, metalness: 0, env: 0.6, ao: 0.6, knurl: true, normalScale: 0.6,
        extra: {} });
    },
    get ivory() {
      return memo('ivory', () => new THREE.MeshStandardMaterial({ color: toColor(PALETTE.ivory), roughness: 0.55 / METAL_G, roughnessMap: SETS.metal.tex.pack, metalness: 0.0 }));
    },
    get copper() { return metal('copper', { color: toColor(PALETTE.copper).multiplyScalar(1.1), roughness: 0.4, metalness: 1 }); },
    get rubber() { return metal('rubber', { color: 0x111213, roughness: 0.86, metalness: 0, ao: 0.5, normal: false }); },
    get glass() {
      return memo('glass', () => new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.05 / METAL_G, roughnessMap: SETS.metal.tex.pack, metalness: 0.0,
        transparent: true, opacity: 0.16, depthWrite: false, envMapIntensity: 2.2,
      }));
    },
    /** Охристая эмаль маховиков и рукоятей приводов (сколы до стали — редкие, у рукояток). */
    get ochre() {
      return memo('ochre', () => applyWear(new THREE.MeshStandardMaterial({
        color: toColor(PALETTE.ochre), roughness: 0.38, metalness: 0.0, envMapIntensity: 0.8,
      }), { wear: 0.25, rust: 0.15, grime: 0.2, normalScale: 0.3 }));
    },
    get floor() {
      return memo('floor', () => {
        const t = SETS.floor.tex;
        const m = new THREE.MeshPhongMaterial({
          color: toColor(PALETTE.floor).multiplyScalar(4.6), map: t.pack, normalMap: t.normal, normalScale: new THREE.Vector2(1, 1),
          specular: new THREE.Color(0x9a9a9a), shininess: 38,
        });
        m.onBeforeCompile = floorPhong; m.customProgramCacheKey = () => 'floorP';
        return m;
      });
    },
    get wall() {
      return painted('wall', toColor(PALETTE.frame).multiplyScalar(1.5), 0.85, { shininess: 18 }, { grime: 0.45 });
    },

    // --- служебные (используются органами управления) ---
    /** Текстура мягкого ореола (общая). */
    get glowTexture() { return tex('glow', () => canvasTexture(glowCanvas(128, 2.0), { aniso: 1 })); },
    /** Материал спрайта свечения данного цвета (общий на цвет). */
    glowSprite(hex, opacity = 0.9) {
      const c = toColor(hex);
      return memo('glowSprite:' + c.getHexString() + ':' + opacity, () => new THREE.SpriteMaterial({
        map: mat.glowTexture, color: c, blending: THREE.AdditiveBlending, transparent: true, opacity,
        depthWrite: false, depthTest: true, fog: false,
      }));
    },
    /** Линза лампы: потушенная/горящая (общие на цвет). Без текстур — годится для любой геометрии. */
    lens(hex, on) {
      const c = toColor(hex);
      return memo('lens:' + c.getHexString() + ':' + (on ? 1 : 0), () => on
        ? new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.6), emissive: c, emissiveIntensity: 1.7, roughness: 0.25, metalness: 0 })
        : new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.22), emissive: c, emissiveIntensity: 0.03, roughness: 0.16, metalness: 0 }));
    },
    /**
     * (расш.) Линза с колбой и нитью накала (общие на цвет): горящая — яркий центр и спираль (emissiveMap, светится постобработкой),
     * погашенная — тёмное стекло с нитью внутри. Нужны плоские UV линзы: u, v = x, y / диаметр + 0.5 (так делает ui.lamp).
     */
    bulbLens(hex, on) {
      const c = toColor(hex);
      // обе линзы — с одинаковым набором карт: одна программа шейдера на оба состояния (переключение лампы не компилирует шейдер)
      const offMap = tex('bulbOff', () => canvasTexture(bulbCanvas(false), { aniso: 2 }));
      const onMap = tex('bulbOn', () => canvasTexture(bulbCanvas(true), { aniso: 2 }));
      return memo('bulbLens:' + c.getHexString() + ':' + (on ? 1 : 0), () => on
        ? new THREE.MeshStandardMaterial({
          color: c.clone().multiplyScalar(0.6), map: onMap, emissive: c, emissiveIntensity: 2.3, emissiveMap: onMap, roughness: 0.22, metalness: 0,
        })
        : new THREE.MeshStandardMaterial({
          color: c.clone().multiplyScalar(0.3), map: offMap, emissive: c, emissiveIntensity: 0.04, emissiveMap: onMap,
          roughness: 0.08, metalness: 0, envMapIntensity: 1.6,
        }));
    },
    /** Общий кэш для материалов, создаваемых модулями движка. */
    memo,
    /** (расш.) Износ краски на своём Phong/Standard-материале — см. applyWear выше. */
    applyWear,
    /** (расш.) Процедурные текстуры (общие; данные появляются в первом кадре): { paint:{pack,normal}, floor:{…}, metal:{…}, knurl:{normal} }. */
    textures: { paint: SETS.paint.tex, floor: SETS.floor.tex, metal: SETS.metal.tex, knurl: SETS.knurl.tex },
    /** (расш.) Сгенерировать наборы под уровень ('high'|'mid'|'low'); обычно зовёт сам движок через bind(). */
    realize,
    /** (расш.) Мелкие карты нормалей: 2 — все (high), 1 — без крашеных (mid), 0 — нет (low); bind() ставит по уровню. */
    setDetail,
    /**
     * (расш.) Подключить к движку: наборы наполняются в первом кадре под engine.quality.tier, по событию 'quality' —
     * перегенерация по одному набору за кадр. Зовёт room.js.
     */
    bind(engine) {
      if (mat._bound) return;
      mat._bound = true;
      let started = false, want = null;
      const queue = [];
      engine.on('quality', (q) => {
        if (q && q.tier) setDetail(DETAIL[q.tier] == null ? 2 : DETAIL[q.tier]);
        if (!started || !q || !q.tier) return;
        want = q.tier;
        for (const n of Object.keys(SETS)) if (SETS[n].size !== sizeFor(SETS[n], want) && !queue.includes(n)) queue.push(n);
      });
      engine.onFrame(() => {
        if (!started) {
          started = true;
          const t0 = performance.now();
          const tier = (engine.quality && engine.quality.tier) || 'high';
          setDetail(DETAIL[tier] == null ? 2 : DETAIL[tier]);
          realize(tier);
          stats.startMs = Math.round(performance.now() - t0);
          return;
        }
        if (queue.length) { stats.tier = want; realizeSet(queue.shift(), want); }
      });
    },
    /** (расш.) Статистика: { tier, startMs (генерация в первом кадре), genMs (всего), sets: {имя:{size, ms}}, bytes, mb }. */
    stats() {
      let bytes = 0;
      for (const n of Object.keys(SETS)) for (const t of Object.values(SETS[n].tex)) bytes += textureBytes(t);
      return Object.assign({}, stats, { genMs: Math.round(stats.genMs), bytes, mb: +(bytes / 1048576).toFixed(1) });
    },
    dispose() {
      cache.forEach(m => m.dispose());
      texCache.forEach(t => { if (t.isTexture) t.dispose(); else Object.values(t).forEach(x => x.dispose && x.dispose()); });
      for (const n of Object.keys(SETS)) for (const t of Object.values(SETS[n].tex)) t.dispose();
      cache.clear(); texCache.clear();
    },
  };
  return mat;
}
