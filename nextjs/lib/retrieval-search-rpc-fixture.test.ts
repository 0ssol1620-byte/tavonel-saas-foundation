import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Static consistency checks for the pgTAP fixture in
// supabase/tests/foundation_retrieval_search_rpc.sql.
//
// This does NOT execute the fixture -- that needs `supabase db test` with a real Postgres,
// which is the remaining gate and is stated as such in the evidence document. What it does
// is catch the failure modes that would otherwise only surface after someone has stood up a
// database: a plan() count that disagrees with the number of assertions (pgTAP fails the
// whole file), an expected error string that no longer exists in the migration, or a fixture
// row that violates a schema CHECK. Those are cheap to catch here and expensive to catch
// there, so they are checked on every run.

const read = (path: string) => readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");
const fixture = read("supabase/tests/foundation_retrieval_search_rpc.sql");
const searchRpcMigration = read("supabase/migrations/0023_retrieval_search_rpc.sql");
const foundationMigration = read("supabase/migrations/0020_retrieval_foundation.sql");
const lifecycleMigration = read("supabase/migrations/0007_foundation_world_lifecycle.sql");

const ASSERTION = /^select (has_function|is|ok|throws_ok|has_column|has_index)\(/gm;

describe("retrieval search RPC pgTAP fixture", () => {
  it("declares a plan matching its actual assertion count", () => {
    // pgTAP fails the entire file when plan() disagrees with what ran, so a drifting count
    // silently invalidates every other assertion in it.
    const planned = Number(/select plan\((\d+)\)/.exec(fixture)?.[1]);
    const actual = fixture.match(ASSERTION)?.length ?? 0;
    expect(actual).toBeGreaterThan(0);
    expect(planned).toBe(actual);
  });

  it("only expects error strings the migration actually raises", () => {
    const expected = [...new Set(
      [...fixture.matchAll(/'(retrieval_(?:lexical|dense)_search_[a-z_]+)/g)].map((match) => match[1]),
    )];
    expect(expected.length).toBeGreaterThan(0);
    for (const message of expected) {
      expect(searchRpcMigration).toContain(message);
    }
  });

  it("exercises both tenants, so cross-tenant isolation is tested rather than assumed", () => {
    // The fixture plants a second tenant's unit that matches the same token and carries an
    // identical embedding. Without it, the isolation assertions would pass trivially.
    expect(fixture).toContain("pilot-searchrpc1");
    expect(fixture).toContain("pilot-searchrpc2");
    expect(fixture).toMatch(/never returns another tenant unit that matches the same token/);
    expect(fixture).toMatch(/never returns another tenant unit despite an identical embedding/);
  });

  it("uses workspace keys and ids that satisfy the schema's own CHECK constraints", () => {
    const workspaceKeys = [...new Set([...fixture.matchAll(/'(pilot-[a-z0-9]+)'/g)].map((m) => m[1]))];
    expect(workspaceKeys.length).toBeGreaterThan(1);
    for (const key of workspaceKeys) {
      expect(key).toMatch(/^pilot-[A-Za-z0-9]{1,16}$/);
    }
    // unit_id / run_id / collection_id are all `repeat(<char>, 32)`; every character used
    // must be a hex digit or the CHECK rejects the insert.
    const repeats = [...fixture.matchAll(/repeat\('([^'])', 32\)/g)].map((m) => m[1]);
    expect(repeats.length).toBeGreaterThan(0);
    for (const character of repeats) {
      expect(character).toMatch(/^[a-f0-9]$/);
    }
  });

  it("binds every promoted fixture world to the candidate key the lifecycle RPC requires", () => {
    // promote_foundation_candidate raises world_candidate_binding_invalid unless the object
    // key is exactly this concatenation, so a hand-written fixture key is easy to get wrong.
    expect(lifecycleMigration).toContain("world_candidate_binding_invalid");
    const calls = [...fixture.matchAll(/select public\.promote_foundation_candidate\(([\s\S]*?)\n\);/g)];
    expect(calls).toHaveLength(2);
    for (const [, body] of calls) {
      const args = [...body.matchAll(/'([^']*)'/g)].map((match) => match[1]);
      const [workspaceKey, collectionId, manifestDigest, candidateKey] = args;
      expect(candidateKey).toBe(
        `immutable/${workspaceKey}/${workspaceKey}/collections/${collectionId}/${manifestDigest.slice(7)}/candidate-world.json`,
      );
      // The reason argument is the last quoted string and is length-checked by the RPC.
      const reason = args[args.length - 1];
      expect(reason.length).toBeGreaterThanOrEqual(8);
      expect(reason.length).toBeLessThanOrEqual(500);
    }
  });

  it("inserts only columns that exist on foundation_retrieval_units", () => {
    const columnList = /insert into public\.foundation_retrieval_units \(([\s\S]*?)\)/.exec(fixture)?.[1] ?? "";
    const columns = columnList.split(",").map((column) => column.trim()).filter(Boolean);
    expect(columns.length).toBeGreaterThan(5);
    for (const column of columns) {
      // search_tokens is added by 0022, every other column by 0020.
      const declared =
        new RegExp(`^\\s*${column}\\s`, "m").test(foundationMigration) || column === "search_tokens";
      expect(declared, `column ${column} is not declared in the schema`).toBe(true);
    }
  });

  it("covers all three pgvector metrics and both fail-closed guards", () => {
    for (const metric of ["'cosine'", "'l2'", "'inner_product'"]) {
      expect(fixture).toContain(metric);
    }
    expect(fixture).toContain("retrieval_dense_search_dimension_mismatch");
    expect(fixture).toContain("retrieval_dense_search_unknown_metric");
    expect(fixture).toContain("retrieval_lexical_search_requires_safe_token");
    expect(fixture).toContain("retrieval_lexical_search_limit_out_of_bounds");
  });

  it("asserts the RPCs are unreachable by browser-facing roles", () => {
    expect(fixture).toMatch(/not has_function_privilege\('anon'/);
    expect(fixture).toMatch(/not has_function_privilege\('authenticated'/);
  });

  it("runs inside a transaction it rolls back, leaving no fixture rows behind", () => {
    // The file opens with a header comment, so compare the first non-comment statement
    // rather than the first character.
    const firstStatement = fixture
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("--"));
    expect(firstStatement).toBe("begin;");
    expect(fixture.trimEnd().endsWith("rollback;")).toBe(true);
    expect(fixture).toContain("select * from finish();");
  });
});
