import type { Route } from "next";
import { EXPLORE_CTA } from "@/lib/site-navigation";
import { v34Route, type V34RouteKey } from "@/lib/v34/routes";

/*
  The words of /changes that are not the shared pieces' own. Plain data, so the guard test reads every
  sentence in one place. No count is typed in this file: counts come from the corpus snapshot and the
  compiled sample's version timeline at render time, and ordinals are counted from list positions. The
  two clause numbers the source-change note cites are the legacy page's own, and the route test checks
  each against the position and grade of that clause in the rendered list.

  The page renders, in order: a change review as the product does it today (two compiled versions
  compared, what differs listed, activation left to a person, the replaced version kept), then the
  Compiler Contract, where every clause carries its grade from `lib/compiler-contract.ts` and the
  source-change note says which stages of the contract's path run here and which are its direction.
  A destination is a registry key, except the compiled sample's change view, which is a retained page.
*/

const to = (key: V34RouteKey): Route => v34Route(key).path;

/** The compiled sample's change view (a retained page, not a registry route). */
const SAMPLE_CHANGE = `${EXPLORE_CTA.href}?act=change` as Route;

export const HERO = {
  eyebrow: "Changes",
  lead: "See what changed before you activate it. A\u00a0version update changes what your AI knows. Compare two versions of a World, see which records, relationships and evidence differ, and choose what becomes current.",
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

/*
  The Compiler Contract, ported from the retired /product/continuous-knowledge page. The clauses, their
  states, the standards and the package formats are read from `lib/compiler-contract.ts` at render time;
  only the words around them are here. A clause is graded by what a reader can check here, and the state
  key beside the list says what each word means. FLOW.note is the retired page's paragraph, changed only
  where `lib/v34/routes-changes.test.ts` lists a substitution and why.
*/
export const CONTRACT = {
  eyebrow: "The Compiler Contract",
  title: "The clauses a compile is written to.",
  lead: "Each clause is a promise about what a compile guarantees, graded by what can be checked today. The reference World shows the demonstrated ones; the rest are the direction of the compiler.",
  action: { href: "#clauses", label: "Read the Compiler Contract" },
  check: "Explanation and evidence",
  where: "Where to check it",
} as const;

export const FLOW = {
  title: "What a source change does",
  summary: "Read the source-change contract and diagram",
  lead: "The contract describes a single path. A revision arrives; the change is read for what it means rather than which bytes moved; the units standing on the changed region are resolved; the untouched half is carried over and the affected half rebuilt; and the result is compared against what a full rebuild would have produced, with a mismatch refusing to publish rather than shipping a world that looks finished. Only some stages of that path run in TAVONEL today. The drawing says which, and the solid line down its left side is what happens here instead.",
  note: "Solid is what TAVONEL executes: a source revision arrives, and a compile rebuilds the whole collection it is given into a candidate version a person activates. Everything dashed — the semantic diff, the resolution of the units standing on the changed region, the preserve-and-rebuild split, the equivalence comparison and the pass or refuse it would end in — is the contract this compiler is written to rather than what it executes here, which is what clause 05 says in words. The kept previous World is dashed for that reason: there is no equivalence check here to refuse, and the version a candidate replaces stays intact and readable either way. That is clause 04, and it is demonstrated.",
} as const;

export const INTEROP = {
  title: "Leaving the compiler",
  summary: "Read the formats and interchange standards",
  lead: "A compiled World that can only be read inside the tool that made it is no asset. The internal representation stays ours; what leaves is a signed package in formats other systems already read.",
  note: "Every path above is written by the same function that compiles a customer's documents. The archive carries a signed file inventory, with every listed file checked by sha256 and those exact manifest bytes signed with Ed25519, and the public key the signature was made with, so the check runs offline against a key fingerprint taken from somewhere other than the archive. The verifier is yours to run: the archive names the algorithm and the files to compare.",
  standards: "Interchange standards",
} as const;
