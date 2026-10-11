// All Fight mode copy, phrase lists and tuning numbers live here.
// Plain data only — imported by logic.js (and its tests) and inlined by build.mjs.

export const MAX_HP = 100;
export const MIN_START_HP = 10;

export const TIMING = {
  idleGrowthMs: 3000,     // anxiety grows +1 after this long with no activity, then every this long
  idleGrowthAmount: 1,
  tickMs: 250,
  tauntMs: 6000,
  bannerMs: 900,
  breathPhaseMs: 4000,    // box breathing: 4 in / 4 hold / 4 out / 4 hold
  breathCycles: 2,
};

export const BREATHER_HEAL = 15;      // HP anxiety loses after a breathing break
export const FINISHER_DAMAGE = 25;

export const DAMAGE = {
  charsPerPoint: 4,
  baseCap: 15,
  bonusEach: 5,
  bonusCap: 15,
  vagueMaxDamage: 3,
  vagueMinChars: 25,
  repeatSimilarity: 0.85, // Dice coefficient on character bigrams
};

export const MOVES = [
  {
    id: 'jab',
    name: 'Evidence Jab',
    short: 'Jab',
    prompt: 'A fact that goes against the thought',
  },
  {
    id: 'kick',
    name: 'Flip Kick',
    short: 'Kick',
    prompt: 'The absurdly good version',
  },
  {
    id: 'check',
    name: 'Reality Check',
    short: 'Check',
    prompt: 'What will most likely actually happen',
  },
  {
    id: 'uppercut',
    name: 'Action Uppercut',
    short: 'Uppercut',
    prompt: 'One thing I can actually do',
  },
];

export const TAUNTS = [
  'What if it all goes wrong?',
  'Everyone will notice.',
  'You always do this.',
  "You're not ready.",
  "They're just being polite.",
  "This time it'll be different. Worse.",
  'Remember that one time?',
];

// Lines that sound reassuring but carry no evidence. Matched after normalising.
export const VAGUE_PHRASES = [
  "i'm fine",
  'im fine',
  "it'll be ok",
  "it'll be okay",
  'itll be ok',
  'itll be okay',
  'it will be ok',
  'it will be okay',
  'everything is fine',
  "everything's fine",
  'everything will be fine',
  'i am great',
  "i'm great",
  'stay positive',
  'good vibes',
  'good vibes only',
  "don't worry",
  'just relax',
  'think positive',
];

// Words that usually mean the line is grounded in something concrete.
export const SPECIFIC_WORDS = [
  'because',
  'last time',
  'even if',
  'evidence',
  'actually',
  'for example',
  'in fact',
  'the data',
  'already',
];

export const MONTHS_AND_DAYS = [
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'today', 'yesterday', 'tomorrow', 'tonight',
];

// Capitalised words that aren't proper nouns even mid-sentence.
export const NOT_PROPER_NOUNS = ['I', "I'm", "I'll", "I've", "I'd", 'OK', 'Ok'];

export const FEELINGS = [
  { value: 1, label: 'Rough' },
  { value: 2, label: 'Low' },
  { value: 3, label: 'Okay' },
  { value: 4, label: 'Better' },
  { value: 5, label: 'Good' },
];

export const COPY = {
  opponentName: 'ANXIETY',
  round: 'ROUND 1',
  fight: 'FIGHT!',
  ko: 'K.O.',
  koMessage: "Anxiety's small now. It may come back. You know the moves.",
  breatheTitle: 'Breathe with the box',
  breatheMessage: 'Anxiety got loud. That happens. Breathe with the box.',
  breatheDone: 'Nice. Anxiety lost 15. Back in.',
  breathPhases: ['Breathe in', 'Hold', 'Breathe out', 'Hold'],
  vague: 'Too vague. Get specific.',
  repeat: 'Already used that one.',
  empty: 'Type a line first, then hit.',
  pickMove: 'Pick a move, type your line, hit Enter.',
  finisherReady: 'All four moves landed. FULL FLIP unlocked!',
  finisherName: 'FULL FLIP',
  thoughtHints: {
    empty: 'Write it the way it sounds in your head. This becomes your opponent.',
    short: 'A little more — make it the full thought.',
    ok: "That's the one. Next when you're ready.",
  },
  rules: [
    'Damage is about 1 point per 4 characters, up to 15.',
    'Bonus +5 each (max +15) for: a number or date · words like "because", "last time", "even if", "evidence", "actually" · a name or place mid-sentence.',
    'Short lines (under 25 characters) or empty reassurance like "it\'ll be ok" do 3 at most.',
    'Repeating a line you already used does 0.',
    'Land all four move types to unlock FULL FLIP (25 damage).',
    'Anxiety grows +1 every 3 seconds you sit idle. If it maxes out, you take a breathing break. There is no game over.',
  ],
};
