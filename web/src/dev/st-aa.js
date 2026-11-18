// Стенд поста «ЗЕНИТКА»:  node build.mjs --dev st-aa  →  .dev/st-aa/index.html  (#m=3&d=1 — задание/сложность)
import { runStations } from './harness.js';
import { createAAStation } from '../stations/aa.js';

runStations([createAAStation], { mission: 0 });
