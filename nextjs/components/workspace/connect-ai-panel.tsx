"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DocsCopyButton } from "@/components/docs-copy-button";
import styles from "./connect-ai-panel.module.css";

/*
  W1-A1 "Connect AI" (PROGRAM-2026-11-04 §4.A): one MCP URL and the steps to add it to Claude or
  ChatGPT.

  Whether the remote endpoint is switched on is read from the deployment itself -- its RFC 9728
  document answers 200 when TAVONEL_REMOTE_MCP_ENABLED is on and 404 when it is off -- so the panel
  never offers a URL that 404s. It cannot know whether this workspace is in the canary cohort; the
  consent page says so if it is not, and nothing is granted.

  The client steps are written from each vendor's documentation, not from a completed handshake:
  W1-A1.1 ran the OAuth and MCP exchange with a scripted client against a local build, not with
  Claude or ChatGPT. The panel says that rather than implying a verified connection.
*/

/** The read-only scopes a token can hold. `lib/connect-ai-panel.test.ts` pins this to REMOTE_MCP_SCOPES. */
export const CONNECT_AI_SCOPES = ["ask:read", "collections:download", "collections:read", "documents:read", "worlds:read"] as const;

const CLIENTS = [
  {
    id: "claude",
    label: "Add to Claude",
    steps: [
      "In Claude (claude.ai or Claude Desktop), open Settings, then Connectors.",
      "Choose Add custom connector, name it TAVONEL and paste the MCP URL above.",
      "Choose Connect. A TAVONEL page opens: sign in, check the read-only permissions and choose Allow.",
      "In a chat, turn on the TAVONEL connector and ask about your active World.",
    ],
  },
  {
    id: "chatgpt",
    label: "Add to ChatGPT",
    steps: [
      "In ChatGPT, open Settings, then Apps & Connectors, then Advanced settings, and turn on Developer mode. It needs a plan that offers it.",
      "Create a connector named TAVONEL with the MCP URL above and OAuth as its authentication.",
      "Sign in on the TAVONEL page that opens, check the read-only permissions and choose Allow.",
      "In a chat, choose Developer mode, add TAVONEL and ask about your active World.",
    ],
  },
] as const;
type ClientId = (typeof CLIENTS)[number]["id"];
type Availability = "checking" | "available" | "off" | "unknown";

export default function ConnectAiPanel({ headingLevel: Heading = "h3" }: { headingLevel?: "h2" | "h3" }) {
  const [availability, setAvailability] = useState<Availability>("checking");
  const [origin, setOrigin] = useState("https://tavonel.com");
  const [client, setClient] = useState<ClientId>("claude");

  useEffect(() => {
    setOrigin(window.location.origin);
    let live = true;
    fetch("/.well-known/oauth-protected-resource/api/mcp", { cache: "no-store" })
      .then((response) => { if (live) setAvailability(response.ok ? "available" : response.status === 404 ? "off" : "unknown"); })
      .catch(() => { if (live) setAvailability("unknown"); });
    return () => { live = false; };
  }, []);

  const url = `${origin}/api/mcp`;
  const selected = CLIENTS.find((entry) => entry.id === client)!;

  return (
    <section className={styles.panel} aria-labelledby="connect-ai-title" data-testid="connect-ai-panel">
      <Heading id="connect-ai-title">Connect Claude or ChatGPT</Heading>
      {availability === "off" ? (
        <p role="status">
          The hosted MCP endpoint is not switched on for this deployment yet. Until it is, use the local MCP bridge with an API key.{" "}
          <Link href="/docs/mcp">Local MCP setup</Link>
        </p>
      ) : availability === "unknown" ? (
        <p role="status">We could not check whether the hosted MCP endpoint is on. Reload to try again, or use the <Link href="/docs/mcp">local MCP bridge</Link>.</p>
      ) : (
        <>
          <p>One URL for any MCP client that signs in with OAuth. Your assistant reads; it cannot upload, compile, activate or change anything.</p>
          <div className={styles.urlRow}>
            <code className={styles.url} aria-label="MCP URL">{url}</code>
            <DocsCopyButton value={url} label="Copy URL" />
          </div>
          {availability === "checking" ? <p className={styles.note} role="status">Checking that the endpoint is on…</p> : null}
          <fieldset className={styles.clients}>
            <legend>Which assistant?</legend>
            {CLIENTS.map((entry) => (
              <label key={entry.id} className={styles.choice}>
                <input type="radio" name="connect-ai-client" value={entry.id} checked={client === entry.id} onChange={() => setClient(entry.id)} />
                {entry.label}
              </label>
            ))}
          </fieldset>
          <ol className={styles.steps} aria-label={`${selected.label} steps`}>
            {selected.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          <details className={styles.more}>
            <summary>What the assistant can read, and for how long</summary>
            <ul>
              <li>Permissions: {CONNECT_AI_SCOPES.map((scope, index) => <span key={scope}>{index > 0 ? ", " : ""}<code>{scope}</code></span>)}. Nothing that writes.</li>
              <li>One workspace. The access lasts one hour and is not renewed in the background, so your assistant asks you to reconnect after that.</li>
              <li>Each connection appears as an API key named <code>MCP: …</code> under Workspace › Developers; revoking it ends access on the next request.</li>
              <li>Open to the current pilot workspaces. If yours is not one yet, the sign-in page says so and nothing is granted.</li>
            </ul>
          </details>
          <p className={styles.note}>
            Menu names follow each vendor&rsquo;s documentation and can move. TAVONEL has not yet completed this connection with Claude or ChatGPT themselves, so treat the first request as the test.
          </p>
        </>
      )}
    </section>
  );
}
