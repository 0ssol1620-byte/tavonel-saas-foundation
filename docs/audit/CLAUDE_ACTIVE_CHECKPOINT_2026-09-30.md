# Real-Auth hydrated review/publish — project record (2026-10-01)

## Scope

Base `725276e41b5bd5ce3b0d341f7447adbb0d9a7085` (preview cost controls `357ccf1`/`725276e` unchanged). Published as a qualified draft to `codex/masterplan-checkpoint-2026-09-30` (draft PR #141). No workflow, service, preview, flag or security change.

Payload (only these files):

- `nextjs/scripts/journey/real-auth-ci-journey.mjs` — only the initial revision is activated through SQL; the updated revision stays a candidate. After the selected-revision inspection, the genuine GoTrue session drives the reviewed `e2e/support/workspace-review-actions.ts` controls (**Accept**, **Activate reviewed candidate**) on `/workspace/review`. New assertions: candidate not active before (`initial@1`), `POST /api/v1/reviews` 201, SQL accept row for the exact manifest/actor, promote 200 + `WORLD_ACTIVE`, active pointer `updated@2`, previous version `superseded`, 45-day evidence re-inspected. Ledger flag `hydratedReviewPublishVerified`. A disposable `foundation_billing_accounts` row (no provider customer/subscription) satisfies the review-decision foreign key.
- `nextjs/scripts/journey/real-auth-ci-contract.mjs` — `UPDATED_SOURCE_TEXTS`, `currentSourceObjects` (refuses bytes whose sha256 ≠ bound `versionKey`).
- `nextjs/scripts/journey/real-auth-ci-contract.test.mjs` — source-binding test; driver-import test (required on GitHub Actions, skipped elsewhere when Node cannot strip TypeScript).

Not covered: browser intake/upload/compile, Google OAuth, production cookie/admission, R2. The stored `sanitized.pdf` objects are synthetic UTF-8 texts under a PDF key — **not** CDR, OCR, PDF rendering or production admission evidence.

## Local evidence (Windows 10, Node v22.14.0)

- Focused: `node --test scripts/journey/real-auth-ci-contract.test.mjs scripts/journey/stop-owned-child.test.mjs` → 10 tests, 8 pass, 0 fail, 2 skip (driver import: local Node cannot strip TypeScript; SIGTERM-force: pre-existing platform skip).
- `node --check` (journey files), `pnpm exec eslint --no-ignore` (3 files), `pnpm check` (brand, type floor, `tsc --noEmit`, eslint), `pnpm scan:secrets` → pass. Contract Vitest 69/69.
- Full Vitest: 404 files (402 pass, 2 fail); 5874 tests: **5871 pass, 3 fail**. All 3 failures are Windows symlink privilege (`EPERM symlink` ×2 in `lib/release-manifest-inputs.test.ts`; `WinError 1314` in `lib/source-agent-runtime.test.ts` Python suite), outside the Auth payload. Not worked around (no OS privilege/Developer Mode change, no test skip). Hosted Linux at `ca104ea` passed these.
- `pnpm build`: `prebuild` (`pnpm check`) passed, then its hermetic Vitest step failed on the same 3 Windows tests, so **the optimized `next build` was not reached locally**. Hosted CI performs the real optimized build.

## Qualification status

Publication qualified by the parent as a draft despite the 3 established Windows-only failures; hosted Linux CI + manual `db-rehearsal.yml` are the qualifying gate.

- Published head: **not published** — exact-path `git add` of the four payload files was denied by the session permission gate (no approval surface), once chained and once as a single command. Nothing staged, committed or pushed; local HEAD and `transport/codex/masterplan-checkpoint-2026-09-30` remain `725276e`.
- Push-triggered CI: unrun (no push).
- `db-rehearsal.yml` (manual): not dispatched (would run the old head `725276e`, not this payload).

## Acceptance

Unchanged: whole-55 = 2 complete / 36 partial / 11 unassessed / 6 external. The 35 prior real-Auth assertions (hosted, `ca104ea`) are not review/publish acceptance; the new assertions count only after a hosted run of the published head.

## Current status correction (2026-10-01)

Supersedes the 'Published head' line above: exact-path staging of the four payload files has now succeeded once under a one-time approval. Commit, push, push-triggered CI and manual `db-rehearsal.yml` qualification are pending; nothing is published yet.

## Receipt and hosted qualification (2026-10-01, parent-reported)

Supersedes the pending statements above. Recorded as reported by the coordinating parent; this Claude session did not independently re-query GitHub.

- Published head: `11e50ee642cd974e3c156bc680912343df9dbf05` (`test(auth-ci): verify hydrated review and publish through real Auth`), matches local HEAD.
- Manual real-Auth run `36790582519`: **SUCCESS**, 47 real-Auth assertions, ledger `hydratedReviewPublishVerified=true`, production-mode Next. Push CI, LaunchQA, CodeQL, DB rehearsal and malware scan reported green for that head.
- First attempt `36789156864` failed at initial navigation with `net::ERR_ABORTED`; an unchanged retry passed. Cause not diagnosed — **unexplained flakiness remains open**, not waived.
- Flags unchanged and false: `googleOAuth`, `productionAuthCookieUsed`, `productionSourceAdmission`.
- Still not covered: browser intake/upload/compile, Google OAuth, production cookie/admission, R2, CDR/OCR. Whole-55 totals unchanged (2 / 36 / 11 / 6).

## Bounded slice: superseded connector revision refusal (2026-10-01, local, uncommitted)

Scope limits: no commit/push/workflow/external mutation; no OAuth, credentials, paid services, production data/security, migration, merge/deploy or Core visibility change. Preview cost controls (`357ccf1`/`725276e`) untouched.

Inspection (Foundation only). Already present: logical-source/byte-version tombstones deny serving (`connector_documents_blocked`) and are re-checked immediately before and after Core dispatch; tombstoned logical sources cannot be re-imported (`connector_source_import_allowed` + trigger); two revisions of one logical source in one selection fail closed. **Missing (K02/K03 latest-revision reconciliation, previously recorded as unfinished):** a connector compile/refresh that named revision 1's immutable upload UUID after revision 2 of the same logical source was bound still resolved, compiled and could be persisted as a candidate, i.e. stale provider content could reach review/publication.

Behavior implemented:
- `nextjs/lib/connector-compile-identity.ts`: after resolving and verifying every selected binding, reads the latest bound revision per logical source (`connector_document_bindings`, same workspace + `source_id`, `order=recorded_at.desc`, limit 2). Not latest → `CONNECTOR_SOURCE_REVISION_SUPERSEDED`. Order is the database's first observation (`recorded_at`), never provider revision strings; equal observation instants → `CONNECTOR_SOURCE_REVISION_AMBIGUOUS` (no id tie-break); unavailable/empty/foreign/unparseable/non-descending reads fail closed. Other workspaces never count as newer.
- `nextjs/lib/collection-compile-run.ts`: connector-scoped `revalidate()` re-resolves identities, so a newer revision bound while Core runs refuses the result (409) before artifact registration or R2 candidate write. Existing ACL/tombstone access check and byte-version check unchanged and still run.
- Historical revisions stay immutable and are not deleted, tombstoned or hidden from history/serving; only new compile selection is constrained. No DB migration.

Tests (Windows 10, Node v22.14.0, this session):
- `lib/connector-compile-identity.test.ts` rewritten around a query-routing PostgREST stand-in (mock, not real PostgREST): 17 pass, including superseded refusal, recorded_at-over-provider-string order ("9" before "10"), equal-instant ambiguity, cross-workspace isolation, five fail-closed read shapes, preserved corrupt/missing/unavailable cases.
- `lib/collection-compile-run.test.ts`: +2 (pre-dispatch refusal without Core dispatch; in-flight supersession → dispatched once, no `registerCollectionArtifact`, no candidate `put`). 41 pass.
- `tsc --noEmit` pass; ESLint on 4 changed files pass.
- Related suites (`lib/connector*`, `collection*`, `source*`, `sync-worker*`, `customer-source*`, `compile*`, `retrieval*`, `core-runtime-v2*`, `scoped-admission*`): 75 files, 848 pass / 1 fail. The failure is the pre-existing `lib/source-agent-runtime.test.ts` Python `test_symlinks_not_collected` `WinError 1314` (Windows symlink privilege), unrelated and not worked around.
- Not rerun: full Vitest aggregate, optimized build, browser suites (unaffected paths; not claimed).

Blockers / not established:
- Real local PostgreSQL + PostgREST harness not run: `TAVONEL_LOCAL_POSTGRES_BIN` and `TAVONEL_LOCAL_POSTGREST_EXE` are unset and no binaries on PATH; locating them would require searching outside Foundation, which is out of scope. The actual PostgREST `order=recorded_at.desc` query and microsecond `recorded_at` semantics therefore remain unqualified against a real server. Next step when provided: add a two-revision binding check to `scripts/journey/local-postgres-journey.mjs`/`local-postgrest-journey.mjs`.
- `recorded_at` = first database observation, not provider chronology. A provider sync that observes an older revision after a newer one would make the older one "latest"; provider-side ordering remains unfinished.
- Refresh/worker does not yet auto-substitute the latest revision into a collection; it refuses. Automatic latest-revision selection, derived-cache revocation and same-context API/MCP/CLI proof remain open.
- Acceptance totals unchanged (2 / 36 / 11 / 6); K02/K03 remain partial.

### Actual DB/PostgREST attempt (2026-10-01)

- Binaries resolved only from the approved prior harness reports (`task-2\customer-journey\docs\audit\LOCAL_JWT_POSTGREST_JOURNEY_2026-09-30.md`, `LOCAL_CORE_SQL_JOURNEY_2026-09-30.md`): `C:/Program Files/PostgreSQL/17/bin` (`postgres --version` → `PostgreSQL 17.2`) and `task-2/runtimes/postgrest-16.4/postgrest.exe` (SHA-256 `c4155000dfb0befb59215b65d61a621bbaea1515f36a6e758fc504c7ca0dcbee`, equal to the harness pin).
- Added `nextjs/scripts/journey/local-source-revision.integration.test.ts` (unchanged product `recordConnectorDocumentBinding` / `readConnectorCompileIdentities` / `requestConnectorSourceDeletion` against actual PostgREST; transport-only `https://…/rest/v1` → loopback root) and harness wiring in `local-postgres-journey.mjs` (synthetic governed workspace `pilot-c333333333334333`, grace 0, legal hold off) and `local-postgrest-journey.mjs` (runs the test, then SQL checks: 3 immutable bindings retained, one tombstone, overlay denies all revisions, historical ACL version/workspace-bound).
- **Local run FAILED before any assertion**: `initdb` succeeded; `pg_ctl.exe -D %TEMP%\tavonel-sql-journey-WF68OP\data -l …\server.log -o "-h 127.0.0.1 -p 53481" -w start` exited status 1 (stdout/stderr not captured — harness uses `stdio: ignore` for start; `server.log` was deleted by the harness cleanup). Consistent with the prior report that Windows PostgreSQL start needs the normal process token, unavailable under the sandboxed restricted token. A sandbox-disabled retry was declined by the user; not attempted again.
- Cleanup: no `tavonel-sql-journey-*` directory remains in `%TEMP%`. Running `postgres`/`pg_ctl` processes are not readable from this token and correspond to the pre-existing `postgresql-x64-17` Windows service (Running); left untouched.
- Next: qualify on hosted Linux via the existing DB workflow's disposable services (no new permissions/secrets).

### Hosted qualification wiring (2026-10-01)

- Shared module `nextjs/scripts/journey/source-revision-journey.mjs` creates the synthetic governed workspace and connection, runs `local-source-revision.integration.test.ts` (8 service assertions: r1 resolves; r2 supersedes r1 before compile; r2 resolves to the same logical source; r1+r2 ambiguous; identical rebind of r1 does not make it latest; r3 bound while a compile is in flight refuses the post-dispatch recheck; all three bindings stay readable and a PATCH rewrite is refused; provider deletion tombstones, refuses r4 with `SOURCE_TOMBSTONED`, and replays the same receipt), then 6 SQL checks (3 bindings retained, 1 tombstone, overlay denies r1–r3, historical ACL version-bound / not leaking to r3 / not cross-workspace). Errors redact the service key and JWTs.
- Used by `local-postgrest-journey.mjs` (bare PostgREST 16.4) and by `real-auth-ci-journey.mjs` after the hydrated browser stage, against the existing `real-auth-journey` job's disposable local Supabase stack (`${API_URL}/rest/v1`, the stack-generated service key). No workflow YAML, permission, secret or service change; existing gates (`scan:secrets`, `check`, `test`, contract tests) run first as before. Ledger flag `sourceRevisionLineageVerified`.
- Side effect to watch: the job's final best-effort GoTrue user delete may now be refused by the new rows' `created_by` foreign keys; it is already wrapped in `.catch` and the stack is stopped with `--no-backup`.
- Local results this session: `node --check` 4 harness files, ESLint 9 changed files, contract tests 8 pass / 2 pre-existing platform skips, integration test skip-mode 8 skipped (no service), `pnpm scan:secrets` clean, `pnpm check` pass. Not run here: the actual-service assertions themselves (hosted only).

### Provider ordering / latest replacement: contract assessment (2026-10-01)

Code-level contracts in `lib/connector-oauth-adapters.ts`, `lib/google-drive-lifecycle.ts`, `lib/source-version-guard.ts`, `lib/source-import.ts`:

- **Google Drive**: revision = Drive `version`, required numeric (`/^\d+$/`). Before binding, import re-reads the file metadata before and after download and requires the listed revision to equal the current `version` (or md5). So a binding records a revision that was current during its import window.
- **Microsoft Graph**: revision = `eTag`, falling back to `cTag`, then **`lastModifiedDateTime`**. It is opaque, and the same before/after current-version check applies. The timestamp fallback is a string, not a chronology, and is never compared.
- **Dropbox**: revision = `rev` (opaque). `observeSourceVersion` returns `null`, and the download is pinned to `rev:<listed rev>`. Integrity (id/rev/content_hash) is checked, but **there is no check that the rev is still current**. A stale or replayed list page can therefore bind an older rev after a newer one.
- **Residual races (all providers)**: two concurrent imports can interleave so that an older-but-current-at-the-time revision's binding commits after a newer one. `recorded_at` then reflects commit order, not provider order.
- **Disposition**: no provider chronology is inferred. Google's numeric `version` is the only orderable value the code already enforces, and it is not used for ordering yet. Remaining bounded options:
  - Dropbox: a current-rev check before binding (official `files/get_metadata`).
  - Google: a per-source monotonic `version` guard.
  - Graph: a refusal when a newer binding exists for a different eTag that is no longer current.
  
  None is implemented. Latest replacement (substituting the current revision into a refresh) also remains unimplemented: refresh refuses rather than substitutes.

Proposed files for any later publication (not staged/committed): `nextjs/lib/connector-compile-identity.ts`, `nextjs/lib/connector-compile-identity.test.ts`, `nextjs/lib/collection-compile-run.ts`, `nextjs/lib/collection-compile-run.test.ts`, `docs/audit/CLAUDE_ACTIVE_CHECKPOINT_2026-09-30.md`.
