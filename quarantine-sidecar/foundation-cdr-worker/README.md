# tavonel-foundation-cdr

Foundation-only Cloudflare Worker that loads `quarantine/{workspaceId}/{documentId}/source` from R2 and sanitizes it through the synthetic Cloud Run CDR. It never asks Vercel to carry file bytes.

After a successful create-once `sanitized.pdf` write, if `FOUNDATION_OCR_URL` is set to a Foundation OCR target (not `tavonel-pdf-cdr` / prod), the Worker GETs the immutable PDF from R2, POSTs `/v1/ocr`, and writes sibling `ocr.json` create-once. If the URL is empty, OCR is skipped and CDR still returns clean.

The Worker also writes a create-once `cdr-receipt.json`. OCR requests have a hard 25-second client timeout. Any missing source, timeout, HTTP failure, invalid response, or result-write failure produces a create-once `ocr-review.json` with `retryPolicy=explicit_operator_only`. Before every OCR call, the Worker checks for existing `ocr.json` and `ocr-review.json` siblings, so an R2 redelivery or a transient settlement failure retries only the idempotent billing callback and never repeats paid GPU work. The Product UI derives `sanitized`, `ocr_ready`, or `operator_review` from these immutable siblings and stops batch compilation immediately on operator review.

Production processing requires `FOUNDATION_BILLING_SETTLEMENT_URL` to remain the exact canonical Foundation Vercel endpoint and `FOUNDATION_BILLING_SETTLEMENT_HMAC` to be stored as the same server-only secret on both Worker and Vercel. A missing or rejected settlement callback is retryable and prevents queue acknowledgement; CDR rejection releases the reservation, while successful or operator-review GPU outcomes settle the fixed two-credit reservation.

The queue consumer is intentionally serialized with `max_batch_size=1` and `max_concurrency=1`. RunPod exposes one paid GPU worker, so horizontal Queue autoscaling would turn a five-file source page into concurrent load-balancer calls and create avoidable timeouts. Transient messages retry ten times and then move to `foundation-quarantine-dead-letter` instead of disappearing.

This Worker is **not deployed** by the OCR-slice commit. Do not `wrangler deploy` from the company PC. Worker name remains `tavonel-foundation-cdr`. Never deploy `tavonel-quarantine-sidecar`.
