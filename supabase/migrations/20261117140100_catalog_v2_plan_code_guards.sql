-- Catalog v2: two database guards on plan identity (WO-CAT-3B, after WO-CAT-3's review).
--
-- 1. foundation_billing_accounts_plan_code_check (20261117140000) let a row hold a plan_code with no
--    access_plan: `foundation_offer_access_plan(plan_code) = access_plan` is null when access_plan is
--    null, and a check passes on null. Such a row names a plan bought with no entitlement level, which
--    the site's resolver (nextjs/lib/checkout-policy.ts `heldOffer`) refuses. The check now refuses it
--    too, so the database and every reader accept the same rows. No writer produces that row: the only
--    writers of access_plan (0005's base as replaced in 20261117140000, and v3's replacement) always
--    set a level, so the constraint validates on existing data; if it does not, the migration fails
--    rather than keeping the row.
-- 2. apply_foundation_billing_event_v3 loses EXECUTE for service_role (granted in 0010, again in 0011).
--    No runtime caller uses it directly: the site calls only apply_foundation_billing_event_v6 over
--    PostgREST (nextjs/lib/billing-store.ts; the WO-CAT-3B receipt carries the grep over nextjs/ and
--    supabase/), and v4 reaches v3 as a security-definer call by the function owner, which this does
--    not touch. v4 and v5 are already closed to the service role; v6 stays its one entry point.
--
-- No function body changes; nothing becomes purchasable.
-- Rollback: supabase/drafts/rollback-20261117140100-catalog-v2-plan-code-guards.sql.
begin;

alter table public.foundation_billing_accounts
  drop constraint foundation_billing_accounts_plan_code_check,
  add constraint foundation_billing_accounts_plan_code_check check (
    plan_code is null
    or (access_plan is not null
      and public.foundation_offer_access_plan(plan_code) <> plan_code
      and public.foundation_offer_access_plan(plan_code) = access_plan)
  );

revoke execute on function public.apply_foundation_billing_event_v3(
  text, text, timestamptz, text, text, text, uuid, text, text, text, text, text, integer, text
) from service_role;

commit;
