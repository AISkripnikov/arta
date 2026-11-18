// Механика поста «ЗАРЯЖАНИЕ»: казённая часть орудия (качается вокруг цапф, откатывается), поршневой затвор,
// лоток с досылателем, снарядный элеватор, зарядный лоток-подъёмник, снаряды, картузы, дымка.
// Здесь только геометрия и ссылки на подвижные узлы — логика анимаций в loading.js.
//
// Система «F» (в ней собраны орудие и механизмы заряжания): начало — центр казённого среза при угле 0°,
// +Z — к игроку (назад от ствола), канал ствола уходит в −Z.

const DEG = Math.PI / 180;

export const GUN = {
  X: -0.5, Y: 1.06, ZB: -0.42,      // центр казённого среза в координатах поста
  TRUNNION: 2.5,                    // ось цапф — на столько впереди (−Z) казённого среза
  RING_R: 0.35, RING_LEN: 0.34, JACKET_R: 0.27, CHAMBER_R: 0.165,
  HINGE_X: -0.30, HINGE_Z: 0.03, SWING: 95 * DEG, UNLOCK: 60 * DEG,
  SHELL_R: 0.115, SHELL_LEN: 0.62,
  SHELL_TRAY_Z: 0.68,               // z донца снаряда, лежащего на лотке
  SHELL_SEAT_Z: -0.30,              // z донца досланного снаряда
  CAR_X: 0.29, CAR_DOWN: 1.25,      // снарядный элеватор: смещение люльки от оси лотка и ход вниз
  TRAY_DROP: 0.38,                  // лоток опущен, когда затвор закрыт (чтобы не мешать откату)
  BAG_R: 0.105, BAG_LEN: 0.14, BAG_X: -0.28, BAG_Z: 0.615, BAG_SINK: 0.36,
  HEAD_REST: 0.695, HOUSING_Z: 0.71,
  RECOIL: 0.4,
};

/** Глубина (z центра) картуза № n (1…6) в каморе. */
export function bagSeatZ(n) { return -(0.26 - 0.04 * n) - GUN.BAG_LEN / 2; }

export function buildLoadingGun(ctx, root) {
  const { engine, THREE, ui, mat } = ctx;
  const G = engine.geom, T = engine.textures, PAL = mat.PALETTE, K = GUN;
  const RR = K.RING_R, RL = K.RING_LEN, JR = K.JACKET_R, CH = K.CHAMBER_R;

  const paint = mat.paint(PAL.panel, { wear: 0.7 });
  const dark = mat.paint(PAL.panelDark, { wear: 0.8 });
  const black = mat.emissive('#020303', 1);
  const chamberMat = mat.memo('loading:chamber', () => new THREE.MeshStandardMaterial({ color: 0x15181b, roughness: 0.55, metalness: 0.7 }));

  // ---------------------------------------------------------------- помощники
  const box = (w, h, d, x = 0, y = 0, z = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };
  const cylZ = (r, z0, z1, x = 0, y = 0, seg = 20) => {
    const g = new THREE.CylinderGeometry(r, r, Math.abs(z1 - z0), seg); g.rotateX(Math.PI / 2); g.translate(x, y, (z0 + z1) / 2); return g;
  };
  const cylY = (r, y0, y1, x = 0, z = 0, seg = 16) => { const g = new THREE.CylinderGeometry(r, r, Math.abs(y1 - y0), seg); g.translate(x, (y0 + y1) / 2, z); return g; };
  const flip = (g) => {                      // вывернуть наизнанку (видно изнутри)
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i]; idx[i] = idx[i + 1]; idx[i + 1] = t; }
    const n = g.attributes.normal.array;
    for (let i = 0; i < n.length; i++) n[i] = -n[i];
    return g;
  };
  const sector = (r, z0, z1, a0, len, inward = false) => {      // сектор цилиндрической поверхности вокруг оси Z
    const g = new THREE.CylinderGeometry(r, r, Math.abs(z1 - z0), Math.max(4, Math.round(len / (10 * DEG))), 1, true, a0, len);
    if (inward) flip(g);
    g.rotateX(Math.PI / 2); g.translate(0, 0, (z0 + z1) / 2);
    return g;
  };
  const trough = (rIn, rOut, a0, a1, z0, z1) => {               // жёлоб: дуга a0…a1 (рад), вытянутая вдоль Z
    const s = new THREE.Shape();
    s.absarc(0, 0, rOut, a0, a1, false); s.absarc(0, 0, rIn, a1, a0, true); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: z1 - z0, bevelEnabled: false, curveSegments: 14 });
    g.translate(0, 0, z0);
    return g;
  };
  const rotZ = (g, a) => { g.rotateZ(a); return g; };
  const bucket = () => {
    const map = new Map();
    return {
      add(material, g) { let l = map.get(material); if (!l) map.set(material, l = []); l.push(g); return g; },
      flush(parent) {
        map.forEach((list, material) => { const m = new THREE.Mesh(G.boxUV(G.merge(list), mat.WEAR_REPEAT), material); m.name = 'static'; parent.add(m); });
        map.clear();
      },
    };
  };

  // ---------------------------------------------------------------- иерархия
  const P = [K.X, K.Y, K.ZB - K.TRUNNION];
  const gunPivot = new THREE.Group(); gunPivot.name = 'gunPivot'; gunPivot.position.set(P[0], P[1], P[2]);
  const cradle = new THREE.Group(); cradle.position.z = K.TRUNNION; gunPivot.add(cradle);
  const recoil = new THREE.Group(); recoil.name = 'recoil'; cradle.add(recoil);
  const loadPivot = new THREE.Group(); loadPivot.name = 'loadPivot'; loadPivot.position.set(P[0], P[1], P[2]);
  const loader = new THREE.Group(); loader.position.z = K.TRUNNION; loadPivot.add(loader);
  root.add(gunPivot, loadPivot);

  // ---------------------------------------------------------------- откатные части: казённик, кожух, камора
  const rb = bucket();
  rb.add(paint, G.lathe([[JR, -RL], [RR, -RL], [RR, -RL], [RR, -0.07], [RR, -0.07], [RR + 0.012, -0.062], [RR + 0.012, -0.012], [RR, 0], [RR, 0], [0.3, 0]], 40));
  rb.add(mat.steel, G.lathe([[JR, -1.5], [JR, -RL]], 32));                                     // полированная труба — видна при откате
  rb.add(mat.steel, G.lathe([[0.302, -0.001], [0.302, 0.004], [0.302, 0.004], [CH + 0.006, 0.004], [CH + 0.006, 0.004], [CH, -0.002]], 40));
  for (let i = 0; i < 3; i++) rb.add(mat.steel, sector(CH - 0.005, -0.15, -0.015, (20 + i * 120) * DEG, 60 * DEG, true));   // секторы нарезки каморы
  for (let i = 0; i < 12; i++) {                                                               // болты казённого среза
    const a = (15 + i * 30) * DEG;
    if (Math.abs(a - Math.PI) < 20 * DEG) continue;                                            // под рамой затвора
    rb.add(mat.darkSteel, G.xf(G.hexGeometry(0.017, 0.012), { p: [Math.cos(a) * 0.262, Math.sin(a) * 0.262, 0.004] }));
  }
  for (const sy of [-1, 1]) rb.add(mat.steel, box(0.075, 0.05, 0.07, K.HINGE_X, sy * 0.155, K.HINGE_Z));    // проушины петли
  rb.add(mat.steel, cylY(0.018, -0.2, 0.2, K.HINGE_X, K.HINGE_Z, 10));
  rb.add(paint, box(0.46, 0.09, 0.08, 0, 0.385, -0.1));                                        // прилив для штоков тормоза отката
  for (const sx of [-1, 1]) rb.add(mat.nickel, cylZ(0.02, -1.35, -0.1, sx * 0.16, 0.43, 10));
  rb.flush(recoil);
  const chamber = new THREE.Mesh(G.lathe([[CH, 0], [CH, -0.62], [CH, -0.62], [0.125, -0.66], [0.125, -1.3], [0.125, -1.3], [0, -1.3]], 32), chamberMat);
  chamber.name = 'chamber';
  recoil.add(chamber);

  // ---------------------------------------------------------------- люлька (не откатывается): муфта, цилиндры тормоза отката
  const cb = bucket();
  cb.add(dark, G.lathe([[0.305, -1.4], [0.305, -RL - 0.03], [0.305, -RL - 0.03], [0.318, -RL - 0.025], [0.318, -RL - 0.006], [JR + 0.004, -RL - 0.006]], 36));
  for (const sx of [-1, 1]) {
    cb.add(dark, cylZ(0.058, -1.4, -0.46, sx * 0.16, 0.43, 16));
    cb.add(mat.steel, cylZ(0.066, -0.49, -0.445, sx * 0.16, 0.43, 16));
  }
  cb.flush(cradle);

  // ---------------------------------------------------------------- затвор: рама на петле + поворотный поршень
  const hinge = new THREE.Group(); hinge.name = 'breechHinge'; hinge.position.set(K.HINGE_X, 0, K.HINGE_Z);
  recoil.add(hinge);
  const BX = -K.HINGE_X, FZ = 0.004 - K.HINGE_Z;            // центр поршня и плоскость среза в системе петли
  const hb = bucket();
  hb.add(dark, cylZ(0.19, FZ, FZ + 0.048, BX, 0, 28));
  hb.add(dark, box(BX, 0.15, 0.04, BX / 2, 0, FZ + 0.024));
  hb.add(dark, cylY(0.036, -0.125, 0.125, 0, 0, 12));
  hb.flush(hinge);
  const rotor = new THREE.Group(); rotor.name = 'breechRotor'; rotor.position.set(BX, 0, FZ);
  hinge.add(rotor);
  const ob = bucket();
  ob.add(mat.darkSteel, cylZ(0.15, -0.11, 0, 0, 0, 24));
  for (let i = 0; i < 3; i++) ob.add(mat.steel, sector(0.158, -0.1, -0.01, (80 + i * 120) * DEG, 60 * DEG));
  ob.add(mat.steel, G.lathe([[0.112, 0.048], [0.112, 0.062], [0.112, 0.062], [0.05, 0.068], [0.05, 0.068], [0.05, 0.092], [0.044, 0.097], [0, 0.097]], 24));
  const A0 = -35 * DEG;                                      // рукоять затвора в закрытом положении
  ob.add(mat.steel, rotZ(box(0.2, 0.03, 0.016, 0.1, 0, 0.078), A0));
  ob.add(mat.ochre, rotZ(cylZ(0.018, 0.086, 0.165, 0.185, 0, 12), A0));
  { const s = new THREE.SphereGeometry(0.026, 12, 8); s.translate(0.185, 0, 0.17); ob.add(mat.ochre, rotZ(s, A0)); }
  ob.flush(rotor);

  // ---------------------------------------------------------------- лоток с досылателем (поднимается к оси канала)
  const tray = new THREE.Group(); tray.name = 'tray';
  loader.add(tray);
  const tb = bucket();
  tb.add(mat.steel, trough(0.12, 0.15, 205 * DEG, 335 * DEG, 0.05, K.HEAD_REST));
  tb.add(mat.steel, cylY(0.05, -1.75, -0.22, 0, 0.39, 16));                                    // гидравлическая колонна
  tb.add(dark, box(0.11, 0.075, 0.58, 0, -0.185, 0.39));
  tb.add(paint, box(0.21, 0.13, 0.055, 0, -0.2, K.HOUSING_Z + 0.0275));                        // коробка досылателя (ниже оси — не заслоняет снаряд)
  tb.add(dark, box(0.05, 0.1, 0.03, 0, -0.1, K.HOUSING_Z + 0.04));
  tb.flush(tray);
  const ramHead = new THREE.Mesh(G.boxUV(G.merge([cylZ(0.088, 0, 0.03, 0, 0, 20), cylZ(0.04, 0.03, 0.05, 0, 0, 12)]), mat.WEAR_REPEAT), mat.steel);
  ramHead.name = 'ramHead'; ramHead.position.z = K.HEAD_REST;
  const ramRodG = new THREE.BoxGeometry(0.05, 0.04, 1); ramRodG.translate(0, 0, 0.5);
  const ramRod = new THREE.Mesh(ramRodG, mat.darkSteel);
  ramRod.name = 'ramRod'; ramRod.visible = false;
  tray.add(ramHead, ramRod);

  // ---------------------------------------------------------------- снарядный элеватор: люлька на штоке
  const car = new THREE.Group(); car.name = 'shellCar'; car.position.set(K.CAR_X, -K.CAR_DOWN, 0); car.visible = false;
  loader.add(car);
  car.add(new THREE.Mesh(G.boxUV(G.merge([
    trough(0.12, 0.145, 210 * DEG, 330 * DEG, 0.12, 0.64),
    box(0.14, 0.06, 0.34, 0, -0.17, 0.38),
    cylY(0.045, -1.9, -0.2, 0, 0.38, 14),
  ]), mat.WEAR_REPEAT), mat.steel));

  // ---------------------------------------------------------------- зарядный подъёмник (короб слева от лотка)
  const lb = bucket();
  lb.add(dark, box(0.25, 1.5, 0.17, K.BAG_X, -0.125 - 0.75, K.BAG_Z));
  lb.add(mat.steel, box(0.275, 0.025, 0.195, K.BAG_X, -0.1375, K.BAG_Z));
  { const g = new THREE.PlaneGeometry(0.215, 0.135); g.rotateX(-Math.PI / 2); g.translate(K.BAG_X, -0.1245, K.BAG_Z); lb.add(black, g); }
  lb.flush(loader);
  const chutePlate = ui.plate('ЗАРЯДЫ', { size: 0.026, screws: false });
  chutePlate.object3D.position.set(K.BAG_X, -0.21, K.BAG_Z + 0.086);
  loader.add(chutePlate.object3D);

  // ---------------------------------------------------------------- снаряд
  function shellGeometry() {
    const R = K.SHELL_R, L = K.SHELL_LEN, body = 0.37, Ln = L - body, rho = (R * R + Ln * Ln) / (2 * R);
    const pts = [[0, 0], [R - 0.02, 0], [R, 0.022], [R, 0.022], [R, body]];
    for (let i = 1; i <= 9; i++) { const z = Ln * Math.min(i / 9, 0.965); pts.push([Math.sqrt(rho * rho - z * z) - (rho - R), body + z]); }
    pts.push([0, L - 0.004]);
    const g = G.lathe(pts, 28);
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setY(i, pos.getZ(i) / L);
    g.rotateY(Math.PI);                                       // носом в −Z, донце в начале координат
    return g;
  }
  function shellMaterial(type) {
    return mat.memo('loading:shell:' + type, () => {
      const S = 256, cv = T.makeCanvas(S, S), c = cv.getContext('2d'), rnd = T.mulberry32(type === 'he' ? 11 : 23);
      const Y = (v) => S * (1 - v);                           // v — доля длины от донца
      const band = (v0, v1, col) => { c.fillStyle = col; c.fillRect(0, Y(v1), S, Y(v0) - Y(v1)); };
      c.fillStyle = '#6f777e'; c.fillRect(0, 0, S, S);
      for (let i = 0; i < 90; i++) { c.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)'; c.fillRect(0, rnd() * S, S, 1 + rnd() * 2); }
      band(0, 0.03, '#4f565c');                               // донце
      band(0.07, 0.115, '#a8653a');                           // ведущий поясок
      band(0.118, 0.124, 'rgba(0,0,0,0.35)');
      if (type === 'he') { band(0.63, 0.715, PAL.ochre); band(0.93, 1, '#c5c9cc'); }
      else { band(0.7, 1, '#141517'); band(0.6, 0.66, '#e9e4d2'); }
      for (let k = 0; k < 3; k++) {                           // трафарет вдоль оси снаряда, трижды по окружности
        c.save(); c.translate(S * (k + 0.5) / 3, Y(0.36)); c.rotate(Math.PI / 2);
        T.drawLabel(c, type === 'he' ? 'ОФ' : 'ББ', 0, 0, 30, { color: '#e9e4d2', weight: 700 });
        c.restore();
      }
      return new THREE.MeshStandardMaterial({ map: T.canvasTexture(cv), roughness: 0.5, metalness: 0.35 });
    });
  }
  const shellMats = { he: shellMaterial('he'), ap: shellMaterial('ap') };
  const shell = new THREE.Mesh(shellGeometry(), shellMats.he);
  shell.name = 'shell'; shell.visible = false;
  loader.add(shell);

  // ---------------------------------------------------------------- картузы
  const bagG = (() => {
    const R = K.BAG_R, L = K.BAG_LEN;
    const g = G.lathe([[0, 0], [R - 0.022, 0], [R, 0.02], [R + 0.003, L / 2], [R, L - 0.02], [R - 0.022, L], [0, L]], 20);
    g.translate(0, 0, -L / 2);
    return g;
  })();
  const bagMat = mat.memo('loading:bag', () => {
    const cv = T.makeCanvas(64, 128), c = cv.getContext('2d'), rnd = T.mulberry32(5);
    c.fillStyle = '#b3a888'; c.fillRect(0, 0, 64, 128);
    for (let i = 0; i < 260; i++) { c.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(90,70,40,0.10)'; c.fillRect(rnd() * 64, rnd() * 128, 1 + rnd() * 3, 1); }
    c.fillStyle = '#2a2521'; c.fillRect(0, 128 * 0.43, 64, 128 * 0.14);                       // тёмный пояс
    c.fillStyle = 'rgba(70,55,30,0.55)'; c.fillRect(0, 128 * 0.345, 64, 2); c.fillRect(0, 128 * 0.655, 64, 2);   // швы
    return new THREE.MeshStandardMaterial({ map: T.canvasTexture(cv), roughness: 0.92, metalness: 0 });
  });
  const bags = [];
  for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(bagG, bagMat); m.name = 'bag' + i; m.visible = false; loader.add(m); bags.push(m); }

  // ---------------------------------------------------------------- дымка после выстрела
  const puffMat = new THREE.SpriteMaterial({ map: mat.glowTexture, color: 0xb3ada0, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const puffs = [];
  for (let i = 0; i < 3; i++) { const s = new THREE.Sprite(puffMat); s.visible = false; root.add(s); puffs.push(s); }

  // ---------------------------------------------------------------- неподвижное: колодец, переборка с амбразурой
  const fb = bucket();
  { const g = new THREE.PlaneGeometry(0.86, 1.14); g.rotateX(-Math.PI / 2); g.translate(-0.47, 0.006, -0.23); fb.add(black, g); }
  { const g = new THREE.PlaneGeometry(0.82, 1.66); g.translate(K.X, 0.83, -0.846); fb.add(black, g); }
  fb.add(dark, box(0.9, 0.05, 0.03, -0.47, 0.025, 0.325));                                     // комингс колодца
  fb.add(dark, box(0.03, 0.05, 1.14, -0.905, 0.025, -0.23));
  fb.add(dark, box(0.03, 0.05, 1.14, -0.035, 0.025, -0.23));
  {
    const SW = 0.39, SY = 1.22;                                                                // амбразура: полуширина, высота прямой части
    const sh = new THREE.Shape();
    sh.moveTo(-0.9, 0); sh.lineTo(0.9, 0); sh.lineTo(0.9, 2.0); sh.lineTo(-0.9, 2.0); sh.closePath();
    const hole = new THREE.Path();
    hole.moveTo(K.X - SW, 0.0); hole.lineTo(K.X - SW, SY); hole.absarc(K.X, SY, SW, Math.PI, 0, true); hole.lineTo(K.X + SW, 0.0); hole.closePath();
    sh.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: false, curveSegments: 16 });
    g.translate(0, 0, -0.84);
    fb.add(dark, g);
    for (const sx of [-1, 1]) {                                                                // окантовка амбразуры
      if (sx > 0) fb.add(mat.steel, box(0.03, SY, 0.012, K.X + sx * (SW + 0.02), SY / 2, -0.794));
      for (let y = 0.12; y < SY; y += 0.11) if (sx > 0) fb.add(mat.steel, G.xf(G.rivetGeometry(0.008), { p: [K.X + sx * (SW + 0.02), y, -0.788] }));
    }
    for (let i = 1; i < 12; i++) {
      const a = Math.PI * i / 12;
      fb.add(mat.steel, G.xf(G.rivetGeometry(0.009), { p: [K.X + Math.cos(a) * (SW + 0.03), SY + Math.sin(a) * (SW + 0.03), -0.8] }));
    }
  }
  fb.flush(root);

  return {
    K, gunPivot, loadPivot, cradle, recoil, loader, hinge, rotor, chamber, tray, ramHead, ramRod, car, shell, shellMats, bags, puffs, puffMat, chutePlate,
    dispose() { puffMat.dispose(); chutePlate.dispose(); },
  };
}
