import type { Route } from "next";

/*
  The one typed registry behind every V34 route: metadata, sitemap, llms.txt, nav, the More panel,
  analytics measurement and the QA matrix all derive from it. Changing one `release` value changes
  that route's state everywhere.

  This module is imported by client code through the nav, so it carries no flip conditions and no
  internal task identifiers in any string. Why a route is held, and what turns it live, is written
  in the comments next to it, which the bundler drops.
*/

export type V34Release = "live" | "held";
export type V34NavGroup = "product" | "for-you" | "build-trust" | "company";
export type V34SchemaKind = "WebPage" | "Article" | "CollectionPage";

export const V34_ROUTE_KEYS = [
  "home", "platform", "world", "evidence", "changes", "autopilot", "connect", "pricing", "personal",
  "research", "creators", "teams", "enterprise", "developers", "security", "governance", "methods",
  "federation", "capabilities", "studio", "solutions", "company", "contact", "compiler", "markets",
  "engineering", "billing", "catalog", "marketplace", "steward", "skills", "outcomes", "film",
  "trading", "realestate", "community", "journal", "journal-compiler", "journal-mcp",
  "journal-revision", "journal-markets", "journal-property", "journal-research",
] as const;
export type V34RouteKey = (typeof V34_ROUTE_KEYS)[number];

export interface V34RouteRecord {
  readonly key: V34RouteKey;
  /** No trailing slash, except the root. */
  readonly path: Route;
  /** Absolute canonical URL on the production origin. */
  readonly canonical: string;
  /** 50-60 characters ending " — TAVONEL"; home starts "TAVONEL — " and is sized by its own rule. */
  readonly title: string;
  /** The page heading: the title without the brand ("TAVONEL — " on home, " — TAVONEL" elsewhere). */
  readonly heading: string;
  /** 120-160 characters, no semicolons. */
  readonly description: string;
  readonly release: V34Release;
  readonly nav: { readonly group: V34NavGroup; readonly label: string } | null;
  readonly primaryNav?: true;
  readonly schema: V34SchemaKind;
  /** Journal articles only. Filled from the first and last commit dates of the article source. */
  readonly article?: { readonly published: string; readonly modified: string };
  readonly ogLabel: string;
  /** In the sitemap, llms.txt and the More panel: live routes only. */
  readonly sitemap: boolean;
  /** Counted by public-page analytics: live routes only. */
  readonly measured: boolean;
}

export const V34_ORIGIN = "https://tavonel.com";
const SUFFIX = " — TAVONEL";
const HOME_PREFIX = "TAVONEL — ";

type Row = Omit<V34RouteRecord, "heading" | "canonical" | "sitemap" | "measured">;

/* A held route renders only in preview and when V34_SHOW_HELD is set; production answers 404. */
const ROWS: readonly Row[] = [
  { key: "home", path: "/", title: "TAVONEL — Context your AI can cite, compiled from your documents.",
    description: "Inspect a finished public Compiled World, follow one result to its exact source region, and compare what changed before you discuss your own sources.",
    release: "live", nav: null, schema: "WebPage", ogLabel: "Knowledge Compiler for AI" },
  { key: "platform", path: "/platform", title: "Compile documents into a World AI can cite",
    description: "Compile documents into a versioned World with evidence regions, compare what changed between versions, read it over MCP and export a signed package.",
    release: "live", nav: { group: "product", label: "Platform" }, primaryNav: true, schema: "WebPage", ogLabel: "Platform" },
  { key: "world", path: "/world", title: "A public reference World you can inspect",
    description: "Open the public reference corpus as a World of records, relationships and sources, then follow each relationship back to the document it came from.",
    release: "live", nav: { group: "product", label: "World" }, schema: "WebPage", ogLabel: "World" },
  { key: "evidence", path: "/evidence", title: "Evidence regions behind every cited answer",
    description: "Each cited result points to an exact region of a source document. Open the region, read the original text and check the file hash before you rely on it.",
    release: "live", nav: { group: "product", label: "Evidence" }, schema: "WebPage", ogLabel: "Evidence" },
  { key: "changes", path: "/changes", title: "Compare what changed between two versions",
    description: "See which records changed when a source document is revised, compare two World versions side by side and roll back to an earlier version when needed.",
    release: "live", nav: { group: "product", label: "Changes" }, schema: "WebPage", ogLabel: "Changes" },
  // held: no proactive agent ships, only a scheduled change check. Live when an autopilot capability receipt exists.
  { key: "autopilot", path: "/autopilot", title: "Autopilot for keeping a World up to date",
    description: "A preview of Autopilot, which keeps a World current by watching sources and proposing updates for a person to review before anything is published.",
    release: "held", nav: { group: "product", label: "Autopilot" }, schema: "WebPage", ogLabel: "Autopilot" },
  { key: "connect", path: "/connect", title: "Connect a World to your AI client over MCP",
    description: "Configuration steps for reading a World from an MCP client through a local stdio server or the HTTP API, with an API key and read-only tools.",
    release: "live", nav: { group: "build-trust", label: "Connect" }, primaryNav: true, schema: "WebPage", ogLabel: "Connect" },
  { key: "pricing", path: "/pricing", title: "Pricing for compiling and reading Worlds",
    description: "See the evaluation allowance, each plan and how to get it, what a credit buys, the refund terms and an estimate of what a document set costs to compile.",
    release: "live", nav: { group: "company", label: "Pricing" }, primaryNav: true, schema: "WebPage", ogLabel: "Pricing" },
  { key: "personal", path: "/personal", title: "Turn your own PDFs into a World you can cite",
    description: "Compile your own PDFs into a World of your own, cite answers back to the page they came from, read it from an MCP client and revoke any API key at any time.",
    release: "live", nav: { group: "for-you", label: "Personal" }, schema: "WebPage", ogLabel: "Personal" },
  { key: "research", path: "/research", title: "A research record that cites its sources",
    description: "Keep papers, datasets and notes as a World where every claim links to its source, shown on the public TRAPPIST-1 reference corpus.",
    release: "live", nav: { group: "for-you", label: "Research" }, schema: "WebPage", ogLabel: "Research" },
  // held: canon and branching are not shipped and the story-bible table is hand-curated. Live with a compiled public sample and its digest receipt.
  { key: "creators", path: "/creators", title: "Canon and continuity for creative worlds",
    description: "A preview of how story canon, characters and revisions can be compiled into a World with the source of each fact kept beside it for a writer to check.",
    release: "held", nav: { group: "for-you", label: "Creators" }, schema: "WebPage", ogLabel: "Creators" },
  // held: shared members and roles are still listed as not yet sold in the billing catalog. Live when that line leaves the catalog.
  { key: "teams", path: "/teams", title: "Shared Worlds for groups that work together",
    description: "A preview of Worlds shared across a group, with roles and review so several people can read, check and approve the same compiled knowledge.",
    release: "held", nav: { group: "for-you", label: "Teams" }, schema: "WebPage", ogLabel: "Teams" },
  { key: "enterprise", path: "/enterprise", title: "Knowledge compiled for large organizations",
    description: "Scope a TAVONEL deployment for your organization. Residency, sign-in and deployment terms are agreed with you before anything is promised.",
    release: "live", nav: { group: "for-you", label: "Enterprise" }, schema: "WebPage", ogLabel: "Enterprise" },
  { key: "developers", path: "/developers", title: "Build on the TAVONEL MCP server and HTTP API",
    description: "Read a World from code with read-only MCP tools on a local server, manage API keys and call the HTTP API, with the verification scripts alongside.",
    release: "live", nav: { group: "build-trust", label: "Developers" }, schema: "WebPage", ogLabel: "Developers" },
  { key: "security", path: "/security", title: "Security practices and verifiable exports",
    description: "How access to a World is controlled, how exports are signed and checked, and which operating facts you can verify yourself, with a link to each source.",
    release: "live", nav: { group: "build-trust", label: "Security" }, schema: "WebPage", ogLabel: "Security" },
  // held: the approval workflow is not shipped, only an audit export. Live with an approval and audit capability receipt.
  { key: "governance", path: "/governance", title: "Review and approval for compiled knowledge",
    description: "A preview of approval steps and audit trails for changes to a World, so a named reviewer signs off before knowledge reaches an AI client.",
    release: "held", nav: { group: "build-trust", label: "Governance" }, schema: "WebPage", ogLabel: "Governance" },
  { key: "methods", path: "/methods", title: "How TAVONEL compiles a document into records",
    description: "Follow the method from source file to evidence region, record and relationship, including how supported formats are read and how each step is checked.",
    release: "live", nav: { group: "product", label: "Methods" }, schema: "WebPage", ogLabel: "Methods" },
  // held: federation is a candidate, not a shipped capability. Live with its capability receipt.
  { key: "federation", path: "/federation", title: "Link separate Worlds without merging them",
    description: "A preview of federating Worlds, where one World cites records from another and each owner keeps control of the sources behind their own records.",
    release: "held", nav: { group: "build-trust", label: "Federation" }, schema: "WebPage", ogLabel: "Federation" },
  { key: "capabilities", path: "/capabilities", title: "What the knowledge compiler can do today",
    description: "Every capability listed with its current state, from the compiler contract clauses to supported formats, so you can see what is shipped and what is direction.",
    release: "live", nav: { group: "product", label: "Capabilities" }, schema: "WebPage", ogLabel: "Capabilities" },
  { key: "studio", path: "/studio", title: "A reference walkthrough of compiling a World",
    description: "Step through compiling a small sample into a World, from source file to evidence region to a cited answer, using a fixed reference walkthrough.",
    release: "live", nav: { group: "product", label: "Studio" }, schema: "WebPage", ogLabel: "Studio" },
  { key: "solutions", path: "/solutions", title: "Solutions for the people who rely on sources",
    description: "Find the way of working that matches yours, from personal research and engineering references to market filings, and see how a compiled World fits it.",
    release: "live", nav: { group: "for-you", label: "Solutions" }, primaryNav: true, schema: "CollectionPage", ogLabel: "Solutions" },
  { key: "company", path: "/company", title: "About TAVONEL and the principles we work by",
    description: "Who operates TAVONEL, the principles behind the product and where to find our legal, privacy and subprocessor documents.",
    release: "live", nav: { group: "company", label: "Company" }, schema: "WebPage", ogLabel: "Company" },
  { key: "contact", path: "/contact", title: "Talk to TAVONEL about your own document set",
    description: "Send a message about access, pricing or a document set you want compiled. Include the formats and rough volume so the answer can be specific.",
    release: "live", nav: { group: "company", label: "Contact" }, schema: "WebPage", ogLabel: "Contact" },
  { key: "compiler", path: "/compiler", title: "The compiler that reads documents into records",
    description: "See how a source file becomes records with evidence regions, which formats the compiler reads today and how each result is checked against its source.",
    release: "live", nav: { group: "product", label: "Compiler" }, schema: "WebPage", ogLabel: "Compiler" },
  { key: "markets", path: "/markets", title: "Market filings compiled into a cited World",
    description: "Explore a compiled sample of SEC filings, follow each figure to the filing that states it and compare reporting periods side by side.",
    release: "live", nav: { group: "for-you", label: "Markets" }, schema: "WebPage", ogLabel: "Markets" },
  { key: "engineering", path: "/engineering", title: "Engineering references with revision history",
    description: "Keep standards and procedures as a World where each requirement cites its source and a revision shows exactly which controls changed.",
    release: "live", nav: { group: "for-you", label: "Engineering" }, schema: "WebPage", ogLabel: "Engineering" },
  { key: "billing", path: "/billing", title: "How credits, pages and billing work together",
    description: "Credits pay for the pages a compile reads, and the balance is checked before a compile starts. Plans, prices and refund terms are on the pricing page.",
    release: "live", nav: { group: "company", label: "Billing" }, schema: "WebPage", ogLabel: "Billing" },
  // held: no licensed collection exists. Live with rights clearance and a catalog data receipt.
  { key: "catalog", path: "/catalog", title: "A catalog of licensed knowledge collections",
    description: "A preview of a catalog where rights holders list licensed collections, each with its source terms shown before anyone adds it to a World.",
    release: "held", nav: { group: "company", label: "Catalog" }, schema: "CollectionPage", ogLabel: "Catalog" },
  // held: no payout or fee mechanism ships. Live with rights clearance and a payout receipt.
  { key: "marketplace", path: "/marketplace", title: "A marketplace for compiled knowledge Worlds",
    description: "A preview of a marketplace where compiled Worlds can be offered and acquired, with terms and source rights visible before any purchase.",
    release: "held", nav: { group: "company", label: "Marketplace" }, schema: "WebPage", ogLabel: "Marketplace" },
  // held: only a review queue exists. Live with a steward capability receipt.
  { key: "steward", path: "/steward", title: "Stewards who keep a compiled World accurate",
    description: "A preview of the steward role, a named person who reviews proposed changes, resolves conflicts between sources and answers for the accuracy of a World.",
    release: "held", nav: { group: "build-trust", label: "Steward" }, schema: "WebPage", ogLabel: "Steward" },
  // held: the Skill contract is not shipped. Live with a Skill capability receipt.
  { key: "skills", path: "/skills", title: "Skills that apply compiled knowledge to a task",
    description: "A preview of Skills, reusable procedures an AI client follows with a World as its source, each run leaving a record of what it read and produced.",
    release: "held", nav: { group: "build-trust", label: "Skills" }, schema: "WebPage", ogLabel: "Skills" },
  // held: no customer result exists to report. Live with a pilot outcome receipt.
  { key: "outcomes", path: "/outcomes", title: "How an outcome report states what was measured",
    description: "What an outcome report has to state before a result counts: the measure, the period, the source of the data and the baseline it was compared against.",
    release: "held", nav: { group: "company", label: "Outcomes" }, schema: "WebPage", ogLabel: "Outcomes" },
  // held: storyboard only; production 404 is also enforced by the existing film layout. Live with a capture and its rights.
  { key: "film", path: "/film", title: "A storyboard of how a document becomes a World",
    description: "A storyboard of the compile film, frame by frame, showing a source file turn into records, evidence regions and a cited answer.",
    release: "held", nav: { group: "company", label: "Film" }, schema: "WebPage", ogLabel: "Storyboard" },
  // held: point-in-time queries and time-series data are not shipped. Live with a point-in-time query receipt and source rights.
  { key: "trading", path: "/trading", title: "Point-in-time knowledge for trading research",
    description: "A preview of asking what a source said as of a chosen date, so trading research can be replayed against the evidence available at that time.",
    release: "held", nav: { group: "for-you", label: "Trading" }, schema: "WebPage", ogLabel: "Trading" },
  // held: no property record sample exists. Live with a domain sample digest receipt and rights.
  { key: "realestate", path: "/realestate", title: "Property records compiled into a cited World",
    description: "A preview of property documents such as deeds, surveys and inspection reports compiled into a World, with each fact linked back to its page.",
    release: "held", nav: { group: "for-you", label: "Real estate" }, schema: "WebPage", ogLabel: "Real estate" },
  // held: implies directory listings that host review has not granted. Live with the listing approval evidence.
  { key: "community", path: "/community", title: "A community of people building on TAVONEL",
    description: "A preview of a place to share Worlds, MCP configurations and examples, and to see how other people connect their documents to an AI client.",
    release: "held", nav: { group: "company", label: "Community" }, schema: "WebPage", ogLabel: "Community" },
  { key: "journal", path: "/journal", title: "Field notes on compiling knowledge for AI",
    description: "Articles on compiling documents into knowledge an AI can cite, with the sources each piece relies on and links to the reference material behind it.",
    release: "live", nav: { group: "company", label: "Journal" }, primaryNav: true, schema: "CollectionPage", ogLabel: "Journal" },
  { key: "journal-compiler", path: "/journal/compiler", title: "What a knowledge compiler is and why it matters",
    description: "A plain explanation of what a knowledge compiler does differently from search and chat over files, with the sources behind each statement listed.",
    release: "live", nav: null, schema: "Article", article: { published: "2026-11-16", modified: "2026-11-16" }, ogLabel: "Journal" },
  { key: "journal-mcp", path: "/journal/mcp", title: "How an AI client reads a World through MCP",
    description: "What the Model Context Protocol is, why read-only tools suit compiled knowledge and how a client connects to TAVONEL, citing the specification.",
    release: "live", nav: null, schema: "Article", article: { published: "2026-11-16", modified: "2026-11-16" }, ogLabel: "Journal" },
  { key: "journal-revision", path: "/journal/revision", title: "What changed in a NIST control catalog revision",
    description: "A worked example of a standards revision: the NIST SP 800-53 release 5.2.0, how to read what changed, and how each change is traced to the published notice.",
    release: "live", nav: null, schema: "Article", article: { published: "2026-11-17", modified: "2026-11-17" }, ogLabel: "Journal" },
  // held: its subject, as-of queries, is not shipped. Live with the trading route and the editorial receipt.
  { key: "journal-markets", path: "/journal/markets", title: "Reading market filings as of a given date",
    description: "A preview article on asking what a filing said at a chosen date and why a point-in-time answer needs the evidence that existed then.",
    release: "held", nav: null, schema: "Article", article: { published: "2026-11-17", modified: "2026-11-17" }, ogLabel: "Journal" },
  // held: same as the real estate route. Live with it and the editorial receipt.
  { key: "journal-property", path: "/journal/property", title: "How property documents become a cited record",
    description: "A preview article on compiling deeds, surveys and inspection reports into records, and why each property fact should link back to its page.",
    release: "held", nav: null, schema: "Article", article: { published: "2026-11-17", modified: "2026-11-17" }, ogLabel: "Journal" },
  { key: "journal-research", path: "/journal/research", title: "A research record built from public sources",
    description: "A worked method for a literature review: an evidence register that ties each claim to its method, limitation and source passage, and checks each citation.",
    release: "live", nav: null, schema: "Article", article: { published: "2026-11-17", modified: "2026-11-17" }, ogLabel: "Journal" },
];

export const V34_ROUTES: readonly V34RouteRecord[] = ROWS.map((row) => {
  const live = row.release === "live";
  return {
    ...row,
    title: row.key === "home" ? row.title : `${row.title}${SUFFIX}`,
    heading: row.key === "home" ? row.title.slice(HOME_PREFIX.length) : row.title,
    canonical: `${V34_ORIGIN}${row.path === "/" ? "" : row.path}`,
    sitemap: live,
    measured: live,
  };
});

const BY_KEY = new Map<V34RouteKey, V34RouteRecord>(V34_ROUTES.map((route) => [route.key, route]));
const BY_PATH = new Map<string, V34RouteRecord>(V34_ROUTES.map((route) => [route.path, route]));

export function v34Route(key: V34RouteKey): V34RouteRecord {
  const route = BY_KEY.get(key);
  if (!route) throw new Error(`v34 routes: unknown key ${JSON.stringify(key)}`);
  return route;
}

export function v34RouteByPath(path: string): V34RouteRecord | undefined {
  return BY_PATH.get(path);
}

export const V34_LIVE_ROUTES: readonly V34RouteRecord[] = V34_ROUTES.filter((route) => route.release === "live");
export const V34_HELD_ROUTES: readonly V34RouteRecord[] = V34_ROUTES.filter((route) => route.release === "held");
export const V34_LIVE_PATHS: readonly Route[] = V34_LIVE_ROUTES.map((route) => route.path);
export const V34_HELD_PATHS: readonly Route[] = V34_HELD_ROUTES.map((route) => route.path);
