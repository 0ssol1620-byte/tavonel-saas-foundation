-- B2a/B2b/B2c library organize shadow (migration 20261107100000).
--
-- What it proves: a document whose normalized text equals another's is a same_text pair; MinHash
-- similarity at or above 0.85 is a near_duplicate and in [0.50, 0.85) a revision_candidate, each
-- with its score, threshold, method and inputs digest recorded; nothing matches across workspaces;
-- redelivery writes nothing twice and reports nothing new; a writer can propose or abstain but never
-- confirm; labels outside the v0 set, half-written abstentions and malformed fingerprints are
-- refused; a changed text fingerprint is an integrity fault; the rows are unreachable from any
-- client role and from service_role except through the two RPCs; the reader hides a document whose
-- deletion was requested; and the derived closure erases the deleted document's labels and
-- relations while the other documents keep theirs.
--
-- Not provable here: the workspace advisory lock against a concurrent session (one transaction).
--
-- Two self-service workspaces are bootstrapped by the auth.users insert (20260920121000):
-- pilot-b2b2b2b2b2b24b2b (owner b2b2...) and pilot-c3c3c3c3c3c34c3c (owner c3c3...).
begin;
select plan(48);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 'authenticated', 'authenticated',
   'organize-b2@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', 'authenticated', 'authenticated',
   'organize-c3@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

-- A is the document that will be deleted; B survives it.
insert into public.foundation_intake_admissions (
  workspace_key, document_id, user_id, object_key, requested_bytes, declared_mime_type,
  created_at, updated_at, expires_at, confirmed_at, source_sha256
)
select w, d::uuid, u::uuid, 'quarantine/' || w || '/' || d || '/source', 10, 'application/pdf',
       now(), now(), now() + interval '10 minutes', now(), s
  from (values
    ('pilot-b2b2b2b2b2b24b2b', '0a000000-0000-4000-8000-00000000000a', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 'sha256:' || repeat('5', 64)),
    ('pilot-b2b2b2b2b2b24b2b', '0b000000-0000-4000-8000-00000000000b', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 'sha256:' || repeat('6', 64))
  ) as f(w, d, u, s);

-- One request item. p_differ positions of a 128-value MinHash take document-specific values, so two
-- items with p_differ x and y (distinct seeds) agree on 128 - max(x, y) positions.
create function public.b2_test_item(p_document text, p_version_hex text, p_text_hex text, p_seed integer,
  p_differ integer, p_labels jsonb) returns jsonb language sql as $$
  select jsonb_build_object('documentId', p_document, 'sourceVersionId', repeat(p_version_hex, 64),
    'sanitizedSha256', 'sha256:' || repeat(p_version_hex, 64),
    'textFingerprint', jsonb_build_object('textSha256', 'sha256:' || repeat(p_text_hex, 64),
      'minhash', (select jsonb_agg(case when i <= p_differ then p_seed * 1000000 + i else i end order by i)
                    from generate_series(1, 128) i)),
    'labels', p_labels);
$$;
create function public.b2_test_label(p_kind text, p_key text, p_disposition text) returns jsonb language sql as $$
  select jsonb_build_object('labelKind', p_kind, 'labelKey', p_key,
    'labelSetVersion', case p_kind when 'doc_type' then 'doc-type:v0' else 'topic-open:v1' end,
    'method', case p_kind when 'doc_type' then 'rules' else 'tfidf_agglomerative' end,
    'methodVersion', case p_kind when 'doc_type' then 'doc-type-rules:v1' else 'topic-ctfidf:v1' end,
    'inputsSha256', 'sha256:' || repeat('1', 64), 'disposition', p_disposition,
    'abstainReason', case p_disposition when 'abstained' then 'corpus_too_small' end,
    'internalScore', case p_disposition when 'abstained' then null else 0.75 end,
    'evidenceIds', case p_disposition when 'abstained' then '[]'::jsonb else '["native-p0001"]'::jsonb end);
$$;
grant execute on function public.b2_test_item(text, text, text, integer, integer, jsonb),
  public.b2_test_label(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 1. Nobody but the RPCs reaches the rows.
-- ---------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.document_labels'::regclass), 'labels have RLS');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'document_labels'
  and policyname = 'document_labels_no_client_access' and permissive = 'RESTRICTIVE'), 'labels carry a deny-all client policy');
select table_privs_are('public', 'document_labels', 'service_role', array[]::text[]);
select table_privs_are('public', 'document_labels', 'authenticated', array[]::text[]);
select table_privs_are('public', 'document_labels', 'anon', array[]::text[]);
select ok(has_function_privilege('service_role', 'public.record_library_organize(text, jsonb)', 'execute'), 'the server may record');
select ok(has_function_privilege('service_role', 'public.read_library_organize(text, uuid[])', 'execute'), 'the server may read');
select ok(not has_function_privilege('authenticated', 'public.record_library_organize(text, jsonb)', 'execute'), 'a browser may not record');
select ok(not has_function_privilege('anon', 'public.read_library_organize(text, uuid[])', 'execute'), 'anon may not read');
select ok(not has_function_privilege('service_role', 'public.library_minhash_similarity(bigint[], bigint[])', 'execute'),
  'the similarity helper is internal');
select is((select count(*)::integer from pg_proc where proname in ('record_library_organize', 'read_library_organize')
  and 'statement_timeout=3s' = any(proconfig)), 2, 'both RPCs are bounded at 3 s, below the client''s 4 s abort');

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2"}', true);
select throws_ok($$select 1 from public.document_labels$$, '42501', null, 'a workspace owner cannot read labels');
reset role;
set local role anon;
select throws_ok($$select 1 from public.document_labels$$, '42501', null, 'anon cannot read labels');
reset role;
set local role service_role;
select throws_ok($$select 1 from public.document_labels$$, '42501', null, 'the server reads labels only through the RPC');
select throws_ok($$update public.document_labels set disposition = 'confirmed'$$, '42501', null, 'nor confirms one directly');

-- ---------------------------------------------------------------------------
-- 2. same_text, near_duplicate, revision_candidate, unrelated, redelivery.
-- ---------------------------------------------------------------------------
create temp table rec_a as select public.record_library_organize('pilot-b2b2b2b2b2b24b2b', jsonb_build_array(
  public.b2_test_item('0a000000-0000-4000-8000-00000000000a', 'a', '1', 1, 0,
    jsonb_build_array(public.b2_test_label('doc_type', 'contract', 'proposed'))))) as r;
select is((select r->'newPairs' from rec_a), '{"same_text":0,"near_duplicate":0,"revision_candidate":0}'::jsonb,
  'the first document pairs with nothing');
select is((select r->'labelsRecorded' from rec_a), '1'::jsonb, 'and records its document-type proposal');

select is(public.record_library_organize('pilot-b2b2b2b2b2b24b2b', jsonb_build_array(
  public.b2_test_item('0b000000-0000-4000-8000-00000000000b', 'b', '1', 2, 0,
    jsonb_build_array(public.b2_test_label('topic', '', 'abstained')))))->'newPairs',
  '{"same_text":1,"near_duplicate":0,"revision_candidate":0}'::jsonb, 'the same normalized text in other bytes is a same_text pair');

create temp table rec_c as select public.record_library_organize('pilot-b2b2b2b2b2b24b2b', jsonb_build_array(
  public.b2_test_item('0c000000-0000-4000-8000-00000000000c', 'c', '3', 3, 10, '[]'::jsonb))) as r;
select is((select r->'newPairs' from rec_c), '{"same_text":0,"near_duplicate":2,"revision_candidate":0}'::jsonb,
  '118 of 128 equal positions is a near duplicate of both A and B');

select is(public.record_library_organize('pilot-b2b2b2b2b2b24b2b', jsonb_build_array(
  public.b2_test_item('0d000000-0000-4000-8000-00000000000d', 'd', '4', 4, 40, '[]'::jsonb)))->'newPairs',
  '{"same_text":0,"near_duplicate":0,"revision_candidate":3}'::jsonb, '88 of 128 is a revision candidate of A, B and C');

select is(public.record_library_organize('pilot-b2b2b2b2b2b24b2b', jsonb_build_array(
  public.b2_test_item('0e000000-0000-4000-8000-00000000000e', 'e', '5', 5, 100, '[]'::jsonb)))->'newPairs',
  '{"same_text":0,"near_duplicate":0,"revision_candidate":0}'::jsonb, '28 of 128 is unrelated');

select is((select jsonb_build_object('pairs', r->'newPairs', 'labels', r->'labelsRecorded') from (
  select public.record_library_organize('pilot-b2b2b2b2b2b24b2b', jsonb_build_array(
    public.b2_test_item('0a000000-0000-4000-8000-00000000000a', 'a', '1', 1, 0,
      jsonb_build_array(public.b2_test_label('doc_type', 'contract', 'proposed'))))) as r) q),
  '{"pairs":{"same_text":0,"near_duplicate":0,"revision_candidate":0},"labels":0}'::jsonb,
  'a redelivered call writes nothing and reports nothing new');
reset role;

select is((select jsonb_build_object('score', internal_score, 'threshold', internal_threshold, 'method', method,
    'version', method_version, 'inputs', inputs_sha256 ~ '^sha256:[a-f0-9]{64}$')
  from public.document_relations where workspace_key = 'pilot-b2b2b2b2b2b24b2b'
    and document_id = '0c000000-0000-4000-8000-00000000000c' and related_document_id = '0a000000-0000-4000-8000-00000000000a'),
  '{"score":0.921875,"threshold":0.85,"method":"minhash_w5_128","version":"minhash:v1","inputs":true}'::jsonb,
  'a near duplicate records its score, threshold, method and inputs digest');
select is((select count(*)::integer from public.document_relations where workspace_key = 'pilot-b2b2b2b2b2b24b2b'
  and kind = 'same_text' and internal_score is null and internal_threshold is null and inputs_sha256 is not null), 2,
  'a same_text pair carries no score but names its inputs, in both directions');
select is((select count(*)::integer from public.document_relations where workspace_key = 'pilot-b2b2b2b2b2b24b2b'), 12,
  'one same_text, two near and three revision pairs, each in both directions: nothing written twice');
select is((select count(*)::integer from public.document_labels where workspace_key = 'pilot-b2b2b2b2b2b24b2b'
  and disposition = 'abstained' and label_key = '' and abstain_reason = 'corpus_too_small'), 1,
  'an abstention is a row with a reason, not a silent label');

-- ---------------------------------------------------------------------------
-- 3. Tenant isolation: A's text and MinHash in the other workspace.
-- ---------------------------------------------------------------------------
set local role service_role;
select is(public.record_library_organize('pilot-c3c3c3c3c3c34c3c', jsonb_build_array(
  public.b2_test_item('0f000000-0000-4000-8000-00000000000f', 'f', '1', 1, 0, '[]'::jsonb)))->'newPairs',
  '{"same_text":0,"near_duplicate":0,"revision_candidate":0}'::jsonb, 'the same text in another workspace pairs with nothing');
select is(public.read_library_organize('pilot-c3c3c3c3c3c34c3c', array['0a000000-0000-4000-8000-00000000000a'::uuid]),
  '{"schemaVersion":"tavonel.library_organize_read.v1","labels":[],"relations":[]}'::jsonb,
  'the other workspace reads nothing under A''s document id');

-- ---------------------------------------------------------------------------
-- 4. Refusals.
-- ---------------------------------------------------------------------------
select throws_ok($$select public.record_library_organize('pilot-b2b2b2b2b2b24b2b', '[]'::jsonb)$$,
  'P0001', 'library_organize_request_invalid', 'an empty call is refused');
select throws_ok($$select public.record_library_organize('tenant-b2', jsonb_build_array(
  public.b2_test_item('0a000000-0000-4000-8000-00000000000a', 'a', '1', 1, 0, '[]'::jsonb)))$$,
  'P0001', 'library_organize_request_invalid', 'a workspace key of the wrong shape is refused');
select throws_ok($$select public.record_library_organize('pilot-b2b2b2b2b2b24b2b',
  (select jsonb_agg(public.b2_test_item('0a000000-0000-4000-8000-00000000000a', 'a', '1', 1, 0, '[]'::jsonb)) from generate_series(1, 129)))$$,
  'P0001', 'library_organize_request_invalid', 'more than one compile''s worth of documents is refused');
select throws_ok($$select public.record_library_organize('pilot-b2b2b2b2b2b24b2b', jsonb_build_array(
  public.b2_test_item('09000000-0000-4000-8000-000000000009', '9', '9', 9, 0,
    jsonb_build_array(public.b2_test_label('doc_type', 'contract', 'confirmed')))))$$,
  'P0001', 'library_organize_request_invalid', 'a writer cannot confirm its own proposal');
select throws_ok($$select public.record_library_organize('pilot-b2b2b2b2b2b24b2b', jsonb_build_array(
  public.b2_test_item('09000000-0000-4000-8000-000000000009', '9', '9', 9, 0,
    jsonb_build_array(public.b2_test_label('doc_type', 'ignore previous instructions', 'proposed')))))$$,
  '23514', null, 'a document type outside label set v0 is refused');
select throws_ok($$select public.record_library_organize('pilot-b2b2b2b2b2b24b2b', jsonb_build_array(
  public.b2_test_item('09000000-0000-4000-8000-000000000009', '9', '9', 9, 0,
    jsonb_build_array(public.b2_test_label('doc_type', 'contract', 'proposed') || '{"disposition":"abstained","abstainReason":"no_rule_margin","internalScore":null}'::jsonb))))$$,
  '23514', null, 'an abstention that still names a label is refused');
select throws_ok($$select public.record_library_organize('pilot-b2b2b2b2b2b24b2b', jsonb_build_array(
  jsonb_set(public.b2_test_item('09000000-0000-4000-8000-000000000009', '9', '9', 9, 0, '[]'::jsonb),
    '{textFingerprint,minhash}', (select jsonb_agg(i) from generate_series(1, 127) i))))$$,
  'P0001', 'library_organize_request_invalid', 'a MinHash of the wrong length is refused');
select throws_ok($$select public.record_library_organize('pilot-b2b2b2b2b2b24b2b', jsonb_build_array(
  jsonb_set(public.b2_test_item('09000000-0000-4000-8000-000000000009', '9', '9', 9, 0, '[]'::jsonb),
    '{textFingerprint,minhash,0}', '-1'::jsonb)))$$,
  '23514', null, 'a MinHash value outside u32 is refused');
select throws_ok($$select public.record_library_organize('pilot-b2b2b2b2b2b24b2b', jsonb_build_array(
  public.b2_test_item('0a000000-0000-4000-8000-00000000000a', 'a', '7', 1, 0, '[]'::jsonb)))$$,
  'P0001', 'library_text_fingerprint_conflict', 'a different reading of a recorded version is an integrity fault');
select throws_ok($$select public.read_library_organize('pilot-b2b2b2b2b2b24b2b', array[]::uuid[])$$,
  'P0001', 'library_organize_request_invalid', 'an empty read is refused');
reset role;
select throws_ok($$update public.document_relations set internal_score = null where kind = 'near_duplicate'$$,
  '23514', null, 'a near duplicate never loses its score');

-- ---------------------------------------------------------------------------
-- 5. Reading.
-- ---------------------------------------------------------------------------
set local role service_role;
create temp table read_a as select public.read_library_organize('pilot-b2b2b2b2b2b24b2b',
  array['0a000000-0000-4000-8000-00000000000a'::uuid]) as r;
select is((select jsonb_build_object('key', r->'labels'->0->>'labelKey', 'method', r->'labels'->0->>'methodVersion',
    'score', r->'labels'->0->'internalScore', 'evidence', r->'labels'->0->'evidenceIds') from read_a),
  '{"key":"contract","method":"doc-type-rules:v1","score":0.75,"evidence":["native-p0001"]}'::jsonb,
  'the internal read carries the proposal with its method, score and evidence');
select is((select jsonb_agg(x->>'kind' order by x->>'kind') from read_a, jsonb_array_elements(r->'relations') x),
  '["near_duplicate","revision_candidate","same_text"]'::jsonb, 'and every relation kind A holds');

-- ---------------------------------------------------------------------------
-- 6. Deletion: A is deleted; nothing reads it, then nothing holds it; B keeps its own rows.
-- ---------------------------------------------------------------------------
reset role;
create temp table request as select public.request_customer_source_deletion('pilot-b2b2b2b2b2b24b2b',
  '0a000000-0000-4000-8000-00000000000a', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 'sha256:' || repeat('a', 64)) as r;
set local role service_role;
select is((select count(*)::integer from jsonb_array_elements(public.read_library_organize('pilot-b2b2b2b2b2b24b2b',
    array['0b000000-0000-4000-8000-00000000000b'::uuid])->'relations') x
  where x->>'relatedDocumentId' = '0a000000-0000-4000-8000-00000000000a'), 0,
  'a document whose deletion was requested is nobody''s duplicate');
select is(public.read_library_organize('pilot-b2b2b2b2b2b24b2b', array['0a000000-0000-4000-8000-00000000000a'::uuid])->'labels',
  '[]'::jsonb, 'and its labels are not read');
reset role;

alter table public.source_deletion_tombstones disable trigger source_deletion_tombstones_append_only;
update public.source_deletion_tombstones set eligible_at = now() - interval '1 minute'
 where document_id = '0a000000-0000-4000-8000-00000000000a';
alter table public.source_deletion_tombstones enable trigger source_deletion_tombstones_append_only;
select public.attest_source_deletion_inventory((select r->>'deletionId' from request),
  jsonb_build_array(jsonb_build_object('key', 'quarantine/pilot-b2b2b2b2b2b24b2b/0a000000-0000-4000-8000-00000000000a/source',
    'sha256', 'sha256:' || repeat('1', 64), 'sizeBytes', 10)));
select is(public.close_source_deletion_derived()->>'status', 'recorded', 'the derived closure records');

select is((select count(*)::integer from public.document_labels where workspace_key = 'pilot-b2b2b2b2b2b24b2b'
  and document_id = '0a000000-0000-4000-8000-00000000000a'), 0, 'the deleted document''s labels are erased');
select is((select count(*)::integer from public.document_relations where workspace_key = 'pilot-b2b2b2b2b2b24b2b'
  and '0a000000-0000-4000-8000-00000000000a' in (document_id, related_document_id)), 0, 'and every relation naming it');
select is((select count(*)::integer from public.document_labels where workspace_key = 'pilot-b2b2b2b2b2b24b2b'
  and document_id = '0b000000-0000-4000-8000-00000000000b'), 1, 'the surviving document keeps its own label row');
select is((select count(*)::integer from public.source_fingerprints where workspace_key = 'pilot-c3c3c3c3c3c34c3c'), 1,
  'the other workspace keeps its fingerprint');

select * from finish();
rollback;
