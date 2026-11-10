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
  is a retry, not a refusal (it is our misconfiguration).
- **Idempotent, at-least-once.** Every output is create-once and is found again by listing, so a
  redelivery continues from the first unread range and pays for no range twice. A delivery starts
  no new range after five minutes and leaves the rest to a redelivery (`message.retry`); the
  source settles once, after its last range.
- **Metering unchanged.** The source settles the per-document charge a whole document settles
  today (`computeCredits: 2`); intake still reserves and approves pages exactly as before. The
  trial bound (50 pages) is untouched.
- **Deletion.** Everything sits under the source's own prefix, so the existing deletion sweep
  removes a segmented source exactly as a whole one. Nothing under `segments/` has the
  `<doc>/<version>/<file>` shape `nextjs/lib/immutable-keys.ts` lists, so the site cannot show a
  range by accident.

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
inside the CDR's VPC. That is an infrastructure decision and is not taken here. D1 stage 1
(25 MiB, `RELEASE_ORDER.md` W2-D) remains the next byte step and composes with this.

## Copy, now

Shipped in this branch, with no processor change:

- The drop box states the per-source ceiling before a file is chosen (`compileLimitsNotice`).
- `/pricing` says which files are counted before upload and which are counted when read.
- The production upload path (approval lineage off) sends the page count the browser already
  measured, and the capability route refuses a counted file over the ceiling before a URL or a
  reservation exists. Files inside a server-expanded ZIP are not counted before upload; for them
  the refusal still comes from the rasterizer, with the reason on the source.

## Cost of a 300-page manual at current settings [calc, not a receipt]

- GPU: 38 ranges of 8 pages × (9.88 + 8 × 1.955) s ≈ 970 s on one RTX 4090 worker; at the ledger's
  $80.35/day for three workers ($0.00031/s each) ≈ **$0.30**, plus up to 120 s idle ≈ $0.04.
- Cloud Run: 4 range requests; render time per 80 pages is unmeasured. At 60 s each on the
  4 vCPU / 8 GiB instance (ledger $42.10/day for three, $0.00016/s) ≈ **$0.04**.
- About **$0.35 per 300-page source**, usage-based, scale to zero. No new recurring resource.

## Rollout and rollback

1. Deploy a CDR revision from this branch (ranges answered; unranged behaviour unchanged).
   Rollback: route traffic to `tavonel-cdr-validation-0909-00004-qsb`.
2. Merge the site half; apply its migration.
3. Upload the worker with `FOUNDATION_SOURCE_SEGMENT_PAGES=80`; check one 81-page and one
   300-page source end to end. Rollback: unset the variable (`wrangler versions deploy <prev>`).
   Ranges already stored stay invisible without a manifest and are deleted with their source.

## Not measured

CDR render time and memory for an 80-page range of a long source; DOCX conversion time for a
300-page document (45 s limit, repeated per range); compile time for a corpus of ranges; worker
memory with a 5 MiB source held across several range requests.
