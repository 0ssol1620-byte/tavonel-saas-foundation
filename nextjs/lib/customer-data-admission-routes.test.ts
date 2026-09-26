import { beforeEach, describe, expect, it, vi } from "vitest";

const { authorize, session, gate, signer, enqueue } = vi.hoisted(() => ({
  authorize: vi.fn(),
  session: vi.fn(),
  gate: vi.fn(),
  signer: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock("@/lib/developer-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-auth")>()),
  authorizeFoundationRequest: authorize,
  requireFoundationSession: session,
}));
vi.mock("@/lib/customer-data-admission", () => ({ canAdmitCustomerSource: gate }));
vi.mock("@/lib/r2-synthetic-canary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2-synthetic-canary")>()),
  readR2SignerEnv: signer,
}));
vi.mock("@/lib/job-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./job-store")>()),
  enqueueConnectorSync: enqueue,
}));

import { POST as confirmUpload } from "../app/api/uploads/confirm/route";
import { POST as startConnectorSync } from "../app/api/v1/oauth-connectors/connections/[id]/sync/route";

const WORKSPACE = "pilot-gate-test";
const DOCUMENT = "11111111-1111-4111-8111-111111111111";
const CONNECTION = "22222222-2222-4222-8222-222222222222";

function request(path: string, body: unknown) {
  const json = JSON.stringify(body);
  return new Request(`https://tavonel.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(json)) },
    body: json,
  });
}

describe("customer-data approval before asynchronous intake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const principal = { kind: "session", workspaceKey: WORKSPACE, userId: DOCUMENT, accessSource: "subscription" };
    authorize.mockResolvedValue({ ok: true, principal });
    session.mockResolvedValue({ ok: true, principal });
    gate.mockResolvedValue(false);
  });

  it("refuses confirmation of an already issued capability after approval is revoked", async () => {
    const response = await confirmUpload(request("/api/uploads/confirm", { documentId: DOCUMENT }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ code: "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE" });
    expect(gate).toHaveBeenCalledWith(WORKSPACE);
    expect(signer).not.toHaveBeenCalled();
  });

  it("refuses a connector sync before enqueueing its job", async () => {
    const response = await startConnectorSync(
      request(`/api/v1/oauth-connectors/connections/${CONNECTION}/sync`, {}),
      { params: Promise.resolve({ id: CONNECTION }) },
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ code: "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE" });
    expect(gate).toHaveBeenCalledWith(WORKSPACE);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
