# Flip

A private CBT scratchpad for overthinking and catastrophising. There are two ways to use it.

- **Write it out.** Five calm steps: write the worst case, the absurdly good case,
  what will most likely happen, and one move you can make. Then re-rate how much you
  believe the original thought.
- **Fight it.** The same idea as an arcade fighter. Your thought becomes the opponent
  (ANXIETY), and you knock it down by typing counter-arguments.

## Privacy

- The whole app is one static HTML file. There's no backend and no accounts,
  analytics, cookies or trackers.
- Everything is held in memory. Nothing goes to localStorage, so closing the tab clears it.
- The Content-Security-Policy is pinned to a hash (`default-src 'none'; connect-src 'none'`),
  so the page can't make a network request, even by accident.
- All the art is CSS and inline SVG. There are no remote fonts or images.
  Fight-mode sound is generated in code with Web Audio and is off by default.
- The only links out are the helplines in the footer (`tel:14416`, findahelpline.com),
  and they only open when tapped. The footer stays visible during the fight too.

## Fight mode

1. **Setup.** Write the thought (at least 20 characters), then rate how strong it is from 0 to 100.
   The rating sets ANXIETY's starting HP, size and darkness. Then: ROUND 1 / FIGHT!
2. **Fight.** Pick a move, type a line and press Enter:
   - Evidence Jab: a fact that goes against the thought
   - Flip Kick: the absurdly good version
   - Reality Check: what will most likely actually happen
   - Action Uppercut: one thing I can actually do
3. **Damage.** Tap **?** in the fight to see these rules.
   - Base damage is about 1 point per 4 characters, up to 15.
   - +5 each (max +15) for a number or date, a grounding word ("because", "last time",
     "even if", "evidence", "actually"…), or a name or place mid-sentence.
   - A short line (under 25 characters) or empty reassurance ("it'll be ok") does at most 3:
     *"Too vague. Get specific."*
   - A near-duplicate of a line you already used does 0: *"Already used that one."*
   - Landing a real hit with all four move types unlocks the **FULL FLIP** finisher (25 damage).
4. **No game over.** ANXIETY grows +1 HP for every 3 seconds you're idle. If it reaches 100,
   the fight pauses for two cycles of box breathing (4 in, 4 hold, 4 out, 4 hold).
   After that ANXIETY loses 15 HP and the fight resumes.
5. **K.O.** ANXIETY shrinks to a tiny blob. It isn't destroyed:
   *"Anxiety's small now. It may come back. You know the moves."*
   Next you re-rate the thought and say how you feel. The result card shows strength
   before and after, your feeling, the fight time, and every line you typed, grouped by move.
   You can export it as .md, .txt or print/PDF, or choose Fight again or Start over.

With reduced motion turned on, there's no shaking and no flashing. On phones the arena takes the top of the
screen and the moves and text box sit at the bottom, so the keyboard doesn't cover them
(this uses `interactive-widget=resizes-content` and `visualViewport`).

## Commands

There are no dependencies to install.

```sh
npm run build   # → dist/index.html (CSS + JS inlined, CSP hashes computed)
npm run serve   # serves dist/ on http://127.0.0.1:4173
npm test        # unit tests for the fight logic (node:test)
npm run check   # unit tests, then build, then end-to-end at 375px in Chromium (needs Playwright):
                #   the Write it out flow, plus a full fight (breathing break, vague, repeat,
                #   combo, K.O., debrief), downloads the .md files and asserts 0 network
                #   requests after load
```

`SHOTS=./shots npm run check` saves a screenshot of each step.
`REDUCED_MOTION=1 npm run check` runs the same check with reduced motion turned on.
The check runs fight timers 10× faster through a test-only `window.__flipTimeScale`,
which it injects with Playwright. Real users always run at 1×.

## Deploy

Upload `dist/index.html` to any static host (Netlify, GitHub Pages, S3...).

## Structure

- `src/index.html`: markup, one `<section>` per screen (`0–6` for Write it out, `f1–f6` for Fight)
- `src/styles.css`: tokens, light/dark themes, the arena, reduced motion, and a print stylesheet that prints only the card
- `src/app.js`: Write it out flow, screen switching, downloads, reset and the theme toggle
- `src/fight/constants.js`: all fight copy, taunts, phrase lists and tuning numbers
- `src/fight/logic.js`: pure fight rules (damage, idle growth, combo, taunts)
- `src/fight/ui.js`: fight DOM, timers, effects, breathing break and sound
- `test/logic.test.mjs`: unit tests for the damage function and the other rules
- `build.mjs`: strips import/export lines from the modules, bundles everything into one
  inline script and writes the CSP
