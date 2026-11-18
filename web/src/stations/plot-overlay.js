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

    // ---- пеленги звукометрии
    for (const t of s.targets) {
      const r = t.reported;
      if (!r || !r.sound || !t.alive) continue;
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
    // ---- посты звукометрии
    for (const q of posts) {
      const x = cx(q.x), y = cy(q.y);
      ctx.fillStyle = '#1a4f9c'; ctx.strokeStyle = '#f0ead6'; ctx.lineWidth = 3 * Z;
      ctx.beginPath(); ctx.moveTo(x, y - 20 * Z); ctx.lineTo(x + 18 * Z, y + 12 * Z); ctx.lineTo(x - 18 * Z, y + 12 * Z); ctx.closePath(); ctx.fill(); ctx.stroke();
      text(q.name, x, y + 38 * Z, '#123a73', false, 'center');
    }

    // ---- разрывы (последние 10)
    const imps = s.impacts || [];
    const from = Math.max(0, imps.length - 10);
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
      text('№' + im.n, x + R + 6 * Z, y - R * 0.7 - 6 * Z, `rgba(${im.hit ? '160,24,10' : '28,26,21'},${Math.min(1, alpha + 0.2)})`);
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
  }

  return {
    mesh,
    /** Перерисовать при изменениях; во время полёта и анимации разрыва — ~12 раз в секунду. */
    update(s, game, now, zoom = 0) {
      const z = zoom > 0.5 ? 0.38 : 1;
      const m = s.mission;
      const imps = s.impacts || [];
      const lastImp = imps.length ? imps[imps.length - 1] : null;
      const animating = (s.flight && s.flight.length) || (lastImp && s.time - lastImp.time < 1.7);
      let k = (m ? m.id + m.mapSeed : '') + '|' + imps.length + '|' + s.activeTarget + '|' + s.difficulty;
      for (const t of s.targets || []) if (t.reported && t.reported.sound) k += '|' + t.id + ':' + t.reported.time + (t.alive ? '' : 'x') + (t.moved ? 'm' : '');
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
