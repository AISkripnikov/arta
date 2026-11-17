// handwheel — маховик. Игрок крутит его круговым движением пальца вокруг ступицы.
import * as THREE from 'three';
import { merge, xf, lathe, hitCylinder } from '../geom.js';
import { finish, planeMapper, sweepAngle, callSafe, TAU, DEG } from './base.js';

/**
 * opts: { radius=0.16, spokes=4, color (по умолчанию охра), knob=true, standoff (вынос от панели),
 *         onTurn(deltaRad), onStart(), onEnd(), tickAngle=15° (шаг трещотки для звука; 0 — без звука) }
 * onTurn: приращение угла, «по часовой для игрока» = +.
 * → { object3D, angle (накопленный угол, рад), spin(deltaRad) — повернуть визуально без события, enabled }
 */
export function handwheel(c, opts = {}) {
  const { radius: R = 0.16, spokes = 4, knob = true } = opts;
  const tube = Math.max(0.009, R * 0.085);
  const H = opts.standoff == null ? Math.max(0.045, R * 0.3) : opts.standoff;
  const tickAngle = opts.tickAngle == null ? 15 * DEG : opts.tickAngle;
  const group = new THREE.Group();
  group.name = 'handwheel';

  // неподвижная часть: фланец и вал
  const fixed = merge([
    lathe([[R * 0.3, 0], [R * 0.3, 0.008], [R * 0.3, 0.008], [R * 0.24, 0.016], [R * 0.13, 0.02], [R * 0.11, 0.02], [R * 0.11, H - tube * 0.5]], 20),
  ]);
  group.add(new THREE.Mesh(fixed, c.mat.steel));

  // вращающаяся часть
  const wheel = new THREE.Group();
  wheel.position.z = H;
  group.add(wheel);

  const rimParts = [new THREE.TorusGeometry(R, tube, 10, 40)];
  const hubR = R * 0.2;
  for (let i = 0; i < spokes; i++) {
    const len = R - hubR * 0.6;
    const g = new THREE.CylinderGeometry(tube * 0.62, tube * 0.9, len, 8);
    g.scale(1, 1, 0.8);
    g.translate(0, hubR * 0.6 + len / 2, 0);
    g.rotateZ(i / spokes * TAU + TAU / (spokes * 2));
    rimParts.push(g);
  }
  rimParts.push(lathe([[hubR, -tube * 0.9], [hubR, tube * 0.6], [hubR, tube * 0.6], [hubR * 0.86, tube * 1.25], [hubR * 0.5, tube * 1.45], [0, tube * 1.45]], 20));
  const rimMat = opts.color ? c.mat.paint(opts.color, { wear: 0.2 }) : c.mat.ochre;
  wheel.add(new THREE.Mesh(merge(rimParts), rimMat));

  // гайка ступицы (никель)
  const nut = lathe([[hubR * 0.45, tube * 1.4], [hubR * 0.45, tube * 1.9], [hubR * 0.45, tube * 1.9], [hubR * 0.3, tube * 2.3], [0, tube * 2.35]], 6);
  const nickelParts = [nut];
  if (knob) {
    // рукоятка на ободе: никелевая шейка + бакелитовая ручка
    const kr = Math.max(0.013, R * 0.095), kl = Math.max(0.05, R * 0.4);
    nickelParts.push(xf(lathe([[kr * 0.55, 0], [kr * 0.55, tube + 0.006], [kr * 0.8, tube + 0.008], [kr * 0.8, tube + 0.012]], 10), { p: [0, R, 0] }));
    const grip = lathe([
      [kr * 0.78, tube + 0.012], [kr * 0.95, tube + 0.012 + kl * 0.12], [kr, tube + 0.012 + kl * 0.4],
      [kr * 0.85, tube + 0.012 + kl * 0.78], [kr * 0.95, tube + 0.012 + kl * 0.93], [kr * 0.7, tube + 0.012 + kl], [0, tube + 0.012 + kl],
    ], 12);
    grip.translate(0, R, 0);
    wheel.add(new THREE.Mesh(grip, c.mat.bakelite));
  }
  wheel.add(new THREE.Mesh(merge(nickelParts), c.mat.nickel));

  // объём касания — щедрый, вместе с рукояткой
  const hit = hitCylinder(R * 1.2 + 0.02, H + 0.1);
  group.add(hit);

  let angle = 0, mapper = null, pu = 0, pv = 0, tickAcc = 0, turning = false;
  const rmin = R * 0.3;

  function applyVisual(dPhi) { wheel.rotation.z += dPhi; }

  const remove = c.input.add(hit, {
    onDown(e) {
      if (!api.enabled) return;
      mapper = planeMapper(c, group, H, R);
      [pu, pv] = mapper.map(e.x, e.y);
      turning = true;
      callSafe(opts.onStart);
    },
    onDrag(e) {
      if (!turning || !mapper) return;
      const [u, v] = mapper.map(e.x, e.y);
      const dPhi = sweepAngle(pu, pv, u, v, rmin);      // против часовой в плоскости маховика
      pu = u; pv = v;
      if (dPhi === 0) return;
      applyVisual(dPhi);                                 // рукоятка идёт за пальцем
      const delta = mapper.facing ? -dPhi : dPhi;        // по часовой для игрока = +
      angle += delta;
      if (tickAngle > 0) {
        tickAcc += Math.abs(delta);
        if (tickAcc >= tickAngle) { tickAcc %= tickAngle; c.audio.ratchet(); }
      }
      callSafe(opts.onTurn, delta);
    },
    onUp() {
      if (!turning) return;
      turning = false; mapper = null;
      callSafe(opts.onEnd);
    },
  });

  const api = {
    radius: R,
    /** Накопленный угол поворота, рад (по часовой для игрока = +). */
    get angle() { return angle; },
    /** true, пока игрок держит маховик. */
    get turning() { return turning; },
    /** Повернуть визуально на deltaRad (по часовой, если смотреть на лицо маховика) без события onTurn. */
    spin(deltaRad) { angle += deltaRad; wheel.rotation.z -= deltaRad; },
  };
  return finish(api, group, [remove]);
}
