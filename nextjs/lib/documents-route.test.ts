/**
 * A refused source has to still be there after a reload.
 *
 * `/api/documents` lists objects under `immutable/`, and a source the CDR refused never gets one
 * -- that is what refused means. So the row simply disappeared: the customer had no error to act
 * on and support had nothing to look at, while the board showed PREPARE running forever.
 *
 * The listing now joins `cdr-reject.json` from beside the quarantine source. The assertions that
 * matter are that a refusal appears at all, that it never masks a document which does have
 * immutable objects, and that a receipt failing validation yields nothing rather than a
 * half-populated row -- a made-up refusal would be worse than the silence it replaces.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { authorize, reauthorize, signerEnv, listImmutable, reviewJson, listRejects, getReject, sourceAccess, tombstoned } = vi.hoisted(() => ({
  tombstoned: vi.fn(),
  authorize: vi.fn(),
  reauthorize: vi.fn(),
  signerEnv: vi.fn(),
  listImmutable: vi.fn(),
  reviewJson: vi.fn(),
  listRejects: vi.fn(),
  getReject: vi.fn(),
  sourceAccess: vi.fn(),
}));

vi.mock("@/lib/developer-auth", () => ({
  authorizeFoundationRequest: authorize,
  revalidateFoundationAuthorization: reauthorize,
}));
vi.mock("@/lib/r2-objects", () => ({
  listImmutableWorkspaceObjects: listImmutable,
  getWorkspaceOcrReviewJson: reviewJson,
}));
vi.mock("@/lib/r2-synthetic-canary", () => ({
  readR2SignerEnv: signerEnv,
  listFoundationQuarantineRejects: listRejects,
  getFoundationQuarantineReject: getReject,
}));
vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccess: sourceAccess, checkConnectorSourceAccessForViewer: sourceAccess }));
vi.mock("@/lib/customer-source-lifecycle", () => ({ readTombstonedUploadDocumentIds: tombstoned }));

import { GET } from "../app/api/documents/route";

const workspaceKey = "pilot-969dc192daa24119";
const refusedId = "969dc192-daa2-4119-a5d9-9a7621f171a1";
const readId = "5f0f2b64-1111-4111-8111-111111111111";

const receipt = {
  schemaVersion: "tavonel.cdr_reject_receipt.v1" as const,
  sourceKey: `quarantine/${workspaceKey}/${refusedId}/source`,
  observedBytes: 31_457_280,
  declaredBytes: 31_457_280,
  reasonCode: "PARSER_OOM",
  provider: "cdr_sanitizer_v1",
  occurredAt: "2026-09-06T09:00:00.000Z",
};

/** One document that was read all the way through, so the refusal never stands alone. */
function immutableObjectsFor(documentId: string) {
  const version = `${documentId}/${"a".repeat(64)}`;
  return [
    { key: `immutable/${workspaceKey}/${workspaceKey}/${version}/sanitized.pdf`, size: 2048 },
    { key: `immutable/${workspaceKey}/${workspaceKey}/${version}/ocr.json`, size: 512 },
  ];
}

async function documents() {
  const response = await GET(new Request("https://tavonel-saas-foundation.vercel.app/api/documents", {
    headers: { authorization: "Bearer token" },
  }));
  const body = await response.json() as {
    code: string;
    documents: Array<Record<string, unknown>>;
    partial?: { documentIds: string[]; truncated: boolean };
  };
  return { status: response.status, ...body };
}

/** A document whose OCR stopped and asked for a person: sanitized, with a review receipt. */
function reviewObjectsFor(documentId: string) {
  const version = `${documentId}/${"c".repeat(64)}`;
  return [
    { key: `immutable/${workspaceKey}/${workspaceKey}/${version}/sanitized.pdf`, size: 2048 },
    { key: `immutable/${workspaceKey}/${workspaceKey}/${version}/ocr-review.json`, size: 256 },
  ];
}

beforeEach(() => {
  authorize.mockReset().mockResolvedValue({ ok: true, principal: { workspaceKey, userId: "viewer-user" } });
  reauthorize.mockReset().mockResolvedValue({ ok: true, principal: { workspaceKey, userId: "viewer-user" } });
  signerEnv.mockReset().mockReturnValue({
    accountId: "account",
    accessKeyId: "key",
    secretAccessKey: "secret",
    bucket: "tavonel-saas-foundation-quarantine",
  });
  listImmutable.mockReset().mockResolvedValue({ ok: true, objects: immutableObjectsFor(readId) });
  reviewJson.mockReset().mockResolvedValue({ ok: false, code: "NOT_FOUND" });
  listRejects.mockReset().mockResolvedValue({ ok: true, documentIds: [refusedId], storedDocumentIds: [], truncated: false });
  getReject.mockReset().mockResolvedValue({ ok: true, receipt });
  sourceAccess.mockReset().mockResolvedValue({ ok: true });
  tombstoned.mockReset().mockResolvedValue({ ok: true, ids: new Set() });
});

describe("the documents listing", () => {
  it("lists a source the CDR refused, which has no immutable object to be found by", async () => {
    const body = await documents();
    expect(body.status).toBe(200);
    const refused = body.documents.find((item) => item.documentId === refusedId);
    expect(refused).toMatchObject({
      processingState: "refused",
      refusal: { reasonCode: "PARSER_OOM", observedBytes: 31_457_280, occurredAt: receipt.occurredAt },
    });
    // No sanitized version exists, and the listing says so rather than inventing a key.
    expect(refused).toMatchObject({ sanitizedKey: null, ocrJsonKey: null, hasOcrJson: false });
  });

  it("still lists the documents that were read, alongside the refusal", async () => {
    const body = await documents();
    expect(body.documents.map((item) => item.documentId)).toEqual([readId, refusedId]);
  });

  it("does not let a stale refusal mask a document that has immutable objects", async () => {
    listRejects.mockResolvedValue({ ok: true, documentIds: [readId], storedDocumentIds: [], truncated: false });
    const body = await documents();
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0]).toMatchObject({ documentId: readId, processingState: "ocr_ready" });
    expect(getReject).not.toHaveBeenCalled();
  });

  it("returns one held row instead of two unordered versions of one document", async () => {
    const second = "b".repeat(64);
    listRejects.mockResolvedValue({ ok: true, documentIds: [readId], storedDocumentIds: [], truncated: false });
    listImmutable.mockResolvedValue({ ok: true, objects: [
      ...immutableObjectsFor(readId),
      { key: `immutable/${workspaceKey}/${workspaceKey}/${readId}/${second}/sanitized.pdf`, size: 2048 },
      { key: `immutable/${workspaceKey}/${workspaceKey}/${readId}/${second}/ocr.json`, size: 512 },
    ] });
    const body = await documents();
    expect(body.documents.filter((item) => item.documentId === readId)).toEqual([
      expect.objectContaining({
        versionKey: "",
        hasOcrJson: false,
        processingState: "operator_review",
        ocrReviewReasonCode: "SOURCE_VERSION_AMBIGUOUS",
      }),
    ]);
    expect(getReject).not.toHaveBeenCalled();
  });

  it("returns no document metadata after connector access is revoked", async () => {
    sourceAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    const body = await documents();
    expect(body.status).toBe(403);
    expect(getReject).not.toHaveBeenCalled();
  });

  it("revalidates access for a refusal loaded after the first check", async () => {
    sourceAccess.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({
      ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED",
    });
    const body = await documents();
    expect(body.status).toBe(403);
    expect(getReject).toHaveBeenCalledOnce();
    expect(sourceAccess).toHaveBeenLastCalledWith(workspaceKey, [readId, refusedId], "viewer-user");
  });

  it("returns no metadata if API authorization changes while documents load", async () => {
    reauthorize.mockResolvedValue({ ok: false, code: "API_KEY_REVOKED", status: 401 });
    const body = await documents();
    expect(body.status).toBe(401);
    expect(reauthorize).toHaveBeenCalledOnce();
  });

  it("shows nothing at all rather than a refusal it could not validate", async () => {
    getReject.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
    const body = await documents();
    expect(body.documents.map((item) => item.documentId)).toEqual([readId]);
  });

  /*
    G2. This test used to assert a 200 with the refusals silently missing -- the exact silent
    failure the gap names: a broken quarantine listing read as a workspace with nothing refused
    and nothing in preparation. It now fails closed with a catalogued code, like the immutable
    listing above it already did.
  */
  it("fails closed with a catalogued code when the refusal prefix cannot be read", async () => {
    listRejects.mockResolvedValue({ ok: false, code: "LIST_FAILED" });
    const body = await documents();
    expect(body.status).toBe(503);
    expect(body.code).toBe("QUARANTINE_LIST_UNAVAILABLE");
    expect(body.documents).toBeUndefined();
  });

  it("reports a refusal it could not read by id, access-checked, instead of letting it vanish", async () => {
    getReject.mockResolvedValue({ ok: false, code: "READ_FAILED" });
    const body = await documents();
    expect(body.status).toBe(200);
    expect(body.documents.map((item) => item.documentId)).toEqual([readId]);
    expect(body.partial).toEqual({ documentIds: [refusedId], truncated: false });
    expect(sourceAccess).toHaveBeenLastCalledWith(workspaceKey, [readId, refusedId], "viewer-user");
  });

  it("returns no partial ids once access to them is revoked", async () => {
    getReject.mockResolvedValue({ ok: false, code: "READ_FAILED" });
    sourceAccess.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({
      ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED",
    });
    const body = await documents();
    expect(body.status).toBe(403);
    expect(body.partial).toBeUndefined();
  });

  it.each([
    ["could not be read", { ok: false, code: "GET_FAILED" }],
    ["did not validate", { ok: true, json: { schemaVersion: "tavonel.ocr_review_receipt.v1" } }],
  ])("keeps a held document whose review receipt %s, without a reason, and says so", async (_, loaded) => {
    const heldId = "7a7a7a7a-2222-4222-8222-222222222222";
    listImmutable.mockResolvedValue({ ok: true, objects: [...immutableObjectsFor(readId), ...reviewObjectsFor(heldId)] });
    reviewJson.mockResolvedValue(loaded);
    const body = await documents();
    expect(body.status).toBe(200);
    const held = body.documents.find((item) => item.documentId === heldId);
    expect(held).toMatchObject({ processingState: "operator_review" });
    expect(held).not.toHaveProperty("ocrReviewReasonCode");
    expect(body.partial).toEqual({ documentIds: [heldId], truncated: false });
  });

  it("carries no partial marker when every receipt loaded", async () => {
    const body = await documents();
    expect(body).not.toHaveProperty("partial");
  });

  it("says the listing is incomplete when the quarantine listing was truncated", async () => {
    listRejects.mockResolvedValue({ ok: true, documentIds: [refusedId], storedDocumentIds: [], truncated: true });
    const body = await documents();
    expect(body.status).toBe(200);
    expect(body.partial).toEqual({ documentIds: [], truncated: true });
  });

  it("lists a stored source with nothing after it, instead of dropping it until preparation ends", async () => {
    const storedId = "8b8b8b8b-3333-4333-8333-333333333333";
    const deletedId = "9c9c9c9c-4444-4444-8444-444444444444";
    tombstoned.mockResolvedValue({ ok: true, ids: new Set([deletedId]) });
    listRejects.mockResolvedValue({
      ok: true, documentIds: [refusedId], storedDocumentIds: [readId, storedId, deletedId], truncated: false,
    });
    const body = await documents();
    expect(body.status).toBe(200);
    // The prepared document is not listed twice, and the deleted one stays out.
    expect(body.documents.map((item) => item.documentId)).toEqual([readId, refusedId, storedId]);
    expect(body.documents[2]).toMatchObject({
      processingState: "stored", versionKey: "", sanitizedKey: null, hasOcrJson: false,
    });
    expect(sourceAccess).toHaveBeenLastCalledWith(workspaceKey, [readId, refusedId, storedId], "viewer-user");
  });

  it("leaves a deleted upload out instead of denying the whole listing while its bytes await purge", async () => {
    tombstoned.mockResolvedValue({ ok: true, ids: new Set([readId, refusedId]) });
    const body = await documents();
    expect(body.status).toBe(200);
    expect(body.documents).toEqual([]);
    expect(getReject).not.toHaveBeenCalled();
    expect(sourceAccess.mock.calls.every(([, ids]) => ids.length === 0)).toBe(true);
    expect(tombstoned).toHaveBeenCalledWith(workspaceKey);
  });

  it("fails closed when it cannot tell which uploads were deleted", async () => {
    tombstoned.mockResolvedValue({ ok: false, code: "CUSTOMER_SOURCE_DELETE_STORE_FAILED" });
    const body = await documents();
    expect(body.status).toBe(503);
    expect(sourceAccess).not.toHaveBeenCalled();
  });

  it("never reads a refusal for a workspace the caller did not authenticate as", async () => {
    await documents();
    expect(listRejects.mock.calls[0][1]).toBe(workspaceKey);
    expect(getReject.mock.calls[0][1]).toBe(workspaceKey);
  });
});
