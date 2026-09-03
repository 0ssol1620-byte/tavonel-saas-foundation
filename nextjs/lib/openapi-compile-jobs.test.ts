import { describe, expect, it } from "vitest";
import { GET as openApi } from "../app/api/openapi/route";
import { COMPILE_MAX_DOCUMENTS, COMPILE_MIN_DOCUMENTS, CORPUS_MAX_DOCUMENTS } from "./compile-limits";

/*
  The published spec is what someone else's generated client is built from.

  Two ways it goes wrong quietly. It can describe a limit the product no longer has -- the
  compile floor moved from two documents to one, and the spec kept saying two, so a generated
  client would refuse a single-document compile the API accepts. And it can omit an endpoint
  entirely, which is what happened to the whole durable compile API until this.
*/

type PathItem = {
  servers?: Array<{ url: string }>;
  post?: { requestBody?: { content: Record<string, { schema: { properties?: Record<string, { minItems?: number; maxItems?: number }> } }> } };
  get?: unknown;
};

async function spec() {
  const response = openApi(new Request("https://tavonel.com/api/openapi"));
  return (await response.json()) as {
    servers: Array<{ url: string }>;
    paths: Record<string, PathItem>;
  };
}

describe("the published compile contract", () => {
  it("states the document limits the product actually enforces", async () => {
    const document = await spec();
    const schema = document.paths["/collections/compile"].post!.requestBody!.content["application/json"].schema;
    expect(schema.properties?.documentIds.minItems).toBe(COMPILE_MIN_DOCUMENTS);
    expect(schema.properties?.documentIds.maxItems).toBe(COMPILE_MAX_DOCUMENTS);
  });

  it("publishes every durable compile endpoint", async () => {
    const document = await spec();
    for (const path of [
      "/compile-jobs",
      "/compile-jobs/{jobId}",
      "/compile-jobs/{jobId}/events",
      "/compile-jobs/{jobId}/blockers",
      "/compile-jobs/{jobId}/cancel",
      "/compile-jobs/corpus/{corpusId}",
    ]) {
      expect(Object.keys(document.paths)).toContain(path);
    }
  });

  it("says where those endpoints actually live", async () => {
    const document = await spec();
    // They are not under /api/v1, and a spec that implied they were would send every generated
    // client to a 404.
    expect(document.servers[0].url).toBe("https://tavonel.com/api/v1");
    expect(document.paths["/compile-jobs"].servers).toEqual([{ url: "https://tavonel.com/api" }]);
  });

  it("publishes the durable path's own ceiling, which is the run one", async () => {
    /*
      The two ceilings are different numbers and the spec has to say which one this endpoint
      enforces. Publishing COMPILE_MAX_DOCUMENTS here would make a generated client refuse the
      50-document submission the server partitions and accepts.
    */
    const document = await spec();
    const schema = document.paths["/compile-jobs"].post!.requestBody!.content["application/json"].schema;
    expect(schema.properties?.documentIds.minItems).toBe(COMPILE_MIN_DOCUMENTS);
    expect(schema.properties?.documentIds.maxItems).toBe(CORPUS_MAX_DOCUMENTS);
    expect(CORPUS_MAX_DOCUMENTS).toBeGreaterThan(COMPILE_MAX_DOCUMENTS);
  });
});
