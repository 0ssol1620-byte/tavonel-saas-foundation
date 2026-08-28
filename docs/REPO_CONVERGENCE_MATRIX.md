# Repository convergence matrix

**Status:** Pointer. Do not duplicate the audit.

The KEEP / PORT / REPLACE / ARCHIVE classification for the three repositories lives in:

- `docs/PRODUCT_CONVERGENCE_AUDIT_2026-08-28.md`

Read-only snapshots used by that audit:

| Repository | Commit | Role | Classification summary |
|---|---|---|---|
| `0ssol1620-byte/ai-knowledge-compiler` | `bd0fb334aa6f1272f41a3351a99140a7b1be2593` | Core Engine | **KEEP** CIR, identity, diff, graph, recompilation, equivalence, world semantics |
| `0ssol1620-byte/tavonel-compiled-world-activation` | `e017cb65b8dd0a666740aa53a671a4ae10171dda` | Activation donor | **PORT** R2 immutable proof, RunPod release/receipt, `/world` UX, CDR evidence. Do not mutate. |
| `0ssol1620-byte/tavonel-saas-foundation` | Foundation `main` (this working tree) | Product Platform donor | **PORT** tenant/RLS, billing/credits, upload contracts, fail-closed policy |

After a verified port, donor implementations are **ARCHIVE** (read-only evidence). History is not merged.

Staged migration order: `docs/MIGRATION_INVENTORY_2026-08-28.md`.
