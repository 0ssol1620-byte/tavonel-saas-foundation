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
  PDF it asks for range `[0, N)` first. A source that fits is stored exactly where a whole
  document goes. A longer one gets `segments/plan.json` (create-once page count), then each range
  is stored, receipted and read under `immutable/<ws>/<ws>/<doc>/segments/<start0>-<end0>/<v>/`,
  through the same read, retry, billing and review path as a whole document. `segments/manifest.json`
  is written only after every range has an `ocr.json`. **DOCX is not segmented** (#234 R1): its page
  count is Word's own saved number, or absent, so intake can only approve it at a count nobody
  verified or at 80. Reading it in ranges would process pages the approval never covered. A DOCX
  goes whole, and one over 80 pages is refused by the rasterizer as `PARSER_OOM` (released, 0
  credits) with the ceiling sentence on the source.
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
- **Reads only what was approved (F1, #238 review).** Intake approves and reserves a PDF the
  browser could not count at 80 pages, and the worker used to segment every PDF over 80 regardless,
  so such a PDF was read to 500 pages on an 80-page reservation. The capability route now writes
  `quarantine/<ws>/<doc>/approval.json` (`shared/sourceApproval.ts`, `tavonel.source_approval.v1`:
  approved pages, page basis, reserved and maximum credits) create-once, server-side, before any
  upload URL exists; a failed or conflicting write issues no URL (503 `SOURCE_APPROVAL_WRITE_FAILED`
  / `SOURCE_APPROVAL_CONFLICT`). No presigner signs that key. The worker reads it before
  segmenting; absent or invalid is 80. When the first range reports more pages than
  `max(approved, 80)`, the source is refused there -- before a plan, a range or any OCR exists --
  as `PARSER_OOM` (the frozen class set is unchanged) with `observedPages` and `approvedMaxPages`
  on `cdr-reject.json`, released at 0 credits through the ordinary refusal path. A stored plan is
  held to the same check. The workspace says "This PDF has N pages, more than the M pages approved
  for it, so it was stored but not compiled or charged." (the CDR did render the first range to
  learn N). When N is within the live PDF ceiling (80 with segmented intake off, 500 with it on) it
  adds "Upload it again and approve N pages." and offers that upload on the row, sending
  `estimatedPages = N`; above the ceiling it offers no upload and says to split the PDF, since that
  upload would only be refused 413 (#242 R1 P1, P2). A customer-stated count is safe to approve on
  because of this rule: too high only reserves more, too low is refused at zero.
- **Metering unchanged.** The source settles the per-document charge a whole document settles
  today (`computeCredits: 2`); intake still reserves and approves pages exactly as before. The
  trial bound (50 pages) is untouched.
- **Deletion.** Everything sits under the source's own prefix, so the existing deletion sweep
  removes a segmented source exactly as a whole one. Nothing under `segments/` has the
  `<doc>/<version>/<file>` shape `nextjs/lib/immutable-keys.ts` lists, so the site cannot show a
  range by accident. **Bound (E5):** at 80-page ranges a 500-page source is about 100 objects and
  at most about 460 MiB (7 × the 18 MiB sanitized, 24 MiB `ocr.json` and its page-range sidecars).
  The inventory used to be hashed in one 60 s request and attested in one call capped at 512
  objects and 1 GiB, so a deletion naming several long sources was refused on every run. Since
  migration `20261110043000` it is attested across runs: each run hashes at most 1 GiB or 15 s of
  objects no earlier run hashed and persists each digest as it goes
  (`source_deletion_inventory_digests`); once every listed object has a digest, the run lists
  again, requires the two listings and the persisted set to agree on every key and size, and seals
  the set by its database digest (`seal_source_deletion_inventory`), which refuses a set an
  overlapping run changed and then runs the unchanged attestation checks. A digest whose key is no
  longer listed, or is listed at another size or another ETag, discards the whole set. The bound is now per
  deletion: 16,384 objects and 64 GiB (128 documents × 128 objects, × 512 MiB; the listing, the
  digest table and the attestation all refuse past it), and 64 MiB per object as before. Listing
  identity is key, size and the listed R2 ETag (#238 review item 4), so a key rewritten at the same
  size between runs is hashed again, and the hash read refuses a served ETag other than the listed
  one.

### Site half (next change; the flag stays off until it lands)

1. `groupImmutableDocuments` reads `segments/manifest.json` and exposes a segmented source as one
   source whose readings are its ranges. ACL, tombstone and source-access checks stay keyed by
   the parent document id.
2. Compile carries each range as its own Core document (≤ 80 pages, the size every compile is
   sized for today) and the compile byte budget packs ranges across compile parts, so Core's
   4.5 MB request is never handed a whole manual.
3. Evidence keeps original page numbers: page = `start0` + the range's own page. The viewer opens
   the range's sanitized PDF at the local page.
4. Intake: `PROCESSING_CEILING.maxSourcePages` becomes 500 for a counted PDF once
   `shared/intakeCeiling.ts` `SEGMENTED_INTAKE_ENABLED` is true (every other format, DOCX included,
   and any file whose pages are not counted before upload stays at 80). The switch is a code
   constant, flipped in its own release in the same commit as the worker's
   `FOUNDATION_SOURCE_SEGMENT_PAGES` var in `wrangler.jsonc`; `intake-ceiling-cross-tree.test.ts`
   refuses a tree where the two disagree. While it is off the pricing fingerprint is production's,
   so no approval goes stale on deploy. One migration lifts the approval checks
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

The two halves roll back as a pair, in the reverse of the deploy order: revert the site build that
set `SEGMENTED_INTAKE_ENABLED = true` first, then the worker variable. Rolling back only the worker
leaves a site that admits 81–500-page PDFs in front of a worker that sends them whole, so every one
is approved, reserved and then refused as `PARSER_OOM` -- nothing charged, but every upload lost.
The site that writes `approval.json` must be live before the worker variable is set: with no
approval the worker holds every PDF to 80 pages, so an end-to-end check of an 81- or 300-page source
needs one uploaded through that site at its real count.

## Not measured

CDR render time and memory for an 80-page range of a long source; DOCX conversion time for a
300-page document (45 s limit, repeated per range); compile time for a corpus of ranges; worker
memory with a 5 MiB source held across several range requests.
