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
 * Navigation is data here so the three surfaces that render it -- the scroll-reactive header
 * every public page now shares (blueprint §8, 2026-09-19), its phone sheet, and the footer --
 * read one list rather than three copies that drift.
 *
 * `/research` is no longer disguised as "Resources". Resources is its own hub that lists the
 * research, evidence and reproducibility material underneath it.
 */

export type SiteLink = { href: string; label: string };

/*
  Customer entry points. Technical and trust destinations remain in the footer and docs.

  Landing V2, 2026-09-19 (blueprint §8, contract D2). Three became five, and the bar is the
  reader's map of the site rather than the three destinations a pilot visitor was steered to.

  "How it works" moves off /product and onto /knowledge-compiler. /product is a hub of four
  surface cards -- it says what the parts are called, not how the thing works -- while the compile
  contract, the four stages and the comparison with RAG, graphs and search are all written on
  /knowledge-compiler. /product takes its own name back, which is also the label its <title> and
  its H1 already use.

  Integrations leaves the bar. It is one Product-group destination among several and it was
  holding a top-level slot while Docs and Resources -- the two things an evaluating engineer looks
  for first -- had none. It is still a footer row, still linked from /sources, and its URL has not
  moved.
*/
export const CUSTOMER_NAV: readonly SiteLink[] = [
  { href: "/product", label: "Product" },
  { href: "/knowledge-compiler", label: "How it works" },
  { href: "/resources", label: "Resources" },
  { href: "/docs", label: "Docs" },
  { href: "/pricing", label: "Pricing" },
] as const;

/*
  The routes a bar item speaks for that do not sit underneath it.

  /sources used to be here, under Integrations, and it is deliberately not reassigned: no item in
  the five-link bar is the section /sources belongs to, so marking one of them current while a
  reader is on that page would tell them something false about where they are. It stays reachable
  from the footer's Product group and from /integrations itself.

  Resources owns the five pages its hub collects that have no bar item of their own. /explore,
  /docs, /api and /knowledge-compiler are excluded on purpose: two of them are bar items in their
  own right (Docs owns /docs and everything under it), /explore is the product, and /api is a
  Developers page the bar does not carry.
*/
const NAV_ALSO_OWNS: Readonly<Record<string, readonly string[]>> = {
  "/resources": ["/research", "/evidence", "/reproducibility", "/benchmarks", "/changelog"],
};

export function customerNavOwns(href: string, pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  // A prefix is only a prefix at a segment boundary: /productivity is not under /product.
  const under = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
  return (NAV_ALSO_OWNS[href] ?? []).some(under) || under(href);
}

/* ==================================================================== BA-232 / BA-252: vocabulary

  Two site-wide actions and one casing table, declared here because every chrome already reads
  this file.

  The 2026-09-11 brand audit inventoried 22 routes and found six verbs pointing at `/contact`
  ("Contact" on fifteen pages, "Request access", "Request evaluation", "Talk about a pilot",
  "Start a conversation", "Ask a security review question") and four names for `/explore`
  ("Explore a Compiled World", "Explore a World", "Explore the public World", "ENTER WORLD"). A
  reader cannot learn one verb for one action from that, and the desktop and phone headers read
  two different constants, so the same navigation made a different offer at two widths.

  `ACCESS_CTA` and `SELF_SERVE_CTA` are the two commercial postures, not two choices: which one
  applies is `lib/commercial-state.ts`'s answer and nothing else's. They live here so the header,
  the phone sheet and `primaryCallToAction` cannot drift apart -- that function returns these
  objects now rather than repeating their strings.

  A context variant is allowed only where the destination is genuinely different (a security
  question, scoping a pilot) and only phrased as an action. "Contact" is not an action.
*/

/** The access action while checkout is closed. `lib/commercial-state.ts` decides when it applies. */
export const ACCESS_CTA: SiteLink = { href: "/contact", label: "Request access" };

/** The access action once a real card can be charged. The same action, live posture. */
export const SELF_SERVE_CTA: SiteLink = { href: "/login", label: "Start with your files" };

/** The one name for the public sample, everywhere it is linked. */
export const EXPLORE_CTA: SiteLink = { href: "/explore", label: "Explore a Compiled World" };

/**
 * The positioning line, once.
 *
 * Five different sentences were carrying it — one in the hero, one in the footer, one in the OG
 * card, one in the metadata description and one on /ko — so the answer to "what is this" changed
 * depending on which surface a reader landed on first. These two strings are the answer; every OG
 * card, footer tagline and metadata description derives from them, and the other four go.
 *
 * Changing either string is a founder call: it is a public claim, not a copy edit. The headline
 * was changed once, by that route: the founder approved it through the 2026-09-19 Landing V2
 * design master blueprint (§0, §10.1, §43), which puts the outcome before the category name so a
 * first-time reader is not asked to learn "Knowledge Compiler" in order to parse the first
 * sentence on the site. The descriptor is unchanged.
 */
export const BRAND_LINE = {
  headline: "AI-ready knowledge. Traceable to every source.",
  descriptor: "Knowledge compiled with a traceable path back to every source.",
} as const;

/* ============================================================ G1-043 / G1-044: the Korean chrome

  One page, one map, and deliberately not an i18n layer.

  `/ko` is the site's only Korean URL (§12.4) and it was rendering an entirely English header and
  footer around Korean body copy -- the access button, the sign-in link, five footer group titles
  and the tagline -- so the one page written for a Korean reader asked them to read the navigation
  in the other language. Installing a locale framework to translate eleven strings is the wrong
  size of answer; a second page in a third language is when that conversation starts.

  The two CTA labels are keyed by destination rather than written as a list, so this cannot invent
  a third access action: a label here exists only where `ACCESS_CTA` or `SELF_SERVE_CTA` already
  points, and `lib/brand-copy.test.ts` fails if one of them loses its Korean counterpart.

  `stateLine` retired here with `deploymentStateLine()` on 2026-09-19. D2 took the deployment
  line out of the header (blueprint §8, §35), nothing else rendered it, and a Korean translation
  of a sentence no page prints is a claim with no surface. The gate itself is unchanged and is
  still stated verbatim where it is stated; the inventory is in `lib/commercial-state.ts`.
*/
export const KO_CHROME = {
  cta: { [ACCESS_CTA.href]: "이용 문의", [SELF_SERVE_CTA.href]: "내 자료로 시작하기" } as Record<string, string>,
  signIn: "로그인",
  /*
    BQ-013 / D12. The three primary destinations, keyed by href for the same reason the two CTA
    labels are: a label exists here only where `CUSTOMER_NAV` already points, so this table cannot
    invent a sixth section. Literal translations of the English labels -- a translation is not a
    new claim, and the primary nav vocabulary itself is the founder's. The spellings are the ones
    `footerLinks` below already uses, with one deliberate difference: /knowledge-compiler carries
    the bar's label ("How it works" / 작동 방식) rather than the page's name, because that is what
    the English bar says there too.
  */
  nav: {
    "/product": "제품",
    "/knowledge-compiler": "작동 방식",
    "/resources": "자료",
    "/docs": "문서",
    "/pricing": "요금",
  } as Record<string, string>,
  menu: "메뉴",
  footerGroups: {
    Product: "제품",
    Research: "리서치",
    Developers: "개발자",
    Trust: "신뢰와 보안",
    Legal: "약관",
  } as Record<string, string>,
  /*
    chrome-14 / D36. The footer was half translated: Korean group headings over 24 English link
    labels, which reads as an unfinished translation rather than a decision. Keyed by href for
    the same reason the nav and CTA tables are -- a label exists here only where FOOTER_GROUPS
    already points, so this cannot name a route the site does not have. Literal translations of
    the English labels; product names (TAVONEL, MCP, API) are not translated.
  */
  footerLinks: {
    "/product": "제품",
    "/solutions": "솔루션",
    "/integrations": "연동",
    "/sources": "지원 파일",
    "/knowledge-compiler": "지식 컴파일러",
    "/enterprise": "엔터프라이즈",
    "/pricing": "요금",
    "/benchmarks": "방법론",
    "/research": "리서치",
    "/evidence": "증거",
    "/resources": "자료",
    "/docs": "문서",
    "/api": "API",
    "/developers": "MCP와 에이전트",
    "/changelog": "변경 이력",
    "/trust": "신뢰 센터",
    "/security": "보안",
    "/status": "상태",
    "/subprocessors": "하위 처리자",
    "/contact": "문의",
    "/privacy": "개인정보 처리방침",
    "/terms": "이용약관",
    "/refunds": "환불 정책",
  } as Record<string, string>,
  tagline: "모든 결과에서 원문까지 다시 따라갈 수 있도록 컴파일합니다.",
  /*
    The deployment gate, in Korean, and the site's only Korean spelling of it.

    `stateLine` retired with the header line and this is not that sentence returning: it is the
    literal translation of `activationPolicy.customerData.reason`, which the footer states on
    every public route from this round on. D2's removal left eight routes stating the gate
    nowhere at all (`lib/commercial-state.ts` carries that inventory), and `/contact` -- the
    destination of the landing's own access action -- was one of them.

    `lib/landing-v2-copy.ts` reads this constant for the landing's Korean microtext rather than
    keeping a second translation of one sentence: the rule rule 5 applies to the English
    ("verbatim, never a second spelling") applies to its translation too.
  */
  customerDataGate:
    "이 배포판에서는 아직 고객의 파일을 컴파일하지 않습니다. 완성된 공개 Compiled World는 오늘 전체를 읽을 수 있고, 직접 가진 원문의 반입은 저희와 협의해 진행합니다.",
} as const;

/**
 * How the product's own nouns are spelled in public copy.
 *
 * The audit found the central noun lower-cased in one sentence and capitalised in the next on the
 * page named after it, and four objects carrying two names each. This is the table those surfaces
 * read; `lib/brand-copy.test.ts` fails on a retired spelling beside it. Ordinary English keeps
 * ordinary casing -- "a real-world thing" is not this noun.
 */
export const PRODUCT_NOUNS = [
  // BQ-098. The category noun, which the guide, the product page, the 404 and the root layout
  // all capitalise and one resource description did not: "what a knowledge compiler is" on the
  // card that links to the page titled "What is a Knowledge Compiler?".
  "Knowledge Compiler",
  "World",
  "Compiled World",
  "Trust Center",
  "Explore",
  "Ask",
  "Evidence",
  "Sources",
  "Studio",
] as const;

/*
  The spellings these replace are listed in `lib/brand-copy.test.ts` as `RETIRED_NAMES`, not here.

  A runtime module that carries the strings it forbids is a module every sweep over it matches,
  and nothing at run time needs to know what the old name was -- only the guard does.
*/

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
  /*
    Which column of the Resources menu panel this entry appears in, or none.

    The 2026-09-11 IA redesign's Resources panel is a short list -- learn and do on the left,
    verify and compare on the right -- while the hub keeps all nine entries. That is one list with
    a column marker on five of them, not a second list: a tenth resource arrives with `column`
    undefined and reaches the hub without silently appearing in the menu, and a resource promoted
    into the menu cannot drift out of agreement with the hub's own label for it.

    `/docs`, `/api`, `/evidence` and `/reproducibility` are deliberately unmarked. The first two
    are the Developers panel's job now, `/evidence` is reached from `/trust` and from the research
    it supports, and doc 5.4 says `/reproducibility` is not the first thing to put in front of a
    general reader.
  */
  column?: "learn" | "verify";
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
  /*
    BA-039: the label "Solutions" now goes to the section, not to one of its five detail pages.

    The hub was built on a sibling branch, so both the bar and the footer pointed "Solutions" at
    `/solutions/ai-ready-knowledge` -- one workflow wearing the whole section's name, while the
    hub itself was reachable from nothing. Stage-B integration landed the route and put it in
    `app/sitemap.ts`; this is the other half, and `lib/site-nav-model.test.ts` pins it.
  */
  { href: "/solutions", label: "Solutions" },
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
    column: "learn",
  },
  {
    href: "/demo",
    label: "Signed product path",
    purposes: ["evaluate", "verify"],
    workflows: ["compile-and-review", "use-elsewhere", "handle-a-revision"],
    column: "learn",
  },
  { href: "/knowledge-compiler", label: "Knowledge Compiler guide", purposes: ["learn"], workflows: [], column: "learn" },
  {
    href: "/docs",
    label: "Documentation",
    purposes: ["build"],
    workflows: ["compile-and-review", "use-elsewhere", "handle-a-revision"],
  },
  { href: "/api", label: "API", purposes: ["build"], workflows: ["use-elsewhere"] },
  { href: "/changelog", label: "Changelog", purposes: ["build"], workflows: [], column: "verify" },
  /*
    BQ-112 / D11: `/arena` is not listed here. The route still answers -- an existing link does
    not 404 -- but it publishes no comparison yet, carries `robots: { index: false }` and is out
    of `app/sitemap.ts`. A hub entry and a menu column are offers to read something, and the
    protocol a reader was being sent there for is `/benchmarks`, two lines below.
  */
  { href: "/research", label: "Research", purposes: ["learn"], workflows: [], column: "verify" },
  { href: "/benchmarks", label: "Benchmark protocol", purposes: ["verify"], workflows: [], column: "verify" },
  {
    /*
      BA-252: "Evidence", the one name. The page carried three -- "Technical evidence" here, its
      own h1, and "Evidence" in prose -- and a reader cannot tell whether those are one page or
      three. "Technical" also narrowed it to the audience least in need of the label.
    */
    href: "/evidence",
    label: "Evidence",
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
      // BA-039: the section, not one of its five pages. Same change as `PRIMARY_NAV` above.
      { href: "/solutions", label: "Solutions" },
      { href: "/integrations", label: "Integrations" },
      /*
        Added when the bar stopped carrying a flat "Sources" link (IA redesign, 2026-09-11).

        The founder resolution the direct link came from (RESOLVED A-3/B-5) is that what a
        deployment can read is a product surface rather than a resources entry. The redesign moves
        where it is listed, not what it is: it is a Product panel item now, and this row is the
        second way to it that does not require opening a menu at all.
      */
      { href: "/sources", label: "Supported files" },
      /*
        BQ-052. Three advertised routes the footer could not reach.

        `/enterprise`, `/resources` and `/knowledge-compiler` are in the sitemap, are linked from
        inside other pages and are what a reader who arrived on a docs page is looking for -- and
        the only way to any of them was a link in running text on a page they might never open.
      */
      { href: "/knowledge-compiler", label: "Knowledge Compiler" },
      { href: "/enterprise", label: "Enterprise" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Research",
    links: [
      /*
        D11. `/arena` is out of the footer until it has content. The route still answers -- it
        says the work is not published yet and carries `robots: noindex` -- but a standing link
        to a page with nothing on it is the site advertising a result it has not produced.
      */
      { href: "/benchmarks", label: "Methodology" },
      { href: "/research", label: "Research" },
      { href: "/evidence", label: "Evidence" },
      { href: "/resources", label: "Resources" },
    ],
  },
  {
    title: "Developers",
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

/* ================================================================== BA-250: the footer's last row

  Four link columns and a tagline was the whole footer. A security or procurement reviewer looks
  at the bottom of a page for the copyright, the language entry and the security address, and
  finding none of the three is what reads as unfinished -- so the row exists and carries exactly
  what is true.

  What it does **not** carry is the legal entity and the governing jurisdiction. Those are
  published, from the environment, by `components/legal-operator-disclosure.tsx` on the policy
  pages, and the contract's §2 decision on BA-250 is that the footer renders nothing until the
  founder confirms the contracting party. A footer line naming a party the running deployment
  cannot read would be exactly the invention that is barred; the slot is here and empty, named so
  that the lane which owns the operator record can fill it in one place.

  `security@tavonel.com` is the address already published on /contact, /privacy, /status and
  /trust. It is not a new commitment; it is the same inbox, reachable from every page.
*/
export const FOOTER_LEGAL_ROW = {
  /** The brand, which is what this site is published as. No entity, no jurisdiction -- see above. */
  copyright: "© 2026 TAVONEL",
  /*
    The §12.4 Korean entry, in Korean, because that is who it is for -- and its return trip.

    chrome-06: this was one static entry rendered on every route, so on /ko itself the control
    read "한국어" and pointed at /ko. A switch whose only job is to change language was a self-link
    on the one page where it matters. The pair is reciprocal now and the footer picks the side the
    page is not on.
  */
  language: { href: "/ko", label: "한국어" },
  languageBack: { href: "/", label: "English" },
  security: "security@tavonel.com",
} as const;

/* ==================================================== the global menu (IA redesign, 2026-09-11)

  Five things in the bar, four of which open a panel.

  The bar was eight flat links at one level -- Product, Solutions, Integrations, Developers,
  Security, Pricing, Sources, Resources -- which asked a first-time reader to already know that
  "Sources" means supported file formats and that "Integrations" is where a connector lives. The
  redesign groups them by the question a reader arrives with and keeps every URL exactly where it
  is: a menu position is not a URL, so nothing here is renamed, moved or redirected.

  `PRIMARY_NAV` above is untouched on purpose. It is no longer the rendered bar, but it is still
  the flat inventory `e2e/overflow-audit.spec.ts` walks and an export several call sites read by
  name, and retiring it in the same change that introduces the panels would leave two failures to
  tell apart if the header row regresses.

  What is in a panel is decided by `NAV_GROUPS` and nothing else. Both chromes render this one
  structure -- the desktop disclosure row and the phone accordion -- so the four-chrome drift
  this file's own top comment describes cannot come back through a second menu list.
*/

export type NavPanelItem = SiteLink & { description?: string };
export type NavPanelColumn = { title: string; items: readonly NavPanelItem[] };
export type NavSection = "product" | "solutions" | "developers" | "resources" | "pricing";

export type NavGroup = {
  /** Panel id, `aria-current` key and accordion key. Never a URL. */
  section: Exclude<NavSection, "pricing">;
  label: string;
  /**
   * The group's hub, which is always one of this panel's own links.
   *
   * Kept as an href rather than a second rendered row so that no panel lists the same page
   * twice: Product's hub is the first item of its first column, and the other three groups' hubs
   * are their `featured` link.
   */
  overviewHref: string;
  columns: readonly NavPanelColumn[];
  /** The link the panel ends on, set apart from the columns. Carries the hub where no column does. */
  featured?: NavPanelItem;
};

/**
 * The Resources panel, read off `RESOURCE_LINKS` rather than written again.
 *
 * Order follows the declaration order of that array and not the order the design document's
 * mockup drew them, because reordering `RESOURCE_LINKS` would reorder the hub's own tiles -- a
 * page another lane owns -- to settle a question the mockup does not depend on.
 */
const resourceColumn = (column: "learn" | "verify"): readonly NavPanelItem[] =>
  RESOURCE_LINKS.filter((link) => link.column === column).map(({ href, label }) => ({ href, label }));

/*
  Labels and audiences are the ones `app/solutions/[slug]/page.tsx` already publishes.

  `lib/site-nav-model.test.ts` reads that file and fails if a label here stops matching the
  eyebrow it came from or an audience stops matching the "For:" line the page renders, which is
  what keeps the menu from inventing a positioning the page does not make.
*/
const SOLUTION_ITEMS: readonly NavPanelItem[] = [
  { href: "/solutions/ai-ready-knowledge", label: "AI-ready knowledge", description: "AI and platform engineers" },
  {
    href: "/solutions/source-grounded-assistants",
    label: "Grounded assistants",
    description: "Application and agent developers",
  },
  { href: "/solutions/knowledge-graph", label: "Knowledge graph", description: "Data and knowledge architects" },
  {
    href: "/solutions/knowledge-operations",
    label: "Knowledge operations",
    description: "Knowledge owners and security reviewers",
  },
  {
    href: "/solutions/document-intelligence",
    label: "Document intelligence",
    description: "Document and operations teams",
  },
] as const;

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    section: "product",
    label: "Product",
    overviewHref: "/product",
    columns: [
      {
        title: "Understand the product",
        items: [
          { href: "/product", label: "Product overview" },
          { href: "/product/document-understanding", label: "Document understanding" },
          { href: "/product/compiled-world", label: "Compiled World" },
        ],
      },
      {
        /*
          Security is not a bar item, and this is where a reader finds it instead.

          `/trust` is the summary hub that indexes `/security`, `/status`, `/subprocessors` and
          `/privacy`; it is one link from the bar here and it is in the footer's Trust group. The
          two pages keep their separate jobs -- `/trust` summarises, `/security` is the detail --
          so neither is duplicated to give the menu a second entry.
        */
        /*
          BA-244: a purpose, not a comma-separated list of nouns. BA-248: the page is called
          Sources everywhere else on the site, so the menu calls it Sources and puts the five-word
          sentence in the description row the panel already renders. BA-252: "Trust Center" is one
          spelling, and it is the footer's too -- a procurement reader who finds it in one place
          and not the other has found half a Trust Center.

          `/trust` stays in this column rather than moving under Resources: the column is named for
          it, and Resources is the reading material rather than the commitments.
        */
        title: "Sources, connections and trust",
        items: [
          { href: "/sources", label: "Sources", description: "What TAVONEL reads, and what survives the read" },
          { href: "/integrations", label: "Connect sources" },
          { href: "/trust", label: "Trust Center" },
        ],
      },
    ],
    /*
      BA-232 / BA-244: one name for `/explore`, and the panel's last row says what is behind it.

      The counts are the corpus `/explore` actually publishes, not a marketing figure --
      `lib/site-nav-model.test.ts` recomputes both from `lib/explore-sample.ts` and fails if
      either moves. The panel is not the place for a picture: there is no product capture in
      `public/` to crop, and an invented one is what the brief bars.
    */
    featured: {
      ...EXPLORE_CTA,
      description: "Apple SEC corpus · 5 filings · 1,281 regions",
    },
  },
  {
    section: "solutions",
    label: "Solutions",
    overviewHref: "/solutions",
    columns: [{ title: "By workflow", items: SOLUTION_ITEMS }],
    featured: { href: "/solutions", label: "All solutions" },
  },
  {
    section: "developers",
    label: "Developers",
    overviewHref: "/docs",
    columns: [
      {
        title: "Get connected",
        items: [
          { href: "/developers", label: "Developer guide" },
          { href: "/docs/quickstart", label: "Quickstart" },
          { href: "/docs/use-with-ai", label: "Use results with AI" },
        ],
      },
      {
        title: "Interfaces and tools",
        items: [
          { href: "/api", label: "API reference" },
          { href: "/docs/mcp", label: "MCP" },
          { href: "/docs/cli", label: "CLI and package verification" },
        ],
      },
    ],
    featured: { href: "/docs", label: "All documentation" },
  },
  {
    section: "resources",
    label: "Resources",
    overviewHref: "/resources",
    columns: [
      // An approved execution guide belongs in this column. `/cookbooks` is a draft route in
      // another lane and a draft is not advertised, so nothing links to it from here yet.
      { title: "Learn and do", items: resourceColumn("learn") },
      { title: "Verify and compare", items: resourceColumn("verify") },
    ],
    featured: { href: "/resources", label: "All resources" },
  },
] as const;

/** Pricing answers its question on the page itself, so it opens nothing. */
export const NAV_PRICING: SiteLink = { href: "/pricing", label: "Pricing" };

/**
 * Declared in the menu before the route exists. Empty, and meant to stay empty.
 *
 * It held `/solutions` while the `ia-hubs` lane was building the hub on a sibling branch. Both
 * branches are merged, the page answers and it is in `app/sitemap.ts`, so the exception is spent
 * and the list is `[]`. The constant stays because it is the only place such an exception may
 * live: `lib/site-nav-model.test.ts` pins it empty, and an entry added for a page that already
 * exists fails there rather than hiding a stale excuse for a link that works.
 */
export const NAV_PENDING_HREFS: readonly string[] = [] as const;

/*
  Which bar item owns the page being read.

  Exact before prefix, because `/api` is one page and `/docs` is twenty. A path this does not
  recognise returns null and no trigger is marked: the bar says nothing rather than guessing,
  which is the honest answer for `/contact`, `/login` and every workspace route.
*/
const SECTION_BY_PATH: Readonly<Record<string, NavSection>> = {
  "/sources": "product",
  "/integrations": "product",
  "/trust": "product",
  "/security": "product",
  "/developers": "developers",
  "/api": "developers",
  "/resources": "resources",
  "/explore": "resources",
  "/knowledge-compiler": "resources",
  "/benchmarks": "resources",
  "/changelog": "resources",
  "/evidence": "resources",
  "/reproducibility": "resources",
  "/pricing": "pricing",
};

const SECTION_BY_PREFIX: readonly (readonly [string, NavSection])[] = [
  ["/product", "product"],
  ["/solutions", "solutions"],
  ["/docs", "developers"],
  ["/research", "resources"],
] as const;

export function navSectionForPath(pathname: string): NavSection | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const exact = SECTION_BY_PATH[path];
  if (exact) return exact;
  for (const [prefix, section] of SECTION_BY_PREFIX) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return section;
  }
  return null;
}

/** Every destination the menu offers, so a route sweep does not need updating by hand. */
export const navHrefs = (): readonly string[] => [
  ...new Set([
    ...NAV_GROUPS.flatMap((group) => [
      ...group.columns.flatMap((column) => column.items.map((item) => item.href)),
      ...(group.featured ? [group.featured.href] : []),
    ]),
    NAV_PRICING.href,
  ]),
];
