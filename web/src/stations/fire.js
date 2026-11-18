// Пост «ОГОНЬ» (DESIGN §7.6): табло готовности, цепь стрельбы под крышкой, спусковой рычаг,
// репитеры наводки, секундомер полёта, телеграфный аппарат корректировщика, смотровая щель.
// Пост ничего не решает сам: показывает game.state и вызывает game.arm()/game.fire().
import { createTelegraph } from './fire-telegraph.js';

const DEG = Math.PI / 180;

export function createFireStation(ctx) {
  const { engine, THREE, ui, mat, audio, game } = ctx;
  const G = engine.geom;
  const PAL = mat.PALETTE;
  const group = new THREE.Group();
  group.name = 'station:fire';

  // ------------------------------------------------------------------ статика, слитая по материалам
  const buckets = new Map();
  const stat = (material, g, m) => {
    if (m) g.applyMatrix4(m);
    let list = buckets.get(material);
    if (!list) buckets.set(material, list = []);
    list.push(g);
    return g;
  };
  const mtx = (p, r = [0, 0, 0]) => new THREE.Matrix4().compose(
    new THREE.Vector3(p[0], p[1], p[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2])), new THREE.Vector3(1, 1, 1));
  const box = (w, h, d, x = 0, y = 0, z = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };
  const cylX = (r, len, x, y, z, seg = 14) => { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateZ(Math.PI / 2); g.translate(x, y, z); return g; };
  const put = (ctl, x, y, z, rx = 0) => { ctl.object3D.position.set(x, y, z); ctl.object3D.rotation.x = rx; group.add(ctl.object3D); return ctl; };

  const dark = mat.paint(PAL.panelDark, { wear: 0.8 });
  const frame = mat.wall;

  // ------------------------------------------------------------------ корпус
  // тумба, цоколь, короб за лицевой панелью
  put(ui.panel({ w: 1.62, h: 0.74, d: 0.44, color: PAL.panelDark, rivets: 0.12, wear: 0.8 }), 0, 0.41, -0.5);
  stat(frame, box(1.7, 0.05, 0.52, 0, 0.025, -0.3));
  stat(dark, box(1.68, 0.7, 0.34, 0, 1.115, -0.29));
  // боковые косынки, связывающие панель с тумбой
  for (const sx of [-1, 1]) {
    const sh = new THREE.Shape();
    sh.moveTo(-0.46, 0.78); sh.lineTo(0.02, 0.78); sh.lineTo(-0.07, 1.47); sh.lineTo(-0.46, 1.47); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: false });
    g.rotateY(-Math.PI / 2); g.translate(sx * 0.87 + (sx > 0 ? 0.02 : 0), 0, 0);
    stat(dark, g);
  }

  // лицевая панель (наклон 8° назад)
  const FASCIA = { w: 1.76, h: 0.69, d: 0.06, tilt: -8 * DEG, pos: [0, 1.125, -0.07] };
  const fascia = put(ui.panel({ w: FASCIA.w, h: FASCIA.h, d: FASCIA.d, rivets: 0.1 }), FASCIA.pos[0], FASCIA.pos[1], FASCIA.pos[2], FASCIA.tilt);
  const faceM = mtx(FASCIA.pos, [FASCIA.tilt, 0, 0]).multiply(mtx([0, 0, FASCIA.d]));     // лицевая плоскость панели → пост
  const onFace = (x, y, z = 0) => faceM.clone().multiply(mtx([x, y, z]));

  // ------------------------------------------------------------------ табло готовности (двухцветные лампы)
  const READY = [['shell', 'СНАРЯД'], ['charge', 'ЗАРЯД'], ['breech', 'ЗАТВОР'], ['brake', 'СТОПОР'], ['armed', 'ЦЕПЬ']];
  const LABEL = 0.026;                          // высота прописной на шильдиках поста, м
  const readyLamps = [];
  {
    const r = 0.024, y = 0.262, x0 = -0.2, pitch = 0.165;
    const lensG = new THREE.SphereGeometry(r * 1.04, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    lensG.rotateX(Math.PI / 2); lensG.scale(1, 1, 0.72); lensG.translate(0, 0, r * 0.4);
    const mats = {
      green: [mat.lens('green', true), mat.glowSprite(PAL.lampGreen, 0.8)],
      red: [mat.lens('red', true), mat.glowSprite(PAL.lampRed, 0.8)],
    };
    READY.forEach(([key, text], i) => {
      const x = x0 + i * pitch;
      stat(mat.nickel, G.lathe([[r * 1.5, 0], [r * 1.5, r * 0.35], [r * 1.5, r * 0.35], [r * 1.32, r * 0.62], [r * 1.08, r * 0.66], [r * 1.02, r * 0.5]], 20), onFace(x, y));
      const g = new THREE.Group();
      const lens = new THREE.Mesh(lensG, mats.red[0]);
      const glow = new THREE.Sprite(mats.red[1]);
      glow.position.z = r * 1.3; glow.scale.setScalar(r * 7.5);
      g.add(lens, glow);
      fascia.add(g, x, y);
      const p = fascia.add(ui.plate(text, { size: LABEL, screws: false }), x, y - r * 1.5 - 0.01 - LABEL * 1.05);
      let state = null;
      readyLamps.push({
        key, object3D: g, plate: p,
        get state() { return state; },
        set(ok) { ok = !!ok; if (ok === state) return; state = ok; const m = ok ? mats.green : mats.red; lens.material = m[0]; glow.material = m[1]; },
      });
    });
  }

  // ------------------------------------------------------------------ секундомер полёта и лампа «снаряд в полёте»
  const watch = fascia.add(ui.gauge({
    radius: 0.125, min: 0, max: 60, sweep: 360, start: 0, majorStep: 10, minorStep: 1,
    label: 'ПОЛЁТ', unit: 'СЕК', caption: 'ДО РАЗРЫВА', captionSize: LABEL, speed: 40, damping: 0.9,
  }), -0.7, 0.18);
  const lampFlight = fascia.add(ui.lamp({ color: 'amber', radius: 0.024, label: 'СНАРЯД\nВ ПОЛЁТЕ', labelSize: LABEL }), -0.44, 0.262);
  fascia.add(ui.plate('ТЕЛЕГРАФ', { size: LABEL, style: 'ivory', screws: false }), -0.44, 0.045);

  // ------------------------------------------------------------------ репитеры
  const cBearing = fascia.add(ui.drumCounter({ digits: 5, decimals: 2, unit: '°', wrap: 360, digitH: 0.05 }), -0.14, 0.02);
  fascia.add(ui.plate('ПЕЛЕНГ БАШНИ', { size: LABEL, screws: false }), -0.14, 0.02 + cBearing.h / 2 + 0.008 + LABEL * 1.05);
  const cElev = fascia.add(ui.drumCounter({ digits: 4, decimals: 2, unit: '°', signed: true, digitH: 0.05 }), 0.165, 0.02);
  fascia.add(ui.plate('УГОЛ СТВОЛА', { size: LABEL, screws: false }), 0.165, 0.02 + cElev.h / 2 + 0.008 + LABEL * 1.05);
  const cCharges = fascia.add(ui.drumCounter({ digits: 1, digitH: 0.06 }), -0.17, -0.215);
  fascia.add(ui.plate('ЗАРЯДОВ', { size: LABEL, screws: false }), -0.17, -0.215 + cCharges.h / 2 + 0.008 + LABEL * 1.05);
  const lampHE = fascia.add(ui.lamp({ color: 'amber', radius: 0.024, label: 'ОФ', labelSize: LABEL }), 0.06, -0.2);
  const lampAP = fascia.add(ui.lamp({ color: 'white', radius: 0.024, label: 'ББ', labelSize: LABEL }), 0.19, -0.2);
  fascia.add(ui.plate('В СТВОЛЕ', { size: LABEL, screws: false }), 0.125, -0.215 + cCharges.h / 2 + 0.008 + LABEL * 1.05);

  // ------------------------------------------------------------------ цепь стрельбы и спуск
  // подложка «опасной зоны» — жёлто-чёрная окантовка вокруг органов стрельбы
  {
    const w = 0.52, h = 0.47, px = 512, py = Math.round(512 * h / w), k = px / w;
    const cv = engine.textures.makeCanvas(px, py), c2 = cv.getContext('2d');
    c2.fillStyle = PAL.plateBlack; c2.fillRect(0, 0, px, py);
    c2.save();
    c2.beginPath(); c2.rect(0, 0, px, py); c2.clip();
    c2.strokeStyle = PAL.ochre; c2.lineWidth = 0.02 * k;
    for (let x = -py; x < px + py; x += 0.056 * k) { c2.beginPath(); c2.moveTo(x, py); c2.lineTo(x + py, 0); c2.stroke(); }
    c2.restore();
    const b = 0.024 * k;
    c2.fillStyle = '#232b33';
    engine.textures.roundRectPath(c2, b, b, px - 2 * b, py - 2 * b, 0.012 * k); c2.fill();
    c2.strokeStyle = 'rgba(0,0,0,0.55)'; c2.lineWidth = 2;
    engine.textures.roundRectPath(c2, b, b, px - 2 * b, py - 2 * b, 0.012 * k); c2.stroke();
    const g = new THREE.ShapeGeometry(G.roundedRectShape(w, h, 0.018), 4);
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      map: engine.textures.canvasTexture(cv, { aniso: 8 }), roughness: 0.6, metalness: 0.25,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    m.name = 'hazardPlate';
    fascia.add(m, 0.585, -0.075);
    m.position.z += 0.0008;
  }

  const ARM = { x: 0.44, y: -0.09 };
  let userArm = false;                         // true, пока выполняется game.arm() по жесту игрока
  const armToggle = fascia.add(ui.toggle({
    labels: ['', ''], value: 0,
    onChange(i) { userArm = true; try { game.arm(!!i); } finally { userArm = false; } },
  }), ARM.x, ARM.y);
  const armCover = fascia.add(ui.cover({
    w: 0.11, h: 0.13, depth: 0.1, guards: [armToggle],
    // закрытая крышка механически сбрасывает тумблер
    onChange(open) { if (!open && game.state.fire.armed) game.arm(false); },
  }), ARM.x, ARM.y);
  const coverAnchor = new THREE.Object3D();    // центр откидной части — для подсказок и тестов
  coverAnchor.position.set(0, -0.071, 0.09);
  armCover.lid.add(coverAnchor);
  fascia.add(ui.plate('ЦЕПЬ СТРЕЛЬБЫ', { size: LABEL, style: 'red', screws: false }), ARM.x, ARM.y - 0.079 - 0.022 - LABEL * 1.05);

  // очередь: сколько выстрелов сделать подряд на одних установках (расчёт сам перезаряжает)
  const burstSel = fascia.add(ui.rotarySelector({
    labels: ['1', '2', '3'], radius: 0.022, labelSize: 0.02, value: 0,
    onChange(i) { if (game.state.phase === 'playing') game.setBurst(i + 1); },
  }), 0.385, 0.098);
  fascia.add(ui.plate('ОЧЕРЕДЬ', { size: 0.022, screws: false }), 0.548, 0.12);
  const lampBurst = fascia.add(ui.lamp({ color: 'amber', radius: 0.012 }), 0.548, 0.078);

  const leverMount = new THREE.Group();
  fascia.add(leverMount, 0.7, 0.0);
  const leverBaseZ = leverMount.position.z;
  const fireLever = ui.lever({
    mode: 'momentary', length: 0.26, color: PAL.plateRed, labels: ['СПУСК'], labelSize: LABEL,
    onPull() { game.fire(); },                // одно обращение на одно протягивание; отказ покажет оболочка
  });
  leverMount.add(fireLever.object3D);
  fascia.add(ui.plate('БЕЗ СТОПОРА\nНЕ СТРЕЛЯТЬ', { size: 0.024, style: 'red', screws: false }), 0.715, 0.25);

  // ------------------------------------------------------------------ смотровая щель в броневом козырьке
  const HOOD = { y: 1.478, z: -0.075, tilt: 10 * DEG };
  const hoodM = mtx([0, HOOD.y, HOOD.z], [HOOD.tilt, 0, 0]);
  const SLIT = { w: 0.56, h: 0.05, y: 0.127 };
  const slitHole = () => { const p = new THREE.Path(); p.setFromPoints(G.roundedRectShape(SLIT.w, SLIT.h, 0.012).getPoints(4).reverse()); return p; };
  // броневой козырёк: плита с прорезью (прорезь — в центре плиты) и накладная рамка щели
  stat(dark, G.xf(G.slab(0.94, 0.254, 0.05, { r: 0.02, bevel: 0.008, hole: slitHole() }), { p: [0, SLIT.y, -0.05] }), hoodM);
  stat(mat.darkSteel, G.xf(G.slab(0.64, 0.094, 0.014, { r: 0.016, bevel: 0.004, hole: slitHole() }), { p: [0, SLIT.y, 0] }), hoodM);
  for (const sx of [-1, 1]) for (const k of [0.33, 1]) for (const sy of [-1, 1]) {
    stat(mat.steel, G.xf(G.hexGeometry(0.008, 0.006), { p: [sx * k * 0.3, SLIT.y + sy * 0.036, 0.014] }), hoodM);
  }
  stat(frame, box(0.9, 0.3, 0.84, 0, HOOD.y + 0.14, -0.53));
  // вид в щель: полоска «небо/море», при выстреле вспыхивает
  const slitMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  {
    const cv = engine.textures.makeCanvas(64, 16), c2 = cv.getContext('2d');
    const gr = c2.createLinearGradient(0, 0, 0, 16);
    gr.addColorStop(0, '#93a7b8'); gr.addColorStop(0.5, '#c4ccd0'); gr.addColorStop(0.56, '#4d6072'); gr.addColorStop(1, '#2f3f4e');
    c2.fillStyle = gr; c2.fillRect(0, 0, 64, 16);
    slitMat.map = engine.textures.canvasTexture(cv, { aniso: 1 });
  }
  const slit = new THREE.Mesh(new THREE.PlaneGeometry(SLIT.w + 0.02, SLIT.h + 0.02), slitMat);
  slit.name = 'visionSlit';
  const hood = new THREE.Group();
  hood.position.set(0, HOOD.y, HOOD.z); hood.rotation.x = HOOD.tilt;
  group.add(hood);
  slit.position.set(0, SLIT.y, -0.036);
  hood.add(slit);
  const flareMat = new THREE.SpriteMaterial({
    map: mat.glowTexture, color: 0xffb060, blending: THREE.AdditiveBlending, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false,
  });
  flareMat.color.setRGB(2.6, 1.5, 0.62);       // ярче единицы: отсвет ложится и на верх пульта
  const flare = new THREE.Sprite(flareMat);
  flare.position.set(0, SLIT.y - 0.03, 0.03); flare.scale.set(2.1, 0.86, 1); flare.visible = false; flare.renderOrder = 20;
  hood.add(flare);
  const title = ui.plate('ОГОНЬ', { size: 0.034 });
  title.object3D.position.set(0, 0.04, 0);
  hood.add(title.object3D);
  const SLIT_BASE = new THREE.Color(0.5, 0.55, 0.62), SLIT_HOT = new THREE.Color(7, 4.6, 2.4);

  // красный плафон «цепь взведена»
  const armLamp = put(ui.cageLamp({ color: 'red', scale: 0.72, on: false }), 0.63, 1.553, -0.09);
  stat(mat.darkSteel, box(0.16, 0.13, 0.03, 0.63, 1.553, -0.105));

  // ------------------------------------------------------------------ телеграфный аппарат
  const telegraph = createTelegraph(ctx, { stat, mtx, box, cylX, dark });
  group.add(telegraph.object3D);

  // ------------------------------------------------------------------ декор: трубы, кабели, коробка связи
  stat(mat.copper, G.pipeGeometry([[0.8, 0.06, -0.63], [0.8, 1.64, -0.63], [0.8, 1.64, -0.94]], 0.022));
  stat(mat.steel, G.pipeGeometry([[0.72, 0.06, -0.68], [0.72, 1.76, -0.68], [0.72, 1.76, -0.94]], 0.013));
  stat(mat.copper, G.pipeGeometry([[-0.83, 0.06, -0.66], [-0.83, 1.9, -0.66], [-0.83, 1.9, -0.94]], 0.016));
  // коробка связи над телеграфом и кабели от неё
  stat(mat.darkSteel, G.slab(0.2, 0.12, 0.07, { r: 0.012, bevel: 0.006 }), mtx([-0.66, 1.56, -0.16]));
  stat(mat.nickel, G.lathe([[0.046, 0], [0.046, 0.01], [0.04, 0.03], [0.026, 0.043], [0.008, 0.048], [0, 0.048]], 20), mtx([-0.66, 1.56, -0.09]));
  for (const [x0, x1] of [[-0.72, -0.76], [-0.6, -0.56]]) {
    const curve = new THREE.CatmullRomCurve3([[x0, 1.5, -0.125], [x0, 1.47, -0.14], [x1, 1.3, -0.2], [x1, 0.9, -0.22]].map(p => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
    stat(mat.rubber, new THREE.TubeGeometry(curve, 16, 0.009, 6, false));
  }
  {
    const curve = new THREE.CatmullRomCurve3([[-0.56, 1.585, -0.12], [-0.5, 1.6, -0.12], [-0.47, 1.66, -0.2], [-0.47, 1.9, -0.6], [-0.47, 1.95, -0.94]].map(p => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
    stat(mat.rubber, new THREE.TubeGeometry(curve, 20, 0.011, 6, false));
  }

  buckets.forEach((list, material) => {
    const m = new THREE.Mesh(G.boxUV(G.merge(list), mat.WEAR_REPEAT), material);
    m.name = 'static';
    group.add(m);
  });

  // ------------------------------------------------------------------ состояние анимаций и события игры
  let needReset = true;            // новое задание: очистить ленту, закрыть крышку, выставить счётчики без прокрутки
  let reclose = 0;                 // с до захлопывания крышки после выстрела (0 — не ждём)
  let flareV = 0;                  // 0…1 — вспышка в щели
  const recoil = { x: 0, v: 0 };   // откат спускового рычага

  const visibleNow = () => group.visible;      // движок обновляет только видимые посты; скрытому анимация печати не нужна
  const offs = [
    game.on('phase', ph => { if (ph === 'briefing') needReset = true; }),
    game.on('fired', () => {
      if (visibleNow()) { flareV = 1; recoil.v -= 9; reclose = 0.45; }
      else reclose = 0.01;                     // пост скрыт: без вспышки и отката, крышку закрыть при первом обновлении
      telegraph.print('ВЫСТРЕЛ №' + game.state.shots, { color: PAL.redZone, animate: visibleNow() });
    }),
    game.on('impact', e => {
      const lines = [];
      const text = e && e.report && e.report.text;
      if (text) lines.push(text);
      ((e && e.hits) || []).forEach(h => {
        const name = (h.target && h.target.label) || 'ЦЕЛЬ';
        if (h.destroyed) lines.push(name + ' УНИЧТОЖЕНА');
        else if (!text) lines.push(name + ': ПОПАДАНИЕ');
      });
      if (!lines.length) lines.push('РАЗРЫВ. ЦЕЛЬ НЕ НАБЛЮДАЮ');
      const animate = visibleNow();
      lines.forEach(l => telegraph.print(l, { animate }));
    }),
  ];

  function reset() {
    needReset = false;
    reclose = 0; flareV = 0; recoil.x = recoil.v = 0;
    telegraph.clear();
    armCover.set(false);
    const s = game.state;
    cBearing.setValue(s.turret.bearing, { instant: true });
    cElev.setValue(s.turret.elevation, { instant: true });
    cCharges.setValue(s.breech.charges, { instant: true });
    watch.setValue(0, { instant: true });
  }

  function update(dt, time) {
    const s = game.state;
    if (needReset) reset();
    const here = engine.current === 'fire';

    // очередь
    const want = Math.max(0, ((s.fire && s.fire.burst) || 1) - 1);
    if (burstSel.value !== want) burstSel.set(want);
    lampBurst.set(s.fire && s.fire.burstLeft > 0 ? 'blink' : false);

    // табло готовности
    const rd = game.fireReadiness();
    for (const l of readyLamps) l.set(rd[l.key]);

    // цепь стрельбы: тумблер всегда повторяет state.fire.armed
    const armed = !!s.fire.armed;
    if (armToggle.value !== (armed ? 1 : 0)) {
      armToggle.set(armed ? 1 : 0);
      if (here) audio.switchFlip();
    }
    if (armed && !armCover.open) armCover.set(true);          // взведено извне — крышка не может быть закрыта
    if (reclose > 0 && (reclose -= dt) <= 0) {
      reclose = 0;
      if (!armed && armCover.open) { armCover.set(false); if (here) audio.clunk(); }
    }
    armLamp.set(armed);

    // репитеры
    cBearing.setValue(s.turret.bearing);
    cElev.setValue(s.turret.elevation);
    cCharges.setValue(s.breech.charges);
    const b = s.breech;
    lampHE.set(b.shell === 'he' ? (b.rammed ? true : 'blink') : false);
    lampAP.set(b.shell === 'ap' ? (b.rammed ? true : 'blink') : false);

    // секундомер: обратный отсчёт до разрыва последнего выпущенного снаряда
    const fl = s.flight, last = fl && fl.length ? fl[fl.length - 1] : null;
    const rem = last ? Math.max(0, last.tof - last.t) : 0;
    watch.setValue(rem);
    lampFlight.set(last ? (rem < 3 ? 'blink' : true) : false);

    // вспышка в смотровой щели
    if (flareV > 0) {
      flareV = Math.max(0, flareV - dt * (flareV > 0.5 ? 2.2 : 1.1));
      const k = flareV * flareV;
      slitMat.color.copy(SLIT_BASE).lerp(SLIT_HOT, k);
      flareMat.opacity = Math.min(1, k * 1.3);
      flare.visible = k > 0.002;
    } else if (flare.visible || slitMat.color.r !== SLIT_BASE.r) {
      slitMat.color.copy(SLIT_BASE); flare.visible = false; flareMat.opacity = 0;
    }

    // откат рычага
    if (recoil.x !== 0 || recoil.v !== 0) {
      const h = Math.min(dt, 0.033), w = 30, z = 0.42;
      recoil.v += (-w * w * recoil.x - 2 * z * w * recoil.v) * h;
      recoil.x += recoil.v * h;
      if (Math.abs(recoil.x) < 1e-4 && Math.abs(recoil.v) < 1e-3) { recoil.x = 0; recoil.v = 0; }
      leverMount.position.z = leverBaseZ + recoil.x * 0.05;
      leverMount.rotation.x = recoil.x * 0.5;
    }

    telegraph.update(dt, here);
  }

  slitMat.color.copy(SLIT_BASE);

  return {
    id: 'fire', title: 'ОГОНЬ', group,
    camera: { position: [0, 1.42, 1.34], target: [0, 1.19, 0], fov: 46 },
    update,
    onEnter() {},
    onLeave() { telegraph.flush(); },
    hotspots: {
      armCover: coverAnchor,                 // откидная крышка: касание — открыть/закрыть
      armToggle: armToggle.object3D,         // тумблер цепи стрельбы (доступен при открытой крышке)
      fireLever: fireLever.handle,           // рукоять спуска: протянуть вниз
      burstSelector: burstSel.object3D,      // переключатель очереди 1/2/3
    },
    /** Для тестов и отладки (не для игровой логики). */
    controls: { readyLamps, armToggle, armCover, fireLever, cBearing, cElev, cCharges, lampHE, lampAP, lampFlight, watch, armLamp, telegraph, slit, flare },
    dispose() {
      offs.forEach(off => off()); offs.length = 0;
      telegraph.dispose();
      [watch, lampFlight, cBearing, cElev, cCharges, lampHE, lampAP, armToggle, armCover, fireLever, armLamp, burstSel, lampBurst].forEach(c => { if (c.dispose) c.dispose(); });
      slitMat.map.dispose(); slitMat.dispose(); flareMat.dispose();
    },
  };
}
