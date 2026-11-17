// Манифест версии игры (version.json) для обновления «по воздуху».
//   node tools/manifest.mjs <dir> [--orientation landscape|portrait] [--min-app 2] [--against <dir>]
// Номер версии = номер из каталога --against (обычно ../ota), если содержимое совпадает, иначе на единицу больше.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST = 'version.json';

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
  return listFiles(dir).map((path) => {
    const buf = readFileSync(join(dir, path));
    return { path, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
  });
}

export function readManifest(dir) {
  try { return JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8')); } catch (e) { return null; }
}

const same = (a, b) => !!a && !!b && a.orientation === b.orientation && a.minApp === b.minApp && JSON.stringify(a.files) === JSON.stringify(b.files);

/** Пишет version.json в dir. published — манифест опубликованной версии (или null). */
export function writeManifest(dir, { orientation = 'landscape', minApp = 2, published = null } = {}) {
  const m = { version: 0, minApp, orientation, files: describe(dir) };
  m.version = same(m, published) ? published.version : (published ? published.version : 0) + 1;
  writeFileSync(join(dir, MANIFEST), JSON.stringify(m, null, 1) + '\n');
  return m;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), dir = a[0];
  const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  if (!dir || !existsSync(dir)) { console.error('usage: node tools/manifest.mjs <dir> [--orientation …] [--min-app N] [--against <dir>]'); process.exit(1); }
  const against = opt('--against', null);
  const m = writeManifest(dir, { orientation: opt('--orientation', 'landscape'), minApp: Number(opt('--min-app', 2)), published: against ? readManifest(against) : null });
  console.log(`version ${m.version}, ${m.files.length} files, ${m.orientation}`);
}
