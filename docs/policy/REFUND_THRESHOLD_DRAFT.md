# Refund threshold — numbers fixed by the owner, legal review of §5 still open

**The owner fixed the two numbers on 2026-09-11: a 14-day window and a 10% consumed-pages
line.** They now live as `REFUND_WINDOW_DAYS` and `REFUND_MAX_CONSUMED_FRACTION` in
`nextjs/lib/billing-catalog.ts`, and `/pricing` and the billing documentation render them rather
than restating them. Audit item **P07**.

What is *not* settled is §5, which is a lawyer's to answer, and the live `/refunds` template,
which still carries the "substantial processing" sentence this record was opened against — that
page is outside the lane that landed these numbers, and its patch is in the lane report. The
sections below keep the reasoning as it was written, so the decision can be read against the
argument that produced it.

The live refund template says:

> "Refund eligibility may be limited after substantial processing has been consumed, custom
> services begin with your consent, or immediately supplied digital content is fully delivered,
> but mandatory consumer rights always prevail."

"Substantial processing" is defined nowhere in the codebase. It is a judgement call presented as a
rule, and a buyer cannot tell before purchase whether their intended use would forfeit the refund.
That is the audit's finding, and it is not a finding that the clause is unlawful.

It is also currently unreachable: `liveChargesEnabled` is false, so `/refunds` renders the pilot
template, which correctly says nothing can be charged and there is nothing to refund. **The text
above ships verbatim the moment checkout opens**, which is why this is worth settling now rather
than on launch day.

- Drafted: 2026-09-11 KST, competitive-audit remediation campaign, lane L9.
- Status: `PROPOSED` until 2026-09-11, then `DECIDED` at 14 days / 10% by the owner, website-growth
  campaign, lane `entitlements` (E4). Legal review of §5 is still required before the live
  `/refunds` template changes.
- Landed on: `nextjs/lib/billing-catalog.ts` (the two constants), `/pricing` and the
  `billing-and-limits` documentation block, which render them.
- Still to land on: `nextjs/app/refunds/page.tsx`, live template only.

---

## 1. What the product actually meters

From `lib/billing-catalog.ts`, which is the single place a plan's public claims are written:

| Plan | Price | Included pages | Credits | Sale channel |
|---|---:|---:|---:|---|
| Developer (`observer_access`) | $29 | 500 | 2,000 | self-serve |
| Team (`studio_access`) | $99 | 2,500 | 10,000 | contact (until membership ships) |

So there are two countable quantities a bright line can use — **pages consumed** against the
plan's included pages, and **whether a world has been promoted to active** — and the second is the
moment the customer receives the thing they bought, because promotion requires a person to approve
it and produces the compiled world and its signed export.

A percentage of pages is measurable from data the service already has. A "promoted world" is a
single recorded event. Both are checkable by the customer before they buy and by us afterwards.

## 2. The bright line, as decided

> **Within 14 calendar days of payment you may request a full refund**, provided fewer than **10%
> of the plan's included pages** have been consumed at the time you ask — 50 pages on Developer,
> 250 on Team. Past that line the payment is not refunded. Unused pages are not refunded on
> cancellation. Subject to the terms as updated.
>
> Your statutory rights are unaffected: a service that is defective, was not as described, or was
> unavailable is refunded regardless of how much of it you processed, and is assessed separately
> from this window.

Two things the proposal had that the decision does not.

The **promotion condition is gone.** The draft would have declined a refund once a world had been
promoted to active, on the reasoning that promotion is delivery. It is also the single action this
campaign has just opened to the self-serve Developer plan (E1), which makes a first promotion both
the thing we want a new customer to do and the thing that would forfeit their refund. One
countable quantity, stated once, is the line.

The **percentage moved from 20% to 10%**, which is the generous end of the trade the draft laid
out — a real evaluation fits inside it, and it does not require a customer to reason about what
"substantial" means:

| Threshold | Effect |
|---|---:|
| Any processing at all | Simplest to state, harshest — a customer who tried one document forfeits |
| **10% (50 / 250 pages)** | Decided; a real evaluation fits inside it |
| 20% (100 / 500 pages) | Was proposed; a genuine trial fits, a full corpus run does not |
| 50% | Half the value delivered before the line; hard to defend as "substantial" being *reached* |

`[LEGAL]` — the number is fixed, §5 is not. The figures in the table are computed from the
catalog's `includedPages`, not typed into the copy.

## 3. Why a bright line rather than a better adjective

Three reasons, in the order they matter.

1. **A buyer can check it before paying.** "Substantial" cannot be checked at all. A percentage
   and an event can.
2. **It removes the judgement call from the moment of dispute.** The current wording is decided
   by whoever answers the email, under pressure, with an unhappy customer. A number decides
   itself.
3. **It is enforceable by something.** A threshold in prose drifts; a threshold as a constant has
   a test. If this is approved, it lands as a single exported constant with the percentage and the
   promotion condition, the page renders it rather than restating it, and `refunds.test.ts` pins
   the rendered string — the pattern `plan-entitlement.test.ts` already uses to stop a plan bullet
   promising what no route enforces.

## 4. What must not change

- **"Mandatory consumer rights always prevail" stays.** Korean and EU consumer law override a
  voluntary policy, the current sentence says so, and no threshold replaces it.
- **The defect path stays separate.** A broken or misdescribed service is not a usage question,
  and the current copy already assesses it independently of the 14-day window. Keep that
  separation: a bright line on consumption must never read as a cap on a defect claim.
- **Paddle is merchant of record** and processes approved refunds to the original payment method.
  That sentence is factual and stays.
- The 3–5 working day appearance note stays, with "payment-provider timing can vary".

## 5. Open questions a lawyer has to answer

`[LEGAL]` — this is the section an agent must not resolve.

1. **Digital-content withdrawal exceptions.** EU and Korean rules both allow a consumer to lose
   the withdrawal right for digital content supplied with their express consent and
   acknowledgement — but only if that consent was obtained correctly at checkout. Does the
   proposed threshold survive that, and does checkout need to collect an explicit acknowledgement
   for it to?
2. **Is a percentage of a metered allowance "digital content fully delivered"**, or is it partial
   performance of a service? The two get different treatment, and the right clause depends on the
   answer.
3. **Is a promoted world a delivered deliverable?** The customer keeps the signed export; that
   looks like delivery. Confirm.
4. **Does a per-renewal reset need stating?** The draft says "on the current billing period";
   confirm that is the right frame for a subscription rather than a lifetime count.
5. **Which jurisdictions are in scope at launch**, since the answer changes with the customer
   base.

## 6. Sequencing

This clause is unreachable until `liveChargesEnabled` is true. Ordering:

1. `[LEGAL]` reviews §2 and answers §5.
2. `[FOUNDER]` fixes the percentage.
3. The threshold lands as a constant, the live template renders it, and a test pins the string.
4. Checkout must show the same wording before a payment method can be entered — which is already
   what the pilot template promises: "Cancellation and refund terms will be published here, and
   presented at checkout, before any payment method can be entered."
5. Only then does live checkout open.

A number shipped without step 1 is a legal exposure, and shipping the current vague sentence at
launch is the same exposure with worse optics. Neither is an agent's call.

---

## Checklist before the live template changes

- [ ] Legal reviewed §2 and answered §5; jurisdictions in scope named
- [x] Founder fixed the percentage — **10%**, 2026-09-11, with the 14-day window
- [x] Threshold exists as exported constants, not as prose in two places
      (`REFUND_WINDOW_DAYS`, `REFUND_MAX_CONSUMED_FRACTION`, `refundablePageAllowance`)
- [x] `/pricing` and the `billing-and-limits` documentation block render them
- [ ] `/refunds` live template renders them — patch in the lane report, not this lane's path
- [ ] A test pins the rendered `/refunds` threshold string and fails if it is silently changed
- [ ] Checkout presents the same wording before a payment method can be entered
