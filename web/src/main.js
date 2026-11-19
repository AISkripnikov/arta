// Точка входа: движок, игра, восемь постов башни и оболочка.
import { createEngine } from './engine/index.js';
import { createGame } from './game/index.js';
import { createShell } from './ui/shell.js';
import { createIntro } from './ui/intro.js';
import { createVfx } from './ui/vfx.js';
import { createSoundscape } from './ui/soundscape.js';
import { createPlotStation } from './stations/plot.js';
import { createComputerStation } from './stations/computer.js';
import { createLoadingStation } from './stations/loading.js';
import { createTraverseStation } from './stations/traverse.js';
import { createElevationStation } from './stations/elevation.js';
import { createFireStation } from './stations/fire.js';
import { createObserveStation } from './stations/observe.js';
import { createAAStation } from './stations/aa.js';

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
    const stations = [createPlotStation, createComputerStation, createLoadingStation, createTraverseStation, createElevationStation, createFireStation,
      createObserveStation, createAAStation]
      .map((make) => make(ctx));
    stations.forEach((st) => engine.addStation(st));
    engine.onFrame((dt) => game.update(dt));
    engine.gotoStation('fire', { instant: true });
    // Вступительный ролик: оболочка сама покажет его при первом запуске и после сброса прогресса (и по кнопке в настройках).
    // Не создался — игра идёт без него (null: сразу меню). Подтверждение запуска ниже (ArtaNative.ready) ролик не задерживает.
    let intro = null;
    try { intro = createIntro({ engine, audio: engine.audio }); } catch (e) { console.error('[main] вступительный ролик недоступен:', e); }
    const shell = createShell({ engine, game, stations, intro });
    try { createVfx({ engine, game }); } catch (e) { console.error('[main] эффекты боя недоступны:', e); }
    let soundscape = null;
    try { soundscape = createSoundscape({ engine, game, shell, stations }); } catch (e) { console.error('[main] звуковая обстановка недоступна:', e); }
    engine.start();
    window.__arta = { engine, game, shell, soundscape };
    // Сообщаем приложению, что эта версия игры запустилась: иначе после двух неудач оно вернёт прежнюю.
    setTimeout(() => { try { window.ArtaNative.ready(); } catch (e) { /* не в приложении */ } }, 1500);
  } catch (err) {
    console.error(err);
    if (msg) msg.textContent = 'НЕ УДАЛОСЬ ЗАПУСТИТЬ 3D-ГРАФИКУ: ' + (err && err.message ? err.message : err);
  }
})();
