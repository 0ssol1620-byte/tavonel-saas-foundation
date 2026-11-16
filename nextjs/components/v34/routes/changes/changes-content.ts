import type { Route } from "next";
import { EXPLORE_CTA } from "@/lib/site-navigation";
import { v34Route, type V34RouteKey } from "@/lib/v34/routes";

/*
  The words of /changes that are not the shared pieces' own. Plain data, so the guard test reads every
  sentence in one place. There is no number in this file: counts come from the corpus snapshot and the
  compiled sample's version timeline at render time, and ordinals are counted from the list position.

  What the page says a change review does is what the product does today: it compares two compiled
  versions, lists what differs, leaves activation to a person and keeps the version it replaces. It
  names no impact analysis, quarantine or notification, because none of them ships as a public path.
  A destination is a registry key, except the compiled sample's change view, which is a retained page.
*/

const to = (key: V34RouteKey): Route => v34Route(key).path;

/** The compiled sample's change view (a retained page, not a registry route). */
const SAMPLE_CHANGE = `${EXPLORE_CTA.href}?act=change` as Route;

export const HERO = {
  eyebrow: "Changes",
  title: "See what changed before you activate it.",
  lead: "A version update changes what your AI knows. Compare two versions of a World, see which records, relationships and evidence differ, and choose what becomes current.",
  primary: { href: SAMPLE_CHANGE, label: "Compare the public World versions" },
  art: {
    label: "Two versions of a World side by side, with one record unchanged, one changed, one removed and one added",
    caption: "A comparison lists what is the same, what changed, what left and what arrived.",
  },
} as const;

/** The corpus record that stands for the revision, and the relation that links it to what it touched. */
export const REVISION_RECORD_ID = "release";
export const REVISION_RELATION = "addresses";
/** The corpus sources the revision table links to: the announcement and the publication notes. */
export const REVISION_SOURCE_IDS = ["nist", "nistpub"] as const;

export const REVISION = {
  title: "A real revision, clearly explained.",
  lead: "NIST published a revision of its control catalog. The public reference corpus records the revision as a change and links it to every record it touched.",
  steps: {
    before: { title: "Previous revision", text: "The earlier control catalogue is the comparison baseline." },
    after: { title: "Review the effect", text: "A person reviews the affected records and decides what applies." },
  },
  table: {
    label: "Records the revision touched",
    columns: ["Record", "What the release says", "Status"],
  },
  linkLabel: "Open original",
} as const;

export const TIMELINE = {
  title: "Every version of a compiled World, in the order filings were added.",
  lead: "Each time a filing arrived, the sample World was compiled again. Every version is a complete compile of its sources, and each step below compares two finished compiles.",
  link: { href: SAMPLE_CHANGE, label: "Open the change view" },
  rows: { objects: "Objects", regions: "Evidence regions", pages: "Pages read" },
} as const;

export const COVERS = {
  eyebrow: "What a comparison covers",
  title: "Records, relationships, evidence and sources.",
  items: [
    { title: "Records", text: "Objects added, removed or changed, with the fields that differ." },
    { title: "Relationships", text: "Each relationship added, removed or changed, with the evidence it cites." },
    { title: "Evidence regions", text: "Page, box, file digest, source version and excerpt, so a region that moved shows as a change even when its text stayed the same." },
    { title: "Package files and sources", text: "Which files of the package changed by digest, and which source versions each side was compiled from." },
  ],
} as const;

export const ACTIVATE = {
  eyebrow: "Your decision",
  title: "You choose what becomes current.",
  steps: [
    { title: "Compile a candidate", text: "A compile rebuilds the collection you give it into a new candidate World." },
    { title: "Compare the versions", text: "Inspect what changed and follow the evidence back to the source it came from." },
    { title: "Activate it", text: "A person activates the candidate. The version it replaces stays intact and readable." },
    { title: "Return if needed", text: "An owner or admin can go back to an earlier version, after seeing what changes back." },
  ],
} as const;

export const BRIDGE = {
  eyebrow: "Worked example",
  title: "What changed in a NIST control catalog revision",
  href: to("journal-revision"),
  label: "Read the article",
} as const;

export const FINAL = {
  title: "Compare versions of your own World.",
} as const;

/** Every registry destination the page can render, for the release guard. */
export const CHANGES_DESTINATIONS: readonly Route[] = [BRIDGE.href];

/** Retained (non-registry) destinations, each of which must be a page under `app/`. */
export const CHANGES_RETAINED: readonly string[] = [EXPLORE_CTA.href];
