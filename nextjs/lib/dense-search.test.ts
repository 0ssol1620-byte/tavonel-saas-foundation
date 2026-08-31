import { describe, expect, it } from "vitest";
import { buildDenseSearchQuery } from "./dense-search";

const base: Omit<Parameters<typeof buildDenseSearchQuery>[0], "metric"> = {
  workspaceKey: "pilot-tenantone",
  compileRunId: "retrieval-run-" + "a".repeat(32),
  retrievalProfileId: "bge-m3-v1",
  queryEmbedding: [0.1, 0.2, 0.3],
  expectedDimension: 3,
  limit: 20,
};

describe("buildDenseSearchQuery", () => {
  it("scopes the query to workspace, retrieval profile, and compile run", () => {
    const query = buildDenseSearchQuery({ ...base, metric: "cosine" });
    expect(query.sql).toContain("fe.workspace_key = $1");
    expect(query.sql).toContain("fe.retrieval_profile_id = $2");
    expect(query.sql).toContain("fu.compile_run_id = $3");
    expect(query.params[0]).toBe("pilot-tenantone");
    expect(query.params[1]).toBe("bge-m3-v1");
    expect(query.params[2]).toBe(base.compileRunId);
  });

  it("formats the embedding as a pgvector literal bound as a single parameter", () => {
    const query = buildDenseSearchQuery({ ...base, metric: "cosine" });
    expect(query.params[3]).toBe("[0.1,0.2,0.3]");
    expect(query.sql).toContain("$4::vector");
  });

  it.each([
    ["cosine", "<=>"],
    ["l2", "<->"],
    ["inner_product", "<#>"],
  ] as const)("uses the %s distance operator", (metric, operator) => {
    const query = buildDenseSearchQuery({ ...base, metric });
    expect(query.sql).toContain(`embedding ${operator} $4::vector`);
  });

  it("orders ascending for every metric, since all three put the best match first that way", () => {
    const query = buildDenseSearchQuery({ ...base, metric: "inner_product" });
    expect(query.sql).toMatch(/order by distance asc/);
  });

  it("rejects an out-of-range expectedDimension", () => {
    expect(() => buildDenseSearchQuery({ ...base, metric: "cosine", expectedDimension: 0 })).toThrow();
    expect(() => buildDenseSearchQuery({ ...base, metric: "cosine", expectedDimension: 8193 })).toThrow();
  });

  it("rejects a query embedding whose length disagrees with expectedDimension, rather than trusting it silently (auditor-sol Wave 2 finding #4)", () => {
    expect(() => buildDenseSearchQuery({ ...base, metric: "cosine", queryEmbedding: [0.1], expectedDimension: 1024 })).toThrow(
      /is 1D but the profile expects 1024D/,
    );
    expect(() => buildDenseSearchQuery({ ...base, metric: "cosine", queryEmbedding: [], expectedDimension: 3 })).toThrow();
  });

  it("rejects a non-finite embedding component", () => {
    expect(() => buildDenseSearchQuery({ ...base, metric: "cosine", queryEmbedding: [0.1, Number.NaN] })).toThrow();
    expect(() => buildDenseSearchQuery({ ...base, metric: "cosine", queryEmbedding: [0.1, Number.POSITIVE_INFINITY] })).toThrow();
  });

  it("rejects a non-positive or non-integer limit", () => {
    expect(() => buildDenseSearchQuery({ ...base, metric: "cosine", limit: 0 })).toThrow();
    expect(() => buildDenseSearchQuery({ ...base, metric: "cosine", limit: 1.5 })).toThrow();
  });
});
