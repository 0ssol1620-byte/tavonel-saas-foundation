# Foundation multi-document knowledge compilation evidence

## Result

The production Foundation workspace accepted three new digest-pinned, one-page
derivatives of a public DART report through the browser UI after the separate
Core deployment. Each file followed the live customer path: browser-direct
signed R2 quarantine, CDR reconstruction, RunPod GPU OCR, an immutable sibling
`ocr.json`, HMAC-authenticated Core dispatch, and a digest-bound completed
receipt.

RunPod metrics moved from 12 requests / 4 completed / 8 failed to 15 requests /
7 completed / 8 failed. The proof therefore added three completions and no new
failures. After processing, the endpoint had zero running workers, zero queued
jobs, and `$0.00000/s` spend.

The Cloudflare queue had one active consumer, delivery enabled, and zero
backlog messages / zero backlog bytes after the run.

Regression verification passed 40 Foundation tests, 27 CDR Worker tests,
TypeScript checking, and the Next.js production build.

## Collection artifact

- Collection: `collection-eaaeb1f290792c9753b2fc049e9c5bc4`
- Manifest: `sha256:a72a58f1b2abf8890002793e6ef7f9cd6ba031ad24e49264bf66443a87556677`
- Core receipt: `core-cd02571b-e941-4603-b274-5f510b01e1bd`
- Core runtime: `tavonel-foundation-core-deterministic-v1`
- Documents: 3
- Directory entries: 31
- Package files: 14
- Ontology: 1 topic, 3 entities, 11 claims, 3 evidence nodes, 17 relations
- Lifecycle: `candidate`
- `candidatePromotion=false`

The create-once artifact is stored at:

`immutable/pilot-969dc192daa24119/pilot-969dc192daa24119/collections/collection-eaaeb1f290792c9753b2fc049e9c5bc4/a72a58f1b2abf8890002793e6ef7f9cd6ba031ad24e49264bf66443a87556677/candidate-world.json`

After a new production deployment and full page reload, the authenticated UI
read that artifact back from R2 and verified the directory plan plus ontology
JSON-LD/Turtle, graph CSV, RAG, provenance, and validation package roots.

## Scope boundary

This run qualifies the separately deployed deterministic Core runtime aligned
to `generic-mixed-corpus@1.0.0`, including HMAC request authentication and a
digest-bound completed receipt. It does not claim deployment or execution of
the Python A-D/Qwen semantic runtime. That model-backed runtime remains a
distinct integration gate.

Machine-readable evidence is in
`FOUNDATION_MULTI_DOCUMENT_KNOWLEDGE_COMPILATION_2026-08-29.json`.
