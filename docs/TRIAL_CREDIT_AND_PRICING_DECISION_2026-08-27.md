# TAVONEL Trial Credit and Pricing Decision — 2026-08-27

> **Status:** Proposed operating policy. This document does not create an account, credit balance, checkout, R2 capability, CDR request, GPU job, or provider configuration. All four live-path flags remain disabled.

## Entity card and basis

| Field | Basis used for this decision |
|---|---|
| Offering | TAVONEL SaaS Foundation, a pre-live governed-document product |
| Currency | USD, matching the existing public presentation |
| Reference date | 2026-08-27 (KST) |
| Revenue model | Monthly workspace access plus prepaid, non-recurring GPU processing credits |
| Cost basis | Paddle pay-as-you-go checkout fee; RunPod Serverless public list rates; R2 Standard storage/operations only |
| Important limit | No qualified CDR, model-runtime, support, refund, fraud, tax, or P95 end-to-end cost data exists yet; all figures below are policy inputs, not forecasts or guarantees |

## Decision

TAVONEL should offer **two trial credits once per verified human identity and first eligible workspace**, rather than an unlimited/free tier or a recurring credit grant. The credit must expire after **seven days**, be non-transferable and non-refundable, and permit at most **one two-credit job**. It must not be issued merely because a browser submits an email: the future issuance path must require verified identity, one-time grant evidence, workspace authorization, rate/abuse checks, and a qualified sanitized-only execution path.

Two credits are deliberately equal to the present minimum job reservation. At the current mapping, they bound compute to 90 seconds on RTX 4090, 36 seconds on A100, or 24 seconds on H100. The policy must continue to charge `ceil(observed_seconds / seconds_per_credit)` and stop a job at the server-owned timeout; it must never grant a browser-selected GPU class, duration, or retry. The future trial route remains unavailable until its exact authenticated and anti-abuse controls have been implemented and qualified.

| Item | Proposed policy | Reason |
|---|---:|---|
| Signup trial | 2 credits | Enough for one tightly bounded first evaluation, aligned to current 2-credit minimum reservation |
| Grant trigger | Verified identity + first eligible workspace + no prior trial | Prevents raw-email, repeat-workspace, and replay issuance |
| Trial expiry | 7 days from grant | Limits dormant balance and delayed abuse exposure |
| Trial spend | One job; exact reservation of 2 credits | Prevents parallel/multiple-job accumulation before payment qualification |
| Default paid job ceiling | 10 credits | Retains the current direct-spend cap |
| Default workspace daily ceiling | 20 credits | Retains the current daily blast-radius control |
| Free/"unlimited" plan | None | Avoids uncapped recurring GPU liability |

## Paid catalog recommendation

Keep the public pilot packs at **Starter $12 / 100 credits**, **Builder $30 / 300 credits**, and **Scale $75 / 800 credits**. Do not discount the Scale unit price below the current pilot level until qualified all-in P95 cost evidence supports it. Keep access plans separate: **Observer $29/month**, **Studio $99/month**, and Institution by review. Access plans include no recurring GPU credits in the initial launch.

Paddle currently lists a pay-as-you-go Checkout fee of 5% + $0.50 per transaction and flags sub-$10 products for custom pricing.[1] The current catalog keeps the smallest credit pack above that threshold. Using that published fee, the after-fee proceeds are $10.90, $28.00, and $70.75, respectively; the floor SKU is Scale at $0.0884375 net per credit.

| Pack | Gross price | Credits | Paddle fee | Net proceeds | Net per credit |
|---|---:|---:|---:|---:|---:|
| Starter | $12.00 | 100 | $1.10 | $10.90 | $0.1090000 |
| Builder | $30.00 | 300 | $2.00 | $28.00 | $0.0933333 |
| Scale | $75.00 | 800 | $4.25 | $70.75 | $0.0884375 |

RunPod's current Serverless list prices are $1.10/hour for 4090, $2.72/hour for A100, and $4.79/hour for H100.[2] At the current conservative timing maps, direct GPU cost is $0.01374975, $0.01359990, and $0.01596660 per credit, respectively. The highest direct-cost case—H100—consumes 18.054106% of the Scale-pack net revenue per credit. The existing 30% all-in cost circuit breaker therefore reserves 11.945894 percentage points for sanitation, storage, support, chargeback/refund, and operational overhead; it must pause dispatch immediately if actual all-in cost exceeds that threshold.

| GPU class | Timing map | Direct GPU cost / credit | Share of Scale net / credit | 2-credit maximum direct GPU cost |
|---|---:|---:|---:|---:|
| RTX 4090 | 45 seconds | $0.01374975 | 15.547887% | $0.02749950 |
| A100 | 18 seconds | $0.01359990 | 15.378404% | $0.02719980 |
| H100 | 12 seconds | $0.01596660 | 18.054106% | $0.03193320 |

R2 Standard currently has a 10 GB-month / 1 million Class A / 10 million Class B monthly included tier; after that, it lists $0.015 per GB-month, $4.50 per million Class A requests, and $0.36 per million Class B requests, with no egress charge.[3] These values are not sufficient to price the end-to-end document chain: CDR, OCR/model runtime, operational support, and refunds must be measured during a synthetic P50/P95 qualification before paid processing is enabled.

## Enforceable release gates

The implementation must preserve the following order. First, a dedicated Auth sandbox must establish verified identity and one-time trial entitlement without browser-trusted issuance. Second, Paddle sandbox must prove signed, ordered event projection before any paid credit. Third, a foundation-only R2 signer can be qualified with harmless synthetic objects. Fourth, CDR and sanitized artifact evidence must be qualified. Fifth, a synthetic RunPod execution must provide observed-duration and signed receipt evidence. Only then may a limited pilot permit the two-credit trial and paid file flow.

At every stage, ambiguous payment, storage, CDR, or GPU state must go to review rather than retrying an externally paid or state-mutating operation. A browser checkout success redirect never issues credits. The Foundation may not use this document as authority to create provider accounts, configure secrets, change CORS, deploy, upload customer bytes, launch GPU capacity, or accept payment.

## References

[1]: https://www.paddle.com/pricing "Paddle — Pricing"
[2]: https://www.runpod.io/pricing "RunPod — GPU Cloud Pricing"
[3]: https://developers.cloudflare.com/r2/pricing/ "Cloudflare R2 — Pricing"
