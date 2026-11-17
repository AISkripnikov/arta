// Общий стенд для разработки постов: движок + игра + перечисленные посты, задание запущено.
//   import { runStations } from './harness.js';
//   runStations([createPlotStation], { mission: 0, difficulty: 0 });
// В консоли/тестах: window.__dev = { engine, game, stations }.
// URL-хеш: #<id поста> — начать с него; #m=3 — номер задания (0…7); #d=1 — сложность.
import { createEngine } from '../engine/index.js';
import { createGame } from '../game/index.js';

export async function runStations(factories, opts = {}) {
  const hash = location.hash.slice(1).split('&').filter(Boolean);
  const arg = (k, d) => { const h = hash.find((x) => x.startsWith(k + '=')); return h ? Number(h.split('=')[1]) : d; };
  const mem = { 'arta2.save': JSON.stringify({ unlocked: 99, stars: [], difficulty: arg('d', opts.difficulty || 0), muted: true }) };
  const game = createGame({ storage: { get: (k) => mem[k] || null, set: (k, v) => { mem[k] = v; } } });
  const engine = await createEngine(document.getElementById('stage'), { debug: true });
  const ctx = { engine, THREE: engine.THREE, ui: engine.ui, mat: engine.mat, audio: engine.audio, game };
  const stations = factories.map((make) => make(ctx));
  stations.forEach((st) => engine.addStation(st));
  engine.onFrame((dt) => game.update(dt));
  game.on('denied', (d) => console.log('[denied]', d.action, d.reason));
  game.on('radio', (m) => console.log('[radio]', m.from, m.text));
  game.startMission(arg('m', opts.mission || 0));
  game.begin();
  const start = hash.find((h) => stations.some((s) => s.id === h));
  if (start) engine.gotoStation(start, { instant: true });
  engine.on('swipe', (dir) => { const i = stations.findIndex((s) => s.id === engine.current); engine.gotoStation(stations[(i + (dir > 0 ? 1 : -1) + stations.length) % stations.length].id); });
  window.addEventListener('keydown', (e) => { const i = stations.findIndex((s) => s.id === engine.current); if (e.key === 'ArrowRight') engine.gotoStation(stations[(i + 1) % stations.length].id); if (e.key === 'ArrowLeft') engine.gotoStation(stations[(i - 1 + stations.length) % stations.length].id); });
  // имитация панелей HUD боевой сборки (верх 40 px, низ 56 px), чтобы видеть реальную зону управления
  for (const [edge, h] of [['top', 40], ['bottom', 56]]) {
    const bar = document.createElement('div');
    bar.style.cssText = `position:fixed;left:0;right:0;${edge}:0;height:${h}px;background:rgba(22,27,32,.93);border-${edge === 'top' ? 'bottom' : 'top'}:1px solid #000;pointer-events:none;z-index:5;color:#8d99a3;font:11px sans-serif;display:flex;align-items:center;justify-content:center`;
    bar.textContent = edge === 'top' ? 'HUD (верхняя панель)' : 'HUD (навигация по постам)';
    document.body.appendChild(bar);
  }
  engine.start();
  window.__dev = { engine, game, stations };
  return window.__dev;
}
