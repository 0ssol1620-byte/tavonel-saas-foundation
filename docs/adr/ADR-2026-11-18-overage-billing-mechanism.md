# ADR-2026-11-18 — How usage past an allowance is billed (overage mechanism)

- **Status:** proposed, 2026-11-18. The lead decides (decision E-4 of
  `v34-lanes/workorders/all-features/E-unsized-features.md` §14). This record states the options, how each one
  fails and how each is rolled back. It does not take the decision, and it changes no code, price or public sentence.
- **Work order:** WO-E-BIL-0. It unblocks WO-E-BIL-1 (consent, cap, ledger), BIL-2 (period close to Paddle),
  BIL-3 (customer surface) and BIL-4 (canary). Those four are tier A (money). This record is not.
- **Base read:** `codex/v34-fnd-int` at `e9364899`. A `file:line` below is at that commit. `MP:n` is a line of
  `TAVONEL_CANONICAL_MASTERPLAN_V5_6_V34_2026-11-16.md`. `P1`–`P5` are the Paddle pages in
  `v34-lanes/receipts/WO-E-BIL-0/PADDLE-READS.md`. These were read through an extraction tool and are not
  byte snapshots.

## 1. What binds the choice

- **Rates.** `nextjs/lib/billing-catalog.ts:48` sets
  `METER_RATES_USD = { pcu: 0.04, kqu: 0.006, storageGbMonth: 0.2, seatMonth: 15 }`. The comment at `:47` says
  "nothing bills past an allowance yet". The price book is `PRICE_BOOK_VERSION = "PB-2026-11-V22"` (`:23`). This
  record copies no other rate.
- **Allowances.** Personal `:55`, Developer `:77`, Team `:99` and Business `:120`. Free has no included units in
  code (`PRICE_BOOK_EXTRA`, `:260-263`). Its quotas are only in MP:1768.
- **What is sold.** Team and Business require `per_member_source_scopes` (`:106`, `:127-130`). `DELIVERED`
  (`:36-45`) does not contain it, so `planAvailability` (`:300-309`) keeps both at `request_access`. Only
  Personal and Developer can be bought.
- **Blueprint contract.** The blueprint says:
  - "Free plan stops at limit and cannot opt into overage … Paid plans default hard stop; opt-in maximum
    separately" (MP:1775).
  - "no unapproved overage; reservation not charge" (MP:1689).
  - "Do not bill both included units and extra overage; users may choose automatic upgrade only with explicit
    consent" (MP:1762).
  - "COMPILE_PCU | prepaid/consented usage capacity pack or overage" (MP:1749).
  - Seats are "Team/Business only" (MP:1775).
  - Its QA list names "overage opt-in inversion", "refund negative ledger", "per-unit rounding and prorate",
    "past due/cancel grace" (MP:1871).
- **Hard stops today.**
  - KQU returns 402 `KQU_ALLOWANCE_EXHAUSTED` before retrieval (`nextjs/lib/kqu-meter.ts:98`).
  - Storage is refused at intake admission (`nextjs/lib/intake-admission.ts:78`).
  - Seats are refused at invite (`nextjs/lib/workspace-membership.ts:80`).
  - PCU is the exception, see §2.

## 2. What already exists, and a default the decision must reverse

- **Overage switches itself on.** Migration `0036_maximum_reservation_and_overage.sql:23-46` adds a trigger
  that sets `foundation_billing_accounts.overage_enabled = true` whenever an `allowance` row is written to the
  credit ledger. Every paid subscription therefore has overage on from its first grant, and the customer never
  opted in. `supabase/tests/foundation_page_meter.sql:120` pins this: "An allowance grant turns overage on
  (0036)."
- **Overage already accrues.** With that flag on, page settlement caps a paid read at the per-document maximum the
  customer approved in the quote rather than at the hold. The part above the hold accrues to `overage_units`
  (`supabase/migrations/20261117120000_page_meter_settlement.sql:214-231`).
- **Nothing bills it yet.** ADR-0005 known limit 4 records the gap: "nothing drains `overage_units` today". It
  also records that a re-charge can land in `overage_units` on an account with overage off.
- **Consequence for every option below.** `overage_units` and `overage_enabled` are not consent. If anything
  billed them as they stand, that would be the blueprint's "opt-in inversion" (MP:1871). The per-document quote
  approval does not stand in for the account-level "opt-in maximum separately" (MP:1775).
- **The Paddle webhook parser expects one line of quantity 1.**
  - `itemPriceIds` drops every line whose `quantity !== 1` (`nextjs/lib/paddle-billing-event.ts:125-131`).
  - `transaction.completed` is ignored unless exactly one price remains (`:148`).
  - Any approved `refund`, `credit`, `chargeback` or `chargeback_warning` reverses the **whole** transaction
    (`:24`, `:210-221`). The 0036 trigger then turns overage off (`0036…sql:35-37`).

## 3. Options

### (a) Post-paid opt-in with a cap, billed as a Paddle one-time charge on the subscription

How it works:

- The customer opts in per meter and sets a cap.
- Usage past the allowance is admitted only inside an active consent and below the cap.
- At period close, each meter's settled units become one one-time charge (`POST /subscriptions/{id}/charge`, P1).

Paddle offers two variants:

- **a1 `next_billing_period`:** the charge rides the renewal transaction (P1, P2).
- **a2 `immediately`:** a separate transaction is created and collected at period close (P1, P2).

Failure modes:

1. **a1 ties the plan renewal to the overage payment.** Overage lines are added to the renewal transaction
   (P2: "alongside recurring items"). If that payment fails, the plan renewal fails with it. The subscription
   goes `past_due`, and `checkout-policy.ts:100` then sends the customer to the portal. a2 isolates the payment,
   but it puts a second charge on the customer's card each month. P1 does not establish whether a failed `a2`
   charge moves the subscription to `past_due`. A sandbox run must answer that before BIL-2 is built.
2. **Refusal windows.** Paddle refuses a charge on a `past_due` subscription and within 30 minutes of the next
   billing period (P1, P2). Paused, canceled and trialing were not covered on the pages read.
   - The overage of a canceled subscription's last period has no "next billing period" for a1.
   - Each refused or uncollectable period needs a rule: either the rows stay pending and consent is paused
     (BIL-2 already proposes this for `past_due`), or the period is written off. Rows must never be silently
     dropped.
3. **The webhook breaks the renewal grant (§2).**
   - Under a1, an overage line of quantity N > 1 is dropped silently. The plan is granted, and the overage is
     invisible to the ledger.
   - An overage line of quantity 1 makes two prices, so the whole renewal is ignored and the allowance is not
     granted.
   - A partial refund of the overage line reverses the entire renewal allowance and switches overage off.
   - BIL-2 must change the parser so it accepts exactly one recurring plan line plus the overage lines that
     TAVONEL itself created, and must reverse only the adjusted line. That makes BIL-2 a change to the money
     path, not an addition beside it.
4. **Rounding.** Paddle unit prices are whole cents (P3). KQU at `0.006` USD (`billing-catalog.ts:48`) is 0.6
   cents, so a per-KQU catalog price cannot exist. The choices are:
   - (i) a per-block price, for example 1,000 KQU, which raises the question of how a partial block is billed;
   - (ii) one non-catalog line per meter whose amount is computed and rounded once per period.
   PCU (4 c), storage (20 c) and seats are whole cents. Whatever the rule, it never bills more than
   rate × units consumed.
5. **Quantity cap.** A catalog price defaults to quantity 1–100 (P3). Its maximum must be set at or above the
   largest cap a customer may set, and the limit is 999,999,999.
6. **Tax.** The price `tax_mode` defaults to the account setting (P3). This record did not read whether the
   TAVONEL account prices inclusive or exclusive of tax. MP:1777 says the overage examples are "before tax".
7. **Refunds and disputes.**
   - A refund is a `partial` adjustment of a `completed` transaction, and on live it is usually `pending_approval`
     (P4).
   - A chargeback is created by Paddle against the whole transaction (P4). Under a1 that includes the plan.
   - Negative ledger rows must post only on `approved`, not before.
8. **Collection risk sits with TAVONEL.** Units are delivered before they are paid for. The cap limits the
   exposure: the period's maximum debt per workspace is cap × rate.
9. **Meters without a measure.** Storage at `storageGbMonth` needs a GB-month integral. The storage meter only
   caps the bytes stored at admission (`billing-catalog.ts:41`), so no GB-month figure exists. Seat overage
   applies only to Team and Business, which are not sold (§1).

Rollback:

- Revoke every consent. Admission then returns to hard stop at once, and nothing new accrues.
- Revert the flip commit (BIL-3).
- Charges already billed stay billed and are refunded through P4 if needed.
- The ledger keeps its rows: they are history, not deleted.

### (b) Prepaid capacity packs

How it works: the customer buys a fixed block (for example N PCU) as a one-time purchase. Usage past the
allowance draws from the pack, and when the pack is empty the meter is a hard stop again.

Failure modes:

1. **No collection risk, but forecasting moves to the customer.** They must guess the size, and unused pack units
   need an expiry and refund rule. The 14-day / 10% rule (`billing-catalog.ts:239-240`) covers plans, not packs.
   A new founder-level term is needed.
2. **The parser needs only a small change.** It already has a `purchase` branch for non-subscription offers
   (`paddle-billing-event.ts:165-167`), and a pack is one line of quantity 1. A PCU pack fits `credit_balance`.
   KQU and storage packs need their own balance, because today both are allowance counters, not balances.
3. **Not past the cap mid-period without a purchase.** A customer at the limit is still stopped until they buy.
   That keeps the blueprint's default but is not "overage" in the MP:1775 sense.
4. **Packs and plan allowance must not double-count** (MP:1762). The draw order is allowance first, then pack.

Rollback: stop selling packs. Packs already sold stay drawable until used, expired or refunded.

### (c) Automatic plan upgrade with consent

How it works: the customer consents in advance to move up one plan when an allowance runs out (MP:1762).

Failure modes:

1. **There is no purchasable plan to move to.** Above Personal is Developer, which differs mainly in KQU
   (`:55` vs `:77`). Above Developer, Team and Business are `request_access` (§1). Option (c) cannot be built
   until Team is sold.
2. **The step is large.** Personal $29 to Team $199 (`:54`, `:98`) for a small overrun breaks "fair pricing".
3. **Proration and downgrade-on-renewal** rules are needed. P1–P5 did not cover them for plan changes.

Rollback: switch auto-upgrade off. Upgraded subscriptions stay on their plan until the customer changes it.

### (d) Keep the hard stop (status quo)

Nothing changes. Every meter stays a hard stop, and `/pricing` keeps "Request access" on overage. This is the
rollback target of (a), (b) and (c). It does not close the "Done means" of §8 in the cluster file.

## 4. Recommendation (for the lead to accept or replace)

E-4 as written in the cluster file is **(a) with (b) as fallback**. This record supports that, with five
conditions that the facts above force, whichever variant is chosen:

1. **Consent is a new row, never the existing flag.** BIL-1's `foundation_overage_consents` is the only source
   that makes a unit billable.
   - Units in `overage_units` without an active consent covering them are never billed. They become a billing
     hold or are forgiven, and ADR-0005 limit 4 already requires this.
   - The 0036 auto-enable trigger is replaced in BIL-1's migration so that a plan grant no longer turns overage
     on.
   - BIL-1's 1,000-event replay includes "allowance granted, no consent → no billable unit".
2. **Meters in v1: PCU and KQU only.** Storage has no GB-month measure. Seats apply only to plans that are not
   sold. Both stay hard stop and are named as such on the BIL-3 surface.
3. **Variant a1 vs a2 is decided by one sandbox run in BIL-2, before its code.** The run checks whether a
   failed a2 charge sets `past_due`, and what a1 does to the renewal when the overage line fails.
   Starting value: **a2** (`immediately` at period close). It keeps a failed overage payment away from the plan
   renewal and the allowance grant, which is the coupling in §3(a) items 1 and 3. If the run shows a2 drives the
   subscription to `past_due` anyway, a1 and a2 are equivalent on that point and a1 (one charge per month) wins.
4. **Rounding: one line per meter per period, amount = floor(units × rate) to the cent.** The sub-cent remainder
   is not carried and not billed. The ledger keeps exact units, and the charge records the price-book version.
5. **Fallback trigger for (b):** BIL-2's reconciliation shows uncollected overage periods (refused `past_due`, or
   a failed collection) above a share the lead sets at BIL-4. Option (c) is not a fallback until Team is sold.

## 5. What this record does not decide

- Public wording, consent wording, the cap UI, and terms. These belong to BIL-3 and the lead under the
  2026-11-09 delegation, recorded in the ledger.
- Prices. Rates stay as `billing-catalog.ts:48` has them.
- Anything live. BIL-4's real-money charge is confirmed with the founder in chat first (E-5).

## 6. Not established

- Paddle behaviour for paused, canceled and trialing subscriptions on a one-time charge.
- Whether `on_payment_failure` applies to a charge, and what a failed renewal does to its one-time lines.
- The TAVONEL account's tax mode.
- Live refund approval time, and the dunning schedule.

All of these are answered in sandbox at BIL-2, which needs the founder-typed sandbox key (WO-EXT-04).
