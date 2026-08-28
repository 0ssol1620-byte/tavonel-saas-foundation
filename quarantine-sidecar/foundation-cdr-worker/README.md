# tavonel-foundation-cdr

Foundation-only Cloudflare Worker that loads `quarantine/{workspaceId}/{documentId}/source` from R2 and sanitizes it through the synthetic Cloud Run CDR. It never asks Vercel to carry file bytes.

This Worker is **not deployed** by the commit that added it. Dashboard steps, fail-closed policy, and the no-production-touch rule are in `docs/FOUNDATION_CDR_WORKER_2026-08-29.md`.