# ADR-0004 — Processing a source by page range, and where the ceiling comes from

- **Status:** Proposed. Nothing in this document is implemented. It changes no number in
  `shared/intakeCeiling.ts`, no capability token, no commercial, intake or consent switch and no
  public sentence.
- **Date:** 2026-10-17
- **Branch this was written on:** `codex/ux-tab-20261017`, on top of `922e950c`.
- **Decision owner:** the founder, for every row under [Founder-only decisions](#founder-only-decisions).
  The steps marked *agent* may be built as code and tests without a founder decision. None of them
  may be deployed or applied without one.
- **Plan:** the table/limits design of 2026-10-17, Part A and its task T6 (`PLAN:398`). The Core
  half of T6, `ADR-008-table-reader-lane.md`, belongs in the Core repository and is not written
  here (`CRITIC:174`).

## The question

Today a source is processed only if it is at most 5 MiB and at most 80 pages
(`shared/intakeCeiling.ts:32-36`). The plan names that ceiling as one of the two gaps competitors
sell against (`PLAN:4`). What has to change before TAVONEL can process a larger source, what can be
built now, and which numbers may only the founder choose?

## Sources, and how to read a number here

Every number in this ADR sits beside one of four kinds of source.

- A `path:line` in this tree. Paths are repo-relative, with three abbreviations: `WORKER/` is
  `quarantine-sidecar/foundation-cdr-worker/`, `CDR/` is `quarantine-sidecar/cdr-cloudrun/` and
  `GPU/` is `workers/foundation-ocr-gpu/`. A bare `:line` refers to the last path before it.
- A `p0p2:path:line` in the Core V2 source tree the plan read, `ai-knowledge-compiler-p0p2-productization`
  at `3ffe927`. It is not in this repository, and whether the deployed Core V2 is built from that
  exact commit was not re-verified.
- A receipt alias from the table below, followed by the field that holds the value.
- A `PLAN:line` for a platform limit (Vercel, Cloudflare, Google Cloud Run, R2). Those are vendor
  documentation as the plan recorded it on 2026-10-17. TAVONEL has reproduced none of them.

**[calc]** marks arithmetic on sourced numbers. Arithmetic is not measurement.

No number here is a public claim and none may be quoted as one. Every receipt below is an internal
diagnostic over public benchmark documents (GDP.pdf HEAD `8d1efb32`, unofficial conditions), not
customer data.

| Alias | File | sha256 |
| --- | --- | --- |
| `F5` | `outputs/tavonel-research-replan-20261013/resume-20261015/gdp-20261015/F5-GPU-OCR-RECEIPT.json` | `142f1e9045a1783ac1a3aaae3cc4461f9e26569b71f96d9544036d2b6f915aaa` |
| `F5C` | `outputs/tavonel-research-replan-20261013/resume-20261015/gdp-20261015/F5C-IMAGE-ROLLOUT-RECEIPT.json` | `817db99ec9044af069888d323db9d687d93e318f7c7f39ae01ce87d3f8481399` |
| `FIT` | `outputs/tavonel-research-replan-20261013/ux-program-20261017/table-limits-receipts/FIT-AND-PAYLOAD.json` | `ace09a540d081d3b6a5d913da19ee81f90b45e1728ebd9a5e718ad42f40f3d59` |
| `PLAN` | `outputs/tavonel-research-replan-20261013/ux-program-20261017/TABLE-EXTRACTION-AND-LIMITS-DESIGN-2026-10-17.md` | `09e20ffed8904fa0cea70c3454604b836df00a47df5c5cffe795dd22ba77c132` |
| `CRITIC` | `outputs/tavonel-research-replan-20261013/ux-program-20261017/PHASE1-CRITIC-2026-10-17.md` | `667010c53a226f980241fc61b3581112cabae954867affc35e24eebf3f8efa81` |

The `outputs/` paths are relative to the Core working tree, `D:/CodexProjects/ai-knowledge-compiler`.
They are not in this repository. `FIT` was produced by `fit-and-payload.mjs` in the same folder
(sha256 `f7568bf2828568ee944430d53c1dd5016a6f0ec4ca2c6265d3b82a09d3a6f3c2`).

## What is there today

### The ceiling is consistent, not derived

`shared/intakeCeiling.ts` holds the ceiling once. It exports the smaller of two byte caps, the
worker's and the rasterizer's, both `5 * 1024 * 1024` (`shared/intakeCeiling.ts:32`, `:34`, `:40`),
and the rasterizer's page cap, `80` (`:36`). Its first rule calls the ceiling "a *measurement of
the deployed processors*, not a target" (`shared/intakeCeiling.ts:16-18`).

The processors' own values are constants, and the plan found no measurement behind any of them
(`PLAN:13`): `WORKER/src/keys.ts:4`, `CDR/app.py:50`, `CDR/app.py:52`, `GPU/app.py:24-25`. Since
P2-18 (`6debc5c1`), `nextjs/lib/intake-ceiling-cross-tree.test.ts` reads every copy as text and
fails when one disagrees (`nextjs/lib/intake-ceiling-cross-tree.test.ts:53-94`). The ceiling is now
consistent across trees. It is still not derived from anything.

Intake enforces bytes and only discloses pages, because intake never decodes the document
(`shared/intakeCeiling.ts:19-21`). The ceiling reaches a customer as one sentence,
`PROCESSING_CEILING_SENTENCE` (`shared/intakeCeiling.ts:59-60`), and as two manifest tokens
(`shared/intakeCeiling.ts:53-56`, listed at `shared/capabilityManifest.ts:97`). Both are public
wording. This ADR leaves them as they are.

### The path a source takes

1. The browser uploads with one presigned PUT, abandoned after `UPLOAD_TIMEOUT_MS`
   (`nextjs/lib/upload-transfer.ts:62`).
2. A queue hands it to the Cloudflare worker one message at a time (`WORKER/wrangler.jsonc:33-35`).
3. The worker reads the whole source into memory (`WORKER/src/sanitize.ts:515`) and posts it as one
   multipart body to the Cloud Run rasterizer (`WORKER/src/sanitize.ts:553-554`).
4. The rasterizer renders every page into a new PDF (`CDR/app.py:579`).
5. The worker reads the whole sanitized PDF (`WORKER/src/ocr.ts:559`) and posts it as one request
   to the GPU reader (`WORKER/src/ocr.ts:602`, `:612`).
6. The result is stored once, as `ocr.json` beside `sanitized.pdf` (`WORKER/src/keys.ts:76-80`),
   with a write that refuses to overwrite (`WORKER/src/ocr.ts:730`).
7. A cron-driven turn (`nextjs/vercel.json:15`) calls Core V2 synchronously. The request carries
   every OCR region inline (`nextjs/lib/core-runtime-v2.ts:318`) beside `ocrObjectKey` (`:299`).
   Core requires the key (`p0p2:packages/product-core/src/akc_product_core/contracts.py:52`) and
   checks that it is content-addressed
   (`p0p2:packages/product-core/src/akc_product_core/compiler.py:1275-1278`), but does not read
   the object. Its source holds no object-store client: a search for `boto3`, `botocore`, `R2_`
   and `s3.` over the Python files under `packages/product-core/src` finds nothing.

Every step handles a whole document. That is the property this ADR changes.

### Every boundary, and whether anyone measured it

*Constant* means a value written in code with no measurement behind it. *Measured* means a receipt
holds an observation. *Platform documentation* means a vendor page as the plan recorded it.
*Assumption* means the code itself calls the value a guess.

| ID | Boundary | Value | Where | What it is |
| --- | --- | --- | --- | --- |
| B1 | Intake admission, typed refusal | the smaller of two caps of 5 MiB | `shared/intakeCeiling.ts:40`; `nextjs/app/api/uploads/capability/route.ts:70` | Constant |
| B2 | Bytes the worker reads | 5 MiB, refused as `PARSER_OOM` | `WORKER/src/keys.ts:4`; `WORKER/src/sanitize.ts:508-512` | Constant. Named as an out-of-memory refusal, but the plan found no worker memory measurement (`PLAN:80`) |
| B3 | Rasterizer input | 5 MiB plus 64 KiB of framing | `CDR/app.py:50`; `CDR/app.py:659` | Constant |
| B4 | Rasterizer pages | 80 | `CDR/app.py:52`; `CDR/app.py:592` | Constant. One refusal observed: 2,276,931 B and 121 pages (`docs/evidence/ocr/FOUNDATION_GPU_OCR_FULL_SEQUENCE_2026-08-29.json:78-82`) |
| B5 | Rasterizer pixel budget | 80,000,000 px per document, 30,000,000 px per page, scale 1.5 falling to 1.0, refused below 1.0 | `CDR/app.py:53-56`; `CDR/app.py:564-576` | Constant |
| B6 | Sanitized PDF out, GPU reader in | 18 MiB | `CDR/app.py:51`; `GPU/app.py:24` | Constant, pinned by `nextjs/lib/intake-ceiling-cross-tree.test.ts:49` |
| B7 | Office conversion | 45 s | `CDR/app.py:532` | Constant. Conversion time of a large DOCX or PPTX was not measured (`PLAN:85`) |
| B8 | Rasterizer request time | body receive 15 s, service 120 s, worker wait 60 s | `CDR/app.py:660`; `CDR/service.yaml:37`; `WORKER/src/sanitize.ts:570` | Constant. `service.yaml` is a declaration; the live service was not read |
| B9 | Rasterizer concurrency | one instance, one request at a time, one queue consumer | `CDR/service.yaml:24`; `CDR/service.yaml:36`; `WORKER/wrangler.jsonc:34` | Constant |
| B10 | Malware scan | ClamAV `StreamMaxLength`, 100 MB by default | `CDR/README.md:191` | One size measured: p95 142.235 ms over 7 runs at 4.9 MiB, synthetic bytes, adapter level only (`docs/evidence/receipts/malware_scan_latency_2026-09-06.json:40-45`) |
| B11 | OCR request | the whole document in one request, 85 s | `WORKER/src/ocr.ts:167`; `WORKER/src/ocr.ts:160` | Measured beyond it, below. The GPU endpoint itself allows 600000 ms (`F5C` `endpoint.timeoutMs`) |
| B12 | OCR result bounds | pages ≤ 80, regions ≤ 50,000, text ≤ 4,000,000 characters, stored ≤ 24 MiB | `WORKER/src/ocr.ts:390`; `WORKER/src/ocr.ts:395`; `WORKER/src/ocr.ts:387`; `WORKER/src/ocr.ts:101` | Constant, pinned by the P2-18 test |
| B13 | GPU reader | `MAX_PAGES` 80; a document with no text region is refused whole with 422 | `GPU/app.py:25`; `GPU/app.py:553`; `GPU/app.py:579` | Constant |
| B14 | Core V2 request size | application cap 32 MiB; Vercel function request body 4.5 MB | `p0p2:packages/product-core/src/akc_product_core/api.py:21`; `PLAN:92` | Constant, and platform documentation. A request over 4.5 MB failing was not reproduced |
| B15 | Core V2 contract | regions ≤ 100,000 per document, documents ≤ 500, latency ≤ 900,000 ms | `p0p2:packages/product-core/src/akc_product_core/contracts.py:57`; `:121`; `:105` | Constant |
| B16 | Compile turn | 60 s turn, 8 s reserve, so Core is waited on for 52 s; lease 180 s | `nextjs/lib/execution-budget.ts:41`; `nextjs/lib/execution-budget.ts:52`; `nextjs/lib/execution-budget.ts:55`; `nextjs/app/api/internal/jobs/run/route.ts:71` | Constant. ADR-0003: "A compile that genuinely needs more than 52 seconds still cannot complete" (`docs/adr/0003-core-execution-budget-and-async-dispatch.md:68`) |
| B17 | Database | `requested_bytes` from 1 to 5242880; the RPC refuses above 5242880; approval ledger `byte_length` from 1 to 5242880 | `supabase/migrations/0051_intake_ceiling_and_gate_evidence.sql:47`; `:87`; `:131`; `supabase/migrations/20261003120000_intake_approval_budget_invariants.sql:72`; `:437` | Constant |
| B18 | Upload | one presigned PUT, 120 s | `nextjs/lib/upload-transfer.ts:62` | Assumption: sized to carry 5 MiB "at about 43 KiB/s" and "a ceiling, not a measured value" (`nextjs/lib/upload-transfer.ts:58-60`) |
| B19 | Metering | 2 credits per OCR'd document, whatever its length | `WORKER/src/ocr.ts:130` | Constant |

The platform limits the decision depends on, all vendor documentation as the plan recorded it and
none reproduced:

- Cloudflare isolate memory, 128 MB (`PLAN:80`).
- Cloud Run, 32 MiB per HTTP/1 request (`PLAN:81`) and a request timeout of up to 60 minutes
  (`PLAN:86`).
- Cloudflare queue consumer, 15 minutes of wall time (`PLAN:119`; the worker says the same at
  `WORKER/src/ocr.ts:162`).
- Vercel functions, a 4.5 MB request body (`PLAN:92`) and on Pro a `maxDuration` of up to 800 s
  (`PLAN:94`).
- R2, about 5 GiB in one PUT (`PLAN:96`).

### What was measured

Everything below comes from `F5`, `F5C` and `FIT`: nine public benchmark documents, 188 pages
(`F5` `denominators`), and no OCR gold. Agreement between readers is not accuracy (`F5` `scope`).

- **Page mode**, one page per POST: client wall median 3.164 s, maximum 10.208 s, sum 647.612 s
  over 188 pages (`F5` `timing.gpu`). It is measured from a client in Korea to a US worker and
  includes upload, load balancer, OCR and download, so it bounds GPU time from above and is not
  GPU time.
- A one-page PDF split from the source renders the same pixels as the original page on 188/188
  pages (`F5` `requests.pixelEquivalence`; a local pypdfium2 render, the server render is not
  observable). Page mode returned 422 for 3 of 188 pages, the pages with no text
  (`F5` `requests.httpStatusByModeAllAttempts`).
- **Document mode**, the request shape the worker uses: 73 pages took 182.937 s and 60 pages took
  117.427 s, both flagged `over85sCdrClientTimeout` (`F5` `documentMode`). Across the six
  multi-page raster documents in that list, wall time per page ran from 1.423 s (8 pages in
  11.385 s) to 2.506 s (73 pages in 182.937 s). Cold start was 40.3 s (`F5` `run.coldStartSeconds`).
- **Payload**: the 73-page document produced 22,332 regions, an OCR body of 4,463,100 B and
  4,276,070 B of regions alone; the 60-page document produced 3,811 regions, 982,672 B and
  838,570 B (`FIT` `ocrPayload`).
- **Neither measured long document is admissible today.** Their sources are 13,198,322 B and
  5,621,893 B (`FIT` `ocrPayload.*.inputBytes`), both above the 5,242,880 B ceiling
  (`shared/intakeCeiling.ts:32`). They were posted to the GPU reader by a research script
  (`F5` `inputs.script`), never through intake, the worker and the rasterizer. **No receipt shows
  what the product path does with a long scan.**
- **Corpus fit**, over 97 unique public benchmark PDFs: 60 of 97 fit 5 MiB and 80 pages; 74 of 97
  fit 32 MiB less 64 KiB and 80 pages; 95 of 97 fit 32 MiB less 64 KiB and 200 pages; 97 of 97 fit
  50 MiB and 500 pages. The median is 26 pages and 1,929,030 B; the largest is 200 pages and
  34,267,973 B (`FIT` `fit`, `pages`, `bytes`). These are benchmark files, so the counts say
  nothing about what share of customer documents fit.

### What breaks first

In the order it binds. Items marked [calc] are arithmetic on the numbers above.

1. **The 85-second request may hold fewer than 80 pages of scan.** [calc] At 1.423 to 2.506 s per
   page, 85 s holds a full scan of 33 to 59 pages. The 80-page ceiling may already be out of reach
   for a scan before anything is raised (`CRITIC:53`, `CRITIC:151`). It is the cheapest open
   question, and answering it spends GPU money (T7, `PLAN:399`).
2. **The Core request body.** 4,276,070 B of regions for one 73-page document is already close to a
   documented 4.5 MB request body (`FIT` `ocrPayload`; `PLAN:92`). Whether a dense source inside
   5 MiB crosses it was not measured.
3. **The 52-second compile.** A compile longer than 52 s cannot complete
   (`docs/adr/0003-core-execution-budget-and-async-dispatch.md:68`). Compile time against page
   count was not measured.
4. **Result bounds at 500 pages.** [calc] At the mean of 30,772 regions over 188 pages, 163.7 per
   page (`F5` `coverage.gpuRegionsTotal`), 500 pages give 81,840 regions. At the densest
   document's 305.9 per page (22,332 over 73), they give 152,959. Both exceed the worker's 50,000
   (`WORKER/src/ocr.ts:395`), and the second exceeds Core's 100,000
   (`p0p2:packages/product-core/src/akc_product_core/contracts.py:57`). The 73-page OCR body
   scaled to 500 pages is 30,569,178 B, over the 24 MiB stored bound (`WORKER/src/ocr.ts:101`).
5. **The pixel budget.** [calc] An A4 page is 595.28 × 841.89 pt (`PLAN:83`), so 501,160 px at
   scale 1.0. The 80,000,000 px document budget (`CDR/app.py:56`) keeps scale 1.5 up to 70 A4
   pages, already renders 80 A4 pages at about scale 1.41, and would refuse from 160 A4 pages even
   without the page cap (`CDR/app.py:564-576`). 500 A4 pages at scale 1.0 are 250,580,140 px. The
   budget has to be spent per range.
6. **Worker memory.** The worker holds the whole source (`WORKER/src/sanitize.ts:515`) and wraps it
   again for the request (`WORKER/src/sanitize.ts:554`). Against a documented 128 MB isolate
   (`PLAN:80`), a 50 MB source is an unmeasured risk.
7. **Malware scan margin.** ClamAV's size limits stop silently under the image's default
   `AlertExceedsMax no` (`CDR/README.md:201-203`). A larger source narrows the margin to
   `StreamMaxLength` (`CDR/README.md:191`).
8. **Metering.** A 500-page document is charged the same 2 credits as a one-page document
   (`WORKER/src/ocr.ts:130`).

## Decision (proposed)

**The unit of work becomes a page range, `[start, end)`, not a document, and every ceiling is
re-derived from the measurement of the stage that raises it.** No target is chosen first, and no
constant is raised to meet one. This is the first rule of `shared/intakeCeiling.ts`
(`shared/intakeCeiling.ts:16-18`), applied stage by stage.

There are five parts. Each says who may build it and who must approve it.

### Part A — ranged OCR in the worker (*agent* builds code and tests; deployment is the founder's)

- The worker splits `sanitized.pdf` into ranges and sends one queue message per range. A consumer
  may run for 15 minutes, but one OCR request stays inside the approved 85 s
  (`WORKER/src/ocr.ts:160-167`), so the ranges are separate messages rather than one long consumer.
- The GPU reader already rasterizes a chosen set of pages (`GPU/app.py:351`), and a split page
  renders identically (188/188, `F5` `requests.pixelEquivalence`).
- Each range is written once, to `immutable/…/ocr-pages/{start}-{end}.json`, with the same
  refuse-to-overwrite write that `ocr.json` uses (`WORKER/src/ocr.ts:730`). A redelivered message
  rewrites nothing.
- `ocr.json` is assembled only when every range is present. A missing range is reported as
  `OCR_PAGES_INCOMPLETE` and nothing is assembled. No partial document ever reaches compile.
- A page with no text returns `pageStatus: "no_text"` instead of failing the whole request with
  422 (`GPU/app.py:579`). That refusal is what failed 3 of 188 page-mode requests
  (`F5` `requests.httpStatusByModeAllAttempts`).
- The range size is a calibration knob, `floor(85 s ÷ measured p90 seconds per page)`. [calc] With
  the page-mode maximum of 10.208 s (`F5` `timing.gpu`) it is 8 pages. The default is set only
  after the product path is measured (T7).
- The no-regression contract: for every fixture of at most 80 pages (`CDR/app.py:52`), the
  assembled `ocr.json` equals the single-request `ocr.json` byte for byte. Until it does, and until
  a same-condition timing receipt exists, the single-request path stays authoritative.

### Part B — ranged rasterizing, PDF only (*agent* builds code and tests; applying it is the founder's)

- `/v1/disarm` accepts `[start, end)`, spends the pixel budget per range instead of per document
  (`CDR/app.py:55-56`), and writes one sanitized PDF and one receipt per range.
- Office sources stay at today's ceiling. A converted file is not yet disarmed and may not leave
  the rasterizer, and its conversion time is unmeasured (`CDR/app.py:532`).
- A source within the documented 32 MiB HTTP/1 limit (`PLAN:81`) can keep today's transfer. A
  larger one needs HTTP/2 end to end, or a read from GCS over Private Google Access. That choice is
  the founder's.

### Part C — Core reads OCR by reference, and compile becomes asynchronous (contract and security change; the founder's)

- A `compile_request.v3` makes the inline `regions` (`nextjs/lib/core-runtime-v2.ts:318`) optional
  and adds `ocrSha256` beside `ocrObjectKey`. Core hashes the bytes it reads from R2 and fails the
  compile on a mismatch. A `v2` request stays valid.
- Core then needs an R2 read credential, which is a security decision.
- Dispatch follows ADR-0003's option 2, submit and then poll across turns
  (`docs/adr/0003-core-execution-budget-and-async-dispatch.md:77`), rather than a longer
  `maxDuration`, which only moves the ceiling.

### Part D — intake and metering (*agent* writes the migration and the code; applying the migration, and every price, is the founder's)

- One new migration, keeping a single head, replaces the five byte checks
  (`supabase/migrations/0051_intake_ceiling_and_gate_evidence.sql:47`, `:87`, `:131`;
  `supabase/migrations/20261003120000_intake_approval_budget_invariants.sql:72`, `:437`).
- The upload timeout scales with the size instead of being one constant. [calc] At the 43 KiB/s
  the code assumes (`nextjs/lib/upload-transfer.ts:58`), 50 MiB needs 1,190.7 s.
- OCR is metered per page instead of per document (`WORKER/src/ocr.ts:130`). The credit numbers are
  the founder's.

### Part E — the ceiling moves last

`shared/intakeCeiling.ts`, the processors' constants and the P2-18 cross-tree test change together,
in one commit that carries the stage's limit-measurement receipt (R7, `PLAN:334`). The receipt
records the seconds, bytes, pixels and memory each range used, and how the new number was derived
from them.

### Stages

No value in this table is fixed. Each is set by the measurement of the stage before it.

| Stage | Bytes | Pages | Needs |
| --- | --- | --- | --- |
| Today | 5 MiB | 80 | Nothing new. The P2-18 test is in, and T7 checks whether a full scan reaches 80 pages at all (`shared/intakeCeiling.ts:32-36`; `PLAN:132`) |
| Next | at most the documented 32 MiB HTTP/1 limit less framing, fixed from measured memory and time | measured with Parts A and B | Parts A, B and D (`PLAN:133`). Without Part C, the Core request body becomes the next bound |
| Target | 50 MB | 500 | Part C, the transfer decision in Part B, and approved concurrency and cost (`PLAN:134`) |

## What this does not change

- The whole-document path stays authoritative. The ranged path goes compatibility contract →
  shadow → benchmark → canary → rollout → deprecate, and replaces nothing until the Part A
  no-regression contract and a same-condition timing receipt both hold.
- No number in `shared/intakeCeiling.ts`, no manifest token, no `PROCESSING_CEILING_SENTENCE` and no
  commercial, intake or consent switch changes. This ADR touches nothing the posture lock (P2-01)
  reads.
- No table structure. Every region the reader emits is a paragraph (`GPU/app.py:398`,
  `GPU/app.py:436`, `nextjs/lib/core-runtime-v2.ts:84`). Reading by range does not change what a
  region is, and nothing here may be described as table extraction. Tables are a separate reader
  lane with its own contract (`shared/tableReadContract.ts`, P2-19) and their own Core ADR.
- No Protected Core module.

## Corrections to the plan

Three of the plan's citations do not match this tree. The numbers above use this tree.

- P2-18 added seven comment lines to `shared/intakeCeiling.ts` (`6debc5c1`). The plan's lines 25,
  27 and 33 for the ceiling (`PLAN:79`) are now `shared/intakeCeiling.ts:32`, `:34` and `:40`.
- The plan says the worker holds the original source twice, citing lines 559 and 602 of
  `ocr.ts` (`PLAN:80`). Those lines hold and wrap the sanitized PDF. The original is held at
  `WORKER/src/sanitize.ts:515` and wrapped at `:554`.
- The plan gives an A4 page as 501,156 px at scale 1.0 (`PLAN:83`). [calc] 595.28 × 841.89 is
  501,160, the value used above.

## Not verified

- The live rasterizer configuration. The worker points at `tavonel-cdr-validation-0909`
  (`WORKER/wrangler.jsonc:20`), and `CDR/service.yaml` is a declaration no agent applied.
- That Core V2 still runs from the project settings in
  `p0p2:infra/product-core/vercel/vercel.json:3` and `:6`, and which Vercel plan either project is on.
- That a Core request over 4.5 MB actually fails (`PLAN:92`).
- The RunPod load balancer's request and response size limits.
- The worker isolate's real memory use.
- Product-path OCR time for a scan as long as the ceiling allows. It is calculated, not measured
  (T7).
- The region payload of a dense source that fits inside 5 MiB (`shared/intakeCeiling.ts:32`). Both
  measured long documents are larger.

## Founder-only decisions

No agent decides these, and this ADR does not infer them from the plan. Each row names the plan's
decision (F) and the critic's merged decision (D).

| Decision | Default recommendation | Source |
| --- | --- | --- |
| **F5, D-27.** The architecture that raises the ceiling: Core reads OCR from R2, which puts an R2 read credential in Core; asynchronous compile, or a longer `maxDuration`, which depends on the Vercel plan (Pro allows up to 800 s, `PLAN:94`); and the transfer of a source above the documented 32 MiB, by HTTP/2 or by GCS Private Google Access | Reference read and asynchronous dispatch. Decide the large transfer after the next stage is measured | `PLAN:383`; `CRITIC:267` |
| **F6, D-28.** Per-page metering and its credits; today it is 2 credits per document (`WORKER/src/ocr.ts:130`) | Design the metering. Every number is the founder's | `PLAN:384`; `CRITIC:268` |
| **F7, D-29.** When `/sources`, the pricing copy, the manifest's `knownLimitations` and `preserved`, and `PROCESSING_CEILING_SENTENCE` change, which includes publishing any new ceiling | Together with the rollout receipt | `PLAN:385`; `CRITIC:269` |
| **F8, D-20.** Applying worker (wrangler), Cloud Run, RunPod and Supabase migration changes in operation, including rasterizer concurrency above one (a cost, `PLAN:87`) and an explicit `clamd.conf` (`CDR/README.md:208`) | Per stage, each with a receipt and a rollback ID. These are outside the delegation to merge to `main` | `PLAN:386`; `CRITIC:260` |
| **F9, D-30.** The product-path OCR timing run: synthetic scans of 10, 40 and 80 pages in an evaluation tenant, which spends GPU money | Approve, under the shared cap the critic proposes | `PLAN:387`; `CRITIC:270` |

## Work this unblocks

| Task | What | Founder decision | Source |
| --- | --- | --- | --- |
| T5 | Part A, code and tests | None to build; deploying it is F8. Not in this phase: the worktree has no worker toolchain, and a push of `workers/foundation-ocr-gpu/**` to `main` builds and publishes a GPU image (`.github/workflows/foundation-ocr-gpu-image.yml:8-12`) | `PLAN:397`; `CRITIC:126`; `CRITIC:174` |
| T7 | Product-path OCR timing | F9, D-30 (critic lane P2-36) | `PLAN:399`; `CRITIC:319` |
| T9 | Part C | F5, D-27 | `PLAN:401` |

## Evidence

- The receipts in the alias table, each with its sha256.
- `nextjs/lib/intake-ceiling-cross-tree.test.ts` (P2-18), which pins every constant this ADR
  proposes to move.
- A mechanical check of this document: every number sits beside a `path:line` or a receipt, every
  `path:line` is opened and matched to the value it supports, every receipt hash is recomputed,
  and every [calc] is recomputed from its receipt. The check and its result are
  `p2-20-adr-0004-check.mjs` and `P2-20-ADR-0004-CHECK.json` in the plan's receipt folder,
  `outputs/tavonel-research-replan-20261013/ux-program-20261017/`.
