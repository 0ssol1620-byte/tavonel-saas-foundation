import type { Route } from "next";
import { EXPLORE_CTA } from "@/lib/site-navigation";
import { v34Route, type V34RouteKey } from "@/lib/v34/routes";

/*
  The words of /world that are not the shared pieces' own. Plain data, so the guard test reads every
  sentence in one place. There is no number in this file: counts come from the corpus snapshot at
  render time. A destination is a registry key, except the compiled sample, which is a retained page
  whose address the site navigation owns.
*/

const to = (key: V34RouteKey): Route => v34Route(key).path;

/** The compiled public sample World (a retained page, not a registry route). */
const SAMPLE: Route = EXPLORE_CTA.href as Route;

/** The label the corpus gives a source that names a publisher and carries no records of its own. */
export const CATALOG_LABEL = "Source catalog";

export const HERO = {
  eyebrow: "World",
  lead: "See how knowledge connects. Explore source, entity, concept, claim and change records, then inspect the original document.",
} as const;

export const INSTRUMENT = {
  note: "Each layer is one kind of record. Each line is a recorded relationship.",
} as const;

export const DOMAINS = {
  eyebrow: "Explore the public collection",
  title: "Different domains. One evidence model.",
  lead: "Search for a record by name or choose one in the explorer. Its source and recorded relationships are shown beside it.",
} as const;

export const SOURCES = {
  title: "Inspect the original sources.",
  lead: "Every curated reference record names the public document it cites. These are the documents the reference World cites.",
  columns: ["Source", "Revision or date", "What it is", "Original"],
  linkLabel: "Open original",
} as const;

export const NEXT = {
  eyebrow: "Go further",
  title: "Open a compiled World.",
  lead: "The compiled sample is a finished World built from public filings. Follow a fact in it to the page it was read from.",
  primary: { href: SAMPLE, label: "Open the compiled sample" },
  secondary: { href: to("compiler"), label: "How a World is compiled" },
} as const;

export const FINAL = {
  title: "Inspect the evidence behind a result.",
  cta: { href: to("evidence"), label: "Evidence" },
} as const;

/** Every internal destination the page can render, for the release guard. */
export const WORLD_DESTINATIONS: readonly Route[] = [
  NEXT.secondary.href,
  FINAL.cta.href,
];

/** Retained (non-registry) destinations, each of which must be a page in `app/`. */
export const WORLD_RETAINED: readonly Route[] = [SAMPLE];
