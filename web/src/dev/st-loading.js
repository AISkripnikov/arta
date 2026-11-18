// Стенд поста «ЗАРЯЖАНИЕ»:  node build.mjs --dev st-loading  →  .dev/st-loading/index.html  (#m=3&d=1 — задание/сложность)
import { runStations } from './harness.js';
import { createLoadingStation } from '../stations/loading.js';

runStations([createLoadingStation], { mission: 2 });
