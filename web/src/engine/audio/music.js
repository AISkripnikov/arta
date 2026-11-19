// Музыка меню (шина music): редкая, медленная, тёмная. Тема (круг 64 с: ре минор — си-бемоль — соль минор — ля без
// терции; «струнные», литавры, рожок — см. рецепт theme в catalogue.js) просчитывается ОДИН раз в буфер банка, лениво:
// в очереди банка она последняя, а если музыку попросили раньше — идёт вне очереди. Живых генераторов у музыки нет:
// во время игры это один источник-петля и одно усиление. Пока буфер не готов — тишина, затем тема плавно входит.
export function createMusic(core) {
  let playing = false, cur = null, want = 0;

  function attach(id) {
    if (!playing || id !== want || cur) return;
    const ctx = core.ctx, buf = core.bank && core.bank.get('theme', 0);
    if (!buf) { core.whenReady('theme', () => attach(id)); return; }
    const t = ctx.currentTime + 0.02, g = ctx.createGain(), src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true; src.connect(g); g.connect(core.input('music', 'out'));
    const lvl = core.recipeGain('theme');
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t); if (core.offline) g.gain.linearRampToValueAtTime(lvl, t + 0.08); else g.gain.setTargetAtTime(lvl, t, 0.6);
    src.start(t);
    cur = { g, src };
  }

  return {
    get playing() { return playing; },
    start() {
      if (playing || !core.ctx) return;
      playing = true; want++;
      attach(want);
    },
    stop(fade) {
      const ctx = core.ctx; if (!playing || !ctx) return;
      playing = false; want++;
      if (!cur) return;
      const t = ctx.currentTime, tc = fade == null ? 0.5 : Math.max(0.02, fade), c = cur; cur = null;
      c.g.gain.cancelScheduledValues(t); c.g.gain.setValueAtTime(c.g.gain.value, t); c.g.gain.setTargetAtTime(0, t, tc);
      try { c.src.stop(t + tc * 6); } catch (e) { /* уже */ }
      core.trash([c.src, c.g], t + tc * 6 + 0.1);
    },
    reset() { playing = false; cur = null; want++; },
  };
}
