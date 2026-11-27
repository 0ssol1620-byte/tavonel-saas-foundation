"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DocsCopyButton } from "@/components/docs-copy-button";
import styles from "./connect-ai-panel.module.css";

/*
  W1-A1 "Connect AI" (PROGRAM-2026-11-04 §4.A): one MCP URL and the steps to add it to Claude or
  ChatGPT.

  Whether the remote endpoint is switched on comes from the server: the workspace layout reads
  TAVONEL_REMOTE_MCP_ENABLED and provides it here (RemoteMcpAvailability), so the panel never offers
  a URL that 404s and never makes a request that does. A deployment's env is fixed with its build
  (RELEASE_ORDER.md, W1-A1), which is the same value the endpoint itself reads. It cannot know
  whether this workspace is in the canary cohort; the consent page says so if it is not, and
  nothing is granted.

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

/*
  Whether this deployment serves /api/mcp. WO-REL-4 closing round: where no server said (no provider
  above the panel), the panel is switched off -- it used to show the remote steps then, so a page that
  forgot the layout offered a URL that answers 404. Only a server's `true` opens it.
*/
/*
  WO-FIRST5-P1 (#11, #19). Two more server reads ride the same provider, as booleans and a day count,
  never an env value: whether a free evaluation may connect (TAVONEL_TRIAL_AI_ACCESS_ENABLED, the flag
  the token endpoint refuses on) and the refresh window when TAVONEL_REMOTE_MCP_REFRESH_ENABLED is on
  (null when off). Absent, both read as off, which is what the panel said before.
*/
type AvailabilityValue = { enabled: boolean; trialAiAccess: boolean; refreshDays: number | null };
const Availability = createContext<AvailabilityValue>({ enabled: false, trialAiAccess: false, refreshDays: null });
export function RemoteMcpAvailability({ enabled, trialAiAccess = false, refreshDays = null, children }: {
  enabled: boolean; trialAiAccess?: boolean; refreshDays?: number | null; children?: ReactNode;
}) {
  const value = { enabled: enabled === true, trialAiAccess: trialAiAccess === true, refreshDays: typeof refreshDays === "number" && refreshDays > 0 ? refreshDays : null };
  return <Availability.Provider value={value}>{children}</Availability.Provider>;
}

/** Whether a free evaluation may connect an assistant, as the layout read it; false where no server said. */
export const useTrialAiAccess = () => useContext(Availability).trialAiAccess;

/** `trial`: this workspace is on a free evaluation, as the workspace's own access read says. */
export default function ConnectAiPanel({ headingLevel: Heading = "h3", trial = false }: { headingLevel?: "h2" | "h3"; trial?: boolean }) {
  const { enabled, trialAiAccess, refreshDays } = useContext(Availability);
  const [origin, setOrigin] = useState("https://tavonel.com");
  const [client, setClient] = useState<ClientId>("claude");

  useEffect(() => { setOrigin(window.location.origin); }, []);

  const url = `${origin}/api/mcp`;
  const selected = CLIENTS.find((entry) => entry.id === client)!;

  return (
    <section className={styles.panel} aria-labelledby="connect-ai-title" data-testid="connect-ai-panel">
      {/* WO-REL-4: switched off, the panel names what a client can use here, the local bridge, and no hosted client. */}
      <Heading id="connect-ai-title">{enabled ? "Connect Claude or ChatGPT" : "Connect an MCP client"}</Heading>
      {!enabled ? (
        <>
          <p role="status">An MCP client reads your active World through the local MCP bridge, with an API key from a paid plan.</p>
          <Link className="btn btn-ghost" href="/docs/mcp">Local MCP setup</Link>
        </>
      ) : trial && !trialAiAccess ? (
        /* WO-FIRST5-P1 (#11): said here, before the customer sets up their AI, not on the sign-in page after it. */
        <>
          <p role="status">A free evaluation cannot connect Claude or ChatGPT. A paid plan can. You can keep asking your World on this page.</p>
          <Link className="btn btn-ghost" href="/pricing">See plans</Link>
        </>
      ) : (
        <>
          <p>One URL for any MCP client that signs in with OAuth. Your assistant reads; it cannot upload, compile, activate or change anything.</p>
          <div className={styles.urlRow}>
            <code className={styles.url} aria-label="MCP URL">{url}</code>
            <DocsCopyButton value={url} label="Copy URL" />
          </div>
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
              <li>{refreshDays === null
                ? "One workspace. The access lasts one hour and is not renewed in the background, so your assistant asks you to reconnect after that."
                : `One workspace. The access renews while your assistant uses it and lasts up to ${refreshDays} days without use.`}</li>
              <li>Each connection appears as an API key named <code>MCP: …</code> under Workspace › Developers; revoking it ends access on the next request.</li>
              <li>{trialAiAccess ? "A paid workspace or a free evaluation can connect." : "A paid workspace can connect."} During a canary only named workspaces can, and if yours is not one the sign-in page says so and nothing is granted.</li>
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
