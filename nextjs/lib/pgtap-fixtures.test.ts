import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Every pgTAP fixture in supabase/tests, checked for the mistakes that only surface after
// someone has stood up a database.
//
// This is generalised from a per-file check because the same defect was written twice: a
// plan() count that disagreed with the number of assertions, once in the retrieval search
// fixture and again in the jobs fixture. pgTAP fails the ENTIRE file when plan() is wrong,
// so a drifting count silently invalidates every other assertion in it — and none of that is
// visible until `supabase db test` runs, which needs Docker.
//
// These fixtures cannot be executed in this environment (see the evidence document), so this
// is not a substitute for running them. It is the subset of their correctness that can be
// established statically, applied to all of them at once so a new fixture is covered the day
// it is added rather than the day someone remembers to write a test for it.

const testsDirectory = resolve(import.meta.dirname, "../../supabase/tests");
const migrationsDirectory = resolve(import.meta.dirname, "../../supabase/migrations");

const fixtures = readdirSync(testsDirectory)
  .filter((name) => name.endsWith(".sql"))
  .map((name) => ({ name, sql: readFileSync(join(testsDirectory, name), "utf8") }));

const allMigrations = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith(".sql"))
  .map((name) => readFileSync(join(migrationsDirectory, name), "utf8"))
  .join("\n");

// Assertion helpers pgTAP counts toward the plan. `select plan(...)`, `set_config` and
// `select * from finish()` are not assertions. The list is deliberately broad: an
// under-inclusive pattern under-counts and then "proves" a plan is correct when it is not,
// which is worse than not checking at all -- an early version of this file missed
// results_eq and is_empty and reported a clean fixture as broken.
const ASSERTION_HELPERS = [
  "has_table", "has_column", "has_index", "has_function", "has_type", "has_enum", "has_pk", "has_fk",
  "is", "isnt", "ok", "throws_ok", "lives_ok", "results_eq", "results_ne", "set_eq", "bag_eq",
  "is_empty", "isnt_empty", "col_is_pk", "col_type_is", "col_not_null", "col_has_default",
  "function_returns", "table_privs_are", "function_privs_are", "policies_are", "policy_cmd_is",
].join("|");

// Comment lines are stripped before counting so a commented-out example is not counted.
function assertionCount(sql: string): number {
  const body = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return body.match(new RegExp(`\\bselect\\s+(?:${ASSERTION_HELPERS})\\s*\\(`, "g"))?.length ?? 0;
}

describe("pgTAP fixtures", () => {
  it("finds the fixture suite", () => {
    expect(fixtures.length).toBeGreaterThan(3);
  });

  it.each(fixtures)("$name declares a plan matching its assertion count", ({ sql }) => {
    const planned = Number(/select plan\((\d+)\)/.exec(sql)?.[1]);
    const actual = assertionCount(sql);
    expect(Number.isFinite(planned), "fixture must declare a plan").toBe(true);
    expect(actual).toBeGreaterThan(0);
    expect(planned).toBe(actual);
  });

  it.each(fixtures)("$name runs in a transaction it rolls back", ({ sql }) => {
    // A fixture that commits leaves rows behind and poisons the next run.
    const firstStatement = sql
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("--"));
    expect(firstStatement).toBe("begin;");
    expect(sql.trimEnd().endsWith("rollback;")).toBe(true);
    expect(sql).toContain("select * from finish();");
  });

  it.each(fixtures)("$name only expects error strings some migration actually raises", ({ sql }) => {
    // A typo'd expectation makes throws_ok fail against the right behaviour, which reads as
    // a product bug when it is a test bug.
    const expected = [...new Set([...sql.matchAll(/'(foundation_[a-z_]+(?:invalid|required|not_found|not_held|mismatch|out_of_bounds|denied|failed|conflict))'/g)].map((m) => m[1]))];
    for (const message of expected) {
      expect(allMigrations, `${message} is expected by a fixture but raised nowhere`).toContain(message);
    }
  });

  it.each(fixtures)("$name uses workspace keys the schema CHECK accepts", ({ sql }) => {
    // foundation_* tables require ^pilot-[A-Za-z0-9]{1,16}$; a longer key fails the insert
    // with an opaque constraint error partway through the fixture.
    for (const key of [...new Set([...sql.matchAll(/'(pilot-[A-Za-z0-9]+)'/g)].map((m) => m[1]))]) {
      expect(key, `${key} violates the workspace_key CHECK`).toMatch(/^pilot-[A-Za-z0-9]{1,16}$/);
    }
  });

  it.each(fixtures)("$name builds ids from hex characters only", ({ sql }) => {
    // Ids are written as repeat('<char>', 32) and every id CHECK in this schema is [a-f0-9].
    for (const character of [...new Set([...sql.matchAll(/repeat\('([^'])', 32\)/g)].map((m) => m[1]))]) {
      expect(character, `repeat('${character}', 32) is not hex`).toMatch(/^[a-f0-9]$/);
    }
  });
});
