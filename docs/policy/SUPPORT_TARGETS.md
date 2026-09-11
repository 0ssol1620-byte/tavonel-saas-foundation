# Support targets — published 2026-09-11

**One target is published: acknowledgement within 1 business day (KST).** Nothing else is. There
is no resolution-time commitment at any severity, no tier table, no coverage guarantee and no
escalation path, and each of those absences is deliberate and explained below. Audit item **O06**.

The published sentence lives in exactly one place in the code —
`nextjs/lib/support-targets.ts`, exported as `SUPPORT_ACKNOWLEDGEMENT` — and `/status` and
`/contact` both render that constant. `nextjs/lib/support-targets.test.ts` fails if either page
pastes the words instead of importing them, if the sentence loses "within 1 business day (KST)",
or if it grows a resolution time. A target written twice is a target that will disagree with
itself, and a target nobody pins is a target that gets quietly raised.

**Why one business day and not 24 hours**: they differ by a weekend, and the weekend is exactly
when the promise would break. Why acknowledgement and never resolution: acknowledgement is a thing
one person can commit to, and resolution depends on the bug.

- Drafted: 2026-09-11 KST, competitive-audit remediation campaign, lane L9.
- Published: 2026-09-11, website-growth campaign, lane trust-policy.
- Set by: **delegated decision, 2026-09-11 (orchestrator, under the founder's delegation) — see
  `docs/policy/DECISION_LOG_2026-09-11.md`** (FD-09). Not the founder's own statement; the founder
  may lower, raise or withdraw the target, and a reversal is a new entry in that log.
- Status: §2 `PUBLISHED_UNDER_DELEGATION`. §3–§6 `NOT PUBLISHED` and each says why.
---

## 1. The constraint, stated first

The team is one person. There is no rota, no pager, no out-of-hours path, and no ticketing system
— support is an inbox read by a human. Any target that assumes otherwise is fiction.

This is also why the numbers below are **acknowledgement** targets and never resolution targets.
Acknowledgement is a thing one person can commit to. Resolution depends on the bug.

## 2. The published self-service target

For anyone using the service without a written pilot agreement, on `/status` and `/contact`:

> Email to support@tavonel.com is acknowledged within 1 business day (KST). That is an
> acknowledgement target and not a resolution time: no resolution time is committed, and security
> reports to security@tavonel.com are read first rather than queued behind product questions.

Read the exact string from `nextjs/lib/support-targets.ts`; the block above is a quotation and the
constant is the source.

Four things that sentence deliberately does **not** say:

- It does not say "24 hours". One business day and 24 hours differ by a weekend.
- It does not give a resolution target at any severity. Nothing in the current setup supports one.
- It does not say "24/7", "priority support" or "dedicated". None is true, and the test bars all
  three from the constant.
- It does not promise a coverage window beyond the business day the target is counted in. There is
  no rota; see §1.

**This target is published ahead of its measurement** (§6), and that is the one honest weakness in
it. The acknowledgement time is not recorded anywhere today, so the figure is a commitment rather
than an observation. It is publishable because it is the weakest target a single reader of a single
inbox can keep, not because a measurement says it is met.

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
`INCIDENT_RESPONSE_RUNBOOK.md`, which has its own severity model, and the two documents must
not be merged: one is about how fast we answer a customer, the other about how fast we tell them.

## 5. Escalation

There is nowhere to escalate to. One person is the first and last line.

The honest published form of that is a sentence, not a table: if a reply has not come within the
stated target, replying to the same thread is the escalation, and the founder reads it.

`[FOUNDER]` — whether to publish a named escalation contact. Publishing a second address that
reaches the same inbox is theatre, and a buyer who tests it will find out.

## 6. Measuring it — owed, not done

A published target that nobody measures degrades quietly, and this one is published without a
measurement behind it. The order was meant to be the other way round. Recorded here as the debt it
is rather than deleted now that the sentence is live:

- [ ] Decide where acknowledgement time is recorded. An inbox is not a measurement.
- [ ] Measure it for a period — `[FOUNDER]` how long — against real messages.
- [ ] Compare the recorded figure with the published target, and lower the target if it is missed.
- [ ] Re-measure whenever the team size changes.

Publishing first and measuring later is how a target becomes a claim with no receipt. What keeps
this the smaller version of that failure is that the target is an acknowledgement, it is the
weakest one a single inbox reader can keep, and missing it costs a correction rather than a breach
of contract — a pilot agreement's expectations are separate (§3). It is still the thing in this
document most likely to be found untrue, and the measurement is the only thing that settles it.

---

## Still open

- [ ] Acknowledgement time is being recorded somewhere, and the recorded figure meets the
      published target (§6)
- [ ] Coverage hours confirmed against what one person will actually do (§1)
- [ ] Whether tiers (§4) are published at all
- [ ] Whether a named escalation contact is published (§5) — publishing a second address that
      reaches the same inbox is theatre
- [ ] Whether pilot terms are summarized publicly at all (§3)

Done 2026-09-11: the §2 wording is published on `/contact` and `/status` from one constant, with
`nextjs/lib/support-targets.test.ts` pinning the exact string so it cannot be quietly raised.
