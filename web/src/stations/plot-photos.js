// Аэрофотоснимки района разрыва на карте планшета: через пару секунд после разрыва поверх карты
// ложится чёрно-белый «снимок с самолёта-разведчика» — море с волнами, суша с полями, лесом и домами,
// воронка или всплеск, сама цель (корабль с кильватерным следом, орудийные дворики, форт), обломки.
// Рисуется один раз на холсте и кладётся на лист как отдельная плитка.

const SIZE = 2.2;          // км — сторона снимка
const PX = 448;            // разрешение холста снимка
const BORDER = 0.12;       // км — белое поле рамки
const DELAY = 2.5;         // с игрового времени от разрыва до появления снимка
const KEEP = 8;            // сколько последних снимков держать

// ---------- детерминированный шум, привязанный к карте (снимки соседних разрывов совпадают) ----------
function hash(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const fbm = (x, y, seed) => vnoise(x, y, seed) * 0.6 + vnoise(x * 2.3, y * 2.3, seed + 7) * 0.28 + vnoise(x * 5.1, y * 5.1, seed + 13) * 0.12;

// длина корабля (м) и «ширина» по типу
const SHIPS = {
  barge: [45, 12], transport: [125, 18], destroyer: [115, 11], cruiser: [180, 19], battleship: [240, 32],
  minelayer: [85, 12], submarine: [75, 7], tanker: [165, 24], landing: [16, 5],
};

/** Box-размытие маски radius×radius (дважды, раздельно по осям) → Float32Array 0…1. */
function blur(mask, n, r) {
  const a = new Float32Array(n * n), b = new Float32Array(n * n);
  for (let i = 0; i < mask.length; i++) a[i] = mask[i];
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < n; j++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += a[j * n + Math.min(n - 1, Math.max(0, i))];
      for (let i = 0; i < n; i++) {
        b[j * n + i] = acc / (2 * r + 1);
        acc += a[j * n + Math.min(n - 1, i + r + 1)] - a[j * n + Math.max(0, i - r)];
      }
    }
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let j = -r; j <= r; j++) acc += b[Math.min(n - 1, Math.max(0, j)) * n + i];
      for (let j = 0; j < n; j++) {
        a[j * n + i] = acc / (2 * r + 1);
        acc += b[Math.min(n - 1, j + r + 1) * n + i] - b[Math.max(0, j - r) * n + i];
      }
    }
  }
  return a;
}

export function createPhotos({ THREE, TX, K, kmU, kmV, game }) {
  const group = new THREE.Group();
  group.name = 'aerialPhotos';
  const photos = new Map();      // n выстрела → { mesh, mat, tex, born }
  const skipped = new Set();     // ночные разрывы вне света: снимать было нечего
  let missionRef = null;

  function clear() {
    for (const p of photos.values()) { group.remove(p.mesh); p.tex.dispose(); p.mat.dispose(); p.mesh.geometry.dispose(); }
    photos.clear();
    skipped.clear();
  }

  /** Нарисовать снимок разрыва im (из state.impacts). */
  function render(im, mission) {
    const seed = (mission.mapSeed | 0) + 17;
    const cv = TX.makeCanvas(PX, PX), ctx = cv.getContext('2d');
    const kmPx = PX / SIZE, mPx = kmPx / 1000;          // пикселей на км и на метр
    const big = mPx * 2.2;                               // объекты — крупнее масштаба, чтобы читались
    const x0 = im.x - SIZE / 2, y1 = im.y + SIZE / 2;
    const wx = (i) => x0 + (i + 0.5) / kmPx, wy = (j) => y1 - (j + 0.5) / kmPx;
    const px = (x) => (x - x0) * kmPx, py = (y) => (y1 - y) * kmPx;

    // --- маска суши в полном разрешении и «близость к берегу» (размытая маска) ---
    const land = new Uint8Array(PX * PX);
    for (let j = 0; j < PX; j++) for (let i = 0; i < PX; i++) land[j * PX + i] = game.isLand(wx(i), wy(j)) ? 1 : 0;
    const near = blur(land, PX, 7);                       // 0…1: доля суши в окрестности ~35 м
    const img = ctx.createImageData(PX, PX), d = img.data;
    for (let j = 0; j < PX; j++) {
      for (let i = 0; i < PX; i++) {
        const k = j * PX + i, L = land[k], nb = near[k];
        const x = wx(i), y = wy(j);
        let v;
        if (L) {
          // поля: прямоугольные наделы, ориентация меняется по районам; пахота — тонкие полосы
          const rx = Math.floor(x / 0.9), ry = Math.floor(y / 0.9);                 // район ~0.9 км: свой угол наделов
          const ang = (hash(rx, ry, seed + 41) - 0.5) * 1.4, ca = Math.cos(ang), sa = Math.sin(ang);
          const lx = x - rx * 0.9, ly = y - ry * 0.9;
          const u = lx * ca - ly * sa + rx * 7.3, w = lx * sa + ly * ca + ry * 5.1;
          const fu = Math.floor(u / 0.16), fw = Math.floor(w / 0.075);
          const tone = hash(fu, fw, seed + 3);
          v = 138 + tone * 80;
          if (tone > 0.6) v += Math.sin(w * 380 + tone * 9) * 9;              // пахота: полосы ~16 м
          const edge = Math.min(Math.abs(((u / 0.16) % 1 + 1) % 1 - 0.5), Math.abs(((w / 0.075) % 1 + 1) % 1 - 0.5) * 0.47 / 0.5);
          if (edge > 0.47) v = v * 0.8;                                      // межа
          // лес: тёмный, «кучерявый»
          const forest = fbm(x / 0.3, y / 0.3, seed + 11);
          if (forest > 0.57) {
            const crown = vnoise(x * 160, y * 160, seed + 51);
            v = 52 + crown * 55 + (forest - 0.57) * 40;
          }
          // дороги: изолинии шума
          const r = fbm(x / 0.7, y / 0.7, seed + 61);
          if (Math.abs(r - 0.5) < 0.006) v = 205;
          // песок у воды
          if (nb < 0.75) v = Math.max(v, 200 + (0.75 - nb) * 40);
        } else {
          // море: ровный серый, лёгкая зыбь и рябь; у берега — светлый прибой
          const swell = Math.sin((x * 0.83 + y * 0.56) * 340 + fbm(x * 7, y * 7, seed + 5) * 7);
          v = 96 + fbm(x * 3, y * 3, seed + 2) * 18 + swell * 5;
          if (nb > 0.06) v += Math.min(1, (nb - 0.06) * 3) * 55;
        }
        v += (Math.random() - 0.5) * 16;                  // зерно плёнки
        const o = k * 4;
        d[o] = d[o + 1] = d[o + 2] = Math.max(0, Math.min(255, v)); d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // --- дома: клетки 45 м на суше в «деревнях» (по шуму) ---
    const cell = 0.045;
    for (let gy = Math.floor((y1 - SIZE) / cell); gy <= Math.ceil(y1 / cell); gy++) {
      for (let gx = Math.floor(x0 / cell); gx <= Math.ceil((x0 + SIZE) / cell); gx++) {
        const hx = (gx + 0.2 + hash(gx, gy, seed + 21) * 0.6) * cell, hy = (gy + 0.2 + hash(gx, gy, seed + 22) * 0.6) * cell;
        if (fbm(hx / 0.4, hy / 0.4, seed + 31) < 0.6 || hash(gx, gy, seed + 23) > 0.55) continue;
        if (!game.isLand(hx, hy)) continue;
        const w = (14 + hash(gx, gy, seed + 24) * 12) * mPx, h = (10 + hash(gx, gy, seed + 25) * 7) * mPx;
        const a = Math.round(hash(gx, gy, seed + 26) * 2) * Math.PI / 2 + (hash(gx, gy, seed + 27) - 0.5) * 0.3;
        ctx.save(); ctx.translate(px(hx), py(hy)); ctx.rotate(a);
        ctx.fillStyle = 'rgba(20,20,20,0.55)'; ctx.fillRect(-w / 2 + 1.5, -h / 2 + 1.5, w, h);   // тень
        ctx.fillStyle = 'rgb(205,205,205)'; ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.fillStyle = 'rgb(160,160,160)'; ctx.fillRect(-w / 2, -0.5, w, 1);                     // конёк крыши
        ctx.restore();
      }
    }

    // --- старые воронки на суше ---
    for (const c of im.craters || []) {
      if (!game.isLand(c.x, c.y)) continue;
      crater(ctx, px(c.x), py(c.y), big, false);
    }

    // --- цели ---
    for (const t of im.snap || []) drawTarget(ctx, t, px(t.x), py(t.y), big);

    // --- свежий разрыв ---
    if (im.land) crater(ctx, px(im.x), py(im.y), big, true);
    else splash(ctx, px(im.x), py(im.y), big);

    // --- туман: снимок сквозь дымку — блёклый, малоконтрастный ---
    if (mission.weather === 'fog') {
      ctx.fillStyle = 'rgba(190,192,190,0.5)'; ctx.fillRect(0, 0, PX, PX);
      for (let k = 0; k < 9; k++) {
        const fx = hash(k, 3, seed + im.n) * PX, fy = hash(k, 7, seed + im.n) * PX, fr = PX * (0.18 + hash(k, 11, seed) * 0.2);
        const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr);
        g.addColorStop(0, 'rgba(215,216,214,0.42)'); g.addColorStop(1, 'rgba(215,216,214,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(fx, fy, fr, 0, Math.PI * 2); ctx.fill();
      }
    }
    // --- ночь: снимок при свете осветительного — темнее к краям ---
    if (mission.night) {
      const ng = ctx.createRadialGradient(PX / 2, PX / 2, PX * 0.1, PX / 2, PX / 2, PX * 0.72);
      ng.addColorStop(0, 'rgba(0,0,10,0.08)'); ng.addColorStop(1, 'rgba(0,0,10,0.7)');
      ctx.fillStyle = ng; ctx.fillRect(0, 0, PX, PX);
    }

    // --- плёнка: виньетка ---
    const vg = ctx.createRadialGradient(PX / 2, PX / 2, PX * 0.25, PX / 2, PX / 2, PX * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.38)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, PX, PX);

    // --- рамка с подписью, как у отпечатка аэрофотоснимка ---
    const B = Math.round(BORDER / (SIZE + 2 * BORDER) * (PX + 0)), F = PX + 2 * B;
    const out = TX.makeCanvas(F, F), o2 = out.getContext('2d');
    o2.fillStyle = '#e9e4d6'; o2.fillRect(0, 0, F, F);
    o2.drawImage(cv, B, B);
    o2.strokeStyle = '#111'; o2.lineWidth = 2; o2.strokeRect(B - 1, B - 1, PX + 2, PX + 2);
    // метки-реперы по углам
    o2.fillStyle = '#111';
    for (const [ax, ay] of [[B / 2, B / 2], [F - B / 2, B / 2], [B / 2, F - B / 2], [F - B / 2, F - B / 2]]) { o2.beginPath(); o2.arc(ax, ay, 5, 0, Math.PI * 2); o2.fill(); }
    const tm = game.fmt.time(im.time);
    o2.save(); o2.globalAlpha = 0.85;
    o2.font = '600 17px Oswald, "Arial Narrow", sans-serif'; o2.textBaseline = 'middle';
    o2.fillText('№' + im.n + '  ·  ' + tm + '  ·  АЭРОФОТО', B + 10, F - B / 2);
    o2.textAlign = 'right';
    o2.fillText('X ' + game.fmt.km(im.x) + '  Y ' + game.fmt.km(im.y), F - B - 10, B / 2);
    o2.restore();
    return out;
  }

  function crater(ctx, x, y, mPx, fresh) {
    const r = (fresh ? 14 : 10) * mPx;
    // выброс грунта — светлые лучи
    ctx.save(); ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(225,225,225,0.55)'; ctx.lineWidth = Math.max(1, 2.5 * mPx);
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + Math.random() * 0.4, L = r * (2 + Math.random() * 2.2);
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); ctx.lineTo(Math.cos(a) * L, Math.sin(a) * L); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(200,200,200,0.5)'; ctx.beginPath(); ctx.arc(0, 0, r * 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgb(28,28,28)'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgb(70,70,70)'; ctx.beginPath(); ctx.arc(-r * 0.25, -r * 0.25, r * 0.45, 0, Math.PI * 2); ctx.fill();
    if (fresh) {
      // дым, сносимый ветром
      for (let k = 0; k < 7; k++) {
        const g = ctx.createRadialGradient(r * (1 + k * 0.9), -r * (0.6 + k * 0.5), 0, r * (1 + k * 0.9), -r * (0.6 + k * 0.5), r * (1.6 + k * 0.5));
        g.addColorStop(0, 'rgba(235,235,235,' + (0.55 - k * 0.06) + ')'); g.addColorStop(1, 'rgba(235,235,235,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(r * (1 + k * 0.9), -r * (0.6 + k * 0.5), r * (1.6 + k * 0.5), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  function splash(ctx, x, y, mPx) {
    const r = 16 * mPx;
    ctx.save(); ctx.translate(x, y);
    for (let k = 3; k >= 0; k--) {
      ctx.strokeStyle = 'rgba(240,240,240,' + (0.25 + k * 0.15) + ')'; ctx.lineWidth = Math.max(1, (4 - k) * 1.2 * mPx * 3);
      ctx.beginPath(); ctx.arc(0, 0, r * (1 + k * 0.8), 0, Math.PI * 2); ctx.stroke();
    }
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.3);
    g.addColorStop(0, 'rgba(250,250,250,0.95)'); g.addColorStop(1, 'rgba(250,250,250,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r * 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function smoke(ctx, x, y, r, dark) {
    for (let k = 0; k < 6; k++) {
      const cx = x + r * k * 0.9, cy = y - r * k * 0.55, rr = r * (1 + k * 0.45);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
      const c = dark ? '25,25,25' : '230,230,230';
      g.addColorStop(0, `rgba(${c},${0.7 - k * 0.09})`); g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawTarget(ctx, t, x, y, mPx) {
    const ship = SHIPS[t.kind];
    ctx.save(); ctx.translate(x, y);
    if (ship) {
      const n = t.kind === 'landing' ? 4 : 1;
      for (let b = 0; b < n; b++) {
        ctx.save();
        if (n > 1) ctx.translate((b - 1.5) * 26 * mPx, ((b % 2) - 0.5) * 22 * mPx);
        ctx.rotate((t.course || 0) * Math.PI / 180);
        const L = ship[0] * mPx, W = Math.max(2, ship[1] * mPx);
        if (t.alive) {
          // кильватерный след и носовой бурун
          if (t.moving) {
            ctx.fillStyle = 'rgba(235,235,235,0.35)';
            ctx.beginPath(); ctx.moveTo(-W / 2, L * 0.45); ctx.lineTo(-W * 2.4 - L * 0.4, L * 2.8); ctx.lineTo(W * 2.4 + L * 0.4, L * 2.8); ctx.lineTo(W / 2, L * 0.45); ctx.fill();
            ctx.strokeStyle = 'rgba(245,245,245,0.75)'; ctx.lineWidth = Math.max(1, W * 0.25);
            ctx.beginPath(); ctx.moveTo(0, -L / 2); ctx.lineTo(-W, -L * 0.35); ctx.moveTo(0, -L / 2); ctx.lineTo(W, -L * 0.35); ctx.stroke();
          }
          ctx.fillStyle = 'rgba(15,15,15,0.5)';
          hull(ctx, L, W, 1.5); ctx.fill();
          ctx.fillStyle = t.kind === 'submarine' ? 'rgb(45,45,45)' : 'rgb(150,150,150)';
          hull(ctx, L, W, 0); ctx.fill();
          if (t.kind !== 'barge' && t.kind !== 'submarine' && t.kind !== 'landing') {
            ctx.fillStyle = 'rgb(205,205,205)';
            ctx.fillRect(-W * 0.3, -L * 0.12, W * 0.6, L * 0.22);                      // надстройка
            if (L > 30) for (const k of [-0.32, 0.3]) { ctx.beginPath(); ctx.arc(0, L * k, W * 0.28, 0, Math.PI * 2); ctx.fill(); }   // башни
          }
          if (t.damaged) smoke(ctx, 0, 0, W * 0.9, true);
        } else {
          // потоплен: нефтяное пятно, обломки, дым
          ctx.fillStyle = 'rgba(20,20,20,0.75)'; ctx.beginPath(); ctx.ellipse(0, 0, W * 2.2, L * 0.7, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgb(120,120,120)';
          for (let k = 0; k < 7; k++) ctx.fillRect((Math.random() - 0.5) * W * 3, (Math.random() - 0.5) * L, 2 + Math.random() * W * 0.4, 2 + Math.random() * 4);
          smoke(ctx, 0, 0, W * 1.3, true);
        }
        ctx.restore();
      }
    } else {
      // наземные цели
      const R = 1;
      if (!t.alive) { ctx.fillStyle = 'rgba(15,15,15,0.8)'; ctx.beginPath(); ctx.arc(0, 0, 55 * mPx, 0, Math.PI * 2); ctx.fill(); }
      ctx.strokeStyle = t.alive ? 'rgb(35,35,35)' : 'rgb(80,80,80)'; ctx.fillStyle = 'rgb(90,90,90)'; ctx.lineWidth = Math.max(1, 3 * mPx);
      if (t.kind === 'battery' || t.kind === 'howitzer') {
        // орудийные дворики дугой и ход сообщения
        ctx.beginPath(); ctx.moveTo(-60 * mPx, 22 * mPx); ctx.quadraticCurveTo(0, 50 * mPx, 60 * mPx, 22 * mPx); ctx.stroke();
        for (let k = -1.5; k <= 1.5; k++) {
          const gx = k * 38 * mPx, gy = Math.abs(k) * 6 * mPx;
          ctx.fillStyle = 'rgb(200,200,200)'; ctx.beginPath(); ctx.arc(gx, gy, 13 * mPx * R, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = t.alive ? 'rgb(40,40,40)' : 'rgb(110,110,110)'; ctx.beginPath(); ctx.arc(gx, gy, 6 * mPx, 0, Math.PI * 2); ctx.fill();
          if (t.alive) { ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx, gy - 16 * mPx); ctx.stroke(); }
        }
      } else if (t.kind === 'fort' || t.kind === 'bunker') {
        const s = (t.kind === 'fort' ? 70 : 22) * mPx;
        ctx.fillStyle = 'rgb(185,185,185)'; ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.fillStyle = 'rgb(60,60,60)'; ctx.fillRect(-s / 2 + 4 * mPx, -s / 2 + 4 * mPx, s - 8 * mPx, s - 8 * mPx);
        if (t.kind === 'fort') for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.fillStyle = 'rgb(185,185,185)'; ctx.beginPath(); ctx.arc(a * s / 2, b * s / 2, 9 * mPx, 0, Math.PI * 2); ctx.fill(); }
      } else if (t.kind === 'radar') {
        ctx.fillStyle = 'rgb(200,200,200)'; ctx.fillRect(-14 * mPx, -6 * mPx, 28 * mPx, 12 * mPx);
        ctx.strokeStyle = 'rgb(220,220,220)'; ctx.lineWidth = Math.max(1, 2 * mPx);
        ctx.beginPath(); ctx.arc(0, -20 * mPx, 14 * mPx, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      } else {
        // склад и прочее: штабели
        ctx.fillStyle = 'rgb(195,195,195)';
        for (let k = 0; k < 5; k++) ctx.fillRect((k % 3 - 1) * 22 * mPx - 8 * mPx, (Math.floor(k / 3) - 0.5) * 22 * mPx - 6 * mPx, 16 * mPx, 12 * mPx);
      }
      if (!t.alive) smoke(ctx, 0, 0, 30 * mPx, true);
      else if (t.damaged) smoke(ctx, 0, 0, 18 * mPx, true);
    }
    ctx.restore();
  }

  /** Корпус корабля: заострённый нос (вверху, −y), скруглённая корма. */
  function hull(ctx, L, W, off) {
    ctx.beginPath();
    ctx.moveTo(off, -L / 2 + off);
    ctx.quadraticCurveTo(W / 2 + off, -L * 0.25 + off, W / 2 + off, L * 0.3 + off);
    ctx.quadraticCurveTo(W / 2 + off, L / 2 + off, off, L / 2 + off);
    ctx.quadraticCurveTo(-W / 2 + off, L / 2 + off, -W / 2 + off, L * 0.3 + off);
    ctx.quadraticCurveTo(-W / 2 + off, -L * 0.25 + off, off, -L / 2 + off);
    ctx.closePath();
  }

  function add(im, mission) {
    const cv = render(im, mission);
    const tex = TX.canvasTexture(cv, { aniso: 4 });
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, color: 0xe6e2d8 });
    const side = (SIZE + 2 * BORDER) * K;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(side, side), mat);
    mesh.position.set(kmU(im.x), kmV(im.y), 0.00012 + (im.n % 50) * 0.000002);
    mesh.renderOrder = 0;
    group.add(mesh);
    photos.set(im.n, { mesh, mat, tex, born: im.time });
    // держим только последние KEEP снимков
    if (photos.size > KEEP) {
      const oldest = [...photos.keys()].sort((a, b) => a - b)[0];
      const p = photos.get(oldest);
      group.remove(p.mesh); p.tex.dispose(); p.mat.dispose(); p.mesh.geometry.dispose();
      photos.delete(oldest);
    }
  }

  return {
    group,
    update(s) {
      if (s.mission !== missionRef) { clear(); missionRef = s.mission; }
      if (!s.mission) return;
      const imps = s.impacts || [];
      let made = 0;
      for (const im of imps) {
        if (photos.has(im.n) || skipped.has(im.n) || s.time - im.time < DELAY) continue;
        if (imps.length - imps.indexOf(im) > KEEP) continue;
        // ночью самолёт снимает только то, что освещено
        if (s.mission.night && !(game.lit ? game.lit(im.x, im.y) : false)) { skipped.add(im.n); continue; }
        if (made++ >= 1) break;                      // не больше одного снимка за кадр
        add(im, s.mission);
      }
      for (const p of photos.values()) {
        const a = Math.min(1, Math.max(0, (s.time - p.born - DELAY) / 0.8));
        if (p.mat.opacity !== a) { p.mat.opacity = a; p.mat.transparent = a < 1; }
      }
    },
    /** Для тестов: номера выстрелов, по которым есть снимок. */
    get shown() { return [...photos.keys()]; },
    /** Есть ли проявившийся снимок, накрывающий точку листа (u, v)? */
    covers(u, v) {
      const h = (SIZE / 2 + BORDER) * K;
      for (const p of photos.values()) if (p.mat.opacity > 0.3 && Math.abs(p.mesh.position.x - u) < h && Math.abs(p.mesh.position.y - v) < h) return true;
      return false;
    },
    dispose() { clear(); },
  };
}
