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
//   group.userData.update(dt, time, fx) — анимация огня/дыма; вызывать, пока модель видима. fx — (расш.) пул частиц
//              seasky.createParticles в системе координат родителя группы: тогда дым из труб (на ходу), огонь, дым и искры
//              пожара, пузыри и пар тонущего, ходовые огни ночью (userData.night) идут частицами, а не своими спрайтами.
//   group.userData.muzzles — (расш.) точки дульных срезов [[x,y,z],…] в координатах группы (для вспышек выстрелов).
//   group.userData.dispose() — освободить собственные материалы (геометрии общие, живут до конца).
//
// makePlane(opts) → THREE.Group
//   Масштаб 1 единица = 1 метр (размах ≈ 14). Начало — центр фюзеляжа, +X — нос, +Y вверх.
//   group.userData.setState({ burning, down }) — burning: дымный след; down 0..1: падение после сбития.
//   group.userData.update(dt, time), group.userData.dispose() — как у корабля.
//
// createFleet(game, parent, { fx }) / createAirWing(game, parent, { fx }) — (расш.) держат модели в соответствии с game.state
//   (fx — пул частиц, см. выше; без него — прежние спрайты):
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
  constructor() { this.p = []; this.c = []; this.marks = { muzzle: [], funnel: [], mast: [] }; }
  /** Отметка для эффектов: 'muzzle' | 'funnel' | 'mast'. */
  mark(type, x, y, z) { this.marks[type].push([x, y, z]); return this; }
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
    this.box(dark, x - dir * s * 0.1, y + s * 0.75, z, s * 0.9, s * 0.08, s * 1.05);                 // крыша башни
    for (let i = 0; i < n; i++) this.bar(dark, x + dir * s * 0.6, y + s * 0.45, z + (i - (n - 1) / 2) * s * 0.42, s * 2.3, s * 0.085, dir);
    this.mark('muzzle', x + dir * s * 2.85, y + s * 0.6, z);
    return this;
  }
  /** Дымовая труба: кожух, тёмный срез, отметка для дыма. */
  funnel(col, dark, x, y, z, r, h, rTop = r) {
    this.cyl(col, x, y, z, r, h, 8, rTop).cyl(dark, x, y + h, z, rTop * 0.92, 0.5, 8, rTop * 0.92);
    return this.mark('funnel', x, y + h + 0.4, z);
  }
  /** Окна/иллюминаторы: тёмная полоса вокруг надстройки. */
  windows(dark, x, y, z, l, w) { return this.box(dark, x, y, z, l + 0.12, 0.75, w + 0.12); }
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
    for (let i = 0; i < 4; i++) b.box(C.dark, -6 + i * 6, 5.4, 0, 0.3, 1.05, 5.1);                     // швы брезента
    b.box(C.sup, -17, 3, 0, 6, 4, 5).windows(C.dark, -17, 5.6, 0, 6, 5).funnel(C.dark, C.dark, -18.5, 7, 0, 0.7, 3);
    b.spar(C.dark, 18, 3, 0, 7, 0.25).mark('mast', 18, 10.2, 0);
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
    b.box(C.sup, 19, 5, 0, 14, 6.5, 7.5).box(C.sup, 20, 11.5, 0, 8, 3, 6).windows(C.dark, 20.4, 13.1, 0, 7.6, 6);
    b.funnel(C.sup, C.dark, 3, 5, 0, 2.3, 10, 2).funnel(C.sup, C.dark, -13, 5, 0, 2.3, 9, 2);
    b.box(C.sup, -31, 5, 0, 14, 3.6, 6.5).box(C.gun, -5, 5, 0, 9, 1.6, 3.2);
    for (const z of [-3.9, 3.9]) b.box(0xa9a79c, -4, 6.2, z, 6, 1, 1.4).box(C.gun, -20, 5, z * 0.7, 6, 1.2, 1.1);  // шлюпки, торпедные аппараты
    b.spar(C.dark, 15, 11.5, 0, 15, 0.32, -0.05).box(C.dark, 14.5, 21, 0, 0.4, 0.4, 8).mark('mast', 14.4, 26.4, 0);
    b.spar(C.dark, -27, 8.6, 0, 9, 0.25, -0.05);
    b.mount(C.gun, C.dark, 39, 6.2, 3.4, 1).mount(C.gun, C.dark, -29, 8.6, 3.2, -1).mount(C.gun, C.dark, -44, 5, 3.4, -1);
  },
  cruiser(b, C) {
    b.hull(C.hull, C.deck, 180, 20, 7, { bow: 0.33, stern: 0.5, sheer: 3.2 });
    b.box(C.sup, 28, 7, 0, 28, 7, 13).box(C.sup, 31, 14, 0, 15, 6, 10).windows(C.dark, 31.5, 18.2, 0, 14.6, 10).cyl(C.sup, 31, 20, 0, 2.8, 9, 6, 2.2).box(C.dark, 31, 29, 0, 4, 2, 9);
    b.funnel(C.sup, C.dark, 6, 7, 0, 3.7, 14, 3.2).funnel(C.sup, C.dark, -13, 7, 0, 3.7, 13, 3.2);
    b.box(C.sup, -40, 7, 0, 24, 5.5, 11).cyl(C.sup, -38, 12.5, 0, 2, 8, 6, 1.6);
    for (const z of [-6.6, 6.6]) for (const x of [-6, -18]) b.box(0xa9a79c, x, 8.2, z, 7, 1.3, 2);
    b.spar(C.dark, 24, 20, 0, 16, 0.4, -0.04).spar(C.dark, -32, 12.5, 0, 18, 0.4, -0.04).box(C.dark, -32.6, 26, 0, 0.4, 0.4, 9).mark('mast', 23.4, 36, 0);
    b.cyl(C.gun, 48, 7, 0, 4.2, 4, 8);
    b.mount(C.gun, C.dark, 64, 8.6, 6.2, 1, 2).mount(C.gun, C.dark, 48, 11, 6.2, 1, 2);
    b.mount(C.gun, C.dark, -58, 12.5, 6, -1, 2).mount(C.gun, C.dark, -73, 7, 6.2, -1, 2);
    b.mount(C.gun, C.dark, 2, 7, 2.6, 1, 1, 7.6).mount(C.gun, C.dark, 2, 7, 2.6, 1, 1, -7.6);
  },
  minelayer(b, C) {
    b.hull(C.hull, C.deck, 80, 11, 4, { bow: 0.3, stern: 0.9, sheer: 1.8 });
    b.box(C.sup, 16, 4, 0, 13, 5.5, 8).box(C.sup, 17, 9.5, 0, 7, 2.6, 6).windows(C.dark, 17.2, 10.8, 0, 6.6, 6).funnel(C.sup, C.dark, 3, 4, 0, 2, 8.5, 1.7);
    b.spar(C.dark, 12, 9.5, 0, 11, 0.28, -0.05).box(C.dark, 11.6, 16, 0, 0.35, 0.35, 6).mark('mast', 11.5, 20.5, 0);
    for (const z of [-2.6, 2.6]) {
      b.box(C.dark, -22, 4, z, 32, 0.45, 0.5);
      for (let i = 0; i < 5; i++) b.cyl(C.dark, -34 + i * 5.6, 4.45, z, 0.95, 1.5, 6, 0.6);
    }
    b.mount(C.gun, C.dark, 30, 4.8, 2.4, 1);
  },
  tanker(b, C) {
    b.hull(0x2f3337, C.rust, 140, 18, 5, { bow: 0.24, stern: 0.7, sheer: 1.4, keel: 2 });
    b.box(C.sup, -52, 5, 0, 20, 9, 14).box(C.sup, -50, 14, 0, 10, 2.8, 11).windows(C.dark, -50, 15.3, 0, 9.6, 11).funnel(C.sup, C.dark, -57, 14, 0, 2.6, 7.5, 2.2);
    for (let i = 0; i < 3; i++) b.windows(C.dark, -52, 6.5 + i * 2.4, 0, 19.6, 13.6);
    b.box(C.sup, 10, 5, 0, 10, 8.5, 13).box(C.sup, 10, 13.5, 0, 6, 2.6, 9).windows(C.dark, 10, 14.8, 0, 5.6, 9).mark('mast', 44, 21, 0);
    b.box(C.gun, -10, 7, 0, 112, 0.5, 1.6);
    for (let i = 0; i < 7; i++) if (i !== 4) b.cyl(C.gun, -34 + i * 11.5, 5, 0, 1.9, 1.1, 6);
    b.spar(C.dark, 44, 5.8, 0, 15, 0.35).spar(C.dark, -24, 5, 0, 15, 0.35).box(C.sup, 60, 6.2, 0, 14, 2, 9);
  },
  submarine(b, C) {
    b.hull(C.hull, C.dark, 72, 6.4, 1.5, { bow: 0.38, stern: 0.12, keel: 1.4, sheer: 0.7 });
    b.box(C.sup, 3, 1.5, 0, 10, 4.6, 3).box(C.sup, 2, 6.1, 0, 5.5, 1.3, 2.4);
    b.spar(C.dark, 3, 7.4, 0, 4.5, 0.16).spar(C.dark, 0.8, 7.4, 0, 3, 0.16).mark('mast', 3, 11.8, 0);
    b.mount(C.gun, C.dark, 14, 1.7, 1.5, 1);
    b.box(C.dark, -2, 1.5, 0, 46, 0.35, 2.6);
  },
  battery(b, C) {
    for (const z of [-11, 11]) {
      b.cyl(SAND, 0, 0, z, 9.5, 3.2, 8, 7.2);
      b.box(C.gun, 0.5, 3.2, z, 3.2, 2.6, 5).bar(C.dark, 2, 4.6, z, 8.5, 0.34, 1, 0.22).mark('muzzle', 10.2, 6.5, z);
    }
    b.box(EARTH, -5, 0, 0, 9, 2.4, 9).box(C.cargo, -5, 2.4, 0, 6, 1.2, 6);
    b.spar(C.dark, -8, 0, 4, 9, 0.18);
  },
  fort(b, C) {
    b.cyl(CONCRETE, 0, 0, 0, 30, 9, 8, 26).box(CONCRETE, -2, 9, 0, 24, 5, 36);
    for (const z of [-11, 11]) b.cyl(C.dark, 2, 14, z, 5, 3, 8, 4).bar(C.dark, 5, 15.3, z - 1, 11, 0.42, 1, 0.15).bar(C.dark, 5, 15.3, z + 1, 11, 0.42, 1, 0.15);
    for (const z of [-15, -5, 5, 15]) b.box(C.dark, 26.6, 3.4, z, 1.4, 1.6, 4.2);
    b.box(C.dark, -6, 14, 0, 5, 3.2, 5).spar(C.dark, -6, 17.2, 0, 10, 0.2);
    for (const z of [-11, 11]) b.mark('muzzle', 15.5, 17, z);
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
    b.box(C.sup, 2, 3, 0, 9, 3.4, 4.6).box(C.sup, 3, 6.4, 0, 4.4, 1.8, 3.6).windows(C.dark, 3.2, 7.2, 0, 4, 3.6).funnel(C.sup, C.dark, -4.5, 3, 0, 0.9, 3.6, 0.7);
    b.spar(C.dark, 1.5, 8.2, 0, 7, 0.16, -0.06).box(C.dark, 1.2, 12.6, 0, 0.25, 0.25, 3.6).mark('mast', 1.1, 15.1, 0);
    b.mount(C.gun, C.dark, 11.5, 3.6, 1.7, 1);
    b.box(C.gun, -13, 3, 1.6, 4, 1.1, 1.2).box(C.gun, -13, 3, -1.6, 4, 1.1, 1.2);
  },
  transport(b, C) {
    b.hull(C.hull, C.deck, 120, 16, 6, { bow: 0.26, stern: 0.66, sheer: 1.6, keel: 2 });
    b.box(C.hull, 50, 6.3, 0, 16, 2.3, 9).box(C.hull, -51, 6, 0, 16, 2.4, 13);
    b.box(C.sup, -4, 6, 0, 24, 7.5, 12.5).box(C.sup, -1, 13.5, 0, 12, 2.8, 10).windows(C.dark, -0.6, 14.9, 0, 11.6, 10).funnel(C.sup, C.dark, -8, 13.5, 0, 2.7, 8.5, 2.4);
    for (let i = 0; i < 2; i++) b.windows(C.dark, -4, 8 + i * 2.6, 0, 23.6, 12.1);
    for (const z of [-6.6, 6.6]) b.box(0xb9b7ae, -10, 13.6, z, 6, 1.1, 1.6);
    b.mark('mast', 37.5, 23, 0);
    for (const x of [28, -30]) {
      b.box(C.cargo, x, 6, 0, 16, 1.5, 9).spar(C.dark, x + 9.5, 6, 0, 17, 0.4);
      b.spar(C.dark, x + 9.5, 9, 0, 14, 0.2, -0.9).spar(C.dark, x + 9.5, 9, 0, 9, 0.2, 0.9);
    }
  },
};

const geoCache = new Map();   // 'kind:F|E' → { geometry, size, marks }
let shipMat = null, landMat = null, wakeGeo = null, wakeMat = null, blobTex = null;

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
    if (kind === 'patrol') b.cyl(BAND, -4.5, 5.2, 0, 0.93, 0.9, 6, 0.75);
  }
  const geometry = b.build(), bb = geometry.boundingBox;
  m = { geometry, marks: b.marks, size: { length: +(bb.max.x - bb.min.x).toFixed(1), beam: +(bb.max.z - bb.min.z).toFixed(1), height: +bb.max.y.toFixed(1) } };
  geoCache.set(key, m);
  return m;
}

// Корпус: вершинные цвета + в шейдере — тёмная полоса ватерлинии (сурик), грязь и потёки ржавчины книзу, разнотон листов.
// Координаты модели — метры натуры, поэтому узор не зависит от масштаба, с которым пост ставит корабль.
function patchHull(m, waterline) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float y = vObj.y;
        float pl = fract(sin(dot(floor(vec2(vObj.x * 0.33, (vObj.y + vObj.z) * 0.5)), vec2(12.9898, 78.233))) * 43758.5453);
        float st = fract(sin(floor(vObj.x * 1.7 + vObj.z * 0.3) * 91.7) * 4375.85);
        diffuseColor.rgb *= 0.92 + 0.1 * pl;
        diffuseColor.rgb *= mix(0.74, 1.05, clamp(y / 10.0, 0.0, 1.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.78, 0.6, 0.48), st * st * 0.45 * smoothstep(5.0, 0.8, y) * step(0.7, y));
        ${waterline ? `diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.19, 0.075, 0.055), smoothstep(0.8, 0.55, y));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.06, 0.065), smoothstep(0.05, -0.3, y));` : ''}
      }`);
  };
  m.customProgramCacheKey = () => (waterline ? 'arta-hull-w' : 'arta-hull-l');
  return m;
}
function sharedShipMat(land) {
  if (land) return landMat || (landMat = patchHull(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), false));
  return shipMat || (shipMat = patchHull(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), true));
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
  // пена тает к хвосту следа и рвётся на клочья
  wakeMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
        { float n = fract(sin(dot(floor(vObj.xz * vec2(40.0, 160.0)), vec2(12.9898, 78.233))) * 43758.5453);
          diffuseColor.a *= smoothstep(-1.5, -0.2, vObj.x) * (0.55 + 0.45 * n) * (0.6 + 0.4 * smoothstep(0.0, 0.01, vObj.y + 0.004)); }`);
  };
  wakeMat.customProgramCacheKey = () => 'arta-wake';
  return wakeGeo;
}

function smokeSprite(color, additive) {
  const m = new THREE.SpriteMaterial({ map: blob(), color, transparent: true, opacity: 0, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  const s = new THREE.Sprite(m);
  s.visible = false;
  return s;
}

// свой генератор: украшения не трогают Math.random (игра и замеры с зерном остаются повторяемыми)
let rs = 0x9e3779b9;
const rnd = () => { rs = (rs + 0x6d2b79f5) | 0; let t = Math.imul(rs ^ (rs >>> 15), 1 | rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const _v = new THREE.Vector3();
// частицы (seasky PK): 0 дым, 1 вода, 2 свечение
function toFx(obj, group, x, y, z) {
  obj.localToWorld(_v.set(x, y, z));
  const par = group.parent;
  if (par && !par.isScene) par.worldToLocal(_v);
  return _v;
}

export function makeShip(kind, opts = {}) {
  const k = shipKind({ kind });
  const friendly = !!opts.friendly || k === 'patrol';
  const { geometry, size, marks } = modelFor(k, friendly);
  const land = !!LAND[k];
  const big = kind === 'battleship' ? 1.22 : 1;            // линкор — тот же силуэт крейсера, но крупнее
  const L = size.length * big, H = size.height * big, Bm = size.beam * big;
  const group = new THREE.Group();
  group.name = 'ship:' + k;
  const body = new THREE.Group();                          // тонет и кренится он, а не group: её ставит вызывающий
  const mesh = new THREE.Mesh(geometry, sharedShipMat(land));
  body.add(mesh); body.scale.setScalar(big);
  group.add(body);
  const st = { burning: false, sinking: 0, list: 0, wake: 0 };
  const seed = (k.length * 37 + (opts.seed || 0) * 17) % 7;
  const pitchDir = seed % 2 ? 1 : -1;
  let fx = null, wk = null;                                // огонь/дым и след создаются при первой надобности
  const own = [];
  const acc = { smoke: 0, fire: 0, ember: 0, bubble: 0, fun: 0 };
  // точка пожара: ближе к миделю, на палубе
  const fireAt = [-L * 0.08 / big, H * (land ? 0.45 : 0.32) / big, 0];

  function ensureFx() {
    if (fx) return;
    fx = new THREE.Group();
    fx.fire = smokeSprite(0xff8a22, false);
    fx.smoke = [smokeSprite(0x24211f, false), smokeSprite(0x2e2a27, false), smokeSprite(0x383431, false)];
    fx.add(fx.fire, ...fx.smoke);
    own.push(fx.fire.material, ...fx.smoke.map((s) => s.material));
    group.add(fx);
  }
  let usesParticles = false;
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
    if (!usesParticles && (st.burning || s > 0)) ensureFx();
    if (fx) fx.visible = !usesParticles && (st.burning || s > 0);
  }
  function particles(dt, time, P) {
    const s = st.sinking, alive = land ? 1 - 0.5 * s : 1 - s, sc = group.scale.x * big;
    if (!(dt > 0)) dt = 0;
    group.updateMatrixWorld(true);
    // дым из труб на ходу
    if (st.wake > 0.02 && !st.burning && s <= 0 && marks.funnel.length) {
      acc.fun += dt * 1.1 * marks.funnel.length;
      while (acc.fun >= 1) {
        acc.fun -= 1;
        const f = marks.funnel[Math.floor(rnd() * marks.funnel.length)], p = toFx(body, group, f[0], f[1], f[2]);
        const g = friendly ? 0.55 : 0.3;
        P.emit(0, p.x, p.y, p.z, 0, 2.5 * sc, 0, 4.5 * sc, 3.2, 6 + 2 * rnd(), g, g * 0.98, g * 0.95, 0.45, 0, -0.3 * sc, 0.5, 0.9);
      }
    }
    if (st.burning || s > 0) {
      const fp = toFx(body, group, fireAt[0], fireAt[1], fireAt[2]), fx0 = fp.x, fy0 = fp.y, fz0 = fp.z;
      // пламя: огненные клубы, которые темнеют в дым (огонь «подсвечивает» дым снизу)
      acc.fire += dt * 7 * alive;
      while (acc.fire >= 1) {
        acc.fire -= 1;
        P.emit(0, fx0 + (rnd() - 0.5) * L * 0.12 * group.scale.x, fy0, fz0 + (rnd() - 0.5) * Bm * 0.5 * group.scale.x, 0, (3 + 3 * rnd()) * sc, 0,
          L * 0.07 * group.scale.x, 1.5, 1.4 + rnd() * 0.6, 1.9, 0.95, 0.35, 0.9, 2, -0.5 * sc, 0.6, 0.4, 1);
      }
      acc.smoke += dt * 3.2 * (0.35 + 0.65 * alive);
      while (acc.smoke >= 1) {
        acc.smoke -= 1;
        const g = 0.08 + 0.06 * rnd();
        P.emit(0, fx0 + (rnd() - 0.5) * L * 0.1 * group.scale.x, fy0 + L * 0.04 * group.scale.x, fz0, 0, (4 + 2 * rnd()) * sc, 0,
          L * 0.1 * group.scale.x, 3.5, 7 + 3 * rnd(), g, g * 0.95, g * 0.9, 0.8, 0, -0.2 * sc, 0.35, 0.8);
      }
      acc.ember += dt * 6 * alive;
      while (acc.ember >= 1) {
        acc.ember -= 1;
        P.emit(2, fx0, fy0 + 2 * sc, fz0, (rnd() - 0.5) * 6 * sc, (6 + 8 * rnd()) * sc, (rnd() - 0.5) * 6 * sc, 1.6 * sc, 0, 1 + rnd(), 1.8, 0.8, 0.25, 1, 1, 2 * sc, 0.4, 0.2, 1);
      }
      // тонет: пузыри и пена у борта, пар
      if (!land && s > 0 && s < 1) {
        acc.bubble += dt * 8;
        while (acc.bubble >= 1) {
          acc.bubble -= 1;
          const p = toFx(group, group, (rnd() - 0.5) * L, 0, (rnd() - 0.5) * Bm * 1.4);
          P.emit(1, p.x, 1, p.z, 0, (2 + 4 * rnd()) * sc, 0, 2.5 * sc, 1.5, 1.2 + rnd(), 0.85, 0.9, 0.92, 0.7, 3, 4 * sc, 0.3);
        }
        if (rnd() < dt * 1.5) {
          const p = toFx(group, group, (rnd() - 0.5) * L * 0.5, 2, 0);
          P.emit(0, p.x, p.y, p.z, 0, 3 * sc, 0, L * 0.08 * group.scale.x, 2.5, 5, 0.8, 0.82, 0.84, 0.35, 0, 0, 0.4, 0.8);
        }
      }
    }
    // ходовые огни ночью (свои — ярче; противник идёт затемнённым — огни тусклые)
    if (group.userData.night && !land && s <= 0) {
      const a = friendly ? 1 : 0.45, m = marks.mast[0], sz = 9 * group.scale.x;
      if (m) { const p = toFx(body, group, m[0], m[1], m[2]); P.put(2, p.x, p.y, p.z, sz, 1.6 * a, 1.6 * a, 1.5 * a, 1, 1); }
      const bx = L * 0.12 / big, by = H * 0.45 / big, bz = Bm * 0.5 / big;
      let p = toFx(body, group, bx, by, -bz); P.put(2, p.x, p.y, p.z, sz, 1.8 * a, 0.25 * a, 0.2 * a, 1, 1);
      p = toFx(body, group, bx, by, bz); P.put(2, p.x, p.y, p.z, sz, 0.25 * a, 1.6 * a, 0.5 * a, 1, 1);
    }
    void time;
  }

  group.userData.kind = k;
  group.userData.land = land;
  group.userData.size = { length: L, beam: Bm, height: H };
  group.userData.state = st;
  group.userData.night = false;
  group.userData.muzzles = marks.muzzle.map((m) => [m[0] * big, m[1] * big, m[2] * big]);
  group.userData.setState = (o) => {
    if (!o) return;
    if (o.burning != null) st.burning = !!o.burning;
    if (o.sinking != null) st.sinking = Math.max(0, Math.min(1, +o.sinking || 0));
    if (o.list != null) st.list = +o.list || 0;
    if (o.wake != null) st.wake = +o.wake || 0;
    apply();
  };
  group.userData.update = (dt, time, P) => {
    if (P) {
      if (!usesParticles) { usesParticles = true; if (fx) fx.visible = false; }
      particles(dt, time, P);
      return;
    }
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
let planeGeo = null, planeMat = null, propGeo = null, propMat = null;
function planeGeometry() {
  if (planeGeo) return planeGeo;
  const b = new Builder(), body = 0x3c4439, dark = 0x1d2023, belly = 0x7e8a92, mark = 0xb8b2a0;
  b.geo(new THREE.CylinderGeometry(0.75, 0.3, 11, 8), body, -0.5, 0, 0, 0, 0, -Math.PI / 2);        // фюзеляж: нос толще
  b.geo(new THREE.CylinderGeometry(0.5, 0.78, 1.2, 8), dark, 5.6, 0, 0, 0, 0, -Math.PI / 2);        // капот
  b.geo(new THREE.ConeGeometry(0.3, 0.7, 6), dark, 6.5, 0, 0, 0, 0, -Math.PI / 2);                  // кок винта
  b.box(body, 1.4, -0.5, 0, 2.7, 0.22, 14).box(belly, 1.4, -0.56, 0, 2.5, 0.06, 13.6);               // крыло
  b.box(mark, 1.4, -0.38, 5.2, 1.6, 0.04, 1.6).box(mark, 1.4, -0.38, -5.2, 1.6, 0.04, 1.6);          // опознавательные знаки
  b.box(body, -5.2, 0.1, 0, 1.4, 0.14, 4.6).box(body, -5.4, 0.2, 0, 1.6, 1.9, 0.14);                 // оперение
  b.box(0x9fb4c0, 1.2, 0.6, 0, 2.6, 0.6, 0.8);                                                       // фонарь
  b.box(dark, 1.2, -1.1, 0, 2.4, 0.5, 0.5);                                                          // бомба под брюхом
  planeGeo = b.build();
  planeMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  // диск винта: полупрозрачный, с размытыми лопастями
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, 'rgba(40,40,40,0.5)'); g.addColorStop(0.85, 'rgba(40,40,40,0.28)'); g.addColorStop(1, 'rgba(40,40,40,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  x.fillStyle = 'rgba(20,20,20,0.35)';
  for (let i = 0; i < 3; i++) { x.save(); x.translate(32, 32); x.rotate(i * 2.094); x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, 31, -0.12, 0.25); x.closePath(); x.fill(); x.restore(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  propGeo = new THREE.CircleGeometry(1.9, 18); propGeo.rotateY(Math.PI / 2);
  propMat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  return planeGeo;
}

/** opts: { material } — свой материал корпуса (например, seasky.createLitColorMaterial для зенитки). */
export function makePlane(opts = {}) {
  const group = new THREE.Group();
  group.name = 'plane';
  const body = new THREE.Group();
  body.add(new THREE.Mesh(planeGeometry(), opts.material || planeMat));
  const prop = new THREE.Mesh(propGeo, propMat);
  prop.position.x = 6.45; prop.renderOrder = 2;
  body.add(prop);
  group.add(body);
  const st = { burning: false, down: 0 };
  let trail = null, killed = false, acc = 0;
  const own = [];
  group.userData.size = { length: 12, span: 14, height: 2.8 };
  group.userData.state = st;
  group.userData.setState = (o) => {
    if (!o) return;
    if (o.burning != null) st.burning = !!o.burning;
    if (o.down != null) st.down = Math.max(0, Math.min(1, +o.down || 0));
    body.rotation.z = -st.down * 0.9; body.rotation.x = st.down * 2.5;
    if (st.down <= 0) killed = false;
    if (trail) for (const s of trail) s.visible = st.burning && !group.userData.particles;
  };
  /** P — пул частиц (seasky) в системе координат родителя: дымный след, огненный шар при сбитии. */
  group.userData.update = (dt, time, P) => {
    prop.rotation.x = time * 47;
    if (P) {
      group.userData.particles = true;
      if (trail) for (const s of trail) s.visible = false;
      const sc = group.scale.x;
      group.updateMatrixWorld(true);
      if (st.down > 0 && !killed) {
        killed = true;
        const p = toFx(body, group, 0, 0, 0);
        P.emit(2, p.x, p.y, p.z, 0, 0, 0, 13 * sc, 0.8, 0.35, 1.6, 1.0, 0.5, 1, 1, 0, 0, 0, 1);
        for (let i = 0; i < 6; i++) P.emit(0, p.x + (rnd() - 0.5) * 8 * sc, p.y + (rnd() - 0.5) * 6 * sc, p.z + (rnd() - 0.5) * 8 * sc, (rnd() - 0.5) * 8 * sc, (rnd() - 0.3) * 8 * sc, (rnd() - 0.5) * 8 * sc,
          12 * sc, 1.8, 2.2 + rnd(), 1.9, 0.9, 0.3, 1, 2, 0, 1, 0, 1);
      }
      if (st.burning && dt > 0) {
        acc += dt * 14;
        while (acc >= 1) {
          acc -= 1;
          const p = toFx(body, group, -1.5 - rnd() * 2, 0.2, 0);
          const g = 0.1 + 0.08 * rnd();
          P.emit(0, p.x, p.y, p.z, 0, 0.5 * sc, 0, 3.2 * sc, 3.5, 2.6 + rnd(), g, g, g * 0.95, 0.75, 0, 0, 0.3, 0.5);
          if (rnd() < 0.5) P.emit(2, p.x, p.y, p.z, 0, 0, 0, 3.4 * sc, 0.2, 0.25, 1.9, 0.9, 0.3, 1, 1, 0, 0, 0, 1);
        }
      }
      return;
    }
    if (st.burning && !trail) {
      trail = [smokeSprite(0xff7a20, true), smokeSprite(0x1f1d1c, false), smokeSprite(0x2a2726, false)];
      trail.forEach((s) => { group.add(s); own.push(s.material); });
    }
    if (!trail || !st.burning) return;
    for (const s of trail) s.visible = true;
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

export function createFleet(game, parent, opts = {}) {
  const map = new Map();          // id цели (число) / своего (строка) → { group, kind, stamp }
  let stamp = 0, placeFn = null, dtNow = 0, timeNow = 0;
  const api = { shown: 0, entries: map, sync, clear, dispose: clear };
  const P = opts.fx || null;

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
    g.userData.update(dtNow, timeNow, P);
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
    if (wakeMat) wakeMat.opacity = s.mission && s.mission.night ? 0.3 : s.mission && s.mission.weather === 'fog' ? 0.6 : 0.8;
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

export function createAirWing(game, parent, opts = {}) {
  const pool = [];                // { group, id }
  const api = { shown: 0, pool, sync, clear, dispose: clear };
  const _ps = { burning: false, down: 0 };
  const P = opts.fx || null;
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
      if (en.group.visible) { en.group.userData.update(dt, time, P); api.shown++; }
    }
    for (let i = n; i < pool.length; i++) pool[i].group.visible = false;
  }
  function clear() { pool.forEach((en) => { parent.remove(en.group); en.group.userData.dispose(); }); pool.length = 0; api.shown = 0; }
  return api;
}
