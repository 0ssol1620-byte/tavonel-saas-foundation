# ADR-0005 — What a standard page is, and how it is metered before any price binds to it

- **Status:** Proposed. Nothing in this document is implemented. It changes no price, no credit
  constant, no plan quantity, no ledger function, no migration, no public sentence and no
  commercial, intake or consent switch. The register row also asks for shadow meter code. That
  code is not written here; it is the first row of [Work this unblocks](#work-this-unblocks).
- **Date:** 2026-10-19. Drafted 2026-10-17, the date of the register and of the adoption it records.
- **Branch this was written on:** `codex/records-20261017`, on top of `main` `4c80bb30`.
- **Register row:** D-28 (aliases T-F6), "페이지 단위 과금". Adopted default: "페이지 계량 설계를
  지시한다. 숫자는 창업자가 정한다" (`REG:37`; `REGJ` row `D-28`). The founder adopted every register
  default on 2026-10-17 ("파운더 결정은 모두 실서비스에서 업계 1위 될 수 있도록 너가 추천한 방향으로
  진행해서 완료할 수 있도록해줘", quoted at `REG:3`). That message adopts the default *direction*. It
  approves no wording and sets no number.
- **Decision owner:** the founder, for every row under [Numbers only the founder sets](#numbers-only-the-founder-sets)
  and [Founder-only steps](#founder-only-steps). The parts marked *agent* may be built as code and
  tests without a founder decision. None of them may be deployed or applied without one.
- **Sibling:** ADR-0004, page-range processing and the ceiling, is on branch
  `codex/ux-tab-20261017` and not on `main` (`ADR4`). Its row B19 and Part D name this decision and
  leave it here.

## The question

The pricing page sells a plan in pages, and the ledger charges per document. D-28 asks for a page
meter. Four things have to be settled before any number is chosen:

1. What one "standard page" is.
2. Where pages are already counted, and which count is trustworthy enough to charge on.
3. How a metered page is recorded: once per document, internal only.
4. How the meter runs in shadow, with zero billing effect, until the founder binds a price to it.

## Sources, and how to read a number here

Every number in this ADR sits beside one of three kinds of source.

- A `path:line` in this tree. Paths are repo-relative. As in ADR-0004, `WORKER/` is
  `quarantine-sidecar/foundation-cdr-worker/`, `CDR/` is `quarantine-sidecar/cdr-cloudrun/` and
  `GPU/` is `workers/foundation-ocr-gpu/`. A bare `:line` refers to the last path before it.
- An `ocr-branch:path:line` on branch `codex/ocr-page-range-20261017` at `de305b10` (T5 and its
  fixes, not on `main`, not deployed; `T5`).
- A receipt alias from the table below, followed by the field that holds the value.

**[calc]** marks arithmetic on sourced numbers. Arithmetic is not measurement.

No number here is a public claim, and none may be quoted as one. `T7` and `SWEEP` are internal
diagnostics over SYNTHETIC documents (`T7` `recordLabel`). Neither has OCR gold, and a region count
is not accuracy.

| Alias | File | sha256 |
| --- | --- | --- |
| `T7` | `outputs/tavonel-research-replan-20261013/ux-program-20261017/table-limits-receipts/PRODUCT-PATH-OCR-TIMING.json` | `7c5b1fe10b8d5dc16f81816c92870f5ad99ed11b773d0edc47ccefc5de872a5b` |
| `SWEEP` | `outputs/tavonel-research-replan-20261013/ux-program-20261017/table-limits-receipts/t7-synthetic/CDR-PIXEL-BUDGET-SWEEP.json` | `37df5731ede2c4d9fb6f08c3f695eb7813a5aec3de6ea85f053218af0eece797` |
| `T5` | `outputs/tavonel-research-replan-20261013/ux-program-20261017/core-lanes/T5/RECEIPT.json` | `4539740e67dbc47d3b438cca7f96046ded9cbb47145781e310ee280fe9d60909` |
| `REG` | `outputs/tavonel-research-replan-20261013/ux-program-20261017/DECISION-REGISTER-2026-10-17.md` | `5935276d245d230857fa632dcb6555d25756470d37f404fc6c3c00dc71d7c6dc` |
| `REGJ` | `outputs/tavonel-research-replan-20261013/ux-program-20261017/DECISION-REGISTER-2026-10-17.json` | `86234c9397cec2d0ac8160276e525943857e7b2ec21e5e3a3b9891cc394120d3` |
| `SD` | `outputs/tavonel-research-replan-20261013/ux-program-20261017/SERVICE-DEFINITION-2026-10-17.md` | `c7783dd718713b7564697ce6df7e6abbad9ffc2489624b3ad3705e610b528dee` |
| `PLAN` | `outputs/tavonel-research-replan-20261013/ux-program-20261017/TABLE-EXTRACTION-AND-LIMITS-DESIGN-2026-10-17.md` | `09e20ffed8904fa0cea70c3454604b836df00a47df5c5cffe795dd22ba77c132` |
| `CRITIC` | `outputs/tavonel-research-replan-20261013/ux-program-20261017/PHASE1-CRITIC-2026-10-17.md` | `667010c53a226f980241fc61b3581112cabae954867affc35e24eebf3f8efa81` |
| `ADR4` | `docs/adr/0004-page-range-processing-and-ceiling.md` on `codex/ux-tab-20261017` (worktree `fnd-UX-tab`) | LF-normalised `c28bd546321e0af5a4f37c917a9edc5748c812bb8d7f0535aa7bb7282339225c`, as `P2-20-ADR-0004-CHECK.json` records it |

The `outputs/` paths are relative to the Core working tree, `D:/CodexProjects/ai-knowledge-compiler`.
They are not in this repository.

This ADR quotes no price, no credit amount per page and no plan quantity. Where the code holds one,
the constant is named and cited, and its value is left in the code. The one credit figure it repeats
is the existing per-document ledger constant, spelled as the code spells it (`computeCredits: 2`,
the `0 | 2` wire type, `settled_credits = 2`), because a bound meter has to replace exactly those
literals.

## What is there today

### Where a page is counted

| ID | Stage | What is counted | Where | What kind of fact |
| --- | --- | --- | --- | --- |
| P0 | Intake ceiling | `PROCESSING_CEILING.maxSourcePages`, a copy of the rasterizer's `MAX_PAGES` | `shared/intakeCeiling.ts:28-29`; `:35`; `CDR/app.py:52` | A ceiling, not a count. Intake "deliberately never decodes the document", so the page ceiling is "disclosed rather than enforced" (`shared/intakeCeiling.ts:19-21`). It is also the fallback for a file whose format states no count (P1, `nextjs/lib/usage-pricing.ts:177-179`) |
| P1 | Intake quote | A page count the client claims, with a basis: `pdf_page_tree`, `image`, `pptx_slides` or `docx_declared`. A format that states no count gets the processing ceiling | `nextjs/lib/usage-pricing.ts:50-54`; `:230-263`; `:177-179` | A claim. `docx_declared` is "a *claim by another program*" (`nextjs/lib/usage-pricing.ts:39-40`) |
| P2 | Upload capability (legacy path) | The larger of the client's number and the server's ceiling fallback | `nextjs/app/api/uploads/capability/route.ts:259-265` | A reservation size, "not a page count" (`:254`) |
| P3 | Approval row | `page_basis` and `approved_max_pages`, held between 1 and 80; an `unknown` basis must equal 80 | `supabase/migrations/20261003120000_intake_approval_budget_invariants.sql:75`; `:95` | A ceiling the customer approved |
| P4 | Reservation | Pages × `STANDARD_UNITS_PER_PAGE` held, pages × `MAX_UNITS_PER_PAGE` as the maximum. One reservation per document | `nextjs/lib/compute-reservation.ts:670`; `:685-686`; `nextjs/lib/usage-pricing.ts:113-124`; `supabase/migrations/0009_foundation_billing_compute_reservations.sql:15` | A hold, in credits |
| P5 | Rasterizer | `len(source_doc)`, refused outside 1 to `MAX_PAGES`; then a pixel total under a document budget | `CDR/app.py:591-593`; `:52`; `:603-620` | An observation. It never leaves the rasterizer: the clean response carries digests and a scan record, no page count (`CDR/app.py:742-746`), and `rasterize_to_pdf` returns the byte size (`CDR/app.py:726`) |
| P6 | GPU reader | `len(document)` of the sanitized PDF, refused outside 1 to `MAX_PAGES` | `GPU/app.py:551-554`; `GPU/app.py:25` | An observation of the same bytes the worker sent |
| P7 | OCR result | `pageCount`, an integer from 1 to 80 | `WORKER/src/ocr.ts:388-390` | The reader's observation, qualified |
| P8 | Persisted result | `observedPageCount: result.pageCount`, beside `outputSha256` and `computeCredits: 2` | `WORKER/src/ocr.ts:128-130` | The page count is observed. The charge ignores it |
| P9 | Settlement | `actualCredits` typed `0 \| 2`. The page count travels only inside the flag-gated completed-read proof, capped at 80, which also requires `actualCredits === 2` | `WORKER/src/settlement.ts:68`; `WORKER/src/index.ts:84`; `shared/completedReadReceipt.ts:50`; `:66`; `WORKER/src/settlement.ts:84-85`; `nextjs/app/api/internal/billing/settle/route.ts:118` | "Pages are observations; credits remain the fixed 0\|2 ledger facts" (`shared/completedReadReceipt.ts:1`) |
| P10 | Ledger | One settlement per reservation. A repeat with the same state and credits is a duplicate; anything else conflicts. The completed-read proof table, still a draft migration, holds `settled_credits = 2` | `supabase/migrations/20260911120000_compute_settlement_expired_terminal.sql:64-73`; `supabase/drafts/migrations/20261005130000_foundation_completed_read_proof.sql:32` | Idempotent per document, in credits |
| P11 | Trial quota | The trial's `page_limit` multiplied by a literal copy of `STANDARD_UNITS_PER_PAGE`, compared with reserved plus settled credits | `supabase/migrations/0046_trial_reservation_lifetime_guard.sql:28`; `:35-48`; `supabase/migrations/20260911120000_compute_settlement_expired_terminal.sql:99-103` | Pages, converted to credits |
| P12 | Plan catalog | `includedPages`, rendered as "… verified standard pages" | `nextjs/lib/billing-catalog.ts:28`; `:33`; `:45`; `:72` | A public sentence. Row D-07 handles its wording (`REG:27`), and `SD:193` records that no format is verified |

### Three units that do not agree

1. **The quote is in pages. The settlement is per document.** A reservation holds credits per page
   (P4). OCR settles the per-document constant `computeCredits: 2` whatever the length
   (`WORKER/src/ocr.ts:130`), which is ADR-0004's row B19 (`ADR4`). The settlement releases the
   rest of the hold (`supabase/migrations/20260911120000_compute_settlement_expired_terminal.sql:115`).
   The ledger function itself already accepts any amount up to the reservation's maximum
   (`supabase/migrations/20260911120000_compute_settlement_expired_terminal.sql:47`; `:120-121`), so
   the per-document constant is held in the worker's wire type, the settle route's completed-read
   check and the draft proof table (P9, P10), not in the ledger function.
2. **The trial quota counts documents while saying pages.** Each settled document adds the
   per-document constant to the trial total, and the quota compares that total with pages
   converted to credits (P11). [calc] Once settled, a document of any length counts against the
   trial's page quota as the same amount, so the quota bounds documents rather than pages. The
   trial's file limit binds first anyway (`supabase/migrations/0045_self_service_trial_and_owner_access.sql:40-42`;
   enforced at `:321-322`).
3. **The published "complex page" has no observer.** `/pricing` says complex-page processing is
   capped and shown before the run (`nextjs/components/pricing-page-client.tsx:246`).
   `MAX_UNITS_PER_PAGE` is used only to quote that cap (`nextjs/lib/usage-pricing.ts:5`; `:116`;
   `:309`). A search for `complex` page or `MAX_UNITS_PER_PAGE` in the worker, rasterizer, reader and
   SQL finds nothing that classifies a page.

No repository document defines "standard page". The phrase appears in public copy, the trial terms
and the catalog (P12, `supabase/migrations/0045_self_service_trial_and_owner_access.sql:5`), and
nowhere in a decision record.

### What the T7 timing receipt says about a page

T7 sent SYNTHETIC dense scans through the request shape the worker uses (`T7` `requestPath.source`)
to a GPU reader running the production image digest (`T7` `endpoint.image`). It was a test
endpoint, not the production endpoint (`T7` `endpoint.productionEndpointTouched`).

- **Time per page is close to constant at one density.** Warm, document mode, the reader spent
  2.316 to 2.689 s of execution per page (`T7` `aggregates.documentModeFit85s.executionSecondsPerPageRange`).
  80 pages took 218.507 s and 10 pages took 25.970 s, both from direct input (`T7` `runs[3].totalSeconds`,
  `runs[4].totalSeconds`). [calc] Eight times the pages took 8.41 times the time, under one
  unchanged per-document charge (`WORKER/src/ocr.ts:130`).
- **Splitting does not create pages.** Eight 10-page ranges of the 80-page input took 202.142 s in
  total, no request above 85 s (`T7` `aggregates.range10_80p`). Ten one-page requests took 31.279 s
  against 27.825 s for the same 10 pages in one request (`T7` `aggregates.page1_10p`). The extra
  time is per request, not per page.
- **One density only.** Every run read about 147.6 regions per page (`T7` `runs[1].regionsPerPage`),
  and T7 lists "densities other than ~148 regions/page" as not proven (`T7` `notProven`). Whether
  region density changes the cost of a page is unmeasured.
- **A cold request was never answered.** Both requests that triggered a cold start got no answer
  from the test endpoint (`T7` `coldStart.reading`), and T7 says this shows nothing about the
  production cold path. A failed attempt reads no page.
- **The pixel budget refuses long A4 documents for a rounding reason.** In the replica, A4 fails the
  rasterizer's budget from 71 pages (`SWEEP` `results["A4 ISO 595.276x841.89"].firstFailingPages`),
  because each page is rounded up to whole pixels after the scale was fitted to the budget
  (`CDR/app.py:564-576`; `:612-619`). A fix exists on the T5 branch, commit `1a534d72`, not on
  `main`.

## Candidates for "standard page"

| ID | Candidate | For | Against |
| --- | --- | --- | --- |
| C1 | **A page of the sanitized PDF, counted from its page tree** | The count is a property of immutable bytes the system already hashes (`WORKER/src/ocr.ts:128-130`). The reader already observes it (P6, P7, P8). Re-reading the same bytes with a new reader revision gives the same count. A customer can check it: open the PDF and count. Office formats are counted after conversion, which is what the code already promises for spreadsheets (`nextjs/lib/usage-pricing.ts:24-26`) and requires before a DOCX count may be called verified (`:46-48`). One count per document, so it is idempotent with the reservation (P4, P10) | A blank page counts. A large-format page counts the same as a small one. For an Office source the count belongs to the converter's pagination, not to the original file, and can differ from the count quoted at intake (P1) |
| C2 | **A rasterised page**: a page the rasterizer rendered to a bitmap | Counts work that was done. Matches how an image source is already counted, one frame per page (`CDR/app.py:400`) | Today the rasterizer renders every page it accepts (`CDR/app.py:595-620`), so the number equals C1 and adds a definition without adding information. It inherits every renderer refusal: an A4 document from 71 pages is refused for a rounding reason (`SWEEP`), so a document the customer can count would meter as nothing. The rasterizer sends no page count today (P5) |
| C3 | **A pixel budget**: rendered pixels against a reference page | Follows the rasterizer's real constraint, the per-page and per-document pixel ceilings (`CDR/app.py:55-56`). Sees page size, which C1 cannot | The render scale is chosen by the budget itself (`CDR/app.py:564-576`). The 10-page replica rendered at scale 1.5 to 11,300,160 px (`T7` `cdrReplica.rows[0].renderScale`, `.renderedPixels`), while a long A4 document is squeezed to fit the same budget, so a page's pixel count depends on how many other pages share the document. The GPU reader renders at its own scale (`GPU/app.py:29`), so "pixels" means two different things in one pipeline. A customer cannot check it before paying, and every renderer constant change would reprice past work |
| C4 | **OCR regions** emitted by the reader | Tracks payload and downstream compile size, which ADR-0004 lists among the limits that bind on the way to longer documents (`ADR4`, "What breaks first" items 2 and 4). Sees density, which C1 cannot | A model's output, not a property of the document: a new reader revision bills the same bytes differently. A reader that misses text would bill less, which pays for being wrong. Known only after the work, so it cannot be quoted or reserved against (P4). T7 has one density, so there is no evidence yet that time follows regions (`T7` `notProven`). A region count is not accuracy (`T7` `recordLabel`) |

GPU seconds are a cost, not a unit for the customer. `creditsForObservedGpuSeconds` exists
(`shared/creditEconomics.ts:43-46`), but GPU time depends on hardware, warm or cold state and request
splitting (`T7` `aggregates.page1_10p`, `coldStart`), and the customer can observe none of those.
They are recorded as an observation below and never billed.

## Decision (proposed)

### The definition

**A standard page is one page of the document's sanitized PDF, as its page tree counts it, bound to
that PDF's sha256.** That is C1. Every source, whatever its format, is metered on the sanitized PDF
the reader read. A page counts once per document, however many requests, ranges or retries read it.

C2 is not adopted because it equals C1 on today's path and adds the renderer's refusals. C3 and C4
are not adopted as units. Both are recorded in shadow as observations, so a later "complex page"
rule can be tested against them, and neither becomes a billing input without a same-condition
receipt and a founder decision.

### The meter record (*agent* builds the type and the writer; deploying them is the founder's)

One record per document, schema `tavonel.page_meter.v1`, written by the worker after `ocr.json` is
durable and before settlement is dispatched (`WORKER/src/index.ts:73-104`).

| Field | Value | Source of the value |
| --- | --- | --- |
| `schemaVersion` | `tavonel.page_meter.v1` | constant |
| `workspaceKey`, `documentId`, `reservationId` | the document's identity and its one reservation | `WORKER/src/keys.ts:36`; `supabase/migrations/0009_foundation_billing_compute_reservations.sql:15` |
| `sanitizedSha256` | digest of the sanitized PDF | the OCR result's `inputSha256` (`WORKER/src/ocr.ts:129`) |
| `ocrSha256`, `readerRevision`, `readerBindingSha256` | which result, and which qualified reader, produced the count | `WORKER/src/ocr.ts:128-140` |
| `meterBasis` | `sanitized_pdf_page_tree` | this ADR |
| `standardPages` | integer, at least 1 | `observedPageCount` (`WORKER/src/ocr.ts:130`) |
| `noTextPages` | integer, or `null` when the reader did not report page status | per-page `no_text` from the T5 range reader (`ocr-branch:workers/foundation-ocr-gpu/app.py:743`; `:755`) |
| `rasterizerPages`, `renderedPixels` | integer, or `null` with a reason, until the rasterizer reports them | P5. Today always `null` |
| `regionCount` | integer | the persisted result's regions |
| `ocrWallMs` | integer, measured by the worker | includes network; an observation, not GPU time |
| `ledgerCredits` | what the ledger actually settled for this document | the settlement result (`nextjs/lib/compute-reservation.ts:754-758`) |
| `meteredCredits` | the string `FOUNDER_PRICE_UNSET` | register D-28 `executesVia` (`REGJ`). Never a number until the founder sets one |
| `pricingFingerprint` | the intake pricing fingerprint in force | `nextjs/lib/usage-pricing.ts:302-318`, so a reprice can never silently re-meter past documents |
| `recordedAt` | timestamp | — |

Integrity rules, all fail-closed and visible:

- When two counts of the same bytes exist (`standardPages`, and `rasterizerPages` once it is
  reported), they must be equal. A mismatch writes no meter value: the record carries
  `status: "count_conflict"`, and the document goes to operator review. The meter never picks one.
- A transport failure meters nothing, the same rule that already makes it cost nothing
  (`WORKER/src/ocr.ts:41-47`). A range that never answered is not a page
  (`ocr-branch:quarantine-sidecar/foundation-cdr-worker/src/ocr.ts:1019-1020`: a range lost in
  transport reports `OCR_PAGES_INCOMPLETE` and settles nothing).
- No field is inferred. An unknown value is `null` with a reason, never a default.

### Idempotent per document

- In shadow, the record is an immutable sibling of `ocr.json`, `…/{sanitizedSha256}/page-meter.json`,
  derived the way `ocrSiblingKey` derives `ocr.json` (`WORKER/src/keys.ts:76-81`). It is written with
  the same refuse-to-overwrite condition (`WORKER/src/ocr.ts:730`). A redelivered message that finds an
  identical record is a duplicate and writes nothing. One that finds a different record is a
  conflict, fails closed and overwrites nothing. This mirrors the ledger's own duplicate and
  conflict rule (`supabase/migrations/20260911120000_compute_settlement_expired_terminal.sql:64-73`).
- When a price binds, the metered pages move into the settlement itself, because billing truth
  lives in PostgreSQL, not in object storage (CLAUDE.md, runtime invariants). The reservation's
  unique `document_id` keeps it one charge per document
  (`supabase/migrations/0009_foundation_billing_compute_reservations.sql:15`).
- The settlement body has a 2 KiB budget (`WORKER/src/settlement.ts:101`). The bound version carries
  only `meterBasis`, `standardPages` and `sanitizedSha256`, not the shadow observations.

### Never in a public DTO

- The record is an internal type in its own module. No public contract module
  (`nextjs/lib/public-status-contract.ts`, `nextjs/lib/public-trust-contract.ts`), no route under
  `nextjs/app/api/v1/`, and the OpenAPI document (`nextjs/app/api/openapi/route.ts`) may import or
  serialise it.
- `renderedPixels`, `regionCount`, `ocrWallMs`, `noTextPages`, `ledgerCredits`, `meteredCredits` and
  `pricingFingerprint` are route features and cost inputs. CLAUDE.md forbids exposing those in a
  public DTO or a client bundle.
- When a price binds, the customer sees a separate public type holding only the billed page count
  and the label of its basis. That label is public wording, so it is the founder's (row D-07,
  `REG:27`; row D-29, `REG:83`).
- A test fails the build if any of the internal field names above appears in a public contract
  module or in the generated OpenAPI document.

### Shadow before any price binds

| Stage | What runs | Billing effect | Exit |
| --- | --- | --- | --- |
| S0 — record (*agent* builds; deploy is the founder's) | The worker writes `page-meter.json` for every settled document. A failed meter write is logged with its reason and counted, and settlement proceeds unchanged, because in shadow the meter is not an input to the charge | None. Settlement still sends the constant (`WORKER/src/ocr.ts:130`) | Records exist for the FOUNDER-SET shadow sample (N-5 below) |
| S1 — compare (*agent* writes the report script; running it against production data is the founder's) | A read-only report joins each meter record with the ledger's settled credits and the approval row's `page_basis` and `approved_max_pages` (P3). It writes a receipt with: count conflicts, which must be zero; how far a `declared` intake count differed from the metered count, per format; pages per document by format; and observed seconds per page against regions per page | None. Read-only | Zero count conflicts, and a same-condition cost receipt covering more than one density (T7 has one) |
| S2 — bind (founder only) | The founder sets the numbers below. Settlement charges `standardPages` × the FOUNDER-SET units. A new migration replaces the `settled_credits = 2` check (`supabase/drafts/migrations/20261005130000_foundation_completed_read_proof.sql:32`). Code replaces the `0 \| 2` wire type (`WORKER/src/settlement.ts:68`; `WORKER/src/ocr.ts:83`) and the settle route's `actualCredits !== 2` check (`nextjs/app/api/internal/billing/settle/route.ts:118`). The trial quota (P11) and the public copy (P12) change in the same release | Live | The usual ladder: compatibility contract, shadow, benchmark, canary, rollout, deprecate. The per-document charge stays authoritative until the bound meter has run in canary without a conflict |

The page ceiling moves under ADR-0004, not here. One cap the meter depends on is not in the P2-18
cross-tree list: `observedPageCount` is held to at most 80 in the completed-read proof
(`shared/completedReadReceipt.ts:66`), recorded as a T5 residual (`T5` `남은 것`). A bound meter has
to move with the ceiling.

## What this does not change

- No price, credit constant or plan quantity: `nextjs/lib/usage-pricing.ts:3-6`,
  `nextjs/lib/billing-catalog.ts:22-79` and `shared/creditEconomics.ts:1-7` stay as they are. The
  register's conflict rule C7 holds: page metering is design only, and live prices are unchanged
  (`REG:126`).
- No settlement amount. Every document keeps settling the per-document constant until S2.
- No public sentence. "verified standard pages" is row D-07's (`REG:27`), and copy timing is row
  D-29's (`REG:83`).
- No automatic compile after import. Row S6-13 holds that until D-28's numbers are set (`REG:88`).
- No Protected Core module.

## Numbers only the founder sets

Each row is FOUNDER-SET. This ADR proposes no value for any of them, and the shadow code holds
`FOUNDER_PRICE_UNSET` wherever one would go.

| ID | Number | Value | The question | Why it is the founder's |
| --- | --- | --- | --- | --- |
| N-1 | Credits per standard page | FOUNDER-SET | When a price binds, how many credits does one standard page settle? Does the quote constant `STANDARD_UNITS_PER_PAGE` (`nextjs/lib/usage-pricing.ts:4`) become the settlement rate, or does it change? | Pricing (CLAUDE.md, "What is not an agent's call") |
| N-2 | Charge for a no-text page | FOUNDER-SET | Does a page the reader found no text on count as a standard page, count for less, or count for nothing? | Pricing |
| N-3 | Complex page | FOUNDER-SET | Is any page ever metered above standard? If so, on which observed signal (`renderedPixels`, `regionCount` or another), and above which value? Today nothing classifies a page, and `/pricing` already publishes the cap (`nextjs/components/pricing-page-client.tsx:246`) | Pricing, and a public claim that needs a receipt |
| N-4 | Per-document minimum | FOUNDER-SET | Does a one-page document carry a minimum charge beyond its one page? | Pricing |
| N-5 | Shadow sample | FOUNDER-SET | How many settled documents, and which formats, must S0 and S1 cover before S2 may start? | Decides when a price binds |
| N-6 | Trial counting | FOUNDER-SET | Is the trial's page quota counted in metered pages from S2? The trial terms themselves stay unchanged (row D-07, `REG:27`) | Trial terms are commercial terms |
| N-7 | Consumed pages for refunds | FOUNDER-SET | Is the refund rule's consumed-page share read from metered pages? The catalog says it is read from the usage ledger (`nextjs/lib/billing-catalog.ts:94-96`) | Refund terms are legal and pricing wording |

## Founder-only steps

- Deploying the S0 worker change (wrangler). This is row T-F8, deployment with a receipt and a
  rollback ID per step (`REG:61`).
- Running the S1 report against production storage and the production ledger.
- Setting N-1 to N-7.
- Applying the S2 migration to production Supabase.
- Ratifying every public sentence that changes at S2 (P12; rows D-07 and D-29).
- Changing any Paddle price that S2 implies.

## Not verified

- That the deployed rasterizer and reader run the code at `4c80bb30`. The worker's CDR target and
  the production RunPod endpoint were not read for this ADR.
- That the converter's page count for DOCX, PPTX and XLSX sources matches what a customer would
  count. No receipt covers Office pagination.
- Seconds per page at any density other than T7's single synthetic one (`T7` `notProven`).
- What the production cold path does with a POST (`T7` `coldStart.reading`).
- How often a `docx_declared` intake count differs from the rendered count. S1 measures this.

## Work this unblocks

| Task | What | Founder decision | Source |
| --- | --- | --- | --- |
| PAGE-METER shadow code | The S0 record type, writer and tests: create-once write, identical-redelivery duplicate, conflicting-redelivery fail-closed, count mismatch to operator review, a failed meter write that leaves settlement unchanged, and the public-DTO exclusion test | None to build. Deploying it is T-F8 | `REG:37`; `REGJ` `D-28.executesVia` |
| S1 report | A read-only join of meter records, ledger and approval rows, written as a receipt | Running it on production is the founder's | this ADR |
| S2 | Binding the meter to a price | N-1 to N-7 | `PLAN:384`; `CRITIC:268` |
| S6-13 | Automatic compile after import | Released only after N-1 to N-7 and an ADR | `REG:88` |

## Evidence

- The receipts in the alias table, each with its sha256.
- The plan's metering findings: the per-document constant at row 19 (`PLAN:97`), the intake side at
  A4.4 (`PLAN:126`), the 500-page mis-metering at item 11 (`PLAN:358`), and decision F6 (`PLAN:384`).
- The service definition's finding D18, that the catalog's "verified" promises more than the
  manifest (`SD:193`; `SD:330`).
