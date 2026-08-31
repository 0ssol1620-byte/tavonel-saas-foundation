import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(import.meta.dirname, "../../supabase/migrations/0022_retrieval_lexical_search.sql"),
  "utf8",
);

describe("retrieval lexical search migration", () => {
  it("adds a bounded search_tokens array column", () => {
    expect(migration).toContain("add column search_tokens text[] not null default '{}'");
    expect(migration).toContain("cardinality(search_tokens) <= 5000");
  });

  it("derives the tsvector from search_tokens (the pre-tokenized array), not from raw text", () => {
    expect(migration).toContain("generated always as (to_tsvector('simple', array_to_string(search_tokens, ' '))) stored");
  });

  it("indexes the generated tsvector with a GIN index for FTS query performance", () => {
    expect(migration).toContain("create index foundation_retrieval_units_search_vector_idx");
    expect(migration).toMatch(/using gin \(search_vector\)/);
  });
});
