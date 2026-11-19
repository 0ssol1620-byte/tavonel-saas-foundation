import type { Route } from "next";
import { TRAINING_DATA_CLAIM } from "@/lib/security-claims";
import { v34Route } from "@/lib/v34/routes";

/*
  The words of /security. Every statement here is one the previous /security page already made
  (the processing path, the eight controls, the assurance paragraph) or one the signed-export
  verifier states about itself in its own header (`public/developer/tavonel-verify-export.mjs`).
  The provision rows are not written here at all: they come from `content/trust/provisions.ts`.
  Numbers are never typed in this file; the sample package's figures are read from
  `lib/signed-product-demo.ts` at render time.
*/

/** Retained public pages that have no registry key. Each is checked against the file that serves it. */
export const RETAINED = {
  trust: "/trust",
  privacy: "/privacy",
  subprocessors: "/subprocessors",
  verifier: "/developer/tavonel-verify-export.mjs",
  exportTrust: "/api/export/trust",
} as const;

export const retained = (path: (typeof RETAINED)[keyof typeof RETAINED]) => path as Route;

/** The registry paths this route links to; the route test requires each one to be live. */
export const SECURITY_REGISTRY_LINKS = ["contact", "evidence"] as const;
export const registryPath = (key: (typeof SECURITY_REGISTRY_LINKS)[number]) => v34Route(key).path;

export const HERO = {
  eyebrow: "Security",
  primary: { href: RETAINED.trust, label: "Open the Trust Center" },
  secondary: { href: RETAINED.subprocessors, label: "Subprocessors" },
  figureCaption: "A document passes four stages inside its workspace. Only a person makes the result active.",
} as const;

/** The page-jump index, in page order. Each id is a Section id below. */
export const JUMP = [
  { id: "boundary", label: "Processing boundary" },
  { id: "controls", label: "Controls" },
  { id: "verify", label: "Verify an export" },
  { id: "provisions", label: "What is in place" },
  { id: "assurance", label: "Assurance and review" },
] as const;

export const BOUNDARY = {
  title: "The enforced processing boundary",
  lead: "Sources remain workspace-scoped through intake, analysis and review. Activation remains under human control, and a check that cannot complete blocks the action rather than allowing it.",
  steps: [
    ["Isolate", "Sources enter a workspace-scoped intake boundary and remain separated from other workspaces."],
    ["Sanitize", "Required safety checks complete before source material can move to document analysis."],
    ["Compile", "Only admitted source versions can contribute evidence to a candidate World."],
    ["Review", "A candidate remains inactive until an authorized person approves it."],
  ],
} as const;

export const CONTROLS = {
  title: "Controls customers can rely on",
  items: [
    ["Workspace isolation", "Identity and workspace membership are resolved server-side. Data access is scoped to the authenticated workspace and rechecked at protected operations."],
    ["Data protection", "Traffic is encrypted in transit, stored objects are encrypted at rest, and service credentials remain on trusted server boundaries."],
    [TRAINING_DATA_CLAIM.label, TRAINING_DATA_CLAIM.body],
    ["Source controls", "A source that is suspended, deleted or cannot be verified is refused before it can be searched, exported or activated."],
    ["Evidence and audit", "Source versions, evidence references, review decisions and sensitive administration events are recorded so an authorized reviewer can trace what happened."],
    ["Human activation", "Automated processing can prepare a candidate. It cannot silently replace the active World."],
    ["Retention and deletion", "Retention and deletion follow the applicable workspace policy and legal-hold state. The public privacy notice describes the customer-facing process."],
    ["Fail-closed operation", "If a required identity, policy, source or processing check cannot be completed, the protected action is refused rather than treated as successful."],
  ],
} as const;

export const VERIFY = {
  title: "Verify an export yourself",
  lead: "Export a signed candidate package with its source inventory, provenance and validation record, and check it on your own machine.",
  body: [
    "The verifier is one Node script that imports only the Node standard library, so checking a download needs no install. It reports success when the archive is intact and signed by the key whose fingerprint you pass in.",
    "The fingerprint comes from the trust endpoint, so it is never taken from the archive being checked.",
  ],
  links: [
    { href: RETAINED.verifier, label: "Download the verifier" },
    { href: RETAINED.exportTrust, label: "Read the trust endpoint" },
  ],
  sampleTitle: "Signed sample package",
} as const;

export const PROVISIONS = {
  title: "What is in place, what is coming, and what is absent",
  lead: "Every row below is already stated on the page it links to. This is the same record in the order a security review asks for it.",
} as const;

export const ASSURANCE_TITLE = "Assurance and review";

export const NEXT = {
  eyebrow: "Next in the trust sequence",
  action: "See how evidence is bound",
} as const;

export const FINAL = { title: "Send a security question.", label: "Contact" } as const;
