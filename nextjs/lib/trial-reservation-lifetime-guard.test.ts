import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(import.meta.dirname, "../../supabase/migrations/0046_trial_reservation_lifetime_guard.sql"),
  "utf8",
).toLowerCase();

describe("trial reservation lifetime guard", () => {
  it("counts abandoned and expired capabilities against lifetime evaluation capacity", () => {
    expect(migration).toContain("when state = 'released' then 0");
    expect(migration).toContain("when state in ('settled', 'operator_review')");
    expect(migration).toContain("else reserved_credits");
    expect(migration).toContain("foundation_trial_page_limit_exceeded");
  });

  it("serializes on user identity and cannot be called by browser roles", () => {
    expect(migration).toContain("foundation-trial-compute-user:");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("revoke all on function public.guard_foundation_trial_compute_lifetime()");
    expect(migration).toContain("from public, anon, authenticated");
  });

  it("executes for every trial compute insert, independent of the application route", () => {
    expect(migration).toContain("before insert on public.foundation_compute_reservations");
    expect(migration).toContain("for each row execute function public.guard_foundation_trial_compute_lifetime()");
  });
});
