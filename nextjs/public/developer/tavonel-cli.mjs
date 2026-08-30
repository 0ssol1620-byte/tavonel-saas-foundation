#!/usr/bin/env node

const DISTRIBUTION_VERSION = "2026.8.30.1";
const API_VERSION = "1";
const baseUrl = (process.env.TAVONEL_BASE_URL || "https://tavonel.com").replace(/\/$/, "");
const apiKey = process.env.TAVONEL_API_KEY || "";
const [command = "help", ...args] = process.argv.slice(2);

function usage() {
  return `TAVONEL CLI

Usage:
  node tavonel-cli.mjs status
  node tavonel-cli.mjs update-check
  node tavonel-cli.mjs documents
  node tavonel-cli.mjs collection <collection-id>
  node tavonel-cli.mjs world <collection-id>
  node tavonel-cli.mjs ask <collection-id> <question>
  node tavonel-cli.mjs compile <document-id> <document-id> [...]
  node tavonel-cli.mjs download <collection-id> <output.zip>
  node tavonel-cli.mjs connections
  node tavonel-cli.mjs connection-add <provider> <display-name> [configuration-json]
  node tavonel-cli.mjs connection-revoke <connection-id>

Environment:
  TAVONEL_API_KEY   Scoped tvnl_live_... token (required except status)
  TAVONEL_BASE_URL  Defaults to https://tavonel.com

Version: ${DISTRIBUTION_VERSION} (API v${API_VERSION})`;
}

function requireKey() {
  if (!apiKey.startsWith("tvnl_live_")) throw new Error("TAVONEL_API_KEY is required and must be a TAVONEL scoped key.");
}

async function request(path, options = {}) {
  requireKey();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/vnd.tavonel.v1+json", ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${body.slice(0, 500)}`);
  }
  const responseVersion = response.headers.get("x-tavonel-api-version");
  if (responseVersion && responseVersion !== API_VERSION) throw new Error(`Unsupported API version ${responseVersion}; this CLI requires v${API_VERSION}.`);
  return response;
}

function newerThan(candidate, current) {
  const left = candidate.split(".").map(Number);
  const right = current.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

async function checkForUpdate() {
  const response = await fetch(`${baseUrl}/developer/channel.json`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  const channel = await response.json();
  if (!response.ok || typeof channel.version !== "string" || channel.apiVersion !== Number(API_VERSION)) throw new Error("Distribution channel contract is unavailable or incompatible.");
  return { current: DISTRIBUTION_VERSION, latest: channel.version, updateAvailable: newerThan(channel.version, DISTRIBUTION_VERSION), assets: channel.assets };
}

async function main() {
  if (command === "--version" || command === "version") return console.log(`tavonel-cli ${DISTRIBUTION_VERSION} (api v${API_VERSION})`);
  if (command === "help" || command === "--help" || command === "-h") return console.log(usage());
  if (command === "update-check") return console.log(JSON.stringify(await checkForUpdate(), null, 2));
  if (command === "status") {
    const response = await fetch(`${baseUrl}/api/status`, { signal: AbortSignal.timeout(10_000) });
    console.log(JSON.stringify(await response.json(), null, 2));
    return;
  }
  if (command === "documents") return console.log(JSON.stringify(await (await request("/api/v1/documents")).json(), null, 2));
  if (command === "connections") return console.log(JSON.stringify(await (await request("/api/v1/connections")).json(), null, 2));
  if (command === "connection-add" && args[0] && args[1]) {
    const provider = args[0];
    const configuration = args[2] ? JSON.parse(args[2]) : {};
    const response = await request("/api/v1/connections", {
      method: "POST",
      body: JSON.stringify({ provider, mode: "local_agent", displayName: args[1], configuration, secretReference: null }),
    });
    return console.log(JSON.stringify(await response.json(), null, 2));
  }
  if (command === "connection-revoke" && args[0]) {
    await request(`/api/v1/connections/${encodeURIComponent(args[0])}`, { method: "DELETE" });
    console.log(`Revoked ${args[0]}. Immutable outputs were retained.`);
    return;
  }
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
    const { createHash } = await import("node:crypto");
    const { writeFile } = await import("node:fs/promises");
    const response = await request(`/api/v1/collections/${encodeURIComponent(args[0])}/download`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    await writeFile(args[1], bytes, { flag: "wx" });
    const archiveSha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const manifestSha256 = response.headers.get("x-tavonel-export-manifest-sha256") || "unavailable";
    console.log(`Wrote ${args[1]} (archive=${archiveSha256}; manifest=${manifestSha256})`);
    return;
  }
  throw new Error(`Invalid command.\n\n${usage()}`);
}

main().catch((error) => { console.error(`tavonel: ${error.message}`); process.exitCode = 1; });
