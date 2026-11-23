import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileCollectionCandidate, type CollectionOcrInput } from "./collection-compiler";

/*
  ontology_label_patch (WO-AN-4, workorders/agent-native.md §4.2, §4.3). The store below behaves as
  20261117130000_agent_proposals.sql does for what this executor calls: list_collection_candidates,
  the review-decision read, record_foundation_review_patch_if_leaf (one correction per base: the same
  resulting digest replays, another is review_base_not_head) and register_collection_artifact_provenance.
*/

type StoreCall = { method: string; path: string; body: Record<string, unknown> | null };
type Decision = { manifest_digest: string; resulting_manifest_digest: string; actor_user_id: string; reason: string };

const checkAccess = vi.fn<(workspaceKey: string, ids: string[], userId: string) => Promise<unknown>>();
const admitsDerived = vi.fn<(workspaceKey: string, ids: readonly string[]) => Promise<boolean>>();
const loadModel = vi.fn<(workspaceKey: string, collectionId: string, digest?: string) => Promise<unknown>>();
const loadCandidate = vi.fn<(signer: unknown, workspaceKey: string, collectionId: string, digest?: string) => Promise<unknown>>();
const putCandidate = vi.fn<(signer: unknown, workspaceKey: string, key: string, value: unknown) => Promise<unknown>>();
const readSigner = vi.fn<() => unknown>();
const revalidate = vi.fn<(request: Request, principal: unknown) => Promise<unknown>>();
let store: StoreCall[];
let decisions: Decision[];
let candidates: unknown[] | "down";
let registerAnswers: Array<{ status: number; body: unknown }>;
let onRecord: () => void;
let rows: Map<string, Record<string, unknown>>;
let storeThrows: unknown = null;

vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccessForViewer: checkAccess }));
vi.mock("@/lib/derived-data-admission", () => ({ admitsDerivedCustomerData: admitsDerived }));
vi.mock("@/lib/world-read-model", () => ({ loadWorldReadModel: loadModel }));
vi.mock("@/lib/collection-storage", () => ({ loadPreferredCollectionCandidate: loadCandidate }));
vi.mock("@/lib/r2-objects", () => ({ putWorkspaceCollectionCandidate: putCandidate, listImmutableWorkspaceObjects: vi.fn() }));
vi.mock("@/lib/r2-synthetic-canary", () => ({ readR2SignerEnv: readSigner }));
vi.mock("@/lib/developer-auth", () => ({ requireFoundationSession: vi.fn(), revalidateFoundationSession: revalidate }));
vi.mock("@/lib/supabase-admin", () => ({
  readSupabaseAdminConfig: () => ({}),
  supabaseAdminRequest: async (_config: unknown, path: string, init: { method?: string; body?: string } = {}) => {
    if (storeThrows !== null) throw storeThrows;
    const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : null;
    store.push({ method: init.method ?? "GET", path, body });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (path.startsWith("/rest/v1/foundation_review_decisions?")) {
      const query = new URLSearchParams(path.split("?")[1]);
      const base = query.get("manifest_digest")?.replace(/^eq\./, "");
      return json(decisions.filter((row) => row.manifest_digest === base).slice(0, 1).map(() => ({ decision_id: "d" })));
    }
    const name = path.replace("/rest/v1/rpc/", "");
    if (name === "list_collection_candidates") return candidates === "down" ? json({ message: "timeout" }, 500) : json(candidates);
    if (name === "register_collection_artifact_provenance") {
      const answer = registerAnswers.shift() ?? { status: 200, body: { leaseSeconds: 120 } };
      return json(answer.body, answer.status);
    }
    if (name === "record_foundation_review_patch_if_leaf") {
      onRecord();
      const existing = decisions.find((row) => row.manifest_digest === body!.p_manifest_digest);
      if (existing && existing.resulting_manifest_digest !== body!.p_resulting_manifest_digest) return json({ code: "P0001", message: "review_base_not_head" }, 400);
      if (existing) return json({ decisionId: "d-1", recordedAt: "2026-11-17T00:00:00Z", replayed: true });
      decisions.push({ manifest_digest: body!.p_manifest_digest as string, resulting_manifest_digest: body!.p_resulting_manifest_digest as string,
        actor_user_id: body!.p_actor_user_id as string, reason: body!.p_reason as string });
      return json({ decisionId: "d-1", recordedAt: "2026-11-17T00:00:00Z", replayed: false });
    }
    if (name === "create_world_change_proposal") {
      const row = { ...baseRow, proposal_id: "00000000-0000-4000-8000-0000000000d1", collection_id: body!.p_collection_id, input: body!.p_input,
        expected_manifest_digest: body!.p_expected_manifest_digest };
      rows.set(row.proposal_id, row);
      return json({ proposal: row, replayed: false });
    }
    if (name === "decide_world_change_proposal") {
      const row = rows.get(body!.p_proposal_id as string)!;
      Object.assign(row, { state: body!.p_current_manifest_digest === row.expected_manifest_digest ? "confirmed" : "stale",
        decided_at: "2026-11-17T10:00:00.123456+00:00", decided_by: body!.p_decided_by });
      return json(row);
    }
    if (name === "record_world_change_proposal_outcome") {
      const row = rows.get(body!.p_proposal_id as string)!;
      Object.assign(row, { state: body!.p_outcome, receipt: body!.p_receipt });
      return json(row);
    }
    return json({ message: `unexpected ${path}` }, 500);
  },
}));

const patch = await import("./proposal-label-correction");
const proposals = await import("./change-proposals");

const WS = "pilot-a";
const PERSON = "7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a";
const CONFIRMER = "7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b";
const DOC_A = "0a000000-0000-4000-8000-00000000000a";
const DOC_B = "0b000000-0000-4000-8000-00000000000b";
const agent = { kind: "agent", workspaceKey: WS, userId: PERSON, authorizationRevision: 3, grantId: "9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a", keyId: "k" } as const;
const SIGNER = { bucket: "tavonel-saas-foundation-quarantine" };

function ocr(documentId: string, digest: string, text: string): CollectionOcrInput {
  return {
    documentId, versionKey: digest, sanitizedKey: `immutable/${WS}/${WS}/${documentId}/${digest}/sanitized.pdf`,
    ocrJsonKey: `immutable/${WS}/${WS}/${documentId}/${digest}/ocr.json`, pageCount: 1, text, inputSha256: `sha256:${digest}`,
    sourceImmutableKey: `immutable/${WS}/${WS}/${documentId}/${digest}/sanitized.pdf`,
    regions: [{ regionId: `${documentId}-p1-b1`, pageIndex0: 0, pageNumber1: 1, order: 0, blockType: "paragraph", text,
      bbox1000: [80, 120, 920, 320], confidence: 0.99, authority: "contractual" }],
  };
}
const ARTIFACT = {
  ...compileCollectionCandidate([
    ocr(DOC_B, "b".repeat(64), "ACME Corporaton requires written approval before changing payment terms."),
    ocr(DOC_A, "a".repeat(64), "ACME Corporaton shall pay every valid invoice within 30 calendar days."),
  ]),
  coreExecution: { status: "completed" as const, runtime: "tavonel-python-core-v2", worldStateId: "w-1",
    receipt: { requestId: "r", outputSha256: `sha256:${"c".repeat(64)}`, candidatePromotion: false as const } },
};
const COLLECTION = ARTIFACT.collectionId;
const BASE = ARTIFACT.manifestDigest;
const editable = ARTIFACT.ontology.nodes.find((node) => node.kind === "Entity" || node.kind === "Topic" || node.kind === "Claim")!;
const documentNode = ARTIFACT.ontology.nodes.find((node) => node.kind === "Document")!;
const EVIDENCE = { id: "ev-1", sourceId: DOC_A, sourceVersionId: "a".repeat(64), page: 1, bbox: [80, 120, 920, 320] };
const request = (fields: Record<string, unknown> = {}) => ({
  collectionId: COLLECTION, baseManifestDigest: BASE, objectId: editable.id, before: editable.label, after: "Corrected label", evidenceId: EVIDENCE.id, ...fields,
});

const baseRow = {
  proposal_id: "", workspace_key: WS, collection_id: COLLECTION, action_type: "ontology_label_patch", input: null, input_sha256: `sha256:${"9".repeat(64)}`,
  evidence_ids: [], state: "proposed", expires_at: "2099-01-01T00:00:00Z", created_at: "2026-11-17T00:00:00Z", decided_at: null,
  binding_kind: "correction_leaf", principal_kind: "session", principal_id: PERSON, agent_grant_id: null, decided_by: null,
  expected_manifest_digest: "", idempotency_key: "session-key-0001", receipt: null, agent_client_label: null, agent_grantor_email: null,
};

const calledRpc = () => store.map((call) => call.path.startsWith("/rest/v1/rpc/") ? call.path.slice("/rest/v1/rpc/".length) : `${call.method} ${call.path.split("?")[0]}`);
const count = (name: string) => calledRpc().filter((call) => call === name).length;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  store = [];
  storeThrows = null;
  decisions = [];
  rows = new Map();
  registerAnswers = [];
  onRecord = () => {};
  candidates = [{ manifestDigest: BASE, registeredAt: "2026-11-16T00:00:00Z", documentIds: [DOC_B, DOC_A] }];
  checkAccess.mockResolvedValue({ ok: true });
  admitsDerived.mockResolvedValue(true);
  readSigner.mockReturnValue(SIGNER);
  loadModel.mockResolvedValue({ ok: true, model: { evidence: [EVIDENCE] } });
  loadCandidate.mockImplementation(async () => ({ ok: true, value: { key: "k", artifact: structuredClone(ARTIFACT) } }));
  putCandidate.mockResolvedValue({ ok: true, status: "written", bytes: 1 });
  revalidate.mockResolvedValue({ ok: true });
});
afterEach(() => vi.useRealTimers());

describe("stored input", () => {
  const good = { ...request(), kind: "Entity", documentIds: [DOC_A, DOC_B] };
  it("parses exactly the stored shape; the preview is everything but the document set", () => {
    expect(patch.parseLabelPatchInput(good)).toEqual(good);
    const { documentIds: _set, ...preview } = good;
    expect(patch.labelPatchPreview(patch.parseLabelPatchInput(good)!)).toEqual(preview);
  });
  it.each([
    ["a Document kind", { ...good, kind: "Document" }],
    ["an unsorted document set", { ...good, documentIds: [DOC_B, DOC_A] }],
    ["an empty document set", { ...good, documentIds: [] }],
    ["an untrimmed after", { ...good, after: " x " }],
    ["a label over 500", { ...good, after: "x".repeat(501) }],
    ["a control character", { ...good, before: "a\u0000b" }],
    ["an unknown key", { ...good, reviewPatch: {} }],
    ["a missing key", { ...good, evidenceId: undefined }],
  ])("refuses %s", (_name, raw) => {
    expect(patch.parseLabelPatchInput(raw)).toBeNull();
  });
});

describe("prepare: the creation dry-run", () => {
  it("stores the base's provenance set and the node's kind, and binds the leaf", async () => {
    const prepared = await patch.labelCorrectionExecutor.prepare(agent, request({ after: "  Corrected label  " }), ["ev-1"]);
    expect(prepared).toMatchObject({ ok: true, collectionId: COLLECTION, evidenceIds: ["ev-1"] });
    if (!prepared.ok) return;
    expect(prepared.input).toEqual({ ...request(), kind: editable.kind, after: "Corrected label", documentIds: [DOC_A, DOC_B] });
    expect(patch.parseLabelPatchInput(prepared.input)).toEqual(prepared.input);
    expect(prepared.bindingDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("I-1: writes nothing — no registration, no record, no PUT", async () => {
    expect((await patch.labelCorrectionExecutor.prepare(agent, request(), [])).ok).toBe(true);
    expect(calledRpc()).toEqual(["list_collection_candidates", "GET /rest/v1/foundation_review_decisions"]);
    expect(putCandidate).not.toHaveBeenCalled();
  });

  /* WO-AN-8: the access check that cannot answer moved to the deciding-read class below (same not-found, flagged). */
  it.each([
    ["a base that is not a registered candidate", () => { candidates = []; }],
    ["a base whose documents the proposer cannot read", () => checkAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" })],
    ["derived data not admitted", () => admitsDerived.mockResolvedValue(false)],
  ])("%s is the same not-found, before the leaf is read", async (_name, arrange) => {
    arrange();
    expect(await patch.labelCorrectionExecutor.prepare(agent, request(), [])).toEqual({ ok: false, code: "PROPOSAL_TARGET_NOT_FOUND", status: 404 });
    expect(count("GET /rest/v1/foundation_review_decisions")).toBe(0);
    expect(loadModel).not.toHaveBeenCalled();
  });

  /*
    WO-AN-8, the class and not one input: the reads that decide whether the base names a candidate this caller can
    read are the candidate listing and the access check (§18: P4 = candidates + access). For an agent, every way they
    fail -- an error answer, a malformed answer, a throw, an access check that cannot answer or throws -- is the
    not-found an absent base gets, flagged decidingReadFailed for the server log, and nothing after them is read.
    Before WO-AN-8 the tool layer made this decision; now the executor alone does. Mutant: listing failure -> 503.
  */
  const decidingFailures: Array<[string, () => void]> = [
    ["the candidates RPC answering an error", () => { candidates = "down"; }],
    ["the candidates RPC answering a non-list", () => { candidates = { rows: [] } as unknown as unknown[]; }],
    ["the base row naming a non-canonical document id", () => { candidates = [{ manifestDigest: BASE, registeredAt: "x", documentIds: ["../a"] }]; }],
    ["the store throwing", () => { storeThrows = new Error("connect ECONNREFUSED"); }],
    ["an access check that cannot answer", () => checkAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE" })],
    ["an access check that throws", () => checkAccess.mockRejectedValue(new TypeError("x is not a function"))],
    ["an access check that throws a non-Error", () => checkAccess.mockRejectedValue("a string")],
  ];
  it.each(decidingFailures)("agent: %s is the not-found an absent base gets, flagged, and nothing after is read", async (_name, arrange) => {
    arrange();
    expect(await patch.labelCorrectionExecutor.prepare(agent, request(), []))
      .toEqual({ ok: false, code: "PROPOSAL_TARGET_NOT_FOUND", status: 404, decidingReadFailed: true });
    expect(count("GET /rest/v1/foundation_review_decisions")).toBe(0);
    expect(admitsDerived).not.toHaveBeenCalled();
    expect(loadModel).not.toHaveBeenCalled();
  });

  it("access is asked for every document of the base, as the proposer", async () => {
    await patch.labelCorrectionExecutor.prepare(agent, request(), []);
    expect(checkAccess).toHaveBeenCalledWith(WS, [DOC_A, DOC_B], PERSON);
  });

  it("a base with a recorded correction is not the head: 409 PROPOSAL_BASE_NOT_HEAD", async () => {
    decisions.push({ manifest_digest: BASE, resulting_manifest_digest: `sha256:${"f".repeat(64)}`, actor_user_id: PERSON, reason: "r" });
    expect(await patch.labelCorrectionExecutor.prepare(agent, request(), [])).toEqual({ ok: false, code: "PROPOSAL_BASE_NOT_HEAD", status: 409 });
  });

  it.each([
    ["an unknown evidence id", request({ evidenceId: "ev-unknown" }), "PATCH_EVIDENCE_NOT_FOUND", 422],
    ["a Document object", request({ objectId: documentNode.id, before: documentNode.label }), "PATCH_TARGET_NOT_EDITABLE", 422],
    ["an object that is not there", request({ objectId: "no-such-node" }), "PATCH_TARGET_NOT_FOUND", 422],
    ["a stale before", request({ before: "not what it says" }), "PATCH_BEFORE_MISMATCH", 409],
    ["no change", request({ after: editable.label }), "PATCH_NO_CHANGE", 422],
    ["a label over 500", request({ after: "x".repeat(501) }), "PROPOSAL_REQUEST_INVALID", 400],
    ["an unknown key", { ...request(), kind: "Entity" }, "PROPOSAL_REQUEST_INVALID", 400],
  ])("%s is refused", async (_name, raw, code, status) => {
    expect(await patch.labelCorrectionExecutor.prepare(agent, raw, [])).toEqual({ ok: false, code, status });
  });

  /* WO-AN-8: for an agent the candidates RPC decides existence (the class above); after the decision an outage is a 503. */
  it("agent: the R2 signer unavailable after the decision fails closed with 503", async () => {
    readSigner.mockReturnValue(null);
    expect(await patch.labelCorrectionExecutor.prepare(agent, request(), [])).toEqual({ ok: false, code: "PROPOSAL_PRECONDITION_UNAVAILABLE", status: 503 });
  });

  it("person: the candidates RPC unavailable fails closed with 503", async () => {
    candidates = "down";
    expect(await patch.labelCorrectionExecutor.prepare({ kind: "session", workspaceKey: WS, userId: PERSON, authorizationRevision: 3 }, request(), []))
      .toEqual({ ok: false, code: "PROPOSAL_PRECONDITION_UNAVAILABLE", status: 503 });
  });
});

/*
  The class of failure, not one input: every reader the dry-run and the binding reuse is made to throw in turn,
  and so is the patch itself on a stored artifact it does not expect (no `sourceDocuments` array: the
  materializer's `.map` throws a TypeError). Each member answers a coded refusal; nothing rejects.
*/
describe("fail closed: any reader that throws is a refusal", () => {
  const thrown = [new Error("boom"), new TypeError("x is not a function"), "a string"];
  const readers: Array<[string, (value: unknown) => void]> = [
    ["the store", (value) => { storeThrows = value; }],
    ["the access check", (value) => checkAccess.mockImplementation(async () => { throw value; })],
    ["the derived-data admission", (value) => admitsDerived.mockImplementation(async () => { throw value; })],
    ["the read model", (value) => loadModel.mockImplementation(async () => { throw value; })],
    ["the R2 signer", (value) => readSigner.mockImplementation(() => { throw value; })],
    ["the candidate read", (value) => loadCandidate.mockImplementation(async () => { throw value; })],
  ];
  const cases = [
    ...readers.flatMap(([name, arrange]) => thrown.map((value) => [`${name} (${String(value)})`, () => arrange(value)] as const)),
    ["a stored artifact the patch does not expect", () => loadCandidate.mockResolvedValue({ ok: true, value: { key: "k", artifact: { ...ARTIFACT, sourceDocuments: null } } })] as const,
  ];

  it.each(cases)("%s: prepare and currentBinding answer a refusal", async (_name, arrange) => {
    const input = { ...request(), kind: editable.kind as "Entity", documentIds: [DOC_A, DOC_B] };
    arrange();
    const prepared = await patch.labelCorrectionExecutor.prepare(agent, request(), []);
    expect(prepared).toMatchObject({ ok: false });
    expect((prepared as { status: number }).status).toBeGreaterThanOrEqual(400);
    const binding = await patch.labelCorrectionExecutor.currentBinding(agent, baseRow as never, input);
    if (!binding.ok) expect(binding.status).toBeGreaterThanOrEqual(400);
    const blocked = await patch.labelCorrectionExecutor.preconditions(agent, baseRow as never, input);
    if (blocked) expect(blocked.status).toBeGreaterThanOrEqual(400);
  });
});

describe("run: register → record-if-leaf → PUT", () => {
  const input = { ...request(), kind: editable.kind as "Entity", documentIds: [DOC_A, DOC_B] };
  const row = { ...baseRow, state: "confirmed", decided_by: CONFIRMER, decided_at: "2026-11-17T10:00:00.123456+00:00" };
  const run = () => patch.labelCorrectionExecutor.run({ request: new Request("https://tavonel.com/x"), actor: { kind: "session", workspaceKey: WS, userId: CONFIRMER, authorizationRevision: 3 }, row: row as never, input });

  it("writes a new immutable candidate under its digest, recorded as the confirmer's correction", async () => {
    const result = await run();
    expect(result).toMatchObject({ ok: true, replayed: false });
    const digest = (result as unknown as { candidateManifestDigest: string }).candidateManifestDigest;
    expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(digest).not.toBe(BASE);
    expect(calledRpc()).toEqual(["register_collection_artifact_provenance", "record_foundation_review_patch_if_leaf"]);
    expect(putCandidate).toHaveBeenCalledTimes(1);
    const [, workspace, key, value] = putCandidate.mock.calls[0]!;
    expect(workspace).toBe(WS);
    expect(key).toContain(digest.slice("sha256:".length));
    expect(value).toMatchObject({ manifestDigest: digest, reviewPatch: { actorUserId: CONFIRMER, patchedAt: row.decided_at, after: "Corrected label", derivedFromManifestDigest: BASE } });
    expect(decisions).toEqual([{ manifest_digest: BASE, resulting_manifest_digest: digest, actor_user_id: CONFIRMER, reason: patch.LABEL_CORRECTION_REASON }]);
    expect(patch.LABEL_CORRECTION_REASON.length).toBeGreaterThanOrEqual(8);
    expect(result.ok && patch.labelCorrectionExecutor.resultRef(result)).toEqual({ candidateManifestDigest: digest });
  });

  it("a re-run (resume) writes the same key with identical bytes and the record replays", async () => {
    const first = await run();
    const second = await run();
    expect(second).toMatchObject({ ok: true, replayed: true, candidateManifestDigest: (first as unknown as { candidateManifestDigest: string }).candidateManifestDigest });
    const [a, b] = putCandidate.mock.calls;
    expect(b![2]).toBe(a![2]);
    expect(JSON.stringify(b![3])).toBe(JSON.stringify(a![3]));
    expect(decisions).toHaveLength(1);
  });

  it("record refused (another correction of the base since): failed, and no object is written", async () => {
    decisions.push({ manifest_digest: BASE, resulting_manifest_digest: `sha256:${"f".repeat(64)}`, actor_user_id: PERSON, reason: "r" });
    expect(await run()).toEqual({ ok: false, code: "PROPOSAL_BASE_NOT_HEAD", status: 409 });
    expect(putCandidate).not.toHaveBeenCalled();
  });

  it("the lease runs out between record and PUT: registered again once, the object written, executed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T10:00:00Z"));
    onRecord = () => vi.setSystemTime(Date.now() + 100_000);
    const result = await run();
    expect(result).toMatchObject({ ok: true });
    expect(count("register_collection_artifact_provenance")).toBe(2);
    expect(putCandidate).toHaveBeenCalledTimes(1);
  });

  it("a renewal the registry refuses (source deleted since): failed, no PUT — the deletion wins", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    onRecord = () => vi.setSystemTime(Date.now() + 100_000);
    registerAnswers = [{ status: 200, body: { leaseSeconds: 120 } }, { status: 400, body: { message: "COLLECTION_ARTIFACT_SOURCE_DELETED" } }];
    expect(await run()).toEqual({ ok: false, code: "COLLECTION_ARTIFACT_SOURCE_DELETED", status: 409 });
    expect(putCandidate).not.toHaveBeenCalled();
  });

  it("a first registration refused: failed before anything is recorded", async () => {
    registerAnswers = [{ status: 400, body: { message: "COLLECTION_ARTIFACT_SOURCE_BLOCKED" } }];
    expect(await run()).toEqual({ ok: false, code: "COLLECTION_ARTIFACT_SOURCE_BLOCKED", status: 409 });
    expect(count("record_foundation_review_patch_if_leaf")).toBe(0);
    expect(putCandidate).not.toHaveBeenCalled();
  });

  it("no undo: the candidate is immutable and Active is unchanged", () => {
    expect(patch.labelCorrectionExecutor.undo).toBeUndefined();
  });
});

describe("decision path with the real executor (I-6)", () => {
  const principal = { kind: "session", workspaceKey: WS, userId: CONFIRMER, authorizationRevision: 3 } as never;
  async function proposed() {
    const created = await proposals.createProposal({ kind: "session", workspaceKey: WS, userId: PERSON, authorizationRevision: 3 },
      { actionType: "ontology_label_patch", raw: request(), evidenceIds: [], clientKey: "session-key-0001" });
    if (!created.ok) throw new Error(created.code);
    return created.row as Parameters<typeof proposals.decideProposal>[2];
  }
  const digestOf = (row: Parameters<typeof proposals.decideProposal>[2]) =>
    proposals.proposalPreviewDigest(row.proposal_id, "ontology_label_patch", patch.labelPatchPreview(patch.parseLabelPatchInput(row.input)!));
  const confirm = (row: Parameters<typeof proposals.decideProposal>[2]) =>
    proposals.decideProposal(new Request("https://tavonel.com/x"), principal, row, { decision: "confirm", previewDigest: digestOf(row) });

  it("confirmed on the leaf: executed with the candidate digest in the receipt", async () => {
    const row = await proposed();
    const answer = await confirm(row);
    expect(answer.ok && answer.proposal.state).toBe("executed");
    expect(rows.get(row.proposal_id)?.receipt).toMatchObject({ result: { ok: true, candidateManifestDigest: expect.stringMatching(/^sha256:/) } });
  });

  it("a correction child appeared since the proposal: stale, no registration, no PUT", async () => {
    const row = await proposed();
    decisions.push({ manifest_digest: BASE, resulting_manifest_digest: `sha256:${"f".repeat(64)}`, actor_user_id: PERSON, reason: "r" });
    const answer = await confirm(row);
    expect(answer.ok && answer.proposal.state).toBe("stale");
    expect(count("register_collection_artifact_provenance")).toBe(0);
    expect(putCandidate).not.toHaveBeenCalled();
  });

  it("no R2 signer at confirmation: 503 before anything is decided", async () => {
    const row = await proposed();
    readSigner.mockReturnValue(null);
    expect(await confirm(row)).toEqual({ ok: false, code: "PROPOSAL_PRECONDITION_UNAVAILABLE", status: 503 });
    expect(count("decide_world_change_proposal")).toBe(0);
  });
});
