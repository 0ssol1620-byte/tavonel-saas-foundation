# Phone evidence — integration branch, 2026-09-05

What a phone actually renders on `agent/cl-integration` after the seven Category Leadership
lanes were merged, captured by `capture.mjs` against a production build (`pnpm build` +
`pnpm start --port 3140`) of commit `43bd91a`.

**The mobile lane is not in this branch.** `agent/cl-mobile` — the lane implementing the
founder's three phone defects — had not reached `origin` when the integration window closed, so
these screenshots are the *unrepaired* state. That is what makes them worth committing: they are
the measured "before" the mobile fix will be judged against, taken on the integrated build
rather than on any one lane's branch.

## What was captured

Two browsers (chromium, webkit) × two viewports (360×780, 412×915), `deviceScaleFactor: 2`:

- `<browser>-<viewport>-top-menu-open.png` — the top of `/` with the primary navigation open.
- `<browser>-<viewport>-s3-0N-<stage>.png` — Scene 03 at each of its four stages
  (SOURCES, READ, STRUCTURE, WORLD), selected through the real tab control.

Every shot is a **viewport** screenshot, not a full-page one. A full-page capture stitches the
whole document and would have hidden the first defect completely: an off-screen panel is inside
the stitched image and looks fine.

`capture.json` holds the measurements the screenshots are evidence of. Nothing in it was typed
by hand.

## Defect 1 — the navigation panel opens off the left edge

Measured as the panel's own rectangle against the viewport, with the menu open:

| Browser | Viewport | Panel left..right | Panel width | Off-screen to the left |
|---|---|---|---|---|
| chromium | 360×780 | −93 .. 188 | 281 | **93 px** |
| chromium | 412×915 | −76 .. 224 | 300 | **76 px** |
| webkit | 360×780 | −93 .. 188 | 281 | **93 px** |
| webkit | 412×915 | −85 .. 215 | 300 | **85 px** |

A third of the panel is outside the viewport at 360 px in both engines, which is why the
screenshots show menu labels cut off mid-word. `document.documentElement.scrollWidth` stays at
or below the viewport width in every run, so the page does not scroll sideways to reveal it —
the panel is simply unreachable.

## Defect 2 — Scene 03 draws the live canvas at phone width

The stage panel paints a `<canvas>` in all sixteen stage shots. No `<video>` and no poster
`<img>` is used at any phone width:

| Browser | Viewport | Canvas CSS size | Backing store |
|---|---|---|---|
| chromium | 360×780 | 318 × 207 | 636 × 414 |
| chromium | 412×915 | 370 × 237 | 740 × 474 |
| webkit | 360×780 | 308 × 207 | 616 × 414 |
| webkit | 412×915 | 360 × 237 | 720 × 474 |

The films are composed for a wide stage. At ~310 CSS px the four labelled columns of cut 3
overlap into each other — visible in `*-s3-03-structure.png`, where "SOURCES", "MARKDOWN",
"ONTOLOGY" and their body text are drawn on top of one another. This is the founder's "film
canvas unreadable below ~900 px", reproduced and measured rather than described.

## Defect 3 — stage auto-advance

Not measurable from a screenshot, and this capture does not claim it. `STAGE_MS` in
`nextjs/components/compile-stage-player.tsx` is `5_000` on this branch; the cuts run 18 s. The
capture selects each stage explicitly and shoots immediately, so the timing never affected these
images.

## Console

Zero console errors and zero page errors in all four runs.

## Reproduce

```bash
cd nextjs && pnpm build && pnpm start --hostname 127.0.0.1 --port 3140 &
MOBILE_EVIDENCE_BASE=http://127.0.0.1:3140 node docs/audit/mobile/2026-09-05/integration/capture.mjs
```
