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
export const RESOURCE_LINKS: readonly SiteLink[] = [
  { href: "/explore", label: "Explore a Compiled World" },
  { href: "/knowledge-compiler", label: "Knowledge Compiler guide" },
  { href: "/docs", label: "Documentation" },
  { href: "/api", label: "API" },
  { href: "/changelog", label: "Changelog" },
  { href: "/research", label: "Research" },
  { href: "/benchmarks", label: "Benchmarks" },
  { href: "/evidence", label: "Technical evidence" },
  { href: "/reproducibility", label: "Reproducibility" },
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
