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
  // Test-only hooks: a fixed RNG seed and a sim-clock multiplier the script can change.
  await context.addInitScript(() => { window.__flipTest = { timeScale: 3, seed: 7 }; });
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
  const speed = (x) => page.evaluate((v) => { window.__flipTest.timeScale = v; }, x);
  // The HUD mirror updates on the next animation frame.
  const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const playerHp = async () => { await settle(); return Number(await page.locator('#f-status').getAttribute('data-player')); };
  const anxietyHp = async () => { await settle(); return Number(await page.locator('#f-status').getAttribute('data-anxiety')); };

  await page.getByRole('button', { name: /Fight it/ }).click();
  const thought = "I'll mess up the review and everyone will see I'm not good enough";
  const nextF1 = page.locator('[data-fgate="f1"]');
  await page.getByLabel('The anxious thought').fill('I will fail');
  assert.equal(await nextF1.getAttribute('aria-disabled'), 'true', 'fight thought gated under 20 chars');
  await page.getByLabel('The anxious thought').fill(thought);
  await nextF1.click();

  // Context
  await page.getByLabel("What's the situation?").fill('the product review on Friday');
  await page.getByLabel("Who's involved?").fill('my manager');
  await page.getByLabel('What are you afraid it says about you?').fill("I'm not good enough");
  await shot('f2-context');
  await page.locator('[data-action="f-next2"]').click();

  // Strength → settings
  await page.locator('#f-strength').fill('70');
  assert.equal(await page.locator('#f-preview-hp').textContent(), String(Math.round(60 + 90 * 0.7)), 'strength scales HP into 60–150');
  await shot('f3-strength');
  await page.locator('[data-action="f-next3"]').click();
  const breathingSwitch = page.locator('[data-switches] .switch[data-setting="breathing"]').first();
  assert.equal(await breathingSwitch.getAttribute('aria-checked'), 'true', 'breathing breaks default on');
  assert.equal(await page.locator('.switch[data-setting="sound"]').first().getAttribute('aria-checked'), 'false', 'sound default off');
  await shot('f4-settings');
  await page.getByRole('button', { name: 'Enter the ring' }).click();

  assert.ok(await page.locator('.safety').isVisible(), 'safety footer visible during the fight');
  const footerBox = await page.locator('.safety').boundingBox();
  assert.ok(footerBox.y + footerBox.height <= 740 + 1, 'safety footer inside the viewport during the fight');
  const arenaBox = await page.locator('#f-screen').boundingBox();
  assert.ok(arenaBox.y < 60 && Math.abs(arenaBox.width / arenaBox.height - 16 / 9) < 0.05, 'arena is a 16:9 block at the top');

  // 1) Block one comment with a strong, specific counter → PARRY.
  await page.locator('#f-projectile:not([hidden])').waitFor({ timeout: 15000 });
  assert.match(await page.locator('#f-line-label').textContent(), /^Answer it! It's /);
  assert.ok((await page.locator('#f-proj-trap').textContent()).length > 0, 'comment shows its trap label');
  assert.match(await page.locator('#f-announce').textContent(), /^Incoming, /);
  await shot('f5-incoming');
  const before = await anxietyHp();
  await page.locator('#f-line').fill('Last time I presented on 12 March, Priya said my slides were the clearest, because I prepared.');
  await page.locator('#f-line').press('Enter');
  assert.match(await page.locator('#f-feedback').textContent(), /PARRY!/);
  assert.ok((await anxietyHp()) <= before - 30 + 1, 'parry damages anxiety');
  await shot('f5-parry');

  // 2) Take one hit: let the next comment land.
  await page.locator('#f-projectile:not([hidden])').waitFor({ timeout: 15000 });
  await page.waitForFunction(() => /That one landed/.test(document.querySelector('#f-feedback').textContent), null, { timeout: 15000 });
  assert.ok((await playerHp()) <= 90 && (await playerHp()) >= 86, 'comment hit for 10–14');
  await shot('f5-hit');

  // 3) Get knocked down once (fast-forward), then skip the breathing break.
  await speed(30);
  await page.waitForFunction(() => Number(document.querySelector('#f-status').dataset.player) <= 14, null, { timeout: 60000, polling: 50 });
  await speed(1);
  await page.locator('#f-breathe').waitFor({ state: 'visible', timeout: 60000 });
  assert.equal(await playerHp(), 0);
  assert.match(await page.locator('#f-breathe-msg').textContent(), /Anxiety got loud\. That happens\. Breathe with the box\./);
  assert.ok(await page.getByRole('button', { name: 'Skip' }).isVisible(), 'Skip visible from the first second');
  await shot('f5-breathe');
  const anxDown = await anxietyHp();
  await page.getByRole('button', { name: 'Skip' }).click();
  await speed(3);
  assert.equal(await playerHp(), 50, 'recover at 50 HP');
  assert.equal(await anxietyHp(), Math.max(1, anxDown - 10), 'anxiety -10 on recovery');
  assert.ok(!(await page.locator('body').innerText()).match(/GAME OVER|YOU LOSE/i), 'never shows game over');

  // 4) Pause freezes everything (Esc).
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await page.locator('#f-pause').waitFor({ state: 'visible' });
  const frozen = await page.locator('#f-status').textContent();
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('#f-status').textContent(), frozen, 'paused: timers frozen');
  await shot('f5-pause');
  await page.getByRole('button', { name: 'Resume' }).click();

  // 5) K.O. anxiety: keep landing fresh, specific lines (attacks or blocks).
  const ko = page.locator('#f-end');
  const moves = ['Evidence Jab', 'Flip Kick', 'Reality Check', 'Action Uppercut'];
  // Distinct, specific lines (near-duplicates would score 0 as repeats).
  const koLines = [
    'In June, Meera told the whole team my roadmap doc was the clearest she had read, because it was.',
    'The review goes so well that Sam asks me to run the next 3 planning sessions for the group.',
    'Most likely a couple of small edits on Friday, then everyone moves on to lunch at 1pm.',
    'I will book 30 minutes with Arun on Thursday to rehearse, because practice actually helps me.',
    'Evidence: I have shipped 4 releases this year and Dev praised the last one in standup.',
    'Even if one slide breaks, Priya has covered for me before and the meeting still ended well.',
    'Last quarter my numbers beat the target by 12 percent, which Kavya mentioned in the all-hands.',
    'Tonight I will write down 5 likely questions and draft answers, then sleep by 11.',
  ];
  for (let i = 0; i < 40 && !(await ko.isVisible()); i++) {
    if (await page.locator('#f-breathe').isVisible()) { await page.getByRole('button', { name: 'Skip' }).click(); continue; }
    if (await page.locator('#f-finisher').isVisible() && await page.locator('#f-finisher').isEnabled()) {
      await page.locator('#f-finisher').click();
      continue;
    }
    if (!(await page.locator('#f-line').isEnabled())) { await page.waitForTimeout(150); continue; }
    await page.locator('.move', { hasText: moves[i % 4] }).click();
    await page.locator('#f-line').fill(koLines[i % koLines.length]);
    await page.locator('#f-line').press('Enter');
    await page.waitForTimeout(120);
  }
  await ko.waitFor({ state: 'visible' });
  assert.match(await page.locator('#f-end-msg').textContent(), /Anxiety's small now\. It may come back\. You know the moves\./);
  await page.waitForTimeout(600);
  await shot('f5-ko');
  await ko.getByRole('button', { name: 'Continue' }).click();

  // Debrief
  await page.locator('#f-after').fill('30');
  await page.locator('[data-action="f-to-feel"]').click();
  const seeResult = page.locator('[data-fgate="f7"]');
  assert.equal(await seeResult.getAttribute('aria-disabled'), 'true', 'feeling required');
  await page.locator('.feeling', { hasText: 'Better' }).click();
  await seeResult.click();
  await page.getByText('70 → 30').waitFor();
  const card = await page.locator('#f-card').textContent();
  for (const want of ['the product review on Friday', 'my manager', "I'm not good enough", 'Better (4/5)', 'Parries', 'Knockdowns', 'Traps blocked most', 'blocked ', 'parried']) {
    assert.ok(card.includes(want), `result card missing: ${want}`);
  }
  assert.ok(!card.includes('Breaths taken'), 'no breaths line when breathing was skipped');
  await shot('f8-result');

  const [fmd] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download .md' }).click(),
  ]);
  const fightMd = await readFile(await fmd.path(), 'utf8');
  assert.match(fmd.suggestedFilename(), /^flip-fight-\d{4}-\d{2}-\d{2}-\d{4}\.md$/);
  for (const h of ['# Flip · Fight — ', '## The thought', thought, '- **Situation:** the product review on Friday',
    '- **Who:** my manager', '## Strength', '70 → 30', '## The fight', '- Feeling: Better (4/5)', '- Parries: ',
    '- Knockdowns: ', '## Your counter-arguments', '### Evidence Jab', 'blocked ', '_(']) {
    assert.ok(fightMd.includes(h), `fight markdown missing: ${h}`);
  }
  const [ftxt] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download .txt' }).click(),
  ]);
  assert.match(ftxt.suggestedFilename(), /^flip-fight-.*\.txt$/);

  await page.getByRole('button', { name: 'Fight again' }).click();
  await page.locator('#h-f3').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#f-strength').inputValue(), '30', 'fight again starts from the new strength');

  // Safe mode: self-harm language → generic-only comments + visible crisis banner.
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByLabel('The anxious thought').fill("If the review goes badly I want to die, everyone will know I'm a fraud");
  await page.locator('[data-fgate="f1"]').click();
  assert.match(await page.locator('#hint-f2').textContent(), /14416/);
  await page.locator('[data-action="f-skip-ctx"]').click();
  assert.equal(await page.locator('#f-preview-quote').textContent(), '', 'safe mode: thought not echoed');
  await page.locator('[data-action="f-next3"]').click();
  await page.getByRole('button', { name: 'Enter the ring' }).click();
  assert.ok(await page.locator('#f-safety-banner').isVisible(), 'crisis banner above the arena');
  assert.match(await page.locator('#f-safety-banner').textContent(), /Tele-MANAS 14416/);
  assert.equal(await page.locator('#f-quote').textContent(), '');
  await speed(10);
  await page.locator('#f-projectile:not([hidden])').waitFor({ timeout: 15000 });
  const safeText = await page.locator('#f-proj-text').textContent();
  assert.ok(!/die|fraud|review/i.test(safeText), `safe mode comment is generic: ${safeText}`);
  await shot('f5-safe');
  await page.getByRole('button', { name: 'Pause (Esc)' }).click();
  await page.getByRole('button', { name: 'Leave fight' }).click();
  await page.getByRole('button', { name: 'Clear and start over' }).click();
  await page.getByRole('button', { name: /Fight it/ }).waitFor();

  // Network
  const external = requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:'));
  const afterLoadNet = afterLoad.filter((u) => !u.startsWith('data:') && !u.startsWith('blob:'));
  console.log('Requests during whole session:', requests);
  assert.deepEqual(external, [], 'no requests to any other origin');
  assert.deepEqual(afterLoadNet, [], 'no network requests after initial load');
  assert.deepEqual(consoleProblems, [], 'no console errors/CSP violations');

  console.log('✓ Write-it-out flow completed at 375px, .md and .txt downloaded');
  console.log('✓ Fight flow: context, parry, hit, knockdown + skip breathing, pause, K.O., debrief, .md/.txt, safe mode');
  console.log(`✓ ${requests.length} request(s) total (the page itself); 0 after initial load`);
} catch (e) {
  failed = true;
  console.error('✗', e.message);
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
