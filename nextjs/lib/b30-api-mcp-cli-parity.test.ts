import { execFile } from "node:child_process";
import { createServer as createHttpServer, type Server } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, createServer, TOOLS, validateInput } from "../public/developer/tavonel-mcp.mjs";

/*
  B30 parity gate. The HTTP fixture is only the transport boundary; MCP and CLI are the exact
  published files. The assertions cover action discovery, aliases, limits, success envelopes,
  authorization and fail-closed response validation without a deployment credential.
*/

const run = promisify(execFile);
const COLLECTION = `collection-${"a".repeat(32)}`;
const API_KEY = "tvnl_live_b30_contract_principal";
const MANIFEST = `sha256:${"b".repeat(64)}`;
const QUESTION = "What are the payment terms?";
const SEARCH = "payment terms";

const pointer = { collectionId: COLLECTION, manifestDigest: MANIFEST, worldStateId: "world-b30", revision: 7 };
const worldModel = { code: "OK", model: { world: pointer, contract: { schemaVersion: "tavonel.world.v1" }, objects: [], relations: [], evidence: [] } };
const worldHistory = { code: "OK", activeWorld: pointer, versions: [{ ...pointer, state: "active" }] };
const packet = { worldId: COLLECTION, worldVersion: "7", retrievalProfile: "production", question: SEARCH, items: [], heldConflicts: [], abstentionReasons: [] };
const searchResult = { code: "SEARCH_EMPTY", retrievalPath: "compiled-retrieval-v1", contextPacket: packet, degradations: [], retrieval: {}, activeWorld: pointer, freshness: { state: "current" } };
const answer = { code: "GROUNDED_ANSWER", retrievalPath: "compiled-retrieval-v1", answerMode: "evidence_excerpts", answer: "Payment is due net 30 days.", citations: [], activeWorld: pointer, receipt: { manifestDigest: MANIFEST } };
const worlds = { code: "COLLECTIONS_LISTED", collections: [pointer], page: { limit: 50, cursor: null, nextCursor: null } };
const objects = { code: "OK", world: pointer, objects: [{ id: `claim-${"c".repeat(32)}` }], page: { limit: 5, cursor: null, nextCursor: null, total: 1 } };

type Call = { method: string; pathname: string; authorization: string; body: unknown };
type ToolReply = { result?: { content: Array<{ type: string; text: string }>; isError: boolean } };
let httpServer!: Server;
let baseUrl = "";
const calls: Call[] = [];

beforeAll(async () => {
  httpServer = createHttpServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://contract.test").pathname;
    const finish = (body: unknown, status = 200) => {
      response.statusCode = status;
      response.setHeader("content-type", "application/json");
      response.setHeader("x-tavonel-api-version", "1");
      response.end(JSON.stringify(body));
    };
    if (request.headers.authorization !== `Bearer ${API_KEY}`) return finish({ code: "API_KEY_SCOPE_MISSING" }, 403);
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      calls.push({ method: request.method ?? "GET", pathname, authorization: request.headers.authorization ?? "", body });
      if (pathname === "/api/v1/collections") return finish(worlds);
      if (pathname === `/api/v1/world/${COLLECTION}`) return finish(worldModel);
      if (pathname === `/api/v1/collections/${COLLECTION}/world`) return finish(worldHistory);
      if (pathname === `/api/v1/world/${COLLECTION}/objects`) return finish(objects);
      if (pathname === `/api/v1/collections/${COLLECTION}/ask`) return finish(answer);
      if (pathname === `/api/v1/collections/${COLLECTION}/search`) {
        return finish((body as { query?: string })?.query === "malformed" ? { code: "SEARCH_EMPTY" } : searchResult);
      }
      return finish({ code: "ROUTE_NOT_FOUND" }, 404);
    });
  });
  await new Promise<void>((done) => httpServer.listen(0, "127.0.0.1", done));
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("B30 fixture did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  httpServer.closeAllConnections();
  await new Promise<void>((done, reject) => httpServer.close((error) => error ? reject(error) : done()));
});

function handler(key = API_KEY) {
  return createServer({ call: createClient({ baseUrl, apiKey: key }) }) as (message: unknown) => Promise<ToolReply>;
}

async function mcp(name: string, input: Record<string, unknown>, key = API_KEY) {
  const reply = await handler(key)({ jsonrpc: "2.0", id: "b30", method: "tools/call", params: { name, arguments: input } });
  const result = reply.result!;
  return { isError: result.isError, text: result.content[0]!.text };
}

async function cli(args: string[], key = API_KEY) {
  return run(process.execPath, [resolve(import.meta.dirname, "../public/developer/tavonel-cli.mjs"), ...args], {
    env: { ...process.env, TAVONEL_BASE_URL: baseUrl, TAVONEL_API_KEY: key },
    timeout: 10_000,
  });
}

describe("B30 API, MCP and CLI parity", () => {
  it("publishes a CLI action or alias for every MCP read tool", async () => {
    const help = (await cli(["help"])).stdout;
    expect(TOOLS.map((tool: { name: string }) => tool.name)).toEqual([
      "list_sources", "list_worlds", "get_world", "search_world", "ask_world",
      "get_object", "get_relation", "get_evidence", "download_package",
    ]);
    for (const tool of TOOLS) expect(help, tool.name).toContain(tool.name);
  });

  it("sends search_world through all three surfaces with the same principal and envelope", async () => {
    calls.length = 0;
    const direct = await fetch(`${baseUrl}/api/v1/collections/${COLLECTION}/search`, {
      method: "POST", headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ query: SEARCH, limit: 25 }),
    }).then((response) => response.json());
    const throughMcp = JSON.parse((await mcp("search_world", { collectionId: COLLECTION, query: SEARCH, limit: 25 })).text);
    const throughCli = JSON.parse((await cli(["search_world", COLLECTION, SEARCH, "--limit", "25"])).stdout);
    expect(throughMcp).toEqual(direct);
    expect(throughCli).toEqual(direct);
    expect(calls.map((call) => call.authorization)).toEqual(Array(3).fill(`Bearer ${API_KEY}`));
    expect(calls.map((call) => call.body)).toEqual(Array(3).fill({ query: SEARCH, limit: 25 }));
  });

  it("uses the API's 1-25 search bound while keeping 1-50 pagination", async () => {
    const search = TOOLS.find((tool: { name: string }) => tool.name === "search_world")!;
    const list = TOOLS.find((tool: { name: string }) => tool.name === "list_worlds")!;
    expect(validateInput(search, { collectionId: COLLECTION, query: SEARCH, limit: 25 }).limit).toBe(25);
    expect(() => validateInput(search, { collectionId: COLLECTION, query: SEARCH, limit: 26 })).toThrow("1 to 25");
    expect(validateInput(list, { limit: 50 }).limit).toBe(50);
    expect(() => validateInput(list, { limit: 51 })).toThrow("1 to 50");
    await expect(cli(["search", COLLECTION, SEARCH, "--limit", "26"])).rejects.toMatchObject({ stderr: expect.stringContaining("1 to 25") });
  });

  it("keeps the legacy world envelope and gives get_world the MCP/API envelope", async () => {
    const direct = await fetch(`${baseUrl}/api/v1/world/${COLLECTION}`, { headers: { authorization: `Bearer ${API_KEY}` } }).then((response) => response.json());
    expect(JSON.parse((await mcp("get_world", { collectionId: COLLECTION })).text)).toEqual(direct);
    expect(JSON.parse((await cli(["get_world", COLLECTION])).stdout)).toEqual(direct);
    expect(JSON.parse((await cli(["world", COLLECTION])).stdout)).toEqual(worldHistory);
  });

  it("keeps discovery, lens and ask envelopes byte-for-field compatible", async () => {
    expect(JSON.parse((await mcp("list_worlds", {})).text)).toEqual(JSON.parse((await cli(["list_worlds"])).stdout));
    expect(JSON.parse((await mcp("get_object", { collectionId: COLLECTION, limit: 5 })).text)).toEqual(JSON.parse((await cli(["get_object", COLLECTION, "--limit", "5"])).stdout));
    expect(JSON.parse((await mcp("ask_world", { collectionId: COLLECTION, question: QUESTION })).text)).toEqual(JSON.parse((await cli(["ask_world", COLLECTION, QUESTION])).stdout));
  });

  it("refuses a malformed 2xx success body at MCP and CLI boundaries", async () => {
    const mcpResult = await mcp("search_world", { collectionId: COLLECTION, query: "malformed" });
    expect(mcpResult).toEqual({ isError: true, text: "API_SUCCESS_SCHEMA_INVALID: search_world" });
    await expect(cli(["search", COLLECTION, "malformed"])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("API_SUCCESS_SCHEMA_INVALID: search"),
    });
  });

  it("preserves stable authorization failures", async () => {
    expect(await mcp("get_world", { collectionId: COLLECTION }, "tvnl_live_denied")).toEqual({
      isError: true,
      text: "API_ERROR_403: API_KEY_SCOPE_MISSING",
    });
    await expect(cli(["get_world", COLLECTION], "tvnl_live_denied")).rejects.toMatchObject({
      stderr: expect.stringContaining("API_KEY_SCOPE_MISSING"),
    });
  });
});
