import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/0003_harden_rls_function_exposure.sql"),
  "utf8",
);

describe("Supabase security hardening migration", () => {
  it("removes public SECURITY DEFINER execution while retaining policy-only private helpers", () => {
    expect(migration).toContain("create schema if not exists private;");
    expect(migration).toContain("revoke all on function public.handle_new_auth_user() from public, anon, authenticated;");
    expect(migration).toContain("revoke all on function private.is_workspace_member(uuid) from public, anon, authenticated;");
    expect(migration).toContain("grant execute on function private.is_workspace_member(uuid) to authenticated;");
    expect(migration).toContain("private.is_workspace_member(workspace_id)");
  });

  it("expresses an explicit default-deny policy for the internal billing event ledger", () => {
    expect(migration).toContain("create policy billing_events_no_client_access on public.billing_events");
    expect(migration).toContain("as restrictive for all to anon, authenticated using (false) with check (false);");
  });
});
