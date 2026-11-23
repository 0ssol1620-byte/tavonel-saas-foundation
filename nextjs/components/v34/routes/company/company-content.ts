import type { Route } from "next";
import { TRAINING_DATA_CLAIM } from "@/lib/security-claims";
import { v34Route } from "@/lib/v34/routes";

/*
  The words of /company. The page states principles and points to documents; it invents no
  founding date, team, investor, customer or figure. Every sentence below is one the product
  pages already make: the training claim is read from lib/security-claims.ts, the passage and
  review sentences are the /contact first answers and the /security caption, and the export
  sentence is what the signed package and its public verifier do. The operator's legal details
  are not written here at all: they come from the operator record through the shared disclosure.
*/

/** Retained public pages that have no registry key. Each is checked against the file that serves it. */
export const RETAINED = {
  trust: "/trust",
  privacy: "/privacy",
  terms: "/terms",
  subprocessors: "/subprocessors",
} as const;
export const retained = (path: (typeof RETAINED)[keyof typeof RETAINED]) => path as Route;

/** The registry paths this route links to; the route test requires each one to be live. */
export const COMPANY_REGISTRY_LINKS = ["platform", "security", "contact"] as const;
export const registryPath = (key: (typeof COMPANY_REGISTRY_LINKS)[number]) => v34Route(key).path as Route;

export const HERO = {
  eyebrow: "TAVONEL",
  figureCaption: "Your sources become a World, and the World is read by the AI you choose or leaves as a signed package.",
} as const;

export const OWN = {
  title: "Knowledge should belong to the people who create it",
  lead: "We are building a durable, independent layer between the information people own and the intelligence they choose to use.",
  items: [
    ["Own the source", TRAINING_DATA_CLAIM.body],
    ["Know the provenance", "Every passage keeps its page and region, so an answer can be followed back to the place it came from."],
    ["Choose the model", "A World is read over an open protocol, so the AI that uses it is your choice and can change."],
    ["Leave with your data", "A compiled package leaves as a signed export that anyone can verify, and source material can be deleted on request."],
  ],
} as const;

export const QUOTE = {
  line: "The next era of AI needs more than larger models. It needs better context.",
  body: [
    "Documents, notes, decisions and observations have value beyond the app that stores them. Their meaning should remain accessible across time, people and compatible intelligence systems.",
    "TAVONEL links that value to source evidence, revision history and explicit ownership.",
  ],
} as const;

export const PRINCIPLES = {
  title: "The principles behind the product",
  lead: "They decide what the product does when two good outcomes pull apart.",
  items: [
    ["Evidence before assurance", "A passage that cannot be verified is held for review and surfaced as such, not published as if it were verified."],
    ["Human agency", "Automated checks hold a result for review. Only a person makes it active, and it cannot silently replace the active World."],
    ["Changes in plain view", "Each compile is a version, and what changed between two versions can be compared before anyone relies on the new one."],
    ["Every document is hostile data", "Document reading runs on GPU workers TAVONEL operates, and no third-party model API receives your documents."],
  ],
} as const;

export const DOCUMENTS = {
  title: "Where our documents are",
  lead: "The terms, privacy, subprocessor and trust records are public.",
  items: [
    { href: RETAINED.trust, label: "Trust Center", text: "Privacy, subprocessor and disclosure records, and how a qualified review is handled." },
    { href: RETAINED.privacy, label: "Privacy notice", text: "How personal information is handled, and how to make a request." },
    { href: RETAINED.terms, label: "Terms of service", text: "The terms that govern the use of the service." },
    { href: RETAINED.subprocessors, label: "Subprocessors", text: "The providers that process data on our behalf." },
  ],
} as const;

export const OPERATOR = {
  title: "Who operates TAVONEL",
  lead: "The business that operates the service, as registered.",
} as const;

export const FINAL = { title: "Explore the platform." } as const;
export const FINAL_LABEL = "Platform";
