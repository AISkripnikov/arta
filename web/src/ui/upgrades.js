// Экран «СНАБЖЕНИЕ»: улучшения башни за очки снабжения (1 очко за каждые 150 опыта). Покупка — только вне боя.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function createUpgrades({ game, show, dialog, sfx, onClose }) {
  const points = () => { try { return game.points(); } catch (e) { return 0; } };
  const list = () => { try { return game.upgrades(); } catch (e) { return []; } };
  /** Сколько улучшений можно купить прямо сейчас (для значка на кнопке меню). */
  const affordable = () => { const p = points(); return list().filter((u) => u.cost != null && u.cost <= p).length; };

  function render(msg) {
    const p = points();
    $('upPoints').textContent = p;
    $('upMsg').textContent = msg || '';
    $('upGrid').innerHTML = list().map((u) => {
      const max = u.cost == null, can = !max && u.cost <= p;
      const pips = Array.from({ length: u.max }, (_, i) => `<i${i < u.level ? ' class="on"' : ''}></i>`).join('');
      return `<div class="up-card${max ? ' max' : ''}" data-up="${u.id}" data-level="${u.level}">` +
        `<div class="up-h"><b>${esc(u.title)}</b><span class="up-pips">${pips}</span></div>` +
        `<div class="up-d">${esc(u.desc)}</div>` +
        `<div class="up-e">СЕЙЧАС: ${esc(u.effect)}${u.next ? '<br>ДАЛЬШЕ: ' + esc(u.next) : ''}</div>` +
        `<button class="btn small${can ? ' primary' : ''}" data-buy="${u.id}"${can ? '' : ' disabled'}>${max ? 'МАКСИМУМ' : can ? 'УЛУЧШИТЬ · ' + u.cost + ' ОЧК.' : 'НУЖНО ' + u.cost + ' ОЧК.'}</button></div>`;
    }).join('');
  }

  function open() { render(); show('upgrades'); }
  function close() { if (onClose) onClose(); else show(null); }
  function confirmReset() {
    dialog('<h2>СБРОСИТЬ УЛУЧШЕНИЯ?</h2><p>Все улучшения башни будут сняты, потраченные очки снабжения вернутся полностью.</p>', [
      { text: 'СБРОСИТЬ', primary: true, fn: () => { const r = game.resetUpgrades(); open(); if (r && r.ok === false) render(r.reason); } },
      { text: 'ОТМЕНА', ghost: true, fn: open },
    ], open);
  }

  $('upgrades').addEventListener('click', (e) => {
    const el = e.target.closest('[data-buy],[data-upact]');
    if (!el || el.disabled) return;
    sfx('tick');
    if (el.dataset.buy) { const r = game.buyUpgrade(el.dataset.buy); render(r && r.ok ? '' : (r && r.reason) || 'Не удалось'); }
    else if (el.dataset.upact === 'reset') confirmReset();
    else if (el.dataset.upact === 'close') close();
  });
  game.on('upgrades', () => { if ($('upgrades').classList.contains('show')) render(); });

  const isOpen = () => $('upgrades').classList.contains('show');
  return { open, close, isOpen, render, points, affordable };
}
