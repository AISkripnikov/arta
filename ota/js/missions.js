/* Описание кампании и генератор боевых задач. */
(function (root) {
  'use strict';
  var B = root.Ballistics, MIL = B.MIL;

  var TYPES = {
    infantry: { name: 'Пехота в окопах', r: 35, hp: 1, icon: 'П' },
    mortar:   { name: 'Миномётный расчёт', r: 25, hp: 1, icon: 'М' },
    mg:       { name: 'Пулемётное гнездо', r: 18, hp: 1, icon: 'Г' },
    depot:    { name: 'Склад боеприпасов', r: 25, hp: 1, icon: 'С' },
    hq:       { name: 'Штаб', r: 20, hp: 2, icon: 'Ш' },
    battery:  { name: 'Артиллерийская батарея', r: 25, hp: 2, icon: 'А' },
    bunker:   { name: 'ДОТ', r: 14, hp: 2, icon: 'Д' },
    convoy:   { name: 'Колонна грузовиков', r: 30, hp: 1, icon: 'К', moving: true }
  };

  var CAMPAIGN = [
    {
      name: 'Первый выстрел', seed: 101, relief: 0, observer: 'gun', report: 'grid', wind: [0, 0],
      targets: [{ type: 'infantry', dist: [2200, 3000] }], ammo: 12, threat: 5,
      brief: 'Учебная стрельба. Местность ровная, ветра нет, наблюдатель находится рядом с орудием.' +
        '<ol><li>На <b>Карте</b> линейкой 📏 измерьте дальность и азимут от орудия до цели.</li>' +
        '<li>В <b>Таблицах</b> выберите заряд, которому хватает дальности, и найдите прицел для вашей дальности.</li>' +
        '<li>На вкладке <b>Орудие</b> установите угломер, прицел и заряд — и дайте огонь.</li>' +
        '<li>Наблюдатель сообщит отклонение разрыва. Внесите поправку и стреляйте снова.</li></ol>'
    },
    {
      name: 'Пристрелка', seed: 202, relief: 0, observer: 'gun', report: 'grid', wind: [0, 0],
      targets: [{ type: 'mortar', dist: [3500, 4800] }, { type: 'mg', dist: [5200, 6500] }], ammo: 14, threat: 5,
      brief: 'Две цели на разных дальностях. Между строками таблицы прицел нужно <b>интерполировать</b>: ' +
        'если дальность 4 250 м, берите значение посередине между строками 4 200 и 4 300.<br><br>' +
        'Подсказка: столбец <b>ΔД/дел</b> показывает, на сколько метров сместится разрыв при изменении прицела на одно деление. ' +
        'Недолёт 120 м при ΔД/дел = 8 → прибавьте к прицелу 15 делений.<br><br>' +
        'Боковая поправка — по «правилу тысячной»: <b>дел. = метры ÷ дальность в км × 0,955</b>.'
    },
    {
      name: 'Высота 180', seed: 303, relief: 190, observer: 'gun', report: 'grid', wind: [0, 0],
      targets: [{ type: 'bunker', dist: [4200, 5500] }, { type: 'infantry', dist: [5800, 7000] }], ammo: 16, threat: 5,
      brief: 'Холмистая местность. Цели и орудие находятся на разной высоте — это меняет дальность падения снаряда.<br><br>' +
        'Вычислите <b>превышение</b> цели над орудием (высота цели − высота орудия) и добавьте к прицелу поправку из столбца ' +
        '<b>ΔП/10м</b> на каждые 10 м превышения. Если цель ниже орудия — поправку вычитают.<br><br>' +
        'Также учтите <b>деривацию</b>: снаряд уходит вправо, поэтому угломер уменьшают на табличное значение.'
    },
    {
      name: 'Глаза батареи', seed: 404, relief: 150, observer: 'offset', report: 'grid', wind: [0, 0],
      targets: [{ type: 'mortar', dist: [4500, 6000] }, { type: 'hq', dist: [6000, 7500] }], ammo: 18, threat: 5,
      brief: 'Наблюдательный пункт (НП) вынесен вперёд. Теперь наблюдатель сообщает отклонения <b>относительно своей линии ' +
        'наблюдения</b> «НП → цель», а не линии стрельбы.<br><br>' +
        '«Перелёт» — разрыв дальше цели от НП, «правее» — правее с точки зрения наблюдателя. ' +
        'Нанесите разрыв на карту меткой 📍 или пересчитайте отклонения на линию «орудие → цель».'
    },
    {
      name: 'Встречный ветер', seed: 505, relief: 150, observer: 'offset', report: 'grid', wind: [5, 9],
      targets: [{ type: 'depot', dist: [5000, 6500] }, { type: 'mg', dist: [6000, 7500] }, { type: 'infantry', dist: [7000, 8500] }], ammo: 20, threat: 4.5,
      brief: 'Метеосводка: ветер. Разложите его на составляющие относительно линии стрельбы:<br>' +
        '<b>встречная = W · cos(Aw − A)</b>, <b>боковая = W · sin(Aw − A)</b>, где Aw — откуда дует ветер, A — азимут стрельбы.<br><br>' +
        'Встречный ветер укорачивает дальность на <b>Wд</b> метров за каждый м/с (попутный — удлиняет). ' +
        'Боковой сносит снаряд на <b>Wб</b> делений за каждый м/с: ветер слева — снос вправо, угломер уменьшить.'
    },
    {
      name: 'Полярные координаты', seed: 606, relief: 170, observer: 'offset', report: 'polar', wind: [3, 7],
      targets: [{ type: 'battery', dist: [6000, 7500] }, { type: 'bunker', dist: [5000, 6500] }], ammo: 20, threat: 4.5,
      brief: 'Наблюдатель работает с дальномером и буссолью и даёт цели в <b>полярных координатах от НП</b>: азимут и дальность.<br><br>' +
        'Пересчитайте в прямоугольные:<br><b>X = Xнп + Д · sin(A)</b>, <b>Y = Yнп + Д · cos(A)</b>.<br>' +
        'Калькулятор считает sin и cos прямо в делениях угломера. Координаты НП — на вкладке «Рация».'
    },
    {
      name: 'Колонна', seed: 707, relief: 120, observer: 'offset', report: 'grid', wind: [2, 5],
      targets: [{ type: 'convoy', dist: [5500, 7000] }, { type: 'mg', dist: [4500, 6000] }], ammo: 22, threat: 4,
      brief: 'Обнаружена движущаяся колонна. Наблюдатель сообщает её координаты, курс и скорость.<br><br>' +
        'Стреляйте <b>с упреждением</b>: за время наводки и полёта снаряда (столбец <b>t</b>) колонна пройдёт ' +
        '<b>скорость × время</b> метров по своему курсу. Наводитесь в точку встречи. Если колонна уйдёт — задача провалена.'
    },
    {
      name: 'Контрбатарейная борьба', seed: 808, relief: 200, observer: 'offset', report: 'polar', wind: [4, 9],
      targets: [{ type: 'battery', dist: [7500, 9000] }, { type: 'battery', dist: [7000, 8800] }, { type: 'hq', dist: [6000, 7500] }], ammo: 22, threat: 6,
      brief: 'Батарея противника ведёт звуковую разведку. Каждый ваш выстрел выдаёт позицию — следите за шкалой ' +
        '<b>демаскировки</b>. Заполнится — вас накроют ответным огнём.<br><br>Предельные дальности, ветер, рельеф, полярные координаты. ' +
        'Считайте точно: снарядов на долгую пристрелку нет.'
    }
  ];

  function r10(v) { return Math.round(v / 10) * 10; }

  function skirmishDef(diff) {
    var pool = ['infantry', 'mortar', 'mg', 'depot', 'hq', 'battery', 'bunker'];
    var rnd = Math.random, n = 2 + Math.floor(rnd() * 3), targets = [];
    for (var i = 0; i < n; i++) {
      var d0 = 2500 + rnd() * 5000;
      targets.push({ type: pool[Math.floor(rnd() * pool.length)], dist: [d0, d0 + 1200] });
    }
    if (diff > 0 && rnd() < 0.35) targets[0] = { type: 'convoy', dist: [5000, 6800] };
    return {
      name: 'Свободный бой', seed: Math.floor(rnd() * 1e9), relief: diff === 0 ? 60 : 100 + rnd() * 120,
      observer: diff === 0 ? 'gun' : 'offset', report: diff === 2 && rnd() < 0.6 ? 'polar' : 'grid',
      wind: diff === 0 ? [0, 0] : [1, 9], targets: targets, ammo: n * 6 + 4, threat: 100 / (n * 6 + 6),
      brief: 'Случайная боевая задача. Уничтожьте все цели.', skirmish: true
    };
  }

  function generate(def) {
    var rnd = root.Terrain.rng(def.seed * 7 + 13);
    var T = root.Terrain.create(def.seed, def.relief);
    var S = T.size;
    var gun = { e: r10(1500 + rnd() * 1500), n: r10(1500 + rnd() * 1500) };
    gun.h = Math.round(T.height(gun.e, gun.n));
    var baseAz = B.azimuthMil(6500 - gun.e, 6500 - gun.n);

    var targets = [], tries = 0;
    def.targets.forEach(function (td, idx) {
      var ty = TYPES[td.type], pos = null;
      while (tries++ < 2000) {
        var az = baseAz + (rnd() - 0.5) * 900, d = td.dist[0] + rnd() * (td.dist[1] - td.dist[0]);
        var e = gun.e + d * Math.sin(az * MIL), n = gun.n + d * Math.cos(az * MIL);
        if (e < 700 || n < 700 || e > S - 700 || n > S - 700) continue;
        var ok = targets.every(function (t) { return Math.hypot(t.e - e, t.n - n) > 500; });
        if (ok) { pos = { e: r10(e), n: r10(n) }; break; }
      }
      if (!pos) pos = { e: r10(S / 2 + idx * 600), n: r10(S / 2) };
      var t = {
        id: idx, label: 'Цель ' + (idx < 9 ? '0' : '') + (idx + 1), type: td.type, name: ty.name, icon: ty.icon,
        e: pos.e, n: pos.n, r: ty.r, hp: ty.hp, maxHp: ty.hp, alive: true, moving: !!ty.moving
      };
      if (t.moving) {
        // курс примерно поперёк линии стрельбы
        var toGun = B.azimuthMil(t.e - gun.e, t.n - gun.n);
        t.heading = Math.round(B.norm6000(toGun + (rnd() < 0.5 ? 1500 : -1500) + (rnd() - 0.5) * 600) / 100) * 100;
        t.speed = 3 + Math.floor(rnd() * 2); // м/с
        t.pathLeft = 2600;
      }
      targets.push(t);
    });

    var op;
    if (def.observer === 'gun') {
      op = { e: gun.e, n: gun.n, h: gun.h, atGun: true };
    } else {
      var ce = 0, cn = 0;
      targets.forEach(function (t) { ce += t.e; cn += t.n; });
      ce /= targets.length; cn /= targets.length;
      var de = ce - gun.e, dn = cn - gun.n, L = Math.hypot(de, dn), side = rnd() < 0.5 ? 1 : -1, off = 1000 + rnd() * 700;
      op = {
        e: r10(Math.max(400, Math.min(S - 400, gun.e + de * 0.55 + side * off * dn / L))),
        n: r10(Math.max(400, Math.min(S - 400, gun.n + dn * 0.55 - side * off * de / L)))
      };
      op.h = Math.round(T.height(op.e, op.n));
    }

    // полярные донесения: цель ставится точно в точку с округлёнными азимутом и дальностью от НП
    targets.forEach(function (t) {
      if (def.report === 'polar' && !t.moving) {
        var a = Math.round(B.azimuthMil(t.e - op.e, t.n - op.n)), d = r10(Math.hypot(t.e - op.e, t.n - op.n));
        t.polar = { az: a, d: d };
        t.e = op.e + d * Math.sin(a * MIL);
        t.n = op.n + d * Math.cos(a * MIL);
      }
      t.h = Math.round(T.height(t.e, t.n));
    });

    var wSpeed = Math.round(def.wind[0] + rnd() * (def.wind[1] - def.wind[0]));
    var wFrom = Math.round(rnd() * 59) * 100;
    var wind = { speed: wSpeed, from: wFrom, e: -wSpeed * Math.sin(wFrom * MIL), n: -wSpeed * Math.cos(wFrom * MIL) };

    return { def: def, terrain: T, gun: gun, op: op, targets: targets, wind: wind };
  }

  root.Missions = { CAMPAIGN: CAMPAIGN, TYPES: TYPES, generate: generate, skirmishDef: skirmishDef };
})(window);
