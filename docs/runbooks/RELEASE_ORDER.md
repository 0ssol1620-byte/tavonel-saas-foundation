# Release order: migrations first, then deploy

**Scope.** Every release that carries a file under `supabase/migrations/`. Written on 2026-09-11
for the four migrations of that day's release, but the rule is not specific to them.

## The rule

1. **Apply the release's migrations to production Supabase.**
2. **Then** merge to `main` / let Vercel deploy the application.

Never the other way round, and never both at once on the assumption that one will win.

## Why the order is not a preference

A merge to `main` deploys the application automatically (Vercel). Nothing applies a production
migration automatically — there is **no production-migration job in CI**; `db-rehearsal.yml`
applies the files to a throwaway Postgres on a runner and is deliberately unable to reach the
live project. So the two halves of a release move on different clocks, and only one of them is
automatic. The order has to be held by a person.

The blast radius is not one feature. `20260911120200_compile_job_candidate_manifest_digest.sql`
adds a ninth parameter to `advance_foundation_compile_job`, and the worker calls that function on
every state change of every compile. A deploy that lands before the migration makes every advance
answer `PGRST202` — which stalls **the whole compile queue**, for every tenant, not one document.

## What holds each direction

Both directions are defended in code, and neither defence is a reason to skip the order.

- **Migration first, deploy later** (the correct order): the ninth parameter is declared
  `default null`, so the worker that is still sending eight arguments keeps working between the
  two steps. `supabase/tests/foundation_compile_candidate_digest.sql` asserts that the
  eight-argument call still resolves after the migration.
- **Deploy first, migration later** (the mistake): `lib/compile-job-worker.ts` retries once
  without the digest argument and logs at error level with the stable message
  `candidate_manifest_digest not recorded: migration 20260911120200 not applied`. The queue keeps
  moving and the gap is loud. `candidateAwaitingActivation` reads conservatively from the digest,
  so a compile that finishes inside that window records none — grep for that message after any
  release and apply the migration.

The fallback is a seatbelt, not permission to drive at the wall.

## The 2026-09-11 release, in order

| # | migration | what it changes |
|---|---|---|
| 1 | `20260911120000_compute_settlement_expired_terminal` | settlement refuses an expired reservation |
| 2 | `20260911120100_oauth_reauthorization_audit_action` | a new audit action value |
| 3 | `20260911120200_compile_job_candidate_manifest_digest` | the ninth parameter above — the one with the queue-wide blast radius |
| 4 | `20260911130000_included_page_expiry_at_renewal` | expires the previous month's remainder at the next grant |

Filename order is apply order. Migration 4 is a customer-visible balance change on each account's
first renewal after it lands — see the release's open risks before applying it, not after.

## After applying

- Confirm the four versions are in `supabase_migrations.schema_migrations`.
- Deploy.
- Grep the application logs for `migration 20260911120200 not applied`. A hit means the order was
  reversed somewhere; the fix is to apply the migration, not to restart the worker.

## Every deploy under gate v2: a release decision for the exact SHA

**Applies when** production runs `TAVONEL_CUSTOMER_DATA_GATE_VERSION=v2`. Under v1 (or unset) the
per-workspace v1 receipt governs and this section has nothing to check. The production value was
not read when this section was written (2026-10-17).

### Why every deploy

- v2 binds each release decision and each workspace grant to `VERCEL_GIT_COMMIT_SHA`
  (`nextjs/lib/customer-data-admission.ts`). The policy says so in as many words: "A deployment or
  rollback without those matching receipts deliberately refuses new processing"
  (`docs/audit/SCOPED_CUSTOMER_DATA_LAUNCH_POLICY_2026-09-29.md`, "Deployment lifecycle"). A merge
  to `main` deploys a new SHA; nothing records that SHA's decision automatically. A rollback
  deploys an older SHA, which needs its own current decision as well.
- Until the deployed SHA has a production decision for `direct_upload`, production checkout
  answers `CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE`. A qualification decision is not a release:
  checkout answers `PROCESSING_QUALIFICATION_NOT_BILLABLE` (`nextjs/app/api/billing/checkout/route.ts`).
- The gate-enforcement sweeper (`/api/internal/billing/gate-enforce`, every 15 minutes per
  `nextjs/vercel.json`) pauses a paid subscription at Paddle once its next charge is within
  48 hours and the gate does not admit the workspace (`NEAR_BILLING_WINDOW_MS`,
  `nextjs/lib/billing-gate-enforcement.ts`). A late decision therefore pauses renewals, and
  resuming is the customer's own act.
- A decision is valid for at most 30 days from its `evaluated_at` (`shared/scopedCustomerDataGate.ts`).
  A SHA that stays deployed longer needs a new decision before then.

### Order

1. Apply the release's migrations (above).
2. Deploy.
3. Record the production release decision for the deployed SHA. **Founder act.**
4. Run the check below. Exit 0 before relying on file processing or checkout on that SHA.

Who records the decision, with what tooling, how soon after a deploy, and whether a deploy may
serve before it is recorded, is founder decision D-15 (journey map FD-04). This repository has no
recorder. The check below records, renews and refuses nothing. Evidence must be real: no
precondition is recorded as `satisfied: true` to make the check pass (launch policy, "Bounded
processing cohort").

### The check (read-only)

```sh
cd nextjs
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
  pnpm release:gate-check --sha <deployed 40-hex SHA> [--scope connector] [--warn-days 7]
```

- `--sha` is the Git commit of the production deployment (Vercel deployment details), not the
  `HEAD` of a local checkout.
- One GET per scope against `customer_data_release_decisions`, with the gate's own select, order
  and limit; the row is re-verified with the gate's own `verifyStoredRelease`. No POST, PATCH or
  RPC is sent (`nextjs/scripts/release-gate-check.test.mjs` counts them). The report carries no
  evidence text, operator or reason.
- The default scope is `direct_upload`, the self-serve path. Add `--scope connector` only when
  connectors are part of the release. `--warn-days` (default 7, 0–30) sets the expiry warning.

| exit | meaning | next step |
|---|---|---|
| 0 | every requested scope is released for this SHA and none expires within the window | none |
| 1 | `missingScopes` or `expiringScopes` is not empty | read each scope's `status` below |
| 2 | the check could not run (arguments, credentials, store); no report is printed | fix and run again; never read it as "missing" |

| `status` | meaning |
|---|---|
| `released` | a verified production decision for this SHA; `expiresAt` and `remainingHours` say when it lapses |
| `expiring` | released, but `remainingHours` falls within `--warn-days`; record a new decision before it lapses |
| `missing` | no row for this scope and SHA; `requiredFacts` lists the 12 (direct upload) or 17 (connector) facts a decision needs, `founder_approval_receipt_recorded` among them |
| `refused` | the latest row is `allowed = false`; `missingFacts` names the unmet facts. A refusal stands until a later decision |
| `invalid` | the latest row does not verify (schema, stage, digest or timestamps). The ledger is insert-only: record a new decision, never edit the row |
| `expired` | the latest row is older than 30 days |
| `qualification_only` | a bounded qualification for one operator workspace (`workspaceKey`, `expiresAt`), never a release for anyone else |
