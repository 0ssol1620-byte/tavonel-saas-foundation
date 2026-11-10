# ADR-0006 — Segmented large sources

- **Status:** Accepted for the processor half (this branch, flag off). The site half is the next
  change and is specified below; until it lands, the flag stays off.
- **Date:** 2026-11-10
- **Branch:** `codex/large-source-segmentation-20261110`, from `main` `e46ec22d`.
- **Builds on:** ADR-0004 (page-range processing, Parts A and B), ADR-0005 (page metering).

## Why

On 2026-11-10 a paid Developer workspace uploaded a ZIP of 18 real device manuals (PDF and DOCX,
Korean and English). 12 were refused with `SOURCE_EXCEEDS_PROCESSING_CEILING`. The database shows
16 admitted and 6 confirmed: about ten were within 5 MiB and over 80 pages, so they were admitted,
uploaded and then refused by the rasterizer; about two were over 5 MiB. Manuals routinely run to
100–400 pages. This is the core use case.

## Where each limit is set, and whether anything measured it

| Limit | Value | Where | What stands behind it |
| --- | --- | --- | --- |
| Intake bytes (app) | 5 MiB | `shared/intakeCeiling.ts:32-36`; `nextjs/lib/r2-presign.ts:29`; `nextjs/app/api/uploads/capability/route.ts:68` | A copy of the two processors' constants below. Not measured (ADR-0004 B1) |
| Intake bytes (DB) | 5,242,880 | `supabase/migrations/0051_intake_ceiling_and_gate_evidence.sql:47`, `:87`, `:131`; `20261003120000_intake_approval_budget_invariants.sql:72`, `:437`; `20261110040000` (PR #228) restates the `_unchecked` body | A literal copy of the same constant (ADR-0004 B17) |
| Approval pages (DB) | 1–80; 10,240 per set | `20261003120000…sql:75`, `:438`; `20261003130000_intake_approval_file_cap.sql:14` | A copy of the rasterizer's 80 |
| Upload transfer | browser PUT straight to R2, 120 s | `nextjs/lib/upload-transfer.ts:62` | No Vercel body limit applies: bytes never pass through a function. The 120 s is sized to 5 MiB at an assumed 43 KiB/s (B18) |
| Worker source read | 5 MiB (`PARSER_OOM`) | `quarantine-sidecar/foundation-cdr-worker/src/keys.ts:4` | Constant. The real bound is the Cloudflare isolate, 128 MB, which holds the source and its multipart copy; unmeasured (B2) |
| Worker queue | batch 1, concurrency 3, 10 retries, 15-min wall | `quarantine-sidecar/foundation-cdr-worker/wrangler.jsonc` | Platform wall (15 min). 10 ranges × 85 s = 850 s fits one 80-page source |
| CDR input | 5 MiB + 64 KiB framing | `quarantine-sidecar/cdr-cloudrun/app.py:57`, middleware `max_body_bytes` | Constant. The platform bound above it is Cloud Run's 32 MiB HTTP/1 request (B3) |
| CDR pages | 80 | `app.py:59` | Constant. Only one refusal observed (B4) |
| CDR pixels | 80 M per document, 30 M per page | `app.py:62-63` | Constant. Already refuses A4 above ~160 pages without the page cap (B5) |
| CDR time / size | 120 s request, 2 vCPU / 4 GiB + clamd 2 vCPU / 4 GiB, max 3 instances, one request each | live `tavonel-cdr-validation-0909-00004-qsb` (read 2026-11-10) | Declared, not measured for long sources |
| GPU reader | 18 MiB, 80 pages | `workers/foundation-ocr-gpu/app.py:25-26` | Constant. RunPod `cohlugjzf0dk9i`: load balancer, ADA_24 (RTX 4090), 600 s timeout, 0–3 workers, `TAVONEL_OCR_PAGE_RANGES_ENABLED=true` (read 2026-11-10) |
| OCR request | 85 s, 8 pages per range | `src/ocr.ts:208`; `wrangler.jsonc` `FOUNDATION_OCR_PAGE_RANGE_SIZE` | **Measured**: GDP v3, 62 documents, 1,350 pages, 2.41 s/page; fit `9.88 + 1.955 × pages` s (`wrangler.jsonc` comment) |
| Compile request | 4.5 MB to Core V2, 9 MB of `ocr.json` per compile, 52 s turn | `nextjs/lib/core-runtime-v2.ts:28`; `nextjs/lib/collection-compile-run.ts:53`; ADR-0003 | Vercel's documented request body limit (platform). A 73-page dense scan already carries 4.28 MB of regions (ADR-0004 `FIT`) |

So: the 5 MiB and the 80 pages are one unmeasured constant each, copied into six places. The
limits that are real are platform limits further down: Cloud Run's 32 MiB request, the 128 MB
worker isolate, the 15-minute consumer wall, and Core V2's 4.5 MB request body. None of those
binds a 300-page manual of a few MiB **if the manual is never handled whole**.

## Decision

A source longer than one CDR request may render is processed as consecutive page ranges of at
most 80 pages, each an ordinary sanitized PDF with its own receipt and its own `ocr.json`. Every
processor keeps the per-request bound it has today. Nothing is raised to meet a target.

### Processor half (this branch)

- **CDR** (`app.py`). A request id ending `_p<start0>_<end0>` asks for that range only. The range
  is inside the signed id, so the signature and the replay guard cover it. A ranged request may
  read a document of up to 500 pages and renders at most `MAX_PAGES` of them under the unchanged
  pixel and output bounds; the answer carries `x-tavonel-cdr-source-pages` and the range actually
  rendered. An unranged request is unchanged. Tests: `tests/test_page_ranges.py`.
- **Worker** (`src/sanitize.ts`), behind `FOUNDATION_SOURCE_SEGMENT_PAGES` (unset = off). For a
  PDF or DOCX it asks for range `[0, N)` first. A source that fits is stored exactly where a whole
  document goes. A longer one gets `segments/plan.json` (create-once page count), then each range
  is stored, receipted and read under `immutable/<ws>/<ws>/<doc>/segments/<start0>-<end0>/<v>/`,
  through the same read, retry, billing and review path as a whole document. `segments/manifest.json`
  is written only after every range has an `ocr.json`. DOCX is converted inside the CDR on every
  range request and takes the same path; its pagination is expected to be stable for one input on
  one image, and if it is not, the page-count check below refuses the source.
- **Fail closed.** A refused range refuses the source and names the pages. A reader failure parks
  the source for review. A page count that changes between ranges is `RECEIPT_MISMATCH`. None of
  these writes a manifest, so no range is ever shown. A CDR revision that does not answer ranges
  is a retry, not a refusal, for a source of any length: the new CDR sends `x-tavonel-cdr-ranges: 1`
  on every refusal, and a refusal of a ranged request without it is our deploy order (an old CDR
  refuses past 80 pages), never the document (REVIEW-PR231-R1 E4).
- **Pinned to 80.** `FOUNDATION_SOURCE_SEGMENT_PAGES` is `80` or unset; any other value, the
  value without the `FOUNDATION_SEGMENT_CONTINUATION` producer, or the value together with
  `FOUNDATION_COMPLETED_READ_ENABLED=true` is a configuration error raised before any CDR request
  (E2, E3). The completed-read proof binds one sanitized PDF and one `ocr.json`; it does not cover a
  segmented source, so completed-read stays off while segmentation is on.
- **One new range per delivery, then a new message.** A delivery reads at most one range that has
  no `ocr.json` yet (one CDR request and that range's OCR: the work of today's whole 80-page
  document, up to 60 s + 10 × 85 s in the worst case, the same bound a whole document already has
  against the 15-minute wall). It then sends the source on as a new message on its own queue
  (producer `FOUNDATION_SEGMENT_CONTINUATION` in `wrangler.jsonc`) and acknowledges the old one. A
  new message starts at attempt 1, so the cold-start grace (`OCR_COLD_START_RETRY_DELAYS_S`) and
  `max_retries: 10` apply to each range, not to the whole source. A 500-page source is 7 messages
  (E1, E2).
- **Idempotent, at-least-once.** Every output is create-once and is found again by listing, so a
  redelivery continues from the first unread range and pays for no range twice. A redelivery after
  the manifest exists reads the manifest and returns it, without listing or hashing a single range,
  so a range stored twice by a racing duplicate cannot turn a finished source into a retry loop
  (E6). The source settles once, after its last range.
- **Metering unchanged.** The source settles the per-document charge a whole document settles
  today (`computeCredits: 2`); intake still reserves and approves pages exactly as before. The
  trial bound (50 pages) is untouched.
- **Deletion.** Everything sits under the source's own prefix, so the existing deletion sweep
  removes a segmented source exactly as a whole one. Nothing under `segments/` has the
  `<doc>/<version>/<file>` shape `nextjs/lib/immutable-keys.ts` lists, so the site cannot show a
  range by accident. **Bound (E5):** one deletion inventory is capped at 512 objects and 1 GiB
  (`nextjs/lib/source-deletion-inventory-r2.ts` `MAX_OBJECTS`, `MAX_TOTAL_BYTES`) and fails closed.
  At 80-page ranges a 500-page source is about 100 objects and at most about 460 MiB (7 × the 18 MiB
  sanitized, 24 MiB `ocr.json` and its page-range sidecars), so one source fits, but a deletion that
  names several long sources does not. The site-half PR makes deletion independent of that bound
  before the flag is set; until then the flag stays off.

### Site half (next change; the flag stays off until it lands)

1. `groupImmutableDocuments` reads `segments/manifest.json` and exposes a segmented source as one
   source whose readings are its ranges. ACL, tombstone and source-access checks stay keyed by
   the parent document id.
2. Compile carries each range as its own Core document (≤ 80 pages, the size every compile is
   sized for today) and the compile byte budget packs ranges across compile parts, so Core's
   4.5 MB request is never handed a whole manual.
3. Evidence keeps original page numbers: page = `start0` + the range's own page. The viewer opens
   the range's sanitized PDF at the local page.
4. Intake: `PROCESSING_CEILING.maxSourcePages` becomes 500 for PDF and DOCX (a format whose page
   count is unknown before upload stays at 80); one migration lifts the approval checks
   (`approved_max_pages` 80 → 500, the set cap 10,240 → 64,000) with pgTAP for both boundaries,
   built on the current production function bodies (PR #228's `_unchecked`), not on 0051.
5. `/pricing`, the drop box and `PROCESSING_CEILING_SENTENCE` change in the same build.

Bytes are a separate track. Above 5 MiB the worker's memory and, above about 32 MiB, Cloud Run's
HTTP/1 request bind; 50 MB needs either HTTP/2 end to end to the CDR or a read from object storage
inside the CDR's VPC. The processor half of that is "Large-source bytes" below, flag off; the
infrastructure decision is not taken here. D1 stage 1
(25 MiB, `RELEASE_ORDER.md` W2-D) remains the next byte step and composes with this.

## Copy, now

Shipped in this branch, with no processor change:

- The drop box states the per-source ceiling before a file is chosen (`compileLimitsNotice`).
- `/pricing` says which files are counted before upload and which are counted when read.
- The production upload path (approval lineage off) sends a PDF's page count, counted from its page
  tree in the browser, and the capability route refuses a PDF over the ceiling before a URL or a
  reservation exists. A ZIP is expanded in the browser (`nextjs/lib/workspace-intake.ts`), so a PDF
  inside one is counted and refused the same way. A DOCX `<Pages>` and a PPTX slide count are not
  sent (REVIEW-PR231-R1 B1): the first is what the last editor wrote and the CDR re-paginates, the
  second counts hidden slides the CDR's export leaves out, so either can be over 80 for a file that
  renders under it. Those formats, and a PDF the browser cannot open, are counted when read, and
  the refusal comes from the rasterizer with the reason on the source.

## Cost of a 300-page manual at current settings [calc, not a receipt]

- GPU: 38 ranges of 8 pages × (9.88 + 8 × 1.955) s ≈ 970 s on one RTX 4090 worker; at the ledger's
  $80.35/day for three workers ($0.00031/s each) ≈ **$0.30**, plus up to 120 s idle ≈ $0.04.
- Cloud Run: 4 range requests; render time per 80 pages is unmeasured. At 60 s each on the
  4 vCPU / 8 GiB instance (ledger $42.10/day for three, $0.00016/s) ≈ **$0.04**.
- About **$0.35 per 300-page source**, usage-based, scale to zero. No new recurring resource.

## Rollout and rollback

The CDR goes first. A worker with the flag set against an old CDR is retried, not refused (E4), but
it does no useful work. `FOUNDATION_COMPLETED_READ_ENABLED` must be unset or `false` whenever the flag
is set; the worker refuses the pair before any request (E3).

1. Deploy a CDR revision from this branch (ranges answered; unranged behaviour unchanged).
   Rollback: route traffic to `tavonel-cdr-validation-0909-00004-qsb`.
2. Merge the site half; apply its migration.
3. Upload the worker with `FOUNDATION_SOURCE_SEGMENT_PAGES=80` (its `wrangler.jsonc` already binds the
   `FOUNDATION_SEGMENT_CONTINUATION` producer); check one 81-page and one 300-page source end to end.
   Rollback: unset the variable (`wrangler versions deploy <prev>`). Ranges already stored stay
   invisible without a manifest and are deleted with their source.

## Not measured

CDR render time and memory for an 80-page range of a long source; DOCX conversion time for a
300-page document (45 s limit, repeated per range); compile time for a corpus of ranges; worker
memory with a 5 MiB source held across several range requests.

## Large-source bytes (processor half, flag off)

- **Status:** Implemented, inert by default, **not measured**. Branch `codex/large-source-bytes-20261110`,
  stacked on PR #231. Intake, `r2-presign.ts` and the DB admission check stay at 5 MiB until the
  measurement below exists. Nothing here is proven by the tests: they show the code does what it
  says, not that a 50 MiB source fits the deployed services.

### The three ways to get 50 MiB to the CDR

Today `sanitizeObject` reads the whole R2 object (`arrayBuffer()`), hashes it, and `requestDisarm`
builds a multipart `FormData` copy for every request, including every ranged request of a segmented
source. The isolate (128 MB) also holds the sanitized answer: up to 18 MiB, twice while it is
assembled, and once more when `verifiedImmutable` reads it back.

| | (a) HTTP/2 end to end, streamed body | (b) CDR reads a presigned GET **(chosen)** | (c) Stage through GCS read in the VPC |
| --- | --- | --- | --- |
| Worker memory at 50 MiB | O(chunk) only if the worker hashes in one streamed R2 pass and streams a hand-built multipart body from a second; today's code would hold 50 MiB + its copy + the answer, over 128 MB | O(chunk): one streamed pass through `crypto.DigestStream`; the request body is ~1 KiB. Peak is the sanitized answer, as today | O(chunk), plus a streamed upload to GCS |
| Cloud Run 32 MiB HTTP/1 limit | Lifted only with `--use-http2`, which needs an h2c server: uvicorn has none, so the server becomes hypercorn for every request, small ones included | Not reached: the request is ~1 KiB | Not reached |
| Egress / credentials | No CDR egress; no new credential | CDR makes one HTTPS GET to `<account>.r2.cloudflarestorage.com` before parsing, URL-allowlisted to the quarantine prefix, no redirect, no proxy. CDR holds no credential; the URL reads one object for 300 s. The worker gains an R2 token with **Object Read only on this bucket** | Worker needs a GCS write credential; the CDR's runtime service account needs read on a bucket holding every tenant's staged source: the broad credential this must avoid |
| Code | New server dependency (licence intake row), Dockerfile `CMD` swap with no off switch, streamed multipart builder in the worker | CDR +1 route (~110 lines, stdlib `urllib`); worker +1 module (~130 lines) | New bucket, lifecycle, IAM, two clients |
| Config | `gcloud run services update --use-http2` + port `h2c` + image | One CDR env var; two worker vars, two worker secrets, one R2 token | Bucket, IAM, worker secret |

**Choice: (b).** It is the only option whose off path is the current code byte for byte (a separate
route and a separate flag; (a) swaps the server under every request), it never puts more than one
chunk of the source in the isolate, it never approaches the 32 MiB request limit, and every line of
it is testable here without an HTTP/2 stack. Its cost is egress: the CDR process that parses hostile
documents gets a route to R2. The live revision's egress is read before anything else (operator step
1); `service.yaml`'s Direct VPC with no Cloud NAT is not assumed applied (README "Egress"). **If that
hardening is live, or is required before 50 MiB ships, (b) is the wrong choice and (a) is the
fallback**, because a NAT plus an egress allow-list for R2 is new recurring spend and a wider network
path than (a) needs.

### What is built

- **Worker** (`src/remote-source.ts`, `sanitize.ts`). `FOUNDATION_SOURCE_TRANSPORT` unset is today's
  path. `presigned` raises the worker's byte cap to `LARGE_SOURCE_MAX_BYTES` (50 MiB, `keys.ts`), hashes
  the object as a stream (`crypto.DigestStream`; its absence is a configuration error, never a fall
  back to `arrayBuffer()`), and posts the same four signed headers to `/v1/disarm-remote` with three
  form fields: `source_url` (a SigV4 presigned GET for exactly that key, 300 s, minted per request),
  `filename`, `content_type`. A ranged request does the same, so segmentation works unchanged.
  Configuration errors, raised before the source is read or a CDR request is paid for: any other
  value; a missing or malformed `FOUNDATION_R2_ACCOUNT_ID`; a missing
  `FOUNDATION_R2_READ_ACCESS_KEY_ID` / `FOUNDATION_R2_READ_SECRET_ACCESS_KEY`;
  `FOUNDATION_CDR_TEXT_LAYER_FIRST` on (the D2 shadow posts the source bytes).
- **CDR** (`app.py`). `/v1/disarm-remote` is `/v1/disarm` with the bytes read from the URL instead of
  the body: same signature check, replay guard, digest comparison, scan, conversion, range and render
  bounds, same response. Off unless `TAVONEL_CDR_REMOTE_SOURCE_PREFIX` is
  `https://<host>/<bucket>/quarantine/` (anything else refuses the boot). A URL outside that prefix,
  with another key shape, other query parameters, or `X-Amz-Expires` over 900 is refused before a
  connection opens. The read is bounded by `LARGE_SOURCE_MAX_INPUT_BYTES` (50 MiB) and hashed while it
  is written to disk, exactly as an upload is. The upload route keeps the stage bound (5 MiB).
- **Fail closed.**

  | Event | CDR answer | Worker |
  | --- | --- | --- |
  | Source over 50 MiB | (worker refuses first) / 413 `CDR source exceeds the controlled-beta size limit` | `PARSER_OOM`, named, no CDR call when R2's size says so |
  | Bytes read ≠ signed digest | 422 `CDR source digest does not match the uploaded body` | `RECEIPT_MISMATCH` |
  | URL expired or refused by R2, redirect, store unreachable, cut short | 502 | retry |
  | Route off, URL not qualified | 503 | retry |
  | CDR revision without the route (404, no `x-tavonel-cdr-remote-source` marker) | — | retry (deploy order) |
  | Stream shorter or longer than R2's size, stream error | — | retry |

  The URL is not covered by the HMAC. What it can name is bounded anyway: an object under the
  configured quarantine prefix that the worker presigned, whose bytes must hash to the signed digest.
- **Pinned.** `shared/intakeCeiling.ts` states both 50 MiB copies (`LARGE_SOURCE_TARGET_BYTES`, read by
  no stage) and `nextjs/lib/intake-ceiling-cross-tree.test.ts` pins them; the same test fails if
  `service.yaml`, the Dockerfiles or `wrangler.jsonc` set either flag, so turning it on edits that line
  in a reviewed change.
- **Tests.** Worker `src/remote-source.test.ts` (11): config refusals; SigV4 equal to AWS's published
  example; the URL shape the CDR accepts; streamed hash, length mismatch and missing `DigestStream`; a
  50 MiB source admitted with `arrayBuffer()` throwing and no blob in the request; 50 MiB + 1 refused
  with no read and no call; digest refusal; 502, 503, unmarked 404 and network failure retried; the
  shadow conflict; a 200-page source in three deliveries, a URL per range; the off path still posting
  the source to `/v1/disarm`. CDR `tests/test_remote_source.py` (13): off by default; boot validation;
  read once and disarmed; 50 MiB admitted while the upload route still answers 413; declared and
  undeclared oversize; digest mismatch; eleven unqualified URLs never opened; store failures are 502
  and never echo the URL; unsigned requests never reach the store; a ranged request; the real opener
  reads and refuses to follow a redirect.

### Operator steps (not run by an agent; the coordinator applies infrastructure)

Names used below: project `tavonel-saas-foundation`, region `asia-northeast3`, service
`tavonel-cdr-validation-0909`, bucket `tavonel-saas-foundation-quarantine`, `<ACCOUNT_ID>` the
Cloudflare account id (32 hex), `<HEAD>` the merged commit.

1. **Read the live CDR first; stop if it is egress-locked.**

   ```bash
   gcloud run services describe tavonel-cdr-validation-0909 --project tavonel-saas-foundation \
     --region asia-northeast3 --format=yaml > cdr-0909-before.yaml
   grep -nE 'vpc-access-egress|network-interfaces|image:|revisionName|memory|cpu|timeoutSeconds' cdr-0909-before.yaml
   ```

   Record the serving revision as `<PREV_REVISION>` in the campaign ledger (rollback target). If
   `vpc-access-egress: all-traffic` is present, the CDR cannot reach R2: do not continue; take (a).

2. **R2 read token (founder types the values).** Cloudflare dashboard → R2 → Manage API tokens →
   Create: permission **Object Read only**, bucket **tavonel-saas-foundation-quarantine** only. Then,
   from `quarantine-sidecar/foundation-cdr-worker` (each prompts for the value; never put it in vars,
   files or chat):

   ```bash
   npx wrangler versions secret put FOUNDATION_R2_READ_ACCESS_KEY_ID
   npx wrangler versions secret put FOUNDATION_R2_READ_SECRET_ACCESS_KEY
   ```

   These create versions without deploying them, and are inert while `FOUNDATION_SOURCE_TRANSPORT` is
   unset. Rollback: revoke the token in the dashboard.

3. **CDR revision with the route on.** The route only answers a worker that asks for it, so this
   revision serves today's traffic unchanged. `<IMAGE_REPO>` is the repository of the image in
   `cdr-0909-before.yaml`. CPU, memory, timeout, concurrency and scale are restated at their current
   values, not changed: the measurement decides whether they move.

   ```bash
   cd quarantine-sidecar/cdr-cloudrun
   gcloud builds submit --project tavonel-saas-foundation --region asia-northeast3 \
     --tag <IMAGE_REPO>:large-bytes-<HEAD> .
   gcloud run deploy tavonel-cdr-validation-0909 --project tavonel-saas-foundation --region asia-northeast3 \
     --timeout 120 --concurrency 1 --max-instances 3 \
     --container cdr --image <IMAGE_REPO>@sha256:<BUILT_DIGEST> --cpu 2 --memory 4Gi \
     --update-env-vars TAVONEL_CDR_REMOTE_SOURCE_PREFIX=https://<ACCOUNT_ID>.r2.cloudflarestorage.com/tavonel-saas-foundation-quarantine/quarantine/ \
     --container clamd --cpu 2 --memory 4Gi
   ```

   No `--use-http2`, no new secret (the CDR holds no R2 credential). Check: `/health` answers
   `"remoteSourceMaxBytes": 52428800`; one ordinary small source still processes. Rollback:

   ```bash
   gcloud run services update-traffic tavonel-cdr-validation-0909 --project tavonel-saas-foundation \
     --region asia-northeast3 --to-revisions <PREV_REVISION>=100
   ```

4. **Worker version with the transport on, not deployed.** No `wrangler.jsonc` edit is needed for
   the measurement:

   ```bash
   cd quarantine-sidecar/foundation-cdr-worker
   npx wrangler versions upload --preview-alias large-bytes \
     --var FOUNDATION_SOURCE_TRANSPORT:presigned --var FOUNDATION_R2_ACCOUNT_ID:<ACCOUNT_ID>
   ```

   A version that is uploaded and not deployed consumes no queue message. If the worker has no
   preview URL, this step and step 5 need a quiet window with the version deployed at 100% and
   step 7's rollback ready.

5. **The measurement (before the 5 MiB admission check may move).** One synthetic, non-customer 50 MiB
   PDF of more than 80 pages (so the segmented path runs; it re-reads 50 MiB per range), placed by the
   operator because intake still refuses it:

   ```bash
   npx wrangler r2 object put tavonel-saas-foundation-quarantine/quarantine/<MEASURE_WS>/<MEASURE_DOC>/source \
     --file manual-50mib.pdf --content-type application/pdf --remote
   curl -sS -X POST https://large-bytes-tavonel-foundation-cdr.<SUBDOMAIN>.workers.dev/v1/sanitize \
     -H "authorization: Bearer $FOUNDATION_MANUAL_TRIGGER_TOKEN" -H 'content-type: application/json' \
     -d '{"objectKey":"quarantine/<MEASURE_WS>/<MEASURE_DOC>/source"}'   # repeat until the manifest exists
   npx wrangler tail tavonel-foundation-cdr --format json > worker-tail.jsonl   # in parallel; or that version's Workers Logs
   gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="tavonel-cdr-validation-0909" AND httpRequest.requestUrl:"/v1/disarm-remote"' \
     --project tavonel-saas-foundation --freshness 1h --format json > cdr-requests.json
   ```

   The receipt, under `docs/evidence/artifacts/` with sha256s: the source's sha256 and size; each
   range's `cdr-receipt.json` and `ocr.json` keys and digests, and `segments/manifest.json`; per CDR
   request the latency from `cdr-requests.json` against the worker's 60 s CDR timeout and Cloud Run's
   120 s; CDR memory and CPU per container (`run.googleapis.com/container/memory/utilizations`,
   container `cdr` and `clamd`) against 4 GiB; the clamd scan time (`x-tavonel-malware-scan`
   `durationMs`) against `CLAMD_READ_TIMEOUT_SECONDS` 20; and `worker-tail.jsonl` showing no
   `exceededMemory` / `exceededCpu` outcome. Cloudflare reports no per-invocation memory, so the worker
   bound is the code's (`arrayBuffer()` never called, test above) plus that outcome; that is stated in
   the receipt, not rounded up to a number. The manual route settles the source, and a source with no
   intake reservation may be refused by settlement; its answer is recorded, not part of the proof.
   Then delete the measurement objects (`immutable/<MEASURE_WS>/…`, `quarantine/<MEASURE_WS>/…`).

6. **Turn it on for traffic** (only after step 5's receipt and the preconditions below). `wrangler.jsonc`:

   ```diff
   -    "FOUNDATION_OCR_PAGE_RANGE_SIZE": "8"
   +    "FOUNDATION_OCR_PAGE_RANGE_SIZE": "8",
   +    // Large-source bytes (ADR-0006): the CDR reads each source from R2 through a presigned GET.
   +    // Needs the dashboard secrets FOUNDATION_R2_READ_ACCESS_KEY_ID / FOUNDATION_R2_READ_SECRET_ACCESS_KEY
   +    // (Object Read only, this bucket) and a CDR revision with TAVONEL_CDR_REMOTE_SOURCE_PREFIX.
   +    "FOUNDATION_SOURCE_TRANSPORT": "presigned",
   +    "FOUNDATION_R2_ACCOUNT_ID": "<ACCOUNT_ID>"
      },
   ```

   with the matching edit to the `FOUNDATION_SOURCE_TRANSPORT` line in
   `intake-ceiling-cross-tree.test.ts`, then:

   ```bash
   npx wrangler versions upload
   npx wrangler versions deploy <NEW_VERSION_ID>@100% --yes
   ```

7. **Rollback** (worker): `npx wrangler versions deploy <PREV_VERSION_ID>@100% --yes`. Sources between
   5 and 50 MiB admitted meanwhile (none, while intake stays at 5 MiB) would then be refused
   `PARSER_OOM` by the 5 MiB cap, with a receipt. CDR rollback is step 3's. R2 token: revoke.

### Preconditions for moving the 5 MiB admission check

1. Step 1 shows the live CDR can reach R2, and the network posture is accepted as is (or (a) is built
   instead).
2. Step 5's receipt exists and every number in it is inside its bound: CDR request time under the
   worker's 60 s per request (or the timeout and the 15-minute wall arithmetic move together, in the
   same change); CDR memory under 4 GiB per container; scan time under 20 s; no worker memory or CPU
   exceeded outcome.
3. clamd accepts a 50 MiB `INSTREAM` (its `StreamMaxLength` is the image's default; a refusal there
   is a 503 that retries forever, so it is checked by the measurement, not assumed).
4. A 50 MiB DOCX is measured too, or DOCX stays at the old bound: conversion runs once per range, and
   `MAX_OFFICE_PACKAGE_UNCOMPRESSED_BYTES` (64 MiB) may refuse a large package by name.
5. Per-range output stays within `MAX_OUTPUT_BYTES` (18 MiB) for the measured source, so the GPU
   reader's 18 MiB input is unchanged; a dense 50 MiB scan that exceeds it is refused `PARSER_OOM`
   by range, which is the per-request bound working, not a byte-intake failure.
6. The site half: the browser PUT timeout (`nextjs/lib/upload-transfer.ts`, 120 s sized to 5 MiB at
   43 KiB/s) is re-derived for 50 MiB; a new intake stage in `shared/intakeCeiling.ts` carries the
   50 MiB (with `r2-presign.ts`, the capability route and `/pricing` following it); one migration
   moves the DB admission checks (`0051`, `20261003120000`, PR #228's `_unchecked`) with pgTAP at both
   boundaries; the deletion inventory bound (1 GiB) is re-checked for 50 MiB sources.
7. An independent reviewer approves the processor change and the receipt with zero blockers.

### Not measured

Everything in step 5. In particular: R2 → Cloud Run read time for 50 MiB; whether the live revision
has egress to R2; clamd's stream limit and scan time at 50 MiB; DOCX conversion of a 50 MiB package;
the worker's real peak memory (only its code path is shown).
