// Общие помощники органов управления.
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _sb = {}, _sc = {};

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const wrapPi = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

/**
 * Собирает объект органа управления: object3D, enabled, dispose().
 * disposers — функции отписки (ввод, кадры).
 */
export function finish(api, object3D, disposers = []) {
  api.object3D = object3D;
  if (!('enabled' in api)) api.enabled = true;
  api.dispose = () => {
    disposers.forEach(d => { try { d(); } catch (e) { /* уже снято */ } });
    disposers.length = 0;
    object3D.removeFromParent();
  };
  object3D.userData.control = api;
  return api;
}

/**
 * Проекция локальной оси объекта на экран.
 * → { x, y (единичный вектор на экране), ppm (пикселей на метр вдоль оси), ok }
 */
export function screenAxis(c, obj, origin, dir) {
  obj.updateWorldMatrix(true, false);
  _a.fromArray(origin).applyMatrix4(obj.matrixWorld);
  _b.set(origin[0] + dir[0] * 0.1, origin[1] + dir[1] * 0.1, origin[2] + dir[2] * 0.1).applyMatrix4(obj.matrixWorld);
  const p0 = c.input.toScreen(_a, _sb), p1 = c.input.toScreen(_b, _sc);
  const dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.hypot(dx, dy);
  if (len < 1.5) return { x: 0, y: 0, ppm: 0, ok: false };
  return { x: dx / len, y: dy / len, ppm: len / 0.1, ok: true };
}

/**
 * Аффинное отображение «экран → плоскость органа» (локальные X, Y объекта, метры от его начала координат).
 * Считается в момент касания; устойчиво к наклону пульта. Если плоскость видна почти с ребра —
 * используется простое экранное приближение.
 * → { map(x, y) → [u, v], facing }   facing = false, если орган виден с тыла.
 */
export function planeMapper(c, obj, z = 0, span = 0.1) {
  obj.updateWorldMatrix(true, false);
  const m = obj.matrixWorld;
  const o = c.input.toScreen(_a.set(0, 0, z).applyMatrix4(m), {});
  const px = c.input.toScreen(_a.set(span, 0, z).applyMatrix4(m), {});
  const py = c.input.toScreen(_a.set(0, span, z).applyMatrix4(m), {});
  let ax = (px.x - o.x) / span, ay = (px.y - o.y) / span;      // экранный вектор локальной оси X (px/м)
  let bx = (py.x - o.x) / span, by = (py.y - o.y) / span;      // … оси Y
  let det = ax * by - ay * bx;
  const s = Math.max(Math.hypot(ax, ay), Math.hypot(bx, by), 1e-6);
  if (Math.abs(det) < 0.3 * s * s) {                            // с ребра: считаем, что орган смотрит на игрока
    ax = s; ay = 0; bx = 0; by = -s; det = -s * s;
  }
  return {
    ox: o.x, oy: o.y, scale: s,
    facing: det < 0,                                            // экранная Y направлена вниз
    map(x, y) {
      const dx = x - o.x, dy = y - o.y;
      return [(by * dx - bx * dy) / det, (-ay * dx + ax * dy) / det];
    },
  };
}

/**
 * Угол (рад, против часовой в плоскости органа), заметаемый отрезком p0→p1 вокруг начала координат.
 * Вне круга rmin — точная разность atan2 (ход 1:1); внутри — «вязкая» зона без скачков:
 * палец, проходящий через ступицу, не перебрасывает маховик на пол-оборота.
 */
export function sweepAngle(u0, v0, u1, v1, rmin) {
  const dist = Math.hypot(u1 - u0, v1 - v0);
  const n = clamp(Math.ceil(dist / (rmin * 0.5)), 1, 48);
  let total = 0, au = u0, av = v0;
  for (let i = 1; i <= n; i++) {
    const t = i / n, bu = u0 + (u1 - u0) * t, bv = v0 + (v1 - v0) * t;
    const ra = Math.hypot(au, av), rb = Math.hypot(bu, bv);
    if (ra >= rmin && rb >= rmin) {
      total += wrapPi(Math.atan2(bv, bu) - Math.atan2(av, au));
    } else {
      const mu = (au + bu) / 2, mv = (av + bv) / 2, r = Math.max(Math.hypot(mu, mv), rmin);
      total += (mu * (bv - av) - mv * (bu - au)) / (r * r);
    }
    au = bu; av = bv;
  }
  return total;
}

/** Пружина с демпфированием (полунеявный Эйлер, с подшагами). state: { x, v }. */
export function spring(state, target, dt, omega = 18, zeta = 0.7) {
  const steps = Math.max(1, Math.ceil(dt * omega / 0.5));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const acc = omega * omega * (target - state.x) - 2 * zeta * omega * state.v;
    state.v += acc * h;
    state.x += state.v * h;
  }
  return state.x;
}

/** Экспоненциальное приближение. */
export function approach(cur, target, dt, rate) {
  return cur + (target - cur) * (1 - Math.exp(-dt * rate));
}

export function callSafe(fn, ...args) {
  if (typeof fn !== 'function') return;
  try { return fn(...args); } catch (e) { console.error('[engine.ui] ошибка в обработчике:', e); }
}

const _n = new THREE.Vector3(), _p = new THREE.Vector3();
/** Точка пересечения луча события с локальной плоскостью z = const объекта → локальные координаты (или null). */
export function localPlanePoint(c, obj, e, z = 0) {
  obj.updateWorldMatrix(true, false);
  _p.set(0, 0, z).applyMatrix4(obj.matrixWorld);
  _n.set(0, 0, 1).transformDirection(obj.matrixWorld);
  const hit = c.input.planePoint(e, _n, _p);
  return hit ? obj.worldToLocal(hit) : null;
}
