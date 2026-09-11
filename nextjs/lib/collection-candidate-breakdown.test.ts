import { beforeEach, expect, it, vi } from "vitest";
import { compileCollectionCandidate } from "./collection-compiler";

/*
  Audit U05: the workspace and the candidate API must name the same documents.

  The compiled artifact only knows what compiled. A document the compile refused for a safety
  reason, or never finished reading, exists only on the compile-job row -- so the route reads it
  and, when it cannot, says `compile_job` is missing rather than returning a breakdown whose
  zeros look like good news.
*/

const mocks = vi.hoisted(() => ({
  load: vi.fn(), access: vi.fn(), active: vi.fn(), jobs: vi.fn(), decisions: vi.fn(),
}));
vi.mock("./collection-storage", () => ({ loadPreferredCollectionCandidate: mocks.load }));
vi.mock("./connector-source-access", () => ({ checkConnectorSourceAccess: mocks.access }));
// Partial: world-read-model imports EMPTY_WORLD_FRESHNESS from here, and only the two reads need stubbing.
vi.mock("./world-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world-store")>()),
  getFoundationActiveWorld: mocks.active,
  listFoundationWorldVersions: vi.fn(),
}));
vi.mock("./r2-synthetic-canary", () => ({ readR2SignerEnv: () => ({ bucket: "fixture" }) }));
vi.mock("./developer-auth", () => ({ authorizeFoundationRequest: async () => ({ ok: true, principal: { workspaceKey: "pilot-acme01" } }) }));
vi.mock("./compile-job-store", () => ({ listWorkspaceCompileJobs: mocks.jobs }));
vi.mock("./review-store", () => ({ listFoundationReviewDecisions: mocks.decisions }));

import { GET as collectionGet } from "../app/api/collections/[id]/route";
import type { ReviewQueueBreakdown } from "./review-queue";

const TEXT = "Acme Corporation shall deliver the audit report within thirty days of the effective date.";
const compiled = compileCollectionCandidate([{
  documentId: "breakdown-read", versionKey: "a".repeat(64),
  sanitizedKey: "immutable/test/test/doc/version/sanitized.pdf", ocrJsonKey: "immutable/test/test/doc/version/ocr.json",
  pageCount: 1, inputSha256: `sha256:${"a".repeat(64)}`,
  sourceImmutableKey: "immutable/test/test/doc/version/sanitized.pdf", text: TEXT,
  regions: [{
    regionId: "native-p0001", pageIndex0: 0, pageNumber1: 1, order: 0, blockType: "paragraph",
    text: TEXT, bbox1000: [100, 100, 900, 200], confidence: 1, authority: "informal",
  }],
}]);
const artifact = {
  ...compiled,
  coreExecution: {
    // The validator holds lifecycle and core status together; derive it rather than pinning one.
    status: compiled.lifecycle === "review_required" ? "review_required" as const : "completed" as const,
    runtime: "tavonel-foundation-core-deterministic-v1",
    worldStateId: null,
    receipt: { requestId: "breakdown", outputSha256: compiled.manifestDigest, candidatePromotion: false as const },
  },
};

async function read() {
  const response = await collectionGet(
    new Request(`https://tavonel.test/api/collections/${compiled.collectionId}`),
    { params: Promise.resolve({ id: compiled.collectionId }) },
  );
  return { response, body: await response.json() as { documentBreakdown: ReviewQueueBreakdown } };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.load.mockResolvedValue({ ok: true, value: { artifact, key: "fixture-key" } });
  mocks.active.mockResolvedValue({ ok: false, code: "ACTIVE_WORLD_NOT_FOUND" });
  mocks.access.mockResolvedValue({ ok: true });
  mocks.decisions.mockResolvedValue({ ok: true, decisions: [] });
  mocks.jobs.mockResolvedValue({ ok: true, value: [] });
});

it("names the excluded and unread documents the artifact cannot carry", async () => {
  mocks.jobs.mockResolvedValue({ ok: true, value: [{
    collectionId: compiled.collectionId,
    documentIds: ["breakdown-read", "breakdown-blocked", "breakdown-unread"],
    blocked: [{ documentId: "breakdown-blocked", kind: "security", reason: "ARCHIVE_ENCRYPTED" }],
    settledAt: "2026-09-11T00:00:00.000Z",
  }] });
  const { response, body } = await read();
  expect(response.status).toBe(200);
  expect(body.documentBreakdown.total).toBe(3);
  expect(body.documentBreakdown.counts).toEqual({ excluded: 1, under_review: 0, unprocessed: 1, read: 1 });
  expect(body.documentBreakdown.rows[0]).toMatchObject({
    documentId: "breakdown-blocked", status: "excluded", securityBlocked: true, reasons: ["ARCHIVE_ENCRYPTED"],
  });
  expect(body.documentBreakdown.missing).toEqual([]);
});

it("measures time to first review from the same timestamps the workspace uses", async () => {
  mocks.jobs.mockResolvedValue({ ok: true, value: [{
    collectionId: compiled.collectionId, documentIds: ["breakdown-read"], blocked: [],
    settledAt: "2026-09-11T00:00:00.000Z",
  }] });
  const chunk = JSON.parse(
    compiled.package.files.find((file) => file.path === "rag/chunks.jsonl")!.content.split("\n").filter(Boolean)[0],
  ) as { evidenceId: string; chunkId: string };
  mocks.decisions.mockResolvedValue({ ok: true, decisions: [{
    evidenceId: `${chunk.evidenceId}:${chunk.chunkId}`,
    recordedAt: "2026-09-11T00:20:00.000Z",
  }] });
  const { body } = await read();
  expect(body.documentBreakdown.rows[0].timeToFirstReviewMs).toBe(20 * 60_000);
});

it("says the compile-job row is missing rather than reporting zero excluded documents", async () => {
  mocks.jobs.mockResolvedValue({ ok: false, code: "COMPILE_JOB_STORE_NOT_CONFIGURED" });
  const { response, body } = await read();
  expect(response.status).toBe(200);
  expect(body.documentBreakdown.missing).toEqual(["compile_job", "compile_settled_at"]);
  expect(body.documentBreakdown.rows.map((row) => row.documentId)).toEqual(["breakdown-read"]);
});

it("still returns the breakdown when the decision ledger cannot be read, with no review time", async () => {
  mocks.jobs.mockResolvedValue({ ok: true, value: [{
    collectionId: compiled.collectionId, documentIds: ["breakdown-read"], blocked: [],
    settledAt: "2026-09-11T00:00:00.000Z",
  }] });
  mocks.decisions.mockResolvedValue({ ok: false, code: "REVIEW_STORE_READ_FAILED" });
  const { body } = await read();
  expect(body.documentBreakdown.rows[0]).toMatchObject({ firstReviewAt: null, timeToFirstReviewMs: null });
});

it("does not attach a breakdown to a denied read", async () => {
  mocks.access.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
  const { response, body } = await read();
  expect(response.status).toBe(403);
  expect(body).toEqual({ code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
});
