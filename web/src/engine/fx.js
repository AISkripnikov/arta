// Эффекты движка (engine.fx): тряска, вспышка света, пыль с потолка, клубы дыма/пара, искры.
// Частицы — два объекта THREE.Points с заранее выделенными буферами (дым/пыль — обычное смешение, искры — сложение);
// за кадр ничего не выделяется, число частиц ограничено уровнем качества (quality.particles; 0 — частиц нет вовсе).
// Пока живых частиц нет, объекты скрыты и не стоят ни одного вызова отрисовки.
import * as THREE from 'three';

const VERT = `
attribute vec4 aColor; attribute float aSize;
uniform float uScale;
varying vec4 vColor;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vColor = vec4(aColor.rgb, aColor.a * smoothstep(0.18, 0.4, -mv.z));   // у самой камеры частица гаснет, а не растёт во весь экран
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / max(0.05, -mv.z), 1.5, 300.0);
}`;
const FRAG = `
varying vec4 vColor;
uniform float uSoft;
void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;
  float a = pow(1.0 - r, uSoft) * vColor.a;
  gl_FragColor = vec4(vColor.rgb * a, a);
}`;

const rnd = (a, b) => a + Math.random() * (b - a);

/** Пул частиц: count штук, смешение blending (премультиплицированный цвет). */
function createPool(count, additive, soft) {
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 4), size = new Float32Array(count);
  // состояние: скорость, жизнь, размеры, сопротивление, тяжесть, цвета начала и конца
  const vel = new Float32Array(count * 3), life = new Float32Array(count), maxLife = new Float32Array(count);
  const s0 = new Float32Array(count), s1 = new Float32Array(count), drag = new Float32Array(count), grav = new Float32Array(count);
  const c0 = new Float32Array(count * 4), c1 = new Float32Array(count * 3), sway = new Float32Array(count);
  const g = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(pos, 3), aCol = new THREE.BufferAttribute(col, 4), aSize = new THREE.BufferAttribute(size, 1);
  aPos.setUsage(THREE.DynamicDrawUsage); aCol.setUsage(THREE.DynamicDrawUsage); aSize.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', aPos); g.setAttribute('aColor', aCol); g.setAttribute('aSize', aSize);
  g.setDrawRange(0, 0);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms: { uScale: { value: 400 }, uSoft: { value: soft } },
    transparent: true, depthWrite: false, depthTest: true, premultipliedAlpha: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor,
    blendDst: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
  });
  const points = new THREE.Points(g, material);
  points.frustumCulled = false; points.visible = false; points.renderOrder = 20;
  points.userData.noShadow = true;
  points.name = additive ? 'fx.sparks' : 'fx.smoke';
  let alive = 0, limit = count;

  return {
    points, material,
    get alive() { return alive; },
    setLimit(n) { limit = Math.max(0, Math.min(count, n | 0)); if (alive > limit) alive = limit; },
    /** Новая частица; при заполненном пуле вытесняется самая старая (первая в буфере — они идут по времени рождения не строго, но дёшево). */
    spawn(x, y, z, vx, vy, vz, ttl, sizeFrom, sizeTo, r, gg, b, a, r1, g1, b1, dragK, gravity, swayK) {
      if (limit <= 0) return;
      let i = alive;
      if (alive >= limit) i = (Math.random() * limit) | 0; else alive++;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
      life[i] = 0; maxLife[i] = ttl; s0[i] = sizeFrom; s1[i] = sizeTo; drag[i] = dragK; grav[i] = gravity; sway[i] = swayK;
      c0[i * 4] = r; c0[i * 4 + 1] = gg; c0[i * 4 + 2] = b; c0[i * 4 + 3] = a;
      c1[i * 3] = r1; c1[i * 3 + 1] = g1; c1[i * 3 + 2] = b1;
    },
    update(dt, time, floorY) {
      if (!alive) { if (points.visible) { points.visible = false; g.setDrawRange(0, 0); } return; }
      let i = 0;
      while (i < alive) {
        life[i] += dt;
        if (life[i] >= maxLife[i]) {            // умерла: на её место — последняя живая
          const j = --alive;
          if (j !== i) {
            pos[i * 3] = pos[j * 3]; pos[i * 3 + 1] = pos[j * 3 + 1]; pos[i * 3 + 2] = pos[j * 3 + 2];
            vel[i * 3] = vel[j * 3]; vel[i * 3 + 1] = vel[j * 3 + 1]; vel[i * 3 + 2] = vel[j * 3 + 2];
            life[i] = life[j]; maxLife[i] = maxLife[j]; s0[i] = s0[j]; s1[i] = s1[j]; drag[i] = drag[j]; grav[i] = grav[j]; sway[i] = sway[j];
            c0[i * 4] = c0[j * 4]; c0[i * 4 + 1] = c0[j * 4 + 1]; c0[i * 4 + 2] = c0[j * 4 + 2]; c0[i * 4 + 3] = c0[j * 4 + 3];
            c1[i * 3] = c1[j * 3]; c1[i * 3 + 1] = c1[j * 3 + 1]; c1[i * 3 + 2] = c1[j * 3 + 2];
          }
          continue;
        }
        const k = life[i] / maxLife[i], d = Math.max(0, 1 - drag[i] * dt);
        let vx = vel[i * 3] * d, vy = (vel[i * 3 + 1] - grav[i] * dt) * d, vz = vel[i * 3 + 2] * d;
        if (sway[i]) { const ph = time * 1.7 + i * 2.39; vx += Math.sin(ph) * sway[i] * dt; vz += Math.cos(ph * 0.83) * sway[i] * dt; }
        let y = pos[i * 3 + 1] + vy * dt;
        if (y < floorY && vy < 0) { y = floorY; vy = -vy * 0.3; vx *= 0.5; vz *= 0.5; }
        pos[i * 3] += vx * dt; pos[i * 3 + 1] = y; pos[i * 3 + 2] += vz * dt;
        vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
        size[i] = s0[i] + (s1[i] - s0[i]) * k;
        // прозрачность: быстрое появление, плавное угасание
        const fade = Math.min(1, k * 8) * (1 - k) * (1 - k);
        col[i * 4] = c0[i * 4] + (c1[i * 3] - c0[i * 4]) * k;
        col[i * 4 + 1] = c0[i * 4 + 1] + (c1[i * 3 + 1] - c0[i * 4 + 1]) * k;
        col[i * 4 + 2] = c0[i * 4 + 2] + (c1[i * 3 + 2] - c0[i * 4 + 2]) * k;
        col[i * 4 + 3] = c0[i * 4 + 3] * fade;
        i++;
      }
      g.setDrawRange(0, alive);
      points.visible = alive > 0;
      if (alive) {
        aPos.clearUpdateRanges(); aPos.addUpdateRange(0, alive * 3); aPos.needsUpdate = true;
        aCol.clearUpdateRanges(); aCol.addUpdateRange(0, alive * 4); aCol.needsUpdate = true;
        aSize.clearUpdateRanges(); aSize.addUpdateRange(0, alive); aSize.needsUpdate = true;
      }
    },
    clear() { alive = 0; points.visible = false; g.setDrawRange(0, 0); },
    dispose() { g.dispose(); material.dispose(); },
  };
}

/**
 * engine.fx. host — внутренности движка: { kick(amount, seconds), flashLight(color, intensity, seconds, worldPos|null),
 * lampFlicker(amount, seconds), post }.
 */
export function createFx(engine, host) {
  const MAX_SMOKE = 320, MAX_SPARK = 160;
  const smoke = createPool(MAX_SMOKE, false, 1.0), spark = createPool(MAX_SPARK, true, 2.2);
  const group = new THREE.Group();
  group.name = 'fx'; group.userData.noShadow = true;
  group.add(smoke.points, spark.points);
  engine.scene.add(group);
  const _v = new THREE.Vector3(), _d = new THREE.Vector3();
  let amount = 1;                                   // доля частиц по уровню качества (0 — эффекты частиц выключены)
  let postFlash = 0, postFlashDur = 0, postFlashT = 0;

  /**
   * Точка в мировых координатах: position — Vector3 | [x,y,z]; station — id поста (тогда position локальная), иначе текущий
   * пост, если не world: true. screen: [x, y] (−1…1, как NDC: [0, 0] — центр кадра, y вверх) и depth (м от камеры, по
   * умолчанию 0.8 — перед пультом) — точка «в кадре»: видна на любом посту при любом соотношении сторон экрана.
   */
  function world(o, fallback) {
    if (o && o.screen) {
      const cam = engine.camera;
      _v.set(o.screen[0], o.screen[1], 0.5).unproject(cam).sub(cam.position).normalize()
        .multiplyScalar(o.depth > 0 ? o.depth : 0.8).add(cam.position);
      return _v;
    }
    const p = (o && o.position) || fallback;
    const st = o && o.station !== undefined ? o.station : (o && o.world ? null : engine.current);
    if (p && p.isVector3) _v.copy(p); else _v.fromArray(p);
    if (st && engine.getStation(st)) engine.stationToWorld(st, _v.clone(), _v);
    return _v;
  }
  /** Направление из локальных координат поста в мировые (только поворот). */
  function worldDir(o, def) {
    const d = (o && o.dir) || def;
    if (d.isVector3) _d.copy(d); else _d.fromArray(d);
    const st = o && o.station !== undefined ? o.station : (o && o.world ? null : engine.current);
    const s = st && engine.getStation(st);
    if (s) _d.applyAxisAngle(THREE.Object3D.DEFAULT_UP, -s.angle);
    return _d;
  }
  const visible = (o) => {
    // эффект поста, который сейчас не на экране, не создаём: частицы и вспышки только там, где игрок их увидит
    const st = o && o.station;
    return !st || st === engine.current;
  };

  const fx = {
    group,
    /** Тряска камеры: amount 1 ≈ близкий разрыв, seconds — затухание. Учитывает engine.settings.shake. Лампы не трогает. */
    shake(a = 0.4, seconds = 0.5) { host.kick(a, seconds); },

    /**
     * Вспышка света. { color='#ffd9a0', intensity=1, dur=0.2, from='slit'|'lamp'|[x,y,z]|Vector3, station }.
     * 'slit' — из амбразуры над пультом текущего поста (дульное пламя); 'lamp' — всплеск ламп помещения;
     * точка — в локальных координатах поста station (по умолчанию текущего). Свет даёт заполняющий источник движка
     * (новых источников нет), на уровнях с постобработкой кадр ещё и слегка засвечивается.
     */
    flash(o = {}) {
      if (!visible(o)) return;
      const intensity = o.intensity == null ? 1 : o.intensity, dur = Math.max(0.04, o.dur || 0.2);
      const from = o.from == null ? 'slit' : o.from;
      const color = o.color || '#ffd9a0';
      if (from === 'lamp') { host.flashLight(color, intensity, dur, null); return; }
      const p = from === 'slit' ? world({ position: [0, 1.82, -0.42], station: o.station }) : world({ position: from, station: o.station });
      host.flashLight(color, intensity, dur, p);
      if (o.screen !== false) {
        const k = Math.min(0.35, 0.16 * intensity);
        if (k > postFlash * (1 - postFlashT / (postFlashDur || 1))) { postFlash = k; postFlashDur = dur * 1.4; postFlashT = 0; }
        host.post.flash.set(1, 0.86, 0.66, 0);
      }
    },

    /** Мигание ламп помещения (и ключевого света): amount 0..1. */
    flicker(a = 0.6, seconds = 0.5) { host.lampFlicker(a, seconds); },

    /** Пыль с потолка: { amount=1 (≈40 пылинок), station }. Сыплется над пультом текущего поста. */
    dust(o = {}) {
      if (!amount || !visible(o)) return;
      const n = Math.round(40 * (o.amount == null ? 1 : o.amount) * amount);
      for (let i = 0; i < n; i++) {
        // струйки у балок и отдельные пылинки по всему объёму перед пультом
        const stream = i % 3 === 0;
        const sx = stream ? Math.round(rnd(-2, 2)) * 0.45 + rnd(-0.04, 0.04) : rnd(-1.3, 1.3);
        const p = world({ position: [sx, rnd(2.0, 2.42), rnd(-0.75, 0.75)], station: o.station });
        const g = rnd(0.72, 0.95);
        if (i % 7 === 3) {                           // редкое облачко мелкой пыли
          smoke.spawn(p.x, p.y, p.z, rnd(-0.03, 0.03), -rnd(0.08, 0.25), rnd(-0.03, 0.03), rnd(2.2, 4.0),
            rnd(0.12, 0.2), rnd(0.4, 0.6), g * 0.8, g * 0.74, g * 0.64, rnd(0.07, 0.12), g * 0.7, g * 0.66, g * 0.6, 0.4, 0.05, 0.04);
          continue;
        }
        smoke.spawn(p.x, p.y, p.z, rnd(-0.03, 0.03), -rnd(0.05, stream ? 0.6 : 0.3), rnd(-0.03, 0.03), rnd(1.6, 4.2),
          rnd(0.012, 0.022), rnd(0.014, 0.028), g, g * 0.92, g * 0.78, rnd(0.45, 0.8), g * 0.9, g * 0.84, g * 0.72, 0.5, 0.22, 0.05);
      }
    },

    /**
     * Клуб: { position, kind='smoke'|'breech'|'steam', amount=1, dir=[x,y,z], station }.
     * breech — пороховой дым из открытого затвора; steam — струя пара; smoke — тёмный дым от повреждения.
     */
    puff(o = {}) {
      if (!amount || !visible(o)) return;
      const kind = o.kind || 'smoke', k = (o.amount == null ? 1 : o.amount) * amount;
      const p = world(o, [0, 1.2, 0]).clone();
      if (kind === 'breech') {
        const d = worldDir(o, [0, 0.15, 1]).clone();
        const n = Math.round(18 * k);
        for (let i = 0; i < n; i++) {
          const s = rnd(0.25, 0.9), g = rnd(0.62, 0.8);
          smoke.spawn(p.x + rnd(-0.04, 0.04), p.y + rnd(-0.04, 0.04), p.z + rnd(-0.04, 0.04),
            d.x * s + rnd(-0.16, 0.16), d.y * s + rnd(0.02, 0.2), d.z * s + rnd(-0.16, 0.16), rnd(1.1, 2.4),
            rnd(0.1, 0.16), rnd(0.45, 0.7), g, g * 0.97, g * 0.9, rnd(0.28, 0.42), g * 0.8, g * 0.8, g * 0.8, 1.7, -0.12, 0.08);
        }
      } else if (kind === 'steam') {
        const d = worldDir(o, [0, 1, 0.25]).clone();
        const n = Math.round(14 * k);
        for (let i = 0; i < n; i++) {
          const s = rnd(0.9, 2.0);
          smoke.spawn(p.x, p.y, p.z, d.x * s + rnd(-0.12, 0.12), d.y * s + rnd(-0.12, 0.12), d.z * s + rnd(-0.12, 0.12), rnd(0.6, 1.3),
            rnd(0.05, 0.08), rnd(0.3, 0.5), 0.86, 0.88, 0.9, rnd(0.28, 0.42), 0.8, 0.82, 0.85, 2.6, -0.5, 0.05);
        }
      } else {
        const d = worldDir(o, [0, 1, 0.1]).clone();
        const n = Math.round(10 * k);
        for (let i = 0; i < n; i++) {
          const s = rnd(0.1, 0.35), g = rnd(0.16, 0.28);
          smoke.spawn(p.x + rnd(-0.03, 0.03), p.y, p.z + rnd(-0.03, 0.03), d.x * s + rnd(-0.06, 0.06), d.y * s, d.z * s + rnd(-0.06, 0.06), rnd(1.8, 3.4),
            rnd(0.08, 0.12), rnd(0.35, 0.55), g, g, g * 1.05, rnd(0.4, 0.55), g * 1.4, g * 1.4, g * 1.4, 0.7, -0.14, 0.06);
        }
      }
    },

    /** Искры: { position, amount=1 (≈18 искр), dir=[x,y,z] (куда сыплются, по умолчанию во все стороны и вниз), station }. */
    sparks(o = {}) {
      if (!amount || !visible(o)) return;
      const p = world(o, [0, 1.6, -0.3]).clone();
      const d = o.dir ? worldDir(o, [0, 0, 1]).clone() : null;
      const n = Math.round(18 * (o.amount == null ? 1 : o.amount) * amount);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, u = rnd(-0.4, 1), sp = rnd(0.7, 2.8), q = Math.sqrt(Math.max(0, 1 - u * u));
        let vx = Math.cos(a) * q * sp, vy = u * sp, vz = Math.sin(a) * q * sp;
        if (d) { vx = vx * 0.5 + d.x * sp; vy = vy * 0.5 + d.y * sp; vz = vz * 0.5 + d.z * sp; }
        const hot = rnd(0.8, 1);
        spark.spawn(p.x, p.y, p.z, vx, vy, vz, rnd(0.3, 0.9), rnd(0.013, 0.022), 0.007,
          1.0 * hot, 0.9 * hot, 0.6 * hot, 1, 1.0, 0.42, 0.08, 0.9, 5.5, 0);
      }
      host.flashLight('#ffc070', 0.35, 0.1, p);
    },

    /** Убрать все частицы (смена задания, выход в меню). */
    clear() { smoke.clear(); spark.clear(); postFlash = 0; host.post.flash.w = 0; },

    /** Живых частиц сейчас. */
    get particles() { return smoke.alive + spark.alive; },

    _setQuality(q) {
      amount = q && q.particles ? q.particles : 0;
      smoke.setLimit(Math.round(MAX_SMOKE * amount)); spark.setLimit(Math.round(MAX_SPARK * amount));
      if (!amount) fx.clear();
    },
    _resize(heightPx, fovDeg) {
      // размер точки в пикселях: метры · высота буфера / (2·tg(fov/2)) / глубина
      const s = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
      smoke.material.uniforms.uScale.value = s; spark.material.uniforms.uScale.value = s;
    },
    _update(dt, time) {
      smoke.update(dt, time, 0.03); spark.update(dt, time, 0.03);
      if (postFlash > 0) {
        postFlashT += dt;
        const f = Math.max(0, 1 - postFlashT / postFlashDur);
        host.post.flash.w = postFlash * f * f;
        if (f <= 0) postFlash = 0;
      }
    },
    dispose() { smoke.dispose(); spark.dispose(); group.removeFromParent(); },
  };
  return fx;
}
