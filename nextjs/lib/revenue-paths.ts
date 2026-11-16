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
  /** Null for not_sold, and for sold_contract (invoiced outside the self-serve ledger). */
  ledgerPath: LedgerPath | null;
  /** Public-copy terms that must not appear while the path is not_sold. */
  terms: readonly string[];
};

const notSold = (family: string, ...terms: string[]): RevenuePath => ({
  family,
  state: "not_sold",
  offerCodes: [],
  ledgerPath: null,
  terms,
});

export const REVENUE_PATHS: readonly RevenuePath[] = [
  { family: "CORE_FREE", state: "sold_self_serve", offerCodes: [], ledgerPath: "allowance", terms: [] },
  {
    family: "CORE_PERSONAL_TEAM_BUSINESS",
    state: "sold_self_serve",
    offerCodes: ["observer_access", "studio_access"],
    ledgerPath: "purchase",
    terms: [],
  },
  notSold("DEV"),
  { family: "COMPILE_PCU", state: "sold_self_serve", offerCodes: [], ledgerPath: "compute_reservation", terms: [] },
  notSold("CONTEXT_KQU", "KQU"),
  notSold("STORAGE_RETENTION", "GB-month"),
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
