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
    reducedMotion: process.env.REDUCED_MOTION ? 'reduce' : 'no-preference',
    viewport: { width: 375, height: 740 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    acceptDownloads: true,
  });
  // Run fight timers 10× faster (idle growth, banners, the 32s breathing break).
  await context.addInitScript(() => { window.__flipTimeScale = 10; });
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
  await page.getByRole('button', { name: /Write it out/ }).click();

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
  await page.emulateMedia({ media: 'screen', colorScheme: 'light' });

  // Start over → confirm dialog clears everything
  await page.getByRole('button', { name: 'Start over' }).click();
  await page.getByRole('button', { name: 'Clear and start over' }).click();
  await page.getByRole('button', { name: /Write it out/ }).click();
  assert.equal(await page.getByLabel('Your worst-case thought').inputValue(), '', 'reset clears text');
  await page.getByRole('button', { name: 'Back' }).click();

  // ================= Fight mode =================
  await page.getByRole('button', { name: /Fight it/ }).click();
  const thought = "I'll mess up the review and everyone will see I'm not good enough";
  const nextF1 = page.locator('[data-fgate="f1"]');
  await page.getByLabel('The anxious thought').fill('I will fail');
  assert.equal(await nextF1.getAttribute('aria-disabled'), 'true', 'fight thought gated under 20 chars');
  await page.getByLabel('The anxious thought').fill(thought);
  await shot('f1-thought');
  await nextF1.click();

  // Max strength so the idle growth immediately triggers the breathing break.
  await page.locator('#f-strength').fill('100');
  await shot('f2-strength');
  await page.getByRole('button', { name: 'Enter the ring' }).click();
  await page.locator('#f-banner.go').waitFor({ state: 'attached' });
  assert.ok(await page.locator('.safety').isVisible(), 'safety footer visible during the fight');
  const footerBox = await page.locator('.safety').boundingBox();
  assert.ok(footerBox.y + footerBox.height <= 740 + 1, 'safety footer inside the viewport during the fight');

  // Breathing interlude (no game over): appears at max HP, then anxiety loses 15.
  await page.locator('#f-breathe').waitFor({ state: 'visible', timeout: 5000 });
  assert.match(await page.locator('#f-breathe-msg').textContent(), /Anxiety got loud\. That happens\. Breathe with the box\./);
  await shot('f3-breathe');
  await page.locator('#f-breathe').waitFor({ state: 'hidden', timeout: 10000 });
  const hpAfterBreath = Number(await page.locator('#f-hp-num').textContent());
  assert.ok(hpAfterBreath >= 85 && hpAfterBreath <= 87, `anxiety lost 15 after breathing (hp ${hpAfterBreath})`);

  const hit = async (moveName, line) => {
    await page.locator('.move', { hasText: moveName }).click();
    await page.locator('#f-line').fill(line);
    await page.locator('#f-line').press('Enter');
  };
  const feedback = () => page.locator('#f-feedback').textContent();
  const fightLines = {
    vague: "It'll be ok",
    jab: 'Last time I presented on 12 March, Priya said my slides were the clearest, because I prepared.',
    kick: 'the review goes so well they ask me to teach the team',
    check: 'a few small notes to fix and then we all move on',
    uppercut: 'block an hour tomorrow morning to rehearse it twice',
  };

  await hit('Evidence Jab', fightLines.vague);
  assert.match(await feedback(), /Too vague\. Get specific\./);
  await hit('Evidence Jab', fightLines.jab);
  assert.match(await feedback(), /Evidence Jab! 30 damage/);
  await shot('f3-hit');
  await hit('Evidence Jab', fightLines.jab.toLowerCase());
  assert.match(await feedback(), /Already used that one\./);
  await hit('Flip Kick', fightLines.kick);
  await hit('Reality Check', fightLines.check);
  await hit('Action Uppercut', fightLines.uppercut);

  const ko = page.locator('#f-ko');
  if (!(await ko.isVisible())) {
    await page.locator('#f-finisher').waitFor({ state: 'visible' });
    await shot('f3-finisher');
    await page.locator('#f-finisher').click();
  }
  // Keep landing fresh, specific lines until the K.O.
  for (let i = 0; i < 10 && !(await ko.isVisible()); i++) {
    await hit('Evidence Jab', `On day ${i + 2} of the project, Arun said my draft number ${i + 7} was solid, because it was.`);
  }
  await ko.waitFor({ state: 'visible' });
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#f-banner').textContent(), 'K.O.');
  assert.ok(await page.locator('#f-banner').isVisible(), 'K.O. banner stays up');
  assert.match(await page.locator('#f-ko-msg').textContent(), /Anxiety's small now\. It may come back\. You know the moves\./);
  await shot('f3-ko');
  await ko.getByRole('button', { name: 'Continue' }).click();

  // Debrief
  await page.locator('#f-after').fill('25');
  await shot('f4-rerate');
  await page.locator('[data-action="f-to-feel"]').click();
  const seeResult = page.locator('[data-fgate="f5"]');
  assert.equal(await seeResult.getAttribute('aria-disabled'), 'true', 'feeling required');
  await page.locator('.feeling', { hasText: 'Better' }).click();
  await shot('f5-feel');
  await seeResult.click();
  await page.getByText('100 → 25').waitFor();
  assert.match(await page.locator('#f-card').textContent(), /Better \(4\/5\)/);
  await shot('f6-result');

  const [fmd] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download .md' }).click(),
  ]);
  const fightMd = await readFile(await fmd.path(), 'utf8');
  assert.match(fmd.suggestedFilename(), /^flip-fight-\d{4}-\d{2}-\d{2}-\d{4}\.md$/);
  for (const h of ['# Flip · Fight — ', '## The thought', thought, '## Strength', '100 → 25', '## How I feel', 'Better',
    '## The fight', 'Fight time:', 'Breathing breaks: 1', '## Your counter-arguments', '### Evidence Jab', fightLines.jab,
    '### Flip Kick', '### Reality Check', '### Action Uppercut']) {
    assert.ok(fightMd.includes(h), `fight markdown missing: ${h}`);
  }
  const [ftxt] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download .txt' }).click(),
  ]);
  assert.match(ftxt.suggestedFilename(), /^flip-fight-.*\.txt$/);

  await page.emulateMedia({ colorScheme: 'dark' });
  await shot('f6-result-dark');
  await page.emulateMedia({ colorScheme: 'light' });

  await page.getByRole('button', { name: 'Fight again' }).click();
  await page.locator('#h-f2').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#f-strength').inputValue(), '25', 'fight again starts from the new strength');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: /Fight it/ }).waitFor();
  await page.getByRole('button', { name: /Fight it/ }).click();
  assert.equal(await page.getByLabel('The anxious thought').inputValue(), thought, 'thought kept until start over');
  await page.getByRole('button', { name: 'Back' }).click();

  // Network
  const external = requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:'));
  const afterLoadNet = afterLoad.filter((u) => !u.startsWith('data:') && !u.startsWith('blob:'));
  console.log('Requests during whole session:', requests);
  assert.deepEqual(external, [], 'no requests to any other origin');
  assert.deepEqual(afterLoadNet, [], 'no network requests after initial load');
  assert.deepEqual(consoleProblems, [], 'no console errors/CSP violations');

  console.log('✓ Write-it-out flow completed at 375px, .md and .txt downloaded');
  console.log('✓ Fight flow: breathing break, vague/repeat/combo, K.O., debrief, .md and .txt downloaded');
  console.log(`✓ ${requests.length} request(s) total (the page itself); 0 after initial load`);
} catch (e) {
  failed = true;
  console.error('✗', e.message);
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
