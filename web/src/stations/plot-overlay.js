// Прозрачный слой поверх карты планшета: полёт снаряда, круги разрывов, посты и пеленги звукометрии.
// Рисуется на отдельном холсте и перерисовывается только когда что-то изменилось.
import { CHART } from './plot-chart.js';

const PX = 1024;                       // разрешение слоя (вся карта)
const S = PX / CHART.SPAN;             // пикселей холста на километр
let Z = 1;                             // масштаб знаков: 1 — обзор карты, меньше — под лупой
const font = (px) => `600 ${Math.round(px * Z)}px Oswald, "Arial Narrow", sans-serif`;

const cx = (x) => (x - CHART.X0) * S;
const cy = (y) => PX - (y - CHART.Y0) * S;
const RAD = Math.PI / 180;

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
  const info = { areas: [], lights: 0, smokes: 0, marks: {}, pairs: 0, tint: 'day', wind: null };
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

  function draw(s, game) {
    ctx.clearRect(0, 0, PX, PX);
    const m = s.mission;
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
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      const b = ln.bearing * RAD;
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
    update(s, game, now, zoom = 0) {
      const z = zoom > 0.5 ? 0.38 : 1;
      const m = s.mission;
      const imps = s.impacts || [];
      const lastImp = imps.length ? imps[imps.length - 1] : null;
      const animating = (s.flight && s.flight.length) || (lastImp && s.time - lastImp.time < 1.7);
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
      k += '|' + z;
      if (k === key && !animating) return;
      if (k === key && now - lastDraw < 0.08) return;
      key = k; lastDraw = now;
      Z = z;
      draw(s, game);
      tex.needsUpdate = true;
    },
    dispose() { tex.dispose(); mat.dispose(); mesh.geometry.dispose(); },
  };
}
