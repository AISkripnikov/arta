// Телеграфный аппарат поста «ОГОНЬ»: наклонный стол с бумажной лентой (canvas-текстура),
// печатающая каретка, подача бумаги. Новая строка печатается внизу, старые уходят вверх.
const DEG = Math.PI / 180;

/**
 * h — помощники поста: { stat(material, geometry, matrix), mtx(pos, rot), box(...), cylX(...), dark }.
 * → { object3D, print(text, { color, animate }), clear(), flush(), update(dt, sound), lines, busy, dispose() }
 */
export function createTelegraph(ctx, h) {
  const { engine, THREE, mat, audio } = ctx;
  const G = engine.geom, T = engine.textures;
  const PAL = mat.PALETTE;

  // --- геометрия стола: лента идёт от A (низ, ближе к игроку) к B (верх, у панели); координаты (z, y) поста
  const X = -0.565, W = 0.54, PAPER_W = 0.47;
  const A = [0.285, 0.905], B = [0.095, 1.105];
  const LEN = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const tilt = -Math.atan2(A[0] - B[0], B[1] - A[1]);                 // поворот вокруг X (верх отклонён назад)
  const C = [X, (A[1] + B[1]) / 2, (A[0] + B[0]) / 2];
  const M = h.mtx(C, [tilt, 0, 0]);                                    // локальная система стола: X поперёк, Y вверх по ленте, Z — нормаль

  const object3D = new THREE.Group();
  object3D.name = 'telegraph';
  object3D.position.set(C[0], C[1], C[2]);
  object3D.rotation.x = tilt;

  // корпус: основание, щёки, стол, валики
  h.stat(h.dark, h.box(W, 0.2, 0.33, X, 0.79, 0.145));
  for (const sx of [-1, 1]) {
    const sh = new THREE.Shape();
    sh.moveTo(-0.02, 0.86); sh.lineTo(0.31, 0.86); sh.lineTo(0.31, 0.915); sh.lineTo(0.112, 1.127); sh.lineTo(-0.02, 1.127); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.024, bevelEnabled: false });
    g.rotateY(-Math.PI / 2);
    g.translate(X + sx * (W / 2 - 0.012) + 0.012, 0, 0);
    h.stat(mat.bakelite, g);
  }
  h.stat(mat.darkSteel, h.box(W - 0.04, LEN + 0.03, 0.02, 0, 0, -0.012), M.clone());
  h.stat(mat.ivory, h.cylX(0.016, PAPER_W, 0, LEN / 2 + 0.008, -0.012), M.clone());          // лента уходит через верхний валик
  h.stat(mat.steel, h.box(PAPER_W + 0.02, 0.01, 0.004, 0, LEN / 2 - 0.012, 0.006), M.clone());   // планка отрыва
  const RAIL_S = 0.017;                                                                   // направляющая каретки (от низа ленты)
  h.stat(mat.nickel, h.cylX(0.005, W - 0.05, 0, -LEN / 2 + RAIL_S, 0.017, 8), M.clone());
  h.stat(mat.nickel, h.cylX(0.004, W - 0.05, 0, -LEN / 2 + RAIL_S - 0.011, 0.012, 8), M.clone());

  // ручка подачи бумаги (крутится при подаче)
  const knobG = G.lathe([[0.03, 0], [0.03, 0.016], [0.026, 0.022], [0.012, 0.024], [0, 0.024]], 18);
  knobG.rotateY(Math.PI / 2);
  const knob = new THREE.Mesh(knobG, mat.bakelite);
  knob.position.set(W / 2, LEN / 2 + 0.008, -0.012);
  object3D.add(knob);

  // каретка
  const carriage = new THREE.Mesh(G.merge([
    G.xf(G.slab(0.044, 0.026, 0.02, { r: 0.006, bevel: 0.003 }), { p: [0, 0, 0] }),
    h.box(0.008, 0.014, 0.006, 0, 0.018, 0.006),
  ]), mat.darkSteel);
  carriage.position.set(0, -LEN / 2 + RAIL_S, 0.008);
  object3D.add(carriage);

  // --- лента
  const PX = 512, PPM = PX / PAPER_W, PY = Math.round(LEN * PPM);
  const CAP = 0.026, PITCH = 0.0445, S0 = 0.067, MARGIN = 0.028;       // м: высота прописной, шаг строк, строка печати от низа, поле
  const VISIBLE = 5, MAX_W = PAPER_W - MARGIN * 2;
  const canvas = T.makeCanvas(PX, PY), c2 = canvas.getContext('2d');
  const bg = T.makeCanvas(PX, PY);
  {
    const b = bg.getContext('2d');
    b.fillStyle = '#ece5cf'; b.fillRect(0, 0, PX, PY);
    const gx = b.createLinearGradient(0, 0, PX, 0);
    gx.addColorStop(0, 'rgba(80,60,20,0.28)'); gx.addColorStop(0.035, 'rgba(80,60,20,0)'); gx.addColorStop(0.965, 'rgba(80,60,20,0)'); gx.addColorStop(1, 'rgba(80,60,20,0.28)');
    b.fillStyle = gx; b.fillRect(0, 0, PX, PY);
    const gy = b.createLinearGradient(0, 0, 0, PY);
    gy.addColorStop(0, 'rgba(60,45,15,0.34)'); gy.addColorStop(0.14, 'rgba(60,45,15,0)'); gy.addColorStop(0.86, 'rgba(60,45,15,0)'); gy.addColorStop(1, 'rgba(40,30,10,0.3)');
    b.fillStyle = gy; b.fillRect(0, 0, PX, PY);
  }
  const tex = T.canvasTexture(canvas, { aniso: 8 });
  const paperMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.16 });
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(PAPER_W, LEN), paperMat);
  paper.position.z = 0.0015;
  paper.name = 'tape';
  object3D.add(paper);

  const widthOf = t => T.measureLabel(t, 100, { weight: 600 }).width / 100 * CAP;
  function wrap(text) {
    const words = T.upper(text).replace(/\s+/g, ' ').trim().split(' ');
    const out = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (cur && widthOf(t) > MAX_W) { out.push(cur); cur = w; } else cur = t;
    }
    if (cur) out.push(cur);
    return out;
  }

  const lines = [];            // напечатанные строки (последняя — на строке печати): { text, color }
  const queue = [];            // ждут печати
  let typed = 0;               // сколько знаков последней строки уже напечатано (дробное)
  let feed = 0;                // 0…1 — ход подачи бумаги (1 — только начали)
  let mode = 'idle';           // 'idle' | 'feed' | 'type'
  let carX = -PAPER_W / 2 + MARGIN, carTarget = carX;
  let dirty = true;

  function draw() {
    dirty = false;
    c2.drawImage(bg, 0, 0);
    const n = lines.length;
    for (let k = 0; k < Math.min(n, VISIBLE + 2); k++) {
      const ln = lines[n - 1 - k];
      const s = S0 + (k - feed) * PITCH;
      const cy = PY - s * PPM;
      if (cy < -CAP * PPM) break;
      const text = k === 0 && mode === 'type' ? ln.text.slice(0, Math.floor(typed)) : ln.text;
      if (text) T.drawLabel(c2, text, MARGIN * PPM, cy, CAP * PPM, { color: ln.color, align: 'left', weight: 600 });
    }
    tex.needsUpdate = true;
  }

  function startNext() {
    const next = queue.shift();
    if (!next) { mode = 'idle'; return; }
    lines.push(next);
    if (lines.length > 14) lines.shift();
    typed = 0;
    if (lines.length > 1) { mode = 'feed'; feed = 1; } else { mode = 'type'; feed = 0; }
    carTarget = -PAPER_W / 2 + MARGIN;
    dirty = true;
  }

  function flush() {
    while (queue.length) { lines.push(queue.shift()); if (lines.length > 14) lines.shift(); }
    mode = 'idle'; feed = 0;
    const last = lines[lines.length - 1];
    typed = last ? last.text.length : 0;
    carTarget = -PAPER_W / 2 + MARGIN + (last ? Math.min(MAX_W, widthOf(last.text)) : 0);
    carX = carTarget;
    carriage.position.x = carX;
    dirty = true;
  }

  const api = {
    object3D, paper,
    /** Напечатанные и ожидающие строки (для тестов). */
    get lines() { return lines.concat(queue).map(l => l.text); },
    get busy() { return mode !== 'idle' || queue.length > 0; },
    /** Напечатать текст (переносится по ширине ленты). animate=false — без анимации (пост не на экране). */
    print(text, o = {}) {
      const color = o.color || '#1b2530';
      wrap(text).forEach(t => queue.push({ text: t, color }));
      if (o.animate === false) flush();
    },
    clear() {
      lines.length = 0; queue.length = 0; mode = 'idle'; typed = 0; feed = 0;
      carTarget = carX = -PAPER_W / 2 + MARGIN; carriage.position.x = carX;
      dirty = true;
    },
    flush,
    update(dt, sound) {
      if (mode === 'idle' && queue.length) startNext();
      const hurry = queue.length > 5 ? 3 : 1;
      if (mode === 'feed') {
        const before = feed;
        feed = Math.max(0, feed - dt / 0.17 * hurry);
        knob.rotation.x -= (before - feed) * 1.4;
        if (sound && before === 1) audio.paper({ gain: 0.8 });          // лента подалась на строку
        if (feed === 0) mode = 'type';
        dirty = true;
      } else if (mode === 'type') {
        const ln = lines[lines.length - 1];
        const before = Math.floor(typed);
        typed = Math.min(ln.text.length, typed + dt * 38 * hurry);
        const now = Math.floor(typed);
        if (now !== before) {
          dirty = true;
          if (sound && ln.text[now - 1] !== ' ') audio.tick();
          carTarget = -PAPER_W / 2 + MARGIN + Math.min(MAX_W, widthOf(ln.text.slice(0, now)));
        }
        if (typed >= ln.text.length) { mode = 'idle'; if (queue.length) startNext(); }
      }
      if (carX !== carTarget) {
        const back = carTarget < carX;
        carX += (carTarget - carX) * (1 - Math.exp(-dt * (back ? 16 : 40)));
        if (Math.abs(carTarget - carX) < 0.0005) carX = carTarget;
        carriage.position.x = carX;
      }
      if (dirty) draw();
    },
    dispose() { tex.dispose(); paperMat.dispose(); },
  };
  draw();
  return api;
}
