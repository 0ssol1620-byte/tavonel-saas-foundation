-- Approved intake UUIDv4 identities and batch idempotency must share the cursor transaction.
-- Run with `supabase test db` against a disposable database migrated through head.
begin;
select plan(22);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'approved-sync-a@example.invalid', '$2a$10$fixture', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-4000-8000-0000000000b1',
   'authenticated', 'authenticated', 'approved-sync-b@example.invalid', '$2a$10$fixture', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.foundation_api_keys (key_id, workspace_key, name, key_prefix, token_sha256, scopes, created_by, revoked_at) values
  ('a0000000-0000-4000-8000-00000000a0e1', 'pilot-syncA', 'sync A', 'syncKey00001', repeat('1', 64), array['connections:sync'], 'a0000000-0000-4000-8000-0000000000a1', null),
  ('a0000000-0000-4000-8000-00000000a0e2', 'pilot-syncA', 'sync B principal', 'syncKey00002', repeat('2', 64), array['connections:sync'], 'b0000000-0000-4000-8000-0000000000b1', null),
  ('a0000000-0000-4000-8000-00000000a0e3', 'pilot-syncA', 'sync read only', 'syncKey00003', repeat('3', 64), array['documents:read'], 'a0000000-0000-4000-8000-0000000000a1', null),
  ('a0000000-0000-4000-8000-00000000a0e4', 'pilot-syncA', 'sync revoked', 'syncKey00004', repeat('4', 64), array['connections:sync'], 'a0000000-0000-4000-8000-0000000000a1', now());

insert into public.foundation_connections (connection_id, workspace_key, provider, mode, display_name, status, created_by, updated_by)
values ('a0000000-0000-4000-8000-0000000000c1', 'pilot-syncA', 'file_server', 'local_agent', 'Approved sync', 'active',
  'a0000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-0000000000a1');

create function pg_temp.digest_hex(p_value text) returns text
language sql immutable as $fn$
  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_value, 'UTF8'), 'sha256'), 'hex')
$fn$;

create function pg_temp.file_key(p_native text, p_content text, p_size integer, p_mime text) returns text
language sql immutable as $fn$
  select 'fk_' || pg_catalog.substring(pg_temp.digest_hex(
    'tavonel-intake-file-v1' || pg_catalog.chr(31) || p_native || pg_catalog.chr(31) || p_content
    || pg_catalog.chr(31) || p_size::text || pg_catalog.chr(31) || p_mime), 1, 40)
$fn$;

create function pg_temp.approved_source_key(p_attempt text, p_file text) returns text
language sql immutable as $fn$
  select pg_temp.digest_hex('tavonel-approved-source-v1' || pg_catalog.chr(31) || p_attempt || pg_catalog.chr(31) || p_file)
$fn$;

create function pg_temp.approved_event(p_document uuid, p_attempt text, p_file text, p_native text,
  p_content text, p_size integer, p_mime text) returns jsonb
language sql immutable as $fn$
  select jsonb_build_object(
    'kind', 'added', 'nativeId', p_native, 'revision', 'sha256:' || p_content,
    'contentSha256', p_content, 'sizeBytes', p_size, 'mimeType', p_mime,
    'documentId', p_document, 'sourceIdempotencyKey', pg_temp.approved_source_key(p_attempt, p_file))
$fn$;

create function pg_temp.batch(p_batch uuid, p_previous text, p_next text, p_manifest text,
  p_events jsonb, p_actor_key uuid) returns text
language sql as $fn$
  select public.apply_foundation_connection_batch(
    p_batch, 'pilot-syncA', 'a0000000-0000-4000-8000-0000000000c1', p_previous, p_next,
    p_manifest, jsonb_array_length(p_events), p_events, null, p_actor_key)->>'status'
$fn$;

-- Direct fixture rows represent the server-issued, approved member and its successful upload
-- confirmation. The batch RPC must bind all event metadata to these rows before advancing cursor.
insert into public.foundation_intake_approvals (
  approval_id, workspace_key, user_id, attempt_key, client_manifest_digest, scope_digest,
  pricing_fingerprint, file_count, aggregate_maximum_pages, aggregate_reserved_credits,
  aggregate_maximum_credits, state, created_at, expires_at
) values (
  'a0000000-0000-4000-8000-00000000aa01', 'pilot-syncA', 'a0000000-0000-4000-8000-0000000000a1',
  'attempt-approved-sync-01', 'sha256:' || repeat('a',64), 'sha256:' || repeat('b',64),
  'sha256:' || repeat('c',64), 2, 2, 2, 2, 'approved', now() - interval '1 minute', now() + interval '9 minutes'
);

insert into public.foundation_intake_approval_files (
  approval_id, file_key, document_id, content_sha256, byte_length, declared_mime_type, page_basis,
  approved_max_pages, approved_reserved_credits, approved_maximum_credits, state, reservation_id,
  reserved_at, confirmed_at, created_at
) values
  ('a0000000-0000-4000-8000-00000000aa01',
   pg_temp.file_key('folder/report.pdf', repeat('d',64), 1024, 'application/pdf'),
   '11111111-1111-4111-8111-111111111111', 'sha256:' || repeat('d',64), 1024, 'application/pdf',
   'declared', 1, 1, 1, 'confirmed', 'a0000000-0000-4000-8000-00000000aa11', now(), now(), now()),
  ('a0000000-0000-4000-8000-00000000aa01',
   pg_temp.file_key('folder/unconfirmed.pdf', repeat('e',64), 512, 'application/pdf'),
   '22222222-2222-4222-8222-222222222222', 'sha256:' || repeat('e',64), 512, 'application/pdf',
   'declared', 1, 1, 1, 'approved', null, null, null, now());

insert into public.foundation_intake_approvals (
  approval_id, workspace_key, user_id, attempt_key, client_manifest_digest, scope_digest,
  pricing_fingerprint, file_count, aggregate_maximum_pages, aggregate_reserved_credits,
  aggregate_maximum_credits, state, created_at, expires_at, cancelled_at, cancel_reason
) values (
  'a0000000-0000-4000-8000-00000000aa02', 'pilot-syncA', 'a0000000-0000-4000-8000-0000000000a1',
  'attempt-cancelled-sync-02', 'sha256:' || repeat('a',64), 'sha256:' || repeat('b',64),
  'sha256:' || repeat('c',64), 1, 1, 1, 1, 'cancelled', now() - interval '1 minute', now() + interval '9 minutes', now(), 'TEST_CANCELLED'
);
insert into public.foundation_intake_approval_files (
  approval_id, file_key, document_id, content_sha256, byte_length, declared_mime_type, page_basis,
  approved_max_pages, approved_reserved_credits, approved_maximum_credits, state, reservation_id,
  reserved_at, confirmed_at, cancelled_at, cancel_reason, created_at
) values (
  'a0000000-0000-4000-8000-00000000aa02',
  pg_temp.file_key('folder/cancelled.pdf', repeat('f',64), 256, 'application/pdf'),
  '33333333-3333-4333-8333-333333333333', 'sha256:' || repeat('f',64), 256, 'application/pdf',
  'declared', 1, 1, 1, 'cancelled', 'a0000000-0000-4000-8000-00000000aa22', now(), now(), now(), 'TEST_CANCELLED', now()
);

-- The initial approved UUIDv4 batch applies once; an exact replay is a no-op.
select is(pg_temp.batch(
  'a0000000-0000-4000-8000-00000000ab01', null, 'sha256:' || repeat('1',64),
  'sha256:' || repeat('2',64),
  jsonb_build_array(pg_temp.approved_event('11111111-1111-4111-8111-111111111111',
    'attempt-approved-sync-01', pg_temp.file_key('folder/report.pdf',repeat('d',64),1024,'application/pdf'),
    'folder/report.pdf',repeat('d',64),1024,'application/pdf')),
  'a0000000-0000-4000-8000-00000000a0e1'), 'applied', 'first approved UUIDv4 batch commits');

select is(pg_temp.batch(
  'a0000000-0000-4000-8000-00000000ab01', null, 'sha256:' || repeat('1',64),
  'sha256:' || repeat('2',64),
  jsonb_build_array(pg_temp.approved_event('11111111-1111-4111-8111-111111111111',
    'attempt-approved-sync-01', pg_temp.file_key('folder/report.pdf',repeat('d',64),1024,'application/pdf'),
    'folder/report.pdf',repeat('d',64),1024,'application/pdf')),
  'a0000000-0000-4000-8000-00000000a0e1'), 'replayed', 'exact batch retry replays');

select throws_ok($$select pg_temp.batch(
  'a0000000-0000-4000-8000-00000000ab01', 'sha256:' || repeat('9',64), 'sha256:' || repeat('1',64),
  'sha256:' || repeat('2',64),
  jsonb_build_array(pg_temp.approved_event('11111111-1111-4111-8111-111111111111',
    'attempt-approved-sync-01', pg_temp.file_key('folder/report.pdf',repeat('d',64),1024,'application/pdf'),
    'folder/report.pdf',repeat('d',64),1024,'application/pdf')),
  'a0000000-0000-4000-8000-00000000a0e1')$$,
  'P0001', 'connection_batch_idempotency_conflict', 'altered previous cursor conflicts before replay');

select throws_ok($$select pg_temp.batch(
  'a0000000-0000-4000-8000-00000000ab01', null, 'sha256:' || repeat('9',64),
  'sha256:' || repeat('2',64),
  jsonb_build_array(pg_temp.approved_event('11111111-1111-4111-8111-111111111111',
    'attempt-approved-sync-01', pg_temp.file_key('folder/report.pdf',repeat('d',64),1024,'application/pdf'),
    'folder/report.pdf',repeat('d',64),1024,'application/pdf')),
  'a0000000-0000-4000-8000-00000000a0e1')$$,
  'P0001', 'connection_batch_idempotency_conflict', 'altered next cursor conflicts before replay');

select is((select cursor_sha256 from public.foundation_connections where connection_id='a0000000-0000-4000-8000-0000000000c1'),
  'sha256:' || repeat('1',64), 'replay conflicts preserve the committed cursor');
select is((select count(*)::integer from public.foundation_connection_batches where connection_id='a0000000-0000-4000-8000-0000000000c1'),
  1, 'replay conflicts do not add batch rows');
select is((select count(*)::integer from public.foundation_developer_audit_events where action='connection_batch_applied'),
  1, 'replay conflicts do not add audit events');

-- Wrong member, source key, principal, unconfirmed file and canceled approval all fail closed.
select throws_ok($$select pg_temp.batch(
  'a0000000-0000-4000-8000-00000000ab02', 'sha256:' || repeat('1',64), 'sha256:' || repeat('3',64),
  'sha256:' || repeat('4',64), jsonb_build_array(pg_temp.approved_event(
    '44444444-4444-4444-8444-444444444444','attempt-approved-sync-01',
    pg_temp.file_key('folder/report.pdf',repeat('d',64),1024,'application/pdf'),
    'folder/report.pdf',repeat('d',64),1024,'application/pdf')),
  'a0000000-0000-4000-8000-00000000a0e1')$$,
  'P0001', 'connection_batch_approved_source_invalid', 'unknown UUIDv4 document is refused');

select throws_ok($$select pg_temp.batch(
  'a0000000-0000-4000-8000-00000000ab03', 'sha256:' || repeat('1',64), 'sha256:' || repeat('3',64),
  'sha256:' || repeat('5',64), jsonb_build_array(jsonb_set(pg_temp.approved_event(
    '11111111-1111-4111-8111-111111111111','attempt-approved-sync-01',
    pg_temp.file_key('folder/report.pdf',repeat('d',64),1024,'application/pdf'),
    'folder/report.pdf',repeat('d',64),1024,'application/pdf'), '{sourceIdempotencyKey}', to_jsonb(repeat('0',64)))),
  'a0000000-0000-4000-8000-00000000a0e1')$$,
  'P0001', 'connection_batch_approved_source_invalid', 'forged source idempotency key is refused');

select throws_ok($$select pg_temp.batch(
  'a0000000-0000-4000-8000-00000000ab04', 'sha256:' || repeat('1',64), 'sha256:' || repeat('3',64),
  'sha256:' || repeat('6',64), jsonb_build_array(pg_temp.approved_event(
    '22222222-2222-4222-8222-222222222222','attempt-approved-sync-01',
    pg_temp.file_key('folder/unconfirmed.pdf',repeat('e',64),512,'application/pdf'),
    'folder/unconfirmed.pdf',repeat('e',64),512,'application/pdf')),
  'a0000000-0000-4000-8000-00000000a0e1')$$,
  'P0001', 'connection_batch_approved_source_invalid', 'unconfirmed approval member is refused');

select throws_ok($$select pg_temp.batch(
  'a0000000-0000-4000-8000-00000000ab05', 'sha256:' || repeat('1',64), 'sha256:' || repeat('3',64),
  'sha256:' || repeat('7',64), jsonb_build_array(pg_temp.approved_event(
    '11111111-1111-4111-8111-111111111111','attempt-approved-sync-01',
    pg_temp.file_key('folder/report.pdf',repeat('d',64),1024,'application/pdf'),
    'folder/report.pdf',repeat('d',64),1024,'application/pdf')),
  'a0000000-0000-4000-8000-00000000a0e2')$$,
  'P0001', 'connection_batch_approved_source_invalid', 'approval belonging to another API-key principal is refused');

select throws_ok($$select pg_temp.batch(
  'a0000000-0000-4000-8000-00000000ab06', 'sha256:' || repeat('1',64), 'sha256:' || repeat('3',64),
  'sha256:' || repeat('8',64), jsonb_build_array(pg_temp.approved_event(
    '33333333-3333-4333-8333-333333333333','attempt-cancelled-sync-02',
    pg_temp.file_key('folder/cancelled.pdf',repeat('f',64),256,'application/pdf'),
    'folder/cancelled.pdf',repeat('f',64),256,'application/pdf')),
  'a0000000-0000-4000-8000-00000000a0e1')$$,
  'P0001', 'connection_batch_approved_source_invalid', 'canceled approval member is refused');

select throws_ok($$select pg_temp.batch(
  'a0000000-0000-4000-8000-00000000ab08', 'sha256:' || repeat('1',64), 'sha256:' || repeat('3',64),
  'sha256:' || repeat('9',64), jsonb_build_array(pg_temp.approved_event(
    '11111111-1111-4111-8111-111111111111','attempt-approved-sync-01',
    pg_temp.file_key('folder/report.pdf',repeat('d',64),1024,'application/pdf'),
    'folder/report.pdf',repeat('d',64),1024,'application/pdf')),
  'a0000000-0000-4000-8000-00000000a0e3')$$,
  'P0001', 'connection_batch_actor_invalid', 'API key without connections:sync scope is refused');

select throws_ok($$select pg_temp.batch(
  'a0000000-0000-4000-8000-00000000ab09', 'sha256:' || repeat('1',64), 'sha256:' || repeat('3',64),
  'sha256:' || repeat('a',64), jsonb_build_array(pg_temp.approved_event(
    '11111111-1111-4111-8111-111111111111','attempt-approved-sync-01',
    pg_temp.file_key('folder/report.pdf',repeat('d',64),1024,'application/pdf'),
    'folder/report.pdf',repeat('d',64),1024,'application/pdf')),
  'a0000000-0000-4000-8000-00000000a0e4')$$,
  'P0001', 'connection_batch_actor_invalid', 'revoked API key is refused');

insert into public.source_deletion_tombstones (
  deletion_id, workspace_key, source_id, oauth_connection_id, provider, reason,
  eligible_at, document_id, requested_by_user_id, request_manifest_sha256
) values (
  'sha256:' || repeat('b',64), 'pilot-syncA', '11111111-1111-4111-8111-111111111111',
  null, null, 'customer_requested', now(), '11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-0000000000a1', 'sha256:' || repeat('c',64)
);
select throws_ok($$select pg_temp.batch(
  'a0000000-0000-4000-8000-00000000ab10', 'sha256:' || repeat('1',64), 'sha256:' || repeat('3',64),
  'sha256:' || repeat('b',64), jsonb_build_array(pg_temp.approved_event(
    '11111111-1111-4111-8111-111111111111','attempt-approved-sync-01',
    pg_temp.file_key('folder/report.pdf',repeat('d',64),1024,'application/pdf'),
    'folder/report.pdf',repeat('d',64),1024,'application/pdf')),
  'a0000000-0000-4000-8000-00000000a0e1')$$,
  'P0001', 'connection_batch_approved_source_unavailable', 'tombstoned approved document is refused');

select is((select cursor_sha256 from public.foundation_connections where connection_id='a0000000-0000-4000-8000-0000000000c1'),
  'sha256:' || repeat('1',64), 'rejected identity bindings preserve the cursor');
select is((select count(*)::integer from public.foundation_connection_batches where connection_id='a0000000-0000-4000-8000-0000000000c1'),
  1, 'rejected identity bindings do not insert batches');
select is((select count(*)::integer from public.foundation_developer_audit_events where action='connection_batch_applied'),
  1, 'rejected identity bindings do not create audit events');

-- A legacy deterministic UUIDv5-style ID remains accepted and advances only after commit.
create function pg_temp.legacy_document_id(p_workspace text, p_source_key text) returns uuid
language plpgsql immutable as $fn$
declare v_bytes bytea; v_hex text;
begin
  v_bytes := extensions.digest(pg_catalog.convert_to(
    'tavonel-source-intake' || pg_catalog.chr(31) || p_workspace || pg_catalog.chr(31) || p_source_key, 'UTF8'), 'sha256');
  v_bytes := pg_catalog.set_byte(v_bytes, 6, (pg_catalog.get_byte(v_bytes, 6) & 15) | 80);
  v_bytes := pg_catalog.set_byte(v_bytes, 8, (pg_catalog.get_byte(v_bytes, 8) & 63) | 128);
  v_hex := pg_catalog.encode(v_bytes, 'hex');
  return (pg_catalog.substring(v_hex,1,8)||'-'||pg_catalog.substring(v_hex,9,4)||'-'||pg_catalog.substring(v_hex,13,4)||'-'||pg_catalog.substring(v_hex,17,4)||'-'||pg_catalog.substring(v_hex,21,12))::uuid;
end
$fn$;

select is(pg_temp.batch(
  'a0000000-0000-4000-8000-00000000ab07', 'sha256:' || repeat('1',64), 'sha256:' || repeat('9',64),
  'sha256:' || repeat('a',64), jsonb_build_array(jsonb_build_object(
    'kind','added','nativeId','legacy/report.pdf','revision','sha256:'||repeat('9',64),
    'contentSha256',repeat('9',64),'sizeBytes',100,'mimeType','application/pdf',
    'documentId',pg_temp.legacy_document_id('pilot-syncA',repeat('9',64)),
    'sourceIdempotencyKey',repeat('9',64))),
  'a0000000-0000-4000-8000-00000000a0e1'), 'applied', 'legacy deterministic source identity remains accepted');
select is((select cursor_sha256 from public.foundation_connections where connection_id='a0000000-0000-4000-8000-0000000000c1'),
  'sha256:' || repeat('9',64), 'legacy batch cursor commits after accepted batch');
select is((select count(*)::integer from public.foundation_connection_batches where connection_id='a0000000-0000-4000-8000-0000000000c1'),
  2, 'only the approved and legacy accepted batches exist');
select is((select count(*)::integer from public.foundation_developer_audit_events where action='connection_batch_applied'),
  2, 'only accepted batches emit audit events');

select * from finish();
rollback;


