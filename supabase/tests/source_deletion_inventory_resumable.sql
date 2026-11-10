-- Migration 20261110043000 (ADR-0006, Bound E5): a deletion inventory past 512 objects is attested
-- across several worker runs from persisted per-object digests, and the set sealed is exactly the
-- set the worker checked against its listing.
--
-- One workspace, grace 0, hold off: pilot-e5del. Its one connector source binds one document; the
-- "listing" is 600 objects under that document's quarantine prefix.
begin;
select plan(21);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5',
  'authenticated', 'authenticated', 'deletion-resumable@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

insert into public.enterprise_organizations (organization_id, name, slug, created_by) values
  ('0a0000e5-0000-4000-8000-000000000001', 'Deletion Resumable', 'deletion-resumable',
   'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5');
insert into public.enterprise_workspaces (workspace_key, organization_id, display_name) values
  ('pilot-e5del', '0a0000e5-0000-4000-8000-000000000001', 'Deletion Resumable');
insert into public.enterprise_governance_policies
  (organization_id, deleted_object_grace_days, legal_hold_enabled, updated_by) values
  ('0a0000e5-0000-4000-8000-000000000001', 0, false, 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5');

insert into public.foundation_oauth_connections (
  oauth_connection_id, workspace_key, provider, display_name, provider_account_id,
  granted_scopes, client_secret_reference, refresh_token_reference, created_by, updated_by
) values
  ('0c0000e5-0000-4000-8000-000000000001', 'pilot-e5del', 'google_drive', 'Drive E5', 'acct-e5',
   array['drive.readonly'], 'vault://fixture/client', 'vault://fixture/refresh',
   'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5');

insert into public.connector_document_bindings (
  source_version_id, source_id, workspace_key, oauth_connection_id, provider,
  native_id, provider_revision, document_id, content_sha256, byte_length, mime_type
) values
  ('sv-' || repeat('e', 64), 'src-' || repeat('e', 64), 'pilot-e5del', '0c0000e5-0000-4000-8000-000000000001',
   'google_drive', 'native-e5', 'rev-1', '0d0000e5-0000-4000-8000-000000000001',
   'sha256:' || repeat('e', 64), 11, 'application/pdf');

select public.request_connector_source_deletion('pilot-e5del', 'src-' || repeat('e', 64),
  '0c0000e5-0000-4000-8000-000000000001', 'google_drive', 'provider_deleted');

create function pg_temp.del() returns text language sql stable as $$
  select deletion_id from public.source_deletion_tombstones where workspace_key = 'pilot-e5del';
$$;
create function pg_temp.part(n integer) returns text language sql immutable as $$
  select 'quarantine/pilot-e5del/0d0000e5-0000-4000-8000-000000000001/segments/part-' || lpad(n::text, 5, '0');
$$;
create function pg_temp.set_sha() returns text language sql stable as $$
  select public.read_source_deletion_inventory_digests(pg_temp.del())->>'digestSetSha256';
$$;

-- ---------------------------------------------------------------------------
-- Nothing recorded: sealing the empty set is the empty listing, refused as before.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.seal_source_deletion_inventory(pg_temp.del(), pg_temp.set_sha()) $$,
  'SOURCE_DELETION_INVENTORY_EMPTY',
  'an empty digest set cannot seal a deletion whose source still has bound documents'
);

-- ---------------------------------------------------------------------------
-- Two runs, 300 objects each: past the old 512-object bound.
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.record_source_deletion_inventory_digest(pg_temp.del(), pg_temp.part(n), 1, 'sha256:' || repeat('7', 64), 'etag-1')
       from generate_series(1, 300) as n $$,
  'run 1 records the first 300 digests'
);
select lives_ok(
  $$ select public.record_source_deletion_inventory_digest(pg_temp.del(), pg_temp.part(n), 1, 'sha256:' || repeat('7', 64), 'etag-1')
       from generate_series(301, 600) as n $$,
  'run 2 records the next 300 digests'
);
select is(
  pg_catalog.jsonb_array_length(public.read_source_deletion_inventory_digests(pg_temp.del())->'objects'),
  600,
  'the digests of both runs are read back as one set of 600'
);
select is(
  public.read_source_deletion_inventory_digests(pg_temp.del())->'objects'->0,
  jsonb_build_object('key', pg_temp.part(1), 'sha256', 'sha256:' || repeat('7', 64), 'sizeBytes', 1, 'etag', 'etag-1'),
  'the set is ordered by key and carries key, digest, listed size and listed ETag'
);

-- ---------------------------------------------------------------------------
-- A set that changed after the worker read it is not sealed.
-- ---------------------------------------------------------------------------

create temporary table e5_read as select pg_temp.set_sha() as sha;
-- An overlapping run saw a different size for one key and hashed it again.
select public.record_source_deletion_inventory_digest(pg_temp.del(), pg_temp.part(1), 2, 'sha256:' || repeat('8', 64), 'etag-2');
select throws_ok(
  $$ select public.seal_source_deletion_inventory(pg_temp.del(), (select sha from e5_read)) $$,
  'SOURCE_DELETION_INVENTORY_DIGESTS_CHANGED',
  'a row rewritten after the worker read the set refuses the seal'
);
update e5_read set sha = pg_temp.set_sha();
select public.record_source_deletion_inventory_digest(pg_temp.del(), pg_temp.part(601), 1, 'sha256:' || repeat('7', 64), 'etag-1');
select throws_ok(
  $$ select public.seal_source_deletion_inventory(pg_temp.del(), (select sha from e5_read)) $$,
  'SOURCE_DELETION_INVENTORY_DIGESTS_CHANGED',
  'a row added after the worker read the set refuses the seal'
);
-- The same key rewritten at the same size: only its ETag changed, and that alone refuses the seal.
update e5_read set sha = pg_temp.set_sha();
select public.record_source_deletion_inventory_digest(pg_temp.del(), pg_temp.part(601), 1, 'sha256:' || repeat('7', 64), 'etag-2');
select throws_ok(
  $$ select public.seal_source_deletion_inventory(pg_temp.del(), (select sha from e5_read)) $$,
  'SOURCE_DELETION_INVENTORY_DIGESTS_CHANGED',
  'a row whose ETag changed at the same size and digest after the worker read the set refuses the seal'
);
select is(
  (select count(*)::integer from public.source_deletion_inventory_attestations where deletion_id = pg_temp.del()),
  0,
  'no refused seal left an attestation behind'
);

-- The worker discards every digest once its listing disagrees with them.
select is(public.discard_source_deletion_inventory_digests(pg_temp.del()), 601,
  'a changed listing discards every digest of the deletion');

-- ---------------------------------------------------------------------------
-- The bounds: 16,384 objects and 64 GiB per deletion.
-- ---------------------------------------------------------------------------

insert into public.source_deletion_inventory_digests (deletion_id, object_key, size_bytes, object_sha256, etag)
select pg_temp.del(), pg_temp.part(n), 1, 'sha256:' || repeat('7', 64), 'etag-1' from generate_series(1, 16384) as n;
select throws_ok(
  $$ select public.record_source_deletion_inventory_digest(pg_temp.del(), pg_temp.part(20000), 1, 'sha256:' || repeat('7', 64), 'etag-1') $$,
  'SOURCE_DELETION_INVENTORY_OBJECT_LIMIT',
  'the 16,385th object of one deletion is refused'
);
select lives_ok(
  $$ select public.record_source_deletion_inventory_digest(pg_temp.del(), pg_temp.part(1), 1, 'sha256:' || repeat('9', 64), 'etag-1') $$,
  'at the bound, an object already in the set may still be hashed again'
);
select public.discard_source_deletion_inventory_digests(pg_temp.del());

insert into public.source_deletion_inventory_digests (deletion_id, object_key, size_bytes, object_sha256, etag)
select pg_temp.del(), pg_temp.part(n), 67108864, 'sha256:' || repeat('7', 64), 'etag-1' from generate_series(1, 1024) as n;
select throws_ok(
  $$ select public.record_source_deletion_inventory_digest(pg_temp.del(), pg_temp.part(2000), 1, 'sha256:' || repeat('7', 64), 'etag-1') $$,
  'SOURCE_DELETION_INVENTORY_TOTAL_TOO_LARGE',
  'one byte past 64 GiB in one deletion is refused'
);
select throws_ok(
  $$ select public.record_source_deletion_inventory_digest(pg_temp.del(), pg_temp.part(1), 67108865, 'sha256:' || repeat('7', 64), 'etag-1') $$,
  'SOURCE_DELETION_INVENTORY_OBJECT_INVALID',
  'an object past 64 MiB is refused, as the attestation refuses it'
);
select throws_ok(
  $$ select public.record_source_deletion_inventory_digest(pg_temp.del(), pg_temp.part(1), 1, 'sha256:' || repeat('7', 64), '"quoted"') $$,
  'SOURCE_DELETION_INVENTORY_OBJECT_INVALID',
  'an ETag outside its pattern (the worker strips the quotes R2 lists it with) is refused'
);
select public.discard_source_deletion_inventory_digests(pg_temp.del());

-- ---------------------------------------------------------------------------
-- The seal: 600 objects from two runs, then an idempotent replay.
-- ---------------------------------------------------------------------------

select public.record_source_deletion_inventory_digest(pg_temp.del(), pg_temp.part(n), 1, 'sha256:' || repeat('7', 64), 'etag-1')
  from generate_series(1, 600) as n;
update e5_read set sha = pg_temp.set_sha();

select is(
  public.seal_source_deletion_inventory(pg_temp.del(), (select sha from e5_read)) - 'manifestSha256',
  jsonb_build_object('status', 'recorded', 'artifactCount', 600),
  '600 objects are attested in one seal'
);
select is(
  (select count(*)::integer from public.source_deletion_objects
    where deletion_id = pg_temp.del() and object_key like '%/segments/part-%'),
  600,
  'every sealed object is enqueued for purge'
);
select is(
  (select artifact_count from public.source_deletion_inventory_attestations where deletion_id = pg_temp.del()),
  600,
  'the attestation row records the full count'
);
select is(
  public.seal_source_deletion_inventory(pg_temp.del(), (select sha from e5_read)),
  (select jsonb_build_object('status', 'replayed', 'manifestSha256', inventory_manifest_sha256, 'artifactCount', 600)
     from public.source_deletion_inventory_attestations where deletion_id = pg_temp.del()),
  'sealing the same set again replays the same manifest'
);

-- ---------------------------------------------------------------------------
-- Service-only.
-- ---------------------------------------------------------------------------

select table_privs_are('public', 'source_deletion_inventory_digests', 'service_role', array[]::text[]);
select ok(
  not has_function_privilege('authenticated', 'public.seal_source_deletion_inventory(text,text,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.record_source_deletion_inventory_digest(text,text,bigint,text,text)', 'execute')
  and has_function_privilege('service_role', 'public.seal_source_deletion_inventory(text,text,jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.read_source_deletion_inventory_digests(text)', 'execute'),
  'the digest functions are service-only'
);

select * from finish();
rollback;
