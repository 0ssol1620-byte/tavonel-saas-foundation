# Actual Core → PostgreSQL synthetic journey — 2026-09-30

## Scope and integration base

The isolated Foundation clone remains `C:\Users\yspow\Documents\Codex\2026-09-30\task-2\customer-journey`, branch `codex/customer-journey-local`. Before implementation, fetched integration checkpoint `2ed47797` and merged it locally as `5af5314c2f8f8ba2ea3dc3f99707bbbb5936109e`, retaining the earlier receipt fix. No integration-owned worktree was changed. The new deliverable changes only the local integration harness and this report; there is no public UI or Core engine edit.

The own, unmodified Core clone `task-2\core-journey` is pinned to the coordinated fix **`6ae628202317f71f9f09c0863aad1f4e0c900794`**, fetched from `task-3\core-work` without changing that checkout. The preceding report's missing `immutableInputsOnly` dependency is resolved for this exact local Core revision. No deployed compatibility is inferred.

## Reproducible implementation

`nextjs/scripts/journey/local-postgres-journey.mjs` creates a fresh PostgreSQL 17 cluster on a newly selected loopback port, with SCRAM authentication and a generated disposable local password. It accepts neither an existing database URL nor an existing cluster directory. It sanitizes inherited environment variables, applies the complete 103-file Foundation migration chain, and stops/removes only its own generated cluster in `finally`. It does not touch the integration owner's stopped cluster or any existing user service. On Windows the normal process token is required: PostgreSQL's restricted-token startup cannot run within the execution sandbox. No global Git/security settings were changed.

The existing migration runner supplies minimal `auth.users`/`auth.uid()` prerequisites. Therefore the tests exercise real SQL grants, RLS, triggers and production RPC bodies with synthetic session claims, **not** a running Supabase Auth server or verified JWT. The only additional bootstrap grant gives authenticated test sessions access to the minimal `auth.uid()` helper; production application grants and policies remain exactly those in the migrations.

When explicit isolated Core paths are supplied, the harness runs the actual Core HTTP suite with one worker and receives its real projected initial/updated artifacts in its own temporary directory. Those actual manifest digests, world IDs and receipt output hashes are then used in real SQL activation, update and historical rollback. Artifacts are temporary fixture files, not uploaded R2 objects. The Core suite still refuses projection if its actual immutable-input validation field is removed.

## Verified outcomes

- PostgreSQL **17.2**, all **103/103 migrations** applied, no failures.
- **48 actual database assertions passed**: signup-owner bootstrap; owner/outsider tenant RLS and cross-tenant write denial; anonymous/browser lifecycle access denial; server direct-pointer mutation denial; foreign-actor rejection; first publication; exact receipt replay without duplicate events; changed-body idempotency conflict; revision update; membership revocation; invitation-based restore; old-epoch receipt refusal after restore; historical rollback; ABA stale revision refusal; two backend sessions contending for one CAS with exactly one winner.
- A third backend completes a transition inside an open transaction and reaches a named pre-commit sleep barrier. Terminating only that identified backend in the disposable cluster yields a client connection failure, and rolls back pointer, candidate version, receipt and event changes. The previously committed revision remains intact.
- Real provider ACL snapshot functions deny missing, foreign-tenant, other-version and unlisted-principal access. A newer empty snapshot revokes access; a subsequent verified snapshot restores it. The actual serving overlay continues denying connector sources without a verified viewer binding. Browser ACL probes and cross-tenant snapshot insertion are rejected.
- The fixed Core's **5 actual HTTP/adapter tests passed**, including promotable projection, readable evidence and grounded 30→45 day answers, durable restart/replay, incremental equivalence, authentication failure and response-tamper refusal. Its two real artifacts activate/update/restore in the actual SQL database, preserving their receipt bindings.
- `pnpm check`, standalone harness lint and `git diff --check` passed. No claim that the default unit suite covers this opt-in service harness. The predecessor's full aggregate result remains separately recorded in the preceding report.

The machine-readable run is `C:\Users\yspow\Documents\Codex\2026-09-30\task-2\postgres-journey-report.json`; it records the Foundation revision, harness SHA-256, exact Core revision, migration results and individual assertion names. Test processes and temporary journal/cluster directories were checked and removed.

## Run locally

From the isolated Foundation `nextjs` directory:

```powershell
$env:TAVONEL_LOCAL_POSTGRES_BIN='C:/Program Files/PostgreSQL/17/bin'
$env:TAVONEL_LOCAL_CORE_DIR='C:/Users/yspow/Documents/Codex/2026-09-30/task-2/core-journey'
$env:TAVONEL_LOCAL_CORE_PYTHON='C:/Users/yspow/Documents/Codex/2026-09-30/task/.core-venv/Scripts/python.exe'
node scripts/journey/local-postgres-journey.mjs
pnpm exec eslint --no-ignore scripts/journey/local-postgres-journey.mjs scripts/journey/local-core.integration.test.ts
pnpm check
```

Omitting **both** Core paths runs the SQL/ACL-only 44-assertion variant. Supplying only one path fails. The test never silently contacts a live service or skips an assertion in the selected variant. Both variants use fresh databases, and require the existing read-only Python dependencies only for the joined variant.

## Remaining real boundaries and masterplan status

Stock PostgreSQL does not include pgvector here. The existing explicit vector-domain shim is used for schema application in two migrations; **dense/vector retrieval is unverified**. A compatible local pgvector extension/binary or an authorized disposable image is required for that acceptance gate. Docker is unavailable; this test does not install extensions into the user's PostgreSQL installation.

Real Supabase Auth/GoTrue and PostgREST services are not available/qualified. Consequently no JWT signature/expiry/session-refresh or HTTP-to-RLS mapping is proved. A disposable compatible local Auth/Data API service and synthetic session fixtures are needed for those checks. The standalone SQL runner does not assume those credentials or relax their future gates.

R2/S3-compatible storage, intake/CDR/OCR, actual hybrid retrieval and the authenticated browser remain separate real boundaries. A disposable object service is needed to test candidate upload/download and immutable version reads; the SQL RPC checks key/receipt bindings but cannot prove remote object existence, content or ACL. The Core accepts synthetic OCR regions in these tests; no sanitizer or OCR job ran.

K04/K06: named local Core receipt/projection and incremental equivalence verified. K07: actual SQL transaction/replay/concurrent pointer qualification verified for these fixtures. K09/K19/K21: real tenant/member/provider-ACL checks qualified, but Auth/session and final serving integration remain partial. K10 and UX11–UX16 remain partial because a complete browser intake→publish→consumer→revoke/restore path is not verified. No entire K/UX requirement is marked complete solely from these fixtures. Next local critical path is disposable object storage plus HTTP/Auth mapping, then intake/retrieval; estimated 1–3 working days for the next boundaries if compatible services are available, with low confidence. This is not a whole-masterplan completion estimate.
