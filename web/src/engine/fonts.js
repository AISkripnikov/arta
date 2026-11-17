// Шрифт Oswald (OFL), встроен в сборку как data-URL (esbuild loader: dataurl).
// loadFonts() регистрирует начертания через FontFace API и ждёт их готовности.
// Если загрузка не удалась — тексты рисуются запасным sans-serif.
import cyr500 from '@fontsource/oswald/files/oswald-cyrillic-500-normal.woff2';
import cyr600 from '@fontsource/oswald/files/oswald-cyrillic-600-normal.woff2';
import lat500 from '@fontsource/oswald/files/oswald-latin-500-normal.woff2';
import lat600 from '@fontsource/oswald/files/oswald-latin-600-normal.woff2';

export const FONT_FAMILY = 'Oswald';
export const FONT_STACK = 'Oswald, "Roboto Condensed", "Arial Narrow", sans-serif';

const RANGE_CYR = 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116';
const RANGE_LAT = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,' +
  'U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

/** Состояние шрифта: loaded — Oswald доступен; capRatio — высота прописной / кегль. */
export const fontState = { loaded: false, capRatio: 0.72 };

let promise = null;

function measureCapRatio() {
  try {
    const c = document.createElement('canvas').getContext('2d');
    c.font = '600 200px ' + FONT_STACK;
    const m = c.measureText('Н');
    if (m.actualBoundingBoxAscent > 0) fontState.capRatio = m.actualBoundingBoxAscent / 200;
  } catch (e) { /* оставляем значение по умолчанию */ }
}

/** Загружает Oswald. Никогда не отклоняется; возвращает true, если шрифт готов. */
export function loadFonts(timeoutMs = 4000) {
  if (promise) return promise;
  promise = (async () => {
    try {
      if (typeof FontFace === 'undefined' || !document.fonts) throw new Error('FontFace API недоступен');
      const defs = [
        [cyr500, '500', RANGE_CYR], [cyr600, '600', RANGE_CYR],
        [lat500, '500', RANGE_LAT], [lat600, '600', RANGE_LAT],
      ];
      const faces = defs.map(([url, weight, unicodeRange]) =>
        new FontFace(FONT_FAMILY, 'url(' + url + ') format("woff2")', { weight, style: 'normal', unicodeRange }));
      const all = Promise.all(faces.map(f => f.load())).then(async loaded => {
        loaded.forEach(f => document.fonts.add(f));
        await Promise.all([
          document.fonts.load('600 32px ' + FONT_FAMILY, 'АБВ 019°'),
          document.fonts.load('500 32px ' + FONT_FAMILY, 'АБВ 019°'),
        ]);
      });
      const timer = new Promise((_, rej) => setTimeout(() => rej(new Error('таймаут загрузки шрифта')), timeoutMs));
      await Promise.race([all, timer]);
      fontState.loaded = true;
    } catch (e) {
      fontState.loaded = false;
      if (typeof console !== 'undefined') console.info('[engine] Oswald не загружен, используется sans-serif:', e && e.message);
    }
    measureCapRatio();
    return fontState.loaded;
  })();
  return promise;
}

/** CSS-строка шрифта для canvas: px — кегль. */
export function fontCss(px, weight = 600) {
  return weight + ' ' + px.toFixed(2) + 'px ' + FONT_STACK;
}
