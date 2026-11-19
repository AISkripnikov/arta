// Стенд вступительного ролика:  node build.mjs --dev intro  →  .dev/intro/index.html#rate=1&scene=0&t=0&lefty=0&ts=1
import { createIntro } from '../ui/intro.js';
import { createAudio } from '../engine/audio.js';
import { loadFonts } from '../engine/fonts.js';

const arg = (k, d) => { const m = new RegExp('[#&]' + k + '=([^&]*)').exec(location.hash); return m ? decodeURIComponent(m[1]) : d; };
const audio = createAudio();
const unlock = () => audio.unlock();
window.addEventListener('pointerdown', unlock, true);
window.addEventListener('keydown', unlock, true);
if (arg('lefty', '0') === '1') document.body.classList.add('lefty');
document.documentElement.style.setProperty('--ts', arg('ts', '1'));
document.documentElement.style.setProperty('--tsc', String(Math.min(+arg('ts', '1'), 1.15)));
const intro = createIntro({ audio, getVolume: () => 0.8 });
window.__intro = { intro, audio, done: [], handle: null, play(o = {}) { this.handle = intro.play({ ...o, onDone: (i) => this.done.push(i) }); return this.handle; } };
Promise.resolve(loadFonts && loadFonts()).catch(() => {}).then(() => {
  window.__intro.fonts = true;
  if (arg('auto', '1') === '1') {
    const h = window.__intro.play({ rate: +arg('rate', '1') });
    if (arg('scene', '') !== '') { h.seek(+arg('scene', '0'), +arg('t', '0')); if (arg('pause', '0') === '1') h.pause(true); }
  }
});
