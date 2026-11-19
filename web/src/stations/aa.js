// Пост «ЗЕНИТКА» (id 'aa'): спаренный зенитный автомат. В проёме щита — небо с кольцевым прицелом по центру,
// внизу стволы, трассы сходятся в точку прицеливания; самолёты растут по мере подхода.
// Органы: планшет наводки (вести пальцем по небу), два рычага привода (пеленг / угол места), гашетка
// (держать — огонь; короткое касание — защёлка: автомат бьёт, пока не коснуться ещё раз, — палец свободен для наводки),
// прибор нагрева с красным сектором и лампой «ПЕРЕГРЕВ», счётчик патронов, лампы «ВОЗДУХ» / «ЧИСТО»,
// счётчики пеленга и угла, шильдик целеуказания и стрелка в прицеле «куда вести стволы».
// Пост ничего не решает сам: показывает game.state.aa / game.state.raid и вызывает game.slewAA()/game.fireAA().
// Небо рисуется и обновляется только пока пост текущий; для соседей проём закрыт заслонкой.
// Небо — шейдер «по углам» (seasky.js): каждый пиксель проёма → пеленг/угол места → то же небо, солнце, облака, море и
// время суток, что в смотровой щели и в трубе. Самолёты освещены солнцем задания (не светом башни); трассы светятся,
// у точки прицеливания рвутся снаряды (клубки разрывов), сбитый — огненный шар и дымный след, бомба — столб воды и вспышка.
// Частицы (seasky.createParticles) — один вызов отрисовки; они «привязаны к миру»: при наводке сдвигаются вместе с небом.
// Hotspots: aaPad, aaFire (он же aaTrigger — имя из подсказок обучения), aaSlewB, aaSlewE.
import { makePlane } from './ships.js';
import { lookFor, createSkyPlaneMaterial, createLitColorMaterial, createParticles, PK, rnd } from './seasky.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap180 = (a) => ((a + 540) % 360 + 360) % 360 - 180;
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };


// проём и геометрия вида (локальные координаты поста)
const WIN = { x0: -0.46, x1: 0.46, y0: 1.0, y1: 1.44 };
const CAM = [0, 1.42, 1.34];
const SKY_Z = -0.62;                  // глубина «неба» за проёмом
const VIEW_DEG = 20;                  // ° по ширине проёма
const SLEW_B = 48, SLEW_E = 26;       // °/с рычагов при полном отклонении
const FALL = 3;                       // с — падение сбитого самолёта

export function createAAStation(ctx) {
  const { engine, THREE, ui, mat, audio, game } = ctx;
  const PAL = mat.PALETTE, G = engine.geom, T = engine.textures;
  const group = new THREE.Group();
  group.name = 'station:aa';
  const kept = [], offs = [], own = [];          // органы, отписки, свои геометрии/материалы/текстуры
  const keep = (c) => { kept.push(c); return c; };
  const res = (o) => { own.push(o); return o; };
  const put = (ctl, x, y, z = 0, rz = 0) => { const o = ctl.object3D || ctl; o.position.set(x, y, z); o.rotation.z = rz; group.add(o); return ctl; };
  const snd = (name, ...a) => { try { if (audio && audio[name]) audio[name](...a); } catch (e) { /* звук не обязателен */ } };

  // ---------- корпус: тумба и щит с проёмом ----------
  put(keep(ui.panel({ w: 1.62, h: 0.74, d: 0.44, color: PAL.panelDark, rivets: 0.12, wear: 0.8 })), 0, 0.41, -0.5);
  const wcx = (WIN.x0 + WIN.x1) / 2, wcy = (WIN.y0 + WIN.y1) / 2, ww = WIN.x1 - WIN.x0, wh = WIN.y1 - WIN.y0;
  const sideW = 0.86 + WIN.x0;
  put(keep(ui.panel({ w: sideW, h: 0.73, d: 0.06, rivets: 0.1 })), -0.86 + sideW / 2, 1.105, -0.06);
  put(keep(ui.panel({ w: sideW, h: 0.73, d: 0.06, rivets: 0.1 })), 0.86 - sideW / 2, 1.105, -0.06);
  put(keep(ui.panel({ w: ww, h: WIN.y0 - 0.74, d: 0.06, rivets: false })), wcx, (WIN.y0 + 0.74) / 2, -0.06);
  put(keep(ui.panel({ w: ww, h: 1.47 - WIN.y1, d: 0.06, rivets: false })), wcx, (WIN.y1 + 1.47) / 2, -0.06);
  // заслонка: закрывает проём, пока пост не текущий (небо тогда не рисуется)
  const shutter = put(keep(ui.panel({ w: ww + 0.04, h: wh + 0.04, d: 0.012, color: PAL.panelDark, rivets: 0.11, wear: 0.8 })), wcx, wcy, -0.05);

  // ---------- небо ----------
  // Ось прицела — луч от камеры через центр проёма; «небо» стоит перпендикулярно ему на глубине SKY_Z.
  const kz = (CAM[2] - SKY_Z) / CAM[2];
  const P0 = [wcx, CAM[1] + (wcy - CAM[1]) * kz, SKY_Z];
  const M = ww * kz / VIEW_DEG;                  // метров на градус в плоскости неба
  const sky = new THREE.Group();
  sky.name = 'aaSky';
  sky.position.set(P0[0], P0[1], P0[2]);
  sky.rotation.x = -Math.atan2(CAM[1] - P0[1], CAM[2] - P0[2]);
  sky.visible = false;
  group.add(sky);

  const BW = 1.7, BH = 0.96, BY = -0.115;        // задник с запасом на тряску камеры; сдвинут вниз, чтобы не торчал над щитом
  const skyMat = res(createSkyPlaneMaterial(engine.quality));
  skyMat.uniforms.uM.value = M; skyMat.uniforms.uEye.value = 18;
  const backGeo = res(new THREE.PlaneGeometry(BW, BH)); backGeo.translate(0, BY, 0);
  const back = new THREE.Mesh(backGeo, skyMat);
  back.name = 'aaSkyBack';
  sky.add(back);
  offs.push(engine.on('quality', (q) => skyMat.userData.setQuality(q)));
  // самолёты: свет неба задания, не помещения
  const planeMat = res(createLitColorMaterial());
  // частицы: разрывы снарядов, дымные следы, огненные шары, столб воды от бомбы
  const fxp = createParticles(THREE, { max: 220 });
  fxp.mesh.renderOrder = 3;
  sky.add(fxp.mesh);
  own.push(fxp);
  let fxAim = null;
  // козырёк над проёмом: закрывает задник сверху при любом положении камеры
  { const hood = new THREE.Mesh(res(new THREE.BoxGeometry(ww + 0.5, 0.02, 0.7)), mat.paint(PAL.panelDark, { wear: 0.8 })); hood.position.set(wcx, 1.478, -0.41); group.add(hood); }

  const info = { mode: '', tod: '', paints: 0, planes: 0, tracers: 0, arrow: false, seek: false, shooting: false, flash: 0, falling: 0, current: false, particles: 0 };

  let look = null;
  function applyLook(L, mode) {
    look = L;
    skyMat.userData.setLook(L); planeMat.userData.setLook(L);
    planeMat.uniforms.uHazeK.value = L.fog ? 0.3 : L.storm ? 0.12 : 0;
    const night = L.night, storm = L.storm;
    info.mode = mode; info.tod = L.tod; info.paints++;
    reticleMat.color.set(night ? '#ffb347' : storm ? '#e8e0c8' : L.tod === 'evening' || L.tod === 'dawn' ? '#1a1410' : '#11161b');
    reticleMat.opacity = night ? 0.7 : 0.85;
  }

  // кольцевой прицел: кольца 1.1° / 2.2° (зона поражения, game.C.AA_CONE) / 3.3°, перекрестие с рисками
  const CONE = (game.C && game.C.AA_CONE) || 2.2;
  const reticleMat = res(new THREE.MeshBasicMaterial({ color: 0x11161b, transparent: true, opacity: 0.85, depthWrite: false }));
  {
    const parts = [];
    const ring = (r, w) => parts.push(new THREE.RingGeometry(r * M - w / 2, r * M + w / 2, 64));
    ring(CONE / 2, 0.004); ring(CONE, 0.0075); ring(CONE * 1.5, 0.004);
    const bar = (x, y, w, h) => { const p = new THREE.PlaneGeometry(w, h); p.translate(x, y, 0); parts.push(p); };
    const a = 0.22 * M, b = CONE * 1.5 * M + 0.03;
    bar((a + b) / 2, 0, b - a, 0.004); bar(-(a + b) / 2, 0, b - a, 0.004);
    bar(0, (a + b) / 2, 0.004, b - a); bar(0, -(a + b) / 2, 0.004, b - a);
    for (let d = 0.5; d < CONE * 1.5; d += 0.5) {
      if (Math.abs(d - CONE) < 0.01 || Math.abs(d - CONE / 2) < 0.01) continue;
      const h = d % 1 === 0 ? 0.022 : 0.012;
      bar(d * M, 0, 0.003, h); bar(-d * M, 0, 0.003, h); bar(0, d * M, h, 0.003); bar(0, -d * M, h, 0.003);
    }
    parts.push(new THREE.CircleGeometry(0.006, 12));
    const reticle = new THREE.Mesh(res(G.merge(parts)), reticleMat);
    reticle.position.z = 0.15; reticle.renderOrder = 5;
    sky.add(reticle);
  }

  // стрелка «цель там» — на окружности вне колец
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(0.034, 0); arrowShape.lineTo(-0.02, 0.024); arrowShape.lineTo(-0.008, 0); arrowShape.lineTo(-0.02, -0.024); arrowShape.closePath();
  const arrow = new THREE.Mesh(res(new THREE.ShapeGeometry(arrowShape)), mat.emissive('amber', 1));
  arrow.position.z = 0.16; arrow.visible = false; arrow.renderOrder = 6;
  sky.add(arrow);
  const ARROW_R = 3.95 * M;

  // стволы: снизу проёма, сходятся к оси; откат по своей оси
  const tips = [new THREE.Vector3(-0.085, -0.205, 0.1), new THREE.Vector3(0.085, -0.205, 0.1)];
  const barrels = tips.map((tip, i) => {
    const s = i ? 1 : -1, base = [s * 0.19, -0.47, 0.5];
    const dir = new THREE.Vector3(base[0] - tip.x, base[1] - tip.y, base[2] - tip.z).normalize();
    const mid = [tip.x + dir.x * 0.06, tip.y + dir.y * 0.06, tip.z + dir.z * 0.06];
    const gm = res(G.merge([
      G.rod([tip.x, tip.y, tip.z], mid, 0.013, 10, 0.02),               // пламегаситель
      G.rod(mid, base, 0.0125, 10, 0.026),
    ]));
    const m = new THREE.Mesh(gm, mat.darkSteel);
    sky.add(m);
    const flash = new THREE.Sprite(mat.glowSprite('#ffd9a0', 0.95));
    flash.position.copy(tip).addScaledVector(dir, -0.012); flash.scale.setScalar(0.11); flash.visible = false;
    sky.add(flash);
    return { mesh: m, dir, flash, kick: 0 };
  });

  // трассы: один InstancedMesh
  const NTR = 8;
  const trGeo = res(new THREE.PlaneGeometry(0.022, 0.14));
  // трасса: яркая голова и тающий хвост, светится (сложение, цвет выше единицы — свечение постобработки)
  const trMat = res(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; vec4 p = vec4(position, 1.0); \n#ifdef USE_INSTANCING\n p = instanceMatrix * p; \n#endif\n gl_Position = projectionMatrix * modelViewMatrix * p; }',
    fragmentShader: `varying vec2 vUv;
      void main(){ float x = abs(vUv.x - 0.5) * 2.0, core = smoothstep(1.0, 0.0, x), y = vUv.y;
        float a = core * core * smoothstep(0.0, 0.85, y) * (0.35 + 0.65 * y);
        vec3 c = mix(vec3(1.0, 0.36, 0.08), vec3(1.4, 1.15, 0.7), smoothstep(0.75, 1.0, y) * smoothstep(0.6, 0.0, x));
        gl_FragColor = vec4(c * a, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  const tracers = new THREE.InstancedMesh(trGeo, trMat, NTR);
  tracers.frustumCulled = false; tracers.count = 0; tracers.renderOrder = 4;
  sky.add(tracers);
  const trs = [];                                // { s, from, tx, ty }
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1), _sun = new THREE.Vector3();

  // вспышки и дым разрывов (пул спрайтов)
  const spark = new THREE.Sprite(mat.glowSprite('#fff3d6', 0.9)); spark.visible = false; sky.add(spark);
  // вспышка бомбы на весь проём
  const bombMat = res(new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  const bombFlash = new THREE.Mesh(back.geometry, bombMat);
  bombFlash.position.set(0, 0, 0.2); bombFlash.visible = false; bombFlash.renderOrder = 7;
  sky.add(bombFlash);
  let bombT = -1;

  // самолёты: модель на каждый id налёта
  const planes = new Map();                      // id → { grp, hit, seen }
  let seenStamp = 0;
  const freePlanes = [];
  function planeFor(id) {
    let r = planes.get(id);
    if (!r) {
      const grp = freePlanes.pop() || makePlane({ material: planeMat });
      grp.rotation.order = 'YXZ';
      sky.add(grp);
      r = { grp, hit: 0, seen: 0 };
      planes.set(id, r);
    }
    r.seen = seenStamp;
    return r;
  }
  function dropPlane(id) { const r = planes.get(id); if (!r) return; r.grp.visible = false; freePlanes.push(r.grp); planes.delete(id); }

  // ---------- органы управления ----------
  const sens = () => { try { const s = game.settings && game.settings(); return clamp((s && s.sens) || 1, 0.6, 1.6); } catch (e) { return 1; } };

  // планшет наводки: вести пальцем по небу
  const pad = G.hitBox(ww, wh, 0.02, 0, 0, 0.01);
  pad.position.set(wcx, wcy, -0.03);
  group.add(pad);
  let padK = 0.05, padHeld = false;
  const _v = new THREE.Vector3();
  offs.push(engine.input.add(pad, {
    onDown() {
      pad.updateWorldMatrix(true, false);
      const a = engine.input.toScreen(_v.set(-ww / 2, 0, 0).applyMatrix4(pad.matrixWorld), {});
      const b = engine.input.toScreen(_v.set(ww / 2, 0, 0).applyMatrix4(pad.matrixWorld), {});
      const px = Math.hypot(b.x - a.x, b.y - a.y);
      padK = px > 20 ? VIEW_DEG / px : 0.05;           // °/px при ходе 1:1
      padHeld = true;
    },
    onDrag(e) {
      if (!padHeld) return;
      const d = Math.hypot(e.dx, e.dy);
      if (!d) return;
      const k = padK * sens() * (0.9 + Math.min(2.6, d / 9));   // быстрый мах — крупный переброс
      game.slewAA(e.dx * k, -e.dy * k);
    },
    onUp() { padHeld = false; },
  }));

  // рычаги привода
  let vB = 0, vE = 0;
  const slewB = put(keep(ui.slewLever({ length: 0.115, labels: ['ВЛЕВО', 'ВПРАВО'], onInput(v) { vB = v; } })), -0.2, 0.792);
  const slewE = put(keep(ui.slewLever({ length: 0.115, labels: false, onInput(v) { vE = v; } })), 0.3, 0.87, 0, Math.PI / 2);
  put(keep(ui.plate('ВЫШЕ', { size: 0.02, screws: false })), 0.405, 0.95);
  put(keep(ui.plate('НИЖЕ', { size: 0.02, screws: false })), 0.405, 0.79);
  const targetPlate = put(keep(ui.plate('ЦЕЛЕЙ НЕТ', { size: 0.022, style: 'ivory', w: 0.3, screws: false })), -0.06, 0.957);

  // гашетка с ограждением
  const fireG = new THREE.Group();
  fireG.name = 'aaFire';
  fireG.add(new THREE.Mesh(res(G.merge([
    G.lathe([[0.094, 0], [0.094, 0.012], [0.082, 0.02], [0.074, 0.02], [0.074, 0.006], [0, 0.006]], 28),
    G.xf(G.slab(0.016, 0.2, 0.06, { r: 0.006, bevel: 0.002 }), { p: [-0.108, 0, 0] }),
    G.xf(G.slab(0.016, 0.2, 0.06, { r: 0.006, bevel: 0.002 }), { p: [0.108, 0, 0] }),
  ])), mat.steel));
  const capOff = mat.paint('#8f1d14', { wear: 0.3 }), capOn = mat.emissive('red', 1);
  const capGeo = res(G.lathe([[0.07, 0], [0.07, 0.024], [0.062, 0.034], [0, 0.036]], 28));
  const cap = new THREE.Mesh(capGeo, capOff);
  cap.position.z = 0.012;
  fireG.add(cap);
  const fireHit = G.hitCylinder(0.1, 0.07);
  fireG.add(fireHit);
  put(fireG, 0.66, 1.2);
  put(keep(ui.plate('ОГОНЬ', { size: 0.026, style: 'red' })), 0.66, 1.068);
  const fireBtn = { object3D: fireG, pressed: false, latched: false };
  let wasLatched = false;
  const release = () => { fireBtn.latched = false; if (game.state.aa && game.state.aa.firing) game.fireAA(false); };
  offs.push(engine.input.add(fireHit, {
    onDown() {
      fireBtn.pressed = true; wasLatched = fireBtn.latched;
      snd('clunk');
      const r = game.fireAA(true);
      if (!r || !r.ok) snd('buzz');
    },
    onUp(e) {
      fireBtn.pressed = false;
      const firing = !!(game.state.aa && game.state.aa.firing);
      // короткое касание — защёлка; повторное касание, долгое удержание или отмена жеста — отбой
      if (!firing || wasLatched || (e && (e.cancelled || e.duration > 350))) release();
      else fireBtn.latched = true;
    },
  }, { multi: true }));        // второй палец: один ведёт прицел (планшет или рычаги), другой давит гашетку

  // приборы
  const gHeat = put(keep(ui.gauge({ radius: 0.082, min: 0, max: 100, majorStep: 20, minorStep: 10, caption: 'НАГРЕВ', captionSize: 0.024, zones: [{ from: 80, to: 100 }], speed: 12, damping: 0.8 })), -0.66, 1.345);
  const lampHot = put(keep(ui.lamp({ color: 'red', label: 'ПЕРЕГРЕВ', labelSize: 0.022 })), -0.775, 1.17);
  const cAmmo = put(keep(ui.drumCounter({ digits: 3, decimals: 0, label: 'ПАТРОНЫ', labelSize: 0.022, digitH: 0.044, value: 0 })), -0.585, 1.125);
  const cBearing = put(keep(ui.drumCounter({ digits: 3, decimals: 0, label: 'ПЕЛЕНГ', labelSize: 0.022, digitH: 0.04, wrap: 360, unit: '°' })), -0.66, 0.955);
  const cElev = put(keep(ui.drumCounter({ digits: 2, decimals: 0, label: 'УГОЛ', labelSize: 0.022, digitH: 0.04, unit: '°' })), -0.66, 0.815);
  const lampAir = put(keep(ui.lamp({ color: 'red', label: 'ВОЗДУХ', labelSize: 0.022 })), 0.575, 1.405);
  const lampClear = put(keep(ui.lamp({ color: 'green', label: 'ЧИСТО', labelSize: 0.022 })), 0.745, 1.405);

  // ---------- события ----------
  let warned = false, lastShot = 0, shotSide = 0, shotAcc = 0, lastText = '';
  offs.push(game.on('raid', (e) => {
    if (e.phase === 'warning') { warned = true; snd('siren'); }
    else warned = false;
  }));
  offs.push(game.on('plane', (e) => {
    const cur = engine.current === 'aa';
    if (e.down) {
      const p = game.state.raid && game.state.raid.planes.find((q) => q.id === e.id);
      if (p && cur) {                                          // огненный шар и обломки (огонь самолёта — ships.js)
        const a = game.state.aa;
        proj(p.bearing, p.elevation, a, _o);
        const sz = sizeOf(p.range) * M;
        for (let i = 0; i < 7; i++) fxp.emit(PK.SMOKE, _o.x + (rnd() - 0.5) * sz * 0.5, _o.y + (rnd() - 0.5) * sz * 0.4, 0.07, (rnd() - 0.5) * sz * 0.6, (rnd() - 0.3) * sz * 0.5, 0,
          sz * 0.55, 1.8, 2.4 + rnd(), 1.9, 0.95, 0.35, 1, 2, 0, 0.6, 0, 1);
        fxp.emit(PK.GLOW, _o.x, _o.y, 0.09, 0, 0, 0, sz * 1.1, 0.6, 0.3, 1.5, 0.95, 0.45, 1, 1, 0, 0, 0, 1);
        for (let i = 0; i < 6; i++) { const an = rnd() * 6.283, v = sz * (0.8 + rnd()); fxp.emit(PK.GLOW, _o.x, _o.y, 0.08, Math.cos(an) * v, Math.sin(an) * v, 0, sz * 0.12, 0, 0.9 + rnd() * 0.5, 1.8, 0.9, 0.4, 1, 1, sz * 2, 0.4, 0, 1); }
        snd('impactFar');
      }
    } else if (e.bombed && cur) {
      bombT = 0;
      // столб воды от бомбы у башни: внизу проёма, по пеленгу самолёта
      const a = game.state.aa, p = game.state.raid && game.state.raid.planes.find((q) => q.id === e.id);
      if (a && p) {
        proj(p.bearing + (rnd() - 0.5) * 6, -1.6, a, _o);
        const H = 6 * M;
        for (let i = 0; i < 10; i++) fxp.emit(PK.WATER, _o.x + (rnd() - 0.5) * H * 0.3, _o.y, 0.05, (rnd() - 0.5) * H * 0.2, H * (1.2 + rnd() * 0.9), 0, H * 0.22, 1, 2.2 + rnd(), 0.85, 0.9, 0.93, 0.9, 3, H * 1.1, 0.2, 0);
      }
      snd('bombHit');
      try { engine.shake(1.3, 0.8); } catch (err) { /* нет тряски */ }
    }
  }));
  offs.push(game.on('aa', (e) => { if (e.jammed) { release(); if (engine.current === 'aa') snd('buzz'); } }));
  // гул самолётов слышен на любом посту
  let droneLvl = 0;
  offs.push(engine.onFrame(() => {
    const s = game.state, R = s.raid;
    let lvl = 0;
    if (R && s.phase === 'playing' && !s.paused) {
      let near = Infinity;
      for (const p of R.planes) if (p.alive && p.range < near) near = p.range;
      if (near < Infinity) lvl = clamp(1 - near / 8, 0.06, 1) * (engine.current === 'aa' ? 1 : 0.6);
    }
    if (Math.abs(lvl - droneLvl) > 0.02 || (lvl === 0 && droneLvl !== 0)) { droneLvl = lvl; snd('planeDrone', lvl); }
  }));

  // ---------- кадр ----------
  const proj = (b, e, a, out) => { out.x = wrap180(b - a.bearing) * Math.cos(e * DEG) * M; out.y = (e - a.elevation) * M; return out; };
  const _o = { x: 0, y: 0 };
  const sizeOf = (range) => clamp(0.9 + 2.6 / Math.max(0.2, range), 0.9, 7);     // видимый размах, ° (сильно увеличен против натуры — для читаемости на телефоне)

  function update(dt, time) {
    const s = game.state, a = s.aa;
    if (!a) return;
    const cur = engine.current === 'aa';
    info.current = cur;
    sky.visible = cur; shutter.object3D.visible = !cur;

    // приборы и лампы (дёшево — и для соседнего поста тоже)
    const R = s.raid, live = !!R && R.planes.some((p) => p.alive);
    const shooting = !!a.firing && !a.jammed && a.ammo > 0 && s.phase === 'playing' && !s.paused;
    info.shooting = shooting;
    if (!a.firing) fireBtn.latched = false;
    gHeat.setValue(a.heat * 100);
    lampHot.set(a.jammed ? 'blink' : a.heat > 0.8);
    cAmmo.setValue(a.ammo);
    cBearing.setValue(a.bearing); cElev.setValue(a.elevation);
    if (R) warned = false;
    lampAir.set(live && R.phase === 'inbound' ? true : warned ? 'blink' : false);
    lampClear.set(!live && !warned && s.phase === 'playing');
    cap.material = shooting ? capOn : capOff;
    cap.position.z = 0.012 - (fireBtn.pressed || fireBtn.latched ? 0.014 : 0);

    if (!cur) return;

    // привод от рычагов
    if (vB || vE) {
      game.slewAA(vB * Math.abs(vB) * SLEW_B * dt, vE * Math.abs(vE) * SLEW_E * dt);
      snd('servo', Math.max(Math.abs(vB), Math.abs(vE)) * 0.8);
    } else if (servoOn) snd('servo', 0);
    servoOn = !!(vB || vE);

    // небо
    const m = s.mission || {}, w = m.weather || 'clear', fog = w === 'fog';
    const mode = m.night ? (w === 'storm' ? 'nightStorm' : fog ? 'nightFog' : 'night') : (w === 'storm' ? 'storm' : fog ? 'fog' : 'day');
    const L = lookFor(m);
    if (L !== look || mode !== info.mode) applyLook(L, mode);
    const su = skyMat.uniforms;
    su.uAim.value.set(a.bearing, a.elevation); su.uTime.value = time;
    { const wd = m.wind || {}, to = ((wd.from || 0) + 180) * DEG, cs = (L.storm ? 0.012 : 0.004) * (1 + (wd.speed || 0) / 8);
      su.uCloudOff.value.set(L.cloudSeed + Math.sin(to) * time * cs, L.cloudSeed * 0.7 - Math.cos(to) * time * cs); }
    su.uPixAng.value = DEG / (M * 900);
    // солнце для самолётов: из мира задания в систему неба за проёмом, затем в мировые координаты сцены башни
    { const B = a.bearing * DEG, E = a.elevation * DEG, sd = L.sunDir;
      const fx = Math.sin(B) * Math.cos(E), fy = Math.sin(E), fz = -Math.cos(B) * Math.cos(E);
      const rx = Math.cos(B), rz = Math.sin(B);                     // вправо
      const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;      // вверх = вправо × вперёд
      _sun.set(sd.x * rx + sd.z * rz, sd.x * ux + sd.y * uy + sd.z * uz, -(sd.x * fx + sd.y * fy + sd.z * fz));
      sky.getWorldQuaternion(_q); planeMat.uniforms.uSun.value.copy(_sun.applyQuaternion(_q)).normalize(); }
    // частицы привязаны к миру: небо «поехало» при наводке — сдвигаем и их
    if (fxAim) { const dB = wrap180(a.bearing - fxAim.b), dE = a.elevation - fxAim.e; if (dB || dE) fxp.translate(-dB * Math.cos(a.elevation * DEG) * M, -dE * M, 0); }
    else fxAim = { b: 0, e: 0 };
    fxAim.b = a.bearing; fxAim.e = a.elevation;
    fxp.update(dt);
    fxp.clearImmediate();

    // самолёты
    let shown = 0, falling = 0, best = null, sparkOn = false;
    seenStamp++;
    if (R) {
      for (const p of R.planes) {
        const fall = p.alive ? 0 : (p.downAt != null ? s.time - p.downAt : FALL);
        if (!p.alive && fall >= FALL) continue;
        if (p.alive && fog && p.range > 4.6) { if (!best || p.range < best.range) best = p; continue; }
        const r = planeFor(p.id), g = r.grp, sz = sizeOf(p.range), U = g.userData;
        proj(p.bearing, p.elevation, a, _o);
        let x = _o.x, y = _o.y;
        if (!p.alive) {                                         // падает: вниз и в сторону, горит
          const k = fall / FALL;
          x += (hash(p.id) - 0.5) * 3 * k * M; y -= (1.2 * fall + 1.3 * fall * fall) * M;
          falling++;
        }
        g.visible = Math.abs(x) < BW / 2 + 0.2 && Math.abs(y) < BH / 2 + 0.2;
        g.position.set(x, y, 0.06);
        g.scale.setScalar(sz * M / ((U.size && U.size.span) || 14));
        const out = !!p.attacked;
        g.rotation.set(-(out ? -1 : 1) * p.elevation * DEG * 0.6, out ? Math.PI / 2 : -Math.PI / 2, Math.sin(time * 1.3 + p.id * 2.1) * 0.12);
        if (U.setState) U.setState({ burning: !p.alive || p.hit > 0.45, down: p.alive ? 0 : fall / FALL });
        if (U.update && g.visible) U.update(dt, time, fxp);
        if (g.visible) shown++;
        if (p.alive) {
          if (p.hit > r.hit + 1e-6 && shooting) { sparkOn = true; spark.position.set(x + (Math.random() - 0.5) * sz * M * 0.6, y + (Math.random() - 0.5) * sz * M * 0.3, 0.09); spark.scale.setScalar((0.5 + Math.random() * 0.8) * Math.max(0.03, sz * M * 0.5)); }
          r.hit = p.hit;
          if (!best || (best.attacked && !p.attacked) || (best.attacked === p.attacked && p.range < best.range)) best = p;
        }
      }
    }
    for (const [id, r] of planes) if (r.seen !== seenStamp) dropPlane(id);        // удаление из Map в обходе безопасно
    spark.visible = sparkOn;
    info.planes = shown; info.falling = falling;

    // целеуказание: шильдик и стрелка
    let text = 'ЦЕЛЕЙ НЕТ', arrowOn = false, seek = false;
    if (best) {
      text = 'ЦЕЛЬ ' + String(Math.round(best.bearing) % 360).padStart(3, '0') + '° УГОЛ ' + Math.round(best.elevation) + '°';
      proj(best.bearing, best.elevation, a, _o);
      const d = Math.hypot(_o.x, _o.y);
      if (d > CONE * 1.5 * M) {
        const an = Math.atan2(_o.y, _o.x);
        arrow.position.x = Math.cos(an) * ARROW_R; arrow.position.y = Math.sin(an) * ARROW_R; arrow.rotation.z = an;
        const far = d > 12 * M;
        seek = true;
        arrow.scale.setScalar(far ? 1.25 : 1);
        arrowOn = !far || (time * 3) % 1 < 0.7;              // далеко — мигает
      }
    }
    arrow.visible = arrowOn; info.arrow = arrowOn; info.seek = seek;      // seek — стрелка «включена» (вдали она мигает)
    if (text !== lastText) { lastText = text; targetPlate.setText(text); }

    // огонь: откат, вспышки, трассы
    if (shooting) {
      shotAcc += dt * 8;
      while (shotAcc >= 1) {
        shotAcc -= 1; shotSide ^= 1;
        const B = barrels[shotSide];
        B.kick = 1; lastShot = time;
        if (trs.length < NTR) trs.push({ s: 0, from: shotSide, tx: (Math.random() - 0.5) * 0.03, ty: (Math.random() - 0.5) * 0.03, boom: rnd() < 0.55 });
        snd('aaBurst');
      }
    } else shotAcc = 0.99;                                     // первый выстрел — сразу
    for (const B of barrels) {
      B.kick = Math.max(0, B.kick - dt * 9);
      B.mesh.position.copy(B.dir).multiplyScalar(B.kick * 0.035);
      B.flash.visible = B.kick > 0.55;
      if (B.flash.visible) B.flash.scale.setScalar(0.08 + Math.random() * 0.07);
    }
    let nt = 0;
    for (let i = trs.length - 1; i >= 0; i--) {
      const t = trs[i];
      t.s += dt / 0.42;
      if (t.s >= 1) {                                              // снаряд долетел до точки прицеливания — разрыв-клубок
        if (t.boom) {
          const x = t.tx + (rnd() - 0.5) * CONE * M * 1.4, y = t.ty + (rnd() - 0.5) * CONE * M * 1.4, r0 = 0.012 + rnd() * 0.008;
          fxp.emit(PK.GLOW, x, y, 0.05, 0, 0, 0, r0 * 2.2, 0.3, 0.16, 2, 1.4, 0.7, 1, 1, 0, 0, 0, 1);
          const g = look && look.night ? 0.05 : 0.11 + rnd() * 0.05;
          fxp.emit(PK.SMOKE, x, y, 0.04, (rnd() - 0.5) * 0.004, 0.002, 0, r0, 2.4, 2.6 + rnd() * 1.4, g, g * 0.96, g * 0.92, 0.85, 0, 0, 0, 0);
        }
        trs.splice(i, 1); continue;
      }
    }
    for (const t of trs) {
      const tip = tips[t.from], e = 1 - (1 - t.s) * (1 - t.s), k = 1 - 0.9 * e;
      _p.set(tip.x + (t.tx - tip.x) * e, tip.y + (t.ty - tip.y) * e, tip.z + (0.03 - tip.z) * e);
      _q.setFromAxisAngle(_z, Math.atan2(t.ty - tip.y, t.tx - tip.x) - Math.PI / 2);
      _s.set(k, k, 1);
      tracers.setMatrixAt(nt++, _m4.compose(_p, _q, _s));
    }
    tracers.count = nt; tracers.visible = nt > 0;
    if (nt) tracers.instanceMatrix.needsUpdate = true;
    info.tracers = nt;

    // дульное пламя: светящиеся «звёзды» у срезов
    for (const B of barrels) if (B.kick > 0.55) { const tp = tips[barrels.indexOf(B)]; fxp.put(PK.GLOW, tp.x, tp.y, tp.z + 0.02, 0.05 + rnd() * 0.03, 1.8, 1.2, 0.6, 1, 1); }
    info.particles = fxp.write();
    // вспышка бомбы
    if (bombT >= 0) {
      bombT += dt;
      const k = Math.max(0, 1 - bombT / 0.7);
      bombMat.opacity = k * k * 0.95; bombFlash.visible = k > 0; info.flash = bombMat.opacity;
      if (k <= 0) bombT = -1;
    } else { bombFlash.visible = false; info.flash = 0; }
  }
  let servoOn = false;

  function quiet() {
    release(); fireBtn.pressed = false; padHeld = false;
    if (servoOn) { snd('servo', 0); servoOn = false; }
    trs.length = 0; tracers.count = 0; tracers.visible = false;
    fxp.clear(); fxAim = null;
    for (const B of barrels) { B.kick = 0; B.flash.visible = false; B.mesh.position.set(0, 0, 0); }
    spark.visible = false;
  }

  return {
    id: 'aa', title: 'ЗЕНИТКА', group,
    camera: { position: CAM.slice(), target: [0, 1.15, 0], fov: 48 },
    update,
    onEnter() { sky.visible = true; shutter.object3D.visible = false; },
    onLeave() { quiet(); sky.visible = false; shutter.object3D.visible = true; },
    hotspots: { aaPad: pad, aaFire: fireG, aaTrigger: fireG, aaSlewB: slewB.handle || slewB.object3D, aaSlewE: slewE.handle || slewE.object3D },
    /** Для тестов и отладки (не для игровой логики). */
    controls: { pad, fireBtn, slewB, slewE, gHeat, lampHot, cAmmo, cBearing, cElev, lampAir, lampClear, targetPlate, sky, shutter, arrow, tracers, planes, info, degPerM: 1 / M },
    dispose() {
      quiet();
      snd('planeDrone', 0);
      offs.forEach((f) => { try { f(); } catch (e) { /* уже снято */ } });
      kept.forEach((c) => { if (c.dispose) c.dispose(); });
      for (const r of planes.values()) freePlanes.push(r.grp);
      freePlanes.forEach((g) => { if (g.userData.dispose) g.userData.dispose(); g.removeFromParent(); });
      own.forEach((o) => { if (o.dispose) o.dispose(); });
    },
  };
}
