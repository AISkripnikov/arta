// panel — корпус пульта; plate — шильдик.
import * as THREE from 'three';
import { slab, merge, xf, rivetGeometry, boxUV, roundedRectShape } from '../geom.js';
import { makeCanvas, canvasTexture, drawLabel, measureLabel, roundRectPath, upper } from '../textures.js';
import { PALETTE, toColor } from '../materials.js';
import { finish } from './base.js';

/**
 * Корпус пульта: плита/коробка со скруглённой фаской и заклёпками по периметру лицевой грани.
 * Тыл на z=0, лицевая грань на z=d, центр грани — в (0,0,d).
 * opts: { w=1, h=0.6, d=0.05, color='#3d4a57', rivets=true|false|шаг(м), bevel=0.012, radius=0.02, wear=0.5, material }
 * → { object3D, w, h, d, add(child, x=0, y=0, rotZ=0) } — add ставит орган на лицевую грань.
 */
export function panel(c, opts = {}) {
  const { w = 1, h = 0.6, d = 0.05, color = PALETTE.panel, rivets = true, wear = 0.5 } = opts;
  const bevel = Math.min(opts.bevel == null ? 0.012 : opts.bevel, d * 0.45, w * 0.2, h * 0.2);
  const radius = opts.radius == null ? Math.max(0.02, bevel * 1.5) : opts.radius;
  const parts = [slab(w, h, d, { r: radius, bevel, segs: 3, curve: 5 })];
  if (rivets) {
    const step = typeof rivets === 'number' ? rivets : 0.09;
    const inset = bevel + Math.min(0.022, Math.min(w, h) * 0.12);
    const rr = Math.max(0.0045, Math.min(0.0075, Math.min(w, h) * 0.035));
    const x0 = -w / 2 + inset, x1 = w / 2 - inset, y0 = -h / 2 + inset, y1 = h / 2 - inset;
    const nx = Math.max(1, Math.round((x1 - x0) / step)), ny = Math.max(1, Math.round((y1 - y0) / step));
    const pts = [];
    for (let i = 0; i <= nx; i++) { const x = x0 + (x1 - x0) * i / nx; pts.push([x, y0], [x, y1]); }
    for (let j = 1; j < ny; j++) { const y = y0 + (y1 - y0) * j / ny; pts.push([x0, y], [x1, y]); }
    for (const [x, y] of pts) parts.push(xf(rivetGeometry(rr, 6), { p: [x, y, d] }));
  }
  const g = boxUV(merge(parts), c.mat.WEAR_REPEAT);
  // сдвиг UV, чтобы одинаковые панели не выглядели штампованными
  const uv = g.attributes.uv, ou = Math.random(), ov = Math.random();
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + ou, uv.getY(i) + ov);
  const mesh = new THREE.Mesh(g, opts.material || c.mat.paint(color, { wear }));
  mesh.name = 'panel';
  const group = new THREE.Group();
  group.add(mesh);
  const api = {
    w, h, d,
    /** Поставить орган управления (или Object3D) на лицевую грань в точке (x, y) от её центра. */
    add(child, x = 0, y = 0, rotZ = 0) {
      const o = child && child.object3D ? child.object3D : child;
      o.position.set(x, y, d);
      if (rotZ) o.rotation.z = rotZ;
      group.add(o);
      return child;
    },
  };
  return finish(api, group);
}

const PLATE_STYLES = {
  black: { bg: PALETTE.plateBlack, fg: PALETTE.ivory, edge: 'rgba(232,224,200,0.55)' },
  ivory: { bg: PALETTE.ivory, fg: PALETTE.ink, edge: 'rgba(26,26,26,0.6)' },
  red: { bg: PALETTE.plateRed, fg: PALETTE.ivory, edge: 'rgba(232,224,200,0.6)' },
  ochre: { bg: PALETTE.ochre, fg: PALETTE.ink, edge: 'rgba(26,26,26,0.6)' },
};

/**
 * Шильдик. text — строка (переводы строк через \n), рисуется ПРОПИСНЫМИ.
 * opts: { w, h (м; по умолчанию — по тексту), style='black'|'ivory'|'red'|'ochre', size=0.026 (высота прописной буквы, м),
 *         screws=true (винты по краям, если хватает места), weight=600 }
 * → { object3D, setText(t), text, w, h }
 */
export function plate(c, text = '', opts = {}) {
  const style = PLATE_STYLES[opts.style] || PLATE_STYLES.black;
  const size = opts.size || 0.026;
  const weight = opts.weight || 600;
  const m0 = measureLabel(text, 100, { weight });
  const padX = size * 0.75, padY = size * 0.55;
  const wantScrews = opts.screws !== false && (opts.w ? opts.w : m0.width / 100 * size + padX * 2) >= size * 4.5;
  const screwPad = wantScrews ? size * 0.75 : 0;
  const w = opts.w || (m0.width / 100 * size + padX * 2 + screwPad * 2);
  const h = opts.h || (m0.height / 100 * size + padY * 2);
  const ppm = Math.min(1500, 512 / w, 512 / h);                     // пикселей на метр (текстура ≤ 512)
  const cw = Math.max(8, Math.round(w * ppm)), ch = Math.max(8, Math.round(h * ppm));
  const canvas = makeCanvas(cw, ch), ctx = canvas.getContext('2d');
  const tex = canvasTexture(canvas, { aniso: 8 });
  let current = null;

  function draw(t) {
    current = String(t == null ? '' : t);
    const r = Math.min(cw, ch) * 0.1;
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = style.bg; ctx.fillRect(0, 0, cw, ch);
    // лёгкий блик эмали сверху и затемнение снизу
    const grad = ctx.createLinearGradient(0, 0, 0, ch);
    grad.addColorStop(0, 'rgba(255,255,255,0.10)'); grad.addColorStop(0.5, 'rgba(255,255,255,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, cw, ch);
    // гравированная рамка
    const lw = Math.max(1, size * ppm * 0.07), ins = Math.max(2, size * ppm * 0.16);
    ctx.strokeStyle = style.edge; ctx.lineWidth = lw;
    roundRectPath(ctx, ins, ins, cw - ins * 2, ch - ins * 2, r); ctx.stroke();
    const cap = size * ppm;
    let avail = cw - (padX * 0.9 + screwPad) * 2 * ppm;
    if (wantScrews) {
      const sr = Math.min(size * 0.2 * ppm, ch * 0.16), sx = (ins + size * 0.52 * ppm);
      for (const x of [sx, cw - sx]) {
        ctx.fillStyle = '#8f979c'; ctx.beginPath(); ctx.arc(x, ch / 2, sr, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = Math.max(1, sr * 0.3);
        ctx.beginPath(); ctx.moveTo(x - sr * 0.7, ch / 2 - sr * 0.45); ctx.lineTo(x + sr * 0.7, ch / 2 + sr * 0.45); ctx.stroke();
      }
    }
    // высоту текста при необходимости уменьшаем, чтобы блок поместился по вертикали
    const lines = upper(current).split('\n').length;
    const maxCap = (ch - ins * 2 - lw * 2) / (lines + (lines - 1) * 0.6 + 0.5);
    drawLabel(ctx, current, cw / 2, ch / 2 + cap * 0.02, Math.min(cap, maxCap), { color: style.fg, weight, maxWidth: Math.max(4, avail) });
    tex.needsUpdate = true;
  }
  draw(text);

  const r = Math.min(w, h) * 0.1;
  const g = new THREE.ShapeGeometry(roundedRectShape(w, h, r), 4);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
  const isLight = opts.style === 'ivory' || opts.style === 'ochre';
  const material = new THREE.MeshStandardMaterial({
    map: tex, roughness: isLight ? 0.6 : 0.42, metalness: isLight ? 0.0 : 0.35,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(g, material);
  mesh.position.z = 0.0015;
  mesh.name = 'plate';
  const group = new THREE.Group();
  group.add(mesh);
  const api = {
    w, h,
    get text() { return current; },
    setText(t) { if (String(t) !== current) draw(t); },
  };
  const out = finish(api, group);
  const baseDispose = out.dispose;
  out.dispose = () => { baseDispose(); tex.dispose(); material.dispose(); g.dispose(); };
  return out;
}
