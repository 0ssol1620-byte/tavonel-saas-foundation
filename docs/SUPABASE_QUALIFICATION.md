# Supabase Seoul Foundation Qualification

| Field | Verified result |
|---|---|
| Dedicated project | `tavonel-saas-foundation` (`tfcorhjkqcuisqhsjemz`) |
| Organization | `Phillip's projects` |
| Region | `ap-northeast-2` — Seoul |
| Initial state | `ACTIVE_HEALTHY`; public schema empty before migration |
| Applied migrations | `0001_tavonel_tenant_foundation`, `0002_credit_ledger_and_gpu_reservations`, `0003_harden_rls_function_exposure`, `0004_harden_credit_ledger_rls` |
| Public relations | 13 foundation tables; all report RLS enabled and have zero rows |
| Synthetic RLS probe | Pass; `transaction_rolled_back`; zero persisted fixture rows |
| Security advisor | Final result: `lints: []` after public-function and internal-ledger hardening |

The one-time migration created the tenant data model and default-deny browser posture. The RLS probe tested self and cross-tenant visibility for profiles, workspaces, memberships, entitlements, documents, proofs, candidates, Paddle customer/subscription metadata, and browser denial for the billing ledger, document insert, entitlement update, and candidate promotion.

The test used synthetic invalid-example identities inside a single transaction and ended with an explicit rollback. It did not create customer records, document objects, payment records, OAuth provider configuration, R2 credentials, or a CDR/OCR/GPU call.

The security advisor initially identified default executable permissions on three `SECURITY DEFINER` helpers and policy-less internal ledger tables. The following hardening migrations moved the membership helper behind a non-exposed schema, revoked public RPC execution from all three helpers, and created explicit restrictive deny policies for billing, credit-ledger, and GPU-reservation command state. A final provider security advisor scan returned no lints.

## Remaining gates

Email and Google OAuth are not configured. The RLS matrix remains available for a provider-hosted test database when a branch-capable plan is intentionally purchased. The project has no real user records, no seeded plan catalog, no live Paddle connection, and no browser upload capability.
