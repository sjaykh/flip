# Flip

A private CBT scratchpad for overthinking and catastrophising. There are two ways to use it.

- **Write it out.** Five calm steps: write the worst case, the absurdly good case,
  what will most likely happen, and one move you can make. Then re-rate how much you
  believe the original thought.
- **Fight it.** A retro 2D arcade fighter. The opponent is your anxious thought. You answer
  it with CBT questions until it loses its grip, then you write a balanced thought to finish it.

## Privacy

- The whole app is one static HTML file. There's no backend and no accounts, analytics,
  cookies, trackers or AI/API calls.
- Everything is held in memory. Nothing goes to localStorage, sessionStorage or IndexedDB,
  so closing the tab clears it.
- The Content-Security-Policy is pinned to a hash (`default-src 'none'; connect-src 'none'`),
  so the page can't make a network request, even by accident.
- All art, the pixel font and the sound are generated in code (canvas, CSS, inline SVG,
  Web Audio). Nothing is fetched.
- User text only reaches the page through `textContent`. A test fails if `innerHTML`
  appears anywhere in `src/`.
- The safety footer (Tele-MANAS 14416 · findahelpline.com) is on every screen, including
  the fight.

## Fight mode and the CBT behind it

**The opponent is the thought, not the feeling.** Anxiety is a feeling and a signal; it
isn't the enemy. What you fight is the distorted thought that feeds it. The opponent is
called **THE SPIRAL** (`OPPONENT_NAME`), with your thought as its quote. Its bar is **GRIP**:
how much hold the thought has on you. Under your own health bar, a small **ANXIETY** meter
starts at the intensity you rated. It drops in proportion to the GRIP the thought loses.
It's only visual and doesn't decide anything, because feelings follow thoughts, slowly.
The goal is a **balanced, believable thought**, not a positive one.

### Setup: a thought record, one step per screen

| Step | Field | Why (CBT) |
| --- | --- | --- |
| 1 | What's the situation? *(optional, 60 chars)* → `{situation}` | Thoughts happen in situations; naming it makes the thought testable. |
| 2 | What are you feeling? anxious / scared / ashamed / sad / angry / other, plus 0–100 intensity of the strongest | Separates the feeling from the thought, and gives a baseline to re-rate. |
| 3 | What's the thought? *(min 20 chars)* | The automatic thought, written exactly as it sounds. |
| 4 | Which part of this bothers you most? *(optional)* → `{fear}` | The "hot thought": the meaning that hurts. |
| 5 | Who's involved? *(optional)* → `{who}` | Makes mind-reading and fortune-telling concrete. |
| 6 | How much do you believe the thought? 0–100 | The belief rating, which sets starting GRIP (60–150) and the opponent's size. |
| 7 | Settings: Breathing breaks (on), Calm pace (off), Sound (off) | Comfort. Also available in the pause menu. |
| 8 | **Round 0: let it make its case.** "What's the strongest evidence this thought is true?" *(required)* | Weighing the evidence *for* the thought is part of the method, so this step can't be skipped. The thought lands it as an opening hit (5 damage), shown in its speech bubble. |

If you skip the situation, Flip pulls a noun-ish phrase out of the thought instead, for
example "the review". `{who}` and `{fear}` stay empty, and templates that need them are
never used. A leading "that" is trimmed from `{fear}` so it reads naturally in the
opponent's mouth.

### Your moves are Socratic questions
| Move | Question |
| --- | --- |
| Evidence Jab | What facts go against this? |
| Friend Block | What would you tell a friend who thought this? |
| Reality Check | Worst case, best case, most likely? |
| Coping Shield | If the worst happened, how would you cope? |
| Time Kick | Will this matter in 5 weeks? 5 years? |
| Action Uppercut | One thing you can do that's in your control? |

On mobile, 4 moves show at a time. The one you just used rotates out, so you try different
questions. On desktop all 6 show. Pick a move, type your answer and press Enter.

### Damage (shown under **?** in the fight)
- Base damage is about 1 point per 4 characters, up to 15.
- +5 each (max +15) for:
  - a number or date
  - a grounding word ("because", "last time", "even if", "evidence", "actually", "I could", "I'd")
  - a proper noun mid-sentence
- **Variety:** +3 the first time you use each move in a fight.
- A line under 25 characters, or empty reassurance ("it'll be ok"), does at most 3:
  *Too vague. Get specific.*
- A near-duplicate of an earlier line does 0: *Already used that one.*

### The finisher: the balanced thought
Questions alone can't take GRIP below 1. Once GRIP is at or below **25%**, **BALANCED
THOUGHT** unlocks, and it's the only way to a K.O. You see the Round 0 evidence and your
strongest answer as material. Then you write *"a thought that's fair to both sides; it can
include what's hard"*, rate how much you believe it, and K.O. the thought.

### The thought fights back
- **Comments.** The thought throws comments that fly across the arena, each labelled with
  its thinking trap: Mind Reading, Fortune Telling, Catastrophising, All-or-Nothing,
  Should Statements, Discounting the Positive, or Fear Echo.
  - Every trap has about 8 generic lines and about 8 templates using `{situation}`,
    `{who}` and `{fear}`.
  - The mix per throw is about 50% templates, 30% generic lines and 20% your original
    thought. With Calm pace it's 20/70/10.
  - The same line never comes twice in a row, and each list cycles through fully before
    anything repeats.
- **Yes-but comebacks.** After you land a line, there's a 30% chance the next comment
  quotes up to 6 words of it ("'{fragment}'? That's what you said last time."). You can
  block these too.
- **Blocking.** While a comment is in the air, your input becomes BLOCK (*"Answer it!
  It's Mind Reading"*):
  - A counter worth 12+ damage is a **PARRY**: the comment shatters, GRIP takes the damage,
    and your streak goes up by 1.
  - A counter worth 4–11 is a partial block, and you take half damage.
  - No answer, or a vague one, lets it hit you for 10–14.
- **Regen.** GRIP grows back 1 point for every 3 s you sit idle (outside focus mode), up to
  its starting max, and the opponent visibly grows.

### Pacing: thinking time is protected
- **Focus mode (bullet time).** As soon as you focus the input or type, focus mode starts:
  - The incoming comment slows to 10% speed, or freezes completely with Calm pace.
  - The round clock, regen and new throws all wait.
  - The arena desaturates and **FOCUS** shows in the HUD.

  A comment can never reach you while you keep typing. Focus ends when you submit, or after
  8 s without a keystroke. Then normal speed resumes and the *Answer it!* prompt pulses once.
- **Throw rhythm.** Only one comment is on screen at a time. After it resolves there's a 4 s
  gap (8 s with Calm pace), with a wind-up tell 1.5 s before the next throw.
- **Travel time.** A comment takes 12 s to cross on mobile and 9 s on desktop. With Calm pace
  it's 18 s and 14 s, and reduced motion uses the Calm pace speeds.
- **Rounds.** Up to 3 rounds of 99 s, counting only non-focus time, so a round can't end
  mid-sentence. HP and GRIP carry over. Between rounds there's a 5 s breather showing GRIP
  and your strongest line so far.

### Knockdowns, never game over
At 0 HP: *DOWN, NOT OUT*.
- With Breathing breaks on: 2 cycles of box breathing ("It got loud. That happens. Breathe
  with the box."), with **Skip** visible from the start.
- With it off: the banner shows for 2 s.

Either way you come back at **50 HP** and GRIP drops by **10**. Breathing, skipping and
having breaks off all give the same result.

### Endings and debrief
- **K.O.:** the thought shrinks to a tiny blob. It isn't destroyed: *"The thought lost its
  grip. The feeling may linger. That's normal, and it fades."*
- **After round 3 without a K.O.:** you're still offered the balanced-thought step,
  which you can skip: *"Grip went from {start} to {end}. That counts."*

The debrief then has three steps:
1. Re-rate your belief in the original thought.
2. Re-rate the same feelings.
3. Say how you feel overall.

The **result card** puts outcomes before game stats:
1. The situation, thought and hot thought.
2. Feeling intensity before → after.
3. Belief before → after.
4. The balanced thought and how much you believe it.
5. How you feel overall.
6. Fight stats: time, parries, knockdowns, best streak, the traps you blocked most, and
   breaths taken if you completed any.
7. Every line you typed, grouped by move. Blocks are labelled with the trap they answered,
   and the Round 0 evidence appears as *"What the thought had going for it"*.

The **coping card** is a small card with your hot thought, balanced thought, best counter
and one action (from Action Uppercut), under *"Keep this for the next time the spiral
starts."*

A closing note always suggests 15 minutes of "worry time", or talking to someone, if you're
fighting the same thought most days.

Exports: Download .md, Download .txt, Print result card and Print coping card. There's also
**Fight again** (same thought and context) and **Start over**.

### Guardrails
- Every inserted text is trimmed, stripped of HTML, whitespace-collapsed and length-capped.
- Comments target the thought, never the person: no looks, body, worth, intelligence as a
  trait, self-harm or death. `test/safety.test.mjs` scans every generic line, template and
  comeback against a banned-word list.
- Self-harm language can turn up in the thought, the context, the hot thought, an "other"
  feeling or the Round 0 evidence. If it does, the opponent uses generic lines only for that
  fight, never quotes you, and a crisis banner appears above the arena.

## Tuning knobs (`src/fight/constants.js`)

| Group | Knobs |
| --- | --- |
| Names | `OPPONENT_NAME` ("THE SPIRAL"), `GRIP_LABEL`, `EMOTION_METER_LABEL` |
| `TUNING` (balance) | `gripMin/gripMax` 60/150 · `playerHp` 100 · `regenEveryMs` 3000 · `parryAt` 12 · `partialAt` 4 · `commentHit` 10–14 · `openingHitDamage` 5 · `recoverPlayerHp` 50 · `recoverGripLoss` 10 · `gripFloor` 1 · `finisherAtFraction` 0.25 · `rounds` 3 · `roundSeconds` 99 · `varietyBonus` 3 · `visibleMovesMobile` 4 · `comebackChance` 0.3 · text limits |
| `PACING` (timings) | `throwGapMs` 4000 / `throwGapCalmMs` 8000 · `windupMs` 1500 · `travelMobileMs` 12000 / `travelDesktopMs` 9000 · `travelCalmMobileMs` 18000 / `travelCalmDesktopMs` 14000 · `focusSpeed` 0.1 · `focusSpeedCalm` 0 · `focusCap` 0.9 · `focusIdleExitMs` 8000 · `breathPhaseMs` 4000 × `breathCycles` 2 · `betweenRoundsMs` 5000 |
| `DAMAGE` | per-character rate, caps, bonus size, vague threshold, repeat similarity |
| `MIX` | comment source mix, normal and calm |
| `MOVES` | names and Socratic prompts |
| `TRAPS`, `COMEBACK`, `COPY` | every line of text in Fight mode |
| Lists | `VAGUE_PHRASES`, `SPECIFIC_WORDS`, `SELF_HARM_PATTERNS`, `BANNED_WORDS`, `EMOTIONS` |

## Commands

There are no dependencies to install.

```sh
npm run build   # → dist/index.html (CSS + JS inlined, CSP hashes computed)
npm run serve   # serves dist/ on http://127.0.0.1:4173
npm test        # node:test unit tests (34)
npm run check   # unit tests, then build, then end-to-end at 375px in Chromium (needs Playwright)
```

The unit tests cover:
- damage: vague, specific, duplicate and variety
- block outcomes
- finisher gating and the GRIP floor
- Round 0 being required
- focus mode: clock, regen and throws pause, a comment never lands mid-typing, and
  8 s idle exits
- the 4 s / 8 s gaps and one comment at a time
- recovery being identical for breathe, skip and off
- rounds
- templates and keyword fallback
- fragments
- mix ratios over 1000 throws (±5%)
- no back-to-back repeats
- safe mode
- the banned-word scan
- the result-card order

`npm run check` runs the Write it out flow, then a full fight:
1. Set up with context, then Round 0.
2. Block one comment while typing slowly, and check it didn't hit.
3. Take one hit.
4. Get knocked down and skip breathing.
5. Pause.
6. Unlock and write the balanced thought, for the K.O.
7. Do the debrief and coping card, and download the .md.
8. Check safe mode.

Throughout, it asserts **0 network requests after load** and no console errors or CSP
violations.

`SHOTS=./shots npm run check` saves screenshots of each step.
`REDUCED_MOTION=1 npm run check` runs the same check with reduced motion turned on.
The check sets a test-only `window.__flipTest` (`{ timeScale, seed }`) through Playwright.
The engine itself takes an injectable clock (`tick(fight, dt)`), so unit tests need no timers.

## Deploy

Upload `dist/index.html` to any static host. On Netlify: build command `npm run build`,
publish directory `dist`.

## Structure

- `src/index.html`: one `<section>` per screen (`0–6` Write it out, `f1–f12` Fight)
- `src/styles.css`: themes, arena layout, focus desaturation, reduced motion, print modes (result card, coping card)
- `src/app.js`: Write it out flow, screen switching, downloads, reset and the theme toggle
- `src/fight/constants.js`: copy, moves, traps, templates, `TUNING` and `PACING`
- `src/fight/logic.js`: pure rules and pacing engine (`tick`), seedable RNG, result builders
- `src/fight/render.js`: canvas renderer (bitmap font, procedural pixel sprites, Kochi rooftop stage, HUD)
- `src/fight/ui.js`: screens, game loop, input, overlays, sound and the debrief
- `test/`: `logic.test.mjs` and `safety.test.mjs`
- `build.mjs`: strips import/export lines, bundles everything into one inline script, writes the CSP
