// Пост «ЗАРЯЖАНИЕ» (DESIGN §7.3): казённая часть орудия с поршневым затвором, лоток с досылателем, снарядный
// элеватор и зарядный подъёмник + пульт. Пост ничего не решает сам: показывает game.state и вызывает
// game.openBreech/closeBreech/hoistShell/ramShell/addCharge/removeCharge/unload. Длительные операции
// анимируются по state.breech.busy = { kind, t, dur }.
import { buildLoadingGun, GUN as K, bagSeatZ } from './loading-gun.js';

const DEG = Math.PI / 180;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const seg = (p, a, b) => clamp01((p - a) / (b - a));
const ease = (x) => x * x * (3 - 2 * x);
const easeOut = (x) => 1 - (1 - x) * (1 - x);
const TYPES = ['he', 'ap'];
const ROLL = K.CAR_X / K.SHELL_R;            // угол перекатывания снаряда с люльки на лоток, рад
const RAM_TRAVEL = K.SHELL_TRAY_Z - K.SHELL_SEAT_Z;

export function createLoadingStation(ctx) {
  const { engine, THREE, ui, mat, audio, game } = ctx;
  const G = engine.geom, PAL = mat.PALETTE;
  const group = new THREE.Group();
  group.name = 'station:loading';

  // ------------------------------------------------------------------ механика (орудие, лоток, элеваторы)
  const gun = buildLoadingGun(ctx, group);

  // ------------------------------------------------------------------ статика пульта, слитая по материалам
  const buckets = new Map();
  const stat = (material, g) => { let l = buckets.get(material); if (!l) buckets.set(material, l = []); l.push(g); return g; };
  const box = (w, h, d, x = 0, y = 0, z = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };
  const dark = mat.paint(PAL.panelDark, { wear: 0.8 });

  const PANEL = { w: 0.94, h: 0.74, d: 0.05, tilt: -7 * DEG, x: 0.42, y: 1.115, z: -0.06 };
  const fascia = ui.panel({ w: PANEL.w, h: PANEL.h, d: PANEL.d, rivets: 0.1 });
  fascia.object3D.position.set(PANEL.x, PANEL.y, PANEL.z);
  fascia.object3D.rotation.x = PANEL.tilt;
  group.add(fascia.object3D);
  {
    // короб за панелью (клин по наклону панели), тумба, цоколь
    const y0 = PANEL.y - PANEL.h / 2 + 0.005, y1 = PANEL.y + PANEL.h / 2 - 0.005, lean = Math.sin(-PANEL.tilt) * PANEL.h / 2;
    const sh = new THREE.Shape();
    sh.moveTo(-0.42, y0); sh.lineTo(PANEL.z + lean + 0.01, y0); sh.lineTo(PANEL.z - lean + 0.01, y1); sh.lineTo(-0.42, y1); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.9, bevelEnabled: false });
    g.rotateY(-Math.PI / 2); g.translate(PANEL.x + 0.45, 0, 0);
    stat(dark, g);
    stat(dark, box(0.8, y0, 0.32, PANEL.x, y0 / 2, -0.24));
    stat(mat.wall, box(0.88, 0.05, 0.4, PANEL.x, 0.025, -0.23));
    stat(mat.steel, box(0.82, 0.014, 0.33, PANEL.x, y0 - 0.02, -0.24));
  }
  // трубопроводы и кабель по переборке над пультом
  group.add(ui.pipe([[-0.06, 1.2, -0.775], [-0.06, 1.545, -0.775], [0.89, 1.545, -0.775]], 0.022).object3D);
  group.add(ui.pipe([[0.0, 1.615, -0.78], [0.89, 1.615, -0.78]], 0.016, mat.steel).object3D);
  group.add(ui.cable([[0.2, 1.47, -0.38], [0.2, 1.6, -0.5], [0.23, 1.7, -0.78]], { radius: 0.012 }).object3D);
  buckets.forEach((list, material) => { const m = new THREE.Mesh(G.boxUV(G.merge(list), mat.WEAR_REPEAT), material); m.name = 'static'; group.add(m); });

  // ------------------------------------------------------------------ органы управления и приборы
  const LABEL = 0.026;
  let gestureDenied = false;                 // отказ уже был в этом жесте — повторно действие не вызываем
  const st = () => game.state || {};
  const breechOf = () => st().breech || { open: false, shell: null, rammed: false, charges: 0, busy: null };
  /** Положение рычага затвора, соответствующее игре: открыт или открывается. */
  const leverTarget = () => { const b = breechOf(), k = b.busy && b.busy.kind; return k === 'open' ? true : k === 'close' ? false : !!b.open; };

  fascia.add(ui.plate('ЗАРЯЖАНИЕ', { size: 0.036 }), -0.3, 0.305);
  const lampAngle = fascia.add(ui.lamp({ color: 'green', label: 'УГОЛ\nЗАРЯЖАНИЯ', labelSize: LABEL }), -0.03, 0.325);
  const lampClosed = fascia.add(ui.lamp({ color: 'green', label: 'ЗАТВОР\nЗАКРЫТ', labelSize: LABEL }), 0.175, 0.325);
  const lampBusy = fascia.add(ui.lamp({ color: 'amber', label: 'МЕХАНИЗМ\nЗАНЯТ', labelSize: LABEL }), 0.365, 0.325);

  // 1. затвор (и разряжание — над ним)
  const unloadButton = fascia.add(ui.pushButton({ radius: 0.034, color: 'red', label: 'РАЗРЯДИТЬ', labelSize: LABEL, onPress() { game.unload(); } }), -0.34, 0.14);
  const breechLever = fascia.add(ui.lever({
    length: 0.18, mode: 'toggle', labels: ['ЗАТВОР\nЗАКРЫТ', 'ЗАТВОР\nОТКРЫТ'], labelSize: LABEL,
    onChange(on) {
      if (!gestureDenied) {
        const r = on ? game.openBreech() : game.closeBreech();
        if (!r || !r.ok) gestureDenied = true;
      }
      breechLever.set(leverTarget());        // рычаг всегда показывает настоящее состояние (при отказе — отскакивает)
    },
  }), -0.41, -0.135);

  // 2. снаряд: тумблер типа (ББ вверху, ОФ внизу), рядом с каждым положением — счётчик остатка; кнопка подачи
  const shellToggle = fascia.add(ui.toggle({ labels: ['ОФ', 'ББ'], orient: 'v', labelSize: LABEL, value: 0 }), -0.145, 0.045);
  const cAp = fascia.add(ui.drumCounter({ digits: 2, digitH: 0.045 }), -0.04, 0.144);
  const cHe = fascia.add(ui.drumCounter({ digits: 2, digitH: 0.045 }), -0.04, -0.054);
  let hoistType = 'he';                      // тип снаряда, который сейчас едет на элеваторе
  const hoistButton = fascia.add(ui.pushButton({
    radius: 0.036, color: 'ochre', label: 'ПОДАТЬ\nСНАРЯД', labelSize: LABEL,
    onPress() { const type = TYPES[shellToggle.value ? 1 : 0]; const r = game.hoistShell(type); if (r && r.ok) hoistType = type; },
  }), -0.095, -0.185);

  // 3. досылатель
  const ramLever = fascia.add(ui.lever({
    length: 0.18, mode: 'momentary', labels: 'ДОСЛАТЬ', labelSize: LABEL, color: PAL.ochre,
    onPull() { game.ramShell(); },
  }), 0.135, -0.115);

  // 4. заряды
  const cCharges = fascia.add(ui.drumCounter({ digits: 1, digitH: 0.06, label: 'ЗАРЯДОВ', labelSize: LABEL }), 0.14, 0.06);
  const cComputed = fascia.add(ui.drumCounter({ digits: 1, digitH: 0.046, label: 'ПО\nРАСЧЁТУ', labelSize: LABEL }), 0.36, 0.038);
  const chargePlus = fascia.add(ui.pushButton({ radius: 0.034, label: 'ЗАРЯД +', labelSize: LABEL, onPress() { game.addCharge(); } }), 0.36, -0.088);
  const chargeMinus = fascia.add(ui.pushButton({ radius: 0.034, label: 'ЗАРЯД −', labelSize: LABEL, onPress() { game.removeCharge(); } }), 0.36, -0.242);

  // ------------------------------------------------------------------ события игры
  const offs = [];
  const known = { he: 0, ap: 0 };            // остаток снарядов на момент последнего события (чтобы узнать тип поданного)
  const syncKnown = () => { const sh = st().shells || {}; known.he = sh.he | 0; known.ap = sh.ap | 0; };
  let needReset = true;                      // новое задание: приборы и механика — без анимации
  let now = 0, firedAt = -100;
  syncKnown();
  offs.push(engine.onFrame((dt, time) => { now = time; }));
  offs.push(game.on('phase', (ph) => { syncKnown(); if (ph === 'briefing' || ph === 'menu') needReset = true; }));
  offs.push(game.on('breech', () => {
    const b = breechOf(), sh = st().shells || {}, k = b.busy && b.busy.kind;
    if (k === 'hoist' && b.busy.t === 0) hoistType = (sh.ap | 0) < known.ap ? 'ap' : (sh.he | 0) < known.he ? 'he' : TYPES[shellToggle.value ? 1 : 0];
    syncKnown();
    if (!group.visible) return;              // механику слышно только с этого поста и с соседних
    if (k === 'open' || k === 'close') audio.breech();
    else if (k === 'hoist' || k === 'unload') audio.hoist();
    else if (k === 'ram') audio.ram();
    else if (k) audio.clunk();
  }));
  offs.push(game.on('fired', () => { firedAt = now; }));

  // ------------------------------------------------------------------ кадр
  let elevShown = 0, lastUpdate = -100, prevKind = null, prevP = 0;
  const crossed = (p, at) => prevP < at && p >= at;

  function placeBag(mesh, q, n) {
    // q: 0 — в коробе подъёмника … 1 — в каморе на месте № n
    if (q <= 0) { mesh.visible = false; return 0; }
    const up = ease(seg(q, 0, 0.3)), side = ease(seg(q, 0.3, 0.5)), push = ease(seg(q, 0.5, 0.88));
    mesh.visible = true;
    mesh.position.set(K.BAG_X * (1 - side), -K.BAG_SINK * (1 - up), K.BAG_Z + (bagSeatZ(n) - K.BAG_Z) * push);
    return push;
  }

  function update(dt, time) {
    const s = st(), b = breechOf(), turret = s.turret || {}, shells = s.shells || {}, comp = s.computer || {};
    const C = game.C || { LOAD_ANGLE: 3, EL_MIN: -2 };
    const k = b.busy ? b.busy.kind : null, p = b.busy ? clamp01(b.busy.t / (b.busy.dur || 1)) : 0;
    const elev = +turret.elevation || 0;
    const snap = needReset || time - lastUpdate > 0.5;       // новое задание или пост был скрыт
    lastUpdate = time;
    if (k !== prevKind) prevP = 0;

    // --- приборы
    const inst = needReset ? { instant: true } : undefined;
    cHe.setValue(shells.he | 0, inst); cAp.setValue(shells.ap | 0, inst);
    cCharges.setValue(b.charges | 0, inst); cComputed.setValue(comp.charge | 0, inst);
    lampAngle.set(elev <= C.LOAD_ANGLE);
    lampClosed.set(!b.open && k !== 'open' && k !== 'close');
    lampBusy.set(!!k);
    if (!engine.input.busy) { gestureDenied = false; if (breechLever.on !== leverTarget()) breechLever.set(leverTarget()); }

    // --- качание и откат
    elevShown = snap ? elev : elevShown + (elev - elevShown) * (1 - Math.exp(-dt * 12));
    gun.gunPivot.rotation.x = elevShown * DEG;
    gun.loadPivot.rotation.x = Math.min(elevShown, C.LOAD_ANGLE) * DEG;
    if (needReset) firedAt = -100;
    const rt = time - firedAt;
    let rec = 0;
    if (rt >= 0 && rt < 1.25) rec = rt < 0.09 ? easeOut(rt / 0.09) : 1 - ease(seg(rt, 0.09, 1.2));
    gun.recoil.position.z = K.RECOIL * rec;
    const smoke = rt >= 0 && rt < 2.4;
    gun.puffs.forEach((sp, i) => {
      sp.visible = smoke;
      if (!smoke) return;
      const u = rt / 2.4, a = i * 2.1;
      sp.position.set(K.X + Math.cos(a) * 0.2 * (0.4 + u), K.Y + 0.25 + Math.sin(a) * 0.08 + u * 0.45, K.ZB - 0.2 + 0.25 * u + i * 0.05);
      sp.scale.setScalar(0.45 + u * 0.9 + i * 0.12);
    });
    if (smoke) gun.puffMat.opacity = 0.34 * Math.min(1, rt / 0.12) * (1 - rt / 2.4);

    // --- затвор и лоток
    const openAmt = k === 'open' ? p : k === 'close' ? 1 - p : (b.open ? 1 : 0);
    gun.rotor.rotation.z = K.UNLOCK * ease(seg(openAmt, 0, 0.35));
    gun.hinge.rotation.y = -K.SWING * ease(seg(openAmt, 0.3, 0.75));
    gun.tray.position.y = -K.TRAY_DROP * (1 - ease(seg(openAmt, 0.72, 1)));
    const inside = openAmt > 0.02;           // есть ли смысл рисовать содержимое каморы

    // --- снаряд, люлька элеватора, досылатель, картузы
    let shellOn = false, type = b.shell || hoistType, sx = 0, sy = 0, sz = K.SHELL_TRAY_Z, roll = ROLL;
    let carUp = 0, carTilt = 0, headZ = K.HEAD_REST, staticBags = b.charges | 0, moving = 0;
    if (k === 'hoist') {
      const up = ease(seg(p, 0, 0.5)), r = ease(seg(p, 0.58, 0.82));
      carUp = up * (1 - ease(seg(p, 0.86, 1)));
      carTilt = 0.1 * Math.sin(Math.PI * seg(p, 0.5, 0.86));
      shellOn = true; type = hoistType;
      sx = K.CAR_X * (1 - r); sy = -K.CAR_DOWN * (1 - up) + 0.045 * Math.sin(Math.PI * r); roll = ROLL * r;
      if (crossed(p, 0.82)) audio.clunk();
    } else if (k === 'ram') {
      const push = seg(p, 0.04, 0.26), s1 = push * push, back = ease(seg(p, 0.5, 1));
      shellOn = true;
      sz = K.SHELL_TRAY_Z - RAM_TRAVEL * s1;
      headZ = K.HEAD_REST - RAM_TRAVEL * s1 * (1 - back);
    } else if (k === 'charge') {
      const n = staticBags + 1, push = placeBag(gun.bags[0], p, n);
      moving = 1;
      headZ = K.HEAD_REST + (bagSeatZ(n) + K.BAG_LEN / 2 - K.HEAD_REST) * push * (1 - ease(seg(p, 0.88, 1)));
      shellOn = !!b.shell && inside; sz = b.rammed ? K.SHELL_SEAT_Z : K.SHELL_TRAY_Z;
      if (crossed(p, 0.5)) audio.ram();
    } else if (k === 'uncharge') {
      placeBag(gun.bags[0], 1 - p, staticBags);
      moving = 1; staticBags -= 1;
      shellOn = !!b.shell && inside; sz = b.rammed ? K.SHELL_SEAT_Z : K.SHELL_TRAY_Z;
    } else if (k === 'unload') {
      const n = staticBags;
      for (let i = 0; i < n; i++) placeBag(gun.bags[i], 1 - seg(p, i * 0.06, i * 0.06 + 0.3), n - i);
      moving = n; staticBags = 0;
      if (b.shell) {
        const a = n > 0 ? 0.42 : 0.04, out = b.rammed ? ease(seg(p, a, a + 0.26)) : 1;
        const r = ease(seg(p, 0.72, 0.85)), down = ease(seg(p, 0.87, 1));
        carUp = ease(seg(p, 0.3, 0.68)) * (1 - down);
        carTilt = -0.1 * Math.sin(Math.PI * seg(p, 0.7, 0.87));
        shellOn = true;
        sz = K.SHELL_SEAT_Z + RAM_TRAVEL * out; sx = K.CAR_X * r; sy = -K.CAR_DOWN * down + 0.045 * Math.sin(Math.PI * r); roll = ROLL * (1 - r);
        if (crossed(p, 0.85)) audio.clunk();
      }
    } else if (b.shell) {
      shellOn = b.rammed ? inside : true;
      sz = b.rammed ? K.SHELL_SEAT_Z : K.SHELL_TRAY_Z;
    }
    gun.shell.visible = shellOn;
    if (shellOn) {
      const m = gun.shellMats[type] || gun.shellMats.he;
      if (gun.shell.material !== m) gun.shell.material = m;
      gun.shell.position.set(sx, sy, sz);
      gun.shell.rotation.z = roll;
    }
    gun.car.visible = carUp > 0.001;
    gun.car.position.y = -K.CAR_DOWN * (1 - carUp);
    gun.car.rotation.z = carTilt;
    gun.ramHead.position.z = headZ;
    const rodLen = K.HOUSING_Z - (headZ + 0.05);
    gun.ramRod.visible = rodLen > 0.005;
    if (gun.ramRod.visible) { gun.ramRod.position.z = headZ + 0.05; gun.ramRod.scale.z = rodLen; }
    // картуз, видимый в каморе при открытом затворе (последний из уложенных)
    const glimpse = gun.bags[5];
    for (let i = moving; i < 5; i++) gun.bags[i].visible = false;
    if (moving < 6) {
      glimpse.visible = staticBags > 0 && inside;
      if (glimpse.visible) glimpse.position.set(0, 0, bagSeatZ(staticBags));
    }

    prevKind = k; prevP = p;
    needReset = false;
  }

  const lampsAndCounters = { lampAngle, lampClosed, lampBusy, cHe, cAp, cCharges, cComputed };
  const controls = { breechLever, shellToggle, hoistButton, ramLever, chargePlus, chargeMinus, unloadButton };

  return {
    id: 'loading', title: 'ЗАРЯЖАНИЕ', group,
    camera: { position: [0.14, 1.43, 1.24], target: [0.02, 1.09, 0], fov: 46 },
    update,
    onEnter() {},
    onLeave() {},
    hotspots: {
      breechLever: breechLever.handle,       // рычаг «ЗАТВОР»: вниз — открыть, вверх — закрыть (или касание)
      shellToggle: shellToggle.object3D,     // тумблер ОФ (вниз) / ББ (вверх): касание — переключить
      hoistButton: hoistButton.object3D,     // кнопка «ПОДАТЬ СНАРЯД»
      ramLever: ramLever.handle,             // рычаг «ДОСЛАТЬ»: протянуть вниз
      chargePlus: chargePlus.object3D,       // кнопка «ЗАРЯД +»
      chargeMinus: chargeMinus.object3D,     // кнопка «ЗАРЯД −»
      unloadButton: unloadButton.object3D,   // кнопка «РАЗРЯДИТЬ»
      // приборы (не интерактивные — для подсветки в обучении)
      lampAngle: lampAngle.object3D, lampClosed: lampClosed.object3D, lampBusy: lampBusy.object3D,
      counterHe: cHe.object3D, counterAp: cAp.object3D, counterCharges: cCharges.object3D, counterComputed: cComputed.object3D,
    },
    /** Для тестов и отладки (не для игровой логики). */
    controls: { ...controls, ...lampsAndCounters, gun, get shellType() { return TYPES[shellToggle.value ? 1 : 0]; } },
    dispose() {
      offs.forEach((off) => off()); offs.length = 0;
      Object.values(controls).concat(Object.values(lampsAndCounters)).forEach((c) => { if (c.dispose) c.dispose(); });
      gun.dispose();
    },
  };
}
