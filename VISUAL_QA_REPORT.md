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
