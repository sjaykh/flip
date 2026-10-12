import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBannedWords } from '../src/fight/logic.js';
import { TRAPS, COMEBACK, BANNED_WORDS, COPY } from '../src/fight/constants.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('safety scan: no generic line, template or comeback contains a banned word', () => {
  const lines = [
    ...TRAPS.flatMap((t) => [...t.generic, ...t.templates]),
    ...COMEBACK.lines,
  ];
  assert.ok(lines.length > 80, 'scanned the full lists');
  const hits = lines.map((l) => ({ l, words: findBannedWords(l, BANNED_WORDS) })).filter((x) => x.words.length);
  assert.deepEqual(hits, []);
});

test('safety scan catches what it should (sanity check of the scanner)', () => {
  assert.deepEqual(findBannedWords("You're so stupid", BANNED_WORDS), ['stupid']);
  assert.deepEqual(findBannedWords('The deadline is close', BANNED_WORDS), []);
  assert.deepEqual(findBannedWords("Nobody's saying it", BANNED_WORDS), []);
});

test('each trap has ~8 generic lines and ~8 templates (Fear Echo: templates only)', () => {
  TRAPS.forEach((t) => {
    if (t.id !== 'fear-echo') assert.ok(t.generic.length >= 8, t.id);
    assert.ok(t.templates.length >= 8, t.id);
  });
  assert.ok(COPY.rules.length > 0);
});

test('no innerHTML / insertAdjacentHTML / document.write anywhere in src', async () => {
  const files = [];
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(js|html)$/.test(e.name)) files.push(p);
    }
  };
  await walk(join(root, 'src'));
  for (const f of files) {
    const src = await readFile(f, 'utf8');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src), f);
  }
});

test('no browser storage APIs anywhere in src', async () => {
  const files = ['app.js', 'fight/ui.js', 'fight/render.js', 'fight/logic.js'];
  for (const f of files) {
    const src = await readFile(join(root, 'src', f), 'utf8').catch(() => '');
    assert.ok(!/localStorage|sessionStorage|indexedDB/.test(src), f);
  }
});
