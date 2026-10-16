import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
  Owned synthetic fixtures behind the actual route handlers (the "wired route handlers" blocks
  below). Every collaborator a wired route reads through -- authorization, the World store, the read
  model, source admission and retrieval -- is replaced here; the routes, lib/consumer-context-api.ts,
  the operation guard and the answer builders run as shipped. The CLI and MCP subprocesses are
  separate processes and never see these mocks: they only see HTTP.

  Each stub below is the whole module as far as this file is concerned -- every runtime export the
  wired routes, lib/consumer-context-api.ts and this test read from it, and nothing else. None of
  them loads the real module, so neither it nor the production packages behind it (store,
  retrieval runtime, connector and admission clients) are imported in this local synthetic run.
  Constants are restated with the values their source modules define; an export a route starts
  reading that is not listed here is undefined, which fails loudly rather than falling through to
  the real module.
*/
const fx = vi.hoisted(() => ({
  authorize: vi.fn(), revalidate: vi.fn(),
  activeWorld: vi.fn(), versions: vi.fn(), versionLookup: vi.fn(), listWorlds: vi.fn(), manifestStatus: vi.fn(), freshness: vi.fn(),
  readModel: vi.fn(), sourceIds: vi.fn(), sourceAccess: vi.fn(), admits: vi.fn(),
  pipeline: vi.fn(), indexState: vi.fn(), runtime: vi.fn(),
}));
vi.mock("@/lib/developer-auth", () => ({
  authorizeFoundationRequest: fx.authorize,
  revalidateFoundationAuthorization: fx.revalidate,
}));
vi.mock("@/lib/world-store", () => ({
  getFoundationActiveWorld: fx.activeWorld,
  // No wired route or helper classifies a pin by the 50-row history any more; it stays stubbed so the
  // tests below can show a pin is classified by the exact lookup alone. Only the collection-world
  // payload lists it, after resolution, so a refusal at resolution never reads it.
  listFoundationWorldVersions: fx.versions,
  getFoundationWorldVersion: fx.versionLookup,
  listFoundationActiveWorlds: fx.listWorlds,
  getManifestActivationStatus: fx.manifestStatus,
  getWorldFreshness: fx.freshness,
  // lib/world-store.ts: ACTIVE_WORLD_PAGE_MAX = 50, ACTIVE_WORLD_PAGE_DEFAULT = 25.
  ACTIVE_WORLD_PAGE_MAX: 50,
  ACTIVE_WORLD_PAGE_DEFAULT: 25,
  // lib/world-store.ts: EMPTY_WORLD_FRESHNESS, field for field.
  EMPTY_WORLD_FRESHNESS: {
    observedAt: null,
    processedAt: null,
    reviewedAt: null,
    activatedAt: null,
    activeManifestDigest: null,
    candidateAwaitingActivation: false,
    candidateManifestDigest: null,
  },
}));
vi.mock("@/lib/world-read-model", () => ({ loadWorldReadModel: fx.readModel }));
vi.mock("@/lib/active-world-source-access", () => ({ loadActiveWorldSourceIds: fx.sourceIds }));
vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccess: fx.sourceAccess, checkConnectorSourceAccessForViewer: fx.sourceAccess }));
vi.mock("@/lib/derived-data-admission", () => ({
  admitsDerivedCustomerData: fx.admits,
  // lib/derived-data-admission.ts: DERIVED_DATA_REFUSED.
  DERIVED_DATA_REFUSED: "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE",
}));
vi.mock("@/lib/retrieval-pipeline", () => ({ runRetrievalPipeline: fx.pipeline }));
vi.mock("@/lib/retrieval-index-status", () => ({
  readRetrievalIndexState: fx.indexState,
  // A fixture restatement of lib/retrieval-index-status.ts's retrievalIndexNotice (RUN_INCOMPLETE is
  // "RETRIEVAL_COMPILE_RUN_INCOMPLETE" there). Search reads it only for a 409 and Ask only on the
  // excerpt fallback; neither is reached while the pipeline fixture answers.
  retrievalIndexNotice: (state: { status: string; errorClass: string | null }): string | null => {
    if (state.status === "compiled") return null;
    if (state.status === "failed") {
      return `the compiled retrieval index for this active world failed to build (${state.errorClass ?? "unknown"}); answers come from the excerpt-concatenation fallback until it is rebuilt`;
    }
    return state.errorClass === "RETRIEVAL_COMPILE_RUN_INCOMPLETE"
      ? "a retrieval compile run for this active world has not finished; an incomplete index is not queryable and answers come from the excerpt-concatenation fallback"
      : "no compiled retrieval index exists for this active world yet";
  },
}));
vi.mock("@/lib/retrieval-runtime-config", () => ({ resolveConfiguredProductionRetrievalRuntime: fx.runtime }));

import { POST as askRoute } from "../../app/api/collections/[id]/ask/route";
import { POST as searchRoute } from "../../app/api/collections/[id]/search/route";
import { GET as collectionsRoute } from "../../app/api/v1/collections/route";
import { POST as v1AskRoute } from "../../app/api/v1/collections/[id]/ask/route";
import { POST as v1SearchRoute } from "../../app/api/v1/collections/[id]/search/route";
import { GET as v1CollectionWorldRoute } from "../../app/api/v1/collections/[id]/world/route";
import { GET as lensRoute } from "../../app/api/v1/world/[id]/[lens]/route";
import { GET as manifestStatusRoute } from "../../app/api/v1/world/[id]/manifest-status/route";
import { GET as worldRoute } from "../../app/api/v1/world/[id]/route";
import type { DeveloperScope } from "../developer-contracts";
import { DERIVED_DATA_REFUSED } from "../derived-data-admission";
import { EMPTY_WORLD_FRESHNESS, type ActiveWorld } from "../world-store";
import { resetLocalWorkspaceOperationsForTest } from "../workspace-operation-guard";
import {
  CONSUMER_CONTEXT_ENFORCEMENT as SERVER_ENFORCEMENT,
  CONSUMER_CONTEXT_REFUSALS,
  acknowledgeConsumerContext,
  bindConsumerContext,
  contextPrincipalId,
  resolveConsumerSnapshot,
  type BoundConsumerContext,
  type ConsumerContextBinding,
  type ConsumerContextRefusalCode,
  type ConsumerContextRoute,
  type ConsumerSnapshot,
  type ResolvedConsumerSnapshot,
  type SnapshotResolution,
} from "../consumer-context-api";
import type { FoundationPrincipal } from "../developer-auth";
import { DEVELOPER_SCOPES } from "../developer-contracts";
import {
  CONSUMER_CONTEXT_ENFORCEMENT,
  CONSUMER_CONTEXT_SCHEMA_VERSION,
  CONSUMER_SCOPES,
  CONTEXT_HEADERS,
  CONTEXT_REQUIRED_MARKER,
  cacheKey,
  contextFromHeaders,
  contextHeaders,
  contextIdentity,
  createConsumerContextBinding,
  parseConsumerContext,
  requiredScope,
  verifyResponseContext,
} from "../../public/developer/consumer-context.mjs";
import { TOOLS as MCP_TOOLS, createClient as createMcpClient } from "../../public/developer/tavonel-mcp.mjs";

/*
  Consumer-context parity gate.

  ENFORCEMENT SCOPE: everything asserted here is local synthetic evidence only, not production API
  support. The HTTP server below is a synthetic API boundary that exists only in this test: it
  authenticates fixture principals, validates the consumer-context headers, resolves fixture
  snapshots, keeps a fixture revocation list and a fixture cache. Nothing here shows a deployed
  production API reading or acknowledging these headers. What this file does prove about shipped
  code is that the published CLI (run as a real subprocess) and the published MCP server (run as a real stdio
  subprocess with its own HTTP client) parse, refuse, propagate and verify the context exactly as
  a direct call through the shared module does.

  The server-helper block exercises lib/consumer-context-api.ts over synthetic FoundationPrincipals
  only: no real authentication, store or network.

  The wired-route blocks call the actual exported handlers of the seven wired routes, directly and
  behind a local HTTP server the same CLI and MCP subprocesses talk to. Authorization, the World
  store, the read model, source admission and retrieval are owned vi.mock fixtures, so this is
  evidence about the routes' own binding, resolution, revalidation and acknowledgement order and
  codes -- local evidence, not real auth, SQL, R2 or a deployed production API.
*/

const run = promisify(execFile);
const DEVELOPER = resolve(import.meta.dirname, "../../public/developer");
const CLI = resolve(DEVELOPER, "tavonel-cli.mjs");
const MCP = resolve(DEVELOPER, "tavonel-mcp.mjs");
const SLOW = 120_000;

const ALPHA = `collection-${"a".repeat(32)}`;
const BETA = `collection-${"b".repeat(32)}`;
const digest = (fill: string) => `sha256:${fill.repeat(64)}`;
const ALPHA_V6 = digest("6");
const ALPHA_V7 = digest("7");
const ALPHA_V8 = digest("8");
const BETA_V3 = digest("3");
const SEARCH = "payment terms";
const QUESTION = "What are the payment terms?";

const KEYS = {
  alphaReader: "tvnl_live_cc_alpha_reader",
  alphaAnalyst: "tvnl_live_cc_alpha_analyst",
  betaReader: "tvnl_live_cc_beta_reader",
} as const;

type Principal = { tenantId: string; principalId: string; granted: string[] };
const PRINCIPALS: Record<string, Principal> = {
  [KEYS.alphaReader]: { tenantId: "tenant-alpha", principalId: "principal-alpha-reader", granted: ["ask:read", "collections:read", "worlds:read"] },
  [KEYS.alphaAnalyst]: { tenantId: "tenant-alpha", principalId: "principal-alpha-analyst", granted: ["ask:read", "worlds:read"] },
  [KEYS.betaReader]: { tenantId: "tenant-beta", principalId: "principal-beta-reader", granted: ["ask:read", "worlds:read"] },
};

type Snapshot = { version: string; digest: string; state: "active" | "superseded" };
type Context = {
  schemaVersion: string;
  tenantId: string;
  principalId: string;
  scope: string[];
  collectionId: string;
  snapshot: { mode: string; version?: string; digest?: string };
  expiresAt?: string;
};
type Setup = { context?: unknown; required?: string };
type Outcome = { ok: true; body: unknown } | { ok: false; code: string };
type Op = { tool: string; input: Record<string, unknown>; cli: string[]; method: "GET" | "POST"; path: string; body?: Record<string, unknown> };
type Call = {
  method: string;
  pathname: string;
  principalId: string | null;
  identity: string | null;
  scopeHeader: string | null;
  snapshotMode: string | null;
  marker: string | null;
  outcome: string;
  cache: "hit" | "miss" | null;
  cacheKey: string | null;
  /** The identity the answering server acknowledged; recorded by the wired-route server only. */
  acknowledged?: string | null;
};
type RpcReply = {
  id: number;
  result?: { content?: Array<{ type: string; text: string }>; isError?: boolean; serverInfo?: { name: string } };
};

/* ----------------------------------------------------- synthetic API boundary */

let httpServer!: Server;
let baseUrl = "";
// Where the direct, CLI and MCP surfaces send requests: the synthetic boundary unless a block
// points them at the wired-route server.
let target = "";
let collections: Record<string, { tenantId: string; snapshots: Snapshot[] }> = {};
let mode: "honest" | "drift" | "silent" = "honest";
const cache = new Map<string, unknown>();
const revoked = new Set<string>();
const calls: Call[] = [];

function resetFixture() {
  collections = {
    [ALPHA]: {
      tenantId: "tenant-alpha",
      snapshots: [
        { version: "6", digest: ALPHA_V6, state: "superseded" },
        { version: "7", digest: ALPHA_V7, state: "active" },
      ],
    },
    [BETA]: { tenantId: "tenant-beta", snapshots: [{ version: "3", digest: BETA_V3, state: "active" }] },
  };
  mode = "honest";
  cache.clear();
  revoked.clear();
  calls.length = 0;
  target = baseUrl;
}

function promote(collectionId: string, version: string, snapshotDigest: string) {
  for (const snapshot of collections[collectionId]!.snapshots) snapshot.state = "superseded";
  collections[collectionId]!.snapshots.push({ version, digest: snapshotDigest, state: "active" });
}

function respond(request: IncomingMessage, response: ServerResponse, pathname: string, raw: string) {
  const header = (name: string) => {
    const value = request.headers[name];
    return Array.isArray(value) ? value.join(",") : value ?? null;
  };
  const method = request.method ?? "GET";
  const record: Call = {
    method,
    pathname,
    principalId: null,
    identity: header(CONTEXT_HEADERS.identity),
    scopeHeader: header(CONTEXT_HEADERS.scope),
    snapshotMode: header(CONTEXT_HEADERS.snapshotMode),
    marker: header(CONTEXT_REQUIRED_MARKER.header),
    outcome: "",
    cache: null,
    cacheKey: null,
  };
  calls.push(record);
  const finish = (status: number, body: unknown, extra: Record<string, string> = {}) => {
    record.outcome = status === 200 ? "OK" : String((body as { code?: string }).code);
    response.statusCode = status;
    response.setHeader("content-type", "application/json");
    response.setHeader("x-tavonel-api-version", "1");
    response.setHeader("connection", "close");
    for (const [name, value] of Object.entries(extra)) response.setHeader(name, value);
    response.end(JSON.stringify(body));
  };

  const principal = PRINCIPALS[(header("authorization") ?? "").replace(/^Bearer /, "")];
  if (!principal) return finish(401, { code: "API_KEY_INVALID" });
  record.principalId = principal.principalId;

  const route = pathname.match(/^\/api\/v1\/(?:world\/(collection-[a-f0-9]{32})|collections\/(collection-[a-f0-9]{32})\/(search|ask))$/);
  if (!route) return finish(404, { code: "ROUTE_NOT_FOUND" });
  const collectionId = (route[1] ?? route[2])!;
  const action = route[1] ? "world" : route[3]!;
  const collection = collections[collectionId];
  if (!collection) return finish(404, { code: "COLLECTION_NOT_FOUND" });

  // The required marker demands a context; any value but the one is malformed, never a waiver.
  if (record.marker !== null && record.marker !== CONTEXT_REQUIRED_MARKER.value) return finish(400, { code: "CONSUMER_CONTEXT_INVALID" });
  let parsedContext: Context | null;
  try {
    parsedContext = contextFromHeaders(header) as Context | null;
  } catch (error) {
    return finish(400, { code: (error as { code?: string }).code ?? "CONSUMER_CONTEXT_INVALID" });
  }
  const context = parsedContext;
  if (!context && record.marker !== null) return finish(400, { code: "CONSUMER_CONTEXT_REQUIRED" });
  if (context) {
    if (context.tenantId !== principal.tenantId) return finish(403, { code: "CONSUMER_CONTEXT_TENANT_MISMATCH" });
    if (context.principalId !== principal.principalId) return finish(403, { code: "CONSUMER_CONTEXT_PRINCIPAL_MISMATCH" });
    if (!context.scope.every((scope) => principal.granted.includes(scope))) return finish(403, { code: "CONSUMER_CONTEXT_SCOPE_NOT_GRANTED" });
    if (context.collectionId !== collectionId) return finish(403, { code: "CONSUMER_CONTEXT_COLLECTION_MISMATCH" });
    if (revoked.has(contextIdentity(context))) return finish(403, { code: "CONSUMER_CONTEXT_REVOKED" });
    if (context.expiresAt !== undefined && Date.parse(context.expiresAt) <= Date.now()) return finish(401, { code: "CONSUMER_CONTEXT_STALE" });
  }
  if (collection.tenantId !== principal.tenantId) return finish(403, { code: "COLLECTION_FORBIDDEN" });

  let resolved = collection.snapshots.find((snapshot) => snapshot.state === "active")!;
  if (context?.snapshot.mode === "pinned") {
    const pinned = collection.snapshots.find((snapshot) => snapshot.version === context.snapshot.version);
    if (!pinned) return finish(404, { code: "CONSUMER_CONTEXT_SNAPSHOT_UNKNOWN" });
    if (pinned.digest !== context.snapshot.digest) return finish(409, { code: "CONSUMER_CONTEXT_SNAPSHOT_MISMATCH" });
    if (pinned.state !== "active") return finish(409, { code: "CONSUMER_CONTEXT_SNAPSHOT_SUPERSEDED" });
    resolved = pinned;
  }

  const key = context
    ? cacheKey(context, { method, path: pathname, body: raw || null }, { version: resolved.version, digest: resolved.digest })
    : `legacy:${principal.principalId}:${resolved.version}:${method}:${pathname}:${raw}`;
  record.cacheKey = key;
  let body = cache.get(key);
  record.cache = body === undefined ? "miss" : "hit";
  if (body === undefined) {
    let parsed: { query?: string; question?: string } = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      return finish(400, { code: "BODY_INVALID" });
    }
    const pointer = { collectionId, manifestDigest: resolved.digest, revision: Number(resolved.version) };
    const servedTo = { tenantId: principal.tenantId, principalId: principal.principalId };
    body = action === "world"
      ? { code: "OK", model: { world: pointer, servedTo, objects: [], relations: [], evidence: [] } }
      : action === "search"
        ? { code: "SEARCH_EMPTY", retrievalPath: "compiled-retrieval-v1", contextPacket: { worldId: collectionId, worldVersion: resolved.version, question: parsed.query, items: [] }, degradations: [], activeWorld: pointer, servedTo }
        : { code: "GROUNDED_ANSWER", retrievalPath: "compiled-retrieval-v1", answer: `Synthetic answer from revision ${resolved.version}.`, citations: [], activeWorld: pointer, servedTo, question: parsed.question };
    cache.set(key, body);
  }

  const acknowledgement: Record<string, string> = {};
  if (context && mode !== "silent") {
    acknowledgement[CONTEXT_HEADERS.identity] = mode === "drift" ? `ctx1-${"0".repeat(64)}` : contextIdentity(context);
    acknowledgement[CONTEXT_HEADERS.snapshotVersion] = resolved.version;
    acknowledgement[CONTEXT_HEADERS.snapshotDigest] = resolved.digest;
  }
  return finish(200, body, acknowledgement);
}

beforeAll(async () => {
  httpServer = createHttpServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://consumer-context.test").pathname;
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => respond(request, response, pathname, raw));
  });
  await new Promise<void>((done) => httpServer.listen(0, "127.0.0.1", done));
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("consumer-context fixture did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  httpServer.closeAllConnections();
  await new Promise<void>((done, reject) => httpServer.close((error) => (error ? reject(error) : done())));
});

beforeEach(() => resetFixture());

/* ------------------------------------------------------------------ surfaces */

function context(overrides: Partial<Context> = {}): Context {
  return {
    schemaVersion: CONSUMER_CONTEXT_SCHEMA_VERSION,
    tenantId: "tenant-alpha",
    principalId: "principal-alpha-reader",
    scope: ["worlds:read", "ask:read"],
    collectionId: ALPHA,
    snapshot: { mode: "latest" },
    ...overrides,
  };
}

const pinned = (version: string, snapshotDigest: string) => ({ mode: "pinned", version, digest: snapshotDigest });

/* The identity formula restated independently, so a silent change to it fails here. */
function independentIdentity(value: Context) {
  const canonical = JSON.stringify([
    value.schemaVersion, value.tenantId, value.principalId, [...value.scope].sort(), value.collectionId,
    value.snapshot.mode, value.snapshot.version ?? null, value.snapshot.digest ?? null,
  ]);
  return `ctx1-${createHash("sha256").update(canonical).digest("hex")}`;
}

const getWorld = (collectionId = ALPHA): Op => ({
  tool: "get_world", input: { collectionId }, cli: ["get_world", collectionId], method: "GET", path: `/api/v1/world/${collectionId}`,
});
const searchWorld = (collectionId = ALPHA): Op => ({
  tool: "search_world", input: { collectionId, query: SEARCH, limit: 5 }, cli: ["search_world", collectionId, SEARCH, "--limit", "5"],
  method: "POST", path: `/api/v1/collections/${collectionId}/search`, body: { query: SEARCH, limit: 5 },
});
const askWorld = (collectionId = ALPHA): Op => ({
  tool: "ask_world", input: { collectionId, question: QUESTION }, cli: ["ask_world", collectionId, QUESTION],
  method: "POST", path: `/api/v1/collections/${collectionId}/ask`, body: { question: QUESTION },
});

function contextEnv(setup: Setup): Record<string, string> {
  const env: Record<string, string> = {};
  if (setup.context !== undefined) {
    env.TAVONEL_CONSUMER_CONTEXT = typeof setup.context === "string" ? setup.context : JSON.stringify(setup.context);
  }
  if (setup.required !== undefined) env.TAVONEL_CONSUMER_CONTEXT_REQUIRED = setup.required;
  return env;
}

function childEnv(setup: Setup, key: string): NodeJS.ProcessEnv {
  const inherited: NodeJS.ProcessEnv = { ...process.env };
  delete inherited.TAVONEL_CONSUMER_CONTEXT;
  delete inherited.TAVONEL_CONSUMER_CONTEXT_REQUIRED;
  return { ...inherited, TAVONEL_BASE_URL: target, TAVONEL_API_KEY: key, ...contextEnv(setup) };
}

/* The stable code from any surface's failure text: `403 {"code":"X"}`, `API_ERROR_403: X` or `X: detail`. */
function codeOf(text: string) {
  return (text.match(/[A-Z][A-Z_]{3,}[A-Z]/g) ?? []).find((token) => token !== "API_ERROR") ?? `UNPARSED ${text}`;
}

/* Direct: the shared module plus a plain fetch, no CLI or MCP code in between. */
async function viaDirect(op: Op, setup: Setup, key: string): Promise<Outcome> {
  try {
    const binding = createConsumerContextBinding({ env: { ...contextEnv(setup), NODE_ENV: "test" } });
    const request = { method: op.method, path: op.path };
    const response = await fetch(`${target}${op.path}`, {
      method: op.method,
      headers: {
        authorization: `Bearer ${key}`,
        accept: "application/vnd.tavonel.v1+json",
        ...(op.body ? { "content-type": "application/json" } : {}),
        ...(binding ? binding.prepare(request) : {}),
      },
      ...(op.body ? { body: JSON.stringify(op.body) } : {}),
    });
    const body = await response.json();
    if (!response.ok) return { ok: false, code: body.code };
    binding?.verify(request, response);
    return { ok: true, body };
  } catch (error) {
    return { ok: false, code: codeOf(error instanceof Error ? error.message : String(error)) };
  }
}

/* CLI: the published file (or a standalone copy of it) as a real subprocess. */
async function viaCli(op: Op, setup: Setup, key: string, cli = CLI): Promise<Outcome> {
  let stdout: string;
  try {
    ({ stdout } = await run(process.execPath, [cli, ...op.cli], { env: childEnv(setup, key), timeout: 20_000 }));
  } catch (error) {
    const failed = error as { code?: unknown; stderr?: string };
    expect(failed.code, failed.stderr).toBe(1);
    return { ok: false, code: codeOf(failed.stderr ?? "") };
  }
  return { ok: true, body: JSON.parse(stdout) };
}

/* MCP: the published server as a real stdio subprocess, driven by a JSON-RPC client. */
function mcpSession(ops: Op[], setup: Setup, key: string, mcp = MCP): Promise<RpcReply[]> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [mcp], { env: childEnv(setup, key), stdio: ["pipe", "pipe", "pipe"] });
    const expected = ops.length + 1;
    const replies = new Map<number, RpcReply>();
    let buffer = "";
    let stderr = "";
    let settled = false;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null) child.kill();
      if (error) fail(error);
      else done(Array.from({ length: expected }, (_, id) => replies.get(id)!));
    };
    const timer = setTimeout(() => settle(new Error(`MCP subprocess timed out: ${stderr}`)), 20_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line) continue;
        try {
          const reply = JSON.parse(line) as RpcReply;
          replies.set(reply.id, reply);
        } catch (error) {
          return settle(error as Error);
        }
      }
      if (replies.size === expected) settle();
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => settle(error));
    child.on("close", (code) => {
      if (replies.size < expected) settle(new Error(`MCP subprocess exited ${code} before replying: ${stderr}`));
    });
    const messages = [
      { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "consumer-context-parity", version: "0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      ...ops.map((op, index) => ({ jsonrpc: "2.0", id: index + 1, method: "tools/call", params: { name: op.tool, arguments: op.input } })),
    ];
    child.stdin.end(`${messages.map((message) => JSON.stringify(message)).join("\n")}\n`);
  });
}

async function viaMcp(op: Op, setup: Setup, key: string, mcp = MCP): Promise<Outcome> {
  const [initialized, reply] = await mcpSession([op], setup, key, mcp);
  expect(initialized?.result?.serverInfo?.name).toBe("tavonel-readonly");
  const result = reply!.result!;
  const text = result.content![0]!.text;
  return result.isError ? { ok: false, code: codeOf(text) } : { ok: true, body: JSON.parse(text) };
}

async function surfaces(op: Op, setup: Setup, key: string = KEYS.alphaReader) {
  const start = calls.length;
  const direct = await viaDirect(op, setup, key);
  const cli = await viaCli(op, setup, key);
  const mcp = await viaMcp(op, setup, key);
  return { direct, cli, mcp, calls: calls.slice(start) };
}

type Surfaces = Awaited<ReturnType<typeof surfaces>>;

/* Direct, CLI and MCP must agree exactly, success body or refusal code. */
function same(result: Surfaces): Outcome {
  expect(result.cli).toEqual(result.direct);
  expect(result.mcp).toEqual(result.direct);
  return result.direct;
}

/* A refusal on all three surfaces; local refusals must not have reached the boundary at all. */
function expectRefused(result: Surfaces, code: string, reachedBoundary: boolean) {
  expect(same(result)).toEqual({ ok: false, code });
  expect(result.calls).toHaveLength(reachedBoundary ? 3 : 0);
}

/* ---------------------------------------------------------------------- tests */

describe("consumer context: shared module", () => {
  it("states that enforcement is local synthetic evidence only, not production API support", async () => {
    expect(CONSUMER_CONTEXT_ENFORCEMENT).toMatchObject({ evidence: "local-synthetic", productionApiSupport: false });
    expect(CONSUMER_CONTEXT_ENFORCEMENT.statement).toContain("local synthetic evidence only, not production API support");
    const help = (await run(process.execPath, [CLI, "help"], { env: childEnv({}, KEYS.alphaReader), timeout: 20_000 })).stdout;
    expect(help).toContain("local synthetic evidence only, not production API support");
  }, SLOW);

  it("freezes a schema-versioned binding and refuses malformed, missing or ambiguous fields", () => {
    const bound = parseConsumerContext(JSON.stringify(context({ snapshot: pinned("7", ALPHA_V7) })));
    expect(bound).toEqual({ ...context({ snapshot: pinned("7", ALPHA_V7) }), scope: ["ask:read", "worlds:read"] });
    expect(Object.isFrozen(bound)).toBe(true);
    expect(Object.isFrozen(bound.scope)).toBe(true);
    expect(Object.isFrozen(bound.snapshot)).toBe(true);
    expect(() => { (bound as { tenantId: string }).tenantId = "tenant-beta"; }).toThrow(TypeError);

    const INVALID = "CONSUMER_CONTEXT_INVALID";
    const cases: Array<[unknown, string]> = [
      ["{not json", INVALID],
      [{ ...context(), extra: true }, INVALID],
      [context({ schemaVersion: "tavonel.consumer_context.v0" }), "CONSUMER_CONTEXT_SCHEMA_UNSUPPORTED"],
      [context({ scope: [] }), INVALID],
      [context({ scope: ["worlds:*"] }), INVALID],
      [context({ scope: ["world:read"] }), INVALID],
      [context({ scope: ["worlds:read", "worlds:read"] }), INVALID],
      [context({ snapshot: { mode: "latest", version: "7" } }), INVALID],
      [context({ snapshot: { mode: "pinned", version: "7" } }), INVALID],
      [context({ snapshot: { mode: "pinned", digest: ALPHA_V7 } }), INVALID],
      [context({ snapshot: pinned("world state 7", ALPHA_V7) }), INVALID],
      [context({ snapshot: pinned("w".repeat(257), ALPHA_V7) }), INVALID],
      [context({ collectionId: "collection-xyz" }), INVALID],
      [context({ tenantId: "Tenant Alpha" }), INVALID],
      [context({ expiresAt: "tomorrow" }), INVALID],
    ];
    for (const field of ["schemaVersion", "tenantId", "principalId", "scope", "collectionId", "snapshot"]) {
      const missing: Record<string, unknown> = { ...context() };
      delete missing[field];
      cases.push([missing, INVALID]);
    }
    for (const [input, code] of cases) expect(() => parseConsumerContext(input), JSON.stringify(input)).toThrow(code);
  });

  it("derives one deterministic identity from tenant, principal, scope, collection and snapshot", () => {
    const base = parseConsumerContext(context());
    const reordered = parseConsumerContext(JSON.stringify({
      snapshot: { mode: "latest" }, collectionId: ALPHA, scope: ["ask:read", "worlds:read"],
      principalId: "principal-alpha-reader", tenantId: "tenant-alpha", schemaVersion: CONSUMER_CONTEXT_SCHEMA_VERSION,
    }));
    expect(contextIdentity(reordered)).toBe(contextIdentity(base));
    expect(contextIdentity(base)).toBe(independentIdentity(context()));
    expect(contextIdentity(parseConsumerContext(context({ expiresAt: "2999-01-01T00:00:00.000Z" })))).toBe(contextIdentity(base));

    const variants = [
      context(),
      context({ tenantId: "tenant-beta" }),
      context({ principalId: "principal-alpha-analyst" }),
      context({ scope: ["worlds:read"] }),
      context({ collectionId: BETA }),
      context({ snapshot: pinned("7", ALPHA_V7) }),
      context({ snapshot: pinned("6", ALPHA_V6) }),
      context({ snapshot: pinned("wst_alpha-7.r2:b", ALPHA_V7) }),
    ];
    const identities = variants.map((variant) => contextIdentity(parseConsumerContext(variant)));
    expect(new Set(identities).size).toBe(variants.length);
    expect(identities).toEqual(variants.map(independentIdentity));

    const request = { method: "GET", path: `/api/v1/world/${ALPHA}` };
    expect(() => cacheKey(base, request)).toThrow("CONSUMER_CONTEXT_CACHE_UNRESOLVED");
    const atV7 = cacheKey(base, request, { version: "7", digest: ALPHA_V7 });
    expect(cacheKey(reordered, request, { version: "7", digest: ALPHA_V7 })).toBe(atV7);
    expect(cacheKey(base, request, { version: "8", digest: ALPHA_V8 })).not.toBe(atV7);
    const pinnedV7 = parseConsumerContext(context({ snapshot: pinned("7", ALPHA_V7) }));
    expect(cacheKey(pinnedV7, request)).toBe(cacheKey(pinnedV7, request, { version: "7", digest: ALPHA_V7 }));
    expect(cacheKey(pinnedV7, request)).not.toBe(atV7);
    expect(() => cacheKey(pinnedV7, request, { version: "8", digest: ALPHA_V8 })).toThrow("CONSUMER_CONTEXT_SNAPSHOT_MISMATCH");
    expect(() => cacheKey(base, request, { version: undefined, digest: ALPHA_V7 })).toThrow("CONSUMER_CONTEXT_CACHE_UNRESOLVED");

    const headers = contextHeaders(pinnedV7) as Record<string, string>;
    expect(headers[CONTEXT_HEADERS.identity]).toBe(independentIdentity(context({ snapshot: pinned("7", ALPHA_V7) })));
    expect(contextFromHeaders((name: string) => headers[name])).toEqual(pinnedV7);
    // A world_state_id is opaque; the numeric fixture versions are only one shape of it.
    const opaque = parseConsumerContext(context({ snapshot: pinned("wst_alpha-7.r2:b", ALPHA_V7) }));
    const opaqueHeaders = contextHeaders(opaque) as Record<string, string>;
    expect(contextFromHeaders((name: string) => opaqueHeaders[name])).toEqual(opaque);
    expect(cacheKey(opaque, request)).not.toBe(cacheKey(pinnedV7, request));

    expect(createConsumerContextBinding({ env: { NODE_ENV: "test" } })).toBeNull();
    for (const flag of ["false", " FALSE\t", "", "  "]) {
      expect(createConsumerContextBinding({ env: { NODE_ENV: "test", TAVONEL_CONSUMER_CONTEXT_REQUIRED: flag } }), JSON.stringify(flag)).toBeNull();
    }
    const strict = createConsumerContextBinding({ env: { NODE_ENV: "test", TAVONEL_CONSUMER_CONTEXT_REQUIRED: " TRUE " } });
    expect([strict?.required, strict?.error?.code]).toEqual([true, "CONSUMER_CONTEXT_REQUIRED"]);
  });

  it("uses the server's DeveloperScope names and route scopes", () => {
    expect(CONSUMER_SCOPES).toEqual(DEVELOPER_SCOPES);
    const routes = [
      ["GET", `/api/v1/world/${ALPHA}/objects?limit=5`, "worlds:read"],
      ["GET", `/api/v1/collections/${ALPHA}/world`, "worlds:read"],
      ["POST", `/api/v1/collections/${ALPHA}/search`, "ask:read"],
      ["POST", `/api/v1/collections/${ALPHA}/ask`, "ask:read"],
      ["GET", `/api/v1/collections/${ALPHA}/download`, "collections:download"],
      ["DELETE", "/api/v1/connections/00000000-0000-4000-8000-000000000000", "connections:write"],
      ["POST", "/api/v1/connections/00000000-0000-4000-8000-000000000000/sync", "connections:sync"],
    ];
    for (const [method, path, scope] of routes) expect(requiredScope(method, path), `${method} ${path}`).toBe(scope);
  });
});

/* ------------------------------------------- server helper (lib/consumer-context-api.ts) */

/*
  Synthetic FoundationPrincipals only, shaped as lib/developer-auth.ts builds them: the helper is
  pure, so nothing below authenticates, reads a store or opens a socket. Local synthetic evidence
  only, not production API support; the routes that call the helper are the blocks after this one.
*/
const WORKSPACE = "pilot-alpha";
const KEY_ID = "3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b";
const USER_ID = "8a9b0c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d";
const OTHER_ID = "4c5d6e7f-8a9b-4c0d-9e1f-2a3b4c5d6e7f";
const NOW = Date.parse("2026-10-02T12:00:00.000Z");
const WORLD_ROUTE: ConsumerContextRoute = { scope: "worlds:read", collectionId: ALPHA };
const MARKER = { [CONTEXT_REQUIRED_MARKER.header]: CONTEXT_REQUIRED_MARKER.value };

const AT6: ConsumerSnapshot = { worldStateId: "wst_alpha-6.r1", manifestDigest: ALPHA_V6 };
const AT7: ConsumerSnapshot = { worldStateId: "wst_alpha-7.r2:b", manifestDigest: ALPHA_V7 };
const AT8: ConsumerSnapshot = { worldStateId: "wst_alpha-8.r1", manifestDigest: ALPHA_V8 };

const apiKeyPrincipal = (overrides: Partial<FoundationPrincipal> = {}): FoundationPrincipal => ({
  kind: "api-key", workspaceKey: WORKSPACE, userId: USER_ID, keyId: KEY_ID,
  scopes: ["ask:read", "collections:read", "worlds:read"], authorizationRevision: 1, workspaceRole: "member",
  ...overrides,
});
// authorizeFoundationRequest grants a session exactly the scope of the route it authorized.
const sessionPrincipal = (overrides: Partial<FoundationPrincipal> = {}): FoundationPrincipal => ({
  kind: "session", workspaceKey: WORKSPACE, userId: USER_ID,
  scopes: ["worlds:read"], authorizationRevision: 1, workspaceRole: "member",
  ...overrides,
});

const keyContext = (overrides: Partial<Context> = {}) => context({ tenantId: WORKSPACE, principalId: KEY_ID, scope: ["worlds:read"], ...overrides });
const sessionContext = (overrides: Partial<Context> = {}) => context({ tenantId: WORKSPACE, principalId: USER_ID, scope: ["worlds:read"], ...overrides });
const pinnedTo = (pair: ConsumerSnapshot) => pinned(pair.worldStateId, pair.manifestDigest);

/* The headers a conforming client sends for a context, then whatever a spoofing one overrides. */
function sent(value: Context, extra: Record<string, string> = {}) {
  return new Headers({ ...(contextHeaders(parseConsumerContext(value)) as Record<string, string>), ...extra });
}

const refused = (code: ConsumerContextRefusalCode) => ({ ok: false, code, status: CONSUMER_CONTEXT_REFUSALS[code] });

function boundOf(result: ConsumerContextBinding): BoundConsumerContext {
  if (!result.ok || !result.bound) throw new Error(`expected a bound context, got ${JSON.stringify(result)}`);
  return result;
}

function resolvedOf(result: SnapshotResolution): ResolvedConsumerSnapshot {
  if (!result.ok) throw new Error(`expected a resolved snapshot, got ${result.code}`);
  return result;
}

describe("consumer context: server helper over synthetic principals", () => {
  it("states that the helper is local synthetic evidence only, not production API support", () => {
    expect(SERVER_ENFORCEMENT).toBe(CONSUMER_CONTEXT_ENFORCEMENT);
    expect(SERVER_ENFORCEMENT).toMatchObject({ evidence: "local-synthetic", productionApiSupport: false });
    expect(SERVER_ENFORCEMENT.statement).toContain("local synthetic evidence only, not production API support");
  });

  it("tells a required-but-missing context from a legacy request by the marker alone", () => {
    const request = { method: "GET", path: `/api/v1/world/${ALPHA}` };
    const required = createConsumerContextBinding({ env: { NODE_ENV: "test", TAVONEL_CONSUMER_CONTEXT: JSON.stringify(keyContext()), TAVONEL_CONSUMER_CONTEXT_REQUIRED: "true" } })!;
    const optional = createConsumerContextBinding({ env: { NODE_ENV: "test", TAVONEL_CONSUMER_CONTEXT: JSON.stringify(keyContext()) } })!;
    const requiredHeaders = required.prepare(request) as Record<string, string>;
    expect(requiredHeaders[CONTEXT_REQUIRED_MARKER.header]).toBe(CONTEXT_REQUIRED_MARKER.value);
    expect(Object.keys(optional.prepare(request) as Record<string, string>)).not.toContain(CONTEXT_REQUIRED_MARKER.header);

    // The marker is control, not context: ignored while rebuilding a real context, null alone.
    const withMarker = new Headers(requiredHeaders);
    expect(contextFromHeaders((name: string) => withMarker.get(name))).toEqual(parseConsumerContext(keyContext()));
    expect(boundOf(bindConsumerContext(withMarker, apiKeyPrincipal(), WORLD_ROUTE, NOW)).identity).toBe(required.identity);
    const markerOnly = new Headers(MARKER);
    expect(contextFromHeaders((name: string) => markerOnly.get(name))).toBeNull();

    expect(bindConsumerContext(markerOnly, apiKeyPrincipal(), WORLD_ROUTE, NOW)).toEqual(refused("CONSUMER_CONTEXT_REQUIRED"));
    expect(bindConsumerContext(markerOnly, sessionPrincipal(), WORLD_ROUTE, NOW)).toEqual(refused("CONSUMER_CONTEXT_REQUIRED"));
    expect(bindConsumerContext(new Headers(), apiKeyPrincipal(), WORLD_ROUTE, NOW)).toEqual({ ok: true, bound: false });
    expect(bindConsumerContext(new Headers(), sessionPrincipal(), WORLD_ROUTE, NOW)).toEqual({ ok: true, bound: false });
    // Only the one value demands a context; any other is malformed, never a waiver.
    for (const value of ["false", "TRUE", "1", ""]) {
      const marker = { [CONTEXT_REQUIRED_MARKER.header]: value };
      expect(bindConsumerContext(new Headers(marker), apiKeyPrincipal(), WORLD_ROUTE, NOW), value).toEqual(refused("CONSUMER_CONTEXT_INVALID"));
      expect(bindConsumerContext(sent(keyContext(), marker), apiKeyPrincipal(), WORLD_ROUTE, NOW), value).toEqual(refused("CONSUMER_CONTEXT_INVALID"));
    }
  });

  it("binds an API key by its keyId and a session by its userId, with a server-recomputed identity", () => {
    const viaKey = boundOf(bindConsumerContext(sent(keyContext()), apiKeyPrincipal(), WORLD_ROUTE, NOW));
    expect(viaKey.context).toEqual(parseConsumerContext(keyContext()));
    expect(viaKey.identity).toBe(independentIdentity(keyContext()));
    expect(Object.isFrozen(viaKey)).toBe(true);
    const viaSession = boundOf(bindConsumerContext(sent(sessionContext()), sessionPrincipal(), WORLD_ROUTE, NOW));
    expect(viaSession.identity).toBe(independentIdentity(sessionContext()));
    expect([contextPrincipalId(apiKeyPrincipal()), contextPrincipalId(sessionPrincipal())]).toEqual([KEY_ID, USER_ID]);

    const PRINCIPAL = refused("CONSUMER_CONTEXT_PRINCIPAL_MISMATCH");
    // An API key is its key, not the user who minted it; a session is its user, never a key.
    expect(bindConsumerContext(sent(sessionContext()), apiKeyPrincipal(), WORLD_ROUTE, NOW)).toEqual(PRINCIPAL);
    expect(bindConsumerContext(sent(keyContext()), sessionPrincipal({ keyId: KEY_ID }), WORLD_ROUTE, NOW)).toEqual(PRINCIPAL);
    expect(bindConsumerContext(sent(keyContext()), apiKeyPrincipal({ keyId: undefined }), WORLD_ROUTE, NOW)).toEqual(PRINCIPAL);
    expect(bindConsumerContext(sent(sessionContext()), sessionPrincipal({ userId: OTHER_ID }), WORLD_ROUTE, NOW)).toEqual(PRINCIPAL);
  });

  it("accepts a tenant as exactly a Foundation workspace key, case and all, and binds it only to that workspace", () => {
    // lib/immutable-keys.ts WORKSPACE_ID_PATTERN: /^[A-Za-z0-9_-]{1,80}$/.
    const MIXED = "Pilot_ALPHA-7";
    const mixedKey = keyContext({ tenantId: MIXED });
    const mixedSession = sessionContext({ tenantId: MIXED });

    // Parsed as given: no case folding, so the identity is of the exact workspace key.
    const parsed = parseConsumerContext(JSON.stringify(mixedKey));
    expect(parsed.tenantId).toBe(MIXED);
    expect(contextIdentity(parsed)).toBe(independentIdentity(mixedKey));
    expect(contextIdentity(parsed)).not.toBe(independentIdentity(keyContext({ tenantId: MIXED.toLowerCase() })));
    const headers = contextHeaders(parsed) as Record<string, string>;
    expect(headers[CONTEXT_HEADERS.tenant]).toBe(MIXED);
    expect(contextFromHeaders((name: string) => headers[name])).toEqual(parsed);

    // Binds only to an authenticated principal of that exact workspace.
    const viaKey = boundOf(bindConsumerContext(sent(mixedKey), apiKeyPrincipal({ workspaceKey: MIXED }), WORLD_ROUTE, NOW));
    expect(viaKey.context.tenantId).toBe(MIXED);
    expect(viaKey.identity).toBe(independentIdentity(mixedKey));
    const viaSession = boundOf(bindConsumerContext(sent(mixedSession), sessionPrincipal({ workspaceKey: MIXED }), WORLD_ROUTE, NOW));
    expect(viaSession.identity).toBe(independentIdentity(mixedSession));

    // A principal whose workspace differs only in case is another workspace.
    const TENANT = refused("CONSUMER_CONTEXT_TENANT_MISMATCH");
    for (const other of [MIXED.toLowerCase(), MIXED.toUpperCase(), "pilot_Alpha-7"]) {
      expect(bindConsumerContext(sent(mixedKey), apiKeyPrincipal({ workspaceKey: other }), WORLD_ROUTE, NOW), other).toEqual(TENANT);
      expect(bindConsumerContext(sent(mixedSession), sessionPrincipal({ workspaceKey: other }), WORLD_ROUTE, NOW), other).toEqual(TENANT);
      expect(bindConsumerContext(sent(keyContext({ tenantId: other })), apiKeyPrincipal({ workspaceKey: MIXED }), WORLD_ROUTE, NOW), other).toEqual(TENANT);
    }

    // The tenant takes the workspace pattern's whole range and nothing past it.
    for (const tenantId of ["A", "_", "W".repeat(80), "0-workspace_KEY"]) {
      expect(parseConsumerContext(keyContext({ tenantId })).tenantId, tenantId).toBe(tenantId);
    }
    const INVALID = "CONSUMER_CONTEXT_INVALID";
    for (const tenantId of ["", "W".repeat(81), "Pilot Alpha", "pilot.alpha", "pilot/alpha", "pilot-alpha\n"]) {
      expect(() => parseConsumerContext(keyContext({ tenantId })), JSON.stringify(tenantId)).toThrow(INVALID);
    }
    // The principal keeps its stricter pattern: lowercase, a leading letter or digit, 3 to 64.
    for (const principalId of ["Principal-Alpha", KEY_ID.toUpperCase(), "ab", "_principal", "p".repeat(65)]) {
      expect(() => parseConsumerContext(keyContext({ tenantId: MIXED, principalId })), principalId).toThrow(INVALID);
    }
  });

  it("refuses spoofed identity, tenant, principal, scope and collection", () => {
    const bind = (headers: Headers, route = WORLD_ROUTE, principal = apiKeyPrincipal()) => bindConsumerContext(headers, principal, route, NOW);
    const IDENTITY = refused("CONSUMER_CONTEXT_IDENTITY_MISMATCH");

    // A claimed identity is only compared with the one the server recomputes.
    expect(bind(sent(keyContext(), { [CONTEXT_HEADERS.identity]: `ctx1-${"0".repeat(64)}` }))).toEqual(IDENTITY);
    expect(bind(sent(keyContext(), { [CONTEXT_HEADERS.identity]: independentIdentity(sessionContext()) }))).toEqual(IDENTITY);
    const withoutIdentity = sent(keyContext());
    withoutIdentity.delete(CONTEXT_HEADERS.identity);
    expect(bind(withoutIdentity)).toEqual(IDENTITY);
    // Editing a bound field without recomputing the identity is tampering...
    expect(bind(sent(keyContext(), { [CONTEXT_HEADERS.tenant]: "pilot-beta" }))).toEqual(IDENTITY);
    expect(bind(sent(keyContext(), { [CONTEXT_HEADERS.principal]: OTHER_ID }))).toEqual(IDENTITY);
    expect(bind(sent(keyContext(), { [CONTEXT_HEADERS.scope]: "collections:read worlds:read" }))).toEqual(IDENTITY);
    // ...and recomputing it, which anyone can, still has to hold against the verified principal.
    expect(bind(sent(keyContext({ tenantId: "pilot-beta" })))).toEqual(refused("CONSUMER_CONTEXT_TENANT_MISMATCH"));
    expect(bind(sent(sessionContext({ tenantId: "pilot-beta" })), WORLD_ROUTE, sessionPrincipal())).toEqual(refused("CONSUMER_CONTEXT_TENANT_MISMATCH"));
    expect(bind(sent(keyContext({ principalId: OTHER_ID })))).toEqual(refused("CONSUMER_CONTEXT_PRINCIPAL_MISMATCH"));
    expect(bind(sent(keyContext({ scope: ["ask:read"] })))).toEqual(refused("CONSUMER_CONTEXT_SCOPE_DENIED"));
    expect(bind(sent(keyContext({ scope: ["collections:download", "worlds:read"] })))).toEqual(refused("CONSUMER_CONTEXT_SCOPE_NOT_GRANTED"));
    expect(bind(sent(keyContext()), WORLD_ROUTE, apiKeyPrincipal({ scopes: ["ask:read"] }))).toEqual(refused("CONSUMER_CONTEXT_SCOPE_NOT_GRANTED"));
    // A session holds only its route's scope, so a wider context is not its to declare.
    expect(bind(sent(sessionContext({ scope: ["ask:read", "worlds:read"] })), WORLD_ROUTE, sessionPrincipal())).toEqual(refused("CONSUMER_CONTEXT_SCOPE_NOT_GRANTED"));
    expect(bind(sent(keyContext({ collectionId: BETA })))).toEqual(refused("CONSUMER_CONTEXT_COLLECTION_MISMATCH"));
    expect(bind(sent(keyContext()), { scope: "worlds:read", collectionId: BETA })).toEqual(refused("CONSUMER_CONTEXT_COLLECTION_MISMATCH"));

    // A refusal carries a code and a status, nothing the request claimed.
    expect(Object.keys(bind(sent(keyContext({ tenantId: "pilot-beta" }))))).toEqual(["ok", "code", "status"]);
  });

  it("refuses a partial or malformed context instead of reading it as legacy", () => {
    const bind = (headers: Headers) => bindConsumerContext(headers, apiKeyPrincipal(), WORLD_ROUTE, NOW);
    const INVALID = refused("CONSUMER_CONTEXT_INVALID");
    const required = [CONTEXT_HEADERS.schema, CONTEXT_HEADERS.tenant, CONTEXT_HEADERS.principal, CONTEXT_HEADERS.scope, CONTEXT_HEADERS.collection, CONTEXT_HEADERS.snapshotMode];
    for (const name of required) {
      for (const extra of [{}, MARKER] as Array<Record<string, string>>) {
        const partial = sent(keyContext(), extra);
        partial.delete(name);
        expect(bind(partial), name).toEqual(INVALID);
      }
    }
    const pinnedWithoutDigest = sent(keyContext({ snapshot: pinnedTo(AT7) }));
    pinnedWithoutDigest.delete(CONTEXT_HEADERS.snapshotDigest);
    expect(bind(pinnedWithoutDigest)).toEqual(INVALID);
    expect(bind(new Headers({ [CONTEXT_HEADERS.identity]: independentIdentity(keyContext()) }))).toEqual(INVALID);
    expect(bind(sent(keyContext(), { [CONTEXT_HEADERS.scope]: "worlds:*" }))).toEqual(INVALID);
    expect(bind(sent(keyContext(), { [CONTEXT_HEADERS.schema]: "tavonel.consumer_context.v0" }))).toEqual(refused("CONSUMER_CONTEXT_SCHEMA_UNSUPPORTED"));
    // A latest context that also names a snapshot is a client asserting one: refused, never read.
    expect(bind(sent(keyContext(), { [CONTEXT_HEADERS.snapshotVersion]: AT7.worldStateId, [CONTEXT_HEADERS.snapshotDigest]: AT7.manifestDigest }))).toEqual(INVALID);
  });

  it("refuses an expired context against the server clock", () => {
    const expiring = keyContext({ expiresAt: new Date(NOW + 60_000).toISOString() });
    // Expiry is not part of the identity, so an expiring context binds as the same one.
    expect(boundOf(bindConsumerContext(sent(expiring), apiKeyPrincipal(), WORLD_ROUTE, NOW)).identity).toBe(independentIdentity(keyContext()));
    expect(bindConsumerContext(sent(expiring), apiKeyPrincipal(), WORLD_ROUTE, NOW + 60_000)).toEqual(refused("CONSUMER_CONTEXT_STALE"));
    const expired = sessionContext({ expiresAt: "2020-01-01T00:00:00.000Z" });
    expect(bindConsumerContext(sent(expired), sessionPrincipal(), WORLD_ROUTE, NOW)).toEqual({ ok: false, code: "CONSUMER_CONTEXT_STALE", status: 401 });
  });

  it("resolves latest to the active pair and pinned only to its exact world_state_id and digest", () => {
    const UNRESOLVED = refused("CONSUMER_CONTEXT_SNAPSHOT_UNRESOLVED");
    const MISMATCH = refused("CONSUMER_CONTEXT_SNAPSHOT_MISMATCH");
    const latest = boundOf(bindConsumerContext(sent(keyContext()), apiKeyPrincipal(), WORLD_ROUTE, NOW));
    // The pair only, never the rest of the row the route read.
    const resolution = resolvedOf(resolveConsumerSnapshot(latest, { ...AT7, state: "active" } as ConsumerSnapshot, [AT6]));
    expect(resolution).toEqual({ ok: true, identity: latest.identity, snapshot: AT7 });
    expect(Object.isFrozen(resolution)).toBe(true);
    expect(resolveConsumerSnapshot(latest, { worldStateId: "", manifestDigest: ALPHA_V7 })).toEqual(UNRESOLVED);
    expect(resolveConsumerSnapshot(latest, { worldStateId: AT7.worldStateId, manifestDigest: "sha256:7" })).toEqual(UNRESOLVED);

    const pin = (pair: ConsumerSnapshot) => boundOf(bindConsumerContext(sent(keyContext({ snapshot: pinnedTo(pair) })), apiKeyPrincipal(), WORLD_ROUTE, NOW));
    expect(resolvedOf(resolveConsumerSnapshot(pin(AT7), AT7, [AT6])).snapshot).toEqual(AT7);
    expect(resolveConsumerSnapshot(pin(AT6), AT7, [AT6])).toEqual(refused("CONSUMER_CONTEXT_SNAPSHOT_SUPERSEDED"));
    expect(resolveConsumerSnapshot(pin(AT8), AT7, [AT6])).toEqual(refused("CONSUMER_CONTEXT_SNAPSHOT_UNKNOWN"));
    // Half a pair is not the pair, whichever half matches.
    expect(resolveConsumerSnapshot(pin({ worldStateId: AT7.worldStateId, manifestDigest: ALPHA_V6 }), AT7, [AT6])).toEqual(MISMATCH);
    expect(resolveConsumerSnapshot(pin({ worldStateId: AT6.worldStateId, manifestDigest: ALPHA_V7 }), AT7, [AT6])).toEqual(MISMATCH);
    expect(resolveConsumerSnapshot(pin({ worldStateId: AT8.worldStateId, manifestDigest: ALPHA_V7 }), AT7, [AT6])).toEqual(refused("CONSUMER_CONTEXT_SNAPSHOT_UNKNOWN"));
  });

  it("builds acknowledgements from the server's resolution and the payload's actual snapshot only", () => {
    const UNRESOLVED = refused("CONSUMER_CONTEXT_SNAPSHOT_UNRESOLVED");
    const MISMATCH = refused("CONSUMER_CONTEXT_SNAPSHOT_MISMATCH");
    const ackHeaders = (identity: string, pair: ConsumerSnapshot) => ({
      [CONTEXT_HEADERS.identity]: identity,
      [CONTEXT_HEADERS.snapshotVersion]: pair.worldStateId,
      [CONTEXT_HEADERS.snapshotDigest]: pair.manifestDigest,
    });

    const latest = boundOf(bindConsumerContext(sent(keyContext(), MARKER), apiKeyPrincipal(), WORLD_ROUTE, NOW));
    const atV7 = resolvedOf(resolveConsumerSnapshot(latest, AT7, [AT6]));
    const ack = acknowledgeConsumerContext(latest, atV7, AT7);
    // Exactly three headers: the recomputed identity and the payload's pair. Nothing echoed, no marker.
    expect(ack).toEqual({ ok: true, headers: ackHeaders(independentIdentity(keyContext()), AT7) });
    expect(Object.isFrozen(ack)).toBe(true);
    // The client accepts exactly what the server built, required or not.
    const response = new Response(null, { headers: ack.ok ? { ...ack.headers } : {} });
    expect(verifyResponseContext(parseConsumerContext(keyContext()), response, { required: true })).toEqual({
      acknowledged: true,
      snapshot: { version: AT7.worldStateId, digest: AT7.manifestDigest },
    });

    // Latest moved between resolving and building: refused, never acknowledged as either World.
    expect(acknowledgeConsumerContext(latest, atV7, AT8)).toEqual(MISMATCH);
    expect(acknowledgeConsumerContext(latest, atV7, { worldStateId: AT7.worldStateId, manifestDigest: ALPHA_V8 })).toEqual(MISMATCH);
    expect(acknowledgeConsumerContext(latest, atV7, { worldStateId: AT7.worldStateId } as ConsumerSnapshot)).toEqual(UNRESOLVED);
    // A resolution belongs to the bound context it was resolved for.
    const session = boundOf(bindConsumerContext(sent(sessionContext()), sessionPrincipal(), WORLD_ROUTE, NOW));
    expect(acknowledgeConsumerContext(session, atV7, AT7)).toEqual(UNRESOLVED);

    // Pinned: acknowledged only with its exact pair, taken from the payload argument -- the request's
    // own snapshot headers are a demand that was checked, never what the acknowledgement reports.
    const pinnedV7 = boundOf(bindConsumerContext(sent(keyContext({ snapshot: pinnedTo(AT7) })), apiKeyPrincipal(), WORLD_ROUTE, NOW));
    const pinnedAt = resolvedOf(resolveConsumerSnapshot(pinnedV7, AT7, [AT6]));
    expect(acknowledgeConsumerContext(pinnedV7, pinnedAt, AT7)).toEqual({
      ok: true,
      headers: ackHeaders(independentIdentity(keyContext({ snapshot: pinnedTo(AT7) })), AT7),
    });
    expect(acknowledgeConsumerContext(pinnedV7, pinnedAt, AT6)).toEqual(MISMATCH);
    expect(acknowledgeConsumerContext(pinnedV7, atV7, AT7)).toEqual(UNRESOLVED);
    // A server that acknowledged another pair would be refused by the client anyway.
    const drifted = new Response(null, { headers: ackHeaders(pinnedV7.identity, AT8) });
    expect(() => verifyResponseContext(pinnedV7.context, drifted, { required: true })).toThrow("CONSUMER_CONTEXT_SNAPSHOT_MISMATCH");
  });
});

describe("consumer context: direct, CLI and MCP against the synthetic API boundary", () => {
  it("preserves legacy behavior when no consumer context is configured", async () => {
    for (const setup of [{}, { required: "false" }, { required: " FALSE\t" }, { required: "  " }] as Setup[]) {
      const result = await surfaces(getWorld(), setup);
      expect(same(result)).toMatchObject({ ok: true, body: { code: "OK", model: { world: { revision: 7 } } } });
      expect(result.calls.map((call) => [call.identity, call.scopeHeader, call.snapshotMode, call.marker])).toEqual(Array(3).fill([null, null, null, null]));
    }
  }, SLOW);

  it("binds all three surfaces to the same latest context, headers and cache identity", async () => {
    const identity = independentIdentity(context());
    for (const op of [getWorld(), searchWorld(), askWorld()]) {
      const result = await surfaces(op, { context: context(), required: "true" });
      const outcome = same(result);
      expect(outcome.ok, op.tool).toBe(true);
      expect(JSON.stringify(outcome)).toContain(`"revision":7`);
      expect(result.calls.map((call) => call.identity)).toEqual(Array(3).fill(identity));
      expect(result.calls.map((call) => call.scopeHeader)).toEqual(Array(3).fill("ask:read worlds:read"));
      expect(result.calls.map((call) => call.snapshotMode)).toEqual(Array(3).fill("latest"));
      expect(result.calls.map((call) => call.marker)).toEqual(Array(3).fill(CONTEXT_REQUIRED_MARKER.value));
      expect(result.calls.map((call) => call.cache)).toEqual(["miss", "hit", "hit"]);
    }
  }, SLOW);

  it("serves a pinned snapshot, follows latest across a promotion and refuses a superseded pin", async () => {
    const pinnedV7 = context({ snapshot: pinned("7", ALPHA_V7) });
    let result = await surfaces(getWorld(), { context: pinnedV7, required: "true" });
    expect(same(result)).toMatchObject({ ok: true, body: { model: { world: { revision: 7, manifestDigest: ALPHA_V7 } } } });
    expect(result.calls.map((call) => call.snapshotMode)).toEqual(Array(3).fill("pinned"));

    expectRefused(await surfaces(getWorld(), { context: context({ snapshot: pinned("6", ALPHA_V6) }) }), "CONSUMER_CONTEXT_SNAPSHOT_SUPERSEDED", true);
    expectRefused(await surfaces(getWorld(), { context: context({ snapshot: pinned("9", ALPHA_V8) }) }), "CONSUMER_CONTEXT_SNAPSHOT_UNKNOWN", true);

    expect(same(await surfaces(getWorld(), { context: context() }))).toMatchObject({ ok: true, body: { model: { world: { revision: 7 } } } });
    promote(ALPHA, "8", ALPHA_V8);
    result = await surfaces(getWorld(), { context: context() });
    // Same latest identity, new resolved snapshot: a fresh cache entry, never the previous World.
    expect(same(result)).toMatchObject({ ok: true, body: { model: { world: { revision: 8, manifestDigest: ALPHA_V8 } } } });
    expect(result.calls.map((call) => call.cache)).toEqual(["miss", "hit", "hit"]);
    expectRefused(await surfaces(getWorld(), { context: pinnedV7 }), "CONSUMER_CONTEXT_SNAPSHOT_SUPERSEDED", true);

    // An opaque world_state_id pins and is acknowledged on every surface, like a numeric one.
    promote(ALPHA, "wst_alpha-9.r1", digest("9"));
    result = await surfaces(getWorld(), { context: context({ snapshot: pinned("wst_alpha-9.r1", digest("9")) }), required: "true" });
    expect(same(result)).toMatchObject({ ok: true, body: { model: { world: { manifestDigest: digest("9") } } } });
  }, SLOW);

  it("refuses stale contexts before the network", async () => {
    expectRefused(await surfaces(getWorld(), { context: context({ expiresAt: "2020-01-01T00:00:00.000Z" }) }), "CONSUMER_CONTEXT_STALE", false);
    const result = await surfaces(getWorld(), { context: context({ expiresAt: "2999-01-01T00:00:00.000Z" }) });
    expect(same(result).ok).toBe(true);
    expect(result.calls.map((call) => call.identity)).toEqual(Array(3).fill(independentIdentity(context())));
    // A context that is not required carries no marker.
    expect(result.calls.map((call) => call.marker)).toEqual([null, null, null]);
  }, SLOW);

  it("refuses mismatched contexts locally and at the boundary", async () => {
    expectRefused(await surfaces(getWorld(ALPHA), { context: context({ collectionId: BETA }) }), "CONSUMER_CONTEXT_COLLECTION_MISMATCH", false);
    expectRefused(await surfaces(searchWorld(), { context: context({ scope: ["worlds:read"] }) }), "CONSUMER_CONTEXT_SCOPE_DENIED", false);
    expectRefused(await surfaces(getWorld(), { context: context({ snapshot: pinned("7", ALPHA_V6) }) }), "CONSUMER_CONTEXT_SNAPSHOT_MISMATCH", true);

    mode = "drift";
    expectRefused(await surfaces(getWorld(), { context: context() }), "CONSUMER_CONTEXT_MISMATCH", true);
    mode = "honest";

    const tampered = { ...(contextHeaders(parseConsumerContext(context())) as Record<string, string>), [CONTEXT_HEADERS.tenant]: "tenant-beta" };
    const response = await fetch(`${baseUrl}/api/v1/world/${ALPHA}`, { headers: { authorization: `Bearer ${KEYS.alphaReader}`, ...tampered } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "CONSUMER_CONTEXT_IDENTITY_MISMATCH" });
  }, SLOW);

  it("refuses a revoked context without caching, while other contexts stay usable", async () => {
    const analyst = context({ principalId: "principal-alpha-analyst", scope: ["worlds:read"] });
    revoked.add(independentIdentity(analyst));
    const result = await surfaces(getWorld(), { context: analyst }, KEYS.alphaAnalyst);
    expectRefused(result, "CONSUMER_CONTEXT_REVOKED", true);
    expect(result.calls.map((call) => call.cache)).toEqual([null, null, null]);
    expect(cache.size).toBe(0);
    const unrevoked = context({ principalId: "principal-alpha-analyst", scope: ["worlds:read"], snapshot: pinned("7", ALPHA_V7) });
    expect(same(await surfaces(getWorld(), { context: unrevoked }, KEYS.alphaAnalyst)).ok).toBe(true);
  }, SLOW);

  it("fails closed when a required context is missing, unusable or unacknowledged", async () => {
    expectRefused(await surfaces(getWorld(), { required: "true" }), "CONSUMER_CONTEXT_REQUIRED", false);
    expectRefused(await surfaces(getWorld(), { required: "true", context: "{not json" }), "CONSUMER_CONTEXT_INVALID", false);
    expectRefused(await surfaces(getWorld(), { context: context(), required: "yes" }), "CONSUMER_CONTEXT_REQUIRED_FLAG_INVALID", false);
    // A supplied context is never silently dropped, required or not.
    const withoutPrincipal: Partial<Context> = context();
    delete withoutPrincipal.principalId;
    expectRefused(await surfaces(getWorld(), { context: withoutPrincipal }), "CONSUMER_CONTEXT_INVALID", false);

    mode = "silent";
    expectRefused(await surfaces(getWorld(), { context: context(), required: "true" }), "CONSUMER_CONTEXT_NOT_ACKNOWLEDGED", true);
    expect(same(await surfaces(getWorld(), { context: context() })).ok).toBe(true);
    mode = "honest";

    // Only a non-conforming client sends the marker without a context: required-missing, never legacy.
    const markerOnly: Array<[string, string]> = [[CONTEXT_REQUIRED_MARKER.value, "CONSUMER_CONTEXT_REQUIRED"], ["false", "CONSUMER_CONTEXT_INVALID"]];
    for (const [value, code] of markerOnly) {
      const response = await fetch(`${baseUrl}/api/v1/world/${ALPHA}`, {
        headers: { authorization: `Bearer ${KEYS.alphaReader}`, [CONTEXT_REQUIRED_MARKER.header]: value },
      });
      expect(response.status, value).toBe(400);
      expect(await response.json(), value).toEqual({ code });
    }
  }, SLOW);

  it("refuses the MCP --doctor authenticated read when a required context is missing", async () => {
    let stdout = "";
    try {
      await run(process.execPath, [MCP, "--doctor"], { env: childEnv({ required: "true" }, KEYS.alphaReader), timeout: 20_000 });
      expect.unreachable("--doctor must exit non-zero when its authenticated read is refused");
    } catch (error) {
      const failed = error as { code?: unknown; stdout?: string; stderr?: string };
      expect(failed.code, failed.stderr).toBe(1);
      stdout = failed.stdout ?? "";
    }
    expect(stdout).toMatch(/FAIL {2}authenticated_read: CONSUMER_CONTEXT_REQUIRED/);
    // The context binding refuses before the network: no collections request reaches the boundary.
    expect(calls.filter((call) => call.pathname.startsWith("/api/v1/collections"))).toEqual([]);
  }, SLOW);

  it("refuses cross-tenant and cross-principal contexts", async () => {
    expectRefused(await surfaces(getWorld(), { context: context() }, KEYS.alphaAnalyst), "CONSUMER_CONTEXT_PRINCIPAL_MISMATCH", true);
    expectRefused(await surfaces(getWorld(BETA), { context: context({ tenantId: "tenant-beta", collectionId: BETA }) }), "CONSUMER_CONTEXT_TENANT_MISMATCH", true);
    expectRefused(
      await surfaces(getWorld(), { context: context({ tenantId: "tenant-beta", principalId: "principal-beta-reader" }) }, KEYS.betaReader),
      "COLLECTION_FORBIDDEN",
      true,
    );
    expectRefused(
      await surfaces(getWorld(), { context: context({ principalId: "principal-alpha-analyst", scope: ["collections:read", "worlds:read"] }) }, KEYS.alphaAnalyst),
      "CONSUMER_CONTEXT_SCOPE_NOT_GRANTED",
      true,
    );
    expect(cache.size).toBe(0);
  }, SLOW);

  it("keeps cache entries separate per tenant, principal, scope, collection and snapshot", async () => {
    const variants: Array<[string, Context, string, Op]> = [
      ["latest", context(), KEYS.alphaReader, getWorld()],
      ["pinned", context({ snapshot: pinned("7", ALPHA_V7) }), KEYS.alphaReader, getWorld()],
      ["narrower scope", context({ scope: ["worlds:read"] }), KEYS.alphaReader, getWorld()],
      ["other principal", context({ principalId: "principal-alpha-analyst" }), KEYS.alphaAnalyst, getWorld()],
      ["other tenant and collection", context({ tenantId: "tenant-beta", principalId: "principal-beta-reader", collectionId: BETA }), KEYS.betaReader, getWorld(BETA)],
    ];
    const identities = new Set<string>();
    const keys = new Set<string>();
    for (const [label, bound, key, op] of variants) {
      const result = await surfaces(op, { context: bound, required: "true" }, key);
      const outcome = same(result);
      expect(outcome.ok, label).toBe(true);
      expect(result.calls.map((call) => call.cache), label).toEqual(["miss", "hit", "hit"]);
      expect(new Set(result.calls.map((call) => call.identity)), label).toEqual(new Set([independentIdentity(bound)]));
      expect(new Set(result.calls.map((call) => call.cacheKey)).size, label).toBe(1);
      expect((outcome as { body: { model: { servedTo: unknown } } }).body.model.servedTo, label).toEqual({ tenantId: bound.tenantId, principalId: bound.principalId });
      identities.add(result.calls[0]!.identity!);
      keys.add(result.calls[0]!.cacheKey!);
    }
    expect(identities.size).toBe(variants.length);
    expect(keys.size).toBe(variants.length);
    expect(cache.size).toBe(variants.length);
  }, SLOW);
});

describe("consumer context: standalone single-file CLI and MCP", () => {
  let dir = "";
  beforeAll(async () => {
    // The two published files copied alone: consumer-context.mjs is deliberately not beside them.
    dir = await mkdtemp(join(tmpdir(), "tavonel-standalone-"));
    for (const name of ["tavonel-cli.mjs", "tavonel-mcp.mjs"]) await copyFile(resolve(DEVELOPER, name), join(dir, name));
  });
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  it("runs off states without consumer-context.mjs and fails closed without it for true, a context or an invalid flag", async () => {
    const outcomes = async (setup: Setup) => [
      await viaCli(getWorld(), setup, KEYS.alphaReader, join(dir, "tavonel-cli.mjs")),
      await viaMcp(getWorld(), setup, KEYS.alphaReader, join(dir, "tavonel-mcp.mjs")),
    ];
    for (const setup of [{}, { required: "false" }, { required: " FALSE\t" }, { required: " \t", context: "  " }] as Setup[]) {
      const start = calls.length;
      expect(await outcomes(setup), JSON.stringify(setup)).toMatchObject(Array(2).fill({ ok: true, body: { code: "OK", model: { world: { revision: 7 } } } }));
      expect(calls.slice(start).map((call) => call.identity)).toEqual([null, null]);
    }
    for (const setup of [{ required: "true" }, { context: context() }, { required: "yes" }] as Setup[]) {
      const start = calls.length;
      expect(await outcomes(setup), JSON.stringify(setup)).toEqual(Array(2).fill({ ok: false, code: "CONSUMER_CONTEXT_MODULE_UNAVAILABLE" }));
      // Refused before the network: nothing reached the synthetic boundary.
      expect(calls.slice(start)).toEqual([]);
    }
  }, SLOW);
});

/* ------------------------------------------ wired route handlers over owned fixtures */

/*
  The seven wired routes, called as their exported handlers. What is real: the routes, the server
  helper, the operation guard (per-process mode, as vitest runs it), the answer builders, NextResponse.
  What is a fixture: who the bearer is, the World store, the read model, source admission and the
  retrieval pipeline -- all owned below and reset per test. Local evidence about the routes' wiring,
  not real auth, SQL, R2 or a deployed API.
*/
const ROUTE_KEY = "tvnl_live_cc_route_reader";
// Stands in for a browser session: the fixture authorizes it as developer-auth authorizes a session.
const SESSION_TOKEN = "cc-route-session";
const GAMMA = `collection-${"c".repeat(32)}`;
const UPDATED_AT = "2026-10-02T09:00:00.000Z";

type FixtureVersion = ConsumerSnapshot & { lifecycle: "active" | "superseded" };
/* A version row of some other workspace or collection, which the exact lookup must never return for ALPHA. */
type ForeignVersion = FixtureVersion & { workspaceKey: string; collectionId: string };
const fixture = {
  versions: [] as FixtureVersion[],
  elsewhere: [] as ForeignVersion[],
  // The code the exact version lookup fails with, as lib/world-store.ts names its read failures.
  lookupFailure: null as null | string,
  revision: 0,
  revoked: false,
  sourceDenied: false,
  admitted: true,
  // One-shot hooks: inside the payload read (read model, manifest status, retrieval), and inside
  // the first late authorization check, to land a promotion or a revocation mid-request.
  duringPayload: null as null | (() => void),
  duringRelease: null as null | (() => void),
};

function fire(hook: "duringPayload" | "duringRelease") {
  const run = fixture[hook];
  fixture[hook] = null;
  run?.();
}

function promoteFixture(pair: ConsumerSnapshot) {
  for (const version of fixture.versions) version.lifecycle = "superseded";
  fixture.versions.push({ ...pair, lifecycle: "active" });
  fixture.revision += 1;
}

const activeVersion = () => fixture.versions.find((version) => version.lifecycle === "active")!;

/* A fixture version as lib/world-store.ts parses a foundation_world_versions row. */
const versionRow = (version: FixtureVersion) => ({
  manifest_digest: version.manifestDigest, world_state_id: version.worldStateId, lifecycle_status: version.lifecycle,
  first_promoted_at: UPDATED_AT, last_activated_at: UPDATED_AT, activation_count: 1,
});

/* ALPHA promoted 60 more times after AT6, then AT7: AT6 lies well past the 50 most recent versions. */
function deepHistory() {
  fixture.versions = [{ ...AT6, lifecycle: "superseded" }];
  for (let index = 0; index < 60; index += 1) {
    fixture.versions.push({ worldStateId: `wst_alpha-gap-${index}.r1`, manifestDigest: `sha256:${index.toString(16).padStart(64, "0")}`, lifecycle: "superseded" });
  }
  fixture.versions.push({ ...AT7, lifecycle: "active" });
  fixture.revision = fixture.versions.length;
  // What listFoundationWorldVersions would return (limit 50, newest first): AT6 is not in it.
  fx.versions.mockImplementation(async () => ({ ok: true, versions: fixture.versions.slice(-50).reverse().map(versionRow) }));
}

function activeRow(): ActiveWorld {
  const active = activeVersion();
  return {
    workspaceKey: WORKSPACE, collectionId: ALPHA, manifestDigest: active.manifestDigest, revision: fixture.revision,
    updatedAt: UPDATED_AT, worldStateId: active.worldStateId, coreOutputSha256: digest("c"),
    candidateObjectKey: `immutable/${WORKSPACE}/${WORKSPACE}/collections/${ALPHA}/${active.manifestDigest.slice(7)}/candidate-world.json`,
  };
}

function fixtureModel(id: string, manifestDigest: string) {
  return {
    schemaVersion: "tavonel.world_read_model.v1",
    contract: { origin: "compiled_artifact", deterministicSample: false, realObjectsOnly: true, missingData: "not_yet" },
    world: {
      id, manifestDigest,
      status: manifestDigest === activeVersion().manifestDigest ? "active" : "candidate",
      revision: { state: "read", value: fixture.revision },
    },
    freshness: { ...EMPTY_WORLD_FRESHNESS, activeManifestDigest: activeVersion().manifestDigest },
    objects: [{ id: "claim-alpha-1", label: `object of ${manifestDigest.slice(7, 15)}` }],
    relations: [],
    evidence: [],
    history: fixture.versions.map((version) => ({
      version: version.worldStateId, manifestDigest: version.manifestDigest, status: version.lifecycle,
      activatedAt: { state: "read", value: UPDATED_AT }, activationCount: { state: "read", value: 1 },
    })),
    files: [],
    signature: { state: "not_yet", reason: "fixture" },
    review: { state: "not_yet" },
  };
}

function installRouteFixture() {
  vi.clearAllMocks();
  resetLocalWorkspaceOperationsForTest();
  fixture.versions = [{ ...AT6, lifecycle: "superseded" }, { ...AT7, lifecycle: "active" }];
  fixture.elsewhere = [];
  fixture.lookupFailure = null;
  fixture.revision = 7;
  fixture.revoked = false;
  fixture.sourceDenied = false;
  fixture.admitted = true;
  fixture.duringPayload = null;
  fixture.duringRelease = null;

  fx.authorize.mockImplementation(async (request: Request, scope: DeveloperScope) => {
    const token = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
    if (token === ROUTE_KEY) {
      const principal = apiKeyPrincipal();
      return principal.scopes.includes(scope) ? { ok: true, principal } : { ok: false, code: "API_SCOPE_REQUIRED", status: 403 };
    }
    if (token === SESSION_TOKEN) return { ok: true, principal: sessionPrincipal({ scopes: [scope] }) };
    return { ok: false, code: "API_KEY_INVALID", status: 401 };
  });
  fx.revalidate.mockImplementation(async (_request: Request, expected: FoundationPrincipal) => {
    fire("duringRelease");
    return fixture.revoked ? { ok: false, code: "API_KEY_REVOKED", status: 401 } : { ok: true, principal: expected };
  });
  fx.activeWorld.mockImplementation(async (workspaceKey: string, collectionId: string) =>
    workspaceKey === WORKSPACE && collectionId === ALPHA ? { ok: true, world: activeRow() } : { ok: false, code: "ACTIVE_WORLD_NOT_FOUND" });
  // The collection-world payload read: the version list is where its World can move mid-request.
  fx.versions.mockImplementation(async () => {
    fire("duringPayload");
    return {
      ok: true,
      versions: fixture.versions.map((version) => ({
        manifest_digest: version.manifestDigest, world_state_id: version.worldStateId, lifecycle_status: version.lifecycle,
        first_promoted_at: UPDATED_AT, last_activated_at: UPDATED_AT, activation_count: 1,
      })),
    };
  });
  // The exact lookup: all three keys must match, as lib/world-store.ts filters them; more than one
  // row is refused as it refuses it.
  fx.versionLookup.mockImplementation(async (workspaceKey: string, collectionId: string, worldStateId: string) => {
    if (fixture.lookupFailure !== null) return { ok: false, code: fixture.lookupFailure };
    const rows = [
      ...fixture.versions.map((version) => ({ ...version, workspaceKey: WORKSPACE, collectionId: ALPHA })),
      ...fixture.elsewhere,
    ].filter((row) => row.workspaceKey === workspaceKey && row.collectionId === collectionId && row.worldStateId === worldStateId);
    if (rows.length > 1) return { ok: false, code: "WORLD_VERSION_AMBIGUOUS" };
    return rows.length === 0 ? { ok: true, found: false } : { ok: true, found: true, version: versionRow(rows[0]!) };
  });
  fx.listWorlds.mockImplementation(async (_workspaceKey: string, options: { limit: number; cursor: string | null }) => ({
    ok: true,
    worlds: [
      { collectionId: ALPHA, manifestDigest: activeVersion().manifestDigest, revision: fixture.revision, updatedAt: UPDATED_AT },
      { collectionId: GAMMA, manifestDigest: digest("e"), revision: 2, updatedAt: UPDATED_AT },
    ].filter((world) => options.cursor === null || world.collectionId > options.cursor).slice(0, options.limit),
    nextCursor: null,
  }));
  fx.manifestStatus.mockImplementation(async (_workspaceKey: string, collectionId: string, manifestDigest: string) => {
    fire("duringPayload");
    const version = fixture.versions.find((item) => item.manifestDigest === manifestDigest);
    return {
      ok: true,
      status: {
        collectionId, manifestDigest, active: manifestDigest === activeVersion().manifestDigest,
        activeManifestDigest: activeVersion().manifestDigest, knownToWorkspace: Boolean(version),
        lifecycleStatus: version?.lifecycle ?? null, activatedAt: version ? UPDATED_AT : null,
      },
    };
  });
  fx.freshness.mockImplementation(async () => ({ ...EMPTY_WORLD_FRESHNESS, activeManifestDigest: activeVersion().manifestDigest }));
  fx.readModel.mockImplementation(async (_workspaceKey: string, collectionId: string, manifestDigest?: string) => {
    fire("duringPayload");
    const wanted = manifestDigest ?? activeVersion().manifestDigest;
    if (!fixture.versions.some((version) => version.manifestDigest === wanted)) return { ok: false, code: "NOT_FOUND", status: 404 };
    return { ok: true, model: fixtureModel(collectionId, wanted) };
  });
  fx.sourceIds.mockImplementation(async () => ({ ok: true, documentIds: ["doc-alpha-1"] }));
  fx.sourceAccess.mockImplementation(async () => (fixture.sourceDenied ? { ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" } : { ok: true }));
  fx.admits.mockImplementation(async () => fixture.admitted);
  fx.indexState.mockImplementation(async () => ({ status: "compiled", errorClass: null, runId: "retrieval-run-1", retrievalProfileId: "profile-1" }));
  fx.runtime.mockImplementation(async () => ({
    ok: true,
    runtime: {
      profile: { id: "profile-1" }, embedder: undefined, reranker: undefined, routerDecision: undefined,
      decision: { evaluatedAt: "2026-10-02T00:00:00.000Z", registrySource: "unconfigured", components: {}, fallbacks: ["lexical", "structural"] },
    },
  }));
  fx.pipeline.mockImplementation(async (input: { collectionId: string; worldStateId: string; question: string }) => {
    fire("duringPayload");
    return {
      ok: true,
      packet: {
        worldId: input.collectionId, worldVersion: input.worldStateId, retrievalProfile: "profile-1", question: input.question,
        items: [{
          unitId: "unit-1", text: "Payment is due in thirty days.", claimIds: ["claim-alpha-1"], entityIds: [],
          sourceVersionId: "doc-alpha-1/version-1", evidenceIds: ["evidence-1"], pageNumber1: 1, bbox1000: [80, 120, 920, 320],
          authority: "contractual", retrieval: { lexicalRank: 1, denseRank: null, structureRank: null, rerankerScore: null },
        }],
        heldConflicts: [],
        abstentionReasons: [],
      },
      diagnostics: {
        compileRunId: "retrieval-run-1", retrievalProfileId: "profile-1", lexicalCandidateCount: 1, denseCandidateCount: 0,
        structureCandidateCount: 0, fusedCandidateCount: 1, rerankerApplied: false, gateRejections: [], degradations: [],
      },
    };
  });
}

function routeRequest(path: string, headers: Record<string, string>, { token = ROUTE_KEY, body }: { token?: string; body?: unknown } = {}) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  return new Request(`https://tavonel.test${path}`, {
    method: text === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, ...(text === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(text === undefined ? {} : { body: text }),
  });
}

type RouteCase = {
  name: string;
  scope: DeveloperScope;
  call: (headers: Record<string, string>, options?: { token?: string; query?: string }) => Promise<Response>;
};
const params = <T,>(value: T) => ({ params: Promise.resolve(value) });
const ROUTES: RouteCase[] = [
  {
    name: "world", scope: "worlds:read",
    call: (headers, options) => worldRoute(routeRequest(`/api/v1/world/${ALPHA}${options?.query ?? ""}`, headers, options), params({ id: ALPHA })),
  },
  {
    name: "lens", scope: "worlds:read",
    call: (headers, options) => lensRoute(routeRequest(`/api/v1/world/${ALPHA}/objects`, headers, options), params({ id: ALPHA, lens: "objects" })),
  },
  {
    name: "manifest-status", scope: "worlds:read",
    call: (headers, options) => manifestStatusRoute(routeRequest(`/api/v1/world/${ALPHA}/manifest-status?digest=${ALPHA_V6}`, headers, options), params({ id: ALPHA })),
  },
  {
    name: "collections", scope: "collections:read",
    call: (headers, options) => collectionsRoute(routeRequest(`/api/v1/collections${options?.query ?? ""}`, headers, options)),
  },
  {
    name: "search", scope: "ask:read",
    call: (headers, options) => searchRoute(routeRequest(`/api/collections/${ALPHA}/search`, headers, { ...options, body: { query: SEARCH, limit: 5 } }), params({ id: ALPHA })),
  },
  {
    name: "ask", scope: "ask:read",
    call: (headers, options) => askRoute(routeRequest(`/api/collections/${ALPHA}/ask`, headers, { ...options, body: { question: QUESTION } }), params({ id: ALPHA })),
  },
  {
    // The /v1 wrapper's own export, which delegates to the generic /collections/{id}/world handler.
    name: "collection-world", scope: "worlds:read",
    call: (headers, options) => v1CollectionWorldRoute(routeRequest(`/api/v1/collections/${ALPHA}/world`, headers, options), params({ id: ALPHA })),
  },
];
const route = (name: string) => ROUTES.find((item) => item.name === name)!;

/* The request headers a conforming client sends for a context, plus any extra (marker, spoof). */
const headersFor = (value: Context, extra: Record<string, string> = {}) => Object.fromEntries(sent(value, extra).entries());
/* A key-bound context holding exactly the route's scope. */
const routeContext = (item: RouteCase, overrides: Partial<Context> = {}) => keyContext({ scope: [item.scope], ...overrides });

const PAYLOAD_READS = () => [fx.activeWorld, fx.versions, fx.versionLookup, fx.readModel, fx.manifestStatus, fx.listWorlds, fx.pipeline];
const payloadReadCount = () => PAYLOAD_READS().reduce((sum, mock) => sum + mock.mock.calls.length, 0);

async function expectRouteRefusal(response: Response, code: string, status: number, label = code) {
  expect(response.status, label).toBe(status);
  expect(await response.json(), label).toEqual({ code });
  expect(response.headers.get("cache-control"), label).toBe("no-store");
  for (const name of Object.values(CONTEXT_HEADERS)) expect(response.headers.get(name), `${label} ${name}`).toBeNull();
}

function expectAcknowledged(response: Response, value: Context, pair: ConsumerSnapshot, label = "") {
  expect(response.status, label).toBe(200);
  expect(response.headers.get("cache-control"), label).toBe("no-store");
  expect(response.headers.get(CONTEXT_HEADERS.identity), label).toBe(independentIdentity(value));
  expect(response.headers.get(CONTEXT_HEADERS.snapshotVersion), label).toBe(pair.worldStateId);
  expect(response.headers.get(CONTEXT_HEADERS.snapshotDigest), label).toBe(pair.manifestDigest);
  // Exactly the acknowledgement: no other context header is echoed.
  for (const name of [CONTEXT_HEADERS.schema, CONTEXT_HEADERS.tenant, CONTEXT_HEADERS.principal, CONTEXT_HEADERS.scope, CONTEXT_HEADERS.collection, CONTEXT_HEADERS.snapshotMode, CONTEXT_HEADERS.expiresAt]) {
    expect(response.headers.get(name), `${label} ${name}`).toBeNull();
  }
  expect(response.headers.get(CONTEXT_REQUIRED_MARKER.header), label).toBeNull();
}

describe("consumer context: wired route handlers over owned synthetic fixtures", () => {
  beforeEach(() => installRouteFixture());

  it("answers every route exactly as before with no context and no marker", async () => {
    // Collection-world reads the version list for its legacy payload; its own test below covers it.
    for (const item of ROUTES.filter((candidate) => !["search", "ask", "collection-world"].includes(candidate.name))) {
      const response = await item.call({});
      expect(response.status, item.name).toBe(200);
      expect(response.headers.get("cache-control"), item.name).toBe("no-store");
      for (const name of Object.values(CONTEXT_HEADERS)) expect(response.headers.get(name), `${item.name} ${name}`).toBeNull();
    }
    // The legacy World read is the active World's digest (the candidate fallback is covered below),
    // the list is the whole workspace, and none of these four reads gained a late check it did not have.
    expect(fx.readModel.mock.calls.map((call) => call[2])).toEqual([ALPHA_V7, ALPHA_V7]);
    expect(await (await route("world").call({})).json()).toEqual({ code: "OK", model: fixtureModel(ALPHA, ALPHA_V7) });
    expect((await (await route("collections").call({})).json()).collections.map((world: { collectionId: string }) => world.collectionId)).toEqual([ALPHA, GAMMA]);
    expect(fx.revalidate).not.toHaveBeenCalled();
    expect(fx.versions).not.toHaveBeenCalled();
    expect(fx.sourceIds).not.toHaveBeenCalled();

    // Search and Ask keep their own late checks, and nothing more.
    const search = await route("search").call({});
    expect([search.status, (await search.json()).code]).toEqual([200, "SEARCH_RESULTS"]);
    expect(fx.revalidate).toHaveBeenCalledTimes(1);
    const ask = await route("ask").call({});
    expect([ask.status, (await ask.json()).code]).toEqual([200, "GROUNDED_ANSWER"]);
    expect(fx.revalidate).toHaveBeenCalledTimes(3);
    for (const response of [search, ask]) {
      for (const name of Object.values(CONTEXT_HEADERS)) expect(response.headers.get(name)).toBeNull();
    }
  });

  /* The read model as loadWorldReadModel answers it: a named digest is that digest, no digest is the
     preferred candidate by list order, which need not be the active World. */
  const preferCandidate = (candidate: string) => fx.readModel.mockImplementation(
    async (_workspaceKey: string, collectionId: string, manifestDigest?: string) => ({ ok: true, model: fixtureModel(collectionId, manifestDigest ?? candidate) }),
  );

  it("answers an unnamed legacy World and lens read with the active World the list reports, never the preferred candidate", async () => {
    // As in the reported run: the pointer moved on activation, while list order still prefers a historical candidate.
    preferCandidate(ALPHA_V6);
    const listed = (await (await route("collections").call({})).json()).collections
      .find((world: { collectionId: string }) => world.collectionId === ALPHA);
    expect(listed.manifestDigest).toBe(ALPHA_V7);

    vi.clearAllMocks();
    const world = await route("world").call({});
    expect(world.status).toBe(200);
    expect((await world.json()).model.world.manifestDigest).toBe(listed.manifestDigest);
    const lens = await route("lens").call({});
    expect(lens.status).toBe(200);
    expect((await lens.json()).world.manifestDigest).toBe(listed.manifestDigest);
    // Each read looked up the pointer in the principal's workspace and loaded exactly its digest.
    expect(fx.activeWorld.mock.calls).toEqual([[WORKSPACE, ALPHA], [WORKSPACE, ALPHA]]);
    expect(fx.readModel.mock.calls).toEqual([[WORKSPACE, ALPHA, ALPHA_V7], [WORKSPACE, ALPHA, ALPHA_V7]]);

    // A named version is still exactly that version, and spends no pointer read.
    vi.clearAllMocks();
    const named = await route("world").call({}, { query: `?manifest=${ALPHA_V6}` });
    expect(named.status).toBe(200);
    expect((await named.json()).model.world.manifestDigest).toBe(ALPHA_V6);
    expect(fx.activeWorld).not.toHaveBeenCalled();
    expect(fx.readModel.mock.calls).toEqual([[WORKSPACE, ALPHA, ALPHA_V6]]);
  });

  it("falls back to the preferred candidate only when no World is active, and refuses when the pointer cannot be read", async () => {
    // Before any activation: candidate review still reads the preferred candidate.
    preferCandidate(ALPHA_V8);
    fx.activeWorld.mockImplementation(async () => ({ ok: false, code: "ACTIVE_WORLD_NOT_FOUND" }));
    const world = await route("world").call({});
    expect(world.status).toBe(200);
    expect((await world.json()).model.world.manifestDigest).toBe(ALPHA_V8);
    const lens = await route("lens").call({});
    expect(lens.status).toBe(200);
    expect((await lens.json()).world.manifestDigest).toBe(ALPHA_V8);
    expect(fx.activeWorld.mock.calls).toEqual([[WORKSPACE, ALPHA], [WORKSPACE, ALPHA]]);
    expect(fx.readModel.mock.calls).toEqual([[WORKSPACE, ALPHA, undefined], [WORKSPACE, ALPHA, undefined]]);

    // A pointer read that fails is an outage, not "nothing is active": no candidate is read.
    for (const code of ["WORLD_STORE_READ_FAILED", "ACTIVE_WORLD_BINDING_INVALID", "WORLD_STORE_NOT_CONFIGURED"]) {
      vi.clearAllMocks();
      fx.activeWorld.mockImplementation(async () => ({ ok: false, code }));
      await expectRouteRefusal(await route("world").call({}), code, 503, `world ${code}`);
      await expectRouteRefusal(await route("lens").call({}), code, 503, `lens ${code}`);
      expect(fx.readModel, code).not.toHaveBeenCalled();
    }
  });

  it("answers the v1 collection-world delegate exactly as before with no context, and builds a bound payload from the resolved row", async () => {
    const item = route("collection-world");
    const at = (id: string, headers: Record<string, string> = {}) => v1CollectionWorldRoute(routeRequest(`/api/v1/collections/${id}/world`, headers), params({ id }));
    const payload = () => ({ code: "OK", activeWorld: activeRow(), versions: fixture.versions.map(versionRow) });

    const legacy = await item.call({});
    expect(legacy.status).toBe(200);
    expect(legacy.headers.get("cache-control")).toBe("no-store");
    for (const name of Object.values(CONTEXT_HEADERS)) expect(legacy.headers.get(name), name).toBeNull();
    expect(await legacy.json()).toEqual(payload());
    // One active read and one list, as before: no resolution, late check or source admission.
    expect(fx.activeWorld.mock.calls).toEqual([[WORKSPACE, ALPHA]]);
    expect(fx.versions.mock.calls).toEqual([[WORKSPACE, ALPHA]]);
    expect([fx.versionLookup, fx.revalidate, fx.sourceIds, fx.sourceAccess, fx.admits].map((mock) => mock.mock.calls.length)).toEqual([0, 0, 0, 0, 0]);
    // Legacy keeps its own codes: an invalid id is refused before any read, a missing World is 404.
    await expectRouteRefusal(await at("collection-xyz"), "COLLECTION_ID_INVALID", 400);
    await expectRouteRefusal(await at(GAMMA), "ACTIVE_WORLD_NOT_FOUND", 404);

    vi.clearAllMocks();
    const bound = routeContext(item);
    const response = await item.call(headersFor(bound, MARKER));
    expectAcknowledged(response, bound, AT7, "bound");
    // The same payload shape, its activeWorld the row the context resolved against.
    expect(await response.json()).toEqual(payload());
    // The resolution read, the payload's list, then the release's re-read of the active World.
    expect(fx.activeWorld.mock.calls).toEqual([[WORKSPACE, ALPHA], [WORKSPACE, ALPHA]]);
    expect(fx.versions.mock.calls).toEqual([[WORKSPACE, ALPHA]]);
    expect(fx.revalidate.mock.calls.map((call) => [(call[1] as FoundationPrincipal).keyId, call[2]])).toEqual([[KEY_ID, "worlds:read"]]);
    expect(fx.sourceIds.mock.calls).toEqual([[WORKSPACE, ALPHA, activeRow()]]);
    expect(fx.versionLookup).not.toHaveBeenCalled();

    // A browser session is bound by its user id; a context for a collection with no active World has nothing to resolve.
    expectAcknowledged(await item.call(headersFor(sessionContext()), { token: SESSION_TOKEN }), sessionContext(), AT7, "session");
    await expectRouteRefusal(await at(GAMMA, headersFor(keyContext({ collectionId: GAMMA }))), "ACTIVE_WORLD_NOT_FOUND", 409, "bound missing World");

    // A version list that names another World active is a World that moved under the read: refused
    // before any late check, never acknowledged as either World. A list that fails is a failure.
    vi.clearAllMocks();
    fx.versions.mockImplementationOnce(async () => ({ ok: true, versions: [versionRow({ ...AT8, lifecycle: "active" }), versionRow({ ...AT7, lifecycle: "superseded" })] }));
    await expectRouteRefusal(await item.call(headersFor(bound)), "CONSUMER_CONTEXT_SNAPSHOT_MISMATCH", 409, "list moved");
    fx.versions.mockImplementationOnce(async () => ({ ok: false, code: "WORLD_STORE_READ_FAILED" }));
    await expectRouteRefusal(await item.call(headersFor(routeContext(item, { snapshot: pinnedTo(AT7) }))), "WORLD_STORE_READ_FAILED", 503, "list failed");
    expect(fx.revalidate).not.toHaveBeenCalled();
  });

  it("refuses a marker with no context, an invalid marker and a partial context on every route, before any World is read", async () => {
    for (const item of ROUTES) {
      await expectRouteRefusal(await item.call(MARKER), "CONSUMER_CONTEXT_REQUIRED", 400, `${item.name} marker`);
      await expectRouteRefusal(await item.call({ [CONTEXT_REQUIRED_MARKER.header]: "false" }), "CONSUMER_CONTEXT_INVALID", 400, `${item.name} marker=false`);
      const partial = headersFor(routeContext(item), MARKER);
      delete partial[CONTEXT_HEADERS.principal];
      await expectRouteRefusal(await item.call(partial), "CONSUMER_CONTEXT_INVALID", 400, `${item.name} partial`);
    }
    expect(payloadReadCount()).toBe(0);
    expect(fx.revalidate).not.toHaveBeenCalled();
  });

  it("binds an API key by keyId and a session by userId, acknowledging the served snapshot with no-store", async () => {
    for (const item of ROUTES) {
      const bound = routeContext(item);
      const response = await item.call(headersFor(bound, MARKER));
      expectAcknowledged(response, bound, AT7, item.name);
      expect(JSON.stringify(await response.json()), item.name).toContain(ALPHA_V7);
    }
    // Every bound release re-resolved the same key principal with the route's own scope.
    expect(new Set(fx.revalidate.mock.calls.map((call) => call[2]))).toEqual(new Set(["worlds:read", "collections:read", "ask:read"]));
    expect(fx.revalidate.mock.calls.every((call) => (call[1] as FoundationPrincipal).keyId === KEY_ID)).toBe(true);
    // The bound World read is the resolved digest, never the preferred candidate.
    expect(fx.readModel.mock.calls.map((call) => call[2])).toEqual([ALPHA_V7, ALPHA_V7]);
    expect(fx.sourceAccess).toHaveBeenCalledWith(WORKSPACE, ["doc-alpha-1"], USER_ID);
    expect(fx.sourceAccess.mock.calls.filter((call) => call.length === 3).every((call) => call[2] === USER_ID)).toBe(true);

    // A browser session is bound by its user id, and holds only the route's own scope.
    const session = sessionContext();
    expectAcknowledged(await route("world").call(headersFor(session), { token: SESSION_TOKEN }), session, AT7, "session");
    await expectRouteRefusal(await route("world").call(headersFor(keyContext()), { token: SESSION_TOKEN }), "CONSUMER_CONTEXT_PRINCIPAL_MISMATCH", 403, "key context on a session");
  });

  it("narrows a bound collection list to the bound collection and its active snapshot", async () => {
    const bound = routeContext(route("collections"));
    const response = await route("collections").call(headersFor(bound));
    expectAcknowledged(response, bound, AT7, "collections");
    expect(await response.json()).toEqual({
      code: "COLLECTIONS_LISTED",
      collections: [{ collectionId: ALPHA, manifestDigest: ALPHA_V7, revision: 7, updatedAt: UPDATED_AT }],
      page: { limit: 25, cursor: null, nextCursor: null },
    });
    // Built from the resolved active row, not filtered out of a workspace page.
    expect(fx.listWorlds).not.toHaveBeenCalled();
    const past = await route("collections").call(headersFor(bound), { query: `?limit=5&cursor=${ALPHA}` });
    expectAcknowledged(past, bound, AT7, "collections past cursor");
    expect((await past.json()).collections).toEqual([]);
    // A context naming a collection with no active World in this workspace has nothing to narrow to.
    await expectRouteRefusal(await route("collections").call(headersFor(routeContext(route("collections"), { collectionId: GAMMA }))), "ACTIVE_WORLD_NOT_FOUND", 409);
  });

  it("refuses spoofed identity, tenant, principal, scope, collection and expired contexts before any World is read", async () => {
    for (const item of [route("world"), route("search"), route("ask"), route("collection-world")]) {
      const cases: Array<[Record<string, string>, string, number, string?]> = [
        [headersFor(routeContext(item), { [CONTEXT_HEADERS.identity]: `ctx1-${"0".repeat(64)}` }), "CONSUMER_CONTEXT_IDENTITY_MISMATCH", 400],
        [headersFor(routeContext(item), { [CONTEXT_HEADERS.tenant]: "pilot-beta" }), "CONSUMER_CONTEXT_IDENTITY_MISMATCH", 400],
        [headersFor(routeContext(item, { tenantId: "pilot-beta" })), "CONSUMER_CONTEXT_TENANT_MISMATCH", 403],
        // An API key is its key, never the user who minted it.
        [headersFor(routeContext(item, { principalId: USER_ID })), "CONSUMER_CONTEXT_PRINCIPAL_MISMATCH", 403],
        [headersFor(routeContext(item, { scope: [item.scope === "ask:read" ? "worlds:read" : "ask:read"] })), "CONSUMER_CONTEXT_SCOPE_DENIED", 403],
        [headersFor(routeContext(item, { scope: ["collections:download", item.scope] })), "CONSUMER_CONTEXT_SCOPE_NOT_GRANTED", 403],
        [headersFor(routeContext(item, { collectionId: BETA })), "CONSUMER_CONTEXT_COLLECTION_MISMATCH", 403],
        [headersFor(routeContext(item, { expiresAt: "2020-01-01T00:00:00.000Z" })), "CONSUMER_CONTEXT_STALE", 401],
      ];
      for (const [headers, code, status] of cases) await expectRouteRefusal(await item.call(headers), code, status, `${item.name} ${code}`);
      await expectRouteRefusal(
        await item.call(headersFor(sessionContext({ scope: [item.scope], principalId: KEY_ID })), { token: SESSION_TOKEN }),
        "CONSUMER_CONTEXT_PRINCIPAL_MISMATCH", 403, `${item.name} session`,
      );
      await expectRouteRefusal(
        await item.call(headersFor(sessionContext({ scope: ["ask:read", "worlds:read"] })), { token: SESSION_TOKEN }),
        "CONSUMER_CONTEXT_SCOPE_NOT_GRANTED", 403, `${item.name} wider session`,
      );
    }
    expect(payloadReadCount()).toBe(0);
    expect(fx.revalidate).not.toHaveBeenCalled();
  });

  it("serves a pinned context only from its exact active pair and classifies every other pin", async () => {
    const world = route("world");
    const pinnedAt = (pair: ConsumerSnapshot) => routeContext(world, { snapshot: pinnedTo(pair) });
    expectAcknowledged(await world.call(headersFor(pinnedAt(AT7))), pinnedAt(AT7), AT7, "pinned v7");
    expect(fx.versions).not.toHaveBeenCalled();
    const classified: Array<[ConsumerSnapshot, string, number]> = [
      [AT6, "CONSUMER_CONTEXT_SNAPSHOT_SUPERSEDED", 409],
      [AT8, "CONSUMER_CONTEXT_SNAPSHOT_UNKNOWN", 404],
      [{ worldStateId: AT7.worldStateId, manifestDigest: ALPHA_V6 }, "CONSUMER_CONTEXT_SNAPSHOT_MISMATCH", 409],
      [{ worldStateId: AT6.worldStateId, manifestDigest: ALPHA_V7 }, "CONSUMER_CONTEXT_SNAPSHOT_MISMATCH", 409],
    ];
    for (const item of ROUTES) {
      for (const [pair, code, status] of classified) {
        await expectRouteRefusal(await item.call(headersFor(routeContext(item, { snapshot: pinnedTo(pair) }))), code, status, `${item.name} ${code}`);
      }
    }
    // Refused at resolution: no World was built for any of them.
    expect([fx.readModel, fx.manifestStatus, fx.pipeline].map((mock) => mock.mock.calls.length)).toEqual([1, 0, 0]);

    // A named version is the resolved one or a mismatch, never a second way to read another World.
    const latest = routeContext(world);
    await expectRouteRefusal(await world.call(headersFor(latest), { query: `?manifest=${ALPHA_V6}` }), "CONSUMER_CONTEXT_SNAPSHOT_MISMATCH", 409);
    expectAcknowledged(await world.call(headersFor(latest), { query: `?manifest=${ALPHA_V7}` }), latest, AT7, "named active version");

    // Latest follows a promotion; the old pin is now superseded on every route.
    promoteFixture(AT8);
    for (const item of ROUTES) {
      expectAcknowledged(await item.call(headersFor(routeContext(item))), routeContext(item), AT8, `${item.name} latest after promotion`);
      await expectRouteRefusal(await item.call(headersFor(routeContext(item, { snapshot: pinnedTo(AT7) }))), "CONSUMER_CONTEXT_SNAPSHOT_SUPERSEDED", 409, `${item.name} old pin`);
    }
  });

  it("classifies a pin promoted more than 50 versions ago as SUPERSEDED with one exact lookup, on every route", async () => {
    for (const item of ROUTES) {
      installRouteFixture();
      deepHistory();
      await expectRouteRefusal(
        await item.call(headersFor(routeContext(item, { snapshot: pinnedTo(AT6) }))),
        "CONSUMER_CONTEXT_SNAPSHOT_SUPERSEDED", 409, `${item.name} deep pin`,
      );
      // One lookup, keyed by the principal's workspace and the bound collection, for the pin's exact id.
      expect(fx.versionLookup.mock.calls, item.name).toEqual([[WORKSPACE, ALPHA, AT6.worldStateId]]);
      expect(fx.versions, item.name).not.toHaveBeenCalled();
      // Refused at resolution: nothing was built, revalidated or admitted for it.
      expect([fx.readModel, fx.manifestStatus, fx.pipeline, fx.revalidate, fx.sourceIds].map((mock) => mock.mock.calls.length), item.name)
        .toEqual([0, 0, 0, 0, 0]);
    }
    // The 50-row history the resolver used to read does not reach AT6 at all.
    const recent = await fx.versions();
    expect(recent.versions.some((row: { world_state_id: string }) => row.world_state_id === AT6.worldStateId)).toBe(false);
  });

  it("answers MISMATCH for the pin's world_state_id under another digest, and UNKNOWN for a pin no exact row names", async () => {
    deepHistory();
    const world = route("world");
    const sameIdOtherDigest = { worldStateId: AT6.worldStateId, manifestDigest: digest("9") };
    await expectRouteRefusal(await world.call(headersFor(routeContext(world, { snapshot: pinnedTo(sameIdOtherDigest) }))), "CONSUMER_CONTEXT_SNAPSHOT_MISMATCH", 409);
    expect(fx.versionLookup.mock.calls).toEqual([[WORKSPACE, ALPHA, AT6.worldStateId]]);

    // The same id and digest in another workspace or another collection is not this collection's version.
    const FOREIGN = { worldStateId: "wst_foreign-6.r1", manifestDigest: digest("f") };
    fixture.elsewhere = [
      { ...FOREIGN, lifecycle: "superseded", workspaceKey: "pilot-beta", collectionId: ALPHA },
      { ...FOREIGN, lifecycle: "superseded", workspaceKey: WORKSPACE, collectionId: BETA },
      { ...AT8, lifecycle: "active", workspaceKey: "pilot-beta", collectionId: ALPHA },
      { ...AT8, lifecycle: "superseded", workspaceKey: WORKSPACE, collectionId: GAMMA },
    ];
    for (const item of ROUTES) {
      for (const pair of [FOREIGN, AT8]) {
        fx.versionLookup.mockClear();
        await expectRouteRefusal(
          await item.call(headersFor(routeContext(item, { snapshot: pinnedTo(pair) }))),
          "CONSUMER_CONTEXT_SNAPSHOT_UNKNOWN", 404, `${item.name} ${pair.worldStateId}`,
        );
        expect(fx.versionLookup.mock.calls, `${item.name} ${pair.worldStateId}`).toEqual([[WORKSPACE, ALPHA, pair.worldStateId]]);
      }
    }
    expect(fx.versions).not.toHaveBeenCalled();
    // The rows exist; only their own workspace and collection reach them.
    await expect(fx.versionLookup("pilot-beta", ALPHA, FOREIGN.worldStateId)).resolves.toMatchObject({ ok: true, found: true });
    await expect(fx.versionLookup(WORKSPACE, BETA, FOREIGN.worldStateId)).resolves.toMatchObject({ ok: true, found: true });
  });

  it("refuses a lookup failure as a storage failure, never as UNKNOWN, and never touches an active pin", async () => {
    const world = route("world");
    for (const code of ["WORLD_STORE_READ_FAILED", "WORLD_STORE_NOT_CONFIGURED", "WORLD_VERSION_AMBIGUOUS", "WORLD_VERSION_BINDING_INVALID"]) {
      for (const item of ROUTES) {
        installRouteFixture();
        deepHistory();
        fixture.lookupFailure = code;
        // AT6 would be SUPERSEDED and AT8 UNKNOWN; with the lookup failing, neither is claimed.
        for (const pair of [AT6, AT8]) {
          await expectRouteRefusal(await item.call(headersFor(routeContext(item, { snapshot: pinnedTo(pair) }))), code, 503, `${item.name} ${code} ${pair.worldStateId}`);
        }
        expect(fx.versions, item.name).not.toHaveBeenCalled();
      }
      // The active pin and latest are resolved from the active World alone: no lookup to fail.
      fx.versionLookup.mockClear();
      expectAcknowledged(await world.call(headersFor(routeContext(world, { snapshot: pinnedTo(AT7) }))), routeContext(world, { snapshot: pinnedTo(AT7) }), AT7, `${code} active pin`);
      expectAcknowledged(await world.call(headersFor(routeContext(world))), routeContext(world), AT7, `${code} latest`);
      expect(fx.versionLookup, code).not.toHaveBeenCalled();
    }
  });

  it("still refuses on revoked source policy or authorization before releasing a bound response over a deep history", async () => {
    const lateFaults: Array<[string, () => void, string, number]> = [
      ["source access revoked", () => { fixture.sourceDenied = true; }, "CONNECTOR_SOURCE_ACCESS_DENIED", 403],
      ["derived data no longer admitted", () => { fixture.admitted = false; }, DERIVED_DATA_REFUSED, 403],
      ["revoked key", () => { fixture.revoked = true; }, "API_KEY_REVOKED", 401],
    ];
    for (const item of ROUTES) {
      for (const snapshot of [pinnedTo(AT7), { mode: "latest" }]) {
        for (const [label, fault, code, status] of lateFaults) {
          installRouteFixture();
          deepHistory();
          fixture.duringRelease = fault;
          await expectRouteRefusal(await item.call(headersFor(routeContext(item, { snapshot }), MARKER)), code, status, `${item.name} ${snapshot.mode} ${label}`);
          expect(fx.revalidate.mock.calls[0]?.[2], item.name).toBe(item.scope);
          expect(fx.versionLookup, item.name).not.toHaveBeenCalled();
        }
      }
    }
    // Source policy revoked before the request: a deep superseded pin is still refused at resolution,
    // and an active pin is refused at release -- neither is acknowledged.
    installRouteFixture();
    deepHistory();
    fixture.sourceDenied = true;
    const world = route("world");
    await expectRouteRefusal(await world.call(headersFor(routeContext(world, { snapshot: pinnedTo(AT6) }))), "CONSUMER_CONTEXT_SNAPSHOT_SUPERSEDED", 409, "revoked deep pin");
    await expectRouteRefusal(await world.call(headersFor(routeContext(world, { snapshot: pinnedTo(AT7) }))), "CONNECTOR_SOURCE_ACCESS_DENIED", 403, "revoked active pin");
  });

  it("refuses rather than acknowledges when the active World moves before the payload is built", async () => {
    for (const item of ROUTES) {
      for (const [snapshot, code] of [[{ mode: "latest" }, "CONSUMER_CONTEXT_SNAPSHOT_MISMATCH"], [pinnedTo(AT7), "CONSUMER_CONTEXT_SNAPSHOT_SUPERSEDED"]] as const) {
        installRouteFixture();
        const bound = routeContext(item, { snapshot });
        // The collection list is built from the resolution read itself, so its World can only move after it.
        fixture[item.name === "collections" ? "duringRelease" : "duringPayload"] = () => promoteFixture(AT8);
        await expectRouteRefusal(await item.call(headersFor(bound, MARKER)), code, 409, `${item.name} ${snapshot.mode} moved`);
      }
    }
    // Ask without a context keeps its own code for the same race.
    installRouteFixture();
    fixture.duringPayload = () => promoteFixture(AT8);
    await expectRouteRefusal(await route("ask").call({}), "ACTIVE_WORLD_CHANGED_RETRY", 409, "legacy ask moved");
  });

  it("refuses when the World moves after the payload, before the response is released", async () => {
    for (const item of ROUTES) {
      installRouteFixture();
      fixture.duringRelease = () => promoteFixture(AT8);
      await expectRouteRefusal(await item.call(headersFor(routeContext(item))), "CONSUMER_CONTEXT_SNAPSHOT_MISMATCH", 409, `${item.name} moved at release`);
    }
  });

  it("revalidates authorization and source admission before releasing a bound response", async () => {
    const lateFaults: Array<[string, () => void, string, number]> = [
      ["revoked key", () => { fixture.revoked = true; }, "API_KEY_REVOKED", 401],
      ["source access revoked", () => { fixture.sourceDenied = true; }, "CONNECTOR_SOURCE_ACCESS_DENIED", 403],
      ["derived data no longer admitted", () => { fixture.admitted = false; }, DERIVED_DATA_REFUSED, 403],
    ];
    for (const item of ROUTES) {
      for (const [label, fault, code, status] of lateFaults) {
        installRouteFixture();
        fixture.duringRelease = fault;
        const response = await item.call(headersFor(routeContext(item), MARKER));
        await expectRouteRefusal(response, code, status, `${item.name} ${label}`);
        expect(fx.revalidate.mock.calls[0]?.[2], item.name).toBe(item.scope);
      }
    }
  });

  it("re-resolves and revalidates an idempotent Ask replay, and never caches a refusal", async () => {
    const ask = route("ask");
    const bound = routeContext(ask);
    const keyed = (key: string) => ({ ...headersFor(bound), "idempotency-key": key });

    const first = await ask.call(keyed("cc-replay-0001"));
    expectAcknowledged(first, bound, AT7, "first");
    const replay = await ask.call(keyed("cc-replay-0001"));
    expectAcknowledged(replay, bound, AT7, "replay");
    expect(replay.headers.get("x-tavonel-idempotent-replay")).toBe("true");
    expect(await replay.json()).toEqual(await first.json());
    expect(fx.pipeline).toHaveBeenCalledTimes(1);
    // The replay was resolved and released again, not served from the cache alone.
    expect(fx.activeWorld.mock.calls.length).toBeGreaterThanOrEqual(6);

    // A legacy request on the same key is a different identity: it is not handed the bound answer.
    const legacy = await ask.call({ "idempotency-key": "cc-replay-0001" });
    expect(legacy.headers.get("x-tavonel-idempotent-replay")).toBeNull();
    expect(fx.pipeline).toHaveBeenCalledTimes(2);

    // A refusal leaves nothing behind for the key: the retry is answered afresh.
    fixture.duringPayload = () => promoteFixture(AT8);
    await expectRouteRefusal(await ask.call(keyed("cc-replay-0002")), "CONSUMER_CONTEXT_SNAPSHOT_MISMATCH", 409);
    const retried = await ask.call(keyed("cc-replay-0002"));
    expectAcknowledged(retried, bound, AT8, "retry after refusal");
    expect(retried.headers.get("x-tavonel-idempotent-replay")).toBeNull();
  });
});

/* -------------------------------------- CLI and MCP through the wired route handlers */

let routeServer!: Server;
let routeBaseUrl = "";

const ROUTE_DISPATCH: Array<[RegExp, "GET" | "POST", (request: Request, match: RegExpMatchArray) => Promise<Response>]> = [
  [/^\/api\/v1\/world\/(collection-[a-f0-9]{32})$/, "GET", (request, match) => worldRoute(request, params({ id: match[1]! }))],
  [/^\/api\/v1\/world\/(collection-[a-f0-9]{32})\/manifest-status$/, "GET", (request, match) => manifestStatusRoute(request, params({ id: match[1]! }))],
  [/^\/api\/v1\/world\/(collection-[a-f0-9]{32})\/([a-z]+)$/, "GET", (request, match) => lensRoute(request, params({ id: match[1]!, lens: match[2]! }))],
  [/^\/api\/v1\/collections$/, "GET", (request) => collectionsRoute(request)],
  // The /v1 paths the CLI and MCP call, which delegate to the approved /collections handlers.
  [/^\/api\/v1\/collections\/(collection-[a-f0-9]{32})\/search$/, "POST", (request, match) => v1SearchRoute(request, params({ id: match[1]! }))],
  [/^\/api\/v1\/collections\/(collection-[a-f0-9]{32})\/ask$/, "POST", (request, match) => v1AskRoute(request, params({ id: match[1]! }))],
  // The CLI's `world` command, through the /v1 wrapper that delegates to the generic handler.
  [/^\/api\/v1\/collections\/(collection-[a-f0-9]{32})\/world$/, "GET", (request, match) => v1CollectionWorldRoute(request, params({ id: match[1]! }))],
];

async function dispatchToRoute(incoming: IncomingMessage, response: ServerResponse, raw: string) {
  const url = new URL(incoming.url ?? "/", "http://route.test");
  const method = incoming.method ?? "GET";
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  const record: Call = {
    method, pathname: url.pathname, principalId: null,
    identity: headers.get(CONTEXT_HEADERS.identity), scopeHeader: headers.get(CONTEXT_HEADERS.scope),
    snapshotMode: headers.get(CONTEXT_HEADERS.snapshotMode), marker: headers.get(CONTEXT_REQUIRED_MARKER.header),
    outcome: "", cache: null, cacheKey: null, acknowledged: null,
  };
  calls.push(record);
  const found = ROUTE_DISPATCH.map(([pattern, verb, handler]) => ({ match: url.pathname.match(pattern), verb, handler }))
    .find((candidate) => candidate.match && candidate.verb === method);
  const answered = found
    ? await found.handler(new Request(url, { method, headers, ...(method === "POST" ? { body: raw } : {}) }), found.match!)
    : Response.json({ code: "ROUTE_NOT_FOUND" }, { status: 404 });
  const text = await answered.text();
  record.outcome = answered.status === 200 ? "OK" : String((JSON.parse(text) as { code?: string }).code);
  record.acknowledged = answered.headers.get(CONTEXT_HEADERS.identity);
  response.statusCode = answered.status;
  answered.headers.forEach((value, name) => response.setHeader(name, value));
  // What next.config.mjs adds to every /api/v1 response.
  response.setHeader("x-tavonel-api-version", "1");
  response.setHeader("connection", "close");
  response.end(text);
}

const listWorlds = (): Op => ({ tool: "list_worlds", input: {}, cli: ["list_worlds"], method: "GET", path: "/api/v1/collections" });
const getObjects = (): Op => ({ tool: "get_object", input: { collectionId: ALPHA }, cli: ["object", ALPHA], method: "GET", path: `/api/v1/world/${ALPHA}/objects` });
/* No MCP tool reads this path (get_world reads /v1/world/{id}); `tool` names the CLI alias only. */
const getWorldHistory = (collectionId = ALPHA): Op => ({
  tool: "collection-world", input: { collectionId }, cli: ["world", collectionId], method: "GET", path: `/api/v1/collections/${collectionId}/world`,
});

/*
  The MCP leg for a path no MCP tool requests: the published MCP HTTP client (createClient, the
  function every MCP tool call goes through), given the binding loadConsumerContext would build from
  the same environment -- consumer-context.mjs's createConsumerContextBinding. It runs in this
  process but reaches the handlers only over HTTP, through the same bridge as the subprocesses.
*/
// tavonel-mcp.mjs is plain JavaScript; this is the shape createClient publishes.
const mcpClient = createMcpClient as unknown as (options: { baseUrl: string; apiKey: string; context: unknown }) =>
  (request: { method: string; path: string; body?: unknown }) => Promise<unknown>;

async function viaMcpClient(op: Op, setup: Setup, key: string): Promise<Outcome> {
  try {
    const call = mcpClient({ baseUrl: target, apiKey: key, context: createConsumerContextBinding({ env: { ...contextEnv(setup), NODE_ENV: "test" } }) });
    return { ok: true, body: await call({ method: op.method, path: op.path, ...(op.body ? { body: op.body } : {}) }) };
  } catch (error) {
    return { ok: false, code: codeOf(error instanceof Error ? error.message : String(error)) };
  }
}

/* Direct, the CLI subprocess and the MCP client, shaped as surfaces() so same() and expectRefused() apply. */
async function historySurfaces(op: Op, setup: Setup, key: string = ROUTE_KEY): Promise<Surfaces> {
  const start = calls.length;
  const direct = await viaDirect(op, setup, key);
  const cli = await viaCli(op, setup, key);
  const mcp = await viaMcpClient(op, setup, key);
  return { direct, cli, mcp, calls: calls.slice(start) };
}

describe("consumer context: direct, CLI and MCP through the wired route handlers", () => {
  beforeAll(async () => {
    routeServer = createHttpServer((incoming, response) => {
      let raw = "";
      incoming.setEncoding("utf8");
      incoming.on("data", (chunk) => { raw += chunk; });
      incoming.on("end", () => {
        dispatchToRoute(incoming, response, raw).catch((error: unknown) => {
          response.statusCode = 500;
          response.end(JSON.stringify({ code: "ROUTE_FIXTURE_FAILED", detail: String(error) }));
        });
      });
    });
    await new Promise<void>((done) => routeServer.listen(0, "127.0.0.1", done));
    const address = routeServer.address();
    if (!address || typeof address === "string") throw new Error("wired-route fixture did not bind");
    routeBaseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    routeServer.closeAllConnections();
    await new Promise<void>((done, reject) => routeServer.close((error) => (error ? reject(error) : done())));
  });
  beforeEach(() => {
    installRouteFixture();
    target = routeBaseUrl;
  });

  it("propagates one context to the handlers and accepts their acknowledgement on all three surfaces", async () => {
    const bound = keyContext({ scope: ["ask:read", "collections:read", "worlds:read"] });
    const identity = independentIdentity(bound);
    for (const op of [getWorld(), getObjects(), listWorlds(), searchWorld(), askWorld()]) {
      const result = await surfaces(op, { context: bound, required: "true" }, ROUTE_KEY);
      const outcome = same(result);
      expect(outcome.ok, op.tool).toBe(true);
      expect(JSON.stringify(outcome), op.tool).toContain(ALPHA_V7);
      expect(result.calls.map((call) => [call.identity, call.marker, call.acknowledged, call.outcome]), op.tool)
        .toEqual(Array(3).fill([identity, CONTEXT_REQUIRED_MARKER.value, identity, "OK"]));
    }
    expect(fx.revalidate.mock.calls.every((call) => (call[1] as FoundationPrincipal).keyId === KEY_ID)).toBe(true);
  }, SLOW);

  it("keeps legacy answers unacknowledged and refuses a superseded pin, a moved World or a revoked key at the handler", async () => {
    const result = await surfaces(getWorld(), {}, ROUTE_KEY);
    expect(same(result)).toMatchObject({ ok: true, body: { code: "OK", model: { world: { manifestDigest: ALPHA_V7 } } } });
    expect(result.calls.map((call) => [call.identity, call.marker, call.acknowledged])).toEqual(Array(3).fill([null, null, null]));

    const bound = keyContext({ scope: ["ask:read", "worlds:read"] });
    expectRefused(await surfaces(getWorld(), { context: keyContext({ snapshot: pinnedTo(AT6) }) }, ROUTE_KEY), "CONSUMER_CONTEXT_SNAPSHOT_SUPERSEDED", true);

    // Each surface's request lands a promotion inside retrieval: all three are refused, none acknowledged.
    const promotions = [AT8, { worldStateId: "wst_alpha-9.r1", manifestDigest: digest("9") }, { worldStateId: "wst_alpha-10.r1", manifestDigest: digest("a") }];
    const moving = () => { fixture.duringPayload = () => promoteFixture(promotions.shift()!); };
    const start = calls.length;
    moving();
    const direct = await viaDirect(searchWorld(), { context: bound, required: "true" }, ROUTE_KEY);
    moving();
    const cli = await viaCli(searchWorld(), { context: bound, required: "true" }, ROUTE_KEY);
    moving();
    const mcp = await viaMcp(searchWorld(), { context: bound, required: "true" }, ROUTE_KEY);
    expectRefused({ direct, cli, mcp, calls: calls.slice(start) }, "CONSUMER_CONTEXT_SNAPSHOT_MISMATCH", true);
    expect(calls.slice(start).map((call) => call.acknowledged)).toEqual([null, null, null]);

    fixture.revoked = true;
    expectRefused(await surfaces(getWorld(), { context: bound, required: "true" }, ROUTE_KEY), "API_KEY_REVOKED", true);
  }, SLOW);

  it("carries a context through the v1 collection-world delegate on direct, CLI and the MCP client, and keeps legacy unchanged", async () => {
    const op = getWorldHistory();
    // The stdio MCP server publishes no tool for this path, so its leg is the MCP client itself.
    const tools = MCP_TOOLS as unknown as Array<{ name: string; request: (input: Record<string, unknown>) => { path: string } }>;
    expect(tools.map((tool) => tool.name)).not.toContain(op.tool);
    expect(tools.map((tool) => tool.request({ collectionId: ALPHA }).path)).not.toContain(op.path);

    // Legacy: the same payload on every surface, nothing bound, nothing acknowledged, no late check.
    let result = await historySurfaces(op, {});
    expect(same(result)).toEqual({ ok: true, body: { code: "OK", activeWorld: activeRow(), versions: fixture.versions.map(versionRow) } });
    expect(result.calls.map((call) => [call.identity, call.marker, call.acknowledged, call.outcome])).toEqual(Array(3).fill([null, null, null, "OK"]));
    expect(fx.revalidate).not.toHaveBeenCalled();
    expect(fx.sourceIds).not.toHaveBeenCalled();

    // Bound latest, required: one identity sent and acknowledged on every surface, revalidated as the key.
    const bound = keyContext();
    const identity = independentIdentity(bound);
    result = await historySurfaces(op, { context: bound, required: "true" });
    expect(same(result)).toMatchObject({ ok: true, body: { code: "OK", activeWorld: { worldStateId: AT7.worldStateId, manifestDigest: ALPHA_V7 } } });
    expect(result.calls.map((call) => [call.identity, call.marker, call.acknowledged, call.outcome])).toEqual(Array(3).fill([identity, CONTEXT_REQUIRED_MARKER.value, identity, "OK"]));
    expect(fx.revalidate.mock.calls.map((call) => call[2])).toEqual(Array(3).fill("worlds:read"));
    expect(fx.revalidate.mock.calls.every((call) => (call[1] as FoundationPrincipal).keyId === KEY_ID)).toBe(true);

    // Required with no context is refused before the network; a marker alone is refused at the handler.
    expectRefused(await historySurfaces(op, { required: "true" }), "CONSUMER_CONTEXT_REQUIRED", false);
    const markerOnly = await fetch(`${routeBaseUrl}${op.path}`, { headers: { authorization: `Bearer ${ROUTE_KEY}`, ...MARKER } });
    expect([markerOnly.status, await markerOnly.json(), markerOnly.headers.get(CONTEXT_HEADERS.identity)]).toEqual([400, { code: "CONSUMER_CONTEXT_REQUIRED" }, null]);
  }, SLOW);

  it("resolves pinned and latest and refuses old, superseded, cross-principal and cross-tenant contexts at the v1 collection-world delegate", async () => {
    const op = getWorldHistory();
    const pinnedV7 = keyContext({ snapshot: pinnedTo(AT7) });
    expect(same(await historySurfaces(op, { context: pinnedV7, required: "true" }))).toMatchObject({ ok: true, body: { activeWorld: { worldStateId: AT7.worldStateId, manifestDigest: ALPHA_V7 } } });
    expectRefused(await historySurfaces(op, { context: keyContext({ snapshot: pinnedTo(AT6) }) }), "CONSUMER_CONTEXT_SNAPSHOT_SUPERSEDED", true);
    expectRefused(await historySurfaces(op, { context: keyContext({ snapshot: pinnedTo(AT8) }) }), "CONSUMER_CONTEXT_SNAPSHOT_UNKNOWN", true);
    expectRefused(
      await historySurfaces(op, { context: keyContext({ snapshot: pinnedTo({ worldStateId: AT7.worldStateId, manifestDigest: ALPHA_V6 }) }) }),
      "CONSUMER_CONTEXT_SNAPSHOT_MISMATCH", true,
    );

    // Latest follows a promotion; the pin it left behind is superseded.
    promoteFixture(AT8);
    expect(same(await historySurfaces(op, { context: keyContext(), required: "true" }))).toMatchObject({ ok: true, body: { activeWorld: { worldStateId: AT8.worldStateId, manifestDigest: ALPHA_V8 } } });
    expectRefused(await historySurfaces(op, { context: pinnedV7, required: "true" }), "CONSUMER_CONTEXT_SNAPSHOT_SUPERSEDED", true);

    // The context is the key's, in the key's workspace: whatever the client claims, another principal
    // or tenant is refused at the handler, and another collection never leaves the client.
    expectRefused(await historySurfaces(op, { context: keyContext({ principalId: USER_ID }) }), "CONSUMER_CONTEXT_PRINCIPAL_MISMATCH", true);
    expectRefused(await historySurfaces(op, { context: keyContext({ tenantId: "pilot-beta" }) }), "CONSUMER_CONTEXT_TENANT_MISMATCH", true);
    expectRefused(await historySurfaces(op, { context: keyContext({ collectionId: BETA }) }), "CONSUMER_CONTEXT_COLLECTION_MISMATCH", false);
  }, SLOW);

  it("refuses a moved World, revoked source policy and a revoked key at the v1 collection-world delegate, never acknowledging them", async () => {
    const op = getWorldHistory();
    const bound = keyContext();
    // Each surface's request lands a promotion inside the payload's version read: all three refused.
    const promotions = [AT8, { worldStateId: "wst_alpha-9.r1", manifestDigest: digest("9") }, { worldStateId: "wst_alpha-10.r1", manifestDigest: digest("a") }];
    const moving = () => { fixture.duringPayload = () => promoteFixture(promotions.shift()!); };
    let start = calls.length;
    moving();
    const direct = await viaDirect(op, { context: bound, required: "true" }, ROUTE_KEY);
    moving();
    const cli = await viaCli(op, { context: bound, required: "true" }, ROUTE_KEY);
    moving();
    const mcp = await viaMcpClient(op, { context: bound, required: "true" }, ROUTE_KEY);
    expectRefused({ direct, cli, mcp, calls: calls.slice(start) }, "CONSUMER_CONTEXT_SNAPSHOT_MISMATCH", true);
    expect(calls.slice(start).map((call) => call.acknowledged)).toEqual([null, null, null]);

    // A pinned World that moves after the payload, before release, is refused as superseded.
    start = calls.length;
    const late: Outcome[] = [];
    for (const via of [viaDirect, viaCli, viaMcpClient]) {
      installRouteFixture();
      fixture.duringRelease = () => promoteFixture(AT8);
      late.push(await via(op, { context: keyContext({ snapshot: pinnedTo(AT7) }), required: "true" }, ROUTE_KEY));
    }
    expectRefused({ direct: late[0]!, cli: late[1]!, mcp: late[2]!, calls: calls.slice(start) }, "CONSUMER_CONTEXT_SNAPSHOT_SUPERSEDED", true);

    const lateFaults: Array<[string, () => void, string]> = [
      ["source access revoked", () => { fixture.sourceDenied = true; }, "CONNECTOR_SOURCE_ACCESS_DENIED"],
      ["derived data no longer admitted", () => { fixture.admitted = false; }, DERIVED_DATA_REFUSED],
      ["revoked key", () => { fixture.revoked = true; }, "API_KEY_REVOKED"],
    ];
    for (const [label, fault, code] of lateFaults) {
      installRouteFixture();
      fault();
      const result = await historySurfaces(op, { context: bound, required: "true" });
      expectRefused(result, code, true);
      expect(result.calls.map((call) => call.acknowledged), label).toEqual([null, null, null]);
      expect(fx.revalidate.mock.calls.map((call) => call[2]), label).toEqual(Array(3).fill("worlds:read"));
    }

    // Legacy is answered as before: it never carried these late checks, and binding added none to it.
    installRouteFixture();
    fixture.sourceDenied = true;
    expect(same(await historySurfaces(op, {}))).toMatchObject({ ok: true, body: { code: "OK", activeWorld: { manifestDigest: ALPHA_V7 } } });
    expect(fx.revalidate).not.toHaveBeenCalled();
  }, SLOW);
});
