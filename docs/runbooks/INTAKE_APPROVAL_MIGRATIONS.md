# Intake approval migrations: manual production apply

**Scope.** The four migrations PR #141 carries that production does not have (read-only check by
the PR #141 reviewer, 2026-10-15):

| # | migration | what it adds | who calls it |
|---|---|---|---|
| 1 | `20261003120000_intake_approval_budget_invariants` | `foundation_intake_approvals`, `foundation_intake_approval_files`, and the approval RPCs (`create_`, `read_`, `reserve_…_approved_file`, `confirm_…_approved_upload`, `confirm_…_approved_file`, `cancel_…_approved_file`, `settle_…_approved_compute`, `assert_foundation_intake_compile_set`) | nothing while the approval switch is off |
| 2 | `20261003130000_intake_approval_file_cap` | two `check` constraints on table 1 (128 files) | nothing |
| 3 | `20261004100000_approved_intake_connection_batch_binding` | replaces `apply_foundation_connection_batch` (same ten parameters) so an approved upload's UUIDv4 binds to its confirmed member | the local-agent connection batch, on every batch |
| 4 | `20261007100000_dropbox_source_path_reconciliation` | three `dropbox_source_*` tables, `reconcile_dropbox_source_page`, `dropbox_uncommitted_source_stream`; replaces `enqueue_connector_sync` | **every Dropbox sync page, unconditionally** |

`read_foundation_intake_approval_v2` is **not** in this list. It exists only in
`supabase/drafts/migrations/20261004120000_foundation_intake_triage_v3.sql`, which says DRAFT ONLY,
never apply. The application calls it only with triage on (`lib/intake-triage-rollout.ts`, off).

This runbook follows `RELEASE_ORDER.md`: migrations first, then the deploy that needs them.

## What the deploy needs, and what it does not

PR #141 ships with `INTAKE_APPROVAL_ROLLOUT_ENABLED = false` (`nextjs/lib/intake-approval-rollout.ts`).
With it off, upload capability, confirm, release, `compile-jobs` and `collections/compile` run main
dbe22b1e's path (`reserve_foundation_intake_admission`, `reserve_foundation_compute_v3`,
`confirm_foundation_intake_admission`, `settle_foundation_compute_v3`) and call none of migration
1's functions. `nextjs/lib/intake-approval-rollout-off.test.ts` pins that against a mocked database
that has only main's functions.

So migrations 1 and 2 are needed **before the switch is turned on**, not before the deploy.

Migration 4 is different: the PR's Dropbox sync calls `reconcile_dropbox_source_page` on every
page and is not behind the switch. Without migration 4 a Dropbox sync fails closed with
`DROPBOX_SOURCE_RECONCILIATION_UNAVAILABLE` and retries — no wrong data, but no Dropbox sync.
**Apply migration 4 before the deploy**, unless the founder confirms production has no Dropbox
connection (`select count(*) from public.foundation_oauth_connections where provider = 'dropbox';`).

Migration 3 depends on migration 1's tables, so it goes after 1. It keeps the function's
parameters, so the deployed application calls it the same way before and after.

## Why not `supabase db push`

Production records **apply-time versions**, not the repository's filename versions (for example,
production `20260921064244` is the repository's `20260921110000`). `db push` compares versions, sees
every repository migration whose version production does not list, and would re-apply migrations
that are already there. Apply these four by hand and match the history **by name**.

## 0. Founder approval

The production apply is the founder's step. An agent does not run it. Approve, in writing, the
four files at the PR head's sha (check `git log -1 -- supabase/migrations/<file>`), and decide on
migration 4 above.

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
`nextjs/lib/intake-approval-rollout.ts`. Triage stays off; it needs the draft above to become a
reviewed migration first. With the switch on, a missing approval function answers
`INTAKE_APPROVAL_LINEAGE_UNAVAILABLE` (503), not a ledger outage.

## Rollback

- Before the switch is on, migrations 1 and 2 are inert; leaving them in place is the rollback.
- Migration 3: re-create `apply_foundation_connection_batch` from
  `supabase/migrations/0012_foundation_connections_and_api_keys.sql` (its last definition before 3).
- Migration 4: re-create `enqueue_connector_sync` from
  `supabase/migrations/20260909210203_connector_sync_checkpoints.sql`. The `dropbox_source_*`
  tables can stay; nothing else reads them.
- Application: production `dpl_4eqGTMU6SxLbfmUCP6e5tTqEZZh5` is main dbe22b1e.
