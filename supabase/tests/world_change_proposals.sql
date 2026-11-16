-- WO-D30-1 world change proposals (migration 20261116130100).
--
-- What it proves: the same idempotency key and digest replays the same row; the same key with
-- another digest raises; a decision is made once (a second decide is refused); a decision past
-- expires_at turns the row expired; a confirmation or rejection against a moved World is stale;
-- a rejection against the same World is rejected; undo keeps the execution receipt; outcomes move only confirmed -> executed|failed and executed -> undone; an id
-- of another workspace is not found; anon and authenticated can neither select nor execute.
--
-- Not provable here: the per-key advisory lock against a concurrent session (one transaction).
begin;
select plan(26);

create temp table keep (k text primary key, v jsonb);
grant all on keep to service_role;

select ok(has_function_privilege('service_role', 'public.create_world_change_proposal(text, text, text, jsonb, text, text[], text, integer, text, uuid, text, timestamptz)', 'execute'),
  'the server may create');
select ok(not has_function_privilege('authenticated', 'public.decide_world_change_proposal(text, uuid, text, uuid, text, timestamptz)', 'execute'),
  'a signed-in client may not decide');
select ok(not has_function_privilege('anon', 'public.list_world_change_proposals(text, text, integer)', 'execute'),
  'an anonymous client may not list');
select ok(not has_table_privilege('authenticated', 'public.world_change_proposals', 'select'),
  'authenticated has no table select');
select ok(not has_table_privilege('anon', 'public.world_change_proposals', 'select'),
  'anon has no table select');

set local role service_role;

-- Creation and replay.
insert into keep select 'first', public.create_world_change_proposal('pilot-a1a1', 'collection-' || repeat('a', 32), 'library_label',
  '{"labelKey":"contract"}', 'sha256:' || repeat('1', 64), '{}', 'sha256:' || repeat('d', 64), 1, 'session',
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'key-aaaaaaaa', now() + interval '7 days');
select is((select v->>'replayed' from keep where k = 'first'), 'false', 'first create is new');
select is((select v->'proposal'->>'state' from keep where k = 'first'), 'proposed', 'it starts proposed');

insert into keep select 'again', public.create_world_change_proposal('pilot-a1a1', 'collection-' || repeat('a', 32), 'library_label',
  '{"labelKey":"contract"}', 'sha256:' || repeat('1', 64), '{}', 'sha256:' || repeat('d', 64), 1, 'session',
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'key-aaaaaaaa', now() + interval '7 days');
select is((select v->>'replayed' from keep where k = 'again'), 'true', 'same key and digest replays');
select is((select v->'proposal'->>'proposal_id' from keep where k = 'again'), (select v->'proposal'->>'proposal_id' from keep where k = 'first'),
  'the replay is the same row');

select throws_ok($$select public.create_world_change_proposal('pilot-a1a1', 'collection-' || repeat('a', 32), 'library_label',
  '{"labelKey":"invoice"}', 'sha256:' || repeat('2', 64), '{}', 'sha256:' || repeat('d', 64), 1, 'session',
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'key-aaaaaaaa', now() + interval '7 days')$$,
  'P0001', 'proposal_idempotency_conflict', 'same key with another digest is a conflict');
select throws_ok($$select public.create_world_change_proposal('pilot-a1a1', 'collection-' || repeat('a', 32), 'library_label',
  '{}', 'sha256:' || repeat('1', 64), '{}', 'sha256:' || repeat('d', 64), 1, 'session',
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'short', now() + interval '7 days')$$,
  'P0001', 'proposal_request_invalid', 'a short key is refused');

-- Decide: confirm once, never twice.
select is((public.decide_world_change_proposal('pilot-a1a1', (select (v->'proposal'->>'proposal_id')::uuid from keep where k = 'first'),
  'confirm', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'sha256:' || repeat('d', 64), now()))->>'state', 'confirmed',
  'a confirmation against the same World is confirmed');
select throws_ok($$select public.decide_world_change_proposal('pilot-a1a1', (select (v->'proposal'->>'proposal_id')::uuid from keep where k = 'first'),
  'confirm', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'sha256:' || repeat('d', 64), now())$$,
  'P0001', 'proposal_not_decidable', 'a second decision is refused');
select throws_ok($$select public.decide_world_change_proposal('pilot-b2b2', (select (v->'proposal'->>'proposal_id')::uuid from keep where k = 'first'),
  'confirm', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'sha256:' || repeat('d', 64), now())$$,
  'P0001', 'proposal_not_found', 'another workspace cannot see the id');

-- Outcomes: only the legal moves.
select throws_ok($$select public.record_world_change_proposal_outcome('pilot-a1a1', (select (v->'proposal'->>'proposal_id')::uuid from keep where k = 'first'),
  'undone', '{}')$$, 'P0001', 'proposal_transition_illegal', 'confirmed cannot jump to undone');
select is((public.record_world_change_proposal_outcome('pilot-a1a1', (select (v->'proposal'->>'proposal_id')::uuid from keep where k = 'first'),
  'executed', '{"ok":true}'))->>'state', 'executed', 'confirmed moves to executed');
select throws_ok($$select public.record_world_change_proposal_outcome('pilot-a1a1', (select (v->'proposal'->>'proposal_id')::uuid from keep where k = 'first'),
  'failed', '{}')$$, 'P0001', 'proposal_transition_illegal', 'executed cannot become failed');
select is((public.record_world_change_proposal_outcome('pilot-a1a1', (select (v->'proposal'->>'proposal_id')::uuid from keep where k = 'first'),
  'undone', '{"ok":true}'))->>'state', 'undone', 'executed moves to undone');
select is((select (e->'receipt'->'executed'->>'ok') || (e->'receipt'->'undone'->>'ok')
  from jsonb_array_elements(public.list_world_change_proposals('pilot-a1a1', 'collection-' || repeat('a', 32), 50)) e
  where e->>'proposal_id' = (select v->'proposal'->>'proposal_id' from keep where k = 'first')), 'truetrue',
  'undo keeps the execution receipt beside the undo receipt');
select throws_ok($$select public.record_world_change_proposal_outcome('pilot-a1a1', (select (v->'proposal'->>'proposal_id')::uuid from keep where k = 'first'),
  'undone', '{}')$$, 'P0001', 'proposal_transition_illegal', 'undone is final');

-- Expired, stale, rejected.
insert into keep select 'exp', public.create_world_change_proposal('pilot-a1a1', 'collection-' || repeat('a', 32), 'library_label',
  '{"labelKey":"report"}', 'sha256:' || repeat('3', 64), '{}', 'sha256:' || repeat('d', 64), 1, 'steward',
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'key-expired1', now() + interval '1 day');
select is((public.decide_world_change_proposal('pilot-a1a1', (select (v->'proposal'->>'proposal_id')::uuid from keep where k = 'exp'),
  'confirm', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'sha256:' || repeat('d', 64), now() + interval '2 days'))->>'state', 'expired',
  'a decision past expiry turns it expired');

insert into keep select 'stale', public.create_world_change_proposal('pilot-a1a1', 'collection-' || repeat('a', 32), 'library_label',
  '{"labelKey":"manual"}', 'sha256:' || repeat('4', 64), '{}', 'sha256:' || repeat('d', 64), 1, 'session',
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'key-stale001', now() + interval '1 day');
select is((public.decide_world_change_proposal('pilot-a1a1', (select (v->'proposal'->>'proposal_id')::uuid from keep where k = 'stale'),
  'confirm', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'sha256:' || repeat('e', 64), now()))->>'state', 'stale',
  'a confirmation after the World moved is stale');

insert into keep select 'rej', public.create_world_change_proposal('pilot-a1a1', 'collection-' || repeat('a', 32), 'library_label',
  '{"labelKey":"letter"}', 'sha256:' || repeat('5', 64), '{}', 'sha256:' || repeat('d', 64), 1, 'session',
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'key-reject01', now() + interval '1 day');
select is((public.decide_world_change_proposal('pilot-a1a1', (select (v->'proposal'->>'proposal_id')::uuid from keep where k = 'rej'),
  'reject', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'sha256:' || repeat('e', 64), now()))->>'state', 'stale',
  'a rejection after the World moved is stale');

insert into keep select 'rej2', public.create_world_change_proposal('pilot-a1a1', 'collection-' || repeat('a', 32), 'library_label',
  '{"labelKey":"memo"}', 'sha256:' || repeat('6', 64), '{}', 'sha256:' || repeat('d', 64), 1, 'session',
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'key-reject02', now() + interval '1 day');
select is((public.decide_world_change_proposal('pilot-a1a1', (select (v->'proposal'->>'proposal_id')::uuid from keep where k = 'rej2'),
  'reject', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'sha256:' || repeat('d', 64), now()))->>'state', 'rejected',
  'a rejection against the same World is rejected');

-- List: newest first, scoped to the workspace and collection.
select is(jsonb_array_length(public.list_world_change_proposals('pilot-a1a1', 'collection-' || repeat('a', 32), 50)), 5,
  'the list holds this collection''s five proposals');
select is(jsonb_array_length(public.list_world_change_proposals('pilot-b2b2', 'collection-' || repeat('a', 32), 50)), 0,
  'another workspace lists none');

reset role;
select * from finish();
rollback;
