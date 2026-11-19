// Каталог разовых звуков. Каждый — рецепт из слоёв (см. kit.js); тяжёлые и частые просчитываются заранее в буферы
// (bank.js), до готовности буфера тот же рецепт играет вживую в облегчённом виде (k.lite).
//
// Поля рецепта: d — длительность просчёта, с; sr — доля частоты дискретизации (глухим звукам хватает половины и
// четверти — экономия памяти); v — число вариантов; g — громкость (пик на шине: буферы нормируются к 1);
// sp — пространство (in — в башне, big — тяжёлое в башне + эхо снаружи, out — далеко над морем, dry — без эха,
// ui — интерфейс); bus — шина (по умолчанию fx); gap — минимальный промежуток между повторами, с; jit — разброс высоты;
// loop — длина бесшовной петли, с (хвост рецепта заворачивается в начало).
//
// ┌──────────────┬────────┬──────────────────────────────────────────────────────────────────────────────────────┐
// │ рецепт       │ длит.  │ слои                                                                                 │
// ├──────────────┼────────┼──────────────────────────────────────────────────────────────────────────────────────┤
// │ gun          │ 0.9 ×3 │ суб-удар 58→30 и 41→27 Гц через насыщение · треск ВЧ · тело-шум 2200→140 · середина    │
// │              │        │ 520→180 и треугольник 210→70 (слышно в динамике телефона) · лязг казны (лист, ЧМ)     │
// │ gunTail      │ 2.6    │ звон брони (лист 142 и 610 Гц) · дребезг через гребёнку · раскат 260→60 · звон в ушах  │
// │ whoosh       │ 1.2    │ шум 1800→300 с дрожью вращения · уходящий тон 500→180                                  │
// │ impWater     │ 1.6 ×2 │ глухой удар 70→35 · столб воды (шум 1500→500, медленная атака) · брызги ВЧ             │
// │ impLand      │ 1.6 ×2 │ удар 60→28 · разрыв НЧ-шум 700→60 через насыщение · осыпь                              │
// │ impSteel     │ 1.6    │ удар · звон листа 220 Гц · треск · ЧМ-скрежет                                          │
// │ enemyGun     │ 2.2 ×2 │ далёкий залп: два-три раската НЧ-шума 150→40 и синуса 44→26                            │
// │ nearMiss     │ 2.6 ×2 │ удар грунта 52→22 · разрыв 800→60 · пыль ВЧ · дребезг и стук незакреплённого           │
// │ turretHit    │ 3.2 ×2 │ треск · огромный лязг (лист 96 и 233 Гц, 12 мод) · суб 48→24 · ЧМ-хруст · обломки      │
// │ fault        │ 1.5 ×2 │ электрический треск (ЧМ + шум, 5–7 вспышек) · шипение пара 4→2.5 кГц                   │
// │ breechOpen   │ 1.1 ×2 │ поворот поршня (ЧМ-скрежет + 9 щелчков нарезки) · засов (брусок 520, лист 310) · упор   │
// │ breechClose  │ 1.1 ×2 │ ход затвора · удар (90→40, лист 260) · доворот с щелчками вверх · защёлка               │
// │ hoistStart   │ 0.45   │ контактор · рывок цепи                                                                 │
// │ hoistLoop    │ петля  │ трещотка цепи: 10 звеньев на 0.96 с через гребёнку 310 Гц (мотор — живой генератор)    │
// │ hoistStop    │ 0.6    │ тормоз-упор · цепь оседает (3 щелчка) · звон лотка                                     │
// │ ram          │ 1.0 ×2 │ пневматика: шипение 3000→700 · клапан · удар 85→36 с листом 180 · выхлоп               │
// │ charge       │ 0.4 ×2 │ мягкий удар картуза 95→50 · ткань (НЧ-шум) · шорох                                     │
// │ unload       │ 1.3    │ цепь вниз (8 щелчков, замедляясь) · звон гильзы/поддона (колокол 780) · упор           │
// │ detent       │ 0.08×3 │ щелчок фиксатора: ВЧ-шум 8 мс · брусок 2.3 кГц · тело 340 Гц                           │
// │ tick         │ 0.05×3 │ лёгкий щелчок: ВЧ-шум 6 мс · треугольник 2.3 кГц                                       │
// │ clunk        │ 0.35×2 │ упор/тормоз: удар 120→52 · НЧ-шум · лист 330 · щелчок                                  │
// │ lever        │ 0.5 ×2 │ скольжение 900→300 · упор 105→48 · брусок 620 · пружина (ЧМ)                           │
// │ toggle       │ 0.09×2 │ два щелчка (переброс и посадка) · тело 190 · брусок 3.1 кГц                            │
// │ button       │ 0.12×2 │ нажатие (НЧ-шум + 260→180) · возврат                                                   │
// │ selector     │ 0.12×2 │ галетник: стук 1.1 кГц · треугольник 420 · брусок 1.7 кГц · отскок                     │
// │ cover        │ 0.3 ×2 │ скрип петли (ЧМ) · щелчок · лист 900 · тело 210                                        │
// │ relay        │ 0.06×2 │ два щелчка якоря через 8 мс                                                            │
// │ drum         │ 0.05×3 │ барабанчик счётчика: шум 1.8 кГц · треугольник 1250 · стук 300                         │
// │ buzz         │ 0.35   │ зуммер: пила 112 + меандр 168 через насыщение и полосу 900 · дрожь 56 Гц               │
// │ bell         │ 1.5    │ звонок телеграфа: колокол 1320 Гц (10 мод) · молоточек                                 │
// │ paper        │ 0.3 ×2 │ шорох бумаги/линейки: шум 2.5→4 кГц с трепетом · трение 600                            │
// │ pin          │ 0.12×2 │ булавка в планшет: тон 900→500 · щелчок                                                │
// │ loupe        │ 0.25   │ латунь и стекло: колокол 2.6 кГц · шорох · щелчок                                      │
// │ sqOpen/Close │ 0.12   │ шумоподавитель: щелчок · всплеск эфира (· «хвост» при закрытии)                        │
// │ radio_<кто>  │ 0.75   │ открытие · эфир · посылка (свой рисунок у hq, spotter, crew, meteo, convoy) · закрытие │
// │ radio_<кто>_u│ 0.9    │ срочная: посылка дважды, на кварту выше, жёстче                                        │
// │ aaShot       │ 0.4 ×3 │ удар 150→60 через насыщение · треск 1500→420 · звон ствола (брусок 730) · затвор       │
// │ aaLoop       │ петля  │ спарка: 8 выстрелов на 0.88 с, стволы 730/790 Гц по очереди · звон гильз               │
// │ aaTail       │ 1.0 ×2 │ дозвон ствола · гильзы по стали (5 с отскоками) · эхо над морем                        │
// │ overheat     │ 1.6    │ шипение 3.5 и 7 кГц · потрескивание                                                    │
// │ jam          │ 0.5 ×2 │ клин: удар · лист 410 · брусок 1250 · ЧМ-хруст · отскок                                │
// │ bombBurst    │ 2.8 ×2 │ удар 64→24 · разрыв 1100→55 · треск · земля сверху · дребезг                           │
// │ creak        │ 1.0 ×3 │ скрип металла: узкая полоса с рывками (трение) · стон 140→120                          │
// │ drip         │ 0.25×3 │ капля: два восходящих чирпа                                                            │
// │ foghorn      │ 3.2    │ ревун в тумане: пилы 82 и 123 Гц через НЧ-фильтр, вибрато                              │
// │ farThunder   │ 4.0    │ дальний гром: раскат НЧ-шума с тремя волнами · синус 38                                │
// │ rainLoop     │ петля  │ капли по броне: 70 капель на 2.4 с (шум + звон листа)                                  │
// │ uiTap … daily│        │ интерфейс: см. рецепты ниже (фанфара — «медные» голоса k.brass, литавра, колокольчики) │
// │ intro*       │        │ ролик: дверь, заставка, морзянка, клавиша, свист                                       │
// └──────────────┴────────┴──────────────────────────────────────────────────────────────────────────────────────┘

const N4 = { D2: 73.42, A2: 110, D3: 146.83, F3: 174.61, G3: 196, A3: 220, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, D5: 587.33, F5: 698.46, A5: 880 };

/** Литавра: кожа (синус с падением) + стук. */
export function timpani(k, t, dest, f = 73.4, gain = 0.6) {
  k.tone(t, 1.3, { f: f * 1.12, f2: f * 0.97, gain, attack: 0.004, dest });
  k.tone(t, 0.7, { f: f * 1.5 * 1.1, f2: f * 1.5, gain: gain * 0.35, attack: 0.004, dest });
  k.noise(t, 0.09, { type: 'lowpass', f: 420, gain: gain * 0.5, attack: 0.002, dest });
}

// рисунки радиопосылок по классам отправителей: [частота, длительность, пауза], форма волны
const RADIO = {
  hq:      { type: 'square',   seq: [[620, 0.07, 0.03], [620, 0.07, 0.03], [930, 0.16, 0]] },
  spotter: { type: 'sine',     seq: [[1400, 0.05, 0.025, 1900], [1500, 0.05, 0.025, 2000], [1600, 0.06, 0, 2200]] },
  crew:    { type: 'triangle', seq: [[480, 0.09, 0.04], [720, 0.12, 0]] },
  meteo:   { type: 'sine',     seq: [[1000, 0.035, 0], [1170, 0.035, 0], [1000, 0.035, 0], [1170, 0.035, 0], [1000, 0.035, 0], [1170, 0.035, 0], [1000, 0.035, 0], [1170, 0.05, 0]] },
  convoy:  { type: 'sine',     seq: [[760, 0.05, 0.05], [760, 0.05, 0.05], [760, 0.13, 0]], under: 380 },
};
export const RADIO_CLASSES = Object.keys(RADIO);

function radioRecipe(cls, urgent) {
  const P = RADIO[cls];
  return {
    d: urgent ? 0.95 : 0.75, sr: 0.34, g: urgent ? 0.12 : 0.085, bus: 'radio', sp: 'in', gap: 0.25, jit: 0.01, pr: 3,
    fn(k, t, dest) {
      const reps = urgent ? 2 : 1, mul = urgent ? 1.335 : 1, len = urgent ? 0.82 : 0.62;
      k.click(t, { f: 2000, gain: 0.5, dur: 0.012, dest });
      k.noise(t + 0.01, len, { f: 1900, q: 0.8, gain: 0.16, attack: 0.02, hold: len - 0.05, rel: 0.03, dest });
      let x = t + 0.07;
      for (let r = 0; r < reps; r++) {
        for (const [f, dur, pause, f2] of P.seq) {
          k.tone(x, dur, { type: urgent ? 'square' : P.type, f: f * mul, f2: f2 ? f2 * mul : null, gain: urgent && P.type !== 'square' ? 0.22 : 0.3, attack: 0.004, hold: dur - 0.008, rel: 0.006, dest });
          if (P.under) k.tone(x, dur, { type: 'triangle', f: P.under * mul, gain: 0.18, attack: 0.004, hold: dur - 0.008, rel: 0.006, dest });
          x += dur + pause;
        }
        x += 0.07;
      }
      k.click(t + len + 0.02, { f: 2000, gain: 0.4, dur: 0.012, dest });
      k.tone(t + len + 0.02, 0.04, { f: 300, f2: 120, gain: 0.2, dest });
    },
  };
}

function aaShotLayers(k, t, dest, sat, ringF, lvl) {
  k.tone(t, 0.07, { f: 150, f2: 60, gain: 1.0 * lvl, attack: 0.001, dest: sat });
  k.noise(t, 0.07, { f: 1500, f2: 420, q: 0.7, gain: 0.7 * lvl, attack: 0.001, dest: sat });
  k.click(t, { f: 2600, gain: 0.35 * lvl, dur: 0.012, dest });
  k.modal(t, { ratios: k.BAR, n: 3, f: ringF, decay: 0.16, gain: 0.14 * lvl, dest });
  k.click(t + 0.055, { f: 2500, gain: 0.16 * lvl, dest });
}
function caseTinkle(k, t, dest, gain) {
  const f = k.rv(3500, 5400);
  let x = t, g = gain;
  for (let b = 0; b < 3; b++) { k.modal(x, { ratios: k.BELL, n: 4, f, decay: 0.05, gain: g, dest }); x += k.rv(0.05, 0.09) * (1 - b * 0.25); g *= 0.5; }
}

export const CAT = {
  // ---------------- главный калибр и снаряды ----------------
  gun: { d: 0.9, v: 3, g: 2.0, sp: 'big', pr: 2, jit: 0.02,
    fn(k, t, dest, vi) {
      const sat = k.shaper(2.6, dest);
      k.tone(t, 0.85, { f: 58 + vi * 2, f2: 30, gain: 0.4, attack: 0.003, dest: sat });
      k.tone(t, 0.7, { f: 41, f2: 27, gain: 0.28, attack: 0.006, dest: sat });
      k.noise(t, 0.75, { type: 'lowpass', f: 2600 + vi * 200, f2: 260, q: 0.5, gain: 0.8, attack: 0.003, dest: sat });
      k.noise(t, 0.55, { f: 900 + vi * 60, f2: 320, q: 0.6, gain: 2.0, attack: 0.002, dest });              // «мясо» выстрела: слышно и в маленьком динамике
      k.tone(t, 0.3, { type: 'sawtooth', f: 230, f2: 80, gain: 0.5, attack: 0.002, dest: sat });
      k.noise(t, 0.09, { type: 'highpass', f: 1200, gain: 1.0, attack: 0.001, dest });
      k.noise(t, 0.03, { f: 3000, q: 1, gain: 0.6, attack: 0.0008, dest });
      k.modal(t + 0.012, { ratios: k.PLATE, n: 6, f: k.rv(200, 240), decay: 0.5, gain: 0.12, dest });   // лязг казённика при откате
      k.fm(t + 0.02, 0.16, { fc: 150, ratio: 1.41, index: 5, index2: 0, gain: 0.15, dest });
    } },
  gunTail: { d: 2.6, sr: 0.5, g: 0.9, sp: 'big', pr: 2, jit: 0.02,
    fn(k, t, dest) {
      k.modal(t, { ratios: k.PLATE, n: 10, f: 142, decay: 1.7, damp: 0.8, gain: 0.3, attack: 0.01, dest });        // звон брони
      k.modal(t, { ratios: k.PLATE, n: 6, f: 610, decay: 0.9, gain: 0.1, attack: 0.006, dest });
      const cb = k.comb(dest, { f: 240, fb: 0.5 });
      k.rattle(t + 0.12, { n: 8, gap: [0.05, 0.14], f: [1800, 4500], gain: 0.16, dest: cb, slow: 0.12 });           // незакреплённое железо
      k.noise(t + 0.1, 2.2, { type: 'lowpass', f: 260, f2: 60, gain: 0.4, attack: 0.25, dest });                    // раскат
      k.noise(t + 0.05, 1.6, { f: 520, f2: 260, q: 0.5, gain: 0.35, attack: 0.15, dest });
      k.tone(t, 1.5, { f: 4150, gain: 0.02, attack: 0.05, dest });                                                 // звон в ушах
      k.tone(t, 1.3, { f: 6230, gain: 0.008, attack: 0.06, dest });
    } },
  whoosh: { d: 1.2, sr: 0.5, g: 0.34, sp: 'out', pr: 6,
    fn(k, t, dest) {
      const g = k.noise(t, 1.05, { f: 1800, f2: 300, q: 1.3, gain: 0.6, attack: 0.04, dest });
      k.lfo(g.gain, 31, 0.12, t, t + 1.1);
      k.tone(t, 1.0, { f: 500, f2: 180, gain: 0.08, attack: 0.05, dest });
    } },
  impWater: { d: 1.6, sr: 0.5, v: 2, g: 0.36, sp: 'out', pr: 6,
    fn(k, t, dest) {
      k.thump(t, { f: 70, f2: 35, dur: 0.4, gain: 0.45, dest });
      k.noise(t, 0.2, { f: 500, f2: 250, q: 0.8, gain: 0.5, attack: 0.003, dest });
      k.noise(t, 1.2, { f: 1500, f2: 500, q: 0.6, gain: 0.6, attack: 0.12, dest });
      k.noise(t + 0.2, 1.0, { type: 'highpass', f: 3500, gain: 0.16, attack: 0.3, dest });
    } },
  impLand: { d: 1.6, sr: 0.5, v: 2, g: 0.4, sp: 'out', pr: 6,
    fn(k, t, dest) {
      const sat = k.shaper(2, dest);
      k.thump(t, { f: 60, f2: 28, dur: 0.6, gain: 0.5, dest: sat });
      k.noise(t, 1.2, { type: 'lowpass', f: 1400, f2: 90, gain: 0.9, attack: 0.004, dest: sat });
      k.noise(t, 0.5, { f: 420, f2: 160, q: 0.7, gain: 0.9, attack: 0.004, dest });
      k.rattle(t + 0.25, { n: 6, gap: [0.06, 0.2], f: [900, 2400], q: 3, gain: 0.07, dest });
    } },
  impSteel: { d: 1.6, sr: 0.5, g: 0.6, sp: 'out', pr: 6,
    fn(k, t, dest) {
      k.thump(t, { f: 80, f2: 34, dur: 0.4, gain: 0.8, dest });
      k.noise(t, 0.05, { type: 'highpass', f: 1500, gain: 0.5, attack: 0.001, dest });
      k.modal(t, { ratios: k.PLATE, n: 9, f: 220, decay: 1.0, gain: 0.4, dest });
      k.fm(t, 0.2, { fc: 210, ratio: 1.41, index: 6, index2: 0, gain: 0.25, dest });
      k.noise(t, 0.9, { type: 'lowpass', f: 600, f2: 80, gain: 0.5, attack: 0.01, dest });
    } },
  enemyGun: { d: 2.2, sr: 0.25, v: 2, g: 0.34, sp: 'out', pr: 6, jit: 0.06,
    fn(k, t, dest, vi) {
      let x = t;
      for (let i = 0; i < 2 + vi; i++) {
        const lv = 1 - i * 0.25;
        k.noise(x, 1.4, { type: 'lowpass', f: 420, f2: 70, gain: 0.8 * lv, attack: 0.05, dest });
        k.noise(x, 0.5, { f: 330, q: 0.8, gain: 0.35 * lv, attack: 0.03, dest });
        k.tone(x, 0.9, { f: 44, f2: 26, gain: 0.35 * lv, attack: 0.04, dest });
        x += k.rv(0.18, 0.34);
      }
    } },
  // ---------------- попадания по батарее ----------------
  nearMiss: { d: 2.6, sr: 0.5, v: 2, g: 0.95, sp: 'big', pr: 5,
    fn(k, t, dest) {
      const sat = k.shaper(2.4, dest);
      k.tone(t, 0.8, { f: 52, f2: 22, gain: 0.35, attack: 0.003, dest: sat });
      k.noise(t, 0.7, { type: 'lowpass', f: 2200, f2: 220, gain: 0.8, attack: 0.002, dest: sat });
      k.noise(t, 0.5, { f: 700, f2: 260, q: 0.6, gain: 1.7, attack: 0.002, dest });
      k.noise(t, 0.06, { type: 'highpass', f: 1500, gain: 0.6, attack: 0.001, dest });
      k.noise(t + 0.3, 2.0, { type: 'highpass', f: 2500, gain: 0.05, attack: 0.35, dest });                       // пыль
      const cb = k.comb(dest, { f: 205, fb: 0.55 });
      k.rattle(t + 0.14, { n: 10, gap: [0.05, 0.15], f: [1800, 5000], gain: 0.14, dest: cb, slow: 0.1 });
      for (let i = 0; i < 2; i++) k.modal(t + k.rv(0.2, 0.6), { ratios: k.BAR, n: 4, f: k.rv(900, 1500), decay: 0.15, gain: 0.08, dest });
    } },
  turretHit: { d: 3.2, sr: 0.5, v: 2, g: 1.1, sp: 'big', pr: 5,
    fn(k, t, dest, vi) {
      const sat = k.shaper(2.2, dest);
      k.noise(t, 0.05, { type: 'highpass', f: 1400, gain: 0.4, attack: 0.001, dest });
      k.tone(t, 0.8, { f: 48, f2: 24, gain: 0.3, attack: 0.003, dest: sat });
      k.noise(t, 0.4, { type: 'lowpass', f: 2000, f2: 200, gain: 0.5, attack: 0.002, dest: sat });
      k.noise(t, 0.35, { f: 700, f2: 260, q: 0.7, gain: 0.8, attack: 0.002, dest });
      k.modal(t, { ratios: k.PLATE, n: 12, f: 96 + vi * 9, decay: 2.6, damp: 0.6, tilt: 0.4, gain: 0.9, dest });  // огромный лязг
      k.modal(t + 0.004, { ratios: k.PLATE, n: 8, f: 233, decay: 1.4, gain: 0.55, dest });
      k.fm(t, 0.3, { fc: 180, ratio: 1.41, index: 8, index2: 0, gain: 0.6, dest });
      k.debris(t + 0.4, { n: 14, span: 2.2, gain: 0.09, dest });
    } },
  fault: { d: 1.5, v: 2, g: 0.36, sp: 'in', pr: 6,
    fn(k, t, dest) {
      let x = t;
      const n = k.lite ? 3 : Math.round(k.rv(5, 7));
      for (let i = 0; i < n; i++) {
        const d = k.rv(0.015, 0.045);
        k.fm(x, d, { fc: 120, ratio: 7.3, index: 30, index2: 12, gain: 0.5, type: 'sawtooth', attack: 0.001, hold: d, rel: 0.004, dest });
        k.noise(x, d, { f: 3000, q: 2, gain: 0.5, attack: 0.001, hold: d, rel: 0.004, dest });
        x += d + k.rv(0.02, 0.09);
      }
      k.noise(t + 0.12, 1.2, { type: 'highpass', f: 4000, f2: 2500, gain: 0.3, attack: 0.08, dest });               // пар
      k.noise(t + 0.12, 1.0, { f: 6000, q: 1.5, gain: 0.15, attack: 0.1, dest });
    } },
  // ---------------- заряжание ----------------
  breechOpen: { d: 1.1, sr: 0.5, v: 2, g: 0.42, sp: 'in', pr: 4,
    fn(k, t, dest) {
      k.fm(t, 0.5, { fc: 70, fc2: 95, ratio: 3.1, index: 4, index2: 2, gain: 0.25, attack: 0.03, hold: 0.42, rel: 0.05, dest });   // поршень проворачивается
      for (let i = 0; i < 9; i++) k.noise(t + 0.03 + i * 0.05, 0.02, { f: 900 + i * 25, q: 3, gain: 0.22, attack: 0.001, dest });
      k.thump(t + 0.55, { f: 110, f2: 50, dur: 0.18, gain: 0.8, dest });
      k.modal(t + 0.55, { ratios: k.BAR, n: 4, f: 520, decay: 0.25, gain: 0.2, dest });
      k.modal(t + 0.55, { ratios: k.PLATE, n: 6, f: 310, decay: 0.5, gain: 0.2, dest });
      k.noise(t + 0.6, 0.3, { f: 500, f2: 250, q: 1, gain: 0.15, attack: 0.05, dest });                             // откидывается
      k.thump(t + 0.9, { f: 95, f2: 45, dur: 0.14, gain: 0.5, dest });
      k.click(t + 0.9, { f: 1800, gain: 0.2, dest });
    } },
  breechClose: { d: 1.1, sr: 0.5, v: 2, g: 0.46, sp: 'in', pr: 4,
    fn(k, t, dest) {
      k.noise(t, 0.25, { f: 400, f2: 700, q: 1, gain: 0.15, attack: 0.08, dest });
      k.thump(t + 0.25, { f: 90, f2: 40, dur: 0.22, gain: 1.0, dest });
      k.noise(t + 0.25, 0.06, { type: 'lowpass', f: 1500, gain: 0.5, dest });
      k.modal(t + 0.25, { ratios: k.PLATE, n: 8, f: 260, decay: 0.7, gain: 0.3, dest });
      k.fm(t + 0.36, 0.42, { fc: 85, fc2: 120, ratio: 3.1, index: 3, index2: 4, gain: 0.2, attack: 0.03, hold: 0.36, rel: 0.04, dest });
      for (let i = 0; i < 8; i++) k.noise(t + 0.38 + i * 0.052, 0.02, { f: 950 + i * 45, q: 3, gain: 0.2, attack: 0.001, dest });
      k.modal(t + 0.86, { ratios: k.BAR, n: 3, f: 1400, decay: 0.06, gain: 0.25, dest });
      k.thump(t + 0.86, { f: 130, f2: 70, dur: 0.08, gain: 0.4, dest });
    } },
  hoistStart: { d: 0.45, sr: 0.5, g: 0.3, sp: 'in', pr: 4,
    fn(k, t, dest) {
      k.click(t, { f: 2200, gain: 0.5, dur: 0.012, dest });
      k.thump(t, { f: 160, f2: 80, dur: 0.06, gain: 0.5, dest });
      const cb = k.comb(dest, { f: 310, fb: 0.45 });
      k.rattle(t + 0.05, { n: 4, gap: [0.05, 0.09], f: [1300, 1900], q: 3, gain: 0.3, dest: cb });
    } },
  hoistLoop: { d: 1.3, loop: 0.96, sr: 0.5, g: 0.21, sp: 'in', pr: 4,
    fn(k, t, dest) {
      const cb = k.comb(dest, { f: 310, fb: 0.45 });
      for (let i = 0; i < 10; i++) {
        const x = t + i * 0.096;
        k.noise(x, 0.022, { f: k.rv(1400, 2000), q: 3, gain: 0.4 * k.rv(0.8, 1), attack: 0.001, dest: cb });
        k.modal(x, { ratios: k.BAR, n: 2, f: k.rv(1700, 2100), decay: 0.03, gain: 0.1, dest });
        k.thump(x, { f: 180, f2: 110, dur: 0.03, gain: 0.12, dest });
      }
    } },
  hoistStop: { d: 0.6, sr: 0.5, g: 0.36, sp: 'in', pr: 4,
    fn(k, t, dest) {
      k.thump(t, { f: 100, f2: 45, dur: 0.16, gain: 0.9, dest });
      k.noise(t, 0.05, { type: 'lowpass', f: 1200, gain: 0.4, dest });
      k.modal(t, { ratios: k.PLATE, n: 5, f: 400, decay: 0.3, gain: 0.2, dest });
      const cb = k.comb(dest, { f: 310, fb: 0.45 });
      k.rattle(t + 0.07, { n: 3, gap: [0.07, 0.1], f: [1300, 1900], q: 3, gain: 0.2, dest: cb, slow: 0.5 });
    } },
  ram: { d: 1.0, v: 2, g: 0.46, sp: 'in', pr: 4,
    fn(k, t, dest) {
      k.click(t, { f: 4000, gain: 0.3, dur: 0.015, dest });
      k.noise(t, 0.42, { f: 3000, f2: 700, q: 0.8, gain: 0.45, attack: 0.03, dest });
      k.tone(t, 0.36, { type: 'sawtooth', f: 60, f2: 140, gain: 0.05, attack: 0.05, dest });
      k.thump(t + 0.38, { f: 85, f2: 36, dur: 0.3, gain: 1.0, dest });
      k.noise(t + 0.38, 0.1, { type: 'lowpass', f: 600, gain: 0.5, dest });
      k.modal(t + 0.38, { ratios: k.PLATE, n: 6, f: 180, decay: 0.5, gain: 0.2, dest });
      k.noise(t + 0.55, 0.4, { type: 'highpass', f: 3000, gain: 0.12, attack: 0.08, dest });
    } },
  charge: { d: 0.4, sr: 0.5, v: 2, g: 0.3, sp: 'in', pr: 4,
    fn(k, t, dest) {
      k.noise(t, 0.1, { f: 1200, q: 0.7, gain: 0.12, attack: 0.03, dest });
      k.thump(t + 0.06, { f: 95, f2: 50, dur: 0.15, gain: 0.8, attack: 0.006, dest });
      k.noise(t + 0.06, 0.12, { type: 'lowpass', f: 1000, gain: 0.6, attack: 0.005, dest });
    } },
  unload: { d: 1.3, sr: 0.5, g: 0.34, sp: 'in', pr: 5,
    fn(k, t, dest) {
      const cb = k.comb(dest, { f: 290, fb: 0.45 });
      k.rattle(t, { n: 8, gap: [0.07, 0.08], f: [1200, 1700], q: 3, gain: 0.3, dest: cb, slow: 0.08 });
      k.modal(t + 0.8, { ratios: k.BELL, n: 6, f: 780, decay: 0.45, gain: 0.25, dest });
      k.thump(t + 0.8, { f: 110, f2: 50, dur: 0.15, gain: 0.7, dest });
    } },
  // ---------------- органы управления ----------------
  detent: { d: 0.08, v: 3, g: 0.16, sp: 'in', pr: 1, gap: 0.03, jit: 0.04,
    fn(k, t, dest) {
      k.click(t, { f: 3000, gain: 0.5, dest });
      k.modal(t, { ratios: k.BAR, n: 2, f: k.rv(2100, 2500), decay: 0.03, gain: 0.2, dest });
      k.tone(t, 0.025, { type: 'triangle', f: k.rv(310, 370), gain: 0.25, attack: 0.001, dest });
    } },
  tick: { d: 0.05, v: 3, g: 0.11, sp: 'in', pr: 1, gap: 0.028, jit: 0.04,
    fn(k, t, dest) {
      k.click(t, { f: 4000, gain: 0.5, dur: 0.006, dest });
      k.tone(t, 0.015, { type: 'triangle', f: k.rv(2100, 2500), gain: 0.2, attack: 0.001, dest });
      k.tone(t, 0.012, { f: 420, gain: 0.12, attack: 0.001, dest });
    } },
  clunk: { d: 0.35, sr: 0.5, v: 2, g: 0.3, sp: 'in', pr: 1, gap: 0.05,
    fn(k, t, dest) {
      k.thump(t, { f: 120, f2: 52, dur: 0.14, gain: 0.7, dest });
      k.noise(t, 0.05, { type: 'lowpass', f: 1800, gain: 0.6, dest });
      k.modal(t, { ratios: k.PLATE, n: 5, f: 330, decay: 0.2, gain: 0.4, dest });
      k.click(t, { f: 2500, gain: 0.3, dur: 0.012, dest });
    } },
  lever: { d: 0.5, sr: 0.5, v: 2, g: 0.27, sp: 'in', pr: 1, gap: 0.06,
    fn(k, t, dest) {
      k.noise(t, 0.16, { f: 900, f2: 300, q: 1.2, gain: 0.4, attack: 0.02, dest });
      k.thump(t + 0.13, { f: 105, f2: 48, dur: 0.16, gain: 0.7, dest });
      k.noise(t + 0.13, 0.05, { type: 'lowpass', f: 1800, gain: 0.6, dest });
      k.modal(t + 0.13, { ratios: k.BAR, n: 3, f: 620, decay: 0.2, gain: 0.3, dest });
      k.fm(t + 0.14, 0.1, { fc: 480, ratio: 2.3, index: 2, index2: 0, gain: 0.05, dest });
    } },
  toggle: { d: 0.09, v: 2, g: 0.13, sp: 'in', pr: 1, gap: 0.04,
    fn(k, t, dest) {
      k.click(t, { f: 2800, gain: 0.5, dest });
      k.noise(t + 0.022, 0.014, { f: 1700, q: 2, gain: 0.45, attack: 0.001, dest });
      k.tone(t + 0.022, 0.03, { f: 190, gain: 0.25, attack: 0.001, dest });
      k.modal(t + 0.022, { ratios: k.BAR, n: 2, f: 3100, decay: 0.02, gain: 0.1, dest });
    } },
  button: { d: 0.12, v: 2, g: 0.1, sp: 'in', pr: 1, gap: 0.04,
    fn(k, t, dest) {
      k.noise(t, 0.02, { type: 'lowpass', f: 1200, gain: 0.5, attack: 0.001, dest });
      k.tone(t, 0.04, { f: 260, f2: 180, gain: 0.4, attack: 0.001, dest });
      k.click(t + 0.07, { type: 'bandpass', f: 2600, q: 1.5, gain: 0.1, dur: 0.006, dest });
    } },
  selector: { d: 0.12, v: 2, g: 0.13, sp: 'in', pr: 1, gap: 0.04,
    fn(k, t, dest) {
      k.noise(t, 0.015, { f: 1100, q: 2, gain: 0.5, attack: 0.001, dest });
      k.tone(t, 0.03, { type: 'triangle', f: 420, gain: 0.3, attack: 0.001, dest });
      k.modal(t, { ratios: k.BAR, n: 1, f: 1700, decay: 0.04, gain: 0.15, dest });
      k.click(t + 0.03, { type: 'bandpass', f: 2200, q: 1.5, gain: 0.08, dest });
    } },
  cover: { d: 0.3, v: 2, g: 0.15, sp: 'in', pr: 1, gap: 0.08,
    fn(k, t, dest) {
      k.fm(t, 0.08, { fc: 1400, fc2: 1900, ratio: 1.5, index: 0.6, gain: 0.05, attack: 0.02, dest });
      k.click(t + 0.09, { f: 2600, gain: 0.5, dest });
      k.modal(t + 0.09, { ratios: k.PLATE, n: 4, f: 900, decay: 0.1, gain: 0.2, dest });
      k.tone(t + 0.09, 0.05, { f: 210, gain: 0.35, attack: 0.001, dest });
    } },
  relay: { d: 0.06, v: 2, g: 0.085, sp: 'in', pr: 1, gap: 0.03,
    fn(k, t, dest) {
      for (const dt of [0, 0.008]) { k.noise(t + dt, 0.006, { f: 2400, q: 3, gain: 0.5, attack: 0.0008, dest }); k.tone(t + dt, 0.008, { type: 'square', f: 900, gain: 0.06, attack: 0.001, dest }); }
    } },
  drum: { d: 0.05, v: 3, g: 0.095, sp: 'in', pr: 1, gap: 0.025, jit: 0.05,
    fn(k, t, dest) {
      k.noise(t, 0.008, { f: 1800, q: 4, gain: 0.5, attack: 0.0008, dest });
      k.tone(t, 0.01, { type: 'triangle', f: 1250, gain: 0.2, attack: 0.001, dest });
      k.tone(t, 0.015, { f: 300, gain: 0.2, attack: 0.001, dest });
    } },
  buzz: { d: 0.36, sr: 0.5, g: 0.17, sp: 'in', pr: 2, gap: 0.25, jit: 0,
    fn(k, t, dest) {
      const bp = k.filter('bandpass', 900, 0.9, dest), sat = k.shaper(3, bp), am = k.gain(0.65, sat);
      k.tone(t, 0.3, { type: 'sawtooth', f: 112, gain: 0.6, attack: 0.008, hold: 0.28, rel: 0.03, dest: am });
      k.tone(t, 0.3, { type: 'square', f: 168, gain: 0.3, attack: 0.008, hold: 0.28, rel: 0.03, dest: am });
      k.lfo(am.gain, 56, 0.35, t, t + 0.34, 'square');
    } },
  bell: { d: 1.5, sr: 0.5, g: 0.2, sp: 'in', pr: 5, gap: 0.1, jit: 0.005,
    fn(k, t, dest) {
      k.click(t, { f: 3000, gain: 0.3, dest });
      k.modal(t, { ratios: k.BELL, f: 1320, decay: 1.3, damp: 0.5, tilt: 0.3, gain: 0.3, dest });
    } },
  paper: { d: 0.3, v: 2, g: 0.065, sp: 'dry', pr: 5, gap: 0.08,
    fn(k, t, dest) {
      const g = k.noise(t, 0.2, { f: 2500, f2: 4000, q: 0.5, gain: 0.5, attack: 0.06, dest });
      k.lfo(g.gain, 43, 0.15, t, t + 0.28);
      k.noise(t, 0.2, { type: 'lowpass', f: 600, gain: 0.2, attack: 0.05, dest });
    } },
  pin: { d: 0.12, v: 2, g: 0.075, sp: 'dry', pr: 5, gap: 0.05,
    fn(k, t, dest) {
      k.tone(t, 0.02, { f: 900, f2: 500, gain: 0.5, attack: 0.001, dest });
      k.noise(t, 0.01, { type: 'lowpass', f: 2000, gain: 0.4, attack: 0.001, dest });
      k.tone(t, 0.05, { f: 210, gain: 0.1, attack: 0.001, dest });
    } },
  loupe: { d: 0.25, g: 0.06, sp: 'dry', pr: 5, gap: 0.1,
    fn(k, t, dest) {
      k.noise(t, 0.1, { type: 'highpass', f: 5000, gain: 0.25, attack: 0.03, dest });
      k.click(t + 0.1, { f: 3200, gain: 0.4, dest });
      k.modal(t + 0.1, { ratios: k.BELL, n: 5, f: 2600, decay: 0.12, gain: 0.3, dest });
    } },
  // ---------------- радио ----------------
  sqOpen: { d: 0.12, sr: 0.34, g: 0.12, bus: 'radio', sp: 'in', pr: 3, gap: 0.08,
    fn(k, t, dest) { k.click(t, { f: 2000, gain: 0.5, dur: 0.01, dest }); k.noise(t + 0.01, 0.08, { f: 1900, q: 0.8, gain: 0.3, attack: 0.03, dest }); } },
  sqClose: { d: 0.18, sr: 0.34, g: 0.09, bus: 'radio', sp: 'in', pr: 3, gap: 0.08,
    fn(k, t, dest) {
      k.noise(t, 0.06, { f: 1900, q: 0.8, gain: 0.35, attack: 0.004, dest });
      k.click(t + 0.07, { f: 2000, gain: 0.4, dur: 0.01, dest });
      k.tone(t + 0.07, 0.04, { f: 300, f2: 120, gain: 0.3, dest });
    } },
  // ---------------- зенитка и воздух ----------------
  aaShot: { d: 0.4, v: 3, g: 0.72, sp: 'big', pr: 4, gap: 0.07, jit: 0.03,
    fn(k, t, dest, vi) { aaShotLayers(k, t, dest, k.shaper(2.2, dest), 730 + vi * 30, 1); } },
  aaLoop: { d: 1.3, loop: 0.88, g: 0.56, sp: 'big', pr: 4,
    fn(k, t, dest) {
      const sat = k.shaper(2.2, dest);
      for (let i = 0; i < 8; i++) {
        const x = t + i * 0.11;
        aaShotLayers(k, x, dest, sat, i % 2 ? 790 : 730, k.rv(0.85, 1));
        if (!k.lite && i % 2 === 0) caseTinkle(k, x + k.rv(0.06, 0.1), dest, 0.05);
      }
    } },
  aaTail: { d: 1.0, v: 2, g: 0.3, sp: 'big', pr: 4,
    fn(k, t, dest) {
      k.modal(t, { ratios: k.BAR, n: 4, f: 740, decay: 0.5, gain: 0.3, dest });
      for (let i = 0; i < (k.lite ? 2 : 5); i++) caseTinkle(k, t + k.rv(0.05, 0.6), dest, 0.14);
      k.noise(t, 0.6, { type: 'lowpass', f: 500, f2: 150, gain: 0.3, attack: 0.05, dest });
    } },
  overheat: { d: 1.6, g: 0.24, sp: 'in', pr: 6, gap: 0.5,
    fn(k, t, dest) {
      k.noise(t, 1.5, { type: 'highpass', f: 3500, gain: 0.5, attack: 0.05, hold: 0.6, rel: 0.85, dest });
      k.noise(t, 1.2, { f: 7000, q: 1.5, gain: 0.25, attack: 0.05, hold: 0.4, rel: 0.8, dest });
      for (let i = 0; i < (k.lite ? 3 : 12); i++) k.click(t + k.rv(0.02, 1.0), { f: k.rv(2500, 6000), gain: k.rv(0.1, 0.3), dur: 0.004, dest });
    } },
  jam: { d: 0.5, sr: 0.5, v: 2, g: 0.42, sp: 'in', pr: 6, gap: 0.2,
    fn(k, t, dest) {
      k.thump(t, { f: 140, f2: 70, dur: 0.1, gain: 0.8, dest });
      k.modal(t, { ratios: k.PLATE, n: 7, f: 410, decay: 0.35, gain: 0.5, dest });
      k.modal(t, { ratios: k.BAR, n: 3, f: 1250, decay: 0.1, gain: 0.2, dest });
      k.fm(t, 0.08, { fc: 260, ratio: 1.41, index: 6, index2: 0, gain: 0.3, dest });
      k.modal(t + 0.12, { ratios: k.PLATE, n: 4, f: 430, decay: 0.15, gain: 0.15, dest });
      k.click(t + 0.12, { f: 2000, gain: 0.2, dest });
    } },
  bombBurst: { d: 2.8, sr: 0.5, v: 2, g: 0.68, sp: 'big', pr: 6, gap: 0.2,
    fn(k, t, dest) {
      const sat = k.shaper(2.6, dest);
      k.tone(t, 1.0, { f: 64, f2: 24, gain: 0.55, attack: 0.003, dest: sat });
      k.noise(t, 1.3, { type: 'lowpass', f: 2000, f2: 90, gain: 1.0, attack: 0.003, dest: sat });
      k.noise(t, 0.5, { f: 400, f2: 150, q: 0.7, gain: 1.0, attack: 0.002, dest });
      k.noise(t, 0.07, { type: 'highpass', f: 1600, gain: 0.6, attack: 0.001, dest });
      k.noise(t + 0.3, 1.8, { f: 500, f2: 120, q: 0.6, gain: 0.14, attack: 0.3, dest });                           // земля сверху
      const cb = k.comb(dest, { f: 220, fb: 0.5 });
      k.rattle(t + 0.2, { n: 8, gap: [0.06, 0.16], f: [1500, 4000], gain: 0.1, dest: cb, slow: 0.1 });
    } },
  // ---------------- случайные звуки фона ----------------
  creak: { d: 1.0, sr: 0.5, v: 3, g: 0.05, bus: 'amb', sp: 'in', pr: 7, jit: 0.1,
    fn(k, t, dest) {
      const bp = k.filter('bandpass', k.rv(900, 1500), 12, dest), am = k.gain(0.5, bp);
      k.tone(t, 0.75, { type: 'sawtooth', f: k.rv(70, 110), f2: k.rv(80, 130), gain: 0.8, attack: 0.15, hold: 0.45, rel: 0.2, dest: am });
      k.lfo(am.gain, k.rv(14, 22), 0.5, t, t + 0.85, 'sawtooth');
      k.tone(t, 0.7, { f: 140, f2: 120, gain: 0.08, attack: 0.2, dest });
    } },
  drip: { d: 0.25, v: 3, g: 0.035, bus: 'amb', sp: 'in', pr: 7, jit: 0.12,
    fn(k, t, dest) {
      k.tone(t, 0.025, { f: 900, f2: 1700, gain: 0.5, attack: 0.002, dest });
      k.tone(t + 0.04, 0.02, { f: 1300, f2: 2100, gain: 0.25, attack: 0.002, dest });
    } },
  foghorn: { d: 3.2, sr: 0.25, g: 0.035, bus: 'amb', sp: 'out', pr: 7, jit: 0.02,
    fn(k, t, dest) {
      const lp = k.filter('lowpass', 420, 1, dest);
      for (const f of [82, 123.3]) {
        const o = k.tone(t, 3, { type: 'sawtooth', f, gain: 0.5, attack: 0.3, hold: 2.1, rel: 0.6, dest: lp });
        k.lfo(o.osc.frequency, 4.3, 0.6, t, t + 3.1);
      }
    } },
  farThunder: { d: 4.0, sr: 0.25, g: 0.07, bus: 'amb', sp: 'out', pr: 7, jit: 0.1,
    fn(k, t, dest) {
      for (const [dt, lv] of [[0, 1], [0.5, 0.7], [1.3, 0.5]]) k.noise(t + dt, 2.2, { type: 'lowpass', f: 380, f2: 60, gain: 0.6 * lv, attack: 0.12, dest });
      k.tone(t, 1.6, { f: 38, f2: 26, gain: 0.4, attack: 0.1, dest });
    } },
  rainLoop: { d: 2.8, loop: 2.4, sr: 0.5, g: 0.035, bus: 'amb', sp: 'in', pr: 7,
    fn(k, t, dest) {
      for (let i = 0; i < 70; i++) {
        const x = t + k.rnd() * 2.4, g = k.rv(0.2, 1);
        k.noise(x, 0.006, { f: k.rv(2500, 6000), q: 3, gain: 0.5 * g, attack: 0.0008, dest });
        if (i % 3 === 0) k.modal(x, { ratios: k.PLATE, n: 2, f: k.rv(1800, 3000), decay: 0.025, gain: 0.2 * g, dest });
      }
    } },
  // ---------------- интерфейс ----------------
  uiTap: { d: 0.06, g: 0.06, sp: 'ui', pr: 0, gap: 0.03, jit: 0.02,
    fn(k, t, dest) { k.tone(t, 0.014, { type: 'triangle', f: 1500, gain: 0.5, attack: 0.001, dest }); k.click(t, { f: 3500, gain: 0.3, dur: 0.005, dest }); k.tone(t, 0.02, { f: 330, gain: 0.2, attack: 0.001, dest }); } },
  dlgOpen: { d: 0.25, sr: 0.5, g: 0.06, sp: 'ui', pr: 3, gap: 0.1, jit: 0,
    fn(k, t, dest) {
      k.noise(t, 0.12, { f: 1800, f2: 3200, q: 0.6, gain: 0.2, attack: 0.04, dest });
      k.tone(t, 0.09, { f: 520, gain: 0.5, attack: 0.004, dest }); k.tone(t + 0.07, 0.14, { f: 780, gain: 0.4, attack: 0.004, dest });
    } },
  dlgClose: { d: 0.22, sr: 0.5, g: 0.055, sp: 'ui', pr: 3, gap: 0.1, jit: 0,
    fn(k, t, dest) {
      k.noise(t, 0.1, { f: 3000, f2: 1600, q: 0.6, gain: 0.2, attack: 0.03, dest });
      k.tone(t, 0.08, { f: 700, gain: 0.5, attack: 0.004, dest }); k.tone(t + 0.06, 0.12, { f: 470, gain: 0.4, attack: 0.004, dest });
    } },
  toast: { d: 0.3, sr: 0.5, g: 0.06, sp: 'ui', pr: 3, gap: 0.15, jit: 0,
    fn(k, t, dest) { k.click(t, { f: 2000, gain: 0.2, dest }); k.tone(t, 0.2, { f: 880, gain: 0.5, attack: 0.003, dest }); k.tone(t, 0.12, { type: 'triangle', f: 1320, gain: 0.15, attack: 0.003, dest }); } },
  saveDone: { d: 0.65, sr: 0.5, g: 0.07, sp: 'ui', pr: 6, gap: 0.3, jit: 0,
    fn(k, t, dest) {
      [N4.D5, N4.F5, N4.A5].forEach((f, i) => { k.tone(t + i * 0.11, 0.2, { f, gain: 0.45, attack: 0.004, dest }); k.tone(t + i * 0.11, 0.1, { type: 'triangle', f: f * 2, gain: 0.08, attack: 0.004, dest }); });
      k.click(t + 0.36, { f: 2500, gain: 0.25, dest });
    } },
  hintNew: { d: 0.8, sr: 0.5, g: 0.08, sp: 'ui', pr: 6, gap: 0.3, jit: 0,
    fn(k, t, dest) { k.modal(t, { ratios: k.BELL, n: 6, f: 1568, decay: 0.5, tilt: 0.5, gain: 0.5, dest }); k.modal(t + 0.12, { ratios: k.BELL, n: 6, f: 2093, decay: 0.5, tilt: 0.5, gain: 0.4, dest }); } },
  friendly: { d: 0.8, sr: 0.5, g: 0.2, sp: 'ui', pr: 6, gap: 0.5, jit: 0,
    fn(k, t, dest) {
      const bp = k.filter('bandpass', 1000, 0.8, dest);
      for (const dt of [0, 0.36]) {
        k.tone(t + dt, 0.14, { type: 'square', f: 440, gain: 0.5, attack: 0.006, hold: 0.13, rel: 0.02, dest: bp });
        k.tone(t + dt + 0.16, 0.14, { type: 'square', f: 330, gain: 0.5, attack: 0.006, hold: 0.13, rel: 0.03, dest: bp });
      }
    } },
  detected: { d: 1.3, sr: 0.5, g: 0.3, sp: 'ui', pr: 6, gap: 0.5, jit: 0,
    fn(k, t, dest) {
      timpani(k, t, dest, 73.4, 0.6);
      for (const f of [N4.D3, N4.D3 * 1.5, N4.D3 * 1.06 * 2]) k.brass(t, 0.5, { f, gain: 0.16, attack: 0.02, rel: 0.5, bright: 5, dest });   // ре-ля-ми♭: тревожное созвучие
      k.noise(t, 0.3, { f: 800, f2: 3000, q: 1, gain: 0.1, attack: 0.2, dest });
    } },
  won: { d: 3.6, sr: 0.5, g: 0.3, sp: 'ui', pr: 8, gap: 1, jit: 0,
    fn(k, t, dest) {
      const B = (at, dur, f, g) => k.brass(t + at, dur, { f, gain: g, attack: 0.035, rel: 0.12, vib: dur > 0.6 ? 0.004 : 0, dest });
      B(0, 0.2, N4.D4, 0.3); B(0.26, 0.1, N4.D4, 0.26); B(0.4, 0.34, N4.A4, 0.32); B(0.8, 0.16, N4.F4, 0.28);
      B(1.0, 1.9, N4.D4, 0.2); B(1.0, 1.9, N4.F4 * 1.0595, 0.2); B(1.0, 1.9, N4.A4, 0.22); B(1.0, 1.9, N4.D5, 0.2);            // ре мажор: гордо
      timpani(k, t, dest, 73.4, 0.4); timpani(k, t + 1.0, dest, 73.4, 0.6); timpani(k, t + 0.8, dest, 110, 0.3);
    } },
  lost: { d: 4.2, sr: 0.34, g: 0.26, sp: 'ui', pr: 8, gap: 1, jit: 0,
    fn(k, t, dest) {
      const lp = k.filter('lowpass', 1100, 0.8, dest);
      lp.frequency.setValueAtTime(1100, t); lp.frequency.exponentialRampToValueAtTime(320, t + 3.8);
      for (const [f, g] of [[220, 0.4], [233.1, 0.22], [329.6, 0.2]]) k.tone(t, 3.8, { type: 'sawtooth', f, f2: f * 0.5, gain: g, attack: 0.4, hold: 1.6, rel: 2.0, dest: lp });
      k.tone(t, 3.6, { f: 82, f2: 41, gain: 0.2, attack: 0.3, hold: 1.5, rel: 2.0, dest });
      timpani(k, t, dest, 55, 0.5);
    } },
  rankUp: { d: 1.9, sr: 0.5, g: 0.24, sp: 'ui', pr: 8, gap: 1, jit: 0,
    fn(k, t, dest) {
      k.brass(t, 0.22, { f: N4.A3, gain: 0.3, attack: 0.03, rel: 0.1, dest });
      for (const f of [N4.D4, N4.F4 * 1.0595, N4.A4]) k.brass(t + 0.3, 1.0, { f, gain: 0.22, attack: 0.04, rel: 0.3, vib: 0.004, dest });
      k.modal(t + 0.3, { ratios: k.BELL, n: 6, f: 2349, decay: 0.9, tilt: 0.5, gain: 0.08, dest });
      k.noise(t + 0.3, 0.05, { type: 'highpass', f: 2500, gain: 0.12, dest });
    } },
  daily: { d: 1.4, sr: 0.5, g: 0.1, sp: 'ui', pr: 8, gap: 1, jit: 0,
    fn(k, t, dest) { [1046.5, 1318.5, 1568, 2093].forEach((f, i) => k.modal(t + i * 0.09, { ratios: k.BELL, n: 6, f, decay: 0.7, tilt: 0.5, gain: 0.4, dest })); } },
  // ---------------- вступительный ролик ----------------
  introDoor: { d: 1.7, sr: 0.5, g: 0.4, sp: 'big', pr: 9, jit: 0.02,
    fn(k, t, dest) {
      const bp = k.filter('bandpass', 1200, 6, dest), am = k.gain(0.6, bp);
      k.tone(t, 0.9, { type: 'sawtooth', f: 90, f2: 150, gain: 1.6, attack: 0.2, hold: 0.55, rel: 0.15, dest: am });
      k.lfo(am.gain, 17, 0.4, t, t + 0.95, 'sawtooth');
      k.thump(t + 1.0, { f: 96, f2: 44, dur: 0.35, gain: 1.0, dest });
      k.noise(t + 1.0, 0.08, { type: 'lowpass', f: 1400, gain: 0.5, dest });
      k.modal(t + 1.0, { ratios: k.PLATE, n: 8, f: 150, decay: 0.7, gain: 0.3, dest });
    } },
  introTitle: { d: 2.6, sr: 0.5, g: 0.5, sp: 'big', pr: 9, jit: 0,
    fn(k, t, dest) {
      const sat = k.shaper(2, dest);
      k.tone(t, 1.6, { f: 62, f2: 31, gain: 0.6, attack: 0.006, dest: sat });
      k.noise(t, 0.6, { type: 'lowpass', f: 1500, f2: 110, gain: 0.9, attack: 0.004, dest: sat });
      k.noise(t, 0.4, { f: 420, f2: 170, q: 0.7, gain: 0.7, attack: 0.003, dest });
      k.modal(t, { ratios: k.PLATE, n: 8, f: 110, decay: 2.0, gain: 0.25, dest });
      for (const f of [N4.D3, N4.A3]) k.brass(t + 0.02, 1.4, { f, gain: 0.12, attack: 0.08, rel: 0.8, bright: 3, dest });
    } },
  introMorse: { d: 1.7, sr: 0.34, g: 0.07, sp: 'dry', pr: 9, jit: 0,
    fn(k, t, dest) {
      let x = t;
      for (const p of [1, 3, 1, 0, 3, 1, 1, 0, 1, 3]) {
        if (!p) { x += 0.14; continue; }
        k.tone(x, 0.055 * p, { f: 760, gain: 0.5, attack: 0.004, hold: 0.055 * p, rel: 0.006, dest });
        x += 0.07 * p + 0.06;
      }
    } },
  introKey: { d: 0.05, v: 2, g: 0.045, sp: 'dry', pr: 9, gap: 0.055, jit: 0.06,
    fn(k, t, dest) { k.noise(t, 0.012, { f: k.rv(2400, 3200), q: 1.2, gain: 0.6, attack: 0.001, dest }); k.tone(t, 0.02, { f: 240, gain: 0.06, attack: 0.001, dest }); } },
  introWhistle: { d: 0.6, sr: 0.5, g: 0.1, sp: 'out', pr: 9, jit: 0.04,
    fn(k, t, dest) {
      k.tone(t, 0.5, { f: 1900, f2: 420, gain: 0.4, attack: 0.08, dest });
      k.tone(t, 0.5, { f: 1950, f2: 432, gain: 0.25, attack: 0.1, dest });
      k.noise(t, 0.5, { f: 2600, f2: 700, q: 3, gain: 0.5, attack: 0.1, dest });
    } },
};
for (const cls of RADIO_CLASSES) { CAT['radio_' + cls] = radioRecipe(cls, false); CAT['radio_' + cls + '_u'] = radioRecipe(cls, true); }
