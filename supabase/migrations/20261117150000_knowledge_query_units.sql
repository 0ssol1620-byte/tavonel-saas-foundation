-- WO-CAT-4 (workorders/catalog-v2.md §8, §14): the KQU meter -- one knowledge query unit per
-- answered Ask or search, counted per workspace per month, with a hard stop at the plan's allowance.
--
-- Ordering: 20261117150000, assigned by the lead (catalog-v2.md §14), after
-- 20261117140000_catalog_v2_offer_codes. Redefines no existing function.
--
-- The window is the calendar month, UTC. The schema records no subscription period boundary
-- (Paddle sends one and nothing stores it; 20260911130000's header says the same), so there is no
-- subscription period to use.
--
-- Two calls per query, both from the server:
--   admit_foundation_knowledge_query(workspace, limit) runs BEFORE retrieval. Under the window row's
--     lock it compares used units plus live holds with the limit, and either refuses ('exhausted')
--     or records a hold and returns its id. A null limit never refuses (legacy plans, owner grants
--     and the free evaluation are counted, never capped -- catalog-v2.md §4, CAT-D8).
--   settle_foundation_knowledge_query(hold, answered) runs AFTER the response is known. It deletes
--     the hold; only an answered hold adds a unit. A failure, a refusal or a timeout never settles as
--     answered, so it is never counted. A second settle of the same hold changes nothing.
--
-- Why holds and not the counter itself at admission: counting at admission would count failures;
-- counting only at settlement lets every request admitted at limit-1 through. A hold reserves the
-- unit without counting it, and a hold whose request died (a killed function, a timeout) stops
-- reserving after five minutes and is never counted.
-- ponytail: a dead request's hold reserves its unit for up to five minutes; only a workspace at its
-- allowance can notice. Shorten the TTL if the routes' maxDuration ever drops well below it.
--
-- The limit is the caller's: the server reads it from the catalog (`included.kqu` for the account's
-- plan_code). This file holds no plan table.
--
-- Both tables: RLS on, a restrictive deny-all policy, no grant to any role. Both functions:
-- security definer, search_path '', execute for service_role only.
begin;

create table public.foundation_knowledge_query_windows (
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  window_started_at timestamptz not null,
  used_units integer not null default 0 check (used_units >= 0),
  primary key (workspace_key, window_started_at)
);

create table public.foundation_knowledge_query_holds (
  hold_id uuid primary key default gen_random_uuid(),
  workspace_key text not null,
  window_started_at timestamptz not null,
  expires_at timestamptz not null,
  foreign key (workspace_key, window_started_at)
    references public.foundation_knowledge_query_windows (workspace_key, window_started_at) on delete cascade
);
create index foundation_knowledge_query_holds_window_idx
  on public.foundation_knowledge_query_holds (workspace_key, window_started_at, expires_at);

alter table public.foundation_knowledge_query_windows enable row level security;
alter table public.foundation_knowledge_query_holds enable row level security;
revoke all on public.foundation_knowledge_query_windows, public.foundation_knowledge_query_holds
  from public, anon, authenticated, service_role;
create policy foundation_knowledge_query_windows_no_client_access on public.foundation_knowledge_query_windows
  as restrictive for all to anon, authenticated using (false) with check (false);
create policy foundation_knowledge_query_holds_no_client_access on public.foundation_knowledge_query_holds
  as restrictive for all to anon, authenticated using (false) with check (false);

create function public.admit_foundation_knowledge_query(p_workspace_key text, p_limit integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_window timestamptz := pg_catalog.date_trunc('month', v_now, 'UTC');
  v_used integer;
  v_held integer;
  v_hold uuid;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or (p_limit is not null and p_limit < 1) then
    raise exception 'knowledge_query_meter_contract_invalid';
  end if;

  insert into public.foundation_knowledge_query_windows (workspace_key, window_started_at)
    values (p_workspace_key, v_window)
    on conflict do nothing;
  -- The lock every admission and settlement of this window queues on.
  select used_units into v_used from public.foundation_knowledge_query_windows
    where workspace_key = p_workspace_key and window_started_at = v_window
    for update;

  -- Holds no settlement will ever claim (expired a day ago) are dropped; they never counted.
  delete from public.foundation_knowledge_query_holds
    where workspace_key = p_workspace_key and expires_at < v_now - interval '1 day';
  select pg_catalog.count(*)::integer into v_held from public.foundation_knowledge_query_holds
    where workspace_key = p_workspace_key and window_started_at = v_window and expires_at > v_now;

  if p_limit is not null and v_used + v_held >= p_limit then
    return pg_catalog.jsonb_build_object('status', 'exhausted');
  end if;

  insert into public.foundation_knowledge_query_holds (workspace_key, window_started_at, expires_at)
    values (p_workspace_key, v_window, v_now + interval '5 minutes')
    returning hold_id into v_hold;
  return pg_catalog.jsonb_build_object('status', 'admitted', 'hold_id', v_hold);
end;
$$;

create function public.settle_foundation_knowledge_query(p_hold_id uuid, p_answered boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_workspace text;
  v_window timestamptz;
begin
  if p_hold_id is null or p_answered is null then
    raise exception 'knowledge_query_meter_contract_invalid';
  end if;
  -- The window row first, the lock order admission takes, so a settle never waits on a hold row
  -- while an admission of the same window holds the window and waits on it.
  select h.workspace_key, h.window_started_at into v_workspace, v_window
    from public.foundation_knowledge_query_holds h where h.hold_id = p_hold_id;
  if not found then return false; end if;
  perform 1 from public.foundation_knowledge_query_windows
    where workspace_key = v_workspace and window_started_at = v_window
    for update;
  delete from public.foundation_knowledge_query_holds where hold_id = p_hold_id;
  if not found then return false; end if;
  if p_answered then
    update public.foundation_knowledge_query_windows set used_units = used_units + 1
      where workspace_key = v_workspace and window_started_at = v_window;
  end if;
  return true;
end;
$$;

revoke all on function public.admit_foundation_knowledge_query(text, integer) from public, anon, authenticated, service_role;
revoke all on function public.settle_foundation_knowledge_query(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.admit_foundation_knowledge_query(text, integer) to service_role;
grant execute on function public.settle_foundation_knowledge_query(uuid, boolean) to service_role;

commit;
