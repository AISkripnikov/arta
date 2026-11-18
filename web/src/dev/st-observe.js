// Стенд поста «НАБЛЮДЕНИЕ»:  node build.mjs --dev st-observe  →  .dev/st-observe/index.html  (#m=3&d=1 — задание/сложность)
import { runStations } from './harness.js';
import { createObserveStation } from '../stations/observe.js';

runStations([createObserveStation], { mission: 0 });
