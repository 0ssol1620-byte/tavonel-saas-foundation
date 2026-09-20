# B33 home outcome IA task study protocol

Status: `PREPARED_NOT_RUN`
Participants recorded: `0`
Results recorded: none
Founder visual review: **FOUNDER VISUAL REVIEW REQUIRED**

## Purpose and current boundary

Test whether the canonical site home route helps a prospective buyer understand the result and verify one result from its exact source. This bundle prepares the route copy, cross-surface publishing contract, evidence contract, and study validator. It does not report that a person completed either task.

The current `components/landing-v2/landing-page.tsx` nine-scene structure remains intact. Its copy is reconciled around customer tasks: understand the outcome, inspect a finished result, check accepted sources, verify evidence, inspect change, understand the compiler contract, choose a next task, check deployment boundaries, and choose the next step.

The full current files are staged directly. No old apply-patch envelope is assumed to apply.

## Participants and consent

Recruit people from intended knowledge-operations, AI-platform, research, or document-heavy buyer segments. Record a pseudonymous participant ID and segment only after consent. Do not store names, email addresses, employers, source document contents, or direct identifiers in this record.

Synthetic users, agent runs, author walkthroughs, and automated tests do not count as participants. With zero real participants, all of the following are mandatory:

- `status: PREPARED_NOT_RUN`
- `participant_count: 0`
- `participants: []`
- `aggregate_results: null`

## Session context

Record locale, viewport width, reduced-motion preference, input mode, build identifier, and network profile for every participant. Keep those conditions stable within a session. Keyboard-only and reduced-motion observations may be reported as separate cohorts; do not pool them silently with pointer/default-motion sessions.

The visual QA plan remains `1920 · 1440 · 1280 · 1024 · 768 · 390 · 360`, plus reduced motion. Automated checks do not replace founder review.

## Task one: 30-second comprehension

Start at `/` in a clean browser session. Do not explain TAVONEL. Allow exactly 30 seconds of unaided viewing, stop interaction, and ask:

> What could you accomplish with this product, and what would let you check whether its result is supported?

Record the response verbatim. A `PASS` requires all of these facts in the record:

1. `elapsed_seconds <= 30`
2. `response_verbatim` is non-empty
3. `outcome_identified: true`
4. `verification_mechanism_identified: true`
5. `moderator_prompted: false`
6. non-empty observer notes

The intended outcome is materially equivalent to compiling source material into structured, usable knowledge. The verification mechanism is materially equivalent to tracing a result to a source page and region. Do not coach, paraphrase toward a pass, or infer an unstated concept.

## Task two: two-minute proof verification

Reset to `/` and give this instruction:

> Use this page to inspect one finished result and open the exact source location that supports one answer.

Allow exactly 120 seconds. A `PASS` requires all of these facts in the record:

1. `elapsed_seconds <= 120`
2. a reached path under the canonical public proof surfaces, `/explore` or `/evidence`
3. a proof item identifier
4. a source document identifier
5. a positive source page number
6. a source-region reference
7. `source_region_opened: true`
8. non-empty observer notes

Visiting a proof route without opening the supporting region is a fail.

## Failure and non-attempt rules

An attempted task records elapsed time and observer notes. Use `FAIL` when the participant attempted the task but did not satisfy every pass condition. Use `NOT_ATTEMPTED` only when the task did not start; elapsed time must remain null and observer notes must explain why. Stop on withdrawal, consent uncertainty, site error, or an evidence/source mismatch. Never repair a failed or missing observation into a pass.

## Aggregate rules

Interim `IN_PROGRESS` records keep `aggregate_results: null`. A `COMPLETE` record requires every participant session to have `completed_at` and requires aggregate counts derived exactly from participant task outcomes.

The aggregate records, for both tasks, pass, fail, and not-attempted counts. Limitations also record the exact incomplete-session, not-attempted-task, and observed-fail counts, plus at least one substantive written limitation. Empty claims such as “none,” “n/a,” or “no limitations” are invalid.

## Reporting boundary

Do not publish a rate, average, quote, superiority claim, or usability conclusion until real participant records validate, the sample and limitations are disclosed, and founder review is recorded elsewhere. The validator establishes internal record consistency only.
