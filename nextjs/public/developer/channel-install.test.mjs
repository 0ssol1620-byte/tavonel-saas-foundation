/**
 * Clean-install test for the published developer distribution, consumer context included.
 *
 *   node --test public/developer/channel-install.test.mjs
 *
 * Node built-ins only. The manifest is this directory's channel.json. A local HTTP server serves
 * channel.json and exactly the files its asset URLs name; the installer downloads them into a fresh
 * directory under the OS temp directory, checks every SHA-256 before writing anything, and the CLI
 * and MCP subprocesses then run from that directory alone -- no shell, no package manager, no
 * source-tree import, no node_modules, and no network beyond 127.0.0.1. The API key, the context
 * and the API are synthetic.
 *
 * What this proves is local synthetic evidence, not production API support: the API answering
 * here is a responder in this file, and the production API does not acknowledge these headers.
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { constants, existsSync, readFileSync } from "node:fs";
import { copyFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const MANIFEST_BYTES = readFileSync(join(SOURCE_DIRECTORY, "channel.json"));
const MANIFEST = JSON.parse(MANIFEST_BYTES.toString("utf8"));

const CLI = "tavonel-cli.mjs";
const MCP = "tavonel-mcp.mjs";
const SIDECAR = "consumer-context.mjs";
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Invented, and shaped only to pass the clients' local checks. Never a real credential.
const SYNTHETIC_API_KEY = "tvnl_live_synthetic_channel_install_0000000000";
const SYNTHETIC_CONTEXT = Object.freeze({
  schemaVersion: "tavonel.consumer_context.v1",
  tenantId: "synthetic-tenant-0001",
  principalId: "synthetic-agent-01",
  scope: ["worlds:read", "collections:read"],
  collectionId: `collection-${"5a".repeat(16)}`,
  snapshot: { mode: "latest" },
});
const RESOLVED_SNAPSHOT = Object.freeze({ version: "world-state-synthetic-0001", digest: `sha256:${"c3".repeat(32)}` });

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/*
 * The identity the context must travel under, computed here from the published contract rather
 * than imported: the test process does not load the code it is checking.
 */
const EXPECTED_IDENTITY = `ctx1-${sha256Hex(JSON.stringify([
  SYNTHETIC_CONTEXT.schemaVersion,
  SYNTHETIC_CONTEXT.tenantId,
  SYNTHETIC_CONTEXT.principalId,
  [...SYNTHETIC_CONTEXT.scope].sort(),
  SYNTHETIC_CONTEXT.collectionId,
  SYNTHETIC_CONTEXT.snapshot.mode,
  null,
  null,
]))}`;

/** The filename a manifest asset URL names. Anything that could leave the install directory is refused. */
function assetFilename(url) {
  const parsed = new URL(url);
  const match = /^\/developer\/([^/]+)$/.exec(parsed.pathname);
  if (parsed.protocol !== "https:" || !match || !SAFE_FILENAME.test(match[1]) || match[1] === "channel.json") {
    throw new Error(`MANIFEST_ASSET_URL_INVALID: ${url}`);
  }
  return match[1];
}

const MANIFEST_FILES = Object.values(MANIFEST.assets).map((asset) => assetFilename(asset.url));

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(() => resolve()));
}

/**
 * Serves channel.json and the exact files its asset URLs name, nothing else. `corrupt` names one
 * asset whose bytes are served with a flipped byte, at the same length.
 */
async function startChannelServer({ corrupt = null } = {}) {
  const files = new Map([["channel.json", MANIFEST_BYTES]]);
  for (const name of MANIFEST_FILES) {
    const bytes = Buffer.from(readFileSync(join(SOURCE_DIRECTORY, name)));
    if (name === corrupt) bytes[0] ^= 0xff;
    files.set(name, bytes);
  }
  const server = createServer((request, response) => {
    const name = /^\/developer\/([^/?]+)$/.exec(request.url ?? "")?.[1];
    const bytes = request.method === "GET" && name !== undefined ? files.get(name) : undefined;
    if (!bytes) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(bytes.length) });
    response.end(bytes);
  });
  return { server, origin: await listen(server) };
}

/**
 * A synthetic API. It records every request it receives and answers GET /api/v1/collections. When
 * a request carries the expected context identity it acknowledges it with that identity and a
 * resolved snapshot -- what a consumer-context-aware API does, and what the production API does not.
 */
async function startApiServer() {
  let requests = [];
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      requests.push({ method: request.method, url: request.url, headers: { ...request.headers } });
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (request.method !== "GET" || pathname !== "/api/v1/collections") {
        response.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ code: "NOT_FOUND" }));
        return;
      }
      const headers = { "content-type": "application/json", "x-tavonel-api-version": "1" };
      if (request.headers["x-tavonel-consumer-context-identity"] === EXPECTED_IDENTITY) {
        headers["x-tavonel-consumer-context-identity"] = EXPECTED_IDENTITY;
        headers["x-tavonel-snapshot-version"] = RESOLVED_SNAPSHOT.version;
        headers["x-tavonel-snapshot-digest"] = RESOLVED_SNAPSHOT.digest;
      }
      response.writeHead(200, headers).end(JSON.stringify({
        code: "COLLECTIONS_LISTED",
        collections: [{ collectionId: SYNTHETIC_CONTEXT.collectionId, manifestSha256: RESOLVED_SNAPSHOT.digest }],
        page: { limit: null, nextCursor: null },
      }));
    });
  });
  const origin = await listen(server);
  return {
    server,
    origin,
    take() {
      const taken = requests;
      requests = [];
      return taken;
    },
  };
}

async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`DOWNLOAD_FAILED: ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * The README install, against the local channel: fetch channel.json, fetch every asset it lists,
 * check every digest, and only then write -- so a mismatch leaves nothing behind. The manifest's
 * https://tavonel.com URLs are read for their path and fetched from the local origin.
 */
async function install(channelOrigin, directory) {
  const channelBytes = await fetchBytes(`${channelOrigin}/developer/channel.json`);
  const channel = JSON.parse(channelBytes.toString("utf8"));
  const verified = [];
  for (const [key, asset] of Object.entries(channel.assets)) {
    const name = assetFilename(asset.url);
    const bytes = await fetchBytes(`${channelOrigin}/developer/${name}`);
    const actual = `sha256:${sha256Hex(bytes)}`;
    if (actual !== asset.sha256) throw new Error(`SHA256_MISMATCH: ${key} ${name} is ${actual}, channel names ${asset.sha256}`);
    verified.push([name, bytes]);
  }
  for (const [name, bytes] of verified) await writeFile(join(directory, name), bytes, { flag: "wx" });
  await writeFile(join(directory, "channel.json"), channelBytes, { flag: "wx" });
  return channel;
}

/*
 * A minimal environment: no NODE_OPTIONS, NODE_PATH, proxy or inherited TAVONEL_* variable.
 * Windows keeps SystemRoot and the temp variables, which Node needs to start and open sockets.
 */
function childEnv(apiOrigin, extra = {}) {
  const env = {};
  for (const name of ["SystemRoot", "windir", "TEMP", "TMP", "TMPDIR"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return { ...env, TAVONEL_API_KEY: SYNTHETIC_API_KEY, TAVONEL_BASE_URL: apiOrigin, ...extra };
}

function run(directory, file, args, env, input = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(directory, file), ...args], {
      cwd: directory,
      env,
      stdio: [input === null ? "ignore" : "pipe", "pipe", "pipe"],
      windowsHide: true,
      timeout: 30_000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    if (input !== null) child.stdin.end(input);
  });
}

function runCli(directory, env, args = ["worlds"]) {
  return run(directory, CLI, args, env);
}

/** initialize, then one tools/call list_worlds; returns the tools/call result. */
async function runMcpListWorlds(directory, env) {
  const messages = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "channel-install-test", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_worlds", arguments: {} } },
  ];
  const outcome = await run(directory, MCP, [], env, messages.map((message) => `${JSON.stringify(message)}\n`).join(""));
  assert.equal(outcome.code, 0, outcome.stderr);
  const responses = outcome.stdout.split("\n").filter((line) => line.trim().length > 0).map((line) => JSON.parse(line));
  const initialized = responses.find((response) => response.id === 1);
  assert.equal(initialized?.result?.serverInfo?.name, "tavonel-readonly");
  const called = responses.find((response) => response.id === 2);
  assert.ok(called?.result, `no tools/call result in ${outcome.stdout}`);
  return { isError: called.result.isError, text: called.result.content[0].text };
}

function tavonelHeaderNames(request) {
  return Object.keys(request.headers).filter((name) => name.startsWith("x-tavonel-")).sort();
}

function assertLegacyRequest(requests) {
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.authorization, `Bearer ${SYNTHETIC_API_KEY}`);
  assert.deepEqual(tavonelHeaderNames(requests[0]), [], "a legacy request carries no context or marker header");
}

function assertBoundRequest(requests) {
  assert.equal(requests.length, 1);
  const headers = requests[0].headers;
  assert.equal(headers.authorization, `Bearer ${SYNTHETIC_API_KEY}`);
  assert.equal(headers["x-tavonel-consumer-context-schema"], SYNTHETIC_CONTEXT.schemaVersion);
  assert.equal(headers["x-tavonel-consumer-context-identity"], EXPECTED_IDENTITY);
  assert.equal(headers["x-tavonel-tenant-id"], SYNTHETIC_CONTEXT.tenantId);
  assert.equal(headers["x-tavonel-principal-id"], SYNTHETIC_CONTEXT.principalId);
  assert.equal(headers["x-tavonel-consumer-scope"], [...SYNTHETIC_CONTEXT.scope].sort().join(" "));
  assert.equal(headers["x-tavonel-collection-id"], SYNTHETIC_CONTEXT.collectionId);
  assert.equal(headers["x-tavonel-snapshot-mode"], "latest");
  assert.equal(headers["x-tavonel-consumer-context-required"], "true");
}

let temporaryRoot;
let channel;
let api;

before(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "tavonel-channel-install-"));
  channel = await startChannelServer();
  api = await startApiServer();
});

after(async () => {
  if (channel) await close(channel.server);
  if (api) await close(api.server);
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("the manifest lists the CLI, the MCP server and the consumer-context sidecar, once each", () => {
  for (const name of [CLI, MCP, SIDECAR]) assert.ok(MANIFEST_FILES.includes(name), `channel.json does not list ${name}`);
  assert.equal(new Set(MANIFEST_FILES).size, MANIFEST_FILES.length);
  for (const asset of Object.values(MANIFEST.assets)) assert.match(asset.sha256, /^sha256:[a-f0-9]{64}$/);
});

describe("clean install from the channel", () => {
  let directory;

  before(async () => {
    directory = await mkdtemp(join(temporaryRoot, "clean-"));
    await install(channel.origin, directory);
  });

  test("holds exactly channel.json and the manifest-listed files", async () => {
    assert.deepEqual((await readdir(directory)).sort(), ["channel.json", ...MANIFEST_FILES].sort());
    assert.deepEqual(readFileSync(join(directory, "channel.json")), MANIFEST_BYTES);
  });

  test("the installed CLI and MCP report the manifest version", async () => {
    const cli = await runCli(directory, childEnv(api.origin), ["--version"]);
    assert.equal(cli.code, 0, cli.stderr);
    assert.match(cli.stdout, new RegExp(`^tavonel-cli ${MANIFEST.version.replaceAll(".", "\\.")} `));
    const mcp = await run(directory, MCP, ["--version"], childEnv(api.origin));
    assert.equal(mcp.code, 0, mcp.stderr);
    assert.match(mcp.stdout, new RegExp(`^tavonel-mcp ${MANIFEST.version.replaceAll(".", "\\.")} `));
    assert.deepEqual(api.take(), []);
  });

  for (const [label, extra] of [
    ["context unset", {}],
    ["required flag false", { TAVONEL_CONSUMER_CONTEXT_REQUIRED: "false" }],
  ]) {
    test(`${label}: CLI sends a legacy request`, async () => {
      api.take();
      const outcome = await runCli(directory, childEnv(api.origin, extra));
      assert.equal(outcome.code, 0, outcome.stderr);
      assert.equal(JSON.parse(outcome.stdout).code, "COLLECTIONS_LISTED");
      assertLegacyRequest(api.take());
    });

    test(`${label}: MCP sends a legacy request`, async () => {
      api.take();
      const outcome = await runMcpListWorlds(directory, childEnv(api.origin, extra));
      assert.equal(outcome.isError, false, outcome.text);
      assert.equal(JSON.parse(outcome.text).code, "COLLECTIONS_LISTED");
      assertLegacyRequest(api.take());
    });
  }

  test("required=true with no context: CLI refuses before any API request", async () => {
    api.take();
    const outcome = await runCli(directory, childEnv(api.origin, { TAVONEL_CONSUMER_CONTEXT_REQUIRED: "true" }));
    assert.equal(outcome.code, 1);
    assert.match(outcome.stderr, /tavonel: CONSUMER_CONTEXT_REQUIRED:/);
    assert.deepEqual(api.take(), []);
  });

  test("required=true with no context: MCP refuses before any API request", async () => {
    api.take();
    const outcome = await runMcpListWorlds(directory, childEnv(api.origin, { TAVONEL_CONSUMER_CONTEXT_REQUIRED: "true" }));
    assert.equal(outcome.isError, true);
    assert.match(outcome.text, /^CONSUMER_CONTEXT_REQUIRED:/);
    assert.deepEqual(api.take(), []);
  });

  const bound = { TAVONEL_CONSUMER_CONTEXT: JSON.stringify(SYNTHETIC_CONTEXT), TAVONEL_CONSUMER_CONTEXT_REQUIRED: "true" };

  test("configured context, required=true: CLI sends the context and marker and accepts the acknowledgement", async () => {
    api.take();
    const outcome = await runCli(directory, childEnv(api.origin, bound));
    // Exit 0 under required=true means the installed sidecar verified the echoed identity and the
    // resolved snapshot; a missing or wrong acknowledgement would have been refused.
    assert.equal(outcome.code, 0, outcome.stderr);
    assert.equal(JSON.parse(outcome.stdout).code, "COLLECTIONS_LISTED");
    assertBoundRequest(api.take());
  });

  test("configured context, required=true: MCP sends the context and marker and accepts the acknowledgement", async () => {
    api.take();
    const outcome = await runMcpListWorlds(directory, childEnv(api.origin, bound));
    assert.equal(outcome.isError, false, outcome.text);
    assert.equal(JSON.parse(outcome.text).code, "COLLECTIONS_LISTED");
    assertBoundRequest(api.take());
  });

  test("running the installed files wrote nothing into the installation", async () => {
    assert.deepEqual((await readdir(directory)).sort(), ["channel.json", ...MANIFEST_FILES].sort());
  });
});

describe("clean install with the sidecar deleted", () => {
  let directory;
  const configured = { TAVONEL_CONSUMER_CONTEXT: JSON.stringify(SYNTHETIC_CONTEXT), TAVONEL_CONSUMER_CONTEXT_REQUIRED: "true" };

  before(async () => {
    directory = await mkdtemp(join(temporaryRoot, "no-sidecar-"));
    await install(channel.origin, directory);
    await rm(join(directory, SIDECAR));
    assert.equal(existsSync(join(directory, SIDECAR)), false);
  });

  // Also shows the installed files do not find a consumer-context.mjs anywhere but beside themselves.
  test("configured CLI fails closed with CONSUMER_CONTEXT_MODULE_UNAVAILABLE before any API request", async () => {
    api.take();
    const outcome = await runCli(directory, childEnv(api.origin, configured));
    assert.equal(outcome.code, 1);
    assert.match(outcome.stderr, /tavonel: CONSUMER_CONTEXT_MODULE_UNAVAILABLE:/);
    assert.deepEqual(api.take(), []);
  });

  test("configured MCP fails closed with CONSUMER_CONTEXT_MODULE_UNAVAILABLE before any API request", async () => {
    api.take();
    const outcome = await runMcpListWorlds(directory, childEnv(api.origin, configured));
    assert.equal(outcome.isError, true);
    assert.match(outcome.text, /^CONSUMER_CONTEXT_MODULE_UNAVAILABLE:/);
    assert.deepEqual(api.take(), []);
  });

  test("unconfigured CLI and MCP still run as legacy without the sidecar", async () => {
    api.take();
    const cli = await runCli(directory, childEnv(api.origin));
    assert.equal(cli.code, 0, cli.stderr);
    assertLegacyRequest(api.take());
    const mcp = await runMcpListWorlds(directory, childEnv(api.origin));
    assert.equal(mcp.isError, false, mcp.text);
    assertLegacyRequest(api.take());
  });
});

test("an asset whose bytes do not match the manifest is rejected and not written", async () => {
  const corrupted = await startChannelServer({ corrupt: CLI });
  const directory = await mkdtemp(join(temporaryRoot, "corrupt-"));
  try {
    await assert.rejects(install(corrupted.origin, directory), new RegExp(`^Error: SHA256_MISMATCH: \\w+ ${CLI.replaceAll(".", "\\.")} `));
    assert.equal(existsSync(join(directory, CLI)), false);
    // Every digest is checked before the first write, so a rejected install leaves nothing at all.
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await close(corrupted.server);
  }
});

/*
  WO-LOC-3: the signed channel. A throwaway Ed25519 key made here signs a copy of this directory with the
  real script (scripts/sign-developer-channel.mjs). The verifying CLI is the published tavonel-cli.mjs with
  only its CHANNEL_TRUST_PIN line replaced by that key, run from its own directory -- the CLI a developer
  already holds. The install downloads into a staging directory, runs verify-channel on it, and copies
  into the install directory only on success, so every refusal below leaves the install directory empty.
*/
const SIGN_SCRIPT_DIRECTORY = fileURLToPath(new URL("../../scripts/", import.meta.url));
const CHANNEL_SCOPE = "tavonel.signed_developer_channel.v1";
const PIN_LINE = /^const CHANNEL_TRUST_PIN = .*;$/m;
const META_FILES = ["channel.json", "channel.json.sig", "channel-trust.json"];

function channelKey(keyId, { notBefore = Date.now() - 60_000, expiresAt = Date.now() + 86_400_000, status = "active" } = {}) {
  const { privateKey } = generateKeyPairSync("ed25519");
  const der = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const record = {
    keyId, keyVersion: 1, algorithm: "Ed25519", status,
    notBefore: new Date(notBefore).toISOString(), expiresAt: new Date(expiresAt).toISOString(),
    publicKeySpkiDerBase64: der.toString("base64"), publicKeySpkiSha256: `sha256:${sha256Hex(der)}`,
  };
  return {
    privateKey,
    privateKeyBase64: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    record,
    trust: { schemaVersion: "tavonel.export_trust.v2", minimumSignatureVersion: 2, activeKeyId: keyId, keys: [record] },
  };
}

/* An independent copy of the canonical form, so the test does not import what it checks. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}

/* A hand-made house v2 signature, for the two cases the signing script refuses to produce. */
async function signByHand(directory, key, { scope = CHANNEL_SCOPE, issuedAt, expiresAt }) {
  const payload = Buffer.from(canonical(JSON.parse(readFileSync(join(directory, "channel.json"), "utf8"))), "utf8");
  const fields = {
    schemaVersion: "tavonel.export_signature.v2", algorithm: "Ed25519", signatureScope: scope, keyId: key.record.keyId,
    keyVersion: 1, issuedAt, expiresAt, signedPayloadSha256: `sha256:${sha256Hex(payload)}`,
  };
  const signature = sign(null, Buffer.concat([Buffer.from(`${JSON.stringify(fields)}\n`, "utf8"), payload]), key.privateKey);
  await writeFile(join(directory, "channel.json.sig"), JSON.stringify({
    ...fields, publicKeySpkiDerBase64: key.record.publicKeySpkiDerBase64, publicKeySpkiSha256: key.record.publicKeySpkiSha256,
    signatureBase64: signature.toString("base64"),
  }));
}

async function pinnedCli(key) {
  const source = readFileSync(join(SOURCE_DIRECTORY, CLI), "utf8");
  assert.equal(source.match(new RegExp(PIN_LINE.source, "gm"))?.length, 1, "the published CLI has exactly one pin line");
  const directory = await mkdtemp(join(temporaryRoot, "pinned-cli-"));
  const pin = { keyId: key.record.keyId, publicKeySpkiSha256: key.record.publicKeySpkiSha256 };
  await writeFile(join(directory, CLI), source.replace(PIN_LINE, `const CHANNEL_TRUST_PIN = ${JSON.stringify(pin)};`));
  return directory;
}

/* A copy of this directory's channel plus a trust record, signed by the real script unless `signer` is null. */
async function channelCopy(key, signer = key) {
  const directory = await mkdtemp(join(temporaryRoot, "channel-"));
  for (const name of ["channel.json", ...MANIFEST_FILES]) await copyFile(join(SOURCE_DIRECTORY, name), join(directory, name));
  await writeFile(join(directory, "channel-trust.json"), JSON.stringify(key.trust, null, 2));
  if (signer) {
    const outcome = await run(SIGN_SCRIPT_DIRECTORY, "sign-developer-channel.mjs", [directory],
      childEnv(api.origin, { TAVONEL_CHANNEL_SIGNING_KEY: signer.privateKeyBase64 }));
    assert.equal(outcome.code, 0, outcome.stderr);
    assert.ok(!`${outcome.stdout}${outcome.stderr}`.includes(signer.privateKeyBase64), "the signing script printed the key");
  }
  return directory;
}

async function serveDirectory(directory) {
  const server = createServer((request, response) => {
    const name = /^\/developer\/([^/?]+)$/.exec(request.url ?? "")?.[1];
    const path = request.method === "GET" && name && SAFE_FILENAME.test(name) ? join(directory, name) : null;
    if (!path || !existsSync(path)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/octet-stream" }).end(readFileSync(path));
  });
  return { server, origin: await listen(server) };
}

async function verifiedInstall(channelDirectory, cliDirectory, installDirectory) {
  const served = await serveDirectory(channelDirectory);
  const staging = await mkdtemp(join(temporaryRoot, "staging-"));
  try {
    const channelBytes = await fetchBytes(`${served.origin}/developer/channel.json`);
    await writeFile(join(staging, "channel.json"), channelBytes);
    // A missing signature or trust record is downloaded as absent, so verify-channel names it.
    for (const name of ["channel.json.sig", "channel-trust.json"]) {
      const response = await fetch(`${served.origin}/developer/${name}`, { signal: AbortSignal.timeout(10_000) });
      if (response.ok) await writeFile(join(staging, name), Buffer.from(await response.arrayBuffer()));
    }
    for (const asset of Object.values(JSON.parse(channelBytes.toString("utf8")).assets)) {
      const name = assetFilename(asset.url);
      await writeFile(join(staging, name), await fetchBytes(`${served.origin}/developer/${name}`));
    }
    const outcome = await run(cliDirectory, CLI, ["verify-channel", staging], childEnv(api.origin));
    if (outcome.code !== 0) throw new Error(outcome.stderr.trim());
    for (const name of await readdir(staging)) await copyFile(join(staging, name), join(installDirectory, name), constants.COPYFILE_EXCL);
    return JSON.parse(outcome.stdout);
  } finally {
    await close(served.server);
  }
}

describe("signed channel", () => {
  let key;
  let cli;
  before(async () => {
    key = channelKey("test-developer-channel");
    cli = await pinnedCli(key);
  });

  test("a channel signed by the pinned key installs, and the install holds the channel, its signature and every asset", async () => {
    const install = await mkdtemp(join(temporaryRoot, "signed-ok-"));
    api.take();
    const result = await verifiedInstall(await channelCopy(key), cli, install);
    assert.equal(result.code, "CHANNEL_VERIFIED");
    assert.equal(result.keyId, "test-developer-channel");
    assert.equal(result.assets, MANIFEST_FILES.length);
    assert.deepEqual((await readdir(install)).sort(), [...META_FILES, ...MANIFEST_FILES].sort());
    assert.deepEqual(api.take(), [], "verify-channel calls no API");
  });

  const refusals = [
    ["a swapped asset whose digest is rewritten in channel.json", /^Error: tavonel: CHANNEL_SIGNATURE_INVALID:/, async (directory) => {
      const swapped = Buffer.concat([readFileSync(join(directory, CLI)), Buffer.from("\n// swapped\n")]);
      await writeFile(join(directory, CLI), swapped);
      const channelFile = join(directory, "channel.json");
      const manifest = JSON.parse(readFileSync(channelFile, "utf8"));
      manifest.assets.cli.sha256 = `sha256:${sha256Hex(swapped)}`;
      await writeFile(channelFile, JSON.stringify(manifest, null, 2));
    }],
    ["an asset whose bytes differ from the signed channel", /^Error: tavonel: CHANNEL_ASSET_MISMATCH: tavonel-source-agent\.py$/, async (directory) => {
      const bytes = readFileSync(join(directory, "tavonel-source-agent.py"));
      bytes[0] ^= 0xff;
      await writeFile(join(directory, "tavonel-source-agent.py"), bytes);
    }],
    ["a valid signature by the pinned key under another scope", /^Error: tavonel: CHANNEL_SIGNATURE_SCOPE_MISMATCH:/, (directory) =>
      signByHand(directory, key, { scope: "tavonel.signed_export_manifest.v1", issuedAt: new Date().toISOString(), expiresAt: key.record.expiresAt })],
    ["a missing signature", /^Error: tavonel: CHANNEL_SIGNATURE_MISSING: channel\.json\.sig$/, (directory) => rm(join(directory, "channel.json.sig"))],
    ["a trust record that revokes the key", /^Error: tavonel: CHANNEL_KEY_REVOKED:/, (directory) =>
      writeFile(join(directory, "channel-trust.json"), JSON.stringify({ ...key.trust, keys: [{ ...key.record, status: "revoked" }] }))],
    ["a missing trust record", /^Error: tavonel: CHANNEL_TRUST_MISSING: channel-trust\.json$/, (directory) => rm(join(directory, "channel-trust.json"))],
  ];
  for (const [label, refusal, tamper] of refusals) {
    test(`refused before anything is written: ${label}`, async () => {
      const directory = await channelCopy(key);
      await tamper(directory);
      const install = await mkdtemp(join(temporaryRoot, "signed-refused-"));
      await assert.rejects(verifiedInstall(directory, cli, install), refusal);
      assert.deepEqual(await readdir(install), []);
    });
  }

  // The site-compromise class: whoever can change the site can publish any key and any trust record.
  for (const [label, impostor] of [
    ["an unknown key id", () => channelKey("another-channel-key")],
    ["the pinned key id on a different key", () => channelKey("test-developer-channel")],
  ]) {
    test(`refused before anything is written: a channel signed with ${label} and its own trust record`, async () => {
      const install = await mkdtemp(join(temporaryRoot, "signed-impostor-"));
      await assert.rejects(verifiedInstall(await channelCopy(impostor()), cli, install), /^Error: tavonel: CHANNEL_KEY_UNKNOWN:/);
      assert.deepEqual(await readdir(install), []);
    });
  }

  // The same class, with every claimed fingerprint copied from the pin: only the hash of the key bytes differs.
  test("refused before anything is written: a different key that claims the pinned key id and fingerprint everywhere", async () => {
    const impostor = channelKey("test-developer-channel");
    const record = { ...impostor.record, publicKeySpkiSha256: key.record.publicKeySpkiSha256 };
    const forged = { ...impostor, record, trust: { ...impostor.trust, keys: [record] } };
    const directory = await channelCopy(forged, null);
    await signByHand(directory, forged, { issuedAt: new Date().toISOString(), expiresAt: record.expiresAt });
    const install = await mkdtemp(join(temporaryRoot, "signed-forged-"));
    await assert.rejects(verifiedInstall(directory, cli, install), /^Error: tavonel: CHANNEL_KEY_UNKNOWN:/);
    assert.deepEqual(await readdir(install), []);
  });

  test("refused before anything is written: a signature past its expiry", async () => {
    const day = 86_400_000;
    const old = channelKey("test-developer-channel", { notBefore: Date.now() - 3 * day, expiresAt: Date.now() - day });
    const directory = await channelCopy(old, null);
    await signByHand(directory, old, { issuedAt: new Date(Date.now() - 2 * day).toISOString(), expiresAt: old.record.expiresAt });
    const install = await mkdtemp(join(temporaryRoot, "signed-expired-"));
    await assert.rejects(verifiedInstall(directory, await pinnedCli(old), install), /^Error: tavonel: CHANNEL_SIGNATURE_EXPIRED:/);
    assert.deepEqual(await readdir(install), []);
  });

  /*
    The committed channel is in one of two states, never between them: the published CLI pins no key and
    no signature or trust record is published, or it pins one and the committed channel verifies with it.
  */
  test("the committed channel is unpinned and unsigned, or pinned and verified", async () => {
    const source = readFileSync(join(SOURCE_DIRECTORY, CLI), "utf8");
    const outcome = await run(SOURCE_DIRECTORY, CLI, ["verify-channel", SOURCE_DIRECTORY], childEnv(api.origin));
    if (source.match(PIN_LINE)?.[0] === "const CHANNEL_TRUST_PIN = null;") {
      assert.equal(outcome.code, 1);
      assert.match(outcome.stderr, /^tavonel: CHANNEL_TRUST_NOT_PINNED:/);
      assert.equal(existsSync(join(SOURCE_DIRECTORY, "channel.json.sig")), false);
      assert.equal(existsSync(join(SOURCE_DIRECTORY, "channel-trust.json")), false);
    } else {
      assert.equal(outcome.code, 0, outcome.stderr);
      assert.equal(JSON.parse(outcome.stdout).code, "CHANNEL_VERIFIED");
    }
  });
});
