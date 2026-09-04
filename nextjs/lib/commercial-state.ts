/**
 * The one commercial state every surface reads.
 *
 * Before this module the answer to "are we selling yet?" was assembled independently on each
 * page from three unrelated environment variables, and the three disagreed:
 *
 *   - Pricing and Login read COMMERCIAL_MODE.
 *   - Terms and Refunds read isBillingLaunchApproved(), which returned *true* whenever
 *     PADDLE_SANDBOX was set — so a sandbox deployment published legal copy claiming live
 *     paid checkout while the pricing page next to it said "Request access".
 *   - Status reported its phase from PADDLE_SANDBOX alone, so a production-provider pilot
 *     deployment described itself as "live".
 *
 * Legal copy that overstates the commercial relationship is the worst of those three, so the
 * distinction this module draws is the one that bug crossed: creating a checkout session and
 * being able to take real money are separate facts.
 *
 *   checkoutEnabled     the checkout API may open a session (sandbox qualification included)
 *   liveChargesEnabled  a real customer card can actually be charged
 *
 * Legal, pricing and marketing surfaces read `liveChargesEnabled`. Only the checkout route
 * itself reads `checkoutEnabled`, so sandbox end-to-end qualification keeps working without
 * ever leaking "live" into published copy.
 */

export type CommercialMode = "pilot" | "live";
export type PaymentProvider = "sandbox" | "production";

export type CommercialState = {
  /** Customer-facing commercial posture. Drives every CTA and legal template. */
  mode: CommercialMode;
  /** Which Paddle environment this deployment is wired to. */
  provider: PaymentProvider;
  /** The checkout API may create a session. True in sandbox so E2E qualification can run. */
  checkoutEnabled: boolean;
  /** A real charge can reach a real card. The only flag legal copy is allowed to read. */
  liveChargesEnabled: boolean;
  /** Which legal template is in force. Pilot and live terms are separate documents. */
  legalTermsVersion: "pilot-2026-08-30" | "live-2026-08-30";
};

type Environment = Readonly<Record<string, string | undefined>>;

export function readCommercialState(env: Environment = process.env): CommercialState {
  const mode: CommercialMode = env.COMMERCIAL_MODE?.trim().toLowerCase() === "live" ? "live" : "pilot";
  const provider: PaymentProvider = env.PADDLE_SANDBOX === "true" ? "sandbox" : "production";
  const launchApproved = env.TAVONEL_BILLING_LAUNCH_APPROVED === "true";
  /*
   * Production is an independent gate.
   *
   * A preview can intentionally inherit the same non-secret launch flags as production while
   * still being a preview. It must never become capable of charging merely because those two
   * flags are version-controlled. Vercel supplies VERCEL_ENV at runtime; local/unit-test
   * environments omit it, so the historical three-input contract remains directly testable.
   */
  const deploymentAllowsLiveCharges = env.VERCEL_ENV === undefined || env.VERCEL_ENV === "production";

  // Real money requires every gate to agree. Any one of them dissenting keeps checkout closed.
  const liveChargesEnabled =
    deploymentAllowsLiveCharges && mode === "live" && provider === "production" && launchApproved;

  return {
    mode,
    provider,
    checkoutEnabled: provider === "sandbox" ? true : liveChargesEnabled,
    liveChargesEnabled,
    legalTermsVersion: liveChargesEnabled ? "live-2026-08-30" : "pilot-2026-08-30",
  };
}

/** True when the site should show plans and prices as purchasable rather than "Request access". */
export function isLiveCommerce(env: Environment = process.env) {
  return readCommercialState(env).liveChargesEnabled;
}

/** The primary call to action, which changes with commercial posture and nothing else. */
export function primaryCallToAction(env: Environment = process.env) {
  return isLiveCommerce(env)
    ? { label: "Start with your files", href: "/login" as const }
    : { label: "Request access", href: "/contact" as const };
}
