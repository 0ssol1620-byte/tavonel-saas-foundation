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

import { activationPolicy } from "./activation-policy";
import { ACCESS_CTA, SELF_SERVE_CTA, type SiteLink } from "./site-navigation";

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

/**
 * True when the site should offer "Start with your files" rather than "Request access".
 *
 * G1-001 / G1-010 / G2-026: the billing flags are a necessary condition and were being read as a
 * sufficient one. `/` and `/pricing` are `force-dynamic` and resolved this at request time, while
 * `/product`, `/solutions` and `/ko` are prerendered and resolved it at build time with the flags
 * scrubbed -- so the same site offered two different primary actions depending on which page a
 * visitor landed on, and the louder of the two promised the exact thing the deployment does not do.
 *
 * `activationPolicy.customerData` is the fact underneath both: while it is closed, no amount of
 * billing configuration makes "start with your files" a true sentence. It is a module constant, so
 * it resolves the same way in a prerender and at request time, which is what makes the action one
 * action everywhere. Legal and pricing copy keep reading `liveChargesEnabled` directly -- being
 * able to charge a card and being able to compile a customer's files are still separate facts.
 */
export function isLiveCommerce(env: Environment = process.env) {
  return readCommercialState(env).liveChargesEnabled && activationPolicy.customerData.enabled;
}

/*
  `deploymentStateLine()` WAS HERE, AND IT IS GONE. 2026-09-19, fix round 2.

  It built the header's one-line deployment state. D2 took that line out of the bar (blueprint
  §8, §35) on the stated premise that Scene 09 carries the gate sentence verbatim, and once the
  Landing V2 chrome landed the function had no render caller anywhere in the tree -- a live
  export whose only remaining trace of the decision was that nobody called it. Deleting it
  changes nothing a reader sees; leaving it would let the next lane conclude the line was still
  published somewhere.

  WHERE THE GATE IS STILL STATED, so this is a record rather than a disappearance:
  `activationPolicy.customerData.reason` renders verbatim on `/pricing`, `/security`,
  `/integrations`, in the `/docs` first-run notes, and in Scene 09 of `/` and `/ko`.

  WHERE IT WAS NO LONGER STATED, and what fix round 3 did about it. `/product`,
  `/knowledge-compiler`, `/resources`, the `/docs` index, `/contact`, `/explore`, `/status` and
  `/login` carried the gate only through the header line -- and `/contact` is the destination of
  the landing's own access action. Contract rule 5 names the gate as shared chrome, so it went
  back into the chrome: into `PublicSiteFooter`, not into the header D2 deliberately cleared. It
  reads `activationPolicy.customerData.reason` verbatim, and `KO_CHROME.customerDataGate` -- its
  one Korean translation, which the landing's own microtext also reads -- on `/ko`. It renders
  only while `customerData.enabled` is false, which is the null this function used to return.

  So every public route states the gate again, and the four surfaces above still state it in
  their own context. What is still a founder's call is the hero's own wording, not whether the
  deployment says what it does.
*/

/**
 * The primary call to action, which changes with commercial posture and nothing else.
 *
 * BA-232: the two labels moved to `lib/site-navigation.ts`, which the header, the phone sheet and
 * the page-level actions already read. This function still owns *which* of the two applies; it no
 * longer owns their words, so a bar and a hero cannot spell one action two ways.
 */
export function primaryCallToAction(env: Environment = process.env): SiteLink {
  return isLiveCommerce(env) ? SELF_SERVE_CTA : ACCESS_CTA;
}
