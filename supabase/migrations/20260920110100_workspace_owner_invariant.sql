-- Follow-up to B15: make "exactly one active owner" a deferred database invariant.
-- The partial unique index in 20260920110000 prevents two owners; these deferred checks prevent
-- a workspace with zero owners even if a future service-role path bypasses the guarded RPCs.
begin;

create or replace function public.assert_foundation_workspace_has_owner()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_workspace_key text;
begin
  v_workspace_key := case when tg_op = 'DELETE' then old.workspace_key else new.workspace_key end;
  if exists (select 1 from public.foundation_workspaces where workspace_key = v_workspace_key)
    and (select count(*) from public.foundation_workspace_members
          where workspace_key = v_workspace_key and role = 'owner' and state = 'active') <> 1 then
    raise exception 'workspace_exactly_one_owner_required';
  end if;
  return null;
end;
$$;

create or replace function public.assert_new_foundation_workspace_has_owner()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (select count(*) from public.foundation_workspace_members
       where workspace_key = new.workspace_key and role = 'owner' and state = 'active') <> 1 then
    raise exception 'workspace_exactly_one_owner_required';
  end if;
  return null;
end;
$$;

create constraint trigger foundation_workspace_owner_after_member_change
  after insert or update or delete on public.foundation_workspace_members
  deferrable initially deferred
  for each row execute function public.assert_foundation_workspace_has_owner();

create constraint trigger foundation_workspace_owner_after_workspace_insert
  after insert on public.foundation_workspaces
  deferrable initially deferred
  for each row execute function public.assert_new_foundation_workspace_has_owner();

revoke execute on function public.assert_foundation_workspace_has_owner(),
  public.assert_new_foundation_workspace_has_owner()
  from public, anon, authenticated;

commit;
