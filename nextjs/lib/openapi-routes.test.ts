import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GET as openApiRoute } from "@/app/api/openapi/route";

/*
  G3-001, as a check the build runs instead of a person.

  The defect: `servers` was `https://tavonel.com/api/v1` and the seven `/compile-jobs*`
  operations live at `/api/compile-jobs`, so every one of them -- start, list, poll, stream,
  blockers, cancel, corpus -- resolved to a 404 for anyone generating a client, importing the
  file into Postman, or building a try-it console. That is the entire path from "I uploaded a
  file" to "I have a World", and the documentation pages had it right the whole time, so only
  the machine-readable contract was wrong.

  A one-line fix stays fixed only if something re-checks it. This resolves every path and method
  in the published document against the App Router's own file layout: `{param}` becomes
  `[param]`, the operation's effective server (its path-level override, else the document's)
  supplies the prefix, and `app/<prefix><path>/route.ts` must exist and must export that method.

  It is a file-existence check rather than an HTTP probe on purpose. A network check needs a
  running server and a live deployment, which is exactly the thing that is not available in the
  pull request where the regression would be introduced.
*/

type Operation = { operationId?: string; summary?: string; tags?: string[]; responses?: Record<string, unknown>; requestBody?: unknown };
type PathItem = Record<string, unknown> & { servers?: Array<{ url: string }> };
type Document = {
  servers: Array<{ url: string }>;
  tags: Array<{ name: string }>;
  paths: Record<string, PathItem>;
  components: { schemas: Record<string, unknown> };
};

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

async function document(): Promise<Document> {
  const response = openApiRoute(new Request("https://tavonel.com/api/openapi"));
  return await response.json() as Document;
}

function operations(spec: Document) {
  return Object.entries(spec.paths).flatMap(([path, item]) =>
    METHODS
      .filter((method) => item[method])
      .map((method) => ({
        path,
        method,
        server: item.servers?.[0]?.url ?? spec.servers[0]!.url,
        operation: item[method] as Operation,
      })),
  );
}

/** `https://tavonel.com/api/v1` + `/world/{id}/{lens}` -> `app/api/v1/world/[id]/[lens]/route.ts` */
function routeFile(server: string, path: string) {
  const prefix = new URL(server).pathname.replace(/\/$/, "");
  const segments = `${prefix}${path}`.replace(/\{([^}]+)\}/g, "[$1]");
  return `app${segments}/route.ts`;
}

describe("the published OpenAPI document", () => {
  it("resolves every path and method to a route handler that exists", async () => {
    const spec = await document();
    const broken = operations(spec)
      .map((entry) => ({ ...entry, file: routeFile(entry.server, entry.path) }))
      .filter((entry) => {
        if (!existsSync(entry.file)) return true;
        const source = readFileSync(entry.file, "utf8");
        // `export function GET`, `export async function GET`, `export const GET`, `export { GET }`.
        return !new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${entry.method.toUpperCase()}\\b|export\\s*\\{[^}]*\\b${entry.method.toUpperCase()}\\b`).test(source);
      })
      .map((entry) => `${entry.method.toUpperCase()} ${entry.server}${entry.path} -> ${entry.file}`);
    expect(broken, "the contract describes a URL this application does not serve").toEqual([]);
  });

  it("still puts the compile routes under /api rather than /api/v1", async () => {
    // The specific regression, named, so a future `servers` edit cannot quietly undo it.
    const spec = await document();
    const compile = operations(spec).filter((entry) => entry.path.startsWith("/compile-jobs"));
    expect(compile.length).toBe(7);
    for (const entry of compile) expect(entry.server, entry.path).toMatch(/\/api$/);
  });
});
