// Вступительный ролик «АРТА: Башня» — рисованный в коде «движущийся комикс» из шести сцен (~47 с).
// Самодостаточный модуль: свой полноэкранный слой, свои стили (вставляются тегом <style> на время показа),
// холст 2D, субтитры с «печатной машинкой», звук через engine.audio (intro*-функции; до первого касания — тихо).
//
//   const intro = createIntro({ engine, getVolume: () => 0..1 });
//   if (!intro.seen()) intro.play({ onDone });          // первый запуск
//   intro.play({ onDone });                             // «ПОСМОТРЕТЬ РОЛИК» в настройках
//   intro.reset();                                      // после сброса прогресса
//
// play() всегда вызывает onDone ровно один раз (досмотрели, пропустили, ошибка рисования, нет холста) и после
// себя ничего не оставляет: слой, стили, обработчики, кадровый цикл и звуковые петли убираются.

export const INTRO_KEY = 'arta2.intro';

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, k) => a + (b - a) * k;
const ramp = (t, a, b) => clamp((t - a) / (b - a));
const ease = (k) => k * k * (3 - 2 * k);
const er = (t, a, b) => ease(ramp(t, a, b));
const hash = (n) => { const s = Math.sin(n * 127.1 + 11.7) * 43758.5453; return s - Math.floor(s); };

const VH = 360;                 // высота виртуальной сцены; ширина — по экрану (540…1040), x отсчитывается от центра
const CPS = 34;                 // скорость «печати» субтитров, знаков в секунду
const FADE = 0.38;              // затемнение между сценами, с
const HOLD = 16;                // сколько финальная заставка ждёт кнопку, прежде чем закрыться сама, с

const CSS = `
.ai{position:fixed;inset:0;z-index:2147483000;background:#000;color:#e8e0c8;overflow:hidden;touch-action:none;
  user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;opacity:1;
  font:500 14px/1.3 var(--font,'Oswald','Roboto Condensed','Arial Narrow',system-ui,sans-serif);letter-spacing:.04em}
.ai *{box-sizing:border-box}
.ai-cv{position:absolute;inset:0;width:100%;height:100%;display:block}
.ai-ch{position:absolute;top:calc(10px + env(safe-area-inset-top,0px));left:calc(16px + env(safe-area-inset-left,0px));
  font-size:calc(11px*var(--tsc,1));letter-spacing:.3em;color:rgba(232,224,200,.62);text-shadow:0 1px 3px #000;pointer-events:none;
  transition:opacity .3s}
.ai-ch b{color:#d39a1e;font-weight:600;margin-right:.7em}
.ai button{font:inherit;letter-spacing:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;
  -webkit-appearance:none;appearance:none;outline:none;touch-action:manipulation}
.ai-skip{position:absolute;top:calc(6px + env(safe-area-inset-top,0px));right:calc(10px + env(safe-area-inset-right,0px));
  min-width:132px;min-height:44px;padding:0 16px !important;font-size:calc(12px*var(--tsc,1)) !important;font-weight:600;
  letter-spacing:.2em !important;color:#e8e0c8 !important;background:rgba(17,19,22,.62) !important;
  border:1px solid rgba(232,224,200,.28) !important;border-radius:3px;white-space:nowrap}
.ai-skip:active{background:rgba(211,154,30,.3) !important}
.ai-skip i{font-style:normal;color:#d39a1e;margin-left:.6em;letter-spacing:0}
body.lefty .ai-skip{right:auto;left:calc(10px + env(safe-area-inset-left,0px))}
body.lefty .ai-ch{left:auto;right:calc(16px + env(safe-area-inset-right,0px))}
.ai-band{position:absolute;left:0;right:0;bottom:0;min-height:calc(74px*var(--ts,1));
  padding:calc(14px*var(--ts,1)) max(22px,env(safe-area-inset-right,0px)) calc(10px + env(safe-area-inset-bottom,0px)) max(22px,env(safe-area-inset-left,0px));
  background:linear-gradient(rgba(5,7,9,0),rgba(5,7,9,.86) 24%,rgba(5,7,9,.96));pointer-events:none;
  display:flex;flex-direction:column;align-items:center;justify-content:flex-end;text-align:center}
.ai-who{font-size:calc(11px*var(--ts,1));font-weight:600;letter-spacing:.26em;color:#d39a1e;min-height:calc(15px*var(--ts,1));
  margin-right:-.26em;text-transform:uppercase}
.ai-txt{max-width:min(780px,100%);font-size:calc(15px*var(--ts,1));line-height:1.28;letter-spacing:.03em;min-height:2.56em;
  text-shadow:0 1px 2px #000;text-transform:none}
.ai-txt.narr{color:#b9c2c8;font-style:italic}
.ai-txt .off{visibility:hidden}
.ai-bar{position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(232,224,200,.1)}
.ai-prog{position:absolute;left:0;top:0;bottom:0;width:100%;background:#d39a1e;transform-origin:0 50%;transform:scaleX(0)}
.ai-bar s{position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:#07090b}
.ai-title{position:absolute;left:0;right:0;top:11%;display:flex;flex-direction:column;align-items:center;text-align:center;
  opacity:0;transform:translateY(8px);transition:opacity .9s ease,transform .9s ease;pointer-events:none}
.ai-title.on{opacity:1;transform:none}
.ai-t1{font-size:calc(46px*var(--tsc,1));line-height:1;font-weight:700;letter-spacing:.2em;margin-right:-.2em;color:#d39a1e;
  text-shadow:0 2px 0 rgba(0,0,0,.55),0 0 26px rgba(0,0,0,.6);white-space:nowrap}
.ai-t1 i{font-style:normal;color:#e8e0c8;margin:0 .12em}
.ai-t2{margin-top:6px;font-size:calc(11px*var(--tsc,1));letter-spacing:.34em;margin-right:-.34em;color:#e8e0c8;text-shadow:0 1px 3px #000;white-space:nowrap}
.ai-go{margin-top:calc(14px*var(--tsc,1)) !important;min-width:190px;min-height:46px;padding:0 30px !important;
  font-size:calc(17px*var(--tsc,1)) !important;font-weight:600;letter-spacing:.24em !important;color:#14171a !important;
  background:linear-gradient(#e0a92c,#b9820f) !important;border:1px solid #000 !important;border-radius:3px;
  box-shadow:0 1px 0 rgba(255,255,255,.3) inset,0 4px 18px rgba(0,0,0,.55);pointer-events:none}
.ai-title.on .ai-go{pointer-events:auto;animation:ai-pulse 1.6s ease-in-out infinite}
.ai-go:active{background:#e8e0c8 !important}
@keyframes ai-pulse{0%,100%{box-shadow:0 1px 0 rgba(255,255,255,.3) inset,0 4px 18px rgba(0,0,0,.55),0 0 0 0 rgba(211,154,30,.55)}
  60%{box-shadow:0 1px 0 rgba(255,255,255,.3) inset,0 4px 18px rgba(0,0,0,.55),0 0 0 12px rgba(211,154,30,0)}}
@media (max-height:380px){.ai-title{top:9%}.ai-t1{font-size:calc(40px*var(--tsc,1))}}
@media (orientation:portrait){.ai-title{top:20%}.ai-t1{font-size:calc(34px*var(--tsc,1))}}
`;

// ---------------------------------------------------------------- рисовальные примитивы

function poly(g, pts, fill) {
  g.beginPath(); g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); }
}
function disc(g, x, y, r, fill) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = fill; g.fill(); }
function line(g, x0, y0, x1, y1, w, col) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.lineWidth = w; g.strokeStyle = col; g.stroke(); }

/**
 * Силуэт человека в шинели. (x, y) — подошвы, h — рост. o: dir ±1 (куда смотрит), wide, cap (false — без фуражки),
 * helmet, phones, bag, crouch 0..1, lean (рад), col, rim (цвет контрового света), rimSide ±1, arms [[плечо, локоть, кисть]…].
 */
function person(g, x, y, h, o = {}) {
  const u = h / 8, d = o.dir || 1, w = o.wide || 1;
  g.save(); g.translate(x, y); g.scale(u * d, u * (1 - 0.32 * (o.crouch || 0)));
  if (o.lean) g.rotate(o.lean);
  const arms = o.arms || [[0.92 * w, -6.3, 1.06 * w, -5.0, 0.96 * w, -3.9], [-0.92 * w, -6.3, -1.06 * w, -5.0, -0.96 * w, -3.9]];
  const pass = (col) => {
    g.fillStyle = col; g.strokeStyle = col;
    g.beginPath();
    g.rect(-0.62 * w, -2.9, 0.56 * w, 2.9); g.rect(0.06 * w, -2.9, 0.56 * w, 2.9);            // ноги
    g.rect(-0.62 * w, -0.3, 0.84 * w, 0.3); g.rect(0.06 * w, -0.3, 0.84 * w, 0.3);            // сапоги
    g.moveTo(-1.0 * w, -6.55); g.lineTo(1.0 * w, -6.55); g.lineTo(0.8 * w, -4.5); g.lineTo(1.14 * w, -2.2);
    g.lineTo(-1.14 * w, -2.2); g.lineTo(-0.8 * w, -4.5); g.closePath();                        // шинель
    g.rect(-0.2, -6.95, 0.44, 0.45);                                                          // шея
    g.moveTo(0.58, -7.36); g.arc(0.06, -7.36, 0.52, 0, TAU);                                   // голова
    if (o.helmet) { g.moveTo(0.78, -7.42); g.arc(0.06, -7.42, 0.72, 0, Math.PI, true); g.closePath(); } else if (o.cap !== false) {
      g.rect(-0.6, -8.0, 1.34, 0.3); g.rect(-0.42, -8.2, 0.98, 0.24); g.rect(0.36, -7.76, 0.62, 0.12);   // фуражка с козырьком
    }
    if (o.bag) { g.moveTo(-0.4 * w, -5.5); g.ellipse(-1.05 * w, -5.5, 0.66, 0.95, 0.15, 0, TAU); }
    g.fill();
    g.lineWidth = 0.5; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const a of arms) { g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(a[2], a[3]); g.lineTo(a[4], a[5]); g.stroke(); }
    if (o.phones) {
      g.lineWidth = 0.16; g.beginPath(); g.arc(0.06, -7.4, 0.66, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
      g.beginPath(); g.ellipse(-0.08, -7.3, 0.26, 0.36, 0, 0, TAU); g.fill();
    }
  };
  if (o.rim) { g.save(); g.translate(0.13 * (o.rimSide || 1), -0.06); pass(o.rim); g.restore(); }
  pass(o.col || '#07090b');
  g.restore();
}

/** Башня: c — косинус азимута (+1 стволы вправо, −1 влево, 0 — на зрителя), el — возвышение (доля). */
function turret(g, x, y, s, c, el, col, rim) {
  const a = Math.abs(c), dir = c >= 0 ? 1 : -1, wf = 0.82 + 0.18 * a, L = 84 * a;
  g.save(); g.translate(x, y); g.scale(s, s);
  g.fillStyle = col;
  g.fillRect(-50, -9, 100, 11); g.fillRect(-56, -2, 112, 6);                                  // барбет
  const house = () => {
    g.beginPath();
    g.moveTo(-42 * wf * dir, -9); g.lineTo(-40 * wf * dir, -36); g.lineTo(-26 * wf * dir, -47); g.lineTo(22 * wf * dir, -47);
    g.lineTo(40 * wf * dir, -33); g.lineTo(43 * wf * dir, -9); g.closePath();
  };
  const barrels = () => {
    for (let k = 1; k >= 0; k--) {
      const sp = (k ? -1 : 1) * 11 * (1 - a), bx = dir * 30 * wf * a + sp, by = -27 - k * 2.5 * a;
      const ex = bx + dir * L, ey = by - el * (L + 14);
      g.beginPath(); g.moveTo(bx, by - 4.6); g.lineTo(ex, ey - 3.1); g.lineTo(ex, ey + 3.1); g.lineTo(bx, by + 4.6); g.closePath(); g.fill();
      g.fillRect(Math.min(bx, bx + dir * 12 * a) - 1, by - 7, 12 * a + 2, 14);                 // маска
      if (a < 0.6) { g.beginPath(); g.arc(ex, ey, 4.2, 0, TAU); g.fill(); }
    }
  };
  house(); g.fill(); barrels();
  g.fillRect(-12 * wf, -53, 16, 7); g.fillRect(-30 * wf * dir - 4, -51, 9, 5);                 // командирский колпак, визир
  if (rim) {
    g.strokeStyle = rim; g.lineWidth = 1.1 / Math.max(1, s * 0.6); g.beginPath();
    g.moveTo(-40 * wf * dir, -36); g.lineTo(-26 * wf * dir, -47); g.lineTo(22 * wf * dir, -47); g.lineTo(40 * wf * dir, -33); g.stroke();
    if (a > 0.3) { const bx = dir * 30 * wf * a, ex = bx + dir * L, ey = -27 - el * (L + 14); line(g, bx, -31.8, ex, ey - 3.3, 1.1 / Math.max(1, s * 0.6), rim); }
  }
  g.restore();
}

/** Силуэт судна носом влево. kind 0 — транспорт, 1 — корабль охранения. */
function ship(g, x, y, s, kind, col) {
  g.save(); g.translate(x, y); g.scale(s, s); g.fillStyle = col; g.strokeStyle = col; g.lineWidth = 1.2;
  g.beginPath();
  if (kind) {
    g.moveTo(-54, -7); g.lineTo(-44, 0); g.lineTo(44, 0); g.lineTo(48, -5); g.lineTo(-20, -6); g.closePath();
    g.rect(-12, -14, 20, 9); g.rect(-8, -19, 9, 6); g.rect(12, -12, 12, 7); g.rect(-34, -10, 10, 5); g.rect(-42, -8.5, 10, 2); g.rect(28, -9, 9, 4);
    g.moveTo(14, -12); g.lineTo(17, -21); g.lineTo(22, -21); g.lineTo(21, -12);
    g.fill(); g.beginPath(); g.moveTo(-3, -19); g.lineTo(-3, -32); g.moveTo(-8, -27); g.lineTo(2, -27); g.stroke();
  } else {
    g.moveTo(-48, -9); g.lineTo(-41, 0); g.lineTo(42, 0); g.lineTo(46, -8); g.lineTo(24, -8); g.lineTo(24, -10); g.lineTo(-12, -10); g.lineTo(-12, -8); g.closePath();
    g.rect(-2, -19, 18, 9); g.rect(4, -28, 6, 10); g.rect(1, -22, 12, 3);
    g.fill(); g.beginPath();
    g.moveTo(-30, -9); g.lineTo(-30, -27); g.moveTo(-30, -24); g.lineTo(-16, -12); g.moveTo(-30, -24); g.lineTo(-42, -12);
    g.moveTo(34, -8); g.lineTo(34, -25); g.moveTo(34, -22); g.lineTo(22, -12); g.stroke();
  }
  g.restore();
}

// ---------------------------------------------------------------- сцены
// Каждая сцена: { name, d, wind, hiss, lines:[{at, who, text}], cues:[{at, s}], draw(R) }.
// R: g, t (секунды сцены), T (общее время), d, hw (половина ширины сцены), line (номер текущей реплики),
//    cam(zoom, panX, panY, zy), L(parallax), glow(), fog(), rain(), grad(), shake.

const NIGHT = '#06090d';

function sArrival(R) {
  const { g, t, T, hw } = R, k = t / R.d;
  R.cam(1 + 0.1 * k, 70 * k, -6 * k, 170);
  R.L(0);
  g.fillStyle = R.grad('skyN', 0, 0, 0, 216, [0, '#05080c', 0.6, '#101a23', 1, '#1d2a35']); g.fillRect(-hw - 300, -60, 2 * hw + 600, 280);
  R.glow(-170, 58, 170, 'cold', 0.2 + 0.03 * Math.sin(T * 0.7));
  R.L(0.12); R.fog(6, 130, 0.5, T * 5);
  R.L(0.22);                                                                                   // дальний мыс и маяк
  poly(g, [-hw - 320, 216, -hw - 320, 200, -360, 196, -300, 184, -246, 180, -196, 192, -120, 206, -40, 216], '#0e1820');
  g.fillStyle = '#0e1820'; g.fillRect(-250, 166, 4, 16);
  const blink = Math.max(0, Math.sin(T * 2.1)) ** 6;
  R.glow(-248, 165, 10 + 22 * blink, 'warm', 0.35 + 0.6 * blink);
  R.L(0.3);                                                                                    // море
  g.fillStyle = R.grad('seaN', 0, 214, 0, 360, [0, '#111c25', 0.25, '#0a1219', 1, '#05080b']); g.fillRect(-hw - 320, 214, 2 * hw + 640, 170);
  g.strokeStyle = 'rgba(160,190,210,.13)'; g.lineWidth = 1; g.beginPath();
  for (let i = 0; i < 22; i++) {
    const y = 220 + i * 5.2 + hash(i) * 3, x = (hash(i + 40) * 2 - 1) * (hw + 200) + Math.sin(T * 0.7 + i) * 7, w = 10 + hash(i + 9) * 34;
    g.moveTo(x, y); g.lineTo(x + w, y);
  }
  g.stroke();
  R.L(0.42); R.fog(168, 84, 0.6, -T * 9);
  // прожектор с утёса: луч метёт по морю и туману
  const lamp = [176, 110], sweep = Math.PI + 0.1 + 0.3 * Math.sin(t * 0.62 - 0.6);
  R.L(0.7);
  g.save(); g.translate(lamp[0], lamp[1]); g.rotate(sweep); g.globalCompositeOperation = 'lighter';
  g.fillStyle = R.grad('beam', 0, 0, 640, 0, [0, 'rgba(210,225,235,.5)', 0.25, 'rgba(190,210,225,.2)', 1, 'rgba(180,205,225,0)']);
  g.beginPath(); g.moveTo(0, -2.5); g.lineTo(640, -46); g.lineTo(640, 46); g.lineTo(0, 2.5); g.closePath(); g.fill();
  g.restore();
  // утёс с батареей
  const cliff = [-150, 392, -96, 318, -66, 300, -18, 268, 22, 232, 62, 198, 110, 174, 150, 162, 200, 158, hw + 340, 156, hw + 340, 392];
  poly(g, cliff, '#080d11');
  g.strokeStyle = 'rgba(120,150,170,.16)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-66, 300);
  for (let i = 6; i < 18; i += 2) g.lineTo(cliff[i], cliff[i + 1]);
  g.stroke();
  turret(g, 268, 158, 0.86, -1, 0.1, '#080d11', 'rgba(150,175,195,.22)');
  g.fillStyle = '#080d11'; g.fillRect(330, 140, 60, 18); g.fillRect(346, 130, 22, 12);       // казарма
  g.strokeStyle = '#080d11'; g.lineWidth = 2; g.beginPath();                                    // вышка прожектора
  g.moveTo(168, 160); g.lineTo(174, 114); g.moveTo(186, 160); g.lineTo(180, 114); g.moveTo(169, 148); g.lineTo(185, 136); g.moveTo(171, 132); g.lineTo(184, 148); g.moveTo(172, 122); g.lineTo(183, 122);
  g.stroke(); g.fillRect(170, 104, 14, 11);
  R.glow(lamp[0], lamp[1], 20, 'white', 0.9);
  // грузовик ползёт по серпантину к батарее
  const road = [-66, 300, -18, 268, 22, 232, 62, 198, 110, 174, 150, 162, 214, 158], n = road.length / 2 - 1;
  const p = er(t, 0.2, R.d - 0.9) * n * 0.985, si = Math.min(n - 1, Math.floor(p)), f = p - si;
  const ax = road[si * 2], ay = road[si * 2 + 1], bx = road[si * 2 + 2], by = road[si * 2 + 3];
  const tx = lerp(ax, bx, f), ty = lerp(ay, by, f), ang = Math.atan2(by - ay, bx - ax), bump = Math.sin(t * 13) * 0.5;
  g.save(); g.translate(tx, ty + bump); g.rotate(ang);
  g.fillStyle = '#080d11'; g.fillRect(-13, -12, 15, 10); g.fillRect(2, -9, 7, 7); disc(g, -8, -1, 2.6, '#080d11'); disc(g, 4, -1, 2.6, '#080d11');
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = R.grad('head', 9, 0, 70, 0, [0, 'rgba(255,205,120,.5)', 1, 'rgba(255,205,120,0)']);
  g.beginPath(); g.moveTo(9, -6); g.lineTo(70, -18); g.lineTo(70, 6); g.lineTo(9, -4); g.closePath(); g.fill();
  g.restore();
  R.glow(tx + Math.cos(ang) * 9, ty - 5 + bump, 9, 'warm', 0.95);
  R.L(1); R.fog(232, 120, 0.42, T * 16);
  R.L(1.3);                                                                                    // передний план: колья и проволока
  g.fillStyle = '#020304'; g.strokeStyle = '#020304';
  poly(g, [-hw - 380, 392, -hw - 380, 316, -hw - 90, 326, -hw + 60, 344, -hw + 190, 372, -hw + 240, 392], '#020304');
  for (let i = 0; i < 4; i++) {
    const x = -hw - 20 + i * 62, y = 332 + i * 9;
    g.save(); g.translate(x, y); g.rotate(-0.12 + i * 0.07); g.fillRect(-2.5, -52, 5, 60); g.restore();
  }
  g.lineWidth = 1.1; g.beginPath();
  for (let r = 0; r < 3; r++) { g.moveTo(-hw - 90, 292 + r * 13); g.quadraticCurveTo(-hw + 70, 306 + r * 14 + Math.sin(T * 1.3 + r) * 1.5, -hw + 190, 316 + r * 16); }
  g.stroke();
  R.L(0); R.rain(0.9);
}

function burst(R, x, y, a, power) {
  const g = R.g;
  if (a < 0) return;
  R.glow(x, y, (70 + 520 * a) * power, 'warm', Math.max(0, 0.9 - a / 0.4));
  R.glow(x, y, (26 + 60 * Math.min(1, a / 0.25)) * power, 'white', Math.max(0, 1 - a / 0.9));
  for (let i = 0; i < 7; i++) {                                                                // дым
    const h1 = hash(i * 3.1 + x), s = Math.max(0, a - i * 0.05);
    if (s <= 0) continue;
    g.globalAlpha = Math.max(0, 0.5 - s * 0.1) * Math.min(1, s * 5);
    disc(g, x + (h1 - 0.5) * 46 * power + s * 9, y - s * (16 + h1 * 16) - i * 5, (9 + s * 12 + h1 * 6) * power, '#1c2229');
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 18; i++) {                                                               // осколки и искры
    const h1 = hash(i * 7.3 + x), h2 = hash(i * 1.9 + y), an = -Math.PI * (0.1 + 0.8 * h1), sp = (130 + 260 * h2) * power;
    const px = x + Math.cos(an) * sp * a, py = y + Math.sin(an) * sp * a + 260 * a * a;
    if (a > 1.5) continue;
    if (i % 3) { g.fillStyle = '#050607'; g.fillRect(px, py, 2 + h2 * 3, 2 + h1 * 2); } else R.glow(px, py, 4, 'warm', Math.max(0, 1 - a / 1.1));
  }
}

function sShelling(R) {
  const { g, t, T, hw } = R, k = t / R.d, B1 = 3.1, B2 = 4.6, a1 = t - B1, a2 = t - B2;
  R.shake = (a1 > 0 ? 6 * Math.exp(-a1 * 4.5) : 0) + (a2 > 0 ? 13 * Math.exp(-a2 * 3.6) : 0);
  const lit = Math.max(a1 > 0 ? Math.exp(-a1 * 3) * 0.6 : 0, a2 > 0 ? Math.exp(-a2 * 2.2) : 0);   // подсветка двора разрывом
  R.cam(1.03 + 0.05 * k, -30 + 60 * k, 0, 200);
  R.L(0);
  g.fillStyle = R.grad('sky2', 0, 0, 0, 262, [0, '#06090d', 1, '#1a2530']); g.fillRect(-hw - 300, -60, 2 * hw + 600, 340);
  if (lit > 0.01) { g.globalAlpha = lit * 0.5; g.fillStyle = '#7a4a1c'; g.fillRect(-hw - 300, -60, 2 * hw + 600, 340); g.globalAlpha = 1; }
  R.L(0.3);
  poly(g, [-hw - 300, 264, -hw - 300, 214, -300, 204, -180, 186, -60, 178, 40, 184, 160, 172, 300, 180, hw + 300, 170, hw + 300, 264], '#0e161d');
  turret(g, -150, 182, 0.55, -1, 0.12, '#0e161d');
  burst(R, 130, 178, a1, 0.75);
  R.fog(150, 110, 0.5, T * 8);
  R.L(0.62);                                                                                   // каземат и дальномерный пост
  const wall = '#141d25';
  g.fillStyle = wall; g.fillRect(-30, 150, hw + 400, 114);
  poly(g, [-30, 150, -62, 264, -30, 264], wall);
  g.fillStyle = 'rgba(150,175,195,.14)'; g.fillRect(-30, 150, hw + 400, 1.5);
  g.fillStyle = '#080c10'; g.fillRect(20, 196, 46, 10); g.fillRect(96, 196, 46, 10); g.fillRect(300, 196, 46, 10); g.fillRect(170, 206, 34, 58);
  g.fillStyle = 'rgba(232,224,200,.13)'; g.font = '600 13px Oswald, sans-serif'; g.textAlign = 'center'; g.fillText('К-2', 187, 200);
  const broke = er(t, B2, B2 + 0.5);
  g.fillStyle = wall; g.fillRect(232, 116, 44, 36); g.fillRect(246, 104 + 8 * broke, 16, 14);
  g.save(); g.translate(254, 103 + 12 * broke); g.rotate(0.42 * broke);                         // труба дальномера
  g.fillRect(-52, -4, 104, 8); g.fillRect(-58, -6, 9, 12); g.fillRect(49, -6, 9, 12); g.restore();
  if (a2 < 0) person(g, 222, 150, 30, { dir: -1, col: wall, arms: [[0.9, -6.3, 1.6, -6.6, 1.0, -7.2], [-0.9, -6.3, -1.0, -5, -0.9, -4]] });   // командир у дальномера
  burst(R, 250, 112, a2, 1.25);
  if (a2 > 0.4) for (let i = 0; i < 5; i++) {                                                   // пожар на посту
    const s = (T * 0.55 + i * 0.2) % 1;
    g.globalAlpha = (1 - s) * 0.5 * Math.min(1, (a2 - 0.4) * 2); disc(g, 250 + s * 44 + Math.sin(i * 2.1) * 8, 108 - s * 92, 9 + s * 22, '#1f262d');
  }
  g.globalAlpha = 1;
  if (a2 > 0.3) R.glow(250, 116, 30 + 5 * Math.sin(T * 17), 'warm', 0.55 + 0.2 * Math.sin(T * 23));
  R.L(1);                                                                                      // двор
  g.fillStyle = R.grad('yard', 0, 262, 0, 360, [0, '#0d1318', 1, '#06090c']); g.fillRect(-hw - 320, 262, 2 * hw + 640, 130);
  g.fillStyle = `rgba(${lit > 0.05 ? '255,190,110' : '150,180,200'},${0.08 + lit * 0.3})`;
  for (let i = 0; i < 6; i++) { const x = -280 + i * 104 + hash(i) * 30; g.beginPath(); g.ellipse(x, 284 + hash(i + 5) * 44, 34 + hash(i + 2) * 30, 3.2, 0, 0, TAU); g.fill(); }
  // грузовик, на котором приехал лейтенант
  g.fillStyle = '#080c10'; g.fillRect(-hw - 60, 222, 96, 34); g.fillRect(-hw + 36, 234, 30, 22); disc(g, -hw - 30, 258, 9, '#080c10'); disc(g, -hw + 44, 258, 9, '#080c10');
  R.glow(-hw + 68, 244, 16, 'warm', 0.5);
  // лейтенант идёт через двор, падает при разрыве, бежит к посту
  const walk = ramp(t, 0, 3.0), run = er(t, 5.5, R.d), down = er(t, B1, B1 + 0.18) * (1 - er(t, 5.2, 5.6));
  const lx = lerp(-250, -84, walk) + run * 190, moving = (t < 3.0 || t > 5.5) ? 1 : 0, st = Math.sin(t * (t > 5.5 ? 14 : 8.5)) * moving;
  person(g, lx, 276 + Math.abs(st) * -1.8, 88, { dir: 1, bag: t < 5.5, crouch: down, lean: 0.05 + run * 0.16 * moving, col: '#05070a',
    rim: lit > 0.03 ? `rgba(255,190,110,${Math.min(0.9, lit * 1.3)})` : 'rgba(150,175,195,.2)', rimSide: 1,
    arms: [[0.9, -6.3, 1.0 + st * 0.5, -5.0, 0.9 + st * 1.1, -3.9 - down * 2.6], [-0.9, -6.3, -1.0 - st * 0.5, -5.0, -0.9 - st * 1.1, -3.9 - down * 2.6]] });
  R.L(1.05); R.fog(238, 110, 0.36, -T * 20);
  R.L(1.3);                                                                                    // мешки с песком
  g.fillStyle = '#020304';
  for (let r = 0; r < 3; r++) for (let i = 0; i < 6 - r; i++) { g.beginPath(); g.ellipse(hw - 150 + i * 46 + r * 23, 352 - r * 15, 26, 9.5, 0, 0, TAU); g.fill(); }
  for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(-hw - 30 + i * 44, 356, 26, 9.5, 0, 0, TAU); g.fill(); }
  R.L(0); R.rain(1);
  const fl = Math.max(a1 > 0 ? 1 - a1 / 0.14 : 0, a2 > 0 ? 1 - a2 / 0.2 : 0);
  if (fl > 0) { g.globalAlpha = fl * 0.8; g.fillStyle = '#ffe6bd'; g.fillRect(-hw - 300, -60, 2 * hw + 600, 480); g.globalAlpha = 1; }
}

function sCommander(R) {
  const { g, t, T, hw } = R, k = t / R.d, TH = [1.6, 4.9];
  let imp = 0, sh = 0;
  for (const th of TH) { const a = t - th; if (a > 0) { imp += 0.3 * Math.exp(-a * 0.8) * Math.sin(a * 5.2); sh += 5 * Math.exp(-a * 5); } }
  R.shake = sh;
  R.cam(1.02 + 0.06 * k, 24 - 48 * k, 0, 190);
  const th = 0.07 * Math.sin(T * 1.6) + imp, px = -24, py = 34, lx = px + Math.sin(th) * 54, ly = py + Math.cos(th) * 54;
  const flick = 0.9 + 0.06 * Math.sin(T * 13) + 0.04 * Math.sin(T * 29.3);
  R.L(0.55);                                                                                   // стена блиндажа
  g.fillStyle = '#231a10'; g.fillRect(-hw - 300, -40, 2 * hw + 600, 320);
  g.fillStyle = '#17110a';
  for (let x = -Math.ceil((hw + 300) / 44) * 44; x < hw + 300; x += 44) g.fillRect(x, 30, 2.5, 240);
  g.fillStyle = 'rgba(232,224,200,.13)'; g.fillRect(-268, 78, 96, 64);                           // карта на стене
  g.strokeStyle = 'rgba(30,22,12,.7)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-262, 120); g.bezierCurveTo(-240, 96, -214, 128, -178, 92); g.stroke();
  g.fillStyle = '#0b0805'; g.fillRect(196, 70, 4, 8); poly(g, [176, 78, 220, 78, 226, 170, 214, 176, 182, 174, 172, 168], '#100b07');   // шинель на гвозде
  // тень лейтенанта на стене ходит против фонаря
  const ltx = lerp(-150, -70, er(t, 0, 1.6));
  g.globalAlpha = 0.42; person(g, ltx - 46 - (lx - px) * 1.3, 292, 214, { dir: 1, cap: false, col: '#0a0704', lean: 0.03 }); g.globalAlpha = 1;
  g.fillStyle = '#0d0906'; g.fillRect(-hw - 300, -40, 2 * hw + 600, 76);                          // накат
  for (let x = -Math.ceil((hw + 300) / 58) * 58; x < hw + 300; x += 58) { disc(g, x, 36, 15, '#150f09'); disc(g, x, 36, 8, '#0d0906'); }
  R.L(1);
  g.fillStyle = '#0c0906'; g.fillRect(-hw - 320, 268, 2 * hw + 640, 130);                        // пол
  g.fillStyle = 'rgba(255,190,110,.05)'; g.beginPath(); g.ellipse(lx + 10, 300, 210, 20, 0, 0, TAU); g.fill();
  // фонарь
  line(g, px, py, lx, ly, 1.4, '#050403');
  g.fillStyle = '#050403'; g.fillRect(lx - 6, ly - 4, 12, 4); g.fillRect(lx - 5, ly + 12, 10, 3);
  disc(g, lx, ly + 6, 5.5, '#ffd58a');
  // койка с раненым командиром
  const dk = '#070504', breath = Math.sin(T * 1.9) * 1.1;
  g.fillStyle = dk; g.fillRect(66, 236, 250, 8); g.fillRect(74, 244, 6, 26); g.fillRect(302, 244, 6, 26);
  poly(g, [70, 236, 72, 222, 108, 218, 112, 236], '#3a3226');                                    // подушка
  g.beginPath(); g.moveTo(108, 236); g.lineTo(112, 216 - breath); g.quadraticCurveTo(170, 204 - breath, 214, 214); g.quadraticCurveTo(238, 196, 258, 214);
  g.lineTo(308, 226); g.lineTo(312, 236); g.closePath(); g.fillStyle = '#16110b'; g.fill();      // одеяло
  disc(g, 96, 212, 12.5, dk); g.fillStyle = dk; g.fillRect(100, 216, 14, 9);
  g.save(); g.translate(96, 212); g.rotate(-0.35); g.fillStyle = 'rgba(232,224,200,.75)'; g.fillRect(-12.6, -8, 25.2, 6.5); g.restore();   // повязка
  const arm = er(t, 4.0, 4.9) * (1 - er(t, 6.9, 7.6));
  g.strokeStyle = dk; g.lineWidth = 6.5; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath();
  g.moveTo(132, 216); g.lineTo(lerp(150, 122, arm), lerp(226, 196, arm)); g.lineTo(lerp(170, 92, arm), lerp(232, 184, arm)); g.stroke();
  g.strokeStyle = 'rgba(255,200,130,.5)'; g.lineWidth = 1; g.beginPath(); g.arc(96, 212, 12.5, Math.PI * 1.05, Math.PI * 1.7); g.stroke();
  g.fillStyle = dk; g.fillRect(332, 216, 34, 54); g.fillRect(338, 204, 8, 12); g.fillRect(350, 208, 12, 8);   // тумбочка с кружкой
  // лейтенант: фуражка в руке, голова опущена
  person(g, ltx, 276, 128, { dir: 1, cap: false, lean: 0.045, col: '#060403', rim: `rgba(255,196,120,${0.55 * flick})`, rimSide: 1,
    arms: [[0.9, -6.3, 1.1, -5.1, 1.5, -4.3], [-0.9, -6.3, -1.0, -5, -0.95, -3.9]] });
  g.save(); g.translate(ltx + 25, 276 - 69); g.fillStyle = '#060403'; g.fillRect(-8, 0, 17, 4); g.fillRect(-6, -3, 13, 4); g.restore();
  // полевой телефон на ящике
  g.fillStyle = dk; g.fillRect(-312, 226, 74, 46); g.fillRect(-298, 208, 40, 18); g.fillRect(-304, 201, 52, 6);
  // свет фонаря и темнота по краям
  R.glow(lx, ly + 6, 250, 'warm', 0.5 * flick); R.glow(lx, ly + 6, 30, 'white', 0.8 * flick);
  g.save(); g.translate(lx, ly + 40);
  g.fillStyle = R.grad('dark3', 0, 0, 0, 0, [0.3, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,.86)'], 520); g.fillRect(-900, -500, 1800, 1000); g.restore();
  for (const tt of TH) {                                                                        // с потолка сыплется земля
    const a = t - tt; if (a <= 0 || a > 2.4) continue;
    g.fillStyle = `rgba(214,170,110,${0.6 * (1 - a / 2.4)})`;
    for (let i = 0; i < 46; i++) {
      const x = (hash(i + tt * 9) * 2 - 1) * 330, v = 50 + hash(i * 3 + tt) * 90, y = 38 + v * a + 34 * a * a * hash(i);
      if (y < 268) g.fillRect(x + Math.sin(a * 3 + i) * 3, y, 1.6, 2.6 + hash(i) * 3);
    }
  }
  R.L(1.3);                                                                                    // вход: плащ-палатка и каска на гвозде
  poly(g, [-hw - 400, -60, -hw + 30, -60, -hw + 54 + Math.sin(T * 0.9) * 5, 120, -hw + 22 + Math.sin(T * 0.9 + 1) * 8, 260, -hw + 44, 400, -hw - 400, 400], '#020201');
  poly(g, [hw + 400, -60, hw - 10, -60, hw - 26, 400, hw + 400, 400], '#020201');
}

function sCrew(R) {
  const { g, t, T, hw } = R, open = er(t, 0.5, 1.6), zoom = er(t, 1.5, 4.4), a = t - 1.6;
  R.shake = a > 0 ? 3.5 * Math.exp(-a * 7) : 0;
  R.cam(1 + 0.62 * zoom, 0, 0, 170);
  R.L(1);
  // --- боевое отделение за дверью ---
  g.save(); g.beginPath(); g.rect(-98, 56, 196, 216); g.clip();
  g.fillStyle = R.grad('room4', 0, 56, 0, 272, [0, '#3b2a12', 0.55, '#6a4a1a', 1, '#2a1d0d']); g.fillRect(-98, 56, 196, 216);
  R.glow(4, 120, 150, 'ochre', 0.85); R.glow(4, 96, 46, 'white', 0.65 + 0.05 * Math.sin(T * 9));
  g.fillStyle = '#251a0c';                                                                      // казённик орудия, трубы, лотки
  g.fillRect(-22, 150, 58, 60); disc(g, 7, 180, 21, '#1d1409'); disc(g, 7, 180, 12, '#3a2912'); g.fillRect(-98, 62, 196, 9); g.fillRect(-98, 78, 196, 4);
  g.fillRect(-98, 228, 196, 44);
  for (let i = 0; i < 3; i++) { disc(g, 60 + i * 13, 96, 5, '#1d1409'); disc(g, 60 + i * 13, 96, 3.2, i === 1 ? '#e8e0c8' : '#b9a26a'); }
  R.glow(-80, 92, 9, 'red', 0.5 + 0.4 * Math.sin(T * 3));
  const sp = R.line, rimOf = (i) => `rgba(255,214,150,${sp === i ? 0.95 : 0.3})`, bob = (i) => (sp === i ? Math.sin(T * 6) * 0.5 : 0);
  // Громов у маховика
  person(g, -58, 262 + bob(0), 92, { dir: 1, cap: false, helmet: true, lean: 0.07, col: '#0a0703', rim: rimOf(0), rimSide: 1,
    arms: [[0.9, -6.3, 1.5, -5.4, 2.0, -5.0], [-0.9, -6.3, 0.2, -5.2, 1.7, -4.6]] });
  g.save(); g.translate(-32, 205); g.rotate(T * (sp === 0 ? 1.6 : 0.5)); g.strokeStyle = '#0a0703'; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, 13, 0, TAU);
  for (let i = 0; i < 3; i++) { g.moveTo(0, 0); g.lineTo(Math.cos(i * TAU / 3) * 13, Math.sin(i * TAU / 3) * 13); } g.stroke(); g.restore();
  // Седых со снарядом
  person(g, 6, 266 + bob(1), 104, { dir: 1, wide: 1.25, cap: false, col: '#0a0703', rim: rimOf(1), rimSide: -1,
    arms: [[1.1, -6.3, 1.5, -5.2, 0.6, -4.7], [-1.1, -6.3, -1.5, -5.2, -0.5, -4.6]] });
  g.save(); g.translate(8, 205 + bob(1)); g.rotate(-0.22); g.fillStyle = '#0a0703';
  g.beginPath(); g.moveTo(-26, -7); g.lineTo(12, -7); g.quadraticCurveTo(27, -5, 33, 0); g.quadraticCurveTo(27, 5, 12, 7); g.lineTo(-26, 7); g.closePath(); g.fill();
  g.fillStyle = `rgba(255,214,150,${sp === 1 ? 0.8 : 0.3})`; g.fillRect(-25, -7.4, 38, 1.4); g.fillStyle = '#d39a1e'; g.fillRect(-18, -7, 3, 14); g.restore();
  // Вяткин у рации
  person(g, 66, 262 + bob(2), 86, { dir: -1, cap: false, phones: true, col: '#0a0703', rim: rimOf(2), rimSide: -1,
    arms: [[0.9, -6.3, 1.2, -5.2, 1.7, -4.8], [-0.9, -6.3, -1.1, -5.3, -1.5, -6.6]] });
  g.fillStyle = '#0a0703'; g.fillRect(30, 214, 40, 50); R.glow(40, 224, 5, 'green', 0.5 + 0.5 * (Math.sin(T * 11) > 0.2 ? 1 : 0));
  g.restore();
  // --- стена коридора с проёмом ---
  g.fillStyle = '#0a0e12'; g.beginPath(); g.rect(-hw - 400, -100, 2 * hw + 800, 560); g.rect(-98, 56, 196, 216); g.fill('evenodd');
  g.strokeStyle = '#1b252d'; g.lineWidth = 6; g.strokeRect(-104, 50, 208, 228);
  g.fillStyle = '#243039';
  for (let i = 0; i < 8; i++) { disc(g, -104, 62 + i * 29, 2.2, '#243039'); disc(g, 104, 62 + i * 29, 2.2, '#243039'); }
  for (let i = 0; i < 7; i++) disc(g, -86 + i * 29, 50, 2.2, '#243039');
  g.fillStyle = 'rgba(232,224,200,.3)'; g.font = '600 15px Oswald, sans-serif'; g.textAlign = 'center'; g.fillText('БАШНЯ № 1', 0, 38);
  g.strokeStyle = '#11181e'; g.lineWidth = 5; g.beginPath(); g.moveTo(-hw - 400, 20); g.lineTo(hw + 400, 20); g.moveTo(-hw - 400, 30); g.lineTo(-150, 30); g.lineTo(-150, 300); g.stroke();
  g.fillStyle = '#06090c'; g.fillRect(-hw - 400, 272, 2 * hw + 800, 200);
  R.glow(-240, 44, 26, 'red', 0.3 + 0.1 * Math.sin(T * 2));                                      // дежурная лампа в коридоре
  // свет из проёма
  if (open > 0.01) {
    g.save(); g.globalCompositeOperation = 'lighter';
    g.fillStyle = R.grad('spill', 0, 272, 0, 372, [0, 'rgba(230,160,50,.5)', 1, 'rgba(230,160,50,0)']); g.globalAlpha = open;
    const xl = lerp(96, -98, open);
    g.beginPath(); g.moveTo(xl, 272); g.lineTo(98, 272); g.lineTo(190, 380); g.lineTo(xl - 90 * open, 380); g.closePath(); g.fill();
    g.restore();
    R.glow(0, 165, 210, 'ochre', 0.3 * open);
  }
  // створка: петли слева, уходит на зрителя
  const ang = open * 1.47, w = 196 * Math.cos(ang), sk = 20 * Math.sin(ang);
  g.fillStyle = R.grad('leaf', -98, 0, 98, 0, [0, '#2e3b46', 1, '#1a232b']);
  g.beginPath(); g.moveTo(-98, 56); g.lineTo(-98 + w, 56 - sk); g.lineTo(-98 + w, 272 + sk * 1.6); g.lineTo(-98, 272); g.closePath(); g.fill();
  g.strokeStyle = `rgba(255,200,110,${0.25 + 0.75 * Math.min(1, open * 3)})`; g.lineWidth = 1.6; g.beginPath(); g.moveTo(-98 + w, 56 - sk); g.lineTo(-98 + w, 272 + sk * 1.6); g.stroke();
  const cw = Math.cos(ang), cx = -98 + w * 0.5;
  g.strokeStyle = '#0d1317'; g.lineWidth = 4; g.beginPath(); g.ellipse(cx, 164, 22 * cw, 22, 0, 0, TAU); g.stroke();
  g.save(); g.translate(cx, 164); g.scale(cw, 1); g.rotate(open * 2.4); g.beginPath();
  for (let i = 0; i < 4; i++) { g.moveTo(0, 0); g.lineTo(Math.cos(i * Math.PI / 2) * 22, Math.sin(i * Math.PI / 2) * 22); } g.stroke(); g.restore();
  g.fillStyle = '#0d1317'; for (let i = 0; i < 5; i++) { g.fillRect(-98 + w * 0.08, 70 + i * 46, w * 0.84, 2); }
  // лейтенант со спины на переднем плане
  const fa = 1 - er(t, 2.6, 4.2);
  if (fa > 0.01) {
    R.L(1.25); g.globalAlpha = fa;
    person(g, lerp(-230, -176, er(t, 0, 1.4)), 520, 330, { dir: 1, col: '#020304', rim: `rgba(255,190,100,${0.6 * open})`, rimSide: 1 });
    g.globalAlpha = 1;
  }
}

function sRadio(R) {
  const { g, t, T, hw } = R, k = t / R.d;
  const sig = 0.5 + 0.5 * Math.sin(T * 7.3) * Math.sin(T * 2.9 + 1), on = er(t, 0.2, 0.9);
  R.cam(1.03 + 0.05 * k, -18 + 36 * k, 0, 180);
  R.L(0.6);
  g.fillStyle = R.grad('wall5', 0, 0, 0, 360, [0, '#10161b', 1, '#090d10']); g.fillRect(-hw - 300, -60, 2 * hw + 600, 480);
  g.fillStyle = '#0b1014'; for (let x = -Math.ceil((hw + 300) / 130) * 130; x < hw + 300; x += 130) { g.fillRect(x, -60, 3, 480); for (let y = 24; y < 280; y += 62) disc(g, x + 10, y, 2.4, '#19222a'); }
  // карта пролива на переборке: отметки конвоя ползут к батарее
  const mx = 150, my = 38;
  g.fillStyle = '#2b2a22'; g.fillRect(mx, my, 196, 138); g.fillStyle = 'rgba(232,224,200,.1)'; g.fillRect(mx + 4, my + 4, 188, 130);
  poly(g, [mx + 4, my + 4, mx + 192, my + 4, mx + 192, my + 30, mx + 150, my + 44, mx + 96, my + 34, mx + 50, my + 46, mx + 4, my + 36], '#3d3a2c');
  poly(g, [mx + 4, my + 134, mx + 192, my + 134, mx + 192, my + 108, mx + 140, my + 96, mx + 104, my + 106, mx + 60, my + 98, mx + 4, my + 112], '#3d3a2c');
  g.fillStyle = 'rgba(232,224,200,.4)'; g.font = '600 9px Oswald, sans-serif'; g.textAlign = 'left'; g.fillText('ПРОЛИВ', mx + 12, my + 76);
  g.strokeStyle = 'rgba(232,224,200,.3)'; g.lineWidth = 1; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(mx + 190, my + 70); g.quadraticCurveTo(mx + 110, my + 58, mx + 8, my + 72); g.stroke(); g.setLineDash([]);
  const bx = mx + 82, by = my + 101, pulse = (T * 0.6) % 1;
  disc(g, bx, by, 3.4, '#d39a1e');
  g.strokeStyle = `rgba(211,154,30,${0.7 * (1 - pulse)})`; g.lineWidth = 1.2; g.beginPath(); g.arc(bx, by, 6 + pulse * 34, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
  const adv = er(t, 3.0, R.d);
  for (let i = 0; i < 5; i++) {
    const u = clamp(adv * 0.62 - i * 0.07 + 0.02), q = 1 - u, sx = q * q * (mx + 190) + 2 * q * u * (mx + 110) + u * u * (mx + 8), sy = q * q * (my + 70) + 2 * q * u * (my + 58) + u * u * (my + 72);
    if (t < 3.0 + i * 0.25) continue;
    g.fillStyle = i % 2 ? '#ff8a5a' : '#ffb347'; g.beginPath(); g.moveTo(sx - 4, sy); g.lineTo(sx, sy - 3.4); g.lineTo(sx + 4, sy); g.lineTo(sx, sy + 3.4); g.closePath(); g.fill();
  }
  R.L(1);
  // стол и рация
  g.fillStyle = '#07090b'; g.fillRect(-hw - 320, 262, 2 * hw + 640, 140);
  g.fillStyle = R.grad('set5', 0, 104, 0, 262, [0, '#303c47', 1, '#1b242c']); g.fillRect(-306, 104, 252, 158);
  g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(-306, 104, 252, 2); g.fillStyle = '#0c1115'; g.fillRect(-306, 258, 252, 4);
  for (const [x, y] of [[-298, 112], [-62, 112], [-298, 250], [-62, 250]]) disc(g, x, y, 2.6, '#0c1115');
  // шкала настройки
  const dx = -222, dy = 172;
  disc(g, dx, dy, 50, '#0c1115'); disc(g, dx, dy, 45, '#141a1f');
  R.glow(dx, dy, 78, 'ochre', (0.35 + 0.3 * sig) * on);
  g.strokeStyle = `rgba(232,200,120,${0.35 + 0.5 * on})`; g.lineWidth = 1.2; g.beginPath();
  for (let i = 0; i <= 20; i++) { const a = Math.PI * (1.12 + 0.76 * i / 20), r0 = i % 5 ? 36 : 32; g.moveTo(dx + Math.cos(a) * r0, dy + Math.sin(a) * r0); g.lineTo(dx + Math.cos(a) * 41, dy + Math.sin(a) * 41); }
  g.stroke();
  const na = Math.PI * (1.5 + (0.18 * Math.sin(T * 1.3) + 0.05 * Math.sin(T * 17) * sig) * on - 0.3 * (1 - on));
  line(g, dx, dy, dx + Math.cos(na) * 38, dy + Math.sin(na) * 38, 1.8, '#ff6a4a'); disc(g, dx, dy, 5, '#0c1115');
  // ручки, лампа приёма, осциллограмма
  for (let i = 0; i < 2; i++) {
    const kx = -118, ky = 146 + i * 56, ka = T * (i ? -0.5 : 0.8) + i;
    disc(g, kx, ky, 17, '#0c1115'); disc(g, kx, ky, 13, '#232d36'); line(g, kx, ky, kx + Math.cos(ka) * 12, ky + Math.sin(ka) * 12, 2, '#e8e0c8');
  }
  const morse = ((T * 6) | 0) % 9, lampOn = on && (morse === 0 || morse === 2 || morse === 3 || morse === 4 || morse === 6);
  disc(g, -84, 122, 5, '#0c1115'); disc(g, -84, 122, 3.2, lampOn ? '#7dff9a' : '#1d3a26'); if (lampOn) R.glow(-84, 122, 16, 'green', 0.8);
  g.fillStyle = '#05080a'; g.fillRect(-296, 230, 144, 22);
  g.strokeStyle = `rgba(110,240,140,${0.85 * on})`; g.lineWidth = 1.3; g.beginPath();
  for (let i = 0; i <= 36; i++) { const x = -294 + i * 3.9, y = 241 + Math.sin(i * 0.9 + T * 14) * Math.sin(i * 0.23 + T * 3) * 8 * (0.25 + sig) * on; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
  g.stroke();
  // Вяткин в профиль, в наушниках; свет шкалы ложится на лицо
  const hx = 34, hy = 142, nod = Math.sin(T * 2.2) * 1.2, body = '#040608', rim = `rgba(230,170,70,${(0.45 + 0.35 * sig) * on + 0.12})`;
  const head = (col, ox) => {
    g.fillStyle = col; g.beginPath();
    g.moveTo(hx - 34 + ox, hy + 4 + nod); g.quadraticCurveTo(hx - 36 + ox, hy - 40 + nod, hx + 4 + ox, hy - 42 + nod);               // лоб и темя
    g.quadraticCurveTo(hx + 44 + ox, hy - 40 + nod, hx + 44 + ox, hy + 4 + nod); g.quadraticCurveTo(hx + 42 + ox, hy + 36, hx + 30 + ox, hy + 50);
    g.lineTo(hx + 96 + ox, hy + 74); g.lineTo(hx + 128 + ox, hy + 130); g.lineTo(hx - 70 + ox, hy + 130); g.lineTo(hx - 52 + ox, hy + 78); g.lineTo(hx - 12 + ox, hy + 56);
    g.lineTo(hx - 16 + ox, hy + 42 + nod); g.lineTo(hx - 30 + ox, hy + 38 + nod); g.lineTo(hx - 32 + ox, hy + 28 + nod); g.lineTo(hx - 37 + ox, hy + 26 + nod);
    g.lineTo(hx - 34 + ox, hy + 20 + nod); g.lineTo(hx - 44 + ox, hy + 14 + nod); g.closePath(); g.fill();                              // нос, губы, подбородок
  };
  head(rim, -2.4); head(body, 0);
  g.strokeStyle = '#0d1317'; g.lineWidth = 6; g.beginPath(); g.arc(hx + 6, hy - 2 + nod, 44, Math.PI * 1.05, Math.PI * 1.72); g.stroke();
  disc(g, hx + 12, hy + 6 + nod, 19, '#0d1317'); disc(g, hx + 12, hy + 6 + nod, 13, '#1b252d');
  g.strokeStyle = rim; g.lineWidth = 1.4; g.beginPath(); g.arc(hx + 12, hy + 6 + nod, 19, Math.PI * 0.75, Math.PI * 1.45); g.stroke();
  // рука с карандашом, блокнот заполняется строками
  g.save(); g.translate(-30, 244); g.rotate(-0.06); g.fillStyle = '#b9b092'; g.fillRect(0, 0, 96, 22); g.fillStyle = '#d6cdae'; g.fillRect(0, 0, 96, 3);
  g.strokeStyle = '#2a2a22'; g.lineWidth = 1.1; g.beginPath();
  const wr = ramp(t, 2.6, R.d - 0.4) * 3;
  for (let r = 0; r < 3; r++) { const len = clamp(wr - r) * 78; if (len > 0) { g.moveTo(8, 7 + r * 5); for (let x = 0; x < len; x += 4) g.lineTo(8 + x, 7 + r * 5 + Math.sin(x * 1.7 + r) * 1.2); } }
  g.stroke();
  const pr = Math.min(2, Math.floor(wr)), px = 8 + clamp(wr - pr) * 78, pyy = 7 + pr * 5;
  line(g, px, pyy, px + 20, pyy - 30, 2.4, '#d39a1e'); g.restore();
  g.strokeStyle = body; g.lineWidth = 15; g.lineCap = 'round'; g.beginPath(); g.moveTo(hx + 96, hy + 110); g.lineTo(-30 + px + 34, 244 + pyy - 6); g.stroke();
  R.L(1.3);                                                                                    // передний план: провода и микрофон не в фокусе
  g.strokeStyle = '#020304'; g.lineWidth = 9; g.beginPath(); g.moveTo(-hw - 60, 290); g.bezierCurveTo(-hw + 60, 380 + Math.sin(T) * 3, -hw + 180, 300, -hw + 250, 400); g.stroke();
  g.fillStyle = '#020304'; g.fillRect(hw - 76, 250, 12, 160); disc(g, hw - 70, 236, 26, '#020304');
  g.save(); g.translate(0, 180); g.fillStyle = R.grad('dark5', 0, 0, 0, 0, [0.45, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,.7)'], 560); g.fillRect(-900, -500, 1800, 1000); g.restore();
}

function sDawn(R) {
  const { g, t, T, hw } = R, d = er(t, 0, 6.2), k = Math.min(1, t / 9);
  R.cam(1 + 0.07 * k, 36 - 76 * ease(k), 0, 200);
  R.L(0);
  g.fillStyle = R.grad('skyN', 0, 0, 0, 216, [0, '#05080c', 0.6, '#101a23', 1, '#1d2a35']); g.fillRect(-hw - 300, -60, 2 * hw + 600, 280);
  g.globalAlpha = d; g.fillStyle = R.grad('skyD', 0, 0, 0, 216, [0, '#1d2b3a', 0.5, '#4c5560', 0.82, '#a87a45', 1, '#e9b45a']); g.fillRect(-hw - 300, -60, 2 * hw + 600, 280); g.globalAlpha = 1;
  const sx = -150, sy = 222 - 16 * d;
  R.glow(sx, sy, 260, 'warm', 0.7 * d); R.glow(sx, sy, 70, 'white', 0.75 * d);
  R.L(0.1);
  g.globalAlpha = 0.5; g.fillStyle = '#1a2129';                                                 // слоистые облака
  for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse((hash(i) * 2 - 1) * (hw + 100) + T * (2 + i * 0.6), 60 + i * 21, 150 + hash(i + 3) * 120, 4 + hash(i + 6) * 5, 0, 0, TAU); g.fill(); }
  g.globalAlpha = 1;
  R.L(0.2);
  poly(g, [-hw - 320, 216, -hw - 320, 190, -hw - 60, 184, -hw + 40, 196, -hw + 130, 210, -hw + 190, 216], '#17212a');
  // конвой на горизонте
  for (let i = 0; i < 6; i++) {
    const x = 330 - i * 96 - t * 7 + hash(i) * 20, s = 0.5 + hash(i + 2) * 0.22, kind = i === 0 || i === 3 ? 1 : 0, fx = kind ? 17 * s : 7 * s, fy = 215 - (kind ? 21 : 28) * s;
    for (let j = 0; j < 7; j++) {                                                               // дымы
      const q = ((T * 0.22 + j / 7 + hash(i)) % 1);
      g.globalAlpha = (1 - q) * 0.42; disc(g, x + fx + q * 54, fy - q * 24 - Math.sin(q * 5 + i) * 3, 2 + q * 9, '#232a31');
    }
    g.globalAlpha = 1; ship(g, x, 215, s, kind, '#101820');
  }
  R.L(0.3);
  g.fillStyle = R.grad('seaD', 0, 214, 0, 360, [0, '#3d4650', 0.12, '#1c2831', 1, '#070b0f']); g.fillRect(-hw - 320, 214, 2 * hw + 640, 170);
  g.fillStyle = `rgba(255,206,130,${0.55 * d})`;                                                // дорожка от солнца
  for (let i = 0; i < 26; i++) { const y = 217 + i * 3.6 + i * i * 0.06, w = (6 + i * 2.2) * (0.6 + 0.4 * Math.sin(T * 3 + i * 1.7)); g.fillRect(sx - w / 2 + Math.sin(T * 1.1 + i) * 4, y, w, 1.3); }
  g.strokeStyle = 'rgba(200,215,225,.12)'; g.lineWidth = 1; g.beginPath();
  for (let i = 0; i < 20; i++) { const y = 222 + i * 5.6, x = (hash(i + 40) * 2 - 1) * (hw + 200) + Math.sin(T * 0.7 + i) * 7; g.moveTo(x, y); g.lineTo(x + 14 + hash(i) * 30, y); }
  g.stroke();
  R.L(0.45); R.fog(176 + 26 * d, 86, 0.7 * (1 - 0.8 * d), -T * 8);
  R.L(0.85);                                                                                   // утёс и башня на переднем плане
  poly(g, [-10, 400, 30, 318, 74, 286, 130, 268, 200, 262, hw + 340, 256, hw + 340, 400], '#070b0e');
  const c = lerp(0.8, -1, er(t, 1.2, 5.4)), el = lerp(0.04, 0.17, er(t, 3.6, 6.0));
  turret(g, 232, 262, 1.7, c, el, '#070b0e', `rgba(240,180,90,${0.75 * d})`);
  person(g, 96, 276, 46, { dir: -1, col: '#070b0e', rim: `rgba(240,180,90,${0.8 * d})`, rimSide: 1, arms: [[0.9, -6.3, 1.4, -6.6, 0.9, -7.3], [-0.9, -6.3, 0.2, -6.4, 0.7, -7.3]] });
  R.L(1.3); R.fog(262 + 30 * d, 120, 0.4 * (1 - 0.6 * d), T * 14);
}

const SCENES = [
  { name: 'ПРИБЫТИЕ', d: 8.0, wind: 0.75, hiss: 0, draw: sArrival, cues: [{ at: 5.2, s: 'introGuns' }], lines: [
    { at: 0.6, who: '', text: 'Осень. Береговая батарея «Утёс». Туман третьи сутки стоит над проливом.' },
    { at: 4.2, who: '', text: 'Новый лейтенант добрался сюда ночью — с предписанием и одним вещмешком.' }] },
  { name: 'ОБСТРЕЛ', d: 7.8, wind: 0.5, hiss: 0, draw: sShelling,
    cues: [{ at: 2.6, s: 'introWhistle' }, { at: 3.1, s: 'introBlast', a: 0.55, vib: 40 }, { at: 4.1, s: 'introWhistle' }, { at: 4.6, s: 'introBlast', a: 1, vib: 90 }], lines: [
      { at: 0.4, who: '', text: 'До штаба он дойти не успел: с моря ударили тяжёлые орудия.' },
      { at: 5.0, who: '', text: 'Второй залп накрыл дальномерный пост. Там был командир батареи.' }] },
  { name: 'КОМАНДИР', d: 7.8, wind: 0.14, hiss: 0, draw: sCommander, cues: [{ at: 1.6, s: 'introGuns' }, { at: 4.9, s: 'introGuns' }], lines: [
    { at: 0.8, who: 'Командир батареи', text: 'Опоздал ты, лейтенант… или в самый раз. Мне отсюда уже не встать.' },
    { at: 4.2, who: 'Командир батареи', text: 'Принимай башню. Расчёт своё дело знает — слушай их, а считай сам.' }] },
  { name: 'РАСЧЁТ', d: 9.4, wind: 0.08, hiss: 0, draw: sCrew, cues: [{ at: 0.5, s: 'introDoor' }], lines: [
    { at: 2.3, who: 'Громов', text: 'Наводчик Громов. Маховики смазаны, прицел выверен.' },
    { at: 4.7, who: 'Седых', text: 'Заряжающий Седых. Снаряды в лотках, заряды сухие.' },
    { at: 7.1, who: 'Вяткин', text: 'Радист Вяткин. Связь с постами держу.' }] },
  { name: 'ЭФИР', d: 8.0, wind: 0, hiss: 0.85, draw: sRadio, cues: [{ at: 0.3, s: 'introMorse' }, { at: 2.7, s: 'introMorse' }], lines: [
    { at: 0.7, who: 'Вяткин', text: 'Товарищ лейтенант, пост «Маяк» на связи!' },
    { at: 3.0, who: 'Вяткин', text: 'Конвой противника на рассвете пойдёт через пролив. Транспорты и охранение, идут под прикрытием тумана.' }] },
  { name: 'РАССВЕТ', d: 6.2, wind: 0.4, hiss: 0, draw: sDawn, cues: [{ at: 3.4, s: 'introGuns' }], lines: [
    { at: 0.9, who: '', text: 'Рассвет. Туман редеет — на горизонте дымы.' },
    { at: 4.1, who: 'Громов', text: 'Башня ваша, лейтенант. К бою!' }] },
];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const TOTAL = SCENES.reduce((s, sc) => s + sc.d, 0);

// ---------------------------------------------------------------- ролик

const GLOWS = { warm: '255,186,96', cold: '170,200,225', ochre: '226,160,44', white: '255,240,214', red: '255,84,56', green: '110,240,140' };

/**
 * @param {object} o
 *   engine    — движок (берётся engine.audio); можно не передавать
 *   audio     — звук напрямую (если нет engine)
 *   getVolume — () => 0..1, громкость ролика; по умолчанию 0.8 (общий «ЗВУК ВЫКЛ» и так глушит engine.audio целиком)
 *   storage   — { get(k), set(k, v), remove(k) }; по умолчанию localStorage
 */
export function createIntro({ engine = null, audio = null, getVolume = null, storage = null } = {}) {
  const au = audio || (engine && engine.audio) || null;
  const snd = (name, a) => { try { if (au && typeof au[name] === 'function') au[name](a); } catch (e) { /* звук не должен ломать ролик */ } };
  const store = storage || {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* хранилище недоступно */ } },
    remove: (k) => { try { localStorage.removeItem(k); } catch (e) { /* хранилище недоступно */ } },
  };
  let mem = false;                       // запасная память, если хранилище недоступно
  const seen = () => { let v = null; try { v = store.get(INTRO_KEY); } catch (e) { /* нет */ } return v === '1' || mem; };
  const markSeen = () => { mem = true; try { store.set(INTRO_KEY, '1'); } catch (e) { /* нет */ } };
  const reset = () => { mem = false; try { if (store.remove) store.remove(INTRO_KEY); else store.set(INTRO_KEY, ''); } catch (e) { /* нет */ } };

  let run = null;                        // текущий показ

  /**
   * Показать ролик. opts: onDone({ skipped, reason }), rate (ускорение времени, для тестов), mark (false — не отмечать «просмотрен»).
   * → { skip(), next(), seek(scene, t), pause(b), state() }
   */
  function play(opts = {}) {
    if (run) { if (typeof opts.onDone === 'function') run.done.push(opts.onDone); return run.handle; }
    const done = typeof opts.onDone === 'function' ? [opts.onDone] : [];
    const rate = Math.max(0.1, +opts.rate || 1), doc = document;
    const me = run = { done, handle: null };
    let over = false;
    const finishNow = (reason) => {      // всё убрать и доложить — ровно один раз
      if (over) return; over = true;
      try { cleanup(); } catch (e) { /* уже убрано */ }
      if (run === me) run = null;
      if (opts.mark !== false) markSeen();
      const info = { skipped: reason === 'skip', reason };
      for (const fn of me.done) { try { fn(info); } catch (e) { try { console.error(e); } catch (e2) { /* нет консоли */ } } }
    };
    let cleanup = () => {};

    let root, cv, g;
    try {
      root = doc.createElement('div'); root.className = 'ai'; root.id = 'arta-intro';
      root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Вступительный ролик');
      root.innerHTML = '<canvas class="ai-cv"></canvas><div class="ai-ch"></div>' +
        '<div class="ai-title"><div class="ai-t1">АРТА<i>·</i>БАШНЯ</div><div class="ai-t2">БЕРЕГОВАЯ БАТАРЕЯ «УТЁС»</div><button type="button" class="ai-go" data-ai="go">К БОЮ</button></div>' +
        '<div class="ai-band"><div class="ai-who"></div><div class="ai-txt"><span class="on"></span><span class="off"></span></div>' +
        '<div class="ai-bar"><i class="ai-prog"></i></div></div>' +
        '<button type="button" class="ai-skip" data-ai="skip" aria-label="Пропустить ролик">ПРОПУСТИТЬ<i>▸▸</i></button>';
      cv = root.firstChild; g = cv.getContext('2d');
    } catch (e) { g = null; }
    if (!g) { me.handle = { skip() {}, next() {}, seek() {}, pause() {}, state: () => null }; finishNow('nocanvas'); return me.handle; }

    const style = doc.createElement('style'); style.id = 'arta-intro-css'; style.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(style);
    const $ = (c) => root.querySelector(c);
    const elCh = $('.ai-ch'), elWho = $('.ai-who'), elTxt = $('.ai-txt'), elOn = $('.ai-txt .on'), elOff = $('.ai-txt .off'), elProg = $('.ai-prog'), elTitle = $('.ai-title'), elBar = $('.ai-bar');
    let acc = 0;
    for (let i = 0; i < SCENES.length - 1; i++) { acc += SCENES[i].d; const s = doc.createElement('s'); s.style.left = (acc / TOTAL * 100) + '%'; elBar.appendChild(s); }
    doc.body.appendChild(root);

    // ---- спрайты и кэш градиентов ----
    const sprites = {};
    const mk = (w, h) => { const c = doc.createElement('canvas'); c.width = w; c.height = h; return c; };
    for (const key in GLOWS) {
      const c = mk(128, 128), x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, `rgba(${GLOWS[key]},1)`); gr.addColorStop(0.25, `rgba(${GLOWS[key]},.5)`); gr.addColorStop(0.6, `rgba(${GLOWS[key]},.12)`); gr.addColorStop(1, `rgba(${GLOWS[key]},0)`);
      x.fillStyle = gr; x.fillRect(0, 0, 128, 128); sprites[key] = c;
    }
    {
      const c = mk(512, 128), x = c.getContext('2d');                                           // туман: бесшовная по горизонтали полоса
      for (let i = 0; i < 44; i++) {
        const px = hash(i) * 512, py = 30 + hash(i + 50) * 68, r = 26 + hash(i + 90) * 34;
        for (const ox of [-512, 0, 512]) {
          const gr = x.createRadialGradient(px + ox, py, 0, px + ox, py, r);
          gr.addColorStop(0, 'rgba(150,172,190,.2)'); gr.addColorStop(1, 'rgba(150,172,190,0)');
          x.fillStyle = gr; x.fillRect(px + ox - r, py - r, 2 * r, 2 * r);
        }
      }
      sprites.fog = c;
    }
    const grads = new Map();

    // ---- состояние ----
    let idx = 0, t = 0, T = 0, title = false, titleAt = 0, out = -1, paused = false, raf = 0, last = 0, loopT = 1, lineShown = -2, charsShown = -1;
    let cw = 0, ch = 0, sc = 1, ox = 0, oy = 0, vw = 780, dirty = true;
    const fired = new Set();
    const cam = { z: 1, px: 0, py: 0, zy: 180 };

    const R = {
      g, t: 0, T: 0, d: 1, hw: 390, line: -1, shake: 0,
      cam(z, px, py, zy) { cam.z = z; cam.px = px || 0; cam.py = py || 0; cam.zy = zy == null ? 180 : zy; },
      L(par) {
        const z = cam.z, s = sc * z;
        const shx = R.shake ? (hash(T * 61.3) - 0.5) * 2 * R.shake * sc : 0, shy = R.shake ? (hash(T * 47.9 + 5) - 0.5) * 2 * R.shake * sc : 0;
        g.setTransform(s, 0, 0, s, ox + sc * vw / 2 - s * cam.px * par + shx, oy + sc * (cam.zy - z * cam.zy - z * cam.py * par) + shy);
        g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      },
      glow(x, y, r, key, a) {
        if (a <= 0.004 || r <= 0) return;
        const pa = g.globalAlpha, pc = g.globalCompositeOperation;
        g.globalAlpha = Math.min(1, a); g.globalCompositeOperation = 'lighter';
        g.drawImage(sprites[key], x - r, y - r, 2 * r, 2 * r);
        g.globalAlpha = pa; g.globalCompositeOperation = pc;
      },
      fog(y, h, a, off) {
        if (a <= 0.01) return;
        const tw = h * 4, x0 = -R.hw - 320, m = ((off % tw) + tw) % tw;
        g.globalAlpha = a;
        for (let x = x0 - tw + m; x < R.hw + 320; x += tw) g.drawImage(sprites.fog, x, y, tw + 0.5, h);
        g.globalAlpha = 1;
      },
      rain(k) {
        const w = 2 * R.hw + 240;
        g.strokeStyle = 'rgba(190,210,225,.2)'; g.lineWidth = 1; g.beginPath();
        for (let i = 0; i < 80 * k; i++) {
          const y = ((hash(i + 7) + T * (1.5 + hash(i) * 0.9)) % 1) * 420 - 30, x = hash(i * 1.7) * w - w / 2 - y * 0.24;
          g.moveTo(x, y); g.lineTo(x - 4.2, y + 17);
        }
        g.stroke();
      },
      /** Кэшируемый градиент: линейный (x0,y0)→(x1,y1) или, если задан r, радиальный из (x0,y0). */
      grad(key, x0, y0, x1, y1, stops, r) {
        let gr = grads.get(key);
        if (!gr) {
          gr = r ? g.createRadialGradient(x0, y0, 0, x0, y0, r) : g.createLinearGradient(x0, y0, x1, y1);
          for (let i = 0; i < stops.length; i += 2) gr.addColorStop(stops[i], stops[i + 1]);
          grads.set(key, gr);
        }
        return gr;
      },
    };

    function resize() {
      const r = root.getBoundingClientRect(), W = Math.max(1, r.width), H = Math.max(1, r.height);
      const k = Math.min(Math.min(window.devicePixelRatio || 1, 2), 1280 / W);                // холст не шире 1280 точек
      cw = Math.max(2, Math.round(W * k)); ch = Math.max(2, Math.round(H * k));
      if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
      const asp = clamp(cw / ch, 1.5, 2.9);                                                    // вне этих пропорций — поля
      vw = VH * asp; sc = Math.min(cw / vw, ch / VH);
      ox = (cw - vw * sc) / 2; oy = (ch - VH * sc) / 2;
      R.hw = vw / 2; dirty = true;
    }

    function setScene(i, at) {
      idx = clamp(i, 0, SCENES.length - 1); t = Math.max(0, at || 0); fired.clear(); lineShown = -2; charsShown = -1;
      for (const c of SCENES[idx].cues) if (c.at < t) fired.add(c);
      R.shake = 0;
      if (idx < SCENES.length - 1 && title) { title = false; elTitle.classList.remove('on'); }
      elCh.innerHTML = '<b>' + ROMAN[idx] + '</b>' + SCENES[idx].name;
    }

    function subtitles(scn) {
      let li = -1;
      for (let i = 0; i < scn.lines.length; i++) if (t >= scn.lines[i].at) li = i;
      R.line = li;
      if (li !== lineShown) {
        lineShown = li; charsShown = -1;
        const ln = li >= 0 ? scn.lines[li] : null;
        elWho.textContent = ln ? ln.who : '';
        elTxt.classList.toggle('narr', !!ln && !ln.who);
        if (!ln) { elOn.textContent = ''; elOff.textContent = ''; }
      }
      if (li < 0) return;
      const ln = scn.lines[li], n = Math.min(ln.text.length, Math.floor((t - ln.at) * CPS));
      if (n !== charsShown) {
        if (n > charsShown && n < ln.text.length && ln.text[n - 1] !== ' ') snd('introKey');
        charsShown = n; elOn.textContent = ln.text.slice(0, n); elOff.textContent = ln.text.slice(n);
      }
    }

    function draw() {
      const scn = SCENES[idx];
      R.t = t; R.T = T; R.d = scn.d; R.shake = 0;
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      g.fillStyle = '#000'; g.fillRect(0, 0, cw, ch);
      g.save(); g.beginPath(); g.rect(ox, oy, vw * sc, VH * sc); g.clip();
      g.fillStyle = NIGHT; g.fillRect(ox, oy, vw * sc, VH * sc);
      cam.z = 1; cam.px = cam.py = 0; cam.zy = 180;
      scn.draw(R);
      g.setTransform(sc, 0, 0, sc, ox + sc * vw / 2, oy); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      g.fillStyle = R.grad('vig', 0, 170, 0, 0, [0.55, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,.5)'], 520); g.fillRect(-R.hw, 0, vw, VH);   // виньетка
      const fade = Math.max(1 - t / FADE, idx < SCENES.length - 1 ? (t - (scn.d - FADE)) / FADE : 0);
      if (fade > 0) { g.globalAlpha = Math.min(1, fade); g.fillStyle = '#000'; g.fillRect(-R.hw, 0, vw, VH); g.globalAlpha = 1; }
      g.restore();
    }

    function step(dt) {
      const scn = SCENES[idx], lastScene = idx === SCENES.length - 1;
      t += dt; T += dt;
      for (const c of scn.cues) if (!fired.has(c) && t >= c.at) {
        fired.add(c); snd(c.s, c.a);
        if (c.vib && typeof opts.vibrate === 'function') { try { opts.vibrate(c.vib); } catch (e) { /* вибрации нет */ } }
      }
      if (!lastScene && t >= scn.d) { setScene(idx + 1, 0); return; }
      if (lastScene && !title && t >= scn.d) { title = true; titleAt = t; elTitle.classList.add('on'); snd('introTitle'); }
      if (lastScene && title && t - titleAt >= HOLD) finish('end');
    }

    function frame(now) {
      raf = 0;
      if (over) return;
      try {
        const real = Math.min(0.1, last ? (now - last) / 1000 : 0.016); last = now;
        const dt = paused ? 0 : real * rate;
        if (out >= 0) {
          out += real * Math.max(1, rate);
          root.style.opacity = String(clamp(1 - out / 0.45));
          if (out >= 0.45) { finishNow(outReason); return; }
        } else if (dt > 0) step(dt);
        if (over) return;
        if (dirty) { dirty = false; grads.clear(); }
        subtitles(SCENES[idx]);
        draw();
        let prog = 0; for (let i = 0; i < idx; i++) prog += SCENES[i].d;
        elProg.style.transform = 'scaleX(' + clamp((prog + Math.min(t, SCENES[idx].d)) / TOTAL).toFixed(4) + ')';
        loopT += real;
        if (loopT > 0.2) {                                                                      // звуковые петли и громкость — пять раз в секунду
          loopT = 0;
          let v = 0.8; try { if (getVolume) v = +getVolume(); } catch (e) { v = 0; }
          const live = out < 0 && !paused;
          snd('introVolume', live ? clamp(v || 0) : 0); snd('introWind', live ? SCENES[idx].wind : 0); snd('introHiss', live ? SCENES[idx].hiss : 0);
        }
      } catch (e) {
        try { console.error(e); } catch (e2) { /* нет консоли */ }
        finishNow('error'); return;
      }
      raf = requestAnimationFrame(frame);
    }

    let outReason = 'end';
    // пока ролик гаснет (0,45 с), он по-прежнему перехватывает касания: иначе второе касание двойного нажатия на
    // «ПРОПУСТИТЬ» попадало в кнопку экрана под роликом
    function finish(reason) { if (over || out >= 0) return; outReason = reason; out = 0; snd('introWind', 0); snd('introHiss', 0); }
    function next() {
      if (over || out >= 0) return;
      if (idx < SCENES.length - 1) setScene(idx + 1, 0);
      else if (!title) t = Math.max(t, SCENES[idx].d);
    }

    // ---- ввод ----
    const onDown = (e) => {
      const b = e.target && e.target.closest ? e.target.closest('[data-ai]') : null;
      if (b) return;                                   // кнопки срабатывают по click
      if (e.cancelable && e.type !== 'pointerdown') e.preventDefault();
      next();
    };
    const onClick = (e) => {
      const b = e.target && e.target.closest ? e.target.closest('[data-ai]') : null;
      if (!b) return;
      e.stopPropagation();
      snd('tick');
      finish(b.dataset.ai === 'skip' ? 'skip' : 'end');
    };
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); finish('skip'); } else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (title) finish('end'); else next();
      }
    };
    const onVis = () => {
      if (doc.hidden) { if (raf) { cancelAnimationFrame(raf); raf = 0; } snd('introWind', 0); snd('introHiss', 0); } else if (!raf && !over) { last = 0; loopT = 1; raf = requestAnimationFrame(frame); }
    };
    const stop = (e) => { e.stopPropagation(); };
    const BLOCK = ['pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'mousedown', 'mouseup', 'wheel', 'contextmenu'];
    root.addEventListener('pointerdown', onDown);
    root.addEventListener('click', onClick);
    for (const ev of BLOCK) root.addEventListener(ev, stop);          // события не уходят к игре под роликом
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', onKey, true);
    doc.addEventListener('visibilitychange', onVis);

    cleanup = () => {
      if (raf) cancelAnimationFrame(raf); raf = 0;
      root.removeEventListener('pointerdown', onDown); root.removeEventListener('click', onClick);
      for (const ev of BLOCK) root.removeEventListener(ev, stop);
      window.removeEventListener('resize', resize); window.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('visibilitychange', onVis);
      snd('introStop');
      if (root.parentNode) root.parentNode.removeChild(root);
      if (style.parentNode) style.parentNode.removeChild(style);
      for (const key in sprites) { sprites[key].width = sprites[key].height = 0; delete sprites[key]; }
      grads.clear(); cv.width = cv.height = 0;
    };

    me.handle = {
      /** Закрыть ролик (как кнопка «ПРОПУСТИТЬ»). */
      skip() { finish('skip'); },
      /** Следующая сцена (как касание экрана). */
      next,
      /** Перейти к сцене i на секунду at (для стенда и снимков). */
      seek(i, at) { if (!over && out < 0) { setScene(i, at); if (idx === SCENES.length - 1 && t >= SCENES[idx].d && !title) { title = true; titleAt = t; elTitle.classList.add('on'); } } },
      pause(b) { paused = !!b; },
      state: () => (over ? null : { scene: idx, t, title, scenes: SCENES.length, total: TOTAL, closing: out >= 0 }),
    };

    resize(); setScene(0, 0);
    snd('introVolume', 0);
    raf = requestAnimationFrame(frame);
    return me.handle;
  }

  return { play, seen, markSeen, reset, isPlaying: () => !!run, skip() { if (run) run.handle.skip(); }, KEY: INTRO_KEY, duration: TOTAL };
}
