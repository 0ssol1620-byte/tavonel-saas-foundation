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
import { readOfferParam, rememberCheckoutIntent, takeCheckoutIntent } from "@/lib/checkout-intent";
import { trackFunnel } from "@/lib/funnel-events";
import { BILLING_OFFERS, type BillingOfferCode } from "@/lib/billing-catalog";

type AuthState = "checking" | "ready" | "unconfigured";

export default function LoginPage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commercialMode, setCommercialMode] = useState<"pilot" | "live">("pilot");
  const [selfService, setSelfService] = useState(false);
  /**
   * R1, second half. Someone who arrived by picking a plan is not here to "open a workspace" --
   * they are part-way through a purchase, and the page has to say so or the detour looks like the
   * product losing their place. The offer is read from the URL, validated against the offer list
   * (never a price), and put in sessionStorage because the Google round trip returns to a fixed
   * callback path that cannot carry a query string of ours.
   */
  const [intent, setIntent] = useState<BillingOfferCode | null>(null);

  useEffect(() => {
    let cancelled = false;
    const offer = readOfferParam(window.location.search);
    if (offer) {
      setIntent(offer);
      rememberCheckoutIntent(offer);
      trackFunnel("login_reached_with_intent", { offer });
    }
    void (async () => {
      // Already signed in? Do not make someone sign in twice.
      const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
      const client = getSupabaseBrowserClient();
      if (client) {
        const { data } = await client.auth.getSession();
        if (data.session && !cancelled) {
          const resume = takeCheckoutIntent();
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
        };
        if (cancelled) return;
        setCommercialMode(body.commercialMode === "live" ? "live" : "pilot");
        setSelfService(body.selfService === true);
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
          <p className="eyebrow">{intent ? "SIGN IN TO CONTINUE" : "SIGN IN"}</p>
          <h1>{intent ? "One step before checkout." : "Open your workspace."}</h1>
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
          ) : selfService ? (
            <p className="notice static" role="status">
              <strong>Start with a free evaluation.</strong> Use up to 3 files and 50 standard
              pages to compile 1 World for 7 days. No card is required.
            </p>
          ) : null}

          <div className="auth-actions">
            <button className="btn" type="button" onClick={() => void signIn()} disabled={busy || authState !== "ready"}>
              {authState === "checking" ? "Checking this deployment…" :
                authState === "unconfigured" ? "Sign-in unavailable here" :
                busy ? "Opening Google…" : "Continue with Google"}
            </button>
            <Link className="btn ghost" href="/">Back to the site</Link>
          </div>

          {authState === "unconfigured" ? (
            <p className="notice static" role="status">
              <strong>No auth provider is configured in this deployment.</strong> The sign-in
              control stays disabled rather than failing on click. Nothing is wrong with your
              account.
            </p>
          ) : null}
          {error ? <p className="notice static" role="alert"><strong>Sign-in did not start.</strong> {error}</p> : null}

          <ul className="auth-facts">
            <li><b>Google sign-in.</b> No separate TAVONEL password is created or stored.</li>
            <li><b>Tenant scoped.</b> Workspace access and source processing remain bound to your account.</li>
            <li><b>Human review.</b> Review gates remain visible before a candidate World is activated.</li>
            {selfService ? <li><b>Bounded evaluation.</b> Free compute is limited before processing begins, so paid workloads remain protected.</li> : null}
          </ul>
        </div>
      </div>
    </main>
  );
}
