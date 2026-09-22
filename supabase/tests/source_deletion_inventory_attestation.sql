-- The R2-prefix inventory attestation is the only thing standing between a tombstone and an
-- irreversible object delete, and no deletion has ever executed anywhere. This fixture is the
-- measurement of what that gate does, not a restatement of what it was meant to do.
--
-- Four workspaces, because every refusal path needs a tombstone that reaches it:
--   pilot-del1  grace 0, hold off  -- the subject; the only candidate the sweeper may ever see
--   pilot-del2  grace 7, hold off  -- not yet eligible, and the owner of a foreign key prefix
--   pilot-del3  grace 0, hold ON   -- legal hold active
--   pilot-del4  grace 0, policy row removed after the request -- hold state unknown
begin;
select plan(37);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1',
  'authenticated', 'authenticated', 'deletion-inventory@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

insert into public.enterprise_organizations (organization_id, name, slug, created_by) values
  ('0a000000-0000-4000-8000-000000000001', 'Deletion One',   'deletion-inventory-one',   'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1'),
  ('0a000000-0000-4000-8000-000000000002', 'Deletion Two',   'deletion-inventory-two',   'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1'),
  ('0a000000-0000-4000-8000-000000000003', 'Deletion Three', 'deletion-inventory-three', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1'),
  ('0a000000-0000-4000-8000-000000000004', 'Deletion Four',  'deletion-inventory-four',  'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1');

insert into public.enterprise_workspaces (workspace_key, organization_id, display_name) values
  ('pilot-del1', '0a000000-0000-4000-8000-000000000001', 'Deletion One'),
  ('pilot-del2', '0a000000-0000-4000-8000-000000000002', 'Deletion Two'),
  ('pilot-del3', '0a000000-0000-4000-8000-000000000003', 'Deletion Three'),
  ('pilot-del4', '0a000000-0000-4000-8000-000000000004', 'Deletion Four');

insert into public.enterprise_governance_policies
  (organization_id, deleted_object_grace_days, legal_hold_enabled, updated_by) values
  ('0a000000-0000-4000-8000-000000000001', 0, false, 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1'),
  ('0a000000-0000-4000-8000-000000000002', 7, false, 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1'),
  ('0a000000-0000-4000-8000-000000000003', 0, true,  'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1'),
  ('0a000000-0000-4000-8000-000000000004', 0, false, 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1');

insert into public.foundation_oauth_connections (
  oauth_connection_id, workspace_key, provider, display_name, provider_account_id,
  granted_scopes, client_secret_reference, refresh_token_reference, created_by, updated_by
) values
  ('0c000000-0000-4000-8000-000000000001', 'pilot-del1', 'google_drive', 'Drive One', 'acct-1',
   array['drive.readonly'], 'vault://fixture/client', 'vault://fixture/refresh',
   'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1'),
  ('0c000000-0000-4000-8000-000000000002', 'pilot-del2', 'google_drive', 'Drive Two', 'acct-2',
   array['drive.readonly'], 'vault://fixture/client', 'vault://fixture/refresh',
   'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1'),
  ('0c000000-0000-4000-8000-000000000003', 'pilot-del3', 'dropbox', 'Dropbox Three', 'acct-3',
   array['files.content.read'], 'vault://fixture/client', 'vault://fixture/refresh',
   'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1'),
  ('0c000000-0000-4000-8000-000000000004', 'pilot-del4', 'microsoft_graph', 'Graph Four', 'acct-4',
   array['Files.Read.All'], 'vault://fixture/client', 'vault://fixture/refresh',
   'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1');

-- content_sha256 here is the digest request_connector_source_deletion seeds
-- source_deletion_objects with, so the manifest below must agree with it or
-- enqueue_source_deletion_object refuses on SOURCE_DELETION_OBJECT_DIGEST_CONFLICT.
insert into public.connector_document_bindings (
  source_version_id, source_id, workspace_key, oauth_connection_id, provider,
  native_id, provider_revision, document_id, content_sha256, byte_length, mime_type
) values
  ('sv-' || repeat('1', 64), 'src-' || repeat('a', 64), 'pilot-del1', '0c000000-0000-4000-8000-000000000001',
   'google_drive', 'native-a1', 'rev-1', '0d000000-0000-4000-8000-000000000001',
   'sha256:' || repeat('1', 64), 11, 'text/plain'),
  ('sv-' || repeat('2', 64), 'src-' || repeat('a', 64), 'pilot-del1', '0c000000-0000-4000-8000-000000000001',
   'google_drive', 'native-a2', 'rev-1', '0d000000-0000-4000-8000-000000000002',
   'sha256:' || repeat('2', 64), 12, 'text/plain'),
  ('sv-' || repeat('3', 64), 'src-' || repeat('b', 64), 'pilot-del2', '0c000000-0000-4000-8000-000000000002',
   'google_drive', 'native-b1', 'rev-1', '0d000000-0000-4000-8000-000000000003',
   'sha256:' || repeat('3', 64), 13, 'text/plain'),
  ('sv-' || repeat('4', 64), 'src-' || repeat('c', 64), 'pilot-del3', '0c000000-0000-4000-8000-000000000003',
   'dropbox', 'native-c1', 'rev-1', '0d000000-0000-4000-8000-000000000004',
   'sha256:' || repeat('4', 64), 14, 'text/plain'),
  ('sv-' || repeat('5', 64), 'src-' || repeat('d', 64), 'pilot-del4', '0c000000-0000-4000-8000-000000000004',
   'microsoft_graph', 'native-d1', 'rev-1', '0d000000-0000-4000-8000-000000000005',
   'sha256:' || repeat('5', 64), 15, 'text/plain');

select public.request_connector_source_deletion('pilot-del1', 'src-' || repeat('a', 64),
  '0c000000-0000-4000-8000-000000000001', 'google_drive', 'provider_deleted');
select public.request_connector_source_deletion('pilot-del2', 'src-' || repeat('b', 64),
  '0c000000-0000-4000-8000-000000000002', 'google_drive', 'provider_deleted');
select public.request_connector_source_deletion('pilot-del3', 'src-' || repeat('c', 64),
  '0c000000-0000-4000-8000-000000000003', 'dropbox', 'provider_inaccessible');
select public.request_connector_source_deletion('pilot-del4', 'src-' || repeat('d', 64),
  '0c000000-0000-4000-8000-000000000004', 'microsoft_graph', 'provider_deleted');

-- pilot-del4 loses its governance policy after the request. source_legal_hold_state then reports
-- 'unknown', which is not 'inactive' -- absence of a policy must never read as permission.
delete from public.enterprise_governance_policies
 where organization_id = '0a000000-0000-4000-8000-000000000004';

-- ---------------------------------------------------------------------------
-- The gate itself: nothing is sweepable before an attestation exists.
-- ---------------------------------------------------------------------------

select is(
  (select public.source_deletion_sweep_status()->>'inventoryIncomplete'),
  'true'::text,
  'an eligible tombstone with no attestation reports the inventory as incomplete'
);

select is(
  (select count(*)::integer from public.claim_source_deletion_sweep(1)),
  0,
  'the sweeper claims nothing while the inventory is unattested'
);

-- ---------------------------------------------------------------------------
-- candidate(): quiescence. A producer that can still write another artifact
-- means the prefix listing would seal a set that is not final.
-- ---------------------------------------------------------------------------

insert into public.foundation_jobs (job_id, workspace_key, job_type, state, idempotency_key, created_by)
values ('job-' || repeat('1', 32), 'pilot-del1', 'source_import', 'leased', 'import-leased-1',
  'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1');
select is(
  public.source_deletion_inventory_candidate(),
  null::jsonb,
  'a leased source_import job in the workspace withholds the candidate'
);
update public.foundation_jobs set state = 'queued' where job_id = 'job-' || repeat('1', 32);
select is(
  public.source_deletion_inventory_candidate(),
  null::jsonb,
  'a queued source_import job withholds the candidate too'
);
update public.foundation_jobs set state = 'succeeded', completed_at = now() where job_id = 'job-' || repeat('1', 32);

insert into public.foundation_compile_jobs
  (job_id, workspace_key, created_by_user_id, document_ids, idempotency_key, state, documents_total)
values ('cjob-' || repeat('1', 32), 'pilot-del1', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1',
  array['0d000000-0000-4000-8000-000000000002'], 'compile-touching-doc-2', 'preflight', 1);
select is(
  public.source_deletion_inventory_candidate(),
  null::jsonb,
  'a live compile job holding one of the documents withholds the candidate'
);
-- Terminal, not deleted: compile jobs and their events are append-only, which is also the more
-- honest shape -- a compile that finished is how quiescence is reached in production.
update public.foundation_compile_jobs set state = 'cancelled', settled_at = now()
 where job_id = 'cjob-' || repeat('1', 32);

insert into public.foundation_billing_accounts (workspace_key, user_id)
values ('pilot-del1', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1');
insert into public.foundation_compute_reservations
  (workspace_key, document_id, user_id, reserved_credits, maximum_credits, state, expires_at)
values ('pilot-del1', '0d000000-0000-4000-8000-000000000001',
  'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 2, 2, 'reserved', now() + interval '10 minutes');
select is(
  public.source_deletion_inventory_candidate(),
  null::jsonb,
  'a reserved compute reservation on one of the documents withholds the candidate'
);
delete from public.foundation_compute_reservations where workspace_key = 'pilot-del1';

-- ---------------------------------------------------------------------------
-- candidate(): the quiescent answer, and everything it leaves out.
-- ---------------------------------------------------------------------------

select is(
  public.source_deletion_inventory_candidate(),
  jsonb_build_object(
    'deletionId', (select deletion_id from public.source_deletion_tombstones where workspace_key = 'pilot-del1'),
    'workspaceKey', 'pilot-del1',
    'sourceId', 'src-' || repeat('a', 64),
    'documentIds', jsonb_build_array(
      '0d000000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000002')
  ),
  'the quiescent candidate names its deletion, workspace, source and exact document set'
);

-- The three tombstones the candidate must never offer are in the table beside it: pilot-del2 is
-- still inside its grace period, pilot-del3 is under an active hold, pilot-del4 has no policy.
select is(
  (select count(*)::integer from public.source_deletion_tombstones),
  4,
  'four tombstones exist, and only the eligible, hold-free one was offered'
);

-- ---------------------------------------------------------------------------
-- attest(): every refusal.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.attest_source_deletion_inventory(
       (select deletion_id from public.source_deletion_tombstones where workspace_key = 'pilot-del1'),
       (select jsonb_agg(jsonb_build_object(
          'key', 'quarantine/pilot-del1/0d000000-0000-4000-8000-000000000001/part-' || n,
          'sha256', 'sha256:' || repeat('7', 64),
          'sizeBytes', 1))
          from generate_series(1, 513) as n)) $$,
  'SOURCE_DELETION_INVENTORY_INVALID',
  '513 objects is refused rather than truncated to the 512 the attestation can hold'
);

-- An empty listing for a source that still has bound documents is a listing that did not happen,
-- not a source with nothing in it. Recording it would seal artifact_count 0 as a complete
-- inventory, enqueue no object, and turn every later attestation of the real bytes into a
-- permanent ATTESTATION_CONFLICT.
select throws_ok(
  $$ select public.attest_source_deletion_inventory(
       (select deletion_id from public.source_deletion_tombstones where workspace_key = 'pilot-del1'),
       '[]'::jsonb) $$,
  'SOURCE_DELETION_INVENTORY_EMPTY',
  'an empty manifest cannot seal a deletion whose source still has bound documents'
);

select throws_ok(
  $$ select public.attest_source_deletion_inventory(
       (select deletion_id from public.source_deletion_tombstones where workspace_key = 'pilot-del1'),
       jsonb_build_array(jsonb_build_object(
         'key', 'quarantine/pilot-del1/0d000000-0000-4000-8000-000000000009/source',
         'sha256', 'sha256:' || repeat('7', 64), 'sizeBytes', 9))) $$,
  'SOURCE_DELETION_INVENTORY_OBJECT_OUT_OF_SCOPE',
  'a key under this workspace but a document the source does not own is refused'
);

select throws_ok(
  $$ select public.attest_source_deletion_inventory(
       (select deletion_id from public.source_deletion_tombstones where workspace_key = 'pilot-del1'),
       jsonb_build_array(jsonb_build_object(
         'key', 'quarantine/pilot-del2/0d000000-0000-4000-8000-000000000003/source',
         'sha256', 'sha256:' || repeat('3', 64), 'sizeBytes', 13))) $$,
  'SOURCE_DELETION_INVENTORY_OBJECT_OUT_OF_SCOPE',
  'another workspace''s key cannot be smuggled into this deletion''s manifest'
);

select throws_ok(
  $$ select public.attest_source_deletion_inventory(
       (select deletion_id from public.source_deletion_tombstones where workspace_key = 'pilot-del1'),
       jsonb_build_array(jsonb_build_object(
         'key', 'immutable/pilot-del1/pilot-del2/0d000000-0000-4000-8000-000000000001/v1/source',
         'sha256', 'sha256:' || repeat('7', 64), 'sizeBytes', 9))) $$,
  'SOURCE_DELETION_INVENTORY_OBJECT_OUT_OF_SCOPE',
  'the immutable prefix must repeat this workspace twice, not borrow a second tenant'
);

select throws_ok(
  $$ select public.attest_source_deletion_inventory(
       'sha256:' || repeat('e', 64),
       jsonb_build_array(jsonb_build_object(
         'key', 'quarantine/pilot-del1/0d000000-0000-4000-8000-000000000001/source',
         'sha256', 'sha256:' || repeat('1', 64), 'sizeBytes', 11))) $$,
  'SOURCE_DELETION_INVENTORY_TOMBSTONE_MISSING',
  'a deletion id that matches no tombstone attests nothing'
);

select throws_ok(
  $$ select public.attest_source_deletion_inventory(
       (select deletion_id from public.source_deletion_tombstones where workspace_key = 'pilot-del2'),
       jsonb_build_array(jsonb_build_object(
         'key', 'quarantine/pilot-del2/0d000000-0000-4000-8000-000000000003/source',
         'sha256', 'sha256:' || repeat('3', 64), 'sizeBytes', 13))) $$,
  'SOURCE_DELETION_INVENTORY_NOT_ELIGIBLE',
  'a tombstone still inside its own workspace grace period cannot be attested'
);

select throws_ok(
  $$ select public.attest_source_deletion_inventory(
       (select deletion_id from public.source_deletion_tombstones where workspace_key = 'pilot-del3'),
       jsonb_build_array(jsonb_build_object(
         'key', 'quarantine/pilot-del3/0d000000-0000-4000-8000-000000000004/source',
         'sha256', 'sha256:' || repeat('4', 64), 'sizeBytes', 14))) $$,
  'SOURCE_LEGAL_HOLD_ACTIVE',
  'an active legal hold refuses the attestation'
);

select throws_ok(
  $$ select public.attest_source_deletion_inventory(
       (select deletion_id from public.source_deletion_tombstones where workspace_key = 'pilot-del4'),
       jsonb_build_array(jsonb_build_object(
         'key', 'quarantine/pilot-del4/0d000000-0000-4000-8000-000000000005/source',
         'sha256', 'sha256:' || repeat('5', 64), 'sizeBytes', 15))) $$,
  'SOURCE_LEGAL_HOLD_STATE_UNKNOWN',
  'a workspace whose governance policy cannot be read is not treated as hold-free'
);

select throws_ok(
  $$ select public.attest_source_deletion_inventory(
       (select deletion_id from public.source_deletion_tombstones where workspace_key = 'pilot-del1'),
       jsonb_build_array(
         jsonb_build_object('key', 'quarantine/pilot-del1/0d000000-0000-4000-8000-000000000001/source',
           'sha256', 'sha256:' || repeat('1', 64), 'sizeBytes', 11),
         jsonb_build_object('key', 'quarantine/pilot-del1/0d000000-0000-4000-8000-000000000001/source',
           'sha256', 'sha256:' || repeat('1', 64), 'sizeBytes', 11))) $$,
  'SOURCE_DELETION_INVENTORY_DUPLICATE_KEY',
  'the same key listed twice inflates the artifact count and is refused'
);

insert into public.foundation_jobs (job_id, workspace_key, job_type, state, idempotency_key, created_by)
values ('job-' || repeat('2', 32), 'pilot-del1', 'source_import', 'leased', 'import-leased-2',
  'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1');
select throws_ok(
  $$ select public.attest_source_deletion_inventory(
       (select deletion_id from public.source_deletion_tombstones where workspace_key = 'pilot-del1'),
       jsonb_build_array(jsonb_build_object(
         'key', 'quarantine/pilot-del1/0d000000-0000-4000-8000-000000000001/source',
         'sha256', 'sha256:' || repeat('1', 64), 'sizeBytes', 11))) $$,
  'SOURCE_DELETION_INVENTORY_NOT_QUIESCENT',
  'attestation re-checks quiescence itself rather than trusting the candidate read'
);
update public.foundation_jobs set state = 'succeeded', completed_at = now() where job_id = 'job-' || repeat('2', 32);

select is(
  (select count(*)::integer from public.source_deletion_inventory_attestations),
  0,
  'not one refused call left an attestation row behind'
);

-- ---------------------------------------------------------------------------
-- attest(): the recorded manifest, offered out of order on purpose.
-- ---------------------------------------------------------------------------

select is(
  public.attest_source_deletion_inventory(
    (select deletion_id from public.source_deletion_tombstones where workspace_key = 'pilot-del1'),
    jsonb_build_array(
      jsonb_build_object('key', 'quarantine/pilot-del1/0d000000-0000-4000-8000-000000000002/source',
        'sha256', 'sha256:' || repeat('2', 64), 'sizeBytes', 12),
      jsonb_build_object('key', 'immutable/pilot-del1/pilot-del1/0d000000-0000-4000-8000-000000000001/v1/source',
        'sha256', 'sha256:' || repeat('a', 64), 'sizeBytes', 40),
      jsonb_build_object('key', 'quarantine/pilot-del1/0d000000-0000-4000-8000-000000000001/source',
        'sha256', 'sha256:' || repeat('1', 64), 'sizeBytes', 11))
  ) - 'manifestSha256',
  jsonb_build_object('status', 'recorded', 'artifactCount', 3),
  'a complete three-object inventory is recorded'
);

-- The digest the database returns is recomputed here from the canonical form the migration
-- promises: schema version, deletion, workspace, source, and the objects sorted by key with
-- sizeBytes as an integer. A future change to that recipe turns this red instead of silently
-- invalidating every attestation already written.
select is(
  (select inventory_manifest_sha256 from public.source_deletion_inventory_attestations
    where workspace_key = 'pilot-del1'),
  'sha256:' || encode(extensions.digest(convert_to(jsonb_build_object(
    'schemaVersion', 'tavonel.source_deletion_inventory.v1',
    'deletionId', (select deletion_id from public.source_deletion_tombstones where workspace_key = 'pilot-del1'),
    'workspaceKey', 'pilot-del1',
    'sourceId', 'src-' || repeat('a', 64),
    'objects', jsonb_build_array(
      jsonb_build_object('key', 'immutable/pilot-del1/pilot-del1/0d000000-0000-4000-8000-000000000001/v1/source',
        'sha256', 'sha256:' || repeat('a', 64), 'sizeBytes', 40),
      jsonb_build_object('key', 'quarantine/pilot-del1/0d000000-0000-4000-8000-000000000001/source',
        'sha256', 'sha256:' || repeat('1', 64), 'sizeBytes', 11),
      jsonb_build_object('key', 'quarantine/pilot-del1/0d000000-0000-4000-8000-000000000002/source',
        'sha256', 'sha256:' || repeat('2', 64), 'sizeBytes', 12))
  )::text, 'UTF8'), 'sha256'), 'hex'),
  'the stored digest is over the canonical key-sorted manifest, not over the caller''s order'
);

select is(
  public.source_deletion_inventory_candidate(),
  null::jsonb,
  'an attested deletion is no longer offered as a candidate'
);

select is(
  (select public.source_deletion_sweep_status()->>'inventoryIncomplete'),
  'false'::text,
  'the sweep status clears once every eligible tombstone is attested'
);

-- ---------------------------------------------------------------------------
-- Replay and conflict.
-- ---------------------------------------------------------------------------

select is(
  public.attest_source_deletion_inventory(
    (select deletion_id from public.source_deletion_tombstones where workspace_key = 'pilot-del1'),
    jsonb_build_array(
      jsonb_build_object('key', 'quarantine/pilot-del1/0d000000-0000-4000-8000-000000000002/source',
        'sha256', 'sha256:' || repeat('2', 64), 'sizeBytes', 12),
      jsonb_build_object('key', 'immutable/pilot-del1/pilot-del1/0d000000-0000-4000-8000-000000000001/v1/source',
        'sha256', 'sha256:' || repeat('a', 64), 'sizeBytes', 40),
      jsonb_build_object('key', 'quarantine/pilot-del1/0d000000-0000-4000-8000-000000000001/source',
        'sha256', 'sha256:' || repeat('1', 64), 'sizeBytes', 11))
  ) - 'manifestSha256',
  jsonb_build_object('status', 'replayed', 'artifactCount', 3),
  'an identical redelivery replays rather than writing a second attestation'
);

select is(
  public.attest_source_deletion_inventory(
    (select deletion_id from public.source_deletion_tombstones where workspace_key = 'pilot-del1'),
    jsonb_build_array(
      jsonb_build_object('key', 'immutable/pilot-del1/pilot-del1/0d000000-0000-4000-8000-000000000001/v1/source',
        'sha256', 'sha256:' || repeat('a', 64), 'sizeBytes', 40),
      jsonb_build_object('key', 'quarantine/pilot-del1/0d000000-0000-4000-8000-000000000001/source',
        'sha256', 'sha256:' || repeat('1', 64), 'sizeBytes', 11),
      jsonb_build_object('key', 'quarantine/pilot-del1/0d000000-0000-4000-8000-000000000002/source',
        'sha256', 'sha256:' || repeat('2', 64), 'sizeBytes', 12))
  ) - 'manifestSha256',
  jsonb_build_object('status', 'replayed', 'artifactCount', 3),
  'the same set in a different order is the same manifest, not a conflict'
);

select throws_ok(
  $$ select public.attest_source_deletion_inventory(
       (select deletion_id from public.source_deletion_tombstones where workspace_key = 'pilot-del1'),
       jsonb_build_array(
         jsonb_build_object('key', 'quarantine/pilot-del1/0d000000-0000-4000-8000-000000000001/source',
           'sha256', 'sha256:' || repeat('1', 64), 'sizeBytes', 11),
         jsonb_build_object('key', 'quarantine/pilot-del1/0d000000-0000-4000-8000-000000000002/source',
           'sha256', 'sha256:' || repeat('2', 64), 'sizeBytes', 12),
         jsonb_build_object('key', 'immutable/pilot-del1/pilot-del1/0d000000-0000-4000-8000-000000000001/v1/source',
           'sha256', 'sha256:' || repeat('a', 64), 'sizeBytes', 40),
         jsonb_build_object('key', 'immutable/pilot-del1/pilot-del1/0d000000-0000-4000-8000-000000000002/v1/source',
           'sha256', 'sha256:' || repeat('b', 64), 'sizeBytes', 41))) $$,
  'SOURCE_DELETION_INVENTORY_ATTESTATION_CONFLICT',
  'a fourth object discovered after the seal is a conflict, never a quiet widening'
);

select throws_ok(
  $$ select public.attest_source_deletion_inventory(
       (select deletion_id from public.source_deletion_tombstones where workspace_key = 'pilot-del1'),
       jsonb_build_array(
         jsonb_build_object('key', 'quarantine/pilot-del1/0d000000-0000-4000-8000-000000000001/source',
           'sha256', 'sha256:' || repeat('1', 64), 'sizeBytes', 11),
         jsonb_build_object('key', 'quarantine/pilot-del1/0d000000-0000-4000-8000-000000000002/source',
           'sha256', 'sha256:' || repeat('2', 64), 'sizeBytes', 12),
         jsonb_build_object('key', 'immutable/pilot-del1/pilot-del1/0d000000-0000-4000-8000-000000000001/v1/source',
           'sha256', 'sha256:' || repeat('c', 64), 'sizeBytes', 40))) $$,
  'SOURCE_DELETION_INVENTORY_ATTESTATION_CONFLICT',
  'the same three keys with one digest changed is a different manifest'
);

select is(
  (select count(*)::integer from public.source_deletion_inventory_attestations),
  1,
  'replay and conflict together left exactly one attestation row'
);

-- ---------------------------------------------------------------------------
-- The attestation is evidence: append-only, and not editable into agreement.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update public.source_deletion_inventory_attestations set artifact_count = 4
      where workspace_key = 'pilot-del1' $$,
  'source_deletion_evidence_append_only',
  'an attestation row cannot be updated'
);

select throws_ok(
  $$ delete from public.source_deletion_inventory_attestations where workspace_key = 'pilot-del1' $$,
  'source_deletion_evidence_append_only',
  'an attestation row cannot be deleted'
);

-- ---------------------------------------------------------------------------
-- After attestation the sweeper may finally see the objects -- and only these.
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(object_key order by object_key) from public.source_deletion_objects
    where workspace_key = 'pilot-del1'),
  array[
    'immutable/pilot-del1/pilot-del1/0d000000-0000-4000-8000-000000000001/v1/source',
    'quarantine/pilot-del1/0d000000-0000-4000-8000-000000000001/source',
    'quarantine/pilot-del1/0d000000-0000-4000-8000-000000000002/source'
  ]::text[],
  'the attested manifest is what the purge queue holds'
);

select is(
  (select claim->>'objectKey' from public.claim_source_deletion_sweep(1) as claim),
  'immutable/pilot-del1/pilot-del1/0d000000-0000-4000-8000-000000000001/v1/source'::text,
  'the sweeper now claims the first attested object'
);

select is(
  (select claim->>'objectKey' from public.claim_source_deletion_sweep(1) as claim),
  'quarantine/pilot-del1/0d000000-0000-4000-8000-000000000001/source'::text,
  'a second claim skips the leased object and takes the next one'
);

select is(
  (select count(*)::integer from public.source_deletion_objects
    where workspace_key = 'pilot-del1' and purge_claim_id is not null),
  2,
  'two claims are outstanding and the third object is still unclaimed'
);

-- The claim carries no object from the three tombstones that never reached attestation.
select is(
  (select count(*)::integer from public.source_deletion_objects
    where workspace_key <> 'pilot-del1' and purge_claim_id is not null),
  0,
  'no object outside the attested deletion was ever claimed'
);

select is(
  (select count(*)::integer from public.source_deletion_receipts where action = 'object_purged'),
  0,
  'claiming is not purging: this fixture deleted nothing and wrote no purge receipt'
);

select * from finish();
rollback;
