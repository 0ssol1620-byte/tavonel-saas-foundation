-- Connection source inventory: a complete scan, delivered in pages, reconciled centrally.
--
-- The existing cursor batch (apply_foundation_connection_batch, 0012) carries *changes*. A change
-- feed cannot tell "deleted at origin" from "the agent never looked", so this adds the other half:
-- a scan session in which the agent reports everything it saw, and the server marks what it did
-- not see. The batch lane and foundation_connections.cursor_sha256 are not read or written here.
--
--   begin     binds scan_id to (workspace, connection, scan_epoch, expected_head_epoch, declared
--             item/page counts). Compare-and-set: expected_head_epoch must equal the connection's
--             current head epoch. Epochs: a begin whose epoch is not above every open scan's epoch
--             is refused; a higher one supersedes the open scan (its staged pages are released).
--   page      stages one page. An exact replay (same scan, index and items, compared as jsonb) is
--             answered "replayed" without effect; different items for the same index are refused.
--   finalize  requires complete=true, every declared page, the exact item count, unique native ids
--             and an unchanged head epoch, then reconciles in one transaction.
--
-- What finalize does NOT do:
--   * An item absent from a finalized scan becomes state 'unobserved'. That is a tombstone
--     *candidate* only. Nothing here writes source_deletion_tombstones, deletes or purges any row
--     or object, or touches legal holds. Deletion stays with the existing tombstone -> attestation
--     -> purge machinery (20260920132000, 20260921110000, 20260927102000).
--   * acl_observation_sha256 is an opaque digest of what the agent observed. It is stored as an
--     observation and grants nothing: no access table (source_acl_snapshots,
--     foundation_account_access_grants, ...) is read or written, and no serving path reads it.
--   * complete=true is the agent's attestation. The database checks structural completeness of
--     what it received; it cannot observe the mount.
--
-- Bounds (mirrored by INVENTORY_LIMITS in nextjs/lib/connection-source-inventory.ts):
--   items per scan 0..100000, pages 1..400, items per page 0..500 (an empty scan is exactly one
--   empty page), nativeId 1..1024 UTF-8 bytes, revision 1..512 bytes (no C0 control or DEL),
--   sizeBytes 0..1099511627776, mimeType null or MIME_TYPE_PATTERN and <= 127 chars.
--
-- Privileges: RLS on with a restrictive deny policy for anon/authenticated, no table privilege for
-- any client role or service_role. service_role gets EXECUTE on the three RPCs only.
--
-- Create-once (create table): not part of the replay step in db-rehearsal.yml.
begin;

-- The single MIME rule. The TypeScript twin is MIME_TYPE_PATTERN; both are tested against the
-- same vectors (supabase/tests/connection_source_inventory_reconcile.sql, MIME_VECTORS).
create function public.connection_inventory_mime_valid(p_mime text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_mime is not null and char_length(p_mime) <= 127
    and p_mime ~ '^[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+$'
$$;

create function public.connection_inventory_item_valid(p_item jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_item is null or jsonb_typeof(p_item) is distinct from 'object' then false
    when (select array_agg(k order by k collate "C") from jsonb_object_keys(p_item) k)
      is distinct from array['aclObservationSha256', 'contentSha256', 'mimeType', 'nativeId', 'revision', 'sizeBytes']::text[]
      then false
    else
      (case when jsonb_typeof(p_item->'nativeId') = 'string'
            then octet_length(p_item->>'nativeId') between 1 and 1024 and (p_item->>'nativeId') !~ '[\x01-\x1f\x7f]'
            else false end)
      and (case when jsonb_typeof(p_item->'revision') = 'string'
            then octet_length(p_item->>'revision') between 1 and 512 and (p_item->>'revision') !~ '[\x01-\x1f\x7f]'
            else false end)
      and (case jsonb_typeof(p_item->'contentSha256')
            when 'null' then true
            when 'string' then (p_item->>'contentSha256') ~ '^[a-f0-9]{64}$'
            else false end)
      and (case jsonb_typeof(p_item->'aclObservationSha256')
            when 'null' then true
            when 'string' then (p_item->>'aclObservationSha256') ~ '^[a-f0-9]{64}$'
            else false end)
      and (case jsonb_typeof(p_item->'mimeType')
            when 'null' then true
            when 'string' then public.connection_inventory_mime_valid(p_item->>'mimeType')
            else false end)
      and (case when jsonb_typeof(p_item->'sizeBytes') = 'number'
              and (p_item->>'sizeBytes') ~ '^(0|[1-9][0-9]{0,12})$'
            then (p_item->>'sizeBytes')::bigint <= 1099511627776
            else false end)
  end
$$;

create table public.foundation_connection_inventory_heads (
  connection_id uuid primary key references public.foundation_connections(connection_id) on delete restrict,
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  head_epoch bigint not null default 0 check (head_epoch >= 0),
  head_scan_id uuid,
  updated_at timestamptz not null default clock_timestamp(),
  check ((head_epoch = 0) = (head_scan_id is null))
);

create table public.foundation_connection_inventory_scans (
  scan_id uuid primary key,
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  connection_id uuid not null references public.foundation_connections(connection_id) on delete restrict,
  scan_epoch bigint not null check (scan_epoch >= 1),
  expected_head_epoch bigint not null check (expected_head_epoch >= 0 and expected_head_epoch < scan_epoch),
  item_count integer not null check (item_count between 0 and 100000),
  page_count integer not null check (page_count between 1 and 400),
  state text not null default 'open' check (state in ('open', 'finalized', 'superseded')),
  actor_user_id uuid references auth.users(id) on delete restrict,
  actor_key_id uuid references public.foundation_api_keys(key_id) on delete restrict,
  begun_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  receipt jsonb check (receipt is null or jsonb_typeof(receipt) = 'object'),
  check ((actor_user_id is null) <> (actor_key_id is null)),
  check ((item_count = 0 and page_count = 1)
    or (item_count > 0 and page_count <= item_count and item_count <= page_count * 500)),
  check ((state = 'open') = (closed_at is null)),
  check ((state = 'finalized') = (receipt is not null))
);
-- ponytail: finalized/superseded scan rows (receipts only, pages are released) are kept; prune by
-- age when a connection's history measurably matters.
create unique index foundation_connection_inventory_scans_one_open_idx
  on public.foundation_connection_inventory_scans (connection_id) where state = 'open';

alter table public.foundation_connection_inventory_heads
  add constraint foundation_connection_inventory_heads_scan_fkey
  foreign key (head_scan_id) references public.foundation_connection_inventory_scans(scan_id) on delete restrict;

create table public.foundation_connection_inventory_pages (
  scan_id uuid not null references public.foundation_connection_inventory_scans(scan_id) on delete cascade,
  page_index integer not null check (page_index between 0 and 399),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 500),
  primary key (scan_id, page_index)
);

create table public.foundation_connection_inventory_items (
  connection_id uuid not null references public.foundation_connections(connection_id) on delete restrict,
  native_id text not null check (octet_length(native_id) between 1 and 1024 and native_id !~ '[\x01-\x1f\x7f]'),
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  state text not null check (state in ('present', 'unobserved')),
  revision text not null check (octet_length(revision) between 1 and 512 and revision !~ '[\x01-\x1f\x7f]'),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint not null check (size_bytes between 0 and 1099511627776),
  mime_type text check (mime_type is null or public.connection_inventory_mime_valid(mime_type)),
  acl_observation_sha256 text check (acl_observation_sha256 is null or acl_observation_sha256 ~ '^[a-f0-9]{64}$'),
  observed_epoch bigint not null check (observed_epoch >= 1),
  state_epoch bigint not null check (state_epoch >= 1),
  primary key (connection_id, native_id)
);

-- The founder test reset's write fence (20260920133000). Every RPC writes a head or scan row in
-- the same transaction as its other writes, so fencing these two blocks begin and finalize for a
-- sealed workspace without a per-item trigger. The reset itself does not yet archive or delete
-- these tables; the restrict FKs above make a reset of a workspace with inventory rows fail
-- loudly instead of dropping them unarchived.
create trigger founder_reset_fence before insert or update or delete on public.foundation_connection_inventory_heads
  for each row execute function public.guard_founder_test_reset_workspace_write();
create trigger founder_reset_fence before insert or update or delete on public.foundation_connection_inventory_scans
  for each row execute function public.guard_founder_test_reset_workspace_write();

-- Internal: the actor must still hold the workspace (the route checked it too; this is the
-- database's own check), and the connection must belong to that workspace and be syncable.
-- A connection in another workspace and a missing one are indistinguishable to the caller.
create function public.connection_inventory_bind(
  p_workspace_key text,
  p_connection_id uuid,
  p_actor_user_id uuid,
  p_actor_key_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$' or p_connection_id is null
    or ((p_actor_user_id is null) = (p_actor_key_id is null)) then
    raise exception 'INVENTORY_CONTRACT_INVALID';
  end if;
  if p_actor_key_id is not null and not exists (
    select 1 from public.foundation_api_keys k
     where k.key_id = p_actor_key_id and k.workspace_key = p_workspace_key
       and k.revoked_at is null and (k.expires_at is null or k.expires_at > clock_timestamp())
       and 'connections:sync' = any(k.scopes)
  ) then
    raise exception 'INVENTORY_ACTOR_INVALID';
  end if;
  if p_actor_user_id is not null and not exists (
    select 1 from public.foundation_workspace_members m
     where m.workspace_key = p_workspace_key and m.user_id = p_actor_user_id and m.state = 'active'
  ) then
    raise exception 'INVENTORY_ACTOR_INVALID';
  end if;
  perform 1 from public.foundation_connections c
   where c.connection_id = p_connection_id and c.workspace_key = p_workspace_key
     and c.status not in ('revoked', 'paused')
   for update;
  if not found then
    raise exception 'CONNECTION_NOT_SYNCABLE';
  end if;
end;
$$;

create function public.begin_connection_inventory_scan(
  p_scan_id uuid,
  p_workspace_key text,
  p_connection_id uuid,
  p_actor_user_id uuid,
  p_actor_key_id uuid,
  p_scan_epoch bigint,
  p_expected_head_epoch bigint,
  p_item_count integer,
  p_page_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_head public.foundation_connection_inventory_heads%rowtype;
  v_scan public.foundation_connection_inventory_scans%rowtype;
begin
  if p_scan_id is null or p_scan_epoch is null or p_scan_epoch < 1
    or p_expected_head_epoch is null or p_expected_head_epoch < 0 or p_expected_head_epoch >= p_scan_epoch
    or p_item_count is null or p_item_count not between 0 and 100000
    or p_page_count is null or p_page_count not between 1 and 400
    or not ((p_item_count = 0 and p_page_count = 1)
            or (p_item_count > 0 and p_page_count <= p_item_count and p_item_count <= p_page_count * 500)) then
    raise exception 'INVENTORY_CONTRACT_INVALID';
  end if;
  perform public.connection_inventory_bind(p_workspace_key, p_connection_id, p_actor_user_id, p_actor_key_id);

  insert into public.foundation_connection_inventory_heads (connection_id, workspace_key)
    values (p_connection_id, p_workspace_key) on conflict (connection_id) do nothing;
  select * into v_head from public.foundation_connection_inventory_heads
   where connection_id = p_connection_id for update;

  select * into v_scan from public.foundation_connection_inventory_scans where scan_id = p_scan_id;
  if found then
    if v_scan.workspace_key <> p_workspace_key or v_scan.connection_id <> p_connection_id
      or v_scan.scan_epoch <> p_scan_epoch or v_scan.expected_head_epoch <> p_expected_head_epoch
      or v_scan.item_count <> p_item_count or v_scan.page_count <> p_page_count then
      raise exception 'INVENTORY_SCAN_CONFLICT';
    end if;
    if v_scan.state <> 'open' then
      raise exception 'INVENTORY_SCAN_NOT_OPEN';
    end if;
    return jsonb_build_object('status', 'replayed', 'scanId', p_scan_id, 'scanEpoch', p_scan_epoch,
      'headEpoch', v_head.head_epoch);
  end if;

  if v_head.head_epoch <> p_expected_head_epoch then
    raise exception 'INVENTORY_HEAD_STALE' using detail = v_head.head_epoch::text;
  end if;
  if exists (select 1 from public.foundation_connection_inventory_scans s
              where s.connection_id = p_connection_id and s.state = 'open' and s.scan_epoch >= p_scan_epoch) then
    raise exception 'INVENTORY_EPOCH_STALE';
  end if;

  delete from public.foundation_connection_inventory_pages p
    using public.foundation_connection_inventory_scans s
   where s.scan_id = p.scan_id and s.connection_id = p_connection_id and s.state = 'open';
  update public.foundation_connection_inventory_scans
     set state = 'superseded', closed_at = clock_timestamp()
   where connection_id = p_connection_id and state = 'open';

  insert into public.foundation_connection_inventory_scans (
    scan_id, workspace_key, connection_id, scan_epoch, expected_head_epoch, item_count, page_count,
    actor_user_id, actor_key_id
  ) values (
    p_scan_id, p_workspace_key, p_connection_id, p_scan_epoch, p_expected_head_epoch, p_item_count,
    p_page_count, p_actor_user_id, p_actor_key_id
  );
  return jsonb_build_object('status', 'begun', 'scanId', p_scan_id, 'scanEpoch', p_scan_epoch,
    'headEpoch', v_head.head_epoch);
end;
$$;

create function public.stage_connection_inventory_page(
  p_scan_id uuid,
  p_workspace_key text,
  p_connection_id uuid,
  p_actor_user_id uuid,
  p_actor_key_id uuid,
  p_page_index integer,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scan public.foundation_connection_inventory_scans%rowtype;
  v_existing jsonb;
  v_count integer;
  v_staged bigint;
begin
  if p_scan_id is null or p_page_index is null or p_page_index not between 0 and 399
    or p_items is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 500 then
    raise exception 'INVENTORY_CONTRACT_INVALID';
  end if;
  perform public.connection_inventory_bind(p_workspace_key, p_connection_id, p_actor_user_id, p_actor_key_id);
  select * into v_scan from public.foundation_connection_inventory_scans
   where scan_id = p_scan_id and workspace_key = p_workspace_key and connection_id = p_connection_id
   for update;
  if not found then
    raise exception 'INVENTORY_SCAN_NOT_FOUND';
  end if;
  if v_scan.state <> 'open' then
    raise exception 'INVENTORY_SCAN_NOT_OPEN';
  end if;

  select items into v_existing from public.foundation_connection_inventory_pages
   where scan_id = p_scan_id and page_index = p_page_index;
  if found then
    if v_existing <> p_items then
      raise exception 'INVENTORY_PAGE_CONFLICT';
    end if;
    return jsonb_build_object('status', 'replayed', 'scanId', p_scan_id, 'pageIndex', p_page_index,
      'itemCount', jsonb_array_length(p_items));
  end if;

  if p_page_index >= v_scan.page_count then
    raise exception 'INVENTORY_PAGE_INDEX_INVALID';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e(item)
              where not public.connection_inventory_item_valid(e.item)) then
    raise exception 'INVENTORY_ITEM_INVALID';
  end if;
  v_count := jsonb_array_length(p_items);
  select coalesce(sum(jsonb_array_length(items)), 0) into v_staged
    from public.foundation_connection_inventory_pages where scan_id = p_scan_id;
  if (v_scan.item_count = 0) <> (v_count = 0) or v_staged + v_count > v_scan.item_count then
    raise exception 'INVENTORY_COUNT_MISMATCH';
  end if;

  insert into public.foundation_connection_inventory_pages (scan_id, page_index, items)
    values (p_scan_id, p_page_index, p_items);
  return jsonb_build_object('status', 'staged', 'scanId', p_scan_id, 'pageIndex', p_page_index,
    'itemCount', v_count);
end;
$$;

create function public.finalize_connection_inventory_scan(
  p_scan_id uuid,
  p_workspace_key text,
  p_connection_id uuid,
  p_actor_user_id uuid,
  p_actor_key_id uuid,
  p_complete boolean,
  p_item_count integer,
  p_page_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scan public.foundation_connection_inventory_scans%rowtype;
  v_head public.foundation_connection_inventory_heads%rowtype;
  v_pages integer;
  v_items bigint;
  v_distinct bigint;
  v_present integer;
  v_unobserved integer;
  v_receipt jsonb;
begin
  if p_scan_id is null or p_complete is null or p_item_count is null or p_page_count is null then
    raise exception 'INVENTORY_CONTRACT_INVALID';
  end if;
  perform public.connection_inventory_bind(p_workspace_key, p_connection_id, p_actor_user_id, p_actor_key_id);
  select * into v_head from public.foundation_connection_inventory_heads
   where connection_id = p_connection_id for update;
  select * into v_scan from public.foundation_connection_inventory_scans
   where scan_id = p_scan_id and workspace_key = p_workspace_key and connection_id = p_connection_id
   for update;
  if not found then
    raise exception 'INVENTORY_SCAN_NOT_FOUND';
  end if;

  -- Committed: an exact replay returns the stored receipt and never re-applies.
  if v_scan.state = 'finalized' then
    if p_complete and p_item_count = v_scan.item_count and p_page_count = v_scan.page_count then
      return jsonb_build_object('status', 'replayed', 'receipt', v_scan.receipt);
    end if;
    raise exception 'INVENTORY_FINALIZE_CONFLICT';
  end if;
  if not p_complete then
    raise exception 'INVENTORY_NOT_ATTESTED_COMPLETE';
  end if;
  if v_scan.state <> 'open' then
    raise exception 'INVENTORY_SCAN_NOT_OPEN';
  end if;
  if p_item_count <> v_scan.item_count or p_page_count <> v_scan.page_count then
    raise exception 'INVENTORY_COUNT_MISMATCH';
  end if;

  select count(*) into v_pages from public.foundation_connection_inventory_pages where scan_id = p_scan_id;
  select count(*), count(distinct e.item->>'nativeId') into v_items, v_distinct
    from public.foundation_connection_inventory_pages p
    cross join lateral jsonb_array_elements(p.items) e(item)
   where p.scan_id = p_scan_id;
  if v_pages <> v_scan.page_count or v_items <> v_scan.item_count then
    raise exception 'INVENTORY_PAGES_INCOMPLETE';
  end if;
  if v_distinct <> v_items then
    raise exception 'INVENTORY_DUPLICATE_ITEM';
  end if;
  -- Unreachable through these RPCs (a newer begin supersedes this scan first); kept so the head
  -- can never move backwards if another writer is ever added.
  if v_head.head_epoch is distinct from v_scan.expected_head_epoch or v_head.head_epoch >= v_scan.scan_epoch then
    raise exception 'INVENTORY_HEAD_STALE' using detail = v_head.head_epoch::text;
  end if;

  insert into public.foundation_connection_inventory_items as cur (
    connection_id, native_id, workspace_key, state, revision, content_sha256, size_bytes, mime_type,
    acl_observation_sha256, observed_epoch, state_epoch
  )
  select p_connection_id, e.item->>'nativeId', p_workspace_key, 'present', e.item->>'revision',
         e.item->>'contentSha256', (e.item->>'sizeBytes')::bigint, e.item->>'mimeType',
         e.item->>'aclObservationSha256', v_scan.scan_epoch, v_scan.scan_epoch
    from public.foundation_connection_inventory_pages p
    cross join lateral jsonb_array_elements(p.items) e(item)
   where p.scan_id = p_scan_id
  on conflict (connection_id, native_id) do update set
    state = 'present',
    revision = excluded.revision,
    content_sha256 = excluded.content_sha256,
    size_bytes = excluded.size_bytes,
    mime_type = excluded.mime_type,
    acl_observation_sha256 = excluded.acl_observation_sha256,
    observed_epoch = excluded.observed_epoch,
    state_epoch = case when cur.state = 'present' then cur.state_epoch else excluded.state_epoch end;
  get diagnostics v_present = row_count;

  -- Descriptive absence only: the row keeps its last observation and becomes a tombstone candidate.
  update public.foundation_connection_inventory_items
     set state = 'unobserved', state_epoch = v_scan.scan_epoch
   where connection_id = p_connection_id and state = 'present' and observed_epoch < v_scan.scan_epoch;
  get diagnostics v_unobserved = row_count;

  update public.foundation_connection_inventory_heads
     set head_epoch = v_scan.scan_epoch, head_scan_id = p_scan_id, updated_at = clock_timestamp()
   where connection_id = p_connection_id;

  v_receipt := jsonb_build_object(
    'scanId', p_scan_id,
    'scanEpoch', v_scan.scan_epoch,
    'itemCount', v_scan.item_count,
    'pageCount', v_scan.page_count,
    'present', v_present,
    'newlyUnobserved', v_unobserved,
    'absence', 'unobserved_tombstone_candidate_not_deleted',
    'aclObservation', 'recorded_not_an_access_grant',
    'completeness', 'agent_attested_structurally_checked'
  );
  update public.foundation_connection_inventory_scans
     set state = 'finalized', receipt = v_receipt, closed_at = clock_timestamp()
   where scan_id = p_scan_id;
  delete from public.foundation_connection_inventory_pages where scan_id = p_scan_id;
  return jsonb_build_object('status', 'finalized', 'receipt', v_receipt);
end;
$$;

alter table public.foundation_connection_inventory_heads enable row level security;
alter table public.foundation_connection_inventory_scans enable row level security;
alter table public.foundation_connection_inventory_pages enable row level security;
alter table public.foundation_connection_inventory_items enable row level security;

revoke all on public.foundation_connection_inventory_heads, public.foundation_connection_inventory_scans,
  public.foundation_connection_inventory_pages, public.foundation_connection_inventory_items
  from public, anon, authenticated, service_role;

create policy foundation_connection_inventory_heads_no_client_access
  on public.foundation_connection_inventory_heads as restrictive for all to anon, authenticated
  using (false) with check (false);
create policy foundation_connection_inventory_scans_no_client_access
  on public.foundation_connection_inventory_scans as restrictive for all to anon, authenticated
  using (false) with check (false);
create policy foundation_connection_inventory_pages_no_client_access
  on public.foundation_connection_inventory_pages as restrictive for all to anon, authenticated
  using (false) with check (false);
create policy foundation_connection_inventory_items_no_client_access
  on public.foundation_connection_inventory_items as restrictive for all to anon, authenticated
  using (false) with check (false);

revoke all on function public.connection_inventory_mime_valid(text) from public, anon, authenticated, service_role;
revoke all on function public.connection_inventory_item_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.connection_inventory_bind(text, uuid, uuid, uuid) from public, anon, authenticated, service_role;

revoke all on function public.begin_connection_inventory_scan(uuid, text, uuid, uuid, uuid, bigint, bigint, integer, integer)
  from public, anon, authenticated;
grant execute on function public.begin_connection_inventory_scan(uuid, text, uuid, uuid, uuid, bigint, bigint, integer, integer)
  to service_role;
revoke all on function public.stage_connection_inventory_page(uuid, text, uuid, uuid, uuid, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.stage_connection_inventory_page(uuid, text, uuid, uuid, uuid, integer, jsonb)
  to service_role;
revoke all on function public.finalize_connection_inventory_scan(uuid, text, uuid, uuid, uuid, boolean, integer, integer)
  from public, anon, authenticated;
grant execute on function public.finalize_connection_inventory_scan(uuid, text, uuid, uuid, uuid, boolean, integer, integer)
  to service_role;

commit;
