// Декор: pipe, cageLamp, rivetRow, cable (+ заготовки геометрии для помещения).
import * as THREE from 'three';
import { merge, xf, rivetGeometry, pipeGeometry, lathe } from '../geom.js';
import { PALETTE, toColor } from '../materials.js';
import { finish, TAU } from './base.js';

/**
 * Труба по ломаной со скруглёнными коленами и фланцами на концах.
 * pipe(points, radius=0.02, material=mat.copper, { flanges=true, bend })
 */
export function pipe(c, points, radius = 0.02, material, opts = {}) {
  const mesh = new THREE.Mesh(pipeGeometry(points, radius, opts), material || c.mat.copper);
  mesh.name = 'pipe';
  return finish({}, mesh);
}

/**
 * Кабель: гладкая кривая через точки.
 * cable(points, { radius=0.008, sag=0 (провис между точками, м), material=mat.rubber })
 */
export function cable(c, points, opts = {}) {
  const { radius = 0.008, sag = 0 } = opts;
  const P = [];
  for (let i = 0; i < points.length; i++) {
    const p = new THREE.Vector3().fromArray(points[i]);
    if (i > 0 && sag > 0) {
      const prev = new THREE.Vector3().fromArray(points[i - 1]);
      P.push(prev.clone().lerp(p, 0.5).add(new THREE.Vector3(0, -sag, 0)));
    }
    P.push(p);
  }
  const curve = new THREE.CatmullRomCurve3(P, false, 'centripetal');
  const segs = Math.max(8, Math.min(120, Math.round(curve.getLength() / Math.max(0.02, radius * 2.5))));
  const g = new THREE.TubeGeometry(curve, segs, radius, 6, false);
  const mesh = new THREE.Mesh(g, opts.material || c.mat.rubber);
  mesh.name = 'cable';
  return finish({}, mesh);
}

/**
 * Ряд заклёпок от точки from до точки to (в плоскости, головками в +Z).
 * rivetRow(from, to, { count | spacing=0.06, radius=0.007, material=mat.steel })
 */
export function rivetRow(c, from = [0, 0, 0], to = [0.3, 0, 0], opts = {}) {
  const { spacing = 0.06, radius = 0.007 } = opts;
  const a = new THREE.Vector3().fromArray(from), b = new THREE.Vector3().fromArray(to);
  const n = Math.max(2, opts.count || Math.round(a.distanceTo(b) / spacing) + 1);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const p = a.clone().lerp(b, n === 1 ? 0 : i / (n - 1));
    parts.push(xf(rivetGeometry(radius, 6), { p: p.toArray() }));
  }
  const mesh = new THREE.Mesh(merge(parts), opts.material || c.mat.steel);
  mesh.name = 'rivetRow';
  return finish({}, mesh);
}

/** Маленький вентильный маховичок (без взаимодействия): обод, спицы, ступица. Смотрит в +Z. */
export function valveWheelGeometry(radius = 0.07, spokes = 4) {
  const tube = radius * 0.13;
  const parts = [new THREE.TorusGeometry(radius, tube, 6, 20)];
  for (let i = 0; i < spokes; i++) {
    const g = new THREE.CylinderGeometry(tube * 0.6, tube * 0.75, radius, 6);
    g.translate(0, radius / 2, 0); g.rotateZ(i / spokes * TAU);
    parts.push(g);
  }
  parts.push(lathe([[radius * 0.26, -tube], [radius * 0.26, tube * 1.2], [radius * 0.14, tube * 1.9], [0, tube * 1.9]], 10));
  return merge(parts);
}

/**
 * Заготовки плафона в решётке (лицом в +Z, основание на z=0): { base, cage, bulb, glowZ }.
 * base и cage — под тёмную сталь, bulb — под светящийся материал.
 */
export function cageLampParts(scale = 1) {
  const s = scale, r = 0.042 * s, len = 0.085 * s;
  const base = merge([
    lathe([[r * 1.75, 0], [r * 1.75, 0.012 * s], [r * 1.75, 0.012 * s], [r * 1.45, 0.02 * s], [r * 1.2, 0.03 * s], [r * 1.2, 0.03 * s], [0, 0.03 * s]], 16),
  ]);
  // колба: вытянутый купол
  const bulb = lathe([[r, 0.028 * s], [r, 0.028 * s + len * 0.55], [r * 0.86, 0.028 * s + len * 0.8], [r * 0.55, 0.028 * s + len * 0.96], [0, 0.028 * s + len]], 14);
  // решётка: три обруча и четыре дуги
  const wire = 0.0042 * s, rc = r * 1.28;
  const cageParts = [];
  for (const z of [0.045 * s, 0.045 * s + len * 0.42, 0.045 * s + len * 0.8]) {
    const k = z > 0.045 * s + len * 0.6 ? 0.8 : 1;
    cageParts.push(xf(new THREE.TorusGeometry(rc * k, wire, 4, 16), { p: [0, 0, z] }));
  }
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * TAU + TAU / 8;
    const pts = [[rc, 0, 0.02 * s], [rc, 0, 0.045 * s + len * 0.5], [rc * 0.82, 0, 0.045 * s + len * 0.82], [rc * 0.3, 0, 0.05 * s + len * 1.08], [0, 0, 0.052 * s + len * 1.12]]
      .map(p => new THREE.Vector3(p[0] * Math.cos(a), p[0] * Math.sin(a), p[2]));
    cageParts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, wire, 4, false));
  }
  return { base, cage: merge(cageParts), bulb, glowZ: 0.03 * s + len * 0.6 };
}

/**
 * Плафон в решётке (эмиссивная колба + спрайт свечения; источником света НЕ является).
 * cageLamp({ color='white', scale=1, on=true }) → { object3D, set(on) }
 */
export function cageLamp(c, opts = {}) {
  const { color = 'white', scale = 1 } = opts;
  const parts = cageLampParts(scale);
  const group = new THREE.Group();
  group.name = 'cageLamp';
  const body = new THREE.Mesh(merge([parts.base, parts.cage]), c.mat.darkSteel);
  const onMat = c.mat.emissive(color, 2.2), offMat = c.mat.lens(color, false);
  const bulb = new THREE.Mesh(parts.bulb, onMat);
  const glow = new THREE.Sprite(c.mat.glowSprite(toColor(color).lerp(new THREE.Color(PALETTE.lampAmber), 0.35), 0.55));
  glow.position.z = parts.glowZ; glow.scale.setScalar(0.5 * scale);
  group.add(body, bulb, glow);
  let on = true;
  const api = {
    get on() { return on; },
    set(b) { on = !!b; bulb.material = on ? onMat : offMat; glow.visible = on; },
  };
  if (opts.on === false) api.set(false);
  return finish(api, group);
}
