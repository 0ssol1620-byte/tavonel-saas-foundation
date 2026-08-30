import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/0015_enterprise_pilot_bootstrap.sql"),
  "utf8",
);

describe("enterprise pilot bootstrap migration", () => {
  it("derives identity and workspace server-side and remains service-role only", () => {
    expect(migration).toContain("bootstrap_enterprise_for_user(p_user_id uuid)");
    expect(migration).toContain("replace(p_user_id::text, '-', '')");
    expect(migration).toContain("revoke all on function public.bootstrap_enterprise_for_user(uuid)");
    expect(migration).toContain("to service_role");
    expect(migration).not.toContain("to authenticated");
  });

  it("is idempotent and records the bootstrap once", () => {
    expect(migration.match(/on conflict/gi)?.length).toBeGreaterThanOrEqual(4);
    expect(migration).toContain("organization.bootstrapped");
    expect(migration).toContain("if not exists");
    expect(migration).toContain("foundation_pilot");
  });
});
