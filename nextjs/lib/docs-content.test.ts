import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { API_VERSION } from "./api-version";
import { COMPILE_MAX_DOCUMENTS, COMPILE_MIN_DOCUMENTS, CORPUS_MAX_DOCUMENTS } from "./compile-limits";
import { DEVELOPER_SCOPES } from "./developer-contracts";
import { DOCS_GROUPS, DOCS_SECTIONS, DOCS_VERSION, docsSearchIndex, findDocsSection } from "./docs-content";
import { curlFor, readDocsEndpoints } from "./docs-endpoints";
// The MCP server is dependency-free .mjs; the docs table is checked against its tool list.
import { TOOLS as MCP_TOOLS } from "../scripts/mcp/tavonel-mcp-server.mjs";

/*
  Documentation that cannot drift from the product.

  The failure this guards has happened twice in this repository already, both times quietly:
  the published OpenAPI document said the compile floor was two documents after the product
  moved to one, and the workspace printed an archive ceiling the browser it was printed in
  would have refused. Both were transcriptions of a number that then moved.

  So nothing in `docs-content.ts` writes a limit, a scope or an endpoint shape. It imports the
  constants and it names operation ids, and these tests fail when a name stops resolving or a
  figure stops matching. What they cannot check is whether the prose is true; that is a person's
  job, and `DOCS_REVIEWED` is where they record having done it.
*/

const IA_FROM_MASTERPLAN = [
  "quickstart",
  "concepts",
  "authentication",
  "files-and-formats",
  "upload",
  "collections-and-compile",
  "run-events",
  "review",
  "world-api",
  "search",
  "ask",
  "connections",
  "exports",
  "mcp",
  "cli",
  "billing-and-limits",
  "errors",
  "security",
  "changelog",
];

describe("the information architecture", () => {
  it("covers every section masterplan 13.6 requires", () => {
    const slugs = DOCS_SECTIONS.map((section) => section.slug);
    for (const required of IA_FROM_MASTERPLAN) {
      expect(slugs, `missing docs section: ${required}`).toContain(required);
    }
  });

  it("has no section that is not reachable and no duplicate slug", () => {
    const slugs = DOCS_SECTIONS.map((section) => section.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(findDocsSection(slug)).not.toBeNull();
    expect(findDocsSection("not-a-section")).toBeNull();
  });

  it("puts every section in a group the index renders", () => {
    for (const section of DOCS_SECTIONS) {
      expect(DOCS_GROUPS, section.slug).toContain(section.group);
    }
  });

  it("gives every section a summary long enough to be a description", () => {
    for (const section of DOCS_SECTIONS) {
      expect(section.summary.length, section.slug).toBeGreaterThanOrEqual(40);
      expect(section.summary.length, section.slug).toBeLessThanOrEqual(200);
      expect(section.blocks.length, section.slug).toBeGreaterThan(0);
    }
  });
});

describe("every endpoint block resolves to a published operation", () => {
  it("names nothing the contract does not carry", async () => {
    /*
      The check that matters most here. A renamed operationId would otherwise render as an
      absent block -- documentation quietly losing a section rather than breaking.
    */
    const endpoints = await readDocsEndpoints();
    const named = DOCS_SECTIONS.flatMap((section) =>
      section.blocks.filter((block) => block.kind === "endpoint").map((block) => block.operationId));
    expect(named.length).toBeGreaterThan(8);
    for (const operationId of named) {
      expect(endpoints.has(operationId), `no published operation: ${operationId}`).toBe(true);
    }
  });

  it("builds a copyable request from the contract, not from prose", async () => {
    const endpoints = await readDocsEndpoints();
    const compile = endpoints.get("startCompileJob")!;
    expect(compile.method).toBe("POST");
    expect(compile.path).toBe("/compile-jobs");
    // The durable endpoints are not under /v1 and the docs must not imply they are.
    expect(compile.server).toBe("https://tavonel.com/api");
    const curl = curlFor(compile);
    expect(curl).toContain("curl -sS -X POST https://tavonel.com/api/compile-jobs");
    expect(curl).toContain("Authorization: Bearer $TAVONEL_API_KEY");
    expect(curl).toContain("documentIds");
  });

  it("puts a placeholder where an id belongs rather than a plausible fake", async () => {
    // A made-up document id in a copyable example is a value somebody pastes, and it fails in
    // a way that looks like the API is broken.
    const endpoints = await readDocsEndpoints();
    const example = endpoints.get("startCompileJob")!.requestExample!;
    expect(example).toContain("<documentIds>");
    expect(example).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });
});

describe("the numbers on the page are the product's numbers", () => {
  const text = DOCS_SECTIONS.flatMap((section) => [
    section.summary,
    ...section.blocks.flatMap((block) => {
      if (block.kind === "prose" || block.kind === "note") return [block.text];
      if (block.kind === "table") return block.rows.flat();
      if (block.kind === "steps") return block.items;
      return [];
    }),
  ]).join("\n");

  it("states the limits the code enforces", () => {
    expect(text).toContain(String(COMPILE_MAX_DOCUMENTS));
    expect(text).toContain(String(CORPUS_MAX_DOCUMENTS));
    expect(text).toContain(`${COMPILE_MIN_DOCUMENTS}–${COMPILE_MAX_DOCUMENTS}`);
  });

  it("publishes the API version from the same constant the contract does", () => {
    expect(DOCS_VERSION).toBe(API_VERSION);
    const spec = readFileSync(resolve(import.meta.dirname, "../app/api/openapi/route.ts"), "utf8");
    expect(spec).toContain("version: API_VERSION");
  });

  it("documents every scope a key can actually hold", () => {
    const scopeRows = DOCS_SECTIONS.find((section) => section.slug === "authentication")!
      .blocks.find((block) => block.kind === "table")!;
    const documented = scopeRows.kind === "table" ? scopeRows.rows.map((row) => row[0]) : [];
    expect(documented).toEqual([...DEVELOPER_SCOPES]);
    // And says something about each, rather than falling through to the placeholder.
    const descriptions = scopeRows.kind === "table" ? scopeRows.rows.map((row) => row[1]) : [];
    expect(descriptions).not.toContain("See the endpoint reference.");
  });
});

describe("what the documentation does not claim", () => {
  const text = JSON.stringify(DOCS_SECTIONS).toLowerCase();

  it("does not promise anything as coming", () => {
    // Masterplan 14: an unbuilt feature is not a bullet. The MCP section says what exists
    // today instead, which is why it can exist at all.
    for (const phrase of ["coming soon", "will be available", "in beta", "when qualified"]) {
      expect(text, phrase).not.toContain(phrase);
    }
  });

  it("documents the MCP server that exists, tool by tool, and the two tools it does not have", () => {
    /*
      This used to assert the sentence "no published MCP server yet", which was the honest thing
      to say while there was none. There is one now, so the check moves to the two claims that
      can go wrong in the other direction: that the tool list on the page is the tool list the
      server exposes, and that the absences are still named rather than quietly filled in.
    */
    const mcp = findDocsSection("mcp")!;
    const table = mcp.blocks.find((block) => block.kind === "table");
    const documented = table && table.kind === "table" ? table.rows.map((row) => row[0]) : [];
    expect(documented).toEqual(MCP_TOOLS.map((tool: { name: string }) => tool.name));
    expect(documented).not.toContain("list_worlds");
    const text = JSON.stringify(mcp);
    expect(text).toContain("no list_worlds tool");
    expect(text).toContain("no write tool");
  });
});

describe("the pages that render it", () => {
  const hub = readFileSync(resolve(import.meta.dirname, "../app/docs/page.tsx"), "utf8");
  const section = readFileSync(resolve(import.meta.dirname, "../app/docs/[section]/page.tsx"), "utf8");

  it("renders the index from the data rather than a second hand-written list", () => {
    expect(hub).toContain("DOCS_SECTIONS.filter((section) => section.group === group)");
    expect(section).toContain("generateStaticParams");
    expect(section).toContain("DOCS_SECTIONS.map((section) => ({ section: section.slug }))");
  });

  it("carries the required furniture: search, copy, version, reviewed date, llms.txt", () => {
    expect(hub).toContain("<DocsSearch");
    expect(hub).toContain("/llms.txt");
    expect(hub).toContain("/api/openapi");
    expect(hub).toContain("DOCS_REVIEWED");
    expect(section).toContain("DocsCopyButton");
    expect(section).toContain("DOCS_REVIEWED");
    expect(section).toContain("mailto:support@tavonel.com");
  });

  it("404s an unknown section instead of rendering an empty page", () => {
    expect(section).toContain("if (!entry) notFound();");
  });
});

describe("search", () => {
  it("indexes the body, not only the titles", () => {
    const index = docsSearchIndex();
    const runEvents = index.find((entry) => entry.slug === "run-events")!;
    // Somebody searching for this is looking for the paragraph that mentions it.
    expect(runEvents.text).toContain("last-event-id");
    expect(index).toHaveLength(DOCS_SECTIONS.length);
  });
});
