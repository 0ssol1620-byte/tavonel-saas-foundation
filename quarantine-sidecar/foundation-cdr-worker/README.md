# tavonel-foundation-cdr

Foundation-only Cloudflare Worker that loads `quarantine/{workspaceId}/{documentId}/source` from R2 and sanitizes it through the synthetic Cloud Run CDR. It never asks Vercel to carry file bytes.

After a successful create-once `sanitized.pdf` write, if `FOUNDATION_OCR_URL` is set to a Foundation OCR target (not `tavonel-pdf-cdr` / prod), the Worker GETs the immutable PDF from R2, POSTs `/v1/ocr`, and writes sibling `ocr.json` create-once. If the URL is empty, OCR is skipped and CDR still returns clean.

The Worker also writes a create-once `cdr-receipt.json`. OCR requests have a hard 25-second client timeout. Any missing source, timeout, HTTP failure, invalid response, or result-write failure produces a create-once `ocr-review.json` with `retryPolicy=explicit_operator_only`; the source queue message is acknowledged so an ambiguous paid GPU request is never retried automatically. The Product UI derives `sanitized`, `ocr_ready`, or `operator_review` from these immutable siblings and stops batch compilation immediately on operator review.

This Worker is **not deployed** by the OCR-slice commit. Do not `wrangler deploy` from the company PC. Worker name remains `tavonel-foundation-cdr`. Never deploy `tavonel-quarantine-sidecar`.
