# Data Processing Agreement — where the text lives, and what was decided

**The document itself is `nextjs/public/policy/TAVONEL_DPA_v1_2026-09-11.md`**, served at
`https://tavonel.com/policy/TAVONEL_DPA_v1_2026-09-11.md` and linked from `/trust` as
*v1 draft (2026-09-11) — pending legal review; not a signed agreement*.

This file used to be the draft. It is a pointer now, because a DPA written in two places is a DPA
that will disagree with itself, and the copy in `docs/` would be the one a customer never reads.
Edit the served file; this one records only what an agent must not decide again.

- Was: `docs/policy/DPA_DRAFT.md`, status `PROPOSED`, drafted 2026-09-11 KST (competitive-audit
  remediation, lane L9), with every contractual number left as `[FOUNDER]`.
- Now: v1 draft published for reading, with three of those numbers decided by the founder and
  recorded below. Superseded `[FOUNDER]` markers are gone from the served text; the clauses still
  open say *not drafted — pending legal review* in place.

## Decided 2026-09-11, by the founder, and not re-openable by an agent

| Clause | Commitment | Why the number is meetable |
|---|---|---|
| §8 breach notification | Without undue delay, and no later than **72 hours** after becoming aware | 72 hours is what a daily check can meet with no on-call rotation. 24 hours was the alternative and it needs a rota that does not exist. The runbook states the same window and the same reason. |
| §6 sub-processor change | **30 days** in advance of processing, with a right to object | `/subprocessors` already commits to recording a material change before it applies to live processing; this puts a number and an objection right on it. |
| §7 deletion | Completed **within 30 days** of a verified request | The commitment is on the live systems TAVONEL operates, carried out by a person. It is explicitly not a commitment on a provider's backup expiry, which is unmeasured and still carries no day count. |

The earlier draft's reasoning for leaving all three blank is preserved here on purpose, because it
is the argument a reviewer will re-make: an unmeasured number in a signed contract is a promise
nobody has tested. What changed is not the argument but the authority -- the founder decided, and
these are version-1 commitments that move only with a new version of the served document.

## Still open, and still not an agent's call

Governing law and jurisdiction (§1) · transfer mechanism and any Standard Contractual Clauses
(§10) · recovery objectives (§9) · liability, precedence and signature blocks (§13) · the
operating entity's registered details (§1).

## What must change together

- The served DPA, `/trust`'s row for it, and `nextjs/lib/trust-page-answers.test.ts` -- one commit.
- `/privacy`, `/subprocessors`, `/security` and `/terms` are the statements in force. A DPA clause
  that contradicts one of them is the error, not the page.
- §8's window and `INCIDENT_RESPONSE_RUNBOOK.md` §5 are the same number. Changing one without the
  other is the failure both documents were written to prevent.
