// Fight mode game logic. Pure functions only: no DOM, no timers, no Math.random.
// Randomness comes from a seedable RNG passed in, so tests are deterministic.
// Functions that take a state object return a new one and never mutate their input.
import {
  TUNING, PACING, DAMAGE, MIX, MOVES, TRAPS, COMEBACK, ORIGINAL_TRAP_LABEL, COPY,
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
 * (including the Round 0 evidence) switches on safe mode: no user text in taunts at all.
 */
export function buildContext({ situation = '', who = '', fear = '', evidence = '', otherEmotion = '' } = {}, thought = '') {
  const t = sanitizeText(thought, TUNING.thoughtMaxChars);
  if (containsSelfHarm(t, situation, who, fear, evidence, otherEmotion)) {
    return { thought: '', situation: '', who: '', fear: '', situationSource: 'none', safeMode: true };
  }
  const ctx = {
    thought: t,
    situation: slotValue(situation),
    who: slotValue(who),
    // "that I'm not good enough" → "I'm not good enough", so it reads in the opponent's mouth.
    fear: slotValue(fear).replace(/^that\s+/i, ''),
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
  if (missing) return null;
  return capitalise(out.replace(/\s+/g, ' ').trim()).replace(/([.!?]\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase());
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

// ---------- Setup (thought-record order) ----------

export const SETUP_STEPS = ['situation', 'feelings', 'thought', 'fear', 'who', 'belief', 'settings', 'evidence'];
const OPTIONAL_STEPS = ['situation', 'fear', 'who'];

/** Whether a setup step can be skipped. Round 0 evidence never can. */
export function canSkip(step) {
  return OPTIONAL_STEPS.includes(step);
}

/** Whether the player may continue from a setup step with the values given. */
export function setupGate(step, v = {}) {
  switch (step) {
    case 'situation':
    case 'fear':
    case 'who':
    case 'belief':
    case 'settings':
      return true;
    case 'feelings': {
      const list = v.emotions || [];
      if (!list.length) return false;
      return !list.includes('other') || slotValue(v.otherEmotion, TUNING.otherEmotionMaxChars).length > 0;
    }
    case 'thought':
      return sanitizeText(v.thought, TUNING.thoughtMaxChars).length >= TUNING.thoughtMinChars;
    case 'evidence':
      return sanitizeText(v.evidence).length >= TUNING.evidenceMinChars;
    default:
      return false;
  }
}

// ---------- Moves ----------

/** Initial move layout: all moves on desktop, the first N on mobile with the rest queued. */
export function initialMoves(desktop) {
  const ids = MOVES.map((m) => m.id);
  const n = desktop ? ids.length : TUNING.visibleMovesMobile;
  return { visible: ids.slice(0, n), queue: ids.slice(n) };
}

/** After a move is used, rotate it out for the next queued one (mobile shows 4 of 6). */
export function rotateMoves(layout, usedId) {
  const i = layout.visible.indexOf(usedId);
  if (i < 0 || !layout.queue.length) return layout;
  const visible = layout.visible.slice();
  visible[i] = layout.queue[0];
  return { visible, queue: [...layout.queue.slice(1), usedId] };
}

// ---------- Timing ----------

export function throwGap(calm) {
  return calm ? PACING.throwGapCalmMs : PACING.throwGapMs;
}

/** Idle travel time. Reduced motion uses the Calm pace values. */
export function travelTime({ width = 375, calm = false, reducedMotion = false } = {}) {
  const desktop = width >= PACING.desktopMinWidth;
  if (calm || reducedMotion) return desktop ? PACING.travelCalmDesktopMs : PACING.travelCalmMobileMs;
  return desktop ? PACING.travelDesktopMs : PACING.travelMobileMs;
}

// ---------- Fight state ----------

export function startingGrip(belief) {
  const b = Math.max(0, Math.min(100, Number(belief) || 0));
  return Math.round(TUNING.gripMin + ((TUNING.gripMax - TUNING.gripMin) * b) / 100);
}

/**
 * A fight. `clock` is the fight's own time in ms; the UI advances it with tick()
 * (nothing advances while paused). All timers below are derived from it.
 */
export function createFight({ belief = 50, intensity = 50 } = {}) {
  const grip = startingGrip(belief);
  return {
    phase: 'round0', // round0 | fight | down | between | ended
    round: 0,
    roundTimeLeftMs: TUNING.roundSeconds * 1000,
    clock: 0,
    playerHp: TUNING.playerHp,
    grip,
    gripMax: grip,
    gripStart: grip,
    intensity: Math.max(0, Math.min(100, Number(intensity) || 0)),
    streak: 0,
    bestStreak: 0,
    parries: 0,
    partials: 0,
    hitsTaken: 0,
    knockdowns: 0,
    breathCycles: 0,
    movesUsed: [],
    log: [], // { kind: 'attack'|'block', move, line, damage, verdict, outcome?, trap? }
    evidence: '',
    balanced: '',
    balancedBelief: null,
    finisherReady: false,
    down: false,
    ended: null, // null | 'ko' | 'timeout'
    focus: { active: false, lastKeyAt: 0 },
    projectile: null, // { comment, progress, travel }
    throwTimer: Infinity,
    windupShown: false,
    regenAccum: 0,
  };
}

/** Visual-only ANXIETY meter: starts at the felt intensity and drops in proportion to GRIP lost. */
export function emotionMeter(f) {
  return Math.round((f.intensity * f.grip) / f.gripStart);
}

/** Round 0: the thought lands its strongest evidence. Required; fixed opening hit. */
export function applyEvidence(f, text) {
  const evidence = sanitizeText(text);
  if (!setupGate('evidence', { evidence })) return { fight: f, ok: false };
  return {
    fight: { ...f, evidence, playerHp: Math.max(0, f.playerHp - TUNING.openingHitDamage), round: 1 },
    ok: true,
  };
}

/** Starts (or restarts after a break) live fighting: the next throw comes after the gap. */
export function startFighting(f, calm) {
  return { ...f, phase: 'fight', throwTimer: throwGap(calm), windupShown: false, regenAccum: 0 };
}

/** Focusing the input or typing a character: enter (or extend) focus mode. */
export function focusKey(f) {
  if (f.phase !== 'fight') return { fight: f, entered: false };
  const entered = !f.focus.active;
  return { fight: { ...f, focus: { active: true, lastKeyAt: f.clock }, regenAccum: 0 }, entered };
}

/** Leaves focus mode (on submit, or the 8 s idle timeout inside tick). */
export function exitFocus(f) {
  return f.focus.active ? { ...f, focus: { ...f.focus, active: false } } : f;
}

/**
 * Advances the fight by `dt` ms of fight time.
 * → { fight, events } with events from: 'focusExit', 'regen', 'windup', 'throw', 'land', 'roundOver'.
 * Focus mode pauses the round clock, regen and new throws, and slows an incoming
 * comment to 10% (frozen with Calm pace), capped short of the player.
 */
export function tick(fIn, dt, { calm = false } = {}) {
  if (fIn.phase !== 'fight') return { fight: fIn, events: [] };
  const f = { ...fIn, clock: fIn.clock + dt, focus: { ...fIn.focus } };
  const events = [];

  if (f.focus.active && f.clock - f.focus.lastKeyAt >= PACING.focusIdleExitMs) {
    f.focus.active = false;
    events.push('focusExit');
  }
  const live = f.focus.active ? 0 : dt; // non-focus time

  f.roundTimeLeftMs = Math.max(0, f.roundTimeLeftMs - live);

  if (!f.focus.active) {
    f.regenAccum += dt;
    while (f.regenAccum >= TUNING.regenEveryMs) {
      f.regenAccum -= TUNING.regenEveryMs;
      if (f.grip < f.gripMax && f.grip > 0) {
        f.grip = Math.min(f.gripMax, f.grip + TUNING.regenAmount);
        events.push('regen');
      }
    }
  }

  if (f.projectile) {
    const speed = f.focus.active ? (calm ? PACING.focusSpeedCalm : PACING.focusSpeed) : 1;
    let progress = f.projectile.progress + (dt * speed) / f.projectile.travel;
    if (f.focus.active) progress = Math.min(progress, Math.max(f.projectile.progress, PACING.focusCap));
    progress = Math.min(1, progress);
    f.projectile = { ...f.projectile, progress };
    if (progress >= 1 && !f.focus.active) events.push('land');
  } else if (Number.isFinite(f.throwTimer)) {
    f.throwTimer -= live;
    if (f.throwTimer <= PACING.windupMs && !f.windupShown) {
      f.windupShown = true;
      events.push('windup');
    }
    if (f.throwTimer <= 0) {
      f.throwTimer = Infinity; // the UI launches the comment, then nothing else is scheduled
      events.push('throw');
    }
  }

  if (f.roundTimeLeftMs <= 0 && !f.focus.active && !f.ended) events.push('roundOver');
  return { fight: f, events };
}

/** Puts a comment in the air. There is never more than one. */
export function launchComment(f, comment, travel) {
  if (f.projectile) return f;
  return { ...f, projectile: { comment, progress: 0, travel }, throwTimer: Infinity };
}

function afterResolve(f, calm) {
  return { ...f, projectile: null, throwTimer: throwGap(calm), windupShown: false };
}

function previousLines(f) {
  return f.log.map((l) => l.line);
}

function lowerGrip(f, dmg) {
  const grip = Math.max(Math.min(f.grip, TUNING.gripFloor), f.grip - dmg);
  const finisherReady = f.finisherReady || grip <= f.gripMax * TUNING.finisherAtFraction;
  return { grip, finisherReady, justUnlocked: finisherReady && !f.finisherReady };
}

/** Damage for a line, including the first-use variety bonus for its move. */
export function scoreLine(f, moveId, line) {
  const res = computeDamage(line, previousLines(f));
  if (res.verdict === 'hit' && !f.movesUsed.includes(moveId)) {
    return { ...res, damage: res.damage + TUNING.varietyBonus, variety: TUNING.varietyBonus };
  }
  return { ...res, variety: 0 };
}

/** A typed answer while nothing is incoming. Never takes GRIP below 1. */
export function applyAttack(f, moveId, line) {
  const text = sanitizeText(line);
  const res = scoreLine(f, moveId, text);
  const base = { ...exitFocus(f), regenAccum: 0 };
  if (res.verdict === 'repeat') return { fight: base, result: res, justUnlocked: false };
  const solid = res.verdict === 'hit';
  const g = lowerGrip(f, res.damage);
  const streak = solid ? f.streak + 1 : f.streak;
  return {
    fight: {
      ...base,
      grip: g.grip,
      finisherReady: g.finisherReady,
      streak,
      bestStreak: Math.max(f.bestStreak, streak),
      movesUsed: solid && !f.movesUsed.includes(moveId) ? [...f.movesUsed, moveId] : f.movesUsed,
      log: [...f.log, { kind: 'attack', move: moveId, line: text, damage: f.grip - g.grip, verdict: res.verdict }],
    },
    result: res,
    justUnlocked: g.justUnlocked,
  };
}

export function commentHitDamage(rng) {
  const [a, b] = TUNING.commentHit;
  return rng.int(a, b);
}

/** Classifies a counter typed while a comment is incoming. */
export function blockOutcome(res, rng) {
  if (res.verdict === 'hit' && res.damage >= TUNING.parryAt) return { kind: 'parry', gripDamage: res.damage, playerDamage: 0 };
  if (res.verdict === 'hit' && res.damage >= TUNING.partialAt) {
    return { kind: 'partial', gripDamage: 0, playerDamage: Math.ceil(commentHitDamage(rng) / 2) };
  }
  return { kind: 'hit', gripDamage: 0, playerDamage: commentHitDamage(rng) };
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
    phase: playerHp <= 0 ? 'down' : f.phase,
  };
}

/** A counter typed while a comment is in the air. */
export function applyBlock(f, moveId, line, rng, { calm = false } = {}) {
  const text = sanitizeText(line);
  const comment = f.projectile ? f.projectile.comment : { trap: '' };
  const res = scoreLine(f, moveId, text);
  const outcome = blockOutcome(res, rng);
  let next = afterResolve({ ...exitFocus(f), regenAccum: 0 }, calm);
  let justUnlocked = false;
  let gripDamage = 0;
  if (outcome.kind === 'parry') {
    const g = lowerGrip(f, outcome.gripDamage);
    gripDamage = f.grip - g.grip;
    justUnlocked = g.justUnlocked;
    const streak = f.streak + 1;
    next = {
      ...next,
      grip: g.grip,
      finisherReady: g.finisherReady,
      streak,
      bestStreak: Math.max(f.bestStreak, streak),
      parries: f.parries + 1,
      movesUsed: f.movesUsed.includes(moveId) ? f.movesUsed : [...f.movesUsed, moveId],
    };
  } else {
    next = { ...next, ...hurtPlayer(f, outcome.playerDamage) };
    if (outcome.kind === 'partial') next.partials = f.partials + 1;
  }
  if (res.verdict !== 'repeat') {
    next.log = [...f.log, {
      kind: 'block', move: moveId, line: text, damage: gripDamage, verdict: res.verdict,
      outcome: outcome.kind, trap: comment.trap,
    }];
  }
  return { fight: next, result: res, outcome: { ...outcome, gripDamage }, justUnlocked };
}

/** A comment reached the player unanswered. */
export function applyCommentHit(f, rng, { calm = false } = {}) {
  const dmg = commentHitDamage(rng);
  return { fight: { ...afterResolve(f, calm), ...hurtPlayer(f, dmg) }, damage: dmg };
}

/**
 * The finisher. Only a balanced thought can K.O., and only once GRIP is at or below
 * 25%. After round 3 (timeout) it can still be written, but it doesn't K.O.
 */
export function applyBalancedThought(f, text) {
  const balanced = sanitizeText(text, TUNING.lineMaxChars);
  if (balanced.length < TUNING.balancedMinChars) return { fight: f, ok: false };
  if (f.ended === 'timeout') return { fight: { ...f, balanced }, ok: true };
  if (!f.finisherReady || f.ended) return { fight: f, ok: false };
  return { fight: { ...exitFocus(f), balanced, grip: 0, ended: 'ko', phase: 'ended', projectile: null }, ok: true };
}

export function setBalancedBelief(f, n) {
  return { ...f, balancedBelief: Math.max(0, Math.min(100, Math.round(Number(n) || 0))) };
}

/**
 * Knockdown recovery. `how` is 'breathe' | 'skip' | 'off' and deliberately has no
 * effect on the result: no penalty for skipping, no reward for breathing.
 */
// eslint-disable-next-line no-unused-vars
export function recover(f, how) {
  const g = lowerGrip(f, TUNING.recoverGripLoss);
  return {
    ...f,
    down: false,
    phase: 'down',
    playerHp: TUNING.recoverPlayerHp,
    grip: g.grip,
    finisherReady: g.finisherReady,
    projectile: null,
  };
}

/** Moves to the next round (HP and GRIP carry over) or ends the fight after the last one. */
export function endRound(f) {
  if (f.ended) return f;
  const base = { ...exitFocus(f), projectile: null, throwTimer: Infinity, windupShown: false };
  if (f.round >= TUNING.rounds) return { ...base, ended: 'timeout', phase: 'ended' };
  return { ...base, round: f.round + 1, roundTimeLeftMs: TUNING.roundSeconds * 1000, phase: 'between' };
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

/** 0..1 visual size for the opponent, relative to the strongest possible start. */
export function opponentSize(grip) {
  return Math.max(0, Math.min(1, grip / TUNING.gripMax));
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// ---------- Results (pure, so the card, .md and .txt share one order) ----------

/** The best action line: the strongest Action Uppercut, if one was used. */
export function bestAction(f) {
  return f.log
    .filter((l) => l.move === 'uppercut' && l.verdict === 'hit')
    .reduce((best, l) => (!best || l.damage > best.damage ? l : best), null);
}

/**
 * Ordered result sections. Outcomes (ratings, balanced thought, feeling) always
 * come before game stats.
 */
export function resultSections(d) {
  const sections = [];
  const ctxRows = [];
  if (d.situation) ctxRows.push(['Situation', d.situation]);
  ctxRows.push(['Thought', d.thought]);
  if (d.fear) ctxRows.push(['Hot thought', d.fear]);
  if (d.who) ctxRows.push(['Who', d.who]);
  sections.push({ id: 'context', title: 'The situation and the thought', rows: ctxRows });
  sections.push({
    id: 'emotion', title: `Feeling (${d.emotions.join(', ')})`, bar: { before: d.intensityBefore, after: d.intensityAfter },
  });
  sections.push({ id: 'belief', title: 'Belief in the original thought', bar: { before: d.beliefBefore, after: d.beliefAfter } });
  sections.push({
    id: 'balanced',
    title: 'The balanced thought',
    text: d.balanced || 'Not written this time.',
    rows: d.balanced && d.balancedBelief !== null ? [['Belief in it', `${d.balancedBelief}/100`]] : [],
  });
  sections.push({ id: 'feeling', title: 'Overall', rows: [['How I feel', d.feeling]] });
  const stats = [
    ['Ended', d.ending],
    ['Fight time', formatDuration(d.fightMs)],
    ['Parries', String(d.parries)],
    ['Knockdowns', String(d.knockdowns)],
    ['Best streak', String(d.bestStreak)],
    ['Traps blocked most', d.traps.length ? d.traps.map((t) => `${t.trap} (${t.count})`).join(', ') : 'None this time'],
  ];
  if (d.breathCycles > 0) stats.push(['Breaths taken', String(d.breathCycles)]);
  sections.push({ id: 'stats', title: 'The fight', rows: stats });
  sections.push({ id: 'lines', title: 'Your counter-arguments', evidence: d.evidence, groups: d.groups });
  return sections;
}

export function copingCard(d) {
  return [
    ['Hot thought', d.fear || d.thought],
    ['Balanced thought', d.balanced || '—'],
    ['Best counter', d.bestCounter || '—'],
    ['One action', d.action || '—'],
  ];
}

function textBar(v) {
  const filled = Math.round(v / 5);
  return '█'.repeat(filled) + '░'.repeat(20 - filled);
}

/** Markdown export, in the same order as the result card. */
export function buildResultMarkdown(d, footer) {
  const out = [`# Flip · Fight — ${d.date}`, ''];
  resultSections(d).forEach((s) => {
    out.push(`## ${s.title}`, '');
    if (s.text) out.push(s.text, '');
    if (s.bar) {
      out.push(`**${s.bar.before} → ${s.bar.after}**`, '', '```',
        `Before ${textBar(s.bar.before)} ${s.bar.before}`, `After  ${textBar(s.bar.after)} ${s.bar.after}`, '```', '');
    }
    if (s.rows && s.rows.length) { s.rows.forEach(([k, v]) => out.push(`- **${k}:** ${v}`)); out.push(''); }
    if (s.id === 'lines') {
      if (s.evidence) out.push(`### ${COPY.evidenceSection}`, '', `- ${s.evidence}`, '');
      s.groups.forEach((g) => {
        out.push(`### ${g.title}`, '');
        g.lines.forEach((l) => out.push(`- ${l.text} _(${l.meta})_`));
        out.push('');
      });
    }
  });
  out.push('## Coping card', '', `_${COPY.copingIntro}_`, '');
  copingCard(d).forEach(([k, v]) => out.push(`- **${k}:** ${v}`));
  out.push('', '---', '', `_${COPY.closing}_`, '', `_${footer}_`, '');
  return out.join('\n');
}

/** Plain-text export, in the same order as the result card. */
export function buildResultText(d, footer) {
  const rule = (t, ch) => ch.repeat(Math.max(t.length, 4));
  const out = ['FLIP · FIGHT', d.date, rule(d.date, '='), ''];
  resultSections(d).forEach((s) => {
    const h = s.title.toUpperCase();
    out.push(h, rule(h, '-'));
    if (s.text) out.push(s.text);
    if (s.bar) out.push(`${s.bar.before} -> ${s.bar.after}`, `Before ${textBar(s.bar.before)} ${s.bar.before}`, `After  ${textBar(s.bar.after)} ${s.bar.after}`);
    if (s.rows) s.rows.forEach(([k, v]) => out.push(`${k}: ${v}`));
    if (s.id === 'lines') {
      if (s.evidence) out.push(`${COPY.evidenceSection}:`, `  * ${s.evidence}`);
      s.groups.forEach((g) => {
        out.push(`${g.title}:`);
        g.lines.forEach((l) => out.push(`  * ${l.text} (${l.meta.replace(/−/g, '-')})`));
      });
    }
    out.push('');
  });
  out.push('COPING CARD', '-----------', COPY.copingIntro);
  copingCard(d).forEach(([k, v]) => out.push(`${k}: ${v}`));
  out.push('', '--', COPY.closing, footer, '');
  return out.join('\n');
}
