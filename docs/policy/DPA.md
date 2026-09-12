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

## Still open, and still not an agent's call

Governing law and jurisdiction (§1) · transfer mechanism and any Standard Contractual Clauses
(§10) · recovery objectives (§9) · liability, precedence and signature blocks (§13) · the
operating entity's registered details (§1). These five are the served document's Annex A, and the
annex is the list -- adding a sixth open clause means adding a row there, not a sixth notice in
the body.

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
