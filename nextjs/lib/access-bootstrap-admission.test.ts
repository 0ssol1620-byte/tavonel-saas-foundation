import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, pilotAccess, accessMode, bootstrap, gate, provision } = vi.hoisted(() => ({
  getUser: vi.fn(),
  pilotAccess: vi.fn(),
  accessMode: vi.fn(),
  bootstrap: vi.fn(),
  gate: vi.fn(),
  provision: vi.fn(),
}));

vi.mock("@/lib/foundation-pilot", () => ({
  getRequestUser: getUser,
  foundationPilotAccess: pilotAccess,
  readAccessMode: accessMode,
}));
vi.mock("@/lib/self-service-trial", () => ({ bootstrapFoundationSelfServiceTrial: bootstrap }));
vi.mock("@/lib/customer-data-admission", () => ({ canAdmitCustomerSource: gate }));
vi.mock("@/lib/self-service-provisioning", () => ({ ensureSelfServiceOrganization: provision }));

import { POST } from "../app/api/access/bootstrap/route";

describe("workspace bootstrap source admission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" });
    pilotAccess.mockReturnValue({ membership: { workspaceId: "pilot-11111111" } });
    accessMode.mockReturnValue("pilot");
    provision.mockResolvedValue({ ok: true });
    bootstrap.mockResolvedValue({ ok: true, access: { source: "owner", accessPlan: "studio_access", billingExempt: true, expiresAt: null }, limits: null });
  });

  it.each([false, true])("reports the verified workspace decision %s without exposing receipt details", async (enabled) => {
    gate.mockResolvedValue(enabled);
    const response = await POST(new Request("https://tavonel.test/api/access/bootstrap", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ access: { customerDataEnabled: enabled } });
    expect(gate).toHaveBeenCalledWith("pilot-11111111");
  });

  it("does not inspect a workspace gate before authentication", async () => {
    getUser.mockResolvedValue(null);
    const response = await POST(new Request("https://tavonel.test/api/access/bootstrap", { method: "POST" }));
    expect(response.status).toBe(401);
    expect(gate).not.toHaveBeenCalled();
  });

  it.each([
    ["TRIAL_DEVICE_ALREADY_USED", 403],
    ["TRIAL_REVIEW_REQUIRED", 429],
    ["TRIAL_NOT_ACTIVE", 403],
  ])("allows sign-in without granting compute after %s", async (code, status) => {
    accessMode.mockReturnValue("self_service");
    bootstrap.mockResolvedValue({ ok: false, code, status });
    const response = await POST(new Request("https://tavonel.test/api/access/bootstrap", { method: "POST" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      code: "ACCESS_READY_NO_ENTITLEMENT",
      access: { source: "unentitled", accessPlan: null, limits: null, customerDataEnabled: false },
    });
    expect(gate).not.toHaveBeenCalled();
  });

  it("keeps configuration failures closed", async () => {
    accessMode.mockReturnValue("self_service");
    bootstrap.mockResolvedValue({ ok: false, code: "TRIAL_RISK_GATE_NOT_CONFIGURED", status: 503 });
    const response = await POST(new Request("https://tavonel.test/api/access/bootstrap", { method: "POST" }));
    expect(response.status).toBe(503);
  });
});
