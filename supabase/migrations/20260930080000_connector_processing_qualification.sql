-- Connector qualification: the same bounded, non-billable qualification stage as
-- 20260930070000, extended to scope `connector` for one operator workspace and an operator-owned
-- synthetic sample.
--
-- A connector release needs all 17 preconditions. Three of them can only be observed from a
-- connector source that has been imported, bound and compiled:
--   compile_receipts_signed_and_audited, deletion_tombstone_propagation_verified,
--   per_source_acl_preserved.
-- A connector qualification row names exactly those three as `missing` (in customerDataPreconditions
-- order), carries the other 14 as evidence and none of the three, and keeps every other bound of
-- 20260930070000: its own schema version, one `pilot-*` workspace, at most one hour, a
-- `delegated-operator:` actor. The guard trigger from 20260930070000 already keys on
-- (scope, revision), so no connector qualification can follow an allowed connector release.
--
-- Additive: 20260930070000 is applied and is not edited. Existing rows (direct_upload
-- qualification, every production row) satisfy the replaced constraints unchanged; no digest
-- changes. The grant writer below differs from 20260930070000 only in its scope comparison
-- (the release's own scope instead of the literal 'direct_upload'). Nothing here records evidence,
-- activates the v2 gate, opens a connector route or enables billing.
begin;

alter table public.customer_data_release_decisions
  drop constraint scoped_release_stage_shape,
  drop constraint scoped_release_allowed_complete,
  add constraint scoped_release_stage_shape check (
    (stage = 'production' and schema_version = 'tavonel.customer_data_gate.v2'
      and qualification_workspace_key is null and qualification_expires_at is null)
    or (stage = 'qualification' and schema_version = 'tavonel.customer_data_gate.v2.qualification'
      and scope in ('direct_upload', 'connector')
      and qualification_workspace_key is not null
      and qualification_expires_at is not null
      and qualification_workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'
      and qualification_expires_at > evaluated_at
      and qualification_expires_at <= evaluated_at + interval '1 hour'
      and operator_actor ~ '^delegated-operator:[A-Za-z0-9._@-]{1,100}$')
  ),
  add constraint scoped_release_allowed_complete check (
    allowed = false or (receipt_sha256 is not null and (
      (stage = 'production' and cardinality(missing) = 0
        and jsonb_array_length(evidence) = case scope when 'direct_upload' then 12 else 17 end)
      or (stage = 'qualification' and scope = 'direct_upload'
        and missing = array['compile_receipts_signed_and_audited']::text[]
        and jsonb_array_length(evidence) = 11
        and not evidence @> '[{"precondition": "compile_receipts_signed_and_audited"}]'::jsonb)
      or (stage = 'qualification' and scope = 'connector'
        and missing = array['compile_receipts_signed_and_audited', 'deletion_tombstone_propagation_verified',
          'per_source_acl_preserved']::text[]
        and jsonb_array_length(evidence) = 14
        and not evidence @> '[{"precondition": "compile_receipts_signed_and_audited"}]'::jsonb
        and not evidence @> '[{"precondition": "deletion_tombstone_propagation_verified"}]'::jsonb
        and not evidence @> '[{"precondition": "per_source_acl_preserved"}]'::jsonb)
    ))
  );

alter table public.customer_data_workspace_decisions
  drop constraint scoped_workspace_stage_shape,
  add constraint scoped_workspace_stage_shape check (
    (stage = 'production' and schema_version = 'tavonel.customer_data_gate.v2')
    or (stage = 'qualification' and schema_version = 'tavonel.customer_data_gate.v2.qualification'
      and scope in ('direct_upload', 'connector')
      and (allowed = false or expires_at <= granted_at + interval '1 hour'))
  );

create or replace function public.issue_customer_data_workspace_grant(
  p_workspace_key text,
  p_scope text,
  p_release_revision text,
  p_release_receipt_sha256 text,
  p_acceptance_id uuid,
  p_terms_version text,
  p_terms_path text,
  p_terms_sha256 text,
  p_processing_path text,
  p_processing_sha256 text,
  p_terms_receipt_sha256 text,
  p_processing_terms_receipt_sha256 text,
  p_granted_at timestamptz,
  p_expires_at timestamptz,
  p_grant_receipt_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz;
  v_release public.customer_data_release_decisions%rowtype;
  v_acceptance public.foundation_processing_terms_acceptances%rowtype;
  v_owner public.foundation_workspace_members%rowtype;
  v_latest public.customer_data_workspace_decisions%rowtype;
  v_row public.customer_data_workspace_decisions%rowtype;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_scope is null or p_scope not in ('direct_upload', 'connector')
    or p_release_revision is null or p_release_revision !~ '^[0-9a-f]{40}$'
    or p_release_receipt_sha256 is null or p_release_receipt_sha256 !~ '^sha256:[0-9a-f]{64}$'
    or p_acceptance_id is null or p_terms_version is null
    or p_terms_path is null or p_terms_sha256 is null
    or p_processing_path is null or p_processing_sha256 is null
    or p_terms_receipt_sha256 is null or p_processing_terms_receipt_sha256 is null
    or p_grant_receipt_sha256 is null or p_granted_at is null or p_expires_at is null
    or date_trunc('milliseconds', p_granted_at) <> p_granted_at
    or date_trunc('milliseconds', p_expires_at) <> p_expires_at
    or p_expires_at <= p_granted_at or p_expires_at > p_granted_at + interval '30 days' then
    raise exception 'workspace_grant_input_invalid';
  end if;

  lock table public.customer_data_workspace_decisions in share row exclusive mode;
  v_now := clock_timestamp();
  if p_granted_at > v_now + interval '1 minute' or p_granted_at < v_now - interval '5 minutes' then
    raise exception 'workspace_grant_input_invalid';
  end if;

  select * into v_release from public.customer_data_release_decisions
   where scope = p_scope and release_revision = p_release_revision
   order by recorded_at desc, allowed asc, evaluated_at desc
   limit 1;
  if not found or v_release.allowed is not true
    or v_release.receipt_sha256 is distinct from p_release_receipt_sha256
    or v_release.recorded_at > v_now or v_release.evaluated_at > p_granted_at
    or v_now - v_release.evaluated_at > interval '30 days'
    or p_expires_at > v_release.evaluated_at + interval '30 days' then
    raise exception 'workspace_grant_release_changed';
  end if;
  -- A qualification admits only its recorded workspace, its own scope, within its own expiry, for
  -- at most an hour per grant.
  if v_release.stage <> 'production' and (v_release.stage is distinct from 'qualification'
    or p_scope is distinct from v_release.scope
    or v_release.qualification_workspace_key is distinct from p_workspace_key
    or v_now >= v_release.qualification_expires_at
    or p_expires_at > v_release.qualification_expires_at
    or p_expires_at > p_granted_at + interval '1 hour') then
    raise exception 'workspace_grant_qualification_refused';
  end if;

  select * into v_acceptance from public.foundation_processing_terms_acceptances
   where acceptance_id = p_acceptance_id and workspace_key = p_workspace_key and scope = p_scope
     and terms_version = p_terms_version and terms_path = p_terms_path and terms_sha256 = p_terms_sha256
     and processing_path = p_processing_path and processing_sha256 = p_processing_sha256
     and accepted_at <= p_granted_at;
  if not found then raise exception 'workspace_grant_acceptance_required'; end if;
  select * into v_owner from public.foundation_workspace_members
   where workspace_key = p_workspace_key and user_id = v_acceptance.user_id
   for share;
  if not found or v_owner.state <> 'active' or v_owner.role <> 'owner'
    or v_owner.authorization_revision is distinct from v_acceptance.authorization_revision then
    raise exception 'workspace_grant_acceptance_required';
  end if;
  if public.processing_terms_receipt_sha256('terms', v_acceptance) <> p_terms_receipt_sha256
    or public.processing_terms_receipt_sha256('processing', v_acceptance) <> p_processing_terms_receipt_sha256 then
    raise exception 'workspace_grant_input_invalid';
  end if;

  select * into v_latest from public.customer_data_workspace_decisions
   where tenant_id = p_workspace_key and workspace_id = p_workspace_key and scope = p_scope
   order by recorded_at desc, allowed asc
   limit 1;
  if found and v_latest.allowed is not true then
    raise exception 'workspace_grant_refused';
  end if;
  if found and v_latest.stage = v_release.stage and v_latest.release_revision = p_release_revision
    and v_latest.release_receipt_sha256 = p_release_receipt_sha256
    and v_latest.user_id = v_acceptance.user_id and v_latest.terms_version = p_terms_version
    and v_latest.terms_receipt_sha256 = p_terms_receipt_sha256
    and v_latest.processing_terms_receipt_sha256 = p_processing_terms_receipt_sha256
    and v_latest.granted_at <= v_now and v_latest.expires_at > v_now
    and v_latest.grant_receipt_sha256 = public.customer_data_workspace_grant_sha256(v_latest) then
    return public.customer_data_workspace_grant_receipt(v_latest, true);
  end if;

  v_row.stage := v_release.stage;
  v_row.schema_version := v_release.schema_version;
  v_row.tenant_id := p_workspace_key;
  v_row.workspace_id := p_workspace_key;
  v_row.scope := p_scope;
  v_row.release_revision := p_release_revision;
  v_row.user_id := v_acceptance.user_id;
  v_row.release_receipt_sha256 := p_release_receipt_sha256;
  v_row.terms_version := p_terms_version;
  v_row.terms_receipt_sha256 := p_terms_receipt_sha256;
  v_row.processing_terms_receipt_sha256 := p_processing_terms_receipt_sha256;
  v_row.granted_at := p_granted_at;
  v_row.expires_at := p_expires_at;
  if public.customer_data_workspace_grant_sha256(v_row) is distinct from p_grant_receipt_sha256 then
    raise exception 'workspace_grant_input_invalid';
  end if;

  insert into public.customer_data_workspace_decisions (
    schema_version, stage, tenant_id, workspace_id, scope, release_revision, allowed, user_id,
    release_receipt_sha256, terms_version, terms_receipt_sha256, processing_terms_receipt_sha256,
    grant_receipt_sha256, granted_at, expires_at, operator_actor, decision_reason
  ) values (
    v_row.schema_version, v_row.stage, p_workspace_key, p_workspace_key, p_scope, p_release_revision, true,
    v_acceptance.user_id, p_release_receipt_sha256, p_terms_version, p_terms_receipt_sha256,
    p_processing_terms_receipt_sha256, p_grant_receipt_sha256, p_granted_at, p_expires_at,
    'system:processing-terms-grant',
    'issued (' || v_row.stage || ') from the current owner acceptance ' || v_acceptance.acceptance_id::text
      || ' and release receipt ' || p_release_receipt_sha256
  )
  returning * into v_row;
  return public.customer_data_workspace_grant_receipt(v_row, false);
end;
$$;

revoke all on function
  public.issue_customer_data_workspace_grant(text, text, text, text, uuid, text, text, text, text, text,
    text, text, timestamptz, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.issue_customer_data_workspace_grant(text, text, text, text, uuid, text, text, text, text, text,
    text, text, timestamptz, timestamptz, text)
  to service_role;

commit;
