# Foundation private-pilot intake (2026-08-29 KST)

Operator approved opening customer-file quarantine on the isolated Foundation origin.

## Open

- `activationPolicy.customerIntake` is true in the Next.js app.
- Signed-in Google testing-mode users can request a 5-minute browser-direct PUT to `tavonel-saas-foundation-quarantine` under `quarantine/{pilot-workspace}/{documentId}/source`.
- The application server still never receives file bytes.

## Still closed

- CDR customer sanitization (`cdr.enabled` false) until Foundation Cloud Run `/health` returns ok with HMAC.
- GPU/OCR (`ocrGpu.enabled` false) until an immutable worker release pack exists.
- Candidate promotion remains false.

Production `tavonel` and production R2 buckets are untouched.
