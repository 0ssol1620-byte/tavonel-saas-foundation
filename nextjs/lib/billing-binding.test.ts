import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHECKOUT_BINDING_MAX_AGE_MS,
  CHECKOUT_BINDING_POLICY_VERSION,
  authenticateCheckoutBinding,
  createCheckoutBinding,
  previousBillingHmac,
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

// U5 (journey map §8.3, A6): the previous key of a FOUNDATION_BILLING_HMAC rotation only verifies.
describe("billing binding key rotation", () => {
  const OLD = "billing-old-secret-that-is-at-least-32-characters";
  const CURRENT = "billing-new-secret-that-is-at-least-32-characters";
  const input = {
    userId: "969dc192-daa2-4119-969d-c192daa24119",
    workspaceId: "pilot-969dc192daa24119",
    offerCode: "observer_access",
  } as const;
  const sign = (b: ReturnType<typeof createCheckoutBinding>, key: string) => createHmac("sha256", key)
    .update([b.tavonel_binding_version, b.tavonel_user_id, b.tavonel_workspace_id, b.tavonel_offer_code,
      b.tavonel_nonce, b.tavonel_issued_at, b.tavonel_policy_version].join("\0"), "utf8")
    .digest("hex");

  it("authenticates metadata signed under the replaced key only while it is configured as previous", () => {
    const bound = createCheckoutBinding(input, OLD);
    expect(authenticateCheckoutBinding(bound, CURRENT)).toBeNull();
    expect(authenticateCheckoutBinding(bound, CURRENT, undefined)).toBeNull();
    expect(authenticateCheckoutBinding(bound, CURRENT, OLD)).toEqual(bound);
    expect(authenticateCheckoutBinding(bound, CURRENT, "another-secret-that-is-at-least-32-characters")).toBeNull();
    // A tampered binding fails under both keys.
    expect(authenticateCheckoutBinding({ ...bound, tavonel_offer_code: "studio_access" }, CURRENT, OLD)).toBeNull();
    // The current key's own result is unchanged by a configured previous key.
    const fresh = createCheckoutBinding(input, CURRENT);
    expect(authenticateCheckoutBinding(fresh, CURRENT, OLD)).toEqual(fresh);
  });

  it("never lets the previous key stand in for a missing or unqualified current key", () => {
    const bound = createCheckoutBinding(input, OLD);
    expect(authenticateCheckoutBinding(bound, undefined, OLD)).toBeNull();
    expect(authenticateCheckoutBinding(bound, "", OLD)).toBeNull();
    expect(authenticateCheckoutBinding(bound, "short", OLD)).toBeNull();
    // An unqualified previous key is not configured, even when it is the key that signed.
    const shortKey = "s".repeat(31);
    expect(authenticateCheckoutBinding({ ...bound, tavonel_binding: sign(bound, shortKey) }, CURRENT, shortKey)).toBeNull();
  });

  it("signs only with the current key: a binding issued during a rotation fails under the previous key", () => {
    const issued = createCheckoutBinding(input, CURRENT);
    expect(issued.tavonel_binding).toBe(sign(issued, CURRENT));
    expect(authenticateCheckoutBinding(issued, OLD)).toBeNull();
    // The checkout route is the only signer of bindings; it never reads the previous key.
    const checkoutRoute = readFileSync(resolve(import.meta.dirname, "../app/api/billing/checkout/route.ts"), "utf8");
    expect(checkoutRoute).toContain("createCheckoutBinding(");
    expect(checkoutRoute).not.toMatch(/PREVIOUS|previousBillingHmac/);
  });

  it("reads the previous key trimmed, and treats absent, blank or short values as not configured", () => {
    expect(previousBillingHmac({})).toBeUndefined();
    expect(previousBillingHmac({ FOUNDATION_BILLING_HMAC_PREVIOUS: "" })).toBeUndefined();
    expect(previousBillingHmac({ FOUNDATION_BILLING_HMAC_PREVIOUS: "   " })).toBeUndefined();
    expect(previousBillingHmac({ FOUNDATION_BILLING_HMAC_PREVIOUS: "p".repeat(31) })).toBeUndefined();
    expect(previousBillingHmac({ FOUNDATION_BILLING_HMAC_PREVIOUS: ` ${OLD}\n` })).toBe(OLD);
    // The current key is never read as the previous one.
    expect(previousBillingHmac({ FOUNDATION_BILLING_HMAC: CURRENT })).toBeUndefined();
  });
});
