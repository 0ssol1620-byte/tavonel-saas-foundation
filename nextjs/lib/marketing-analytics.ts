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
  // The §12.4 Korean entry page (seo-i18n CROSS-LANE 2). It is indexable, in the sitemap and in
  // llms.txt, so a Korean visitor arrives on a public marketing page -- and was measured nowhere,
  // because this set is what gates where consented analytics loads. Consent is unchanged: the
  // path being listed is what makes a consented page view possible, never what makes it exempt.
  "/ko",
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
