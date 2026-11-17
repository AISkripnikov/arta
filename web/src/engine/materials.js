// engine.mat — библиотека материалов (DESIGN §5.2). Все материалы кэшируются:
// одинаковые вызовы возвращают один и тот же объект. Процедурные текстури создаются лениво, один раз.
import * as THREE from 'three';
import { makeCanvas, canvasTexture, mulberry32, fbm, tileNoise, normalMapFromHeight, glowCanvas } from './textures.js';

export const PALETTE = {
  panel: '#3d4a57', panelDark: '#2b343d', frame: '#1d2329', floor: '#15191d',
  ochre: '#d39a1e', bakelite: '#16171a', nickel: '#b9c0c4',
  ivory: '#e8e0c8', ink: '#1a1a1a', redZone: '#c0392b',
  copper: '#b06a3c', steel: '#59636d',
  lampGreen: '#4be36a', lampRed: '#ff4a3a', lampAmber: '#ffb347', lampWhite: '#fff3d6',
  plateBlack: '#111316', plateRed: '#8f1d14',
  drumDigit: '#f2efe6', drum: '#0c0d0e',
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

const WEAR_BASE = 0.86;                                   // базовая яркость карты износа (sRGB)
const WEAR_BASE_LIN = Math.pow((WEAR_BASE + 0.055) / 1.055, 2.4);
const WEAR_REPEAT = 0.8;                                  // метров на повтор текстуры краски

function grayCanvas(size, data /* Float32 0..1 */) {
  const c = makeCanvas(size, size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  for (let i = 0; i < data.length; i++) {
    const v = Math.max(0, Math.min(255, data[i] * 255));
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Карта износа краски: [цвет (множитель), ORM (G — шероховатость, B — металличность)]. */
function makeWear(level, seed) {
  const S = 512, rnd = mulberry32(seed);
  const big = fbm(S, 3, 3, 4, rnd);               // крупные пятна выгорания/грязи
  const mid = fbm(S, 12, 12, 3, rnd);
  const fine = fbm(S, 56, 56, 2, rnd);            // мелкие сколы
  const streak = fbm(S, 40, 2, 2, rnd);           // вертикальные потёки
  const grit = tileNoise(S, 256, 256, rnd);
  const col = makeCanvas(S, S), orm = makeCanvas(S, S);
  const cc = col.getContext('2d'), oc = orm.getContext('2d');
  const ci = cc.createImageData(S, S), oi = oc.createImageData(S, S);
  const thr = 0.80 - 0.07 * level;                // порог скола: чем изношеннее, тем их больше
  for (let i = 0; i < S * S; i++) {
    let v = WEAR_BASE + (big[i] - 0.5) * (0.10 + 0.10 * level) + (mid[i] - 0.5) * 0.05 + (grit[i] - 0.5) * 0.03;
    const drip = Math.max(0, streak[i] - 0.6) * (0.12 + 0.3 * level);
    v -= drip;
    let rough = 0.6 + (big[i] - 0.5) * 0.22 + (mid[i] - 0.5) * 0.12 + drip * 0.6, metal = 0.08;
    const chip = fine[i] * 0.62 + mid[i] * 0.38;
    if (chip > thr) {                              // скол до металла — мелкий и светлый
      const e = Math.min(1, (chip - thr) / 0.015);
      v = v * (1 - e) + (0.99 + (grit[i] - 0.5) * 0.06) * e;
      rough = rough * (1 - e) + 0.42 * e; metal = 0.08 + 0.4 * e;
    } else if (chip > thr - 0.012) {               // тонкая тёмная кромка скола
      v *= 0.93;
    }
    const k = i * 4;
    ci.data[k] = ci.data[k + 1] = ci.data[k + 2] = Math.max(0, Math.min(255, v * 255)); ci.data[k + 3] = 255;
    oi.data[k] = 255; oi.data[k + 1] = Math.max(0, Math.min(255, rough * 255)); oi.data[k + 2] = metal * 255; oi.data[k + 3] = 255;
  }
  cc.putImageData(ci, 0, 0); oc.putImageData(oi, 0, 0);
  // царапины (с заворотом через края)
  const n = Math.round(6 + 34 * level);
  for (let s = 0; s < n; s++) {
    const x = rnd() * S, y = rnd() * S, a = (rnd() - 0.5) * 1.2 + (rnd() < 0.5 ? 0 : Math.PI / 2), len = 8 + rnd() * 46;
    const dx = Math.cos(a) * len, dy = Math.sin(a) * len, al = 0.08 + rnd() * 0.2;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      if (x + ox + Math.abs(dx) < -4 || x + ox - Math.abs(dx) > S + 4 || y + oy + Math.abs(dy) < -4 || y + oy - Math.abs(dy) > S + 4) continue;
      cc.strokeStyle = 'rgba(255,255,255,' + al.toFixed(3) + ')'; cc.lineWidth = 0.6 + rnd() * 0.6;
      cc.beginPath(); cc.moveTo(x + ox, y + oy); cc.lineTo(x + ox + dx, y + oy + dy); cc.stroke();
      oc.strokeStyle = 'rgba(255,110,90,' + (al * 0.8).toFixed(3) + ')'; oc.lineWidth = 1;
      oc.beginPath(); oc.moveTo(x + ox, y + oy); oc.lineTo(x + ox + dx, y + oy + dy); oc.stroke();
    }
  }
  return [col, orm];
}

/** Шлифованная сталь: продольные штрихи. */
function makeBrushed(seed) {
  const S = 256, rnd = mulberry32(seed);
  const a = fbm(S, 2, 128, 2, rnd), b = fbm(S, 4, 4, 3, rnd);
  const d = new Float32Array(S * S);
  for (let i = 0; i < d.length; i++) d[i] = 0.88 + (a[i] - 0.5) * 0.12 + (b[i] - 0.5) * 0.08;
  return grayCanvas(S, d);
}

/** Рифлёный настил («чечевица»): [цвет, карта нормалей]. */
function makeFloor(seed) {
  const S = 512, rnd = mulberry32(seed), N = 8, cell = S / N;
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = Math.floor(x / cell), j = Math.floor(y / cell);
    const u = (x + 0.5) / cell - i - 0.5, v = (y + 0.5) / cell - j - 0.5;
    const s = (i + j) % 2 ? 1 : -1;
    const ur = (u + s * v) * 0.7071, vr = (-s * u + v) * 0.7071;
    const d = (ur / 0.40) * (ur / 0.40) + (vr / 0.115) * (vr / 0.115);
    h[y * S + x] = d < 1 ? Math.pow(1 - d, 0.6) : 0;
  }
  const grime = fbm(S, 4, 4, 4, rnd), grit = tileNoise(S, 200, 200, rnd);
  const col = makeCanvas(S, S), cc = col.getContext('2d'), img = cc.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    let v = 0.62 + (grime[i] - 0.5) * 0.38 + (grit[i] - 0.5) * 0.06;
    v = v * (1 - h[i] * 0.2) + h[i] * 0.34;        // вершины рифления вытерты до блеска
    const k = i * 4, c = Math.max(0, Math.min(255, v * 255));
    img.data[k] = c; img.data[k + 1] = c; img.data[k + 2] = c; img.data[k + 3] = 255;
  }
  cc.putImageData(img, 0, 0);
  // швы листов по краям плитки и болты в углах
  cc.strokeStyle = 'rgba(0,0,0,0.75)'; cc.lineWidth = 5; cc.strokeRect(0, 0, S, S);
  cc.strokeStyle = 'rgba(255,255,255,0.10)'; cc.lineWidth = 1.5; cc.strokeRect(5, 5, S - 10, S - 10);
  return [col, normalMapFromHeight(h, S, 2.4)];
}

export function createMaterials() {
  const cache = new Map();
  const memo = (key, make) => {
    let m = cache.get(key);
    if (!m) { m = make(); m.name = m.name || key; cache.set(key, m); }
    return m;
  };
  const texCache = new Map();
  const tex = (key, make) => { let t = texCache.get(key); if (!t) { t = make(); texCache.set(key, t); } return t; };

  const wearTex = (lvl) => tex('wear' + lvl, () => {
    const [col, orm] = makeWear([0.2, 0.5, 0.85][lvl], 1234 + lvl * 77);
    return { map: canvasTexture(col, { repeat: true }), orm: canvasTexture(orm, { srgb: false, repeat: true }) };
  });
  const brushed = () => tex('brushed', () => canvasTexture(makeBrushed(99), { repeat: true }));
  const floorTex = () => tex('floor', () => {
    const [col, nrm] = makeFloor(4242);
    return { map: canvasTexture(col, { repeat: true, aniso: 8 }), normal: canvasTexture(nrm, { srgb: false, repeat: true, aniso: 8 }) };
  });

  function painted(key, hex, wear, extra = {}) {
    return memo(key, () => {
      const lvl = wear < 0.34 ? 0 : wear < 0.7 ? 1 : 2;
      const t = wearTex(lvl);
      const color = toColor(hex).multiplyScalar(1 / WEAR_BASE_LIN);
      return new THREE.MeshStandardMaterial(Object.assign({
        color, map: t.map, roughnessMap: t.orm, metalnessMap: t.orm, roughness: 1, metalness: 1,
      }, extra));
    });
  }

  const mat = {
    PALETTE,
    /** Метров на один повтор текстуры краски (для boxUV). */
    WEAR_REPEAT,

    /** Крашеный металл с потёртостями. wear 0..1 (три ступени: <0.34, <0.7, выше). */
    paint(hex = PALETTE.panel, opts = {}) {
      const wear = opts.wear == null ? 0.5 : opts.wear;
      const c = toColor(hex);
      const lvl = wear < 0.34 ? 0 : wear < 0.7 ? 1 : 2;
      return painted('paint:' + c.getHexString() + ':' + lvl, c, wear);
    },

    /** Самосветящийся материал (не зависит от освещения). intensity > 1 — «пересвет» для ламп. */
    emissive(hex = PALETTE.lampWhite, intensity = 1) {
      const c = toColor(hex);
      return memo('emissive:' + c.getHexString() + ':' + (+intensity).toFixed(3), () =>
        new THREE.MeshBasicMaterial({ color: c.multiplyScalar(intensity) }));
    },

    get steel() {
      return memo('steel', () => new THREE.MeshStandardMaterial({ color: 0xa4acb3, map: brushed(), roughness: 0.42, metalness: 0.92 }));
    },
    get darkSteel() {
      return memo('darkSteel', () => new THREE.MeshStandardMaterial({ color: 0x444c55, map: brushed(), roughness: 0.55, metalness: 0.8 }));
    },
    get nickel() {
      return memo('nickel', () => new THREE.MeshStandardMaterial({ color: toColor(PALETTE.nickel).multiplyScalar(1.25), roughness: 0.24, metalness: 1 }));
    },
    get bakelite() {
      return memo('bakelite', () => new THREE.MeshStandardMaterial({ color: toColor(PALETTE.bakelite), roughness: 0.42, metalness: 0.0, envMapIntensity: 0.55 }));
    },
    get ivory() {
      return memo('ivory', () => new THREE.MeshStandardMaterial({ color: toColor(PALETTE.ivory), roughness: 0.55, metalness: 0.0 }));
    },
    get copper() {
      return memo('copper', () => new THREE.MeshStandardMaterial({ color: toColor(PALETTE.copper).multiplyScalar(1.1), map: brushed(), roughness: 0.42, metalness: 1 }));
    },
    get rubber() {
      return memo('rubber', () => new THREE.MeshStandardMaterial({ color: 0x101112, roughness: 0.88, metalness: 0.0 }));
    },
    get glass() {
      return memo('glass', () => new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.16, depthWrite: false, envMapIntensity: 2.2,
      }));
    },
    /** Охристая эмаль маховиков и рукоятей приводов. */
    get ochre() {
      return painted('ochre', PALETTE.ochre, 0.2, { roughness: 0.8 });
    },
    get floor() {
      return memo('floor', () => {
        const t = floorTex();
        return new THREE.MeshStandardMaterial({
          color: toColor(PALETTE.floor).multiplyScalar(3.2), map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(1, 1),
          roughness: 0.5, metalness: 0.75,
        });
      });
    },
    get wall() {
      return painted('wall', PALETTE.frame, 0.85);
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
    /** Линза лампы: потушенная/горящая (общие на цвет). */
    lens(hex, on) {
      const c = toColor(hex);
      return memo('lens:' + c.getHexString() + ':' + (on ? 1 : 0), () => on
        ? new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.6), emissive: c, emissiveIntensity: 1.7, roughness: 0.25, metalness: 0 })
        : new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.22), emissive: c, emissiveIntensity: 0.03, roughness: 0.16, metalness: 0 }));
    },
    /** Общий кэш для материалов, создаваемых модулями движка. */
    memo,
    dispose() {
      cache.forEach(m => m.dispose());
      texCache.forEach(t => { if (t.isTexture) t.dispose(); else Object.values(t).forEach(x => x.dispose && x.dispose()); });
      cache.clear(); texCache.clear();
    },
  };
  return mat;
}
