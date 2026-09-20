import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import { createClient, createServer, TOOLS, validateInput } from "../nextjs/public/developer/tavonel-mcp.mjs";

const exec = promisify(execFile);
const COLLECTION = `collection-${"a".repeat(32)}`;
const KEY = "tvnl_live_b30_offline";
const pointer = { collectionId: COLLECTION, manifestDigest: `sha256:${"b".repeat(64)}`, worldStateId: "world-b30", revision: 7 };
const packet = { worldId: COLLECTION, worldVersion: "7", retrievalProfile: "production", question: "payment terms", items: [], heldConflicts: [], abstentionReasons: [] };
const search = { code: "SEARCH_EMPTY", retrievalPath: "compiled-retrieval-v1", contextPacket: packet, degradations: [], retrieval: {}, activeWorld: pointer };
const world = { code: "OK", model: { world: pointer, contract: { schemaVersion: "tavonel.world.v1" } } };
const history = { code: "OK", activeWorld: pointer, versions: [{ ...pointer, state: "active" }] };
let server;
let baseUrl;
const calls = [];

before(async () => {
  server = createHttpServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://fixture").pathname;
    const finish = (body, status = 200) => {
      response.writeHead(status, { "content-type": "application/json", "x-tavonel-api-version": "1" });
      response.end(JSON.stringify(body));
    };
    if (request.headers.authorization !== `Bearer ${KEY}`) return finish({ code: "API_KEY_SCOPE_MISSING" }, 403);
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      calls.push({ path, body, authorization: request.headers.authorization });
      if (path === `/api/v1/world/${COLLECTION}`) return finish(world);
      if (path === `/api/v1/collections/${COLLECTION}/world`) return finish(history);
      if (path === `/api/v1/collections/${COLLECTION}/search`) return finish(body?.query === "malformed" ? { code: "SEARCH_EMPTY" } : search);
      return finish({ code: "ROUTE_NOT_FOUND" }, 404);
    });
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
});

async function mcp(name, input, key = KEY) {
  const handle = createServer({ call: createClient({ baseUrl, apiKey: key }) });
  const reply = await handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: input } });
  return { isError: reply.result.isError, text: reply.result.content[0].text };
}

async function cli(args, key = KEY) {
  return exec(process.execPath, [resolve(import.meta.dirname, "../nextjs/public/developer/tavonel-cli.mjs"), ...args], {
    env: { ...process.env, TAVONEL_BASE_URL: baseUrl, TAVONEL_API_KEY: key },
  });
}

test("CLI advertises every MCP read action", async () => {
  const help = (await cli(["help"])).stdout;
  for (const tool of TOOLS) assert.match(help, new RegExp(`\\b${tool.name}\\b`));
});

test("search envelope, principal and 1-25 limit agree", async () => {
  calls.length = 0;
  const mcpPayload = JSON.parse((await mcp("search_world", { collectionId: COLLECTION, query: "payment terms", limit: 25 })).text);
  const cliPayload = JSON.parse((await cli(["search_world", COLLECTION, "payment terms", "--limit", "25"])).stdout);
  assert.deepEqual(mcpPayload, search);
  assert.deepEqual(cliPayload, search);
  assert.deepEqual(calls.map((call) => call.body), [{ query: "payment terms", limit: 25 }, { query: "payment terms", limit: 25 }]);
  assert.ok(calls.every((call) => call.authorization === `Bearer ${KEY}`));
  const tool = TOOLS.find((candidate) => candidate.name === "search_world");
  assert.throws(() => validateInput(tool, { collectionId: COLLECTION, query: "payment terms", limit: 26 }), /1 to 25/);
  const list = TOOLS.find((candidate) => candidate.name === "list_worlds");
  assert.equal(validateInput(list, { limit: 50 }).limit, 50);
});

test("get_world matches MCP while legacy world keeps its lifecycle envelope", async () => {
  assert.deepEqual(JSON.parse((await mcp("get_world", { collectionId: COLLECTION })).text), world);
  assert.deepEqual(JSON.parse((await cli(["get_world", COLLECTION])).stdout), world);
  assert.deepEqual(JSON.parse((await cli(["world", COLLECTION])).stdout), history);
});

test("MCP and CLI refuse malformed success envelopes and preserve API failures", async () => {
  assert.deepEqual(await mcp("search_world", { collectionId: COLLECTION, query: "malformed" }), {
    isError: true, text: "API_SUCCESS_SCHEMA_INVALID: search_world",
  });
  await assert.rejects(cli(["search", COLLECTION, "malformed"]), /API_SUCCESS_SCHEMA_INVALID: search/);
  assert.deepEqual(await mcp("get_world", { collectionId: COLLECTION }, "tvnl_live_denied"), {
    isError: true, text: "API_ERROR_403: API_KEY_SCOPE_MISSING",
  });
});
