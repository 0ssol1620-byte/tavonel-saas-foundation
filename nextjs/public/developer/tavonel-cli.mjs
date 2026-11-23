#!/usr/bin/env node

const DISTRIBUTION_VERSION = "2026.10.2.1";
const API_VERSION = "1";
const SEARCH_LIMIT_MAX = 25;
const PAGE_LIMIT_MAX = 50;
const baseUrl = (process.env.TAVONEL_BASE_URL || "https://tavonel.com").replace(/\/$/, "");
const apiKey = process.env.TAVONEL_API_KEY || "";
/*
  The developer-channel key this release trusts: { keyId, publicKeySpkiSha256 }. It is compiled in, so a
  site that changes channel.json, its signature and channel-trust.json together still fails verify-channel;
  rotating the key is a new CLI release. Null until the channel key exists: verify-channel then refuses.
*/
const CHANNEL_TRUST_PIN = null;
const CHANNEL_SIGNATURE_SCOPE = "tavonel.signed_developer_channel.v1";

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
  node tavonel-cli.mjs verify-channel [download-dir]          # signature, then every sha256; no key, no network
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
  TAVONEL_CONSUMER_CONTEXT           Optional consumer-context JSON (needs consumer-context.mjs beside this file)
  TAVONEL_CONSUMER_CONTEXT_REQUIRED  true refuses every API read without a usable, acknowledged context (unset, blank or false: off)
  Consumer-context enforcement is local synthetic evidence only, not production API support.

Version: ${DISTRIBUTION_VERSION} (API v${API_VERSION})`;
}

function requireKey() {
  if (!apiKey.startsWith("tvnl_live_")) throw new Error("TAVONEL_API_KEY is required and must be a TAVONEL scoped key.");
}

/* Loaded only when a consumer context is configured, so the legacy CLI stays a single file. */
let consumerContextBinding;
async function consumerContext() {
  if (consumerContextBinding !== undefined) return consumerContextBinding;
  // consumer-context.mjs's own rule: a nonblank context, or a required flag that is neither blank
  // nor false (trimmed, any case). An invalid flag still loads the module, which refuses it.
  const flag = String(process.env.TAVONEL_CONSUMER_CONTEXT_REQUIRED ?? "").trim().toLowerCase();
  const configured = String(process.env.TAVONEL_CONSUMER_CONTEXT ?? "").trim() !== "" || (flag !== "" && flag !== "false");
  if (!configured) return (consumerContextBinding = null);
  let module;
  try {
    module = await import(new URL("./consumer-context.mjs", import.meta.url).href);
  } catch {
    throw new Error("CONSUMER_CONTEXT_MODULE_UNAVAILABLE: consumer-context.mjs must sit beside tavonel-cli.mjs");
  }
  return (consumerContextBinding = module.createConsumerContextBinding({ env: process.env }));
}

async function request(path, options = {}) {
  requireKey();
  const binding = await consumerContext();
  const contextRequest = { method: options.method ?? "GET", path };
  const contextHeaders = binding ? binding.prepare(contextRequest) : {};
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/vnd.tavonel.v1+json", ...(options.body ? { "content-type": "application/json" } : {}), ...contextHeaders, ...options.headers },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${body.slice(0, 500)}`);
  }
  const responseVersion = response.headers.get("x-tavonel-api-version");
  if (responseVersion && responseVersion !== API_VERSION) throw new Error(`Unsupported API version ${responseVersion}; this CLI requires v${API_VERSION}.`);
  if (binding) binding.verify(contextRequest, response);
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

/* Sorted keys, no whitespace: the bytes the channel signature covers. Same function as scripts/sign-developer-channel.mjs. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function instant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : null;
}

/*
  Verifies a downloaded channel directory: channel.json against channel.json.sig under the pinned key and the
  developer-channel scope, channel-trust.json against the pin, then every asset's sha256. Reads only; any
  failure throws a typed reason and nothing is reported as verified.
*/
async function verifyChannel(directory) {
  const { createHash, createPublicKey, verify } = await import("node:crypto");
  const { readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const fail = (code, detail) => { throw new Error(`${code}: ${detail}`); };
  const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (!CHANNEL_TRUST_PIN) fail("CHANNEL_TRUST_NOT_PINNED", "this CLI release pins no channel key");
  const read = (name, maxBytes, missing) => {
    let stat;
    try { stat = statSync(join(directory, name)); } catch { fail(missing, name); }
    if (!stat.isFile()) fail(missing, name);
    if (stat.size > maxBytes) fail("CHANNEL_FILE_TOO_LARGE", name);
    return readFileSync(join(directory, name));
  };
  const parse = (name, missing) => {
    const bytes = read(name, 65_536, missing);
    try { return JSON.parse(bytes.toString("utf8")); } catch { return fail("CHANNEL_JSON_INVALID", name); }
  };
  const channel = parse("channel.json", "CHANNEL_FILE_MISSING");
  const signature = parse("channel.json.sig", "CHANNEL_SIGNATURE_MISSING");
  const trust = parse("channel-trust.json", "CHANNEL_TRUST_MISSING");
  if (!object(channel) || !object(channel.assets) || Object.keys(channel.assets).length === 0) fail("CHANNEL_JSON_INVALID", "channel.json");

  const text = ["keyId", "publicKeySpkiDerBase64", "publicKeySpkiSha256", "signedPayloadSha256", "signatureBase64", "issuedAt", "expiresAt"];
  if (!object(signature) || signature.schemaVersion !== "tavonel.export_signature.v2" || signature.algorithm !== "Ed25519"
    || text.some((field) => typeof signature[field] !== "string") || !Number.isSafeInteger(signature.keyVersion) || signature.keyVersion < 1) {
    fail("CHANNEL_SIGNATURE_MALFORMED", "channel.json.sig");
  }
  if (signature.signatureScope !== CHANNEL_SIGNATURE_SCOPE) fail("CHANNEL_SIGNATURE_SCOPE_MISMATCH", "channel.json.sig is not a developer-channel signature");
  const der = Buffer.from(signature.publicKeySpkiDerBase64, "base64");
  if (signature.keyId !== CHANNEL_TRUST_PIN.keyId || signature.publicKeySpkiSha256 !== CHANNEL_TRUST_PIN.publicKeySpkiSha256
    || der.toString("base64") !== signature.publicKeySpkiDerBase64 || sha256(der) !== CHANNEL_TRUST_PIN.publicKeySpkiSha256) {
    fail("CHANNEL_KEY_UNKNOWN", "the channel is signed by a key this CLI does not pin");
  }
  const record = object(trust) && trust.schemaVersion === "tavonel.export_trust.v2" && Array.isArray(trust.keys)
    ? trust.keys.find((key) => object(key) && key.keyId === signature.keyId && key.keyVersion === signature.keyVersion)
    : undefined;
  if (!record || record.publicKeySpkiSha256 !== CHANNEL_TRUST_PIN.publicKeySpkiSha256 || record.publicKeySpkiDerBase64 !== signature.publicKeySpkiDerBase64) {
    fail("CHANNEL_TRUST_MISMATCH", "channel-trust.json does not publish the pinned key");
  }
  if (record.status !== "active" && record.status !== "retired") fail("CHANNEL_KEY_REVOKED", "channel-trust.json does not list the key as active or retired");
  const [issued, expires, notBefore, keyExpires] = [signature.issuedAt, signature.expiresAt, record.notBefore, record.expiresAt].map(instant);
  if ([issued, expires, notBefore, keyExpires].includes(null) || issued >= expires || issued < notBefore || issued >= keyExpires || expires > keyExpires) {
    fail("CHANNEL_SIGNATURE_INVALID", "the signature's validity window is outside the key's");
  }
  if (Date.now() >= expires) fail("CHANNEL_SIGNATURE_EXPIRED", signature.expiresAt);

  const payload = Buffer.from(canonicalJson(channel), "utf8");
  const header = `${JSON.stringify({
    schemaVersion: "tavonel.export_signature.v2", algorithm: "Ed25519", signatureScope: signature.signatureScope,
    keyId: signature.keyId, keyVersion: signature.keyVersion, issuedAt: signature.issuedAt, expiresAt: signature.expiresAt,
    signedPayloadSha256: signature.signedPayloadSha256,
  })}\n`;
  let valid = false;
  try {
    const signatureBytes = Buffer.from(signature.signatureBase64, "base64");
    valid = signatureBytes.length === 64 && signatureBytes.toString("base64") === signature.signatureBase64
      && signature.signedPayloadSha256 === sha256(payload)
      && verify(null, Buffer.concat([Buffer.from(header, "utf8"), payload]), createPublicKey({ key: der, format: "der", type: "spki" }), signatureBytes);
  } catch {
    valid = false;
  }
  if (!valid) fail("CHANNEL_SIGNATURE_INVALID", "channel.json does not match its signature");

  const seen = new Set();
  for (const [key, asset] of Object.entries(channel.assets)) {
    let name;
    try {
      const url = new URL(asset.url);
      name = url.protocol === "https:" ? /^\/developer\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(url.pathname)?.[1] : undefined;
    } catch {
      name = undefined;
    }
    if (!name || ["channel.json", "channel.json.sig", "channel-trust.json"].includes(name) || seen.has(name)
      || typeof asset.sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(asset.sha256)) {
      fail("CHANNEL_ASSET_INVALID", JSON.stringify(key.slice(0, 80)));
    }
    seen.add(name);
    if (sha256(read(name, 33_554_432, "CHANNEL_ASSET_MISSING")) !== asset.sha256) fail("CHANNEL_ASSET_MISMATCH", name);
  }
  return { code: "CHANNEL_VERIFIED", version: channel.version, keyId: signature.keyId, signedAt: signature.issuedAt, assets: seen.size };
}

async function print(payload) {
  console.log(JSON.stringify(await payload, null, 2));
}

async function main() {
  if (command === "--version" || command === "version") return console.log(`tavonel-cli ${DISTRIBUTION_VERSION} (api v${API_VERSION})`);
  if (command === "help" || command === "--help" || command === "-h") return console.log(usage());
  if (command === "update-check") return print(checkForUpdate());
  if (command === "verify-channel" && args.length <= 1) return print(verifyChannel(args[0] ?? "."));
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
