# Industry Leadership V3 — traceability

Audited against `TAVONEL_INDUSTRY_LEADERSHIP_FULL_SITE_PRODUCTION_MASTERPLAN_2026-09-03.md`,
which supersedes the V1/V2/V3 drafts wherever they differ.

Branch `agent/industry-leadership-v3`. **Not merged to `main`, not deployed to Production, and the
tavonel.com alias is unchanged.** Production deploy was not performed. Pushing the branch does
create a Vercel Preview deployment automatically; §7 below says what that is and what it is not.

**Revised 2026-09-04 after an independent review of `c0459e0`.** That review found two merge
blockers and one wrong explanation. All three are closed: a standalone compile could be adopted
as a corpus part (§6), `graph/nodes.csv` mislabelled its own columns (§6), and the Firefox flake
was not what this file said it was (§10). Two requirements that had been sharing one verdict
were split, and two ADRs were written for work that is deliberately not implemented here.

**Revised again 2026-09-04 after a second independent review, of `f47b3d2`.** It asked for the
migration chain to be run on a real PostgreSQL rather than asserted as text. Doing that found
three further defects, two of which made the feature they belong to unusable — see §6 and
`docs/evidence/SQL_MIGRATION_CHAIN_2026-09-04.md`. It also produced the finding in §11: **the
live Supabase project has never had this chain applied**, and has none of the compile-job,
corpus or retrieval tables. That is a Production GO blocker this branch does not resolve.

## Status vocabulary

The plain word "Implemented" is not used anywhere in this file. Code existing is not a status.

| Status | Means |
|---|---|
| `VERIFIED_IMPLEMENTED` | The requirement holds end to end, and something in this repository fails if it stops holding. |
| `IMPLEMENTED_BUT_UX_INCOMPLETE` | The data and the API are real; the interface does not yet deliver what the requirement describes. |
| `PARTIAL` | Some of the requirement holds. What is missing is named. |
| `MISSING` | Not built. |
| `FOUNDER_DECISION` | Not an agent's call: pricing, legal wording, published claims, contracts, credentials, publication and patent timing. |

**`VERIFIED_IMPLEMENTED` is a statement about this repository, not about production.** It means a
test, a build or a command in §6 fails when the requirement stops holding. It does **not** mean
anyone signed in with a real account, connected a real Google Drive, or watched this run on a
physical phone. Every item that still needs one of those carries **`EXTERNAL_QA_REQUIRED`** on
its own line, and §8 lists them together. An emulator pass is never written as a device pass.

**The previous revision of this file scoped itself to masterplan §28.1.** This one does not.
Everything mechanically implementable was closed regardless of which phase the masterplan
scheduled it in — including §28.2 (server-owned compile state machine, durable resume, real page
preflight) and most of §28.3 (graph canvas, the compiler's own directory plan, an ontology
viewer, a version diff). What is left is genuinely outside an agent's reach: a founder's
decision, a legal sign-off, a real account, or a physical device.

So `PARTIAL`, `MISSING` and `FOUNDER_DECISION` are **not** zero here, and a version of this file
in which they were zero would be false.

**70 rows are classified below**, against 55 in the previous revision. The increase is not
scope creep: the combined `/api /developers /integrations /status /contact /changelog /solutions`
row is now seven rows because those pages no longer share a verdict, the Files lens is classified
rather than unmentioned, and the four §22 ecosystem items and three named `MISSING` items are
classified rather than absent.

**The 2026-09-04 correctness pass moved one row and added one.** P0-07 was a single
`VERIFIED_IMPLEMENTED` covering two requirements — main-thread freeze prevention, which is
built, and large-archive server-side extraction, which is not. It is now P0-07a
`VERIFIED_IMPLEMENTED` and P0-07b `MISSING`, so `MISSING` moves from 4 to 5 and the total from
69 to 70. Nothing was downgraded to look thorough and nothing was upgraded: the two merge
blockers that pass found were **fixed**, not reclassified.

| Status | Rows |
|---|---|
| `VERIFIED_IMPLEMENTED` | 51 |
| `PARTIAL` | 12 |
| `MISSING` | 5 |
| `FOUNDER_DECISION` | 2 |
| `IMPLEMENTED_BUT_UX_INCOMPLETE` | 0 |

**The zero on the last row is a real zero, not a rounded one.** The previous revision put the
Graph, Directory and Ontology lenses there — real compiled data behind an interface that was not
what §19 described. All three were rebuilt this pass, so nothing is left in that state. §4 says
what each of them is now.

§8 and §9 enumerate what is still owed. Those residues live *inside* the rows above rather than
being extra rows: the legal wording sits inside the `/privacy /terms /refunds` `PARTIAL`, the
spreadsheet billable unit inside P0-06, the real-account runs inside the QA `PARTIAL`s.

---

## 1. Section 5 — the twelve P0 blockers

### P0-01 — intake accepts 128 files, compile accepts 12

- **Requirement.** §6.1: "1–12 supported files per compile". Accepting 128 and then failing at
  the final compile is explicitly forbidden.
- **Status.** `VERIFIED_IMPLEMENTED`
- **Implementation.** A selection over the compile ceiling is now a *corpus*: `judgeCorpusSet`
  accepts up to `CORPUS_MAX_DOCUMENTS` (128), `planCorpusBatches` splits it into parts of
  `COMPILE_MAX_DOCUMENTS` (12), and `enqueueCorpusCompile` enqueues them under one corpus id.
  The workspace follows the corpus, not the part. Migration `0040` adds the corpus columns with
  a uniqueness constraint per slot, so the same part cannot be enqueued twice.
- **Test.** `lib/corpus-batching.test.ts` (30), `lib/workspace-compile-floor-and-ceiling.test.ts`,
  `lib/compile-limits.test.ts`, `lib/durable-compile-orchestration.test.ts`.
- **Remaining risk.** **The parts are not merged into one World.** 128 documents produce eleven
  Compiled Worlds, not one. Merging them means resolving identity across parts, which is Core
  work with its own evidence requirements, and inventing it here would have produced a World
  whose objects nobody could account for. It is listed as `MISSING` in §5.
- **Founder decision?** No.

### P0-02 — collection compile requires at least two files

- **Requirement.** §5: one file must produce a World.
- **Status.** `VERIFIED_IMPLEMENTED`
- **Implementation.** The floor is 1 in `compile-limits.ts`, in the route and in the compiler.
- **Test.** `lib/workspace-compile-floor-and-ceiling.test.ts` asserts the gate is the shared
  verdict; `lib/collection-compiler.test.ts` compiles a single document.
- **Remaining risk.** None known for the upload path. Connector-sourced single documents are not
  exercised, because no connector has been run against a real account.
- **`EXTERNAL_QA_REQUIRED`.** One document through a live connector.
- **Founder decision?** No.

### P0-03 — the final compile depends on browser polling

- **Requirement.** §6.3: the browser starts and observes. The server owns the state machine,
  retries, resumption and the final receipt.
- **Status.** `VERIFIED_IMPLEMENTED`
- **Implementation.** `waitForOcrAndCompile` is gone — `lib/durable-compile-orchestration.test.ts`
  asserts the workspace source no longer contains it. `lib/compile-job-store.ts` holds the §6.4
  state model in Postgres, `lib/compile-job-worker.ts` advances one job by one bounded step per
  invocation, `app/api/internal/jobs/run` is the crank, and `vercel.json` schedules it every
  minute. Events come from the persisted ledger (`0034`), so a reconnecting tab replays rather
  than re-deriving. On mount the workspace asks whether a run is still open and rejoins it.
- **Test.** `lib/durable-compile-orchestration.test.ts`, `lib/compile-job-worker.test.ts`,
  `lib/job-worker-route.test.ts`, `lib/job-event-ledger.test.ts`; the browser side in
  `e2e/pipeline-board.spec.ts` and `e2e/world-lifecycle.spec.ts`.
- **Remaining risk.** The cron is declared in `vercel.json` and has never fired here. That the
  scheduler actually invokes the crank in a deployed environment is a deployment fact.
- **`EXTERNAL_QA_REQUIRED`.** Close the tab mid-compile against a deployed environment and
  confirm the run finishes and the receipt is written.
- **What was checked externally on 2026-09-04.** The crank is closed on the deployed Preview:
  `POST` and `GET` to `/api/internal/jobs/run` with no header, a wrong bearer and an empty
  bearer all answer `401 {"code":"WORKER_NOT_AUTHORIZED"}` with no detail leaked. The scheduler
  itself **cannot** be exercised there — Vercel activates `crons` on production deployments
  only, which its own documentation states — and the crank's shared secret is a credential this
  session neither holds nor should. So the worker's reachability is verified and the cron firing
  is not, which is exactly what this line has said since it was written.
- **Founder decision?** No.

### P0-04 — compile required a Team subscription

- **Requirement.** The Developer card promises compiling; the route required `studio`.
- **Status.** `VERIFIED_IMPLEMENTED`
- **Implementation.** The compile routes authorize at `observer`, which is what Developer grants.
- **Test.** `lib/plan-entitlement.test.ts`.
- **Founder decision?** No.

### P0-05 — the Team plan promised five seats

- **Requirement.** §10.3: do not sell what does not exist.
- **Status.** `VERIFIED_IMPLEMENTED` — the promise is gone and the sale is gated.
- **Implementation.** `BILLING_OFFERS.studio_access.saleChannel` is `"contact"`, so Team cannot
  be bought self-serve. `lib/workspace-tenancy.test.ts` pins *why*: `foundationWorkspaceId`
  derives the workspace key from the user id, so a second person invited into a workspace would
  compute their own key and land in an empty workspace — or, if the derivation were loosened,
  land somewhere the isolation guarantee no longer covers. The second outcome is a cross-tenant
  leak, the first item on this repository's stop-the-line list.
- **Test.** `lib/workspace-tenancy.test.ts` (5), `lib/plan-entitlement.test.ts`. The tenancy test
  fails the moment an invitation route or a membership table appears, which is exactly when the
  question has to be asked out loud.
- **Remaining risk.** The membership product itself is `MISSING` and is listed in §5.
- **Founder decision?** The decision to open Team is. The engineering under it is not.

### P0-06 — preflight Pages is a byte estimate

- **Requirement.** §8: a page count that decides a charge must not be a division of file size.
- **Status.** `VERIFIED_IMPLEMENTED`
- **Implementation.** `lib/page-count.ts` reads the real count where the format states one — the
  PDF page tree, PPTX slides, a DOCX declared count, an image — and returns the basis with it.
  Where a format does not state one it returns `null` with a reason and the caller falls back to
  the byte bound *and says so*. It never guesses.
- **Test.** `lib/page-count.test.ts`, `lib/usage-pricing.test.ts`.
- **Corrected 2026-09-04.** `page-count.ts` distinguished four bases and `usage-pricing.ts`
  flattened all of them to `declared` → `verified`, so a Word file's `docProps/app.xml` count
  appeared under the heading **"Verified pages"** next to a dollar figure. That number is not a
  measurement: it is what the last application to save the file recorded about a rendering that
  is not the one that will happen. The bases are now carried through:
  `pdf_page_tree`, `image` and `pptx_slides` are `verified`; `docx_declared` is `declared`;
  the byte bound is `provisional`. A declared count may hold a reservation and the maximum
  (`canReserveAgainst`) but may not close a charge (`canAuthorizeCharge`). The heading reads
  "Declared pages", the byte-bound heading reads "Estimated page-equivalents", and a set takes
  the weakest confidence in it. A caller that supplies a count without saying where it came
  from gets `declared`, not `verified` — the guard fails closed rather than by omission.
- **Remaining risk.** Spreadsheets have no billable unit: `XLSX_BILLABLE_UNIT_UNDECIDED` is
  reported rather than quoted. That is the `FOUNDER_DECISION` in §5, and inventing one here
  would have invented a charge. A DOCX count becomes `verified` only after the document is
  actually rendered in processing; that promotion is not implemented on this branch.
- **Founder decision?** The spreadsheet unit, yes. The counting, no.

### P0-07 — ZIP extraction can freeze the tab

**Split into two verdicts, because one verdict was covering two requirements.** The masterplan's
archive architecture is *small and medium in a Web Worker, large by direct upload into isolated
server-side extraction*. Only the first half exists, and reporting the pair as
`VERIFIED_IMPLEMENTED` read as though the whole architecture had shipped.

#### P0-07a — main-thread freeze prevention

- **Requirement.** §7.4: a large archive must not make the page unresponsive.
- **Status.** `VERIFIED_IMPLEMENTED`
- **Implementation.** `lib/archive-worker.ts` runs `expandArchive` off the main thread, because
  `unzipSync` cannot be interrupted and wherever it runs nothing else does. Cancellation is
  cooperative and checked between entries — the finest granularity the decompressor offers —
  and the client terminates the worker when a wait becomes unreasonable. Every guard runs
  against the ZIP central directory *before* expansion: traversal, absolute and drive-letter
  paths, encryption, nested archives, file count, total expanded size and per-entry ratio.
- **Test.** `lib/archive-expand.test.ts`, `lib/archive-client.test.ts`.
- **Remaining risk.** A cancel during one very large member waits for that member. Recorded in
  the file rather than hidden.
- **`EXTERNAL_QA_REQUIRED`.** 10 MB, 50 MB and 100 MB archives on a real low-end device.
- **Founder decision?** No.

#### P0-07b — large-archive server-side extraction

- **Requirement.** The masterplan's second path: above a threshold, direct upload and isolated
  server-side extraction, with the same guards, progress, cancel, durable status and an
  extracted file hierarchy.
- **Status.** `MISSING`
- **What exists instead.** A ceiling. `MAX_WORKER_ARCHIVE_BYTES` is 200 MB and above it the
  product answers `ARCHIVE_TOO_LARGE` and stops. Nothing half-expands and nothing is silently
  truncated, so this is a refusal rather than a defect — but it is not the architecture.
- **Why it was not built here.** `isolated` is the load-bearing word. Expanding a hostile
  archive means running a decompressor over attacker-controlled bytes, and the constitution's
  rule is that components which parse documents get no tools, no broad credentials and no
  outbound network. A route handler on the current deployment holds the service-role key and
  has open egress; doing the work there and calling it isolated would be false in the one word
  that matters. Standing up a bounded, single-purpose extractor is infrastructure with a cost.
- **Design.** `docs/adr/0002-large-archive-server-side-extraction.md`, proposed, not implemented.
- **Founder decision?** Yes — the isolation boundary and its cost.

### P0-08 — defensive copy on deep public pages

- **Requirement.** §13: stop arguing with the reader.
- **Status.** `VERIFIED_IMPLEMENTED`
- **Implementation.** The defensive framings were removed or relocated across
  `/research`, `/evidence`, `/security`, `/enterprise` and `/explore`. `/knowledge-compiler`
  lost the `CATEGORY DEFINITION · NOT A PERFORMANCE CLAIM` badge this pass.
- **Test.** `lib/category-guide.test.ts`, `e2e/ultimate-blueprint.spec.ts`,
  `e2e/launch-qa-accessibility.spec.ts`.
- **Founder decision?** No.

### P0-09 — Explore shows Research Frontier and `not_yet`

- **Requirement.** §13.9: no placeholder object may render as a fact on the page whose whole
  claim is that every object is bound to evidence.
- **Status.** `VERIFIED_IMPLEMENTED`
- **Implementation.** The card is gone, and the sample is no longer typed into a component: it is
  compiled at import time from three committed PDFs by the same `compileCollectionCandidate`
  that compiles a customer's documents, and frozen by digest
  (`EXPLORE_SAMPLE_DIGEST`). The runtime label says
  `tavonel-collection-compiler-ts-v1/explore-sample`, deliberately not the Core's name, because
  the Core did not run.
- **Test.** `lib/explore-sample.test.ts` (17): byte-equality of the committed PDFs against the
  renderer, re-extraction equality, the frozen digest, evidence grounding, and a stripped source
  assertion that the component hard-codes no digest, bbox or page number.
- **Remaining risk.** The compiler's entity extraction is noisy, and the sample shows it. See §4.
- **Founder decision?** No.

### P0-10 — Review "Edit" does not edit

- **Requirement.** §18.3: a control called Edit must change something.
- **Status.** `VERIFIED_IMPLEMENTED`
- **Implementation.** A correction writes a patch — object, before, after and the resulting
  manifest digest — into the append-only decision ledger, and the ledger's constraint is
  all-or-nothing so a half-written patch cannot look like an audit trail.
- **Test.** `lib/review-store.test.ts`, `lib/review-decisions-migration.test.ts`,
  `e2e/world-lifecycle.spec.ts`.
- **Founder decision?** No.

### P0-11 — fictional metrics on the landing page

- **Requirement.** §11.4, and the constitution: no number without a receipt.
- **Status.** `VERIFIED_IMPLEMENTED`
- **Implementation.** The invented instrument readings are gone.
- **Test.** `lib/production-route-surface.test.ts`, `e2e/landing.spec.ts`.
- **Founder decision?** What a public claim says, always.

### P0-12 — the paid-live legal and operator gate

- **Requirement.** §23.3: paid-live requires final legal wording and a named operator.
- **Status.** `FOUNDER_DECISION`
- **Implementation.** `readCommercialState().liveChargesEnabled` switches `/terms`, `/refunds`
  and `/privacy` between pilot and live wording atomically, and `generateMetadata` on the first
  two reads the same switch so the page description is not a legal statement that is false in
  one mode. The wording itself is not an agent's to finalise.
- **Test.** `lib/commercial-state.test.ts`, `lib/page-metadata.test.ts`.
- **Founder decision?** Yes — the entire item.

---

## 2. Section 28.1 — the 0–14 day checklist, item by item

| §28.1 item | Status | Note |
|---|---|---|
| 1 file → World | `VERIFIED_IMPLEMENTED` | |
| UI/API compile limit unified | `VERIFIED_IMPLEMENTED` | one `judgeCorpusSet` for the UI, the route and the compiler |
| 13+ safe block, or batch orchestrator | `VERIFIED_IMPLEMENTED` | orchestrator, not a block: 128 in parts of 12 |
| client-dependent final compile removal | `VERIFIED_IMPLEMENTED` | §28.1 asked only for the design; the state machine is built |
| Developer compile entitlement | `VERIFIED_IMPLEMENTED` | |
| Team sale blocked, or seats finished | `VERIFIED_IMPLEMENTED` | blocked, with the tenancy reason pinned by test |
| Edit → Request change | `VERIFIED_IMPLEMENTED` | writes a patch and a resulting digest |
| page label → estimated | `VERIFIED_IMPLEMENTED` | real counts where stated, labelled estimate where not |
| ZIP main-thread freeze prevention | `VERIFIED_IMPLEMENTED` | worker with cooperative cancel |
| Research/Evidence/Security/Enterprise copy purge | `VERIFIED_IMPLEMENTED` | |
| Explore research frontier removed | `VERIFIED_IMPLEMENTED` | and the sample is compiled, not written |
| Product unshipped cards removed | `VERIFIED_IMPLEMENTED` | |
| fictional instrument metrics removed | `VERIFIED_IMPLEMENTED` | |
| Footer reduced | `VERIFIED_IMPLEMENTED` | four groups |
| Resources hub | `VERIFIED_IMPLEMENTED` | |
| global CTA unified | `VERIFIED_IMPLEMENTED` | |
| QA: physical iOS/Android film | `MISSING` | `EXTERNAL_QA_REQUIRED` — no physical device here |
| QA: real Google Drive / Dropbox / OneDrive | `PARTIAL` | contract-tested against a stateful fake; `EXTERNAL_QA_REQUIRED` for real accounts |
| QA: 1/2/12/13/128 file scenarios | `PARTIAL` | every boundary unit-tested; not run against live storage |
| QA: tab close and resume | `PARTIAL` | the job survives and the tab rejoins it in test; `EXTERNAL_QA_REQUIRED` against a deployment |
| QA: ZIP 10/50/100 MB | `PARTIAL` | expansion is unit-tested and off-thread; not run on a low-end device |
| QA: unsupported / malware / encrypted / nested archive | `PARTIAL` | unit-tested; not run end to end against live storage |
| Founder visual checklist (Launch Appendix C) | `FOUNDER_DECISION` | a person signs it; this session cannot |

---

## 3. Section 13 — per-page verdicts

Every page below renders, passes the accessibility and cross-browser suites, and has no
horizontal overflow at any of the seven widths. Each declares its own canonical, description and
share card — `lib/page-metadata.test.ts` walks `app/` itself, so a new page cannot opt out by
not being on a list.

| Page | Masterplan verdict | Status | Note |
|---|---|---|---|
| `/` | P0 items inside §11 | `VERIFIED_IMPLEMENTED` | five scenes, one pinned Scene 3 player |
| `/pricing` | P0 | `VERIFIED_IMPLEMENTED` | plans from the catalog, fail-closed checkout, Team gated |
| `/enterprise` | P0 COPY/IA | `VERIFIED_IMPLEMENTED` | |
| `/security` | P0 COPY | `VERIFIED_IMPLEMENTED` | the Trust Center is P1 and separate |
| `/evidence` | P0 | `VERIFIED_IMPLEMENTED` | |
| `/explore` | P0 | `VERIFIED_IMPLEMENTED` | the sample is compiled from committed PDFs; see P0-09 |
| `/research` | P0 REWRITE | `PARTIAL` | all seven research areas and the reporting method; Publications, Datasets and Patents are `FOUNDER_DECISION` |
| `/product/compiled-world` | P0 COPY | `VERIFIED_IMPLEMENTED` | |
| `/product/document-understanding` | P0 COPY | `VERIFIED_IMPLEMENTED` | |
| `/privacy` `/terms` `/refunds` | P0 LEGAL | `PARTIAL` | pilot and live templates driven by one flag; final wording is `FOUNDER_DECISION` |
| `/knowledge-compiler` | P1 | `VERIFIED_IMPLEMENTED` | diagram, when-to-use, when-not-to, glossary, FAQ, package contract, CTA |
| `/reproducibility` | P1, noindex advised | `VERIFIED_IMPLEMENTED` | |
| `/film` | KEEP NOINDEX | `VERIFIED_IMPLEMENTED` | |
| `/docs` | P1, required for live | `VERIFIED_IMPLEMENTED` | the nineteen sections of §13.6, generated from the contract |
| `/api` | P1 EXPAND | `PARTIAL` | cURL, Python and TypeScript per endpoint, generated from the contract; an interactive "Try it" console and generated SDKs are `MISSING` |
| `/developers` | P1 | `VERIFIED_IMPLEMENTED` | de-duplicated against `/docs`, quickstart path, defensive Ask sentence replaced with §13.5's |
| `/integrations` | P1 | `VERIFIED_IMPLEMENTED` | the four support levels defined, scopes read from the authorization contract, deletion and cursor behaviour per connector; no last-tested date, and it says why |
| `/status` | P1 | `PARTIAL` | first-party component status; an independent uptime provider is `FOUNDER_DECISION` (a third-party account) |
| `/contact` | P1 | `VERIFIED_IMPLEMENTED` | volume, source types, output, timeline, deployment and region as closed lists; support and security routed directly. Calendar booking and a response-time commitment are `FOUNDER_DECISION` |
| `/changelog` | P2 | `VERIFIED_IMPLEMENTED` | added/improved/fixed, version, surface, permalink, filter, Atom feed, breaking change with its migration |
| `/solutions/*` (5 pages) | P1 | `PARTIAL` | each now states its limitations; the screenshots, sample architectures and benchmark figures §13.22–13.26 also ask for need assets and measurements that do not exist |

---

## 4. Section 19 — the World Studio lenses

The previous revision recorded three of these as `IMPLEMENTED_BUT_UX_INCOMPLETE`: real data behind
an interface that was not what the requirement described. That is no longer true of any of them.

| Lens | Status | What it is |
|---|---|---|
| Graph | `VERIFIED_IMPLEMENTED` | a canvas with drawn edges and computed, deterministic positions — the same World always draws the same picture. Not a card grid. |
| Directory | `VERIFIED_IMPLEMENTED` | the compiler's own `directoryPlan`: paths, kinds, the sources each folder derives from, and the roots a compile left empty. Not a grouping of objects by type. |
| Ontology | `VERIFIED_IMPLEMENTED` | classes and predicates with counts, and domain and range **observed** from what this World actually used — labelled as observed, not declared. |
| Evidence | `VERIFIED_IMPLEMENTED` | signed URL, PDF.js, page and bbox. `EXTERNAL_QA_REQUIRED` against live storage. |
| Versions | `VERIFIED_IMPLEMENTED` | a diff of two compiled artifacts loaded by manifest digest — objects, properties, relations, evidence, review decisions and source revisions — shown before a rollback rather than after. |
| Files | `VERIFIED_IMPLEMENTED` | every package file with its media type, size and sha256. |

---

## 5. Section 22 — API, MCP, package, open standard

| Item | Status | Note |
|---|---|---|
| §22.1 API | `PARTIAL` | OpenAPI, scopes, idempotency, pagination, errors, SSE, versioning and a deprecation note are published and generated from the served contract. Typed SDKs are `MISSING`. |
| §22.2 MCP | `VERIFIED_IMPLEMENTED` | eight read-only tools in the published distribution, with a gate that refuses to start if a write tool is added. `list_worlds` is deliberately absent — see §9. |
| §22.3 Package spec | `VERIFIED_IMPLEMENTED` | the format is documented and there is a validator CLI: schema version, stable ids, source version, hashes, the evidence coordinate system, lifecycle, signatures and compatibility. |
| §22.4 Open standard | `PARTIAL` | the validator is a readable dependency-light script and the sample package is public, but nothing is published as a standalone open-source project, and there are no Neo4j/RDF/vector adapters or framework recipes. |

### Cross-part identity resolution — `MISSING`

**Investigated on 2026-09-04, and the answer did not change.** There is no identity machinery in
this repository to build on: the only entity resolution that exists is
`stableId("entity", label.toLowerCase())`, which is exact string match, and the extractor
feeding it measures 0.20 precision. `akc_cir.identity` lives in the Core repository, where its
calibration table is `calibrated = False` by construction. Resolving objects across a seam on
exact string match over a 20%-precision candidate set would manufacture confident duplicates,
which is worse than eleven honest Worlds. The product copy now says the count and says the
parts are not merged, in the panel, the changelog and the documentation.

A 128-document run produces eleven Worlds. Merging them requires deciding when an object in part
three is the same object as one in part seven, which is `akc_cir.identity` work with a
calibration requirement and an evidence contract of its own. The corpus deliberately does not
merge: a merged World with uncalibrated identity would be a World whose objects nobody could
account for, which is worse than eleven honest ones.

### Team membership — `MISSING`

See P0-05. Not a feature that was skipped: a tenancy change with an ADR and an independent
review in front of it.

**The ADR now exists.** `docs/adr/0001-stored-workspace-identity-and-team-membership.md`, status
Proposed, nothing implemented. It sets out why an invite on top of a workspace key derived from
the user id either silently does nothing or removes the isolation guarantee, the ten pieces a
real membership change needs — stored workspace identity, membership table, invite and accept,
immediate revoke, R2 namespace, entitlement ownership, API key ownership, migration of existing
workspaces, audit, rollback — and the cross-tenant security tests required before it ships. The
tenancy change itself belongs on its own security-critical branch with an independent review.
`saleChannel: "contact"` is held; self-serve is not opened.

### Typed SDKs and an interactive API console — `MISSING`

Generated clients need a codegen pipeline and a package registry; a "Try it" console needs a
real key in a browser and a CORS decision. Both are real work and neither is a copy change.

---

## 6. Defects found, and what happened to them

Recording these is the point. Each was found by building something that looks at the output, or
by an independent review of the branch reading the code afterwards.

### The correctness pass of 2026-09-04

An independent review of `c0459e0` found two defects this file had recorded as acceptable and
one it had explained wrongly. All three are closed.

### The second correctness pass of 2026-09-04 — running the SQL

A review of `f47b3d2` asked for the migration chain to be executed on a real PostgreSQL instead
of asserted as text. That single instruction found more than everything the text tests had.
Detail and reproduction: `docs/evidence/SQL_MIGRATION_CHAIN_2026-09-04.md`.

**`0022_retrieval_lexical_search.sql` could not be applied to any PostgreSQL — fixed.**
`generated always as (to_tsvector('simple', array_to_string(search_tokens, ' '))) stored` is
rejected with *"generation expression is not immutable"*: `array_to_string(anyarray, text)` is
declared STABLE. The lexical retrieval path had therefore never existed in any database, while
`lib/retrieval-lexical-search-migration.test.ts` passed on every assertion — it read the file as
text. Fixed in place, because a migration the chain stops at cannot be repaired by a later one,
and safe to edit in place because §11 establishes there is no deployed state to diverge from.
The fix is an immutable wrapper, not `array_to_tsvector`: the latter drops positions, and
`lib/lexical-search.ts` ranks with `ts_rank_cd`, which is a cover-density measure over them.

**`0041`'s `enqueue_foundation_compile_job` failed on every call — fixed in `0042`.**
`ERROR: column reference "corpus_id" is ambiguous` — the function's OUT columns `corpus_id` and
`batch_index` become plpgsql variables, and the body compares bare `corpus_id` against them. A
plpgsql body is not parsed until it is called, so the migration applied cleanly and no corpus
compile could ever be enqueued. `0042` aliases the table and qualifies every column.

**The corpus slot race — fixed in `0042`, was a merge blocker.** `0041` validates the slot
occupant's identity on its first lookup and not on the re-read after `ON CONFLICT DO NOTHING`.
Two concurrent enqueues of one slot with different document sets: the loser is handed the
winner's row as `created: false`, i.e. success, and is told its part is enqueued while somebody
else's documents compile under it. `0042` moves the check into a function both paths call, adds
canonical `document_ids` equality behind the key, and returns the stored idempotency key so the
caller can verify the row it was given. `lib/compile-job-store.ts` checks it and fails closed
when the field is absent.

Proven on a real server, and **isolated with a mutant**: the full chain with only the race-path
assertion commented out fails exactly one of four scenarios (`bReturnedARow: true`, no error)
while the other three still pass. `bBlockedUntilACommitted: true` in every run is the evidence
the second connection really did block on the slot index.

**The Core execution budget contradicted itself — fixed.** `maxLatencyMs: 90_000`,
`AbortSignal.timeout(60_000)` and `maxDuration = 60` cannot all be true. Core was promised
ninety seconds by a caller that abandons it at sixty, inside a function killed at sixty, so
every response past 60s was unreachable and a timeout raced the platform kill — when the kill
won there was no catch block, no job event and no receipt, and the lease stayed held until it
expired. `lib/execution-budget.ts` now derives all three from one number with an invariant
asserted in a test. ADR-0003 records what this does *not* fix: a compile needing more than
`CORE_MAX_LATENCY_MS` still cannot complete, and making it possible needs asynchronous dispatch,
which is a change to the Core contract.

**A retry created a second World and a second charge — fixed.** `idempotencyKey` hashed
`requestId`, which defaults to a fresh UUID, so the key identified the attempt rather than the
work and every retry was a compile Core had never seen. A test asserted this as intended. The
key is now the document binding; `requestId` still identifies the attempt and still binds the
receipt.

**A Word file's saved page count was labelled "Verified pages" — fixed.** See P0-06.

### Entity extraction is noisy — now measured, and said out loud

`entitiesFor` matches any capitalised run. The previous revision said so and stopped there,
which left "noisy" as an adjective nothing could regress against.

It is measured now. On the three real documents of the `/explore` sample: 15 candidates, of
which `FP-200`, `CN-2026-03` and `PG-11` are real identifiers and twelve are sentence-initial
words and month names. **Precision 0.20, recall 1.00**, with a false-positive taxonomy, three
OCR-noise cases and three identity cases in `lib/entity-extraction-eval.json`.

Recall 1.00 is the least impressive true statement there: every gold entity in this corpus is
an uppercase alphanumeric identifier, the labels are unblinded, and three documents is a
reviewed precision set rather than a benchmark. All of that is in the file.

**The regex is unchanged.** Tuning a heuristic against the one corpus it was measured on
produces a heuristic that fits that corpus, so the baseline assertion is an equality rather
than a floor and any change to the extractor breaks it. What changed is the claim: `/explore`
now tells the reader, next to the Entity list, that it is a heuristic and not a resolver and
that three of fifteen are real. Replacing it with a semantic pipeline needs the Core identity
work, which is not in this repository.

### `graph/nodes.csv` mislabelled its own columns — **fixed**

The header read `id,label,name,document_id` over columns holding id, **kind**, label and
document id, so a consumer reading the column called `label` got the object's type and one
reading `name` got its label. Spreadsheet and BI tools are the whole reason that projection
exists and every one of them reads the header.

The previous revision left it as a validator warning because correcting one string moves the
CSV's bytes, its sha256 and the `manifestDigest` of every artifact. That cost is real and it is
not a reason to publish a header that lies. **No artifact has been published**, so the digests
were re-derived: `EXPLORE_SAMPLE_DIGEST` moved from `d9e1f273` to `929153d4`, and the frozen
constant did its job by failing the build rather than quietly serving different bytes.

The validator no longer warns, it refuses — `GRAPH_CSV_HEADER_WRONG`, for both graph CSVs — and
the header strings are exported constants so the compiler and the checker cannot drift. Both
wrong headers are asserted to fail, because a validator that accepted the old one would have
passed the bug.

### A standalone compile could be adopted as a corpus part — **fixed, was a merge blocker**

Found by the independent review reading the code, not by any test here, and it is the kind of
defect two individually-correct halves produce. A job's identity was its document set. A corpus
is partitioned deterministically and sorted, so batch 0 of a 128-document run is exactly the
twelve documents a customer may already have compiled on their own — same key. The corpus
enqueue found that standalone job, was told `created: false`, and took a row with `corpus_id`
null as its part 0.

`readCorpusParts` filters on `corpus_id`, so part 0 was never in the list. The corpus had ten
parts where it believed it had eleven, the run could not settle, and twelve of the customer's
documents sat in a World belonging to no corpus. **Nothing raised.**

Closed in three places, because any one alone still leaves a way in: the key is namespaced
(`compile-identity/2`, standalone vs corpus-part) and a part's key carries corpus id, batch
index and documents; migration `0041` looks a part up by its **slot**, refuses a slot whose
occupant covers different documents, and goes through `ON CONFLICT DO NOTHING` and a re-read so
two concurrent enqueues of one slot leave one row instead of an unhandled unique violation for
the loser; and the application checks the slot it was handed, so a database that has not run
`0041` produces a conflict rather than a silently lost part. `0041` rewrites the stored keys,
since they are compared and never recomputed.

Reproduced twice. `lib/compile-job-idempotency.test.ts` replays A, B and C through the real
application code against a model of the RPC written with **both** lookup rules — under 0038's
the corpus adopts the standalone job, under 0041's it does not — and the mutation was verified
by removing the fix and watching two tests fail.
`supabase/tests/foundation_corpus_slot_idempotency.sql` runs the same scenario against the real
function. **That file has not been executed**: see §8.

A slot conflict answers `409`, not `503`. Retrying does not dislodge whatever holds the
position.

### The connector adapters threw on a null provider row

Found by writing the contract test, not by reading the code: all three adapters raised
`TypeError` on a `null` entry in a provider response. Fixed with a `readableRow` guard, and the
guard was mutation-verified — removed, the test fails; restored, it passes.

### `node:crypto` reached the client bundle

`lib/corpus-batching.ts` imported `createHash` and is reached by the workspace client component.
`tsc`, `eslint` and 1,186 unit tests were all green; only `next build` caught it. The hashing
moved to a server-only `lib/corpus-id.ts`. Neither the type checker nor the test runner knows
which side of the network a module ends up on.

### The browser matrix caught three defects nothing else could

The durable compile work added a request on mount that six workspace specs did not answer, so the
browser logged a 401. `/explore` asserted a filename with the wrong case and one hand-written
bbox from when the sample was typed in. And the phone opened on the World panel — the half
carrying the readings that most resemble a live deployment, with the page, region and bbox that
make them mean anything on the other side of a toggle. That last one is the exact defect this
page was fixed for once already.

### Two MCP servers

This session built an MCP server in `scripts/` without noticing that a four-tool one was already
published at `public/developer/tavonel-mcp.mjs` and pinned by sha256. Two servers in one
repository is how two tool vocabularies reach the world. Consolidated into the published file at
release `2026.9.3.1`; the four old tool names are gone, which is a breaking change and is written
as one in the distribution README and the changelog with its migration beside it.

---

## 7. Deployment

**Production deploy 안 함. Git push로 Preview deployment는 자동 생성됨.**

- `main` merge: not performed.
- Production deploy: not performed.
- tavonel.com alias: unchanged.
- Pull request: not created.
- A Vercel Preview deployment is created automatically by the push. A Preview is not Production,
  does not carry the tavonel.com alias, and does not use Production secrets. Its id, URL and
  READY state are reported in the session summary alongside this file, from the Vercel API and
  not inferred.

---

## 8. `EXTERNAL_QA_REQUIRED`

Nothing below was performed, and no emulator result is written as if it were one of these.

1. **Physical iOS and Android**: the Scene 3 film, the drop zone, and the compile theatre on a
   real handset. Playwright's 390 px and 360 px projects are viewport emulation. They are not a
   device pass and are not recorded as one.
2. **Real Google Drive, Dropbox and OneDrive accounts**: consent screen, token refresh, a real
   delta cursor across two syncs, and a real deletion. The contract test drives a stateful fake
   through the real adapters and proves the pagination contract; it reaches no provider.
3. **A real signed-in account end to end**: upload, quote, compile, review, promote, ask,
   download, verify. Requires credentials this session does not have.
4. **Tab-close and resume against a deployed environment**: the cron in `vercel.json` has never
   fired here.
5. **Live storage**: signed URLs, the evidence viewer against a real object, and the 1 / 2 / 12 /
   13 / 128 file scenarios against real R2.
6. **Archives on a low-end device**: 10 MB, 50 MB and 100 MB.
7. **A connector "last tested" date**: cannot exist until (2) happens.
8. **The founder visual checklist** in Launch Appendix C.
9. **The corpus slot pgTAP suite**: `supabase/tests/foundation_corpus_slot_idempotency.sql` is
   still **not executed**. pgTAP is not installable on this machine —
   `pg_available_extensions` returns none and it is not in the PostgreSQL 17 extension
   directory. It has been updated to `0042`'s signature and to `plan(25)`.
   **What changed since the previous revision:** a real PostgreSQL *was* found. A disposable
   `initdb --auth=trust` cluster runs the whole chain, and the scenarios this suite describes
   are now executed on a real server by `nextjs/scripts/db/corpus-slot-race.mjs` — including the
   concurrent case pgTAP cannot express at all, since it has only one session. So the SQL half
   is no longer unverified; it is the pgTAP *harness* that has not run.
10. **pgvector semantics.** The three retrieval migrations declaring `create extension vector`
   are applied with a shim over `double precision[]`, because stock PostgreSQL does not ship
   pgvector. Distance operators appear only inside function bodies, which are never resolved by
   a call here. Every run of `apply-migrations.mjs` reports `vectorSemanticsVerified: false`.
11. **The chain against the live project.** §11 — the numbered migrations have never been
   applied to `tavonel-saas-foundation`. Applying them is a production action and is not an
   agent's to perform.

Item 9 of the previous revision — a Firefox pass against a deployed Preview — **is done**, and
it changed the answer rather than confirming it. See §10 and
`docs/evidence/RSC_PREFETCH_FLAKE_2026-09-04.md`.

## 9. `FOUNDER_DECISION`

1. **Paid-live legal wording and the named operator** (§23.3). The switch is built and atomic;
   the words are not an agent's.
2. **The spreadsheet billable unit.** Reported as undecided rather than quoted from file size,
   because a quoted number becomes the charge.
3. **Publications, Datasets and Patents on `/research`.** Publication and patent timing is
   explicitly not an agent's call, and a Datasets section implies a release decision about
   customer material.
4. **An independent uptime provider for `/status`.** A third-party account and a monthly cost.
5. **A response-time commitment and calendar booking on `/contact`.** §13.4 asks for an expected
   response time. What that number is, is a promise the founder makes; the page says what is true
   about the routing instead, and this line records the number as still owed.

### Two absences that are engineering decisions, not oversights

**`list_worlds` is not an MCP tool.** §22.2 names it and the API has no endpoint that lists a
workspace's collections. A tool that answered by guessing at ids, or by returning an empty array,
would be a tool that is wrong silently. It is absent, and `tools/list`, the distribution README
and the documentation all say why in the place a developer looks for it.

**`download_package` returns a descriptor, not the archive.** URL, size, signed manifest digest
and signing key id. Base64ing tens of megabytes through a pipe to deliver bytes the caller must
verify anyway is worse than telling them exactly what to fetch and what it should hash to.

---

## 10. Verification

### What was actually run in this session, on the exact final tree

| Command | Result | Exit |
| --- | --- | --- |
| `pnpm exec tsc --noEmit` | clean | 0 |
| `pnpm exec eslint app components lib e2e` | clean | 0 |
| `pnpm exec vitest run` | **149 files, 1,367 tests, 1,367 passed** | 0 |
| `pnpm build` | 75/75 static pages generated | 0 |
| `pnpm qa:links` | 110 internal paths, no broken link | 0 |
| `pnpm qa:lighthouse` | budgets passed - see below | 0 |
| `pnpm exec playwright test` (11 projects) | **234 tests: 219 passed, 15 skipped, 0 flaky, 0 failed** | 0 |
| Firefox launch suite vs the Preview, `--retries=0 --repeat-each=20` | **40 passed, 0 flaky** (against `dpl_4LamnERJtoCwhXK16xYDU3aCikRa`) | 0 |
| `pnpm verify:package --package <emitted /explore package>` | `PACKAGE VALID` - 14 files, 3 documents, 1 topic, 15 entities, 10 claims, 3 evidence, 32 relations, **no warnings** | 0 |
| the same, `--require-signature` | `PACKAGE INVALID: 1 error(s)` - `SIGNATURE_ABSENT`, the correct answer for an unsigned package | 1 (intended) |
| `pnpm verify:developer-clean` | `passed` - isolated HOME, no provider secret inherited, `tavonel-cli 2026.9.3.1`, `mcp 2026.9.3.1`, Python 3.12.13 | 0 |

Lighthouse categories, three runs per route:

| Route | Performance | Accessibility | Best practices | SEO | LCP |
| --- | --- | --- | --- | --- | --- |
| `/` | 0.97 | 0.97 | 1.00 | 1.00 | 2,150 ms |
| `/privacy` | 0.98 | 1.00 | 1.00 | 1.00 | 1,885 ms |
| `/security` | 0.97 | 1.00 | 1.00 | 1.00 | 2,038 ms |

Run on a real PostgreSQL 17.2, and **not** in the table above because they need a server that
CI does not have. Both are reproducible from
`docs/evidence/SQL_MIGRATION_CHAIN_2026-09-04.md`:

| Command | Result | Exit |
| --- | --- | --- |
| `node scripts/db/apply-migrations.mjs --shim-vector` | **42 of 42 applied**, no failure | 0 |
| the same, against the tree before this pass | **21 of 42**, stops at `0022` | 1 |
| `node scripts/db/corpus-slot-race.mjs` | **4 of 4 scenarios pass** | 0 |
| the same, against a mutant with only the race-path assertion removed | **3 of 4** — the concurrent different-documents case fails | 1 |

`pnpm verify:export` is not in this table because it cannot run standalone: it takes an archive
and a trusted key fingerprint, and refuses without both. The path it verifies is exercised by
`e2e/launch-qa-signed-download.spec.ts`, which downloads a real signed export and then tampers
with the content, the manifest, the signature and the inventory in turn - all four rejections
are inside the 219 above.

`supabase/tests/foundation_corpus_slot_idempotency.sql` is **not** in this table because it did
not run: pgTAP is not installable here. Item 9 of section 8 says what replaced it — the same
scenarios, on a real server, including the concurrent one pgTAP cannot express.

The Playwright matrix is all eleven projects: widths 1920, 1440, 1280, 1024, 768, 390 and 360,
plus reduced-motion, plus the launch suite in Chromium, Firefox and WebKit.

**No figure from an earlier revision is reused.** The three previous revisions reported 781/781
unit tests across 122 files, then 1,290 across 145 with 218 browser passes and 1 flaky, then
1,329 across 148. Every suite was re-run from scratch on this tree: **1,367 unit tests across
149 files**, and **219 browser passes** with no flaky result. The unit count rose by 38 because
of the suites this pass added — the execution budget, the client half of the slot race, the
page-count basis, and the mirror check between the race harness and the application.

### The flaky test, found rather than tolerated

**There is no flaky test in this run.** The one the previous revision named is fixed, and
fixing it began by discovering that the previous revision's explanation of it was wrong.

That revision said `[launch-firefox] launch-qa-cross-browser.spec.ts` flaked only under the
local eleven-project matrix, and read that as contention between projects sharing one
`pnpm start`. Run against a Vercel Preview, alone, on an idle machine, it failed on its **first**
attempt. Contention was a story fitted to where the failure had been seen, not a cause anyone
had gone looking for.

`scripts/rsc-prefetch-probe.mjs` measured it. Varying one thing - how long each page is left
alone before the loop navigates on - four runs each, against the Preview:

| Settle | Prefetches issued | Prefetch non-200 | Runs with an RSC error |
| --- | --- | --- | --- |
| 0 ms | 0 | 0 | 0 of 4 |
| 200 ms | 19-24 | 0 | **3 of 4** |
| 400 ms | 24 | 0 | 0 of 4 |
| 700 ms | 11-24 | 0 | 0 of 4 |
| 1500 ms | 24 | 0 | 0 of 4 |

**No prefetch ever returned a non-200**, in any configuration. The failing requests are
`NS_BINDING_ABORTED` - Firefox cancelling a request because the page navigated away - and the
spec's loop moved on about 200 ms after `main` appeared, which is after the prefetches start
and before they finish. The test was causing the condition it was failing on. Request
interception was ruled out first: five runs with the spec's own `page.route` installed and a
1500 ms settle gave 24 prefetches, all 200, no errors.

A second, unrelated error was failing the same assertion: Vercel injects its feedback widget
into Preview deployments and the site's CSP refuses it, because `script-src` does not list
`vercel.live`. That is the policy working. It is Preview-only, it is annotated with its reason,
and **the policy is not widened to admit a preview tool.**

The spec now waits for the network to settle, which removes the cause. Filtering the message
would have hidden it and left the assertion unable to tell a cancelled prefetch from a broken
one. Verified with `--retries=0 --repeat-each=20` against the Preview: 40 passed, no flaky
result. Full detail in `docs/evidence/RSC_PREFETCH_FLAKE_2026-09-04.md`.

What a real visitor sees: clicking a link within about two hundred milliseconds of the page
painting cancels the prefetch for it and produces an ordinary browser navigation to the page
they asked for. A log line, not a defect - but nor was it the test-environment artefact the
previous revision called it, and that difference is why it was measured instead of retried.

### Verification that is new this pass

- `lib/compile-job-idempotency.test.ts` (11) replays the standalone-then-corpus scenario through
  the real application code against a model of the enqueue RPC written with **both** the 0038
  lookup rule and the 0041 one. Mutation-verified: removing the slot from the key fails two of
  them.
- `lib/entity-extraction-quality.test.ts` (8) fixes the extractor's precision at 0.20 as an
  **equality**, so tuning the regex against the corpus it was measured on breaks the test rather
  than looking like an improvement.
- `lib/corpus-and-entity-honesty.test.ts` (7) fails if any surface starts describing a corpus as
  one World, or if the published precision drifts from the measured one.
- `lib/compiled-world-validator.test.ts` gained the two header mutations: a validator that
  accepted `id,label,name,document_id` would have passed the bug it now refuses.

Added earlier in the same session:

- `lib/compiled-world-validator.test.ts` (39) exercises every validator rule twice: once against
  the package the compiler really produced, which must be clean, and once with one field broken,
  which must fail with that rule's own code. A validator that passes everything and a validator
  that works look identical from outside.
- `lib/mcp-server.test.ts` (23) adds a `promote` tool to the server's own table and asserts it
  refuses to start.
- `lib/connector-contract.test.ts` (33) drives all three adapters through a stateful fake
  provider, and found the null-row crash.
- `lib/page-metadata.test.ts` walks `app/` rather than reading a list, because the failure it
  guards is a *new* page arriving without metadata.
- `lib/workspace-tenancy.test.ts` (5) fails the moment a membership surface appears.
- `lib/contact-qualification.test.ts` (14) refuses free text smuggled into a closed field on an
  unauthenticated write to an outbound channel.

### What no test in this repository can check

Whether the sentences are true. The documentation, the category guide, the solution limitations
and the changelog are all checked for shape, for consistency with the constants they cite, and
for the absence of claims — never for truth. `DOCS_REVIEWED` is where a person records having
read them.

## 11. The live project has no schema for any of this

Read-only, via the Supabase MCP, against `tavonel-saas-foundation` (`tfcorhjkqcuisqhsjemz`):

- `list_migrations` returns **four** rows, all named `tavonel_tenant_foundation_0001`.
- `list_tables` shows no `foundation_compile_jobs`, no `foundation_compile_job_events`, no
  `foundation_corpora` and no `foundation_retrieval_units`.

The numbered chain `0002`–`0042` has not been applied to the live project. The compile-job,
corpus compile and retrieval features have **no schema there at all**, so nothing in §1 that
depends on them can run against it regardless of what this branch contains.

**This is a Production GO blocker and this branch does not resolve it.** Applying migrations to
the live project is a production action, and not an agent's to perform. What this branch can
say — and now does, on a real server — is that the chain applies cleanly end to end, which it
did not before today.

Two things follow for whoever does apply it:

- `0022` and `0041` as they stood would have failed: one at apply time, one at first call. Both
  are fixed here. A deployment attempted from the previous revision would have stopped at
  `0022`.
- `vectorSemanticsVerified` is `false`. The live project must have real pgvector; the shim used
  here proves nothing about it.
