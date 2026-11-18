// Точка входа: движок, игра, шесть постов башни и оболочка.
import { createEngine } from './engine/index.js';
import { createGame } from './game/index.js';
import { createShell } from './ui/shell.js';
import { createPlotStation } from './stations/plot.js';
import { createComputerStation } from './stations/computer.js';
import { createLoadingStation } from './stations/loading.js';
import { createTraverseStation } from './stations/traverse.js';
import { createElevationStation } from './stations/elevation.js';
import { createFireStation } from './stations/fire.js';

const storage = {
  get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* хранилище недоступно */ } },
};

(async () => {
  const msg = document.getElementById('loadMsg');
  try {
    const game = createGame({ storage });
    const engine = await createEngine(document.getElementById('stage'), {});
    const ctx = { engine, THREE: engine.THREE, ui: engine.ui, mat: engine.mat, audio: engine.audio, game };
    const stations = [createPlotStation, createComputerStation, createLoadingStation, createTraverseStation, createElevationStation, createFireStation]
      .map((make) => make(ctx));
    stations.forEach((st) => engine.addStation(st));
    engine.onFrame((dt) => game.update(dt));
    engine.gotoStation('fire', { instant: true });
    createShell({ engine, game, stations });
    engine.start();
    window.__arta = { engine, game };
    // Сообщаем приложению, что эта версия игры запустилась: иначе после двух неудач оно вернёт прежнюю.
    setTimeout(() => { try { window.ArtaNative.ready(); } catch (e) { /* не в приложении */ } }, 1500);
  } catch (err) {
    console.error(err);
    if (msg) msg.textContent = 'НЕ УДАЛОСЬ ЗАПУСТИТЬ 3D-ГРАФИКУ: ' + (err && err.message ? err.message : err);
  }
})();
