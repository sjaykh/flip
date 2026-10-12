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

// Script files in dependency order. The fight modules are real ES modules (so
// node:test can import them); here we strip their import/export lines and
// concatenate everything into one closure, which keeps them off `window`.
const SCRIPTS = ['fight/constants.js', 'fight/logic.js', 'fight/render.js', 'fight/ui.js', 'app.js'];

function stripModuleSyntax(code, file) {
  const out = code
    .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+(?=(const|let|function|class)\b)/gm, '');
  if (/^\s*(import|export)\b/m.test(out)) throw new Error(`Unsupported module syntax left in ${file}`);
  return `// ---- ${file} ----\n${out.trim()}\n`;
}

const [html, css, ...scripts] = await Promise.all([
  readFile(join(src, 'index.html'), 'utf8'),
  readFile(join(src, 'styles.css'), 'utf8'),
  ...SCRIPTS.map((f) => readFile(join(src, f), 'utf8')),
]);

const js = `(() => {\n'use strict';\n${scripts.map((code, i) => stripModuleSyntax(code, SCRIPTS[i])).join('\n')}})();\n`;

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
