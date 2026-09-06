-- 0053 — every service_role grant in the chain was advisory until this file.
--
-- Finding R-2 (USKC_DB_QUALIFICATION_CONTRACT_2026-09-06, Layer A results; reproduced in CI run
-- 34018684241, fixture foundation_world_lifecycle.sql test 13): Supabase's own default privileges
-- run `alter default privileges for role postgres in schema public grant all on tables to
-- service_role` (visible in the rehearsal's schema artifact at schema-after-0050.sql:6551), so
-- every table this chain creates hands service_role ALL the moment it is created. Not one
-- migration revokes it. `0007:68-71` revokes on the three world-lifecycle tables from
-- `public, anon, authenticated` and then grants `select` to service_role -- and service_role kept
-- UPDATE anyway, which means the server credential could rewrite a world version around
-- `promote_foundation_candidate` / `rollback_foundation_world`, and could DELETE a row from
-- `sources` around the tombstone rule. Every "grant select to service_role" in the chain was a
-- comment, not a privilege.
--
-- Repair, in two passes:
--
--   1. revoke every table-level AND column-level privilege service_role holds on every table in
--      `public` (a table-level `revoke all` does not touch column grants; there are none today and
--      this keeps it that way);
--   2. grant back exactly the verbs the migrations themselves wrote. The matrix below is derived
--      mechanically from every `grant ... to service_role` statement in 0001-0051 -- the migration
--      that wrote each row is named in its comment -- and nothing was added to it by judgement.
--
-- Then the default privilege itself is revoked, so a table written by 0055 or 0100 does not
-- silently re-grant ALL. Without that, this file fixes today and nothing else.
--
-- THE FOURTEEN TABLES THAT GET NOTHING. No migration in 0001-0051 ever granted service_role a
-- privilege on them, so under rule 2 they get none:
--
--   billing_events · credit_ledger_entries · documents · foundation_intake_admissions ·
--   gpu_job_reservations · knowledge_graph_candidates · paddle_customers · paddle_subscriptions ·
--   plans · profiles · sanitization_proofs · workspace_entitlements · workspace_memberships ·
--   workspaces
--
-- That is safe to assert rather than assume, because the server never reaches them as
-- service_role. This repository talks to PostgREST by path (`nextjs/lib/supabase-admin.ts`), and a
-- sweep of every `/rest/v1/<table>` and `.from('<table>')` in nextjs/lib, nextjs/app, server/,
-- shared/, client/ and workers/ names 32 tables, all of them in the matrix below; the only dynamic
-- table name in the codebase is `nextjs/lib/source-domain-store.ts:304`, whose three arguments are
-- `sources`, `source_versions` and `source_representations`. The fourteen above are the browser's
-- own tables, reached with the anon key under RLS, plus `foundation_intake_admissions`, which is
-- written only by the SECURITY DEFINER `reserve_foundation_intake_admission`. No table needed a
-- grant the migrations had not already written -- so this file adds no privilege of its own.
--
-- One row is worth reading twice: `enterprise_audit_events` keeps UPDATE and DELETE because 0014
-- granted them. 0014's own comment says audit history is append-only "including for service_role",
-- and it is -- enforced by the `reject_enterprise_audit_mutation` trigger, not by the grant. This
-- file does not narrow the grant, because narrowing it would be this lane inventing intent rather
-- than enforcing it. Flagged as a finding instead.
--
-- Re-runnable: both passes are idempotent, the revoke sweep reads the catalog rather than a list,
-- and no data is read or written.

begin;

-- Pass 1 — take everything back, including anything a future migration adds by default.
do $$
declare
  v_table text;
  v_columns text;
begin
  for v_table in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
     order by c.relname
  loop
    execute format('revoke all on table public.%I from service_role', v_table);

    select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
      into v_columns
      from pg_attribute a
     where a.attrelid = format('public.%I', v_table)::regclass
       and a.attnum > 0
       and not a.attisdropped;

    if v_columns is not null then
      execute format('revoke all (%s) on table public.%I from service_role', v_columns, v_table);
    end if;
  end loop;
end;
$$;

-- Pass 2 — the intended matrix, one row per table, the source migration in the comment.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('customer_data_gate_receipts'::text, 'select, insert'::text), -- 0050
      ('enterprise_audit_events', 'select, insert, update, delete'), -- 0014
      ('enterprise_daily_metrics', 'select, insert, update, delete'), -- 0014
      ('enterprise_governance_policies', 'select, insert, update, delete'), -- 0014
      ('enterprise_identity_configs', 'select, insert, update, delete'), -- 0014
      ('enterprise_organization_memberships', 'select, insert, update, delete'), -- 0014
      ('enterprise_organizations', 'select, insert, update, delete'), -- 0014
      ('enterprise_workspace_memberships', 'select, insert, update, delete'), -- 0014
      ('enterprise_workspaces', 'select, insert, update, delete'), -- 0014
      ('foundation_account_access_grants', 'select, insert, update, delete'), -- 0045
      ('foundation_active_worlds', 'select'), -- 0007
      ('foundation_api_keys', 'select, insert, update'), -- 0012
      ('foundation_api_rate_windows', 'select, insert, update, delete'), -- 0012
      ('foundation_billing_accounts', 'select, insert, update, delete'), -- 0005
      ('foundation_billing_events', 'select, insert, update, delete'), -- 0005
      ('foundation_compile_job_events', 'select, insert'), -- 0038
      ('foundation_compile_jobs', 'select, insert, update'), -- 0038
      ('foundation_compute_reservations', 'select, insert, update'), -- 0009
      ('foundation_connection_batches', 'select, insert, update'), -- 0012
      ('foundation_connections', 'select, insert, update'), -- 0012
      ('foundation_credit_ledger', 'select, insert, update, delete'), -- 0005
      ('foundation_developer_audit_events', 'select, insert, update'), -- 0012
      ('foundation_job_events', 'select, insert'), -- 0034
      ('foundation_jobs', 'select, insert, update'), -- 0024
      ('foundation_oauth_authorizations', 'select, insert, update, delete'), -- 0013
      ('foundation_oauth_connections', 'select, insert, update'), -- 0013
      ('foundation_oauth_secret_envelopes', 'select, insert, delete'), -- 0016
      ('foundation_pending_reversals', 'select, insert, update, delete'), -- 0005
      ('foundation_retrieval_compile_runs', 'select, insert, update, delete'), -- 0020
      ('foundation_retrieval_embeddings', 'select, insert, delete'), -- 0020
      ('foundation_retrieval_profiles', 'select, insert, update, delete'), -- 0020
      ('foundation_retrieval_units', 'select, insert, delete'), -- 0020
      ('foundation_review_decisions', 'select, insert'), -- 0037
      ('foundation_self_service_trials', 'select, insert, update, delete'), -- 0045
      ('foundation_trial_daily_budget', 'select, insert, update, delete'), -- 0045
      ('foundation_trial_policy', 'select, insert, update, delete'), -- 0045
      ('foundation_trial_risk_events', 'select, insert, update, delete'), -- 0045
      ('foundation_trial_source_digests', 'select, insert, update, delete'), -- 0047
      ('foundation_world_events', 'select'), -- 0007
      ('foundation_world_versions', 'select'), -- 0007
      ('source_acl_snapshots', 'select, insert'), -- 0050
      ('source_representations', 'select, insert, update'), -- 0049
      ('source_versions', 'select, insert, update'), -- 0049
      ('sources', 'select, insert, update')  -- 0049
    ) as intended(table_name, verbs)
  loop
    -- A matrix row naming a table that no longer exists is a silent hole, not a no-op.
    if to_regclass(format('public.%I', r.table_name)) is null then
      raise exception 'service_role grant matrix names a table that does not exist: %', r.table_name;
    end if;
    execute format('grant %s on table public.%I to service_role', r.verbs, r.table_name);
  end loop;
end;
$$;

-- The default privilege itself. `postgres` is the role that owns and creates every table in this
-- schema (schema-after-0050.sql:6548-6551 shows all four default grants under FOR ROLE "postgres"),
-- and migrations run as it, so this statement is the one that matters and it is not guarded.
alter default privileges for role postgres in schema public revoke all on tables from service_role;

-- MEASURED, and it is a finding: `supabase_admin` holds the same default privilege in `public`
-- (`grant all on tables to service_role`). It is not in the schema dump -- pg_dump --schema public
-- does not emit it -- and the rehearsal found it only because the test below asked the catalog
-- (run 34022126727). This migration CANNOT revoke it: `alter default privileges for role X` needs
-- membership in X, migrations run as `postgres`, and `postgres` is not a member of `supabase_admin`
-- on the Supabase image. So the branch below is attempted and, on this stack, does not fire.
--
-- Why that is not a hole today: a default ACL applies only to tables the role itself creates, and
-- `supabase_admin` creates none in `public` -- all 58 tables are owned by `postgres`. What
-- `supabase_admin` can do on the hosted project is a Layer B question and a founder-owned one; it
-- is named here rather than left for the next reader to rediscover.
--
-- Not a silent fallback: supabase/tests/service_role_grant_matrix.sql asserts the *effect* -- that
-- no role which owns a table in `public` still re-grants future tables to service_role -- so the
-- day supabase_admin owns one, the suite goes red instead of going quiet.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin')
     and pg_has_role(current_user, 'supabase_admin', 'usage') then
    execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from service_role';
  end if;
end;
$$;

commit;
