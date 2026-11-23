import { v34Route } from "@/lib/v34/routes";

/*
  The words of the creators page that are not the shared pieces'. Plain data, so the guard test can
  read every sentence in one place. No number is typed here: ordinals are counted from list position.
  The route is held, so every line says what the page is for and promises no date.
*/

export const ART = {
  title: "Protect the world you are writing",
  lead: "What a writer checks before a scene goes in: the characters, the text they come from, and the revision that settles it.",
  label: "Characters and a chapter timeline on one canon line, with draft branches that stay off it",
  caption: "Canon is the solid line. Drafts branch from it and stay open until an author decides.",
  steps: [
    { name: "Elizabeth Bennet", kind: "Character" },
    { name: "Darcy", kind: "Character" },
    { name: "Chapter timeline", kind: "Source text" },
    { name: "Canon revision", kind: "Author decides" },
  ],
} as const;

export const CANON = {
  title: "Canon and exploration stay apart.",
  items: [
    {
      title: "Approved continuity",
      text: "Which version of a character, timeline or design constraint is currently authoritative, and where the decision was made.",
    },
    {
      title: "Creative exploration",
      text: "Alternate scenes and test concepts stay working hypotheses until an author accepts them into the shared creative World.",
    },
  ],
} as const;

export const AREAS = {
  title: "Make creation easier.",
  lead: "Use knowledge to free creative time.",
  items: [
    { title: "Storytelling", text: "Trace characters, scenes, settings and unresolved continuity questions." },
    { title: "Design", text: "Link references, assets, design rationale and approved specifications." },
    { title: "Production", text: "Connect revisions, handoffs and requirements while preserving source and ownership." },
    { title: "Rights", text: "Track attribution and permissions. Permission to reuse comes from the rights holder." },
  ],
} as const;

export const SOURCE = {
  title: "Start from a text you can read.",
  lead: "A public literary text shows how characters and chapters become records that link back to the page they came from.",
  kind: "Public source",
  label: "Pride and Prejudice",
  detail: "Jane Austen, Project Gutenberg edition.",
  link: { href: "https://www.gutenberg.org/cache/epub/1342/pg1342.html", label: "Read the original text" },
} as const;

export const FINAL = {
  title: "Build a creative World.",
  secondary: { href: v34Route("research").path, label: "See a research World" },
} as const;
