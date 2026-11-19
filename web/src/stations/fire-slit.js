// Вид в смотровую щель поста «ОГОНЬ»: небо, горизонт, море/берег по пеленгу башни, шкала пеленга,
// дульная вспышка и дым, далёкие разрывы, ночь со звёздами и «люстрами», туман, шторм.
// Одна плоскость с canvas-текстурой (1 вызов отрисовки, без источников света). Перерисовка — только когда пост
// на экране: ~6 раз/с ради зыби, чаще — пока идут короткие анимации (вспышка, дым, всплеск) или вращается башня.
// Корабли, свои и самолёты налёта — настоящие модели из ships.js: отдельная маленькая сцена с ортокамерой в пикселях
// холста рисуется в свою текстуру (тем же тактом, что и холст) и ложится прозрачным слоем поверх плоскости
// (+1 вызов отрисовки, и только когда в щели кто-то есть). Общие с трубой наблюдения (observe.js) вещи экспортируются:
// SKY, createLandProfile, hash, wrap180, clamp.
import { createFleet, createAirWing } from './ships.js';

const DEG = Math.PI / 180;
const CW = 640, CH = 100;            // холст
const FOV = 48;                      // ° по ширине щели
const PPD = CW / FOV;                // px на градус
const HOR = 56;                      // y горизонта на холсте
const VIEW_HALF = 20;                // ° — разрыв виден, если он в пределах ±20° от пеленга башни
const NIGHT_SEE = 12;                // км — дальше ночью без света разрыв не виден

export const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
export const wrap180 = a => ((a + 540) % 360 + 360) % 360 - 180;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const SKY = {
  day:        { top: '#6f93b6', low: '#cfdbdf', sea0: '#5b7890', sea1: '#243a4c', land: '#3d4a3f', swell: '236,243,246', haze: null },
  storm:      { top: '#2f3a44', low: '#737d82', sea0: '#3f4d55', sea1: '#161f26', land: '#222a27', swell: '225,232,234', haze: null },
  fog:        { top: '#8d979b', low: '#b3b9b9', sea0: '#8f999b', sea1: '#566267', land: '#6f7876', swell: '225,230,230', haze: 'rgba(170,176,176,0.6)' },
  night:      { top: '#04070e', low: '#17263c', sea0: '#0e1a28', sea1: '#020407', land: '#010203', swell: '120,140,165', haze: null },
  nightStorm: { top: '#030508', low: '#111a24', sea0: '#0b131a', sea1: '#010203', land: '#000101', swell: '110,125,140', haze: null },
  nightFog:   { top: '#0b0e11', low: '#191e22', sea0: '#12171a', sea1: '#06080a', land: '#07090a', swell: '90,100,108', haze: 'rgba(28,33,37,0.6)' },
};

/** Палитра неба/моря по заданию: день/ночь × ясно/туман/шторм. */
export function skyFor(mission) {
  const m = mission || {}, w = m.weather;
  if (m.night) return w === 'storm' ? SKY.nightStorm : w === 'fog' ? SKY.nightFog : SKY.night;
  return w === 'storm' ? SKY.storm : w === 'fog' ? SKY.fog : SKY.day;
}

/**
 * Профиль берега: () → Float32Array(360) | null — расстояние (км) до ближайшей суши по каждому градусу пеленга
 * от батареи (0 — суши нет). Считается один раз на карту задания.
 */
export function createLandProfile(game) {
  let landMap = null, landFor = null;
  const get = () => {
    const m = game.state.mission;
    if (!m || !m.battery) return null;
    if (landFor === m.map && landMap) return landMap;
    landFor = m.map; landMap = new Float32Array(360);
    const bx = m.battery.x, by = m.battery.y, max = (game.C && game.C.MAP) || 20;
    for (let a = 0; a < 360; a++) {
      const sx = Math.sin(a * DEG), sy = Math.cos(a * DEG);
      let found = 0;
      for (let d = 0.5; d <= 22; d += d < 4 ? 0.15 : 0.3) {
        const x = bx + sx * d, y = by + sy * d;
        if (x < 0 || y < 0 || x > max || y > max) break;
        let isL = false;
        try { isL = game.isLand(x, y); } catch (e) { isL = false; }
        if (isL) { found = d; break; }
      }
      landMap[a] = found;
    }
    return landMap;
  };
  get.reset = () => { landFor = null; };
  return get;
}

/**
 * o: { w, h } — размер плоскости, м.
 * → { mesh, material, info, fired(e), impact(e), reset(), update(dt, here), dispose() }
 */
export function createSlitView(ctx, o) {
  const { engine, THREE, game } = ctx;
  const T = engine.textures;
  const canvas = T.makeCanvas(CW, CH), c2 = canvas.getContext('2d');
  const tex = T.canvasTexture(canvas, { aniso: 4, mipmaps: false });
  const material = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(o.w, o.h), material);
  mesh.name = 'visionSlit';

  let vt = 0;                 // собственные часы вида, с
  let last = -1;              // vt последней перерисовки
  let lastBearing = null;
  let dirty = true;
  let muzzle = null;          // { t, twin, drift }
  const splashes = [];        // { b, d, t, kind: 'water'|'land'|'hit'|'puff', dim }
  const info = { redraws: 0, mode: 'day', weather: 'clear', night: false, splashes: 0, flares: 0, smokes: 0, muzzle: false, bearing: 0, ships: 0, planes: 0 };

  const X = b => CW / 2 + wrap180(b - info.bearing) * PPD;
  const seaY = d => HOR + clamp(26 / Math.max(0.3, d), 1, CH - HOR - 4);

  const land = createLandProfile(game);

  // --- слой моделей (ships.js): корабли, свои, самолёты налёта ---
  const RW = 960, RH = 150;            // текстура слоя
  const EX = 2.4;                      // силуэты крупнее натуры (иначе в щели шириной 48° корабль — точка)
  const F_PX = PPD / DEG;              // px на радиан
  let layer = null, hot = false, maskN = 0;
  engine.on('quality', (q) => { if (layer) { layer.rt.samples = q.samples; layer.rt.dispose(); layer.rt.setSize(Math.round(RW * q.rtScale), Math.round(RH * q.rtScale)); } dirty = true; });
  function makeLayer() {
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(0, CW, CH, 0, 1, 6000);
    cam.position.z = 3000;
    const hemi = new THREE.HemisphereLight(0xffffff, 0x3a444c, 2.6), sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    sun.position.set(-0.5, 1, 0.7);
    scene.add(hemi, sun);
    const q0 = engine.quality, k0 = (q0 && q0.rtScale) || 1;   // настройка «качество графики»
    const rt = new THREE.WebGLRenderTarget(Math.round(RW * k0), Math.round(RH * k0), { depthBuffer: true, samples: q0 ? q0.samples : 4 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
      map: rt.texture, transparent: true, toneMapped: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const m = new THREE.Mesh(mesh.geometry, mat);
    m.name = 'visionSlitShips'; m.position.z = 0.0006; m.renderOrder = 2; m.visible = false;
    mesh.add(m);
    layer = {
      scene, cam, hemi, sun, rt, mat, mesh: m, fleet: createFleet(game, scene), wing: createAirWing(game, scene),
      masks: [], maskGeo: new THREE.PlaneGeometry(1, 1), maskMat: new THREE.MeshBasicMaterial({ colorWrite: false }),
      clear: new THREE.Color(),
    };
  }
  // цель/свой → место на холсте (px, y вверх), масштаб, ракурс. false — вне щели.
  function placeShip(o, g) {
    const bat = game.state.mission.battery, dxk = o.x - bat.x, dyk = o.y - bat.y;
    const d = Math.max(0.3, Math.hypot(dxk, dyk)), b = Math.atan2(dxk, dyk) / DEG, dx = wrap180(b - info.bearing);
    if (Math.abs(dx) > FOV / 2 + 3) return false;
    const isLand = g.userData.land, x = CW / 2 + dx * PPD;
    let y = CH - seaY(d);
    if (isLand) {                                  // постройка на острове: над гребнем нарисованного берега
      const lm = land(), dl = lm ? lm[((Math.round(b) % 360) + 360) % 360] : 0;
      y = CH - HOR + (dl > 0 ? clamp(34 / dl, 1.5, HOR - 20) * 0.55 : 1);
    }
    g.position.set(x, y, -d * 100);
    g.rotation.set(0.08, (isLand ? -90 : 90 - (o.heading - b)) * DEG, 0);
    g.scale.setScalar(Math.max(F_PX / (d * 1000) * EX, 3.5 / g.userData.size.length));
    if (o.sinking || o.burning) hot = true;
    if (o.sinking && !isLand) {                    // вода закрывает уходящий под неё корпус
      let mk = layer.masks[maskN];
      if (!mk) { mk = layer.masks[maskN] = new THREE.Mesh(layer.maskGeo, layer.maskMat); mk.renderOrder = -1; layer.scene.add(mk); }
      maskN++;
      mk.visible = true; mk.scale.set(260, 200, 1); mk.position.set(x, y - 100, -d * 100 + 90);
    }
    return true;
  }
  // самолёт: угол места в щели сжат (в натуре щель видит всего ~4° над горизонтом)
  function placePlane(p, g, down) {
    const dx = wrap180(p.bearing - info.bearing);
    if (Math.abs(dx) > FOV / 2 + 2) return false;
    const y = CH - HOR + p.elevation * 0.45 * PPD * (1 - 0.8 * down);
    if (y > CH + 6) return false;
    g.position.set(CW / 2 + dx * PPD, y, -50);
    g.rotation.set(0.12, (p.attacked ? 90 : -90) * DEG, p.attacked ? 0 : 0.25);
    g.scale.setScalar(clamp(F_PX / (Math.max(0.4, p.range) * 1000) * EX * 1.6, 1.3, 3.2));
    hot = true;
    return true;
  }
  function drawLayer() {
    const s = game.state;
    if (!layer) {
      if (!s.mission || !((s.targets && s.targets.length) || (s.friends && s.friends.length) || s.raid)) return;
      makeLayer();
    }
    hot = false; maskN = 0;
    layer.fleet.sync(0.1, vt, placeShip);
    layer.wing.sync(0.1, vt, placePlane);
    for (let i = maskN; i < layer.masks.length; i++) layer.masks[i].visible = false;
    info.ships = layer.fleet.shown; info.planes = layer.wing.shown;
    const any = info.ships + info.planes > 0;
    layer.mesh.visible = any;
    if (!any) return;
    const night = info.night, fog = info.weather === 'fog';
    layer.hemi.intensity = night ? 0.9 : fog ? 2.2 : 2.6;
    layer.sun.intensity = night ? 0.8 : fog ? 0.6 : 2.2;
    layer.mat.opacity = fog ? 0.75 : 1;
    const r = engine.renderer, prev = r.getRenderTarget(), a = r.getClearAlpha();
    r.getClearColor(layer.clear);
    r.setRenderTarget(layer.rt); r.setClearColor(0x000000, 0);
    r.clear(); r.render(layer.scene, layer.cam);
    r.setRenderTarget(prev); r.setClearColor(layer.clear, a);
  }

  function palette() {
    const m = game.state.mission || {};
    const w = m.weather || 'clear', n = !!m.night;
    info.weather = w; info.night = n; info.mode = n ? 'night' : 'day';
    if (n) return w === 'storm' ? SKY.nightStorm : w === 'fog' ? SKY.nightFog : SKY.night;
    return w === 'storm' ? SKY.storm : w === 'fog' ? SKY.fog : SKY.day;
  }

  function draw() {
    const s = game.state, m = s.mission || {}, bat = m.battery || { x: 0, y: 0 };
    const P = palette(), night = info.night, weather = info.weather, storm = weather === 'storm', fog = weather === 'fog';
    info.bearing = s.turret ? s.turret.bearing : 0;
    const b0 = info.bearing;
    c2.globalAlpha = 1; c2.globalCompositeOperation = 'source-over';

    // небо
    let g = c2.createLinearGradient(0, 0, 0, HOR);
    g.addColorStop(0, P.top); g.addColorStop(1, P.low);
    c2.fillStyle = g; c2.fillRect(0, 0, CW, HOR);
    if (night && !fog) {
      const n = storm ? 60 : 260;
      for (let i = 0; i < n; i++) {
        const dx = wrap180(hash(i) * 360 - b0);
        if (Math.abs(dx) > FOV / 2) continue;
        const y = 2 + hash(i + 500) * (HOR - 8), br = 0.35 + 0.65 * hash(i + 900);
        const tw = 0.75 + 0.25 * Math.sin(vt * (1.5 + hash(i + 77) * 3) + i);
        c2.fillStyle = `rgba(215,225,255,${(br * tw * (storm ? 0.5 : 1)).toFixed(3)})`;
        const sz = br > 0.85 ? 2 : 1.3;
        c2.fillRect(CW / 2 + dx * PPD, y, sz, sz);
      }
    } else if (!night) {
      // облака: несколько мягких полос, привязанных к пеленгу
      for (let i = 0; i < 26; i++) {
        const dx = wrap180(hash(i + 40) * 360 + vt * 0.05 - b0);
        if (Math.abs(dx) > FOV / 2 + 8) continue;
        const y = 6 + hash(i + 60) * (HOR - 20), rw = 30 + hash(i + 80) * 60;
        c2.fillStyle = storm ? 'rgba(20,26,32,0.35)' : fog ? 'rgba(200,205,205,0.25)' : 'rgba(255,255,255,0.28)';
        c2.beginPath(); c2.ellipse(CW / 2 + dx * PPD, y, rw, 3 + hash(i + 90) * 5, 0, 0, 7); c2.fill();
      }
    }

    // море
    g = c2.createLinearGradient(0, HOR, 0, CH);
    g.addColorStop(0, P.sea0); g.addColorStop(1, P.sea1);
    c2.fillStyle = g; c2.fillRect(0, HOR, CW, CH - HOR);

    // «люстры» — заранее: отсвет на воде и небе под сушей и зыбью
    const lights = s.lights || [];
    const flares = [];
    for (const l of lights) {
      const dxk = l.x - bat.x, dyk = l.y - bat.y, d = Math.max(0.5, Math.hypot(dxk, dyk));
      const dx = wrap180(Math.atan2(dxk, dyk) / DEG - b0);
      if (Math.abs(dx) > FOV / 2 + 6) continue;
      const left = clamp((l.until - s.time) / 60, 0, 1);
      const x = CW / 2 + dx * PPD, y = HOR - clamp(190 / d, 8, HOR - 8) * (0.35 + 0.65 * left);
      const fl = 0.85 + 0.15 * Math.sin(vt * 17 + l.n) * Math.sin(vt * 7.3);
      const k = Math.min(1, left * 12) * fl * (fog ? 0.6 : 1);
      flares.push({ x, y, d, k });
      const r = clamp(520 / d, 60, 220);
      g = c2.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,236,190,${(0.5 * k).toFixed(3)})`); g.addColorStop(1, 'rgba(255,236,190,0)');
      c2.fillStyle = g; c2.fillRect(x - r, 0, r * 2, CH);
      c2.fillStyle = `rgba(255,240,200,${(0.22 * k).toFixed(3)})`;
      c2.beginPath(); c2.ellipse(x, seaY(d) + 2, clamp(260 / d, 24, 150), clamp(26 / d, 2.5, 12), 0, 0, 7); c2.fill();
    }
    info.flares = flares.length;

    // суша
    const lm = land();
    if (lm) {
      c2.fillStyle = P.land;
      c2.beginPath();
      let open = false;
      const a0 = Math.floor(b0 - FOV / 2 - 2), a1 = Math.ceil(b0 + FOV / 2 + 2);
      for (let a = a0; a <= a1 + 1; a++) {
        const i = ((a % 360) + 360) % 360, d = a <= a1 ? lm[i] : 0;
        const x = CW / 2 + (a - b0) * PPD;
        if (d > 0) {
          const h = clamp(34 / d, 1.5, HOR - 20) * (0.75 + 0.5 * hash(i * 3 + 7) * (d < 3 ? 0.5 : 1));
          if (!open) { c2.moveTo(x, HOR + 1); open = true; }
          c2.lineTo(x, HOR - h);
          if (d < 2.2) c2.lineTo(x + PPD, HOR - h);
        } else if (open) { c2.lineTo(x - PPD * 0.4, HOR + 1); c2.closePath(); open = false; }
      }
      if (open) { c2.lineTo(CW + 20, HOR + 1); c2.closePath(); }
      c2.fill();
      // ближний берег закрывает воду
      for (let a = a0; a <= a1; a++) {
        const i = ((a % 360) + 360) % 360, d = lm[i];
        if (d > 0 && d < 2.2) c2.fillRect(CW / 2 + (a - b0) * PPD - 0.5, HOR, PPD + 1, clamp(26 / d, 1, CH - HOR));
      }
    }

    // зыбь
    const rough = storm ? 2.1 : fog ? 0.6 : 1;
    for (let k = 0; k < 6; k++) {
      const y = HOR + 2.5 + 40 * Math.pow(k / 5, 1.6), step = 2.2 + k * 2.4, len = (7 + k * 10) * (storm ? 1.25 : 1);
      const drift = vt * (0.12 + 0.1 * k) * (storm ? 2.2 : 1);
      const first = Math.floor((b0 - FOV / 2 - 6 + drift) / step);
      c2.lineWidth = (0.8 + k * 0.35) * (storm ? 1.3 : 1);
      for (let j = first; j * step < b0 + FOV / 2 + 6 + drift; j++) {
        const id = ((j % 4096) + 4096) % 4096 + k * 4096;
        const a = (j + hash(id) * 0.8) * step - drift;
        const ph = Math.sin(vt * (0.9 + hash(id + 1) * 1.3) * (storm ? 1.6 : 1) + hash(id + 2) * 6.283);
        const al = (0.07 + 0.045 * k) * (0.5 + 0.5 * ph) * rough;
        if (al < 0.012) continue;
        const x = CW / 2 + (a - b0) * PPD, yy = y + (hash(id + 3) - 0.5) * (3 + k * 2) + ph * (storm ? 1.6 : 0.6);
        c2.strokeStyle = `rgba(${P.swell},${Math.min(0.85, al).toFixed(3)})`;
        c2.beginPath(); c2.moveTo(x - len / 2, yy); c2.quadraticCurveTo(x, yy - (storm ? 2.6 : 1.2) - k * 0.3, x + len / 2, yy); c2.stroke();
      }
    }
    // линия горизонта
    c2.fillStyle = night ? 'rgba(40,60,85,0.35)' : 'rgba(255,255,255,0.22)';
    c2.fillRect(0, HOR - 0.5, CW, 1);

    // дымовые завесы
    let nSm = 0;
    for (const sm of (s.smokes || [])) {
      const d = Math.max(0.6, Math.hypot(sm.x - bat.x, sm.y - bat.y));
      const dx = wrap180(sm.bearing - b0);
      if (Math.abs(dx) > FOV / 2 + 30) continue;
      nSm++;
      const left = sm.until - s.time, k = clamp(left / 6, 0, 1) * clamp((60 - left) / 4 + 0.25, 0, 1);
      const yb = seaY(d), r = clamp(46 / d, 12, 40);
      for (let i = -5; i <= 5; i++) {
        const x = CW / 2 + (dx + i * 4.6 + Math.sin(vt * 0.2 + i) * 0.8) * PPD, rr = r * (0.8 + 0.4 * hash(i + 20 + sm.n));
        g = c2.createRadialGradient(x, yb - rr * 0.5, 0, x, yb - rr * 0.5, rr * 1.6);
        const col = night ? '70,76,84' : '226,228,226';
        g.addColorStop(0, `rgba(${col},${(0.62 * k).toFixed(3)})`); g.addColorStop(1, `rgba(${col},0)`);
        c2.fillStyle = g; c2.fillRect(x - rr * 1.6, yb - rr * 2.1, rr * 3.2, rr * 3.2);
      }
    }
    info.smokes = nSm;

    // огни «люстр»
    for (const f of flares) {
      const r = clamp(70 / f.d, 7, 22);
      g = c2.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      g.addColorStop(0, `rgba(255,255,245,${f.k.toFixed(3)})`); g.addColorStop(0.25, `rgba(255,236,170,${(0.8 * f.k).toFixed(3)})`); g.addColorStop(1, 'rgba(255,220,150,0)');
      c2.fillStyle = g; c2.fillRect(f.x - r, f.y - r, r * 2, r * 2);
      c2.strokeStyle = `rgba(200,200,190,${(0.25 * f.k).toFixed(3)})`; c2.lineWidth = 1;       // дымный след парашюта
      c2.beginPath(); c2.moveTo(f.x, f.y - r * 0.4); c2.quadraticCurveTo(f.x + 5, f.y - r * 1.4, f.x + 2, f.y - r * 2.4); c2.stroke();
    }

    // разрывы
    for (const sp of splashes) {
      const dx = wrap180(sp.b - b0);
      if (Math.abs(dx) > FOV / 2 + 4) continue;
      const x = CW / 2 + dx * PPD, yb = seaY(sp.d);
      const H = clamp(150 / sp.d, 5, 44) * (sp.kind === 'hit' ? 1.25 : 1), t = sp.t;
      const rise = Math.min(1, t / 0.45), fade = clamp(1 - (t - 1.4) / 1.8, 0, 1) * sp.dim;
      if (sp.kind !== 'puff' && t < 0.3) {
        const k = 1 - t / 0.3, r = H * (sp.kind === 'hit' ? 0.9 : 0.55) + 2;
        g = c2.createRadialGradient(x, yb, 0, x, yb, r);
        g.addColorStop(0, `rgba(255,244,210,${k.toFixed(3)})`); g.addColorStop(0.4, `rgba(255,170,70,${(0.8 * k).toFixed(3)})`); g.addColorStop(1, 'rgba(255,120,40,0)');
        c2.fillStyle = g; c2.fillRect(x - r, yb - r, r * 2, r * 2);
      }
      if (fade > 0.01) {
        const water = sp.kind === 'water';
        const col = sp.kind === 'puff' ? '232,234,232' : water ? (night ? '150,165,180' : '242,247,250') : sp.kind === 'hit' ? '36,30,26' : (night ? '50,46,40' : '104,92,74');
        const h = H * rise * (water ? clamp(1.25 - t * 0.28, 0.25, 1) : 1), w = Math.max(1.6, H * (water ? 0.2 : 0.42)) * (1 + t * (water ? 0.25 : 0.55));
        c2.fillStyle = `rgba(${col},${(0.9 * fade).toFixed(3)})`;
        c2.beginPath();
        c2.moveTo(x - w * 0.5, yb); c2.quadraticCurveTo(x - w * 0.75, yb - h * 0.7, x - w * (water ? 0.25 : 0.9), yb - h);
        c2.quadraticCurveTo(x, yb - h * 1.12, x + w * (water ? 0.25 : 0.9), yb - h); c2.quadraticCurveTo(x + w * 0.75, yb - h * 0.7, x + w * 0.5, yb);
        c2.closePath(); c2.fill();
        if (water) { c2.fillStyle = `rgba(${col},${(0.5 * fade).toFixed(3)})`; c2.beginPath(); c2.ellipse(x, yb, w * (1 + t * 0.8), Math.max(1, w * 0.18), 0, 0, 7); c2.fill(); }
      }
    }

    // туман
    if (P.haze) { c2.fillStyle = P.haze; c2.fillRect(0, 0, CW, CH); }

    // дульный дым и вспышка (ближе тумана)
    if (muzzle) {
      const t = muzzle.t, srcs = muzzle.twin ? [-70, 70] : [-70];
      if (t > 0.04) {
        for (const sx of srcs) for (let i = 0; i < 7; i++) {
          const life = (t - i * 0.05) / 4.2;
          if (life <= 0 || life >= 1) continue;
          const h1 = hash(i * 13 + sx), x = CW / 2 + sx + (h1 - 0.5) * 90 * Math.sqrt(life) + muzzle.drift * t * (0.6 + h1 * 0.6);
          const y = CH + 6 - (26 + h1 * 60) * Math.sqrt(life), r = 22 + 70 * life + h1 * 16;
          const a = 0.5 * (1 - life) * Math.min(1, life * 14) * (night ? 0.55 : 1);
          const col = night ? '58,54,50' : '88,84,78';
          g = c2.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, `rgba(${col},${a.toFixed(3)})`); g.addColorStop(1, `rgba(${col},0)`);
          c2.fillStyle = g; c2.fillRect(x - r, y - r, r * 2, r * 2);
        }
      }
      if (t < 0.34) {
        const k = Math.pow(1 - t / 0.34, 1.5);
        for (const sx of srcs) {
          const x = CW / 2 + sx, r = 150 + 240 * (t / 0.34);
          g = c2.createRadialGradient(x, CH + 10, 0, x, CH + 10, r);
          g.addColorStop(0, `rgba(255,250,225,${k.toFixed(3)})`); g.addColorStop(0.3, `rgba(255,205,120,${(0.85 * k).toFixed(3)})`); g.addColorStop(1, 'rgba(255,140,50,0)');
          c2.fillStyle = g; c2.fillRect(0, 0, CW, CH);
        }
      }
    }

    // шкала пеленга на стекле: деления через 1°, подписи через 10°
    const ink = night ? '255,196,120' : '16,24,32';
    c2.fillStyle = night ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.16)';
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
    g = c2.createLinearGradient(0, 0, 0, CH);
    g.addColorStop(0, 'rgba(0,0,0,0.3)'); g.addColorStop(0.1, 'rgba(0,0,0,0)'); g.addColorStop(0.9, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.3)');
    c2.fillStyle = g; c2.fillRect(0, 0, CW, CH);

    info.splashes = splashes.length; info.muzzle = !!muzzle;
    info.redraws++;
    tex.needsUpdate = true;
    drawLayer();
    dirty = false; last = vt; lastBearing = b0;
  }

  const api = {
    mesh, material, canvas, info,
    /** Событие fired: дульная вспышка и дым (при «вилке» — из обоих стволов). */
    fired(e) {
      const tb = game.state.turret ? game.state.turret.bearing : 0;
      let cross = 0;
      try { cross = game.windParts(tb).cross; } catch (err) { cross = 0; }
      muzzle = { t: 0, twin: !!(e && e.salvo), drift: clamp(cross * 9, -90, 90) };
      dirty = true;
    },
    /** Событие impact: далёкий всплеск/вспышка, если разрыв в пределах ±20° от пеленга башни. → true, если показан. */
    impact(e) {
      const s = game.state, m = s.mission;
      if (!e || !m || !m.battery || e.x == null || e.shell === 'illum') return false;
      const dxk = e.x - m.battery.x, dyk = e.y - m.battery.y, d = Math.max(0.3, Math.hypot(dxk, dyk));
      const b = (Math.atan2(dxk, dyk) / DEG + 360) % 360;
      if (Math.abs(wrap180(b - s.turret.bearing)) > VIEW_HALF) return false;
      let lit = false;
      try { lit = !!game.lit(e.x, e.y); } catch (err) { lit = false; }
      const dark = !!m.night && !lit;
      if (dark && d > NIGHT_SEE) return false;
      let isL = false;
      try { isL = game.isLand(e.x, e.y); } catch (err) { isL = false; }
      const hit = !!(e.hits && e.hits.length);
      const kind = e.shell === 'smoke' ? 'puff' : hit ? 'hit' : isL ? 'land' : 'water';
      let dim = dark ? 0.3 : 1;
      if (m.weather === 'fog') dim *= clamp(1.25 - d / 9, 0.25, 1);
      splashes.push({ b, d, t: 0, kind, dim });
      if (splashes.length > 8) splashes.shift();
      dirty = true;
      return true;
    },
    reset() { muzzle = null; splashes.length = 0; dirty = true; land.reset(); if (layer) { layer.fleet.clear(); layer.wing.clear(); layer.mesh.visible = false; } },
    /** here — пост на экране: только тогда холст перерисовывается. */
    update(dt, here) {
      vt += dt;
      if (muzzle && (muzzle.t += dt) > 4.6) { muzzle = null; dirty = true; }
      for (let i = splashes.length - 1; i >= 0; i--) if ((splashes[i].t += dt) > 3.3) { splashes.splice(i, 1); dirty = true; }
      if (!here) { dirty = true; return; }
      const b = game.state.turret ? game.state.turret.bearing : 0;
      const anim = !!muzzle || splashes.length > 0 || hot;
      const gap = vt - last;
      if (last < 0 || (dirty && gap >= 0.03) || (b !== lastBearing && gap >= 0.03) || gap >= (anim ? 0.045 : 0.16)) draw();
    },
    dispose() {
      if (layer) { layer.fleet.clear(); layer.wing.clear(); layer.rt.dispose(); layer.mat.dispose(); layer.maskGeo.dispose(); layer.maskMat.dispose(); layer = null; }
      tex.dispose(); material.dispose(); mesh.geometry.dispose();
    },
  };
  return api;
}
