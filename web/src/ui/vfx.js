// Зрелищные эффекты боя: события игры → engine.fx (тряска, вспышка, пыль, дым, искры) и красный свет ночного боя.
// Логики и звука здесь нет. Всё рисуется только на текущем посту: эффект чужого поста просто не создаётся.
//   свой выстрел      — толчок, вспышка из амбразуры, пыль с потолка; затвор открыли после выстрела — пороховой дым (ЗАРЯЖАНИЕ)
//   снаряд рядом      — лёгкий толчок, немного пыли
//   попадание/бомба   — сильный толчок, лампы мигают, пыль, искры и дым из-под потолка
//   отказ узла        — искры и дым у привода (ПОВОРОТ, ПОДЪЁМ), пар у элеватора (ЗАРЯЖАНИЕ), искры у плафона (свет)
//   неисправность идёт — пока узел не починили: редкие искры у привода (ПОВОРОТ, ПОДЪЁМ), струйка пара у элеватора (ЗАРЯЖАНИЕ)
//   зенитка стреляет  — мелкая дрожь; клин от перегрева — толчок и пар над казёнником (ЗЕНИТКА)
//   ночь              — engine.setNight: красные лампы и красная коррекция кадра вместо CSS-фильтра #night
export function createVfx({ engine, game }) {
  const fx = engine.fx, offs = [];
  const s = () => game.state;
  const playing = () => s().phase === 'playing';
  const pick = (list) => list[(Math.random() * list.length) | 0];
  // места эффектов — точки «в кадре» (fx: screen [x, y] от −1 до 1, depth — метры от камеры): видны на любом посту, перед
  // пультом и не за панелями. Кадр, не закрытый верхней и нижней полосами и правым столбцом оболочки: y от −0.7 до 0.78,
  // x до 0.86. Под потолком — верх кадра; привод и элеватор — справа внизу, у края пульта.
  const OVERHEAD = [[-0.72, 0.62], [0.7, 0.6], [0.42, 0.66], [-0.38, 0.64]].map((sc) => ({ screen: sc, depth: 0.85 }));
  const BREECH = [-0.5, 1.1, -0.3];                 // казённый срез орудия на посту ЗАРЯЖАНИЕ (loading-gun.js: K.X, K.Y, K.ZB)
  const DRIVE = { screen: [0.72, -0.5], depth: 0.75 }, HOIST = { screen: [0.7, -0.38], depth: 0.75 };
  const AA_GUN = { screen: [0.02, 0.6], depth: 0.9 }, LAMPS = [{ screen: [-0.81, 0.55], depth: 0.85 }, { screen: [0.81, 0.55], depth: 0.85 }];
  let smokeInBore = false, aaT = 0, faultT = 2;

  // на уровнях с постобработкой красный фильтр ночи рисует движок — CSS-слой #night прячем
  const style = document.createElement('style');
  style.textContent = 'body.gl-grade #night{display:none}';
  document.head.appendChild(style);

  offs.push(game.on('fired', () => {
    if (!playing()) return;
    const atFire = engine.current === 'fire';
    fx.shake(atFire ? 0.4 : 0.3, 0.6);
    fx.flash({ from: 'slit', intensity: atFire ? 1 : 0.55, dur: 0.24, color: '#ffd29a' });
    fx.flicker(0.4, 0.5);
    fx.dust({ amount: 0.6 });
    smokeInBore = true;
  }));
  offs.push(game.on('breech', (b) => {
    if (!smokeInBore || !b || b.busy || !b.open) return;
    smokeInBore = false;
    if (playing() && engine.current === 'loading') fx.puff({ kind: 'breech', station: 'loading', position: BREECH, dir: [0.1, 0.25, 1] });
  }));
  offs.push(game.on('batteryHit', (h) => {
    if (!playing() || !h || h.escape) return;        // «цель прорвалась» — штраф, а не разрыв
    if (!(h.damage > 0)) {                           // лёг рядом
      fx.shake(0.16, 0.4); fx.flicker(0.25, 0.3); fx.dust({ amount: 0.25 });
      return;
    }
    const bomb = h.by === 'air', k = Math.min(1, 0.5 + h.damage / 30);
    fx.shake(bomb ? 1 : k, bomb ? 0.9 : 0.7);
    fx.flicker(bomb ? 0.95 : 0.75, bomb ? 1.0 : 0.6);
    fx.dust({ amount: bomb ? 1.6 : 1 });
    const p = pick(OVERHEAD);
    fx.sparks({ ...p, amount: bomb ? 1.4 : 1 });
    fx.puff({ kind: 'smoke', ...p, amount: bomb ? 1 : 0.6 });
  }));
  offs.push(game.on('fault', (e) => {
    if (!playing() || !e || e.fixed) return;
    const cur = engine.current;
    if (e.kind === 'lights') {
      fx.flicker(1, 1.2);
      fx.sparks({ ...pick(LAMPS), amount: 0.8 });
    } else if (e.kind === 'drive' && (cur === 'traverse' || cur === 'elevation')) {
      fx.sparks({ ...DRIVE, dir: [-0.3, 0.5, 0.5], amount: 1 });
      fx.puff({ kind: 'smoke', ...DRIVE, amount: 0.8 });
    } else if (e.kind === 'hoist' && cur === 'loading') {
      fx.puff({ kind: 'steam', ...HOIST, dir: [-0.3, 1, 0.2] });
      fx.sparks({ ...HOIST, amount: 0.5 });
    } else fx.flicker(0.35, 0.4);
  }));
  offs.push(game.on('aa', (e) => {
    if (!playing() || !e || !e.jammed || engine.current !== 'aa') return;
    fx.shake(0.12, 0.25);
    fx.puff({ kind: 'steam', station: 'aa', ...AA_GUN, dir: [0, 1, 0.15], amount: 0.7 });
  }));
  offs.push(game.on('phase', () => { if (!playing()) { fx.clear(); smokeInBore = false; } }));

  let nightOn = null, soft = null, graded = null;
  offs.push(engine.onFrame((dt) => {
    const st = s();
    // ночь — то же условие, что у CSS-слоя в оболочке
    const night = (st.phase === 'playing' || st.phase === 'won' || st.phase === 'lost') && !!(st.mission && st.mission.night);
    const isSoft = document.body.classList.contains('night-soft');
    if (night !== nightOn || isSoft !== soft) { nightOn = night; soft = isSoft; engine.setNight(night, isSoft ? 0.5 : 1); }
    const g = !!engine.post.active;
    if (g !== graded) { graded = g; document.body.classList.toggle('gl-grade', g); }
    // зенитный автомат: мелкая дрожь, пока идёт очередь
    const a = st.aa;
    if (st.phase === 'playing' && !st.paused && a && a.firing && !a.jammed && a.ammo > 0) {
      aaT -= dt;
      if (aaT <= 0) { aaT = 0.09; fx.shake(engine.current === 'aa' ? 0.07 : 0.025, 0.14); }
    } else aaT = 0;
    // узел ещё не починен — напоминание там, где он стоит
    const f = st.faults;
    if (st.phase === 'playing' && !st.paused && f && (f.drive || f.hoist)) {
      faultT -= dt;
      if (faultT <= 0) {
        faultT = 2.5 + Math.random() * 3;
        const cur = engine.current;
        if (f.drive && (cur === 'traverse' || cur === 'elevation')) fx.sparks({ ...DRIVE, dir: [-0.3, 0.5, 0.5], amount: 0.3 });
        else if (f.hoist && cur === 'loading') fx.puff({ kind: 'steam', ...HOIST, dir: [-0.3, 1, 0.2], amount: 0.35 });
      }
    }
  }));

  return {
    dispose() { for (const off of offs) { try { off(); } catch (e) { /* уже снят */ } } style.remove(); document.body.classList.remove('gl-grade'); },
  };
}
