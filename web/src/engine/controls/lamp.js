// lamp — сигнальная лампа с ореолом; pushButton — кнопка.
import * as THREE from 'three';
import { merge, lathe, hitCylinder, hitBox } from '../geom.js';
import { toColor, PALETTE } from '../materials.js';
import { finish, callSafe } from './base.js';

const BLINK_HZ = 2.2;

/**
 * opts: { color='green'|'red'|'amber'|'white'|hex, radius=0.022, label, labelSize=0.024, state=false }
 * → { object3D, set(false|true|'blink'), state }
 * Источником света не является: эмиссивная линза + спрайт свечения.
 */
export function lamp(c, opts = {}) {
  const { color = 'green', radius: r = 0.022 } = opts;
  const col = toColor(color);
  const group = new THREE.Group();
  group.name = 'lamp';
  const bezel = lathe([[r * 1.5, 0], [r * 1.5, r * 0.35], [r * 1.5, r * 0.35], [r * 1.32, r * 0.62], [r * 1.08, r * 0.66], [r * 1.02, r * 0.5]], 20);
  group.add(new THREE.Mesh(bezel, c.mat.nickel));
  const lensG = new THREE.SphereGeometry(r * 1.04, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  lensG.rotateX(Math.PI / 2); lensG.scale(1, 1, 0.72); lensG.translate(0, 0, r * 0.4);
  {                                                         // плоские UV: колба и нить накала видны сквозь линзу
    const p = lensG.attributes.position, uv = lensG.attributes.uv, k = 1 / (r * 2.08);
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * k + 0.5, p.getY(i) * k + 0.5);
  }
  const offMat = c.mat.bulbLens ? c.mat.bulbLens(col, false) : c.mat.lens(col, false);
  const onMat = c.mat.bulbLens ? c.mat.bulbLens(col, true) : c.mat.lens(col, true);
  const lens = new THREE.Mesh(lensG, offMat);
  group.add(lens);
  const glow = new THREE.Sprite(c.mat.glowSprite(col, 0.8));
  glow.position.z = r * 1.3; glow.scale.setScalar(r * 7.5); glow.visible = false;
  group.add(glow);
  if (opts.label) {
    const p = c.ui.plate(opts.label, { size: opts.labelSize || 0.024, screws: false });
    p.object3D.position.set(0, -(r * 1.5 + 0.01 + p.h / 2), 0);
    group.add(p.object3D);
  }
  let state = false, lit = false;
  const show = b => { if (b !== lit) { lit = b; lens.material = b ? onMat : offMat; glow.visible = b; } };
  const off = c.engine.onFrame((dt, time) => {
    if (state === 'blink') show((time * BLINK_HZ) % 1 < 0.5);
  });
  const api = {
    get state() { return state; },
    set(s) { state = s === 'blink' ? 'blink' : !!s; if (state !== 'blink') show(state); },
  };
  api.set(opts.state || false);
  return finish(api, group, [off]);
}

/**
 * opts: { radius=0.03, color='black'|'red'|'green'|'ochre'|'ivory'|hex, label, labelSize=0.024, labelPos='bottom'|'top'|'none',
 *         onPress(n) (n — номер повтора, 0 — первое нажатие), hold=false (автоповтор при удержании), lit=false }
 * onPress вызывается в момент нажатия; при hold:true — повторяется (через 0.4 с, затем с ускорением до ~20 раз/с).
 * → { object3D, setLit(b), lit, pressed }
 */
export function pushButton(c, opts = {}) {
  const { radius: r = 0.03, color = 'black', labelPos = 'bottom' } = opts;
  const group = new THREE.Group();
  group.name = 'pushButton';
  const collar = lathe([[r * 1.36, 0], [r * 1.36, r * 0.22], [r * 1.36, r * 0.22], [r * 1.22, r * 0.42], [r * 1.07, r * 0.44], [r * 1.05, r * 0.2]], 24);
  group.add(new THREE.Mesh(collar, c.mat.nickel));
  const capG = lathe([[r, 0], [r, r * 0.62], [r * 0.96, r * 0.74], [r * 0.84, r * 0.82], [r * 0.5, r * 0.78], [0, r * 0.74]], 24);
  const col = toColor(color);
  const isBlack = color === 'black' || col.getHexString() === toColor(PALETTE.bakelite).getHexString();
  const baseMat = isBlack ? c.mat.bakelite : c.mat.paint(col, { wear: 0.2 });
  const litColor = isBlack ? toColor(PALETTE.lampAmber) : col;
  const litMat = c.mat.memo('btnLit:' + litColor.getHexString(), () => new THREE.MeshStandardMaterial({
    color: litColor.clone().multiplyScalar(0.7), emissive: litColor, emissiveIntensity: 1.25, roughness: 0.35, metalness: 0,
  }));
  const cap = new THREE.Mesh(capG, baseMat);
  group.add(cap);
  const glow = new THREE.Sprite(c.mat.glowSprite(litColor, 0.5));
  glow.position.z = r * 1.2; glow.scale.setScalar(r * 5.5); glow.visible = false;
  group.add(glow);
  let labelH = 0;
  if (opts.label && labelPos !== 'none') {
    const p = c.ui.plate(opts.label, { size: opts.labelSize || 0.024, screws: false });
    labelH = p.h;
    const y = r * 1.36 + 0.01 + p.h / 2;
    p.object3D.position.set(0, labelPos === 'top' ? y : -y, 0);
    group.add(p.object3D);
  }
  const hr = Math.max(r * 1.5, 0.045);
  const hit = hitCylinder(hr, r * 1.2 + 0.03);
  group.add(hit);

  let pressed = false, lit = false, z = 0, holdT = 0, repeats = 0, nextAt = 0;
  const travel = r * 0.3;
  function press() {
    c.audio.tick();
    callSafe(opts.onPress, repeats++);
  }
  const remove = c.input.add(hit, {
    onDown() {
      if (!api.enabled) return;
      pressed = true; holdT = 0; repeats = 0; nextAt = 0.42;
      press();
    },
    onUp() { if (pressed) { pressed = false; c.audio.tick(); } },
  });
  const off = c.engine.onFrame(dt => {
    const tz = pressed ? -travel : 0;
    if (z !== tz) {
      z += (tz - z) * (1 - Math.exp(-dt * (pressed ? 45 : 22)));
      if (Math.abs(z - tz) < 1e-5) z = tz;
      cap.position.z = z;
    }
    if (pressed && opts.hold) {
      holdT += dt;
      let guard = 0;
      while (holdT >= nextAt && guard++ < 4) {
        press();
        nextAt += Math.max(0.05, 0.16 * Math.pow(0.86, repeats));
      }
    }
  });
  const api = {
    get pressed() { return pressed; },
    get lit() { return lit; },
    setLit(b) { lit = !!b; cap.material = lit ? litMat : baseMat; glow.visible = lit; },
  };
  if (opts.lit) api.setLit(true);
  return finish(api, group, [remove, off]);
}
