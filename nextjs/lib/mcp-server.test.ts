import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
/*
  The published distribution itself, not a copy of it.

  There was briefly a second MCP server in `scripts/`, which is how two servers with different
  tool names end up in one repository. The file under test is the one people download.
*/
import { assertReadOnly, createClient, createServer, DISTRIBUTION_VERSION, SERVER_VERSION, TOOLS, validateInput } from "../public/developer/tavonel-mcp.mjs";
import { API_VERSION } from "./api-version";

/*
  The MCP server, driven the way an agent drives it.

  Masterplan 22.2 gives this server one hard constraint -- write and promotion stay with a person
  in a browser -- and one soft one: the tools it names must be tools that exist. Both are checked
  here against the real handler rather than against a description of it, because the failure mode
  is not a crash. It is a server that quietly grows a write tool, or a tool that answers a
  question the API cannot answer, and either one is discovered by an agent acting on it.

  The fetcher is a fake. What this proves is the contract: which request each tool makes, what it
  refuses before reaching the network, and what it hands back. Whether a real key opens a real
  workspace is external QA with a real account, and nothing here should be read as that.
*/

type Recorded = { url: string; init: RequestInit };

function fake(responses: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  const calls: Recorded[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const path = new URL(String(url)).pathname;
    const body = responses[path] ?? responses["*"] ?? { code: "OK" };
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

function server(responses: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  const { fetcher, calls } = fake(responses, status, headers);
  const handle = createServer({ call: createClient({ baseUrl: "https://tavonel.test", apiKey: "sk_test_key", fetcher }) }) as Handler;
  return { handle, calls };
}

const COLLECTION = `collection-${"a".repeat(32)}`;
const OBJECT = `claim-${"b".repeat(32)}`;

/*
  The handler answers `initialize`, `tools/list`, `tools/call` and a notification, so its return
  type is a union with a null in it. Every test below reads one arm of that union, and typing the
  reply loosely here is what lets each of them say which arm it expected.
*/
type Reply = {
  id?: unknown;
  result?: Record<string, never> & Record<string, unknown>;
  error?: { code: number; message: string };
} | null;
type Handler = (message: unknown) => Promise<Reply>;

async function callTool(handle: Handler, name: string, args: Record<string, unknown>) {
  const response = await handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  const result = response!.result as unknown as { content: Array<{ text: string }>; isError: boolean };
  return { isError: result.isError, text: result.content[0].text };
}

/** The one arm a test is reading, named where it is read. */
function resultOf(reply: Reply) {
  return (reply!.result ?? {}) as unknown as Record<string, never>;
}

describe("the constraint from masterplan 22.2", () => {
  it("exposes no tool that writes", () => {
    /*
      Promotion is the moment a candidate becomes the World an organisation answers from. This
      assertion is what keeps that behind a person: a tool added later that PUTs, PATCHes,
      DELETEs, or POSTs anywhere but /search and /ask makes the server refuse to start.
    */
    expect(assertReadOnly()).toBe(true);
  });

  it("refuses to start if a write tool is added", () => {
    const promote = { name: "promote", request: () => ({ method: "POST", path: "/v1/collections/x/promote" }) };
    const withWrite = [...TOOLS, promote] as Parameters<typeof assertReadOnly>[0];
    expect(() => assertReadOnly(withWrite)).toThrow("MCP_WRITE_TOOL_REFUSED");
  });

  it("declares every tool read-only to the client as well", async () => {
    const { handle } = server({});
    const listed = resultOf(await handle({ jsonrpc: "2.0", id: 1, method: "tools/list" })) as unknown as {
      tools: Array<{ name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }>;
    };
    for (const tool of listed.tools) {
      expect(tool.annotations.readOnlyHint, tool.name).toBe(true);
      expect(tool.annotations.destructiveHint, tool.name).toBe(false);
    }
  });
});

describe("the tool surface", () => {
  it("names the tools 22.2 asks for that the API can answer", () => {
    expect(TOOLS.map((tool: { name: string }) => tool.name)).toEqual([
      "list_sources",
      "get_world",
      "search_world",
      "ask_world",
      "get_object",
      "get_relation",
      "get_evidence",
      "download_package",
    ]);
  });

  it("does not offer list_worlds, and says why where a developer will look", () => {
    /*
      22.2 names `list_worlds`; the API has no endpoint that lists a workspace's collections. A
      tool that returned an empty array, or that guessed, would be a tool that is wrong silently.
      Its absence is only honest if it is explained, so the explanation is asserted too.
    */
    expect(TOOLS.map((tool: { name: string }) => tool.name)).not.toContain("list_worlds");
    const world = TOOLS.find((tool: { name: string }) => tool.name === "get_world")!;
    expect(world.description).toContain("no tool that lists worlds");
    const source = readFileSync(resolve(import.meta.dirname, "../public/developer/tavonel-mcp.mjs"), "utf8");
    expect(source).toContain("list_worlds --");
  });

  it("speaks the same contract version the API publishes", () => {
    // The .mjs cannot import a TypeScript constant, so this is what stops the two drifting.
    expect(SERVER_VERSION).toBe(API_VERSION);
  });

  it("announces itself with a protocol version and a tools capability", async () => {
    const { handle } = server({});
    const initialized = resultOf(await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })) as unknown as {
      protocolVersion: string;
      capabilities: { tools: unknown };
      serverInfo: { name: string; version: string };
      instructions: string;
    };
    expect(initialized.protocolVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(initialized.capabilities.tools).toBeDefined();
    expect(initialized.serverInfo.name).toBe("tavonel-readonly");
    // The build a support conversation starts from, not the contract version.
    expect(initialized.serverInfo.version).toBe(DISTRIBUTION_VERSION);
    expect(initialized.instructions).toContain("abstained");
  });

  it("answers a notification with nothing to send", async () => {
    const { handle } = server({});
    expect(await handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });

  it("reports an unknown method as a JSON-RPC error rather than a tool result", async () => {
    const { handle } = server({});
    const response = await handle({ jsonrpc: "2.0", id: 9, method: "resources/list" });
    expect(response!.error!.code).toBe(-32601);
  });
});

describe("each tool makes the request it declares", () => {
  it("lists sources from the documents endpoint", async () => {
    const { handle, calls } = server({ "/api/v1/documents": { code: "OK", documents: [{ documentId: "doc-1" }] } });
    const result = await callTool(handle, "list_sources", {});
    expect(calls[0].url).toBe("https://tavonel.test/api/v1/documents");
    expect(calls[0].init.method).toBe("GET");
    expect(result.isError).toBe(false);
    expect(result.text).toContain("doc-1");
  });

  it("asks a question as a body, because a question does not belong in a URL", async () => {
    const { handle, calls } = server({ "*": { code: "OK", answer: { abstained: false } } });
    await callTool(handle, "ask_world", { collectionId: COLLECTION, question: "What does revision C change?" });
    expect(calls[0].url).toBe(`https://tavonel.test/api/v1/collections/${COLLECTION}/ask`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ question: "What does revision C change?" });
  });

  it("carries the key as a bearer token and never in the path", async () => {
    const { handle, calls } = server({ "*": { code: "OK" } });
    await callTool(handle, "get_world", { collectionId: COLLECTION });
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer sk_test_key");
    expect(calls[0].url).not.toContain("sk_test_key");
  });

  it("returns one object when asked for one, and says so when it is not there", async () => {
    const objects = { code: "OK", objects: [{ id: OBJECT, label: "Bearing torque" }, { id: `claim-${"c".repeat(32)}` }] };
    const { handle } = server({ "*": objects });
    const one = await callTool(handle, "get_object", { collectionId: COLLECTION, objectId: OBJECT });
    expect(JSON.parse(one.text).objects).toHaveLength(1);

    const missing = await callTool(handle, "get_object", { collectionId: COLLECTION, objectId: `claim-${"d".repeat(32)}` });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("NOT_FOUND");
  });

  it("describes a package instead of pushing it down the pipe", async () => {
    /*
      An archive can be tens of megabytes, and the caller has to verify it against our signing
      key whatever route it arrives by. A descriptor with the digest is the useful answer; a
      base64 blob through stdio is the same bytes, slower, and still unverified.
    */
    const { handle } = server({ "*": {} }, 200, {
      "content-length": "104857",
      "x-tavonel-export-manifest-sha256": `sha256:${"e".repeat(64)}`,
      "x-tavonel-export-key-id": "tavonel-export-2026",
      "x-tavonel-candidate-promotion": "false",
    });
    const result = await callTool(handle, "download_package", { collectionId: COLLECTION });
    const descriptor = JSON.parse(result.text);
    expect(descriptor.sizeBytes).toBe(104857);
    expect(descriptor.manifestSha256).toBe(`sha256:${"e".repeat(64)}`);
    expect(descriptor.signingKeyId).toBe("tavonel-export-2026");
    expect(descriptor.verifyWith).toContain("verify-signed-export.mjs");
  });
});

describe("arguments are hostile until checked", () => {
  it("refuses a collection id that is a path", () => {
    const tool = TOOLS.find((entry: { name: string }) => entry.name === "get_world")!;
    expect(() => validateInput(tool, { collectionId: "../../v1/collections/x/promote" })).toThrow("INPUT_INVALID");
  });

  it("never reaches the network with a bad id", async () => {
    const { handle, calls } = server({ "*": { code: "OK" } });
    const result = await callTool(handle, "get_world", { collectionId: "collection-not-a-digest" });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("refuses an argument the tool does not declare", () => {
    const tool = TOOLS.find((entry: { name: string }) => entry.name === "ask_world")!;
    expect(() => validateInput(tool, { collectionId: COLLECTION, question: "why", promote: true })).toThrow("no argument");
  });

  it("holds the same question bounds the endpoint does, so a rejection costs nothing", () => {
    const tool = TOOLS.find((entry: { name: string }) => entry.name === "ask_world")!;
    expect(() => validateInput(tool, { collectionId: COLLECTION, question: "hi" })).toThrow("3 to 500");
    expect(() => validateInput(tool, { collectionId: COLLECTION, question: "x".repeat(501) })).toThrow("3 to 500");
    expect(validateInput(tool, { collectionId: COLLECTION, question: "why" }).question).toBe("why");
  });

  it("bounds the search limit", () => {
    const tool = TOOLS.find((entry: { name: string }) => entry.name === "search_world")!;
    expect(() => validateInput(tool, { collectionId: COLLECTION, query: "torque", limit: 500 })).toThrow("1 to 50");
  });

  it("refuses an unknown tool without calling anything", async () => {
    const { handle, calls } = server({ "*": { code: "OK" } });
    const result = await callTool(handle, "promote_world", { collectionId: COLLECTION });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("TOOL_NOT_FOUND");
    expect(calls).toHaveLength(0);
  });
});

describe("failure reaches the agent intact", () => {
  it("hands back the API's own code rather than a paraphrase", async () => {
    const { handle } = server({ "*": { code: "ACTIVE_WORLD_NOT_FOUND" } }, 404);
    const result = await callTool(handle, "get_world", { collectionId: COLLECTION });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("API_ERROR_404");
    expect(result.text).toContain("ACTIVE_WORLD_NOT_FOUND");
  });

  it("reports a failed tool as a tool result, not a protocol error", async () => {
    // An agent that receives a JSON-RPC error loses the message and can only retry blindly.
    const { handle } = server({ "*": { code: "RETRIEVAL_RUN_NOT_FOUND" } }, 409);
    const response = await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "search_world", arguments: { collectionId: COLLECTION, query: "bearing torque" } },
    });
    expect(response!.error).toBeUndefined();
    expect((resultOf(response) as unknown as { isError: boolean }).isError).toBe(true);
  });

  it("does not present an unreadable body as an answer", async () => {
    const fetcher = (async () => new Response("<html>gateway</html>", { status: 502, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    const handle = createServer({ call: createClient({ baseUrl: "https://tavonel.test", apiKey: "sk", fetcher }) }) as Handler;
    const result = await callTool(handle, "list_sources", {});
    expect(result.isError).toBe(true);
    expect(result.text).toContain("API_RESPONSE_UNREADABLE_502");
  });
});
