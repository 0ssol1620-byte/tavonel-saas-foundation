# K08 — re-measuring "6,300 objects" against the live engine

Audit K08: *"공개 데모의 6,300 objects는 6,300개의 검증된 사실 또는 고품질 의미 관계를 뜻하지 않는다."*
Completion bar: **node kind별 수량, 중복률, 근거 정밀도, 다문서 질의 성공률을 함께 표시한다.**

Status: **IMPLEMENTED_NOT_PROVEN.** Both engines were run in process over the same committed bytes
on 2026-09-11. These are counts on one public corpus, not a product measurement, and no number here
calibrates a threshold.

## What was run

| | |
|---|---|
| corpus | `nextjs/lib/explore-sample.w4.inputs.json` — five Apple SEC filings (2025 10-K + four 2026 filings), 290 pages, 1,281 OCR regions |
| corpus digest | `sha256:328d3ef3a6ee0153b14e9a782cdb4e9f499a6443b1f5dbf2898ace1cb4915b7f` (W4 manifest digest, frozen in `explore-sample.ts`) |
| engine A | `tavonel-collection-compiler-ts-v1` — the TypeScript fallback engine, and the engine that builds `/explore` at build time |
| engine B | `tavonel-python-core-v2` — the engine the product dispatches a real compile to, run from an unmodified checkout at `D:\CodexProjects\ai-knowledge-compiler-p0p2-productization`, in process, 14.4 s |
| request digest (B) | `sha256:b5076ba8cd9fd5c303a6af8b818a9b09ee7bbf4841b7ea6adc0b8c5965d9c9d4` — the request exactly as `buildProductCoreV2Request` builds it |
| output digest (B) | `sha256:ab7d8527c539ac753689ca78587e79d28a2eb36329399fef2d06761c4b708b22` |
| how to reproduce | `npx vitest run --config eval/vitest.config.ts eval/k08-live-engine/emit-inputs.test.ts` then `<p0p2 venv>/python.exe eval/k08-live-engine/run_core_v2.py` |

**One caveat that is not cosmetic.** The Core V2 compiler requires a `core_release_digest`, which in
the live deployment comes from that deployment's environment. This run used a digest computed over
the 47 Python source files of the local checkout
(`sha256:8610adb6af4de742882603e2e6dc8f1aa78f804bc3e654bf22c75e0ddaa63a5d`), labelled
`local_source_digest`. So this is a **same-engine** measurement, not a **same-release** one. Reading
the deployed digest means calling the live service's `/health`, which this lane did not do.

## Node kinds, side by side

| node kind | TS fallback engine | Core V2, computed | Core V2, as a customer receives it |
|---|---:|---:|---:|
| collection | — | 1 | **dropped** |
| document | 5 | 5 | 5 |
| block | — | 1,281 | **dropped** |
| evidence | **5** | **1,281** | 1,281 |
| claim | 3,930 | 2,088 | 2,088 |
| entity | 2,365 | 1,028 | 1,028 |
| topic / ontology_term | 5 | 5 | **dropped**, and `counts.topics` is hard-coded `0` |
| relation | — (edges instead) | 2,765 | **dropped** |
| validation_record (contradiction) | — | 23 | **dropped** |
| **total objects** | **6,310** | **8,477** | **4,402** |

Edges:

| edge | TS fallback engine | Core V2, computed | Core V2, as a customer receives it |
|---|---:|---:|---:|
| `supported_by` (claim → evidence) | 3,930 | — (expressed as claim `links`) | 2,088 |
| `mentions_entity` / `mentions` | 3,841 | 2,765 relation objects, every one predicate `mentions` | 0 |
| `discusses_topic` | 23 | — | 0 |
| **total edges** | **7,794** | **2,765 relation objects** | **2,088** |

Sources: `nextjs/eval/k08-live-engine/results/ts-fallback-counts.json` and
`.../core-v2-counts.json`. The "as a customer receives it" column is derived by applying
`projectProductCoreV2Candidate`'s own rule (`allowedKinds = document, entity, claim, evidence`, and
edges rebuilt as claim→evidence `supported_by` only) inside the runner, so it cannot drift from the
projection it describes.

## What the audit asked for

### Node-kind quantity — answered above. Three things it shows

1. **"6,300" is `candidatesConsidered` from the TS engine, and it is off by a different engine's
   worth of objects.** The TS artifact reports `candidatesConsidered: 6300` and carries 6,310
   ontology nodes (the extra ten are the 5 Document and 5 Evidence nodes, which are not extraction
   candidates). Core V2 computes **8,477** knowledge objects on the same bytes, and the customer
   receives **4,402** of them. So the public figure is neither the live engine's internal count nor
   what a customer gets: it is 1.4× the delivered count and 0.74× the computed one.
2. **Evidence granularity differs by 256×, in the live engine's favour.** The TS engine emits ONE
   Evidence node per document-version (`stableId("evidence", documentId, versionKey)` in
   `collection-compiler.ts`), so every rag chunk in a document shares that document's single evidence id — 1,281 chunks bound to 5 evidence objects.
   Core V2 emits one evidence object per region: 1,281. Any statement of the form "every claim is
   bound to its evidence" means *bound to a document* on the TS path and *bound to a region* on the
   Core V2 path. The page/bbox locator is still per-chunk on both, so the customer-visible citation
   is not 256× worse — but the evidence *object* is.
3. **The live engine finds 23 contradictions and the TS engine has no concept of one.** Core V2
   returned `status: review_required`, `lifecycle: review_required`, with 23
   `CONTRADICTION_CANDIDATE` review reasons. The TS engine returned `lifecycle: candidate` on the
   same corpus. **A compile of the Explore corpus through the live engine does not produce a clean
   candidate; it produces a world that asks for review.** Every one of those 23 validation records
   is then dropped by the projection, so the customer sees `review_required` with nothing to look at.

### Duplicate-label rate

| | labelled nodes | distinct labels | nodes sharing a label | rate |
|---|---:|---:|---:|---:|
| TS fallback engine | 6,310 | 5,749 | 846 | **13.4%** |
| Core V2, all objects | 4,402 | 3,896 | 731 | **16.6%** |
| Core V2, customer-visible | 3,121 | 2,776 | 519 | **16.6%** |

Definition, identical on both sides: the share of nodes whose (kind, whitespace- and case-normalised
label) pair is not unique. Nothing cleverer, because deciding that two labels mean the same thing is
the identity module's job, not a metric's.

**These two rates are not strictly comparable and must not be quoted as a like-for-like difference.**
The label populations differ: on the TS side every node carries a label, so the denominator is all
6,310; on the Core V2 side only `document`, `block`, `claim` and `entity` payloads carry a field the
extractor recognises as a label, so evidence, relation and validation-record objects are outside the
denominator. What both rates do support is the audit's actual point: **roughly one node in six or
seven is a repeat of another node's label.** A node count is not a fact count.

### Evidence precision — measured, in the other report, and not on this engine

Evidence precision and multi-document query success are in
`ask-eval-2026-09-11.md` beside this file: 74 fixed questions with gold locators over
the same corpus, both Ask paths, region- and page-level precision with their ceilings, and 12
multi-hop questions. Two limits apply to reading those numbers here:

- They were measured on the **TS engine's** artifact, because that is what `/explore` and both Ask
  paths consume today. A Core V2 world has never been through the Ask harness.
- `projectProductCoreV2Candidate` produces no `rag/chunks.jsonl` equivalent in this run, so the
  fallback retriever cannot read a Core V2 world without the projection step that `/ask` performs.
  Running Ask over a Core V2 world is the natural next measurement and was not done.

### Multi-document query success

12 multi-hop questions, each spanning at least two filings; success defined as "the citations covered
at least two of the gold filings". Measured on the TS artifact: **75.0% (9/12)** on the compiled path
with the stand-in lexical ranker and **41.7% (5/12)** on the excerpt fallback. Success there means
the evidence from both filings was retrieved — **not** that any comparison was computed. Nothing in
either path computes one.

## What this changes about the public claim

`nextjs/lib/collection-compiler.ts` documents the 6,300 figure as a measurement of "the largest
corpus this product has compiled". That sentence is true about the TypeScript engine. It is not a
description of the engine a customer's compile is dispatched to, and it is not the count a customer
receives. Anywhere the number appears in public copy it needs either the engine named or the number
replaced. Which of those is a decision for the lane that owns the copy (L1) and the engine contract
(L3); this lane produced the measurement, not the edit.

## What is still missing

- The deployed `coreReleaseDigest` was never read, so this is same-engine, not same-release.
- No Core V2 world has been through the Ask harness, so evidence precision on the live engine is
  unmeasured.
- The 23 contradiction candidates were counted, never inspected. Whether they are real conflicts in
  Apple's filings or artefacts of the semantic compiler is unknown and is a genuine finding either
  way — an engine that flags 23 contradictions in five filings from one issuer is making a claim
  about those filings that a person should check.
- Nothing here measures whether a relation is *useful*. The audit's word was 품질; this report
  measures quantity, duplication and delivery, which is what a count can support.
