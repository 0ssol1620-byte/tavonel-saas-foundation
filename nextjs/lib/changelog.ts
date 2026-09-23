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
  /** Calendar date in Asia/Seoul of a successful production deployment. */
  date: string;
  /** Exact UTC deployment timestamp where a production receipt is available. */
  releasedAt?: string;
  /** Preserve an older published fragment when correcting a release date. */
  id?: string;
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
  /*
    The release-candidate copy on three entries was left behind after their changes reached main.
    The API and commerce work deployed successfully as 22e47f5 at 2026-09-18T04:35:46Z; the
    landing work as 1b14d27 at 2026-09-19T22:41:11Z; the buyer-path change as 0cc99a4 at
    2026-09-23T05:10:07Z. Dates below are KST calendar dates; Atom uses these exact UTC times.
    The old date fragments remain stable, while the displayed dates now state when they shipped.
  */
  {
    date: "2026-09-23",
    releasedAt: "2026-09-23T05:10:07Z",
    title: "A clearer path from public proof to pricing",
    surfaces: ["Website", "Billing"],
    improved: [
      "The homepage leads with a source-verifiable outcome, puts How it compiles beneath the headline, and opens the five-stage specimen on Evidence.",
      "The new first screen supersedes the 20 September entry-page opening; the source-linked sample remains available further down the page.",
      "Visitors can move from the public Compiled World and its source regions to Pricing, where the consultation path is explained.",
      "The historical R-01 research result names its denominator, receipt and weak-scan limitation instead of suggesting live-service model superiority.",
    ],
  },
  {
    date: "2026-09-20",
    releasedAt: "2026-09-19T22:41:11Z",
    id: "2026-09-19",
    title: "A rebuilt entry page: nine scenes, and every figure on them read out of the public Compiled World",
    surfaces: ["Website"],
    added: [
      "The entry pages at / and /ko are rebuilt as nine scenes, each one a keyboard-reachable landmark that answers a single question and offers a single next action: what TAVONEL is, whether it works, what happens to your files, whether the result can be trusted, what happens when a source changes, why a compiler rather than a parser, how work comes in and goes out, what is safe to assume, and what to do next.",
      "The first screen is the product rather than a picture of it: a real page of a real SEC filing, the region the compiler read on it, a line from that region to the passage compiled out of it, and the objects bound to that passage — every one of them read out of the public Compiled World when the page is built. It plays no video.",
      "An evidence inspector on the entry page prints the five things a citation needs — the object's state, the file, the page, the region as coordinates on that page, and the source version's digest — with Copy citation and a link that opens the original document at the right page.",
      "A design record for the entry pages at docs/LANDING_V2_2026-09-19.md: the rules every figure on them obeys, the component and data-module inventory, the semantic colour table, the navigation model, and the two commands that regenerate the committed page images.",
    ],
    improved: [
      "One header and one footer across every public page: five sections, Request access as the single filled control, and a phone sheet whose rows meet the 44px touch floor and close on Escape.",
      "The six questions that sat at the foot of the old entry page are on /contact, above the form they are usually asked before answering.",
      "A colour means one thing everywhere it is used, on the site and in the workspace alike: blue is where something came from, mint is verified, violet is a relation, amber is a changed source, coral is held for review.",
      "Reduced motion gets the whole story at once as a static composition with the play control still present, rather than a hidden animation.",
    ],
    fixed: [
      "What TAVONEL does and does not yet do was spread across the header, the first screen and a note about how the film was made. It is stated once, in the deployment's own words, at the two points where a reader is deciding what to do about it.",
      "Numbers on the entry pages could be typed into the copy. Every figure the pages print is read out of the compiled public World and marked as measured, and a browser check walks both rendered pages for a digit that carries no such mark.",
    ],
  },
  {
    date: "2026-09-18",
    releasedAt: "2026-09-18T04:35:46Z",
    id: "2026-09-16",
    title: "A rendered API reference, published error codes, and the limits that were already enforced",
    surfaces: ["API", "Developer tools", "Website", "Billing"],
    added: [
      "An API reference at /api: every operation in the contract with its parameters, request and response schemas, a worked example, and the error codes it can return. It is generated from the OpenAPI document rather than written beside it.",
      "A try-it on that page for the three reads that need no key — the capability manifest, the deployment status, and the public sample World.",
      "The full error catalogue on /docs/errors: every code the API can return, what it means and what to do about it, including AUTH_REQUIRED, which is what a missing or wrong key gets.",
      "A version lifecycle and deprecation policy on /docs/changelog: what can change without notice, what counts as breaking, and the 180-day support window a deprecated version keeps.",
      "The two integration-recipe scripts are published under /developer/ and pinned by sha256 in the distribution channel, so the recipes on /docs/integration-recipes can be run rather than read.",
      "Endpoint documentation for the thirteen operations that had none: the World lenses' companions, run events, reviews, manifest status, connections, OAuth connectors, key rotation and the audit trail.",
      "The research receipts behind the published figures are downloadable, each with its full sha256, so a number on this site can be checked against the artifact it came from rather than taken on trust.",
    ],
    improved: [
      "The two per-source ceilings TAVONEL enforces — 5 MB and 80 pages — are published on the pages that promise the ceilings, with the code a refusal carries.",
      "API rate limits are published per scope on /docs/billing-and-limits, taken from the values the authorizer enforces.",
      "Documentation search is on every page rather than only the index, and a result shows the matched phrase in context.",
      "Every request example renders in all three languages in the page source, so a crawler or an agent reading raw HTML sees cURL, Python and TypeScript rather than one of them.",
    ],
    fixed: [
      "The OpenAPI document resolved the seven compile-job operations against a base URL that returns 404. They carry their own server entry now, and a test resolves every path in the contract against a route handler so the contract cannot describe a URL the API does not serve.",
      "The read-only MCP release record now names list_worlds, which was included in the 3 September tool set.",
      "The signed package's file list was three different lists on three pages, one of them naming a file the exporter does not write. All three read the exporter's own list now.",
      "The scope description for ask:read said lexical retrieval while the Search page documented the same endpoint as hybrid retrieval.",
      "Internal review shorthand was published verbatim in a sentence on /docs/search.",
    ],
  },
  {
    date: "2026-09-18",
    releasedAt: "2026-09-18T04:35:46Z",
    id: "2026-09-14",
    title: "Pricing, legal texts and trust surfaces",
    surfaces: ["Website", "Billing"],
    added: [
      "Pricing shows plan limits and access conditions. The Terms name governing law, liability limits and price-change notice; Refunds distinguishes invitation-only access from paid-plan rules; Privacy names the data-protection regimes it addresses; Trust lists the scope of provided controls.",
    ],
  },
  {
    date: "2026-09-15",
    title: "Website and workspace release",
    surfaces: ["Website", "Workspace"],
    improved: [
      "A production release covering the public site and the workspace shell. No API contract, limit or price changed, and no action is needed from an integration.",
    ],
  },
  {
    date: "2026-09-03",
    title: "Read-only MCP, a package validator, and the documentation to use them",
    version: "2026.9.3.1",
    surfaces: ["Developer tools", "API"],
    added: [
      // G3-006's root cause: this line said eight and omitted list_worlds, and "eight" then
      // propagated to /developers, /docs/integration-recipes and the MCP download tile. The
      // count is generated everywhere else now; here it is corrected in place, because a
      // changelog entry is a record of what was said on a date and the record was wrong.
      "The MCP server exposes nine read-only tools: list_sources, list_worlds, get_world, search_world, ask_world, get_object, get_relation, get_evidence and download_package.",
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

/** A published fragment remains stable if the entry's release date was corrected. */
export function changelogEntryId(entry: ChangelogEntry): string {
  return entry.id ?? entry.date;
}

/** Older date-only entries keep their existing feed timestamp until a receipt is recovered. */
export function changelogEntryUpdatedAt(entry: ChangelogEntry): string {
  return entry.releasedAt ?? `${entry.date}T00:00:00Z`;
}

/** Newest first, which is the order the page and the feed both want. */
export function changelogEntries(surface?: ChangelogSurface): ChangelogEntry[] {
  // `filter` already copies, so the sort is not mutating the exported array.
  return CHANGELOG
    .filter((entry) => !surface || entry.surfaces.includes(surface))
    .sort((left, right) => right.date.localeCompare(left.date) || changelogEntryId(right).localeCompare(changelogEntryId(left)));
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
  return changelogEntryUpdatedAt(changelogEntries()[0]);
}
