import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(
  process.cwd(),
  "../supabase/migrations/20260927120000_checkout_intent_reconciliation.sql",
), "utf8");

describe("checkout intent reconciliation migration", () => {
  it("keeps intents and rejections unreadable except through service-role definer RPCs", () => {
    for (const table of ["foundation_checkout_intents", "foundation_billing_event_rejections"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`revoke all on public.${table} from public, anon, authenticated, service_role`);
    }
    expect(sql.match(/security definer\nset search_path = public, pg_temp/g)).toHaveLength(3);
    expect(sql).toMatch(/grant execute on function public\.issue_foundation_checkout_intent\([\s\S]+?to service_role/);
    expect(sql).toMatch(/grant execute on function public\.apply_foundation_billing_event_v6\([\s\S]+?to service_role/);
    expect(sql).toMatch(/grant execute on function public\.quarantine_foundation_billing_envelope\([\s\S]+?to service_role/);
    expect(sql).toMatch(/revoke all on function public\.reject_foundation_billing_event\([\s\S]+?from public, anon, authenticated, service_role/);
    expect(sql).toMatch(/revoke execute on function public\.apply_foundation_billing_event_v5\([\s\S]+?from service_role/);
  });

  it("settles from the recorded snapshot instead of the live gate", () => {
    expect(sql).not.toMatch(/p_bootstrap_allowed|p_binding_fresh/);
    expect(sql).toContain("reason := 'checkout_intent_missing'");
    expect(sql).toContain("reason := 'checkout_intent_expired'");
    expect(sql).toMatch(/elsif snapshot_price is not null and p_price_id = snapshot_price then\s+credit := snapshot_credit;/);
    expect(sql).toMatch(/nonce, workspace_key[\s\S]+price_id, credit_delta\s+\) values[\s\S]+snapshot_price, snapshot_credit/);
  });

  it("accepts a verified paid subscription before the completed transaction arrives", () => {
    expect(sql).toContain("'purchase', 'allowance', 'subscription', 'legacy'");
    expect(sql).toContain("p_event_type in ('subscription.created', 'subscription.activated')");
    expect(sql).toContain("p_subscription_status in ('active', 'trialing')");
  });

  it("refuses billing-exempt owners at issuance and application, and records every refusal", () => {
    expect(sql.match(/reason', 'checkout_account_billing_exempt'|reason := 'checkout_account_billing_exempt'/g)).toHaveLength(2);
    expect(sql).toMatch(/if reason is not null then\s+return public\.reject_foundation_billing_event\(/);
    expect(sql).toContain("on conflict (event_id) do nothing");
  });
});
