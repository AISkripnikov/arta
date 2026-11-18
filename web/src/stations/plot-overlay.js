// Прозрачный слой поверх карты планшета: полёт снаряда, круги разрывов, посты и пеленги звукометрии,
// свои корабли и их курсы, пеленги и сектор трубы наблюдательного поста, воздушный налёт, тонущие цели.
// Рисуется на отдельном холсте и перерисовывается только когда что-то изменилось.
import { CHART } from './plot-chart.js';

const PX = 1024;                       // разрешение слоя (вся карта)
const S = PX / CHART.SPAN;             // пикселей холста на километр
let Z = 1;                             // масштаб знаков: 1 — обзор карты, меньше — под лупой
const font = (px) => `600 ${Math.round(px * Z)}px Oswald, "Arial Narrow", sans-serif`;

const cx = (x) => (x - CHART.X0) * S;
const cy = (y) => PX - (y - CHART.Y0) * S;
const RAD = Math.PI / 180;
const M = CHART.MAP;
const LAND_KINDS = { battery: 1, howitzer: 1, bunker: 1, depot: 1, fort: 1, radar: 1 };
const q05 = (v) => Math.round(v * 20) / 20;
/** Сколько км от точки (x, y) по пеленгу до рамки карты [lo…M−lo]; точка вне рамки → 0. */
function toEdge(x, y, bearing, lo = 0) {
  const dx = Math.sin(bearing * RAD), dy = Math.cos(bearing * RAD);
  let k = 1e9;
  if (dx > 1e-9) k = Math.min(k, (M - lo - x) / dx); else if (dx < -1e-9) k = Math.min(k, (lo - x) / dx);
  if (dy > 1e-9) k = Math.min(k, (M - lo - y) / dy); else if (dy < -1e-9) k = Math.min(k, (lo - y) / dy);
  return Math.max(0, k);
}

export function createOverlay({ THREE, TX, size }) {
  const canvas = TX.makeCanvas(PX, PX);
  const ctx = canvas.getContext('2d');
  const tex = TX.canvasTexture(canvas, { aniso: 4 });
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  mesh.renderOrder = 1;
  mesh.name = 'plotOverlay';
  let key = '', lastDraw = -1;
  /** Что сейчас нарисовано (для тестов и поста): квадраты, свет, дым, пометки фишек, пары «вилки», тон карты, ветер. */
  const info = { areas: [], lights: 0, smokes: 0, marks: {}, pairs: 0, tint: 'day', wind: null, friends: [], courses: 0, scopeLines: 0, scope: null, raid: null, sinking: [] };
  const PAPER = 'rgba(240,234,214,0.92)';

  /** Квадраты ночного поиска, которые ещё нужны: цель жива и точного донесения нет. */
  function liveAreas(s) {
    const m = s.mission, out = [];
    if (!m || !m.night || !m.areas) return out;
    for (const a of m.areas) {
      const t = (s.targets || []).find((q) => q.id === a.targetId);
      if (!t || !t.alive || t.escaped) continue;
      if (t.reported && !t.reported.rough) continue;
      out.push(a);
    }
    return out;
  }
  /** Пометка фишки: 'rough' — по вспышке (±0.5 км), 'lost' — ночью цель вышла из света, 'fog' — туман (±0.1 км). */
  function markOf(s, t) {
    const m = s.mission, r = t.reported;
    if (!r || r.x == null || !t.alive || t.escaped) return null;
    if (r.rough) return 'rough';
    if (m.night && t.locate !== 'sound' && !t.lit) return 'lost';
    if (m.weather === 'fog') return 'fog';
    return null;
  }
  function dashedCircle(x, y, R, color, w) {
    ctx.save();
    ctx.strokeStyle = PAPER; ctx.lineWidth = w + 3 * Z; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash([Math.max(3, R * 0.32), Math.max(2, R * 0.22)]);
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function text(t, x, y, color, big = false, align = 'left') {
    ctx.font = font(big ? 40 : 34); ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineWidth = 6 * Z; ctx.strokeStyle = 'rgba(240,234,214,0.92)'; ctx.strokeText(t, x, y);
    ctx.fillStyle = color; ctx.fillText(t, x, y);
  }

  /** Луч от точки до края карты. */
  function ray(x, y, bearing) {
    const L = 30, b = bearing * RAD;
    return [cx(x), cy(y), cx(x + Math.sin(b) * L), cy(y + Math.cos(b) * L)];
  }

  function intersect(a, b) {
    const da = [Math.sin(a.bearing * RAD), Math.cos(a.bearing * RAD)], db = [Math.sin(b.bearing * RAD), Math.cos(b.bearing * RAD)];
    const den = da[0] * db[1] - da[1] * db[0];
    if (Math.abs(den) < 1e-6) return null;
    const k = ((b.x - a.x) * db[1] - (b.y - a.y) * db[0]) / den;
    return k > 0 ? { x: a.x + da[0] * k, y: a.y + da[1] * k } : null;
  }

  /** Состояние своего корабля для знака: 'sunk' | 'arrived' | 'hit' (вспышка 1.6 с после попадания) | 'ok'. */
  function friendState(s, f, fx) {
    if (!f.alive) return 'sunk';
    if (f.arrived) return 'arrived';
    const h = fx && fx.friendHit && fx.friendHit[f.id];
    return h != null && s.time - h >= 0 && s.time - h < 1.6 ? 'hit' : 'ok';
  }
  /** Тонущая (догорающая) цель: 0…1 — прогресс, иначе null. */
  const sinkOf = (s, t) => (!t.alive && !t.escaped && t.sinking && !t.sunk ? Math.min(1, Math.max(0, (s.time - t.sinking.since) / (t.sinking.dur || 18))) : null);
  /** Где рисовать самолёт: истинное место, а за рамкой карты — на её краю по пеленгу от батареи. */
  function planeSpot(bat, p) {
    const lim = toEdge(bat.x, bat.y, p.bearing, 0.35), r = Math.min(p.range, lim), b = p.bearing * RAD;
    return { x: bat.x + Math.sin(b) * r, y: bat.y + Math.cos(b) * r, off: p.range > lim + 1e-6 };
  }

  function drawFriends(s, fx) {
    const G = '24,110,58', DG = '#0f5a2c';
    info.friends = []; info.courses = 0;
    for (const f of s.friends || []) {
      const st = friendState(s, f, fx), x = cx(f.x), y = cy(f.y);
      // курс: пунктир от корабля по оставшимся точкам маршрута; у конвоя конец пути — «порт»
      if (f.path && f.path.length > 1 && f.alive && !f.arrived) {
        info.courses++;
        ctx.save();
        ctx.strokeStyle = `rgba(${G},${f.convoy ? 0.8 : 0.45})`; ctx.lineWidth = (f.convoy ? 3.5 : 2.5) * Z; ctx.setLineDash([14 * Z, 9 * Z]);
        ctx.beginPath();
        if (f.loop) { ctx.moveTo(cx(f.path[0].x), cy(f.path[0].y)); for (let i = 1; i < f.path.length; i++) ctx.lineTo(cx(f.path[i].x), cy(f.path[i].y)); }
        else { ctx.moveTo(x, y); for (let i = Math.max(0, f.leg | 0); i < f.path.length; i++) ctx.lineTo(cx(f.path[i].x), cy(f.path[i].y)); }
        ctx.stroke();
        ctx.restore();
      }
      if (f.convoy && f.path && f.path.length > 1 && !f.loop) {
        // точка прибытия: кружок с флажком
        const e = f.path[f.path.length - 1], ex = cx(e.x), ey = cy(e.y), r = 9 * Z;
        ctx.save();
        ctx.fillStyle = PAPER; ctx.strokeStyle = DG; ctx.lineWidth = 3 * Z;
        ctx.beginPath(); ctx.arc(ex, ey, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex, ey - 30 * Z); ctx.stroke();
        ctx.fillStyle = DG; ctx.beginPath(); ctx.moveTo(ex, ey - 30 * Z); ctx.lineTo(ex + 18 * Z, ey - 24 * Z); ctx.lineTo(ex, ey - 17 * Z); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      // под лупой — круг 0.25 км: снаряд, упавший внутри, попадёт по своему
      const ring = Z < 1 && f.alive;
      if (ring) {
        ctx.save();
        ctx.fillStyle = `rgba(${G},0.07)`; ctx.beginPath(); ctx.arc(x, y, 0.25 * S, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        dashedCircle(x, y, 0.25 * S, `rgba(${G},0.95)`, 3 * Z);
      }
      // попадание: красная расходящаяся вспышка
      if (st === 'hit') {
        const k = (s.time - fx.friendHit[f.id]) / 1.6;
        ctx.save();
        ctx.fillStyle = `rgba(214,40,20,${0.45 * (1 - k)})`; ctx.strokeStyle = `rgba(200,30,16,${1 - k})`; ctx.lineWidth = (7 * (1 - k) + 2) * Z;
        ctx.beginPath(); ctx.arc(x, y, (0.12 + 0.5 * k) * S * Math.max(Z, 0.6), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      // знак: зелёный корпус носом по курсу, в светлой обводке
      const L = (f.kind === 'transport' ? 26 : 20) * Z, W = (f.kind === 'transport' ? 10 : 7) * Z, dead = st === 'sunk';
      ctx.save();
      ctx.translate(x, y); ctx.rotate((f.heading || 0) * RAD);
      ctx.beginPath();
      ctx.moveTo(0, -L); ctx.lineTo(W, -L * 0.3); ctx.lineTo(W, L * 0.8); ctx.lineTo(-W, L * 0.8); ctx.lineTo(-W, -L * 0.3); ctx.closePath();
      ctx.lineJoin = 'round'; ctx.strokeStyle = PAPER; ctx.lineWidth = 7 * Z; ctx.stroke();
      ctx.fillStyle = dead ? 'rgba(120,130,124,0.9)' : st === 'hit' ? '#c8281a' : `rgb(${G})`; ctx.fill();
      ctx.strokeStyle = dead ? '#4c5650' : DG; ctx.lineWidth = 2.5 * Z; ctx.stroke();
      ctx.restore();
      if (dead) {
        const c = 22 * Z;
        ctx.save(); ctx.lineCap = 'round';
        for (const [col, w] of [[PAPER, 11], ['#b3261a', 6]]) {
          ctx.strokeStyle = col; ctx.lineWidth = w * Z;
          ctx.beginPath(); ctx.moveTo(x - c, y - c); ctx.lineTo(x + c, y + c); ctx.moveTo(x + c, y - c); ctx.lineTo(x - c, y + c); ctx.stroke();
        }
        ctx.restore();
      }
      const lx = x + 30 * Z, ly = y + 26 * Z;
      text(f.label || 'СВОИ', lx, ly, dead ? '#5a625c' : DG);
      if (st === 'arrived') {
        // галочка: дошёл
        const tx = lx + ctx.measureText(f.label || 'СВОИ').width + 12 * Z;
        ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (const [col, w] of [[PAPER, 11], [DG, 6]]) {
          ctx.strokeStyle = col; ctx.lineWidth = w * Z;
          ctx.beginPath(); ctx.moveTo(tx, ly); ctx.lineTo(tx + 9 * Z, ly + 10 * Z); ctx.lineTo(tx + 26 * Z, ly - 14 * Z); ctx.stroke();
        }
        ctx.restore();
      }
      info.friends.push({ id: f.id, x: f.x, y: f.y, state: st, ring, convoy: !!f.convoy });
    }
  }

  function drawRaid(s, fx, bat) {
    const raid = s.raid, warn = fx && fx.raidWarn && s.time < fx.raidWarn.until ? fx.raidWarn : null;
    info.raid = null;
    if (!raid && !warn) return;
    const RED = '#a51c12';
    const planes = raid ? raid.planes.filter((p) => p.alive) : [];
    info.raid = { stamp: true, phase: raid ? raid.phase : 'warning', planes: [] };
    for (const p of planes) {
      const q = planeSpot(bat, p), x = cx(q.x), y = cy(q.y), z = Math.max(Z, 0.55);
      const head = (p.attacked ? p.bearing : p.bearing + 180) * RAD;      // на подходе летит к батарее, после сброса — прочь
      ctx.save();
      ctx.translate(x, y); ctx.rotate(head);
      ctx.beginPath();                                                    // силуэт самолёта, нос вверх
      ctx.moveTo(0, -20 * z); ctx.lineTo(4 * z, -6 * z); ctx.lineTo(22 * z, 2 * z); ctx.lineTo(22 * z, 7 * z); ctx.lineTo(4 * z, 4 * z);
      ctx.lineTo(3 * z, 14 * z); ctx.lineTo(9 * z, 18 * z); ctx.lineTo(9 * z, 21 * z); ctx.lineTo(-9 * z, 21 * z); ctx.lineTo(-9 * z, 18 * z); ctx.lineTo(-3 * z, 14 * z);
      ctx.lineTo(-4 * z, 4 * z); ctx.lineTo(-22 * z, 7 * z); ctx.lineTo(-22 * z, 2 * z); ctx.lineTo(-4 * z, -6 * z); ctx.closePath();
      ctx.lineJoin = 'round'; ctx.strokeStyle = PAPER; ctx.lineWidth = 6 * z; ctx.stroke();
      ctx.fillStyle = p.attacked ? 'rgba(120,60,54,0.9)' : RED; ctx.fill();
      ctx.restore();
      if (q.off) {
        // самолёт ещё за рамкой карты: стрелка наружу по пеленгу
        const b = p.bearing * RAD, dx = Math.sin(b), dy = -Math.cos(b), a0 = 30 * z, a1 = 52 * z;
        ctx.save(); ctx.strokeStyle = ctx.fillStyle = RED; ctx.lineWidth = 4 * z;
        ctx.beginPath(); ctx.moveTo(x + dx * a0, y + dy * a0); ctx.lineTo(x + dx * a1, y + dy * a1); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + dx * (a1 + 12 * z), y + dy * (a1 + 12 * z));
        ctx.lineTo(x + dx * a1 - dy * 9 * z, y + dy * a1 + dx * 9 * z); ctx.lineTo(x + dx * a1 + dy * 9 * z, y + dy * a1 - dx * 9 * z); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      info.raid.planes.push({ id: p.id, x: q.x, y: q.y, off: q.off, attacked: !!p.attacked });
    }
    // подпись у ближайшего самолёта на подходе: сколько их и дальность
    const inbound = planes.filter((p) => !p.attacked).sort((a, b) => a.range - b.range);
    if (inbound.length) {
      const q = planeSpot(bat, inbound[0]), z0 = Z; Z = Math.max(Z, 0.55);
      const right = q.x < M - 4;
      text('САМОЛЁТЫ ' + inbound.length + ' · ' + inbound[0].range.toFixed(1) + ' КМ', cx(q.x) + (right ? 30 : -30) * Z, cy(q.y) - 30 * Z, RED, false, right ? 'left' : 'right');
      Z = z0;
    } else if (warn && !raid) {
      // налёта ещё нет: стрелка на краю карты — откуда ждать
      const k = toEdge(bat.x, bat.y, warn.from, 0.35), b = warn.from * RAD, x = cx(bat.x + Math.sin(b) * k), y = cy(bat.y + Math.cos(b) * k), z = Math.max(Z, 0.55);
      const dx = -Math.sin(b), dy = Math.cos(b);
      ctx.save(); ctx.strokeStyle = ctx.fillStyle = RED; ctx.lineWidth = 5 * z;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx * 34 * z, y + dy * 34 * z); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + dx * 50 * z, y + dy * 50 * z);
      ctx.lineTo(x + dx * 34 * z - dy * 11 * z, y + dy * 34 * z + dx * 11 * z); ctx.lineTo(x + dx * 34 * z + dy * 11 * z, y + dy * 34 * z - dx * 11 * z); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // штамп «ВОЗДУХ»: в углу листа, под лупой — в углу кадра
    const v = fx && fx.view, z = v ? 0.27 : 1;
    const sx = v ? cx(Math.min(M - 1.2, Math.max(1.2, v.x - 1.85))) : cx(3.3), sy = v ? cy(Math.min(M - 0.5, Math.max(0.6, v.y + 0.82))) : cy(18.95);
    const w = 300 * z, h = 84 * z;
    ctx.save();
    ctx.translate(sx, sy); ctx.rotate(-4 * RAD);
    ctx.fillStyle = 'rgba(240,234,214,0.8)'; ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = 'rgba(165,28,18,0.92)'; ctx.lineWidth = 7 * z; ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.lineWidth = 2.5 * z; ctx.strokeRect(-w / 2 + 9 * z, -h / 2 + 9 * z, w - 18 * z, h - 18 * z);
    ctx.font = `700 ${Math.round(54 * z)}px Oswald, "Arial Narrow", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(165,28,18,0.95)'; ctx.fillText('ВОЗДУХ', 0, 3 * z);
    ctx.restore();
  }

  function draw(s, game, fx) {
    ctx.clearRect(0, 0, PX, PX);
    const m = s.mission;
    info.friends = []; info.courses = 0; info.scopeLines = 0; info.scope = null; info.raid = null; info.sinking = [];
    if (!m) return;
    const bat = m.battery, posts = (m.map && m.map.posts) || [];
    const lights = s.lights || [], smokes = s.smokes || [];
    const left = (q) => Math.max(0, Math.ceil(q.until - s.time));

    // ---- тон карты: ночь — тёмный сине-серый, свет осветительных открывает обычные краски; туман — блёклая пелена
    info.tint = m.night ? 'night' : m.weather === 'fog' ? 'fog' : 'day';
    if (m.night) {
      ctx.fillStyle = 'rgba(14,24,44,0.64)'; ctx.fillRect(0, 0, PX, PX);
      ctx.save(); ctx.globalCompositeOperation = 'destination-out';
      for (const l of lights) {
        const x = cx(l.x), y = cy(l.y), R = 1.5 * S, g = ctx.createRadialGradient(x, y, R * 0.7, x, y, R * 1.06);
        g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R * 1.06, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    } else if (m.weather === 'fog') {
      ctx.fillStyle = 'rgba(234,236,234,0.42)'; ctx.fillRect(0, 0, PX, PX);
    }
    // ---- дымовые завесы: сектор прикрытия от батареи и серое облако
    info.smokes = smokes.length;
    for (const q of smokes) {
      const a0 = (q.bearing - 25 - 90) * RAD, a1 = (q.bearing + 25 - 90) * RAD, bx = cx(bat.x), by = cy(bat.y), R = 30 * S;
      ctx.save();
      ctx.fillStyle = m.night ? 'rgba(200,206,212,0.13)' : 'rgba(90,96,100,0.12)';
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.arc(bx, by, R, a0, a1); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = m.night ? 'rgba(215,220,226,0.75)' : 'rgba(70,76,80,0.7)'; ctx.lineWidth = 3 * Z; ctx.setLineDash([14 * Z, 10 * Z]);
      ctx.beginPath(); ctx.moveTo(bx + Math.cos(a0) * R, by + Math.sin(a0) * R); ctx.lineTo(bx, by); ctx.lineTo(bx + Math.cos(a1) * R, by + Math.sin(a1) * R); ctx.stroke();
      ctx.restore();
      const x = cx(q.x), y = cy(q.y);
      for (let k = -2; k <= 2; k++) {
        // облако вытянуто поперёк направления на противника
        const px = x + Math.cos(q.bearing * RAD) * k * 0.22 * S, py = y + Math.sin(q.bearing * RAD) * k * 0.22 * S, rr = (0.42 - Math.abs(k) * 0.06) * S;
        const g = ctx.createRadialGradient(px, py, 0, px, py, rr);
        g.addColorStop(0, 'rgba(150,154,156,0.78)'); g.addColorStop(1, 'rgba(150,154,156,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, rr, 0, Math.PI * 2); ctx.fill();
      }
      text('ДЫМ ' + left(q) + ' С', x, y + 0.62 * S, '#3c4246', false, 'center');
    }
    // ---- свет осветительных снарядов: мягкий диск 1.5 км и сколько ещё горит
    info.lights = lights.length;
    for (const l of lights) {
      const x = cx(l.x), y = cy(l.y), R = 1.5 * S;
      const g = ctx.createRadialGradient(x, y, 0, x, y, R);
      g.addColorStop(0, 'rgba(255,244,190,0.42)'); g.addColorStop(0.75, 'rgba(255,240,170,0.16)'); g.addColorStop(1, 'rgba(255,240,170,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.strokeStyle = 'rgba(214,150,16,0.85)'; ctx.lineWidth = 3 * Z; ctx.setLineDash([6 * Z, 10 * Z]);
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      text('ОСВ ' + left(l) + ' С', x, y - R - 20 * Z, '#8a5a06', false, 'center');
    }
    // ---- квадраты ночного поиска: штриховка и «ЦЕЛЬ n?»
    const areas = liveAreas(s);
    info.areas = areas.map((a) => a.targetId);
    for (const a of areas) {
      const x0 = cx(a.x0), y0 = cy(a.y1), w = (a.x1 - a.x0) * S, h = (a.y1 - a.y0) * S, active = a.targetId === s.activeTarget;
      ctx.save();
      ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
      ctx.fillStyle = active ? 'rgba(255,196,96,0.16)' : 'rgba(255,196,96,0.08)'; ctx.fillRect(x0, y0, w, h);
      ctx.strokeStyle = active ? 'rgba(255,190,90,0.8)' : 'rgba(255,190,90,0.45)'; ctx.lineWidth = 2.5 * Math.max(Z, 0.6);
      const step = 16 * Math.max(Z, 0.6);
      ctx.beginPath();
      for (let d = -h; d < w; d += step) { ctx.moveTo(x0 + d, y0 + h); ctx.lineTo(x0 + d + h, y0); }
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = active ? 'rgba(255,170,60,1)' : 'rgba(255,190,90,0.7)'; ctx.lineWidth = (active ? 5 : 3.5) * Z; ctx.setLineDash([16 * Z, 9 * Z]);
      ctx.strokeRect(x0, y0, w, h);
      ctx.restore();
      text('ЦЕЛЬ ' + a.targetId + '?', x0 + w / 2, y0 + h / 2, '#8f1d14', active, 'center');
    }

    // ---- труба наблюдательного поста: тонкий сектор поля зрения и риска на рамке карты
    if (s.scope && s.phase === 'playing') {
      const sb = s.scope.bearing, fov = game.scopeFov ? game.scopeFov() : (s.scope.zoom === 10 ? 6.4 : 16);
      info.scope = { bearing: sb, fov };
      const bx = cx(bat.x), by = cy(bat.y), col = m.night ? '150,190,235' : '26,79,156';
      ctx.save();
      ctx.beginPath(); ctx.rect(cx(0), cy(M), M * S, M * S); ctx.clip();
      ctx.fillStyle = `rgba(${col},0.05)`;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.arc(bx, by, 40 * S, (sb - fov / 2 - 90) * RAD, (sb + fov / 2 - 90) * RAD); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = `rgba(${col},0.3)`; ctx.lineWidth = 2 * Math.max(Z, 0.5);
      for (const d of [-fov / 2, fov / 2]) {
        const [x0, y0, x1, y1] = ray(bat.x, bat.y, sb + d);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
      ctx.restore();
      // риска с «глазом» трубы там, где ось трубы пересекает рамку
      const k = toEdge(bat.x, bat.y, sb), b = sb * RAD, ex = cx(bat.x + Math.sin(b) * k), ey = cy(bat.y + Math.cos(b) * k);
      const dx = -Math.sin(b), dy = Math.cos(b), z = Math.max(Z, 0.6);
      ctx.save();
      ctx.fillStyle = `rgba(${col},0.95)`; ctx.strokeStyle = PAPER; ctx.lineWidth = 3 * z; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(ex + dx * 30 * z, ey + dy * 30 * z);
      ctx.lineTo(ex - dy * 12 * z, ey + dx * 12 * z); ctx.lineTo(ex + dy * 12 * z, ey - dx * 12 * z); ctx.closePath(); ctx.stroke(); ctx.fill();
      ctx.restore();
    }

    // ---- пеленги звукометрии
    for (const t of s.targets) {
      const r = t.reported;
      if (!r || !r.sound || !t.alive || s.difficulty !== 0) continue;
      const active = t.id === s.activeTarget;
      ctx.save();
      ctx.strokeStyle = active ? 'rgba(170,24,14,0.95)' : 'rgba(170,24,14,0.45)';
      ctx.lineWidth = (active ? 5 : 3.5) * Z;
      ctx.setLineDash(t.moved ? [10 * Z, 10 * Z] : []);
      for (const q of r.sound) {
        const [x0, y0, x1, y1] = ray(q.x, q.y, q.bearing);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        // подпись пеленга в 2.5 км от поста
        const b = q.bearing * RAD, lx = cx(q.x + Math.sin(b) * 2.6), ly = cy(q.y + Math.cos(b) * 2.6);
        text(game.fmt.brg(q.bearing), lx + 8 * Z, ly, active ? '#8f1d14' : 'rgba(143,29,20,0.6)');
      }
      ctx.restore();
      // на «Курсанте» отмечаем пересечение
      if (s.difficulty === 0 && r.sound.length >= 2) {
        const p = intersect(r.sound[0], r.sound[1]);
        if (p) {
          ctx.strokeStyle = '#8f1d14'; ctx.lineWidth = 4 * Z;
          ctx.beginPath(); ctx.arc(cx(p.x), cy(p.y), 18 * Z, 0, Math.PI * 2); ctx.stroke();
          text('Ц' + t.id, cx(p.x) + 24 * Z, cy(p.y) - 24 * Z, '#8f1d14');
        }
      }
    }
    // ---- линии, проложенные карандашом вдоль алидады
    const lines = (s.plot && s.plot.lines) || [];
    ctx.save();
    ctx.strokeStyle = 'rgba(40,36,30,0.85)'; ctx.lineWidth = 3.5 * Z;
    for (const ln of lines) {
      const [x0, y0, x1, y1] = ray(ln.x, ln.y, ln.bearing);
      const b = ln.bearing * RAD;
      if (ln.from === 'scope') {
        // пеленг трубы наблюдательного поста: синий штрихпунктир с пометкой «НП»
        info.scopeLines++;
        ctx.save();
        ctx.strokeStyle = PAPER; ctx.lineWidth = 7 * Z; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.strokeStyle = 'rgba(22,70,150,0.95)'; ctx.lineWidth = 4 * Z; ctx.setLineDash([26 * Z, 8 * Z, 5 * Z, 8 * Z]);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.restore();
        text('НП ' + game.fmt.brg(ln.bearing), cx(ln.x + Math.sin(b) * 5.2) + 8 * Z, cy(ln.y + Math.cos(b) * 5.2), '#123a73');
        continue;
      }
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      text(game.fmt.brg(ln.bearing), cx(ln.x + Math.sin(b) * 3.4) + 8 * Z, cy(ln.y + Math.cos(b) * 3.4), 'rgba(40,36,30,0.95)');
    }
    ctx.restore();
    // ось алидады: подсветить, где она стоит (если не на батарее)
    const pv = (s.plot && s.plot.pivot) || 0;
    if (posts.length) {
      const P = [{ x: bat.x, y: bat.y }].concat(posts);
      P.forEach((q, i) => {
        ctx.strokeStyle = i === pv ? 'rgba(214,100,16,0.95)' : 'rgba(26,79,156,0.5)';
        ctx.lineWidth = (i === pv ? 5 : 3) * Z; ctx.setLineDash(i === pv ? [] : [8 * Z, 6 * Z]);
        ctx.beginPath(); ctx.arc(cx(q.x), cy(q.y), 34 * Z, 0, Math.PI * 2); ctx.stroke();
      });
      ctx.setLineDash([]);
    }
    // ---- посты звукометрии
    for (const q of posts) {
      const x = cx(q.x), y = cy(q.y);
      ctx.fillStyle = '#1a4f9c'; ctx.strokeStyle = '#f0ead6'; ctx.lineWidth = 3 * Z;
      ctx.beginPath(); ctx.moveTo(x, y - 20 * Z); ctx.lineTo(x + 18 * Z, y + 12 * Z); ctx.lineTo(x - 18 * Z, y + 12 * Z); ctx.closePath(); ctx.fill(); ctx.stroke();
      text(q.name, x, y + 38 * Z, '#123a73', false, 'center');
    }

    // ---- свои корабли
    drawFriends(s, fx);

    // ---- поражённая цель уходит под воду (постройка — догорает): дуга оставшегося времени у фишки
    {
      const pp = (s.plot && s.plot.pins) || {};
      for (const t of s.targets) {
        const k = sinkOf(s, t), p = pp[t.id];
        if (k == null) continue;
        info.sinking.push(t.id);
        if (!p) continue;
        const x = cx(p.x), y = cy(p.y), R = 30 * Z;
        ctx.save();
        ctx.strokeStyle = PAPER; ctx.lineWidth = 9 * Z; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(70,84,96,0.35)'; ctx.lineWidth = 5 * Z; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(52,66,80,0.95)';
        ctx.beginPath(); ctx.arc(x, y, R, -Math.PI / 2 + k * Math.PI * 2, Math.PI * 1.5); ctx.stroke();
        ctx.restore();
        text(LAND_KINDS[t.kind] ? 'ГОРИТ' : 'ТОНЕТ', x + R + 10 * Z, y + R * 0.6, '#34424f');
      }
    }

    // ---- пометки у фишек: по вспышке (±0.5 км), в тумане (±0.1 км), цель потеряна из света («?»)
    info.marks = {};
    const pins = (s.plot && s.plot.pins) || {};
    for (const t of s.targets) {
      const p = pins[t.id], mk = p ? markOf(s, t) : null;
      if (!mk) continue;
      info.marks[t.id] = mk;
      const x = cx(p.x), y = cy(p.y);
      if (mk === 'rough') dashedCircle(x, y, 0.5 * S, 'rgba(170,24,14,0.95)', 4 * Z);
      else if (mk === 'fog') dashedCircle(x, y, 0.1 * S, 'rgba(60,70,80,0.9)', 3 * Z);
      else dashedCircle(x, y, 0.22 * S, 'rgba(170,24,14,0.7)', 3 * Z);
      if (mk !== 'fog') text(mk === 'rough' ? 'ВСПЫШКА ?' : '?', x - (mk === 'rough' ? 0.5 : 0.22) * S - 8 * Z, y + 4 * Z, '#8f1d14', mk === 'lost', 'right');
    }

    // ---- разрывы (последние 10)
    const imps = s.impacts || [];
    const from = Math.max(0, imps.length - 10);
    // пары «вилки»: тонкая линия между разрывами
    info.pairs = 0;
    for (let i = from; i < imps.length; i++) {
      const im = imps[i];
      if (im.pair == null || im.pair < im.n) continue;
      const mate = imps.find((q) => q.n === im.pair);
      if (!mate) continue;
      info.pairs++;
      ctx.save();
      ctx.strokeStyle = PAPER; ctx.lineWidth = 6 * Z; ctx.beginPath(); ctx.moveTo(cx(im.x), cy(im.y)); ctx.lineTo(cx(mate.x), cy(mate.y)); ctx.stroke();
      ctx.strokeStyle = 'rgba(28,26,21,0.9)'; ctx.lineWidth = 2.5 * Z; ctx.beginPath(); ctx.moveTo(cx(im.x), cy(im.y)); ctx.lineTo(cx(mate.x), cy(mate.y)); ctx.stroke();
      ctx.restore();
    }
    for (let i = from; i < imps.length; i++) {
      const im = imps[i], x = cx(im.x), y = cy(im.y), last = i === imps.length - 1;
      const age = s.time - im.time;
      // под лупой круг ≈ зона поражения, на обзоре — крупнее, чтобы было видно
      const R = (Z < 1 ? 0.1 : last ? 0.42 : 0.3) * S;
      const col = im.hit ? '200,40,20' : '40,36,30';
      const alpha = last ? 1 : 0.35 + 0.5 * (i - from) / Math.max(1, imps.length - from);
      // круг зоны поражения
      ctx.fillStyle = `rgba(${col},${0.16 * alpha})`; ctx.strokeStyle = `rgba(${col},${alpha})`; ctx.lineWidth = (last ? 6 : 4) * Z;
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // точная точка разрыва
      const c = 10 * Z; ctx.lineWidth = 4 * Z; ctx.beginPath();
      ctx.moveTo(x - c, y - c); ctx.lineTo(x + c, y + c); ctx.moveTo(x + c, y - c); ctx.lineTo(x - c, y + c); ctx.stroke();
      const tag = im.pair == null ? '№' + im.n : '№' + Math.min(im.n, im.pair) + (im.n < im.pair ? 'а' : 'б');
      const tagCol = `rgba(${im.hit ? '160,24,10' : '28,26,21'},${Math.min(1, alpha + 0.2)})`;
      if (im.pair != null && im.n < im.pair) text(tag, x - R - 6 * Z, y + R * 0.7 + 6 * Z, tagCol, false, 'right');   // «а» — слева снизу, «б» — справа сверху
      else text(tag, x + R + 6 * Z, y - R * 0.7 - 6 * Z, tagCol);
      // расходящаяся волна сразу после разрыва
      if (age >= 0 && age < 1.6) {
        const k = age / 1.6;
        ctx.strokeStyle = `rgba(230,110,20,${1 - k})`; ctx.lineWidth = (5 * (1 - k) + 1) * Z;
        ctx.beginPath(); ctx.arc(x, y, (0.15 + 1.1 * k) * S, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // ---- снаряды в полёте: трасса от батареи и «голова»
    for (const sh of s.flight || []) {
      const p = game.shellPosition(sh);
      ctx.save();
      ctx.strokeStyle = 'rgba(214,100,16,0.95)'; ctx.lineWidth = 6 * Z; ctx.setLineDash([18 * Z, 10 * Z]);
      ctx.beginPath(); ctx.moveTo(cx(bat.x), cy(bat.y)); ctx.lineTo(cx(p.x), cy(p.y)); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#d66410'; ctx.strokeStyle = '#f0ead6'; ctx.lineWidth = 3 * Z;
      ctx.beginPath(); ctx.arc(cx(p.x), cy(p.y), 13 * Z, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      text('№' + sh.n + ' · ' + Math.max(0, sh.tof - sh.t).toFixed(0) + ' С', cx(p.x) + 18 * Z, cy(p.y) - 22 * Z, '#8a3b06');
    }

    // ---- воздушный налёт
    drawRaid(s, fx, bat);

    // ---- ветер: стрелка «куда дует» и скорость в северо-восточном углу
    const w = m.wind;
    info.wind = w && w.speed > 0 ? { from: w.from, speed: w.speed } : null;
    if (info.wind) {
      const x = cx(19.05), y = cy(19.05), R = 30, b = (w.from + 180) * RAD, dx = Math.sin(b), dy = -Math.cos(b);
      ctx.save();
      ctx.fillStyle = 'rgba(240,234,214,0.9)'; ctx.strokeStyle = 'rgba(26,79,156,0.9)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = ctx.fillStyle = '#1a4f9c'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x - dx * R * 0.72, y - dy * R * 0.72); ctx.lineTo(x + dx * R * 0.4, y + dy * R * 0.4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + dx * R * 0.84, y + dy * R * 0.84);
      ctx.lineTo(x + dx * R * 0.2 - dy * R * 0.34, y + dy * R * 0.2 + dx * R * 0.34); ctx.lineTo(x + dx * R * 0.2 + dy * R * 0.34, y + dy * R * 0.2 - dx * R * 0.34); ctx.closePath(); ctx.fill();
      ctx.restore();
      const z0 = Z; Z = Math.max(Z, 0.62);
      text('ВЕТЕР ' + w.speed + ' М/С', x + R, y + R + 22, '#123a73', false, 'right');
      Z = z0;
    }
  }

  return {
    mesh,
    info,
    /** Перерисовать при изменениях; во время полёта и анимации разрыва — ~12 раз в секунду. */
    update(s, game, now, zoom = 0, fx = null) {
      const z = zoom > 0.5 ? 0.38 : 1;
      const m = s.mission;
      const imps = s.impacts || [];
      const lastImp = imps.length ? imps[imps.length - 1] : null;
      let animating = (s.flight && s.flight.length) || (lastImp && s.time - lastImp.time < 1.7);
      const pl = s.plot || {};
      let k = (m ? m.id + m.mapSeed : '') + '|' + imps.length + '|' + s.activeTarget + '|' + s.difficulty + '|' + (pl.pivot || 0) + '|' + JSON.stringify(pl.lines || []);
      for (const t of s.targets || []) if (t.reported && t.reported.sound) k += '|' + t.id + ':' + t.reported.time + (t.alive ? '' : 'x') + (t.moved ? 'm' : '');
      if (m) {
        k += '|' + (m.night ? 'n' : '') + (m.weather || '') + '|w' + (m.wind ? m.wind.from + '/' + m.wind.speed : '');
        for (const l of s.lights || []) k += '|L' + l.n + ':' + Math.ceil(l.until - s.time);
        for (const q of s.smokes || []) k += '|S' + q.n + ':' + Math.ceil(q.until - s.time);
        for (const a of liveAreas(s)) k += '|A' + a.targetId + ':' + a.x0 + ',' + a.y0;
        for (const t of s.targets || []) {
          const p = pl.pins && pl.pins[t.id], mk = p ? markOf(s, t) : null;
          if (mk) k += '|M' + t.id + mk + p.x + ',' + p.y;
        }
      }
      // свои корабли, труба, налёт, тонущие цели — с огрублением, чтобы холст не перерисовывался каждый кадр
      for (const f of s.friends || []) {
        const st = friendState(s, f, fx);
        if (st === 'hit') animating = true;
        k += '|F' + f.id + st + q05(f.x) + ',' + q05(f.y) + ',' + Math.round((f.heading || 0) / 5) + ',' + (f.leg | 0);
      }
      if (m && s.scope && s.phase === 'playing') k += '|sc' + Math.round(s.scope.bearing * 2) + '/' + s.scope.zoom;
      const warn = fx && fx.raidWarn && s.time < fx.raidWarn.until;
      if (s.raid || warn) {
        k += '|R' + (s.raid ? s.raid.phase : 'w') + (fx && fx.view ? q05(fx.view.x) + ',' + q05(fx.view.y) : '');
        if (s.raid) for (const p of s.raid.planes) k += '|' + p.id + (p.alive ? (p.attacked ? 'a' : 'i') + Math.round(p.range * 5) + ',' + Math.round(p.bearing) : 'x');
      }
      for (const t of s.targets || []) {
        const sk = sinkOf(s, t);
        if (sk != null) k += '|K' + t.id + ':' + Math.floor(sk * 12);
      }
      k += '|' + z;
      if (k === key && !animating) return;
      if (k === key && now - lastDraw < 0.08) return;
      key = k; lastDraw = now;
      Z = z;
      draw(s, game, fx);
      tex.needsUpdate = true;
    },
    dispose() { tex.dispose(); mat.dispose(); mesh.geometry.dispose(); },
  };
}
