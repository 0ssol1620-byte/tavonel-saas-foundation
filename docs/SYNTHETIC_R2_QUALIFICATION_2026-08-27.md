# Foundation R2 Synthetic Qualification — 2026-08-27

## Scope and result

The Cloudflare OAuth connector was used only against the isolated Foundation bucket, `tavonel-saas-foundation-quarantine`. A filtered read confirmed that exact bucket exists. No production bucket, DNS record, Worker, CORS rule, lifecycle policy, customer identity, document, payment, or GPU endpoint was accessed or changed.

One fixed, harmless 69-byte ASCII marker was then processed under the `synthetic/` prefix. The object contained no customer data or personal information. The sequence completed without retries: a single PUT returned HTTP 200 with a distinct object version, the same object returned HTTP 200 on an immediate GET, and the exact key returned HTTP 200 on an immediate DELETE. The marker body and all credentials are intentionally omitted from this record.

| Control | Evidence | Result |
|---|---|---|
| Account/bucket isolation | Exact-name filtered R2 bucket read | Passed; only `tavonel-saas-foundation-quarantine` targeted |
| Write | One PUT to `synthetic/qualification-20260827-140800.txt` | Passed; HTTP 200 |
| Readback | One GET of the exact written key | Passed; HTTP 200 |
| Cleanup | One DELETE of the exact written key | Passed; HTTP 200 |
| Cost boundary | No CDR, GPU, worker, volume, or payment operation | Preserved; $5 GPU ceiling not consumed |
| Retry policy | Initial connector-disabled failure produced no provider request; successful PUT was issued only after authenticated connector recovery | Preserved; no ambiguous provider write replayed |

## What this does not qualify

This evidence demonstrates the Foundation bucket object round-trip only. It does **not** qualify browser-direct signed capabilities, origin-specific CORS, multipart uploads, customer intake, CDR sanitization, OCR/GPU execution, signed worker receipts, candidate promotion, subscription checkout, entitlement granting, or production deployment. Those remain fail-closed until the distinct prerequisite and evidence for each is completed.

## References

[1] [Cloudflare API — R2 object endpoints](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/)
