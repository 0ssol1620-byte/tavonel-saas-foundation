-- Narrow writer for v2 workspace grants.
--
-- A grant row is the only thing that lets a workspace past the scoped customer-data gate, so this
-- RPC re-derives every input under locks rather than trusting the server's earlier reads:
--   * the latest release decision for (scope, revision) is still allowed, fresh and carries the
--     exact release receipt the server recomputed;
--   * the acceptance is the workspace's current active owner's, at their current membership
--     revision, for the exact published documents -- the member row is held FOR SHARE so a
--     concurrent revoke/role change (FOR UPDATE) waits and then bumps the revision;
--   * the terms receipts and the grant receipt are recomputed here and must match the server's;
--   * the latest workspace decision is not an explicit refusal. A refusal is never overwritten.
--
-- The service role keeps its direct INSERT on the ledger (operators record refusals that way), so
-- the table is locked SHARE ROW EXCLUSIVE: an in-flight direct insert commits first and is seen by
-- the recheck, and a later one waits for this grant to commit. recorded_at is stamped from the
-- clock at insert for every writer, so a refusal that lands after a grant always sorts after it
-- and the reader's latest-row rule keeps it definitive.
--
-- A later release refusal needs no lock here: the reader always re-reads the latest release.
-- Nothing in this file generates release evidence, activates the v2 gate, starts a trial, charges
-- or records an acceptance.
begin;

create or replace function public.stamp_customer_data_workspace_decision()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.recorded_at := clock_timestamp();
  return new;
end;
$$;
create trigger customer_data_workspace_decisions_stamp_recorded_at
  before insert on public.customer_data_workspace_decisions
  for each row execute function public.stamp_customer_data_workspace_decision();

create or replace function public.processing_terms_receipt_sha256(
  p_kind text,
  p_row public.foundation_processing_terms_acceptances
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select 'sha256:' || encode(sha256(convert_to(concat_ws('|',
    'tavonel.processing_terms_receipt.v1', p_kind, p_row.acceptance_id::text, p_row.workspace_key,
    p_row.user_id::text, p_row.authorization_revision::text, p_row.scope, p_row.terms_version,
    case p_kind when 'terms' then p_row.terms_path else p_row.processing_path end,
    case p_kind when 'terms' then p_row.terms_sha256 else p_row.processing_sha256 end
  ), 'UTF8')), 'hex');
$$;

-- Byte-identical to shared/scopedCustomerDataGate.ts workspaceGrantSha256(): every value is from a
-- restricted character set, so plain concatenation equals JSON.stringify.
create or replace function public.customer_data_workspace_grant_sha256(
  p_row public.customer_data_workspace_decisions
)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select 'sha256:' || encode(sha256(convert_to(
    '{"schemaVersion":"tavonel.customer_data_gate.v2"'
    || ',"tenantId":"' || p_row.tenant_id || '","workspaceId":"' || p_row.workspace_id
    || '","userId":"' || p_row.user_id::text || '","scope":"' || p_row.scope
    || '","releaseRevision":"' || p_row.release_revision
    || '","releaseReceiptSha256":"' || p_row.release_receipt_sha256
    || '","termsVersion":"' || p_row.terms_version
    || '","termsReceiptSha256":"' || p_row.terms_receipt_sha256
    || '","processingTermsReceiptSha256":"' || p_row.processing_terms_receipt_sha256
    || '","grantedAt":"' || to_char(p_row.granted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    || '","expiresAt":"' || to_char(p_row.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    || '"}', 'UTF8')), 'hex');
$$;

create or replace function public.customer_data_workspace_grant_receipt(
  p_row public.customer_data_workspace_decisions,
  p_replay boolean
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'tenantId', p_row.tenant_id, 'workspaceId', p_row.workspace_id, 'userId', p_row.user_id,
    'scope', p_row.scope, 'releaseRevision', p_row.release_revision,
    'releaseReceiptSha256', p_row.release_receipt_sha256, 'termsVersion', p_row.terms_version,
    'termsReceiptSha256', p_row.terms_receipt_sha256,
    'processingTermsReceiptSha256', p_row.processing_terms_receipt_sha256,
    'grantReceiptSha256', p_row.grant_receipt_sha256,
    'grantedAt', to_char(p_row.granted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt', to_char(p_row.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'idempotentReplay', p_replay
  );
$$;

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

  -- ponytail: table-wide lock serializes every grant and direct decision insert; per-workspace
  -- serialization needs direct inserts to go through an RPC first.
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
  if found and v_latest.release_revision = p_release_revision
    and v_latest.release_receipt_sha256 = p_release_receipt_sha256
    and v_latest.user_id = v_acceptance.user_id and v_latest.terms_version = p_terms_version
    and v_latest.terms_receipt_sha256 = p_terms_receipt_sha256
    and v_latest.processing_terms_receipt_sha256 = p_processing_terms_receipt_sha256
    and v_latest.granted_at <= v_now and v_latest.expires_at > v_now
    and v_latest.grant_receipt_sha256 = public.customer_data_workspace_grant_sha256(v_latest) then
    return public.customer_data_workspace_grant_receipt(v_latest, true);
  end if;

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
  if public.customer_data_workspace_grant_sha256(v_row) <> p_grant_receipt_sha256 then
    raise exception 'workspace_grant_input_invalid';
  end if;

  insert into public.customer_data_workspace_decisions (
    tenant_id, workspace_id, scope, release_revision, allowed, user_id, release_receipt_sha256,
    terms_version, terms_receipt_sha256, processing_terms_receipt_sha256, grant_receipt_sha256,
    granted_at, expires_at, operator_actor, decision_reason
  ) values (
    p_workspace_key, p_workspace_key, p_scope, p_release_revision, true, v_acceptance.user_id,
    p_release_receipt_sha256, p_terms_version, p_terms_receipt_sha256,
    p_processing_terms_receipt_sha256, p_grant_receipt_sha256, p_granted_at, p_expires_at,
    'system:processing-terms-grant',
    'issued from the current owner acceptance ' || v_acceptance.acceptance_id::text
      || ' and release receipt ' || p_release_receipt_sha256
  )
  returning * into v_row;
  return public.customer_data_workspace_grant_receipt(v_row, false);
end;
$$;

revoke all on function public.stamp_customer_data_workspace_decision(),
  public.processing_terms_receipt_sha256(text, public.foundation_processing_terms_acceptances),
  public.customer_data_workspace_grant_sha256(public.customer_data_workspace_decisions),
  public.customer_data_workspace_grant_receipt(public.customer_data_workspace_decisions, boolean),
  public.issue_customer_data_workspace_grant(text, text, text, text, uuid, text, text, text, text, text,
    text, text, timestamptz, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.issue_customer_data_workspace_grant(text, text, text, text, uuid, text, text, text, text, text,
    text, text, timestamptz, timestamptz, text)
  to service_role;

commit;
