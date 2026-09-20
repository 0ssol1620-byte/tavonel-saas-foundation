import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(
  process.cwd(),
  "../supabase/migrations/20260921100000_checkout_binding_consumption.sql",
), "utf8");

describe("checkout binding consumption migration", () => {
  it("keeps nonce consumption behind a service-role-only fixed-search-path RPC", () => {
    expect(sql).toContain("create table public.foundation_checkout_binding_consumptions");
    expect(sql).toContain("nonce uuid primary key");
    expect(sql).toContain("alter table public.foundation_checkout_binding_consumptions enable row level security");
    expect(sql).toContain("revoke all on public.foundation_checkout_binding_consumptions from public, anon, authenticated, service_role");
    expect(sql).toContain("security definer\nset search_path = public, pg_temp");
    expect(sql).toMatch(/revoke all on function public\.apply_foundation_billing_event_v5\([\s\S]+from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.apply_foundation_billing_event_v5\([\s\S]+to service_role/);
    expect(sql).toMatch(/revoke execute on function public\.apply_foundation_billing_event_v4\([\s\S]+from service_role/);
  });

  it("serializes first use and refuses stale, revoked, exempt, or rebound bootstrap state", () => {
    expect(sql).toContain("foundation-checkout-binding:");
    expect(sql).toContain("foundation-checkout-subscription:");
    expect(sql).toContain("lock table public.foundation_account_access_grants in share mode");
    expect(sql).toContain("if not p_binding_fresh then");
    expect(sql).toContain("if not p_bootstrap_allowed then");
    expect(sql).toContain("foundation_account_access_grants");
    expect(sql).toContain("checkout_account_billing_exempt");
    expect(sql).toContain("checkout_binding_reuse_conflict");
    expect(sql).toContain("checkout_subscription_reuse_conflict");
    expect(sql).toContain("create unique index foundation_checkout_binding_subscription_unique");
    expect(sql).toContain("if p_action not in ('purchase', 'allowance') then");
    expect(sql).toContain("checkout_binding_bootstrap_event_invalid");
    expect(sql).toContain("checkout_legacy_binding_unassociated");
  });

  it("lets an exact consumed customer/subscription continue through the existing idempotent projection", () => {
    expect(sql).toMatch(/if has_consumption then[\s\S]+consumed\.paddle_customer_id <> p_customer_id/);
    expect(sql).toMatch(/consumed\.paddle_subscription_id is distinct from p_subscription_id/);
    expect(sql).toMatch(/return public\.apply_foundation_billing_event_v4\([\s\S]+p_subscription_id/);
  });
});
