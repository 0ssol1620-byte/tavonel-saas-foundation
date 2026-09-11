# DRAFT — not in force — founder/legal review required

**No support target is published today and none is promised by this document.** Audit item
**O06**.

What exists on the site right now is two addresses: `support@tavonel.com` for service impact and
`security@tavonel.com` for security issues, on `/status` and `/contact`, with no severity tiers,
no response target, no escalation path and no hours of coverage. That is accurate and it is thin.

This draft proposes the smallest target the current team can actually hit. **The reason it is a
draft is that an unmet published target is worse than a published absence** — a buyer who was told
"four hours" and waited a day has been given a broken promise, whereas a buyer told "best effort,
one business day, pilot stage" has been given a fact they can plan around.

- Drafted: 2026-09-11 KST, competitive-audit remediation campaign, lane L9.
- Status: `PROPOSED`.
- Would land on: `/contact` and `/status` (both L9-owned), and nowhere else.

---

## 1. The constraint, stated first

The team is one person. There is no rota, no pager, no out-of-hours path, and no ticketing system
— support is an inbox read by a human. Any target that assumes otherwise is fiction.

This is also why the numbers below are **acknowledgement** targets and never resolution targets.
Acknowledgement is a thing one person can commit to. Resolution depends on the bug.

## 2. Proposed self-service target

For anyone using the service without a written pilot agreement:

> **Best-effort acknowledgement within one business day**, Monday to Friday, KST business hours.
> There is no guaranteed resolution time. Security reports to `security@tavonel.com` are read
> first and are not queued behind product questions.

Three things that sentence deliberately does **not** say:

- It does not say "24 hours". One business day and 24 hours differ by a weekend, and the weekend
  is exactly when the promise would break.
- It does not give a resolution target at any severity. Nothing in the current setup supports one.
- It does not say "24/7", "priority support" or "dedicated". None is true.

`[FOUNDER]` — approve this wording, or lower it. Lowering it is a legitimate answer: "we read
every message and reply as soon as we can, and we do not publish a target yet" is honest and
loses less than a target that is missed.

## 3. What a pilot agreement may say instead

Per-pilot written expectations already exist in individual agreements and are separate from §2.
Keep them separate on purpose: a published self-service target must never be read as the pilot
commitment, and a pilot commitment must never be raised to become the published target.

`[FOUNDER]` — whether the pilot terms are summarized publicly at all. The safest published
sentence is that pilot customers have their own written expectations agreed in the pilot
agreement, with no number.

## 4. Severity, if a tier model is wanted

`[FOUNDER]` — whether to publish tiers at all. A tier table implies triage capacity. With one
person, the table below describes an ordering, not a service level, and publishing it as a level
would be the overclaim this document exists to avoid.

| Customer report | Ordering | Published target |
|---|---|---|
| Suspected security issue, or suspected exposure of their data | First, at any hour it is seen | Acknowledgement on sight; no clock published |
| Cannot use the service at all | Next | Same as §2 |
| A feature is wrong or a result is suspect | Next | Same as §2 |
| Question, or a request for a change | Last | Same as §2 |

An incident the *company* detects is not a support ticket. It follows
`INCIDENT_RESPONSE_RUNBOOK_DRAFT.md`, which has its own severity model, and the two documents must
not be merged: one is about how fast we answer a customer, the other about how fast we tell them.

## 5. Escalation

There is nowhere to escalate to. One person is the first and last line.

The honest published form of that is a sentence, not a table: if a reply has not come within the
stated target, replying to the same thread is the escalation, and the founder reads it.

`[FOUNDER]` — whether to publish a named escalation contact. Publishing a second address that
reaches the same inbox is theatre, and a buyer who tests it will find out.

## 6. Measuring it, before publishing it

A published target that nobody measures degrades quietly. Before §2 goes live:

- [ ] Decide where acknowledgement time is recorded. An inbox is not a measurement.
- [ ] Measure it for a period — `[FOUNDER]` how long — against real messages.
- [ ] Publish the target only if the measurement already meets it.
- [ ] Re-measure whenever the team size changes.

Publishing first and measuring later is how the target becomes a claim with no receipt, which is
the failure mode this repository stops the line for.

---

## Checklist before anything is published

- [ ] Founder approved the §2 wording, or replaced it with a lower one
- [ ] Coverage hours confirmed against what one person will actually do
- [ ] Decided whether tiers (§4) are published at all
- [ ] Acknowledgement time is being recorded somewhere, and the recorded figure already meets the
      target
- [ ] `/contact` and `/status` updated in one commit, with a test pinning the exact target string
      so it cannot be quietly raised
