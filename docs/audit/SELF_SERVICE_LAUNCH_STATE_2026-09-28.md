# Customer compilation and paid self-service: launch state (2026-09-28)

This record separates implemented paths from permission to accept a customer's files or card. It is an operator record, not a customer-facing promise or an approval receipt.

## Observed production state

- `https://tavonel.com/api/status` reports `liveCheckout: false`, `selfService: false`, `billing: live_launch_pending`, and Google sign-in configured.
- `https://tavonel.com/api/status/v2` reports account creation, plan purchase, and customer-document compilation unavailable. The public pricing page routes Developer and Team inquiries to assisted access.
- The production Supabase `customer_data_gate_receipts` table contains **zero rows** as of this check. Intake and compilation require a current, exact-workspace allowed receipt; no customer workspace can pass that check today.
- The Paddle dashboard is in **Live** mode and reports **Verification passed**. Its catalog has active TAVONEL Observer ($29/month) and Studio ($99/month) products and prices, and the production webhook destination is active with 11 subscribed events. This establishes provider-side objects and merchant verification, but does not establish that the application environment points to those exact live prices or that a real-money checkout and customer compile succeed.

## What the implementation already does

- Authenticated upload uses tenant-scoped quarantine, signature checks, sanitization and OCR before compilation. The compile runner requires Product Core v2, a receipt signer, a verified workspace customer-data decision, OCR region evidence, and source-version revalidation.
- Paddle sandbox qualification previously exercised a Starter credit purchase and Developer subscription, webhook replay, and a customer-portal cancellation. The live checkout route requires a configured price, browser token, durable checkout intent, and commercial launch switches.
- This branch adds an additional live-checkout refusal when the buyer's exact workspace lacks a current customer-data decision. The check runs before the checkout binding and durable intent. It does not change sandbox qualification.

## Remaining launch conditions

1. Complete and record all 17 customer-data preconditions with current evidence for the intended processing scope; the gate specification is `docs/CUSTOMER_DATA_GATE_2026-09-06.md`. Its historical status table must be rechecked against current code and live providers. A founder authorization is already present in the conversation, but it cannot stand in for technical, contractual, or operational evidence.
2. Finish the source export/deletion and retention guarantees, connector ACL capture and viewer authorization, and live full-sequence customer-file proof. The current customer-data receipt table is empty, so a passing unit test or synthetic canary is not a customer-file qualification.
3. Complete and record legal review of the served DPA draft. Reconcile the verified Paddle live merchant, products/prices, tax, token, API permissions, and webhook state with the application settings before enabling charges; provider-side objects alone do not prove that binding.
4. Close a billing lifecycle risk before subscription sales: a workspace approval may be revoked or expire after checkout, while a Paddle checkout intent remains valid for 24 hours; recurring renewal can also charge after approval expires. The new initial-checkout guard does not prevent those later charges. Build and verify a proactive pause/cancel or refund path tied to gate revocation/expiry, including reconciliation and customer notice. Paddle's [pause API](https://developer.paddle.com/api-reference/subscriptions/pause-subscription/) supports immediate pause with `subscription.write`; [live refunds](https://developer.paddle.com/api-reference/adjustments/create-adjustment/) may require Paddle approval, so a refund request alone cannot be treated as immediate protection.
5. Only then enable `ACCESS_MODE=self_service` and live billing under a staged cohort, run a new-account upload → CDR → OCR → compile → signed export → AI use test, and a real Paddle checkout → signed webhook → entitlement → cancellation/refund test. Record receipts, rollback, and operator ownership. Do not infer success from configuration or a started job.

Until those conditions have evidence, keep the existing production customer-data and live-charge gates closed. This branch is a payment safety repair, not a launch approval.
