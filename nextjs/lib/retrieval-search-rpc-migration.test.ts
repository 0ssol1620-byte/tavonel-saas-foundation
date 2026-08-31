import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(import.meta.dirname, "../../supabase/migrations/0023_retrieval_search_rpc.sql"),
  "utf8",
);

describe("retrieval search RPC migration", () => {
  it("exposes exactly the two search queries the app cannot otherwise execute", () => {
    expect(migration).toContain("create or replace function public.search_foundation_retrieval_units_lexical");
    expect(migration).toContain("create or replace function public.search_foundation_retrieval_units_dense");
    // No other function should ride along in a migration whose whole purpose is to add a
    // narrow SQL execution path -- a general-purpose "run this SQL" RPC would hand the
    // application arbitrary database access it deliberately does not have today.
    expect(migration.match(/create or replace function/g)?.length).toBe(2);
    expect(migration).not.toMatch(/execute\s+(p_sql|sql|query)\b/i);
  });

  it("keeps the same security posture as the 0021 trigger function", () => {
    // Anchored to line start so the header comment's prose mention of the posture is not
    // counted as if it were a declaration.
    expect(migration.match(/^security definer$/gm)?.length).toBe(2);
    expect(migration.match(/^set search_path = ''$/gm)?.length).toBe(2);
  });

  it("grants execute to service_role only, never to anon/authenticated/public", () => {
    expect(migration.match(/revoke all on function/g)?.length).toBe(2);
    expect(migration.match(/from public, anon, authenticated;/g)?.length).toBe(2);
    expect(migration.match(/to service_role;/g)?.length).toBe(2);
    expect(migration).not.toMatch(/grant execute .* to (authenticated|anon|public);/);
  });

  it("requires an explicit workspace_key on both functions so a caller cannot read across tenants", () => {
    expect(migration).toContain("p_workspace_key text");
    expect(migration).toContain("retrieval_lexical_search_requires_scope");
    expect(migration).toContain("retrieval_dense_search_requires_scope");
    expect(migration).toMatch(/where u\.workspace_key = p_workspace_key/);
    expect(migration).toMatch(/where fe\.workspace_key = p_workspace_key/);
  });

  it("re-sanitizes lexical tokens in the database rather than trusting the caller", () => {
    // lexical-search.ts filters with SAFE_TOKEN, but the database is the trust boundary and
    // must not depend on the application having done so.
    expect(migration).toContain("quote_literal(token)");
    expect(migration).toContain("retrieval_lexical_search_requires_safe_token");
  });

  it("mirrors buildLexicalSearchQuery's ranking and tie-break exactly", () => {
    expect(migration).toContain("ts_rank_cd(u.search_vector, to_tsquery('simple', v_tsquery))");
    expect(migration).toContain("order by rank desc, u.unit_id asc");
  });

  it("fails closed on an embedding-space mismatch instead of computing a meaningless distance", () => {
    expect(migration).toContain("retrieval_dense_search_dimension_mismatch");
    expect(migration).toContain("v_stored_dimension <> v_dimension");
  });

  it("returns empty (not an error) when a profile has no embeddings compiled yet", () => {
    // Degrading to lexical/structure is correct here; failing the whole request is not.
    expect(migration).toContain("if v_stored_dimension is null then");
  });

  it("covers all three pgvector metrics with best-match-first ordering", () => {
    expect(migration).toContain("fe.embedding <=> v_query");
    expect(migration).toContain("fe.embedding <-> v_query");
    expect(migration).toContain("fe.embedding <#> v_query");
    expect(migration.match(/order by distance asc, fe\.unit_id asc/g)?.length).toBe(3);
    expect(migration).toContain("retrieval_dense_search_unknown_metric");
  });

  it("bounds the result limit on both paths so a caller cannot request an unbounded scan", () => {
    expect(migration.match(/p_limit < 1 or p_limit > 500/g)?.length).toBe(2);
  });

  it("scopes both searches to a single compile run so superseded units cannot leak in", () => {
    expect(migration).toContain("u.compile_run_id = p_compile_run_id");
    expect(migration).toContain("fu.compile_run_id = p_compile_run_id");
  });
});
