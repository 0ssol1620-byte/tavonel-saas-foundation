import { describe, expect, it } from "vitest";
import { CHECKOUT_BINDING_MAX_AGE_MS, createCheckoutBinding, verifyCheckoutBinding } from "./billing-binding";

describe("Foundation billing checkout binding", () => {
  it("binds a Paddle checkout to one authenticated user, workspace and offer", () => {
    const secret = "billing-test-secret-that-is-at-least-32-characters";
    const binding = createCheckoutBinding({
      userId: "969dc192-daa2-4119-969d-c192daa24119",
      workspaceId: "pilot-969dc192daa24119",
      offerCode: "observer_access",
    }, secret);

    expect(verifyCheckoutBinding(binding, secret)).toEqual(binding);
    expect(verifyCheckoutBinding({ ...binding, tavonel_offer_code: "studio_access" }, secret)).toBeNull();
    expect(verifyCheckoutBinding(binding, "wrong-secret-that-is-still-long-enough-000")).toBeNull();
  });

  it("expires bindings and rejects legacy bindings without an authenticated issuance time", () => {
    const secret = "billing-test-secret-that-is-at-least-32-characters";
    const issuedAt = new Date("2026-09-20T10:00:00.000Z");
    const binding = createCheckoutBinding({
      userId: "969dc192-daa2-4119-969d-c192daa24119",
      workspaceId: "pilot-969dc192daa24119",
      offerCode: "observer_access",
    }, secret, issuedAt);

    expect(verifyCheckoutBinding(binding, secret, new Date(issuedAt.getTime() + CHECKOUT_BINDING_MAX_AGE_MS))).toEqual(binding);
    expect(verifyCheckoutBinding(binding, secret, new Date(issuedAt.getTime() + CHECKOUT_BINDING_MAX_AGE_MS + 1))).toBeNull();
    expect(verifyCheckoutBinding({
      ...binding,
      tavonel_binding_version: "v1",
      tavonel_issued_at: undefined,
    }, secret, issuedAt)).toBeNull();
  });
});
