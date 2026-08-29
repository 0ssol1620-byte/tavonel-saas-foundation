# Foundation knowledge package quality audit

## Verdict

The production collection is structurally valid, source-bound, and now
downloadable as an authenticated ZIP. It is **not** qualified as a
semantic-quality or downstream AI-performance improvement.

| Gate | Result |
|---|---|
| Immutable source traceability | PASS |
| Directory, ontology, graph, RAG, provenance and validation formats | PASS |
| Package path, byte-count and SHA-256 verification | PASS |
| Signed-in production download | PASS |
| Google OAuth private-pilot login and API isolation | PASS |
| Semantic correctness and mixed-corpus knowledge quality | NOT QUALIFIED |
| Measured downstream AI performance improvement | NOT MEASURED |
| Paddle payment and entitlement lifecycle | NOT COMPLETE |

The inspected collection is
`collection-eaaeb1f290792c9753b2fc049e9c5bc4`, with manifest
`sha256:a72a58f1b2abf8890002793e6ef7f9cd6ba031ad24e49264bf66443a87556677`
and Core receipt `core-cd02571b-e941-4603-b274-5f510b01e1bd`.
`candidatePromotion=false` remains enforced.

## Knowledge quality

The three live inputs are three pages of one public DART report. They produced
31 directory entries and 14 package files with one topic, three entities,
eleven claims, three evidence nodes, and seventeen relations. This proves the
transport and portable-format contracts, not corpus-level semantic quality.

The current deterministic compiler uses five fixed topic keyword rules, an
English-capitalization regular expression for entities, at most four
sentence-shaped claims per document, and one full-document RAG chunk per
source. Its validation covers deterministic materialization, immutable input
binding, source coverage, and evidence coverage. It does not score entity
resolution, claim entailment, contradictions, temporal authority, citations,
retrieval relevance, or downstream model outcomes.

The research implementation has stronger contracts for adaptive semantic
chunking, entity resolution, retrieval fixtures, and semantic package
round-trips. Those Python A-D/Qwen paths were not executed by this Foundation
run. A claim that this package “maximizes AI performance” would therefore be
unsupported.

## Product systems

Production deployment `dpl_2T1es4sTv4A2kPSxEqGAnUzeFPrZ` at commit
`0d8659b` exposes an authenticated download button. The server reloads the
tenant-scoped immutable R2 artifact and requires a completed separate-Core
receipt, `candidatePromotion=false`, safe unique paths, exact UTF-8 byte counts,
matching SHA-256 digests, required output roots, and a bounded archive size.
The signed-in browser completed the download flow; an unsigned request returned
`401 AUTH_REQUIRED`.

Google OAuth is configured and the signed-in production home shows `Sign out`
and `Open workspace`. Unsigned document, collection, and download requests each
return 401.

Paddle is not complete. The sandbox webhook secret and raw-body signature
verification exist, but there is no checkout session, transaction ledger,
subscription lifecycle, or persisted entitlement update. A valid webhook is
still designed to return `503 ENTITLEMENT_STORE_NOT_CONFIGURED`. The handoff
explicitly keeps payment off pending a separate approval, so no live payment
was enabled in this audit.

Machine-readable evidence is in
`FOUNDATION_KNOWLEDGE_PACKAGE_QA_2026-08-29.json`.
