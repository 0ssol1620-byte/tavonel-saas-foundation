import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, pilotAccess, accessMode, bootstrap, authorize, gate, provision } = vi.hoisted(() => ({
  getUser: vi.fn(),
  pilotAccess: vi.fn(),
  accessMode: vi.fn(),
  bootstrap: vi.fn(),
  authorize: vi.fn(),
  gate: vi.fn(),
  provision: vi.fn(),
}));

vi.mock("@/lib/foundation-pilot", () => ({
  getRequestUser: getUser,
  foundationPilotAccess: pilotAccess,
  readAccessMode: accessMode,
}));
vi.mock("@/lib/self-service-trial", () => ({
  bootstrapFoundationSelfServiceTrial: bootstrap,
  authorizeFoundationSessionProduct: authorize,
}));
vi.mock("@/lib/customer-data-gate-store", () => ({ readVerifiedCustomerDataGateDecision: gate }));
vi.mock("@/lib/self-service-provisioning", () => ({ ensureSelfServiceOrganization: provision }));

import { POST } from "../app/api/access/bootstrap/route";

describe("workspace bootstrap source admission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" });
    pilotAccess.mockReturnValue({ membership: { workspaceId: "pilot-11111111" } });
    accessMode.mockReturnValue("pilot");
    provision.mockResolvedValue({ ok: true });
    gate.mockResolvedValue({ ok: true, decision: { allowed: true } });
    bootstrap.mockResolvedValue({ ok: true, access: { source: "owner", accessPlan: "studio_access", billingExempt: true, expiresAt: null }, limits: null });
    authorize.mockResolvedValue({ ok: false, code: "SUBSCRIPTION_REQUIRED", status: 402 });
  });

  it.each([false, true])("reports the verified workspace decision %s without exposing receipt details", async (enabled) => {
    gate.mockResolvedValue(enabled ? { ok: true, decision: { allowed: true } } : { ok: false, code: "CUSTOMER_DATA_GATE_RECEIPT_NOT_FOUND" });
    const response = await POST(new Request("https://tavonel.test/api/access/bootstrap", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ access: { customerDataEnabled: enabled } });
    expect(gate).toHaveBeenCalledWith("pilot-11111111", "pilot-11111111");
  });

  it("does not start a free evaluation while customer file processing is closed", async () => {
    accessMode.mockReturnValue("self_service");
    gate.mockResolvedValue({ ok: false, code: "CUSTOMER_DATA_GATE_RECEIPT_NOT_FOUND" });
    const response = await POST(new Request("https://tavonel.test/api/access/bootstrap", { method: "POST" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      code: "ACCESS_READY_SOURCE_PENDING",
      access: { source: "unentitled", limits: null, expiresAt: null, customerDataEnabled: false },
    });
    expect(bootstrap).not.toHaveBeenCalled();
    expect(authorize).toHaveBeenCalledWith("pilot-11111111", "11111111-1111-4111-8111-111111111111", "observer");
  });

  it("keeps owner access visible without starting a trial while intake is closed", async () => {
    accessMode.mockReturnValue("self_service");
    gate.mockResolvedValue({ ok: false, code: "CUSTOMER_DATA_GATE_RECEIPT_NOT_FOUND" });
    authorize.mockResolvedValue({ ok: true, access: { source: "owner", accessPlan: "studio_access", billingExempt: true, expiresAt: null } });
    const response = await POST(new Request("https://tavonel.test/api/access/bootstrap", { method: "POST" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      access: { source: "owner", accessPlan: "studio_access", customerDataEnabled: false },
    });
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it("starts the evaluation when exact-workspace source access opens", async () => {
    accessMode.mockReturnValue("self_service");
    gate.mockResolvedValue({ ok: true, decision: { allowed: true } });
    bootstrap.mockResolvedValue({ ok: true, access: { source: "trial", accessPlan: "observer_access", billingExempt: true, expiresAt: "2026-10-06T00:00:00Z" }, limits: { files: 3, pages: 50, worlds: 1 } });
    const response = await POST(new Request("https://tavonel.test/api/access/bootstrap", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(bootstrap).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({ access: { source: "trial", customerDataEnabled: true } });
  });

  it("does not inspect a workspace gate before authentication", async () => {
    getUser.mockResolvedValue(null);
    const response = await POST(new Request("https://tavonel.test/api/access/bootstrap", { method: "POST" }));
    expect(response.status).toBe(401);
    expect(gate).not.toHaveBeenCalled();
  });

  it("reports a gate store outage as unavailable rather than source access pending", async () => {
    accessMode.mockReturnValue("self_service");
    gate.mockResolvedValue({ ok: false, code: "CUSTOMER_DATA_GATE_STORE_FAILED" });
    const response = await POST(new Request("https://tavonel.test/api/access/bootstrap", { method: "POST" }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "SOURCE_ACCESS_UNAVAILABLE" });
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it("keeps an existing trial hidden while source access is closed without claiming it was paused", async () => {
    accessMode.mockReturnValue("self_service");
    gate.mockResolvedValue({ ok: false, code: "CUSTOMER_DATA_GATE_RECEIPT_NOT_FOUND" });
    authorize.mockResolvedValue({ ok: true, access: { source: "trial", accessPlan: "observer_access", billingExempt: true, expiresAt: "2026-10-06T00:00:00Z" } });
    const response = await POST(new Request("https://tavonel.test/api/access/bootstrap", { method: "POST" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ access: { source: "unentitled", expiresAt: null, customerDataEnabled: false } });
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it.each([
    ["TRIAL_DEVICE_ALREADY_USED", 403],
    ["TRIAL_REVIEW_REQUIRED", 429],
    ["TRIAL_NOT_ACTIVE", 403],
    ["TRIAL_DISABLED", 403],
  ])("allows sign-in without granting compute after %s", async (code, status) => {
    accessMode.mockReturnValue("self_service");
    bootstrap.mockResolvedValue({ ok: false, code, status });
    const response = await POST(new Request("https://tavonel.test/api/access/bootstrap", { method: "POST" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      code: "ACCESS_READY_NO_ENTITLEMENT",
      access: { source: "unentitled", accessPlan: null, limits: null, customerDataEnabled: false },
    });
    expect(gate).toHaveBeenCalledWith("pilot-11111111", "pilot-11111111");
  });

  it("keeps configuration failures closed", async () => {
    accessMode.mockReturnValue("self_service");
    bootstrap.mockResolvedValue({ ok: false, code: "TRIAL_RISK_GATE_NOT_CONFIGURED", status: 503 });
    const response = await POST(new Request("https://tavonel.test/api/access/bootstrap", { method: "POST" }));
    expect(response.status).toBe(503);
  });

  it.each([
    ["TRIAL_BOOTSTRAP_INVALID", 400],
    ["TRIAL_UNKNOWN_RISK", 403],
  ])("does not disguise invalid or unknown bootstrap errors as access-ready: %s", async (code, status) => {
    accessMode.mockReturnValue("self_service");
    bootstrap.mockResolvedValue({ ok: false, code, status });
    const response = await POST(new Request("https://tavonel.test/api/access/bootstrap", { method: "POST" }));
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ code });
  });
});
