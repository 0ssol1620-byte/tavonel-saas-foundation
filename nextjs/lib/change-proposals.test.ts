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
  it("shows the preview and state, never the digest, the principal or the idempotency key", () => {
    const row = {
      proposal_id: "p1", workspace_key: "pilot-a", collection_id: COLLECTION, action_type: "library_label", input, input_sha256: "sha256:x",
      evidence_ids: ["ev-1"], state: "proposed", expires_at: "2026-11-23T00:00:00Z", created_at: "2026-11-16T00:00:00Z", decided_at: null,
      expected_manifest_digest: "sha256:y", principal_id: "u1", idempotency_key: "secret-key-001", receipt: null,
    } as unknown as Parameters<typeof lib.toPublicProposal>[0];
    const publicRow = lib.toPublicProposal(row);
    expect(publicRow).toEqual({
      proposalId: "p1", actionType: "library_label", state: "proposed", preview: input, evidenceIds: ["ev-1"],
      expiresAt: "2026-11-23T00:00:00Z", createdAt: "2026-11-16T00:00:00Z", decidedAt: null,
    });
    expect(JSON.stringify(publicRow)).not.toMatch(/sha256|principal|secret-key|manifest/);
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
