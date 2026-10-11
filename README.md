# Flip

A private CBT scratchpad for overthinking and catastrophising. It walks you through
the worst case, the absurdly good case, what will most likely happen, and one move,
then asks you to re-rate how much you believe the original thought.

## Privacy

- One static HTML file. No backend, accounts, analytics, cookies or trackers.
- Everything stays in memory, with no localStorage. Closing the tab clears it.
- A hash-pinned Content-Security-Policy (`default-src 'none'; connect-src 'none'`)
  stops the page from making any network request, even by accident.
- The only links out are the helplines in the footer (`tel:14416`, findahelpline.com),
  and they only open when tapped.

## Commands

No dependencies to install.

```sh
npm run build   # → dist/index.html (CSS + JS inlined, CSP hashes computed)
npm run serve   # serve dist/ on http://127.0.0.1:4173
npm run check   # build, then run the full flow at 375px in Chromium, download the .md,
                # and assert 0 network requests after load (needs Playwright)
```

`SHOTS=./shots npm run check` also saves a screenshot of each step.

## Deploy

Upload `dist/index.html` to any static host (Netlify, GitHub Pages, S3...).

## Structure

- `src/index.html`: markup, one `<section>` per step
- `src/styles.css`: tokens, light/dark themes, reduced motion, print stylesheet (prints only the card)
- `src/app.js`: in-memory state, step gating, export (.md/.txt), reset, theme toggle
- `build.mjs`: inlines everything and writes the CSP
