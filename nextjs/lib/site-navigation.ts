/**
 * One navigation, declared once, rendered by every public surface.
 *
 * The site had four different chromes. `PublicPageShell` offered seven links and a "Try
 * TAVONEL" button; the landing header offered the same seven but a "Sign in" button; the
 * research, evidence, security and product pages each hand-rolled a three-link nav ending in
 * "Back to the compiler"; and `PublicProofRegistry` shipped a fourth nav whose links pointed at
 * two routes that deliberately return 404. A visitor moving between pages watched the site's
 * structure change under them — the repository's folder layout showing through as UI.
 *
 * Navigation is data here so the landing page, which needs its own scroll-reactive header
 * element, still renders the same links as the static shell rather than a copy that drifts.
 *
 * `/research` is no longer disguised as "Resources". Resources is its own hub that lists the
 * research, evidence and reproducibility material underneath it.
 */

export type SiteLink = { href: string; label: string };

/*
  WG-048 / WG-051: what each resource is *for*, declared beside the link rather than on the hub.

  The hub had nine links and no way to narrow them, so a reader who wanted "can I build on this"
  read nine descriptions to find three. The tags live here because `e2e/overflow-audit.spec.ts`
  already reads this file and `lib/resources-hub.test.ts` fails on an untagged entry: a tenth
  link arrives tagged, or the hub's filter silently drops it out of every view but "Everything".

  The three workflow tags are the growth blueprint's own three demonstrations (§4), not new
  product names, and an entry carries one only where the page actually helps with that workflow
  today. `/explore` is tagged `compile-and-review` and deliberately not `handle-a-revision`:
  its four 2026 filings are corpus growth, which the blueprint separates from a revision of the
  same source.
*/
export type ResourcePurpose = "evaluate" | "build" | "verify" | "learn";
export type ResourceWorkflow = "compile-and-review" | "use-elsewhere" | "handle-a-revision";
export type ResourceTag = ResourcePurpose | ResourceWorkflow;
export type ResourceLink = SiteLink & {
  purposes: readonly ResourcePurpose[];
  workflows: readonly ResourceWorkflow[];
  /*
    A representative case is a page that already publishes a real compiled result. Nothing is
    promoted to one on the strength of a plan: `/explore` qualifies because its World is
    compiled at build time from committed public filings and refuses to load if a digest moves.
  */
  representativeCase?: true;
};

export const RESOURCE_PURPOSES: readonly ResourcePurpose[] = ["evaluate", "build", "verify", "learn"] as const;
export const RESOURCE_WORKFLOWS: readonly ResourceWorkflow[] = [
  "compile-and-review",
  "use-elsewhere",
  "handle-a-revision",
] as const;

/** One label per tag, so the hub, its filter and a solution page cannot describe a tag differently. */
export const RESOURCE_TAG_LABELS: Record<ResourceTag, string> = {
  evaluate: "See what it does",
  build: "Build on it",
  verify: "Check the evidence",
  learn: "Understand the idea",
  "compile-and-review": "Documents to reviewable output",
  "use-elsewhere": "Use a World somewhere else",
  "handle-a-revision": "Handle a source revision",
};

/**
 * The hub's filter is a fragment, not a query string.
 *
 * `/resources#find-build` is a link anyone can send and a crawler treats as the same document,
 * so the filter adds no thin duplicate URL to the sitemap and needs no canonical of its own.
 * `app/resources/resources.module.css` does the narrowing with `:target`.
 */
export const resourceFilterHref = (tag: ResourceTag) => `/resources#find-${tag}`;

export const PRIMARY_NAV: readonly SiteLink[] = [
  { href: "/product", label: "Product" },
  { href: "/solutions/ai-ready-knowledge", label: "Solutions" },
  { href: "/integrations", label: "Integrations" },
  { href: "/developers", label: "Developers" },
  { href: "/security", label: "Security" },
  { href: "/pricing", label: "Pricing" },
  { href: "/sources", label: "Sources" },
  { href: "/resources", label: "Resources" },
] as const;

/** What the Resources hub collects. Also the Resources dropdown, when there is one. */
export const RESOURCE_LINKS: readonly ResourceLink[] = [
  {
    href: "/explore",
    label: "Explore a Compiled World",
    purposes: ["evaluate", "verify"],
    workflows: ["compile-and-review"],
    representativeCase: true,
  },
  { href: "/knowledge-compiler", label: "Knowledge Compiler guide", purposes: ["learn"], workflows: [] },
  {
    href: "/docs",
    label: "Documentation",
    purposes: ["build"],
    workflows: ["compile-and-review", "use-elsewhere", "handle-a-revision"],
  },
  { href: "/api", label: "API", purposes: ["build"], workflows: ["use-elsewhere"] },
  { href: "/changelog", label: "Changelog", purposes: ["build"], workflows: [] },
  { href: "/research", label: "Research", purposes: ["learn"], workflows: [] },
  { href: "/benchmarks", label: "Benchmarks", purposes: ["verify"], workflows: [] },
  {
    href: "/evidence",
    label: "Technical evidence",
    purposes: ["verify"],
    workflows: ["compile-and-review", "use-elsewhere"],
  },
  { href: "/reproducibility", label: "Reproducibility", purposes: ["verify"], workflows: [] },
] as const;

/**
 * Four groups, not fourteen flat links.
 *
 * The old footer listed every page it could reach in one row, which reads as a sitemap rather
 * than a way out of a page. These are the four questions a reader actually leaves with: what is
 * it, how do I build on it, can I trust it, what am I agreeing to.
 */
export const FOOTER_GROUPS: readonly { title: string; links: readonly SiteLink[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/product", label: "Product" },
      { href: "/solutions/ai-ready-knowledge", label: "Solutions" },
      { href: "/integrations", label: "Integrations" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Build",
    links: [
      { href: "/docs", label: "Docs" },
      { href: "/api", label: "API" },
      { href: "/developers", label: "MCP and agents" },
      { href: "/changelog", label: "Changelog" },
    ],
  },
  {
    title: "Trust",
    links: [
      // First, because it indexes the three below it and two more in Legal. A Trust Center
      // reachable only by typing its URL is a Trust Center nobody in procurement finds.
      { href: "/trust", label: "Trust Center" },
      { href: "/security", label: "Security" },
      { href: "/status", label: "Status" },
      { href: "/subprocessors", label: "Subprocessors" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
      { href: "/refunds", label: "Refunds" },
    ],
  },
] as const;
