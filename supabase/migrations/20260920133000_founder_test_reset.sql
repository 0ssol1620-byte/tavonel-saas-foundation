-- Depends on 20260920132000_legal_hold_deletion_sweeper.sql (and is ordered after
-- 20260920132100_adaptive_router_control_plane.sql).
-- Two-phase, fail-closed reset for the founder's single production test tenant.
-- Auth, billing, enterprise/audit history, the access grant, workspace and owner memberships
-- are deliberately outside the deletion set. R2 deletion is performed between seal and finalize.
begin;

create table public.founder_test_reset_ledger (
  reset_id uuid primary key default gen_random_uuid(),
  target_email text not null check (target_email = '0ssol1620@gmail.com'),
  user_id uuid not null references auth.users(id) on delete restrict,
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  state text not null check (state in ('prepared', 'sealed', 'db_finalized_pending_object_verify', 'completed', 'superseded')),
  db_manifest_digest text not null check (db_manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  manifest_digest text check (manifest_digest is null or manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  db_counts jsonb not null check (jsonb_typeof(db_counts) = 'object'),
  r2_keys jsonb check (r2_keys is null or jsonb_typeof(r2_keys) = 'array'),
  retention_override_reason text not null default 'FOUNDER_AUTHORIZED_TEST_CONTENT_RESET'
    check (retention_override_reason='FOUNDER_AUTHORIZED_TEST_CONTENT_RESET'),
  object_grace_override_days integer not null default 0 check (object_grace_override_days=0),
  audit_evidence_disposition text not null default 'ARCHIVED'
    check (audit_evidence_disposition='ARCHIVED'),
  prepared_at timestamptz not null default clock_timestamp(),
  sealed_at timestamptz,
  finalized_at timestamptz,
  completed_at timestamptz,
  check ((state in ('prepared', 'superseded')) = (manifest_digest is null)),
  check ((state in ('sealed', 'db_finalized_pending_object_verify', 'completed')) = (r2_keys is not null)),
  check ((state in ('db_finalized_pending_object_verify', 'completed')) = (finalized_at is not null)),
  check ((state = 'completed') = (completed_at is not null))
);

create table public.founder_test_reset_evidence_archive (
  reset_id uuid not null references public.founder_test_reset_ledger(reset_id) on delete restrict,
  source_table text not null check (source_table ~ '^[a-z][a-z0-9_]{2,80}$'),
  source_row_key text not null check (char_length(source_row_key) between 1 and 500),
  row_sha256 text not null check (row_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  archived_at timestamptz not null default clock_timestamp(),
  primary key (reset_id, source_table, source_row_key)
);

alter table public.founder_test_reset_ledger enable row level security;
alter table public.founder_test_reset_evidence_archive enable row level security;
revoke all on public.founder_test_reset_ledger, public.founder_test_reset_evidence_archive
  from public, anon, authenticated, service_role;
grant select on public.founder_test_reset_ledger, public.founder_test_reset_evidence_archive to service_role;

create function public.reject_founder_test_reset_evidence_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'founder_test_reset_evidence_append_only'; end; $$;
create trigger founder_test_reset_evidence_append_only before update or delete
  on public.founder_test_reset_evidence_archive for each row
  execute function public.reject_founder_test_reset_evidence_mutation();

create function public.guard_founder_test_reset_legal_hold_activation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_workspace record; v_organization uuid;
begin
  for v_organization in select distinct organization_id
                        from pg_catalog.unnest(array[
                          case when tg_op<>'INSERT' then old.organization_id end,
                          case when tg_op<>'DELETE' then new.organization_id end
                        ]) as candidate(organization_id)
                        where organization_id is not null order by organization_id loop
  for v_workspace in select workspace_key from public.enterprise_workspaces
                     where organization_id=v_organization order by workspace_key loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'tavonel.source_legal_hold.v1'||pg_catalog.chr(10)||v_workspace.workspace_key,0));
    if exists(select 1 from public.founder_test_reset_ledger
              where workspace_key=v_workspace.workspace_key
                and state in ('sealed','db_finalized_pending_object_verify')) then
      raise exception 'founder_test_reset_legal_hold_waits_for_finalize';
    end if;
  end loop;
  end loop;
  if tg_op='DELETE' then return old; end if; return new;
end; $$;
create trigger founder_test_reset_blocks_legal_hold
  before insert or update or delete on public.enterprise_governance_policies
  for each row execute function public.guard_founder_test_reset_legal_hold_activation();

create function public.guard_founder_test_reset_workspace_organization_move()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_workspace text;
begin
  if old.organization_id is not distinct from new.organization_id
     and old.workspace_key is not distinct from new.workspace_key then return new; end if;
  for v_workspace in select distinct workspace_key
                     from pg_catalog.unnest(array[old.workspace_key,new.workspace_key]) as candidate(workspace_key)
                     where workspace_key is not null order by workspace_key loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'tavonel.source_legal_hold.v1'||pg_catalog.chr(10)||v_workspace,0));
    if exists(select 1 from public.founder_test_reset_ledger
              where workspace_key=v_workspace
                and state in ('sealed','db_finalized_pending_object_verify')) then
      raise exception 'founder_test_reset_workspace_organization_change_refused';
    end if;
  end loop;
  return new;
end; $$;
create trigger founder_test_reset_blocks_workspace_organization_move
  before update of organization_id, workspace_key on public.enterprise_workspaces
  for each row execute function public.guard_founder_test_reset_workspace_organization_move();

create function public.founder_test_reset_session_allows_workspace(p_workspace text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_reset uuid;
begin
  begin v_reset:=nullif(pg_catalog.current_setting('tavonel.founder_reset_id',true),'')::uuid;
  exception when others then return false; end;
  return v_reset is not null and exists(select 1 from public.founder_test_reset_ledger
    where reset_id=v_reset and workspace_key=p_workspace and state='sealed');
end; $$;

create function public.founder_test_reset_lock_workspaces(p_old text, p_new text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_workspace text;
begin
  for v_workspace in select distinct workspace_key
                     from pg_catalog.unnest(array[p_old,p_new]) as candidate(workspace_key)
                     where workspace_key is not null order by workspace_key loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('founder-test-reset:'||v_workspace,0));
  end loop;
end; $$;

create function public.guard_founder_test_reset_workspace_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_old text; v_new text; v_blocked text;
begin
  if tg_op<>'INSERT' then v_old:=old.workspace_key; end if;
  if tg_op<>'DELETE' then v_new:=new.workspace_key; end if;
  perform public.founder_test_reset_lock_workspaces(v_old,v_new);
  select workspace_key into v_blocked from public.founder_test_reset_ledger
    where state in ('sealed','db_finalized_pending_object_verify') and workspace_key in (v_old,v_new) limit 1;
  if v_blocked is not null and not (tg_op='DELETE' and public.founder_test_reset_session_allows_workspace(v_blocked)) then
    raise exception 'founder_test_reset_write_fenced';
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end; $$;

create function public.guard_founder_test_reset_source_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_old text; v_new text; v_blocked text;
begin
  if tg_op<>'INSERT' then v_old:=old.workspace_id; end if;
  if tg_op<>'DELETE' then v_new:=new.workspace_id; end if;
  perform public.founder_test_reset_lock_workspaces(v_old,v_new);
  select workspace_key into v_blocked from public.founder_test_reset_ledger
    where state in ('sealed','db_finalized_pending_object_verify') and workspace_key in (v_old,v_new) limit 1;
  if v_blocked is not null and not (tg_op='DELETE' and public.founder_test_reset_session_allows_workspace(v_blocked)) then
    raise exception 'founder_test_reset_write_fenced';
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end; $$;

create function public.guard_founder_test_reset_legacy_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_old uuid; v_new uuid; v_old_ws text; v_new_ws text; v_blocked text;
begin
  if tg_op<>'INSERT' then v_old:=old.workspace_id; end if;
  if tg_op<>'DELETE' then v_new:=new.workspace_id; end if;
  select 'pilot-'||substring(pg_catalog.replace(owner_id::text,'-','') from 1 for 16) into v_old_ws from public.workspaces where id=v_old;
  select 'pilot-'||substring(pg_catalog.replace(owner_id::text,'-','') from 1 for 16) into v_new_ws from public.workspaces where id=v_new;
  perform public.founder_test_reset_lock_workspaces(v_old_ws,v_new_ws);
  select workspace_key into v_blocked from public.founder_test_reset_ledger
    where state in ('sealed','db_finalized_pending_object_verify') and workspace_key in (v_old_ws,v_new_ws) limit 1;
  if v_blocked is not null and not (tg_op='DELETE' and public.founder_test_reset_session_allows_workspace(v_blocked)) then
    raise exception 'founder_test_reset_write_fenced';
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end; $$;

create function public.guard_founder_test_reset_document_child_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_old uuid; v_new uuid; v_old_ws text; v_new_ws text; v_blocked text;
begin
  if tg_op<>'INSERT' then v_old:=old.document_id; end if;
  if tg_op<>'DELETE' then v_new:=new.document_id; end if;
  select 'pilot-'||substring(pg_catalog.replace(w.owner_id::text,'-','') from 1 for 16) into v_old_ws
    from public.documents d join public.workspaces w on w.id=d.workspace_id where d.id=v_old;
  select 'pilot-'||substring(pg_catalog.replace(w.owner_id::text,'-','') from 1 for 16) into v_new_ws
    from public.documents d join public.workspaces w on w.id=d.workspace_id where d.id=v_new;
  perform public.founder_test_reset_lock_workspaces(v_old_ws,v_new_ws);
  select workspace_key into v_blocked from public.founder_test_reset_ledger
    where state in ('sealed','db_finalized_pending_object_verify') and workspace_key in (v_old_ws,v_new_ws) limit 1;
  if v_blocked is not null and not (tg_op='DELETE' and public.founder_test_reset_session_allows_workspace(v_blocked)) then
    raise exception 'founder_test_reset_write_fenced';
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end; $$;

create function public.guard_founder_test_reset_source_version_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_old text; v_new text; v_old_ws text; v_new_ws text; v_blocked text;
begin
  if tg_op<>'INSERT' then v_old:=old.source_id; end if;
  if tg_op<>'DELETE' then v_new:=new.source_id; end if;
  select workspace_id into v_old_ws from public.sources where source_id=v_old;
  select workspace_id into v_new_ws from public.sources where source_id=v_new;
  perform public.founder_test_reset_lock_workspaces(v_old_ws,v_new_ws);
  select workspace_key into v_blocked from public.founder_test_reset_ledger
    where state in ('sealed','db_finalized_pending_object_verify') and workspace_key in (v_old_ws,v_new_ws) limit 1;
  if v_blocked is not null and not (tg_op='DELETE' and public.founder_test_reset_session_allows_workspace(v_blocked)) then
    raise exception 'founder_test_reset_write_fenced';
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end; $$;

create function public.guard_founder_test_reset_source_representation_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_old text; v_new text; v_old_ws text; v_new_ws text; v_blocked text;
begin
  if tg_op<>'INSERT' then v_old:=old.source_version_id; end if;
  if tg_op<>'DELETE' then v_new:=new.source_version_id; end if;
  select s.workspace_id into v_old_ws from public.source_versions sv join public.sources s on s.source_id=sv.source_id where sv.source_version_id=v_old;
  select s.workspace_id into v_new_ws from public.source_versions sv join public.sources s on s.source_id=sv.source_id where sv.source_version_id=v_new;
  perform public.founder_test_reset_lock_workspaces(v_old_ws,v_new_ws);
  select workspace_key into v_blocked from public.founder_test_reset_ledger
    where state in ('sealed','db_finalized_pending_object_verify') and workspace_key in (v_old_ws,v_new_ws) limit 1;
  if v_blocked is not null and not (tg_op='DELETE' and public.founder_test_reset_session_allows_workspace(v_blocked)) then
    raise exception 'founder_test_reset_write_fenced';
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end; $$;

create function public.guard_founder_test_reset_tenant_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_old text; v_new text; v_blocked text;
begin
  if tg_op<>'INSERT' then v_old:=old.tenant_id; end if;
  if tg_op<>'DELETE' then v_new:=new.tenant_id; end if;
  perform public.founder_test_reset_lock_workspaces(v_old,v_new);
  select workspace_key into v_blocked from public.founder_test_reset_ledger
    where state in ('sealed','db_finalized_pending_object_verify') and workspace_key in (v_old,v_new) limit 1;
  if v_blocked is not null then raise exception 'founder_test_reset_write_fenced'; end if;
  if tg_op='DELETE' then return old; end if; return new;
end; $$;

create function public.guard_founder_test_reset_oauth_envelope_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_workspace text; v_workspaces text[]; v_old_ref text; v_new_ref text;
begin
  if tg_op<>'INSERT' then v_old_ref:='vercel://oauth/'||old.secret_id::text; end if;
  if tg_op<>'DELETE' then v_new_ref:='vercel://oauth/'||new.secret_id::text; end if;
  select pg_catalog.array_agg(distinct workspace_key order by workspace_key) into v_workspaces from (
    select workspace_key from public.foundation_oauth_connections
      where client_secret_reference in (v_old_ref,v_new_ref) or refresh_token_reference in (v_old_ref,v_new_ref)
    union all select workspace_key from public.foundation_oauth_authorizations
      where pkce_verifier_reference in (v_old_ref,v_new_ref)
  ) refs;
  foreach v_workspace in array coalesce(v_workspaces,'{}'::text[]) loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('founder-test-reset:'||v_workspace,0));
  end loop;
  if exists(select 1 from public.founder_test_reset_ledger
            where state in ('sealed','db_finalized_pending_object_verify')
              and workspace_key=any(coalesce(v_workspaces,'{}'::text[]))
              and not (tg_op='DELETE' and public.founder_test_reset_session_allows_workspace(workspace_key))) then
    raise exception 'founder_test_reset_write_fenced';
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end; $$;

create function public.guard_founder_test_reset_oauth_reference_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_old jsonb:='{}'::jsonb; v_new jsonb:='{}'::jsonb; v_workspaces text[]; v_workspace text;
begin
  if tg_op<>'INSERT' then v_old:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then v_new:=to_jsonb(new); end if;
  with changed_refs(secret_reference) as (
    select distinct secret_reference from (values
      (v_old->>'client_secret_reference'),(v_old->>'refresh_token_reference'),(v_old->>'pkce_verifier_reference'),
      (v_new->>'client_secret_reference'),(v_new->>'refresh_token_reference'),(v_new->>'pkce_verifier_reference')
    ) refs(secret_reference) where secret_reference is not null
  ), affected(workspace_key) as (
    values (v_old->>'workspace_key'),(v_new->>'workspace_key')
    union select c.workspace_key from public.foundation_oauth_connections c join changed_refs r
      on c.client_secret_reference=r.secret_reference or c.refresh_token_reference=r.secret_reference
    union select a.workspace_key from public.foundation_oauth_authorizations a join changed_refs r
      on a.pkce_verifier_reference=r.secret_reference
  ) select pg_catalog.array_agg(distinct workspace_key order by workspace_key) into v_workspaces
      from affected where workspace_key is not null;
  foreach v_workspace in array coalesce(v_workspaces,'{}'::text[]) loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('founder-test-reset:'||v_workspace,0));
  end loop;
  if exists(select 1 from public.founder_test_reset_ledger
            where state in ('sealed','db_finalized_pending_object_verify')
              and workspace_key=any(coalesce(v_workspaces,'{}'::text[]))
              and not (tg_op='DELETE' and public.founder_test_reset_session_allows_workspace(workspace_key))) then
    raise exception 'founder_test_reset_write_fenced';
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end; $$;

-- These are the roots through which new customer content can enter while R2 is being purged.
create trigger founder_reset_fence_intake before insert or update or delete on public.foundation_intake_admissions
  for each row execute function public.guard_founder_test_reset_workspace_write();
create trigger founder_reset_fence_jobs before insert or update or delete on public.foundation_jobs
  for each row execute function public.guard_founder_test_reset_workspace_write();
create trigger founder_reset_fence_compile_jobs before insert or update or delete on public.foundation_compile_jobs
  for each row execute function public.guard_founder_test_reset_workspace_write();
create trigger founder_reset_fence_connections before insert or update or delete on public.foundation_connections
  for each row execute function public.guard_founder_test_reset_workspace_write();
create trigger founder_reset_fence_oauth_authorizations before insert or update or delete on public.foundation_oauth_authorizations
  for each row execute function public.guard_founder_test_reset_oauth_reference_write();
create trigger founder_reset_fence_oauth_connections before insert or update or delete on public.foundation_oauth_connections
  for each row execute function public.guard_founder_test_reset_oauth_reference_write();
create trigger founder_reset_fence_sources before insert or update or delete on public.sources
  for each row execute function public.guard_founder_test_reset_source_write();
create trigger founder_reset_fence_documents before insert or update or delete on public.documents
  for each row execute function public.guard_founder_test_reset_legacy_write();
create trigger founder_reset_fence_candidates before insert or update or delete on public.knowledge_graph_candidates
  for each row execute function public.guard_founder_test_reset_legacy_write();
create trigger founder_reset_fence_gpu_reservations before insert or update or delete on public.gpu_job_reservations
  for each row execute function public.guard_founder_test_reset_legacy_write();
create trigger founder_reset_fence_sanitization_proofs before insert or update or delete on public.sanitization_proofs
  for each row execute function public.guard_founder_test_reset_document_child_write();
create trigger founder_reset_fence_source_versions before insert or update or delete on public.source_versions
  for each row execute function public.guard_founder_test_reset_source_version_write();
create trigger founder_reset_fence_source_representations before insert or update or delete on public.source_representations
  for each row execute function public.guard_founder_test_reset_source_representation_write();
create trigger founder_reset_fence_source_acl before insert or update or delete on public.source_acl_snapshots
  for each row execute function public.guard_founder_test_reset_source_representation_write();

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'foundation_trial_source_digests','foundation_compile_job_events','foundation_job_events',
    'foundation_connector_page_snapshots','foundation_connector_checkpoints','foundation_review_decisions',
    'foundation_retrieval_profiles','foundation_retrieval_compile_runs','foundation_retrieval_units',
    'foundation_retrieval_embeddings','foundation_world_versions','foundation_active_worlds',
    'foundation_world_events','foundation_world_transition_receipts','connector_document_bindings',
    'connector_source_suspensions','source_deletion_tombstones','source_deletion_objects',
    'source_deletion_receipts','source_deletion_inventory_attestations','foundation_connection_batches',
    'foundation_operation_leases','foundation_compute_reservations'
  ] loop
    execute pg_catalog.format('create trigger founder_reset_fence before insert or update or delete on public.%I for each row execute function public.guard_founder_test_reset_workspace_write()',v_table);
  end loop;
end $$;

create trigger founder_reset_fence_model_provider_reservations
  before insert or update or delete on public.model_provider_spend_reservations
  for each row execute function public.guard_founder_test_reset_tenant_write();
create trigger founder_reset_fence_oauth_secret_envelopes
  before insert or update or delete on public.foundation_oauth_secret_envelopes
  for each row execute function public.guard_founder_test_reset_oauth_envelope_write();

create function public.founder_test_reset_assertions(
  p_email text, p_user_id uuid, p_workspace_key text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_legacy uuid; v_expected text;
begin
  v_expected := 'pilot-' || substring(pg_catalog.replace(p_user_id::text, '-', '') from 1 for 16);
  if p_email is distinct from '0ssol1620@gmail.com' or p_workspace_key is distinct from v_expected then
    raise exception 'founder_test_reset_target_invalid';
  end if;
  -- Share the write-fence lock domain before checking live work. A compile writer that won the
  -- lock must commit before this check, and a writer that lost it cannot race the reset state.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('founder-test-reset:'||p_workspace_key,0));
  if (select count(*) from auth.users where id=p_user_id and lower(email)=p_email) <> 1 then
    raise exception 'founder_test_reset_auth_identity_mismatch';
  end if;
  if (select count(*) from public.foundation_account_access_grants
      where user_id=p_user_id and grant_kind='owner' and active and access_plan='studio_access') <> 1 then
    raise exception 'founder_test_reset_active_owner_grant_required';
  end if;
  if (select count(*) from public.foundation_workspaces where workspace_key=p_workspace_key and created_by=p_user_id) <> 1
     or (select count(*) from public.foundation_workspace_members
         where workspace_key=p_workspace_key and user_id=p_user_id and role='owner' and state='active') <> 1
     or (select count(*) from public.foundation_workspace_members
         where workspace_key=p_workspace_key and role='owner' and state='active') <> 1 then
    raise exception 'founder_test_reset_foundation_owner_mismatch';
  end if;
  select ew.organization_id into v_org from public.enterprise_workspaces ew
   join public.enterprise_workspace_memberships ewm on ewm.workspace_key=ew.workspace_key
   join public.enterprise_organization_memberships eom on eom.organization_id=ew.organization_id
   where ew.workspace_key=p_workspace_key and ewm.user_id=p_user_id and ewm.role='owner'
     and eom.user_id=p_user_id and eom.role='owner';
  if v_org is null then raise exception 'founder_test_reset_enterprise_owner_mismatch'; end if;
  -- Exact lock domain shared with guard_legal_hold_against_source_deletion in 20260920132000.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'tavonel.source_legal_hold.v1'||pg_catalog.chr(10)||p_workspace_key,0));
  if (select count(*) from public.enterprise_governance_policies where organization_id=v_org) <> 1 then
    raise exception 'founder_test_reset_legal_hold_state_invalid';
  end if;
  if exists(select 1 from public.enterprise_governance_policies
             where organization_id=v_org and legal_hold_enabled) then
    raise exception 'founder_test_reset_legal_hold_active';
  end if;
  -- Every non-terminal compile is active regardless of heartbeat age. Lock the matching rows so
  -- they cannot transition underneath the assertion before the caller seals/finalizes the reset.
  perform 1 from public.foundation_compile_jobs
    where workspace_key=p_workspace_key
      and state not in ('ready','failed','cancelled')
    for update;
  if found then raise exception 'founder_test_reset_active_work_refused'; end if;
  if exists(select 1 from public.foundation_operation_leases
             where workspace_key=p_workspace_key and state='running' and expires_at>clock_timestamp())
     or exists(select 1 from public.foundation_jobs
             where workspace_key=p_workspace_key and state in ('queued','leased'))
     or exists(select 1 from public.foundation_intake_admissions
             where workspace_key=p_workspace_key and expires_at>clock_timestamp())
     or exists(select 1 from public.foundation_retrieval_compile_runs
            where workspace_key=p_workspace_key and status in ('pending','running'))
     or exists(select 1 from public.foundation_compute_reservations
            where workspace_key=p_workspace_key and state='reserved' and expires_at>clock_timestamp())
     or exists(select 1 from public.gpu_job_reservations
            where workspace_id in (select id from public.workspaces where owner_id=p_user_id)
              and state in ('reserved','dispatched'))
     or exists(select 1 from public.model_provider_spend_reservations
            where tenant_id=p_workspace_key and state in ('queued','reserved')) then
    raise exception 'founder_test_reset_active_work_refused';
  end if;
  select id into v_legacy from public.workspaces where owner_id=p_user_id;
  if v_legacy is null or (select count(*) from public.workspaces where owner_id=p_user_id) <> 1
     or not exists(select 1 from public.workspace_memberships
                   where workspace_id=v_legacy and user_id=p_user_id and role='owner') then
    raise exception 'founder_test_reset_legacy_owner_mismatch';
  end if;
  return v_legacy;
end; $$;

create function public.founder_test_reset_orphan_oauth_secret_ids(p_workspace_key text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  with target_ids(secret_id) as (
    select substring(client_secret_reference from '([0-9a-fA-F-]{36})$')::uuid
      from public.foundation_oauth_connections
      where workspace_key=p_workspace_key and client_secret_reference like 'vercel://oauth/%'
    union select substring(refresh_token_reference from '([0-9a-fA-F-]{36})$')::uuid
      from public.foundation_oauth_connections
      where workspace_key=p_workspace_key and refresh_token_reference like 'vercel://oauth/%'
    union select substring(pkce_verifier_reference from '([0-9a-fA-F-]{36})$')::uuid
      from public.foundation_oauth_authorizations
      where workspace_key=p_workspace_key and pkce_verifier_reference like 'vercel://oauth/%'
  )
  select e.secret_id from public.foundation_oauth_secret_envelopes e join target_ids t using(secret_id)
   where not exists(select 1 from public.foundation_oauth_connections c
     where c.workspace_key<>p_workspace_key and (
       c.client_secret_reference='vercel://oauth/'||e.secret_id::text
       or c.refresh_token_reference='vercel://oauth/'||e.secret_id::text))
     and not exists(select 1 from public.foundation_oauth_authorizations a
       where a.workspace_key<>p_workspace_key
         and a.pkce_verifier_reference='vercel://oauth/'||e.secret_id::text);
$$;

create function public.founder_test_reset_rows_fingerprint(p_workspace_key text, p_legacy_workspace_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select 'sha256:' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    coalesce(pg_catalog.string_agg(q.table_name || ':' || q.row_value, E'\n'
      order by q.table_name, q.row_value), ''), 'UTF8'), 'sha256'), 'hex')
  from (
    select 'documents' table_name, to_jsonb(x)::text row_value from public.documents x where workspace_id=p_legacy_workspace_id
    union all select 'gpu_job_reservations',to_jsonb(x)::text from public.gpu_job_reservations x where workspace_id=p_legacy_workspace_id
    union all select 'sanitization_proofs',to_jsonb(x)::text from public.sanitization_proofs x where document_id in (select id from public.documents where workspace_id=p_legacy_workspace_id)
    union all select 'knowledge_graph_candidates',to_jsonb(x)::text from public.knowledge_graph_candidates x where workspace_id=p_legacy_workspace_id
    union all select 'foundation_intake_admissions',to_jsonb(x)::text from public.foundation_intake_admissions x where workspace_key=p_workspace_key
    union all select 'foundation_trial_source_digests',to_jsonb(x)::text from public.foundation_trial_source_digests x where workspace_key=p_workspace_key
    union all select 'foundation_compile_jobs',to_jsonb(x)::text from public.foundation_compile_jobs x where workspace_key=p_workspace_key
    union all select 'foundation_compile_job_events',to_jsonb(x)::text from public.foundation_compile_job_events x where workspace_key=p_workspace_key
    union all select 'foundation_jobs',to_jsonb(x)::text from public.foundation_jobs x where workspace_key=p_workspace_key
    union all select 'foundation_job_events',to_jsonb(x)::text from public.foundation_job_events x where workspace_key=p_workspace_key
    union all select 'foundation_connector_page_snapshots',to_jsonb(x)::text from public.foundation_connector_page_snapshots x where workspace_key=p_workspace_key
    union all select 'foundation_connector_checkpoints',to_jsonb(x)::text from public.foundation_connector_checkpoints x where workspace_key=p_workspace_key
    union all select 'foundation_review_decisions',to_jsonb(x)::text from public.foundation_review_decisions x where workspace_key=p_workspace_key
    union all select 'foundation_retrieval_profiles',to_jsonb(x)::text from public.foundation_retrieval_profiles x where workspace_key=p_workspace_key
    union all select 'foundation_retrieval_compile_runs',to_jsonb(x)::text from public.foundation_retrieval_compile_runs x where workspace_key=p_workspace_key
    union all select 'foundation_retrieval_units',to_jsonb(x)::text from public.foundation_retrieval_units x where workspace_key=p_workspace_key
    union all select 'foundation_retrieval_embeddings',to_jsonb(x)::text from public.foundation_retrieval_embeddings x where workspace_key=p_workspace_key
    union all select 'foundation_world_versions',to_jsonb(x)::text from public.foundation_world_versions x where workspace_key=p_workspace_key
    union all select 'foundation_active_worlds',to_jsonb(x)::text from public.foundation_active_worlds x where workspace_key=p_workspace_key
    union all select 'foundation_world_events',to_jsonb(x)::text from public.foundation_world_events x where workspace_key=p_workspace_key
    union all select 'foundation_world_transition_receipts',to_jsonb(x)::text from public.foundation_world_transition_receipts x where workspace_key=p_workspace_key
    union all select 'connector_document_bindings',to_jsonb(x)::text from public.connector_document_bindings x where workspace_key=p_workspace_key
    union all select 'connector_source_suspensions',to_jsonb(x)::text from public.connector_source_suspensions x where workspace_key=p_workspace_key
    union all select 'sources',to_jsonb(x)::text from public.sources x where workspace_id=p_workspace_key
    union all select 'source_versions',to_jsonb(x)::text from public.source_versions x where source_id in (select source_id from public.sources where workspace_id=p_workspace_key)
    union all select 'source_representations',to_jsonb(x)::text from public.source_representations x where source_version_id in
      (select sv.source_version_id from public.source_versions sv join public.sources s on s.source_id=sv.source_id where s.workspace_id=p_workspace_key)
    union all select 'source_acl_snapshots',to_jsonb(x)::text from public.source_acl_snapshots x where source_version_id in
      (select sv.source_version_id from public.source_versions sv join public.sources s on s.source_id=sv.source_id where s.workspace_id=p_workspace_key)
    union all select 'source_deletion_tombstones',to_jsonb(x)::text from public.source_deletion_tombstones x where workspace_key=p_workspace_key
    union all select 'source_deletion_objects',to_jsonb(x)::text from public.source_deletion_objects x where workspace_key=p_workspace_key
    union all select 'source_deletion_receipts',to_jsonb(x)::text from public.source_deletion_receipts x where workspace_key=p_workspace_key
    union all select 'source_deletion_inventory_attestations',to_jsonb(x)::text from public.source_deletion_inventory_attestations x where workspace_key=p_workspace_key
    union all select 'foundation_connections',to_jsonb(x)::text from public.foundation_connections x where workspace_key=p_workspace_key
    union all select 'foundation_connection_batches',to_jsonb(x)::text from public.foundation_connection_batches x where workspace_key=p_workspace_key
    union all select 'foundation_oauth_authorizations',to_jsonb(x)::text from public.foundation_oauth_authorizations x where workspace_key=p_workspace_key
    union all select 'foundation_oauth_connections',to_jsonb(x)::text from public.foundation_oauth_connections x where workspace_key=p_workspace_key
    union all select 'foundation_oauth_secret_envelopes',to_jsonb(x)::text from public.foundation_oauth_secret_envelopes x
      where x.secret_id in (select public.founder_test_reset_orphan_oauth_secret_ids(p_workspace_key))
  ) q;
$$;

create function public.founder_test_reset_table_counts(p_workspace_key text, p_legacy_workspace_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with target_versions as (
    select sv.source_version_id from public.source_versions sv join public.sources s on s.source_id=sv.source_id where s.workspace_id=p_workspace_key
  ), counts(name,n) as (
    select 'documents',count(*) from public.documents where workspace_id=p_legacy_workspace_id
    union all select 'sanitization_proofs',count(*) from public.sanitization_proofs where document_id in (select id from public.documents where workspace_id=p_legacy_workspace_id)
    union all select 'knowledge_graph_candidates',count(*) from public.knowledge_graph_candidates where workspace_id=p_legacy_workspace_id
    union all select 'gpu_job_reservations',count(*) from public.gpu_job_reservations where workspace_id=p_legacy_workspace_id
    union all select 'foundation_intake_admissions',count(*) from public.foundation_intake_admissions where workspace_key=p_workspace_key
    union all select 'foundation_trial_source_digests',count(*) from public.foundation_trial_source_digests where workspace_key=p_workspace_key
    union all select 'foundation_compile_jobs',count(*) from public.foundation_compile_jobs where workspace_key=p_workspace_key
    union all select 'foundation_compile_job_events',count(*) from public.foundation_compile_job_events where workspace_key=p_workspace_key
    union all select 'foundation_jobs',count(*) from public.foundation_jobs where workspace_key=p_workspace_key
    union all select 'foundation_job_events',count(*) from public.foundation_job_events where workspace_key=p_workspace_key
    union all select 'foundation_connector_page_snapshots',count(*) from public.foundation_connector_page_snapshots where workspace_key=p_workspace_key
    union all select 'foundation_connector_checkpoints',count(*) from public.foundation_connector_checkpoints where workspace_key=p_workspace_key
    union all select 'foundation_review_decisions',count(*) from public.foundation_review_decisions where workspace_key=p_workspace_key
    union all select 'foundation_retrieval_profiles',count(*) from public.foundation_retrieval_profiles where workspace_key=p_workspace_key
    union all select 'foundation_retrieval_compile_runs',count(*) from public.foundation_retrieval_compile_runs where workspace_key=p_workspace_key
    union all select 'foundation_retrieval_units',count(*) from public.foundation_retrieval_units where workspace_key=p_workspace_key
    union all select 'foundation_retrieval_embeddings',count(*) from public.foundation_retrieval_embeddings where workspace_key=p_workspace_key
    union all select 'foundation_world_versions',count(*) from public.foundation_world_versions where workspace_key=p_workspace_key
    union all select 'foundation_active_worlds',count(*) from public.foundation_active_worlds where workspace_key=p_workspace_key
    union all select 'foundation_world_events',count(*) from public.foundation_world_events where workspace_key=p_workspace_key
    union all select 'foundation_world_transition_receipts',count(*) from public.foundation_world_transition_receipts where workspace_key=p_workspace_key
    union all select 'connector_document_bindings',count(*) from public.connector_document_bindings where workspace_key=p_workspace_key
    union all select 'connector_source_suspensions',count(*) from public.connector_source_suspensions where workspace_key=p_workspace_key
    union all select 'sources',count(*) from public.sources where workspace_id=p_workspace_key
    union all select 'source_versions',count(*) from public.source_versions where source_version_id in (select source_version_id from target_versions)
    union all select 'source_representations',count(*) from public.source_representations where source_version_id in (select source_version_id from target_versions)
    union all select 'source_acl_snapshots',count(*) from public.source_acl_snapshots where source_version_id in (select source_version_id from target_versions)
    union all select 'source_deletion_tombstones',count(*) from public.source_deletion_tombstones where workspace_key=p_workspace_key
    union all select 'source_deletion_objects',count(*) from public.source_deletion_objects where workspace_key=p_workspace_key
    union all select 'source_deletion_receipts',count(*) from public.source_deletion_receipts where workspace_key=p_workspace_key
    union all select 'source_deletion_inventory_attestations',count(*) from public.source_deletion_inventory_attestations where workspace_key=p_workspace_key
    union all select 'foundation_connections',count(*) from public.foundation_connections where workspace_key=p_workspace_key
    union all select 'foundation_connection_batches',count(*) from public.foundation_connection_batches where workspace_key=p_workspace_key
    union all select 'foundation_oauth_authorizations',count(*) from public.foundation_oauth_authorizations where workspace_key=p_workspace_key
    union all select 'foundation_oauth_connections',count(*) from public.foundation_oauth_connections where workspace_key=p_workspace_key
    union all select 'foundation_oauth_secret_envelopes',count(*) from public.foundation_oauth_secret_envelopes
      where secret_id in (select public.founder_test_reset_orphan_oauth_secret_ids(p_workspace_key))
  ) select coalesce(jsonb_object_agg(name,n),'{}'::jsonb) from counts;
$$;

-- Archive admission and append-only trigger exceptions must agree on the exact
-- JSONB canonicalization and digest representation. Keeping that rule in one
-- immutable function prevents a future edit from making an archived row
-- undeletable or, worse, admitting a different row with a look-alike key.
create function public.founder_test_reset_row_sha256(p_payload jsonb)
returns text language sql immutable security definer set search_path = '' as $$
  select 'sha256:' || pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );
$$;

create function public.archive_founder_test_reset_evidence(
  p_reset_id uuid, p_workspace_key text, p_legacy_workspace_id uuid
) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_count bigint;
begin
  with evidence(source_table,source_row_key,payload) as (
    select 'gpu_job_reservations',x.id::text,to_jsonb(x) from public.gpu_job_reservations x where workspace_id=p_legacy_workspace_id
    union all select 'foundation_job_events',x.job_id||':'||x.event_sequence,to_jsonb(x) from public.foundation_job_events x where workspace_key=p_workspace_key
    union all select 'foundation_compile_job_events',x.job_id||':'||x.event_sequence,to_jsonb(x) from public.foundation_compile_job_events x where workspace_key=p_workspace_key
    union all select 'foundation_world_events',x.event_id::text,to_jsonb(x) from public.foundation_world_events x where workspace_key=p_workspace_key
    union all select 'foundation_world_transition_receipts',x.operation_id::text,to_jsonb(x) from public.foundation_world_transition_receipts x where workspace_key=p_workspace_key
    union all select 'foundation_review_decisions',x.decision_id::text,to_jsonb(x) from public.foundation_review_decisions x where workspace_key=p_workspace_key
    union all select 'source_deletion_tombstones',x.deletion_id,to_jsonb(x) from public.source_deletion_tombstones x where workspace_key=p_workspace_key
    union all select 'source_deletion_objects',x.deletion_id||':sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(x.object_key,'UTF8'),'sha256'),'hex'),to_jsonb(x) from public.source_deletion_objects x where workspace_key=p_workspace_key
    union all select 'source_deletion_receipts',x.receipt_id::text,to_jsonb(x) from public.source_deletion_receipts x where workspace_key=p_workspace_key
    union all select 'source_deletion_inventory_attestations',x.deletion_id,to_jsonb(x) from public.source_deletion_inventory_attestations x where workspace_key=p_workspace_key
    union all select 'connector_document_bindings',x.source_version_id,to_jsonb(x) from public.connector_document_bindings x where workspace_key=p_workspace_key
    union all select 'connector_source_suspensions',x.source_id,to_jsonb(x) from public.connector_source_suspensions x where workspace_key=p_workspace_key
  )
  insert into public.founder_test_reset_evidence_archive(reset_id,source_table,source_row_key,row_sha256,payload)
  select p_reset_id,source_table,source_row_key,
    public.founder_test_reset_row_sha256(payload),payload
    from evidence on conflict (reset_id,source_table,source_row_key) do nothing;
  get diagnostics v_count=row_count;
  return v_count;
end; $$;

create function public.founder_test_reset_archive_allows_delete(p_source_table text, p_old jsonb)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_reset_id uuid; v_sha text;
begin
  begin
    v_reset_id := nullif(pg_catalog.current_setting('tavonel.founder_reset_id',true),'')::uuid;
  exception when others then return false;
  end;
  if v_reset_id is null then return false; end if;
  v_sha := public.founder_test_reset_row_sha256(p_old);
  return exists(select 1 from public.founder_test_reset_ledger l
    join public.founder_test_reset_evidence_archive a on a.reset_id=l.reset_id
    where l.reset_id=v_reset_id and l.state='sealed' and a.source_table=p_source_table
      and a.row_sha256=v_sha and a.payload=p_old);
end; $$;

create or replace function public.reject_foundation_job_event_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' and public.founder_test_reset_archive_allows_delete(tg_table_name,to_jsonb(old)) then return old; end if;
  raise exception 'foundation_job_events is append-only';
end; $$;

create or replace function public.reject_foundation_compile_event_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' and public.founder_test_reset_archive_allows_delete(tg_table_name,to_jsonb(old)) then return old; end if;
  raise exception 'foundation_compile_job_events is append-only';
end; $$;

create or replace function public.prevent_foundation_world_transition_receipt_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' and public.founder_test_reset_archive_allows_delete(tg_table_name,to_jsonb(old)) then return old; end if;
  raise exception 'foundation_world_transition_receipts_append_only';
end; $$;

create or replace function public.prevent_source_deletion_evidence_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' and public.founder_test_reset_archive_allows_delete(tg_table_name,to_jsonb(old)) then return old; end if;
  raise exception 'source_deletion_evidence_append_only';
end; $$;

create or replace function public.guard_connector_document_binding()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' and public.founder_test_reset_archive_allows_delete(tg_table_name,to_jsonb(old)) then return old; end if;
  if tg_op<>'INSERT' then raise exception 'CONNECTOR_BINDING_IMMUTABLE'; end if;
  perform 1 from public.foundation_oauth_connections where oauth_connection_id=new.oauth_connection_id
    and workspace_key=new.workspace_key and provider=new.provider and status='active' for share;
  if not found then raise exception 'CONNECTOR_BINDING_CONNECTION_INVALID'; end if;
  return new;
end; $$;

create or replace function public.guard_connector_source_suspension()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' and public.founder_test_reset_archive_allows_delete(tg_table_name,to_jsonb(old)) then return old; end if;
  if tg_op<>'INSERT' then raise exception 'CONNECTOR_SUSPENSION_IMMUTABLE'; end if;
  perform 1 from public.connector_document_bindings where source_id=new.source_id and workspace_key=new.workspace_key;
  if not found then raise exception 'CONNECTOR_SUSPENSION_UNBOUND'; end if;
  return new;
end; $$;

create function public.founder_test_reset_snapshot(p_workspace_key text, p_legacy_workspace_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.founder_test_reset_table_counts(p_workspace_key,p_legacy_workspace_id)
    || pg_catalog.jsonb_build_object('rowFingerprint',
      public.founder_test_reset_rows_fingerprint(p_workspace_key,p_legacy_workspace_id));
$$;

create function public.prepare_founder_test_reset(p_email text, p_user_id uuid, p_workspace_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_legacy uuid; v_snapshot jsonb; v_digest text; v_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('founder-test-reset:'||p_workspace_key,0));
  if exists(select 1 from public.founder_test_reset_ledger
            where workspace_key=p_workspace_key
              and state in ('sealed','db_finalized_pending_object_verify')) then
    raise exception 'founder_test_reset_already_in_progress';
  end if;
  v_legacy := public.founder_test_reset_assertions(p_email,p_user_id,p_workspace_key);
  v_snapshot := public.founder_test_reset_snapshot(p_workspace_key,v_legacy);
  v_digest := 'sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');
  update public.founder_test_reset_ledger set state='superseded'
   where workspace_key=p_workspace_key and state='prepared';
  insert into public.founder_test_reset_ledger(target_email,user_id,workspace_key,db_manifest_digest,db_counts)
   values(p_email,p_user_id,p_workspace_key,v_digest,v_snapshot-'rowFingerprint') returning reset_id into v_id;
  return pg_catalog.jsonb_build_object('resetId',v_id,'dbManifestDigest',v_digest,
    'dbCounts',v_snapshot-'rowFingerprint');
end; $$;

create function public.seal_founder_test_reset(
  p_reset_id uuid, p_email text, p_user_id uuid, p_workspace_key text,
  p_db_manifest_digest text, p_manifest_digest text, p_r2_keys jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_reset public.founder_test_reset_ledger%rowtype; v_legacy uuid; v_snapshot jsonb; v_digest text; v_key text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('founder-test-reset:'||p_workspace_key,0));
  v_legacy := public.founder_test_reset_assertions(p_email,p_user_id,p_workspace_key);
  select * into v_reset from public.founder_test_reset_ledger where reset_id=p_reset_id for update;
  if not found or v_reset.state<>'prepared' or v_reset.user_id<>p_user_id
     or v_reset.workspace_key<>p_workspace_key or v_reset.db_manifest_digest<>p_db_manifest_digest then
    raise exception 'founder_test_reset_prepare_mismatch';
  end if;
  if p_manifest_digest !~ '^sha256:[a-f0-9]{64}$' or jsonb_typeof(p_r2_keys)<>'array'
     or jsonb_array_length(p_r2_keys)>1000 then raise exception 'founder_test_reset_manifest_invalid'; end if;
  for v_key in select jsonb_array_elements_text(p_r2_keys) loop
    if v_key !~ ('^(quarantine/'||p_workspace_key||'/|immutable/'||p_workspace_key||'/'||p_workspace_key||'/)')
       or v_key like '%..%' or v_key like '%\\%' or v_key like '%//%' then
      raise exception 'founder_test_reset_r2_key_outside_workspace';
    end if;
  end loop;
  v_snapshot:=public.founder_test_reset_snapshot(p_workspace_key,v_legacy);
  v_digest:='sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');
  if v_digest<>p_db_manifest_digest then raise exception 'founder_test_reset_database_drift'; end if;
  update public.founder_test_reset_ledger set state='sealed',manifest_digest=p_manifest_digest,
    r2_keys=p_r2_keys,sealed_at=clock_timestamp() where reset_id=p_reset_id;
  return jsonb_build_object('status','sealed','objectCount',jsonb_array_length(p_r2_keys));
end; $$;

create function public.inspect_founder_test_reset(
  p_reset_id uuid, p_email text, p_user_id uuid, p_workspace_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_reset public.founder_test_reset_ledger%rowtype;
begin
  perform public.founder_test_reset_assertions(p_email,p_user_id,p_workspace_key);
  select * into v_reset from public.founder_test_reset_ledger
    where reset_id=p_reset_id and user_id=p_user_id and workspace_key=p_workspace_key;
  if not found or v_reset.state not in ('prepared','sealed','db_finalized_pending_object_verify','completed') then
    raise exception 'founder_test_reset_prepare_mismatch';
  end if;
  return jsonb_build_object('resetId',v_reset.reset_id,'state',v_reset.state,
    'dbManifestDigest',v_reset.db_manifest_digest,'dbCounts',v_reset.db_counts,
    'manifestDigest',v_reset.manifest_digest,'r2Keys',v_reset.r2_keys);
end; $$;

create function public.finalize_founder_test_reset(
  p_reset_id uuid, p_email text, p_user_id uuid, p_workspace_key text, p_manifest_digest text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_reset public.founder_test_reset_ledger%rowtype; v_legacy uuid; v_snapshot jsonb; v_digest text; v_oauth_ids uuid[];
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('founder-test-reset:'||p_workspace_key,0));
  v_legacy:=public.founder_test_reset_assertions(p_email,p_user_id,p_workspace_key);
  select * into v_reset from public.founder_test_reset_ledger where reset_id=p_reset_id for update;
  if not found or v_reset.state<>'sealed' or v_reset.user_id<>p_user_id
     or v_reset.workspace_key<>p_workspace_key or v_reset.manifest_digest<>p_manifest_digest then
    raise exception 'founder_test_reset_seal_mismatch';
  end if;
  v_snapshot:=public.founder_test_reset_snapshot(p_workspace_key,v_legacy);
  v_digest:='sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');
  if v_digest<>v_reset.db_manifest_digest then raise exception 'founder_test_reset_database_drift'; end if;

  perform public.archive_founder_test_reset_evidence(p_reset_id,p_workspace_key,v_legacy);

  select array_agg(distinct id) into v_oauth_ids from (
    select substring(client_secret_reference from '([0-9a-fA-F-]{36})$')::uuid id
      from public.foundation_oauth_connections where workspace_key=p_workspace_key and client_secret_reference like 'vercel://oauth/%'
    union all select substring(refresh_token_reference from '([0-9a-fA-F-]{36})$')::uuid
      from public.foundation_oauth_connections where workspace_key=p_workspace_key and refresh_token_reference like 'vercel://oauth/%'
    union all select substring(pkce_verifier_reference from '([0-9a-fA-F-]{36})$')::uuid
      from public.foundation_oauth_authorizations where workspace_key=p_workspace_key and pkce_verifier_reference like 'vercel://oauth/%'
  ) s where id is not null;
  perform pg_catalog.set_config('tavonel.founder_reset_id',p_reset_id::text,true);

  delete from public.source_deletion_receipts where workspace_key=p_workspace_key;
  delete from public.source_deletion_inventory_attestations where workspace_key=p_workspace_key;
  delete from public.source_deletion_objects where workspace_key=p_workspace_key;
  delete from public.source_deletion_tombstones where workspace_key=p_workspace_key;
  delete from public.foundation_connector_page_snapshots where workspace_key=p_workspace_key;
  delete from public.foundation_connector_checkpoints where workspace_key=p_workspace_key;
  delete from public.foundation_job_events where workspace_key=p_workspace_key;
  delete from public.foundation_jobs where workspace_key=p_workspace_key;
  delete from public.foundation_compile_job_events where workspace_key=p_workspace_key;
  delete from public.foundation_compile_jobs where workspace_key=p_workspace_key;
  delete from public.foundation_review_decisions where workspace_key=p_workspace_key;
  delete from public.foundation_retrieval_embeddings where workspace_key=p_workspace_key;
  delete from public.foundation_retrieval_units where workspace_key=p_workspace_key;
  delete from public.foundation_retrieval_compile_runs where workspace_key=p_workspace_key;
  delete from public.foundation_retrieval_profiles where workspace_key=p_workspace_key;
  delete from public.foundation_active_worlds where workspace_key=p_workspace_key;
  delete from public.foundation_world_transition_receipts where workspace_key=p_workspace_key;
  delete from public.foundation_world_events where workspace_key=p_workspace_key;
  delete from public.foundation_world_versions where workspace_key=p_workspace_key;
  delete from public.connector_source_suspensions where workspace_key=p_workspace_key;
  delete from public.connector_document_bindings where workspace_key=p_workspace_key;
  delete from public.source_acl_snapshots where source_version_id in
    (select sv.source_version_id from public.source_versions sv join public.sources s on s.source_id=sv.source_id where s.workspace_id=p_workspace_key);
  delete from public.source_representations where source_version_id in
    (select sv.source_version_id from public.source_versions sv join public.sources s on s.source_id=sv.source_id where s.workspace_id=p_workspace_key);
  delete from public.source_versions where source_id in (select source_id from public.sources where workspace_id=p_workspace_key);
  delete from public.sources where workspace_id=p_workspace_key;
  delete from public.knowledge_graph_candidates where workspace_id=v_legacy;
  delete from public.gpu_job_reservations where workspace_id=v_legacy;
  delete from public.sanitization_proofs where document_id in (select id from public.documents where workspace_id=v_legacy);
  delete from public.documents where workspace_id=v_legacy;
  delete from public.foundation_trial_source_digests where workspace_key=p_workspace_key;
  delete from public.foundation_intake_admissions where workspace_key=p_workspace_key;
  delete from public.foundation_connection_batches where workspace_key=p_workspace_key;
  delete from public.foundation_connections where workspace_key=p_workspace_key;
  delete from public.foundation_oauth_authorizations where workspace_key=p_workspace_key;
  delete from public.foundation_oauth_connections where workspace_key=p_workspace_key;
  delete from public.foundation_oauth_secret_envelopes e
    where e.secret_id=any(coalesce(v_oauth_ids,'{}'::uuid[]))
      and not exists(select 1 from public.foundation_oauth_connections c where
        c.client_secret_reference='vercel://oauth/'||e.secret_id::text
        or c.refresh_token_reference='vercel://oauth/'||e.secret_id::text)
      and not exists(select 1 from public.foundation_oauth_authorizations a where
        a.pkce_verifier_reference='vercel://oauth/'||e.secret_id::text);

  update public.founder_test_reset_ledger
    set state='db_finalized_pending_object_verify',finalized_at=clock_timestamp()
    where reset_id=p_reset_id;
  return jsonb_build_object('status','db_finalized_pending_object_verify','resetId',p_reset_id);
exception when others then raise;
end; $$;

create function public.complete_founder_test_reset(
  p_reset_id uuid, p_email text, p_user_id uuid, p_workspace_key text, p_manifest_digest text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_reset public.founder_test_reset_ledger%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('founder-test-reset:'||p_workspace_key,0));
  perform public.founder_test_reset_assertions(p_email,p_user_id,p_workspace_key);
  select * into v_reset from public.founder_test_reset_ledger where reset_id=p_reset_id for update;
  if not found or v_reset.state<>'db_finalized_pending_object_verify' or v_reset.user_id<>p_user_id
     or v_reset.workspace_key<>p_workspace_key or v_reset.manifest_digest<>p_manifest_digest then
    raise exception 'founder_test_reset_completion_mismatch';
  end if;
  update public.founder_test_reset_ledger
    set state='completed',completed_at=clock_timestamp()
    where reset_id=p_reset_id;
  return pg_catalog.jsonb_build_object('status','completed','resetId',p_reset_id);
end; $$;

revoke all on function public.founder_test_reset_assertions(text,uuid,text),
  public.reject_founder_test_reset_evidence_mutation(),
  public.guard_founder_test_reset_legal_hold_activation(),
  public.guard_founder_test_reset_workspace_organization_move(),
  public.founder_test_reset_session_allows_workspace(text),
  public.founder_test_reset_lock_workspaces(text,text),
  public.guard_founder_test_reset_workspace_write(),
  public.guard_founder_test_reset_source_write(),
  public.guard_founder_test_reset_legacy_write(),
  public.guard_founder_test_reset_document_child_write(),
  public.guard_founder_test_reset_source_version_write(),
  public.guard_founder_test_reset_source_representation_write(),
  public.guard_founder_test_reset_tenant_write(),
  public.guard_founder_test_reset_oauth_envelope_write(),
  public.guard_founder_test_reset_oauth_reference_write(),
  public.founder_test_reset_orphan_oauth_secret_ids(text),
  public.founder_test_reset_rows_fingerprint(text,uuid),
  public.founder_test_reset_table_counts(text,uuid),
  public.founder_test_reset_row_sha256(jsonb),
  public.archive_founder_test_reset_evidence(uuid,text,uuid),
  public.founder_test_reset_archive_allows_delete(text,jsonb),
  public.founder_test_reset_snapshot(text,uuid),
  public.prepare_founder_test_reset(text,uuid,text),
  public.inspect_founder_test_reset(uuid,text,uuid,text),
  public.seal_founder_test_reset(uuid,text,uuid,text,text,text,jsonb),
  public.finalize_founder_test_reset(uuid,text,uuid,text,text),
  public.complete_founder_test_reset(uuid,text,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.prepare_founder_test_reset(text,uuid,text),
  public.inspect_founder_test_reset(uuid,text,uuid,text),
  public.seal_founder_test_reset(uuid,text,uuid,text,text,text,jsonb),
  public.finalize_founder_test_reset(uuid,text,uuid,text,text),
  public.complete_founder_test_reset(uuid,text,uuid,text,text) to service_role;

commit;
