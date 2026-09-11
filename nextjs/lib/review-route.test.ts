import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSession, loadWorld, recordDecision, listDecisions } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  loadWorld: vi.fn(),
  recordDecision: vi.fn(),
  listDecisions: vi.fn(),
}));

vi.mock("@/lib/developer-auth", () => ({ requireFoundationSession: requireSession }));
vi.mock("@/lib/world-read-model", () => ({ loadWorldReadModel: loadWorld }));
vi.mock("@/lib/review-store", () => ({
  recordFoundationReviewDecision: recordDecision,
  listFoundationReviewDecisions: listDecisions,
}));

import { GET, POST } from "../app/api/v1/reviews/route";
import { REVIEW_DECISION_READ_LIMIT } from "./review-queue";

const collectionId = `collection-${"a".repeat(32)}`;
const manifestDigest = `sha256:${"b".repeat(64)}`;
const evidence = {
  id: "evidence-1",
  sourceId: "source-1",
  sourceVersionId: "cd".repeat(32),
  page: 7,
  bbox: [100, 200, 800, 900] as [number, number, number, number],
};

function request(overrides: Record<string, unknown> = {}) {
  return new Request("https://tavonel.com/api/v1/reviews", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer session" },
    body: JSON.stringify({ collectionId, manifestDigest, evidenceId: evidence.id, action: "accept", reason: "Compared against the source region.", ...overrides }),
  });
}

beforeEach(() => {
  requireSession.mockReset().mockResolvedValue({ ok: true, principal: { workspaceKey: "pilot-review", userId: "969dc192-daa2-4119-a5d9-9a7621f171a1" } });
  loadWorld.mockReset().mockResolvedValue({ ok: true, model: { world: { manifestDigest }, evidence: [evidence] } });
  recordDecision.mockReset().mockResolvedValue({ ok: true, receipt: { decisionId: "f07fe147-f52e-4fd0-8afc-79cd848b928d", action: "accept", recordedAt: "2026-09-02T09:00:00Z" } });
  listDecisions.mockReset().mockResolvedValue({ ok: true, decisions: [] });
});

/*
  The listing half. `listFoundationReviewDecisions` orders newest-first and pages, so a caller
  that computes "time to first review" from a partial window would print a later decision as the
  first one. The route therefore asks for the whole window and reports whether it filled it.
*/
describe("the recorded decisions listing", () => {
  function listRequest(collection = collectionId) {
    return new Request(`https://tavonel.com/api/v1/reviews?collectionId=${encodeURIComponent(collection)}`, {
      headers: { authorization: "Bearer session" },
    });
  }

  it("asks for the whole window and says the read was not truncated", async () => {
    const response = await GET(listRequest());
    expect(response.status).toBe(200);
    expect(listDecisions).toHaveBeenCalledWith("pilot-review", collectionId, REVIEW_DECISION_READ_LIMIT);
    expect(await response.json()).toMatchObject({ code: "OK", decisions: [], truncated: false });
  });

  it("says the read was truncated when the window came back full", async () => {
    listDecisions.mockResolvedValue({
      ok: true,
      decisions: Array.from({ length: REVIEW_DECISION_READ_LIMIT }, (_unused, index) => ({
        evidenceId: `ev-${index}`, recordedAt: "2026-09-11T00:00:00.000Z",
      })),
    });
    const body = await (await GET(listRequest())).json() as { truncated: boolean };
    expect(body.truncated).toBe(true);
  });

  it("refuses an invalid collection id and a failed read instead of returning an empty list", async () => {
    expect((await GET(listRequest("not-a-collection"))).status).toBe(400);
    expect(listDecisions).not.toHaveBeenCalled();
    listDecisions.mockResolvedValue({ ok: false, code: "REVIEW_STORE_READ_FAILED" });
    const failed = await GET(listRequest());
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ code: "REVIEW_STORE_READ_FAILED" });
  });
});

describe("evidence review route", () => {
  it("re-derives source geometry from the persisted World before writing", async () => {
    const response = await POST(request({ sourceId: "forged", pageNumber: 999, bbox1000: [0, 0, 1, 1] }));
    expect(response.status).toBe(201);
    expect(recordDecision).toHaveBeenCalledWith(expect.objectContaining({
      workspaceKey: "pilot-review",
      evidenceId: evidence.id,
      sourceId: evidence.sourceId,
      sourceVersionId: evidence.sourceVersionId,
      pageNumber: 7,
      bbox1000: [100, 200, 800, 900],
    }));
  });

  it("rejects a stale World manifest before writing a decision", async () => {
    loadWorld.mockResolvedValue({ ok: true, model: { world: { manifestDigest: `sha256:${"c".repeat(64)}` }, evidence: [evidence] } });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it("rejects an evidence id absent from the persisted World", async () => {
    const response = await POST(request({ evidenceId: "evidence-missing" }));
    expect(response.status).toBe(404);
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it("bounds the actual streamed body when Content-Length is absent", async () => {
    const oversized = new Request("https://tavonel.com/api/v1/reviews", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer session" },
      body: JSON.stringify({ collectionId, manifestDigest, evidenceId: evidence.id, action: "reject", reason: "x".repeat(5_000) }),
    });
    const response = await POST(oversized);
    expect(response.status).toBe(413);
    expect(loadWorld).not.toHaveBeenCalled();
    expect(recordDecision).not.toHaveBeenCalled();
  });
});
