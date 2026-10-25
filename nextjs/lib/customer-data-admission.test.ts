import { beforeEach, describe, expect, it, vi } from "vitest";

const { legacy, scoped, launch } = vi.hoisted(() => ({ legacy: vi.fn(), scoped: vi.fn(), launch: { open: false } }));
vi.mock("./customer-data-gate-store", () => ({ readVerifiedCustomerDataGateDecision: legacy }));
vi.mock("./scoped-customer-data-gate-store", () => ({ readVerifiedScopedCustomerDataGate: scoped }));
// The launch switch (activationPolicy.customerData.enabled, P2-37) as a getter, so one file can read
// it closed -- main's value, every suite above the D-19 block -- and open.
vi.mock("./activation-policy", async (importOriginal) => {
  const { activationPolicy } = await importOriginal<typeof import("./activation-policy")>();
  return { activationPolicy: { ...activationPolicy, customerData: { ...activationPolicy.customerData, get enabled() { return launch.open; } } } };
});
import { canAdmitCustomerSource, readCustomerSourceAuthorization } from "./customer-data-admission";

const revision = "a".repeat(40);
const env = { TAVONEL_CUSTOMER_DATA_GATE_VERSION: "v2", VERCEL_GIT_COMMIT_SHA: revision };

describe("scope-bound source admission", () => {
  beforeEach(() => { vi.clearAllMocks(); launch.open = false; legacy.mockResolvedValue({ ok: true }); });

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

/*
  D-19 (register 2026-10-17): the self-serve launch runs gate v2 inside a canary of one to three
  named workspaces (TAVONEL_PROCESSING_WORKSPACE_COHORT). The rule is keyed on the launch switch, so
  it is inert while that switch is off -- production today, asserted last.
*/
describe("D-19 launch canary: gate v2 and a cohort of one to three workspaces", () => {
  const PILOT = "pilot-969dc192daa24119";
  const OTHER = "pilot-1111111111114111";
  const wide = ["pilot-a1", "pilot-a2", "pilot-a3", "pilot-a4"];
  // null: the variable is not set at all.
  const canary = (cohort?: string, version: string | null = "v2") => ({
    VERCEL_GIT_COMMIT_SHA: revision,
    ...(version === null ? {} : { TAVONEL_CUSTOMER_DATA_GATE_VERSION: version }),
    ...(cohort === undefined ? {} : { TAVONEL_PROCESSING_WORKSPACE_COHORT: cohort }),
  });
  beforeEach(() => {
    vi.clearAllMocks();
    launch.open = true;
    legacy.mockResolvedValue({ ok: true });
    scoped.mockResolvedValue({ ok: true, authorization: { allowed: true } });
  });

  it("admits a cohort workspace under v2 with a current grant", async () => {
    expect(await canAdmitCustomerSource(PILOT, "direct_upload", canary(PILOT))).toBe(true);
    expect(await canAdmitCustomerSource("pilot-a3", "direct_upload", canary(wide.slice(0, 3).join(",")))).toBe(true);
  });

  it("missing env: no cohort, or no v2 selection, admits nobody and never reaches a store", async () => {
    for (const config of [canary(undefined), canary(PILOT, null), canary(PILOT, "v1"), canary(PILOT, ""), canary(undefined, null)]) {
      expect(await readCustomerSourceAuthorization(PILOT, "direct_upload", config), JSON.stringify(config))
        .toEqual({ ok: false, code: "PROCESSING_COHORT_CONFIG_INVALID" });
    }
    expect(scoped).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });

  it("refuses a cohort wider than three, and an empty one", async () => {
    for (const cohort of [wide.join(","), ""]) {
      expect(await readCustomerSourceAuthorization("pilot-a1", "direct_upload", canary(cohort)), cohort)
        .toEqual({ ok: false, code: "PROCESSING_COHORT_CONFIG_INVALID" });
    }
    expect(scoped).not.toHaveBeenCalled();
  });

  it("cohort mismatch: a workspace outside the canary is refused even with a current grant", async () => {
    expect(await readCustomerSourceAuthorization(OTHER, "direct_upload", canary(PILOT)))
      .toEqual({ ok: false, code: "PROCESSING_COHORT_EXCLUDED" });
    expect(scoped).not.toHaveBeenCalled();
  });

  it("revoked approval: a later workspace refusal closes a cohort workspace, with no v1 fallback", async () => {
    scoped.mockResolvedValue({ ok: false, code: "SCOPED_WORKSPACE_REFUSED" });
    expect(await readCustomerSourceAuthorization(PILOT, "direct_upload", canary(PILOT)))
      .toEqual({ ok: false, code: "SCOPED_WORKSPACE_REFUSED" });
    expect(legacy).not.toHaveBeenCalled();
  });

  it("is inert while the launch switch is off: v1, an unset cohort and a wider cohort behave as on main", async () => {
    launch.open = false;
    expect(await canAdmitCustomerSource(PILOT, "direct_upload", {})).toBe(true);
    expect(await canAdmitCustomerSource(PILOT, "direct_upload", canary(undefined))).toBe(true);
    expect(await canAdmitCustomerSource("pilot-a4", "direct_upload", canary(wide.join(",")))).toBe(true);
  });
});
