-- Founder test reset vs. the connection source inventory (migration 20261002120000):
--   - the inventory rows of the reset workspace (an open scan with a staged page, a finalized scan,
--     its head and items) are counted and fingerprinted at prepare, so a page staged after prepare is
--     database drift; finalize deletes all four tables ahead of foundation_connections, whose
--     on-delete-restrict foreign keys used to make finalize fail;
--   - the write fence still refuses begin and stage for the sealed workspace, and a delete outside
--     finalize; another workspace keeps scanning and its inventory is untouched by finalize;
--   - nothing from the inventory enters the evidence archive (mutable per-connection sync state,
--     like foundation_connection_batches).
--
-- Everything runs inside this rolled-back transaction on the disposable rehearsal database. Each
-- auth.users insert bootstraps a legacy workspace and a foundation workspace (0001, 20260920121000):
--   pilot-f0f0f0f0f0f04f0f  the founder test identity (enterprise, grace 0, hold off) -- the subject
--   pilot-e5e5e5e5e5e54e5e  an unrelated self-service workspace -- must be left alone
begin;
select plan(16);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'authenticated', 'authenticated',
   '0ssol1620@gmail.com', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', 'authenticated', 'authenticated',
   'reset-bystander@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.foundation_account_access_grants (user_id, grant_kind, access_plan, active)
values ('f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'owner', 'studio_access', true);
insert into public.enterprise_organizations (organization_id, name, slug, created_by)
values ('0a200000-0000-4000-8000-000000000001', 'Founder Reset', 'founder-reset-fixture', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0');
insert into public.enterprise_organization_memberships (organization_id, user_id, role, created_by)
values ('0a200000-0000-4000-8000-000000000001', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'owner', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0');
insert into public.enterprise_workspaces (workspace_key, organization_id, display_name)
values ('pilot-f0f0f0f0f0f04f0f', '0a200000-0000-4000-8000-000000000001', 'Founder Reset');
insert into public.enterprise_workspace_memberships (workspace_key, user_id, role, created_by)
values ('pilot-f0f0f0f0f0f04f0f', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'owner', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0');
insert into public.enterprise_governance_policies (organization_id, deleted_object_grace_days, legal_hold_enabled, updated_by)
values ('0a200000-0000-4000-8000-000000000001', 0, false, 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0');

insert into public.foundation_api_keys (key_id, workspace_key, name, key_prefix, token_sha256, scopes, created_by) values
  ('f0c00000-0000-4000-8000-0000000000e1', 'pilot-f0f0f0f0f0f04f0f', 'founder inventory', 'rstinvF00001', repeat('4', 64),
   array['connections:sync'], 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0'),
  ('e5c00000-0000-4000-8000-0000000000e1', 'pilot-e5e5e5e5e5e54e5e', 'bystander inventory', 'rstinvE00001', repeat('5', 64),
   array['connections:sync'], 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5');
insert into public.foundation_connections (connection_id, workspace_key, provider, mode, display_name, status, created_by, updated_by) values
  ('f0c00000-0000-4000-8000-0000000000c1', 'pilot-f0f0f0f0f0f04f0f', 'file_server', 'local_agent', 'Founder share', 'active',
   'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0'),
  ('e5c00000-0000-4000-8000-0000000000c1', 'pilot-e5e5e5e5e5e54e5e', 'file_server', 'local_agent', 'Bystander share', 'active',
   'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5');

-- p_who: 'f' founder, 'e' bystander -- each through its own workspace, connection and key.
create function pg_temp.ib(p_who text, p_scan uuid, p_epoch bigint, p_expected bigint, p_items integer, p_pages integer)
returns jsonb language sql as $f$
  select public.begin_connection_inventory_scan(p_scan,
    case p_who when 'f' then 'pilot-f0f0f0f0f0f04f0f' else 'pilot-e5e5e5e5e5e54e5e' end,
    case p_who when 'f' then 'f0c00000-0000-4000-8000-0000000000c1'::uuid else 'e5c00000-0000-4000-8000-0000000000c1'::uuid end,
    null,
    case p_who when 'f' then 'f0c00000-0000-4000-8000-0000000000e1'::uuid else 'e5c00000-0000-4000-8000-0000000000e1'::uuid end,
    p_epoch, p_expected, p_items, p_pages)
$f$;
create function pg_temp.ip(p_who text, p_scan uuid, p_index integer, p_items jsonb) returns jsonb language sql as $f$
  select public.stage_connection_inventory_page(p_scan,
    case p_who when 'f' then 'pilot-f0f0f0f0f0f04f0f' else 'pilot-e5e5e5e5e5e54e5e' end,
    case p_who when 'f' then 'f0c00000-0000-4000-8000-0000000000c1'::uuid else 'e5c00000-0000-4000-8000-0000000000c1'::uuid end,
    null,
    case p_who when 'f' then 'f0c00000-0000-4000-8000-0000000000e1'::uuid else 'e5c00000-0000-4000-8000-0000000000e1'::uuid end,
    p_index, p_items)
$f$;
create function pg_temp.ifin(p_who text, p_scan uuid, p_items integer, p_pages integer) returns jsonb language sql as $f$
  select public.finalize_connection_inventory_scan(p_scan,
    case p_who when 'f' then 'pilot-f0f0f0f0f0f04f0f' else 'pilot-e5e5e5e5e5e54e5e' end,
    case p_who when 'f' then 'f0c00000-0000-4000-8000-0000000000c1'::uuid else 'e5c00000-0000-4000-8000-0000000000c1'::uuid end,
    null,
    case p_who when 'f' then 'f0c00000-0000-4000-8000-0000000000e1'::uuid else 'e5c00000-0000-4000-8000-0000000000e1'::uuid end,
    true, p_items, p_pages)
$f$;
create function pg_temp.item(p_native text) returns jsonb language sql as $f$
  select jsonb_build_object('nativeId', p_native, 'revision', 'r1', 'contentSha256', repeat('c', 64),
    'sizeBytes', 10, 'mimeType', 'application/pdf', 'aclObservationSha256', null)
$f$;
-- Row counts per inventory table for one workspace (pages through their scan).
create function pg_temp.inv_counts(p_workspace text) returns jsonb language sql as $f$
  select jsonb_build_object(
    'heads', (select count(*) from public.foundation_connection_inventory_heads where workspace_key = p_workspace),
    'scans', (select count(*) from public.foundation_connection_inventory_scans where workspace_key = p_workspace),
    'pages', (select count(*) from public.foundation_connection_inventory_pages p
               join public.foundation_connection_inventory_scans s on s.scan_id = p.scan_id where s.workspace_key = p_workspace),
    'items', (select count(*) from public.foundation_connection_inventory_items where workspace_key = p_workspace))
$f$;
-- Every inventory row of one workspace, for an exact before/after comparison.
create function pg_temp.inv_rows(p_workspace text) returns text language sql as $f$
  select coalesce(string_agg(r, E'\n' order by r), '') from (
    select 'h:' || to_jsonb(x)::text r from public.foundation_connection_inventory_heads x where workspace_key = p_workspace
    union all select 's:' || to_jsonb(x)::text from public.foundation_connection_inventory_scans x where workspace_key = p_workspace
    union all select 'p:' || to_jsonb(p)::text from public.foundation_connection_inventory_pages p
      join public.foundation_connection_inventory_scans s on s.scan_id = p.scan_id where s.workspace_key = p_workspace
    union all select 'i:' || to_jsonb(x)::text from public.foundation_connection_inventory_items x where workspace_key = p_workspace
  ) q
$f$;

-- ---------------------------------------------------------------------------
-- Fixture: in each workspace a finalized scan (head + items) and an open scan with one of its two
-- pages staged.
-- ---------------------------------------------------------------------------
do $d$ begin
  perform pg_temp.ib('f', 'f0c00000-0000-4000-8000-000000005c01', 1, 0, 2, 1);
  perform pg_temp.ip('f', 'f0c00000-0000-4000-8000-000000005c01', 0, jsonb_build_array(pg_temp.item('a'), pg_temp.item('b')));
  perform pg_temp.ifin('f', 'f0c00000-0000-4000-8000-000000005c01', 2, 1);
  perform pg_temp.ib('f', 'f0c00000-0000-4000-8000-000000005c02', 2, 1, 3, 2);
  perform pg_temp.ip('f', 'f0c00000-0000-4000-8000-000000005c02', 0, jsonb_build_array(pg_temp.item('a'), pg_temp.item('c')));

  perform pg_temp.ib('e', 'e5c00000-0000-4000-8000-000000005c01', 1, 0, 1, 1);
  perform pg_temp.ip('e', 'e5c00000-0000-4000-8000-000000005c01', 0, jsonb_build_array(pg_temp.item('x')));
  perform pg_temp.ifin('e', 'e5c00000-0000-4000-8000-000000005c01', 1, 1);
  perform pg_temp.ib('e', 'e5c00000-0000-4000-8000-000000005c02', 2, 1, 2, 2);
  perform pg_temp.ip('e', 'e5c00000-0000-4000-8000-000000005c02', 0, jsonb_build_array(pg_temp.item('x')));
end $d$;

select is(pg_temp.inv_counts('pilot-f0f0f0f0f0f04f0f'), '{"heads":1,"scans":2,"pages":1,"items":2}'::jsonb,
  'fixture: the founder has a head, a finalized and an open scan, one staged page and two items');
select is((select state from public.foundation_connection_inventory_scans where scan_id = 'f0c00000-0000-4000-8000-000000005c02'),
  'open', 'fixture: the second founder scan is still open');

-- ---------------------------------------------------------------------------
-- Prepare counts only the founder inventory; a page staged after it is drift
-- ---------------------------------------------------------------------------
create temp table prepared as select public.prepare_founder_test_reset('0ssol1620@gmail.com',
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f') as r;
select is((select jsonb_build_object(
    'heads', r->'dbCounts'->'foundation_connection_inventory_heads',
    'scans', r->'dbCounts'->'foundation_connection_inventory_scans',
    'pages', r->'dbCounts'->'foundation_connection_inventory_pages',
    'items', r->'dbCounts'->'foundation_connection_inventory_items') from prepared),
  '{"heads":1,"scans":2,"pages":1,"items":2}'::jsonb,
  'the sealed manifest counts exactly the founder inventory rows');

select throws_ok($$do $d$ begin
  perform pg_temp.ip('f', 'f0c00000-0000-4000-8000-000000005c02', 1, jsonb_build_array(pg_temp.item('d')));
  perform public.seal_founder_test_reset((select (r->>'resetId')::uuid from prepared), '0ssol1620@gmail.com',
    'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f', (select r->>'dbManifestDigest' from prepared),
    'sha256:' || repeat('b', 64), '[]'::jsonb);
end $d$;$$, 'P0001', 'founder_test_reset_database_drift', 'an inventory page staged after prepare is database drift');

select is(public.seal_founder_test_reset((select (r->>'resetId')::uuid from prepared), '0ssol1620@gmail.com',
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f', (select r->>'dbManifestDigest' from prepared),
  'sha256:' || repeat('b', 64), '[]'::jsonb)->>'status', 'sealed', 'the reset seals with inventory rows present');

-- ---------------------------------------------------------------------------
-- While sealed
-- ---------------------------------------------------------------------------
select throws_ok($$select pg_temp.ip('f', 'f0c00000-0000-4000-8000-000000005c02', 1, jsonb_build_array(pg_temp.item('d')))$$,
  'P0001', 'founder_test_reset_write_fenced', 'a sealed workspace stages no inventory page');
select throws_ok($$select pg_temp.ib('f', 'f0c00000-0000-4000-8000-000000005c03', 3, 1, 0, 1)$$,
  'P0001', 'founder_test_reset_write_fenced', 'and begins no inventory scan');
select throws_ok($$delete from public.foundation_connection_inventory_heads where workspace_key = 'pilot-f0f0f0f0f0f04f0f'$$,
  'P0001', 'founder_test_reset_write_fenced', 'nor is an inventory head deleted outside finalize');
select lives_ok($$select pg_temp.ip('e', 'e5c00000-0000-4000-8000-000000005c02', 1, jsonb_build_array(pg_temp.item('y')))$$,
  'another workspace still stages inventory pages');
create temp table bystander_before as select pg_temp.inv_rows('pilot-e5e5e5e5e5e54e5e') as rows;

-- ---------------------------------------------------------------------------
-- Finalize: the inventory no longer blocks the connection delete, and only the founder's goes
-- ---------------------------------------------------------------------------
select is(public.finalize_founder_test_reset((select (r->>'resetId')::uuid from prepared), '0ssol1620@gmail.com',
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f', 'sha256:' || repeat('b', 64))->>'status',
  'db_finalized_pending_object_verify', 'finalize succeeds with an open scan, staged pages and finalized inventory');
select is(pg_temp.inv_counts('pilot-f0f0f0f0f0f04f0f'), '{"heads":0,"scans":0,"pages":0,"items":0}'::jsonb,
  'no inventory row of the founder workspace remains');
select is((select count(*)::integer from public.foundation_connections where workspace_key = 'pilot-f0f0f0f0f0f04f0f'), 0,
  'with the connection they referenced');
select is(pg_temp.inv_rows('pilot-e5e5e5e5e5e54e5e'), (select rows from bystander_before),
  'every bystander inventory row is byte-identical after finalize');
select is(pg_temp.inv_counts('pilot-e5e5e5e5e5e54e5e'), '{"heads":1,"scans":2,"pages":2,"items":1}'::jsonb,
  'and the bystander still has its head, scans, staged pages and items');
select is((select count(*)::integer from public.founder_test_reset_evidence_archive
  where reset_id = (select (r->>'resetId')::uuid from prepared) and source_table like 'foundation_connection_inventory_%'), 0,
  'inventory is deleted, not archived, like the other per-connection sync state');

select is(public.complete_founder_test_reset((select (r->>'resetId')::uuid from prepared), '0ssol1620@gmail.com',
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f', 'sha256:' || repeat('b', 64))->>'status',
  'completed', 'the reset completes');

select * from finish();
rollback;
