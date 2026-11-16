import type { Route } from "next";
import { v34Route, type V34RouteKey } from "@/lib/v34/routes";

/*
  The words of the engineering page that are not the shared pieces' own. Plain data, so the guard
  test can read every sentence in one place. A destination is a registry key, never a typed path.
  There is no number here: counts, dates and labels of the standards record are read from the public
  reference corpus at render time.
*/

const to = (key: V34RouteKey): Route => v34Route(key).path;

export const HERO = {
  eyebrow: "Engineering references",
  secondary: { href: to("changes"), label: "See how changes compare" },
  caption: "An earlier and a later revision of a standard, with the requirement that differs traced to the page that states it.",
} as const;

export const REFERENCE = {
  eyebrow: "Public reference corpus",
  title: "A standards revision, kept as a Change record.",
  lead: "The public reference corpus keeps a NIST control catalog release as a Change record. It names the announcement it was read from and sits beside the publications that document it.",
  recordKind: "Change",
  sourceLabel: "Open the source",
  statsControls: "Control records",
  statsSources: "Standards sources",
} as const;

export const STEPS = {
  eyebrow: "How it goes",
  title: "From a revision to the requirement it changed.",
  items: [
    { title: "Add the standard or procedure", text: "Each requirement is compiled as a record that keeps the file it came from." },
    { title: "Read a requirement with its source", text: "Open a requirement and read the page and region that state it." },
    { title: "Compare versions", text: "Add the revised document as a new version and the Changes view lists what differs." },
  ],
} as const;

export const ACCESS = {
  eyebrow: "Read from your AI",
  title: "Your AI reads the requirement and its source.",
  lead: "A World is read through the MCP server with these tools. Every result carries its source, and the server only reads.",
  primary: { href: to("connect"), label: "Connect your AI" },
  secondary: { href: to("developers"), label: "API and MCP reference" },
} as const;

export const JOURNAL = {
  eyebrow: "Field guide",
  title: "Find the right requirement for the right revision.",
  text: "Read what changed in a NIST control catalog revision and how a World keeps both editions.",
  href: to("journal-revision"),
  label: "Read the revision guide",
} as const;

export const FINAL = { title: "Create a World from your standards and procedures." } as const;

/** Every route this page links to, for the guard test. */
export const ENGINEERING_DESTINATIONS: readonly string[] = [
  HERO.secondary.href, ACCESS.primary.href, ACCESS.secondary.href, JOURNAL.href,
];
