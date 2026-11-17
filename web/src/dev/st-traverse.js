// Стенд поста «ПОВОРОТ»:  node build.mjs --dev st-traverse  →  .dev/st-traverse/index.html  (#m=3&d=1 — задание/сложность)
import { runStations } from './harness.js';
import { createTraverseStation } from '../stations/traverse.js';

runStations([createTraverseStation], { mission: 0 });
