# Data Processing Agreement — where the text lives, and what was decided

**The document itself is `nextjs/public/policy/TAVONEL_DPA_v1_2026-09-11.md`**, served at
`https://tavonel.com/policy/TAVONEL_DPA_v1_2026-09-11.md` and linked from `/trust` as
*Draft v1 (2026-09-11) — under review; not a signed agreement*. That label is customer wording
under the decision log's "Public wording of delegated values" section: the delegated-decision
provenance is recorded here and in the log, never printed on a public page.

This file used to be the draft. It is a pointer now, because a DPA written in two places is a DPA
that will disagree with itself, and the copy in `docs/` would be the one a customer never reads.
Edit the served file; this one records only what an agent must not decide again.

- Was: `docs/policy/DPA_DRAFT.md`, status `PROPOSED`, drafted 2026-09-11 KST (competitive-audit
  remediation, lane L9), with every contractual number left as `[FOUNDER]`.
- Now: v1 draft published for reading, with three of those numbers set as a **delegated decision,
  2026-09-11 (orchestrator, under the founder's delegation) — see
  `docs/policy/DECISION_LOG_2026-09-11.md`** (FD-06/07) and recorded below. Superseded
  `[FOUNDER]` markers are gone from the served text; the clauses completed at signature are
  marked in place as *to be specified in the executed version* and are collected in the served
  document's **Annex A** (BA-170: four separate "not drafted" notices read as an abandoned
  document, and the reasoning that stood in for three of the clauses was a founder's memo rather
  than a clause).

## Delegated decision, 2026-09-11, and not re-opened by an agent on its own

**Who decided this.** Not the founder. The three numbers below were chosen by the orchestrating
agent under the delegation the founder gave in the 2026-09-11 working session, recorded in
`docs/policy/DECISION_LOG_2026-09-11.md` (FD-06/07). The founder may confirm, change or reverse
any of them, and a reversal is a new entry in that log. Nothing here is the founder's own
statement, and no copy anywhere may present it as one.

| Clause | Commitment | Why the number is meetable |
|---|---|---|
| §8 breach notification | Without undue delay, and no later than **72 hours** after becoming aware | 72 hours is what a daily check can meet with no on-call rotation. 24 hours was the alternative and it needs a rota that does not exist. The runbook states the same window and the same reason. |
| §6 sub-processor change | **30 days** in advance of processing, with a right to object | `/subprocessors` already commits to recording a material change before it applies to live processing; this puts a number and an objection right on it. |
| §7 deletion | Completed **within 30 days** of a verified request | The commitment is on the live systems TAVONEL operates, carried out by a person. It is explicitly not a commitment on a provider's backup expiry, which is unmeasured and still carries no day count. |

The earlier draft's reasoning for leaving all three blank is preserved here on purpose, because it
is the argument a reviewer will re-make: an unmeasured number in a signed contract is a promise
nobody has tested. What changed is not the argument but who was entitled to settle it -- a
delegated decision was taken, and these are version-1 commitments that move only with a new
version of the served document or a reversal in the decision log.

## Delegated decision, 2026-09-16 (SD-07), and what it took out of Annex A

**Who decided this.** Not the founder. Four of the five clauses listed as open on 2026-09-11 were
settled on 2026-09-16 by the orchestrating agent under the delegation recorded in
`docs/policy/DECISION_LOG_2026-09-16.md` (SD-07). The founder's counsel review is still required
and is still pending; the served document carries **Draft v1 — under review** and says in its own
first lines that no lawyer has read it.

| Clause | Draft v1 term | Why this term |
|---|---|---|
| §1 Governing law | The Republic of Korea, with the Seoul Central District Court as the court of exclusive jurisdiction | The operator, the entity and the database are in Korea. `/terms` states the same law and the same court as of the same date, so the two documents cannot send one dispute to two places. A consumer's home-court right is preserved in both. |
| §1 Party block | The registered name, representative, registration number and address are the ones published in the operator disclosure | G2-019. The clause said the operator disclosure "is not published in the pilot deployment" while `/terms`, `/privacy`, `/subprocessors` and every legal footer publish it. Three documents said three different things about one legal fact. |
| §10 Transfer mechanism | The EU Standard Contractual Clauses of 4 June 2021 — Module Two controller-to-processor, Module Three for onward transfer — with the UK International Data Transfer Addendum for a transfer from the United Kingdom | G2-018. No EEA or UK buyer could sign a DPA whose transfer mechanism was deferred to an annex. The modules are the only ones this relationship can be: the customer is the controller of the personal data in their documents and TAVONEL is the processor. The completed annexes and the transfer impact assessment stay at signature. |
| §13 Liability | Capped at the fees paid in the twelve months before the event, with the non-excludable carve-outs, and stated as one limit shared with the service terms rather than two | `/terms` gained the same cap on the same day under the same decision. Two caps for one relationship is how a customer recovers twice for one set of facts, or spends the dispute arguing about which applies. |

`nextjs/lib/trust-page-answers.test.ts` was updated in the same commit: the guard pins an open
clause to its in-place marker and a settled clause to the words that settle it, and it now also
checks the DPA's cap against the cap rendered on `/terms`. That file belongs to the trust-content
lane, and the edit is recorded as a cross-lane note in `reports/LANE_commerce-legal.md`.

## Still open, and still not an agent's call

Recovery objectives (§9) · the completed SCC and UK Addendum annexes, including the transfer
impact assessment (§10) · the signature blocks and the parties' registered details as they appear
on the executed version (§13). These three are the served document's Annex A, and the annex is the
list -- adding a fourth open clause means adding a row there, not a fourth notice in the body.

Above all of it: none of the 2026-09-16 wording has been read by a lawyer. The founder's counsel
review is the gate, and until it returns the served document is a draft that says so.

Two customer-facing disclosures came off the served text on 2026-09-12 and are recorded here
instead. BA-168: §4's confidentiality clause no longer states that the number of people with
production access is one -- the obligation is unchanged, the count added nothing a customer could
act on, and it published the size of the company. §8 keeps the staffing disclosure, because it is
the honest reason the window is 72 hours rather than 24, in customer wording. BA-146: the paragraph
saying nothing in the draft was agreed by the operating entity yet is gone; the draft label at the
top of the document and the "new version, not an edit" rule say what a reader needs.

## What must change together

- The served DPA, `/trust`'s row for it, and `nextjs/lib/trust-page-answers.test.ts` -- one commit.
- `/privacy`, `/subprocessors`, `/security` and `/terms` are the statements in force. A DPA clause
  that contradicts one of them is the error, not the page.
- §8's window and `INCIDENT_RESPONSE_RUNBOOK.md` §5 are the same number. Changing one without the
  other is the failure both documents were written to prevent.
