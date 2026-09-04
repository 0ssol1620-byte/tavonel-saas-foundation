import { beforeEach, describe, expect, it, vi } from "vitest";

const { authorize, authorizeSession, confirm, head, readSource, assessSource } = vi.hoisted(() => ({
  authorize: vi.fn(),
  authorizeSession: vi.fn(),
  confirm: vi.fn(),
  head: vi.fn(),
  readSource: vi.fn(),
  assessSource: vi.fn(),
}));

vi.mock("@/lib/developer-auth", () => ({ authorizeFoundationRequest: authorize }));
vi.mock("@/lib/self-service-trial", () => ({ authorizeFoundationSessionProduct: authorizeSession }));
vi.mock("@/lib/intake-admission", () => ({ confirmFoundationIntake: confirm }));
vi.mock("@/lib/trial-source-risk", () => ({ assessTrialSourceReuse: assessSource }));
vi.mock("@/lib/r2-synthetic-canary", () => ({
  readR2SignerEnv: () => ({ accountId: "account", bucket: "bucket", accessKeyId: "key", secretAccessKey: "secret" }),
  headFoundationQuarantineObject: head,
  readFoundationQuarantineObject: readSource,
}));

import { POST } from "../app/api/uploads/confirm/route";

const documentId = "f07fe147-f52e-4fd0-8afc-79cd848b928d";
const workspaceKey = "pilot-969dc192daa24119";
const userId = "969dc192-daa2-4119-a5d9-9a7621f171a1";

function request() {
  return new Request("https://tavonel.com/api/uploads/confirm", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer session" },
    body: JSON.stringify({ documentId }),
  });
}

beforeEach(() => {
  authorize.mockReset().mockResolvedValue({
    ok: true,
    principal: { workspaceKey, userId },
  });
  authorizeSession.mockReset().mockResolvedValue({
    ok: true,
    access: { source: "paid", accessPlan: "observer_access", billingExempt: false, expiresAt: null },
  });
  confirm.mockReset().mockResolvedValue({
    ok: true,
    result: { status: "confirmed", documentId, confirmedAt: "2026-09-01T12:00:00.000Z" },
  });
  head.mockReset().mockResolvedValue({ ok: true, exists: true });
  readSource.mockReset().mockResolvedValue({ ok: true, bytes: Buffer.from("source") });
  assessSource.mockReset().mockResolvedValue({ ok: true, status: "allow" });
});

describe("upload confirmation route", () => {
  it("confirms a paid tenant-bound receipt only after proving the source object exists", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(confirm).toHaveBeenCalledWith({ workspaceKey, documentId, userId });
    expect(readSource).not.toHaveBeenCalled();
    expect(assessSource).not.toHaveBeenCalled();
  });

  it("reads and assesses a free-evaluation source before handing it to processing", async () => {
    authorizeSession.mockResolvedValue({
      ok: true,
      access: { source: "trial", accessPlan: "observer_access", billingExempt: true, expiresAt: "2026-09-08T00:00:00Z" },
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(readSource).toHaveBeenCalledWith(expect.any(Object), workspaceKey, documentId);
    expect(assessSource).toHaveBeenCalledWith({
      workspaceKey,
      userId,
      documentId,
      bytes: Buffer.from("source"),
    });
    expect(confirm).toHaveBeenCalled();
  });

  it("stops a cross-account repeated trial source before confirmation and expensive processing", async () => {
    authorizeSession.mockResolvedValue({
      ok: true,
      access: { source: "trial", accessPlan: "observer_access", billingExempt: true, expiresAt: "2026-09-08T00:00:00Z" },
    });
    assessSource.mockResolvedValue({ ok: false, code: "TRIAL_SOURCE_REVIEW_REQUIRED" });
    const response = await POST(request());
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ code: "TRIAL_SOURCE_REVIEW_REQUIRED" });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("refuses confirmation when the quarantine object is absent", async () => {
    head.mockResolvedValue({ ok: true, exists: false });
    const response = await POST(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ code: "QUARANTINE_OBJECT_NOT_FOUND" });
    expect(confirm).not.toHaveBeenCalled();
  });
});
