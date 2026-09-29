begin;

-- Scope classification needs only an upload's durable identity and confirmation state.
-- Keep the table-level service-role grants empty: source user IDs, bytes, object keys,
-- and admission mutation remain behind the existing narrow RPCs.
grant select (workspace_key, document_id, confirmed_at)
  on public.foundation_intake_admissions to service_role;

commit;
