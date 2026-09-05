# Phone audit of `/` — 2026-09-05

Lane `mobile`, branch `agent/cl-mobile`, based on `agent/cl-landing`.

Everything in this directory is produced by the two scripts beside it, against a production
build (`pnpm build && pnpm start --port 3137`), never `next dev` — the CSP header and the CSS
bundle order differ between them. Nothing here is edited after capture.

| File | What it is |
|---|---|
| `mobile-audit.mjs` | Renders `/` at 360, 390, 412, 430 and 768 and records geometry plus one screenshot per scene per width. |
| `frame-sweep.mjs` | Measures the compile frame's used width at 17 viewports from 320 to 1440. |
| `column-fit.mjs` | Measures the strings cut 3 draws in its pane headers and reports the frame width they need. |
| `measurements-before.json` | `mobile-audit.mjs` against `agent/cl-landing` at 7569fe5. |
| `measurements-after.json` | The same run after this lane's changes. |
| `before/`, `after/` | 35 screenshots each, `<width>-<NN>-<scene>.png`, captured at deviceScaleFactor 2 because that is what a phone is. |

To reproduce:

```
cd <worktree>/nextjs
PLAYWRIGHT_LOCAL_HTTP=1 pnpm exec next build
NEXT_PUBLIC_SUPABASE_URL=https://test.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
  PLAYWRIGHT_LOCAL_HTTP=1 pnpm start --hostname 127.0.0.1 --port 3137
node ../docs/audit/mobile/2026-09-05/mobile-audit.mjs after ../docs/audit/mobile/2026-09-05
```

`PLAYWRIGHT_LOCAL_HTTP=1` has to be set **at build time**, not only when starting the server:
the CSP is generated in `next.config.mjs`, and without it the policy carries
`upgrade-insecure-requests`. Chromium ignores that for `127.0.0.1`; WebKit does not, and every
stylesheet and script fails with `SSL connect error` — a fully unstyled page that will happily
pass some assertions and fail the geometric ones for the wrong reason.

---

## 1. The compile film was drawing a 1440-wide composition into 350 px

`components/opening-film*.tsx` are locked and were not touched. What they do is fixed: cut 3
lays a four-column board across `clientWidth * 0.97` with `colW = (bw - 30) / 4`, draws each pane
header as a left-aligned 10px monospace title at `x + 10` and a right-aligned 10px label at
`x + w - 8`, and then sizes the canvas to `canvas.clientWidth`. None of it scales.

`column-fit.mjs`, measuring the real advance widths of the strings the film draws:

| title | live label | title px | label px | column needed |
|---|---|---|---|---|
| SOURCES | `ops-manual-r9.pdf` | 35 | 85 | **144** |
| SOURCES | `handbook-2026.pdf` | 35 | 85 | 144 |
| MARKDOWN | `PurchaseOrder` | 40 | 65 | 129 |
| ONTOLOGY | `PaymentTerms` | 40 | 60 | 124 |
| WORLD | `trace` | 25 | 25 | 74 |

144 px of column needs a 625 px frame. `frame-sweep.mjs`, measuring the frame that is actually
laid out:

| viewport | 320 | 360 | 390 | 412 | 430 | 600 | 680 | 768 | 900 | 1024 | 1280 | 1440 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| frame width | 280 | 320 | 350 | 372 | 390 | 552 | 626 | 707 | 828 | 866 | 1203 | 1354 |
| column | 45 | 55 | 62 | 68 | 72 | 113 | 131 | 151 | 182 | 191 | 275 | 313 |

So at 390 the 40 px `ONTOLOGY` title and the 60 px `PaymentTerms` label were being drawn into a
62 px column, on top of each other, four columns side by side. That is the smear in
`before/390-03-film.png` and `before/412-03-film.png`.

**The rule chosen, and why it is not 680.** The header stops colliding at about a 680 px
viewport, but a composition authored for a 1354 px frame running at 626 px — 43 % — with 8px
body type is not readable, it is merely not overlapping. The cut-off is 900 px, which is the
boundary the rest of the page already uses (`--rail` goes to 0, the scene rail disappears, the
scenes stop being full-height); below it the landing is a stacked mobile flow and the live canvas
does not belong in it. The second arm, `(pointer: coarse) and (max-width: 1023px)`, is not a
duplicate: a phone in landscape is 844–932 CSS px — an iPhone 15 Pro Max is 932 — so a pure width
rule would hand the canvas straight back to the same phone on rotation, and tablet portrait
(768–1023) is a touch device paying for an animation-frame loop at devicePixelRatio 2–3.

Below that, the existing `<video>` fallback carries the stage: poster, `muted`, `playsInline`,
one `<source>` for the admitted stage only. Two things had to be fixed for it to work at all,
because nothing had ever taken that path — a 2D context exists in every browser that reaches the
page, so `canvasReady` was always true:

- `.compile-film-video` is `opacity: 0; visibility: hidden` until `[data-active="1"]`, and the
  player never set that attribute. The fallback rendered an invisible video over a black frame.
- Swapping the `<source>` children of a live `<video>` does nothing; the element has already
  committed to the resource it loaded. The element is now keyed to the stage, which replaces it —
  and is also what keeps exactly one decoder open on a phone.

**The frame was not 16:10 either.** `ux-120-final.css` gives it a `min-height` in viewport units
(`58vw` below 720, `min(62vw, 620px)` below 1100) which wins over the `aspect-ratio: 1440/900`.
Measured before: 1.533:1 at 360, 1.549:1 at 390, 1.557:1 at 412, 1.566:1 at 430, 1.485:1 at 768.
After: 1.600 at all five. The cuts are 2880x1800.

## 2. The mobile menu opened with its left half off screen

`.mobile-primary-nav nav` was `position: absolute; right: 0` inside a `position: relative`
wrapper, so the panel's right edge was pinned to the right edge of the **MENU button** — and the
MENU button is not at the right edge of the header, the primary action is.

| viewport | 360 | 390 | 412 | 430 |
|---|---|---|---|---|
| panel left edge, before | **−93** | **−98** | **−76** | **−58** |
| panel left edge, after | 0 | 0 | 0 | 0 |

`header.nav` is `position: fixed`, which makes it the containing block for an absolutely
positioned descendant. Dropping `position: relative` from the wrapper lets the panel take
`left: 0; right: 0` off the header itself: a full-width sheet under the header at every width
from 320 to 1079. `before/390-07-menu-open.png` against `after/390-07-menu-open.png`.

Escape now closes it and returns focus to the summary; following a link closes it (the header is
shared across routes, so it used to stay open over the page just requested). It is still a
`<details>` and still traps nothing — Tab from the last link leaves the panel, which is correct
for a disclosure and is asserted in `e2e/launch-qa-mobile-nav.spec.ts`.

## 3. The header did not fit between 761 px and 1076 px

Found while checking the header at 768, which was one of the required verification widths. With
the seven desktop section links shown, the header's content ends at:

| viewport | 760 | 768 | 800 | 880 | 900 | 1000 | 1024 | 1100 |
|---|---|---|---|---|---|---|---|---|
| right edge of the primary action | 737 | **1069** | **1070** | **1072** | **1073** | **1076** | **1076** | 1076 |

From 761 to 1076 the primary action and Sign in were laid out past the right edge and clipped by
the document's `overflow-x: hidden`. A tablet visitor could read the section links and could not
reach the button the page was asking them to press, and no overflow check could see it because
the clip hides it. The links were moved to 760 px in an earlier pass on the stated grounds that
tablets "still had room for them"; the measurement says they did not. The swap is now at 1079 px.
Tightening instead does not reach 768: dropping the gap to 14 px and the KNOWLEDGE COMPILER badge
still leaves the row needing 933 px.

## 4. Stage timing

`STAGE_MS` was 5,000 ms against `FILM_DURATION = 18` in `lib/film-script.ts`. A visitor saw the
first 28 % of every cut and never one ending — including cut 3's trace line, which is its whole
argument, and cut 4's resolve at `FILM_ACT.end = 16.8`. The interval is now read from
`FILM_DURATION`; the video path also advances on the element's own `ended`. A tab press or a
swipe holds that stage and the timer is not armed for it. Reduced motion arms nothing and shows
the poster, and so does the Save-Data hint.

## 5. Touch targets

35 controls under 44 px in either axis at 360/390/412/430 (41 at 768), reduced to 5.

| control | before | after |
|---|---|---|
| MENU summary | 62x34 | 66x44 |
| stage tabs | 88x38 | 88x44 (177x44 at 768) |
| footer links (15) | 350x21 | 44 px rows |
| instrument-bar next step | 154x27 | 44 px tall |
| scene ticks (5) | 12x6 | 30x44 |
| wordmark, `.btn`, `.nav a` | 42 px | 44 px |
| Sign in | 39x42 | 44x44 |

**Not fixed: the five scene ticks are 30 px wide, not 44.** The instrument bar is one row. At
360 px it leaves 332 px inside its padding, and five 44 px targets plus the 154 px next-step
control measure 386 px. 30 px is what fits; it is above the 24x24 WCAG 2.5.8 floor with no
adjacent target closer than its own width, and it is five times the 6 px that was there. Making
them 44 px means giving up either the bar's action or the ticks, which is a design decision, not
a CSS one.

Raising Sign in to a 44 px target widened the header row by 18 px and put the access action's
right edge at 370 in a 360 px viewport. The 24 px of gap and padding recovered below 400 px is
what pays for it; there is a test that runs with a coarse pointer so this cannot regress
silently.

## Found and not fixed

- **The five scene ticks in the instrument bar are 30x44, not 44x44.** Reasoned above; making
  them 44 means giving up either the ticks or the bar's action.
- **Scene 04's evidence path wraps with a dangling arrow.** At 360 and 390 the row breaks after
  `Evidence →`, so an arrow sits at the right edge pointing at the line break rather than at the
  next step (`after/360-04-evidence.png`). It is cosmetic — nothing overflows, nothing collides,
  and no target is small — and `.evidence-path` is a landing scene block rather than a mobile
  one, so it is reported instead of edited. The fix, if it is wanted: below about 430px, stack
  the path in a column and rotate the arrows a quarter turn, which reads as a path going down
  instead of a row that ran out of room.
- **The cut is whole on a phone, and its labels are still too small to read.** The MP4 fallback
  scales the 1440x900 composition to 350px cleanly — nothing overlaps and the four columns are
  intact — but the 8–10px type inside the film is 2–3px at that scale. That is a property of a
  locked film composed for a desktop frame, not something the player can correct; on a phone the
  caption under the frame is what carries the meaning. A phone-shaped cut would be a new
  recording, which is a founder decision and outside this lane.

## What this audit did not cover

Only `/` was audited at these widths, which is what the lane was asked for. `/pricing`,
`/product/*`, `/developers`, `/explore` and the workspace were not measured; the header and
footer fixes reach every public page because the chrome is shared, and the touch floor reaches
every page with a coarse pointer, but nothing else on those pages was checked. No real device was
used — these are Chromium contexts at `hasTouch: true`, which is what `(pointer: coarse)` keys
on, not an Android Chrome on a phone.
