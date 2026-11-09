# Film atmosphere assets

These files are **CC0** (public domain). They are grain and studio plaster only —
they never appear as stock photography of offices or people. Compile scenes are
still drawn from TAVONEL's own fixture (`demo-world`).

| File | Source | License |
|---|---|---|
| `paper-color.jpg` | ambientCG Paper001, 1K Color | CC0 1.0 |
| `plaster-1k.jpg` | Poly Haven `plastered_wall_02` 1K Diffuse | CC0 |

- ambientCG: https://ambientcg.com/a/Paper001
- Poly Haven license: https://polyhaven.com/license
- Poly Haven asset: https://polyhaven.com/a/plastered_wall_02

No attribution is required. Credit is recorded here so a provenance page can
show where the grain came from.

## Home posters — Tier 1 re-cut (Release 3, 2026-10-15)

One frame of each locked cut, drawn by Chrome 155.0.8059.40 seeking a `<video>` to *t* and copying the 2880×1800 frame to a canvas (PNG), then encoded with sharp 0.35.4 (libwebp 1.6.0, libvips 8.18.6): WebP quality 82, `smartSubsample`, effort 6. The 1x file is a lanczos3 resize of the same frame. The four `compile-cut*.mp4` files are unchanged (their rows are `files` in `lib/locked-film-assets.json`; these rows are its `posters`, and `lib/one-path-contract.test.ts` holds both to their bytes). The earlier posters (`poster-1-hero-2x.webp`, `poster-1-hero.webp`, `poster-1.webp` … `poster-4.webp`) stay byte-identical; Home no longer uses them. New file names rather than new bytes under old names, because `/film/*` is served immutable for a year.

| File | Stage | Density | Size | Bytes | sha256 | Cut | Frame *t* | Cut sha256 |
|---|---|---|---|---|---|---|---|---|
| `poster-1-t3.00-2x.webp` | 1 | 2x | 2880×1800 | 256,358 | `1acb30d68a62a351a8c1233df002150241bf5eeec2217e0af2f5e3235eda31c0` | `compile-cut.mp4` | 3.00 s | `1406a9a8d6e537eadd97012c94c89ffc792276628f30fa8313ea892c8dd169b9` |
| `poster-1-t3.00.webp` | 1 | 1x | 1440×900 | 102,344 | `70db5d61df9f4ddb87ec92241bbc60eb4f2cba8ea32489ecddd35bf1814bfead` | `compile-cut.mp4` | 3.00 s | `1406a9a8d6e537eadd97012c94c89ffc792276628f30fa8313ea892c8dd169b9` |
| `poster-2-t17.96-2x.webp` | 2 | 2x | 2880×1800 | 364,308 | `8d381efe68e406ac0dd0cca683e3a34013d299140ca119751f9d8400e6ec2282` | `compile-cut-2.mp4` | 17.96 s | `d0496e6e80f83b9a11ccb647c1b23de54d7ad22d7163f2ddd4f0ae58d7152c6d` |
| `poster-2-t17.96.webp` | 2 | 1x | 1440×900 | 141,706 | `921686510510b7251da4c09c4dcfd6603340cc5a3b0a782deafa9ab72833fa37` | `compile-cut-2.mp4` | 17.96 s | `d0496e6e80f83b9a11ccb647c1b23de54d7ad22d7163f2ddd4f0ae58d7152c6d` |
| `poster-3-t17.96-2x.webp` | 3 | 2x | 2880×1800 | 201,410 | `d7553131876580c15c8f6f80eba0aae4789140e7878ed9326db2b84e41500690` | `compile-cut-3.mp4` | 17.96 s | `c6d35a3a43f08e54381e7e15cb86908a70184d51726baebc52b766ac9d7f54a0` |
| `poster-3-t17.96.webp` | 3 | 1x | 1440×900 | 72,860 | `920dd8c78f174f3664f585d9ca2e9fb093a5819365bc8d35458e470b173d9e37` | `compile-cut-3.mp4` | 17.96 s | `c6d35a3a43f08e54381e7e15cb86908a70184d51726baebc52b766ac9d7f54a0` |
| `poster-4-t17.96-2x.webp` | 4 | 2x | 2880×1800 | 191,694 | `3fd52503c3615647e5c0587f9b5ce43d12c432f0e14c9e3cca34a48840d58912` | `compile-cut-4.mp4` | 17.96 s | `480c7479ca2a7f3ab73291016c4d64c20bee6e6967f43444bde44e117e0cf732` |
| `poster-4-t17.96.webp` | 4 | 1x | 1440×900 | 80,582 | `77625e4584b4723fd1e53bd9c0254bcedd9505d8c8386b61d2901be47d095089` | `compile-cut-4.mp4` | 17.96 s | `480c7479ca2a7f3ab73291016c4d64c20bee6e6967f43444bde44e117e0cf732` |

- Stages 2–4: the Release 2 candidates, selected by the Release 3 orchestrator under the founder's 2026-10-03 delegated authority; the founder's veto is open (RESUME-20261015-LEDGER). No founder approval of the re-cut is on record. (`poster-candidates/stage-<n>-t18.png`, drawn at 17.96 s of an 18.00 s cut; PNG sha256 `fd3c6992362c58320f7892ff7c9550900d54cbbb753afa12904d1143dc7e1035`, `800460fdc789634c0d325e5dd903e550f0b7bf81e15176a4a5be560109641610`, `f6eab683949c55a50454cecd0759f2a45a18acd0c33cb6dbea3ba832cdf7cf3b`).
- Stage 1: a fine search of `compile-cut.mp4` every 0.25 s from 0 to 18.00 s (73 frames; the cut is 18.00 s long). t = 3.00 s is the frame chosen: ORIGINAL and EXTRACT show the same document (Operations Manual), the EXTRACT page ends on a complete line, `WORKING COPY.md` has 12 lines, WORLD is populated. PNG sha256 `714ee095c83002fd00ab5ce708ad47e59149fb7f5afe4f430159641d64d0c425`.
- **No stage-1 frame is free of the label overprint.** Every document page in cut 1 draws its eyebrow (`OPERATIONS · INTERNAL · REV 9`, `ACME HOLDINGS · CONFIDENTIAL`, `SCAN 0140 · NO TEXT LAYER`, `PEOPLE · POLICY`, `FINANCE · MODEL`) over its title in ORIGINAL and EXTRACT, in all 73 frames. So stage 1 also takes the Tier 2 mask below.

### Tier 2 mask — stage 1 poster only

An HTML overlay (`.compile-film-mask`, `STAGE_FRAMES.sources.posterMask` in `components/compile-stage-player.tsx`) draws two paper-coloured bars (`#f2eee7`, the measured page background) over the eyebrow line of `poster-1-t3.00-2x.webp` (and its 1x copy). It is an inline SVG with `viewBox="0 0 2880 1800"` and `preserveAspectRatio="xMidYMid meet"` in the still's own box, so it gets the same contain fit as the still (a phone frame is not exactly 16:10) and the same 2x crop transform. Coordinates are source pixels of the 2880×1800 frame:

| Pane | x | y | w | h | Covers | Leaves |
|---|---|---|---|---|---|---|
| ORIGINAL | 796 | 206 | 282 | 11 | eyebrow rows 209–216 (of 209–218) | rows 217–218, which overlap the title's cap tops (title ink starts at row 217) |
| EXTRACT | 1499 | 204 | 278 | 9 | eyebrow rows 207–212 (of 207–215) | rows 213–215, over the title's cap tops (title ink starts at row 213) |

- The bars stop above the title, so no title pixel is covered; 2–3 rows of eyebrow ink stay touching the cap line (about 1 CSS px at Fit on a 1440 screen).
- The mask is drawn only while the still is showing and only over the poster whose path it names. The playing cut, and the `<video poster>` frame before playback starts, are not masked: the overprint stays in the video pixels (Tier 3, re-rendering the cuts, was not done).
- In the desktop Focus crop the stage-1 window (rows 900–1800, since the Release 3 fix round) does not include the eyebrow line, so the bars are drawn but fall outside the window.

## Home posters — POSTER-RECUT (D-11, 2026-10-19)

DESIGN_MASTER_V3 §22 budgets the hero poster at **≤ 140KB AVIF**, and the register's D-11 asks for a Tier 1 re-cut (another frame of the same cut) inside that budget. Home now serves every still as AVIF through a `<picture>`, with a WebP pair of the same frame as the fallback (`posterAvif` / `posterAvif1x` in `components/landing-v2/hero-film.tsx`); the stage-1 preload names the AVIF srcset with `type="image/avif"`, so a browser that cannot decode AVIF skips it and takes the WebP. The `<video poster>` names whichever format the still took. The four `compile-cut*.mp4` files are unchanged, and the Release 3 posters above stay byte-identical and locked; Home no longer uses the stage-1 and stage-2 ones.

**Encoders.** Frames: ffmpeg 8.1.2, input seek to *t*, BT.601 limited → full range (the cuts carry no colour tags; this decode matches the Chrome-drawn Release 3 frame to a mean absolute difference of 0.65/255, which is the WebP loss). AVIF: sharp 0.35.4 (libaom 3.14.1), quality 50, chroma 4:4:4 (the cuts are yuv444p), effort 6; 1x = lanczos3 resize of the same frame. New WebP fallbacks: the Release 3 WebP settings. At 100% the AVIF and the Release 3 WebP of the same frame show the same glyph edges in the WORKING COPY.md editor and the document header (side-by-side crops in the lane receipt).

**Frame rule**, applied per cut over every presented frame the scan reached (the 0.25 s grid, then every frame near each candidate; the scan is in the lane receipt):

1. the 2880px AVIF is at most 140,000 bytes;
2. the stage's reading target is in its desktop window (STAGE_FRAMES `crop`);
3. stage 1 only: ORIGINAL and EXTRACT show the same document, the EXTRACT page ends on a whole line (not one cut by the wipe), and the document is Operations Manual — of the cut's five documents it has the smallest eyebrow overprint (2 rows into the title's cap line in ORIGINAL, 3 in EXTRACT; Q3 forecast, Employee Handbook, Services Agreement and Site visit notes reach 3–5);
4. among what is left, the most content (WORKING COPY.md lines for stage 1, the latest frame for stage 2).

- **Stage 1: t = 8.16 s** (frame 204, the document's second pass). No Release-3 pass frame qualifies except t = 3.00 s itself and its neighbours; t = 8.16 s has 10 lines in WORKING COPY.md against 12 at t = 3.00 s. Its eyebrow and title rows and columns measure identical to t = 3.00 s, so the Tier 2 bars below keep their coordinates (`posterMask.poster` now names `poster-1-t8.16-2x.webp`, and the bars apply to its AVIF too, which is the same frame).
- **Stage 2: t = 9.28 s** (frame 232), the latest frame of cut 2 whose AVIF fits; `# Payment terms` is in the 450–1350 window. The end frame (t = 17.96 s) is 163,294 bytes as AVIF.
- **Stages 3 and 4 keep t = 17.96 s.** Their end frames fit as AVIF (92,398 and 101,480 bytes) and carry no overprint, and each cut holds its final composition for its last half second (t = 17.92 s decodes pixel-identical to 17.96 s in cut 3), so a "different" frame there would be the same picture under a new name. Only the AVIF pair is new; the locked Release 3 WebP pair is their fallback.
- **The stage-1 label overprint is not zero.** No frame of cut 1 is free of it (Release 3's search, and this one); the bars cover every eyebrow row above the title's cap line, and 2 rows (ORIGINAL) and 3 rows (EXTRACT) of eyebrow ink still touch the cap tops. In the desktop crop (rows 900–1800) the line is outside the window; in phone Fit the 3 rows are 0.4 CSS px. Zero needs Tier 3 (re-rendering cut 1). `e2e/landing-hero-film-loading.spec.ts` holds the part that is true: no eyebrow ink above the cap line shows through the bars, in the file the browser actually decoded.

| File | Stage | Density | Format | Size | Bytes | sha256 | Cut | Frame *t* | Frame PNG sha256 |
|---|---|---|---|---|---|---|---|---|---|
| `poster-1-t8.16-2x.avif` | 1 | 2x | AVIF | 2880×1800 | 137,967 | `65e6fe5df0fd486ee09286952f8b2cccf0b671eb83f4ad15df3c43440ed292bb` | `compile-cut.mp4` | 8.16 s | `ea96053750dc68fb950303c08d7b8e384f7fe2bd6424428948767467c0978a55` |
| `poster-1-t8.16.avif` | 1 | 1x | AVIF | 1440×900 | 57,712 | `6bc6b2f44261e58c0372df907e5d63e14ed20aa3c915ce5c0f6edfd918564789` | `compile-cut.mp4` | 8.16 s | `ea96053750dc68fb950303c08d7b8e384f7fe2bd6424428948767467c0978a55` |
| `poster-1-t8.16-2x.webp` | 1 | 2x | WebP | 2880×1800 | 259,554 | `58d0ff0e87c526d64620d5e9e6e4a699122f3599b59deb107bef3ea74e721867` | `compile-cut.mp4` | 8.16 s | `ea96053750dc68fb950303c08d7b8e384f7fe2bd6424428948767467c0978a55` |
| `poster-1-t8.16.webp` | 1 | 1x | WebP | 1440×900 | 105,678 | `810e078271d88d033784a3db376cffac526fc21f56e40406bc986ada59eb953b` | `compile-cut.mp4` | 8.16 s | `ea96053750dc68fb950303c08d7b8e384f7fe2bd6424428948767467c0978a55` |
| `poster-2-t9.28-2x.avif` | 2 | 2x | AVIF | 2880×1800 | 139,884 | `88dda2be90413f323f4906b3c0bcfe8616a6456d7919c508580a0cf93355cb17` | `compile-cut-2.mp4` | 9.28 s | `249f42e4d30f0ec49ffdccbc6a20b1d76c323ff3ac3910719a8ff4bc8d713fe8` |
| `poster-2-t9.28.avif` | 2 | 1x | AVIF | 1440×900 | 61,273 | `3d24e7d4241de0813fa6a8694a63cecaf64f301cba20eb636e51d94fe8554d87` | `compile-cut-2.mp4` | 9.28 s | `249f42e4d30f0ec49ffdccbc6a20b1d76c323ff3ac3910719a8ff4bc8d713fe8` |
| `poster-2-t9.28-2x.webp` | 2 | 2x | WebP | 2880×1800 | 300,132 | `4a5f55bbbed4fed89b02bbb6a57ade0ac73878475bcfcff01498df080bbaf3e6` | `compile-cut-2.mp4` | 9.28 s | `249f42e4d30f0ec49ffdccbc6a20b1d76c323ff3ac3910719a8ff4bc8d713fe8` |
| `poster-2-t9.28.webp` | 2 | 1x | WebP | 1440×900 | 121,612 | `91525f1fe19efd09f4634ac5e015dd81b75284834279c52fbe0e3e32c02629e3` | `compile-cut-2.mp4` | 9.28 s | `249f42e4d30f0ec49ffdccbc6a20b1d76c323ff3ac3910719a8ff4bc8d713fe8` |
| `poster-3-t17.96-2x.avif` | 3 | 2x | AVIF | 2880×1800 | 92,398 | `3f54bf18e675927595d06b1ace591533905e03c31d36c289f4ccc772f003d2e7` | `compile-cut-3.mp4` | 17.96 s | `de8a2079bcc277bf4ede1cd4575199d3600d48c2adbff34b4f2556ca666d7083` |
| `poster-3-t17.96.avif` | 3 | 1x | AVIF | 1440×900 | 41,075 | `7baaaccdb016665c5c4976879f9fad4029873b129732022243461c5e29711dd8` | `compile-cut-3.mp4` | 17.96 s | `de8a2079bcc277bf4ede1cd4575199d3600d48c2adbff34b4f2556ca666d7083` |
| `poster-4-t17.96-2x.avif` | 4 | 2x | AVIF | 2880×1800 | 101,480 | `862b712d8769812e4fc1f36ab16e24d3cd1d881eee8df49cdd8b448d10b0232f` | `compile-cut-4.mp4` | 17.96 s | `0ade2f490662ce1c69510f8863189c038dc33a4e1f6720a2ac42980dc868998a` |
| `poster-4-t17.96.avif` | 4 | 1x | AVIF | 1440×900 | 46,419 | `a30e783022041b97523bc3fe6d73f7de949e6b098f0f6d68efc69f542a6123fb` | `compile-cut-4.mp4` | 17.96 s | `0ade2f490662ce1c69510f8863189c038dc33a4e1f6720a2ac42980dc868998a` |

## Home phone pane (FINAL-SPEC 2026-10-26 §2.1)

Below 768px the Home film opens on Focus as one readable pane: a w×(w·5/4) (4:5) rect of the 2880×1800 frame at `STAGE_FRAMES[stage].phonePane` (`components/compile-stage-player.tsx`; w is 684 on stages 1 and 4 and 520 on stages 2 and 3), drawn at 380×475 CSS px on a 412px phone. The poster and the playing cut are both scaled to 2880/w of the panel's width and shifted by the same corner, so the still and the video show the same pixels; the four `compile-cut*.mp4` files are unchanged and play at their locked 2880×1800.

Stage 1 has its own still of that rect, so a phone's first image is 43,696 bytes instead of the 1440px frame. It is a crop of the locked `poster-1-t8.16-2x.webp`, not a new decode of the cut: ffmpeg was not on the producing host, so the WebP is the source and the crop carries one more lossy generation. sharp 0.35.4 `extract(rect)`, then AVIF quality 50, chroma 4:4:4, effort 6 and WebP quality 82, smartSubsample, effort 6 (the POSTER-RECUT settings). The rect starts at row 380 (fix round R3, 2026-10-27): the cut's scan_0140 page then opens on its "Handwritten · 12 March 2026 · Warehouse B" line instead of its grey "photo · no text layer" box (border rows 277–375), and the still opens on the last two rows of the Operations Manual table. It is below the eyebrow overprint rows 206–218, so it needs no mask. Earlier rects: row 252 (R1, opened on the photo box while the cut played) and row 130 (with the pane header; the overprint residue showed above the title). Stages 2–4 have no pane file: their 2x posters are cropped by the same CSS.

| File | Stage | Format | Size | Bytes | sha256 | Crop of | Rect (x, y, w, h) |
|---|---|---|---|---|---|---|---|
| `poster-1-t8.16-pane1-684x855.avif` | 1 | AVIF | 684×855 | 43,696 | `e32d5aa0f412717896b65b271f0c00623afb1ba650171a953ba99e90923a6677` | `poster-1-t8.16-2x.webp` (`58d0ff0e87c526d64620d5e9e6e4a699122f3599b59deb107bef3ea74e721867`) | 746, 380, 684, 855 |
| `poster-1-t8.16-pane1-684x855.webp` | 1 | WebP | 684×855 | 74,308 | `eae2fd2fb5908012d280397dffb033e0a9ecfaa76b750322de13d2d73f76831b` | `poster-1-t8.16-2x.webp` (`58d0ff0e87c526d64620d5e9e6e4a699122f3599b59deb107bef3ea74e721867`) | 746, 380, 684, 855 |

**Pane rects and their blank scan.** Each rect must hold ink in ≥ 85% of the presented frames of its cut, by the Release 3 blank-scan cell rule applied to the rect alone (`phonePaneScan` in `components/compile-stage-player.frame-strings.json`, which the unit test holds `phonePane` to):

| Stage | Pane | phonePane (x, y, w) | Frames | Blank | Ink share |
|---|---|---|---|---|---|
| 1 Files | ORIGINAL | 746, 380, 684 | 443 | 0 | 100% |
| 2 Organize | MARKDOWN | 820, 238, 520 | 447 | 0 | 100% |
| 3 Updates | SOURCES | 60, 186, 520 | 449 | 0 | 100% |
| 4 Use with AI | ASSISTANT · MCP | **44, 180**, 684 | 447 | 19 | 95.7% |

Stages 2 and 3 are 520px wide since fix round R3 (review 2026-10-26 B-4): their smallest text is 7 source px, which a 684px rect draws at 7.21px equivalent on a 390px phone; 520px draws it at 9.49px, the ≥ 9px floor main held on every stage. Stage 2 starts at the MARKDOWN body's first column (x 820, right of the line numbers) and loses the last ~50px of its longest lines; stage 3 keeps the file names and the TOUCHED/CHANGED row bands, and its right-hand badges fall outside the rect. Candidates scanned (all 100% ink): 540, 520 and 500px for each (`pane-scan-candidates.json` in the R3 receipts).

Stage 4's rect in the spec (44, 516) scored 78.1% (98 of 448 frames blank: the answer rows are empty until the question is asked), so it moved up the same pane to row 180, where the MCP session opens (`initialize`, `tools/list`, the grounded `ask_world` answer with its citation).

## Home film — re-record on design C (W2, 2026-11-05)

The four Home cuts are now recordings of the real product UI on the published public sample (the five Apple SEC filings that `/explore` compiles; rights-clear, public filings), not canvas drawings of the demo fixture. Each cut is 450 PNG frames (25 fps × 18.00 s, `FILM_DURATION`) captured by Playwright Chromium at 1440×900 CSS px and deviceScaleFactor 2, driven against the film clock (each scripted click, scroll and fixture state change runs at its film time, and the page settles in wall time before the next frame). The pointer is a plain arrow drawn over the page during capture. The workspace stage runs on a fixture session whose five sources are the sample filings at their real sha256 version keys; its live OCR view reads the committed PDF and the committed text-layer regions. No number in the frames is a TAVONEL measurement: the figures are the filings' own text, and the counts are the sample's.

Encoded with `scripts/encode-cut-2x.sh` (ffmpeg 7.1, libx264 preset medium, crf 20, **yuv444p**, High 4:4:4 Predictive, 2880×1800, 25 fps, no audio, +faststart) — the same container and profile as the earlier cuts. New names, new bytes: `/film/*` is immutable for a year, and the earlier `compile-cut*.mp4` and `poster-[1-4]-*` files stay byte-identical and locked; Home no longer uses them.

**Recording R2 (2026-11-08, after independent review R1).** The tools are committed in `scripts/film/`: `record.mjs` (with `stages.mjs` and `fixture.mjs`), `scan.mjs`, `posters.mjs`, `encode-fallback.sh` and `frame-strings.mjs`; each file's header gives its command line, and `record.mjs` gives the order. R1's cuts carried a dark strip, up to 16 source px, across the top or bottom of the frame while a scroll was under way (a capture taken before Chromium had painted the area the scroll exposed). R2 scrolls instantly, waits two animation frames before each capture, and checks every captured frame with `scan.mjs`'s edge-band rule (any of the top or bottom 16 source-px rows with a full-width mean luma under 60), retaking a banded capture; the scan over all 1,800 source frames is in `compile-stage-player.frame-strings.json` `edgeBandScan`. The stage-1 fixture session is a paying customer's (`source: "paid"`, not billing-exempt), so the shell draws no access strip; R1 recorded the internal owner strip. R1's `hero-c*` and `poster-c*` files were never deployed and are removed; R2's carry `-r2-` in their names.

| File | Shows | Bytes | sha256 |
|---|---|---|---|
| `hero-r2-c1.mp4` | 1 · Files — /workspace/sources, fixture session of a paying customer (no access strip): the 10-Q read page by page in the live OCR view, three extracted lines each lighting its page region | 1,212,516 | `19308159fa5fad8fe1471a871296e6b7028a4b89679a4defde8ad2d5adc8c920` |
| `hero-r2-c2.mp4` | 2 · Organize — /explore?act=world: Greater China, the 10-Q filed 2026-01-30 and Services selected in turn, each lighting its relations | 1,201,695 | `49e8c34d9ae73ad73005360952dd378183c886f158226660446f37c9fa5aa357` |
| `hero-r2-c3.mp4` | 3 · Updates — /explore?act=change: the 2025 10-K, the four 2026 filings that arrived, then the World after them | 1,531,654 | `5c30a3360a944ae865135c54fd443c8da7603cd29f23088386b7f392c61d40f8` |
| `hero-r2-c4.mp4` | 4 · Use with AI — /explore: two prepared questions, each with its retrieved passage and the page region it came from | 1,537,431 | `afcbb47ebf531296da91c9807ebc930290ed766aadfa28a2a3900efe562ea561` |
| `hero-r2-c1-hq.mp4` | stage 1 decoder-error fallback (yuv420p, 2880x1800) | 973,235 | `781c5402d23f08f45719087fef57b3a49b44a94e0e5930d549b33d46282516d0` |
| `hero-r2-c1-hq-1440.mp4` | stage 1 narrow decoder-error fallback (yuv420p, 1440x900) | 431,261 | `2f2dec9337af47fcfe6cd0d5241589a2bb483c9ec3438a72525e15fd2a574e2f` |

Posters: one source frame of each cut (the lossless PNG the cut was encoded from), sharp 0.35.4 with the D-11 settings (AVIF quality 50, 4:4:4, effort 6, each 2x AVIF ≤ 140,000 bytes; WebP quality 82, smartSubsample, effort 6; 1x = lanczos3). No frame carries an overprint, so no stage has a Tier 2 mask. The stage-1 phone pane is a 684×855 extract of the same PNG (`STAGE_FRAMES.sources.phonePane`).

| File | Size | Bytes | sha256 | Cut | Frame *t* | Frame PNG sha256 |
|---|---|---|---|---|---|---|
| `poster-r2-c1-t13.60-2x.webp` | 2880×1800 | 179,308 | `53761e390f877fdd17eaf74d13defc3695e9a296777cff848f5457c8f8885d82` | `hero-r2-c1.mp4` | 13.60 s | `313175a10f6f453cf65581858c8269edfad5b95e5e8d949c6fa2fb30491b0fe5` |
| `poster-r2-c1-t13.60.webp` | 1440×900 | 64,622 | `2e71ef22ea098ef8daec2c3fe253f166db0a6ada333d7dc3f626e25b8ec389c2` | `hero-r2-c1.mp4` | 13.60 s | `313175a10f6f453cf65581858c8269edfad5b95e5e8d949c6fa2fb30491b0fe5` |
| `poster-r2-c1-t13.60-2x.avif` | 2880×1800 | 105,860 | `1d66518999c6344db1d3b02be61f9378b6b3de16cf5aea3a21d15f47e33c1677` | `hero-r2-c1.mp4` | 13.60 s | `313175a10f6f453cf65581858c8269edfad5b95e5e8d949c6fa2fb30491b0fe5` |
| `poster-r2-c1-t13.60.avif` | 1440×900 | 39,561 | `1ce23fb5961a843865c6086b0d961f9586e91f0363658a2476b2556e1152820d` | `hero-r2-c1.mp4` | 13.60 s | `313175a10f6f453cf65581858c8269edfad5b95e5e8d949c6fa2fb30491b0fe5` |
| `poster-r2-c2-t4.40-2x.webp` | 2880×1800 | 137,168 | `c9259a2defea27d731effc84c8b239c20b7099de1c48397a9b643dce8338854f` | `hero-r2-c2.mp4` | 4.40 s | `49d73bba3f4198e6131bd666127071e0a96474273ed96fa04673286d02fef9b4` |
| `poster-r2-c2-t4.40.webp` | 1440×900 | 53,236 | `b86c2ad1d1c79c756a1e085c0f935fe23a03e6161d3731b02d57c9c4e7ef44a8` | `hero-r2-c2.mp4` | 4.40 s | `49d73bba3f4198e6131bd666127071e0a96474273ed96fa04673286d02fef9b4` |
| `poster-r2-c2-t4.40-2x.avif` | 2880×1800 | 67,947 | `7a25a03799e9379d463c196d4de3ebfa7766ffa9fcf3c567bcc687d42c5fcc5e` | `hero-r2-c2.mp4` | 4.40 s | `49d73bba3f4198e6131bd666127071e0a96474273ed96fa04673286d02fef9b4` |
| `poster-r2-c2-t4.40.avif` | 1440×900 | 29,033 | `71c7f2fb6747a056cc917f409367fc478401b6b62d7c407665716317ecbafa6b` | `hero-r2-c2.mp4` | 4.40 s | `49d73bba3f4198e6131bd666127071e0a96474273ed96fa04673286d02fef9b4` |
| `poster-r2-c3-t17.96-2x.webp` | 2880×1800 | 144,384 | `95fc1e3a5ae9938a420f2c3f59c131b1272140f778bca2dba2be5362b2a76028` | `hero-r2-c3.mp4` | 17.96 s | `6485bc9faecfbf9f5c5c7fddac29a3ee69d7f95e2567309552fb2bd9958d3da3` |
| `poster-r2-c3-t17.96.webp` | 1440×900 | 57,156 | `a5f7ce49d79ff6acd665902f480a8fce38fe6d658c542fa128b5c997172ee778` | `hero-r2-c3.mp4` | 17.96 s | `6485bc9faecfbf9f5c5c7fddac29a3ee69d7f95e2567309552fb2bd9958d3da3` |
| `poster-r2-c3-t17.96-2x.avif` | 2880×1800 | 66,498 | `010dfcedb46e35f7767ac46dfc757001ebef817f9029762d41bab4780f034ff4` | `hero-r2-c3.mp4` | 17.96 s | `6485bc9faecfbf9f5c5c7fddac29a3ee69d7f95e2567309552fb2bd9958d3da3` |
| `poster-r2-c3-t17.96.avif` | 1440×900 | 26,194 | `cd57cf06ef2ea21cc6dea98d2d9064019862153b3c6f417a76c54c48fb95c224` | `hero-r2-c3.mp4` | 17.96 s | `6485bc9faecfbf9f5c5c7fddac29a3ee69d7f95e2567309552fb2bd9958d3da3` |
| `poster-r2-c4-t6.80-2x.webp` | 2880×1800 | 233,210 | `4ca51b0d4faba3d844c5cc7d42eacc5857301ca2e03d53978e8ffee0444ff616` | `hero-r2-c4.mp4` | 6.80 s | `2d45c7645ac7b119a0cac41959e11da24f42ef35cda9927bdd38966ce3120081` |
| `poster-r2-c4-t6.80.webp` | 1440×900 | 92,864 | `d04a6d20a2a46704280d37ec5fb9db826502189aa9b871c6c19e7c1c288d50d5` | `hero-r2-c4.mp4` | 6.80 s | `2d45c7645ac7b119a0cac41959e11da24f42ef35cda9927bdd38966ce3120081` |
| `poster-r2-c4-t6.80-2x.avif` | 2880×1800 | 134,188 | `04c4f2a53d894d2a70b8000990356aa963a982f901d0a575c739824d6e771ee0` | `hero-r2-c4.mp4` | 6.80 s | `2d45c7645ac7b119a0cac41959e11da24f42ef35cda9927bdd38966ce3120081` |
| `poster-r2-c4-t6.80.avif` | 1440×900 | 55,074 | `b784a6494cba294f843bd9a43599e38a9130c932cd08470ba39d415758a9629f` | `hero-r2-c4.mp4` | 6.80 s | `2d45c7645ac7b119a0cac41959e11da24f42ef35cda9927bdd38966ce3120081` |
| `poster-r2-c1-t13.60-pane1-684x855.webp` | 684×855 | 33,626 | `a6a6e0d95e8e692330f5f36334acd50e2675d916f4a5afbf5b221d2356ca78d3` | `hero-r2-c1.mp4` | 13.60 s | `313175a10f6f453cf65581858c8269edfad5b95e5e8d949c6fa2fb30491b0fe5` |
| `poster-r2-c1-t13.60-pane1-684x855.avif` | 684×855 | 20,292 | `c313897b5a924322a02d8ffac21691f9744e9cdfa323576beb5782d1cd3fc282` | `hero-r2-c1.mp4` | 13.60 s | `313175a10f6f453cf65581858c8269edfad5b95e5e8d949c6fa2fb30491b0fe5` |

Reading targets, crop windows, phone rects and both blank scans for these cuts are re-measured in `components/compile-stage-player.frame-strings.json`. The founder restored the earlier film on 2026-08-09; this re-record was taken under the 2026-11-04 delegation and the earlier files are kept so it can be rolled back by reverting the references.

## Home film — recording R3 (2026-11-09)

LANDING-VIDEO-HISTORY-20261109, option (d). Same pipeline as R2 (`scripts/film/`), with a camera: the page renders at a 1920×1200 CSS viewport (1400×900 for the two workspace stages) at deviceScaleFactor 8/3, and each frame is a 1080×675 CSS clip (2880×1800 px) framed on the step's action and its result. So 12px product type is 32 source px — about 13.8px in the 1440 desktop film, and ≥ 12px in a phone's 848×1060 pane on any panel ≥ 318 CSS px (Windows WebKit's 360px panel is 318). The /explore header and its second H1 are hidden inside the recording only (`stage.hide` in `stages.mjs`). One action and one result per step; stage 2 is the compile itself. Edge-band scan: 0 of 1,800 frames. Encoders, crf, profiles and poster settings are R2's. Every cut also has a 2880×1800 yuv420p twin (`-hq`, `scripts/film/encode-fallback.sh`, crf 20): a phone plays it first (`phoneSrc`) and any decoder error falls back to it, because WebKit does not reliably decode the High 4:4:4 masters. The R2 files stay byte-identical and locked, so this can be rolled back by reverting the references.

| File | Shows | Bytes | sha256 |
|---|---|---|---|
| `hero-r3-c1.mp4` | 1 · Read — /workspace/sources (paying-customer fixture session): pages of the 10-Q arrive in the live OCR view, then two extracted lines are picked, each lighting the page region it was read from | 1,150,238 | `2a9318cc9caf8f3c1b5a4349d5d7186c0d8c852b5c6da33acc5ccdcef7400583` |
| `hero-r3-c2.mp4` | 2 · Compile — /workspace/sources: the five ready sources are compiled; the run checks the selection, reads 0→5 of 5, structures what was read and stops: "A review package is ready for a person to inspect." | 782,407 | `968e8e7cae45930291c8194e648f7cdd66c8695170af7d8fd31749c1df714d15` |
| `hero-r3-c3.mp4` | 3 · Update — /explore?act=change: the 2025 10-K, the 2026 filings that arrived, then the World after them with Greater China selected (relation lines behind the node boxes, see world-visual.module.css) | 2,991,082 | `3042bf4e70f6212a49335d3b2fe3e19d6c1ce0ff9ee868340633e3597b109a24` |
| `hero-r3-c4.mp4` | 4 · Trace — /explore: a prepared question, its retrieved passage, the page region it came from, then the next source page of the answer | 2,553,208 | `9b8a7353a96ab0d1778827f0a5ddf67dbf9d3c307c8f4d2e3d289df38de49a0c` |
| `hero-r3-c1-hq.mp4` | stage 1 phone cut and decoder-error fallback (yuv420p, 2880x1800) | 1,010,629 | `0e296c6036f19a3fc7c4866e131dfd3f30d90e36077fde9b61cc700603ab20e9` |
| `hero-r3-c1-hq-1440.mp4` | stage 1 narrow decoder-error fallback (yuv420p, 1440x900) | 418,623 | `9ba7604f0ba3c9d6564602ceaa59bc2c0c517a5a7a4154d2d424a0ec3e8ce627` |
| `hero-r3-c2-hq.mp4` | stage 2 phone cut and decoder-error fallback (yuv420p, 2880x1800) | 694,303 | `00fe1e24e7d1c19e3e8914205f589ee7b0a14cc4652cb6bca2d4dfe8e644f7e8` |
| `hero-r3-c3-hq.mp4` | stage 3 phone cut and decoder-error fallback (yuv420p, 2880x1800) | 3,148,714 | `2f3e6b0803d918f12f20ffb59be2d20b67b1f1fd56ca5850d144cba706560ced` |
| `hero-r3-c4-hq.mp4` | stage 4 phone cut and decoder-error fallback (yuv420p, 2880x1800) | 3,168,509 | `dec454276dd0a1dec66585bd0e485aee816de9eaa6497467e7bf9b1a66bddcf0` |

Posters: each is a step's result frame (stage 1 at 10.40 s, stages 2 and 3 at 17.96 s, stage 4 at 8.80 s). The stage-1 phone pane is an 848×1060 extract of the same PNG (`STAGE_FRAMES.sources.phonePane`).

| File | Size | Bytes | sha256 | Cut | Frame *t* | Frame PNG sha256 |
|---|---|---|---|---|---|---|
| `poster-r3-c1-t10.40-2x.webp` | 2880×1800 | 191,562 | `55077ee4426f29908668efbb2a9f69c4e303a23f04f8b89e1ff1ab6f56e347c6` | `hero-r3-c1.mp4` | 10.40 s | `74e3363b6b57009d331e9de35e1c672fc2b0552a9b3f04decf48548b52d6ec73` |
| `poster-r3-c1-t10.40.webp` | 1440×900 | 76,788 | `6ebb76e87d2f18b0eb14715aaf76113c3eb485b846d010413a7efdd3081a3633` | `hero-r3-c1.mp4` | 10.40 s | `74e3363b6b57009d331e9de35e1c672fc2b0552a9b3f04decf48548b52d6ec73` |
| `poster-r3-c1-t10.40-2x.avif` | 2880×1800 | 109,233 | `8acd642326ff09afdefcf249579cf77a070bdc2372688051a7d96f1b6216a8cb` | `hero-r3-c1.mp4` | 10.40 s | `74e3363b6b57009d331e9de35e1c672fc2b0552a9b3f04decf48548b52d6ec73` |
| `poster-r3-c1-t10.40.avif` | 1440×900 | 48,101 | `3d569d3dc9eccf38d35fa5bd67040561372543633eaa1753c06ef61ebf3a42b9` | `hero-r3-c1.mp4` | 10.40 s | `74e3363b6b57009d331e9de35e1c672fc2b0552a9b3f04decf48548b52d6ec73` |
| `poster-r3-c1-t10.40-pane1-848x1060.webp` | 848×1060 | 36,770 | `926c6264b9b16b7976db135ae6dc0dcca17f8d82399454364c13e141a5346c4e` | `hero-r3-c1.mp4` | 10.40 s | `74e3363b6b57009d331e9de35e1c672fc2b0552a9b3f04decf48548b52d6ec73` |
| `poster-r3-c1-t10.40-pane1-848x1060.avif` | 848×1060 | 21,611 | `372e2255bb3cde0ceac20aa70eab00d9e2fe4e6c790c4e7c18174fb43bcbc12d` | `hero-r3-c1.mp4` | 10.40 s | `74e3363b6b57009d331e9de35e1c672fc2b0552a9b3f04decf48548b52d6ec73` |
| `poster-r3-c2-t17.96-2x.webp` | 2880×1800 | 106,010 | `3cb0845b1f08018b25243a0c5dcf4ad4f6612ce71c8977aedb4cbdef75f94f70` | `hero-r3-c2.mp4` | 17.96 s | `521a3a1ad5aa827e11bae74879db8bb61f18e3c30caf629e3caff3ae67f46bbe` |
| `poster-r3-c2-t17.96.webp` | 1440×900 | 42,346 | `a7f81715e908129a6e7848767933f0fc9f05708732f361a68f97e444e573b60b` | `hero-r3-c2.mp4` | 17.96 s | `521a3a1ad5aa827e11bae74879db8bb61f18e3c30caf629e3caff3ae67f46bbe` |
| `poster-r3-c2-t17.96-2x.avif` | 2880×1800 | 57,182 | `def5ac5952e9e991e8e5f3960998cd27d9993e2870406de00a9f6dcf97128635` | `hero-r3-c2.mp4` | 17.96 s | `521a3a1ad5aa827e11bae74879db8bb61f18e3c30caf629e3caff3ae67f46bbe` |
| `poster-r3-c2-t17.96.avif` | 1440×900 | 24,319 | `3c8d72ac1dbb5e5ebf57be97c8966eb187ff6f8e7fac1a53a9c5da7785283753` | `hero-r3-c2.mp4` | 17.96 s | `521a3a1ad5aa827e11bae74879db8bb61f18e3c30caf629e3caff3ae67f46bbe` |
| `poster-r3-c3-t17.96-2x.webp` | 2880×1800 | 173,634 | `2c6072185a752039b663c01baa4a2160af02c53cd3de89c5368bd5dd64322ca8` | `hero-r3-c3.mp4` | 17.96 s | `19d587cb56887c026f348837bed92dafc0790d05d05a9f9b7b80fda337be2ff1` |
| `poster-r3-c3-t17.96.webp` | 1440×900 | 71,486 | `f7e93558b8b7196331bdf6ca1154a627607bc603fc9a7ef9159b758fdfda232c` | `hero-r3-c3.mp4` | 17.96 s | `19d587cb56887c026f348837bed92dafc0790d05d05a9f9b7b80fda337be2ff1` |
| `poster-r3-c3-t17.96-2x.avif` | 2880×1800 | 79,951 | `c8afc727a89b10407f2c1d045003c1c0a844cb9f8a3b30fdd66483a214d03ea3` | `hero-r3-c3.mp4` | 17.96 s | `19d587cb56887c026f348837bed92dafc0790d05d05a9f9b7b80fda337be2ff1` |
| `poster-r3-c3-t17.96.avif` | 1440×900 | 34,436 | `25a4667ed8ac08b4e05f2a20ac4738c884225b5d2853af9b7a4ec05004a874d2` | `hero-r3-c3.mp4` | 17.96 s | `19d587cb56887c026f348837bed92dafc0790d05d05a9f9b7b80fda337be2ff1` |
| `poster-r3-c4-t8.80-2x.webp` | 2880×1800 | 208,952 | `5628236a463040cbe5b1fa07fee50f4ea9f02ebbfed15f7a8adff3b30a68a7dd` | `hero-r3-c4.mp4` | 8.80 s | `578cca8776ad7a1668497fb828cc337e50929f3f0d26a852180e3a5bd778a7f9` |
| `poster-r3-c4-t8.80.webp` | 1440×900 | 88,796 | `5842e960628ade5ff8aa6cf6d5bd139a24bcb47f7b5057fbb95f6fdc92cf2fea` | `hero-r3-c4.mp4` | 8.80 s | `578cca8776ad7a1668497fb828cc337e50929f3f0d26a852180e3a5bd778a7f9` |
| `poster-r3-c4-t8.80-2x.avif` | 2880×1800 | 115,055 | `2b616a4740ca057a8854e739eea943520b9740be1dbbda904c1b9e2a6a0fc425` | `hero-r3-c4.mp4` | 8.80 s | `578cca8776ad7a1668497fb828cc337e50929f3f0d26a852180e3a5bd778a7f9` |
| `poster-r3-c4-t8.80.avif` | 1440×900 | 55,446 | `a3a80359d7f4f387e370dac55209bedc45ac7f4a694b5cc631ae1345748b9c93` | `hero-r3-c4.mp4` | 8.80 s | `578cca8776ad7a1668497fb828cc337e50929f3f0d26a852180e3a5bd778a7f9` |
