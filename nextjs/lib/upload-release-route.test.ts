import { beforeEach, describe, expect, it, vi } from "vitest";

const { authorize, settle, head } = vi.hoisted(() => ({
  authorize: vi.fn(),
  settle: vi.fn(),
  head: vi.fn(),
}));

vi.mock("@/lib/developer-auth", () => ({ authorizeFoundationRequest: authorize }));
vi.mock("@/lib/compute-reservation", () => ({ settleFoundationCompute: settle }));
vi.mock("@/lib/r2-synthetic-canary", () => ({
  readR2SignerEnv: () => ({ accountId: "account", bucket: "bucket", accessKeyId: "key", secretAccessKey: "secret" }),
  headFoundationQuarantineObject: head,
}));

import { POST } from "../app/api/uploads/release/route";

const documentId = "f07fe147-f52e-4fd0-8afc-79cd848b928d";

function request() {
  return new Request("https://tavonel.com/api/uploads/release", {
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
  settle.mockReset().mockResolvedValue({ ok: true, result: { status: "processed", reservationId: documentId } });
  head.mockReset().mockResolvedValue({ ok: true, exists: false });
});

describe("upload reservation release route", () => {
  it("releases reserved credits only after proving the source object is absent", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(settle).toHaveBeenCalledWith({
      workspaceKey: "pilot-969dc192daa24119",
      documentId,
      outcome: "released",
      actualCredits: 0,
      reasonCode: "UPLOAD_TRANSFER_FAILED",
    });
  });

  it("refuses release when the quarantine object already exists", async () => {
    head.mockResolvedValue({ ok: true, exists: true });
    const response = await POST(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ code: "UPLOAD_ALREADY_STORED" });
    expect(settle).not.toHaveBeenCalled();
  });
});
