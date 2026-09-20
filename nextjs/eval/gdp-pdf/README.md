# GDP.pdf four-arm evaluation adapter

This directory defines an evidence protocol. It does not contain GDP.pdf data, copied Surge
harness code, model outputs, or benchmark results. `lib/gdp-pdf-eval.ts` validates and seals
artifacts produced by an authorized evaluation environment; it never calls a model and therefore
requires no secrets in CI.

## Source boundary

The sealed public source pins are in `protocol.json`:

- dataset revision `400e411fc344b1b8dd2a51e70a7ecdf469c05b3c`, 100 test tasks;
- `data.parquet` Git LFS SHA-256
  `2ba18b4facc482a3520a6a6763f0294b0f8f3369f9cf4375b17af8fc0e025704`;
- official Inspect harness commit `7a72a514a6ab19c90babb00adc817e4ae86b9c1b` and tree
  `a42fa6bc7f6f95a32e6edb0ccb35de1759302cb3`.

The stock upstream loader follows the moving Hugging Face head. A real run must instead pass the
sealed dataset revision to both metadata loading and PDF download. Generate a sorted local source
manifest containing every path, byte size, and LFS SHA-256 (or Git object id where the file is not
in LFS), then hash that manifest and the downloaded bytes. Record the first hash as
`datasetManifestDigest` and the second as `corpusDigest`.

Licensing metadata is inconsistent across public sources, and the PDFs retain third-party rights.
The dataset must stay in an out-of-repository evaluation cache, must not be redistributed or used
for training, and needs attribution. The public harness repository has no license grant at the
pinned commit, so this implementation records its commit and scorer blob as reference evidence but
does not copy its code. Resolve the dataset and PDF rights with Surge before any wider use.

## Sealed arms

All arms use the same subject model revision, task set, epoch count, price snapshot, judge revision,
and rubric catalog. Their adapter prompt and configuration digests are frozen before execution.

1. `native_pdf`: question and original PDF, no tools or extra context. This is the upstream-like
   control.
2. `compiled_context_pdf`: the same question and PDF plus a deterministic compiled context artifact.
   The exact compiler revision, context budget, ordering, and truncation rule belong in the arm
   config digest.
3. `fixed_control_retrieval_rerank`: question plus the evidence packet returned by one frozen
   retrieval profile and reranker. It does not receive the full PDF unless the sealed adapter config
   explicitly says so.
4. `adaptive_router`: the same evidence-packet interface, with the profile/provider selected by the
   sealed router policy. Every attempt must carry the durable adaptive route receipt digest.

No arm may reuse an answer, retrieved packet, judge response, or cache entry from another arm. Run
order should be deterministically shuffled per task and epoch from a seed stored in each arm config,
so provider drift and warm-cache effects do not always favor one arm.

## Evaluation run

1. Verify `protocol.json`, then compute its domain-separated digest with
   `gdpPdfProtocolDigest`.
2. Materialize all 100 task rows from the pinned parquet. Preserve `task_id`,
   `task_response_id`, `domain`, PDF SHA-256, prompt SHA-256, ordered rubric SHA-256, and the number
   of non-empty rubric criteria. Do not infer paper-only fields absent from the public parquet.
3. Build the sorted task catalog and compute `gdpPdfTaskSetDigest`. Freeze subject model provider,
   model and dated revision; judge provider, model and dated revision; judge prompt digest; hardware
   digest; price snapshot digest; thresholds digest; and all four arm adapter/config digests.
   Moving model aliases are insufficient.
4. Execute five epochs for official comparability. The candidate gets no tools. Judge every atomic
   criterion independently and store one content digest for the judge receipt. The official method
   uses binary criterion scores, strict all-criteria pass as the headline, and mean criteria passed
   as a diagnostic.
5. Convert every `(task, arm, epoch)` cell to `GdpPdfTaskOutput`. Every cell carries a digest over
   its execution receipts; adaptive cells additionally carry the durable route-lineage digest. A
   subject failure is a zero that
   remains in the denominator. Adapter and judge failures are also zero and remain in the
   denominator, and they prevent router promotion. This deliberately closes an upstream behavior
   where an unparsed judge result can become `NaN` and disappear from an aggregate.
6. Record end-to-end latency, input/output tokens, and cost in USD micros for every cell, including
   failures. If a provider does not report one of these, mark the run as an adapter failure; do not
   substitute zero. Raw prompts, PDFs, answers, secrets, and judge rationales stay in the restricted
   run store. Only their digests enter this receipt.
7. Call `buildGdpPdfRunReceipt`. It refuses missing, duplicate, unknown, or denominator-changing
   cells and deterministically recomputes the summaries and receipt digest. Call
   `validateGdpPdfRunReceipt` again at the artifact ingestion boundary.

The four summaries report strict all-pass, mean criteria, subject/adapter/judge failures, p50/p95
latency, token totals, and cost totals. Pairwise output includes adaptive versus fixed-control and
compiled-context versus native-PDF deltas. Do not add a public benchmark-registry row until the
complete sealed artifacts exist and the normal benchmark receipt is created from those artifacts.

## Router evidence handoff

GDP-specific benchmark thresholds are selected and hashed before a run. After independent code has
evaluated every sealed benchmark threshold, call `buildGdpPdfBenchmarkEvidenceDraft`. It refuses an
empty or failing threshold set and any run with adapter or judge failures. This is one benchmark
evidence input only; it does not authorize router activation or replace Arena, private family
holdout, shadow, canary, approval, validity, revocation, CAS, or kill-switch gates.

The returned object intentionally omits `evidenceDigest`. At the service-role transaction boundary:

1. add the draft body to a JSONB document;
2. derive `evidenceDigest` in PostgreSQL with
   `adaptive_router_canonical_digest_v1(document, ARRAY['evidenceDigest'],
   'tavonel.adaptive_router_evidence.v1')`;
3. add that derived digest to the document and insert the matching columns and JSONB receipt in the
   same transaction;
4. set `measured_at`, `valid_from`, and `valid_until` under the existing evidence validity policy.

Client code must not calculate or supply the authoritative control-plane digest. The database
constraint recomputes it from canonical JSONB and rejects a mismatch. Creating the evidence row is
still not activation: policy revision, CAS rollout, shadow/canary evidence, revocation state, and
the kill switch remain independent gates.

## Offline verification

From `nextjs/`:

```text
pnpm eval:gdp-pdf:check
pnpm exec vitest run lib/gdp-pdf-eval.test.ts
pnpm exec tsc --noEmit
pnpm exec eslint lib/gdp-pdf-eval.ts lib/gdp-pdf-eval.test.ts
```

The first command validates the committed source pins and four-arm protocol, prints its canonical
digest, and makes no network call. To validate a restricted run bundle without publishing it, pass
`--input <bundle.json>`; the bundle shape is `{ "run": { "manifest": ..., "tasks": [...],
"outputs": [...] }, "receipt": <optional previously sealed receipt> }`. Omit `--output` for stdout,
or provide a new path; the CLI uses create-only writes and refuses to overwrite evidence.

These checks use synthetic digests only in tests. They make no network calls and require no
provider keys.
