"use client";

/**
 * The remote MCP consent page: the OAuth 2.1 authorization endpoint a person sees (G11).
 *
 * The session is a Supabase bearer this page holds, not a cookie, so the page reads the request
 * from its own query, asks `/api/mcp/oauth/authorize` to check it, and posts the person's
 * decision with the bearer. The server decides everything that matters -- whether the client and
 * its redirect URI verify, what may be granted, whether this workspace may hold a key -- and this
 * page only shows the answer and navigates where the server says.
 *
 * It navigates only on a person's click (REVIEW-2026-10-19 B1, RFC 9700 §4.11.2). Registration is
 * open, so no redirect URI is trusted: a request the server rejects is shown here with the client's
 * address, and the error goes back only if the person clicks "Return to …". Deny and Allow are
 * clicks already, and the server answers them only for the redirect URI exactly as registered.
 *
 * The Supabase client is imported on the click that needs a session, not on load: it is the
 * largest chunk on the page, and loading it up front put the route over the 200,000 B script
 * budget (§22). A signed-out person sees the request first and is asked to sign in when they allow.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Logomark from "@/components/logomark";
import { failureSentence } from "@/lib/workspace-failure-copy";

type View = { client: { name: string; redirectOrigin: string }; scopes: string[] };
type Phase =
  | { kind: "checking" }
  | { kind: "invalid"; description: string; back: { href: string; origin: string } | null }
  | { kind: "signed-out"; view: View }
  | { kind: "consent"; view: View }
  | { kind: "working"; view: View }
  | { kind: "unavailable"; code: string; status: number }
  | { kind: "leaving" };

const PARAMETERS = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"];

function requestFromQuery() {
  const query = new URLSearchParams(window.location.search);
  return Object.fromEntries(PARAMETERS.flatMap((name) => (query.has(name) ? [[name, query.get(name) ?? ""]] : [])));
}

async function sessionToken() {
  const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
  const client = getSupabaseBrowserClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

async function decide(decision: "describe" | "approve" | "deny", token: string | null) {
  const response = await fetch("/api/mcp/oauth/authorize", {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ decision, request: requestFromQuery() }),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body };
}

export default function OAuthAuthorizePage() {
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });

  const leave = useCallback((redirectTo: unknown) => {
    if (typeof redirectTo !== "string") return false;
    setPhase({ kind: "leaving" });
    window.location.replace(redirectTo);
    return true;
  }, []);

  const load = useCallback(async () => {
    setPhase({ kind: "checking" });
    try {
      const { status, body } = await decide("describe", null);
      if (body.code !== "AUTHORIZATION_REQUEST_VALID") {
        const back = body.code === "AUTHORIZATION_REQUEST_REJECTED" && typeof body.redirectTo === "string" ? body.redirectTo : null;
        setPhase({
          kind: "invalid",
          description: typeof body.description === "string" ? body.description : failureSentence(String(body.code ?? ""), status),
          back: back ? { href: back, origin: new URL(back).origin } : null,
        });
        return;
      }
      setPhase({ kind: "consent", view: { client: body.client, scopes: body.scopes } as View });
    } catch {
      setPhase({ kind: "invalid", description: failureSentence(null, 503), back: null });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const submit = async (decision: "approve" | "deny", view: View) => {
    setPhase({ kind: "working", view });
    try {
      const token = decision === "approve" ? await sessionToken() : null;
      if (decision === "approve" && !token) {
        setPhase({ kind: "signed-out", view });
        return;
      }
      const { status, body } = await decide(decision, token);
      if (leave(body.redirectTo)) return;
      if (status === 401) setPhase({ kind: "signed-out", view });
      else setPhase({ kind: "unavailable", code: String(body.code ?? ""), status });
    } catch {
      setPhase({ kind: "unavailable", code: "", status: 503 });
    }
  };

  const view = "view" in phase ? phase.view : null;

  return (
    <main id="main" className="auth" tabIndex={-1}>
      <header>
        <Link href="/" className="wordmark"><Logomark /><b>TAVONEL</b></Link>
      </header>
      <div className="auth-body">
        <div className="auth-card" aria-busy={phase.kind === "checking" || phase.kind === "working" || phase.kind === "leaving"}>
          <h1>
            {phase.kind === "invalid" ? "This connection request is not valid."
              : phase.kind === "unavailable" ? "AI connections are not available for this workspace yet."
                : phase.kind === "signed-out" ? "Sign in to connect an AI client."
                  : "Connect an AI client."}
          </h1>

          {phase.kind === "checking" || phase.kind === "leaving" ? (
            <p className="lead" role="status">{phase.kind === "checking" ? "Checking the request…" : "Returning to the client…"}</p>
          ) : null}

          {phase.kind === "invalid" ? (
            <p className="notice static" role="alert"><strong>Nothing was granted.</strong> {phase.description}</p>
          ) : null}

          {phase.kind === "invalid" && phase.back ? (
            <>
              <p className="lead">
                The client asked for the answer to go to <b>{phase.back.origin}</b>. Go back only if you started this
                connection there.
              </p>
              <div className="auth-actions">
                <a className="btn ghost" href={phase.back.href} rel="noreferrer">Return to {phase.back.origin}</a>
              </div>
            </>
          ) : null}

          {phase.kind === "unavailable" ? (
            <p className="notice static" role="alert">
              <strong>Nothing was granted.</strong>{" "}
              {phase.code === "TRIAL_FEATURE_NOT_INCLUDED"
                ? "Connecting an AI client needs a workspace that can hold API keys; a free evaluation cannot."
                : failureSentence(phase.code || null, phase.status)}
            </p>
          ) : null}

          {view ? (
            <>
              <p className="lead">
                <b>{view.client.name}</b> asks to read this workspace through the read-only MCP endpoint. The access token
                goes to <b>{view.client.redirectOrigin}</b>.
              </p>
              <ul className="auth-facts">
                <li><b>Read only.</b> It can list sources and active Worlds, search, ask and read evidence. It cannot upload, compile, activate, roll back or change billing.</li>
                <li><b>One workspace.</b> The token is bound to this workspace and expires after an hour. Revoke it under Workspace › Developers.</li>
                <li><b>Name not verified.</b> The client chose its own name. Check the address above before you allow it.</li>
                <li><b>Scopes.</b> {view.scopes.join(", ")}</li>
              </ul>
              <div className="auth-actions">
                {phase.kind === "signed-out" ? (
                  <>
                    <a className="btn" href="/login" target="_blank" rel="noopener">Sign in in a new tab</a>
                    <button className="btn ghost" type="button" onClick={() => void load()}>I have signed in</button>
                  </>
                ) : (
                  <>
                    <button className="btn" type="button" disabled={phase.kind === "working"} onClick={() => void submit("approve", view)}>Allow read-only access</button>
                    <button className="btn ghost" type="button" disabled={phase.kind === "working"} onClick={() => void submit("deny", view)}>Deny</button>
                  </>
                )}
              </div>
            </>
          ) : null}
        </div>
        <p className="fine auth-legal">
          <Link href="/docs/mcp">How the MCP connection works</Link> · <Link href="/privacy">Privacy notice</Link> ·{" "}
          <Link href="/security">Security</Link>
        </p>
      </div>
    </main>
  );
}
