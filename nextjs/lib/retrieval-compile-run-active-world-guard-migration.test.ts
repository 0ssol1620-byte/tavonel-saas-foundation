import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(import.meta.dirname, "../../supabase/migrations/0021_retrieval_compile_run_active_world_guard.sql"),
  "utf8",
);

describe("retrieval compile run active-world guard migration", () => {
  it("gates compile-run creation on the referenced world being currently active", () => {
    expect(migration).toContain("before insert on public.foundation_retrieval_compile_runs");
    expect(migration).toContain("lifecycle_status = 'active'");
    expect(migration).toContain("raise exception 'retrieval_compile_run_requires_active_world';");
  });

  it("only gates creation (a trigger), not an ongoing constraint that would invalidate history", () => {
    // A CHECK constraint referencing another table's current state is not valid Postgres
    // and would be semantically wrong here anyway: an existing compile run must remain a
    // valid historical record after its world is later superseded by a new promotion.
    expect(migration).not.toMatch(/^\s*check\s*\(/im);
    expect(migration).toContain("returns trigger");
  });
});
