// lever — рычаг (momentary / toggle); slewLever — подпружиненный рычаг привода влево/вправо.
import * as THREE from 'three';
import { merge, xf, slab, lathe, hitBox, rod } from '../geom.js';
import { makeCanvas, canvasTexture, drawLabel } from '../textures.js';
import { PALETTE } from '../materials.js';
import { finish, screenAxis, spring, callSafe, clamp, DEG } from './base.js';

const LEVER_SWING = 38 * DEG;      // отклонение рычага от нормали панели вверх/вниз

/**
 * Рычаг. Торчит из панели к игроку; верхнее положение — исходное.
 * opts: { length=0.22, color (цвет рукояти; по умолчанию чёрный бакелит), mode='momentary'|'toggle',
 *         labels: [верх, низ] — подписи положений (ставятся сбоку от прорези: labelSide='right'|'left'|'ends');
 *                 строка или один элемент — одна подпись под основанием; labelSize=0.024,
 *         onPull() — momentary: один раз за каждое полное протягивание вниз (≥ 88 % хода); возврат пружиной,
 *         onChange(on) — toggle: нижнее положение = on; меняется перетаскиванием или касанием,
 *         on=false (начальное состояние toggle) }
 * → { object3D, set(on) (без события), on, travel (0..1) }
 */
export function lever(c, opts = {}) {
  const { length: L = 0.22, mode = 'momentary' } = opts;
  const isToggle = mode === 'toggle';
  const group = new THREE.Group();
  group.name = 'lever';
  const throwY = L * Math.sin(LEVER_SWING);                   // ход рукояти по вертикали от оси
  const baseW = Math.max(0.07, L * 0.34), baseH = Math.max(0.12, throwY * 1.25 + 0.05), baseD = 0.014;
  const pivotZ = baseD + 0.012;

  // основание с прорезью
  group.add(new THREE.Mesh(merge([
    slab(baseW, baseH, baseD, { r: 0.012, bevel: 0.004 }),
    xf(new THREE.CylinderGeometry(0.017, 0.017, baseW * 0.78, 12), { r: [0, 0, Math.PI / 2], p: [0, 0, pivotZ] }),
  ]), c.mat.steel));
  const slot = new THREE.Mesh(slab(baseW * 0.3, baseH * 0.74, 0.003, { r: baseW * 0.14, bevel: 0.0008 }), c.mat.rubber);
  slot.position.z = baseD - 0.001;
  group.add(slot);

  // подвижная часть
  const arm = new THREE.Group();
  arm.position.set(0, 0, pivotZ);
  group.add(arm);
  const barW = Math.max(0.012, L * 0.065);
  arm.add(new THREE.Mesh(merge([
    xf(slab(barW, barW * 0.62, L - 0.01, { r: barW * 0.2, bevel: 0.0015 }), { p: [0, 0, 0] }),
    xf(new THREE.CylinderGeometry(0.02, 0.02, baseW * 0.3, 12), { r: [0, 0, Math.PI / 2] }),
  ]), c.mat.steel));
  const gripR = Math.max(0.015, L * 0.075), gripLen = Math.max(0.06, L * 0.36);
  const gripG = new THREE.CapsuleGeometry(gripR, gripLen, 4, 12);
  gripG.rotateZ(Math.PI / 2); gripG.translate(0, 0, L);
  arm.add(new THREE.Mesh(gripG, opts.color ? c.mat.paint(opts.color, { wear: 0.2 }) : (c.mat.knurled || c.mat.bakelite)));
  const handle = new THREE.Object3D(); handle.position.set(0, 0, L); arm.add(handle);

  // подписи: одна — под основанием; две — сбоку от прорези у верхнего и нижнего положений (не закрываются рукоятью)
  const labels = typeof opts.labels === 'string' ? [opts.labels] : (opts.labels || []);
  const lsize = opts.labelSize || 0.024;
  const side = opts.labelSide || 'right';
  const mk = text => c.ui.plate(text, { size: lsize, screws: false });
  if (labels.length === 1 && labels[0]) {
    const p = mk(labels[0]); p.object3D.position.set(0, -baseH / 2 - 0.01 - p.h / 2, 0); group.add(p.object3D);
  } else {
    labels.slice(0, 2).forEach((text, i) => {
      if (!text) return;
      const p = mk(text), sy = i === 0 ? 1 : -1;
      if (side === 'ends') p.object3D.position.set(0, sy * (baseH / 2 + 0.01 + p.h / 2), 0);
      else p.object3D.position.set((side === 'left' ? -1 : 1) * (baseW / 2 + 0.012 + p.w / 2), sy * throwY * 0.62, 0);
      group.add(p.object3D);
    });
  }

  const hit = hitBox(Math.max(baseW, gripLen + gripR * 2) + 0.03, throwY * 2 + 0.07, L + 0.05, 0, 0, (L + 0.05) / 2);
  group.add(hit);

  let on = !!opts.on && isToggle;
  let t = on ? 1 : 0;              // положение 0 (верх) … 1 (низ)
  let dragging = false, armed = true, axis = null, nudge = 0;
  const st = { x: t, v: 0 };
  const apply = () => { arm.rotation.x = -(LEVER_SWING - 2 * LEVER_SWING * st.x); };
  apply();

  function setOn(b, fire) {
    if (b === on) return;
    on = b;
    c.audio.clunk();
    if (fire) callSafe(opts.onChange, on);
  }

  const remove = c.input.add(hit, {
    onDown() {
      if (!api.enabled) return;
      dragging = true;
      axis = screenAxis(c, group, [0, 0, pivotZ], [0, -1, 0]);
      if (!axis.ok) axis = { x: 0, y: 1, ppm: 350, ok: true };
    },
    onDrag(e) {
      if (!dragging) return;
      const along = e.dx * axis.x + e.dy * axis.y;
      // ход рукояти на экране: проекция дуги ≈ 2·L·sin(swing); немного «облегчаем» — 85 % пути
      t = clamp(t + along / (axis.ppm * throwY * 2 * 0.85), 0, 1);
      st.x = t; st.v = 0; apply();
      if (isToggle) {
        if (!on && t > 0.72) setOn(true, true);
        else if (on && t < 0.28) setOn(false, true);
      } else {
        if (armed && t >= 0.88) { armed = false; c.audio.leverPull(); callSafe(opts.onPull); }
        else if (!armed && t < 0.3) armed = true;
      }
    },
    onUp() { dragging = false; },
    onTap() {
      if (!api.enabled) return;
      if (isToggle) setOn(!on, true);
      else { nudge = 0.12; c.audio.tick(); }             // касание без протяжки: рычаг только «качнётся»
    },
  });

  const off = c.engine.onFrame(dt => {
    if (dragging) return;
    let target = isToggle ? (on ? 1 : 0) : 0;
    if (nudge > 0) { nudge -= dt; target = 0.22; }
    if (st.x === target && st.v === 0) return;
    spring(st, target, dt, isToggle ? 26 : 20, isToggle ? 0.8 : 0.55);
    if (st.x < 0) { st.x = 0; st.v = -st.v * 0.3; }       // упоры
    if (st.x > 1) { st.x = 1; st.v = -st.v * 0.3; }
    if (Math.abs(st.x - target) < 0.0015 && Math.abs(st.v) < 0.02) { st.x = target; st.v = 0; }
    t = st.x;
    if (!isToggle && !armed && t < 0.3) armed = true;
    apply();
  });

  const api = {
    get on() { return on; },
    /** Текущее положение рукояти: 0 — верх, 1 — низ. */
    get travel() { return t; },
    /** Object3D в центре рукояти (для подсказок и тестов). */
    handle,
    /** toggle: установить состояние без вызова onChange. */
    set(b) { if (isToggle) on = !!b; },
  };
  return finish(api, group, [remove, off]);
}

const SLEW_MAX = 32 * DEG;

/**
 * Рычаг привода: стоит вертикально на панели, отклоняется влево/вправо, сам возвращается в ноль.
 * opts: { length=0.2, onInput(v) — v ∈ [−1,1] (вправо = +) каждый кадр, пока рычаг удерживается; при отпускании — один раз onInput(0),
 *         labels=['ВЛЕВО','ВПРАВО'] (подписи на секторе; false — без шкалы), deadZone=0.08 }
 * → { object3D, value (0, если отпущен) }
 */
export function slewLever(c, opts = {}) {
  const { length: L = 0.2, deadZone = 0.08 } = opts;
  const labels = opts.labels === false ? null : (opts.labels || ['ВЛЕВО', 'ВПРАВО']);
  const group = new THREE.Group();
  group.name = 'slewLever';
  const halfW = L * Math.sin(SLEW_MAX) + 0.055;
  const W = halfW * 2, Hh = L + 0.085, cy = Hh / 2 - 0.045;     // ось рычага — на 0.045 выше нижнего края

  // сектор-шкала (шильдик с дугой)
  {
    const ppm = Math.min(1400, 512 / W, 512 / Hh), cw = Math.round(W * ppm), ch = Math.round(Hh * ppm);
    const cv = makeCanvas(cw, ch), ctx = cv.getContext('2d');
    ctx.fillStyle = PALETTE.plateBlack; ctx.fillRect(0, 0, cw, ch);
    const g = ctx.createLinearGradient(0, 0, 0, ch);
    g.addColorStop(0, 'rgba(255,255,255,0.08)'); g.addColorStop(1, 'rgba(0,0,0,0.2)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
    const px = cw / 2, py = ch - 0.045 * ppm, ra = (L * 0.8) * ppm;
    ctx.strokeStyle = PALETTE.ivory; ctx.lineCap = 'butt';
    ctx.lineWidth = Math.max(1.5, 0.003 * ppm);
    ctx.beginPath(); ctx.arc(px, py, ra, -Math.PI / 2 - SLEW_MAX, -Math.PI / 2 + SLEW_MAX); ctx.stroke();
    for (let i = -4; i <= 4; i++) {
      const a = -Math.PI / 2 + SLEW_MAX * i / 4, big = i % 2 === 0;
      const r1 = ra + (big ? 0.016 : 0.009) * ppm;
      ctx.lineWidth = Math.max(1.5, (i === 0 ? 0.005 : 0.003) * ppm);
      ctx.strokeStyle = i === 0 ? PALETTE.ochre : PALETTE.ivory;
      ctx.beginPath(); ctx.moveTo(px + Math.cos(a) * ra, py + Math.sin(a) * ra); ctx.lineTo(px + Math.cos(a) * r1, py + Math.sin(a) * r1); ctx.stroke();
    }
    if (labels) {
      const cap = Math.min(0.024, L * 0.12) * ppm;
      drawLabel(ctx, labels[0], cw * 0.2, ch - 0.028 * ppm, cap, { color: PALETTE.ivory, maxWidth: cw * 0.31 });
      drawLabel(ctx, labels[1], cw * 0.8, ch - 0.028 * ppm, cap, { color: PALETTE.ivory, maxWidth: cw * 0.31 });
    }
    const tex = canvasTexture(cv, { aniso: 8 });
    const m = new THREE.Mesh(slab(W, Hh, 0.006, { r: 0.012, bevel: 0.0015 }), [
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.3 }),
    ][0]);
    // UV: лицевая грань 0..1
    const pos = m.geometry.attributes.position, uv = m.geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / W + 0.5, pos.getY(i) / Hh + 0.5);
    m.position.y = cy;
    group.add(m);
  }

  // опора (сталь)
  group.add(new THREE.Mesh(lathe([[0.034, 0.006], [0.034, 0.02], [0.034, 0.02], [0.027, 0.03], [0.012, 0.036], [0, 0.036]], 20), c.mat.steel));

  // рычаг: охристая штанга, бакелитовая рукоять
  const arm = new THREE.Group();
  arm.position.z = 0.03;
  group.add(arm);
  const barR = Math.max(0.008, L * 0.045);
  const bar = merge([
    rod([0, 0, 0], [0, L * 0.92, 0], barR, 10, barR * 0.8),
    xf(lathe([[0.022, -0.004], [0.022, 0.01], [0.016, 0.016], [0, 0.016]], 14), {}),
  ]);
  arm.add(new THREE.Mesh(bar, c.mat.ochre));
  const gripR = Math.max(0.021, L * 0.11);
  const grip = new THREE.SphereGeometry(gripR, 16, 12); grip.scale(1, 1.25, 1); grip.translate(0, L, 0);
  arm.add(new THREE.Mesh(grip, c.mat.knurled || c.mat.bakelite));
  const handle = new THREE.Object3D(); handle.position.set(0, L, 0); arm.add(handle);

  const hit = hitBox(W + 0.02, Hh + 0.04, 0.09, 0, cy + 0.01, 0.045);
  group.add(hit);

  let held = false, raw = 0, value = 0, axis = null, v0 = 0;
  const st = { x: 0, v: 0 };
  const apply = () => { arm.rotation.z = -st.x * SLEW_MAX; };

  const remove = c.input.add(hit, {
    onDown() {
      if (!api.enabled) return;
      held = true; v0 = st.x;
      axis = screenAxis(c, group, [0, L, 0.03], [1, 0, 0]);
      if (!axis.ok) axis = { x: 1, y: 0, ppm: 350, ok: true };
    },
    onDrag(e) {
      if (!held) return;
      const along = e.totalDx * axis.x + e.totalDy * axis.y;
      const sens = (c.engine.settings && +c.engine.settings.sens) || 1;   // настройка чувствительности: рычаг отклоняется охотнее
      raw = clamp(v0 + along * sens / (axis.ppm * L * Math.sin(SLEW_MAX)), -1, 1);
      st.x = raw; st.v = 0; apply();
    },
    onUp() {
      if (!held) return;
      held = false; raw = 0; value = 0;
      c.audio.tick();
      callSafe(opts.onInput, 0);
    },
  });

  const off = c.engine.onFrame(dt => {
    if (held) {
      const a = Math.abs(st.x);
      value = a <= deadZone ? 0 : Math.sign(st.x) * (a - deadZone) / (1 - deadZone);
      callSafe(opts.onInput, value);
      return;
    }
    if (st.x === 0 && st.v === 0) return;
    spring(st, 0, dt, 22, 0.5);
    if (Math.abs(st.x) < 0.002 && Math.abs(st.v) < 0.03) { st.x = 0; st.v = 0; }
    apply();
  });

  const api = {
    /** Текущее значение −1…1 (0, если рычаг отпущен). */
    get value() { return value; },
    get held() { return held; },
    /** Отклонение рычага в данный момент (−1…1, с учётом возврата пружиной). */
    get position() { return st.x; },
    /** Object3D в центре рукояти (для подсказок и тестов). */
    handle,
  };
  return finish(api, group, [remove, off]);
}
