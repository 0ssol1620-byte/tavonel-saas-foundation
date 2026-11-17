import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn<(name: string, body: Record<string, unknown>) => { status: number; body: unknown } | "unreachable">();
let configured = true;

vi.mock("@/lib/developer-auth", () => ({ requireFoundationSession: vi.fn(), revalidateFoundationSession: vi.fn() }));
vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccessForViewer: vi.fn() }));
vi.mock("@/lib/world-store", () => ({ getFoundationActiveWorld: vi.fn() }));
vi.mock("@/lib/library-shadow", () => ({ decideLibraryLabel: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({
  readSupabaseAdminConfig: () => (configured ? {} : null),
  supabaseAdminRequest: async (_config: unknown, path: string, init: { body: string }) => {
    const answer = rpc(path.replace("/rest/v1/rpc/", ""), JSON.parse(init.body) as Record<string, unknown>);
    if (answer === "unreachable") throw new Error("network down");
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  },
}));

const lib = await import("./change-proposals");
const { PROPOSAL_RESUME_AFTER_MS } = await import("./agent-access");

const DOC = "0a000000-0000-4000-8000-00000000000a";
const VERSION = "a".repeat(64);
const COLLECTION = `collection-${"c".repeat(32)}`;
const input = { documentId: DOC, sourceVersionId: VERSION, labelKind: "doc_type", labelKey: "invoice", decision: "confirmed" };

beforeEach(() => { configured = true; rpc.mockReset(); });
afterEach(() => vi.restoreAllMocks());

describe("parseProposalInput", () => {
  it("accepts the library_label body minus its idempotency key", () => {
    expect(lib.parseProposalInput("library_label", input)).toEqual(input);
    expect(lib.parseProposalInput("library_label", { ...input, labelKind: "topic", labelKey: "pricing", decision: "rejected" })).not.toBeNull();
  });

  it.each([
    ["an unknown action type", "merge_documents", input],
    ["an unknown key", "library_label", { ...input, idempotencyKey: "idem-key-0001" }],
    ["a missing key", "library_label", { documentId: DOC }],
    ["an Undo decision (an Undo is never proposed)", "library_label", { ...input, decision: "undo_confirmed" }],
    ["a doc type outside the label set", "library_label", { ...input, labelKey: "not-a-doc-type" }],
    ["a malformed document id", "library_label", { ...input, documentId: "nope" }],
    ["a short source version", "library_label", { ...input, sourceVersionId: "abc" }],
    ["a control character in the label", "library_label", { ...input, labelKind: "topic", labelKey: "a\nb" }],
    ["an array", "library_label", [input]],
    ["null", "library_label", null],
  ])("refuses %s", (_name, actionType, body) => {
    expect(lib.parseProposalInput(actionType, body)).toBeNull();
  });

  it("offers exactly one action type in this slice", () => {
    expect(lib.PROPOSAL_ACTION_TYPES).toEqual(["library_label"]);
  });
});

describe("digest and evidence ids", () => {
  it("digests the canonical input: key order does not matter, any change does", () => {
    const reordered = { decision: "confirmed", labelKey: "invoice", labelKind: "doc_type", sourceVersionId: VERSION, documentId: DOC };
    expect(lib.proposalInputDigest(input)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(lib.proposalInputDigest(reordered)).toBe(lib.proposalInputDigest(input));
    expect(lib.proposalInputDigest({ ...input, labelKey: "contract" })).not.toBe(lib.proposalInputDigest(input));
  });

  it("allows at most 16 short evidence ids and defaults to none", () => {
    expect(lib.parseEvidenceIds(undefined)).toEqual([]);
    expect(lib.parseEvidenceIds(["ev-1", "ev-2"])).toEqual(["ev-1", "ev-2"]);
    expect(lib.parseEvidenceIds(Array.from({ length: 17 }, (_, i) => `ev-${i}`))).toBeNull();
    expect(lib.parseEvidenceIds(["ok", 3])).toBeNull();
    expect(lib.parseEvidenceIds([""])).toBeNull();
    expect(lib.parseEvidenceIds("ev-1")).toBeNull();
  });
});

describe("toPublicProposal", () => {
  const VIEWER = "7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a";
  const PROPOSAL = "00000000-0000-4000-8000-000000000001";
  const DECIDED = "2026-11-16T12:00:00.000Z";
  const base = {
    proposal_id: PROPOSAL, workspace_key: "pilot-a", collection_id: COLLECTION, action_type: "library_label", input, input_sha256: `sha256:${"9".repeat(64)}`,
    evidence_ids: ["ev-1"], state: "proposed", expires_at: "2026-11-23T00:00:00Z", created_at: "2026-11-16T00:00:00Z", decided_at: null,
    expected_manifest_digest: `sha256:${"8".repeat(64)}`, principal_kind: "session", principal_id: VIEWER, idempotency_key: "secret-key-001", receipt: null,
    binding_kind: "active_manifest", agent_grant_id: null, decided_by: null, agent_client_label: null, agent_grantor_email: null,
  } as const;
  type Row = Parameters<typeof lib.toPublicProposal>[0];
  const row = (fields: Record<string, unknown> = {}) => ({ ...base, ...fields }) as unknown as Row;
  const at = (ms: number) => ({ userId: VIEWER, now: new Date(Date.parse(DECIDED) + ms) });

  // Updated deliberately in WO-AN-2: the DTO gained collectionId, previewDigest, resumable, proposer and notes (§7).
  it("shows the preview, its digest and the state, never the input digest, the principal or the idempotency key", () => {
    const publicRow = lib.toPublicProposal(row(), at(0));
    expect(publicRow).toEqual({
      proposalId: PROPOSAL, actionType: "library_label", state: "proposed", collectionId: COLLECTION, preview: input,
      previewDigest: lib.proposalPreviewDigest(PROPOSAL, "library_label", input), resumable: false, evidenceIds: ["ev-1"],
      expiresAt: "2026-11-23T00:00:00Z", createdAt: "2026-11-16T00:00:00Z", decidedAt: null, proposer: { kind: "person" }, notes: [],
    });
    expect(JSON.stringify(publicRow)).not.toMatch(new RegExp(`principal|secret-key|manifest|${base.input_sha256}|${VIEWER}`));
  });

  it("the preview digest binds the proposal id, the type and every preview field", () => {
    const digest = lib.proposalPreviewDigest(PROPOSAL, "library_label", input);
    expect(lib.proposalPreviewDigest("00000000-0000-4000-8000-000000000002", "library_label", input)).not.toBe(digest);
    expect(lib.proposalPreviewDigest(PROPOSAL, "compile_plan", input)).not.toBe(digest);
    for (const key of Object.keys(input)) expect(lib.proposalPreviewDigest(PROPOSAL, "library_label", { ...input, [key]: "x" })).not.toBe(digest);
  });

  it("no preview, no digest: a viewer without access, or a row no longer proposed", () => {
    expect(lib.toPublicProposal(row(), at(0), false)).toMatchObject({ preview: null, previewDigest: null });
    expect(lib.toPublicProposal(row({ state: "rejected", decided_at: DECIDED, decided_by: VIEWER }), at(0))).toMatchObject({ previewDigest: null });
  });

  it("resumable only for a confirmed row this viewer decided at least PROPOSAL_RESUME_AFTER_MS ago", () => {
    const confirmed = row({ state: "confirmed", decided_at: DECIDED, decided_by: VIEWER });
    expect(lib.toPublicProposal(confirmed, at(PROPOSAL_RESUME_AFTER_MS))?.resumable).toBe(true);
    expect(lib.toPublicProposal(confirmed, at(PROPOSAL_RESUME_AFTER_MS - 1))?.resumable).toBe(false);
    expect(lib.toPublicProposal(confirmed, { ...at(10 * PROPOSAL_RESUME_AFTER_MS), userId: "7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b" })?.resumable).toBe(false);
    for (const state of ["executed", "failed", "proposed", "withdrawn"]) {
      expect(lib.toPublicProposal(row({ state, decided_at: DECIDED, decided_by: VIEWER }), at(10 * PROPOSAL_RESUME_AFTER_MS))?.resumable).toBe(false);
    }
  });

  it("an agent row names its grantor and an unverified client name; a missing grantor is said as such", () => {
    const agent = { principal_kind: "agent", agent_grant_id: "9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a", agent_client_label: "Desk agent", agent_grantor_email: "o@example.com" };
    expect(lib.toPublicProposal(row(agent), at(0))?.proposer).toEqual({ kind: "agent", grantedBy: "o@example.com", clientLabel: "Desk agent", clientLabelVerified: false });
    expect(lib.toPublicProposal(row({ ...agent, agent_grantor_email: null }), at(0))?.proposer).toMatchObject({ grantedBy: "a member of this workspace" });
  });

  it.each([
    ["an action type without an executor", { action_type: "merge_documents" }],
    ["an input that does not parse", { input: { ...input, extra: 1 } }],
    ["an agent row without its grant fields", { principal_kind: "agent", agent_grant_id: "9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a" }],
  ])("%s has no public form (it is hidden, never shown without a preview)", (_name, fields) => {
    expect(lib.toPublicProposal(row(fields), at(0))).toBeNull();
  });
});

describe("the store's answer is checked field by field", () => {
  const good = {
    proposal_id: "00000000-0000-4000-8000-000000000001", workspace_key: "pilot-a", collection_id: null, action_type: "compile_plan", input: {},
    input_sha256: "sha256:x", evidence_ids: [], state: "proposed", expires_at: "x", created_at: "x", decided_at: null, binding_kind: "source_inventory",
    principal_kind: "agent", principal_id: "u", agent_grant_id: "g", decided_by: null, expected_manifest_digest: "d", idempotency_key: "k", receipt: null,
  };
  const listed = (row: Record<string, unknown>) => { rpc.mockReturnValue({ status: 200, body: [row] }); return lib.listProposals("pilot-a", COLLECTION); };

  it("accepts the bare row (collection list) with a null collection; an agent row is then read again by id", async () => {
    rpc.mockImplementation((name) => name === "list_world_change_proposals" ? { status: 200, body: [good] }
      : { status: 200, body: { ...good, agent_client_label: "Desk agent", agent_grantor_email: null } });
    const answer = await lib.listProposals("pilot-a", COLLECTION);
    expect(answer.ok && answer.rows[0]).toMatchObject({ collection_id: null, agent_client_label: "Desk agent" });
    expect(rpc.mock.calls.map((call) => call[0])).toEqual(["list_world_change_proposals", "get_world_change_proposal"]);
  });

  it.each([
    ["an agent row without a grant id", { agent_grant_id: null }],
    ["a session row with a grant id", { principal_kind: "session" }],
    ["an unknown state", { state: "approved" }],
    ["a missing binding kind", { binding_kind: undefined }],
    ["a numeric decider", { decided_by: 7 }],
    ["a missing receipt", { receipt: undefined }],
  ])("refuses %s", async (_name, fields) => {
    expect(await listed({ ...good, ...fields })).toEqual({ ok: false, code: "PROPOSAL_STORE_RESPONSE_INVALID", status: 503 });
  });
});

describe("the store client never throws", () => {
  const list = () => lib.listProposals("pilot-a", COLLECTION);
  it.each([
    ["an unconfigured store", () => { configured = false; }, "PROPOSAL_STORE_NOT_CONFIGURED", 503],
    ["an unreachable store", () => rpc.mockReturnValue("unreachable"), "PROPOSAL_STORE_UNREACHABLE", 503],
    ["a missing migration", () => rpc.mockReturnValue({ status: 404, body: { code: "PGRST202", message: "no function" } }), "PROPOSAL_STORE_MIGRATION_ABSENT", 503],
    ["an unknown store error", () => rpc.mockReturnValue({ status: 500, body: { message: "boom" } }), "PROPOSAL_STORE_FAILED", 503],
    ["an invalid request", () => rpc.mockReturnValue({ status: 400, body: { message: "proposal_request_invalid" } }), "PROPOSAL_REQUEST_INVALID", 400],
    ["a malformed list", () => rpc.mockReturnValue({ status: 200, body: [{ nope: true }] }), "PROPOSAL_STORE_RESPONSE_INVALID", 503],
  ])("%s becomes a coded refusal", async (_name, arrange, code, status) => {
    arrange();
    expect(await list()).toEqual({ ok: false, code, status });
  });
});
