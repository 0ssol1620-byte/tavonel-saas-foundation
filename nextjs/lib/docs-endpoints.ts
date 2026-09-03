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
  description: string;
  requestExample: string | null;
  responses: Array<{ status: string; description: string }>;
};

type OperationObject = {
  operationId?: string;
  description?: string;
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

/** The curl a reader can copy, assembled from the same values shown above it. */
export function curlFor(endpoint: DocsEndpoint) {
  const lines = [`curl -sS -X ${endpoint.method} ${endpoint.server}${endpoint.path} \\`];
  lines.push(`  -H "Authorization: Bearer $TAVONEL_API_KEY" \\`);
  if (endpoint.requestExample) {
    lines.push(`  -H "content-type: application/json" \\`);
    lines.push(`  -d '${endpoint.requestExample.replace(/\n\s*/g, " ")}'`);
  } else {
    lines[lines.length - 1] = `  -H "Authorization: Bearer $TAVONEL_API_KEY"`;
  }
  return lines.join("\n");
}
