# Landing ↔ Explore visual continuity — 2026-09-05

Blueprint §29: compare Film Cut 4's locked frame (`__filmSeek(16.8)`) against the Explore stage's initial snapshot. Not required to be pixel-perfect; the point is to catch drift in focal object, node layout, relation topology, camera bounds, key labels, state color and major geometry.

## Route note

Lane contract §29 named `/film-4` as the film route. That route is now `notFound()` — a deliberate stable 404 for a retired inbound URL (`app/film-4/page.tsx`). Cut 4 (`opening-film-4`) itself is not retired: it renders inline as the "WORLD" tab of `CompileStagePlayer` in the landing page's Scene 03 (`#s3`). Per repo-root `CLAUDE.md` and lane contract §0.2 (code wins over a disagreeing document), this capture reaches the cut through `/#s3` → click `#compile-stage-tab-world`, not through `/film-4`.

## Cut 4 (film side)

- Route: `http://127.0.0.1:3136/#s3` → `#compile-stage-tab-world`
- Hooks used: `window.__filmFreeze = true`, `window.__filmSeek(16.8)`. Observed on `window` in the running page before the seek: `__filmSeek` → function, `__filmElapsed` → number, `__filmFreeze` → undefined (the film reads that flag in its rAF tick and never defines it, so `undefined` before the capture sets it is the expected observation). The capture refuses when `__filmSeek` is not callable.
- Seek/freeze verified by frame digest: seeking 3.2s → 16.8s changed the frame (yes: sha256 `5c646fd36dae3209…` → `647e9a8094865a86…`), and the frame did not move over a 350ms hold (yes: `647e9a8094865a86…`). sha256 of a 320x180 downscale of the canvas, taken in-page at the probe beat, at the locked beat, and again after a hold at the locked beat. Within-run change detection only — the digests are renderer-specific and are not a cross-machine baseline.
- Canvas found: yes
- Canvas backing store: 2704×1494px (device pixels, DSF 2)
- Canvas CSS size: 1351.59375×746.796875px
- Drawn-geometry data exposed on `window`: no — opening-film-4 exposes no drawn-geometry data structure (nodes/edges/labels) on window, so this capture records the PNG and the canvas backing size only. Capture hooks as observed in the page: __filmSeek=function, __filmElapsed=number, __filmFreeze=undefined before this script set it (the film reads that flag in its rAF tick and never defines it; typeof after setting it: boolean). The seek and the freeze were verified by frame digest — see seekVerification.
- Console/page errors during capture: 0
- Image: `cut4.png`

## Explore stage (world side)

- Status: **pending**
- Reason: The explore stage root [data-visual-world="explore"] was not found at /explore?act=world. Lane contract §4.2 defines this attribute for the redesigned Explore stage, which the `explore` lane (agent/cl-explore) builds in parallel and had not landed on this branch at capture time. This is expected, not a failure — the screenshot records whatever /explore currently renders on this branch (the pre-redesign page), for reference only; it is not the Interactive Product Film the comparison is meant to check. Re-run this script once the explore lane's markup is merged.
- Console/page errors during capture: 0
- Image: `explore.png` (current /explore on this branch, not the redesigned stage — reference only)

## Comparison

Not yet possible: the explore side has no `[data-visual-world="explore"]` markup on this branch. This is `not_yet`, not a failed comparison — re-run this script after the `explore` lane merges its Interactive Product Film rebuild.

## Reproduce

```bash
cd nextjs && pnpm build && pnpm start --hostname 127.0.0.1 --port 3136 &
VISUAL_CONTINUITY_BASE=http://127.0.0.1:3136 node scripts/visual-continuity.mjs
```
