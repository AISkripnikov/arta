// Круглое помещение башни (DESIGN §4): стена с рёбрами и заклёпками, настил, потолок с балками,
// трубопроводы, плафоны в решётках, вентили и кабельные коробки в простенках между постами.
// Вся статика слита по материалам (≈10 мешей) — дёшево в отрисовке. Секторы постов свободны:
// декор стены занимает не более ~0.1 м от стены.
import * as THREE from 'three';
import { merge, xf, rivetGeometry, rod, boxUV, lathe, pipeGeometry } from './geom.js';
import { cageLampParts, valveWheelGeometry } from './controls/decor.js';
import { makeCanvas, canvasTexture, drawLabel, mulberry32 } from './textures.js';

// Восемь постов через 45°. Радиусы подобраны так, чтобы стена оставалась на z ≈ −0.95 в координатах поста,
// а габарит поста (|x| ≤ 0.9, z ≤ 0.35) не пересекался с соседним: (ring − 0.35)·tg 22.5° ≥ 0.9.
export const ROOM = { radius: 3.55, height: 2.6, ring: 2.6, slots: 8 };

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const POOL = 0.15;            // яркость «пятен света» от плафонов

/** Ставит геометрию, построенную «лицом в +Z» в начале координат, на стену: угол theta, радиус r, высота y. */
function place(g, theta, r, y) {
  g.rotateY(-theta);
  g.translate(r * Math.sin(theta), y, -r * Math.cos(theta));
  return g;
}
const polar = (r, theta, y) => [r * Math.sin(theta), y, -r * Math.cos(theta)];

/**
 * Атлас наклеек помещения 1024×512: контактные тени (чёрный с альфой), трафареты, аптечка, полосы.
 * → { texture, regions: { имя: [u0, v0, u1, v1] } }
 */
function makeDecalAtlas() {
  const W = 1024, Hh = 512, cv = makeCanvas(W, Hh), c = cv.getContext('2d'), rnd = mulberry32(31);
  const R = {
    aoRect: [0, 0, 256, 256], aoWall: [256, 0, 128, 256], aoGrad: [384, 0, 64, 256],
    stripes: [448, 0, 576, 96], tube: [448, 96, 576, 144],
    aid: [0, 256, 320, 256], volt: [320, 256, 256, 128], zip: [320, 384, 256, 112], nosmoke: [576, 256, 448, 112],
  };
  const sm = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  const img = c.createImageData(W, Hh), d = img.data;
  const px = (x, y, a) => { const i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = Math.round(255 * Math.max(0, Math.min(1, a))); };
  { const [x0, y0, w, h] = R.aoRect;                                     // мягкий прямоугольник
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ex = sm(Math.min(x, w - 1 - x) / (w * 0.32)), ey = sm(Math.min(y, h - 1 - y) / (h * 0.32));
      px(x0 + x, y0 + y, 0.55 * ex * ey);
    } }
  { const [x0, y0, w, h] = R.aoWall;                                     // тень на стене за пультом: гуще у пола
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ex = sm(Math.min(x, w - 1 - x) / (w * 0.3)), v = 1 - y / (h - 1);   // v: 1 — верх
      px(x0 + x, y0 + y, 0.5 * ex * Math.pow(1 - v, 1.6));
    } }
  { const [x0, y0, w, h] = R.aoGrad;                                     // полоса вдоль стыка стены и настила: гуще у стены (v = 1)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = 1 - y / (h - 1); px(x0 + x, y0 + y, 0.5 * Math.pow(v, 2.2)); } }
  c.putImageData(img, 0, 0);
  const wear = (x0, y0, w, h, n, rmax) => {                              // потёртости трафарета: выбить краску точками
    c.save(); c.beginPath(); c.rect(x0, y0, w, h); c.clip(); c.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < n; i++) { c.fillStyle = 'rgba(0,0,0,' + (0.3 + rnd() * 0.7).toFixed(2) + ')'; c.beginPath(); c.arc(x0 + rnd() * w, y0 + rnd() * h, 0.6 + rnd() * rmax, 0, Math.PI * 2); c.fill(); }
    c.restore();
  };
  const stencil = (key, text, color, cap, extra) => {
    const [x0, y0, w, h] = R[key];
    c.save(); c.globalAlpha = 0.86;
    drawLabel(c, text, x0 + w / 2 + (extra ? h * 0.32 : 0), y0 + h / 2, cap, { color, weight: 700, spacing: 0.12, maxWidth: w - h * (extra ? 0.9 : 0.3) });
    if (extra) extra(x0, y0, w, h);
    c.restore();
    wear(x0, y0, w, h, Math.round(w * h / 90), 2.2);
  };
  // предупредительные полосы (жёлто-чёрные, потёртые)
  { const [x0, y0, w, h] = R.stripes;
    c.save(); c.beginPath(); c.rect(x0, y0, w, h); c.clip();
    c.fillStyle = '#1a1a18'; c.fillRect(x0, y0, w, h);
    c.fillStyle = '#c99a1c';
    for (let x = x0 - h; x < x0 + w + h; x += h * 0.9) { c.beginPath(); c.moveTo(x, y0 + h); c.lineTo(x + h * 0.45, y0 + h); c.lineTo(x + h * 0.45 + h, y0); c.lineTo(x + h, y0); c.closePath(); c.fill(); }
    c.restore(); wear(x0, y0, w, h, 900, 2.6); }
  stencil('tube', 'ПЕРЕГОВОРНАЯ ТРУБА', '#d9d3bf', 52);
  stencil('nosmoke', 'НЕ КУРИТЬ!', '#b8382b', 62);
  stencil('zip', 'ЗИП', '#d9d3bf', 56);
  stencil('volt', '380 В', '#e2b62a', 50, (x0, y0, w, h) => {
    const cx = x0 + h * 0.5, cy = y0 + h * 0.5, s = h * 0.36;              // молния в треугольнике
    c.strokeStyle = '#e2b62a'; c.lineWidth = h * 0.06; c.beginPath(); c.moveTo(cx, cy - s); c.lineTo(cx + s, cy + s * 0.8); c.lineTo(cx - s, cy + s * 0.8); c.closePath(); c.stroke();
    c.fillStyle = '#e2b62a'; c.beginPath(); c.moveTo(cx + s * 0.12, cy - s * 0.55); c.lineTo(cx - s * 0.22, cy + s * 0.12); c.lineTo(cx + s * 0.02, cy + s * 0.12);
    c.lineTo(cx - s * 0.1, cy + s * 0.62); c.lineTo(cx + s * 0.24, cy - s * 0.02); c.lineTo(cx + s * 0.02, cy - s * 0.02); c.closePath(); c.fill();
  });
  // аптечка: белая эмаль, красный крест, надпись
  { const [x0, y0, w, h] = R.aid;
    c.fillStyle = '#d8d4c6'; c.fillRect(x0 + 2, y0 + 2, w - 4, h - 4);
    const g = c.createLinearGradient(0, y0, 0, y0 + h); g.addColorStop(0, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(60,50,30,0.22)');
    c.fillStyle = g; c.fillRect(x0 + 2, y0 + 2, w - 4, h - 4);
    c.strokeStyle = 'rgba(40,40,40,0.55)'; c.lineWidth = 3; c.strokeRect(x0 + 8, y0 + 8, w - 16, h - 16);
    const cx = x0 + w / 2, cy = y0 + h * 0.4, a = h * 0.11, b = h * 0.33;
    c.fillStyle = '#b3241b'; c.fillRect(cx - a, cy - b, a * 2, b * 2); c.fillRect(cx - b, cy - a, b * 2, a * 2);
    drawLabel(c, 'АПТЕЧКА', cx, y0 + h * 0.85, h * 0.1, { color: '#2a2622', weight: 700, spacing: 0.1 });
    wear(x0 + 2, y0 + 2, w - 4, h - 4, 160, 2.4);
    c.fillStyle = '#5a5f63'; c.fillRect(x0 + w - 30, y0 + h / 2 - 10, 10, 20); }               // защёлка
  const texture = canvasTexture(cv, { aniso: 4 });
  const regions = {};
  for (const k of Object.keys(R)) { const [x, y, w, h] = R[k]; regions[k] = [x / W, 1 - (y + h) / Hh, (x + w) / W, 1 - y / Hh]; }
  regions.aoRect2 = regions.aoRect;
  return { texture, regions };
}

export function createRoom(engine) {
  const { mat } = engine;
  // процедурные текстуры: наполняются в первом кадре под действующий уровень качества (см. materials.js)
  if (mat.bind) mat.bind(engine);
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
      const BL = R - 0.64;                                           // от центрального кольца до стены
      const beam = new THREE.BoxGeometry(0.1, 0.17, BL); boxUV(beam, mat.WEAR_REPEAT);
      // балка идёт вдоль радиуса: её длинная ось Z → после place смотрит к центру
      wallParts.push(place(beam, th, 0.6 + BL / 2, H - 0.085));
      const fl = new THREE.BoxGeometry(0.2, 0.014, BL); boxUV(fl, mat.WEAR_REPEAT);
      wallParts.push(place(fl, th, 0.6 + BL / 2, H - 0.176));
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

  // ---------- простенки между постами (посередине между осями): плафон, стояк с вентилем или кабельная коробка ----------
  const lampSpots = [];
  const STEP = 360 / ROOM.slots;
  for (let k = 0; k < ROOM.slots; k++) {
    const th = (k + 0.5) * STEP * DEG;
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
      darkParts.push(place(lid, a, rr - 0.05, 0.92));
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

  // ---------- жгуты кабелей вдоль кабель-канала ----------
  for (const [dy, dr, tube] of [[0.024, 0.006, 0.0075], [-0.022, 0.004, 0.006]]) ringPipe(R - 0.045 - dr, Y_CONDUIT + dy, tube, rubberParts, 5);

  // ---------- вещи на стенах в простенках (ниже ~1.7 м, не дальше 0.13 м от стены; посты их не видят как органы) ----------
  const decalList = [];               // [geometry, region] — наклейки собираются в один меш ниже
  const STOW = { aid: 1, helmet: 4, tube: 6, rack: 2, nosmoke: 5 };
  {
    // аптечка (k = 1): стальной ящик, белая дверца с красным крестом — наклейкой
    const th = (STOW.aid + 0.5) * STEP * DEG - 1.2 * DEG;
    const body = new THREE.BoxGeometry(0.27, 0.21, 0.095);
    darkParts.push(place(body, th, R - 0.06, 0.99));
    for (const sx of [-1, 1]) darkParts.push(place(xf(new THREE.BoxGeometry(0.012, 0.05, 0.012), { p: [sx * 0.141, 0.04, 0] }), th, R - 0.075, 0.99));   // петли
    decalList.push([place(new THREE.PlaneGeometry(0.25, 0.19), th, R - 0.1085, 0.99), 'aid']);
    // каска на крюке (k = 4)
    const hk = (STOW.helmet + 0.5) * STEP * DEG - 3.6 * DEG;
    steelParts.push(rod(polar(R - 0.01, hk, 1.66), polar(R - 0.085, hk, 1.68), 0.006, 6));
    const dome = new THREE.SphereGeometry(0.125, 16, 7, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, 0.82, 1.08);
    const brim = new THREE.TorusGeometry(0.128, 0.008, 4, 20); brim.rotateX(Math.PI / 2); brim.scale(1, 1, 1.08);
    for (const g of [dome, brim]) { g.rotateX(-0.42); g.rotateZ(0.12); darkParts.push(place(g, hk, R - 0.125, 1.53)); }
    rubberParts.push(place(xf(new THREE.TorusGeometry(0.09, 0.005, 4, 14, Math.PI), { r: [0, 0, Math.PI], s: [1, 0.9, 1] }), hk, R - 0.115, 1.5));
    // переговорная труба (k = 6): медная труба из-под потолка, раструб к помещению, заглушка-свисток на цепочке
    const tt = (STOW.tube + 0.5) * STEP * DEG - 4 * DEG;
    copperParts.push(pipeGeometry([polar(R - 0.06, tt, H - 0.18), polar(R - 0.06, tt, 1.62), polar(R - 0.13, tt, 1.53)], 0.022, { flanges: false, bend: 0.06 }));
    {
      const bell = new THREE.LatheGeometry([[0.022, 0], [0.026, 0.03], [0.04, 0.07], [0.052, 0.085], [0.052, 0.09], [0.045, 0.09]].map(([r, y]) => new THREE.Vector2(r, y)), 16);
      bell.rotateX(Math.PI / 2 + 0.9);
      copperParts.push(place(bell, tt, R - 0.13, 1.53));
      const throat = new THREE.CircleGeometry(0.03, 12); throat.rotateX(-Math.PI / 2); throat.translate(0, 0.035, 0);   // тёмное горло раструба
      throat.rotateX(Math.PI / 2 + 0.9);
      darkParts.push(place(throat, tt, R - 0.13, 1.53));
      const plug = new THREE.CylinderGeometry(0.03, 0.026, 0.04, 10); plug.rotateX(Math.PI / 2);
      steelParts.push(place(plug, tt + 2.3 * DEG, R - 0.03, 1.36));
      for (let i = 0; i < 6; i++) {
        const t = i / 5, pnt = polar(R - 0.1 + 0.07 * t, tt + 2.3 * DEG * t, 1.5 - 0.12 * t - 0.03 * Math.sin(t * Math.PI));
        const ln = new THREE.TorusGeometry(0.006, 0.0016, 3, 6); ln.rotateY(i % 2 ? Math.PI / 2 : 0); ln.translate(...pnt);
        steelParts.push(ln);
      }
    }
    for (const sy of [1.95, 1.7]) darkParts.push(place(new THREE.BoxGeometry(0.06, 0.03, 0.08), tt, R - 0.04, sy));   // хомуты
    decalList.push([place(new THREE.PlaneGeometry(0.3, 0.075), tt + 4.6 * DEG, R - 0.004, 1.58), 'tube']);
    // стеллаж ЗИП (k = 2): полоса с зажимами, два ключа и ломик
    const rk = (STOW.rack + 0.5) * STEP * DEG - 1.5 * DEG;
    darkParts.push(place(new THREE.BoxGeometry(0.34, 0.035, 0.02), rk, R - 0.025, 0.62));
    for (const sx of [-0.12, -0.02, 0.1]) darkParts.push(place(xf(new THREE.BoxGeometry(0.02, 0.05, 0.045), { p: [sx, 0, 0] }), rk, R - 0.05, 0.62));
    const spanner = (len, w) => merge([
      new THREE.BoxGeometry(w * 0.5, len, 0.008),
      xf(new THREE.TorusGeometry(w * 0.55, w * 0.22, 4, 10, Math.PI * 1.4), { p: [0, len / 2 + w * 0.4, 0], r: [0, 0, -Math.PI * 0.2] }),
      xf(new THREE.TorusGeometry(w * 0.45, w * 0.2, 4, 12), { p: [0, -len / 2 - w * 0.35, 0] }),
    ]);
    steelParts.push(place(xf(spanner(0.26, 0.05), { p: [-0.12, -0.06, 0] }), rk, R - 0.062, 0.62));
    steelParts.push(place(xf(spanner(0.2, 0.04), { p: [-0.02, -0.04, 0] }), rk, R - 0.062, 0.62));
    darkParts.push(place(xf(new THREE.CylinderGeometry(0.009, 0.009, 0.46, 6), { p: [0.1, -0.1, 0], r: [0, 0, 0.05] }), rk, R - 0.062, 0.62));
    decalList.push([place(new THREE.PlaneGeometry(0.14, 0.06), rk, R - 0.004, 0.75), 'zip']);
    // трафарет «НЕ КУРИТЬ» (k = 5) и «ОПАСНО 380 В» на крышках кабельных коробок (нечётные простенки)
    decalList.push([place(new THREE.PlaneGeometry(0.34, 0.085), (STOW.nosmoke + 0.5) * STEP * DEG - 4.5 * DEG, R - 0.004, 1.62), 'nosmoke']);
    for (let k = 1; k < ROOM.slots; k += 2) decalList.push([place(new THREE.PlaneGeometry(0.15, 0.075), (k + 0.5) * STEP * DEG + 5 * DEG, R - 0.112, 1.0), 'volt']);
    // предупредительные полосы на цоколе стены под вентилями (чётные простенки)
    for (let k = 0; k < ROOM.slots; k += 2) {
      const a = (k + 0.5) * STEP * DEG - 5.2 * DEG;
      decalList.push([place(new THREE.PlaneGeometry(0.42, 0.1), a, R - 0.053, 0.09), 'stripes']);
    }
  }
  // контактные тени: стена за пультом и настил под ним у каждого поста, полоса вдоль стыка стены с настилом
  for (let k = 0; k < ROOM.slots; k++) {
    const th = k * STEP * DEG;
    decalList.push([curvedStrip(th, 15.5 * DEG, R - 0.016, 0.0, 1.7, 7), 'aoWall']);
    const fl = new THREE.PlaneGeometry(1.95, 1.3); fl.rotateX(-Math.PI / 2); fl.translate(0, 0.004, -0.35);
    decalList.push([place(fl, th, ROOM.ring, 0), 'aoRect']);
  }
  {
    const g = new THREE.RingGeometry(R - 0.42, R - 0.05, 96, 1); g.rotateX(-Math.PI / 2); g.translate(0, 0.003, 0);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { const r = Math.hypot(p.getX(i), p.getZ(i)); uv.setXY(i, 0.5, (r - (R - 0.42)) / 0.37); }
    decalList.push([g, 'aoGrad']);
  }
  /** Кривая полоса вдоль стены: центр th, полуугол half, радиус r, высоты y0…y1. */
  function curvedStrip(th, half, r, y0, y1, cols) {
    const pos = [], uv = [], idx = [];
    for (let c = 0; c <= cols; c++) {
      const t = c / cols, a = th - half + 2 * half * t;
      pos.push(...polar(r, a, y0), ...polar(r, a, y1)); uv.push(t, 0, t, 1);
      if (c < cols) { const b = c * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
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

  // ---------- свечение у ламп: все ореолы помещения — один меш-«билборд» (вместо 9 спрайтов: 1 вызов отрисовки) ----------
  const glowU = { map: { value: mat.glowTexture }, color: { value: new THREE.Color(0xffc27a) }, opacity: { value: 0.6 } };
  const glowMat = new THREE.ShaderMaterial({
    uniforms: glowU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `
      attribute vec3 center; attribute vec2 corner; attribute float size;
      varying vec2 vUv;
      void main() {
        vUv = corner * 0.5 + 0.5;
        vec4 mv = modelViewMatrix * vec4( center, 1.0 );
        mv.xy += corner * size * 0.5;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D map; uniform vec3 color; uniform float opacity;
      varying vec2 vUv;
      void main() {
        gl_FragColor = vec4( color * texture2D( map, vUv ).rgb * opacity, 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  glowMat.toneMapped = true;
  {
    const spots = lampSpots.map(s => [s.pos, 0.62]).concat([[ceilLamp.pos, 1.25]]);
    const n = spots.length, center = new Float32Array(n * 12), corner = new Float32Array(n * 8), size = new Float32Array(n * 4), idx = [];
    spots.forEach(([p, sz], i) => {
      for (let j = 0; j < 4; j++) { center.set([p.x, p.y, p.z], i * 12 + j * 3); size[i * 4 + j] = sz; }
      corner.set([-1, -1, 1, -1, 1, 1, -1, 1], i * 8);
      idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(center.slice(), 3));     // для габарита (луч касания их не ловит: не зарегистрированы)
    g.setAttribute('center', new THREE.BufferAttribute(center, 3));
    g.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    g.setIndex(idx);
    g.computeBoundingSphere(); g.boundingSphere.radius += 0.7;
    const m = new THREE.Mesh(g, glowMat);
    m.name = 'room.glow'; m.renderOrder = 6; m.matrixAutoUpdate = false; m.userData.noShadow = true;
    group.add(m);
  }

  // ---------- наклейки: трафареты, аптечка, полосы, контактные тени — один атлас, один меш ----------
  {
    const atlas = makeDecalAtlas();
    const decalMat = new THREE.MeshLambertMaterial({
      map: atlas.texture, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    const parts = decalList.map(([g, region]) => {
      const r = atlas.regions[region], uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1]));
      return g;
    });
    const m = new THREE.Mesh(merge(parts), decalMat);
    m.name = 'room.decals'; m.renderOrder = 6; m.matrixAutoUpdate = false; m.updateMatrix(); m.userData.noShadow = true;
    group.add(m);
  }

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
      const cols = 8, half = 26 * 3.0 / R * DEG, y0 = 0.2, y1 = 2.3, rr = R - 0.1, pts = [];
      for (let c = 0; c <= cols; c++) {
        const t = c / cols, th = s.theta - half + 2 * half * t;
        pts.push([polar(rr, th, y0), t, 0], [polar(rr, th, y1), t, 1]);
      }
      quadStrip(pts, cols);
    }
    const flat = (y, size) => quadStrip([[[-size, y, -size], 0, 0], [[-size, y, size], 0, 1], [[size, y, -size], 1, 0], [[size, y, size], 1, 1]], 1);
    flat(H - 0.26, 2.3 * R / 3.0);                     // потолок вокруг центрального плафона
    flat(0.05, 2.6 * R / 3.0);                         // пол под ним
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
  // без постобработки (mid, low) свечения ламп нет — ореолы чуть ярче, чтобы лампы читались горящими
  let glowK = 1;
  function applyLevel(k) {
    bulbMat.color.copy(bulbColor).multiplyScalar(0.15 + 0.85 * k);
    glowU.opacity.value = 0.6 * k * glowK;
    poolMat.opacity = POOL * k;
    engine.lights.fillCeil.intensity = fillBase * (0.35 + 0.65 * k);
  }
  const fillBase = engine.lights.fillCeil.intensity;
  if (engine.on) engine.on('quality', (q) => { const g = engine.post && engine.post.active ? 1 : 1.3; if (g !== glowK) { glowK = g; applyLevel(level); } });
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
