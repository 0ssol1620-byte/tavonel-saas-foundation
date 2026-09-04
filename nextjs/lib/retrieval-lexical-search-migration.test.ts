import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(import.meta.dirname, "../../supabase/migrations/0022_retrieval_lexical_search.sql"),
  "utf8",
);

/*
  What this file can and cannot establish.

  Until 2026-09-04 every assertion here passed against a migration that could not be applied to
  any PostgreSQL: the generated column was built from array_to_string, which is STABLE, and a
  stored generated column requires an immutable expression. A test that reads SQL as text cannot
  see that -- only running it can, which is what scripts/db/apply-migrations.mjs now does.

  So these assertions are about intent that survives an edit, not about correctness. The
  correctness evidence for this migration is the chain applying to a real server.

  `statements` exists because the header comment quotes the rejected expression verbatim, so a
  substring search over the whole file finds it in the prose. Assertions about what the migration
  *does* read this; assertions about what it says would read `migration`.
*/
const statements = migration
  .split(/\r?\n/)
  .filter(line => !line.trimStart().startsWith("--"))
  .join("\n");

describe("retrieval lexical search migration", () => {
  it("adds a bounded search_tokens array column", () => {
    expect(statements).toContain("add column search_tokens text[] not null default '{}'");
    expect(statements).toContain("cardinality(search_tokens) <= 5000");
  });

  it("derives the tsvector from search_tokens (the pre-tokenized array), not from raw text", () => {
    expect(statements).toContain("generated always as (public.foundation_lexical_tsvector(search_tokens)) stored");
    expect(statements).toContain("pg_catalog.array_to_string(p_tokens, ' ')");
  });

  it("declares the tsvector wrapper immutable, which is what makes the column creatable", () => {
    const wrapper = statements.slice(statements.indexOf("create or replace function public.foundation_lexical_tsvector"));
    expect(wrapper).toMatch(/returns tsvector\s+language sql\s+immutable/);
  });

  it("does not inline array_to_string into the generated column", () => {
    /*
      The exact expression the server rejected. Reintroducing it makes the migration
      un-appliable again, and every other assertion in this file would still pass.
    */
    expect(statements).not.toContain("generated always as (to_tsvector('simple', array_to_string(search_tokens, ' '))) stored");
  });

  it("keeps a positional tsvector, because lexical-search.ts ranks with ts_rank_cd", () => {
    /*
      array_to_tsvector(text[]) is immutable and would need no wrapper, but it produces lexemes
      without positions, and cover-density ranking over a positionless vector is a constant.
    */
    expect(statements).not.toContain("array_to_tsvector(search_tokens)");
    expect(statements).toContain("pg_catalog.to_tsvector('simple'::pg_catalog.regconfig");
  });

  it("indexes the generated tsvector with a GIN index for FTS query performance", () => {
    expect(statements).toContain("create index foundation_retrieval_units_search_vector_idx");
    expect(statements).toMatch(/using gin \(search_vector\)/);
  });
});
