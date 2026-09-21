import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GET as openapi } from "../app/api/openapi/route";
import { TOOLS } from "../public/developer/tavonel-mcp.mjs";
import {
  FIRST_CALL,
  FIRST_CALL_OPERATION,
  FIRST_CALL_SNIPPETS,
} from "./developer-snippets";

/*
  THE VALIDATOR FOR GAP #7.

  Four code samples are four chances to publish a field nobody returns, and a developer page that
  documents an invented parameter is worse than one that documents nothing -- the reader finds out
  at runtime, after deciding to trust the page. So nothing here is checked against a list retyped
  in this file. The HTTP tabs are checked against the OpenAPI document this deployment actually
  serves, and the agent tab against the MCP server's own `TOOLS` table.

  What that catches: a response field renamed in the handler, a scope changed, the operation moved
  to another path, the tool renamed, or a tab quietly gaining a parameter that no schema has.
*/

const page = readFileSync(
  fileURLToPath(new URL("../app/developers/page.tsx", import.meta.url)),
  "utf8",
);

const spec = await (await openapi(new Request("https://tavonel.com/api/openapi"))).json();
const operation = spec.paths[FIRST_CALL_OPERATION.path]?.[FIRST_CALL_OPERATION.method];

/*
  Every property name the documented 200 response of that operation declares, at any depth.

  `$ref` is followed, because the field a sample actually prints -- `documentId` -- lives on the
  shared `Document` schema and not inline on the operation. A walk that stopped at the reference
  would pass on a response that documents three envelope keys and nothing about a document.
*/
function declaredNames(node: unknown, found = new Set<string>(), seen = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) declaredNames(item, found, seen);
    return found;
  }
  if (!node || typeof node !== "object") return found;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "$ref" && typeof value === "string" && !seen.has(value)) {
      seen.add(value);
      const target = value.replace(/^#\//, "").split("/")
        .reduce<unknown>((at, step) => (at as Record<string, unknown>)?.[step], spec);
      declaredNames(target, found, seen);
      continue;
    }
    if (key === "properties" && value && typeof value === "object") {
      for (const name of Object.keys(value as Record<string, unknown>)) found.add(name);
    }
    declaredNames(value, found, seen);
  }
  return found;
}

const body = (label: string) => {
  const snippet = FIRST_CALL_SNIPPETS.find((entry) => entry.label === label);
  expect(snippet, `no tab is labelled ${label}`).toBeTruthy();
  return snippet!.body;
};

describe("the first-call tabs on /developers", () => {
  it("offers cURL, TypeScript, Python and MCP, with cURL first", () => {
    expect(FIRST_CALL_SNIPPETS.map((entry) => entry.label))
      .toEqual(["cURL", "TypeScript", "Python", "MCP"]);
    /* The cURL body is the constant the landing page prints; two copies would drift. */
    expect(body("cURL")).toBe(FIRST_CALL);
  });

  it("documents an operation this deployment actually serves, at the scope it serves it at", () => {
    expect(operation, `${FIRST_CALL_OPERATION.path} is not in the OpenAPI document`).toBeTruthy();
    expect(operation["x-tavonel-scope"]).toBe(FIRST_CALL_OPERATION.scope);
    for (const label of ["cURL", "TypeScript", "Python"]) {
      expect(body(label), `${label} calls a different path`)
        .toContain(`https://tavonel.com/api/v1${FIRST_CALL_OPERATION.path}`);
      expect(body(label), `${label} sends no bearer key`).toMatch(/Bearer/);
    }
  });

  it("reads only response fields the documented schema declares", () => {
    const declared = declaredNames(operation.responses["200"]);
    for (const field of FIRST_CALL_OPERATION.fields) {
      expect([...declared], `${field} is not in the documented response`).toContain(field);
    }
    /* And the samples read exactly those: a field in a tab but not in the list is unchecked. */
    for (const label of ["TypeScript", "Python"]) {
      const used = [...body(label).matchAll(/(?:document|body)(?:\.|\["?)([A-Za-z]+)/g)]
        .map((match) => match[1]!);
      expect(used.length).toBeGreaterThan(0);
      for (const name of used) {
        expect(FIRST_CALL_OPERATION.fields, `${label} reads an undeclared field ${name}`)
          .toContain(name);
      }
    }
  });

  it("points the agent tab at a tool the published MCP server defines, making this same request", () => {
    const tool = TOOLS.find((entry) => entry.name === FIRST_CALL_OPERATION.mcpTool);
    expect(tool, `the MCP server defines no ${FIRST_CALL_OPERATION.mcpTool}`).toBeTruthy();
    const request = tool.request({});
    expect(request.method).toBe("GET");
    expect(request.path).toBe(`/api/v1${FIRST_CALL_OPERATION.path}`);
    /* It takes no arguments, which is why the tab is a client config and not a call. */
    expect(Object.keys(tool.inputSchema.properties ?? {})).toEqual([]);
    expect(page).toContain("<code>list_sources</code>");
  });

  /*
    G3-005. No package exists on either registry, so no tab may look like an install.

    `lib/docs-content.ts` publishes that absence in its own words; the risk here is a sample that
    opens with an import from a package that does not resolve, which reads as one.
  */
  it("promises no package nobody can install", () => {
    for (const entry of FIRST_CALL_SNIPPETS) {
      const source = entry.body.toLowerCase();
      for (const barred of ["pip install", "npm install", "npx @tavonel", "yarn add", "from tavonel", "@tavonel/"]) {
        expect(source, `the ${entry.label} tab says ${barred}`).not.toContain(barred);
      }
    }
  });

  it("is a real tab list, reachable from a keyboard, and every panel is in the HTML", () => {
    const component = readFileSync(
      fileURLToPath(new URL("../components/docs-snippet.tsx", import.meta.url)),
      "utf8",
    );
    expect(page).toContain("<DocsSnippet snippets={[...FIRST_CALL_SNIPPETS]} />");
    expect(component).toContain('role="tablist"');
    expect(component).toContain('role="tabpanel"');
    /* Plain buttons: a tab that is a div takes no Enter and no focus ring. */
    expect(component).toMatch(/<button[\s\S]{0,400}role="tab"/);
    expect(component).toMatch(/ArrowRight|ArrowLeft/);
    /* Inactive panels are hidden rather than unmounted, so a crawler sees all four. */
    expect(component).toMatch(/hidden=\{/);
  });

  it("claims nothing the repository cannot show, in any tab", () => {
    const prose = `${FIRST_CALL_SNIPPETS.map((entry) => entry.body).join(" ")}`.toLowerCase();
    for (const barred of ["accuracy", "accurate", "per second", "per minute", "throughput", "at scale", "table extraction"]) {
      expect(prose, `a tab says ${barred}`).not.toContain(barred);
    }
  });
});
