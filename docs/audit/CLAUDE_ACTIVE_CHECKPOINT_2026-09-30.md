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
- **Local run FAILED before any assertion**: `initdb` succeeded; `pg_ctl.exe -D %TEMP%\tavonel-sql-journey-WF68OP\data -l …\server.log -o "-h 127.0.0.1 -p 53481" -w start` exited status 1 (stdout/stderr not captured — harness uses `stdio: ignore` for start; `server.log` was deleted by the harness cleanup). Cause **unproven**: the restricted sandbox token is only a hypothesis (the prior report noted Windows PostgreSQL start needed the normal process token); no log evidence was captured. A sandbox-disabled retry was declined by orchestration under the existing no-bypass boundary (not a new user refusal) and was not attempted again.
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

## Recovery task receipt (2026-10-01)

Received by a new Claude session; the prior owned session exited. Scope: recover qualification only for published Foundation head `86c56f1d891551024363a3069a93b46d22b7bebb` (PR #141 branch) and manual DB/Auth run `36794635686`. Monitor exact-head CI to terminal, collect the redacted lineage ledger, fix only real scoped failures with guards unchanged, checkpoint results. Boundaries: preserve dirty work and preview cost controls; no secrets/customer data/credentials/security changes/bypass/paid services/merge/deploy/Core visibility change (Core private); no redundant dispatch; no unrelated implementation; Windows `pg_ctl` cause remains unproven and is not retried with sandbox disabled. Status: in progress.

### Manual DB/Auth run `36794635686` result (2026-10-01, queried by this session)

- Head `86c56f1d891551024363a3069a93b46d22b7bebb`, `workflow_dispatch`, conclusion **failure**. Jobs: `db-rehearsal` success; `Real local Auth journey` (job `110155142940`) failure at step "Qualify real provider login, interrupted callback, refresh, logout and selected-revision UI".
- Exact-head other checks: PR CI success, PR DB rehearsal success, CodeQL success, malware-scan success, Launch QA still running (separate watcher).
- **Criterion `sourceRevisionLineageVerified`: not evaluated (false).** The run never reached the `source-revision-lineage` stage; `hydratedReviewPublishVerified` also false. No new lineage assertion counts.
- Redacted ledger (artifact `real-auth-journey-86c56f1…`, 2047 bytes; count-only scan: 0 JWT, 0 `sb_` keys, 0 `service_role`, 0 token fields; the single `password` hit is the assertion label): `success=false`, `goTrueExecuted=true`, 15 assertions passed (fixture identity/UUID/membership, S3 fixtures ×4, SQL initial publication, callback-without-session, GoTrue login, fixture user, interrupted bootstrap, retry bootstrap, refresh, refresh rotation), flags `googleOAuthVerified`/`productionAuthCookieUsed`/`productionSourceAdmissionVerified` false, `authImageTag supabase/gotrue:v2.196.0`.
- **Concrete failure stage:** `real-auth-ci-journey.mjs:151` first `inspect(0, page.goto)` → line 140 `page.waitForResponse` for `GET /api/v1/world/{collection}?manifest=…` timed out after 30 s. Visible headings: "Preparing your knowledge." / "See a compiled World" (workspace overview state, `activityCount>0`). Ledger `stage` reads `callback-without-session` only because the harness does not update `stage` before this step.
- This step and every product path it exercises (`/workspace` mount, `/api/collections/{id}`, `/api/v1/world/{id}`) are unchanged between `11e50ee` (manual run `36790582519` passed it) and `86c56f1` (delta touches only connector compile-identity/compile-run and the post-UI lineage stage). The earlier failure `36789156864` (head `11e50ee`) failed at the **same call site** (`inspect` first `page.goto`, `net::ERR_ABORTED`). Two of three hosted runs failed at this locus: a recurring, undiagnosed instability, not shown to be caused by this delta.
- Cause **unproven**: the harness spawns `next start` with `stdio: ignore` and records no browser console/network, so no server error exists to preserve. In the client the world fetch is gated on `loadCollectionCandidate` (`/api/collections/{id}`) succeeding and setting `collectionResult`; a non-OK collection read, failed package verification, missing session, or a superseded navigation would each produce this timeout. None is evidenced.
- No product behavior change made; no rerun or dispatch made.
- **Next tested fix (diagnostic-only, guards unchanged):** in `real-auth-ci-journey.mjs` set `report.stage="selected-revision-ui"` before the first `inspect`; capture bounded, redacted Next server stdout/stderr (instead of `ignore`); record page `console` errors, `requestfailed`, and status of `/api/collections/*` and `/api/v1/world/*` responses (path + status only), plus the visible workspace notice text into `report.failure`. Keep the 30 s wait and every assertion. Validate locally (`node --check`, contract tests, ESLint, `scan:secrets`), then publish to PR #141 and one manual dispatch of that head only with approval.
- Diagnostic change implemented locally, uncommitted, only in `nextjs/scripts/journey/real-auth-ci-journey.mjs`: `next start` stdout/stderr piped into a 200-line redacted ring buffer; page `console` error/warning, `pageerror`, `requestfailed`, main-frame navigations and responses for `/api/collections*`, `/api/v1/world*`, `/api/access*`, `/auth/v1/token|user` (pathname + status only, no query) into a 200-entry redacted buffer; on failure the ledger gets the last 80 of each plus `pagePath` and live-region text; `report.stage="selected-revision-ui"` before the first `inspect`. Redaction reuses the existing one (password, anon/service keys, S3 secret, any JWT), now defined before spawn. No assertion, timeout, workflow, guard or product change.
- Local validation (Windows, Node v22.14.0): `node --check` pass; contract + stop-owned-child tests 10 → 8 pass / 0 fail / 2 pre-existing platform skips; ESLint pass; `pnpm scan:secrets` clean. The diagnostics themselves only execute on hosted CI.
- Pending (needs one-time approval): commit/push to PR #141 branch and one manual `db-rehearsal.yml` dispatch for that new head. Launch QA `36794616444` for `86c56f1` still being watched.
- All exact-head runs for `86c56f1` now terminal: Launch QA `36794616444` **success**, CI `36794616259` success, PR DB rehearsal `36794618546` success, CodeQL success, malware-scan success; manual DB/Auth `36794635686` failure (above). Batch qualification for `86c56f1` is therefore **not achieved** solely because of the manual real-Auth step; acceptance totals unchanged (2 / 36 / 11 / 6).

### Diagnostic head published (2026-10-01)

- Commit `ac1e0b25f5e36650154141d2a958f80141b934c0` (only `real-auth-ci-journey.mjs` + this checkpoint) fast-forwarded `86c56f1..ac1e0b2` to `transport` `codex/masterplan-checkpoint-2026-09-30` (PR #141); `git ls-remote` confirms the exact SHA.
- One manual `db-rehearsal.yml` dispatch on that head: run `36796633995` (queued 00:31:48Z). Lineage not claimed until its ledger shows `sourceRevisionLineageVerified=true`.
- Parent independently verified the `86c56f1` ledger artifact `11133516994` (15 genuine Auth assertions, then the 30 s Next response timeout; `hydratedReviewPublishVerified=false`, `sourceRevisionLineageVerified=false`). `36794635686` is terminal failed. Run `36796633995` is the current qualification. Provider chronology and latest-revision replacement remain open gaps (see the provider-ordering assessment above), independent of this run's outcome.

### Manual DB/Auth run `36796633995` result (head `ac1e0b2`, queried by this session)

- Conclusion **success**: `db-rehearsal` (job `110161471000`) success, `Real local Auth journey` (job `110161471104`) success.
- Redacted ledger, artifact `real-auth-journey-ac1e0b2…`. Count-only scan found 0 JWTs, 0 `sb_` keys, 0 `service_role`, 0 token fields; the single `password` hit is the assertion label.
- Ledger fields:
  - `success=true`, `foundationCommit=ac1e0b25f5e36650154141d2a958f80141b934c0`, `stage=source-revision-lineage`, `failure` absent.
  - 62 assertions (46 distinct).
  - `goTrueExecuted`, `selectedRevisionUiVerified`, `hydratedReviewPublishVerified` and **`sourceRevisionLineageVerified` all true**.
  - `googleOAuthVerified`, `productionAuthCookieUsed` and `productionSourceAdmissionVerified` all false.
  - `nextMode=production`, Chromium 151.0.7922.34, `supabase/gotrue:v2.196.0`, harness sha256 `ace074c1…1db9`.
- Lineage criterion met on actual hosted Supabase PostgREST/PostgreSQL (disposable CI stack, synthetic governed workspace):
  - "every actual-service source revision assertion ran";
  - 8 actual-service assertions: r1 resolves; r2 supersedes before compile; current resolves to the same logical source; r1+r2 ambiguous; identical rebind does not restore latest; in-flight r3 refuses the post-dispatch recheck; historical bindings immutable and readable; provider deletion tombstones and refuses r4;
  - 6 SQL checks: 3 bindings retained; 1 tombstone; overlay denies every revision; historical ACL version-bound, not leaking to current or across workspaces.
- The `86c56f1` selected-revision timeout did **not** recur. Because this run succeeded, the new diagnostics captured nothing, so its cause stays **undiagnosed**: 2 of 4 hosted runs failed at the same first `inspect` call site, and the diagnostics will capture it if it recurs. No timeout was raised or masked, and no product change was made.
- Not covered by this run: browser intake/upload/compile, Google OAuth, production cookie/admission, R2, CDR/OCR.
- Still open: provider chronology (Dropbox current-rev check, Google monotonic version, Graph eTag), automatic latest-revision replacement on refresh (refresh refuses, it does not substitute), derived-cache revocation, and same-context API/MCP/CLI proof.
- Acceptance totals are not changed by this session; K02/K03 remain partial.
- Exact-head `ac1e0b2` CI at last query:
  - PR CI `36796618407`, PR DB rehearsal `36796618375`, CodeQL `36796618391` and malware-scan `36796618378`: success.
  - Manual DB/Auth `36796633995`: success.
  - Launch QA `36796618352`: **success** (terminal).
  - All six exact-head runs for `ac1e0b2` are terminal success: **batch qualified on hosted CI**, within the stated coverage limits.
- The prior `86c56f1` UI timeout remains **undiagnosed**; a successful retry is not a diagnosis.

## Next bounded slice: Dropbox still-current revision check (2026-10-01, local, in progress)

- Base: published `2cff277` (code qualified at `ac1e0b2`).
- Scope, K02/K03 (connector revision currency):
  - Dropbox `observeSourceVersion` currently returns `null`, so a stale or replayed listed `rev` can be bound after a newer one.
  - Add a still-current check before binding, using Dropbox's official `files/get_metadata`. A rev differing from current is refused, both before and after the pinned download.
- Keep unchanged:
  - `rev:` download pinning, id/rev/content_hash integrity checks.
  - ACL, tombstone and immutable-history invariants.
  - No rev chronology is inferred or compared; only equality with the provider's current rev is checked.
- Constraints:
  - Synthetic responses and official contract only; no OAuth credentials and no production calls.
  - Google monotonic/current selection is deferred to a separate assessment.
- Untouched: Core (private), cost controls, the local-only vendor cost report.

### Implementation (local, before publication)

- Inspected guard/import code:
  - `source-version-guard.ts` `observeSourceVersion` returned `null` for Dropbox.
  - `source-import.ts` ran only `verifyDropboxSource` for Dropbox. That check pins the `rev:` download and verifies `dropbox-api-result` id/rev/size/content_hash. There was no before/after currency read.
  - Listing (`listDropbox`) supplies `rev` and an `id:`; the download is `POST content.dropboxapi.com/2/files/download` with `{path:"rev:<rev>"}`.
- `lib/source-version-guard.ts`, new `observeDropboxVersion`:
  - Official `POST https://api.dropboxapi.com/2/files/get_metadata` with `{path:"id:…", include_deleted:false}`, through `safeFetch` (api origin, `/2/files/`, no redirects, 32 KiB, 8 s).
  - Requires `.tag:"file"`, the same `id`, a well-formed `rev`, `is_downloadable` not false, an integer `size` and a 64-hex `content_hash`.
  - The listed rev must **equal** the current rev, else `SOURCE_REVISION_MISMATCH`. Revs are never ordered.
  - A 409 `path/not_found` gives `SOURCE_REVISION_MISMATCH`. Any other 409 or non-200 gives `SOURCE_VERSION_READ_FAILED`. Malformed rows give `SOURCE_REVISION_UNQUALIFIED`.
  - A non-`id:` native id is refused before any request.
  - Observation `algorithm:"dropbox"`: `verifySourceVersion` checks bytes with the existing Dropbox block-hash (`dropboxContentHash`).
- `lib/source-import.ts`: Dropbox now runs the same pre-download observation and post-download re-observation plus `verifySourceVersion` as Google/Graph, **after** the unchanged `verifyDropboxSource`. Binding, intake and compute happen only after both pass.
- Unchanged:
  - `rev:` pinning and download egress policy.
  - Deterministic identity.
  - `recordConnectorDocumentBinding` immutability, ACL/tombstone checks, history.
  - Google/Graph paths.
  - No DB migration.
- Tests (synthetic responses shaped to the documented contracts; mocks, not live Dropbox):
  - `source-import.test.ts`:
    - binds when current before and after, asserting request order metadata → pinned download → metadata, the metadata body and `rev:` pin;
    - pinned result naming another rev is refused;
    - stale listed rev refused before download (one request, no download);
    - superseded during download refused;
    - deleted before/during download refused;
    - 503 and other path errors fail closed;
    - none of the refusals binds, reserves intake or reserves compute.
  - `source-version-guard.test.ts`: observation shape, hash binding to bytes, eight refusal shapes, non-`id:` refused with zero requests.
  - `connector-provider-isolation.test.ts`: Dropbox metadata only to `api.dropboxapi.com/2/files/get_metadata` with the Dropbox token.
- Local results (Windows 10, Node v22.14.0):
  - Focused: 4 files, 50 pass.
  - Related `lib/{connector,sync-worker,source,customer-source,google-drive,dropbox,collection,compile}*`: 59 files, 730 pass / 1 fail. The failure is the pre-existing `source-agent-runtime` Python `test_symlinks_not_collected` `WinError 1314`.
  - `tsc --noEmit`, ESLint (5 files), `pnpm check`, `pnpm scan:secrets`: pass/clean.
- Residuals:
  - A race remains between the post-download read and the binding write (no provider-side lock exists).
  - `recorded_at` is still commit order.
  - Google monotonic/current selection, Graph eTag reconciliation and latest-revision replacement remain open.
  - Live Dropbox not exercised.

### Published

- Commit `ee38efd6db42badf46de25b3aea4450403fb3de1` fast-forwarded `2cff277..ee38efd` to PR #141. The remote SHA was verified.
- Exact-head PR CI is being watched to terminal.
- No manual real-Auth dispatch: that journey does not exercise Dropbox import.
- `ee38efd` CI at last query: PR CI `36799683011` (Linux Vitest/check/build), CodeQL `36799682996`, DB rehearsal `36799683020` and malware-scan `36799682983` all success. Launch QA `36799683027` in progress.

### Follow-up defect found in `ee38efd` (local fix, uncommitted)

- **Defect: liveness.** Sync pages are stored snapshots per `(job, provider cursor)` (`connector-sync-page.ts`), and a retry reuses the stored page. `ee38efd` returns `SOURCE_REVISION_MISMATCH` for a Dropbox entry whose rev was superseded. That code is a retry outcome in `sync-worker.ts`, so a page containing a file edited after listing would be refused on every retry and the sync could never pass it.
- **Fix.**
  - Dropbox now returns a distinct `SOURCE_REVISION_SUPERSEDED` only when the provider affirmatively names a different current rev for the same `id:`, or answers `path/not_found`.
  - `sync-worker.ts` adds that code to the permanent skips: the item is skipped and counted, and the cursor advances. Nothing is bound.
  - The provider change feed reports the newer revision (or the deletion, which takes the existing tombstone path) after this page's cursor.
- **Kept as retry:** foreign id or folder, pinned-download rev mismatch, content-hash mismatch, and unreadable metadata stay `SOURCE_REVISION_MISMATCH` / `SOURCE_CONTENT_HASH_MISMATCH` / `SOURCE_VERSION_READ_FAILED`.
- **Google/Graph** are unchanged. They have the same stored-page liveness exposure for superseded revisions; it is recorded as open for the separate Google/Graph assessment.
- **Tests:** sync-worker "superseded is skipped and the cursor advances" plus "unexplained mismatch still retries"; updated Dropbox import/guard expectations.
- **Local results:** 4 files, 85 pass. `tsc` and ESLint pass.

## Next bounded slice (planned, 2026-10-01): concurrent binding currency (K02/K03)

- **Gap.** Provider currency checks around the download leave a window between the post-download read and the binding insert. If import A (rev1) passes its post-check, then rev2 appears and import B binds it, A's later insert gets a later `recorded_at`. rev1 then becomes "latest" for compile selection.
- **Design.** Optimistic compare-and-set on the per-source latest binding, ordered only by the database:
  - The import reads the source's latest binding id (`order=recorded_at.desc`) **before** its pre-download provider read.
  - A new RPC inserts only if, under a per-source transaction advisory lock, the latest binding is still that id. Otherwise it returns `contested` and nothing is written.
  - An already-recorded identical version is a replay and never moves latest.
  - `recorded_at` is `clock_timestamp()` taken after the lock, so DB order equals lock order.
  - The tombstone/connection triggers still apply.
- No provider timestamps or rev ordering are used.
- **Qualification.** Unit tests; migration via the DB rehearsal workflow; actual-service assertions added to the existing `local-source-revision.integration.test.ts` run by the hosted real-Auth job.

## Side task: vendor compute cost check (2026-10-01, redacted)

- A bounded, read-only check of the GPU vendor account was done after the qualification passed, using only the already-authorized connector.
- No credentials were printed, and nothing was changed, stopped, deleted or funded.
- Raw inventory, billing amounts and resource IDs are kept in a local untracked file only and are intentionally not recorded here.
- Recent spend traced to a single burst on the GPU OCR serverless path. No ongoing charge was evidenced at read time. The callers of that path are unknown.
- Candidates were noted locally but none was applied, and endpoint deletion is not authorized. A lower OCR worker maximum would only bound concurrency; it guarantees neither a proportional cost reduction nor unchanged behavior for callers. No saving or data-safety claim is made without caller/reference checks.
