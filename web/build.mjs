// Сборка веб-части игры.
//   node build.mjs               — боевая сборка: src/main.js → ../app/src/main/assets/www
//   node build.mjs --dev <name>  — стенд разработки: src/dev/<name>.js → .dev/<name>/ (app.js + index.html)
import { build } from 'esbuild';
import { cpSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const devIdx = args.indexOf('--dev');
const dev = devIdx >= 0 ? args[devIdx + 1] : null;

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
} else {
  const out = join(root, '..', 'app', 'src', 'main', 'assets', 'www');
  if (existsSync(out)) rmSync(out, { recursive: true });
  mkdirSync(out, { recursive: true });
  await build({ ...common, entryPoints: [join(root, 'src/main.js')], outfile: join(out, 'app.js'), minify: true, legalComments: 'none' });
  cpSync(join(root, 'static'), out, { recursive: true });
  console.log('prod build →', out);
}
