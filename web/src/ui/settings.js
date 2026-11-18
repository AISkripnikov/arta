// Экран «НАСТРОЙКИ» и применение настроек: логика их только хранит (game.settings()), применяет — оболочка.
//   sens  → engine.settings.sens (маховики и рычаги привода)
//   text  → CSS-переменные --ts (полный масштаб), --tsc (не больше 1.15: кнопки, меню), --tsb (панели HUD) на <html>
//   lefty → класс body.lefty (зеркалит обвязку HUD; 3D-посты не трогает)
//   vibro → vibrate(kind) молчит
const $ = (id) => document.getElementById(id);
const SENS = [0.6, 0.8, 1, 1.3, 1.6];
const TEXT = [[1, 'ОБЫЧНЫЙ'], [1.15, 'КРУПНЫЙ'], [1.3, 'ОЧЕНЬ КРУПНЫЙ']];
const BAR = { 1: 1, 1.15: 1.06, 1.3: 1.12 };
/** Рисунки вибрации, мс. */
export const VIBRO = { shot: 40, hit: 120, bomb: 80, fault: [30, 40, 30] };

export function createSettings({ game, engine, show, sfx }) {
  let back = null, cur = { sens: 1, text: 1, lefty: false, vibro: true };
  const read = () => { try { cur = Object.assign(cur, game.settings()); } catch (e) { /* старая логика без настроек */ } return cur; };

  function apply() {
    const st = read(), root = document.documentElement, body = document.body;
    if (engine.settings) engine.settings.sens = st.sens;
    root.style.setProperty('--ts', String(st.text));
    root.style.setProperty('--tsc', String(Math.min(st.text, 1.15)));
    root.style.setProperty('--tsb', String(BAR[st.text] || 1));
    body.classList.toggle('lefty', !!st.lefty);
    body.classList.toggle('text-l', st.text === 1.15);
    body.classList.toggle('text-xl', st.text === 1.3);
  }

  const seg = (key, items, on) => items.map(([v, label]) => `<button data-set="${key}" data-val="${v}"${on(v) ? ' class="on"' : ''}>${label}</button>`).join('');
  function render() {
    const st = read();
    const near = SENS.reduce((a, v) => (Math.abs(v - st.sens) < Math.abs(a - st.sens) ? v : a), 1);
    $('setSens').innerHTML = seg('sens', SENS.map((v) => [v, String(v).replace('.', ',') + '×']), (v) => v === near);
    $('setText').innerHTML = seg('text', TEXT, (v) => v === st.text);
    $('setLefty').innerHTML = seg('lefty', [[0, 'ВЫКЛ'], [1, 'ВКЛ']], (v) => !!v === !!st.lefty);
    $('setVibro').innerHTML = seg('vibro', [[1, 'ВКЛ'], [0, 'ВЫКЛ']], (v) => !!v === !!st.vibro);
    document.querySelectorAll('#soundSeg button').forEach((b) => b.classList.toggle('on', (b.dataset.sound === '1') === !game.save.muted));
  }

  function vibrate(kind) {
    if (!cur.vibro) return;
    try { if (navigator.vibrate) navigator.vibrate(VIBRO[kind] || kind); } catch (e) { /* вибрации нет */ }
  }

  $('settings').addEventListener('click', (e) => {
    const el = e.target.closest('[data-set],[data-sound],[data-setclose]');
    if (!el) return;
    const d = el.dataset;
    if (d.setclose != null) { sfx('tick'); close(); return; }
    if (d.sound != null) { setTimeout(render, 0); return; }   // звук переключает общий обработчик оболочки
    const key = d.set, val = key === 'lefty' || key === 'vibro' ? d.val === '1' : +d.val;
    game.setSetting(key, val);
    sfx('tick');
    apply(); render();
    if (key === 'vibro' && val) vibrate('shot');
  });
  game.on('settings', () => { apply(); if ($('settings').classList.contains('show')) render(); });

  function open(onBack) { back = onBack || null; render(); show('settings'); }
  function close() { const b = back; back = null; if (b) b(); else show(null); }
  const isOpen = () => $('settings').classList.contains('show');

  apply();
  return { open, close, isOpen, apply, vibrate };
}
