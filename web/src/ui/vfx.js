// Зрелищные эффекты боя: события игры → engine.fx (тряска, вспышка, пыль, дым, искры) и красный свет ночного боя.
// Логики и звука здесь нет. Всё рисуется только на текущем посту: эффект чужого поста просто не создаётся.
//   свой выстрел      — толчок, вспышка из амбразуры, пыль с потолка; затвор открыли после выстрела — пороховой дым (ЗАРЯЖАНИЕ)
//   снаряд рядом      — лёгкий толчок, немного пыли
//   попадание/бомба   — сильный толчок, лампы мигают, пыль, искры и дым из-под потолка
//   отказ узла        — искры и дым у привода (ПОВОРОТ, ПОДЪЁМ), пар у элеватора (ЗАРЯЖАНИЕ), искры у плафона (свет)
//   зенитка стреляет  — мелкая дрожь
//   ночь              — engine.setNight: красные лампы и красная коррекция кадра вместо CSS-фильтра #night
export function createVfx({ engine, game }) {
  const fx = engine.fx, offs = [];
  const s = () => game.state;
  const playing = () => s().phase === 'playing';
  const pick = (list) => list[(Math.random() * list.length) | 0];
  // точки в координатах поста: под потолком у стены, по сторонам пульта
  const OVERHEAD = [[-0.95, 2.0, -0.55], [0.95, 1.95, -0.55], [0.5, 2.25, -0.1], [-0.45, 2.2, -0.2]];
  const BREECH = [-0.5, 1.1, -0.3];                 // казённый срез орудия на посту ЗАРЯЖАНИЕ (loading-gun.js: K.X, K.Y, K.ZB)
  let smokeInBore = false, aaT = 0;

  // на уровнях с постобработкой красный фильтр ночи рисует движок — CSS-слой #night прячем
  const style = document.createElement('style');
  style.textContent = 'body.gl-grade #night{display:none}';
  document.head.appendChild(style);

  offs.push(game.on('fired', () => {
    if (!playing()) return;
    const atFire = engine.current === 'fire';
    fx.shake(atFire ? 0.5 : 0.4, 0.6);
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
    fx.sparks({ position: p, amount: bomb ? 1.4 : 1 });
    fx.puff({ kind: 'smoke', position: p, amount: bomb ? 1 : 0.6 });
  }));
  offs.push(game.on('fault', (e) => {
    if (!playing() || !e || e.fixed) return;
    const cur = engine.current;
    if (e.kind === 'lights') {
      fx.flicker(1, 1.2);
      fx.sparks({ position: [Math.random() < 0.5 ? -1.0 : 1.0, 1.42, -0.7], amount: 0.8 });
    } else if (e.kind === 'drive' && (cur === 'traverse' || cur === 'elevation')) {
      const p = [0.78, 0.62, -0.15];
      fx.sparks({ position: p, dir: [0, 0.35, 0.8], amount: 1 });
      fx.puff({ kind: 'smoke', position: p, amount: 0.8 });
    } else if (e.kind === 'hoist' && cur === 'loading') {
      fx.puff({ kind: 'steam', position: [0.72, 0.5, -0.3], dir: [-0.15, 1, 0.3] });
      fx.sparks({ position: [0.72, 0.55, -0.3], amount: 0.5 });
    } else fx.flicker(0.35, 0.4);
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
  }));

  return {
    dispose() { for (const off of offs) { try { off(); } catch (e) { /* уже снят */ } } style.remove(); document.body.classList.remove('gl-grade'); },
  };
}
