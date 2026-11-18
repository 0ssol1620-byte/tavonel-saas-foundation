import { existsSync, readFileSync } from "node:fs";
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
  priceConfigurationProblems,
  readConfiguredBillingOffers,
  readPaddleBrowserConfig,
  type BillingOfferCode,
  type Capability,
} from "./billing-catalog";
import { decideOfferCheckoutPolicy } from "./checkout-policy";
import { REVENUE_PATHS, type RevenuePath } from "./revenue-paths";
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

/*
  WO-REL-1 (= WO-CAT-7). A capability is in DELIVERED only beside the tests that prove the delivered behaviour. Each
  proof below passed independent review in its own work order (ledger: WO-D27-4 L549, WO-CAT-4/5/6 L887-889, WO-CAT-8
  L925); this pins the set to them, so a capability added without a proof, or a proof file that disappears, fails here.
*/
const PROOFS: Partial<Record<Capability, Array<[path: string, mustContain: string]>>> = {
  pcu_accepted_meter: [
    ["../../supabase/tests/foundation_page_meter.sql", "a compile that produced nothing gives its pages back"],
    ["./page-meter.test.ts", "refuses a settled read with no page count before calling the ledger"],
  ],
  kqu_meter: [
    ["../../supabase/tests/knowledge_query_units.sql", "the 1,001st refused with nothing written"],
    ["./kqu-meter.test.ts", "answers the 1,000th question and refuses the 1,001st with 402 before any retrieval"],
  ],
  storage_meter: [
    ["../../supabase/tests/workspace_storage_allowance.sql", "the storage allowance at intake admission"],
    ["./intake-admission.test.ts", "sends every v2 plan's storage allowance in bytes and none for a retired plan"],
  ],
  seat_cap: [
    ["../../supabase/tests/workspace_seat_allowance.sql", "stay at or under the plan's seat limit"],
    ["./workspace-membership.test.ts", "maps a full workspace to 402 WORKSPACE_SEAT_LIMIT_REACHED on invite and on accept"],
  ],
};

describe("DELIVERED: what the release proves", () => {
  it("is exactly the four capabilities on the Personal and Developer line, each with its proof on disk", () => {
    expect([...DELIVERED].sort()).toEqual(Object.keys(PROOFS).sort());
    expect([...DELIVERED].sort()).toEqual(["kqu_meter", "pcu_accepted_meter", "seat_cap", "storage_meter"]);
    for (const [capability, proofs] of Object.entries(PROOFS)) {
      for (const [path, mustContain] of proofs!) {
        const file = new URL(path, import.meta.url);
        expect(existsSync(file), `${capability}: ${path}`).toBe(true);
        expect(readFileSync(file, "utf8"), `${capability}: ${path}`).toContain(mustContain);
      }
    }
    // Team and Business wait on what nothing delivers.
    expect(DELIVERED.has("per_member_source_scopes")).toBe(false);
    expect(DELIVERED.has("org_policy_audit")).toBe(false);
  });

  it("makes Personal and Developer purchasable with both V22 prices set, and Team and Business Request access", () => {
    const configured = readConfiguredBillingOffers(allEnv);
    expect(configured.size).toBe(6);
    expect(Object.fromEntries([...V2, ...RETIRED].map((code) => [code, planAvailability(code, configured)]))).toEqual({
      personal: "purchasable", developer: "purchasable", team: "request_access", business: "request_access",
      observer_access: "retired", studio_access: "retired",
    });
  });

  it("sells nothing with both V22 prices unset: every plan is Request access and checkout refuses each", () => {
    const configured = readConfiguredBillingOffers({ PADDLE_PRICE_OBSERVER_ACCESS: id("o"), PADDLE_PRICE_STUDIO_ACCESS: id("s") });
    for (const code of V2) {
      expect(planAvailability(code, configured), code).toBe("request_access");
      expect(decideOfferCheckoutPolicy({ code, saleChannel: BILLING_OFFERS[code].saleChannel }, planAvailability(code, configured)), code)
        .toEqual({ allowed: false, code: "BILLING_OFFER_CONTACT_REQUIRED" });
    }
    // A closed sale is a valid configuration, not an error.
    expect(priceConfigurationProblems({ PADDLE_PRICE_OBSERVER_ACCESS: id("o"), PADDLE_PRICE_STUDIO_ACCESS: id("s") })).toEqual([]);
  });

  it("removing any one capability reverts both plans to Request access", () => {
    const configured = readConfiguredBillingOffers(allEnv);
    for (const capability of DELIVERED) {
      const without = new Set([...DELIVERED].filter((c) => c !== capability));
      expect(V2.filter((code) => planAvailability(code, configured, without) === "purchasable"), capability).toEqual([]);
    }
  });
});

/*
  WO-REL-1 item 3. The sale opens whole or not at all: one of the two prices alone, or a value that is not a Paddle price
  id, opens nothing and is a configuration error /api/status and /status report (billing not configured).
*/
describe("a half-configured sale opens nothing and is reported", () => {
  const retired = { PADDLE_PRICE_OBSERVER_ACCESS: id("o"), PADDLE_PRICE_STUDIO_ACCESS: id("s") };
  const sold = (env: Record<string, string>) => V2.filter((code) => planAvailability(code, readConfiguredBillingOffers(env)) === "purchasable");

  it("opens neither plan with only one of the two prices set", () => {
    for (const only of ["PADDLE_PRICE_PERSONAL", "PADDLE_PRICE_DEVELOPER"]) {
      const env = { ...retired, [only]: id("p") };
      expect(sold(env), only).toEqual([]);
      const other = only === "PADDLE_PRICE_PERSONAL" ? "PADDLE_PRICE_DEVELOPER" : "PADDLE_PRICE_PERSONAL";
      expect(priceConfigurationProblems(env), only).toEqual([
        `${other}: required with ${only}; no plan is sold until the whole group is priced`,
      ]);
      expect(catalogConfigured(env), only).toBe(false);
    }
  });

  it("opens neither plan when a price is not a Paddle price id, and names the variable, never its value", () => {
    const malformed = ["pri_short", `${id("d")}x`, "PRI_" + "D".repeat(26), "price_123", " ", "null", "undefined", "NaN"];
    for (const value of malformed) {
      const env = { ...retired, PADDLE_PRICE_PERSONAL: id("p"), PADDLE_PRICE_DEVELOPER: value };
      expect(sold(env), JSON.stringify(value)).toEqual([]);
      const problems = priceConfigurationProblems(env);
      if (value.trim() === "") {
        // Whitespace is unset: the pair is then incomplete, which is still an error.
        expect(problems, "whitespace").toEqual([
          "PADDLE_PRICE_DEVELOPER: required with PADDLE_PRICE_PERSONAL; no plan is sold until the whole group is priced",
        ]);
      } else {
        expect(problems, value).toContain("PADDLE_PRICE_DEVELOPER: set, but not a usable Paddle price id");
        expect(problems.join("\n"), value).not.toContain(value);
      }
      expect(catalogConfigured(env), value).toBe(false);
    }
  });

  it("opens neither plan when both prices are the same id, or one is a retired plan's id", () => {
    for (const env of [
      { ...retired, PADDLE_PRICE_PERSONAL: id("x"), PADDLE_PRICE_DEVELOPER: id("x") },
      { ...retired, PADDLE_PRICE_PERSONAL: id("o"), PADDLE_PRICE_DEVELOPER: id("d") },
    ]) {
      expect(sold(env)).toEqual([]);
      expect(catalogConfigured(env)).toBe(false);
    }
  });

  it("opens both with both set (the control), and reports a malformed Team price without opening Team", () => {
    expect(sold({ ...retired, PADDLE_PRICE_PERSONAL: id("p"), PADDLE_PRICE_DEVELOPER: id("d") })).toEqual(["personal", "developer"]);
    expect(catalogConfigured({ ...retired, PADDLE_PRICE_PERSONAL: id("p"), PADDLE_PRICE_DEVELOPER: id("d") })).toBe(true);
    const env = { ...retired, PADDLE_PRICE_PERSONAL: id("p"), PADDLE_PRICE_DEVELOPER: id("d"), PADDLE_PRICE_TEAM: "pri_bad" };
    expect(sold(env)).toEqual(["personal", "developer"]);
    expect(priceConfigurationProblems(env)).toEqual(["PADDLE_PRICE_TEAM: set, but not a usable Paddle price id"]);
  });
});

describe("planAvailability: the one gate every surface reads", () => {

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

/*
  WO-CAT-2 L2. A plan's allowance line names meters (PCU, KQU, storage). Opening its sale while one of those meters is a
  `not_sold` revenue family would put a not-sold term next to a Buy action -- and sell an allowance nothing counts. So a
  plan may be purchasable only if every meter family its allowance names is sold, and opening a sale before its meters
  exist fails here, not in a review. A seat is a cap the catalog's `seat_cap` capability gates; it has no revenue family.
*/
describe("a plan is purchasable only if every meter family its allowance names is sold", () => {
  const familyOf = (meter: string) => REVENUE_PATHS.filter((path) => path.meter === meter);
  /** Throws, naming each purchasable plan and the unsold meter family its allowance names. */
  function expectSoldMeters(delivered: ReadonlySet<Capability>, paths: readonly RevenuePath[] = REVENUE_PATHS) {
    const configured = readConfiguredBillingOffers(allEnv);
    const unsold = V2.filter((code) => planAvailability(code, configured, delivered) === "purchasable").flatMap((code) =>
      Object.keys(BILLING_OFFERS[code].included).flatMap((meter) => paths.filter((path) => path.meter === meter)
        .filter((family) => family.state === "not_sold")
        .map((family) => `${code}: ${meter} (${family.family})`)));
    if (unsold.length > 0) throw new Error(`purchasable plans whose allowance names a not_sold meter family:\n${unsold.join("\n")}`);
  }

  it("maps every allowance key to exactly one revenue family, except the seat cap", () => {
    for (const code of V2) {
      for (const meter of Object.keys(BILLING_OFFERS[code].included)) {
        expect(familyOf(meter).length, `${code}: ${meter}`).toBe(meter === "seats" ? 0 : 1);
      }
    }
  });

  it("holds for what the product delivers today, with every price set", () => {
    expect(V2.filter((code) => planAvailability(code, readConfiguredBillingOffers(allEnv)) === "purchasable")).toEqual(["personal", "developer"]);
    expectSoldMeters(DELIVERED);
    expectSoldMeters(new Set(ALL));
  });

  it("fails when Personal is purchasable while KQU and storage are not sold (failure path: the table before WO-REL-1)", () => {
    const before: RevenuePath[] = REVENUE_PATHS.map((path) =>
      path.meter === "kqu" || path.meter === "storageGb" ? { ...path, state: "not_sold" } : path);
    expect(() => expectSoldMeters(DELIVERED, before)).toThrow(/personal: kqu \(CONTEXT_KQU\)[\s\S]*personal: storageGb \(STORAGE_RETENTION\)/);
    expect(() => expectSoldMeters(new Set(ALL), before)).toThrow(/business: kqu \(CONTEXT_KQU\)/);
  });
});

describe("catalogConfigured: readiness of the price configuration", () => {
  const without = (...drop: string[]) => Object.fromEntries(Object.entries(allEnv).filter(([k]) => !drop.includes(k)));

  it("is true with every price set, and with the sale closed (no current price set) or only undelivered ones missing", () => {
    expect(catalogConfigured(allEnv)).toBe(true);
    expect(catalogConfigured(without("PADDLE_PRICE_TEAM", "PADDLE_PRICE_BUSINESS"))).toBe(true);
    expect(catalogConfigured(without("PADDLE_PRICE_PERSONAL", "PADDLE_PRICE_DEVELOPER", "PADDLE_PRICE_TEAM", "PADDLE_PRICE_BUSINESS"))).toBe(true);
    expect(catalogConfigured({ PADDLE_PRICE_OBSERVER_ACCESS: id("o"), PADDLE_PRICE_STUDIO_ACCESS: id("s") })).toBe(true);
  });

  it("is false when a retired env is missing: a renewal could not resolve", () => {
    expect(catalogConfigured(without("PADDLE_PRICE_OBSERVER_ACCESS"))).toBe(false);
    expect(catalogConfigured(without("PADDLE_PRICE_STUDIO_ACCESS"))).toBe(false);
    expect(catalogConfigured({})).toBe(false);
    expect(priceConfigurationProblems(without("PADDLE_PRICE_STUDIO_ACCESS"))).toEqual([
      "PADDLE_PRICE_STUDIO_ACCESS: missing, so a renewal of this retired plan cannot resolve",
    ]);
  });

  it("is false when one offer of the group that would be purchasable has no price", () => {
    expect(catalogConfigured(without("PADDLE_PRICE_PERSONAL"))).toBe(false);
    expect(catalogConfigured(without("PADDLE_PRICE_PERSONAL"), new Set(ALL))).toBe(false);
    // With nothing delivered there is no group to complete.
    expect(catalogConfigured(without("PADDLE_PRICE_PERSONAL"), new Set<Capability>())).toBe(true);
  });
});

it("holds exactly the four v2 codes and the two retired ones", () => {
  const codes: BillingOfferCode[] = [...V2, ...RETIRED];
  expect(Object.keys(BILLING_OFFERS).sort()).toEqual([...codes].sort());
});
