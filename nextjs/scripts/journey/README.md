# Full-journey proof harness

The 18-step journey the growth blueprint calls "full success" (§5), the receipt shape that records
it, and the checker that reads a receipt back against the model.

```
prove.mjs                 the run. Copied from D:\CodexProjects\uskc-lanes\e2e\prove.mjs
                          (2026-09-06) and extended; that original is read-only evidence.
acceptance-checker.mjs    the 18-step model, the status roll-up, the receipt validator, the table.
receipt.schema.json       what a receipt must contain to be a receipt.
receipt-fixtures/         the 12 real receipts from the 2026-09-06 run, redacted (see below).
```

The test that drives all of it is `nextjs/lib/journey-acceptance.test.ts`, in `lib/` because that
is where this repository's vitest config looks and where `secret-scan.test.ts` and
`explore-sample.test.ts` already drive scripts from.

## Running it

```
node scripts/journey/acceptance-checker.mjs --plan          # what each step would call. No credential.
node scripts/journey/acceptance-checker.mjs <receipt.json>  # validate + print the journey table
node scripts/journey/prove.mjs --plan                       # the same plan, plus paths and formats
node scripts/journey/prove.mjs --self-test                  # pure logic, no network
node scripts/journey/prove.mjs --probe                      # no key: every guarded route must 401/403
TAVONEL_API_KEY=tvnl_live_... node scripts/journey/prove.mjs # a real run. See the runbook first.
```

`--plan`, `--self-test` and the checker read no credential and make no call. Only the last two
lines touch the network, and only the last one needs a key and an authorisation to spend.

Environment: `TAVONEL_ORIGIN` (default `https://tavonel.com`), `TAVONEL_API_KEY`,
`E2E_FIXTURE_DIR` (the sample documents; this copy ships none, so point it at the 2026-09-06
harness's `fixtures/` or regenerate them with its `make_fixtures.py`), `E2E_FORMATS`, `E2E_SALT`,
`E2E_POLL_MS`, `E2E_TIMEOUT_MS`. Receipts are written to `scripts/journey/receipts/`.

`docs/runbooks/full-journey-proof.md` is what a real run needs and who has to decide it.

## The 18 steps and the six words

Each step records three results at once (§5): **execution** (did it actually run), **semantic**
(are the facts, relations and evidence right), **task** (did the customer finish what they came
to do). The step status is the worst of the three that apply, in the vocabulary
`PASS | FAIL | NOT_RUN | NOT_APPLICABLE | HELD | PARTIAL`.

Two rules the checker enforces rather than documents:

- **`NOT_APPLICABLE` belongs to step 5 alone.** An input the reader was confident about needed no
  human review, and saying so is honest. A step nobody built is `NOT_RUN`. A step deliberately
  waiting on a person is `HELD`. `validateReceipt` refuses a receipt that labels any other step
  inapplicable, and `journeyFromReceipt` downgrades one to `NOT_RUN` if it somehow appears.
- **A verdict may not claim more than the receipt holds.** `PROVEN_E2E` requires both
  `reachedStep === "ASK"` and `tokenFoundInEvidence === true` -- a grounded answer that cites
  something else proves retrieval ran, not that this document was read.

Steps 14 (`revision_input`), 15 (`change_approval`) and 16 (`post_change_use`) are marked
`implemented: false` and can only ever report `NOT_RUN`. That is a statement about this harness
and the route tree as read on 2026-09-11, not about the product's intent: `E2E_SALT` makes a new
source version, which is new-document ingestion, and the only approval route in the tree is the
browser-session promote.

## Steps 12 and 13

New here, and both are reads of a World that is already active:

- **12, live external consumption** -- `POST /api/v1/collections/{id}/search`, which takes the
  same `ask:read` scope as `/ask`. A key-holding consumer outside the browser (an agent, a CLI,
  `public/developer/tavonel-mcp.mjs`) reading the same World through the same tenant boundary.
- **13, file consumption** -- `GET /api/v1/collections/{id}/download`, then the package validator
  that already ships to customers (`scripts/compiled-world/validate.mjs`, published as
  `public/developer/tavonel-verify-package.mjs`), imported rather than re-implemented. On top of
  the validator's own required files, the step checks `PACKAGE_CONTRACT`: `README.md`, `AGENTS.md`
  and `manifest/ai-entrypoint.json` are *allowed* by the validator, because an artifact that never
  became a download has none of them, but a customer download must carry all three.
  `journey-acceptance.test.ts` pins `PACKAGE_CONTRACT` to `REQUIRED_PACKAGE_PATHS`
  (`lib/collection-download.ts`) and `AI_PACKAGE_CONTENTS` (`lib/ai-package-guidance.ts`), so the
  dependency-free copy in this directory cannot drift from the code that writes the archive.

Neither can run before step 8, and step 8 is a person.

## Cost

`receipt.costAccounting` is always `{ measured: false, reason, currency: null, amount: null }`.
No route this harness calls returns a GPU, token or dollar figure, so no number is written and
none is estimated. Blueprint step 18 is therefore `PARTIAL` on every receipt that exists: time
and failure are recorded, cost is not.

## receipt-fixtures/

Twelve receipts from the 2026-09-06 run, chosen to cover every distinct verdict and `blockedBy`
shape that run produced:

| shape | fixtures |
|---|---|
| `FAILED_COMPILE_JOB` (403 API_SCOPE_REQUIRED at `/api/compile-jobs`) | docx 09:56, pdfscan 10:03, pptx 09:56 |
| `REACHED_DOCUMENT_TERMINAL` / `OPERATOR_REVIEW_REQUIRED:unspecified` | pdf 09:56, png 10:06 |
| `REACHED_DOCUMENT_TERMINAL` / `OPERATOR_REVIEW_REQUIRED:OCR_TIMEOUT_OR_NETWORK` | png 10:38, pptx 10:06 |
| `FAILED_COMPILE_TERMINAL` / `COMPILE_NOT_READY:review_required` | xlsx 10:06, xlsx 10:54 |
| `REACHED_COLLECTION` / `PROMOTION_IS_BROWSER_SESSION_ONLY` | docx 10:06, pptx 10:50 |
| `UNAUTHENTICATED_SURFACE_REFUSES` | unauthenticated_probe |

**The only edit made on copy** is the R2 account host in the presigned `R2_PUT` path, replaced
with `r2-account-redacted.r2.cloudflarestorage.com`. The presigned query was already dropped by
the harness that wrote them. Everything else -- ids, digests, object keys, latencies, artifacts --
is byte-for-byte the original. A test asserts no fixture carries a `tvnl_live_` key, an
`authorization` field, an AWS signature parameter or a hex R2 account host.

Not one of these twelve reached `WORLD` or `ASK`. There is no `*_resume_*` receipt anywhere,
because nobody promoted a candidate in a browser that day. Every green row below step 7 in this
directory is a row about a refusal being recorded correctly, and none of it is evidence that the
product completes the journey. Only a real run is that.
