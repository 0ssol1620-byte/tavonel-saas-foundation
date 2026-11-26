import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  WO-RTR-2. The router shadow hook in the real `runCollectionCompile`: only R2, Core and the stores
  around it are stubbed. What it proves: off writes nothing and the compile is the compile; on, the
  trace is sent beside the compile without changing its answer or Core's request, Core is dispatched
  while the write is still in flight, a failing write fails nothing, a redelivered job sends the same
  keys, and no public surface imports the trace.
*/

const listed = vi.fn();
const fetched = vi.fn();
const put = vi.fn();
const dispatched = vi.fn();
vi.mock("./r2-synthetic-canary", () => ({
  readR2SignerEnv: () => ({ accountId: "acct", bucket: "tavonel-foundation", accessKeyId: "key", secretAccessKey: "secret" }),
}));
vi.mock("./r2-objects", () => ({
  MAX_DERIVED_JSON_BYTES: 24 * 1024 * 1024,
  listImmutableWorkspaceObjects: (...args: unknown[]) => listed(...args),
  getWorkspaceOcrJson: (...args: unknown[]) => fetched(...args),
  serializeCollectionCandidate: (value: unknown) => ({ ok: true, body: Buffer.from(JSON.stringify(value), "utf8") }),
  putSerializedCollectionCandidate: (...args: unknown[]) => put(...args),
  getWorkspaceCollectionCandidate: vi.fn(),
}));
vi.mock("./world-store", () => ({ getFoundationActiveWorld: vi.fn() }));
vi.mock("./core-runtime-v2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./core-runtime-v2")>()),
  readProductCoreV2Env: () => ({ url: "https://core-v2.example", hmac: "x".repeat(32) }),
  dispatchProductCoreV2: (...args: unknown[]) => dispatched(...args),
  projectProductCoreV2Candidate: () => ({
    collectionId: `collection-${"0".repeat(32)}`, manifestDigest: `sha256:${"a".repeat(64)}`, lifecycle: "candidate",
    sourceDocuments: [], blueprint: {}, directoryPlan: [], ontology: { nodes: [], edges: [] },
    validation: { status: "passed", counts: {} }, reviewReasons: [],
  }),
}));
vi.mock("./compile-job-authority", () => ({
  authorizeCompileJobSourceAccess: async () => ({ ok: true }),
  compileJobAuthorityEnabled: () => true,
  classifyCompileJobSources: async () => ({ ok: true, scope: "direct_upload" }),
}));
vi.mock("./customer-data-admission", () => ({ readCustomerSourceAuthorization: async () => APPROVED_GATE }));
vi.mock("./enterprise-store", () => ({ appendServiceAuditEvent: async () => ({ ok: true, eventId: "00000000-0000-4000-8000-000000000000" }) }));
vi.mock("./compile-artifact-provenance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./compile-artifact-provenance")>()),
  registerCollectionArtifact: async () => ({ ok: true, publishBy: Date.now() + 60_000 }),
}));

const { runCollectionCompile } = await import("./collection-compile-run");

const WS = "pilot-shadow1";
const VERSION = "a".repeat(64);
const JOB_ID = `cjob-${"1".repeat(32)}`;
const DOCUMENT = "0c0c0c0c-0000-4000-8000-00000000000a";
const PREFIX = `immutable/${WS}/${WS}/${DOCUMENT}/${VERSION}`;
const RPC = "https://db.example/rest/v1/rpc/record_router_shadow_traces";
const APPROVED_GATE = {
  ok: true as const,
  decision: { allowed: true as const, schemaVersion: "tavonel.customer_data_gate.v1" as const, tenantId: WS, workspaceId: WS,
    receiptSha256: `sha256:${"f".repeat(64)}`, evaluatedAt: "2026-09-20T00:00:00.000Z" },
};
const SHADOW_ON = { TAVONEL_ROUTER_SHADOW_ENABLED: "true", TAVONEL_ROUTER_SHADOW_COHORT: WS };

function signingEnv() {
  // A fixed key so two runs sign the same payload into the same bytes (Ed25519 is deterministic).
  const pair = generateKeyPairSync("ed25519");
  const spki = createPublicKey(pair.privateKey).export({ format: "der", type: "spki" });
  return {
    TAVONEL_EXPORT_SIGNING_KEY_ID: "foundation-receipts-2026",
    TAVONEL_EXPORT_SIGNING_PRIVATE_KEY_PKCS8_DER_B64: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    TAVONEL_EXPORT_SIGNING_TRUST_STORE_JSON: JSON.stringify({
      schemaVersion: "tavonel.export_trust.v2", minimumSignatureVersion: 2, activeKeyId: "foundation-receipts-2026",
      keys: [{ keyId: "foundation-receipts-2026", keyVersion: 1, algorithm: "Ed25519", status: "active",
        notBefore: "2026-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z",
        publicKeySpkiDerBase64: spki.toString("base64"),
        publicKeySpkiSha256: `sha256:${createHash("sha256").update(spki).digest("hex")}` }],
    }),
  };
}
const SIGNING = signingEnv();

/** Two pages: page 1 read natively, page 2 by an id no worker writes (unclassifiable). */
function compilableSource() {
  listed.mockResolvedValue({ ok: true, objects: [{ key: `${PREFIX}/sanitized.pdf`, size: 1024 }, { key: `${PREFIX}/ocr.json`, size: 512 }] });
  const regions = [
    { regionId: "native-p0001", pageIndex0: 0, pageNumber1: 1, order: 0, blockType: "paragraph", bbox1000: [0, 0, 1000, 1000],
      text: "The pump was inspected.", confidence: 1, authority: "official" },
    { regionId: "r-2", pageIndex0: 1, pageNumber1: 2, order: 1, blockType: "paragraph", bbox1000: [0, 0, 1000, 1000],
      text: "The reading stayed inside the policy limits.", confidence: 1, authority: "official" },
  ];
  fetched.mockResolvedValue({ ok: true, json: {
    schemaVersion: "tavonel.ocr_result.v2", pageCount: 2, text: regions.map((r) => r.text).join("\n"),
    inputSha256: `sha256:${VERSION}`, sourceImmutableKey: `${PREFIX}/sanitized.pdf`, regions } });
  dispatched.mockResolvedValue({ ok: true, result: {
    status: "completed", runtime: "tavonel-python-core-v2", candidate: { worldStateId: "world-1", reviewReasons: [] },
    receipt: { requestId: "request-1", outputSha256: `sha256:${"f".repeat(64)}`, coreReleaseDigest: `sha256:${"e".repeat(64)}`, candidatePromotion: false },
  } });
  put.mockResolvedValue({ ok: true, status: "written", bytes: 1 });
}

let storeCalls: { url: string; body: { p_workspace_key: string; p_rows: Record<string, unknown>[] } }[];
let storeAnswer: () => Promise<Response>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-23T00:00:00.000Z"));
  for (const [name, value] of Object.entries(SIGNING)) vi.stubEnv(name, value);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k".repeat(40));
  storeCalls = [];
  storeAnswer = async () => new Response("2", { status: 200 });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    storeCalls.push({ url, body: JSON.parse(String(init.body)) });
    return storeAnswer();
  }));
  compilableSource();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function compileWith(env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);
  return { run: JSON.stringify(run), core: JSON.stringify(dispatched.mock.calls.at(-1)) };
}

describe("router shadow hook in runCollectionCompile", () => {
  it("off: zero writes; on: one write; the compile answer and Core's request are byte-identical", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const off = await compileWith({ TAVONEL_ROUTER_SHADOW_ENABLED: "", TAVONEL_ROUTER_SHADOW_COHORT: WS });
    expect(storeCalls).toHaveLength(0);
    const on = await compileWith(SHADOW_ON);
    expect(storeCalls).toHaveLength(1);
    expect(JSON.parse(off.run)).toMatchObject({ ok: true, payload: { code: "COLLECTION_CANDIDATE_READY" } });
    expect(on.run).toBe(off.run);
    expect(on.core).toBe(off.core);
    // A cohort that does not name this workspace is off too.
    await compileWith({ ...SHADOW_ON, TAVONEL_ROUTER_SHADOW_COHORT: "pilot-other" });
    expect(storeCalls).toHaveLength(1);
  });

  it("classifies through the real path: native page 1, unknown region id on page 2 is unclassifiable, never defaulted", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    await compileWith(SHADOW_ON);
    const [call] = storeCalls;
    expect(call!.url).toBe(RPC);
    expect(call!.body.p_workspace_key).toBe(WS);
    expect(call!.body.p_rows.map((row) => [row.run_ref, row.document_id, row.page_index0, row.page_class, row.outcome_class, row.reason_code]))
      .toEqual([[JOB_ID, DOCUMENT, 0, "native_text", "ok", null], [JOB_ID, DOCUMENT, 1, "unclassifiable", "semantic", "UNCLASSIFIABLE_PAGE"]]);
    expect(JSON.stringify(call!.body)).not.toMatch(/pump|policy limits|bbox/);
  });

  it("records a refused document's outcome, and the refusal is the compile's own", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    storeAnswer = async () => new Response("1", { status: 200 });
    fetched.mockResolvedValue({ ok: true, json: { schemaVersion: "tavonel.ocr_result.v1", pageCount: 1, text: "x",
      inputSha256: `sha256:${VERSION}`, sourceImmutableKey: `${PREFIX}/sanitized.pdf` } });
    const { run } = await compileWith(SHADOW_ON);
    expect(JSON.parse(run)).toMatchObject({ ok: false, code: "OCR_REGIONS_REQUIRED" });
    expect(storeCalls[0]!.body.p_rows).toMatchObject([{ page_index0: null, outcome_class: "semantic", reason_code: "OCR_REGIONS_REQUIRED" }]);
    fetched.mockResolvedValue({ ok: true, json: { schemaVersion: "tavonel.ocr_result.v9" } });
    const second = await compileWith(SHADOW_ON);
    expect(JSON.parse(second.run)).toMatchObject({ ok: false, code: "OCR_BINDING_INVALID" });
    expect(storeCalls[1]!.body.p_rows).toMatchObject([{ page_index0: null, outcome_class: "operational", reason_code: "OCR_BINDING_INVALID" }]);
  });

  it("a failing write fails nothing: same answer as with the flag off, and a reason code in the log", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const off = await compileWith({ TAVONEL_ROUTER_SHADOW_ENABLED: "" });
    storeAnswer = async () => { throw new Error("store down"); };
    const on = await compileWith(SHADOW_ON);
    expect(on.run).toBe(off.run);
    expect(error).toHaveBeenCalledWith(JSON.stringify({ event: "router_shadow_failed", code: "ROUTER_SHADOW_STORE_UNREACHABLE", pages: 2 }));
  });

  it("Core is dispatched while the write is still in flight", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    let release!: () => void;
    storeAnswer = () => new Promise<Response>((resolveWrite) => { release = () => resolveWrite(new Response("2", { status: 200 })); });
    for (const [name, value] of Object.entries(SHADOW_ON)) vi.stubEnv(name, value);
    const pending = runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);
    await vi.waitFor(() => expect(put).toHaveBeenCalled());
    expect(dispatched).toHaveBeenCalledTimes(1);
    release();
    expect(await pending).toMatchObject({ ok: true });
  });

  it("a redelivered job sends the same run, document, version and page: the database key makes the second a no-op", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    await compileWith(SHADOW_ON);
    await compileWith(SHADOW_ON);
    const key = (row: Record<string, unknown>) => [row.run_ref, row.document_id, row.version_key, row.page_index0, row.table_sha256].join("|");
    expect(storeCalls).toHaveLength(2);
    expect(storeCalls[1]!.body.p_rows.map(key)).toEqual(storeCalls[0]!.body.p_rows.map(key));
  });
});

describe("no public surface carries the trace", () => {
  const ROOT = resolve(import.meta.dirname, "..");

  it("only the compile run imports the store, and only the store imports the classifier", () => {
    // Every tracked or new source file under nextjs/ (git honours .gitignore, so node_modules and .next are out).
    const importers = execFileSync("git", ["grep", "-l", "--untracked", "-E", "router-shadow-(store|trace)|router-evidence-table", "--",
      // scripts/repair-scope.mjs is the CI owner registry: it names the files it owns as strings, it imports nothing.
      "*.ts", "*.tsx", "*.mts", "*.js", "*.mjs", ":!*.test.*", ":!*.spec.*", ":!scripts/repair-scope.mjs"], { cwd: ROOT, encoding: "utf8" })
      .split(/\r?\n/).filter(Boolean).sort();
    expect(importers).toEqual(["lib/collection-compile-run.ts", "lib/router-shadow-store.ts", "lib/router-shadow-trace.ts"]);
  });

  it("the compile's answer, the stored candidate and Core's request name no trace field", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { run, core } = await compileWith(SHADOW_ON);
    const stored = String(put.mock.calls.at(-1)?.[3]);
    for (const text of [run, core, stored]) {
      expect(text).not.toMatch(/page_class|pageClass|evidence_row|evidenceRow|incumbent|router|RT-1|RT-3|unclassifiable/i);
    }
  });
});
