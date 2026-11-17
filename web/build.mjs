// Сборка веб-части игры.
//   node build.mjs               — боевая сборка: src/main.js → ../app/src/main/assets/www
//   node build.mjs --dev <name>  — стенд разработки: src/dev/<name>.js → .dev/<name>/ (app.js + index.html)
//   node build.mjs --publish     — выпустить обновление: скопировать собранную игру в ../ota (оттуда её
//                                  скачивают установленные приложения после git push)
import { build } from 'esbuild';
import { cpSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeManifest, readManifest } from './tools/manifest.mjs';

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
  const m = readManifest(www);
  if (!m) throw new Error('Сначала соберите игру: node build.mjs');
  const pub = readManifest(ota);
  if (pub && pub.version >= m.version) { console.log('ota/ уже содержит версию', pub.version, '— публиковать нечего'); process.exit(0); }
  if (existsSync(ota)) rmSync(ota, { recursive: true });
  cpSync(www, ota, { recursive: true });
  console.log('опубликована версия', m.version, '→', ota, '(не забудьте git commit && git push)');
} else {
  const out = www;
  if (existsSync(out)) rmSync(out, { recursive: true });
  mkdirSync(out, { recursive: true });
  await build({ ...common, entryPoints: [join(root, 'src/main.js')], outfile: join(out, 'app.js'), minify: true, legalComments: 'none' });
  cpSync(join(root, 'static'), out, { recursive: true });
  const m = writeManifest(out, { orientation: 'landscape', minApp: 2, published: readManifest(ota) });
  console.log('версия игры', m.version);
  console.log('prod build →', out);
}
