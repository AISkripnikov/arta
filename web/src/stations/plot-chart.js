// Пост «ПЛАНШЕТ»: рисование карты района 20×20 км (морская карта) и мелких текстур-атласов.
// Чистый canvas 2D; ничего не знает про THREE (текстуры создаёт plot.js).

/** Геометрия листа: на листе — район [X0…X0+SPAN] × [Y0…Y0+SPAN] км; слева и снизу поля с оцифровкой. */
export const CHART = { PX: 2048, X0: -1.15, Y0: -1.15, SPAN: 21.35, MAP: 20 };

const INK = '#1a1a1a';
const C = {
  paper: '#e9e1c9', sea: '#b4c9cc', shallow: '#d2e1dd', land: '#e3d6ae', landEdge: '#6f5d3e',
  grid: 'rgba(28,48,66,', isobath: 'rgba(70,110,130,0.55)', rose: 'rgba(140,52,92,', contour: 'rgba(120,96,58,0.38)',
};
const pad2 = (n) => (n < 10 ? '0' : '') + n;

function rngOf(seed) {
  let a = (seed | 0) + 0x9e3779b9;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Рисует карту задания на canvas (PX×PX).
 * mission — game.state.mission или null (тогда — пустой лист с сеткой).
 * label(ctx, text, cx, cy, capPx, opts) — engine.textures.drawLabel (шрифт Oswald, прописные).
 */
export function drawChart(canvas, mission, label) {
  const S = CHART.PX, ppk = S / CHART.SPAN, M = CHART.MAP;
  const ctx = canvas.getContext('2d');
  const X = (x) => (x - CHART.X0) * ppk;
  const Y = (y) => (CHART.Y0 + CHART.SPAN - y) * ppk;
  const map = mission ? mission.map : null;
  const bat = mission ? (mission.battery || map.battery) : null;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = C.paper; ctx.fillRect(0, 0, S, S);

  const coastPath = (c, closeBelow) => {
    c.beginPath();
    const n = map.coast.length, st = map.coastStep;
    c.moveTo(X(-0.4), Y(map.coast[0]));
    for (let i = 0; i < n; i++) c.lineTo(X(i * st), Y(map.coast[i]));
    c.lineTo(X(M + 0.4), Y(map.coast[n - 1]));
    if (closeBelow) { c.lineTo(X(M + 0.4), Y(-0.6)); c.lineTo(X(-0.4), Y(-0.6)); c.closePath(); }
  };
  const islandPath = (c, o, k = 1, grow = 0) => {
    c.beginPath();
    c.ellipse(X(o.x), Y(o.y), (o.rx * k + grow) * ppk, (o.ry * k + grow) * ppk, -o.rot, 0, Math.PI * 2);
  };

  // ---------------- район карты ----------------
  ctx.save();
  ctx.beginPath(); ctx.rect(X(0), Y(M), M * ppk, M * ppk); ctx.clip();
  ctx.fillStyle = C.sea; ctx.fillRect(X(0), Y(M), M * ppk, M * ppk);
  // лёгкая неравномерность «глубины»: светлее к югу, темнее к северу
  const dg = ctx.createLinearGradient(0, Y(M), 0, Y(0));
  dg.addColorStop(0, 'rgba(70,105,125,0.16)'); dg.addColorStop(1, 'rgba(255,255,255,0.10)');
  ctx.fillStyle = dg; ctx.fillRect(X(0), Y(M), M * ppk, M * ppk);

  if (map) {
    // мелководье у берегов
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const [w, a] of [[2.3, 0.28], [1.25, 0.45], [0.55, 0.6]]) {
      ctx.strokeStyle = C.shallow; ctx.globalAlpha = a; ctx.lineWidth = w * ppk;
      coastPath(ctx, false); ctx.stroke();
      for (const o of map.islands) { islandPath(ctx, o); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
    // изобаты: тонкие линии на постоянном удалении от берега (обводка минус обводка поуже)
    const h = Math.round(S / 2), off = document.createElement('canvas');
    off.width = off.height = h;
    const oc = off.getContext('2d');
    oc.scale(0.5, 0.5); oc.lineJoin = 'round'; oc.lineCap = 'round';
    const ring = (wKm, dash) => {
      oc.globalCompositeOperation = 'source-over'; oc.strokeStyle = C.isobath; oc.setLineDash(dash || []);
      oc.lineWidth = wKm * ppk;
      coastPath(oc, false); oc.stroke();
      for (const o of map.islands) { islandPath(oc, o); oc.stroke(); }
      oc.globalCompositeOperation = 'destination-out'; oc.strokeStyle = '#000'; oc.setLineDash([]);
      oc.lineWidth = wKm * ppk - 5;
      coastPath(oc, false); oc.stroke();
      for (const o of map.islands) { islandPath(oc, o); oc.stroke(); }
    };
    ring(2.5); ring(1.3); ring(0.6);
    ctx.drawImage(off, 0, 0, S, S);
    off.width = off.height = 1;

    // отметки глубин
    const rnd = rngOf(map.seed * 131 + 7);
    const nearShore = (x, y) => {
      let d = y - coastOf(map, x);
      for (const o of map.islands) d = Math.min(d, Math.hypot(x - o.x, y - o.y) - Math.max(o.rx, o.ry));
      return d;
    };
    for (let i = 0; i < 170; i++) {
      const x = 0.4 + rnd() * (M - 0.8), y = 0.6 + rnd() * (M - 1.0), d = nearShore(x, y);
      if (d < 0.35) continue;
      const fx = x - Math.round(x), fy = y - Math.round(y);
      if (Math.abs(fx) < 0.16 || Math.abs(fy) < 0.16) continue;         // не на линиях сетки
      const depth = Math.max(3, Math.round(6 + d * 9 + rnd() * 9));
      label(ctx, String(depth), X(x), Y(y), 0.125 * ppk, { color: 'rgba(40,74,96,0.62)', weight: 400, spacing: 0 });
    }

    // суша: наш берег и острова
    ctx.fillStyle = C.land;
    coastPath(ctx, true); ctx.fill();
    for (const o of map.islands) { islandPath(ctx, o); ctx.fill(); }
    // горизонтали
    ctx.save();
    coastPath(ctx, true); ctx.clip();
    ctx.strokeStyle = C.contour; ctx.lineWidth = 2.2;
    for (const dy of [0.42, 0.95, 1.6]) {
      ctx.save(); ctx.translate(0, dy * ppk + (dy > 0.5 ? 6 : 0)); coastPath(ctx, false); ctx.stroke(); ctx.restore();
    }
    ctx.restore();
    for (const o of map.islands) {
      ctx.strokeStyle = C.contour; ctx.lineWidth = 2;
      islandPath(ctx, o, 0.66); ctx.stroke();
      islandPath(ctx, o, 0.34); ctx.stroke();
    }
    // береговая линия
    ctx.strokeStyle = C.landEdge; ctx.lineWidth = 4;
    coastPath(ctx, false); ctx.stroke();
    for (const o of map.islands) { islandPath(ctx, o); ctx.stroke(); }
  }

  // ---------------- сетка ----------------
  // штрихи через 0.1 км вдоль линий сетки
  ctx.beginPath();
  for (let i = 0; i <= M; i++) {
    for (let j = 1; j < M * 10; j++) {
      if (j % 10 === 0) continue;
      const l = j % 5 === 0 ? 9 : 4.5, t = j / 10;
      ctx.moveTo(X(i) - l, Y(t)); ctx.lineTo(X(i) + l, Y(t));
      ctx.moveTo(X(t), Y(i) - l); ctx.lineTo(X(t), Y(i) + l);
    }
  }
  ctx.strokeStyle = C.grid + '0.34)'; ctx.lineWidth = 1.3; ctx.stroke();
  for (const heavy of [false, true]) {
    ctx.beginPath();
    for (let i = 0; i <= M; i++) {
      if ((i % 5 === 0) !== heavy) continue;
      ctx.moveTo(X(i), Y(0)); ctx.lineTo(X(i), Y(M));
      ctx.moveTo(X(0), Y(i)); ctx.lineTo(X(M), Y(i));
    }
    ctx.strokeStyle = C.grid + (heavy ? '0.62)' : '0.36)'); ctx.lineWidth = heavy ? 4.2 : 2; ctx.stroke();
  }
  // мелкая оцифровка линий (читается под лупой): номер линии посередине каждого километрового отрезка
  const tagCap = 0.118 * ppk;
  const tag = (text, cx, cy) => {
    ctx.fillStyle = 'rgba(233,225,201,0.82)';
    ctx.fillRect(cx - tagCap * 0.95, cy - tagCap * 0.82, tagCap * 1.9, tagCap * 1.64);
    label(ctx, text, cx, cy, tagCap, { color: 'rgba(24,40,58,0.8)', weight: 500, spacing: 0.02 });
  };
  for (let i = 1; i < M; i++) for (let j = 0; j < M; j++) {
    tag(pad2(i), X(i), Y(j + 0.5));
    tag(pad2(i), X(j + 0.5), Y(i));
  }

  if (map) {
    // картушка компаса — в самом свободном месте моря
    let best = null, bd = -1;
    for (const [x, y] of [[16.6, 6.4], [3.4, 6.4], [16.6, 16.8], [3.4, 16.8], [10, 17.4], [3.4, 11.5], [16.6, 11.5]]) {
      let d = bat ? Math.hypot(x - bat.x, y - bat.y) * 0.5 : 9;
      for (const o of map.islands) d = Math.min(d, Math.hypot(x - o.x, y - o.y) - Math.max(o.rx, o.ry));
      if (d > bd) { bd = d; best = [x, y]; }
    }
    drawRose(ctx, X(best[0]), Y(best[1]), 1.55 * ppk, label);

    // названия островов
    for (const o of map.islands) {
      const below = o.y > 9;
      label(ctx, o.name, X(o.x), Y(o.y + (below ? -1 : 1) * (Math.max(o.rx, o.ry) * 0.8 + 0.42)), 0.2 * ppk,
        { color: 'rgba(30,44,60,0.9)', weight: 500, spacing: 0.12 });
    }

    // батарея «УТЁС»
    if (bat) {
      const bx = X(bat.x), by = Y(bat.y), r = 0.5 * ppk;
      ctx.strokeStyle = INK; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2;
        ctx.moveTo(bx + Math.cos(a) * r, by + Math.sin(a) * r); ctx.lineTo(bx + Math.cos(a) * r * 1.5, by + Math.sin(a) * r * 1.5);
      }
      ctx.stroke();
      ctx.fillStyle = '#8f1d14';
      ctx.beginPath(); ctx.arc(bx, by, r * 0.42, 0, Math.PI * 2); ctx.fill();
      const lx = bat.x + (bat.x > 10 ? -2.1 : 2.1);
      ctx.fillStyle = 'rgba(227,214,174,0.85)';
      ctx.fillRect(X(lx) - 1.25 * ppk, Y(bat.y - 0.72) - 0.5 * ppk, 2.5 * ppk, 1.0 * ppk);
      label(ctx, 'УТЁС', X(lx), Y(bat.y - 0.72), 0.7 * ppk, { color: INK, weight: 700, spacing: 0.08 });
    }

    // картуш и линейный масштаб — на суше в углах листа
    const left = !bat || bat.x > 10;
    const cx0 = left ? 0.35 : M - 5.6;
    ctx.fillStyle = 'rgba(233,225,201,0.9)'; ctx.strokeStyle = 'rgba(26,26,26,0.75)'; ctx.lineWidth = 2;
    ctx.fillRect(X(cx0), Y(1.42), 5.25 * ppk, 1.14 * ppk); ctx.strokeRect(X(cx0), Y(1.42), 5.25 * ppk, 1.14 * ppk);
    ctx.strokeRect(X(cx0) + 5, Y(1.42) + 5, 5.25 * ppk - 10, 1.14 * ppk - 10);
    label(ctx, 'БАТАРЕЯ «УТЁС»', X(cx0 + 2.625), Y(1.08), 0.27 * ppk, { color: INK, weight: 700, spacing: 0.1 });
    label(ctx, 'ПЛАНШЕТ ОГНЯ · СЕТКА 1 КМ', X(cx0 + 2.625), Y(0.58), 0.17 * ppk, { color: INK, weight: 500, spacing: 0.1 });
    const sx0 = left ? M - 5.8 : 0.8, sy = 0.62;
    for (let k = 0; k < 5; k++) {
      ctx.fillStyle = k % 2 ? C.paper : INK;
      ctx.fillRect(X(sx0 + k), Y(sy) - 6, ppk, 12);
    }
    ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(X(sx0), Y(sy) - 6, 5 * ppk, 12);
    for (const k of [0, 5]) label(ctx, k + (k ? ' КМ' : ''), X(sx0 + k), Y(sy + 0.34), 0.17 * ppk, { color: INK, weight: 600 });
  }
  ctx.restore();

  // ---------------- рамка и оцифровка по краям ----------------
  ctx.strokeStyle = INK; ctx.lineWidth = 5;
  ctx.strokeRect(X(0), Y(M), M * ppk, M * ppk);
  ctx.lineWidth = 2;
  ctx.strokeRect(X(0) - 11, Y(M) - 11, M * ppk + 22, M * ppk + 22);
  // километровая «зебра» в рамке
  for (let i = 0; i < M; i++) {
    if (i % 2) continue;
    ctx.fillStyle = INK;
    ctx.fillRect(X(i), Y(0) + 2, ppk, 9);
    ctx.fillRect(X(0) - 11, Y(i + 1), 9, ppk);
  }
  for (let i = 0; i <= M; i++) {
    const big = i % 5 === 0, cap = (big ? 0.6 : 0.3) * ppk;
    const o = { color: INK, weight: big ? 700 : 500, spacing: 0.02 };
    label(ctx, pad2(i), X(i), Y(-0.16) + cap * 0.5 + 10, cap, o);
    label(ctx, pad2(i), X(-0.2) - (big ? 0.42 : 0.24) * ppk - 4, Y(i), cap, o);
  }
  label(ctx, 'X', X(M) + 0.0 * ppk - 0.1 * ppk, Y(-0.9), 0.24 * ppk, { color: INK, weight: 700 });
  label(ctx, 'Y', X(-0.72), Y(M) - 0.0 * ppk + 0.02 * ppk, 0.001, { color: INK });

  // старение бумаги: виньетка
  const vg = ctx.createRadialGradient(S / 2, S / 2, S * 0.45, S / 2, S / 2, S * 0.76);
  vg.addColorStop(0, 'rgba(90,70,30,0)'); vg.addColorStop(1, 'rgba(90,70,30,0.16)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, S, S);
}

function coastOf(map, x) {
  const i = Math.max(0, Math.min(map.coast.length - 2, Math.floor(x / map.coastStep)));
  const f = Math.max(0, Math.min(1, x / map.coastStep - i));
  return map.coast[i] + (map.coast[i + 1] - map.coast[i]) * f;
}

function drawRose(ctx, cx, cy, R, label) {
  const col = (a) => C.rose + a + ')';
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = col(0.6); ctx.fillStyle = col(0.6);
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(0, 0, R * 0.8, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  for (let d = 0; d < 360; d += 5) {
    const a = d * Math.PI / 180, r0 = R * (d % 30 === 0 ? 0.8 : d % 10 === 0 ? 0.87 : 0.93);
    ctx.moveTo(Math.sin(a) * r0, -Math.cos(a) * r0); ctx.lineTo(Math.sin(a) * R, -Math.cos(a) * R);
  }
  ctx.stroke();
  // восьмилучевая звезда
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4, len = R * (k % 2 ? 0.42 : 0.74), w = R * 0.085;
    ctx.save(); ctx.rotate(a);
    ctx.beginPath(); ctx.moveTo(0, -len); ctx.lineTo(w, 0); ctx.lineTo(-w, 0); ctx.closePath();
    ctx.fillStyle = col(k === 0 ? 0.75 : 0.3); ctx.fill();
    ctx.strokeStyle = col(0.7); ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  }
  label(ctx, 'С', 0, -R * 1.17, R * 0.2, { color: col(0.85), weight: 700 });
  for (const [t, d] of [['090', 90], ['180', 180], ['270', 270]]) {
    const a = d * Math.PI / 180;
    label(ctx, t, Math.sin(a) * R * 1.2, -Math.cos(a) * R * 1.15, R * 0.11, { color: col(0.8), weight: 500 });
  }
  ctx.restore();
}

/** Атлас номеров фишек: 6 столбцов (цифры 1…6) × 3 строки (обычная, выбранная, поражённая). */
export function drawPinAtlas(canvas, label) {
  const cell = 96;
  canvas.width = cell * 6; canvas.height = cell * 3;
  const ctx = canvas.getContext('2d');
  const rows = [['#ece4cc', '#16171a'], ['#f4b63a', '#16171a'], ['#7f858a', '#3a3d40']];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
    const x = c * cell, y = r * cell;
    ctx.fillStyle = rows[r][0]; ctx.fillRect(x, y, cell, cell);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x + cell / 2, y + cell / 2, cell * 0.43, 0, Math.PI * 2); ctx.stroke();
    label(ctx, String(c + 1), x + cell / 2, y + cell / 2, cell * 0.5, { color: rows[r][1], weight: 700, spacing: 0 });
    if (r === 2) {
      ctx.strokeStyle = '#b3261a'; ctx.lineWidth = 9; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + cell * 0.24, y + cell * 0.24); ctx.lineTo(x + cell * 0.76, y + cell * 0.76);
      ctx.moveTo(x + cell * 0.76, y + cell * 0.24); ctx.lineTo(x + cell * 0.24, y + cell * 0.76);
      ctx.stroke();
    }
  }
}

/** Атлас подписей отметок упреждения: цифры 1…5 (минуты) в ряд. */
export function drawLeadAtlas(canvas, label) {
  const cell = 64;
  canvas.width = cell * 5; canvas.height = cell;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = 'rgba(233,225,201,0.9)';
    ctx.beginPath(); ctx.arc(i * cell + cell / 2, cell / 2, cell * 0.44, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#9c2418'; ctx.lineWidth = 3; ctx.stroke();
    label(ctx, String(i + 1), i * cell + cell / 2, cell / 2, cell * 0.46, { color: '#9c2418', weight: 700, spacing: 0 });
  }
}

/**
 * Шкала алидады: canvas вдоль линейки (ось X — дальность от оси, 0 — на левом краю), kmTotal км на всю длину.
 * Прозрачный целлулоид с кромками, делениями через 0.1 км и красной визирной линией по оси.
 */
export function drawRulerScale(canvas, kmTotal, label) {
  const W = canvas.width, H = canvas.height, ppk = W / kmTotal;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,226,140,0.27)';
  ctx.fillRect(0, 0, W, H);
  // кромки линейки
  ctx.fillStyle = 'rgba(20,24,28,0.85)';
  ctx.fillRect(0, 0, W, 5); ctx.fillRect(0, H - 5, W, 5);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(0, 5, W, 3); ctx.fillRect(0, H - 8, W, 3);
  ctx.fillStyle = 'rgba(16,20,24,0.88)';
  for (let j = 0; j <= kmTotal * 10 + 0.5; j++) {
    const x = j / 10 * ppk;
    const km = j % 10 === 0, half = j % 5 === 0;
    const len = km ? (j % 50 === 0 ? H * 0.3 : H * 0.22) : half ? H * 0.14 : H * 0.07;
    const w = km ? 3 : 1.4;
    ctx.fillRect(x - w / 2, H - 8 - len, w, len);
    ctx.fillRect(x - w / 2, 8, w, len);
    if (km && j > 0) {
      label(ctx, String(j / 10), x + H * 0.2, H * 0.25, H * (j % 50 === 0 ? 0.2 : 0.15), { color: 'rgba(16,20,24,0.9)', weight: 700, spacing: 0 });
    }
  }
  // визирная линия
  ctx.fillStyle = 'rgba(176,30,20,0.95)';
  ctx.fillRect(0, H / 2 - 1.25, W, 2.5);
}

/** Бирка с двумя отсчётами (видна под лупой): «X 12.34  Y 07.80». */
export function drawTag(canvas, a, b, label) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#111316'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(232,224,200,0.6)'; ctx.lineWidth = 3; ctx.strokeRect(3.5, 3.5, W - 7, H - 7);
  label(ctx, a, W * 0.27, H / 2, H * 0.42, { color: '#e8e0c8', weight: 600, spacing: 0.04, maxWidth: W * 0.44 });
  label(ctx, b, W * 0.73, H / 2, H * 0.42, { color: '#e8e0c8', weight: 600, spacing: 0.04, maxWidth: W * 0.44 });
}
