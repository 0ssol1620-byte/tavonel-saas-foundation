# TAVONEL Foundation — Provider Activation Checklist

This checklist separates **foundation completion** from every operation that can create a provider resource, handle credentials, accept payment, or accept customer bytes. Completing a later gate must never imply approval for a subsequent gate.

| Gate | Required evidence | Allowed effect | Explicitly excluded |
|---|---|---|---|
| Supabase project | A dedicated `tavonel-saas-foundation` project in Seoul `ap-northeast-2`, created without sharing the database password | Isolated identity and metadata store | Customer documents, existing TAVONEL production resources |
| RLS migration | Target project identifier confirmed; reviewed SQL applied once; SQL checks pass | Auth profiles, personal workspaces, tenant RLS | Service-role browser access, direct document metadata writes |
| Auth sandbox | HTTPS origin and redirect URI approved; email and Google identity provider configured | Signup and sign-in only | Customer intake and privileged server credentials in browser code |
| Paddle sandbox | Verified sandbox vendor account, server allow-list, notification destination, raw-body verification test | Test checkout and entitlement projection | Live checkout, live webhooks, live price IDs |
| R2 synthetic canary | Separate APAC bucket and scoped signer; signed canary succeeds with no customer bytes | Browser-direct synthetic upload only | Production bucket changes, customer intake, server byte proxying |
| CDR bootstrap | Exact preflight remains valid and final approval is recorded | One secret-generation build only | Cloud Run secret attachment, Cloudflare sync, CDR request execution |

## Safe provider handoff

The user-controlled provider setup must first create the dedicated Supabase Seoul project. The database password stays in the provider and must not be copied into this task or application. After creation, only the Supabase project URL, publishable/anon key, and server-only service-role key are needed. They belong in managed configuration input, never source control. The service-role key is used solely by server processes; the browser receives only the publishable key.

Apply `supabase/migrations/0001_tavonel_tenant_foundation.sql` only after the displayed target project identifier has been confirmed. The migration creates a profile and personal workspace after each `auth.users` insert, enables RLS on every foundation table, removes general `anon`/`authenticated` privileges, and gives browser clients only the narrow reads and profile self-update granted by explicit policy. `supabase/tests/tenant_rls.sql` must pass in the dedicated test database before enabling user sign-up.[1]

For Paddle, create a sandbox notification destination for the dedicated foundation endpoint only. The service verifies the raw request body using `Paddle-Signature`, checks a bounded timestamp, persists `event_id` before applying a projection, and rejects an event whose `occurred_at` is not newer than the existing entitlement state. This handles Paddle’s out-of-order delivery constraint without relying on best-effort timing.[2] [3]

For Cloudflare, create a **new** APAC-bound quarantine bucket rather than editing `tavonel-prod-quarantine`. The location label must be described to users as APAC best-effort placement, not a Korea-residency guarantee. A future signed capability can only target `quarantine/{workspace}/{document}/source`, limit content length and expiry, and is issued after authenticated membership, entitlement, and quota checks. It must remain globally denied until the synthetic canary stage passes.

## Permanent non-negotiables

Customer bytes must never traverse the Vercel application or Postgres. AV, CDR, OCR/GPU dispatch, candidate generation, and promotion begin only from a qualified sanitized lineage. A real payment or a real document upload requires a separate explicit approval after the relevant sandbox evidence has been reviewed. The existing production application and isolated CDR activation repository are out of scope for all foundation migrations and provider settings.

## CDR bootstrap boundary

`docs/CDR_BOOTSTRAP_APPROVAL_PACKAGE.md` identifies the exact GitRepositoryLink, commit, build configuration digest, region, and write-only temporary execution identity. The approved path is one triggerless Cloud Build submission; it must generate secret material inside the build and disclose only `CREATED` or `EXISTS`. A separate subsequent approval is required before any runtime attachment or Cloudflare secret synchronization.

## References

[1]: https://supabase.com/docs/guides/database/postgres/row-level-security "Supabase — Row Level Security"
[2]: https://developer.paddle.com/webhooks/about/signature-verification "Paddle — Verify webhook signatures"
[3]: https://developer.paddle.com/webhooks/about/respond-to-webhooks "Paddle — Handle webhook delivery"
