// Панель расчёта в HUD: три значка (Н — наводчик, З — заряжающий, Р — радист) с фамилией, полосой усталости и цветом
// состояния (в строю / устал / ранен) + счётчик аптечек. Касание значка раненого — аптечка (game.treat); уставшего — сперва справка, второе касание за 3 с — аптечка.
// Столбик стоит у правого края экрана (в режиме для левши — у левого): там на всех восьми постах пустая стена.
const ROLES = ['gunner', 'loader', 'radio'];
const LETTER = { gunner: 'Н', loader: 'З', radio: 'Р' };
const STATE = { ok: 'в строю', tired: 'устал', wounded: 'ранен' };
const SLOW = { ok: '', tired: ' — работает на четверть медленнее', wounded: ' — работает в полтора раза медленнее' };

export function crewStateText(m) { return STATE[m.state] || m.state; }

export function createCrew({ game, box, toast, sfx, vibro }) {
  const s = game.state;
  const chips = {};
  let key = '', askRole = null, askAt = 0;
  box.innerHTML = '';
  ROLES.forEach((role) => {
    const el = document.createElement('button');
    el.className = 'crew-chip ok'; el.dataset.role = role;
    el.innerHTML = `<span class="top"><b>${LETTER[role]}</b><em></em></span><span class="nm"></span><i class="fat"><u></u></i>`;
    el.addEventListener('click', () => tap(role));
    box.appendChild(el);
    chips[role] = { el, note: el.querySelector('em'), name: el.querySelector('.nm'), bar: el.querySelector('u') };
  });
  const kits = document.createElement('div');
  kits.id = 'crewKits'; kits.innerHTML = '<span>АПТЕЧКИ</span><b>0</b>';
  box.appendChild(kits);
  const kitsN = kits.querySelector('b');

  function tap(role) {
    const m = s.crew && s.crew[role];
    if (!m || s.phase !== 'playing' || s.paused) return;
    if (m.state === 'ok') { if (sfx) sfx('tick'); toast(m.title + ' ' + m.name.toUpperCase() + ': В СТРОЮ · УСТАЛОСТЬ ' + Math.round(m.fatigue * 100) + '%'); return; }
    if (m.state === 'tired') {
      // усталость проходит сама: аптечку тратим только по второму касанию подряд
      const now = Date.now();
      if (askRole !== role || now - askAt > 3000) {
        askRole = role; askAt = now;
        if (sfx) sfx('tick');
        toast(m.title + ' ' + m.name.toUpperCase() + ' УСТАЛ: НА ЧЕТВЕРТЬ МЕДЛЕННЕЕ' + (s.medkits > 0 ? ' · ЕЩЁ КАСАНИЕ — АПТЕЧКА' : ' · АПТЕЧЕК НЕТ'));
        return;
      }
    }
    askRole = null;
    const r = game.treat(role);                // отказ («аптечек нет») покажет общий обработчик события denied
    if (r && r.ok) { if (sfx) sfx('tick'); render(true); }
  }

  /** Обновить значки по game.state (дёшево: DOM трогаем только при изменении). */
  function render(force) {
    const crew = s.crew; if (!crew) return;
    const k = ROLES.map((r) => { const m = crew[r]; return m ? m.state + Math.round(m.fatigue * 25) + (m.state === 'wounded' ? Math.ceil(m.woundedUntil - s.time) : '') : '-'; }).join('|') + '|' + s.medkits;
    if (k === key && !force) return;
    key = k;
    ROLES.forEach((r) => {
      const m = crew[r], c = chips[r]; if (!m) return;
      const can = m.state !== 'ok' && s.medkits > 0;
      c.el.className = 'crew-chip ' + m.state + (m.state === 'wounded' && can ? ' need' : '');
      c.el.title = m.title + ' ' + m.name + ': ' + crewStateText(m);
      c.name.textContent = m.name.toUpperCase();
      c.note.textContent = m.state === 'wounded' ? '✚' + Math.max(0, Math.ceil(m.woundedUntil - s.time)) : m.state === 'tired' ? 'УСТАЛ' : '';
      c.bar.style.width = Math.round(Math.max(0, Math.min(1, m.fatigue)) * 100) + '%';
    });
    kitsN.textContent = s.medkits;
    kits.classList.toggle('zero', !(s.medkits > 0));
  }

  const off = game.on('crew', (e) => {
    const m = s.crew && s.crew[e.role]; if (!m) return;
    const who = m.title + ' ' + m.name.toUpperCase();
    if (e.state === 'wounded') { if (vibro) vibro('hit'); toast(who + ' РАНЕН' + (s.medkits > 0 ? ' — КОСНИТЕСЬ ЕГО ЗНАЧКА: АПТЕЧКА' : ' — АПТЕЧЕК НЕТ')); }
    else if (e.state === 'tired') toast(who + ' УСТАЛ' + SLOW.tired.toUpperCase());
    else toast(who + ' СНОВА В СТРОЮ');
    render(true);
  });

  return { render, tap, dispose() { off(); }, slowText: (m) => SLOW[m.state] || '' };
}
