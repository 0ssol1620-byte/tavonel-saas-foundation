# `nextjs/eval` — measurement harnesses

Nothing here runs in the product, ships to a client bundle, or is imported by `app/` or
`components/`. These are harnesses that put production code through a fixed input and write a report
with its denominators attached.

Not part of `pnpm test`: the package's `vitest.config.ts` includes the `lib` glob only. Run these on
purpose, with this directory's own config:

```
# everything in eval/ (the ask-eval harness takes ~4 minutes)
npx vitest run --config eval/vitest.config.ts

# just the metric unit tests (fast, pure)
npx vitest run --config eval/vitest.config.ts eval/ask-eval/metrics.test.ts
```

| directory | audit items | what it produces |
|---|---|---|
| `ask-eval/` | Q03 Q04 Q05 Q06 | A fixed 74-question set over the committed Explore corpus, run through both Ask paths; evidence precision, unsupported-answer and unnecessary-abstention rates, multi-hop coverage, in-process latency, and a 100-row CSV for human review. |
| `k08-live-engine/` | K08 | The Core V2 compile request for the same corpus, the TS fallback engine's node-kind counts, and a Python runner that puts the corpus through Core V2 in process so the two engines' counts sit side by side. |

## Three rules these harnesses keep

1. **Every rate carries its denominator**, and a rate with no denominator is `null`, not `0`.
2. **Fixture numbers say they are fixture numbers.** Every report is labelled
   `IMPLEMENTED_NOT_PROVEN` and names the one corpus it ran on. None of it calibrates a threshold,
   and none of it is comparable to a vendor's published benchmark.
3. **What is simulated says so, in the same paragraph as the number.** `ask-eval` replaces exactly
   one thing — the PostgREST boundary — and `postgrest-standin.ts` states which part of the lexical
   path is therefore a stand-in and which part is the production function.

## What none of this measures

Whether a cited region actually supports an answer. There is no entailment check anywhere in this
repository, by design; `ask-eval/rubric.md` is the human column, and it has not been scored.
