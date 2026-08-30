import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "../supabase/migrations/0016_oauth_secret_vault.sql"), "utf8");

describe("OAuth secret vault migration", () => {
  it("keeps envelopes service-role-only and immutable", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("grant select, insert, delete");
    expect(migration).toContain("before update");
    expect(migration).not.toContain("grant update");
  });
});
