-- Member source scopes (WO-C-T3, 20261118120000 provisional): a member reads only the sources
-- in their scope, nothing by default; owners and admins read everything; no active membership
-- reads nothing. set_member_source_scope is owner/admin only, never targets an owner/admin, and
-- records one membership event per request id; a used request id replays and never writes again. A member's own upload enters their scope with the
-- admission row. A scope lives exactly as long as one active-member tenure: whatever ends it deletes
-- the rows in the same transaction, and a re-accepted invite starts with none.
begin;
select plan(69);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000',
  (lpad(i::text, 8, '0') || '-5c0e-4c0e-8c0e-5c0e5c0e5c0e')::uuid,
  'authenticated', 'authenticated', 'scope-' || i || '@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
from generate_series(1, 6) i;

create function pg_temp.uid(i integer) returns uuid language sql immutable as $$
  select (lpad(i::text, 8, '0') || '-5c0e-4c0e-8c0e-5c0e5c0e5c0e')::uuid
$$;
create function pg_temp.ws(i integer) returns text language sql immutable as $$
  select 'pilot-' || left(regexp_replace(pg_temp.uid(i)::text, '[^A-Za-z0-9]', '', 'g'), 16)
$$;
create function pg_temp.doc(i integer) returns text language sql immutable as $$
  select (lpad(i::text, 8, '0') || '-d0c0-4d0c-8d0c-d0c0d0c0d0c0')
$$;
create function pg_temp.hash(i integer) returns text language sql immutable as $$
  select 'sha256:' || md5('scope-token-' || i) || md5('scope-token-' || i || '#')
$$;
-- Owner 1 invites user i with role r; user i accepts.
create function pg_temp.join(i integer, r text) returns void language sql as $$
  select public.create_foundation_workspace_invite(pg_temp.ws(1), pg_temp.uid(1), 'scope-' || i || '@example.invalid', r,
    pg_temp.hash(i), 'scope_idempotency_' || lpad(i::text, 4, '0'), now() + interval '1 hour', 'scope-invite-' || i);
  select public.accept_foundation_workspace_invite(pg_temp.uid(i), pg_temp.hash(i), 'scope-accept-' || i);
$$;
create function pg_temp.outside(i integer, docs integer[]) returns boolean language sql as $$
  select public.documents_outside_member_scope(pg_temp.ws(1), pg_temp.uid(i), array(select pg_temp.doc(d) from unnest(docs) d))
$$;
create function pg_temp.readable(i integer, docs integer[]) returns text[] language sql as $$
  select array(select x from unnest(public.member_readable_document_ids(pg_temp.ws(1), pg_temp.uid(i),
    array(select pg_temp.doc(d) from unnest(docs) d))) x order by x)
$$;
create function pg_temp.set_scope(actor integer, member integer, kind text, docs integer[], req text) returns jsonb language sql as $$
  select public.set_member_source_scope(pg_temp.ws(1), pg_temp.uid(actor), pg_temp.uid(member), kind,
    case when docs is null then null else array(select pg_temp.doc(d)::uuid from unnest(docs) d) end, req)
$$;
create function pg_temp.events(member integer) returns integer language sql as $$
  select count(*)::integer from public.foundation_workspace_membership_events
   where workspace_key = pg_temp.ws(1) and subject_user_id = pg_temp.uid(member) and action = 'member.source_scope_changed'
$$;
create function pg_temp.admit(i integer, d integer) returns void language sql as $$
  insert into public.foundation_intake_admissions (workspace_key, document_id, user_id, object_key, requested_bytes, declared_mime_type, expires_at)
  values (pg_temp.ws(1), pg_temp.doc(d)::uuid, pg_temp.uid(i), 'quarantine/' || pg_temp.ws(1) || '/' || pg_temp.doc(d) || '/source',
    1024, 'application/pdf', now() + interval '10 minutes')
$$;

-- ws(1) is a legacy-plan workspace (plan_code null, uncapped): a Free workspace has one seat (20261127100000), so a
-- workspace with several members needs a plan row first. Not a statement, so the plan count is unchanged.
insert into public.foundation_billing_accounts (workspace_key, user_id, access_plan, plan_code, subscription_status)
values (pg_temp.ws(1), pg_temp.uid(1), 'studio_access', null, 'active');

-- User 1 owns ws(1); 2 is an admin there, 3 and 4 members; 5 owns only their own workspace.
select pg_temp.join(2, 'admin');
select pg_temp.join(3, 'member');
select pg_temp.join(4, 'member');

select has_table('public', 'foundation_workspace_member_source_scopes', 'the scope table exists');

-- 1. Defaults (TC-D1): a member with no row reads nothing; owner and admin read everything.
select is(pg_temp.outside(3, array[1]), true, 'a member with no scope row reads no source');
select is(pg_temp.readable(3, array[1, 2]), '{}'::text[], 'and has no readable id');
select is(pg_temp.outside(3, array[]::integer[]), false, 'an empty request by an active member asks for nothing outside');
select is(pg_temp.outside(1, array[1, 2, 3]), false, 'the owner reads every source');
select is(pg_temp.outside(2, array[1, 2, 3]), false, 'an admin reads every source');
select is(pg_temp.readable(2, array[2, 1, 2]), array[pg_temp.doc(1), pg_temp.doc(2)], 'an admin gets every id back, once');
select is(pg_temp.outside(5, array[1]), true, 'a user with no membership here reads nothing');
select is(pg_temp.outside(5, array[]::integer[]), true, 'and is refused even for an empty request');
select is(pg_temp.readable(5, array[1]), '{}'::text[], 'and has no readable id');

-- 2. A listed scope.
select is(pg_temp.set_scope(1, 3, 'listed', array[1, 2], 'scope-set-0001')->>'idempotentReplay', 'false', 'the owner lists two sources for member 3');
select is(pg_temp.outside(3, array[1, 2]), false, 'member 3 reads both listed sources');
select is(pg_temp.outside(3, array[1, 3]), true, 'one source outside the list refuses the whole set');
select is(pg_temp.readable(3, array[1, 2, 3]), array[pg_temp.doc(1), pg_temp.doc(2)], 'the readable subset is exactly the listed sources');
select is(pg_temp.outside(4, array[1]), true, 'another member is unaffected by member 3''s scope');
select is(pg_temp.events(3), 1, 'one membership event records the change');
select ok((select details ? 'before' and details ? 'after' and details->>'before' <> details->>'after'
             and details->>'before' = public.foundation_member_source_scope_digest('listed', '{}'::uuid[])
             and details->>'after' = public.foundation_member_source_scope_digest('listed', array[pg_temp.doc(2)::uuid, pg_temp.doc(1)::uuid])
             and actor_user_id = pg_temp.uid(1) and request_id = 'scope-set-0001'
           from public.foundation_workspace_membership_events
          where subject_user_id = pg_temp.uid(3) and action = 'member.source_scope_changed' and request_id = 'scope-set-0001'),
  'the event carries the actor, the request id and the before/after digests');
select is(pg_temp.set_scope(1, 3, 'listed', array[2, 1, 1], 'scope-set-0002')->>'idempotentReplay', 'true', 'the same set in another order is a replay');
select is(pg_temp.events(3), 2, 'a request that changes nothing still records its request id');
select is(public.documents_outside_member_scope(pg_temp.ws(1), pg_temp.uid(3), array[upper(pg_temp.doc(1))]), true,
  'an id spelled other than the stored canonical form is not covered');

-- 3. Narrowing takes effect on the next statement.
select pg_temp.set_scope(2, 3, 'listed', array[2], 'scope-set-0003');
select is(pg_temp.outside(3, array[1]), true, 'an admin narrows the scope and the removed source is refused at once');
select is(pg_temp.outside(3, array[2]), false, 'the kept source stays readable');
select is(pg_temp.events(3), 3, 'the narrowing is recorded');
-- A late retry of an earlier request id replays; it must not undo the narrowing.
select is(pg_temp.set_scope(1, 3, 'listed', array[1, 2], 'scope-set-0001')->>'idempotentReplay', 'true', 'a late retry of an earlier request id is a replay');
select is(pg_temp.outside(3, array[1]), true, 'and does not undo the later narrowing');
select is(pg_temp.set_scope(1, 3, 'listed', array[1, 2], 'scope-set-0002')->>'idempotentReplay', 'true', 'nor does a late retry of a request that changed nothing');
select is(pg_temp.outside(3, array[1]), true, 'the narrowing still holds');
select is(pg_temp.events(3), 3, 'retries record nothing');
select throws_ok($$select pg_temp.set_scope(2, 3, 'listed', array[1], 'scope-set-0003')$$, 'P0001', 'member_source_scope_idempotency_conflict',
  'a used request id with another scope is refused');

-- 4. All, then nothing.
select pg_temp.set_scope(1, 3, 'all', null, 'scope-set-0004');
select is(pg_temp.outside(3, array[1, 2, 3]), false, 'an all scope reads every source, including ones admitted later');
select is((select count(*)::integer from public.foundation_workspace_member_source_scopes
            where workspace_key = pg_temp.ws(1) and user_id = pg_temp.uid(3)), 1, 'all is one row');
select pg_temp.set_scope(1, 3, 'listed', array[]::integer[], 'scope-set-0005');
select is(pg_temp.outside(3, array[2]), true, 'an empty list reads nothing');
select is(public.get_member_source_scope(pg_temp.ws(1), pg_temp.uid(1), pg_temp.uid(3))->>'kind', 'none', 'and reads back as none');

-- 5. Who may set, and whom.
select throws_ok($$select pg_temp.set_scope(4, 3, 'all', null, 'scope-set-0006')$$, 'P0001', 'member_source_scope_forbidden',
  'a member cannot set a scope');
select throws_ok($$select pg_temp.set_scope(5, 3, 'all', null, 'scope-set-0007')$$, 'P0001', 'member_source_scope_forbidden',
  'a non-member cannot set a scope');
select throws_ok($$select pg_temp.set_scope(1, 2, 'listed', array[1], 'scope-set-0008')$$, 'P0001', 'member_source_scope_target_forbidden',
  'an admin cannot be given a scope');
select throws_ok($$select pg_temp.set_scope(2, 1, 'listed', array[1], 'scope-set-0009')$$, 'P0001', 'member_source_scope_target_forbidden',
  'nor can the owner');
select throws_ok($$select pg_temp.set_scope(1, 5, 'all', null, 'scope-set-0010')$$, 'P0001', 'workspace_member_not_found',
  'a user who is not a member cannot be given a scope');
select throws_ok($$select pg_temp.set_scope(1, 3, 'all', array[1], 'scope-set-0011')$$, 'P0001', 'member_source_scope_input_invalid',
  'all with ids is refused');
select throws_ok($$select pg_temp.set_scope(1, 3, 'some', array[1], 'scope-set-0012')$$, 'P0001', 'member_source_scope_input_invalid',
  'an unknown kind is refused');
select throws_ok($$select pg_temp.set_scope(1, 3, 'listed', null, 'scope-set-0013')$$, 'P0001', 'member_source_scope_input_invalid',
  'listed without ids is refused');
select throws_ok($$select public.set_member_source_scope(pg_temp.ws(1), pg_temp.uid(1), pg_temp.uid(3), 'listed',
    (select array_agg(gen_random_uuid()) from generate_series(1, 2001)), 'scope-set-0014')$$, 'P0001', 'member_source_scope_input_invalid',
  'more than 2,000 ids are refused');
select throws_ok($$select public.documents_outside_member_scope('not-a-workspace', pg_temp.uid(3), array['x'])$$, 'P0001',
  'member_source_scope_input_invalid', 'a malformed workspace key is refused, not answered');
select throws_ok($$select public.documents_outside_member_scope(pg_temp.ws(1), pg_temp.uid(3), array[null]::text[])$$, 'P0001',
  'member_source_scope_input_invalid', 'a null id is refused, not answered');
select throws_ok($$select public.get_member_source_scope(pg_temp.ws(1), pg_temp.uid(4), pg_temp.uid(3))$$, 'P0001',
  'member_source_scope_forbidden', 'a member cannot read another member''s scope');

-- 6. A revoked member reads nothing, whatever their rows say.
select pg_temp.set_scope(1, 4, 'all', null, 'scope-set-0015');
select public.revoke_foundation_workspace_member(pg_temp.ws(1), pg_temp.uid(1), pg_temp.uid(4), 'scope-revoke-4');
select is(pg_temp.outside(4, array[1]), true, 'a revoked member with an all scope is refused on the next statement');
select is(pg_temp.readable(4, array[1]), '{}'::text[], 'and has no readable id');

-- 7. A member's own upload enters their scope in the admission's transaction.
select pg_temp.admit(3, 7);
select is(pg_temp.outside(3, array[7]), false, 'member 3''s own upload is in their scope');
select is(pg_temp.outside(3, array[2]), true, 'and nothing else was added');
select pg_temp.admit(1, 8);
select is((select count(*)::integer from public.foundation_workspace_member_source_scopes where document_id = pg_temp.doc(8)::uuid), 0,
  'an owner''s upload writes no scope row');
select is(pg_temp.outside(3, array[8]), true, 'and is not in a member''s scope');

-- 8. Privileges: RPC only.
select ok(not has_table_privilege('service_role', 'public.foundation_workspace_member_source_scopes', 'select')
      and not has_table_privilege('service_role', 'public.foundation_workspace_member_source_scopes', 'insert')
      and not has_table_privilege('authenticated', 'public.foundation_workspace_member_source_scopes', 'select'),
  'no role reads or writes the scope table directly');
select ok(has_function_privilege('service_role', 'public.documents_outside_member_scope(text, uuid, text[])', 'execute')
      and has_function_privilege('service_role', 'public.set_member_source_scope(text, uuid, uuid, text, uuid[], text)', 'execute')
      and not has_function_privilege('authenticated', 'public.documents_outside_member_scope(text, uuid, text[])', 'execute')
      and not has_function_privilege('anon', 'public.set_member_source_scope(text, uuid, uuid, text, uuid[], text)', 'execute')
      and not has_function_privilege('service_role', 'public.foundation_member_upload_scope()', 'execute'),
  'the functions execute for service_role only, and the trigger function for nobody');

-- 9. A scope lives exactly as long as one uninterrupted active-member tenure. Whatever ends it --
-- revocation, a role change, a deleted row, by today's functions or by a direct write -- deletes the
-- rows in that statement, and a re-activated row starts with none (lead ruling 2026-11-18).
-- 9a. Revoke (section 6), re-invite, accept: the old `all` scope does not come back.
select is((select count(*)::integer from public.foundation_workspace_member_source_scopes
            where workspace_key = pg_temp.ws(1) and user_id = pg_temp.uid(4)), 0,
  'the revocation deleted member 4''s scope rows in its own transaction');
select public.create_foundation_workspace_invite(pg_temp.ws(1), pg_temp.uid(1), 'scope-4@example.invalid', 'member',
  pg_temp.hash(40), 'scope_idempotency_0040', now() + interval '1 hour', 'scope-reinvite-4');
select public.accept_foundation_workspace_invite(pg_temp.uid(4), pg_temp.hash(40), 'scope-reaccept-4');
select is((select count(*)::integer from public.foundation_workspace_member_source_scopes
            where workspace_key = pg_temp.ws(1) and user_id = pg_temp.uid(4)), 0,
  'the re-accepted member starts with no scope row');
select is(pg_temp.outside(4, array[1]), true, 'and reads no source');
select is(pg_temp.readable(4, array[1, 2, 3, 7, 8]), '{}'::text[], 'and has no readable id');
select is(public.get_member_source_scope(pg_temp.ws(1), pg_temp.uid(1), pg_temp.uid(4))->>'kind', 'none',
  'and reads back as none to the owner');
select is(pg_temp.set_scope(1, 4, 'all', null, 'scope-set-0015')->>'idempotentReplay', 'true',
  'a late retry of the pre-revocation grant is a replay');
select is(pg_temp.outside(4, array[1]), true, 'and does not bring the old scope back');

-- 9b. A role change through the real function: member -> admin -> member starts again with nothing.
select public.change_foundation_workspace_member_role(pg_temp.ws(1), pg_temp.uid(1), pg_temp.uid(3), 'admin', 'scope-role-3a');
select is((select count(*)::integer from public.foundation_workspace_member_source_scopes
            where workspace_key = pg_temp.ws(1) and user_id = pg_temp.uid(3)), 0,
  'promoting member 3 deleted their scope rows');
select public.change_foundation_workspace_member_role(pg_temp.ws(1), pg_temp.uid(1), pg_temp.uid(3), 'member', 'scope-role-3b');
select is(pg_temp.outside(3, array[7]), true, 'demoted back to member, they read no source, not even the old upload');

-- 9c. The class, by direct writes (the statement any present or future membership function makes):
-- every move off (active, member) leaves no scope row.
create function pg_temp.end_tenure(i integer, st text, r text, req text) returns integer language plpgsql as $$
begin
  perform pg_temp.set_scope(1, i, 'listed', array[1, 2], req);
  update public.foundation_workspace_members
     set state = st, role = r, revoked_at = case when st = 'revoked' then clock_timestamp() end,
         updated_at = clock_timestamp()
   where workspace_key = pg_temp.ws(1) and user_id = pg_temp.uid(i);
  return (select count(*)::integer from public.foundation_workspace_member_source_scopes
           where workspace_key = pg_temp.ws(1) and user_id = pg_temp.uid(i));
end
$$;
create function pg_temp.reactivate(i integer) returns void language sql as $$
  update public.foundation_workspace_members
     set state = 'active', role = 'member', revoked_at = null, accepted_at = clock_timestamp(), updated_at = clock_timestamp()
   where workspace_key = pg_temp.ws(1) and user_id = pg_temp.uid(i);
$$;
select pg_temp.join(6, 'member');
select is(pg_temp.end_tenure(6, 'active', 'admin', 'scope-class-0001'), 0, 'active member -> active admin leaves no scope row');
select pg_temp.reactivate(6);
select is(pg_temp.end_tenure(6, 'revoked', 'member', 'scope-class-0002'), 0, 'active member -> revoked member leaves no scope row');
select pg_temp.reactivate(6);
select is(pg_temp.end_tenure(6, 'revoked', 'admin', 'scope-class-0003'), 0, 'active member -> revoked admin leaves no scope row');
-- And no writer can attach a row to anything but an active member.
select throws_ok($$insert into public.foundation_workspace_member_source_scopes (workspace_key, user_id, scope_kind, document_id, granted_by)
    values (pg_temp.ws(1), pg_temp.uid(6), 'all', null, pg_temp.uid(1))$$, 'P0001', 'member_source_scope_membership_inactive',
  'a scope row for a revoked membership is refused');
select throws_ok($$insert into public.foundation_workspace_member_source_scopes (workspace_key, user_id, scope_kind, document_id, granted_by)
    values (pg_temp.ws(1), pg_temp.uid(2), 'all', null, pg_temp.uid(1))$$, 'P0001', 'member_source_scope_membership_inactive',
  'a scope row for an admin is refused');
-- A deleted membership row takes its scope with it instead of being blocked by it.
select pg_temp.set_scope(1, 4, 'listed', array[1], 'scope-set-0040');
select lives_ok($$delete from public.foundation_workspace_members where workspace_key = pg_temp.ws(1) and user_id = pg_temp.uid(4)$$,
  'a membership row with scope rows can be deleted');
select is((select count(*)::integer from public.foundation_workspace_member_source_scopes
            where workspace_key = pg_temp.ws(1) and user_id = pg_temp.uid(4)), 0, 'and its scope rows go with it');

select * from finish();
rollback;
