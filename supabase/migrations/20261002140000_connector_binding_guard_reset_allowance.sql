-- Restore the founder test reset's archived-row DELETE allowance to the connector binding guard.
--
-- 20260920133000_founder_test_reset.sql gave guard_connector_document_binding() a first line that
-- lets finalize_founder_test_reset delete a binding row only inside a sealed reset session and only
-- when that exact row is in the evidence archive. 20261001150000_connector_binding_write_boundary.sql
-- replaced the function to add the API-role write-path refusal and dropped that line, so finalize on a
-- workspace with any binding failed with CONNECTOR_BINDING_IMMUTABLE after R2 had been purged.
--
-- This is 20261001150000's body with the 20260920133000 allowance restored verbatim as its first
-- statement. Same name, signature, language, invoker security and search_path; create or replace
-- keeps the owner and the existing ACL, and no grant changes.
begin;

create or replace function public.guard_connector_document_binding() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' and public.founder_test_reset_archive_allows_delete(tg_table_name,to_jsonb(old)) then return old; end if;
  if tg_op <> 'INSERT' then raise exception 'CONNECTOR_BINDING_IMMUTABLE'; end if;
  -- Trigger functions run as the role performing the insert. Inside the security-definer writer
  -- that is the function owner; a direct REST insert is service_role (or another API role).
  if current_user in ('anon', 'authenticated', 'service_role') then
    raise exception 'CONNECTOR_BINDING_WRITE_PATH';
  end if;
  perform 1 from public.foundation_oauth_connections
    where oauth_connection_id = new.oauth_connection_id and workspace_key = new.workspace_key
      and provider = new.provider and status = 'active' for share;
  if not found then raise exception 'CONNECTOR_BINDING_CONNECTION_INVALID'; end if;
  return new;
end;
$$;

commit;
