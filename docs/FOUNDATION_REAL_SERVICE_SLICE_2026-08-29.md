# Foundation real-service slice (2026-08-29 KST)

This slice wires Google sign-in and a Foundation-only R2 synthetic canary. It does not open customer intake, CDR customer path, OCR/GPU dispatch, or candidate promotion.

## App

- `/auth/callback` completes the Supabase Google session (`detectSessionInUrl`).
- Homepage Sign in starts `signInWithOAuth({ provider: "google" })` when public Supabase env is present.
- `/api/status` reports `auth`, `billing`, and `r2` from env presence only (no secret values).
- `POST /api/uploads/synthetic-canary` PUTs/HEADs/DELETEs one `synthetic/` object using Foundation R2 signer env. Bearer `FOUNDATION_CANARY_TOKEN` required. Bucket must be `tavonel-saas-foundation-quarantine`.

## Still fail-closed

`activationPolicy` flags remain false. Workspace upload stays locked. GPU worker release stays blocked until immutable release evidence and compatible capacity exist. Paddle remains sandbox only.
