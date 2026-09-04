import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(import.meta.dirname, "../../supabase/migrations/0045_self_service_trial_and_owner_access.sql"),
  "utf8",
).toLowerCase();

describe("owner and self-service evaluation migration", () => {
  it("keeps owner access explicit and independent of Paddle billing rows", () => {
    expect(migration).toContain("foundation_account_access_grants");
    expect(migration).toContain("grant_kind in ('owner')");
    expect(migration).toContain("billing_exempt boolean not null default false");
    expect(migration).toContain("billing_source in ('paid', 'trial', 'owner')");
    expect(migration).toContain("reservation.billing_source in ('owner', 'trial')");
    expect(migration).toContain("'billingsource', 'owner'");
  });

  it("sets the free evaluation to 7 days, 3 files, 50 pages and one World", () => {
    expect(migration).toContain("values ('default', true, 7, 3, 50, 1, 5000, 30, 4)");
    expect(migration).toContain("foundation_trial_file_limit_exceeded");
    expect(migration).toContain("foundation_trial_page_limit_exceeded");
    expect(migration).toContain("foundation_trial_global_budget_exceeded");
  });

  it("stores only keyed digests for device/network abuse signals", () => {
    expect(migration).toContain("device_hash text not null");
    expect(migration).toContain("ip_prefix_hash text not null");
    expect(migration).toContain("hmac256:");
    expect(migration).not.toMatch(/\braw_ip\b|\bip_address\b|\bfingerprint_json\b/);
  });

  it("does not identify a user by IP alone", () => {
    expect(migration).toContain("fresh_account_ip_velocity");
    expect(migration).toContain("u.created_at >= v_now - interval '7 days'");
    expect(migration).toContain("count(distinct e.user_id)");
  });

  it("serializes risk and compute races and keeps all privilege-bearing RPCs service-role only", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("revoke all on function public.bootstrap_foundation_self_service_trial");
    expect(migration).toContain("revoke all on function public.reserve_foundation_compute_v3");
    expect(migration).toContain("revoke all on function public.settle_foundation_compute_v3");
    expect(migration).toContain("to service_role");
  });
});
