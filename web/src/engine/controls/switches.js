// toggle — тумблер; cover — откидная предохранительная крышка; rotarySelector — галетный переключатель.
import * as THREE from 'three';
import { merge, xf, slab, lathe, hitBox, hitCylinder, hexGeometry, extrude } from '../geom.js';
import { makeCanvas, canvasTexture, drawLabel, upper, measureLabel } from '../textures.js';
import { PALETTE } from '../materials.js';
import { finish, planeMapper, sweepAngle, spring, callSafe, clamp, DEG, TAU, wrapPi, localPlanePoint } from './base.js';

const TOGGLE_TILT = 27 * DEG;

/**
 * Тумблер на два положения.
 * opts: { labels:[a,b], value=0, orient='v'|'h', size=1 (масштаб), labelSize=0.024, onChange(i) }
 *   orient 'v': labels[0] снизу (value 0 — ручка вниз), labels[1] сверху;  orient 'h': labels[0] слева, labels[1] справа.
 * Касание по тумблеру — переключить; касание по подписи — выбрать её; перетаскивание — в сторону движения.
 * → { object3D, set(i) (без события), value }
 */
export function toggle(c, opts = {}) {
  const { orient = 'v', size: s = 1 } = opts;
  const labels = opts.labels || [];
  const group = new THREE.Group();
  group.name = 'toggle';
  const nutR = 0.027 * s;
  group.add(new THREE.Mesh(merge([
    lathe([[nutR * 1.45, 0], [nutR * 1.45, 0.004 * s], [nutR * 1.45, 0.004 * s], [nutR * 1.2, 0.006 * s], [0, 0.006 * s]], 20),
    xf(hexGeometry(nutR, 0.01 * s), { p: [0, 0, 0.005 * s] }),
    lathe([[nutR * 0.55, 0.015 * s], [nutR * 0.55, 0.025 * s], [nutR * 0.42, 0.029 * s], [0, 0.029 * s]], 14),
  ]), c.mat.nickel));
  const bat = new THREE.Group();
  bat.position.z = 0.018 * s;
  group.add(bat);
  const bl = 0.066 * s;
  bat.add(new THREE.Mesh(lathe([[0.0085 * s, 0], [0.009 * s, bl * 0.35], [0.013 * s, bl * 0.8], [0.014 * s, bl * 0.92], [0.01 * s, bl], [0, bl]], 12), c.mat.nickel));

  const lsize = opts.labelSize || 0.024;
  const off0 = nutR * 1.45 + 0.012 + bl * 0.42;         // подписи — за пределами хода ручки
  const plates = [];
  labels.forEach((text, i) => {
    if (!text) return;
    const p = c.ui.plate(text, { size: lsize, screws: false });
    const sgn = i === 0 ? -1 : 1;
    if (orient === 'h') p.object3D.position.set(sgn * (off0 + p.w / 2), 0, 0);
    else p.object3D.position.set(0, sgn * (off0 + p.h / 2), 0);
    plates[i] = p;
    group.add(p.object3D);
  });
  // объём касания охватывает тумблер и подписи
  let ext0 = off0, ext1 = off0;
  if (plates[0]) ext0 += orient === 'h' ? plates[0].w : plates[0].h;
  if (plates[1]) ext1 += orient === 'h' ? plates[1].w : plates[1].h;
  const cross = Math.max(0.075, ...plates.filter(Boolean).map(p => orient === 'h' ? p.h : p.w)) + 0.015;
  const along = ext0 + ext1 + 0.015, mid = (ext1 - ext0) / 2;
  const hit = orient === 'h' ? hitBox(along, cross, 0.09, mid, 0, 0.045) : hitBox(cross, along, 0.09, 0, mid, 0.045);
  group.add(hit);

  let value = opts.value ? 1 : 0, flipped = false;
  const st = { x: value, v: 0 };
  const apply = () => {
    const a = (st.x * 2 - 1) * TOGGLE_TILT;
    if (orient === 'h') bat.rotation.set(0, a, 0); else bat.rotation.set(-a, 0, 0);
  };
  apply();
  function setValue(i, fire) {
    i = i ? 1 : 0;
    if (i === value) return;
    value = i;
    c.audio.switchFlip();
    if (fire) callSafe(opts.onChange, value);
  }
  const remove = c.input.add(hit, {
    onDown() { flipped = false; },
    onDrag(e) {
      if (!api.enabled || flipped || !e.dragging) return;
      // направление в экранных координатах: вверх/вправо — положение 1
      const d = orient === 'h' ? e.totalDx : -e.totalDy;
      if (Math.abs(d) > 12) { flipped = true; setValue(d > 0 ? 1 : 0, true); }
    },
    onTap(e) {
      if (!api.enabled) return;
      let side = 0;
      const lp = localPlanePoint(c, group, e, 0);            // точка на плоскости панели (без параллакса)
      if (lp) {
        const a = orient === 'h' ? lp.x : lp.y;
        if (Math.abs(a) > off0 - 0.006) side = a > 0 ? 1 : -1;
      }
      if (side === 0) setValue(value ? 0 : 1, true);
      else setValue(side > 0 ? 1 : 0, true);
    },
  });
  const off = c.engine.onFrame(dt => {
    if (st.x === value && st.v === 0) return;
    spring(st, value, dt, 34, 0.6);
    if (Math.abs(st.x - value) < 0.002 && Math.abs(st.v) < 0.05) { st.x = value; st.v = 0; }
    apply();
  });
  const api = {
    get value() { return value; },
    set(i) { value = i ? 1 : 0; },
  };
  return finish(api, group, [remove, off]);
}

const COVER_OPEN = 112 * DEG;

/**
 * Откидная предохранительная крышка (красная) над элементом. Ставится в ту же точку панели, что и элемент.
 * Пока крышка закрыта, она перехватывает касания элемента под ней.
 * opts: { w=0.1, h=0.13, depth=0.1, open=false, label (надпись на крышке), onChange(open),
 *         guards: [органы] — пока крышка закрыта, у них enabled=false (см. также guard(ctrl)) }
 * Касание — открыть/закрыть; перетаскивание вверх — открыть, вниз — закрыть.
 * → { object3D, open, set(b) (без события), guard(ctrl) }
 */
export function cover(c, opts = {}) {
  const { w = 0.1, h = 0.13, depth = 0.1 } = opts;
  const group = new THREE.Group();
  group.name = 'cover';
  const th = 0.005, hingeY = h / 2 + 0.012, hingeZ = 0.012;
  // петля
  group.add(new THREE.Mesh(merge([
    xf(new THREE.CylinderGeometry(0.008, 0.008, w * 0.9, 10), { r: [0, 0, Math.PI / 2], p: [0, hingeY, hingeZ] }),
    xf(slab(w * 0.96, 0.022, 0.006, { r: 0.004, bevel: 0.0015 }), { p: [0, hingeY, 0] }),
  ]), c.mat.steel));
  const lid = new THREE.Group();
  lid.position.set(0, hingeY, hingeZ);
  group.add(lid);
  // крышка-короб: передняя стенка и две боковины (без дна — виден элемент под ней снизу)
  const lidH = h + 0.012;
  const red = c.mat.paint(PALETTE.plateRed, { wear: 0.5 });
  const parts = [
    xf(slab(w, lidH, th, { r: 0.01, bevel: 0.0018 }), { p: [0, -lidH / 2, depth - hingeZ - th] }),
    xf(new THREE.BoxGeometry(th, lidH * 0.96, depth - hingeZ), { p: [-w / 2 + th / 2, -lidH / 2, (depth - hingeZ) / 2] }),
    xf(new THREE.BoxGeometry(th, lidH * 0.96, depth - hingeZ), { p: [w / 2 - th / 2, -lidH / 2, (depth - hingeZ) / 2] }),
    xf(new THREE.BoxGeometry(w, th, depth - hingeZ), { p: [0, -th / 2, (depth - hingeZ) / 2] }),
  ];
  const lidMesh = new THREE.Mesh(merge(parts), red);
  lid.add(lidMesh);
  // язычок-ручка снизу
  lid.add(new THREE.Mesh(xf(slab(w * 0.34, 0.02, 0.012, { r: 0.004, bevel: 0.002 }), { p: [0, -lidH - 0.004, depth - hingeZ - 0.01] }), c.mat.steel));
  if (opts.label) {
    const p = c.ui.plate(opts.label, { style: 'red', size: opts.labelSize || 0.02, w: w * 0.86, screws: false });
    p.object3D.position.set(0, -lidH / 2, depth - hingeZ + 0.0005);
    lid.add(p.object3D);
  }
  const hit = hitBox(w + 0.02, lidH + 0.03, depth + 0.012, 0, -lidH / 2, (depth - hingeZ) / 2);
  lid.add(hit);

  let open = !!opts.open, flipped = false;
  const st = { x: open ? 1 : 0, v: 0 };
  const apply = () => { lid.rotation.x = -st.x * COVER_OPEN; };
  apply();
  let handle = null;
  const guarded = [];
  const syncGuards = () => guarded.forEach(g => { g.enabled = open; });
  function setOpen(b, fire) {
    if (b === open) return;
    open = b;
    handle.item.priority = open ? 0 : 10;
    syncGuards();
    c.audio.switchFlip();
    if (fire) callSafe(opts.onChange, open);
  }
  handle = c.input.add(hit, {
    onDown() { flipped = false; },
    onDrag(e) {
      if (!api.enabled || flipped || !e.dragging) return;
      if (Math.abs(e.totalDy) > 14) { flipped = true; setOpen(e.totalDy < 0, true); }
    },
    onTap() { if (api.enabled) setOpen(!open, true); },
  }, { priority: open ? 0 : 10 });
  const off = c.engine.onFrame(dt => {
    const target = open ? 1 : 0;
    if (st.x === target && st.v === 0) return;
    spring(st, target, dt, 17, 0.62);
    if (st.x < 0) { st.x = 0; st.v = -st.v * 0.25; if (Math.abs(st.v) > 0.3) c.audio.tick(); }
    if (Math.abs(st.x - target) < 0.002 && Math.abs(st.v) < 0.03) { st.x = target; st.v = 0; }
    apply();
  });
  const api = {
    get open() { return open; },
    /** Object3D откидной части (для подсказок и тестов). */
    lid,
    set(b) { b = !!b; if (b !== open) { open = b; handle.item.priority = open ? 0 : 10; syncGuards(); } },
    /** Орган под крышкой: недоступен (enabled=false), пока крышка закрыта. */
    guard(ctrl) { guarded.push(ctrl); ctrl.enabled = open; return ctrl; },
  };
  (opts.guards || []).forEach(g => api.guard(g));
  return finish(api, group, [handle, off]);
}

/**
 * Галетный переключатель с фиксацией.
 * opts: { positions=6, labels (по умолчанию '1'…'N'), radius=0.045 (ручка), value=0, step (градусов между положениями),
 *         labelSize (высота прописной на шкале, м; по умолчанию 0.024), onChange(i) }
 * Поворот — круговым перетаскиванием ручки; выбор — касанием подписи; касание ручки — следующее положение.
 * → { object3D, set(i) (без события), value }
 */
export function rotarySelector(c, opts = {}) {
  const n = Math.max(2, opts.positions || (opts.labels ? opts.labels.length : 6));
  const R = opts.radius || 0.045;
  const labels = (opts.labels || Array.from({ length: n }, (_, i) => String(i + 1))).map(upper);
  const step = (opts.step || (n <= 3 ? 50 : Math.min(45, 300 / (n - 1)))) * DEG;
  const cap = opts.labelSize || 0.024;
  const angleOf = i => (i - (n - 1) / 2) * step;            // по часовой от «12 часов»
  // радиус кольца подписей: учитываем ширину самой длинной подписи
  const maxW = Math.max(...labels.map(l => measureLabel(l, 100).width / 100 * cap));
  const ringR = R + 0.02 + Math.max(cap * 0.75, Math.min(maxW / 2, cap * 1.6));
  const plateR = ringR + Math.max(cap * 0.85, Math.min(maxW / 2, cap * 1.6)) + 0.008;
  const group = new THREE.Group();
  group.name = 'rotarySelector';

  // шкала
  {
    const ppm = Math.min(1500, 512 / (plateR * 2)), S = Math.round(plateR * 2 * ppm);
    const cv = makeCanvas(S, S), ctx = cv.getContext('2d'), h = S / 2;
    ctx.fillStyle = PALETTE.plateBlack; ctx.beginPath(); ctx.arc(h, h, h, 0, TAU); ctx.fill();
    const g = ctx.createRadialGradient(h, h * 0.6, h * 0.1, h, h, h);
    g.addColorStop(0, 'rgba(255,255,255,0.07)'); g.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(h, h, h, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(232,224,200,0.5)'; ctx.lineWidth = Math.max(1, 0.0018 * ppm);
    ctx.beginPath(); ctx.arc(h, h, h - 0.004 * ppm, 0, TAU); ctx.stroke();
    for (let i = 0; i < n; i++) {
      const a = angleOf(i), sx = Math.sin(a), sy = -Math.cos(a);
      ctx.strokeStyle = PALETTE.ivory; ctx.lineWidth = Math.max(1.5, 0.003 * ppm);
      ctx.beginPath(); ctx.moveTo(h + sx * (R + 0.006) * ppm, h + sy * (R + 0.006) * ppm);
      ctx.lineTo(h + sx * (R + 0.016) * ppm, h + sy * (R + 0.016) * ppm); ctx.stroke();
      drawLabel(ctx, labels[i], h + sx * ringR * ppm, h + sy * ringR * ppm, cap * ppm, { color: PALETTE.ivory, maxWidth: cap * 3.4 * ppm });
    }
    const tex = canvasTexture(cv, { aniso: 8 });
    const dial = new THREE.Mesh(new THREE.CircleGeometry(plateR, 40), new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.45, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    dial.position.z = 0.0015;
    group.add(dial);
  }
  // никелевая юбка
  group.add(new THREE.Mesh(lathe([[R * 1.06, 0.002], [R * 1.06, 0.006], [R * 0.98, 0.01], [R * 0.9, 0.01]], 28), c.mat.nickel));

  // ручка-«клювик»
  const knob = new THREE.Group();
  knob.position.z = 0.008;
  group.add(knob);
  const shape = new THREE.Shape();
  const rb = R * 0.62, rt = R * 0.2, yt = R * 0.98;          // круглая спинка и узкий носик
  const a0 = Math.acos((rb - rt) / yt);                      // точки касания общих касательных
  shape.absarc(0, 0, rb, Math.PI / 2 + a0, Math.PI / 2 - a0 + TAU, false);
  shape.absarc(0, yt, rt, Math.PI / 2 - a0, Math.PI / 2 + a0, false);
  const body = extrude(shape, 0.03, 0.006, 3, 10);
  knob.add(new THREE.Mesh(merge([body, lathe([[R * 0.86, 0], [R * 0.86, 0.008], [R * 0.7, 0.012]], 24)]), c.mat.bakelite));
  const mark = new THREE.Mesh(xf(slab(R * 0.085, R * 0.62, 0.002, { r: R * 0.03, bevel: 0.0004 }), { p: [0, R * 0.62, 0.03] }), c.mat.ivory);
  knob.add(mark);

  const hit = hitCylinder(plateR + 0.006, 0.06);
  group.add(hit);

  let value = clamp(opts.value | 0, 0, n - 1);
  let mapper = null, pu = 0, pv = 0, raw = 0, dragging = false;
  const st = { x: angleOf(value), v: 0 };
  const apply = () => { knob.rotation.z = -st.x; };
  apply();
  function setValue(i, fire) {
    i = clamp(i, 0, n - 1);
    if (i === value) return;
    value = i;
    c.audio.tick();
    if (fire) callSafe(opts.onChange, value);
  }
  const remove = c.input.add(hit, {
    onDown(e) {
      if (!api.enabled) return;
      mapper = planeMapper(c, group, 0.02, R);
      [pu, pv] = mapper.map(e.x, e.y);
      raw = angleOf(value); dragging = true;
    },
    onDrag(e) {
      if (!dragging || !e.dragging) return;
      const [u, v] = mapper.map(e.x, e.y);
      const dPhi = sweepAngle(pu, pv, u, v, R * 0.35);
      pu = u; pv = v;
      // по часовой (на экране) = увеличение угла ручки
      raw = clamp(raw + (mapper.facing ? -dPhi : dPhi), angleOf(0) - step * 0.45, angleOf(n - 1) + step * 0.45);
      const i = clamp(Math.round(raw / step + (n - 1) / 2), 0, n - 1);
      setValue(i, true);
      // ручка «прилипает» к фиксатору: показываем положение между пальцем и фиксатором
      st.x = angleOf(value) + (raw - angleOf(value)) * 0.45; st.v = 0;
      apply();
    },
    onUp() { dragging = false; },
    onTap(e) {
      if (!api.enabled || !mapper) return;
      const [u, v] = mapper.map(e.x, e.y);
      const dist = Math.hypot(u, v);
      if (dist > R * 1.12) {                                  // касание подписи
        let a = Math.atan2(u, v);                              // по часовой от «12 часов» в плоскости органа
        if (!mapper.facing) a = -a;
        let best = -1, bd = step * 0.62;
        for (let i = 0; i < n; i++) { const d = Math.abs(wrapPi(a - angleOf(i))); if (d < bd) { bd = d; best = i; } }
        if (best >= 0) setValue(best, true);
      } else setValue((value + 1) % n, true);                 // касание ручки — следующее положение (по кругу)
    },
  });
  const off = c.engine.onFrame(dt => {
    if (dragging) return;
    const target = angleOf(value);
    if (st.x === target && st.v === 0) return;
    spring(st, target, dt, 30, 0.62);
    if (Math.abs(st.x - target) < 0.002 && Math.abs(st.v) < 0.05) { st.x = target; st.v = 0; }
    apply();
  });
  const api = {
    positions: n,
    get value() { return value; },
    /** Центр подписи положения i в локальных координатах органа ([x, y, z]). */
    labelPoint(i) { const a = angleOf(i); return [Math.sin(a) * ringR, Math.cos(a) * ringR, 0]; },
    set(i) { value = clamp(i | 0, 0, n - 1); },
  };
  return finish(api, group, [remove, off]);
}
