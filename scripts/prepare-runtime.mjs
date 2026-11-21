import { cp, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { unzipSync } from 'fflate';

const root = fileURLToPath(new URL('..', import.meta.url));
const python = resolve(root, 'public/python-runtime');
const studio = resolve(root, 'public/rhwp');
await mkdir(python, { recursive: true });
for (const file of ['pyodide.js', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) {
  await cp(resolve(root, 'node_modules/pyodide', file), resolve(python, file));
}
for (const folder of ['cmaps', 'standard_fonts']) {
  await cp(resolve(root, 'node_modules/pdfjs-dist', folder), resolve(root, 'public/pdf-runtime', folder), { recursive: true });
}

const marker = resolve(studio, '.prepared-v0.9.0');
const studioWasm = 'assets/rhwp_bg-CjDYAjgF.wasm';
const patchVersion = 'rhwp v0.9.0 / 3\n';
const prepared = await readFile(marker, 'utf8').catch(() => '');
if (prepared === patchVersion) process.exit(0);
const studioBundles = ['index-DJJqHHQc.js', 'import-worker-ENBcDEGf.js'];

if (prepared === 'rhwp v0.9.0 / 2\n') {
  for (const file of ['core.wasm', studioWasm]) await rename(resolve(studio, file + '.gz'), resolve(studio, file + '.pack'));
  for (const bundle of studioBundles) {
    const path = resolve(studio, 'assets', bundle);
    const original = await readFile(path, 'utf8');
    await writeFile(path, original.replace("normalized.pathname += '.gz'", "normalized.pathname += '.pack'"));
  }
  await writeFile(marker, patchVersion);
  process.exit(0);
}

const wasmShim = `;(() => {
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (resource, options) => {
    const address = typeof resource === 'string' ? resource : resource.url || resource.href;
    const normalized = new URL(address, location.href);
    if (normalized.origin !== location.origin || !normalized.pathname.endsWith('/${studioWasm}')) return original(resource, options);
    normalized.pathname += '.pack';
    return original(normalized, options).then(response => {
      if (!response.ok || !response.body) throw new Error('rhwp WASM: ' + response.status);
      return new Response(response.body.pipeThrough(new DecompressionStream('gzip')), { headers: { 'Content-Type': 'application/wasm' } });
    });
  };
})();\n`;

async function prepareWasm() {
  const core = await readFile(resolve(root, 'node_modules/@rhwp/core/rhwp_bg.wasm'));
  await writeFile(resolve(studio, 'core.wasm.pack'), gzipSync(core));
  const file = resolve(studio, studioWasm);
  const webCore = await readFile(file);
  await writeFile(file + '.pack', gzipSync(webCore));
  for (const bundle of studioBundles) {
    const path = resolve(studio, 'assets', bundle);
    const original = await readFile(path, 'utf8');
    await writeFile(path, wasmShim + original);
  }
  await unlink(file);
  await writeFile(marker, patchVersion);
}

if (prepared === 'rhwp v0.9.0\n') {
  await prepareWasm();
  process.exit(0);
}

const source = 'https://edwardkim.github.io/rhwp/';
const extensionSource = 'https://github.com/edwardkim/rhwp/releases/download/v0.9.0/rhwp-chrome-0.9.0.zip';
const { createHash } = await import('node:crypto');
const archivePath = resolve(root, 'node_modules/.rhwp-studio.zip');
async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.url}`);
  return new Uint8Array(await response.arrayBuffer());
}
let archive;
try {
  archive = await readFile(archivePath);
} catch {
  archive = await fetchBytes(extensionSource);
}
const sha = createHash('sha256').update(archive).digest('hex');
if (sha !== 'db24306cc91e7fdf876f393ca3f2235f97546fc6413f6074223362b69d96820f') {
  throw new Error('rhwp v0.9.0 배포 파일의 SHA-256이 일치하지 않습니다.');
}

const files = unzipSync(archive, { filter: ({ name }) => /^(?:fonts\/|images\/|THIRD_PARTY_LICENSES\.md$)/.test(name) });
const decoder = new TextDecoder();
let html = decoder.decode(await fetchBytes(source));
if (!html.includes('/rhwp/assets/index-DJJqHHQc.js') || !html.includes('/rhwp/assets/index-D8P2zhVp.css')) {
  throw new Error('rhwp 웹 배포의 버전이 달라졌습니다. 승인한 Studio 번들을 갱신해 주세요.');
}
const policy = "default-src 'self' blob: data:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' blob: data:; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'";
html = html.replace(/<link[^>]+rel="manifest"[^>]*>/gi, '').replace(/<script[^>]+id="vite-plugin-pwa:register-sw"[^>]*><\/script>/gi, '')
  .replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`);

const pending = ['index.html'];
const seen = new Set(pending);
files['index.html'] = new TextEncoder().encode(html);
function addDependencies(name, content) {
  const paths = content.matchAll(/(?:\/rhwp\/|\.\/|["'`/])((?:assets\/)?[\w.-]+\.(?:js|css|wasm|ico|woff2|webp|svg))(?=["'`),?])/g);
  for (const match of paths) {
    let path = match[1];
    if (!path.startsWith('assets/') && /\.(?:woff2|svg|webp)$/.test(path)) continue;
    if (!path.includes('/') && name.startsWith('assets/') && /-[\w-]{8}\./.test(path)) path = `assets/${path}`;
    if (seen.has(path) || files[path] || !/^(?:assets\/|theme-init\.js$|locale-init\.js$|favicon\.ico$)/.test(path)) continue;
    seen.add(path);
    pending.push(path);
  }
}

while (pending.length > 0) {
  const batch = pending.splice(0, 12);
  await Promise.all(batch.map(async name => {
    files[name] ??= await fetchBytes(new URL(name, source));
    if (/\.(html|js|css)$/.test(name)) addDependencies(name, decoder.decode(files[name]));
  }));
}
for (const [name, bytes] of Object.entries(files)) {
  if (!bytes.length || name.endsWith('/')) continue;
  const path = resolve(studio, dirname(name), basename(name));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}
await prepareWasm();
console.log('rhwp Studio와 Python 런타임을 준비했습니다.');
