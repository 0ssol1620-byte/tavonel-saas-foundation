import type { Route } from "next";
import { v34Route, type V34RouteKey } from "@/lib/v34/routes";

/*
  The words of the teams page (a held route) that are not the shared pieces' own. Plain data, so the
  guard test can read every sentence in one place. A destination is a registry key, never a typed
  path. The page describes what it is for and promises no date, role, permission or price.
*/

const to = (key: V34RouteKey): Route => v34Route(key).path;

export const HERO = {
  eyebrow: "Preview for groups",
  secondary: { href: to("evidence"), label: "See the evidence behind an answer" },
  caption: "Several readers around one World, each answer tied to the same source page.",
} as const;

export const PURPOSE = {
  eyebrow: "What a shared World is for",
  title: "One World, read by a whole group.",
  lead: "A shared World gives a group one compiled body of knowledge to read and check together.",
  items: [
    { title: "One body of knowledge", text: "Everyone reads the same records, each tied to the page it came from." },
    { title: "Checked against the source", text: "A claim is settled by opening its source rather than by recalling it." },
    { title: "Changes in view", text: "When a source is revised, the group sees what differs between versions." },
  ],
} as const;

export const ACCESS = {
  eyebrow: "Read from your AI",
  title: "Every reader's AI reads the same records.",
  lead: "A World is read through the MCP server with these tools. Every result carries its source, and the server only reads.",
  primary: { href: to("connect"), label: "Connect your AI" },
  secondary: { href: to("developers"), label: "API and MCP reference" },
} as const;

export const JOURNAL = {
  eyebrow: "Field guide",
  title: "Start with a question your group asks again and again.",
  text: "Name the source that answers it, then check each answer against that source.",
  href: to("journal-revision"),
  label: "Read the revision guide",
} as const;

export const FINAL = { title: "Create a World from your group's documents." } as const;

/** Every route this page links to, for the guard test. */
export const TEAMS_DESTINATIONS: readonly string[] = [
  HERO.secondary.href, ACCESS.primary.href, ACCESS.secondary.href, JOURNAL.href,
];
