import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(() => true),
  parse: vi.fn(),
  apply: vi.fn(),
  quarantine: vi.fn(),
  funnel: vi.fn(),
}));

vi.mock("@/lib/paddle-webhook", () => ({ verifyPaddleSignature: mocks.verify }));
vi.mock("@/lib/paddle-billing-event", () => ({ parsePaddleBillingAction: mocks.parse }));
vi.mock("@/lib/billing-store", () => ({
  applyFoundationBillingAction: mocks.apply,
  quarantineFoundationBillingEnvelope: mocks.quarantine,
}));
vi.mock("@/lib/funnel-events", () => ({ recordServerFunnel: mocks.funnel }));

const { POST } = await import("../app/api/paddle/webhook/route");
const eventId = `evt_${"a".repeat(26)}`;
const request = () => new Request("https://tavonel.com/api/paddle/webhook", {
  method: "POST", body: "{}", headers: { "paddle-signature": "signed" },
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("PADDLE_WEBHOOK_SECRET", "test-secret");
  mocks.verify.mockReturnValue(true);
});
afterEach(() => vi.unstubAllEnvs());

describe("Paddle webhook acknowledgement", () => {
  it("requests redelivery when a subscription lifecycle event precedes checkout bootstrap", async () => {
    mocks.parse.mockReturnValue({ action: "subscription", eventId, eventType: "subscription.canceled" });
    mocks.apply.mockResolvedValue({ ok: true, result: {
      status: "binding_rejected", reason: "checkout_binding_bootstrap_event_invalid",
    } });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "EVENT_DEPENDENCY_PENDING", eventId });
  });

  it("acknowledges a paid rejection only after the ledger has quarantined it", async () => {
    mocks.parse.mockReturnValue({ action: "allowance", eventId, eventType: "transaction.completed" });
    mocks.apply.mockResolvedValue({ ok: true, result: {
      status: "binding_rejected", reason: "checkout_intent_missing",
    } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ code: "EVENT_QUARANTINED", eventId });
  });

  it("does not acknowledge an unmappable paid event until its quarantine write succeeds", async () => {
    mocks.parse.mockReturnValue({ action: "ignored", eventId, eventType: "transaction.completed", reason: "binding_invalid" });
    mocks.quarantine.mockResolvedValueOnce({ ok: false, code: "BILLING_QUARANTINE_FAILED" })
      .mockResolvedValueOnce({ ok: true });
    expect((await POST(request())).status).toBe(503);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ code: "EVENT_QUARANTINED", eventId });
    expect(mocks.quarantine).toHaveBeenCalledTimes(2);
  });

  it("counts only an applied activation, not a stale upgrade awaiting replay", async () => {
    mocks.parse.mockReturnValue({ action: "subscription", eventId, eventType: "subscription.activated", offerCode: "studio_access" });
    mocks.apply.mockResolvedValueOnce({ ok: true, result: { status: "stale_or_mismatched_subscription" } })
      .mockResolvedValueOnce({ ok: true, result: { status: "processed_subscription_upgrade" } });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.funnel).not.toHaveBeenCalled();
    expect((await POST(request())).status).toBe(200);
    expect(mocks.funnel).toHaveBeenCalledOnce();
  });

  it("does not count a duplicate Paddle activation as a new subscription", async () => {
    mocks.parse.mockReturnValue({ action: "subscription", eventId, eventType: "subscription.activated", offerCode: "studio_access" });
    mocks.apply.mockResolvedValue({ ok: true, result: { status: "duplicate" } });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.funnel).not.toHaveBeenCalled();
  });
});
