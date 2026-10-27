-- D-05: a production release survives a deploy that does not touch the customer-data gate.
--
-- A production release row may now name the gate-surface digest of its revision
-- (nextjs/scripts/gate-surface.mjs: git blob ids of every tracked path except the presentational
-- ones in nextjs/scripts/gate-surface-rules.json, read from that same commit). Every reader then
-- treats the latest row naming the deployed SHA *or* the deployment's own surface digest as the
-- decision. Nothing here writes a release row: the founder still records every one, with the same
-- 12 (17) facts, the same digest validation and the same 30-day life from evaluated_at. A deploy
-- that changes any gate-surface path has a different digest and inherits nothing.
--
-- The guard trigger keeps its name and its two existing refusals, and adds what spanning revisions
-- needs:
--   * a scope-wide advisory lock before the (scope, revision) one, so decision order is total across
--     every revision a surface release covers;
--   * a production refusal that names no digest takes the digest of its revision's latest
--     digest-bearing row, so refusing a revision also refuses the surface it released;
--   * a production refusal that still has no digest is refused while an allowed, unexpired surface
--     release newer than every row of its revision exists in the scope: that revision may be reading
--     the surface release, and closing only its own SHA would let the next equal-surface deploy (or a
--     rollback to the released SHA) reopen it. The refusal names the deployment's digest instead
--     (refusal_requires_surface);
--   * no qualification while an allowed, unexpired surface release exists for the scope: a
--     qualification is the latest row for its SHA, so over an inherited release it would close every
--     other workspace (the 20260930070000 rationale, across revisions);
--   * statements that read before inserting run only under READ COMMITTED, as before.
--
-- Additive: existing rows have no digest and behave exactly as before; production receipt digests
-- without a surface are byte-identical. Code before this migration never selects the column. Code
-- after it selects the column, so this migration is applied before that code is deployed
-- (docs/runbooks/RELEASE_ORDER.md).
begin;

alter table public.customer_data_release_decisions
  add column gate_surface_sha256 text check (gate_surface_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  add constraint scoped_release_surface_production_only check (
    gate_surface_sha256 is null or stage = 'production'
  );

create index customer_data_release_decisions_surface_idx
  on public.customer_data_release_decisions (scope, gate_surface_sha256, recorded_at desc, allowed asc)
  where gate_surface_sha256 is not null;

create or replace function public.guard_customer_data_release_stage()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Scope first, then (scope, revision): every writer takes them in the same order.
  perform pg_advisory_xact_lock(hashtextextended('customer_data_release_decisions:' || new.scope, 0));
  perform pg_advisory_xact_lock(
    hashtextextended('customer_data_release_decisions:' || new.scope || ':' || new.release_revision, 0));
  -- Decision order is acquisition order, not transaction start time or caller-supplied history.
  new.recorded_at := clock_timestamp();
  if new.stage = 'qualification'
    or (new.stage = 'production' and not new.allowed and new.gate_surface_sha256 is null) then
    if current_setting('transaction_isolation') <> 'read committed' then
      raise exception 'qualification_requires_read_committed';
    end if;
  end if;
  if new.stage = 'production' and not new.allowed and new.gate_surface_sha256 is null then
    select d.gate_surface_sha256 into new.gate_surface_sha256
      from public.customer_data_release_decisions d
     where d.scope = new.scope and d.release_revision = new.release_revision
       and d.gate_surface_sha256 is not null
     order by d.recorded_at desc
     limit 1;
    if new.gate_surface_sha256 is null and exists (
      select 1 from public.customer_data_release_decisions r
       where r.scope = new.scope and r.stage = 'production' and r.allowed and r.gate_surface_sha256 is not null
         and r.evaluated_at > clock_timestamp() - interval '30 days'
         and r.recorded_at > coalesce((
           select max(o.recorded_at) from public.customer_data_release_decisions o
            where o.scope = new.scope and o.release_revision = new.release_revision), '-infinity')
    ) then
      raise exception 'refusal_requires_surface'
        using hint = 'set gate_surface_sha256 to the digest release-gate-check reports for this SHA';
    end if;
  end if;
  if new.stage = 'qualification' then
    if exists (
      select 1 from public.customer_data_release_decisions
       where scope = new.scope and release_revision = new.release_revision
         and stage = 'production' and allowed
    ) then
      raise exception 'qualification_after_release';
    end if;
    if exists (
      select 1 from public.customer_data_release_decisions
       where scope = new.scope and stage = 'production' and allowed and gate_surface_sha256 is not null
         and evaluated_at > clock_timestamp() - interval '30 days'
    ) then
      raise exception 'qualification_over_surface_release';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_customer_data_release_stage() from public, anon, authenticated, service_role;

commit;
