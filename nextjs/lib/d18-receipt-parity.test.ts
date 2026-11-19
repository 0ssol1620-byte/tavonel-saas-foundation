import { execFile, spawnSync } from "node:child_process";
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
  WO-D18-3 (U13, M5-03): one signed answer receipt, four surfaces. The same signed Ask body goes
  out through REST JSON, `tavonel-cli.mjs`, the stdio bridge and remote `POST /api/mcp`; every
  surface must hand back an identical body, and each receipt must verify offline with the
  published verifier. One changed answer byte must fail it. The CLI also keeps its key to the
  environment: no flag, no file, no echo.

  Not proved: the production signer (TAVONEL_ASK_RECEIPT_SIGNED is unset there) and parity on a
  real host. The signer here is a throwaway test key.
*/

const ORIGIN = "https://tavonel.test";
const WORKSPACE = "pilot-parity";
const COLLECTION = `collection-${"a".repeat(32)}`;
const DIGEST = `sha256:${"d".repeat(64)}`;
const QUESTION = "What is the notice period?";
const API_KEY = "tvnl_live_d18_parity_principal";
const READ_SCOPES = ["ask:read", "collections:download", "collections:read", "documents:read", "worlds:read"];

const state = vi.hoisted(() => ({ body: null as unknown, authenticateKey: vi.fn() }));
vi.mock("@/lib/developer-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-store")>()),
  authenticateDeveloperApiKey: state.authenticateKey,
}));
vi.mock("@/lib/operations-alert-triggers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./operations-alert-triggers")>()),
  recordMcpToolCall: vi.fn(async () => null),
}));
vi.mock("@/lib/operations-e2e-timing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./operations-e2e-timing")>()),
  recordFirstMcpAnswerTiming: vi.fn(async () => "not_recorded"),
}));
// The remote endpoint dispatches to this route module in-process: same body as the HTTP fixture.
vi.mock("../app/api/v1/collections/[id]/ask/route", () => ({
  POST: async () => NextResponse.json(state.body),
}));

import { POST as mcp } from "../app/api/mcp/route";
import { createClient, createServer } from "../public/developer/tavonel-mcp.mjs";
import { applyAnswerReceipt } from "./answer-receipt-signing";

const run = promisify(execFile);
const cliPath = resolve(import.meta.dirname, "../public/developer/tavonel-cli.mjs");
const verifier = resolve(import.meta.dirname, "../public/developer/tavonel-verify-answer.mjs");
const scratch = mkdtempSync(join(tmpdir(), "tavonel-d18-parity-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const pair = generateKeyPairSync("ed25519");
const spki = createPublicKey(pair.privateKey).export({ format: "der", type: "spki" });
const trust = {
  schemaVersion: "tavonel.export_trust.v2", minimumSignatureVersion: 2, activeKeyId: "parity-2026",
  keys: [{
    keyId: "parity-2026", keyVersion: 1, algorithm: "Ed25519", status: "active",
    notBefore: "2026-01-01T00:00:00.000Z", expiresAt: "2030-01-01T00:00:00.000Z",
    publicKeySpkiDerBase64: spki.toString("base64"),
    publicKeySpkiSha256: `sha256:${createHash("sha256").update(spki).digest("hex")}`,
  }],
};
const signerEnv = {
  TAVONEL_ASK_RECEIPT_SIGNED: "on",
  TAVONEL_REMOTE_MCP_COHORT: WORKSPACE,
  TAVONEL_EXPORT_SIGNING_KEY_ID: "parity-2026",
  TAVONEL_EXPORT_SIGNING_PRIVATE_KEY_PKCS8_DER_B64: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  TAVONEL_EXPORT_SIGNING_TRUST_STORE_JSON: JSON.stringify(trust),
};

// outputSha256 is over the canonical form the verifier recomputes (grounded-ask.ts `canonicalize`).
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
}
const unsigned = {
  status: "grounded", answer: "The notice period is ninety days.", reason: null,
  citations: [{ evidenceId: "evidence-notice", pageNumber1: 2 }],
};
const answer = {
  code: "GROUNDED_ANSWER", retrievalPath: "compiled-retrieval-v1", answerMode: "evidence_excerpts", ...unsigned,
  activeWorld: { collectionId: COLLECTION, manifestDigest: DIGEST, worldStateId: "world-state-1", revision: 3 },
  receipt: {
    collectionId: COLLECTION, manifestDigest: DIGEST,
    outputSha256: `sha256:${createHash("sha256").update(canonicalize(unsigned)).digest("hex")}`,
  },
};
const signed = applyAnswerReceipt({ workspaceKey: WORKSPACE, collectionId: COLLECTION, question: QUESTION, body: answer, env: signerEnv });
if (!signed.ok) throw new Error(`test signer refused: ${signed.code}`);
const signedBody = signed.body as { signedReceipt: unknown };

let seq = 0;
function file(name: string, value: unknown) {
  const path = join(scratch, `${seq++}-${name}`);
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
  return path;
}
function verify(body: unknown) {
  const r = spawnSync(process.execPath, [verifier, "--receipt", file("answer.json", body), "--trust-store", file("trust.json", trust),
    "--question-file", file("q.txt", QUESTION)], { encoding: "utf8", timeout: 10_000 });
  return { status: r.status, stderr: r.stderr };
}

let httpServer!: Server;
let baseUrl = "";
const askPath = `/api/v1/collections/${COLLECTION}/ask`;
beforeAll(async () => {
  httpServer = createHttpServer((request, response) => {
    const unauthorized = request.headers.authorization !== `Bearer ${API_KEY}`;
    request.resume();
    request.on("end", () => {
      response.statusCode = unauthorized ? 401 : 200;
      response.setHeader("content-type", "application/json");
      response.setHeader("x-tavonel-api-version", "1");
      response.end(JSON.stringify(unauthorized ? { code: "API_KEY_INVALID" } : signedBody));
    });
  });
  await new Promise<void>((done) => httpServer.listen(0, "127.0.0.1", done));
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  httpServer.closeAllConnections();
  await new Promise<void>((done, reject) => httpServer.close((error) => error ? reject(error) : done()));
});

beforeEach(() => {
  state.body = signedBody;
  state.authenticateKey.mockResolvedValue({
    ok: true, principal: { kind: "api-key", keyId: "key-1", workspaceKey: WORKSPACE, userId: "user-1", scopes: READ_SCOPES, authorizationRevision: 1 },
  });
  vi.stubEnv("TAVONEL_REMOTE_MCP_ENABLED", "true");
  vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", WORKSPACE);
  vi.stubEnv("TAVONEL_REMOTE_MCP_SIGNING_SECRET", "remote-mcp-unit-test-sealing-secret-value");
});

const callArgs = { collectionId: COLLECTION, question: QUESTION };
async function viaRest() {
  return fetch(`${baseUrl}${askPath}`, { method: "POST", headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ question: QUESTION }) }).then((r) => r.json());
}
async function viaCli() {
  const out = await run(process.execPath, [cliPath, "ask_world", COLLECTION, QUESTION], {
    env: { ...process.env, TAVONEL_BASE_URL: baseUrl, TAVONEL_API_KEY: API_KEY }, timeout: 10_000,
  });
  return JSON.parse(out.stdout);
}
async function viaStdio() {
  const server = createServer({ call: createClient({ baseUrl, apiKey: API_KEY }) }) as (m: unknown) => Promise<{ result: { content: Array<{ text: string }>; isError: boolean } }>;
  const reply = await server({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ask_world", arguments: callArgs } });
  expect(reply.result.isError).toBe(false);
  return JSON.parse(reply.result.content[0]!.text);
}
async function viaRemote() {
  const response = await mcp(new Request(`${ORIGIN}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer tvnl_mcp_parity" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ask_world", arguments: callArgs } }),
  }));
  expect(response.status).toBe(200);
  const { result } = await response.json() as { result: { content: Array<{ text: string }>; isError: boolean } };
  expect(result.isError).toBe(false);
  return JSON.parse(result.content[0]!.text);
}

describe("D18 signed answer receipt parity", () => {
  it("sends one signed receipt through REST, CLI, stdio MCP and remote MCP, identical and verifiable offline", async () => {
    const bodies = { rest: await viaRest(), cli: await viaCli(), stdio: await viaStdio(), remote: await viaRemote() };
    for (const [surface, body] of Object.entries(bodies)) {
      expect(body, surface).toEqual(signedBody);
      expect(body.signedReceipt, surface).toEqual(signedBody.signedReceipt);
      const result = verify(body);
      expect(result.status, `${surface}: ${result.stderr}`).toBe(0);
    }
  });

  it("fails verification when one byte of the answer changes on any surface", async () => {
    for (const body of [await viaRest(), await viaCli(), await viaStdio(), await viaRemote()]) {
      const result = verify({ ...body, answer: body.answer.replace("ninety", "nineti2") });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("answer text or citations were changed after signing");
    }
  });
});

describe("tavonel-cli credential handling", () => {
  const source = readFileSync(cliPath, "utf8");

  it("reads the key only from TAVONEL_API_KEY and offers no key flag", () => {
    expect(source).toContain("process.env.TAVONEL_API_KEY");
    expect(source).not.toMatch(/--api-?key|--token|--key\b/i);
    expect(source).not.toMatch(/\bwriteFile(Sync)?\([^)]*apiKey|appendFile|localStorage|keychain/);
  });

  it("help and a 401 ask_world write no file and never echo the key", async () => {
    const home = mkdtempSync(join(tmpdir(), "tavonel-d18-home-"));
    const cwd = mkdtempSync(join(tmpdir(), "tavonel-d18-cwd-"));
    try {
      const env = { ...process.env, HOME: home, USERPROFILE: home, TAVONEL_BASE_URL: baseUrl, TAVONEL_API_KEY: "tvnl_live_wrong_secret_value" };
      const help = await run(process.execPath, [cliPath, "help"], { env, cwd, timeout: 10_000 });
      const refused = await run(process.execPath, [cliPath, "ask_world", COLLECTION, QUESTION], { env, cwd, timeout: 10_000 }).then(
        () => { throw new Error("a 401 must fail"); }, (error: { code?: number; stdout: string; stderr: string }) => error);
      expect(refused.code).toBe(1);
      expect(refused.stderr).toContain("API_KEY_INVALID");
      for (const text of [help.stdout, help.stderr, refused.stdout, refused.stderr]) expect(text).not.toContain("tvnl_live_wrong_secret_value");
      for (const dir of [home, cwd]) {
        expect(readdirSync(dir, { recursive: true })).toEqual([]);
        expect(existsSync(join(dir, ".tavonel"))).toBe(false);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
