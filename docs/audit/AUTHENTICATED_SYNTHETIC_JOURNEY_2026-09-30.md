# Authenticated synthetic customer journey checkpoint

This is application integration evidence, not a completed customer E2E or release gate.

## Ownership and base

- Fresh isolated clone: `C:\Users\yspow\Documents\Codex\2026-09-30\task-2\customer-journey`.
- Local branch: `codex/customer-journey-local`.
- Fetched base: `a0c4fa9302d8d050a9936c060631002184e6055d`, from `origin/codex/masterplan-checkpoint-2026-09-30`.
- Read `MASTERPLAN_IMPLEMENTATION_2026-09-30.md` and the Ultimate Blueprint implementation ledger. No `AGENTS.md` files were present in this clone. Next.js skill applied.
- Authenticated backend scope only. The public UI integration clone and dirty user repositories were untouched. No push, merge, deployment, production mutation, customer data, paid model call, OAuth grant, or deployment credential was used.

## Actual defects corrected

1. Rollback previously moved the active pointer without inspecting the historical candidate's current source access. It now reads the exact workspace/collection/manifest, validates the artifact and evidence, resolves product source IDs through the existing Core/product binding, and checks current source access before calling the transition RPC. Missing storage, unreadable artifact and unreadable policy refuse. Historical bytes can be restored; historical permissions cannot.
2. Rollback now rechecks the browser principal, workspace, owner/admin role and product entitlement after storage/policy reads. An expired or switched session and a revoked entitlement cannot use the earlier decision.
3. Review previously loaded the preferred candidate from a listing and compared it with the submitted digest. With two revisions present and the old object listed first, the new revision was impossible to review. Review now loads the exact digest the reviewer inspected. Existing manifest mismatch and immutable correction provenance checks remain.
4. Promotion now refuses an artifact with no readable evidence even when all package hashes and passed statuses are valid. The same evidence requirement applies to restoration. Both new refusal codes have a meaning/remediation in the developer catalogue, and the catalogue scanner includes the rollback guard.

## Executed synthetic path

`nextjs/lib/synthetic-customer-journey.test.ts` executes production review, promotion, ask and rollback handlers, the actual collection/read-model/grounding code and the actual operation cache. A loopback HTTP adapter serves the ask handler to the shipped `public/developer/tavonel-mcp.mjs` and `tavonel-cli.mjs`, including a real CLI child process.

The fixture exercises:

- Unpublished ask refusal; explicit evidence review; manual first publication.
- Identical API/MCP/CLI answer, manifest, revision, citation, source version, page and bounding box for the same principal.
- Two revisions of the same production logical collection identity. The older storage key remains first, so the review regression is observable. A new candidate leaves ask on the earlier active version until manual publication.
- After publication, all three consumers read the new source version and changed payment terms.
- Source revocation refuses all three consumers and refuses historical restoration. After current policy allows it again, restoration returns the earlier answer/citations at a new pointer revision and preserves the newer immutable candidate.
- Signed ZIP construction for both versions, every exported file's digest/length, actual Ed25519 signature verification and tamper refusal. Signing keys exist only in test memory; the download route and production trust configuration are not qualified by this check.
- Lost answer response replay uses the real operation cache and performs no new retrieval. A cached answer is refused after revocation.
- Source-store failure returns 503, then a retry succeeds without a poisoned cache. Permission changing during retrieval prevents answer release.

`world-rollback-source-access.test.ts` separately covers storage/configuration failures, malformed/foreign/review-required/fallback artifacts, current ACL failure, expired/switched sessions, workspace/role/entitlement changes, lost transition response replay, revocation on replay and concurrent-pointer conflict propagation.

## Boundary of the evidence

Authentication and membership services, R2 transport, transition SQL, connector-policy persistence and Core/model services are disposable doubles. The synthetic Core boundary uses locally materialized deterministic package bytes rebound to the production collection identity with recalculated file hashes; it is explicitly not output from the Python engine. Ask reports `excerpt-concatenation-fallback` and a missing retrieval index. No embedding or full hybrid-retrieval quality is implied.

Input fixtures begin at anchored OCR/compile input. The actual upload capability, CDR, OCR process, durable worker, reservation/settlement and database transaction are not connected end-to-end by this suite. Focused existing tests exercise those neighboring contracts independently. Docker, psql and Supabase CLI were not exposed on PATH in this environment. No SQL execution is claimed.

The existing SQL transaction still owns CAS, idempotency, membership checks and source-deletion activation guards. These tests propagate its conflict/replay receipts through the application but do not establish actual concurrent SQL behavior. Connector suspension racing the last route-level permission check still needs transaction-level qualification. This change does not weaken the current consumer rechecks.

## Requirement reconciliation

| Requirement | Verified in this lane | Remaining condition / status |
|---|---|---|
| K07 / UX11 / UX13 | Application lost-response replay, stale-pointer error, interrupted authorization and exact-version restoration | Partial: actual concurrent SQL/crash/charge invariants and complete durable execution |
| K09 / K21 / UX16 | Current source ACL blocks consumer answers, cached answers and historical restore | Partial: real persistence, deletion/export/history/cache/backup coverage and concurrent ACL qualification |
| K10 / G1 | Synthetic anchored-input through review/publish/revision/restore and three consumer transport surfaces | Partial: real upload/CDR/OCR/Core/SQL/signed-download chain, then separately authorized customer path |
| K19 / UX14 | Shipped API/MCP/CLI return identical principal/snapshot/evidence on actual application ask handler | Partial: compiled hybrid pipeline, deployed authentication, installation/upgrade and real context-packet acceptance |
| UX12 | Exact revision evidence review; evidence-free publication refusal | Partial: representative correction workflows, all object evidence paths, rejection-resolution and user acceptance |
| K02 / K04 / K06 / UX18 / G2 | Synthetic stable collection identity and two-version application consumption | Partial: actual connector revision lineage, Core incremental parent/full-rebuild oracle and watcher reconciliation |
| G3 | Application failure/replay/ACL boundaries | Not accepted: actual concurrency, recovery, costs and operational evidence |

No complete K/UX/G requirement is newly closed by this lane, and no completion percentage is asserted.

## Verification

- Focused regression: 24 files / 312 tests passed, 0 failed, 0 skipped; `--maxWorkers=2`.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm exec eslint app components lib`: passed.
- First full restricted-sandbox aggregate: 403 files; 5858 passed / 4 failed. One failure exposed the missing new error-catalogue entry, which was corrected. The other three failed while creating existing Windows symlink fixtures, not while exercising product assertions.
- All three failing files rerun with the normal Windows token: 16 passed, 0 failed. The nested no-network Python source-agent suite passed all 23 tests, including real temporary symlinks. No assertion was skipped or relaxed.
- Final frozen-source hermetic Next.js Vitest aggregate: **403 files / 5862 tests passed**, 0 failed, 0 skipped; 2 workers with the normal Windows token. This is a separate final run, not a sum of reruns. Command: `node scripts/run-hermetic-vitest.mjs --maxWorkers=2 --silent --reporter=json --outputFile=C:/Users/yspow/Documents/Codex/2026-09-30/task-2/customer-journey-vitest.json`.
- Machine-readable report outside the clone: `C:\Users\yspow\Documents\Codex\2026-09-30\task-2\customer-journey-vitest.json`; SHA-256 `484fae23a35f0f64b0f532927ca92815eed22c77f5d6b137ddec768a4d6c31ae`. JSON `numTotalTestSuites` includes nested describe suites; the file count is `testResults.length`, 403.
- Full repository `pnpm check` passed: canonical brand assets, stylesheet type floor, TypeScript and ESLint. No thresholds or assertions were relaxed.
- Browser acceptance: not run in this backend lane. Parent public ProductQA results remain separate.

## Remaining critical path

First connect disposable authenticated upload/CDR/OCR, real local Core and actual PostgreSQL transition/ACL services; then run the same two revisions with a genuine parent snapshot, full-rebuild oracle, signed download and compiled retrieval pipeline. Follow with duplicate/concurrent publication, suspension/deletion during transition, crash/resume and reservation/settlement checks. Authenticated browser interactions must use those same services rather than only UI selectors.

Planning estimate: 2–5 focused engineering days for the next disposable vertical qualification if local Core/database dependencies are available, low confidence until connected. This is not an estimate for the entire masterplan. The larger 6–12 week offline estimate in the masterplan remains unvalidated; customer/provider/release gates still require their exact external inputs.

Sequential integration should fetch this local branch from the isolated clone and cherry-pick its commit onto the integration branch after the integration owner freezes its own source. Do not merge or deploy based on these tests.
