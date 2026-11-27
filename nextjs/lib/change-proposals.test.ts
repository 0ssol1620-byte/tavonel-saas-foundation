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

  // Updated deliberately in WO-AN-4: compile_plan and ontology_label_patch gained their executors.
  it("offers exactly the three action types that have an executor", () => {
    expect(lib.PROPOSAL_ACTION_TYPES).toEqual(["library_label", "compile_plan", "ontology_label_patch"]);
    expect(Object.keys(lib.PROPOSAL_EXECUTORS).sort()).toEqual([...lib.PROPOSAL_ACTION_TYPES].sort());
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
      // WO-AN-10: two more fields, neither an id: who decided relative to this viewer, and whether a signed receipt is stored.
      youDecided: null, receiptAvailable: false,
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

/*
  The inbox cursor (§16, WO-AN-4): its timestamp goes to the store as text and PostgreSQL casts it. A value
  PostgreSQL refuses must be a 400 here, never the store's error (a 503). The mock store below refuses
  timestamps the way PostgreSQL does, independently of the code under test.
*/
describe("cursor validation", () => {
  const ID = "00000000-0000-4000-8000-000000000001";
  const viewer = { workspaceKey: "pilot-a", userId: "7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a" };
  const cursorOf = (text: string) => Buffer.from(text, "utf8").toString("base64url");
  const page = (cursor: string) => lib.listProposalsPage(viewer, { cursor });

  /** What `'<text>'::timestamptz` accepts (ISO form with T): calendar dates, years 1.., hour 24 only as 24:00:00, offsets within ±15:59. */
  function postgresAccepts(text: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(text);
    if (!match) return false;
    const [y, mo, d, h, mi, sec] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number];
    const fraction = Number(match[7] ?? "0");
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > days[mo - 1]!) return false;
    if (h > 24 || (h === 24 && (mi !== 0 || sec !== 0 || fraction !== 0)) || mi > 59 || sec > 60) return false;
    return match[8] === "Z" || (Number(match[10]) <= 15 && Number(match[11]) <= 59);
  }

  beforeEach(() => {
    rpc.mockImplementation((name, body) => {
      if (name !== "list_world_change_proposals_page") return { status: 500, body: { message: "unexpected" } };
      const at = body.p_before_created_at;
      return at === null || postgresAccepts(at as string)
        ? { status: 200, body: [] }
        : { status: 400, body: { code: "22008", message: "date/time field value out of range" } };
    });
  });

  it.each([
    ["a day that does not exist", "2026-02-30T00:00:00Z"],
    ["year zero", "0000-01-01T00:00:00Z"],
    ["an offset beyond ±15:59", "2026-01-01T00:00:00-23:59"],
    ["month 13", "2026-13-01T00:00:00Z"],
    ["hour 25", "2026-01-01T25:00:00+00:00"],
    ["minute 60", "2026-01-01T00:60:00Z"],
    ["offset minutes 60", "2026-01-01T00:00:00+01:60"],
    ["29 February of a common year", "2025-02-29T00:00:00.123456+00:00"],
  ])("%s is 400 and the store is never paged", async (_name, text) => {
    expect(await page(cursorOf(`${text}|${ID}`))).toEqual({ ok: false, code: "PROPOSAL_REQUEST_INVALID", status: 400 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["the store's own form", "2026-11-16T12:00:00.000001+00:00"],
    ["a leap day", "2024-02-29T23:59:59Z"],
    ["the widest offset", "2026-01-01T00:00:00-15:59"],
    ["year one", "0001-01-01T00:00:00+00:00"],
  ])("%s pages the store", async (_name, text) => {
    expect(await page(cursorOf(`${text}|${ID}`))).toEqual({ ok: true, rows: [], nextCursor: null });
  });

  it("fuzz: generated timestamps are 200 or 400, never the store's 503", async () => {
    let seed = 20261117;
    const next = () => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed / 2_147_483_648; };
    const two = (values: number[]) => String(values[Math.floor(next() * values.length)]).padStart(2, "0");
    const years = ["0000", "0001", "0099", "1900", "2000", "2024", "2025", "2026", "9999"];
    let accepted = 0;
    for (let index = 0; index < 1_500; index += 1) {
      rpc.mockClear();
      const offset = next() < 0.3 ? "Z" : `${next() < 0.5 ? "+" : "-"}${two([0, 1, 9, 14, 15, 16, 23, 24, 99])}:${two([0, 30, 59, 60, 99])}`;
      const fraction = next() < 0.5 ? "" : `.${String(Math.floor(next() * 1e6)).slice(0, 1 + Math.floor(next() * 6))}`;
      const text = `${years[Math.floor(next() * years.length)]}-${two([0, 1, 2, 4, 6, 9, 11, 12, 13, 99])}-${two([0, 1, 28, 29, 30, 31, 32])}`
        + `T${two([0, 9, 12, 23, 24, 25])}:${two([0, 30, 59, 60])}:${two([0, 30, 59, 60, 61])}${fraction}${offset}`;
      const answer = await page(cursorOf(`${text}|${ID}`));
      const label = `case ${index}: ${text}`;
      if (answer.ok) accepted += 1;
      else expect(answer, label).toEqual({ ok: false, code: "PROPOSAL_REQUEST_INVALID", status: 400 });
      if (!answer.ok) expect(rpc, label).not.toHaveBeenCalled();
      // Everything accepted here PostgreSQL accepts too.
      if (answer.ok) expect(postgresAccepts(text), label).toBe(true);
    }
    expect(accepted).toBeGreaterThan(20);
  });
});

// WO-AGENT-OAUTH-1 review P1: the sweep that revokes an ended OAuth grant asks this first; open, unknown and unreadable never read as "none".
describe("grantHasOpenProposals", () => {
  const GRANT = "9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a";
  const agentRow = (n: number, state: string) => ({
    proposal_id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, workspace_key: "pilot-a", collection_id: COLLECTION, action_type: "library_label",
    input, input_sha256: `sha256:${"9".repeat(64)}`, evidence_ids: ["ev-1"], state, expires_at: "2026-11-23T00:00:00Z",
    created_at: `2026-11-16T00:00:${String(59 - (n % 60)).padStart(2, "0")}Z`, decided_at: state === "proposed" ? null : "2026-11-17T00:00:00Z",
    expected_manifest_digest: `sha256:${"8".repeat(64)}`, principal_kind: "agent", principal_id: "7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a", idempotency_key: "secret-key-001",
    receipt: null, binding_kind: "active_manifest", agent_grant_id: GRANT, decided_by: state === "proposed" || state === "withdrawn" ? null : "7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a",
    agent_client_label: "ChatGPT #AAAAAAAAAAAA", agent_grantor_email: null,
  });

  it("asks the store for this grant only and answers open only for a proposed row", async () => {
    rpc.mockImplementation(() => ({ status: 200, body: [agentRow(1, "rejected"), agentRow(2, "withdrawn")] }));
    expect(await lib.grantHasOpenProposals("pilot-a", GRANT)).toEqual({ ok: true, open: false });
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_workspace_key: "pilot-a", p_agent_grant_id: GRANT, p_before_created_at: null });
    rpc.mockImplementation(() => ({ status: 200, body: [agentRow(1, "rejected"), agentRow(2, "proposed")] }));
    expect(await lib.grantHasOpenProposals("pilot-a", GRANT)).toEqual({ ok: true, open: true });
  });

  it("no rows is none; a store failure is a failure; a malformed id never reaches the store", async () => {
    rpc.mockImplementation(() => ({ status: 200, body: [] }));
    expect(await lib.grantHasOpenProposals("pilot-a", GRANT)).toEqual({ ok: true, open: false });
    rpc.mockReset();
    rpc.mockImplementation(() => ({ status: 500, body: { message: "down" } }));
    expect((await lib.grantHasOpenProposals("pilot-a", GRANT)).ok).toBe(false);
    rpc.mockReset();
    expect(await lib.grantHasOpenProposals("pilot-a", "not-a-uuid")).toEqual({ ok: false, code: "PROPOSAL_REQUEST_INVALID", status: 400 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("full pages with nothing open past the scan bound read as open (never withdraw what was not seen)", async () => {
    let n = 0;
    rpc.mockImplementation(() => ({ status: 200, body: Array.from({ length: 50 }, () => agentRow(++n, "rejected")) }));
    expect(await lib.grantHasOpenProposals("pilot-a", GRANT)).toEqual({ ok: true, open: true });
    expect(rpc.mock.calls.length).toBeGreaterThan(1);
    expect(rpc.mock.calls[1]![1].p_before_id).toBe(`00000000-0000-4000-8000-${String(50).padStart(12, "0")}`);
  });
});
