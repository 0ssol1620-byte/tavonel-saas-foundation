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
        const body = (await response.json()) as { auth?: string };
        if (cancelled) return;
        setAuthState(body.auth === "google_oauth_configured" ? "ready" : "unconfigured");
      } catch {
        // Fail closed: if the deployment cannot be asked, do not offer a control that will fail.
        if (!cancelled) setAuthState("unconfigured");
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
      setError("Google sign-in could not start. This pilot admits testing-mode users only.");
      setBusy(false);
    }
  };

  return (
    <main id="main" className="auth">
      <header>
        <Link href="/" className="wordmark"><Logomark /><b>TAVONEL</b></Link>
        <span className="mode"><i aria-hidden="true" />FOUNDATION MODE</span>
      </header>

      <div className="auth-body">
        <div className="auth-card">
          <p className="eyebrow">{intent ? "SIGN IN TO CONTINUE" : "SIGN IN"}</p>
          <h1>{intent ? "One step before checkout." : "Open your workspace."}</h1>
          <p className="lead">
            TAVONEL compiles your documents into a structured world and keeps it correct as they
            change. Signing in gives you a private, tenant-scoped workspace &mdash; nothing is
            shared, and no document you upload is ever promoted into a live world without you
            deciding it.
          </p>

          {intent ? (
            <p className="notice static" role="status">
              <strong>{BILLING_OFFERS[intent].label} is held for you.</strong> Checkout opens by
              itself once you are in. Nothing is charged by signing in, and access changes only
              after a signed webhook is persisted.
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
            <li><b>Google only.</b> No password is created, and none is stored.</li>
            <li><b>Private pilot.</b> Access is limited to testing-mode users while the pilot runs.</li>
            <li><b>Nothing is promoted automatically.</b> Analysis produces a candidate; a person decides.</li>
            <li><b>Sandbox billing.</b> No live payment is taken, and only a signed webhook can change access.</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
