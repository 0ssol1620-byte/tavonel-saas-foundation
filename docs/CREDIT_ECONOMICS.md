# TAVONEL Credit-First Economics and Abuse Controls

> **Decision:** Use a **hybrid model**. The monthly plan pays for the governed workspace, collaboration, retention policy, and audit experience. GPU work consumes prepaid credits. A subscription must never create unlimited or automatically replenished GPU capacity.

This is an operating model, not a financial guarantee. It uses the current vendor list prices below and must be recalibrated after a qualified P95 workload benchmark. No RunPod endpoint, job, or credit is activated by this document.

## Why credits, not an unlimited subscription

RunPod Serverless is billed per second from worker start until full stop, including start and idle time; flex workers can scale to zero while active workers are billed continuously.[1] A pure “unlimited analysis” subscription exposes TAVONEL to an uncapped variable cost when a customer submits unusually large, adversarial, or automated workloads. Credits make the variable cost visible, enable an atomic pre-dispatch reservation, and make a stolen account’s maximum loss finite.

The recommended commercial shape is `Workspace access + prepaid compute credits`. Keep the current public presentation levels as access tiers: **Observer $29/month**, **Studio $99/month**, and **Institution custom**. Do not include recurring GPU credits in the first live release. A pilot discount can be expressed in the access fee, not in unrestricted compute.

## Conservative pilot credit catalogue

Paddle’s pay-as-you-go Checkout fee is currently 5% + $0.50 per transaction; it also identifies sub-$10 sales as a custom-pricing case.[2] For that reason the suggested credit packs start at $12.

| Pack | Price | Credits | Paddle fee | Net proceeds | Net per credit |
|---|---:|---:|---:|---:|---:|
| Starter | $12 | 100 | $1.10 | $10.90 | $0.1090 |
| Builder | $30 | 300 | $2.00 | $28.00 | $0.0933 |
| Scale | $75 | 800 | $4.25 | $70.75 | **$0.0884** |

The **Scale pack is the margin-floor SKU**. Credit consumption must be safe even when every credit was bought at its lowest net price. Allocate no more than 25% of that $0.0884 net credit value—about **$0.0221**—to RunPod GPU time before storage, CDR, support, refund, and operating overhead.

| GPU class | Current Serverless rate | Conservative credit mapping | GPU cost per credit at 25% start/idle allowance | Contribution before non-GPU costs |
|---|---:|---:|---:|---:|
| RTX 4090 Pro | $0.00031/sec | 1 credit / 45 GPU-sec | $0.0174 | 80.3% |
| A100 | $0.00076/sec | 1 credit / 18 GPU-sec | $0.0171 | 80.7% |
| H100 Pro | $0.00116/sec | 1 credit / 12 GPU-sec | $0.0174 | 80.3% |

The rates and configuration semantics come from RunPod’s current Serverless documentation.[3] The 25% factor is an internal risk buffer for worker start, model load, and the default idle window; it is not a vendor quote. Charge `ceil(actual_gpu_seconds / seconds_per_credit)` after the job ends, with a **minimum two-credit reservation** per admitted GPU job. Before live release, replace this static mapping only after measuring P50/P95 runtime, model cold start, input size, and full chain cost on harmless synthetic files.

## Mandatory spend controls

The server must reserve the job’s maximum credit cost before it signs or dispatches anything. It records an idempotency key, workspace ID, document proof ID, selected GPU price class, requested maximum seconds, and authorization decision in one transactional ledger step. A worker receives only a sanitized object reference and an opaque job token; it never receives a customer’s credit balance or reusable upload credentials.

| Control | Pilot policy | Why it matters |
|---|---|---|
| Customer balance | Prepaid only; no post-paid GPU | Compromise cannot create an open-ended invoice |
| New account allowance | Zero free GPU credits | Stops disposable-account GPU farming |
| Worker pool | Flex workers, active workers `0`, max workers `1`, GPUs per worker `1` | Removes idle spend and caps concurrency |
| GPU selection | One price class per operation; no automatic upgrade to a more expensive fallback | Avoids surprise rate escalation |
| Per-job cap | Default 10 credits; reject above cap | Maximum direct 4090 exposure is about 7.5 minutes at the pilot mapping |
| Per-workspace daily cap | Default 20 credits in private pilot | Narrows theft and automation blast radius |
| Request policy | Server-set timeout ≤ 90 sec and TTL ≤ 5 min; client cannot override | RunPod allows per-request timeout overrides, so the server must own the policy[4] |
| Dispatch integrity | Only a verified sanitized proof can reserve or dispatch | Preserves the CDR/AV boundary |
| Settlement | Charge observed time up to the reservation; release unused credits; never auto-retry ambiguous jobs | Prevents double charges and runaway retry cost |
| Global breaker | RunPod account-level spend alert plus TAVONEL hourly reserved-credit cap | RunPod’s default account limit is $80/hour, which is a backstop rather than a product control[1] |

Paddle webhooks are at-least-once and may arrive out of order, so event ID deduplication and `occurred_at` ordering remain mandatory for credit purchases and entitlement changes.[5] A chargeback can reverse the transaction and incur a fee; Paddle lists $15 for card and $20 for PayPal chargebacks, so credits must not be issued on a browser return URL alone.[6] The server should issue credits only from an authenticated, verified webhook projection and should freeze remaining credit issuance on chargeback or refund events.

## Activation threshold

Do not publish the catalogue or make a checkout live until all of the following are true: Paddle sandbox webhook tests pass; a dedicated ledger migration is applied; harmless synthetic end-to-end tests establish P95 runtime by GPU class; actual all-in cost per job stays below the 25% GPU allocation; R2/AV/CDR lineage is qualified; and the user explicitly approves real customer intake and paid GPU dispatch. A persistent margin floor alert should pause new dispatches when observed all-in cost exceeds 30% of recognized credit revenue for a price class.

## References

[1]: https://docs.runpod.io/serverless/pricing "RunPod Serverless pricing"
[2]: https://www.paddle.com/pricing "Paddle pricing"
[3]: https://docs.runpod.io/serverless/endpoints/endpoint-configurations "RunPod endpoint settings and per-second GPU rates"
[4]: https://docs.runpod.io/serverless/endpoints/send-requests "RunPod request execution policies"
[5]: https://developer.paddle.com/webhooks/about/how-webhooks-work "Paddle webhook delivery guarantees"
[6]: https://www.paddle.com/help/manage/risk-prevention/understanding-chargebacks-with-paddle "Paddle chargeback process and fees"
