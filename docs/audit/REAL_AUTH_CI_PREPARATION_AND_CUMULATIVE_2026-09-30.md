# Real Auth CI preparation and cumulative journey ledger

Current Auth qualification: exact Foundation ca104ea passed actual disposable GoTrue + optimized Next + Chromium, 35 assertions, at 17:31 UTC. See [REAL_AUTH_ROUTING_AND_EXPIRY_2026-09-30.md](REAL_AUTH_ROUTING_AND_EXPIRY_2026-09-30.md). Earlier preparation/pending statements below are historical. Google OAuth, production source admission and full intake/review/publication remain unqualified; whole-requirement counts are unchanged.

**Prepared, not hosted-executed.** This increment adds a manual-only qualification job to the already registered DB rehearsal workflow and a genuine GoTrue test harness. No GitHub workflow was dispatched, no branch was pushed and no GoTrue service was run on the user's desktop. Existing `.github/workflows/ci.yml`, DB rehearsal steps and permissions are unchanged; only an independent `real-auth-journey` job is appended, conditional on manual dispatch. Latest published Foundation `5af5baf9` was integrated at `7dfd9cb9b0652c2724399a4ae8c65837dc755571` before this increment; no frontend component changed.

## Existing CI can supply the missing runtime

`db-rehearsal.yml` already uses an `ubuntu-latest` Docker runner, PostgreSQL 17 and official Supabase CLI **2.116.0**, with the official Docker Hub registry override. Its `supabase db start` path starts the database only. The appended manual-only `real-auth-journey` job uses the same pinned CLI's **`supabase start` full local stack**, which supplies genuine GoTrue and PostgREST without linking a project or providing external credentials. Only a newly generated runner-local `config.toml` has a 60-second test JWT lifetime. Production security settings and deployment gates are untouched. Reusing the existing registered workflow permits a manual run against the integration branch without requiring a new workflow on the default branch or a merge.

The workflow requests only `contents: read`; no repository secret, Supabase access token, project reference, production DSN, paid service or new permission is used. The GoTrue account has a freshly generated password and a synthetic `.invalid` email, created and confirmed through the local provider admin API. It does not send email or invoke Google OAuth. No Google-login claim can follow from this password-provider test.

The local status file must be directly inside `RUNNER_TEMP`. Before mutation, the harness requires GitHub disposable CI and precisely the default loopback API `127.0.0.1:54321` and database `127.0.0.1:54322/postgres`; alternate/remote targets fail. Local status keys are never uploaded. The stack is stopped without backup in an `always()` step. Only the redacted assertion ledger is an artifact; no browser traces, sessions, passwords, tokens, TLS private keys or stack configuration are uploaded.

S3 uses the previously verified official portable SeaweedFS 4.48 service. Linux release archive SHA-256 `4a7d108384d044d95212d1342cdda9533fa55842c1c9b41f606ca3c8a9561124` was checked against GitHub release metadata and actual downloaded bytes; executable SHA-256 is `8c07a1ccc4ec058cd90989ac0533c30436832e41c63de2b26f37253d9f744c4d`. Linux execution remains pending CI. The helper verifies platform-specific hashes before execution and confines its filer socket to the generated temporary directory. No system runtime was installed on the desktop.

## Prepared actual-provider coverage

The optimized Next build runs after the existing secret scan, TypeScript/lint and full unit gates. A fresh loopback HTTPS proxy forwards **all `/auth/v1` requests to genuine GoTrue**, with no synthetic identity adapter. Its local certificate is trusted only by the owned Next process; the isolated browser context accepts the fixture certificate. There is no system trust-store change. Browser outbound requests outside loopback are aborted.

Planned strict assertions cover missing-session callback failure; actual browser password login against GoTrue; one aborted bootstrap network hop producing a visible callback failure; retry completing the actual callback; refresh token rotation; actual selected-revision UI reads with 30-day versus 45-day policy evidence; selected revision after reload and browser Back; actual global logout revoking the refresh token; naturally expired actual provider JWT refusal through both GoTrue and Next; and an expired trial-risk-cookie-only browser remaining unauthenticated. Back may restore a previously verified model from the browser cache, so that step requires the correct URL and rendered evidence rather than inventing a mandatory network request.

The app currently persists Supabase sessions in browser storage and sends Bearer tokens. `tvnl_device` is a trial-risk cookie, not an Auth session cookie. The harness does not invent an authenticated-cookie implementation or treat its expiry as provider session revocation.

[Supabase's session documentation](https://supabase.com/docs/guides/auth/sessions) distinguishes logout/refresh revocation from an already-issued JWT's remaining validity. The harness records immediate post-logout GoTrue and Next access-token behavior separately, then requires refusal after natural expiry; it does not forge an expired JWT or silently claim immediate access revocation when a valid token remains usable. A positive `success` ledger therefore still requires examining `logoutAccessTokenImmediatelyRefused` and `nextLogoutAccessTokenImmediatelyRefused` before making any stronger logout guarantee. No existing security gate was relaxed.

## Local checks actually executed

- Four fail-closed CI configuration tests passed: remote API/database, alternate ports, absent keys and ordinary workstation execution are refused.
- Node syntax, added-file ESLint, `pnpm check`, secret scan and workflow YAML/manual-trigger/read-only-permission validation passed.
- Existing six real Windows S3 tests passed after the reusable helper's Linux/hash/socket additions.
- Existing five actual Core HTTP tests passed while generating the two unchanged synthetic UI fixtures; fixture hashes and exact Core commit are recorded beside them.
- Secret scan found a false match in the earlier arbitrary cookie fixture text (`risk-cookie...` contains an OpenAI-style `sk-` substring). Only that fixture label was renamed; scanner rules and exclusions were not changed.

These local checks **do not prove GoTrue startup, hosted image availability, the production Next build in this job, provider endpoint behavior or hydrated selected-revision UI**. Any failing hosted assertion remains a qualification finding; there is no skip, mocked Auth or production fallback.

## Cumulative authenticated lane status

| Boundary | Evidence | Remaining limit |
|---|---|---|
| Foundation journey and ACL/replay guards | `d34cdf6f`, focused synthetic journey plus guard tests | Service doubles in that initial increment |
| Real Core HTTP and receipt wire hash | `3b1f7f7`, actual Python HTTP outputs and bounded wire parser | Local synthetic corpus, no customer intake |
| Real PostgreSQL/Core revisions | `b345c01b`, actual migrations/CAS/revoke/reinvite/restore | pgvector shim, bare auth bootstrap |
| Actual PostgREST JWT/RLS | `3534304d`, real JWT verification and HTTP-to-SQL lifecycle | Synthetic JWT issuer, no GoTrue |
| Actual S3 protocol | `bdf4d75f`, six actual-service signer/immutability/digest tests | SeaweedFS, not production R2 |
| Actual Next/browser downstream | `4bee0958`, **109 cumulative assertions**, real read/restore/lost-response replay/stale publication/membership refusal | Next development mode and explicit synthetic identity adapter; API actions rather than hydrated workspace selection |
| Genuine GoTrue and optimized Next/UI | Exact `ca104ea` hosted run 36750543772, 35 assertions | **Passed in disposable actual GoTrue/S3/SQL/production Next/Chromium; full intake/review/publication and OAuth remain open** |

K04/K06 retain their local real-Core qualification. K07 retains actual browser restore/replay/CAS qualification. K09/K19/K21 retain actual JWT/RLS and Next membership-revocation qualification; provider-login/session semantics remain pending. K10 and UX11–UX16 stay partial. No item completion count or production readiness claim is increased.

## Exact remaining prerequisite

No new secret or user-system permission is needed. The integration owner must integrate this local commit and manually run **DB rehearsal** against the integration branch; the **Real local Auth journey** job then runs on its own existing public GitHub runner. Review its redacted ledger and any failed assertion. The desktop still lacks Docker/GoTrue, so genuine Auth execution cannot be verified here. Google OAuth would require its separately authorized provider configuration and remains outside this bounded fixture qualification. After the hosted result, update the cumulative ledger from actual evidence rather than adding further synthetic variants.
