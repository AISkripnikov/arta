/* Местность: процедурный рельеф, лес, населённые пункты и растровая подложка карты. */
(function (root) {
  'use strict';

  var MAP_SIZE = 12000; // м, квадрат 12×12 км

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeNoise(seed) {
    var r = rng(seed), N = 64, g = new Float32Array(N * N);
    for (var i = 0; i < g.length; i++) g[i] = r();
    function at(x, y) { return g[((y & 63) << 6) | (x & 63)]; }
    function s(t) { return t * t * (3 - 2 * t); }
    function noise(x, y) {
      var xi = Math.floor(x), yi = Math.floor(y), fx = s(x - xi), fy = s(y - yi);
      var a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
      return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
    return function fbm(x, y) {
      return noise(x, y) * 0.55 + noise(x * 2.1 + 9.3, y * 2.1 + 4.7) * 0.28 + noise(x * 4.3 + 1.7, y * 4.3 + 8.1) * 0.17;
    };
  }

  var VILLAGES = ['Берёзовка', 'Ольховка', 'Дубки', 'Каменка', 'Сосновка', 'Липовка', 'Ключи', 'Заречье', 'Горки', 'Луговая', 'Выселки', 'Красный Яр'];

  /** relief — размах высот (м): 0 — почти плоско. */
  function create(seed, relief) {
    var hN = makeNoise(seed), fN = makeNoise(seed + 77), r = rng(seed + 5);
    var base = 120, amp = relief;
    function height(e, n) {
      return base + amp * hN(e / 2600, n / 2600);
    }
    function forest(e, n) { return fN(e / 1500 + 3, n / 1500 + 3) > 0.56; }

    var villages = [], names = VILLAGES.slice();
    for (var i = 0; i < 5; i++) {
      var nm = names.splice(Math.floor(r() * names.length), 1)[0];
      var v = { name: nm, e: 1200 + r() * 9600, n: 1200 + r() * 9600, houses: [] };
      var cnt = 8 + Math.floor(r() * 10);
      for (var j = 0; j < cnt; j++) v.houses.push({ e: v.e + (r() - 0.5) * 420, n: v.n + (r() - 0.5) * 300 });
      villages.push(v);
    }

    var T = { size: MAP_SIZE, height: height, forest: forest, villages: villages, image: null, seed: seed };

    T.render = function () {
      var P = 480, c = document.createElement('canvas');
      c.width = c.height = P;
      var ctx = c.getContext('2d'), img = ctx.createImageData(P, P), d = img.data;
      var hs = new Float32Array(P * P), m = MAP_SIZE / P;
      var x, y;
      for (y = 0; y < P; y++) for (x = 0; x < P; x++) hs[y * P + x] = height((x + 0.5) * m, MAP_SIZE - (y + 0.5) * m);
      for (y = 0; y < P; y++) for (x = 0; x < P; x++) {
        var i4 = (y * P + x) * 4, h = hs[y * P + x];
        var e = (x + 0.5) * m, n = MAP_SIZE - (y + 0.5) * m;
        var cr = 232, cg = 224, cb = 198; // бумага
        if (forest(e, n)) { cr = 190; cg = 211; cb = 160; }
        // отмывка рельефа: свет с северо-запада
        var hx = hs[y * P + Math.min(P - 1, x + 1)] - hs[y * P + Math.max(0, x - 1)];
        var hy = hs[Math.min(P - 1, y + 1) * P + x] - hs[Math.max(0, y - 1) * P + x];
        var sh = Math.max(-28, Math.min(28, (hx + hy) * 2.2));
        cr -= sh; cg -= sh; cb -= sh;
        // горизонтали через 20 м, утолщённые через 100 м
        var hr = hs[y * P + Math.min(P - 1, x + 1)], hd = hs[Math.min(P - 1, y + 1) * P + x];
        var l0 = Math.floor(h / 20), l1 = Math.floor(hr / 20), l2 = Math.floor(hd / 20);
        if (l0 !== l1 || l0 !== l2) {
          var mx = Math.max(l0, l1, l2), thick = mx % 5 === 0;
          var k = thick ? 0.75 : 0.4;
          cr = cr * (1 - k) + 150 * k; cg = cg * (1 - k) + 100 * k; cb = cb * (1 - k) + 55 * k;
        }
        d[i4] = cr; d[i4 + 1] = cg; d[i4 + 2] = cb; d[i4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      T.image = c;
      return c;
    };
    return T;
  }

  root.Terrain = { create: create, rng: rng, MAP_SIZE: MAP_SIZE };
})(window);
