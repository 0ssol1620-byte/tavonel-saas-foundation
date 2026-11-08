// Workspace fixture session + routes for the stage-1 recording. Document names are the public SEC sample filings.
// The access record is a paying customer's (source "paid", the same shape e2e/fixtures/workspace-fixture.ts serves for
// accessSource "paid"): the shell draws no access strip for it. Never the billing-exempt owner -- that strip
// ("OWNER · Full workspace access · not billed") is internal state a customer never sees (review R1 MAJOR-2).
const fixtureUser = "44444444-4444-4444-4444-444444444444";
const enc = v => Buffer.from(JSON.stringify(v)).toString("base64url");
const token = [enc({ alg: "none", typ: "JWT" }), enc({ sub: fixtureUser, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 36000 }), "signature"].join(".");
export const ACCESS = { source: "paid", accessPlan: "studio_access", billingExempt: false, expiresAt: null, limits: null, customerDataEnabled: true };
export function doc(id, seed, st, name) {
  const v = seed.repeat(64);
  return { documentId: id, displayName: name, filename: name, versionKey: v, sanitizedKey: `immutable/ws/${id}/${v}/sanitized.pdf`, sanitizedSize: 1000,
    ocrJsonKey: `immutable/ws/${id}/${v}/ocr.json`, ocrJsonSize: 500, hasOcrJson: st === "ocr_ready", cdrReceiptKey: `immutable/ws/${id}/${v}/cdr-receipt.json`, ocrReviewKey: null, processingState: st };
}
export async function session(page, { documents, names = {} }) {
  await page.addInitScript(({ accessToken, id, names }) => {
    localStorage.setItem("tavonel.document-names.v1", JSON.stringify(names));
    const now = Math.floor(Date.now() / 1000);
    localStorage.setItem("sb-test-auth-token", JSON.stringify({ access_token: accessToken, token_type: "bearer", expires_in: 36000, expires_at: now + 36000, refresh_token: "r", user: { id, aud: "authenticated", role: "authenticated", email: "audit-e2e@example.invalid", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
    localStorage.setItem("tavonel.analytics-consent.v1", JSON.stringify({ allowed: false, expires: Date.now() + 86400000 }));
  }, { accessToken: token, id: fixtureUser, names });
  await page.route("https://test.supabase.co/**", r => r.fulfill({ json: { id: fixtureUser, aud: "authenticated", role: "authenticated", email: "audit-e2e@example.invalid", app_metadata: {}, user_metadata: {} } }));
  await page.route("**/api/access/bootstrap", r => r.fulfill({ json: { code: "ACCESS_READY", access: ACCESS } }));
  await page.route("**/api/documents", r => r.fulfill({ json: { documents: typeof documents === "function" ? documents() : documents } }));
  await page.route("**/api/connections", r => r.fulfill({ json: { connections: [] } }));
  await page.route("**/api/v1/reviews**", r => r.fulfill({ json: { code: "OK", decisions: [] } }));
  // The billing read the workspace makes on mount; nothing on the recorded surface draws it, so it carries no figures.
  await page.route("**/api/billing/status", r => r.fulfill({ json: { code: "OK", account: { accessPlan: null, subscriptionStatus: "inactive", creditBalance: 0, lifetimeCreditsPurchased: 0, lifetimeCreditsReversed: 0, billingHold: false, paddleCustomerId: null, subscriptionCancelAt: null, updatedAt: null } } }));
}
export async function cookies(ctx, base) {
  await ctx.addCookies([{ name: "tavonel.specimen-fixture", value: "committed", url: base }, { name: "tavonel_analytics_consent", value: "denied", url: base }]);
}
