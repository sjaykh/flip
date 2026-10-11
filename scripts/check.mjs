// End-to-end check: completes the full flow on a 375px-wide viewport,
// downloads the .md, and asserts no network requests happen after the
// initial page load. Uses Playwright (local install, or global as fallback).
// Set SHOTS=/some/dir to save screenshots of each step.
import { execSync } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { serve } from './serve.mjs';

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  const globalRoot = execSync('npm root -g').toString().trim();
  return require(join(globalRoot, 'playwright'));
}

const { chromium } = loadPlaywright();
const shots = process.env.SHOTS;
if (shots) await mkdir(shots, { recursive: true });

const server = await serve(0);
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();

let failed = false;
try {
  const context = await browser.newContext({
    viewport: { width: 375, height: 740 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    acceptDownloads: true,
  });
  const page = await context.newPage();

  const requests = [];
  let loaded = false;
  const afterLoad = [];
  page.on('request', (r) => {
    requests.push(r.url());
    if (loaded) afterLoad.push(r.url());
  });
  const consoleProblems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleProblems.push(m.text()); });
  page.on('pageerror', (e) => consoleProblems.push(String(e)));

  await page.goto(origin + '/', { waitUntil: 'networkidle' });
  loaded = true;
  const shot = async (name) => shots && (await page.waitForTimeout(450), page.screenshot({ path: join(shots, `${name}.png`), fullPage: true }));

  // 0 · Landing
  await assert.doesNotReject(page.getByText('Nothing you write here is saved or sent anywhere.').waitFor());
  await page.getByText("If you're in crisis").waitFor();
  await shot('0-landing');
  await page.getByRole('button', { name: 'Start' }).click();

  // 1 · Spiral — gated at 20 chars
  const next1 = page.locator('[data-gate="1"]');
  await page.getByLabel('Your worst-case thought').fill('They will fire me.');
  assert.equal(await next1.getAttribute('aria-disabled'), 'true', 'Next should be gated under 20 chars');
  await next1.click({ force: true });
  assert.equal(await page.locator('.step[data-step="1"]').isVisible(), true, 'gated Next must not advance');
  const spiral = 'My manager went quiet in the meeting, so I am going to get fired, never find another job, and everyone will know I was a fraud.';
  await page.getByLabel('Your worst-case thought').fill(spiral);
  assert.equal(await next1.getAttribute('aria-disabled'), 'false');
  await page.locator('#before').fill('85');
  await shot('1-spiral');
  await next1.click();

  // 2 · Uno reverse — gated at 50% of spiral length
  const next2 = page.locator('[data-gate="2"]');
  await page.getByLabel('The absurdly good version').fill('They promote me on the spot.');
  assert.equal(await next2.getAttribute('aria-disabled'), 'true', 'Next gated below 50% of spiral');
  assert.match(await page.locator('#hint-2').textContent(), /match the energy/);
  await shot('2-uno-gated');
  await page.getByLabel('The absurdly good version').fill('My manager was quiet because she was secretly writing my promotion letter, the CEO calls to say I am a genius, and I get a corner office with a dog.');
  assert.equal(await next2.getAttribute('aria-disabled'), 'false');
  await shot('2-uno');
  await next2.click();

  // 3 · Most likely
  await page.getByLabel('What will probably actually happen').fill('She was tired or thinking about something else. Work continues as normal, and I can ask her on Monday.');
  await shot('3-likely');
  await page.locator('[data-gate="3"]').click();

  // 4 · One move — test Back keeps answers
  await page.getByRole('button', { name: 'Back' }).click();
  assert.match(await page.getByLabel('What will probably actually happen').inputValue(), /tired/);
  await page.locator('[data-gate="3"]').click();
  await page.getByLabel('One thing you can do').fill('Ask for a 10 minute check-in on Monday.');
  await shot('4-move');
  await page.locator('[data-gate="4"]').click();

  // 5 · Re-rate
  await page.locator('#after').fill('30');
  await shot('5-rerate');
  await page.locator('[data-gate="5"]').click();

  // 6 · Summary
  await page.getByText('85 → 30').waitFor();
  await page.waitForTimeout(700);
  await shot('6-summary');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download .md' }).click(),
  ]);
  const md = await readFile(await download.path(), 'utf8');
  assert.match(download.suggestedFilename(), /^flip-\d{4}-\d{2}-\d{2}-\d{4}\.md$/);
  for (const h of ['# Flip — ', '## The spiral', '## The absurdly good version', '## Most likely', '## One move', '## Belief', '85 → 30']) {
    assert.ok(md.includes(h), `markdown missing: ${h}`);
  }
  assert.ok(md.includes(spiral), 'markdown has the spiral text');
  assert.match(md, /\d{4}/, 'markdown includes a date');

  const [txt] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download .txt' }).click(),
  ]);
  assert.match(txt.suggestedFilename(), /\.txt$/);

  // Dark mode + print render
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot('6-summary-dark');
  await page.emulateMedia({ media: 'print' });
  if (shots) await page.pdf?.({ path: join(shots, 'print.pdf') }).catch(() => {});
  await page.emulateMedia({ media: 'screen' });

  // Start over → confirm dialog clears everything
  await page.getByRole('button', { name: 'Start over' }).click();
  await page.getByRole('button', { name: 'Clear and start over' }).click();
  await page.getByRole('button', { name: 'Start' }).waitFor();
  await page.getByRole('button', { name: 'Start' }).click();
  assert.equal(await page.getByLabel('Your worst-case thought').inputValue(), '', 'reset clears text');

  // Network
  const external = requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:'));
  const afterLoadNet = afterLoad.filter((u) => !u.startsWith('data:') && !u.startsWith('blob:'));
  console.log('Requests during whole session:', requests);
  assert.deepEqual(external, [], 'no requests to any other origin');
  assert.deepEqual(afterLoadNet, [], 'no network requests after initial load');
  assert.deepEqual(consoleProblems, [], 'no console errors/CSP violations');

  console.log('✓ Full flow completed at 375px, .md and .txt downloaded');
  console.log(`✓ ${requests.length} request(s) total (the page itself); 0 after initial load`);
} catch (e) {
  failed = true;
  console.error('✗', e.message);
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
