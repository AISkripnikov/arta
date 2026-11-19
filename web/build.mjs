// Сборка веб-части игры.
//   node build.mjs               — боевая сборка: src/main.js → ../app/src/main/assets/www
//   node build.mjs --dev <name>  — стенд разработки: src/dev/<name>.js → .dev/<name>/ (app.js + index.html)
//   node build.mjs --publish     — выпустить обновление: скопировать собранную игру в ../ota (оттуда её
//                                  скачивают установленные приложения после git push)
//   node build.mjs --out <dir>   — личная полная сборка игры в <dir> (та же, что боевая: src/main.js + static). Каталог
//                                  приложения (assets/www), ../ota и номер версии не трогает и version.json не пишет —
//                                  такую сборку нельзя опубликовать. Нужна, когда игру собирают несколько человек сразу:
//                                  ARTA_WWW=<dir> node tools/e2e.cjs · node tools/tour.cjs <снимки> --www <dir> · node tools/shot.cjs <dir> <png>
import { build } from 'esbuild';
import { cpSync, mkdirSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeManifest, readManifest, matches, describe } from './tools/manifest.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const devIdx = args.indexOf('--dev');
const dev = devIdx >= 0 ? args[devIdx + 1] : null;
const www = join(root, '..', 'app', 'src', 'main', 'assets', 'www');
const ota = join(root, '..', 'ota');
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? args[outIdx + 1] : null;
const inside = (dir, parent) => { const r = relative(parent, dir); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };

const common = {
  bundle: true,
  format: 'iife',
  target: ['chrome80'],
  loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl', '.glsl': 'text' },
  logLevel: 'info',
};

if (dev) {
  const out = join(root, '.dev', dev);
  mkdirSync(out, { recursive: true });
  await build({ ...common, entryPoints: [join(root, 'src/dev', dev + '.js')], outfile: join(out, 'app.js'), sourcemap: 'inline', minify: false });
  writeFileSync(join(out, 'index.html'),
    '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">' +
    '<style>html,body{margin:0;height:100%;background:#000;overflow:hidden;touch-action:none}#stage{width:100%;height:100%;display:block}</style>' +
    '</head><body><canvas id="stage"></canvas><script src="app.js"></script></body></html>');
  console.log('dev build →', out);
} else if (outIdx >= 0) {
  // Личная полная сборка: ровно то же, что боевая, но в свой каталог и без манифеста версии.
  if (!outDir || outDir.startsWith('--')) throw new Error('Укажите каталог: node build.mjs --out <dir>');
  if (args.includes('--publish')) throw new Error('--out и --publish вместе не работают: личную сборку не публикуют');
  const out = resolve(outDir);
  const repo = join(root, '..');
  for (const [dir, name] of [[www, 'каталог приложения assets/www'], [ota, 'канал обновлений ota/'], [join(repo, 'app'), 'проект приложения app/'], [join(repo, 'dist'), 'dist/']]) {
    if (inside(out, dir)) throw new Error(`--out: ${out} — это ${name}; личную сборку кладут в другое место (например, web/.dev/full-<имя>)`);
  }
  for (const dir of [join(root, 'src'), join(root, 'static'), join(root, 'tools'), join(root, 'test'), join(root, 'node_modules')]) {
    if (inside(out, dir) || inside(dir, out)) throw new Error(`--out: ${out} пересекается с исходниками (${dir})`);
  }
  if (dirname(out) === join(root, '.dev') && existsSync(join(root, 'src', 'dev', basename(out) + '.js'))) throw new Error(`--out: ${out} — каталог стенда «${basename(out)}» (node build.mjs --dev ${basename(out)}); возьмите другое имя`);
  // каталог пересоздаём, только если он пуст или в нём прежняя полная сборка (index.html + app.js + style.css): чужое не стираем
  if (existsSync(out)) {
    const names = readdirSync(out);
    if (names.length && !['index.html', 'app.js', 'style.css'].every((n) => names.includes(n))) throw new Error(`--out: в ${out} лежит не сборка игры — укажите пустой или новый каталог`);
    rmSync(out, { recursive: true });
  }
  mkdirSync(out, { recursive: true });
  await build({ ...common, entryPoints: [join(root, 'src/main.js')], outfile: join(out, 'app.js'), minify: true, legalComments: 'none' });
  cpSync(join(root, 'static'), out, { recursive: true });
  console.log('личная сборка (без версии, не для публикации) →', out);
} else if (args.includes('--publish')) {
  // Канал обновлений: ota/version.json (единственный изменяемый файл) + ota/v<версия>/… (неизменяемые файлы).
  const m = readManifest(www);
  if (!m) throw new Error('Сначала соберите игру: node build.mjs');
  if (!matches(www)) throw new Error('Файлы в assets/www не совпадают с их version.json — пересоберите игру (node build.mjs)');
  const pub = readManifest(ota);
  if (pub && pub.version === m.version) { console.log('ota/ уже содержит версию', pub.version, '— публиковать нечего'); process.exit(0); }
  if (pub && pub.version > m.version) throw new Error(`В ota/ версия ${pub.version} новее собранной ${m.version}`);
  const dst = join(ota, 'v' + m.version);
  mkdirSync(ota, { recursive: true });
  if (existsSync(dst)) rmSync(dst, { recursive: true });
  cpSync(www, dst, { recursive: true });
  rmSync(join(dst, 'version.json'));
  if (JSON.stringify(describe(dst)) !== JSON.stringify(m.files)) throw new Error('Копия в ota/ не совпала с манифестом');
  cpSync(join(www, 'version.json'), join(ota, 'version.json'));
  // оставляем две последние версии: новую и предыдущую (её ещё могут докачивать)
  const keep = new Set(['v' + m.version, pub ? 'v' + pub.version : '']);
  for (const name of readdirSync(ota)) if (/^v\d+$/.test(name) && !keep.has(name)) rmSync(join(ota, name), { recursive: true });
  console.log('опубликована версия', m.version, '→', dst, '\nОсталось: git add -A && git commit && git push — приложения скачают её сами (задержка кэша GitHub до 5 минут).');
} else {
  const out = www;
  const prevBuilt = readManifest(www);
  if (existsSync(out)) rmSync(out, { recursive: true });
  mkdirSync(out, { recursive: true });
  await build({ ...common, entryPoints: [join(root, 'src/main.js')], outfile: join(out, 'app.js'), minify: true, legalComments: 'none' });
  cpSync(join(root, 'static'), out, { recursive: true });
  const m = writeManifest(out, { orientation: 'landscape', minApp: 3, confirm: true, known: [prevBuilt, readManifest(ota)] });
  console.log('версия игры', m.version);
  console.log('prod build →', out);
}
