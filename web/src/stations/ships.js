// Модели кораблей, береговых объектов и самолётов для смотровой щели (fire-slit.js) и трубы наблюдения
// (observe.js). Низкополигональные силуэты: одна геометрия с цветами вершин на вид (общая для всех экземпляров),
// один общий материал, без текстур (кроме двух крохотных canvas-пятен для огня и дыма).
//
// makeShip(kind, opts) → THREE.Group
//   kind — вид цели/своего корабля: 'barge' | 'landing' | 'destroyer' | 'cruiser' | 'minelayer' | 'tanker' |
//          'submarine' (рубка) | 'battery' (береговая позиция) | 'fort' | 'radar' (мачта РЛС) |
//          'patrol' (свой сторожевик) | 'transport' (свой транспорт). Виды игры без своего силуэта (battleship, bunker, depot, howitzer)
//          подменяются ближайшим (ALIAS), неизвестный вид → 'barge'.
//          Соответствие target.kind/friend.kind из game.state этим именам — SHIP_KINDS / shipKind(obj).
//   opts — { friendly: bool } — свой: светло-серый корпус и белая опознавательная полоса ('patrol' — всегда свой).
//   Масштаб:   1 единица = 1 метр натуры (эсминец ≈ 110 единиц длиной). Вызывающий сам масштабирует группу
//              под свою сцену (group.scale.setScalar(k)).
//   Начало:    на ватерлинии у миделя (середина длины, диаметральная плоскость). +Y вверх, +X — нос, +Z — правый борт.
//              Для береговых объектов начало — на уровне земли в центре, +X — «лицом» к морю.
//   Курс:      game даёт heading в градусах (0 — север, по часовой). Поворот группы вокруг Y ставит вызывающий.
//   Размеры:   group.userData.size = { length, beam, height } (м) — для отбора по расстоянию и рамок.
//              group.userData.land — true у береговых объектов (battery, fort, radar): они не тонут, а оседают и горят.
//   Состояние: group.userData.setState({ burning, sinking, list, wake })
//                burning — bool: огонь и дым (target.burning);
//                sinking — 0..1: доля погружения (0 — на плаву, 1 — ушёл под воду; из target.sinking:
//                          (state.time − since) / dur); модель сама топит и кренит корпус;
//                list    — крен в градусах (+ на правый борт), необязателен;
//                wake    — 0..1: кильватерный след (расш.; плоская пена на воде, для неподвижных — 0).
//              Любое поле можно опустить — остаётся прежнее. Вызывать можно каждый кадр (дёшево).
//   group.userData.update(dt, time) — анимация огня/дыма; вызывать, пока модель видима.
//   group.userData.dispose() — освободить собственные материалы (геометрии общие, живут до конца).
//
// makePlane(opts) → THREE.Group
//   Масштаб 1 единица = 1 метр (размах ≈ 14). Начало — центр фюзеляжа, +X — нос, +Y вверх.
//   group.userData.setState({ burning, down }) — burning: дымный след; down 0..1: падение после сбития.
//   group.userData.update(dt, time), group.userData.dispose() — как у корабля.
//
// createFleet(game, parent) / createAirWing(game, parent) — (расш.) держат модели в соответствии с game.state:
//   fleet.sync(dt, time, place) — для каждой цели/своего с game.visible(id) (и не sunk/escaped) зовёт
//     place(obj, group, friendly) → false, чтобы скрыть; остальные модели прячет. Состояние (огонь, погружение, след)
//     выставляет сам. fleet.shown — сколько моделей показано. fleet.clear() — сбросить (новое задание).
//   wing.sync(dt, time, place) — то же для state.raid.planes: place(plane, group).
import * as THREE from 'three';

export const SHIP_KINDS = ['barge', 'landing', 'destroyer', 'cruiser', 'minelayer', 'tanker', 'submarine', 'battery', 'fort', 'radar', 'patrol', 'transport'];

// виды из game (missions.js KINDS), у которых нет своего силуэта → ближайший по облику
const ALIAS = { battleship: 'cruiser', bunker: 'fort', depot: 'fort', howitzer: 'battery' };
const LAND = { battery: true, fort: true, radar: true };
const DEG = Math.PI / 180;

/** Вид модели для цели или своего корабля из game.state (по полю kind; неизвестное → 'barge'). */
export function shipKind(obj) {
  const k = obj && obj.kind;
  return SHIP_KINDS.includes(k) ? k : ALIAS[k] || 'barge';
}
/** Береговой объект (стоит на острове, не тонет)? Принимает вид игры или вид модели. */
export function isLandKind(kind) { return !!LAND[shipKind({ kind })]; }

// ---------- сборщик геометрии: всё в один буфер с цветами вершин ----------
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color();

class Builder {
  constructor() { this.p = []; this.c = []; }
  geo(g, col, x, y, z, rx = 0, ry = 0, rz = 0) {
    const n = g.index ? g.toNonIndexed() : g;
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s);
    n.applyMatrix4(_m);
    const a = n.attributes.position.array;
    _c.set(col);
    for (let i = 0; i < a.length; i += 3) { this.p.push(a[i], a[i + 1], a[i + 2]); this.c.push(_c.r, _c.g, _c.b); }
    if (n !== g) n.dispose();
    g.dispose();
    return this;
  }
  /** Короб: центр по x/z, низ на y. l — вдоль X, h — вверх, w — вдоль Z. */
  box(col, x, y, z, l, h, w, rz = 0) { return this.geo(new THREE.BoxGeometry(l, h, w), col, x, y + h / 2, z, 0, 0, rz); }
  /** Вертикальный цилиндр/конус: низ на y. */
  cyl(col, x, y, z, r, h, seg = 6, rTop = r) { return this.geo(new THREE.CylinderGeometry(rTop, r, h, seg), col, x, y + h / 2, z); }
  /** Ствол/балка вдоль X от точки (x, y, z): dir = ±1, elev — подъём, рад. */
  bar(col, x, y, z, len, r, dir = 1, elev = 0.08) {
    const cx = x + dir * Math.cos(elev) * len / 2, cy = y + Math.sin(elev) * len / 2;
    return this.geo(new THREE.CylinderGeometry(r, r, len, 5, 1, true), col, cx, cy, z, 0, 0, dir > 0 ? -Math.PI / 2 + elev : Math.PI / 2 - elev);
  }
  /** Наклонная стрела/мачта от (x, y, z) длиной len: tilt — наклон от вертикали в сторону +X, рад. */
  spar(col, x, y, z, len, r, tilt = 0) {
    return this.geo(new THREE.CylinderGeometry(r, r, len, 4, 1, true), col, x + Math.sin(tilt) * len / 2, y + Math.cos(tilt) * len / 2, z, 0, 0, -tilt);
  }
  quad(col, a, b, c, d) {
    _c.set(col);
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
    for (let i = 0; i < 6; i++) this.c.push(_c.r, _c.g, _c.b);
    return this;
  }
  /**
   * Корпус: обводы по шпангоутам от кормы к носу. o: { bow — доля длины под заострение носа, stern — ширина транца (доля),
   * sheer — подъём палубы к носу, м, ox, oz — смещение, keel — осадка }.
   */
  hull(col, deck, L, B, H, o = {}) {
    const { bow = 0.3, stern = 0.6, sheer = 0, ox = 0, oz = 0, keel = 1.6 } = o;
    const ts = [0, 0.07, 0.2, 0.45, 1 - bow, 1 - bow * 0.62, 1 - bow * 0.28, 1];
    const st = ts.map((t) => {
      let k = 1;
      if (t < 0.2) k = stern + (1 - stern) * Math.sin((t / 0.2) * Math.PI / 2);
      else if (t > 1 - bow) k = Math.max(0, 1 - Math.pow((t - (1 - bow)) / bow, 1.7));
      const up = t > 0.55 ? sheer * Math.pow((t - 0.55) / 0.45, 2) : 0;
      return [ox + (t - 0.5) * L, (B / 2) * k, H + up];
    });
    for (let i = 0; i < st.length - 1; i++) {
      const a = st[i], b = st[i + 1];
      for (const s of [-1, 1]) {
        this.quad(col, [a[0], -keel, oz + s * a[1] * 0.55], [b[0], -keel, oz + s * b[1] * 0.55], [b[0], b[2], oz + s * b[1]], [a[0], a[2], oz + s * a[1]]);
      }
      this.quad(deck, [a[0], a[2], oz - a[1]], [b[0], b[2], oz - b[1]], [b[0], b[2], oz + b[1]], [a[0], a[2], oz + a[1]]);
    }
    const a = st[0];
    this.quad(col, [a[0], -keel, oz - a[1] * 0.55], [a[0], -keel, oz + a[1] * 0.55], [a[0], a[2], oz + a[1]], [a[0], a[2], oz - a[1]]);
    return this;
  }
  /** Орудийная установка: щит/башня размера s и n стволов; dir = ±1 — куда смотрит. */
  mount(col, dark, x, y, s, dir = 1, n = 1, z = 0) {
    this.box(col, x, y, z, s * 1.4, s * 0.75, s * 1.25);
    for (let i = 0; i < n; i++) this.bar(dark, x + dir * s * 0.6, y + s * 0.45, z + (i - (n - 1) / 2) * s * 0.42, s * 2.3, s * 0.085, dir);
    return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeVertexNormals();
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

// ---------- цвета ----------
const ENEMY = { hull: 0x3e464e, deck: 0x5d584f, sup: 0x747d85, dark: 0x23272b, gun: 0x525a62, rust: 0x6a4b3c, cargo: 0x566049 };
const FRIEND = { hull: 0x98a6b0, deck: 0x8b8474, sup: 0xc6ced4, dark: 0x3b4147, gun: 0x8a949c, rust: 0x9aa4aa, cargo: 0x7d8a72 };
const BAND = 0xf6f5ee, SAND = 0x857a5e, CONCRETE = 0x8b8c85, EARTH = 0x5c5a45;

// ---------- силуэты ----------
const MODELS = {
  barge(b, C) {
    b.hull(C.rust, C.deck, 45, 9, 3, { bow: 0.14, stern: 0.92, keel: 1.2 });
    b.box(C.cargo, 3, 3, 0, 26, 2.4, 7).box(C.cargo, 3, 5.4, 0, 20, 1, 5);
    b.box(C.sup, -17, 3, 0, 6, 4, 5).cyl(C.dark, -18.5, 7, 0, 0.7, 3, 5);
    b.spar(C.dark, 18, 3, 0, 7, 0.25);
  },
  landing(b, C) {
    for (const [ox, oz] of [[9, -15], [-13, 9], [15, 15]]) {
      b.hull(C.hull, C.deck, 22, 5.6, 2.6, { bow: 0.07, stern: 0.95, ox, oz, keel: 0.9 });
      b.box(C.gun, ox + 11.2, 0.6, oz, 0.6, 3.4, 4.6, -0.22);              // носовая аппарель
      b.box(C.sup, ox - 7, 2.6, oz, 4.5, 2.6, 4).box(C.cargo, ox + 2, 2.6, oz, 10, 1.3, 4);
      b.spar(C.dark, ox - 7, 5.2, oz, 3.5, 0.15);
    }
  },
  destroyer(b, C) {
    b.hull(C.hull, C.deck, 110, 11, 5, { bow: 0.34, stern: 0.55, sheer: 2.6 });
    b.box(C.sup, 19, 5, 0, 14, 6.5, 7.5).box(C.sup, 20, 11.5, 0, 8, 3, 6);
    b.cyl(C.dark, 3, 5, 0, 2.3, 10, 6, 2).cyl(C.dark, -13, 5, 0, 2.3, 9, 6, 2);
    b.box(C.sup, -31, 5, 0, 14, 3.6, 6.5).box(C.gun, -5, 5, 0, 9, 1.6, 3.2);
    b.spar(C.dark, 15, 11.5, 0, 15, 0.32, -0.05).box(C.dark, 14.5, 21, 0, 0.4, 0.4, 8);
    b.spar(C.dark, -27, 8.6, 0, 9, 0.25, -0.05);
    b.mount(C.gun, C.dark, 39, 6.2, 3.4, 1).mount(C.gun, C.dark, -29, 8.6, 3.2, -1).mount(C.gun, C.dark, -44, 5, 3.4, -1);
  },
  cruiser(b, C) {
    b.hull(C.hull, C.deck, 180, 20, 7, { bow: 0.33, stern: 0.5, sheer: 3.2 });
    b.box(C.sup, 28, 7, 0, 28, 7, 13).box(C.sup, 31, 14, 0, 15, 6, 10).cyl(C.sup, 31, 20, 0, 2.8, 9, 6, 2.2).box(C.dark, 31, 29, 0, 4, 2, 9);
    b.cyl(C.dark, 6, 7, 0, 3.7, 14, 6, 3.2).cyl(C.dark, -13, 7, 0, 3.7, 13, 6, 3.2);
    b.box(C.sup, -40, 7, 0, 24, 5.5, 11).cyl(C.sup, -38, 12.5, 0, 2, 8, 6, 1.6);
    b.spar(C.dark, 24, 20, 0, 16, 0.4, -0.04).spar(C.dark, -32, 12.5, 0, 18, 0.4, -0.04).box(C.dark, -32.6, 26, 0, 0.4, 0.4, 9);
    b.cyl(C.gun, 48, 7, 0, 4.2, 4, 8);
    b.mount(C.gun, C.dark, 64, 8.6, 6.2, 1, 2).mount(C.gun, C.dark, 48, 11, 6.2, 1, 2);
    b.mount(C.gun, C.dark, -58, 12.5, 6, -1, 2).mount(C.gun, C.dark, -73, 7, 6.2, -1, 2);
    b.mount(C.gun, C.dark, 2, 7, 2.6, 1, 1, 7.6).mount(C.gun, C.dark, 2, 7, 2.6, 1, 1, -7.6);
  },
  minelayer(b, C) {
    b.hull(C.hull, C.deck, 80, 11, 4, { bow: 0.3, stern: 0.9, sheer: 1.8 });
    b.box(C.sup, 16, 4, 0, 13, 5.5, 8).box(C.sup, 17, 9.5, 0, 7, 2.6, 6).cyl(C.dark, 3, 4, 0, 2, 8.5, 6, 1.7);
    b.spar(C.dark, 12, 9.5, 0, 11, 0.28, -0.05).box(C.dark, 11.6, 16, 0, 0.35, 0.35, 6);
    for (const z of [-2.6, 2.6]) {
      b.box(C.dark, -22, 4, z, 32, 0.45, 0.5);
      for (let i = 0; i < 5; i++) b.cyl(C.dark, -34 + i * 5.6, 4.45, z, 0.95, 1.5, 6, 0.6);
    }
    b.mount(C.gun, C.dark, 30, 4.8, 2.4, 1);
  },
  tanker(b, C) {
    b.hull(0x2f3337, C.rust, 140, 18, 5, { bow: 0.24, stern: 0.7, sheer: 1.4, keel: 2 });
    b.box(C.sup, -52, 5, 0, 20, 9, 14).box(C.sup, -50, 14, 0, 10, 2.8, 11).cyl(C.dark, -57, 14, 0, 2.6, 7.5, 6, 2.2);
    b.box(C.sup, 10, 5, 0, 10, 8.5, 13).box(C.sup, 10, 13.5, 0, 6, 2.6, 9);
    b.box(C.gun, -10, 7, 0, 112, 0.5, 1.6);
    for (let i = 0; i < 7; i++) if (i !== 4) b.cyl(C.gun, -34 + i * 11.5, 5, 0, 1.9, 1.1, 6);
    b.spar(C.dark, 44, 5.8, 0, 15, 0.35).spar(C.dark, -24, 5, 0, 15, 0.35).box(C.sup, 60, 6.2, 0, 14, 2, 9);
  },
  submarine(b, C) {
    b.hull(C.hull, C.dark, 72, 6.4, 1.5, { bow: 0.38, stern: 0.12, keel: 1.4, sheer: 0.7 });
    b.box(C.sup, 3, 1.5, 0, 10, 4.6, 3).box(C.sup, 2, 6.1, 0, 5.5, 1.3, 2.4);
    b.spar(C.dark, 3, 7.4, 0, 4.5, 0.16).spar(C.dark, 0.8, 7.4, 0, 3, 0.16);
    b.mount(C.gun, C.dark, 14, 1.7, 1.5, 1);
    b.box(C.dark, -2, 1.5, 0, 46, 0.35, 2.6);
  },
  battery(b, C) {
    for (const z of [-11, 11]) {
      b.cyl(SAND, 0, 0, z, 9.5, 3.2, 8, 7.2);
      b.box(C.gun, 0.5, 3.2, z, 3.2, 2.6, 5).bar(C.dark, 2, 4.6, z, 8.5, 0.34, 1, 0.22);
    }
    b.box(EARTH, -5, 0, 0, 9, 2.4, 9).box(C.cargo, -5, 2.4, 0, 6, 1.2, 6);
    b.spar(C.dark, -8, 0, 4, 9, 0.18);
  },
  fort(b, C) {
    b.cyl(CONCRETE, 0, 0, 0, 30, 9, 8, 26).box(CONCRETE, -2, 9, 0, 24, 5, 36);
    for (const z of [-11, 11]) b.cyl(C.dark, 2, 14, z, 5, 3, 8, 4).bar(C.dark, 5, 15.3, z - 1, 11, 0.42, 1, 0.15).bar(C.dark, 5, 15.3, z + 1, 11, 0.42, 1, 0.15);
    for (const z of [-15, -5, 5, 15]) b.box(C.dark, 26.6, 3.4, z, 1.4, 1.6, 4.2);
    b.box(C.dark, -6, 14, 0, 5, 3.2, 5).spar(C.dark, -6, 17.2, 0, 10, 0.2);
  },
  radar(b, C) {
    b.box(CONCRETE, -7, 0, 0, 8, 4, 7).box(C.dark, -7, 4, 0, 8.6, 0.5, 7.6).cyl(EARTH, 2, 0, 0, 7, 1, 8, 6);
    for (const [x, z] of [[-0.9, -1.9], [5.1, -1.9], [-0.9, 1.9], [5.1, 1.9]]) b.spar(C.dark, x, 1, z, 24.2, 0.22, x < 2 ? 0.05 : -0.05);
    for (let i = 0; i < 4; i++) { const y = 5 + i * 6, w = 4.6 - i * 0.5; b.box(C.dark, 2, y, 0, w + 0.6, 0.3, w); b.spar(C.dark, 2 - w / 2, y, 1.8, 6.6, 0.12, 0.6); }
    for (let i = 0; i < 4; i++) b.box(C.gun, 2.6, 24.5 + i * 2.6, 0, 0.35, 0.35, 15);
    for (let i = 0; i < 6; i++) b.box(C.gun, 2.6, 24, (i - 2.5) * 3, 0.3, 8.6, 0.3);
    b.spar(C.dark, 2, 24, 0, 10.5, 0.3);
  },
  patrol(b, C) {
    b.hull(C.hull, C.deck, 38, 7, 3, { bow: 0.36, stern: 0.7, sheer: 1.4, keel: 1 });
    b.box(C.sup, 2, 3, 0, 9, 3.4, 4.6).box(C.sup, 3, 6.4, 0, 4.4, 1.8, 3.6).cyl(C.dark, -4.5, 3, 0, 0.9, 3.6, 6, 0.7);
    b.spar(C.dark, 1.5, 8.2, 0, 7, 0.16, -0.06).box(C.dark, 1.2, 12.6, 0, 0.25, 0.25, 3.6);
    b.mount(C.gun, C.dark, 11.5, 3.6, 1.7, 1);
    b.box(C.gun, -13, 3, 1.6, 4, 1.1, 1.2).box(C.gun, -13, 3, -1.6, 4, 1.1, 1.2);
  },
  transport(b, C) {
    b.hull(C.hull, C.deck, 120, 16, 6, { bow: 0.26, stern: 0.66, sheer: 1.6, keel: 2 });
    b.box(C.hull, 50, 6.3, 0, 16, 2.3, 9).box(C.hull, -51, 6, 0, 16, 2.4, 13);
    b.box(C.sup, -4, 6, 0, 24, 7.5, 12.5).box(C.sup, -1, 13.5, 0, 12, 2.8, 10).cyl(C.dark, -8, 13.5, 0, 2.7, 8.5, 6, 2.4);
    for (const x of [28, -30]) {
      b.box(C.cargo, x, 6, 0, 16, 1.5, 9).spar(C.dark, x + 9.5, 6, 0, 17, 0.4);
      b.spar(C.dark, x + 9.5, 9, 0, 14, 0.2, -0.9).spar(C.dark, x + 9.5, 9, 0, 9, 0.2, 0.9);
    }
  },
};

const geoCache = new Map();   // 'kind:F|E' → { geometry, size }
let shipMat = null, wakeGeo = null, wakeMat = null, blobTex = null;

function modelFor(kind, friendly) {
  const key = kind + (friendly ? ':F' : ':E');
  let m = geoCache.get(key);
  if (m) return m;
  const b = new Builder(), C = friendly ? FRIEND : ENEMY;
  MODELS[kind](b, C);
  if (friendly) {
    // опознавательная полоса: белый пояс поперёк корпуса у миделя и белая марка на трубе
    const dims = { patrol: [38, 7, 3], transport: [120, 16, 6] }[kind] || [60, 10, 4];
    b.box(BAND, dims[0] * (kind === 'transport' ? 0.19 : -0.2), 0.15, 0, dims[0] * 0.075, dims[2] + 0.12, dims[1] + 0.5);
    if (kind === 'transport') b.cyl(BAND, -8, 18, 0, 2.62, 2, 6, 2.55);
  }
  const geometry = b.build(), bb = geometry.boundingBox;
  m = { geometry, size: { length: +(bb.max.x - bb.min.x).toFixed(1), beam: +(bb.max.z - bb.min.z).toFixed(1), height: +bb.max.y.toFixed(1) } };
  geoCache.set(key, m);
  return m;
}

function sharedShipMat() {
  return shipMat || (shipMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
}
function blob() {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.72)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(c);
  blobTex.colorSpace = THREE.SRGBColorSpace;
  return blobTex;
}
/** Общая текстура мягкого пятна (огонь, дым, вспышки) — для постов, чтобы не плодить свои. */
export function blobTexture() { return blob(); }

function wake() {
  if (wakeGeo) return wakeGeo;
  // единичный след (длина корабля = 1, нос в x = 0.5): плоские усы и пена на воде + низкие вертикальные «буруны»
  // (на дистанции в километры плоская пена с высоты трубы не видна — читается только то, что имеет высоту).
  const p = [];
  const tri = (a, b, c) => p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
  for (const s of [-1, 1]) {
    tri([0.5, 0, 0], [-0.9, 0, s * 0.42], [-0.9, 0, s * 0.3]);
    quad([0.5, 0, s * 0.004], [0.5, 0.028, s * 0.006], [0.3, 0.012, s * 0.05], [0.26, 0, s * 0.05]);          // носовой бурун
    quad([0.3, 0, s * 0.05], [0.3, 0.008, s * 0.05], [-0.45, 0.006, s * 0.055], [-0.45, 0, s * 0.055]);       // пена вдоль борта
  }
  quad([-0.48, 0, -0.05], [-0.48, 0, 0.05], [-1.5, 0, 0.11], [-1.5, 0, -0.11]);
  quad([-0.47, 0, 0], [-0.47, 0.016, 0], [-1.35, 0.004, 0], [-1.35, 0, 0]);                                    // бурун за кормой
  quad([-0.5, 0, -0.05], [-0.5, 0.014, -0.05], [-0.5, 0.014, 0.05], [-0.5, 0, 0.05]);
  wakeGeo = new THREE.BufferGeometry();
  wakeGeo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  wakeGeo.computeVertexNormals();
  wakeMat = new THREE.MeshBasicMaterial({ color: 0xe8eef0, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  return wakeGeo;
}

function smokeSprite(color, additive) {
  const m = new THREE.SpriteMaterial({ map: blob(), color, transparent: true, opacity: 0, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  const s = new THREE.Sprite(m);
  s.visible = false;
  return s;
}

export function makeShip(kind, opts = {}) {
  const k = shipKind({ kind });
  const friendly = !!opts.friendly || k === 'patrol';
  const { geometry, size } = modelFor(k, friendly);
  const land = !!LAND[k];
  const big = kind === 'battleship' ? 1.22 : 1;            // линкор — тот же силуэт крейсера, но крупнее
  const L = size.length * big, H = size.height * big;
  const group = new THREE.Group();
  group.name = 'ship:' + k;
  const body = new THREE.Group();                          // тонет и кренится он, а не group: её ставит вызывающий
  const mesh = new THREE.Mesh(geometry, sharedShipMat());
  body.add(mesh); body.scale.setScalar(big);
  group.add(body);
  const st = { burning: false, sinking: 0, list: 0, wake: 0 };
  const seed = (k.length * 37 + (opts.seed || 0) * 17) % 7;
  const pitchDir = seed % 2 ? 1 : -1;
  let fx = null, wk = null;                                // огонь/дым и след создаются при первой надобности
  const own = [];

  function ensureFx() {
    if (fx) return;
    fx = new THREE.Group();
    fx.fire = smokeSprite(0xff8a22, false);
    fx.smoke = [smokeSprite(0x24211f, false), smokeSprite(0x2e2a27, false), smokeSprite(0x383431, false)];
    fx.add(fx.fire, ...fx.smoke);
    own.push(fx.fire.material, ...fx.smoke.map((s) => s.material));
    group.add(fx);
  }
  function apply() {
    const s = st.sinking;
    if (land) {
      body.scale.set(big, big * (1 - 0.42 * s), big);
      body.rotation.z = k === 'radar' ? pitchDir * s * 0.5 : 0;
      group.visible = s < 1;
    } else {
      body.position.y = -H * 1.05 * s * s;
      body.rotation.z = pitchDir * 0.38 * s;
      body.rotation.x = (st.list + 26 * Math.sin(s * Math.PI / 2)) * DEG;
      group.visible = s < 1;
    }
    if (st.wake > 0.02 && !land && s <= 0) {
      if (!wk) { wk = new THREE.Mesh(wake(), wakeMat); wk.position.y = 0.3; wk.scale.setScalar(L); wk.renderOrder = 1; group.add(wk); }
      wk.visible = true;
    } else if (wk) wk.visible = false;
    if (st.burning || s > 0) ensureFx();
    if (fx) fx.visible = st.burning || s > 0;
  }

  group.userData.kind = k;
  group.userData.land = land;
  group.userData.size = { length: L, beam: size.beam * big, height: H };
  group.userData.state = st;
  group.userData.setState = (o) => {
    if (!o) return;
    if (o.burning != null) st.burning = !!o.burning;
    if (o.sinking != null) st.sinking = Math.max(0, Math.min(1, +o.sinking || 0));
    if (o.list != null) st.list = +o.list || 0;
    if (o.wake != null) st.wake = +o.wake || 0;
    apply();
  };
  group.userData.update = (dt, time) => {
    if (!fx || !fx.visible) return;
    const s = st.sinking, alive = land ? 1 - 0.5 * s : 1 - s;
    const top = H * (land ? 0.7 : 0.5) * (1 - s), x0 = -L * 0.08;
    const fl = 0.75 + 0.25 * Math.sin(time * 23 + seed) * Math.sin(time * 9.1);
    fx.fire.visible = alive > 0.05;
    fx.fire.position.set(x0, top + Math.min(8, L * 0.03), 0);
    fx.fire.scale.setScalar(Math.min(60, L * (0.14 + 0.04 * fl)) * (0.5 + 0.5 * alive));
    fx.fire.material.opacity = 0.95 * fl * alive;
    for (let i = 0; i < 3; i++) {
      const sp = fx.smoke[i], ph = (time * 0.16 + i / 3 + seed * 0.13) % 1;
      sp.visible = true;
      sp.position.set(x0 - ph * L * 0.55, top + ph * L * 0.85, (i - 1) * L * 0.03);
      sp.scale.setScalar(L * (0.12 + 0.5 * ph));
      sp.material.opacity = 0.9 * Math.min(1, ph * 7) * (1 - ph) * (0.35 + 0.65 * alive);
    }
  };
  group.userData.dispose = () => { own.forEach((m) => m.dispose()); own.length = 0; };
  apply();
  return group;
}

// ---------- самолёт ----------
let planeGeo = null, planeMat = null;
function planeGeometry() {
  if (planeGeo) return planeGeo;
  const b = new Builder(), body = 0x3c4439, dark = 0x1d2023, belly = 0x7e8a92;
  b.geo(new THREE.CylinderGeometry(0.75, 0.3, 11, 6), body, -0.5, 0, 0, 0, 0, -Math.PI / 2);        // фюзеляж: нос толще
  b.geo(new THREE.CylinderGeometry(0.5, 0.78, 1.2, 6), dark, 5.6, 0, 0, 0, 0, -Math.PI / 2);        // капот
  b.box(dark, 6.3, -1.4, 0, 0.12, 2.8, 0.3);                                                         // винт
  b.box(body, 1.4, -0.5, 0, 2.7, 0.22, 14).box(belly, 1.4, -0.56, 0, 2.5, 0.06, 13.6);               // крыло
  b.box(body, -5.2, 0.1, 0, 1.4, 0.14, 4.6).box(body, -5.4, 0.2, 0, 1.6, 1.9, 0.14);                 // оперение
  b.box(0x9fb4c0, 1.2, 0.6, 0, 2.6, 0.6, 0.8);                                                       // фонарь
  b.box(dark, 1.2, -1.1, 0, 2.4, 0.5, 0.5);                                                          // бомба под брюхом
  planeGeo = b.build();
  planeMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  return planeGeo;
}

export function makePlane() {
  const group = new THREE.Group();
  group.name = 'plane';
  const body = new THREE.Group();
  body.add(new THREE.Mesh(planeGeometry(), planeMat));
  group.add(body);
  const st = { burning: false, down: 0 };
  let trail = null;
  const own = [];
  group.userData.size = { length: 12, span: 14, height: 2.8 };
  group.userData.state = st;
  group.userData.setState = (o) => {
    if (!o) return;
    if (o.burning != null) st.burning = !!o.burning;
    if (o.down != null) st.down = Math.max(0, Math.min(1, +o.down || 0));
    body.rotation.z = -st.down * 0.9; body.rotation.x = st.down * 2.5;
    if (st.burning && !trail) {
      trail = [smokeSprite(0xff7a20, true), smokeSprite(0x1f1d1c, false), smokeSprite(0x2a2726, false)];
      trail.forEach((s) => { group.add(s); own.push(s.material); });
    }
    if (trail) for (const s of trail) s.visible = st.burning;
  };
  group.userData.update = (dt, time) => {
    if (!trail || !st.burning) return;
    trail[0].position.set(-1, 0, 0); trail[0].scale.setScalar(5 + Math.sin(time * 30)); trail[0].material.opacity = 0.9;
    for (let i = 1; i < 3; i++) {
      const ph = (time * 0.9 + i * 0.5) % 1;
      trail[i].position.set(-4 - ph * 26, ph * 3, 0); trail[i].scale.setScalar(6 + ph * 14); trail[i].material.opacity = 0.8 * (1 - ph);
    }
  };
  group.userData.dispose = () => { own.forEach((m) => m.dispose()); own.length = 0; };
  return group;
}

// ---------- флот и авиакрыло: модели по game.state ----------
const _st = { burning: false, sinking: 0, wake: 0 };

export function createFleet(game, parent) {
  const map = new Map();          // id цели (число) / своего (строка) → { group, kind, stamp }
  let stamp = 0, placeFn = null, dtNow = 0, timeNow = 0;
  const api = { shown: 0, entries: map, sync, clear, dispose: clear };

  function one(o, friendly) {
    if (o.sunk || o.escaped) return;
    const had = map.get(o.id);
    if (had) had.live = stamp;                 // объект ещё в бою — модель держим (даже если сейчас не видна)
    let vis = false;
    try { vis = game.visible(o.id); } catch (e) { vis = false; }
    if (!vis) return;
    let en = map.get(o.id);
    if (!en || en.kind !== o.kind) {
      if (en) { parent.remove(en.group); en.group.userData.dispose(); }
      en = { group: makeShip(o.kind, { friendly, seed: typeof o.id === 'number' ? o.id : o.id.length + o.id.charCodeAt(o.id.length - 1) }), kind: o.kind, stamp: 0, live: stamp };
      parent.add(en.group);
      map.set(o.id, en);
    }
    const g = en.group, sk = o.sinking;
    _st.sinking = sk ? (game.state.time - sk.since) / (sk.dur || 18) : 0;
    _st.burning = !!o.burning || !!sk;
    _st.wake = o.alive && o.speed > 0 && !(friendly && o.arrived) ? 1 : 0;
    g.userData.setState(_st);
    if (!g.visible) return;
    if (placeFn(o, g, friendly) === false) { g.visible = false; return; }
    g.userData.update(dtNow, timeNow);
    en.stamp = stamp;
    api.shown++;
  }
  // модель затонувшего / ушедшего / убранного из state (ОБОРОНА: цели прошлых волн) снимается со сцены совсем
  function hideOld(en, id) {
    if (en.live !== stamp) { parent.remove(en.group); en.group.userData.dispose(); map.delete(id); }
    else if (en.stamp !== stamp) en.group.visible = false;
  }

  function sync(dt, time, place) {
    const s = game.state;
    stamp++; api.shown = 0; placeFn = place; dtNow = dt; timeNow = time;
    if (s.mission && s.phase !== 'menu') {
      const ts = s.targets || [], fs = s.friends || [];
      for (let i = 0; i < ts.length; i++) one(ts[i], false);
      for (let i = 0; i < fs.length; i++) one(fs[i], true);
    }
    map.forEach(hideOld);
  }
  function clear() {
    map.forEach((en) => { parent.remove(en.group); en.group.userData.dispose(); });
    map.clear(); api.shown = 0;
  }
  return api;
}

export function createAirWing(game, parent) {
  const pool = [];                // { group, id }
  const api = { shown: 0, pool, sync, clear, dispose: clear };
  const _ps = { burning: false, down: 0 };
  function sync(dt, time, place) {
    const s = game.state, raid = s.mission && s.phase !== 'menu' ? s.raid : null, ps = raid ? raid.planes : null;
    let n = 0;
    api.shown = 0;
    if (ps) for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const down = p.alive ? 0 : p.downAt != null ? (s.time - p.downAt) / 4 : 1;
      if (down >= 1) continue;
      let en = pool[n];
      if (!en) { en = pool[n] = { group: makePlane(), id: 0 }; parent.add(en.group); }
      n++;
      en.id = p.id;
      _ps.burning = !p.alive || p.hit > 0.5; _ps.down = down;
      en.group.userData.setState(_ps);
      en.group.visible = place(p, en.group, down) !== false;
      if (en.group.visible) { en.group.userData.update(dt, time); api.shown++; }
    }
    for (let i = n; i < pool.length; i++) pool[i].group.visible = false;
  }
  function clear() { pool.forEach((en) => { parent.remove(en.group); en.group.userData.dispose(); }); pool.length = 0; api.shown = 0; }
  return api;
}
