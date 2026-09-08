/**
 * Confirmation is where "it uploaded" becomes "it is the object we admitted".
 *
 * The old route proved existence and nothing else: a HEAD was issued and its body discarded, so a
 * truncated or substituted transfer that returned 200 confirmed exactly like a good one. And to
 * fingerprint a free-evaluation source it downloaded the customer's bytes back onto the
 * application server through a 5 MiB-capped helper -- which failed every trial upload above that
 * cap with a 503 the workspace displayed as "needs review".
 *
 * Both are asserted against here: the observed size and type reach the RPC that confirms
 * atomically, the browser's digest is recorded rather than recomputed, and no source is read.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { authorize, authorizeSession, head, headSignature, assessSource, adminConfig, adminRequest } =
  vi.hoisted(() => ({
    authorize: vi.fn(),
    authorizeSession: vi.fn(),
    head: vi.fn(),
    headSignature: vi.fn(),
    assessSource: vi.fn(),
    adminConfig: vi.fn(),
    adminRequest: vi.fn(),
  }));

vi.mock("@/lib/developer-auth", () => ({ authorizeFoundationRequest: authorize }));
vi.mock("@/lib/self-service-trial", () => ({ authorizeFoundationSessionProduct: authorizeSession }));
vi.mock("@/lib/trial-source-risk", () => ({ assessTrialSourceReuse: assessSource }));
vi.mock("@/lib/supabase-admin", () => ({
  readSupabaseAdminConfig: adminConfig,
  supabaseAdminRequest: adminRequest,
}));
vi.mock("@/lib/r2-synthetic-canary", () => ({
  readR2SignerEnv: () => ({ accountId: "account", bucket: "bucket", accessKeyId: "key", secretAccessKey: "secret" }),
  headFoundationQuarantineObject: head,
  headFoundationQuarantineSignature: headSignature,
}));

/** The first bytes of a real file of each kind, as the ranged read would return them. */
const LEADING = {
  pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]),
  zip: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]),
  png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  gif: new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0x00]),
  html: new Uint8Array([0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54, 0x59, 0x50]),
  empty: new Uint8Array([]),
};

import { POST } from "../app/api/uploads/confirm/route";


const documentId = "f07fe147-f52e-4fd0-8afc-79cd848b928d";
const workspaceKey = "pilot-969dc192daa24119";
const userId = "969dc192-daa2-4119-a5d9-9a7621f171a1";
const sourceSha256 = `sha256:${"a".repeat(64)}`;

function request(body: Record<string, unknown> = { documentId, sourceSha256 }) {
  return new Request("https://tavonel.com/api/uploads/confirm", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer session" },
    body: JSON.stringify(body),
  });
}

function rpcBody() {
  const call = adminRequest.mock.calls.at(-1) as [unknown, string, RequestInit] | undefined;
  return call ? JSON.parse(String(call[2].body)) as Record<string, unknown> : null;
}

function rpcFails(message: string) {
  adminRequest.mockResolvedValue(new Response(JSON.stringify({ message }), {
    status: 400,
    headers: { "content-type": "application/json" },
  }));
}

function trial() {
  authorizeSession.mockResolvedValue({
    ok: true,
    access: { source: "trial", accessPlan: "observer_access", billingExempt: true, expiresAt: "2026-09-08T00:00:00Z" },
  });
}

beforeEach(() => {
  authorize.mockReset().mockResolvedValue({ ok: true, principal: { workspaceKey, userId } });
  authorizeSession.mockReset().mockResolvedValue({
    ok: true,
    access: { source: "paid", accessPlan: "observer_access", billingExempt: false, expiresAt: null },
  });
  head.mockReset().mockResolvedValue({
    ok: true, exists: true, key: "k", sizeBytes: 4096, contentType: "application/pdf", etag: "etag",
  });
  headSignature.mockReset().mockResolvedValue({ ok: true, exists: true, bytes: LEADING.pdf });
  assessSource.mockReset().mockResolvedValue({ ok: true, status: "allow" });
  adminConfig.mockReset().mockReturnValue({ url: "https://project.supabase.co", serviceRoleKey: "sb_secret_x" });
  adminRequest.mockReset().mockResolvedValue(new Response(JSON.stringify({
    status: "confirmed",
    documentId,
    confirmedAt: "2026-09-01T12:00:00.000Z",
    requestedBytes: 4096,
    declaredMimeType: "application/pdf",
    sourceSha256,
  }), { status: 200, headers: { "content-type": "application/json" } }));
});

describe("upload confirmation route", () => {
  it("hands the stored object's own size and type to the check that confirms it", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(adminRequest).toHaveBeenCalledTimes(1);
    const [, path] = adminRequest.mock.calls[0] as [unknown, string, RequestInit];
    expect(path).toBe("/rest/v1/rpc/confirm_foundation_intake_admission");
    expect(rpcBody()).toEqual({
      p_workspace_key: workspaceKey,
      p_document_id: documentId,
      p_user_id: userId,
      p_source_sha256: sourceSha256,
      p_observed_bytes: 4096,
      p_observed_mime: "application/pdf",
    });
    expect(assessSource).not.toHaveBeenCalled();
  });

  it("records the digest the browser reported instead of reading the source back", async () => {
    trial();
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(assessSource).toHaveBeenCalledWith({ workspaceKey, userId, documentId, sourceSha256 });
    expect(rpcBody()?.p_source_sha256).toBe(sourceSha256);
  });

  it("refuses a free-evaluation upload that carries no digest rather than skipping the gate", async () => {
    trial();
    const response = await POST(request({ documentId }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ code: "SOURCE_DIGEST_REQUIRED" });
    expect(assessSource).not.toHaveBeenCalled();
    expect(adminRequest).not.toHaveBeenCalled();
  });

  it("confirms a paid source with no digest at all, recorded as absent", async () => {
    const response = await POST(request({ documentId }));
    expect(response.status).toBe(200);
    expect(rpcBody()?.p_source_sha256).toBeNull();
  });

  it("rejects a malformed digest instead of dropping it", async () => {
    const response = await POST(request({ documentId, sourceSha256: "sha256:nope" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ code: "INVALID_SOURCE_DIGEST" });
    expect(adminRequest).not.toHaveBeenCalled();
  });

  it("reports a size disagreement as a conflict, not as a confirmation", async () => {
    rpcFails("foundation_intake_content_length_mismatch");
    const response = await POST(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ code: "CONTENT_LENGTH_MISMATCH" });
  });

  it("reports a second, different digest under one capability as a conflict", async () => {
    rpcFails("foundation_intake_source_digest_conflict");
    const response = await POST(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ code: "SOURCE_DIGEST_CONFLICT" });
  });

  it("stops a cross-account repeated trial source before confirmation and expensive processing", async () => {
    trial();
    assessSource.mockResolvedValue({ ok: false, code: "TRIAL_SOURCE_REVIEW_REQUIRED" });
    const response = await POST(request());
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ code: "TRIAL_SOURCE_REVIEW_REQUIRED" });
    expect(adminRequest).not.toHaveBeenCalled();
  });

  it("refuses confirmation when the quarantine object is absent", async () => {
    head.mockResolvedValue({ ok: true, exists: false, key: "k", sizeBytes: null, contentType: null, etag: null });
    const response = await POST(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ code: "QUARANTINE_OBJECT_NOT_FOUND" });
    expect(adminRequest).not.toHaveBeenCalled();
  });

  it("refuses a confirmation receipt that does not describe this document", async () => {
    adminRequest.mockResolvedValue(new Response(JSON.stringify({
      status: "confirmed",
      documentId: "00000000-0000-4000-8000-000000000000",
      confirmedAt: "2026-09-01T12:00:00.000Z",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const response = await POST(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "INTAKE_CONFIRMATION_RECEIPT_INVALID" });
  });
});

/*
  Blueprint 2026-09-08 §36, S-66: the bytes, against the claim.

  `contentType` on the stored object is not a second opinion -- the presigned PUT was signed for
  the type the browser declared, so R2 is repeating the client back to itself. These drive the
  case that mattered and never had a test: a file admitted, charged for and handed to the
  sanitizer as a PDF, which is not one.
*/
describe("magic-byte validation at confirmation", () => {
  function stored(contentType: string) {
    head.mockResolvedValue({ ok: true, exists: true, key: "k", sizeBytes: 4096, contentType, etag: "etag" });
  }

  it("confirms a file whose leading bytes are the type it was admitted as", async () => {
    stored("application/pdf");
    headSignature.mockResolvedValue({ ok: true, exists: true, bytes: LEADING.pdf });
    expect((await POST(request())).status).toBe(200);
  });

  it("refuses an archive wearing a .pdf content type", async () => {
    stored("application/pdf");
    headSignature.mockResolvedValue({ ok: true, exists: true, bytes: LEADING.zip });
    const response = await POST(request());
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ code: "SOURCE_SIGNATURE_MISMATCH" });
    // Refused before the confirmation, not after it: nothing was marked confirmed.
    expect(adminRequest).not.toHaveBeenCalled();
  });

  it("refuses an HTML page admitted as a PDF", async () => {
    stored("application/pdf");
    headSignature.mockResolvedValue({ ok: true, exists: true, bytes: LEADING.html });
    const response = await POST(request());
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ code: "SOURCE_SIGNATURE_UNRECOGNISED" });
  });

  it("refuses an empty or truncated transfer that has no signature at all", async () => {
    stored("application/pdf");
    headSignature.mockResolvedValue({ ok: true, exists: true, bytes: LEADING.empty });
    expect((await POST(request())).status).toBe(415);
  });

  it("refuses a polyglot whose PDF header is not the first thing in the file", async () => {
    // A GIF/PDF polyglot: a valid GIF, with %PDF- further down where a lenient reader finds it.
    // Refusing it is the reason the check is anchored at offset zero rather than scanning.
    stored("application/pdf");
    const polyglot = new Uint8Array(64);
    polyglot.set(LEADING.gif, 0);
    polyglot.set([0x25, 0x50, 0x44, 0x46, 0x2d], 24);
    headSignature.mockResolvedValue({ ok: true, exists: true, bytes: polyglot });
    const response = await POST(request());
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ code: "SOURCE_SIGNATURE_MISMATCH" });
  });

  it("accepts an OOXML document, which is a ZIP and is supposed to be", async () => {
    stored("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    headSignature.mockResolvedValue({ ok: true, exists: true, bytes: LEADING.zip });
    expect((await POST(request())).status).toBe(200);
  });

  it("refuses a PNG admitted as a JPEG, so one image type cannot stand in for another", async () => {
    stored("image/jpeg");
    headSignature.mockResolvedValue({ ok: true, exists: true, bytes: LEADING.png });
    expect((await POST(request())).status).toBe(415);
  });

  it("fails closed when the prefix cannot be read, rather than confirming unchecked", async () => {
    stored("application/pdf");
    headSignature.mockResolvedValue({ ok: false, code: "SIGNATURE_READ_FAILED", status: 500 });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "SIGNATURE_READ_FAILED" });
    expect(adminRequest).not.toHaveBeenCalled();
  });

  it("refuses a content type outside the intake whitelist even if the bytes are a real format", async () => {
    stored("application/x-msdownload");
    headSignature.mockResolvedValue({ ok: true, exists: true, bytes: LEADING.zip });
    const response = await POST(request());
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ code: "SOURCE_MIME_UNQUALIFIED" });
  });

  it("treats an object that vanished between the two reads as absent, not as unchecked", async () => {
    stored("application/pdf");
    headSignature.mockResolvedValue({ ok: true, exists: false });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "QUARANTINE_OBJECT_NOT_FOUND" });
  });
});
