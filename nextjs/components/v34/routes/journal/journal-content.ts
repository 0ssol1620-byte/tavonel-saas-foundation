import type { Route } from "next";
import { RESOURCE_LINKS, RESOURCE_PURPOSES, RESOURCE_WORKFLOWS, type ResourceLink, type ResourceTag } from "@/lib/site-navigation";
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

/*
  The Reference section is the former resources hub (D33 #6, lead decision 10): every entry of
  `RESOURCE_LINKS`, each carrying its tags in `data-tags`, narrowed by a fragment link per tag
  (`#find-<tag>`, the `:target` rules in journal.module.css). Every entry stays in the HTML at every
  filter state. The words are the hub's own, ported as they were: an entry REFERENCE above also
  describes takes REFERENCE's name and line (so /benchmarks is "Benchmarks", the name the page has
  everywhere else), and the Signed product path, which the hub printed with no line, takes its own
  page's description.
*/
export const HUB = {
  label: "Narrow the resources by purpose or workflow",
  all: "Everything",
  purpose: "By purpose",
  workflow: "By workflow",
  representative: "Representative case — a real compiled result, published read-only.",
} as const;

/** The hub's line for each entry REFERENCE does not describe, by the entry's label. */
const HUB_TEXT: Readonly<Record<string, string>> = {
  "Explore a Compiled World": "Follow a result from an answer back to the exact source location it came from, without signing in.",
  "Signed product path": "See a compile end to end: a source changes, a person reviews it, and the answer that follows opens at the page it came from, with the evidence still attached.",
  "Knowledge Compiler guide": "What a Knowledge Compiler is, and how it differs from a parser, a RAG pipeline and a graph database.",
  "Product guide": "How to use what TAVONEL offers today, screen by screen, and where each screen stops.",
  API: "Endpoints, authentication, errors and limits, with the machine-readable OpenAPI document alongside.",
  Research: "The open problems in compiling documents into evidence-bound, versioned knowledge.",
  Evidence: "What an exact source location is for each kind of source, how a result stays bound to one, and how to verify a signed package.",
};

/** An entry's name and line. An entry with no line stops the build rather than printing an empty card. */
export function hubEntry(link: ResourceLink): { label: string; text: string } {
  const reference = REFERENCE.items.find((item) => item.href === link.href);
  if (reference) return { label: reference.label, text: reference.text };
  const text = HUB_TEXT[link.label];
  if (!text) throw new Error(`journal: the reference hub has no line for "${link.label}"`);
  return { label: link.label, text };
}

/** The filter row: "Everything" first, then the purposes, then the workflows, each group labelled once. */
export const HUB_FILTERS: readonly { tag: ResourceTag | null; group: string | null }[] = [
  { tag: null, group: null },
  ...RESOURCE_PURPOSES.map((tag, index) => ({ tag, group: index === 0 ? HUB.purpose : null })),
  ...RESOURCE_WORKFLOWS.map((tag, index) => ({ tag, group: index === 0 ? HUB.workflow : null })),
];

/** REFERENCE entries the hub does not list; the section closes on them. */
export const REFERENCE_ONLY = REFERENCE.items.filter((item) => !RESOURCE_LINKS.some((link) => link.href === item.href));

export const FINAL = { title: "Turn a question into a World." } as const;
