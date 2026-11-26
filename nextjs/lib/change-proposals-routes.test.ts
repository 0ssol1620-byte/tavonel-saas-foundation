import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & {
  proposal_id: string; workspace_key: string; collection_id: string | null; state: string; idempotency_key: string; input_sha256: string;
  expires_at: string; expected_manifest_digest: string; action_type: string; receipt: unknown; created_at: string; decided_at: string | null;
  decided_by: string | null; principal_kind: string; principal_id: string; agent_grant_id: string | null; binding_kind: string;
};
type Grant = { workspace_key: string; user_id: string; client_label: string; grantor_email: string | null; live: boolean };
type RpcAnswer = { status: number; body: unknown };
const error = (message: string): RpcAnswer => ({ status: 400, body: { code: "P0001", message } });

const requireFoundationSession = vi.fn<(request: Request, plan?: string) => Promise<unknown>>();
const requireFoundationRevokeSession = vi.fn<(request: Request) => Promise<unknown>>();
const revalidateFoundationSession = vi.fn<(request: Request, principal: unknown) => Promise<unknown>>();
const checkAccess = vi.fn<(workspaceKey: string, ids: string[], userId: string) => Promise<unknown>>();
const getActiveWorld = vi.fn<(workspaceKey: string, collectionId: string) => Promise<unknown>>();
const decideLibraryLabel = vi.fn<(workspaceKey: string, input: Record<string, unknown>, userId: string) => Promise<unknown>>();
const readLibraryDocuments = vi.fn<(workspaceKey: string, ids: readonly string[], userId: string) => Promise<unknown>>();

vi.mock("@/lib/developer-auth", () => ({ requireFoundationSession, requireFoundationRevokeSession, revalidateFoundationSession }));
vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccessForViewer: checkAccess }));
vi.mock("@/lib/world-store", () => ({ getFoundationActiveWorld: getActiveWorld }));
vi.mock("@/lib/library-shadow", () => ({ decideLibraryLabel, readLibraryDocuments }));

/*
  The store, as supabase/migrations/20261117130000_agent_proposals.sql behaves: one row per idempotency key
  (replay only for the same principal, grant, type, collection and input), the agent grant checked and the
  open cap counted per person at create, a locked decide on the DB clock (`p_now` ignored) in the order
  expired → withdrawn → stale → rejected → confirmed, the transitions of the outcome RPC, lookup by id and
  the keyset page with the grant fields. created_at carries microseconds, as to_jsonb prints a timestamptz.
*/
let rows: Row[];
let grants: Map<string, Grant>;
let seq: number;
let calls: string[];
let failCreateAfter: number | null;
let recordDown: boolean;
const createdAt = (n: number) => `2026-11-16T12:00:00.${String(n).padStart(6, "0")}+00:00`;
const withGrant = (row: Row) => {
  const grant = row.agent_grant_id ? grants.get(row.agent_grant_id) : undefined;
  return { ...row, agent_client_label: grant?.client_label ?? null, agent_grantor_email: grant?.grantor_email ?? null };
};
const rpc = (name: string, body: Record<string, unknown>): RpcAnswer => {
  calls.push(name);
  if (name === "create_world_change_proposal") {
    if (failCreateAfter !== null && calls.filter((call) => call === name).length > failCreateAfter) return error("proposal_open_limit");
    const agent = body.p_principal_kind === "agent";
    const grant = agent ? grants.get(body.p_agent_grant_id as string) : undefined;
    if (agent && (!grant || !grant.live || grant.workspace_key !== body.p_workspace_key || grant.user_id !== body.p_principal_id)) return error("proposal_agent_grant_revoked");
    const existing = rows.find((row) => row.workspace_key === body.p_workspace_key && row.idempotency_key === body.p_idempotency_key);
    if (existing) {
      if (existing.input_sha256 !== body.p_input_sha256 || existing.collection_id !== body.p_collection_id || existing.action_type !== body.p_action_type
        || existing.principal_kind !== body.p_principal_kind || existing.principal_id !== body.p_principal_id
        || existing.agent_grant_id !== (body.p_agent_grant_id ?? null)) return error("proposal_idempotency_conflict");
      return { status: 200, body: { proposal: existing, replayed: true } };
    }
    if (agent) {
      const open = rows.filter((row) => row.workspace_key === body.p_workspace_key && row.principal_id === body.p_principal_id
        && row.principal_kind === "agent" && row.state === "proposed").length;
      if (open + (body.p_open_reserve as number) > (body.p_open_limit as number)) return error("proposal_open_limit");
    }
    seq += 1;
    const row: Row = {
      proposal_id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, workspace_key: body.p_workspace_key as string,
      collection_id: body.p_collection_id as string | null, action_type: body.p_action_type as string, input: body.p_input, input_sha256: body.p_input_sha256 as string,
      evidence_ids: body.p_evidence_ids, expected_manifest_digest: body.p_expected_manifest_digest as string, authorization_revision: body.p_authorization_revision,
      principal_kind: body.p_principal_kind as string, principal_id: body.p_principal_id as string, idempotency_key: body.p_idempotency_key as string,
      state: "proposed", expires_at: body.p_expires_at as string, created_at: createdAt(seq), decided_at: null, decided_by: null, receipt: null,
      binding_kind: body.p_binding_kind as string, agent_grant_id: (body.p_agent_grant_id as string | null) ?? null,
    };
    rows.push(row);
    return { status: 200, body: { proposal: row, replayed: false } };
  }
  if (name === "list_world_change_proposals") {
    return { status: 200, body: rows.filter((r) => r.workspace_key === body.p_workspace_key && r.collection_id === body.p_collection_id).reverse() };
  }
  if (name === "list_world_change_proposals_page") {
    const before = body.p_before_created_at === null ? null : `${body.p_before_created_at as string}|${body.p_before_id as string}`;
    const page = rows.filter((r) => r.workspace_key === body.p_workspace_key && (body.p_agent_grant_id === null || r.agent_grant_id === body.p_agent_grant_id))
      .map((r) => ({ r, key: `${r.created_at}|${r.proposal_id}` }))
      .filter(({ key }) => before === null || key < before)
      .sort((a, b) => (a.key < b.key ? 1 : -1)).slice(0, body.p_limit as number).map(({ r }) => withGrant(r));
    return { status: 200, body: page };
  }
  if (name === "read_foundation_agent_grant") {
    const grant = grants.get(body.p_grant_id as string);
    const mine = grant && grant.workspace_key === body.p_workspace_key && grant.user_id === body.p_user_id;
    return { status: 200, body: mine ? { grantId: body.p_grant_id, authorizationRevision: 3, createdAt: "2026-11-16T12:00:00Z", revokedAt: grant.live ? null : "2026-11-17T00:00:00Z" } : null };
  }
  const row = rows.find((candidate) => candidate.proposal_id === body.p_proposal_id && candidate.workspace_key === body.p_workspace_key);
  if (!row) return error("proposal_not_found");
  if (name === "get_world_change_proposal") return { status: 200, body: withGrant(row) };
  if (name === "decide_world_change_proposal") {
    if (row.state !== "proposed") return error("proposal_not_decidable");
    const now = Date.now();
    const grant = row.agent_grant_id ? grants.get(row.agent_grant_id) : undefined;
    row.state = now >= Date.parse(row.expires_at) ? "expired" : row.principal_kind === "agent" && !grant?.live ? "withdrawn"
      : body.p_current_manifest_digest !== row.expected_manifest_digest ? "stale" : body.p_decision === "reject" ? "rejected" : "confirmed";
    row.decided_at = new Date(now).toISOString();
    row.decided_by = row.state === "withdrawn" ? null : body.p_decided_by as string;
    return { status: 200, body: row };
  }
  if (name === "record_world_change_proposal_outcome") {
    if (recordDown) throw new Error("network down");
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

const lib = await import("./change-proposals");
const list = await import("../app/api/proposals/route");
const byId = await import("../app/api/proposals/[id]/route");
const decision = await import("../app/api/proposals/[id]/decision/route");
const undo = await import("../app/api/proposals/[id]/undo/route");
const receiptRoute = await import("../app/api/proposals/[id]/receipt/route");
const activityRoute = await import("../app/api/agent-grants/[id]/activity/route");
const { DECISION_MAX_DURATION_S, PROPOSAL_RESUME_AFTER_MS } = await import("./agent-access");
const signing = await import("./export-signing");

const WS = "pilot-b2b2b2b2b2b24b2b";
const USER = "7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a";
const OTHER_USER = "7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b";
const GRANT = "9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a";
const GRANT_2 = "9b9b9b9b-9b9b-4b9b-8b9b-9b9b9b9b9b9b";
const DOC = "0a000000-0000-4000-8000-00000000000a";
const COLLECTION = `collection-${"c".repeat(32)}`;
const OTHER_COLLECTION = `collection-${"d".repeat(32)}`;
const DIGEST = `sha256:${"1".repeat(64)}`;
const MOVED = `sha256:${"2".repeat(64)}`;
const session = { ok: true, principal: { kind: "session", workspaceKey: WS, userId: USER, scopes: [], authorizationRevision: 3, workspaceRole: "owner" } };
const otherPerson = { ok: true, principal: { ...session.principal, userId: OTHER_USER } };
const apiKey = { ok: true, principal: { kind: "api-key", workspaceKey: WS, userId: USER, scopes: ["documents:read"], authorizationRevision: 3, workspaceRole: "owner" } };
const nonMember = { ok: false, code: "WORKSPACE_MEMBERSHIP_REQUIRED", status: 403 };
const revalidated = { ok: true, principal: session.principal };
const revoked = { ok: false, code: "AUTHORIZATION_CHANGED_RETRY", status: 403 };
const agentActor = (grantId = GRANT) => ({ kind: "agent" as const, workspaceKey: WS, userId: USER, authorizationRevision: 3, grantId, keyId: "k-1" });

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
const readOne = (id: string) => byId.GET(new Request(`https://tavonel.com/api/proposals/${id}`), { params: Promise.resolve({ id }) });
/** The digest of the preview the panel rendered for this row: what a confirming client sends back. */
const digestOf = (id: string) => {
  const row = rows.find((candidate) => candidate.proposal_id === id)!;
  return lib.proposalPreviewDigest(id, row.action_type, row.action_type === "library_label" ? row.input : stubPreview(row.input));
};
const confirm = (id: string) => decide(id, { collectionId: COLLECTION, decision: "confirm", previewDigest: digestOf(id) });
const idOf = async (response: Response) => ((await response.json()) as { proposal: { proposalId: string } }).proposal.proposalId;
const stateOf = (id: string) => rows.find((row) => row.proposal_id === id)?.state;
const decideCalls = () => calls.filter((call) => call === "decide_world_change_proposal").length;
const createCalls = () => calls.filter((call) => call === "create_world_change_proposal").length;

/*
  A stub second executor, registered for the duration of a test only: `compile_plan` has no executor until
  WO-AN-4, and the store pairs it with a null collection, which is what lookup by id must handle.
*/
type StubInput = { documentIds: string[] };
const stubRun = vi.fn<(ctx: unknown) => Promise<unknown>>();
const stubPreview = (input: unknown) => ({ documentIds: (input as StubInput).documentIds, documentsTotal: (input as StubInput).documentIds.length });
const stubExecutor = {
  parse: (raw: unknown) => raw && typeof raw === "object" && Array.isArray((raw as StubInput).documentIds)
    && (raw as StubInput).documentIds.every((id) => typeof id === "string") ? { documentIds: [...(raw as StubInput).documentIds] } : null,
  documentsOf: (input: StubInput) => input.documentIds,
  previewOf: stubPreview,
  bindingKind: "source_inventory" as const,
  prepare: async (_actor: unknown, raw: unknown, evidenceIds: string[]) => {
    const input = stubExecutor.parse((raw as { input?: unknown })?.input);
    return input && input.documentIds.length > 0 ? { ok: true as const, input, collectionId: null, bindingDigest: DIGEST, evidenceIds }
      : { ok: false as const, code: "PROPOSAL_REQUEST_INVALID", status: 400 };
  },
  currentBinding: async () => ({ ok: true as const, digest: DIGEST }),
  preconditions: async () => null,
  run: (ctx: unknown) => stubRun(ctx),
  resultRef: (result: { jobId?: unknown }) => ({ jobId: result.jobId }),
};
const registry = lib.PROPOSAL_EXECUTORS as unknown as Record<string, unknown>;
const withStub = (documentsOf?: (input: StubInput) => string[]) => {
  registry.compile_plan = documentsOf ? { ...stubExecutor, documentsOf } : stubExecutor;
};
/** A row written straight into the store, as another lane's code or an older deploy would have left it. */
const seedRow = (fields: Partial<Row>): Row => {
  seq += 1;
  const row: Row = {
    proposal_id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, workspace_key: WS, collection_id: COLLECTION,
    action_type: "library_label", input: docType, input_sha256: `sha256:${"e".repeat(64)}`, evidence_ids: [], expected_manifest_digest: DIGEST,
    authorization_revision: 3, principal_kind: "session", principal_id: USER, idempotency_key: `seeded-key-${seq}`, state: "proposed",
    expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_at: createdAt(seq), decided_at: null, decided_by: null, receipt: null,
    binding_kind: "active_manifest", agent_grant_id: null, ...fields,
  };
  rows.push(row);
  return row;
};

function keyEnv() {
  const pair = generateKeyPairSync("ed25519");
  const spki = createPublicKey(pair.privateKey).export({ format: "der", type: "spki" });
  const trust = {
    schemaVersion: "tavonel.export_trust.v2", minimumSignatureVersion: 2, activeKeyId: "foundation-actions-2026",
    keys: [{
      keyId: "foundation-actions-2026", keyVersion: 1, algorithm: "Ed25519", status: "active",
      notBefore: "2026-01-01T00:00:00.000Z", expiresAt: "2030-01-01T00:00:00.000Z", publicKeySpkiDerBase64: spki.toString("base64"),
      publicKeySpkiSha256: `sha256:${createHash("sha256").update(spki).digest("hex")}`,
    }],
  };
  return {
    TAVONEL_EXPORT_SIGNING_KEY_ID: "foundation-actions-2026",
    TAVONEL_EXPORT_SIGNING_PRIVATE_KEY_PKCS8_DER_B64: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    TAVONEL_EXPORT_SIGNING_TRUST_STORE_JSON: JSON.stringify(trust),
  };
}
const SIGNER_ENV = keyEnv();
const stubSigner = (on: boolean) => {
  for (const [name, value] of Object.entries(SIGNER_ENV)) vi.stubEnv(name, on ? value : "");
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  rows = [];
  grants = new Map([[GRANT, { workspace_key: WS, user_id: USER, client_label: "Desk agent", grantor_email: "owner@example.com", live: true }],
    [GRANT_2, { workspace_key: WS, user_id: USER, client_label: "Second agent", grantor_email: null, live: true }]]);
  seq = 0;
  calls = [];
  failCreateAfter = null;
  recordDown = false;
  storeDown = false;
  delete registry.compile_plan;
  vi.useRealTimers();
  requireFoundationSession.mockResolvedValue(session);
  requireFoundationRevokeSession.mockResolvedValue(session);
  revalidateFoundationSession.mockResolvedValue(revalidated);
  checkAccess.mockResolvedValue({ ok: true });
  getActiveWorld.mockResolvedValue({ ok: true, world: { manifestDigest: DIGEST } });
  decideLibraryLabel.mockResolvedValue({ ok: true, replayed: false });
  readLibraryDocuments.mockResolvedValue({ ok: true, documents: [], sourceVersions: { [DOC]: "a".repeat(64) } });
  stubRun.mockResolvedValue({ ok: true, jobId: "cjob-1" });
});
afterEach(() => {
  delete registry.compile_plan;
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

/*
  Updated deliberately in WO-AN-2: the public DTO now carries its own `previewDigest` (a sha256 the confirming
  client sends back), so "no sha256 anywhere" became "none of the row's internals": input digest, binding
  digest, principal, idempotency key, grant, decider.
*/
const expectNoInternals = (body: unknown) => {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/principal|idempotency|manifest|input_?sha|grant_?id|decided_?by|binding/i);
  for (const row of rows) for (const value of [row.input_sha256, row.expected_manifest_digest, row.principal_id, row.idempotency_key]) expect(text).not.toContain(value);
};

describe("POST /api/proposals", () => {
  it("creates a proposal with a dry-run preview and mutates nothing: the executor is never called", async () => {
    const response = await create(proposalBody());
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.replayed).toBe(false);
    expect(body.proposal).toMatchObject({ actionType: "library_label", state: "proposed", preview: docType, evidenceIds: ["ev-1"],
      collectionId: COLLECTION, previewDigest: digestOf(body.proposal.proposalId), resumable: false, proposer: { kind: "person" }, notes: [] });
    expectNoInternals(body);
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
    expectNoInternals(body);
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

  // Updated deliberately in WO-AN-2: no collectionId is now the workspace inbox (below); an empty or malformed one is still 400.
  it("refuses an API key (403), an empty or malformed collection (400), and a down store (503)", async () => {
    requireFoundationSession.mockResolvedValue(apiKey);
    expect((await get()).status).toBe(403);
    requireFoundationSession.mockResolvedValue(session);
    expect((await get("collectionId=")).status).toBe(400);
    expect((await get("collectionId=collection-x")).status).toBe(400);
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

  /*
    Updated deliberately in WO-AN-2 (was: "a proposal named under another collection or workspace is not found").
    The proposal is looked up by id, so the collection a body names no longer matters; another workspace is
    still not found, with the same body as an id that never existed.
  */
  it("a proposal of another workspace is not found exactly like a random id; the body's collection is ignored", async () => {
    const id = await idOf(await create(proposalBody()));
    requireFoundationSession.mockResolvedValue({ ...session, principal: { ...session.principal, workspaceKey: "pilot-other" } });
    const foreign = await confirm(id);
    const random = await decide("00000000-0000-4000-8000-0000000fffff", { decision: "confirm", previewDigest: digestOf(id) });
    expect([foreign.status, random.status]).toEqual([404, 404]);
    expect(await foreign.text()).toBe(await random.text());
    expect(decideLibraryLabel).not.toHaveBeenCalled();
    requireFoundationSession.mockResolvedValue(session);
    const answer = await decide(id, { collectionId: OTHER_COLLECTION, decision: "confirm", previewDigest: digestOf(id) });
    expect((await answer.json()).proposal.state).toBe("executed");
  });

  it.each([
    ["no decision", { collectionId: COLLECTION }],
    ["an unknown decision", { collectionId: COLLECTION, decision: "approve" }],
    // Updated deliberately in WO-AN-2: the collection is ignored now; a confirm without the preview digest is what is refused.
    ["a confirm without a preview digest", { decision: "confirm" }],
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

    // A confirm carries the digest of the preview the client rendered (WO-AN-2); a reject needs none.
    const body = c.verdict === "confirm" ? { decision: "confirm", previewDigest: digestOf(id) } : { decision: "reject" };
    const answers = await Promise.all(Array.from({ length: c.copies }, () => decide(id, { collectionId: COLLECTION, ...body })));
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

/*
  WO-AN-2 (workorders/agent-native.md §6, §7, §8): lookup by id, preview digest, agent rows, resume, the signed
  receipt, the registry and the workspace inbox. Each case names the invariant it pins.
*/
const agentLabel = (grantId = GRANT, clientKey = "client-key-0001", item: Record<string, unknown> = {}) =>
  lib.createProposal(agentActor(grantId), {
    actionType: "library_label", toolName: "propose_library_labels", clientKey, evidenceIds: [],
    raw: { collectionId: COLLECTION, input: { documentId: DOC, labelKind: "topic", labelKey: "pricing", decision: "confirmed", ...item } },
  });
const agentRow = async (grantId = GRANT) => {
  const created = await agentLabel(grantId);
  if (!created.ok) throw new Error(created.code);
  return created.row.proposal_id;
};
const agentOn = () => { vi.stubEnv("TAVONEL_AGENT_PROPOSALS_ENABLED", "true"); vi.stubEnv("TAVONEL_AGENT_PROPOSALS_COHORT", WS); stubSigner(true); };

describe("lookup by id (§5.5, §6)", () => {
  it("GET /api/proposals/[id] finds a row with no collection (a stub second type) and answers the public DTO", async () => {
    withStub();
    const row = seedRow({ action_type: "compile_plan", collection_id: null, binding_kind: "source_inventory", input: { documentIds: [DOC] } });
    const response = await readOne(row.proposal_id);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.proposal).toMatchObject({ proposalId: row.proposal_id, actionType: "compile_plan", collectionId: null,
      preview: { documentIds: [DOC], documentsTotal: 1 }, previewDigest: digestOf(row.proposal_id) });
    expectNoInternals(body);
    const answer = await confirm(row.proposal_id);
    expect((await answer.json()).proposal.state).toBe("executed");
    expect(stubRun).toHaveBeenCalledTimes(1);
    expect(rows[0]!.receipt).toMatchObject({ result: { ok: true, jobId: "cjob-1" } });
  });

  it("an unreadable, a foreign, an absent, a malformed id and a row of an unknown type are the same 404", async () => {
    const readable = await idOf(await create(proposalBody()));
    const unknown = seedRow({ action_type: "merge_documents", input: { documentIds: [DOC] } });
    const bodies: string[] = [];
    for (const id of [unknown.proposal_id, "00000000-0000-4000-8000-0000000fffff", "not-a-uuid"]) {
      const answer = await readOne(id);
      expect(answer.status).toBe(404);
      expect(answer.headers.get("cache-control")).toBe("no-store");
      bodies.push(await answer.text());
    }
    checkAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    bodies.push(await (await readOne(readable)).text());
    checkAccess.mockResolvedValue({ ok: true });
    requireFoundationSession.mockResolvedValue({ ...session, principal: { ...session.principal, workspaceKey: "pilot-other" } });
    bodies.push(await (await readOne(readable)).text());
    expect(bodies).toHaveLength(5);
    expect(new Set(bodies)).toEqual(new Set([JSON.stringify({ code: "PROPOSAL_NOT_FOUND" })]));
  });

  it("is session only, and an access check that cannot answer is a 503, never the row", async () => {
    const id = await idOf(await create(proposalBody()));
    requireFoundationSession.mockResolvedValue(apiKey);
    expect((await readOne(id)).status).toBe(403);
    requireFoundationSession.mockResolvedValue(session);
    checkAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE" });
    expect((await readOne(id)).status).toBe(503);
  });

  it("the decision and undo routes declare maxDuration = DECISION_MAX_DURATION_S", () => {
    expect(decision.maxDuration).toBe(DECISION_MAX_DURATION_S);
    expect(undo.maxDuration).toBe(DECISION_MAX_DURATION_S);
  });
});

describe("I-4: confirmation needs a signed-in session", () => {
  it.each([
    ["an agent credential (not a session JWT)", { ok: false, code: "AUTH_REQUIRED", status: 401 }, 401],
    ["a live or MCP API key", apiKey, 403],
  ])("%s at decision and undo is refused and the row stays proposed", async (_name, auth, status) => {
    const id = await idOf(await create(proposalBody()));
    requireFoundationSession.mockResolvedValue(auth);
    expect((await confirm(id)).status).toBe(status);
    expect((await undoIt(id)).status).toBe(status);
    expect(stateOf(id)).toBe("proposed");
    expect(decideCalls()).toBe(0);
  });
});

describe("I-5: the confirmed preview is this proposal's", () => {
  it("a confirm without previewDigest is 400 and nothing is decided", async () => {
    const id = await idOf(await create(proposalBody()));
    const answer = await decide(id, { decision: "confirm" });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toEqual({ code: "PROPOSAL_PREVIEW_DIGEST_REQUIRED" });
    expect(decideCalls()).toBe(0);
  });

  it.each([
    ["another proposal's digest", (_id: string, other: string): unknown => digestOf(other), 409],
    ["a hand-made digest", (): unknown => `sha256:${"f".repeat(64)}`, 409],
    ["the digest of an edited preview", (id: string): unknown => lib.proposalPreviewDigest(id, "library_label", { ...docType, labelKey: "contract" }), 409],
    ["a non-string digest", (): unknown => 42, 400],
  ])("%s is refused and the decide RPC is never called", async (_name, digest, status) => {
    const id = await idOf(await create(proposalBody()));
    const other = await idOf(await create(proposalBody(topic), "proposal-key-0002"));
    const answer = await decide(id, { decision: "confirm", previewDigest: digest(id, other) });
    expect(answer.status).toBe(status);
    expect(await answer.json()).toEqual({ code: status === 409 ? "PROPOSAL_PREVIEW_CHANGED" : "PROPOSAL_PREVIEW_DIGEST_REQUIRED" });
    expect(decideCalls()).toBe(0);
    expect(decideLibraryLabel).not.toHaveBeenCalled();
    expect(stateOf(id)).toBe("proposed");
  });

  it("a reject needs no digest", async () => {
    const id = await idOf(await create(proposalBody()));
    expect((await (await decide(id, { decision: "reject" })).json()).proposal.state).toBe("rejected");
  });
});

describe("agent-origin rows (§6 steps 3 and 7, I-11, I-14, I-27)", () => {
  it("shows the agent badge: grantor and an unverified client name, never the grant", async () => {
    const id = await agentRow();
    const body = await (await readOne(id)).json();
    expect(body.proposal.proposer).toEqual({ kind: "agent", grantedBy: "owner@example.com", clientLabel: "Desk agent", clientLabelVerified: false });
    expect(JSON.stringify(body)).not.toContain(GRANT);
    expectNoInternals(body);
    const unnamed = await agentRow(GRANT_2);
    expect((await (await readOne(unnamed)).json()).proposal.proposer.grantedBy).toBe("a member of this workspace");
  });

  it("the collection list reads an agent row again by id for its grant fields", async () => {
    await agentRow();
    const body = await (await list.GET(new Request(`https://tavonel.com/api/proposals?collectionId=${COLLECTION}`))).json();
    expect(body.proposals[0].proposer).toMatchObject({ kind: "agent", clientLabel: "Desk agent" });
  });

  it("flag off: confirming an agent row is 409 AGENT_PROPOSALS_DISABLED, nothing decided; rejecting it is 200", async () => {
    stubSigner(true);
    const id = await agentRow();
    const answer = await confirm(id);
    expect(answer.status).toBe(409);
    expect(await answer.json()).toEqual({ code: "AGENT_PROPOSALS_DISABLED" });
    expect(decideCalls()).toBe(0);
    const rejected = await decide(id, { decision: "reject" });
    expect(rejected.status).toBe(200);
    expect(stateOf(id)).toBe("rejected");
  });

  it("signer missing: 503 PROPOSAL_RECEIPT_SIGNER_NOT_CONFIGURED and the decide RPC is never called", async () => {
    vi.stubEnv("TAVONEL_AGENT_PROPOSALS_ENABLED", "true");
    vi.stubEnv("TAVONEL_AGENT_PROPOSALS_COHORT", WS);
    stubSigner(false);
    const id = await agentRow();
    const answer = await confirm(id);
    expect(answer.status).toBe(503);
    expect(await answer.json()).toEqual({ code: "PROPOSAL_RECEIPT_SIGNER_NOT_CONFIGURED" });
    expect(decideCalls()).toBe(0);
    expect(stateOf(id)).toBe("proposed");
  });

  it("a session row needs no signer and its receipt stays unsigned", async () => {
    stubSigner(false);
    const id = await idOf(await create(proposalBody()));
    expect((await (await confirm(id)).json()).proposal.state).toBe("executed");
    expect(rows[0]!.receipt).not.toHaveProperty("signedReceipt");
  });

  it("I-27: an agent row's receipt is signed under tavonel.signed_action_receipt.v1 and names no principal", async () => {
    agentOn();
    const id = await agentRow();
    const answer = await confirm(id);
    expect((await answer.json()).proposal.state).toBe("executed");
    const signed = (rows[0]!.receipt as { signedReceipt: { payloadJson: string; signature: Parameters<typeof signing.verifyExportSignature>[1] } }).signedReceipt;
    const payload = JSON.parse(signed.payloadJson);
    expect(payload).toEqual({ schemaVersion: "tavonel.action_receipt.v1", proposalId: id, actionType: "library_label",
      inputSha256: rows[0]!.input_sha256, outcome: "executed", executedAt: expect.any(String), resultRef: { replayed: false }, confirmedIn: "signed_in_session" });
    for (const secret of [USER, GRANT, rows[0]!.idempotency_key, DIGEST, digestOf(id)]) expect(signed.payloadJson).not.toContain(secret);
    const trust = signing.readExportTrustStoreEnv(SIGNER_ENV)!;
    const bytes = Buffer.from(signed.payloadJson, "utf8");
    expect(signing.verifyExportSignatureWithTrustStore(bytes, signed.signature, trust, new Date(), signing.ACTION_RECEIPT_SIGNATURE_SCOPE)).toBe(true);
    expect(signing.verifyExportSignatureWithTrustStore(bytes, signed.signature, trust, new Date(), signing.ANSWER_RECEIPT_SIGNATURE_SCOPE)).toBe(false);
  });

  it("an agent row whose receipt cannot be signed is never recorded unsigned: it stays confirmed for its confirmer to finish", async () => {
    agentOn();
    // A store answer the signer refuses to name (a malformed input digest): the effect ran, the outcome is not recorded.
    const row = seedRow({ principal_kind: "agent", agent_grant_id: GRANT, input_sha256: "sha256:not-a-digest",
      input: { ...topic, decision: "confirmed" } });
    const answer = await confirm(row.proposal_id);
    expect(answer.status).toBe(503);
    expect(await answer.json()).toEqual({ code: "PROPOSAL_OUTCOME_NOT_RECORDED" });
    expect(stateOf(row.proposal_id)).toBe("confirmed");
    expect(row.receipt).toBeNull();
  });

  it("I-11: a confirm of a row whose grant was revoked, or whose person's revision moved, is withdrawn and never executes", async () => {
    agentOn();
    const id = await agentRow();
    grants.get(GRANT)!.live = false;
    const answer = await confirm(id);
    expect(answer.status).toBe(200);
    expect((await answer.json()).proposal).toMatchObject({ state: "withdrawn", resumable: false, previewDigest: null });
    expect(rows[0]!.decided_by).toBeNull();
    expect(decideLibraryLabel).not.toHaveBeenCalled();
    expect((await confirm(id)).status).toBe(409);
  });

  it("I-14: the same client key under two grants is two rows; a person's agt_ key is 400; another principal's replay is 409", async () => {
    const one = await agentLabel(GRANT, "client-key-0001");
    const two = await agentLabel(GRANT_2, "client-key-0001");
    expect(one.ok && two.ok && one.row.proposal_id !== two.row.proposal_id).toBe(true);
    expect(rows.map((row) => row.idempotency_key.length)).toEqual([47, 47]);
    const long = await agentLabel(GRANT, "k".repeat(128));
    expect(long.ok && long.row.idempotency_key).toMatch(/^agt_[A-Za-z0-9_-]{43}$/);
    const personal = await create(proposalBody(), `agt_${"x".repeat(43)}`);
    expect(personal.status).toBe(400);
    await create(proposalBody(), "shared-key-0001");
    requireFoundationSession.mockResolvedValue(otherPerson);
    const crossed = await create(proposalBody(), "shared-key-0001");
    expect(crossed.status).toBe(409);
    expect(await crossed.json()).toEqual({ code: "PROPOSAL_IDEMPOTENCY_CONFLICT" });
  });

  it("an agent's access failure folds into the same not-found as a document with no label, and nothing is created", async () => {
    checkAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    const denied = await agentLabel();
    checkAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE" });
    const unavailable = await agentLabel();
    checkAccess.mockResolvedValue({ ok: true });
    readLibraryDocuments.mockResolvedValue({ ok: true, documents: [], sourceVersions: {} });
    const unknown = await agentLabel();
    for (const answer of [denied, unavailable, unknown]) expect(answer).toEqual({ ok: false, code: "PROPOSAL_TARGET_NOT_FOUND", status: 404 });
    expect(createCalls()).toBe(0);
  });

  it("an agent names no source version: the server fills the Library's; one it names is refused", async () => {
    const created = await agentLabel();
    expect(created.ok && created.row.input).toEqual({ documentId: DOC, sourceVersionId: "a".repeat(64), labelKind: "topic", labelKey: "pricing", decision: "confirmed" });
    expect(await agentLabel(GRANT, "client-key-0002", { sourceVersionId: "b".repeat(64) })).toEqual({ ok: false, code: "PROPOSAL_REQUEST_INVALID", status: 400 });
  });

  it("an expected Active digest that is not the current one is PROPOSAL_BASE_NOT_HEAD, no row", async () => {
    const answer = await lib.createProposal(agentActor(), {
      actionType: "library_label", toolName: "propose_library_labels", clientKey: "client-key-0001", evidenceIds: [],
      raw: { collectionId: COLLECTION, expectedManifestDigest: MOVED, input: { documentId: DOC, labelKind: "topic", labelKey: "pricing", decision: "confirmed" } },
    });
    expect(answer).toEqual({ ok: false, code: "PROPOSAL_BASE_NOT_HEAD", status: 409 });
    expect(createCalls()).toBe(0);
  });
});

describe("I-9: a crash between execution and record is recoverable by its confirmer", () => {
  const confirmedThenCrashed = async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T12:00:00.000Z"));
    const id = await idOf(await create(proposalBody()));
    recordDown = true;
    const first = await confirm(id);
    expect(first.status).toBe(503);
    expect(stateOf(id)).toBe("confirmed");
    recordDown = false;
    return id;
  };

  it("the same person after PROPOSAL_RESUME_AFTER_MS runs it again under the same key and it is recorded executed", async () => {
    const id = await confirmedThenCrashed();
    vi.setSystemTime(Date.now() + PROPOSAL_RESUME_AFTER_MS);
    expect((await (await readOne(id)).json()).proposal.resumable).toBe(true);
    const finish = await decide(id, { decision: "confirm" });
    expect(finish.status).toBe(200);
    expect((await finish.json()).proposal).toMatchObject({ state: "executed", resumable: false });
    expect(decideLibraryLabel.mock.calls.map((call) => call[1].idempotencyKey)).toEqual([id, id]);
    expect(decideCalls()).toBe(1);
  });

  it("one millisecond younger is 409 and nothing runs again", async () => {
    const id = await confirmedThenCrashed();
    vi.setSystemTime(Date.now() + PROPOSAL_RESUME_AFTER_MS - 1);
    expect((await (await readOne(id)).json()).proposal.resumable).toBe(false);
    const early = await decide(id, { decision: "confirm" });
    expect(early.status).toBe(409);
    expect(await early.json()).toEqual({ code: "PROPOSAL_NOT_DECIDABLE" });
    expect(decideLibraryLabel).toHaveBeenCalledTimes(1);
  });

  it("another person, however late, is 409 and sees no Finish", async () => {
    const id = await confirmedThenCrashed();
    vi.setSystemTime(Date.now() + 10 * PROPOSAL_RESUME_AFTER_MS);
    requireFoundationSession.mockResolvedValue(otherPerson);
    revalidateFoundationSession.mockResolvedValue(otherPerson);
    expect((await (await readOne(id)).json()).proposal.resumable).toBe(false);
    expect((await decide(id, { decision: "confirm" })).status).toBe(409);
    expect(decideLibraryLabel).toHaveBeenCalledTimes(1);
  });

  it("a resume that loses the record race answers the stored row", async () => {
    const id = await confirmedThenCrashed();
    vi.setSystemTime(Date.now() + PROPOSAL_RESUME_AFTER_MS);
    decideLibraryLabel.mockImplementation(async () => { rows[0]!.state = "executed"; return { ok: true, replayed: true }; });
    const finish = await decide(id, { decision: "confirm" });
    expect(finish.status).toBe(200);
    expect((await finish.json()).proposal.state).toBe("executed");
  });
});

describe("I-16 and the registry: what the viewer cannot read or the server cannot handle is hidden", () => {
  it("a row of an unknown action type is not listed and cannot be confirmed or undone", async () => {
    const unknown = seedRow({ action_type: "merge_documents", input: { documentIds: [DOC] } });
    const executed = seedRow({ action_type: "merge_documents", input: { documentIds: [DOC] }, state: "executed", decided_at: new Date().toISOString(), decided_by: USER });
    const page = await (await list.GET(new Request("https://tavonel.com/api/proposals"))).json();
    expect(page.proposals).toEqual([]);
    const answer = await decide(unknown.proposal_id, { decision: "confirm", previewDigest: `sha256:${"0".repeat(64)}` });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toEqual({ code: "PROPOSAL_INPUT_INVALID" });
    expect((await undoIt(executed.proposal_id)).status).toBe(400);
    expect(decideCalls()).toBe(0);
  });

  it("a type whose documentsOf is empty is hidden, never shown as touching nothing", async () => {
    withStub(() => []);
    seedRow({ action_type: "compile_plan", collection_id: null, binding_kind: "source_inventory", input: { documentIds: [DOC] } });
    const page = await (await list.GET(new Request("https://tavonel.com/api/proposals"))).json();
    expect(page.proposals).toEqual([]);
    expect(checkAccess).not.toHaveBeenCalled();
  });

  it("access is checked on every document of a row, in one call: the second unreadable one hides it", async () => {
    const DOC_B = "0b000000-0000-4000-8000-00000000000b";
    withStub();
    const row = seedRow({ action_type: "compile_plan", collection_id: null, binding_kind: "source_inventory", input: { documentIds: [DOC, DOC_B] } });
    checkAccess.mockImplementation(async (_ws, ids) => ids.includes(DOC_B) ? { ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" } : { ok: true });
    const page = await (await list.GET(new Request("https://tavonel.com/api/proposals"))).json();
    expect(page.proposals).toEqual([]);
    expect(checkAccess.mock.calls.map((call) => call[1])).toEqual([[DOC, DOC_B]]);
    expect((await confirm(row.proposal_id)).status).toBe(403);
    expect(stubRun).not.toHaveBeenCalled();
  });

  it("a type without an undo is not undoable", async () => {
    withStub();
    const row = seedRow({ action_type: "compile_plan", collection_id: null, binding_kind: "source_inventory", input: { documentIds: [DOC] },
      state: "executed", decided_at: new Date().toISOString(), decided_by: USER });
    const answer = await undoIt(row.proposal_id);
    expect(answer.status).toBe(409);
    expect(await answer.json()).toEqual({ code: "PROPOSAL_NOT_UNDOABLE" });
  });
});

describe("I-15 and edit 14: createProposalBatch", () => {
  const items = (n: number, bad?: number) => Array.from({ length: n }, (_, index) => ({
    actionType: "library_label", toolName: "propose_library_labels", clientKey: "batch-key-0001", evidenceIds: [],
    raw: { collectionId: COLLECTION, input: { documentId: DOC, labelKind: "topic", labelKey: index === bad ? "a\nb" : `topic-${index}`, decision: "confirmed" } },
  }));

  it("one bad item of 25 refuses the whole batch with no create call", async () => {
    expect(await lib.createProposalBatch(agentActor(), items(25, 24))).toEqual({ ok: false, code: "PROPOSAL_REQUEST_INVALID", status: 400 });
    expect(createCalls()).toBe(0);
    expect(rows).toHaveLength(0);
  });

  it("an empty batch and a batch of 26 are refused before anything", async () => {
    expect((await lib.createProposalBatch(agentActor(), [])).ok).toBe(false);
    expect((await lib.createProposalBatch(agentActor(), items(26))).ok).toBe(false);
    expect(createCalls()).toBe(0);
  });

  it("a store failure at item k leaves 0..k-1; a retry with the same client key replays them and completes", async () => {
    failCreateAfter = 3;
    expect(await lib.createProposalBatch(agentActor(), items(6))).toEqual({ ok: false, code: "PROPOSAL_OPEN_LIMIT", status: 429 });
    expect(rows).toHaveLength(3);
    failCreateAfter = null;
    calls = [];
    const retry = await lib.createProposalBatch(agentActor(), items(6));
    expect(retry.ok).toBe(true);
    expect(retry.ok && retry.created.map((item) => item.replayed)).toEqual([true, true, true, false, false, false]);
    expect(rows.map((row) => (row.input as { labelKey: string }).labelKey)).toEqual(items(6).map((_, index) => `topic-${index}`));
  });

  it("I-13 half: the first insert reserves room for the whole batch, so a batch of 3 at 198 open is refused with 0 rows", async () => {
    for (let index = 0; index < 198; index += 1) seedRow({ principal_kind: "agent", agent_grant_id: GRANT_2, idempotency_key: `agt_open_${index}` });
    const before = rows.length;
    expect(await lib.createProposalBatch(agentActor(), items(3))).toEqual({ ok: false, code: "PROPOSAL_OPEN_LIMIT", status: 429 });
    expect(rows).toHaveLength(before);
  });
});

describe("GET /api/proposals without a collection: the workspace inbox, filtered before paging", () => {
  const DOC_B = "0b000000-0000-4000-8000-00000000000b";
  const page = async (cursor?: string) => (await list.GET(new Request(`https://tavonel.com/api/proposals${cursor ? `?cursor=${cursor}` : ""}`))).json();

  it("fills each page with readable rows across store pages, and the cursor resumes exactly after the last row returned", async () => {
    // 120 rows, every third one unreadable, so the page fills in the middle of a store page; created_at differs
    // only in microseconds, so a millisecond cursor would skip rows.
    for (let index = 0; index < 120; index += 1) seedRow({ input: { ...docType, documentId: index % 3 === 1 ? DOC_B : DOC } });
    checkAccess.mockImplementation(async (_ws, ids) => ids.includes(DOC_B) ? { ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" } : { ok: true });
    const first = await page();
    expect(first.proposals).toHaveLength(50);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await page(first.nextCursor);
    expect(second.proposals).toHaveLength(30);
    expect(second.nextCursor).toBeNull();
    const seen = [...first.proposals, ...second.proposals].map((p: { proposalId: string }) => p.proposalId);
    const expected = rows.filter((_, index) => index % 3 !== 1).map((row) => row.proposal_id).reverse();
    expect(seen).toEqual(expected);
  });

  it("a row the registry cannot handle takes no page slot: the page is filled with rows the viewer is shown", async () => {
    for (let index = 0; index < 70; index += 1) {
      seedRow(index % 7 === 3 ? { action_type: "merge_documents", input: { documentIds: [DOC] } } : {});
    }
    const first = await page();
    expect(first.proposals).toHaveLength(50);
    expect(first.proposals.every((p: { actionType: string }) => p.actionType === "library_label")).toBe(true);
    const second = await page(first.nextCursor);
    expect(first.proposals.length + second.proposals.length).toBe(60);
  });

  it("stops after AGENT_ACL_SCAN_PAGES store pages and hands back the store position", async () => {
    for (let index = 0; index < 260; index += 1) seedRow({ input: { ...docType, documentId: DOC_B } });
    checkAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    const first = await page();
    expect(first.proposals).toEqual([]);
    expect(calls.filter((call) => call === "list_world_change_proposals_page")).toHaveLength(4);
    expect(Buffer.from(first.nextCursor, "base64url").toString("utf8")).toBe(`${rows[60]!.created_at}|${rows[60]!.proposal_id}`);
  });

  it.each([["not base64url", "%%%"], ["no separator", Buffer.from("abc").toString("base64url")],
    ["a bad id", Buffer.from(`${createdAt(1)}|nope`).toString("base64url")], ["a bad time", Buffer.from(`yesterday|${DOC}`).toString("base64url")]])(
    "a cursor with %s is 400", async (_name, cursor) => {
      const answer = await list.GET(new Request(`https://tavonel.com/api/proposals?cursor=${encodeURIComponent(cursor)}`));
      expect(answer.status).toBe(400);
      expect(calls).not.toContain("list_world_change_proposals_page");
    });
});

/*
  Generated inputs (seeded, so a failure names its case): the two things a client sends that this work order
  parses -- the decision body and the inbox cursor. Whatever arrives, the answer is a 4xx or the decision, never
  a 5xx or a throw, and nothing is decided unless the body carries this proposal's exact preview digest.
*/
describe("fuzz: decision bodies and cursors", () => {
  const random = (seed: number) => () => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed / 2_147_483_648; };
  const pick = <T,>(next: () => number, values: readonly T[]) => values[Math.floor(next() * values.length)]!;
  const junk = (next: () => number): unknown => pick(next, [
    undefined, null, true, 0, -1, 1e309, "", "confirm", "reject", "CONFIRM", " confirm", `sha256:${"0".repeat(64)}`, "sha256:", "agt_x",
    [], ["confirm"], {}, { decision: "confirm" }, "\u0000", "x".repeat(9000), Number.NaN,
  ]);

  it("400 cases of decision bodies: never 5xx, and only this proposal's digest decides", async () => {
    const next = random(20261117);
    for (let index = 0; index < 400; index += 1) {
      rows = [];
      calls = [];
      const id = await idOf(await create(proposalBody(), `fuzz-key-${index}`));
      const right = next() < 0.25;
      const body: Record<string, unknown> = { decision: next() < 0.6 ? "confirm" : junk(next), previewDigest: right ? digestOf(id) : junk(next) };
      if (next() < 0.3) body.collectionId = junk(next);
      if (next() < 0.2) body.extra = junk(next);
      const answer = await decide(id, body);
      const label = `case ${index}: ${JSON.stringify(body).slice(0, 120)}`;
      expect(answer.status, label).toBeLessThan(500);
      // A reject needs no digest; a confirm decides only with this proposal's own; a body over 8 KiB is refused whole.
      const fits = JSON.stringify(body).length <= 8192;
      const confirmed = fits && body.decision === "confirm" && right;
      const rejected = fits && body.decision === "reject";
      expect(decideCalls(), label).toBe(confirmed || rejected ? 1 : 0);
      expect(stateOf(id), label).toBe(confirmed ? "executed" : rejected ? "rejected" : "proposed");
    }
  });

  it("400 cases of cursors: a valid page or 400, never 5xx, and the store is not paged on a 400", async () => {
    for (let index = 0; index < 30; index += 1) seedRow({});
    const next = random(17);
    const alphabet = "AZaz09-_+/=|.:T%é ";
    for (let index = 0; index < 400; index += 1) {
      calls = [];
      const raw = Array.from({ length: Math.floor(next() * 90) }, () => alphabet[Math.floor(next() * alphabet.length)]).join("");
      const text = next() < 0.5 ? raw : Buffer.from(next() < 0.5 ? raw : `${createdAt(Math.floor(next() * 40))}|${rows[Math.floor(next() * rows.length)]!.proposal_id}${raw.slice(0, 2)}`).toString("base64url");
      const answer = await list.GET(new Request(`https://tavonel.com/api/proposals?cursor=${encodeURIComponent(text)}`));
      expect([200, 400], `case ${index}: ${text}`).toContain(answer.status);
      if (answer.status === 400) expect(calls, `case ${index}`).not.toContain("list_world_change_proposals_page");
    }
  });
});

describe("WO-AN-10: the audit people see", () => {
  const getReceipt = (id: string) => receiptRoute.GET(new Request(`https://tavonel.com/api/proposals/${id}/receipt`), { params: Promise.resolve({ id }) });
  const getActivity = (id: string, query = "") =>
    activityRoute.GET(new Request(`https://tavonel.com/api/agent-grants/${id}/activity${query}`), { params: Promise.resolve({ id }) });
  const RANDOM = "00000000-0000-4000-8000-0000000000ff";
  const SIGNED = { payloadJson: "{}", signature: { keyId: "k" } };
  /** A real confirmation through the real signer: the receipt this stores is the one the route must serve. */
  const confirmedAgentRow = async () => {
    agentOn();
    const id = await agentRow();
    expect((await (await confirm(id)).json()).proposal.state).toBe("executed");
    return id;
  };

  it("serves exactly the stored signed receipt, as an attachment, and it verifies offline", async () => {
    const id = await confirmedAgentRow();
    const answer = await getReceipt(id);
    expect(answer.status).toBe(200);
    expect(answer.headers.get("cache-control")).toBe("no-store");
    expect(answer.headers.get("content-disposition")).toBe(`attachment; filename="receipt-${id}.json"`);
    const served = await answer.json() as { payloadJson: string; signature: Parameters<typeof signing.verifyExportSignature>[1] };
    expect(served).toEqual((rows[0]!.receipt as { signedReceipt: unknown }).signedReceipt);
    const trust = signing.readExportTrustStoreEnv(SIGNER_ENV)!;
    expect(signing.verifyExportSignatureWithTrustStore(Buffer.from(served.payloadJson, "utf8"), served.signature, trust, new Date(), signing.ACTION_RECEIPT_SIGNATURE_SCOPE)).toBe(true);
    // The outcome record names the person who decided; only the signed part leaves.
    expect(JSON.stringify(served)).not.toContain(USER);
  });

  it("an undone agent row still serves the receipt of its execution", async () => {
    const id = await confirmedAgentRow();
    expect((await undoIt(id)).status).toBe(200);
    expect(stateOf(id)).toBe("undone");
    const answer = await getReceipt(id);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual((rows[0]!.receipt as { executed: { signedReceipt: unknown } }).executed.signedReceipt);
  });

  it("absent, malformed, foreign, unreadable, proposed and unsigned rows are the same 404 body", async () => {
    const proposed = await agentRow();
    const unsigned = seedRow({ state: "executed", receipt: { result: { ok: true } } });
    const foreign = seedRow({ workspace_key: "pilot-other0000000001", state: "executed", principal_kind: "agent", agent_grant_id: GRANT, receipt: { signedReceipt: SIGNED } });
    const signed = seedRow({ state: "executed", principal_kind: "agent", agent_grant_id: GRANT, receipt: { signedReceipt: SIGNED } });
    // A receipt on a row that has not reached an outcome is never served, whatever the store holds.
    const early = ["confirmed", "rejected", "stale", "withdrawn"].map((state) => seedRow({ state, principal_kind: "agent", agent_grant_id: GRANT, receipt: { signedReceipt: SIGNED } }).proposal_id);
    const absent = await getReceipt(RANDOM);
    expect(absent.status).toBe(404);
    const reference = await absent.text();
    for (const id of [proposed, ...early, unsigned.proposal_id, foreign.proposal_id, "not-a-uuid", "x\r\nSet-Cookie: a=b"]) {
      const answer = await getReceipt(id);
      expect([id, answer.status]).toEqual([id, 404]);
      expect(await answer.text()).toBe(reference);
      expect(answer.headers.get("content-disposition")).toBeNull();
    }
    expect((await getReceipt(signed.proposal_id)).status).toBe(200);
    checkAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    const unreadable = await getReceipt(signed.proposal_id);
    expect([unreadable.status, await unreadable.text()]).toEqual([404, reference]);
    checkAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE" });
    expect((await getReceipt(signed.proposal_id)).status).toBe(503);
  });

  it("refuses an API key (403) and an agent credential (401); no store read happens", async () => {
    const id = await confirmedAgentRow();
    calls = [];
    requireFoundationSession.mockResolvedValue(apiKey);
    expect((await getReceipt(id)).status).toBe(403);
    requireFoundationSession.mockResolvedValue({ ok: false, code: "AUTH_REQUIRED", status: 401 });
    expect((await getReceipt(id)).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("the row says who decided without naming anyone, and offers the receipt only where one is stored", async () => {
    const id = await confirmedAgentRow();
    const mine = (await (await readOne(id)).json()).proposal;
    expect(mine).toMatchObject({ state: "executed", youDecided: true, receiptAvailable: true });
    expectNoInternals(mine);
    requireFoundationSession.mockResolvedValue(otherPerson);
    expect((await (await readOne(id)).json()).proposal).toMatchObject({ youDecided: false, receiptAvailable: true });
    requireFoundationSession.mockResolvedValue(session);
    const open = await agentRow(GRANT_2);
    expect((await (await readOne(open)).json()).proposal).toMatchObject({ state: "proposed", youDecided: null, receiptAvailable: false });
    const person = await idOf(await create(proposalBody(topic), "proposal-key-0002"));
    await confirm(person);
    expect((await (await readOne(person)).json()).proposal).toMatchObject({ state: "executed", youDecided: true, receiptAvailable: false });
  });

  it("activity lists only this grant's rows, newest first, with no preview, document, principal or digest", async () => {
    agentOn();
    const first = await agentRow();
    const other = await agentRow(GRANT_2);
    const made = await agentLabel(GRANT, "client-key-0002");
    if (!made.ok) throw new Error(made.code);
    const third = made.row.proposal_id;
    await confirm(first);
    const answer = await getActivity(GRANT);
    expect(answer.status).toBe(200);
    expect(answer.headers.get("cache-control")).toBe("no-store");
    const body = await answer.json() as { activity: Record<string, unknown>[]; nextCursor: string | null };
    expect(body.activity.map((row) => row.proposalId)).toEqual([third, first]);
    expect(body.activity.map((row) => row.proposalId)).not.toContain(other);
    expect(body.activity[1]).toEqual({ proposalId: first, actionType: "library_label", state: "executed", createdAt: expect.any(String), decidedAt: expect.any(String), receiptAvailable: true });
    expect(Object.keys(body.activity[0]!).sort()).toEqual(["actionType", "createdAt", "decidedAt", "proposalId", "receiptAvailable", "state"]);
    expect(body.nextCursor).toBeNull();
    const text = JSON.stringify(body);
    for (const secret of [DOC, USER, GRANT, DIGEST]) expect(text).not.toContain(secret);
  });

  it("another person's grant, another workspace's, an unknown and a malformed id are the same 404; a revoked grant still reads", async () => {
    await agentRow();
    const unknown = await getActivity(RANDOM);
    expect(unknown.status).toBe(404);
    const reference = await unknown.text();
    requireFoundationRevokeSession.mockResolvedValue(otherPerson);
    for (const id of [GRANT, "not-a-uuid"]) {
      const answer = await getActivity(id);
      expect([id, answer.status, await answer.text()]).toEqual([id, 404, reference]);
    }
    requireFoundationRevokeSession.mockResolvedValue({ ...session, principal: { ...session.principal, workspaceKey: "pilot-other0000000001" } });
    expect((await getActivity(GRANT)).status).toBe(404);
    requireFoundationRevokeSession.mockResolvedValue(session);
    grants.get(GRANT)!.live = false;
    expect(((await (await getActivity(GRANT)).json()) as { activity: unknown[] }).activity).toHaveLength(1);
  });

  it("refuses without a session, and a store that cannot answer is a 503, never an empty list", async () => {
    requireFoundationRevokeSession.mockResolvedValue({ ok: false, code: "AUTH_REQUIRED", status: 401 });
    expect((await getActivity(GRANT)).status).toBe(401);
    requireFoundationRevokeSession.mockResolvedValue(session);
    storeDown = true;
    expect((await getActivity(GRANT)).status).toBe(503);
  });

  it("rows the viewer can no longer read are dropped before the page is cut", async () => {
    await agentRow();
    checkAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    expect(((await (await getActivity(GRANT)).json()) as { activity: unknown[] }).activity).toEqual([]);
    checkAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE" });
    expect((await getActivity(GRANT)).status).toBe(503);
  });

  it("pages by cursor, and the NDJSON export of each page is exactly the listed rows", async () => {
    for (let index = 0; index < 55; index += 1) seedRow({ principal_kind: "agent", agent_grant_id: GRANT, state: "proposed" });
    seedRow({ principal_kind: "agent", agent_grant_id: GRANT_2 });
    const one = await (await getActivity(GRANT)).json() as { activity: { proposalId: string }[]; nextCursor: string };
    expect(one.activity).toHaveLength(50);
    expect(typeof one.nextCursor).toBe("string");
    const exported = await getActivity(GRANT, "?format=ndjson");
    expect(exported.headers.get("content-type")).toContain("application/x-ndjson");
    expect(exported.headers.get("content-disposition")).toBe(`attachment; filename="agent-activity-${GRANT}.ndjson"`);
    expect(exported.headers.get("x-next-cursor")).toBe(one.nextCursor);
    const text = await exported.text();
    expect(text.endsWith("\n")).toBe(true);
    expect(text.trimEnd().split("\n").map((line) => JSON.parse(line))).toEqual(one.activity);
    const two = await (await getActivity(GRANT, `?cursor=${encodeURIComponent(one.nextCursor)}`)).json() as { activity: { proposalId: string }[]; nextCursor: string | null };
    expect(two.activity).toHaveLength(5);
    expect(two.nextCursor).toBeNull();
    const rest = await getActivity(GRANT, `?format=ndjson&cursor=${encodeURIComponent(one.nextCursor)}`);
    expect(rest.headers.get("x-next-cursor")).toBeNull();
    expect((await rest.text()).trimEnd().split("\n").map((line) => JSON.parse(line))).toEqual(two.activity);
    expect(new Set([...one.activity, ...two.activity].map((row) => row.proposalId)).size).toBe(55);
  });

  it("an unknown format or a bad cursor is 400 and reads nothing", async () => {
    await agentRow();
    calls = [];
    for (const query of ["?format=csv", "?format=", "?cursor=!!"]) {
      const answer = await getActivity(GRANT, query);
      expect([query, answer.status]).toEqual([query, 400]);
    }
    expect(calls).not.toContain("list_world_change_proposals_page");
  });
});
