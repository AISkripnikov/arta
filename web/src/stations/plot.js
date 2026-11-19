// Пост «ПЛАНШЕТ» (plot) — стол прокладки (DESIGN §7.1).
// Наклонный стол: посередине планшет с картой района 20×20 км, алидадой и фишками целей; на ближней кромке —
// рейка точной подвижки фишки (счётчики X, Y и четыре кнопки-стрелки); по углам — маховики «ПЕЛЕНГ» и «ДАЛЬНОСТЬ»
// со счётчиками над ними. Пост ничего не решает сам: каждый кадр перечитывает game.state и вызывает
// game.setPin / selectTarget / setAlidade / recordMeasurement.
import { createOverlay } from './plot-overlay.js';
import { createPhotos } from './plot-photos.js';
import { CHART, drawChart, drawPinAtlas, drawPinColumn, PIN_COLS, PIN_ROWS, drawLeadAtlas, drawRulerScale, drawTag } from './plot-chart.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const norm360 = (d) => ((d % 360) + 360) % 360;

// ---- компоновка (м, локальные координаты поста) ----
const TILT = 28 * DEG;                                   // наклон стола от горизонтали
const DECK = { w: 1.78, h: 0.80, d: 0.05, cy: 0.98, cz: -0.19 };   // cy, cz — центр лицевой грани
const SHEET = 0.62;                                      // сторона листа карты (на CHART.SPAN км)
const BOARD_V = 0.055;                                   // центр листа на столе (вверх по скату)
const PLANE_Z = 0.0125;                                  // лист над лицом стола
const K = SHEET / CHART.SPAN;                            // метров на километр
const MAP = CHART.MAP;

const CAM = { fov: 50, dist: 1.165, oblique: 5 * DEG, aim: -0.04 };   // основной вид
const LOUPE = { fov: 14, spanKm: 2.6 };                  // крупный план: высота кадра в км
const TOKEN_LOUPE = 0.3;                                 // масштаб фишек/визира под лупой

const BEARING_PER_TURN = 2;                              // ° на оборот маховика
const RANGE_PER_TURN = 0.2;                              // км на оборот маховика
const ALIGN_TOL = 0.03, SNAP_TOL = 0.15, LEAD_TOL = 0.15;   // км
const RULER_KM = 25.6;                                   // длина шкалы линейки
const RULER_W = 0.036;

const TRAY = { u: -0.405, v0: 0.205, pitch: 0.095, slots: 3 };
const HANDLE = { x: -0.03, y: -0.03, r: 0.024 };         // номерной диск фишки относительно её острия
const KNOB_OFF = 0.037;                                  // ручка визира — поперёк линейки

export function createPlotStation(ctx) {
  const { engine, THREE, ui, mat, audio, game } = ctx;
  const G = engine.geom, TX = engine.textures, input = engine.input;
  const PAL = mat.PALETTE || {};
  const label = TX.drawLabel;

  const group = new THREE.Group();
  group.name = 'station:plot';
  const disposers = [];
  const keep = (c) => { disposers.push(() => c.dispose && c.dispose()); return c; };

  // базис стола в локальных координатах поста
  const N = new THREE.Vector3(0, Math.cos(TILT), Math.sin(TILT));       // нормаль
  const UP = new THREE.Vector3(0, Math.sin(TILT), -Math.cos(TILT));     // вверх по скату (север карты)
  const FACE = new THREE.Vector3(0, DECK.cy, DECK.cz);

  // ------------------------------------------------------------------ корпус
  const darkPaint = mat.paint(PAL.panelDark || '#2b343d', { wear: 0.8 });
  const deck = keep(ui.panel({ w: DECK.w, h: DECK.h, d: DECK.d, rivets: 0.1 }));
  deck.object3D.rotation.x = -(Math.PI / 2 - TILT);
  deck.object3D.position.copy(FACE).addScaledVector(N, -DECK.d);
  group.add(deck.object3D);

  {
    // тумба под столом: боковой профиль [z, y], вытянутый по X
    const near = FACE.clone().addScaledVector(UP, -DECK.h / 2 + 0.03).addScaledVector(N, -DECK.d);
    const far = FACE.clone().addScaledVector(UP, DECK.h / 2 - 0.02).addScaledVector(N, -DECK.d);
    const profile = [[near.z - 0.1, 0], [near.z - 0.1, 0.1], [near.z - 0.02, 0.16], [near.z - 0.02, near.y - 0.01], [near.z, near.y], [far.z, far.y], [far.z, 0]];
    const sh = new THREE.Shape();
    profile.forEach(([z, y], i) => (i ? sh.lineTo(z, y) : sh.moveTo(z, y)));
    sh.closePath();
    const W = 1.68;
    const g = G.extrude(sh, W, 0.006, 1, 4);
    g.rotateY(-Math.PI / 2);
    g.translate(W / 2, 0, 0);
    group.add(new THREE.Mesh(G.boxUV(g, mat.WEAR_REPEAT || 0.8), darkPaint));

    // задняя стойка со стеллажом карт, трубы и плафон — силуэт поста
    const riser = keep(ui.panel({ w: 1.78, h: 0.74, d: 0.06, color: PAL.panelDark || '#2b343d', rivets: 0.12, wear: 0.8 }));
    riser.object3D.position.set(0, far.y + 0.33, far.z - 0.1);
    group.add(riser.object3D);
    const rz = far.z - 0.04;
    const rolls = [];
    for (const [x, y, len, r] of [[-0.42, far.y + 0.3, 0.62, 0.028], [-0.38, far.y + 0.37, 0.5, 0.022], [0.44, far.y + 0.3, 0.56, 0.026]]) {
      const c = new THREE.CylinderGeometry(r, r, len, 12);
      c.rotateZ(Math.PI / 2); c.translate(x, y, rz + r + 0.012);
      rolls.push(c);
    }
    group.add(new THREE.Mesh(G.merge(rolls), mat.ivory));
    const br = [];
    for (const x of [-0.68, -0.16, 0.2, 0.68]) {
      br.push(G.xf(new THREE.BoxGeometry(0.02, 0.2, 0.075), { p: [x, far.y + 0.33, rz + 0.037] }));
    }
    br.push(G.xf(new THREE.BoxGeometry(1.5, 0.014, 0.08), { p: [0, far.y + 0.262, rz + 0.04] }));
    group.add(new THREE.Mesh(G.merge(br), mat.darkSteel));
    group.add(keep(ui.pipe([[-0.88, 1.98, -0.8], [0.88, 1.98, -0.8]], 0.03, mat.copper)).object3D);
    group.add(keep(ui.pipe([[-0.88, 2.1, -0.82], [0.3, 2.1, -0.82], [0.3, far.y + 0.6, -0.82]], 0.018, mat.steel)).object3D);
    group.add(keep(ui.cable([[0.62, far.y + 0.66, far.z - 0.07], [0.74, far.y + 0.3, far.z - 0.03], [0.8, far.y + 0.02, far.z - 0.02]], { sag: 0.03 })).object3D);
    const cage = keep(ui.cageLamp({ color: 'white', scale: 0.9 }));
    cage.object3D.position.set(0, far.y + 0.56, far.z - 0.04);
    group.add(cage.object3D);
  }

  // ------------------------------------------------------------------ органы на столе
  deck.add(keep(ui.plate('ПЛАНШЕТ', { size: 0.032, style: 'black' })), -0.69, 0.335);

  const state = () => game.state;
  const plotOf = (s) => s.plot || EMPTY_PLOT;
  const EMPTY_PLOT = { pins: {}, alidade: { bearing: 0, range: 0 }, recorded: {} };

  let accB = 0, accR = 0;
  const wheelB = deck.add(keep(ui.handwheel({
    radius: 0.16,
    onStart() { accB = 0; },
    onTurn(d) {
      accB += d / TAU * BEARING_PER_TURN;
      const n = Math.trunc(accB / 0.1 + (accB > 0 ? 1e-6 : -1e-6));
      if (!n || !state().mission) return;
      accB -= n * 0.1;
      game.setAlidade({ bearing: plotOf(state()).alidade.bearing + n * 0.1 });
    },
    onEnd() { trySnap(); },
  })), -0.71, -0.2);
  const wheelR = deck.add(keep(ui.handwheel({
    radius: 0.16,
    onStart() { accR = 0; },
    onTurn(d) {
      accR += d / TAU * RANGE_PER_TURN;
      const n = Math.trunc(accR / 0.01 + (accR > 0 ? 1e-6 : -1e-6));
      if (!n || !state().mission) return;
      accR -= n * 0.01;
      game.setAlidade({ range: clamp(plotOf(state()).alidade.range + n * 0.01, 0, 25) });
    },
    onEnd() { trySnap(); },
  })), 0.71, -0.2);

  const cBearing = deck.add(keep(ui.drumCounter({ digits: 4, decimals: 1, unit: '°', wrap: 360, label: 'ПЕЛЕНГ', digitH: 0.05 })), -0.71, 0.04);
  const cRange = deck.add(keep(ui.drumCounter({ digits: 4, decimals: 2, unit: 'КМ', label: 'ДАЛЬНОСТЬ', digitH: 0.05 })), 0.71, 0.04);

  // рейка точной подвижки фишки
  const RAIL_V = -0.325;
  const cX = deck.add(keep(ui.drumCounter({ digits: 4, decimals: 2, digitH: 0.042 })), -0.285, RAIL_V);
  const cY = deck.add(keep(ui.drumCounter({ digits: 4, decimals: 2, digitH: 0.042 })), 0.345, RAIL_V);
  deck.add(keep(ui.plate('X', { size: 0.03, screws: false })), -0.385, RAIL_V);
  deck.add(keep(ui.plate('Y', { size: 0.03, screws: false })), 0.245, RAIL_V);

  function nudge(dx, dy) {
    const s = state(), id = s.activeTarget, pin = id != null ? plotOf(s).pins[id] : null;
    const t = id != null ? targetById(id) : null;
    if (!pin || !t || !t.alive || t.escaped) return;       // фишка ещё в лотке или цель выбыла — нечего двигать
    movePin(id, pin.x + dx, pin.y + dy);
  }
  function arrowButton(u, dir, dx, dy) {
    const b = deck.add(keep(ui.pushButton({ radius: 0.03, color: 'black', labelPos: 'none', hold: true, onPress: () => nudge(dx, dy) })), u, RAIL_V);
    const r = 0.03, sh = new THREE.Shape();
    sh.moveTo(r * 0.55, 0); sh.lineTo(-r * 0.35, r * 0.5); sh.lineTo(-r * 0.35, -r * 0.5); sh.closePath();
    const tri = new THREE.Mesh(new THREE.ShapeGeometry(sh), mat.ivory);
    tri.rotation.z = dir * DEG;
    tri.position.z = r * 0.79;
    const cap = b.object3D.children.find((o) => o.isMesh && o.material === mat.bakelite);
    (cap || b.object3D).add(tri);
    disposers.push(() => tri.geometry.dispose());
    return b;
  }
  const btnXm = arrowButton(-0.47, 180, -0.01, 0);
  const btnXp = arrowButton(-0.155, 0, 0.01, 0);
  const btnYm = arrowButton(0.155, -90, 0, -0.01);
  const btnYp = arrowButton(0.47, 90, 0, 0.01);

  const lampNew = deck.add(keep(ui.lamp({ color: 'amber', label: 'НОВОЕ ДОНЕСЕНИЕ', labelSize: 0.023 })), -0.69, 0.25);
  const lampAligned = deck.add(keep(ui.lamp({ color: 'green', label: 'СОВМЕЩЕНО' })), 0.455, 0.305);
  const btnRecord = deck.add(keep(ui.pushButton({
    radius: 0.034, color: 'ochre', label: 'ЗАПИСАТЬ',
    onPress() { const r = game.recordMeasurement(); if (r && r.ok) audio.clunk(); },
  })), 0.63, 0.305);
  const lampRecorded = deck.add(keep(ui.lamp({ color: 'green', label: 'ЗАПИСАНО' })), 0.795, 0.305);
  const btnLoupe = deck.add(keep(ui.pushButton({
    radius: 0.032, color: 'black', label: 'ЛУПА',
    onPress() { setLoupe(!loupe); },
  })), 0.455, 0.1);
  // карандаш: провести линию вдоль алидады (засечка по пеленгам) и стереть все линии
  const btnLine = deck.add(keep(ui.pushButton({
    radius: 0.03, color: 'ochre', label: 'ЛИНИЯ',
    onPress() { if (state().mission) { const r = game.drawLine(); if (r && r.ok) audio.paper(); } },
  })), 0.455, -0.075);
  const btnErase = deck.add(keep(ui.pushButton({
    radius: 0.024, color: 'black', label: 'СТЕРЕТЬ',
    onPress() { if (state().mission) { game.clearLines(); audio.paper(); } },
  })), 0.455, -0.215);

  // лоток фишек
  let trayObj;
  {
    const base = new THREE.Mesh(G.slab(0.1, TRAY.pitch * TRAY.slots + 0.012, 0.007, { r: 0.012, bevel: 0.002 }), mat.darkSteel);
    const tray = new THREE.Group();
    tray.add(base);
    const pads = [];
    for (let i = 0; i < TRAY.slots; i++) {
      pads.push(G.xf(new THREE.CircleGeometry(0.034, 20), { p: [0, (1 - i) * TRAY.pitch, 0.0074] }));
    }
    tray.add(new THREE.Mesh(G.merge(pads), mat.rubber));
    deck.add(tray, TRAY.u, TRAY.v0 - TRAY.pitch);
    trayObj = tray;
    disposers.push(() => { base.geometry.dispose(); tray.children[1].geometry.dispose(); });
    deck.add(keep(ui.plate('ЦЕЛИ', { size: 0.022, screws: false })), TRAY.u, TRAY.v0 - TRAY.pitch * 2 - 0.085);
  }

  // ------------------------------------------------------------------ планшет
  const board = new THREE.Group();                       // начало — центр листа; XY — плоскость карты (м)
  board.name = 'chartBoard';
  deck.add(board, 0, BOARD_V);
  {
    const frame = new THREE.Mesh(G.slab(SHEET + 0.046, SHEET + 0.046, PLANE_Z - 0.0005, { r: 0.012, bevel: 0.004 }), mat.darkSteel);
    board.add(frame);
    disposers.push(() => frame.geometry.dispose());
  }
  const plane = new THREE.Group();                        // всё, что лежит на листе
  plane.position.z = PLANE_Z;
  board.add(plane);

  // холст карты: 2048 (на «экономном» качестве — 1024: вчетверо меньше памяти и выгрузки в GPU; рисунок тот же, масштабом)
  const chartPx = (q) => (q && q.tier === 'low' ? CHART.PX / 2 : CHART.PX);
  const chartCanvas = TX.makeCanvas(chartPx(engine.quality), chartPx(engine.quality));
  const chartTex = TX.canvasTexture(chartCanvas, { aniso: 8 });
  const chartMat = new THREE.MeshBasicMaterial({ map: chartTex, color: 0xd9d6cf });
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(SHEET, SHEET), chartMat);
  plane.add(sheet);
  // слой поверх карты: полёт снаряда, разрывы, звукометрия
  const overlay = createOverlay({ THREE, TX, size: SHEET });
  overlay.mesh.position.z = 0.0003;
  plane.add(overlay.mesh);
  disposers.push(() => overlay.dispose());
  let chartMission;                                       // для какого задания нарисована карта
  function redrawChart(mission) {
    chartMission = mission;
    drawChart(chartCanvas, mission || null, label);
    chartTex.needsUpdate = true;
  }
  disposers.push(engine.on('quality', (q) => {
    const px = chartPx(q);
    if (chartCanvas.width === px) return;
    chartCanvas.width = chartCanvas.height = px;
    chartTex.dispose();                                   // размер изменился — текстуру в GPU создать заново
    redrawChart(chartMission);
  }));

  const kmU = (x) => (x - CHART.X0) * K - SHEET / 2;
  const kmV = (y) => (y - CHART.Y0) * K - SHEET / 2;
  const uKm = (u) => (u + SHEET / 2) / K + CHART.X0;
  const vKm = (v) => (v + SHEET / 2) / K + CHART.Y0;

  // аэрофотоснимки районов разрывов — под слоем трасс и кругов
  const photos = createPhotos({ THREE, TX, K, kmU, kmV, game });
  photos.group.position.z = 0;
  plane.add(photos.group);
  disposers.push(() => photos.dispose());

  // --- алидада ---
  const alidade = new THREE.Group();
  alidade.position.z = 0.0012;
  plane.add(alidade);
  const rulerCanvas = TX.makeCanvas(2048, 96);
  drawRulerScale(rulerCanvas, RULER_KM, label);
  const rulerTex = TX.canvasTexture(rulerCanvas, { aniso: 8 });
  rulerTex.wrapS = THREE.ClampToEdgeWrapping;
  const rulerGeo = new THREE.PlaneGeometry(1, 1);
  rulerGeo.translate(0.5, 0, 0);
  const ruler = new THREE.Mesh(rulerGeo, new THREE.MeshBasicMaterial({ map: rulerTex, transparent: true, depthWrite: false }));
  ruler.renderOrder = 2;
  alidade.add(ruler);
  const pivot = new THREE.Mesh(G.lathe([[0.011, 0], [0.011, 0.003], [0.007, 0.006], [0.0025, 0.006], [0.0025, 0.0035], [0, 0.0035]], 16), mat.nickel);
  alidade.add(pivot);

  const sight = new THREE.Group();
  sight.name = 'sight';
  alidade.add(sight);
  {
    const ring = G.lathe([[0.0175, 0], [0.0175, 0.004], [0.0135, 0.004], [0.0135, 0]], 28);
    const bridge = G.xf(new THREE.BoxGeometry(0.008, KNOB_OFF - 0.02, 0.003), { p: [0, -(KNOB_OFF + 0.014) / 2, 0.0015] });
    sight.add(new THREE.Mesh(G.merge([ring, bridge]), mat.nickel));
    const hairs = [];
    for (let k = 0; k < 4; k++) {
      hairs.push(G.xf(new THREE.BoxGeometry(0.0095, 0.0011, 0.0008), { p: [0.0088, 0, 0.002], r: [0, 0, 0] }).rotateZ(k * Math.PI / 2));
    }
    hairs.push(G.xf(new THREE.CircleGeometry(0.0009, 10), { p: [0, 0, 0.002] }));
    sight.add(new THREE.Mesh(G.merge(hairs), mat.bakelite));
    const knob = G.lathe([[0.0115, 0], [0.0115, 0.011], [0.0095, 0.013], [0, 0.013]], 14);
    knob.translate(0, -KNOB_OFF, 0);
    sight.add(new THREE.Mesh(knob, mat.ochre));
  }
  const jewelOff = mat.lens('green', false), jewelOn = mat.lens('green', true);
  const jewel = new THREE.Mesh(new THREE.SphereGeometry(0.0042, 10, 6), jewelOff);
  jewel.scale.z = 0.6;
  jewel.position.set(0, -0.0225, 0.004);
  sight.add(jewel);

  // --- фишки целей ---
  const atlasCanvas = TX.makeCanvas(8, 8);
  drawPinAtlas(atlasCanvas, label);
  const atlasTex = TX.canvasTexture(atlasCanvas, { aniso: 4 });
  const atlasMat = new THREE.MeshBasicMaterial({ map: atlasTex });
  const pinBodyMats = [mat.bakelite, mat.ochre, mat.steel, mat.steel];
  const pinBodyGeo = (() => {
    const ring = G.xf(new THREE.RingGeometry(0.0082, 0.0112, 24), { p: [0, 0, 0.0012] });
    const dot = G.xf(new THREE.CircleGeometry(0.0017, 10), { p: [0, 0, 0.0012] });
    const len = Math.hypot(HANDLE.x, HANDLE.y) - 0.0112 - HANDLE.r + 0.004;
    const mid = (0.0112 + len / 2 - 0.002) / Math.hypot(HANDLE.x, HANDLE.y);
    const stem = G.xf(new THREE.BoxGeometry(len, 0.0045, 0.002), { r: [0, 0, Math.atan2(HANDLE.y, HANDLE.x)], p: [HANDLE.x * mid, HANDLE.y * mid, 0.001] });
    const disc = new THREE.CylinderGeometry(HANDLE.r, HANDLE.r * 1.04, 0.006, 24, 1, true);
    disc.rotateX(Math.PI / 2); disc.translate(HANDLE.x, HANDLE.y, 0.003);
    return G.merge([ring, dot, stem, disc]);
  })();
  const pins = {};                                         // id → { g, body, cap, row }
  const colLabel = [];                                     // какой номер сейчас нарисован в столбце атласа
  for (let c = 0; c < PIN_COLS; c++) colLabel[c] = c + 1;
  /** Цель показывается фишкой: есть донесение или (ночью) хотя бы квадрат поиска. */
  const known = (t) => !!(t && (t.reported || t.area));
  function makePin(id) {
    const g = new THREE.Group();
    g.name = 'pin' + id;
    const body = new THREE.Mesh(pinBodyGeo, pinBodyMats[0]);
    const capGeo = new THREE.CircleGeometry(HANDLE.r, 24);
    capGeo.translate(HANDLE.x, HANDLE.y, 0.0061);
    const cap = new THREE.Mesh(capGeo, atlasMat);
    g.add(body, cap);
    g.visible = false;
    plane.add(g);
    const pin = { id, g, body, cap, capGeo, row: -1 };
    pins[id] = pin;
    // номера целей растут без конца (оборона): столбец атласа перерисовывается под нужный номер
    const col = (id - 1) % PIN_COLS;
    if (colLabel[col] !== id) { colLabel[col] = id; drawPinColumn(atlasCanvas, label, col, String(id)); atlasTex.needsUpdate = true; }
    hotspots['pin' + id] = g;
    return pin;
  }
  function setPinRow(pin, row) {
    if (pin.row === row) return;
    pin.row = row;
    pin.body.material = pinBodyMats[row];
    const uv = pin.cap.geometry.attributes.uv, pos = pin.cap.geometry.attributes.position;
    const col = (pin.id - 1) % PIN_COLS;
    for (let i = 0; i < uv.count; i++) {
      const a = ((pos.getX(i) - HANDLE.x) / HANDLE.r * 0.94 + 1) / 2, b = ((pos.getY(i) - HANDLE.y) / HANDLE.r * 0.94 + 1) / 2;
      uv.setXY(i, (col + a) / PIN_COLS, (PIN_ROWS - 1 - row + b) / PIN_ROWS);
    }
    uv.needsUpdate = true;
  }

  // --- отметки упреждения (только «Курсант») ---
  const leadMat = new THREE.MeshBasicMaterial({ color: 0x9c2418 });
  const leadGeo = new THREE.BufferGeometry();
  const leadPos = new Float32Array(6 * 4 * 3);
  {
    const idx = [];
    for (let q = 0; q < 6; q++) idx.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
    leadGeo.setAttribute('position', new THREE.BufferAttribute(leadPos, 3));
    leadGeo.setIndex(idx);
  }
  const leadMesh = new THREE.Mesh(leadGeo, leadMat);
  leadMesh.position.z = 0.0005; leadMesh.frustumCulled = false; leadMesh.visible = false;
  plane.add(leadMesh);
  const leadCanvas = TX.makeCanvas(8, 8);
  drawLeadAtlas(leadCanvas, label);
  const leadTex = TX.canvasTexture(leadCanvas, { aniso: 4 });
  const leadLabGeo = new THREE.BufferGeometry();
  const leadLabPos = new Float32Array(5 * 4 * 3);
  {
    const idx = [], uv = [];
    for (let q = 0; q < 5; q++) {
      idx.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
      uv.push(q / 5, 0, (q + 1) / 5, 0, (q + 1) / 5, 1, q / 5, 1);
    }
    leadLabGeo.setAttribute('position', new THREE.BufferAttribute(leadLabPos, 3));
    leadLabGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    leadLabGeo.setIndex(idx);
  }
  const leadLabels = new THREE.Mesh(leadLabGeo, new THREE.MeshBasicMaterial({ map: leadTex, transparent: true, depthWrite: false }));
  leadLabels.position.z = 0.0008; leadLabels.frustumCulled = false; leadLabels.visible = false; leadLabels.renderOrder = 1;
  plane.add(leadLabels);
  function quad(arr, q, ax, ay, bx, by, hw) {            // отрезок a→b шириной 2·hw
    const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1, nx = -dy / l * hw, ny = dx / l * hw, o = q * 12;
    arr[o] = ax - nx; arr[o + 1] = ay - ny; arr[o + 3] = bx - nx; arr[o + 4] = by - ny;
    arr[o + 6] = bx + nx; arr[o + 7] = by + ny; arr[o + 9] = ax + nx; arr[o + 10] = ay + ny;
  }

  // --- бирки с отсчётами и кнопка возврата (видны под лупой) ---
  function makeTag() {
    const canvas = TX.makeCanvas(320, 60);
    const tex = TX.canvasTexture(canvas, { aniso: 2 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.5 * K, 1.5 * K * 60 / 320), new THREE.MeshBasicMaterial({ map: tex }));
    mesh.position.z = 0.0034; mesh.visible = false;
    plane.add(mesh);
    disposers.push(() => { tex.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); });
    return { canvas, tex, mesh, text: '' };
  }
  const tagPin = makeTag(), tagSight = makeTag();
  function setTag(tag, a, b) {
    const key = a + '|' + b;
    if (tag.text === key) return;
    tag.text = key;
    drawTag(tag.canvas, a, b, label);
    tag.tex.needsUpdate = true;
  }
  const backPlate = keep(ui.plate('ОБЗОР', { size: 0.026, style: 'ochre', screws: false }));
  backPlate.object3D.scale.setScalar(1.05 * K / backPlate.w);
  backPlate.object3D.position.z = 0.004;
  backPlate.object3D.visible = false;
  plane.add(backPlate.object3D);
  disposers.push(input.add(backPlate.object3D, { onTap() { if (loupe) { audio.loupe(); setLoupe(false); } } }, { priority: 2 }));
  // карту под лупой отвели пальцем — плашка возвращает кадр к фишке активной цели / визиру (как при включении лупы)
  const sightPlate = keep(ui.plate('К ВИЗИРУ', { size: 0.026, style: 'ochre', screws: false }));
  sightPlate.object3D.scale.setScalar(1.05 * K / backPlate.w);
  sightPlate.object3D.position.z = 0.004;
  sightPlate.object3D.visible = false;
  plane.add(sightPlate.object3D);
  disposers.push(input.add(sightPlate.object3D, { onTap() { if (loupe) { audio.loupe(); recentre(); } } }, { priority: 2 }));

  // ------------------------------------------------------------------ вспомогательное
  const hotspots = {};
  const targetById = (id) => { const ts = state().targets || []; for (let i = 0; i < ts.length; i++) if (ts[i].id === id) return ts[i]; return null; };
  /** Ось алидады: батарея или пост звукометрии (переставляется касанием знака на карте). */
  const battery = () => {
    const s = state(), m = s.mission;
    if (!m) return null;
    const P = game.pivots ? game.pivots() : [];
    return P[(s.plot && s.plot.pivot) || 0] || m.battery || (m.map && m.map.battery) || null;
  };
  const isDead = (t) => !t.alive || t.escaped;
  /** Поражённая цель ещё на плаву (догорает): остаётся в state.targets с alive = false, пока не станет sunk. */
  const isSinking = (t) => !t.alive && !t.escaped && !!t.sinking && !t.sunk;
  // события, которых нет в состоянии: вспышка попадания по своему и предупреждение о налёте (за 10 с до него)
  const fx = { friendHit: {}, raidWarn: null, view: null };
  disposers.push(game.on('friend', (e) => { if (e && e.hit) fx.friendHit[e.id] = state().time; }));
  disposers.push(game.on('raid', (e) => {
    if (!e) return;
    if (e.phase === 'warning') fx.raidWarn = { from: e.from || 0, until: state().time + (e.eta || 10) + 0.5 };
    else fx.raidWarn = null;
  }));

  let loupe = false, zoom = 0;                             // zoom: 0 — основной вид … 1 — лупа
  const loupeC = { u: 0, v: 0 };
  let tagHold = 0;
  // лупа отведена пальцем: кадр больше не подводится к фишке/визиру сам; fling — скорость «по инерции», м/с листа
  let panned = false;
  const fling = { u: 0, v: 0 };
  const FLING = { decay: 4, min: 0.04 * K, max: 10 * K, window: 100, still: 80 };
  let pinMoved = {};                                       // id → { time, x, y } — донесение, по которому ставили фишку
  let plotRef = null;
  let drag = null, lastTap = null;
  const tokenScale = () => lerp(1, TOKEN_LOUPE, zoom);

  /** Точка листа (u, v, м) → локальные координаты поста. */
  function boardToLocal(u, v, z = 0, out = new THREE.Vector3()) {
    return out.copy(FACE).addScaledVector(UP, BOARD_V + v).addScaledVector(N, DECK.d + PLANE_Z + z).setX(u);
  }
  const mainCamera = (() => {
    const target = FACE.clone().addScaledVector(UP, CAM.aim);
    const a = TILT + CAM.oblique;
    const position = target.clone().add(new THREE.Vector3(0, Math.cos(a), Math.sin(a)).multiplyScalar(CAM.dist));
    return { position: position.toArray(), target: target.toArray(), fov: CAM.fov };
  })();
  function loupePose() {
    const t = boardToLocal(loupeC.u, loupeC.v);
    const dist = LOUPE.spanKm * K / 2 / Math.tan(LOUPE.fov * DEG / 2);
    const a = TILT + 1.5 * DEG;                            // почти отвесно к листу
    const p = t.clone().add(new THREE.Vector3(0, Math.cos(a), Math.sin(a)).multiplyScalar(dist));
    return { position: p.toArray(), target: t.toArray(), fov: LOUPE.fov };
  }
  function centreLoupe(u, v, seconds) {
    const lim = SHEET / 2 - 0.02;
    loupeC.u = clamp(u, -lim, lim); loupeC.v = clamp(v, -lim, lim);
    backPlate.object3D.position.set(loupeC.u - 1.55 * K, loupeC.v - 0.66 * K, 0.004);
    sightPlate.object3D.position.set(loupeC.u + 1.55 * K, loupeC.v - 0.66 * K, 0.004);
    if (engine.current === 'plot') engine.setCameraPose(loupePose(), seconds);
    engine.invalidate(seconds > 0 ? seconds : 0);
  }
  /** Сдвиг кадра лупы пальцем/по инерции: без перелёта камеры; центр кадра — в пределах карты 20×20 км. → упёрлись ли в край по u, v. */
  function panLoupe(u, v) {
    const cu = clamp(u, kmU(0), kmU(MAP)), cv = clamp(v, kmV(0), kmV(MAP));
    centreLoupe(cu, cv, 0);
    return { u: cu !== u, v: cv !== v };
  }
  function recentre() {
    panned = false; fling.u = fling.v = 0;
    const f = focusPoint();
    centreLoupe(f.u, f.v, 0.4);
  }
  function focusPoint() {
    const s = state(), bat = battery(), id = s.activeTarget;
    const pin = id != null ? plotOf(s).pins[id] : null;
    if (pin) return { u: kmU(pin.x), v: kmV(pin.y) };
    if (bat) { const p = sightKm(s, bat); return { u: kmU(clamp(p.x, 0, MAP)), v: kmV(clamp(p.y, 0, MAP)) }; }
    return { u: 0, v: 0 };
  }
  function setLoupe(on, at) {
    on = !!on;
    if (on === loupe && !at) return;
    loupe = on;
    panned = false; fling.u = fling.v = 0;
    btnLoupe.setLit(on);
    if (on) { const f = at || focusPoint(); centreLoupe(f.u, f.v, 0.55); }
    else if (engine.current === 'plot') engine.setCameraPose(null, 0.5);
  }

  function sightKm(s, bat) {
    const a = plotOf(s).alidade, b = a.bearing * DEG;
    return { x: bat.x + a.range * Math.sin(b), y: bat.y + a.range * Math.cos(b) };
  }
  function movePin(id, x, y) {
    x = Math.round(clamp(x, 0, MAP) * 100) / 100; y = Math.round(clamp(y, 0, MAP) * 100) / 100;
    const s = state(), cur = plotOf(s).pins[id], t = targetById(id);
    if (!known(t) || !t.alive) return;
    if (!cur || cur.x !== x || cur.y !== y) game.setPin(id, x, y);
    pinMoved[id] = t.reported ? { time: t.reported.time, x: t.reported.x, y: t.reported.y } : { time: -1, x: null, y: null };
  }
  function setAlidadeTo(xKm, yKm) {
    const bat = battery();
    if (!bat) return;
    const dx = xKm - bat.x, dy = yKm - bat.y, range = Math.hypot(dx, dy);
    const v = { range: Math.round(range * 100) / 100 };
    if (range > 0.02) v.bearing = norm360(Math.round(Math.atan2(dx, dy) / DEG * 10) / 10);
    const a = plotOf(state()).alidade;
    if ((v.bearing == null || v.bearing === a.bearing) && v.range === a.range) return;
    game.setAlidade(v);
  }
  /** «Курсант»: визир, отпущенный рядом с фишкой активной цели, садится точно на неё. */
  function trySnap() {
    const s = state(), bat = battery(), id = s.activeTarget;
    if (s.difficulty !== 0 || !bat || id == null) return false;
    const pin = plotOf(s).pins[id];
    if (!pin) return false;
    const p = sightKm(s, bat), d = Math.hypot(p.x - pin.x, p.y - pin.y);
    if (d > SNAP_TOL) return false;
    const before = plotOf(s).alidade, b0 = before.bearing, r0 = before.range;
    setAlidadeTo(pin.x, pin.y);
    const after = plotOf(state()).alidade;
    if (after.bearing !== b0 || after.range !== r0) audio.tick();
    return true;
  }

  // ------------------------------------------------------------------ ввод на планшете
  const hit = G.hitBox(0.81, SHEET + 0.05, 0.02, -0.07, 0, 0.01);
  hit.name = 'chartHit';
  plane.add(hit);
  const _n = new THREE.Vector3(), _p = new THREE.Vector3(), _l = new THREE.Vector3();
  /** Точка касания на плоскости листа → (u, v) в метрах от центра листа. */
  function boardPoint(e) {
    group.updateWorldMatrix(true, false);
    _n.copy(N).transformDirection(group.matrixWorld);
    boardToLocal(0, 0, 0, _p).applyMatrix4(group.matrixWorld);
    const w = input.planePoint(e, _n, _p);
    if (!w) return null;
    _l.copy(w);
    group.worldToLocal(_l);
    _l.sub(FACE);
    return { u: _l.x, v: _l.dot(UP) - BOARD_V };
  }
  function pinOrigin(s, t, out) {                          // где сейчас остриё фишки (u, v) и её масштаб
    const placed = plotOf(s).pins[t.id];
    if (drag && drag.kind === 'pin' && drag.id === t.id && drag.free) { out.u = drag.free.u; out.v = drag.free.v; out.s = 1; out.tray = false; }
    else if (placed) { out.u = kmU(placed.x); out.v = kmV(placed.y); out.s = tokenScale(); out.tray = false; }
    else {
      const slot = (t.id - 1) % TRAY.slots, extra = (Math.floor((t.id - 1) / TRAY.slots) % 2) * 0.012;
      out.u = TRAY.u + extra - HANDLE.x; out.v = TRAY.v0 - BOARD_V - slot * TRAY.pitch - HANDLE.y; out.s = 1; out.tray = true;
    }
    return out;
  }
  const _o = { u: 0, v: 0, s: 1, tray: false };
  function pick(p) {
    const s = state(), bat = battery();
    const grab = lerp(0.046, 0.0135, zoom);
    let best = null, bd = grab;
    for (const t of s.targets || []) {
      if (!known(t)) continue;
      const o = pinOrigin(s, t, _o);
      const d = Math.min(Math.hypot(p.u - o.u, p.v - o.v), Math.hypot(p.u - o.u - HANDLE.x * o.s, p.v - o.v - HANDLE.y * o.s));
      if (d < bd) { bd = d; best = { kind: 'pin', id: t.id, dead: isDead(t), su: o.u, sv: o.v, tray: o.tray }; }
    }
    if (bat) {
      const a = plotOf(s).alidade, b = a.bearing * DEG, ts = tokenScale();
      const sk = sightKm(s, bat), su = kmU(sk.x), sv = kmV(sk.y);
      // ручка визира — справа по ходу линейки
      const ku = su + Math.cos(b) * KNOB_OFF * ts, kv = sv - Math.sin(b) * KNOB_OFF * ts;
      if (sight.visible) {
        const d = Math.min(Math.hypot(p.u - su, p.v - sv), Math.hypot(p.u - ku, p.v - kv)) + 1e-4;   // при равенстве — фишка
        if (d < bd) { bd = d; best = { kind: 'sight', su, sv }; }
      }
      if (!best && game.pivots) {
        // знак батареи или поста звукометрии: касание переставляет ось алидады
        game.pivots().forEach((q, i) => {
          const d = Math.hypot(p.u - kmU(q.x), p.v - kmV(q.y));
          if (d < grab * 0.75 && (!best || d < best.d)) best = { kind: 'pivot', i, d };
        });
      }
      if (!best) {
        // линейка: расстояние до оси в пределах её длины
        const pu = kmU(bat.x), pv = kmV(bat.y), rx = p.u - pu, ry = p.v - pv;
        const along = rx * Math.sin(b) + ry * Math.cos(b), across = Math.abs(rx * Math.cos(b) - ry * Math.sin(b));
        if (along > 0.4 * K && along < ruler.scale.x + 0.005 && across < Math.max(grab * 0.62, ruler.scale.y * 0.6)) {
          best = { kind: 'ruler', angle: Math.atan2(rx, ry), bearing: a.bearing };
        }
      }
    }
    return best;
  }

  disposers.push(input.add(hit, {
    onDown(e) {
      drag = null;
      if (!state().mission) return;
      const p = boardPoint(e);
      if (!p) return;
      fling.u = fling.v = 0;                               // палец остановил карту, летящую по инерции
      drag = pick(p) || { kind: 'none' };
      drag.p0 = p; drag.moved = false;
      // под лупой пустое место листа (и знак поста — у него только касание) тащит саму карту
      drag.pan = loupe && zoom > 0.9 && (drag.kind === 'none' || drag.kind === 'pivot');
    },
    onDrag(e) {
      if (drag && drag.pan && e.dragging) { panDrag(e); return; }
      if (!drag || drag.kind === 'none' || drag.kind === 'pivot' || !e.dragging) return;
      const p = boardPoint(e);
      if (!p) return;
      const s = state();
      if (!drag.moved) {
        // жест признан перетаскиванием: порог срабатывания «съедается», чтобы орган не прыгал под пальцем
        drag.moved = true;
        const thr = e.pointerType === 'mouse' ? 5 : 10, total = Math.hypot(e.totalDx || 0, e.totalDy || 0);
        const k = total > thr ? thr / total : 1;
        drag.p0 = { u: drag.p0.u + (p.u - drag.p0.u) * k, v: drag.p0.v + (p.v - drag.p0.v) * k };
        if (drag.kind === 'pin') {
          if (drag.dead) { drag.kind = 'none'; return; }
          if (s.activeTarget !== drag.id) game.selectTarget(drag.id);
        }
        if (drag.kind === 'ruler') {
          const bat = battery();
          drag.angle = Math.atan2(drag.p0.u - kmU(bat.x), drag.p0.v - kmV(bat.y));
        }
        if (drag.kind === 'pin') audio.tick(); else audio.paper();     // фишку взяли / линейка, визир поехали по карте
      }
      const du = p.u - drag.p0.u, dv = p.v - drag.p0.v;
      if (drag.kind === 'pin') {
        const u = drag.su + du, v = drag.sv + dv, x = uKm(u), y = vKm(v);
        const inside = x > -0.35 && x < MAP + 0.35 && y > -0.35 && y < MAP + 0.35;
        if (inside || plotOf(s).pins[drag.id]) { drag.free = null; movePin(drag.id, x, y); }
        else drag.free = { u, v };                         // ещё не на карте — фишка просто идёт за пальцем
      } else if (drag.kind === 'sight') {
        setAlidadeTo(uKm(drag.su + du), vKm(drag.sv + dv));
      } else if (drag.kind === 'ruler') {
        const bat = battery();
        if (!bat) return;
        const rx = p.u - kmU(bat.x), ry = p.v - kmV(bat.y);
        if (Math.hypot(rx, ry) < 0.3 * K) return;
        const bearing = norm360(Math.round((drag.bearing + (Math.atan2(rx, ry) - drag.angle) / DEG) * 10) / 10);
        if (bearing !== plotOf(s).alidade.bearing) game.setAlidade({ bearing });
      }
    },
    onUp(e) {
      if (!drag) return;
      const d = drag;
      if (d.kind === 'pan') { if (d.moved) { drag = null; if (!e.cancelled) startFling(d); } return; }
      if (d.moved) {
        d.done = true;
        if (d.kind === 'pin') { d.free = null; audio.pin(); }
        if (d.kind === 'sight' || d.kind === 'ruler') trySnap();
        if (loupe && !panned && (d.kind === 'pin' || d.kind === 'sight')) {
          // подвести кадр к тому, что двигали
          const s = state(), bat = battery();
          const pin = d.kind === 'pin' ? plotOf(s).pins[d.id] : null;
          const q = pin || (bat ? sightKm(s, bat) : null);
          if (q) centreLoupe(kmU(clamp(q.x, 0, MAP)), kmV(clamp(q.y, 0, MAP)), 0.35);
        }
      }
      if (d.moved) drag = null;
    },
    onTap(e) {
      const d = drag;
      drag = null;
      if (!d || d.moved) return;
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (d.kind === 'pin') {
        lastTap = null;
        if (!d.dead && state().activeTarget !== d.id) { game.selectTarget(d.id); audio.tick(); }
        return;
      }
      if (d.kind === 'none' || d.kind === 'ruler') {
        // ночью: касание квадрата поиска выбирает цель, о которой ещё нет донесения
        const s = state(), x = uKm(d.p0.u), y = vKm(d.p0.v);
        const a = overlay.info.areas.length && s.mission && (s.mission.areas || []).find((q) => overlay.info.areas.includes(q.targetId) && q.targetId !== s.activeTarget && x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1);
        if (a) { lastTap = null; game.selectTarget(a.targetId); audio.tick(); return; }
      }
      if (d.kind === 'pivot') {
        lastTap = null;
        const s = state();
        if ((s.plot && s.plot.pivot) !== d.i) { game.setPivot(d.i); audio.clunk(); }
        return;
      }
      if (lastTap && now - lastTap.t < 450 && Math.hypot(e.x - lastTap.x, e.y - lastTap.y) < 34) {
        lastTap = null;
        audio.loupe();
        if (loupe) setLoupe(false);
        else {
          // двойное касание: лупа у фишки/визира, если они рядом с местом касания, иначе — в месте касания
          const f = focusPoint(), p = d.p0;
          setLoupe(true, Math.hypot(f.u - p.u, f.v - p.v) < 2 * K ? f : { u: p.u, v: p.v });
        }
      } else lastTap = { t: now, x: e.x, y: e.y };
    },
  }));

  // карта под лупой идёт за пальцем 1:1: точка листа, за которую взялись, остаётся под пальцем (кадр двигается сразу,
  // без перелёта, — следующий луч уже из нового положения камеры). sens/invert маховиков сюда не относятся.
  function panDrag(e) {
    const d = drag, p = boardPoint(e);
    if (!p) return;
    if (!d.moved) {
      d.moved = true; d.kind = 'pan'; lastTap = null; panned = true;
      const thr = e.pointerType === 'mouse' ? 5 : 10, total = Math.hypot(e.totalDx || 0, e.totalDy || 0);
      const k = total > thr ? thr / total : 1;               // порог «съедается» — карта не прыгает под пальцем
      d.anchor = { u: d.p0.u + (p.u - d.p0.u) * k, v: d.p0.v + (p.v - d.p0.v) * k };
      d.trail = [];
    }
    panLoupe(loupeC.u + d.anchor.u - p.u, loupeC.v + d.anchor.v - p.v);
    const t = now();
    d.trail.push({ t, u: loupeC.u, v: loupeC.v });
    while (d.trail.length > 2 && t - d.trail[0].t > FLING.window) d.trail.shift();
  }
  function startFling(d) {
    const tr = d.trail || [], t = now();
    if (tr.length < 2) return;
    const a = tr[0], b = tr[tr.length - 1], dt = (b.t - a.t) / 1000;
    if (t - b.t > FLING.still || dt < 0.012) return;       // палец остановился перед отпусканием — без инерции
    let fu = (b.u - a.u) / dt, fv = (b.v - a.v) / dt;
    const sp = Math.hypot(fu, fv);
    if (sp < FLING.min * 4) return;
    if (sp > FLING.max) { fu *= FLING.max / sp; fv *= FLING.max / sp; }
    fling.u = fu; fling.v = fv;
    engine.invalidate();
  }
  function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

  // ------------------------------------------------------------------ кадр
  const fmt2 = (v) => { const n = Math.round(v * 100); return (n < 1000 ? '0' : '') + (n / 100).toFixed(2); };
  const fmtB = (v) => { const n = Math.round(norm360(v) * 10) / 10; return (n < 100 ? (n < 10 ? '00' : '0') : '') + n.toFixed(1); };

  function resetLocal() {
    pinMoved = {};
    fx.friendHit = {}; fx.raidWarn = null;
    drag = null; lastTap = null;
    accB = accR = 0;
    if (loupe) setLoupe(false);
  }

  function update(dt) {
    const s = state(), plot = plotOf(s), mission = s.mission || null;
    if (mission !== chartMission) redrawChart(mission);
    if (s.plot !== plotRef) { plotRef = s.plot; resetLocal(); }

    if (fling.u || fling.v) {
      if (!loupe || engine.current !== 'plot') fling.u = fling.v = 0;
      else {
        const edge = panLoupe(loupeC.u + fling.u * dt, loupeC.v + fling.v * dt), f = Math.exp(-dt * FLING.decay);
        fling.u = edge.u ? 0 : fling.u * f; fling.v = edge.v ? 0 : fling.v * f;       // у края листа — стоп
        if (Math.hypot(fling.u, fling.v) < FLING.min) fling.u = fling.v = 0;
        engine.invalidate();
      }
    }
    zoom += ((loupe ? 1 : 0) - zoom) * (1 - Math.exp(-dt * 7));
    if (Math.abs((loupe ? 1 : 0) - zoom) < 0.002) zoom = loupe ? 1 : 0;
    // камеру вернули к основному виду помимо поста (повторный gotoStation оболочки) — снять лупу
    if (loupe && zoom === 1 && engine.current === 'plot' && !engine.flying && engine.camera.fov > (LOUPE.fov + CAM.fov) / 2) {
      loupe = false; btnLoupe.setLit(false);
    }
    const ts = tokenScale();

    const bat = mission ? battery() : null;
    const a = plot.alidade;
    const activeId = s.activeTarget;
    const active = activeId != null ? targetById(activeId) : null;
    const activePin = active ? plot.pins[activeId] : null;

    // счётчики
    cBearing.setValue(a.bearing);
    cRange.setValue(a.range);
    cX.setValue(activePin ? activePin.x : 0);
    cY.setValue(activePin ? activePin.y : 0);

    // алидада
    alidade.visible = !!bat;
    let aligned = false;
    if (bat) {
      const b = a.bearing * DEG, pu = kmU(bat.x), pv = kmV(bat.y), sx = Math.sin(b), sy = Math.cos(b);
      alidade.position.x = pu; alidade.position.y = pv;
      alidade.rotation.z = Math.PI / 2 - b;
      // линейка обрезается рамкой листа
      const lim = SHEET / 2 - 0.004;
      let len = RULER_KM * K;
      if (sx > 1e-6) len = Math.min(len, (lim - pu) / sx); else if (sx < -1e-6) len = Math.min(len, (-lim - pu) / sx);
      if (sy > 1e-6) len = Math.min(len, (lim - pv) / sy); else if (sy < -1e-6) len = Math.min(len, (-lim - pv) / sy);
      len = Math.max(0.01, len);
      ruler.scale.set(len, RULER_W * lerp(1, 0.5, zoom), 1);
      rulerTex.repeat.x = len / (RULER_KM * K);
      pivot.scale.setScalar(ts);
      const r = a.range * K;
      sight.visible = r <= len + 1e-6;
      sight.position.x = r;
      sight.scale.setScalar(ts);
      if (activePin && !isDead(active)) {
        aligned = Math.hypot(bat.x + a.range * sx - activePin.x, bat.y + a.range * sy - activePin.y) <= ALIGN_TOL + 1e-9;
      }
    }
    lampAligned.set(aligned);
    jewel.material = aligned ? jewelOn : jewelOff;

    // фишки
    const targets = s.targets || [];
    for (const id in pins) pins[id].seen = false;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const pin = pins[t.id] || makePin(t.id);
      pin.seen = true;
      pin.g.visible = known(t);
      if (!pin.g.visible) continue;
      const o = pinOrigin(s, t, _o);
      pin.g.position.set(o.u, o.v, o.tray ? 0.008 - PLANE_Z + 0.0005 : 0.0018 + t.id * 0.0002);
      pin.g.scale.setScalar(o.s);
      setPinRow(pin, isSinking(t) ? 3 : isDead(t) ? 2 : t.id === activeId ? 1 : 0);
    }
    // цели, которых больше нет (новое задание, прошлая волна обороны): фишку убираем совсем
    for (const id in pins) if (!pins[id].seen) { const q = pins[id]; plane.remove(q.g); q.capGeo.dispose(); delete pins[id]; delete hotspots['pin' + id]; }

    // лампы
    let fresh = false;
    if (active && active.reported && !isDead(active)) {
      const m = pinMoved[activeId], r = active.reported;
      // фишку ставили не здесь (обучение, бот) — судим по расстоянию до донесения
      if (r.x == null) fresh = !activePin || (m ? r.time > m.time : !!active.moved);   // засечка звукометрии
      else fresh = !activePin || (m ? r.time > m.time && (r.x !== m.x || r.y !== m.y) : Math.hypot(activePin.x - r.x, activePin.y - r.y) > LEAD_TOL);
    }
    lampNew.set(fresh);
    const rec = active ? plot.recorded[activeId] : null;
    lampRecorded.set(!!rec && rec.bearing === a.bearing && rec.range === a.range);

    photos.update(s);
    fx.view = zoom > 0.5 ? { x: uKm(loupeC.u), y: vKm(loupeC.v) } : null;
    if (fx.raidWarn && (!mission || s.phase !== 'playing' || s.time < fx.raidWarn.until - 12)) fx.raidWarn = null;   // бой кончился или начат заново
    overlay.update(s, game, performance.now() / 1000, zoom, fx);

    // отметки упреждения
    let lead = false;
    if (s.difficulty === 0 && s.phase === 'playing' && active && active.moving && active.reported && activePin && !isDead(active)) {
      const r = active.reported;
      if (Math.hypot(activePin.x - r.x, activePin.y - r.y) <= LEAD_TOL + 1e-9) {
        const end = game.predict(activeId, 300);
        if (end) {
          lead = true;
          const hw = 0.0011 * lerp(1, 0.42, zoom), tick = 0.0075 * ts, lab = 0.0085 * lerp(1, 0.36, zoom);
          const ax = kmU(r.x), ay = kmV(r.y), ex = kmU(end.x), ey = kmV(end.y);
          const L = Math.hypot(ex - ax, ey - ay) || 1, dx = (ex - ax) / L, dy = (ey - ay) / L;
          quad(leadPos, 0, ax, ay, ex + dx * tick * 0.6, ey + dy * tick * 0.6, hw);
          for (let k = 1; k <= 5; k++) {
            const q = game.predict(activeId, k * 60);
            const inside = q.x >= 0 && q.x <= MAP && q.y >= 0 && q.y <= MAP;
            const qx = kmU(q.x), qy = kmV(q.y), tk = inside ? tick : 0;
            quad(leadPos, k, qx + dy * tk, qy - dx * tk, qx - dy * tk, qy + dx * tk, hw * 1.25);
            // подпись — слева по ходу цели
            const cx = qx - dy * (tick + lab * 1.25), cy = qy + dx * (tick + lab * 1.25), h = inside ? lab : 0, o = (k - 1) * 12;
            leadLabPos[o] = cx - h; leadLabPos[o + 1] = cy - h; leadLabPos[o + 3] = cx + h; leadLabPos[o + 4] = cy - h;
            leadLabPos[o + 6] = cx + h; leadLabPos[o + 7] = cy + h; leadLabPos[o + 9] = cx - h; leadLabPos[o + 10] = cy + h;
          }
          leadGeo.attributes.position.needsUpdate = true;
          leadLabGeo.attributes.position.needsUpdate = true;
        }
      }
    }
    leadMesh.visible = leadLabels.visible = lead;

    // бирки под лупой
    // под лупой над аэрофотоснимком бирки не показываем (мешают смотреть); во время перетаскивания и 2 с после — показываем
    if (drag && drag.moved && !drag.done && drag.kind !== 'pan') tagHold = 2; else tagHold = Math.max(0, tagHold - dt);
    const tags = zoom > 0.5 && (tagHold > 0 || !photos.covers(loupeC.u, loupeC.v));
    backPlate.object3D.visible = loupe && zoom > 0.5;
    sightPlate.object3D.visible = backPlate.object3D.visible && panned;
    tagPin.mesh.visible = tags && !!activePin;
    if (tagPin.mesh.visible) {
      setTag(tagPin, 'X ' + fmt2(activePin.x), 'Y ' + fmt2(activePin.y));
      tagPin.mesh.position.set(kmU(activePin.x), kmV(activePin.y) + 0.62 * K, 0.0034);
    }
    tagSight.mesh.visible = tags && !!bat && sight.visible;
    if (tagSight.mesh.visible) {
      const p = sightKm(s, bat);
      setTag(tagSight, fmtB(a.bearing) + '°', fmt2(a.range) + ' км');
      tagSight.mesh.position.set(kmU(p.x) + 0.25 * K, kmV(p.y) - 0.74 * K, 0.0036);
    }
  }

  Object.assign(hotspots, {
    bearingWheel: wheelB.object3D, rangeWheel: wheelR.object3D,
    btnXMinus: btnXm.object3D, btnXPlus: btnXp.object3D, btnYMinus: btnYm.object3D, btnYPlus: btnYp.object3D,
    btnRecord: btnRecord.object3D, btnLoupe: btnLoupe.object3D, btnLine: btnLine.object3D, btnErase: btnErase.object3D, btnOverview: backPlate.object3D, btnToSight: sightPlate.object3D,
    chart: sheet, sight, ruler, tray: trayObj,
    counterBearing: cBearing.object3D, counterRange: cRange.object3D, counterX: cX.object3D, counterY: cY.object3D,
    lampAligned: lampAligned.object3D, lampRecorded: lampRecorded.object3D, lampNew: lampNew.object3D,
  });
  for (let id = 1; id <= 3; id++) makePin(id);

  redrawChart(state().mission || null);

  const _w = new THREE.Vector3();
  return {
    id: 'plot', title: 'ПЛАНШЕТ', group,
    camera: mainCamera,
    update,
    onEnter() { audio.clunk(); },
    onLeave() {
      drag = null; lastTap = null; panned = false; fling.u = fling.v = 0;
      if (loupe) { loupe = false; btnLoupe.setLit(false); }   // камеру уводит движок
    },
    hotspots,
    /** Помощники для тестов и обучения. */
    api: {
      /** Точка карты (км) → мировые координаты. */
      chartToWorld(x, y) { group.updateWorldMatrix(true, false); return boardToLocal(kmU(x), kmV(y), 0, new THREE.Vector3()).applyMatrix4(group.matrixWorld); },
      /** Положение ручки-диска фишки (за неё удобно тащить) в мировых координатах. */
      pinHandleWorld(id) {
        const t = targetById(id);
        if (!known(t)) return null;
        const o = pinOrigin(state(), t, { u: 0, v: 0, s: 1, tray: false });
        group.updateWorldMatrix(true, false);
        return boardToLocal(o.u + HANDLE.x * o.s, o.v + HANDLE.y * o.s, 0, _w.clone()).applyMatrix4(group.matrixWorld);
      },
      /** Смещение ручки-диска от острия фишки, км карты (в основном виде; под лупой — × tokenScale). */
      get handleOffsetKm() { const k = tokenScale() / K; return { x: HANDLE.x * k, y: HANDLE.y * k }; },
      get loupe() { return loupe; },
      /** Центр кадра лупы, км карты; panned — карту отвели пальцем (кадр не следует за фишкой/визиром); flinging — летит по инерции. */
      get loupeView() { return { x: uKm(loupeC.u), y: vKm(loupeC.v), panned, flinging: !!(fling.u || fling.v) }; },
      get leadVisible() { return leadMesh.visible; },
      get photos() { return photos.shown; },
      /** id своих кораблей на аэрофотоснимке выстрела n. */
      photoFriends(n) { return photos.friendsOn(n); },
      /** Что нарисовано на слое карты: { areas:[id целей], lights, smokes, marks:{id:'rough'|'lost'|'fog'}, pairs, tint, wind }. */
      get overlay() { return JSON.parse(JSON.stringify(overlay.info)); },
      /** id целей, чьи квадраты ночного поиска сейчас показаны. */
      get areas() { return overlay.info.areas.slice(); },
      /** Свои корабли на карте: [{ id, x, y, state: 'ok'|'hit'|'sunk'|'arrived', ring (круг 0.25 км под лупой), convoy }]. */
      get friends() { return JSON.parse(JSON.stringify(overlay.info.friends)); },
      /** Сколько пеленгов трубы наблюдательного поста нарисовано. */
      get scopeLines() { return overlay.info.scopeLines; },
      /** Сектор трубы на карте: { bearing, fov } | null. */
      get scope() { return overlay.info.scope ? { ...overlay.info.scope } : null; },
      /** Налёт на карте: null | { stamp: true, phase, planes: [{ id, x, y, off (за рамкой — на краю со стрелкой), attacked }] }. */
      get raid() { return overlay.info.raid ? JSON.parse(JSON.stringify(overlay.info.raid)) : null; },
      /** Строка атласа фишки: 0 обычная, 1 выбранная, 2 поражена/ушла, 3 тонет (догорает). */
      pinRow(id) { return pins[id] ? pins[id].row : -1; },
      /** Видна ли фишка цели (в лотке или на карте). */
      pinVisible(id) { return !!(pins[id] && pins[id].g.visible); },
      setLoupe(b) { setLoupe(b); },
      /** Что взял бы палец в точке карты (км): 'pin'|'sight'|'ruler'|'pivot'|'none'. */
      pickAt(x, y) { const r = pick({ u: kmU(x), v: kmV(y) }); return r ? r.kind : 'none'; },
    },
    dispose() {
      disposers.forEach((d) => { try { d(); } catch (e) { /* уже снято */ } });
      disposers.length = 0;
      [chartTex, rulerTex, atlasTex, leadTex, chartMat, atlasMat, leadMat, leadGeo, leadLabGeo, pinBodyGeo, rulerGeo, sheet.geometry].forEach((x) => x.dispose());
      group.removeFromParent();
    },
  };
}
