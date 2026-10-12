# Flip

A private CBT scratchpad for overthinking and catastrophising. There are two ways to use it.

- **Write it out.** Five calm steps: write the worst case, the absurdly good case,
  what will most likely happen, and one move you can make. Then re-rate how much you
  believe the original thought.
- **Fight it.** A retro 2D arcade fighter. Your anxious thought becomes the opponent,
  ANXIETY. You knock it down by typing specific counter-arguments, and you block its
  comments by answering them.

## Privacy

- The whole app is one static HTML file. There's no backend and no accounts, analytics,
  cookies, trackers or AI/API calls.
- Everything is held in memory. Nothing goes to localStorage, sessionStorage or IndexedDB,
  so closing the tab clears it.
- The Content-Security-Policy is pinned to a hash (`default-src 'none'; connect-src 'none'`),
  so the page can't make a network request, even by accident.
- All art, the pixel font and the sound are generated in code (canvas, CSS, inline SVG,
  Web Audio). Nothing is fetched.
- User text only ever reaches the page through `textContent`. A test fails if `innerHTML`
  appears anywhere in `src/`.
- The safety footer (Tele-MANAS 14416 · findahelpline.com) is on every screen, including
  the fight.

## Fight mode

### Setup
1. **What's the thought?** At least 20 characters. It becomes ANXIETY's name-plate quote
   and one of its attacks.
2. **Context.** All three fields are optional, up to 60 characters each, and skippable:
   - *What's the situation?* becomes `{situation}`
   - *Who's involved?* becomes `{who}`
   - *What are you afraid it says about you?* becomes `{fear}`

   If you skip the situation, Flip pulls a noun-ish phrase out of the thought instead,
   for example "the review". `{who}` and `{fear}` stay empty, and templates that need
   them are never used.
3. **How strong is it?** A 0–100 slider that sets ANXIETY's starting HP (scaled to
   60–150) and its size and darkness.
4. **Settings.** Breathing breaks (on), Calm pace (off) and Sound (off). You can change
   them from the pause menu too.
5. ROUND 1, then FIGHT!

### Fighting
- **Attacking.** Pick a move, type a line and press Enter:
  - Evidence Jab: a fact that goes against the thought
  - Flip Kick: the absurdly good version
  - Reality Check: what will most likely actually happen
  - Action Uppercut: one thing I can actually do
- **Damage.** The same rules for attacks and blocks, explained under **?** in the fight:
  - Base damage is about 1 point per 4 characters, up to 15.
  - +5 each (max +15) for a number or date, a grounding word ("because", "last time",
    "even if", "evidence", "actually"…), or a proper noun mid-sentence.
  - A line under 25 characters, or empty reassurance ("it'll be ok"), does at most 3:
    *Too vague. Get specific.*
  - A near-duplicate of an earlier line does 0: *Already used that one.*
  - Landing a solid hit (or parry) with all four move types unlocks **FULL FLIP** (25 damage).
- **Comments.** ANXIETY throws a comment every 6–10 s (12–16 s with Calm pace). Each one
  flies across the arena labelled with its thinking trap. Crossing takes 8 s on a phone and
  6 s on desktop, and Calm pace or reduced motion makes it 50% slower.
- **Blocking.** While a comment is in the air, the input switches to BLOCK
  (*"Answer it! It's Mind Reading"*):
  - A counter worth 12+ damage is a **PARRY**: the comment shatters, ANXIETY takes the
    damage, and your streak goes up by 1.
  - A counter worth 4–11 is a partial block, and you take half damage.
  - No answer, a vague answer or a repeat lets the comment hit you for 10–14.
- **Regen.** ANXIETY gets +1 HP for every 3 s you sit idle, up to its starting max.
- **Knockdowns, never game over.** At 0 HP: *DOWN, NOT OUT*. With Breathing breaks on, you
  get 2 cycles of box breathing (4 in, 4 hold, 4 out, 4 hold), with Skip visible from the
  start. With it off, the banner shows for 2 s. Either way you come back at **50 HP** and
  ANXIETY loses **10**. Breathing, skipping and having it off all give the same result.
- **Rounds.** Up to 3 rounds of 99 s, and HP carries over. Between rounds there's a 5 s
  breather showing ANXIETY's HP and your strongest line so far.
- **Endings.**
  - K.O.: *"Anxiety's small now. It may come back. You know the moves."*
  - After round 3: *"Anxiety went from {start} to {end}. That counts."*
- **Pause.** Use the button or press Esc. Pausing freezes the round timer, comments and
  regen. The game also pauses itself when the tab is hidden.

### How comments are generated (all local)
- Every thinking trap in `src/fight/constants.js` has about 8 generic lines and about 8
  templates. The traps are Mind Reading, Fortune Telling, Catastrophising, All-or-Nothing,
  Should Statements, Discounting the Positive and Fear Echo.
- The mix per throw is about 50% templates, 30% generic lines and 20% your original thought.
  With Calm pace it's 20/70/10.
- The same line never comes twice in a row, and each list cycles through fully before
  anything repeats.
- **Yes-but comebacks.** After you land a line, there's a 30% chance the next throw quotes up
  to 6 words of it ("'{fragment}'? That's what you said last time."). You can block these too.

### Guardrails
- All inserted text is trimmed, stripped of HTML, whitespace-collapsed and length-capped.
- Comments go after the thought, never the person: no looks, body, worth, intelligence as a
  trait, self-harm or death. `test/safety.test.mjs` scans every generic line, template and
  comeback against a banned-word list.
- If the thought or context contains self-harm language, ANXIETY uses generic lines only for
  that fight, never quotes you, and a crisis banner sits above the arena.

### Debrief
1. Re-rate the thought (0–100).
2. Say how you feel (rough to good).
3. Get a result card with:
   - the thought, plus any context you gave
   - strength before → after
   - your feeling, fight time, parries and knockdowns
   - the traps you blocked most
   - breaths taken, if you completed any
   - every line you typed, grouped by move, with blocks labelled by the trap they answered

You can export it as .md, .txt or print/PDF, or choose **Fight again** (same thought and
context) or **Start over**.

## Tuning knobs

Everything lives in `src/fight/constants.js`. Logic and rendering read it, so you can change
balance or wording without touching code.

| Knob | Default | What it does |
| --- | --- | --- |
| `TUNING.anxietyHpMin/Max` | 60 / 150 | Range the strength slider maps onto |
| `TUNING.playerHp` | 100 | Your starting HP |
| `TUNING.regenEveryMs`, `regenAmount` | 3000, 1 | Idle regen |
| `TUNING.throwDelayMs` / `throwDelayCalmMs` | 6–10 s / 12–16 s | Gap between comments |
| `TUNING.travelMobileMs` / `travelDesktopMs` / `slowTravelFactor` | 8 s / 6 s / ×1.5 | Comment flight time |
| `TUNING.parryAt`, `partialAt`, `commentHitMs` | 12, 4, 10–14 | Block thresholds and hit damage |
| `TUNING.recoverPlayerHp`, `recoverAnxietyLoss` | 50, 10 | Knockdown recovery |
| `TUNING.breathPhaseMs`, `breathCycles` | 4000, 2 | Box breathing |
| `TUNING.rounds`, `roundSeconds`, `betweenRoundsMs` | 3, 99, 5000 | Rounds |
| `TUNING.comebackChance`, `fragmentMaxWords` | 0.3, 6 | Yes-but comebacks |
| `TUNING.finisherDamage` | 25 | FULL FLIP |
| `DAMAGE.*` | — | Damage formula (per-char rate, caps, bonus, vague, repeat threshold) |
| `MIX.normal` / `MIX.calm` | 50/30/20, 20/70/10 | Comment source mix |
| `TRAPS`, `COMEBACK`, `COPY` | — | Every line of text in Fight mode |
| `VAGUE_PHRASES`, `SPECIFIC_WORDS`, `SELF_HARM_PATTERNS`, `BANNED_WORDS` | — | Word lists |

## Commands

There are no dependencies to install.

```sh
npm run build   # → dist/index.html (CSS + JS inlined, CSP hashes computed)
npm run serve   # serves dist/ on http://127.0.0.1:4173
npm test        # node:test unit tests: damage, blocks, recovery, rounds, templates,
                #   fragments, mix ratios, no repeats, safe mode, safety scan
npm run check   # unit tests, then build, then end-to-end at 375px in Chromium (needs Playwright)
```

`npm run check` covers the Write it out flow and a full fight:
- context filled in
- a parried comment and a comment that lands
- a knockdown with breathing skipped
- pause freezing the clock
- K.O. and the debrief
- the .md download
- safe mode

Throughout, it asserts **0 network requests after load** and no console errors or CSP
violations.

`SHOTS=./shots npm run check` saves screenshots of each step.
`REDUCED_MOTION=1 npm run check` runs the same check with reduced motion turned on.
The check sets a test-only `window.__flipTest` (`{ timeScale, seed }`) through Playwright to
fast-forward the game clock and make it deterministic. Real users never have it.

## Deploy

Upload `dist/index.html` to any static host. On Netlify: build command `npm run build`,
publish directory `dist`.

## Structure

- `src/index.html`: one `<section>` per screen (`0–6` for Write it out, `f1–f8` for Fight)
- `src/styles.css`: themes, the arena layout, reduced motion, and a print stylesheet that prints only the card
- `src/app.js`: Write it out flow, screen switching, downloads, reset and the theme toggle
- `src/fight/constants.js`: copy, phrase lists, traps, templates and tuning
- `src/fight/logic.js`: pure rules with a seedable RNG
- `src/fight/render.js`: canvas renderer (bitmap font, procedural pixel sprites, Kochi rooftop stage, HUD)
- `src/fight/ui.js`: screens, game loop, input, overlays, sound and the debrief
- `test/`: `logic.test.mjs` and `safety.test.mjs`
- `build.mjs`: strips import/export lines, bundles everything into one inline script, writes the CSP
