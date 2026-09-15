/*
  The changelog as data.

  Masterplan 13.3 says what was wrong with the prose version: two entries, both about website
  work, written from the inside. "Changed the landing page to five scenes" is a record of what we
  did; a changelog is a record of what someone else can now do, or must now change.

  So an entry is grouped the way a reader triages one -- Added, Improved, Fixed -- and carries
  the three fields that decide whether they have to act: which surface it touched, whether it
  breaks a published contract, and what to do about it if it does. Everything the page renders
  comes from here, including the feed, so a release cannot appear on one and not the other.

  What is deliberately absent: entries for anything not in this repository. A changelog is the
  one page where a plausible-sounding line is indistinguishable from a true one, and there is no
  receipt behind it to check.
*/

export type ChangelogSurface = "Workspace" | "API" | "Developer tools" | "Website" | "Billing";

export const CHANGELOG_SURFACES: readonly ChangelogSurface[] = [
  "Workspace", "API", "Developer tools", "Website", "Billing",
];

export type ChangelogEntry = {
  /** ISO date, and the fragment a permalink points at. */
  date: string;
  title: string;
  /** The released version, where the thing released carries one. */
  version?: string;
  surfaces: ChangelogSurface[];
  added?: string[];
  improved?: string[];
  fixed?: string[];
  /** Set when a published contract changed shape. Rendered as a warning, not a bullet. */
  breaking?: string;
  /** What a reader has to do. Required whenever `breaking` is set. */
  migration?: string;
};

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    date: "2026-09-03",
    title: "Read-only MCP, a package validator, and the documentation to use them",
    version: "2026.9.3.1",
    surfaces: ["Developer tools", "API"],
    added: [
      "The MCP server exposes eight read-only tools: list_sources, get_world, search_world, ask_world, get_object, get_relation, get_evidence and download_package.",
      "A Compiled World Package validator checks what is inside an export: that relations resolve, that every region sits inside its page, that the Turtle, JSON-LD and CSV describe the same graph, and that the package's own report counts what the package holds.",
      "Documentation covering the endpoint reference, the error catalogue, run events and the package format, with each request in cURL, Python and TypeScript.",
      /*
        BA-105, with one departure from the audit's proposed sentence, recorded here and in the
        lane report.

        What was wrong: the line ended on a capability that is not built and named the internal
        subsystem that would provide it, so an "Added" entry closed on an absence written in our
        vocabulary. Both of those are gone.

        The audit proposed "Merging objects across parts is a separate step you control in
        review", and that would claim a review step that merges across parts. There is none --
        `lib/corpus-and-entity-honesty.test.ts` exists to keep the changelog, the compile panel
        and the documentation all saying the parts are not merged, because a reader who believes
        they were merged has a false picture of what they are holding. So the nearest true
        sentence: the parts are not merged, and each is reviewed and used on its own.
      */
      "Compiling more sources than one compile can hold: a run of up to 128 documents is split into parts and followed as one run, with each part compiling to its own World. The parts are not merged, so each one is reviewed and used on its own.",
    ],
    /*
      BA-106. Two lines here were internal housekeeping published as product improvements.

      "Every public page declares its own canonical" told every reader that our pages had been
      misconfigured, which is a fact about us and not something anyone can now do. And a search
      index decision is not a customer-facing change: the half of that line a customer can use is
      that the machine-readable contract is available, so that is what is left of it.

      A changelog is a record of what someone else can now do, or must now change.
    */
    improved: [
      "Preflight reads the real page count from the document where the format states one, and says so, rather than estimating from file size.",
      /*
        BA-107. Written from the defect, "a large ZIP no longer freezes the tab" advertises the
        freeze. The behaviour is what a reader can rely on.
      */
      "Unpacking a large archive keeps the tab responsive.",
    ],
    /*
      BA-107. The bug tracker's voice, on a public page.

      Each of these made the defect's implementation the subject, so the line advertised the
      defect rather than the capability -- and "abandoned with the reading already paid for" told
      a prospect we had once charged for work we lost. The same two changes, named as what the
      product does.
    */
    fixed: [
      "A connector sync completes when a provider returns an incomplete row.",
      "A compile survives a closed tab — reopen it and the run continues, with no second charge for the reading.",
    ],
    breaking: "The MCP tool names changed. list_documents, get_collection, get_active_world and ask_active_world are now list_sources, get_world and ask_world.",
    migration: "Update the tool names your agent calls, then re-register the server. Pin the release you registered: node tavonel-mcp.mjs --version prints it, and the sha256 of every asset is in the distribution channel.",
  },
  {
    date: "2026-09-02",
    title: "Run events and page-based quotes",
    surfaces: ["Workspace", "Billing"],
    improved: [
      "Compile progress is derived from persisted run events rather than from a timer, so a reload shows where the run actually is.",
      "A page estimate shows both the standard and the maximum processing boundary before a compile starts.",
    ],
  },
  {
    date: "2026-09-01",
    title: "One public journey",
    surfaces: ["Website"],
    improved: [
      "The public path runs input, compilation, evidence, then straight into the workspace.",
      /*
        BA-106's second half. "stays available and out of the index" is a search-index decision,
        which is not a change anyone reading this can act on. What a customer can use is that the
        contract is there for an integration.
      */
      "Pricing is quoted in pages and dollars, with the machine-readable API contract available for integrations.",
    ],
  },
];

/** Newest first, which is the order the page and the feed both want. */
export function changelogEntries(surface?: ChangelogSurface): ChangelogEntry[] {
  // `filter` already copies, so the sort is not mutating the exported array.
  return CHANGELOG
    .filter((entry) => !surface || entry.surfaces.includes(surface))
    .sort((left, right) => right.date.localeCompare(left.date));
}

export function changelogSections(entry: ChangelogEntry): Array<[string, string[]]> {
  const sections: Array<[string, string[] | undefined]> = [
    ["Added", entry.added], ["Improved", entry.improved], ["Fixed", entry.fixed],
  ];
  return sections
    .filter((section): section is [string, string[]] => (section[1]?.length ?? 0) > 0);
}

/** The most recent change, which is what a feed's own timestamp should be. */
export function changelogUpdatedAt() {
  return changelogEntries()[0].date;
}
