// Пост «ПОВОРОТ» (traverse) — горизонтальная наводка башни (DESIGN §7.4).
// Колонка с картушкой-репитером курса в центре, слева крыло привода (рычаг «ПРИВОД», стопор, давление),
// справа крыло точной наводки (маховик, прибор рассогласования). Пост ничего не решает сам:
// каждый кадр перечитывает game.state и вызывает game.setBrake / game.rotateTurret.

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

const SLEW_RATE = 12;        // °/с при полном отклонении рычага привода
const FINE_PER_TURN = 1;     // ° на оборот маховика точной наводки
const ALIGN_TOL = 0.05;      // ° — лампа «СОВМЕЩЕНО»
const ERR_SPAN = 10;         // ° — предел шкалы прибора рассогласования
const BLINK_TIME = 1.6;      // с — мигание лампы «СТОПОР» после отказа

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap180 = (d) => ((d + 180) % 360 + 360) % 360 - 180;

// ---- компоновка (м, локальные координаты поста) ----
const HX = 0.28;                         // полуширина центральной колонки = линия «шарнира» крыльев
const WW = 0.62;                         // ширина крыла
const ALPHA = 10 * DEG;                  // разворот крыльев к оператору
const DESK_TILT = 38 * DEG, DESK_H = 0.42, DESK_D = 0.045;
const UP_TILT = 10 * DEG, UP_H = 0.5, UP_D = 0.05;
const ZD0 = 0.02, YD0 = 0.70;            // нижняя кромка стола (тыл панели)
const ZD1 = ZD0 - DESK_H * Math.sin(DESK_TILT), YD1 = YD0 + DESK_H * Math.cos(DESK_TILT);
const ZU1 = ZD1 - UP_H * Math.sin(UP_TILT), YU1 = YD1 + UP_H * Math.cos(UP_TILT);
const BACK = -0.62, TOP = YU1 + 0.04;
const PZ0 = 0.10, PY0 = 0.70, PZ1 = 0.02, PY1 = 0.965, PED_D = 0.03;   // лицевой скос колонки
const HEAD = { y: 1.17, z: 0.02, tilt: 20 * DEG, R: 0.22, Rin: 0.198, Rc: 0.172 };

export function createTraverseStation(ctx) {
  const { engine, THREE, ui, mat, audio, game } = ctx;
  const G = engine.geom, TX = engine.textures;
  const PAL = mat.PALETTE || {};
  const C = {
    ivory: PAL.ivory || '#e8e0c8', ink: PAL.ink || '#1a1a1a', red: PAL.redZone || '#c0392b',
    ochre: PAL.ochre || '#d39a1e', drum: PAL.drum || '#0c0d0e', panel: PAL.panel || '#3d4a57', dark: PAL.panelDark || '#2b343d',
  };

  const group = new THREE.Group();
  group.name = 'station:traverse';
  const controls = [];                               // всё, что нужно освободить в dispose()
  const keep = (c) => { controls.push(c); return c; };
  const place = (c, x, y, z, rx = 0) => { const o = c.object3D || c; o.position.set(x, y, z); o.rotation.x = rx; return c; };

  // ------------------------------------------------------------------ корпус
  const darkPaint = mat.paint(C.dark, { wear: 0.8 });

  /** Тело по боковому профилю [[z, y], …], вытянутое по X на width (центр по X — в нуле). */
  function profileBody(pts, width, bevel = 0.006) {
    const sh = new THREE.Shape();
    pts.forEach(([z, y], i) => (i ? sh.lineTo(z, y) : sh.moveTo(z, y)));
    sh.closePath();
    const g = G.extrude(sh, width, bevel, 1, 4);
    g.rotateY(-Math.PI / 2);                         // ось выдавливания → −X, x профиля → +Z
    g.translate(width / 2, 0, 0);
    return G.boxUV(g, mat.WEAR_REPEAT || 0.8);
  }

  const wingProfile = [[ZD0 - 0.02, 0], [ZD0 - 0.02, YD0 - 0.015], [ZD0, YD0], [ZD1, YD1], [ZU1, YU1], [ZU1 - 0.04, TOP], [BACK, TOP], [BACK, 0]];

  function buildWing(side) {
    const g = new THREE.Group();
    const cx = side * WW / 2;
    const body = new THREE.Mesh(profileBody(wingProfile, WW), darkPaint);
    body.position.x = cx;
    g.add(body);
    const desk = keep(ui.panel({ w: WW, h: DESK_H, d: DESK_D, rivets: 0.1 }));
    g.add(place(desk, cx, (YD0 + YD1) / 2, (ZD0 + ZD1) / 2, -DESK_TILT).object3D);
    const upper = keep(ui.panel({ w: WW, h: UP_H, d: UP_D, rivets: 0.1 }));
    g.add(place(upper, cx, (YD1 + YU1) / 2, (ZD1 + ZU1) / 2, -UP_TILT).object3D);
    g.position.set(side * HX, 0, 0);
    g.rotation.y = -side * ALPHA;                    // наружный край крыла выходит к оператору
    group.add(g);
    return { g, desk, upper };
  }
  const left = buildWing(-1), right = buildWing(1);

  // центральная колонка: тумба со скошенным лицом, за ней — продолжение верхней панели
  const PW = HX * 2;
  const zNeck = ZD1 + (YD1 - PY1) * Math.tan(UP_TILT);
  const pedProfile = [[PZ0, 0], [PZ0, PY0], [PZ1, PY1], [zNeck, PY1], [ZU1, YU1], [ZU1 - 0.04, TOP], [BACK, TOP], [BACK, 0]];
  group.add(new THREE.Mesh(profileBody(pedProfile, PW + 0.012), darkPaint));
  const pedTilt = Math.atan2(PZ0 - PZ1, PY1 - PY0), pedLen = Math.hypot(PZ0 - PZ1, PY1 - PY0);
  const pedFace = keep(ui.panel({ w: PW, h: pedLen, d: PED_D, rivets: 0.092 }));
  group.add(place(pedFace, 0, (PY0 + PY1) / 2, (PZ0 + PZ1) / 2, -pedTilt).object3D);
  const midUpper = keep(ui.panel({ w: PW, h: UP_H, d: UP_D, rivets: false }));
  group.add(place(midUpper, 0, (YD1 + YU1) / 2, (ZD1 + ZU1) / 2, -UP_TILT).object3D);

  const named = (c, name) => { c.object3D.name = 'p:' + name; return c; };   // имена шильдиков — для проверки компоновки
  midUpper.add(named(keep(ui.plate('ПОВОРОТ', { size: 0.034, style: 'black' })), 'title'), 0, 0.183);

  // ------------------------------------------------------------------ картушка-репитер курса
  const head = new THREE.Group();
  head.name = 'compass';
  head.position.set(0, HEAD.y, HEAD.z);
  head.rotation.x = -HEAD.tilt;
  group.add(head);
  const { R, Rin, Rc } = HEAD;
  let cardTex = null, cardMat = null;
  const card = new THREE.Group();          // вращается: rotation.z = пеленг башни
  const bugPivot = new THREE.Group();      // метка записанного пеленга: rotation.z = −(задано − пеленг)
  {
    // кожух (крашеная сталь) и никелевая оправа с болтами, ступица
    const shell = G.boxUV(G.lathe([[R * 0.86, -0.24], [R, -0.2], [R, -0.012], [R, -0.012], [R + 0.004, -0.012]], 48), mat.WEAR_REPEAT || 0.8);
    head.add(new THREE.Mesh(shell, mat.paint(C.panel, { wear: 0.5 })));
    const Ro = R + 0.014, nick = [
      G.lathe([[Ro, -0.016], [Ro, 0.004], [Ro, 0.004], [Ro - 0.007, 0.012], [Rin + 0.006, 0.012], [Rin + 0.006, 0.012], [Rin, 0.006], [Rin, -0.016]], 64),
      G.lathe([[0.024, -0.014], [0.024, -0.005], [0.024, -0.005], [0.017, 0.0], [0.0, 0.002]], 20),
    ];
    for (let i = 0; i < 12; i++) {
      const a = (i + 0.5) / 12 * TAU, rb = (Ro - 0.007 + Rin + 0.006) / 2;
      nick.push(G.xf(G.hexGeometry(0.0062, 0.004), { r: [0, 0, a], p: [rb * Math.cos(a), rb * Math.sin(a), 0.012] }));
    }
    head.add(new THREE.Mesh(G.merge(nick), mat.nickel));

    // картушка
    const S = 512, h = S / 2, cv = TX.makeCanvas(S, S), c2 = cv.getContext('2d');
    c2.fillStyle = C.ivory; c2.fillRect(0, 0, S, S);
    const gr = c2.createRadialGradient(h, h, h * 0.15, h, h, h);
    gr.addColorStop(0, 'rgba(255,250,235,0.25)'); gr.addColorStop(0.7, 'rgba(120,100,60,0)'); gr.addColorStop(1, 'rgba(90,70,30,0.30)');
    c2.fillStyle = gr; c2.fillRect(0, 0, S, S);
    c2.strokeStyle = C.ink; c2.lineCap = 'butt';
    for (let d = 0; d < 360; d++) {
      const major = d % 10 === 0, mid = d % 5 === 0, a = d * DEG, sx = Math.sin(a), sy = -Math.cos(a);
      const r0 = h * 0.975, r1 = h * (major ? 0.845 : mid ? 0.885 : 0.925);
      c2.lineWidth = major ? h * 0.02 : mid ? h * 0.012 : h * 0.006;
      c2.beginPath(); c2.moveTo(h + sx * r0, h + sy * r0); c2.lineTo(h + sx * r1, h + sy * r1); c2.stroke();
    }
    c2.lineWidth = h * 0.01;
    c2.beginPath(); c2.arc(h, h, h * 0.975, 0, TAU); c2.stroke();
    c2.beginPath(); c2.arc(h, h, h * 0.53, 0, TAU); c2.stroke();
    for (let d = 0; d < 360; d += 30) {                       // оцифровка через 30°, север — «С»
      c2.save(); c2.translate(h, h); c2.rotate(d * DEG);
      TX.drawLabel(c2, d === 0 ? 'С' : String(d), 0, -h * 0.69, d === 0 ? h * 0.15 : h * 0.125, { color: d === 0 ? C.red : C.ink, weight: 600, spacing: 0, maxWidth: h * 0.3 });
      c2.restore();
    }
    for (const [d, t] of [[90, 'В'], [180, 'Ю'], [270, 'З']]) {
      c2.save(); c2.translate(h, h); c2.rotate(d * DEG);
      TX.drawLabel(c2, t, 0, -h * 0.42, h * 0.085, { color: '#5a5142', weight: 600, spacing: 0 });
      c2.restore();
    }
    // роза: северный луч красный
    const ray = (deg, len, wid, fill) => {
      c2.save(); c2.translate(h, h); c2.rotate(deg * DEG);
      c2.beginPath(); c2.moveTo(0, -len); c2.lineTo(wid, 0); c2.lineTo(-wid, 0); c2.closePath();
      c2.fillStyle = fill; c2.fill(); c2.restore();
    };
    for (const d of [45, 135, 225, 315]) ray(d, h * 0.2, h * 0.045, '#8d8672');
    ray(90, h * 0.33, h * 0.055, C.ink); ray(180, h * 0.33, h * 0.055, C.ink); ray(270, h * 0.33, h * 0.055, C.ink);
    ray(0, h * 0.36, h * 0.06, C.red);
    cardTex = TX.canvasTexture(cv, { aniso: 8 });
    cardMat = new THREE.MeshStandardMaterial({ map: cardTex, roughness: 0.62, metalness: 0 });
    card.add(new THREE.Mesh(new THREE.CircleGeometry(Rc, 64), cardMat));
    card.position.z = -0.014;
    head.add(card);

    // тёмная дорожка метки между картушкой и оправой
    const track = new THREE.Mesh(new THREE.RingGeometry(Rc - 0.001, Rin + 0.003, 64), mat.bakelite);
    track.position.z = -0.012;
    head.add(track);

    // метка записанного пеленга: охристая «вилка» на дорожке
    const b0 = Rc + 0.003, b1 = Rin - 0.003, bw = 0.017, gap = 0.0065;
    const blk = (sx) => G.xf(new THREE.PlaneGeometry(bw, b1 - b0), { p: [sx * (gap + bw / 2), (b0 + b1) / 2, 0] });
    const tip = (sx) => {                                   // «усы» метки заходят на шкалу картушки
      const g = new THREE.BufferGeometry();
      const x0 = sx * gap, x1 = sx * (gap + bw);
      const v = sx > 0 ? [x0, b0, 0, x1, b0, 0, x0, b0 - 0.02, 0] : [x1, b0, 0, x0, b0, 0, x0, b0 - 0.02, 0];
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
      return g;
    };
    const bug = new THREE.Mesh(G.merge([blk(-1), blk(1), tip(-1), tip(1)]), mat.emissive(C.ochre, 1.15));
    bugPivot.add(bug);
    bugPivot.position.z = -0.0105;
    bugPivot.visible = false;
    head.add(bugPivot);

    // курсовая черта (неподвижная): красный клин сверху
    const ls = new THREE.Shape();
    ls.moveTo(-0.0075, Rin + 0.004); ls.lineTo(0.0075, Rin + 0.004); ls.lineTo(0.0018, Rc - 0.032); ls.lineTo(-0.0018, Rc - 0.032); ls.closePath();
    const lub = new THREE.Mesh(new THREE.ShapeGeometry(ls), mat.emissive(C.red, 1.25));
    lub.position.z = -0.008;
    head.add(lub);

    // выпуклое стекло
    const k = 2.6, cap = Math.asin(1 / k), gg = new THREE.SphereGeometry(Rin * k, 40, 5, 0, TAU, 0, cap);
    gg.rotateX(Math.PI / 2); gg.translate(0, 0, -0.004 - Rin * k * Math.cos(cap));
    const glass = new THREE.Mesh(gg, mat.glass);
    glass.renderOrder = 3;
    head.add(glass);
  }

  // ------------------------------------------------------------------ счётчики на колонке
  const cBearing = keep(ui.drumCounter({ digits: 5, decimals: 2, unit: '°', digitH: 0.06, wrap: 360 }));
  pedFace.add(cBearing, -0.108, -0.042);
  pedFace.add(named(keep(ui.plate('ПЕЛЕНГ БАШНИ', { size: 0.026, screws: false })), 'bearing'), -0.108, 0.05);
  const SET_H = 0.044;
  const cSet = keep(ui.drumCounter({ digits: 4, decimals: 1, unit: '°', digitH: SET_H, wrap: 360 }));
  pedFace.add(cSet, 0.158, -0.042);
  pedFace.add(named(keep(ui.plate('ЗАДАНО', { size: 0.026, screws: false })), 'set'), 0.158, 0.05);
  // шторка «нет задания» поверх окна репитера
  let blankTex = null, blankMat = null;
  const blank = (() => {
    const border = (cSet.h - SET_H) / 2, iw = cSet.w - border * 2;
    const cv = TX.makeCanvas(256, Math.round(256 * SET_H / iw)), c2 = cv.getContext('2d');
    c2.fillStyle = C.drum; c2.fillRect(0, 0, cv.width, cv.height);
    c2.fillStyle = 'rgba(232,224,200,0.55)';
    for (let i = 0; i < 4; i++) c2.fillRect(cv.width * (0.1 + i * 0.215), cv.height * 0.46, cv.width * 0.13, cv.height * 0.09);
    blankTex = TX.canvasTexture(cv, { aniso: 2 });
    blankMat = new THREE.MeshBasicMaterial({ map: blankTex });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(iw, SET_H), blankMat);
    m.position.z = 0.0085;
    m.renderOrder = 2;
    cSet.object3D.add(m);
    return m;
  })();

  // ------------------------------------------------------------------ левое крыло: привод и стопор
  const gPressure = keep(ui.gauge({ radius: 0.09, min: 0, max: 160, majorStep: 40, minorStep: 10, unit: 'АТМ', caption: 'ДАВЛЕНИЕ', captionSize: 0.027, zones: [{ from: 130, to: 160 }], speed: 12, damping: 0.75 }));
  left.upper.add(gPressure, -0.195, 0.07);

  const brakeLever = keep(ui.lever({
    mode: 'toggle', length: 0.16, labels: [], on: !(game.state.turret && game.state.turret.brake),
    onChange(on) { game.setBrake(!on); },             // верх — «СТОПОР», низ — «СВОБОДНО»
  }));
  left.upper.add(brakeLever, -0.005, 0.03);
  const lampBrake = keep(ui.lamp({ color: 'green', label: 'СТОПОР', labelSize: 0.027 }));
  left.upper.add(lampBrake, 0.16, 0.125);
  const lampFree = keep(ui.lamp({ color: 'amber', label: 'СВОБОДНО', labelSize: 0.027 }));
  left.upper.add(lampFree, 0.16, -0.035);

  let slewV = 0, slewCut = false;      // slewCut — жест оборван уходом с поста: до отпускания рычаг не действует
  const slew = keep(ui.slewLever({
    length: 0.2,
    onInput(v) { slewV = +v || 0; },
  }));
  left.desk.add(slew, -0.03, -0.155);
  left.desk.add(named(keep(ui.plate('ПРИВОД', { size: 0.031, screws: false })), 'drive'), -0.03, 0.155);

  // ------------------------------------------------------------------ правое крыло: точная наводка
  const gError = keep(ui.gauge({
    radius: 0.115, min: -ERR_SPAN, max: ERR_SPAN, majorStep: 5, minorStep: 1, sweep: 180, unit: 'ГРАД',
    caption: 'РАССОГЛАСОВАНИЕ', captionSize: 0.027, zones: [{ from: -0.5, to: 0.5, color: '#3d8f4f' }], speed: 14, damping: 0.8,
  }));
  right.upper.add(gError, -0.128, 0.085);
  const lampAligned = keep(ui.lamp({ color: 'green', label: 'СОВМЕЩЕНО', labelSize: 0.027 }));
  right.upper.add(lampAligned, 0.18, 0.1);
  right.upper.add(named(keep(ui.plate('ТОЧНАЯ НАВОДКА', { size: 0.028, screws: false })), 'fine'), 0.03, -0.195);

  let acc = 0;                 // накопленный, ещё не переданный игре поворот (°) — чтобы не терять доли 0.01°
  let wheelDenied = false, wheelCut = false, slewDenied = false, blinkT = 0;
  function flush(power) {
    const q = Math.round(acc * 100) / 100;
    if (q === 0) return true;
    const r = game.rotateTurret(q, power ? { power: true } : undefined);
    if (r && r.ok) { acc -= q; return true; }
    acc = 0; return false;
  }
  /** Одна попытка провернуть башню на стопоре за жест: игра сама сообщит «Башня на стопоре». */
  function denyOnce(dir) {
    acc = 0;
    blinkT = BLINK_TIME;
    game.rotateTurret(dir < 0 ? -0.01 : 0.01);
  }
  // органы действуют только на своём посту и только в бою (в меню/на паузе/после итогов — молчат, без отказов)
  const isCurrent = () => engine.current === 'traverse' && game.state.phase === 'playing' && !game.state.paused;
  const brakeOn = () => { const t = game.state.turret; return !t || t.brake !== false; };

  const WHEEL_R = 0.165;
  const wheel = keep(ui.handwheel({
    radius: WHEEL_R, spokes: 4,
    onStart() { wheelDenied = false; wheelCut = false; },
    onTurn(d) {
      if (wheelCut || !isCurrent()) return;
      if (brakeOn()) {
        wheel.spin(-d);                               // на стопоре маховик не проворачивается
        if (!wheelDenied) { wheelDenied = true; denyOnce(d); }
        return;
      }
      acc += d / TAU * FINE_PER_TURN;
      flush();
    },
    onEnd() { wheelDenied = false; },
  }));
  // прилив редуктора под маховиком
  {
    const boss = G.lathe([[0.125, 0], [0.125, 0.012], [0.125, 0.012], [0.105, 0.024], [0.07, 0.028]], 32);
    const m = new THREE.Mesh(boss, mat.darkSteel);
    right.desk.add(m, 0.03, -0.005);
  }
  right.desk.add(wheel, 0.03, -0.005);
  wheel.object3D.position.z += 0.02;
  const wheelRim = new THREE.Object3D();              // точка хвата на ободе (для подсказок и тестов)
  wheelRim.position.set(0, WHEEL_R, wheel.wheel ? wheel.wheel.position.z : 0.05);
  wheel.object3D.add(wheelRim);

  // ------------------------------------------------------------------ декор за пультом (сталь, медь, кабели)
  {
    const steel = [], copper = [], rubber = [];
    const up = (g) => { g.rotateX(-Math.PI / 2); return g; };       // тело вращения «лицом в +Z» → стоймя
    // гидроаккумулятор
    steel.push(G.xf(up(G.lathe([[0.11, 0], [0.11, 0.03], [0.1, 0.03], [0.1, 0.4], [0.1, 0.4], [0.088, 0.455], [0.05, 0.49], [0.022, 0.5], [0.022, 0.53]], 20)), { p: [-0.56, TOP, -0.4] }));
    steel.push(G.xf(up(G.lathe([[0.104, 0.2], [0.104, 0.225], [0.1, 0.225]], 20)), { p: [-0.56, TOP, -0.4] }));
    copper.push(G.pipeGeometry([[-0.56, TOP + 0.52, -0.4], [-0.56, 2.28, -0.4], [-0.56, 2.28, -0.84]], 0.022));
    copper.push(G.pipeGeometry([[-0.45, TOP + 0.09, -0.4], [-0.12, TOP + 0.09, -0.4], [-0.12, TOP, -0.4]], 0.018));
    copper.push(G.pipeGeometry([[-0.8, 0.02, -0.7], [-0.8, 2.3, -0.7], [-0.8, 2.3, -0.84]], 0.02));
    // распределительная коробка и кабельный ввод
    const box = new THREE.BoxGeometry(0.3, 0.2, 0.16); box.translate(0.52, TOP + 0.1, -0.42); steel.push(box);
    const lid = new THREE.BoxGeometry(0.24, 0.14, 0.012); lid.translate(0.52, TOP + 0.1, -0.335); steel.push(lid);
    steel.push(G.pipeGeometry([[0.6, TOP + 0.2, -0.42], [0.6, 2.3, -0.42], [0.6, 2.3, -0.84]], 0.024, { flanges: true }));
    steel.push(G.pipeGeometry([[0.82, 0.02, -0.7], [0.82, 2.32, -0.7], [0.82, 2.32, -0.84]], 0.016));
    const cab = (pts, r) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal'), 20, r, 6, false);
    rubber.push(cab([[0.4, TOP + 0.1, -0.42], [0.3, TOP + 0.06, -0.4], [0.2, TOP + 0.02, -0.38], [0.14, TOP - 0.03, -0.37]], 0.012));
    rubber.push(cab([[0.42, TOP + 0.14, -0.4], [0.26, TOP + 0.2, -0.42], [0.06, TOP + 0.1, -0.44], [0.0, TOP - 0.02, -0.45]], 0.009));
    group.add(new THREE.Mesh(G.merge(steel), mat.darkSteel));
    group.add(new THREE.Mesh(G.merge(copper), mat.copper));
    group.add(new THREE.Mesh(G.merge(rubber), mat.rubber));
  }

  // ------------------------------------------------------------------ состояние отображения
  let pressure = 0, servoLevel = 0, flutter = 0;

  function update(dt) {
    const s = game.state || {};
    const brake = brakeOn();

    // --- привод: рычаг удерживается → вращаем башню ---
    let drive = 0;
    const held = !!slew.held;
    if (!held) { slewV = 0; slewCut = false; slewDenied = false; }     // жест окончен — снять блокировки
    const v = held && !slewCut && isCurrent() ? slewV : 0;
    if (v !== 0) {
      if (brake) {
        if (!slewDenied) { slewDenied = true; denyOnce(v); }           // один отказ за жест
      } else if (game.state.faults && game.state.faults.drive) {
        if (!slewDenied) { slewDenied = true; acc = Math.sign(v) * 0.01; flush(true); blinkT = BLINK_TIME; }   // один отказ за жест
      } else {
        acc += Math.sign(v) * v * v * SLEW_RATE * dt;
        flush(true);
        drive = Math.abs(v);
      }
    }
    if (brake) acc = 0;

    // показания читаем ПОСЛЕ вращения, чтобы приборы не отставали на кадр
    const t = s.turret || {};
    const bearing = isFinite(t.bearing) ? +t.bearing : 0;
    const recAll = s.plot && s.plot.recorded;
    const rec = recAll && s.activeTarget != null ? recAll[s.activeTarget] : null;
    const cp = s.computer;
    const wind = cp && cp.elevation != null && !cp.stale && cp.windBearing ? cp.windBearing : 0;
    const set = rec && isFinite(rec.bearing) ? ((+rec.bearing + wind) % 360 + 360) % 360 : null;

    // --- стопор ---
    if (brakeLever.on === brake) brakeLever.set(!brake);
    if (blinkT > 0) blinkT = brake ? blinkT - dt : 0;
    lampBrake.set(blinkT > 0 ? 'blink' : brake);
    lampFree.set(!brake);

    // --- счётчики, картушка, рассогласование ---
    cBearing.setValue(bearing);
    card.rotation.z = bearing * DEG;
    blank.visible = set == null;
    bugPivot.visible = set != null;
    let err = 0;
    if (set != null) {
      cSet.setValue(set);
      err = wrap180(bearing - set);
      bugPivot.rotation.z = -wrap180(set - bearing) * DEG;
    }
    gError.setValue(clamp(err, -ERR_SPAN, ERR_SPAN));
    lampAligned.set(set != null && Math.abs(err) <= ALIGN_TOL + 1e-6);

    // --- гидравлика и звук привода ---
    const pTarget = drive > 0 ? 58 + 72 * drive : (brake ? 0 : 18);
    pressure += (pTarget - pressure) * (1 - Math.exp(-dt * (pTarget > pressure ? 3.6 : 0.75)));
    flutter += dt;
    gPressure.setValue(pressure + (drive > 0 ? Math.sin(flutter * 23) * 1.6 : 0));
    const level = drive > 0 ? 0.18 + 0.82 * drive : 0;
    if (level !== servoLevel) { servoLevel = level; audio.servo(level); }
  }

  function stopDrive() {
    slewV = 0; slewCut = true; slewDenied = false; wheelCut = true; acc = 0;
    if (servoLevel !== 0) { servoLevel = 0; audio.servo(0); }
  }

  const hotspots = {
    brakeLever: brakeLever.handle || brakeLever.object3D,
    slewLever: slew.handle || slew.object3D,
    fineWheel: wheel.object3D,
    fineWheelRim: wheelRim,
    bearingCounter: cBearing.object3D,
    setCounter: cSet.object3D,
    compass: head,
    errorGauge: gError.object3D,
    pressureGauge: gPressure.object3D,
    lampBrake: lampBrake.object3D,
    lampFree: lampFree.object3D,
    lampAligned: lampAligned.object3D,
  };

  return {
    id: 'traverse',
    title: 'ПОВОРОТ',
    group,
    camera: { position: [0, 1.38, 1.25], target: [0, 1.085, 0], fov: 46 },
    hotspots,
    update,
    onEnter() { stopDrive(); slewCut = false; wheelCut = false; },
    onLeave() { stopDrive(); },
    /** Снимок показаний приборов (для тестов и отладки). */
    inspect() {
      return {
        bearingCounter: cBearing.value, setCounter: blank.visible ? null : cSet.value,
        cardDeg: card.rotation.z / DEG, bugVisible: bugPivot.visible, bugDeg: -bugPivot.rotation.z / DEG,
        error: gError.value, pressure, servo: servoLevel,
        lampBrake: lampBrake.state, lampFree: lampFree.state, lampAligned: lampAligned.state,
        leverFree: brakeLever.on, slew: slewV, wheelAngle: wheel.angle,
      };
    },
    dispose() {
      stopDrive();
      controls.forEach((c) => { try { c.dispose(); } catch (e) { /* уже снято */ } });
      controls.length = 0;
      group.removeFromParent();
      if (cardTex) cardTex.dispose();
      if (cardMat) cardMat.dispose();
      if (blankTex) blankTex.dispose();
      if (blankMat) blankMat.dispose();
    },
  };
}
