// Стенд поста «ВЫЧИСЛИТЕЛЬ»: node build.mjs --dev st-computer → .dev/st-computer/index.html (#m=3&d=1 — задание/сложность)
import { runStations } from './harness.js';
import { createComputerStation } from '../stations/computer.js';

runStations([createComputerStation], { mission: 1 });
