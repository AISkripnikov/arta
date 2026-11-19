// Пост «НАБЛЮДЕНИЕ» (id 'observe'): стереотруба-дальномер. В окуляре — мир снаружи по пеленгу трубы (seasky.js — то же
// небо, море, время суток и погода, что в смотровой щели и над зениткой): корабли (ships.js) с дымом из труб, следом,
// пожарами и огнями, всплески своих снарядов, вспышки чужих орудий, «люстры», дымзавесы, самолёты налёта, свои.
// Сцена рисуется в текстуру 512×512 × engine.quality.rtScale и показывается на круглом «стекле» под сеткой
// (деления через 0,5°). Сцена обновляется и рисуется ТОЛЬКО пока пост текущий (≤ ~30 раз/с).
// Пост ничего не решает сам: показывает game.state.scope и вызывает game.setScope()/game.scopeMark().
//
// hotspots: scopeWheel (маховик пеленга), zoomLever (кратность ×4/×10), markButton (= scopeMarkBtn, «ЗАСЕЧЬ ПЕЛЕНГ»),
//           toTargetButton («НА ЦЕЛЬ»), eyepiece (стекло окуляра: его можно тащить пальцем — труба поворачивается;
//           касание — придвинуться к окуляру / отодвинуться).
import { createOutside, wrap180, clamp } from './seasky.js';

const DEG = Math.PI / 180;
const RT = 512;                // текстура окуляра
const EYE = 40;                // высота трубы над морем, м
const EX = 2.2;                // корабли в трубе чуть крупнее натуры — чтобы читался силуэт на экране телефона
const PITCH = -0.22 * DEG;     // труба чуть опущена: горизонт немного выше центра сетки
const norm360 = (a) => ((a % 360) + 360) % 360;

// ---------- сцена за окуляром ----------
function createScopeView(ctx) {
  const { engine, THREE, game } = ctx;
  const world = createOutside(ctx, { eye: EYE, ex: EX, near: 30, view: 'scope', splashLife: 3.6, fxScale: () => 0.8, planeScale: () => 6 });
  const scene = world.scene, cam = world.camera;
  cam.fov = 16; cam.aspect = 1; cam.updateProjectionMatrix();
  // размер и сглаживание текстуры окуляра следуют настройке «качество графики» (engine.quality)
  const rtSize = (q) => Math.max(128, Math.round(RT * ((q && q.rtScale) || 1)));
  const q0 = engine.quality;
  const rt = new THREE.WebGLRenderTarget(rtSize(q0), rtSize(q0), { depthBuffer: true, samples: q0 ? q0.samples : 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  engine.on('quality', (q) => { rt.samples = q.samples; rt.dispose(); rt.setSize(rtSize(q), rtSize(q)); world.setQuality(q); lastRender = -1; });
  const info = { renders: 0, ships: 0, planes: 0, splashes: 0, flares: 0, smokes: 0, flashes: 0, inView: false, mode: '', tod: '', bearing: 0, fov: 16, particles: 0 };

  let b0 = 0, halfFov = 8;
  function place(o, g, friendly, b) {
    if (!friendly && o.alive && Math.abs(wrap180(b - b0)) <= halfFov) info.inView = true;
    return true;
  }

  let vt = 0, lastRender = -1, lastB = null, lastFov = 0;

  function syncWorld(dt) {
    const s = game.state, m = s.mission;
    if (!m || !m.battery) return false;
    const sc = s.scope || { bearing: 0, zoom: 4 };
    b0 = sc.bearing; halfFov = 32 / (sc.zoom || 4);
    info.bearing = b0; info.fov = halfFov * 2;
    info.mode = (m.night ? 'n' : 'd') + (m.weather || 'clear');
    cam.rotation.set(PITCH, -b0 * DEG, 0);
    if (cam.fov !== halfFov * 2) { cam.fov = halfFov * 2; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    info.inView = false;
    if (!world.sync(dt, vt, place)) return false;
    info.tod = world.info.tod;
    info.ships = world.fleet.shown; info.planes = world.wing.shown;
    info.flares = world.flares; info.smokes = world.smokes; info.splashes = world.splashes;
    // вспышки орудий: 0,4 с после выстрела цели (сами вспышки и дым — в world.sync)
    let n = 0;
    for (const t of s.targets || []) if (t.firedAt != null && !t.sunk && !t.escaped && s.time - t.firedAt >= 0 && s.time - t.firedAt <= 0.4) n++;
    info.flashes = n;
    return true;
  }

  function render() {
    world.render(rt, cam.fov * DEG / rt.height);
    info.particles = world.info.particles;
    info.renders++; lastRender = vt; lastB = b0; lastFov = halfFov;
  }

  return {
    texture: rt.texture, renderTarget: rt, info, scene, cam, world,
    /** Событие impact: всплеск/разрыв в истинной точке падения. */
    impact(e) {
      const shown = world.impact(e, (d, dark) => !(dark && d > 12));
      if (shown) info.splashes++;
      return shown;
    },
    reset() { world.reset(); lastRender = -1; info.splashes = 0; },
    /** here — пост текущий: только тогда сцена обновляется и рисуется (не чаще ~30 раз/с). */
    update(dt, here) {
      vt += dt;
      if (!here && lastRender >= 0) return;
      const sc = game.state.scope;
      const gap = vt - lastRender;
      // «экономное» качество: окуляр 5 раз в секунду, пока труба стоит, и до 15 — пока её наводят;
      // среднее (quality.viewGap 0.1) — не чаще 10 раз в секунду
      const qq = engine.quality, low = qq && qq.tier === 'low', vg = (qq && qq.viewGap) || 0, moving = sc && (sc.bearing !== lastB || 32 / sc.zoom !== lastFov);
      if (lastRender >= 0 && gap < (low ? 0.2 : Math.max(0.03, vg)) && !(moving && gap >= Math.max(low ? 0.066 : 0.015, vg))) return;
      if (syncWorld(lastRender < 0 ? dt : Math.min(gap, 0.5))) render();
    },
    dispose() {
      world.dispose(); rt.dispose();
    },
  };
}

// ---------- пост ----------
export function createObserveStation(ctx) {
  const { engine, THREE, ui, mat, game } = ctx;
  const G = engine.geom, T = engine.textures;
  const PAL = mat.PALETTE;
  const group = new THREE.Group();
  group.name = 'station:observe';
  const put = (ctl, x, y, z, rx = 0) => { ctl.object3D.position.set(x, y, z); ctl.object3D.rotation.x = rx; group.add(ctl.object3D); return ctl; };
  const ctrls = [], disposables = [];
  const keep = (c) => { ctrls.push(c); return c; };

  // тумба и лицевая панель (зона управления |x| ≤ 0.85, 0.74 ≤ y ≤ 1.46, z ≈ 0)
  keep(put(ui.panel({ w: 1.62, h: 0.74, d: 0.44, color: PAL.panelDark, rivets: 0.12, wear: 0.8 }), 0, 0.41, -0.5));
  const FY = 1.125;
  const fascia = keep(put(ui.panel({ w: 1.7, h: 0.69, d: 0.06, rivets: 0.1 }), 0, FY, -0.07));
  const on = (c, x, y) => keep(fascia.add(c, x, y - FY));

  // --- труба: латунный ободок окуляра, стальной корпус и «рога» дальномера ---
  const VR = 0.262, VY = 1.19;                      // радиус и высота центра стекла
  const brass = mat.memo('observe:brass', () => new THREE.MeshStandardMaterial({ color: 0xb8923a, roughness: 0.34, metalness: 1 }));
  const view = createScopeView(ctx);
  const glassMat = new THREE.MeshBasicMaterial({ map: view.texture, toneMapped: false });
  const glassGeo = new THREE.CircleGeometry(VR, 48);
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.name = 'scopeGlass'; glass.position.set(0, VY, 0.004);
  group.add(glass);
  // сетка: деления через 0,5°, подписи градусов; перерисовывается при смене кратности и дня/ночи
  const retCv = T.makeCanvas(RT, RT), retTex = T.canvasTexture(retCv, { aniso: 2, mipmaps: false });
  const retMat = new THREE.MeshBasicMaterial({ map: retTex, transparent: true, toneMapped: false, depthWrite: false });
  const reticle = new THREE.Mesh(glassGeo, retMat);
  reticle.position.set(0, VY, 0.0052); reticle.renderOrder = 3;
  group.add(reticle);
  let retKey = '';
  function drawReticle(zoom, night) {
    const key = zoom + (night ? 'n' : 'd');
    if (key === retKey) return;
    retKey = key;
    const c = retCv.getContext('2d'), R = RT / 2, fov = 64 / zoom, k = R / Math.tan(fov / 2 * DEG);
    const ink = night ? 'rgba(255,186,96,0.95)' : 'rgba(10,14,18,0.92)';
    const px = (a) => R + Math.tan(a * DEG) * k;
    c.clearRect(0, 0, RT, RT);
    c.fillStyle = ink;
    // шкала опущена под центр: цель и разрыв у горизонта не закрыты штрихами
    const cy = R + RT * 0.085, lim = fov / 2 * 0.8, numStep = zoom >= 7 ? 1 : 2;
    c.fillRect(px(-lim), cy - 0.6, px(lim) - px(-lim), 1.2);
    for (let i = Math.ceil(-lim * 2); i <= lim * 2; i++) {
      const a = i / 2, x = px(a), whole = i % 2 === 0, big = whole && (a % numStep === 0);
      c.fillRect(x - (big || i === 0 ? 1 : 0.7), cy, big || i === 0 ? 2 : 1.4, i === 0 ? 22 : big ? 16 : whole ? 11 : 6);
      if (big && a !== 0) T.drawLabel(c, String(Math.abs(a)), x, cy + 29, 13, { color: ink, weight: 700 });
    }
    const vl = fov / 2 * 0.5;
    c.fillRect(R - 0.6, px(-vl), 1.2, px(-0.5) - px(-vl));
    for (let i = Math.ceil(-vl * 2); i <= -1; i++) {
      const y = px(i / 2), whole = i % 2 === 0;
      c.fillRect(R - (whole ? 9 : 5), y - 0.7, whole ? 18 : 10, 1.4);
    }
    c.fillRect(R - 9, R - 0.6, 5, 1.2); c.fillRect(R + 4, R - 0.6, 5, 1.2); c.fillRect(R - 0.6, R + 4, 1.2, 6);      // центр: разорванный крест
    T.drawLabel(c, '×' + zoom, R, RT * 0.9, 13, { color: ink, weight: 700 });
    // виньетка окуляра
    const g = c.createRadialGradient(R, R, R * 0.86, R, R, R);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.75, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0.95)');
    c.fillStyle = g; c.fillRect(0, 0, RT, RT);
    retTex.needsUpdate = true;
  }
  drawReticle(4, false);
  // корпус
  const steelParts = [
    G.xf(new THREE.RingGeometry(VR - 0.004, VR + 0.052, 48), { p: [0, VY, 0.003] }),
    G.xf(new THREE.CylinderGeometry(0.075, 0.075, 0.62, 14), { r: [0, 0, Math.PI / 2], p: [-0.56, 1.505, -0.2] }),
    G.xf(new THREE.CylinderGeometry(0.075, 0.075, 0.62, 14), { r: [0, 0, Math.PI / 2], p: [0.56, 1.505, -0.2] }),
    G.xf(new THREE.BoxGeometry(0.5, 0.2, 0.3), { p: [0, 1.5, -0.2] }),
  ];
  const housing = new THREE.Mesh(G.merge(steelParts), mat.darkSteel);
  const brassParts = [
    G.xf(new THREE.TorusGeometry(VR + 0.012, 0.016, 8, 48), { p: [0, VY, 0.014] }),
    G.xf(new THREE.TorusGeometry(VR + 0.047, 0.007, 6, 48), { p: [0, VY, 0.006] }),
    G.xf(new THREE.CylinderGeometry(0.082, 0.082, 0.05, 14), { r: [0, 0, Math.PI / 2], p: [-0.86, 1.505, -0.2] }),
    G.xf(new THREE.CylinderGeometry(0.082, 0.082, 0.05, 14), { r: [0, 0, Math.PI / 2], p: [0.86, 1.505, -0.2] }),
  ];
  const trim = new THREE.Mesh(G.merge(brassParts), brass);
  group.add(housing, trim);
  disposables.push(glassGeo, glassMat, retTex, retMat, housing.geometry, trim.geometry);

  // --- органы ---
  const cBearing = on(ui.drumCounter({ digits: 5, decimals: 2, unit: '°', label: 'ПЕЛЕНГ ТРУБЫ', labelSize: 0.02, value: 0, wrap: 360, digitH: 0.046 }), -0.6, 1.36);
  let want = 0, slew = null;                           // желаемый пеленг (без округления логики) и цель доворота
  const setArg = { bearing: 0 }, zoomArg = { zoom: 4 };
  const playing = () => game.state.phase === 'playing';
  const turnBy = (deg) => {
    if (!playing()) return;
    slew = null;
    want = norm360(want + deg);
    setArg.bearing = want; game.setScope(setArg);
  };
  const wheel = on(ui.handwheel({
    radius: 0.135,
    onTurn(d) { turnBy(d / (2 * Math.PI) * (game.state.scope && game.state.scope.zoom >= 7 ? 2 : 6)); },   // оборот — 6° (×4) или 2° (×10)
  }), -0.6, 1.07);
  const lampTarget = on(ui.lamp({ color: 'green', label: 'ЦЕЛЬ В ПОЛЕ ЗРЕНИЯ', labelSize: 0.019 }), -0.6, 0.875);

  const zoomLever = on(ui.lever({
    length: 0.17, mode: 'toggle', labels: ['×4', '×10'], labelSize: 0.024,
    onChange(v) { zoomArg.zoom = v ? 10 : 4; game.setScope(zoomArg); },
  }), 0.42, 1.2);
  const markBtn = on(ui.pushButton({ radius: 0.034, color: 'ochre', label: 'ЗАСЕЧЬ ПЕЛЕНГ', labelSize: 0.019, onPress() { game.scopeMark(); } }), 0.69, 1.33);
  const toTargetBtn = on(ui.pushButton({
    radius: 0.034, color: 'black', label: 'НА ЦЕЛЬ', labelSize: 0.019,
    onPress() { if (playing()) slew = targetBearing(); },
  }), 0.69, 1.12);
  const lampBurst = on(ui.lamp({ color: 'amber', label: 'РАЗРЫВ ЗАМЕЧЕН', labelSize: 0.019 }), 0.6, 0.875);
  const lastPlate = on(ui.plate('РАЗРЫВОВ НЕ НАБЛЮДАЛИ', { size: 0.022, style: 'black', w: 0.6 }), 0, 0.826);

  /** Куда смотреть по кнопке «НА ЦЕЛЬ»: донесение об активной цели → её фишка на планшете → пеленг башни. */
  function targetBearing() {
    const s = game.state, m = s.mission, id = s.activeTarget;
    if (m && m.battery && id != null) {
      const t = (s.targets || []).find((q) => q.id === id), rep = t && t.reported, pin = s.plot && s.plot.pins && s.plot.pins[id];
      const p = rep && rep.x != null ? rep : pin;
      if (p && p.x != null) return norm360(Math.atan2(p.x - m.battery.x, p.y - m.battery.y) / DEG);
    }
    return s.turret ? s.turret.bearing : 0;
  }

  // окуляр можно тащить пальцем: изображение идёт за пальцем
  let degPerPx = 0.05;
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  const offDrag = engine.input.add(glass, {
    onDown() {
      glass.updateWorldMatrix(true, false);
      const p0 = engine.input.toScreen(_a.set(-VR, 0, 0).applyMatrix4(glass.matrixWorld)), p1 = engine.input.toScreen(_b.set(VR, 0, 0).applyMatrix4(glass.matrixWorld));
      const w = Math.abs(p1.x - p0.x);
      degPerPx = w > 10 ? (64 / ((game.state.scope && game.state.scope.zoom) || 4)) / w : 0.05;
    },
    onDrag(e) { if (e.dx) turnBy(-e.dx * degPerPx); },
    onTap() { setClose(!close); },                      // касание стекла — «прильнуть к окуляру» и обратно
  });
  let close = false;
  function setClose(v) {
    close = !!v;
    engine.setCameraPose(close ? { position: [0, VY + 0.035, 0.66], target: [0, VY - 0.012, 0], fov: 48 } : null, 0.35);
  }

  const offs = [
    game.on('impact', (e) => { view.impact(e); }),
    game.on('phase', (ph) => { if (ph === 'briefing' || ph === 'menu') needReset = true; }),
    game.on('restored', () => { needReset = true; }),
  ];
  let needReset = false, lastN = -1, lastT = -1;

  function update(dt) {
    const s = game.state, sc = s.scope;
    if (!sc) return;
    if (needReset) { needReset = false; view.reset(); slew = null; want = sc.bearing; }
    const here = engine.current === 'observe';
    // плавный доворот по «НА ЦЕЛЬ»
    if (slew != null) {
      if (!playing()) slew = null;
      else {
        const d = wrap180(slew - want), stp = 90 * dt;
        if (Math.abs(d) <= stp) { want = slew; slew = null; } else want = norm360(want + Math.sign(d) * stp);
        setArg.bearing = want; game.setScope(setArg);
      }
    } else if (Math.abs(wrap180(sc.bearing - want)) > 0.011) want = sc.bearing;      // пеленг сменили извне
    cBearing.setValue(sc.bearing);
    const z10 = sc.zoom >= 7;
    if (zoomLever.on !== z10 && !engine.input.busy) zoomLever.set(z10);
    drawReticle(z10 ? 10 : 4, !!(s.mission && s.mission.night));
    view.update(dt, here);
    if (here) lampTarget.set(view.info.inView && playing());
    const last = sc.last;
    lampBurst.set(!!last && playing() && s.time - last.t < 8 ? (s.time - last.t < 2 ? 'blink' : true) : false);
    const kn = last ? last.n : -1, kt = last ? last.t : -1;
    if (kn !== lastN || kt !== lastT) {
      lastN = kn; lastT = kt;
      let txt = 'РАЗРЫВОВ НЕ НАБЛЮДАЛИ';
      if (last) {
        if (last.targetId == null || last.over == null) txt = '№ ' + last.n + ' · ЦЕЛЕЙ РЯДОМ НЕТ';
        else {
          const db = Math.abs(last.dBearing || 0), side = db < 0.05 ? 'ПО НАПРАВЛЕНИЮ ВЕРНО' : (last.dBearing > 0 ? 'ВПРАВО ' : 'ВЛЕВО ') + db.toFixed(1).replace('.', ',') + '°';
          txt = '№ ' + last.n + ' · ' + (last.over === 0 ? 'ПОПАДАНИЕ' : side + ' · ' + (last.over > 0 ? 'ПЕРЕЛЁТ' : 'НЕДОЛЁТ'));
        }
      }
      lastPlate.setText(txt);
    }
  }

  return {
    id: 'observe', title: 'НАБЛЮДЕНИЕ', group,
    camera: { position: [0, 1.42, 1.34], target: [0, 1.15, 0], fov: 48 },
    update,
    onEnter() {},
    onLeave() { slew = null; close = false; },
    hotspots: {
      scopeWheel: wheel.object3D, zoomLever: zoomLever.handle || zoomLever.object3D,
      markButton: markBtn.object3D, scopeMarkBtn: markBtn.object3D, toTargetButton: toTargetBtn.object3D, eyepiece: glass,
    },
    /** Для тестов и отладки (не для игровой логики). */
    controls: { fascia, cBearing, wheel, zoomLever, markBtn, toTargetBtn, lampTarget, lampBurst, lastPlate, glass, reticle, view, targetBearing, setClose, get close() { return close; } },
    dispose() {
      offs.forEach((off) => off()); offDrag();
      view.dispose();
      disposables.forEach((d) => d.dispose());
      ctrls.forEach((c) => { if (c.dispose) c.dispose(); });
    },
  };
}
