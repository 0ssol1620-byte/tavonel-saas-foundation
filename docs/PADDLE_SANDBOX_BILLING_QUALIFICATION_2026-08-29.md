# Paddle Sandbox Billing Qualification

**Date:** 2026-08-29 KST  
**Scope:** TAVONEL SaaS Foundation only  
**Mode:** Paddle sandbox; no live-mode product, price, transaction, or charge

## Qualified configuration

- Production origin: `https://tavonel-saas-foundation.vercel.app`
- Webhook destination: `ntfset_01m14ftah3b5035z5njtq5tkt0`
- Starter: product `pro_01m14fcvebgd78pqfn5ankykz3`, price `pri_01m14fhhsnxwjmy5qaemgs2eqv`, one-time $12, 100 credits
- Builder: product `pro_01m14fdwn2xjvfbfq1ebjcxbtp`, price `pri_01m14fm3d61gd87k0zfwx7ctyb`, one-time $30
- Scale: product `pro_01m14feve6jq23gy9r1sbmjtk2`, price `pri_01m14fppkk79za9dfccgp6ar41`, one-time $75
- Observer: product `pro_01m16arp9xpsqzs2xrsc79vjvd`, price `pri_01m16asmab439nfq3d9d7qeqr3`, $29/month
- Studio: product `pro_01m16as1kj1v4a9rr43kre58rz`, price `pri_01m16at1v9gc5ykmpmdg9mas7p`, $99/month
- Default payment link: the Foundation production origin; required for Paddle overlay checkout
- Portal key scope: customer portal session creation only; sandbox key expires 2026-11-27

Secret values are stored only in Vercel managed environment variables. They were not written to this repository or this record.

## Browser-to-ledger evidence

1. An authenticated user opened the Foundation workspace and launched the Paddle test overlay.
2. Starter checkout completed at $12 in test mode. The signed `transaction.paid` webhook persisted 100 available and 100 lifetime-purchased credits.
3. Observer checkout completed at $29/month in test mode. Subscription `sub_01m16c7333gejwz7b7n78eezkh` became active; first transaction `txn_01m16c68xj8vtfc3f98wjb4zd9` was shown paid in the portal.
4. Workspace state after both events was Observer access, active subscription, 100 available credits, 100 purchased credits, zero reversed credits, and no billing hold.
5. Replaying notification `ntf_01m16c73kw3avq019xqcg3aa54` produced delivered notification `ntf_01m16c9f01g7mp2544j19n48ry`. Replaying Starter notification `ntf_01m16c51n3n73y1fjqjy23zxeq` was also accepted. The balance and persisted-event timestamp did not change, proving event and transaction idempotency.
6. The authenticated customer portal loaded the active Observer subscription and its paid first invoice.
7. Period-end cancellation was confirmed in the portal. Paddle kept the subscription active through 2026-09-29 and delivered a new `subscription.updated` event.

## Cancellation projection

Paddle correctly reports a period-end cancellation as `status=active` plus `scheduled_change.action=cancel`. Migration `0006_foundation_subscription_schedule.sql` adds `subscription_cancel_at` and a service-role-only projection RPC. The RPC binds the event ID, workspace, subscription ID, and latest event timestamp before updating the schedule. It is retry-safe and rejects stale events.

The real Foundation database returned `Success. No rows returned` for both the migration and a rollback-only invariant probe. The probe verified the new column type, browser-role RPC denial, service-role RPC access, active-status preservation, exact schedule retention, and rejection of an older schedule-clearing event. All fixture rows were rolled back.

## Code and deployment evidence

- TypeScript: `pnpm check` passed.
- Unit/contract tests: 38 files, 123 tests passed.
- Root production build: Vite and server bundle passed.
- Next.js production build: Next.js 15.5.24 compiled, type-checked, generated all routes, and completed successfully.
- Initial qualified deployment: Vercel deployment `dpl_3NexCB3KqaRdVZSMwqX9Zq9zzmdH`, aliased to the Foundation production origin.

## Remaining boundary

This qualification proves sandbox checkout, signed webhook fulfillment, persisted credit/subscription state, redelivery idempotency, customer portal creation, and period-end cancellation handling. It does not approve Paddle live mode, a real payment method, a real charge, refunds against customer funds, production merchant/tax readiness, or unlimited GPU usage. Those remain fail-closed and require a separate launch approval.
