import { beforeEach, describe, expect, it, vi } from "vitest";

const { run, issueGrant } = vi.hoisted(() => ({ run: vi.fn(), issueGrant: vi.fn() }));
vi.mock("@/lib/processing-workspace-grant", () => ({ issueProcessingWorkspaceGrant: issueGrant }));
vi.mock("@/lib/billing-gate-enforcement", () => ({
  runBillingGateEnforcement: run,
  createSupabaseGateEnforcementStore: () => ({}),
}));
vi.mock("@/lib/customer-data-admission", () => ({ readCustomerSourceAuthorization: vi.fn() }));
vi.mock("@/lib/r2-synthetic-canary", () => ({
  authorizeSyntheticCanary: (presented: string | null, secret: string) => presented === `Bearer ${secret}`,
}));

const SECRET = "w".repeat(40);

async function call(authorization: string | null = `Bearer ${SECRET}`) {
  const { GET } = await import("@/app/api/internal/billing/gate-enforce/route");
  return GET(new Request("https://tavonel.com/api/internal/billing/gate-enforce", {
    headers: authorization ? { authorization } : {},
  }));
}

describe("internal billing gate enforcement route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("FOUNDATION_WORKER_SECRET", "");
    vi.stubEnv("PADDLE_SANDBOX", "false");
    vi.stubEnv("PADDLE_API_KEY", `pdl_live_${"k".repeat(24)}`);
    vi.stubEnv("FOUNDATION_BILLING_HMAC", "h".repeat(40));
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "s".repeat(40));
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TAVONEL_CUSTOMER_DATA_GATE_VERSION", "v2");
    run.mockResolvedValue({ ok: true, counts: { paused: 1 } });
  });

  it("refuses an unauthenticated caller before doing anything", async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call(`Bearer ${"z".repeat(40)}`)).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses to act from a preview that holds the live key, or without the binding secret", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await call()).status).toBe(503);
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("FOUNDATION_BILLING_HMAC", "");
    expect((await call()).status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs against the live environment and reports only outcome counts", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: "OK", counts: { paused: 1 } });
    expect(run.mock.calls[0][0]).toMatchObject({ expectedEnvironment: "production" });
  });

  it("answers 503 when the durable store cannot list candidates", async () => {
    run.mockResolvedValue({ ok: false, code: "BILLING_GATE_STORE_FAILED" });
    expect((await call()).status).toBe(503);
  });

  it("renews v2 grants for the direct-upload scope before the gate read, and not on v1", async () => {
    await call();
    await run.mock.calls[0][0].renewGrant("pilot-abc");
    expect(issueGrant).toHaveBeenCalledWith({ workspaceKey: "pilot-abc", scope: "direct_upload" });
    vi.stubEnv("TAVONEL_CUSTOMER_DATA_GATE_VERSION", "v1");
    await call();
    expect(run.mock.calls[1][0].renewGrant).toBeUndefined();
  });
});
