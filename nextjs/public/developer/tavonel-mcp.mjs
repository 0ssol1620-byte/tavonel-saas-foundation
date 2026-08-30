#!/usr/bin/env node

const DISTRIBUTION_VERSION = "2026.8.30.1";
const API_VERSION = "1";
const baseUrl = (process.env.TAVONEL_BASE_URL || "https://tavonel.com").replace(/\/$/, "");
const apiKey = process.env.TAVONEL_API_KEY || "";
const encoder = new TextEncoder();

const tools = [
  { name: "list_documents", description: "List immutable document versions in this TAVONEL tenant.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_collection", description: "Read a reviewable candidate knowledge package. Never promotes it.", inputSchema: { type: "object", required: ["collectionId"], properties: { collectionId: { type: "string" } }, additionalProperties: false } },
  { name: "get_active_world", description: "Read the human-promoted active world and retained versions.", inputSchema: { type: "object", required: ["collectionId"], properties: { collectionId: { type: "string" } }, additionalProperties: false } },
  { name: "ask_active_world", description: "Run grounded retrieval against an active world. Returns exact regions or abstains.", inputSchema: { type: "object", required: ["collectionId", "question"], properties: { collectionId: { type: "string" }, question: { type: "string", minLength: 3, maxLength: 500 } }, additionalProperties: false } },
];

async function api(path, options = {}) {
  if (!apiKey.startsWith("tvnl_live_")) throw new Error("TAVONEL_API_KEY is missing or invalid");
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/vnd.tavonel.v1+json", ...(options.body ? { "content-type": "application/json" } : {}) },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`TAVONEL ${response.status}: ${text.slice(0, 500)}`);
  const responseVersion = response.headers.get("x-tavonel-api-version");
  if (responseVersion && responseVersion !== API_VERSION) throw new Error(`Unsupported API version ${responseVersion}`);
  return JSON.parse(text);
}

function result(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], isError: false };
}

async function callTool(name, args) {
  const collectionId = typeof args?.collectionId === "string" ? encodeURIComponent(args.collectionId) : "";
  if (name === "list_documents") return result(await api("/api/v1/documents"));
  if (name === "get_collection" && collectionId) return result(await api(`/api/v1/collections/${collectionId}`));
  if (name === "get_active_world" && collectionId) return result(await api(`/api/v1/collections/${collectionId}/world`));
  if (name === "ask_active_world" && collectionId && typeof args?.question === "string") return result(await api(`/api/v1/collections/${collectionId}/ask`, { method: "POST", body: JSON.stringify({ question: args.question }) }));
  throw new Error("Unknown tool or invalid arguments");
}

async function handle(message) {
  if (message.method === "notifications/initialized") return null;
  if (message.method === "initialize") return { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "tavonel-readonly", version: DISTRIBUTION_VERSION }, instructions: `Read-only access to source-bound TAVONEL knowledge over API v${API_VERSION}. No tool can upload, compile, promote, roll back, change billing, or mutate connectors.` } };
  if (message.method === "ping") return { jsonrpc: "2.0", id: message.id, result: {} };
  if (message.method === "tools/list") return { jsonrpc: "2.0", id: message.id, result: { tools } };
  if (message.method === "tools/call") {
    try {
      return { jsonrpc: "2.0", id: message.id, result: await callTool(message.params?.name, message.params?.arguments || {}) };
    } catch (error) {
      return { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: error instanceof Error ? error.message : "Tool failed" }], isError: true } };
    }
  }
  if (message.id === undefined) return null;
  return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } };
}

if (process.argv.includes("--version")) {
  process.stdout.write(`tavonel-mcp ${DISTRIBUTION_VERSION} (api v${API_VERSION})\n`);
  process.exit(0);
}

let pending = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  pending += chunk;
  let newline;
  while ((newline = pending.indexOf("\n")) >= 0) {
    const line = pending.slice(0, newline).trim();
    pending = pending.slice(newline + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    const response = await handle(message);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  }
});
process.stdin.resume();
void encoder;
