import type { Route } from "next";
import { EXPLORE_CTA } from "@/lib/site-navigation";
import { v34Route } from "@/lib/v34/routes";

/*
  The words of /enterprise. Every statement is one the previous /enterprise page already made.
  Nothing is added about certification, audit, residency, sign-in or private deployment:
  those three subjects appear as "Scoped with you" cards whose body is the provision row's own
  sentence, read from `content/trust/provisions.ts` at render time. The sample's figures are read
  from `lib/signed-product-demo.ts`. No price, plan or count is typed in this file.
*/

/** Retained public pages and policy files that have no registry key. Each is checked against what serves it. */
export const RETAINED = {
  trust: "/trust",
  terms: "/terms",
  demo: "/demo",
  addendum: "/policy/TAVONEL_PROCESSING_ADDENDUM_2026-09-30.md",
  dpaTemplate: "/policy/TAVONEL_DPA_v2_2026-09-23.md",
} as const;

export const retained = (path: (typeof RETAINED)[keyof typeof RETAINED]) => path as Route;

/** The registry paths this route links to; the route test requires each one to be live. */
export const ENTERPRISE_REGISTRY_LINKS = ["contact", "security", "pricing"] as const;
export const registryPath = (key: (typeof ENTERPRISE_REGISTRY_LINKS)[number]) => v34Route(key).path;

export const HERO = {
  eyebrow: "Enterprise",
  primary: "Scope an Enterprise pilot",
  secondary: { href: EXPLORE_CTA.href, label: EXPLORE_CTA.label },
  figureCaption: "A source becomes a candidate, a reviewer decides, and only then does it become the active World.",
} as const;

export const TASKS = {
  title: "What your team can do",
  lead: "Turn approved manuals, contracts, policies and reports into a versioned World. Every answer can return to its source, and a person on your side decides what becomes active.",
  items: [
    ["Find answers in approved material", "Search the active World and open the source version and exact region behind an answer."],
    ["Review what changed", "Compare a candidate with the active World before a person decides whether it becomes available."],
    ["Take a verifiable result with you", "Export a signed candidate package with its source inventory, provenance and validation record."],
  ],
} as const;

export const TRACE = {
  title: "Follow one result back to its source",
  steps: [
    ["Source", "A labeled sample page and source version."],
    ["Change", "A candidate records what was added, changed or removed."],
    ["Approval", "A person accepts or refuses the candidate; there is no silent activation."],
    ["Result", "An answer opens its evidence, and a signed candidate package can be verified offline."],
  ],
} as const;

export const OPERATIONS = {
  title: "How it is run",
  items: [
    ["Identity", "Workspace access is authenticated and scoped to the workspace throughout protected operations."],
    ["Data handling", "Sources enter a workspace-scoped intake boundary and are sanitized before downstream processing. Current processors are listed in the Trust Center."],
    ["Retention and deletion", "Source material, derived artifacts and packages are deletable on request, with the deletion path described in the privacy notice."],
    ["Review records", "Compile progress, review decisions, and relevant administration events can be included in the evidence agreed during scoping."],
    ["Deployment review", "Before a pilot we walk through your sources, volumes, network path, retention needs and the security questions your team has to answer internally."],
    ["Support", "A named contact through the pilot, with response expectations agreed in writing during scoping."],
  ],
} as const;

export const PILOT = {
  title: "From scope to activation",
  steps: [
    ["Scope", "Agree the decision to improve, the permitted source set and the supported intake path."],
    ["Evaluate", "Compile approved material in a controlled pilot and keep unavailable states visible."],
    ["Measure", "Review source evidence, changes, refusals and the agreed result measures together."],
    ["Activate", "Contract and enable a customer workspace only after the evidence and control gates pass."],
  ],
  outcome:
    "A pilot produces an agreed source inventory, reviewable candidate results, evidence-linked findings and a written go/no-go record. We agree the permitted inputs and named-contact support before any material is provided. An Enterprise pilot is scoped with us rather than bought online.",
} as const;

/** The three subjects the registry description names (it spells the last one out; the claims guard keeps that spelling out of component files). Each card's body is the provision row `provision`. */
export const SCOPED = {
  title: "Scoped with you",
  lead: "Residency, private deployment and how people sign in are scoped with you before anything is promised. Each card shows where that subject stands today.",
  label: "Where it stands today",
  cards: [
    { title: "Residency", provision: "data_residency" },
    { title: "Private deployment", provision: "self_hosting" },
    { title: "Sign-in and roles", provision: "roles_sso_seats" },
  ],
} as const;

export const REVIEW = {
  title: "What a security review gets, and what it does not",
} as const;

export const COST = {
  title: "What an engagement costs",
  paragraph:
    "An enterprise number is quoted after the deployment review, against your page volume, your source types and the work that connecting them takes — never before it, because every part of that quote depends on what the review finds.",
} as const;

/**
 * The "On this page" index (lead decision 11, the /security pattern), in page order, named by each
 * section's own title. A section's id is a key of this map (`satisfies JumpId` in enterprise.tsx).
 */
export const JUMP = {
  team: TASKS.title,
  trace: TRACE.title,
  run: OPERATIONS.title,
  pilot: PILOT.title,
  scoped: SCOPED.title,
  review: REVIEW.title,
  cost: COST.title,
} as const;
export type JumpId = keyof typeof JUMP;

export const FINAL = {
  title: "Plan a scoped evaluation.",
  secondary: "How your documents are handled",
} as const;
