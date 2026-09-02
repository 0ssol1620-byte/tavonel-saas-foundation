import { describe, expect, it } from "vitest";
import { findOfferByPriceId, readConfiguredBillingOffers, readPaddleBrowserConfig } from "./billing-catalog";

describe("Foundation billing catalog", () => {
  it("exposes only configured Paddle price IDs and preserves prepaid economics", () => {
    const env = {
      PADDLE_PRICE_CREDIT_STARTER: `pri_${"a".repeat(26)}`,
      PADDLE_PRICE_CREDIT_BUILDER: "not-a-price",
    };
    const offers = readConfiguredBillingOffers(env);
    expect(offers.size).toBe(1);
    expect(offers.get("credit_starter")).toMatchObject({ priceUsd: 12, credits: 100, kind: "prepaid" });
    expect(findOfferByPriceId(`pri_${"a".repeat(26)}`, env)?.code).toBe("credit_starter");
  });

  it("fails closed when a browser token does not match the Paddle environment", () => {
    expect(readPaddleBrowserConfig({ PADDLE_SANDBOX: "true", NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "live_wrong" })).toBeNull();
    const token = `test_${"b".repeat(24)}`;
    expect(readPaddleBrowserConfig({ PADDLE_SANDBOX: "true", NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: token })).toEqual({
      environment: "sandbox",
      clientToken: token,
    });
  });
});
