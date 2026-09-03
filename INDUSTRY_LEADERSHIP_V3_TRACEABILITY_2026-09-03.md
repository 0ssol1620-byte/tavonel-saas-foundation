# Industry Leadership V3 — traceability

Audited against `TAVONEL_INDUSTRY_LEADERSHIP_FULL_SITE_PRODUCTION_MASTERPLAN_2026-09-03.md`,
which supersedes the V1/V2/V3 drafts wherever they differ.

Branch `agent/industry-leadership-v3`. **Not merged to `main`, not deployed to Production, and the
tavonel.com alias is unchanged.** Production deploy was not performed. Pushing the branch does
create a Vercel Preview deployment automatically; §7 below says what that is and what it is not.

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

**69 rows are classified below**, against 55 in the previous revision. The increase is not
scope creep: the combined `/api /developers /integrations /status /contact /changelog /solutions`
row is now seven rows because those pages no longer share a verdict, the Files lens is classified
rather than unmentioned, and the four §22 ecosystem items and three named `MISSING` items are
classified rather than absent.

| Status | Rows |
|---|---|
| `VERIFIED_IMPLEMENTED` | 51 |
| `PARTIAL` | 12 |
| `MISSING` | 4 |
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
- **Test.** `lib/page-count.test.ts`.
- **Remaining risk.** Spreadsheets have no billable unit: `XLSX_BILLABLE_UNIT_UNDECIDED` is
  reported rather than quoted. That is the `FOUNDER_DECISION` in §5, and inventing one here
  would have invented a charge.
- **Founder decision?** The spreadsheet unit, yes. The counting, no.

### P0-07 — ZIP extraction can freeze the tab

- **Requirement.** §7.4: a large archive must not make the page unresponsive.
- **Status.** `VERIFIED_IMPLEMENTED`
- **Implementation.** `lib/archive-worker.ts` runs `expandArchive` off the main thread, because
  `unzipSync` cannot be interrupted and wherever it runs nothing else does. Cancellation is
  cooperative and checked between entries — the finest granularity the decompressor offers —
  and the client terminates the worker when a wait becomes unreasonable.
- **Test.** `lib/archive-expand.test.ts`, `lib/archive-client.test.ts`.
- **Remaining risk.** A cancel during one very large member waits for that member. Recorded in
  the file rather than hidden.
- **`EXTERNAL_QA_REQUIRED`.** 10 MB, 50 MB and 100 MB archives on a real low-end device.
- **Founder decision?** No.

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

A 128-document run produces eleven Worlds. Merging them requires deciding when an object in part
three is the same object as one in part seven, which is `akc_cir.identity` work with a
calibration requirement and an evidence contract of its own. The corpus deliberately does not
merge: a merged World with uncalibrated identity would be a World whose objects nobody could
account for, which is worse than eleven honest ones.

### Team membership — `MISSING`

See P0-05. Not a feature that was skipped: a tenancy change with an ADR and an independent
review in front of it.

### Typed SDKs and an interactive API console — `MISSING`

Generated clients need a codegen pipeline and a package registry; a "Try it" console needs a
real key in a browser and a CORS decision. Both are real work and neither is a copy change.

---

## 6. Defects this pass found and did not fix

Recording these is the point. Each was found by building something that looks at the output.

### Entity extraction is noisy, and `/explore` shows it

`entitiesFor` matches any capitalised run, so the sample's Entity list contains fragments that
are not entities. Fixing the regex changes the objects every artifact contains, therefore the
manifest digest of every artifact ever compiled, therefore reproducibility. It is
production-critical compiler semantics and the founder's call. The sample ships with the Entity
type visible rather than hidden, because hiding it would make the sample look better than the
compiler is.

### `graph/nodes.csv` mislabels its own columns

The header reads `id,label,name,document_id` over columns holding id, **kind**, label and
document id — so a consumer reading the column called `label` gets the object's type. The
validator reports it as a named warning (`GRAPH_CSV_HEADER_MISLABELED`) and does not fail on it,
because the one-string fix changes the CSV bytes, its sha256 and every manifest digest. That is
a deliberate re-derivation with a decision behind it, not something a validator run does quietly.

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
9. **Firefox against a deployed Preview**: the one flaky test in §10 fails on a dropped RSC
   prefetch under the local parallel matrix. Whether that can reach a real visitor is not
   settled by anything in this repository, and the run that settles it is a navigation pass
   through the public routes in Firefox against the Preview URL, not against `pnpm start`.

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
| `pnpm exec eslint app components lib` | clean | 0 |
| `pnpm exec vitest run` | **145 files, 1,290 tests, 1,290 passed** | 0 |
| `pnpm build` | 75/75 static pages generated | 0 |
| internal link crawl | 110 internal paths, no broken link | 0 |
| Lighthouse (`/`, `/privacy`, `/security`, 3 runs each) | budgets passed - see below | 0 |
| `pnpm exec playwright test` | **234 tests: 218 passed, 1 flaky, 15 skipped** | 0 |
| `pnpm verify:package --package <emitted /explore package>` | `PACKAGE VALID` - 14 files, 3 documents, 1 topic, 15 entities, 10 claims, 3 evidence, 32 relations | 0 |
| the same, `--require-signature` | `PACKAGE INVALID: 1 error(s)` - `SIGNATURE_ABSENT`, the correct answer for an unsigned package | 1 (intended) |
| `pnpm verify:developer-clean` | `passed` - isolated HOME, no provider secret inherited, `tavonel-cli 2026.9.3.1`, `mcp 2026.9.3.1`, Python 3.12.13 | 0 |

Lighthouse categories, three runs per route:

| Route | Performance | Accessibility | Best practices | SEO | LCP |
| --- | --- | --- | --- | --- | --- |
| `/` | 0.96 | 0.97 | 1.00 | 1.00 | 2,197 ms |
| `/privacy` | 0.98 | 1.00 | 1.00 | 1.00 | 1,953 ms |
| `/security` | 0.97 | 1.00 | 1.00 | 1.00 | 2,042 ms |

`pnpm verify:export` is not in this table because it cannot run standalone: it takes an archive
and a trusted key fingerprint, and refuses without both. The path it verifies is exercised by
`e2e/launch-qa-signed-download.spec.ts`, which downloads a real signed export and then tampers
with the content, the manifest, the signature and the inventory in turn - all four rejections
are inside the 218 above.

The Playwright matrix is all eleven projects: widths 1920, 1440, 1280, 1024, 768, 390 and 360,
plus reduced-motion, plus the launch suite in Chromium, Firefox and WebKit.

**No figure from an earlier session is reused.** The previous revision of this file reported
781/781 unit tests across 122 files, and 219 browser tests passed with 0 flaky. Both suites were
re-run from scratch on this tree: the unit count is now 1,290 across 145 files, and the browser
run is 218 passed with 1 flaky, which the previous revision did not have and did not name.

### The flaky test, named rather than averaged away

One test is flaky, and it is the same one both times the full matrix ran:

    [launch-firefox] > e2e/launch-qa-cross-browser.spec.ts:7:1
    > renders launch-critical public routes without browser errors

It fails its first attempt and passes its retry. The failure is a console error Next.js logs
when a prefetched RSC payload does not arrive:

    Failed to fetch RSC payload for http://127.0.0.1:3117/pricing.
    Falling back to browser navigation.

The spec asserts the console is empty, so the log line itself is what fails it - not a broken
page. Two things are known about it and one is not:

- **The route changes between runs.** This pass named `/pricing` and `/resources`; the previous
  full matrix named `/login`. It is not one bad page.
- **It only appears in `launch-firefox`, and only under the full eleven-project matrix**, where
  every project is hitting one `pnpm start` in parallel. The same spec passes in Chromium and
  WebKit in the same run, and Firefox passes it on the retry against the same server.

- **What is not established** is that this cannot happen to a real visitor on real hosting. The
  fallback is Next's own documented behaviour for a failed prefetch and ends in an ordinary
  navigation, so the likely reading is contention in the test environment. That reading has not
  been proven, and settling it needs a Firefox navigation pass against a deployed
  Preview, which is item 9 of the `EXTERNAL_QA_REQUIRED` list in section 8.

The flaky result is counted on its own line above and is not folded into the 218. Retries are
not used to make the number look better: `retries: 1` is in the committed config, the run is
reported as `218 passed, 1 flaky`, and the flaky one is named here.

### Verification that is new this pass

- `lib/compiled-world-validator.test.ts` (37) exercises every validator rule twice: once against
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
