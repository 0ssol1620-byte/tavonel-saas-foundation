import type { Route } from "next";
import { clause } from "@/lib/compiler-contract";
import { DEVELOPER_FILES } from "@/lib/mcp-tools";
import { PUBLIC_CORPUS_STATS, readPublicCorpus } from "@/lib/v34/public-corpus";
import { v34Route, type V34RouteKey } from "@/lib/v34/routes";
import {
  CAPABILITY_MANIFEST,
  CAPABILITY_TIER_LABEL,
  capabilityCensus,
  capabilityTokenLabel,
  isAcceptedAtUpload,
  publicCapabilityRows,
  sharedAcceptedLimitationLabels,
} from "../../../../../shared/capabilityManifest";

/*
  The words of the compiler page that are not the shared pieces' own. Plain data, so the guard test
  can read every sentence in one place.

  Three rules hold for everything here:
  - A destination is a registry key, never a typed path. `to()` resolves it, and the test fails if
    the route it names is held. `/sources` and the published package verifier are the two other
    destinations, named once below.
  - There is no number in this file. The format table, the counts under it and the source cards are
    computed from the capability manifest and the public corpus at render time.
  - What a region carries is the compiler contract's first clause. It must still be `demonstrated`,
    or the build stops.
*/

const to = (key: V34RouteKey): Route => v34Route(key).path;

const record = v34Route("compiler");

/** The one retained route this page links, the per-format list of limits. */
export const SOURCES_HREF = "/sources" satisfies Route;

const packageVerifier = DEVELOPER_FILES.find((file) => file.key === "verifyPackage");
if (!packageVerifier) throw new Error("the developer distribution has no package verifier");

if (clause("evidence-preserving").state !== "demonstrated") {
  throw new Error("the compiler page states what a region carries as shipped, and the clause has changed state");
}

export const HERO = {
  eyebrow: record.ogLabel,
  title: record.title.replace(/ — TAVONEL$/, ""),
  lead: record.description,
  secondary: { href: to("evidence"), label: "Inspect evidence" },
  figure: "One page, read into regions, with each region held by a record that points back to it.",
} as const;

/** Accepted formats, from the manifest: every row the upload route takes, in manifest order. */
const rows = publicCapabilityRows().filter((row) => row.tier !== CAPABILITY_TIER_LABEL.UNSUPPORTED);
const census = capabilityCensus();
const family = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** What every accepted row preserves, written: the manifest's own tokens, one label each. */
const kept = [...new Set(CAPABILITY_MANIFEST.entries.filter((entry) => isAcceptedAtUpload(entry.status)).flatMap((entry) => entry.preserved))]
  .map((token) => `the ${capabilityTokenLabel(token).toLowerCase()}`);
const keptList = `${kept.slice(0, -1).join(", ")} and ${kept.at(-1)}`;

export const FORMATS = {
  eyebrow: "What it reads",
  title: "Every accepted format, in one table.",
  lead: `Each accepted file is sanitized to PDF and read with OCR. What the compile receives is ${keptList}.`,
  stats: [
    { label: "Accepted formats", value: census.accepted },
    { label: "Fields kept per region", value: census.preserved },
  ],
  label: "Formats the compiler reads",
  caption: `Limits every accepted format shares: ${sharedAcceptedLimitationLabels().join("; ")}.`,
  columns: ["Format", "Source type", "Support", "How it is read"],
  rows: rows.map((row) => [
    row.extensions.map((extension) => extension.toUpperCase()).join(" / "),
    family(row.sourceFamily),
    row.tier,
    row.specific.join("; "),
  ] as const),
  link: { href: SOURCES_HREF, label: "Limits for each format →" },
} as const;

export const STAGES = {
  eyebrow: "From a page to a record",
  title: "Four stages, one direction.",
  lead: "Each stage hands the next one something you can inspect.",
  items: [
    {
      title: "Sanitize",
      text: "Every accepted file is sanitized to PDF before anything reads it.",
    },
    {
      title: "Read",
      text: "OCR reads each page into paragraphs. Each paragraph keeps its page number and the box it sat in.",
    },
    {
      title: "Compile",
      text: "The compiler builds objects, claims and typed relationships from the regions. A claim is tied to its evidence and to one exact source version.",
    },
    {
      title: "Check",
      text: packageVerifier.purpose,
      link: { href: `/developer/${packageVerifier.file}`, label: "Download the package verifier", file: true },
    },
  ],
} as const;

export const REGION = {
  title: "Every region keeps its address.",
  lead: "A record reaches the page it was read from through its evidence. Open the evidence view to see a region beside its page.",
  link: { href: to("evidence"), label: "Inspect evidence →" },
  label: "What one region carries",
  items: [
    { term: "Source version", text: "The sha256 of the bytes that were read, rather than a filename." },
    { term: "Page", text: "The numbered page of that version." },
    { term: "Box", text: "Where on the page the paragraph sat, in thousandths of the page." },
    { term: "Text", text: "The paragraph that was read from that box." },
  ],
} as const;

const catalogLabel = "Source catalog";
const loaded = Object.values(readPublicCorpus().sources).filter((source) => source[1] !== catalogLabel);
const stats = PUBLIC_CORPUS_STATS();

export const SOURCES = {
  eyebrow: "Public reference corpus",
  title: "The public sources behind the reference World.",
  lead: `${stats.sources.loaded.toLocaleString("en-US")} sources are loaded into the reference World. Each card opens the publisher's own page.`,
  items: loaded.map(([name, edition, href]) => ({ name, edition, href })),
  more: {
    text: `${stats.sources.referenceOnly.toLocaleString("en-US")} more public catalogs are listed in the World as references.`,
    link: { href: to("world"), label: "Inspect the World →" },
  },
} as const;

export const BRIDGE = {
  title: "What is a knowledge compiler?",
  text: v34Route("journal-compiler").description,
  href: to("journal-compiler"),
  label: "Read the field guide",
} as const;

export const FINAL = {
  title: "See where connected knowledge can help.",
  cta: { href: to("solutions"), label: "Browse solutions" },
} as const;

/** Every internal destination the page can render, for the release guard. */
export const COMPILER_DESTINATIONS: readonly Route[] = [
  HERO.secondary.href,
  FORMATS.link.href,
  REGION.link.href,
  SOURCES.more.link.href,
  BRIDGE.href,
  FINAL.cta.href,
];

/** The published file the stages list downloads. */
export const COMPILER_FILES: readonly string[] = [STAGES.items[3].link.href];
