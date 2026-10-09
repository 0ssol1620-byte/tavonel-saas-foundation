"use client";

/**
 * The OAuth return.
 *
 * Authentication is only half of onboarding. Before the workspace opens, the server now resolves
 * the authenticated account into one of three explicit access sources: owner, paid, or the bounded
 * self-service evaluation. That keeps a newly signed-in user from arriving at a workspace whose
 * first API call immediately answers SUBSCRIPTION_REQUIRED, and it gives the abuse gate one
 * first-party place to issue its signed device token.
 */

import Link from "next/link";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import Logomark from "@/components/logomark";
import { takeCheckoutIntent } from "@/lib/checkout-intent";
import { trackFunnel } from "@/lib/funnel-events";
import { resumeDestination, takeRecipeIntent } from "@/lib/recipe-intent";

type Phase = "working" | "unconfigured" | "session-failed" | "access-failed";

type Attempt = {
  isLive: () => boolean;
  setPhase: Dispatch<SetStateAction<Phase>>;
  setFailureCode: Dispatch<SetStateAction<string | null>>;
};

/**
 * One attempt to finish the sign-in: read the session the cached browser client already holds,
 * ask the server for access, and only then consume the held intents and leave.
 *
 * It runs on mount and again from the access-failed "Try again" control. The retry never goes
 * back through the provider: `getSupabaseBrowserClient` returns the module's one client, whose
 * URL detection ran once when it was created, so a second attempt re-reads the session that
 * attempt confirmed rather than replaying anything from the URL. Both intents are untouched by
 * every failure path, so they survive until the attempt that actually succeeds takes them.
 *
 * Returns "left" once it has navigated away, so the caller never re-enables a control on a page
 * that is already leaving.
 */
async function finishSignIn({ isLive, setPhase, setFailureCode }: Attempt): Promise<"left" | "stopped"> {
  const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
  const client = getSupabaseBrowserClient();
  if (!client) {
    if (isLive()) setPhase("unconfigured");
    return "stopped";
  }
  const { data, error } = await client.auth.getSession();
  if (!isLive()) return "stopped";
  if (error || !data.session) {
    const providerCode = new URLSearchParams(window.location.search).get("error_code");
    setFailureCode(providerCode && /^[a-z0-9_]{1,60}$/i.test(providerCode)
      ? providerCode.toUpperCase()
      : "AUTH_SESSION_MISSING");
    setPhase("session-failed");
    return "stopped";
  }

  let bootstrap: Response;
  try {
    bootstrap = await fetch("/api/access/bootstrap", {
      method: "POST",
      credentials: "same-origin",
      headers: { authorization: `Bearer ${data.session.access_token}` },
    });
  } catch {
    if (isLive()) {
      setFailureCode("ACCESS_BOOTSTRAP_UNAVAILABLE");
      setPhase("access-failed");
    }
    return "stopped";
  }
  const body = await bootstrap.json().catch(() => null) as {
    code?: unknown;
    access?: { source?: unknown; billingExempt?: unknown };
  } | null;
  if (!isLive()) return "stopped";
  if (!bootstrap.ok) {
    setFailureCode(typeof body?.code === "string" ? body.code : `HTTP_${bootstrap.status}`);
    setPhase("access-failed");
    return "stopped";
  }

  // If they came here mid-purchase, put them back where they were rather than in a workspace
  // that has forgotten it. Owner access never reaches checkout, while an existing paid user
  // can still resume a checkout intent deliberately started before sign-in.
  const resume = takeCheckoutIntent();
  const ownerBillingExempt = body?.access?.source === "owner" && body.access.billingExempt === true;
  /*
    WG-056/084. The same repair for the other thing a reader declares before signing in.
    Both intents are taken -- consumed once, whichever one wins -- so neither can surface on a
    later hop, and checkout keeps precedence because it is the narrower, paying one.

    X08. A recipe used to resume to its bare `returnTo` -- the cookbook page, which is static
    text that cannot know a sign-in happened, so the reader met the same "Start this recipe"
    button and pressing it again dropped them in an empty workspace. It now resumes to the
    sign-in page's continuation step for the same validated intent: the preflight again, then
    one link to where the recipe's first step lives, and nothing run until the reader asks.
    `resumeDestination` holds the precedence so this page and /login cannot disagree on it.
  */
  const resumeRecipe = takeRecipeIntent();
  // The closing half of the sign-in hop, and the last point at which this page knows which
  // destination it is. `mode` is the destination, not the account: nothing here identifies
  // who signed in, and the event does not fire on any of the three failure phases.
  trackFunnel("signed_in", {
    mode: resume && !ownerBillingExempt ? "resume-checkout" : resumeRecipe ? "resume-recipe" : "workspace",
  });
  window.location.replace(resumeDestination({ checkout: resume, ownerBillingExempt, recipe: resumeRecipe }));
  return "left";
}

export default function AuthCallbackPage() {
  const [phase, setPhase] = useState<Phase>("working");
  const [failureCode, setFailureCode] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  // State lands after the click's task; the ref stops a second click in the same task as well.
  const retryInFlight = useRef(false);
  /*
    One token per mounted lifetime, shared by the first attempt and every retry started in it.
    Unmounting -- "Back to the site" is a client navigation, so a pending request still resolves
    afterwards -- marks it dead, and a dead attempt sets no state, takes no intent, logs no
    sign-in and navigates nowhere. Per lifetime, not one mounted flag: StrictMode's second mount
    must not revive the first mount's attempt.
  */
  const lifetime = useRef({ live: false });

  useEffect(() => {
    const current = { live: true };
    lifetime.current = current;
    void finishSignIn({ isLive: () => current.live, setPhase, setFailureCode });
    return () => { current.live = false; };
  }, []);

  /*
    The access-failed recovery. It used to be a link to /login, and /login with a valid session
    consumes the held recipe and opens /workspace without it -- so a reader whose access check
    failed once lost the task they signed in for. The session is already confirmed here, so the
    retry repeats only the access check, on this page, and the intents stay held until it
    succeeds. The control is disabled while the check runs, and stays disabled once the page is
    leaving. The bootstrap is the same access request the first attempt made; nothing is uploaded,
    compiled or charged by it. An unexpected throw re-enables the control instead of leaving it
    stuck on "Checking access…". The retry is bound to the lifetime it started in, so one that
    resolves after the reader has left does nothing at all, including re-enabling the control.
  */
  const retryAccess = () => {
    if (retryInFlight.current) return;
    retryInFlight.current = true;
    setRetrying(true);
    const current = lifetime.current;
    void finishSignIn({ isLive: () => current.live, setPhase, setFailureCode })
      .catch(() => "stopped" as const)
      .then((result) => {
        if (result === "left" || !current.live) return;
        retryInFlight.current = false;
        setRetrying(false);
      });
  };

  const failed = phase !== "working" && phase !== "unconfigured";

  return (
    <main id="main" className="auth" tabIndex={-1}>
      <header>
        <Link href="/" className="wordmark"><Logomark /><b>TAVONEL</b></Link>
      </header>

      <div className="auth-body">
        <div className="auth-card">
          {/* BQ-099. The kicker said SIGN IN above "Signing you in." -- the heading, again,
              in capitals, above every one of the four states this page has. */}
          {phase === "working" ? (
            <>
              <h1>Signing you in.</h1>
              <p className="lead" role="status">
                Completing your Google sign-in and preparing your workspace. It opens on its own
                when access is ready.
              </p>
            </>
          ) : (
            <>
              <h1>{phase === "access-failed" ? "Workspace access needs attention." : "Sign-in did not complete."}</h1>
              <p className="lead" role="status">
                {phase === "unconfigured"
                  ? "No auth provider is configured, so sign-in cannot be completed here."
                  : phase === "session-failed"
                    ? "Google returned, but no session was established. Please try again."
                    : retrying
                      ? "Checking workspace access again. Your sign-in and anything you started before it are kept."
                      : "Your Google session is valid, but the workspace access check could not be completed. Please try again or contact support if the account should have access."}
              </p>
              {failureCode ? <p className="fine">Reference: {failureCode}</p> : null}
              <div className="auth-actions">
                {/* Session and configuration failures still start over at /login; an access
                    failure retries the access check here, with the session it already has. */}
                {phase === "access-failed" ? (
                  <button
                    className="btn"
                    type="button"
                    onClick={retryAccess}
                    disabled={retrying}
                    aria-busy={retrying}
                    data-loading={retrying ? "1" : undefined}
                  >
                    {retrying ? "Checking access…" : "Try again"}
                  </button>
                ) : (
                  <Link className="btn" href="/login">Try again</Link>
                )}
                <Link className="btn ghost" href="/">Back to the site</Link>
              </div>
            </>
          )}

          {!failed ? (
            <p className="fine">
              No password is created or stored. Nothing you upload is activated into a live world
              without you deciding it.
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
