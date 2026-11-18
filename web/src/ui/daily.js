// «ЗАДАНИЕ ДНЯ» и «ПРОДОЛЖИТЬ БОЙ»: тексты для меню и итогов. Дату (местную) задаёт интерфейс, задание строит логика.
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/** Сегодняшняя местная дата 'YYYY-MM-DD'. */
export function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** Подпись под кнопкой меню: дата и лучший счёт за сегодня. */
export function dailyMenuText(game, key = todayKey()) {
  let info = null;
  try { info = game.dailyInfo(key); } catch (e) { /* нет задания дня */ }
  const date = key.slice(8, 10) + '.' + key.slice(5, 7);
  if (!info) return date;
  return date + ' · ' + (info.best ? 'ЛУЧШИЙ СЧЁТ ' + info.best.score + ' ' + '★'.repeat(info.best.stars || 0) : 'ЕЩЁ НЕ ПРОЙДЕНО');
}

/** Блок итогов задания дня (missionEnd.daily = { date, score, best, isNew, previous }). */
export function dailyResultHtml(d) {
  if (!d) return '';
  const best = d.best || null;
  return `<div class="daily-res" id="dailyRes"><span>СЧЁТ ЗАДАНИЯ ДНЯ</span><b>${d.score}</b></div>` +
    (d.isNew ? `<p class="rec">★ ЛУЧШИЙ СЧЁТ ДНЯ${d.previous ? ` (был: ${d.previous.score})` : ''}</p>`
      : best ? `<p class="dim">Лучший счёт за сегодня: ${best.score}${best.stars ? ', ★' + best.stars : ''}</p>` : '');
}

/** Подпись кнопки «ПРОДОЛЖИТЬ БОЙ» (game.resumeInfo() = { title, time, integrity, kind }). */
export function resumeHtml(game, info) {
  return `ПРОДОЛЖИТЬ БОЙ<small>${esc(String(info.title || '').toUpperCase())} · ${game.fmt.time(info.time || 0)} · ПРОЧНОСТЬ ${Math.round(info.integrity != null ? info.integrity : 100)}%</small>`;
}
