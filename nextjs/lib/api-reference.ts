import { GET as openApiRoute } from "@/app/api/openapi/route";
import type { DocsEndpoint } from "./docs-endpoints";

/*
  The published contract, in the shape a reference page renders (G3-004).

  `lib/docs-endpoints.ts` already reads the same document for the endpoint blocks inside the
  documentation sections, and this deliberately produces a superset of its `DocsEndpoint` rather
  than a parallel type: the snippet generators (`curlFor`, `pythonFor`, `typescriptFor`) take a
  `DocsEndpoint`, and a reference that could not reuse them would be a second place where a
  request example is written.

  What this adds on top: the summary and tag the contract now carries, the parameter list, the
  per-response example and error codes, and the `x-tavonel-status: best-effort` marker so the
  page can say out loud which schemas are described rather than closed.

  Read in-process, with no network call — it is the same handler, invoked directly.
*/

export type ReferenceParameter = {
  name: string;
  in: string;
  required: boolean;
  /** The type and its bounds, rendered as one short string rather than a schema tree. */
  shape: string;
  description: string;
};

export type ReferenceResponse = {
  status: string;
  description: string;
  /** The codes this status can carry, from `x-tavonel-error-codes`. Empty on a 2xx. */
  codes: string[];
  example: string | null;
  bestEffort: boolean;
};

// `responses` is replaced rather than intersected: an intersection of two array types is not
// the array of the intersection, and the reference needs the richer row.
export type ReferenceEndpoint = Omit<DocsEndpoint, "responses"> & {
  summary: string;
  tag: string;
  browserSession: boolean;
  parameters: ReferenceParameter[];
  responses: ReferenceResponse[];
};

export type ReferenceGroup = {
  name: string;
  slug: string;
  description: string;
  endpoints: ReferenceEndpoint[];
};

type SchemaNode = Record<string, unknown>;

type Operation = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  "x-tavonel-scope"?: string;
  "x-tavonel-auth"?: string;
  parameters?: Array<Record<string, unknown>>;
  requestBody?: { content?: Record<string, { schema?: SchemaNode; examples?: Record<string, { value?: unknown }> }> };
  responses?: Record<string, {
    description?: string;
    "x-tavonel-error-codes"?: string[];
    content?: Record<string, { schema?: SchemaNode; examples?: Record<string, { value?: unknown }> }>;
  }>;
};

type PathItem = Record<string, unknown> & { servers?: Array<{ url: string }> };

type Document = {
  servers: Array<{ url: string }>;
  tags: Array<{ name: string; description: string }>;
  paths: Record<string, PathItem>;
  components: { parameters?: Record<string, Record<string, unknown>>; schemas?: Record<string, SchemaNode> };
};

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

/** `#/components/parameters/CollectionId` -> the object it names. */
function resolve(document: Document, node: Record<string, unknown>): Record<string, unknown> {
  const ref = node.$ref;
  if (typeof ref !== "string") return node;
  const name = ref.split("/").pop()!;
  return document.components.parameters?.[name] ?? node;
}

/**
 * A schema as one line a person can read.
 *
 * Not a schema tree: a reference that renders JSON Schema verbatim has substituted one unreadable
 * artifact for another, and the artifact itself is one link away for anyone who wants it.
 */
function shapeOf(schema: unknown): string {
  if (!schema || typeof schema !== "object") return "any";
  const node = schema as SchemaNode;
  if (Array.isArray(node.enum)) return node.enum.map((value) => JSON.stringify(value)).join(" | ");
  if (node.const !== undefined) return JSON.stringify(node.const);
  const type = Array.isArray(node.type) ? node.type.join(" | ") : String(node.type ?? "any");
  const bounds: string[] = [];
  if (typeof node.pattern === "string") bounds.push(node.pattern);
  if (typeof node.format === "string") bounds.push(node.format);
  if (typeof node.minimum === "number" || typeof node.maximum === "number") {
    bounds.push(`${node.minimum ?? ""}–${node.maximum ?? ""}`);
  }
  if (typeof node.minLength === "number" || typeof node.maxLength === "number") {
    bounds.push(`${node.minLength ?? 0}–${node.maxLength ?? ""} chars`);
  }
  if (node.default !== undefined) bounds.push(`default ${JSON.stringify(node.default)}`);
  return bounds.length > 0 ? `${type} (${bounds.join(", ")})` : type;
}

function firstExample(content: Record<string, { examples?: Record<string, { value?: unknown }> }> | undefined) {
  for (const media of Object.values(content ?? {})) {
    const example = Object.values(media.examples ?? {})[0]?.value;
    if (example !== undefined) return JSON.stringify(example, null, 2);
  }
  return null;
}

function isBestEffort(content: Record<string, { schema?: SchemaNode }> | undefined) {
  return Object.values(content ?? {}).some((media) => {
    const schema = media.schema;
    if (!schema) return false;
    // The marker sits on the schema itself or on a property of it; one level is enough to say so.
    if (schema["x-tavonel-status"] === "best-effort") return true;
    const properties = schema.properties as Record<string, SchemaNode> | undefined;
    return Object.values(properties ?? {}).some((value) => value["x-tavonel-status"] === "best-effort");
  });
}

/** The same one-line JSON example the docs endpoint blocks use, taken from the contract's own. */
function requestExample(operation: Operation): string | null {
  const content = operation.requestBody?.content;
  const example = firstExample(content);
  if (example) return example;
  const schema = content?.["application/json"]?.schema;
  return schema ? JSON.stringify(placeholders(schema), null, 2) : null;
}

function placeholders(schema: SchemaNode): unknown {
  const properties = schema.properties as Record<string, SchemaNode> | undefined;
  if (schema.type !== "object" || !properties) return {};
  const body: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(properties)) body[key] = placeholder(key, property);
  return body;
}

function placeholder(key: string, property: SchemaNode): unknown {
  if (property.type === "array") {
    const items = (property.items ?? {}) as SchemaNode;
    return [placeholder(key, items)];
  }
  if (property.type === "integer" || property.type === "number") {
    return typeof property.minimum === "number" ? property.minimum : 0;
  }
  if (Array.isArray(property.enum)) return property.enum[0];
  return `<${key}>`;
}

let cached: { groups: ReferenceGroup[]; operationCount: number; server: string; unversionedServer: string } | null = null;

export async function readApiReference() {
  if (cached) return cached;
  const document = await openApiRoute(new Request("https://tavonel.com/api/openapi")).json() as Document;
  const defaultServer = document.servers[0]!.url;

  const endpoints: ReferenceEndpoint[] = [];
  for (const [path, item] of Object.entries(document.paths)) {
    const server = item.servers?.[0]?.url ?? defaultServer;
    for (const method of METHODS) {
      const operation = item[method] as Operation | undefined;
      if (!operation?.operationId) continue;
      endpoints.push({
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path,
        server,
        scope: operation["x-tavonel-scope"] ?? null,
        description: operation.description ?? "",
        summary: operation.summary ?? operation.operationId,
        tag: operation.tags?.[0] ?? "Other",
        browserSession: operation["x-tavonel-auth"] === "browser-session",
        requestExample: requestExample(operation),
        parameters: (operation.parameters ?? []).map((raw) => {
          const parameter = resolve(document, raw);
          return {
            name: String(parameter.name),
            in: String(parameter.in),
            required: parameter.required === true,
            shape: shapeOf(parameter.schema),
            description: typeof parameter.description === "string" ? parameter.description : "",
          };
        }),
        responses: Object.entries(operation.responses ?? {}).map(([status, response]) => ({
          status,
          description: response.description ?? "",
          codes: response["x-tavonel-error-codes"] ?? [],
          example: firstExample(response.content),
          bestEffort: isBestEffort(response.content),
        })),
      });
    }
  }

  const groups = document.tags
    .map((tag) => ({
      name: tag.name,
      slug: tag.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      description: tag.description,
      endpoints: endpoints.filter((endpoint) => endpoint.tag === tag.name),
    }))
    // Fail visible rather than render an empty heading: a tag with no operations is a contract bug.
    .filter((group) => group.endpoints.length > 0);

  const grouped = groups.reduce((total, group) => total + group.endpoints.length, 0);
  if (grouped !== endpoints.length) {
    throw new Error(`${endpoints.length - grouped} operations carry a tag the contract does not declare`);
  }

  cached = {
    groups,
    operationCount: endpoints.length,
    server: defaultServer,
    unversionedServer: endpoints.find((endpoint) => endpoint.server !== defaultServer)?.server ?? defaultServer,
  };
  return cached;
}
