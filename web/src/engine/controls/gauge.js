// gauge — стрелочный прибор: никелевая оправа, циферблат «слоновая кость», демпфированная стрелка, метка задания.
import * as THREE from 'three';
import { merge, xf, lathe } from '../geom.js';
import { makeCanvas, canvasTexture, drawLabel } from '../textures.js';
import { PALETTE, toColor } from '../materials.js';
import { finish, spring, clamp, DEG, TAU } from './base.js';

function niceStep(range, target = 6) {
  const raw = range / target, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}
const fmt = v => { const r = Math.round(v * 100) / 100; return String(r).replace('-', '−'); };

/**
 * opts: { radius=0.09 (наружный радиус оправы), min=0, max=100, label, unit (надписи на циферблате), majorStep, minorStep,
 *         zones: [{ from, to, color='#c0392b' }], sweep=270 (градусов), start (угол отметки min, градусы по часовой
 *         от «12 часов»; по умолчанию −sweep/2), wrap (круговая шкала: стрелка идёт кратчайшим путём; по умолчанию при sweep ≥ 360),
 *         caption (шильдик под прибором), value=min, numbers=true, damping=0.6, speed=16 }
 * → { object3D, setValue(v, {instant}), value, shown, setBug(v|null) }
 */
export function gauge(c, opts = {}) {
  const { radius: R = 0.09, min = 0, max = 100, sweep = 270 } = opts;
  const range = max - min || 1;
  const major = opts.majorStep || niceStep(range);
  const minor = opts.minorStep || major / 5;
  const half = sweep * DEG / 2;
  const start = opts.start == null ? -half : opts.start * DEG;
  const wrap = opts.wrap == null ? sweep >= 359.5 : !!opts.wrap;
  const lim = v => wrap ? min + ((((v - min) % range) + range) % range) : clamp(v, min, max);
  const angleOf = v => start + (lim(v) - min) / range * half * 2;                 // по часовой от «12 часов»
  const group = new THREE.Group();
  group.name = 'gauge';
  const dialR = R * 0.86;

  // оправа
  group.add(new THREE.Mesh(lathe([
    [R, 0], [R, R * 0.2], [R * 0.985, R * 0.27], [R * 0.94, R * 0.31], [R * 0.9, R * 0.31], [R * 0.9, R * 0.31], [dialR, R * 0.24], [dialR, 0.004],
  ], 36), c.mat.nickel));

  // циферблат
  {
    const S = R > 0.11 ? 512 : 256, h = S / 2, k = h / dialR;               // k — пикселей на метр
    const cv = makeCanvas(S, S), ctx = cv.getContext('2d');
    ctx.fillStyle = PALETTE.ivory; ctx.fillRect(0, 0, S, S);
    const g = ctx.createRadialGradient(h, h, h * 0.2, h, h, h);
    g.addColorStop(0, 'rgba(255,250,235,0.25)'); g.addColorStop(0.75, 'rgba(120,100,60,0.0)'); g.addColorStop(1, 'rgba(90,70,30,0.32)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    const rOut = h * 0.93, rMaj = h * 0.76, rMin = h * 0.85;
    const dir = v => { const a = angleOf(v); return [Math.sin(a), -Math.cos(a)]; };
    // зоны
    for (const z of (opts.zones || [])) {
      const a0 = angleOf(z.from) - Math.PI / 2, a1 = angleOf(z.to) - Math.PI / 2;
      ctx.strokeStyle = z.color || PALETTE.redZone; ctx.lineWidth = h * 0.085; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.arc(h, h, rOut - h * 0.0425, Math.min(a0, a1), Math.max(a0, a1)); ctx.stroke();
    }
    // деления
    ctx.strokeStyle = PALETTE.ink; ctx.lineCap = 'butt';
    const eps = range * 1e-6;
    const nMinor = Math.round(range / minor);
    if (nMinor <= 200) for (let i = 0; i <= nMinor; i++) {
      const v = min + i * minor; if (v > max + eps) break;
      const [sx, sy] = dir(v);
      ctx.lineWidth = Math.max(1, h * 0.012);
      ctx.beginPath(); ctx.moveTo(h + sx * rOut, h + sy * rOut); ctx.lineTo(h + sx * rMin, h + sy * rMin); ctx.stroke();
    }
    const firstMajor = Math.ceil((min - eps) / major) * major;
    const capN = h * 0.19;
    for (let v = firstMajor; v <= max + eps; v += major) {
      const [sx, sy] = dir(v);
      ctx.lineWidth = Math.max(1.5, h * 0.03);
      ctx.beginPath(); ctx.moveTo(h + sx * rOut, h + sy * rOut); ctx.lineTo(h + sx * rMaj, h + sy * rMaj); ctx.stroke();
      if (opts.numbers !== false) {
        if (sweep >= 359 && Math.abs(v - max) < eps) continue;              // на круговой шкале не дублируем ноль
        drawLabel(ctx, fmt(v), h + sx * h * 0.56, h + sy * h * 0.56, capN, { color: PALETTE.ink, weight: 600, spacing: 0, maxWidth: h * 0.3 });
      }
    }
    ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = Math.max(1, h * 0.012);
    if (sweep < 359) { ctx.beginPath(); ctx.arc(h, h, rOut, start - Math.PI / 2, start + half * 2 - Math.PI / 2); ctx.stroke(); }
    else { ctx.beginPath(); ctx.arc(h, h, rOut, 0, TAU); ctx.stroke(); }
    // надписи на циферблате: название — в разрыве шкалы (или ниже центра), единица — над центром
    const gapDown = sweep <= 300 && Math.abs(start + half) < 0.3;          // разрыв шкалы внизу
    if (opts.label) drawLabel(ctx, opts.label, h, h + h * (gapDown ? 0.5 : 0.3), h * 0.135, { color: PALETTE.ink, weight: 600, maxWidth: h * (gapDown ? 0.95 : 0.62) });
    if (opts.unit) drawLabel(ctx, opts.unit, h, h - h * 0.27, h * 0.12, { color: '#5a5142', weight: 600, maxWidth: h * 0.5 });
    const tex = canvasTexture(cv, { aniso: 8 });
    const dial = new THREE.Mesh(new THREE.CircleGeometry(dialR, 40), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0 }));
    dial.position.z = 0.004;
    group.add(dial);
  }

  // метка задания (красный треугольник у кромки шкалы)
  const bug = new THREE.Group();
  bug.position.z = 0.006; bug.visible = false;
  {
    const s = new THREE.Shape();
    const r0 = dialR * 0.99, r1 = dialR * 0.74, w = dialR * 0.11;
    s.moveTo(-w, r0); s.lineTo(w, r0); s.lineTo(0, r1); s.closePath();
    bug.add(new THREE.Mesh(new THREE.ShapeGeometry(s), c.mat.memo('gaugeBug', () => new THREE.MeshBasicMaterial({ color: toColor(PALETTE.redZone) }))));
  }
  group.add(bug);

  // стрелка
  const needle = new THREE.Group();
  needle.position.z = R * 0.11;
  {
    const s = new THREE.Shape();
    const tip = dialR * 0.88, tail = dialR * 0.24, w = dialR * 0.035;
    s.moveTo(-w, 0); s.lineTo(-w * 0.25, tip); s.lineTo(w * 0.25, tip); s.lineTo(w, 0); s.lineTo(w * 1.3, -tail * 0.55);
    s.absarc(0, -tail * 0.72, w * 1.9, 0, Math.PI, true); s.lineTo(-w * 1.3, -tail * 0.55); s.closePath();
    const blade = new THREE.ShapeGeometry(s);
    const hub = lathe([[dialR * 0.105, -R * 0.02], [dialR * 0.105, R * 0.035], [dialR * 0.08, R * 0.05], [0, R * 0.05]], 16);
    needle.add(new THREE.Mesh(merge([blade, hub]), c.mat.bakelite));
  }
  group.add(needle);

  // стекло
  {
    const g = new THREE.SphereGeometry(dialR * 2.2, 24, 4, 0, TAU, 0, Math.asin(1 / 2.2));
    g.rotateX(Math.PI / 2); g.translate(0, 0, R * 0.245 - dialR * 2.2 * Math.cos(Math.asin(1 / 2.2)));
    const glass = new THREE.Mesh(g, c.mat.glass);
    glass.renderOrder = 3;
    group.add(glass);
  }

  if (opts.caption) {
    const p = c.ui.plate(opts.caption, { size: opts.captionSize || 0.024, screws: false });
    p.object3D.position.set(0, -(R + 0.012 + p.h / 2), 0);
    group.add(p.object3D);
  }

  let target = lim(opts.value == null ? min : opts.value);
  const st = { x: target, v: 0 };
  const omega = opts.speed || 16, zeta = opts.damping || 0.6;
  const apply = () => { needle.rotation.z = -angleOf(st.x); };
  apply();
  const off = c.engine.onFrame(dt => {
    if (st.x === target && st.v === 0) return;
    if (wrap) {                                             // кратчайший путь по кругу
      let d = target - st.x; d -= Math.round(d / range) * range;
      const goal = st.x + d;
      spring(st, goal, dt, omega, zeta);
      if (Math.abs(st.x - goal) < range * 2e-4 && Math.abs(st.v) < range * 2e-3) { st.x = target; st.v = 0; }
      else if (st.x < min || st.x >= max) st.x = lim(st.x);
      apply();
      return;
    }
    spring(st, target, dt, omega, zeta);
    // упоры шкалы
    if (st.x < min) { st.x = min; st.v = Math.abs(st.v) * 0.3; }
    if (st.x > max) { st.x = max; st.v = -Math.abs(st.v) * 0.3; }
    if (Math.abs(st.x - target) < range * 2e-4 && Math.abs(st.v) < range * 2e-3) { st.x = target; st.v = 0; }
    apply();
  });
  const api = {
    min, max,
    get value() { return target; },
    /** Положение стрелки в данный момент. */
    get shown() { return st.x; },
    setValue(v, o = {}) {
      target = lim(+v || 0);
      if (o.instant) { st.x = target; st.v = 0; apply(); }
    },
    /** Метка-указатель задания; null — убрать. */
    setBug(v) {
      if (v == null) { bug.visible = false; return; }
      bug.visible = true; bug.rotation.z = -angleOf(v);
    },
  };
  return finish(api, group, [off]);
}
