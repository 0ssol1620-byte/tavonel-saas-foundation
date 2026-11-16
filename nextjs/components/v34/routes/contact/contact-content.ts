import type { Route } from "next";
import { v34Route } from "@/lib/v34/routes";

/*
  The words of /contact. Every sentence here is one the previous /contact page already printed:
  the three addresses, the acknowledgement target (read from lib/support-targets.ts at render
  time), the six first questions with their links, and the four things the optional questions in
  the form ask about. The training and provider answers are the /security rows. Nothing is a new
  claim about the product, and no figure is typed in this file.
*/

/** The registry paths this route links to; the route test requires each one to be live. */
export const CONTACT_REGISTRY_LINKS = ["pricing", "security"] as const;
export const registryPath = (key: (typeof CONTACT_REGISTRY_LINKS)[number]) => v34Route(key).path as Route;

/** Retained public pages that have no registry key. Each is checked against the file that serves it. */
export const RETAINED = { trust: "/trust", sources: "/sources" } as const;
export const retained = (path: (typeof RETAINED)[keyof typeof RETAINED]) => path as Route;

export const HERO = {
  eyebrow: "Contact",
  primary: { href: "#inquiry", label: "Write to us" },
  figureCaption: "A message is read by a person, and the reply comes from an address on this domain.",
} as const;

export const ADDRESSES = [
  { label: "General inquiries", email: "hello@tavonel.com" },
  { label: "Product support", email: "support@tavonel.com" },
  { label: "Vulnerability reports", email: "security@tavonel.com" },
] as const;

export const READ_BY_A_PERSON = "Every inquiry is read by a person, and the reply comes from an address on this domain.";
export const GENERAL_INBOX =
  "General inquiries to hello@tavonel.com are read by a person and carry the same one business day (KST) acknowledgement target.";
export const TELEPHONE_HOURS = "The telephone is answered during Korean business hours. Outside them, email reaches us sooner.";

export const FORM = {
  title: "Send an inquiry",
  lead: "The optional questions above the message box are what let the first reply come back with specifics rather than a request for more detail.",
} as const;

export const FIRST_QUESTIONS_TITLE = "Questions we get first";

export const PREPARE = {
  title: "Make the first reply specific",
  lead: "Four things settle most of a first conversation. The optional questions in the form ask about each of them, in closed lists, so nothing needs to be typed that a customer document could end up inside.",
  items: [
    ["Goal", "A specific question or task that should become easier."],
    ["Sources", "Types and approximate scope, without sharing confidential documents yet."],
    ["Boundaries", "Privacy, ownership, retention, permitted users and actions."],
    ["Acceptance", "Evidence quality, time saved, reliability and completion criteria."],
  ],
} as const;

export const FINAL = { title: "Compare plans." } as const;
export const FINAL_LABEL = "Pricing";
