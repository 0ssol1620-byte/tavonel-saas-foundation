/** Public marketing measurement only. Never send a caller-provided URL or event payload. */
export const GA_ID = "G-XQ6Z2RJME7";
export const CONSENT_KEY = "tavonel.analytics-consent.v1";
export const PUBLIC_MARKETING_PATHS = new Set([
  "/", "/api", "/benchmarks", "/changelog", "/contact", "/developers", "/docs", "/enterprise",
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

const CONSENT_COPY_EN: ConsentCopy = {
  region: "Optional analytics",
  prompt: "Help us improve TAVONEL? With your permission, Google Analytics measures visits and public-page interactions using cookies. Workspace content is excluded.",
  privacy: "Privacy notice",
  refuse: "No thanks",
  allow: "Allow analytics",
  settings: "Analytics preferences",
};

const CONSENT_COPY_KO: ConsentCopy = {
  region: "선택 분석",
  prompt: "TAVONEL 개선에 도움을 주시겠습니까? 허용하시면 Google Analytics가 쿠키를 사용해 방문과 공개 페이지에서의 상호작용을 측정합니다. 워크스페이스 내용은 측정하지 않습니다.",
  privacy: "개인정보 처리방침",
  refuse: "허용하지 않음",
  allow: "분석 허용",
  settings: "분석 설정",
};

/** The banner's copy for one pathname. Korean on the `/ko` subtree, English everywhere else. */
export function consentCopy(path: string): ConsentCopy {
  return path === "/ko" || path.startsWith("/ko/") ? CONSENT_COPY_KO : CONSENT_COPY_EN;
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
