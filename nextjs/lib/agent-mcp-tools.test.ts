import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileCollectionCandidate, type CollectionOcrInput } from "./collection-compiler";

/*
  The nine agent tools (workorders/agent-native.md §3; WO-AN-5). The store below behaves as the migrations do for
  what the tools call (proposals by id/page/create, the candidate list, the quote, review decisions); the readers
  around it are fakes over one in-memory workspace. Access is per document: `unreadable` ids are denied.
*/

type Row = Record<string, unknown>;
type Call = { method: string; path: string; body: Record<string, unknown> | null };

const WS = "pilot-a";
const PERSON = "7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a";
const GRANT = "9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a";
const OTHER_GRANT = "9b9b9b9b-9b9b-4b9b-8b9b-9b9b9b9b9b9b";
const doc = (n: number) => `0a000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const DOC_A = doc(10);
const DOC_B = doc(11);
const COLLECTION = `collection-${"c".repeat(32)}`;
const ACTIVE = `sha256:${"a".repeat(64)}`;
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

let calls: Call[];
let unreadable: Set<string>;
let accessDown: boolean;
let documents: Map<string, { version: string; addedAt: string }>;
let tombstoned: Set<string>;
let refused: string[];
let stored: string[];
let actives: Map<string, { manifestDigest: string; revision: number }>;
let jobs: Row[];
let candidates: Map<string, Row[]>;
let corrections: { base: string; result: string }[];
let proposals: Map<string, Row>;
let sourceVersions: Record<string, string>;
let nextId: number;

const job = (fields: Row = {}): Row => ({
  jobId: JOB, workspaceKey: WS, createdByUserId: PERSON, authorizationRevision: 3, documentIds: [DOC_A], state: "ready", collectionId: COLLECTION,
  errorCode: null, blocked: [], blockedResolution: null, documentsTotal: 1, documentsReady: 1, corpusId: null, batchIndex: null, batchCount: null,
  createdAt: "2026-11-17T00:00:00Z", updatedAt: "2026-11-17T00:00:00Z", settledAt: null, ...fields,
});

const checkAccess = vi.fn(async (_ws: string, ids: string[]) => {
  if (accessDown) return { ok: false, code: "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE" };
  return ids.some((id) => unreadable.has(id)) ? { ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" } : { ok: true };
});

vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccessForViewer: checkAccess, checkConnectorSourceAccess: checkAccess }));
vi.mock("@/app/api/compile-jobs/route", () => ({ POST: vi.fn() }));
vi.mock("@/lib/customer-data-admission", () => ({ canAdmitCustomerSource: async () => true }));
vi.mock("@/lib/customer-source-scope", () => ({ readCustomerSourceScope: async () => ({ ok: true, scope: "direct_upload" }) }));
vi.mock("@/lib/derived-data-admission", () => ({ admitsDerivedCustomerData: async () => true }));
vi.mock("@/lib/developer-auth", () => ({ requireFoundationSession: vi.fn(), revalidateFoundationSession: vi.fn() }));
vi.mock("@/lib/world-store", () => ({
  listFoundationActiveWorlds: async () => ({ ok: true, nextCursor: null,
    worlds: [...actives].map(([collectionId, world]) => ({ collectionId, ...world, updatedAt: "2026-11-17T00:00:00Z" })) }),
  getFoundationActiveWorld: async (_ws: string, collectionId: string) => {
    const world = actives.get(collectionId);
    return world ? { ok: true, world: { collectionId, ...world } } : { ok: false, code: "ACTIVE_WORLD_NOT_FOUND" };
  },
}));
vi.mock("@/lib/compile-job-store", async (original) => ({
  ...await original<typeof import("./compile-job-store")>(),
  listWorkspaceCompileJobs: async () => ({ ok: true, value: jobs }),
  readCompileJob: async (ws: string, jobId: string) => {
    const found = jobs.find((item) => item.jobId === jobId && item.workspaceKey === ws);
    return found ? { ok: true, value: found } : { ok: false, code: "COMPILE_JOB_NOT_FOUND" };
  },
}));
vi.mock("@/lib/world-read-model", () => ({
  loadWorldReadModel: async (_ws: string, _collection: string, digest: string) => ({ ok: true, model: {
    world: { manifestDigest: digest }, evidence: [EVIDENCE],
    objects: [
      { id: "obj-b", type: "Entity", label: "ACME", evidenceRefs: Array.from({ length: 20 }, (_, i) => `ev-${i}`) },
      { id: "obj-a", type: "Topic", label: "Payment", evidenceRefs: ["ev-1"] },
      { id: "doc-1", type: "Document", label: "Invoice.pdf", evidenceRefs: [] },
    ],
  } }),
}));
vi.mock("@/lib/collection-storage", () => ({
  loadPreferredCollectionCandidate: async () => ({ ok: true, value: { key: "k", artifact: structuredClone(ARTIFACT) } }),
}));
vi.mock("@/lib/r2-objects", async (original) => ({
  ...await original<typeof import("./r2-objects")>(),
  listImmutableWorkspaceObjects: async () => ({ ok: true, objects: [...documents].map(([id, { version, addedAt }]) => ({
    key: `immutable/${WS}/${WS}/${id}/${version}/sanitized.pdf`, size: 10, lastModified: addedAt })) }),
  putWorkspaceCollectionCandidate: vi.fn(),
}));
vi.mock("@/lib/r2-synthetic-canary", async (original) => ({
  ...await original<typeof import("./r2-synthetic-canary")>(),
  readR2SignerEnv: () => ({ bucket: "b" }),
  listFoundationQuarantineRejects: async () => ({ ok: true, documentIds: refused, storedDocumentIds: stored, truncated: false }),
}));
vi.mock("@/lib/customer-source-lifecycle", async (original) => ({
  ...await original<typeof import("./customer-source-lifecycle")>(),
  readTombstonedUploadDocumentIds: async () => ({ ok: true, ids: tombstoned }),
}));
vi.mock("@/lib/library-shadow", async (original) => ({
  ...await original<typeof import("./library-shadow")>(),
  readLibraryDocuments: async (_ws: string, ids: string[]) => ({ ok: true, documents: [],
    sourceVersions: Object.fromEntries(ids.filter((id) => sourceVersions[id]).map((id) => [id, sourceVersions[id]!])) }),
}));
vi.mock("@/lib/supabase-admin", () => ({
  readSupabaseAdminConfig: () => ({}),
  supabaseAdminRequest: async (_config: unknown, path: string, init: { method?: string; body?: string } = {}) => {
    const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ method: init.method ?? "GET", path, body });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (path.startsWith("/rest/v1/foundation_review_decisions?")) {
      const query = new URLSearchParams(path.split("?")[1]);
      const base = query.get("manifest_digest")?.replace(/^eq\./, "");
      const result = query.get("resulting_manifest_digest")?.replace(/^eq\./, "");
      if (base) return json(corrections.filter((row) => row.base === base).map(() => ({ decision_id: "d" })));
      return json(corrections.filter((row) => row.result === result).map((row) => ({ manifest_digest: row.base })));
    }
    const name = path.replace("/rest/v1/rpc/", "");
    if (name === "list_collection_candidates") return json(candidates.get(body!.p_collection_id as string) ?? []);
    if (name === "quote_foundation_compile_recharge") {
      return json({ reservations: [], totalRechargeCredits: 0, balanceRechargeCredits: 0, overageCredits: 0, balanceCredits: 100 });
    }
    if (name === "get_world_change_proposal") {
      const row = proposals.get(body!.p_proposal_id as string);
      return row && row.workspace_key === body!.p_workspace_key ? json(row) : json({ message: "proposal_not_found" }, 400);
    }
    if (name === "list_world_change_proposals_page") {
      return json([...proposals.values()].filter((row) => row.workspace_key === body!.p_workspace_key
        && (body!.p_agent_grant_id === null || row.agent_grant_id === body!.p_agent_grant_id)).slice(0, body!.p_limit as number));
    }
    if (name === "create_world_change_proposal") {
      const existing = [...proposals.values()].find((row) => row.idempotency_key === body!.p_idempotency_key);
      if (existing) return json({ proposal: existing, replayed: true });
      nextId += 1;
      const row = {
        proposal_id: `00000000-0000-4000-8000-${nextId.toString(16).padStart(12, "0")}`, workspace_key: body!.p_workspace_key,
        collection_id: body!.p_collection_id, action_type: body!.p_action_type, input: body!.p_input, input_sha256: body!.p_input_sha256,
        evidence_ids: body!.p_evidence_ids, state: "proposed", expires_at: body!.p_expires_at, created_at: `2026-11-17T00:00:${String(nextId).padStart(2, "0")}Z`,
        decided_at: null, binding_kind: body!.p_binding_kind, principal_kind: body!.p_principal_kind, principal_id: body!.p_principal_id,
        agent_grant_id: body!.p_agent_grant_id, decided_by: null, expected_manifest_digest: body!.p_expected_manifest_digest,
        idempotency_key: body!.p_idempotency_key, receipt: null, agent_client_label: "Claude", agent_grantor_email: null,
      };
      proposals.set(row.proposal_id, row);
      return json({ proposal: row, replayed: false });
    }
    return json({ message: `unexpected ${path}` }, 500);
  },
}));

const tools = await import("./agent-mcp-tools");
const { AGENT_PAGE, AGENT_ACL_SCAN_PAGES } = await import("./agent-access");

const principal = { kind: "agent", workspaceKey: WS, userId: PERSON, keyId: "k", grantId: GRANT, scopes: ["agent:read", "agent:propose"],
  authorizationRevision: 3, workspaceRole: "owner" } as const;
const context = { principal, request: new Request("https://tavonel.test/api/agent-mcp", { method: "POST" }) };

async function call(name: string, args?: unknown) {
  const tool = tools.agentTool(name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tools.callAgentTool(tool, context, args);
}
const output = async (name: string, args?: unknown) => {
  const result = await call(name, args);
  if (!result.ok) throw new Error(`${name} refused ${result.code}`);
  return result.output as Record<string, unknown>;
};
const creates = () => calls.filter((entry) => entry.path === "/rest/v1/rpc/create_world_change_proposal").length;

beforeEach(() => {
  checkAccess.mockClear();
  calls = [];
  unreadable = new Set();
  accessDown = false;
  documents = new Map([[DOC_A, { version: "a".repeat(64), addedAt: "2026-11-16T10:00:00.000Z" }], [DOC_B, { version: "b".repeat(64), addedAt: "2026-11-16T11:00:00.000Z" }]]);
  tombstoned = new Set();
  refused = [];
  stored = [];
  actives = new Map([[COLLECTION, { manifestDigest: ACTIVE, revision: 2 }]]);
  jobs = [job()];
  candidates = new Map([[COLLECTION, [
    { manifestDigest: CANDIDATE, registeredAt: "2026-11-17T00:00:00Z", documentIds: [DOC_A, DOC_B] },
    { manifestDigest: ACTIVE, registeredAt: "2026-11-16T00:00:00Z", documentIds: [DOC_A] },
  ]]]);
  corrections = [];
  proposals = new Map();
  sourceVersions = { [DOC_A]: "a".repeat(64), [DOC_B]: "b".repeat(64) };
  nextId = 0;
  vi.stubEnv("TAVONEL_LIBRARY_ORGANIZE_MODE", "on");
  vi.stubEnv("TAVONEL_PROCESSING_WORKSPACE_COHORT", WS);
  vi.stubEnv("TAVONEL_CUSTOMER_DATA_GATE_VERSION", "v2");
});
afterEach(() => vi.unstubAllEnvs());

describe("the tool table", () => {
  it("is the fixed nine and nothing that decides (I-3; mutant: add a tenth tool)", () => {
    expect(tools.AGENT_MCP_TOOLS.map((tool) => tool.name)).toEqual([
      "get_workflow_status", "get_proposal", "get_compile_job", "list_candidates", "get_candidate_objects", "list_documents",
      "propose_compile", "propose_library_labels", "propose_label_correction",
    ]);
    for (const name of ["confirm", "decide_proposal", "approve", "activate", "undo", "revoke", "cancel"]) expect(tools.agentTool(name)).toBeNull();
    expect(tools.agentTool("toString")).toBeNull();
  });

  it("annotates reads and proposals as §3 says, with agent scopes", () => {
    for (const tool of tools.AGENT_MCP_TOOLS) {
      if (tool.mode === "read") {
        expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
        expect(tool.scope).toBe("agent:read");
      } else {
        expect(tool.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
        expect(tool.scope).toBe("agent:propose");
      }
    }
  });

  it("every input schema refuses unknown keys, at every object level", () => {
    const objects = (schema: unknown): Record<string, unknown>[] => {
      if (!schema || typeof schema !== "object") return [];
      const node = schema as Record<string, unknown>;
      return [...(node.type === "object" ? [node] : []), ...Object.values(node).flatMap(objects)];
    };
    for (const tool of tools.AGENT_MCP_TOOLS) {
      for (const node of objects(tool.inputSchema)) expect(node.additionalProperties, tool.name).toBe(false);
    }
  });

  it("passes the capability-manifest self-check, and a table with a write mode or an unknown action does not", () => {
    expect(() => tools.assertAgentToolTable()).not.toThrow();
    const [first, ...rest] = tools.AGENT_MCP_TOOLS;
    expect(() => tools.assertAgentToolTable([{ ...first!, mode: "write" as "read" }, ...rest])).toThrow(/mode_not_allowed/);
    expect(() => tools.assertAgentToolTable([...rest, { ...rest[6]!, name: "x", proposalActionType: "merge_documents" }])).toThrow(/unknown_action/);
    expect(() => tools.assertAgentToolTable([...tools.AGENT_MCP_TOOLS, first!])).toThrow(/duplicate_tool/);
  });

  it("maps every internal code through one table; an unknown one is UNAVAILABLE", () => {
    expect(tools.agentCodeOf("PROPOSAL_TARGET_NOT_FOUND")).toBe("NOT_FOUND");
    expect(tools.agentCodeOf("ACTIVE_WORLD_NOT_FOUND")).toBe("WORLD_NOT_ACTIVE");
    expect(tools.agentCodeOf("PROPOSAL_STORE_FAILED")).toBe("UNAVAILABLE");
    expect(tools.agentCodeOf("constructor")).toBe("UNAVAILABLE");
    for (const code of tools.AGENT_ERROR_CODES) expect(tools.agentCodeOf(code)).toBe(code);
  });

  it("a handler that throws is UNAVAILABLE, never its message", async () => {
    const throwing = { ...tools.agentTool("list_documents")!, handler: async () => { throw new Error("secret detail"); } };
    expect(await tools.callAgentTool(throwing, context, {})).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
});

describe("inputs are bounded (I-22)", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => doc(i + 100));
  const item = { documentId: DOC_A, labelKind: "topic", labelKey: "pricing", decision: "confirmed" };
  const p3 = (fields: Row = {}) => ({ collectionId: COLLECTION, expectedManifestDigest: ACTIVE, items: [item], idempotencyKey: "client-key-1", ...fields });
  const p4 = (fields: Row = {}) => ({ collectionId: COLLECTION, baseManifestDigest: CANDIDATE, objectId: EDITABLE.id, before: EDITABLE.label,
    after: "Corrected", evidenceId: "ev-1", idempotencyKey: "client-key-1", ...fields });

  it.each([
    ["get_workflow_status", { extra: 1 }],
    ["get_proposal", { proposalId: doc(1), extra: 1 }],
    ["get_compile_job", { jobId: "cjob-xyz" }],
    ["list_candidates", { collectionId: "collection-short" }],
    ["get_candidate_objects", { collectionId: COLLECTION, manifestDigest: CANDIDATE, cursor: "-1" }],
    ["get_candidate_objects", { collectionId: COLLECTION, manifestDigest: CANDIDATE, kind: "Document" }],
    ["list_documents", { cursor: "x".repeat(65) }],
    ["list_documents", { workspaceKey: "pilot-b" }],
    ["propose_compile", { documentIds: [DOC_A], idempotencyKey: "client-key-1", userId: PERSON }],
    ["propose_compile", { documentIds: [DOC_A, DOC_A], idempotencyKey: "client-key-1" }],
    ["propose_compile", { documentIds: [], idempotencyKey: "client-key-1" }],
    ["propose_compile", { documentIds: [DOC_A], idempotencyKey: "short" }],
    ["propose_library_labels", p3({ items: [{ ...item, sourceVersionId: "a".repeat(64) }] })],
    ["propose_library_labels", p3({ items: [{ ...item, labelKey: "a\nb" }] })],
    ["propose_label_correction", p4({ after: "x".repeat(501) })],
    ["propose_label_correction", p4({ before: "x".repeat(501) })],
    ["propose_label_correction", p4({ kind: "Entity" })],
    ["get_proposal", "not an object"],
  ])("%s with %j is INPUT_INVALID", async (name, args) => {
    expect(await call(name, args)).toEqual({ ok: false, code: "INPUT_INVALID" });
    expect(creates()).toBe(0);
  });

  it("documentIds whose compile body would exceed 4,096 bytes are INPUT_INVALID before any read", async () => {
    // {"documentIds":[...]}: 18 + 39n - 1 bytes, so 104 ids are 4,073 bytes and 105 are 4,112.
    expect(Buffer.byteLength(JSON.stringify({ documentIds: ids(104) }))).toBe(4073);
    expect(await call("propose_compile", { documentIds: ids(105), idempotencyKey: "client-key-1" })).toEqual({ ok: false, code: "INPUT_INVALID" });
    expect(checkAccess).not.toHaveBeenCalled();
    // 104 passes validation and reaches the dry-run (absent documents there: the same not-found as any unknown id).
    expect(await call("propose_compile", { documentIds: ids(104), idempotencyKey: "client-key-1" })).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(checkAccess).toHaveBeenCalled();
    expect(creates()).toBe(0);
  });

  it("a P3 batch of 26 is INPUT_INVALID with no row (25 is the bound)", async () => {
    const many = Array.from({ length: 26 }, (_, i) => ({ ...item, documentId: doc(200 + i) }));
    expect(await call("propose_library_labels", p3({ items: many }))).toEqual({ ok: false, code: "INPUT_INVALID" });
    expect(creates()).toBe(0);
  });
});

describe("R1 get_workflow_status", () => {
  it("lists this grant's proposals only (mutant: list without the grant filter)", async () => {
    const mine = await output("propose_compile", { documentIds: [DOC_A], idempotencyKey: "client-key-1" }) as { proposalId: string };
    const other = { ...proposals.get(mine.proposalId)!, proposal_id: doc(999), agent_grant_id: OTHER_GRANT, idempotency_key: "agt_other" };
    proposals.set(other.proposal_id as string, other);
    const status = await output("get_workflow_status", {});
    expect((status.proposals as { proposalId: string }[]).map((row) => row.proposalId)).toEqual([mine.proposalId]);
    const page = calls.find((entry) => entry.path.endsWith("/list_world_change_proposals_page"))!;
    expect(page.body!.p_agent_grant_id).toBe(GRANT);
  });

  it("drops and does not count a job naming any unreadable document; the rest stay", async () => {
    jobs = [job(), job({ jobId: `cjob-${"2".repeat(32)}`, documentIds: [DOC_A, DOC_B] })];
    unreadable.add(DOC_B);
    const status = await output("get_workflow_status", {});
    expect((status.jobs as { jobId: string }[]).map((row) => row.jobId)).toEqual([JOB]);
  });

  it("names worlds, jobs with collectionId, and the app links", async () => {
    const status = await output("get_workflow_status");
    expect(status.worlds).toEqual([{ collectionId: COLLECTION, manifestDigest: ACTIVE, revision: 2 }]);
    expect(status.jobs).toEqual([{ jobId: JOB, state: "ready", collectionId: COLLECTION, documentsTotal: 1, documentsReady: 1, blockedCount: 0, resting: false }]);
    expect(status.links).toEqual({ addFiles: "/workspace/sources", connectSource: "/workspace/connections", inbox: "/workspace/changes", agentAccess: "/workspace/developer" });
  });

  it("an access check that cannot answer fails the call; nothing partial", async () => {
    accessDown = true;
    expect(await call("get_workflow_status", {})).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
});

describe("R3 → R4: a ready job names the collection the next step takes", () => {
  it("R1's and R3's collectionId is accepted by R4 (mutant: field omitted)", async () => {
    const fromStatus = ((await output("get_workflow_status")).jobs as { collectionId: string }[])[0]!.collectionId;
    const fromJob = (await output("get_compile_job", { jobId: JOB })).collectionId as string;
    expect(fromJob).toBe(fromStatus);
    const listed = await output("list_candidates", { collectionId: fromJob });
    expect((listed.candidates as unknown[]).length).toBeGreaterThan(0);
  });

  it("R3: exact counts and blockers; any unreadable document is NOT_FOUND", async () => {
    jobs = [job({ state: "review_required", blocked: [{ documentId: DOC_A, kind: "input", reason: "UNSUPPORTED" }], blockedResolution: null, documentsReady: 0 })];
    expect(await output("get_compile_job", { jobId: JOB })).toEqual({ jobId: JOB, state: "review_required", collectionId: COLLECTION,
      documentsTotal: 1, documentsReady: 0, blocked: [{ documentId: DOC_A, kind: "input", reason: "UNSUPPORTED" }], blockedResolution: null, resting: true });
    unreadable.add(DOC_A);
    expect(await call("get_compile_job", { jobId: JOB })).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});

describe("R4 / R5: a candidate is never shown as Active (I-26)", () => {
  it("state is 'active' only for the active pointer's digest", async () => {
    const listed = await output("list_candidates", { collectionId: COLLECTION });
    expect(listed.active).toEqual({ manifestDigest: ACTIVE, revision: 2 });
    expect(listed.candidates).toEqual([
      { manifestDigest: CANDIDATE, registeredAt: "2026-11-17T00:00:00Z", state: "candidate — not active", correctedFrom: null, correctionLeaf: true },
      { manifestDigest: ACTIVE, registeredAt: "2026-11-16T00:00:00Z", state: "active", correctedFrom: null, correctionLeaf: true },
    ]);
    expect((await output("get_candidate_objects", { collectionId: COLLECTION, manifestDigest: CANDIDATE })).state).toBe("candidate — not active");
    expect((await output("get_candidate_objects", { collectionId: COLLECTION, manifestDigest: ACTIVE })).state).toBe("active");
    actives = new Map();
    expect((await output("get_candidate_objects", { collectionId: COLLECTION, manifestDigest: ACTIVE })).state).toBe("candidate — not active");
  });

  it("names the correction lineage", async () => {
    const child = `sha256:${"d".repeat(64)}`;
    corrections = [{ base: CANDIDATE, result: child }];
    candidates.get(COLLECTION)!.unshift({ manifestDigest: child, registeredAt: "2026-11-18T00:00:00Z", documentIds: [DOC_A, DOC_B] });
    const listed = (await output("list_candidates", { collectionId: COLLECTION })).candidates as Row[];
    expect(listed[0]).toMatchObject({ manifestDigest: child, correctedFrom: CANDIDATE, correctionLeaf: true });
    expect(listed[1]).toMatchObject({ manifestDigest: CANDIDATE, correctedFrom: null, correctionLeaf: false });
  });

  it("drops an unreadable candidate before paging; a collection with none readable is NOT_FOUND", async () => {
    unreadable.add(DOC_B);
    const listed = (await output("list_candidates", { collectionId: COLLECTION })).candidates as Row[];
    expect(listed.map((row) => row.manifestDigest)).toEqual([ACTIVE]);
    expect(await call("get_candidate_objects", { collectionId: COLLECTION, manifestDigest: CANDIDATE })).toEqual({ ok: false, code: "NOT_FOUND" });
    unreadable.add(DOC_A);
    expect(await call("list_candidates", { collectionId: COLLECTION })).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("R5 pages editable objects only, by id, with at most 16 evidence ids", async () => {
    const page = await output("get_candidate_objects", { collectionId: COLLECTION, manifestDigest: CANDIDATE });
    expect(page.objects).toEqual([
      { objectId: "obj-a", kind: "Topic", label: "Payment", evidenceIds: ["ev-1"] },
      { objectId: "obj-b", kind: "Entity", label: "ACME", evidenceIds: Array.from({ length: 16 }, (_, i) => `ev-${i}`) },
    ]);
    expect(page.nextCursor).toBeNull();
    expect((await output("get_candidate_objects", { collectionId: COLLECTION, manifestDigest: CANDIDATE, kind: "Entity" })).objects).toHaveLength(1);
    expect((await output("get_candidate_objects", { collectionId: COLLECTION, manifestDigest: CANDIDATE, cursor: "1" })).objects).toHaveLength(1);
  });
});

describe("R6 list_documents", () => {
  it("answers exactly {documentId, state, addedAt} per document (mutant: spread the listing row)", async () => {
    stored = [doc(20)];
    refused = [doc(21)];
    const listed = await output("list_documents", {});
    for (const row of listed.documents as Row[]) expect(Object.keys(row).sort()).toEqual(["addedAt", "documentId", "state"]);
    expect(listed.documents).toEqual([
      { documentId: DOC_A, state: "sanitized", addedAt: "2026-11-16T10:00:00.000Z" },
      { documentId: DOC_B, state: "sanitized", addedAt: "2026-11-16T11:00:00.000Z" },
      { documentId: doc(20), state: "stored", addedAt: null },
      { documentId: doc(21), state: "refused", addedAt: null },
    ]);
    expect(JSON.stringify(listed)).not.toMatch(/immutable\/|sanitized\.pdf|"a{64}"|versionKey|size/);
  });

  it("addedAt is null for a stored document, never another time put in its place (mutant: fill it)", async () => {
    stored = [doc(20)];
    const row = (await output("list_documents")).documents as Row[];
    expect(row.find((item) => item.documentId === doc(20))).toEqual({ documentId: doc(20), state: "stored", addedAt: null });
  });

  it("drops an unreadable document while the readable ones stay listed; tombstoned ones are absent", async () => {
    unreadable.add(DOC_A);
    tombstoned = new Set([doc(30)]);
    documents.set(doc(30), { version: "c".repeat(64), addedAt: "2026-11-16T12:00:00.000Z" });
    expect((await output("list_documents")).documents).toEqual([{ documentId: DOC_B, state: "sanitized", addedAt: "2026-11-16T11:00:00.000Z" }]);
  });

  it("cuts the page after filtering (mutant: filter after slicing)", async () => {
    documents = new Map(Array.from({ length: 150 }, (_, i) => [doc(1000 + i), { version: "a".repeat(64), addedAt: "2026-11-16T10:00:00.000Z" }]));
    for (let i = 0; i < 50; i += 1) unreadable.add(doc(1000 + i));
    const first = await output("list_documents");
    expect((first.documents as Row[]).length).toBe(AGENT_PAGE.documents);
    expect((first.documents as Row[])[0]!.documentId).toBe(doc(1050));
    expect(first.nextCursor).toBeNull();
  });

  it("pages by a keyset cursor on the last id, and gives up after AGENT_ACL_SCAN_PAGES windows", async () => {
    documents = new Map(Array.from({ length: 250 }, (_, i) => [doc(1000 + i), { version: "a".repeat(64), addedAt: "2026-11-16T10:00:00.000Z" }]));
    const first = await output("list_documents");
    expect(first.nextCursor).toBe(doc(1099));
    const second = await output("list_documents", { cursor: first.nextCursor });
    expect((second.documents as Row[])[0]!.documentId).toBe(doc(1100));
    // Everything unreadable: the scan stops after its bound and hands back the place it reached.
    documents = new Map(Array.from({ length: (AGENT_ACL_SCAN_PAGES + 1) * 100 }, (_, i) => [doc(5000 + i), { version: "a".repeat(64), addedAt: "2026-11-16T10:00:00.000Z" }]));
    for (const id of documents.keys()) unreadable.add(id);
    const empty = await output("list_documents");
    expect(empty.documents).toEqual([]);
    expect(empty.nextCursor).toBe(doc(5000 + AGENT_ACL_SCAN_PAGES * 100 - 1));
  });

  it("an access check that cannot answer is UNAVAILABLE for the whole call", async () => {
    accessDown = true;
    expect(await call("list_documents", {})).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
});

describe("P3 propose_library_labels", () => {
  const item = { documentId: DOC_A, labelKind: "topic", labelKey: "pricing", decision: "confirmed" };
  const p3 = (fields: Row = {}) => ({ collectionId: COLLECTION, expectedManifestDigest: ACTIVE, items: [item], idempotencyKey: "client-key-1", ...fields });

  it("with the Library mode off: LIBRARY_ORGANIZE_NOT_ENABLED before any access call", async () => {
    vi.stubEnv("TAVONEL_LIBRARY_ORGANIZE_MODE", "shadow");
    expect(await call("propose_library_labels", p3())).toEqual({ ok: false, code: "LIBRARY_ORGANIZE_NOT_ENABLED" });
    expect(checkAccess).not.toHaveBeenCalled();
    expect(creates()).toBe(0);
  });

  it("on a collection with no Active World: WORLD_NOT_ACTIVE (mutant: unmapped -> UNAVAILABLE)", async () => {
    actives = new Map();
    expect(await call("propose_library_labels", p3())).toEqual({ ok: false, code: "WORLD_NOT_ACTIVE" });
    expect(creates()).toBe(0);
  });

  it("a stale expectedManifestDigest is PROPOSAL_BASE_NOT_HEAD with 0 create calls (mutant: field ignored)", async () => {
    expect(await call("propose_library_labels", p3({ expectedManifestDigest: `sha256:${"e".repeat(64)}` })))
      .toEqual({ ok: false, code: "PROPOSAL_BASE_NOT_HEAD" });
    expect(creates()).toBe(0);
  });

  it("creates one agent row per item, the source version filled by the server", async () => {
    const created = await call("propose_library_labels", p3({ items: [item, { ...item, documentId: DOC_B }] }));
    expect(created.ok).toBe(true);
    expect((created as { output: unknown[] }).output).toHaveLength(2);
    const bodies = calls.filter((entry) => entry.path.endsWith("/create_world_change_proposal")).map((entry) => entry.body!);
    expect(bodies.map((body) => [body.p_principal_kind, body.p_agent_grant_id, (body.p_input as Row).sourceVersionId]))
      .toEqual([["agent", GRANT, "a".repeat(64)], ["agent", GRANT, "b".repeat(64)]]);
  });
});

describe("P1 / P4", () => {
  it("P1 creates a compile_plan proposal whose view carries the document set and the quote", async () => {
    const view = await output("propose_compile", { documentIds: [DOC_B, DOC_A], idempotencyKey: "client-key-1" });
    expect(view).toMatchObject({ actionType: "compile_plan", state: "proposed",
      preview: { documentIds: [DOC_A, DOC_B], documentsTotal: 2, quote: { rechargeCredits: 0, balanceRechargeCredits: 0, overageCredits: 0 } } });
    expect(view.confirmUrl).toBe(`/workspace/changes?proposal=${view.proposalId}`);
  });

  it("P1 replays the same client key into the same row", async () => {
    const first = await output("propose_compile", { documentIds: [DOC_A], idempotencyKey: "client-key-1" });
    const second = await output("propose_compile", { documentIds: [DOC_A], idempotencyKey: "client-key-1" });
    expect(second.proposalId).toBe(first.proposalId);
  });

  it("P4 refuses a base that is not the correction leaf with PROPOSAL_BASE_NOT_HEAD", async () => {
    corrections = [{ base: CANDIDATE, result: `sha256:${"d".repeat(64)}` }];
    expect(await call("propose_label_correction", { collectionId: COLLECTION, baseManifestDigest: CANDIDATE, objectId: EDITABLE.id,
      before: EDITABLE.label, after: "Corrected", evidenceId: "ev-1", idempotencyKey: "client-key-1" })).toEqual({ ok: false, code: "PROPOSAL_BASE_NOT_HEAD" });
  });

  it("P4 creates an ontology_label_patch proposal with no document set in the preview", async () => {
    const view = await output("propose_label_correction", { collectionId: COLLECTION, baseManifestDigest: CANDIDATE, objectId: EDITABLE.id,
      before: EDITABLE.label, after: "Corrected", evidenceId: "ev-1", idempotencyKey: "client-key-1" });
    expect(view.preview).toEqual({ collectionId: COLLECTION, baseManifestDigest: CANDIDATE, objectId: EDITABLE.id, kind: EDITABLE.kind,
      before: EDITABLE.label, after: "Corrected", evidenceId: "ev-1" });
  });

  it("R2 gives this grant's proposal, and another grant's is NOT_FOUND like a random id", async () => {
    const view = await output("propose_compile", { documentIds: [DOC_A], idempotencyKey: "client-key-1" });
    expect(await output("get_proposal", { proposalId: view.proposalId })).toEqual(view);
    proposals.get(view.proposalId as string)!.agent_grant_id = OTHER_GRANT;
    expect(await call("get_proposal", { proposalId: view.proposalId })).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await call("get_proposal", { proposalId: doc(4242) })).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("R2 of a row whose documents are unreadable now shows no preview", async () => {
    const view = await output("propose_compile", { documentIds: [DOC_A], idempotencyKey: "client-key-1" });
    unreadable.add(DOC_A);
    expect((await output("get_proposal", { proposalId: view.proposalId })).preview).toBeNull();
  });
});
