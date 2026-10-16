# Intake approval budget and retry contract

Status: held local candidate against PR #141 source head `5347af4d5f76ba971927105b0a3d5cf20e13224e`. No deploy, push, merge, live database, price change, billing-plan change, credentials, or paid provider calls were made.

## Design decision

A complete browser-selected file set receives one durable approval parent and one immutable child per file. The customer sees and approves the server-recomputed aggregate maximum before bytes move. Measured and declared page counts stay explicitly different; every unknown file is budgeted at the existing 80-page processing ceiling. A pricing fingerprint, set digest, per-file content digest/length/MIME, stable source idempotency key, and authenticated workspace/principal bind the attempt. The approval is the ceiling passed to the existing paid/trial/owner reservation lifecycle; the added database guard refuses per-file or aggregate overrun instead of widening the maximum.

The browser stores only attempt metadata and content digests. It retries capability/PUT/confirm under the same attempt and deterministic document identity, looks up server state after ambiguous replies, requires exact file reselection after reload, and compiles only when the server says every approved member is confirmed. One failed or uncertain member blocks the dependent set.

No price constants, credit prices, billing plans, or source-agent replay SQL were changed. Connector/recurring sync and cloud-scanner budgets remain outside this direct browser intake patch.

## Scope

- New additive migration `supabase/migrations/20261003120000_intake_approval_budget_invariants.sql` with approval/file tables, immutable rows, approval-bound reservation guard, and RPCs for create/read/reserve/confirm/cancel/settle.
- New approval create/read route, approval-bound capability/confirm/release routes, shared quote/fingerprint code and browser attempt helper.
- Workspace preflight now quotes the complete selection, explicitly includes unknowns, binds the user click to approval, and blocks reduced-set compilation.
- Failed or uncertain set members block compilation. A definite member failure cancels the approval and releases every safely releasable reserved sibling through the existing settlement path. Settled accounting is preserved, and operator-review or indeterminate reservations remain visible with reconciliation required; an ambiguous cancel is reconciled by reading server state.
- Base admission confirmation and approval confirmation now run in one database transaction. Cancellation is serialized with confirmation and duplicate retries. A canceled or expired approval rotates to a fresh attempt key after the same files are selected again.
- Both compile-job and direct collection-compile routes enforce the same server compile-set check. It verifies complete membership, confirmed intake, live reservations, authenticated workspace/principal, and the current pricing fingerprint.
- SQL pgTAP contract file and a two-session concurrency/race rehearsal. Client helper/quote tests were added.

The migration is additive and held. It has not been applied to production or any shared environment. The complete candidate must be applied as one release unit; do not deploy a partial stack.

## Verification evidence

- The source snapshot was checked against the authenticated PR-head blob manifest: 1,866 files / 61,780,482 bytes, no blob mismatch; source head is the PR #141 head above. The candidate Git root is a local synthetic snapshot commit and is not the target commit.
- Disposable PostgreSQL 17 only: the existing migration chain reached a pre-existing ordering failure at `20260920133000_founder_test_reset.sql` because `foundation_world_transition_receipts` had not been created. For the limited local rehearsal, the repository migration through `202609201321` was applied with a local-only vector stand-in; the exact new migration then applied successfully.
- The SQL contract executed against disposable PostgreSQL 17.2 using the existing disposable schema and prior candidate migration, with the updated cancellation RPC loaded, plus a local pgTAP-compatible assertion shim (official pgTAP and Supabase CLI/Docker are absent): 154 assertions passed and the test transaction rolled back. The new cancellation assertions exercised a two-member settled+reserved set and a three-member settled+reserved+operator_review set, including deliberate transaction rollback, balance deltas, preserved settled/review states, safe sibling release, repeat cancellation, and blocked compile. A follow-up query confirmed the fixture transaction rolled back. The shim differs from official pgTAP, and this is not a clean full-chain migration run.
- A separate two-session PostgreSQL rehearsal passed concurrent duplicate approval/reservation and both confirm/cancel race orders. Duplicate callers returned the same approval and two reservation IDs; the cancellation race released both active holds exactly once, and final balance returned to 2,000. This committed fixture remains only in the local disposable database.
- Node 22.14.0 executed all eight `intake-approval.test.ts` cases and all 29 `usage-pricing.test.ts` cases through a small local assertion adapter because Vitest is unavailable. These execute the actual helper/pricing code for same-key capability retry, lost PUT and confirm recovery, uncertain blocking, changed reselection, cancellation recovery, stale quote refusal, known/stale declared/unknown/mixed selection quotes, and server call-site contracts; this is not a substitute for Vitest or a browser run.
- Vitest and the project typecheck are blocked: repository `node_modules` were absent and `pnpm install --offline --frozen-lockfile` could not complete because `@supabase/supabase-js@2.112.4` is missing from the local package store. No online install was attempted. The authored client test cases did run through the Node assertion adapter above, but that cannot substitute for Vitest or the project typecheck.
- No full clean-database migration rehearsal was possible because the pre-existing migration ordering failure above blocks a normal replay. The locally stubbed vector type is not a production-compatible vector extension.

## Claude authorship and fallback

The first-party Claude Max launcher was used with scoped permissions and no API key. SQL phase run 04 completed with exit 0 (14 turns, about 20m55s). Browser authoring run 05 ended `error_max_turns` / exit 1 after partial helper edits; route authoring run 06 ended in process/API errors / exit 1 after creating the approval route; run 07 failed before tool use / exit 1. Run metadata and redacted evidence remain under `evidence/claude-run-04` through `evidence/claude-run-07`. Codex then completed the route/page wiring and code review. Do not describe the complete patch as Claude-authored.

Run 08 used the same first-party launcher for one test-only correction: `claude-opus-5-5`, high effort, four-turn cap, Read/Edit-only tools, restricted mode. It completed successfully in 32.1 seconds, exit 0, process 116576, Claude session `90fde039-76df-49f1-a7f8-6a88ad6bd6ea`, with zero permission denials, tool errors, or stderr lines. It updated the pricing test to assert that the approved capability uses the approved quote while the unapproved source-import path uses the generic deployment ceiling. The first wrapper attempt failed before Claude startup because a nested Windows PowerShell path was absent; retrying the guarded launcher directly succeeded. Evidence is under `evidence/claude-run-08`.

## Remaining limitations

1. Project typecheck, lint, and Vitest remain unexecuted because the frozen-lockfile dependency import exhausted available C: space and the local package cache lacks `@supabase/supabase-js@2.112.4`. No further install was attempted. Run them in a properly provisioned isolated environment before merge.
2. The normal migration chain has a baseline ordering defect preceding this migration. Resolve or work around that in a separately reviewed test harness before claiming a clean full-chain replay.
3. Unknown formats are deliberately priced at 80 pages per member. The held direct-upload contract does not implement source-connector recurring-sync or cloud-scanner budget approvals.
4. Confirm requires the existing confirmed intake admission and unchanged server-derived principal. The source-agent replay shortcut remains unchanged and its existing `replay=true` / `confirmed_at` guard was not modified.


Run 09 was requested for the bounded cancellation delta using claude-opus-5-5, high effort, the first-party guarded launcher, and Read/Edit-only restricted tools. It ended after 277.7 seconds with exit 1 and rror_max_turns (7 turns), without permission denials or tool errors. The event stream and summary are preserved under vidence/claude-run-09; Codex completed the narrow delta after inspecting the partial edits. No Claude process was restarted.
