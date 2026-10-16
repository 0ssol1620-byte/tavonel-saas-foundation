# Intake approval migrations: manual production apply

**Scope.** The four migrations PR #141 carries that production does not have (read-only check by
the PR #141 reviewer, 2026-10-15):

| # | migration | what it adds | who calls it |
|---|---|---|---|
| 1 | `20261003120000_intake_approval_budget_invariants` | `foundation_intake_approvals`, `foundation_intake_approval_files`, and the approval RPCs (`create_`, `read_`, `reserve_…_approved_file`, `confirm_…_approved_upload`, `confirm_…_approved_file`, `cancel_…_approved_file`, `settle_…_approved_compute`, `assert_foundation_intake_compile_set`) | nothing while the approval switch is off |
| 2 | `20261003130000_intake_approval_file_cap` | two `check` constraints on table 1 (128 files) | nothing |
| 3 | `20261004100000_approved_intake_connection_batch_binding` | replaces `apply_foundation_connection_batch` (same ten parameters): it validates each event's `documentId` itself -- main's workspace derivation, or a confirmed approval member bound to the caller -- so an approved upload's UUIDv4 can bind | the local-agent connection batch, on every batch. **Switch off: the route keeps main's check** (`parseConnectionBatchInput(body, workspaceKey)` refuses an id not derived from the workspace with `CONNECTION_BATCH_INVALID`) because production's 0012 body checks only actor, cursor and idempotency. Switch on: the route defers to this function, so it must be applied first |
| 4 | `20261007100000_dropbox_source_path_reconciliation` | three `dropbox_source_*` tables, `reconcile_dropbox_source_page`, `dropbox_uncommitted_source_stream`, a `foundation_jobs` insert guard; replaces `enqueue_connector_sync` | every Dropbox sync page, **only while the approval switch is on** |

`read_foundation_intake_approval_v2` is **not** in this list. It exists only in
`supabase/drafts/migrations/20261004120000_foundation_intake_triage_v3.sql`, which says DRAFT ONLY,
never apply. The application calls it only with triage on (`lib/intake-triage-rollout.ts`, off).

This runbook follows `RELEASE_ORDER.md`: migrations first, then the deploy that needs them. The
deploy that needs them is the later one that turns the switch on (section 4), **not PR #141**.

## What the deploy needs, and what it does not

**None of the four is required to merge or deploy PR #141.** They are one feature-enablement step,
tied to turning `INTAKE_APPROVAL_ROLLOUT_ENABLED` on.

PR #141 ships with `INTAKE_APPROVAL_ROLLOUT_ENABLED = false` (`nextjs/lib/intake-approval-rollout.ts`).
With it off:

- upload capability, confirm, release, `compile-jobs` and `collections/compile` run main
  dbe22b1e's path (`reserve_foundation_intake_admission`, `reserve_foundation_compute_v3`,
  `confirm_foundation_intake_admission`, `settle_foundation_compute_v3`) and call none of
  migration 1's functions. `nextjs/lib/intake-approval-rollout-off.test.ts` pins that against a
  mocked database that has only main's functions.
- Dropbox sync runs main dbe22b1e's path too: a DeletedMetadata keeps main's `path_lower` id and is
  suspended at once, the checkpoint moves as on main, and `reconcile_dropbox_source_page` is never
  called. `nextjs/lib/dropbox-sync-rollout.test.ts` pins that against the same kind of database.
- the connection-batch route binds every event's `documentId` to the caller's workspace before the
  RPC, exactly as main does (`app/api/v1/connections/[id]/sync/route.ts`); production's 0012
  `apply_foundation_connection_batch` does not, so the route check is the guard while the switch is
  off. `nextjs/lib/intake-approval-rollout-off.test.ts` pins the refusal (`CONNECTION_BATCH_INVALID`,
  no RPC call) and the derived-id pass against the same mocked production database. Migration 3
  keeps the ten parameters, so the call is the same before and after it is applied.

With the switch **on**, every Dropbox page goes through `reconcile_dropbox_source_page`. A database
without migration 4 then answers PGRST202 / 42883, and the sync fails closed with
`DROPBOX_SOURCE_RECONCILIATION_MIGRATION_MISSING`: retried, nothing imported or suspended, the
checkpoint where it was.

Order among the four: migration 3 depends on migration 1's tables, so it goes after 1. Migration 4's
`enqueue_connector_sync` replacement and `foundation_jobs` insert guard act from the moment it is
applied, switch or no switch, so apply it in the switch-on window (section 4), not ahead of it.

## Draft-schema paths and their gates

The four migrations above are registered but unapplied. Other paths in this PR call schema that is
**not a migration at all**: it exists only in `supabase/drafts/`, which says "draft only, do not
apply". Each such path sits behind a gate that is off in production. Read-only check against
production (`tfcorhjkqcuisqhsjemz`, 2026-10-16): none of the functions or columns below exists, and
none of the environment variables below is set in the Vercel production project (names checked,
values not read).

**Each gate stays off until its draft is promoted to a registered migration, reviewed, and applied
to production.** Turning a gate on before that is not a configuration change: every request on that
path fails closed (missing function or column), and some fail with a code that names the store, not
the missing migration.

| gate (off in production) | kind | path | draft-only schema it needs |
|---|---|---|---|
| `INTAKE_TRIAGE_ROLLOUT_ENABLED` | code constant, `false` (`nextjs/lib/intake-triage-rollout.ts`) | server triage routes (`app/api/v1/uploads/triage/*`), triage branches of `lib/compute-reservation.ts` and `app/api/uploads/confirm/route.ts`; turning it on also turns the approval lineage on | `supabase/drafts/migrations/20261004120000_foundation_intake_triage_v3.sql`: `create_foundation_intake_preflight_approval`, `create_foundation_intake_triage_stage`, `claim_/finish_foundation_intake_triage_stage_seal`, `read_foundation_intake_triage_stages`, `create_/read_foundation_intake_triage_receipt`, `create_foundation_intake_approval_v2`, `read_foundation_intake_approval_v2`, `reserve_foundation_intake_approved_file_v2`, `assert_foundation_intake_triage_compile_set`; tables `foundation_intake_preflight_approvals`, `foundation_intake_triage_*`; approval columns `preflight_approval_id`, `triage_receipt_id`, `triage_version`, `configuration_revision` |
| `TAVONEL_GOOGLE_VIEWER_LINK_ENABLED` | env, `=== "true"` (`nextjs/lib/connector-oauth.ts`) | viewer-link authorize, callback and revoke (`app/api/v1/oauth-connectors/…`), `/workspace/google-drive-access` (`notFound()` while off), viewer ACL check (`lib/connector-source-access.ts`), ACL capture on Google import (`lib/source-import.ts`), ACL refresh turn (`lib/google-drive-acl-refresh.ts`, `/api/internal/jobs/acl-refresh`) | `supabase/drafts/google-viewer-principal-boundary.sql`: column `foundation_oauth_authorizations.authorization_purpose` and the replaced `consume_foundation_oauth_authorization` that returns it, `source_acl_snapshots.capture_complete`, table `foundation_provider_principal_links`, `record_google_drive_viewer_principal`, `revoke_google_drive_viewer_principals`, `connector_documents_blocked_for_viewer`, `record_google_drive_source_acl_snapshot`, `record_google_drive_source_acl_capture_failure`; `supabase/drafts/google-drive-acl-refresh/queue.sql`: `enqueue_stale_google_drive_acl_refreshes`, `claim_google_drive_acl_refresh_batch`, `read_google_drive_acl_refresh_source`, `finish_google_drive_acl_refresh`, `cooldown_google_drive_acl_refresh_connection`, `google_drive_acl_refresh_connection_active`, `google_drive_acl_refresh_lease_owned` and the `foundation_google_drive_acl_refresh_*` tables. A connector (not viewer-link) authorization never names `authorization_purpose`, and a consume row without it reads as a connector connection, so main's Google Drive connection works against production's schema (`nextjs/lib/connector-oauth-store.test.ts`) |
| `TAVONEL_COMPILE_JOB_AUTHORITY_VERSION` | env, `=== "v1"` (`nextjs/lib/compile-job-authority.ts`) | compile-job viewer authority and the authority-bound enqueue (`lib/compile-job-store.ts`); off, main's `enqueue_foundation_compile_job` | `supabase/drafts/compile-job-viewer-authority.sql`: `authorize_foundation_compile_job`, `enqueue_foundation_compile_job_with_authority`, table `foundation_compile_job_source_authority` |
| `FOUNDATION_COMPLETED_READ_ENABLED` | env, `=== "true"` (`nextjs/lib/completed-read-proof.ts`) | completed-read proof settle and read | `supabase/drafts/migrations/20261005130000_foundation_completed_read_proof.sql`: `settle_foundation_completed_read_v1`, `read_foundation_completed_read_v1`, tables `foundation_completed_read_*` |
| `INTAKE_APPROVAL_ROLLOUT_ENABLED` | code constant, `false` (`nextjs/lib/intake-approval-rollout.ts`) | the whole-set approval lineage, Dropbox path reconciliation, and the connection-batch route's deferral to migration 3 | not draft: migrations 1–4 above (registered, unapplied). Listed so the table names every gate |

The read-only check that produced this table, for the next change that touches a gate:

```sql
-- Expect zero rows once a gate's draft has been promoted and applied; today every name returns.
select n from unnest(array['authorization_purpose']) n
where not exists (select 1 from information_schema.columns where table_schema = 'public' and column_name = n)
union all
select n from unnest(array[
  'create_foundation_intake_triage_stage', 'read_foundation_intake_approval_v2',
  'record_google_drive_viewer_principal', 'revoke_google_drive_viewer_principals',
  'connector_documents_blocked_for_viewer', 'claim_google_drive_acl_refresh_batch',
  'authorize_foundation_compile_job', 'enqueue_foundation_compile_job_with_authority',
  'settle_foundation_completed_read_v1', 'read_foundation_completed_read_v1']) n
where not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                  where s.nspname = 'public' and p.proname = n);
```

## Why not `supabase db push`

Production records **apply-time versions**, not the repository's filename versions (for example,
production `20260921064244` is the repository's `20260921110000`). `db push` compares versions, sees
every repository migration whose version production does not list, and would re-apply migrations
that are already there. Apply these four by hand and match the history **by name**.

## 0. Founder approval

The production apply is the founder's step. An agent does not run it. Approve, in writing, the
four files at the sha being enabled (check `git log -1 -- supabase/migrations/<file>`), together
with the switch-on change in section 4. Merging or deploying PR #141 with the switch off needs
neither.

## 1. Read-only pre-check

```sql
-- None of these may exist yet. Expect zero rows.
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'create_foundation_intake_approval', 'read_foundation_intake_approval',
  'reserve_foundation_intake_approved_file', 'confirm_foundation_intake_approved_upload',
  'confirm_foundation_intake_approved_file', 'cancel_foundation_intake_approved_file',
  'settle_foundation_intake_approved_compute', 'assert_foundation_intake_compile_set',
  'reconcile_dropbox_source_page', 'dropbox_uncommitted_source_stream',
  'read_foundation_intake_approval_v2');

-- The history, by name. Expect no row for any of the four, and note how names are spelled.
select version, name from supabase_migrations.schema_migrations
where name ilike '%intake_approval%' or name ilike '%connection_batch_binding%'
   or name ilike '%dropbox_source_path%'
order by version;
select version, name from supabase_migrations.schema_migrations order by version desc limit 5;
```

If any of the four is already listed by name, stop: it is applied, and applying it again fails
(`create table` / `create function` without `or replace`).

## 2. Apply, in filename order, one file per transaction

Use the same tool the earlier production rows came from (the last query above shows their naming).
With the Supabase `apply_migration` tool, pass the file's SQL and `name` = the filename stem
without the version prefix, for example `intake_approval_budget_invariants`; it records its own
apply-time version. With `psql`:

```sh
psql "$PROD_DB_URL" --single-transaction -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20261003120000_intake_approval_budget_invariants.sql
```

then record the row yourself, in the same spelling as the existing rows:

```sql
insert into supabase_migrations.schema_migrations (version, name)
values (to_char(now() at time zone 'utc', 'YYYYMMDDHH24MISS'), 'intake_approval_budget_invariants');
```

Order: 1 → 2 → 3 → 4. Stop at the first error; each file is one transaction, so a failed file
leaves nothing behind.

## 3. Verify

```sql
-- Migration 1: thirteen rows -- eight RPCs and five guard/payload helpers.
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and (p.proname like '%foundation_intake_approv%'
   or p.proname = 'assert_foundation_intake_compile_set')
order by 1;

-- Migration 2: the 128-file bound.
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.foundation_intake_approvals'::regclass and conname like '%file_count%';

-- Migrations 3 and 4: replaced functions keep one overload each, same parameters as before.
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'apply_foundation_connection_batch', 'enqueue_connector_sync',
  'reconcile_dropbox_source_page', 'dropbox_uncommitted_source_stream')
order by 1;

-- Still absent: the draft-only reader.
select count(*) from pg_proc where proname = 'read_foundation_intake_approval_v2';  -- expect 0

-- History: four rows, by name.
select version, name from supabase_migrations.schema_migrations
where name ilike '%intake_approval%' or name ilike '%connection_batch_binding%'
   or name ilike '%dropbox_source_path%' order by version;
```

`supabase/tests/service_role_grant_matrix.sql` states the grants these tables must have; run it
against a rehearsal database, not production.

## 4. Turning the approval lineage on (later, separately)

Only after step 3 passes: a reviewed PR that sets `APPROVAL_LINEAGE_SWITCH = true` in
`nextjs/lib/intake-approval-rollout.ts`. Apply the four migrations (steps 1–3) in the same window,
immediately before that deploy. Triage stays off; it needs the draft above to become a reviewed
migration first. With the switch on, a missing approval function answers
`INTAKE_APPROVAL_LINEAGE_UNAVAILABLE` (503), not a ledger outage, and the switch also turns on the
Dropbox path reconciliation: a missing `reconcile_dropbox_source_page` fails the sync closed as
`DROPBOX_SOURCE_RECONCILIATION_MIGRATION_MISSING` with the checkpoint held.

## Rollback

- Before the switch is on, migrations 1 and 2 are inert; leaving them in place is the rollback.
- Migration 3: re-create `apply_foundation_connection_batch` from
  `supabase/migrations/0012_foundation_connections_and_api_keys.sql` (its last definition before 3).
- Migration 4: turn the switch off first (reconciliation then stops being called), re-create
  `enqueue_connector_sync` from `supabase/migrations/20260909210203_connector_sync_checkpoints.sql`,
  and drop trigger `foundation_jobs_dropbox_stream_guard` on `public.foundation_jobs`. The
  `dropbox_source_*` tables can stay; nothing else reads them.
- Application: production `dpl_4eqGTMU6SxLbfmUCP6e5tTqEZZh5` is main dbe22b1e.
