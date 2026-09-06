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

const { authorize, signerEnv, listImmutable, reviewJson, listRejects, getReject } = vi.hoisted(() => ({
  authorize: vi.fn(),
  signerEnv: vi.fn(),
  listImmutable: vi.fn(),
  reviewJson: vi.fn(),
  listRejects: vi.fn(),
  getReject: vi.fn(),
}));

vi.mock("@/lib/developer-auth", () => ({ authorizeFoundationRequest: authorize }));
vi.mock("@/lib/r2-objects", () => ({
  listImmutableWorkspaceObjects: listImmutable,
  getWorkspaceOcrReviewJson: reviewJson,
}));
vi.mock("@/lib/r2-synthetic-canary", () => ({
  readR2SignerEnv: signerEnv,
  listFoundationQuarantineRejects: listRejects,
  getFoundationQuarantineReject: getReject,
}));

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
  const body = await response.json() as { code: string; documents: Array<Record<string, unknown>> };
  return { status: response.status, ...body };
}

beforeEach(() => {
  authorize.mockReset().mockResolvedValue({ ok: true, principal: { workspaceKey } });
  signerEnv.mockReset().mockReturnValue({
    accountId: "account",
    accessKeyId: "key",
    secretAccessKey: "secret",
    bucket: "tavonel-saas-foundation-quarantine",
  });
  listImmutable.mockReset().mockResolvedValue({ ok: true, objects: immutableObjectsFor(readId) });
  reviewJson.mockReset().mockResolvedValue({ ok: false, code: "NOT_FOUND" });
  listRejects.mockReset().mockResolvedValue({ ok: true, documentIds: [refusedId], truncated: false });
  getReject.mockReset().mockResolvedValue({ ok: true, receipt });
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
    listRejects.mockResolvedValue({ ok: true, documentIds: [readId], truncated: false });
    const body = await documents();
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0]).toMatchObject({ documentId: readId, processingState: "ocr_ready" });
    expect(getReject).not.toHaveBeenCalled();
  });

  it("shows nothing at all rather than a refusal it could not validate", async () => {
    getReject.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
    const body = await documents();
    expect(body.documents.map((item) => item.documentId)).toEqual([readId]);
  });

  it("keeps the listing working when the refusal prefix cannot be read", async () => {
    listRejects.mockResolvedValue({ ok: false, code: "LIST_FAILED" });
    const body = await documents();
    expect(body.status).toBe(200);
    expect(body.documents.map((item) => item.documentId)).toEqual([readId]);
  });

  it("never reads a refusal for a workspace the caller did not authenticate as", async () => {
    await documents();
    expect(listRejects.mock.calls[0][1]).toBe(workspaceKey);
    expect(getReject.mock.calls[0][1]).toBe(workspaceKey);
  });
});
