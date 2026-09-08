/**
 * The public capability grid, as a pure function.
 *
 * This lived inside `app/page.tsx` and was described in the documentation as "structurally
 * fail-closed" -- a claim nothing checked. It is the one table on the marketing page that makes
 * factual assertions about what this deployment can actually do, so the claim needs a test rather
 * than a reader's trust in the control flow. Moving it here is what makes that test possible.
 *
 * Fail-closed by construction: every row starts "unknown", and only a successful response moves
 * one to "open". A status endpoint that is unreachable, slow or malformed leaves the grid saying
 * it does not know -- never that a capability is available.
 */

import { DISCLOSURE } from "./demo-world";

export type StatusResponse = {
  mode?: string;
  commercialMode?: "pilot" | "live";
  activationPolicy?: Record<string, { enabled?: boolean; reason?: string }>;
  auth?: string;
  billing?: string;
  r2?: string;
};

export type CapabilityTone = "open" | "closed" | "direction" | "unknown";

export type Capability = {
  name: string;
  state: string;
  tone: CapabilityTone;
  note: string;
};

/** Every tone that must never appear without a successful, well-formed response. */
export const AFFIRMATIVE_TONES: CapabilityTone[] = ["open"];

export function readCapabilities(status: StatusResponse | null, failed: boolean): Capability[] {
  const policy = status?.activationPolicy ?? {};

  const gate = (key: string, name: string, openText: string, closedText: string): Capability => {
    if (failed) return { name, state: "Unknown", tone: "unknown", note: "Status could not be read from this deployment." };
    const entry = policy[key];
    if (!status || entry?.enabled === undefined) return { name, state: "Checking", tone: "unknown", note: "Reading live deployment state." };
    return entry.enabled
      ? { name, state: "Open", tone: "open", note: entry.reason ?? openText }
      : { name, state: "Closed", tone: "closed", note: entry.reason ?? closedText };
  };

  const flag = (value: string | undefined, name: string, openValues: string[], openText: string, closedText: string): Capability => {
    if (failed) return { name, state: "Unknown", tone: "unknown", note: "Status could not be read from this deployment." };
    if (!status || !value) return { name, state: "Checking", tone: "unknown", note: "Reading live deployment state." };
    return openValues.includes(value)
      ? { name, state: "Configured", tone: "open", note: openText }
      : { name, state: "Not configured", tone: "closed", note: closedText };
  };

  return [
    gate("customerIntake", "Document intake", "Private-pilot intake is open.", "Intake is closed in this deployment."),
    gate("cdr", "Content disarm", "Sanitization runs before anything is read.", "Sanitization is not active."),
    gate("ocrGpu", "OCR on scans", "Qualified GPU OCR is available.", "GPU OCR is gated."),
    gate("candidatePromotion", "Promotion to the live world", "", "Promotion is always an explicit human decision. Closed on purpose, not pending."),
    gate("customerData", "Customer-data compilation", "", "This deployment compiles synthetic sources only. Customer data stays gated until every named security precondition has evidence."),
    flag(status?.auth, "Google sign-in", ["google_oauth_configured"], "Sign-in is available to pilot users.", "No auth provider is configured here."),
    flag(
      status?.billing,
      "Checkout and credits",
      ["sandbox_checkout_ready", "live_checkout_ready"],
      status?.billing === "live_checkout_ready"
        ? "Paddle live checkout is configured. Entitlements still require a verified webhook."
        : "Paddle sandbox checkout is complete. Live mode is not enabled.",
      "Paddle checkout is not fully configured.",
    ),
    flag(status?.r2, "Quarantine storage", ["signer_configured"], "The scoped upload signer is configured.", "No upload signer is configured here."),
    // Direction, not Concept and not shipped: the page demonstrates both of these in depth while
    // claiming neither is a finished production feature. They are the two rows where an overclaim
    // would be most tempting, so they are the two rows marked explicitly.
    { name: "Knowledge architecture", state: "Direction", tone: "direction", note: DISCLOSURE.ontology },
    { name: "Selective recompilation", state: "Direction", tone: "direction", note: "Demonstrated above on fixture data. Not offered as a shipped capability in this deployment." },
  ];
}
