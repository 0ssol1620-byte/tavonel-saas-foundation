import { GET as openApiRoute } from "@/app/api/openapi/route";

/*
  Endpoint documentation, read out of the contract the API actually serves.

  The alternative is writing the request and response shapes into the docs beside the spec, and
  this repository already knows how that ends: the published spec said the compile floor was two
  documents for as long as it took someone to notice, and a generated client built from it would
  have refused a single-document compile the API accepts. A second hand-maintained copy would
  have been a third place to be wrong.

  So the docs call the route handler. Same process, no network, and the page cannot describe an
  endpoint that is not published or omit a parameter the spec requires.
*/

export type DocsEndpoint = {
  operationId: string;
  method: string;
  path: string;
  server: string;
  scope: string | null;
  /**
   * Which credential the operation takes, which decides the header a snippet prints.
   *
   * `none` is an operation the contract marks `security: []`; `session` is one carrying
   * `x-tavonel-auth: browser-session`, where a developer API key is refused and the example says
   * so rather than printing a key that cannot work.
   */
  auth: "key" | "session" | "none";
  description: string;
  requestExample: string | null;
  responses: Array<{ status: string; description: string }>;
};

type OperationObject = {
  operationId?: string;
  description?: string;
  security?: unknown[];
  "x-tavonel-auth"?: string;
  "x-tavonel-scope"?: string;
  requestBody?: { content?: Record<string, { schema?: unknown }> };
  responses?: Record<string, { description?: string }>;
};

type PathItem = Record<string, unknown> & { servers?: Array<{ url: string }> };

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

/**
 * A one-line JSON example built from the request schema.
 *
 * Types and bounds only -- a made-up document id in a copyable example is a value somebody will
 * paste, and it will fail in a way that looks like the API is broken. The placeholder says what
 * shape belongs there.
 */
function exampleFromSchema(schema: unknown): string | null {
  if (!schema || typeof schema !== "object") return null;
  const node = schema as { type?: string; properties?: Record<string, Record<string, unknown>>; required?: string[] };
  if (node.type !== "object" || !node.properties) return null;
  const body: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(node.properties)) {
    body[key] = placeholder(key, property);
  }
  return JSON.stringify(body, null, 2);
}

function placeholder(key: string, property: Record<string, unknown>): unknown {
  const type = property.type;
  if (type === "array") {
    const items = (property.items ?? {}) as Record<string, unknown>;
    const minimum = typeof property.minItems === "number" ? property.minItems : 1;
    return Array.from({ length: Math.max(1, minimum) }, () => placeholder(key, items));
  }
  if (type === "integer" || type === "number") {
    return typeof property.minimum === "number" ? property.minimum : 0;
  }
  if (type === "string") {
    if (typeof property.enum === "object" && Array.isArray(property.enum)) return property.enum[0];
    if (typeof property.pattern === "string") return `<${key}>`;
    return `<${key}>`;
  }
  return `<${key}>`;
}

let cached: Map<string, DocsEndpoint> | null = null;

export async function readDocsEndpoints(): Promise<Map<string, DocsEndpoint>> {
  if (cached) return cached;
  const response = openApiRoute(new Request("https://tavonel.com/api/openapi"));
  const document = await response.json() as {
    servers: Array<{ url: string }>;
    paths: Record<string, PathItem>;
  };
  const endpoints = new Map<string, DocsEndpoint>();
  for (const [path, item] of Object.entries(document.paths)) {
    const server = item.servers?.[0]?.url ?? document.servers[0].url;
    for (const method of METHODS) {
      const operation = item[method] as OperationObject | undefined;
      if (!operation?.operationId) continue;
      const schema = operation.requestBody?.content?.["application/json"]?.schema;
      endpoints.set(operation.operationId, {
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path,
        server,
        scope: operation["x-tavonel-scope"] ?? null,
        auth: operation.security?.length === 0
          ? "none"
          : operation["x-tavonel-auth"] === "browser-session" ? "session" : "key",
        description: operation.description ?? "",
        requestExample: exampleFromSchema(schema),
        responses: Object.entries(operation.responses ?? {}).map(([status, value]) => ({
          status,
          description: value.description ?? "",
        })),
      });
    }
  }
  cached = endpoints;
  return endpoints;
}

/** The environment variable a snippet reads, or null where the operation takes no credential. */
function authVariable(endpoint: DocsEndpoint) {
  if (endpoint.auth === "none") return null;
  return endpoint.auth === "session" ? "TAVONEL_SESSION_JWT" : "TAVONEL_API_KEY";
}

/** The line above a browser-session snippet, so nobody spends an afternoon on a 401. */
const SESSION_NOTE = "Browser session only. A developer API key is refused on this route.";

/** The curl a reader can copy, assembled from the same values shown above it. */
export function curlFor(endpoint: DocsEndpoint) {
  const parts = [`curl -sS -X ${endpoint.method} ${endpoint.server}${endpoint.path}`];
  const variable = authVariable(endpoint);
  if (variable) parts.push(`  -H "Authorization: Bearer $${variable}"`);
  if (endpoint.requestExample) {
    parts.push(`  -H "content-type: application/json"`);
    parts.push(`  -d '${endpoint.requestExample.replace(/\n\s*/g, " ")}'`);
  }
  const request = parts.join(" \\\n");
  return endpoint.auth === "session" ? `# ${SESSION_NOTE}\n${request}` : request;
}

/*
  The same request in the two languages people actually integrate from.

  Masterplan 13.2 asks /api for curl, Python and TypeScript. These are generated from the same
  `DocsEndpoint` as the curl above rather than written beside it, for the reason this whole file
  exists: a hand-written snippet is a third copy of the contract, and the copy is what goes
  stale. Neither imports an SDK -- there is no published SDK, and a snippet that used one would
  be documentation for something that does not exist.
*/
export type SnippetLanguage = "curl" | "python" | "typescript";

export const SNIPPET_LANGUAGES: readonly SnippetLanguage[] = ["curl", "python", "typescript"];

export function pythonFor(endpoint: DocsEndpoint) {
  const variable = authVariable(endpoint);
  const lines = variable ? ["import os", "import requests", ""] : ["import requests", ""];
  if (endpoint.auth === "session") lines.unshift(`# ${SESSION_NOTE}`);
  if (endpoint.requestExample) lines.push(`body = ${pythonLiteral(endpoint.requestExample)}`, "");
  lines.push(
    "response = requests.request(",
    `    "${endpoint.method}",`,
    `    "${endpoint.server}${endpoint.path}",`,
  );
  if (variable) lines.push(`    headers={"Authorization": "Bearer " + os.environ["${variable}"]},`);
  if (endpoint.requestExample) lines.push("    json=body,");
  lines.push("    timeout=30,", ")", "response.raise_for_status()", "print(response.json())");
  return lines.join("\n");
}

export function typescriptFor(endpoint: DocsEndpoint) {
  const variable = authVariable(endpoint);
  const parts: string[] = [];
  if (variable) parts.push(`authorization: \`Bearer \${process.env.${variable}}\``);
  if (endpoint.requestExample) parts.push('"content-type": "application/json"');
  const headers = parts.length > 0 ? `{ ${parts.join(", ")} }` : "{}";
  const lines = endpoint.auth === "session" ? [`// ${SESSION_NOTE}`] : [];
  lines.push(`const response = await fetch("${endpoint.server}${endpoint.path}", {`);
  lines.push(`  method: "${endpoint.method}",`);
  lines.push(`  headers: ${headers},`);
  if (endpoint.requestExample) lines.push(`  body: JSON.stringify(${endpoint.requestExample.replace(/\n\s*/g, " ")}),`);
  lines.push("});");
  // The status branch every integration needs, and the one an example usually leaves out.
  lines.push("if (!response.ok) throw new Error(`${response.status} ${(await response.json()).code}`);");
  lines.push("console.log(await response.json());");
  return lines.join("\n");
}

export function snippetFor(endpoint: DocsEndpoint, language: SnippetLanguage) {
  if (language === "python") return pythonFor(endpoint);
  if (language === "typescript") return typescriptFor(endpoint);
  return curlFor(endpoint);
}

/** JSON is not Python: the placeholder strings survive, the punctuation and the literals do not. */
function pythonLiteral(json: string) {
  const render = (item: unknown, indent: string): string => {
    if (Array.isArray(item)) return `[${item.map((entry) => render(entry, indent)).join(", ")}]`;
    if (item && typeof item === "object") {
      const entries = Object.entries(item as Record<string, unknown>)
        .map(([key, entry]) => `${indent}    ${JSON.stringify(key)}: ${render(entry, `${indent}    `)}`);
      return `{\n${entries.join(",\n")}\n${indent}}`;
    }
    if (item === null) return "None";
    if (item === true) return "True";
    if (item === false) return "False";
    return JSON.stringify(item);
  };
  return render(JSON.parse(json) as unknown, "");
}
