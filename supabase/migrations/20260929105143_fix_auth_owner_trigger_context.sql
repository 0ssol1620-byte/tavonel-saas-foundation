-- Auth writes auth.users as supabase_auth_admin. The workspace bootstrap trigger runs as
-- postgres, but these deferred owner checks run at COMMIT as supabase_auth_admin.
-- That role intentionally has no access to the private workspace tables, so a new
-- OAuth user currently fails to commit with permission denied.
--
-- These are trigger-only invariant checks, already closed to API roles. Execute them
-- with their postgres owner's rights without granting Auth access to tenant rows.
begin;

alter function public.assert_foundation_workspace_has_owner() security definer;
alter function public.assert_foundation_workspace_has_owner() set search_path = '';
alter function public.assert_new_foundation_workspace_has_owner() security definer;
alter function public.assert_new_foundation_workspace_has_owner() set search_path = '';

revoke all on function public.assert_foundation_workspace_has_owner(),
  public.assert_new_foundation_workspace_has_owner()
  from public, anon, authenticated, service_role;

commit;
