import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(import.meta.dirname, "../../supabase/migrations/0014_enterprise_control_plane.sql"), "utf8");

describe("enterprise control-plane migration", () => {
  it("contains fail-closed RBAC, RLS and immutable audit enforcement", () => {
    expect(migration).toContain("enterprise_has_permission");
    expect(migration).toContain("else false");
    expect(migration.match(/enable row level security/g)?.length).toBe(8);
    expect(migration).toContain("enterprise_audit_immutable_before_change");
    expect(migration).toContain("before update or delete");
    expect(migration).toContain("apply_enterprise_identity_config");
    expect(migration).toContain("apply_enterprise_governance_policy");
  });

  it("stores provider references rather than provider secrets", () => {
    expect(migration).toContain("secret_reference");
    expect(migration).toContain("configuration::text !~*");
    expect(migration).toContain("status <> 'active'");
  });
});
