# Phone evidence — `agent/cl-integration` with the mobile lane merged (2026-09-06)

The "after" to [`../../2026-09-05/integration/`](../../2026-09-05/integration/), which measured the
same three defects on the same branch one merge earlier. Same method, same server, so the two are
directly comparable.

Captured by `capture.mjs` against a production build served at `http://127.0.0.1:3140`
(`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `PLAYWRIGHT_LOCAL_HTTP=1`, the same
environment `playwright.config.ts` gives its own `webServer`). Every screenshot is a **viewport**
shot, not a full-page stitch: a panel hanging off the left edge does not appear in a stitched
capture, which is exactly the defect being looked for. Every number below is read out of the live
layout by the script and written to `capture.json` — none is typed by hand, and nothing is inferred
to fill a gap.

## The three defects, before and after

| Defect (measured 2026-09-05) | Then | Now |
|---|---|---|
| Nav panel opens outside the viewport | 93 px off the left edge at 360, 76–85 px at 412, both engines | `overflowLeftPx` **0**, `fullyInsideViewport` **true**, both engines |
| Scene 03 draws the 1440-wide canvas into a ~350 px frame, so cut 3's columns overlap | live canvas at 308–370 CSS px, no video, no poster | narrow path renders the fallback instead; frame **1.597** (chromium) / **1.598** (webkit) against the film's 16:10 = 1.6 |
| `STAGE_MS` was 5 000 ms against 18 s cuts | 5 000 ms | **18 032 ms** measured (`STAGE_MS = FILM_DURATION * 1000`, `FILM_DURATION = 18`) |

## Files

| File | What it shows | Measured |
|---|---|---|
| `chromium-412x915-01-top-menu-open.png` | Landing top, MENU open | panel `left 0 → right 412`, 7 links, fully inside the 412 px viewport |
| `chromium-412x915-02-s3-01-sources.png` | Scene 03, SOURCES | frame 372×233 = **1.597**; 4 tabs on one line, none clipped; 0 text overlaps |
| `chromium-412x915-02-s3-02-read.png` | Scene 03, READ | same frame, same result |
| `chromium-412x915-02-s3-03-structure.png` | Scene 03, STRUCTURE — the cut that smeared | same frame; the four columns render distinct |
| `chromium-412x915-02-s3-04-world.png` | Scene 03, WORLD | same frame, same result |
| `webkit-360x780-01-top-menu-open.png` | Landing top, MENU open | panel `left 0 → right 350`, 7 links, fully inside the 360 px viewport |
| `webkit-360x780-02-s3-0{1..4}-*.png` | Scene 03, four stages | frame 310×194 = **1.598**; tabs on one line, none clipped; 0 text overlaps |
| `capture.json` | every measurement above, plus each shot's painter and every console error | 0 console errors in both engines |
| `capture.mjs` | the script that produced all of it | — |

## Measurements

**Stage-1 auto-advance — 18 032 ms** (chromium). Measured on a page nobody has tapped, because
tapping a tab *holds* that stage and would disarm the timer being measured. The harness arms its
own `IntersectionObserver` on `.compile-film-sequence` at threshold 0.35 — the same element and
threshold the component uses — so t0 is the moment the component's timer arms, not the moment the
script scrolled. Three runs: 18 010 / 18 028 / 18 032 ms. Not measured in WebKit (see below).

**Horizontal overflow — none.** `documentScrollWidth` ≤ `innerWidth` at the top of the page and
again at Scene 03, in both engines (412 → 412, and 350 against a 360 px viewport).

**Header at 360 px, worth knowing:** nothing overflows — header `scrollWidth == clientWidth` at 360,
390, 412 and 430 — but `Sign in` ends 2 CSS px short of the right edge at 360 (`right = 358`). Inside,
with no margin left. It reads as clipped in the raster and is not.

## Two limits of this capture, stated rather than hidden

1. **WebKit's four Scene 03 shots were taken with `prefers-reduced-motion: reduce`**
   (`stageShotsReducedMotion: true` in `capture.json`). With motion allowed, Playwright's
   WebKit-on-Windows wedged on all four — click, screenshot and measurement all timed out, three
   runs in a row — so the alternative was no WebKit stage evidence at all. Reduced motion renders
   the identical frame from the authored 1440×900 poster still instead of the fallback `<video>`,
   so every geometry question asked here is answered on the same layout; `painter: img` in
   `capture.json` records that this is what happened. It evidences nothing about playback.

   A probe isolated the cause and it is not the one that looks obvious: with the MP4 allowed to load
   and left *playing*, `evaluate` and `screenshot` both succeed; with the MP4 request aborted, both
   hang. A `<video>` that has been interfered with wedges this WebKit build, so nothing in
   `capture.mjs` pauses, blocks or mutes a decoder.

   **This is a Playwright-WebKit-on-Windows limitation, not a finding about iOS Safari** — a
   different port with a different media stack, which cannot be tested from this machine. It is
   neither a pass nor a failure there, and a real-device check is the only thing that settles it.

2. **The stage-1 hold is a chromium number.** WebKit's measurement needs a motion-allowed page,
   which is the state that wedges; the harness timed out and `capture.json` records
   `{"measured": false, "reason": "harness timeout"}` rather than a borrowed number.

## What this evidence does not claim

Cut 3's columns no longer overlap and the frame is the film's real 16:10 — but the raster is still
the 1440×900 composition scaled into a 372 px frame, so its body type is small. "The columns are
distinct" is what was measured; "the text inside them is comfortable to read on a phone" was not,
and the open founder decision on a phone-shaped re-record of cut 3 stands on its own merits.
