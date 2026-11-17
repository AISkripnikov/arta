// Пост «ВЫЧИСЛИТЕЛЬ» (DESIGN §7.2): механический баллистический вычислитель.
// Игрок набирает маховиком дальность, выбирает галетником заряд, тянет рычаг «ВЫЧИСЛИТЬ» —
// за стеклом ~1.2 с крутится счётная механика, затем счётчики выдают угол возвышения и время полёта.
// Пост НЕ хранит игровую логику: всё показывается из game.state и меняется действиями game.*.

const DEG = Math.PI / 180, TAU = Math.PI * 2;
const SPIN_TIME = 1.2;                    // длительность «счёта», с
const SPIN_TURNS = 2;                     // оборотов ведущей шестерни за один расчёт

// ---- компоновка (локальные координаты поста, м) ----
const TD = 40 * DEG, TU = 10 * DEG;       // наклон стола и приборной панели от вертикали (назад)
const LD = 0.40, LU = 0.42;               // длина стола по скату и высота приборной панели
const AY = 0.80, AZ = 0.24;               // нижняя кромка стола
const BY = AY + LD * Math.cos(TD), BZ = AZ - LD * Math.sin(TD);     // излом стол/панель
const CY = BY + LU * Math.cos(TU), CZ = BZ - LU * Math.sin(TU);     // верхняя кромка панели
const XL = -0.88, XR = 0.575;             // левая/правая кромка стола и панели
const TX = 0.74, TW = 0.30, TZ = 0.07;    // колонна рычага: центр по X, ширина, лицевая плоскость (z)
const SLAB = 0.03;                        // толщина лицевых плит
const HX = -0.29, HW = 0.44, HH = 0.44, HD = 0.062;   // кожух счётного механизма на приборной панели
const WY = -0.047, WW = 0.34, WH = 0.23;  // окно механизма (центр по высоте панели, ширина, высота)

export function createComputerStation(ctx) {
  const { engine, THREE, ui, mat, audio, game } = ctx;
  const G = engine.geom, T = engine.textures;
  const P = mat.PALETTE || {};
  const COL = {
    panel: P.panel || '#3d4a57', panelDark: P.panelDark || '#2b343d',
    ivory: P.ivory || '#e8e0c8', plate: P.plateBlack || '#111316', red: P.plateRed || '#8f1d14',
    ochre: P.ochre || '#d39a1e', green: P.lampGreen || '#4be36a', lampRed: P.lampRed || '#ff4a3a',
  };
  const group = new THREE.Group();
  group.name = 'station:computer';
  const disposers = [];

  // ------------------------------------------------------------------ помощники
  /** Группа-«поверхность»: начало в центре грани, +Y вдоль ската вверх, +Z — нормаль к игроку. */
  function surface(y, z, tilt) {
    const g = new THREE.Group();
    g.position.set(0, y, z);
    g.rotation.x = -tilt;
    group.add(g);
    return g;
  }
  const desk = surface((AY + BY) / 2, (AZ + BZ) / 2, TD);
  const upper = surface((BY + CY) / 2, (BZ + CZ) / 2, TU);
  const tower = surface(0, TZ, 0);
  desk.name = 'desk'; upper.name = 'upper'; tower.name = 'tower';

  /** Поставить орган (или Object3D) на поверхность. */
  function put(surf, child, x, y, z = 0) {
    const o = child && child.object3D ? child.object3D : child;
    o.position.set(x, y, z);
    surf.add(o);
    return child;
  }
  /** Геометрию из координат поверхности → в координаты поста. */
  const toStation = (g, surf) => G.xf(g, { r: [surf.rotation.x, 0, 0], p: surf.position.toArray() });

  /** Лицевая плита с заклёпками: лицо на z = 0, тыл на z = −d, центр в (cx, cy). */
  function facePlate(w, h, cx, cy, d = SLAB, rivetStep = 0.1) {
    const parts = [G.slab(w, h, d, { r: 0.022, bevel: 0.008, segs: 2, curve: 4 })];
    if (rivetStep) {
      const ins = 0.03, x0 = -w / 2 + ins, x1 = w / 2 - ins, y0 = -h / 2 + ins, y1 = h / 2 - ins;
      const nx = Math.max(1, Math.round((x1 - x0) / rivetStep)), ny = Math.max(1, Math.round((y1 - y0) / rivetStep));
      for (let i = 0; i <= nx; i++) for (const y of [y0, y1]) parts.push(G.xf(G.rivetGeometry(0.0065, 6), { p: [x0 + (x1 - x0) * i / nx, y, d] }));
      for (let j = 1; j < ny; j++) for (const x of [x0, x1]) parts.push(G.xf(G.rivetGeometry(0.0065, 6), { p: [x, y0 + (y1 - y0) * j / ny, d] }));
    }
    const g = G.merge(parts);
    g.translate(cx, cy, -d);
    return g;
  }
  const rrPath = (w, h, r) => {
    const p = new THREE.Path();
    p.setFromPoints(G.roundedRectShape(w, h, r).getPoints(4).reverse());
    return p;
  };
  const textW = (text, size) => T.measureLabel(text, 100, { weight: 600 }).width / 100 * size;
  /** Шильдик без винтов; если текст шире maxW — сжимается по горизонтали. */
  function label(text, size, maxW, style) {
    const natural = textW(text, size) + size * 1.5;
    const o = { size, screws: false, style: style || 'black' };
    if (maxW && natural > maxW) o.w = maxW;
    return ui.plate(text, o);
  }

  // ------------------------------------------------------------------ корпус
  {
    // тумба + приборный шкаф: профиль в плоскости (z, y), выдавленный по X
    const nd = [Math.sin(TD), Math.cos(TD)], ud = [Math.cos(TD), -Math.sin(TD)];   // нормаль и «вверх по скату» стола: [y, z]
    const nu = [Math.sin(TU), Math.cos(TU)], uu = [Math.cos(TU), -Math.sin(TU)];
    const dc = [desk.position.y, desk.position.z], uc = [upper.position.y, upper.position.z];
    const onDesk = (v, t) => [dc[1] + ud[1] * v - nd[1] * t, dc[0] + ud[0] * v - nd[0] * t];   // → [z, y]
    const onUpper = (v, t) => [uc[1] + uu[1] * v - nu[1] * t, uc[0] + uu[0] * v - nu[0] * t];
    const prof = [
      [0.15, 0], [0.15, 0.71], onDesk(-LD / 2 + 0.012, SLAB), onUpper(-LU / 2 + 0.01, SLAB), onUpper(LU / 2 - 0.004, SLAB),
      [CZ - 0.05, CY + 0.03], [-0.52, CY + 0.03], [-0.52, 0],
    ];
    const shape = new THREE.Shape();
    prof.forEach(([z, y], i) => (i ? shape.lineTo(-z, y) : shape.moveTo(-z, y)));
    shape.closePath();
    const body = new THREE.ExtrudeGeometry(shape, { depth: TX - TW / 2 - XL + 0.002, bevelEnabled: false });
    body.rotateY(Math.PI / 2);
    body.translate(XL + 0.004, 0, 0);
    // колонна рычага
    const col = G.slab(TW, 1.62, TZ + 0.52 - 0.012, { r: 0.02, bevel: 0.012, segs: 2, curve: 4 });
    col.rotateX(0); col.translate(TX, 0.81, -0.52);
    // крышка-козырёк над шкафом
    const cap = G.slab(XR - XL + 0.03, 0.03, 0.46, { r: 0.008, bevel: 0.006 });
    cap.translate((XL + XR) / 2, CY + 0.045, -0.54);
    const dark = new THREE.Mesh(G.boxUV(G.merge([body, col, cap]), mat.WEAR_REPEAT || 1), mat.paint(COL.panelDark, { wear: 0.8 }));
    dark.name = 'body';
    group.add(dark);

    // лицевые плиты: стол, приборная панель, кожух механизма, плита колонны
    const hole = rrPath(WW, WH, 0.02);
    const housing = G.slab(HW, HH, HD, { r: 0.03, bevel: 0.012, segs: 3, curve: 5, hole });
    // окно в кожухе смещено: сдвигаем кожух так, чтобы отверстие встало на место окна
    housing.translate(HX, WY, 0);
    const housingTop = G.slab(HW, HH / 2 - WY - WH / 2 - 0.004 + 0.0, HD, { r: 0.03, bevel: 0.012, segs: 3, curve: 5 });
    housingTop.translate(HX, (WY + HH / 2 + 0.0) + (HH / 2 - WY - WH / 2 - 0.004) / 2 - 0.02, 0);
    const light = G.merge([
      toStation(facePlate(XR - XL, LD, (XL + XR) / 2, 0), desk),
      toStation(facePlate(XR - XL, LU, (XL + XR) / 2, 0), upper),
      toStation(housing, upper),
      toStation(housingTop, upper),
      toStation(facePlate(TW - 0.024, 0.83, TX, 1.175, 0.014, 0.09), tower),
    ]);
    const lightMesh = new THREE.Mesh(G.boxUV(light, mat.WEAR_REPEAT || 1), mat.paint(COL.panel, { wear: 0.5 }));
    lightMesh.name = 'plates';
    group.add(lightMesh);
  }

  // ------------------------------------------------------------------ приборная панель: ввод дальности
  const SZ_U = 0.028, SZ_D = 0.026;       // высота прописной на панели и на столе
  const DH = 0.058;                       // высота окна больших счётчиков
  const RX = -0.70;                       // колонка «ДАЛЬНОСТЬ»
  put(upper, label('ДАЛЬНОСТЬ, КМ', SZ_U, 0.32), RX, 0.166);
  const cRange = put(upper, ui.drumCounter({ digits: 4, decimals: 2, digitH: DH }), RX, 0.087);
  put(upper, label('ЗАМЕР: ДАЛЬНОСТЬ', 0.025, 0.32), RX, -0.048);
  const cRepeat = put(upper, ui.drumCounter({ digits: 4, decimals: 2, digitH: 0.044, unit: 'КМ' }), RX, -0.118);

  // ------------------------------------------------------------------ результат
  const EX = 0.105, FX = 0.415;
  put(upper, label('УГОЛ ВОЗВЫШЕНИЯ', SZ_U, 0.30), EX, 0.166);
  const cElev = put(upper, ui.drumCounter({ digits: 4, decimals: 2, digitH: DH, unit: '°', sound: true }), EX, 0.087);
  put(upper, label('ВРЕМЯ ПОЛЁТА, С', SZ_U, 0.30), FX, 0.166);
  const cTof = put(upper, ui.drumCounter({ digits: 3, decimals: 1, digitH: DH, sound: true }), FX, 0.087);

  // лампы состояния
  const LY = -0.058, LR = 0.024;
  function statusLamp(color, text, x, maxW) {
    const l = put(upper, ui.lamp({ color, radius: LR }), x, LY);
    put(upper, label(text, SZ_U, maxW), x, LY - LR * 1.5 - 0.012 - (SZ_U * 2.1) / 2);
    return l;
  }
  const lampReady = statusLamp('green', 'ГОТОВО', 0.02, 0.16);
  const lampStale = statusLamp('amber', 'УСТАРЕЛО', 0.21, 0.19);
  const lampOut = statusLamp('red', 'ВНЕ ДАЛЬНОСТИ', 0.44, 0.255);

  // ------------------------------------------------------------------ шторки «нет решения» / «нет замера»
  /** Шторка в окне счётчика: закрывает цифры, убирается вверх. */
  function shutter(counter, digitH, text, style) {
    const b = Math.max(0, (counter.h - digitH) / 2);
    const w = Math.max(0.02, counter.w - 2 * b), h = digitH;
    const ppm = Math.min(1400, 256 / w), cw = Math.round(w * ppm), ch = Math.round(h * ppm);
    const cv = T.makeCanvas(cw, ch), c2 = cv.getContext('2d');
    c2.fillStyle = style === 'red' ? COL.red : '#0b0c0d';
    c2.fillRect(0, 0, cw, ch);
    const gr = c2.createLinearGradient(0, 0, 0, ch);
    gr.addColorStop(0, 'rgba(0,0,0,0.45)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.06)'); gr.addColorStop(1, 'rgba(0,0,0,0.4)');
    c2.fillStyle = gr; c2.fillRect(0, 0, cw, ch);
    c2.strokeStyle = 'rgba(232,224,200,0.45)'; c2.lineWidth = Math.max(1, ch * 0.035);
    c2.strokeRect(ch * 0.09, ch * 0.09, cw - ch * 0.18, ch - ch * 0.18);
    T.drawLabel(c2, text, cw / 2, ch / 2, ch * 0.4, { color: COL.ivory, maxWidth: cw - ch * 0.5 });
    const tex = T.canvasTexture(cv, { aniso: 4 });
    const geo = new THREE.PlaneGeometry(w, h);
    geo.translate(0, -h / 2, 0);
    const material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.15 });
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = 'shutter';
    mesh.position.set(0, h / 2, Math.max(0.012, digitH * 0.3) * 0.62);
    counter.object3D.add(mesh);
    let k = 1, closed = true;
    const apply = () => { mesh.visible = k > 0.004; mesh.scale.y = Math.max(0.004, k); tex.repeat.y = Math.max(0.004, k); };
    apply();
    disposers.push(() => { tex.dispose(); material.dispose(); geo.dispose(); });
    return {
      mesh,
      get closed() { return closed; },
      set(b, instant) { closed = !!b; if (instant) { k = closed ? 1 : 0; apply(); } },
      update(dt) {
        const t = closed ? 1 : 0;
        if (k === t) return;
        const d = dt * 5.5;
        k = k < t ? Math.min(t, k + d) : Math.max(t, k - d);
        apply();
      },
    };
  }
  const shElev = shutter(cElev, DH, 'НЕТ РЕШЕНИЯ', 'red');
  const shTof = shutter(cTof, DH, '— —', 'red');
  const shRepeat = shutter(cRepeat, 0.044, 'НЕТ ЗАМЕРА', 'black');

  // ------------------------------------------------------------------ счётный механизм за стеклом
  put(upper, ui.plate('ВЫЧИСЛИТЕЛЬ', { size: 0.034, style: 'black' }), HX, 0.168, HD);
  const mech = new THREE.Group();
  mech.name = 'mechanism';
  put(upper, mech, HX, WY, 0);

  /** Шестерня: N зубьев, модуль m; зуб с центром на локальном угле 0. */
  function gearGeo(N, m, thick, holes) {
    const rp = m * N / 2, ra = rp + m * 0.95, rf = rp - m * 1.15, p = TAU / N;
    const s = new THREE.Shape();
    for (let i = 0; i < N; i++) {
      const a = i * p;
      [[a - 0.29 * p, rf], [a - 0.13 * p, ra], [a + 0.13 * p, ra], [a + 0.29 * p, rf]].forEach(([ang, r], k) => {
        const x = Math.cos(ang) * r, y = Math.sin(ang) * r;
        if (i === 0 && k === 0) s.moveTo(x, y); else s.lineTo(x, y);
      });
    }
    s.closePath();
    for (let k = 0; k < (holes || 0); k++) {
      const a = (k + 0.5) / holes * TAU, hr = rf * 0.58, r = rf * (holes > 4 ? 0.2 : 0.25);
      const h = new THREE.Path();
      h.absarc(Math.cos(a) * hr, Math.sin(a) * hr, r, 0, TAU, true);
      s.holes.push(h);
    }
    return G.extrude(s, thick, 0.0008, 1, 10);
  }
  const MOD = 0.008;
  const GEARS = {            // центр [x, y], число зубьев
    g1: { c: [-0.068, -0.014], N: 22 },
    g2: { N: 12 }, g3: { N: 9 },
    g4: { c: [0.03, -0.062], N: 15 },
  };
  const PHI12 = 28 * DEG, PHI23 = -56 * DEG;
  {
    const d12 = MOD * (GEARS.g1.N + GEARS.g2.N) / 2, d23 = MOD * (GEARS.g2.N + GEARS.g3.N) / 2;
    GEARS.g2.c = [GEARS.g1.c[0] + Math.cos(PHI12) * d12, GEARS.g1.c[1] + Math.sin(PHI12) * d12];
    GEARS.g3.c = [GEARS.g2.c[0] + Math.cos(PHI23) * d23, GEARS.g2.c[1] + Math.sin(PHI23) * d23];
  }
  const Z_BACK = 0.008, Z_MID = 0.021, Z_FRONT = 0.034, GT = 0.008;
  const spinner = (geo, material, c, z) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(c[0], c[1], z);
    mech.add(m);
    return m;
  };
  const gear1 = spinner(gearGeo(GEARS.g1.N, MOD, GT, 5), mat.copper, GEARS.g1.c, Z_MID);
  const gear2 = spinner(gearGeo(GEARS.g2.N, MOD, GT, 4), mat.steel, GEARS.g2.c, Z_MID);
  const gear3 = spinner(gearGeo(GEARS.g3.N, MOD, GT, 0), mat.nickel, GEARS.g3.c, Z_MID);
  const gear4 = spinner(gearGeo(GEARS.g4.N, MOD, GT, 3), mat.darkSteel, GEARS.g4.c, Z_BACK);

  // улитка (кулачок) на оси малой шестерни и толкатель над ней
  const CAM_R0 = 0.017, CAM_R1 = 0.036;
  const camR = a => CAM_R0 + (CAM_R1 - CAM_R0) * (((a % TAU) + TAU) % TAU) / TAU;
  {
    const s = new THREE.Shape();
    for (let i = 0; i <= 40; i++) {
      const a = i / 40 * TAU * 0.999, r = camR(a);
      if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    s.closePath();
    const h = new THREE.Path(); h.absarc(0.019, -0.012, 0.0045, 0, TAU, true); s.holes.push(h);
    var cam = spinner(G.extrude(s, 0.007, 0.0008, 1, 8), mat.ochre, GEARS.g3.c, Z_FRONT);
  }
  const ROLL = 0.008, FOLLOW_LEN = 0.085;
  const follower = spinner(G.merge([
    G.xf(new THREE.CylinderGeometry(ROLL, ROLL, 0.008, 14), { r: [Math.PI / 2, 0, 0], p: [0, 0, 0.004] }),
    G.rod([0, ROLL * 0.5, 0.004], [0, FOLLOW_LEN, 0.004], 0.0042, 8),
    G.xf(new THREE.BoxGeometry(0.02, 0.006, 0.008), { p: [0, FOLLOW_LEN * 0.45, 0.004] }),
  ]), mat.nickel, [GEARS.g3.c[0], 0], Z_FRONT);

  // делительный диск зарядов на оси большой шестерни: шесть гнёзд, поворот на 60° на заряд
  {
    const s = new THREE.Shape();
    const R = 0.043;
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU, w = TAU / 6;
      [[a - w * 0.5, R], [a - w * 0.14, R], [a - w * 0.09, R * 0.82], [a + w * 0.09, R * 0.82], [a + w * 0.14, R]].forEach(([ang, r], k) => {
        const x = Math.cos(ang) * r, y = Math.sin(ang) * r;
        if (i === 0 && k === 0) s.moveTo(x, y); else s.lineTo(x, y);
      });
    }
    s.closePath();
    const h = new THREE.Path(); h.absarc(0, R * 0.52, R * 0.16, 0, TAU, true); s.holes.push(h);
    var indexDisc = spinner(G.extrude(s, 0.006, 0.0008, 1, 10), mat.ochre, GEARS.g1.c, Z_FRONT);
  }

  // неподвижное: задняя плита, оси и колпачки, мостик, направляющая толкателя, оправа окна, болты кожуха
  {
    const back = new THREE.Mesh(new THREE.PlaneGeometry(WW + 0.01, WH + 0.01), mat.darkSteel);
    back.position.z = 0.003;
    mech.add(back);
    const hub = (c, z, r) => G.xf(G.lathe([[r, 0], [r, z], [r, z], [r * 0.7, z + 0.004], [0, z + 0.004]], 12), { p: [c[0], c[1], 0.003] });
    const nickel = [
      hub(GEARS.g1.c, Z_FRONT + 0.006, 0.011), hub(GEARS.g2.c, Z_MID + GT, 0.01), hub(GEARS.g3.c, Z_FRONT + 0.007, 0.008),
      hub(GEARS.g4.c, Z_BACK + GT, 0.012),
    ];
    // оправа окна на лице кожуха, с винтами
    const bz = HD - 0.002;
    nickel.push(G.xf(G.slab(WW + 0.05, WH + 0.05, 0.012, { r: 0.034, bevel: 0.004, segs: 2, curve: 5, hole: rrPath(WW, WH, 0.02) }), { p: [0, 0, bz] }));
    for (const sx of [-1, 0, 1]) for (const sy of [-1, 1]) nickel.push(G.xf(G.hexGeometry(0.0065, 0.004), { p: [sx * (WW / 2 - 0.02), sy * (WH / 2 + 0.0125), bz + 0.012] }));
    for (const sx of [-1, 1]) nickel.push(G.xf(G.hexGeometry(0.0065, 0.004), { p: [sx * (WW / 2 + 0.0125), 0, bz + 0.012] }));
    // болты по углам кожуха
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) nickel.push(G.xf(G.hexGeometry(0.009, 0.006), { p: [sx * (HW / 2 - 0.028), sy * (HH / 2 - 0.028) - WY, HD] }));
    const nm = new THREE.Mesh(G.merge(nickel), mat.nickel);
    mech.add(nm);
    // стальной мостик через ось средней шестерни и направляющая толкателя
    const gx = GEARS.g3.c[0];
    const steel = [
      G.rod([-WW / 2 + 0.012, WH / 2 - 0.02, Z_FRONT + 0.004], [GEARS.g2.c[0], GEARS.g2.c[1], Z_FRONT + 0.004], 0.006, 6),
      G.xf(new THREE.BoxGeometry(0.03, 0.018, 0.016), { p: [gx, WH / 2 - 0.026, Z_FRONT + 0.004] }),
      G.xf(new THREE.BoxGeometry(0.012, 0.03, Z_FRONT), { p: [gx + 0.021, WH / 2 - 0.02, Z_FRONT / 2] }),
      G.xf(new THREE.BoxGeometry(0.012, 0.03, Z_FRONT), { p: [gx - 0.021, WH / 2 - 0.02, Z_FRONT / 2] }),
    ];
    mech.add(new THREE.Mesh(G.merge(steel), mat.steel));
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(WW + 0.004, WH + 0.004), mat.glass);
    glass.position.z = HD - 0.006;
    glass.renderOrder = 2;
    mech.add(glass);
  }
  const lampMech = ui.lamp({ color: 'amber', radius: 0.011 });
  put(mech, lampMech, -WW / 2 + 0.03, -WH / 2 + 0.03, 0.004);

  // ------------------------------------------------------------------ стол: маховик дальности и тумблер
  let resid = 0;                          // дробный остаток хода маховика (км), не попавший в округление игры
  const fine = ui.toggle({ labels: ['ГРУБО', 'ТОЧНО'], orient: 'v', value: 0, labelSize: SZ_D });
  const wheel = ui.handwheel({
    radius: 0.165, spokes: 4,
    onStart() { resid = 0; },
    onTurn(d) {
      const cp = game.state.computer;
      if (!cp) return;
      const C = game.C || {};
      const lo = C.RANGE_MIN == null ? 0.01 : C.RANGE_MIN, hi = C.RANGE_MAX == null ? 22 : C.RANGE_MAX;
      if (!(Math.abs(resid) < 0.0051)) resid = 0;
      let want = cp.range + resid + d / TAU * (fine.value ? 0.1 : 1);
      want = want < lo ? lo : want > hi ? hi : want;
      game.setComputerRange(want);                       // игра округляет до 0.01 км
      resid = want - game.state.computer.range;
    },
  });
  put(desk, wheel, -0.63, 0);
  put(desk, label('ДАЛЬНОСТЬ', SZ_D, 0.2, 'ivory'), -0.30, 0.165);
  put(desk, fine, -0.30, -0.032);

  // ------------------------------------------------------------------ стол: заряд
  const SX = 0.02, SY = 0.006;
  const selector = ui.rotarySelector({
    positions: 6, radius: 0.05, labelSize: SZ_D, value: 0,
    onChange(i) { game.setComputerCharge(i + 1); },
  });
  put(desk, selector, SX, SY);
  put(desk, label('ЗАРЯД', SZ_D), SX, SY - 0.158);
  // шесть двухцветных ламп вокруг галетника: зелёная — заряд достаёт, красная — нет
  const chargeLamps = [];
  {
    const r = 0.017, ringR = 0.158, step = 45 * DEG;
    const bezels = [];
    const lensG = new THREE.SphereGeometry(r * 1.04, 14, 5, 0, TAU, 0, Math.PI / 2);
    lensG.rotateX(Math.PI / 2); lensG.scale(1, 1, 0.72); lensG.translate(0, 0, r * 0.4);
    const lensMat = (c, on) => (mat.lens ? mat.lens(c, on) : mat.emissive(c, on ? 1.6 : 0.12));
    const mats = { ok: lensMat(COL.green, true), out: lensMat(COL.lampRed, true), off: lensMat(COL.green, false) };
    const glowMat = c => (mat.glowSprite ? mat.glowSprite(c, 0.8) : null);
    const glows = { ok: glowMat(COL.green), out: glowMat(COL.lampRed) };
    for (let i = 0; i < 6; i++) {
      const a = (i - 2.5) * step, x = SX + Math.sin(a) * ringR, y = SY + Math.cos(a) * ringR;
      bezels.push(G.xf(G.lathe([[r * 1.5, 0], [r * 1.5, r * 0.35], [r * 1.5, r * 0.35], [r * 1.32, r * 0.62], [r * 1.08, r * 0.66], [r * 1.02, r * 0.5]], 16), { p: [x, y, 0] }));
      const holder = new THREE.Group();
      holder.name = 'chargeLamp' + (i + 1);
      holder.position.set(x, y, 0);
      const lens = new THREE.Mesh(lensG, mats.off);
      holder.add(lens);
      let glow = null;
      if (glows.ok) {
        glow = new THREE.Sprite(glows.ok);
        glow.position.z = r * 1.3; glow.scale.setScalar(r * 7); glow.visible = false;
        holder.add(glow);
      }
      const hit = G.hitCylinder(0.046, 0.03);
      holder.add(hit);
      const n = i + 1;
      disposers.push(engine.input.add(hit, {
        onTap() { if (game.state.computer && game.state.computer.charge !== n) { audio.tick(); game.setComputerCharge(n); } },
      }));
      desk.add(holder);
      let cur = 'off';
      chargeLamps.push({
        object3D: holder,
        get state() { return cur; },
        set(s) {
          if (s === cur) return;
          cur = s;
          lens.material = mats[s] || mats.off;
          if (glow) { glow.visible = s !== 'off'; if (s !== 'off') glow.material = glows[s]; }
        },
      });
    }
    desk.add(new THREE.Mesh(G.merge(bezels), mat.nickel));
    disposers.push(() => lensG.dispose());
  }

  // ------------------------------------------------------------------ стол: таблица пределов зарядов
  const refPlate = (() => {
    const w = 0.31, h = 0.35;
    const ppm = Math.min(1500, 512 / h), cw = Math.round(w * ppm), ch = Math.round(h * ppm);
    const cv = T.makeCanvas(cw, ch), c2 = cv.getContext('2d');
    c2.fillStyle = COL.plate; c2.fillRect(0, 0, cw, ch);
    const gr = c2.createLinearGradient(0, 0, 0, ch);
    gr.addColorStop(0, 'rgba(255,255,255,0.09)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.18)');
    c2.fillStyle = gr; c2.fillRect(0, 0, cw, ch);
    const line = 'rgba(232,224,200,0.55)';
    c2.strokeStyle = line; c2.lineWidth = Math.max(1.5, 0.0022 * ppm);
    const ins = 0.008 * ppm;
    T.roundRectPath(c2, ins, ins, cw - ins * 2, ch - ins * 2, 0.012 * ppm); c2.stroke();
    const headH = 0.062 * ppm, colX = 0.088 * ppm;
    c2.beginPath(); c2.moveTo(ins, ins + headH); c2.lineTo(cw - ins, ins + headH);
    c2.moveTo(colX, ins); c2.lineTo(colX, ch - ins); c2.stroke();
    T.drawLabel(c2, 'ЗАРЯД', (ins + colX) / 2, ins + headH / 2, 0.0185 * ppm, { color: COL.ivory, maxWidth: colX - ins - 0.012 * ppm });
    T.drawLabel(c2, 'ДАЛЬНОСТЬ, КМ', (colX + cw - ins) / 2, ins + headH / 2, 0.021 * ppm, { color: COL.ivory, maxWidth: cw - ins - colX - 0.02 * ppm });
    const rowH = (ch - ins * 2 - headH) / 6;
    const lines = [];
    for (let n = 1; n <= 6; n++) {
      let lim = null;
      try { lim = game.chargeRange(n); } catch (e) { lim = null; }
      const y = ins + headH + rowH * (n - 0.5);
      // пределы округляем «внутрь», чтобы табличное значение гарантированно достигалось
      const txt = lim ? (Math.ceil(lim.min * 10 - 1e-9) / 10).toFixed(1) + ' – ' + (Math.floor(lim.max * 10 + 1e-9) / 10).toFixed(1) : '—';
      lines.push('ЗАРЯД ' + n + ': ' + txt + ' КМ');
      if (n > 1) {
        c2.strokeStyle = 'rgba(232,224,200,0.22)'; c2.lineWidth = Math.max(1, 0.0012 * ppm);
        c2.beginPath(); c2.moveTo(ins, y - rowH / 2); c2.lineTo(cw - ins, y - rowH / 2); c2.stroke();
      }
      T.drawLabel(c2, String(n), (ins + colX) / 2, y, 0.027 * ppm, { color: COL.ochre });
      T.drawLabel(c2, txt, (colX + cw - ins) / 2, y, 0.026 * ppm, { color: COL.ivory, maxWidth: cw - ins - colX - 0.02 * ppm });
    }
    const tex = T.canvasTexture(cv, { aniso: 8 });
    const geo = new THREE.ShapeGeometry(G.roundedRectShape(w, h, 0.014), 4);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
    const material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42, metalness: 0.35, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = 'refPlate';
    mesh.position.z = 0.0015;
    const holder = new THREE.Group();
    holder.add(mesh);
    // четыре винта по углам
    const screws = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) screws.push(G.xf(G.rivetGeometry(0.006, 6), { p: [sx * (w / 2 + 0.012), sy * (h / 2 - 0.02), 0] }));
    holder.add(new THREE.Mesh(G.merge(screws), mat.nickel));
    disposers.push(() => { tex.dispose(); material.dispose(); geo.dispose(); });
    return { object3D: holder, lines };
  })();
  put(desk, refPlate, 0.385, 0);

  // ------------------------------------------------------------------ колонна: рычаг «ВЫЧИСЛИТЬ»
  let denyT = 0;
  const lever = ui.lever({
    mode: 'momentary', length: 0.24, color: COL.ochre, labels: ['ВЫЧИСЛИТЬ'], labelSize: SZ_D,
    onPull() {
      const res = game.compute();                         // отказ → событие 'denied' (оболочка покажет причину)
      if (!res || !res.ok) denyT = 1.6;
    },
  });
  put(tower, lever, TX, 1.19);
  const lampBusy = put(tower, ui.lamp({ color: 'amber', radius: 0.02 }), TX, 1.487);
  put(tower, label('СЧЁТ', 0.024), TX, 1.432);
  {
    // жалюзи внизу колонны
    const slots = [];
    for (let i = 0; i < 5; i++) slots.push(G.xf(G.slab(0.19, 0.014, 0.004, { r: 0.006, bevel: 0.001 }), { p: [TX, 0.835 + i * 0.03, 0] }));
    tower.add(new THREE.Mesh(G.merge(slots), mat.rubber));
  }

  // ------------------------------------------------------------------ декор за пультом
  {
    const top = CY + 0.06;
    const copper = G.merge([
      G.pipeGeometry([[-0.62, top, -0.3], [-0.62, 2.18, -0.3], [-0.62, 2.18, -0.93]], 0.032),
      G.pipeGeometry([[-0.5, top, -0.38], [-0.5, 1.95, -0.38], [0.2, 1.95, -0.38], [0.2, 1.95, -0.93]], 0.02),
    ]);
    group.add(new THREE.Mesh(copper, mat.copper));
    // сельсин-двигатель на крыше шкафа и стальной кабелепровод к колонне
    const motor = G.lathe([[0.03, -0.24], [0.1, -0.24], [0.1, -0.2], [0.115, -0.2], [0.115, 0.12], [0.1, 0.12], [0.1, 0.17], [0.06, 0.2], [0.03, 0.2], [0.03, 0.26], [0, 0.26]], 18);
    motor.rotateY(Math.PI / 2);
    motor.translate(0.02, top + 0.118, -0.3);
    const feet = G.xf(new THREE.BoxGeometry(0.3, 0.03, 0.2), { p: [0.02, top + 0.012, -0.3] });
    const duct = G.pipeGeometry([[0.3, top + 0.118, -0.3], [0.52, top + 0.118, -0.3], [TX, top + 0.118, -0.3], [TX, 1.62, -0.3]], 0.022, { flanges: false });
    const steelDecor = G.merge([motor, feet, duct,
      G.pipeGeometry([[TX + 0.06, 1.62, -0.36], [TX + 0.06, 2.3, -0.36], [TX + 0.06, 2.3, -0.93]], 0.026)]);
    group.add(new THREE.Mesh(steelDecor, mat.darkSteel));
    group.add(ui.cable([[-0.25, top, -0.42], [-0.22, 1.82, -0.5], [-0.3, 2.05, -0.75], [-0.28, 2.1, -0.93]], { radius: 0.012 }).object3D);
  }

  // ------------------------------------------------------------------ состояние отображения
  let lastCp = null;                      // только для сравнения «объект состояния заменён» (новое задание)
  let animT = 0, spin = 0, spinFrom = 0, spinTo = 0, clickT = 0;
  let gearRange = 0, discAngle = 0, lastRange = NaN, states = null;
  let active = false;

  const offComputed = game.on('computed', () => {
    // расчёт выполнен: показываем работу механизма, только если игрок у поста
    if (!active || !group.visible) { animT = 0; return; }
    animT = SPIN_TIME; spinFrom = spin; spinTo = spin + TAU * SPIN_TURNS; clickT = 0;
  });
  disposers.push(offComputed);

  function update(dt) {
    const s = game.state;
    const cp = s && s.computer;
    if (!cp) return;
    const fresh = cp !== lastCp;
    if (fresh) { lastCp = cp; animT = 0; denyT = 0; lastRange = NaN; resid = 0; }
    if (denyT > 0) denyT = Math.max(0, denyT - dt);

    // --- «счёт» ---
    let computing = animT > 0;
    if (computing) {
      animT = Math.max(0, animT - dt);
      const k = 1 - animT / SPIN_TIME, e = k * k * (3 - 2 * k);
      spin = spinFrom + (spinTo - spinFrom) * e;
      clickT -= dt;
      if (clickT <= 0) { audio.ratchet(); clickT = 0.06 + 0.12 * Math.abs(k - 0.5); }
      if (animT === 0) { computing = false; audio.clunk(); }
    }

    // --- входы ---
    cRange.setValue(cp.range, { instant: fresh });
    if (selector.value !== cp.charge - 1 && !engine.input.busy) selector.set(cp.charge - 1);
    if (cp.range !== lastRange || !states) {
      lastRange = cp.range;
      states = game.chargeStates();
      for (let i = 0; i < 6; i++) chargeLamps[i].set(states[i] === 'ok' ? 'ok' : 'out');
    }
    const out = states[cp.charge - 1] !== 'ok';

    // --- результат ---
    const has = cp.elevation != null;
    if (!computing) {
      cElev.setValue(has ? cp.elevation : 0, { instant: fresh });
      cTof.setValue(has ? cp.tof : 0, { instant: fresh });
      shElev.set(!has, fresh); shTof.set(!has, fresh);
    }
    shElev.update(dt); shTof.update(dt);
    lampReady.set(has && !cp.stale && !computing);
    lampStale.set(has && !!cp.stale && !computing);
    lampOut.set(out ? (denyT > 0 ? 'blink' : true) : false);
    lampBusy.set(computing);
    lampMech.set(computing);

    // --- репитер замера с планшета ---
    const rec = s.plot && s.plot.recorded && s.activeTarget != null ? s.plot.recorded[s.activeTarget] : null;
    const hasRec = !!rec && typeof rec.range === 'number';
    cRepeat.setValue(hasRec ? rec.range : 0, { instant: fresh || (hasRec && shRepeat.closed) });
    shRepeat.set(!hasRec, fresh);
    shRepeat.update(dt);

    // --- механизм: ведущая шестерня следует за дальностью, диск — за зарядом ---
    const kk = fresh ? 1 : 1 - Math.exp(-dt * 12);
    gearRange += (cp.range - gearRange) * kk;
    discAngle += ((cp.charge - 1) * TAU / 6 - discAngle) * kk;
    const N1 = GEARS.g1.N, N2 = GEARS.g2.N, N3 = GEARS.g3.N;
    const t1 = gearRange * Math.PI * 0.5 + spin;
    const t2 = PHI12 + Math.PI - Math.PI / N2 - (N1 / N2) * (t1 - PHI12);
    const t3 = PHI23 + Math.PI - Math.PI / N3 - (N2 / N3) * (t2 - PHI23);
    gear1.rotation.z = t1; gear2.rotation.z = t2; gear3.rotation.z = t3;
    gear4.rotation.z = -t1 * 0.8 + 0.3;
    cam.rotation.z = t3;
    indexDisc.rotation.z = -discAngle - spin * 0.5;
    follower.position.y = GEARS.g3.c[1] + camR(Math.PI / 2 - t3) + ROLL;
  }

  const station = {
    id: 'computer',
    title: 'ВЫЧИСЛИТЕЛЬ',
    group,
    camera: { position: [0, 1.46, 1.32], target: [0, 1.116, 0], fov: 46 },
    update,
    onEnter() { active = true; },
    onLeave() { active = false; animT = 0; denyT = 0; },
    hotspots: {
      // органы управления
      rangeWheel: wheel.wheel || wheel.object3D,
      fineToggle: fine.object3D,
      chargeSelector: selector.object3D,
      chargeLamp1: chargeLamps[0].object3D, chargeLamp2: chargeLamps[1].object3D, chargeLamp3: chargeLamps[2].object3D,
      chargeLamp4: chargeLamps[3].object3D, chargeLamp5: chargeLamps[4].object3D, chargeLamp6: chargeLamps[5].object3D,
      computeLever: lever.handle || lever.object3D,
      // приборы (для подсказок обучения)
      rangeCounter: cRange.object3D,
      repeaterCounter: cRepeat.object3D,
      elevationCounter: cElev.object3D,
      tofCounter: cTof.object3D,
      lampReady: lampReady.object3D, lampStale: lampStale.object3D, lampOut: lampOut.object3D,
      refPlate: refPlate.object3D,
      gearWindow: mech,
    },
    /** Органы и приборы поста (для отладки и тестов; игровой логики здесь нет). */
    controls: {
      wheel, fine, selector, lever, chargeLamps, cRange, cRepeat, cElev, cTof, lampReady, lampStale, lampOut, lampBusy, lampMech,
      shutters: { elevation: shElev, tof: shTof, repeater: shRepeat },
      refLines: refPlate.lines,
      get computing() { return animT > 0; },
    },
    dispose() {
      disposers.forEach(d => { try { d(); } catch (e) { /* уже снято */ } });
      disposers.length = 0;
      [wheel, fine, selector, lever, cRange, cRepeat, cElev, cTof, lampReady, lampStale, lampOut, lampBusy, lampMech].forEach(c => c.dispose && c.dispose());
      group.removeFromParent();
    },
  };
  return station;
}
