// drumCounter — барабанный счётчик (одометр): цифры прокручиваются плавно, с переносом разрядов.
import * as THREE from 'three';
import { slab, roundedRectShape } from '../geom.js';
import { makeCanvas, canvasTexture, drawLabel, measureLabel } from '../textures.js';
import { PALETTE } from '../materials.js';
import { finish, clamp, snd } from './base.js';

// Атлас цифр: три колонки по 6 ячеек: «0…5», «5…9,0», «+ − пусто».
const ATLAS_W = 256, ATLAS_H = 512, COL_W = 84, CELL_H = ATLAS_H / 6;

function digitAtlas(c) {
  return c.mat.memo('drumDigitsTex', () => {
    const cv = makeCanvas(ATLAS_W, ATLAS_H), ctx = cv.getContext('2d');
    ctx.fillStyle = PALETTE.drum; ctx.fillRect(0, 0, ATLAS_W, ATLAS_H);
    const cols = [['0', '1', '2', '3', '4', '5'], ['5', '6', '7', '8', '9', '0'], ['+', '−', '', '', '', '']];
    for (let ci = 0; ci < 3; ci++) for (let r = 0; r < 6; r++) {
      const cx = ci * COL_W + COL_W / 2, cy = r * CELL_H + CELL_H / 2;
      // лёгкая цилиндрическая подсветка каждой ячейки
      const g = ctx.createLinearGradient(0, r * CELL_H, 0, (r + 1) * CELL_H);
      g.addColorStop(0, 'rgba(255,255,255,0.0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.07)'); g.addColorStop(1, 'rgba(255,255,255,0.0)');
      ctx.fillStyle = g; ctx.fillRect(ci * COL_W, r * CELL_H, COL_W, CELL_H);
      if (cols[ci][r]) drawLabel(ctx, cols[ci][r], cx, cy, CELL_H * 0.62, { color: PALETTE.drumDigit, weight: 500, spacing: 0, upper: false });
    }
    const t = canvasTexture(cv, { aniso: 4 });
    // материал-заглушка, чтобы текстура жила в общем кэше
    const m = new THREE.MeshBasicMaterial({ map: t });
    return m;
  });
}

/**
 * opts: { digits=4 (всего разрядов, включая дробные), decimals=0, unit='' (подпись справа), digitH=0.05 (высота окна, м),
 *         signed=false (разряд знака), wrap=0 (напр. 360 — значение циклическое, крутится по кратчайшему пути),
 *         value=0, label (шильдик над счётчиком), sound=false (щелчки при прокрутке) }
 * → { object3D, setValue(v, {instant}), value, w, h }
 */
export function drumCounter(c, opts = {}) {
  const { digits = 4, decimals = 0, unit = '', digitH = 0.05, signed = false, wrap = 0 } = opts;
  const cellW = digitH * 0.62, gap = digitH * 0.05;
  const nCells = digits + (signed ? 1 : 0);
  const unitText = unit ? String(unit) : '';
  const unitCap = digitH * 0.42;
  const unitW = unitText ? Math.max(digitH * 0.55, measureLabel(unitText, 100).width / 100 * unitCap + digitH * 0.3) : 0;
  const winW = nCells * cellW + (nCells - 1) * gap + (decimals > 0 ? gap * 2 : 0);
  const innerW = winW + unitW, innerH = digitH;
  const border = Math.max(0.008, digitH * 0.2), depth = Math.max(0.012, digitH * 0.3);
  const W = innerW + border * 2, Hh = innerH + border * 2;
  const group = new THREE.Group();
  group.name = 'drumCounter';

  // оправа (никель) с окном
  const hole = new THREE.Path();
  {
    const s = roundedRectShape(innerW, innerH, digitH * 0.08);
    hole.setFromPoints(s.getPoints(4).reverse());
  }
  const bezel = new THREE.Mesh(slab(W, Hh, depth, { r: digitH * 0.2, bevel: Math.min(0.004, depth * 0.3), segs: 2, hole }), c.mat.nickel);
  group.add(bezel);

  // цифры: один меш, UV каждой ячейки сдвигается при прокрутке
  const pos = new Float32Array(nCells * 12), uvs = new Float32Array(nCells * 8), idx = [];
  const x0 = -innerW / 2;
  const cellX = [];
  for (let i = 0; i < nCells; i++) {
    // i = 0 — самый левый; дробные разряды отделены увеличенным зазором
    const di = i - (signed ? 1 : 0);                      // индекс разряда слева (−1 для знака)
    const isFrac = decimals > 0 && di >= digits - decimals;
    const x = x0 + i * (cellW + gap) + (isFrac ? gap * 2 : 0);
    cellX.push(x);
    const z = depth * 0.3;
    pos.set([x, -innerH / 2, z, x + cellW, -innerH / 2, z, x + cellW, innerH / 2, z, x, innerH / 2, z], i * 12);
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const uvAttr = new THREE.BufferAttribute(uvs, 2); uvAttr.setUsage(THREE.DynamicDrawUsage);
  dg.setAttribute('uv', uvAttr);
  dg.setIndex(idx);
  const digitsMesh = new THREE.Mesh(dg, digitAtlas(c));
  group.add(digitsMesh);
  // тёмная подложка окна (видна в зазорах)
  const back = new THREE.Mesh(new THREE.PlaneGeometry(innerW + border * 0.5, innerH + border * 0.5), c.mat.memo('drumBack', () => new THREE.MeshBasicMaterial({ color: 0x050505 })));
  back.position.z = depth * 0.2;
  group.add(back);

  // накладка: затенение «цилиндра», запятая, единица измерения
  {
    const key = ['drumOverlay', digits, decimals, unitText, digitH.toFixed(4), signed ? 1 : 0].join(':');
    const material = c.mat.memo(key, () => {
      const ppm = Math.min(1600, 512 / innerW, 128 / innerH);
      const cw = Math.max(8, Math.round(innerW * ppm)), ch = Math.max(8, Math.round(innerH * ppm));
      const cv = makeCanvas(cw, ch), ctx = cv.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, 0, ch);
      g.addColorStop(0, 'rgba(0,0,0,0.85)'); g.addColorStop(0.2, 'rgba(0,0,0,0.25)'); g.addColorStop(0.42, 'rgba(0,0,0,0)');
      g.addColorStop(0.6, 'rgba(0,0,0,0)'); g.addColorStop(0.82, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0.88)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, winW * ppm, ch);
      // блик стекла
      const hl = ctx.createLinearGradient(0, 0, 0, ch * 0.5);
      hl.addColorStop(0, 'rgba(255,255,255,0.0)'); hl.addColorStop(0.55, 'rgba(255,255,255,0.10)'); hl.addColorStop(1, 'rgba(255,255,255,0.0)');
      ctx.fillStyle = hl; ctx.fillRect(0, ch * 0.12, winW * ppm, ch * 0.3);
      if (decimals > 0) {                                   // запятая между целой и дробной частью
        const i = nCells - decimals;
        const x = (cellX[i] - x0 - gap * 1.5) * ppm;
        ctx.fillStyle = PALETTE.ochre;
        ctx.beginPath(); ctx.arc(x, ch * 0.84, Math.max(1.5, digitH * 0.055 * ppm), 0, Math.PI * 2); ctx.fill();
      }
      if (unitText) {
        ctx.fillStyle = PALETTE.plateBlack; ctx.fillRect(winW * ppm, 0, cw - winW * ppm, ch);
        ctx.fillStyle = 'rgba(232,224,200,0.25)'; ctx.fillRect(winW * ppm, 0, Math.max(1, ppm * 0.0015), ch);
        drawLabel(ctx, unitText, (winW + unitW / 2) * ppm, ch / 2, unitCap * ppm, { color: PALETTE.ivory, weight: 600, maxWidth: (unitW - digitH * 0.12) * ppm });
      }
      const t = canvasTexture(cv, { aniso: 4 });
      return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
    });
    const ov = new THREE.Mesh(new THREE.PlaneGeometry(innerW, innerH), material);
    ov.position.z = depth * 0.45;
    ov.renderOrder = 1;
    group.add(ov);
  }

  if (opts.label) {
    const p = c.ui.plate(opts.label, { size: opts.labelSize || 0.024 });
    p.object3D.position.set(0, Hh / 2 + p.h / 2 + 0.008, 0);
    group.add(p.object3D);
  }

  // ---- значение ----
  const scale = Math.pow(10, decimals);
  const maxS = Math.pow(10, digits) - 1;
  const wrapS = wrap > 0 ? Math.round(wrap * scale) : 0;
  let target = 0;            // целевое значение (в единицах младшего разряда, со знаком)
  let shown = 0;             // отображаемое (плавное)
  let lastTickInt = 0;

  function norm(v) {
    let s = Math.round((+v || 0) * scale);
    if (wrapS) { s %= wrapS; if (s < 0) s += wrapS; return s; }
    return clamp(s, signed ? -maxS : 0, maxS);
  }

  function setCell(i, col, row) {
    const mg = (COL_W - CELL_H * 0.62) / 2;                 // сохраняем пропорции цифры
    const u0 = (col * COL_W + mg) / ATLAS_W, u1 = ((col + 1) * COL_W - mg) / ATLAS_W;
    const vTop = 1 - row * CELL_H / ATLAS_H, vBot = 1 - (row + 1) * CELL_H / ATLAS_H;
    uvs.set([u0, vBot, u1, vBot, u1, vTop, u0, vTop], i * 8);
  }

  function render() {
    const mag = Math.abs(shown);
    for (let k = 0; k < digits; k++) {                      // k = 0 — младший разряд
      const p = Math.pow(10, k);
      const x = mag / p, fl = Math.floor(x + 1e-9), frac = x - fl;
      let d = ((fl % 10) + 10) % 10;
      let roll = k === 0 ? frac : Math.max(0, (frac - (1 - 1 / p)) * p);
      if (roll < 1e-6) roll = 0;
      const s = d + Math.min(1, roll);                      // 0..10
      const col = s < 5 ? 0 : 1, row = s < 5 ? s : s - 5;
      setCell(nCells - 1 - k, col, row);
    }
    if (signed) setCell(0, 2, Math.abs(shown) < 0.5 ? 2 : (shown < 0 ? 1 : 0));
    uvAttr.needsUpdate = true;
  }

  const off = c.engine.onFrame(dt => {
    if (shown === target) return;
    let diff = target - shown;
    if (wrapS) { diff = ((diff % wrapS) + wrapS) % wrapS; if (diff > wrapS / 2) diff -= wrapS; }
    const stepv = diff * (1 - Math.exp(-dt * 13));
    if (Math.abs(diff) < 0.012) shown = target;
    else {
      // не медленнее 2.5 единиц младшего разряда в секунду — чтобы докрутка не «залипала»
      const minStep = Math.sign(diff) * Math.min(Math.abs(diff), 2.5 * dt);
      shown += Math.abs(stepv) > Math.abs(minStep) ? stepv : minStep;
      if (wrapS) { shown %= wrapS; if (shown < 0) shown += wrapS; }
    }
    if (opts.sound) {
      const fi = Math.floor(shown);
      if (fi !== lastTickInt) { lastTickInt = fi; snd(c, group, 'drumTick'); }
    }
    render();
  });

  const api = {
    w: W, h: Hh,
    get value() { return target / scale; },
    /** Значение, показываемое в данный момент (во время прокрутки отличается от value). */
    get shown() { return shown / scale; },
    setValue(v, o = {}) {
      target = norm(v);
      if (o.instant) { shown = target; lastTickInt = Math.floor(shown); render(); }
    },
  };
  api.setValue(opts.value || 0, { instant: true });
  return finish(api, group, [off]);
}
