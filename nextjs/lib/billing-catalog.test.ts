import { describe, expect, it } from "vitest";
import {
  BILLING_OFFERS,
  DELIVERED,
  METER_RATES_USD,
  PRICE_BOOK_EXTRA,
  PRICE_BOOK_VERSION,
  catalogConfigured,
  findOfferByPriceId,
  planAvailability,
  readConfiguredBillingOffers,
  readPaddleBrowserConfig,
  type BillingOfferCode,
  type Capability,
} from "./billing-catalog";
import { decideOfferCheckoutPolicy } from "./checkout-policy";
import { STANDARD_UNITS_PER_PAGE } from "./usage-pricing";

const V2 = ["personal", "developer", "team", "business"] as const;
const RETIRED = ["observer_access", "studio_access"] as const;
const id = (c: string) => `pri_${c.repeat(26)}`;
const ALL: Capability[] = [
  "pcu_accepted_meter", "kqu_meter", "storage_meter", "seat_cap", "per_member_source_scopes", "org_policy_audit",
];
const allEnv = {
  PADDLE_PRICE_PERSONAL: id("p"),
  PADDLE_PRICE_DEVELOPER: id("d"),
  PADDLE_PRICE_TEAM: id("t"),
  PADDLE_PRICE_BUSINESS: id("b"),
  PADDLE_PRICE_OBSERVER_ACCESS: id("o"),
  PADDLE_PRICE_STUDIO_ACCESS: id("s"),
};

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

describe("price book PB-2026-11-V22", () => {
  it("pins the version and the four plans' price and allowances", () => {
    expect(PRICE_BOOK_VERSION).toBe("PB-2026-11-V22");
    const table = V2.map((c) => [c, BILLING_OFFERS[c].priceUsd, ...Object.values(BILLING_OFFERS[c].included)]);
    expect(table).toEqual([
      ["personal", 29, 500, 1_000, 10, 1],
      ["developer", 49, 500, 5_000, 10, 1],
      ["team", 199, 3_000, 10_000, 100, 5],
      ["business", 799, 12_000, 50_000, 500, 20],
    ]);
    expect(METER_RATES_USD).toEqual({ pcu: 0.04, kqu: 0.006, storageGbMonth: 0.2, seatMonth: 15 });
    expect(Object.keys(PRICE_BOOK_EXTRA)).toEqual(["free", "enterprise"]);
  });

  it("derives credits and included pages from PCU, so the ledger needs no change", () => {
    for (const code of V2) {
      const offer = BILLING_OFFERS[code];
      expect(offer.credits, code).toBe(offer.included.pcu * STANDARD_UNITS_PER_PAGE);
      expect(offer.includedPages, code).toBe(offer.included.pcu);
      expect(offer.kind).toBe("subscription");
    }
  });

  it("keeps the retired plans' codes, price, credits and env exactly as they were sold", () => {
    expect(BILLING_OFFERS.observer_access).toMatchObject({
      priceUsd: 29, credits: 2_000, includedPages: 500, priceEnv: "PADDLE_PRICE_OBSERVER_ACCESS", status: "retired", included: null,
    });
    expect(BILLING_OFFERS.studio_access).toMatchObject({
      priceUsd: 99, credits: 10_000, includedPages: 2_500, priceEnv: "PADDLE_PRICE_STUDIO_ACCESS", status: "retired", included: null,
    });
  });

  it("gives every code its own env and its own access level", () => {
    const envs = Object.values(BILLING_OFFERS).map((o) => o.priceEnv);
    expect(new Set(envs).size).toBe(envs.length);
    for (const code of V2) expect(BILLING_OFFERS[code].status).toBe("v2");
    expect(V2.map((c) => BILLING_OFFERS[c].accessLevel)).toEqual([
      "observer_access", "observer_access", "studio_access", "studio_access",
    ]);
  });
});

describe("planAvailability: the one gate every surface reads", () => {
  it("is request_access for all four v2 offers while DELIVERED is empty, with every env set", () => {
    expect(DELIVERED.size).toBe(0);
    const configured = readConfiguredBillingOffers(allEnv);
    expect(configured.size).toBe(6);
    for (const code of V2) expect(planAvailability(code, configured), code).toBe("request_access");
  });

  it("is purchasable only with every capability on the line delivered and a valid pri_ id", () => {
    const configured = readConfiguredBillingOffers(allEnv);
    for (const code of V2) expect(planAvailability(code, configured, new Set(ALL)), code).toBe("purchasable");
    // Failure paths: a missing or malformed env, or one missing capability.
    for (const env of [{}, { PADDLE_PRICE_PERSONAL: "" }, { PADDLE_PRICE_PERSONAL: "pri_short" }, { PADDLE_PRICE_PERSONAL: `${id("p")}x` }]) {
      expect(planAvailability("personal", readConfiguredBillingOffers(env), new Set(ALL))).toBe("request_access");
    }
    const withoutSeats = new Set(ALL.filter((c) => c !== "seat_cap"));
    expect(planAvailability("personal", configured, withoutSeats)).toBe("request_access");
    // Personal does not wait for what only Team needs.
    const personalLine = new Set<Capability>(["pcu_accepted_meter", "kqu_meter", "storage_meter", "seat_cap"]);
    expect(planAvailability("personal", configured, personalLine)).toBe("purchasable");
    expect(planAvailability("team", configured, personalLine)).toBe("request_access");
    expect(planAvailability("business", configured, new Set(ALL.filter((c) => c !== "org_policy_audit")))).toBe("request_access");
  });

  it("keeps retired offers retired, resolvable by price id, and refused by the checkout policy", () => {
    const configured = readConfiguredBillingOffers(allEnv);
    for (const code of RETIRED) {
      const availability = planAvailability(code, configured, new Set(ALL));
      expect(availability, code).toBe("retired");
      expect(decideOfferCheckoutPolicy({ code, saleChannel: BILLING_OFFERS[code].saleChannel }, availability)).toEqual({
        allowed: false,
        code: "BILLING_OFFER_CONTACT_REQUIRED",
      });
    }
    expect(findOfferByPriceId(id("o"), allEnv)).toMatchObject({ code: "observer_access", priceUsd: 29 });
    expect(findOfferByPriceId(id("s"), allEnv)).toMatchObject({ code: "studio_access", priceUsd: 99 });
  });

  it("drops a v2 offer pointed at a retired offer's price and keeps the retired one", () => {
    const env = { PADDLE_PRICE_OBSERVER_ACCESS: id("o"), PADDLE_PRICE_PERSONAL: id("o") };
    const offers = readConfiguredBillingOffers(env);
    expect([...offers.keys()]).toEqual(["observer_access"]);
    expect(findOfferByPriceId(id("o"), env)?.code).toBe("observer_access");
    expect(planAvailability("personal", offers, new Set(ALL))).toBe("request_access");
  });

  it("configures neither of two v2 offers that share one price id", () => {
    const env = { PADDLE_PRICE_PERSONAL: id("x"), PADDLE_PRICE_DEVELOPER: id("x"), PADDLE_PRICE_TEAM: id("t") };
    expect([...readConfiguredBillingOffers(env).keys()]).toEqual(["team"]);
    expect(findOfferByPriceId(id("x"), env)).toBeNull();
  });
});

describe("catalogConfigured: readiness of the price configuration", () => {
  const without = (...drop: string[]) => Object.fromEntries(Object.entries(allEnv).filter(([k]) => !drop.includes(k)));

  it("is true when only undelivered v2 envs are missing", () => {
    expect(catalogConfigured(readConfiguredBillingOffers(allEnv))).toBe(true);
    expect(catalogConfigured(readConfiguredBillingOffers(without("PADDLE_PRICE_PERSONAL", "PADDLE_PRICE_TEAM")))).toBe(true);
    expect(catalogConfigured(readConfiguredBillingOffers({
      PADDLE_PRICE_OBSERVER_ACCESS: id("o"), PADDLE_PRICE_STUDIO_ACCESS: id("s"),
    }))).toBe(true);
  });

  it("is false when a retired env is missing: a renewal could not resolve", () => {
    expect(catalogConfigured(readConfiguredBillingOffers(without("PADDLE_PRICE_OBSERVER_ACCESS")))).toBe(false);
    expect(catalogConfigured(readConfiguredBillingOffers(without("PADDLE_PRICE_STUDIO_ACCESS")))).toBe(false);
    expect(catalogConfigured(readConfiguredBillingOffers({}))).toBe(false);
  });

  it("is false when an offer that would be purchasable has no price", () => {
    const configured = readConfiguredBillingOffers(without("PADDLE_PRICE_PERSONAL"));
    expect(catalogConfigured(configured, new Set(ALL))).toBe(false);
    expect(catalogConfigured(configured, new Set<Capability>())).toBe(true);
  });
});

it("holds exactly the four v2 codes and the two retired ones", () => {
  const codes: BillingOfferCode[] = [...V2, ...RETIRED];
  expect(Object.keys(BILLING_OFFERS).sort()).toEqual([...codes].sort());
});
