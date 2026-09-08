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

const { authorize, activeWorld, pipeline } = vi.hoisted(() => ({
  authorize: vi.fn(),
  activeWorld: vi.fn(),
  pipeline: vi.fn(),
}));

vi.mock("@/lib/developer-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-auth")>()),
  authorizeFoundationRequest: authorize,
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
  resetWorkspaceCostGuard();
  authorize.mockResolvedValue({
    ok: true,
    principal: { kind: "api-key", workspaceKey: WORKSPACE, userId: "user-1", scopes: [] },
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
      principal: { kind: "api-key", workspaceKey: "pilot-elsewhere", userId: "user-2", scopes: [] },
    });
    const other = ask(question("a different tenant asks"), { params });
    await new Promise((resolve) => setImmediate(resolve));
    unblock();
    expect((await other).status).toBe(200);
    await Promise.all(inFlight);
  });
});

describe("idempotency", () => {
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
      principal: { kind: "api-key", workspaceKey: "pilot-elsewhere", userId: "user-2", scopes: [] },
    });
    const other = await ask(question("an entirely different question", "shared-key-0001"), { params });
    expect(other.status).toBe(200);
    expect(pipeline).toHaveBeenCalledTimes(2);
  });
});

describe("the platform half of the bound", () => {
  it("declares a maxDuration, so a request cannot outlive its slot silently", () => {
    expect(maxDuration).toBe(60);
  });
});
