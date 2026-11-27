-- Workspace seat allowance (20261117150200, WO-CAT-6): active members plus live pending invites
-- stay at or under the plan's seat limit; legacy and operator-granted workspaces are uncapped as
-- before. A Free workspace (no billing account and no operator grant on its owner) has one seat
-- (20261127100000, WO-SINGLE-USER-2). The limits map is what nextjs/lib/workspace-membership.ts sends,
-- built from the catalog's included.seats (lib/workspace-membership.test.ts pins that the two agree).
begin;
select plan(57);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000',
  (lpad(i::text, 8, '0') || '-5ea7-4ea7-8ea7-5ea75ea75ea7')::uuid,
  'authenticated', 'authenticated', 'seat-' || i || '@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
from generate_series(1, 99) i;

create function pg_temp.uid(i integer) returns uuid language sql immutable as $$
  select (lpad(i::text, 8, '0') || '-5ea7-4ea7-8ea7-5ea75ea75ea7')::uuid
$$;
-- The workspace the signup trigger bootstraps for user i, owned by user i.
create function pg_temp.ws(i integer) returns text language sql immutable as $$
  select 'pilot-' || left(regexp_replace(pg_temp.uid(i)::text, '[^A-Za-z0-9]', '', 'g'), 16)
$$;
create function pg_temp.hash(i integer) returns text language sql immutable as $$
  select 'sha256:' || md5('seat-token-' || i) || md5('seat-token-' || i || '#')
$$;
create function pg_temp.limits() returns jsonb language sql immutable as $$
  select '{"personal":1,"developer":1,"team":5,"business":20}'::jsonb
$$;
create function pg_temp.plan(owner integer, access text, code text) returns void language sql as $$
  insert into public.foundation_billing_accounts (workspace_key, user_id, access_plan, plan_code, subscription_status)
  values (pg_temp.ws(owner), pg_temp.uid(owner), access, code, 'active')
  on conflict (workspace_key) do update set access_plan = excluded.access_plan, plan_code = excluded.plan_code
$$;
-- Owner `owner` invites user i (token i) as a member, with the given limits map.
create function pg_temp.invite(owner integer, i integer, seat_limits jsonb default pg_temp.limits()) returns jsonb language sql as $$
  select public.create_foundation_workspace_invite(pg_temp.ws(owner), pg_temp.uid(owner),
    'seat-' || i || '@example.invalid', 'member', pg_temp.hash(i), 'seat_idempotency_' || lpad(i::text, 4, '0'),
    now() + interval '1 hour', 'seat-invite-' || i, seat_limits)
$$;
create function pg_temp.accept(i integer, seat_limits jsonb default pg_temp.limits()) returns jsonb language sql as $$
  select public.accept_foundation_workspace_invite(pg_temp.uid(i), pg_temp.hash(i), 'seat-accept-' || i, seat_limits)
$$;
create function pg_temp.seats(owner integer) returns integer language sql as $$
  select ((select count(*) from public.foundation_workspace_members
            where workspace_key = pg_temp.ws(owner) and state = 'active')
        + (select count(*) from public.foundation_workspace_invitations
            where workspace_key = pg_temp.ws(owner) and state = 'pending' and expires_at > clock_timestamp()))::integer
$$;
create function pg_temp.active(owner integer) returns integer language sql as $$
  select count(*)::integer from public.foundation_workspace_members
   where workspace_key = pg_temp.ws(owner) and state = 'active'
$$;
create function pg_temp.invite_id(i integer) returns uuid language sql as $$
  select invite_id from public.foundation_workspace_invitations where token_hash = pg_temp.hash(i)
$$;
-- Is this backend holding the workspace's seat lock (an xact advisory lock on the bigint key)?
create function pg_temp.seat_lock_held(owner integer) returns boolean language sql as $$
  select exists (
    select 1 from pg_locks l,
      lateral (select hashtextextended(jsonb_build_array('foundation_workspace_seats', pg_temp.ws(owner))::text, 0) k) key
     where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.objsubid = 1 and l.granted
       and l.classid::bigint = (key.k >> 32) & 4294967295 and l.objid::bigint = key.k & 4294967295)
$$;

-- 1. Team (limit 5): owner + four invites fill it; the fifth seat is admitted, the sixth invite refused.
select pg_temp.plan(1, 'studio_access', 'team');
select is((select count(*)::integer from generate_series(2, 5) i where (pg_temp.invite(1, i)->>'state') = 'pending'), 4,
  'team: four invites are admitted next to the owner');
select is(pg_temp.seats(1), 5, 'team: the fifth seat is taken (one owner, four pending)');
select throws_ok($$select pg_temp.invite(1, 6)$$, 'P0001', 'workspace_seat_limit_reached', 'team: the sixth invite is refused');
select is((select count(*)::integer from public.foundation_workspace_invitations where workspace_key = pg_temp.ws(1)), 4,
  'team: the refused invite wrote no row');
select is(pg_temp.invite(1, 2)->>'idempotentReplay', 'true', 'team: a replay of an admitted invite at the limit is still a replay, not a refusal');

-- 2. Accepting converts a reservation; the total does not move, so every reserved seat is accepted.
select is((select count(*)::integer from generate_series(2, 5) i where (pg_temp.accept(i)->>'state') = 'accepted'), 4,
  'team: all four reserved seats are accepted');
select is(pg_temp.active(1), 5, 'team: five active members');
select throws_ok($$select pg_temp.invite(1, 6)$$, 'P0001', 'workspace_seat_limit_reached', 'team: at five active members the next invite is refused');
select is(pg_temp.accept(2)->>'idempotentReplay', 'true', 'team: a replayed accept at the limit is still a replay');

-- 3. A revoked member frees a seat; a revoked or expired pending invite frees its seat.
select public.revoke_foundation_workspace_member(pg_temp.ws(1), pg_temp.uid(1), pg_temp.uid(5), 'seat-revoke-5');
select is(pg_temp.invite(1, 6)->>'state', 'pending', 'team: a revoked member frees a seat for a new invite');
select throws_ok($$select pg_temp.invite(1, 7)$$, 'P0001', 'workspace_seat_limit_reached', 'team: and only one');
select public.revoke_foundation_workspace_invite(pg_temp.ws(1), pg_temp.uid(1), pg_temp.invite_id(6), 'seat-revoke-invite-6');
select is(pg_temp.invite(1, 7)->>'state', 'pending', 'team: a revoked pending invite frees its seat');
update public.foundation_workspace_invitations
   set created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 second'
 where invite_id = pg_temp.invite_id(7);
select is(pg_temp.invite(1, 8)->>'state', 'pending', 'team: a pending invite past its expiry frees its seat');
select throws_ok($$select pg_temp.invite(1, 9)$$, 'P0001', 'workspace_seat_limit_reached', 'team: the freed seat is taken again');
select throws_ok($$select pg_temp.accept(7)$$, 'P0001', 'workspace_invite_expired', 'team: the expired invite cannot be accepted either');

-- 4. Personal and Developer (limit 1): the owner is the seat; no invite can be created.
select pg_temp.plan(20, 'observer_access', 'personal');
select throws_ok($$select pg_temp.invite(20, 21)$$, 'P0001', 'workspace_seat_limit_reached', 'personal: a workspace cannot create an invite');
select pg_temp.plan(22, 'observer_access', 'developer');
select throws_ok($$select pg_temp.invite(22, 23)$$, 'P0001', 'workspace_seat_limit_reached', 'developer: a workspace cannot create an invite');
select is((select count(*)::integer from public.foundation_workspace_invitations where workspace_key in (pg_temp.ws(20), pg_temp.ws(22))), 0,
  'personal/developer: no invite row was written');

-- 5. Business (limit 20).
select pg_temp.plan(24, 'studio_access', 'business');
select is((select count(*)::integer from generate_series(25, 43) i where (pg_temp.invite(24, i)->>'state') = 'pending'), 19,
  'business: nineteen invites are admitted next to the owner');
select throws_ok($$select pg_temp.invite(24, 44)$$, 'P0001', 'workspace_seat_limit_reached', 'business: the twenty-first seat is refused');

-- 6. Legacy (plan_code null) and an operator-granted owner: uncapped, as before. No plan at all (a Free
-- workspace) is one seat, the owner (20261127100000).
select pg_temp.plan(45, 'studio_access', null);
select is((select count(*)::integer from generate_series(46, 52) i where (pg_temp.invite(45, i)->>'state') = 'pending'), 7,
  'legacy: seven invites past any v2 limit are admitted');
select is((select count(*)::integer from generate_series(46, 52) i where (pg_temp.accept(i)->>'state') = 'accepted'), 7,
  'legacy: and accepted (eight active members)');
select is(public.create_foundation_workspace_invite(pg_temp.ws(45), pg_temp.uid(45), 'seat-53@example.invalid', 'member',
    pg_temp.hash(53), 'seat_idempotency_0053', now() + interval '1 hour', 'seat-invite-53')->>'state',
  'pending', 'legacy: the eight-argument call of the earlier signature still resolves and behaves as today');
select is(public.accept_foundation_workspace_invite(pg_temp.uid(53), pg_temp.hash(53), 'seat-accept-53')->>'state',
  'accepted', 'legacy: so does the three-argument accept');
select throws_ok($$select pg_temp.invite(54, 55)$$, 'P0001', 'workspace_seat_limit_reached',
  'free (no billing account, no grant): the owner is the one seat, so no invite can be created');
select is((select count(*)::integer from public.foundation_workspace_invitations where workspace_key = pg_temp.ws(54)), 0,
  'free: the refused invite wrote no row');
-- A Free workspace whose owner holds an operator grant (the founder's) is still uncapped.
insert into public.foundation_account_access_grants (user_id, grant_kind, access_plan, active)
values (pg_temp.uid(90), 'owner', 'studio_access', true);
select is((select count(*)::integer from generate_series(91, 97) i where (pg_temp.invite(90, i)->>'state') = 'pending'), 7,
  'no billing account, operator-granted owner: uncapped, as before');
update public.foundation_account_access_grants set active = false where user_id = pg_temp.uid(90);
select throws_ok($$select pg_temp.invite(90, 98)$$, 'P0001', 'workspace_seat_limit_reached',
  'no billing account: an inactive grant does not exempt, the workspace is Free again');
select pg_temp.plan(62, 'studio_access', 'team');
insert into public.foundation_account_access_grants (user_id, grant_kind, access_plan, active)
values (pg_temp.uid(62), 'owner', 'studio_access', true);
select is((select count(*)::integer from generate_series(63, 69) i where (pg_temp.invite(62, i)->>'state') = 'pending'), 7,
  'operator grant on the owner: uncapped even with a team plan code');
update public.foundation_account_access_grants set active = false where user_id = pg_temp.uid(62);
select throws_ok($$select pg_temp.invite(62, 70)$$, 'P0001', 'workspace_seat_limit_reached', 'an inactive grant does not exempt');

-- 7. A plan code with no valid limit fails closed: never uncapped.
select pg_temp.plan(71, 'studio_access', 'team');
select throws_ok($$select pg_temp.invite(71, 72, null)$$, 'P0001', 'workspace_seat_limit_unavailable',
  'team: a call with no limits map is refused');
select throws_ok($$select public.create_foundation_workspace_invite(pg_temp.ws(71), pg_temp.uid(71), 'seat-72@example.invalid',
    'member', pg_temp.hash(72), 'seat_idempotency_0072', now() + interval '1 hour', 'seat-invite-72')$$,
  'P0001', 'workspace_seat_limit_unavailable', 'team: the eight-argument call of the earlier signature is refused');
select throws_ok($$select pg_temp.invite(71, 72, '{"personal":1}'::jsonb)$$, 'P0001', 'workspace_seat_limit_unavailable',
  'team: a map without the plan code is refused');
select throws_ok($$select pg_temp.invite(71, 72, '{"team":"5"}'::jsonb)$$, 'P0001', 'workspace_seat_limit_unavailable',
  'team: a non-number limit is refused');
select throws_ok($$select pg_temp.invite(71, 72, '{"team":0}'::jsonb)$$, 'P0001', 'workspace_seat_limit_unavailable',
  'team: a zero limit is refused');
select throws_ok($$select pg_temp.invite(71, 72, '{"team":2.5}'::jsonb)$$, 'P0001', 'workspace_seat_limit_unavailable',
  'team: a fractional limit is refused');
select throws_ok($$select pg_temp.invite(71, 72, '[5]'::jsonb)$$, 'P0001', 'workspace_seat_limit_unavailable',
  'team: a map that is not an object is refused');
select is((select count(*)::integer from public.foundation_workspace_invitations where workspace_key = pg_temp.ws(71)), 0,
  'team: none of the refused calls wrote an invite');

-- 8. A workspace already over its limit keeps its members; it only cannot add one.
select pg_temp.plan(73, 'studio_access', null);
select is((select count(*)::integer from generate_series(74, 79) i where (pg_temp.invite(73, i)->>'state') = 'pending'), 6,
  'over-limit setup: six invites while legacy');
select is((select count(*)::integer from generate_series(74, 77) i where (pg_temp.accept(i)->>'state') = 'accepted'), 4,
  'over-limit setup: four accepted (five active, two pending)');
select pg_temp.plan(73, 'studio_access', 'team');
select is(pg_temp.seats(73), 7, 'over-limit: the workspace now holds seven seats under a five-seat plan');
select throws_ok($$select pg_temp.invite(73, 80)$$, 'P0001', 'workspace_seat_limit_reached', 'over-limit: a new invite is refused');
select throws_ok($$select pg_temp.accept(78)$$, 'P0001', 'workspace_seat_limit_reached',
  'over-limit: accepting a pending invite issued before the plan change is refused (six active > five)');
select is(pg_temp.active(73), 5, 'over-limit: every existing member is still active');
select is((select state from public.foundation_workspace_invitations where invite_id = pg_temp.invite_id(78)), 'pending',
  'over-limit: the refused accept left the invite pending');

-- 9. Accept at limit-1: of two pending invites, the first accept is admitted and the second refused.
select pg_temp.plan(81, 'studio_access', null);
select is((select count(*)::integer from generate_series(82, 86) i where (pg_temp.invite(81, i)->>'state') = 'pending'), 5,
  'limit-1 setup: five invites while legacy');
select is((select count(*)::integer from generate_series(82, 84) i where (pg_temp.accept(i)->>'state') = 'accepted'), 3,
  'limit-1 setup: three accepted (four active, two pending)');
select pg_temp.plan(81, 'studio_access', 'team');
select is(pg_temp.accept(85)->>'state', 'accepted', 'limit-1: the first accept takes the fifth seat');
select throws_ok($$select pg_temp.accept(86)$$, 'P0001', 'workspace_seat_limit_reached', 'limit-1: the second accept is refused');

-- 10. Both functions take the workspace's seat lock (the two-session run is in the WO-CAT-6 receipt).
select ok(pg_temp.seat_lock_held(1), 'create takes the workspace seat lock');
select pg_temp.plan(87, 'studio_access', null);
insert into public.foundation_workspace_invitations (workspace_key, invitee_email, role, token_hash, idempotency_key, invited_by, expires_at)
values (pg_temp.ws(87), 'seat-88@example.invalid', 'member', pg_temp.hash(88), 'seat_idempotency_0088', pg_temp.uid(87), now() + interval '1 hour');
select ok(not pg_temp.seat_lock_held(87), 'no seat lock is held on a workspace before its accept');
select is(pg_temp.accept(88)->>'state', 'accepted', 'an accept on a legacy workspace (no plan code) is admitted');
select ok(pg_temp.seat_lock_held(87), 'accept takes the workspace seat lock');
-- A Free workspace refuses the accept of an invite that was pending before the one-seat rule.
insert into public.foundation_workspace_invitations (workspace_key, invitee_email, role, token_hash, idempotency_key, invited_by, expires_at)
values (pg_temp.ws(89), 'seat-99@example.invalid', 'member', pg_temp.hash(99), 'seat_idempotency_0099', pg_temp.uid(89), now() + interval '1 hour');
select throws_ok($$select pg_temp.accept(99)$$, 'P0001', 'workspace_seat_limit_reached',
  'free: accepting an earlier-pending invite would be a second active member, so it is refused');
select is((select state from public.foundation_workspace_invitations where invite_id = pg_temp.invite_id(99)), 'pending',
  'free: the refused accept left the invite pending');

-- 11. Grants are as before: service_role only; the limit helper is internal.
select ok(
  has_function_privilege('service_role', 'public.create_foundation_workspace_invite(text,uuid,text,text,text,text,timestamptz,text,jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.accept_foundation_workspace_invite(uuid,text,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.create_foundation_workspace_invite(text,uuid,text,text,text,text,timestamptz,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.accept_foundation_workspace_invite(uuid,text,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.foundation_workspace_seat_limit(text,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.foundation_workspace_seat_limit(text,jsonb)', 'EXECUTE'),
  'create/accept execute for service_role only; the seat-limit helper for nobody');
select is(
  (select count(*)::integer from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('create_foundation_workspace_invite', 'accept_foundation_workspace_invite')),
  2, 'the earlier signatures are gone: one create and one accept');

select * from finish();
rollback;
