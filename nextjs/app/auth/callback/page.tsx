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
import { useEffect, useState } from "react";
import Logomark from "@/components/logomark";
import { takeCheckoutIntent } from "@/lib/checkout-intent";
import { trackFunnel } from "@/lib/funnel-events";
import { takeRecipeIntent } from "@/lib/recipe-intent";

type Phase = "working" | "unconfigured" | "session-failed" | "access-failed";

export default function AuthCallbackPage() {
  const [phase, setPhase] = useState<Phase>("working");
  const [failureCode, setFailureCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
      const client = getSupabaseBrowserClient();
      if (!client) {
        if (!cancelled) setPhase("unconfigured");
        return;
      }
      const { data, error } = await client.auth.getSession();
      if (cancelled) return;
      if (error || !data.session) {
        setPhase("session-failed");
        return;
      }

      let bootstrap: Response;
      try {
        bootstrap = await fetch("/api/access/bootstrap", {
          method: "POST",
          credentials: "same-origin",
          headers: { authorization: `Bearer ${data.session.access_token}` },
        });
      } catch {
        if (!cancelled) {
          setFailureCode("ACCESS_BOOTSTRAP_UNAVAILABLE");
          setPhase("access-failed");
        }
        return;
      }
      const body = await bootstrap.json().catch(() => null) as { code?: unknown } | null;
      if (cancelled) return;
      if (!bootstrap.ok) {
        setFailureCode(typeof body?.code === "string" ? body.code : `HTTP_${bootstrap.status}`);
        setPhase("access-failed");
        return;
      }

      // If they came here mid-purchase, put them back where they were rather than in a workspace
      // that has forgotten it. Owner access never reaches checkout, while an existing paid user
      // can still resume a checkout intent deliberately started before sign-in.
      const resume = takeCheckoutIntent();
      /*
        WG-056/084. The same repair for the other thing a reader declares before signing in.
        Both intents are taken -- consumed once, whichever one wins -- so neither can surface on a
        later hop, and checkout keeps precedence because it is the narrower, paying one.

        A recipe resumes to its own validated `returnTo`, which is a path from a closed allow-list
        and never a URL the reader supplied. That is the whole point of carrying it: a reader who
        clicked from a cookbook sample comes back to that sample rather than to an empty
        workspace, which is where this hop used to drop them.
      */
      const resumeRecipe = takeRecipeIntent();
      // The closing half of the sign-in hop, and the last point at which this page knows which
      // destination it is. `mode` is the destination, not the account: nothing here identifies
      // who signed in, and the event does not fire on any of the three failure phases.
      trackFunnel("signed_in", {
        mode: resume ? "resume-checkout" : resumeRecipe ? "resume-recipe" : "workspace",
      });
      window.location.replace(
        resume ? `/workspace?checkout=${resume}`
          : resumeRecipe ? resumeRecipe.returnTo
            : "/workspace",
      );
    })();
    return () => { cancelled = true; };
  }, []);

  const failed = phase !== "working" && phase !== "unconfigured";

  return (
    <main id="main" className="auth" tabIndex={-1}>
      <header>
        <Link href="/" className="wordmark"><Logomark /><b>TAVONEL</b></Link>
      </header>

      <div className="auth-body">
        <div className="auth-card">
          <p className="eyebrow">SIGN IN</p>

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
                  ? "No auth provider is configured in this deployment, so sign-in cannot be completed here."
                  : phase === "session-failed"
                    ? "Google returned, but no session was established. Please try again."
                    : "Your Google session is valid, but the workspace access check could not be completed. Please try again or contact support if the account should have access."}
              </p>
              {failureCode ? <p className="fine">Reference: {failureCode}</p> : null}
              <div className="auth-actions">
                <Link className="btn" href="/login">Try again</Link>
                <Link className="btn ghost" href="/">Back to the site</Link>
              </div>
            </>
          )}

          {!failed ? (
            <p className="fine">
              No password is created or stored. Nothing you upload is promoted into a live world
              without you deciding it.
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
