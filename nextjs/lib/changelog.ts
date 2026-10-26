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

  What gets an entry (ENABLEMENT-GAP 4d; the same rule for authors is docs/CHANGELOG_ENTRY_RULE.md).
  The cadence is the deployment, not the calendar. A production deployment that changes any of
  these has an entry, dated the Asia/Seoul day it reached tavonel.com:
    - a public page or its wording, added, changed or removed;
    - a published contract: the OpenAPI document, whose info.version the entry names in
      `apiVersion`, an error code or a response shape; a breaking one sets `breaking` and
      `migration`;
    - a developer asset: a file under /developer/, and the channel.json version, which the entry
      names in `version`;
    - a limit or a format tier;
    - price wording, and only ever the strings the founder set;
    - a manual revision, a guide video re-recorded, a benchmark or a negative result published.
  What does not: an internal refactor, CI, a documentation typo, a style change nobody can see,
  research that was not published.

  The part of this a machine can hold without a clock is held in `lib/changelog.test.ts`: the
  version /developer/channel.json serves and the info.version /api/openapi serves each have an
  entry here, so neither can move on the site without one.
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
  /**
   * The anchor, when two releases share a date: the date plus a suffix. Absent means the date.
   * `lib/changelog.test.ts` holds every anchor to the date its entry shows.
   */
  id?: string;
  /**
   * The fragment this entry was first published under, before its date was corrected. The page
   * keeps it as a second anchor so an old link still lands here, and the feed keeps it as the
   * Atom id so a subscriber does not receive the same release twice.
   */
  previousId?: string;
  title: string;
  /** The released version, where the thing released carries one. */
  version?: string;
  /** The OpenAPI info.version this release put on /api/openapi, when it moved the contract. */
  apiVersion?: string;
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
    PR #172, Home redesign (FINAL-SPEC 2026-10-26): production deployment dpl_rqgoRU7DNuSr3L8qQSTs6biW71ts (main 5ecb6051, merge of head
    0f0d156e), READY 2026-10-26T17:49:51Z, 02:49:51 in Seoul, read from the Vercel deployment record (receipt:
    redesign-20261026/review/merge-2026-10-27/). Independent review R3 APPROVE (REVIEW-2026-10-26-R3.md) and design
    critique R3 PASS. By docs/CHANGELOG_ENTRY_RULE.md these have no bullet: the e2e re-pins, the repair-scope
    registrations, the pane-crop receipts and the re-derived LCP floor (internal); the specimen strip (preview only,
    unchanged). No version: channel.json and /api/openapi did not move.
  */
  {
    date: "2026-10-27",
    releasedAt: "2026-10-26T17:49:51Z",
    id: "2026-10-27-home-product-as-hero",
    title: "The home page opens on the compiler, one sentence per section",
    surfaces: ["Website"],
    improved: [
      "/ and /ko open on a two-line statement, one line of support, one action and the compilation film. On a phone the film opens on one pane of the source page, with the full frame one tap away.",
      "Each section below the film carries one sentence. The research figures are three rows, each with its receipt id, date and digest; the sample record shows its source, page, region and version; the change counts compare two complete compiles. The FAQ, the reading-difficulty notes and the per-section link rows have left the home page, and the home footer is compact.",
      "The customer-data sentence, the training-data statement and the rights sentence stay on the home page in their existing wording.",
      "/ko sets its home-page Hangul in a static subset of Wanted Sans in two weights, and / loads no Korean font.",
    ],
  },
  /*
    PR #170, phase 4 post-batch: production deployment dpl_2WMiVjsxeoa7WUAz1K7stgA91JFK (main 5d8417a1), READY
    2026-10-25T13:49:52Z, 22:49:52 in Seoul, read with Vercel get_deployment (receipt:
    ux-program-20261017/phase4/POST-BATCH/CHANGELOG-170/RECEIPT-2026-10-25.md). By docs/CHANGELOG_ENTRY_RULE.md these
    have no bullet: the sha256: prefix set as code in one /docs/run-events table cell (formatting, the words unchanged),
    the seven changelog entries themselves (each is on the page and in the feed under its own date), the remote MCP
    authorize page (404 on tavonel.com) and tests, repair-scope owners and the RSC-leak probe (internal). No version:
    /developer/README.md is not a channel.json asset and channel.json did not move.
  */
  {
    date: "2026-10-25",
    releasedAt: "2026-10-25T13:49:52Z",
    id: "2026-10-25-guide-rows-and-provenance",
    title: "Separate tap targets in the /guide chapter links, monospace code before the webfont loads, and provenance for the specimens",
    surfaces: ["Website", "Developer tools"],
    added: [
      "/proof-collection/PROVENANCE.md has a Specimens section on the two pages in /proof-collection/specimens/: the public document each comes from and its licence, when it was read, what each cell holds, what its run receipt does not claim, and the SHA-256 that pins each run receipt and rights snapshot.",
    ],
    improved: [
      "The guide's manifest, /guide/manifest.json, says in its first recording line that guide-1-explore and guide-3-api were recorded on live tavonel.com, and that guide-2-mcp is the exception its last line describes.",
      "The MCP configuration example in the developer README, /developer/README.md, uses /absolute/path/to/tavonel-mcp.mjs as the placeholder for the server's path, as /docs/mcp does.",
    ],
    fixed: [
      "On a touch screen or below 1080 px, each “where” link under a chapter of /guide and /ko/guide is a full-size tap target, and a row that wraps sits clear of the row above it.",
      "Code, digests, IDs and coordinates are drawn in your system's monospace face whenever IBM Plex Mono has not loaded.",
    ],
  },
  /*
    Phase 4 post-batch, 2026-10-25: the seven phase-4 merges now in production, one entry each. Each is dated by the
    Asia/Seoul day its production deployment reached tavonel.com and timed by that deployment's READY time, read with
    Vercel get_deployment on the ledger's deployment ids (receipt:
    ux-program-20261017/phase4/POST-BATCH/impl-2026-10-25/production-deployments-161-168.json):
      #168 dpl_FJkdCc2U5cs59tvXoXePtTS6L7M9   #163 dpl_9FE1PG1jVgiT2Jg5w8nvqF1qyv2f
      #166 dpl_6hSsFjnE2er13oqqwgG1oDiw68zq   #165 dpl_DgFWZBrAHzYG4TA77fQj6u9ZRZiU
      #161 dpl_HTFfKXQUcc5a6ZQsaeVp4iR1sf5X   #164 dpl_xBFcWGTZ9UCgyt7DNMYDiXHYh6xa
      #167 dpl_F2vPJoGpok7kc4KEYPaGdzwq3GLa
    Worded from each merge's diff and description. #161, #164 and #167 switched nothing on: their entries name what a
    visitor can read or see now and say that the rest is off on tavonel.com; #166's strip renders on preview deployments only.
  */
  {
    date: "2026-10-25",
    releasedAt: "2026-10-25T10:59:38Z",
    id: "2026-10-25-remote-mcp-docs",
    title: "/docs/mcp documents the remote MCP endpoint, which is switched off on tavonel.com",
    surfaces: ["Developer tools"],
    added: [
      "/docs/mcp has a section on the remote MCP endpoint, for clients that connect by URL instead of launching a local process, such as ChatGPT connectors and other web agents: how to connect, the OAuth flow step by step and the read-only scopes a connection gets. Its heading and its first note say it is not enabled in production, and on tavonel.com every URL in that section answers 404, so connect through the stdio server on the same page.",
    ],
  },
  {
    date: "2026-10-25",
    releasedAt: "2026-10-25T10:10:30Z",
    id: "2026-10-25-change-notifications",
    title: "/docs/run-events sets out the change-notification contract, with sending switched off",
    surfaces: ["API"],
    added: [
      "/docs/run-events describes change notifications: one signed POST to the endpoint registered for a workspace when a finished compile's candidate differs from the World your AI reads, with the field table, a Node.js snippet that verifies the signature, and how retries and duplicate deliveries behave.",
      "A notification activates nothing: the candidate waits for a person to approve it in the workspace. Notifications are set up per workspace with us, and on tavonel.com sending is switched off and no endpoint is registered, so none are sent.",
    ],
  },
  {
    date: "2026-10-25",
    releasedAt: "2026-10-25T09:34:17Z",
    id: "2026-10-25-processing-terms",
    title: "The workspace offers the processing terms only where accepting them opens processing",
    surfaces: ["Workspace"],
    improved: [
      "The workspace shows the processing-terms review only where accepting the terms is the step that opens processing for your files. Elsewhere, including a released workspace whose evaluation was refused or has ended, it offers Explore a compiled World. Nothing is switched on by this release, and online purchase stays closed on tavonel.com.",
    ],
  },
  {
    date: "2026-10-25",
    releasedAt: "2026-10-25T08:42:25Z",
    id: "2026-10-25-copy-truth",
    title: "Public pages and developer files say what the product does",
    surfaces: ["Website", "Developer tools", "Billing"],
    improved: [
      "/integrations says that compiling your own sources is set up with us, that you start each read-only import yourself, and that nothing is compiled until you start the compile. Its description of the source agent covers the --watch mode, which repeats the sync until it is stopped, and the retries inside a run, bounded by --retry-limit.",
      "/pricing describes each plan's page allowance as standard pages, without “verified”.",
      "/docs/upload shows the fields the upload capability returns, uploadUrl, expiresInSeconds, declaredMimeType and contentLength, in its prose and in the cURL, Python and TypeScript examples.",
      "The quickstart, the CLI page, the integration recipes and the developer README read the signing key's fingerprint from the v2 trust record, under keys[] for the active key.",
      "The MCP server's download_package names tavonel-verify-export.mjs, the verifier the developer channel ships, and channel.json carries the server's new digest.",
      "/status reports billing from whether a plan can be bought online, so on tavonel.com it says that checkout is closed and no plan can be bought.",
      "Home's support line says TAVONEL reads your PDFs, scans and office files, in English and Korean. /sources says in Korean that Korean document quality has not been measured and that HWP and HWPX are not supported, and /llms.txt uses the same wording as the pages it summarises.",
    ],
  },
  {
    date: "2026-10-25",
    releasedAt: "2026-10-25T07:05:33Z",
    id: "2026-10-25-specimens",
    title: "Two public pages read by the OCR image the product runs, with their run receipts",
    surfaces: ["Website"],
    added: [
      "/proof-collection/specimens/ publishes two one-page extracts, each read once by the OCR image the product runs: page 1 of NACA Research Memorandum RM L50C03 (1950), a U.S. government work, and page 1 of the Korea Meteorological Administration's September 2026 climate press release, under KOGL Type 1. Each comes with its crops and a run receipt that records the reader image digest, every region the reader returned, the crop rule fixed before the run, and what the run does not claim, any accuracy figure among it.",
      "Home shows the two pages as a strip under its actions on preview deployments only; tavonel.com does not render it.",
    ],
  },
  {
    date: "2026-10-25",
    releasedAt: "2026-10-25T06:07:30Z",
    id: "2026-10-25-analytics-notice",
    title: "The privacy notice names what Vercel Web Analytics receives, and the Home film stills are AVIF",
    surfaces: ["Website"],
    improved: [
      "/privacy and /subprocessors describe Vercel Web Analytics, run by our hosting provider: what it counts and receives once you allow analytics, that it uses no cookies or storage on your device, and what it is never sent. The cookie table lists the two session-storage entries the site keeps in your tab and does not send.",
      "Home's four film stills are AVIF files, with a WebP copy of the same frame for a browser without AVIF. The first two stages show a new frame from the same recording.",
    ],
  },
  {
    date: "2026-10-20",
    releasedAt: "2026-10-19T17:51:42Z",
    id: "2026-10-20-developers-mcp-guide",
    title: "Separate link targets on /developers, code set as code on /docs/mcp, and a re-recorded MCP walkthrough",
    surfaces: ["Website", "Developer tools"],
    improved: [
      "On a phone, each link on /developers is a full-size tap target clear of its neighbours: the two gate actions sit in a row of their own, and each reference sentence is its own list item.",
      "/docs/mcp prints the Windows configuration path with one backslash between folders and sets file paths as code, drawn in a monospace face on every system, Korean Windows included. Its configuration examples use /absolute/path/to/tavonel-mcp.mjs as the placeholder.",
      "Each chapter of /guide and /ko/guide says under its heading whether its steps need an API key.",
      "The MCP bridge walkthrough is re-recorded in its desktop and phone takes, with the same English and Korean captions, so it shows /developers and /docs/mcp as they are now. The takes come from a local production build of that release rather than from tavonel.com, and the guide's manifest says so.",
      "/changelog lists the releases from 7 to 19 October, each dated by the day it reached tavonel.com.",
    ],
  },
  /*
    Phase 4 follow-ups backfill, 2026-10-19: every main merge from #143 to #160 that changed
    something a visitor or a downloaded client can meet. Each entry is dated by the Asia/Seoul day
    its own production deployment reached tavonel.com and timed by that deployment's READY time,
    read from Vercel with `vercel ls --prod` and `vercel inspect` (receipt:
    ux-program-20261017/phase4/FOLLOWUPS/production-deployments-143-160.json). The deployments:
      #160 dpl_3rwc77Jiwxr7fByrCBM4UnvcKhMY   #159 dpl_EG331q9ZCj4VmrVpf6eBF6cHpDaH
      #157 dpl_4ZGdna6chWuvqezDqn6Gh3GA7Bji   #151 dpl_AKih8eHDjTz9jpqhrnSVhuqZotX7
      #149 dpl_4eqGTMU6SxLbfmUCP6e5tTqEZZh5   #148 dpl_7171DiJqoHWEve7Tipmrh9QopSRy
      #147 dpl_LqYr9TrsotpscjVUgJbgUFKkbaxW   #146 dpl_ANthMstY9u8D5NXtegiNLYykPyms
      #145 dpl_HSLwHfWTMaV34arJuC1xaupxV7Yj   #144 dpl_H5SJ7cGnkcCFWA62V6vpz2zLdz11
      #143 dpl_G8Cp59cMYMqf3yyDdp81U3GjXy3b
    #150 has its entry already (2026-10-16). By docs/CHANGELOG_ENTRY_RULE.md these have none: #152
    (OCR page ranges, behind flags that are off in production), #153 (decision records), #154 and
    #156 (internal failure codes and a review-receipt version, met only in a workspace with your
    own documents, which is closed in production), #155 (a worker image) and #158 (ADR citations).
    Worded from each merge's diff and description; what a rollout switch keeps off is not listed.
  */
  {
    date: "2026-10-19",
    releasedAt: "2026-10-19T12:15:39Z",
    id: "2026-10-19-design-system",
    title: "One design system across the public pages, a sharper Evidence Line, and checkout messages written for people",
    surfaces: ["Website", "Billing"],
    improved: [
      "Every public page is built from one set of colour tokens, one type scale in Wanted Sans and one page container, and follows one of six page templates. From 900px the header carries its main action beside the navigation.",
      "On Home, the Evidence Line outlines the region it points at on the source page, and its coordinate label is set in ink. A line opened from the keyboard appears at once, and with reduced motion nothing on the workbench animates.",
      "Sign-in says whether the plan you picked can be bought online: Team reads “Team is not sold online today.” with Request Team access beside it. When the purchase state cannot be read, the heading is “Sign in to TAVONEL.” and the page promises no checkout.",
      "Checkout, billing-portal and pilot-access refusals are shown as sentences without the raw error code, and screen readers announce them as alerts.",
    ],
  },
  {
    date: "2026-10-19",
    releasedAt: "2026-10-19T08:40:38Z",
    id: "2026-10-19-guide",
    title: "A product guide in English and Korean, three recorded walkthroughs, and the API to try without a key",
    surfaces: ["Website", "Developer tools", "API"],
    added: [
      "/guide and /ko/guide walk through the public product chapter by chapter, from opening the public World to connecting the MCP bridge, with a glossary. Every quoted sentence on them is the live text of the page it quotes.",
      "Three recorded walkthroughs, of Explore, the MCP bridge and the first API and CLI calls, each in a desktop and a phone take with English and Korean captions and a transcript. They are screen recordings, and none of them plays by itself.",
      "Try it, with no key opens /docs/quickstart and sits on /developers too: three unauthenticated reads that run from the page, and where a response sends a Content-Digest the page checks it over the bytes received.",
    ],
    improved: [
      "The cookbooks index is linked from /resources and from the documentation hub, and listed in the sitemap.",
      "Every changelog entry is anchored at the date it shows, a fragment published earlier still opens its entry, and the Atom feed takes its date from its newest entry.",
      "The getting-started pages state no time to a first result.",
    ],
  },
  {
    date: "2026-10-19",
    releasedAt: "2026-10-19T06:37:45Z",
    id: "2026-10-19-benchmarks-notes",
    title: "Campaign notes on Benchmarks show machine paths as “[local path removed]”",
    surfaces: ["Website"],
    fixed: [
      "A campaign note on /benchmarks shows the scoring machine's absolute path as “[local path removed]”, and the fold says so. The committed campaign board keeps the note as recorded, under the same sha256.",
    ],
  },
  {
    date: "2026-10-19",
    releasedAt: "2026-10-19T02:15:45Z",
    id: "2026-10-19-documents-contract",
    title: "The document list reports what it could not read, and the OpenAPI document matches the routes",
    surfaces: ["API", "Workspace"],
    added: [
      "GET /api/documents answers 503 with QUARANTINE_LIST_UNAVAILABLE when the document listing cannot be read, and its response carries a partial marker naming the documents that could not be loaded. The workspace shows both states as such.",
      "The OpenAPI document publishes the upload confirmation operation and developer key creation.",
    ],
    improved: [
      "The upload capability, upload confirmation, developer key create and rotate, and audit operations publish the response bodies those routes return.",
      "Sources still being processed appear in the document list as stored.",
    ],
  },
  {
    date: "2026-10-15",
    releasedAt: "2026-10-15T14:32:11Z",
    id: "2026-10-15-home-first-screen",
    title: "Home: “Knowledge your AI can trust.”, a consent card that waits, and the Evidence Line",
    surfaces: ["Website"],
    improved: [
      "The headline is “Knowledge your AI can trust.”, and “AI가 믿고 사용하는 지식.” on the Korean entry page.",
      "The analytics consent card appears once you scroll down the page or after eight seconds, whichever comes first, and Analytics preferences in the footer opens it at once. Analytics still loads only after consent.",
      "Each film stage's reading line quotes text that is on screen in that stage.",
      "On a desktop, hovering or focusing a source region draws a line from the passage to that region's box on the page, labelled with the record's page and coordinates.",
      "The phone menu is a single icon control, the phone footer is a two-column grid, and cards share one corner radius.",
    ],
  },
  {
    date: "2026-10-15",
    releasedAt: "2026-10-15T03:03:49Z",
    id: "2026-10-15-home-film",
    title: "The four-stage film under the title, with Fit and Focus",
    surfaces: ["Website"],
    improved: [
      "The four-stage film, Files, Organize, Updates and Use with AI, plays directly under the title.",
      "Fit, the whole frame, is the default at every width. Focus is a zoom you choose, and on a narrow screen its controls sit in a toolbar outside the film.",
    ],
  },
  {
    date: "2026-10-13",
    releasedAt: "2026-10-13T11:54:48Z",
    id: "2026-10-13-source-recording",
    title: "Home opens on a recording of a real source being inspected",
    surfaces: ["Website"],
    improved: [
      "Below the headline, a recording of a prepared source inspection, with its own crop on a phone. Nothing is decoded until you press play.",
      "Product presents the public World and the outputs bound to its sources, and How it works keeps the six-step process. Long source, method and version descriptions are folded into disclosures.",
      "The GDP.pdf result moves from Home to Benchmarks, where its report and conditions are unchanged.",
    ],
  },
  {
    date: "2026-10-13",
    releasedAt: "2026-10-13T03:21:10Z",
    id: "2026-10-13-how-it-works",
    title: "How it works gets its own page, and Home shows its film and a negative result",
    surfaces: ["Website"],
    added: [
      "/how-it-works follows a source through six steps, from a versioned input to a new version when the source changes, and it is in the navigation and the sitemap.",
      "Home prints the GDP.pdf two-arm result, in which compiled context scored below the PDF alone, labelled with its historical, unofficial conditions.",
    ],
    improved: [
      "The four-cut illustrative film plays directly below the headline, and the source workbench follows it as the second scene.",
      "Product presents what the outputs are used for.",
    ],
  },
  {
    date: "2026-10-13",
    releasedAt: "2026-10-13T00:07:58Z",
    id: "2026-10-13-public-ui",
    title: "Public pages centred on the real filing, with one typography and navigation",
    surfaces: ["Website"],
    improved: [
      "Home centres the real filing and its selectable passages, and its source, rights and version details open as disclosures.",
      "Public pages share one typography, one set of surfaces and one navigation. Evidence prose has a readable width, and changelog links keep their 44px touch targets.",
    ],
  },
  {
    date: "2026-10-12",
    releasedAt: "2026-10-12T13:17:34Z",
    title: "Home shows a source page beside its passage, and evaluations have their own page",
    surfaces: ["Website"],
    added: [
      "/evaluation and /ko/evaluation set out how an evaluation of your documents is agreed: permissions, questions, limits, costs and evidence quality before processing begins. Both have share cards and are in the sitemap.",
    ],
    improved: [
      "Home opens on a source page beside the passage read from it, with region selection linked between the two and the context the passage needs stated beside it. The illustrative walkthrough is a closed disclosure.",
    ],
  },
  {
    date: "2026-10-07",
    releasedAt: "2026-10-07T09:35:56Z",
    title: "The Compiled World and Continuous Knowledge product pages",
    surfaces: ["Website"],
    added: [
      "/product/compiled-world lists the files emitted for the public sample behind Explore, with each file's format, size and content digest and a preview of its content.",
    ],
    improved: [
      "/product/continuous-knowledge opens on “See what changed before you activate it.”: compile a candidate, compare the versions, and choose what becomes current, with the replaced version kept intact and readable.",
    ],
  },
  /*
    EN-0 backfill, 2026-10-19. Both entries are dated by the production deployment that put them
    on tavonel.com, read from Vercel: dpl_3JjTwcBhpjARzmQ6xGYR8JU2cdm2 (main bcba7173, PR #150)
    READY 2026-10-16T05:52:06Z, and dpl_7fEfTdmcPi8FfDyrXs17dMiF9gm2 (main 4c80bb30, PR #141)
    READY 2026-10-16T12:33:49Z (receipt: ux-program-20261017/enablement/EN-0/). The developer
    channel's own manifest dates 2026.10.2.1 to 2 October; it reached the site with PR #141.
    Worded from the two merge diffs; the rollout switches PR #141 carried are off in production,
    so only what a visitor or a downloaded client can meet is listed.
  */
  {
    date: "2026-10-16",
    releasedAt: "2026-10-16T12:33:49Z",
    id: "2026-10-16-developer-channel",
    title: "Developer files 2026.10.2.1: an optional consumer context for the CLI and the MCP server",
    version: "2026.10.2.1",
    surfaces: ["Developer tools"],
    added: [
      "consumer-context.mjs joins the files published at /developer/, pinned by sha256 in channel.json like the others. The CLI and the MCP server load it from their own directory, so install every file channel.json lists into one directory and check each digest.",
      "The CLI and the MCP server accept an optional consumer context in TAVONEL_CONSUMER_CONTEXT and send it with every request. With TAVONEL_CONSUMER_CONTEXT_REQUIRED=true they refuse any read whose response does not acknowledge that context. This is local synthetic evidence only: the production API does not acknowledge the context headers, so the required mode refuses every read made against it.",
    ],
    improved: [
      "With neither variable set, the CLI and the MCP server send no context headers and do not load consumer-context.mjs.",
      "The source agent and the developer README are republished with new digests in the same channel. Intake for your own sources is arranged with us, as the quickstart says.",
    ],
  },
  {
    date: "2026-10-16",
    releasedAt: "2026-10-16T05:52:06Z",
    title: "A homepage that states its outcome, with the published research results and their receipts beneath it",
    surfaces: ["Website"],
    added: [
      "Beneath the headline, a band of published research results, each printed with its denominator, the condition its claim has to carry and a link to the receipt it came from. The figures are read from the generated claims pack rather than typed into the page, and the low-quality-scan result is printed with the others.",
    ],
    improved: [
      "The headline is the outcome, “Turn documents into context your AI can cite.”, with “The Knowledge Compiler for AI” above it. The Korean entry page carries its literal translation, and the browser tab and link previews use the same sentence.",
      "The first action, in the header and on the page, opens the public sample (“Open the compiled sample”). “Bring your own documents” goes to the contact page, where intake for your own sources is arranged with you.",
      "The four recorded film cuts are unchanged, and their still frames are new frames taken from the same cuts. On a desktop each stage opens on the enlarged reading view where both panes carry content, and on the full frame where they do not; Focus details switches between the two.",
      "On a phone the passage being read is printed as text directly above the film, and the analytics consent notice stays clear of both.",
    ],
  },
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
    previousId: "2026-09-19",
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
    previousId: "2026-09-16",
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
    id: "2026-09-18-pricing",
    previousId: "2026-09-14",
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
  /*
    EN-5. This release moved the API contract from 2026-08-30.1 to 2026-09-02.1: commit 68215e58
    (2 September) changed info.version and added /runs/{runId}/events and /reviews in the same
    change that wrote this entry's text, and the contract has carried 2026-09-02.1 since (it moved
    into lib/api-version.ts unchanged in 129af2eb). The entry never named it, so /api/openapi
    served a version no entry recorded.
  */
  {
    date: "2026-09-02",
    title: "Run events and page-based quotes",
    apiVersion: "2026-09-02.1",
    surfaces: ["Workspace", "API", "Billing"],
    added: [
      "API contract 2026-09-02.1 adds GET /runs/{runId}/events, which replays a run's persisted events after Last-Event-ID and then streams new ones, and POST /reviews, which records an Accept, Edit or Reject decision on a piece of evidence from a signed-in browser session.",
    ],
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

/** The entry's anchor on the page: its date, or its date and a suffix when two share one. */
export function changelogEntryId(entry: ChangelogEntry): string {
  return entry.id ?? entry.date;
}

/** The Atom id, which never changes once published: the first fragment the entry had. */
export function changelogFeedId(entry: ChangelogEntry): string {
  return entry.previousId ?? changelogEntryId(entry);
}

/** Older date-only entries keep their existing feed timestamp until a receipt is recovered. */
export function changelogEntryUpdatedAt(entry: ChangelogEntry): string {
  return entry.releasedAt ?? `${entry.date}T00:00:00Z`;
}

/**
 * Newest first, which is the order the page and the feed both want: by date, then by deployment
 * time when two releases share a date, then in the order they are declared (the sort is stable).
 */
export function changelogEntries(surface?: ChangelogSurface): ChangelogEntry[] {
  // `filter` already copies, so the sort is not mutating the exported array.
  return CHANGELOG
    .filter((entry) => !surface || entry.surfaces.includes(surface))
    .sort((left, right) => right.date.localeCompare(left.date) || changelogEntryUpdatedAt(right).localeCompare(changelogEntryUpdatedAt(left)));
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
  return CHANGELOG.map(changelogEntryUpdatedAt).sort().at(-1)!;
}
