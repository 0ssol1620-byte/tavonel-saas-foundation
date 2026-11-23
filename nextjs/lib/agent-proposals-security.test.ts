import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { compileCollectionCandidate, type CollectionOcrInput } from "./collection-compiler";
import { PROMPT_INJECTION_FIXTURES } from "./prompt-injection.fixtures";

/*
  Agent proposals: the cross-module security suite (workorders/agent-native.md §8; WO-AN-5).

  Everything below drives POST /api/agent-mcp in process. The stores are fakes over two workspaces (the caller's
  and another tenant's) that answer as the migrations do; the store calls and every R2 helper call are recorded.
  Authorization is authorizeAgentRequest (real for the audience checks of I-2, stubbed to a principal elsewhere:
  its own suite is lib/developer-auth.test.ts).

  I-1 proposing changes nothing but the proposal row · I-2 (agent route half) · I-17 existence is not disclosed,
  fuzzed over every id-taking tool x every id class x every reader outage · I-19 flag off · I-21 injected text
  creates a proposal and nothing more · I-22 the body bound · source tests · the founder flow of §1 on one
  agent credential with no /api/mcp call.
*/

type Row = Record<string, unknown>;
type Call = { method: string; path: string; body: Record<string, unknown> | null };

const WS = "pilot-a";
const OTHER_WS = "pilot-b";
const PERSON = "7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a";
const GRANT = "9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a";
const OTHER_GRANT = "9b9b9b9b-9b9b-4b9b-8b9b-9b9b9b9b9b9b";
const TOKEN = `tvnl_agt_${"p".repeat(12)}_${"s".repeat(43)}`;
const uuid = (n: number) => `0a000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const DOC_A = uuid(10);
const DOC_B = uuid(11);
const DOC_HIDDEN = uuid(12);
const DOC_FOREIGN = uuid(13);
const COLLECTION = `collection-${"c".repeat(32)}`;
const COLLECTION_HIDDEN = `collection-${"d".repeat(32)}`;
const COLLECTION_FOREIGN = `collection-${"e".repeat(32)}`;
const ACTIVE = `sha256:${"a".repeat(64)}`;
const HIDDEN_DIGEST = `sha256:${"b".repeat(64)}`;
const FOREIGN_DIGEST = `sha256:${"f".repeat(64)}`;
const JOB = `cjob-${"1".repeat(32)}`;
const JOB_HIDDEN = `cjob-${"2".repeat(32)}`;
const JOB_FOREIGN = `cjob-${"3".repeat(32)}`;
/** The workspace a pilot key of PERSON authenticates into (foundationWorkspaceId), for the real-authorization case. */
const AUTH_WS = `pilot-${PERSON.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}`;

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
/** What a Core-compiled candidate carries outside its digest; the real read model only serves a reviewable artifact. */
const CORE_EXECUTION = { status: "completed", runtime: "tavonel-python-core-v2", worldStateId: "world-state-1",
  receipt: { requestId: "core-request-1", outputSha256: `sha256:${"c".repeat(64)}`, candidatePromotion: false } };
const EDITABLE = ARTIFACT.ontology.nodes.find((node) => node.kind === "Entity" || node.kind === "Topic" || node.kind === "Claim")!;
const EVIDENCE = { id: "ev-1", sourceId: DOC_A, sourceVersionId: "a".repeat(64), page: 1, bbox: [80, 120, 920, 320] };

// ---------------------------------------------------------------------------------------------------------------
// The fake workspace(s)
// ---------------------------------------------------------------------------------------------------------------

/** A reader is up (false), down -- it answers its own failure (true) -- or it throws ("throw"). */
type Mode = boolean | "throw";
type Outages = {
  access: Mode; inventory: Mode; library: Mode; candidates: Mode; quote: Mode; active: Mode; jobs: Mode;
  proposals: Mode; review: Mode; model: Mode; quarantine: Mode; tombstones: Mode; storeThrows: boolean;
};
/** The failure a down reader answers, or, for "throw", an exception whose text must never reach the agent. */
function broken<T>(mode: Mode, failure: T): T {
  if (mode === "throw") throw new TypeError("reader exploded: connect ECONNREFUSED 10.0.0.7:5432 password=hunter2");
  return failure;
}
const NO_OUTAGE: Outages = { access: false, inventory: false, library: false, candidates: false, quote: false, active: false, jobs: false,
  proposals: false, review: false, model: false, quarantine: false, tombstones: false, storeThrows: false };

let calls: Call[];
let r2Calls: string[];
let writes: string[];
let down: Outages;
let unreadable: Set<string>;
let inventories: Map<string, Map<string, string>>;
let library: Map<string, Record<string, string>>;
let jobs: Row[];
let candidates: Map<string, Row[]>;
let actives: Map<string, { manifestDigest: string; revision: number }>;
let corrections: { base: string; result: string }[];
let proposals: Map<string, Row>;
let nextId: number;

const job = (fields: Row = {}): Row => ({
  jobId: JOB, workspaceKey: WS, createdByUserId: PERSON, authorizationRevision: 3, documentIds: [DOC_A], state: "ready", collectionId: COLLECTION,
  errorCode: null, blocked: [], blockedResolution: null, documentsTotal: 1, documentsReady: 1, corpusId: null, batchIndex: null, batchCount: null,
  createdAt: "2026-11-17T00:00:00Z", updatedAt: "2026-11-17T00:00:00Z", settledAt: null, ...fields,
});

function reset(outages: Partial<Outages> = {}) {
  calls = [];
  r2Calls = [];
  writes = [];
  down = { ...NO_OUTAGE, ...outages };
  unreadable = new Set([DOC_HIDDEN]);
  inventories = new Map([
    [WS, new Map([[DOC_A, "a".repeat(64)], [DOC_B, "b".repeat(64)], [DOC_HIDDEN, "c".repeat(64)]])],
    [OTHER_WS, new Map([[DOC_FOREIGN, "d".repeat(64)]])],
  ]);
  library = new Map([[WS, { [DOC_A]: "a".repeat(64), [DOC_B]: "b".repeat(64), [DOC_HIDDEN]: "c".repeat(64) }], [OTHER_WS, { [DOC_FOREIGN]: "d".repeat(64) }]]);
  jobs = [job(), job({ jobId: JOB_HIDDEN, documentIds: [DOC_HIDDEN], collectionId: COLLECTION_HIDDEN }),
    job({ jobId: JOB_FOREIGN, workspaceKey: OTHER_WS, documentIds: [DOC_FOREIGN], collectionId: COLLECTION_FOREIGN })];
  candidates = new Map([
    [`${WS}|${COLLECTION}`, [{ manifestDigest: CANDIDATE, registeredAt: "2026-11-17T00:00:00Z", documentIds: [DOC_A, DOC_B] },
      { manifestDigest: ACTIVE, registeredAt: "2026-11-16T00:00:00Z", documentIds: [DOC_A] }]],
    [`${WS}|${COLLECTION_HIDDEN}`, [{ manifestDigest: HIDDEN_DIGEST, registeredAt: "2026-11-17T00:00:00Z", documentIds: [DOC_HIDDEN] }]],
    [`${OTHER_WS}|${COLLECTION_FOREIGN}`, [{ manifestDigest: FOREIGN_DIGEST, registeredAt: "2026-11-17T00:00:00Z", documentIds: [DOC_FOREIGN] }]],
  ]);
  actives = new Map([[`${WS}|${COLLECTION}`, { manifestDigest: ACTIVE, revision: 2 }], [`${WS}|${COLLECTION_HIDDEN}`, { manifestDigest: HIDDEN_DIGEST, revision: 1 }],
    [`${OTHER_WS}|${COLLECTION_FOREIGN}`, { manifestDigest: FOREIGN_DIGEST, revision: 1 }]]);
  corrections = [];
  proposals = new Map();
  nextId = 0;
}

const checkAccess = async (ws: string, ids: string[]) => {
  if (down.access) return broken(down.access, { ok: false, code: "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE" });
  // Another tenant's documents are not this workspace's: the checker knows nothing of them and does not block them.
  return ids.some((id) => ws === WS && unreadable.has(id)) ? { ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" } : { ok: true };
};
const authorize = vi.fn();
/** Answers the next session/foundation checks take, in order; with none queued the real check runs. */
const queuedAuth: unknown[] = [];
const postCompile = vi.fn(async () => { writes.push("POST /api/compile-jobs"); return new Response(null, { status: 500 }); });

/* Every R2 helper is recorded; those the tools may read are answered, any other one is refused (and recorded). */
const R2_ANSWERS: Record<string, (...args: never[]) => unknown> = {
  readR2SignerEnv: () => ({ bucket: "b" }),
  listImmutableWorkspaceObjects: async (_signer: unknown, ws: string) => down.inventory ? broken(down.inventory, { ok: false, code: "LIST_FAILED" })
    : { ok: true, objects: [...inventories.get(ws) ?? new Map()].map(([id, version]) => ({
      key: `immutable/${ws}/${ws}/${id}/${version}/sanitized.pdf`, size: 10, lastModified: "2026-11-16T10:00:00.000Z" })) },
  getWorkspaceCollectionCandidate: async () => down.model ? broken(down.model, { ok: false, code: "R2_READ_FAILED" })
    : { ok: true, json: { ...structuredClone(ARTIFACT), coreExecution: CORE_EXECUTION } },
  listFoundationQuarantineRejects: async () => down.quarantine ? broken(down.quarantine, { ok: false, code: "LIST_FAILED" })
    : { ok: true, documentIds: [], storedDocumentIds: [], truncated: false },
};
function recorded(module: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(module).map(([name, value]) => [name, typeof value !== "function" ? value : (...args: never[]) => {
    r2Calls.push(name);
    return Object.hasOwn(R2_ANSWERS, name) ? R2_ANSWERS[name]!(...args) : Promise.resolve({ ok: false, code: "TEST_R2_NOT_ANSWERED" });
  }]));
}

vi.mock("@/lib/r2-objects", async (original) => recorded(await original<Record<string, unknown>>()));
vi.mock("@/lib/r2-synthetic-canary", async (original) => recorded(await original<Record<string, unknown>>()));
vi.mock("@/lib/collection-storage", () => ({
  loadPreferredCollectionCandidate: async () => { r2Calls.push("loadPreferredCollectionCandidate");
    return { ok: true, value: { key: "k", artifact: structuredClone(ARTIFACT) } }; },
}));
vi.mock("@/lib/developer-auth", async (original) => {
  const real = await original<typeof import("./developer-auth")>();
  authorize.mockImplementation(real.authorizeAgentRequest);
  return {
    ...real, authorizeAgentRequest: authorize,
    requireFoundationSession: (...args: Parameters<typeof real.requireFoundationSession>) =>
      queuedAuth.length > 0 ? Promise.resolve(queuedAuth.shift()) : real.requireFoundationSession(...args),
    authorizeFoundationRequest: (...args: Parameters<typeof real.authorizeFoundationRequest>) =>
      queuedAuth.length > 0 ? Promise.resolve(queuedAuth.shift()) : real.authorizeFoundationRequest(...args),
  };
});
vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccessForViewer: checkAccess, checkConnectorSourceAccess: checkAccess }));
vi.mock("@/app/api/compile-jobs/route", () => ({ POST: postCompile }));
/* The customer-data gate's own suites cover it; its one store read (current_foundation_processing_terms_acceptance) is on the read list. */
/* The customer-data gates admit, except where a test runs them real (realGate): the last describe does, over the transport. */
let realGate = false;
vi.mock("@/lib/customer-data-admission", async (original) => {
  const real = await original<typeof import("./customer-data-admission")>();
  return { ...real, canAdmitCustomerSource: (...args: Parameters<typeof real.canAdmitCustomerSource>) =>
    realGate ? real.canAdmitCustomerSource(...args) : Promise.resolve(true) };
});
vi.mock("@/lib/customer-source-scope", () => ({ readCustomerSourceScope: async () => ({ ok: true, scope: "direct_upload" }) }));
vi.mock("@/lib/derived-data-admission", async (original) => {
  const real = await original<typeof import("./derived-data-admission")>();
  return { ...real, admitsDerivedCustomerData: (...args: Parameters<typeof real.admitsDerivedCustomerData>) =>
    realGate ? real.admitsDerivedCustomerData(...args) : Promise.resolve(true) };
});
vi.mock("@/lib/world-store", async (original) => ({
  ...await original<typeof import("./world-store")>(),
  listFoundationActiveWorlds: async (ws: string) => down.active ? broken(down.active, { ok: false, code: "WORLD_STORE_READ_FAILED" }) : { ok: true, nextCursor: null,
    worlds: [...actives].filter(([key]) => key.startsWith(`${ws}|`)).map(([key, world]) => ({ collectionId: key.split("|")[1], ...world, updatedAt: "2026-11-17T00:00:00Z" })) },
  getFoundationActiveWorld: async (ws: string, collectionId: string) => {
    if (down.active) return broken(down.active, { ok: false, code: "WORLD_STORE_READ_FAILED" });
    const world = actives.get(`${ws}|${collectionId}`);
    return world ? { ok: true, world: { collectionId, ...world } } : { ok: false, code: "ACTIVE_WORLD_NOT_FOUND" };
  },
}));
vi.mock("@/lib/compile-job-store", async (original) => ({
  ...await original<typeof import("./compile-job-store")>(),
  listWorkspaceCompileJobs: async (ws: string) => down.jobs ? broken(down.jobs, { ok: false, code: "COMPILE_JOB_STORE_READ_FAILED" })
    : { ok: true, value: jobs.filter((item) => item.workspaceKey === ws) },
  readCompileJob: async (ws: string, jobId: string) => {
    if (down.jobs) return broken(down.jobs, { ok: false, code: "COMPILE_JOB_STORE_READ_FAILED" });
    const found = jobs.find((item) => item.jobId === jobId && item.workspaceKey === ws);
    return found ? { ok: true, value: found } : { ok: false, code: "COMPILE_JOB_NOT_FOUND" };
  },
}));
vi.mock("@/lib/world-read-model", () => ({
  loadWorldReadModel: async (_ws: string, _collection: string, digest: string) => down.model ? broken(down.model, { ok: false, code: "SIGNER_NOT_CONFIGURED", status: 503 })
    : { ok: true, model: { world: { manifestDigest: digest }, evidence: [EVIDENCE],
      objects: [{ id: EDITABLE.id, type: EDITABLE.kind, label: EDITABLE.label, evidenceRefs: ["ev-1"] }] } },
}));
vi.mock("@/lib/customer-source-lifecycle", async (original) => ({
  ...await original<typeof import("./customer-source-lifecycle")>(),
  readTombstonedUploadDocumentIds: async () => down.tombstones ? broken(down.tombstones, { ok: false, code: "CUSTOMER_SOURCE_DELETE_STORE_FAILED" }) : { ok: true, ids: new Set() },
}));
vi.mock("@/lib/library-shadow", async (original) => ({
  ...await original<typeof import("./library-shadow")>(),
  readLibraryDocuments: async (ws: string, ids: string[]) => {
    if (down.library) return broken(down.library, { ok: false, code: "LIBRARY_ORGANIZE_STORE_FAILED" });
    const versions = library.get(ws) ?? {};
    return { ok: true, documents: [], sourceVersions: Object.fromEntries(ids.filter((id) => versions[id] && !unreadable.has(id)).map((id) => [id, versions[id]!])) };
  },
}));
vi.mock("@/lib/supabase-admin", () => ({
  readSupabaseAdminConfig: () => ({}),
  supabaseAdminRequest: async (_config: unknown, path: string, init: { method?: string; body?: string } = {}) => {
    const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ method: init.method ?? "GET", path, body });
    if (down.storeThrows) throw new Error("connect ECONNREFUSED 10.0.0.7:5432 password=hunter2");
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    const failed = (mode: Mode) => broken(mode, json({ code: "57014", message: "canceling statement due to statement timeout" }, 500));
    if (realStore) {
      const answer = realReaderAnswer(path, body, json, failed);
      if (answer) return answer;
    }
    if (name0(path) === "revoke_foundation_api_key_authorized") return json(null);
    if (path.startsWith("/rest/v1/foundation_review_decisions?")) {
      if (down.review) return failed(down.review);
      const query = new URLSearchParams(path.split("?")[1]);
      const base = query.get("manifest_digest")?.replace(/^eq\./, "");
      const result = query.get("resulting_manifest_digest")?.replace(/^eq\./, "");
      if (base) return json(corrections.filter((row) => row.base === base).map(() => ({ decision_id: "d" })));
      return json(corrections.filter((row) => row.result === result).map((row) => ({ manifest_digest: row.base })));
    }
    const name = path.replace("/rest/v1/rpc/", "");
    if (name === "list_collection_candidates") {
      return down.candidates ? failed(down.candidates) : json(candidates.get(`${body!.p_workspace_key}|${body!.p_collection_id}`) ?? []);
    }
    if (name === "quote_foundation_compile_recharge") {
      return down.quote ? failed(down.quote) : json({ reservations: [], totalRechargeCredits: 0, balanceRechargeCredits: 0, overageCredits: 0, balanceCredits: 100 });
    }
    if (name === "get_world_change_proposal") {
      if (down.proposals) return failed(down.proposals);
      const row = proposals.get(body!.p_proposal_id as string);
      return row && row.workspace_key === body!.p_workspace_key ? json(row) : json({ message: "proposal_not_found" }, 400);
    }
    if (name === "list_world_change_proposals_page") {
      if (down.proposals) return failed(down.proposals);
      return json([...proposals.values()].filter((row) => row.workspace_key === body!.p_workspace_key
        && (body!.p_agent_grant_id === null || row.agent_grant_id === body!.p_agent_grant_id)).reverse().slice(0, body!.p_limit as number));
    }
    if (name === "create_world_change_proposal") {
      if (down.proposals) return failed(down.proposals);
      const existing = [...proposals.values()].find((row) => row.idempotency_key === body!.p_idempotency_key);
      if (existing) return json({ proposal: existing, replayed: true });
      nextId += 1;
      const row = {
        proposal_id: uuid(0x900 + nextId), workspace_key: body!.p_workspace_key, collection_id: body!.p_collection_id, action_type: body!.p_action_type,
        input: body!.p_input, input_sha256: body!.p_input_sha256, evidence_ids: body!.p_evidence_ids, state: "proposed", expires_at: body!.p_expires_at,
        created_at: `2026-11-17T00:00:${String(nextId).padStart(2, "0")}Z`, decided_at: null, binding_kind: body!.p_binding_kind,
        principal_kind: body!.p_principal_kind, principal_id: body!.p_principal_id, agent_grant_id: body!.p_agent_grant_id, decided_by: null,
        expected_manifest_digest: body!.p_expected_manifest_digest, idempotency_key: body!.p_idempotency_key, receipt: null,
        agent_client_label: "Claude", agent_grantor_email: null,
      };
      proposals.set(row.proposal_id, row);
      return json({ proposal: row, replayed: false });
    }
    return json({ message: `unexpected ${path}` }, 500);
  },
}));

/*
  The rows the real reader modules read (the last describe of this file runs them over this transport). Each
  answers from the same fake workspace as the fakes above, shaped as PostgREST and the migrations answer.
*/
let realStore = false;
const name0 = (path: string) => path.replace("/rest/v1/rpc/", "").split("?")[0]!;
function realReaderAnswer(path: string, body: Record<string, unknown> | null, json: (value: unknown, status?: number) => Response,
  failed: (mode: Mode) => Response): Response | null {
  const [table, search] = path.replace("/rest/v1/", "").split("?") as [string, string | undefined];
  const query = new URLSearchParams(search ?? "");
  const eq = (key: string) => query.get(key)?.replace(/^eq\./, "") ?? null;
  const ws = eq("workspace_key");
  const counted = (rows: unknown[]) => new Response(JSON.stringify(rows), { status: 200, headers: { "content-range": `0-${rows.length}/${rows.length}` } });
  switch (table) {
    case "rpc/documents_outside_member_scope": {
      // The agent's person owns WS: nothing is outside their scope there; any other workspace has no membership.
      if (down.access) return failed(down.access);
      return json(body!.p_workspace_key !== WS || body!.p_user_id !== PERSON);
    }
    case "rpc/connector_documents_blocked": {
      if (down.access) return failed(down.access);
      return json(body!.p_workspace_key === WS && (body!.p_document_ids as string[]).some((id) => unreadable.has(id)));
    }
    case "rpc/read_library_organize": {
      if (down.library) return failed(down.library);
      const versions = library.get(body!.p_workspace_key as string) ?? {};
      return json({ schemaVersion: "tavonel.library_organize_read.v1", relations: [], labels: (body!.p_document_ids as string[])
        .filter((id) => versions[id]).map((id) => ({ documentId: id, sourceVersionId: versions[id], labelKind: "topic", labelKey: "pricing",
          labelSetVersion: "v1", method: "m", methodVersion: "1", inputsSha256: `sha256:${"1".repeat(64)}`, disposition: "proposed",
          abstainReason: null, internalScore: null, evidenceIds: [], createdAt: "2026-11-16T00:00:00Z" })) });
    }
    case "rpc/current_foundation_processing_terms_acceptance": return json(null);
    // What the real authorizeAgentRequest reads (WO-AN-8): the caller's key, its grant, the membership, the owner grant, the rate window.
    case "foundation_api_keys": return json(eq("key_prefix") === "p".repeat(12) ? [{ key_id: "k-1", workspace_key: AUTH_WS, created_by: PERSON,
      scopes: ["agent:read", "agent:propose"], expires_at: "2099-01-01T00:00:00Z", revoked_at: null, authorization_revision: 3, token_kind: "agent",
      agent_grant_id: GRANT }] : []);
    case "rpc/read_foundation_agent_grant": return json(body!.p_workspace_key === AUTH_WS && body!.p_grant_id === GRANT && body!.p_user_id === PERSON
      ? { grantId: GRANT, authorizationRevision: 3, createdAt: "2026-11-17T00:00:00Z", revokedAt: null } : null);
    case "foundation_workspace_members": return json(ws === AUTH_WS && eq("user_id") === PERSON ? [{ workspace_key: AUTH_WS, user_id: PERSON,
      role: "owner", state: "active", accepted_at: "2026-11-01T00:00:00Z", revoked_at: null, authorization_revision: 3 }] : []);
    case "foundation_account_access_grants": return json(eq("user_id") === PERSON ? [{ user_id: PERSON, grant_kind: "owner", access_plan: "studio_access",
      billing_exempt: true, trial_exempt: true, active: true }] : []);
    case "rpc/consume_foundation_api_rate_limit": return json(true);
    case "source_deletion_tombstones": return down.tombstones ? failed(down.tombstones) : json([]);
    case "connector_document_bindings": return counted([]);
    case "foundation_intake_admissions": {
      const ids = /document_id=in\.\(([^)]*)\)/.exec(search ?? "")?.[1]?.split(",") ?? [];
      return counted(ids.filter((id) => inventories.get(ws ?? "")?.has(id)).map((id) => ({ workspace_key: ws, document_id: id })));
    }
    case "foundation_compile_jobs": {
      if (down.jobs) return failed(down.jobs);
      return json(jobs.filter((row) => row.workspaceKey === ws && (eq("job_id") === null || row.jobId === eq("job_id"))).map((row) => ({
        job_id: row.jobId, workspace_key: row.workspaceKey, created_by_user_id: row.createdByUserId, authorization_revision: row.authorizationRevision,
        document_ids: row.documentIds, state: row.state, collection_id: row.collectionId, error_code: row.errorCode, blocked: row.blocked,
        blocked_resolution: row.blockedResolution, documents_total: row.documentsTotal, documents_ready: row.documentsReady, corpus_id: null,
        batch_index: null, batch_count: null, created_at: row.createdAt, updated_at: row.updatedAt, settled_at: row.settledAt })));
    }
    case "foundation_active_worlds": {
      if (down.active) return failed(down.active);
      return json([...actives].filter(([key]) => key.startsWith(`${ws}|`) && (eq("collection_id") === null || key === `${ws}|${eq("collection_id")}`))
        .map(([key, world]) => ({ workspace_key: ws, collection_id: key.split("|")[1], manifest_digest: world.manifestDigest, revision: world.revision,
          updated_at: "2026-11-17T00:00:00Z" })));
    }
    case "foundation_world_versions": {
      if (down.active) return failed(down.active);
      return json([...actives].filter(([key, world]) => key === `${ws}|${eq("collection_id")}` && (eq("manifest_digest") === null || world.manifestDigest === eq("manifest_digest")))
        .map(([key, world]) => ({ workspace_key: ws, collection_id: key.split("|")[1], manifest_digest: world.manifestDigest, revision: world.revision,
          lifecycle_status: "active", world_state_id: "ws-1", core_output_sha256: `sha256:${"7".repeat(64)}`, created_at: "2026-11-16T00:00:00Z",
          first_promoted_at: "2026-11-16T00:00:00Z", last_activated_at: "2026-11-16T00:00:00Z", activation_count: 1,
          candidate_object_key: `immutable/${ws}/${ws}/collections/${key.split("|")[1]}/${world.manifestDigest.slice(7)}/candidate-world.json`,
          updated_at: "2026-11-17T00:00:00Z" })));
    }
    default: return null;
  }
}

const { POST, GET } = await import("@/app/api/agent-mcp/route");
// Imported once at collection: the read-only MCP route loads its whole bridge.
const { POST: readOnlyMcp } = await import("@/app/api/mcp/route");
const { GET: listGrants } = await import("@/app/api/agent-grants/route");

const principal = { kind: "agent", workspaceKey: WS, userId: PERSON, keyId: "k", grantId: GRANT, scopes: ["agent:read", "agent:propose"],
  authorizationRevision: 3, workspaceRole: "owner" };

const post = (body: unknown, headers: Record<string, string> = {}) => POST(new Request("https://tavonel.test/api/agent-mcp", {
  method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
}));
const toolCall = (name: string, args?: unknown, id: unknown = 1) => post({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
/** The tool's answer: the parsed output, or the error code. */
async function answerOf(response: Response): Promise<{ ok: true; output: unknown } | { ok: false; code: string }> {
  const body = await response.json() as { result?: { isError?: boolean; content: { text: string }[] }; error?: { message: string } };
  if (body.error) return { ok: false, code: body.error.message };
  return body.result!.isError ? { ok: false, code: body.result!.content[0]!.text } : { ok: true, output: JSON.parse(body.result!.content[0]!.text) };
}
const snapshot = async (response: Response) => ({ status: response.status, headers: [...response.headers].sort(), body: await response.text() });

beforeEach(() => {
  reset();
  authorize.mockClear();
  authorize.mockResolvedValue({ ok: true, principal });
  postCompile.mockClear();
  vi.stubEnv("TAVONEL_AGENT_PROPOSALS_ENABLED", "true");
  vi.stubEnv("TAVONEL_AGENT_PROPOSALS_COHORT", WS);
  vi.stubEnv("TAVONEL_LIBRARY_ORGANIZE_MODE", "on");
  vi.stubEnv("TAVONEL_PROCESSING_WORKSPACE_COHORT", WS);
  vi.stubEnv("TAVONEL_CUSTOMER_DATA_GATE_VERSION", "v2");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const p3Args = (fields: Row = {}) => ({ collectionId: COLLECTION, expectedManifestDigest: ACTIVE, idempotencyKey: "client-key-1",
  items: [{ documentId: DOC_A, labelKind: "topic", labelKey: "pricing", decision: "confirmed" }], ...fields });
const p4Args = (fields: Row = {}) => ({ collectionId: COLLECTION, baseManifestDigest: CANDIDATE, objectId: EDITABLE.id, before: EDITABLE.label,
  after: "Corrected label", evidenceId: "ev-1", idempotencyKey: "client-key-1", ...fields });

// ---------------------------------------------------------------------------------------------------------------
// I-1
// ---------------------------------------------------------------------------------------------------------------

/** §8 I-1, exact names. current_foundation_processing_terms_acceptance: the v2 customer-data gate's one store read. */
const READ_RPCS = ["documents_outside_member_scope", "connector_documents_blocked_for_viewer", "connector_documents_blocked", "read_library_organize", "list_collection_candidates",
  "quote_foundation_compile_recharge", "get_world_change_proposal", "list_world_change_proposals_page", "list_world_change_proposals",
  "current_foundation_processing_terms_acceptance",
  // authorizeAgentRequest's grant liveness read (WO-AN-8 real-authorization case); stable, asserted in supabase/tests/agent_proposals.sql.
  "read_foundation_agent_grant"];
const WRITE_RPCS = ["create_world_change_proposal", "consume_foundation_api_rate_limit"];
/** The R2 helpers the tools may call, by exact name: a new helper (a presign-for-put named get*, say) fails I-1 until it is listed. */
const R2_READS = ["readR2SignerEnv", "listImmutableWorkspaceObjects", "listFoundationQuarantineRejects", "getWorkspaceCollectionCandidate",
  "loadPreferredCollectionCandidate"];

function expectOnlyReadsAndTheProposalRow() {
  const rpcs = calls.filter((call) => call.path.startsWith("/rest/v1/rpc/")).map((call) => call.path.slice("/rest/v1/rpc/".length));
  expect(rpcs.filter((name) => !READ_RPCS.includes(name) && !WRITE_RPCS.includes(name)), "an RPC outside the read and write lists").toEqual([]);
  expect(calls.filter((call) => !call.path.startsWith("/rest/v1/rpc/") && call.method !== "GET").map((call) => `${call.method} ${call.path}`)).toEqual([]);
  expect(r2Calls.filter((name) => !R2_READS.includes(name)), "an R2 helper that is not a read").toEqual([]);
  expect(writes).toEqual([]);
}

describe("I-1: proposing changes nothing but the proposal row", () => {
  it("every read tool and every propose tool, valid calls: only read RPCs, GETs, R2 reads and create_world_change_proposal", async () => {
    const answers = [
      await toolCall("get_workflow_status", {}),
      await toolCall("list_documents", {}),
      await toolCall("get_compile_job", { jobId: JOB }),
      await toolCall("list_candidates", { collectionId: COLLECTION }),
      await toolCall("get_candidate_objects", { collectionId: COLLECTION, manifestDigest: CANDIDATE }),
      await toolCall("propose_compile", { documentIds: [DOC_A, DOC_B], idempotencyKey: "client-key-1" }),
      await toolCall("propose_library_labels", p3Args()),
      await toolCall("propose_label_correction", p4Args()),
    ];
    for (const answer of answers) expect((await answerOf(answer)).ok).toBe(true);
    const first = [...proposals.keys()][0]!;
    expect((await answerOf(await toolCall("get_proposal", { proposalId: first }))).ok).toBe(true);
    expectOnlyReadsAndTheProposalRow();
    expect(calls.filter((call) => call.path.endsWith("/create_world_change_proposal"))).toHaveLength(3);
    expect([...proposals.values()].every((row) => row.state === "proposed" && row.principal_kind === "agent" && row.agent_grant_id === GRANT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// I-2 (agent route half) and the transport
// ---------------------------------------------------------------------------------------------------------------

describe("I-2: only an agent credential is served at /api/agent-mcp", () => {
  it.each([
    ["a live key", `tvnl_live_${"p".repeat(12)}_${"s".repeat(43)}`, "API_KEY_AUDIENCE_INVALID"],
    ["a remote MCP key", `tvnl_mcp_${"p".repeat(12)}_${"s".repeat(43)}`, "API_KEY_AUDIENCE_INVALID"],
    ["no TAVONEL key", "eyJhbGciOiJIUzI1NiJ9.e30.x", "API_KEY_INVALID"],
  ])("%s is 401 before any store call", async (_name, bearer, code) => {
    authorize.mockImplementation((await vi.importActual<typeof import("./developer-auth")>("./developer-auth")).authorizeAgentRequest);
    const response = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { authorization: `Bearer ${bearer}` });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ jsonrpc: "2.0", id: 1, error: { code: -32001, message: code } });
    expect(calls).toEqual([]);
  });

  it("no bearer at all is 401 AUTH_REQUIRED, initialize included", async () => {
    authorize.mockImplementation((await vi.importActual<typeof import("./developer-auth")>("./developer-auth")).authorizeAgentRequest);
    const response = await POST(new Request("https://tavonel.test/api/agent-mcp", { method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) }));
    expect(response.status).toBe(401);
    expect((await response.json()).error.message).toBe("AUTH_REQUIRED");
  });

  it("an agent credential at the read-only MCP is rejected by its bearer check", async () => {
    vi.stubEnv("TAVONEL_REMOTE_MCP_ENABLED", "true");
    const response = await readOnlyMcp(new Request("https://tavonel.test/api/mcp", { method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_sources", arguments: {} } }) }));
    expect(response.status).toBe(401);
    expect((await response.json()).error.message).toBe("AUTH_INVALID");
  });

  /*
    WO-AN-8 narrowed the dispatch: authorizeAgentRequest enters it for authenticateDeveloperApiKey alone, so the
    route calls it from outside (this assertion was `inside: true` x4 before WO-AN-8). That the authentication
    itself runs inside is shown by the real-authorization case at the end of this file, which can only pass then.
  */
  it("a propose tool is authorized with agent:propose, every other request with agent:read; the route itself is outside the agent dispatch", async () => {
    const { insideAgentMcpDispatch } = await import("./agent-mcp-dispatch");
    const inside: boolean[] = [];
    authorize.mockImplementation(async () => { inside.push(insideAgentMcpDispatch()); return { ok: true, principal }; });
    await toolCall("propose_compile", { documentIds: [DOC_A], idempotencyKey: "client-key-1" });
    await toolCall("list_documents", {});
    await post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    await toolCall("not_a_tool", {});
    expect(authorize.mock.calls.map((call) => call[1])).toEqual(["agent:propose", "agent:read", "agent:read", "agent:read"]);
    expect(inside).toEqual([false, false, false, false]);
  });

  /*
    WO-AN-8: a tool handler is not inside the agent dispatch, so anything it reaches that authorizes a bearer (a REST
    helper, say) treats the agent credential as it would anywhere else: refused before the store is asked. Mutant:
    wrap the handler in withinAgentMcpDispatch (authentication then asks the store for the key).
  */
  it("a tool handler runs outside the agent dispatch: a REST authorization it reaches refuses the agent credential before any store read", async () => {
    const { insideAgentMcpDispatch } = await import("./agent-mcp-dispatch");
    const { authorizeFoundationRequest } = await vi.importActual<typeof import("./developer-auth")>("./developer-auth");
    const { authenticateDeveloperApiKey } = await import("./developer-store");
    const probe: { inside?: boolean; rest?: unknown; authenticated?: unknown } = {};
    const original = R2_ANSWERS.listImmutableWorkspaceObjects!;
    R2_ANSWERS.listImmutableWorkspaceObjects = async (...args: never[]) => {
      probe.inside = insideAgentMcpDispatch();
      probe.rest = await authorizeFoundationRequest(new Request("https://tavonel.test/api/v1/collections", { headers: { authorization: `Bearer ${TOKEN}` } }),
        "collections:read");
      probe.authenticated = await authenticateDeveloperApiKey(TOKEN);
      return original(...args);
    };
    try {
      expect((await answerOf(await toolCall("list_documents", {}))).ok).toBe(true);
    } finally {
      R2_ANSWERS.listImmutableWorkspaceObjects = original;
    }
    expect(probe).toEqual({ inside: false, rest: { ok: false, code: "API_KEY_AUDIENCE_INVALID", status: 401 },
      authenticated: { ok: false, code: "API_KEY_AUDIENCE_INVALID" } });
    expect(calls.filter((call) => call.path.startsWith("/rest/v1/foundation_api_keys"))).toEqual([]);
  });

  it("a rate-limited call answers RATE_LIMITED", async () => {
    authorize.mockResolvedValue({ ok: false, code: "API_RATE_LIMITED", status: 429 });
    const response = await toolCall("list_documents", {});
    expect(response.status).toBe(429);
    expect((await response.json()).error.message).toBe("RATE_LIMITED");
  });

  it("tools/list names the nine; a deciding tool name is -32602 Unknown tool", async () => {
    const listed = await (await post({ jsonrpc: "2.0", id: 1, method: "tools/list" })).json() as { result: { tools: { name: string }[] } };
    expect(listed.result.tools.map((tool) => tool.name)).toHaveLength(9);
    for (const name of ["confirm", "decide_proposal", "approve", "activate"]) {
      expect(await (await toolCall(name, {})).json()).toEqual({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Unknown tool" } });
    }
  });

  it("initialize answers a supported protocol version; notifications are 202; maxDuration is the literal 60", async () => {
    const { REMOTE_MCP_PROTOCOL_VERSIONS } = await import("./remote-mcp");
    const init = await (await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: REMOTE_MCP_PROTOCOL_VERSIONS[0] } })).json();
    expect(init.result.protocolVersion).toBe(REMOTE_MCP_PROTOCOL_VERSIONS[0]);
    expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    expect(readFileSync(resolve(import.meta.dirname, "../app/api/agent-mcp/route.ts"), "utf8")).toMatch(/^export const maxDuration = 60;$/m);
  });

  /* WO-AN-8 added decidingReadFailed to the event (it was {event, tool, code} before). */
  it("telemetry is {event, tool, code, decidingReadFailed} only", async () => {
    const lines: string[] = [];
    vi.mocked(console.info).mockImplementation((line: string) => { lines.push(line); });
    await toolCall("list_documents", {});
    await toolCall("get_compile_job", { jobId: JOB_FOREIGN });
    await toolCall("no_such_tool", {});
    authorize.mockResolvedValueOnce({ ok: false, code: "API_RATE_LIMITED", status: 429 });
    await toolCall("list_documents", {});
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { event: "agent_mcp_tool", tool: "list_documents", code: "OK", decidingReadFailed: false },
      { event: "agent_mcp_tool", tool: "get_compile_job", code: "NOT_FOUND", decidingReadFailed: false },
      { event: "agent_mcp_tool", tool: "unknown", code: "UNKNOWN_TOOL", decidingReadFailed: false },
      { event: "agent_mcp_tool", tool: "list_documents", code: "RATE_LIMITED", decidingReadFailed: false },
    ]);
  });

  it("a store that throws leaves as UNAVAILABLE; the exception's text never reaches the agent", async () => {
    reset({ storeThrows: true });
    for (const response of [await toolCall("get_workflow_status", {}), await toolCall("list_candidates", { collectionId: COLLECTION }),
      await toolCall("propose_compile", { documentIds: [DOC_A], idempotencyKey: "client-key-1" })]) {
      const text = await response.text();
      expect(text).not.toMatch(/ECONNREFUSED|hunter2|10\.0\.0\.7|statement/);
    }
    authorize.mockRejectedValue(new Error("boom with secret"));
    const thrown = await toolCall("list_documents", {});
    expect(thrown.status).toBe(503);
    expect(await thrown.text()).not.toContain("secret");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// I-22, I-19
// ---------------------------------------------------------------------------------------------------------------

describe("I-22: the body is bounded", () => {
  it("a body over 8 KiB is 413 before authorization", async () => {
    const response = await toolCall("list_documents", { cursor: "x".repeat(9000) });
    expect(response.status).toBe(413);
    expect(authorize).not.toHaveBeenCalled();
  });

  it("a multi-byte body is measured in bytes, not characters", async () => {
    const text = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "가".repeat(3000) } });
    expect(text.length).toBeLessThan(8192);
    expect((await post(text)).status).toBe(413);
  });

  /*
    WO-AN-8: the cap is on the bytes read, never on what the client declares. A chunked body (no Content-Length) is
    read from the stream and abandoned at the first chunk past 8 KiB: 413, nothing parsed, nobody authorized, and
    the rest of the stream is never pulled (1 MiB here). Mutant: the cap on Content-Length only.
  */
  it("a chunked body over 8 KiB with no Content-Length is 413 before more is buffered, parsed or authorized", async () => {
    let pulled = 0;
    const chunk = new TextEncoder().encode(" ".repeat(1024));
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { pulled += 1; if (pulled > 1024) controller.close(); else controller.enqueue(chunk); },
    });
    const request = new Request("https://tavonel.test/api/agent-mcp", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` },
      body, duplex: "half" } as RequestInit);
    expect(request.headers.get("content-length")).toBeNull();
    const parse = vi.spyOn(JSON, "parse");
    const response = await POST(request);
    const parsed = parse.mock.calls.length;
    parse.mockRestore();
    expect(response.status).toBe(413);
    expect(parsed).toBe(0);
    expect(authorize).not.toHaveBeenCalled();
    expect(pulled).toBeLessThan(16);
    expect(await response.json()).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "REQUEST_TOO_LARGE" } });
  });

  it("a chunked body at the cap is read whole and answered", async () => {
    const message = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    const bytes = new TextEncoder().encode(message.padEnd(8192, " "));
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      for (let at = 0; at < bytes.length; at += 1000) controller.enqueue(bytes.slice(at, at + 1000));
      controller.close();
    } });
    const response = await POST(new Request("https://tavonel.test/api/agent-mcp", { method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` }, body, duplex: "half" } as RequestInit));
    expect(await response.json()).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  /* The bytes are decoded here, so bytes that are not UTF-8 are a parse error, never a body with replacement characters. */
  it("a body that is not valid UTF-8 is -32700 before authorization", async () => {
    const bytes = Buffer.concat([Buffer.from('{"jsonrpc":"2.0","id":1,"method":"ping","params":{"x":"'), Buffer.from([0xff, 0xfe]), Buffer.from('"}}')]);
    const response = await POST(new Request("https://tavonel.test/api/agent-mcp", { method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: bytes }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    expect(authorize).not.toHaveBeenCalled();
  });
});

describe("I-19: flag off", () => {
  it("/api/agent-mcp is 404 before the body is read or anyone is authorized; GET too", async () => {
    vi.stubEnv("TAVONEL_AGENT_PROPOSALS_ENABLED", "");
    const request = new Request("https://tavonel.test/api/agent-mcp", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    const response = await POST(request);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(request.bodyUsed).toBe(false);
    expect(authorize).not.toHaveBeenCalled();
    expect(GET().status).toBe(404);
  });

  it("a cohort that admits nobody is 404 before the body; a workspace outside the cohort is 404 after authorization, no tool run", async () => {
    vi.stubEnv("TAVONEL_AGENT_PROPOSALS_COHORT", "");
    const request = new Request("https://tavonel.test/api/agent-mcp", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: "{}" });
    expect((await POST(request)).status).toBe(404);
    expect(request.bodyUsed).toBe(false);
    vi.stubEnv("TAVONEL_AGENT_PROPOSALS_COHORT", "pilot-z");
    expect((await toolCall("list_documents", {})).status).toBe(404);
    expect(r2Calls).toEqual([]);
  });

  it("the read-only MCP's tools/list and the grants list answer the same with the flag set and unset", async () => {
    vi.stubEnv("TAVONEL_REMOTE_MCP_ENABLED", "true");
    const once = async () => [
      await snapshot(await readOnlyMcp(new Request("https://tavonel.test/api/mcp", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }))),
      await snapshot(await listGrants(new Request("https://tavonel.test/api/agent-grants"))),
    ];
    const on = await once();
    vi.stubEnv("TAVONEL_AGENT_PROPOSALS_ENABLED", "");
    expect(await once()).toEqual(on);
    expect(on[0]!.status).toBe(200);
  });

  it("/api/compile-jobs POST and the developer key revoke answer the same status, headers and body with the flag set and unset", async () => {
    // The real compile route (the agent route's executor mock is not what a person's compile runs).
    const { POST: compileJobs } = await vi.importActual<typeof import("@/app/api/compile-jobs/route")>("@/app/api/compile-jobs/route");
    const { DELETE: revokeKey } = await import("@/app/api/developer/keys/[id]/route");
    const person = { ok: true, principal: { kind: "session", workspaceKey: WS, userId: PERSON, authorizationRevision: 3, workspaceRole: "owner",
      accessSource: "pilot" } };
    const keyId = uuid(0x801);
    const once = async () => {
      const answers = [];
      // No credential, an agent credential, and a signed-in person (who reaches each route's own logic).
      for (const [signedIn, authorization] of [[false, null], [false, `Bearer ${TOKEN}`], [true, "Bearer person-session"]] as const) {
        const headers: Record<string, string> = { "content-type": "application/json", ...(authorization ? { authorization } : {}) };
        if (signedIn) queuedAuth.push(person);
        answers.push(await snapshot(await compileJobs(new Request("https://tavonel.test/api/compile-jobs", {
          method: "POST", headers, body: JSON.stringify({ documentIds: [DOC_A] }) }))));
        if (signedIn) queuedAuth.push(person);
        answers.push(await snapshot(await revokeKey(new Request(`https://tavonel.test/api/developer/keys/${keyId}`, { method: "DELETE", headers }),
          { params: Promise.resolve({ id: keyId }) })));
      }
      return answers;
    };
    const on = await once();
    vi.stubEnv("TAVONEL_AGENT_PROPOSALS_ENABLED", "");
    expect(await once()).toEqual(on);
    vi.stubEnv("TAVONEL_AGENT_PROPOSALS_ENABLED", "false");
    expect(await once()).toEqual(on);
    expect(queuedAuth).toEqual([]);
    // The person's revoke reached the store and succeeded; the agent credential was refused at both (I-2).
    expect(on.map((answer) => answer.status)).toEqual([401, 401, 401, 401, expect.any(Number), 204]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// I-17: existence is not disclosed -- every id-taking tool x every id class x every reader outage
// ---------------------------------------------------------------------------------------------------------------

/* A small seeded generator, so the random class is a different id every round and the run is reproducible. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
}
const randomHex = (next: () => number, n: number) => Array.from({ length: n }, () => (next() % 16).toString(16)).join("");
const randomUuid = (next: () => number) => `${randomHex(next, 8)}-${randomHex(next, 4)}-4${randomHex(next, 3)}-8${randomHex(next, 3)}-${randomHex(next, 12)}`;

type Classes = Record<"unreadable" | "absent" | "otherTenant" | "random", unknown>;
/** Per tool, one argument object per id class. Built after the fake is reset, so the rows they name exist. */
function probes(next: () => number): Record<string, Classes> {
  const randomCollection = `collection-${randomHex(next, 32)}`;
  const randomDigest = `sha256:${randomHex(next, 64)}`;
  // R2: a proposal of another grant of the same person, of another tenant, and ids that name nothing.
  const otherGrantRow = { proposal_id: uuid(0x701), workspace_key: WS, agent_grant_id: OTHER_GRANT };
  const otherTenantRow = { proposal_id: uuid(0x702), workspace_key: OTHER_WS, agent_grant_id: GRANT };
  for (const fields of [otherGrantRow, otherTenantRow]) {
    proposals.set(fields.proposal_id, {
      ...fields, collection_id: null, action_type: "compile_plan", input: { documentIds: [DOC_A], quote: { rechargeCredits: 0, balanceRechargeCredits: 0, overageCredits: 0 } },
      input_sha256: `sha256:${"9".repeat(64)}`, evidence_ids: [], state: "proposed", expires_at: "2099-01-01T00:00:00Z", created_at: "2026-11-17T00:00:00Z",
      decided_at: null, binding_kind: "source_inventory", principal_kind: "agent", principal_id: PERSON, decided_by: null,
      expected_manifest_digest: `sha256:${"8".repeat(64)}`, idempotency_key: `agt_${fields.proposal_id}`, receipt: null, agent_client_label: "Claude", agent_grantor_email: null,
    });
  }
  const key = "client-key-1";
  return {
    get_proposal: { unreadable: { proposalId: otherGrantRow.proposal_id }, absent: { proposalId: uuid(0x7ff) },
      otherTenant: { proposalId: otherTenantRow.proposal_id }, random: { proposalId: randomUuid(next) } },
    get_compile_job: { unreadable: { jobId: JOB_HIDDEN }, absent: { jobId: `cjob-${"9".repeat(32)}` }, otherTenant: { jobId: JOB_FOREIGN },
      random: { jobId: `cjob-${randomHex(next, 32)}` } },
    list_candidates: { unreadable: { collectionId: COLLECTION_HIDDEN }, absent: { collectionId: `collection-${"0".repeat(32)}` },
      otherTenant: { collectionId: COLLECTION_FOREIGN }, random: { collectionId: randomCollection } },
    get_candidate_objects: { unreadable: { collectionId: COLLECTION_HIDDEN, manifestDigest: HIDDEN_DIGEST },
      absent: { collectionId: COLLECTION, manifestDigest: `sha256:${"0".repeat(64)}` },
      otherTenant: { collectionId: COLLECTION_FOREIGN, manifestDigest: FOREIGN_DIGEST }, random: { collectionId: randomCollection, manifestDigest: randomDigest } },
    propose_compile: { unreadable: { documentIds: [DOC_HIDDEN], idempotencyKey: key }, absent: { documentIds: [uuid(0x7fe)], idempotencyKey: key },
      otherTenant: { documentIds: [DOC_FOREIGN], idempotencyKey: key }, random: { documentIds: [randomUuid(next)], idempotencyKey: key } },
    propose_library_labels: Object.fromEntries((["unreadable", "absent", "otherTenant", "random"] as const).map((name) => [name, p3Args({
      items: [{ documentId: { unreadable: DOC_HIDDEN, absent: uuid(0x7fe), otherTenant: DOC_FOREIGN, random: randomUuid(next) }[name],
        labelKind: "topic", labelKey: "pricing", decision: "confirmed" }] })])) as Classes,
    propose_label_correction: { unreadable: p4Args({ collectionId: COLLECTION_HIDDEN, baseManifestDigest: HIDDEN_DIGEST }),
      absent: p4Args({ baseManifestDigest: `sha256:${"0".repeat(64)}` }), otherTenant: p4Args({ collectionId: COLLECTION_FOREIGN, baseManifestDigest: FOREIGN_DIGEST }),
      random: p4Args({ collectionId: randomCollection, baseManifestDigest: randomDigest }) },
  };
}

describe("I-17: absent, unreadable, another tenant's and random ids answer byte-identically, under every reader outage", () => {
  const outages = Object.keys(NO_OUTAGE).filter((name) => name !== "storeThrows") as (keyof Outages)[];
  const scenarios: [string, Partial<Outages>][] = [["no outage", {}],
    ...outages.flatMap((name) => [[`${name} down`, { [name]: true }], [`${name} throws`, { [name]: "throw" }]] as [string, Partial<Outages>][]),
    ["the store throws", { storeThrows: true }]];
  const TOOLS = ["get_proposal", "get_compile_job", "list_candidates", "get_candidate_objects", "propose_compile", "propose_library_labels", "propose_label_correction"];

  it.each(TOOLS)("%s", async (tool) => {
    for (const [scenario, outage] of scenarios) {
      for (const seed of [1, 2, 3]) {
        reset(outage);
        const classes = probes(seeded(seed))[tool]!;
        const answers: Record<string, unknown> = {};
        for (const [name, args] of Object.entries(classes)) answers[name] = await snapshot(await toolCall(tool, args, 7));
        const [first, ...rest] = Object.values(answers);
        for (const [index, other] of rest.entries()) {
          expect(other, `${tool}, ${scenario}, seed ${seed}: ${Object.keys(answers)[index + 1]} differs from ${Object.keys(answers)[0]}`).toEqual(first);
        }
        // Nothing is created for an id the person cannot use, whatever the outage, and a refusal writes nothing (I-1).
        expect(calls.filter((call) => call.path.endsWith("/create_world_change_proposal")), `${tool}, ${scenario}`).toEqual([]);
        expectOnlyReadsAndTheProposalRow();
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The line (§3): a failure of a read that decides whether an id names something this person can read is NOT_FOUND;
// a failure after that decision is what it is (UNAVAILABLE). Both sides, every id-taking tool, every reader down and
// throwing. Mutants: fold every UNAVAILABLE of a tool into NOT_FOUND (the "after" side fails); answer UNAVAILABLE
// for a reader outage before the decision (the "decides" side fails).
// ---------------------------------------------------------------------------------------------------------------

/** One of this grant's proposals, over a readable document: what R2 can read. */
function ownProposal(): string {
  const id = uuid(0x703);
  proposals.set(id, {
    proposal_id: id, workspace_key: WS, agent_grant_id: GRANT, collection_id: null, action_type: "compile_plan",
    input: { documentIds: [DOC_A], quote: { rechargeCredits: 0, balanceRechargeCredits: 0, overageCredits: 0 } }, input_sha256: `sha256:${"9".repeat(64)}`,
    evidence_ids: [], state: "proposed", expires_at: "2099-01-01T00:00:00Z", created_at: "2026-11-17T00:00:00Z", decided_at: null,
    binding_kind: "source_inventory", principal_kind: "agent", principal_id: PERSON, decided_by: null, expected_manifest_digest: `sha256:${"8".repeat(64)}`,
    idempotency_key: `agt_${id}`, receipt: null, agent_client_label: "Claude", agent_grantor_email: null,
  });
  return id;
}

/** Per tool: arguments naming something readable and present, the readers that decide that, and the readers after. */
const LINE: Record<string, { readable: () => unknown; decides: (keyof Outages)[]; after: (keyof Outages)[] }> = {
  get_proposal: { readable: () => ({ proposalId: ownProposal() }), decides: ["proposals"], after: ["access"] },
  get_compile_job: { readable: () => ({ jobId: JOB }), decides: ["jobs", "access"], after: [] },
  list_candidates: { readable: () => ({ collectionId: COLLECTION }), decides: ["candidates", "access"], after: ["review", "active"] },
  get_candidate_objects: { readable: () => ({ collectionId: COLLECTION, manifestDigest: CANDIDATE }), decides: ["candidates", "access"], after: ["model", "active"] },
  propose_compile: { readable: () => ({ documentIds: [DOC_A], idempotencyKey: "client-key-1" }), decides: ["access", "inventory"], after: ["quote", "proposals"] },
  propose_library_labels: { readable: () => p3Args(), decides: ["access", "library"], after: ["active", "proposals"] },
  propose_label_correction: { readable: () => p4Args(), decides: ["candidates", "access"], after: ["review", "model", "proposals"] },
};

describe("the line: a failed existence-deciding read is NOT_FOUND, a failure after the decision is UNAVAILABLE", () => {
  it.each(Object.keys(LINE))("%s", async (tool) => {
    const { readable, decides, after } = LINE[tool]!;
    reset();
    expect((await answerOf(await toolCall(tool, readable()))).ok, `${tool}, nothing down`).toBe(true);
    for (const mode of [true, "throw"] as const) {
      for (const reader of decides) {
        // A readable, present id and an absent one answer byte-identically: NOT_FOUND.
        reset({ [reader]: mode });
        const absent = await snapshot(await toolCall(tool, probes(seeded(1))[tool]!.absent, 7));
        reset({ [reader]: mode });
        const present = await snapshot(await toolCall(tool, readable(), 7));
        expect(present, `${tool}: ${reader} ${String(mode)}`).toEqual(absent);
        expect(JSON.parse(present.body).result, `${tool}: ${reader} ${String(mode)}`).toEqual({ content: [{ type: "text", text: "NOT_FOUND" }], isError: true });
        expect(calls.filter((call) => call.path.endsWith("/create_world_change_proposal"))).toEqual([]);
      }
      for (const reader of after) {
        reset({ [reader]: mode });
        expect(await answerOf(await toolCall(tool, readable())), `${tool}: ${reader} ${String(mode)}`).toEqual({ ok: false, code: "UNAVAILABLE" });
      }
    }
  });
});

/*
  WO-AN-8: whether NOT_FOUND came from a deciding read that failed is an internal fact. The server log says it
  (`decidingReadFailed`); the agent's answer does not. For every id-taking tool and every reader that decides, down
  and throwing: an absent id with nothing down and a readable id whose deciding reader failed answer byte-identically,
  and their log events differ only in that field. Mutant: copy the field into the body.
*/
describe("the deciding-read flag is in the server log only", () => {
  it.each(Object.keys(LINE))("%s", async (tool) => {
    const { readable, decides } = LINE[tool]!;
    const lines: string[] = [];
    vi.mocked(console.info).mockImplementation((line: string) => { lines.push(line); });
    for (const reader of decides) {
      for (const mode of [true, "throw"] as const) {
        lines.length = 0;
        reset();
        const absent = await snapshot(await toolCall(tool, probes(seeded(1))[tool]!.absent, 7));
        reset({ [reader]: mode });
        const failed = await snapshot(await toolCall(tool, readable(), 7));
        expect(failed, `${tool}: ${reader} ${String(mode)}`).toEqual(absent);
        expect(failed.body).not.toContain("decidingReadFailed");
        expect(lines.map((line) => JSON.parse(line)), `${tool}: ${reader} ${String(mode)}`).toEqual([
          { event: "agent_mcp_tool", tool, code: "NOT_FOUND", decidingReadFailed: false },
          { event: "agent_mcp_tool", tool, code: "NOT_FOUND", decidingReadFailed: true },
        ]);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// I-21
// ---------------------------------------------------------------------------------------------------------------

describe("I-21: injected text can create a proposal and nothing more", () => {
  it.each(PROMPT_INJECTION_FIXTURES.map((fixture) => [fixture.id, fixture.payload]))("%s as P4 `after` and as P3 `labelKey`", async (_id, payload) => {
    const after = payload.slice(0, 500).trim();
    const labelKey = payload.slice(0, 64).trim();
    const patch = await answerOf(await toolCall("propose_label_correction", p4Args({ after, idempotencyKey: "client-key-p4" })));
    const labels = await answerOf(await toolCall("propose_library_labels", p3Args({ idempotencyKey: "client-key-p3",
      items: [{ documentId: DOC_A, labelKind: "topic", labelKey, decision: "confirmed" }] })));
    expect(patch).toMatchObject({ ok: true, output: { state: "proposed", actionType: "ontology_label_patch", preview: { after } } });
    expect(labels).toMatchObject({ ok: true, output: [{ state: "proposed", actionType: "library_label", preview: { labelKey } }] });
    expect([...proposals.values()].map((row) => [row.state, row.principal_kind, row.agent_grant_id]))
      .toEqual([["proposed", "agent", GRANT], ["proposed", "agent", GRANT]]);
    expectOnlyReadsAndTheProposalRow();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Source tests
// ---------------------------------------------------------------------------------------------------------------

const NEXTJS = resolve(import.meta.dirname, "..");
const REPO = resolve(NEXTJS, "..");
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", ".next", ".git", "coverage", "test-results", "playwright-report"].includes(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : /\.(ts|tsx|mts|mjs|js|cjs|json|md|sql|yml|yaml|html|txt)$/.test(entry.name) ? [path] : [];
  });
}
const sourceFiles = (dirs: readonly string[]) => dirs.flatMap((dir) => {
  try { return statSync(dir).isDirectory() ? filesUnder(dir) : []; } catch { return []; }
});
const isTest = (path: string) => /\.test\.|\.spec\.|[\\/]e2e[\\/]|[\\/]tests?[\\/]/.test(path);

/*
  Limit of the cases that scan the tree (re-derived, WO-CI-37; the rule of this file is that no limit moves
  without a measurement). Alone, warm: 0.14-0.31 s per case; the first run after the file cache is cold: 3.05 s
  (receipts/WO-CI-37/idle.txt); with 24 busy loops on 12 cores 0.14-0.22 s (loaded.txt); in the lead's joint
  run under load "no auto-activation switch exists anywhere" took 8.22 s and failed the default 5 s
  (receipts/joint-fnd-qa3/summary.txt). The slowest measurement is 8.22 s; the limit is 30 s, about 3.6 times
  that, so a loaded builder passes and a scan that really hangs still fails. The walk is not repeated per
  case in a way that costs time (a warm walk of the whole tree is 0.2 s), so it is not made cheaper.
*/
const SCAN_TIMEOUT_MS = 30_000;

describe("source tests", () => {
  it("the string /api/agent-mcp appears only in the agent route, lib/agent-*, the Agent access panel, tests and four named files", () => {
    /*
      The four named files: the route's own classification row (this work order adds it), the audience switch of
      developer-auth.ts and developer-store.ts (WO-AN-3), whose comments name the one route an agent credential serves,
      and scripts/repair-scope.mjs, which owns the route's files by path (every occurrence is checked below).
    */
    const allowed = (path: string) => {
      const rel = relative(NEXTJS, path).replaceAll("\\", "/");
      return rel.startsWith("app/api/agent-mcp/") || /^lib\/agent-[^/]+$/.test(rel) || rel === "components/workspace/agent-access-panel.tsx"
        || isTest(rel) || ["lib/security/route-classification.json", "lib/developer-auth.ts", "lib/developer-store.ts", "scripts/repair-scope.mjs"].includes(rel);
    };
    const offenders = sourceFiles(["app", "lib", "components", "public", "scripts", "content", "data"].map((dir) => join(NEXTJS, dir)))
      .filter((path) => !allowed(path) && readFileSync(path, "utf8").includes("/api/agent-mcp"))
      .map((path) => relative(NEXTJS, path));
    expect(offenders).toEqual([]);
  }, SCAN_TIMEOUT_MS);

  it("every /api/agent-mcp in scripts/repair-scope.mjs sits inside a quoted owned path", () => {
    const text = readFileSync(join(NEXTJS, "scripts/repair-scope.mjs"), "utf8");
    const route = "/api/agent-mcp";
    const inQuotedPath = /'app\/api\/agent-mcp\/[^'\s]*'/g;
    expect(text).toContain(route);
    expect(text.replace(inQuotedPath, "").includes(route)).toBe(false);
    // Mutation: the same text outside a quoted path must be caught.
    expect(`// see ${route} in prose`.replace(inQuotedPath, "").includes(route)).toBe(true);
  });

  it("no auto-activation switch exists anywhere", () => {
    const name = ["TAVONEL", "AGENT", "AUTO", "ACTIVATION"].join("_");
    const self = resolve(import.meta.filename);
    const offenders = sourceFiles([NEXTJS, join(REPO, "supabase"), join(REPO, "docs"), join(REPO, ".github")])
      .filter((path) => path !== self && readFileSync(path, "utf8").includes(name)).map((path) => relative(REPO, path));
    expect(offenders).toEqual([]);
  }, SCAN_TIMEOUT_MS);

  it("the OpenAPI document and public/developer/** say nothing of agent-mcp (mutant: add a path)", async () => {
    const { GET: openApi } = await import("@/app/api/openapi/route");
    const spec = await (await openApi(new Request("https://tavonel.test/api/openapi"))).text();
    expect(spec.length).toBeGreaterThan(1000);
    expect(spec).not.toContain("agent-mcp");
    const published = sourceFiles([join(NEXTJS, "public", "developer")]);
    expect(published.length).toBeGreaterThan(0);
    expect(published.filter((path) => readFileSync(path, "utf8").includes("agent-mcp")).map((path) => relative(NEXTJS, path))).toEqual([]);
  }, SCAN_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------------------------------------------
// The founder flow of §1 on one agent credential
// ---------------------------------------------------------------------------------------------------------------

describe("the founder flow runs on one agent credential with no /api/mcp call", () => {
  it("status → documents → propose compile → (person confirms) → proposal + job → candidates → objects → correction → labels", async () => {
    const fetched = vi.spyOn(globalThis, "fetch");
    const ok = async (name: string, args: unknown) => {
      const answer = await answerOf(await toolCall(name, args));
      if (!answer.ok) throw new Error(`${name}: ${answer.code}`);
      return answer.output as Row;
    };
    expect((await (await post({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} })).json()).result.serverInfo).toBeTruthy();
    await ok("get_workflow_status", {});
    const listed = (await ok("list_documents", {})).documents as { documentId: string }[];
    const readable = listed.map((row) => row.documentId);
    expect(readable).toEqual([DOC_A, DOC_B]);
    const compile = await ok("propose_compile", { documentIds: readable, idempotencyKey: "founder-compile-1" });
    expect(compile.confirmUrl).toBe(`/workspace/changes?proposal=${compile.proposalId}`);

    // The person confirms in the app (the decision path's own suites); the compile ran and the outcome is recorded.
    const signedReceipt = { payloadJson: JSON.stringify({ schemaVersion: "tavonel.action_receipt.v1", proposalId: compile.proposalId,
      outcome: "executed", resultRef: { jobId: JOB } }), signature: { alg: "Ed25519" } };
    Object.assign(proposals.get(compile.proposalId as string)!, { state: "executed", decided_by: PERSON, decided_at: "2026-11-17T01:00:00Z", receipt: { signedReceipt } });

    const done = await ok("get_proposal", { proposalId: compile.proposalId });
    expect(done.state).toBe("executed");
    expect(JSON.parse((done.receipt as { payload: string }).payload).resultRef).toEqual({ jobId: JOB });
    const ready = await ok("get_compile_job", { jobId: JOB });
    expect(ready.state).toBe("ready");
    const collectionId = ready.collectionId as string;
    const lineage = await ok("list_candidates", { collectionId });
    const candidate = (lineage.candidates as { manifestDigest: string; state: string }[]).find((row) => row.state !== "active")!;
    const objects = await ok("get_candidate_objects", { collectionId, manifestDigest: candidate.manifestDigest });
    const target = (objects.objects as { objectId: string; label: string }[])[0]!;
    const correction = await ok("propose_label_correction", { collectionId, baseManifestDigest: candidate.manifestDigest, objectId: target.objectId,
      before: target.label, after: "Corrected label", evidenceId: "ev-1", idempotencyKey: "founder-correction-1" });
    expect(correction.state).toBe("proposed");
    const status = await ok("get_workflow_status", {});
    const world = (status.worlds as { collectionId: string; manifestDigest: string }[]).find((row) => row.collectionId === collectionId)!;
    const labels = await ok("propose_library_labels", { collectionId, expectedManifestDigest: world.manifestDigest, idempotencyKey: "founder-labels-1",
      items: [{ documentId: DOC_A, labelKind: "doc_type", labelKey: "invoice", decision: "confirmed" }] });
    expect(labels).toHaveLength(1);

    const bearers = new Set(authorize.mock.calls.map((call) => (call[0] as Request).headers.get("authorization")));
    expect(bearers).toEqual(new Set([`Bearer ${TOKEN}`]));
    expect(fetched).not.toHaveBeenCalled();
    expect(calls.some((call) => call.path.includes("/api/mcp"))).toBe(false);
    expect((status.proposals as unknown[]).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// I-1 over the real readers: every reader module real, only the transport faked
// ---------------------------------------------------------------------------------------------------------------

/*
  The suite above replaces the reader modules with fakes, so it sees what the tools ask of the readers, not what the
  readers then ask of the store. Here they are the real modules, and only supabaseAdminRequest, the R2 primitives,
  fetch and the compile POST are faked (authorization stays the stub: its own suite is lib/developer-auth.test.ts).
  The customer-data gates are the exception in the success pass: they verify signed gate receipts, so there they
  admit; the second test runs them real, over the transport, where with no accepted terms they refuse.
  Every tool is driven to success and to each refusal it can reach from this state, and after every call the store
  calls must be reads named on the exact read list plus the proposal row. Mutant: a real reader that also calls a
  writing RPC (record_library_organize from readLibraryDocuments, say) fails here.
*/
const REAL_READERS = ["@/lib/connector-source-access", "@/lib/library-shadow", "@/lib/world-store", "@/lib/compile-job-store", "@/lib/world-read-model",
  "@/lib/customer-source-lifecycle", "@/lib/customer-source-scope", "@/lib/collection-storage"];

describe("I-1 over the real readers: only the transport is faked", () => {
  let realPost: typeof POST;
  const fetched: string[] = [];
  const REAL = ARTIFACT.collectionId;
  beforeAll(async () => {
    for (const path of REAL_READERS) vi.doUnmock(path);
    vi.resetModules();
    ({ POST: realPost } = await import("@/app/api/agent-mcp/route"));
  });
  afterAll(() => { realStore = false; realGate = false; });
  beforeEach(() => {
    realStore = true;
    realGate = false;
    fetched.length = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => { fetched.push(String(url)); return new Response(null, { status: 503 }); });
    // The candidate the real storage reads is ARTIFACT, so the collection is its own id.
    candidates.set(`${WS}|${REAL}`, candidates.get(`${WS}|${COLLECTION}`)!);
    actives.set(`${WS}|${REAL}`, actives.get(`${WS}|${COLLECTION}`)!);
    jobs[0]!.collectionId = REAL;
  });

  const call = async (name: string, args: unknown) => answerOf(await realPost(new Request("https://tavonel.test/api/agent-mcp", {
    method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })));
  const p3 = (fields: Row = {}) => p3Args({ collectionId: REAL, ...fields });
  // An evidence id as the agent reads it: from the real read model, through R5 (set by the test before P4 runs).
  let evidenceId = "";
  const p4 = (fields: Row = {}) => p4Args({ collectionId: REAL, evidenceId, ...fields });

  /** [tool, arguments, expected answer: "ok" or the refusal code]. */
  const CASES: [string, () => unknown, string][] = [
    ["get_workflow_status", () => ({}), "ok"],
    ["list_documents", () => ({}), "ok"],
    ["get_compile_job", () => ({ jobId: JOB }), "ok"],
    ["get_compile_job", () => ({ jobId: JOB_HIDDEN }), "NOT_FOUND"],
    ["get_compile_job", () => ({ jobId: `cjob-${"9".repeat(32)}` }), "NOT_FOUND"],
    ["list_candidates", () => ({ collectionId: REAL }), "ok"],
    ["list_candidates", () => ({ collectionId: COLLECTION_HIDDEN }), "NOT_FOUND"],
    ["get_candidate_objects", () => ({ collectionId: REAL, manifestDigest: CANDIDATE }), "ok"],
    ["get_candidate_objects", () => ({ collectionId: REAL, manifestDigest: `sha256:${"0".repeat(64)}` }), "NOT_FOUND"],
    ["propose_compile", () => ({ documentIds: [DOC_A, DOC_B], idempotencyKey: "client-key-1" }), "ok"],
    ["propose_compile", () => ({ documentIds: [DOC_HIDDEN], idempotencyKey: "client-key-2" }), "NOT_FOUND"],
    ["propose_compile", () => ({ documentIds: [uuid(0x7fe)], idempotencyKey: "client-key-3" }), "NOT_FOUND"],
    ["propose_library_labels", () => p3(), "ok"],
    ["propose_library_labels", () => p3({ expectedManifestDigest: `sha256:${"e".repeat(64)}`, idempotencyKey: "client-key-4" }), "PROPOSAL_BASE_NOT_HEAD"],
    ["propose_library_labels", () => p3({ idempotencyKey: "client-key-5", items: [{ documentId: DOC_HIDDEN, labelKind: "topic", labelKey: "pricing",
      decision: "confirmed" }] }), "NOT_FOUND"],
    ["propose_label_correction", () => p4(), "ok"],
    ["propose_label_correction", () => p4({ before: "not the label", idempotencyKey: "client-key-6" }), "PATCH_BEFORE_MISMATCH"],
    ["propose_label_correction", () => p4({ collectionId: COLLECTION_HIDDEN, baseManifestDigest: HIDDEN_DIGEST, idempotencyKey: "client-key-7" }), "NOT_FOUND"],
  ];

  it("every tool, to success and to each refusal: only exact-name reads, GETs and the proposal row; fetch never called", async () => {
    const seen = new Set<string>();
    const objects = await call("get_candidate_objects", { collectionId: REAL, manifestDigest: CANDIDATE });
    evidenceId = (objects as { output: { objects: { evidenceIds: string[] }[] } }).output.objects.flatMap((object) => object.evidenceIds)[0]!;
    for (const [tool, args, expected] of CASES) {
      calls.length = 0;
      r2Calls.length = 0;
      const answer = await call(tool, args());
      expect(answer.ok ? "ok" : answer.code, `${tool} ${JSON.stringify(args())} ${calls.map((entry) => `${entry.method} ${entry.path}`).join(" | ")}`).toBe(expected);
      expectOnlyReadsAndTheProposalRow();
      for (const entry of calls) seen.add(`${entry.method} ${entry.path.split("?")[0]}`);
    }
    // A real get_proposal of the first created row, and of a random id.
    const first = [...proposals.keys()][0]!;
    expect((await call("get_proposal", { proposalId: first })).ok).toBe(true);
    expect(await call("get_proposal", { proposalId: uuid(0x7ff) })).toEqual({ ok: false, code: "NOT_FOUND" });
    expectOnlyReadsAndTheProposalRow();
    expect(calls.filter((entry) => entry.path.endsWith("/create_world_change_proposal")).length).toBe(0);
    expect(fetched).toEqual([]);
    expect(postCompile).not.toHaveBeenCalled();
    // The real readers were reached: the reads §8 names are observed, not only assumed.
    expect([...seen]).toEqual(expect.arrayContaining(["POST /rest/v1/rpc/connector_documents_blocked", "POST /rest/v1/rpc/read_library_organize",
      "POST /rest/v1/rpc/list_collection_candidates", "POST /rest/v1/rpc/quote_foundation_compile_recharge"]));
  });

  /*
    WO-AN-8: I-1 with authorization real as well. authorizeAgentRequest runs unmocked (key, grant, pilot, membership,
    owner grant, rate window) over the same transport, for a read tool, a listing and a proposal. The writes are
    exactly one rate-window unit per call and the one proposal row. Mutant: an authorization step that writes (the
    key's last_used_at by PATCH, say) fails here.
  */
  it("with authorizeAgentRequest real too: one rate-window unit per call and the proposal row, nothing else written", async () => {
    authorize.mockImplementation((await vi.importActual<typeof import("./developer-auth")>("./developer-auth")).authorizeAgentRequest);
    vi.stubEnv("FOUNDATION_PILOT_USER_IDS", PERSON);
    vi.stubEnv("TAVONEL_AGENT_PROPOSALS_COHORT", AUTH_WS);
    vi.stubEnv("TAVONEL_PROCESSING_WORKSPACE_COHORT", AUTH_WS);
    inventories.set(AUTH_WS, inventories.get(WS)!);
    library.set(AUTH_WS, library.get(WS)!);
    actives.set(`${AUTH_WS}|${REAL}`, actives.get(`${WS}|${COLLECTION}`)!);
    calls.length = 0;
    const seen = new Set<string>();
    for (const [tool, args] of [["get_workflow_status", {}], ["list_documents", {}],
      ["propose_compile", { documentIds: [DOC_A, DOC_B], idempotencyKey: "client-key-auth" }]] as const) {
      const answer = await call(tool, args);
      expect(answer.ok ? "ok" : answer.code, tool).toBe("ok");
    }
    expectOnlyReadsAndTheProposalRow();
    for (const entry of calls) seen.add(`${entry.method} ${entry.path.split("?")[0]}`);
    expect([...seen]).toEqual(expect.arrayContaining(["GET /rest/v1/foundation_api_keys", "POST /rest/v1/rpc/read_foundation_agent_grant",
      "GET /rest/v1/foundation_workspace_members", "GET /rest/v1/foundation_account_access_grants"]));
    expect(calls.filter((entry) => entry.path.endsWith("/consume_foundation_api_rate_limit")).map((entry) => entry.body!.p_scope))
      .toEqual(["agent:read", "agent:read", "agent:propose"]);
    const created = calls.filter((entry) => entry.path.endsWith("/create_world_change_proposal"));
    expect(created.map((entry) => [entry.body!.p_workspace_key, entry.body!.p_principal_kind, entry.body!.p_agent_grant_id]))
      .toEqual([[AUTH_WS, "agent", GRANT]]);
    expect(fetched).toEqual([]);
  });

  it("with the customer-data gate on v2 and no accepted terms: the gate's reads are reads, and its refusals write nothing", async () => {
    realGate = true;
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "a".repeat(40));
    const seen = new Set<string>();
    for (const [tool, args] of [["propose_compile", { documentIds: [DOC_A], idempotencyKey: "client-key-8" }],
      ["get_candidate_objects", { collectionId: REAL, manifestDigest: CANDIDATE }],
      ["propose_label_correction", p4({ evidenceId: "ev-1", idempotencyKey: "client-key-9" })]] as const) {
      calls.length = 0;
      const answer = await call(tool, args);
      expect(answer, tool).toEqual({ ok: false, code: tool === "propose_compile" ? "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE" : "NOT_FOUND" });
      expectOnlyReadsAndTheProposalRow();
      for (const entry of calls) seen.add(`${entry.method} ${entry.path.split("?")[0]}`);
    }
    // The gates ran for real: their own reads are observed.
    expect([...seen]).toEqual(expect.arrayContaining(["GET /rest/v1/connector_document_bindings", "GET /rest/v1/foundation_intake_admissions",
      "GET /rest/v1/customer_data_workspace_decisions"]));
  });
});
