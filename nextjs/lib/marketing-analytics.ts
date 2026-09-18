/** Public marketing measurement only. Never send a caller-provided URL or event payload. */
export const GA_ID = "G-XQ6Z2RJME7";
export const CONSENT_KEY = "tavonel.analytics-consent.v1";
export const PUBLIC_MARKETING_PATHS = new Set([
  "/", "/api", "/arena", "/benchmarks", "/changelog", "/contact", "/developers", "/docs", "/enterprise",
  "/evidence", "/explore", "/integrations", "/knowledge-compiler", "/pricing", "/privacy",
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
]);

export function publicPageLocation(path: string): string | null {
  return PUBLIC_MARKETING_PATHS.has(path) ? `https://tavonel.com${path}` : null;
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
*/
const CONSENT_COPY_EN: ConsentCopy = {
  region: "Optional analytics",
  prompt: "Google Analytics cookies measure visits to public pages and the interactions on them. Workspace content is never included.",
  privacy: "Privacy notice",
  refuse: "No thanks",
  allow: "Allow analytics",
  settings: "Analytics preferences",
};

const CONSENT_COPY_KO: ConsentCopy = {
  region: "선택 분석",
  prompt: "Google Analytics 쿠키는 공개 페이지 방문과 그 페이지에서의 상호작용을 측정합니다. 워크스페이스 내용은 포함되지 않습니다.",
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

export function readConsent(storage: Pick<Storage, "getItem">, now = Date.now()): boolean | null {
  try {
    const value = JSON.parse(storage.getItem(CONSENT_KEY) ?? "null");
    if (typeof value?.allowed !== "boolean" || typeof value?.expires !== "number" || value.expires <= now) return null;
    return value.allowed;
  } catch { return null; }
}
