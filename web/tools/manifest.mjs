// Манифест версии игры (version.json) для обновления «по воздуху».
//   node tools/manifest.mjs <dir> [--orientation landscape|portrait] [--min-app 3] [--confirm] [--against <ota-dir>]
// Номер версии никогда не используется повторно для другого содержимого: если сборка совпадает с уже
// известной (предыдущей в том же каталоге или опубликованной) — номер сохраняется, иначе берётся
// «минуты эпохи», но строго больше всех известных номеров.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST = 'version.json';
// те же ограничения, что проверяет приложение (OtaCore.parse)
const SAFE_PATH = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;
const MAX_FILES = 300, MAX_TOTAL = 40 * 1024 * 1024;

function listFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, base));
    else if (relative(base, p) !== MANIFEST) out.push(relative(base, p).split(sep).join('/'));
  }
  return out;
}

export function describe(dir) {
  const files = listFiles(dir).map((path) => {
    const buf = readFileSync(join(dir, path));
    return { path, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
  });
  const bad = files.filter((f) => !SAFE_PATH.test(f.path) || f.path.includes('..') || f.path.length > 200);
  if (bad.length) throw new Error('Недопустимые имена файлов для обновления (латиница, цифры, _ . -; без точки в начале): ' + bad.map((f) => f.path).join(', '));
  if (!files.some((f) => f.path === 'index.html')) throw new Error('В сборке нет index.html');
  if (files.length > MAX_FILES) throw new Error('Слишком много файлов: ' + files.length);
  if (files.reduce((s, f) => s + f.size, 0) > MAX_TOTAL) throw new Error('Сборка больше 40 МБ');
  return files;
}

export function readManifest(dir) {
  try { return JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8')); } catch (e) { return null; }
}

const same = (a, b) => !!a && !!b && a.orientation === b.orientation && a.minApp === b.minApp && !!a.confirm === !!b.confirm &&
  JSON.stringify(a.files) === JSON.stringify(b.files);

/** Пишет version.json в dir. known — уже существующие манифесты (предыдущая сборка, опубликованная версия). */
export function writeManifest(dir, { orientation = 'landscape', minApp = 3, confirm = false, known = [] } = {}) {
  const m = { version: 0, minApp, orientation, confirm: !!confirm, files: describe(dir) };
  const list = known.filter(Boolean);
  const twin = list.find((k) => same(m, k));
  m.version = twin ? twin.version : Math.max(Math.floor(Date.now() / 60000), ...list.map((k) => k.version + 1));
  writeFileSync(join(dir, MANIFEST), JSON.stringify(m, null, 1) + '\n');
  return m;
}

/** Содержимое каталога совпадает с его манифестом? */
export function matches(dir) {
  const m = readManifest(dir);
  return !!m && JSON.stringify(m.files) === JSON.stringify(describe(dir));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), dir = a[0];
  const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  if (!dir || !existsSync(dir)) { console.error('usage: node tools/manifest.mjs <dir> [--orientation …] [--min-app N] [--confirm] [--against <ota-dir>]'); process.exit(1); }
  const against = opt('--against', null);
  const m = writeManifest(dir, { orientation: opt('--orientation', 'landscape'), minApp: Number(opt('--min-app', 3)), confirm: a.includes('--confirm'), known: [readManifest(dir), against ? readManifest(against) : null] });
  console.log(`version ${m.version}, ${m.files.length} files, ${m.orientation}`);
}
