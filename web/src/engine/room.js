// Круглое помещение башни (DESIGN §4): стена с рёбрами и заклёпками, настил, потолок с балками,
// трубопроводы, плафоны в решётках, вентили и кабельные коробки в простенках между постами.
// Вся статика слита по материалам (≈10 мешей) — дёшево в отрисовке. Секторы постов свободны:
// декор стены занимает не более ~0.1 м от стены.
import * as THREE from 'three';
import { merge, xf, rivetGeometry, rod, boxUV, lathe, pipeGeometry } from './geom.js';
import { cageLampParts, valveWheelGeometry } from './controls/decor.js';

export const ROOM = { radius: 3.0, height: 2.6, ring: 2.05, slots: 6 };

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const POOL = 0.15;            // яркость «пятен света» от плафонов

/** Ставит геометрию, построенную «лицом в +Z» в начале координат, на стену: угол theta, радиус r, высота y. */
function place(g, theta, r, y) {
  g.rotateY(-theta);
  g.translate(r * Math.sin(theta), y, -r * Math.cos(theta));
  return g;
}
const polar = (r, theta, y) => [r * Math.sin(theta), y, -r * Math.cos(theta)];

export function createRoom(engine) {
  const { mat } = engine;
  const R = ROOM.radius, H = ROOM.height;
  const group = new THREE.Group();
  group.name = 'room';

  const wallParts = [], steelParts = [], copperParts = [], ochreParts = [], rubberParts = [], darkParts = [], bulbParts = [];

  // ---------- стена: тело вращения (обращено внутрь) с поясами ----------
  {
    const prof = [                       // [r, y] сверху вниз → нормали внутрь
      [R, H], [R, 2.44], [R, 2.44], [R - 0.11, 2.44], [R - 0.11, 2.44], [R - 0.11, 2.33], [R - 0.11, 2.33], [R, 2.30], [R, 2.30],
      [R, 1.90], [R, 1.90], [R - 0.014, 1.90], [R - 0.014, 1.90], [R - 0.014, 1.78], [R - 0.014, 1.78], [R, 1.78], [R, 1.78],
      [R, 0.98], [R, 0.98], [R - 0.014, 0.98], [R - 0.014, 0.98], [R - 0.014, 0.86], [R - 0.014, 0.86], [R, 0.86], [R, 0.86],
      [R, 0.17], [R, 0.17], [R - 0.05, 0.15], [R - 0.05, 0.15], [R - 0.05, 0],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const SEG = 96;
    const g = new THREE.LatheGeometry(prof, SEG);
    // UV в метрах: по окружности и по высоте
    const uv = g.attributes.uv, pos = g.attributes.position, n = prof.length;
    const rep = (TAU * R) / 24;
    for (let i = 0; i <= SEG; i++) for (let j = 0; j < n; j++) {
      const k = i * n + j;
      uv.setXY(k, (i / SEG) * 24, pos.getY(k) / rep);
    }
    wallParts.push(g);
  }

  // ---------- рёбра набора (24 шт., между осями постов) с заклёпками ----------
  const ribAngles = [];
  for (let k = 0; k < 24; k++) ribAngles.push((7.5 + 15 * k) * DEG);
  for (const th of ribAngles) {
    const web = new THREE.BoxGeometry(0.05, 2.13, 0.075); boxUV(web, mat.WEAR_REPEAT);
    wallParts.push(place(web, th, R - 0.036, 0.17 + 2.13 / 2));
    const flange = new THREE.BoxGeometry(0.15, 2.13, 0.012); boxUV(flange, mat.WEAR_REPEAT);
    wallParts.push(place(flange, th, R - 0.005, 0.17 + 2.13 / 2));
    for (let y = 0.28; y < 2.3; y += 0.185) for (const sx of [-0.052, 0.052]) {
      wallParts.push(place(xf(rivetGeometry(0.011, 5), { p: [sx, 0, 0] }), th, R - 0.012, y));
    }
  }
  // заклёпки вдоль горизонтальных поясов обшивки
  for (const y of [1.81, 1.87, 0.89, 0.95]) {
    const N = 132;
    for (let i = 0; i < N; i++) {
      const th = (i + 0.5) / N * TAU;
      // пропускаем места под рёбрами
      const m = ((th / DEG - 7.5) % 15 + 15) % 15;
      if (m < 2.2 || m > 12.8) continue;
      wallParts.push(place(rivetGeometry(0.009, 5), th, R - 0.014, y));
    }
  }

  // ---------- потолок: диск, радиальные балки, центральное кольцо ----------
  {
    const disc = new THREE.CircleGeometry(R, 48); disc.rotateX(Math.PI / 2); disc.translate(0, H, 0);
    const p = disc.attributes.position, uv = disc.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / mat.WEAR_REPEAT, p.getZ(i) / mat.WEAR_REPEAT);
    wallParts.push(disc);
    for (let k = 0; k < 12; k++) {
      const th = (15 + 30 * k) * DEG;
      const beam = new THREE.BoxGeometry(0.1, 0.17, 2.36); boxUV(beam, mat.WEAR_REPEAT);
      // балка идёт вдоль радиуса: её длинная ось Z → после place смотрит к центру
      wallParts.push(place(beam, th, 0.6 + 2.36 / 2, H - 0.085));
      const fl = new THREE.BoxGeometry(0.2, 0.014, 2.36); boxUV(fl, mat.WEAR_REPEAT);
      wallParts.push(place(fl, th, 0.6 + 2.36 / 2, H - 0.176));
    }
    const ring = new THREE.LatheGeometry([[0.48, H], [0.48, H - 0.24], [0.48, H - 0.24], [0.66, H - 0.24], [0.66, H - 0.24], [0.66, H]]
      .map(([r, y]) => new THREE.Vector2(r, y)), 40);
    wallParts.push(ring);
    const cap = new THREE.CircleGeometry(0.48, 32); cap.rotateX(Math.PI / 2); cap.translate(0, H - 0.1, 0);
    wallParts.push(cap);
    for (let i = 0; i < 16; i++) {
      const th = i / 16 * TAU;
      const rv = rivetGeometry(0.014, 5); rv.rotateX(Math.PI / 2);     // головкой вниз
      rv.translate(0.57 * Math.sin(th), H - 0.24, -0.57 * Math.cos(th));
      wallParts.push(rv);
    }
  }

  // ---------- настил ----------
  const floorParts = [];
  {
    const rep = 0.62;
    const disc = new THREE.CircleGeometry(R, 64); disc.rotateX(-Math.PI / 2);
    const dais = new THREE.LatheGeometry([[0, 0.04], [1.02, 0.04], [1.02, 0.04], [1.07, 0.0]].map(([r, y]) => new THREE.Vector2(r, y)).reverse(), 48);
    for (const g of [disc, dais]) {
      const p = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / rep, p.getZ(i) / rep);
      floorParts.push(g);
    }
    // люк в центре: кольцо-окантовка и скоба
    const rim = new THREE.TorusGeometry(0.4, 0.014, 6, 40); rim.rotateX(Math.PI / 2); rim.translate(0, 0.045, 0);
    steelParts.push(rim);
    steelParts.push(pipeGeometry([[-0.07, 0.04, 0.2], [-0.07, 0.075, 0.2], [0.07, 0.075, 0.2], [0.07, 0.04, 0.2]], 0.008, { flanges: false, bend: 0.02, radial: 6 }));
    for (let i = 0; i < 12; i++) {
      const th = i / 12 * TAU, b = new THREE.CylinderGeometry(0.016, 0.016, 0.012, 6);
      b.translate(0.92 * Math.sin(th), 0.046, -0.92 * Math.cos(th));
      steelParts.push(b);
    }
  }

  // ---------- кольцевые трубопроводы и кабель-канал вдоль стены ----------
  const ringPipe = (radius, y, tube, parts, radial = 8) => {
    const g = new THREE.TorusGeometry(radius, tube, radial, 120); g.rotateX(Math.PI / 2); g.translate(0, y, 0);
    parts.push(g);
  };
  const Y_COPPER = 1.615, Y_CONDUIT = 1.71, Y_MAIN = 2.17;
  ringPipe(R - 0.075, Y_COPPER, 0.03, copperParts);
  ringPipe(R - 0.05, Y_CONDUIT, 0.014, darkParts, 6);
  ringPipe(R - 0.12, Y_MAIN, 0.055, steelParts);
  ringPipe(R - 0.25, H - 0.3, 0.035, copperParts);                    // под потолком
  for (const th of ribAngles) {                                        // хомуты на рёбрах
    const c1 = new THREE.BoxGeometry(0.035, 0.085, 0.1); darkParts.push(place(c1, th, R - 0.075, Y_COPPER));
    const c2 = new THREE.BoxGeometry(0.03, 0.045, 0.05); darkParts.push(place(c2, th, R - 0.05, Y_CONDUIT));
    const c3 = new THREE.BoxGeometry(0.045, 0.14, 0.15); darkParts.push(place(c3, th, R - 0.1, Y_MAIN));
  }
  for (let k = 0; k < 12; k++) {                                       // фланцы на трубах
    const th = k * 30 * DEG;
    for (const [rr, y, tube, parts] of [[R - 0.075, Y_COPPER, 0.03, copperParts], [R - 0.12, Y_MAIN, 0.055, steelParts]]) {
      const arc = 0.03 / rr;
      const f = new THREE.TorusGeometry(rr, tube * 1.5, 8, 2, arc); f.rotateX(Math.PI / 2);
      f.rotateY(-th + Math.PI / 2 + arc / 2); f.translate(0, y, 0);
      parts.push(f);
    }
  }

  // ---------- простенки между постами (на 30° + 60°·k): плафон, стояк с вентилем или кабельная коробка ----------
  const lampSpots = [];
  for (let k = 0; k < 6; k++) {
    const th = (30 + 60 * k) * DEG;
    const lampY = 1.36;
    // плафон на кронштейне
    const lp = cageLampParts(1.15);
    darkParts.push(place(lp.base, th, R - 0.035, lampY));
    darkParts.push(place(lp.cage, th, R - 0.035, lampY));
    bulbParts.push(place(lp.bulb, th, R - 0.035, lampY));
    lampSpots.push({ theta: th, pos: new THREE.Vector3(...polar(R - 0.035 - lp.glowZ, th, lampY)) });
    // провод от плафона к кабель-каналу
    darkParts.push(rod(polar(R - 0.03, th, lampY + 0.15), polar(R - 0.05, th, Y_CONDUIT), 0.009, 6));

    if (k % 2 === 0) {
      // стояк с вентилем
      const a = th - 5.2 * DEG, rr = R - 0.075;
      copperParts.push(pipeGeometry([polar(rr, a, 0.02), polar(rr, a, Y_COPPER)], 0.026, { flanges: true }));
      const body = new THREE.CylinderGeometry(0.05, 0.05, 0.13, 10);
      copperParts.push(place(body, a, rr, 0.98));
      const stem = new THREE.CylinderGeometry(0.014, 0.014, 0.1, 8); stem.rotateX(Math.PI / 2);
      steelParts.push(place(stem, a, rr - 0.07, 0.98));
      ochreParts.push(place(valveWheelGeometry(0.075), a, rr - 0.11, 0.98));
      const tee = new THREE.SphereGeometry(0.045, 10, 8);
      copperParts.push(place(tee, a, rr, Y_COPPER));
      // тонкая трубка манометра
      const b = th + 4.5 * DEG;
      copperParts.push(pipeGeometry([polar(R - 0.04, b, 0.02), polar(R - 0.04, b, 0.7), polar(R - 0.04, b + 1.2 * DEG, 0.78), polar(R - 0.04, b + 1.2 * DEG, Y_COPPER - 0.02)], 0.011, { flanges: false, radial: 6 }));
    } else {
      // кабельная коробка, кабели вверх и вниз
      const a = th + 5 * DEG, rr = R - 0.055;
      const box = new THREE.BoxGeometry(0.24, 0.32, 0.09);
      darkParts.push(place(box, a, rr, 0.92));
      const lid = new THREE.BoxGeometry(0.2, 0.28, 0.012);
      steelParts.push(place(lid, a, rr - 0.05, 0.92));
      for (const [sx, sy] of [[-0.085, -0.125], [0.085, -0.125], [-0.085, 0.125], [0.085, 0.125]]) {
        steelParts.push(place(xf(rivetGeometry(0.009, 6), { p: [sx, sy, 0] }), a, rr - 0.056, 0.92));
      }
      for (const off of [-0.06, 0, 0.06]) {
        const aa = a + off / rr;
        rubberParts.push(rod(polar(rr, aa, 1.08), polar(R - 0.05, aa, Y_CONDUIT), 0.012, 6));
      }
      rubberParts.push(rod(polar(rr, a - 0.02, 0.76), polar(rr, a - 0.02, 0.02), 0.016, 6));
      rubberParts.push(rod(polar(rr, a + 0.025, 0.76), polar(rr, a + 0.025, 0.02), 0.012, 6));
      const b = th - 5.5 * DEG;
      steelParts.push(pipeGeometry([polar(R - 0.06, b, 0.02), polar(R - 0.06, b, Y_MAIN)], 0.03, { flanges: true }));
    }
  }

  // ---------- центральный плафон под потолком ----------
  const ceilLamp = { pos: new THREE.Vector3(0, H - 0.4, 0) };
  {
    const lp = cageLampParts(2.2);
    const rot = g => { g.rotateX(Math.PI / 2); g.translate(0, H - 0.1, 0); return g; };   // лицом вниз
    darkParts.push(rot(lp.base)); darkParts.push(rot(lp.cage)); bulbParts.push(rot(lp.bulb));
  }

  // ---------- сборка мешей ----------
  const mesh = (parts, material, name) => {
    if (!parts.length) return null;
    const m = new THREE.Mesh(merge(parts), material);
    m.name = 'room.' + name; m.matrixAutoUpdate = false; m.updateMatrix();
    m.renderOrder = 5;                 // помещение рисуется после пультов: они перекрывают его и экономят заливку
    group.add(m);
    return m;
  };
  mesh(wallParts, mat.wall, 'wall');
  mesh(floorParts, mat.floor, 'floor');
  mesh(steelParts, mat.steel, 'steel');
  mesh(darkParts, mat.darkSteel, 'dark');
  mesh(copperParts, mat.copper, 'copper');
  mesh(ochreParts, mat.ochre, 'ochre');
  mesh(rubberParts, mat.rubber, 'rubber');
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const bulbColor = new THREE.Color('#ffdca8').multiplyScalar(1.7);
  bulbMat.color.copy(bulbColor);
  mesh(bulbParts, bulbMat, 'bulbs');

  // ---------- свечение: спрайты у ламп и «пятна света» на стене/потолке/полу ----------
  const glowMat = new THREE.SpriteMaterial({
    map: mat.glowTexture, color: 0xffc27a, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.6,
    depthWrite: false, fog: false,
  });
  const sprites = [];
  for (const s of lampSpots) {
    const sp = new THREE.Sprite(glowMat); sp.position.copy(s.pos); sp.scale.setScalar(0.62); group.add(sp); sprites.push(sp);
  }
  { const sp = new THREE.Sprite(glowMat); sp.position.copy(ceilLamp.pos); sp.scale.setScalar(1.25); group.add(sp); sprites.push(sp); }

  const poolMat = new THREE.MeshBasicMaterial({
    map: mat.glowTexture, color: 0xffa860, blending: THREE.AdditiveBlending, transparent: true, opacity: POOL,
    depthWrite: false, fog: false, side: THREE.DoubleSide,
  });
  {
    const pos = [], uv = [], idx = [];
    const quadStrip = (pts /* [[p, u, v] × (cols+1) × 2] */, cols) => {
      const base = pos.length / 3;
      for (const [p, u, v] of pts) { pos.push(p[0], p[1], p[2]); uv.push(u, v); }
      for (let c = 0; c < cols; c++) {
        const a = base + c * 2, b = a + 1, d = a + 2, e = a + 3;
        idx.push(a, d, b, b, d, e);
      }
    };
    for (const s of lampSpots) {             // изогнутые пятна на стене
      const cols = 8, half = 26 * DEG, y0 = 0.2, y1 = 2.3, rr = R - 0.1, pts = [];
      for (let c = 0; c <= cols; c++) {
        const t = c / cols, th = s.theta - half + 2 * half * t;
        pts.push([polar(rr, th, y0), t, 0], [polar(rr, th, y1), t, 1]);
      }
      quadStrip(pts, cols);
    }
    const flat = (y, size) => quadStrip([[[-size, y, -size], 0, 0], [[-size, y, size], 0, 1], [[size, y, -size], 1, 0], [[size, y, size], 1, 1]], 1);
    flat(H - 0.26, 2.3);                     // потолок вокруг центрального плафона
    flat(0.05, 2.6);                         // пол под ним
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, poolMat);
    m.name = 'room.pools'; m.renderOrder = 2; m.matrixAutoUpdate = false;
    group.add(m);
  }

  // ---------- мигание ламп при сотрясении ----------
  let level = 1, flickT = 0, flickDur = 0, flickAmp = 0;
  function applyLevel(k) {
    bulbMat.color.copy(bulbColor).multiplyScalar(0.15 + 0.85 * k);
    glowMat.opacity = 0.6 * k;
    poolMat.opacity = POOL * k;
    engine.lights.fillCeil.intensity = fillBase * (0.35 + 0.65 * k);
  }
  const fillBase = engine.lights.fillCeil.intensity;
  engine.onFrame((dt, time) => {
    let k = level;
    if (flickT < flickDur) {
      flickT += dt;
      const f = 1 - flickT / flickDur;
      const n = Math.sin(time * 71) * Math.sin(time * 43.7) * 0.5 + 0.5;
      k *= 1 - flickAmp * f * (0.35 + 0.65 * n);
    }
    if (Math.abs(k - applyLevel.last) > 0.004 || applyLevel.last === undefined) { applyLevel(k); applyLevel.last = k; }
  });

  return {
    group,
    /** Яркость ламп помещения 0..1 (аварийное освещение и т.п.). */
    setLampLevel(k) { level = Math.max(0, Math.min(1, k)); },
    /** Кратковременное мигание ламп (amount 0..1). */
    flicker(amount = 0.6, seconds = 0.5) { flickAmp = Math.max(0, Math.min(1, amount)); flickDur = seconds; flickT = 0; },
    get lampLevel() { return level; },
  };
}
