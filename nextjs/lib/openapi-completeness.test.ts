import { describe, expect, it } from "vitest";
import { GET as openApiRoute } from "@/app/api/openapi/route";
import { API_ERROR_CODE_NAMES } from "./api-error-codes";
import { DOCS_SECTIONS } from "./docs-content";

/*
  G3-030 and G3-031, as assertions.

  The audit counted, on the published contract: 0 summaries, 0 tags, 0 request or response
  examples, 0 success-response schemas, and 13 of 33 operations with no documentation page
  anywhere. A generated client typed every success payload as `any`, and a rendered reference
  would have been one flat unlabelled list, which is why /api was a redirect for as long as it
  was.

  Each of those is a number, so each of them is a test. They are written as "every operation"
  rather than as a count, because a count passes by deleting an operation.
*/

type Operation = {
  operationId?: string;
  summary?: string;
  tags?: string[];
  description?: string;
  requestBody?: { content?: Record<string, { schema?: unknown; examples?: unknown }> };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: unknown; examples?: unknown }> }>;
};

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

async function operations() {
  const spec = await openApiRoute(new Request("https://tavonel.com/api/openapi")).json() as {
    tags: Array<{ name: string }>;
    paths: Record<string, Record<string, unknown>>;
  };
  const list = Object.entries(spec.paths).flatMap(([path, item]) =>
    METHODS.filter((method) => item[method]).map((method) => ({ path, method, operation: item[method] as Operation })),
  );
  return { spec, list };
}

describe("OpenAPI completeness", () => {
  it("gives every operation an id, a summary, a known tag and a description", async () => {
    const { spec, list } = await operations();
    const tagNames = new Set(spec.tags.map((tag) => tag.name));
    expect(list.length).toBe(33);
    for (const { path, method, operation } of list) {
      const where = `${method.toUpperCase()} ${path}`;
      expect(operation.operationId, where).toBeTruthy();
      // A summary is what a reference lists; without one every row reads as its own URL.
      expect((operation.summary ?? "").length, where).toBeGreaterThan(5);
      expect((operation.description ?? "").length, where).toBeGreaterThan(40);
      expect(operation.tags?.length, where).toBe(1);
      expect(tagNames.has(operation.tags![0]!), `${where} tag ${operation.tags![0]}`).toBe(true);
    }
  });

  it("gives every 2xx a schema, and every operation at least one example", async () => {
    const { list } = await operations();
    for (const { path, method, operation } of list) {
      const where = `${method.toUpperCase()} ${path}`;
      const success = Object.entries(operation.responses ?? {}).filter(([status]) => status.startsWith("2"));
      expect(success.length, where).toBeGreaterThan(0);
      for (const [status, response] of success) {
        const media = Object.values(response.content ?? {});
        // 204 carries no body, so a schema would be describing nothing.
        if (status === "204") {
          expect(media.length, `${where} ${status}`).toBe(0);
          continue;
        }
        expect(media.length, `${where} ${status} has no content`).toBeGreaterThan(0);
        for (const entry of media) expect(entry.schema, `${where} ${status} has no schema`).toBeTruthy();
      }
      const examples = [
        ...Object.values(operation.requestBody?.content ?? {}),
        ...success.flatMap(([, response]) => Object.values(response.content ?? {})),
      ].filter((entry) => entry.examples);
      // 204 has no body, and a binary download's example would be an archive inlined as a string.
      const exempt = success.every(([status, response]) =>
        status === "204" || Object.keys(response.content ?? {}).every((type) => !type.includes("json")));
      if (exempt) continue;
      expect(examples.length, `${where} has no example`).toBeGreaterThan(0);
    }
  });

  it("names real catalogued codes in every error response", async () => {
    const { list } = await operations();
    const known = new Set(API_ERROR_CODE_NAMES);
    for (const { path, method, operation } of list) {
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        if (status.startsWith("2")) continue;
        const codes = (response as { "x-tavonel-error-codes"?: string[] })["x-tavonel-error-codes"] ?? [];
        // G3-020: "Bounded error with a stable machine code" told a reader nothing. Every error
        // response names the codes it can carry, and every one of them is in the catalogue.
        expect(codes.length, `${method.toUpperCase()} ${path} ${status}`).toBeGreaterThan(0);
        for (const code of codes) expect(known.has(code), `${code} on ${path} ${status}`).toBe(true);
      }
    }
  });

  it("documents every operation on a docs page", async () => {
    const { list } = await operations();
    const documented = new Set(
      DOCS_SECTIONS.flatMap((section) =>
        section.blocks.flatMap((block) => (block.kind === "endpoint" ? [block.operationId] : [])),
      ),
    );
    const missing = list
      .map(({ operation }) => operation.operationId!)
      .filter((id) => !documented.has(id));
    expect(missing, "these operations are in the contract and on no documentation page").toEqual([]);
  });
});
