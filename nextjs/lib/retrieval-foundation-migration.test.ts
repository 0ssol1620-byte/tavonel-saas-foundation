import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(import.meta.dirname, "../../supabase/migrations/0020_retrieval_foundation.sql"),
  "utf8",
);

describe("retrieval foundation migration", () => {
  it("creates the four derived retrieval tables with RLS and pgvector", () => {
    expect(migration).toContain("create extension if not exists vector;");
    for (const table of [
      "foundation_retrieval_profiles",
      "foundation_retrieval_compile_runs",
      "foundation_retrieval_units",
      "foundation_retrieval_embeddings",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
    }
    expect(migration.match(/enable row level security/g)?.length).toBe(4);
  });

  it("locks every retrieval table to service_role only, no direct client access", () => {
    expect(migration).toContain("revoke all on public.foundation_retrieval_profiles");
    expect(migration).toContain("from public, anon, authenticated;");
    expect(migration.match(/to service_role;/g)?.length).toBe(4);
    expect(migration).not.toMatch(/grant .* to (authenticated|anon|public);/);
  });

  it("binds every compile run to a promoted world version, not a raw candidate", () => {
    expect(migration).toContain(
      "references public.foundation_world_versions (workspace_key, collection_id, manifest_digest)",
    );
  });

  it("enforces the embedding/profile dimension compatibility guard at the schema level", () => {
    expect(migration).toContain("check (vector_dims(embedding) = dimension)");
    expect(migration).toContain("(embedding ->> 'dimension')::int between 1 and 8192");
  });

  it("cascades unit/embedding deletion so a compile run can be fully rebuilt", () => {
    expect(migration.match(/on delete cascade/g)?.length).toBe(2);
    // The world/profile bindings (and created_by) are `on delete restrict` — a world
    // version or profile cannot vanish out from under rows that still reference it.
    expect(migration.match(/on delete restrict/g)?.length).toBe(4);
  });

  it("pins fusion to RRF for v1 and requires a digest for reproducibility", () => {
    expect(migration).toContain("fusion ->> 'algorithm' = 'rrf'");
    expect(migration).toContain("profile_digest text not null check (profile_digest ~ '^sha256:[a-f0-9]{64}$')");
  });
});
