import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

// GitHub Pages serves project sites under /web-office/, rather than at /.
// Vite rebases its imported assets; this additionally rebases URLs embedded in
// the vendored rhwp Studio and static CSS/HTML.
const directory = 'dist';
const project = '/web-office';
const types = new Set(['.html', '.css', '.js', '.json', '.svg', '.webmanifest']);
let changes = 0;

async function walk(folder) {
  for (const item of await readdir(folder, { withFileTypes: true })) {
    const filename = join(folder, item.name);
    if (item.isDirectory()) {
      await walk(filename);
      continue;
    }
    if (!item.isFile() || !types.has(extname(filename))) continue;
    const before = await readFile(filename, 'utf8');
    const after = before.replaceAll('/rhwp/', project + '/rhwp/');
    if (after !== before) {
      await writeFile(filename, after, 'utf8');
      changes += 1;
    }
  }
}
await walk(directory);
console.log('GitHub Pages path prefix applied to ' + changes + ' asset(s).');
