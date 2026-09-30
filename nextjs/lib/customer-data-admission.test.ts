import { beforeEach, describe, expect, it, vi } from "vitest";

const { legacy, scoped } = vi.hoisted(() => ({ legacy: vi.fn(), scoped: vi.fn() }));
vi.mock("./customer-data-gate-store", () => ({ readVerifiedCustomerDataGateDecision: legacy }));
vi.mock("./scoped-customer-data-gate-store", () => ({ readVerifiedScopedCustomerDataGate: scoped }));
import { canAdmitCustomerSource, readCustomerSourceAuthorization } from "./customer-data-admission";

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

  describe("TAVONEL_PROCESSING_WORKSPACE_COHORT", () => {
    const PILOT = "pilot-969dc192daa24119";
    const OTHER = "pilot-1111111111114111";
    const cohort = (value: string) => ({ ...env, TAVONEL_PROCESSING_WORKSPACE_COHORT: value });

    it("refuses a workspace that still holds a valid grant once it is not in the cohort", async () => {
      scoped.mockResolvedValue({ ok: true, authorization: { allowed: true } });
      expect(await canAdmitCustomerSource(OTHER, "direct_upload", env)).toBe(true); // unset: unchanged
      expect(await canAdmitCustomerSource(PILOT, "direct_upload", cohort(PILOT))).toBe(true);
      expect(await readCustomerSourceAuthorization(OTHER, "direct_upload", cohort(PILOT)))
        .toEqual({ ok: false, code: "PROCESSING_COHORT_EXCLUDED" });
      // Removing the pilot from the list closes it on the next read, grant or not.
      expect(await canAdmitCustomerSource(PILOT, "direct_upload", cohort(OTHER))).toBe(false);
    });

    it("only narrows: cohort membership does not carry a direct-upload grant to connectors", async () => {
      scoped.mockImplementation(async (_tenant, _workspace, scope) =>
        scope === "direct_upload" ? { ok: true } : { ok: false, code: "SCOPED_WORKSPACE_NOT_FOUND" });
      expect(await canAdmitCustomerSource(PILOT, "direct_upload", cohort(PILOT))).toBe(true);
      expect(await canAdmitCustomerSource(PILOT, "connector", cohort(PILOT))).toBe(false);
      scoped.mockResolvedValue({ ok: false, code: "SCOPED_RELEASE_NOT_FOUND" });
      expect(await canAdmitCustomerSource(PILOT, "direct_upload", cohort(PILOT))).toBe(false);
    });

    it.each(["", " ", "*", "pilot-*", "pilot-969dc192", `${PILOT},`, `${PILOT} ${OTHER}`, "workspace-a"])(
      "fails closed on malformed cohort %j, even with a valid grant", async value => {
        scoped.mockResolvedValue({ ok: true });
        expect(await readCustomerSourceAuthorization(PILOT, "direct_upload", cohort(value)))
          .toEqual({ ok: false, code: value === "pilot-969dc192" ? "PROCESSING_COHORT_EXCLUDED" : "PROCESSING_COHORT_CONFIG_INVALID" });
        expect(scoped).not.toHaveBeenCalled();
        expect(legacy).not.toHaveBeenCalled();
      },
    );

    it("also narrows the v1 gate", async () => {
      expect(await canAdmitCustomerSource(OTHER, "direct_upload", { TAVONEL_PROCESSING_WORKSPACE_COHORT: PILOT })).toBe(false);
      expect(legacy).not.toHaveBeenCalled();
    });
  });

  it("refuses an unknown gate version instead of selecting v1", async () => {
    expect(await canAdmitCustomerSource("workspace-a", "direct_upload", { TAVONEL_CUSTOMER_DATA_GATE_VERSION: "v3" })).toBe(false);
    expect(legacy).not.toHaveBeenCalled();
  });
});
