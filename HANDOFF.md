# HANDOFF — lane `first-screen-demo-poster` (Release 3, 2026-10-15/16)

Branch `codex/r3-demo-20261015`, base `codex/home-release3-20261015` (main `dbe22b1e`).
Receipts: `outputs/tavonel-research-replan-20261013/resume-20261015/redesign-r3-20261015/demo/`
(abbreviated `demo/` below). Self-approval does not apply: this lane implemented, it does not approve.

Goal: a reader can read the demo text on the first screen at 1440 and at 390.

## What changed and why

### (A) Poster Tier 1 re-cut (+ Tier 2 mask on stage 1)

- **Eight new posters** in `nextjs/public/film/`: `poster-1-t3.00(-2x).webp` and `poster-{2,3,4}-t17.96(-2x).webp`.
  - 2x is 2880×1800. 1x is 1440×900 (lanczos3).
  - Encoder: sharp 0.35.4 (libwebp 1.6.0, libvips 8.18.6), WebP q82, `smartSubsample`, effort 6.
  - Rows are in `public/film/README.md` and in `lib/locked-film-assets.json` → `posters[]` + `posterEncoder`. Each row records: file, size, bytes, sha256, cut, cut sha256, frame t and frame PNG sha256.
  - The posters get new filenames rather than overwriting, because `/film/*` is served `immutable` for a year.
  - The old posters stay byte-identical, since non-Home callers still use `COMPILE_STAGES` (`poster-2/3/4.webp`) and the main304 SSR parity fixture holds.
- **Stages 2–4** use the t=18 candidates (drawn at 17.96 s of the 18.00 s cuts).
- **Stage 1 fine search** (`demo/STAGE1-SEARCH.md`, contact sheets, 73 frame hashes):
  - Method: Playwright + Chrome 155 seeking a `<video>` every 0.25 s from 0 to 18.00 s.
  - **No frame is free of the label overprint.** Every document in cut 1 draws its eyebrow over its title in both ORIGINAL and EXTRACT, in all 73 frames.
  - So t=3.00 was chosen (same document in both panes, EXTRACT page ends on a complete line, 12 working-copy lines, WORLD populated) and **Tier 2 applied**.
- **Tier 2 mask:** `STAGE_FRAMES.sources.posterMask` in `components/compile-stage-player.tsx`.
  - Two paper-colour bars (`#f2eee7`) over the eyebrow line. Source px: ORIGINAL 796,206 282×11; EXTRACT 1499,204 278×9.
  - The bars stop above the title cap line, so 2–3 eyebrow rows stay, touching the caps. The masked region is documented in the README "Tier 2 mask" table.
  - It is an inline SVG (`viewBox 0 0 2880 1800`, `xMidYMid meet`) in the still's box. That gives it the still's `object-fit: contain` fit and the same crop transform.
  - The first version was a %-positioned span. It sat about 3 CSS px above the eyebrow on a 390 phone, whose frame is 348×224, not 16:10. That was found in the built browser and fixed. The e2e and hosted-QA now check each bar to within 0.5 px.
  - It is drawn only over the still whose path it names, never over the playing cut or `<video poster>`.
- **Films byte-identical:** the 6 mp4 files and the 6 old webp files have the same sha256 before and after (`demo/film-hashes-before.txt`, `demo/film-hashes-after.txt`).

### (B) Reading layer and the default desktop crop

- **Desktop (≥900 px, not narrow) opens on a 2× Focus crop** of each stage's two reading panes. `STAGE_FRAMES[*].crop` is passed as `--film-crop-x/-y`.
  - The crops are: sources x.25 y.20, read x.25 y.25, structure x0 y0, world x.5 y.45.
  - Mechanism: `transform: scale(2) translate(...)` on the video, the still and the mask. The box is unchanged, so layout and CLS are unchanged.
  - The poster shows until play with the same crop, because the still and the video carry the same transform.
- **A "Fit full frame" / "Focus details" button** (KO: "전체 프레임 보기" / "세부 내용 확대") sits on the desktop. It uses `aria-pressed`, is 44 px tall, has a focus-visible outline and no transition.
  - The phone keeps its own Fit/Focus toggle, so exactly one of the two is ever displayed.
- **Pane strip:** in crop mode it names only the window's two panes (`data-in-crop`). Pane labels and the view control are 15 px on a desktop. The reading line is 16 px on a desktop and 15 px on a phone.
- **Phone Focus surface:** 1960×1225 (0.68 CSS px per source px), up from 1120×700. It scrolls to the crop row on open.
- **Phone Fit is still the phone default** (brief §2 plus the contract tests). This is a decision flag; see below.
- **Posters are served as 1x/2x `srcset`**: `sizes` is `(min-width: 900px) 2400px, 100vw`, or `1960px` in phone Focus.
  - A phone in Fit takes the 102 KB 1x file. A desktop takes the 256 KB 2x file.
  - The preload carries `imageSrcSet`/`imageSizes`. React does not put a srcset preload in the HTTP `Link` header (verified in `react-dom-server.node.production.js`). The early hint is therefore the `<link rel=preload fetchpriority=high>` in the streamed `<head>`.

## Measurements (`demo/LEGIBILITY.json`, `demo/READING-LAYER-FONTS.json`, `demo/CROP-CHECK.json`)

"Equivalent type size" is the rendered x-height ÷ the x-height ratio of the page sans.
- The ratio (Wanted Sans) was measured in the browser with canvas `measureText("x")`: **r = 0.5048**, the same in Chrome and WebKit.
- The smallest text in each crop window is 7 source px of x-height in stages 1–3 and 11 in stage 4.

| Width | View | CSS px / source px | Smallest rendered x-height | Equivalent | Target |
|---|---|---|---|---|---|
| 1440, 1280, 1920 | crop (default) | 0.8319 | 5.82 px (stage 4: 9.15) | **11.53 px** (stage 4: 18.12) | ≥ 11 ✓ |
| 1024 | crop (default) | 0.6742 | 4.72 px | 9.34 px | not set by the brief |
| 390, 360 | Focus details | 0.6806 | 4.76 px (stage 4: 7.49) | **9.43 px** (stage 4: 14.82) | ≥ 9 ✓ |

- The figures are the same for EN and KO, with or without reduced motion, and in Chrome and WebKit.
- Reading layer font sizes:
  - Line: 16 px on a desktop, 15 px on a phone.
  - Pane labels: 15 px on a desktop, **13 px on a phone** (see Not done).
  - View control: 15 px on a desktop. The phone's shared focus control is 14 px.
  - Caption: 15 px.

## Tests and specs changed (and why)

**Unit (vitest):**

- `components/compile-stage-player.mobile-view.test.tsx` gets a new describe block, "Home Focus crop and re-cut posters (Release 3)":
  - Each quoted string stays inside its stage's 2× window at all 10 sampled seconds.
  - The crop markup and the Fit control are present in EN and KO, and non-Home markup has none of it.
  - srcset/sizes and the mask binding are correct.
  - The R2 regex now allows the new `data-in-crop` attribute on the marked pane. Its assertion is unchanged.
- `lib/one-path-contract.test.ts`:
  - New `it.each(films.posters)` checks each re-cut poster's bytes and sha, and that its cut sha equals the locked `files` row.
  - The hero poster path is updated.
- `lib/landing-v2-page.test.ts`: the hero poster path is updated.
- `components/compile-stage-player.frame-strings.json` gets a new `cropCheck` table (box, y per sampled second, smallest x-height).

**e2e:**

- `e2e/hero-home-responsive.spec.ts` gets a new test, "the film opens on a readable crop at 1440 and reads at 9px or more in phone Focus". It covers:
  - crop default and zoom 2 on every stage
  - measured equivalent ≥ 11 at 1440 and ≥ 9 at 390 Focus
  - 2 named panes, with labels and control ≥ 15 px
  - the Fit/Focus round trip by click and by Enter
  - the stage-1 mask bars on the contained picture to within 0.5 px, at 1440 Fit and 390 Fit
  - no horizontal overflow
  - both motion settings
- `e2e/landing-v2.spec.ts` "server-renders the visible film poster…" now checks the `<head>` preload instead of the HTTP `Link` header, which React cannot carry for a srcset. It checks:
  - exactly one image preload in `<head>`
  - `fetchpriority=high`, with an exact imagesrcset
  - the `Link` header carries no stale poster
  - the priority `<img>` src and srcset
  - The existing eager, width and height checks are kept.
- `e2e/landing-hero-mobile.spec.ts`: a phone in Fit now expects `currentSrc` to be `poster-1-t3.00.webp` (the 1x file), instead of `poster-1-hero-2x.webp`.
- `e2e/hero-four-stage-restoration.spec.ts`: `data-wide-view="crop"`, and a "Fit full frame" button exists iff the viewport is ≥ 1024.
- No test, guard or budget was deleted, skipped or weakened.

**Hosted QA:** `demo/tools/hosted-qa.cjs`, generated from the R2 script by `demo/tools/make-hosted-qa.cjs`. Changes:
- The new poster list.
- New checks: `crop.desktopDefault`, `crop.legible`, `crop.legibleReduced`, `crop.legibleEachStage`, `crop.toggleRoundTrip`, `poster.recut` (1x on phone, 2x on desktop), `poster.tier2Mask` (bar-level ≤ 0.5 px) and `focus.legible`.
- The frame's 1 px border is allowed for (±6/±3 px on the drawn-width check).

## Runs

- Prebuild full vitest: **404 files / 5966 tests passed** (`demo/build-1.log`). This ran before the SVG-mask and 15 px label edits, which are covered by the Home vitest set, `pnpm check` and the e2e runs below.
  - `next build` then crashed at "Collecting page data" with Windows exit 3221226505. The band and polish lanes' logs show the same crash at the same time. It is a load/worker crash, not a code failure.
  - Builds pass with `CIRCLE_NODE_TOTAL=3` (2 page-data workers): `demo/build-4..7.log`. The final build is `build-7`.
- `pnpm check` (brand:verify, type floor, tsc, eslint): pass (`demo/check-final.log`).
- Home vitest set, 30 files / 638 tests: pass (`demo/vitest-home-final.log`).
- Playwright, Chrome channel (`demo/tools/pw-chrome.config.mjs`) against `next start` on **:3122**:
  - Specs: hero-home-responsive, landing-v2, landing-hero-mobile, hero-four-stage-restoration, evidence-first, marketing-story, premium-craft, visual-continuity, visual-refinement.
  - Projects: 1920/1440/1280/1024/768/390/360 and reduced-motion.
  - Result: **421 passed, 35 skipped (spec-level skips), 0 failed** (`demo/e2e-3.log`, `demo/e2e-3.json`).
- Playwright WebKit (`demo/tools/pw-webkit.config.mjs`): 5 passed, 2 failed (`demo/e2e-webkit.log`).
  - Passed: poster SSR, the reduced-motion poster, the phone Fit poster, and more.
  - Failed: the new legibility test (its no-preference half) and landing-hero-mobile:49 (play → fallback). Both need the cut to play.
  - Cause: Playwright's Windows WebKit hangs the page once the film tries to play. Reproduced on live **tavonel.com** (pre-change build, old poster) with `demo/tools/wkdebug2.cjs`, so it is not caused by this lane.
  - The WebKit legibility probe under reduced motion gives the same numbers as Chrome (`demo/shots-2/MEASURE-webkit.json`).
- Hosted QA (Chrome) on :3122: **143 assertions, 0 failed** (`demo/hosted-qa-1/QA.json`).
- Screenshots: `demo/shots-2/` covers:
  - EN/KO at 1440 and 390, with and without reduced motion
  - 1024, 1280, 1920 and 360
  - every stage, in crop or Focus
  - stage 1 in Fit
  - WebKit

## Not done / decisions for the reviewer

1. **Phones open on Fit, not Focus.** The brief §2 says "Fit 기본", and contract tests pin it. The 9 px target is met only after one tap on "Focus details". Opening phones on Focus is a one-line change (`LANDING_MOBILE_FILM_VIEW`), but it is a product decision and the fit-default contract tests would have to change.
2. **Phone pane labels stay 13 px.** At 15 px, MARKDOWN (90.7 px) and ONTOLOGY (85.7 px) outgrow a 77–85 px quarter column at 360–390 and would break mid-word. MARKDOWN already breaks at 13 px at 360 (78.6 > 77), a Release 2 issue this lane did not fix. The phone's shared focus control is 14 px.
3. **The first screen at 1440×900 shows only the top ~328 px of the 750 px frame.** That part is readable document text, but the reading line and `WORKING COPY.md` are below the fold. The hero layout above the film belongs to the hero lane.
4. **The video pixels are not masked (Tier 3 not done).** The playing cut and `<video poster>` keep the eyebrow overprint. Only the stage-1 still is masked.
5. 1024 measures 9.34 px equivalent in the crop. The brief sets no 1024 target. A 2.5× crop at ≤ 1279 would lift it if wanted.
6. The consent card (Release 2) can cover the lower-left of the film after scrolling, including the stage-2 target, until it is answered.
7. No threshold here is calibrated. The 11/9 px targets come from the brief and are measured, not validated with readers.
