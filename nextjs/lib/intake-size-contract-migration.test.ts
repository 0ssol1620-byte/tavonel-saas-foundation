import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(import.meta.dirname, "../../supabase/migrations/0048_intake_size_and_experience_contract.sql"),
  "utf8",
).toLowerCase();

describe("real-document intake size contract", () => {
  it("allows practical paid/owner files while bounding free evaluation", () => {
    expect(migration).toContain("p_requested_bytes > 262144000");
    expect(migration).toContain("foundation_intake_file_too_large");
    expect(migration).toContain("p_requested_bytes > 52428800");
    expect(migration).toContain("foundation_trial_file_too_large");
  });

  it("keeps transfer velocity and privilege boundaries server-side", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("v_minute_byte_limit");
    expect(migration).toContain("v_day_byte_limit");
    expect(migration).toContain("revoke all on function public.reserve_foundation_intake_admission");
    expect(migration).toContain("grant execute on function public.reserve_foundation_intake_admission");
    expect(migration).toContain("to service_role");
  });
});
