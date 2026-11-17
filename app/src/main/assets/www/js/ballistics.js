/* Баллистика: численная модель полёта снаряда и генерация таблиц стрельбы.
 * Координаты: E — восток (м), N — север (м), H — высота (м).
 * Углы — в делениях угломера: полный круг = 6000 дел. (60-00).
 */
(function (root) {
  'use strict';

  var G = 9.81;
  var K_DRAG = 9e-5;      // коэффициент сопротивления воздуха (1/м)
  var DT = 0.02;          // шаг интегрирования (с)
  var DRIFT_A = 0.05;     // боковое ускорение деривации (м/с²), уводит снаряд вправо
  var MIL = 2 * Math.PI / 6000;

  var CHARGES = [
    { id: 0, name: 'Заряд 1', short: 'З1', v0: 200 },
    { id: 1, name: 'Заряд 2', short: 'З2', v0: 280 },
    { id: 2, name: 'Заряд 3', short: 'З3', v0: 370 },
    { id: 3, name: 'Заряд 4', short: 'З4', v0: 470 }
  ];

  var EL_MIN = 20, EL_MAX = 1100; // ограничения ствола по возвышению (дел.)

  /**
   * Полёт снаряда.
   * p0 = {e,n,h}; az, el — дел.; v0 — м/с; wind = {e,n} — скорость движения воздуха (м/с);
   * ground(e,n) -> высота поверхности; levels — массив высот, на которых нужно
   * зафиксировать пересечение на нисходящей ветви (для таблиц).
   */
  function fly(p0, az, el, v0, wind, ground, opts) {
    opts = opts || {};
    var a = az * MIL, b = el * MIL;
    var e = p0.e, n = p0.n, h = p0.h;
    var ch = Math.cos(b);
    var ve = v0 * ch * Math.sin(a), vn = v0 * ch * Math.cos(a), vh = v0 * Math.sin(b);
    var we = wind ? wind.e : 0, wn = wind ? wind.n : 0;
    var t = 0;
    var path = opts.path ? [{ e: e, n: n, h: h, t: 0 }] : null;
    var levels = opts.levels || null;
    var crossings = levels ? levels.map(function () { return null; }) : null;
    var pathEvery = opts.pathEvery || 10, step = 0;
    var apex = h;
    while (t < 300) {
      var re = ve - we, rn = vn - wn, rh = vh;
      var vr = Math.sqrt(re * re + rn * rn + rh * rh);
      var hv = Math.sqrt(ve * ve + vn * vn) || 1;
      // единичный вектор «вправо» от горизонтального направления полёта
      var rx = vn / hv, ry = -ve / hv;
      var ae = -K_DRAG * vr * re + DRIFT_A * rx;
      var an = -K_DRAG * vr * rn + DRIFT_A * ry;
      var ah = -K_DRAG * vr * rh - G;
      ve += ae * DT; vn += an * DT; vh += ah * DT;
      var ne = e + ve * DT, nn = n + vn * DT, nh = h + vh * DT;
      t += DT;
      if (nh > apex) apex = nh;
      if (levels && vh < 0) {
        for (var i = 0; i < levels.length; i++) {
          if (crossings[i] === null && h >= levels[i] && nh < levels[i]) {
            var f = (h - levels[i]) / (h - nh);
            crossings[i] = { e: e + (ne - e) * f, n: n + (nn - n) * f, t: t - DT + DT * f };
          }
        }
      }
      if (vh < 0) {
        var g1 = ground(ne, nn);
        if (nh <= g1) {
          var g0 = ground(e, n);
          var d0 = h - g0, d1 = nh - g1;
          var k = d0 / ((d0 - d1) || 1);
          if (!(k >= 0 && k <= 1)) k = 1;
          var res = {
            e: e + (ne - e) * k, n: n + (nn - n) * k, h: h + (nh - h) * k,
            t: t - DT + DT * k, apex: apex, crossings: crossings
          };
          if (path) path.push({ e: res.e, n: res.n, h: res.h, t: res.t });
          res.path = path;
          return res;
        }
      }
      e = ne; n = nn; h = nh;
      if (path && (++step % pathEvery === 0)) path.push({ e: e, n: n, h: h, t: t });
    }
    return { e: e, n: n, h: h, t: t, apex: apex, crossings: crossings, path: path };
  }

  function flat0() { return 0; }
  function flatAt(v) { return function () { return v; }; }

  function lerp(a, b, f) { return a + (b - a) * f; }

  // интерполяция y(x) по монотонно возрастающему массиву xs
  function interp(xs, ys, x) {
    var lo = 0, hi = xs.length - 1;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[hi]) return ys[hi];
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid; else hi = mid;
    }
    return lerp(ys[lo], ys[hi], (x - xs[lo]) / (xs[hi] - xs[lo]));
  }

  /** Построение таблицы стрельбы для одного заряда (настильная траектория). */
  function buildTable(charge, step) {
    step = step || 100;
    var v0 = charge.v0;
    var els = [], r0 = [], r50 = [], tof = [], drift = [];
    var prevR = -1;
    for (var el = 30; el <= 900; el += 2) {
      var f = fly({ e: 0, n: 0, h: 0 }, 0, el, v0, null, flatAt(-1000), { levels: [0, 50] });
      var c0 = f.crossings[0], c50 = f.crossings[1];
      if (!c0) continue;
      if (c0.n <= prevR) break; // дальше — навесная ветвь
      prevR = c0.n;
      els.push(el); r0.push(c0.n); tof.push(c0.t); drift.push(c0.e);
      r50.push(c50 ? c50.n : NaN);
    }
    var rMin = Math.ceil(r0[0] / step) * step;
    var rMax = Math.floor(r0[r0.length - 1] / step) * step;

    // для поправки на превышение — только те углы, где кривая r50 определена
    var e50 = [], r50v = [];
    for (var i = 0; i < els.length; i++) if (!isNaN(r50[i]) && (r50v.length === 0 || r50[i] > r50v[r50v.length - 1])) { e50.push(els[i]); r50v.push(r50[i]); }

    var rows = [];
    for (var R = rMin; R <= rMax; R += step) {
      var elR = interp(r0, els, R);
      var t = interp(r0, tof, R);
      var dr = interp(r0, drift, R);
      var dH = NaN;
      if (r50v.length > 1 && R >= r50v[0] && R <= r50v[r50v.length - 1]) {
        dH = (interp(r50v, e50, R) - elR) / 5; // дел. на каждые +10 м превышения цели
      }
      // поправки на ветер (по 10 м/с, затем на 1 м/с)
      var head = fly({ e: 0, n: 0, h: 0 }, 0, elR, v0, { e: 0, n: -10 }, flat0);
      var cross = fly({ e: 0, n: 0, h: 0 }, 0, elR, v0, { e: 10, n: 0 }, flat0);
      var base = fly({ e: 0, n: 0, h: 0 }, 0, elR, v0, null, flat0);
      var dRhead = (base.n - head.n) / 10;            // м уменьшения дальности на 1 м/с встречного ветра
      var dCross = Math.atan2(cross.e - base.e, R) / MIL / 10; // дел. сноса на 1 м/с бокового ветра
      // изменение дальности на 1 дел. прицела
      var up = fly({ e: 0, n: 0, h: 0 }, 0, elR + 1, v0, null, flat0);
      rows.push({
        range: R,
        el: elR,
        dEl10: dH,
        tof: t,
        driftMil: Math.atan2(dr, R) / MIL,
        dRperMil: up.n - base.n,
        windHead: dRhead,
        windCross: dCross
      });
    }
    return { charge: charge, rows: rows, rMin: rMin, rMax: rMax, maxEl: els[els.length - 1] };
  }

  var tablesCache = null;
  function getTables() {
    if (!tablesCache) tablesCache = CHARGES.map(function (c) { return buildTable(c, 100); });
    return tablesCache;
  }

  // ---- утилиты углов ----
  function norm6000(m) { m = m % 6000; if (m < 0) m += 6000; return m; }
  function azimuthMil(de, dn) { return norm6000(Math.atan2(de, dn) / MIL); }
  function fmtMil(m, frac) {
    var neg = m < 0; m = Math.abs(m);
    var v = frac ? Math.round(m * 10) / 10 : Math.round(m);
    var hi = Math.floor(v / 100), lo = v - hi * 100;
    var loS = frac ? lo.toFixed(1) : String(Math.round(lo));
    if (lo < 10) loS = '0' + loS;
    return (neg ? '−' : '') + hi + '-' + loS;
  }

  root.Ballistics = {
    G: G, MIL: MIL, CHARGES: CHARGES, EL_MIN: EL_MIN, EL_MAX: EL_MAX,
    fly: fly, buildTable: buildTable, getTables: getTables,
    norm6000: norm6000, azimuthMil: azimuthMil, fmtMil: fmtMil, interp: interp
  };
})(typeof window !== 'undefined' ? window : globalThis);
