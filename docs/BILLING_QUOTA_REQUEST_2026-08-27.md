# Foundation Billing Project-Quota Request — 2026-08-27

## Request scope

The sole active billing account has an active status, a direct account type, and one currently linked project. Google Cloud rejected attachment of a second project because the billing account's project quota is exhausted. The existing production project will not be detached, moved, or altered.

The requested increase is for exactly **one** additional paid-services project: `tavonel-saas-foundation`. Its limited purpose is a Seoul-region, request-billed Cloud Run service with zero minimum instances and a maximum of one instance for harmless synthetic PDF-raster CDR qualification. The request does not seek GPU capacity, a recurring worker, customer-data processing, payment checkout, or an increase beyond this isolated Foundation project.

## Form drafting boundary

The support form requires the console account email, project count, paid-services selection, billing account identifier, a reason classification, and a justification. No credential, billing account identifier, payment method, customer data, document content, or proprietary source will be stored in this repository. Submission status will be recorded only after the support form returns a nonsecret confirmation.

## Pre-submission fact pattern

| Item | Status |
|---|---|
| Existing billing account | Active; current linked-project quota is exhausted |
| Requested additional projects | 1 |
| Service category | Paid Cloud Run only |
| New project | `tavonel-saas-foundation` |
| CDR guardrails | `asia-northeast3`, request-billed, min 0, max 1, no GPU, synthetic-only |
| Existing production project | Untouched |

## Submission result

The Google Cloud Platform Trust & Safety support form confirmed successful submission on 2026-08-27. The confirmation states that review and reply are typically expected in about two business days, while allowing for longer processing in some cases. The request must be approved and its result must be reflected in the console before the billing account can be connected to `tavonel-saas-foundation`.

No billing connection, Cloud Run service, CDR secret, customer-data processing, GPU job, or production deployment was created by submitting this support request.
