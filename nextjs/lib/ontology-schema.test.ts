import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  C1 server side: the flag, the public/internal split, and the two routes' refusals. The store is
  the Supabase RPC behind supabaseAdminRequest, stubbed here; the database's own refusals
  (cross-workspace, append-only, evidence required) are proved in supabase/tests/ontology_schema_candidates.sql.
*/

const { session, adminRequest, loadWorld, sourceAccess, admits } = vi.hoisted(() => ({
  session: vi.fn(),
  adminRequest: vi.fn(),
  loadWorld: vi.fn(),
  sourceAccess: vi.fn(),
  admits: vi.fn(),
}));
vi.mock("@/lib/developer-auth", () => ({ requireFoundationSession: session }));
vi.mock("./supabase-admin", () => ({ readSupabaseAdminConfig: () => ({ url: "https://db.test", serviceRoleKey: "k" }), supabaseAdminRequest: adminRequest }));
vi.mock("@/lib/world-read-model", () => ({ loadWorldReadModel: loadWorld }));
vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccess: sourceAccess }));
vi.mock("@/lib/derived-data-admission", () => ({ admitsDerivedCustomerData: admits, DERIVED_DATA_REFUSED: "DERIVED_DATA_REFUSED" }));

import { GET, POST } from "@/app/api/ontology/candidates/route";
import { POST as DECIDE } from "@/app/api/ontology/candidates/[candidateId]/route";
import { ontologyInductionEnabled, toPublicCandidates, unitsFromWorldEvidence, type InternalCandidates } from "./ontology-schema";

const COLLECTION = `collection-${"a".repeat(32)}`;
const MANIFEST = `sha256:${"b".repeat(64)}`;
const DOC = "0a000000-0000-4000-8000-0000000000a1";
const CANDIDATE = "11111111-2222-4333-8444-555555555555";

const INTERNAL: InternalCandidates = {
  run: {
    runId: "99999999-2222-4333-8444-555555555555", collectionId: COLLECTION, manifestDigest: MANIFEST, deriver: "model",
    // Synthetic pins, none of them a real model, revision, prompt or price snapshot.
    deriverVersion: "synthetic-deriver:1", documentIds: [DOC], modelId: "synthetic/model-x", modelRevision: "0000000000synthetic",
    promptSha256: `sha256:${"d".repeat(64)}`, schemaSha256: `sha256:${"f".repeat(64)}`, inputsSha256: `sha256:${"1".repeat(64)}`,
    priceSnapshot: { priceSnapshotId: "synthetic-price-0000" }, receiptSha256: `sha256:${"3".repeat(64)}`, createdAt: "2026-11-07T11:00:00Z",
  },
  candidates: [{
    candidateId: CANDIDATE, kind: "class", key: "registrant", label: "Organization", description: "Names ending in Inc.",
    editedLabel: "Registrant", editedDescription: null, domainKey: null, rangeKey: null,
    evidence: [{ evidenceId: "ev-1", documentId: DOC, page: 2, bbox: [1, 2, 3, 4], quote: "Apple Inc." }],
    support: 318, state: "proposed", decidedBy: null, decidedAt: null,
    decisions: [{ verdict: "edit", decidedBy: "44444444-4444-4444-4444-444444444444", decidedAt: "2026-11-07T11:05:00Z" }],
  }],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const request = (url: string, body?: unknown) => new Request(url, body === undefined ? undefined : {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const decide = (body: unknown, id = CANDIDATE) => DECIDE(request(`https://tavonel.test/api/ontology/candidates/${id}`, body),
  { params: Promise.resolve({ candidateId: id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TAVONEL_ONTOLOGY_INDUCTION_ENABLED", "true");
  session.mockResolvedValue({ ok: true, principal: { workspaceKey: "pilot-c1c1c1c1c1c14c1c", userId: "44444444-4444-4444-4444-444444444444", workspaceRole: "owner" } });
  sourceAccess.mockResolvedValue({ ok: true });
  admits.mockResolvedValue(true);
  adminRequest.mockImplementation(async (_config: unknown, path: string) => path.endsWith("list_ontology_schema_candidates")
    ? json(INTERNAL)
    : json({ decisionId: "d", candidateId: CANDIDATE, verdict: "certify", state: "certified" }));
});
afterEach(() => vi.unstubAllEnvs());

describe("TAVONEL_ONTOLOGY_INDUCTION_ENABLED", () => {
  it("is on only for the exact string true", () => {
    expect(ontologyInductionEnabled({ TAVONEL_ONTOLOGY_INDUCTION_ENABLED: "true" })).toBe(true);
    for (const value of [undefined, "", "1", "TRUE", "on", "false"]) {
      expect(ontologyInductionEnabled({ TAVONEL_ONTOLOGY_INDUCTION_ENABLED: value })).toBe(false);
    }
  });

  it("off: every route answers 404 before reading a session, and nothing reaches the store", async () => {
    vi.stubEnv("TAVONEL_ONTOLOGY_INDUCTION_ENABLED", "");
    const answers = await Promise.all([
      GET(request(`https://tavonel.test/api/ontology/candidates?collectionId=${COLLECTION}`)),
      POST(request("https://tavonel.test/api/ontology/candidates", { collectionId: COLLECTION, manifestDigest: MANIFEST })),
      decide({ collectionId: COLLECTION, verdict: "certify", reason: "Matches the cover page." }),
    ]);
    for (const answer of answers) {
      expect(answer.status).toBe(404);
      expect(await answer.json()).toEqual({ code: "ONTOLOGY_INDUCTION_DISABLED" });
    }
    expect(session).not.toHaveBeenCalled();
    expect(adminRequest).not.toHaveBeenCalled();
    expect(loadWorld).not.toHaveBeenCalled();
  });
});

describe("public DTO", () => {
  it("is built field by field: no support count, no model id, revision, prompt, schema, price or receipt, no decider id", () => {
    const shown = toPublicCandidates(INTERNAL);
    const text = JSON.stringify(shown);
    for (const internal of ["support", "318", "synthetic/model-x", "0000000000synthetic", "modelId", "promptSha256", "schemaSha256", "priceSnapshot",
      "synthetic-price-0000", "receiptSha256", "documentIds", "decidedBy", "44444444-4444"]) {
      expect(text, internal).not.toContain(internal);
    }
    expect(shown.candidates[0]).toMatchObject({ label: "Registrant", proposedLabel: "Organization", state: "proposed",
      history: [{ verdict: "edit", decidedAt: "2026-11-07T11:05:00Z" }] });
    expect(shown.run).toEqual({ runId: INTERNAL.run!.runId, collectionId: COLLECTION, manifestDigest: MANIFEST, deriver: "model",
      createdAt: "2026-11-07T11:00:00Z" });
  });

  it("GET serves it, and refuses when the reader may no longer read a document the run read", async () => {
    const ok = await GET(request(`https://tavonel.test/api/ontology/candidates?collectionId=${COLLECTION}`));
    expect(ok.status).toBe(200);
    expect(JSON.stringify(await ok.json())).not.toContain("support");
    expect(sourceAccess).toHaveBeenCalledWith("pilot-c1c1c1c1c1c14c1c", [DOC]);

    sourceAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    const denied = await GET(request(`https://tavonel.test/api/ontology/candidates?collectionId=${COLLECTION}`));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
  });
});

describe("derivation units", () => {
  const evidence = { id: "ev-1", sourceId: DOC, sourceVersionId: "v", page: 1, bbox: [0, 0, 1, 1] as [number, number, number, number],
    blockId: "b", excerpt: "Apple Inc.", authority: "official", digest: "d" };
  it("refuses a World whose evidence is not bound to workspace documents, and one without evidence", () => {
    expect(unitsFromWorldEvidence([{ ...evidence, sourceId: "apple-form-10-k" }])).toEqual({ ok: false, code: "ONTOLOGY_SOURCE_UNBOUND" });
    expect(unitsFromWorldEvidence([])).toEqual({ ok: false, code: "ONTOLOGY_NO_EVIDENCE" });
    expect(unitsFromWorldEvidence([evidence])).toMatchObject({ ok: true, units: [{ evidenceId: "ev-1", documentId: DOC, text: "Apple Inc." }] });
  });

  it("POST derives from the exact World revision and records proposed candidates through the RPC", async () => {
    const excerpt = (id: string, text: string) => ({ ...evidence, id, excerpt: text });
    loadWorld.mockResolvedValue({ ok: true, model: { world: { manifestDigest: MANIFEST }, evidence: [
      excerpt("e1", "Apple Inc. is listed on The Nasdaq Stock Market."), excerpt("e2", "Contoso Holdings Inc. is listed on The London Stock Market."),
      excerpt("e3", "Fabrikam Industries Inc. is listed on The Tokyo Stock Market."),
    ] } });
    adminRequest.mockResolvedValue(json({ runId: "r", created: true, candidates: 3 }));
    const answer = await POST(request("https://tavonel.test/api/ontology/candidates", { collectionId: COLLECTION, manifestDigest: MANIFEST }));
    expect(answer.status).toBe(201);
    expect(loadWorld).toHaveBeenCalledWith("pilot-c1c1c1c1c1c14c1c", COLLECTION, MANIFEST);
    const [, path, init] = adminRequest.mock.calls[0]!;
    expect(path).toBe("/rest/v1/rpc/record_ontology_derivation_run");
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.p_run).toMatchObject({ deriver: "baseline", promptSha256: null, documentIds: [DOC], createdBy: "44444444-4444-4444-4444-444444444444" });
    expect(sent.p_candidates.every((candidate: Record<string, unknown>) => !("state" in candidate))).toBe(true);
  });

  it("POST refuses a member who is not owner or admin, before loading anything", async () => {
    session.mockResolvedValue({ ok: true, principal: { workspaceKey: "pilot-c1c1c1c1c1c14c1c", userId: "u", workspaceRole: "member" } });
    const answer = await POST(request("https://tavonel.test/api/ontology/candidates", { collectionId: COLLECTION, manifestDigest: MANIFEST }));
    expect(answer.status).toBe(403);
    expect(loadWorld).not.toHaveBeenCalled();
    expect(adminRequest).not.toHaveBeenCalled();
  });
});

describe("decisions", () => {
  it("a reject without a reason is refused before the store", async () => {
    for (const reason of [undefined, "", "   ", "short"]) {
      const answer = await decide({ collectionId: COLLECTION, verdict: "reject", reason });
      expect(answer.status).toBe(400);
      expect(await answer.json()).toEqual({ code: "ONTOLOGY_DECISION_REASON_REQUIRED" });
    }
    expect(adminRequest).not.toHaveBeenCalled();
  });

  it("an edit without a name is refused; an unknown verdict is refused", async () => {
    expect((await decide({ collectionId: COLLECTION, verdict: "edit", reason: "Better wording here.", label: " " })).status).toBe(400);
    expect((await decide({ collectionId: COLLECTION, verdict: "approve_all", reason: "Looks fine to me." })).status).toBe(400);
    expect(adminRequest).not.toHaveBeenCalled();
  });

  it("a candidate outside the caller's workspace's latest run is not found, and nothing is decided", async () => {
    const answer = await decide({ collectionId: COLLECTION, verdict: "certify", reason: "Matches the cover page." },
      "aaaaaaaa-2222-4333-8444-555555555555");
    expect(answer.status).toBe(404);
    expect(adminRequest.mock.calls.map(([, path]) => path)).toEqual(["/rest/v1/rpc/list_ontology_schema_candidates"]);
  });

  it("a certify is one RPC call with the session's workspace and person, after the access check", async () => {
    const answer = await decide({ collectionId: COLLECTION, verdict: "certify", reason: "Matches the cover page." });
    expect(answer.status).toBe(201);
    expect(await answer.json()).toMatchObject({ code: "RECORDED", state: "certified" });
    const [, path, init] = adminRequest.mock.calls[1]!;
    expect(path).toBe("/rest/v1/rpc/decide_ontology_schema_candidate");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ p_workspace_key: "pilot-c1c1c1c1c1c14c1c", p_candidate_id: CANDIDATE,
      p_verdict: "certify", p_actor: "44444444-4444-4444-4444-444444444444", p_reason: "Matches the cover page.", p_edit: null });
  });

  it("maps the database's refusals to stable codes, and an unknown failure to 503", async () => {
    const refusal = (message: string) => adminRequest.mockImplementation(async (_config: unknown, path: string) =>
      path.endsWith("list_ontology_schema_candidates") ? json(INTERNAL) : json({ code: "P0001", message }, 400));
    refusal("ontology_candidate_already_decided");
    expect([(await decide({ collectionId: COLLECTION, verdict: "reject", reason: "Too generic a type." })).status]).toEqual([409]);
    refusal("ontology_source_deleted");
    const deleted = await decide({ collectionId: COLLECTION, verdict: "reject", reason: "Too generic a type." });
    expect([deleted.status, await deleted.json()]).toEqual([409, { code: "ONTOLOGY_SOURCE_DELETED" }]);
    refusal("something else entirely");
    expect((await decide({ collectionId: COLLECTION, verdict: "reject", reason: "Too generic a type." })).status).toBe(503);
  });
});
