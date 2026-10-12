import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRng, computeDamage, similarity, trackCombo, blockOutcome, applyBlock, applyAttack,
  applyCommentHit, applyFinisher, recover, createFight, regenTick, tickRound, endRound,
  startingAnxietyHp, buildContext, fillTemplate, extractSituation, fragmentOf,
  createCommentState, nextComment, maybeQueueComeback, containsSelfHarm, sanitizeText,
  throwDelay, travelTime, projectileProgress, strongestLine, topBlockedTraps, formatDuration,
} from '../src/fight/logic.js';
import { MOVES, TUNING, TRAPS, COMEBACK } from '../src/fight/constants.js';

const SPECIFIC = 'Last time I presented on 12 March, Priya said my slides were the clearest, because I prepared.';
const fullCtx = buildContext(
  { situation: 'the product review on Friday', who: 'my manager', fear: "I'm not good enough" },
  "I'll mess up the review and everyone will see I'm not good enough",
);

// ---------- Damage ----------

test('damage: vague line is capped at 3', () => {
  for (const line of ["It'll be ok", 'Everything is fine, everything is fine!!!', 'Did it on 3 May']) {
    const r = computeDamage(line);
    assert.equal(r.verdict, 'vague', line);
    assert.ok(r.damage <= 3, line);
  }
});

test('damage: specific line gets base + all three bonuses (30)', () => {
  const r = computeDamage(SPECIFIC);
  assert.equal(r.verdict, 'hit');
  assert.equal(r.base, 15);
  assert.equal(r.bonus, 15);
  assert.equal(r.damage, 30);
  assert.deepEqual(r.reasons, ['number or date', 'grounding word', 'a name or place']);
});

test('damage: base is ~1 per 4 chars; "I" is not a proper noun', () => {
  const line = 'my work has mostly gone well this year so far';
  assert.equal(computeDamage(line).damage, Math.floor(line.length / 4));
  assert.ok(!computeDamage('My manager liked it. She said I did well and the team agreed.').reasons.includes('a name or place'));
});

test('damage: reassurance inside a specific line is not vague', () => {
  assert.equal(computeDamage("It'll be ok because last time I presented on 3 March, Priya said it was clear.").verdict, 'hit');
});

test('damage: near-duplicate does 0', () => {
  const again = SPECIFIC.toLowerCase().replace(/[,.]/g, '') + '!!';
  const r = computeDamage(again, [SPECIFIC]);
  assert.equal(r.verdict, 'repeat');
  assert.equal(r.damage, 0);
  assert.ok(similarity(SPECIFIC, again) >= 0.85);
  assert.notEqual(computeDamage('I have shipped three projects on time this year already.', [SPECIFIC]).verdict, 'repeat');
});

test('damage: combo unlocks FULL FLIP only after all four move types land', () => {
  let used = new Set();
  const step = (id, v) => { const r = trackCombo(used, id, v); used = r.used; return r.unlocked; };
  assert.equal(step('jab', 'hit'), false);
  assert.equal(step('kick', 'hit'), false);
  assert.equal(step('check', 'vague'), false, 'vague does not count');
  assert.equal(step('check', 'parry'), false, 'parry counts');
  assert.equal(step('jab', 'hit'), false);
  assert.equal(step('uppercut', 'hit'), true);

  // Through the fight reducers, ending in a 25-damage finisher.
  let f = createFight(100);
  const lines = {
    jab: SPECIFIC,
    kick: 'the review goes so well they ask me to teach the team',
    check: 'a few small notes to fix and then we all move on',
    uppercut: 'block an hour tomorrow morning to rehearse it twice',
  };
  let unlockedAt = null;
  MOVES.forEach((m, i) => {
    const r = applyAttack(f, m.id, lines[m.id]);
    f = r.fight;
    if (r.justUnlocked) unlockedAt = i;
  });
  assert.equal(unlockedAt, 3);
  assert.equal(f.finisherReady, true);
  const before = f.anxietyHp;
  const fin = applyFinisher(f);
  assert.equal(fin.damage, 25);
  assert.equal(fin.fight.anxietyHp, before - 25);
  assert.equal(applyFinisher(fin.fight).damage, 0, 'only once');
});

// ---------- Blocking ----------

test('block: strong counter parries, anxiety takes the damage, +1 streak', () => {
  const rng = createRng(1);
  const f = createFight(50);
  const r = applyBlock(f, 'jab', SPECIFIC, { trap: 'Mind Reading' }, rng);
  assert.equal(r.outcome.kind, 'parry');
  assert.equal(r.fight.anxietyHp, f.anxietyHp - 30);
  assert.equal(r.fight.playerHp, 100);
  assert.equal(r.fight.streak, 1);
  assert.equal(r.fight.parries, 1);
  assert.equal(r.fight.log.at(-1).trap, 'Mind Reading');
});

test('block: weak counter (4–11) is a partial block, player takes half', () => {
  const rng = createRng(2);
  const weak = 'my last review went fine overall'; // 32 chars → 8, no bonus
  const res = computeDamage(weak);
  assert.ok(res.damage >= 4 && res.damage < 12 && res.verdict === 'hit');
  const out = blockOutcome(res, rng);
  assert.equal(out.kind, 'partial');
  assert.ok(out.playerDamage >= 5 && out.playerDamage <= 7, `half of 10–14, got ${out.playerDamage}`);
  assert.equal(out.anxietyDamage, 0);
});

test('block: no answer or too vague lets the comment hit for 10–14', () => {
  const rng = createRng(3);
  const vague = blockOutcome(computeDamage("I'm fine"), rng);
  assert.equal(vague.kind, 'hit');
  assert.ok(vague.playerDamage >= 10 && vague.playerDamage <= 14);
  for (let i = 0; i < 50; i++) {
    const { damage, fight } = applyCommentHit(createFight(50), rng);
    assert.ok(damage >= 10 && damage <= 14);
    assert.equal(fight.playerHp, 100 - damage);
    assert.equal(fight.streak, 0);
  }
});

// ---------- Knockdown & recovery ----------

test('knockdown → recovery is identical for breathe / skip / off', () => {
  const rng = createRng(4);
  let f = { ...createFight(70), playerHp: 5, anxietyHp: 80, streak: 3 };
  f = applyCommentHit(f, rng).fight;
  assert.equal(f.down, true);
  assert.equal(f.playerHp, 0);
  assert.equal(f.knockdowns, 1);
  const results = ['breathe', 'skip', 'off'].map((how) => recover(f, how));
  results.forEach((r) => assert.deepEqual(r, results[0]));
  assert.equal(results[0].playerHp, TUNING.recoverPlayerHp);
  assert.equal(results[0].anxietyHp, 70);
  assert.equal(results[0].down, false);
  assert.equal(recover({ ...f, anxietyHp: 4 }, 'skip').anxietyHp, 1, 'recovery never K.O.s anxiety');
});

// ---------- Rounds & regen ----------

test('rounds: HP carries over, fight ends after round 3 or on K.O.', () => {
  let f = { ...createFight(50), playerHp: 64, anxietyHp: 77 };
  let t = tickRound(f, 98_000);
  assert.equal(t.roundOver, false);
  t = tickRound(t.fight, 2_000);
  assert.equal(t.roundOver, true);
  f = endRound(t.fight);
  assert.deepEqual([f.round, f.roundTimeLeftMs, f.playerHp, f.anxietyHp, f.ended], [2, 99_000, 64, 77, null]);
  f = endRound(endRound(f));
  assert.equal(f.round, 3);
  assert.equal(f.ended, 'timeout');

  const ko = applyAttack({ ...createFight(0), anxietyHp: 10 }, 'jab', SPECIFIC);
  assert.equal(ko.fight.anxietyHp, 0);
  assert.equal(ko.fight.ended, 'ko');
  assert.equal(tickRound(ko.fight, 200_000).roundOver, false, 'no round end after K.O.');
});

test('regen: +1 every 3s idle, capped at the starting max', () => {
  let f = { ...createFight(50), anxietyHp: 90 };
  assert.equal(f.anxietyMax, startingAnxietyHp(50));
  assert.equal(regenTick(f, 2999).grew, false);
  const g = regenTick(f, 3000);
  assert.equal(g.fight.anxietyHp, 91);
  assert.equal(regenTick(g.fight, 5000).grew, false);
  f = { ...f, anxietyHp: f.anxietyMax };
  assert.equal(regenTick(f, 9000).grew, false);
  assert.deepEqual([startingAnxietyHp(0), startingAnxietyHp(100)], [60, 150]);
});

// ---------- Context & templates ----------

test('templates: all slots present fills; missing slot returns null', () => {
  assert.equal(fillTemplate('{who} has already decided you can\'t do this', fullCtx), "My manager has already decided you can't do this");
  assert.equal(fillTemplate('Admit it. {fear}.', fullCtx), "Admit it. I'm not good enough.");
  const noWho = buildContext({ situation: 'the review' }, 'I will mess up the review tomorrow badly');
  assert.equal(fillTemplate('{who} has already decided', noWho), null);
  assert.equal(fillTemplate('{situation} is going to go badly. You know it.', noWho), 'The review is going to go badly. You know it.');
});

test('context: keyword extraction fallback for {situation}; who/fear stay empty', () => {
  assert.equal(extractSituation("I'll mess up the review and everyone will see I'm not good enough"), 'the review');
  assert.equal(extractSituation('My presentation on Friday will be a disaster'), 'my presentation');
  const ctx = buildContext({}, "I'll mess up the review and everyone will see I'm not good enough");
  assert.deepEqual([ctx.situation, ctx.who, ctx.fear, ctx.situationSource], ['the review', '', '', 'extracted']);
  assert.equal(buildContext({ situation: '  the  <b>launch</b>  ' }, 'x').situation, 'the launch');
});

test('sanitise: strips HTML, collapses whitespace, caps length', () => {
  assert.equal(sanitizeText('  <img src=x onerror=alert(1)>hi   there\n\n'), 'hi there');
  assert.ok(sanitizeText('word '.repeat(100), 60).length <= 60);
  assert.equal(buildContext({ who: 'a'.repeat(200) }, 'x').who.length, 60);
});

// ---------- Fragments ----------

test('fragment: max 6 words, cut at a word boundary', () => {
  assert.equal(fragmentOf('Last time I presented on 12 March, Priya said it was clear.'), 'Last time I presented on 12');
  assert.equal(fragmentOf('Short one.'), 'Short one');
  const long = fragmentOf('Supercalifragilistic expialidocious antidisestablishmentarianism counterrevolutionaries');
  assert.ok(!/\S$/.test(long + ' ') || long.split(' ').every((w) => w.length > 0));
  assert.ok(long.length <= TUNING.fragmentMaxChars);
  assert.ok('Supercalifragilistic expialidocious antidisestablishmentarianism'.startsWith(long));
  assert.equal(fragmentOf('"Quoted" words, with "marks" here'), 'Quoted words, with marks here');
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
  assert.ok(Math.abs(normal.template - 0.5) <= 0.05, JSON.stringify(normal));
  assert.ok(Math.abs(normal.generic - 0.3) <= 0.05, JSON.stringify(normal));
  assert.ok(Math.abs(normal.original - 0.2) <= 0.05, JSON.stringify(normal));
  const calm = shares(throwMany(fullCtx, 1000, { calm: true }));
  assert.ok(Math.abs(calm.template - 0.2) <= 0.05, JSON.stringify(calm));
  assert.ok(Math.abs(calm.generic - 0.7) <= 0.05, JSON.stringify(calm));
  assert.ok(Math.abs(calm.original - 0.1) <= 0.05, JSON.stringify(calm));
});

test('comments: never the same line twice in a row; lists cycle before reuse', () => {
  for (const calm of [false, true]) {
    const all = throwMany(fullCtx, 1000, { calm, seed: 7 });
    for (let i = 1; i < all.length; i++) assert.notEqual(all[i].text, all[i - 1].text);
  }
  // Generic-only (safe mode) cycles through each trap's 8 lines before any repeats.
  const safe = buildContext({}, 'I want to die if this goes wrong');
  const seq = throwMany(safe, 48, { seed: 3 });
  const byTrap = {};
  seq.forEach((c) => { (byTrap[c.trapId] ||= []).push(c.text); });
  Object.values(byTrap).forEach((lines) => {
    const firstCycle = lines.slice(0, 8);
    assert.equal(new Set(firstCycle).size, firstCycle.length, 'no reuse within a cycle');
  });
});

test('comments: templates only used when every slot is filled', () => {
  const ctx = buildContext({ situation: 'the review' }, 'x x x x x x x x x x x x x x x x x x x x');
  throwMany(ctx, 300).filter((c) => c.source === 'template').forEach((c) => {
    assert.ok(!/\{\w+\}/.test(c.text), c.text);
    assert.ok(!c.text.includes('undefined'));
  });
  assert.ok(!throwMany(ctx, 300).some((c) => c.trapId === 'fear-echo'), 'fear echo needs {fear}');
});

test('comebacks: ~30% chance, quote a fragment, labelled Yes-but', () => {
  const rng = createRng(5);
  let queued = 0;
  for (let i = 0; i < 1000; i++) {
    if (maybeQueueComeback(createCommentState(), SPECIFIC, fullCtx, rng).pendingComeback) queued += 1;
  }
  assert.ok(Math.abs(queued / 1000 - 0.3) <= 0.05, String(queued));

  let gen = { ...createCommentState(), pendingComeback: fragmentOf(SPECIFIC) };
  const r = nextComment(gen, fullCtx, createRng(6));
  assert.equal(r.comment.source, 'comeback');
  assert.equal(r.comment.trap, COMEBACK.label);
  assert.ok(r.comment.text.includes('Last time I presented on 12'));
  gen = r.gen;
  assert.equal(gen.pendingComeback, null);
});

// ---------- Guardrails ----------

test('self-harm language in input → generic-only mode', () => {
  for (const input of [
    { thought: "If I fail this review I'll kill myself" },
    { thought: 'I will fail the review and everyone will know', fear: 'I want to die' },
    { thought: 'I will fail the review and everyone will know', situation: 'Self-harm again' },
  ]) {
    const ctx = buildContext(input, input.thought);
    assert.equal(ctx.safeMode, true, JSON.stringify(input));
    const comments = throwMany(ctx, 200);
    assert.ok(comments.every((c) => c.source === 'generic'));
    assert.equal(maybeQueueComeback(createCommentState(), SPECIFIC, ctx, createRng(1)).pendingComeback, null);
  }
  assert.equal(containsSelfHarm('the deadline will kill my weekend plans'), false);
  assert.equal(containsSelfHarm('I want to die'), true);
  assert.equal(fullCtx.safeMode, false);
});

// ---------- Misc ----------

test('timing helpers', () => {
  const rng = createRng(8);
  for (let i = 0; i < 100; i++) {
    const d = throwDelay(rng, false);
    assert.ok(d >= 6000 && d <= 10000);
    const c = throwDelay(rng, true);
    assert.ok(c >= 12000 && c <= 16000);
  }
  assert.equal(travelTime({ width: 375 }), 8000);
  assert.equal(travelTime({ width: 1200 }), 6000);
  assert.equal(travelTime({ width: 375, calm: true }), 12000);
  assert.equal(travelTime({ width: 1200, reducedMotion: true }), 9000);
  assert.equal(projectileProgress(1000, 5000, 8000), 0.5);
  assert.equal(formatDuration(125000), '2:05');
});

test('debrief helpers: strongest line, traps blocked most', () => {
  const rng = createRng(9);
  let f = createFight(100);
  f = applyAttack(f, 'kick', 'the review goes so well they ask me to teach the team').fight;
  f = applyBlock(f, 'jab', SPECIFIC, { trap: 'Mind Reading' }, rng).fight;
  f = applyBlock(f, 'check', 'In March, Arun said the deck was the clearest one, because it was.', { trap: 'Mind Reading' }, rng).fight;
  f = applyBlock(f, 'uppercut', 'I will ask Sam for notes on Monday at 10am, because it helps.', { trap: 'Fortune Telling' }, rng).fight;
  assert.equal(strongestLine(f).line, SPECIFIC);
  assert.deepEqual(topBlockedTraps(f)[0], { trap: 'Mind Reading', count: 2 });
  assert.ok(TRAPS.length >= 7);
});
