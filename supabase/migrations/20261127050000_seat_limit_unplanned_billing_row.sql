-- WO-SEAT-RACE-1: a billing account that no plan was ever projected into has one seat, not unlimited.
--
-- DRAFT. Not applied by its author; the lead dispatches the hosted DB rehearsal (supabase/tests/workspace_seat_webhook_order.sql
-- and workspace_seat_allowance.sql are the proof) before this reaches any project. Ordering: 20261127050000, after
-- 20261127020000.
--
-- The hole (receipts/WO-E2-SALE-1/REPORT.md §5 item 3, proven by workspace_seat_webhook_order.sql on 20261127020000):
-- Paddle does not order its webhooks. transaction.completed reaches apply_foundation_billing_event_v4's allowance branch,
-- which inserts the workspace's billing account with access_plan and plan_code both null; only a projected subscription event
-- (apply_foundation_billing_event's subscription branch, or v3's replacement) sets them. Until it lands -- seconds normally,
-- for good when the subscription event is refused or quarantined -- 20261127020000 read "a billing account exists" as a
-- legacy plan and returned null (uncapped): a new Personal buyer could invite and admit members.
--
-- What tells a legacy plan from a half-built purchase, from the code: access_plan. It has exactly two writers, both the
-- subscription projection, and both always write a level (observer_access / studio_access; 20261117140000,
-- 20261117140100 forbids a plan code without one); nothing ever writes it back to null. So for an account row:
--
--   access_plan set, plan_code set       a v2 plan: its limit, or uncapped when the account's holder has an
--                                        operator grant (foundation_workspace_capped_plan)                   (unchanged)
--   access_plan set, plan_code null      a retired 2026-09 plan (legacy): uncapped                           (unchanged)
--   access_plan null (so plan_code null) no plan was ever projected. Read as Free, the rule 20261127020000 gave a
--                                        workspace with no billing account at all:
--       an active owner holds an active operator grant (the founder's workspace)  uncapped                 (unchanged)
--       otherwise                                                                 1 seat, the owner        (NEW)
--   The one narrowing besides the NEW row: an account with no plan level whose holder has an operator grant but is
--   not an active owner was uncapped and is now one seat. The checkout binds the account to the workspace owner
--   (billing_workspace_owner_mismatch), so no such row is expected; it fails closed if one exists.
--
-- The last row covers the allowance-first window, a subscription event that never projects, and a credit-pack-only account
-- (the retired 0005 purchase branch: credits, no plan). The last one is Free with credits: no plan it bought ever had seats.
-- Every other row class answers exactly as before. A workspace already over one seat keeps every member; it only cannot add
-- one or accept an earlier-pending invite (the rule 20261117150200 states for an over-limit plan). Nothing is backfilled:
-- once the subscription event projects, the plan's own limit applies.
--
-- foundation_workspace_capped_plan is not touched: the query and storage meters share it, and the same window leaves those two
-- uncapped too (not in this work order; see receipts/WO-SEAT-RACE-1/NOTES.md).
--
-- Expand-type and idempotent: create or replace on the existing signature, no table or grant change; the revoke restates the
-- grant state 20261117150200 set (callers are the two security-definer invite functions).
-- Rollback: supabase/drafts/rollback-20261127050000-seat-limit-unplanned-billing-row.sql.
-- predecessor-hash: public.foundation_workspace_seat_limit f86f04d897b2d346e9e85a4ffe9cfe8128aac1f5553989c4897e450d96fa4ec4
-- predecessor: public.foundation_workspace_seat_limit 20261127020000
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
    -- A billing account holding a plan level: a legacy plan (no plan code), or a plan whose holder has an operator grant.
    if exists (
      select 1 from public.foundation_billing_accounts a
       where a.workspace_key = p_workspace_key and a.access_plan is not null
    ) then
      return null;
    end if;
    -- An operator-granted owner (the founder's workspace) stays uncapped.
    if exists (
      select 1 from public.foundation_workspace_members m
        join public.foundation_account_access_grants g on g.user_id = m.user_id and g.active
       where m.workspace_key = p_workspace_key and m.role = 'owner' and m.state = 'active'
    ) then
      return null;
    end if;
    -- No plan: Free, or a billing account no plan was ever projected into. The owner is the one seat.
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
