// Стенд разработки поста «ПОДЪЁМ».
//   node build.mjs --dev st-elevation  →  .dev/st-elevation/index.html   (#m=3&d=1 — задание/сложность)
import { runStations } from './harness.js';
import { createElevationStation } from '../stations/elevation.js';

runStations([createElevationStation], { mission: 0 });
