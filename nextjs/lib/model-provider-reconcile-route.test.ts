import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { reconcile } = vi.hoisted(() => ({ reconcile: vi.fn() }));
vi.mock("@/lib/model-provider-spend", () => ({ reconcileModelProviderSpend: reconcile }));
vi.mock("@/lib/r2-synthetic-canary", () => ({
  authorizeSyntheticCanary: (presented: string | null, secret: string) => presented === `Bearer ${secret}`,
}));

const SECRET = "w".repeat(40);
const RESERVATION = "4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

function body(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "pilot-acme",
    reservationId: RESERVATION,
    outcome: "settled",
    actualUnits: 7,
    reasonCode: "PROVIDER_INVOICE_RECONCILED",
    ...overrides,
  };
}

async function post(payload: unknown, authorization: string | null = `Bearer ${SECRET}`) {
  const { POST } = await import("@/app/api/internal/model-provider/reconcile/route");
  return POST(new Request("https://tavonel.com/api/internal/model-provider/reconcile", {
    method: "POST",
    headers: authorization ? { authorization } : {},
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  }));
}

function resolved(overrides: Record<string, unknown> = {}) {
  return {
    ok: true as const,
    receipt: {
      status: "processed", reservationId: RESERVATION, state: "settled",
      actualUnits: 7, actualMicrousd: 7_000, refundedMicrousd: 3_000,
      reconciliationStatus: "resolved", ...overrides,
    },
  };
}

describe("internal model-provider spend reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("FOUNDATION_WORKER_SECRET", SECRET);
    vi.stubEnv("CRON_SECRET", "");
  });

  it("refuses an unauthenticated caller before reading the body", async () => {
    const response = await post(body(), null);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "MODEL_PROVIDER_RECONCILE_NOT_AUTHORIZED" });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("refuses a wrong secret, and refuses every secret when none is configured", async () => {
    expect((await post(body(), `Bearer ${"z".repeat(40)}`)).status).toBe(401);
    vi.stubEnv("FOUNDATION_WORKER_SECRET", "");
    expect((await post(body())).status).toBe(401);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("ignores a short configured secret rather than accepting it", async () => {
    vi.stubEnv("FOUNDATION_WORKER_SECRET", "short");
    expect((await post(body(), "Bearer short")).status).toBe(401);
  });

  it("resolves a pending reservation with the operator's invoice units", async () => {
    reconcile.mockResolvedValue(resolved());
    const response = await post(body());

    expect(reconcile).toHaveBeenCalledWith({
      tenantId: "pilot-acme", reservationId: RESERVATION, outcome: "settled",
      actualUnits: 7, reasonCode: "PROVIDER_INVOICE_RECONCILED",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: "MODEL_PROVIDER_RECONCILIATION_RESOLVED",
      reservationId: RESERVATION, state: "settled", actualUnits: 7,
      actualMicrousd: 7_000, reconciliationStatus: "resolved",
    });
  });

  it("replays idempotently, naming the replay rather than charging twice", async () => {
    reconcile.mockResolvedValue(resolved({ status: "duplicate" }));
    const response = await post(body());
    expect(response.status).toBe(200);
    expect((await response.json()).code).toBe("MODEL_PROVIDER_RECONCILIATION_REPLAYED");
  });

  it("never defaults a misspelled outcome to settled", async () => {
    for (const outcome of ["SETTLED", "settle", "", null, undefined, 1]) {
      const response = await post(body({ outcome }));
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("MODEL_PROVIDER_RECONCILIATION_INVALID");
    }
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("refuses a body that is not a JSON object", async () => {
    for (const payload of ["not json", "[]", "null", '"text"']) {
      expect((await post(payload)).status).toBe(400);
    }
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("passes a non-integer unit count on as a refusable value, never rounds it", async () => {
    reconcile.mockResolvedValue({ ok: false, code: "MODEL_PROVIDER_RECONCILIATION_INVALID" });
    const response = await post(body({ actualUnits: 7.5 }));
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ actualUnits: -1 }));
    expect(response.status).toBe(400);
  });

  it("separates an unknown reservation from an outage", async () => {
    const cases = [
      ["MODEL_PROVIDER_RESERVATION_NOT_FOUND", 404],
      ["MODEL_PROVIDER_RECONCILIATION_NOT_FOUND", 404],
      ["MODEL_PROVIDER_RESERVATION_NOT_ACTIVE", 409],
      ["MODEL_PROVIDER_RECONCILIATION_CONFLICT", 409],
      ["MODEL_PROVIDER_RESERVED_COST_EXCEEDED", 409],
      ["MODEL_PROVIDER_LEDGER_NOT_CONFIGURED", 503],
      ["MODEL_PROVIDER_LEDGER_FAILED", 503],
    ] as const;
    for (const [code, status] of cases) {
      reconcile.mockResolvedValue({ ok: false, code });
      const response = await post(body());
      expect(response.status, code).toBe(status);
      expect((await response.json()).code).toBe(code);
    }
  });

  it("exposes no GET, so no scheduler can settle spend on its own", async () => {
    const route = await import("@/app/api/internal/model-provider/reconcile/route");
    expect(route).not.toHaveProperty("GET");
    expect(typeof route.POST).toBe("function");
  });

  it("is classified as a bearer route with POST only", () => {
    const classification = JSON.parse(readFileSync(
      resolve(import.meta.dirname, "security/route-classification.json"), "utf8"));
    expect(classification.routes["app/api/internal/model-provider/reconcile/route.ts"])
      .toMatchObject({ type: "A-bearer", methods: ["POST"], credential: "bearer:shared-secret" });
  });
});
