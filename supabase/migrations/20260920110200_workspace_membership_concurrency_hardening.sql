-- B15 forward-only concurrency hardening.
--
-- This migration intentionally follows, rather than edits, the original membership control-plane
-- and owner-invariant migrations. That keeps environments which have already recorded either
-- migration safe: apply 20260920110000, 20260920110100, then this file in timestamp order.
begin;

-- Old application versions could leave an overdue invitation in `pending`. Normalize those rows
-- before creating the physical invariant, then deterministically retain the oldest live pending
-- invite if pre-existing concurrent writers produced duplicates.
update public.foundation_workspace_invitations
   set state = 'expired'
 where state = 'pending'
   and expires_at <= clock_timestamp();

with duplicate_pending as (
  select invite_id,
         row_number() over (
           partition by workspace_key, invitee_email
           order by created_at, invite_id
         ) as ordinal
    from public.foundation_workspace_invitations
   where state = 'pending'
)
update public.foundation_workspace_invitations invitation
   set state = 'revoked', revoked_at = clock_timestamp()
  from duplicate_pending duplicate
 where invitation.invite_id = duplicate.invite_id
   and duplicate.ordinal > 1;

create unique index foundation_workspace_one_pending_invite_per_email_idx
  on public.foundation_workspace_invitations (workspace_key, invitee_email)
  where state = 'pending';

-- Replace the original trigger body forward-only. An UPDATE can move a membership between
-- workspaces, so both OLD and NEW tenants must be checked when their keys differ.
create or replace function public.assert_foundation_workspace_has_owner()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old_workspace_key text;
  v_new_workspace_key text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_workspace_key := old.workspace_key;
    if exists (
      select 1 from public.foundation_workspaces where workspace_key = v_old_workspace_key
    ) and (
      select count(*) from public.foundation_workspace_members
       where workspace_key = v_old_workspace_key and role = 'owner' and state = 'active'
    ) <> 1 then
      raise exception 'workspace_exactly_one_owner_required';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    v_new_workspace_key := new.workspace_key;
    if (tg_op <> 'UPDATE' or v_new_workspace_key is distinct from v_old_workspace_key)
      and exists (
        select 1 from public.foundation_workspaces where workspace_key = v_new_workspace_key
      ) and (
        select count(*) from public.foundation_workspace_members
         where workspace_key = v_new_workspace_key and role = 'owner' and state = 'active'
      ) <> 1 then
      raise exception 'workspace_exactly_one_owner_required';
    end if;
  end if;
  return null;
end;
$$;

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

revoke execute on function public.assert_foundation_workspace_has_owner()
  from public, anon, authenticated;
revoke all on function public.create_foundation_workspace_invite(
  text, uuid, text, text, text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.create_foundation_workspace_invite(
  text, uuid, text, text, text, text, timestamptz, text
) to service_role;

commit;
