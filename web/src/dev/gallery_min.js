// Минимальный стенд: один пост из примера в engine/README.md (проверка, что пример из документации рабочий).
//   node build.mjs --dev gallery_min
import { createEngine } from '../engine/index.js';

function createDemoStation({ engine, THREE, ui, mat, audio }) {
  const group = new THREE.Group();
  const main = ui.panel({ w: 1.7, h: 0.8, d: 0.06 });
  main.object3D.position.set(0, 1.1, -0.06);
  group.add(main.object3D);

  let km = 8.4;
  main.add(ui.plate('ДАЛЬНОСТЬ', { size: 0.03 }), 0, 0.3);
  const counter = main.add(ui.drumCounter({ digits: 4, decimals: 2, unit: 'КМ', value: km }), 0, 0.18);
  const lamp = main.add(ui.lamp({ color: 'green', label: 'ГОТОВО' }), 0.4, 0.18);
  const wheel = main.add(ui.handwheel({
    radius: 0.16,
    onTurn(d) { km = Math.max(0, km + d / (2 * Math.PI) * 0.5); counter.setValue(km); lamp.set(km > 10); },
  }), 0, -0.12);

  return {
    id: 'demo', title: 'ПРИМЕР', group,
    update(dt, time) {}, onEnter() { audio.clunk(); }, onLeave() {},
    controls: { counter, lamp, wheel },
  };
}

(async () => {
  const engine = await createEngine(document.getElementById('stage'), { debug: /[?&]debug/.test(location.search) });
  const ctx = { engine, THREE: engine.THREE, ui: engine.ui, mat: engine.mat, audio: engine.audio, game: null };
  const st = engine.addStation(createDemoStation(ctx));
  engine.start();
  window.__dev = { engine, stations: { demo: st }, log: [] };
})().catch(e => console.error(e));
