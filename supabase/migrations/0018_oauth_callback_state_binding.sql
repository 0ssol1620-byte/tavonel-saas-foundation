-- OAuth provider callbacks cannot carry the application's bearer session.
-- The one-time 256-bit state digest is the callback credential; consume it
-- atomically and return the user/workspace binding recorded at initiation.
begin;

drop function if exists public.consume_foundation_oauth_authorization(text, text, uuid);

create or replace function public.consume_foundation_oauth_authorization(
  p_state_sha256 text,
  p_provider text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_authorization public.foundation_oauth_authorizations%rowtype;
begin
  delete from public.foundation_oauth_authorizations
    where expires_at < clock_timestamp() - interval '1 day';
  select * into v_authorization
    from public.foundation_oauth_authorizations
    where state_sha256 = p_state_sha256
    for update;
  if not found
    or v_authorization.provider is distinct from p_provider
    or v_authorization.consumed_at is not null
    or v_authorization.expires_at <= clock_timestamp() then
    raise exception 'oauth_authorization_invalid';
  end if;
  update public.foundation_oauth_authorizations
    set consumed_at = clock_timestamp()
    where authorization_id = v_authorization.authorization_id;
  return jsonb_build_object(
    'authorizationId', v_authorization.authorization_id,
    'workspaceKey', v_authorization.workspace_key,
    'userId', v_authorization.created_by,
    'displayName', v_authorization.display_name,
    'pkceVerifierReference', v_authorization.pkce_verifier_reference,
    'redirectUri', v_authorization.redirect_uri,
    'requestedScopes', v_authorization.requested_scopes
  );
end;
$$;

revoke all on function public.consume_foundation_oauth_authorization(text, text) from public, anon, authenticated;
grant execute on function public.consume_foundation_oauth_authorization(text, text) to service_role;

commit;
