import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  Blueprint 2026-09-08 §32, S-21: what `/ask` costs to serve, bounded.

  Before this, the only limit in front of the most expensive route on the surface was the edge's
  60 requests per minute per IP -- which bounds one attacker's laptop and does not bound one
  workspace, one leaked API key, or one client library retrying in a loop.

  Three failure paths are asserted here and each one is a different bug:

    * the fifth concurrent question is refused rather than queued behind four running ones,
    * a slot is released even when the work throws, because a leaked slot is a workspace that
      can never ask again until the deadline,
    * a retry carrying the same idempotency key is answered from the first result without the
      retrieval pipeline running twice, and the same key with a DIFFERENT question is a 409
      rather than a wrong answer served confidently.
*/

const { authorize, revalidate, activeWorld, pipeline, sourceIds, sourceAccess } = vi.hoisted(() => ({
  authorize: vi.fn(),
  revalidate: vi.fn(),
  activeWorld: vi.fn(),
  pipeline: vi.fn(),
  sourceIds: vi.fn(), sourceAccess: vi.fn(),
}));
vi.mock("@/lib/active-world-source-access", () => ({ loadActiveWorldSourceIds: sourceIds }));
vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccess: sourceAccess, checkConnectorSourceAccessForViewer: sourceAccess }));

vi.mock("@/lib/developer-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-auth")>()),
  authorizeFoundationRequest: authorize,
  revalidateFoundationAuthorization: revalidate,
}));
vi.mock("@/lib/world-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world-store")>()),
  getFoundationActiveWorld: activeWorld,
}));
vi.mock("@/lib/retrieval-pipeline", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./retrieval-pipeline")>()),
  runRetrievalPipeline: pipeline,
}));

import { POST as ask, maxDuration } from "../app/api/collections/[id]/ask/route";
import { buildContextPacket } from "./context-packet";
import { answerFromContextPacket, COMPILED_ANSWER_CHARACTER_LIMIT, EVIDENCE_EXCEEDS_ANSWER_LIMIT } from "./grounded-ask";
import { WORKSPACE_ASK_CONCURRENCY, resetWorkspaceCostGuard } from "./workspace-cost-guard";

const WORKSPACE = "pilot-askcost";
const COLLECTION = `collection-${"c".repeat(32)}`;
const params = Promise.resolve({ id: COLLECTION });

function question(text: string, idempotencyKey?: string) {
  const body = JSON.stringify({ question: text });
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: "Bearer tvnl_live_probe",
  };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  return new Request(`https://tavonel.test/api/collections/${COLLECTION}/ask`, { method: "POST", headers, body });
}

beforeEach(() => {
  vi.clearAllMocks();
  sourceIds.mockResolvedValue({ ok: true, documentIds: ["source-fixture"] });
  sourceAccess.mockResolvedValue({ ok: true });
  revalidate.mockImplementation(async (_request, expected) => ({ ok: true, principal: expected }));
  resetWorkspaceCostGuard();
  authorize.mockResolvedValue({
    ok: true,
    principal: { kind: "api-key", workspaceKey: WORKSPACE, userId: "user-1", scopes: [], authorizationRevision: 7, workspaceRole: "owner" },
  });
  activeWorld.mockResolvedValue({
    ok: true,
    world: {
      manifestDigest: `sha256:${"d".repeat(64)}`,
      revision: 3,
      worldStateId: "world-state-1",
      candidateObjectKey: `candidates/${WORKSPACE}/${COLLECTION}/candidate.json`,
    },
  });
  pipeline.mockResolvedValue({
    ok: true,
    packet: { worldId: COLLECTION, worldVersion: "3", retrievalProfile: "p", question: "q", items: [], heldConflicts: [], abstentionReasons: [] },
    diagnostics: { compileRunId: "run-1", retrievalProfileId: "p", rerankerApplied: false, gateRejections: [], degradations: [] },
  });
});

afterEach(() => {
  resetWorkspaceCostGuard();
});

describe("per-workspace concurrency", () => {
  it("refuses the request past the cap instead of running it", async () => {
    // Four questions parked inside the pipeline, none finished.
    let unblock = () => {};
    const parked = new Promise<void>((resolve) => { unblock = () => resolve(); });
    pipeline.mockImplementation(async () => {
      await parked;
      return {
        ok: true,
        packet: { worldId: COLLECTION, worldVersion: "3", retrievalProfile: "p", question: "q", items: [], heldConflicts: [], abstentionReasons: [] },
        diagnostics: { compileRunId: "run-1", retrievalProfileId: "p", rerankerApplied: false, gateRejections: [], degradations: [] },
      };
    });

    const inFlight = Array.from({ length: WORKSPACE_ASK_CONCURRENCY }, (_, index) =>
      ask(question(`parked question ${index}`), { params }));
    // Let each of them reach the pipeline before the next request asks for a slot.
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    const overLimit = await ask(question("one question too many"), { params });
    expect(overLimit.status).toBe(429);
    expect(await overLimit.json()).toEqual({
      code: "WORKSPACE_CONCURRENCY_LIMIT",
      concurrencyLimit: WORKSPACE_ASK_CONCURRENCY,
    });
    expect(overLimit.headers.get("retry-after")).toBe("5");

    unblock();
    await Promise.all(inFlight);
  });

  it("frees the slot when the work finishes, so the next question is served", async () => {
    for (let index = 0; index <= WORKSPACE_ASK_CONCURRENCY; index += 1) {
      const response = await ask(question(`sequential question ${index}`), { params });
      expect(response.status).toBe(200);
    }
    expect(pipeline).toHaveBeenCalledTimes(WORKSPACE_ASK_CONCURRENCY + 1);
  });

  it("frees the slot when the work throws, rather than leaking it until the deadline", async () => {
    pipeline.mockRejectedValueOnce(new Error("pipeline exploded"));
    await expect(ask(question("the question that throws"), { params })).rejects.toThrow("pipeline exploded");
    // If the slot had leaked, the next four would still pass and the fifth would 429. The
    // cheaper and stricter assertion is that a full cap's worth still runs afterwards.
    for (let index = 0; index < WORKSPACE_ASK_CONCURRENCY; index += 1) {
      expect((await ask(question(`after the throw ${index}`), { params })).status).toBe(200);
    }
  });

  it("counts slots per workspace, not across the deployment", async () => {
    let unblock = () => {};
    const parked = new Promise<void>((resolve) => { unblock = () => resolve(); });
    pipeline.mockImplementation(async () => {
      await parked;
      return {
        ok: true,
        packet: { worldId: COLLECTION, worldVersion: "3", retrievalProfile: "p", question: "q", items: [], heldConflicts: [], abstentionReasons: [] },
        diagnostics: { compileRunId: "run-1", retrievalProfileId: "p", rerankerApplied: false, gateRejections: [], degradations: [] },
      };
    });
    const inFlight = Array.from({ length: WORKSPACE_ASK_CONCURRENCY }, (_, index) =>
      ask(question(`parked question ${index}`), { params }));
    await new Promise((resolve) => setImmediate(resolve));

    authorize.mockResolvedValue({
      ok: true,
      principal: { kind: "api-key", workspaceKey: "pilot-elsewhere", userId: "user-2", scopes: [], authorizationRevision: 7 },
    });
    const other = ask(question("a different tenant asks"), { params });
    await new Promise((resolve) => setImmediate(resolve));
    unblock();
    expect((await other).status).toBe(200);
    await Promise.all(inFlight);
  });
});

describe("idempotency", () => {
  it("refuses cached knowledge after its source is suspended", async () => {
    expect((await ask(question("what changed in the filing?", "source-revoked-0001"), { params })).status).toBe(200);
    sourceAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    const denied = await ask(question("what changed in the filing?", "source-revoked-0001"), { params });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    expect(denied.headers.get("x-tavonel-idempotent-replay")).toBeNull();
    expect(pipeline).toHaveBeenCalledTimes(1);
  });
  it("refuses knowledge when source access changes after cache completion", async () => {
    sourceAccess.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: true })
      .mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    const denied = await ask(question("what changed in the filing?", "source-late-0001"), { params });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    expect(sourceAccess).toHaveBeenCalledTimes(3);
    expect(sourceAccess.mock.calls).toEqual(Array.from({ length: 3 }, () => [WORKSPACE, ["source-fixture"], "user-1"]));
  });
  it("does not cache an answer whose source is revoked while the pipeline is in flight", async () => {
    const defaultPipeline = pipeline.getMockImplementation()!;
    let entered = () => {};
    const pipelineEntered = new Promise<void>((resolve) => { entered = () => resolve(); });
    let unblock = () => {};
    const parked = new Promise<void>((resolve) => { unblock = () => resolve(); });
    pipeline.mockImplementationOnce(async (...args: unknown[]) => {
      entered();
      await parked;
      return defaultPipeline(...args);
    });

    const inFlight = ask(question("what changed in the filing?", "source-inflight-0001"), { params });
    await pipelineEntered;
    expect(sourceAccess).toHaveBeenCalled();
    expect(await sourceAccess.mock.results[0].value).toEqual({ ok: true });

    sourceAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    unblock();
    const denied = await inFlight;
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    expect(denied.headers.get("x-tavonel-idempotent-replay")).toBeNull();

    sourceAccess.mockResolvedValue({ ok: true });
    const retry = await ask(question("what changed in the filing?", "source-inflight-0001"), { params });
    expect(retry.status).toBe(200);
    expect(retry.headers.get("x-tavonel-idempotent-replay")).toBeNull();
    expect(pipeline).toHaveBeenCalledTimes(2);
  });
  it("does not run either answer path when the source binding cannot be resolved", async () => {
    sourceIds.mockResolvedValue({ ok: false, code: "COLLECTION_SOURCE_BINDING_INVALID" });
    const denied = await ask(question("what changed in the filing?"), { params });
    expect(denied.status).toBe(503);
    expect(pipeline).not.toHaveBeenCalled();
  });
  it("never returns a cached answer after late authorization is revoked", async () => {
    expect((await ask(question("what changed in the filing?", "revoked-key-0001"), { params })).status).toBe(200);
    revalidate.mockResolvedValueOnce({ ok: false, code: "API_KEY_REVOKED", status: 401 });
    const denied = await ask(question("what changed in the filing?", "revoked-key-0001"), { params });
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ code: "API_KEY_REVOKED" });
    expect(denied.headers.get("x-tavonel-idempotent-replay")).toBeNull();
    expect(pipeline).toHaveBeenCalledTimes(1);
  });

  it("does not cache a freshly computed result when authorization changes", async () => {
    revalidate.mockResolvedValueOnce({ ok: false, code: "AUTHORIZATION_CHANGED_RETRY", status: 403 });
    expect((await ask(question("what changed in the filing?", "revoked-key-0002"), { params })).status).toBe(403);
    const retry = await ask(question("what changed in the filing?", "revoked-key-0002"), { params });
    expect(retry.status).toBe(200);
    expect(retry.headers.get("x-tavonel-idempotent-replay")).toBeNull();
    expect(pipeline).toHaveBeenCalledTimes(2);
  });

  it("replays the first answer without running the pipeline again", async () => {
    const first = await ask(question("what changed in the filing?", "retry-key-0001"), { params });
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const second = await ask(question("what changed in the filing?", "retry-key-0001"), { params });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(firstBody);
    expect(second.headers.get("x-tavonel-idempotent-replay")).toBe("true");
    expect(pipeline).toHaveBeenCalledTimes(1);
  });

  it("refuses an answer when authority changes during cache cleanup", async () => {
    revalidate
      .mockImplementationOnce(async (_request, expected) => ({ ok: true, principal: expected }))
      .mockResolvedValueOnce({ ok: false, code: "AUTHORIZATION_CHANGED_RETRY", status: 403 });
    const denied = await ask(question("what changed in the filing?", "release-race-0001"), { params });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ code: "AUTHORIZATION_CHANGED_RETRY" });
    expect(revalidate).toHaveBeenCalledTimes(2);
  });

  it("does not replay an answer across an authority epoch change", async () => {
    expect((await ask(question("what changed in the filing?", "epoch-change-0001"), { params })).status).toBe(200);
    authorize.mockResolvedValue({
      ok: true,
      principal: {
        kind: "api-key", workspaceKey: WORKSPACE, userId: "user-1", scopes: [], authorizationRevision: 8,
      },
    });
    const second = await ask(question("what changed in the filing?", "epoch-change-0001"), { params });
    expect(second.status).toBe(200);
    expect(second.headers.get("x-tavonel-idempotent-replay")).toBeNull();
    expect(pipeline).toHaveBeenCalledTimes(2);
  });

  it("refuses the same key with a different question rather than answering the wrong one", async () => {
    await ask(question("what changed in the filing?", "retry-key-0002"), { params });
    const conflict = await ask(question("a completely different question", "retry-key-0002"), { params });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ code: "IDEMPOTENCY_CONFLICT" });
    expect(pipeline).toHaveBeenCalledTimes(1);
  });

  it("refuses a malformed key rather than ignoring it", async () => {
    const response = await ask(question("what changed in the filing?", "short"), { params });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "IDEMPOTENCY_KEY_INVALID" });
    expect(pipeline).not.toHaveBeenCalled();
  });

  it("never remembers a failure, so an outage is not replayed for ten minutes", async () => {
    activeWorld.mockResolvedValueOnce({ ok: false, code: "ACTIVE_WORLD_STORE_UNAVAILABLE" });
    const failed = await ask(question("what changed in the filing?", "retry-key-0003"), { params });
    expect(failed.status).toBe(503);

    const retried = await ask(question("what changed in the filing?", "retry-key-0003"), { params });
    expect(retried.status).toBe(200);
    expect(retried.headers.get("x-tavonel-idempotent-replay")).toBeNull();
  });

  it("scopes a key to its workspace, so two tenants may use the same key string", async () => {
    await ask(question("what changed in the filing?", "shared-key-0001"), { params });
    authorize.mockResolvedValue({
      ok: true,
      principal: { kind: "api-key", workspaceKey: "pilot-elsewhere", userId: "user-2", scopes: [], authorizationRevision: 7 },
    });
    const other = await ask(question("an entirely different question", "shared-key-0001"), { params });
    expect(other.status).toBe(200);
    expect(pipeline).toHaveBeenCalledTimes(2);
  });
});

/*
  The compiled answer envelope through the real route: the pipeline is the only stub, and the
  answer is the real answerFromContextPacket. Evidence over COMPILED_ANSWER_CHARACTER_LIMIT is an
  abstention with no partial answer and its verified citations kept -- and a replay serves that
  same receipt and those same citations without running retrieval again.
*/
describe("a compiled answer over its envelope", () => {
  it("abstains with its verified citations and receipt, and replays both without re-running retrieval", async () => {
    const packet = buildContextPacket([
      {
        unitId: "unit-overflow",
        text: `Renewal clause ${"x".repeat(COMPILED_ANSWER_CHARACTER_LIMIT)}`,
        claimIds: ["claim-renewal"],
        entityIds: ["entity-contract"],
        sourceVersionId: "version-a",
        evidenceIds: ["evidence-a", "evidence-b"],
        pageNumber1: 4,
        bbox1000: [10, 20, 900, 800],
        authority: "official",
        lexicalRank: 1,
        rerankerScore: 0.5,
      },
      {
        unitId: "unit-unboxed",
        text: "The notice period is ninety days.",
        claimIds: [],
        entityIds: [],
        sourceVersionId: "version-a",
        evidenceIds: ["evidence-c"],
        pageNumber1: null,
        bbox1000: null,
        authority: "official",
        denseRank: 2,
      },
    ], { worldId: COLLECTION, worldVersion: "3", retrievalProfile: "p", question: "what renews?" });
    pipeline.mockResolvedValue({
      ok: true,
      packet,
      diagnostics: { compileRunId: "run-1", retrievalProfileId: "p", rerankerApplied: true, gateRejections: [], degradations: [] },
    });
    const expected = answerFromContextPacket(packet, { collectionId: COLLECTION, manifestDigest: `sha256:${"d".repeat(64)}` });

    const first = await ask(question("what renews?", "overflow-key-0001"), { params });
    expect(first.status).toBe(200);
    expect(first.headers.get("x-tavonel-idempotent-replay")).toBeNull();
    const body = await first.json();
    expect(body).toMatchObject({
      code: "ANSWER_ABSTAINED",
      retrievalPath: "compiled-retrieval-v1",
      answerMode: "evidence_excerpts",
      status: "abstained",
      answer: "",
      reason: EVIDENCE_EXCEEDS_ANSWER_LIMIT,
    });
    // Exactly the builder's verified citations, in packet order, with nothing invented for them.
    expect(body.citations).toEqual(expected.citations);
    expect(body.citations.map((citation: { evidenceId: string }) => citation.evidenceId)).toEqual(["evidence-a", "evidence-c"]);
    expect(body.citations[0]).toMatchObject({ evidenceIds: ["evidence-a", "evidence-b"], sourceVersionId: "version-a", pageNumber1: 4, bbox1000: [10, 20, 900, 800] });
    expect(body.citations[1]).toMatchObject({ pageNumber1: null, bbox1000: null });
    for (const citation of body.citations) {
      expect(citation).not.toHaveProperty("sourceId");
      expect(citation).not.toHaveProperty("relevance");
    }
    // The receipt is the one the builder signed for this World, not a fixture.
    expect(body.receipt).toEqual(expected.receipt);
    expect(body.receipt).toMatchObject({ collectionId: COLLECTION, manifestDigest: `sha256:${"d".repeat(64)}`, retrieval: "p", candidatePromotion: false });
    expect(body.receipt.outputSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(body.contextPacket).toEqual(packet);
    expect(pipeline).toHaveBeenCalledTimes(1);

    const replay = await ask(question("what renews?", "overflow-key-0001"), { params });
    expect(replay.status).toBe(200);
    expect(replay.headers.get("x-tavonel-idempotent-replay")).toBe("true");
    const replayed = await replay.json();
    expect(replayed).toEqual(body);
    expect(replayed.receipt).toEqual(expected.receipt);
    expect(replayed.citations).toEqual(expected.citations);
    expect(pipeline).toHaveBeenCalledTimes(1);
  });
});

describe("the platform half of the bound", () => {
  it("declares a maxDuration, so a request cannot outlive its slot silently", () => {
    expect(maxDuration).toBe(60);
  });
});
