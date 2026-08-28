# Canonical Responsibility Freeze

**Status:** Source-only architecture boundary  
**Effective:** 2026-08-28 KST  
**Scope:** TAVONEL Core Engine and Product Platform convergence

## Authority model

TAVONEL has two canonical authorities and two donor repositories. The authorities are deliberately separate because compiler semantics and commercial control-plane concerns have different release, security, and scaling boundaries.

| Authority | Owns | Must not own |
|---|---|---|
| **Core Engine** (`ai-knowledge-compiler`) | CIR/Knowledge IR, parser and evidence contracts, stable identity, semantic/structural/temporal/authority diff, typed dependency graph, impact analysis, selective recompilation, full-rebuild equivalence, world validation, answer/agent lineage semantics | Auth, tenant membership, billing, browser uploads, R2 credentials, provider secrets, customer bytes, product sessions, UI routing |
| **Product Platform** (future canonical TAVONEL product repo; Foundation is the donor) | Next.js product and marketing, Auth/workspaces/tenants, Supabase/RLS, billing/credits/entitlements, R2 quarantine metadata and capability issuance, connector orchestration, job/outbox control plane, abuse/quota/cost gates, candidate persistence, active-world pointer, UI/API/MCP | Core algorithm internals, provider-specific model semantics, direct byte proxying, bypass of release/receipt/equivalence gates |

The current Foundation repository is a **Product Platform donor**, not yet the final canonical Product repository. The activation repository is a **migration donor and evidence reference**, not a mutation target. No source file, deployment, secret, database, bucket, endpoint, or production alias in the donor repositories may be changed under this boundary.

## New-feature rule

A new feature must be implemented in its target authority. Donor repositories are read-only references until an explicitly reviewed port is complete. Duplicate implementations of auth, billing, upload, world state, or dispatch must not be added to all repositories.

## Product–Core boundary

The Product Platform emits a versioned compile job envelope after tenant, entitlement, quarantine, immutable-source, and admission checks. The Core worker consumes the envelope and returns versioned receipts and artifact metadata. Product persists the receipt and candidate-world state; Core does not mutate Product databases or active-world pointers.

```text
Product control plane
  → validated CompileJobEnvelope
  → Core worker/runtime
  → CompileReceipt + DerivedArtifactManifest
  → Product candidate-world persistence
  → Product-owned atomic promotion gate
```

The envelope carries opaque object references and digests, not customer bytes. A Core worker must be able to reject a malformed, cross-tenant, stale, or unsupported envelope without contacting a provider or guessing missing fields.

## Provider and live-path boundary

The following remain disabled until independent synthetic evidence and contextual approval exist: customer intake, browser-direct R2 signing, CDR requests outside the already qualified Foundation synthetic fixture, OCR/GPU dispatch, paid checkout, Auth signup, customer data, and candidate-to-active promotion.

A visual product surface may display these capabilities as `presentation_only`, `provider_pending`, or `disabled`; it must never imply that a source-only contract has created a live capability.

## Promotion boundary

Core may return a candidate world, validation receipt, equivalence report, and impact explanation. Only the Product Platform may perform the tenant-scoped atomic state transition from `CANDIDATE` to `ACTIVE`, and only after checking manifest digest, validation receipt, equivalence status, active pointer parent, authorization, and an explicit promotion policy. The current Foundation policy keeps this transition disabled.

## Archive rule

After a port is verified with source provenance, tests, and operational evidence, the donor implementation becomes read-only reference material. Repository history is not merged merely to create a single tree. The normal end state is one Product Platform plus one Core Engine, with donor repositories retained for audit provenance until their migration records are complete.
