import type { Route } from "next";
import { v34Route, type V34RouteKey } from "@/lib/v34/routes";

/*
  The words of the home page that are not the shared pieces' own. Plain data, so the guard test can
  read every sentence in one place.

  Two rules hold for everything here:
  - A destination is a registry key, never a typed path. `to()` resolves it, and the test fails if
    the route it names is held, so a link cannot point at a page that answers 404.
  - There is no number in this file. Counts come from the corpus snapshot at render time, and the
    ordinals ("01", "02") are counted from the list position.
*/

/** The path of a registered route. */
const to = (key: V34RouteKey): Route => v34Route(key).path;

export const HERO = {
  eyebrow: "Knowledge compiler for AI",
  titleLead: "Turn your files into ",
  titleAccent: "knowledge your AI can trust.",
  lead: "Keep meaning, evidence and history together, ready for the AI you use.",
  note: "Your sources. Your choice of AI.",
  secondary: "See how it works ↓",
  worldLink: { href: to("world"), label: "Inspect the World →" },
} as const;

/** The anchor the secondary hero action scrolls to. */
export const WALKTHROUGH_ANCHOR = "walkthrough";

export const WALKTHROUGH = {
  eyebrow: "From source to answer",
  title: "See the difference knowledge makes.",
  lead: "Follow one real public source through the knowledge lifecycle, from its original release to an evidence-linked answer.",
  foot: "Fixed, source-backed records from the public reference corpus.",
  links: [
    { href: to("compiler"), label: "Understand the compiler →" },
    { href: to("studio"), label: "Open the reference walkthrough →" },
  ],
} as const;

export interface HomeCase {
  readonly label: string;
  readonly title: string;
  readonly text: string;
  readonly tag: string;
  readonly href: Route;
}

/*
  Three live pages. The prototype's fourth case (real estate) points at a held route, and its
  "right procedure" and "without hindsight" lines name behaviour that is not shipped, so each case
  below says only what the page it opens shows today.
*/
export const CASES = {
  eyebrow: "Built around the decision",
  title: "Expertise, without the missing context.",
  lead: "Start where incomplete, outdated or disconnected information costs you time.",
  all: { href: to("solutions"), label: "All workflows →" },
  items: [
    {
      label: "Engineering",
      title: "Your standard changed. Did your answer?",
      text: "See which controls a new revision changed and follow each requirement to the source that states it.",
      tag: "Revision / exact source",
      href: to("engineering"),
    },
    {
      label: "Markets",
      title: "Every figure has a filing behind it.",
      text: "Follow a figure to the filing that states it and compare reporting periods side by side.",
      tag: "Filing / reporting period",
      href: to("markets"),
    },
    {
      label: "Research",
      title: "A claim stays tied to its evidence.",
      text: "Follow a claim to the observation behind it and see where the evidence is still uncertain.",
      tag: "Claim / evidence / limitation",
      href: to("research"),
    },
  ] satisfies readonly HomeCase[],
} as const;

/* The two ways to read a World that ship today: the stdio MCP server and the HTTP API. */
export const CONNECT = {
  eyebrow: "Bring your own AI",
  title: "One World. Many ways to work.",
  lead: "Read a World from any MCP client or call the HTTP API. Configuration steps are on the Connect page.",
  primary: { href: to("connect"), label: "Connect your AI →" },
  secondary: { href: to("developers"), label: "Build with the API →" },
  origin: { name: "Your World", detail: "Versioned records with their evidence" },
  hosts: [
    { name: "MCP client", detail: "Reads through the stdio server" },
    { name: "HTTP API", detail: "Calls the versioned API" },
  ],
} as const;

export const TRUST = {
  eyebrow: "Evidence is part of the product",
  title: "Trust is something you can inspect.",
  lead: "Knowledge stays accountable to its original source and its history.",
  items: [
    { kicker: "Provenance", title: "Follow the source.", text: "Inspect the evidence behind a claim and what remains unresolved.", label: "Explore evidence →", href: to("evidence") },
    { kicker: "Time", title: "Keep the history.", text: "Compare two versions of a World and see what changed between them.", label: "Explore changes →", href: to("changes") },
    { kicker: "Control", title: "Control the access.", text: "Create API keys for your tools and revoke one whenever you choose.", label: "Explore security →", href: to("security") },
  ],
} as const;

export const JOURNAL = {
  eyebrow: "TAVONEL Journal",
  title: "What is a knowledge compiler?",
  href: to("journal-compiler"),
  label: "Read the field guide",
} as const;

export const FINAL = { title: "Make what you know work for you." } as const;

/** Every internal destination the page can render, for the release guard. */
export const HOME_DESTINATIONS: readonly Route[] = [
  HERO.worldLink.href,
  ...WALKTHROUGH.links.map((l) => l.href),
  CASES.all.href,
  ...CASES.items.map((c) => c.href),
  CONNECT.primary.href,
  CONNECT.secondary.href,
  ...TRUST.items.map((t) => t.href),
  JOURNAL.href,
];
