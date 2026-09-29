import { beforeEach, describe, expect, it, vi } from "vitest";

const { legacy, scoped } = vi.hoisted(() => ({ legacy: vi.fn(), scoped: vi.fn() }));
vi.mock("./customer-data-gate-store", () => ({ readVerifiedCustomerDataGateDecision: legacy }));
vi.mock("./scoped-customer-data-gate-store", () => ({ readVerifiedScopedCustomerDataGate: scoped }));
import { canAdmitCustomerSource } from "./customer-data-admission";

const revision = "a".repeat(40);
const env = { TAVONEL_CUSTOMER_DATA_GATE_VERSION: "v2", VERCEL_GIT_COMMIT_SHA: revision };

describe("scope-bound source admission", () => {
  beforeEach(() => { vi.clearAllMocks(); legacy.mockResolvedValue({ ok: true }); });

  it("retains v1 until the explicit rollout", async () => {
    expect(await canAdmitCustomerSource("workspace-a", "direct_upload", {})).toBe(true);
    expect(scoped).not.toHaveBeenCalled();
  });

  it("does not let a direct-upload approval authorize a connector", async () => {
    scoped.mockImplementation(async (_tenant, _workspace, scope) => ({ ok: scope === "direct_upload" }));
    expect(await canAdmitCustomerSource("workspace-a", "direct_upload", env)).toBe(true);
    expect(await canAdmitCustomerSource("workspace-a", "connector", env)).toBe(false);
    expect(scoped).toHaveBeenLastCalledWith("workspace-a", "workspace-a", "connector", revision, expect.any(Date), env);
    expect(legacy).not.toHaveBeenCalled();
  });

  it.each(["SCOPED_RELEASE_REFUSED", "SCOPED_RELEASE_STALE", "SCOPED_WORKSPACE_NOT_FOUND", "SCOPED_GATE_STORE_FAILED"])(
    "never falls back to a legacy approval on %s", async code => {
      scoped.mockResolvedValue({ ok: false, code });
      expect(await canAdmitCustomerSource("workspace-a", "direct_upload", env)).toBe(false);
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, "", "main", "a".repeat(39)])("refuses a missing or invalid deployed revision: %s", async value => {
    expect(await canAdmitCustomerSource("workspace-a", "direct_upload", { ...env, VERCEL_GIT_COMMIT_SHA: value })).toBe(false);
    expect(scoped).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });

  it("refuses an unknown gate version instead of selecting v1", async () => {
    expect(await canAdmitCustomerSource("workspace-a", "direct_upload", { TAVONEL_CUSTOMER_DATA_GATE_VERSION: "v3" })).toBe(false);
    expect(legacy).not.toHaveBeenCalled();
  });
});
