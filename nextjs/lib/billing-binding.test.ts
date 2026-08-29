import { describe, expect, it } from "vitest";
import { createCheckoutBinding, verifyCheckoutBinding } from "./billing-binding";

describe("Foundation billing checkout binding", () => {
  it("binds a Paddle checkout to one authenticated user, workspace and offer", () => {
    const secret = "billing-test-secret-that-is-at-least-32-characters";
    const binding = createCheckoutBinding({
      userId: "969dc192-daa2-4119-969d-c192daa24119",
      workspaceId: "pilot-969dc192daa24119",
      offerCode: "credit_builder",
    }, secret);

    expect(verifyCheckoutBinding(binding, secret)).toEqual(binding);
    expect(verifyCheckoutBinding({ ...binding, tavonel_offer_code: "credit_scale" }, secret)).toBeNull();
    expect(verifyCheckoutBinding(binding, "wrong-secret-that-is-still-long-enough-000")).toBeNull();
  });
});
