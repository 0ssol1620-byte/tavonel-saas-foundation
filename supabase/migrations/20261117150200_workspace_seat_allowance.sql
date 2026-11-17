-- WO-CAT-6: a plan's seat allowance caps workspace membership (catalog v2, PB-2026-11-V22).
--
-- Seats are active members plus live pending invitations. Invite creation keeps that total at or
-- under the workspace's limit: an invite reserves its seat, and an invite that expires or is
-- revoked, or a member who is revoked, frees one. Acceptance converts the reservation, so it only
-- refuses when the active members alone would pass the limit -- the case of a workspace that was
-- already over it (a legacy holder that moved to a smaller v2 plan, or invites issued while it
-- was uncapped). Such a workspace keeps every member it has; it only cannot add one.
--
-- The limit is the catalog's, never a literal here: the server passes `p_seat_limits`, the
-- catalog's `included.seats` per v2 offer code (nextjs/lib/workspace-membership.ts reads
-- nextjs/lib/billing-catalog.ts), and the function applies the entry for the workspace's
-- `foundation_billing_accounts.plan_code` (20261117140000), read inside the same transaction
-- under the workspace's seat lock. No plan code (legacy plans, whose code is their access level,
-- and workspaces without a subscription) and a workspace whose owner holds an active operator
-- grant (0045) are uncapped, exactly as before. A plan code with no valid entry in the map --
-- including a caller that passes none -- is refused, never uncapped.
--
-- The count and the check run under one transaction-scoped advisory lock per workspace, taken by
-- both functions as their last lock, so two accepts or two invites at limit-1 admit exactly one.
--
-- Both functions are redefined from their latest definitions (create: 20260920110200, accept:
-- 20260920110000); only the seat lines are new. Each gains a trailing `p_seat_limits jsonb
-- default null`, so every existing caller (nextjs/scripts/journey/*) keeps resolving; the old
-- signatures are dropped so no path can skip the check. Grants are as before: service_role only.
-- No seat billing. Rollback: supabase/drafts/rollback-20261117150200-workspace-seat-allowance.sql.
begin;

-- The limit for one workspace: null = uncapped. Callers hold the workspace's seat lock.
create function public.foundation_workspace_seat_limit(p_workspace_key text, p_seat_limits jsonb)
returns integer
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_plan text;
  v_limit jsonb;
begin
  select plan_code into v_plan from public.foundation_billing_accounts
   where workspace_key = p_workspace_key;
  if v_plan is null then return null; end if;
  if exists (
    select 1 from public.foundation_workspace_members m
      join public.foundation_account_access_grants g on g.user_id = m.user_id and g.active
     where m.workspace_key = p_workspace_key and m.role = 'owner' and m.state = 'active'
  ) then
    return null;
  end if;
  -- Nested, not one OR: SQL does not promise to skip the cast of a non-number.
  if jsonb_typeof(p_seat_limits) = 'object' and jsonb_typeof(p_seat_limits -> v_plan) = 'number' then
    v_limit := p_seat_limits -> v_plan;
    if v_limit::numeric = trunc(v_limit::numeric) and v_limit::numeric between 1 and 100000 then
      return v_limit::integer;
    end if;
  end if;
  raise exception 'workspace_seat_limit_unavailable';
end;
$$;

drop function public.create_foundation_workspace_invite(text, uuid, text, text, text, text, timestamptz, text);
drop function public.accept_foundation_workspace_invite(uuid, text, text);

create function public.create_foundation_workspace_invite(
  p_workspace_key text,
  p_actor_user_id uuid,
  p_invitee_email text,
  p_role text,
  p_token_hash text,
  p_idempotency_key text,
  p_expires_at timestamptz,
  p_request_id text,
  p_seat_limits jsonb default null
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
  v_seat_limit integer;
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

  -- Seats: the last lock taken, then the count and the check against the plan's limit.
  perform pg_advisory_xact_lock(hashtextextended(
    jsonb_build_array('foundation_workspace_seats', p_workspace_key)::text, 0
  ));
  v_seat_limit := public.foundation_workspace_seat_limit(p_workspace_key, p_seat_limits);
  if v_seat_limit is not null and (
    (select count(*) from public.foundation_workspace_members
      where workspace_key = p_workspace_key and state = 'active')
    + (select count(*) from public.foundation_workspace_invitations
      where workspace_key = p_workspace_key and state = 'pending' and expires_at > clock_timestamp())
  ) >= v_seat_limit then
    raise exception 'workspace_seat_limit_reached';
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

create function public.accept_foundation_workspace_invite(
  p_actor_user_id uuid,
  p_token_hash text,
  p_request_id text,
  p_seat_limits jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_invite public.foundation_workspace_invitations%rowtype;
  v_email text;
  v_seat_limit integer;
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

  -- Seats: the last lock taken; the new member is counted, and the whole accept rolls back if
  -- the active members now pass the plan's limit.
  perform pg_advisory_xact_lock(hashtextextended(
    jsonb_build_array('foundation_workspace_seats', v_invite.workspace_key)::text, 0
  ));
  v_seat_limit := public.foundation_workspace_seat_limit(v_invite.workspace_key, p_seat_limits);
  if v_seat_limit is not null and (
    select count(*) from public.foundation_workspace_members
     where workspace_key = v_invite.workspace_key and state = 'active'
  ) > v_seat_limit then
    raise exception 'workspace_seat_limit_reached';
  end if;

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

revoke all on function public.foundation_workspace_seat_limit(text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.create_foundation_workspace_invite(
  text, uuid, text, text, text, text, timestamptz, text, jsonb
) from public, anon, authenticated;
grant execute on function public.create_foundation_workspace_invite(
  text, uuid, text, text, text, text, timestamptz, text, jsonb
) to service_role;
revoke all on function public.accept_foundation_workspace_invite(uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.accept_foundation_workspace_invite(uuid, text, text, jsonb)
  to service_role;

commit;
