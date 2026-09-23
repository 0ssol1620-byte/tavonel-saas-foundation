# TAVONEL Final Web Product Workspace visual QA report

Authority: `D:\TAVONEL_FINAL_WEB_PRODUCT_WORKSPACE_MASTERPLAN_2026-09-02.md`
Repository worktree: `D:\CodexProjects\tavonel-saas-foundation-p0p2-integration`
Run date: 2026-09-02 KST

## Automated coverage

The production Playwright matrix exercised `1920`, `1440`, `1280`, `1024`, `768`, `390`, `360`, and reduced-motion projects, followed by launch checks in Chromium, Firefox, and WebKit. The final run completed with **219 passes, 15 intentional project-specific skips, and no failures**.

The matrix verified:

- the exact five-scene landing journey and horizontal containment at every required width;
- source-grounded sample navigation without login;
- file, processing, review, active World, grounded Ask, and signed-download browser contracts;
- customer-safe held/review states without internal reason-code exposure;
- persisted run-event and Activity surfaces;
- mobile source/World switching, command-palette keyboard behavior, and no horizontal squeeze;
- anonymous and forged-credential API rejection, mutable-contract cache boundaries, and launch security headers;
- semantic accessibility on `/`, `/privacy`, `/terms`, `/security`, `/contact`, and `/login` across launch browsers;
- reduced-motion information and interaction parity.

The tests attach full-page evidence for the public architecture and authenticated run surfaces. Authenticated journeys use an in-browser test session with intercepted tenant APIs; they prove the production browser contract, not a live customer account or external connector.

## Build and code gates

- TypeScript: passed with strict project configuration.
- ESLint: all 376 tracked and newly added `app`, `components`, and `lib` TypeScript files passed.
- Unit and contract tests: **119 files, 753 tests passed**.
- Next.js production build: passed; 53 static pages and all dynamic API routes were generated successfully.
- Playwright: **219 passed, 15 intentional skips, 0 failed**.

## Performance gate

Lighthouse 12.8 measured each route three times with direct DevTools throttling. The release budgets are performance `0.80`, accessibility `0.95`, best practices `0.90`, SEO `0.90`, LCP `3000 ms`, CLS `0.10`, and TBT `300 ms`.

| Route | Performance | Accessibility | Best practices | SEO | LCP | CLS | TBT |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | 0.97 | 0.96 | 1.00 | 1.00 | 2073 ms | 0.00023 | 73 ms |
| `/privacy` | 0.98 | 1.00 | 1.00 | 1.00 | 1901 ms | 0.00033 | 63 ms |
| `/security` | 0.98 | 1.00 | 0.96 | 1.00 | 2001 ms | 0.00024 | 64 ms |

All Lighthouse release budgets passed.

## Deployment evidence

- Runtime commit: `b91796c02559b836ce854cddbcd073c2f7eaf13d` on GitHub `main` and `codex/masterplan-2026-09-02-deploy`.
- Vercel production deployment: `dpl_EZ1GzRdYJVZbrEvkMbKFvNuEpKdk` (`Ready`, `icn1`).
- Deployment URL: `https://tavonel-saas-foundation-a1j7aormq-phillips-projects-a8cf32fc.vercel.app`.
- Production aliases: `https://tavonel.com`, `https://www.tavonel.com`, `https://tavonel-saas-foundation.vercel.app`, and the Git `main` alias all resolve to the deployment. `www` canonicalizes to the apex with `308`.
- Supabase project `tfcorhjkqcuisqhsjemz`: migrations `0035`, `0036`, and `0037` were applied. Follow-up catalog and function-body queries confirmed the allowance ledger, maximum reservation, overage, review-decision table/RLS, refund floor, pending reversal replay, and zero unresolved allowance reversals.
- Live HTTP contract: 33 checks passed with no failures. Public IA returned `200`; pending-proof routes returned `404`; source and review writes rejected anonymous access with `401`; `/api/openapi` negotiated to `/api`; raw OpenAPI remained `noindex`; pilot mode, five scenes, exact plan prices, and canonical host behavior matched the release contract.
- Live Chromium matrix: `1920`, `1440`, `1280`, `1024`, `768`, `390`, `360`, and reduced motion each returned `200`, rendered scene IDs `1,2,3,4,5`, had zero horizontal overflow, and emitted zero console or page errors.
- Live screenshots: `nextjs/test-results/live-production/` contains the seven full-page width captures, reduced-motion capture, and Scene 01-05 desktop/mobile viewport captures. The images are local QA artifacts and are intentionally ignored by Git.

The first production smoke exposed a Vercel Analytics script `404` because observability build variables were present while the collector was disabled. Commit `b91796c` made analytics explicitly opt-in, and the same eight-condition browser matrix then passed with zero errors. This report-only follow-up changes no runtime code.

## Truth boundary

Automated evidence confirms rendering, interaction, accessibility, responsive behavior, product contracts, and measured performance. It does not establish aesthetic approval, customer consent, benchmark qualification, certification, or a real paid transaction. Customer stories and benchmarks remain private until qualified evidence exists.

**FOUNDER VISUAL REVIEW REQUIRED**

## 2026-09-21 — Original-source compiler specimen and mobile film inspection

The rejected repeated skeleton was replaced with the committed Apple 2026 Q1 10-Q page render and an exact operating-expenses crop. Page moves from the full filing page to the source region; Structure, Evidence, Knowledge, and Intelligence retain that source anchor while presenting distinct cell, address, object, and grounded-answer compositions. The crop includes the complete right edge and `15,443` value. Manual stage selection now stops both progression and transition motion.

The four byte-locked 2880×1800 hero films remain the title-adjacent product film. At 390px and 360px, the player starts as a focused inspection surface with two-axis pan, stage-specific initial camera positions, and an explicit `Fit full frame` / `Focus details` control. Reduced motion remains a still poster until Play is selected.

Verification:

- Compiler specimen captures: 20 states at 1440, 390, 360, and reduced motion; 20/20 source frames stayed horizontally contained. Evidence: `goal-staging/compiler-specimen-proof`.
- Hero mobile captures: 12 focused/full-frame/reduced-motion states at 390 and 360. Evidence: `goal-staging/hero-mobile-proof`.
- Full Playwright before the final paused-transition correction: 1,445 passed, 440 intended skips, one reproducible paused-transition failure, and one retry-only source-manifest read. The paused-transition correction then passed its exact focused test.
- Final production prebuild after that correction passed `check`, all 345 Vitest files / 4,941 tests, and the 143-page Next.js build.
- Lighthouse launch budgets passed. Enforced medians: `/` 0.94/1.00/1.00/1.00, `/privacy` 0.98/1.00/1.00/1.00, `/security` 0.98/1.00/1.00/1.00, `/pricing` 0.98/1.00/1.00/1.00, `/explore` 0.95/1.00/1.00/1.00. Login and callback SEO remain measured-only at 0.66.

This is local final-tree evidence. Exact-head CI, immutable preview inspection, and founder aesthetic acceptance remain required before merge or production deployment.

**FOUNDER VISUAL REVIEW REQUIRED**

## 2026-09-20 — Homepage film and compiler-specimen composition candidate

The homepage candidate now keeps the four-cut HeroFilm directly below the headline in `#s1` and
moves the deterministic five-stage CompilerSpecimen into its own explanatory landmark, `#s2`.
Proof, recompile, trust, and start follow as `#s3` through `#s6`. The public recreation disclaimer
was removed from the hero. English and Korean entry routes preload the committed first poster.

Focused verification ran against a fresh Next.js production build on a dedicated local port:

- focused Vitest contracts: **5 files, 308 passed, 0 failed**;
- strict TypeScript: passed;
- Next.js production build: passed, including all 143 static-generation steps;
- homepage Playwright matrix: **95 passed, 49 intentional project-specific skips, 0 failed** across
  `1920`, `1440`, `1280`, `1024`, `768`, `390`, `360`, and reduced motion;
- mobile landing regression at `768`, `390`, and `360`: **24 passed, 6 intentional skips, 0 failed**;
- evidence-first entry-page contract at `1440`: **4 passed, 0 failed**;
- the production-hardening file's landing continuity test passed as part of a focused run; that run
  reported 7 passes and 2 unrelated project-specific skips before one stale evidence-link assertion
  was corrected, then the complete evidence-first file passed 4/4;
- `git diff --check`: no whitespace errors (line-ending conversion warnings only).

The first production-build attempt reached page-data collection and failed with transient missing-
module errors for two routes while the shared checkout was active. The immediate full rerun compiled,
typechecked, generated all 143 static pages, and completed successfully; only the successful build
served the browser checks above.

The homepage matrix asserts six ordered named landmarks, unique IDs and valid in-page targets, the
HeroFilm/CompilerSpecimen separation, the committed high-resolution poster, desktop and phone film
source selection, five selectable compiler stages, one source identity through all stages, roving
keyboard selection, manual pause persistence, offscreen and hidden-document suspension, reduced-
motion parity, mobile 44px controls, and zero horizontal overflow for `/` and `/ko` at every required
width.

This evidence proves the local production candidate's DOM, interaction, responsive, motion, and
asset-selection contracts. It does not include a founder visual pass, cross-browser launch matrix,
new screenshot census, Lighthouse rerun, deployed-byte validation, or live customer-account proof.

**FOUNDER VISUAL REVIEW REQUIRED**

## 2026-09-20 — Final public-route matrix and `/demo` paper contrast repair

The frozen local production candidate was inspected on `/`, `/enterprise`, `/security`, `/trust`,
and `/demo` at `1920`, `1440`, `1280`, `1024`, `768`, `390`, `360`, plus a 1440px
reduced-motion condition. The initial matrix contains 40 full-page captures. Every navigation
returned HTTP 200 with zero horizontal overflow, broken images, console errors, or page errors.
Aborted requests in the capture manifest are Next.js speculative RSC prefetches and two abandoned
film loads; no displayed asset failed.

Direct inspection found one release-blocking visual defect on `/demo`: the shared dark-ground text
tokens made its wordmark, navigation, H1, section H2s, and evidence H3s nearly white on the warm
paper route. Lighthouse confirmed 18 contrast failures, accessibility `0.96`, and a serious
`color-contrast` failure. The fix is scoped to
`nextjs/components/signed-product-demo.module.css`: the demo now maps its ink, muted, source, and
verified colors to the existing paper-safe TAVONEL tokens, exposes the paper text ladder to global
heading rules, and gives the shared header a paper-safe unscrolled and scrolled state only when it
contains this demo.

The final production rebuild generated 143/143 static pages. Fresh `/demo` captures at all seven
required widths and reduced motion returned 200 with zero overflow, broken images, console errors,
or page errors. Direct inspection at 1920, 1440, 390, 360, and reduced motion confirms the header
and every H1/H2/H3 use dark paper-safe ink. Current-build three-run Lighthouse medians for
`/trust` and `/demo` score `1.00` in performance, accessibility, best practices, and SEO;
`color-contrast` scores `1.00` with zero failing elements on both routes. Focused contract/token
tests pass 31/31, TypeScript passes, and `git diff --check` reports no whitespace error. The
definitive full browser matrix finished with 1,607 passed, 431
intentional project-specific skips, one transient `page.goto` `ERR_ABORTED` that passed on retry,
and zero final failures; its immediate focused rerun passed 1/1.

Evidence:

- initial 40-route matrix and manifest: `nextjs/.chatgpt2codex/final-web-qa/evidence/`;
- final eight-condition `/demo` matrix: `nextjs/.chatgpt2codex/final-web-qa/evidence/after-demo-final/`;
- three-run Lighthouse reports: `nextjs/.chatgpt2codex/final-web-qa/evidence/lighthouse/`;
- final-build three-run `/trust` and `/demo` Lighthouse reports:
  `nextjs/.chatgpt2codex/final-web-qa/evidence/lighthouse-final-full/`;
- final `/trust` and `/demo` accessibility reports:
  `nextjs/.chatgpt2codex/final-web-qa/evidence/lighthouse-final/trust-accessibility.json` and
  `nextjs/.chatgpt2codex/final-web-qa/evidence/lighthouse-final/demo-accessibility.json`;
- definitive build receipt: `verification/final-e2e-3199/build-definitive.log`.

Lighthouse 12.8 produced the `/`, `/enterprise`, and `/security` medians on the immediately
preceding frozen production build, and the `/trust` and `/demo` medians on the final production
build. Chrome's DevTools-throttled trace repeatedly failed before navigation with `NO_NAVSTART`, so
the completed performance samples use provided throttling and are unthrottled local lab
measurements, not field performance or release-budget evidence.

| Route | Performance | Accessibility | Best practices | SEO | LCP | CLS | TBT |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | 1.00 | 1.00 | 1.00 | 1.00 | 535 ms | 0 | 0 ms |
| `/enterprise` | 1.00 | 1.00 | 1.00 | 1.00 | 159 ms | 0 | 0 ms |
| `/security` | 1.00 | 1.00 | 1.00 | 1.00 | 158 ms | 0 | 0 ms |
| `/trust` final | 1.00 | 1.00 | 1.00 | 1.00 | 168 ms | 0 | 0 ms |
| `/demo` before repair | 1.00 | 0.96 | 1.00 | 1.00 | 239 ms | 0 | 0 ms |
| `/demo` final | 1.00 | 1.00 | 1.00 | 1.00 | 255 ms | 0 | 0 ms |

This is local production-build, automated layout, accessibility, and direct visual evidence. It
does not establish production deployment, customer evidence, benchmark qualification, or founder
aesthetic acceptance.

**FOUNDER VISUAL REVIEW REQUIRED**

## 2026-09-10 — Odd public record-grid closure

A full-page contact-sheet review of the production-build public route set found two remaining empty visual cells that geometry-only route checks had not classified: the final records on `/security` and `/status` occupied the left half of their two-column grids while the divider background painted the unused right half gray. The existing `/subprocessors` repair used the same component pattern, so the shared rule now makes the final odd record span the full grid on all three routes.

Fresh 1440px captures were inspected before and after the change. The gray half-cells are gone and the final records fill their rows. Evidence is retained under `nextjs/.chatgpt2codex/public-detail-audit/contact-sheets/` and `nextjs/.chatgpt2codex/fixed-*-1440.png`; these artifacts remain untracked.

Verification on the production build:

- full Playwright matrix: **916 passed, 211 intentional project-specific skips, 0 failed** across `1920`, `1440`, `1280`, `1024`, `768`, `390`, `360`, reduced motion, and launch Chromium/Firefox/WebKit projects;
- focused odd-grid and layout regression: **32 passed, 0 failed** across all seven required widths plus reduced motion;
- production build: passed, including TypeScript, ESLint, **217 test files / 2,677 unit tests**, and 74 generated static pages.

This closes the concrete empty-cell defect and adds a browser geometry guard for the three affected public routes. Aesthetic acceptance remains a human gate.

**FOUNDER VISUAL REVIEW REQUIRED**

## 2026-09-10 — consent hydration prerequisite in premium craft QA

The merge-SHA run for bf06a937 failed one 390px pointer-target case twice. Its captured screenshot shows the analytics consent panel still covering the scene controls. The helper used a one-shot visibility probe before client hydration, so it could skip the dismissal and measure behind the subsequently mounted panel.

The helper now waits for the real named consent region, clicks No thanks, and waits for that region to disappear. Geometry and elementFromPoint assertions, target-size floors, project coverage and retries are unchanged. Application code and consent behavior are unchanged.

The corrected premium-craft suite ran against actual https://tavonel.com at 1920, 1440, 1280, 1024, 768, 390, 360 and reduced motion: 27 passed, 5 existing desktop-only scene-mark skips, 0 failed. This is bounded automated public-route evidence, not founder visual acceptance or authenticated customer E2E.

Failure evidence: GitHub Actions run34376893316, job102551856465, artifact10114616623 (product-qa). Local retained screenshot and trace are under D:/tvfix-0909/.chatgpt2codex/merge-product-qa-20260910/. The corrected live-run log is D:/tvfix-0909/.chatgpt2codex/consent-qa-all-widths-20260910.log.

## 2026-09-10 — Detail completion candidate

User screenshot revealed half-empty gray panels in Home Scene 02. Root cause: a two-column `.chain` retained its divider background when it had one child. Candidate fills the final odd child across both columns, preserving multi-item grids. Home instructions use readable prose and link to the real capability manifest; connector and assisted-import panels now offer an actual next action.

Local production build: `.chatgpt2codex/detail-build-0910.log`, lint/typecheck and 199 test files / 2434 unit tests passed. First premium run: 34 passed, 5 existing skips, 1 flaky because 44px was represented as 43.999969 after reveal transform. New regression rounds to hundredth-pixel precision, preserving the 44px requirement. Repeat of all eight input configurations with retries disabled: 8 passed (`detail-input-rerun-0910.log`).

`.chatgpt2codex/detail-audit-0910/` is an IN-PROGRESS local production-build capture of 85 historical route targets at seven widths plus reduced motion. Input screenshots inspected at 1440; no founder visual acceptance claimed. Auth redirects do not qualify Workspace. The capture manifest contains exact baseline and application diff. A subsequent capability-link underline CSS change still requires rebuilt verification. Full route inspection, accessibility, Lighthouse, exact-SHA CI and production verification remain open.

Beta labels remain truthful; connector implementation and real-account qualification are tracked in `D:\TAVONEL_DETAIL_COMPLETION_REGISTER_2026-09-10.md` under the existing active goal.

PR49 full Product QA found a real regression at 390/360: the new Capability Manifest inline link was only 16px tall. The existing 44px mobile test failed both initial and retry runs (400 passed / 2 failed / 86 existing skips). Apply the same `input-next` 44px action treatment to this link; no test exception or threshold change. Rebuild, targeted existing mobile checks and fresh exact-head CI are required before merge. Earlier input-panel checks did not cover this separate inline link.

## 2026-09-10 — Honest processing and review states

Candidate follow-up to PR49. Login now reads customerData.enabled from /api/status before offering immediately usable evaluation processing. Missing or disabled capability shows a clear gate and a 44px public Explore action. Review-required compile jobs explain the paused review state and link to their validated collection ID; existing cancellation behavior is retained. Integrations now states that adapter deletion events are not yet applied downstream by the import worker.

Validation: lint/typecheck passed; component rendering and brand-copy suites 200 passed. Added component tests use Vitest automatic JSX transform, matching Next's runtime (the first SSR attempt exposed the previous classic-transform configuration). The final login capability browser suite passed 24 cases at seven widths plus reduced motion, retries disabled, through a fresh production build. Capability responses in these cases are explicitly mocked: this proves presentation for enabled/disabled/missing states, not production customer activation. Initial port 3119 belonged to another process; tests used verified-free 3137 without disturbing it. Receipt: D:\tvdetail-0910\.chatgpt2codex\login-gate-final-0910.log.

Actual authenticated review-package navigation, final visual review, exact-SHA CI and production verification remain required. Connector deletion/ACL lifecycle implementation remains open; honest copy does not qualify the connector.

## Source preview lifecycle candidate — 2026-09-10
- Scope: World Studio authenticated PDF consumer. Preview state is bound to source ID and version; page changes reuse downloaded bytes and remount the canvas for the requested page. Cancelled imports/page loads do not continue into rendering.
- Local production build via Playwright webServer (`pnpm build`, including its check/unit prebuild) completed successfully. Browser regression passed at1920/1440/1280/1024/768/390/360 and reduced motion:8/8. Final run also checks zero page errors and canvas-relative bbox geometry within2px.
- Test proves actual PDF.js canvas pixels change across pages, one read for two pages of a version, and no previous canvas while another source is loading. Authentication/API responses and the two-page vector PDF are deterministic test fixtures. This is NOT actual customer login/provider/production evidence.
- Captures: local `.chatgpt2codex/source-preview-captures-0910/` (8 files). Visually inspected360 and1440; remaining captures have automated geometry/functional checks only. Full-page sticky navigation capture is not a viewport-position measurement.
- Receipts: `.chatgpt2codex/source-preview-browser-3131-0910.log`, `source-preview-visual-0910.log`, `source-preview-geometry-0910.log`. Existing3119 listener was preserved; dedicated3131 server stopped after QA.
- Still required: actual authenticated deployed PDF path, large-file Vercel stream behavior, final exact-SHA CI and whole-program visual acceptance. No Beta qualification or customer-data activation claimed.

## Connection progress UI candidate — 2026-09-10
Production-build fixture browser suite passed8/8: seven widths plus reduced motion. Receipt .chatgpt2codex/connection-sync-browser-0910.log; captures .chatgpt2codex/connection-sync-captures-0910/. Directly inspected360/1440: import state/counters and permission recovery prose wrap within the card; diagnostic code wraps on mobile. Full-page captures include sticky shell/navigation at capture scroll positions and are not proof of viewport occlusion behavior. The other six captures have automated checks only. Fixture labels and synthetic auth/provider responses are intentional; no customer/provider or founder visual acceptance claimed.
Further whole-page typography, shell positioning, keyboard/accessibility and actual authenticated production checks remain required. Beta status unchanged pending complete provider lifecycle qualification.

## 2026-09-10 — Public layout balance and buyer-facing source paths

The user-supplied `/integrations` capture exposed a shared two-column composition failure: the section lede and card grid were separate `.body` children, so CSS grid auto-placement trapped the cards in the narrow title column and left most of the desktop canvas unused. The same contract was repaired on `/docs`, `/docs/[section]`, and `/changelog`; supporting Trust navigation now remains in the reading column, and an odd final subprocessor card spans the available row.

Home source intake now presents a three-step Choose → Inspect → Compile visual, with shorter source-route copy and direct next actions. `/integrations` presents read-only and customer-run access modes in place of unexplained maturity badges, while security and lifecycle detail remains available in the per-provider disclosure. Pricing and enterprise copy were shortened, and Evidence locator scope moved to an explicit disclosure. The footer no longer defers off-screen navigation paint and retains two grouped columns at 390/360 so the links are visible without an empty capture region.

Verification on a fresh production build:

- `pnpm build`: TypeScript and ESLint passed; 217 test files / 2,677 tests passed; 74 static pages generated.
- Public geometry census: 54 sitemap routes × 7 widths (`1920`, `1440`, `1280`, `1024`, `768`, `390`, `360`) = 378 production renders, 0 status, overflow, narrow-paragraph, or broken body-grid findings.
- Focused Playwright regression: 24 passed across all seven required widths plus reduced motion. It checks the shared body contract, narrow desktop paragraphs, buyer-facing integration labels, footer overlap/painting, mobile two-column grouping, and 44px link targets.
- Home source-route matrix: 8 passed across all required widths and reduced motion.
- Direct visual review: final `/integrations` captures at 1778 and 390 show full-width cloud/private source cards, readable line lengths, no gray empty panels, and a fully painted compact mobile footer. Local evidence is under `nextjs/.chatgpt2codex/copy-visual-20260910/` and is intentionally untracked.

This is production-build and automated layout evidence. Provider real-account qualification, authenticated customer E2E, and aesthetic acceptance are separate gates.

**FOUNDER VISUAL REVIEW REQUIRED**

## 2026-09-10 — Public composition and source-bound proof candidate

The user-supplied `/solutions/ai-ready-knowledge` capture exposed a second composition defect after the shared body repair: at intermediate desktop widths the title rail and evidence cards still competed for space, so long records could collapse below 330px while unused canvas remained elsewhere. The shared editorial body now keeps its two-column composition only above 1320px and becomes one readable column at 1280px and below. Wide screens retain the asymmetric editorial composition and sticky claim; intermediate and mobile widths give evidence, records, and actions the full reading measure.

The solution family now opens with an inspectable, source-bound product visual built from the existing public Apple SEC fixture: 5 filings / 290 pages, 1,281 evidence regions, 6,300 compiled objects, and the W0 to W4 version chain. It links to the actual Explore evidence surface. This replaces an abstract text-only strip without inventing customer, model, or benchmark proof. Workflow and outcome sections use a denser, responsive visual sequence; the fifth workflow item closes the mobile grid instead of leaving an empty cell. Public Knowledge Compiler registry heroes were rebalanced around a wider claim and explanation measure.

Official Reducto, Glean, Unstructured, and LlamaParse public surfaces were reviewed for information hierarchy. The useful shared pattern is rapid movement from the input and outcome to proof and a concrete next action. TAVONEL applies that pattern with its own evidence vocabulary and public source data; no competitor artwork, copy, or unsupported comparison claim was introduced.

Fresh production-build verification:

- Next.js production build preflight: TypeScript and ESLint passed; **217 test files / 2,677 unit tests** passed; 74 static pages generated.
- Full Playwright matrix: **936 passed, 215 intentional project-specific skips, 0 failed** across `1920`, `1440`, `1280`, `1024`, `768`, `390`, `360`, reduced motion, and launch Chromium/Firefox/WebKit projects.
- Public geometry census: 54 sitemap routes at `1440`, `1280`, and `390` = **162 full-page renders**, 0 non-200 responses, page errors, horizontal overflow, or long paragraphs trapped below 330px.
- Direct visual inspection covered the repaired `/evidence` page at 1280px and the source-bound solution page at 1280px and 390px. Captures and the complete census are retained under `nextjs/.chatgpt2codex/public-composition-census/` and remain untracked.
- Lighthouse 12.8, three-run median per route, passed every enforced launch budget:

| Route | Performance | Accessibility | Best practices | SEO | LCP | CLS | TBT |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | 0.95 | 1.00 | 1.00 | 0.92 | 2396 ms | 0.00127 | 6 ms |
| `/privacy` | 0.97 | 1.00 | 0.96 | 1.00 | 2057 ms | 0.00023 | 72 ms |
| `/security` | 0.97 | 1.00 | 0.96 | 1.00 | 2159 ms | 0.00146 | 8 ms |
| `/pricing` | 0.97 | 0.98 | 1.00 | 0.91 | 2170 ms | 0.00022 | 14 ms |
| `/explore` | 0.95 | 0.98 | 0.93 | 1.00 | 2158 ms | 0.00126 | 129 ms |

The repository does not define `interactions:check` or an Impeccable script; their coverage is represented by the checked-in Playwright interaction, accessibility, visual continuity, and production-hardening suites rather than reported as a command that ran.

This evidence validates the candidate bytes locally. Exact-SHA CI, merge, production deployment, and live route verification remain release gates. Automated evidence does not constitute aesthetic approval.

**FOUNDER VISUAL REVIEW REQUIRED**

## 2026-09-23 — Buyer journey, pricing and source-bound benchmark candidate

The entry now centers the outcome and places “How it compiles” directly below it. The five-stage source specimen opens on Evidence without automatic motion; the public source inspector and optional film follow in the next scene. Pricing is the persistent header action and owns consultation. The benchmark entry leads with the R-01 same-pipeline recovery result (80.6 versus 53.7 over 1,403 documents and 8,413 checks), its receipt, and its weak-scan limitation; it explicitly excludes a live-service or competitor-superiority interpretation. A versioned DPA v2 draft replaces the customer-facing v1 links while preserving v1.

The final local production build passed strict TypeScript, ESLint, the type floor, 368 Vitest files / 5,226 tests, and 145 static-generation steps. The focused Playwright production matrix passed **268 tests with 508 intentional project skips and zero failures** across 1920, 1440, 1280, 1024, 768, 390, 360 and reduced motion. It covered the landing, source evidence, global navigation including WebKit, mobile layout, scene continuity, pricing links, and visual continuity. The local server was rebuilt with the repository's `PLAYWRIGHT_LOCAL_HTTP=1` setting: its CSP omits `upgrade-insecure-requests` so WebKit can load the HTTP test assets. That setting does not weaken the production CSP.

Current viewport captures are in the untracked `qa-captures/` directory: `home-{width}-final.png`, `pricing-{width}-final.png`, and `benchmarks-{width}-final.png` at all seven widths, plus `home-reduced-motion-final.png`. All 21 route-width combinations had zero horizontal overflow. Direct inspection of the 1440 and 360 pixel folds found no text overlap in the revised hero, Pricing, or benchmark entry. These captures are local visual evidence, not founder aesthetic acceptance.

Lighthouse 12.8 three-run medians passed all enforced launch budgets: `/` performance 0.93, accessibility 1.00, LCP 2640 ms and CLS 0; `/pricing` 0.97/1.00, LCP 2136 ms and CLS 0; `/explore` 0.95/1.00, LCP 2347 ms and CLS 0. `/privacy` and `/security` both measured performance 0.98 and accessibility 1.00. Login and auth callback remain measure-only for SEO (0.66), as defined by the existing gate.

The DPA v2 is a draft pending legal review. The recovery comparison is historical research and does not certify a deployed model. The work remains a review candidate until exact-SHA CI, immutable preview, live deployment checks, and founder visual acceptance pass.

The authenticated founder-workspace reset dry run exposed two release defects: its ledger had no initial `prepared` state default and its API omitted the top-level reset ID the panel requires. The production default is now `prepared` and the migration ledger records version `20260923034853`; the response contract is fixed in this branch and covered by service/route unit assertions. The actual test-data reset has not run and requires this code to deploy before the guarded UI can finish.

The full hermetic Playwright run exercised 2,111 cases: **1,476 passed, 608 intentionally skipped, 27 failed**. All 27 failures were stale assertions in five browser scenarios: the now-receipted R-01 percentage, the four-link section bar with separate Pricing, the phone sheet's new link count, and the Scene 02 film's 960px mid-desktop cap. Those assertions were updated to test the new contracts, then all four affected spec files passed across the same seven widths and reduced motion: **163 passed, 5 intentionally skipped, 0 failed**. This is targeted closure of every observed full-run failure; the full suite was not repeated after the test-only corrections.

**FOUNDER VISUAL REVIEW REQUIRED**
