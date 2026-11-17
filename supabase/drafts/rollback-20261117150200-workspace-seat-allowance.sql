-- Rollback for migration 20261117150200_workspace_seat_allowance (WO-CAT-6).
--
-- Not a migration: run by hand, as one transaction, against the database where 20261117150200 was
-- applied, AFTER the site is reverted to a build that does not send `p_seat_limits`
-- (lib/workspace-membership.ts). Against the restored three- and eight-argument functions a call
-- carrying `p_seat_limits` finds no function and fails closed as WORKSPACE_INVITE_CREATE_FAILED /
-- WORKSPACE_INVITE_ACCEPT_FAILED; nothing is written.
--
-- It drops the seat-checking create/accept functions and foundation_workspace_seat_limit, and
-- restores create_foundation_workspace_invite from 20260920110200 and
-- accept_foundation_workspace_invite from 20260920110000 verbatim, with their grants (service_role
-- only). No row is changed: membership and invitation rows carry no seat data, so a workspace that
-- is over its plan's seat limit after the rollback simply becomes uncapped again, as before
-- WO-CAT-6. A missing function stops the rollback (no `if exists`).
--
-- Afterwards the catalog fingerprint (nextjs/scripts/db/catalog-fingerprints.sql) equals the one of
-- the chain ending before 20261117150200.
--
-- Recording it: this file deliberately does not edit supabase_migrations.schema_migrations. After it
-- commits, the operator runs
--   delete from supabase_migrations.schema_migrations where version = '20261117150200';
-- in the same session, and writes the version, the time and who ran it into the campaign ledger.
\set ON_ERROR_STOP on
begin;

drop function public.create_foundation_workspace_invite(text, uuid, text, text, text, text, timestamptz, text, jsonb);
drop function public.accept_foundation_workspace_invite(uuid, text, text, jsonb);
drop function public.foundation_workspace_seat_limit(text, jsonb);

-- From 20260920110200_workspace_membership_concurrency_hardening.sql, verbatim.
create or replace function public.create_foundation_workspace_invite(
  p_workspace_key text,
  p_actor_user_id uuid,
  p_invitee_email text,
  p_role text,
  p_token_hash text,
  p_idempotency_key text,
  p_expires_at timestamptz,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.foundation_workspace_members%rowtype;
  v_existing public.foundation_workspace_invitations%rowtype;
  v_invite public.foundation_workspace_invitations%rowtype;
  v_email text := lower(btrim(p_invitee_email));
begin
  if p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or char_length(v_email) > 320
    or p_role not in ('admin', 'member')
    or p_token_hash !~ '^sha256:[a-f0-9]{64}$'
    or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$'
    or p_expires_at <= clock_timestamp()
    or p_expires_at > clock_timestamp() + interval '30 days'
    or char_length(p_request_id) not between 8 and 160 then
    raise exception 'workspace_invite_input_invalid';
  end if;

  select * into v_actor from public.foundation_workspace_members
   where workspace_key = p_workspace_key and user_id = p_actor_user_id
   for update;
  if not found or v_actor.state <> 'active' or v_actor.role not in ('owner', 'admin') then
    raise exception 'workspace_invite_forbidden';
  end if;
  if v_actor.role = 'admin' and p_role <> 'member' then
    raise exception 'workspace_invite_role_forbidden';
  end if;

  -- Serialize the logical resources before checking them. The index remains the final invariant
  -- for direct service-role writes and future code paths which do not use this RPC.
  perform pg_advisory_xact_lock(hashtextextended(
    jsonb_build_array('foundation_workspace_invite:email', p_workspace_key, v_email)::text, 0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    jsonb_build_array(
      'foundation_workspace_invite:idempotency', p_workspace_key,
      p_actor_user_id::text, p_idempotency_key
    )::text, 0
  ));

  select * into v_existing from public.foundation_workspace_invitations
   where workspace_key = p_workspace_key and invited_by = p_actor_user_id
     and idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_existing.invitee_email <> v_email or v_existing.role <> p_role
      or v_existing.token_hash <> p_token_hash then
      raise exception 'workspace_invite_idempotency_conflict';
    end if;
    return jsonb_build_object(
      'inviteId', v_existing.invite_id, 'workspaceKey', v_existing.workspace_key,
      'email', v_existing.invitee_email, 'role', v_existing.role,
      'state', v_existing.state, 'expiresAt', v_existing.expires_at,
      'idempotentReplay', true
    );
  end if;

  if exists (
    select 1 from public.foundation_workspace_members m
     join auth.users u on u.id = m.user_id
    where m.workspace_key = p_workspace_key and m.state = 'active'
      and lower(u.email) = v_email
  ) then
    raise exception 'workspace_invite_already_member';
  end if;

  update public.foundation_workspace_invitations
     set state = 'expired'
   where workspace_key = p_workspace_key and invitee_email = v_email
     and state = 'pending' and expires_at <= clock_timestamp();

  if exists (
    select 1 from public.foundation_workspace_invitations
     where workspace_key = p_workspace_key and invitee_email = v_email
       and state = 'pending'
  ) then
    raise exception 'workspace_invite_pending';
  end if;

  insert into public.foundation_workspace_invitations (
    workspace_key, invitee_email, role, token_hash, idempotency_key,
    invited_by, expires_at
  ) values (
    p_workspace_key, v_email, p_role, p_token_hash, p_idempotency_key,
    p_actor_user_id, p_expires_at
  ) returning * into v_invite;

  insert into public.foundation_workspace_membership_events (
    workspace_key, action, actor_user_id, invite_id, request_id, details
  ) values (
    p_workspace_key, 'invite.created', p_actor_user_id, v_invite.invite_id,
    p_request_id, jsonb_build_object('email', v_email, 'role', p_role, 'expiresAt', p_expires_at)
  );
  return jsonb_build_object(
    'inviteId', v_invite.invite_id, 'workspaceKey', v_invite.workspace_key,
    'email', v_invite.invitee_email, 'role', v_invite.role,
    'state', v_invite.state, 'expiresAt', v_invite.expires_at,
    'idempotentReplay', false
  );
end;
$$;

-- From 20260920110000_workspace_membership_control_plane.sql, verbatim.
create or replace function public.accept_foundation_workspace_invite(
  p_actor_user_id uuid,
  p_token_hash text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_invite public.foundation_workspace_invitations%rowtype;
  v_email text;
begin
  if p_token_hash !~ '^sha256:[a-f0-9]{64}$'
    or char_length(p_request_id) not between 8 and 160 then
    raise exception 'workspace_invite_accept_input_invalid';
  end if;
  select lower(email) into v_email from auth.users where id = p_actor_user_id;
  if not found or v_email is null then raise exception 'workspace_invite_identity_invalid'; end if;

  select * into v_invite from public.foundation_workspace_invitations
   where token_hash = p_token_hash for update;
  if not found then raise exception 'workspace_invite_not_found'; end if;
  if v_invite.state = 'accepted' then
    if v_invite.accepted_by = p_actor_user_id and exists (
      select 1 from public.foundation_workspace_members
       where workspace_key = v_invite.workspace_key and user_id = p_actor_user_id and state = 'active'
    ) then
      return jsonb_build_object(
        'workspaceKey', v_invite.workspace_key, 'role', v_invite.role,
        'state', 'accepted', 'idempotentReplay', true
      );
    end if;
    raise exception 'workspace_invite_consumed';
  end if;
  if v_invite.state <> 'pending' then raise exception 'workspace_invite_not_active'; end if;
  if v_invite.expires_at <= clock_timestamp() then
    update public.foundation_workspace_invitations set state = 'expired'
     where invite_id = v_invite.invite_id;
    raise exception 'workspace_invite_expired';
  end if;
  if v_invite.invitee_email <> v_email then raise exception 'workspace_invite_identity_mismatch'; end if;

  insert into public.foundation_workspace_members (
    workspace_key, user_id, role, state, invited_by, invited_at, accepted_at, revoked_at, updated_at
  ) values (
    v_invite.workspace_key, p_actor_user_id, v_invite.role, 'active',
    v_invite.invited_by, v_invite.created_at, clock_timestamp(), null, clock_timestamp()
  )
  on conflict (workspace_key, user_id) do update set
    role = excluded.role, state = 'active', invited_by = excluded.invited_by,
    invited_at = excluded.invited_at, accepted_at = excluded.accepted_at,
    revoked_at = null, updated_at = excluded.updated_at
  where foundation_workspace_members.state = 'revoked';
  if not found then raise exception 'workspace_invite_member_conflict'; end if;

  update public.foundation_workspace_invitations
     set state = 'accepted', accepted_by = p_actor_user_id, accepted_at = clock_timestamp()
   where invite_id = v_invite.invite_id;
  insert into public.foundation_workspace_membership_events (
    workspace_key, action, actor_user_id, subject_user_id, invite_id, request_id, details
  ) values (
    v_invite.workspace_key, 'invite.accepted', p_actor_user_id, p_actor_user_id,
    v_invite.invite_id, p_request_id, jsonb_build_object('role', v_invite.role)
  );
  return jsonb_build_object(
    'workspaceKey', v_invite.workspace_key, 'role', v_invite.role,
    'state', 'accepted', 'idempotentReplay', false
  );
end;
$$;

revoke all on function public.create_foundation_workspace_invite(
  text, uuid, text, text, text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.create_foundation_workspace_invite(
  text, uuid, text, text, text, text, timestamptz, text
) to service_role;
revoke all on function public.accept_foundation_workspace_invite(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.accept_foundation_workspace_invite(uuid, text, text)
  to service_role;

commit;
