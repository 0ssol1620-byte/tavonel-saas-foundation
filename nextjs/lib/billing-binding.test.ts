import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CHECKOUT_BINDING_MAX_AGE_MS,
  CHECKOUT_BINDING_POLICY_VERSION,
  authenticateCheckoutBinding,
  createCheckoutBinding,
  verifyCheckoutBinding,
} from "./billing-binding";

describe("Foundation billing checkout binding", () => {
  it("binds a Paddle checkout to one authenticated user, workspace and offer", () => {
    const secret = "billing-test-secret-that-is-at-least-32-characters";
    const binding = createCheckoutBinding({
      userId: "969dc192-daa2-4119-969d-c192daa24119",
      workspaceId: "pilot-969dc192daa24119",
      offerCode: "observer_access",
    }, secret);

    expect(verifyCheckoutBinding(binding, secret)).toEqual(binding);
    expect(binding.tavonel_policy_version).toBe(CHECKOUT_BINDING_POLICY_VERSION);
    expect(verifyCheckoutBinding({ ...binding, tavonel_offer_code: "studio_access" }, secret)).toBeNull();
    expect(verifyCheckoutBinding({ ...binding, tavonel_policy_version: "checkout-v2" }, secret)).toBeNull();
    expect(verifyCheckoutBinding(binding, "wrong-secret-that-is-still-long-enough-000")).toBeNull();
  });

  it("expires current bindings and authenticates pre-migration v2 metadata only as legacy", () => {
    const secret = "billing-test-secret-that-is-at-least-32-characters";
    const issuedAt = new Date("2026-09-20T10:00:00.000Z");
    const binding = createCheckoutBinding({
      userId: "969dc192-daa2-4119-969d-c192daa24119",
      workspaceId: "pilot-969dc192daa24119",
      offerCode: "observer_access",
    }, secret, issuedAt);

    expect(verifyCheckoutBinding(binding, secret, new Date(issuedAt.getTime() + CHECKOUT_BINDING_MAX_AGE_MS))).toEqual(binding);
    expect(verifyCheckoutBinding(binding, secret, new Date(issuedAt.getTime() + CHECKOUT_BINDING_MAX_AGE_MS + 1))).toBeNull();
    const legacyUnsigned = {
      tavonel_binding_version: "v2",
      tavonel_user_id: binding.tavonel_user_id,
      tavonel_workspace_id: binding.tavonel_workspace_id,
      tavonel_offer_code: binding.tavonel_offer_code,
      tavonel_nonce: randomUUID(),
      tavonel_issued_at: issuedAt.toISOString(),
    };
    const legacy = {
      ...legacyUnsigned,
      tavonel_binding: createHmac("sha256", secret)
        .update(Object.values(legacyUnsigned).join("\0"), "utf8")
        .digest("hex"),
    };
    expect(authenticateCheckoutBinding(legacy, secret)).toMatchObject({
      tavonel_binding_version: "v2",
      tavonel_policy_version: "legacy-v2",
    });
    expect(verifyCheckoutBinding(legacy, secret, issuedAt)).toBeNull();

    expect(authenticateCheckoutBinding(binding, secret)).toEqual(binding);
    expect(verifyCheckoutBinding(binding, secret, new Date(issuedAt.getTime() - 1))).toBeNull();
  });
});
