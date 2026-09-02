# TAVONEL Final Web Product Workspace Masterplan Traceability

Authority: `D:\TAVONEL_FINAL_WEB_PRODUCT_WORKSPACE_MASTERPLAN_2026-09-02.md`

This document maps the final masterplan to production code and objective verification. A row marked `Implemented` still requires the repository-wide verification and live deployment evidence listed at the end. Automated checks do not replace founder visual approval.

## Commercial blockers

| # | Requirement | Status | Implementation and proof |
|---|---|---|---|
| 1 | Subscription allowance ledger | Implemented | `supabase/migrations/0035_subscription_allowance_ledger.sql`; migration contract test |
| 2 | Renewal allowance | Implemented | `nextjs/lib/paddle-billing-event.ts`; event idempotency and renewal tests |
| 3 | Maximum reservation and overage | Implemented | `supabase/migrations/0036_maximum_reservation_and_overage.sql`; `compute-reservation.ts`; reservation tests |
| 4 | Remove legacy prepaid packs | Implemented | Active catalog contains subscription plans only; catalog and status tests |
| 5 | One global pilot/live mode | Implemented | `nextjs/lib/commercial-mode.ts`; status, pricing, and authentication entry points use the same mode |
| 6 | Paddle end-to-end contract | Implemented, live proof gated | Signed webhook, allowance grant, reservation, settlement, and receipt paths are covered by tests. A real paid transaction remains gated by live commercial mode and founder authorization. |

## P0 public website

| # | Requirement | Status | Implementation and proof |
|---|---|---|---|
| 7 | Exactly five landing scenes | Implemented | `home-page-client.tsx` and landing E2E assert five scenes: Knowledge Compiler, Input, Compile Film, Evidence, Start |
| 8 | Remove defensive disclaimers | Implemented | Customer-facing brand-copy tests reject internal and defensive language |
| 9 | Final login copy | Implemented | `app/login/page.tsx` and callback copy use the approved account/workspace language |
| 10 | Human and machine OpenAPI UX | Implemented | `/api` is human documentation; `/openapi.json` is machine JSON; `/api/openapi` negotiates/redirects and sets `X-Robots-Tag: noindex` |
| 11 | Remove pricing internals | Implemented | Pricing exposes plans, included pages, estimate, maximum, and overage only |

## P1 workspace

| # | Requirement | Status | Implementation and proof |
|---|---|---|---|
| 12 | Drag and drop | Implemented | Workspace drop zone accepts a real `DataTransfer`; intake tests cover files and recursive entries |
| 13 | Folder upload | Implemented | `webkitdirectory` input and recursive directory reader preserve relative paths |
| 14 | Safe ZIP extraction | Implemented | Central-directory validation blocks traversal, encrypted/nested archives, bombs, and configured limits |
| 15 | Source connection cards | Implemented | Seven approved source cards are visible without unsupported Coming Soon claims |
| 16 | Preflight summary | Implemented | Files, pages, archives, warnings, estimate, and maximum are calculated before explicit Compile |
| 17 | Compile Cinema | Implemented | SOURCES/READ/STRUCTURE/WORLD stages advance from transfer, persisted objects, and model events rather than timers |
| 18 | Completion screen | Implemented | Ready state exposes Open World, Ask, and Download actions with persisted metrics |
| 19 | Download package | Implemented | Existing signed export flow remains connected to the ready-state action |

## P1 product proof

| # | Requirement | Status | Implementation and proof |
|---|---|---|---|
| 20 | Actual PDF evidence viewer | Implemented | Tenant/version-scoped signed source URL and `pdfjs-dist` canvas rendering; bbox appears only after page render |
| 21 | Review side by side | Implemented | Evidence and compiled world are shown together; Accept/Edit/Reject append auditable decisions through `/api/v1/reviews` |
| 22 | True semantic graph | Implemented | Graph reads the persisted `WorldReadModel`; no fixture nodes or edges are synthesized |
| 23 | Directory tree | Implemented | Directory and ontology lenses derive from the same persisted read model |
| 24 | Semantic event stream | Implemented | Persistent run events and SSE route support replay through `Last-Event-ID`; OpenAPI publishes the contract |

## P2 public trust surfaces

| # | Requirement | Status | Implementation and proof |
|---|---|---|---|
| 25 | Docs | Implemented | `/docs` is public and included in sitemap/navigation |
| 26 | Changelog | Implemented | `/changelog` is public without fabricated release dates |
| 27 | External status | Implemented | `/status` is the public status surface and `/api/status` is the machine-readable runtime contract |
| 28 | Customer stories | Correctly private pending proof | `/customers` returns `404`; no fabricated logos, quotes, or outcomes are published |
| 29 | Benchmarks | Correctly private pending proof | `/benchmarks` returns `404`; publication requires qualified reproducible evidence |

## Cross-cutting acceptance

- Public IA, canonical metadata, sitemap, robots, private experimental routes, `/film` noindex, and raw OpenAPI noindex follow the masterplan.
- Ask citations select persisted evidence and open the exact signed document version, page, and bbox.
- Privacy mode masks customer content while preserving non-sensitive processing status.
- Billing display, allowance grant, standard reservation, maximum exposure, settlement, and receipt share one contract.
- Every customer-visible fact, node, edge, evidence region, progress stage, and metric is backed by persisted or live run data.
- Seven viewport projects (`1920`, `1440`, `1280`, `1024`, `768`, `390`, `360`) and reduced motion are required for final visual QA.

## Release evidence gate

Runtime release commit `b91796c02559b836ce854cddbcd073c2f7eaf13d` satisfies the objective gates below. The evidence-document commit that records these results changes no runtime code.

1. **Verified:** strict TypeScript, ESLint, 753 unit/contract tests, interaction checks, 219 Playwright passes, accessibility coverage, production build, and three-run Lighthouse budgets passed.
2. **Verified:** Supabase migrations `0035` through `0037` were applied and queried successfully in project `tfcorhjkqcuisqhsjemz`, including function-body and unresolved-reversal checks.
3. **Verified:** the runtime commit is on GitHub `main` and Vercel deployment `dpl_EZ1GzRdYJVZbrEvkMbKFvNuEpKdk` is `Ready`.
4. **Verified:** `https://tavonel.com` and `https://www.tavonel.com` resolve to that deployment. Thirty-three live HTTP checks and the seven-width plus reduced-motion Chromium matrix passed with zero browser errors or horizontal overflow.
5. **Verified with human gate retained:** `VISUAL_QA_REPORT.md` records the production evidence and retains `FOUNDER VISUAL REVIEW REQUIRED` until the founder approves the visual result.
