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
