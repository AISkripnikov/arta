// «РАЗБОР БОЯ»: карта района 20×20 км с истинными следами целей и всеми разрывами + таблица выстрелов.
// Третий аргумент open() — журнал оболочки: пути своих кораблей, бомбы налётов, номера разрывов, замеченных в трубу.
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const COL = { hit: '#4be36a', miss: '#ff4a3a', illum: '#fff3d6', smoke: '#9aa6b0', sel: '#ffb347', pair: '#d39a1e', friend: '#6fc3ff', bomb: '#ff7a2a', seen: '#9fd4ff' };
const MAP = 20;

/** Цвет и вид результата выстрела. */
function kindOf(h) { return h.hit ? 'hit' : h.shell === 'illum' ? 'illum' : h.shell === 'smoke' ? 'smoke' : 'miss'; }

export function createDebrief({ game, canvas, table, legend, zoomBtn }) {
  let data = null, sel = 0, zoomed = false, view = { x0: 0, y0: 0, span: MAP }, base = null, size = 0, dpr = 1;

  const LEGEND = `<i style="background:${COL.hit}"></i>ПОПАДАНИЕ<i style="background:${COL.miss}"></i>ПРОМАХ<i style="background:${COL.illum}"></i>ОСВ<i style="background:${COL.smoke}"></i>ДЫМ`;
  legend.innerHTML = LEGEND;

  const px = (x, y) => [((x - view.x0) / view.span) * size, (1 - (y - view.y0) / view.span) * size];

  function fitView() {
    if (!zoomed) return { x0: 0, y0: 0, span: MAP };
    const pts = [];
    data.history.forEach((h) => { if (h.x != null) pts.push(h); });
    Object.keys(data.tracks).forEach((id) => (data.tracks[id] || []).forEach((p) => pts.push(p)));
    if (!pts.length) return { x0: 0, y0: 0, span: MAP };
    let ax = Infinity, bx = -Infinity, ay = Infinity, by = -Infinity;
    pts.forEach((p) => { ax = Math.min(ax, p.x); bx = Math.max(bx, p.x); ay = Math.min(ay, p.y); by = Math.max(by, p.y); });
    const span = Math.min(MAP, Math.max(2, Math.max(bx - ax, by - ay) * 1.3 + 0.6));
    return { x0: (ax + bx) / 2 - span / 2, y0: (ay + by) / 2 - span / 2, span };
  }

  /** Подложка (море, суша, сетка, батарея, следы целей) — рисуется один раз на масштаб. */
  function drawBase() {
    base = document.createElement('canvas'); base.width = base.height = Math.round(size * dpr);
    const g = base.getContext('2d'); g.scale(dpr, dpr);
    g.fillStyle = '#0e1318'; g.fillRect(0, 0, size, size);
    const N = 110, cell = view.span / N, cp = size / N;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = view.x0 + (i + 0.5) * cell, y = view.y0 + (j + 0.5) * cell;
      if (x < 0 || y < 0 || x > MAP || y > MAP) continue;
      let land = false; try { land = game.isLand(x, y); } catch (e) { /* карта недоступна */ }
      g.fillStyle = land ? '#4a5240' : '#1c2c3a';
      g.fillRect(i * cp - 0.3, size - (j + 1) * cp - 0.3, cp + 0.6, cp + 0.6);
    }
    // сетка: 2 км на всей карте, 1 км или 0.5 км вблизи
    const step = view.span > 12 ? 2 : view.span > 5 ? 1 : 0.5;
    g.lineWidth = 1; g.font = '500 9px Oswald, sans-serif'; g.textBaseline = 'top';
    for (let v = Math.ceil(view.x0 / step) * step; v <= view.x0 + view.span + 1e-6; v += step) {
      if (v < 0 || v > MAP) continue;
      const major = Math.abs(v / (step * 2) - Math.round(v / (step * 2))) < 1e-6;
      g.strokeStyle = major ? 'rgba(232,224,200,.2)' : 'rgba(232,224,200,.08)';
      const [X] = px(v, 0); g.beginPath(); g.moveTo(X + 0.5, 0); g.lineTo(X + 0.5, size); g.stroke();
      if (major) { g.fillStyle = 'rgba(232,224,200,.55)'; g.fillText(String(+v.toFixed(1)), X + 2, size - 11); }
    }
    for (let v = Math.ceil(view.y0 / step) * step; v <= view.y0 + view.span + 1e-6; v += step) {
      if (v < 0 || v > MAP) continue;
      const major = Math.abs(v / (step * 2) - Math.round(v / (step * 2))) < 1e-6;
      g.strokeStyle = major ? 'rgba(232,224,200,.2)' : 'rgba(232,224,200,.08)';
      const [, Y] = px(0, v); g.beginPath(); g.moveTo(0, Y + 0.5); g.lineTo(size, Y + 0.5); g.stroke();
      if (major) { g.fillStyle = 'rgba(232,224,200,.55)'; g.fillText(String(+v.toFixed(1)), 2, Y + 2); }
    }
    // посты звукометрии и батарея
    (data.map.posts || []).forEach((p) => {
      const [X, Y] = px(p.x, p.y);
      g.fillStyle = '#b9c0c4'; g.beginPath(); g.moveTo(X, Y - 4); g.lineTo(X + 4, Y + 3); g.lineTo(X - 4, Y + 3); g.closePath(); g.fill();
      g.fillText(p.name, X + 5, Y - 4);
    });
    const [BX, BY] = px(data.battery.x, data.battery.y);
    g.fillStyle = '#d39a1e'; g.strokeStyle = '#000'; g.fillRect(BX - 4, BY - 4, 8, 8); g.strokeRect(BX - 4.5, BY - 4.5, 9, 9);
    g.font = '600 10px Oswald, sans-serif'; g.fillText('УТЁС', BX + 7, BY - 5);
    // истинные следы целей
    Object.keys(data.tracks).forEach((id) => {
      const tr = data.tracks[id] || []; if (!tr.length) return;
      const t = data.targets[id];
      g.strokeStyle = 'rgba(232,224,200,.7)'; g.lineWidth = 1.3; g.setLineDash([4, 3]); g.beginPath();
      tr.forEach((p, i) => { const [X, Y] = px(p.x, p.y); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
      g.stroke(); g.setLineDash([]);
      const [SX, SY] = px(tr[0].x, tr[0].y), [EX, EY] = px(tr[tr.length - 1].x, tr[tr.length - 1].y);
      if (tr.length > 1 && Math.hypot(EX - SX, EY - SY) > 5) { g.strokeStyle = 'rgba(232,224,200,.8)'; g.beginPath(); g.arc(SX, SY, 2.5, 0, 6.3); g.stroke(); }
      const dead = t ? !t.alive && !t.escaped : false;
      g.lineWidth = 2; g.strokeStyle = dead ? '#ff4a3a' : '#e8e0c8';
      if (dead) { g.beginPath(); g.moveTo(EX - 4, EY - 4); g.lineTo(EX + 4, EY + 4); g.moveTo(EX + 4, EY - 4); g.lineTo(EX - 4, EY + 4); g.stroke(); }
      else { g.beginPath(); g.moveTo(EX, EY - 5); g.lineTo(EX + 5, EY); g.lineTo(EX, EY + 5); g.lineTo(EX - 5, EY); g.closePath(); g.stroke(); }
      g.fillStyle = '#e8e0c8'; g.font = '600 10px Oswald, sans-serif'; g.fillText('Ц' + id, EX + 6, EY + 2);
    });
    // свои: путь, начало, знак исхода (кружок — на плаву, флажок — дошёл до порта, крест — потоплен)
    data.friends.forEach((f) => {
      const tr = f.track; if (!tr.length) return;
      g.strokeStyle = COL.friend; g.globalAlpha = 0.8; g.lineWidth = 1.3; g.setLineDash([2, 3]); g.beginPath();
      tr.forEach((p, i) => { const [X, Y] = px(p.x, p.y); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
      g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      const [SX, SY] = px(tr[0].x, tr[0].y), [EX, EY] = px(tr[tr.length - 1].x, tr[tr.length - 1].y);
      if (Math.hypot(EX - SX, EY - SY) > 5) { g.fillStyle = COL.friend; g.beginPath(); g.arc(SX, SY, 1.8, 0, 6.3); g.fill(); }
      g.lineWidth = 2; g.strokeStyle = f.alive ? COL.friend : '#ff4a3a'; g.fillStyle = COL.friend;
      if (!f.alive) { g.beginPath(); g.moveTo(EX - 4, EY - 4); g.lineTo(EX + 4, EY + 4); g.moveTo(EX + 4, EY - 4); g.lineTo(EX - 4, EY + 4); g.stroke(); g.lineWidth = 1; g.strokeStyle = COL.friend; g.beginPath(); g.arc(EX, EY, 6.5, 0, 6.3); g.stroke(); }
      else if (f.arrived) { g.beginPath(); g.moveTo(EX, EY + 5); g.lineTo(EX, EY - 7); g.stroke(); g.beginPath(); g.moveTo(EX, EY - 7); g.lineTo(EX + 7, EY - 4.5); g.lineTo(EX, EY - 2); g.closePath(); g.fill(); }
      else { g.beginPath(); g.arc(EX, EY, 4, 0, 6.3); g.stroke(); }
      g.fillStyle = COL.friend; g.font = '600 10px Oswald, sans-serif'; g.fillText('С' + String(f.id).replace(/\D/g, ''), EX + 7, EY + 2);
    });
    // бомбы налёта — вокруг батареи, со стороны захода самолётов
    data.bombs.forEach((b, i) => {
      const a = ((b.from || 0) + (i % 5 - 2) * 28) * Math.PI / 180, r = 9 + (i % 3) * 4;
      const X = BX + Math.sin(a) * r, Y = BY - Math.cos(a) * r;
      g.strokeStyle = COL.bomb; g.lineWidth = 1.5; g.beginPath();
      for (let k = 0; k < 4; k++) { const q = k * Math.PI / 4; g.moveTo(X - Math.cos(q) * 3.5, Y - Math.sin(q) * 3.5); g.lineTo(X + Math.cos(q) * 3.5, Y + Math.sin(q) * 3.5); }
      g.stroke();
    });
    if (data.bombs.length) { g.fillStyle = COL.bomb; g.font = '600 9px Oswald, sans-serif'; g.fillText('БОМБЫ ×' + data.bombs.length, BX + 7, BY + 7); }
  }

  function draw() {
    if (!data || !size) return;
    if (!base) drawBase();
    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(base, 0, 0); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const byN = {}; data.history.forEach((h) => { byN[h.n] = h; });
    // пары «вилки»
    g.strokeStyle = COL.pair; g.lineWidth = 1.5;
    data.history.forEach((h) => {
      const m = h.pair && byN[h.pair];
      if (!m || h.n > m.n || h.x == null || m.x == null) return;
      const [X1, Y1] = px(h.x, h.y), [X2, Y2] = px(m.x, m.y);
      g.beginPath(); g.moveTo(X1, Y1); g.lineTo(X2, Y2); g.stroke();
    });
    const s = byN[sel];
    if (s && s.x != null) {
      const [BX, BY] = px(data.battery.x, data.battery.y), [X, Y] = px(s.x, s.y);
      g.strokeStyle = 'rgba(255,179,71,.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(BX, BY); g.lineTo(X, Y); g.stroke();
    }
    g.font = '600 9px Oswald, sans-serif'; g.textBaseline = 'middle';
    const few = data.history.length <= 14 || zoomed;
    data.history.forEach((h) => {
      if (h.x == null) return;
      const [X, Y] = px(h.x, h.y), c = COL[kindOf(h)], on = h.n === sel;
      g.fillStyle = c; g.strokeStyle = '#000'; g.lineWidth = 1;
      g.beginPath(); g.arc(X, Y, on ? 4.5 : 3, 0, 6.3); g.fill(); g.stroke();
      if (data.observed[h.n]) { g.strokeStyle = COL.seen; g.lineWidth = 1.2; g.beginPath(); g.arc(X, Y, on ? 6.5 : 5.5, 0, 6.3); g.stroke(); }
      if (on) { g.strokeStyle = COL.sel; g.lineWidth = 2; g.beginPath(); g.arc(X, Y, 9, 0, 6.3); g.stroke(); }
      if (few || on) {
        const tx = X + (on ? 12 : 5), ty = Y - 6;
        g.lineWidth = 2.5; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(String(h.n), tx, ty);
        g.fillStyle = on ? COL.sel : c; g.fillText(String(h.n), tx, ty);
      }
    });
  }

  function layout() {
    const box = canvas.parentElement, cols = box.parentElement;
    const sz = Math.floor(Math.max(120, Math.min(box.clientHeight || cols.clientHeight, cols.clientWidth * 0.46)) - 2);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    if (sz !== size || canvas.width !== Math.round(sz * dpr)) {
      size = sz; canvas.style.width = canvas.style.height = sz + 'px'; canvas.width = canvas.height = Math.round(sz * dpr); base = null;
    }
  }

  function select(n, scroll) {
    sel = sel === n ? 0 : n;
    table.querySelectorAll('tr[data-n]').forEach((tr) => {
      const on = +tr.dataset.n === sel; tr.classList.toggle('on', on);
      if (on && scroll && tr.scrollIntoView) tr.scrollIntoView({ block: 'nearest' });
    });
    draw();
  }

  function renderTable() {
    const S = game.SHELLS || {}, byN = {}; data.history.forEach((h) => { byN[h.n] = h; });
    const anySeen = data.history.some((h) => data.observed[h.n]);
    const rows = data.history.map((h) => {
      const k = kindOf(h), tg = h.targetId != null ? 'Ц' + h.targetId : '';
      let txt = h.reportText;
      if (!txt) {
        const mate = h.pair && byN[h.pair];
        txt = h.x == null ? 'Снаряд не долетел до конца боя' : h.hit ? 'Попадание' + (tg ? ' · ' + tg : '') : mate && mate.reportText ? '«Вилка» с № ' + mate.n + ' — доклад там' : 'Разрыв, доклада нет';
      } else if (h.hit && !/попадани|уничтож|накрыт/i.test(txt)) txt = 'Попадание. ' + txt;
      return `<tr data-n="${h.n}" class="${k === 'hit' ? 'hit' : k === 'miss' ? '' : 'sp'}"><td>${h.n}${h.pair ? '<br>⇄' + h.pair : ''}</td><td>${game.fmt.time(h.time)}</td><td>${esc((S[h.shell] || {}).name || h.shell)}</td><td>${h.charges}</td>` +
        `<td>${(+h.bearing).toFixed(1)}°</td><td>${(+h.elevation).toFixed(2)}°</td>${anySeen ? `<td class="ob">${data.observed[h.n] ? '◉' : ''}</td>` : ''}<td>${esc(txt)}</td></tr>`;
    }).join('');
    // сводка под таблицей: свои силы, огонь по своим, налёты, свой глаз
    const st = data.stats, sum = [];
    if (data.friends.length) sum.push('<b>СВОИ</b>' + data.friends.map((f) => `<span${f.alive ? '' : ' class="bad"'}>С${String(f.id).replace(/\D/g, '')} ${esc(f.name)} — ${f.arrived ? 'дошёл' : !f.alive ? 'потоплен' : f.hp < f.maxHp ? 'повреждён' : 'цел'}</span>`).join('; '));
    if (st.friendlyHits > 0) sum.push(`<b>ОГОНЬ ПО СВОИМ</b><span class="bad">попаданий ${st.friendlyHits}${st.friendlyKills > 0 ? ', потоплено ' + st.friendlyKills : ''}</span>`);
    if (st.planesDown > 0 || st.bombs > 0 || data.bombs.length) sum.push(`<b>НАЛЁТЫ</b>сбито ${st.planesDown || 0}, бомб по батарее ${st.bombs != null ? st.bombs : data.bombs.length}`);
    if (anySeen) sum.push('<b>ТРУБА</b>◉ — разрыв видел свой наблюдатель: ' + data.history.filter((h) => data.observed[h.n]).length + ' из ' + data.history.length);
    const sumHtml = sum.length ? `<div class="dbf-sum">${sum.map((x) => `<div>${x}</div>`).join('')}</div>` : '';
    table.innerHTML = (data.history.length
      ? `<table class="dbf"><thead><tr><th>№</th><th>ВРЕМЯ</th><th>СНАРЯД</th><th>ЗАР.</th><th>ПЕЛЕНГ</th><th>УГОЛ</th>${anySeen ? '<th title="Разрыв видел свой наблюдатель">ТРУБА</th>' : ''}<th>РЕЗУЛЬТАТ</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<div class="dbf-empty">За этот бой не сделано ни одного выстрела.</div>') + sumHtml;
    table.scrollTop = 0;
  }

  table.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-n]'); if (tr && data) select(+tr.dataset.n, false); });
  canvas.addEventListener('click', (e) => {
    if (!data) return;
    const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = null, bd = 18;
    data.history.forEach((h) => { if (h.x == null) return; const [X, Y] = px(h.x, h.y), d = Math.hypot(X - mx, Y - my); if (d < bd) { bd = d; best = h; } });
    if (best && best.n !== sel) select(best.n, true);
  });
  window.addEventListener('resize', () => { if (data && canvas.offsetParent) { layout(); draw(); } });

  return {
    /** Показать разбор: e — событие missionEnd (history, tracks), state — состояние игры на момент конца боя. */
    open(e, state, log) {
      const targets = {}, lg = log || {};
      const friends = (state.friends || []).map((f) => {
        const track = ((lg.friends && lg.friends[f.id]) || []).slice();
        if (!track.length) track.push({ x: f.x, y: f.y });
        return { id: f.id, name: f.name || f.label, alive: f.alive, arrived: f.arrived, hp: f.hp, maxHp: f.maxHp, convoy: f.convoy, track };
      });
      const observed = Object.assign({}, lg.observed || {});
      (state.impacts || []).forEach((i) => { if (i.observed) observed[i.n] = true; });
      (state.targets || []).forEach((t) => { targets[t.id] = { alive: t.alive, escaped: t.escaped, name: t.name }; });
      data = {
        history: (e && e.history) || state.history || [], tracks: (e && e.tracks) || state.tracks || {},
        map: (state.mission && state.mission.map) || {}, battery: (state.mission && state.mission.battery) || { x: 10, y: 2 }, targets,
        friends, bombs: (lg.bombs || []).slice(), observed, stats: Object.assign({}, state.stats || {}, (e && e.stats) || {}),
      };
      legend.innerHTML = LEGEND + (friends.length ? `<i style="background:${COL.friend}"></i>СВОИ` : '') + (data.bombs.length ? `<i style="background:${COL.bomb}"></i>БОМБЫ` : '');
      // цели, которых уже нет в state.targets (оборона), считаем выбывшими
      Object.keys(data.tracks).forEach((id) => { if (!targets[id]) targets[id] = { alive: false, escaped: false }; });
      sel = 0; zoomed = false; base = null; view = fitView();
      zoomBtn.textContent = 'РАЙОН БОЯ';
      renderTable(); layout(); draw();
    },
    toggleZoom() { if (!data) return; zoomed = !zoomed; zoomBtn.textContent = zoomed ? 'ВСЯ КАРТА' : 'РАЙОН БОЯ'; view = fitView(); base = null; draw(); },
    select,
    get selected() { return sel; },
  };
}
