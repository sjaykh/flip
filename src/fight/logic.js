// Fight mode game logic. Pure functions only: no DOM, no timers, no randomness.
import {
  DAMAGE, VAGUE_PHRASES, SPECIFIC_WORDS, MONTHS_AND_DAYS, NOT_PROPER_NOUNS,
  MAX_HP, MIN_START_HP, TIMING, MOVES, TAUNTS, FINISHER_DAMAGE, BREATHER_HEAL,
} from './constants.js';

export function normalizeLine(s) {
  return String(s)
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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
  const words = normalizeLine(line).split(' ');
  return words.some((w) => MONTHS_AND_DAYS.includes(w));
}

function hasSpecificWord(line) {
  const n = ` ${normalizeLine(line)} `;
  return SPECIFIC_WORDS.some((w) => n.includes(` ${w} `));
}

/** A capitalised word that isn't the first word of a sentence (and isn't "I"). */
function hasProperNounMidSentence(line) {
  const tokens = String(line).trim().split(/\s+/);
  let sentenceStart = true;
  for (const raw of tokens) {
    const word = raw.replace(/^[^A-Za-z]+|[^A-Za-z']+$/g, '');
    if (word && !sentenceStart && /^[A-Z][a-z]/.test(word) && !NOT_PROPER_NOUNS.includes(word)) {
      return true;
    }
    if (word) sentenceStart = false;
    if (/[.!?]["')\]]*$/.test(raw)) sentenceStart = true;
  }
  return false;
}

/**
 * Deterministic damage for one typed line.
 * Returns { damage, base, bonus, verdict: 'hit' | 'vague' | 'repeat', reasons: string[] }.
 */
export function computeDamage(line, previous = []) {
  const text = String(line).trim();
  if (isRepeat(text, previous)) {
    return { damage: 0, base: 0, bonus: 0, verdict: 'repeat', reasons: [] };
  }

  const base = Math.min(DAMAGE.baseCap, Math.floor(text.length / DAMAGE.charsPerPoint));
  const reasons = [];
  if (hasNumberOrDate(text)) reasons.push('number or date');
  if (hasSpecificWord(text)) reasons.push('grounding word');
  if (hasProperNounMidSentence(text)) reasons.push('a name or place');
  const bonus = Math.min(DAMAGE.bonusCap, reasons.length * DAMAGE.bonusEach);

  if (text.length < DAMAGE.vagueMinChars || isEmptyPhrase(text)) {
    return {
      damage: Math.min(DAMAGE.vagueMaxDamage, base + bonus),
      base, bonus, verdict: 'vague', reasons,
    };
  }
  return { damage: base + bonus, base, bonus, verdict: 'hit', reasons };
}

export function startingHp(strength) {
  const s = Math.round(Number(strength) || 0);
  return Math.max(MIN_START_HP, Math.min(MAX_HP, s));
}

export function applyDamage(hp, damage) {
  return Math.max(0, hp - Math.max(0, damage));
}

export function afterBreather(hp) {
  return Math.max(1, hp - BREATHER_HEAL);
}

/**
 * Idle growth. Anxiety gains `amount` once `stepMs` has passed since the later of
 * the player's last activity and the last growth. `maxed` means it has hit max HP
 * and the breathing break should start.
 */
export function idleGrowth({ hp, lastActivityAt, lastGrowthAt }, now, opts = {}) {
  const stepMs = opts.stepMs ?? TIMING.idleGrowthMs;
  const amount = opts.amount ?? TIMING.idleGrowthAmount;
  const max = opts.max ?? MAX_HP;
  const since = Math.max(lastActivityAt, lastGrowthAt);
  if (now - since < stepMs) return { hp, lastGrowthAt, grew: false, maxed: false };
  const next = Math.min(max, hp + amount);
  return { hp: next, lastGrowthAt: now, grew: true, maxed: next >= max };
}

/** Records a move as landed. Only real hits count towards the combo. */
export function trackCombo(used, moveId, verdict) {
  const next = new Set(used);
  if (verdict === 'hit') next.add(moveId);
  return { used: next, unlocked: MOVES.every((m) => next.has(m.id)) };
}

export function finisherDamage() {
  return FINISHER_DAMAGE;
}

/** Alternates the user's own thought with generic distortion lines. */
export function tauntAt(index, thought, lines = TAUNTS) {
  if (index % 2 === 0) return thought;
  return lines[Math.floor(index / 2) % lines.length];
}

/** Visual size/darkness for the opponent at a given HP (0..1 each). */
export function blobLook(hp) {
  const t = Math.max(0, Math.min(1, hp / MAX_HP));
  return { scale: 0.45 + 0.7 * t, darkness: t };
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
