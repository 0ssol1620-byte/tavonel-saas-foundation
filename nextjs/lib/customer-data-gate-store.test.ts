import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CUSTOMER_DATA_GATE_SCHEMA,
  evaluateCustomerDataGate,
  type PreconditionEvidence,
} from "../../shared/customerDataGate";
import { customerDataPreconditions } from "../../shared/uskcEnums";

const adminConfig = vi.fn();
const adminRequest = vi.fn();
vi.mock("./supabase-admin", () => ({
  readSupabaseAdminConfig: (...args: unknown[]) => adminConfig(...args),
  supabaseAdminRequest: (...args: unknown[]) => adminRequest(...args),
}));

const { CUSTOMER_DATA_GATE_MAX_AGE_MS, readVerifiedCustomerDataGateDecision } =
  await import("./customer-data-gate-store");

const TENANT = "pilot-acme";
const WORKSPACE = "pilot-acme";
const EVALUATED_AT = "2026-09-20T00:00:00.000Z";
const NOW = new Date("2026-09-21T00:00:00.000Z");

function evidence(checkedAt = EVALUATED_AT): PreconditionEvidence[] {
  return customerDataPreconditions.map((precondition) => ({
    precondition,
    satisfied: true,
    evidence: `receipt:${precondition}`,
    checkedAt,
  }));
}

function row(overrides: Record<string, unknown> = {}) {
  const rows = evidence();
  const decision = evaluateCustomerDataGate({
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    evidence: rows,
    now: EVALUATED_AT,
  });
  if (!decision.allowed) throw new Error("fixture gate should be allowed");
  return {
    schema_version: CUSTOMER_DATA_GATE_SCHEMA,
    tenant_id: TENANT,
    workspace_id: WORKSPACE,
    allowed: true,
    satisfied_count: customerDataPreconditions.length,
    receipt_sha256: decision.receiptSha256,
    missing: [],
    evidence: rows,
    evaluated_at: EVALUATED_AT,
    recorded_at: "2026-09-20T00:00:01.000Z",
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("durable customer-data gate reader", () => {
  it("returns only a re-derived, exact-subject allowed decision", async () => {
    adminConfig.mockReturnValue({ url: "https://project.supabase.co", serviceRoleKey: "s".repeat(48) });
    adminRequest.mockResolvedValue(Response.json([row()]));

    const result = await readVerifiedCustomerDataGateDecision(TENANT, WORKSPACE, NOW);

    expect(result).toEqual({
      ok: true,
      decision: expect.objectContaining({
        allowed: true,
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        evaluatedAt: EVALUATED_AT,
      }),
    });
    const path = adminRequest.mock.calls[0]?.[1] as string;
    expect(path).toContain("customer_data_gate_receipts?");
    expect(decodeURIComponent(path)).toContain(`tenant_id=eq.${TENANT}`);
    expect(decodeURIComponent(path)).toContain(`workspace_id=eq.${WORKSPACE}`);
    expect(decodeURIComponent(path)).not.toContain("allowed=");
    expect(decodeURIComponent(path)).toContain("order=evaluated_at.desc,recorded_at.desc");
    expect(decodeURIComponent(path)).toContain("limit=1");
  });

  it.each([
    ["digest", { receipt_sha256: `sha256:${"0".repeat(64)}` }],
    ["tenant", { tenant_id: "pilot-other" }],
    ["count", { satisfied_count: customerDataPreconditions.length - 1 }],
    ["duplicate evidence", { evidence: [...evidence().slice(0, -1), evidence()[0]] }],
    ["recorded before evaluated", { recorded_at: "2026-09-19T23:59:59.000Z" }],
  ])("refuses a row with mismatched %s", async (_name, overrides) => {
    adminConfig.mockReturnValue({ url: "https://project.supabase.co", serviceRoleKey: "s".repeat(48) });
    adminRequest.mockResolvedValue(Response.json([row(overrides)]));
    await expect(readVerifiedCustomerDataGateDecision(TENANT, WORKSPACE, NOW)).resolves.toEqual({
      ok: false,
      code: "CUSTOMER_DATA_GATE_RECEIPT_INVALID",
    });
  });

  it("refuses stale approval and stale evidence independently", async () => {
    adminConfig.mockReturnValue({ url: "https://project.supabase.co", serviceRoleKey: "s".repeat(48) });
    adminRequest.mockResolvedValue(Response.json([row()]));
    await expect(readVerifiedCustomerDataGateDecision(
      TENANT,
      WORKSPACE,
      new Date(new Date(EVALUATED_AT).getTime() + CUSTOMER_DATA_GATE_MAX_AGE_MS + 1),
    )).resolves.toEqual({ ok: false, code: "CUSTOMER_DATA_GATE_RECEIPT_STALE" });

    const oldEvidence = evidence("2026-08-20T23:59:59.999Z");
    const oldDecision = evaluateCustomerDataGate({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      evidence: oldEvidence,
      now: EVALUATED_AT,
    });
    if (!oldDecision.allowed) throw new Error("fixture gate should be allowed before freshness is applied");
    adminRequest.mockResolvedValue(Response.json([row({
      evidence: oldEvidence,
      receipt_sha256: oldDecision.receiptSha256,
    })]));
    await expect(readVerifiedCustomerDataGateDecision(TENANT, WORKSPACE, NOW)).resolves.toEqual({
      ok: false,
      code: "CUSTOMER_DATA_GATE_RECEIPT_STALE",
    });
  });

  it("lets the newest refusal revoke every older approval", async () => {
    adminConfig.mockReturnValue({ url: "https://project.supabase.co", serviceRoleKey: "s".repeat(48) });
    adminRequest.mockResolvedValue(Response.json([row({
      allowed: false,
      satisfied_count: 0,
      receipt_sha256: null,
      missing: [customerDataPreconditions[0]],
      evidence: [],
    })]));

    await expect(readVerifiedCustomerDataGateDecision(TENANT, WORKSPACE, NOW)).resolves.toEqual({
      ok: false,
      code: "CUSTOMER_DATA_GATE_RECEIPT_REFUSED",
    });
  });

  it("distinguishes missing configuration, absent approval and an unavailable store", async () => {
    adminConfig.mockReturnValueOnce(null);
    await expect(readVerifiedCustomerDataGateDecision(TENANT, WORKSPACE, NOW)).resolves.toEqual({
      ok: false,
      code: "CUSTOMER_DATA_GATE_STORE_NOT_CONFIGURED",
    });

    adminConfig.mockReturnValue({ url: "https://project.supabase.co", serviceRoleKey: "s".repeat(48) });
    adminRequest.mockResolvedValueOnce(Response.json([]));
    await expect(readVerifiedCustomerDataGateDecision(TENANT, WORKSPACE, NOW)).resolves.toEqual({
      ok: false,
      code: "CUSTOMER_DATA_GATE_RECEIPT_NOT_FOUND",
    });

    adminRequest.mockRejectedValueOnce(new Error("offline"));
    await expect(readVerifiedCustomerDataGateDecision(TENANT, WORKSPACE, NOW)).resolves.toEqual({
      ok: false,
      code: "CUSTOMER_DATA_GATE_STORE_FAILED",
    });
  });
});
