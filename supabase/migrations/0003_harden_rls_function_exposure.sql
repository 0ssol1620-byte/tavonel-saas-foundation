-- Apply only after explicit target-project confirmation. This migration removes public RPC access
-- to SECURITY DEFINER helpers while preserving tenant policy evaluation via a non-exposed schema.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_memberships membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = auth.uid()
  );
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.is_workspace_member(uuid) from public, anon, authenticated;
revoke all on function public.is_workspace_owner(uuid) from public, anon, authenticated;
revoke all on function private.is_workspace_member(uuid) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_workspace_member(uuid) to authenticated;

drop policy if exists workspaces_select_member on public.workspaces;
drop policy if exists memberships_select_member on public.workspace_memberships;
drop policy if exists entitlements_select_member on public.workspace_entitlements;
drop policy if exists documents_select_member on public.documents;
drop policy if exists proofs_select_document_member on public.sanitization_proofs;
drop policy if exists candidates_select_member on public.knowledge_graph_candidates;
drop policy if exists paddle_subscriptions_select_member on public.paddle_subscriptions;

create policy workspaces_select_member on public.workspaces for select to authenticated using (private.is_workspace_member(id));
create policy memberships_select_member on public.workspace_memberships for select to authenticated using (private.is_workspace_member(workspace_id));
create policy entitlements_select_member on public.workspace_entitlements for select to authenticated using (private.is_workspace_member(workspace_id));
create policy documents_select_member on public.documents for select to authenticated using (private.is_workspace_member(workspace_id));
create policy proofs_select_document_member on public.sanitization_proofs for select to authenticated using (
  exists (select 1 from public.documents d where d.id = document_id and private.is_workspace_member(d.workspace_id))
);
create policy candidates_select_member on public.knowledge_graph_candidates for select to authenticated using (private.is_workspace_member(workspace_id));
create policy paddle_subscriptions_select_member on public.paddle_subscriptions for select to authenticated using (private.is_workspace_member(workspace_id));

create policy billing_events_no_client_access on public.billing_events
  as restrictive for all to anon, authenticated using (false) with check (false);

commit;
