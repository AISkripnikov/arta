// Пост «НАБЛЮДЕНИЕ» (id 'observe'): стереотруба-дальномер. В окуляре — море по пеленгу трубы: корабли (ships.js),
// кильватерные следы, всплески своих снарядов, вспышки чужих орудий, «люстры», дымзавесы, самолёты налёта, свои.
// Отдельная маленькая сцена рисуется в текстуру 512×512 и показывается на круглом «стекле» под сеткой
// (деления через 0,5°). Сцена обновляется и рисуется ТОЛЬКО пока пост текущий (≤ ~30 раз/с).
// Пост ничего не решает сам: показывает game.state.scope и вызывает game.setScope()/game.scopeMark().
//
// hotspots: scopeWheel (маховик пеленга), zoomLever (кратность ×4/×10), markButton (= scopeMarkBtn, «ЗАСЕЧЬ ПЕЛЕНГ»),
//           toTargetButton («НА ЦЕЛЬ»), eyepiece (стекло окуляра: его можно тащить пальцем — труба поворачивается;
//           касание — придвинуться к окуляру / отодвинуться).
import { createFleet, createAirWing, blobTexture } from './ships.js';
import { skyFor, createLandProfile, hash, wrap180, clamp } from './fire-slit.js';

const DEG = Math.PI / 180;
const RT = 512;                // текстура окуляра
const EYE = 40;                // высота трубы над морем, м
const EX = 2.2;                // корабли в трубе чуть крупнее натуры — чтобы читался силуэт на экране телефона
const PITCH = -0.22 * DEG;     // труба чуть опущена: горизонт немного выше центра сетки
const SKY_R = 46000, SKY_LO = -3000, SKY_HI = 11000;
const norm360 = (a) => ((a % 360) + 360) % 360;

// ---------- сцена за окуляром ----------
function createScopeView(ctx) {
  const { engine, THREE, game } = ctx;
  const T = engine.textures;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(16, 1, 30, 70000);
  cam.rotation.order = 'YXZ';
  cam.position.set(0, EYE, 0);
  const rt = new THREE.WebGLRenderTarget(RT, RT, { depthBuffer: true, samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const hemi = new THREE.HemisphereLight(0xffffff, 0x3a464e, 2.6), sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
  sun.position.set(-0.4, 1, 0.5);
  scene.add(hemi, sun);
  scene.fog = new THREE.Fog(0xffffff, 3000, 60000);
  scene.background = new THREE.Color(0x808080);
  const own = [rt];              // всё, что надо освободить
  const land = createLandProfile(game);
  const info = { renders: 0, ships: 0, planes: 0, splashes: 0, flares: 0, smokes: 0, flashes: 0, inView: false, mode: '', bearing: 0, fov: 16 };

  // небо: пояс вокруг трубы с градиентом и облаками (текстура перерисовывается при смене погоды/времени суток)
  const skyCv = T.makeCanvas(512, 128), skyTex = T.canvasTexture(skyCv, { aniso: 1, mipmaps: false });
  skyTex.wrapS = THREE.RepeatWrapping; skyTex.repeat.set(6, 1);
  const skyGeo = new THREE.CylinderGeometry(SKY_R, SKY_R, SKY_HI - SKY_LO, 48, 1, true);
  skyGeo.translate(0, (SKY_HI + SKY_LO) / 2, 0);
  const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -3;
  scene.add(sky);
  // звёзды
  const starP = [];
  for (let i = 0; i < 420; i++) {
    const a = hash(i) * Math.PI * 2, el = (0.3 + hash(i + 500) * 12.5) * DEG, r = SKY_R * 0.96;
    starP.push(Math.sin(a) * r * Math.cos(el), r * Math.sin(el), -Math.cos(a) * r * Math.cos(el));
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starP, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xd8e2ff, size: 1.7, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.9, depthWrite: false });
  const stars = new THREE.Points(starGeo, starMat);
  stars.renderOrder = -2; stars.frustumCulled = false;
  scene.add(stars);
  // море: большой диск с мелкой текстурой зыби
  const seaCv = T.makeCanvas(128, 128);
  {
    const c = seaCv.getContext('2d');
    c.fillStyle = '#c4c4c4'; c.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 90; i++) {
      const x = hash(i + 3) * 128, y = hash(i + 71) * 128, w = 8 + hash(i + 19) * 26, lightStreak = hash(i + 5) > 0.45;
      c.fillStyle = lightStreak ? `rgba(255,255,255,${(0.25 + 0.5 * hash(i + 9)).toFixed(2)})` : `rgba(60,70,80,${(0.2 + 0.3 * hash(i + 11)).toFixed(2)})`;
      for (const ox of [0, -128, 128]) { c.beginPath(); c.ellipse(x + ox, y, w, 1.1 + hash(i + 31) * 1.6, 0, 0, 7); c.fill(); }
    }
  }
  const seaTex = T.canvasTexture(seaCv, { repeat: true, aniso: 8, mipmaps: true });
  seaTex.repeat.set(SKY_R * 2 / 90, SKY_R * 2 / 260);
  const seaGeo = new THREE.CircleGeometry(SKY_R, 40);
  seaGeo.rotateX(-Math.PI / 2);
  const seaMat = new THREE.MeshBasicMaterial({ map: seaTex, color: 0x4a6478 });
  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.renderOrder = -1;
  scene.add(sea);
  own.push(skyTex, skyGeo, skyMat, starGeo, starMat, seaTex, seaGeo, seaMat);

  // суша: «занавес» по ближней кромке берега с плоской крышей за ним (камера в центре — радиальных щелей не видно)
  const landMat = new THREE.MeshLambertMaterial({ color: 0x3d4a3f, side: THREE.DoubleSide });
  let landMesh = null, landFor = null, landH = null;
  own.push(landMat);
  function buildLand() {
    const m = game.state.mission;
    if (!m || landFor === m.map) return;
    landFor = m.map;
    if (landMesh) { scene.remove(landMesh); landMesh.geometry.dispose(); landMesh = null; }
    const lm = land();
    if (!lm) return;
    landH = landH || new Float32Array(360);
    const p = [];
    const pt = (a, d, h) => { p.push(Math.sin(a * DEG) * d, h, -Math.cos(a * DEG) * d); };
    const quad = (a0, d0, h0, a1, d1, h1) => {
      pt(a0, d0, 0); pt(a1, d1, 0); pt(a1, d1, h1); pt(a0, d0, 0); pt(a1, d1, h1); pt(a0, d0, h0);                       // лицо
      pt(a0, d0, h0); pt(a1, d1, h1); pt(a1, d1 + 1600, h1); pt(a0, d0, h0); pt(a1, d1 + 1600, h1); pt(a0, d0 + 1600, h0);   // крыша
    };
    for (let a = 0; a < 360; a++) landH[a] = lm[a] > 0 ? 12 + 22 * hash(a * 3 + 7) : 0;
    for (let a = 0; a < 360; a++) {
      const b = (a + 1) % 360, A = lm[a], B = lm[b];
      if (!(A > 0) && !(B > 0)) continue;
      const dA = (A || B) * 1000, dB = (B || A) * 1000, hA = landH[a], hB = landH[b];
      const dM = (dA + dB) / 2, hM = (hA + hB) / 2 * (0.82 + 0.36 * hash(a * 7 + 1));
      quad(a, dA, hA, a + 0.5, dM, hM); quad(a + 0.5, dM, hM, a + 1, dB, hB);
    }
    if (!p.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.computeVertexNormals();
    landMesh = new THREE.Mesh(g, landMat);
    landMesh.frustumCulled = false;
    scene.add(landMesh);
  }
  const landHeight = (b) => (landH ? landH[((Math.round(b) % 360) + 360) % 360] : 0);

  // флот и самолёты
  const fleet = createFleet(game, scene), wing = createAirWing(game, scene);
  let bx = 0, by = 0, b0 = 0, halfFov = 8;
  function placeShip(o, g, friendly) {
    const dxk = o.x - bx, dyk = o.y - by, b = Math.atan2(dxk, dyk) / DEG;
    const isLand = g.userData.land;
    g.position.set(dxk * 1000, isLand ? Math.max(1, landHeight(b)) : 0, -dyk * 1000);
    g.rotation.y = (isLand ? -90 - b : 90 - o.heading) * DEG;
    g.scale.setScalar(EX);
    if (!friendly && o.alive && Math.abs(wrap180(b - b0)) <= halfFov) info.inView = true;
    return true;
  }
  function placePlane(p, g, down) {
    const hd = p.range * 1000 * Math.cos(p.elevation * DEG), alt = p.range * 1000 * Math.sin(p.elevation * DEG) * (1 - down);
    g.position.set(Math.sin(p.bearing * DEG) * hd, EYE + alt, -Math.cos(p.bearing * DEG) * hd);
    g.rotation.y = (90 - (p.attacked ? p.bearing : p.bearing + 180)) * DEG;
    g.scale.setScalar(6);                              // самолёт мал: в трубе он заметно крупнее натуры
    return true;
  }

  // спрайты: всплески, «люстры», вспышки орудий, дым
  const blob = blobTexture();
  const colCv = T.makeCanvas(64, 128);
  {
    const c = colCv.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.25, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,1)');
    c.fillStyle = g;
    c.beginPath(); c.moveTo(14, 128); c.quadraticCurveTo(6, 60, 18, 22); c.quadraticCurveTo(24, 2, 32, 4); c.quadraticCurveTo(42, 0, 46, 20); c.quadraticCurveTo(58, 62, 50, 128); c.closePath(); c.fill();
    for (let i = 0; i < 16; i++) { c.beginPath(); c.arc(8 + hash(i) * 48, 6 + hash(i + 40) * 60, 2 + hash(i + 80) * 5, 0, 7); c.fill(); }
  }
  const colTex = T.canvasTexture(colCv, { aniso: 1, mipmaps: true });
  own.push(colTex);
  const sprite = (map, color, additive) => {
    const m = new THREE.SpriteMaterial({ map, color, transparent: true, opacity: 0, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    const s = new THREE.Sprite(m);
    s.visible = false; scene.add(s); own.push(m);
    return s;
  };
  const splashes = [];                       // { sp, x, z, t, kind, dim, live }
  for (let i = 0; i < 6; i++) { const sp = sprite(colTex, 0xffffff, false); sp.center.set(0.5, 0); splashes.push({ sp, x: 0, z: 0, t: 0, kind: 'water', dim: 1, live: false }); }
  const flareSp = [], flareSea = [], flashSp = [], smokeSp = [];
  const seaGlowGeo = new THREE.CircleGeometry(1500, 20);
  seaGlowGeo.rotateX(-Math.PI / 2);
  own.push(seaGlowGeo);
  for (let i = 0; i < 4; i++) {
    flareSp.push(sprite(blob, 0xfff0c8, true));
    const m = new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const g = new THREE.Mesh(seaGlowGeo, m);
    g.position.y = 1; g.visible = false; scene.add(g); own.push(m);
    flareSea.push(g);
    flashSp.push(sprite(blob, 0xffc878, true));
  }
  for (let i = 0; i < 15; i++) smokeSp.push(sprite(blob, 0xe2e4e2, false));
  const C_WATER = new THREE.Color(0xf2f7fa), C_WATER_N = new THREE.Color(0x96a5b4), C_EARTH = new THREE.Color(0x685c4a), C_HIT = new THREE.Color(0x241e1a), C_FLASH = new THREE.Color(0xffd28a);

  // палитра
  let palFor = null;
  const cTmp = new THREE.Color(), cTmp2 = new THREE.Color();
  function applyPalette() {
    const m = game.state.mission || {}, key = (m.night ? 'n' : 'd') + (m.weather || 'clear');
    if (key === palFor) return;
    palFor = key; info.mode = key;
    const P = skyFor(m), night = !!m.night, fog = m.weather === 'fog', storm = m.weather === 'storm';
    const c = skyCv.getContext('2d'), hor = 128 * (SKY_HI / (SKY_HI - SKY_LO));
    const g = c.createLinearGradient(0, 0, 0, hor);
    g.addColorStop(0, P.top); g.addColorStop(1, P.low);
    c.fillStyle = P.low; c.fillRect(0, 0, 512, 128);
    c.fillStyle = g; c.fillRect(0, 0, 512, hor);
    if (!night) {
      for (let i = 0; i < 22; i++) {
        const x = hash(i + 40) * 512, y = 8 + hash(i + 60) * (hor - 22), rw = 24 + hash(i + 80) * 60, rh = 2.5 + hash(i + 90) * 5;
        c.fillStyle = storm ? 'rgba(20,26,32,0.4)' : fog ? 'rgba(200,205,205,0.25)' : 'rgba(255,255,255,0.34)';
        for (const ox of [0, -512, 512]) { c.beginPath(); c.ellipse(x + ox, y, rw, rh, 0, 0, 7); c.fill(); }
      }
    }
    if (P.haze) { c.fillStyle = P.haze; c.fillRect(0, 0, 512, 128); }
    skyTex.needsUpdate = true;
    stars.visible = night && !fog;
    starMat.opacity = storm ? 0.4 : 0.9;
    // дымка: к горизонту всё уходит в цвет неба у воды
    cTmp.set(P.low); if (P.haze) cTmp.lerp(cTmp2.set(night ? 0x1c2125 : 0xaab0b0), 0.6);
    scene.fog.color.copy(cTmp); scene.background.copy(cTmp);
    scene.fog.near = fog ? 150 : storm ? 1500 : 3000;
    scene.fog.far = fog ? 4800 : storm ? 34000 : 90000;
    seaMat.color.set(P.sea0).lerp(cTmp2.set(P.sea1), 0.45);
    landMat.color.set(P.land);
    if (night) { hemi.intensity = 1.5; hemi.color.set(0xffe9c0); sun.intensity = 0.9; sun.color.set(0xffd9a0); }
    else { hemi.intensity = fog ? 2.3 : storm ? 1.9 : 2.6; hemi.color.set(0xffffff); sun.intensity = fog ? 0.5 : storm ? 0.8 : 2.2; sun.color.set(0xfff4e0); }
    for (const s of smokeSp) s.material.color.set(night ? 0x464c54 : 0xe2e4e2);
  }

  let vt = 0, lastRender = -1, lastB = null, lastFov = 0;

  function syncWorld(dt) {
    const s = game.state, m = s.mission;
    if (!m || !m.battery) return false;
    bx = m.battery.x; by = m.battery.y;
    const sc = s.scope || { bearing: 0, zoom: 4 };
    b0 = sc.bearing; halfFov = 32 / (sc.zoom || 4);
    info.bearing = b0; info.fov = halfFov * 2;
    applyPalette(); buildLand();
    cam.rotation.set(PITCH, -b0 * DEG, 0);
    if (cam.fov !== halfFov * 2) { cam.fov = halfFov * 2; cam.updateProjectionMatrix(); }
    const night = !!m.night, storm = m.weather === 'storm';
    seaTex.offset.x = (vt * 0.004 * (storm ? 2.5 : 1)) % 1; seaTex.offset.y = (vt * 0.0017) % 1;

    info.inView = false;
    fleet.sync(dt, vt, placeShip);
    wing.sync(dt, vt, placePlane);
    info.ships = fleet.shown; info.planes = wing.shown;

    // вспышки орудий: 0,4 с после выстрела цели
    let n = 0;
    const ts = s.targets || [];
    for (let i = 0; i < ts.length && n < flashSp.length; i++) {
      const t = ts[i];
      if (t.firedAt == null || t.sunk || t.escaped) continue;
      const age = s.time - t.firedAt;
      if (age < 0 || age > 0.4) continue;
      const sp = flashSp[n++], k = 1 - age / 0.4;
      sp.visible = true; sp.position.set((t.x - bx) * 1000, 14, -(t.y - by) * 1000);
      sp.scale.setScalar(90 + 240 * k); sp.material.opacity = k;
    }
    info.flashes = n;
    for (; n < flashSp.length; n++) flashSp[n].visible = false;

    // «люстры»
    n = 0;
    const ls = s.lights || [];
    for (let i = 0; i < ls.length && n < flareSp.length; i++) {
      const l = ls[i], left = clamp((l.until - s.time) / 60, 0, 1);
      const fl = 0.85 + 0.15 * Math.sin(vt * 17 + l.n) * Math.sin(vt * 7.3), k = Math.min(1, left * 12) * fl;
      const x = (l.x - bx) * 1000, z = -(l.y - by) * 1000;
      const sp = flareSp[n], gl = flareSea[n]; n++;
      sp.visible = true; sp.position.set(x, 50 + 190 * left, z); sp.scale.setScalar(300); sp.material.opacity = k;
      gl.visible = true; gl.position.set(x, 1, z); gl.material.opacity = (night ? 0.16 : 0.05) * k;
    }
    info.flares = n;
    for (; n < flareSp.length; n++) { flareSp[n].visible = false; flareSea[n].visible = false; }

    // дымзавесы: пять клубов поперёк линии «батарея — завеса»
    n = 0;
    const sm = s.smokes || [];
    let cnt = 0;
    for (let i = 0; i < sm.length && n + 5 <= smokeSp.length; i++) {
      const q = sm[i], left = q.until - s.time, k = clamp(left / 6, 0, 1) * clamp((60 - left) / 4 + 0.25, 0, 1);
      const x = (q.x - bx) * 1000, z = -(q.y - by) * 1000, d = Math.max(1, Math.hypot(x, z)), px = -z / d, pz = x / d;
      cnt++;
      for (let j = -2; j <= 2; j++) {
        const sp = smokeSp[n++], o = j * 150 + Math.sin(vt * 0.2 + j) * 20, r = 300 * (0.85 + 0.3 * hash(j + 20 + q.n));
        sp.visible = true; sp.position.set(x + px * o, r * 0.3, z + pz * o); sp.scale.setScalar(r); sp.material.opacity = 0.8 * k;
      }
    }
    info.smokes = cnt;
    for (; n < smokeSp.length; n++) smokeSp[n].visible = false;

    // всплески
    let live = 0;
    for (let i = 0; i < splashes.length; i++) {
      const q = splashes[i];
      if (!q.live) continue;
      live++;
      const t = q.t, water = q.kind === 'water', H = q.kind === 'hit' ? 125 : 95;
      const rise = Math.min(1, t / 0.45), fade = clamp(1 - (t - 1.6) / 2, 0, 1) * q.dim;
      const h = H * rise * (water ? clamp(1.25 - t * 0.28, 0.25, 1) : 1), w = H * (water ? 0.34 : 0.6) * (1 + t * (water ? 0.2 : 0.45));
      q.sp.position.set(q.x, 0, q.z); q.sp.scale.set(w, Math.max(1, h), 1);
      q.sp.material.opacity = 0.95 * fade;
      if (water) q.sp.material.color.copy(night ? C_WATER_N : C_WATER);
      else q.sp.material.color.copy(C_FLASH).lerp(q.kind === 'hit' ? C_HIT : C_EARTH, clamp(t / 0.3, 0, 1));
    }
    info.splashes = live;
    return true;
  }

  function render() {
    const r = engine.renderer, prev = r.getRenderTarget();
    r.setRenderTarget(rt);
    r.render(scene, cam);
    r.setRenderTarget(prev);
    info.renders++; lastRender = vt; lastB = b0; lastFov = halfFov;
  }

  return {
    texture: rt.texture, info, scene, cam,
    /** Событие impact: всплеск/разрыв в истинной точке падения. */
    impact(e) {
      const s = game.state, m = s.mission;
      if (!e || !m || !m.battery || e.x == null || e.shell === 'illum') return false;
      const dxk = e.x - m.battery.x, dyk = e.y - m.battery.y, d = Math.hypot(dxk, dyk);
      let lit = false, isL = false;
      try { lit = !!game.lit(e.x, e.y); } catch (err) { lit = false; }
      try { isL = !!game.isLand(e.x, e.y); } catch (err) { isL = false; }
      const dark = !!m.night && !lit;
      if (dark && d > 12) return false;
      let q = splashes[0];
      for (const c of splashes) { if (!c.live) { q = c; break; } if (c.t > q.t) q = c; }
      q.live = true; q.t = 0; q.x = dxk * 1000; q.z = -dyk * 1000; q.dim = dark ? 0.3 : 1;
      q.kind = e.shell === 'smoke' ? 'water' : e.hits && e.hits.length ? 'hit' : isL ? 'land' : 'water';
      q.sp.visible = true;
      return true;
    },
    reset() {
      for (const q of splashes) { q.live = false; q.sp.visible = false; }
      fleet.clear(); wing.clear(); land.reset(); landFor = null; palFor = null; lastRender = -1;
    },
    /** here — пост текущий: только тогда сцена обновляется и рисуется (не чаще ~30 раз/с). */
    update(dt, here) {
      vt += dt;
      for (const q of splashes) if (q.live && (q.t += dt) > 3.6) { q.live = false; q.sp.visible = false; }
      if (!here && lastRender >= 0) return;
      const sc = game.state.scope;
      const gap = vt - lastRender;
      if (lastRender >= 0 && gap < 0.03 && !(sc && (sc.bearing !== lastB || 32 / sc.zoom !== lastFov) && gap >= 0.015)) return;
      if (syncWorld(lastRender < 0 ? dt : gap)) render();
    },
    dispose() {
      fleet.clear(); wing.clear();
      if (landMesh) landMesh.geometry.dispose();
      own.forEach((o) => o.dispose());
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
