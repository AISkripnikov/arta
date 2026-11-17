// Задания кампании, типы целей и генерация карты.

/** Детерминированный ГПСЧ (для карты). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MAP = 20; // км

// gun: { range (км), period (с), dmg, p } — ответный огонь по батарее
export const KINDS = {
  barge:      { name: 'Баржа',             site: 'sea',    armored: false, hp: 1, radius: 0.07, speed: 0 },
  depot:      { name: 'Склад на острове',  site: 'island', armored: false, hp: 1, radius: 0.07, speed: 0 },
  battery:    { name: 'Береговая батарея', site: 'island', armored: false, hp: 2, radius: 0.06, speed: 0, gun: { range: 99, period: 32, dmg: 5, p: 0.4 } },
  bunker:     { name: 'Бетонный ДОТ',      site: 'island', armored: true,  hp: 2, radius: 0.05, speed: 0, gun: { range: 99, period: 45, dmg: 4, p: 0.4 } },
  transport:  { name: 'Транспорт',         site: 'sea',    armored: false, hp: 2, radius: 0.08, speed: 14, end: 'escape' },
  landing:    { name: 'Десантные катера',  site: 'sea',    armored: false, hp: 1, radius: 0.08, speed: 28, end: 'land' },
  destroyer:  { name: 'Эсминец',           site: 'sea',    armored: false, hp: 2, radius: 0.07, speed: 24, end: 'patrol', gun: { range: 13, period: 30, dmg: 4, p: 0.4 } },
  cruiser:    { name: 'Крейсер',           site: 'sea',    armored: true,  hp: 3, radius: 0.09, speed: 18, end: 'patrol', gun: { range: 17, period: 34, dmg: 6, p: 0.4 } },
  battleship: { name: 'Линкор',            site: 'sea',    armored: true,  hp: 4, radius: 0.11, speed: 12, end: 'patrol', gun: { range: 21, period: 40, dmg: 7, p: 0.4 } },
};

// range — км от батареи; bearing — ° (сектор от и до, по часовой; допускается переход через 0)
export const CAMPAIGN = [
  {
    id: 'm1', name: 'Пристрелка', seed: 11, tutorial: true, shells: { he: 8, ap: 0 },
    targets: [{ kind: 'barge', range: [6.2, 7.6], bearing: [340, 25] }],
    brief: 'Учебная стрельба по брошенной барже. Противника нет, спешить некуда.\n\nПройдите всю процедуру по постам слева направо: ПЛАНШЕТ → ВЫЧИСЛИТЕЛЬ → ЗАРЯЖАНИЕ → ПОВОРОТ → ПОДЪЁМ → ОГОНЬ. Подсказка внизу экрана скажет, что делать дальше.',
  },
  {
    id: 'm2', name: 'Два ориентира', seed: 22, shells: { he: 10, ap: 0 },
    targets: [{ kind: 'barge', range: [4.5, 7.5], bearing: [300, 350] }, { kind: 'depot', range: [9.5, 13] }],
    brief: 'Две цели на разных дальностях. Для каждой — свой заряд: лампы на вычислителе покажут, какие заряды достают.\n\nПосле разрыва корректировщик сообщит отклонение. Перелёт — уменьшайте дальность на вычислителе и пересчитывайте угол. Ушло вправо — доверните башню влево.',
  },
  {
    id: 'm3', name: 'Бетон', seed: 33, shells: { he: 6, ap: 6 },
    targets: [{ kind: 'bunker', range: [8, 12] }, { kind: 'depot', range: [9, 14] }],
    brief: 'На острове — бетонный ДОТ, он ведёт огонь по батарее. Фугасный снаряд его не берёт: нужен бронебойный (ББ) и прямое попадание.\n\nСледите за прочностью батареи.',
  },
  {
    id: 'm4', name: 'Конвой', seed: 44, shells: { he: 12, ap: 0 },
    targets: [{ kind: 'transport', range: [8, 11], bearing: [320, 40], path: 11 }, { kind: 'barge', range: [5, 8] }],
    brief: 'Транспорт противника идёт вдоль берега. Разведка сообщает его координаты, курс и скорость.\n\nСтреляйте с упреждением: наводитесь в точку, где цель окажется через время подготовки и полёта снаряда. Секундомер и время полёта — на посту ОГОНЬ и вычислителе. Уйдёт — задание провалено.',
  },
  {
    id: 'm5', name: 'Десант', seed: 55, shells: { he: 14, ap: 0 },
    targets: [{ kind: 'landing', range: [9.5, 11], bearing: [325, 355] }, { kind: 'landing', range: [10.5, 12], bearing: [5, 35] }],
    brief: 'Две группы десантных катеров идут к нашему берегу. Каждая минута на счету: высадятся — батарея потеряна.\n\nКатера быстрые, упреждение берите с запасом.',
  },
  {
    id: 'm6', name: 'Дуэль', seed: 66, shells: { he: 12, ap: 4 },
    targets: [{ kind: 'destroyer', range: [9, 12], bearing: [330, 30], path: 6 }, { kind: 'battery', range: [10, 14] }],
    brief: 'Эсминец и береговая батарея на острове ведут по вам огонь. Эсминец ходит галсами — следите за сменой курса в донесениях.\n\nРешайте, кого подавить первым.',
  },
  {
    id: 'm7', name: 'Ночной конвой', seed: 77, shells: { he: 12, ap: 8 },
    targets: [{ kind: 'cruiser', range: [11, 14], bearing: [340, 20], path: 7 }, { kind: 'transport', range: [9, 12], bearing: [300, 340], path: 12 }, { kind: 'transport', range: [10, 13], bearing: [20, 60], path: 12 }],
    brief: 'Конвой под охраной крейсера. Крейсер бронирован — по нему только бронебойными. Транспорты нельзя упустить.',
  },
  {
    id: 'm8', name: 'Линкор', seed: 88, shells: { he: 10, ap: 12 },
    targets: [{ kind: 'battleship', range: [14, 17], bearing: [345, 15], path: 6 }, { kind: 'destroyer', range: [9, 12], bearing: [300, 340], path: 6 }, { kind: 'bunker', range: [8, 13] }],
    brief: 'К берегу подошёл линкор. Его главный калибр разнесёт батарею за считанные минуты.\n\nПредельные дальности, шестой заряд, бронебойные. Всё, чему вы научились.',
  },
];

export function skirmishDef(difficulty) {
  const pool = ['barge', 'depot', 'transport', 'battery', 'destroyer', 'bunker', 'landing', 'cruiser'];
  const n = 2 + Math.floor(Math.random() * 2), targets = [];
  for (let i = 0; i < n; i++) {
    const kind = pool[Math.floor(Math.random() * (difficulty ? pool.length : 5))];
    const r0 = 5 + Math.random() * 9;
    targets.push({ kind, range: [r0, r0 + 2], path: 8 });
  }
  return {
    id: 'skirmish', name: 'Свободный бой', seed: Math.floor(Math.random() * 1e9), skirmish: true,
    shells: { he: 12, ap: 8 }, targets,
    brief: 'Случайная боевая задача. Уничтожьте все цели.',
  };
}

const ISLAND_NAMES = ['о. Каменный', 'о. Чаячий', 'о. Долгий', 'о. Сторожевой', 'о. Малый', 'о. Туманный'];

/** Карта: наш берег на юге, острова в море. Все величины — км. */
export function makeMap(seed) {
  const r = rng(seed * 7919 + 17);
  const ph = [r() * 6.28, r() * 6.28, r() * 6.28];
  const coastY = (x) => 2.7 + 0.55 * Math.sin(x * 0.42 + ph[0]) + 0.3 * Math.sin(x * 1.13 + ph[1]) + 0.12 * Math.sin(x * 2.7 + ph[2]);
  const coast = [];
  for (let x = 0; x <= MAP + 1e-9; x += 0.25) coast.push(Math.round(coastY(x) * 1000) / 1000);
  const islands = [], names = ISLAND_NAMES.slice();
  let guard = 0;
  while (islands.length < 4 && guard++ < 400) {
    const isl = { x: 2.5 + r() * 15, y: 8 + r() * 9.5, rx: 0.55 + r() * 0.7, ry: 0.4 + r() * 0.45, rot: r() * Math.PI };
    if (islands.some((o) => Math.hypot(o.x - isl.x, o.y - isl.y) < 3.2)) continue;
    isl.name = names.splice(Math.floor(r() * names.length), 1)[0];
    isl.x = Math.round(isl.x * 100) / 100; isl.y = Math.round(isl.y * 100) / 100;
    islands.push(isl);
  }
  const bx = Math.round((8 + r() * 4) * 100) / 100;
  const battery = { x: bx, y: Math.round((coastY(bx) - 0.35) * 100) / 100 };
  return { seed, coast, coastStep: 0.25, islands, battery };
}

export function coastAt(map, x) {
  const i = Math.max(0, Math.min(map.coast.length - 2, Math.floor(x / map.coastStep)));
  const f = Math.max(0, Math.min(1, x / map.coastStep - i));
  return map.coast[i] + (map.coast[i + 1] - map.coast[i]) * f;
}

export function isLand(map, x, y) {
  if (y < coastAt(map, x)) return true;
  for (const o of map.islands) {
    const c = Math.cos(-o.rot), s = Math.sin(-o.rot), dx = x - o.x, dy = y - o.y;
    const u = (dx * c - dy * s) / o.rx, v = (dx * s + dy * c) / o.ry;
    if (u * u + v * v <= 1) return true;
  }
  return false;
}
