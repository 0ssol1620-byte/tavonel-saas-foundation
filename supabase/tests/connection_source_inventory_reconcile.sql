-- Connection source inventory scans (20261002100000): begin / page / finalize, replay, epochs,
-- compare-and-set, absence as a tombstone candidate only, ACL as observation only, and tenant
-- isolation that is proven to reach the connection check rather than failing earlier.
--
-- The MIME_VECTORS and ITEM_VECTORS blocks are read verbatim by
-- nextjs/lib/connection-source-inventory.test.ts, which runs the same vectors through the
-- TypeScript validator. Keep each block a single jsonb literal.
begin;
select plan(85);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'inventory-a@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-4000-8000-0000000000b1', 'authenticated', 'authenticated', 'inventory-b@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.foundation_api_keys (key_id, workspace_key, name, key_prefix, token_sha256, scopes, created_by) values
  ('a0000000-0000-4000-8000-00000000a0e1', 'pilot-invA', 'inventory A', 'invkeyA00001', repeat('1', 64), array['connections:sync'], 'a0000000-0000-4000-8000-0000000000a1'),
  ('a0000000-0000-4000-8000-00000000a0e2', 'pilot-invA', 'inventory A read', 'invkeyA00002', repeat('2', 64), array['documents:read'], 'a0000000-0000-4000-8000-0000000000a1'),
  ('b0000000-0000-4000-8000-00000000b0e1', 'pilot-invB', 'inventory B', 'invkeyB00001', repeat('3', 64), array['connections:sync'], 'b0000000-0000-4000-8000-0000000000b1');

insert into public.foundation_connections (connection_id, workspace_key, provider, mode, display_name, status, created_by, updated_by) values
  ('a0000000-0000-4000-8000-0000000000c1', 'pilot-invA', 'file_server', 'local_agent', 'Inventory A', 'active', 'a0000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-0000000000a1'),
  ('a0000000-0000-4000-8000-0000000000c2', 'pilot-invA', 'file_server', 'local_agent', 'Inventory A paused', 'paused', 'a0000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-0000000000a1'),
  ('b0000000-0000-4000-8000-0000000000c1', 'pilot-invB', 'file_server', 'local_agent', 'Inventory B', 'active', 'b0000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-0000000000b1');

-- Workspace A, connection A, key A: the path every behavioural assertion below drives.
create function pg_temp.ib(p_scan uuid, p_epoch bigint, p_expected bigint, p_items integer, p_pages integer) returns jsonb language sql as $f$
  select public.begin_connection_inventory_scan(p_scan, 'pilot-invA', 'a0000000-0000-4000-8000-0000000000c1', null, 'a0000000-0000-4000-8000-00000000a0e1', p_epoch, p_expected, p_items, p_pages)
$f$;
create function pg_temp.ip(p_scan uuid, p_index integer, p_items jsonb) returns jsonb language sql as $f$
  select public.stage_connection_inventory_page(p_scan, 'pilot-invA', 'a0000000-0000-4000-8000-0000000000c1', null, 'a0000000-0000-4000-8000-00000000a0e1', p_index, p_items)
$f$;
create function pg_temp.ifin(p_scan uuid, p_complete boolean, p_items integer, p_pages integer) returns jsonb language sql as $f$
  select public.finalize_connection_inventory_scan(p_scan, 'pilot-invA', 'a0000000-0000-4000-8000-0000000000c1', null, 'a0000000-0000-4000-8000-00000000a0e1', p_complete, p_items, p_pages)
$f$;
create function pg_temp.item(p_native text, p_revision text default 'r1', p_acl text default null) returns jsonb language sql as $f$
  select jsonb_build_object('nativeId', p_native, 'revision', p_revision, 'contentSha256', repeat('c', 64),
    'sizeBytes', 10, 'mimeType', 'application/pdf', 'aclObservationSha256', p_acl)
$f$;
create function pg_temp.item_states() returns text language sql as $f$
  select string_agg(native_id || ':' || state || ':' || revision || ':' || state_epoch, ',' order by native_id)
    from public.foundation_connection_inventory_items where connection_id = 'a0000000-0000-4000-8000-0000000000c1'
$f$;
-- Rows a purge, a tombstone or an access grant would have written. Absence and ACL observations
-- must leave every one of them untouched.
create temp table inv_baseline as
  select (select count(*) from public.source_deletion_tombstones) as tombstones,
         (select count(*) from public.connector_document_bindings) as bindings,
         (select count(*) from public.source_acl_snapshots) as acl_snapshots,
         (select count(*) from public.foundation_account_access_grants) as access_grants;

-- ---------------------------------------------------------------------------
-- 1. Privileges and RLS
-- ---------------------------------------------------------------------------
select is_empty($$
  select c.relname::text || ':' || r.role || ':' || p.privilege
    from pg_class c
   cross join (values ('anon'), ('authenticated'), ('service_role')) r(role)
   cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(privilege)
   where c.oid in ('public.foundation_connection_inventory_heads'::regclass, 'public.foundation_connection_inventory_scans'::regclass,
                   'public.foundation_connection_inventory_pages'::regclass, 'public.foundation_connection_inventory_items'::regclass)
     and has_table_privilege(r.role, c.oid, p.privilege)
$$, 'no client role and not service_role holds a table privilege on the inventory tables');
select ok((select count(*) = 4 and bool_and(relrowsecurity) from pg_class
  where oid in ('public.foundation_connection_inventory_heads'::regclass, 'public.foundation_connection_inventory_scans'::regclass,
                'public.foundation_connection_inventory_pages'::regclass, 'public.foundation_connection_inventory_items'::regclass)),
  'row level security is enabled on every inventory table');
select is((select count(*)::integer from pg_policy pol
  where pol.polrelid in ('public.foundation_connection_inventory_heads'::regclass, 'public.foundation_connection_inventory_scans'::regclass,
                         'public.foundation_connection_inventory_pages'::regclass, 'public.foundation_connection_inventory_items'::regclass)
    and not pol.polpermissive and pol.polroles @> array['anon'::regrole::oid, 'authenticated'::regrole::oid]),
  4, 'each inventory table carries a restrictive deny policy for anon and authenticated');
select ok(
  has_function_privilege('service_role', 'public.begin_connection_inventory_scan(uuid,text,uuid,uuid,uuid,bigint,bigint,integer,integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.stage_connection_inventory_page(uuid,text,uuid,uuid,uuid,integer,jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.finalize_connection_inventory_scan(uuid,text,uuid,uuid,uuid,boolean,integer,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.begin_connection_inventory_scan(uuid,text,uuid,uuid,uuid,bigint,bigint,integer,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.begin_connection_inventory_scan(uuid,text,uuid,uuid,uuid,bigint,bigint,integer,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.stage_connection_inventory_page(uuid,text,uuid,uuid,uuid,integer,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.stage_connection_inventory_page(uuid,text,uuid,uuid,uuid,integer,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.finalize_connection_inventory_scan(uuid,text,uuid,uuid,uuid,boolean,integer,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.finalize_connection_inventory_scan(uuid,text,uuid,uuid,uuid,boolean,integer,integer)', 'EXECUTE'),
  'only service_role may execute the three inventory RPCs');
select ok(
  not has_function_privilege('service_role', 'public.connection_inventory_bind(text,uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.connection_inventory_item_valid(jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.connection_inventory_mime_valid(text)', 'EXECUTE'),
  'internal helpers are not callable by any API role');

-- ---------------------------------------------------------------------------
-- 2. Validation parity with TypeScript (same vectors, read by the unit test)
-- ---------------------------------------------------------------------------
-- MIME_VECTORS_BEGIN
select is_empty($$
  select v->>0 from jsonb_array_elements('[["text/plain",true],["TEXT/PLAIN",true],["application/pdf",true],["application/vnd.openxmlformats-officedocument.wordprocessingml.document",true],["image/svg+xml",true],["application/x-7z-compressed",true],["x/yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy",true],["x/yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy",false],["",false],["text",false],["/plain",false],["text/",false],["a/b/c",false],["text/plain\n",false],["\ntext/plain",false],["text/plain ",false],["text/plain; charset=utf-8",false],["text/pla in",false],["text/plain_x",false],["tеxt/plain",false],["K/x",false],["text/pläin",false]]'::jsonb) v
   where public.connection_inventory_mime_valid(v->>0) is distinct from (v->>1)::boolean
$$, 'the SQL MIME rule agrees with every shared vector');
-- MIME_VECTORS_END
-- ITEM_VECTORS_BEGIN
select is_empty($$
  select v->>'why' from jsonb_array_elements('[{"why":"minimal","ok":true,"item":{"nativeId":"a","revision":"r","contentSha256":null,"sizeBytes":0,"mimeType":null,"aclObservationSha256":null}},{"why":"full","ok":true,"item":{"nativeId":"dir/a.pdf","revision":"etag:1","contentSha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","sizeBytes":1099511627776,"mimeType":"application/pdf","aclObservationSha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}},{"why":"C1 control is allowed","ok":true,"item":{"nativeId":"a\u0085b","revision":"r","contentSha256":null,"sizeBytes":1,"mimeType":null,"aclObservationSha256":null}},{"why":"1024 bytes","ok":true,"item":{"nativeId":"éééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééé","revision":"r","contentSha256":null,"sizeBytes":1,"mimeType":null,"aclObservationSha256":null}},{"why":"1026 bytes","ok":false,"item":{"nativeId":"ééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééé","revision":"r","contentSha256":null,"sizeBytes":1,"mimeType":null,"aclObservationSha256":null}},{"why":"empty id","ok":false,"item":{"nativeId":"","revision":"r","contentSha256":null,"sizeBytes":1,"mimeType":null,"aclObservationSha256":null}},{"why":"unit separator","ok":false,"item":{"nativeId":"a\u001fb","revision":"r","contentSha256":null,"sizeBytes":1,"mimeType":null,"aclObservationSha256":null}},{"why":"DEL in revision","ok":false,"item":{"nativeId":"a","revision":"r\u007f","contentSha256":null,"sizeBytes":1,"mimeType":null,"aclObservationSha256":null}},{"why":"fractional size","ok":false,"item":{"nativeId":"a","revision":"r","contentSha256":null,"sizeBytes":1.5,"mimeType":null,"aclObservationSha256":null}},{"why":"negative size","ok":false,"item":{"nativeId":"a","revision":"r","contentSha256":null,"sizeBytes":-1,"mimeType":null,"aclObservationSha256":null}},{"why":"size over bound","ok":false,"item":{"nativeId":"a","revision":"r","contentSha256":null,"sizeBytes":1099511627777,"mimeType":null,"aclObservationSha256":null}},{"why":"size as string","ok":false,"item":{"nativeId":"a","revision":"r","contentSha256":null,"sizeBytes":"1","mimeType":null,"aclObservationSha256":null}},{"why":"upper-case digest","ok":false,"item":{"nativeId":"a","revision":"r","contentSha256":"CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC","sizeBytes":1,"mimeType":null,"aclObservationSha256":null}},{"why":"bad mime","ok":false,"item":{"nativeId":"a","revision":"r","contentSha256":null,"sizeBytes":1,"mimeType":"text/plain\n","aclObservationSha256":null}},{"why":"extra key","ok":false,"item":{"nativeId":"a","revision":"r","contentSha256":null,"sizeBytes":1,"mimeType":null,"aclObservationSha256":null,"grant":"read"}},{"why":"missing key","ok":false,"item":{"nativeId":"a","revision":"r","contentSha256":null,"sizeBytes":1,"mimeType":null}}]'::jsonb) v
   where public.connection_inventory_item_valid(v->'item') is distinct from (v->>'ok')::boolean
$$, 'the SQL item rule agrees with every shared vector');
-- ITEM_VECTORS_END

-- ---------------------------------------------------------------------------
-- 3. begin / page / finalize, replay at each step
-- ---------------------------------------------------------------------------
select throws_ok($$ select pg_temp.ib('a0000000-0000-4000-8000-0000000d0001', 10, 10, 3, 2) $$,
  'INVENTORY_CONTRACT_INVALID', 'expected head epoch must be below the scan epoch');
select throws_ok($$ select pg_temp.ib('a0000000-0000-4000-8000-0000000d0001', 10, 0, 0, 2) $$,
  'INVENTORY_CONTRACT_INVALID', 'an empty scan is exactly one page');
select is(pg_temp.ib('a0000000-0000-4000-8000-0000000d0001', 10, 0, 3, 2)->>'status', 'begun', 'begin opens a scan');
select is(pg_temp.ib('a0000000-0000-4000-8000-0000000d0001', 10, 0, 3, 2)->>'status', 'replayed', 'an identical begin is a replay');
select throws_ok($$ select pg_temp.ib('a0000000-0000-4000-8000-0000000d0001', 10, 0, 4, 2) $$,
  'INVENTORY_SCAN_CONFLICT', 'a begin reusing the scan id with other counts is refused');
select is(pg_temp.ip('a0000000-0000-4000-8000-0000000d0001', 0, jsonb_build_array(pg_temp.item('a'), pg_temp.item('b')))->>'status',
  'staged', 'page 0 is staged');
select is(pg_temp.ip('a0000000-0000-4000-8000-0000000d0001', 0, jsonb_build_array(pg_temp.item('a'), pg_temp.item('b')))->>'status',
  'replayed', 'an identical page is an idempotent replay');
select throws_ok($$ select pg_temp.ip('a0000000-0000-4000-8000-0000000d0001', 0, jsonb_build_array(pg_temp.item('a'), pg_temp.item('z'))) $$,
  'INVENTORY_PAGE_CONFLICT', 'different items for a staged page index are refused');
select is((select count(*)::integer from public.foundation_connection_inventory_pages where scan_id = 'a0000000-0000-4000-8000-0000000d0001'),
  1, 'replay and conflict left exactly one staged page');
select throws_ok($$ select pg_temp.ip('a0000000-0000-4000-8000-0000000d0001', 2, jsonb_build_array(pg_temp.item('c'))) $$,
  'INVENTORY_PAGE_INDEX_INVALID', 'a page index beyond the declared page count is refused');
select throws_ok($$ select pg_temp.ip('a0000000-0000-4000-8000-0000000d0001', 1, jsonb_build_array(pg_temp.item('c') || '{"mimeType":"text/plain\n"}'::jsonb)) $$,
  'INVENTORY_ITEM_INVALID', 'an item failing the shared MIME rule is refused');
select throws_ok($$ select pg_temp.ip('a0000000-0000-4000-8000-0000000d0001', 1, jsonb_build_array(pg_temp.item('c'), pg_temp.item('d'))) $$,
  'INVENTORY_COUNT_MISMATCH', 'pages may not exceed the declared item count');
select throws_ok($$ select pg_temp.ifin('a0000000-0000-4000-8000-0000000d0001', true, 3, 2) $$,
  'INVENTORY_PAGES_INCOMPLETE', 'finalize refuses while a declared page is missing');
select is(pg_temp.ip('a0000000-0000-4000-8000-0000000d0001', 1, jsonb_build_array(pg_temp.item('c', 'r1', repeat('e', 64))))->>'status',
  'staged', 'page 1 is staged with an ACL observation');
select throws_ok($$ select pg_temp.ifin('a0000000-0000-4000-8000-0000000d0001', false, 3, 2) $$,
  'INVENTORY_NOT_ATTESTED_COMPLETE', 'an incomplete scan never finalizes, so it can never mark absence');
select throws_ok($$ select pg_temp.ifin('a0000000-0000-4000-8000-0000000d0001', true, 2, 2) $$,
  'INVENTORY_COUNT_MISMATCH', 'finalize must restate the declared counts');
select ok(pg_temp.ifin('a0000000-0000-4000-8000-0000000d0001', true, 3, 2)
  @> '{"status":"finalized","receipt":{"present":3,"newlyUnobserved":0,"scanEpoch":10}}', 'finalize reconciles the scan');
select ok((select pg_temp.ifin('a0000000-0000-4000-8000-0000000d0001', true, 3, 2) = jsonb_build_object('status', 'replayed', 'receipt', s.receipt)
  from public.foundation_connection_inventory_scans s where s.scan_id = 'a0000000-0000-4000-8000-0000000d0001'),
  'an exact finalize replay returns the stored receipt');
select throws_ok($$ select pg_temp.ifin('a0000000-0000-4000-8000-0000000d0001', true, 3, 3) $$,
  'INVENTORY_FINALIZE_CONFLICT', 'a finalize replay that disagrees is refused');
select is((select head_epoch::integer from public.foundation_connection_inventory_heads where connection_id = 'a0000000-0000-4000-8000-0000000000c1'),
  10, 'the head advanced to the finalized epoch');
select is(pg_temp.item_states(), 'a:present:r1:10,b:present:r1:10,c:present:r1:10', 'every scanned item is present');
select is((select count(*)::integer from public.foundation_connection_inventory_pages where scan_id = 'a0000000-0000-4000-8000-0000000d0001'),
  0, 'staged pages are released at finalize');
select throws_ok($$ select pg_temp.ip('a0000000-0000-4000-8000-0000000d0001', 0, jsonb_build_array(pg_temp.item('a'), pg_temp.item('b'))) $$,
  'INVENTORY_SCAN_NOT_OPEN', 'a page delivered after finalize is refused without effect');
select throws_ok($$ select pg_temp.ib('a0000000-0000-4000-8000-0000000d0001', 10, 0, 3, 2) $$,
  'INVENTORY_SCAN_NOT_OPEN', 'a begin replay of a finalized scan does not reopen it');

-- ---------------------------------------------------------------------------
-- 4. ACL observation is an observation, not a grant
-- ---------------------------------------------------------------------------
select is((select acl_observation_sha256 from public.foundation_connection_inventory_items
  where connection_id = 'a0000000-0000-4000-8000-0000000000c1' and native_id = 'c'), repeat('e', 64), 'the ACL observation digest is recorded on the item');

-- ---------------------------------------------------------------------------
-- 5. Origin-missing is a tombstone candidate, not a purge
-- ---------------------------------------------------------------------------
select is(pg_temp.ib('a0000000-0000-4000-8000-0000000d0002', 11, 10, 1, 1)->>'status', 'begun', 'second scan begins on the current head');
select is(pg_temp.ip('a0000000-0000-4000-8000-0000000d0002', 0, jsonb_build_array(pg_temp.item('a', 'r2')))->>'status', 'staged', 'second scan sees only a');
select ok(pg_temp.ifin('a0000000-0000-4000-8000-0000000d0002', true, 1, 1) @> '{"receipt":{"present":1,"newlyUnobserved":2}}',
  'two items are newly unobserved');
select is(pg_temp.item_states(), 'a:present:r2:10,b:unobserved:r1:11,c:unobserved:r1:11',
  'unobserved rows keep their last observation; a keeps its presence epoch across a content change');
select is((select acl_observation_sha256 from public.foundation_connection_inventory_items
  where connection_id = 'a0000000-0000-4000-8000-0000000000c1' and native_id = 'c'), repeat('e', 64), 'absence does not erase the last ACL observation');
select is(pg_temp.ib('a0000000-0000-4000-8000-0000000d0003', 12, 11, 3, 1)->>'status', 'begun', 'third scan begins');
select is(pg_temp.ip('a0000000-0000-4000-8000-0000000d0003', 0, jsonb_build_array(pg_temp.item('a', 'r2'), pg_temp.item('b'), pg_temp.item('c')))->>'status',
  'staged', 'third scan sees everything again');
select ok(pg_temp.ifin('a0000000-0000-4000-8000-0000000d0003', true, 3, 1) @> '{"receipt":{"present":3,"newlyUnobserved":0}}', 'third scan finalizes');
select is(pg_temp.item_states(), 'a:present:r2:10,b:present:r1:12,c:present:r1:12', 'reappearing items return to present at the new epoch');
select is(pg_temp.ifin('a0000000-0000-4000-8000-0000000d0003', true, 3, 1)->'receipt'->>'aclObservation', 'recorded_not_an_access_grant',
  'the receipt states that ACL observations grant nothing');

-- ---------------------------------------------------------------------------
-- 6. Scan epochs: an older scan cannot overwrite a newer one
-- ---------------------------------------------------------------------------
select is(pg_temp.ib('a0000000-0000-4000-8000-0000000d0004', 20, 12, 0, 1)->>'status', 'begun', 'scan at epoch 20 opens');
select throws_ok($$ select pg_temp.ib('a0000000-0000-4000-8000-0000000d0005', 19, 12, 0, 1) $$,
  'INVENTORY_EPOCH_STALE', 'an older epoch cannot begin while a newer scan is open');
select throws_ok($$ select pg_temp.ib('a0000000-0000-4000-8000-0000000d0005', 20, 12, 0, 1) $$,
  'INVENTORY_EPOCH_STALE', 'an equal epoch cannot begin either');
select is(pg_temp.ip('a0000000-0000-4000-8000-0000000d0004', 0, '[]'::jsonb)->>'status', 'staged', 'epoch 20 stages its empty page');
select is(pg_temp.ib('a0000000-0000-4000-8000-0000000d0006', 21, 12, 0, 1)->>'status', 'begun', 'a newer epoch begins');
select is((select state || ':' || (select count(*) from public.foundation_connection_inventory_pages p where p.scan_id = s.scan_id)
  from public.foundation_connection_inventory_scans s where s.scan_id = 'a0000000-0000-4000-8000-0000000d0004'),
  'superseded:0', 'the newer epoch superseded the older scan and released its pages');
select throws_ok($$ select pg_temp.ip('a0000000-0000-4000-8000-0000000d0004', 0, '[]'::jsonb) $$,
  'INVENTORY_SCAN_NOT_OPEN', 'the superseded scan cannot stage');
select throws_ok($$ select pg_temp.ifin('a0000000-0000-4000-8000-0000000d0004', true, 0, 1) $$,
  'INVENTORY_SCAN_NOT_OPEN', 'the superseded scan cannot finalize over the newer one');
select is(pg_temp.ip('a0000000-0000-4000-8000-0000000d0006', 0, '[]'::jsonb)->>'status', 'staged', 'epoch 21 stages its empty page');
select ok(pg_temp.ifin('a0000000-0000-4000-8000-0000000d0006', true, 0, 1) @> '{"receipt":{"present":0,"newlyUnobserved":3}}',
  'an empty complete scan marks everything unobserved');
select is(pg_temp.item_states(), 'a:unobserved:r2:21,b:unobserved:r1:21,c:unobserved:r1:21', 'and deletes nothing');

-- ---------------------------------------------------------------------------
-- 7. Compare-and-set on the head
-- ---------------------------------------------------------------------------
select throws_ok($$ select pg_temp.ib('a0000000-0000-4000-8000-0000000d0007', 30, 12, 0, 1) $$,
  'INVENTORY_HEAD_STALE', 'a begin naming a stale head epoch is refused');
select is(pg_temp.ib('a0000000-0000-4000-8000-0000000d0008', 30, 21, 0, 1)->>'status', 'begun', 'a begin naming the current head opens');
select is(pg_temp.ip('a0000000-0000-4000-8000-0000000d0008', 0, '[]'::jsonb)->>'status', 'staged', 'its page is staged');
-- Fault injection: a writer outside these RPCs moves the head between begin and finalize.
update public.foundation_connection_inventory_heads set head_epoch = 25 where connection_id = 'a0000000-0000-4000-8000-0000000000c1';
select throws_ok($$ select pg_temp.ifin('a0000000-0000-4000-8000-0000000d0008', true, 0, 1) $$,
  'INVENTORY_HEAD_STALE', 'finalize re-checks the head and refuses a moved one');
select is(pg_temp.item_states(), 'a:unobserved:r2:21,b:unobserved:r1:21,c:unobserved:r1:21', 'the refused finalize changed no item');

-- ---------------------------------------------------------------------------
-- 7b. Running totals, the per-scan byte cap and expiry of an abandoned scan
-- ---------------------------------------------------------------------------
select is(pg_temp.ib('a0000000-0000-4000-8000-0000000d0010', 40, 25, 2, 2)->>'status', 'begun', 'scan at epoch 40 opens');
select is(pg_temp.ip('a0000000-0000-4000-8000-0000000d0010', 0, jsonb_build_array(pg_temp.item('x')))->>'status', 'staged', 'its first page is staged');
select is((select staged_item_count || ':' || (staged_bytes = octet_length(jsonb_build_array(pg_temp.item('x'))::text))
  from public.foundation_connection_inventory_scans where scan_id = 'a0000000-0000-4000-8000-0000000d0010'),
  '1:true', 'staging keeps per-scan running item and byte totals');
-- Fault injection: the scan is one byte short of its 64 MiB staging cap.
update public.foundation_connection_inventory_scans set staged_bytes = 67108863 where scan_id = 'a0000000-0000-4000-8000-0000000d0010';
select throws_ok($$ select pg_temp.ip('a0000000-0000-4000-8000-0000000d0010', 1, jsonb_build_array(pg_temp.item('y'))) $$,
  'INVENTORY_LIMIT_EXCEEDED', 'a page past the per-scan byte cap is refused');
select is((select staged_item_count || ':' || (select count(*) from public.foundation_connection_inventory_pages p where p.scan_id = s.scan_id)
  from public.foundation_connection_inventory_scans s where s.scan_id = 'a0000000-0000-4000-8000-0000000d0010'),
  '1:1', 'the refused page wrote nothing');
-- Fault injection: the scan was begun seven hours ago and abandoned.
update public.foundation_connection_inventory_scans
   set begun_at = begun_at - interval '7 hours', expires_at = expires_at - interval '7 hours'
 where scan_id = 'a0000000-0000-4000-8000-0000000d0010';
select throws_ok($$ select pg_temp.ip('a0000000-0000-4000-8000-0000000d0010', 1, jsonb_build_array(pg_temp.item('y'))) $$,
  'INVENTORY_SCAN_EXPIRED', 'an expired scan accepts no page');
select throws_ok($$ select pg_temp.ifin('a0000000-0000-4000-8000-0000000d0010', true, 2, 2) $$,
  'INVENTORY_SCAN_EXPIRED', 'an expired scan cannot finalize');
select throws_ok($$ select pg_temp.ib('a0000000-0000-4000-8000-0000000d0010', 40, 25, 2, 2) $$,
  'INVENTORY_SCAN_EXPIRED', 'a begin replay does not revive an expired scan');
select is(pg_temp.ib('a0000000-0000-4000-8000-0000000d0011', 35, 25, 0, 1)->>'status', 'begun',
  'an abandoned scan does not block a new one, even at a lower epoch');
select is((select state || ':' || (select count(*) from public.foundation_connection_inventory_pages p where p.scan_id = s.scan_id)
  from public.foundation_connection_inventory_scans s where s.scan_id = 'a0000000-0000-4000-8000-0000000d0010'),
  'expired:0', 'the abandoned scan is closed as expired and its pages released');

-- ---------------------------------------------------------------------------
-- 8. Actor and tenant isolation, each reaching the check it names
-- ---------------------------------------------------------------------------
select is((public.begin_connection_inventory_scan('b0000000-0000-4000-8000-0000000d0001', 'pilot-invB', 'b0000000-0000-4000-8000-0000000000c1',
  null, 'b0000000-0000-4000-8000-00000000b0e1', 1, 0, 1, 1))->>'status', 'begun',
  'control: key B is a valid actor on its own connection');
select throws_ok($$ select public.begin_connection_inventory_scan('b0000000-0000-4000-8000-0000000d0002', 'pilot-invB', 'a0000000-0000-4000-8000-0000000000c1',
  null, 'b0000000-0000-4000-8000-00000000b0e1', 1, 0, 1, 1) $$,
  'CONNECTION_NOT_SYNCABLE', 'valid actor B cannot begin a scan on workspace A''s connection');
select throws_ok($$ select public.begin_connection_inventory_scan('a0000000-0000-4000-8000-0000000d0009', 'pilot-invA', 'b0000000-0000-4000-8000-0000000000c1',
  null, 'a0000000-0000-4000-8000-00000000a0e1', 40, 25, 0, 1) $$,
  'CONNECTION_NOT_SYNCABLE', 'valid actor A cannot begin a scan on workspace B''s connection');
select throws_ok($$ select public.begin_connection_inventory_scan('a0000000-0000-4000-8000-0000000d0009', 'pilot-invB', 'b0000000-0000-4000-8000-0000000000c1',
  null, 'a0000000-0000-4000-8000-00000000a0e1', 2, 1, 0, 1) $$,
  'INVENTORY_ACTOR_INVALID', 'key A cannot claim workspace B');
select throws_ok($$ select pg_temp.ip('b0000000-0000-4000-8000-0000000d0001', 0, jsonb_build_array(pg_temp.item('x'))) $$,
  'INVENTORY_SCAN_NOT_FOUND', 'valid actor A on its own connection cannot stage into workspace B''s scan');
select throws_ok($$ select pg_temp.ifin('b0000000-0000-4000-8000-0000000d0001', true, 1, 1) $$,
  'INVENTORY_SCAN_NOT_FOUND', 'nor finalize it');
select is((select state || ':' || (select count(*) from public.foundation_connection_inventory_pages p where p.scan_id = s.scan_id)
  from public.foundation_connection_inventory_scans s where s.scan_id = 'b0000000-0000-4000-8000-0000000d0001'),
  'open:0', 'workspace B''s scan is untouched');
select throws_ok($$ select public.begin_connection_inventory_scan('a0000000-0000-4000-8000-0000000d0009', 'pilot-invA', 'a0000000-0000-4000-8000-0000000000c1',
  null, 'a0000000-0000-4000-8000-00000000a0e2', 40, 25, 0, 1) $$,
  'INVENTORY_ACTOR_INVALID', 'a key without connections:sync is not an actor');
select throws_ok($$ select public.begin_connection_inventory_scan('a0000000-0000-4000-8000-0000000d0009', 'pilot-invA', 'a0000000-0000-4000-8000-0000000000c1',
  'a0000000-0000-4000-8000-0000000000a1', null, 40, 25, 0, 1) $$,
  'INVENTORY_ACTOR_INVALID', 'a user without an active membership in the workspace is not an actor');
select throws_ok($$ select public.begin_connection_inventory_scan('a0000000-0000-4000-8000-0000000d0009', 'pilot-invA', 'a0000000-0000-4000-8000-0000000000c2',
  null, 'a0000000-0000-4000-8000-00000000a0e1', 1, 0, 0, 1) $$,
  'CONNECTION_NOT_SYNCABLE', 'a paused connection is not syncable');

-- ---------------------------------------------------------------------------
-- 9. Through the API roles, and nothing written anywhere it should not be
-- ---------------------------------------------------------------------------
set local role service_role;
select is((public.begin_connection_inventory_scan('b0000000-0000-4000-8000-0000000d0003', 'pilot-invB', 'b0000000-0000-4000-8000-0000000000c1',
  null, 'b0000000-0000-4000-8000-00000000b0e1', 2, 0, 1, 1))->>'status', 'begun', 'service_role reaches the RPC');
reset role;
set local role authenticated;
select throws_ok($$ select public.begin_connection_inventory_scan('b0000000-0000-4000-8000-0000000d0004', 'pilot-invB', 'b0000000-0000-4000-8000-0000000000c1',
  null, 'b0000000-0000-4000-8000-00000000b0e1', 3, 0, 1, 1) $$,
  '42501', null, 'a browser session cannot call the RPC');
reset role;
select is((select state from public.foundation_connection_inventory_scans where scan_id = 'b0000000-0000-4000-8000-0000000d0001'),
  'superseded', 'the newer epoch on connection B superseded its earlier scan');
select ok((select tombstones = (select count(*) from public.source_deletion_tombstones)
             and bindings = (select count(*) from public.connector_document_bindings)
             and acl_snapshots = (select count(*) from public.source_acl_snapshots)
             and access_grants = (select count(*) from public.foundation_account_access_grants)
           from inv_baseline),
  'no tombstone, binding, ACL snapshot or access grant was written by any scan');

-- ---------------------------------------------------------------------------
-- 10. The founder-reset write fence covers begin and stage (last: it seals workspace A)
-- ---------------------------------------------------------------------------
insert into public.founder_test_reset_ledger (target_email, user_id, workspace_key, state, db_manifest_digest, manifest_digest, db_counts, r2_keys, sealed_at)
values ('0ssol1620@gmail.com', 'a0000000-0000-4000-8000-0000000000a1', 'pilot-invA', 'sealed', 'sha256:' || repeat('a', 64), 'sha256:' || repeat('b', 64), '{}', '[]', now());
select throws_ok($$ select pg_temp.ip('a0000000-0000-4000-8000-0000000d0011', 0, '[]'::jsonb) $$,
  'founder_test_reset_write_fenced', 'a sealed workspace accepts no staged page');
select is((select count(*)::integer from public.foundation_connection_inventory_pages where scan_id = 'a0000000-0000-4000-8000-0000000d0011'),
  0, 'the fenced stage wrote no page');
select throws_ok($$ select pg_temp.ib('a0000000-0000-4000-8000-0000000d0012', 50, 25, 0, 1) $$,
  'founder_test_reset_write_fenced', 'a sealed workspace accepts no new scan');

select * from finish();
rollback;
