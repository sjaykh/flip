// Fight mode: every piece of copy, every phrase list and every tuning number.
// Change balance or wording here without touching logic.js, render.js or ui.js.
//
// CBT framing: the opponent is the THOUGHT, not the feeling. Anxiety is a signal;
// the fight is with the distorted thought that feeds it. The goal is a balanced,
// believable thought, not a positive one.

export const OPPONENT_NAME = 'THE SPIRAL';
export const GRIP_LABEL = 'GRIP';
export const EMOTION_METER_LABEL = 'ANXIETY';

// ---------- Tuning (balance) ----------

export const TUNING = {
  // Belief in the thought (0–100) maps onto the opponent's starting GRIP.
  gripMin: 60,
  gripMax: 150,
  playerHp: 100,

  // Idle regen: +1 GRIP for every 3 s of non-focus time with no activity.
  regenEveryMs: 3000,
  regenAmount: 1,

  // Blocking.
  parryAt: 12, // counter damage >= this → PARRY
  partialAt: 4, // counter damage in [partialAt, parryAt) → partial block
  commentHit: [10, 14], // damage an unanswered comment does (inclusive range)

  // Round 0: the thought lands its strongest evidence for a fixed hit.
  openingHitDamage: 5,

  // Knockdown recovery — identical whether the player breathes, skips or has breaks off.
  recoverPlayerHp: 50,
  recoverGripLoss: 10,

  // Finisher: regular moves can't take GRIP below 1; the balanced thought unlocks at 25%.
  gripFloor: 1,
  finisherAtFraction: 0.25,

  // Rounds (99 s of non-focus time each). HP and GRIP carry over.
  rounds: 3,
  roundSeconds: 99,

  // Moves.
  varietyBonus: 3, // first use of each move type in a fight
  visibleMovesMobile: 4,

  // Comebacks.
  comebackChance: 0.3,
  fragmentMaxWords: 6,
  fragmentMaxChars: 48,

  // Text limits.
  thoughtMinChars: 20,
  evidenceMinChars: 10,
  balancedMinChars: 20,
  thoughtMaxChars: 280,
  contextMaxChars: 60,
  otherEmotionMaxChars: 30,
  lineMaxChars: 200,
};

// ---------- Pacing (timings) — thinking time is protected ----------

export const PACING = {
  // Only one comment on screen at a time. After it resolves, wait this long
  // (non-focus time) before the next throw, with a wind-up tell before it.
  throwGapMs: 4000,
  throwGapCalmMs: 8000,
  windupMs: 1500,

  // Travel time across the arena while the player is idle.
  travelMobileMs: 12000,
  travelDesktopMs: 9000,
  travelCalmMobileMs: 18000, // also used with prefers-reduced-motion
  travelCalmDesktopMs: 14000,
  desktopMinWidth: 700,

  // Focus mode (bullet time) while the player types.
  focusSpeed: 0.1, // incoming comment moves at 10%
  focusSpeedCalm: 0, // Calm pace: frozen
  focusCap: 0.9, // a comment can't land while the player keeps typing
  focusIdleExitMs: 8000, // no keystrokes for this long → focus ends

  // Round 0 opening hit.
  openingTravelMs: 1600,

  // Banners and breaks.
  bannerMs: 900,
  downBannerMs: 2000,
  breathPhaseMs: 4000, // 4 in / 4 hold / 4 out / 4 hold
  breathCycles: 2,
  betweenRoundsMs: 5000,
};

export const DAMAGE = {
  charsPerPoint: 4,
  baseCap: 15,
  bonusEach: 5,
  bonusCap: 15,
  vagueMaxDamage: 3,
  vagueMinChars: 25,
  repeatSimilarity: 0.85, // Dice coefficient on character bigrams
};

// Probability of each comment source per throw (must sum to 1).
export const MIX = {
  normal: { template: 0.5, generic: 0.3, original: 0.2 },
  calm: { template: 0.2, generic: 0.7, original: 0.1 },
};

// ---------- Moves: Socratic questions ----------

export const MOVES = [
  { id: 'jab', name: 'Evidence Jab', prompt: 'What facts go against this?', anim: 'jab' },
  { id: 'friend', name: 'Friend Block', prompt: 'What would you tell a friend who thought this?', anim: 'block' },
  { id: 'check', name: 'Reality Check', prompt: 'Worst case, best case, most likely?', anim: 'jab' },
  { id: 'cope', name: 'Coping Shield', prompt: 'If the worst happened, how would you cope?', anim: 'block' },
  { id: 'time', name: 'Time Kick', prompt: 'Will this matter in 5 weeks? 5 years?', anim: 'kick' },
  { id: 'uppercut', name: 'Action Uppercut', prompt: "One thing you can do that's in your control?", anim: 'uppercut' },
];

// ---------- Feelings ----------

export const EMOTIONS = [
  { id: 'anxious', label: 'anxious' },
  { id: 'scared', label: 'scared' },
  { id: 'ashamed', label: 'ashamed' },
  { id: 'sad', label: 'sad' },
  { id: 'angry', label: 'angry' },
  { id: 'other', label: 'other' },
];

// ---------- The thought's comments ----------
// Each trap: `generic` lines and `templates` using {situation}, {who}, {fear}.
// A template is only used when every slot it mentions is filled.
// Rule: comments go after the THOUGHT, never the person (no looks, body, worth,
// intelligence as a trait, self-harm or death). test/safety.test.mjs enforces it.

export const TRAPS = [
  {
    id: 'mind-reading',
    label: 'Mind Reading',
    generic: [
      "They all think you're bad at this",
      'Everyone can tell you are winging it',
      "They're only being polite to you",
      'You can see it on their faces',
      "They're already talking about it",
      "Nobody's saying it, but they're thinking it",
      'They noticed. They always notice.',
      "Everyone's waiting for you to slip",
    ],
    templates: [
      "{who} has already decided you can't do this",
      '{who} is just being nice to you',
      '{who} can tell you are not ready',
      '{who} noticed every mistake',
      '{who} is already disappointed',
      '{who} will see right through you',
      "{who} talks about you when you're not there",
      '{who} expects you to mess up {situation}',
    ],
  },
  {
    id: 'fortune-telling',
    label: 'Fortune Telling',
    generic: [
      'This is going to go wrong',
      "You already know how this ends",
      'It will go badly. It always does.',
      "Tomorrow's going to be worse",
      'Something will go wrong. Wait for it.',
      "There's no way this works out",
      "You'll freeze when it matters",
      "It's going to fall apart halfway",
    ],
    templates: [
      '{situation} is going to go badly. You know it.',
      "You'll blank in the middle of {situation}",
      '{situation} will go wrong in front of everyone',
      "{situation}? It's not going to work",
      '{who} is going to say no',
      "You're going to disappoint {who}",
      'Picture {situation} going wrong. Now again.',
      '{situation} is already lost',
    ],
  },
  {
    id: 'catastrophising',
    label: 'Catastrophising',
    generic: [
      'If this fails, everything falls apart',
      "One mistake and it's all over",
      'This is the start of everything going wrong',
      "If it goes wrong, you'll never recover",
      'Small problem today, huge problem tomorrow',
      'This could ruin everything you built',
      "Once this slips, it'll all slip",
      "If this goes wrong, there's no coming back",
    ],
    templates: [
      "If {situation} goes wrong, that's it for you",
      '{situation} goes wrong and everything follows',
      'Mess up {situation} and it all unravels',
      "If {who} is unhappy, that's the end",
      '{situation} will undo everything',
      'One slip in {situation} and it all collapses',
      'After {situation}, nothing will be the same',
      "If {situation} flops, you'll never live it down",
    ],
  },
  {
    id: 'all-or-nothing',
    label: 'All-or-Nothing',
    generic: [
      'Anything less than perfect is failure',
      "If it isn't flawless, it doesn't count",
      'Either you nail it or you blew it',
      'One flaw ruins the whole thing',
      'Good enough is never good enough',
      "It's perfect or it's pointless",
      'Ninety-nine right, one wrong. Failed.',
      "Close doesn't count",
    ],
    templates: [
      "Unless {situation} is perfect, it's a failure",
      '{situation} has to be flawless',
      'One wrong word in {situation} and you blew it',
      'If {who} finds one flaw, it all counts for nothing',
      "{situation} is either perfect or it's a disaster",
      'Anything less than a perfect {situation} is a loss',
      '{who} only counts perfect',
      'Get one thing wrong in {situation} and it all fails',
    ],
  },
  {
    id: 'should',
    label: 'Should Statements',
    generic: [
      'You should have figured this out by now',
      'You should be further along',
      'You should never feel like this',
      'You should be able to handle this easily',
      'You should have prepared more',
      'Other people would have done better',
      "You shouldn't still be thinking about this",
      'You should already know the answer',
    ],
    templates: [
      'You should be over {situation} by now',
      'You should have nailed {situation} already',
      "You shouldn't need help with {situation}",
      'You should have impressed {who} by now',
      '{who} should never have to correct you',
      'You should be calm about {situation}',
      'You should have started on {situation} weeks ago',
      'You should be able to do {situation} in your sleep',
    ],
  },
  {
    id: 'discounting',
    label: 'Discounting the Positive',
    generic: [
      'That win was just luck',
      "The good feedback doesn't count",
      'Anyone could have done that',
      "They praised you because they had to",
      'That was a fluke',
      "It went well by accident",
      "Last time doesn't count. This time is real.",
      'You only got there because it was easy',
    ],
    templates: [
      "Even if {situation} goes well, it'll be luck",
      "If {who} says it's good, they're just being kind",
      "A good {situation} won't count",
      "{who}'s praise doesn't mean anything",
      "Even a great {situation} won't prove anything",
      'If {situation} works, it was a fluke',
      "{who} would say that to anyone",
      "You'll find a way to dismiss {situation} going well",
    ],
  },
  {
    id: 'fear-echo',
    label: 'Fear Echo',
    generic: [],
    templates: [
      'Admit it. {fear}.',
      'Deep down you believe it: {fear}.',
      "Say it with me: {fear}.",
      "{situation} will prove it: {fear}.",
      '{who} will see it: {fear}.',
      'You know the line by heart. {fear}.',
      "Here it comes again: {fear}.",
      "Don't argue. {fear}.",
    ],
  },
];

export const ORIGINAL_TRAP_LABEL = 'The thought itself';

export const COMEBACK = {
  label: 'Yes-but',
  lines: [
    "Sure, '{fragment}'... but this time is different.",
    "'{fragment}'? That's what you said last time.",
    "Fine, '{fragment}'. What about everything else?",
  ],
};

// ---------- Language lists ----------

// Lines that sound reassuring but carry no evidence. Matched after normalising.
export const VAGUE_PHRASES = [
  "i'm fine", 'im fine',
  "it'll be ok", "it'll be okay", 'itll be ok', 'itll be okay', 'it will be ok', 'it will be okay',
  'everything is fine', "everything's fine", 'everything will be fine',
  'i am great', "i'm great",
  'stay positive', 'good vibes', 'good vibes only',
  "don't worry", 'just relax', 'think positive',
];

// Words that usually mean the line is grounded in something concrete.
export const SPECIFIC_WORDS = [
  'because', 'last time', 'even if', 'evidence', 'actually', 'i could', "i'd",
  'for example', 'in fact', 'the data', 'already',
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

// If any of these show up in the thought, context or Round 0 evidence, the opponent uses generic
// lines only for the whole fight and a crisis banner sits above the arena.
export const SELF_HARM_PATTERNS = [
  'kill myself', 'killing myself', 'suicide', 'suicidal', 'end my life', 'ending my life',
  'end it all', 'want to die', 'wanna die', 'wish i was dead', "wish i were dead",
  'better off dead', 'self harm', 'self-harm', 'selfharm', 'hurt myself', 'hurting myself',
  'cut myself', 'cutting myself', 'take my life', 'no reason to live', 'not want to be alive',
  "don't want to be alive", 'dont want to be alive', 'not be here anymore', 'overdose',
  'harm myself', 'die by',
];

// Words no comment written by us may ever contain (identity attacks, body, worth,
// intelligence as a trait, self-harm, death). Checked as whole words.
export const BANNED_WORDS = [
  'ugly', 'fat', 'thin', 'skinny', 'body', 'weight', 'face is', 'looks',
  'stupid', 'dumb', 'idiot', 'moron', 'brainless',
  'worthless', 'useless', 'pathetic', 'loser', 'failure as a person', 'disgusting', 'hate you',
  'kill', 'die', 'dead', 'death', 'suicide', 'harm', 'hurt yourself', 'cut', 'blood',
];

// Words skipped when pulling a {situation} out of the thought itself.
export const STOPWORDS = [
  'i', "i'm", "i'll", "i've", "i'd", 'im', 'ill', 'me', 'my', 'mine', 'myself', 'you', 'your', 'we', 'us', 'our',
  'he', 'she', 'it', "it's", 'its', 'they', 'them', 'their', 'everyone', 'everybody', 'someone', 'anyone',
  'nobody', 'people', 'the', 'a', 'an', 'this', 'that', 'these', 'those', 'and', 'or', 'but', 'so', 'if',
  'then', 'than', 'because', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'about', 'from', 'by', 'up',
  'down', 'out', 'over', 'into', 'will', 'would', 'should', 'could', 'can', "can't", 'cant', 'won\'t',
  'wont', 'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
  'did', "don't", 'dont', 'not', 'no', 'never', 'always', 'just', 'going', 'gonna', 'get', 'got',
  'go', 'goes', 'see', 'think', 'know', 'feel', 'make', 'mess', 'fail', 'ruin', 'screw', 'blow',
  'all', 'every', 'very', 'really', 'too', 'what', 'when', 'how', 'why', 'who', 'good', 'enough',
  'bad', 'again', 'still', 'even', 'like', 'some', 'any', 'much', 'more', 'most', 'there', 'here',
];
export const DETERMINERS = ['the', 'my', 'this', 'that', 'our', 'a', 'an', 'their', 'his', 'her', 'tomorrow\'s', "today's"];

export const FEELINGS = [
  { value: 1, label: 'Rough' },
  { value: 2, label: 'Low' },
  { value: 3, label: 'Okay' },
  { value: 4, label: 'Better' },
  { value: 5, label: 'Good' },
];

// ---------- Copy ----------

export const COPY = {
  playerName: 'YOU',
  roundBanner: (n) => `ROUND ${n}`,
  round0Banner: 'ROUND 0\nLET IT MAKE ITS CASE',
  fight: 'FIGHT!',
  ko: 'K.O.',
  down: 'DOWN, NOT OUT',
  parry: 'PARRY!',
  focus: 'FOCUS',
  timeUp: 'TIME',
  finisher: 'BALANCED THOUGHT',
  focusOn: 'Focus mode. Time slows while you type.',
  focusOff: 'Focus off. Normal speed.',

  // Setup
  thoughtHints: {
    empty: 'Write it the way it sounds in your head. This becomes your opponent.',
    short: 'A little more. Make it the full thought.',
    ok: "That's the one. Next when you're ready.",
  },
  feelingsHint: {
    none: 'Pick at least one. Most thoughts come with more than one feeling.',
    other: 'Name the other feeling in a word or two.',
    ok: '',
  },
  situationFallback: (s) => `If you skip this, the fight will call it “${s}”.`,

  // Round 0
  evidenceLabel: "What's the strongest evidence this thought is true?",
  evidenceHint: 'Be honest. Looking at what the thought has going for it is part of the method.',
  evidenceShort: 'A few more words. What makes the thought feel true?',
  evidenceButton: 'Let it land',
  evidenceLanded: "Fair. That's the hard part to look at. Now answer it.",
  evidenceSafeBubble: 'It made its case.',
  evidenceTrap: 'Its case',

  // Fight
  attackHint: 'Pick a question, answer it, press Enter.',
  blockPrompt: (trap) => `Answer it! It's ${trap}`,
  vague: 'Too vague. Get specific.',
  repeat: 'Already used that one.',
  empty: 'Type a line first, then press Enter.',
  hit: (move, dmg, extra) => `${move}! ${dmg} off its grip${extra}`,
  parried: (dmg) => `PARRY! The comment shatters. Grip −${dmg}.`,
  partial: (dmg) => `Partial block. You take ${dmg}. Get more specific to parry.`,
  hitTaken: (dmg) => `That one landed. You take ${dmg}.`,
  windup: 'It’s winding up…',
  incoming: (trap, text) => `Incoming, ${trap}: ${text}`,
  floorReached: 'Its grip won’t drop further with questions alone. Time for the balanced thought.',
  finisherReady: 'Grip is low. BALANCED THOUGHT unlocked.',
  finisherPrompt: "Write a thought that's fair to both sides. It can include what's hard.",
  finisherMaterial: 'Material to work with',
  finisherEvidence: 'What it had going for it',
  finisherBest: 'Your strongest answer',
  finisherShort: 'A bit more. Include both what is hard and what is also true.',
  balancedBelief: 'How much do you believe this new thought?',

  // Knockdowns and rounds
  breatheMessage: 'It got loud. That happens. Breathe with the box.',
  breathPhases: ['Breathe in', 'Hold', 'Breathe out', 'Hold'],
  recovered: "Back up. You're at 50, its grip lost 10.",
  betweenRounds: (grip, line) => (line
    ? `Grip: ${grip}. Your strongest line so far: “${line}”`
    : `Grip: ${grip}. Take a breath. Next round's yours.`),

  // Endings
  koMessage: "The thought lost its grip. The feeling may linger. That's normal, and it fades.",
  timeoutMessage: (start, end) => `Grip went from ${start} to ${end}. That counts.`,
  timeoutBalanced: 'Before you go, write a fair version of the thought.',

  // Debrief
  rerateBelief: 'How much do you believe the original thought now?',
  rerateEmotion: (names) => `How intense is it now? (${names})`,
  feelingOverall: 'How do you feel overall?',
  copingIntro: 'Keep this for the next time the spiral starts.',
  closing: "If you're fighting the same thought most days, arguing with it may stop helping. Try setting a 15-minute 'worry time' later in the day, or talk to someone you trust or a professional.",
  evidenceSection: 'What the thought had going for it',

  safetyBanner: "If you're having thoughts of hurting yourself, please talk to someone now. India: Tele-MANAS 14416 · Elsewhere: findahelpline.com",
  rules: [
    'Damage is about 1 point per 4 characters, up to 15.',
    'Bonus +5 each (max +15) for: a number or date · words like "because", "last time", "even if", "evidence", "actually", "I could", "I\'d" · a name or place mid-sentence.',
    'First time you use each question in a fight: +3.',
    'Short lines (under 25 characters) or empty reassurance like "it\'ll be ok" do 3 at most: too vague.',
    'Repeating a line you already used does 0.',
    'When a comment is flying at you, your answer is a block: 12+ parries it, 4–11 halves the hit, anything weaker lets it land (10–14).',
    'Questions alone can’t take GRIP below 1. At 25% the BALANCED THOUGHT unlocks; it’s the only way to a K.O.',
    'While you type, time slows (focus mode). The round clock, regen and new comments wait for you.',
    'Its grip regrows 1 point every 3 seconds you sit idle.',
    'If you get knocked down you come back at 50 HP and its grip drops 10. Always. There is no game over.',
  ],
};
