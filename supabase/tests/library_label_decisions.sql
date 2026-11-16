-- WO-D23-4 library label decisions (migration 20261116130000).
--
-- What it proves: a person's decision is one appended document_labels row (method person); the
-- same idempotency key replays the same row, and the same key with another label or decision is a
-- conflict, never an overwrite; an opposite decision under a new key is a second decision row
-- (newest wins, nothing is edited); an Undo is its own row naming the decision it withdraws, and is
-- refused as stale when that is not the decision standing; a document of another workspace is refused; a doc type outside
-- label set v0, a proposal-shaped decision, a missing decider and a short key are refused; the source
-- fingerprint rows and the original proposal are untouched; only service_role may execute it.
--
-- Not provable here: the per-document advisory lock against a concurrent session (one transaction).
--
-- Two self-service workspaces are bootstrapped by the auth.users insert (20260920121000):
-- pilot-b2b2b2b2b2b24b2b (owner b2b2...) and pilot-c3c3c3c3c3c34c3c (owner c3c3...).
begin;
select plan(26);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 'authenticated', 'authenticated',
   'decide-b2@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', 'authenticated', 'authenticated',
   'decide-c3@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.foundation_intake_admissions (
  workspace_key, document_id, user_id, object_key, requested_bytes, declared_mime_type,
  created_at, updated_at, expires_at, confirmed_at, source_sha256
)
select w, d::uuid, u::uuid, 'quarantine/' || w || '/' || d || '/source', 10, 'application/pdf',
       now(), now(), now() + interval '10 minutes', now(), s
  from (values
    ('pilot-b2b2b2b2b2b24b2b', '0a000000-0000-4000-8000-00000000000a', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 'sha256:' || repeat('5', 64)),
    ('pilot-c3c3c3c3c3c34c3c', '0c000000-0000-4000-8000-00000000000c', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', 'sha256:' || repeat('6', 64))
  ) as f(w, d, u, s);

-- One document in each workspace, A with a production document-type proposal (no text fingerprint).
create function pg_temp.item(p_document text, p_hex text, p_labels jsonb) returns jsonb language sql as $f$
  select jsonb_build_object('documentId', p_document, 'sourceVersionId', repeat(p_hex, 64),
    'sanitizedSha256', 'sha256:' || repeat(p_hex, 64), 'textFingerprint', null, 'labels', p_labels)
$f$;
select public.record_library_organize('pilot-b2b2b2b2b2b24b2b', jsonb_build_array(
  pg_temp.item('0a000000-0000-4000-8000-00000000000a', 'a', jsonb_build_array(jsonb_build_object(
    'labelKind', 'doc_type', 'labelKey', 'contract', 'labelSetVersion', 'doc-type:v0', 'method', 'rules',
    'methodVersion', 'doc-type-rules:v1', 'inputsSha256', 'sha256:' || repeat('1', 64), 'disposition', 'proposed',
    'abstainReason', null, 'internalScore', 0.75, 'evidenceIds', '[]'::jsonb)))));
select public.record_library_organize('pilot-c3c3c3c3c3c34c3c', jsonb_build_array(
  pg_temp.item('0c000000-0000-4000-8000-00000000000c', 'c', '[]'::jsonb)));

create temp table fingerprints_before as
  select md5(coalesce(string_agg(to_jsonb(f)::text, E'\n' order by f.workspace_key, f.document_id), '')) as digest
    from public.source_fingerprints f;

-- ---------------------------------------------------------------------------
-- 1. Who may call it.
-- ---------------------------------------------------------------------------
select ok(has_function_privilege('service_role', 'public.decide_library_label(text, uuid, text, text, text, text, uuid, text)', 'execute'),
  'the server may decide');
select ok(not has_function_privilege('authenticated', 'public.decide_library_label(text, uuid, text, text, text, text, uuid, text)', 'execute'),
  'a browser may not call it directly');
select ok(not has_function_privilege('anon', 'public.decide_library_label(text, uuid, text, text, text, text, uuid, text)', 'execute'),
  'anon may not');
select ok(exists (select 1 from pg_proc where proname = 'decide_library_label' and prosecdef
  and 'search_path=""' = any(proconfig) and 'statement_timeout=3s' = any(proconfig)),
  'security definer, empty search_path, bounded at 3 s');

-- ---------------------------------------------------------------------------
-- 2. A decision, its replay, its conflicts, its undo.
-- ---------------------------------------------------------------------------
set local role service_role;
select is(public.decide_library_label('pilot-b2b2b2b2b2b24b2b', '0a000000-0000-4000-8000-00000000000a', repeat('a', 64),
  'doc_type', 'invoice', 'confirmed', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 'idem-key-0001')->>'replayed',
  'false', 'a decision is recorded');
select is(public.decide_library_label('pilot-b2b2b2b2b2b24b2b', '0a000000-0000-4000-8000-00000000000a', repeat('a', 64),
  'doc_type', 'invoice', 'confirmed', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 'idem-key-0001')->>'replayed',
  'true', 'the same key replays the same row');
select throws_ok($$select public.decide_library_label('pilot-b2b2b2b2b2b24b2b', '0a000000-0000-4000-8000-00000000000a',
  repeat('a', 64), 'doc_type', 'invoice', 'rejected', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 'idem-key-0001')$$,
  'P0001', 'library_decision_conflict', 'the same key with another decision is a conflict');
select throws_ok($$select public.decide_library_label('pilot-b2b2b2b2b2b24b2b', '0a000000-0000-4000-8000-00000000000a',
  repeat('a', 64), 'doc_type', 'report', 'confirmed', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 'idem-key-0001')$$,
  'P0001', 'library_decision_conflict', 'the same key with another label is a conflict');

-- An opposite decision under a new key is a second decision (the newest wins: a rejection).
select is(public.decide_library_label('pilot-b2b2b2b2b2b24b2b', '0a000000-0000-4000-8000-00000000000a', repeat('a', 64),
  'doc_type', 'invoice', 'rejected', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 'idem-key-0002')->>'decision',
  'rejected', 'an opposite decision under a new key is accepted');
-- An Undo withdraws the decision standing on the label, and only that one.
select throws_ok($$select public.decide_library_label('pilot-b2b2b2b2b2b24b2b', '0a000000-0000-4000-8000-00000000000a',
  repeat('a', 64), 'doc_type', 'invoice', 'undo_confirmed', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 'idem-key-0010')$$,
  'P0001', 'library_decision_stale', 'undoing a confirmation that no longer stands is refused as stale');
select is(public.decide_library_label('pilot-b2b2b2b2b2b24b2b', '0a000000-0000-4000-8000-00000000000a', repeat('a', 64),
  'doc_type', 'invoice', 'undo_rejected', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 'idem-key-0011')->>'replayed',
  'false', 'undoing the standing rejection is recorded');
select is(public.decide_library_label('pilot-b2b2b2b2b2b24b2b', '0a000000-0000-4000-8000-00000000000a', repeat('a', 64),
  'doc_type', 'invoice', 'undo_rejected', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 'idem-key-0011')->>'replayed',
  'true', 'an Undo replays like a decision');
select throws_ok($$select public.decide_library_label('pilot-b2b2b2b2b2b24b2b', '0a000000-0000-4000-8000-00000000000a',
  repeat('a', 64), 'doc_type', 'invoice', 'undo_rejected', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 'idem-key-0012')$$,
  'P0001', 'library_decision_stale', 'a second Undo of the same rejection is stale: the confirmation stands again');
select throws_ok($$select public.decide_library_label('pilot-b2b2b2b2b2b24b2b', '0a000000-0000-4000-8000-00000000000a',
  repeat('a', 64), 'doc_type', 'invoice', 'rejected', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 'idem-key-0011')$$,
  'P0001', 'library_decision_conflict', 'an Undo''s key reused for a decision is a conflict');
select public.decide_library_label('pilot-b2b2b2b2b2b24b2b', '0a000000-0000-4000-8000-00000000000a', repeat('a', 64),
  'topic', 'terms', 'confirmed', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 'idem-key-0003');
reset role;

select is((select count(*)::integer from public.document_labels where workspace_key = 'pilot-b2b2b2b2b2b24b2b' and method = 'person'),
  4, 'two doc-type decisions, one Undo and one topic decision are four appended rows; replays, conflicts and stale Undos added none');
select is((select evidence_ids from public.document_labels where method_version = 'person-undo:v1'),
  array['sha256:' || encode(sha256(convert_to('idem-key-0002', 'UTF8')), 'hex')], 'the Undo names the rejection it withdraws');
select is((select count(*)::integer from public.document_labels where workspace_key = 'pilot-b2b2b2b2b2b24b2b'
  and method = 'rules' and disposition = 'proposed' and label_key = 'contract'), 1, 'the original proposal is still there');
select is((select label_set_version from public.document_labels where method = 'person' and label_kind = 'doc_type'
  and inputs_sha256 = 'sha256:' || encode(sha256(convert_to('idem-key-0001', 'UTF8')), 'hex')),
  'doc-type:v0', 'a person row carries the proposal''s label set and the hash of its idempotency key');
select is((select label_set_version from public.document_labels where method = 'person' and label_kind = 'topic'),
  'person:v1', 'a topic with no production row carries the person label set');
select ok((select bool_and(decided_by = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2' and decided_at is not null
  and method_version in ('person:v1', 'person-undo:v1')) from public.document_labels where method = 'person'), 'every person row names who decided and when');

-- ---------------------------------------------------------------------------
-- 3. Refusals.
-- ---------------------------------------------------------------------------
set local role service_role;
select throws_ok($$select public.decide_library_label('pilot-c3c3c3c3c3c34c3c', '0a000000-0000-4000-8000-00000000000a',
  repeat('a', 64), 'doc_type', 'invoice', 'confirmed', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', 'idem-key-0004')$$,
  'P0001', 'library_decision_target_missing', 'another workspace''s document is refused');
select throws_ok($$select public.decide_library_label('pilot-b2b2b2b2b2b24b2b', '0a000000-0000-4000-8000-00000000000a',
  repeat('a', 64), 'doc_type', 'banana', 'confirmed', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 'idem-key-0005')$$,
  'P0001', 'library_decision_request_invalid', 'a doc type outside label set v0 is refused');
select throws_ok($$select public.decide_library_label('pilot-b2b2b2b2b2b24b2b', '0a000000-0000-4000-8000-00000000000a',
  repeat('a', 64), 'doc_type', 'invoice', 'proposed', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 'idem-key-0006')$$,
  'P0001', 'library_decision_request_invalid', 'a decision must confirm or reject');
select throws_ok($$select public.decide_library_label('pilot-b2b2b2b2b2b24b2b', '0a000000-0000-4000-8000-00000000000a',
  repeat('a', 64), 'doc_type', 'invoice', 'confirmed', null, 'idem-key-0007')$$,
  'P0001', 'library_decision_request_invalid', 'a decision names a person');
select throws_ok($$select public.decide_library_label('pilot-b2b2b2b2b2b24b2b', '0a000000-0000-4000-8000-00000000000a',
  repeat('a', 64), 'doc_type', 'invoice', 'confirmed', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 'short')$$,
  'P0001', 'library_decision_request_invalid', 'a short idempotency key is refused');
reset role;

select is((select md5(coalesce(string_agg(to_jsonb(f)::text, E'\n' order by f.workspace_key, f.document_id), ''))
  from public.source_fingerprints f), (select digest from fingerprints_before), 'no source fingerprint row changed');

select * from finish();
rollback;
