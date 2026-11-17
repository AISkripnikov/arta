// Сборка веб-части игры.
//   node build.mjs               — боевая сборка: src/main.js → ../app/src/main/assets/www
//   node build.mjs --dev <name>  — стенд разработки: src/dev/<name>.js → .dev/<name>/ (app.js + index.html)
//   node build.mjs --publish     — выпустить обновление: скопировать собранную игру в ../ota (оттуда её
//                                  скачивают установленные приложения после git push)
import { build } from 'esbuild';
import { cpSync, mkdirSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeManifest, readManifest, matches, describe } from './tools/manifest.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const devIdx = args.indexOf('--dev');
const dev = devIdx >= 0 ? args[devIdx + 1] : null;
const www = join(root, '..', 'app', 'src', 'main', 'assets', 'www');
const ota = join(root, '..', 'ota');

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
