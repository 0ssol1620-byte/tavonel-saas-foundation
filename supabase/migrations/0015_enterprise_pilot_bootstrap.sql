-- Controlled enterprise bootstrap for an authenticated Foundation pilot owner.
-- The function is service-role only and derives the workspace key exactly as
-- the application does; it never accepts a caller-supplied workspace or role.
begin;

create or replace function public.bootstrap_enterprise_for_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_workspace_key text;
  v_slug text;
begin
  if p_user_id is null or not exists (
    select 1 from auth.users where id = p_user_id
  ) then
    raise exception 'enterprise_bootstrap_user_invalid';
  end if;

  v_workspace_key := 'pilot-' || substring(
    pg_catalog.replace(p_user_id::text, '-', '') from 1 for 16
  );
  v_slug := 'tavonel-' || substring(
    pg_catalog.replace(p_user_id::text, '-', '') from 1 for 16
  );

  insert into public.enterprise_organizations (name, slug, created_by)
  values ('TAVONEL', v_slug, p_user_id)
  on conflict (slug) do update set updated_at = clock_timestamp()
  returning organization_id into v_organization_id;

  insert into public.enterprise_organization_memberships (
    organization_id, user_id, role, created_by
  ) values (
    v_organization_id, p_user_id, 'owner', p_user_id
  ) on conflict (organization_id, user_id) do update set
    role = 'owner',
    updated_at = clock_timestamp();

  insert into public.enterprise_workspaces (
    workspace_key, organization_id, display_name, region
  ) values (
    v_workspace_key, v_organization_id, 'TAVONEL Foundation', 'apac'
  ) on conflict (workspace_key) do update set
    organization_id = excluded.organization_id,
    display_name = excluded.display_name,
    updated_at = clock_timestamp();

  insert into public.enterprise_workspace_memberships (
    workspace_key, user_id, role, created_by
  ) values (
    v_workspace_key, p_user_id, 'owner', p_user_id
  ) on conflict (workspace_key, user_id) do update set
    role = 'owner',
    updated_at = clock_timestamp();

  insert into public.enterprise_governance_policies (
    organization_id, updated_by
  ) values (
    v_organization_id, p_user_id
  ) on conflict (organization_id) do nothing;

  if not exists (
    select 1 from public.enterprise_audit_events
    where organization_id = v_organization_id
      and workspace_key = v_workspace_key
      and action = 'organization.bootstrapped'
      and actor_user_id = p_user_id
  ) then
    insert into public.enterprise_audit_events (
      organization_id, workspace_key, action, target_type, target_id,
      actor_user_id, actor_kind, outcome, details
    ) values (
      v_organization_id, v_workspace_key, 'organization.bootstrapped',
      'organization', v_organization_id::text, p_user_id, 'user', 'succeeded',
      jsonb_build_object('source', 'foundation_pilot')
    );
  end if;

  return jsonb_build_object(
    'organizationId', v_organization_id,
    'workspaceKey', v_workspace_key,
    'organizationRole', 'owner',
    'workspaceRole', 'owner'
  );
end;
$$;

revoke all on function public.bootstrap_enterprise_for_user(uuid)
  from public, anon, authenticated;
grant execute on function public.bootstrap_enterprise_for_user(uuid)
  to service_role;

commit;
