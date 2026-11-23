# ADR-0011 — One World above twelve documents: four options, one recommendation, a measured probe

- **Status:** **proposed** (WO-BIG-0, 2026-11-23). The lead decides; this record does not. Nothing here is
  built, shipped or proven for customer documents. No threshold in it is calibrated; no gate is marked passed.
- **Question** (founder, by doing, 2026-11-23): "put everything we have into one World". Today a selection
  above 12 documents becomes several Worlds that are not merged. This record answers whether that can
  change, by which of four routes, at what risk, and what was measured.
- **Base read:** Foundation `main` at `a632a374` (this worktree, `codex/v34-big-0`); every
  `nextjs/…:line` below is at that head. Core: the live source AKC `6b3a27bf` (sourceDigest
  `sha256:a37d19b6…aad8`, `receipts/WO-E-CORE-0/LINEAGE.md` §a), staged locally; every `vendor/…:line`
  is in that staged bundle. Wire contract: `codex/v34-core-wire` `6d4a87db` (WO-E-INC-1), read only.
- **Receipts:** `D:/CodexProjects/v34-lanes/receipts/WO-BIG-0/` — `run.sh` (the whole recipe), probe
  scripts, every output file named below with its sha256 in §8. Loopback only, synthetic documents only,
  nothing installed, production not contacted (not even `/health`).
- **Labels:** *ran* = executed in this work order; *read* = read at the line given; *recorded* = another
  session wrote it and it was not re-run here; *arithmetic* = computed only from figures that are shown.

## 0. Decision in one paragraph

The number 12 is a proxy, not the limit. What bounds one World is **bytes**: the Core request (4.5 MB
Vercel body, `nextjs/lib/core-runtime-v2.ts:28`), the Core output (192 MiB in code, **96 MiB as
production's env sets it**, recorded `LINEAGE.md:31,102`), the stored candidate (192 MiB,
`nextjs/lib/r2-objects.ts:62`) and the function's wall clock (52 s, `nextjs/lib/execution-budget.ts:55`).
On synthetic documents of 60 regions, one *initial* compile of the live Core stayed under every local
bound up to **144 documents** (§2.3), and under production's 96 MiB output budget up to **72**; at 200
regions a document it stopped at **12** (24 refused). *Growing* a World by revision (option A) is accepted
by Core with new sources (equivalence `passed` every step) but its request carries the whole World twice
and hits the 4.5 MB bound **sooner** than a fresh compile (at 72 documents vs never below 144 for initial,
60 regions). A Core defect was found on the way: one entity named on 1,440 or 2,400 lines (measured; threshold
in (720, 1,440]) of one World turns the compile into an **HTTP 500** (an unbounded CSV field), not a named refusal (§2.4).
`corpus_reduce`, already in the live Core in shadow (ADR-008 of the Core repository), reproduced the whole
compile from 12-document parts **20/20** on two 24-document synthetic corpora and **247/247** on its own
fixtures (§3.2): merging parts does **not** need the uncalibrated identity resolver, because it merges on
the same exact key one compile already uses. **Recommendation (§6): qualify one World as one compile
budgeted by regions and bytes (option C, through the existing flag-held global-collection path), after
the 500 becomes a named refusal; keep `corpus_reduce` (B) as the route past one request; use A only for
updating a World, never for growing it; ship D only as an honest side-by-side read, never called one
World.**

## 1. Why there are parts today (read)

| Fact | Where |
|---|---|
| One compile is 1–12 documents; the route and the compiler refuse more | `nextjs/lib/compile-limits.ts:27-28`, `:49-69`; `nextjs/app/api/collections/compile/route.ts:46-49`; `nextjs/lib/collection-compiler.ts:597` |
| 12 means "one Core request, one function invocation, one artifact"; larger selections are partitioned | `nextjs/lib/compile-limits.ts:19-24`; `nextjs/lib/corpus-batching.ts:5-11`, `:92-96` |
| Parts are not merged; the customer is told so | `nextjs/lib/corpus-batching.ts:20-24`; `nextjs/components/compile-job-panel.tsx:139-150` |
| A collection's identity is its document selection, unless a logical key is passed; the public route and the batch worker pass none, so **adding one document makes a different collection** | `nextjs/lib/core-runtime-v2.ts:249-261`; `nextjs/app/api/collections/compile/route.ts:68`; `nextjs/lib/compile-job-worker.ts:404` |
| A single-compile "global collection" path already exists: up to 128 documents in **one** compile, bounded by 4 MiB of documents and 10,000 regions, held behind three env values (it also requires the revision flag) and described as a "private qualification path; neither flag nor a schema maximum is release evidence" | `nextjs/lib/global-collection-compile.ts:3-19`; `nextjs/lib/compile-job-store.ts:972-984`; `nextjs/lib/compile-job-worker.ts:401-402`; `nextjs/lib/collection-compile-run.ts:341-343` |
| Its corpus id is derived from the document set, so it too cannot grow | `nextjs/lib/corpus-id.ts:17-20`; `nextjs/lib/compile-job-store.ts:980-984` |
| Production failures named in the brief: `JSON_TOO_LARGE` (a stored JSON object over its bound) and `CORE_OUTPUT_TOO_LARGE` (Core's output budget); six device manuals, 6,072 regions, package 38,980,103 B (cjob-fac5555a, 2026-11-10) | `nextjs/lib/api-error-codes.ts:315`; `nextjs/lib/core-runtime-v2.ts:45-56`; recorded in `vendor/akc_product_core/compiler.py:85-93` |
| Trial workspaces have an AI World limit (default 1, max 10): every part World counts | `supabase/migrations/20261104090000_trial_ai_usage.sql:32`; `nextjs/lib/trial-ai-access.ts:277-280` |

## 2. The probe (ran)

### 2.1 Set-up

- Core: `git -C core-int archive 6b3a27bf` → `stage_release.py` → `staging/bundle-6b3a27bf`, manifest
  **byte-identical** to `receipts/WO-E-CORE-0/release-manifest.6b3a27bf.json` (`cmp` exit 0; sourceDigest
  `sha256:a37d19b60ef5494b96a7d757700b5cd79e23607bf5bff4235d7a91f28c76aad8`). Served by uvicorn on
  127.0.0.1 with the lineage scripts' local test secret.
- Foundation: this worktree's `nextjs/lib/core-runtime-v2.ts`, bundled **unmodified** with the worktree's
  esbuild, driven through its real `dispatchProductCoreV2` (request bound, signature, receipt checks),
  `projectProductCoreV2Candidate(…, keepRevisionSnapshot=true)` and `readRevisionCompileSnapshot` — the
  functions `collection-compile-run.ts:407-436, 451-483` calls. A fixed logical collection key keeps the
  collection id across steps (the way the global-collection path keys its World).
- Documents: generated by `probe/grow_by_revision_probe.py`, one page each, 60 regions (200 in §2.3c), no
  corpus text. Three **synthetic** profiles — none is a measured corpus shape:
  - `entity`: every line names one two-word entity ("Synthetic Holdings" + a number Core's keys drop);
  - `crossdoc`: statement-shaped lines that name a caption, not a company — the same captions and years
    recur across documents with other values (what 33 companies' statement pages look like to Core's
    topic key, which drops digits: `vendor/akc_product_core/semantics.py:456-462`);
  - `distinct`: every line has its own alphabetic caption — no shared topic, no shared entity (size control).
- Measured: request bytes as Foundation builds them and as they reach Core, response bytes on the wire,
  candidate and stored-artifact bytes, Core status/lifecycle/equivalence/artifact counts/identity states,
  review-reason kinds, server and client milliseconds, the probe process's peak working set.
- **What the figures are not:** time and memory are this Windows machine with the Core server and the
  harness in one Python process, not a Vercel function; bytes are deterministic (two runs of each
  `distinct` and `entity` series gave identical byte counts); the documents are synthetic.

### 2.2 Grow one World by revision vs compile it from scratch (60 regions a document)

Commands: `run.sh` step 2 (`grow_by_revision_probe.py … 60 12 <max> <revision|initial> <profile>`).
Files: `probe/out-{revision,initial}-{entity,crossdoc,distinct}-r60.json`.

`distinct` (size control):

| Documents | Revision: request B | Revision: Core response B | Revision: equivalence / rebuilt of total | Revision: units matched / new | Initial: request B | Initial: Core response B |
|---:|---:|---:|---|---|---:|---:|
| 12 | 201,253 (initial) | 15,868,947 | not_run / 2,164 of 2,164 | 0 / 720 | 201,253 | 15,868,947 |
| 24 | 1,253,426 | 30,420,899 | passed / 2,164 of 4,324 | 720 / 720 | 401,976 | 31,725,587 |
| 36 | 2,307,879 | 44,993,220 | passed / 2,164 of 6,484 | 1,440 / 720 | 602,702 | 47,602,691 |
| 48 | 3,362,333 | 59,586,049 | passed / 2,164 of 8,644 | 2,160 / 720 | 803,426 | 63,500,306 |
| 60 | 4,416,786 | 74,199,258 | passed / 2,164 of 10,804 | 2,880 / 720 | 1,004,151 | 79,418,301 |
| 72 | **5,471,240 refused before sending**: `COMPILE_INPUT_TOO_LARGE`, bound 4,500,000 | — | — | — | 1,204,876 | 95,357,744 |
| 144 | — | — | — | — | 2,409,219 | 191,423,439 (stored artifact 137,076,126) |

(Initial rows 84–132 are in the file; each 12 documents add 200,723 ± 1 request bytes and about 15.9 MB of
response — arithmetic on the file's rows.)

`crossdoc` gives the same shape (revision refused at 72 documents, 5,406,692 B; initial completes to 144,
response 189,346,571 B) with one difference that matters for a customer: **every World is
`review_required`**. At 12 and 24 documents Core emits contradiction candidates (979 and 759) plus
`CONTRADICTION_PAIR_BUDGET_EXCEEDED` (45, 57); **from 36 documents on it emits no contradiction pair at all
and 60 `CONTRADICTION_GROUP_TOO_LARGE` reasons** — every caption/year group passed the per-group bound of
C(32,2) = 496 pairs (`vendor/akc_product_core/semantics.py:314-330`). A larger World of same-captioned
statements therefore checks *fewer* contradictions, not more, and says so in its review reasons.

`entity`: 12 documents compile (`review_required`); **24 documents → HTTP 500**, initial and revision alike
(§2.4).

What the revision rows show:
1. **Core accepts new sources as a revision.** Each step: `incremental_recompile` with the previous snapshot,
   `completed` (`distinct`) / `review_required` (`crossdoc`), `equivalence: passed`, `parentWorldStateId` =
   the snapshot's, Foundation's receipt checks passed, the projection was non-null and the next snapshot was
   readable. New documents' units are all `new`; prior units are all `matched`; no `unresolved`.
2. **Identity across sources is never attempted.** Prior units are grouped by `source_id` and each document is
   matched only against its own source's prior units (`vendor/akc_product_core/compiler.py:339, 357`); the
   resolver's candidate set and its source-continuity signal are per lineage
   (`vendor/akc_cir/identity.py:426-452, 829-836`). A revision that adds sources adds `new` units; it never
   decides that a unit in one document is a unit in another.
3. **"Rebuilt 2,164" is not avoided compute.** Core compiles the whole World every time and then proves the
   selective rebuild equal to it (`vendor/akc_product_core/compiler.py:427-462`); server time grows with the
   World (local: 1,513 → 10,129 ms from 12 to 60 documents, `distinct`).
4. **The revision request is the bigger one.** It carries every document of the World plus the previous
   World's units (`nextjs/lib/core-runtime-v2.ts:330-368`): each 12 added documents add 1,054,453 ± 1 B
   against 200,723 B for a fresh compile (arithmetic on the rows); the previous-World part alone was
   851,421 B for 720 units. That is why revision hits the 4.5 MB bound at 72 documents and initial never did
   below 144.
5. The same 24 documents give a **different World by path**: 30,420,899 B by revision, 31,725,587 B from
   scratch (`distinct`); 99,811,887 vs 104,139,247 B at 200 regions (§2.3c). The probe did not compare the
   two Worlds' content beyond bytes; why they differ is **not established**.

### 2.3 Where the ceiling is

Commands: `run.sh` step 3. Files: `probe/out-initial-distinct-r60-n156.json`,
`probe/out-initial-crossdoc-r60-budget96mib.json`, `probe/out-{initial,revision}-crossdoc-r200-budget96mib.json`.

| Case | Last size that came back | First size refused | Refusal (as Foundation / Core reported it) |
|---|---|---|---|
| a. initial, `distinct`, 60 regions, Core budget 192 MiB (code default) | 144 (candidate 191,421,670 B) | 156 | `CORE_OUTPUT_TOO_LARGE` 422: 207,504,274 > 201,326,592; 9,360 regions |
| b. initial, `crossdoc`, 60 regions, budget **100,663,296** (production env, recorded `LINEAGE.md:31`) | 72 (94,327,759 B) | 84 | `CORE_OUTPUT_TOO_LARGE`: 110,112,747 > 100,663,296 |
| c. initial, `crossdoc`, **200 regions**, budget 100,663,296 | 12 (57,689,964 B) | 24 | `CORE_OUTPUT_TOO_LARGE`: 104,139,247 > 100,663,296 |
| d. revision, `crossdoc`, 200 regions, budget 100,663,296 | 24 (99,811,887 B) | 36 | `COMPILE_INPUT_TOO_LARGE`: 7,565,013 > 4,500,000, not sent |
| e. revision, `distinct` / `crossdoc`, 60 regions (§2.2) | 60 | 72 | `COMPILE_INPUT_TOO_LARGE`: 5,471,240 / 5,406,692 > 4,500,000 |
| f. any path, `entity`, 60 regions (§2.4) | 12 | 24 | HTTP 500, `CORE_V2_HTTP_500` |

Not reached in any run: the stored-candidate bound (largest stored artifact 137,076,126 B < 201,326,592),
Core's own 32 MiB request bound (`vendor/akc_product_core/api.py:27,117-118`; Foundation's 4.5 MB decides
first) and its 500-document / 100,000-unit contract caps (`vendor/akc_product_core/contracts.py:97, 139`).
Local time stayed under the 52 s client timeout (largest: 22,493 ms server, 28,489 ms client, initial
`distinct` at 144) and the probe process's peak working set reached 1,360.6 MiB; neither is a measurement of
the Vercel function, so **whether production finishes these sizes inside 60 s and its memory is not
measured** (command: the same request against a preview deployment of the same bundle — not allowed here).

The ceiling is set by **regions and output bytes**: 60-region documents reach the 96 MiB production budget
between 72 and 84 documents, 200-region documents between 12 and 24. A document count cannot express that;
the global-collection judge already counts regions and bytes (`nextjs/lib/global-collection-compile.ts:14-19`).

### 2.4 A Core defect: an entity on many lines is an HTTP 500, not a refusal

Files: `probe/out-*-entity-r60.json` (served path, `coreWire[*].exception`), `probe/diag-csv-entity-r60-{12,24}.json`.

`_validation_checks` re-reads the package's `graph/nodes.csv` with Python's `csv` module, whose default field
limit is 131,072 characters (`vendor/akc_product_core/compiler.py:1201`). An entity node's `payload` lists
its mentions: **103,140** characters at 12 `entity` documents (720 lines naming it), **206,100** at 24
(1,440). Past the limit the reader raises `_csv.Error: field larger than field limit (131072)`; the API
answers **500 with a 21-byte body**, and Foundation records `CORE_V2_HTTP_500` — an operational-looking
failure for what is a deterministic size property of the input, and no `bytes`/`budget`/`counts` for the job
event. The diagnosis raised the field limit in its own process only, to name the row (`csv_field_diag.py`);
Core was not edited. Same code at Core integration head `783d8d0` (`compiler.py:1313`, read, not run).
Measured 500s: one entity on 1,440 lines (this probe) and on 2,400 lines (below); 720 lines passed, so the
threshold lies in (720, 1,440], not bisected.
Reached inside today's 12-document limit: the independent reviewer's re-run of an initial compile of 12
documents at 200 regions (one entity on 2,400 lines) returned HTTP 500
(`receipts/review-WO-BIG-0/r20/init-entity-r200-12.json`). Not established whether production has
returned this 500.

## 3. Merging parts: what Core has (read and ran)

### 3.1 Read

- `akc_cir.identity` decides whether a *unit of one source* continues across *versions of that source*: merge
  bar 0.92, ambiguous band 0.75–0.92, "calibrated per route/document type later"
  (`vendor/akc_cir/identity.py:263-268`); `CalibrationTable.calibrated` is `False` and refuses `True` without
  naming a corpus (`vendor/akc_cir/inspection.py:277-301`). It is never asked to say two *sources* hold the
  same thing (§2.2 point 2). Protected Core: read only, nothing proposed for it here.
- Inside one compile, entities across documents are already merged — by **exact casefolded label**
  (`vendor/akc_product_core/semantics.py:442-453` builds candidates; the label is the entity id per
  `corpus_reduce.py:12-13`). A 12-document World already makes that claim today.
- `corpus_reduce` (live Core, ADR-008 of the Core repository, status *Proposed*): folds verified part outputs
  into the World one compile over the whole corpus would have produced — union by content-derived ids
  (collision refuses), entities merged only on the same exact key, look-alike names returned as
  `human_review_required` candidates and never merged, contradictions/profile/architecture/ontology
  recomputed over the union, no partial result (`vendor/akc_product_core/corpus_reduce.py:1-20`). Served
  only as a process-local shadow when a request names `corpusPart` (`api.py:112, 213-264`); `on` refuses to
  start "until the split/whole equivalence benchmark passes 100% on a real corpus" (`__main__.py:30-42`).
  Foundation does not send `corpusPart` (`git grep corpusPart -- nextjs/lib nextjs/app` → 0 hits).
  The reduce emits the World *model*; the delivery package is "built at rollout" (ADR-008 §Decision).

So the sentence on the corpus card — merging parts "is identity resolution with a calibration requirement,
and it does not exist" (`compile-job-panel.tsx:139-150`) — is exact for a *fuzzy* cross-part merge and not
for the reduce: an exact-key reduce makes no identity claim a single compile does not already make. Its gate
is split/whole equivalence, not calibration.

### 3.2 Ran: split compile + reduce == whole compile

Command: `run.sh` step 5 (`benchmark/product_core_corpus_reduce.py`, the Core repository's ADR-008 gate, from
the 6b3a27bf archive). Files: `probe/reduce/synthetic-6b3a27bf.json`, `probe/reduce/corpus24-6b3a27bf.json`.

| Input | Cases | Equal | Negative control (naive concatenation) |
|---|---:|---:|---|
| Built-in synthetic fixtures (26 corpora, ≤ 12 documents) | 247 | 247 | detected |
| `distinct` 24 documents, 1,440 regions, Foundation-built wire documents (`make_corpus.py`) | 10 strategies (Foundation's 12-split, contiguous k=2/3/4/6, interleaved k=2/3, reversed, overlap, singletons) | 10 | detected |
| `crossdoc` 24 documents, same | 10 | 10 | detected |

Two labels inside the receipt files are not what they read as. `corpus24-6b3a27bf.json` records
`"corpusKind": "real"` and `"gatePassed": true`: the benchmark writes "real" for every input passed with
`--corpus` (`product_core_corpus_reduce.py:420`), and the input here is the two synthetic corpora from
`make_corpus.py`, so that `gatePassed` is split/whole equality on synthetic input, not ADR-008's real-corpus
gate. `"coreReleaseDigest": "sha256:b3b3…b3"` in both reduce receipts is the benchmark's fixture constant
(`:54`), not a release; the source that ran is the 6b3a27bf archive. The receipt files are kept unedited
(their hashes are in §8); `probe/reduce/LABELS.md` says the same beside them.

Synthetic regression input, not evidence about customer documents; ADR-008's rollout gate (≥ 20 real corpora
plus > 12-document real corpora against an offline whole compile) is **not met** and was not attempted (no
customer document may enter a receipt here).

What a merge still needs before a customer may see it: (1) the real-corpus gate; (2) the delivery package
built from the reduced model, with its own size check — the reduced World is exactly as large as the whole
compile (§2.3), so it inherits the 96 MiB output budget, the 192 MiB stored bound and the §2.4 CSV defect;
(3) a place to run: the reduce's input is every part's full output (15.9–28.4 MB per 12-document part at 60
regions, §2.2), which cannot travel in one 4.5 MB function request — it has to read the stored parts where they
are (a Core endpoint or worker with read access to them, which is a new credential boundary for Core) or take
a slimmer part projection that does not exist yet; (4) Foundation sending `corpusPart` and storing parts the
reduce can verify.

## 4. The four options

### A. Grow by revision

- **Customer sees:** "Add sources to this World"; the next World names its parent and says N sources added,
  equivalence passed; review/activation as today.
- **Integrity risk:** low on identity (no cross-source decision is made, §2.2·2); real risk is a World that
  quietly stops growing — the request refusal arrives at 72 documents (60 regions) or 36 (200 regions) and
  then every further addition is refused. Also the unexplained by-path byte difference (§2.2·5).
- **What it needs:** a World key that survives membership edits on the product path (today every path keys by
  selection, §1); `TAVONEL_CORE_V2_REVISION_COMPILE=1` in production (unset, recorded `LINEAGE.md:68`); the
  WO-E-INC-1 wire on `codex/v34-core-wire` merged; no Core release (`LINEAGE.md:74`).
- **Ladder:** contract (WO-E-INC-1, reviewed) → shadow (revision computed beside a full compile, compare) →
  benchmark (same-condition: the §2.2 shape on a real corpus, plus explaining §2.2·5) → canary → rollout.
- **Earliest honest range** (planning judgement, not a measurement): as an *update* path, 2026-12-14 –
  2027-01-31; as a *growth* path, never on this wire — its ceiling is lower than a fresh compile's.
- **Unknown:** why revision and initial Worlds differ in bytes; production time for a 60-document full
  recompile; how a customer removes a source from a grown World (Core emits `UNIT_REMOVED`,
  `compiler.py:373-381`; Foundation has no flow).

### B. Merge parts (`corpus_reduce`)

- **Customer sees:** one corpus World card instead of "11 separate Worlds"; its parts folded underneath;
  look-alike names as review items; one Ask, one World lens.
- **Integrity risk:** exact-label entity merge across many documents (the claim one compile already makes,
  widened: unrelated mentions that share a label become one entity — precision of that rule is unmeasured at
  any size); a reduce that diverges from the whole compile (gated: §3.2); a corpus World that inherits §2.4.
- **What it needs:** §3.2 (1)–(4); a Core release that turns the reduce on behind the gate; Foundation
  corpus card, storage and activation of a reduced World.
- **Ladder:** contract (exists, ADR-008) → shadow (exists process-local; durable shadow needs `corpusPart` and
  stored parts) → benchmark (real corpora, 100%) → canary → rollout → deprecate the per-part list.
- **Earliest honest range** (planning judgement, not a measurement): 2027-02-01 – 2027-04-30 (needs a consented real corpus set, a Core release with a
  storage-reading reduce, and Foundation storage; each is its own lane).
- **Unknown:** precision of exact-label merging across companies; reduce run time and memory at 128 documents;
  the delivery-package bytes of a reduced World; where the reduce runs.

### C. Raise the per-compile number

- **Why the code refuses it:** `compile-limits.ts:19-24` — one request, one invocation, one artifact; the
  output budget (`compiler.py:80-94`) was re-derived on 2026-11-10 from manual-shaped input, ~1,012 regions a
  document: 12 → 176.2 MB candidate, 1,102 MiB (recorded there).
- **Measured headroom** (§2.3): yes for light documents — 72 documents of 60 regions under production's 96 MiB
  budget, 144 under 192 MiB — and none for dense ones (200 regions: 12). The count is the wrong unit: a budget
  in regions and bytes is the honest form, and the code has one already (the global-collection judge, §1).
- **Customer sees:** one World for a selection that fits the budget; a selection that does not is refused at
  *selection time* with its region and byte figures (never after OCR); it becomes parts only when the person
  chooses that, never by a silent fallback.
- **Integrity risk:** §2.4 reached more often (more lines per entity); contradiction checking that switches off
  per group as the World grows (§2.2 `crossdoc`, `CONTRADICTION_GROUP_TOO_LARGE` from 36 documents) — the World
  is `review_required` and must say that cross-document contradictions in those groups were not checked;
  production time and memory at these sizes unmeasured.
- **What it needs:** the §2.4 fix in a Core release (named refusal with counts, no 500); the global-collection
  path qualified (it requires the revision flag today, `global-collection-compile.ts:4-8`, which ties two
  rollouts together — to be untied or decided); a production-shaped timing run on a preview of the staged
  bundle; selection-time copy.
- **Ladder:** contract (exists: `judgeGlobalCollectionInput`) → shadow (compile the whole selection once beside
  its parts and compare with the §3.2 comparator: whole == reduce(parts) means the one World says nothing the
  parts did not) → benchmark (that comparison on real corpora + the timing run) → canary (one workspace, by
  events) → rollout.
- **Earliest honest range** (planning judgement, not a measurement): 2026-12-14 – 2027-01-31 (one Core fix release, one Foundation qualification lane).
- **Unknown:** production wall time and memory above 12 documents; the founder's 33-page corpus's region and
  byte totals (counted, not copied, by WO-BIG-2 below); exact-label merge precision (as B).

### D. Federated read

- **Customer sees:** Ask and the World lens over several active Worlds of one workspace, side by side; every
  answer, citation and count names its World; no total across Worlds.
- **Must never say:** "your World" for the set; any cross-World count, total, entity or timeline; that two
  Worlds' objects are the same or that they agree; "no contradictions" across Worlds (none is checked). Each
  World's own freshness and receipt stays separate (`app/api/collections/[id]/ask/route.ts:316-325` binds one
  manifest today).
- **Cost:** one retrieval per World per question (N × today's read, metered N times or explained); Ask's
  evidence budget split across Worlds — the abstention in brief item 3 ("selected evidence is too long") gets
  more likely, not less; the listing exists (`nextjs/lib/world-store.ts:523`), workspace-scoped.
- **Integrity risk:** the reader assumes it is one World; mitigated only by copy and per-result labels.
- **Ladder:** contract (public DTO naming World per result) → shadow (federated answer computed, not shown) →
  benchmark (answer-faithfulness on a fixed question set, per World) → canary → rollout. No Core change.
- **Earliest honest range** (planning judgement, not a measurement): 2026-12-07 – 2027-01-15.
- **Unknown:** answer quality when evidence comes from several Worlds; metering wording (founder-owned copy).

## 5. Dispositions

| # | Option | Disposition | Reason |
|---|---|---|---|
| A | Grow by revision | **Adopted for updates only; rejected as the way to grow** | Core takes new sources (§2.2·1), but the request carries the World twice and stops at 72/36 documents, below a fresh compile (§2.3 d, e) |
| B | Merge parts (`corpus_reduce`) | **Adopted as the route past one request, behind ADR-008's gate** | Equivalent to the whole compile on every synthetic case run (§3.2) and needs no calibration; not shippable before the real-corpus gate, a delivery package and a place to run it (§3.2 (1)–(4)) |
| C | Raise the per-compile number | **Adopted in budget form (regions + bytes, via the global-collection path); rejected as "a bigger count"** | Measured headroom exists for light documents and none for dense ones (§2.3); a count cannot carry that |
| D | Federated read | **Adopted as the interim for what does not fit one World; never labelled one World** | No Core change and no identity claim; costs N reads and a stricter copy |
| E | Concatenate part ontologies in Foundation | **Rejected** | Duplicates entities and loses every contradiction across a seam (`corpus-batching.ts:20-24`); the §3.2 negative control is exactly this and is detected |
| F | Fuzzy cross-part matching via `akc_cir.identity` | **Rejected for now** | Protected Core, built for one source's versions, merge bar uncalibrated (§3.1); the reduce returns look-alikes for review instead |
| G | Raise Python's CSV field limit as the fix for §2.4 | **Not decided here** | A bound has to exist; whether it is a raised limit tied to the output budget or a named refusal is the fix lane's call, with the failure path tested |

## 6. Recommendation and the first three work orders

**Recommendation:** make "one World" mean **one compile within a region-and-byte budget** (C, through the
global-collection path), after Core answers an oversized field with a named refusal; show, before compiling,
whether a selection fits; keep parts plus an honest federated read (D) for what does not; take B through its
gate as the way past one request. A stays the update mechanism.

| WO | Title | Size | Write scope | Depends on |
|---|---|---|---|---|
| WO-BIG-1 | Core: an oversized package field is a named refusal, not a 500 (§2.4), failure path tested with the `entity` profile; release built on 6b3a27bf like K1 (`LINEAGE.md:109`) | S (Core, tier A: release) | `packages/product-core/src/akc_product_core/compiler.py` (`_validation_checks`), its unit test; Foundation `nextjs/lib/core-runtime-v2.ts` only if the new code needs mapping | none |
| WO-BIG-2 | Foundation: qualify one-compile Worlds by budget — selection-time verdict in regions and bytes (reuse `judgeGlobalCollectionInput`), untie the global-collection flag from the revision flag or record why not, count (never copy) the founder corpus's regions and bytes, shadow comparison whole vs reduce(parts) on synthetic input | M (tier A: compile gating) | `nextjs/lib/global-collection-compile.ts`, `compile-limits.ts`, `compile-job-store.ts` (enqueue choice), their tests; receipts | WO-BIG-1 released before any canary |
| WO-BIG-3 | Foundation: federated read over active Worlds — Ask and World lens answer per World, side by side, public DTO names the World per result, copy per §4 D "must never say", metering per World | M (tier B; tier A if metering changes) | `nextjs/app/api/collections/[id]/ask/**` or a new `nextjs/app/api/worlds/ask` route, `nextjs/lib/world-store.ts` reader, tests; not `app/workspace/page.tsx` (WO-WS-1/2 own it) | WO-WS-1 (active-World listing in the page) |

B's next step (a storage-reading reduce and the real-corpus gate) is a Core lane after these three and needs a
consented real corpus; it is not in the first three.

## 7. Not measured, and the command that would measure it

| Figure | Command / read |
|---|---|
| Production wall time and memory for a compile above 12 documents | the §2.3 request against a preview deployment of the staged bundle (`vercel deploy` of `staging/bundle-6b3a27bf`, not `--prod`) with the probe pointed at it — not allowed in this work order |
| Whether production ever returned the §2.4 500 | job events with `CORE_V2_HTTP_500` in `foundation_compile_job_events` (production read) |
| Region and byte totals of the founder's 33-page World | WO-BIG-2's count over the stored `ocr.json` objects (counts only) |
| Why revision and initial Worlds of the same documents differ in bytes | diff of the two canonical forms (`corpus_reduce.canonical_form_of_compile`) from the §2.2 24-document pair |
| Exact-label entity merge precision at any size | a labelled set of entity mentions across companies; none exists |
| `corpus_reduce` run time/memory at 128 documents; reduced delivery-package bytes | `benchmark/product_core_corpus_reduce.py --corpus` on a 128-document synthetic corpus with timing; the package projection does not exist |
| The entity-mention count at which §2.4 starts | bisect `csv_field_diag.py … <n> entity` between 12 and 24 documents |

## 8. Receipt index (sha256)

All under `D:/CodexProjects/v34-lanes/receipts/WO-BIG-0/`. Scripts: `run.sh` `6576020a…89bb`; `probe/grow_by_revision_probe.py` `6f416084…e594`;
`probe/csv_field_diag.py` `e1f81204…d89a`; `probe/reduce/make_corpus.py` `4e7b7dad…fb4a`.
Staged manifest `staging/bundle-6b3a27bf/release-manifest.json` `181a2743…667f`.

| File | sha256 |
|---|---|
| `probe/out-revision-distinct-r60.json` | `2ba6c258…dbdc` |
| `probe/out-initial-distinct-r60.json` | `bdecb8cd…57be` |
| `probe/out-revision-crossdoc-r60.json` | `c9865005…8c41` |
| `probe/out-initial-crossdoc-r60.json` | `02bbf47c…0254` |
| `probe/out-revision-entity-r60.json` | `85822a4f…b5a0` |
| `probe/out-initial-entity-r60.json` | `36cf2529…4010` |
| `probe/out-initial-distinct-r60-n156.json` | `7c19babe…a084` |
| `probe/out-initial-crossdoc-r60-budget96mib.json` | `e03904f3…bb3a` |
| `probe/out-initial-crossdoc-r200-budget96mib.json` | `7586b1db…fb7d` |
| `probe/out-revision-crossdoc-r200-budget96mib.json` | `a6ffee86…e12d` |
| `probe/diag-csv-entity-r60-12.json` | `64018638…7821` |
| `probe/diag-csv-entity-r60-24.json` | `eba11a13…25a1` |
| `probe/reduce/synthetic-6b3a27bf.json` | `5b5bd5f2…ec40` |
| `probe/reduce/corpus24-6b3a27bf.json` | `2d0e3c2d…f490` |
| `probe/reduce/corpus-distinct-r60-24.json` | `27b8e290…a3d8` |
| `probe/reduce/corpus-crossdoc-r60-24.json` | `eb71d961…8a27` |

`probe/superseded-keepalive-out-*-crossdoc-r60.json` are kept as the record of a harness artifact: the first
`crossdoc` runs stopped at 36 documents with `CORE_V2_UNAVAILABLE` in 25 ms and no request reaching Core.
The fetch error's cause was not captured (`dispatchProductCoreV2` keeps only the code); the timing fits
uvicorn's 5 s keep-alive closing the pooled socket while the client projected a large World (inferred, not
shown). The probe now sets `timeout_keep_alive=900` and the re-run reached the bounds in §2.3 with no such
failure. Not counted as a Core or Foundation result.
