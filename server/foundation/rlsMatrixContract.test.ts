import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const matrix = readFileSync(resolve(process.cwd(), "supabase/tests/tenant_rls_matrix.sql"), "utf8");

describe("Supabase RLS test matrix", () => {
  it("covers every browser-readable foundation relation with allow and cross-tenant denial assertions", () => {
    for (const relation of [
      "profiles",
      "workspaces",
      "workspace_memberships",
      "plans",
      "workspace_entitlements",
      "documents",
      "sanitization_proofs",
      "knowledge_graph_candidates",
      "paddle_customers",
      "paddle_subscriptions",
    ]) {
      expect(matrix).toContain(`public.${relation}`);
    }
    expect(matrix).toContain("cross-tenant document query is empty");
    expect(matrix).toContain("browser cannot insert documents");
    expect(matrix).toContain("browser cannot mutate entitlement");
  });
});
