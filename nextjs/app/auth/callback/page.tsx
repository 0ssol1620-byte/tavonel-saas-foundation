"use client";

/**
 * The OAuth return.
 *
 * This page was left behind by the redesign: it still carried the old letter mark and the old
 * `.brand` / `.hero` classes, so the one screen every Google sign-in passes through looked like a
 * different product than the page before it and the page after it.
 *
 * It was also a dead end. On failure it printed a sentence and offered nothing -- no retry, no way
 * back -- and after an OAuth redirect the browser's back button rarely lands anywhere useful. A
 * failure here is the most likely moment to lose a pilot user, so it is the last place that should
 * leave someone without a control.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import Logomark from "@/components/logomark";

type Phase = "working" | "unconfigured" | "failed";

export default function AuthCallbackPage() {
  const [phase, setPhase] = useState<Phase>("working");

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
        setPhase("failed");
        return;
      }
      window.location.replace("/workspace");
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="auth">
      <header>
        <Link href="/" className="wordmark"><Logomark /><b>TAVONEL</b></Link>
        <span className="mode"><i aria-hidden="true" />FOUNDATION MODE</span>
      </header>

      <div className="auth-body">
        <div className="auth-card">
          <p className="eyebrow">SIGN IN</p>

          {phase === "working" ? (
            <>
              <h1>Signing you in.</h1>
              <p className="lead" role="status">
                Completing the handover from Google. This takes a moment, and your workspace opens
                on its own when it finishes.
              </p>
            </>
          ) : (
            <>
              <h1>Sign-in did not complete.</h1>
              <p className="lead" role="status">
                {phase === "unconfigured"
                  ? "No auth provider is configured in this deployment, so the sign-in could not be completed here. Nothing is wrong with your account."
                  : "Google returned, but no session was established. This pilot admits testing-mode users only, so an account outside that list will stop at exactly this point."}
              </p>
              <div className="auth-actions">
                <Link className="btn" href="/login">Try again</Link>
                <Link className="btn ghost" href="/">Back to the site</Link>
              </div>
            </>
          )}

          <p className="fine">
            No password is created or stored. Nothing you upload is promoted into a live world
            without you deciding it.
          </p>
        </div>
      </div>
    </main>
  );
}
