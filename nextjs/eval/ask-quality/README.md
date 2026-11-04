# `eval/ask-quality` -- E1 pre-registered Ask quality harness

Status: **IMPLEMENTED_NOT_PROVEN**. This directory makes no quality claim. No receipt from a
real answerer exists yet; until one does, there is no TAVONEL Ask quality number, and the one that
eventually exists is read only with its denominator and its Wilson interval.

## What it measures

`PREREG.json` is the protocol: question-set sha256s, scoring rules, statistics, the baseline. The
metrics are the E1 row of PROGRAM-2026-11-04 §4.E, each with a named denominator, reported per
question set and never pooled:

| metric | denominator |
|---|---|
| correct / answerable | answerable questions of that set |
| correct abstention / unanswerable | unanswerable questions |
| wrong answer / unanswerable | unanswerable questions |
| citation precision | all citations returned for that set's answerable questions |
| numeric exact match | answerable numeric questions |
| latency p50 / p95 | all questions asked |

The baseline is the current `evidence_excerpts` Ask path (`lib/grounded-ask.ts`, behind
`POST /api/v1/collections/{id}/ask`). It returns cited passages rather than a value, so its
numeric exact match is expected to be near 0 by construction. PREREG says so in advance.

Question sets (`questions/`):

| set | n | status |
|---|---|---|
| `xbrl-numeric.json` | 400 | frozen. Coca-Cola, Johnson & Johnson, Microsoft, Procter & Gamble; two 10-Ks each, 50 questions per filing |
| `unanswerable.json` | 160 | frozen. 120 OTHER_COMPANY + 40 OTHER_YEAR |
| `human-TEMPLATE.json` | 0 scored | template: the schema plus 5 agent-written worked examples on two NASA/NACA reports, `humanVerified: false` |

A numeric question exists only when the filing's inline XBRL carries a visible fact that matches
the companyfacts value on concept, non-dimensional context period, unit and scaled value
(masterplan v4 §16.4). The displayed span and its offset in the filing are the gold for citation
precision.

## What it does not measure

- Whether a citation *supports* the answer. Span containment is not entailment.
- Answer quality in general. XBRL questions are lookups and may run easy (PROGRAM §4.E risk),
  which is why each set gets its own rows.
- Anything about production. The live adapter refuses `tavonel.com` and the production Vercel
  host.
- OTHER_YEAR absence beyond tagged XBRL: untagged prose could still state such a figure, so a
  person spot-checks a sample before that set is cited.
- Fixture receipts measure nothing. They prove the harness is deterministic, and they say so in
  the receipt.

## How to run (from `nextjs/`)

```
# tests: scoring, unit/period matching, Wilson CI, receipt schema, determinism (also part of `pnpm test`)
npx vitest run eval/ask-quality/metrics.test.ts

# fixture run, no network; writes results/ask-quality-fixture-v1-<date>.{json,md} (git-ignored)
node --experimental-strip-types eval/ask-quality/run_eval.mjs --answerer fixture

# baseline run against a NON-production deployment. The token comes from the environment and is never written
TAVONEL_EVAL_WORKSPACE_TOKEN=... node --experimental-strip-types eval/ask-quality/run_eval.mjs \
  --answerer evidence-excerpts --base-url http://localhost:3000 --collections ./collections.json
#   collections.json: { "sec-10k:0000021344": "collection-<32 hex>", ... }, one collection per filer,
#   holding that filer's two pinned 10-K documents (url + sha256 in questions/xbrl-numeric.json#filers)

# rebuild the question sets (SEC fair access: identify yourself; responses cache under cache/, git-ignored)
TAVONEL_SEC_USER_AGENT="<organisation> <contact email>" node eval/ask-quality/gen_xbrl_questions.mjs
node eval/ask-quality/gen_xbrl_questions.mjs --offline   # from cache only
```

A rebuild that changes a byte changes the sha256, and `run_eval.mjs` will refuse the file until
a new PREREG revision pins it. That is intended.
