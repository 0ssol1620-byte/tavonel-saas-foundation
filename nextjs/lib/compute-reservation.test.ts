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
  ])("maps fail-closed reservation guard %s", async (message, code) => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message }), { status: 400 })));
    await expect(reserveFoundationCompute(base)).resolves.toEqual({ ok: false, code });
  });

  it("accepts a reservation receipt bound to the requested document", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      documentId: base.documentId,
      state: "reserved",
      expiresAt: "2026-08-29T12:10:00Z",
      reservedCredits: 18,
      idempotentReplay: false,
    }), { status: 200 })));
    await expect(reserveFoundationCompute(base)).resolves.toMatchObject({ ok: true });
  });

  it("accepts only an idempotent settlement receipt", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "processed",
      reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      state: "operator_review",
      settledCredits: 2,
    }), { status: 200 })));
    await expect(settleFoundationCompute({
      workspaceKey: base.workspaceKey,
      documentId: base.documentId,
      outcome: "operator_review",
      actualCredits: 12,
      reasonCode: "OCR_TIMEOUT_OR_NETWORK",
    })).resolves.toMatchObject({ ok: true });
  });
});
