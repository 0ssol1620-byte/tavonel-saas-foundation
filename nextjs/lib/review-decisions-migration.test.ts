import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(import.meta.dirname, "../../supabase/migrations/0037_foundation_review_decisions.sql"), "utf8");

describe("human review decision ledger", () => {
  it("binds append-only decisions to tenant, World, evidence, source geometry, and actor", () => {
    for (const field of ["workspace_key", "collection_id", "manifest_digest", "evidence_id", "source_version_id", "page_number", "bbox_1000", "actor_user_id"]) {
      expect(migration).toContain(field);
    }
    expect(migration).toContain("action in ('accept', 'edit', 'reject')");
    expect(migration).toContain("revoke all on public.foundation_review_decisions from public, anon, authenticated");
    expect(migration).not.toMatch(/grant\s+(update|delete)/i);
  });
});
