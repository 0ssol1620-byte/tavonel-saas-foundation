/**
 * The TAVONEL MCP server: read-only access to a Compiled World, for agents.
 *
 * Masterplan 22.2 asks for this and states the constraint that shapes it: "write/promotion은
 * browser session과 human gate로 유지한다." Promotion is the moment a candidate becomes the World
 * an organisation answers from, and it stays behind a person in a browser. So this server has no
 * write tool, and it cannot grow one by accident -- every tool declares the request it makes, and
 * `assertReadOnly` refuses to start if any of them is not a read.
 *
 *   TAVONEL_API_KEY=sk_... node scripts/mcp/tavonel-mcp-server.mjs
 *   TAVONEL_API_BASE_URL=https://tavonel.com/api   (default)
 *
 * Transport is stdio with newline-delimited JSON-RPC 2.0, which is what the MCP stdio transport
 * specifies, so this needs no dependency and no build step. It is a file you can read before
 * pointing an agent at your own knowledge.
 *
 * What it deliberately does not offer:
 *
 *   list_worlds -- 22.2 names it, and the API has no endpoint that lists a workspace's
 *   collections. A tool that answered by guessing at ids, or by returning an empty array, would
 *   be a tool that lies when it is wrong. It is absent, and `tools/list` says why in the same
 *   place a developer looks for it.
 *
 *   download_package returns a descriptor -- url, size, manifest digest, signing key id -- and
 *   not the archive. Base64ing up to 64 MiB through a pipe to hand back bytes the caller must
 *   verify anyway is worse than telling them exactly what to fetch and what it should hash to.
 *
 * No file is written, no shell is run, and the only network destination is the configured API
 * base. A document is hostile data; so is a tool argument.
 */

/**
 * Kept equal to `lib/api-version.ts` by `lib/mcp-server.test.ts`.
 *
 * The server reports the contract version it speaks, and this file cannot import a TypeScript
 * constant, so the test is what stops the two from drifting.
 */
export const SERVER_VERSION = "2026-09-02.1";
export const PROTOCOL_VERSION = "2025-06-18";
export const DEFAULT_BASE_URL = "https://tavonel.com/api";

const COLLECTION_ID = /^collection-[a-f0-9]{32}$/;
const STABLE_ID = /^[a-z-]+-[a-f0-9]{32}$/;
const MAX_QUERY = 500;

const collectionProperty = {
  type: "string",
  pattern: "^collection-[a-f0-9]{32}$",
  description: "The Compiled World to read. Collection ids are content-derived and stable.",
};

/**
 * Every tool, and the exact request it makes.
 *
 * The request lives in the table rather than inside each handler so that "does this server
 * write?" is a question about data, answerable by reading twenty lines, instead of a question
 * about control flow.
 */
export const TOOLS = [
  {
    name: "list_sources",
    description: "The documents in the workspace, with their processing state and version key.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    request: () => ({ method: "GET", path: "/v1/documents" }),
  },
  {
    name: "get_world",
    description:
      "One Compiled World: its status, contract, objects, relations, evidence and history. " +
      "There is no tool that lists worlds -- the API has no endpoint that does.",
    inputSchema: {
      type: "object",
      properties: { collectionId: collectionProperty },
      required: ["collectionId"],
      additionalProperties: false,
    },
    request: (input) => ({ method: "GET", path: `/v1/world/${input.collectionId}` }),
  },
  {
    name: "search_world",
    description:
      "Retrieved regions with their provenance and ranks, and no generated prose. Use this when " +
      "the agent will decide for itself; use ask_world when it wants an answer.",
    inputSchema: {
      type: "object",
      properties: {
        collectionId: collectionProperty,
        query: { type: "string", minLength: 3, maxLength: MAX_QUERY },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["collectionId", "query"],
      additionalProperties: false,
    },
    request: (input) => ({
      method: "POST",
      path: `/v1/collections/${input.collectionId}/search`,
      body: input.limit === undefined ? { query: input.query } : { query: input.query, limit: input.limit },
    }),
  },
  {
    name: "ask_world",
    description:
      "A grounded answer with its citations, or an abstention. The World abstains rather than " +
      "answering from outside its sources, and the abstention is the useful reply.",
    inputSchema: {
      type: "object",
      properties: {
        collectionId: collectionProperty,
        question: { type: "string", minLength: 3, maxLength: MAX_QUERY },
      },
      required: ["collectionId", "question"],
      additionalProperties: false,
    },
    request: (input) => ({
      method: "POST",
      path: `/v1/collections/${input.collectionId}/ask`,
      body: { question: input.question },
    }),
  },
  {
    name: "get_object",
    description: "The objects lens. Pass objectId to return one object instead of all of them.",
    inputSchema: {
      type: "object",
      properties: { collectionId: collectionProperty, objectId: { type: "string", pattern: STABLE_ID.source } },
      required: ["collectionId"],
      additionalProperties: false,
    },
    request: (input) => ({ method: "GET", path: `/v1/world/${input.collectionId}/objects` }),
    select: (payload, input) => selectById(payload, "objects", input.objectId),
  },
  {
    name: "get_relation",
    description: "The relations lens. Pass relationId to return one relation instead of all of them.",
    inputSchema: {
      type: "object",
      properties: { collectionId: collectionProperty, relationId: { type: "string", pattern: STABLE_ID.source } },
      required: ["collectionId"],
      additionalProperties: false,
    },
    request: (input) => ({ method: "GET", path: `/v1/world/${input.collectionId}/relations` }),
    select: (payload, input) => selectById(payload, "relations", input.relationId),
  },
  {
    name: "get_evidence",
    description:
      "The evidence lens: every region with its source version, page and bbox in the 0-1000 " +
      "page frame. Pass evidenceId to return one region.",
    inputSchema: {
      type: "object",
      properties: { collectionId: collectionProperty, evidenceId: { type: "string", pattern: STABLE_ID.source } },
      required: ["collectionId"],
      additionalProperties: false,
    },
    request: (input) => ({ method: "GET", path: `/v1/world/${input.collectionId}/evidence` }),
    select: (payload, input) => selectById(payload, "evidence", input.evidenceId),
  },
  {
    name: "download_package",
    description:
      "Where the signed Compiled World Package is, how large it is, and what its signed manifest " +
      "hashes to. The archive itself is fetched over HTTP with the same key and checked with " +
      "scripts/verify-signed-export.mjs; the bytes do not travel through this transport.",
    inputSchema: {
      type: "object",
      properties: { collectionId: collectionProperty },
      required: ["collectionId"],
      additionalProperties: false,
    },
    request: (input) => ({ method: "GET", path: `/v1/collections/${input.collectionId}/download`, headersOnly: true }),
  },
];

/**
 * The gate that keeps 22.2's constraint true as the file grows.
 *
 * A GET is a read. A POST is a read only where the endpoint's own contract says so -- /search and
 * /ask take a body because a question does not fit in a URL, not because they change anything.
 * Any other write, and the server refuses to start rather than exposing it.
 */
const READ_ONLY_POSTS = new Set(["search", "ask"]);

export function assertReadOnly(tools = TOOLS) {
  const sample = { collectionId: `collection-${"0".repeat(32)}`, query: "sample query", question: "sample question" };
  for (const tool of tools) {
    const request = tool.request(sample);
    if (request.method === "GET") continue;
    const tail = request.path.split("/").pop();
    if (request.method === "POST" && READ_ONLY_POSTS.has(tail)) continue;
    throw new Error(`MCP_WRITE_TOOL_REFUSED: ${tool.name} makes a ${request.method} to ${request.path}`);
  }
  return true;
}

function selectById(payload, key, id) {
  if (!id) return payload;
  const items = Array.isArray(payload?.[key]) ? payload[key] : [];
  const found = items.find((item) => item?.id === id);
  if (!found) throw new Error(`NOT_FOUND: no ${key.replace(/s$/, "")} ${id} in this World`);
  return { ...payload, [key]: [found] };
}

/** Argument validation, before anything reaches the network. */
export function validateInput(tool, input) {
  const value = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const schema = tool.inputSchema;
  for (const key of Object.keys(value)) {
    if (!schema.properties[key]) throw new Error(`INPUT_INVALID: ${tool.name} has no argument "${key}"`);
  }
  for (const key of schema.required ?? []) {
    if (typeof value[key] !== "string" || value[key].length === 0) {
      throw new Error(`INPUT_INVALID: ${tool.name} requires ${key}`);
    }
  }
  if (typeof value.collectionId === "string" && !COLLECTION_ID.test(value.collectionId)) {
    // The id goes into a path. A value that is not a collection id has no business being there,
    // whoever put it in the argument.
    throw new Error("INPUT_INVALID: collectionId is not a collection id");
  }
  for (const key of ["objectId", "relationId", "evidenceId"]) {
    if (value[key] !== undefined && !STABLE_ID.test(String(value[key]))) {
      throw new Error(`INPUT_INVALID: ${key} is not a stable id`);
    }
  }
  for (const key of ["query", "question"]) {
    const text = value[key];
    if (text === undefined) continue;
    const normalized = String(text).normalize("NFKC").replace(/\s+/g, " ").trim();
    if (normalized.length < 3 || String(text).length > MAX_QUERY) {
      throw new Error(`INPUT_INVALID: ${key} must be 3 to ${MAX_QUERY} characters`);
    }
  }
  if (value.limit !== undefined && (!Number.isInteger(value.limit) || value.limit < 1 || value.limit > 50)) {
    throw new Error("INPUT_INVALID: limit must be an integer from 1 to 50");
  }
  return value;
}

export function createClient({ baseUrl, apiKey, fetcher = fetch }) {
  const base = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  return async function call(request) {
    const response = await fetcher(`${base}${request.path}`, {
      method: request.method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: "application/json",
        ...(request.body ? { "content-type": "application/json" } : {}),
      },
      ...(request.body ? { body: JSON.stringify(request.body) } : {}),
    });
    if (request.headersOnly) {
      // A package can be tens of megabytes. Read what identifies it and drop the stream.
      const descriptor = {
        url: `${base}${request.path}`,
        status: response.status,
        sizeBytes: Number(response.headers.get("content-length") ?? "0"),
        manifestSha256: response.headers.get("x-tavonel-export-manifest-sha256"),
        signingKeyId: response.headers.get("x-tavonel-export-key-id"),
        candidatePromotion: response.headers.get("x-tavonel-candidate-promotion"),
        verifyWith: "node scripts/verify-signed-export.mjs --archive <file> --trusted-fingerprint sha256:<64 hex>",
      };
      await response.body?.cancel?.();
      if (!response.ok) throw new Error(`API_ERROR_${response.status}`);
      return descriptor;
    }
    const text = await response.text();
    let payload;
    try {
      payload = text.length > 0 ? JSON.parse(text) : {};
    } catch {
      throw new Error(`API_RESPONSE_UNREADABLE_${response.status}`);
    }
    if (!response.ok) {
      // The API's own code, not a paraphrase: the agent's next decision depends on which one.
      throw new Error(`API_ERROR_${response.status}: ${payload.code ?? "UNKNOWN"}`);
    }
    return payload;
  };
}

export function createServer({ call }) {
  const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));

  async function callTool(name, input) {
    const tool = byName.get(name);
    if (!tool) throw new Error(`TOOL_NOT_FOUND: ${name}`);
    const value = validateInput(tool, input);
    const payload = await call(tool.request(value));
    return tool.select ? tool.select(payload, value) : payload;
  }

  return async function handle(message) {
    const { id, method, params } = message ?? {};
    const reply = (result) => ({ jsonrpc: "2.0", id, result });
    switch (method) {
      case "initialize":
        return reply({
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "tavonel", title: "TAVONEL Compiled World", version: SERVER_VERSION },
          instructions:
            "Read-only access to a Compiled World. Every answer is bound to a source version, a " +
            "page and a region; an ungrounded question is abstained from rather than answered. " +
            "Promotion and every other write stay with a person in a browser.",
        });
      case "notifications/initialized":
        return null;
      case "ping":
        return reply({});
      case "tools/list":
        return reply({
          tools: TOOLS.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
          })),
        });
      case "tools/call": {
        try {
          const result = await callTool(params?.name, params?.arguments);
          return reply({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false });
        } catch (error) {
          /*
            A failed tool is a result, not a protocol error: the agent has to see what went wrong
            to choose its next step, and a JSON-RPC error would take the message away from it.
          */
          return reply({
            content: [{ type: "text", text: error instanceof Error ? error.message : "TOOL_FAILED" }],
            isError: true,
          });
        }
      }
      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${String(method)}` } };
    }
  };
}

/* ------------------------------------------------------------------- process */

async function main() {
  assertReadOnly();
  const apiKey = process.env.TAVONEL_API_KEY;
  if (!apiKey) {
    process.stderr.write("TAVONEL_API_KEY is not set. Create a key in the workspace under Developer.\n");
    process.exitCode = 2;
    return;
  }
  const handle = createServer({ call: createClient({ baseUrl: process.env.TAVONEL_API_BASE_URL, apiKey }) });

  let buffer = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (line.length === 0) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
        continue;
      }
      const response = await handle(message);
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  }
}

if (process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "tavonel-mcp-server.mjs") {
  await main();
}
