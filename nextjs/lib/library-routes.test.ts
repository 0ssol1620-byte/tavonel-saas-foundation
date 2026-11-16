/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireFoundationSession = vi.fn<(...args: any[]) => any>();
const checkAccess = vi.fn<(...args: any[]) => any>();
const rpc = vi.fn<(name: string, body: any) => { status: number; body: unknown } | "unreachable">();

vi.mock("@/lib/developer-auth", () => ({ requireFoundationSession }));
vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccessForViewer: checkAccess }));
vi.mock("@/lib/operations-p0", () => ({ deliverOperationsAlert: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({
  readSupabaseAdminConfig: () => ({}),
  supabaseAdminRequest: async (_config: unknown, path: string, init: { body: string }) => {
    const answer = rpc(path.replace("/rest/v1/rpc/", ""), JSON.parse(init.body));
    if (answer === "unreachable") throw new Error("network down");
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  },
}));

const { GET } = await import("../app/api/library/route");
const { POST } = await import("../app/api/library/decisions/route");

const WS = "pilot-b2b2b2b2b2b24b2b";
const USER = "7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a";
const A = "0a000000-0000-4000-8000-00000000000a";
const VERSION = "a".repeat(64);
const session = { ok: true, principal: { kind: "session", workspaceKey: WS, userId: USER, scopes: [] } };
const apiKey = { ok: true, principal: { kind: "api-key", workspaceKey: WS, userId: USER, scopes: ["documents:read", "documents:intake"] } };

const readBody = {
  schemaVersion: "tavonel.library_organize_read.v1",
  labels: [{ documentId: A, sourceVersionId: VERSION, labelKind: "doc_type", labelKey: "contract", labelSetVersion: "doc-type:v0",
    method: "rules", methodVersion: "doc-type-rules:v1", inputsSha256: `sha256:${"1".repeat(64)}`, disposition: "proposed",
    abstainReason: null, internalScore: 0.75, evidenceIds: [], createdAt: "2026-11-07T10:00:00+00:00" }],
  relations: [],
};
const decision = { documentId: A, sourceVersionId: VERSION, labelKind: "doc_type", labelKey: "invoice", decision: "confirmed", idempotencyKey: "idem-key-0001" };
const get = (query = `documents=${A}`) => GET(new Request(`https://tavonel.com/api/library?${query}`));
const post = (body: unknown) => POST(new Request("https://tavonel.com/api/library/decisions", { method: "POST", body: JSON.stringify(body) }));

// The store keeps one row per idempotency key, as the migration does.
let stored: Map<string, { labelKey: string; decision: string }>;
const store = (name: string, body: any) => {
  if (name === "read_library_organize") return { status: 200, body: readBody };
  if (name !== "decide_library_label") return { status: 404, body: { message: "unknown rpc" } };
  const existing = stored.get(body.p_idempotency_key);
  if (existing && (existing.labelKey !== body.p_label_key || existing.decision !== body.p_decision)) {
    return { status: 400, body: { code: "P0001", message: "library_decision_conflict" } };
  }
  stored.set(body.p_idempotency_key, { labelKey: body.p_label_key, decision: body.p_decision });
  return { status: 200, body: { schemaVersion: "tavonel.library_decision.v1", replayed: existing !== undefined } };
};

beforeEach(() => {
  vi.clearAllMocks();
  stored = new Map();
  vi.stubEnv("TAVONEL_LIBRARY_ORGANIZE_MODE", "on");
  vi.stubEnv("TAVONEL_PROCESSING_WORKSPACE_COHORT", WS);
  vi.stubEnv("TAVONEL_CUSTOMER_DATA_GATE_VERSION", "v2");
  requireFoundationSession.mockResolvedValue(session);
  checkAccess.mockResolvedValue({ ok: true });
  rpc.mockImplementation(store);
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/library", () => {
  it("answers the public DTO with the source version a decision must name, uncacheable", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.documents).toEqual([{ documentId: A, documentType: { label: "contract", state: "proposed" }, topics: [], duplicates: [] }]);
    expect(body.sourceVersions).toEqual({ [A]: VERSION });
    expect(JSON.stringify(body)).not.toContain("internalScore");
  });

  it("is a session route: an API key is refused with 403, without reading the store", async () => {
    requireFoundationSession.mockResolvedValue(apiKey);
    expect((await get()).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("an unauthenticated caller is refused with the auth code", async () => {
    requireFoundationSession.mockResolvedValue({ ok: false, code: "AUTH_REQUIRED", status: 401 });
    const response = await get();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "AUTH_REQUIRED" });
  });

  it("disabled mode answers 404 with the code, and never reads the store", async () => {
    vi.stubEnv("TAVONEL_LIBRARY_ORGANIZE_MODE", "off");
    const response = await get();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "LIBRARY_ORGANIZE_NOT_ENABLED" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a malformed document list is a 400, an unreachable store is a 503 with a code and no documents", async () => {
    expect((await get("documents=not-a-uuid")).status).toBe(400);
    expect((await get("")).status).toBe(400);
    rpc.mockReturnValue("unreachable");
    const down = await get();
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ code: "LIBRARY_ORGANIZE_STORE_UNREACHABLE" });
  });
});

describe("POST /api/library/decisions", () => {
  it("is session only: an API key with every scope is refused with 403 and writes nothing", async () => {
    requireFoundationSession.mockResolvedValue(apiKey);
    expect((await post(decision)).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("disabled mode answers 404 with the code and writes nothing", async () => {
    vi.stubEnv("TAVONEL_LIBRARY_ORGANIZE_MODE", "shadow");
    const response = await post(decision);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "LIBRARY_ORGANIZE_NOT_ENABLED" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("posting the same decision twice records one decision and says the second was a replay", async () => {
    const first = await (await post(decision)).json();
    const second = await (await post(decision)).json();
    expect(first).toEqual({ code: "OK", replayed: false });
    expect(second).toEqual({ code: "OK", replayed: true });
    expect(stored.size).toBe(1);
    expect(rpc).toHaveBeenCalledWith("decide_library_label", expect.objectContaining({
      p_workspace_key: WS, p_decided_by: USER, p_label_key: "invoice", p_decision: "confirmed", p_idempotency_key: "idem-key-0001" }));
  });

  it("an undo is the opposite decision under a new key; the same key with another decision is a 409", async () => {
    expect((await post({ ...decision, decision: "rejected", idempotencyKey: "idem-key-0002" })).status).toBe(200);
    expect((await post(decision)).status).toBe(200);
    const conflict = await post({ ...decision, decision: "rejected" });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ code: "LIBRARY_DECISION_CONFLICT" });
  });

  it("a viewer who may not read the source is refused with 403 and writes nothing", async () => {
    checkAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    expect((await post(decision)).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    checkAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE" });
    expect((await post(decision)).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a malformed body is a 400 before the access check or the store", async () => {
    for (const body of [null, "x", [], { ...decision, decision: "proposed" }, { ...decision, labelKind: "relation" },
      { ...decision, documentId: "not-a-uuid" }, { ...decision, idempotencyKey: "short" }, { ...decision, labelKey: "banana" },
      { ...decision, sourceVersionId: "abc" }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(checkAccess).toHaveBeenCalledTimes(3);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("store down is a 503 with a code, a missing migration is a 503, and the answer carries no decision", async () => {
    rpc.mockReturnValue("unreachable");
    const down = await post(decision);
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ code: "LIBRARY_ORGANIZE_STORE_UNREACHABLE" });
    rpc.mockReturnValue({ status: 404, body: { code: "PGRST202", message: "function not found" } });
    const absent = await post(decision);
    expect(absent.status).toBe(503);
    expect(await absent.json()).toEqual({ code: "LIBRARY_ORGANIZE_MIGRATION_ABSENT" });
    rpc.mockReturnValue({ status: 400, body: { code: "P0001", message: "library_decision_target_missing" } });
    expect((await post(decision)).status).toBe(404);
  });
});
