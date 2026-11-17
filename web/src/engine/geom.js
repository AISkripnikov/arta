// Геометрические помощники: скруглённые формы, слияние, UV-развёртка «в метрах», заклёпки.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Приводит геометрию к виду, пригодному для слияния (без индекса; position/normal/uv). */
export function prep(g) {
  let out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name);
  }
  if (!out.attributes.normal) out.computeVertexNormals();
  if (!out.attributes.uv) {
    out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  }
  out.morphAttributes = {};
  out.clearGroups();
  return out;
}

/** Сливает список геометрий в одну (исходные освобождаются). */
export function merge(list) {
  const parts = list.filter(Boolean).map(prep);
  if (parts.length === 1) return parts[0];
  const g = mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());
  return g;
}

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _p = new THREE.Vector3(), _s = new THREE.Vector3();
/** Применяет к геометрии масштаб → поворот (Эйлер XYZ, рад) → перенос. Возвращает её же. */
export function xf(g, t = {}) {
  const p = t.p || [0, 0, 0], r = t.r || [0, 0, 0], s = t.s == null ? [1, 1, 1] : (typeof t.s === 'number' ? [t.s, t.s, t.s] : t.s);
  _m.compose(_p.set(p[0], p[1], p[2]), _q.setFromEuler(_e.set(r[0], r[1], r[2])), _s.set(s[0], s[1], s[2]));
  g.applyMatrix4(_m);
  return g;
}

/** Скруглённый прямоугольник w×h с центром в начале координат. */
export function roundedRectShape(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  r = Math.max(0.0001, Math.min(r, w / 2 - 1e-5, h / 2 - 1e-5));
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r); s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/**
 * Плита со скруглёнными углами и фаской: габарит w×h×depth, тыл на z=0, лицо на z=depth.
 * opts: { r (радиус углов), bevel (фаска), segs (сегментов фаски), curve (сегментов дуги) , hole: Shape|Path }
 */
export function slab(w, h, depth, opts = {}) {
  const bevel = Math.min(opts.bevel == null ? 0.004 : opts.bevel, depth / 2 - 1e-4, w / 2 - 1e-4, h / 2 - 1e-4);
  const r = opts.r == null ? 0.01 : opts.r;
  const shape = roundedRectShape(w - 2 * bevel, h - 2 * bevel, Math.max(0.0005, r - bevel));
  if (opts.hole) shape.holes.push(opts.hole);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, depth - 2 * bevel), bevelEnabled: bevel > 1e-5, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: opts.segs || 2, curveSegments: opts.curve || 5, steps: 1,
  });
  g.translate(0, 0, bevel);
  return g;
}

/** Выдавливание произвольной Shape: тыл z=0, лицо z=depth. */
export function extrude(shape, depth, bevel = 0, segs = 2, curve = 8) {
  const b = Math.min(bevel, depth / 2 - 1e-4);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, depth - 2 * b), bevelEnabled: b > 1e-5, bevelThickness: b, bevelSize: b, bevelOffset: -b,
    bevelSegments: segs, curveSegments: curve, steps: 1,
  });
  g.translate(0, 0, b);
  return g;
}

/**
 * Тело вращения вокруг оси Z (профиль — пары [radius, z]); «смотрит» в +Z.
 * Повторённая точка даёт острое ребро.
 */
export function lathe(profile, segments = 24) {
  // LatheGeometry вращает вокруг Y; профиль идём от большего z к меньшему, чтобы нормали были наружу.
  const pts = profile.map(([r, z]) => new THREE.Vector2(Math.max(0, r), z));
  const g = new THREE.LatheGeometry(pts, segments);
  g.rotateX(Math.PI / 2);
  // проверяем ориентацию по первой грани: нормаль должна смотреть от оси/наружу
  return g;
}

/**
 * UV «коробочной» проекцией в метрах: одна единица UV = metersPerRepeat метров.
 * Работает по нормалям вершин, годится для плит, коробок, выдавленных форм.
 */
export function boxUV(g, metersPerRepeat = 1) {
  const pos = g.attributes.position, nor = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2), k = 1 / metersPerRepeat;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    if (az >= ax && az >= ay) { uv[i * 2] = x * k; uv[i * 2 + 1] = y * k; }
    else if (ax >= ay) { uv[i * 2] = z * k; uv[i * 2 + 1] = y * k; }
    else { uv[i * 2] = x * k; uv[i * 2 + 1] = z * k; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Головка заклёпки: приплюснутый купол, основание на z=0, смотрит в +Z. */
export function rivetGeometry(radius = 0.007, seg = 6) {
  const g = new THREE.SphereGeometry(radius, seg, 2, 0, Math.PI * 2, 0, Math.PI / 2);
  g.rotateX(Math.PI / 2);
  g.scale(1, 1, 0.6);
  return g;
}

/** Шестигранная гайка/головка болта: основание z=0. */
export function hexGeometry(radius = 0.008, height = 0.005) {
  const g = new THREE.CylinderGeometry(radius * 0.92, radius, height, 6, 1);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, height / 2);
  return g;
}

/** Цилиндр между двумя точками. */
export function rod(a, b, radius, radial = 8, radius2 = radius) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(radius2, radius, len, radial, 1, false);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  g.applyQuaternion(q);
  const mid = va.add(vb).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

/**
 * Труба по ломаной со скруглёнными коленами. points — массив [x,y,z].
 * → BufferGeometry (прямые участки — цилиндры, колена — TubeGeometry).
 */
export function pipeGeometry(points, radius, opts = {}) {
  const radial = opts.radial || 8, bend = opts.bend == null ? radius * 2.6 : opts.bend;
  const P = points.map(p => new THREE.Vector3(p[0], p[1], p[2]));
  const parts = [];
  let start = P[0].clone();
  for (let i = 1; i < P.length; i++) {
    const cur = P[i];
    if (i === P.length - 1) {
      if (start.distanceTo(cur) > 1e-5) parts.push(rod(start.toArray(), cur.toArray(), radius, radial));
      break;
    }
    const dIn = cur.clone().sub(P[i - 1]), dOut = P[i + 1].clone().sub(cur);
    const lIn = dIn.length(), lOut = dOut.length();
    dIn.normalize(); dOut.normalize();
    const c = Math.min(bend, lIn * 0.5, lOut * 0.5);
    const a = cur.clone().addScaledVector(dIn, -c), b = cur.clone().addScaledVector(dOut, c);
    if (start.distanceTo(a) > 1e-5) parts.push(rod(start.toArray(), a.toArray(), radius, radial));
    if (dIn.dot(dOut) < 0.9999) {
      parts.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, cur, b), 6, radius, radial, false));
      // сферические «заглушки» на стыках скрывают щели между цилиндром и коленом
      const s1 = new THREE.SphereGeometry(radius, radial, 4); s1.translate(a.x, a.y, a.z); parts.push(s1);
      const s2 = new THREE.SphereGeometry(radius, radial, 4); s2.translate(b.x, b.y, b.z); parts.push(s2);
      start = b;
    } else start = a;
  }
  if (opts.flanges !== false) {
    const fr = radius * 1.55, fl = Math.max(0.008, radius * 0.7);
    const ends = [[P[0], P[1]], [P[P.length - 1], P[P.length - 2]]];
    for (const [e, n] of ends) {
      const dir = n.clone().sub(e).normalize();
      const b = e.clone().addScaledVector(dir, fl);
      parts.push(rod(e.toArray(), b.toArray(), fr, Math.max(radial, 10)));
    }
  }
  return merge(parts);
}

/** Невидимый материал для объёмов касания (в рендер не попадает, но ловится лучом). */
export const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });

/** Невидимый объём касания: коробка. */
export function hitBox(w, h, d, x = 0, y = 0, z = d / 2) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), hitMaterial);
  m.position.set(x, y, z);
  m.name = 'hit';
  return m;
}

/** Невидимый объём касания: цилиндр вдоль Z. */
export function hitCylinder(radius, depth, z = depth / 2) {
  const g = new THREE.CylinderGeometry(radius, radius, depth, 14);
  g.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, hitMaterial);
  m.position.z = z;
  m.name = 'hit';
  return m;
}
