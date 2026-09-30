import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, pilotAccess, accessMode, bootstrap, authorize, gate, provision, issueGrant } = vi.hoisted(() => ({
  getUser: vi.fn(),
  pilotAccess: vi.fn(),
  accessMode: vi.fn(),
  bootstrap: vi.fn(),
  authorize: vi.fn(),
  gate: vi.fn(),
  provision: vi.fn(),
  issueGrant: vi.fn(),
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
vi.mock("@/lib/customer-data-admission", () => ({ readCustomerSourceAuthorization: gate }));
vi.mock("@/lib/self-service-provisioning", () => ({ ensureSelfServiceOrganization: provision }));
vi.mock("@/lib/processing-workspace-grant", () => ({ issueProcessingWorkspaceGrant: issueGrant }));

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
  afterEach(() => expect(issueGrant).not.toHaveBeenCalled()); // v1: no grant issuance

  it.each([false, true])("reports the verified workspace decision %s without exposing receipt details", async (enabled) => {
    gate.mockResolvedValue(enabled ? { ok: true, decision: { allowed: true } } : { ok: false, code: "CUSTOMER_DATA_GATE_RECEIPT_NOT_FOUND" });
    const response = await POST(new Request("https://tavonel.test/api/access/bootstrap", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ access: { customerDataEnabled: enabled } });
    expect(gate).toHaveBeenCalledWith("pilot-11111111", "direct_upload");
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
    expect(gate).toHaveBeenCalledWith("pilot-11111111", "direct_upload");
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

describe("v2 workspace grant during bootstrap", () => {
  const post = () => POST(new Request("https://tavonel.test/api/access/bootstrap", { method: "POST" }));
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TAVONEL_CUSTOMER_DATA_GATE_VERSION", "v2");
    getUser.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" });
    pilotAccess.mockReturnValue({ membership: { workspaceId: "pilot-11111111" } });
    accessMode.mockReturnValue("self_service");
    provision.mockResolvedValue({ ok: true });
    issueGrant.mockResolvedValue({ ok: true, grant: {}, idempotentReplay: false });
    gate.mockResolvedValue({ ok: true, decision: { allowed: true } });
    bootstrap.mockResolvedValue({ ok: true, access: { source: "trial", accessPlan: "observer_access", billingExempt: true, expiresAt: "2026-10-07T00:00:00Z" }, limits: { files: 3, pages: 50, worlds: 1 } });
    authorize.mockResolvedValue({ ok: false, code: "SUBSCRIPTION_REQUIRED", status: 402 });
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("provisions, renews the grant, reads the actual gate and only then starts the trial", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ code: "ACCESS_READY", access: { source: "trial", customerDataEnabled: true } });
    expect(issueGrant).toHaveBeenCalledWith({ workspaceKey: "pilot-11111111", scope: "direct_upload" });
    const order = [provision, issueGrant, gate, bootstrap].map((fn) => fn.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it.each([
    ["PROCESSING_TERMS_ACCEPTANCE_REQUIRED", "SCOPED_WORKSPACE_NOT_FOUND", "terms_acceptance_required"],
    ["SCOPED_RELEASE_NOT_FOUND", "SCOPED_RELEASE_NOT_FOUND", "release_pending"],
    ["SCOPED_RELEASE_REFUSED", "SCOPED_RELEASE_REFUSED", "release_pending"],
    ["SCOPED_WORKSPACE_REFUSED", "SCOPED_WORKSPACE_REFUSED", "workspace_refused"],
  ])("reports %s as truthful pending access without a trial", async (grantCode, gateCode, reason) => {
    issueGrant.mockResolvedValue({ ok: false, code: grantCode });
    gate.mockResolvedValue({ ok: false, code: gateCode });
    const response = await post();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      code: "ACCESS_READY_SOURCE_PENDING", sourcePending: reason,
      access: { source: "unentitled", limits: null, customerDataEnabled: false },
    });
    expect(gate).toHaveBeenCalledOnce();
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it("does not let a previous owner's grant open access after the owner changed", async () => {
    // The new owner has not accepted; the old grant is still unexpired but its acceptance is gone.
    issueGrant.mockResolvedValue({ ok: false, code: "PROCESSING_TERMS_ACCEPTANCE_REQUIRED" });
    gate.mockResolvedValue({ ok: false, code: "SCOPED_TERMS_ACCEPTANCE_REQUIRED" });
    const response = await post();
    await expect(response.json()).resolves.toMatchObject({
      code: "ACCESS_READY_SOURCE_PENDING", sourcePending: "terms_acceptance_required",
      access: { customerDataEnabled: false },
    });
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it.each(["WORKSPACE_GRANT_STORE_FAILED", "WORKSPACE_GRANT_STORE_NOT_CONFIGURED", "PROCESSING_TERMS_UNAVAILABLE", "SCOPED_RELEASE_INVALID"])(
    "reports grant %s as a 503 outage before reading the gate", async (code) => {
      issueGrant.mockResolvedValue({ ok: false, code });
      const response = await post();
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ code: "SOURCE_ACCESS_UNAVAILABLE" });
      expect(gate).not.toHaveBeenCalled();
      expect(bootstrap).not.toHaveBeenCalled();
    });

  it("reports an unreadable served manifest at gate time as an outage", async () => {
    gate.mockResolvedValue({ ok: false, code: "SCOPED_TERMS_UNAVAILABLE" });
    const response = await post();
    expect(response.status).toBe(503);
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it("does not issue grants before provisioning succeeds", async () => {
    provision.mockResolvedValue({ ok: false, code: "SELF_SERVICE_PROVISIONING_FAILED" });
    expect((await post()).status).toBe(503);
    expect(issueGrant).not.toHaveBeenCalled();
  });
});
