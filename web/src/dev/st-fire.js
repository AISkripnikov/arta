// Стенд поста «ОГОНЬ»:  node build.mjs --dev st-fire  →  .dev/st-fire/index.html  (#m=3&d=1 — задание/сложность)
import { runStations } from './harness.js';
import { createFireStation } from '../stations/fire.js';

runStations([createFireStation], { mission: 0 });
