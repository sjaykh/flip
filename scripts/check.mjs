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
  const stat = async (k) => { await settle(); return page.locator('#f-status').getAttribute(`data-${k}`); };
  const playerHp = async () => Number(await stat('player'));
  const grip = async () => Number(await stat('grip'));
  const go = (to) => page.locator(`[data-action="f-go"][data-to="${to}"]`).click();

  await page.getByRole('button', { name: /Fight it/ }).click();
  // 1 Situation → 2 Feelings → 3 Thought → 4 Hot thought → 5 Who → 6 Belief → 7 Settings
  await page.getByLabel('The situation', { exact: true }).fill('the product review on Friday');
  await go('f2');
  assert.equal(await page.locator('[data-fgate="feelings"]').getAttribute('aria-disabled'), 'true', 'pick at least one feeling');
  await page.locator('.chip', { hasText: 'anxious' }).click();
  await page.locator('.chip', { hasText: 'ashamed' }).click();
  await page.locator('#f-intensity').fill('80');
  await shot('f2-feelings');
  await go('f3');
  const thought = "I'll mess up the review and everyone will see I'm not good enough";
  await page.getByLabel('The thought', { exact: true }).fill('I will fail');
  assert.equal(await page.locator('[data-fgate="thought"]').getAttribute('aria-disabled'), 'true', 'thought gated under 20 chars');
  await page.getByLabel('The thought', { exact: true }).fill(thought);
  await go('f4');
  await page.getByLabel('The part that bothers you most', { exact: true }).fill("that I'm not good enough");
  await go('f5');
  await page.getByLabel("Who's involved", { exact: true }).fill('my manager');
  await go('f6');
  await page.locator('#f-belief').fill('70');
  assert.equal(await page.locator('#f-preview-hp').textContent(), String(Math.round(60 + 90 * 0.7)), 'belief scales GRIP into 60–150');
  await shot('f6-belief');
  await go('f7');
  assert.equal(await page.locator('.switch[data-setting="breathing"]').first().getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('.switch[data-setting="sound"]').first().getAttribute('aria-checked'), 'false');
  await page.getByRole('button', { name: 'Enter the ring' }).click();

  assert.ok(await page.locator('.safety').isVisible(), 'safety footer visible during the fight');
  const footerBox = await page.locator('.safety').boundingBox();
  assert.ok(footerBox.y + footerBox.height <= 740 + 1, 'safety footer inside the viewport');
  const arenaBox = await page.locator('#f-screen').boundingBox();
  assert.ok(arenaBox.y < 60 && Math.abs(arenaBox.width / arenaBox.height - 16 / 9) < 0.05, 'arena is a 16:9 block at the top');

  // Round 0: the thought makes its case. Required.
  assert.ok(await page.locator('#f-round0').isVisible());
  assert.equal(await page.locator('[data-fgate="evidence"]').getAttribute('aria-disabled'), 'true', 'Round 0 evidence is required');
  await page.locator('[data-fgate="evidence"]').click({ force: true });
  assert.ok(await page.locator('#f-round0').isVisible(), 'cannot skip Round 0');
  await shot('f8-round0');
  const evidence = 'My last review had two big corrections from my manager.';
  await page.locator('#f-evidence').fill(evidence);
  await page.locator('#f-evidence').press('Enter');
  assert.equal(await page.locator('#f-proj-text').textContent(), evidence, 'the evidence is its opening hit');
  await page.locator('#f-input-area').waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(await playerHp(), 95, 'opening hit: fixed 5');

  // Block one comment while typing slowly: focus mode holds it back.
  await page.locator('#f-projectile:not([hidden])').waitFor({ timeout: 30000 });
  assert.match(await page.locator('#f-line-label').textContent(), /^Answer it! It's /);
  await page.waitForFunction(() => /^Incoming, /.test(document.querySelector('#f-announce').textContent), null, { timeout: 5000 });
  await page.locator('#f-line').click();
  const counter = 'Last time I presented on 12 March, Priya said my slides were the clearest, because I prepared.';
  const timeBefore = Number(await stat('time'));
  await page.keyboard.type(counter.slice(0, 60), { delay: 140 }); // ~8 s real × 3 = 25 s of fight time
  assert.equal(await stat('focus'), 'true', 'typing enters focus mode');
  assert.equal(Number(await stat('time')), timeBefore, 'focus mode pauses the round clock');
  assert.equal(await playerHp(), 95, 'the comment did not hit while typing');
  assert.ok(await page.locator('#f-projectile').isVisible(), 'still in the air');
  await shot('f8-focus');
  await page.keyboard.type(counter.slice(60), { delay: 10 });
  await page.keyboard.press('Enter');
  assert.match(await page.locator('#f-feedback').textContent(), /PARRY!/);
  assert.equal(await stat('focus'), 'false', 'submitting ends focus mode');

  // Take one hit: let the next comment land.
  await page.locator('#f-projectile:not([hidden])').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => /That one landed/.test(document.querySelector('#f-feedback').textContent), null, { timeout: 40000 });
  const afterHit = await playerHp();
  assert.ok(afterHit <= 85 && afterHit >= 81, `comment hit for 10–14 (hp ${afterHit})`);

  // Knocked down once (fast-forward), then skip breathing.
  await speed(30);
  await page.waitForFunction(() => Number(document.querySelector('#f-status').dataset.player) <= 14, null, { timeout: 90000, polling: 50 });
  await speed(3); // one or two more hits; slow enough that the breathing break is still on screen
  await page.locator('#f-breathe').waitFor({ state: 'visible', timeout: 90000 });
  await speed(1);
  assert.match(await page.locator('#f-breathe-msg').textContent(), /It got loud\. That happens\. Breathe with the box\./);
  assert.ok(await page.getByRole('button', { name: 'Skip' }).isVisible(), 'Skip visible from the first second');
  await shot('f8-breathe');
  const gripDown = await grip();
  await page.getByRole('button', { name: 'Skip' }).click();
  await speed(3);
  assert.equal(await playerHp(), 50, 'recover at 50 HP');
  assert.equal(await grip(), Math.max(1, gripDown - 10), 'GRIP −10 on recovery');
  assert.ok(!(await page.locator('body').innerText()).match(/GAME OVER|YOU LOSE/i), 'never shows game over');

  // Pause freezes everything (Esc).
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.locator('#f-pause').waitFor({ state: 'visible' });
  const frozen = await page.locator('#f-status').textContent();
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('#f-status').textContent(), frozen, 'paused: timers frozen');
  await page.getByRole('button', { name: 'Resume' }).click();

  // Wear its grip down with distinct, specific answers until the BALANCED THOUGHT unlocks.
  const koLines = [
    'In June, Meera told the whole team my roadmap doc was the clearest she had read, because it was.',
    'I would tell a friend that one review is 1 data point, and Sam says everyone gets corrections.',
    'Most likely a couple of small edits on Friday, then everyone moves on to lunch at 1pm.',
    "If it went badly I could ask Arun for 20 minutes of feedback and fix it by Monday, I'd cope.",
    'In 5 years nobody, including Priya, will remember this review, because they never do.',
    'I will book 30 minutes with Arun on Thursday to rehearse, because practice actually helps me.',
    'Evidence: I have shipped 4 releases this year and Dev praised the last one in standup.',
    'Last quarter my numbers beat the target by 12 percent, which Kavya mentioned in the all-hands.',
  ];
  const finisherBtn = page.locator('#f-finisher');
  for (let i = 0; i < 40 && !(await finisherBtn.isVisible()); i++) {
    if (await page.locator('#f-breathe').isVisible()) { await page.getByRole('button', { name: 'Skip' }).click(); continue; }
    if (!(await page.locator('#f-line').isEnabled())) { await page.waitForTimeout(150); continue; }
    const first = page.locator('#f-moves input[name="f-move"]').first();
    await first.check();
    await page.locator('#f-line').fill(koLines[i % koLines.length]);
    await page.locator('#f-line').press('Enter');
    await page.waitForTimeout(120);
  }
  await finisherBtn.waitFor({ state: 'visible' });
  assert.ok((await grip()) >= 1, 'questions alone never take GRIP below 1');
  assert.ok(!(await page.locator('#f-end').isVisible()), 'no K.O. without the balanced thought');
  await shot('f8-unlocked');
  await finisherBtn.click();
  await page.locator('#f-balanced').waitFor({ state: 'visible' });
  assert.ok((await page.locator('#f-material').textContent()).includes(evidence), 'Round 0 evidence shown as material');
  const balanced = "The review may have notes, like last time, and I've handled notes before; one review doesn't define my work.";
  await page.locator('#f-balanced-text').fill(balanced);
  await shot('f8-balanced');
  await page.getByRole('button', { name: 'Write it' }).click();
  await page.locator('#f-balanced-belief').fill('65');
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.locator('#f-end').waitFor({ state: 'visible' });
  assert.match(await page.locator('#f-end-msg').textContent(), /The thought lost its grip\. The feeling may linger\. That's normal, and it fades\./);
  await page.waitForTimeout(1200);
  await shot('f8-ko');
  await page.locator('#f-end').getByRole('button', { name: 'Continue' }).click();

  // Debrief: belief now → feeling now → overall.
  await page.locator('#f-belief-after').fill('30');
  await go('f10');
  assert.match(await page.locator('#f-intensity-after-label').textContent(), /anxious, ashamed/);
  await page.locator('#f-intensity-after').fill('40');
  await go('f11');
  const seeResult = page.locator('[data-fgate="overall"]');
  assert.equal(await seeResult.getAttribute('aria-disabled'), 'true', 'overall feeling required');
  await page.locator('.feeling', { hasText: 'Better' }).click();
  await seeResult.click();
  await page.locator('#f-card').waitFor();
  const order = await page.locator('#f-result-body > section').evaluateAll((n) => n.map((x) => x.dataset.section));
  assert.deepEqual(order, ['context', 'emotion', 'belief', 'balanced', 'feeling', 'stats', 'lines'], 'outcomes before game stats');
  const card = await page.locator('#f-card').textContent();
  for (const want of ['the product review on Friday', "that I'm not good enough", '80 → 40', '70 → 30', balanced, '65/100',
    'Better (4/5)', 'Parries', 'Knockdowns', 'Best streak', 'Traps blocked most', 'What the thought had going for it', evidence, 'blocked ']) {
    assert.ok(card.includes(want), `result card missing: ${want}`);
  }
  assert.ok(!card.includes('Breaths taken'), 'no breaths line when breathing was skipped');
  const coping = await page.locator('#f-coping').textContent();
  for (const want of ['Hot thought', balanced, 'Best counter', 'One action']) assert.ok(coping.includes(want), `coping card missing: ${want}`);
  assert.match(await page.locator('#f-coping-intro').textContent(), /Keep this for the next time the spiral starts\./);
  assert.match(await page.locator('#f-closing').textContent(), /worry time/);
  await shot('f12-result');

  const [fmd] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download .md' }).click(),
  ]);
  const fightMd = await readFile(await fmd.path(), 'utf8');
  assert.match(fmd.suggestedFilename(), /^flip-fight-\d{4}-\d{2}-\d{2}-\d{4}\.md$/);
  const idx = (h) => { const i = fightMd.indexOf(h); assert.ok(i >= 0, `fight markdown missing: ${h}`); return i; };
  assert.ok(idx('# Flip · Fight — ') < idx('## The situation and the thought'));
  assert.ok(idx('## Feeling (anxious, ashamed)') < idx('## Belief in the original thought'));
  assert.ok(idx('## The balanced thought') < idx('## Overall'));
  assert.ok(idx('## Overall') < idx('## The fight'));
  assert.ok(idx('## The fight') < idx('## Your counter-arguments'));
  idx('### What the thought had going for it'); idx('## Coping card'); idx('worry time'); idx(thought);
  const [ftxt] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download .txt' }).click(),
  ]);
  assert.match(ftxt.suggestedFilename(), /^flip-fight-.*\.txt$/);

  await page.getByRole('button', { name: 'Fight again' }).click();
  await page.locator('#h-f6').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#f-belief').inputValue(), '30', 'fight again starts from the new belief');

  // Safe mode from Round 0 evidence: generic-only + visible crisis banner.
  await go('f7');
  await page.getByRole('button', { name: 'Enter the ring' }).click();
  await page.locator('#f-evidence').fill('Last time this happened I wanted to hurt myself');
  await page.locator('#f-evidence').press('Enter');
  assert.ok(await page.locator('#f-safety-banner').isVisible(), 'crisis banner above the arena');
  assert.match(await page.locator('#f-safety-banner').textContent(), /Tele-MANAS 14416/);
  assert.ok(!/hurt/i.test(await page.locator('#f-proj-text').textContent()), 'evidence not echoed in safe mode');
  await speed(10);
  await page.locator('#f-input-area').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('#f-projectile:not([hidden])').waitFor({ timeout: 20000 });
  const safeText = await page.locator('#f-proj-text').textContent();
  assert.ok(!/hurt|review|good enough|manager/i.test(safeText), `safe mode comment is generic: ${safeText}`);
  await shot('f8-safe');
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
  console.log('✓ Fight flow: thought record, Round 0, focus-mode block, hit, knockdown + skip, pause, balanced-thought K.O., debrief, coping card, .md/.txt, safe mode');
  console.log(`✓ ${requests.length} request(s) total (the page itself); 0 after initial load`);
} catch (e) {
  failed = true;
  console.error('✗', e.message);
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
