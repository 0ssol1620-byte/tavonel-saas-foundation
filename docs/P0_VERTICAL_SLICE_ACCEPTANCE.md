# P0 vertical slice acceptance

**Status:** Source-only acceptance matrix  
**Date:** 2026-08-28 KST  
**Slice:** synthetic Patent-to-Production path (no customer data, no paid GPU)

Each step is marked as one of:

- **contract-only** — typed source contract + Vitest exists; no provider call
- **not-built** — no Product implementation yet (Core owns the algorithm, or UI/runtime is absent)
- **fail-closed-provider** — capability exists as policy/contract but live provider remains disabled

| Step | Meaning | Classification | Evidence / contract |
|---|---|---|---|
| 1. Safe intake | Tenant-scoped capability, no Vercel byte proxy | **fail-closed-provider** | `evaluateUploadCapability` returns `INTAKE_DISABLED`; `activationPolicy.customerIntake.enabled === false` |
| 2. Immutable source | Object-key + digest + MIME + length proof | **contract-only** | `server/foundation/immutableObjectProofAdapter.ts` metadata-only; never GET/PUT R2 |
| 3. Parser / OCR | Parse sanitized bytes; OCR/VLM if needed | **fail-closed-provider** | `activationPolicy.ocrGpu.enabled === false`; no worker endpoint |
| 4. CIR / evidence | Canonical IR, source refs, evidence ids | **not-built** (Core-owned) | Core `CanonicalDocument` / `evidence_id` at `bd0fb334`. Product maps fields in `shared/productCoreFieldMap.ts` without importing Python |
| 5. Stable identity | `source_id` / `document_version_id` / `logical_id` | **not-built** (Core-owned) | Core `identity.py`. Product `source.sourceId` maps to `document_id` only; `logical_id` is an explicit TODO |
| 6. Typed diff | Semantic/structural/temporal/authority | **not-built** (Core-owned) | Core `semantic_diff.py`. Not projected from Product envelope |
| 7. Dependency impact | Typed graph impact radius | **not-built** (Core-owned) | Core `dependency.py` / `RecompilationPlan` |
| 8. Selective recompilation | Rebuild STALE+UNRESOLVED only | **not-built** (Core-owned) | Core `recompilation.py`; Product receipt carries `workAvoided` counts only |
| 9. Candidate verification | Equivalence + validation receipt | **contract-only** | `canPersistCandidate`; `EquivalenceReport.equivalent` mapping; candidate metadata in `shared/candidateWorldContract.ts` |
| 10. Atomic Active World | All-or-nothing pointer swap | **contract-only** + **fail-closed-provider** | `evaluateAtomicPromotion` encodes all-or-nothing, parent match, approval token; `activationPolicy.candidatePromotion.enabled === false` so live promotion cannot succeed |
| 11. Grounded Ask | Answer with lineage against Active world | **not-built** | No Active world, no Ask runtime, no customer session |

Synthetic fixture for expected world v1 vs v2 (one rule change): `docs/fixtures/synthetic-world-v1-v2.json`. Cost ledger example with zeros: `docs/fixtures/synthetic-cost-ledger.json`.

This matrix is acceptance criteria, not production readiness.
