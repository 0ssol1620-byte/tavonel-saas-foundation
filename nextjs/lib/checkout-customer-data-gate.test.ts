import { beforeEach, describe, expect, it, vi } from "vitest";

const { gate, intent, commercial, binding } = vi.hoisted(() => ({
  gate: vi.fn(),
  intent: vi.fn(),
  commercial: vi.fn(),
  binding: vi.fn(),
}));

vi.mock("@/lib/account-grants", () => ({
  getFoundationAccountGrant: async () => ({ ok: true, grant: null }),
}));
vi.mock("@/lib/billing-binding", () => ({ createCheckoutBinding: binding }));
vi.mock("@/lib/billing-catalog", async (original) => ({
  ...(await original<typeof import("./billing-catalog")>()),
  readConfiguredBillingOffers: () => new Map([["observer_access", {
    code: "observer_access", kind: "subscription", label: "Developer",
    saleChannel: "self_serve", priceId: `pri_${"a".repeat(26)}`, credits: 2_000,
  }]]),
  readPaddleBrowserConfig: () => commercial().provider === "sandbox"
    ? { environment: "sandbox", clientToken: `test_${"a".repeat(30)}` }
    : { environment: "production", clientToken: `live_${"a".repeat(30)}` },
}));
vi.mock("@/lib/billing-store", () => ({ issueFoundationCheckoutIntent: intent }));
vi.mock("@/lib/commercial-state", () => ({ readCommercialState: commercial }));
vi.mock("@/lib/customer-data-admission", () => ({ canAdmitCustomerSource: gate }));
vi.mock("@/lib/foundation-pilot", () => ({
  getRequestUser: async () => ({ id: "11111111-1111-4111-8111-111111111111", email: "buyer@example.test" }),
  foundationPilotAccess: () => ({ membership: { workspaceId: "pilot-11111111" } }),
}));
vi.mock("@/lib/public-status", () => ({
  readPublicStatusV2: () => ({ availableActions: { purchasePlan: { enabled: true } } }),
}));

import { POST } from "../app/api/billing/checkout/route";

function request() {
  const body = JSON.stringify({ offerCode: "observer_access" });
  return new Request("https://tavonel.test/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) },
    body,
  });
}

describe("live checkout requires the buyer's document-processing receipt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("FOUNDATION_BILLING_HMAC", "h".repeat(32));
    commercial.mockReturnValue({ provider: "production", checkoutEnabled: true, liveChargesEnabled: true });
    binding.mockReturnValue({ tavonel_nonce: "nonce" });
    intent.mockResolvedValue({ ok: true });
  });

  it("refuses to create a live payment intent when this workspace cannot compile", async () => {
    gate.mockResolvedValue(false);
    const response = await POST(request());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ code: "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE" });
    expect(gate).toHaveBeenCalledWith("pilot-11111111", "direct_upload");
    expect(binding).not.toHaveBeenCalled();
    expect(intent).not.toHaveBeenCalled();
  });

  it("creates the checkout intent after an exact-workspace approval", async () => {
    gate.mockResolvedValue(true);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(intent).toHaveBeenCalledOnce();
  });

  it("keeps the existing sandbox billing qualification independent of customer-data approval", async () => {
    commercial.mockReturnValue({ provider: "sandbox", checkoutEnabled: true, liveChargesEnabled: false });
    gate.mockResolvedValue(false);
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ environment: "sandbox" });
    expect(gate).not.toHaveBeenCalled();
    expect(intent).toHaveBeenCalledOnce();
  });
});
