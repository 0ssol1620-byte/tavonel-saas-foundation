import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(import.meta.dirname, "../../supabase/migrations/0047_trial_source_digest_guard.sql"),
  "utf8",
).toLowerCase();

describe("trial source digest abuse guard", () => {
  it("stores only a keyed content signal and never raw source hashes", () => {
    expect(migration).toContain("foundation_trial_source_digests");
    expect(migration).toContain("content_hmac text not null");
    expect(migration).toContain("hmac256:");
    expect(migration).not.toContain("content_sha256 text");
    expect(migration).not.toContain("raw_sha");
  });

  it("serializes exact-source claims and reviews reuse by a different trial user", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("count(distinct user_id)");
    expect(migration).toContain("user_id <> p_user_id");
    expect(migration).toContain("exact_source_reused_across_trials");
    expect(migration).toContain("trial_source_review_required");
  });

  it("keeps owner and paid accounts out of the free-source ledger", () => {
    expect(migration).toContain("trial_exempt = true");
    expect(migration).toContain("subscription_status in ('active', 'trialing')");
    expect(migration).toContain("'source', 'owner'");
    expect(migration).toContain("'source', 'paid'");
  });

  it("starts with a bounded global free-compute circuit breaker", () => {
    expect(migration).toContain("daily_standard_unit_limit = least(daily_standard_unit_limit, 1000)");
  });

  it("keeps the assessment RPC service-role only", () => {
    expect(migration).toContain("revoke all on function public.assess_foundation_trial_source_digest");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
  });
});
