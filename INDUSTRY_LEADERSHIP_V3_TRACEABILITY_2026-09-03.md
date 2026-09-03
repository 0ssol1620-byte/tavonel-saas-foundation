# Industry Leadership V3 — traceability

**Sources**

- `TAVONEL_INDUSTRY_LEADERSHIP_FULL_SITE_LAUNCH_BLUEPRINT_V3_2026-09-03.md`
- `TAVONEL_INDUSTRY_LEADERSHIP_FULL_SITE_PRODUCTION_MASTERPLAN_2026-09-03.md`

**Baseline** `d919070` (`origin/main`, the commit both documents audited)
**Branch** `agent/industry-leadership-v3`
**Date** 2026-09-03

Every numbered item in both documents appears below exactly once, with an honest state. Nothing
is marked done that was not done, and nothing is dropped without saying who has to decide it.

## Status vocabulary

| State | Meaning |
|---|---|
| `DONE` | Implemented on this branch, with tests, and verified by the checks named at the bottom |
| `PARTIAL` | Implemented as far as it can go without something listed under BLOCKED; what remains is named |
| `BLOCKED-FOUNDER` | Requires a decision that `CLAUDE.md` reserves for the founder — pricing, public claims, legal wording, consent |
| `BLOCKED-EXTERNAL` | Requires infrastructure, money, a third party or a production migration this session cannot perform |
| `DEFERRED` | Correctly out of scope for a launch-blocking pass; the document itself schedules it later |

---

## 1. P0 — product truth

| ID | Item | State | Where |
|---|---|---|---|
| P0-04 | Developer plan can compile a World | `DONE` | `app/api/collections/compile/route.ts` now requires `observer`, not `studio` |
| — | Developer plan can mint, rotate and revoke an API key | `DONE` | Same mismatch, found while testing the above: three `developer/keys` routes required `studio` while the Developer card sells "API and MCP access" |
| P0-02 | One-document compile | `DONE` | `lib/compile-limits.ts`; the compiler's floor of two is gone |
| P0-01 | UI and API limits agree | `DONE` | One shared `judgeCompileSet`, used by the route, the compiler, the workspace and the operations view model |
| — | Limits shown before selection | `DONE` | `COMPILE_LIMITS_NOTICE` in the dropzone and the compile selection bar |
| P0-06 | Estimated vs verified page count | `DONE` | `PageEstimate.confidence`; a byte-derived count can never be labelled "Verified pages" or authorise a charge |
| P0-11 | Fabricated landing metrics removed | `DONE` | `WORLD v184 / FACTS 128,470 / NEEDS REVIEW 1` gone; a regression test bars them |
| — | Commercial state unified | `DONE` | `lib/commercial-state.ts` replaces `commercial-mode.ts` + `billing-launch.ts`; sandbox can no longer publish live legal copy |
| P0-10 | Review `Edit` renamed to what it does | `DONE` | "Request change"; the real patch editor is a separate build |
| — | Accept stops asserting what the reviewer did | `DONE` | The canned "Accepted after comparing…" is replaced by a neutral record plus an optional note |
| P0-12 | Candidate vs active wording | `DONE` | The completion panel distinguishes "candidate ready for review" from "Compiled World is ready" |
| P0-07 | ZIP cannot freeze the main thread | `PARTIAL` | Ceiling lowered from 100 MB / 500 MB expanded to 25 MB / 100 MB, refused before the archive is read. Moving extraction to a Web Worker is not done — see *Not attempted*. |
| P0-03 | Durable server-side compile orchestration | `BLOCKED-EXTERNAL` | Needs job tables, a worker and a queue; new migrations against production Supabase |
| P0-05 | Team seats enforced, or not sold | `PARTIAL` | The unenforceable claims are off the card and `plan-entitlement.test.ts` bars them returning. Team still appears as a plan; whether to withdraw it entirely is a commercial call |

## 2. P0 — public site

| Item | State | Where |
|---|---|---|
| Scene 3 becomes one pinned player | `DONE` | `components/compile-stage-player.tsx`; tabs, keyboard, swipe, one decoder, reduced-motion stills |
| `PublicProofRegistry` links into deliberate 404s | `DONE` | Its own nav is gone; it wears the standard chrome |
| Empty "NO QUALIFIED RECORDS" panel | `DONE` | Removed |
| One header and footer everywhere | `DONE` | `lib/site-navigation.ts` + `components/public-site-chrome.tsx` |
| Footer reduced to four groups | `DONE` | Product / Build / Trust / Legal |
| `Resources` stops meaning `/research` | `DONE` | `/resources` hub added |
| `/enterprise` rewritten for a buyer | `DONE` | `NOT YET`, `POLICY-GATED`, `REVIEW REQUIRED` and the GPU vendor are gone |
| `/security` copy purged | `DONE` | Certification denials, the dated internal qualification note and the vendor name removed; controls section added |
| `/evidence` becomes Technical Evidence | `DONE` | Mechanism and self-verification |
| Research record preserved, relocated | `DONE` | `/research/notes` — see *Where the blueprints and the constitution disagree* |
| `/research` rewritten as research leadership | `DONE` | Areas and method; per-result states live with the results |
| `/product/compiled-world` unshipped card | `DONE` | The `DIRECTION — Automated ontology` card is gone |
| `/product/document-understanding` defensive copy | `DONE` | Replaced with what the reader gets |
| `/explore` neutral sample, no research object | `DONE` | Maintenance manual; every object resolves |
| Supported formats match the whitelist | `DONE` | "Office documents" replaced by named extensions on the landing page and the dropzone |
| `/pricing` single plan source, no unenforced claims | `DONE` | Built from `BILLING_OFFERS`; `modeled at`, seats and SSO/SCIM removed |
| `/terms`, `/refunds` pilot and live templates | `PARTIAL` | Split and driven by one state; the wording still needs a lawyer — `BLOCKED-FOUNDER` |
| `/reproducibility` noindex until complete | `DONE` | `robots: { index: false }`, out of the sitemap, empty section removed |
| `/customers`, `/benchmarks`, `/research/experiments` stay 404 | `DONE` | Unchanged; both documents call this correct |

## 3. Blocked — founder decisions

`CLAUDE.md` reserves these. None was decided on the branch.

| Item | Question | Blueprint reference |
|---|---|---|
| Team price at GA | Keep `$99 / 2,500` as a founding rate, move to `$149`, or cut included pages to 1,500? The card still shows the live price. | Launch 9.12, 17.5; Masterplan 9.2 |
| Legal wording | Pilot and live Terms, Privacy and Refunds are now separate templates. The text needs counsel before live charges. | Launch 9.26–9.28; Masterplan 13.13, 13.18, 13.29 |
| Server-side filenames | Storing customer filenames tenant-side reverses a deliberate privacy decision recorded in `lib/document-names.ts`. Cross-device names cannot work without it. | Launch 7.6; Masterplan 7.5 |
| Withdrawing Team | Whether Team is sold at all before invitations, roles and seats exist. | Masterplan 10.3 |
| Public claims | Any number added to a page needs a receipt and the founder's sign-off. None was added. | `CLAUDE.md` — Evidence |

## 4. Blocked — external

| Item | What it needs |
|---|---|
| Durable batch orchestration, 100+ file corpora | Job tables, worker, queue, resume; production migrations |
| Real page-count service | Server-side PDF and Office pagination in the sanitisation worker |
| Independent status page | A third-party uptime provider and an account |
| Connector GA end-to-end | Real Google, Dropbox and Microsoft accounts and OAuth review |
| Physical device film QA | iPhone, iPad and Android hardware |
| Paddle production E2E | A live transaction against a real card |
| Public benchmark, case studies, customer logos | Customer consent and a frozen reproducible run |
| SOC 2 / ISO 27001, SSO / SCIM, DPA, SLA | Contracts, audit and budget |

## 5. Deferred by the documents themselves

P1 and P2 as scheduled in Launch §25 and Masterplan §28: graph canvas, `directoryPlan` lens,
ontology viewer, inline review patch editor with revalidation, full documentation IA, SDKs,
changelog rebuild, integration detail pages, MCP tool matrix, Compiled World Package spec and
open-source validator, SEO pillar cluster, design-partner programme, KPI instrumentation.

## 6. Where the blueprints and the constitution disagree

Both documents call for removing `BUILT, NOT PROVEN`, `NOT SUPPORTED` and the failed
blind-quality-detection result from the public site. `CLAUDE.md` requires the opposite: *"A
failed hypothesis is evidence. Blind quality detection is published as not supported."*

Read closely the documents ask for **relocation**, not deletion — Masterplan 13.8 offers moving
the record to `/research/notes`, and 13.20 says failures belong inside research notes with their
context. That is what was done. Every entry is still published, in full, at `/research/notes`,
linked from `/research`, from `/evidence` and from `/product/document-understanding`. What
changed is that a buyer following "Technical evidence" is no longer handed a list of experiments
that did not work, and a research reader is no longer expected to find findings on a sales page.

Nothing was softened, and no measurement was removed.

## 7. Not attempted, and why

- **Web Worker archive extraction.** The right fix for P0-07, and the upload path is the product's
  critical path. A worker that fails to bundle breaks every upload, and this session could not
  test one against real archives behind authentication. The freeze hazard is removed by the lower
  ceiling; the worker is a scoped follow-up.
- **Inline review patch editor.** Needs a candidate patch model, revalidation and receipt
  regeneration. Both documents schedule it at P1. The button now states what it does.
- **Review `reason` column.** The neutral acceptance record is a sentence rather than an empty
  note because `foundation_review_decisions.reason` is `not null check (char_length between 8 and
  1000)`. Making the note truly optional is a migration.

## 8. Verification

### What was actually run in this session

| Check | Command | Result |
|---|---|---|
| Types | `tsc --noEmit` | exit 0, no output |
| Lint | `eslint app components lib e2e` | exit 0, no findings |
| Unit + contract tests | `vitest run` | 777 passed / 777, across 121 files |
| Production build | `next build` | compiled successfully (~11 min on this machine) |
| Browser QA | `playwright test` -- every project | **219 passed, 0 failed, 15 skipped**, exit 0 |
| Internal links | source sweep of every `href` in `app/` and `components/` | 164 files against 113 routes and 28 static assets; all resolve |
| Lighthouse budgets | `qa:lighthouse` against a built server | **passed**, exit 0 -- figures below |

The matrix is all eleven projects: widths 1920, 1440, 1280, 1024, 768, 390 and 360, plus
reduced-motion, plus the launch suite in chromium, firefox and webkit.

The first pass over this branch was 67 passed and 15 failed. The 15 were 5 distinct tests
repeated across 3 projects; a sixth surfaced at 390px only once those were fixed. All six are
resolved below and the matrix is now green.

The lint run covers `e2e` as well as the three directories the repository's own `lint` script
names, because this branch edits two spec files and a spec that does not lint is a spec nobody
is checking.

### What the browser QA found, and what it changed

The 15 failures were 5 distinct tests repeated across 3 projects. Three were real defects in
this branch's own work, and the code was fixed:

- **`/security` stated the same sentence twice.** "Every external operation fails closed."
  appeared as the lede's thesis and again, verbatim, opening the Reliability control. The
  Reliability entry now elaborates rather than repeating.
- **`/explore` had lost its honesty marker.** The rewrite dropped `DETERMINISTIC PRODUCT SAMPLE`
  and the "not customer proof" line, leaving a fixed fixture rendered in the product's real
  interface with nothing saying so -- the instrument bar's `v3 ACTIVE` and `4 WITH EVIDENCE`
  read as a live deployment. Restored, with the reasoning kept in the source.
- **`/refunds` stopped naming its own policy.** The pilot heading read "No paid checkout is
  available.", which is true but leaves a reader arriving from a footer link labelled Refunds
  on a page that never identifies itself. Now "Cancellation and refund terms during the pilot."
- **`/explore` hid its provenance claim on a phone.** Found on the second pass, at 390px only.
  The instrument bar dropped its third and fourth tiles below 480px, which removed
  `PROVENANCE / PAGE + BBOX BOUND` while keeping `v3 ACTIVE` and `4 WITH EVIDENCE` -- the two
  readings that most resemble a live deployment kept, and the sentence that makes them
  meaningful dropped, on the screen with the least room to argue. Only the source revision is
  hidden now; it is already stated in the source panel's footer.

Two were copy this branch deliberately changed, so the assertions were moved to the new strings
with the reason recorded in the spec: the `/explore` and `/enterprise` headings. Where the
removed RESEARCH FRONTIER card was asserted, the replacement is stricter than what it replaced
-- provenance is stated (`PAGE + BBOX BOUND`) and no `not_yet` placeholder may render anywhere.

### Defects that verification found rather than confirmed absent

- `app/workspace/page.tsx` did not typecheck: the new "Accept with note" action assigns
  `"accept"` to a state typed `"edit" | "reject" | null`.
- `components/compile-stage-player.tsx` gave three of four tabs an `aria-controls` pointing at a
  panel id that never exists, because only the active panel is rendered.
- The same component called `play()` one render before the stage's `<source>` was inserted, so
  whether the film ever started rested on the pending-play-promise path in the spec.
- `lib/production-route-surface.test.ts` was failing intermittently with "Test timed out in
  5000ms" -- it read ~90 route files inside the `it`. In a test whose job is to detect an inline
  credential, a timeout is indistinguishable from a finding. The reads moved to module scope;
  the assertions are unchanged.

### Lighthouse, median of three runs per route

| Route | Performance | Accessibility | Best practices | SEO | LCP | CLS | TBT |
|---|---|---|---|---|---|---|---|
| `/` | 0.96 | 0.97 | 1.00 | 1.00 | 2266 ms | 0.0007 | 73 ms |
| `/privacy` | 0.98 | 1.00 | 1.00 | 1.00 | 2008 ms | 0.0003 | 65 ms |
| `/security` | 0.97 | 1.00 | 1.00 | 1.00 | 2174 ms | 0.0007 | 4 ms |

The budgets are performance 0.80, accessibility 0.95, best practices 0.90, SEO 0.90, LCP under
3,000 ms, CLS under 0.1 and TBT under 300 ms. Every figure clears with margin.

### Checked in a real browser

Against a production server, not a dev server:

- The Scene 03 player: four tabs, roving tabindex, **no dangling `aria-controls`**, the panel
  labelled by whichever tab is selected. Clicking a tab moves selection, caption and frame
  together. ArrowRight and Home move selection *and* focus -- the focused element is the
  selected tab, which is the failure the code comment describes.
- The reduced-motion path: the still renders and loads, its alt text carries the stage label and
  its line, no `<video>` is mounted at all, and there is no Pause control because there is no
  timer to pause.
- `/explore` at 375 px: `PAGE + BBOX BOUND` survives, only `REVISION C` is hidden, the sample
  marker and "not customer proof" are both visible, `not_yet` appears nowhere, and horizontal
  overflow is zero.
- Header and footer: seven primary items ending in Resources, the pilot CTA reading "Request
  access", four footer groups, no horizontal overflow.

Rendering the page also caught one thing no assertion would have: because the marker's label is
`display: block`, the em dash that separated it from its sentence was left orphaned at the start
of the next line. Removed.

### Not run, and required before any deploy

- The founder visual checklist in Launch Appendix C. Everything above is machine-checkable;
  that checklist is the part a person has to sign, and this session cannot.

### A note on this machine

`next build` and `eslint` each take upwards of ten minutes here, and two later build attempts
died with `Allocation failed - JavaScript heap out of memory` while the host had roughly one
gigabyte of physical memory free against 83 GB committed. That is an environment limit, not a
property of this branch: the same build completed successfully earlier in the session. Anyone
reproducing these results should not read a slow or OOM-killed build as a code failure without
checking free memory first.
