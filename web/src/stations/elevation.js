// Пост «ПОДЪЁМ» (elevation) — вертикальная наводка орудия. DESIGN §7.5.
// Пост ничего не решает сам: показывает game.state и вызывает game.elevate().
//
// Компоновка (координаты лицевой панели, м; панель наклонена на 12°):
//   слева   — редуктор с маховиком «ПОДЪЁМ СТВОЛА» и тумблером «ГРУБО / ТОЧНО» над ним;
//   в центре — сектор −2…45° с моделью качающейся части (ствол на цапфах, зубчатая дуга, шестерня),
//              под ним лампа «УГОЛ ЗАРЯЖАНИЯ» и кнопка привода «НА УГОЛ ЗАРЯЖАНИЯ»;
//   справа  — приборная доска: счётчик «УГОЛ СТВОЛА», репитер «ЗАДАНО», «РАСЧЁТ УСТАРЕЛ»,
//              нуль-индикатор «РАССОГЛАСОВАНИЕ» (своя постройка, шкала растянута у нуля), лампа «СОВМЕЩЕНО».

const DEG = Math.PI / 180, TAU = Math.PI * 2;
const COARSE = 10, FINE = 0.5;          // градусов ствола на оборот маховика
const DRIVE_RATE = 8;                   // °/с — силовой привод «на угол заряжания»
const ALIGN_TOL = 2;                    // сотых градуса — «СОВМЕЩЕНО»
const ERR_SPAN = 2;                     // ° — предел шкалы рассогласования
const TICK = 15 * DEG;                  // шаг трещотки маховика
const GREEN_ZONE = '#3d8f4f';

export function createElevationStation(ctx) {
  const { engine, THREE, ui, mat, audio, game } = ctx;
  const G = engine.geom, T = engine.textures, PAL = mat.PALETTE;
  const polar = (r, deg) => [r * Math.cos(deg * DEG), r * Math.sin(deg * DEG)];
  const painted = (g, hex, wear = 0.5) => new THREE.Mesh(G.boxUV(g, mat.WEAR_REPEAT), mat.paint(hex, { wear }));

  const group = new THREE.Group();
  group.name = 'station:elevation';
  const place = (p, x, y, z, rx = 0) => { const o = p.object3D || p; o.position.set(x, y, z); o.rotation.x = rx; group.add(o); return p; };

  // ------------------------------------------------------------------ корпус
  place(ui.panel({ w: 1.72, h: 0.72, d: 0.46, color: PAL.panelDark, rivets: 0.12, wear: 0.8 }), 0, 0.36, -0.42);      // тумба
  place(ui.panel({ w: 1.74, h: 0.92, d: 0.26, color: PAL.panelDark, rivets: false, wear: 0.8 }), 0, 1.15, -0.385);    // короб за панелью
  const main = place(ui.panel({ w: 1.66, h: 0.8, d: 0.06, rivets: false }), 0, 1.10, -0.03, -12 * DEG);
  const face = new THREE.Group();                    // лицевая плоскость панели: X вправо, Y вверх по панели
  face.position.z = main.d;
  main.object3D.add(face);
  const on = (child, x, y, z = 0) => { const o = child.object3D || child; o.position.set(x, y, z); face.add(o); return child; };

  const steelParts = [], darkParts = [], copperParts = [], nickelParts = [];   // статичный декор — по одному мешу на материал

  // ряды заклёпок по верхней и нижней кромкам панели, винты приборной доски
  for (const y of [-0.376, 0.376]) for (let i = 0; i <= 16; i++) steelParts.push(G.xf(G.rivetGeometry(0.007, 6), { p: [-0.8 + i * 0.1, y, 0] }));

  // ------------------------------------------------------------------ редуктор и маховик (слева)
  const WX = -0.55, WY = -0.09, WR = 0.18, HOUSING_H = 0.05;
  {
    const housing = painted(G.lathe([
      [0.257, 0], [0.257, 0.011], [0.25, 0.0165], [0.2, 0.0165], [0.2, 0.0165], [0.188, 0.026], [0.108, 0.045], [0.094, HOUSING_H], [0, HOUSING_H],
    ], 56), PAL.panelDark, 0.5);
    on(housing, WX, WY);
    for (let i = 0; i < 6; i++) {                    // болты крышки редуктора
      const a = (i + 0.5) / 6 * TAU;
      steelParts.push(G.xf(G.hexGeometry(0.012, 0.012), { p: [WX + Math.cos(a) * 0.135, WY + Math.sin(a) * 0.135, 0.036] }));
    }
    // кольцевой шильдик вокруг маховика
    const S = 512, k = S / 0.5, cv = T.makeCanvas(S, S), c2 = cv.getContext('2d'), cx = S / 2, cy = S / 2;
    const r0 = 0.203 * k, r1 = 0.2495 * k, rm = (r0 + r1) / 2;
    c2.fillStyle = PAL.plateBlack; c2.fillRect(0, 0, S, S);
    const sh = c2.createLinearGradient(0, 0, 0, S);
    sh.addColorStop(0, 'rgba(255,255,255,0.10)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.18)');
    c2.fillStyle = sh; c2.fillRect(0, 0, S, S);
    c2.strokeStyle = 'rgba(232,224,200,0.55)'; c2.lineWidth = 1.6;
    for (const r of [r0 + 3.5, r1 - 3.5]) { c2.beginPath(); c2.arc(cx, cy, r, 0, TAU); c2.stroke(); }
    // маховик вынесен к игроку и из-за перспективы закрывает левую и нижнюю части кольца — надписи стоят справа
    arcText(c2, 'ПОДЪЁМ СТВОЛА', cx, cy, rm, 34 * DEG, 0.025 * k, false);
    arcText(c2, 'ПО ЧАСОВОЙ — ВВЕРХ', cx, cy, rm, 139 * DEG, 0.021 * k, true);
    c2.strokeStyle = PAL.ochre; c2.fillStyle = PAL.ochre; c2.lineWidth = 4; c2.lineCap = 'butt';
    for (const [a0, a1] of [[76, 98], [250, 300]]) {   // стрелки «по часовой» (углы — по часовой от «12 часов»)
      c2.beginPath(); c2.arc(cx, cy, rm, (a0 - 90) * DEG, (a1 - 6 - 90) * DEG); c2.stroke();
      const e = a1 * DEG, px = cx + Math.sin(e) * rm, py = cy - Math.cos(e) * rm, tx = Math.cos(e), ty = Math.sin(e);
      c2.beginPath();
      c2.moveTo(px, py); c2.lineTo(px - tx * 26 - ty * 11, py - ty * 26 + tx * 11); c2.lineTo(px - tx * 26 + ty * 11, py - ty * 26 - tx * 11);
      c2.closePath(); c2.fill();
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.2025, 0.2497, 72, 1),
      new THREE.MeshStandardMaterial({ map: T.canvasTexture(cv, { aniso: 8 }), roughness: 0.42, metalness: 0.35 }));
    ring.name = 'wheelRing';
    on(ring, WX, WY, 0.0172);
  }

  // --- логика маховика ---
  let fine = 0;                       // 0 — ГРУБО, 1 — ТОЧНО (состояние органа управления, не игры)
  let acc = 0;                        // накопленный, ещё не переданный игре ход, °
  let upBlocked = false;              // игра отказала в подъёме — до нового жеста больше не просим
  let pushAcc = 0, thud = false, tickAcc = 0;
  const live = () => { const s = game.state; return !!s && s.phase === 'playing' && !s.paused && !!s.turret && !!s.breech; };

  const wheel = ui.handwheel({
    radius: WR, spokes: 5, standoff: 0.04, tickAngle: 0,
    onStart() { acc = 0; upBlocked = false; pushAcc = 0; thud = false; },
    onEnd() { acc = 0; },
    onTurn(d) {
      if (!live()) return;
      const s = game.state, C = game.C, el = s.turret.elevation, up = d > 0;
      const atHard = up ? el >= C.EL_MAX - 0.004 : el <= C.EL_MIN + 0.004;            // механический упор
      // затвор открыт — блокировка подъёма выше угла заряжания (если ствол успели поднять, пока затвор открывался,
      // игра отказывает и в спуске малыми шагами — тогда заперты оба направления, пока затвор не закроют)
      const atLock = s.breech.open && (up ? el >= C.LOAD_ANGLE - 0.004 : el > C.LOAD_ANGLE + 0.004);
      if (atHard || atLock) {
        wheel.spin(-d);                                // маховик упёрся и не идёт за пальцем
        acc = 0;
        if (!thud) { thud = true; audio.clunk(); }
        if (atLock && !upBlocked) {
          pushAcc += Math.abs(d);
          if (pushAcc > 0.06) { upBlocked = true; game.elevate(up ? 0.01 : -0.01); }               // один отказ за жест (плашку покажет оболочка)
        }
        return;
      }
      thud = false; pushAcc = 0;
      tickAcc += Math.abs(d);
      if (tickAcc >= TICK) { tickAcc %= TICK; audio.ratchet(); }
      acc += d / TAU * (fine ? FINE : COARSE);
      let n = Math.trunc(acc * 100 + (acc > 0 ? 1e-6 : -1e-6));                       // целых сотых градуса
      if (n === 0) return;
      acc -= n / 100;
      if (n > 0 && s.breech.open) n = Math.min(n, Math.round((C.LOAD_ANGLE - el) * 100));   // до блокировки — без отказа
      if (n === 0) return;
      const r = game.elevate(n / 100);
      if (!r || !r.ok) { if (n > 0) upBlocked = true; acc = 0; }
    },
  });
  on(wheel, WX, WY, HOUSING_H);

  const tGear = ui.toggle({
    labels: ['ГРУБО\n10°/ОБ.', 'ТОЧНО\n0,5°/ОБ.'], orient: 'h', value: 0, labelSize: 0.024,
    onChange(i) { fine = i ? 1 : 0; acc = 0; },
  });
  on(tGear, WX, 0.262);
  const gearCoarse = new THREE.Object3D(), gearFine = new THREE.Object3D();    // точки касания подписей тумблера
  gearCoarse.position.set(-0.125, 0, 0); gearFine.position.set(0.125, 0, 0);
  tGear.object3D.add(gearCoarse, gearFine);

  // ------------------------------------------------------------------ сектор и модель качающейся части (центр)
  const QX = -0.175, QY = 0.0;
  const quad = new THREE.Group();
  quad.name = 'quadrant';
  on(quad, QX, QY);
  const R_IN = 0.297, R_OUT = 0.418, A0 = -4.5, A1 = 48;        // шкала: кольцевой сектор
  const R_TICK = 0.372;                                         // окружность, на которой встречаются стрелка и метка
  const sector = (r0, r1, a0, a1) => {
    const s = new THREE.Shape();
    s.absarc(0, 0, r1, a0 * DEG, a1 * DEG, false);
    s.absarc(0, 0, r0, a1 * DEG, a0 * DEG, true);
    s.closePath();
    return s;
  };
  {
    // основание-«веер» с заклёпками
    const fan = new THREE.Shape();
    fan.moveTo(-0.105, -0.16); fan.lineTo(0.105, -0.16); fan.lineTo(0.128, -0.06);
    fan.lineTo(...polar(0.437, -6.5)); fan.absarc(0, 0, 0.437, -6.5 * DEG, 50.5 * DEG, false);
    fan.lineTo(-0.04, 0.09); fan.lineTo(-0.105, 0.045); fan.closePath();
    const parts = [G.extrude(fan, 0.008, 0.002, 2, 24)];
    for (const [x, y] of [[-0.09, -0.146], [0.092, -0.146], [-0.09, 0.034], polar(0.428, -5.2), polar(0.428, 49.3), polar(0.27, 49.5), polar(0.27, -9)]) {
      parts.push(G.xf(G.rivetGeometry(0.0055, 6), { p: [x, y, 0.008] }));
    }
    quad.add(painted(G.merge(parts), PAL.panelDark, 0.5));

    // шкала «слоновая кость»
    const X0 = 0.19, Y0 = -0.04, SPAN = 0.36, S = 512, k = S / SPAN;
    const cv = T.makeCanvas(S, S), c2 = cv.getContext('2d');
    const cx = -X0 * k, cy = S + Y0 * k;                        // ось цапф в координатах холста
    const pt = (r, deg) => [cx + r * k * Math.cos(deg * DEG), cy - r * k * Math.sin(deg * DEG)];
    const arc = (r, a0, a1, w, color) => { c2.strokeStyle = color; c2.lineWidth = w; c2.beginPath(); c2.arc(cx, cy, r * k, -a1 * DEG, -a0 * DEG); c2.stroke(); };
    c2.fillStyle = PAL.ivory; c2.fillRect(0, 0, S, S);
    const sh = c2.createRadialGradient(cx, cy, R_IN * k, cx, cy, R_OUT * k);
    sh.addColorStop(0, 'rgba(90,70,30,0.26)'); sh.addColorStop(0.18, 'rgba(120,100,60,0)'); sh.addColorStop(0.85, 'rgba(120,100,60,0)'); sh.addColorStop(1, 'rgba(90,70,30,0.28)');
    c2.fillStyle = sh; c2.fillRect(0, 0, S, S);
    c2.lineCap = 'butt';
    arc(0.3855, game.C.EL_MIN, game.C.LOAD_ANGLE, 0.017 * k, GREEN_ZONE);                 // зона угла заряжания
    arc(0.3855, game.C.EL_MIN - 1.1, game.C.EL_MIN, 0.017 * k, PAL.redZone);              // упоры
    arc(0.3855, game.C.EL_MAX, game.C.EL_MAX + 1.1, 0.017 * k, PAL.redZone);
    arc(R_TICK, game.C.EL_MIN, game.C.EL_MAX, 2.2, PAL.ink);
    for (let v = game.C.EL_MIN; v <= game.C.EL_MAX; v++) {
      const major = v % 10 === 0, mid = v % 5 === 0;
      const [x1, y1] = pt(R_TICK, v), [x2, y2] = pt(major ? 0.343 : mid ? 0.349 : 0.357, v);
      c2.strokeStyle = PAL.ink; c2.lineWidth = major ? 4.5 : mid ? 3 : 1.8;
      c2.beginPath(); c2.moveTo(x1, y1); c2.lineTo(x2, y2); c2.stroke();
      if (major) { const [nx, ny] = pt(0.3205, v); T.drawLabel(c2, String(v), nx, ny, 0.0225 * k, { color: PAL.ink, weight: 600, spacing: 0 }); }
    }
    { const [nx, ny] = pt(0.3215, 45.6); T.drawLabel(c2, '45', nx, ny, 0.017 * k, { color: PAL.ink, weight: 600, spacing: 0 }); }
    const bandG = new THREE.ShapeGeometry(sector(R_IN, R_OUT, A0, A1), 56);
    const bp = bandG.attributes.position, buv = bandG.attributes.uv;
    for (let i = 0; i < bp.count; i++) buv.setXY(i, (bp.getX(i) - X0) / SPAN, (bp.getY(i) - Y0) / SPAN);
    const band = new THREE.Mesh(bandG, new THREE.MeshStandardMaterial({ map: T.canvasTexture(cv, { aniso: 8 }), roughness: 0.62, metalness: 0 }));
    band.position.z = 0.0088; band.name = 'sectorScale';
    quad.add(band);

    // никелевая оправа шкалы
    const rails = [G.extrude(sector(R_IN - 0.008, R_IN, A0 - 1.2, A1 + 1.2), 0.005, 0.0012, 1, 40), G.extrude(sector(R_OUT, R_OUT + 0.008, A0 - 0.9, A1 + 0.9), 0.005, 0.0012, 1, 40)];
    for (const a of [A0 - 0.55, A1 + 0.55]) {
      const [x, y] = polar((R_IN + R_OUT) / 2, a);
      rails.push(G.xf(new THREE.BoxGeometry(R_OUT - R_IN + 0.012, 0.007, 0.005), { r: [0, 0, a * DEG], p: [x, y, 0.0025] }));
    }
    for (const g of rails) nickelParts.push(G.xf(g, { p: [QX, QY, 0.008] }));

    // станина: щека с подшипником цапфы, опорная плита, коробка конической передачи и вал от редуктора
    const cheek = new THREE.Shape();
    cheek.moveTo(-0.082, -0.15); cheek.lineTo(0.082, -0.15); cheek.lineTo(0.037, 0); cheek.absarc(0, 0, 0.037, 0, Math.PI, false); cheek.closePath();
    darkParts.push(G.xf(G.extrude(cheek, 0.012, 0.002, 2, 16), { p: [QX, QY, 0.008] }));
    darkParts.push(G.xf(G.slab(0.2, 0.024, 0.02, { r: 0.004, bevel: 0.002 }), { p: [QX, QY - 0.147, 0.008] }));
    darkParts.push(G.xf(G.slab(0.046, 0.04, 0.024, { r: 0.006, bevel: 0.003 }), { p: [QX - 0.078, QY - 0.116, 0.004] }));
    steelParts.push(G.rod([WX + 0.25, QY - 0.116, 0.017], [QX - 0.098, QY - 0.116, 0.017], 0.0095, 10));
    steelParts.push(G.rod([WX + 0.25, QY - 0.116, 0.017], [WX + 0.262, QY - 0.116, 0.017], 0.017, 12));
    for (const x of [-0.085, 0.085]) steelParts.push(G.xf(G.hexGeometry(0.008, 0.006), { p: [QX + x, QY - 0.147, 0.028] }));
  }

  // подвижная метка задания (наружный красный указатель) и упор блокировки затвора
  const redPaint = mat.paint(PAL.redZone, { wear: 0.2 });
  const bug = new THREE.Group();
  {
    const s = new THREE.Shape();
    s.moveTo(R_TICK + 0.0025, 0); s.lineTo(0.404, 0.0165); s.lineTo(0.43, 0.0165); s.lineTo(0.43, -0.0165); s.lineTo(0.404, -0.0165); s.closePath();
    const m = new THREE.Mesh(G.boxUV(G.extrude(s, 0.005, 0.001), 0.3), redPaint);
    m.position.z = 0.0092;
    bug.add(m);
  }
  bug.visible = false;
  quad.add(bug);
  const lockBar = new THREE.Mesh(G.boxUV(G.xf(new THREE.BoxGeometry(R_OUT - R_IN + 0.016, 0.0075, 0.012), {
    r: [0, 0, (game.C.LOAD_ANGLE + 0.7) * DEG], p: [...polar((R_IN + R_OUT) / 2, game.C.LOAD_ANGLE + 0.7), 0.016],
  }), 0.3), redPaint);
  lockBar.name = 'breechLockBar'; lockBar.visible = false;
  quad.add(lockBar);

  // качающаяся часть: ствол на цапфах, люлька, зубчатая дуга, стрелка
  const tilt = new THREE.Group();
  tilt.name = 'elevatingMass';
  quad.add(tilt);
  const GEAR_PHI = -105, ARC_PITCH = 7.2, ARC_ROOT = 0.094, ARC_TIP = 0.1065, PIN_DIST = 0.12, PIN_N = 10;
  {
    const ZB = 0.05;                                              // высота оси ствола над панелью
    const barrel = G.lathe([
      [0, -0.068], [0.027, -0.068], [0.031, -0.063], [0.031, 0.05], [0.031, 0.05], [0.0245, 0.058], [0.0245, 0.118], [0.0245, 0.118],
      [0.0215, 0.124], [0.0158, 0.25], [0.0158, 0.25], [0.0198, 0.253], [0.0198, 0.273], [0.0198, 0.273], [0.0115, 0.273], [0.0115, 0.262], [0, 0.262],
    ], 20);
    barrel.rotateY(Math.PI / 2);
    barrel.translate(0, 0, ZB);
    tilt.add(new THREE.Mesh(barrel, mat.steel));

    const cradle = painted(G.merge([
      G.xf(G.slab(0.17, 0.052, 0.046, { r: 0.008, bevel: 0.003 }), { p: [0.012, -0.032, 0.024] }),
    ]), PAL.panel, 0.2);
    tilt.add(cradle);

    // зубчатая дуга (относительные углы: −158…−96°), спицы, казённик, накатник
    const arcPts = [], a0 = -158, a1 = -96;
    arcPts.push(polar(0.078, a0), polar(ARC_ROOT, a0));
    for (let kTooth = -8; kTooth <= 1; kTooth++) {
      const c = GEAR_PHI + (kTooth + 0.5) * ARC_PITCH;
      if (c - 0.3 * ARC_PITCH < a0 || c + 0.3 * ARC_PITCH > a1) continue;
      arcPts.push(polar(ARC_ROOT, c - 0.3 * ARC_PITCH), polar(ARC_TIP, c - 0.15 * ARC_PITCH), polar(ARC_TIP, c + 0.15 * ARC_PITCH), polar(ARC_ROOT, c + 0.3 * ARC_PITCH));
    }
    arcPts.push(polar(ARC_ROOT, a1), polar(0.078, a1));
    for (let a = a1 - 4; a > a0; a -= 4) arcPts.push(polar(0.078, a));
    const arcShape = new THREE.Shape(arcPts.map(p => new THREE.Vector2(p[0], p[1])));
    const dark = [G.xf(G.extrude(arcShape, 0.009, 0.001, 1, 4), { p: [0, 0, 0.022] })];
    for (const a of [-150, -104]) {
      const [x, y] = polar(0.056, a);
      dark.push(G.xf(new THREE.BoxGeometry(0.056, 0.011, 0.007), { r: [0, 0, a * DEG], p: [x, y, 0.0265] }));
    }
    dark.push(G.xf(new THREE.BoxGeometry(0.03, 0.08, 0.07), { p: [-0.081, 0, ZB] }));                    // казённик
    dark.push(G.rod([-0.05, 0.037, ZB + 0.012], [0.105, 0.037, ZB + 0.012], 0.0095, 10));                // накатник
    dark.push(G.xf(new THREE.BoxGeometry(0.012, 0.03, 0.03), { p: [0.1, 0.025, ZB + 0.008] }));
    tilt.add(new THREE.Mesh(G.merge(dark), mat.darkSteel));

    // крышка цапфы
    tilt.add(new THREE.Mesh(G.merge([
      G.xf(G.lathe([[0.025, 0], [0.025, 0.006], [0.021, 0.0095], [0.013, 0.0095], [0, 0.0095]], 20), { p: [0, 0, ZB + 0.03] }),
      G.xf(G.hexGeometry(0.011, 0.007), { p: [0, 0, ZB + 0.039] }),
    ]), mat.nickel));

    // стрелка: тонкое перо у самой шкалы, выходит из-под дульного среза
    const s = new THREE.Shape();
    s.moveTo(0.12, -0.0042); s.lineTo(0.33, -0.0034); s.lineTo(R_TICK - 0.0015, 0); s.lineTo(0.33, 0.0034); s.lineTo(0.12, 0.0042); s.closePath();
    const needle = new THREE.Mesh(G.extrude(s, 0.0025, 0.0006), mat.bakelite);
    needle.position.z = 0.0105;
    tilt.add(needle);
  }
  // ведущая шестерня дуги (вращается вместе с подъёмом)
  const pinion = new THREE.Group();
  {
    const pts = [], pitch = TAU / PIN_N, rr = 0.013, rt = 0.0245;
    for (let i = 0; i < PIN_N; i++) {
      const c = i * pitch;
      for (const [r, o] of [[rr, -0.5], [rr, -0.3], [rt, -0.14], [rt, 0.14], [rr, 0.3]]) pts.push(new THREE.Vector2(r * Math.cos(c + o * pitch), r * Math.sin(c + o * pitch)));
    }
    const g = G.merge([
      G.extrude(new THREE.Shape(pts), 0.01, 0.001, 1, 4),
      G.lathe([[0.0105, 0.01], [0.0105, 0.015], [0.0105, 0.015], [0.006, 0.017], [0, 0.017]], 6),
    ]);
    pinion.add(new THREE.Mesh(g, mat.steel));
    const [x, y] = polar(PIN_DIST, GEAR_PHI);
    pinion.position.set(x, y, 0.0215);
  }
  quad.add(pinion);

  const title = on(ui.plate('ПОДЪЁМ', { size: 0.036, style: 'black' }), -0.17, 0.312);
  on(ui.plate('ПРИ ОТКРЫТОМ ЗАТВОРЕ\nВЫШЕ 3° НЕ ПОДНИМАТЬ', { style: 'red', size: 0.019, screws: false }), 0.105, -0.1);

  const lampLoad = on(ui.lamp({ color: 'green', label: 'УГОЛ\nЗАРЯЖАНИЯ' }), -0.17, -0.212);
  const bDrive = on(ui.pushButton({ radius: 0.04, color: 'ochre', label: 'НА УГОЛ\nЗАРЯЖАНИЯ' }), 0.1, -0.212);

  // ------------------------------------------------------------------ приборная доска (справа)
  const BX = 0.535;
  on(painted(G.slab(0.55, 0.7, 0.014, { r: 0.022, bevel: 0.004, segs: 2 }), PAL.panelDark, 0.5), BX, -0.005);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) nickelParts.push(G.xf(G.hexGeometry(0.0085, 0.005), { p: [BX + sx * 0.25, -0.005 + sy * 0.325, 0.014] }));
  const ZI = 0.014;
  const cElev = on(ui.drumCounter({ digits: 4, decimals: 2, unit: '°', signed: true, digitH: 0.07, label: 'УГОЛ СТВОЛА', labelSize: 0.026 }), BX, 0.2, ZI);
  const cTarget = on(ui.drumCounter({ digits: 4, decimals: 2, unit: '°', digitH: 0.05, label: 'ЗАДАНО' }), 0.415, 0.028, ZI);
  // шторка репитера: закрывает окно, пока расчёта нет
  const shutter = ui.plate('— —', { w: cTarget.w - 0.02, h: 0.05, size: 0.018, screws: false });
  shutter.object3D.position.set(0, 0, 0.0097);
  cTarget.object3D.add(shutter.object3D);
  const lampStale = on(ui.lamp({ color: 'amber', label: 'РАСЧЁТ\nУСТАРЕЛ' }), 0.69, 0.075, ZI);
  // «РАССОГЛАСОВАНИЕ» — нуль-индикатор собственной постройки: веерная шкала ±2° с растянутой серединой
  // (отклонение стрелки ∝ √|Δ|), чтобы допуск ±0,02° был виден глазом; жирная стрелка читается на телефоне.
  const MX = 0.432, MY = -0.178, M_W = 0.27, M_H = 0.15, M_PIV = -0.055, M_SWEEP = 55, M_PARK = -59;
  const errAngle = e => Math.sign(e) * Math.sqrt(Math.min(Math.abs(e), ERR_SPAN) / ERR_SPAN) * M_SWEEP;
  const meter = new THREE.Group();
  meter.name = 'errorMeter';
  const errNeedle = new THREE.Group();
  {
    nickelParts.push(G.xf(G.slab(M_W + 0.026, M_H + 0.026, 0.016, { r: 0.014, bevel: 0.004, segs: 2, hole: G.roundedRectShape(M_W, M_H, 0.007) }), { p: [MX, MY, ZI] }));
    const S = 512, k = S / M_W, HPX = Math.round(M_H * k), cv = T.makeCanvas(S, HPX), c2 = cv.getContext('2d');
    const cx = S / 2, cy = HPX / 2 - M_PIV * k;                 // ось стрелки на холсте
    const pt = (r, deg) => [cx + r * k * Math.sin(deg * DEG), cy - r * k * Math.cos(deg * DEG)];
    const arc = (r, a0, a1, w, color) => { c2.strokeStyle = color; c2.lineWidth = w; c2.beginPath(); c2.arc(cx, cy, r * k, (a0 - 90) * DEG, (a1 - 90) * DEG); c2.stroke(); };
    c2.fillStyle = PAL.ivory; c2.fillRect(0, 0, S, HPX);
    const sh = c2.createLinearGradient(0, 0, 0, HPX);
    sh.addColorStop(0, 'rgba(90,70,30,0.30)'); sh.addColorStop(0.16, 'rgba(120,100,60,0)'); sh.addColorStop(0.9, 'rgba(120,100,60,0)'); sh.addColorStop(1, 'rgba(90,70,30,0.2)');
    c2.fillStyle = sh; c2.fillRect(0, 0, S, HPX);
    c2.lineCap = 'butt';
    arc(0.0945, -errAngle(ALIGN_TOL / 100), errAngle(ALIGN_TOL / 100), 0.013 * k, GREEN_ZONE);        // зона «СОВМЕЩЕНО»
    arc(0.0945, -M_SWEEP - 3.2, -M_SWEEP, 0.013 * k, PAL.redZone);
    arc(0.0945, M_SWEEP, M_SWEEP + 3.2, 0.013 * k, PAL.redZone);
    arc(0.088, -M_SWEEP, M_SWEEP, 3, PAL.ink);
    const marks = [[0, 2, '0'], [0.02, 0], [0.05, 0], [0.1, 2, '0,1'], [0.2, 0], [0.3, 0], [0.4, 0], [0.5, 2, '0,5'], [0.75, 0], [1, 2, '1'], [1.25, 0], [1.5, 1], [1.75, 0], [2, 2, '2']];
    for (const [v, rank, text] of marks) for (const sgn of v ? [-1, 1] : [1]) {
      const a = sgn * errAngle(v), [x1, y1] = pt(0.088, a), [x2, y2] = pt(rank === 2 ? 0.102 : rank ? 0.098 : 0.095, a);
      c2.strokeStyle = PAL.ink; c2.lineWidth = rank === 2 ? 5 : rank ? 3.5 : 2.5;
      c2.beginPath(); c2.moveTo(x1, y1); c2.lineTo(x2, y2); c2.stroke();
      if (text) { const [nx, ny] = pt(0.1145, a * 1.03); T.drawLabel(c2, text, nx, ny, 0.0165 * k, { color: PAL.ink, weight: 600, spacing: 0 }); }
    }
    T.drawLabel(c2, 'НИЖЕ', cx - 0.094 * k, cy - 0.006 * k, 0.0145 * k, { color: PAL.ink, weight: 600 });
    T.drawLabel(c2, 'ВЫШЕ', cx + 0.094 * k, cy - 0.006 * k, 0.0145 * k, { color: PAL.ink, weight: 600 });
    T.drawLabel(c2, 'ГРАД', cx, cy - 0.045 * k, 0.011 * k, { color: '#5a5142', weight: 600 });
    const dial = new THREE.Mesh(new THREE.PlaneGeometry(M_W + 0.004, M_H + 0.004), new THREE.MeshStandardMaterial({ map: T.canvasTexture(cv, { aniso: 8 }), roughness: 0.62, metalness: 0 }));
    dial.position.z = 0.003;
    meter.add(dial);
    const ns = new THREE.Shape();
    ns.moveTo(-0.0042, -0.014); ns.lineTo(0.0042, -0.014); ns.lineTo(0.0036, 0); ns.lineTo(0.0013, 0.099); ns.lineTo(-0.0013, 0.099); ns.lineTo(-0.0036, 0); ns.closePath();
    errNeedle.add(new THREE.Mesh(G.merge([
      G.extrude(ns, 0.002, 0.0004),
      G.lathe([[0.0125, -0.002], [0.0125, 0.003], [0.0125, 0.003], [0.009, 0.0048], [0, 0.0048]], 16),
    ]), mat.bakelite));
    errNeedle.position.set(0, M_PIV, 0.0075);
    errNeedle.rotation.z = -M_PARK * DEG;
    meter.add(errNeedle);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(M_W, M_H), mat.glass);
    glass.position.z = 0.0145; glass.renderOrder = 3;
    meter.add(glass);
  }
  on(meter, MX, MY, ZI);
  on(ui.plate('РАССОГЛАСОВАНИЕ', { size: 0.022, screws: false }), MX, MY - M_H / 2 - 0.013 - 0.008 - 0.019, ZI);
  let errValue = -ERR_SPAN, errShown = M_PARK;         // показание (°) и текущий угол стрелки
  const gError = { object3D: meter, get value() { return errValue; }, get angle() { return errShown; } };
  const lampAligned = on(ui.lamp({ color: 'green', radius: 0.026, label: 'СОВМЕЩЕНО' }), 0.7, -0.16, ZI);

  // ------------------------------------------------------------------ декор вне панели
  {
    // трубопроводы и кабельные трубы вдоль боков пульта, уходят к стене
    copperParts.push(G.pipeGeometry([[-0.868, 0.74, -0.095], [-0.868, 1.86, -0.095], [-0.868, 1.98, -0.3], [-0.868, 1.98, -0.92]], 0.022));
    copperParts.push(G.pipeGeometry([[-0.6, 1.62, -0.25], [-0.6, 2.2, -0.25], [-0.6, 2.3, -0.5], [-0.6, 2.3, -0.92]], 0.018));
    steelParts.push(G.pipeGeometry([[0.87, 0.74, -0.1], [0.87, 1.8, -0.1], [0.87, 1.92, -0.3], [0.87, 1.92, -0.92]], 0.014));
    steelParts.push(G.pipeGeometry([[0.842, 0.74, -0.1], [0.842, 1.72, -0.1], [0.842, 1.84, -0.3], [0.842, 1.84, -0.92]], 0.009));
    for (const y of [0.86, 1.3, 1.7]) {              // хомуты
      steelParts.push(G.xf(G.slab(0.075, 0.03, 0.012, { r: 0.004, bevel: 0.002 }), { p: [-0.868, y, -0.074] }));
      steelParts.push(G.xf(G.slab(0.075, 0.026, 0.01, { r: 0.004, bevel: 0.002 }), { p: [0.857, y, -0.088] }));
    }
    // труба вала вертикальной наводки над пультом, опоры, распределительная коробка
    darkParts.push(G.xf(G.lathe([[0, -0.72], [0.1, -0.72], [0.1, -0.66], [0.082, -0.66], [0.082, 0.66], [0.1, 0.66], [0.1, 0.72], [0, 0.72]], 20), { r: [0, Math.PI / 2, 0], p: [0, 1.72, -0.36] }));
    for (const x of [-0.5, 0.5]) darkParts.push(G.xf(G.slab(0.12, 0.2, 0.2, { r: 0.01, bevel: 0.004 }), { p: [x, 1.64, -0.46] }));
    darkParts.push(G.xf(G.slab(0.3, 0.22, 0.12, { r: 0.012, bevel: 0.004 }), { p: [0.42, 1.98, -0.94] }));
    steelParts.push(G.pipeGeometry([[0.42, 1.87, -0.86], [0.42, 1.78, -0.86], [0.42, 1.72, -0.5]], 0.012));
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; for (const x of [-0.72, 0.72]) steelParts.push(G.xf(G.hexGeometry(0.01, 0.008), { r: [0, Math.sign(x) * Math.PI / 2, 0], p: [x, 1.72 + Math.sin(a) * 0.065, -0.36 + Math.cos(a) * 0.065] })); }
  }
  // статичные детали в координатах панели → в face; в координатах поста → в group
  const faceSteel = [], faceDark = [], faceNickel = [];
  const split = (list, toFace, toGroup) => list.forEach(g => {
    g.computeBoundingBox();
    (g.boundingBox.max.y < 0.45 && g.boundingBox.min.y > -0.45 && g.boundingBox.max.z < 0.2 && g.boundingBox.min.z > -0.02 ? toFace : toGroup).push(g);
  });
  const grpSteel = [], grpDark = [];
  split(steelParts, faceSteel, grpSteel); split(darkParts, faceDark, grpDark); split(nickelParts, faceNickel, faceNickel);
  if (faceSteel.length) face.add(new THREE.Mesh(G.merge(faceSteel), mat.steel));
  if (faceDark.length) face.add(new THREE.Mesh(G.merge(faceDark), mat.darkSteel));
  if (faceNickel.length) face.add(new THREE.Mesh(G.merge(faceNickel), mat.nickel));
  if (grpSteel.length) group.add(new THREE.Mesh(G.merge(grpSteel), mat.steel));
  if (grpDark.length) group.add(new THREE.Mesh(G.merge(grpDark), mat.darkSteel));
  group.add(new THREE.Mesh(G.merge(copperParts), mat.copper));

  // ------------------------------------------------------------------ состояние отображения
  let shown = null;                    // плавное значение угла для стрелки и модели
  let bugShown = null;
  let prevEl = null;
  let driveAcc = 0, driving = false, driveHold = false, servoLevel = 0;
  const setServo = v => { if (v !== servoLevel) { servoLevel = v; audio.servo(v); } };
  const approach = (cur, target, dt, rate) => { const v = cur + (target - cur) * (1 - Math.exp(-dt * rate)); return Math.abs(v - target) < 0.004 ? target : v; };

  function powerDrive(dt) {
    // кнопка «НА УГОЛ ЗАРЯЖАНИЯ»: пока нажата, привод ведёт ствол к 0° со скоростью ~8°/с
    if (!bDrive.pressed) { driveHold = false; driveAcc = 0; return false; }
    if (driveHold || engine.current !== station.id || !live() || wheel.turning) return false;
    const s = game.state, el = s.turret.elevation;
    if (s.breech.open && el > game.C.LOAD_ANGLE + 0.004) { driveHold = true; game.elevate(-0.01); return false; }   // заперто: один отказ
    if (Math.abs(el) < 0.005) {
      if (driving) audio.clunk();                    // дошли до упора привода
      driveHold = true;                              // до следующего нажатия
      return false;
    }
    driveAcc += DRIVE_RATE * (s.speed || 1) * dt;
    const n = Math.min(Math.floor(driveAcc * 100 + 1e-6), Math.round(Math.abs(el) * 100));
    if (n > 0) {
      driveAcc -= n / 100;
      const r = game.elevate(-Math.sign(el) * n / 100);
      if (!r || !r.ok) { driveHold = true; return false; }
    }
    return true;
  }

  function update(dt) {
    const now = powerDrive(dt);
    if (now !== driving) { driving = now; bDrive.setLit(driving); }
    setServo(driving ? 0.7 : 0);

    const s = game.state || {};
    const el = s.turret && isFinite(s.turret.elevation) ? s.turret.elevation : 0;
    const cp = s.computer;
    const tgt = cp && cp.elevation != null && isFinite(cp.elevation) ? cp.elevation : null;
    const first = shown === null;

    // маховик кинематически связан со стволом: привод (или новое задание) проворачивает и его
    if (prevEl !== null && el !== prevEl && !wheel.turning) {
      const d = Math.max(-2, Math.min(2, el - prevEl));
      wheel.spin(d / COARSE * TAU);
    }
    prevEl = el;

    shown = first ? el : approach(shown, el, dt, 20);
    tilt.rotation.z = shown * DEG;
    pinion.rotation.z = (GEAR_PHI + 180) * DEG - shown * DEG * (ARC_ROOT + ARC_TIP) / 2 / (PIN_DIST - (ARC_ROOT + ARC_TIP) / 2);

    cElev.setValue(el, first ? { instant: true } : undefined);
    if (tgt !== null) {
      cTarget.setValue(tgt, bugShown === null ? { instant: true } : undefined);
      bugShown = bugShown === null ? tgt : approach(bugShown, tgt, dt, 12);
      bug.rotation.z = bugShown * DEG;
    } else bugShown = null;
    bug.visible = tgt !== null;
    shutter.object3D.visible = tgt === null;
    lampStale.set(cp && cp.stale ? 'blink' : false);

    const err = tgt === null ? null : Math.round((el - tgt) * 100);          // сотые градуса
    errValue = err === null ? -ERR_SPAN : Math.max(-ERR_SPAN, Math.min(ERR_SPAN, err / 100));
    const errTo = err === null ? M_PARK : errAngle(errValue);
    errShown = first ? errTo : Math.abs(errTo - errShown) < 0.05 ? errTo : errShown + (errTo - errShown) * (1 - Math.exp(-dt * 12));
    errNeedle.rotation.z = -errShown * DEG;
    lampAligned.set(err !== null && Math.abs(err) <= ALIGN_TOL);
    lampLoad.set(el <= game.C.LOAD_ANGLE + 1e-9);
    lockBar.visible = !!(s.breech && s.breech.open);
  }

  const station = {
    id: 'elevation', title: 'ПОДЪЁМ', group,
    camera: { position: [0, 1.44, 1.24], target: [0, 1.09, 0], fov: 43.5 },
    update,
    onEnter() { acc = 0; upBlocked = false; driveHold = bDrive.pressed; },
    onLeave() { acc = 0; driveHold = true; if (driving) { driving = false; bDrive.setLit(false); } setServo(0); audio.servo(0); },
    /** Интерактивные органы (ключи стабильны): маховик, тумблер передачи (и его подписи), кнопка привода. */
    hotspots: {
      elevWheel: wheel.object3D,
      gearToggle: tGear.object3D,
      gearCoarse, gearFine,
      loadAngleButton: bDrive.object3D,
    },
    /** Приборы (для подсветки в обучении). */
    indicators: {
      elevCounter: cElev.object3D, targetCounter: cTarget.object3D, sector: quad, errorGauge: gError.object3D,
      alignedLamp: lampAligned.object3D, loadLamp: lampLoad.object3D, staleLamp: lampStale.object3D, title: title.object3D,
    },
    /** Органы и приборы целиком — для стендов и тестов. */
    controls: { wheel, tGear, bDrive, cElev, cTarget, gError, lampAligned, lampLoad, lampStale, shutter, bug, lockBar, tilt, pinion, get fine() { return fine; } },
  };
  return station;

  // ------------------------------------------------------------------ помощники
  /** Надпись по дуге. mid — угол середины (рад, по часовой от «12 часов»); bottom — читается снизу (буквы «ногами наружу»). */
  function arcText(c2, text, cx, cy, r, mid, capPx, bottom) {
    const chars = Array.from(T.upper(text));
    const widths = chars.map(ch => ch === ' ' ? capPx * 0.42 : T.measureLabel(ch, capPx, { spacing: 0 }).width);
    const gap = capPx * 0.15, dir = bottom ? -1 : 1;
    const total = widths.reduce((a, b) => a + b, 0) + gap * (chars.length - 1);
    const rr = bottom ? r + capPx * 0.02 : r - capPx * 0.02;
    let a = mid - dir * total / 2 / rr;
    chars.forEach((ch, i) => {
      const ac = a + dir * widths[i] / 2 / rr;
      if (ch !== ' ') {
        c2.save();
        c2.translate(cx + Math.sin(ac) * rr, cy - Math.cos(ac) * rr);
        c2.rotate(ac + (bottom ? Math.PI : 0));
        T.drawLabel(c2, ch, 0, 0, capPx, { color: PAL.ivory, weight: 600, spacing: 0 });
        c2.restore();
      }
      a += dir * (widths[i] + gap) / rr;
    });
  }
}
