/**
 * The 15 SKU families of masterplan V5.6 "Revenue products" and what the product actually sells
 * today. No price lives here (ADR A8: `billing-catalog.ts` is the only price source); this file
 * only records which path is sold, contract-only or not sold, and where a sold path settles.
 */
import { BILLING_OFFERS, type BillingOfferCode } from "./billing-catalog";

export type RevenuePathState = "sold_self_serve" | "sold_contract" | "not_sold";
export type LedgerPath = "allowance" | "purchase" | "compute_reservation";

export type RevenuePath = {
  family: string;
  state: RevenuePathState;
  offerCodes: readonly BillingOfferCode[];
  /** Null for sold_contract (invoiced outside the self-serve ledger) and for a not_sold family that holds no offer. */
  ledgerPath: LedgerPath | null;
  /**
   * Public-copy terms of a not_sold family. On /pricing one may appear only in the allowance line of a plan whose action
   * is Request access and in a Request access row of the overage table (`revenue-paths.test.ts`).
   */
  terms: readonly string[];
  /** The key of a plan's `included` allowance this family meters, where it meters one. A seat is a cap, not a family. */
  meter?: "pcu" | "kqu" | "storageGb";
};

const notSold = (family: string, ...terms: string[]): RevenuePath => ({
  family,
  state: "not_sold",
  offerCodes: [],
  ledgerPath: null,
  terms,
});

export const REVENUE_PATHS: readonly RevenuePath[] = [
  // Trial usage is not an allowance row (that kind is unique per Paddle transaction_id); it is counted
  // through foundation_trial_policy and reserve_foundation_compute_v3 with billing source "trial".
  { family: "CORE_FREE", state: "sold_self_serve", offerCodes: [], ledgerPath: "compute_reservation", terms: [] },
  /*
    Catalog v2 (PB-2026-11-V22). WO-REL-1 (= WO-CAT-7) is the release that proves the meters: `DELIVERED` holds the
    Personal and Developer line, so these families are sold self-serve -- in the release that carries them, once
    its two prices are set. With them unset `planAvailability` sells nothing, whatever this table says, and
    Team and Business stay Request access (their line is not delivered). The retired offers settle renewals
    through the same `allowance` path: they are never sold again, and an existing subscriber keeps both the
    price and the path until they change plan.
  */
  {
    family: "CORE_PERSONAL_TEAM_BUSINESS",
    state: "sold_self_serve",
    offerCodes: ["personal", "team", "business", "observer_access", "studio_access"],
    ledgerPath: "allowance", // every offer is kind "subscription"; paddle-billing-event emits action "allowance"
    terms: [],
  },
  { family: "DEV", state: "sold_self_serve", offerCodes: ["developer"], ledgerPath: "allowance", terms: [] },
  { family: "COMPILE_PCU", state: "sold_self_serve", offerCodes: [], ledgerPath: "compute_reservation", terms: [], meter: "pcu" },
  // Counted and capped inside a plan's allowance (kqu_meter, storage_meter delivered); no overage is billed past it.
  { family: "CONTEXT_KQU", state: "sold_self_serve", offerCodes: [], ledgerPath: "allowance", terms: [], meter: "kqu" },
  { family: "STORAGE_RETENTION", state: "sold_self_serve", offerCodes: [], ledgerPath: "allowance", terms: [], meter: "storageGb" },
  notSold("STEWARD_SYNC", "Steward sync"),
  notSold("SKILL_RUN_LICENSE", "Verified Skill", "Skill run"),
  notSold("WORLD_FIRST_PARTY", "first-party World"),
  notSold("WORLD_THIRD_PARTY", "third-party World", "publisher marketplace"),
  notSold("OUTCOME_MODULE", "Outcome module"),
  notSold("FEDERATION", "Federation"),
  { family: "ENTERPRISE", state: "sold_contract", offerCodes: [], ledgerPath: null, terms: [] },
  notSold("SERVICES", "implementation services"),
  notSold("DATA_LICENSE", "Data license"),
];

/** Fail-closed lookup: an offer code no sold path claims is an error, never a default. */
export function revenuePathForOffer(code: BillingOfferCode, paths: readonly RevenuePath[] = REVENUE_PATHS) {
  const hits = paths.filter((p) => p.offerCodes.includes(code));
  if (hits.length !== 1) throw new Error(`offer ${code} maps to ${hits.length} revenue paths`);
  return hits[0];
}

export const OFFER_CODES = Object.keys(BILLING_OFFERS) as BillingOfferCode[];
