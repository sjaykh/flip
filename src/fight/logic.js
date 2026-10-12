// Fight mode game logic. Pure functions only: no DOM, no timers, no Math.random.
// Randomness comes from a seedable RNG passed in, so tests are deterministic.
// Functions that take a state object return a new one and never mutate their input.
import {
  TUNING, DAMAGE, MIX, MOVES, TRAPS, COMEBACK, ORIGINAL_TRAP_LABEL,
  VAGUE_PHRASES, SPECIFIC_WORDS, MONTHS_AND_DAYS, NOT_PROPER_NOUNS,
  SELF_HARM_PATTERNS, STOPWORDS, DETERMINERS,
} from './constants.js';

// ---------- RNG ----------

/** mulberry32: tiny, fast, seedable. `rng.next()` → [0, 1). */
export function createRng(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    range: (min, max) => min + next() * (max - min),
  };
}

// ---------- Text hygiene ----------

/** Trim, strip HTML and control characters, collapse whitespace, cap length at a word boundary. */
export function sanitizeText(input, max = TUNING.lineMaxChars) {
  let s = String(input ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[<>]/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > max) {
    const cut = s.slice(0, max);
    const space = cut.lastIndexOf(' ');
    s = (space > max * 0.6 ? cut.slice(0, space) : cut).trim();
  }
  return s;
}

/** A value that will be dropped into a template: sanitised, no trailing punctuation. */
export function slotValue(input, max = TUNING.contextMaxChars) {
  return sanitizeText(input, max).replace(/[\s.!?,;:]+$/g, '').trim();
}

export function normalizeLine(s) {
  return String(s)
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True if any of the texts mentions self-harm. */
export function containsSelfHarm(...texts) {
  const joined = texts
    .map((t) => String(t ?? '').toLowerCase().replace(/[‘’]/g, "'"))
    .join(' \n ');
  return SELF_HARM_PATTERNS.some((p) => new RegExp(`(^|[^a-z])${escapeRegExp(p)}($|[^a-z])`).test(joined));
}

/** Whole-word search for any banned word. Used by the safety test. */
export function findBannedWords(text, banned) {
  const t = String(text).toLowerCase();
  return banned.filter((w) => new RegExp(`(^|[^a-z])${escapeRegExp(w)}($|[^a-z])`).test(t));
}

// ---------- Context ----------

const cleanWord = (w) => w.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, '');

/**
 * Light keyword extraction: prefer a determiner + noun-ish run ("the review",
 * "my presentation"), otherwise the longest run of non-stopwords. Max 4 words after
 * the determiner. Returns '' if nothing useful is found.
 */
export function extractSituation(thought) {
  const tokens = sanitizeText(thought, TUNING.thoughtMaxChars).split(' ').filter(Boolean);
  const words = tokens.map(cleanWord);
  const lower = words.map((w) => w.toLowerCase().replace(/’/g, "'"));
  const endsClause = tokens.map((t) => /[.,;:!?)]$/.test(t));
  const isStop = (i) => !words[i] || STOPWORDS.includes(lower[i]);

  const runFrom = (start) => {
    const out = [];
    for (let j = start; j < words.length && out.length < 4; j++) {
      if (isStop(j) || DETERMINERS.includes(lower[j])) break;
      out.push(words[j]);
      if (endsClause[j]) break;
    }
    return out;
  };

  const withDet = [];
  const plain = [];
  for (let i = 0; i < words.length; i++) {
    if (DETERMINERS.includes(lower[i]) && !endsClause[i]) {
      const run = runFrom(i + 1);
      if (run.length) withDet.push([lower[i], ...run].join(' '));
    } else if (!isStop(i) && (i === 0 || isStop(i - 1) || endsClause[i - 1])) {
      const run = runFrom(i);
      if (run.length) plain.push(run.join(' '));
    }
  }
  const longest = (arr) => arr.reduce((best, p) => (p.length > best.length ? p : best), '');
  const pick = longest(withDet) || longest(plain);
  return pick.length >= 3 ? slotValue(pick) : '';
}

/**
 * Resolves the fight's context. Missing {situation} falls back to extraction from
 * the thought; {who} and {fear} stay empty. Self-harm language anywhere switches
 * on safe mode: no user text in taunts at all.
 */
export function buildContext({ situation = '', who = '', fear = '' } = {}, thought = '') {
  const t = sanitizeText(thought, TUNING.thoughtMaxChars);
  if (containsSelfHarm(t, situation, who, fear)) {
    return { thought: '', situation: '', who: '', fear: '', situationSource: 'none', safeMode: true };
  }
  const ctx = {
    thought: t,
    situation: slotValue(situation),
    who: slotValue(who),
    fear: slotValue(fear),
    situationSource: 'given',
    safeMode: false,
  };
  if (!ctx.situation) {
    ctx.situation = extractSituation(t);
    ctx.situationSource = ctx.situation ? 'extracted' : 'none';
  }
  return ctx;
}

function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Fills {slots}. Returns null if any slot the template needs is empty. */
export function fillTemplate(template, values) {
  let missing = false;
  const out = template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = values[key];
    if (!v) { missing = true; return ''; }
    return v;
  });
  return missing ? null : capitalise(out.replace(/\s+/g, ' ').trim());
}

/** First few words of a line, cut at a word boundary, for "yes-but" comebacks. */
export function fragmentOf(line, maxWords = TUNING.fragmentMaxWords, maxChars = TUNING.fragmentMaxChars) {
  const words = sanitizeText(line)
    .replace(/[‘’]/g, "'")
    .replace(/["“”]/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, maxWords);
  while (words.length > 1 && words.join(' ').length > maxChars) words.pop();
  let frag = words.join(' ');
  if (frag.length > maxChars) frag = frag.slice(0, maxChars);
  return frag.replace(/^'+/, '').replace(/['.,;:!?\s]+$/, '');
}

// ---------- Damage ----------

function bigrams(s) {
  const t = s.replace(/ /g, '');
  const out = new Map();
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

/** Dice coefficient (0..1) on character bigrams of the normalised strings. */
export function similarity(a, b) {
  const na = normalizeLine(a);
  const nb = normalizeLine(b);
  if (na === nb) return 1;
  const A = bigrams(na);
  const B = bigrams(nb);
  let sizeA = 0;
  let sizeB = 0;
  let overlap = 0;
  A.forEach((n) => { sizeA += n; });
  B.forEach((n, g) => {
    sizeB += n;
    overlap += Math.min(n, A.get(g) || 0);
  });
  if (sizeA + sizeB === 0) return 0;
  return (2 * overlap) / (sizeA + sizeB);
}

export function isRepeat(line, previous) {
  return previous.some((p) => similarity(line, p) >= DAMAGE.repeatSimilarity);
}

/** True when the line is (almost) nothing but an empty reassurance phrase. */
export function isEmptyPhrase(line) {
  const n = ` ${normalizeLine(line)} `;
  return VAGUE_PHRASES.some((phrase) => {
    const p = ` ${normalizeLine(phrase)} `;
    if (!n.includes(p)) return false;
    let rest = n;
    while (rest.includes(p)) rest = rest.replace(p, ' ');
    rest = rest.trim();
    return rest === '' || rest.split(' ').length < 3;
  });
}

function hasNumberOrDate(line) {
  if (/\d/.test(line)) return true;
  return normalizeLine(line).split(' ').some((w) => MONTHS_AND_DAYS.includes(w));
}

function hasSpecificWord(line) {
  const n = ` ${normalizeLine(line)} `;
  return SPECIFIC_WORDS.some((w) => n.includes(` ${w} `));
}

function hasProperNounMidSentence(line) {
  const tokens = String(line).trim().split(/\s+/);
  let sentenceStart = true;
  for (const raw of tokens) {
    const word = raw.replace(/^[^A-Za-z]+|[^A-Za-z']+$/g, '');
    if (word && !sentenceStart && /^[A-Z][a-z]/.test(word) && !NOT_PROPER_NOUNS.includes(word)) return true;
    if (word) sentenceStart = false;
    if (/[.!?]["')\]]*$/.test(raw)) sentenceStart = true;
  }
  return false;
}

/**
 * Deterministic damage for one typed line.
 * → { damage, base, bonus, verdict: 'hit' | 'vague' | 'repeat', reasons }
 */
export function computeDamage(line, previous = []) {
  const text = sanitizeText(line);
  if (isRepeat(text, previous)) return { damage: 0, base: 0, bonus: 0, verdict: 'repeat', reasons: [] };

  const base = Math.min(DAMAGE.baseCap, Math.floor(text.length / DAMAGE.charsPerPoint));
  const reasons = [];
  if (hasNumberOrDate(text)) reasons.push('number or date');
  if (hasSpecificWord(text)) reasons.push('grounding word');
  if (hasProperNounMidSentence(text)) reasons.push('a name or place');
  const bonus = Math.min(DAMAGE.bonusCap, reasons.length * DAMAGE.bonusEach);

  if (text.length < DAMAGE.vagueMinChars || isEmptyPhrase(text)) {
    return { damage: Math.min(DAMAGE.vagueMaxDamage, base + bonus), base, bonus, verdict: 'vague', reasons };
  }
  return { damage: base + bonus, base, bonus, verdict: 'hit', reasons };
}

// ---------- Comments ----------

function shuffledIndices(n, rng) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Draws the next item from a cycling, shuffled deck. Every item is used once per cycle. */
function draw(gen, key, items, rng, avoidText, toText = (x) => x) {
  if (!items.length) return null;
  let deck = gen.decks[key];
  if (!deck || deck.size !== items.length) deck = { order: [], pos: 0, size: items.length };
  if (deck.pos >= deck.order.length) {
    const order = shuffledIndices(items.length, rng);
    // Don't start a new cycle with the line we just said.
    if (order.length > 1 && toText(items[order[0]]) === avoidText) [order[0], order[1]] = [order[1], order[0]];
    deck = { order, pos: 0, size: items.length };
  }
  const item = items[deck.order[deck.pos]];
  gen.decks[key] = { ...deck, pos: deck.pos + 1 };
  return item;
}

export function createCommentState() {
  return { decks: {}, last: '', pendingComeback: null };
}

/** Which source a throw uses, before availability fallbacks. */
export function rollSource(rng, calm) {
  const mix = calm ? MIX.calm : MIX.normal;
  const r = rng.next();
  if (r < mix.template) return 'template';
  if (r < mix.template + mix.generic) return 'generic';
  return 'original';
}

function fillableTemplates(trap, ctx) {
  return trap.templates.map((t) => fillTemplate(t, ctx)).filter(Boolean);
}

/**
 * Picks anxiety's next comment.
 * → { gen, comment: { text, trap, trapId, source } }
 * Sources: 'comeback' (if queued) | 'template' | 'generic' | 'original'.
 * Never the same text twice in a row; every list cycles fully before reuse.
 */
export function nextComment(genIn, ctx, rng, { calm = false } = {}) {
  const gen = { ...genIn, decks: { ...genIn.decks } };
  const finish = (text, trap, trapId, source) => {
    gen.last = text;
    return { gen, comment: { text, trap, trapId, source } };
  };

  if (gen.pendingComeback && !ctx.safeMode) {
    const frag = gen.pendingComeback;
    gen.pendingComeback = null;
    const tpl = draw(gen, 'comeback', COMEBACK.lines, rng, gen.last, (t) => fillTemplate(t, { fragment: frag }));
    const text = fillTemplate(tpl, { fragment: frag });
    if (text && text !== gen.last) return finish(text, COMEBACK.label, 'yes-but', 'comeback');
  }
  gen.pendingComeback = null;

  let source = ctx.safeMode ? 'generic' : rollSource(rng, calm);
  // The original thought can't follow itself. Rather than dropping it (which would
  // skew the mix), owe it and throw it right after this one.
  if (gen.owedOriginal && !ctx.safeMode && ctx.thought && ctx.thought !== gen.last) {
    gen.owedOriginal = false;
    source = 'original';
  }

  if (source === 'original') {
    if (ctx.thought && ctx.thought !== gen.last) return finish(ctx.thought, ORIGINAL_TRAP_LABEL, 'original', 'original');
    if (ctx.thought) gen.owedOriginal = true;
    source = rollSource(rng, calm) === 'generic' ? 'generic' : 'template';
  }

  if (source === 'template') {
    const avail = TRAPS.map((trap) => ({ trap, lines: fillableTemplates(trap, ctx) })).filter((x) => x.lines.length);
    if (avail.length) {
      for (let tries = 0; tries < 4; tries++) {
        const pick = draw(gen, `traps:t:${avail.map((x) => x.trap.id).join(',')}`, avail, rng, null);
        const text = draw(gen, `t:${pick.trap.id}:${pick.lines.length}`, pick.lines, rng, gen.last);
        if (text !== gen.last) return finish(text, pick.trap.label, pick.trap.id, 'template');
      }
    }
    source = 'generic';
  }

  const traps = TRAPS.filter((t) => t.generic.length);
  for (let tries = 0; tries < 4; tries++) {
    const trap = draw(gen, 'traps:g', traps, rng, null);
    const text = draw(gen, `g:${trap.id}`, trap.generic, rng, gen.last);
    if (text !== gen.last) return finish(text, trap.label, trap.id, 'generic');
  }
  // Unreachable with the shipped lists (many distinct lines), kept as a guard.
  return finish(traps[0].generic[0], traps[0].label, traps[0].id, 'generic');
}

/**
 * After the player lands a line: maybe queue a "yes-but" comeback quoting it.
 * Never in safe mode, never quoting self-harm language.
 */
export function maybeQueueComeback(gen, line, ctx, rng) {
  const roll = rng.next();
  if (ctx.safeMode || containsSelfHarm(line)) return gen;
  if (roll >= TUNING.comebackChance) return gen;
  const frag = fragmentOf(line);
  return frag ? { ...gen, pendingComeback: frag } : gen;
}

// ---------- Timing ----------

export function throwDelay(rng, calm) {
  const [a, b] = calm ? TUNING.throwDelayCalmMs : TUNING.throwDelayMs;
  return Math.round(rng.range(a, b));
}

export function travelTime({ width = 375, calm = false, reducedMotion = false } = {}) {
  const base = width >= TUNING.desktopMinWidth ? TUNING.travelDesktopMs : TUNING.travelMobileMs;
  return Math.round(base * (calm || reducedMotion ? TUNING.slowTravelFactor : 1));
}

/** 0 at launch, 1 when it reaches the player. */
export function projectileProgress(launchedAt, now, travel) {
  return Math.max(0, Math.min(1, (now - launchedAt) / travel));
}

// ---------- Fight state ----------

export function startingAnxietyHp(strength) {
  const s = Math.max(0, Math.min(100, Number(strength) || 0));
  return Math.round(TUNING.anxietyHpMin + ((TUNING.anxietyHpMax - TUNING.anxietyHpMin) * s) / 100);
}

export function createFight(strength) {
  const hp = startingAnxietyHp(strength);
  return {
    round: 1,
    roundTimeLeftMs: TUNING.roundSeconds * 1000,
    playerHp: TUNING.playerHp,
    anxietyHp: hp,
    anxietyMax: hp,
    anxietyStart: hp,
    streak: 0,
    bestStreak: 0,
    score: 0,
    parries: 0,
    partials: 0,
    hitsTaken: 0,
    knockdowns: 0,
    breathCycles: 0,
    used: [],
    finisherReady: false,
    finisherUsed: false,
    log: [], // { kind: 'attack'|'block'|'finisher', move, line, damage, verdict, outcome?, trap? }
    lastActivityAt: 0,
    lastRegenAt: 0,
    down: false,
    ended: null, // null | 'ko' | 'timeout'
  };
}

function landed(f, moveId) {
  const used = f.used.includes(moveId) ? f.used : [...f.used, moveId];
  const unlocked = MOVES.every((m) => used.includes(m.id));
  return {
    used,
    finisherReady: f.finisherReady || (unlocked && !f.finisherUsed),
    justUnlocked: unlocked && !f.finisherReady && !f.finisherUsed,
  };
}

function damageAnxiety(f, dmg) {
  const anxietyHp = Math.max(0, f.anxietyHp - dmg);
  return { anxietyHp, score: f.score + Math.min(dmg, f.anxietyHp), ended: anxietyHp <= 0 ? 'ko' : f.ended };
}

function previousLines(f) {
  return f.log.filter((l) => l.kind !== 'finisher').map((l) => l.line);
}

/** Records a combo landing. Only solid hits and parries count. */
export function trackCombo(used, moveId, verdict) {
  const next = new Set(used);
  if (verdict === 'hit' || verdict === 'parry') next.add(moveId);
  return { used: next, unlocked: MOVES.every((m) => next.has(m.id)) };
}

/** A typed attack while nothing is incoming. */
export function applyAttack(f, moveId, line, now = 0) {
  const text = sanitizeText(line);
  const res = computeDamage(text, previousLines(f));
  if (res.verdict === 'repeat') {
    return { fight: { ...f, lastActivityAt: now }, result: res, justUnlocked: false };
  }
  const solid = res.verdict === 'hit';
  const combo = solid ? landed(f, moveId) : { used: f.used, finisherReady: f.finisherReady, justUnlocked: false };
  const streak = solid ? f.streak + 1 : f.streak;
  const fight = {
    ...f,
    ...damageAnxiety(f, res.damage),
    used: combo.used,
    finisherReady: combo.finisherReady,
    streak,
    bestStreak: Math.max(f.bestStreak, streak),
    lastActivityAt: now,
    log: [...f.log, { kind: 'attack', move: moveId, line: text, damage: res.damage, verdict: res.verdict }],
  };
  return { fight, result: res, justUnlocked: combo.justUnlocked };
}

export function commentHitDamage(rng) {
  const [a, b] = TUNING.commentHitMs;
  return rng.int(a, b);
}

/** Classifies a counter typed while a comment is incoming. */
export function blockOutcome(res, rng) {
  if (res.verdict === 'hit' && res.damage >= TUNING.parryAt) {
    return { kind: 'parry', anxietyDamage: res.damage, playerDamage: 0 };
  }
  if (res.verdict === 'hit' && res.damage >= TUNING.partialAt) {
    return { kind: 'partial', anxietyDamage: 0, playerDamage: Math.ceil(commentHitDamage(rng) / 2) };
  }
  return { kind: 'hit', anxietyDamage: 0, playerDamage: commentHitDamage(rng) };
}

function hurtPlayer(f, dmg) {
  const playerHp = Math.max(0, f.playerHp - dmg);
  const knockedDown = playerHp <= 0 && !f.down;
  return {
    playerHp,
    hitsTaken: f.hitsTaken + (dmg > 0 ? 1 : 0),
    streak: 0,
    down: playerHp <= 0,
    knockdowns: f.knockdowns + (knockedDown ? 1 : 0),
  };
}

/** A counter typed while a comment is in the air. */
export function applyBlock(f, moveId, line, comment, rng, now = 0) {
  const text = sanitizeText(line);
  const res = computeDamage(text, previousLines(f));
  const outcome = blockOutcome(res, rng);
  let next = { ...f, lastActivityAt: now };
  let justUnlocked = false;
  if (outcome.kind === 'parry') {
    const combo = landed(f, moveId);
    const streak = f.streak + 1;
    justUnlocked = combo.justUnlocked;
    next = {
      ...next,
      ...damageAnxiety(f, outcome.anxietyDamage),
      used: combo.used,
      finisherReady: combo.finisherReady,
      streak,
      bestStreak: Math.max(f.bestStreak, streak),
      parries: f.parries + 1,
    };
  } else {
    next = { ...next, ...hurtPlayer(f, outcome.playerDamage) };
    if (outcome.kind === 'partial') next.partials = f.partials + 1;
  }
  if (res.verdict !== 'repeat') {
    next.log = [...f.log, {
      kind: 'block', move: moveId, line: text, damage: outcome.anxietyDamage, verdict: res.verdict,
      outcome: outcome.kind, trap: comment.trap,
    }];
  }
  return { fight: next, result: res, outcome, justUnlocked };
}

/** A comment reached the player unanswered. */
export function applyCommentHit(f, rng) {
  const dmg = commentHitDamage(rng);
  return { fight: { ...f, ...hurtPlayer(f, dmg) }, damage: dmg };
}

export function applyFinisher(f) {
  if (!f.finisherReady || f.finisherUsed) return { fight: f, damage: 0 };
  const dmg = TUNING.finisherDamage;
  return {
    fight: {
      ...f,
      ...damageAnxiety(f, dmg),
      finisherReady: false,
      finisherUsed: true,
      log: [...f.log, { kind: 'finisher', move: 'finisher', line: 'FULL FLIP', damage: dmg, verdict: 'finisher' }],
    },
    damage: dmg,
  };
}

/**
 * Knockdown recovery. `how` is 'breathe' | 'skip' | 'off' and deliberately has no
 * effect on the result: no penalty for skipping, no reward for breathing.
 */
// eslint-disable-next-line no-unused-vars
export function recover(f, how) {
  return {
    ...f,
    down: false,
    playerHp: TUNING.recoverPlayerHp,
    anxietyHp: Math.max(1, f.anxietyHp - TUNING.recoverAnxietyLoss),
  };
}

/** Idle regen: +1 HP once `regenEveryMs` has passed since the later of activity and last regen. */
export function regenTick(f, now) {
  const since = Math.max(f.lastActivityAt, f.lastRegenAt);
  if (now - since < TUNING.regenEveryMs || f.anxietyHp >= f.anxietyMax || f.anxietyHp <= 0) {
    return { fight: f, grew: false };
  }
  return {
    fight: { ...f, anxietyHp: Math.min(f.anxietyMax, f.anxietyHp + TUNING.regenAmount), lastRegenAt: now },
    grew: true,
  };
}

/** Counts down the round clock. `roundOver` once it hits zero. */
export function tickRound(f, dtMs) {
  const roundTimeLeftMs = Math.max(0, f.roundTimeLeftMs - dtMs);
  return { fight: { ...f, roundTimeLeftMs }, roundOver: roundTimeLeftMs <= 0 && !f.ended };
}

/** Moves to the next round (HP carries over) or ends the fight after the last one. */
export function endRound(f) {
  if (f.ended) return f;
  if (f.round >= TUNING.rounds) return { ...f, ended: 'timeout' };
  return { ...f, round: f.round + 1, roundTimeLeftMs: TUNING.roundSeconds * 1000 };
}

export function strongestLine(f) {
  return f.log
    .filter((l) => (l.kind === 'attack' && l.verdict === 'hit') || (l.kind === 'block' && l.outcome === 'parry'))
    .reduce((best, l) => (!best || l.damage > best.damage ? l : best), null);
}

/** Thinking traps the player blocked (parried or partially blocked) most, best first. */
export function topBlockedTraps(f, n = 2) {
  const counts = new Map();
  f.log.forEach((l) => {
    if (l.kind === 'block' && (l.outcome === 'parry' || l.outcome === 'partial')) {
      counts.set(l.trap, (counts.get(l.trap) || 0) + 1);
    }
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([trap, count]) => ({ trap, count }));
}

/** 0..1 visual size for anxiety, relative to the strongest possible start. */
export function anxietySize(hp) {
  return Math.max(0, Math.min(1, hp / TUNING.anxietyHpMax));
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
