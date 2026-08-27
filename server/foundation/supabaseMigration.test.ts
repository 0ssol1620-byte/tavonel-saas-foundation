import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(process.cwd(), "supabase/migrations/0001_tavonel_tenant_foundation.sql");
const migration = readFileSync(migrationPath, "utf8");

describe("Supabase tenant migration contract", () => {
  it("provisions profiles and a personal workspace from auth.users", () => {
    expect(migration).toContain("references auth.users(id)");
    expect(migration).toContain("function public.handle_new_auth_user()");
    expect(migration).toContain("after insert on auth.users");
  });

  it("enables RLS and withholds browser writes from billing and document state", () => {
    for (const table of [
      "profiles",
      "workspaces",
      "workspace_memberships",
      "workspace_entitlements",
      "documents",
      "sanitization_proofs",
      "knowledge_graph_candidates",
      "billing_events",
    ]) {
      expect(migration).toContain(`alter table public.${table} enable row level security;`);
    }
    expect(migration).toContain("revoke all on all tables in schema public from anon, authenticated;");
    expect(migration).not.toContain("grant insert on public.documents to authenticated");
    expect(migration).not.toContain("grant update on public.workspace_entitlements to authenticated");
  });
});
