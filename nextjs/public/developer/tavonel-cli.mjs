#!/usr/bin/env node

const baseUrl = (process.env.TAVONEL_BASE_URL || "https://tavonel.com").replace(/\/$/, "");
const apiKey = process.env.TAVONEL_API_KEY || "";
const [command = "help", ...args] = process.argv.slice(2);

function usage() {
  return `TAVONEL CLI

Usage:
  node tavonel-cli.mjs status
  node tavonel-cli.mjs documents
  node tavonel-cli.mjs collection <collection-id>
  node tavonel-cli.mjs world <collection-id>
  node tavonel-cli.mjs ask <collection-id> <question>
  node tavonel-cli.mjs compile <document-id> <document-id> [...]
  node tavonel-cli.mjs download <collection-id> <output.zip>

Environment:
  TAVONEL_API_KEY   Scoped tvnl_live_... token (required except status)
  TAVONEL_BASE_URL  Defaults to https://tavonel.com`;
}

function requireKey() {
  if (!apiKey.startsWith("tvnl_live_")) throw new Error("TAVONEL_API_KEY is required and must be a TAVONEL scoped key.");
}

async function request(path, options = {}) {
  requireKey();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${apiKey}`, ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${body.slice(0, 500)}`);
  }
  return response;
}

async function main() {
  if (command === "help" || command === "--help" || command === "-h") return console.log(usage());
  if (command === "status") {
    const response = await fetch(`${baseUrl}/api/status`, { signal: AbortSignal.timeout(10_000) });
    console.log(JSON.stringify(await response.json(), null, 2));
    return;
  }
  if (command === "documents") return console.log(JSON.stringify(await (await request("/api/v1/documents")).json(), null, 2));
  if (command === "collection" && args[0]) return console.log(JSON.stringify(await (await request(`/api/v1/collections/${encodeURIComponent(args[0])}`)).json(), null, 2));
  if (command === "world" && args[0]) return console.log(JSON.stringify(await (await request(`/api/v1/collections/${encodeURIComponent(args[0])}/world`)).json(), null, 2));
  if (command === "ask" && args[0] && args.slice(1).join(" ").length >= 3) {
    const response = await request(`/api/v1/collections/${encodeURIComponent(args[0])}/ask`, { method: "POST", body: JSON.stringify({ question: args.slice(1).join(" ") }) });
    return console.log(JSON.stringify(await response.json(), null, 2));
  }
  if (command === "compile" && args.length >= 2) {
    const response = await request("/api/v1/collections/compile", { method: "POST", body: JSON.stringify({ documentIds: args }) });
    return console.log(JSON.stringify(await response.json(), null, 2));
  }
  if (command === "download" && args[0] && args[1]) {
    const { writeFile } = await import("node:fs/promises");
    const response = await request(`/api/v1/collections/${encodeURIComponent(args[0])}/download`);
    await writeFile(args[1], new Uint8Array(await response.arrayBuffer()), { flag: "wx" });
    console.log(`Wrote ${args[1]} (${response.headers.get("x-tavonel-export-manifest-sha256") || "manifest header unavailable"})`);
    return;
  }
  throw new Error(`Invalid command.\n\n${usage()}`);
}

main().catch((error) => { console.error(`tavonel: ${error.message}`); process.exitCode = 1; });
