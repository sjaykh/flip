import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDamage, trackCombo, idleGrowth, similarity, startingHp, applyDamage,
  afterBreather, tauntAt, formatDuration,
} from '../src/fight/logic.js';
import { MOVES, FINISHER_DAMAGE } from '../src/fight/constants.js';

test('empty reassurance is vague and capped at 3', () => {
  const r = computeDamage("It'll be ok");
  assert.equal(r.verdict, 'vague');
  assert.ok(r.damage <= 3);
});

test('a long empty phrase is still vague', () => {
  const r = computeDamage('Everything is fine, everything is fine!!!');
  assert.equal(r.verdict, 'vague');
  assert.ok(r.damage <= 3);
});

test('short lines are vague even if specific', () => {
  const r = computeDamage('Did it on 3 May');
  assert.equal(r.verdict, 'vague');
  assert.ok(r.damage <= 3);
});

test('a reassurance phrase inside a specific line is not vague', () => {
  const r = computeDamage("It'll be ok because last time I presented on 3 March, Priya said it was clear.");
  assert.equal(r.verdict, 'hit');
});

test('specific line gets base + all three bonuses', () => {
  const line = 'Last time I presented on 12 March, Priya said my slides were the clearest, because I prepared.';
  const r = computeDamage(line);
  assert.equal(r.verdict, 'hit');
  assert.equal(r.base, 15); // > 60 chars → capped
  assert.equal(r.bonus, 15);
  assert.equal(r.damage, 30);
  assert.deepEqual(r.reasons, ['number or date', 'grounding word', 'a name or place']);
});

test('base damage is ~1 per 4 chars with no bonus', () => {
  const line = 'my work has mostly gone well this year so far'; // 45 chars, lowercase, no keywords
  const r = computeDamage(line);
  assert.equal(r.verdict, 'hit');
  assert.equal(r.bonus, 0);
  assert.equal(r.damage, Math.floor(line.length / 4));
});

test('"I" and sentence starts are not proper nouns', () => {
  const r = computeDamage('My manager liked it. She said I did well and the team agreed with her.');
  assert.ok(!r.reasons.includes('a name or place'));
});

test('near-duplicate does 0 damage', () => {
  const first = 'Last time I presented, my manager said it was good.';
  const again = 'last time i presented my manager said it was good!!';
  const r = computeDamage(again, [first]);
  assert.equal(r.verdict, 'repeat');
  assert.equal(r.damage, 0);
  assert.ok(similarity(first, again) >= 0.85);
});

test('a different line is not a repeat', () => {
  const r = computeDamage('I have shipped three projects on time this year already.', ['Last time I presented, my manager said it was good.']);
  assert.notEqual(r.verdict, 'repeat');
});

test('combo unlocks only after all four move types land real hits', () => {
  let used = new Set();
  let res;
  res = trackCombo(used, 'jab', 'hit'); used = res.used; assert.equal(res.unlocked, false);
  res = trackCombo(used, 'kick', 'hit'); used = res.used; assert.equal(res.unlocked, false);
  res = trackCombo(used, 'check', 'vague'); used = res.used; assert.equal(res.unlocked, false, 'vague does not count');
  res = trackCombo(used, 'check', 'hit'); used = res.used; assert.equal(res.unlocked, false);
  res = trackCombo(used, 'jab', 'hit'); used = res.used; assert.equal(res.unlocked, false, 'repeating a type does not unlock');
  res = trackCombo(used, 'uppercut', 'hit'); assert.equal(res.unlocked, true);
  assert.equal(res.used.size, MOVES.length);
  assert.equal(FINISHER_DAMAGE, 25);
});

test('idle growth: +1 every 3s of inactivity, maxed at 100', () => {
  const s = { hp: 50, lastActivityAt: 0, lastGrowthAt: 0 };
  assert.equal(idleGrowth(s, 2999).grew, false);
  const g = idleGrowth(s, 3000);
  assert.deepEqual([g.hp, g.grew, g.maxed], [51, true, false]);
  assert.equal(idleGrowth({ ...s, hp: g.hp, lastGrowthAt: g.lastGrowthAt }, 5000).grew, false);
  assert.equal(idleGrowth({ hp: 99, lastActivityAt: 0, lastGrowthAt: 0 }, 3000).maxed, true);
  assert.equal(idleGrowth({ hp: 100, lastActivityAt: 0, lastGrowthAt: 0 }, 3000).hp, 100);
});

test('hp helpers', () => {
  assert.equal(startingHp(0), 10);
  assert.equal(startingHp(250), 100);
  assert.equal(applyDamage(10, 30), 0);
  assert.equal(afterBreather(100), 85);
  assert.equal(tauntAt(0, 'my thought'), 'my thought');
  assert.notEqual(tauntAt(1, 'my thought'), 'my thought');
  assert.equal(formatDuration(125000), '2:05');
});
