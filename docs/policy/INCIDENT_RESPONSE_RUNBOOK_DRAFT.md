# DRAFT — not in force — founder/legal review required

**This procedure is not in force.** It is not published, not linked from the site, and nobody is
on call under it. Audit item **S03**.

`/trust` says: "Incident response process — Not yet published… no severity definitions, no
notification window, no post-incident record format." That row stays correct until this document
is approved, a person is actually reachable under it, and the tabletop in §8 has been run.

The single clause with contractual weight is the **customer notification window** (§5). It is
left as `[FOUNDER]` on purpose. A published window is a promise that requires somebody to be
awake, and today the on-call roster is one person with no formal rotation.

- Drafted: 2026-09-11 KST, competitive-audit remediation campaign, lane L9.
- Status: `PROPOSED`.
- Feeds: `DPA_DRAFT.md` §8, and a future public summary on `/trust`.

---

## 0. What counts as an incident

Anything that breaks, or may have broken, one of these: tenant isolation, the integrity of
evidence or a published claim, the availability of the service, or the confidentiality of a
credential. A suspicion counts. The classification in §1 is done on what is suspected, and
downgraded later on the record, never upward-only.

Two distinctions the codebase already draws, and this procedure must not blur:

- **An operational failure and a semantic failure are different incidents.** A pod that died and
  a model that was wrong have different recoveries. Classify which one it is in §1.
- **A failed-closed refusal is not an incident.** The service refusing to emit a world with an
  unresolved link, or an access check denying because it could not complete, is the design
  working. An incident is when something got through that should not have.

## 1. Severity

Severity is set by impact, not by cause or by how hard it is to fix.

### SEV1 — stop the line

Declared for any of: **cross-tenant data exposure** (one workspace's document, excerpt, citation,
export or signed URL reachable by another); **customer data loss** (source material or a promoted
world irrecoverable); **credential compromise** (a service key, signing key, storage credential or
provider token exposed); **an unsupported public claim shipped** (a published number without a
receipt, or evidence overwritten); **a permission revoke that did not take effect**; **runaway
GPU or API spend**.

SEV1 halts feature work. Nothing else ships until it is closed. This mirrors the constitution's
stop-the-line list rather than inventing a second one.

- Response: begin immediately, at any hour.
- Communication: the founder is informed before any remediation that destroys state.
- Customer notification: yes. Window in §5.

### SEV2 — degraded or suspect

Service unavailable or materially degraded for customers; a compile, export, answer or connector
sync failing systematically; a security control disabled or bypassable without evidence of
exploitation; a billing discrepancy that over- or under-charges; a dependency advisory reachable
in production.

- Response: begin within one business day.
- Customer notification: only if customer-visible or if customer data was touched. `[FOUNDER]`
  decides whether SEV2 carries a notification commitment at all.

### SEV3 — contained

A defect with a workaround, a single customer affected without data exposure, a control weakness
found internally with no exposure, a provider degradation TAVONEL absorbed.

- Response: tracked in the normal queue.
- Customer notification: no, unless the customer asks.

**Ambiguity resolves upward.** A suspected cross-tenant leak is a SEV1 until the evidence in §4
says otherwise. The record keeps both the initial and the final classification, with the reason
for the change.

## 2. Roles

`[FOUNDER]` — everything in this table is currently one person. The table exists so that the
roles are separable when there is a second person, and so that a reviewer can see that they are
not separated today. **Do not publish this table as if it described a team.**

| Role | Does | Today |
|---|---|---|
| Incident lead | Declares severity, owns the timeline, decides remediation order, is the single voice | Founder |
| Investigator | Reproduces, scopes blast radius, finds root cause | Founder |
| Evidence custodian | Preserves logs and artifacts before anything is changed (§4) | Founder |
| Communicator | Writes to affected customers and to `/status` | Founder |
| Reviewer | Runs the post-incident review; must not be the person who caused it | **Vacant** |

The vacant reviewer row is the honest gap. An implementation session does not approve its own
work, and by the same rule the person who caused an incident does not sign off its review. Until
there is a second person, a SEV1 review is signed by the founder with that limitation recorded in
the record.

## 3. Reporting in

- `security@tavonel.com` — vulnerabilities and suspected compromise. Also in
  `/.well-known/security.txt`.
- `support@tavonel.com` — service impact.
- Both are read by a person. There is no automated acknowledgement and no pager.

`[FOUNDER]` — whether to add an out-of-hours path (a phone number, a pager, a rota). Without one,
a SEV1 reported at 02:00 is found in the morning, and no notification window shorter than that is
truthfully publishable.

**Never include document contents in an incident email.** `/status` already says this and it
applies internally too: an incident thread must not become a second copy of the data.

## 4. Evidence preservation — before remediation, not after

Remediation destroys evidence. This step comes first, and a SEV1 that skipped it is not closable.

1. **Freeze the clock.** Record the time of detection, the reporter, and what was observed, in
   the words it was observed in.
2. **Capture before changing.** Provider logs for the window, application logs, the request
   identifiers, the workspace keys involved, the object keys and digests involved, the deployment
   revision serving at the time, and the migration head. Copy them out of any store with a
   retention window shorter than the investigation.
3. **Do not rotate or delete yet.** A compromised credential is revoked immediately (that is
   containment, and it comes first for a credential incident), but the record of its use is
   captured before the revoke where the provider allows it.
4. **Preserve, do not correct, historical evidence.** A wrong published number is superseded by a
   correction with its own receipt; the original stays. Overwriting historical evidence is itself
   a SEV1.
5. **No customer document content in the record.** Reference by workspace key, document id and
   digest. The record has to be shareable with a reviewer who is not entitled to the data.
6. **Hash what was captured**, and record the hash in the timeline, so the record can later be
   shown to be the record.

## 5. Customer notification — PLACEHOLDER

**The window is not set.** This is the decision this document exists to raise.

What is drafted is the content, not the clock. A notification says: what happened, when it was
detected, which of the customer's data was involved and which was not, what has been done, what
the customer should do, and who to reply to. It does not speculate about cause, and it does not
state a number that has not been confirmed.

`[FOUNDER]` — pick one, knowing the consequence:

| Window | What it requires | What it costs |
|---|---|---|
| 24 hours from awareness | Someone reachable out of hours | The window a processor is normally asked for; unmeetable today |
| 72 hours from awareness | A daily check | Matches the GDPR **controller** deadline, which leaves a controller-customer no time to meet its own; buyers notice |
| "Without undue delay", no number | Nothing new | Honest for the current team size; reads as evasive in procurement |

Whichever is chosen goes into `DPA_DRAFT.md` §8 and onto `/trust` in the same change, and neither
is written before the other.

Say plainly on `/status` during a SEV1 or a customer-visible SEV2 that an incident is open. A
status page that stays quiet during an outage is worse than one that says "we are investigating".

## 6. Containment and recovery order

1. Stop the exposure. For a cross-tenant leak, that means removing the path, not patching the
   symptom — grep every caller of the function at fault before editing one.
2. Revoke what is compromised. A credential incident revokes first and investigates second.
3. Restore service. The restore path is `docs/runbooks/P0_RETENTION_DELETION_RESTORE.md`; the one
   drill that has been run is the 2026-09-10 database restore.
4. Verify the fix with a test that fails without it, including the failure path. A fix with no
   regression test is not a closed incident.
5. Only then resume normal work.

## 7. Post-incident record — required format

One file per incident, `docs/incidents/YYYY-MM-DD-<slug>.md`, written for a reader who was not
there. `[FOUNDER]` — whether these are ever shared with a customer on request.

```
# <date> — <one line, what happened, not what caused it>

Severity:            SEV1 | SEV2 | SEV3   (initial, if it changed, and why)
Detected:            <timestamp, by whom, how>
Contained:           <timestamp>
Resolved:            <timestamp>
Customers affected:  <count, or none; how it was determined>
Data involved:       <categories; and explicitly what was NOT involved>
Customer notified:   <timestamp, or no + reason>

## Timeline
<one line per event, with times; what was observed and what was done>

## Root cause
<the mechanism, not the person. Name the file and the line.>

## Why it was not caught
<the check that should have failed and did not. This is the useful section.>

## Evidence
<log locations, request ids, digests, captured-artifact hashes. No document contents.>

## Fixes
<shipped: commit + the test that now fails without the fix>
<not shipped: what is still open, and who owns it>

## What is still missing
<state it plainly. Code presence is not completion.>

Reviewed by: <name; and the limitation if it is the same person who caused it>
```

The **"why it was not caught"** section is the reason this format exists. An incident whose record
names only the bug repeats; one that names the missing check does not.

## 8. Tabletop — after this is approved, not before

A drill against a procedure that does not exist tests nothing. Sequence: approve this document →
name the notification window → run the tabletop → publish a public summary on `/trust`.

First exercise, once approved: **a suspected cross-tenant leak.** It is the stop-the-line item,
it is the hardest to scope, and it is the one a buyer will ask whether we have rehearsed.

The drill is scored on the procedure, not on the fix:

- [ ] Severity declared within 15 minutes of the injected report
- [ ] Evidence captured before any remediation
- [ ] Blast radius scoped, with the query that scoped it recorded
- [ ] Notification drafted within the chosen window, with content per §5
- [ ] Post-incident record produced in the §7 format
- [ ] A gap found and written down

A tabletop that finds no gap was not a tabletop. Run it against fixtures and a non-production
project only; never against production data.

`[FOUNDER]` — the cadence after the first one. Quarterly is the common answer, and quarterly is
also a commitment: do not publish a cadence that will be missed.

---

## Checklist before this is in force

- [ ] Founder approved the severity tiers as written
- [ ] Customer notification window chosen (§5), and someone is reachable to meet it
- [ ] Out-of-hours path decided (§3), or its absence accepted and recorded
- [ ] `docs/incidents/` created with the §7 template
- [ ] Tabletop run and its record filed
- [ ] Public summary drafted for `/trust`, and the not-published row flipped in the same commit
      as the `lib/trust-page-answers.test.ts` update
- [ ] `DPA_DRAFT.md` §8 filled in with the same window, not a different one
