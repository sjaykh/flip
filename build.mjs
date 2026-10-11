// Zero-dependency build: inlines CSS + JS into a single dist/index.html and
// pins them with a hash-based Content-Security-Policy that forbids every
// network fetch (connect-src 'none', no external scripts/styles/fonts/images).
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'src');
const dist = join(here, 'dist');

const [html, css, js] = await Promise.all([
  readFile(join(src, 'index.html'), 'utf8'),
  readFile(join(src, 'styles.css'), 'utf8'),
  readFile(join(src, 'app.js'), 'utf8'),
]);

const sha = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

const csp = [
  "default-src 'none'",
  `script-src ${sha(js)}`,
  `style-src ${sha(css)}`,
  'img-src data:',
  "connect-src 'none'",
  "font-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

// Use function replacers so `$` sequences in the sources are left alone.
const out = html
  .replace('__CSP__', () => csp)
  .replace('__STYLE__', () => css)
  .replace('__SCRIPT__', () => js);

for (const token of ['__CSP__', '__STYLE__', '__SCRIPT__']) {
  if (out.includes(token)) throw new Error(`Build left ${token} in output`);
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await writeFile(join(dist, 'index.html'), out);

console.log(`Built dist/index.html (${(Buffer.byteLength(out) / 1024).toFixed(1)} KB, single file, no external requests)`);
