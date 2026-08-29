import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/0010_foundation_subscription_upgrade.sql"),
  "utf8",
).toLowerCase();

describe("Foundation subscription upgrade migration contract", () => {
  it("allows only a newer active Studio replacement of a canceling Observer subscription", () => {
    expect(migration).toContain("p_offer_code <> 'studio_access'");
    expect(migration).toContain("access_plan = 'observer_access'");
    expect(migration).toContain("subscription_cancel_at is not null");
    expect(migration).toContain("p_occurred_at >= last_subscription_event_at");
    expect(migration).toContain("paddle_customer_id = p_customer_id");
    expect(migration).toContain("user_id = p_user_id");
  });

  it("keeps event conflicts fail-closed and removes direct v2 service access", () => {
    expect(migration).toContain("foundation_billing_event_id_conflict");
    expect(migration).toContain("existing.payload_sha256 <> p_payload_sha256");
    expect(migration).toContain("revoke execute on function public.apply_foundation_billing_event_v2");
    expect(migration).toContain("grant execute on function public.apply_foundation_billing_event_v3");
  });
});
