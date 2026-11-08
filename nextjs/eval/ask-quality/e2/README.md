# E2 answerability gate — pre-registered replay

Status: **IMPLEMENTED_NOT_PROVEN**. Holdout verdict: **NOT_SUPPORTED** (criterion C2 failed).

The gate is `lib/answerability.ts`. The Ask route shadows it behind `TAVONEL_ASK_ANSWERABILITY_MODE` (`off`, the default, or `shadow`). This directory decides, on E1's gold, whether that gate earns an `on`.

| file | what it is |
|---|---|
| `PREREG-E2.json` | Written and committed (27142990) before any verdict was computed: the E1 split and the holdout id digest, the corpus build, the retriever, the gate's rule order, the calibration rule, criteria C1–C3, the verdict rule and the sha256 of every file it runs |
| `e2.ts` | Chunks the pinned 10-K HTML into an artifact, replays each question through `answerGroundedQuestion` (the production fallback Ask path), applies the gate, chooses the threshold, computes the metrics and the verdict |
| `run_e2.mjs` | `--phase calibration`, then `--phase holdout --calibration <receipt>`. It will not run on an uncommitted prereg, a changed pinned file or a 10-K whose sha256 differs. It will not read the holdout until the calibration receipt is committed, and it will not run a second holdout |
| `receipts/` | The calibration receipt (threshold 0, `constraintMet: false`) and the one holdout receipt |
| `metrics.test.ts` | Tests on synthetic input only |

## Holdout result (266 questions: 191 answerable, 75 unanswerable)

| rate | value | Wilson 95% |
|---|---|---|
| wrong answers on unanswerable questions, baseline | 75/75 | 0.951–1.000 |
| wrong answers on unanswerable questions, gated (C1 PASS) | 43/75 | 0.461–0.679 |
| answerable questions refused (C2 **FAIL**, the ceiling on the upper bound is 0.10) | 21/191 | 0.073–0.162 |
| gold-span hits lost (C3 PASS) | 0/61 | 0.000–0.059 |
| refuse precision | 32/53 | 0.469–0.724 |
| refuse recall | 32/75 | 0.321–0.540 |

What this measures: one retriever (the fallback), one HTML chunking, four filers and XBRL-template questions. It does not measure the compiled path, PDFs or human-written questions. The rules for held conflicts and `OUT_OF_SCHEMA` never fire here. The threshold comes from this corpus alone, so it is not "calibrated".

```
node --experimental-strip-types eval/ask-quality/e2/run_e2.mjs --phase calibration   # needs eval/ask-quality/cache (E1 generator)
```
