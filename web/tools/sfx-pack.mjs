// Упаковать записанные звуки в static/sfx/pack<N>.js (base64 mp3, вызовы window.__artaSfx(имя, данные)).
//   node tools/sfx-pack.mjs [каталог-mp3 = .dev/sfx-src]
// Зачем пакеты, а не голые mp3: игра в WebView открыта с file://, fetch и XHR к файлам там не работают (настройка
// allowFileAccessFromFileURLs выключена по умолчанию), а <script src> — работает. Состав пакетов — engine/audio/samples.js.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKS, packFiles } from '../src/engine/audio/samples.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2] || join(root, '.dev', 'sfx-src');
const out = join(root, 'static', 'sfx');
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (/^pack\d+\.js$/.test(f)) rmSync(join(out, f));
let total = 0;
for (const p of PACKS) {
  const names = packFiles(p);
  const parts = [];
  for (const n of names) {
    const file = join(src, n + '.mp3');
    if (!existsSync(file)) throw new Error('нет файла ' + file + ' (python3 -I tools/sfx-make.py <исходники>)');
    parts.push(`f(${JSON.stringify(n)},"${readFileSync(file).toString('base64')}");`);
  }
  const js = `/* АРТА: записанные звуки, пакет ${p} — источники и лицензии: CREDITS-AUDIO.md */\n(function(f){if(!f)return;\n${parts.join('\n')}\n})(window.__artaSfx);\n`;
  writeFileSync(join(out, `pack${p}.js`), js);
  total += js.length;
  console.log(`pack${p}.js  ${names.length} звуков  ${(js.length / 1024).toFixed(0)} КБ`);
}
console.log(`всего ${(total / 1048576).toFixed(2)} МБ`);
