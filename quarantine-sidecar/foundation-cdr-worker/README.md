# tavonel-foundation-cdr

Foundation-only Cloudflare Worker that loads `quarantine/{workspaceId}/{documentId}/source` from R2 and sanitizes it through the synthetic Cloud Run CDR. It never asks Vercel to carry file bytes.

After a successful create-once `sanitized.pdf` write, if `FOUNDATION_OCR_URL` is set to a Foundation OCR target (not `tavonel-pdf-cdr` / prod), the Worker GETs the immutable PDF from R2, POSTs `/v1/ocr`, and writes sibling `ocr.json` create-once. If the URL is empty, OCR is skipped and CDR still returns clean.

The Worker also writes a create-once `cdr-receipt.json`. OCR requests have a hard 25-second client timeout. Any missing source, timeout, HTTP failure, invalid response, or result-write failure produces a create-once `ocr-review.json` with `retryPolicy=explicit_operator_only`. Before every OCR call, the Worker checks for existing `ocr.json` and `ocr-review.json` siblings, so an R2 redelivery or a transient settlement failure retries only the idempotent billing callback and never repeats paid GPU work. The Product UI derives `sanitized`, `ocr_ready`, or `operator_review` from these immutable siblings and stops batch compilation immediately on operator review.

Production processing requires `FOUNDATION_BILLING_SETTLEMENT_URL` to remain the exact canonical Foundation Vercel endpoint and `FOUNDATION_BILLING_SETTLEMENT_HMAC` to be stored as the same server-only secret on both Worker and Vercel. A missing or rejected settlement callback is retryable and prevents queue acknowledgement; CDR rejection releases the reservation, while successful or operator-review GPU outcomes settle the fixed two-credit reservation.

The queue consumer is intentionally serialized with `max_batch_size=1` and `max_concurrency=1`. RunPod exposes one paid GPU worker, so horizontal Queue autoscaling would turn a five-file source page into concurrent load-balancer calls and create avoidable timeouts. Transient messages retry ten times and then move to `foundation-quarantine-dead-letter` instead of disappearing.

This Worker is **not deployed** by the OCR-slice commit. Do not `wrangler deploy` from the company PC. Worker name remains `tavonel-foundation-cdr`. Never deploy `tavonel-quarantine-sidecar`.

## Persisted CDR evidence boundary

New clean receipts use `tavonel.cdr_receipt.v2`. Reuse requires the exact source key and
input digest, clean status, provider, target binding, canonical output key and the actual
stored PDF digest. `targetSha256` binds the configured bucket, provider and CDR URL; it
does not attest a renderer image or scanner revision. Change the provider identity when
the execution policy changes at the same URL, and qualify that deployment separately.

The Worker validates persisted PDF and receipt winners after create-once writes too.
A conditional-write conflict never authorizes the stored winner from a fresh response.
Matching v2 redelivery still skips CDR. Legacy v1, mismatched provider/target, malformed
receipts and corrupted PDF bytes are not reusable. If fresh processing produces a
different digest, it creates a separate version. If it collides with incompatible frozen
evidence at the same digest, processing stops with a retryable integrity error before OCR.
Historical evidence is never overwritten automatically.

Before deploying this change, inventory legacy receipts and pending deliveries and agree
an explicit migration or re-intake procedure for same-output collisions. This patch does
not qualify existing OCR siblings, perform IAM provider cutover, or enable customer data.
The UI's presence-based historical progress labels are not v2 validation receipts.

The regression suite covers stale-provider/endpoint collisions, persisted byte corruption,
failed receipt writes, null and throwing conditional conflicts, and valid retry behavior.
Cloudflare documents null conditional PUT results and read-after-write consistency in the
[R2 Workers API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).
