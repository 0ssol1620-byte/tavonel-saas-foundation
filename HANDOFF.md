# HANDOFF — hero-category-brand lane, Release 3 (codex/r3-hero-20261015)

Base: `codex/home-release3-20261015` = main `dbe22b1e`. Receipts:
`outputs/tavonel-research-replan-20261013/resume-20261015/redesign-r3-20261015/hero/`
(build/server/check/vitest/e2e logs, `audit/` hue audits before and after, `shots-1/` captures and
`HERO-MEASURE.json`, `scripts/` the probes and the two Playwright wrappers used).

Targets: judges' gaps 1–2 (the headline does not name the category; no single brand colour used
consistently), brief moves 1 and 10.

## 1. What changed

### 1.1 The first sentence names the category (`components/landing-v2/landing-page.tsx`, `HOME_COPY`)

| | Release 2 (live) | Release 3 |
| --- | --- | --- |
| EN H1 | Knowledge your AI can trust. | **The Knowledge Compiler for AI.** |
| EN support | TAVONEL compiles your documents into it. Each statement stays linked to the page it came from, and the knowledge recompiles when a source changes. | **TAVONEL compiles your documents into context for AI and agents, with each statement linked to the page and region it came from.** |
| KO H1 | AI가 믿고 사용하는 지식. | **AI를 위한 지식 컴파일러.** |
| KO support | TAVONEL이 문서를 그 지식으로 컴파일합니다. … | **TAVONEL은 문서를 AI와 에이전트를 위한 맥락으로 컴파일하며, 각 진술은 그것이 나온 페이지와 영역에 연결됩니다.** |

- The H1 is the constitution's North Star in the words the site already uses for its category
  (`app/layout.tsx` title "Knowledge Compiler for AI — TAVONEL", `PRODUCT_NOUNS` "Knowledge Compiler",
  capitalised as `brand-copy.test.ts` requires).
- The support line is the North Star ("compile fragmented organizational knowledge into trusted,
  temporal, traceable context for AI and agents") rewritten for a buyer, limited to what the page
  under it demonstrates: a statement bound to its page and region (s2 workbench, s3 record with page
  and bbox). No number, no "verified", no "every source", no "trusted". It no longer says the
  knowledge "recompiles when a source changes": the public sample compares full-corpus compiles, and
  s4 states that, so the hero does not have to compress it.
- KO is D12's literal translation. `KO_TERMS` spells "Knowledge Compiler" 지식 컴파일러 and
  claim/statement 진술; "agents" is 에이전트 as in the KO nav (`MCP와 에이전트`); "context" is 맥락
  as in s2's "이 구절에 필요한 맥락". `koTermDrift` finds nothing. No D12 substitution was needed.
- Public claim: the founder may veto both sentences (CLAUDE.md "what a public claim says").

### 1.2 The H1 measures the container (`source-first-home.module.css`)

`--hero-measure` (1040px) broke the new H1 at 80px (its line is 1,114px). The H1 now has
`max-width: none; text-wrap: balance` inside the 1200px container. `.heroAside` still uses
`--hero-measure`. Measured (chromium; webkit matches at 390 and 1440):

| width | EN H1 | KO H1 | EN support | KO support | primary CTA bottom |
| --- | --- | --- | --- | --- | --- |
| 1920 / 1440 | 1 line, 80px | 1 line | 2 lines | 2 lines | 349 / 365 of 900 |
| 1280 | 1 line, 71.7px | 1 line | 2 | 2 | 341 / 356 |
| 1024 | 1 line, 57.3px | 1 line | 2 | 2 | 327 / 340 |
| 768 | 1 line, 44px | 1 line | 2 | 2 | 314 / 326 |
| 430 | 2 lines, 40px | 1 line | 3 | 3 | 354 / 325 of 844 |
| 412 / 390 / 360 | 2 lines | 2 lines | 4 | 3 | 383 / 372 of 844 |

H1, support and the primary action are above the fold at every width, EN and KO, with no
horizontal overflow (`shots-1/HERO-MEASURE.json`). The consent card does not show on the first
paint (Release 2 rule), so it cannot cover them.

### 1.3 One brand accent: decision.md's 255°, in four places only

decision.md G-H fixes the accent hue at **255°** (`--brand oklch(48% 0.20 255)`, hover 53%,
dark ground 72%/0.14) and wins over the brief's `#244ac8` (which measures 265.7°). Chroma 0.20 is
outside sRGB at that lightness and hue, so each token is decision.md's L and H at the sRGB chroma
boundary (what CSS gamut mapping draws), written as hex:

| token | value | OKLCH | contrast |
| --- | --- | --- | --- |
| `--action` | `#005bb3` | 48% 0.158 255 | white on it 6.67:1; on paper 6.34:1 |
| `--action-hover` | `#0169cd` | 53% 0.174 255 | white on it 5.38:1 |
| `--action-on-dark` | `#65a7fa` | 72% 0.139 255 | on obsidian 7.68:1 (footer focus) |

The tokens are declared on `body:has(.home)` so the two Home surfaces outside `.home` (layout skip
link, consent card) read them. Per DESIGN_MASTER_V3 §6.2 the accent appears in four places: the
filled action (header, hero, close: same words, same colour), the active film-tab marker, the focus
ring, and the Evidence Line. Not on the logo, headings, links or body text.

**Audit method.** Every element's computed colour, background, border, outline, decoration, SVG
fill/stroke, box-shadow and pseudo-elements, keeping only chromatic colours (OKLCH C > 0.03). Run
at rest at `/`, `/ko` × 1440/390, with the phone menu open, and with the consent card shown. A
second pass Tabs through 260 focus stops and hovers every link, button and summary. Video and image
pixels are excluded (brief §4.3: the film's colours are the film's).

| | before (tavonel.com = dbe22b1e) | after (this branch) |
| --- | --- | --- |
| at rest | `#244ac8` CTA/tab; amber family (`#795400`, `#f2b73a`, `#fff1c7`) on source regions; `#865600` brown "changed" count (s4); `#2f5f51` green skip-link border; `#142034` / `#4f5d70` navy-tinted inks (s2, s3, footer of the workbench) | `#005bb3` (accent) and the amber family on source regions **only** |
| focus | three ring colours: `#7da7ff` (header, hero actions, film viewport, s5; **2.26:1 on paper, under the 3:1 non-text minimum**), `#142034` (s2/s3 links), `#244ac8` (CTAs, film controls); mint `#7be0be` skip-link ring (1.51:1 on paper) | one ring: `#005bb3` on paper, `#65a7fa` on the dark footer; consent buttons `#005bb3` |
| hover | `#173692` | `#0169cd` (decision.md hover step) |
| accent area, first screen | 1440 EN 1.59% / KO 1.15%; 390 4.72% | 1440 EN 1.64% / KO 1.15%; 390 4.72% (cap 6%) |

How each hue was removed (all Home-scoped):
- `source-first-home.module.css` `.home`: the shared landing tokens are pointed at the accent or at
  ink: `--source`/`--source-ink`/`--verified`/`--verified-ink` → `--action`;
  `--relation(-ink)` → rule; `--changed(-ink)` → ink; `--text-on-paper`/`--text-muted-paper` →
  `--ink`/`--ink-muted`. The `#s4 { --source: #244ac8; --changed: #865600 }` line is gone. The
  `#s4` inline link and the `#58615e`/`#47534e` greys became ink tokens. `.play` reads the tokens.
- One focus rule: `.home.home :is(a, button, summary, [tabindex]):focus-visible { outline-color: var(--action) }`,
  with footer `--action: var(--action-on-dark)`.
- `.lv2-text-link:hover` darkens its own underline (`currentColor`) rather than turning it accent.
- `public-site-chrome.module.css`: the header CTA, its hover and focus, and the menu-button ring
  read `var(--action, #244ac8)` / `var(--action-hover, #173692)`. Every other page keeps its exact
  current colours (the fallback is the old hex); on Home the header button matches the hero.
- `marketing-consent.module.css`: on Home only (`body:has([data-home-ia])`) the card's ring is the
  accent and its notice link is ink.

Amber stays only where it marks source: the A/B/C region boxes and letters, the selected region
button's wash and rule, and the left rule of a quoted source passage (s2 passage, s3 record quote).

## 2. Test and spec changes, with reasons

Only strings that pinned the old copy changed. No assertion was removed, weakened or skipped.

| file:line | change | reason |
| --- | --- | --- |
| `lib/landing-v2-page.test.ts:274–275` | expected H1 → "AI를 위한 지식 컴파일러." / "The Knowledge Compiler for AI." | new H1 |
| `lib/landing-v2-page.test.ts:585–586` | expected support sentence → new EN/KO support | new support line |
| `e2e/evidence-first.spec.ts:29` | `toContainText("The Knowledge Compiler for AI.")` | new EN H1 |
| `e2e/evidence-first.spec.ts:104` | `toContainText("AI를 위한 지식 컴파일러.")` | new KO H1 |
| `e2e/landing-v2.spec.ts:145` | `.toBe("The Knowledge Compiler for AI.")` | new EN H1 |

No test pinned a colour that changed. `lib/landing-v2-motion.test.ts` pins the focus rules in the
shared `app/landing-v2.css`, which this lane does not edit; Home overrides them in its module.

## 3. Verification (build `.next` from this branch, `next start` on 127.0.0.1:3121)

- `pnpm check`: pass (brand:verify, type floor 12px, tsc, eslint). `check-1.log`.
- vitest: `lib/landing-v2*`, `brand-copy`, `copy-trust-guard`, `ko-terms`, `one-path-contract`,
  `lib/marketing*`, `components/landing-v2`, `lib/home*` = 29 files / 860 tests. Two tests timed out
  at the 5 s default while the e2e run held the CPU (`vitest-1.log`); both files re-run alone pass
  271/271 (`vitest-2.log`). Before the CSS change: 6 copy files, 365/365.
- Playwright chromium (system Chrome wrapper `scripts/pw-chrome.config.mjs`), projects 1920, 1440,
  1280, 1024, 768, 390, 360, reduced-motion and audit. Specs: evidence-first, landing-v2,
  hero-four-stage-restoration, hero-home-responsive, home-evidence-line, landing-hero-mobile,
  marketing-consent, mobile-landing, premium-craft, public-layout-balance, visual-continuity,
  visual-refinement, contrast-zoom-audit, ultimate-mobile-a11y, compiler-contract and
  launch-qa-mobile-nav. Result: **674 passed, 0 failed, 1 flaky** (`[reduced-motion] mobile-landing
  /docs/errors` clipping, not Home), 299 skipped by project filters. `e2e-1.log`/`.json`.
- Playwright WebKit 390 + 1440, reduced motion (`scripts/pw-webkit-rm.config.mjs`), with
  launch-qa-mobile-nav, marketing-consent, evidence-first and landing-v2: 46 passed, 1 failed.
  The failure is `landing-v2 "four-stage video … explicit play and advances"`: `currentTime` stays 0
  because Windows Playwright WebKit does not decode the H.264 films. It fails the same way against
  production (`e2e-webkit-prod-video.log`), so it predates this diff, which does not touch the
  player. CI webkit runs on Linux.
- Films and posters: `git status nextjs/public` is clean. No mp4, webm or poster was touched.

## 4. Not done, or someone else's call

1. **Founder veto on the copy:** both H1s and both support lines are public claims.
2. **The accent hue is site-wide work.** Home now draws decision.md's 255° (`#005bb3`). Every other
   page still draws the 265° cobalts (`#244ac8` and `#2347b8`, plus `#2447b3` on /evaluation and
   `#2259ce` as `--source-ink`). Making them one value means defining `--action` at the root and
   replacing those hexes, which brief §7 assigns to a separate PR with captures of the other pages.
   Until then the header button is `#005bb3` on Home and `#244ac8` on /pricing.
3. **decision.md also fixes Evidence at 210°** (`oklch(60% 0.11 210)`). Home keeps the brief's amber
   for source regions, as this lane's instructions require. decision.md's own text accepts amber as
   a semantic colour, so long as it is not the accent. Whether source marks move to 210° is a design
   decision, not this lane's.
4. **The largest non-brand colour mass on the first screen is the film itself:** the WORLD panel's
   teal and orange points and the green dot in "TAVONEL · Compile". Those are video pixels, which
   brief §4.3 exempts. Changing them is a Tier 3 re-render (founder-gated).
5. **The social card and tab title still carry the old positioning.** `BRAND_LINE.headline`
   ("Your documents. Knowledge you can verify.") drives the OG and Twitter title, and
   `BRAND_LINE.descriptor` drives the tab title. Both are pinned by `brand-copy.test.ts`. Aligning
   them with the new H1 is a brand-line decision, outside this lane.
6. **D8 experiment arms are stale.** `lib/landing-v2-copy.ts` `headlineExperiment.c` still reads
   "Knowledge your AI can trust, traced to the source." No experiment is running. Retire or rewrite
   it before the next test starts.
7. **The EN support runs 4 lines on 360–412 phones** (KO 3). The CTA stays above the fold
   (383/844). Making it shorter means a different sentence.
8. **Stray folder:** an empty folder tree `C:\d\CodexProjects\…` was created by a mis-resolved path
   in a capture run. The screenshots were moved to the receipts. The empty folders are left for a
   person to delete (the agent's guard blocks recursive removal).
9. **Not checked on hardware:** real-device Safari, and a P3 screen's rendering of the hex tokens.
