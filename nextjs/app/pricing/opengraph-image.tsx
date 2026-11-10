import { ogCard } from "@/lib/og-card";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { TRIAL_ALLOWANCE } from "@/lib/site-navigation";

export { alt, contentType, size } from "@/lib/og-card";

// Conversion pass 2026-11-09 (funnel audit quick win): the share card carries the catalog's prices, read, not retyped.
const { observer_access: developer, studio_access: team } = BILLING_OFFERS;
export default ogCard(
  "Pricing",
  `Free ${TRIAL_ALLOWANCE.days}-day evaluation. ${developer.label} $${developer.priceUsd}/month. ${team.label} $${team.priceUsd}/month. Hard spend limits.`,
);
