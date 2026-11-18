// Стенд поста «ПЛАНШЕТ»:  node build.mjs --dev st-plot  →  .dev/st-plot/index.html#m=3&d=0
import { runStations } from './harness.js';
import { createPlotStation } from '../stations/plot.js';

runStations([createPlotStation], { mission: 3 });
