#!/usr/bin/env node

const DISTRIBUTION_VERSION = "2026.9.20.1";
const API_VERSION = "1";
const SEARCH_LIMIT_MAX = 25;
const PAGE_LIMIT_MAX = 50;
const baseUrl = (process.env.TAVONEL_BASE_URL || "https://tavonel.com").replace(/\/$/, "");
const apiKey = process.env.TAVONEL_API_KEY || "";

/* Hyphenated shell names and MCP-compatible underscore aliases resolve to one action. */
const COMMAND_ALIASES = new Map([
  ["sources", "documents"], ["list-sources", "documents"], ["list_sources", "documents"],
  ["list-worlds", "worlds"], ["list_worlds", "worlds"],
  ["get_world", "get-world"],
  ["search-world", "search"], ["search_world", "search"],
  ["ask-world", "ask"], ["ask_world", "ask"],
  ["get_object", "object"], ["get-object", "object"],
  ["get_relation", "relation"], ["get-relation", "relation"],
  ["get_evidence", "evidence"], ["get-evidence", "evidence"],
  ["download-package", "download"], ["download_package", "download"],
  ["world-versions", "world"], ["collection-world", "world"],
]);

const [rawCommand = "help", ...args] = process.argv.slice(2);
const command = COMMAND_ALIASES.get(rawCommand) ?? rawCommand;

function usage() {
  return `TAVONEL CLI

Usage:
  node tavonel-cli.mjs status
  node tavonel-cli.mjs update-check
  node tavonel-cli.mjs documents
  node tavonel-cli.mjs worlds [--limit 1-50] [--cursor <collection-id>]
  node tavonel-cli.mjs collection <collection-id>
  node tavonel-cli.mjs world <collection-id>                  # lifecycle + versions (legacy)
  node tavonel-cli.mjs get-world <collection-id>              # full World read model
  node tavonel-cli.mjs search <collection-id> <query> [--limit 1-25]
  node tavonel-cli.mjs ask <collection-id> <question>
  node tavonel-cli.mjs object <collection-id> [object-id] [--limit 1-50] [--cursor <id>]
  node tavonel-cli.mjs relation <collection-id> [relation-id] [--limit 1-50] [--cursor <id>]
  node tavonel-cli.mjs evidence <collection-id> [evidence-id] [--limit 1-50] [--cursor <id>]
  node tavonel-cli.mjs compile <document-id> <document-id> [...]
  node tavonel-cli.mjs download <collection-id> <output.zip>
  node tavonel-cli.mjs connections
  node tavonel-cli.mjs connection-add <provider> <display-name> [configuration-json]
  node tavonel-cli.mjs connection-revoke <connection-id>

MCP-name aliases are accepted: list_sources, list_worlds, get_world, search_world, ask_world,
get_object, get_relation, get_evidence and download_package.

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

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/* Validate stable published fields while allowing additive response fields. */
function validateSuccess(contract, payload) {
  const valid = object(payload) && (
    (contract === "documents" && Array.isArray(payload.documents)) ||
    (contract === "worlds" && payload.code === "COLLECTIONS_LISTED" && Array.isArray(payload.collections) && object(payload.page)) ||
    (contract === "world-history" && object(payload.activeWorld) && Array.isArray(payload.versions)) ||
    (contract === "world" && payload.code === "OK" && object(payload.model)) ||
    (contract === "search" && ["SEARCH_RESULTS", "SEARCH_EMPTY"].includes(payload.code) && payload.retrievalPath === "compiled-retrieval-v1" && object(payload.contextPacket) && Array.isArray(payload.degradations) && object(payload.activeWorld)) ||
    (contract === "ask" && ["GROUNDED_ANSWER", "ANSWER_ABSTAINED"].includes(payload.code) && typeof payload.answer === "string" && Array.isArray(payload.citations) && typeof payload.retrievalPath === "string" && object(payload.activeWorld)) ||
    (["objects", "relations", "evidence"].includes(contract) && payload.code === "OK" && Array.isArray(payload[contract]) && object(payload.page)) ||
    (["collection", "connections", "connection-add", "compile"].includes(contract) && typeof payload.code === "string")
  );
  if (!valid) throw new Error(`API_SUCCESS_SCHEMA_INVALID: ${contract}`);
  return payload;
}

async function json(path, contract, options = {}) {
  const response = await request(path, options);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`API_SUCCESS_SCHEMA_INVALID: ${contract}`);
  }
  return validateSuccess(contract, payload);
}

function integer(value, name, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) throw new Error(`${name} must be an integer from 1 to ${max}.`);
  return parsed;
}

function optionsFrom(values, { max = PAGE_LIMIT_MAX, allowCursor = true } = {}) {
  const positional = [];
  const query = new URLSearchParams();
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--limit") {
      if (values[index + 1] === undefined) throw new Error("--limit requires a value.");
      query.set("limit", String(integer(values[++index], "limit", max)));
    } else if (values[index] === "--cursor" && allowCursor) {
      if (!values[index + 1]) throw new Error("--cursor requires a value.");
      query.set("cursor", values[++index]);
    } else positional.push(values[index]);
  }
  if (query.has("cursor") && !query.has("limit")) throw new Error("--cursor requires --limit.");
  return { positional, suffix: query.size > 0 ? `?${query}` : "", limit: query.get("limit") };
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

async function print(payload) {
  console.log(JSON.stringify(await payload, null, 2));
}

async function main() {
  if (command === "--version" || command === "version") return console.log(`tavonel-cli ${DISTRIBUTION_VERSION} (api v${API_VERSION})`);
  if (command === "help" || command === "--help" || command === "-h") return console.log(usage());
  if (command === "update-check") return print(checkForUpdate());
  if (command === "status") {
    const response = await fetch(`${baseUrl}/api/status/v2`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`${response.status} status unavailable`);
    if (body?.schemaVersion !== "tavonel.public_status.v2") {
      throw new Error("Incompatible public status contract.");
    }
    return print(body);
  }
  if (command === "documents") return print(json("/api/v1/documents", "documents"));
  if (command === "worlds") {
    const parsed = optionsFrom(args);
    if (parsed.positional.length > 0) throw new Error(`Invalid command.\n\n${usage()}`);
    return print(json(`/api/v1/collections${parsed.suffix}`, "worlds"));
  }
  if (command === "connections") return print(json("/api/v1/connections", "connections"));
  if (command === "connection-add" && args[0] && args[1]) {
    const configuration = args[2] ? JSON.parse(args[2]) : {};
    return print(json("/api/v1/connections", "connection-add", { method: "POST", body: JSON.stringify({ provider: args[0], mode: "local_agent", displayName: args[1], configuration, secretReference: null }) }));
  }
  if (command === "connection-revoke" && args[0]) {
    await request(`/api/v1/connections/${encodeURIComponent(args[0])}`, { method: "DELETE" });
    console.log(`Revoked ${args[0]}. Immutable outputs were retained.`);
    return;
  }
  if (command === "collection" && args[0]) return print(json(`/api/v1/collections/${encodeURIComponent(args[0])}`, "collection"));
  if (command === "world" && args[0]) return print(json(`/api/v1/collections/${encodeURIComponent(args[0])}/world`, "world-history"));
  if (command === "get-world" && args[0]) return print(json(`/api/v1/world/${encodeURIComponent(args[0])}`, "world"));
  if (command === "search" && args[0]) {
    const parsed = optionsFrom(args.slice(1), { max: SEARCH_LIMIT_MAX, allowCursor: false });
    const query = parsed.positional.join(" ").trim();
    if (query.length < 3 || query.length > 500) throw new Error("query must be 3 to 500 characters.");
    const body = parsed.limit === null ? { query } : { query, limit: Number(parsed.limit) };
    return print(json(`/api/v1/collections/${encodeURIComponent(args[0])}/search`, "search", { method: "POST", body: JSON.stringify(body) }));
  }
  if (command === "ask" && args[0] && args.slice(1).join(" ").length >= 3) {
    return print(json(`/api/v1/collections/${encodeURIComponent(args[0])}/ask`, "ask", { method: "POST", body: JSON.stringify({ question: args.slice(1).join(" ") }) }));
  }
  for (const [verb, lens] of [["object", "objects"], ["relation", "relations"], ["evidence", "evidence"]]) {
    if (command !== verb || !args[0]) continue;
    const parsed = optionsFrom(args.slice(1));
    if (parsed.positional.length > 1 || (parsed.positional.length === 1 && parsed.suffix)) throw new Error("An id cannot be combined with --limit or --cursor.");
    const payload = await json(`/api/v1/world/${encodeURIComponent(args[0])}/${lens}${parsed.suffix}`, lens);
    if (parsed.positional[0]) {
      const found = payload[lens].find((item) => item?.id === parsed.positional[0]);
      if (!found) throw new Error(`NOT_FOUND: no ${verb} ${parsed.positional[0]} in this World`);
      payload[lens] = [found];
    }
    return print(payload);
  }
  if (command === "compile" && args.length >= 2) return print(json("/api/v1/collections/compile", "compile", { method: "POST", body: JSON.stringify({ documentIds: args }) }));
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
