// Движок «АРТА: Башня» — DESIGN §5. Точка входа: createEngine(canvas, opts).
import * as THREE from 'three';
import { loadFonts, fontState } from './fonts.js';
import { setMaxAnisotropy } from './textures.js';
import * as textures from './textures.js';
import * as geom from './geom.js';
import { createMaterials } from './materials.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createRoom, ROOM } from './room.js';
import { createUI } from './controls/index.js';

export { ROOM };
export const DEFAULT_CAMERA = { position: [0, 1.42, 1.25], target: [0, 1.08, 0], fov: 46 };

const TAU = Math.PI * 2;
const wrapPi = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function normPose(pose, base) {
  const b = base || DEFAULT_CAMERA, p = pose || {};
  const v = (a, d) => new THREE.Vector3().fromArray(a && a.isVector3 ? a.toArray() : (a || d));
  return { pos: v(p.position, b.position), target: v(p.target, b.target), fov: p.fov || b.fov };
}

/** Процедурная карта окружения: тёмное помещение с тёплыми лампами (чтобы металл не был чёрным). */
function buildEnvironment(renderer) {
  const s = new THREE.Scene();
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(6, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: [
        'varying vec3 vP;',
        'void main(){',
        '  float h = normalize(vP).y;',
        '  vec3 lo = vec3(0.012, 0.014, 0.017), mid = vec3(0.055, 0.064, 0.075), hi = vec3(0.10, 0.085, 0.065);',
        '  vec3 c = h < 0.0 ? mix(mid, lo, clamp(-h * 1.6, 0.0, 1.0)) : mix(mid, hi, clamp(h * 1.3, 0.0, 1.0));',
        '  gl_FragColor = vec4(c, 1.0);',
        '}'].join('\n'),
    }));
  s.add(shell);
  const lampGeo = new THREE.BoxGeometry(1, 1, 1);
  const lamp = (color, intensity, pos, scale) => {
    const m = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) }));
    m.position.fromArray(pos); m.scale.fromArray(scale); s.add(m); return m;
  };
  lamp('#ffd9a8', 9, [-2.6, 3.2, 2.2], [1.6, 0.3, 1.6]);      // ключ: сверху-слева, из-за спины
  lamp('#ffe6c4', 5, [3.0, 2.4, 2.8], [1.0, 0.8, 0.3]);       // тёплая лампа справа
  lamp('#9db8d8', 2.2, [4.5, 0.4, -1.0], [0.3, 2.2, 3.0]);    // холодный отсвет сбоку
  lamp('#ffcf96', 3.5, [0.0, 4.6, -1.5], [3.2, 0.2, 1.0]);    // полоса над пультом
  lamp('#ffcf96', 2.5, [-4.2, 1.2, -2.5], [0.3, 1.0, 1.2]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(s, 0.03);
  pmrem.dispose();
  shell.geometry.dispose(); shell.material.dispose(); lampGeo.dispose();
  s.traverse(o => { if (o.isMesh && o.material !== shell.material) o.material.dispose(); });
  return rt;
}

/**
 * Создаёт движок. Ждёт загрузки шрифта Oswald.
 * opts: { debug=false, maxPixelRatio=2, exposure=1.0 }
 */
export async function createEngine(canvas, opts = {}) {
  await loadFonts();

  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: false, stencil: false, powerPreference: 'high-performance',
  });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = opts.exposure || 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;
  setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());
  const maxPixelRatio = opts.maxPixelRatio || 2;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050607);
  const envRT = buildEnvironment(renderer);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(DEFAULT_CAMERA.fov, 2, 0.05, 30);
  scene.add(camera);

  // --- свет (§3): полусферический + ключевой у текущего поста + два заполняющих. Теней нет. ---
  const hemi = new THREE.HemisphereLight(0x9a8f7c, 0x14181d, 0.55);
  const keyLight = new THREE.PointLight(0xffd7a3, 14, 9, 1.7);
  const fillCeil = new THREE.PointLight(0xffc98f, 5.5, 8, 1.6);    // центральный плафон
  const fillCool = new THREE.PointLight(0x7f9cc0, 3.0, 7, 1.8);    // холодный контровой снизу-справа
  fillCeil.position.set(0, 2.25, 0);
  scene.add(hemi, keyLight, fillCeil, fillCool);

  const listeners = new Map();
  const frameFns = new Set();
  const stations = [];
  const byId = new Map();
  let current = null, entered = null;
  let running = false, raf = 0, lastT = 0, time = 0, started = false;
  let width = 0, height = 0, pixelRatio = 1;

  // --- камера: локальная поза + угол «рамки» вокруг центра помещения ---
  const rig = {
    angle: 0,                                   // угол рамки (рад, по часовой сверху), 0 — пост №0
    pose: normPose(null),                       // текущая локальная поза
    tr: null,                                   // { fromPose, toPose, fromAngle, dAngle, t, dur, arc, resolve }
    shakeAmp: 0, shakeT: 0, shakeDur: 0, shakeSeed: 0,
  };
  const _pos = new THREE.Vector3(), _tgt = new THREE.Vector3();

  function localToWorld(angle, v, out) {
    const c = Math.cos(angle), s = Math.sin(angle);
    // поворот Y на −angle и перенос в центр поста на кольце
    return out.set(v.x * c - v.z * s + ROOM.ring * s, v.y, v.x * s + v.z * c - ROOM.ring * c);
  }

  function startTransition(toAngle, toPose, seconds, arc) {
    if (rig.tr && rig.tr.resolve) rig.tr.resolve(false);
    if (!(seconds > 0)) {
      rig.angle = toAngle; rig.pose = toPose; rig.tr = null;
      return Promise.resolve(true);
    }
    return new Promise(resolve => {
      rig.tr = {
        fromPose: { pos: rig.pose.pos.clone(), target: rig.pose.target.clone(), fov: rig.pose.fov },
        toPose, fromAngle: rig.angle, dAngle: wrapPi(toAngle - rig.angle), toAngle, t: 0, dur: seconds, arc, resolve,
      };
    });
  }

  function updateRig(dt) {
    const tr = rig.tr;
    if (tr) {
      tr.t = Math.min(1, tr.t + dt / tr.dur);
      const k = ease(tr.t);
      rig.pose.pos.lerpVectors(tr.fromPose.pos, tr.toPose.pos, k);
      rig.pose.target.lerpVectors(tr.fromPose.target, tr.toPose.target, k);
      rig.pose.fov = tr.fromPose.fov + (tr.toPose.fov - tr.fromPose.fov) * k;
      rig.angle = tr.fromAngle + tr.dAngle * k;
      if (tr.arc) {                              // при перелёте чуть отходим к центру помещения
        const b = Math.sin(Math.PI * k) * Math.min(1, Math.abs(tr.dAngle) / 1.0);
        rig.pose.pos.z += 0.16 * b; rig.pose.target.y += 0.05 * b;
      }
      if (tr.t >= 1) {
        rig.angle = tr.toAngle;
        rig.pose = { pos: tr.toPose.pos.clone(), target: tr.toPose.target.clone(), fov: tr.toPose.fov };
        rig.tr = null;
        tr.resolve(true);
        if (tr.arc) emit('arrive', current);
      }
    }
    localToWorld(rig.angle, rig.pose.pos, _pos);
    localToWorld(rig.angle, rig.pose.target, _tgt);
    camera.position.copy(_pos);
    // на узких экранах (уже 16:9) расширяем вертикальный угол, чтобы пульт помещался по ширине
    const aspect = camera.aspect, ref = 16 / 9;
    let fov = rig.pose.fov;
    if (aspect < ref) fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * ref / aspect));
    if (Math.abs(camera.fov - fov) > 1e-4) { camera.fov = fov; camera.updateProjectionMatrix(); }
    camera.up.set(0, 1, 0);
    camera.lookAt(_tgt);
    if (rig.shakeT < rig.shakeDur) {
      rig.shakeT += dt;
      const f = Math.max(0, 1 - rig.shakeT / rig.shakeDur), a = rig.shakeAmp * f * f, t = rig.shakeT * 38 + rig.shakeSeed;
      camera.position.x += a * 0.03 * Math.sin(t * 1.31);
      camera.position.y += a * 0.035 * Math.sin(t * 1.93 + 1.7);
      camera.position.z += a * 0.02 * Math.sin(t * 1.13 + 0.6);
      camera.rotateZ(a * 0.018 * Math.sin(t * 1.57 + 2.2));
      camera.rotateX(a * 0.012 * Math.sin(t * 2.21 + 0.3));
    }
    camera.updateMatrixWorld();

    // свет держится у текущей рамки
    localToWorld(rig.angle, _tgt.set(-0.7, 2.05, 1.05), keyLight.position);
    localToWorld(rig.angle, _tgt.set(1.5, 0.75, 1.5), fillCool.position);

    // видимость постов: текущий и соседние по кольцу (по углу рамки — корректно и во время перелёта)
    for (const st of stations) {
      const d = Math.abs(wrapPi(st.angle - rig.angle));
      st.group.visible = d < 1.15 || st.id === current;
    }
  }

  // --- события ---
  function on(name, fn) {
    let set = listeners.get(name);
    if (!set) listeners.set(name, set = new Set());
    set.add(fn);
    return () => set.delete(fn);
  }
  function off(name, fn) { const set = listeners.get(name); if (set) set.delete(fn); }
  function emit(name, ...args) {
    const set = listeners.get(name);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try { fn(...args); } catch (e) { console.error('[engine] ошибка в обработчике «' + name + '»:', e); }
    }
  }
  const safeCall = (obj, name, ...args) => {
    if (obj && typeof obj[name] === 'function') {
      try { return obj[name](...args); } catch (e) { console.error('[engine] ошибка в ' + (obj.id || '') + '.' + name + ':', e); }
    }
  };

  // --- размер ---
  function checkResize(force) {
    const w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
    const pr = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
    if (!w || !h) return;
    if (force || w !== width || h !== height || pr !== pixelRatio) {
      width = w; height = h; pixelRatio = pr;
      renderer.setPixelRatio(pr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      emit('resize', w, h);
    }
  }

  // --- кадр ---
  const stats = { calls: 0, triangles: 0, frameMs: 0, fps: 0, frames: 0 };
  let fpsT = 0, fpsN = 0;
  function step(dt) {
    const t0 = performance.now();
    time += dt;
    checkResize(false);
    for (const fn of Array.from(frameFns)) {
      try { fn(dt, time); } catch (e) { console.error('[engine] ошибка в onFrame:', e); }
    }
    updateRig(dt);
    for (const st of stations) if (st.group.visible) safeCall(st, 'update', dt, time);
    renderer.render(scene, camera);
    stats.calls = renderer.info.render.calls;
    stats.triangles = renderer.info.render.triangles;
    const ms = performance.now() - t0;
    stats.frameMs += (ms - stats.frameMs) * (stats.frames < 5 ? 1 : 0.08);
    stats.frames++;
  }
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = lastT ? Math.min(0.05, Math.max(0, (now - lastT) / 1000)) : 0;
    if (lastT) { fpsT += now - lastT; fpsN++; if (fpsT >= 500) { stats.fps = fpsN * 1000 / fpsT; fpsT = 0; fpsN = 0; } }
    lastT = now;
    step(dt);
  }

  const engine = {
    THREE, scene, camera, renderer, canvas,
    /** Помощники для авторов постов: geom (slab, lathe, merge, boxUV…), textures (canvasTexture, drawLabel…). */
    geom, textures,
    fonts: fontState,
    lights: { hemi, key: keyLight, fillCeil, fillCool },

    get current() { return current; },
    /** Объект текущего поста. */
    get station() { return entered; },
    get stations() { return stations.slice(); },
    getStation(id) { return byId.get(id) || null; },
    /** true, пока камера летит между постами. */
    get flying() { return !!(rig.tr && rig.tr.arc); },
    get time() { return time; },
    get running() { return running; },

    /** Добавить пост. Порядок добавления = порядок по кольцу (по часовой, вид сверху). */
    addStation(station) {
      if (!station || !station.id || !station.group) throw new Error('addStation: нужен объект { id, group, … }');
      if (byId.has(station.id)) throw new Error('addStation: пост «' + station.id + '» уже добавлен');
      const index = stations.length;
      if (index >= ROOM.slots) console.warn('[engine] постов больше ' + ROOM.slots + ' — они наложатся друг на друга');
      const angle = index * TAU / ROOM.slots;
      station.index = index; station.angle = angle;
      station.group.userData.stationId = station.id;
      station.group.position.set(ROOM.ring * Math.sin(angle), 0, -ROOM.ring * Math.cos(angle));
      station.group.rotation.set(0, -angle, 0);
      scene.add(station.group);
      stations.push(station); byId.set(station.id, station);
      if (!current) {                             // первый пост — текущий (onEnter придёт в start()/gotoStation)
        current = station.id;
        rig.angle = angle; rig.pose = normPose(station.camera);
      }
      updateRig(0);
      return station;
    },

    /**
     * Перелёт к посту (~0.7 с). Сразу вызывает onLeave старого и onEnter нового, шлёт 'station'(id);
     * по прилёте — 'arrive'(id). → Promise<boolean> (false, если перелёт был прерван другим).
     */
    gotoStation(id, o = {}) {
      const st = byId.get(id);
      if (!st) { console.warn('[engine] нет поста «' + id + '»'); return Promise.resolve(false); }
      const prev = entered, changed = prev !== st;
      if (changed) {
        if (prev) safeCall(prev, 'onLeave');
        entered = st; current = id;
        safeCall(st, 'onEnter');
        emit('station', id);
      }
      const steps = Math.round(Math.abs(wrapPi(st.angle - rig.angle)) / (TAU / ROOM.slots));
      const dur = o.instant ? 0 : (steps === 0 ? 0.4 : 0.7 + 0.16 * (steps - 1));
      const p = startTransition(st.angle, normPose(st.camera), dur, steps > 0);
      updateRig(0);
      if (o.instant && changed) emit('arrive', id);
      return p;
    },

    /**
     * Дополнительный вид в локальных координатах текущего поста; null — вернуть основной.
     * pose: { position, target, fov } (любое поле можно опустить — возьмётся из основного вида поста).
     */
    setCameraPose(pose, seconds = 0.5) {
      const st = entered || byId.get(current);
      const base = normPose(st && st.camera);
      const to = pose ? normPose(pose, { position: base.pos.toArray(), target: base.target.toArray(), fov: base.fov }) : base;
      const p = startTransition(st ? st.angle : rig.angle, to, seconds, false);
      updateRig(0);
      return p;
    },

    /** fn(dt, time) каждый кадр. → функция отписки. */
    onFrame(fn) { frameFns.add(fn); return () => frameFns.delete(fn); },
    on, off, emit,

    start() {
      if (running) return;
      running = true; lastT = 0;
      checkResize(true);
      if (!started) {
        started = true;
        if (!entered && current) engine.gotoStation(current, { instant: true });
      }
      raf = requestAnimationFrame(frame);
    },
    stop() { running = false; cancelAnimationFrame(raf); },

    /** Тряска камеры: amount ~0..1 (1 — выстрел главного калибра), seconds — длительность затухания. */
    shake(amount = 1, seconds = 0.6) {
      rig.shakeAmp = Math.max(amount, rig.shakeT < rig.shakeDur ? rig.shakeAmp * (1 - rig.shakeT / rig.shakeDur) : 0);
      rig.shakeDur = Math.max(0.05, seconds); rig.shakeT = 0; rig.shakeSeed = Math.random() * 100;
      if (engine.room) engine.room.flicker(Math.min(1, amount), seconds);
    },

    /** Точка из локальных координат поста → мировые. */
    stationToWorld(id, v, out = new THREE.Vector3()) {
      const st = byId.get(id);
      const p = v.isVector3 ? v : new THREE.Vector3().fromArray(v);
      return st ? localToWorld(st.angle, p, out) : out.copy(p);
    },

    debug: {
      enabled: !!opts.debug,
      /** { calls, triangles, frameMs (CPU, сглаж.), fps, geometries, textures, programs } */
      stats() {
        return {
          calls: stats.calls, triangles: stats.triangles, frameMs: +stats.frameMs.toFixed(2), fps: +stats.fps.toFixed(1),
          geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
          programs: renderer.info.programs ? renderer.info.programs.length : 0,
        };
      },
      /** Один кадр вручную (для тестов и снимков при остановленном цикле). */
      step(dt = 1 / 60) { step(dt); },
      /** Рамка зоны управления (|x| ≤ 0.85, 0.74 ≤ y ≤ 1.46, z = 0) и габарит поста у текущего поста. */
      guides(show = true) {
        if (engine.debug._guides) { engine.debug._guides.removeFromParent(); engine.debug._guides.geometry.dispose(); engine.debug._guides = null; }
        const st = entered || byId.get(current);
        if (!show || !st) return;
        const pts = [], line = (a, b) => pts.push(...a, ...b);
        const rect = (x0, y0, x1, y1, z) => { line([x0, y0, z], [x1, y0, z]); line([x1, y0, z], [x1, y1, z]); line([x1, y1, z], [x0, y1, z]); line([x0, y1, z], [x0, y0, z]); };
        rect(-0.85, 0.74, 0.85, 1.46, 0.002);
        rect(-0.9, 0, 0.9, 2.4, 0); rect(-0.9, 0, 0.9, 2.4, -0.95);
        line([-0.9, 0, 0.35], [0.9, 0, 0.35]);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x4be36a, depthTest: false, toneMapped: false }));
        l.renderOrder = 999;
        st.group.add(l);
        engine.debug._guides = l;
      },
      _guides: null,
    },

    dispose() {
      engine.stop();
      engine.input.dispose();
      engine.audio.dispose();
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      window.removeEventListener('touchend', unlock, true);
      if (overlay) overlay.remove();
      envRT.dispose();
      engine.mat.dispose();
      renderer.dispose();
    },
  };

  engine.mat = createMaterials();
  engine.audio = createAudio();
  engine.input = createInput(engine, canvas);
  engine.ui = createUI(engine);
  engine.room = createRoom(engine);
  scene.add(engine.room.group);

  // звук — после первого жеста пользователя
  function unlock() { engine.audio.unlock(); }
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  window.addEventListener('touchend', unlock, true);

  // отладочная плашка
  let overlay = null;
  if (opts.debug && canvas.parentNode) {
    overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;left:6px;top:6px;z-index:9999;font:11px/1.3 monospace;color:#9fe8b0;' +
      'background:rgba(0,0,0,.55);padding:3px 6px;border-radius:3px;pointer-events:none;white-space:pre';
    canvas.parentNode.appendChild(overlay);
    let acc = 0;
    engine.onFrame(dt => {
      acc += dt; if (acc < 0.5) return; acc = 0;
      const s = engine.debug.stats();
      overlay.textContent = (current || '—') + '  ' + s.fps + ' к/с  ' + s.frameMs + ' мс  ' + s.calls + ' выз.  ' + (s.triangles / 1000).toFixed(1) + 'к тр.';
    });
  }

  checkResize(true);
  updateRig(0);
  return engine;
}
