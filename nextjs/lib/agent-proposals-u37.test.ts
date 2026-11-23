import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileCollectionCandidate, type CollectionOcrInput } from "./collection-compiler";

/*
  U37, local half (WO-AN-9; [MP 246]): "granted/denied/duplicate/expired/stale/revoked/host-incompatible dry run +
  confirm; no mutation by old read bridge; authorized action receipt and undo".

  A generator over {condition} x {dry run (propose), confirm} x {compile_plan, library_label, ontology_label_patch}
  (102 rows). Each row names its expected HTTP status and code, the state its proposal ends in, and the effects
  that happened. A dry run goes through POST /api/agent-mcp with authorizeAgentRequest REAL (key, grant, pilot,
  membership, owner grant, rate window answered by the transport below); a confirmation goes through
  POST /api/proposals/[id]/decision with decideProposal, the three executors' prepare/binding/preconditions/run and
  the action-receipt signing REAL. Faked: the PostgREST transport (supabaseAdminRequest), the R2 primitives, the
  reader modules the agent security suite fakes, the compile route the compile executor posts to, and the session
  (requireFoundationSession / revalidateFoundationSession answer a chosen principal).

  The transport's proposal RPCs answer as supabase/migrations/20261117130000_agent_proposals.sql does; that
  emulation is this file's, so the store's own behaviour on the DB clock (expiry, revoke mid-flight, replay
  across principals) is proved on a real PostgreSQL by scripts/db/agent-u37-db.mjs, not here.

  "Host-incompatible" here is local: six request shapes a host that does not speak this endpoint's MCP sends.
  Real hosts are WO-AN-13. Nothing here marks U37.
*/

type Row = Record<string, unknown>;
type ActionType = "compile_plan" | "library_label" | "ontology_label_patch";

const PERSON = "7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a";
const OTHER_PERSON = "7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b";
/** The workspace a pilot key of PERSON authenticates into (foundationWorkspaceId). */
const WS = `pilot-${PERSON.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}`;
const GRANT = "9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a";
const GRANT_2 = "9b9b9b9b-9b9b-4b9b-8b9b-9b9b9b9b9b9b";
const PREFIX = "p".repeat(12);
const PREFIX_2 = "q".repeat(12);
const TOKEN = `tvnl_agt_${PREFIX}_${"s".repeat(43)}`;
const TOKEN_2 = `tvnl_agt_${PREFIX_2}_${"s".repeat(43)}`;
const uuid = (n: number) => `0a000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const DOC_A = uuid(10);
const DOC_B = uuid(11);
const DOC_HIDDEN = uuid(12);
const COLLECTION = `collection-${"c".repeat(32)}`;
const COLLECTION_HIDDEN = `collection-${"d".repeat(32)}`;
const ACTIVE = `sha256:${"a".repeat(64)}`;
const HIDDEN_DIGEST = `sha256:${"b".repeat(64)}`;
const JOB = `cjob-${"1".repeat(32)}`;

function ocr(documentId: string, digest: string, text: string): CollectionOcrInput {
  return {
    documentId, versionKey: digest, sanitizedKey: `immutable/${WS}/${WS}/${documentId}/${digest}/sanitized.pdf`,
    ocrJsonKey: `immutable/${WS}/${WS}/${documentId}/${digest}/ocr.json`, pageCount: 1, text, inputSha256: `sha256:${digest}`,
    sourceImmutableKey: `immutable/${WS}/${WS}/${documentId}/${digest}/sanitized.pdf`,
    regions: [{ regionId: `${documentId}-p1-b1`, pageIndex0: 0, pageNumber1: 1, order: 0, blockType: "paragraph", text,
      bbox1000: [80, 120, 920, 320], confidence: 0.99, authority: "contractual" }],
  };
}
const ARTIFACT = compileCollectionCandidate([
  ocr(DOC_A, "a".repeat(64), "ACME Corporaton shall pay every valid invoice within 30 calendar days."),
  ocr(DOC_B, "b".repeat(64), "ACME Corporaton requires written approval before changing payment terms."),
]);
const CANDIDATE = ARTIFACT.manifestDigest;
const EDITABLE = ARTIFACT.ontology.nodes.find((node) => node.kind === "Entity" || node.kind === "Topic" || node.kind === "Claim")!;
const EVIDENCE = { id: "ev-1", sourceId: DOC_A, sourceVersionId: "a".repeat(64), page: 1, bbox: [80, 120, 920, 320] };

// ---------------------------------------------------------------------------------------------------------------
// The fake workspace
// ---------------------------------------------------------------------------------------------------------------

type Key = { grantId: string; scopes: string[]; expiresAt: string };
let keys: Map<string, Key>;
let grantRevokedAt: Map<string, string | null>;
let member: { state: string; revision: number };
let unreadable: Set<string>;
let inventory: Map<string, string>;
let actives: Map<string, string>;
let corrections: { base: string; result: string }[];
let proposals: Map<string, Row>;
let nextId: number;
/** Every effect an executor had, in order: what a confirmation changes outside the proposal row. */
let effects: string[];
/** The rows decide_library_label was asked for (the library_label executor's run and undo). */
let libraryDecisions: Row[];

function reset() {
  keys = new Map([[PREFIX, { grantId: GRANT, scopes: ["agent:read", "agent:propose"], expiresAt: "2099-01-01T00:00:00Z" }],
    [PREFIX_2, { grantId: GRANT_2, scopes: ["agent:read", "agent:propose"], expiresAt: "2099-01-01T00:00:00Z" }]]);
  grantRevokedAt = new Map([[GRANT, null], [GRANT_2, null]]);
  member = { state: "active", revision: 3 };
  unreadable = new Set([DOC_HIDDEN]);
  inventory = new Map([[DOC_A, "a".repeat(64)], [DOC_B, "b".repeat(64)], [DOC_HIDDEN, "c".repeat(64)]]);
  actives = new Map([[COLLECTION, ACTIVE], [COLLECTION_HIDDEN, HIDDEN_DIGEST]]);
  corrections = [];
  proposals = new Map();
  nextId = 0;
  effects = [];
  libraryDecisions = [];
}

/** The grant is live as the store's decide reads it: not revoked, and its person's membership active at its revision (3). */
const grantLive = (grantId: string | null) => grantId !== null && grantRevokedAt.get(grantId) === null && member.state === "active" && member.revision === 3;

const checkAccess = async (_ws: string, ids: string[]) =>
  ids.some((id) => unreadable.has(id)) ? { ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" } : { ok: true };
const postCompile = vi.fn(async () => {
  effects.push("compile_post");
  return new Response(JSON.stringify({ code: "COMPILE_JOB_ACCEPTED", jobId: JOB }), { status: 202 });
});
/** What requireFoundationSession answers for the decision and undo routes. */
let sessionAnswer: unknown;
const personSession = (userId = PERSON) => ({ ok: true, principal: { kind: "session", workspaceKey: WS, userId, scopes: [],
  authorizationRevision: 3, workspaceRole: "owner", accessSource: "pilot" } });

const R2_ANSWERS: Record<string, (...args: never[]) => unknown> = {
  readR2SignerEnv: () => ({ bucket: "b" }),
  listImmutableWorkspaceObjects: async () => ({ ok: true, objects: [...inventory].map(([id, version]) => ({
    key: `immutable/${WS}/${WS}/${id}/${version}/sanitized.pdf`, size: 10, lastModified: "2026-11-16T10:00:00.000Z" })) }),
  getWorkspaceCollectionCandidate: async () => ({ ok: true, json: structuredClone(ARTIFACT) }),
  listFoundationQuarantineRejects: async () => ({ ok: true, documentIds: [], storedDocumentIds: [], truncated: false }),
  putWorkspaceCollectionCandidate: async () => { effects.push("r2_put"); return { ok: true }; },
};
function recorded(module: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(module).map(([name, value]) => [name, typeof value !== "function" ? value : (...args: never[]) => {
    if (Object.hasOwn(R2_ANSWERS, name)) return R2_ANSWERS[name]!(...args);
    effects.push(`r2_unexpected:${name}`);
    return Promise.resolve({ ok: false, code: "TEST_R2_NOT_ANSWERED" });
  }]));
}

vi.mock("@/lib/r2-objects", async (original) => recorded(await original<Record<string, unknown>>()));
vi.mock("@/lib/r2-synthetic-canary", async (original) => recorded(await original<Record<string, unknown>>()));
vi.mock("@/lib/collection-storage", () => ({
  loadPreferredCollectionCandidate: async () => ({ ok: true, value: { key: "k", artifact: structuredClone(ARTIFACT) } }),
}));
vi.mock("@/lib/developer-auth", async (original) => ({
  ...await original<typeof import("./developer-auth")>(),
  requireFoundationSession: async () => sessionAnswer,
  revalidateFoundationSession: async (_request: Request, principal: unknown) => ({ ok: true, principal }),
}));
vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccessForViewer: checkAccess, checkConnectorSourceAccess: checkAccess }));
vi.mock("@/app/api/compile-jobs/route", () => ({ POST: postCompile }));
vi.mock("@/lib/customer-data-admission", async (original) => ({
  ...await original<typeof import("./customer-data-admission")>(), canAdmitCustomerSource: async () => true }));
vi.mock("@/lib/customer-source-scope", () => ({ readCustomerSourceScope: async () => ({ ok: true, scope: "direct_upload" }) }));
vi.mock("@/lib/derived-data-admission", async (original) => ({
  ...await original<typeof import("./derived-data-admission")>(), admitsDerivedCustomerData: async () => true }));
vi.mock("@/lib/world-store", async (original) => ({
  ...await original<typeof import("./world-store")>(),
  listFoundationActiveWorlds: async () => ({ ok: true, nextCursor: null,
    worlds: [...actives].map(([collectionId, manifestDigest]) => ({ collectionId, manifestDigest, revision: 2, updatedAt: "2026-11-17T00:00:00Z" })) }),
  getFoundationActiveWorld: async (_ws: string, collectionId: string) => {
    const digest = actives.get(collectionId);
    return digest ? { ok: true, world: { collectionId, manifestDigest: digest, revision: 2 } } : { ok: false, code: "ACTIVE_WORLD_NOT_FOUND" };
  },
}));
vi.mock("@/lib/world-read-model", () => ({
  loadWorldReadModel: async (_ws: string, _collection: string, digest: string) => ({ ok: true, model: { world: { manifestDigest: digest },
    evidence: [EVIDENCE], objects: [{ id: EDITABLE.id, type: EDITABLE.kind, label: EDITABLE.label, evidenceRefs: ["ev-1"] }] } }),
}));
vi.mock("@/lib/customer-source-lifecycle", async (original) => ({
  ...await original<typeof import("./customer-source-lifecycle")>(),
  readTombstonedUploadDocumentIds: async () => ({ ok: true, ids: new Set() }),
}));
vi.mock("@/lib/library-shadow", async (original) => ({
  ...await original<typeof import("./library-shadow")>(),
  readLibraryDocuments: async (_ws: string, ids: string[]) => ({ ok: true, documents: [],
    sourceVersions: Object.fromEntries(ids.filter((id) => inventory.has(id) && !unreadable.has(id)).map((id) => [id, inventory.get(id)!])) }),
}));

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const raise = (message: string) => json({ code: "P0001", message }, 400);
const withGrantFields = (row: Row) => ({ ...row, agent_client_label: row.agent_grant_id ? "Claude" : null, agent_grantor_email: null });

/** The store's proposal RPCs, as 20261117130000 answers them (create, get, page, decide on the clock, record). */
function proposalRpc(name: string, body: Record<string, unknown>): Response | null {
  if (name === "create_world_change_proposal") {
    const agent = body.p_principal_kind === "agent";
    if (agent && !grantLive(body.p_agent_grant_id as string)) return raise("proposal_agent_grant_revoked");
    const existing = [...proposals.values()].find((row) => row.workspace_key === body.p_workspace_key && row.idempotency_key === body.p_idempotency_key);
    if (existing) {
      if (existing.input_sha256 !== body.p_input_sha256 || existing.collection_id !== body.p_collection_id || existing.action_type !== body.p_action_type
        || existing.principal_kind !== body.p_principal_kind || existing.principal_id !== body.p_principal_id
        || existing.agent_grant_id !== (body.p_agent_grant_id ?? null)) return raise("proposal_idempotency_conflict");
      return json({ proposal: existing, replayed: true });
    }
    nextId += 1;
    const row: Row = {
      proposal_id: uuid(0x900 + nextId), workspace_key: body.p_workspace_key, collection_id: body.p_collection_id, action_type: body.p_action_type,
      input: body.p_input, input_sha256: body.p_input_sha256, evidence_ids: body.p_evidence_ids, state: "proposed", expires_at: body.p_expires_at,
      created_at: `2026-11-17T00:00:${String(nextId).padStart(2, "0")}Z`, decided_at: null, binding_kind: body.p_binding_kind,
      principal_kind: body.p_principal_kind, principal_id: body.p_principal_id, agent_grant_id: body.p_agent_grant_id ?? null, decided_by: null,
      expected_manifest_digest: body.p_expected_manifest_digest, idempotency_key: body.p_idempotency_key, receipt: null,
    };
    proposals.set(row.proposal_id as string, row);
    return json({ proposal: row, replayed: false });
  }
  if (name === "list_world_change_proposals_page") {
    return json([...proposals.values()].filter((row) => row.workspace_key === body.p_workspace_key
      && (body.p_agent_grant_id === null || row.agent_grant_id === body.p_agent_grant_id)).reverse().slice(0, body.p_limit as number).map(withGrantFields));
  }
  const row = proposals.get(body.p_proposal_id as string);
  if (name === "get_world_change_proposal") return row && row.workspace_key === body.p_workspace_key ? json(withGrantFields(row)) : raise("proposal_not_found");
  if (name === "decide_world_change_proposal") {
    if (!row || row.workspace_key !== body.p_workspace_key) return raise("proposal_not_found");
    if (row.state !== "proposed") return raise("proposal_not_decidable");
    const now = Date.now();
    row.state = now >= Date.parse(row.expires_at as string) ? "expired"
      : row.principal_kind === "agent" && !grantLive(row.agent_grant_id as string) ? "withdrawn"
        : body.p_current_manifest_digest !== row.expected_manifest_digest ? "stale" : body.p_decision === "reject" ? "rejected" : "confirmed";
    row.decided_at = new Date(now).toISOString();
    row.decided_by = row.state === "withdrawn" ? null : body.p_decided_by;
    return json(row);
  }
  if (name === "record_world_change_proposal_outcome") {
    if (!row) return raise("proposal_not_found");
    const legal = (row.state === "confirmed" && (body.p_outcome === "executed" || body.p_outcome === "failed")) || (row.state === "executed" && body.p_outcome === "undone");
    if (!legal) return raise("proposal_transition_illegal");
    row.receipt = body.p_outcome === "undone" ? { executed: row.receipt, undone: body.p_receipt } : body.p_receipt;
    row.state = body.p_outcome;
    return json(row);
  }
  return null;
}

vi.mock("@/lib/supabase-admin", () => ({
  readSupabaseAdminConfig: () => ({}),
  supabaseAdminRequest: async (_config: unknown, path: string, init: { method?: string; body?: string } = {}) => {
    const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : {};
    const [table, search] = path.replace("/rest/v1/", "").split("?") as [string, string | undefined];
    const query = new URLSearchParams(search ?? "");
    const eq = (key: string) => query.get(key)?.replace(/^eq\./, "") ?? null;
    const name = table.replace(/^rpc\//, "");
    const answered = table.startsWith("rpc/") ? proposalRpc(name, body) : null;
    if (answered) return answered;
    switch (table) {
      // What the real authorizeAgentRequest reads: the caller's key, its grant, the membership, the owner grant, the rate window.
      case "foundation_api_keys": {
        const key = keys.get(eq("key_prefix") ?? "");
        return json(key ? [{ key_id: `k-${eq("key_prefix")}`, workspace_key: WS, created_by: PERSON, scopes: key.scopes, expires_at: key.expiresAt,
          revoked_at: null, authorization_revision: 3, token_kind: "agent", agent_grant_id: key.grantId }] : []);
      }
      case "rpc/read_foundation_agent_grant": return json(body.p_workspace_key === WS && body.p_user_id === PERSON && grantRevokedAt.has(body.p_grant_id as string)
        ? { grantId: body.p_grant_id, authorizationRevision: 3, createdAt: "2026-11-17T00:00:00Z", revokedAt: grantRevokedAt.get(body.p_grant_id as string) } : null);
      case "foundation_workspace_members": return json(eq("workspace_key") === WS && eq("user_id") === PERSON ? [{ workspace_key: WS, user_id: PERSON,
        role: "owner", state: member.state, accepted_at: "2026-11-01T00:00:00Z", revoked_at: member.state === "active" ? null : "2026-11-18T00:00:00Z",
        authorization_revision: member.revision }] : []);
      case "foundation_account_access_grants": return json(eq("user_id") === PERSON ? [{ user_id: PERSON, grant_kind: "owner", access_plan: "studio_access",
        billing_exempt: true, trial_exempt: true, active: true }] : []);
      case "rpc/consume_foundation_api_rate_limit": return json(true);
      case "rpc/list_collection_candidates": return json(body.p_collection_id === COLLECTION
        ? [{ manifestDigest: CANDIDATE, registeredAt: "2026-11-17T00:00:00Z", documentIds: [DOC_A, DOC_B] },
          { manifestDigest: ACTIVE, registeredAt: "2026-11-16T00:00:00Z", documentIds: [DOC_A] }]
        : body.p_collection_id === COLLECTION_HIDDEN ? [{ manifestDigest: HIDDEN_DIGEST, registeredAt: "2026-11-17T00:00:00Z", documentIds: [DOC_HIDDEN] }] : []);
      case "rpc/quote_foundation_compile_recharge": return json({ reservations: [], totalRechargeCredits: 0, balanceRechargeCredits: 0, overageCredits: 0, balanceCredits: 100 });
      case "foundation_review_decisions": {
        const base = eq("manifest_digest");
        return json(corrections.filter((row) => row.base === base).map(() => ({ decision_id: "d" })));
      }
      // The executors' writes: each one is an effect.
      case "rpc/decide_library_label": {
        effects.push("decide_library_label");
        libraryDecisions.push(body);
        return json({ schemaVersion: "tavonel.library_decision.v1", replayed: false });
      }
      case "rpc/register_collection_artifact_provenance": effects.push("register_provenance"); return json({ leaseSeconds: 300 });
      case "rpc/record_foundation_review_patch_if_leaf": {
        effects.push("record_patch");
        corrections.push({ base: body.p_manifest_digest as string, result: body.p_resulting_manifest_digest as string });
        return json({ decisionId: "d-1", recordedAt: "2026-11-17T01:00:00Z", replayed: false });
      }
      default:
        effects.push(`unexpected:${init.method ?? "GET"} ${table}`);
        return json({ message: `unexpected ${path}` }, 500);
    }
  },
}));

const { POST: agentMcp, GET: agentMcpGet } = await import("@/app/api/agent-mcp/route");
const { POST: readOnlyMcp } = await import("@/app/api/mcp/route");
const decision = await import("@/app/api/proposals/[id]/decision/route");
const undoRoute = await import("@/app/api/proposals/[id]/undo/route");
const lib = await import("./change-proposals");
const signing = await import("./export-signing");
const { REMOTE_MCP_PROTOCOL_VERSIONS } = await import("./remote-mcp");

// ---------------------------------------------------------------------------------------------------------------
// Signing: a lifecycle (v2) signer with a trust store, generated per run
// ---------------------------------------------------------------------------------------------------------------

const SIGNING_ENV = (() => {
  const pair = generateKeyPairSync("ed25519");
  const spki = createPublicKey(pair.privateKey).export({ format: "der", type: "spki" });
  const trust = {
    schemaVersion: "tavonel.export_trust.v2", minimumSignatureVersion: 2, activeKeyId: "u37-actions",
    keys: [{ keyId: "u37-actions", keyVersion: 1, algorithm: "Ed25519", status: "active", notBefore: "2026-01-01T00:00:00.000Z",
      expiresAt: "2030-01-01T00:00:00.000Z", publicKeySpkiDerBase64: spki.toString("base64"),
      publicKeySpkiSha256: `sha256:${createHash("sha256").update(spki).digest("hex")}` }],
  };
  return {
    TAVONEL_EXPORT_SIGNING_KEY_ID: "u37-actions",
    TAVONEL_EXPORT_SIGNING_PRIVATE_KEY_PKCS8_DER_B64: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    TAVONEL_EXPORT_SIGNING_TRUST_STORE_JSON: JSON.stringify(trust),
  };
})();

/** A stored signed receipt verifies against the trust store under the action-receipt scope (the action receipt's verification). */
function verifyActionReceipt(receipt: unknown): { ok: boolean; payload: Row | null } {
  const signed = (receipt as { signedReceipt?: { payloadJson?: unknown; signature?: unknown } } | null)?.signedReceipt;
  if (!signed || typeof signed.payloadJson !== "string" || !signed.signature) return { ok: false, payload: null };
  const trust = signing.readExportTrustStoreEnv(SIGNING_ENV);
  if (!trust) return { ok: false, payload: null };
  const ok = signing.verifyExportSignatureWithTrustStore(Buffer.from(signed.payloadJson, "utf8"), signed.signature as Parameters<typeof signing.verifyExportSignatureWithTrustStore>[1],
    trust, new Date(), signing.ACTION_RECEIPT_SIGNATURE_SCOPE);
  return { ok, payload: ok ? JSON.parse(signed.payloadJson) as Row : null };
}

beforeEach(() => {
  reset();
  sessionAnswer = personSession();
  postCompile.mockClear();
  vi.stubEnv("TAVONEL_AGENT_PROPOSALS_ENABLED", "true");
  vi.stubEnv("TAVONEL_AGENT_PROPOSALS_COHORT", WS);
  vi.stubEnv("TAVONEL_LIBRARY_ORGANIZE_MODE", "on");
  vi.stubEnv("TAVONEL_PROCESSING_WORKSPACE_COHORT", WS);
  vi.stubEnv("TAVONEL_CUSTOMER_DATA_GATE_VERSION", "v2");
  vi.stubEnv("FOUNDATION_PILOT_USER_IDS", PERSON);
  for (const [name, value] of Object.entries(SIGNING_ENV)) vi.stubEnv(name, value);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------------------------

const TOOL: Record<ActionType, string> = { compile_plan: "propose_compile", library_label: "propose_library_labels", ontology_label_patch: "propose_label_correction" };
const TYPES = Object.keys(TOOL) as ActionType[];
function argsOf(type: ActionType, fields: Row = {}): Row {
  if (type === "compile_plan") return { documentIds: [DOC_A, DOC_B], idempotencyKey: "u37-client-key", ...fields };
  if (type === "library_label") return { collectionId: COLLECTION, expectedManifestDigest: ACTIVE, idempotencyKey: "u37-client-key",
    items: [{ documentId: DOC_A, labelKind: "topic", labelKey: "pricing", decision: "confirmed" }], ...fields };
  return { collectionId: COLLECTION, baseManifestDigest: CANDIDATE, objectId: EDITABLE.id, before: EDITABLE.label, after: "Corrected label",
    evidenceId: "ev-1", idempotencyKey: "u37-client-key", ...fields };
}
/** The arguments naming something this person cannot read (denied-ACL at dry run). */
function unreadableArgsOf(type: ActionType): Row {
  if (type === "compile_plan") return argsOf(type, { documentIds: [DOC_HIDDEN] });
  if (type === "library_label") return argsOf(type, { items: [{ documentId: DOC_HIDDEN, labelKind: "topic", labelKey: "pricing", decision: "confirmed" }] });
  return argsOf(type, { collectionId: COLLECTION_HIDDEN, baseManifestDigest: HIDDEN_DIGEST });
}

type Shape = { headers?: Record<string, string>; body?: unknown; get?: boolean };
const call = (message: unknown, shape: Shape = {}, token = TOKEN): Promise<Response> => shape.get
  ? Promise.resolve(agentMcpGet())
  : agentMcp(new Request("https://tavonel.test/api/agent-mcp", { method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream", ...shape.headers },
    body: JSON.stringify(shape.body ?? message) }));
const toolMessage = (name: string, args: unknown) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
const propose = (type: ActionType, args: Row = argsOf(type), token = TOKEN) => call(toolMessage(TOOL[type], args), {}, token);

/** {status, code, proposalId} of an /api/agent-mcp answer: the JSON-RPC error, the tool's refusal, OK, or HTTP_<status> for an empty body. */
async function agentAnswer(response: Response): Promise<{ status: number; code: string; proposalId: string | null }> {
  const text = await response.text();
  if (!text) return { status: response.status, code: `HTTP_${response.status}`, proposalId: null };
  const body = JSON.parse(text) as { result?: { isError?: boolean; content: { text: string }[] }; error?: { message: string } };
  if (body.error) return { status: response.status, code: body.error.message, proposalId: null };
  if (!body.result?.content) return { status: response.status, code: "OK", proposalId: null };
  if (body.result.isError) return { status: response.status, code: body.result.content[0]!.text, proposalId: null };
  const output = JSON.parse(body.result.content[0]!.text) as { proposalId?: string } | { proposalId?: string }[];
  const view = Array.isArray(output) ? output[0] : output;
  return { status: response.status, code: "OK", proposalId: view?.proposalId ?? null };
}

/** The six local host-incompatible shapes, each wrapping a message that would otherwise propose or decide. */
const HOST_SHAPES = {
  "protocol-version": (message: unknown): Shape => ({ headers: { "mcp-protocol-version": "1999-01-01" }, body: message }),
  "batch-array": (message: unknown): Shape => ({ body: [message] }),
  "accept-no-json": (message: unknown): Shape => ({ headers: { accept: "text/event-stream" }, body: message }),
  "get-event-stream": (): Shape => ({ get: true, headers: { accept: "text/event-stream" } }),
  "unknown-method": (message: unknown): Shape => ({ body: { ...(message as Row), method: "tools/invoke" } }),
  "call-as-notification": (message: unknown): Shape => ({ body: { jsonrpc: "2.0", method: "tools/call", params: (message as Row).params } }),
} as const;
type HostShape = keyof typeof HOST_SHAPES;

/** The preview digest the person's panel rendered for this proposal (what a confirming client sends back). */
function previewDigestOf(id: string): string {
  const row = proposals.get(id)!;
  return lib.toPublicProposal(withGrantFields(row) as unknown as Parameters<typeof lib.toPublicProposal>[0], { userId: PERSON, now: new Date() })!.previewDigest!;
}
const decide = (id: string, body: Row) => decision.POST(new Request(`https://tavonel.test/api/proposals/${id}/decision`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
async function sessionAnswerOf(response: Response): Promise<{ status: number; code: string }> {
  const body = await response.json() as { code: string };
  return { status: response.status, code: body.code };
}

// ---------------------------------------------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------------------------------------------

const CONDITIONS = ["granted", "denied-scope", "denied-ACL", "denied-flag", "denied-cohort", "duplicate", "duplicate-other-principal", "expired",
  "stale", "revoked-grant", "revoked-membership"] as const;
type Condition = (typeof CONDITIONS)[number] | `host-incompatible:${HostShape}`;
type Phase = "dry-run" | "confirm";
/** ANY_REFUSAL: any defined refusal (HTTP >= 400, a JSON-RPC error, or a tool refusal) -- used where the work order names no code. */
type Outcome = { status: number; code: string; newRows: number; state: string | null; effects: string[] };
type Case = { id: string; condition: Condition; phase: Phase; type: ActionType; inputs: string; expected: Outcome; knownGap?: string };

const EFFECTS: Record<ActionType, string[]> = {
  compile_plan: ["compile_post"], library_label: ["decide_library_label"], ontology_label_patch: ["register_provenance", "record_patch", "r2_put"],
};
const none = (status: number, code: string, state: string | null = null): Outcome => ({ status, code, newRows: 0, state, effects: [] });

function expectedOf(condition: Condition, phase: Phase, type: ActionType): Outcome {
  const host = condition.startsWith("host-incompatible:") ? condition.slice("host-incompatible:".length) as HostShape : null;
  if (phase === "dry-run") {
    if (host) {
      return {
        "protocol-version": none(400, "MCP_PROTOCOL_VERSION_UNSUPPORTED"), "batch-array": none(400, "Invalid Request"), "accept-no-json": none(0, "ANY_REFUSAL"),
        "get-event-stream": none(405, "HTTP_405"), "unknown-method": none(200, "Method not found"), "call-as-notification": none(202, "HTTP_202"),
      }[host];
    }
    const created = (code = "OK", rows = 1): Outcome => ({ status: 200, code, newRows: rows, state: "proposed", effects: [] });
    switch (condition) {
      case "granted": return created();
      case "denied-scope": return none(403, "API_SCOPE_REQUIRED");
      case "denied-ACL": return none(200, "NOT_FOUND");
      case "denied-flag": case "denied-cohort": return none(404, "HTTP_404");
      case "duplicate": return created("OK_REPLAYED", 1);
      case "duplicate-other-principal": return created("OK_NEW_ROW", 2);
      case "expired": return none(401, "API_KEY_EXPIRED");
      // compile_plan carries no client base: its binding is taken at the dry run, so staleness exists only at confirm.
      case "stale": return type === "compile_plan" ? created() : none(200, "PROPOSAL_BASE_NOT_HEAD");
      case "revoked-grant": return none(403, "API_KEY_AUTHORIZATION_REVOKED");
      case "revoked-membership": return none(403, "WORKSPACE_MEMBERSHIP_REQUIRED");
    }
  }
  if (host) {
    return {
      "protocol-version": none(400, "MCP_PROTOCOL_VERSION_UNSUPPORTED", "proposed"), "batch-array": none(400, "Invalid Request", "proposed"),
      "accept-no-json": none(0, "ANY_REFUSAL", "proposed"), "get-event-stream": none(405, "HTTP_405", "proposed"),
      "unknown-method": none(200, "Method not found", "proposed"), "call-as-notification": none(202, "HTTP_202", "proposed"),
    }[host];
  }
  const executed = (status = 200, code = "OK"): Outcome => ({ status, code, newRows: 0, state: "executed", effects: EFFECTS[type] });
  switch (condition) {
    case "granted": return executed();
    case "denied-scope": return none(403, "PROPOSAL_SESSION_REQUIRED", "proposed");
    case "denied-ACL": return none(403, "CONNECTOR_SOURCE_ACCESS_DENIED", "proposed");
    case "denied-flag": return none(409, "AGENT_PROPOSALS_DISABLED", "proposed");
    // The cohort gates the agent route; a confirmation is a person's act in a session, gated by the flag alone (§2.5).
    case "denied-cohort": return executed();
    case "duplicate": case "duplicate-other-principal": return executed(409, "PROPOSAL_NOT_DECIDABLE");
    case "expired": return none(200, "OK", "expired");
    case "stale": return none(200, "OK", "stale");
    // The revoke withdraws the open row (revoke_foundation_agent_grant), so the later confirmation finds nothing to decide.
    case "revoked-grant": return none(409, "PROPOSAL_NOT_DECIDABLE", "withdrawn");
    // A membership change leaves the row open; the decide reads the grant dead and withdraws it.
    case "revoked-membership": return none(200, "OK", "withdrawn");
  }
  throw new Error(`no expectation for ${condition}`);
}

const INPUTS: Record<string, string> = {
  granted: "agent credential live, scopes read+propose, flag on, workspace in cohort, documents readable",
  "denied-scope": "dry run: credential scopes [agent:read] only; confirm: the decision route called by an API-key principal",
  "denied-ACL": "dry run: a document/candidate the person cannot read; confirm: the person lost access to a document after proposing",
  "denied-flag": "TAVONEL_AGENT_PROPOSALS_ENABLED unset",
  "denied-cohort": "TAVONEL_AGENT_PROPOSALS_COHORT names another workspace",
  duplicate: "dry run: the same call twice (same idempotency key); confirm: the same person confirms twice",
  "duplicate-other-principal": "dry run: a second grant's credential, same client key; confirm: a second person confirms after the first",
  expired: "dry run: credential expires_at in the past; confirm: proposal expires_at passed (store clock)",
  stale: "dry run: base not head (labels: Active moved; correction: base has a correction); confirm: binding moved after proposing",
  "revoked-grant": "dry run: grant revoked; confirm: grant revoked between create and decide (open rows withdrawn)",
  "revoked-membership": "dry run: membership state revoked; confirm: membership revision bumped between create and decide",
};
const HOST_INPUTS: Record<HostShape, string> = {
  "protocol-version": "MCP-Protocol-Version: 1999-01-01", "batch-array": "JSON-RPC batch [message]", "accept-no-json": "Accept: text/event-stream",
  "get-event-stream": "GET with Accept: text/event-stream", "unknown-method": "method tools/invoke", "call-as-notification": "tools/call without id",
};

const CASES: Case[] = [];
for (const condition of [...CONDITIONS, ...Object.keys(HOST_SHAPES).map((shape) => `host-incompatible:${shape}` as Condition)]) {
  for (const phase of ["dry-run", "confirm"] as const) {
    for (const type of TYPES) {
      const host = condition.startsWith("host-incompatible:") ? condition.slice("host-incompatible:".length) as HostShape : null;
      CASES.push({
        id: `U37-${String(CASES.length + 1).padStart(3, "0")}`, condition, phase, type,
        inputs: host ? `${HOST_INPUTS[host]} wrapping ${phase === "dry-run" ? TOOL[type] : `tools/call decide_proposal on a ${type} proposal`}` : INPUTS[condition]!,
        expected: expectedOf(condition, phase, type),
        ...(host === "accept-no-json" && phase === "dry-run"
          ? { knownGap: "/api/agent-mcp does not read Accept: the request is served as JSON and the proposal row is written (proposed delta)" } : {}),
      });
    }
  }
}

const snapshot = () => new Map([...proposals].map(([id, row]) => [id, row.state as string]));
const newRowsSince = (before: Map<string, string>) => [...proposals.keys()].filter((id) => !before.has(id)).length;

/** Creates one proposal of `type` through the agent route (granted), as the setup of a confirm row. */
async function proposed(type: ActionType): Promise<string> {
  const answer = await agentAnswer(await propose(type));
  if (answer.code !== "OK" || !answer.proposalId) throw new Error(`setup propose ${type}: ${answer.code}`);
  return answer.proposalId;
}

async function runDryRun(c: Case): Promise<Outcome> {
  const before = snapshot();
  const effectsBefore = effects.length;
  let answer: { status: number; code: string; proposalId: string | null };
  const host = c.condition.startsWith("host-incompatible:") ? c.condition.slice("host-incompatible:".length) as HostShape : null;
  if (host) {
    answer = await agentAnswer(await call(null, HOST_SHAPES[host](toolMessage(TOOL[c.type], argsOf(c.type)))));
  } else {
    switch (c.condition) {
      case "denied-scope": keys.get(PREFIX)!.scopes = ["agent:read"]; break;
      case "denied-flag": vi.stubEnv("TAVONEL_AGENT_PROPOSALS_ENABLED", ""); break;
      case "denied-cohort": vi.stubEnv("TAVONEL_AGENT_PROPOSALS_COHORT", "pilot-zzzz"); break;
      case "expired": keys.get(PREFIX)!.expiresAt = new Date(Date.now() - 1000).toISOString(); break;
      case "stale": if (c.type === "library_label") actives.set(COLLECTION, `sha256:${"e".repeat(64)}`);
        else if (c.type === "ontology_label_patch") corrections.push({ base: CANDIDATE, result: `sha256:${"f".repeat(64)}` }); break;
      case "revoked-grant": grantRevokedAt.set(GRANT, "2026-11-18T00:00:00Z"); break;
      case "revoked-membership": member.state = "revoked"; break;
      default: break;
    }
    if (c.condition === "duplicate" || c.condition === "duplicate-other-principal") {
      const first = await agentAnswer(await propose(c.type));
      const second = await agentAnswer(await propose(c.type, argsOf(c.type), c.condition === "duplicate" ? TOKEN : TOKEN_2));
      const same = first.proposalId !== null && first.proposalId === second.proposalId;
      answer = { ...second, code: second.code !== "OK" ? second.code : same ? "OK_REPLAYED" : "OK_NEW_ROW" };
    } else {
      answer = await agentAnswer(await propose(c.type, c.condition === "denied-ACL" ? unreadableArgsOf(c.type) : argsOf(c.type)));
    }
  }
  return { status: answer.status, code: answer.code, newRows: newRowsSince(before),
    state: answer.proposalId ? proposals.get(answer.proposalId)?.state as string ?? null : null, effects: effects.slice(effectsBefore) };
}

async function runConfirm(c: Case): Promise<Outcome> {
  const id = await proposed(c.type);
  const digest = previewDigestOf(id);
  const before = snapshot();
  const effectsBefore = effects.length;
  const body = { decision: "confirm", previewDigest: digest };
  let answer: { status: number; code: string };
  const host = c.condition.startsWith("host-incompatible:") ? c.condition.slice("host-incompatible:".length) as HostShape : null;
  if (host) {
    answer = await agentAnswer(await call(null, HOST_SHAPES[host](toolMessage("decide_proposal", { proposalId: id, decision: "confirm", previewDigest: digest }))));
  } else {
    switch (c.condition) {
      case "denied-scope": sessionAnswer = { ok: true, principal: { kind: "api-key", workspaceKey: WS, userId: PERSON, keyId: "k-dev",
        scopes: ["documents:read", "collections:compile"], authorizationRevision: 3, workspaceRole: "owner" } }; break;
      case "denied-ACL": unreadable.add(DOC_A); break;
      case "denied-flag": vi.stubEnv("TAVONEL_AGENT_PROPOSALS_ENABLED", ""); break;
      case "denied-cohort": vi.stubEnv("TAVONEL_AGENT_PROPOSALS_COHORT", "pilot-zzzz"); break;
      case "expired": proposals.get(id)!.expires_at = new Date(Date.now() - 1000).toISOString(); break;
      case "stale": if (c.type === "library_label") actives.set(COLLECTION, `sha256:${"e".repeat(64)}`);
        else if (c.type === "compile_plan") inventory.set(DOC_A, "e".repeat(64));
        else corrections.push({ base: CANDIDATE, result: `sha256:${"f".repeat(64)}` }); break;
      case "revoked-grant":
        // revoke_foundation_agent_grant: the grant and its key revoked, the grant's open proposals withdrawn, in one transaction.
        grantRevokedAt.set(GRANT, new Date().toISOString());
        for (const row of proposals.values()) if (row.agent_grant_id === GRANT && row.state === "proposed") row.state = "withdrawn";
        break;
      case "revoked-membership": member.revision = 4; break;
      default: break;
    }
    if (c.condition === "duplicate" || c.condition === "duplicate-other-principal") {
      const first = await sessionAnswerOf(await decide(id, body));
      if (first.code !== "OK") throw new Error(`first confirmation: ${first.code}`);
      if (c.condition === "duplicate-other-principal") sessionAnswer = personSession(OTHER_PERSON);
    }
    answer = await sessionAnswerOf(await decide(id, body));
  }
  return { status: answer.status, code: answer.code, newRows: newRowsSince(before), state: proposals.get(id)?.state as string ?? null,
    effects: effects.slice(effectsBefore) };
}

const isRefusal = (o: Outcome) => o.status >= 400 || !["OK", "OK_REPLAYED", "OK_NEW_ROW", "HTTP_202"].includes(o.code);
/** The observed row compared with the expected one; ANY_REFUSAL compares refusal, not a code. */
const comparable = (o: Outcome, expected: Outcome) => expected.code === "ANY_REFUSAL"
  ? { ...o, status: 0, code: isRefusal(o) ? "ANY_REFUSAL" : `NOT_REFUSED(${o.status} ${o.code})` } : o;

const observed: Record<string, { observed: Outcome; receiptVerified: boolean | null }> = {};

describe("U37 matrix (local half): the generator", () => {
  it("generates at least 100 rows, each condition x phase x action type exactly once", () => {
    expect(CASES.length).toBe(102);
    expect(new Set(CASES.map((c) => `${c.condition}|${c.phase}|${c.type}`)).size).toBe(CASES.length);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
  });

  const run = async (c: Case) => {
    const outcome = c.phase === "dry-run" ? await runDryRun(c) : await runConfirm(c);
    let receiptVerified: boolean | null = null;
    if (c.phase === "confirm" && outcome.state === "executed") {
      // Every executed agent row carries a signed receipt that verifies against the trust store and names this row.
      const row = [...proposals.values()].find((candidate) => candidate.state === "executed")!;
      const verified = verifyActionReceipt(row.receipt);
      receiptVerified = verified.ok && verified.payload?.proposalId === row.proposal_id && verified.payload?.actionType === c.type
        && verified.payload?.outcome === "executed" && verified.payload?.inputSha256 === row.input_sha256;
    }
    observed[c.id] = { observed: outcome, receiptVerified };
    return { outcome, receiptVerified };
  };

  it.each(CASES.filter((c) => !c.knownGap).map((c) => [`${c.id} ${c.phase} ${c.type} ${c.condition}`, c] as const))("%s", async (_name, c) => {
    const { outcome, receiptVerified } = await run(c);
    expect(comparable(outcome, c.expected)).toEqual(c.expected);
    if (c.expected.state === "executed") expect(receiptVerified).toBe(true);
    // A refused row changed nothing outside the proposal store; an executor ran only for an executed row.
    if (c.expected.state !== "executed") expect(outcome.effects).toEqual([]);
  });

  /*
    The work order expects every host-incompatible shape to be a defined error with no state change. /api/agent-mcp
    does not read Accept, so a dry run sent with `Accept: text/event-stream` only is served and writes its proposal.
    Recorded as a failing row (it.fails: this test passes only while the row fails); the fix is outside this work
    order's write scope (proposed delta: 406 before authorization when Accept names neither application/json nor
    *\/*). When the route is fixed this turns red and the row moves to the passing list.
  */
  it.fails.each(CASES.filter((c) => c.knownGap).map((c) => [`${c.id} ${c.phase} ${c.type} ${c.condition} (KNOWN GAP)`, c] as const))("%s", async (_name, c) => {
    const { outcome } = await run(c);
    expect(comparable(outcome, c.expected)).toEqual(c.expected);
  });
});

describe("U37: no mutation by the old read bridge", () => {
  it("an agent credential at /api/mcp is 401 and the read MCP's tool list is unchanged by a dry run and a confirmation", async () => {
    vi.stubEnv("TAVONEL_REMOTE_MCP_ENABLED", "true");
    const toolsList = async () => {
      const response = await readOnlyMcp(new Request("https://tavonel.test/api/mcp", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }));
      return { status: response.status, body: await response.text() };
    };
    const before = await toolsList();
    expect(before.status).toBe(200);
    const effectsBefore = effects.length;
    const stateBefore = JSON.stringify([...proposals]);
    const refusals: { status: number; code: string }[] = [];
    for (const method of ["tools/list", "tools/call"]) {
      const response = await readOnlyMcp(new Request("https://tavonel.test/api/mcp", { method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { name: "list_sources", arguments: {} } }) }));
      refusals.push({ status: response.status, code: ((await response.json()) as { error: { message: string } }).error.message });
    }
    expect(refusals).toEqual([{ status: 401, code: "AUTH_INVALID" }, { status: 401, code: "AUTH_INVALID" }]);
    expect(effects.length).toBe(effectsBefore);
    expect(JSON.stringify([...proposals])).toBe(stateBefore);
    const id = await proposed("library_label");
    expect((await sessionAnswerOf(await decide(id, { decision: "confirm", previewDigest: previewDigestOf(id) }))).code).toBe("OK");
    expect(await toolsList()).toEqual(before);
    observed["U37-X01"] = { observed: { ...refusals[1]!, newRows: 0, state: null, effects: [] }, receiptVerified: null };
  });
});

describe("U37: authorized action receipt and undo", () => {
  it("every executed agent row of one store verifies against the trust store; a changed payload or another key does not", async () => {
    const ids = [];
    for (const type of TYPES) {
      const id = await proposed(type);
      expect((await sessionAnswerOf(await decide(id, { decision: "confirm", previewDigest: previewDigestOf(id) }))).code).toBe("OK");
      ids.push(id);
    }
    const executed = [...proposals.values()].filter((row) => row.state === "executed" && row.principal_kind === "agent");
    expect(executed.map((row) => row.proposal_id)).toEqual(ids);
    for (const row of executed) expect(verifyActionReceipt(row.receipt).ok).toBe(true);
    const signed = (executed[0]!.receipt as { signedReceipt: { payloadJson: string; signature: unknown } }).signedReceipt;
    expect(verifyActionReceipt({ signedReceipt: { ...signed, payloadJson: signed.payloadJson.replace("executed", "failed") } }).ok).toBe(false);
    const foreign = (executed[1]!.receipt as { signedReceipt: { payloadJson: string; signature: unknown } }).signedReceipt;
    expect(verifyActionReceipt({ signedReceipt: { ...signed, signature: foreign.signature } }).ok).toBe(false);
    observed["U37-X02"] = { observed: { status: 200, code: "OK", newRows: executed.length, state: "executed", effects: [] },
      receiptVerified: executed.every((row) => verifyActionReceipt(row.receipt).ok) };
  });

  it("an executed agent library_label is undone with the flag off ([AN §16]): the opposite library decision, the row undone", async () => {
    const id = await proposed("library_label");
    expect((await sessionAnswerOf(await decide(id, { decision: "confirm", previewDigest: previewDigestOf(id) }))).code).toBe("OK");
    vi.stubEnv("TAVONEL_AGENT_PROPOSALS_ENABLED", "");
    const response = await undoRoute.POST(new Request(`https://tavonel.test/api/proposals/${id}/undo`, { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id }) });
    expect(await sessionAnswerOf(response)).toEqual({ status: 200, code: "OK" });
    expect(proposals.get(id)!.state).toBe("undone");
    expect(libraryDecisions.map((row) => [row.p_decision, row.p_idempotency_key])).toEqual([["confirmed", id], ["undo_confirmed", `${id}:undo`]]);
    // The first outcome's signed receipt is kept under `executed` and still verifies.
    expect(verifyActionReceipt((proposals.get(id)!.receipt as { executed: unknown }).executed).ok).toBe(true);
    // A second undo is refused and changes nothing.
    const again = await undoRoute.POST(new Request(`https://tavonel.test/api/proposals/${id}/undo`, { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id }) });
    expect(await sessionAnswerOf(again)).toEqual({ status: 409, code: "PROPOSAL_NOT_UNDOABLE" });
    expect(libraryDecisions).toHaveLength(2);
    observed["U37-X03"] = { observed: { status: response.status, code: "OK", newRows: proposals.size, state: proposals.get(id)!.state as string,
      effects: libraryDecisions.map((row) => `decide_library_label:${String(row.p_decision)}`) },
    receiptVerified: verifyActionReceipt((proposals.get(id)!.receipt as { executed: unknown }).executed).ok };
  });

  it("the protocol version the matrix calls unsupported is not one the route supports", () => {
    expect(REMOTE_MCP_PROTOCOL_VERSIONS).not.toContain("1999-01-01");
  });
});

/* U37_MATRIX_OUT=<absolute .json path>: the rows with what was observed, for the receipt. Nothing is written without it. */
afterAll(() => {
  const out = process.env.U37_MATRIX_OUT;
  if (!out) return;
  if (!isAbsolute(out) || !out.endsWith(".json")) throw new Error("U37_MATRIX_OUT must be an absolute .json path");
  writeFileSync(out, JSON.stringify({ cases: CASES.map((c) => ({ ...c, ...observed[c.id] })),
    extras: ["U37-X01", "U37-X02", "U37-X03"].map((id) => ({ id, ...observed[id] })) }, null, 2));
});
