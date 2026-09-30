# Actual JWT / PostgREST / Core / SQL boundary — 2026-09-30

## Deliverable and frozen inputs

The isolated Foundation clone remains `C:\Users\yspow\Documents\Codex\2026-09-30\task-2\customer-journey`, branch `codex/customer-journey-local`. Fetched integration checkpoint **`7f1c0c78`**, merging it locally as `0c189e86`. The only merge conflict was the earlier Core harness imported by integration; retained the already verified computed-validation/artifact-export version from `b345c01b`. No integration-owned worktree was edited. This deliverable adds an actual PostgREST service harness and extends the existing disposable SQL runner; it changes no production schema, auth policy, public UI or Core implementation.

Core remains pinned in the own unmodified `task-2\core-journey` clone to **`6ae628202317f71f9f09c0863aad1f4e0c900794`**. PostgreSQL is the installed **17.2** runtime. The preceding Core/SQL harness remains the source of synthetic fixtures and real package/receipt qualification.

## Actual service provenance

No MinIO/S3 server, PostgREST, GoTrue or Docker executable was initially on PATH. Used the official [PostgREST 16.4 Windows release](https://github.com/PostgREST/postgrest/releases/tag/v16.4), downloaded into the task's `runtimes\postgrest-16.4` directory. No system installation, service registration, global Git configuration or persistent security setting was changed.

- Official asset URL: `https://github.com/PostgREST/postgrest/releases/download/v16.4/postgrest-v16.4-windows-x86-64.zip`.
- Archive SHA-256, verified against official GitHub release metadata before extraction: `29a5b56e5a09b7168bb552ef14aa7ade40bf0a81dd0687cffa86610187b89d78`.
- Extracted executable SHA-256: `c4155000dfb0befb59215b65d61a621bbaea1515f36a6e758fc504c7ca0dcbee`. The Windows harness requires this exact hash before execution.
- Local executable: `C:\Users\yspow\Documents\Codex\2026-09-30\task-2\runtimes\postgrest-16.4\postgrest.exe`.
- The installed PostgreSQL `bin` directory supplies its existing libpq/DLL dependencies through the **child process environment only**. An initial missing-DLL startup was resolved without installing a runtime or changing system PATH.

The [official authentication contract](https://postgrest.org/en/stable/references/auth.html) describes JWT verification and transaction-local database role switching. This harness executes that actual binary; it does not implement or mock JWT verification, the REST service, SQL functions, RLS, Core compilation or the durable journal.

## Implementation and verified behavior

`nextjs/scripts/journey/local-postgrest-journey.mjs` is called only when the SQL runner receives an explicit local PostgREST executable. It starts the checksum-qualified binary against the runner's own newly created PostgreSQL cluster, on a newly chosen loopback port. It creates a `NOINHERIT`, non-superuser authenticator role only inside that disposable database. It uses newly generated local JWT and database keys stored in the generated temporary configuration. Those keys never connect to an external account, enter a repository or survive cluster cleanup. The database pool is bounded to two connections.

Bare PostgreSQL's minimal `auth.uid()`/`auth.role()` test bootstrap is extended to read PostgREST's real `request.jwt.claims` JSON, while retaining the older SQL fixture claim settings. Production Supabase migrations/grants/policies are unchanged. This is an explicit local Supabase helper bootstrap, **not** a simulated GoTrue session server.

The joined selected variant passes **81 assertions**: the preceding 48 actual SQL/Core assertions plus 33 new HTTP/JWT assertions. The new boundary verifies:

- Owner and outsider JWTs reach only their own RLS profiles. Foreign profile reads return no rows, and foreign updates affect no rows. Anonymous profile access is rejected.
- The actual PostgREST service rejects incorrect signatures, expired tokens, future `nbf`, wrong audience and unsigned `alg=none` tokens. A correctly signed token cannot assume the ungranted `postgres` role. Browser-editable metadata cannot elevate an authenticated token's database role.
- Authenticated browser JWTs cannot read lifecycle pointers or invoke the private publication RPC. A synthetic trusted server-role JWT can invoke the **actual** RPC over HTTP, passing the authorized actor as the production server contract requires. The SQL transaction independently rejects a foreign actor. This does not assert that a browser token may call server-private RPCs.
- The actual initial/updated Core artifacts from the preceding harness retain their real manifest/world/receipt bindings. A real HTTP publication advances the SQL pointer, and a repeated operation returns its original receipt with replay status.
- Actual HTTP membership revocation and invitation/acceptance RPCs work. The previously issued JWT remains a valid identity token for the user's own profile, while fresh membership checks deny publication for the revoked actor. Reinvitation restores membership but does not revive an old-epoch transition receipt. A new authorized operation can restore the retained Core version.
- Two actual HTTP publication requests contend for the same pointer/revision through PostgREST's connection pool; exactly one commits and the other returns the named CAS conflict. The pointer advances once.

Core's 5 real HTTP/adapter tests run within the selected joined variant. The complete 103-file migration chain applies to the fresh cluster. Standalone harness lint, `pnpm check` and `git diff --check` pass. No new default-suite dependency or skipped placeholder test was added.

PostgREST is stopped before the PostgreSQL cluster; temporary configs, fixtures, journal and cluster data are removed. Existing user services and the integration owner's stopped cluster remain untouched.

## Reproduce

Use the exact checksum-verified official binary above. From the isolated Foundation `nextjs` directory:

```powershell
$env:TAVONEL_LOCAL_POSTGRES_BIN='C:/Program Files/PostgreSQL/17/bin'
$env:TAVONEL_LOCAL_CORE_DIR='C:/Users/yspow/Documents/Codex/2026-09-30/task-2/core-journey'
$env:TAVONEL_LOCAL_CORE_PYTHON='C:/Users/yspow/Documents/Codex/2026-09-30/task/.core-venv/Scripts/python.exe'
$env:TAVONEL_LOCAL_POSTGREST_EXE='C:/Users/yspow/Documents/Codex/2026-09-30/task-2/runtimes/postgrest-16.4/postgrest.exe'
node scripts/journey/local-postgres-journey.mjs
pnpm exec eslint --no-ignore scripts/journey/local-postgres-journey.mjs scripts/journey/local-postgrest-journey.mjs
pnpm check
```

Windows PostgreSQL initialization requires the normal process token, as established in the preceding report. All runtime and SQL connections still target generated disposable loopback services. The report records exact Foundation/Core revisions, both harness hashes and PostgREST binary hash. Machine-readable result: `C:\Users\yspow\Documents\Codex\2026-09-30\task-2\jwt-postgrest-journey-report.json`.

## Remaining actual boundaries

**Qualified:** actual JWT cryptographic validation and HTTP-to-role/RLS/RPC mapping through PostgREST, plus actual Core and SQL cross-revision operations for the named local fixtures.

**Still unverified:** GoTrue signup/password/session issuance, refresh/revocation, Next.js session cookies and application routes, authenticated browser acceptance, and an external identity provider. The test issuer is a local synthetic fixture signer. The smallest next Auth prerequisite is a disposable compatible GoTrue runtime with its own synthetic configuration and local auth schema; no cloud account or production key is needed. The existing Core/SQL tests continue independently.

**Still unverified:** S3/R2-compatible storage and immutable upload/download, intake/CDR/OCR, real hybrid retrieval and pgvector. Docker and Go toolchain were not available on PATH, and no S3 server was installed. These HTTP tests cannot prove candidate object existence, source object ACL or signed-download revocation: SQL verifies key/receipt bindings, and the artifacts are local synthetic fixture files. A supported local S3-compatible runtime is the smallest storage prerequisite. No system/runtime installation was performed to bypass it.

K04/K06 retain the preceding local Core qualification. K07 gains actual HTTP replay and concurrent CAS qualification. K09/K19/K21 gain actual JWT/RLS and membership-revocation boundary qualification, while complete application/session/source-serving acceptance stays partial. K10 and UX11–UX16 remain partial. No complete masterplan item or production readiness is inferred from these fixtures. Next critical path: disposable object storage or GoTrue session service, then application route/browser integration. Estimated 1–3 working days for those next local boundaries if compatible runtimes are available, with low confidence; this is not an entire-masterplan estimate.
