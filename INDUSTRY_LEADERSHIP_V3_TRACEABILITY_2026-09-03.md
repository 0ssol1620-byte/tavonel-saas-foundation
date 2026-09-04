# Industry Leadership V3 — traceability

This file is superseded for live-cutover status by the repository history and production verification performed on 2026-09-04. The implementation branch was audited against `TAVONEL_INDUSTRY_LEADERSHIP_FULL_SITE_PRODUCTION_MASTERPLAN_2026-09-03.md` and then advanced through production database qualification.

## 2026-09-04 production cutover update

The prior document stated that the live Supabase project had none of the durable compile/retrieval schema. That statement is no longer current.

Directly applied and verified on Supabase project `tfcorhjkqcuisqhsjemz`:

- retrieval foundation / real pgvector: migrations 0020–0023
- durable compile jobs and event ledger: 0038
- review patch audit columns: 0039
- corpus batching metadata: 0040
- standalone/corpus idempotency separation: 0041
- concurrent slot race revalidation: 0042
- compile/retrieval RPC privilege hardening: 0043
- internal trigger hardening: 0044

Production pgvector is installed as version 0.8.2 and the cosine, L2, and inner-product operators were exercised directly. A rollback-only compile/corpus smoke confirmed the 0042 enqueue function is callable against the live schema without leaving test rows.

Supabase security-advisor findings introduced by the new schema were remediated: internal compile/retrieval SECURITY DEFINER helpers are no longer executable by `anon` or ordinary `authenticated` roles, and mutable helper search paths were pinned. Remaining advisor warnings are either pre-existing/intentional authenticated enterprise permission RPCs, the pgvector extension residing in `public`, or account-level recommendations such as leaked-password protection.

## Current release branch

- branch: `agent/industry-leadership-v3`
- release head after production DB hardening: `eabe88cd2604ea176f4dc4bb35d86b91459b3592`
- main before cutover: `d919070c5cfb9ef763c2dc3b243b96c1bba69dd1`
- release branch is a pure fast-forward from main (0 commits behind)

## Known product limitations that are not hidden

- A corpus larger than one compile is partitioned into separate Compiled Worlds; cross-part identity reconciliation is not yet shipped.
- Team self-serve remains gated; shared tenancy/membership is not yet shipped.
- Browser ZIP expansion is supported within the qualified ceiling; isolated server-side large-archive extraction is not yet shipped.
- XLSX billing units remain undecided and are not presented as verified pages.
- DOCX saved page counts are `declared`, not `verified`.

These limitations must remain explicit until their corresponding implementation and qualification are complete.

## Paid-live cutover

The product code deliberately fails closed. Real charges require all of the following in the Production Vercel environment:

- `COMMERCIAL_MODE=live`
- Paddle production mode (`PADDLE_SANDBOX` not true)
- `TAVONEL_BILLING_LAUNCH_APPROVED=true`
- valid production Paddle client token and price ids

The registered operator identity is resolved outside the repository: the registered Korean sole proprietorship is `타보넬(TAVONEL)`, display name `TAVONEL`, website `https://tavonel.com`, and Paddle Support confirmed the account business details were updated.

## Release gate

Code and database cutover may proceed independently from still-unshipped roadmap items, provided public surfaces describe current limits accurately. Paid-live is considered complete only after a real production checkout → webhook → subscription/allowance → usage settlement flow is verified.
