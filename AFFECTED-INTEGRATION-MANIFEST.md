# Affected integration manifest (PR 141)

Incremental affected-group map from the verified baseline to the PR head. The current, separately prepared checkpoint contains 39 paths: 22 product/code-test paths, 15 CI/verification paths, and 2 SQL compatibility fixture paths. It therefore includes product, code-test, SQL, and CI changes; it is not CI-only. The authoring task that produced this artifact edited only this one manifest file. This manifest does not claim that the checkpoint has been published.

- Baseline commit: `5dd95ed815719656fe09f1af10213a9ecf1119a8`
- Baseline tree: `c0773387cfffdd334076c66a1f2013a6662c6578`
- Historical inputs only: Repair run `37696210200` / job `113048455173`; DB classifier run `37696210339` / job `113048455870`; Native run `37696210268`, attempt 1. Seven Linux DB case jobs: `113048455419`, `113048455432`, `113048455206`, `113048455530`, `113048455630`, `113048455555`, `113048455415`; aggregate job `113049715999` succeeded.
- These historical receipts are bound to the baseline head/tree and dependency hash inventory. They are not full-release qualification or current-head native evidence. Details are recorded in `evidence.json` and `historical-native-artifacts/`.

## Planner and gate

`nextjs/scripts/repair-scope.mjs` reads the raw baseline-to-head diff. Both rename endpoints must map to a declared owner. Unsupported statuses, unsafe path spelling, non-regular modes, unmapped endpoints, missing selected suites, and stale/unavailable baseline evidence fail closed.

Affected admission checks that `HEAD` equals the requested head, rejects staged index drift (including index-only drift whose worktree bytes still match `HEAD`), reuses the byte-qualified tracked-checkout guard, and rejects untracked paths. If the exact verified baseline is missing, mismatched, or unreadable, the PR 141 lane becomes unavailable instead of falling through to broad Repair/DB work. At final gate, only the gate owner's regular, non-symlink `nextjs/repair-plan.json` may exist as an exception, and its bytes must equal the independently recomputed current-head plan. A preexisting `nextjs/repair-receipt.json` (file or link) is never exempted. The gate refuses these cases at import, before it reads plan flags or writes a receipt.

The cumulative PR/full-release selection remains separate debt. It is not replaced by the incremental map; `pendingFullDebt` stays intact.

## Owners

The full planned integration contains 43 paths: 26 reviewed product paths, 15 CI-owner paths, and 2 SQL compatibility fixtures. The map regressions use these 43 paths as their integrated input. Those 43-path test arrays are unchanged. They are a synthetic scenario that validates the full planned 26 + 15 + 2 mapping. They do not mean that the actual proposed publication head contains 43 paths. The tests, the production owner map, and the gate are unchanged. This describes regression input, not a current test execution (see Verification status). The planned scenario covers these exact product paths:

`nextjs/lib/intake-triage.test.ts`; `nextjs/lib/acl-refresh-core.test.mjs`; `nextjs/lib/ask-route-limits.test.ts`; `supabase/tests/google_viewer_principal_boundary.sql`; `nextjs/lib/billing-product-access.ts`; `nextjs/lib/billing-product-access.test.ts`; `README.md`; `nextjs/lib/docs-content.ts`; `nextjs/lib/docs-content.test.ts`; `nextjs/app/docs/[section]/page.tsx`; `nextjs/components/world-studio-ultimate.tsx`; `nextjs/components/world-studio-ultimate.module.css`; `nextjs/app/workspace/page.tsx`; `nextjs/e2e/world-lifecycle.spec.ts`; `quarantine-sidecar/foundation-cdr-worker/src/sanitize.ts`; `quarantine-sidecar/foundation-cdr-worker/src/sanitize.test.ts`; `nextjs/lib/connector-oauth-adapters.ts`; `nextjs/lib/connector-oauth-adapters.test.ts`; `nextjs/lib/connector-sync-page.ts`; `nextjs/lib/connector-sync-page.test.ts`; `nextjs/lib/sync-worker.ts`; `nextjs/lib/sync-worker.test.ts`; `nextjs/lib/dropbox-source-reconciliation.ts`; `nextjs/lib/dropbox-source-reconciliation.test.ts`; `supabase/migrations/20261007100000_dropbox_source_path_reconciliation.sql`; `supabase/tests/dropbox_source_reconciliation.sql`.

The current 39-path checkpoint contains 22 of those 26 product paths, the 15 CI-owner paths below, and the 2 SQL compatibility fixtures below. Its 22 product/code-test paths are the 26 planned product paths minus the 4 deferred paths:

`nextjs/lib/intake-triage.test.ts`; `nextjs/lib/acl-refresh-core.test.mjs`; `nextjs/lib/ask-route-limits.test.ts`; `supabase/tests/google_viewer_principal_boundary.sql`; `nextjs/lib/billing-product-access.ts`; `nextjs/lib/billing-product-access.test.ts`; `nextjs/components/world-studio-ultimate.tsx`; `nextjs/components/world-studio-ultimate.module.css`; `nextjs/app/workspace/page.tsx`; `nextjs/e2e/world-lifecycle.spec.ts`; `quarantine-sidecar/foundation-cdr-worker/src/sanitize.ts`; `quarantine-sidecar/foundation-cdr-worker/src/sanitize.test.ts`; `nextjs/lib/connector-oauth-adapters.ts`; `nextjs/lib/connector-oauth-adapters.test.ts`; `nextjs/lib/connector-sync-page.ts`; `nextjs/lib/connector-sync-page.test.ts`; `nextjs/lib/sync-worker.ts`; `nextjs/lib/sync-worker.test.ts`; `nextjs/lib/dropbox-source-reconciliation.ts`; `nextjs/lib/dropbox-source-reconciliation.test.ts`; `supabase/migrations/20261007100000_dropbox_source_path_reconciliation.sql`; `supabase/tests/dropbox_source_reconciliation.sql`.

### Deferred paths

These 4 paths are deferred. They are byte-identical to baseline `5dd95ed815719656fe09f1af10213a9ecf1119a8` and await direct public approval:

- `README.md`
- `nextjs/app/docs/[section]/page.tsx`
- `nextjs/lib/docs-content.ts`
- `nextjs/lib/docs-content.test.ts`

The byte identity was confirmed by the parent's independent review. This authoring task did not open these files. Their content is excluded from the current checkpoint and from this manifest. There is no workaround publication of their content through any other path or artifact.

The 15 CI-owner paths are the three workflows `repair-scope.yml`, `db-rehearsal.yml`, and `native-world-race.yml`; this manifest; `repair-scope.mjs` and its test; `repair-collector-only.mjs` and its test; `repair-scope-gate.mjs`; `run-repair-check.mjs`; `verify-repair-workflows.mjs`; and `db/native-world-race-ci.mjs`/test plus `db/dropbox-source-stream-race.mjs`/test. `repair-known-regression.mjs` is unchanged. The manifest maps to repository docs; the other 14 map to the CI selector owner.

The 2 SQL compatibility fixtures are `supabase/tests/connector_checkpoints.sql` and `supabase/tests/connector_sync_page_snapshots.sql`. They are neither product owners nor CI owners: the unchanged map already treats them as database-contract paths and as Dropbox SQL dependency fixtures (see Affected database lane). Both test files keep them in a separate frozen `AFFECTED_SQL_FIXTURE_PATHS` list that is spread into the integrated regression arrays, so the 26 product and 15 CI-owner lists are not relabeled. This artifact is a one-file patch to this manifest only. It is written against the preserved 43-path manifest preimage and is used in the separately prepared 39-path checkpoint. The SQL fixture source bytes are not part of this manifest patch. The original 43-path planned scenario and the previous archives, including the independently preserved SQL fixture ZIP, remain preserved and unchanged.

Selected checks for the current 39-path checkpoint remain scoped: intake suites and intake browser checks; ACL Node/route tests plus the 24-case SQL fixture contract; billing access/entitlement/world activation tests; workspace lifecycle browser on desktop/mobile/reduced motion plus the named world-model suites; OCR worker units and TypeScript check; Dropbox reconciliation/OAuth/sync/page/provider/source identity/checkpoint/replay consumers. Docs unit tests and docs browser layout checks are not selected checks for the current checkpoint; the 4 deferred paths are not in it. The seven selected SQL fixtures are `google_viewer_principal_boundary.sql`, `dropbox_source_reconciliation.sql`, `connector_checkpoints.sql`, `connector_sync_page_snapshots.sql`, `foundation_jobs.sql`, `connector_document_bindings.sql`, and `connector_source_suspensions.sql`. A fresh seven-case Native run is required (see Native evidence). These are selection requirements, not results: none of them has run for the current checkpoint. Existing frozen install, secret scan, global type/lint, direct browser build, and normal report gates remain in place; no full Vitest prehook or package-script expansion was added.

## Affected database lane

The classifier exposes database test paths from the same owner map. The affected DB lane checks out the exact PR head and independently recomputes the map before using those paths. Whenever the lane is required, an affected Dropbox owner also selects the existing SQL contracts it executes against, each with a recorded reason in `databaseDependencyReasons`: `connector_checkpoints.sql`, `connector_sync_page_snapshots.sql`, `foundation_jobs.sql`, `connector_document_bindings.sql` (source-import binding), and `connector_source_suspensions.sql` (sync-worker suspension). A Dropbox owner change without SQL does not start the lane. Every selected fixture must exist at the head, or the map fails closed. The lane stages the ACL draft only when the ACL fixture is selected, applies the full current migration chain once to a fresh disposable Postgres 17 database, then runs only the selected ACL, Dropbox, and dependency pgTAP fixtures. It does not run the unrelated full pgTAP set, Auth journey, or signed-storage transport for affected heads. The create-once Dropbox migration is not replayed.

When the Dropbox fixture is selected, a bounded two-session harness creates/resumes the canonical job inside session A's open transaction, starts the generic insert in session B, verifies `pg_blocking_pids` names A's exact PID, then lets the parent commit A. It requires the expected conflict, one surviving canonical job, bounded child termination, and verified synthetic-row cleanup. Connection overrides and non-PostgreSQL URL schemes are rejected. No DB was executed from this implementation environment.

## Native evidence

For the current 39-path checkpoint, the baseline-to-head delta contains migration, CI, fixture, and harness changes, so the required native job is a fresh seven-case run. The current checkpoint has not run those cases. Do not interpret historical run `37696210268` as a current-head pass.

Because the fixed baseline is `5dd95ed…`, later docs/UI commits that still include this integrated delta in their baseline-to-head plan will continue to require fresh native cases. This manifest makes no promise that later docs-only commits can skip them. Any future reuse optimization needs a validated evidence checkpoint updated after this integration run succeeds; no new checkpoint or parent-specific profile is introduced here.

## Workflow byte identity

Workflow files have CRLF checkout bytes while Git stores normalized LF blobs. `evidence.json` records both hashes for each of the three modified YAML files. The patch is generated from Git blobs with byte-safe output, and the final indexed blobs are checked against the recorded blob IDs and SHA-256 values. Product file bytes and line endings are not normalized by this task.

## Verification status

The earlier candidate recorded 7/7 focused affected-map tests, 5/5 Dropbox harness tests, and a passing `verify-repair-workflows.mjs`. The follow-up corrections changed these owners: the default-wait PID handoff, index-only drift, owner-only plan exemption and receipt refusal, Dropbox SQL dependency selection, and the materialized real-Git fixture. The collector test file cannot initialize in this archive because historical Git source objects required by its legacy fixture are absent. For that reason, `repair-scope.test.mjs` carries equivalent `affected` real-Git contracts that load no legacy fixture:

- the integrated map (written for 41 paths at the time; now 43, see below), a real deletion and the missing Dropbox suite, both rename endpoints, and a real index-only mutation;
- the plan→gate API: the byte-equal regular owner plan is accepted, and plan mismatch, plan link, non-owner, receipt file and receipt link are refused;
- the gate CLI refusals at import.

The cumulative 6401-anchor selection is absent from the shallow archive, so the API case injects it. The gate CLI never does (static gate), and its regular-plan path closes as unavailable here. In the correction environment only `node --check` ran, on eight CI-owner scripts (not `run-repair-check.mjs` or the two native race CI scripts). The focused Node tests and the workflow verifier were not permitted to execute, so no pass is claimed for them. No database execution, hosted CI, full suite, current-head Native run, full release qualification, or Launch run is claimed. That limitation is kept explicit in `evidence.json`.

All of the results above are historical. They predate the 43-path regression input and do not show that any 43-path test passed. Results bound to baseline `5dd95ed…`, including the run and job IDs at the top of this manifest, are historical evidence only. They are not evidence for the current 39-path checkpoint. Execution for the current checkpoint is pending: UNRUN. Cumulative full-release qualification and its debt (`pendingFullDebt`) remain open. The existing planner, gate, and qualification safety contracts are unchanged.

UNRUN, earlier follow-up (preserved in the previous archives; not this artifact): a three-file, source-only patch to `repair-scope.test.mjs`, `repair-collector-only.test.mjs`, and this manifest. It adds the 2 SQL compatibility fixtures to the synthetic integrated-map regression and to both real-Git integrated fixtures, and updates the 41 counts and titles to 43. The unknown, rename, delete, missing-suite, index-only, plan-owner, and cleanliness assertions are unchanged. The missing-dependency case still has no change record for the absent fixture. No Node test, syntax check, workflow verifier, or database ran for this follow-up. Two expectations are inferred from static reading rather than observed: that `databaseDependencyReasons` keeps both fixtures as dependency keys when they are also changed paths, and that `databaseTests` still lists exactly seven fixtures. `repair-scope.mjs` and the owner map are unchanged.

UNRUN, current artifact: a one-file patch to this manifest, written against the preserved 43-path manifest preimage, for use in the separately prepared 39-path checkpoint. It changes no source, test, workflow, map, gate, or SQL file. No Node test, syntax check, workflow verifier, database, hosted CI, or Native run was executed for it, and no pass is claimed for the current checkpoint.
