/**
 * The TAVONEL MCP server: read-only access to a Compiled World, for agents.
 *
 * Masterplan 22.2 asks for this and states the constraint that shapes it: "write/promotion은
 * browser session과 human gate로 유지한다." Promotion is the moment a candidate becomes the World
 * an organisation answers from, and it stays behind a person in a browser. So this server has no
 * write tool, and it cannot grow one by accident -- every tool declares the request it makes, and
 * `assertReadOnly` refuses to start if any of them is not a read.
 *
 *   TAVONEL_API_KEY=tvnl_live_... node tavonel-mcp.mjs
 *   TAVONEL_BASE_URL=https://tavonel.com           (default)
 *   node tavonel-mcp.mjs --version                 (record the exact build before registering it)
 *   node tavonel-mcp.mjs --doctor                  (check the key, the channel and one real read)
 *
 * Transport is stdio with newline-delimited JSON-RPC 2.0, which is what the MCP stdio transport
 * specifies, so this needs no dependency and no build step. It is a file you can read before
 * pointing an agent at your own knowledge.
 *
 * `list_worlds` arrived in this release. It was absent for a real reason -- the API had no
 * endpoint that listed a workspace's collections, and a tool that guessed at ids would be a tool
 * that lies when it is wrong -- and it is present now because that endpoint exists
 * (GET /api/v1/collections). It lists only ACTIVE Worlds: a candidate nobody promoted is not
 * organizational truth, and a discovery list that mixed the two would hand an agent a set in
 * which some entries are authoritative and some are not.
 *
 * What it deliberately does not offer:
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
export const DEFAULT_BASE_URL = "https://tavonel.com";

/**
 * The published distribution version, pinned by sha256 in `channel.json`.
 *
 * Separate from `SERVER_VERSION`, which is the API contract this speaks. A rebuild that changes
 * these bytes changes this; a change to what the API answers changes that.
 */
export const DISTRIBUTION_VERSION = "2026.9.11.1";
export const API_VERSION_HEADER = "1";

const COLLECTION_ID = /^collection-[a-f0-9]{32}$/;
const STABLE_ID = /^[a-z-]+-[a-f0-9]{32}$/;
const MAX_QUERY = 500;

const collectionProperty = {
  type: "string",
  pattern: "^collection-[a-f0-9]{32}$",
  description: "The Compiled World to read. Collection ids are content-derived and stable.",
};

/**
 * One pagination idiom for the whole surface.
 *
 * `search_world` already bounded its `limit` at 1 to 50, and the lens tools had no bound at all:
 * they fetched an entire World's objects, relations or evidence in one response and filtered
 * client-side. Reusing these two properties -- rather than inventing a second convention for the
 * lenses -- is what keeps "how do I page this" a question with one answer (audit X06).
 *
 * Omitting `limit` still returns the whole lens, because defaulting to a page would silently
 * truncate a by-id lookup into NOT_FOUND for anything past the first page.
 */
const limitProperty = { type: "integer", minimum: 1, maximum: 50 };
const cursorProperty = {
  type: "string",
  description: "The last id from the previous page. Requires limit. Keyset, not an offset.",
};

/** Adds the page parameters to a lens GET only when the caller actually asked for a page. */
function lensPath(collectionId, lens, input) {
  const query = new URLSearchParams();
  if (input.limit !== undefined) query.set("limit", String(input.limit));
  if (input.cursor !== undefined) query.set("cursor", input.cursor);
  const suffix = query.size > 0 ? `?${query}` : "";
  return `/api/v1/world/${collectionId}/${lens}${suffix}`;
}

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
    request: () => ({ method: "GET", path: "/api/v1/documents" }),
  },
  {
    name: "list_worlds",
    description:
      "The workspace's active Compiled Worlds, newest promotions included, with each one's " +
      "manifest digest and revision. Start here when you do not already hold a collection id. " +
      "Candidates nobody promoted are not listed: they are not what this workspace answers from.",
    inputSchema: {
      type: "object",
      properties: { limit: limitProperty, cursor: cursorProperty },
      additionalProperties: false,
    },
    request: (input) => {
      const query = new URLSearchParams();
      if (input.limit !== undefined) query.set("limit", String(input.limit));
      if (input.cursor !== undefined) query.set("cursor", input.cursor);
      return { method: "GET", path: `/api/v1/collections${query.size > 0 ? `?${query}` : ""}` };
    },
  },
  {
    name: "get_world",
    description:
      "One Compiled World: its status, contract, freshness, objects, relations, evidence and " +
      "history. Use list_worlds first if you do not have a collection id.",
    inputSchema: {
      type: "object",
      properties: { collectionId: collectionProperty },
      required: ["collectionId"],
      additionalProperties: false,
    },
    request: (input) => ({ method: "GET", path: `/api/v1/world/${input.collectionId}` }),
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
      path: `/api/v1/collections/${input.collectionId}/search`,
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
      path: `/api/v1/collections/${input.collectionId}/ask`,
      body: { question: input.question },
    }),
  },
  {
    name: "get_object",
    description:
      "The objects lens. Pass objectId to return one object, or limit and cursor to walk a " +
      "large World a page at a time instead of fetching every object at once.",
    inputSchema: {
      type: "object",
      properties: {
        collectionId: collectionProperty,
        objectId: { type: "string", pattern: STABLE_ID.source },
        limit: limitProperty,
        cursor: cursorProperty,
      },
      required: ["collectionId"],
      additionalProperties: false,
    },
    request: (input) => ({ method: "GET", path: lensPath(input.collectionId, "objects", input) }),
    select: (payload, input) => selectById(payload, "objects", input.objectId),
  },
  {
    name: "get_relation",
    description:
      "The relations lens. Pass relationId to return one relation, or limit and cursor to walk " +
      "the graph a page at a time.",
    inputSchema: {
      type: "object",
      properties: {
        collectionId: collectionProperty,
        relationId: { type: "string", pattern: STABLE_ID.source },
        limit: limitProperty,
        cursor: cursorProperty,
      },
      required: ["collectionId"],
      additionalProperties: false,
    },
    request: (input) => ({ method: "GET", path: lensPath(input.collectionId, "relations", input) }),
    select: (payload, input) => selectById(payload, "relations", input.relationId),
  },
  {
    name: "get_evidence",
    description:
      "The evidence lens: every region with its source version, page and bbox in the 0-1000 " +
      "page frame. Pass evidenceId to return one region, or limit and cursor to page.",
    inputSchema: {
      type: "object",
      properties: {
        collectionId: collectionProperty,
        evidenceId: { type: "string", pattern: STABLE_ID.source },
        limit: limitProperty,
        cursor: cursorProperty,
      },
      required: ["collectionId"],
      additionalProperties: false,
    },
    request: (input) => ({ method: "GET", path: lensPath(input.collectionId, "evidence", input) }),
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
    request: (input) => ({ method: "GET", path: `/api/v1/collections/${input.collectionId}/download`, headersOnly: true }),
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
  if (value.cursor !== undefined) {
    // A cursor is an id the previous page handed back, and it goes into a query string. The
    // pattern is what an id can be -- an evidence cursor is `<evidenceId>:<blockId>` -- and
    // nothing that could carry another parameter or a path segment into the request.
    if (typeof value.cursor !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value.cursor)) {
      throw new Error("INPUT_INVALID: cursor is not a page cursor");
    }
    if (value.limit === undefined) throw new Error("INPUT_INVALID: cursor requires limit");
  }
  for (const key of ["objectId", "relationId", "evidenceId"]) {
    // Selecting one item happens after the response arrives, so a paged request plus an id
    // would report NOT_FOUND for an item sitting on a later page. Refused rather than answered
    // wrongly: ask for the id, or walk the pages, not both.
    if (value[key] !== undefined && (value.limit !== undefined || value.cursor !== undefined)) {
      throw new Error(`INPUT_INVALID: ${key} cannot be combined with limit or cursor`);
    }
  }
  return value;
}

export function createClient({ baseUrl, apiKey, fetcher = fetch }) {
  const base = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  return async function call(request) {
    /*
      The key is checked here rather than at startup. An MCP client initializes and lists tools
      before a person has finished configuring it, and a server that refuses to start without a
      credential looks broken at exactly the moment someone is setting it up.
    */
    if (!apiKey) throw new Error("API_KEY_MISSING: set TAVONEL_API_KEY to a key from your workspace");
    const response = await fetcher(`${base}${request.path}`, {
      method: request.method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        // The published media type. The API answers a version, and a mismatch is caught below.
        accept: "application/vnd.tavonel.v1+json",
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
    const served = response.headers.get("x-tavonel-api-version");
    if (served && served !== API_VERSION_HEADER) {
      // A newer contract may have moved a field this client reads. Stopping is the safe answer.
      throw new Error(`API_VERSION_UNSUPPORTED: served v${served}, this client speaks v${API_VERSION_HEADER}`);
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
          serverInfo: { name: "tavonel-readonly", title: "TAVONEL Compiled World", version: DISTRIBUTION_VERSION },
          instructions:
            "Read-only access to a Compiled World. Every answer is bound to a source version, a " +
            "page and a region; an ungrounded question is abstained from rather than answered. " +
            "No tool can upload, compile, promote, roll back, change billing or mutate " +
            "connectors: promotion is the moment a candidate becomes the World an organisation " +
            "answers from, and it stays with a person in a browser.",
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

/* -------------------------------------------------------------------- doctor */

/**
 * `--doctor`: from "I downloaded the file" to "it reads my knowledge", checked (audit U07).
 *
 * Four checks, in the order they fail in real life: is a key set, does this build match the
 * published channel, does the key authenticate against a real read, and does the workspace
 * actually have an active World to read. Each line is pass or fail plus what to do about it --
 * a diagnostic that prints a stack trace has told the operator nothing.
 *
 * It performs reads only, through the same `TOOLS` table and the same `assertReadOnly` gate the
 * server starts behind, so the doctor cannot reach an endpoint the server itself may not.
 */
export async function runDoctor({ baseUrl = DEFAULT_BASE_URL, apiKey = "", fetcher = fetch, now = () => new Date() } = {}) {
  assertReadOnly();
  const base = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const checks = [];
  const record = (name, ok, detail) => { checks.push({ name, ok, detail }); return ok; };

  if (!record("api_key", Boolean(apiKey), apiKey
    ? "TAVONEL_API_KEY is set"
    : "set TAVONEL_API_KEY to a key from Workspace > Developers")) {
    return { ok: false, checkedAt: now().toISOString(), baseUrl: base, distribution: DISTRIBUTION_VERSION, checks };
  }

  try {
    const response = await fetcher(`${base}/developer/channel.json`, { method: "GET" });
    const channel = response.ok ? await response.json() : null;
    const published = channel?.version ?? null;
    record("distribution_version", published === DISTRIBUTION_VERSION, published === null
      ? `could not read ${base}/developer/channel.json; this build is ${DISTRIBUTION_VERSION}`
      : published === DISTRIBUTION_VERSION
        ? `this build ${DISTRIBUTION_VERSION} matches the published channel`
        : `this build is ${DISTRIBUTION_VERSION}; the channel publishes ${published}. Download the new file and verify its sha256 before replacing this one -- nothing updates itself.`);
  } catch {
    record("distribution_version", false, `could not reach ${base}/developer/channel.json`);
  }

  const call = createClient({ baseUrl: base, apiKey, fetcher });
  const listWorlds = TOOLS.find((tool) => tool.name === "list_worlds");
  try {
    const payload = await call(listWorlds.request({ limit: 5 }));
    const collections = Array.isArray(payload?.collections) ? payload.collections : [];
    record("authenticated_read", true, "the key authenticated against GET /api/v1/collections");
    record("active_world", collections.length > 0, collections.length > 0
      ? `${collections.length} active World(s); first is ${collections[0].collectionId}`
      : "no active World in this workspace yet. Compile a collection and have a person promote it -- an API key cannot promote.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    const rejected = message.includes("API_ERROR_401") || message.includes("API_ERROR_403");
    // A 404 here is not a bad key: it is a deployment that predates GET /api/v1/collections.
    // Saying "the key was rejected" would send the operator to rotate a credential that works.
    const absent = message.includes("404");
    record("authenticated_read", false,
      rejected
        ? `${message} -- the key was rejected. Check it is not revoked and that it holds the collections:read scope.`
        : absent
          ? `${message} -- ${base} has no /api/v1/collections endpoint. That deployment predates world discovery; the key is not the problem.`
          : message);
    record("active_world", false, "not checked: the authenticated read did not succeed");
  }

  return {
    ok: checks.every((check) => check.ok),
    checkedAt: now().toISOString(),
    baseUrl: base,
    distribution: DISTRIBUTION_VERSION,
    checks,
  };
}

export function formatDoctor(report) {
  const lines = report.checks.map((check) => `${check.ok ? "PASS" : "FAIL"}  ${check.name}: ${check.detail}`);
  return [
    `tavonel-mcp ${report.distribution} doctor  ->  ${report.baseUrl}`,
    ...lines,
    report.ok ? "All checks passed. Register this file as a stdio MCP server." : "At least one check failed. Fix the first FAIL above and run --doctor again.",
  ].join("\n");
}

/* ------------------------------------------------------------------- process */

async function main() {
  assertReadOnly();
  const handle = createServer({
    call: createClient({ baseUrl: process.env.TAVONEL_BASE_URL, apiKey: process.env.TAVONEL_API_KEY }),
  });

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

if (process.argv.includes("--version")) {
  // Recorded before registration, so a support conversation can start from the exact build.
  process.stdout.write(`tavonel-mcp ${DISTRIBUTION_VERSION} (api v${API_VERSION_HEADER}, contract ${SERVER_VERSION})\n`);
} else if (process.argv.includes("--doctor")) {
  const report = await runDoctor({ baseUrl: process.env.TAVONEL_BASE_URL, apiKey: process.env.TAVONEL_API_KEY });
  process.stdout.write(`${formatDoctor(report)}\n`);
  // A non-zero exit so a setup script, a CI job or a support runbook can branch on it instead
  // of grepping the text.
  process.exitCode = report.ok ? 0 : 1;
} else if (process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "tavonel-mcp.mjs") {
  await main();
}
