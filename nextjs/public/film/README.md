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
