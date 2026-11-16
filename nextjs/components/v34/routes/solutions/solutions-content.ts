import type { Route } from "next";
import { v34Route, type V34RouteKey } from "@/lib/v34/routes";

/*
  The words of /solutions that are not the shared pieces' own, as plain data so the guard test
  reads every sentence in one place. The page's title and lead are the registry's.

  A destination is a registry key, never a typed path: `to()` resolves it and the test fails if the
  route it names is held. The five documented workflows are not copied here; the page reads them
  from the SOLUTIONS record the detail pages render, so a card cannot outlive its page.
*/

const to = (key: V34RouteKey): Route => v34Route(key).path;

export interface SolutionLink {
  readonly key: V34RouteKey;
  readonly kicker: string;
  readonly title: string;
  readonly text: string;
  readonly href: Route;
}

const link = (key: V34RouteKey, kicker: string, title: string, text: string): SolutionLink => ({ key, kicker, title, text, href: to(key) });

export const HERO = {
  eyebrow: "Solutions",
  art: "How documents, a World and the people who read it fit together.",
} as const;

export const ROLES = {
  eyebrow: "Who it is for",
  title: "Choose a path that fits your work.",
  lead: "Each path opens a page that shows what a compiled World does for that way of working.",
  items: [
    link("personal", "Individuals", "Your own PDFs, cited.", "Compile your own PDFs into a World, follow each answer back to the page it came from and read it from an MCP client."),
    link("research", "Students and researchers", "A research record that cites its sources.", "Keep papers and notes as a World where every claim links to the source that supports it."),
    link("enterprise", "Organizations", "Scope a deployment with us.", "Residency, private deployment and single sign-on are scoped with you before anything is promised."),
    link("developers", "Developers and agent builders", "Read a World from code.", "Use read-only MCP tools and the HTTP API, with PKCE sign-in and API keys you can revoke."),
  ] satisfies readonly SolutionLink[],
} as const;

export const FIELDS = {
  eyebrow: "Where the sources are",
  title: "Built for repeatable, evidence-intensive work.",
  lead: "Each field starts from the documents it already relies on.",
  items: [
    link("engineering", "Engineering and technical support", "Standards and procedures with revision history.", "Keep standards and procedures as a World where each requirement cites its source and a revision shows exactly which controls changed."),
    link("markets", "Finance and market research", "Filings, compiled and cited.", "Explore a compiled sample of SEC filings and follow each figure to the filing that states it."),
  ] satisfies readonly SolutionLink[],
} as const;

export const TASKS = {
  eyebrow: "By task",
  title: "Start with the work you need to do.",
  lead: "Choose the input you have and the output you need, then inspect the workflow, a sample source and the published limits.",
} as const;

export const BRIDGE = {
  eyebrow: "Field guide",
  title: "Find a useful starting method.",
  text: "Field guides on compiling documents, connecting an AI over MCP and tracking revisions.",
  href: to("journal"),
  label: "Choose a field guide",
} as const;

export const FINAL = { title: "Find your starting point." } as const;

/** Every internal destination the page can render by key, for the release guard. */
export const SOLUTIONS_DESTINATIONS: readonly Route[] = [
  ...ROLES.items.map((i) => i.href),
  ...FIELDS.items.map((i) => i.href),
  BRIDGE.href,
];
