// Вид в смотровую щель поста «ОГОНЬ»: настоящая 3D-сцена снаружи (seasky.js — общая с трубой наблюдения и зениткой):
// небо со светилом и облаками, море с волнами по ветру задания, берег, корабли и самолёты (ships.js), всплески, разрывы,
// дульная вспышка и дым своих стволов, трасса своего снаряда, «люстры», дымзавесы, ночь, туман, шторм с дождём и молниями.
// Сцена рисуется в свою текстуру 800×125 × engine.quality.rtScale (+ MSAA по уровню) и лежит на плоскости щели; поверх —
// прозрачный слой со шкалой пеленга и визирной нитью (canvas, перерисовывается только при повороте башни и смене дня/ночи).
// Перерисовка сцены — только когда пост на экране: ~6 раз/с в покое, чаще — пока идут короткие анимации (вспышка, всплеск,
// трасса, пожар, самолёты в щели) или вращается башня.
// Для тестов: view.canvas — превью вида 640×100 (небо и вода тех же цветов, что в шейдерах, + шкала), без чтения с GPU.
import { createOutside, createLandProfile, skyBaseJS, hash, wrap180, clamp } from './seasky.js';

export { createLandProfile, hash, wrap180, clamp };

const DEG = Math.PI / 180;
const CW = 640, CH = 100;            // слой шкалы (и снимок для тестов)
const FOV = 48;                      // ° по ширине щели
const PPD = CW / FOV;                // px на градус
const HOR = 56;                      // y горизонта на холсте
const VIEW_HALF = 20;                // ° — разрыв виден, если он в пределах ±20° от пеленга башни
const NIGHT_SEE = 12;                // км — дальше ночью без света разрыв не виден
const RW = 800, RH = 125;            // текстура сцены при rtScale 1 (щель на экране телефона ≈ 400–850 px)
const EYE = 36;                      // м над водой (горизонт и дальность читаются так же, как в прежней щели)
const EX = 2.4;                      // силуэты крупнее натуры (иначе в щели шириной 48° корабль — точка)
const F_PX = PPD / DEG;              // px на радиан по ширине
const VFOV = 2 * Math.atan(Math.tan(FOV / 2 * DEG) / (CW / CH)) / DEG;
const PITCH = Math.atan((HOR / CH - 0.5) * 2 * Math.tan(VFOV / 2 * DEG));   // горизонт на HOR px от верха

/**
 * o: { w, h } — размер плоскости, м.
 * → { mesh, material, canvas, info, fired(e), impact(e), reset(), update(dt, here), dispose() }
 */
export function createSlitView(ctx, o) {
  const { engine, THREE, game } = ctx;
  const T = engine.textures;

  const world = createOutside(ctx, {
    eye: EYE, ex: EX, planeElev: 0.45, landScale: 1.4, near: 20, view: 'slit', splashLife: 3.3,
    shipScale: (dkm, g) => Math.max(1, 3.5 / g.userData.size.length * dkm * 1000 / F_PX / EX),
    planeScale: (p) => clamp(F_PX / (Math.max(0.4, p.range) * 1000) * EX * 1.6, 1.3, 3.2) * Math.max(0.4, p.range) * 1000 / F_PX,
  });
  const cam = world.camera;
  cam.fov = VFOV; cam.aspect = CW / CH; cam.updateProjectionMatrix();

  let q = engine.quality || { rtScale: 1, samples: 4 };
  const rtW = (k) => Math.max(160, Math.round(RW * ((k && k.rtScale) || 1))), rtH = (k) => Math.max(25, Math.round(RH * ((k && k.rtScale) || 1)));
  const rt = new THREE.WebGLRenderTarget(rtW(q), rtH(q), { depthBuffer: true, samples: q.samples || 0 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: rt.texture, color: 0xffffff, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(o.w, o.h), material);
  mesh.name = 'visionSlit';

  // слой шкалы
  const canvas0 = T.makeCanvas(CW, CH), c2 = canvas0.getContext('2d');
  const tex = T.canvasTexture(canvas0, { aniso: 4, mipmaps: false });
  const ovMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false });
  const overlay = new THREE.Mesh(mesh.geometry, ovMat);
  overlay.name = 'visionSlitScale'; overlay.position.z = 0.0006; overlay.renderOrder = 2;
  mesh.add(overlay);

  let vt = 0;                 // собственные часы вида, с
  let last = -1;              // vt последней перерисовки
  let lastBearing = null, ovKey = '';
  let dirty = true;
  let muzzle = null;          // { t, twin, drift, shown }
  const info = { redraws: 0, mode: 'day', weather: 'clear', night: false, tod: 'day', splashes: 0, flares: 0, smokes: 0, muzzle: false, bearing: 0, ships: 0, planes: 0, particles: 0 };

  engine.on('quality', (nq) => {
    q = nq; rt.samples = nq.samples || 0; rt.dispose(); rt.setSize(rtW(nq), rtH(nq));
    world.setQuality(nq); dirty = true;
  });

  function drawOverlay(b0, night) {
    const key = b0.toFixed(2) + (night ? 'n' : 'd');
    if (key === ovKey) return;
    ovKey = key;
    c2.clearRect(0, 0, CW, CH);
    // шкала пеленга на стекле: деления через 1°, подписи через 10°
    const ink = night ? '255,196,120' : '16,24,32';
    c2.fillStyle = night ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.2)';
    c2.fillRect(0, 0, CW, 27);
    c2.fillStyle = `rgba(${ink},0.9)`;
    for (let a = Math.ceil(b0 - FOV / 2); a <= b0 + FOV / 2; a++) {
      const x = CW / 2 + (a - b0) * PPD, big = a % 10 === 0, mid = a % 5 === 0;
      c2.fillRect(x - (big ? 1 : 0.6), 0, big ? 2 : 1.2, big ? 9 : mid ? 6 : 3.5);
      if (big) T.drawLabel(c2, String(((a % 360) + 360) % 360).padStart(3, '0'), x, 18.5, 11.5, { color: `rgba(${ink},0.95)`, weight: 700 });
    }
    // неподвижная визирная нить
    c2.fillStyle = night ? 'rgba(255,170,90,0.75)' : 'rgba(150,20,14,0.8)';
    c2.fillRect(CW / 2 - 0.75, 0, 1.5, CH);
    c2.beginPath(); c2.moveTo(CW / 2 - 6, 0); c2.lineTo(CW / 2 + 6, 0); c2.lineTo(CW / 2, 8); c2.closePath(); c2.fill();
    // тень от брони по краям
    const g = c2.createLinearGradient(0, 0, 0, CH);
    g.addColorStop(0, 'rgba(0,0,0,0.34)'); g.addColorStop(0.12, 'rgba(0,0,0,0)'); g.addColorStop(0.88, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.38)');
    c2.fillStyle = g; c2.fillRect(0, 0, CW, CH);
    const gx = c2.createLinearGradient(0, 0, CW, 0);
    gx.addColorStop(0, 'rgba(0,0,0,0.3)'); gx.addColorStop(0.05, 'rgba(0,0,0,0)'); gx.addColorStop(0.95, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,0.3)');
    c2.fillStyle = gx; c2.fillRect(0, 0, CW, CH);
    tex.needsUpdate = true;
  }

  let hot = false;
  function place(ob, g) {
    if (Math.abs(wrap180(Math.atan2(g.position.x, -g.position.z) / DEG - info.bearing)) > FOV / 2 + 3) return false;
    if (ob.sinking || ob.burning) hot = true;
    return true;
  }

  function draw(dt) {
    const s = game.state, m = s.mission || {};
    info.bearing = s.turret ? s.turret.bearing : 0;
    const b0 = info.bearing;
    info.weather = m.weather || 'clear'; info.night = !!m.night; info.mode = info.night ? 'night' : 'day';
    cam.rotation.set(PITCH, -b0 * DEG, 0);
    cam.updateMatrixWorld();
    hot = false;
    if (!world.sync(dt, vt, place)) { drawOverlay(b0, info.night); return; }
    info.tod = world.info.tod;
    if (muzzle && !muzzle.shown) { muzzle.shown = true; world.muzzle({ twin: muzzle.twin, drift: muzzle.drift, dist: 60, side: 5.5, below: 9 }); }
    let tr = false;
    for (const f of s.flight || []) if (f.t < 2.4) { world.tracer(f, vt); tr = true; }
    // счётчики «что в щели»
    let nf = 0, ns = 0;
    const bat = m.battery || { x: 0, y: 0 };
    for (const l of s.lights || []) if (Math.abs(wrap180(Math.atan2(l.x - bat.x, l.y - bat.y) / DEG - b0)) <= FOV / 2 + 6) nf++;
    for (const sm of s.smokes || []) if (Math.abs(wrap180(sm.bearing - b0)) <= FOV / 2 + 30) ns++;
    info.flares = nf; info.smokes = ns;
    info.ships = world.fleet.shown; info.planes = world.wing.shown;
    if (info.planes) hot = true;
    info.hot = hot || tr;
    world.render(rt, VFOV * DEG / rt.height);
    info.particles = world.info.particles;
    drawOverlay(b0, info.night);
    info.redraws++;
    dirty = false; last = vt; lastBearing = b0;
  }

  // «превью» вида для тестов и отладки: 640×100, без чтения с GPU (readPixels останавливает конвейер и шумит в консоли).
  // Небо и вода считаются на CPU теми же формулами, что в шейдерах (seasky.skyBaseJS: градиент, свечение у светила, дымка
  // у горизонта) по лучам камеры щели, поверх — слой шкалы. Облаков, кораблей и частиц в превью нет. Сам кадр сцены —
  // в renderTarget (его можно прочитать renderer.readRenderTargetPixels при отладке).
  let snap = null;
  const _sc = new THREE.Color(), _sea = new THREE.Color(), _d = new THREE.Vector3();
  function snapshot() {
    snap = snap || T.makeCanvas(CW, CH);
    const sc = snap.getContext('2d'), L = world.look;
    sc.fillStyle = '#000'; sc.fillRect(0, 0, CW, CH);
    if (L) {
      const SX = 8, SY = 2;
      for (let y = 0; y < CH; y += SY) for (let x = 0; x < CW; x += SX) {
        _d.set(((x + SX / 2) / CW) * 2 - 1, 1 - ((y + SY / 2) / CH) * 2, 0.5).unproject(cam).sub(cam.position).normalize();
        if (_d.y >= -0.0005) skyBaseJS(L, _d.x, _d.y, _d.z, _sc);
        else {
          skyBaseJS(L, _d.x, 0, _d.z, _sea);
          const dist = EYE / -_d.y, f = 1 - Math.exp(-L.fogDensity * L.fogDensity * dist * dist);
          _sc.copy(L.sea).multiplyScalar(L.night ? 0.5 : L.ambient).lerp(_sea, 0.55 + 0.45 * f);
        }
        _sc.convertLinearToSRGB();
        sc.fillStyle = 'rgb(' + Math.round(clamp(_sc.r, 0, 1) * 255) + ',' + Math.round(clamp(_sc.g, 0, 1) * 255) + ',' + Math.round(clamp(_sc.b, 0, 1) * 255) + ')';
        sc.fillRect(x, y, SX, SY);
      }
    }
    sc.drawImage(canvas0, 0, 0);
    return snap;
  }

  const api = {
    mesh, material, info, world, overlay, renderTarget: rt,
    get canvas() { return snapshot(); },
    /** Событие fired: дульная вспышка и дым (при «вилке» — из обоих стволов). */
    fired(e) {
      const tb = game.state.turret ? game.state.turret.bearing : 0;
      let cross = 0;
      try { cross = game.windParts(tb).cross; } catch (err) { cross = 0; }
      muzzle = { t: 0, twin: !!(e && e.salvo), drift: clamp(cross, -15, 15), shown: false };
      dirty = true;
    },
    /** Событие impact: всплеск/разрыв, если он в пределах ±20° от пеленга башни. → true, если показан. */
    impact(e) {
      const s = game.state;
      const shown = world.impact(e, (d, dark, isL, dxk, dyk) => {
        const b = (Math.atan2(dxk, dyk) / DEG + 360) % 360;
        if (Math.abs(wrap180(b - (s.turret ? s.turret.bearing : 0))) > VIEW_HALF) return false;
        return !(dark && d > NIGHT_SEE);
      });
      if (shown) { dirty = true; info.splashes++; }
      return shown;
    },
    reset() { muzzle = null; dirty = true; world.reset(); info.splashes = 0; },
    /** here — пост на экране: только тогда сцена обновляется и рисуется. */
    update(dt, here) {
      vt += dt;
      if (muzzle && (muzzle.t += dt) > 4.6) { muzzle = null; dirty = true; }
      info.muzzle = !!muzzle;
      if (!here) { dirty = true; return; }
      const b = game.state.turret ? game.state.turret.bearing : 0;
      const gap = vt - last;
      const anim = !!muzzle || world.splashes > 0 || info.hot;
      if (last < 0 || (dirty && gap >= 0.03) || (b !== lastBearing && gap >= 0.03) || gap >= (anim ? 0.045 : 0.16)) {
        draw(last < 0 ? dt : Math.min(gap, 0.5));
        info.splashes = world.splashes;
      }
    },
    dispose() {
      world.dispose(); rt.dispose(); tex.dispose(); ovMat.dispose(); material.dispose(); mesh.geometry.dispose();
    },
  };
  return api;
}
