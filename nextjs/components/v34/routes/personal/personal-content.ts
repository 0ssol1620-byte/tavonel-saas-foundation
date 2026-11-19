import type { Route } from "next";
import { v34Route, type V34RouteKey } from "@/lib/v34/routes";

/*
  The words of the personal page that are not the shared pieces' own. Plain data, so the guard
  test can read every sentence in one place. A destination is a registry key, never a typed path;
  there is no number here (the tool list is counted at render time, ordinals come from position).
*/

const to = (key: V34RouteKey): Route => v34Route(key).path;

export const HERO = {
  eyebrow: "For individuals",
  secondary: { href: to("connect"), label: "Connect your AI" },
  caption: "Pages of your PDFs become records, and each answer carries a link back to its page.",
} as const;

export const HOLDS = {
  eyebrow: "Your World",
  title: "Your own files, kept together with their evidence.",
  lead: "A personal World is built from the PDFs you choose to add. It belongs to your workspace and keeps the page behind every record.",
  items: [
    { title: "Your PDFs", text: "Course notes, books, papers, plans and records, added when you decide to add them." },
    { title: "Cited answers", text: "Ask a question and read the answer next to the pages it was taken from." },
    { title: "Your MCP client", text: "An MCP client that runs the local server reads the World with an API key from a paid plan, and you can revoke that key whenever you like." },
  ],
} as const;

export const STEPS = {
  eyebrow: "How it goes",
  title: "From a file to a cited answer.",
  items: [
    { title: "Add your PDFs", text: "Start with the few files that matter to one goal." },
    { title: "Check the first result", text: "Open the records the compiler found and read each against its page." },
    { title: "Ask and follow the citation", text: "Every answer links to the page and region it came from." },
  ],
} as const;

export const ACCESS = {
  eyebrow: "Read from your AI",
  title: "Your AI reads the World. You hold the key.",
  lead: "A personal World is read through the MCP server with these tools. Each client uses an API key you create, and you can revoke any key from your workspace at any time.",
  primary: { href: to("connect"), label: "Connect your AI" },
  secondary: { href: to("developers"), label: "API and MCP reference" },
} as const;

export const JOURNAL = {
  eyebrow: "Field guide",
  title: "Start with a question worth remembering.",
  text: "Choose a small set of your files and confirm the cited answer before you add more.",
  href: to("journal-compiler"),
  label: "Understand the workflow",
} as const;

export const FINAL = { title: "Create a World from your own PDFs." } as const;

/** Every route this page links to, for the guard test. */
export const PERSONAL_DESTINATIONS: readonly string[] = [
  HERO.secondary.href, ACCESS.primary.href, ACCESS.secondary.href, JOURNAL.href,
];
