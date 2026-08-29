# Foundation multi-document knowledge compilation evidence

## Result

The production Foundation workspace accepted three digest-pinned, one-page
derivatives of a public DART report through the browser UI. Each file followed
the live customer path: browser-direct signed R2 quarantine, CDR reconstruction,
RunPod GPU OCR, and an immutable sibling `ocr.json`.

RunPod metrics moved from 9 requests / 1 completed / 8 failed to 12 requests /
4 completed / 8 failed. The proof therefore added three completions and no new
failures. After processing, the endpoint had zero running workers, zero queued
jobs, and `$0.00000/s` spend.

## Collection artifact

- Collection: `collection-12be472fa51e4be53a69224551446e35`
- Manifest: `sha256:17c5f06c16e462711d5ff787f1af5c6205ba2fc6d74500b29d6dcdeb8500a0e0`
- Documents: 3
- Directory entries: 31
- Package files: 14
- Ontology: 1 topic, 3 entities, 11 claims, 3 evidence nodes, 17 relations
- Lifecycle: `candidate`
- `candidatePromotion=false`

The create-once artifact is stored at:

`immutable/pilot-969dc192daa24119/pilot-969dc192daa24119/collections/collection-12be472fa51e4be53a69224551446e35/17c5f06c16e462711d5ff787f1af5c6205ba2fc6d74500b29d6dcdeb8500a0e0/candidate-world.json`

After a new production deployment and full page reload, the authenticated UI
read that artifact back from R2 and verified the directory plan plus ontology
JSON-LD/Turtle, graph CSV, RAG, provenance, and validation package roots.

## Scope boundary

This run qualifies the live Foundation deterministic candidate compiler aligned
to `generic-mixed-corpus@1.0.0`. It does not claim deployment or execution of
the separate Python Core A-D/Qwen knowledge runtime. That model-backed semantic
runtime remains a distinct integration gate.

Machine-readable evidence is in
`FOUNDATION_MULTI_DOCUMENT_KNOWLEDGE_COMPILATION_2026-08-29.json`.
