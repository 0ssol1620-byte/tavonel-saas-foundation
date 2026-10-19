/** Public marketing measurement only. Never send a caller-provided URL or event payload. */
export const GA_ID = "G-XQ6Z2RJME7";
export const CONSENT_KEY = "tavonel.analytics-consent.v1";
/*
  D11 keeps /arena in this set on purpose.

  The decision delists the route -- out of the footer, out of RESOURCE_LINKS, out of the sitemap,
  and `robots: noindex` on the page -- and it does not delete it: the URL still resolves and says
  the page is not published yet. Somebody holding an older link still lands there, and a landing
  nobody can see is how a delisted page stays delisted by accident after it ships. Being listed
  here is what makes a *consented* page view possible; it exempts nothing.
*/
export const PUBLIC_MARKETING_PATHS = new Set([
  "/", "/api", "/arena", "/benchmarks", "/benchmarks/gdp-pdf", "/changelog", "/contact", "/demo", "/developers", "/docs", "/enterprise",
  "/evidence", "/explore", "/integrations", "/knowledge-compiler", "/how-it-works", "/pricing", "/privacy",
  "/product", "/product/compiled-world", "/product/continuous-knowledge", "/product/document-understanding",
  "/refunds", "/research", "/research/notes", "/resources", "/security", "/sources", "/status",
  "/subprocessors", "/terms", "/solutions/ai-ready-knowledge", "/solutions/document-intelligence",
  "/solutions/knowledge-graph", "/solutions/source-grounded-assistants", "/solutions/knowledge-operations",
  "/docs/quickstart", "/docs/use-with-ai", "/docs/ontology-output", "/docs/concepts", "/docs/authentication",
  "/docs/files-and-formats", "/docs/upload", "/docs/collections-and-compile", "/docs/run-events", "/docs/review",
  "/docs/world-api", "/docs/search", "/docs/ask", "/docs/connections", "/docs/exports", "/docs/mcp", "/docs/cli",
  "/docs/billing-and-limits", "/docs/errors", "/docs/security", "/docs/changelog",
  // The ia-hubs docs section, missed the same way and found by the same guard.
  "/docs/integration-recipes",
  // The §12.4 Korean entry page (seo-i18n CROSS-LANE 2). It is indexable, in the sitemap and in
  // llms.txt, so a Korean visitor arrives on a public marketing page -- and was measured nowhere,
  // because this set is what gates where consented analytics loads. Consent is unchanged: the
  // path being listed is what makes a consented page view possible, never what makes it exempt.
  "/ko",
  "/ko/contact", "/ko/pricing",
  // EN-1: the product guide, both languages; both are in the sitemap.
  "/guide", "/ko/guide",
  "/evaluation", "/ko/evaluation",
  /*
    The two pages the 2026-09-11 campaign published, found at integration by the guard in
    `lib/seo-surface.test.ts` rather than by a reader: `/solutions` is the new hub (all five
    `/solutions/*` detail pages were already here) and `/trust` is the index the /pricing
    Enterprise card sends a procurement reader to. Both are indexable and in the sitemap, so a
    visitor arrives on a public marketing page that was measured nowhere -- the same gap /ko had.
    Consent is unchanged: being listed is what makes a consented page view possible, never what
    makes one exempt.
  */
  "/solutions",
  "/trust",
  // EN-0: the cookbooks index is in the sitemap and on /resources, so it is measured; its six
  // draft records are not, for the reason below.
  "/cookbooks",
  /*
    BA-211's other half, decided rather than left open: the six `/cookbooks/*` drafts are **not**
    here, and that is the answer, not an omission.

    The audit's rule is the right one -- a page public enough to link is public enough to measure
    and to ask about. These are not linked. Every record in `lib/cookbook-content.ts` is
    `publication: "draft"`, which means `robots: { index: false }`, absent from `app/sitemap.ts`,
    and advertised by no menu (`lib/site-nav-model.test.ts` fails if one appears in the nav). A
    page a reader can only reach by knowing its URL is not a marketing surface, and measuring it
    would mean asking a privacy question in order to count visits nobody was invited to make.

    The promotion is where this becomes wrong, so that is what is guarded:
    `lib/marketing-analytics.test.ts` fails if a cookbook is `approved` and missing from this set.
  */
]);
export const MARKETING_EVENTS = new Set([
  "generate_lead",
  "hero_explore_clicked", "hero_start_clicked", "pricing_plan_viewed", "pricing_start_clicked",
  "source_category_viewed", "developer_mcp_started", "developer_api_started", "explore_entered",
  "explore_evidence_opened", "explore_change_opened", "explore_to_signup",
  /*
    D7's Landing V2 names. Every one of them is a click or a dwell on a public marketing page,
    which is exactly what the consent prompt says is measured -- visits and clicks on public
    pages -- so all fifteen are forwarded and none is an exception.

    They are forwardable because of what their details cannot hold, not because of where they
    fire: `proof_claim_switch` carries a tab position, `source_open` carries which scene the
    reader opened a source from, and the rest carry nothing but the D8 arm. No question, no
    filename, no region id and no excerpt reaches this module, and `FUNNEL_DETAIL_KEYS` is what
    makes that structural rather than editorial.

    `request_access_complete` fires beside `generate_lead` on the contact form and is listed for
    the same reason that one is: the enquiry was sent, and nothing about the enquiry travels
    with the name.
  */
  "hero_primary_click", "hero_secondary_click", "hero_demo_interact", "proof_claim_switch",
  "source_open", "world_explore_60s", "integration_open", "trust_open", "pricing_open",
  "request_access_start", "request_access_complete",
  "scroll_scene_25", "scroll_scene_50", "scroll_scene_75", "scroll_scene_100",
]);

export function publicPageLocation(path: string): string | null {
  return PUBLIC_MARKETING_PATHS.has(path) ? `https://tavonel.com${path}` : null;
}

/*
  UX08: the one decision the consented relay makes about a `tavonel:funnel` event, as a function.

  It used to be three inline checks in `MarketingConsent`'s listener, which nothing outside a
  browser could exercise. What it returns is built here from constants and the current pathname --
  the event name only once it has matched `MARKETING_EVENTS`, and the canonical location of a
  listed public path -- and nothing is copied from the incoming detail. A key a future caller adds
  to that detail therefore has no path to the vendor, whatever it is named.

  The pathname is the page the reader is on when the event fires, not one captured earlier, and it
  is a pathname: a query or a fragment is not a listed path, so it is refused rather than trimmed.
  This is only the Google relay. The cookieless collector `trackFunnel` also posts to is a
  separate, explicitly flagged choice in the root layout and is not gated here.
*/
export type MarketingEventPayload = {
  readonly name: string;
  readonly params: { readonly page_location: string; readonly page_title: "TAVONEL" };
};

export function marketingEventPayload(consent: boolean | null, pathname: string, detail: unknown): MarketingEventPayload | null {
  if (consent !== true) return null;
  const location = publicPageLocation(pathname);
  if (!location) return null;
  let name: unknown;
  try {
    name = typeof detail === "object" && detail !== null ? (detail as { event?: unknown }).event : undefined;
  } catch { return null; }
  if (typeof name !== "string" || !MARKETING_EVENTS.has(name)) return null;
  return { name, params: { page_location: location, page_title: "TAVONEL" } };
}

/*
  The consent banner's own words, in the language of the page it appears on.

  Stage-A integration made `/ko` a measured public page, which is also what made it show this
  banner -- in English, on the one page whose whole purpose is to be read in Korean, asking for
  a privacy choice. A consent prompt a reader cannot read is not consent.

  What is translated is this banner's own four sentences and nothing else. No claim moves: the
  two choices are the same two choices, the storage key, the 180-day expiry, the cookie clearing
  and the vendor gate are all outside this function, and `/privacy` stays the English notice the
  Korean entry page already says is the single source. The selector is the pathname prefix rather
  than a header or a cookie, because the site has exactly one Korean subtree and no geo redirect.
*/
export type ConsentCopy = {
  readonly region: string;
  readonly prompt: string;
  readonly privacy: string;
  readonly refuse: string;
  readonly allow: string;
  readonly settings: string;
};

/*
  BA-256: the prompt states what happens. It does not ask a favour.

  "Help us improve TAVONEL?" put the reader in the position of doing the company a kindness, which
  is the one register a consent prompt may not use -- the choice has to be free, and a request is
  pressure however politely it is phrased. The two buttons, the storage, the 180-day expiry and
  the vendor gate are all unchanged; only these words are.

  Two departures from the audit's own sentence, both because a consent prompt that names less than
  it takes is worse than one with the wrong tone. It stopped at "visits to public pages", so
  "and the interactions on them" is kept: `MARKETING_EVENTS` above is a list of click events. And
  it dropped the vendor's name, which `lib/marketing-analytics.test.ts` pins in both languages --
  the reader is being asked about a third party and gets to know which one.

  G1-024 shortened it, and the four facts it may not drop are the four the test pins: the vendor's
  name, that these are cookies, what is measured, and what is excluded. "visits to public pages
  and the interactions on them" became "visits and clicks on public pages" -- the same two things
  `MARKETING_EVENTS` records, in six fewer words. Nothing was dropped to make it fit; the phrasing
  was.

  The length is a layout constraint and it is worth writing down rather than leaving as a mystery
  for the next editor: below 900px the card is two rows, the sentence with its Privacy link
  (12px/1.3) above two equal 44px buttons, and it may not grow past 96px tall at 360px wide.
  Release 2 (2026-10-15) folded "Workspace content is never included." into ", never workspace
  content." because the old sentence measured 110.8px at 360 and the new one 95.2px. A sentence
  added here comes out of nothing else -- it comes out of the card's height.
*/
const CONSENT_COPY_EN: ConsentCopy = {
  region: "Optional analytics",
  prompt: "Google Analytics cookies measure visits and clicks on public pages, never workspace content.",
  privacy: "Privacy notice",
  refuse: "No thanks",
  allow: "Allow analytics",
  settings: "Analytics preferences",
};

const CONSENT_COPY_KO: ConsentCopy = {
  region: "선택 분석",
  prompt: "Google Analytics 쿠키는 공개 페이지의 방문과 클릭을 측정하며, 워크스페이스 내용은 제외합니다.",
  privacy: "개인정보 처리방침",
  refuse: "허용하지 않음",
  allow: "분석 허용",
  settings: "분석 설정",
};

/** The banner's copy for one pathname. Korean on the `/ko` subtree, English everywhere else. */
export function consentCopy(path: string): ConsentCopy {
  return path === "/ko" || path.startsWith("/ko/") ? CONSENT_COPY_KO : CONSENT_COPY_EN;
}

/* ============================================================= BA-245: who owns the top layer

  The phone menu and the consent banner were both fixed to the viewport and neither knew about the
  other, so at 390 an open menu had the banner drawn across it: three layers stacked -- the
  drawer, the live page still visible under it, and the banner over both. A navigation that covers
  the page is modal while it is open, and nothing may sit on top of it.

  The banner is suppressed rather than re-stacked. Raising its z-index over the sheet would leave
  it covering the menu's own bottom row; a reader who opened the menu asked for the menu, and the
  choice they have not made yet is still there when they close it.

  `MobilePrimaryNav` announces the sheet's state on this event and `MarketingConsent` listens. It
  is a window event and not a shared store because these two components have no common ancestor
  below the root layout, and it is a constant here because two files spelling the same event name
  is exactly how that connection breaks silently.
*/
export const NAV_OPEN_EVENT = "tavonel:nav";

/*
  G1-033: the reopen control moved into the footer, and this is how it reaches the banner.

  The footer is rendered by `components/public-site-chrome.tsx` and the banner is mounted once in
  the root layout, so the two have no common ancestor below it -- the same situation as
  `NAV_OPEN_EVENT` above, solved the same way and for the same reason. A constant, rather than two
  files spelling one string.

  `CONSENT_ANCHOR_ATTRIBUTE` is the other direction. The banner looks for a footer link before it
  decides whether to draw its own floating fallback, so a page that renders no site footer still
  has a withdrawal path, and a page that renders one never shows two controls for one choice.
*/
export const CONSENT_EDIT_EVENT = "tavonel:consent-edit";
export const CONSENT_ANCHOR_ATTRIBUTE = "data-consent-anchor";

/** What the consent surface shows: nothing at all, the prompt, or the reopen control. */
export type ConsentSurface = "nothing" | "prompt" | "settings";

/**
 * The consent surface for one page state, as a decision rather than three JSX conditions.
 *
 * `measured` is `publicPageLocation() !== null` -- a page that is not measured never asks, which
 * is why the workspace has no banner. `ready` is false until local storage has been read, because
 * asking a reader who already answered is the one failure this component must not have.
 */
export function consentSurface(state: {
  measured: boolean;
  ready: boolean;
  consent: boolean | null;
  editing: boolean;
  navOpen: boolean;
}): ConsentSurface {
  if (!state.ready || !state.measured || state.navOpen) return "nothing";
  return state.consent !== null && !state.editing ? "settings" : "prompt";
}

export function referralOrigin(referrer: string): string {
  try {
    const url = new URL(referrer);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : "";
  } catch { return ""; }
}

/*
  `expires` has to be a finite number. `JSON.parse` reads `1e309` as `Infinity`, which is a number
  and is never `<= now`, so a stored `{"allowed":true,"expires":1e309}` used to be a grant with no
  end. A choice this component writes always carries a finite date, so only such a value is
  refused; the 180-day expiry itself is unchanged.
*/
export function readConsent(storage: Pick<Storage, "getItem">, now = Date.now()): boolean | null {
  try {
    const value = JSON.parse(storage.getItem(CONSENT_KEY) ?? "null");
    if (typeof value?.allowed !== "boolean" || !Number.isFinite(value?.expires) || value.expires <= now) return null;
    return value.allowed;
  } catch { return null; }
}
