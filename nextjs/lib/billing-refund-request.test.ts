import { beforeEach, describe, expect, it, vi } from "vitest";

const { user, account, payment, subscription, deliver } = vi.hoisted(() => ({
  payment: vi.fn(),
  user: vi.fn(),
  account: vi.fn(),
  subscription: vi.fn(),
  deliver: vi.fn(),
}));

vi.mock("@/lib/foundation-pilot", () => ({
  getRequestUser: user,
  foundationPilotAccess: () => ({ membership: { workspaceId: "pilot-11111111" } }),
}));
vi.mock("@/lib/workspace-membership", () => ({
  getWorkspaceMembership: async () => ({ ok: true, membership: { state: "active", role: "owner" } }),
}));
vi.mock("@/lib/billing-store", () => ({ getFoundationBillingAccount: account, getLatestSubscriptionPayment: payment }));
vi.mock("@/lib/paddle-api", () => ({ getPaddleSubscription: subscription }));
vi.mock("@/lib/operations-p0", () => ({ deliverOperationsAlert: deliver }));

import { GET, POST } from "../app/api/billing/refund-request/route";

const SUB = `sub_${"a".repeat(26)}`;
const PAID_AT = "2026-11-08T09:00:00.000Z";
const paidAccount = {
  accessPlan: "observer_access", creditBalance: 2_000, paddleCustomerId: `ctm_${"b".repeat(26)}`, paddleSubscriptionId: SUB,
};
const request = (method: "GET" | "POST", site?: string) => new Request("https://tavonel.test/api/billing/refund-request", {
  method, headers: { authorization: "Bearer t", ...(site ? { "sec-fetch-site": site } : {}) },
});

describe("refund request route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    user.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" });
    account.mockResolvedValue({ ok: true, account: paidAccount });
    subscription.mockResolvedValue({ ok: true, subscription: {
      currentPeriodStartsAt: "2026-11-01T00:00:00.000Z",
      nextBilledAt: "2026-12-08T00:00:00.000Z",
    } });
    payment.mockResolvedValue({ ok: true, paidAt: PAID_AT });
    deliver.mockResolvedValue({ ok: true, code: "ALERT_DELIVERED", dedupeKey: "k" });
  });

  it("states the renewal and the recorded payment, never the period start or a verdict, and sends nothing on a read", async () => {
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.facts).toEqual({
      plan: "Starter", paidAt: PAID_AT, renewsAt: "2026-12-08T00:00:00.000Z",
      windowEndsAt: "2026-11-22T09:00:00.000Z", allowancePages: 50,
    });
    expect(payment).toHaveBeenCalledWith("pilot-11111111", "11111111-1111-4111-8111-111111111111");
    expect(subscription).toHaveBeenCalledWith(SUB);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("pages an operator with identifiers only and never touches Paddle beyond the read", async () => {
    const response = await POST(request("POST", "same-origin"));
    expect(response.status).toBe(202);
    expect((await response.json()).code).toBe("REFUND_REQUEST_SENT");
    expect(deliver).toHaveBeenCalledTimes(1);
    const alert = deliver.mock.calls[0]![0];
    expect(alert).toMatchObject({ kind: "incident", severity: "warning", service: "billing" });
    expect(alert.summary).toContain("pilot-11111111");
    expect(alert.summary).toContain(SUB);
    expect(alert.summary).toContain("latest payment 2026-11-08");
    expect(alert.summary).not.toMatch(/rule met|eligible/);
    expect(alert.summary.length).toBeLessThanOrEqual(240);
  });

  it("still sends a request, and says unread when the payment or Paddle could not be read", async () => {
    subscription.mockResolvedValue({ ok: false, code: "PADDLE_SUBSCRIPTION_READ_FAILED" });
    payment.mockResolvedValue({ ok: false, code: "BILLING_STORE_READ_FAILED" });
    const response = await POST(request("POST"));
    expect(response.status).toBe(202);
    expect(deliver.mock.calls[0]![0].summary).toContain("latest payment unread");
    const read = await (await GET(request("GET"))).json();
    expect(read.facts).toMatchObject({ paidAt: null, windowEndsAt: null, renewsAt: null });
  });

  it("says undelivered, never sent, when the alert receiver did not take it", async () => {
    deliver.mockResolvedValue({ ok: false, code: "ALERT_RECEIVER_UNCONFIGURED", dedupeKey: "k" });
    const response = await POST(request("POST"));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("REFUND_REQUEST_UNDELIVERED");
  });

  it("refuses without a session, across sites, and where there is no paid plan", async () => {
    user.mockResolvedValueOnce(null);
    expect((await POST(request("POST"))).status).toBe(401);
    expect((await POST(request("POST", "cross-site"))).status).toBe(403);
    account.mockResolvedValue({ ok: true, account: { ...paidAccount, paddleSubscriptionId: null } });
    expect((await GET(request("GET"))).status).toBe(409);
    expect((await POST(request("POST"))).status).toBe(409);
    expect(deliver).not.toHaveBeenCalled();
  });
});
