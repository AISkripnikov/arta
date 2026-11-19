// «Мир снаружи»: общее небо, море, суша, частицы и события боя для трёх видов наружу — смотровой щели поста «ОГОНЬ»
// (fire-slit.js), стереотрубы (observe.js) и неба зенитки (aa.js). Все три берут погоду, время суток, солнце/луну,
// ветер и цвета из одного lookFor(mission), поэтому показывают одно и то же небо.
//
//   lookFor(mission) → look           — вид неба на задание (кэшируется по ключу; см. «Время суток» ниже)
//   GLSL                              — общие куски шейдеров (шум, небо, облака) — для своих материалов постов
//   createSkyUniforms(look) / applyLookUniforms(u, look, wind)
//   createOutside(ctx, opts) → out     — сцена «снаружи» для щели и трубы: камера, небо, море, суша, флот, самолёты,
//                                         частицы, дождь, молнии, «люстры», дымзавесы, всплески; рисуется в чужую цель
//   createParticles(THREE, { max })    — пул частиц-billboard'ов (1 вызов отрисовки на всё: дым, брызги, огонь, вспышки)
//   createSkyPlaneMaterial(quality)  — небо и море «по углам» для плоскости за проёмом зенитки
//   createLitColorMaterial()            — вершинные цвета, освещённые солнцем/небом задания (самолёты зенитки)
//
// Мир: x — восток, y — вверх, z — юг (север = −z), 1 единица = 1 м, батарея в (0, 0). Пеленг b → (sin b, 0, −cos b).
//
// Время суток. Ночь и погода — из задания (mission.night, mission.weather). Ясный день — один из четырёх видов:
// 'dawn' (рассвет, солнце низко на востоке), 'day', 'overcast' (сплошная облачность), 'evening' (золотой вечер, солнце
// низко на западе). Вид выбирается детерминированно по заданию: хеш от mission.id и зерна карты (mission.map.seed);
// у задания дня id = 'daily-ГГГГ-ММ-ДД' — у всех игроков в этот день одинаково. Первые три задания кампании (index 0–2,
// обучение) — всегда 'day'. Туман — 'fog' (бледное солнце в дымке), шторм — 'storm' (тёмные быстрые облака, дождь, молнии).
// Азимут и высота солнца (луны ночью) тоже от хеша, в пределах своего вида. Игру это не меняет — только картинка.
import * as THREE from 'three';
import { createFleet, createAirWing } from './ships.js';

const DEG = Math.PI / 180;
export const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
export const wrap180 = (a) => ((a + 540) % 360 + 360) % 360 - 180;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// свой генератор: украшения не трогают Math.random (игра и замеры с зерном остаются повторяемыми)
let rs = 0x2545f491;
export const rnd = () => { rs = (rs + 0x6d2b79f5) | 0; let t = Math.imul(rs ^ (rs >>> 15), 1 | rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const strHash = (s) => { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };

// ---------------------------------------------------------------- вид неба ----------------------------------------
// Цвета — sRGB (как в макетах); в униформы идут линейными (THREE.Color делает перевод сам).
const TOD = {
  day:      { label: 'ДЕНЬ', el: [34, 52], az: [150, 215], zen: '#4f7fb6', hor: '#cbd9e2', sun: '#fff1da', sunI: 3.0, glow: 1, cloud: 0.32, cDark: 0.15, cLit: '#ffffff', cShade: '#9aa8b8', sea: '#1d4058', sss: '#2f8a8a', fog: 2.6e-5, amb: 1, stars: 0 },
  dawn:     { label: 'РАССВЕТ', el: [3, 8], az: [78, 112], zen: '#46679a', hor: '#c8bcc4', sun: '#ffae74', sunI: 2.2, glow: 1.7, cloud: 0.38, cDark: 0.2, cLit: '#ffd6b8', cShade: '#6a6f8c', sea: '#1d3550', sss: '#3a7a84', fog: 3.4e-5, amb: 0.72, stars: 0 },
  overcast: { label: 'ПАСМУРНО', el: [26, 40], az: [140, 220], zen: '#7f8b97', hor: '#bcc4ca', sun: '#eef1f2', sunI: 0.9, glow: 0.35, cloud: 0.86, cDark: 0.32, cLit: '#d9dde0', cShade: '#7f8891', sea: '#2a3e4a', sss: '#3c6e70', fog: 4.2e-5, amb: 0.9, stars: 0 },
  evening:  { label: 'ВЕЧЕР', el: [4, 9], az: [248, 284], zen: '#46628f', hor: '#d6c4b0', sun: '#ffa04e', sunI: 2.4, glow: 1.9, cloud: 0.4, cDark: 0.2, cLit: '#ffcf96', cShade: '#6f6884', sea: '#1c3148', sss: '#5a7a6a', fog: 3.2e-5, amb: 0.75, stars: 0 },
  fog:      { label: 'ТУМАН', el: [22, 34], az: [140, 220], zen: '#a3abaf', hor: '#c2c7c7', sun: '#f6f2e6', sunI: 0.8, glow: 0.6, cloud: 0.6, cDark: 0.1, cLit: '#e0e3e3', cShade: '#a8aeb0', sea: '#4c5c62', sss: '#62807e', fog: 3.6e-4, amb: 0.95, stars: 0 },
  storm:    { label: 'ШТОРМ', el: [20, 32], az: [140, 220], zen: '#2c3640', hor: '#76808a', sun: '#c8ced2', sunI: 0.45, glow: 0.2, cloud: 0.92, cDark: 0.62, cLit: '#8c969e', cShade: '#2f363c', sea: '#1d2a32', sss: '#2e4c4c', fog: 1.1e-4, amb: 0.62, stars: 0 },
  night:      { label: 'НОЧЬ', el: [22, 40], az: [100, 260], zen: '#03060d', hor: '#13213a', sun: '#a9b8d8', sunI: 0.38, glow: 0.5, cloud: 0.22, cDark: 0.4, cLit: '#2a364e', cShade: '#0b1018', sea: '#06101c', sss: '#0e2430', fog: 3.0e-5, amb: 0.22, stars: 1 },
  nightStorm: { label: 'НОЧЬ, ШТОРМ', el: [22, 40], az: [100, 260], zen: '#020406', hor: '#0e1620', sun: '#8b98aa', sunI: 0.12, glow: 0.2, cloud: 0.94, cDark: 0.6, cLit: '#1a222c', cShade: '#05080b', sea: '#040a10', sss: '#0a1a20', fog: 1.1e-4, amb: 0.16, stars: 0.25 },
  nightFog:   { label: 'НОЧЬ, ТУМАН', el: [22, 40], az: [100, 260], zen: '#0a0d10', hor: '#171c20', sun: '#9aa4ae', sunI: 0.14, glow: 0.4, cloud: 0.6, cDark: 0.3, cLit: '#1f262c', cShade: '#0b0e11', sea: '#0a1014', sss: '#121c20', fog: 3.6e-4, amb: 0.2, stars: 0 },
};
const looks = new Map();

/** Вид неба на задание: { key, tod, label, night, weather, sunDir, sunColor, sunI, ... } (общий объект на одинаковый ключ). */
export function lookFor(mission) {
  const m = mission || {}, w = m.weather === 'fog' || m.weather === 'storm' ? m.weather : 'clear', night = !!m.night;
  const seedTxt = (m.id || 'none') + ':' + ((m.map && m.map.seed) || 0);
  let tod;
  if (night) tod = w === 'storm' ? 'nightStorm' : w === 'fog' ? 'nightFog' : 'night';
  else if (w !== 'clear') tod = w;
  else if (!m.id || (m.index != null && m.index <= 2) || m.tutorial) tod = 'day';
  else { const r = strHash(seedTxt + ':tod'); tod = r < 0.4 ? 'day' : r < 0.6 ? 'dawn' : r < 0.8 ? 'evening' : 'overcast'; }
  const key = tod + '|' + seedTxt;
  let L = looks.get(key);
  if (L) return L;
  const T = TOD[tod], r1 = strHash(seedTxt + ':az'), r2 = strHash(seedTxt + ':el');
  const az = (T.az[0] + (T.az[1] - T.az[0]) * r1) * DEG, el = (T.el[0] + (T.el[1] - T.el[0]) * r2) * DEG;
  const c = (h) => new THREE.Color(h);
  L = {
    key, tod, label: T.label, night, weather: w, storm: w === 'storm', fog: w === 'fog',
    // «светило»: солнце днём, луна ночью — по нему блик на воде и свет на кораблях
    sunDir: new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)),
    sunAz: az / DEG, sunEl: el / DEG,
    sunColor: c(T.sun), sunI: T.sunI, glow: T.glow,
    zenith: c(T.zen), horizon: c(T.hor), sea: c(T.sea), sss: c(T.sss),
    cloud: T.cloud, cloudDark: T.cDark, cloudLit: c(T.cLit), cloudShade: c(T.cShade),
    fogDensity: T.fog, ambient: T.amb, stars: T.stars, moon: night && w !== 'fog' ? 1 : 0,
    cloudSeed: strHash(seedTxt + ':cl') * 50,
  };
  looks.set(key, L);
  return L;
}

/** Цвет неба (без облаков и светила) в направлении d — CPU-копия skyBase() из GLSL (для тумана моделей и тона частиц). */
export function skyBaseJS(L, dx, dy, dz, out) {
  const y = Math.max(dy, 0), t = Math.pow(y, 0.45);
  out.copy(L.horizon).lerp(L.zenith, t);
  const sd = Math.max(0, dx * L.sunDir.x + dy * L.sunDir.y + dz * L.sunDir.z);
  const g = (Math.pow(sd, 8) * 0.22 + 0.3 * Math.pow(1 - y, 7) * Math.pow(sd * 0.5 + 0.5, 4)) * L.glow * (L.night ? 0.25 : 1);
  out.r += L.sunColor.r * g; out.g += L.sunColor.g * g; out.b += L.sunColor.b * g;
  return out;
}

// ---------------------------------------------------------------- GLSL ---------------------------------------------
export const GLSL = {
  noise: /* glsl */`
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1.0, 0.0)), f.x), mix(h12(i + vec2(0.0, 1.0)), h12(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < OCT; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; } return s; }
`,
  skyUniforms: /* glsl */`
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uSunI; uniform float uGlow;
uniform vec3 uZen; uniform vec3 uHor; uniform float uNight;
uniform float uCloud; uniform float uCloudDark; uniform vec3 uCloudLit; uniform vec3 uCloudShade; uniform vec2 uCloudOff;
uniform float uStars; uniform float uMoon; uniform float uTime; uniform float uPixAng;
uniform float uFlash; uniform vec3 uFlashDir; uniform float uHaze;
`,
  sky: /* glsl */`
vec3 skyBase(vec3 d) {
  float y = max(d.y, 0.0);
  vec3 c = mix(uHor, uZen, pow(y, 0.45));
  float sd = max(dot(d, uSunDir), 0.0);
  c += uSunCol * (pow(sd, 8.0) * 0.22 + 0.3 * pow(1.0 - y, 7.0) * pow(sd * 0.5 + 0.5, 4.0)) * uGlow * mix(1.0, 0.25, uNight);
  return c;
}
vec4 clouds(vec3 d) {
  if (d.y <= 0.0) return vec4(0.0);
  vec2 uv = d.xz / (d.y + 0.1) * 1.7 + uCloudOff;
  float n = fbm(uv);
  float lo = 1.0 - uCloud;
  float cov = smoothstep(lo - 0.18, lo + 0.32, n);
  float n2 = vnoise((uv + uSunDir.xz * 0.35) * 2.03 + vec2(17.1, 9.2));
  float lit = clamp(0.55 + (n - n2) * 1.6 + (1.0 - cov) * 0.35, 0.0, 1.0) * (1.0 - uCloudDark * cov);
  vec3 col = mix(uCloudShade, uCloudLit, lit);
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunCol * pow(sd, 10.0) * (1.0 - cov) * 0.8 * uGlow * (1.0 - uNight * 0.7);
  col += uFlash * vec3(0.75, 0.8, 1.0) * (0.25 + 1.2 * cov) * (0.35 + 0.65 * pow(max(dot(d, uFlashDir), 0.0), 3.0));
  cov *= smoothstep(0.0, 0.1, d.y);
  return vec4(col, cov);
}
float starField(vec3 d) {
  if (d.y < 0.0) return 0.0;
  vec2 a = vec2(atan(d.x, -d.z), asin(clamp(d.y, -1.0, 1.0)));
  const float CELL = 0.012;
  vec2 g = a / CELL, i = floor(g);
  float h = h12(i + 7.0);
  if (h < 0.93) return 0.0;
  vec2 c = (i + 0.2 + 0.6 * vec2(h12(i + 3.1), h12(i + 9.7))) * CELL;
  vec2 dd = (a - c); dd.x *= cos(a.y);
  float r = length(dd), px = max(uPixAng, 0.0004);
  float br = (h - 0.93) / 0.07; br = br * br;
  float tw = 0.75 + 0.25 * sin(uTime * (1.5 + 3.0 * h12(i + 1.3)) + h * 40.0);
  return br * tw * smoothstep(px * 1.3, px * 0.3, r) * smoothstep(0.0, 0.05, d.y);
}
vec3 skyFull(vec3 d) {
  vec3 c = skyBase(d);
  float sd = dot(d, uSunDir);
  if (uNight > 0.5) {
    c += vec3(0.85, 0.9, 1.0) * starField(d) * uStars * (1.0 - uCloud * 0.6);
    float md = acos(clamp(sd, -1.0, 1.0));
    float disc = smoothstep(0.0105, 0.0085, md) * uMoon;
    float phase = 0.55 + 0.45 * smoothstep(-0.006, 0.008, dot(d - uSunDir, normalize(vec3(-uSunDir.z, 0.0, uSunDir.x))));
    c = mix(c, vec3(0.92, 0.94, 0.86) * phase, disc);
    c += uSunCol * 0.18 * exp(-md * 18.0) * uMoon;
  } else {
    float md = acos(clamp(sd, -1.0, 1.0));
    c += uSunCol * uSunI * (smoothstep(0.011, 0.008, md) * 3.0 + exp(-md * 60.0) * 0.6);
  }
  vec4 cl = clouds(d);
  c = mix(c, cl.rgb, cl.a);
  c = mix(c, skyBase(vec3(d.x, 0.0, d.z)), uHaze * pow(1.0 - max(d.y, 0.0), 10.0));
  return c;
}
`,
};
const octFor = (q) => (!q || q.tier === 'high' ? 4 : q.tier === 'mid' ? 3 : 2);

/** Униформы неба (общие для неба, моря и плоскости зенитки). */
export function createSkyUniforms() {
  return {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uSunI: { value: 1 }, uGlow: { value: 1 },
    uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uNight: { value: 0 },
    uCloud: { value: 0.3 }, uCloudDark: { value: 0.2 }, uCloudLit: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() },
    uCloudOff: { value: new THREE.Vector2() }, uStars: { value: 0 }, uMoon: { value: 0 }, uTime: { value: 0 }, uPixAng: { value: 0.001 },
    uFlash: { value: 0 }, uFlashDir: { value: new THREE.Vector3(0, 0.3, -1).normalize() }, uHaze: { value: 0 },
  };
}
export function applyLookUniforms(u, L) {
  u.uSunDir.value.copy(L.sunDir); u.uSunCol.value.copy(L.sunColor); u.uSunI.value = L.sunI; u.uGlow.value = L.glow;
  u.uZen.value.copy(L.zenith); u.uHor.value.copy(L.horizon); u.uNight.value = L.night ? 1 : 0;
  u.uCloud.value = L.cloud; u.uCloudDark.value = L.cloudDark; u.uCloudLit.value.copy(L.cloudLit); u.uCloudShade.value.copy(L.cloudShade);
  u.uStars.value = L.stars; u.uMoon.value = L.moon; u.uHaze.value = L.fog ? 1 : L.storm ? 0.6 : 0.25;
}
/** Ветер задания → { speed, x, z } (x, z — куда дует, единичный). */
export function windOf(mission, out = { speed: 0, x: 0, z: 1 }) {
  const w = mission && mission.wind, sp = (w && w.speed) || 0, to = (((w && w.from) || 0) + 180) * DEG;
  out.speed = sp; out.x = Math.sin(to); out.z = -Math.cos(to);
  return out;
}

// ---------------------------------------------------------------- материалы ----------------------------------------
function skyMaterial(u, q) {
  return new THREE.ShaderMaterial({
    uniforms: u, defines: { OCT: octFor(q) }, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    vertexShader: /* glsl */`varying vec3 vDir;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vDir = w.xyz - cameraPosition; gl_Position = projectionMatrix * viewMatrix * w; gl_Position.z = gl_Position.w; }`,
    fragmentShader: /* glsl */`${GLSL.skyUniforms}${GLSL.noise}${GLSL.sky}
      uniform vec4 uFlare[4]; uniform vec3 uFlareCol;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = skyFull(vec3(d.x, max(d.y, 0.0), d.z));
        for (int i = 0; i < 4; i++) { vec4 f = uFlare[i]; if (f.w <= 0.0) continue;
          vec3 fd = normalize(f.xyz - cameraPosition); float a = max(dot(d, fd), 0.0);
          c += uFlareCol * f.w * (pow(a, 3000.0) * 0.5 + pow(a, 300.0) * 0.1 + pow(a, 40.0) * 0.025 * (0.3 + uHaze)); }
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

function seaMaterial(u, q) {
  const lo = q && q.tier === 'low';
  return new THREE.ShaderMaterial({
    uniforms: u, defines: { OCT: 2, NW: lo ? 2 : 4, DETAIL: lo ? 0 : 1 }, fog: false, toneMapped: false,
    vertexShader: /* glsl */`
      uniform vec4 uWave[4]; uniform float uSteep; uniform float uTime; uniform float uAmpSum;
      varying vec3 vW; varying float vCrest;
      float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h12(i), h12(i + vec2(1.0, 0.0)), f.x), mix(h12(i + vec2(0.0, 1.0)), h12(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main() {
        vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
        float fade = 1.0 - smoothstep(1200.0, 5000.0, length(p.xz - cameraPosition.xz));
        vec3 disp = vec3(0.0);
        vec2 pn = vec2(vnoise(p.xz * 0.0031), vnoise(p.xz * 0.0057 + 5.3)) * 6.2832;
        for (int i = 0; i < NW; i++) {
          vec4 w = uWave[i]; float k = w.z, A = w.w;
          float ph = k * dot(w.xy, p.xz) - sqrt(9.81 * k) * uTime + float(i) * 1.7 + (mod(float(i), 2.0) < 0.5 ? pn.x : pn.y);
          float qa = uSteep / (k * float(NW) + 1e-4);
          disp.xz += qa * w.xy * cos(ph) * min(A * k * 4.0, 1.0); disp.y += A * sin(ph);
        }
        vCrest = disp.y / max(uAmpSum, 1e-3);
        p += disp * fade;
        vW = p;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`${GLSL.skyUniforms}${GLSL.noise}${GLSL.sky}
      uniform vec4 uWave[4]; uniform float uSteep; uniform float uAmpSum;
      uniform vec3 uSea; uniform vec3 uSss; uniform float uLight; uniform float uFogDen; uniform float uFoam; uniform float uSeaR;
      uniform vec2 uWind; uniform vec4 uFlare[4]; uniform vec3 uFlareCol; uniform vec4 uPatch[6];
      varying vec3 vW; varying float vCrest;
      void main() {
        vec3 P = vW; vec3 toC = cameraPosition - P; float dist = length(toC); vec3 V = toC / dist;
        float foot = dist * uPixAng / sqrt(max(V.y, 0.015));
        vec3 n = vec3(0.0, 1.0, 0.0); float vr = 0.0;
        vec2 pn = vec2(vnoise(P.xz * 0.0031), vnoise(P.xz * 0.0057 + 5.3)) * 6.2832;
        for (int i = 0; i < NW; i++) {
          vec4 w = uWave[i]; float k = w.z, A = w.w;
          float L = 6.2832 / k, f = 1.0 - smoothstep(L * 0.07, L * 0.28, foot);
          float ph = k * dot(w.xy, P.xz) - sqrt(9.81 * k) * uTime + float(i) * 1.7 + (mod(float(i), 2.0) < 0.5 ? pn.x : pn.y);
          float s = k * A * cos(ph);
          n.xz -= w.xy * s * f; vr += 0.5 * (k * A) * (k * A) * (1.0 - f);
        }
        #if DETAIL
        { // мелкая рябь: три бегущие волны под разными углами
          vec2 wd = uWind; vec2 wp = vec2(-wd.y, wd.x);
          vec2 D[3]; D[0] = normalize(wd + wp * 0.6); D[1] = normalize(wd - wp * 0.9); D[2] = normalize(wd * 0.3 + wp);
          float Ls[3]; Ls[0] = 7.3; Ls[1] = 3.1; Ls[2] = 1.35;
          for (int i = 0; i < 3; i++) {
            float k = 6.2832 / Ls[i], f = 1.0 - smoothstep(Ls[i] * 0.07, Ls[i] * 0.28, foot), sl = 0.09 * (0.5 + uSteep);
            float ph = k * dot(D[i], P.xz) - sqrt(9.81 * k) * uTime * 1.1 + float(i) * 2.3 + vnoise(P.xz * 0.013) * 6.0;
            n.xz -= D[i] * sl * cos(ph) * f; vr += 0.5 * sl * sl * (1.0 - f);
          }
        }
        #else
        vr += 0.012 * (0.5 + uSteep);
        #endif
        n = normalize(n);
        vr += 0.0015;
        float cosT = max(dot(n, V), 0.0);
        float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
        vec3 R = reflect(-V, n); R.y = abs(R.y) + 0.002 + sqrt(vr) * 0.8; R = normalize(R);
        vec3 refl = skyBase(R) * 0.9;
        refl = mix(refl, mix(uCloudShade, uCloudLit, 0.6), uCloud * 0.55 * smoothstep(0.0, 0.25, R.y));
        refl += uFlash * vec3(0.5, 0.55, 0.65) * 0.5;
        float day = 1.0 - uNight;
        vec3 water = uSea * uLight;
        float back = pow(max(dot(-V, uSunDir) * 0.5 + 0.5, 0.0), 2.0);
        water += uSss * uLight * max(vCrest, 0.0) * (0.35 + 0.9 * back);
        vec3 col = mix(water, refl, F);
        // блик солнца / луны: нормированный «гауссов» лепесток с шириной от неразрешённой ряби
        vec3 H = normalize(uSunDir + V); float nh = max(dot(n, H), 0.001), t2 = (1.0 - nh * nh) / (nh * nh);
        float spec = exp(-t2 / (2.0 * vr)) / (6.2832 * vr * 4.0 * max(cosT, 0.08));
        col += uSunCol * uSunI * min(spec * F * 1.4, 40.0) * (1.0 - uCloud * 0.75) * step(0.0, uSunDir.y);
        // пена: гребни в шторм и пятна от разрывов (контраст гаснет с размером пикселя)
        float fn = vnoise(P.xz * 0.11 + uWind * uTime * 0.6), fc = mix(0.5, fn, 1.0 - smoothstep(4.0, 20.0, foot));
        float foam = uFoam * smoothstep(0.45, 0.95, vCrest + (fc - 0.5) * 0.6);
        for (int i = 0; i < 6; i++) { vec4 pp = uPatch[i]; if (pp.w <= 0.0) continue;
          float dd = length(P.xz - pp.xy) / pp.z; foam += pp.w * smoothstep(1.0, 0.35, dd + (fc - 0.5) * 0.5); }
        col = mix(col, vec3(0.86, 0.9, 0.92) * (uLight * 1.6 + 0.04), clamp(foam, 0.0, 0.9));
        // «люстры»: свет на воде и дорожка-отражение
        for (int i = 0; i < 4; i++) { vec4 f = uFlare[i]; if (f.w <= 0.0) continue;
          vec3 Lv = f.xyz - P; float dl = length(Lv); Lv /= dl;
          float att = f.w / (1.0 + (dl / 700.0) * (dl / 700.0));
          vec3 Hf = normalize(Lv + V); float nhf = max(dot(n, Hf), 0.001), tf = (1.0 - nhf * nhf) / (nhf * nhf);
          float sf = exp(-tf / (2.0 * (vr + 0.004))) / (6.2832 * (vr + 0.004) * 4.0 * max(cosT, 0.08));
          col += uFlareCol * att * (max(dot(n, Lv), 0.0) * 0.06 + min(sf * (F + 0.04), 12.0) * 0.5); }
        // дымка к горизонту — в цвет неба над горизонтом в этом направлении (шов с небом не виден)
        float fogF = 1.0 - exp(-uFogDen * uFogDen * dist * dist);
        fogF = max(fogF, smoothstep(uSeaR * 0.55, uSeaR * 0.95, dist));
        vec3 hz = skyBase(normalize(vec3(-V.x, 0.0, -V.z)));
        col = mix(col, hz, fogF);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// ---------------------------------------------------------------- частицы ------------------------------------------
// Один InstancedBufferGeometry-«рой» billboard'ов на сцену: дым, брызги, пламя, вспышки, трассы, огни.
// kind: 0 — дым (мягкий, рваный край), 1 — вода/брызги (плотнее), 2 — свечение (мягкое пятно с ядром).
// add: 0 — обычное смешивание, 1 — сложение (огонь, вспышки), промежуточные — переход «огненный шар → дым».
// Частицы «живут» в пуле (emit) или рисуются один кадр (put: огни, «люстры», трассы). Без выделений памяти за кадр.
export const PK = { SMOKE: 0, WATER: 1, GLOW: 2 };
export function createParticles(THREE_, o = {}) {
  const MAX = o.max || 400;
  const N = MAX;
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const aP = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const aC = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const aK = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aP', aP); geo.setAttribute('aC', aC); geo.setAttribute('aK', aK);
  geo.instanceCount = 0;
  const uniforms = { uFogDen: { value: 0 }, uFogCol: { value: new THREE.Color() }, uFade: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, toneMapped: false, fog: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    vertexShader: /* glsl */`
      attribute vec4 aP; attribute vec4 aC; attribute vec4 aK;
      uniform float uFogDen;
      varying vec2 vUv; varying vec4 vC; varying vec3 vK; varying float vFog;
      void main() {
        vec4 mv = modelViewMatrix * vec4(aP.xyz, 1.0);
        vec2 off = position.xy * aP.w;
        off.y *= 1.0 + aK.w;
        float a = aK.z * 6.2832, c = cos(a), s = sin(a);
        off = vec2(c * off.x - s * off.y, s * off.x + c * off.y);
        mv.xy += off;
        gl_Position = projectionMatrix * mv;
        vUv = position.xy + 0.5; vC = aC; vK = aK.xyz;
        float d = -mv.z; vFog = 1.0 - exp(-uFogDen * uFogDen * d * d);
      }`,
    fragmentShader: /* glsl */`
      #define OCT 1
      ${GLSL.noise}
      uniform vec3 uFogCol; uniform float uFade;
      varying vec2 vUv; varying vec4 vC; varying vec3 vK; varying float vFog;
      void main() {
        vec2 q = vUv * 2.0 - 1.0; float r = length(q);
        if (r > 1.0) discard;
        float a, shade = 1.0;
        if (vK.x < 0.5) {
          float n = vnoise(vUv * 3.0 + vK.z * 31.0) * 0.6 + vnoise(vUv * 6.5 + vK.z * 17.0) * 0.4;
          a = smoothstep(1.0, 0.2, r + (n - 0.5) * 0.75); shade = 0.72 + 0.32 * vUv.y + (n - 0.5) * 0.25;
        } else if (vK.x < 1.5) {
          float n = vnoise(vUv * 5.0 + vK.z * 13.0);
          a = smoothstep(1.0, 0.15, r + (n - 0.5) * 0.9); shade = 0.86 + 0.22 * vUv.y;
        } else {
          a = exp(-r * r * 5.0) + smoothstep(0.3, 0.0, r) * 0.6;
        }
        float add = vK.y;
        float al = clamp(a * vC.a * uFade, 0.0, 1.0);
        vec3 col = vC.rgb * shade;
        col = mix(col, uFogCol, vFog * (1.0 - add)) * mix(1.0, 1.0 - vFog, add);
        gl_FragColor = vec4(col * al, al * (1.0 - add));
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 5; mesh.name = 'particles';
  // пул: SoA-массивы
  const P = new Float32Array(MAX * 3), V = new Float32Array(MAX * 3), S = new Float32Array(MAX * 4);  // S: age, life, size0, grow
  const C = new Float32Array(MAX * 4), K = new Float32Array(MAX * 4);    // C: rgba; K: kind, add, rot, stretch
  const F = new Float32Array(MAX * 4);                                     // F: gravity, drag, wind, mode(0 дым,1 вспышка,2 огненный шар,3 брызги)
  let n = 0;                                                               // живых в пуле
  const imm = { n: 0 };                                                    // разовых (на один кадр)
  const IMAX = Math.min(96, MAX >> 2);
  const IP = new Float32Array(IMAX * 4), IC = new Float32Array(IMAX * 4), IK = new Float32Array(IMAX * 4);
  let budget = 1;                                                          // доля разрешённых частиц (качество)
  const api = {
    mesh, uniforms, max: MAX, get count() { return n; },
    get budget() { return budget; }, set budget(v) { budget = clamp(v, 0.1, 1); },
    /** Частица в пул. mode: 0 дым (вход-выход), 1 вспышка (гаснет), 2 огненный шар → дым, 3 брызги. → индекс или −1. */
    emit(kind, x, y, z, vx, vy, vz, size, grow, life, r, g, b, a, mode = 0, gravity = 0, drag = 0, wind = 0, add = 0) {
      if (n >= MAX * budget) return -1;
      const i = n++;
      P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
      V[i * 3] = vx; V[i * 3 + 1] = vy; V[i * 3 + 2] = vz;
      S[i * 4] = 0; S[i * 4 + 1] = Math.max(0.05, life); S[i * 4 + 2] = size; S[i * 4 + 3] = grow;
      C[i * 4] = r; C[i * 4 + 1] = g; C[i * 4 + 2] = b; C[i * 4 + 3] = a;
      K[i * 4] = kind; K[i * 4 + 1] = add; K[i * 4 + 2] = rnd(); K[i * 4 + 3] = 0;
      F[i * 4] = gravity; F[i * 4 + 1] = drag; F[i * 4 + 2] = wind; F[i * 4 + 3] = mode;
      return i;
    },
    /** Разовая частица на этот кадр (огни, «люстры», трассы). rot — поворот (0…1 оборота), stretch — вытянуть по своей оси. */
    put(kind, x, y, z, size, r, g, b, a, add = 1, rot = 0, stretch = 0) {
      if (imm.n >= IMAX) return;
      const i = imm.n++;
      IP[i * 4] = x; IP[i * 4 + 1] = y; IP[i * 4 + 2] = z; IP[i * 4 + 3] = size;
      IC[i * 4] = r; IC[i * 4 + 1] = g; IC[i * 4 + 2] = b; IC[i * 4 + 3] = a;
      IK[i * 4] = kind; IK[i * 4 + 1] = add; IK[i * 4 + 2] = rot; IK[i * 4 + 3] = stretch;
    },
    clearImmediate() { imm.n = 0; },
    /** Сдвинуть все живые частицы (зенитка: небо «едет» при наводке — дым остаётся на месте в мире). */
    translate(dx, dy, dz) { for (let i = 0; i < n; i++) { P[i * 3] += dx; P[i * 3 + 1] += dy; P[i * 3 + 2] += dz; } },
    /** Шаг симуляции; wx, wz — ветер (м/с) для дыма. */
    update(dt, wx = 0, wz = 0) {
      if (!(dt > 0)) return;
      for (let i = 0; i < n; i++) {
        const age = (S[i * 4] += dt);
        if (age >= S[i * 4 + 1]) {           // умерла: на её место — последнюю
          n--;
          if (i < n) {
            P.copyWithin(i * 3, n * 3, n * 3 + 3); V.copyWithin(i * 3, n * 3, n * 3 + 3);
            S.copyWithin(i * 4, n * 4, n * 4 + 4); C.copyWithin(i * 4, n * 4, n * 4 + 4); K.copyWithin(i * 4, n * 4, n * 4 + 4); F.copyWithin(i * 4, n * 4, n * 4 + 4);
            i--;
          }
          continue;
        }
        const g = F[i * 4], dr = F[i * 4 + 1], w = F[i * 4 + 2], k = Math.max(0, 1 - dr * dt);
        V[i * 3] = V[i * 3] * k + wx * w * dr * dt; V[i * 3 + 1] = V[i * 3 + 1] * k - g * dt; V[i * 3 + 2] = V[i * 3 + 2] * k + wz * w * dr * dt;
        P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
        if (F[i * 4 + 3] === 3 && P[i * 3 + 1] < 0) { S[i * 4] = S[i * 4 + 1]; }     // брызги ушли в воду
      }
    },
    /** Записать живые и разовые частицы в буферы (перед отрисовкой). */
    write() {
      const p = aP.array, c = aC.array, kk = aK.array;
      let m = 0;
      for (let i = 0; i < n && m < N; i++, m++) {
        const t = S[i * 4] / S[i * 4 + 1], mode = F[i * 4 + 3];
        p[m * 4] = P[i * 3]; p[m * 4 + 1] = P[i * 3 + 1]; p[m * 4 + 2] = P[i * 3 + 2];
        p[m * 4 + 3] = S[i * 4 + 2] * (1 + S[i * 4 + 3] * t);
        let al = C[i * 4 + 3], add = K[i * 4 + 1], r = C[i * 4], g = C[i * 4 + 1], b = C[i * 4 + 2];
        if (mode === 1) al *= (1 - t) * (1 - t);
        else if (mode === 2) {                         // огненный шар: ярко → тёмный дым
          const h = clamp(t * 3.2, 0, 1);
          add = 1 - h; al *= Math.min(1, t * 30) * (1 - t);
          r = r * (1 - h) + 0.09 * h; g = g * (1 - h) + 0.08 * h; b = b * (1 - h) + 0.075 * h;
        } else if (mode === 3) al *= 1 - t * t;
        else al *= Math.min(1, t * 8) * (1 - t);
        c[m * 4] = r; c[m * 4 + 1] = g; c[m * 4 + 2] = b; c[m * 4 + 3] = al;
        kk[m * 4] = K[i * 4]; kk[m * 4 + 1] = add; kk[m * 4 + 2] = K[i * 4 + 2] + t * 0.08; kk[m * 4 + 3] = 0;
      }
      for (let i = 0; i < imm.n && m < N; i++, m++) {
        for (let j = 0; j < 4; j++) { p[m * 4 + j] = IP[i * 4 + j]; c[m * 4 + j] = IC[i * 4 + j]; kk[m * 4 + j] = IK[i * 4 + j]; }
      }
      geo.instanceCount = m;
      mesh.visible = m > 0;
      if (m) for (const at of [aP, aC, aK]) { at.clearUpdateRanges(); at.addUpdateRange(0, m * 4); at.needsUpdate = true; }
      return m;
    },
    clear() { n = 0; imm.n = 0; geo.instanceCount = 0; mesh.visible = false; },
    dispose() { geo.dispose(); mat.dispose(); },
  };
  return api;
}

// ---------------------------------------------------------------- суша ----------------------------------------------
/**
 * Профиль берега: () → Float32Array(360) | null — расстояние (км) до ближайшей суши по каждому градусу пеленга
 * от батареи (0 — суши нет). Считается один раз на карту задания.
 */
export function createLandProfile(game) {
  let landMap = null, landFor = null;
  const get = () => {
    const m = game.state.mission;
    if (!m || !m.battery) return null;
    if (landFor === m.map && landMap) return landMap;
    landFor = m.map; landMap = new Float32Array(360);
    const bx = m.battery.x, by = m.battery.y, max = (game.C && game.C.MAP) || 20;
    for (let a = 0; a < 360; a++) {
      const sx = Math.sin(a * DEG), sy = Math.cos(a * DEG);
      let found = 0;
      for (let d = 0.5; d <= 22; d += d < 4 ? 0.15 : 0.3) {
        const x = bx + sx * d, y = by + sy * d;
        if (x < 0 || y < 0 || x > max || y > max) break;
        let isL = false;
        try { isL = game.isLand(x, y); } catch (e) { isL = false; }
        if (isL) { found = d; break; }
      }
      landMap[a] = found;
    }
    return landMap;
  };
  get.reset = () => { landFor = null; };
  return get;
}

// ---------------------------------------------------------------- сцена «снаружи» ----------------------------------
const SEA_R = 46000;
const C_WHITE = new THREE.Color(1, 1, 1);

/**
 * Сцена снаружи для щели и трубы. opts: { eye (м над водой), ex (во сколько раз корабли крупнее натуры),
 *   planeElev (сжатие угла места самолётов, 1 — как есть), landScale (высота берега), near, view: 'slit'|'scope' }.
 * → { scene, camera, info, look, particles, fleet, wing, sync(dt, vt), impact(e, rule), muzzle(o), render(rt), reset(),
 *     setQuality(q), dispose() }
 */
export function createOutside(ctx, opts) {
  const { engine, game } = ctx;
  const EYE = opts.eye || 36, EX = opts.ex || 2.2, PEL = opts.planeElev || 1, LSC = opts.landScale || 1;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xffffff, 3e-5);
  const camera = new THREE.PerspectiveCamera(16, 1, opts.near || 25, 70000);
  camera.rotation.order = 'YXZ';
  camera.position.set(0, EYE, 0);
  scene.add(camera);
  let q = engine.quality || { tier: 'high', rtScale: 1, samples: 4 };
  const info = { look: '', tod: '', particles: 0, foam: 0, lightning: 0 };

  // свет для моделей (сцена своя — к источникам помещения отношения не имеет)
  const hemi = new THREE.HemisphereLight(0xffffff, 0x334455, 2.4), sun = new THREE.DirectionalLight(0xffffff, 2);
  const flareL = [new THREE.PointLight(0xffe2b0, 0, 2200, 1.2), new THREE.PointLight(0xffe2b0, 0, 2200, 1.2)];
  scene.add(hemi, sun, sun.target, ...flareL);

  // небо и море
  const U = createSkyUniforms();
  const flareU = { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] };
  const flareCol = { value: new THREE.Color(1, 0.86, 0.62) };
  const skyU = Object.assign({}, U, { uFlare: flareU, uFlareCol: flareCol });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(60000, 32, 16), skyMaterial(skyU, q));
  sky.frustumCulled = false; sky.renderOrder = -10;
  scene.add(sky);
  const seaU = Object.assign({}, U, {
    uWave: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    uSteep: { value: 0.5 }, uAmpSum: { value: 1 }, uSea: { value: new THREE.Color() }, uSss: { value: new THREE.Color() },
    uLight: { value: 1 }, uFogDen: { value: 3e-5 }, uFoam: { value: 0 }, uWind: { value: new THREE.Vector2(0, 1) }, uSeaR: { value: SEA_R },
    uFlare: flareU, uFlareCol: flareCol,
    uPatch: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector4()) },
  });
  const seaGeo = (() => {   // кольца вокруг камеры: густо вблизи, редко вдали
    const A = 96, R = 56, pos = [], idx = [];
    pos.push(0, 0, 0);
    for (let j = 1; j <= R; j++) {
      const r = 6 * Math.pow(SEA_R / 6, j / R);
      for (let i = 0; i < A; i++) { const a = i / A * Math.PI * 2; pos.push(Math.sin(a) * r, 0, -Math.cos(a) * r); }
    }
    for (let i = 0; i < A; i++) idx.push(0, 1 + (i + 1) % A, 1 + i);
    for (let j = 1; j < R; j++) {
      const o0 = 1 + (j - 1) * A, o1 = 1 + j * A;
      for (let i = 0; i < A; i++) { const i1 = (i + 1) % A; idx.push(o0 + i, o1 + i1, o1 + i, o0 + i, o0 + i1, o1 + i1); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    return g;
  })();
  const sea = new THREE.Mesh(seaGeo, seaMaterial(seaU, q));
  sea.frustumCulled = false; sea.renderOrder = -5;
  scene.add(sea);

  // дождь: полоса перед камерой (только шторм)
  const rainU = { uTime: { value: 0 }, uAmt: { value: 0 }, uSlant: { value: 0.15 }, uScale: { value: new THREE.Vector2(40, 6) }, uCol: { value: new THREE.Color() } };
  const rain = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: rainU, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */`#define OCT 1
      ${GLSL.noise}
      uniform float uTime; uniform float uAmt; uniform float uSlant; uniform vec2 uScale; uniform vec3 uCol; varying vec2 vUv;
      void main() {
        float a = 0.0;
        for (int l = 0; l < 2; l++) {
          float fl = float(l), sc = 1.0 + fl * 0.7;
          vec2 p = vec2(vUv.x * uScale.x * sc + vUv.y * uSlant * uScale.x, vUv.y * uScale.y * sc + uTime * (3.2 - fl));
          vec2 i = floor(p), f = fract(p);
          float h = h12(i + fl * 19.0), len = 0.25 + 0.5 * h12(i + 2.7), y0 = h12(i + 8.1) * (1.0 - len);
          float x = abs(f.x - 0.2 - 0.6 * h12(i + 5.3));
          a += step(0.72, h) * smoothstep(0.035, 0.0, x) * smoothstep(y0, y0 + len * 0.3, f.y) * smoothstep(y0 + len, y0 + len * 0.6, f.y) * (0.45 - fl * 0.2);
        }
        float al = clamp(a * uAmt, 0.0, 0.35);
        gl_FragColor = vec4(uCol * al, al * 0.5);
        #include <colorspace_fragment>
      }`,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  }));
  rain.frustumCulled = false; rain.renderOrder = 20; rain.visible = false;
  scene.add(rain);

  // частицы
  const PMAX = { high: 520, mid: 340, low: 200 };
  const particles = createParticles(THREE, { max: PMAX.high });
  particles.budget = PMAX[q.tier] / PMAX.high || 1;
  scene.add(particles.mesh);

  // суша: «занавес» по ближней кромке берега с плоской крышей за ним (камера в центре — радиальных щелей не видно)
  const land = createLandProfile(game);
  const landMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  let landMesh = null, landFor = null, landH = null;
  function buildLand() {
    const m = game.state.mission;
    if (!m || landFor === m.map) return;
    landFor = m.map;
    if (landMesh) { scene.remove(landMesh); landMesh.geometry.dispose(); landMesh = null; }
    const lm = land();
    if (!lm) return;
    landH = landH || new Float32Array(360);
    const p = [], col = [];
    const cRock = new THREE.Color(0x6f6c60), cTop = new THREE.Color(0x5f6f52), cFoot = new THREE.Color(0x8c8672), cc = new THREE.Color();
    const pt = (a, d, h, c) => { p.push(Math.sin(a * DEG) * d, h, -Math.cos(a * DEG) * d); col.push(c.r, c.g, c.b); };
    const face = (a, d, h, k) => cc.copy(cFoot).lerp(cRock, clamp(h / 8, 0, 1)).lerp(cTop, clamp((h - 8) / 30, 0, 1) * k);
    const quad = (a0, d0, h0, a1, d1, h1) => {     // склон от уреза воды к гребню (гребень дальше на 6 высот) и плато за ним
      const k = 0.7 + 0.3 * hash(a0 * 13.1), e0 = d0 + h0 * 6, e1 = d1 + h1 * 6;
      const m0 = face(a0, d0, h0 * 0.5, k).clone(), m1 = face(a1, d1, h1 * 0.5, k).clone();
      pt(a0, d0, 0, cFoot); pt(a1, d1, 0, cFoot); pt(a1, (d1 + e1) / 2, h1 * 0.62, m1); pt(a0, d0, 0, cFoot); pt(a1, (d1 + e1) / 2, h1 * 0.62, m1); pt(a0, (d0 + e0) / 2, h0 * 0.62, m0);
      pt(a0, (d0 + e0) / 2, h0 * 0.62, m0); pt(a1, (d1 + e1) / 2, h1 * 0.62, m1); pt(a1, e1, h1, face(a1, d1, h1, k)); pt(a0, (d0 + e0) / 2, h0 * 0.62, m0); pt(a1, e1, h1, face(a1, d1, h1, k)); pt(a0, e0, h0, face(a0, d0, h0, k));
      pt(a0, e0, h0, cTop); pt(a1, e1, h1, cTop); pt(a1, e1 + 1600, h1 * 1.15, cTop); pt(a0, e0, h0, cTop); pt(a1, e1 + 1600, h1 * 1.15, cTop); pt(a0, e0 + 1600, h0 * 1.15, cTop);
    };
    for (let a = 0; a < 360; a++) landH[a] = lm[a] > 0 ? (12 + 22 * hash(a * 3 + 7)) * LSC * (lm[a] < 3 ? 0.75 : 1) : 0;
    for (let a = 0; a < 360; a++) {
      const b = (a + 1) % 360, A = lm[a], B = lm[b];
      if (!(A > 0) && !(B > 0)) continue;
      const dA = (A || B) * 1000, dB = (B || A) * 1000, hA = landH[a] || landH[b] * 0.3, hB = landH[b] || landH[a] * 0.3;
      const dM = (dA + dB) / 2, hM = (hA + hB) / 2 * (0.82 + 0.36 * hash(a * 7 + 1));
      quad(a, dA, hA, a + 0.5, dM, hM); quad(a + 0.5, dM, hM, a + 1, dB, hB);
    }
    if (!p.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    landMesh = new THREE.Mesh(g, landMat);
    landMesh.frustumCulled = false;
    scene.add(landMesh);
  }
  const landHeight = (b, dm) => {
    if (!landH) return 0;
    const i = ((Math.round(b) % 360) + 360) % 360, h = landH[i];
    if (dm == null || !(h > 0)) return h;
    const lm = land(), d0 = lm ? lm[i] * 1000 : 0;
    return h * clamp((dm - d0) / (6 * h), 0.15, 1.1);
  };

  // флот и самолёты (ships.js) — пишут огонь, дым, след и огни в общие частицы
  const fleet = createFleet(game, scene, { fx: particles });
  const wing = createAirWing(game, scene, { fx: particles });

  // ---- вид неба на задание ----
  let look = null;
  const wind = { speed: 0, x: 0, z: 1 };
  const _c = new THREE.Color(), _c2 = new THREE.Color();
  function applyLook(L) {
    look = L; info.look = L.key; info.tod = L.tod;
    applyLookUniforms(U, L);
    const night = L.night;
    seaU.uSea.value.copy(L.sea); seaU.uSss.value.copy(L.sss);
    seaU.uLight.value = night ? 0.5 : L.ambient;
    hemi.color.copy(L.zenith).lerp(C_WHITE, night ? 0.25 : 0.55);
    hemi.groundColor.copy(L.sea).lerp(L.horizon, 0.3);
    hemi.intensity = (night ? 1.1 : 2.3) * (night ? 1 : L.ambient);
    sun.color.copy(L.sunColor); sun.intensity = night ? 0.5 : L.sunI * 0.9;
    sun.position.copy(L.sunDir).multiplyScalar(1000); sun.target.position.set(0, 0, 0);
    scene.fog.density = L.fogDensity;
    seaU.uFogDen.value = L.fogDensity; particles.uniforms.uFogDen.value = L.fogDensity;
    landMat.color.set(night ? 0x23262a : L.fog ? 0xb8bdb8 : L.tod === 'overcast' || L.storm ? 0x9aa098 : 0xffffff);
    rain.visible = L.storm;
    rainU.uCol.value.copy(L.horizon).lerp(C_WHITE, 0.4);
    rainU.uAmt.value = night ? 0.5 : 1;
  }

  // ---- волны от ветра ----
  function applyWind() {
    const m = game.state.mission;
    windOf(m, wind);
    const storm = look && look.storm, sp = Math.max(1.5, wind.speed);
    const base = (0.18 + 0.075 * sp) * (storm ? 2.4 : 1), Ls = [64, 33, 19, 11], amp = [1, 0.55, 0.36, 0.22], rot = [0, 0.45, -0.6, 1.1];
    let sum = 0;
    const W = seaU.uWave.value;
    for (let i = 0; i < 4; i++) {
      const L = Ls[i] * (0.65 + sp / 14) * (storm ? 1.35 : 1), a = Math.atan2(wind.x, -wind.z) + rot[i];
      const A = base * amp[i] * (i >= (q.tier === 'low' ? 2 : 4) ? 0 : 1);
      W[i].set(Math.sin(a), -Math.cos(a), 2 * Math.PI / L, A);
      sum += A;
    }
    if (q.tier === 'low') { W[0].w += base * (amp[2] + amp[3]) * 0.6; sum += base * (amp[2] + amp[3]) * 0.6; }
    seaU.uAmpSum.value = sum;
    seaU.uSteep.value = storm ? 0.85 : clamp(0.25 + sp / 20, 0.25, 0.65);
    seaU.uFoam.value = storm ? 0.75 : clamp((sp - 8) / 10, 0, 0.35);
    seaU.uWind.value.set(wind.x, wind.z);
    rainU.uSlant.value = 0.12 + clamp(sp / 40, 0, 0.25);
  }

  // ---- события ----
  const splashes = [];          // { x, z, t, kind, dim, sc, live } — для счётчика и пены
  for (let i = 0; i < 8; i++) splashes.push({ x: 0, z: 0, t: 0, kind: 'water', dim: 1, sc: 1, live: false });
  const patches = [];           // пятна пены: { x, z, r, t, life, k }
  for (let i = 0; i < 6; i++) patches.push({ x: 0, z: 0, r: 0, t: 0, life: 0, k: 0 });
  const R = rnd;
  function addPatch(x, z, r, life, k) {
    let p = patches[0];
    for (const c of patches) { if (c.t >= c.life) { p = c; break; } if (c.life - c.t < p.life - p.t) p = c; }
    p.x = x; p.z = z; p.r = r; p.t = 0; p.life = life; p.k = k;
  }
  const smokeCol = (out, base, k = 1) => { // дым в свете задания
    const L = look, a = L ? (L.night ? 0.35 : 0.55 + 0.45 * L.ambient) : 1;
    out.setRGB(base * a * k, base * a * k * 0.98, base * a * k * 0.95);
    return out;
  };
  /** Столб воды со брызгами + пена; sc — масштаб (EX уже учтён снаружи). */
  function waterColumn(x, z, sc, dim) {
    const L = look, lw = L && L.night ? 0.45 : 1;
    const wc = _c.copy(L ? L.horizon : C_WHITE).lerp(C_WHITE, 0.75).multiplyScalar(lw * (0.75 + 0.25 * dim));
    const H = 70 * sc;
    for (let i = 0; i < 9; i++) {                          // ствол столба: брызги летят вверх и опадают
      const up = H * (0.45 + 0.6 * R()) * 0.9, vy = Math.sqrt(2 * 9.81 * 3 * up) / 1.0;
      particles.emit(PK.WATER, x + (R() - 0.5) * 8 * sc, 2, z + (R() - 0.5) * 8 * sc, (R() - 0.5) * 6 * sc, vy * (0.8 + 0.3 * R()), (R() - 0.5) * 6 * sc,
        (12 + 10 * R()) * sc, 0.9, 2.6 + R(), wc.r, wc.g, wc.b, 0.85 * dim, 3, 9.81 * 3, 0.15);
    }
    for (let i = 0; i < 7; i++) {                          // венец у воды
      const a = R() * Math.PI * 2, v = (18 + 14 * R()) * sc;
      particles.emit(PK.WATER, x, 3 * sc, z, Math.sin(a) * v, v * 0.9, Math.cos(a) * v, 9 * sc, 1.2, 1.6 + 0.6 * R(), wc.r, wc.g, wc.b, 0.75 * dim, 3, 9.81 * 2, 0.4);
    }
    for (let i = 0; i < 4; i++)                            // водяная пыль, сносится ветром
      particles.emit(PK.SMOKE, x + (R() - 0.5) * 20 * sc, (20 + 40 * R()) * sc, z, 0, 3 * sc, 0, 26 * sc, 1.8, 3.5 + R() * 1.5, wc.r, wc.g, wc.b, 0.35 * dim, 0, 0, 0.5, 1);
    addPatch(x, z, 38 * sc, 9, 0.75 * dim);
  }
  /** Разрыв на суше/корабле: вспышка, огненный шар, дым по ветру. */
  function burst(x, y, z, sc, dim, hit) {
    particles.emit(PK.GLOW, x, y + 6 * sc, z, 0, 0, 0, 60 * sc, 0.6, 0.35, 1.8, 1.4, 0.9, dim, 1, 0, 0, 0, 1);
    for (let i = 0; i < 6; i++)
      particles.emit(PK.SMOKE, x + (R() - 0.5) * 12 * sc, y + (4 + 10 * R()) * sc, z + (R() - 0.5) * 12 * sc, (R() - 0.5) * 10 * sc, (8 + 10 * R()) * sc, (R() - 0.5) * 10 * sc,
        (16 + 8 * R()) * sc, 1.6, 2.2 + R(), 1.6, 0.85, 0.35, dim, 2, -2, 0.8, 0.5, 1);
    const dark = hit ? 0.16 : 0.32;
    for (let i = 0; i < 6; i++) {
      smokeCol(_c2, hit ? dark : 0.42, 1);
      if (!hit) _c2.r *= 1.08, _c2.b *= 0.85;
      particles.emit(PK.SMOKE, x + (R() - 0.5) * 16 * sc, y + (6 + 14 * R()) * sc, z + (R() - 0.5) * 16 * sc, (R() - 0.5) * 3, (5 + 6 * R()) * sc, (R() - 0.5) * 3,
        (22 + 10 * R()) * sc, 2.4, 5 + 3 * R(), _c2.r, _c2.g, _c2.b, 0.8 * dim, 0, 0, 0.4, 1);
    }
    for (let i = 0; i < 5; i++) {                           // обломки/искры
      const a = R() * Math.PI * 2, v = (25 + 25 * R()) * sc;
      particles.emit(PK.GLOW, x, y + 5 * sc, z, Math.sin(a) * v * 0.6, v, Math.cos(a) * v * 0.6, 3.5 * sc, 0, 1 + R() * 0.6, 1.6, 0.9, 0.4, dim, 1, 9.81 * 2, 0.2, 0, 1);
    }
  }
  /** Вспышка чужого орудия с клубом дыма. */
  function gunFlash(x, y, z, sc) {
    particles.emit(PK.GLOW, x, y, z, 0, 0, 0, 34 * sc, 0.4, 0.3, 2, 1.5, 0.8, 1, 1, 0, 0, 0, 1);
    smokeCol(_c2, 0.75);
    for (let i = 0; i < 3; i++)
      particles.emit(PK.SMOKE, x + (R() - 0.5) * 8 * sc, y + 2 * sc, z + (R() - 0.5) * 8 * sc, 0, 2 * sc, 0, 14 * sc, 2.2, 3 + R() * 2, _c2.r, _c2.g, _c2.b, 0.6, 0, 0, 0.5, 1);
  }

  // ---- состояние кадра ----
  const firedSeen = new Map();       // id цели → firedAt, вспышку которого уже показали
  let lightningT = 99, lightningNext = 6, bx = 0, by = 0;
  const _v = new THREE.Vector3(), _w = new THREE.Vector3();
  let curPlace = null;

  function placeShip(o, g, friendly) {
    const dxk = o.x - bx, dyk = o.y - by, b = Math.atan2(dxk, dyk) / DEG, isLand = g.userData.land;
    g.position.set(dxk * 1000, isLand ? Math.max(1, landHeight(b, Math.hypot(dxk, dyk) * 1000)) : 0, -dyk * 1000);
    g.rotation.set(0, (isLand ? -90 - b : 90 - o.heading) * DEG, 0);
    g.scale.setScalar(EX * (opts.shipScale ? opts.shipScale(Math.hypot(dxk, dyk), g) : 1));
    g.userData.night = !!(look && look.night);
    return curPlace ? curPlace(o, g, friendly, b) : true;
  }
  function placePlane(p, g, down) {
    const el = p.elevation * PEL * (1 - 0.8 * down * (PEL < 1 ? 1 : 0)), r = p.range * 1000;
    const hd = r * Math.cos(el * DEG), alt = r * Math.sin(el * DEG) * (PEL < 1 ? 1 : 1 - down);
    g.position.set(Math.sin(p.bearing * DEG) * hd, EYE + alt, -Math.cos(p.bearing * DEG) * hd);
    g.rotation.set(0, (90 - (p.attacked ? p.bearing : p.bearing + 180)) * DEG, 0);
    g.scale.setScalar(opts.planeScale ? opts.planeScale(p) : 6);
    return true;
  }

  const out = {
    scene, camera, info, particles, fleet, wing, sky, sea, uniforms: U, seaUniforms: seaU,
    get look() { return look; }, wind,
    landHeight,
    /** Обновить мир по game.state. place(o, g, friendly, bearing) — доп. решение поста (false — скрыть). */
    sync(dt, vt, place) {
      const s = game.state, m = s.mission;
      if (!m || !m.battery) return false;
      bx = m.battery.x; by = m.battery.y;
      const L = lookFor(m);
      if (L !== look) applyLook(L);
      if (m.wind !== out._windRef) { out._windRef = m.wind; applyWind(); }
      buildLand();
      U.uTime.value = vt;
      const cs = (look.storm ? 0.012 : 0.004) * (1 + wind.speed / 8);
      U.uCloudOff.value.set(look.cloudSeed + wind.x * vt * cs, look.cloudSeed * 0.7 + wind.z * vt * cs);
      rainU.uTime.value = vt;
      // молнии в шторм: редкие двойные вспышки в случайной стороне
      if (look.storm) {
        lightningT += dt;
        if (lightningT > lightningNext) {
          lightningT = 0; lightningNext = 5 + 9 * hash(Math.floor(vt * 3.1));
          const a = R() * Math.PI * 2; U.uFlashDir.value.set(Math.sin(a), 0.25, -Math.cos(a)).normalize();
        }
        const t = lightningT, f = t < 0.08 ? 1 : t < 0.16 ? 0.25 : t < 0.24 ? 0.85 : Math.max(0, 0.85 - (t - 0.24) * 2.5);
        U.uFlash.value = f * (look.night ? 1.4 : 0.9);
        info.lightning = U.uFlash.value;
      } else U.uFlash.value = 0;
      hemi.intensity = ((look.night ? 1.1 : 2.3) * (look.night ? 1 : look.ambient)) * (1 + U.uFlash.value * 1.5);

      // частицы: шаг
      particles.update(dt, wind.x * wind.speed, wind.z * wind.speed);
      particles.clearImmediate();

      // корабли и самолёты
      curPlace = place || null;
      fleet.sync(dt, vt, placeShip);
      wing.sync(dt, vt, placePlane);

      // вспышки чужих орудий (target.firedAt) — один раз на выстрел
      for (const t of s.targets || []) {
        if (t.firedAt == null || t.sunk || t.escaped) continue;
        if (firedSeen.get(t.id) === t.firedAt) continue;
        firedSeen.set(t.id, t.firedAt);
        const age = s.time - t.firedAt;
        if (age < 0 || age > 0.6) continue;
        const en = fleet.entries.get(t.id), g = en && en.group;
        if (g && g.visible && g.userData.muzzles && g.userData.muzzles.length) {
          const mz = g.userData.muzzles[Math.floor(R() * g.userData.muzzles.length)];
          g.localToWorld(_v.set(mz[0], mz[1], mz[2]));
          gunFlash(_v.x, _v.y, _v.z, EX);
        } else {
          _v.set((t.x - bx) * 1000, 12, -(t.y - by) * 1000);
          gunFlash(_v.x, _v.y, _v.z, EX);
        }
      }

      // «люстры»: огонь на парашюте, свет на воде, кораблях и в дымке
      let nf = 0;
      const ls = s.lights || [];
      for (let i = 0; i < 4; i++) flareU.value[i].set(0, 0, 0, 0);
      for (let i = 0; i < ls.length && nf < 4; i++) {
        const l = ls[i], left = clamp((l.until - s.time) / 60, 0, 1);
        const fl = 0.85 + 0.15 * Math.sin(vt * 17 + l.n) * Math.sin(vt * 7.3), k = Math.min(1, left * 12) * fl;
        const x = (l.x - bx) * 1000, z = -(l.y - by) * 1000, y = 60 + 260 * left;
        flareU.value[nf].set(x, y, z, k * (look.night ? 1 : 0.35));
        if (nf < 2) { flareL[nf].position.set(x, y, z); flareL[nf].intensity = k * (look.night ? 2000 : 600); }
        const d = Math.hypot(x, z), px = d * (U.uPixAng.value || 0.001);
        particles.put(PK.GLOW, x, y, z, Math.max(40 * EX * 0.6, px * 9), 1.9 * k, 1.75 * k, 1.4 * k, 1, 1);
        particles.put(PK.GLOW, x, y, z, Math.max(140 * EX * 0.6, px * 30), 0.5 * k, 0.42 * k, 0.28 * k, 1, 1);
        if (R() < dt * 6) { smokeCol(_c2, 0.6); particles.emit(PK.SMOKE, x, y + 6, z, 0, 3, 0, 10 * EX, 2, 4, _c2.r, _c2.g, _c2.b, 0.3, 0, 0, 0.4, 1); }
        nf++;
      }
      for (let i = nf; i < 2; i++) flareL[i].intensity = 0;
      out.flares = nf;

      // дымзавесы: валы клубов поперёк линии «батарея — завеса», подпитываются, пока стоят
      let ns = 0;
      for (const q2 of s.smokes || []) {
        const left = q2.until - s.time, k = clamp(left / 6, 0, 1) * clamp((60 - left) / 4 + 0.25, 0, 1);
        if (k <= 0.02) continue;
        ns++;
        const x = (q2.x - bx) * 1000, z = -(q2.y - by) * 1000, d = Math.max(1, Math.hypot(x, z)), pxv = -z / d, pzv = x / d;
        const rate = dt * 7 * k;
        for (let j = 0; j < 3; j++) if (R() < rate) {
          const o = (R() - 0.5) * 900, h = R();
          smokeCol(_c2, look.night ? 0.35 : 0.86);
          particles.emit(PK.SMOKE, x + pxv * o + (R() - 0.5) * 80, 30 + h * 90, z + pzv * o + (R() - 0.5) * 80, (R() - 0.5) * 2, 1.5 + R(), (R() - 0.5) * 2,
            130 + 90 * R(), 0.8, 10 + 6 * R(), _c2.r, _c2.g, _c2.b, 0.55 * k, 0, 0, 0.12, 1);
        }
      }
      out.smokes = ns;

      // всплески и пена
      let live = 0;
      for (const sp of splashes) if (sp.live) { if ((sp.t += dt) > (opts.splashLife || 3.4)) sp.live = false; else live++; }
      out.splashes = live;
      let nfoam = 0;
      const PU = seaU.uPatch.value;
      for (let i = 0; i < 6; i++) {
        const p = patches[i];
        if (p.t < p.life) { p.t += dt; const k = p.k * clamp(p.t * 3, 0, 1) * (1 - p.t / p.life); PU[i].set(p.x, p.z, p.r * (1 + p.t * 0.12), k); nfoam++; }
        else PU[i].set(0, 0, 1, 0);
      }
      info.foam = nfoam;
      // тонущие: пена и пузыри у борта
      fleet.entries.forEach((en) => {
        const g = en.group, st = g.userData.state;
        if (!g.visible || g.userData.land || !(st.sinking > 0)) return;
        if (R() < dt * 1.5) addPatch(g.position.x, g.position.z, g.userData.size.length * EX * 0.45, 5, 0.6);
      });
      return true;
    },
    /**
     * Разрыв своего снаряда (событие impact). rule(d, dark, isLand) → false — вид его не показывает.
     * → true, если показан (для счётчиков постов).
     */
    impact(e, rule) {
      const s = game.state, m = s.mission;
      if (!e || !m || !m.battery || e.x == null || e.shell === 'illum') return false;
      const dxk = e.x - m.battery.x, dyk = e.y - m.battery.y, d = Math.max(0.3, Math.hypot(dxk, dyk));
      let lit = false, isL = false;
      try { lit = !!game.lit(e.x, e.y); } catch (err) { lit = false; }
      try { isL = !!game.isLand(e.x, e.y); } catch (err) { isL = false; }
      const dark = !!m.night && !lit;
      if (rule && rule(d, dark, isL, dxk, dyk) === false) return false;
      const hit = !!(e.hits && e.hits.length);
      const kind = e.shell === 'smoke' ? 'puff' : hit ? 'hit' : isL ? 'land' : 'water';
      let dim = dark ? 0.35 : 1;
      if (m.weather === 'fog') dim *= clamp(1.25 - d / 9, 0.3, 1);
      let sp = splashes[0];
      for (const c of splashes) { if (!c.live) { sp = c; break; } if (c.t > sp.t) sp = c; }
      sp.live = true; sp.t = 0; sp.kind = kind; sp.dim = dim; sp.x = dxk * 1000; sp.z = -dyk * 1000;
      const x = sp.x, z = sp.z, sc = EX * (opts.fxScale ? opts.fxScale(d) : 1);
      if (kind === 'water') waterColumn(x, z, sc, dim);
      else if (kind === 'puff') {
        smokeCol(_c2, 0.9);
        for (let i = 0; i < 8; i++) particles.emit(PK.SMOKE, x + (R() - 0.5) * 40 * sc, 10 + 20 * R() * sc, z + (R() - 0.5) * 40 * sc, (R() - 0.5) * 6, 4 + 3 * R(), (R() - 0.5) * 6, 30 * sc, 2.5, 5 + 2 * R(), _c2.r, _c2.g, _c2.b, 0.7 * dim, 0, 0, 0.3, 1);
        addPatch(x, z, 30 * sc, 5, 0.3);
      } else {
        const g = hit ? null : null;
        const y = isL ? Math.max(2, landHeight(Math.atan2(dxk, dyk) / DEG, d * 1000)) : 4;
        burst(x, y, z, sc, dim, hit);
        if (!isL) addPatch(x, z, 30 * sc, 6, 0.5 * dim);
        void g;
      }
      return true;
    },
    /** Дульная вспышка и дым своих стволов перед камерой: o = { twin, drift (м/с поперёк), dist (м), side (м) }. */
    muzzle(o) {
      const fw = _v.set(0, 0, -1).applyQuaternion(camera.quaternion); fw.y = 0; fw.normalize();
      const rt = _w.set(-fw.z, 0, fw.x);
      const srcs = o.twin ? [-1, 1] : [-1];
      const L = look, night = L && L.night;
      for (const sd of srcs) {
        const d = o.dist || 60, sx = rt.x * sd * (o.side || 14), sz = rt.z * sd * (o.side || 14);
        const x = fw.x * d + sx, z = fw.z * d + sz, y = EYE - (o.below || 8);
        particles.emit(PK.GLOW, x, y, z, 0, 0, 0, d * 1.2, 0.8, 0.32, 2, 1.55, 0.85, 1, 1, 0, 0, 0, 1);
        for (let i = 0; i < 3; i++) particles.emit(PK.SMOKE, x + fw.x * i * 20, y + 2, z + fw.z * i * 20, fw.x * (30 + 30 * R()), 2 + 4 * R(), fw.z * (30 + 30 * R()),
          d * 0.5, 1.2, 0.45 + 0.2 * R(), 1.8, 1.0, 0.45, 0.9, 2, 0, 1.2, 0, 1);
        smokeCol(_c2, night ? 0.3 : 0.5);
        for (let i = 0; i < 7; i++) {
          const k = i / 6;
          particles.emit(PK.SMOKE, x + fw.x * (10 + 70 * k) + (R() - 0.5) * 16, y + R() * 6, z + fw.z * (10 + 70 * k) + (R() - 0.5) * 16,
            fw.x * (8 + 10 * R()) + rt.x * (o.drift || 0), 1.5 + 2 * R(), fw.z * (8 + 10 * R()) + rt.z * (o.drift || 0),
            d * (0.38 + 0.25 * R()), 2.2, 3.6 + R() * 1.2, _c2.r, _c2.g, _c2.b, 0.75, 0, 0, 0.25, 0.8);
        }
      }
    },
    /** Свой снаряд в полёте: светящаяся трасса (щель). f — запись game.state.flight. */
    tracer(f, vt) {
      const s = game.state, m = s.mission;
      if (!f || f.t > 2.4 || f.shell === 'smoke') return;
      const dx = (f.x - m.battery.x) * 1000, dz = -(f.y - m.battery.y) * 1000, D = Math.hypot(dx, dz);
      if (D < 1) return;
      const u = clamp(f.t / Math.max(1, f.tof), 0, 1), apex = D * Math.tan((f.elevation || 3) * DEG) / 4;
      const k = 1 - clamp((f.t - 1.6) / 0.8, 0, 1);
      for (let j = 0; j < 3; j++) {
        const uu = Math.max(0, u - j * 0.006), h = 4 * apex * uu * (1 - uu) + EYE - 4;
        const x = dx * uu, z = dz * uu, dd = Math.max(50, Math.hypot(x, z, h - EYE)), px = dd * (U.uPixAng.value || 0.001);
        particles.put(PK.GLOW, x, h, z, px * (j ? 3.5 : 6), 2 * k / (1 + j), 1.3 * k / (1 + j), 0.6 * k / (1 + j), 1, 1);
      }
      void vt;
    },
    /** Огни кораблей ночью и прочее разовое — сам флот (ships.js); здесь — запись буферов и отрисовка в rt. */
    render(rt, pixAng) {
      U.uPixAng.value = pixAng;
      // туман моделей — в цвет горизонта по оси камеры
      const fw = _v.set(0, 0, -1).applyQuaternion(camera.quaternion);
      skyBaseJS(look, fw.x, 0, fw.z, scene.fog.color);
      particles.uniforms.uFogCol.value.copy(scene.fog.color);
      sky.position.copy(camera.position); sea.position.set(camera.position.x, 0, camera.position.z);
      info.particles = particles.write();
      const r = engine.renderer, prev = r.getRenderTarget();
      r.setRenderTarget(rt);
      r.render(scene, camera);
      r.setRenderTarget(prev);
    },
    reset() {
      for (const sp of splashes) sp.live = false;
      for (const p of patches) p.life = 0;
      particles.clear(); fleet.clear(); wing.clear(); land.reset(); landFor = null; firedSeen.clear(); out._windRef = null;
    },
    setQuality(nq) {
      q = nq;
      particles.budget = PMAX[q.tier] / PMAX.high || 1;
      sky.material.dispose(); sky.material = skyMaterial(skyU, q);
      sea.material.dispose(); sea.material = seaMaterial(seaU, q);
      out._windRef = null;
    },
    dispose() {
      fleet.clear(); wing.clear(); particles.dispose();
      if (landMesh) landMesh.geometry.dispose();
      for (const o of [sky.geometry, sky.material, seaGeo, sea.material, landMat, rain.geometry, rain.material]) o.dispose();
    },
    flares: 0, smokes: 0, splashes: 0,
  };
  return out;
}

// ---------------------------------------------------------------- зенитка --------------------------------------------
/**
 * Небо и море «по углам» для плоскости за проёмом зенитки: каждый пиксель → пеленг/угол места → то же небо, что в щели
 * и трубе (общие униформы). Униформы поста: uAim (пеленг, угол места, °), uM (м плоскости на градус), uEye (м над водой).
 */
export function createSkyPlaneMaterial(q) {
  const u = Object.assign(createSkyUniforms(), {
    uAim: { value: new THREE.Vector2() }, uM: { value: 0.02 }, uEye: { value: 18 },
    uSea: { value: new THREE.Color() }, uSss: { value: new THREE.Color() }, uLight: { value: 1 }, uFogDen: { value: 3e-5 },
    uBomb: { value: 0 },
  });
  const m = new THREE.ShaderMaterial({
    uniforms: u, defines: { OCT: octFor(q) }, toneMapped: false, fog: false,
    vertexShader: 'varying vec2 vXY; void main(){ vXY = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`${GLSL.skyUniforms}${GLSL.noise}${GLSL.sky}
      uniform vec2 uAim; uniform float uM; uniform float uEye; uniform vec3 uSea; uniform vec3 uSss; uniform float uLight; uniform float uFogDen;
      varying vec2 vXY;
      const float D2R = 0.0174533;
      void main() {
        float e = uAim.y + vXY.y / uM;
        float ce = max(cos(e * D2R), 0.08);
        float b = uAim.x + vXY.x / (uM * ce);
        vec3 d = vec3(sin(b * D2R) * cos(e * D2R), sin(e * D2R), -cos(b * D2R) * cos(e * D2R));
        vec3 c;
        if (e >= 0.0) c = skyFull(d);
        else {
          float dist = uEye / max(-d.y, 1e-4);
          vec2 P = d.xz * dist;
          float ph = dot(P, vec2(0.08, 0.05)) - uTime * 1.2;
          vec3 n = normalize(vec3(0.06 * cos(ph) + 0.04 * (vnoise(P * 0.2 + uTime * 0.3) - 0.5), 1.0, 0.05 * sin(ph * 1.3)));
          vec3 V = -d; float cosT = max(dot(n, V), 0.0), F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
          vec3 R = reflect(d, n); R.y = abs(R.y);
          vec3 refl = mix(skyBase(R), mix(uCloudShade, uCloudLit, 0.6), uCloud * 0.5);
          c = mix(uSea * uLight, refl, F);
          vec3 H = normalize(uSunDir + V); float nh = max(dot(n, H), 0.0);
          c += uSunCol * uSunI * pow(nh, 300.0) * 2.0 * (1.0 - uCloud * 0.8);
          float fogF = 1.0 - exp(-uFogDen * uFogDen * dist * dist);
          c = mix(c, skyBase(vec3(d.x, 0.0, d.z)), max(fogF, smoothstep(-1.0, 0.0, e) * 0.6));
        }
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  m.userData.setLook = (L) => {
    applyLookUniforms(u, L);
    u.uSea.value.copy(L.sea); u.uSss.value.copy(L.sss); u.uLight.value = L.night ? 0.5 : L.ambient; u.uFogDen.value = L.fogDensity;
  };
  m.userData.setQuality = (nq) => { if (m.defines.OCT !== octFor(nq)) { m.defines.OCT = octFor(nq); m.needsUpdate = true; } };
  return m;
}

/**
 * Вершинные цвета, освещённые «небом задания»: окружающий свет (зенит/море) и солнце из униформы uSun (направление в мировых
 * координатах ОСНОВНОЙ сцены — пост пересчитывает его из своего вида). Свет помещения на них не действует.
 */
export function createLitColorMaterial() {
  const u = { uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uSky: { value: new THREE.Color(0.6, 0.65, 0.7) },
    uGround: { value: new THREE.Color(0.2, 0.22, 0.25) }, uHaze: { value: new THREE.Color(0.8, 0.85, 0.9) }, uHazeK: { value: 0 }, uHot: { value: 0 } };
  const m = new THREE.ShaderMaterial({
    uniforms: u, vertexColors: true, toneMapped: false, fog: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vCol;
      void main(){ vN = normalize(mat3(modelMatrix) * normal); vCol = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uSky; uniform vec3 uGround; uniform vec3 uHaze; uniform float uHazeK;
      varying vec3 vN; varying vec3 vCol;
      void main(){
        vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
        vec3 amb = mix(uGround, uSky, n.y * 0.5 + 0.5);
        vec3 c = vCol * (amb + uSunCol * max(dot(n, uSun), 0.0));
        c = mix(c, uHaze, uHazeK);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  m.userData.setLook = (L) => {
    u.uSunCol.value.copy(L.sunColor).multiplyScalar(L.night ? 0.25 : L.sunI * 0.32);
    u.uSky.value.copy(L.zenith).lerp(C_WHITE, 0.45).multiplyScalar(L.night ? 0.25 : 0.62 * L.ambient);
    u.uGround.value.copy(L.sea).lerp(L.horizon, 0.4).multiplyScalar(L.night ? 0.3 : 0.75);
    u.uHaze.value.copy(L.horizon);
  };
  return m;
}
