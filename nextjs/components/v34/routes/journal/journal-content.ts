import type { Route } from "next";
import type { V34RouteKey } from "@/lib/v34/routes";

/*
  The words of the journal index that are not the registry's own. Plain data, so the guard test can
  read every sentence in one place. The page title and description come from the registry record;
  the article cards take their titles and descriptions from the registry too.
*/

/** The article the hero points at. */
export const FEATURED: V34RouteKey = "journal-compiler";

export const HERO = {
  action: "Start with the compiler guide",
  figure: "Originals pass through a compile step and become a World of linked records.",
} as const;

export const GUIDES = {
  eyebrow: "The field guides",
  title: "Choose the question that matters.",
  lead: "Each guide pairs an inspectable method with the sources it relies on.",
  read: "Read the guide →",
} as const;

/** What kind of guide each live article is. A live article missing here fails the index test. */
export const CATEGORY: Partial<Record<V34RouteKey, string>> = {
  "journal-compiler": "Foundations",
  "journal-mcp": "Developers",
  "journal-revision": "Standards",
  "journal-research": "Research",
};

/** Retained pages the journal collects as reference material. Each path has a page file, and the test checks it. */
export const REFERENCE = {
  eyebrow: "Reference",
  title: "Documentation and reference material.",
  lead: "Find the source behind a method, then continue to the relevant workflow or developer documentation.",
  items: [
    { href: "/docs" as Route, label: "Documentation", text: "Quickstart, concepts, supported files, compiling, review, and using a World through Ask, the API and MCP." },
    { href: "/cookbooks" as Route, label: "Cookbooks", text: "Task guides that take one piece of work through the product, each published ahead of a recorded run." },
    { href: "/research/notes" as Route, label: "Research notes", text: "What we measured and how: each figure with its denominator, the conditions it was measured under and a receipt you can download and check." },
    { href: "/benchmarks" as Route, label: "Benchmarks", text: "The metric families, the receipt a result must carry, and the rules that decide whether it may be compared." },
    { href: "/changelog" as Route, label: "Changelog", text: "What changed, in the order it changed, written for the people using it." },
    { href: "/reproducibility" as Route, label: "Reproducibility", text: "Fixture identity and the material needed to reproduce a published run." },
  ],
} as const;

export const FINAL = { title: "Turn a question into a World." } as const;
