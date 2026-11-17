// Баллистика тяжёлого орудия: плоская траектория с квадратичным сопротивлением воздуха.
// Единицы наружу: км и градусы; внутри — метры и радианы.
const G = 9.81;
const K_DRAG = 2.4e-5;   // 1/м — тяжёлый снаряд, малое торможение
const DT = 0.02;
const RAD = Math.PI / 180;

export const CHARGE_V0 = [236, 305, 370, 432, 495, 556]; // м/с для зарядов 1…6 (≈ 5, 8, 11, 14, 17, 20.5 км)
export const EL_SOLVE_MIN = 2;    // ° — ниже вычислитель решений не выдаёт
export const EL_SOLVE_MAX = 40;   // ° — выше стрелять невыгодно (навесная ветвь)

/** Полёт до уровня моря. v0 — м/с, elDeg — °. → { range (м), tof (с) } */
export function fly(v0, elDeg) {
  const a = elDeg * RAD;
  let x = 0, y = 0, vx = v0 * Math.cos(a), vy = v0 * Math.sin(a), t = 0;
  if (vy <= 0) return { range: 0, tof: 0 };
  for (;;) {
    const v = Math.hypot(vx, vy);
    vx += -K_DRAG * v * vx * DT;
    vy += (-K_DRAG * v * vy - G) * DT;
    const nx = x + vx * DT, ny = y + vy * DT;
    t += DT;
    if (ny <= 0) {
      const f = y / (y - ny || 1);
      return { range: x + (nx - x) * f, tof: t - DT + DT * f };
    }
    x = nx; y = ny;
    if (t > 400) return { range: x, tof: t };
  }
}

const rangeCache = new Map();
/** Пределы дальности заряда n (1…6), км. */
export function chargeRange(n) {
  if (!rangeCache.has(n)) {
    const v0 = CHARGE_V0[n - 1];
    rangeCache.set(n, { min: fly(v0, EL_SOLVE_MIN).range / 1000, max: fly(v0, EL_SOLVE_MAX).range / 1000 });
  }
  return rangeCache.get(n);
}

/** Решение вычислителя: угол возвышения (°, до 0.01) и время полёта (с) для дальности (км) и заряда. */
export function solve(rangeKm, charge) {
  if (!(charge >= 1 && charge <= CHARGE_V0.length)) return { ok: false, reason: 'Нет такого заряда' };
  const lim = chargeRange(charge), R = rangeKm * 1000;
  if (!(rangeKm >= lim.min && rangeKm <= lim.max)) return { ok: false, reason: 'Дальность вне пределов заряда' };
  const v0 = CHARGE_V0[charge - 1];
  let lo = EL_SOLVE_MIN, hi = EL_SOLVE_MAX;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fly(v0, mid).range < R) lo = mid; else hi = mid;
  }
  const el = Math.round(((lo + hi) / 2) * 100) / 100;
  return { ok: true, elevation: el, tof: Math.round(fly(v0, el).tof * 10) / 10 };
}

/** Фактический выстрел: bearing/elevation — °, charges — число картузов; noise — {v, el, az} множители рассеивания. */
export function shoot(bearing, elevation, charges, noise) {
  const n = noise || { v: 0, el: 0, az: 0 };
  const v0 = CHARGE_V0[Math.max(1, Math.min(CHARGE_V0.length, charges)) - 1] * (1 + n.v);
  const r = fly(v0, elevation + n.el);
  const az = (bearing + n.az) * RAD;
  return { dx: (r.range / 1000) * Math.sin(az), dy: (r.range / 1000) * Math.cos(az), range: r.range / 1000, tof: r.tof };
}
