import { describe, expect, it } from "vitest";
import { findOfferByPriceId, readConfiguredBillingOffers, readPaddleBrowserConfig } from "./billing-catalog";

describe("Foundation billing catalog", () => {
  it("exposes only configured recurring plans and ignores retired prepaid price IDs", () => {
    const env = {
      PADDLE_PRICE_CREDIT_STARTER: `pri_${"a".repeat(26)}`,
      PADDLE_PRICE_OBSERVER_ACCESS: `pri_${"b".repeat(26)}`,
    };
    const offers = readConfiguredBillingOffers(env);
    expect(offers.size).toBe(1);
    expect(offers.get("observer_access")).toMatchObject({ priceUsd: 29, credits: 2_000, kind: "subscription" });
    expect(findOfferByPriceId(`pri_${"a".repeat(26)}`, env)).toBeNull();
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
