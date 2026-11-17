-- WO-AN-1 agent proposals (migration 20261117130000): grants, agent credentials, agent proposals,
-- the open cap, revocation, the kill switch, the compile quote, the correction-leaf record and the
-- read RPCs' volatility.
--
-- What it proves (workorders/agent-native.md §8): I-10 expiry by the DB clock, p_now ignored;
-- I-11 (DB half) a revoked grant withdraws its open proposals in the same transaction and a
-- membership change makes the decision `withdrawn`; I-13 the open cap counts a person's proposals
-- across every grant, and a batch reserve refuses the whole batch; I-14 (DB half) a replay by
-- another principal or grant conflicts; I-20 (DB half) revoke-all ends every agent grant, key and
-- open proposal and leaves live keys alone; I-24 (DB half) an agent key needs a grant, agent-only
-- scopes and an expiry, and the developer create RPC cannot mint one; I-25 one callable signature
-- each for create and decide, and old named-argument calls still resolve; the quote returns exactly
-- the rows the re-charge trigger loops over and its overage equals the overage the trigger books;
-- record-if-leaf replays and refuses a second correction of one base; I-1 every read RPC is
-- stable or immutable.
--
-- Not provable here (one transaction): the races of I-8, I-12 and I-13 under concurrent sessions --
-- scripts/db/agent-grant-race.mjs runs those against a local cluster.
begin;
select plan(90);

create temp table keep (k text primary key, v jsonb);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'aa000001-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated',
   'agent-a@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bb000002-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated',
   'agent-b@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cc000003-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated',
   'agent-c@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'dd000004-0000-4000-8000-0000000000d4', 'authenticated', 'authenticated',
   'agent-d@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ee000005-0000-4000-8000-0000000000e5', 'authenticated', 'authenticated',
   'agent-e@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
-- The auth.users trigger made each person the active owner of 'pilot-' || the first 16 hex digits of
-- their id, at authorization revision 1.

create function pg_temp.agent_grant(p_ws text, p_user uuid, p_prefix text, p_rev bigint) returns jsonb language sql as $$
  select public.create_foundation_agent_grant(p_ws, p_user, p_rev, 'Test agent', 'person@example.invalid', p_prefix,
    encode(sha256(convert_to('tvnl_agt_' || p_prefix, 'UTF8')), 'hex'), array['agent:read', 'agent:propose'],
    now() + interval '30 days');
$$;
create function pg_temp.agent_propose(p_ws text, p_user uuid, p_grant uuid, p_key text, p_limit integer, p_reserve integer)
returns jsonb language sql as $$
  select public.create_world_change_proposal(p_ws, 'collection-' || repeat('a', 32), 'library_label', '{"labelKey":"contract"}',
    'sha256:' || repeat('1', 64), '{}', 'sha256:' || repeat('d', 64), 1, 'agent', p_user, p_key, now() + interval '7 days',
    'active_manifest', p_grant, p_limit, p_reserve);
$$;
create function pg_temp.id_of(p_k text) returns uuid language sql as $$
  select coalesce((v->'proposal'->>'proposal_id'), v->>'grantId', v->>'keyId')::uuid from keep where k = p_k;
$$;

-- ---------------------------------------------------------------------------------------------
-- Shape and the client boundary.
-- ---------------------------------------------------------------------------------------------
select has_table('public', 'foundation_agent_grants', 'the grants table exists');
select ok(not has_table_privilege('service_role', 'public.foundation_agent_grants', 'select'), 'the grants table has no grant, service_role included');
select ok(not has_table_privilege('authenticated', 'public.foundation_agent_grants', 'select'), 'a signed-in client cannot read grants');
select ok(has_function_privilege('service_role',
  'public.create_foundation_agent_grant(text, uuid, bigint, text, text, text, text, text[], timestamptz)', 'execute'),
  'the server may create a grant');
select ok(not has_function_privilege('authenticated', 'public.revoke_all_foundation_agent_grants()', 'execute'),
  'a signed-in client cannot pull the kill switch');
select ok(not has_function_privilege('anon', 'public.quote_foundation_compile_recharge(text, uuid[])', 'execute'),
  'an anonymous client cannot read a quote');

-- I-25: one callable signature each; the deployed named-argument calls still resolve.
select is((select count(*)::integer from pg_proc where proname = 'create_world_change_proposal'), 1, 'one create function');
select is((select count(*)::integer from pg_proc where proname = 'decide_world_change_proposal'), 1, 'one decide function');
select lives_ok($$select public.create_world_change_proposal(p_workspace_key => 'pilot-aa00000100004000',
  p_collection_id => 'collection-' || repeat('a', 32), p_action_type => 'library_label', p_input => '{"labelKey":"memo"}',
  p_input_sha256 => 'sha256:' || repeat('2', 64), p_evidence_ids => '{}', p_expected_manifest_digest => 'sha256:' || repeat('d', 64),
  p_authorization_revision => 1, p_principal_kind => 'session', p_principal_id => 'aa000001-0000-4000-8000-0000000000a1',
  p_idempotency_key => 'named-12-args', p_expires_at => now() + interval '7 days')$$, 'a twelve-named-argument create still resolves');
select lives_ok($$select public.decide_world_change_proposal(p_workspace_key => 'pilot-aa00000100004000',
  p_proposal_id => (select proposal_id from public.world_change_proposals where idempotency_key = 'named-12-args'),
  p_decision => 'reject', p_decided_by => 'aa000001-0000-4000-8000-0000000000a1',
  p_current_manifest_digest => 'sha256:' || repeat('d', 64), p_now => now())$$, 'a six-named-argument decide still resolves');

-- I-10: expiry is the database clock's; p_now is ignored either way.
insert into keep select 'exp', public.create_world_change_proposal('pilot-aa00000100004000', 'collection-' || repeat('a', 32),
  'library_label', '{"labelKey":"report"}', 'sha256:' || repeat('3', 64), '{}', 'sha256:' || repeat('d', 64), 1, 'session',
  'aa000001-0000-4000-8000-0000000000a1', 'key-expired1', now() + interval '1 day');
update public.world_change_proposals set expires_at = now() - interval '1 second' where proposal_id = pg_temp.id_of('exp');
select is((public.decide_world_change_proposal('pilot-aa00000100004000', pg_temp.id_of('exp'), 'confirm',
  'aa000001-0000-4000-8000-0000000000a1', 'sha256:' || repeat('d', 64), now() - interval '2 days'))->>'state', 'expired',
  'a row past its expiry is expired even when p_now says it is not');
insert into keep select 'live', public.create_world_change_proposal('pilot-aa00000100004000', 'collection-' || repeat('a', 32),
  'library_label', '{"labelKey":"letter"}', 'sha256:' || repeat('4', 64), '{}', 'sha256:' || repeat('d', 64), 1, 'session',
  'aa000001-0000-4000-8000-0000000000a1', 'key-live0001', now() + interval '1 day');
select is((public.decide_world_change_proposal('pilot-aa00000100004000', pg_temp.id_of('live'), 'confirm',
  'aa000001-0000-4000-8000-0000000000a1', 'sha256:' || repeat('d', 64), now() + interval '30 days'))->>'state', 'confirmed',
  'a row inside its expiry is decided even when p_now is far in the future');

-- ---------------------------------------------------------------------------------------------
-- Grants and agent credentials (I-24, DB half).
-- ---------------------------------------------------------------------------------------------
select throws_ok($$select pg_temp.agent_grant('pilot-aa00000100004000', 'aa000001-0000-4000-8000-0000000000a1', 'agentStale01', 2)$$,
  'P0001', 'api_key_authorization_changed', 'a grant at a stale membership revision is refused');
insert into keep select 'g1', pg_temp.agent_grant('pilot-aa00000100004000', 'aa000001-0000-4000-8000-0000000000a1', 'agentGrant01', 1);
insert into keep select 'g1b', pg_temp.agent_grant('pilot-aa00000100004000', 'aa000001-0000-4000-8000-0000000000a1', 'agentGrant02', 1);
select is((select token_kind || '|' || (agent_grant_id = pg_temp.id_of('g1'))::text || '|' || (expires_at is not null)::text
  from public.foundation_api_keys where key_prefix = 'agentGrant01'), 'agent|true|true',
  'the grant RPC mints an agent key bound to its grant, with an expiry');
select ok(exists (select 1 from public.foundation_developer_audit_events
  where action = 'api_key_created' and target_id = (select v->>'keyId' from keep where k = 'g1')
    and details->>'tokenKind' = 'agent' and details->>'grantId' = (select v->>'grantId' from keep where k = 'g1')),
  'the creation is audited as api_key_created with tokenKind agent and the grant id');
select throws_ok($$insert into public.foundation_api_keys (workspace_key, name, key_prefix, token_sha256, scopes, created_by, expires_at, token_kind)
  values ('pilot-aa00000100004000', 'x', 'noGrantKey01', repeat('a', 64), array['agent:read'], 'aa000001-0000-4000-8000-0000000000a1',
    now() + interval '1 day', 'agent')$$, '23514', null, 'an agent key without a grant violates a CHECK');
select throws_ok($$insert into public.foundation_api_keys (workspace_key, name, key_prefix, token_sha256, scopes, created_by, expires_at, token_kind, agent_grant_id)
  values ('pilot-aa00000100004000', 'x', 'devScopeKey1', repeat('b', 64), array['agent:read', 'worlds:read'], 'aa000001-0000-4000-8000-0000000000a1',
    now() + interval '1 day', 'agent', pg_temp.id_of('g1'))$$, '23514', null, 'an agent key with a developer scope violates a CHECK');
select throws_ok($$insert into public.foundation_api_keys (workspace_key, name, key_prefix, token_sha256, scopes, created_by, expires_at, token_kind, agent_grant_id)
  values ('pilot-aa00000100004000', 'x', 'noExpiryKey1', repeat('c', 64), array['agent:read'], 'aa000001-0000-4000-8000-0000000000a1',
    null, 'agent', pg_temp.id_of('g1'))$$, '23514', null, 'an agent key without an expiry violates a CHECK');
select throws_ok($$select public.create_foundation_api_key_authorized('pilot-aa00000100004000', 'x', 'devRpcAgent1', repeat('e', 64),
  array['agent:read'], now() + interval '1 day', 'aa000001-0000-4000-8000-0000000000a1', 1, 'agent')$$, '23514', null,
  'the developer key RPC cannot mint an agent key');
select throws_ok($$select public.create_foundation_api_key_authorized('pilot-aa00000100004000', 'x', 'liveAgentSc1', repeat('f', 64),
  array['agent:propose'], null, 'aa000001-0000-4000-8000-0000000000a1', 1, 'live')$$, '23514', null,
  'a developer key cannot hold an agent scope');

-- The rate-limit RPC knows the agent scopes and still refuses an unknown one.
select ok(public.consume_foundation_api_rate_limit((select key_id from public.foundation_api_keys where key_prefix = 'agentGrant01'),
  'pilot-aa00000100004000', 'agent:read', 120), 'agent:read is a rate-limited scope');
select ok(not public.consume_foundation_api_rate_limit((select key_id from public.foundation_api_keys where key_prefix = 'agentGrant01'),
  'pilot-aa00000100004000', 'agent:write', 120), 'an unknown scope is still refused');

-- ---------------------------------------------------------------------------------------------
-- Agent proposals (I-14, DB half) and what a create refuses.
-- ---------------------------------------------------------------------------------------------
insert into keep select 'a1', pg_temp.agent_propose('pilot-aa00000100004000', 'aa000001-0000-4000-8000-0000000000a1',
  pg_temp.id_of('g1'), 'agt_first00001', 200, 1);
select is((select v->'proposal'->>'principal_kind' || '|' || (v->>'replayed') from keep where k = 'a1'), 'agent|false',
  'an agent proposal is created under its grant');
select is((pg_temp.agent_propose('pilot-aa00000100004000', 'aa000001-0000-4000-8000-0000000000a1',
  pg_temp.id_of('g1'), 'agt_first00001', 200, 1))->>'replayed', 'true', 'the same key, grant and input replays');
select throws_ok($$select pg_temp.agent_propose('pilot-aa00000100004000', 'aa000001-0000-4000-8000-0000000000a1',
  pg_temp.id_of('g1b'), 'agt_first00001', 200, 1)$$, 'P0001', 'proposal_idempotency_conflict',
  'the same stored key under another grant of the same person is a conflict, never a replay');
select throws_ok($$select public.create_world_change_proposal('pilot-aa00000100004000', 'collection-' || repeat('a', 32), 'library_label',
  '{"labelKey":"contract"}', 'sha256:' || repeat('1', 64), '{}', 'sha256:' || repeat('d', 64), 1, 'session',
  'aa000001-0000-4000-8000-0000000000a1', 'agt_first00001', now() + interval '7 days')$$, 'P0001', 'proposal_idempotency_conflict',
  'the same stored key by a session principal is a conflict');
select is((pg_temp.agent_propose('pilot-aa00000100004000', 'aa000001-0000-4000-8000-0000000000a1',
  pg_temp.id_of('g1b'), 'agt_second0001', 200, 1))->>'replayed', 'false', 'another grant with its own stored key makes its own row');
select throws_ok($$select public.create_world_change_proposal('pilot-aa00000100004000', 'collection-' || repeat('a', 32), 'library_label',
  '{"labelKey":"contract"}', 'sha256:' || repeat('1', 64), '{}', 'sha256:' || repeat('d', 64), 2, 'agent',
  'aa000001-0000-4000-8000-0000000000a1', 'agt_wrongrev01', now() + interval '7 days', 'active_manifest', pg_temp.id_of('g1'), 200, 1)$$,
  'P0001', 'proposal_agent_grant_revoked', 'an agent proposal at another revision than its grant is refused');
select throws_ok($$select pg_temp.agent_propose('pilot-aa00000100004000', 'bb000002-0000-4000-8000-0000000000b2',
  pg_temp.id_of('g1'), 'agt_otheruser1', 200, 1)$$, 'P0001', 'proposal_agent_grant_revoked',
  'a grant cannot carry another person''s proposal');
select throws_ok($$select public.create_world_change_proposal('pilot-aa00000100004000', 'collection-' || repeat('a', 32), 'library_label',
  '{"labelKey":"contract"}', 'sha256:' || repeat('1', 64), '{}', 'sha256:' || repeat('d', 64), 1, 'agent',
  'aa000001-0000-4000-8000-0000000000a1', 'agt_nolimit001', now() + interval '7 days', 'active_manifest', pg_temp.id_of('g1'))$$,
  'P0001', 'proposal_request_invalid', 'an agent proposal must name its open limit');
select throws_ok($$select public.create_world_change_proposal('pilot-aa00000100004000', 'collection-' || repeat('a', 32), 'library_label',
  '{"labelKey":"contract"}', 'sha256:' || repeat('1', 64), '{}', 'sha256:' || repeat('d', 64), 1, 'session',
  'aa000001-0000-4000-8000-0000000000a1', 'sess-grant001', now() + interval '7 days', 'active_manifest', pg_temp.id_of('g1'))$$,
  'P0001', 'proposal_request_invalid', 'a session proposal cannot name a grant');

-- Binding pairs and the nullable collection.
select throws_ok($$select public.create_world_change_proposal('pilot-aa00000100004000', 'collection-' || repeat('a', 32), 'compile_plan',
  '{"documentIds":[]}', 'sha256:' || repeat('5', 64), '{}', 'sha256:' || repeat('d', 64), 1, 'session',
  'aa000001-0000-4000-8000-0000000000a1', 'compile-with-coll', now() + interval '7 days', 'source_inventory')$$,
  'P0001', 'proposal_request_invalid', 'a compile proposal cannot name a collection');
select lives_ok($$select public.create_world_change_proposal('pilot-aa00000100004000', null, 'compile_plan',
  '{"documentIds":[]}', 'sha256:' || repeat('5', 64), '{}', 'sha256:' || repeat('d', 64), 1, 'session',
  'aa000001-0000-4000-8000-0000000000a1', 'compile-no-coll', now() + interval '7 days', 'source_inventory')$$,
  'a compile proposal with no collection and a source-inventory binding is stored');
select throws_ok($$insert into public.world_change_proposals (workspace_key, collection_id, action_type, input, input_sha256,
  expected_manifest_digest, authorization_revision, principal_kind, principal_id, idempotency_key, expires_at, binding_kind)
  values ('pilot-aa00000100004000', 'collection-' || repeat('a', 32), 'compile_plan', '{}', 'sha256:' || repeat('6', 64),
    'sha256:' || repeat('d', 64), 1, 'session', 'aa000001-0000-4000-8000-0000000000a1', 'direct-compile1', now() + interval '1 day',
    'source_inventory')$$, '23514', null, 'the table refuses a compile row with a collection');
select throws_ok($$insert into public.world_change_proposals (workspace_key, collection_id, action_type, input, input_sha256,
  expected_manifest_digest, authorization_revision, principal_kind, principal_id, idempotency_key, expires_at)
  values ('pilot-aa00000100004000', null, 'library_label', '{}', 'sha256:' || repeat('6', 64),
    'sha256:' || repeat('d', 64), 1, 'session', 'aa000001-0000-4000-8000-0000000000a1', 'direct-label01', now() + interval '1 day')$$,
  '23514', null, 'the table refuses a label row with no collection');
select throws_ok($$insert into public.world_change_proposals (workspace_key, collection_id, action_type, input, input_sha256,
  expected_manifest_digest, authorization_revision, principal_kind, principal_id, idempotency_key, expires_at, state, decided_at)
  values ('pilot-aa00000100004000', 'collection-' || repeat('a', 32), 'library_label', '{}', 'sha256:' || repeat('6', 64),
    'sha256:' || repeat('d', 64), 1, 'session', 'aa000001-0000-4000-8000-0000000000a1', 'direct-withdr1', now() + interval '1 day',
    'withdrawn', now())$$, '23514', null, 'only an agent row can be withdrawn');

-- Reads by id and by page.
select is((public.get_world_change_proposal('pilot-aa00000100004000', pg_temp.id_of('a1')))->>'agent_client_label', 'Test agent',
  'a read by id carries the grant''s client label');
select throws_ok($$select public.get_world_change_proposal('pilot-bb00000200004000', pg_temp.id_of('a1'))$$,
  'P0001', 'proposal_not_found', 'another workspace cannot read the id');
select is(jsonb_array_length(public.list_world_change_proposals_page('pilot-aa00000100004000', pg_temp.id_of('g1b'), null, null, 50)), 1,
  'the page filtered by grant holds only that grant''s row');
insert into keep select 'page1', public.list_world_change_proposals_page('pilot-aa00000100004000', null, null, null, 1);
select isnt((public.list_world_change_proposals_page('pilot-aa00000100004000', null,
    (select (v->0->>'created_at')::timestamptz from keep where k = 'page1'), (select (v->0->>'proposal_id')::uuid from keep where k = 'page1'), 1))->0->>'proposal_id',
  (select v->0->>'proposal_id' from keep where k = 'page1'), 'the next keyset page starts after the last row of the previous one');

-- ---------------------------------------------------------------------------------------------
-- I-13: the open cap is per person, across grants; a batch reserve refuses the whole batch.
-- ---------------------------------------------------------------------------------------------
insert into keep select 'g3a', pg_temp.agent_grant('pilot-cc00000300004000', 'cc000003-0000-4000-8000-0000000000c3', 'agentCapA001', 1);
insert into keep select 'g3b', pg_temp.agent_grant('pilot-cc00000300004000', 'cc000003-0000-4000-8000-0000000000c3', 'agentCapB001', 1);
select count(*) from (select pg_temp.agent_propose('pilot-cc00000300004000', 'cc000003-0000-4000-8000-0000000000c3',
  pg_temp.id_of('g3a'), 'cap-' || lpad(i::text, 4, '0'), 200, 1) from generate_series(1, 200) i) seeded;
select throws_ok($$select pg_temp.agent_propose('pilot-cc00000300004000', 'cc000003-0000-4000-8000-0000000000c3',
  pg_temp.id_of('g3b'), 'cap-new-grant', 200, 1)$$, 'P0001', 'proposal_open_limit',
  'the 201st open proposal is refused under a new grant of the same person');
select is((select count(*)::integer from public.world_change_proposals
  where workspace_key = 'pilot-cc00000300004000' and state = 'proposed'), 200, 'the refusal stored nothing');

insert into keep select 'g4', pg_temp.agent_grant('pilot-dd00000400004000', 'dd000004-0000-4000-8000-0000000000d4', 'agentBatch01', 1);
select count(*) from (select pg_temp.agent_propose('pilot-dd00000400004000', 'dd000004-0000-4000-8000-0000000000d4',
  pg_temp.id_of('g4'), 'batch-' || lpad(i::text, 4, '0'), 200, 1) from generate_series(1, 198) i) seeded;
select throws_ok($$select pg_temp.agent_propose('pilot-dd00000400004000', 'dd000004-0000-4000-8000-0000000000d4',
  pg_temp.id_of('g4'), 'batch-of-three', 200, 3)$$, 'P0001', 'proposal_open_limit',
  'a batch of three at 198 open is refused at its first item');
select is((pg_temp.agent_propose('pilot-dd00000400004000', 'dd000004-0000-4000-8000-0000000000d4',
  pg_temp.id_of('g4'), 'batch-of-two', 200, 2))->>'replayed', 'false', 'a batch of two at 198 open is admitted');

-- ---------------------------------------------------------------------------------------------
-- I-11 (DB half): revoke withdraws in the same transaction; a membership change withdraws at decide.
-- ---------------------------------------------------------------------------------------------
select throws_ok($$select public.revoke_foundation_agent_grant('pilot-aa00000100004000', pg_temp.id_of('g1'), 'bb000002-0000-4000-8000-0000000000b2')$$,
  'P0001', 'agent_grant_not_found', 'another person cannot disconnect the grant');
insert into keep select 'rev1', public.revoke_foundation_agent_grant('pilot-aa00000100004000', pg_temp.id_of('g1'), 'aa000001-0000-4000-8000-0000000000a1');
select is((select (v->>'keysRevoked') || '|' || (v->>'proposalsWithdrawn') from keep where k = 'rev1'), '1|1',
  'the revoke ends the grant''s key and withdraws its open proposal');
select is((select state || '|' || (decided_at is not null)::text || '|' || (decided_by is null)::text || '|' || (receipt is null)::text
  from public.world_change_proposals where proposal_id = pg_temp.id_of('a1')), 'withdrawn|true|true|true',
  'a withdrawn row has a decision time, no decider and no receipt');
select is((select count(*)::integer from public.world_change_proposals where agent_grant_id = pg_temp.id_of('g1') and state = 'proposed'), 0,
  'no open proposal of the revoked grant is left');
select ok((select revoked_at is not null from public.foundation_api_keys where key_prefix = 'agentGrant01'), 'the grant''s key is revoked');
select throws_ok($$select public.decide_world_change_proposal('pilot-aa00000100004000', pg_temp.id_of('a1'), 'confirm',
  'aa000001-0000-4000-8000-0000000000a1', 'sha256:' || repeat('d', 64))$$, 'P0001', 'proposal_not_decidable',
  'a withdrawn proposal cannot be decided');
select throws_ok($$select pg_temp.agent_propose('pilot-aa00000100004000', 'aa000001-0000-4000-8000-0000000000a1',
  pg_temp.id_of('g1'), 'agt_afterrev01', 200, 1)$$, 'P0001', 'proposal_agent_grant_revoked', 'a revoked grant cannot propose');
select throws_ok($$select public.revoke_foundation_agent_grant('pilot-aa00000100004000', pg_temp.id_of('g1'), 'aa000001-0000-4000-8000-0000000000a1')$$,
  'P0001', 'agent_grant_not_found', 'a revoked grant cannot be revoked twice');

-- The person's membership changes: the other grant's open proposal decides as withdrawn.
update public.foundation_workspace_members set accepted_at = accepted_at - interval '1 second'
  where user_id = 'aa000001-0000-4000-8000-0000000000a1';
select is((select authorization_revision::integer from public.foundation_workspace_members
  where user_id = 'aa000001-0000-4000-8000-0000000000a1'), 2, 'the membership revision moved');
insert into keep select 'bumped', public.decide_world_change_proposal('pilot-aa00000100004000',
  (select proposal_id from public.world_change_proposals where idempotency_key = 'agt_second0001'), 'confirm',
  'aa000001-0000-4000-8000-0000000000a1', 'sha256:' || repeat('d', 64));
select is((select (v->>'state') || '|' || (v->>'decided_by' is null)::text from keep where k = 'bumped'), 'withdrawn|true',
  'a confirmation after the grantor''s membership changed is withdrawn, with no decider');
select throws_ok($$select pg_temp.agent_propose('pilot-aa00000100004000', 'aa000001-0000-4000-8000-0000000000a1',
  pg_temp.id_of('g1b'), 'agt_afterbump1', 200, 1)$$, 'P0001', 'proposal_agent_grant_revoked',
  'a grant made at the old revision can no longer propose');

-- ---------------------------------------------------------------------------------------------
-- I-20 (DB half): the kill switch.
-- ---------------------------------------------------------------------------------------------
insert into keep select 'live_b', public.create_foundation_api_key_authorized('pilot-bb00000200004000', 'Live key', 'liveKeyB0001', repeat('9', 64),
  array['worlds:read'], null, 'bb000002-0000-4000-8000-0000000000b2', 1, 'live');
insert into keep select 'mcp_b', public.create_foundation_api_key_authorized('pilot-bb00000200004000', 'MCP key', 'mcpKeyB00001', repeat('8', 64),
  array['worlds:read'], now() + interval '1 hour', 'bb000002-0000-4000-8000-0000000000b2', 1, 'mcp');
insert into keep select 'g2', pg_temp.agent_grant('pilot-bb00000200004000', 'bb000002-0000-4000-8000-0000000000b2', 'agentKillB01', 1);
insert into keep select 'b1', pg_temp.agent_propose('pilot-bb00000200004000', 'bb000002-0000-4000-8000-0000000000b2',
  pg_temp.id_of('g2'), 'agt_killswitch', 200, 1);
insert into keep select 'all', public.revoke_all_foundation_agent_grants();
select is((select v->'byWorkspace'->'pilot-bb00000200004000' from keep where k = 'all'),
  '{"keys": 1, "grants": 1, "proposals": 1}'::jsonb, 'revoke-all reports the workspace''s grant, key and proposal');
select is((select count(*)::integer from public.foundation_agent_grants where revoked_at is null), 0, 'no live grant is left anywhere');
select is((select count(*)::integer from public.foundation_api_keys where token_kind = 'agent' and revoked_at is null), 0,
  'no live agent key is left anywhere');
select is((select count(*)::integer from public.world_change_proposals where principal_kind = 'agent' and state = 'proposed'), 0,
  'no open agent proposal is left anywhere');
select ok((select revoked_at is null from public.foundation_api_keys where key_prefix = 'liveKeyB0001'), 'a live developer key is untouched');
select ok((select revoked_at is null from public.foundation_api_keys where key_prefix = 'mcpKeyB00001'), 'a remote MCP key is untouched');
select is((select state from public.world_change_proposals where proposal_id = pg_temp.id_of('b1')), 'withdrawn',
  'the open agent proposal is withdrawn');

-- ---------------------------------------------------------------------------------------------
-- The compile quote: the trigger's rows and its arithmetic (20261117120000 rule 4).
-- ---------------------------------------------------------------------------------------------
select public.apply_foundation_billing_event_v4(
  'evt_' || rpad('agentq', 26, 'q'), 'transaction.completed', '2026-11-09T07:00:00Z',
  'sha256:' || repeat('7', 64), 'allowance', 'pilot-ee00000500004000', 'ee000005-0000-4000-8000-0000000000e5',
  'observer_access', 'txn_' || rpad('agentq', 26, 'q'), 'ctm_' || rpad('agentq', 26, 'q'), null, null, 2000, null);
update public.foundation_billing_accounts set access_plan = 'observer_access', subscription_status = 'active'
  where workspace_key = 'pilot-ee00000500004000';
create function pg_temp.read(p_document text, p_reserved integer, p_maximum integer, p_sha text) returns jsonb language sql as $$
  select public.reserve_foundation_compute_v3('pilot-ee00000500004000', p_document::uuid, 'ee000005-0000-4000-8000-0000000000e5'::uuid,
    p_reserved, p_maximum);
  select public.settle_foundation_compute_v4('pilot-ee00000500004000', p_document::uuid, 'settled', 3, 0,
    'sha256:' || repeat(p_sha, 64), 'OCR_COMPLETED');
$$;
create function pg_temp.balance() returns integer language sql as $$
  select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-ee00000500004000';
$$;
-- Q1: hold 4, settled 12 (8 above the hold). Q2: hold 12, settled 12. Q3: settled, never refunded.
select pg_temp.read('93000000-0000-4000-8000-000000000001', 4, 12, 'a');
select pg_temp.read('93000000-0000-4000-8000-000000000002', 12, 18, 'b');
select pg_temp.read('93000000-0000-4000-8000-000000000003', 12, 18, 'c');
insert into public.foundation_compile_jobs (job_id, workspace_key, created_by_user_id, document_ids, idempotency_key, state, documents_total)
  values ('cjob-' || repeat('1', 32), 'pilot-ee00000500004000', 'ee000005-0000-4000-8000-0000000000e5',
    array['93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000002'], 'agent-quote-fail', 'structuring', 2);
update public.foundation_compile_jobs set state = 'failed', settled_at = now(), error_code = 'JSON_TOO_LARGE'
  where job_id = 'cjob-' || repeat('1', 32);
insert into keep select 'q', public.quote_foundation_compile_recharge('pilot-ee00000500004000',
  array['93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000003']::uuid[]);
select is((select jsonb_array_length(v->'reservations') from keep where k = 'q'), 2,
  'the quote holds the two refunded reads, not the read that was never refunded');
select is((select (v->>'totalRechargeCredits')::integer from keep where k = 'q'), 24, 'the whole re-charge is what the refunds gave back');
select is((select (v->>'balanceRechargeCredits')::integer from keep where k = 'q'), 16, 'the balance part is least(settled, held) per paid read');
select is((select (v->>'overageCredits')::integer from keep where k = 'q'), 8, 'the part above the hold is overage');
select is((select (v->>'balanceCredits')::integer from keep where k = 'q'), pg_temp.balance(), 'the quote names the current balance');
select is(jsonb_array_length(public.quote_foundation_compile_recharge('pilot-bb00000200004000',
  array['93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000002']::uuid[])->'reservations'), 0,
  'another workspace''s quote of the same document ids is empty');
insert into public.foundation_compile_jobs (job_id, workspace_key, created_by_user_id, document_ids, idempotency_key, state,
  documents_total, collection_id, settled_at)
  values ('cjob-' || repeat('2', 32), 'pilot-ee00000500004000', 'ee000005-0000-4000-8000-0000000000e5',
    array['93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000003'],
    'agent-quote-ready', 'ready', 3, 'collection-' || repeat('2', 32), now());
select is((select sum(recharged_credits - recharged_balance_credits)::integer from public.foundation_compute_reservations
  where recharge_compile_job_id = 'cjob-' || repeat('2', 32)), (select (v->>'overageCredits')::integer from keep where k = 'q'),
  'the overage the trigger booked equals the quote''s overage, with an ample balance');
select is((select sum(recharged_balance_credits)::integer from public.foundation_compute_reservations
  where recharge_compile_job_id = 'cjob-' || repeat('2', 32)), (select (v->>'balanceRechargeCredits')::integer from keep where k = 'q'),
  'the balance part the trigger took equals the quote''s balance part');
select is((select sum(recharged_credits)::integer from public.foundation_compute_reservations
  where recharge_compile_job_id = 'cjob-' || repeat('2', 32)), (select (v->>'totalRechargeCredits')::integer from keep where k = 'q'),
  'the trigger re-charged exactly the quoted rows');
select is(jsonb_array_length(public.quote_foundation_compile_recharge('pilot-ee00000500004000',
  array['93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000002']::uuid[])->'reservations'), 0,
  'a read already charged again is no longer quoted');
-- Over the balance: a fourth refunded read of 12 held against a balance spent down to 5 (fixture).
select pg_temp.read('93000000-0000-4000-8000-000000000004', 12, 18, 'e');
insert into public.foundation_compile_jobs (job_id, workspace_key, created_by_user_id, document_ids, idempotency_key, state, documents_total)
  values ('cjob-' || repeat('3', 32), 'pilot-ee00000500004000', 'ee000005-0000-4000-8000-0000000000e5',
    array['93000000-0000-4000-8000-000000000004'], 'agent-quote-fail-2', 'structuring', 1);
update public.foundation_compile_jobs set state = 'failed', settled_at = now(), error_code = 'JSON_TOO_LARGE'
  where job_id = 'cjob-' || repeat('3', 32);
update public.foundation_billing_accounts set credit_balance = 5 where workspace_key = 'pilot-ee00000500004000';
select ok((select (q->>'balanceRechargeCredits')::integer = 12 and (q->>'balanceCredits')::integer = 5
  from (select public.quote_foundation_compile_recharge('pilot-ee00000500004000', array['93000000-0000-4000-8000-000000000004']::uuid[]) q) x),
  'a balance part above the balance is visible in the returned figures');
select throws_ok($$select public.quote_foundation_compile_recharge('pilot-ee00000500004000', array[]::uuid[])$$,
  'P0001', 'compile_quote_request_invalid', 'an empty document set is refused');

-- ---------------------------------------------------------------------------------------------
-- record_foundation_review_patch_if_leaf.
-- ---------------------------------------------------------------------------------------------
create function pg_temp.patch(p_base text, p_result text, p_after text) returns jsonb language sql as $$
  select public.record_foundation_review_patch_if_leaf('pilot-ee00000500004000', 'collection-' || repeat('e', 32),
    'sha256:' || repeat(p_base, 64), 'ev-1', 'src1', repeat('a', 64), 1, array[0, 0, 10, 10],
    'Label correction suggested by a connected agent and confirmed in a signed-in TAVONEL session.',
    'ee000005-0000-4000-8000-0000000000e5', 'obj-1', 'before label', p_after, 'sha256:' || repeat(p_result, 64));
$$;
select is((pg_temp.patch('1', '2', 'after label'))->>'replayed', 'false', 'a correction of a leaf is recorded');
select is((pg_temp.patch('1', '2', 'after label'))->>'replayed', 'true', 'the same correction again is a replay');
select throws_ok($$select pg_temp.patch('1', '3', 'another label')$$, 'P0001', 'review_base_not_head',
  'a second, different correction of the same base is refused');
select is((select count(*)::integer from public.foundation_review_decisions
  where workspace_key = 'pilot-ee00000500004000' and manifest_digest = 'sha256:' || repeat('1', 64)), 1,
  'the base carries exactly one correction');
select is((pg_temp.patch('2', '3', 'after again'))->>'replayed', 'false', 'the correction is the new leaf and can be corrected');

-- ---------------------------------------------------------------------------------------------
-- list_collection_candidates: newest first, one row per digest, one workspace.
-- ---------------------------------------------------------------------------------------------
insert into public.foundation_collection_artifact_provenance (workspace_key, collection_id, manifest_digest, object_key, document_ids, publish_by)
select w, 'collection-' || repeat('f', 32), 'sha256:' || repeat(d, 64),
  'immutable/' || w || '/' || w || '/collections/collection-' || repeat('f', 32) || '/' || repeat(d, 64) || '/candidate-world.json',
  array['93000000-0000-4000-8000-000000000001']::uuid[], clock_timestamp() + interval '60 seconds'
from (values ('pilot-ee00000500004000', '4', 1), ('pilot-ee00000500004000', '4', 2), ('pilot-ee00000500004000', '5', 3),
             ('pilot-bb00000200004000', '6', 4)) as r(w, d, n)
order by n;
select is(jsonb_array_length(public.list_collection_candidates('pilot-ee00000500004000', 'collection-' || repeat('f', 32), 50)), 2,
  'two registrations of one digest are one candidate');
select is(public.list_collection_candidates('pilot-ee00000500004000', 'collection-' || repeat('f', 32), 50)->0->>'manifestDigest',
  'sha256:' || repeat('5', 64), 'the newest candidate comes first');
select is(jsonb_array_length(public.list_collection_candidates('pilot-bb00000200004000', 'collection-' || repeat('f', 32), 50)), 1,
  'another workspace sees only its own candidate of the same collection id');
select is(public.list_collection_candidates('pilot-ee00000500004000', 'collection-' || repeat('f', 32), 1)->0->'documentIds',
  '["93000000-0000-4000-8000-000000000001"]'::jsonb, 'a candidate names its documents');

-- ---------------------------------------------------------------------------------------------
-- I-1: every read RPC an agent call may make is stable or immutable.
-- ---------------------------------------------------------------------------------------------
select ok((select bool_and(provolatile in ('s', 'i')) and count(*) > 0 from pg_proc where proname = 'connector_documents_blocked'),
  'connector_documents_blocked does not write');
select ok((select bool_and(provolatile in ('s', 'i')) and count(*) > 0 from pg_proc where proname = 'read_library_organize'),
  'read_library_organize does not write');
select ok((select bool_and(provolatile in ('s', 'i')) and count(*) > 0 from pg_proc where proname = 'list_collection_candidates'),
  'list_collection_candidates does not write');
select ok((select bool_and(provolatile in ('s', 'i')) and count(*) > 0 from pg_proc where proname = 'quote_foundation_compile_recharge'),
  'quote_foundation_compile_recharge does not write');
select ok((select bool_and(provolatile in ('s', 'i')) and count(*) > 0 from pg_proc where proname = 'get_world_change_proposal'),
  'get_world_change_proposal does not write');
select ok((select bool_and(provolatile in ('s', 'i')) and count(*) > 0 from pg_proc where proname = 'list_world_change_proposals_page'),
  'list_world_change_proposals_page does not write');
select ok((select bool_and(provolatile in ('s', 'i')) and count(*) > 0 from pg_proc where proname = 'list_world_change_proposals'),
  'list_world_change_proposals does not write');

select * from finish();
rollback;
