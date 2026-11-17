// engine.ui — фабрики органов управления (DESIGN §5.3).
import * as THREE from 'three';
import { panel, plate } from './panel.js';
import { handwheel } from './handwheel.js';
import { drumCounter } from './drumCounter.js';
import { lamp, pushButton } from './lamp.js';
import { lever, slewLever } from './lever.js';
import { toggle, cover, rotarySelector } from './switches.js';
import { gauge } from './gauge.js';
import { pipe, cable, rivetRow, cageLamp } from './decor.js';

export function createUI(engine) {
  const c = { engine, THREE, mat: engine.mat, audio: engine.audio, input: engine.input, ui: null };
  const ui = {
    panel: o => panel(c, o),
    plate: (text, o) => plate(c, text, o),
    handwheel: o => handwheel(c, o),
    drumCounter: o => drumCounter(c, o),
    lamp: o => lamp(c, o),
    lever: o => lever(c, o),
    slewLever: o => slewLever(c, o),
    rotarySelector: o => rotarySelector(c, o),
    gauge: o => gauge(c, o),
    pushButton: o => pushButton(c, o),
    toggle: o => toggle(c, o),
    cover: o => cover(c, o),
    pipe: (points, radius, material, o) => pipe(c, points, radius, material, o),
    cageLamp: o => cageLamp(c, o),
    rivetRow: (from, to, o) => rivetRow(c, from, to, o),
    cable: (points, o) => cable(c, points, o),
  };
  c.ui = ui;
  return ui;
}
