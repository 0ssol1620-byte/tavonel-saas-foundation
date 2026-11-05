-- Migration 20261105000000 (W1-A1 review R2 N1): a key's kind is the stored token_kind, never its name.
--
-- One signed-up member M mints, through the same RPC the application calls with PostgREST's named
-- arguments: a hand-made key someone named like an MCP connection, with no expiry (the legacy
-- case), and two remote MCP keys, one with an expiry and one without. The application's three
-- reads and its one write are restated here as SQL over the same columns (lib/developer-store.ts):
-- the manual list, the live-MCP list (a null expiry is live, said explicitly), and the operator's
-- bulk revoke. The legacy-named key stays manual in all of them. Rotation refuses an MCP source.
begin;
select plan(17);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values ('00000000-0000-0000-0000-000000000000', 'c3c3c3c3-0000-4000-8000-0000000000c3', 'authenticated',
  'authenticated', 'token-kind@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now());
set local role authenticated;
set constraints all immediate;
reset role;

create function pg_temp.ws() returns text language sql as $$
  select workspace_key from public.foundation_workspace_members
    where user_id = 'c3c3c3c3-0000-4000-8000-0000000000c3'::uuid and state = 'active' limit 1;
$$;
create function pg_temp.rev() returns bigint language sql as $$
  select authorization_revision from public.foundation_workspace_members
    where user_id = 'c3c3c3c3-0000-4000-8000-0000000000c3'::uuid and state = 'active' limit 1;
$$;
-- The eight named arguments every caller before this migration sends.
create function pg_temp.mint_manual(p_name text, p_prefix text) returns jsonb language sql as $$
  select public.create_foundation_api_key_authorized(
    p_workspace_key => pg_temp.ws(), p_name => p_name, p_key_prefix => p_prefix,
    p_token_sha256 => encode(sha256(convert_to('tvnl_live_' || p_prefix, 'UTF8')), 'hex'),
    p_scopes => array['worlds:read'], p_expires_at => null,
    p_actor_user_id => 'c3c3c3c3-0000-4000-8000-0000000000c3'::uuid, p_authorization_revision => pg_temp.rev());
$$;
create function pg_temp.mint(p_name text, p_prefix text, p_kind text, p_expires timestamptz) returns jsonb language sql as $$
  select public.create_foundation_api_key_authorized(
    p_workspace_key => pg_temp.ws(), p_name => p_name, p_key_prefix => p_prefix,
    p_token_sha256 => encode(sha256(convert_to('tvnl_' || p_kind || '_' || p_prefix, 'UTF8')), 'hex'),
    p_scopes => array['worlds:read'], p_expires_at => p_expires,
    p_actor_user_id => 'c3c3c3c3-0000-4000-8000-0000000000c3'::uuid, p_authorization_revision => pg_temp.rev(),
    p_token_kind => p_kind);
$$;
create function pg_temp.kind(p_prefix text) returns text language sql as $$
  select token_kind from public.foundation_api_keys where key_prefix = p_prefix;
$$;

-- 1-5: shape and the client boundary.
select col_not_null('public', 'foundation_api_keys', 'token_kind', 'every key has a kind');
select ok(to_regprocedure('public.create_foundation_api_key_authorized(text, text, text, text, text[], timestamptz, uuid, bigint)') is null,
  'the eight-argument create is gone, so PostgREST has one candidate to resolve');
select ok(has_function_privilege('service_role',
  'public.create_foundation_api_key_authorized(text, text, text, text, text[], timestamptz, uuid, bigint, text)', 'EXECUTE'),
  'the server credential can create a key');
select ok(not has_function_privilege('anon',
  'public.create_foundation_api_key_authorized(text, text, text, text, text[], timestamptz, uuid, bigint, text)', 'EXECUTE'),
  'anon cannot create a key');
select ok(not has_function_privilege('authenticated',
  'public.create_foundation_api_key_authorized(text, text, text, text, text[], timestamptz, uuid, bigint, text)', 'EXECUTE'),
  'a signed-in browser cannot create a key');

-- 6-9: minting.
select is(pg_temp.mint_manual('MCP: legacy hand-made', 'legacyNamed1') ->> 'token_kind', 'live',
  'a caller that names no kind gets a manual key, even under an MCP-looking name');
select is(pg_temp.mint('MCP: Claude ~0123456789ab #c1', 'remoteExpire', 'mcp', now() + interval '1 hour') ->> 'token_kind', 'mcp',
  'the remote MCP token route stores its kind');
select is(pg_temp.mint('MCP: Claude ~0123456789ab #c2', 'remoteNoExp1', 'mcp', null) ->> 'token_kind', 'mcp',
  'an MCP key without an expiry is still an MCP key');
select throws_ok($$select pg_temp.mint('anything', 'badKindKey12', 'other', null)$$, '23514', null,
  'a kind outside live and mcp is refused');

-- 10-13: the application's reads, as SQL.
select results_eq(
  $$select name from public.foundation_api_keys where workspace_key = pg_temp.ws() and token_kind = 'live' order by name$$,
  $$values ('MCP: legacy hand-made'::text)$$,
  'the manual list holds the legacy-named key');
select results_eq(
  $$select key_prefix from public.foundation_api_keys
      where workspace_key = pg_temp.ws() and token_kind = 'mcp' and revoked_at is null
        and (expires_at is null or expires_at > now()) order by key_prefix$$,
  $$values ('remoteExpire'::text), ('remoteNoExp1'::text)$$,
  'the live-MCP list holds both MCP keys, the one with no expiry included, and not the legacy-named key');
select is(
  (select count(*)::integer from public.foundation_api_keys
    where workspace_key = pg_temp.ws() and token_kind = 'mcp' and revoked_at is null and expires_at > now()),
  1, 'the bare expires_at > now() filter drops a null expiry, which is why the list says it explicitly');
select is(pg_temp.kind('legacyNamed1'), 'live', 'a name never changes the kind');

-- 14-15: the operator's bulk revoke, as SQL.
update public.foundation_api_keys set revoked_at = clock_timestamp() where token_kind = 'mcp' and revoked_at is null;
select is(
  (select count(*)::integer from public.foundation_api_keys where workspace_key = pg_temp.ws() and token_kind = 'mcp' and revoked_at is null),
  0, 'the bulk revoke ends every MCP key');
select ok(
  (select revoked_at is null from public.foundation_api_keys where key_prefix = 'legacyNamed1'),
  'the bulk revoke leaves the legacy-named manual key alive');

-- 16-17: rotation is for manual keys.
select throws_ok(
  $$select public.rotate_foundation_api_key(pg_temp.ws(),
      (select key_id from public.foundation_api_keys where key_prefix = 'remoteNoExp1'), 'rotated', 'rotatedMcp12',
      encode(sha256(convert_to('rotated-mcp', 'UTF8')), 'hex'), array['worlds:read'], null,
      'c3c3c3c3-0000-4000-8000-0000000000c3'::uuid, pg_temp.rev())$$,
  'P0001', 'api_key_rotation_source_invalid', 'an MCP key cannot be rotated into a manual one');
select is(
  public.rotate_foundation_api_key(pg_temp.ws(),
    (select key_id from public.foundation_api_keys where key_prefix = 'legacyNamed1'), 'ci rotated', 'rotatedLive1',
    encode(sha256(convert_to('rotated-live', 'UTF8')), 'hex'), array['worlds:read'], null,
    'c3c3c3c3-0000-4000-8000-0000000000c3'::uuid, pg_temp.rev()) ->> 'keyPrefix',
  'rotatedLive1', 'the legacy-named manual key rotates like any manual key');

select * from finish();
rollback;
