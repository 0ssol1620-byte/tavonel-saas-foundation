"use client";

/**
 * Sign in.
 *
 * There was no sign-in page before this: the landing page opened a Google popup from its nav and
 * a failure surfaced as a toast on a marketing page, with no way back and nothing explaining
 * what a person was signing in *to*. That is the moment a private pilot loses people.
 *
 * Two jobs, in this order. Tell someone what they get and what is gated -- read live from
 * `/api/status`, so the page never promises a capability this deployment does not have -- and
 * then get them in with one control. Google is the only provider configured; if it is not
 * configured, the button says so instead of failing on click.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import Logomark from "@/components/logomark";
import { RecipePreflight } from "@/components/recipe-preflight";
import { readOfferParam, rememberCheckoutIntent, takeCheckoutIntent } from "@/lib/checkout-intent";
import { trackFunnel } from "@/lib/funnel-events";
import {
  readRecipeParams,
  rememberFirstTouch,
  rememberRecipeIntent,
  takeRecipeIntent,
  type RecipeIntent,
} from "@/lib/recipe-intent";
import { BILLING_OFFERS, type BillingOfferCode } from "@/lib/billing-catalog";

type AuthState = "checking" | "ready" | "unconfigured";

export default function LoginPage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
    Audit M05. This was initialised to "pilot", and the PRIVATE PILOT badge renders on
    `commercialMode === "pilot"` from the first paint -- so a commercially live deployment served
    the literal words PRIVATE PILOT in its own /login HTML and then took them away a moment later
    when the fetch resolved. A badge is a statement about the deployment; until /api/status has
    answered, this page has no such statement to make, and `null` renders nothing. The catch
    branch leaves it null for the same reason: an unreachable status endpoint is not evidence of
    a pilot.
  */
  const [commercialMode, setCommercialMode] = useState<"pilot" | "live" | null>(null);
  const [selfService, setSelfService] = useState(false);
  const [customerProcessingEnabled, setCustomerProcessingEnabled] = useState(false);
  /**
   * R1, second half. Someone who arrived by picking a plan is not here to "open a workspace" --
   * they are part-way through a purchase, and the page has to say so or the detour looks like the
   * product losing their place. The offer is read from the URL, validated against the offer list
   * (never a price), and put in sessionStorage because the Google round trip returns to a fixed
   * callback path that cannot carry a query string of ours.
   */
  const [intent, setIntent] = useState<BillingOfferCode | null>(null);
  /**
   * WG-082/084. The same hop for a reader who came from a cookbook rather than from a price.
   *
   * `next=recipe` is a different arrival from `next=checkout` and the two never mix: one of them
   * is at most present, the checkout path is untouched, and the recipe is validated against the
   * closed slug list before it is stored or rendered. A recipe carries no plan and no price, so
   * what this page can say about cost comes from `usage-pricing.ts` and the plan catalog, never
   * from the URL.
   */
  const [recipe, setRecipe] = useState<RecipeIntent | null>(null);

  useEffect(() => {
    let cancelled = false;
    /*
      WG-085. First touch is recorded before any internal id is written, and `rememberFirstTouch`
      never overwrites a record that already exists -- so a reader who arrived from a campaign and
      then clicked through three internal pages keeps the campaign. The recipe intent is a
      separate key and nothing below writes an internal id into the attribution record.
    */
    rememberFirstTouch(window.location.search);
    const offer = readOfferParam(window.location.search);
    if (offer) {
      setIntent(offer);
      rememberCheckoutIntent(offer);
      trackFunnel("login_reached_with_intent", { offer });
    }
    const startedRecipe = readRecipeParams(window.location.search);
    if (startedRecipe) {
      setRecipe(startedRecipe);
      rememberRecipeIntent(startedRecipe);
      trackFunnel("login_reached_with_intent", { kind: "recipe" });
    }
    void (async () => {
      // Already signed in? Do not make someone sign in twice.
      const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
      const client = getSupabaseBrowserClient();
      if (client) {
        const { data } = await client.auth.getSession();
        if (data.session && !cancelled) {
          const resume = takeCheckoutIntent();
          /*
            Consumed and discarded on purpose. Somebody already signed in who lands here from a
            cookbook CTA has not been interrupted by a sign-in, so there is nothing to resume --
            and sending them back to the page they just clicked from is a loop, not a resume. The
            intent is still taken so it cannot surface on a later, unrelated hop.
          */
          takeRecipeIntent();
          window.location.replace(resume ? `/workspace?checkout=${resume}` : "/workspace");
          return;
        }
      }
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        const body = (await response.json()) as {
          auth?: string;
          commercialMode?: "pilot" | "live";
          selfService?: boolean;
          activationPolicy?: { customerData?: { enabled?: boolean } };
        };
        if (cancelled) return;
        // Only the two values this deployment can actually be in set the badge. A malformed
        // status body leaves it unset rather than defaulting to the wrong label.
        setCommercialMode(body.commercialMode === "live" || body.commercialMode === "pilot"
          ? body.commercialMode
          : null);
        setSelfService(body.selfService === true);
        setCustomerProcessingEnabled(body.activationPolicy?.customerData?.enabled === true);
        setAuthState(body.auth === "google_oauth_configured" ? "ready" : "unconfigured");
      } catch {
        // Fail closed: if the deployment cannot be asked, do not offer a control that will fail.
        if (!cancelled) {
          setSelfService(false);
          setAuthState("unconfigured");
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
    const client = getSupabaseBrowserClient();
    if (!client) {
      setError("Auth is not configured in this deployment.");
      setBusy(false);
      return;
    }
    const { error: authError } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (authError) {
      setError("Google sign-in could not start. Please try again.");
      setBusy(false);
    }
  };

  return (
    <main id="main" className="auth" tabIndex={-1}>
      <header>
        <Link href="/" className="wordmark"><Logomark /><b>TAVONEL</b></Link>
        {commercialMode === "pilot" ? <span className="mode"><i aria-hidden="true" />PRIVATE PILOT</span> : null}
      </header>

      <div className="auth-body">
        <div className="auth-card">
          {intent || recipe ? <p className="eyebrow">SIGN IN TO CONTINUE</p> : null}
          <h1>
            {intent ? "One step before checkout."
              : recipe ? "One step before you run this."
                : "Open your workspace."}
          </h1>
          <p className="lead">
            TAVONEL turns your documents and connected sources into a structured, source-grounded
            World. Your workspace is tenant-scoped and source data is processed under the published
            data and subprocessor policies.
          </p>

          {intent ? (
            <p className="notice static" role="status">
              <strong>{BILLING_OFFERS[intent].label} is held for you.</strong> Checkout opens by
              itself once you are in. Nothing is charged by signing in, and access changes only
              after a signed webhook is persisted.
            </p>
          ) : recipe ? (
            <>
              <p className="notice static" role="status">
                <strong>Your recipe is kept for you.</strong> Signing in brings you back to the same
                page and the same recipe, with nothing running until you ask for it.
              </p>
              <RecipePreflight intent={recipe} />
            </>
          ) : selfService && customerProcessingEnabled ? (
            <p className="notice static" role="status">
              <strong>Start with a free evaluation.</strong> Use up to 3 files and 50 standard
              pages to compile 1 World for 7 days. No card is required.
            </p>
          ) : null}

          {authState === "ready" && !customerProcessingEnabled ? (
            <p className="notice static" role="status">
              <strong>Customer file processing is not open yet.</strong> You can sign in to view
              your workspace, or explore a completed public example.
            </p>
          ) : null}

          <div className="auth-actions">
            <button className="btn" type="button" onClick={() => void signIn()} disabled={busy || authState !== "ready"}>
              {authState === "checking" ? "Checking this deployment…" :
                authState === "unconfigured" ? "Sign-in unavailable" :
                busy ? "Opening Google…" : "Continue with Google"}
            </button>
            {authState === "ready" && !customerProcessingEnabled ? (
              <Link className="btn ghost" href="/explore">Explore the public World</Link>
            ) : null}
            <Link className="btn ghost" href="/">Back to the site</Link>
          </div>

          {authState === "unconfigured" ? (
            <p className="notice static" role="status">
              <strong>Sign-in is temporarily unavailable.</strong> Try again shortly, or reach us
              at <a href="mailto:support@tavonel.com">support@tavonel.com</a>.
            </p>
          ) : null}
          {error ? <p className="notice static" role="alert"><strong>Sign-in did not start.</strong> {error}</p> : null}

          <ul className="auth-facts">
            <li><b>Google sign-in.</b> No separate TAVONEL password is created or stored.</li>
            <li><b>Tenant scoped.</b> Workspace access and source processing remain bound to your account.</li>
            <li><b>Human review.</b> Review gates remain visible before a candidate World is activated.</li>
            {selfService && customerProcessingEnabled ? <li><b>Bounded evaluation.</b> Free compute is limited before processing begins, so paid workloads remain protected.</li> : null}
          </ul>
        </div>
        <p className="fine auth-legal">
          <Link href="/privacy">Privacy notice</Link> · <Link href="/terms">Terms</Link> ·{" "}
          <Link href="/security">Security</Link> · <Link href="/contact">Contact</Link>
        </p>
      </div>
    </main>
  );
}
