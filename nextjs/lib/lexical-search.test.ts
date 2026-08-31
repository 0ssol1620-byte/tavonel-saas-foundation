import { describe, expect, it } from "vitest";
import { buildLexicalSearchQuery } from "./lexical-search";

describe("buildLexicalSearchQuery", () => {
  it("builds a parameterized query scoped to the workspace and compile run", () => {
    const query = buildLexicalSearchQuery({
      workspaceKey: "pilot-tenantone",
      compileRunId: "retrieval-run-" + "a".repeat(32),
      queryTokens: ["revenue", "매출"],
      limit: 20,
    });
    expect(query.sql).toContain("where workspace_key = $1");
    expect(query.sql).toContain("and compile_run_id = $2");
    expect(query.sql).toContain("to_tsquery('simple', $3)");
    expect(query.sql).toContain("limit $4");
    expect(query.params[0]).toBe("pilot-tenantone");
    expect(query.params[1]).toBe("retrieval-run-" + "a".repeat(32));
    expect(query.params[3]).toBe(20);
  });

  it("OR-joins every query token into one tsquery string, not an AND of all of them", () => {
    const query = buildLexicalSearchQuery({
      workspaceKey: "pilot-tenantone",
      compileRunId: "retrieval-run-" + "a".repeat(32),
      queryTokens: ["revenue", "sales", "매출"],
      limit: 20,
    });
    expect(query.params[2]).toBe("'revenue' | 'sales' | '매출'");
  });

  it("deduplicates repeated tokens before building the tsquery", () => {
    const query = buildLexicalSearchQuery({
      workspaceKey: "pilot-tenantone",
      compileRunId: "retrieval-run-" + "a".repeat(32),
      queryTokens: ["revenue", "revenue"],
      limit: 20,
    });
    expect(query.params[2]).toBe("'revenue'");
  });

  it("drops a token containing tsquery syntax rather than passing it through unescaped", () => {
    const query = buildLexicalSearchQuery({
      workspaceKey: "pilot-tenantone",
      compileRunId: "retrieval-run-" + "a".repeat(32),
      queryTokens: ["revenue", "a' or '1'='1"],
      limit: 20,
    });
    expect(query.params[2]).toBe("'revenue'");
  });

  it("throws if every query token is unsafe, rather than building an empty/all-matching tsquery", () => {
    expect(() =>
      buildLexicalSearchQuery({
        workspaceKey: "pilot-tenantone",
        compileRunId: "retrieval-run-" + "a".repeat(32),
        queryTokens: ["' or 1=1 --"],
        limit: 20,
      }),
    ).toThrow();
  });

  it("throws on a non-positive or non-integer limit", () => {
    expect(() =>
      buildLexicalSearchQuery({
        workspaceKey: "pilot-tenantone",
        compileRunId: "retrieval-run-" + "a".repeat(32),
        queryTokens: ["revenue"],
        limit: 0,
      }),
    ).toThrow();
    expect(() =>
      buildLexicalSearchQuery({
        workspaceKey: "pilot-tenantone",
        compileRunId: "retrieval-run-" + "a".repeat(32),
        queryTokens: ["revenue"],
        limit: 1.5,
      }),
    ).toThrow();
  });
});
