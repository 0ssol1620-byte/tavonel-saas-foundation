import { beforeEach, describe, expect, it, vi } from "vitest";

const { authorize, confirm, head } = vi.hoisted(() => ({
  authorize: vi.fn(),
  confirm: vi.fn(),
  head: vi.fn(),
}));

vi.mock("@/lib/developer-auth", () => ({ authorizeFoundationRequest: authorize }));
vi.mock("@/lib/intake-admission", () => ({ confirmFoundationIntake: confirm }));
vi.mock("@/lib/r2-synthetic-canary", () => ({
  readR2SignerEnv: () => ({ accountId: "account", bucket: "bucket", accessKeyId: "key", secretAccessKey: "secret" }),
  headFoundationQuarantineObject: head,
}));

import { POST } from "../app/api/uploads/confirm/route";

const documentId = "f07fe147-f52e-4fd0-8afc-79cd848b928d";

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
    principal: { workspaceKey: "pilot-969dc192daa24119", userId: "969dc192-daa2-4119-a5d9-9a7621f171a1" },
  });
  confirm.mockReset().mockResolvedValue({
    ok: true,
    result: { status: "confirmed", documentId, confirmedAt: "2026-09-01T12:00:00.000Z" },
  });
  head.mockReset().mockResolvedValue({ ok: true, exists: true });
});

describe("upload confirmation route", () => {
  it("confirms the tenant-bound receipt only after proving the source object exists", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(confirm).toHaveBeenCalledWith({
      workspaceKey: "pilot-969dc192daa24119",
      documentId,
      userId: "969dc192-daa2-4119-a5d9-9a7621f171a1",
    });
  });

  it("refuses confirmation when the quarantine object is absent", async () => {
    head.mockResolvedValue({ ok: true, exists: false });
    const response = await POST(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ code: "QUARANTINE_OBJECT_NOT_FOUND" });
    expect(confirm).not.toHaveBeenCalled();
  });
});
