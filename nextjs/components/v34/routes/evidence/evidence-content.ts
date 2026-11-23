import type { Route } from "next";
import { EXPLORE_CTA } from "@/lib/site-navigation";
import { v34Route, type V34RouteKey } from "@/lib/v34/routes";

/*
  The words of /evidence that are not the shared pieces' own. Plain data, so the guard test reads every
  sentence in one place. There is no number in this file: counts come from the corpus snapshot and the
  region view at render time, and ordinals are counted from the list position.

  The six statements under MECHANISM and the four under VERIFY are the ones the previous page already
  published and the product already does; nothing was added to them. A destination is a registry key,
  except the retained pages and the one API address named under RETAINED.
*/

const to = (key: V34RouteKey): Route => v34Route(key).path;

/** The compiled sample's evidence act (a retained page, not a registry route). */
const SAMPLE_EVIDENCE = `${EXPLORE_CTA.href}?act=evidence` as Route;
const SOURCES_PAGE = "/sources" as Route;
const CLI_DOCS = "/docs/cli" as Route;
const BENCHMARKS = "/benchmarks" as Route;
const REPRODUCIBILITY = "/reproducibility" as Route;
const TRUST = "/trust" as Route;
/** The published signing key of an export package. */
const TRUST_KEY = "/api/export/trust";

export const HERO = {
  eyebrow: "Evidence",
  lead: "Every answer has a trail. Make a claim inspectable. See where it came from, which revision of the source it was read from, and what it actually supports.",
  primary: { href: SAMPLE_EVIDENCE, label: "Open a result at its source" },
  art: {
    label: "A source page with one highlighted region, joined by a line to the claim that cites it",
    caption: "A claim keeps the page, the region and the file hash it was read from.",
  },
} as const;

/*
  The locator model, published as a model: the one locator that reads today, and the seven the evidence
  contract defines ahead of their readers. The declarations keep these two names and this shape because
  the release guard pins them by name; the page renders both.
*/
const READING_TODAY = ["PDF", "Page and region on that page."] as const;

const CONTRACTED_LOCATORS = [
  ["Spreadsheet", "Sheet, and the cell or range inside it."],
  ["Presentation", "Slide, and the shape on that slide."],
  ["Email", "Message, and the attachment or MIME part inside it."],
  ["JSON and XML", "Pointer or path to the node."],
  ["Code", "Commit, file, and the symbol or line span."],
  ["CAD and BIM", "Object, by its GUID."],
  ["Audio and video", "Timestamp, or frame."],
] as const;

export { CONTRACTED_LOCATORS, READING_TODAY };

export const REGIONS = {
  title: "From a result to its source page.",
  lead: "One page of a public filing from the compiled sample, with every region the compiler read from it drawn at the coordinates it recorded. Select a region to read its excerpt and the locator a result cites.",
  caption: "From the public sample World. Each box is a region the compiler recorded; the excerpt is the source's own text, and the locator is what a result cites.",
  reading: {
    label: "Reading today",
    format: READING_TODAY[0],
    locator: READING_TODAY[1],
    text: "Every accepted format is read through this one, so each result names the page and the region it came from.",
    link: { href: SOURCES_PAGE, label: "See the formats TAVONEL reads" },
  },
} as const;

export const CONTRACTED = {
  title: "What the contract is built to hold",
  text: "The evidence contract defines these seven locator shapes ahead of the readers that use them, and none of them is read today. When a format gains a reader, its locator is already specified.",
} as const;

export const MECHANISM = {
  eyebrow: "What a result is bound to",
  title: "What stays with every compiled fact.",
  items: [
    {
      title: "Source identity",
      text: "Each source is stored as an immutable object under a content hash. A later revision of the same file is a new version of it and the earlier bytes stay addressable, so a result can always name the exact bytes it was compiled from.",
    },
    {
      title: "Source-location binding",
      text: "Reading produces regions, and a qualified claim keeps the region it came from. Every compiled fact stays traceable to its exact source location, which is why opening evidence shows the place in the source itself.",
    },
    {
      title: "Version binding",
      text: "Objects, relations and claims belong to a world version. When sources change, the previous version stays intact and readable, so an answer given last month can still be traced to what was true then.",
    },
    {
      title: "Review decisions",
      text: "Accepting, rejecting or changing a candidate item writes an append-only record of who decided, when, and on what item. The record states the action taken.",
    },
    {
      title: "Signed packages",
      text: "An export carries a manifest with a digest for every file, signed on the way out. The public key is published, so a recipient verifies a package without asking us.",
      link: { href: TRUST_KEY, label: "Fetch the public key" },
    },
    {
      title: "Fail-closed emission",
      text: "Emission requires every link to resolve. Broken knowledge fails visibly instead of arriving looking complete.",
    },
  ],
} as const;

/** The corpus source ids the provenance tables read: the NIST publications and the four OSCAL profiles. */
export const PROVENANCE_SOURCE_IDS = ["nist", "nistpub", "nista", "nistb", "oscal-high", "oscal-low", "oscal-moderate", "oscal-privacy"] as const;
/** The corpus record whose provenance the first table prints, and the source it cites. */
export const PROVENANCE_RECORD_ID = "control-ac-1";

export const PROVENANCE = {
  eyebrow: "Public reference corpus",
  title: "Every record shows its authority.",
  lead: "Every curated reference record names its source and that source's revision. The first table prints one record; the second lists the sources behind this page.",
  recordColumns: ["Field", "Value"],
  sourceColumns: ["Source", "Revision or date", "What it is", "Original"],
  linkLabel: "Open original",
} as const;

export const INCOMPLETE = {
  title: "When evidence is incomplete, the record says so.",
  lead: "Every record in the public reference corpus carries a status, so an open question stays visible instead of reading as settled.",
  link: { href: to("research"), label: "Explore the research record →" },
} as const;

/** The corpus record the incomplete-evidence band shows: the one whose status is uncertain. */
export const INCOMPLETE_RECORD_ID = "hz";

export const VERIFY = {
  eyebrow: "Check it yourself",
  title: "Verify a result without taking our word for it.",
  steps: [
    { title: "Open a result", text: "Ask a question, or open any object in a Compiled World, and follow its citation." },
    { title: "Reach the location", text: "The evidence record names the source version and the exact location inside it, and opens that location." },
    { title: "Export the world", text: "Download the signed package: ontology, graph, retrieval corpus, provenance and validation." },
    { title: "Verify independently", text: "Check every file digest against the manifest, and the manifest signature against the published key." },
  ],
  link: { href: CLI_DOCS, label: "Read the verification steps →" },
} as const;

/** The page's role in the trust case, and the pages that answer the neighbouring questions. */
export const TRUST_CASE = {
  role: "This page is how a compiled result stays bound to the source it came from, and how to check that yourself, without taking our word for it.",
  label: "Also in the trust case",
  links: [
    { href: BENCHMARKS, label: "Benchmarks" },
    { href: REPRODUCIBILITY, label: "Reproducibility" },
    { href: to("research"), label: "Research" },
    { href: TRUST, label: "Trust" },
  ],
} as const;

export const FINAL = {
  title: "Follow a real document revision.",
  cta: { href: to("changes"), label: "See what changed" },
} as const;

/** Every registry destination the page can render, for the release guard. */
export const EVIDENCE_DESTINATIONS: readonly Route[] = [INCOMPLETE.link.href, FINAL.cta.href];

/** Retained (non-registry) destinations, each of which must exist under `app/`. */
export const EVIDENCE_RETAINED: readonly string[] = [
  EXPLORE_CTA.href,
  SOURCES_PAGE,
  CLI_DOCS,
  BENCHMARKS,
  REPRODUCIBILITY,
  TRUST,
  TRUST_KEY,
];
