import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & { proposal_id: string; workspace_key: string; collection_id: string; state: string; idempotency_key: string; input_sha256: string; expires_at: string; expected_manifest_digest: string; action_type: string; receipt: unknown };
type RpcAnswer = { status: number; body: unknown };
const error = (message: string): RpcAnswer => ({ status: 400, body: { code: "P0001", message } });

const requireFoundationSession = vi.fn<(request: Request, plan?: string) => Promise<unknown>>();
const revalidateFoundationSession = vi.fn<(request: Request, principal: unknown) => Promise<unknown>>();
const checkAccess = vi.fn<(workspaceKey: string, ids: string[], userId: string) => Promise<unknown>>();
const getActiveWorld = vi.fn<(workspaceKey: string, collectionId: string) => Promise<unknown>>();
const decideLibraryLabel = vi.fn<(workspaceKey: string, input: Record<string, unknown>, userId: string) => Promise<unknown>>();

vi.mock("@/lib/developer-auth", () => ({ requireFoundationSession, revalidateFoundationSession }));
vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccessForViewer: checkAccess }));
vi.mock("@/lib/world-store", () => ({ getFoundationActiveWorld: getActiveWorld }));
vi.mock("@/lib/library-shadow", () => ({ decideLibraryLabel }));

// The store, as the migration behaves: one row per idempotency key, a locked decide, the transitions of the outcome RPC.
let rows: Row[];
let clock: number;
const rpc = (name: string, body: Record<string, unknown>): RpcAnswer => {
  if (name === "create_world_change_proposal") {
    const existing = rows.find((row) => row.workspace_key === body.p_workspace_key && row.idempotency_key === body.p_idempotency_key);
    if (existing) {
      if (existing.input_sha256 !== body.p_input_sha256 || existing.collection_id !== body.p_collection_id) return error("proposal_idempotency_conflict");
      return { status: 200, body: { proposal: existing, replayed: true } };
    }
    const row: Row = {
      proposal_id: `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, "0")}`, workspace_key: body.p_workspace_key as string,
      collection_id: body.p_collection_id as string, action_type: body.p_action_type as string, input: body.p_input, input_sha256: body.p_input_sha256 as string,
      evidence_ids: body.p_evidence_ids, expected_manifest_digest: body.p_expected_manifest_digest as string, authorization_revision: body.p_authorization_revision,
      principal_kind: body.p_principal_kind, principal_id: body.p_principal_id, idempotency_key: body.p_idempotency_key as string, state: "proposed",
      expires_at: body.p_expires_at as string, created_at: new Date(clock).toISOString(), decided_at: null, decided_by: null, receipt: null,
    };
    rows.push(row);
    return { status: 200, body: { proposal: row, replayed: false } };
  }
  const row = rows.find((candidate) => candidate.proposal_id === body.p_proposal_id && candidate.workspace_key === body.p_workspace_key);
  if (name === "list_world_change_proposals") {
    return { status: 200, body: rows.filter((r) => r.workspace_key === body.p_workspace_key && r.collection_id === body.p_collection_id).reverse() };
  }
  if (!row) return error("proposal_not_found");
  if (name === "decide_world_change_proposal") {
    if (row.state !== "proposed") return error("proposal_not_decidable");
    const now = Date.parse(body.p_now as string);
    row.state = now >= Date.parse(row.expires_at) ? "expired" : body.p_current_manifest_digest !== row.expected_manifest_digest ? "stale"
      : body.p_decision === "reject" ? "rejected" : "confirmed";
    row.decided_at = body.p_now;
    row.decided_by = body.p_decided_by;
    return { status: 200, body: row };
  }
  if (name === "record_world_change_proposal_outcome") {
    const legal = (row.state === "confirmed" && (body.p_outcome === "executed" || body.p_outcome === "failed")) || (row.state === "executed" && body.p_outcome === "undone");
    if (!legal) return error("proposal_transition_illegal");
    row.receipt = body.p_outcome === "undone" ? { executed: row.receipt, undone: body.p_receipt } : body.p_receipt;
    row.state = body.p_outcome as string;
    return { status: 200, body: row };
  }
  return { status: 404, body: { message: "unknown rpc" } };
};
let storeDown = false;
vi.mock("@/lib/supabase-admin", () => ({
  readSupabaseAdminConfig: () => ({}),
  supabaseAdminRequest: async (_config: unknown, path: string, init: { body: string }) => {
    if (storeDown) throw new Error("network down");
    const answer = rpc(path.replace("/rest/v1/rpc/", ""), JSON.parse(init.body) as Record<string, unknown>);
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  },
}));

const list = await import("../app/api/proposals/route");
const decision = await import("../app/api/proposals/[id]/decision/route");
const undo = await import("../app/api/proposals/[id]/undo/route");

const WS = "pilot-b2b2b2b2b2b24b2b";
const USER = "7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a";
const DOC = "0a000000-0000-4000-8000-00000000000a";
const COLLECTION = `collection-${"c".repeat(32)}`;
const OTHER_COLLECTION = `collection-${"d".repeat(32)}`;
const DIGEST = `sha256:${"1".repeat(64)}`;
const MOVED = `sha256:${"2".repeat(64)}`;
const session = { ok: true, principal: { kind: "session", workspaceKey: WS, userId: USER, scopes: [], authorizationRevision: 3, workspaceRole: "owner" } };
const apiKey = { ok: true, principal: { kind: "api-key", workspaceKey: WS, userId: USER, scopes: ["documents:read"], authorizationRevision: 3, workspaceRole: "owner" } };
const nonMember = { ok: false, code: "WORKSPACE_MEMBERSHIP_REQUIRED", status: 403 };
const revalidated = { ok: true, principal: session.principal };
const revoked = { ok: false, code: "AUTHORIZATION_CHANGED_RETRY", status: 403 };

const docType = { documentId: DOC, sourceVersionId: "a".repeat(64), labelKind: "doc_type", labelKey: "invoice", decision: "confirmed" };
const topic = { documentId: DOC, sourceVersionId: "a".repeat(64), labelKind: "topic", labelKey: "pricing", decision: "rejected" };
const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: "POST", body: JSON.stringify(body), headers });
const create = (body: unknown, key: string | null = "proposal-key-0001") =>
  list.POST(new Request("https://tavonel.com/api/proposals", json(body, key === null ? {} : { "Idempotency-Key": key })));
const proposalBody = (input: unknown = docType) => ({ collectionId: COLLECTION, actionType: "library_label", input, evidenceIds: ["ev-1"] });
const decide = (id: string, body: unknown) =>
  decision.POST(new Request(`https://tavonel.com/api/proposals/${id}/decision`, json(body)), { params: Promise.resolve({ id }) });
const undoIt = (id: string, body: unknown = { collectionId: COLLECTION }) =>
  undo.POST(new Request(`https://tavonel.com/api/proposals/${id}/undo`, json(body)), { params: Promise.resolve({ id }) });
const confirm = (id: string) => decide(id, { collectionId: COLLECTION, decision: "confirm" });
const idOf = async (response: Response) => ((await response.json()) as { proposal: { proposalId: string } }).proposal.proposalId;
const stateOf = (id: string) => rows.find((row) => row.proposal_id === id)?.state;

beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
  clock = Date.parse("2026-11-16T12:00:00Z");
  storeDown = false;
  vi.useRealTimers();
  requireFoundationSession.mockResolvedValue(session);
  revalidateFoundationSession.mockResolvedValue(revalidated);
  checkAccess.mockResolvedValue({ ok: true });
  getActiveWorld.mockResolvedValue({ ok: true, world: { manifestDigest: DIGEST } });
  decideLibraryLabel.mockResolvedValue({ ok: true, replayed: false });
});

describe("POST /api/proposals", () => {
  it("creates a proposal with a dry-run preview and mutates nothing: the executor is never called", async () => {
    const response = await create(proposalBody());
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.replayed).toBe(false);
    expect(body.proposal).toMatchObject({ actionType: "library_label", state: "proposed", preview: docType, evidenceIds: ["ev-1"] });
    expect(JSON.stringify(body)).not.toMatch(/sha256|principal|idempotency|manifest/);
    expect(decideLibraryLabel).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ expected_manifest_digest: DIGEST, authorization_revision: 3, principal_kind: "session", principal_id: USER });
    expect(Date.parse(rows[0]!.expires_at) - Date.now()).toBeGreaterThan(6.9 * 24 * 3600 * 1000);
  });

  it("the same key and body shows one proposal (200, replayed); the same key with another body is a 409", async () => {
    const first = await create(proposalBody());
    const second = await create(proposalBody());
    expect(second.status).toBe(200);
    const replay = await second.json() as { replayed: boolean; proposal: { proposalId: string } };
    expect(replay.replayed).toBe(true);
    expect(replay.proposal.proposalId).toBe(await idOf(first));
    expect(rows).toHaveLength(1);
    const conflict = await create(proposalBody(topic));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ code: "PROPOSAL_IDEMPOTENCY_CONFLICT" });
    expect(rows).toHaveLength(1);
  });

  it.each([
    ["no Idempotency-Key header", () => create(proposalBody(), null)],
    ["a short Idempotency-Key", () => create(proposalBody(), "short")],
    ["an unknown action type", () => create({ ...proposalBody(), actionType: "merge_documents" })],
    ["an Undo decision", () => create(proposalBody({ ...docType, decision: "undo_confirmed" }))],
    ["a doc type outside the set", () => create(proposalBody({ ...docType, labelKey: "nope" }))],
    ["too many evidence ids", () => create({ ...proposalBody(), evidenceIds: Array.from({ length: 17 }, (_, i) => `ev-${i}`) })],
    ["a malformed collection id", () => create({ ...proposalBody(), collectionId: "collection-x" })],
    ["a body that is not an object", () => list.POST(new Request("https://tavonel.com/api/proposals", { method: "POST", body: "[1]", headers: { "Idempotency-Key": "proposal-key-0001" } }))],
  ])("refuses %s with 400 and writes nothing", async (_name, send) => {
    const response = await send();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "PROPOSAL_REQUEST_INVALID" });
    expect(rows).toHaveLength(0);
  });

  it("is session only: an API key is refused with 403 and the store is never reached", async () => {
    requireFoundationSession.mockResolvedValue(apiKey);
    const response = await create(proposalBody());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "PROPOSAL_SESSION_REQUIRED" });
    expect(rows).toHaveLength(0);
  });

  it("refuses a document the viewer cannot read (403) and a collection with no active World (404)", async () => {
    checkAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    expect((await create(proposalBody())).status).toBe(403);
    checkAccess.mockResolvedValue({ ok: true });
    getActiveWorld.mockResolvedValue({ ok: false, code: "ACTIVE_WORLD_NOT_FOUND" });
    expect((await create(proposalBody())).status).toBe(404);
    getActiveWorld.mockResolvedValue({ ok: false, code: "WORLD_STORE_READ_FAILED" });
    expect((await create(proposalBody())).status).toBe(503);
    expect(rows).toHaveLength(0);
  });

  it("a store that is down is a 503 with a code, nothing created", async () => {
    storeDown = true;
    const response = await create(proposalBody());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "PROPOSAL_STORE_UNREACHABLE" });
  });
});

describe("GET /api/proposals", () => {
  const get = (query = `collectionId=${COLLECTION}`) => list.GET(new Request(`https://tavonel.com/api/proposals?${query}`));

  it("lists the collection's proposals newest first as the public DTO", async () => {
    await create(proposalBody(), "proposal-key-0001");
    await create(proposalBody(topic), "proposal-key-0002");
    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.proposals.map((p: { preview: { labelKey: string } }) => p.preview.labelKey)).toEqual(["pricing", "invoice"]);
    expect(JSON.stringify(body)).not.toMatch(/sha256|principal|idempotency|manifest/);
    expect((await (await get(`collectionId=${OTHER_COLLECTION}`)).json()).proposals).toEqual([]);
  });

  it("leaves out a proposal whose document the viewer cannot read, and checks each distinct document once", async () => {
    const DOC_B = "0b000000-0000-4000-8000-00000000000b";
    await create(proposalBody(docType), "proposal-key-0001");
    await create(proposalBody(topic), "proposal-key-0002");
    await create(proposalBody({ ...topic, documentId: DOC_B, labelKey: "legal" }), "proposal-key-0003");
    checkAccess.mockClear();
    checkAccess.mockImplementation(async (_workspaceKey, ids) =>
      ids.includes(DOC) ? { ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" } : { ok: true });
    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.proposals.map((p: { preview: { labelKey: string } }) => p.preview.labelKey)).toEqual(["legal"]);
    expect(JSON.stringify(body)).not.toContain(DOC);
    expect(checkAccess.mock.calls.map((call) => call[1]).sort()).toEqual([[DOC], [DOC_B]]);
    expect(checkAccess.mock.calls.every((call) => call[0] === WS && call[2] === USER)).toBe(true);
  });

  it("a viewer who can read none of the documents sees an empty list, not the collection's proposals", async () => {
    await create(proposalBody(topic));
    checkAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    const response = await get();
    expect(response.status).toBe(200);
    expect((await response.json()).proposals).toEqual([]);
    expect(checkAccess).toHaveBeenCalled();
  });

  it("an access check that is unavailable fails closed with 503 and lists nothing", async () => {
    await create(proposalBody(topic));
    checkAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE" });
    const response = await get();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE" });
  });

  it("refuses an API key (403), a missing collection (400), and a down store (503)", async () => {
    requireFoundationSession.mockResolvedValue(apiKey);
    expect((await get()).status).toBe(403);
    requireFoundationSession.mockResolvedValue(session);
    expect((await get("")).status).toBe(400);
    storeDown = true;
    expect((await get()).status).toBe(503);
  });
});

describe("POST /api/proposals/[id]/decision", () => {
  it("confirm executes once, with the proposal id as the library idempotency key, and records the receipt", async () => {
    const id = await idOf(await create(proposalBody()));
    const response = await confirm(id);
    expect(response.status).toBe(200);
    expect((await response.json()).proposal.state).toBe("executed");
    expect(decideLibraryLabel).toHaveBeenCalledTimes(1);
    expect(decideLibraryLabel).toHaveBeenCalledWith(WS, { ...docType, idempotencyKey: id }, USER);
    expect(rows[0]!.receipt).toMatchObject({ proposalId: id, inputSha256: rows[0]!.input_sha256, decidedBy: USER, result: { ok: true, replayed: false } });
    expect(rows[0]!.receipt).toHaveProperty("executedAt");
  });

  it("reject records the decision and never executes", async () => {
    const id = await idOf(await create(proposalBody()));
    const response = await decide(id, { collectionId: COLLECTION, decision: "reject" });
    expect((await response.json()).proposal.state).toBe("rejected");
    expect(decideLibraryLabel).not.toHaveBeenCalled();
  });

  it("a second confirmation is a 409 and does not execute again", async () => {
    const id = await idOf(await create(proposalBody()));
    expect((await confirm(id)).status).toBe(200);
    const again = await confirm(id);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ code: "PROPOSAL_NOT_DECIDABLE" });
    expect(decideLibraryLabel).toHaveBeenCalledTimes(1);
  });

  it("a confirmation after the active World moved is stale, and nothing executes", async () => {
    const id = await idOf(await create(proposalBody()));
    getActiveWorld.mockResolvedValue({ ok: true, world: { manifestDigest: MOVED } });
    expect((await (await confirm(id)).json()).proposal.state).toBe("stale");
    expect(decideLibraryLabel).not.toHaveBeenCalled();
  });

  it("a confirmation past the expiry is expired, and nothing executes", async () => {
    const id = await idOf(await create(proposalBody()));
    rows[0]!.expires_at = new Date(Date.now() - 1000).toISOString();
    expect((await (await confirm(id)).json()).proposal.state).toBe("expired");
    expect(decideLibraryLabel).not.toHaveBeenCalled();
  });

  it("an executor failure is recorded as failed with its code, never retried, and the response says failed", async () => {
    const id = await idOf(await create(proposalBody()));
    decideLibraryLabel.mockResolvedValue({ ok: false, code: "LIBRARY_ORGANIZE_NOT_ENABLED", status: 404 });
    const response = await confirm(id);
    expect(response.status).toBe(200);
    expect((await response.json()).proposal.state).toBe("failed");
    expect(rows[0]!.receipt).toMatchObject({ result: { ok: false, code: "LIBRARY_ORGANIZE_NOT_ENABLED", status: 404 } });
    expect(decideLibraryLabel).toHaveBeenCalledTimes(1);
    expect((await confirm(id)).status).toBe(409);
    expect(decideLibraryLabel).toHaveBeenCalledTimes(1);
  });

  it("an executor that throws is recorded as failed", async () => {
    const id = await idOf(await create(proposalBody()));
    decideLibraryLabel.mockRejectedValue(new Error("boom"));
    expect((await (await confirm(id)).json()).proposal.state).toBe("failed");
    expect(rows[0]!.receipt).toMatchObject({ result: { ok: false, code: "PROPOSAL_EXECUTOR_FAILED" } });
  });

  it("source access lost before the confirmation is a 403, nothing executes, and the proposal can still be rejected", async () => {
    const id = await idOf(await create(proposalBody()));
    checkAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    expect((await confirm(id)).status).toBe(403);
    expect(decideLibraryLabel).not.toHaveBeenCalled();
    expect(stateOf(id)).toBe("proposed");
    expect((await decide(id, { collectionId: COLLECTION, decision: "reject" })).status).toBe(200);
    expect(stateOf(id)).toBe("rejected");
  });

  it("a rejection by a viewer who cannot read the document records the decision but carries no preview", async () => {
    const id = await idOf(await create(proposalBody(topic)));
    const second = await idOf(await create(proposalBody(docType), "proposal-key-0002"));
    checkAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    const response = await decide(id, { collectionId: COLLECTION, decision: "reject" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.proposal.state).toBe("rejected");
    expect(body.proposal.preview).toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/pricing|documentId|sourceVersionId/);
    checkAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE" });
    expect((await (await decide(second, { collectionId: COLLECTION, decision: "reject" })).json()).proposal.preview).toBeNull();
  });

  it("a rejection by a viewer who can read the document still carries the preview", async () => {
    const id = await idOf(await create(proposalBody(topic)));
    const body = await (await decide(id, { collectionId: COLLECTION, decision: "reject" })).json();
    expect(body.proposal.preview).toMatchObject({ documentId: DOC, labelKey: "pricing" });
  });

  it("is session only: an API key is refused with 403 and the proposal stays proposed", async () => {
    const id = await idOf(await create(proposalBody()));
    requireFoundationSession.mockResolvedValue(apiKey);
    expect((await confirm(id)).status).toBe(403);
    expect(stateOf(id)).toBe("proposed");
    expect(decideLibraryLabel).not.toHaveBeenCalled();
  });

  it("a proposal named under another collection or workspace is not found", async () => {
    const id = await idOf(await create(proposalBody()));
    expect((await decide(id, { collectionId: OTHER_COLLECTION, decision: "confirm" })).status).toBe(404);
    requireFoundationSession.mockResolvedValue({ ...session, principal: { ...session.principal, workspaceKey: "pilot-other" } });
    expect((await confirm(id)).status).toBe(404);
    expect(decideLibraryLabel).not.toHaveBeenCalled();
  });

  it.each([
    ["no decision", { collectionId: COLLECTION }],
    ["an unknown decision", { collectionId: COLLECTION, decision: "approve" }],
    ["no collection", { decision: "confirm" }],
  ])("refuses %s with 400", async (_name, body) => {
    const id = await idOf(await create(proposalBody()));
    expect((await decide(id, body)).status).toBe(400);
    expect(stateOf(id)).toBe("proposed");
  });

  it("a store that fails to record the outcome after executing says so with 503", async () => {
    const id = await idOf(await create(proposalBody()));
    decideLibraryLabel.mockImplementation(async () => { storeDown = true; return { ok: true, replayed: false }; });
    const response = await confirm(id);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "PROPOSAL_OUTCOME_NOT_RECORDED" });
  });
});

describe("POST /api/proposals/[id]/undo", () => {
  const executed = async (input: unknown = docType) => {
    const id = await idOf(await create(proposalBody(input), `proposal-key-${rows.length + 1}0000`));
    await confirm(id);
    decideLibraryLabel.mockClear();
    return id;
  };

  it("issues the opposite decision under its own key and records undone, keeping the execution receipt", async () => {
    const id = await executed();
    const response = await undoIt(id);
    expect(response.status).toBe(200);
    expect((await response.json()).proposal.state).toBe("undone");
    expect(decideLibraryLabel).toHaveBeenCalledTimes(1);
    expect(decideLibraryLabel).toHaveBeenCalledWith(WS, { ...docType, decision: "undo_confirmed", idempotencyKey: `${id}:undo` }, USER);
    expect(rows[0]!.receipt).toMatchObject({ executed: { proposalId: id }, undone: { proposalId: id, undoneBy: USER } });
  });

  it("undoes a rejection with undo_rejected", async () => {
    const id = await executed(topic);
    await undoIt(id);
    expect(decideLibraryLabel).toHaveBeenCalledWith(WS, expect.objectContaining({ decision: "undo_rejected" }), USER);
  });

  it("undo twice: the second is refused with 409 and issues nothing", async () => {
    const id = await executed();
    expect((await undoIt(id)).status).toBe(200);
    decideLibraryLabel.mockClear();
    const again = await undoIt(id);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ code: "PROPOSAL_NOT_UNDOABLE" });
    expect(decideLibraryLabel).not.toHaveBeenCalled();
  });

  it("two undos at once issue the decision under one key and record one undone", async () => {
    const id = await executed();
    const answers = await Promise.all([undoIt(id), undoIt(id)]);
    expect(answers.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(new Set(decideLibraryLabel.mock.calls.map((call) => (call[1] as { idempotencyKey: string }).idempotencyKey))).toEqual(new Set([`${id}:undo`]));
  });

  it("a library that refuses the undo as stale records nothing and the proposal stays executed", async () => {
    const id = await executed();
    decideLibraryLabel.mockResolvedValue({ ok: false, code: "LIBRARY_DECISION_STALE", status: 409 });
    const response = await undoIt(id);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "LIBRARY_DECISION_STALE" });
    expect(stateOf(id)).toBe("executed");
  });

  it.each([["proposed"], ["rejected"], ["failed"]])("refuses an undo of a %s proposal", async (state) => {
    const id = await idOf(await create(proposalBody()));
    if (state === "rejected") await decide(id, { collectionId: COLLECTION, decision: "reject" });
    if (state === "failed") { decideLibraryLabel.mockResolvedValue({ ok: false, code: "X", status: 500 }); await confirm(id); }
    decideLibraryLabel.mockClear();
    expect((await undoIt(id)).status).toBe(409);
    expect(decideLibraryLabel).not.toHaveBeenCalled();
  });

  it("is session only, and refuses a viewer who lost source access", async () => {
    const id = await executed();
    requireFoundationSession.mockResolvedValue(apiKey);
    expect((await undoIt(id)).status).toBe(403);
    requireFoundationSession.mockResolvedValue(session);
    checkAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    expect((await undoIt(id)).status).toBe(403);
    expect(decideLibraryLabel).not.toHaveBeenCalled();
    expect(stateOf(id)).toBe("executed");
  });
});

/*
  U37: generated cases. Every combination of who asks, what the world looks like at the moment of the
  decision, how many identical decisions arrive at once, and what is decided. The expectation is
  stated per combination, not derived from the code: exactly one execution for a granted, fresh
  confirmation however many duplicates arrive, and zero executions in every other case.
*/
type Who = "granted" | "api_key" | "non_member" | "revoked_revision";
type When = "fresh" | "expired" | "stale" | "source_revoked";
const WHO: Who[] = ["granted", "api_key", "non_member", "revoked_revision"];
const WHEN: When[] = ["fresh", "expired", "stale", "source_revoked"];
const expectedState = (who: Who, when: When, verdict: "confirm" | "reject") => {
  if (who !== "granted") return "proposed";
  if (when === "expired") return "expired";
  if (when === "stale") return "stale";
  if (verdict === "reject") return "rejected";
  return when === "source_revoked" ? "proposed" : "executed";
};

describe("decision matrix (generated)", () => {
  const cases = WHO.flatMap((who) => WHEN.flatMap((when) => ([1, 2, 3] as const).flatMap((copies) =>
    (["confirm", "reject"] as const).flatMap((verdict) => ([docType, topic] as const).map((input) => ({ who, when, copies, verdict, input }))))));

  it("covers at least 100 cases", () => expect(cases.length).toBeGreaterThanOrEqual(100));

  it.each(cases.map((c) => [`${c.who} / ${c.when} / x${c.copies} / ${c.verdict} / ${c.input.labelKind}`, c] as const))("%s", async (_name, c) => {
    const id = await idOf(await create(proposalBody(c.input)));
    if (c.when === "expired") rows[0]!.expires_at = new Date(Date.now() - 1000).toISOString();
    if (c.when === "stale") getActiveWorld.mockResolvedValue({ ok: true, world: { manifestDigest: MOVED } });
    if (c.when === "source_revoked") checkAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    if (c.who === "api_key") requireFoundationSession.mockResolvedValue(apiKey);
    if (c.who === "non_member") requireFoundationSession.mockResolvedValue(nonMember);
    if (c.who === "revoked_revision") revalidateFoundationSession.mockResolvedValue(revoked);
    decideLibraryLabel.mockClear();

    const answers = await Promise.all(Array.from({ length: c.copies }, () => decide(id, { collectionId: COLLECTION, decision: c.verdict })));
    const final = expectedState(c.who, c.when, c.verdict);
    expect(stateOf(id)).toBe(final);
    expect(decideLibraryLabel).toHaveBeenCalledTimes(final === "executed" ? 1 : 0);
    if (final === "executed") expect(decideLibraryLabel.mock.calls[0]![1]).toMatchObject({ idempotencyKey: id, decision: c.input.decision });
    // Exactly one answer is the decision; every duplicate is refused, and a refused caller gets no 2xx at all.
    const ok = answers.filter((answer) => answer.status === 200).length;
    const decided = final !== "proposed";
    expect(ok).toBe(decided ? 1 : 0);
    expect(answers.every((answer) => answer.status === 200 || answer.status >= 400)).toBe(true);
  });
});

describe("create matrix (generated)", () => {
  const cases = WHO.flatMap((who) => ([1, 2, 3] as const).flatMap((copies) =>
    (["same_body", "other_body", "distinct_keys"] as const).map((mode) => ({ who, copies, mode }))));

  it.each(cases.map((c) => [`${c.who} / x${c.copies} / ${c.mode}`, c] as const))("%s", async (_name, c) => {
    if (c.who === "api_key") requireFoundationSession.mockResolvedValue(apiKey);
    if (c.who === "non_member") requireFoundationSession.mockResolvedValue(nonMember);
    const answers = [];
    for (let i = 0; i < c.copies; i += 1) {
      const key = c.mode === "distinct_keys" ? `proposal-key-000${i}` : "proposal-key-0001";
      const body = c.mode === "other_body" && i > 0 ? proposalBody({ ...topic, labelKey: `topic-${i}` }) : proposalBody();
      answers.push(await create(body, key));
    }
    const denied = c.who === "api_key" || c.who === "non_member";
    expect(rows).toHaveLength(denied ? 0 : c.mode === "distinct_keys" ? c.copies : 1);
    if (!denied && c.mode === "other_body" && c.copies > 1) expect(answers.slice(1).every((answer) => answer.status === 409)).toBe(true);
    if (!denied && c.mode === "same_body") expect(answers.every((answer) => answer.status === 200 || answer.status === 201)).toBe(true);
    expect(decideLibraryLabel).not.toHaveBeenCalled();
  });
});
