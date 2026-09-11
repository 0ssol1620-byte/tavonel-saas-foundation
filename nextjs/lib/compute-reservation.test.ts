import { afterEach, describe, expect, it, vi } from "vitest";
import { reserveFoundationCompute, settleFoundationCompute } from "./compute-reservation";

const base = {
  workspaceKey: "pilot-4444444444444444",
  documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  userId: "44444444-4444-4444-8444-444444444444",
  estimatedPages: 3,
};

describe("Foundation compute ledger", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  function configure() {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `sb_secret_${"s".repeat(31)}`);
  }

  it.each([
    ["foundation_studio_subscription_required", "STUDIO_SUBSCRIPTION_REQUIRED"],
    ["foundation_billing_hold", "BILLING_HOLD"],
    ["foundation_credits_required", "GPU_CREDITS_REQUIRED"],
    ["foundation_trial_page_limit_exceeded", "TRIAL_PAGE_LIMIT_EXCEEDED"],
    ["foundation_trial_global_budget_exceeded", "TRIAL_CAPACITY_REACHED"],
    ["foundation_trial_not_active", "TRIAL_NOT_ACTIVE"],
  ])("maps fail-closed reservation guard %s", async (message, code) => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message }), { status: 400 })));
    await expect(reserveFoundationCompute(base)).resolves.toEqual({ ok: false, code });
  });

  it.each(["paid", "trial", "owner"] as const)("accepts a %s reservation receipt bound to the requested document", async (billingSource) => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      documentId: base.documentId,
      state: "reserved",
      expiresAt: "2026-08-29T12:10:00Z",
      reservedCredits: 12,
      maximumCredits: 18,
      billingSource,
      idempotentReplay: false,
    }), { status: 200 })));
    await expect(reserveFoundationCompute(base)).resolves.toMatchObject({ ok: true, result: { billingSource } });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("reserve_foundation_compute_v3"), expect.objectContaining({
      body: expect.stringContaining('"p_reserved_credits":12,"p_maximum_credits":18'),
    }));
  });

  /*
    Audit U06: a reload, a second tab and a dropped network must not charge twice.

    The reservation RPC is keyed on (workspace, document), so a second attempt is a replay of
    the first rather than a second reservation -- and the receipt says which it was. These hold
    the three outcomes a duplicated request can have: a replay passed through as a replay, a
    conflict refused rather than silently re-reserved, and a settlement that arrives twice
    because delivery is at-least-once.
  */
  it("passes an idempotent replay through as a replay rather than a second reservation", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      documentId: base.documentId,
      state: "reserved",
      expiresAt: "2026-08-29T12:10:00Z",
      reservedCredits: 12,
      maximumCredits: 18,
      billingSource: "paid",
      idempotentReplay: true,
    }), { status: 200 })));
    await expect(reserveFoundationCompute(base)).resolves.toMatchObject({
      ok: true,
      result: { reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", idempotentReplay: true },
    });
  });

  it("refuses an idempotency conflict with its own code instead of reserving again", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: "foundation_compute_idempotency_conflict" }), { status: 409 },
    )));
    await expect(reserveFoundationCompute(base)).resolves.toEqual({ ok: false, code: "COMPUTE_IDEMPOTENCY_CONFLICT" });
  });

  it("accepts a duplicate settlement, which is what at-least-once delivery produces", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "duplicate",
      reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      state: "settled",
      settledCredits: 12,
      billingSource: "paid",
    }), { status: 200 })));
    await expect(settleFoundationCompute({
      workspaceKey: base.workspaceKey,
      documentId: base.documentId,
      outcome: "settled",
      actualCredits: 12,
      reasonCode: "OCR_COMPLETED",
    })).resolves.toMatchObject({ ok: true, result: { status: "duplicate" } });
  });

  it("refuses a settlement receipt that claims neither processed nor duplicate", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "charged_again",
      reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    }), { status: 200 })));
    await expect(settleFoundationCompute({
      workspaceKey: base.workspaceKey,
      documentId: base.documentId,
      outcome: "settled",
      actualCredits: 12,
      reasonCode: "OCR_COMPLETED",
    })).resolves.toEqual({ ok: false, code: "COMPUTE_SETTLEMENT_RECEIPT_INVALID" });
  });

  it("accepts only an idempotent settlement receipt", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "processed",
      reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      state: "operator_review",
      settledCredits: 2,
      billingSource: "trial",
    }), { status: 200 })));
    await expect(settleFoundationCompute({
      workspaceKey: base.workspaceKey,
      documentId: base.documentId,
      outcome: "operator_review",
      actualCredits: 12,
      reasonCode: "OCR_TIMEOUT_OR_NETWORK",
    })).resolves.toMatchObject({ ok: true });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("settle_foundation_compute_v3"), expect.any(Object));
  });
});
