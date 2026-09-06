-- What the server credential may actually do, table by table (finding R-2, migration 0053).
--
-- Before 0053 every `grant ... to service_role` in the chain was advisory: Supabase's default
-- privileges had already granted ALL on every table in `public`, and no migration revoked it. The
-- rehearsal proved that by catching `foundation_world_versions` UPDATE (foundation_world_lifecycle
-- test 13). This file is the whole matrix, so the next table added with a forgotten revoke is
-- caught by name rather than by whichever assertion happens to notice.
--
-- One `table_privs_are` per table rather than a grid of `ok(has_table_privilege(...))` cells:
-- `table_privs_are` asserts the EXACT privilege set, so each call covers that table's whole row of
-- the matrix and additionally fails on a privilege nobody listed. A four-verb grid would not
-- notice service_role keeping TRUNCATE, REFERENCES or TRIGGER, which is exactly what the default
-- `grant all` handed it.
--
-- The expected sets are the migrations' own statements, not a judgement about what the server
-- ought to have: 0053's header names the source migration for every row. Fourteen tables expect
-- `{}` because no migration ever granted service_role anything on them.

begin;
select plan(60);

-- ---------------------------------------------------------------------------
-- 1. Every table in public, in catalog order.
-- ---------------------------------------------------------------------------

select table_privs_are('public', 'billing_events', 'service_role', array[]::text[]);
select table_privs_are('public', 'credit_ledger_entries', 'service_role', array[]::text[]);
select table_privs_are('public', 'customer_data_gate_receipts', 'service_role', array['SELECT', 'INSERT']::text[]);
select table_privs_are('public', 'documents', 'service_role', array[]::text[]);
select table_privs_are('public', 'enterprise_audit_events', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]);
select table_privs_are('public', 'enterprise_daily_metrics', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]);
select table_privs_are('public', 'enterprise_governance_policies', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]);
select table_privs_are('public', 'enterprise_identity_configs', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]);
select table_privs_are('public', 'enterprise_organization_memberships', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]);
select table_privs_are('public', 'enterprise_organizations', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]);
select table_privs_are('public', 'enterprise_workspace_memberships', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]);
select table_privs_are('public', 'enterprise_workspaces', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]);
select table_privs_are('public', 'foundation_account_access_grants', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]);
select table_privs_are('public', 'foundation_active_worlds', 'service_role', array['SELECT']::text[]);
select table_privs_are('public', 'foundation_api_keys', 'service_role', array['SELECT', 'INSERT', 'UPDATE']::text[]);
select table_privs_are('public', 'foundation_api_rate_windows', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]);
select table_privs_are('public', 'foundation_billing_accounts', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]);
select table_privs_are('public', 'foundation_billing_events', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]);
select table_privs_are('public', 'foundation_compile_job_events', 'service_role', array['SELECT', 'INSERT']::text[]);
select table_privs_are('public', 'foundation_compile_jobs', 'service_role', array['SELECT', 'INSERT', 'UPDATE']::text[]);
select table_privs_are('public', 'foundation_compute_reservations', 'service_role', array['SELECT', 'INSERT', 'UPDATE']::text[]);
select table_privs_are('public', 'foundation_connection_batches', 'service_role', array['SELECT', 'INSERT', 'UPDATE']::text[]);
select table_privs_are('public', 'foundation_connections', 'service_role', array['SELECT', 'INSERT', 'UPDATE']::text[]);
select table_privs_are('public', 'foundation_credit_ledger', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]);
select table_privs_are('public', 'foundation_developer_audit_events', 'service_role', array['SELECT', 'INSERT', 'UPDATE']::text[]);
select table_privs_are('public', 'foundation_intake_admissions', 'service_role', array[]::text[]);
select table_privs_are('public', 'foundation_job_events', 'service_role', array['SELECT', 'INSERT']::text[]);
select table_privs_are('public', 'foundation_jobs', 'service_role', array['SELECT', 'INSERT', 'UPDATE']::text[]);
select table_privs_are('public', 'foundation_oauth_authorizations', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]);
select table_privs_are('public', 'foundation_oauth_connections', 'service_role', array['SELECT', 'INSERT', 'UPDATE']::text[]);
select table_privs_are('public', 'foundation_oauth_secret_envelopes', 'service_role', array['SELECT', 'INSERT', 'DELETE']::text[]);
select table_privs_are('public', 'foundation_pending_reversals', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]);
select table_privs_are('public', 'foundation_retrieval_compile_runs', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]);
select table_privs_are('public', 'foundation_retrieval_embeddings', 'service_role', array['SELECT', 'INSERT', 'DELETE']::text[]);
select table_privs_are('public', 'foundation_retrieval_profiles', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]);
select table_privs_are('public', 'foundation_retrieval_units', 'service_role', array['SELECT', 'INSERT', 'DELETE']::text[]);
select table_privs_are('public', 'foundation_review_decisions', 'service_role', array['SELECT', 'INSERT']::text[]);
select table_privs_are('public', 'foundation_self_service_trials', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]);
select table_privs_are('public', 'foundation_trial_daily_budget', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]);
select table_privs_are('public', 'foundation_trial_policy', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]);
select table_privs_are('public', 'foundation_trial_risk_events', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]);
select table_privs_are('public', 'foundation_trial_source_digests', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]);
select table_privs_are('public', 'foundation_world_events', 'service_role', array['SELECT']::text[]);
select table_privs_are('public', 'foundation_world_versions', 'service_role', array['SELECT']::text[]);
select table_privs_are('public', 'gpu_job_reservations', 'service_role', array[]::text[]);
select table_privs_are('public', 'knowledge_graph_candidates', 'service_role', array[]::text[]);
select table_privs_are('public', 'paddle_customers', 'service_role', array[]::text[]);
select table_privs_are('public', 'paddle_subscriptions', 'service_role', array[]::text[]);
select table_privs_are('public', 'plans', 'service_role', array[]::text[]);
select table_privs_are('public', 'profiles', 'service_role', array[]::text[]);
select table_privs_are('public', 'sanitization_proofs', 'service_role', array[]::text[]);
select table_privs_are('public', 'source_acl_snapshots', 'service_role', array['SELECT', 'INSERT']::text[]);
select table_privs_are('public', 'source_representations', 'service_role', array['SELECT', 'INSERT', 'UPDATE']::text[]);
select table_privs_are('public', 'source_versions', 'service_role', array['SELECT', 'INSERT', 'UPDATE']::text[]);
select table_privs_are('public', 'sources', 'service_role', array['SELECT', 'INSERT', 'UPDATE']::text[]);
select table_privs_are('public', 'workspace_entitlements', 'service_role', array[]::text[]);
select table_privs_are('public', 'workspace_memberships', 'service_role', array[]::text[]);
select table_privs_are('public', 'workspaces', 'service_role', array[]::text[]);

-- ---------------------------------------------------------------------------
-- 2. The two ways the matrix above can be true and still leak.
-- ---------------------------------------------------------------------------

-- A table-level `revoke all` leaves column grants untouched, and `table_privs_are` reads the
-- table level only. A column grant that no table grant covers is therefore invisible to every
-- assertion above.
select is_empty($$
  select c.relname::text || '.' || a.attname || ':' || p.privilege_type
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
   cross join lateral (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) as p(privilege_type)
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and has_column_privilege('service_role', c.oid, a.attnum, p.privilege_type)
     and not has_table_privilege('service_role', c.oid, p.privilege_type)
$$, 'service_role holds no column privilege its table row does not already carry');

-- The default privilege is the reason R-2 existed at all: it re-grants ALL to service_role on
-- every table created after it. 0053 revokes it, so the next migration's table arrives with
-- nothing rather than with everything.
select is_empty($$
  select pg_get_userbyid(d.defaclrole) || ':' || d.defaclobjtype::text
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
   where n.nspname = 'public'
     and d.defaclobjtype = 'r'
     and exists (select 1 from unnest(d.defaclacl) as entry where entry::text like 'service_role=%')
$$, 'no default privilege in public re-grants a future table to service_role');

select * from finish();
rollback;
