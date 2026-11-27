-- WO-SINGLE-USER-2 (fix A of receipts/WO-SINGLE-USER-1/REPORT.md): a Free workspace has one seat.
--
-- DRAFT. Not applied by its author; the lead dispatches the hosted DB rehearsal (supabase/tests/workspace_seat_allowance.sql
-- is the proof) before this reaches any project. Ordering: 20261127100000, after 20261124000200.
--
-- Until now foundation_workspace_seat_limit returned null (uncapped) for every workspace the plan lookup did not cap:
-- a Free workspace (no billing account), a legacy plan holder (plan_code null) and an operator-granted account.
-- A Free owner could therefore invite an admin who reads every source. This file closes the first of the three and
-- leaves the other two exactly as 20261117160000 had them:
--
--   foundation_workspace_capped_plan(ws) not null   the plan's seat limit from the server's map     (unchanged)
--   capped_plan null, a billing account exists      uncapped: legacy plan_code null, or the account's  (unchanged)
--                                                   user holds an active operator grant
--   capped_plan null, NO billing account:
--       an active owner holds an active operator   uncapped                                          (unchanged)
--         grant (the founder's workspace)
--       otherwise                                   1 seat (the owner)                                (NEW)
--
-- foundation_workspace_capped_plan is not touched: the query and storage meters share it. The Free limit is a constant
-- here, not an entry of the catalog map the server sends (Free is not a catalog plan), so nothing changes in
-- nextjs/lib/workspace-membership.ts. A workspace already over one seat keeps every member; it only cannot add one
-- (the same rule 20261117150200 states for an over-limit plan).
-- Not covered, by design: a billing account with access_plan and plan_code both null (credits only) still counts as
-- an account and stays uncapped, as the work order said "no billing row".
--
-- Expand-type and idempotent: create or replace on the existing signature, no table or grant change; the
-- revoke below restates the grant state 20261117150200 set (service_role does not execute it; callers are the two
-- security-definer invite functions).
-- Rollback: re-run the function body of 20261117160000_catalog_v2_meter_closure.sql (its sha256 as the migration
-- redefinition guard normalises it is the predecessor-hash below).
-- predecessor-hash: public.foundation_workspace_seat_limit 4c136b6acf354013e2c6b28d562e9f2798766edcbea0983a18374a478f457467
-- predecessor: public.foundation_workspace_seat_limit 20261117160000
begin;

create or replace function public.foundation_workspace_seat_limit(p_workspace_key text, p_seat_limits jsonb)
returns integer
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_plan text;
  v_limit jsonb;
begin
  v_plan := public.foundation_workspace_capped_plan(p_workspace_key);
  if v_plan is null then
    -- A billing account that does not cap (a legacy plan, or its user holds an operator grant): uncapped, as before.
    if exists (select 1 from public.foundation_billing_accounts a where a.workspace_key = p_workspace_key) then
      return null;
    end if;
    -- No billing account. An operator-granted owner (the founder's workspace) stays uncapped, as before.
    if exists (
      select 1 from public.foundation_workspace_members m
        join public.foundation_account_access_grants g on g.user_id = m.user_id and g.active
       where m.workspace_key = p_workspace_key and m.role = 'owner' and m.state = 'active'
    ) then
      return null;
    end if;
    -- A Free workspace: the owner is the one seat.
    return 1;
  end if;
  -- Nested, not one OR: SQL does not promise to skip the cast of a non-number.
  if jsonb_typeof(p_seat_limits) = 'object' and jsonb_typeof(p_seat_limits -> v_plan) = 'number' then
    v_limit := p_seat_limits -> v_plan;
    if v_limit::numeric = trunc(v_limit::numeric) and v_limit::numeric between 1 and 100000 then
      return v_limit::integer;
    end if;
  end if;
  raise exception 'workspace_seat_limit_unavailable';
end;
$$;

revoke all on function public.foundation_workspace_seat_limit(text, jsonb)
  from public, anon, authenticated, service_role;

commit;
