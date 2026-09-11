import { describe, expect, it } from "vitest";
import { DOCS_SECTIONS } from "./docs-content";
import { GET as openApi } from "../app/api/openapi/route";

/*
  Audit Q02 and M06: the docs and the code, held together.

  M06's defect was not a missing feature. The retrieval pipeline has been hybrid since it
  shipped and the OpenAPI layer already said so; the human-readable Search page said "lexical
  retrieval", which is what a reader chose on. Q02's was adjacent: `retrievalPath` has existed
  in the /ask response the whole time and was documented nowhere, so a developer had no way to
  know which of two retrieval qualities answered their question.

  Copy drifts back. This is the test that notices: the two literal path values, the real error
  code /search returns, the degradations vocabulary and the freshness field names are all
  asserted against the strings the code actually uses.
*/

const block = (slug: string) => {
  const section = DOCS_SECTIONS.find((entry) => entry.slug === slug);
  if (!section) throw new Error(`no docs section ${slug}`);
  return { section, text: JSON.stringify(section) };
};

async function openApiDocument() {
  const response = openApi(new Request("https://tavonel.com/api/openapi"));
  return (await response.json()) as {
    paths: Record<string, { post?: { responses: Record<string, { description?: string }> } }>;
  };
}

describe("the Ask page documents both retrieval paths", () => {
  it("names both literal retrievalPath values and what each one means", () => {
    const { text } = block("ask");
    // The exact strings a client compares against. A rename that only touched the code would
    // leave the docs describing a value that no response carries.
    expect(text).toContain("compiled-retrieval-v1");
    expect(text).toContain("excerpt-concatenation-fallback");
    expect(text).toContain("RRF-fused");
    expect(text).toContain("World Gate");
  });

  it("says when the fallback happens, in all three of the states that produce it", () => {
    const { text } = block("ask");
    expect(text).toContain("promoted before its index was compiled");
    expect(text).toContain("failed on an unreachable embedder");
    expect(text).toContain("still in flight");
    // The three reported index states, by their literal values.
    for (const status of ["missing", "compiled", "failed"]) expect(text).toContain(status);
    expect(text).toContain("retrievalIndex.errorClass");
  });

  it("states that no model writes the answer, and names the field that would say otherwise", () => {
    const { text } = block("ask");
    expect(text).toContain("answerMode");
    expect(text).toContain("evidence_excerpts");
    expect(text).toContain("no language model writes any part of it");
  });

  it("does not claim a measured quality difference between the two paths", () => {
    // The comparison has not been run. Naming a winner here would be a number without a
    // receipt, which is the one thing the docs may never do.
    const { text } = block("ask");
    expect(text).toContain("no published measurement yet");
    expect(text).not.toMatch(/\d+(\.\d+)?\s*%/);
  });

  it("documents each freshness clock separately, including the one that is narrower than its name", () => {
    const { text } = block("ask");
    for (const field of ["observedAt", "processedAt", "reviewedAt", "activatedAt", "activeManifestDigest", "candidateAwaitingActivation"]) {
      expect(text, field).toContain(field);
    }
    // reviewedAt is the blocker-resolution decision and nothing else. Letting it read as a
    // general review timestamp would overstate what the schema records.
    expect(text).toContain("not a general");
    expect(text).toContain("A null in the freshness block");
  });
});

describe("the Search page describes the pipeline that runs", () => {
  it("calls the retrieval hybrid, the way the OpenAPI description already did", async () => {
    const { section, text } = block("search");
    expect(section.summary).toContain("Hybrid");
    expect(section.summary).not.toContain("Lexical retrieval over");
    for (const term of ["lexical", "dense", "structure", "reciprocal rank fusion", "World Gate"]) {
      expect(text, term).toContain(term);
    }
    const document = await openApiDocument();
    const published = document.paths["/collections/{id}/search"]?.post?.responses["200"]?.description ?? "";
    // Both surfaces now say hybrid. This is the pair that was allowed to disagree.
    expect(published.toLowerCase()).toContain("ranks");
    expect(text.toLowerCase()).toContain("hybrid");
  });

  it("uses the error code the route actually returns for a missing index", async () => {
    const { text } = block("search");
    expect(text).toContain("RETRIEVAL_RUN_NOT_FOUND");
    expect(text).toContain("RETRIEVAL_PROFILE_NOT_FOUND");
    expect(text).toContain("409");
    // The invented code this page must never use.
    expect(text).not.toContain("SEARCH_INDEX_MISSING");
    const document = await openApiDocument();
    const conflict = document.paths["/collections/{id}/search"]?.post?.responses["409"]?.description ?? "";
    expect(conflict).toContain("RETRIEVAL_RUN_NOT_FOUND");
  });

  it("names the degradations rather than describing the pipeline as if every source always runs", () => {
    const { text } = block("search");
    expect(text).toContain("degradations");
    expect(text).toContain("no embedder configured");
    expect(text).toContain("fused order");
    expect(text).toContain("retrievalPath");
  });

  it("says the old description was wrong instead of quietly replacing it", () => {
    // A limit is layered, never deleted: a reader who chose Search on the stale description
    // deserves to know it changed.
    expect(block("search").text).toContain("used to describe Search as lexical");
  });
});
