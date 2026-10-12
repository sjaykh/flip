import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRng, computeDamage, similarity, scoreLine, blockOutcome, applyBlock, applyAttack,
  applyCommentHit, applyBalancedThought, setBalancedBelief, recover, createFight, startFighting,
  tick, focusKey, launchComment, endRound, applyEvidence, setupGate, canSkip, SETUP_STEPS,
  startingGrip, emotionMeter, buildContext, fillTemplate, extractSituation, fragmentOf,
  createCommentState, nextComment, maybeQueueComeback, containsSelfHarm, sanitizeText,
  travelTime, throwGap, rotateMoves, initialMoves, strongestLine, topBlockedTraps,
  formatDuration, resultSections, buildResultMarkdown, copingCard,
} from '../src/fight/logic.js';
import { MOVES, TUNING, PACING, TRAPS, COMEBACK } from '../src/fight/constants.js';

const SPECIFIC = 'Last time I presented on 12 March, Priya said my slides were the clearest, because I prepared.';
const fullCtx = buildContext(
  { situation: 'the product review on Friday', who: 'my manager', fear: "that I'm not good enough" },
  "I'll mess up the review and everyone will see I'm not good enough",
);
const comment = { text: 'They all think you are bad at this', trap: 'Mind Reading', trapId: 'mind-reading', source: 'generic' };

/** A fight that's live (past Round 0) with a comment in the air. */
function liveWithComment(opts = {}) {
  let f = startFighting(applyEvidence(createFight({ belief: 70, intensity: 80 }), 'My last review had two big corrections.').fight, false);
  f = launchComment(f, comment, opts.travel ?? 12000);
  return f;
}

// ---------- Damage ----------

test('damage: vague line is capped at 3', () => {
  for (const line of ["It'll be ok", 'Everything is fine, everything is fine!!!', 'Did it on 3 May']) {
    const r = computeDamage(line);
    assert.equal(r.verdict, 'vague', line);
    assert.ok(r.damage <= 3, line);
  }
});

test('damage: specific line gets base + all three bonuses (30); "I could" / "I\'d" count as grounding', () => {
  const r = computeDamage(SPECIFIC);
  assert.deepEqual([r.verdict, r.base, r.bonus, r.damage], ['hit', 15, 15, 30]);
  assert.ok(computeDamage('if it went badly I could ask for a second review slot').reasons.includes('grounding word'));
  assert.ok(computeDamage("if it went badly I'd ask my lead for another review slot").reasons.includes('grounding word'));
});

test('damage: near-duplicate does 0', () => {
  const again = SPECIFIC.toLowerCase().replace(/[,.]/g, '') + '!!';
  const r = computeDamage(again, [SPECIFIC]);
  assert.deepEqual([r.verdict, r.damage], ['repeat', 0]);
  assert.ok(similarity(SPECIFIC, again) >= 0.85);
});

test('damage: variety bonus +3 for the first use of each move type', () => {
  let f = startFighting(applyEvidence(createFight({ belief: 100 }), 'Two corrections last review.').fight, false);
  const first = applyAttack(f, 'jab', SPECIFIC);
  assert.equal(first.result.variety, 3);
  assert.equal(first.result.damage, 33);
  f = first.fight;
  const sameMove = scoreLine(f, 'jab', 'In June, Meera told the team my doc was the clearest she read, because it was.');
  assert.equal(sameMove.variety, 0, 'second use of the same move: no bonus');
  const newMove = scoreLine(f, 'time', 'In 5 years nobody, including Meera, will remember this review, because they never do.');
  assert.equal(newMove.variety, 3);
  assert.equal(scoreLine(f, 'kick', "It'll be ok").variety, 0, 'no bonus for vague lines');
});

// ---------- Blocking ----------

test('block: strong counter parries, GRIP takes the damage, +1 streak', () => {
  const f = liveWithComment();
  const r = applyBlock(f, 'jab', SPECIFIC, createRng(1));
  assert.equal(r.outcome.kind, 'parry');
  assert.equal(r.fight.grip, f.grip - 33);
  assert.equal(r.fight.playerHp, f.playerHp);
  assert.equal(r.fight.streak, 1);
  assert.equal(r.fight.projectile, null);
  assert.equal(r.fight.log.at(-1).trap, 'Mind Reading');
});

test('block: weak counter (4–11) is a partial block, player takes half', () => {
  const res = computeDamage('my last review went fine overall');
  assert.ok(res.damage >= 4 && res.damage < 12 && res.verdict === 'hit');
  const out = blockOutcome(res, createRng(2));
  assert.equal(out.kind, 'partial');
  assert.ok(out.playerDamage >= 5 && out.playerDamage <= 7);
  assert.equal(out.gripDamage, 0);
});

test('block: no answer or too vague lets the comment hit for 10–14', () => {
  const rng = createRng(3);
  const vague = blockOutcome(computeDamage("I'm fine"), rng);
  assert.equal(vague.kind, 'hit');
  assert.ok(vague.playerDamage >= 10 && vague.playerDamage <= 14);
  for (let i = 0; i < 50; i++) {
    const f = liveWithComment();
    const { damage, fight } = applyCommentHit(f, rng);
    assert.ok(damage >= 10 && damage <= 14);
    assert.equal(fight.playerHp, f.playerHp - damage);
    assert.equal(fight.projectile, null);
  }
});

// ---------- Finisher ----------

test('finisher: regular moves never take GRIP below 1; K.O. only via a balanced thought', () => {
  let f = startFighting(applyEvidence(createFight({ belief: 0 }), 'Two corrections last review.').fight, false); // 60 grip
  const lines = [
    SPECIFIC,
    'In June, Meera told the whole team my roadmap doc was the clearest she had read, because it was.',
    'Evidence: I have shipped 4 releases this year and Dev praised the last one in standup.',
    'Last quarter my numbers beat the target by 12 percent, which Kavya mentioned in the all-hands.',
    'Tonight I will write down 5 likely questions and draft answers, then sleep by 11.',
  ];
  lines.forEach((l, i) => { f = applyAttack(f, MOVES[i % MOVES.length].id, l).fight; });
  assert.equal(f.grip, 1, 'floored at 1');
  assert.equal(f.ended, null, 'no K.O. from questions alone');
  assert.equal(f.finisherReady, true);
  assert.equal(applyBalancedThought(f, 'too short').ok, false);
  const ko = applyBalancedThought(f, 'The review might have notes, and I have handled notes before; one review does not define my work.');
  assert.equal(ko.ok, true);
  assert.deepEqual([ko.fight.grip, ko.fight.ended], [0, 'ko']);
  assert.equal(setBalancedBelief(ko.fight, 65).balancedBelief, 65);
});

test('finisher: locked until GRIP is at or below 25% of its max', () => {
  const f = startFighting(applyEvidence(createFight({ belief: 100 }), 'Two corrections last review.').fight, false);
  assert.equal(applyBalancedThought(f, 'The review might have notes, and I have handled notes before.').ok, false);
  const low = { ...f, grip: 40, finisherReady: false };
  const r = applyAttack(low, 'jab', SPECIFIC);
  assert.equal(r.justUnlocked, true, `150 max → unlock at 37.5, grip now ${r.fight.grip}`);
});

// ---------- Setup ----------

test('setup: Round 0 evidence cannot be skipped; situation, hot thought and who can', () => {
  assert.deepEqual(SETUP_STEPS.filter(canSkip), ['situation', 'fear', 'who']);
  assert.equal(canSkip('evidence'), false);
  assert.equal(setupGate('evidence', { evidence: '' }), false);
  assert.equal(setupGate('evidence', { evidence: 'meh' }), false);
  assert.equal(setupGate('evidence', { evidence: 'My last review had two big corrections.' }), true);
  const f = createFight({ belief: 50 });
  assert.equal(applyEvidence(f, '').ok, false);
  const r = applyEvidence(f, 'My last review had two big corrections.');
  assert.equal(r.fight.playerHp, 100 - TUNING.openingHitDamage);
  ['situation', 'fear', 'who'].forEach((s) => assert.equal(setupGate(s, {}), true));
  assert.equal(setupGate('feelings', { emotions: [] }), false);
  assert.equal(setupGate('feelings', { emotions: ['other'], otherEmotion: '' }), false);
  assert.equal(setupGate('feelings', { emotions: ['anxious', 'other'], otherEmotion: 'embarrassed' }), true);
  assert.equal(setupGate('thought', { thought: 'too short' }), false);
});

// ---------- Pacing: focus mode ----------

test('focus: pauses the round clock, regen and new throws', () => {
  let f = startFighting(applyEvidence(createFight({ belief: 50 }), 'My last review had two big corrections.').fight, false);
  f = { ...f, grip: f.grip - 20 };
  const before = { time: f.roundTimeLeftMs, grip: f.grip, timer: f.throwTimer };
  f = focusKey(f).fight;
  const events = [];
  for (let t = 0; t < 7000; t += 100) {
    if (t % 1000 === 0) f = focusKey(f).fight; // keep typing
    const r = tick(f, 100);
    f = r.fight;
    events.push(...r.events);
  }
  assert.equal(f.focus.active, true);
  assert.equal(f.roundTimeLeftMs, before.time, 'round clock paused');
  assert.equal(f.grip, before.grip, 'no regen');
  assert.equal(f.throwTimer, before.timer, 'throw countdown paused');
  assert.ok(!events.includes('throw') && !events.includes('windup'));
});

test('focus: a comment never reaches the player while keystrokes continue', () => {
  for (const calm of [false, true]) {
    let f = focusKey(liveWithComment({ travel: 1000 })).fight; // even a very fast comment
    let landed = false;
    for (let t = 0; t < 60_000; t += 50) {
      if (t % 2000 === 0) f = focusKey(f).fight;
      const r = tick(f, 50, { calm });
      f = r.fight;
      if (r.events.includes('land')) landed = true;
    }
    assert.equal(landed, false, `calm=${calm}`);
    assert.ok(f.projectile.progress <= PACING.focusCap);
    if (calm) assert.equal(f.projectile.progress, 0, 'Calm pace: fully frozen');
  }
});

test('focus: 10% speed while typing, normal again after 8 s idle', () => {
  let f = focusKey(liveWithComment({ travel: 10_000 })).fight;
  f = tick(f, 1000).fight;
  assert.ok(Math.abs(f.projectile.progress - 0.01) < 1e-9, '10% speed');
  let exited = false;
  for (let t = 0; t < 8000; t += 100) {
    const r = tick(f, 100);
    f = r.fight;
    if (r.events.includes('focusExit')) exited = true;
  }
  assert.equal(exited, true);
  assert.equal(f.focus.active, false);
  const p = f.projectile.progress;
  f = tick(f, 1000).fight;
  assert.ok(Math.abs(f.projectile.progress - p - 0.1) < 1e-9, 'normal speed resumes');
});

// ---------- Pacing: throw rhythm ----------

function runUntil(f, ms, opts) {
  const events = [];
  for (let t = 0; t < ms; t += 50) {
    const r = tick(f, 50, opts);
    f = r.fight;
    r.events.forEach((e) => events.push({ e, t: t + 50 }));
  }
  return { f, events };
}

test('throws: one comment at a time; 4 s gap (8 s calm) with a wind-up 1.5 s before', () => {
  for (const calm of [false, true]) {
    const gap = throwGap(calm);
    assert.equal(gap, calm ? 8000 : 4000);
    let f = startFighting(applyEvidence(createFight({ belief: 50 }), 'My last review had two big corrections.').fight, calm);
    let { f: f2, events } = runUntil(f, gap + 500, { calm });
    const windup = events.find((x) => x.e === 'windup');
    const thr = events.find((x) => x.e === 'throw');
    assert.equal(thr.t, gap);
    assert.equal(windup.t, gap - PACING.windupMs);
    f2 = launchComment(f2, comment, 12000);
    assert.equal(launchComment(f2, { ...comment, text: 'second' }, 12000).projectile.comment.text, comment.text, 'never stacks');
    // While it's in the air, nothing else is thrown.
    const mid = runUntil(f2, 5000, { calm });
    assert.ok(!mid.events.some((x) => x.e === 'throw'));
    // After it resolves, the gap starts again.
    const after = applyBlock(mid.f, 'jab', SPECIFIC, createRng(4), { calm }).fight;
    const next = runUntil(after, gap + 100, { calm });
    assert.equal(next.events.find((x) => x.e === 'throw').t, gap);
  }
});

test('travel times: 12/9 s idle, 18/14 s calm, reduced motion = calm', () => {
  assert.equal(travelTime({ width: 375 }), 12000);
  assert.equal(travelTime({ width: 1200 }), 9000);
  assert.equal(travelTime({ width: 375, calm: true }), 18000);
  assert.equal(travelTime({ width: 1200, calm: true }), 14000);
  assert.equal(travelTime({ width: 375, reducedMotion: true }), 18000);
});

test('regen: +1 GRIP per 3 s idle, capped at its starting max', () => {
  let f = startFighting(applyEvidence(createFight({ belief: 50 }), 'My last review had two big corrections.').fight, false);
  f = { ...f, grip: f.gripMax - 2 };
  f = runUntil(f, 3000).f;
  assert.equal(f.grip, f.gripMax - 1);
  f = runUntil(f, 30_000).f;
  assert.equal(f.grip, f.gripMax);
});

// ---------- Knockdown & recovery ----------

test('knockdown → recovery is identical for breathe / skip / off', () => {
  const rng = createRng(4);
  let f = { ...liveWithComment(), playerHp: 5, grip: 80, streak: 3 };
  f = applyCommentHit(f, rng).fight;
  assert.deepEqual([f.down, f.playerHp, f.knockdowns, f.phase], [true, 0, 1, 'down']);
  const results = ['breathe', 'skip', 'off'].map((how) => recover(f, how));
  results.forEach((r) => assert.deepEqual(r, results[0]));
  assert.deepEqual([results[0].playerHp, results[0].grip, results[0].down], [50, 70, false]);
  assert.equal(recover({ ...f, grip: 4 }, 'skip').grip, 1, 'recovery never K.O.s the thought');
});

// ---------- Rounds ----------

test('rounds: HP and GRIP carry over; the fight ends after round 3', () => {
  let f = startFighting(applyEvidence(createFight({ belief: 50 }), 'My last review had two big corrections.').fight, false);
  f = { ...f, playerHp: 64, grip: 77 };
  const r = runUntil(f, 99_000 + 100);
  assert.ok(r.events.some((x) => x.e === 'roundOver'));
  f = endRound(r.f);
  assert.deepEqual([f.round, f.roundTimeLeftMs, f.playerHp, f.grip, f.ended, f.phase], [2, 99_000, 64, r.f.grip, null, 'between']);
  f = endRound(endRound(f));
  assert.deepEqual([f.round, f.ended], [3, 'timeout']);
  // After a timeout the balanced thought can still be written (it just doesn't K.O.).
  const bt = applyBalancedThought(f, 'The review might have notes, and I have handled notes before.');
  assert.deepEqual([bt.ok, bt.fight.ended], [true, 'timeout']);
});

test('rounds: the clock never ends a round mid-sentence', () => {
  let f = startFighting(applyEvidence(createFight({ belief: 50 }), 'My last review had two big corrections.').fight, false);
  f = { ...f, roundTimeLeftMs: 200 };
  f = focusKey(f).fight;
  const r = runUntil(f, 5000);
  assert.ok(!r.events.some((x) => x.e === 'roundOver'));
  assert.equal(r.f.roundTimeLeftMs, 200);
});

// ---------- Context & templates ----------

test('templates: all slots fill; a missing slot returns null; keyword fallback for {situation}', () => {
  assert.equal(fillTemplate("{who} has already decided you can't do this", fullCtx), "My manager has already decided you can't do this");
  assert.equal(fillTemplate('Admit it. {fear}.', fullCtx), "Admit it. I'm not good enough.");
  assert.equal(fillTemplate('Admit it. {fear}.', buildContext({ fear: 'my work is sloppy' }, 'x')), 'Admit it. My work is sloppy.');
  const noWho = buildContext({}, "I'll mess up the review and everyone will see I'm not good enough");
  assert.equal(fillTemplate('{who} has already decided', noWho), null);
  assert.deepEqual([noWho.situation, noWho.who, noWho.fear, noWho.situationSource], ['the review', '', '', 'extracted']);
  assert.equal(extractSituation('My presentation on Friday will be a disaster'), 'my presentation');
});

test('sanitise: strips HTML, collapses whitespace, caps length', () => {
  assert.equal(sanitizeText('  <img src=x onerror=alert(1)>hi   there\n\n'), 'hi there');
  assert.equal(buildContext({ who: 'a'.repeat(200) }, 'x').who.length, 60);
});

test('fragment: max 6 words, cut at a word boundary', () => {
  assert.equal(fragmentOf('Last time I presented on 12 March, Priya said it was clear.'), 'Last time I presented on 12');
  assert.equal(fragmentOf('Short one.'), 'Short one');
  const long = fragmentOf('Supercalifragilistic expialidocious antidisestablishmentarianism counterrevolutionaries');
  assert.ok(long.length <= TUNING.fragmentMaxChars);
  assert.ok('Supercalifragilistic expialidocious antidisestablishmentarianism'.startsWith(long));
});

// ---------- Comment generation ----------

function throwMany(ctx, n, { calm = false, seed = 99 } = {}) {
  const rng = createRng(seed);
  let gen = createCommentState();
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = nextComment(gen, ctx, rng, { calm });
    gen = r.gen;
    out.push(r.comment);
  }
  return out;
}

function shares(comments) {
  const c = { template: 0, generic: 0, original: 0 };
  comments.forEach((x) => { c[x.source] += 1; });
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v / comments.length]));
}

test('mix: ~50/30/20 normal and ~20/70/10 calm over 1000 throws (±5%)', () => {
  const normal = shares(throwMany(fullCtx, 1000));
  [['template', 0.5], ['generic', 0.3], ['original', 0.2]].forEach(([k, v]) => assert.ok(Math.abs(normal[k] - v) <= 0.05, JSON.stringify(normal)));
  const calm = shares(throwMany(fullCtx, 1000, { calm: true }));
  [['template', 0.2], ['generic', 0.7], ['original', 0.1]].forEach(([k, v]) => assert.ok(Math.abs(calm[k] - v) <= 0.05, JSON.stringify(calm)));
});

test('comments: never the same line twice in a row; lists cycle before reuse', () => {
  for (const calm of [false, true]) {
    const all = throwMany(fullCtx, 1000, { calm, seed: 7 });
    for (let i = 1; i < all.length; i++) assert.notEqual(all[i].text, all[i - 1].text);
  }
  const safe = buildContext({}, 'I want to die if this goes wrong');
  const byTrap = {};
  throwMany(safe, 48, { seed: 3 }).forEach((c) => { (byTrap[c.trapId] ||= []).push(c.text); });
  Object.values(byTrap).forEach((lines) => assert.equal(new Set(lines.slice(0, 8)).size, Math.min(8, lines.length)));
});

test('comebacks: ~30% chance, quote a fragment, labelled Yes-but', () => {
  const rng = createRng(5);
  let queued = 0;
  for (let i = 0; i < 1000; i++) if (maybeQueueComeback(createCommentState(), SPECIFIC, fullCtx, rng).pendingComeback) queued += 1;
  assert.ok(Math.abs(queued / 1000 - 0.3) <= 0.05, String(queued));
  const r = nextComment({ ...createCommentState(), pendingComeback: fragmentOf(SPECIFIC) }, fullCtx, createRng(6));
  assert.deepEqual([r.comment.source, r.comment.trap], ['comeback', COMEBACK.label]);
  assert.ok(r.comment.text.includes('Last time I presented on 12'));
});

// ---------- Guardrails ----------

test('self-harm language in any input → generic-only mode', () => {
  const thought = 'I will fail the review and everyone will know';
  for (const input of [
    { thought: "If I fail this review I'll kill myself" },
    { thought, fear: 'I want to die' },
    { thought, situation: 'Self-harm again' },
    { thought, who: 'nobody, I want to end it all' },
    { thought, evidence: 'Last time I wanted to hurt myself' },
    { thought, otherEmotion: 'suicidal' },
  ]) {
    const ctx = buildContext(input, input.thought);
    assert.equal(ctx.safeMode, true, JSON.stringify(input));
    assert.ok(throwMany(ctx, 200).every((c) => c.source === 'generic'));
    assert.equal(maybeQueueComeback(createCommentState(), SPECIFIC, ctx, createRng(1)).pendingComeback, null);
  }
  assert.equal(containsSelfHarm('the deadline will kill my weekend plans'), false);
  assert.equal(fullCtx.safeMode, false);
});

// ---------- Moves ----------

test('moves: mobile shows 4 and rotates the used one out; desktop shows all 6', () => {
  assert.equal(initialMoves(true).visible.length, 6);
  let m = initialMoves(false);
  assert.deepEqual(m.visible, ['jab', 'friend', 'check', 'cope']);
  m = rotateMoves(m, 'friend');
  assert.deepEqual(m.visible, ['jab', 'time', 'check', 'cope']);
  assert.deepEqual(m.queue, ['uppercut', 'friend']);
  assert.equal(MOVES.length, 6);
});

// ---------- Results ----------

function sampleResult() {
  let f = liveWithComment();
  f = applyBlock(f, 'jab', SPECIFIC, createRng(9)).fight;
  f = applyAttack(f, 'uppercut', 'I will book 30 minutes with Arun on Thursday to rehearse, because practice helps.').fight;
  return {
    date: 'Monday', situation: 'the product review on Friday', thought: 'I will mess up the review', fear: "that I'm not good enough", who: 'my manager',
    emotions: ['anxious'], intensityBefore: 80, intensityAfter: 40, beliefBefore: 70, beliefAfter: 35,
    balanced: 'There may be notes, and I have handled notes before.', balancedBelief: 60, feeling: 'Better (4/5)',
    ending: 'K.O.', fightMs: 120000, parries: f.parries, knockdowns: f.knockdowns, bestStreak: f.bestStreak,
    traps: topBlockedTraps(f), breathCycles: 0, evidence: f.evidence,
    groups: [{ title: 'Evidence Jab', lines: [{ text: SPECIFIC, meta: 'blocked Mind Reading · parried' }] }],
    bestCounter: strongestLine(f).line, action: 'I will book 30 minutes with Arun',
  };
}

test('result card order: outcome ratings before game stats', () => {
  const ids = resultSections(sampleResult()).map((s) => s.id);
  assert.deepEqual(ids, ['context', 'emotion', 'belief', 'balanced', 'feeling', 'stats', 'lines']);
  const md = buildResultMarkdown(sampleResult(), 'footer');
  const at = (s) => md.indexOf(s);
  assert.ok(at('## Feeling') < at('## Belief in the original thought'));
  assert.ok(at('## Belief in the original thought') < at('## The balanced thought'));
  assert.ok(at('## Overall') < at('## The fight'));
  assert.ok(at('## The fight') < at('## Your counter-arguments'));
  assert.ok(!md.includes('Breaths taken'), 'no breaths line without completed cycles');
  assert.ok(md.includes('What the thought had going for it'));
  assert.deepEqual(copingCard(sampleResult()).map((r) => r[0]), ['Hot thought', 'Balanced thought', 'Best counter', 'One action']);
  assert.equal(formatDuration(125000), '2:05');
});

test('misc: grip scale, anxiety meter', () => {
  assert.deepEqual([startingGrip(0), startingGrip(100)], [60, 150]);
  const f = { ...createFight({ belief: 100, intensity: 80 }) };
  assert.equal(emotionMeter(f), 80);
  assert.equal(emotionMeter({ ...f, grip: 75 }), 40, 'drops in proportion to GRIP lost');
  assert.ok(TRAPS.length >= 7);
});
