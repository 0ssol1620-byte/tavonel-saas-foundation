# Billing rejection review

## Invariant

A signed Paddle event that v6 could not apply is one row in `foundation_billing_event_rejections`,
written in the same transaction as the webhook's answer (migration `20260927120000`). An unresolved
row may be money received without an entitlement. Nothing here refunds, grants, or closes a row
automatically. Rows close in exactly two ways:

- **Automatically, by v6**, when a later delivery of the same `event_id` is applied
  (`resolution_status` = the projected status) or is already applied (`duplicate`).
- **Manually, by the closure step below**, after a human refund or reissue decision.

## 1. List unresolved rows (read-only)

From a trusted workstation with the production `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` in the shell environment only (never in a file in the repo):

```sh
cd nextjs
pnpm billing:rejections -- --limit 25
```

The CLI calls the service-role-only `list_foundation_billing_event_rejections` RPC
(migration `20260927130000`). It prints at most 50 unresolved rows, oldest first, with
`unresolvedTotal` and `truncated`. Each row carries event id, event type, action, reason, `nextStep`,
timestamps, workspace key, offer, and Paddle price/transaction/subscription ids. It never prints user
id, Paddle customer id, checkout nonce, payload digest, email, or payload. Malformed values print as
`null`. If `truncated` is true, work the oldest rows first and re-run.

Do not paste customer names or emails into the incident record. The Paddle ids are enough.

## 2. Look the event up in Paddle

Use the Paddle dashboard for the production account (sandbox rows only exist in sandbox):

1. **Developer tools → Notifications**, search the `evt_…` id. Confirm the delivery, its HTTP
   answer (`EVENT_QUARANTINED` 200 or `EVENT_DEPENDENCY_PENDING` 503) and the `ntf_…` id.
2. **Transactions**, open `transactionId` (or `GET /transactions/{txn_id}`). Record status,
   amount, currency, and whether any adjustment/refund already exists.
3. For subscription rows, open `subscriptionId` (or `GET /subscriptions/{sub_id}`) and record its
   status and scheduled change.

If the transaction is not `completed`/`paid`, no money was taken: go to closure with
`operator_no_charge`.

## 3. Decide by reason

| `reason` | `nextStep` | What it means | Action |
| --- | --- | --- | --- |
| `checkout_binding_bootstrap_event_invalid` | `await_redelivery` | Subscription event arrived before its `transaction.completed`; the webhook answered 503 so Paddle retries | Wait for Paddle retries. If the transaction has since applied and the row is still open, **replay** (§4) |
| `checkout_legacy_binding_unassociated` | `repair_or_refund` | Legacy binding with no associated account | Replay only if the account association now exists; otherwise refund or reissue |
| `checkout_intent_expired` | `repair_or_refund` | Paid more than 24 h after checkout was issued | Refund or reissue (§5). Replay will refuse again |
| `checkout_price_not_allowed` | `repair_or_refund` | Paid price is neither the intent's price nor the configured one | Refund or reissue. Replay will refuse again |
| `checkout_intent_missing` | `repair_or_refund` | No checkout intent recorded for the nonce | Refund or reissue. Never insert an intent to make a replay pass |
| `binding_invalid`, `transaction_contract_invalid`, `transaction_subscription_binding_invalid` | `repair_or_refund` | Signed payment without a usable TAVONEL binding (quarantined envelope, `action = ignored`) | Refund or reissue |
| `checkout_account_billing_exempt` | `refund` | A billing-exempt owner paid | Refund. Never revoke the exemption to force a replay |
| `subscription_contract_invalid`, `checkout_intent_mismatch`, `checkout_binding_reuse_conflict`, `checkout_subscription_reuse_conflict`, `checkout_subscription_binding_required`, `checkout_binding_contract_invalid`, anything else | `investigate` | Contract violation or possible tampering | Escalate to the founder with the Paddle ids before any refund |

**Entitlement repair versus refund.** There is no audited function that grants credits or
access outside v6, and nobody writes to `foundation_billing_accounts`, the credit ledger or
`foundation_checkout_intents` by hand. "Repair" therefore means **reissue**: the customer
starts a fresh checkout from the product (which records a new intent and is applied normally), and
the original payment is refunded. When the customer does not want to buy again, refund.

## 4. Replay

Only for rows whose cause has disappeared (dependency ordering, association now present):

- Paddle dashboard → Developer tools → Notifications → the `ntf_…` for this event → **Replay**,
  or `POST /notifications/{ntf_id}/replay`.

Replay resends the same signed payload. v6 either applies it and closes the row with the
projected status, answers `duplicate` and closes it, or refuses again and leaves the row
unchanged (`on conflict do nothing`). Re-run the CLI to confirm. Never replay to "try again" a
reason the table above says will refuse again.

## 5. Refund

A human with Paddle dashboard access, never a script: Transactions → the `txn_…` → Refund (full),
reason "payment could not be applied to an account". Record the `adj_…` id. Paddle's own
`adjustment` webhook then arrives as a normal event; it does not close the rejection row.

For a reissue, confirm the new checkout applied (customer sees the plan, a new
`foundation_billing_events` row exists) before refunding the original.

## 6. Closure

Only after §5 (or `operator_no_charge`), with a second person reviewing the statement, in the
Supabase SQL editor. One row per statement, guarded so it cannot touch an already-closed row:

```sql
update public.foundation_billing_event_rejections
   set resolved_at = now(),
       resolution_status = 'operator_refunded'   -- or operator_reissued, operator_no_charge
 where event_id = 'evt_…'
   and resolved_at is null
returning event_id, reason, resolution_status, resolved_at;
```

Exactly one row must be returned. Record in the incident: event id, reason, Paddle `txn_`/`adj_`
ids, `resolution_status`, operator, reviewer. Re-run the CLI; the row must be gone.

## Escalation

- Any unresolved `purchase`/`allowance` row older than 24 h, or `unresolvedTotal` growing across
  two runs: founder, same day.
- Any `investigate` row: founder before any customer contact.
