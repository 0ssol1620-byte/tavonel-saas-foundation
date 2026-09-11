/**
 * The fixture workspace session the audit specs share.
 *
 * Lifted verbatim from the pattern in `workspace-first-use.spec.ts` and
 * `connection-sync-status.spec.ts` -- an unsigned local JWT in the Supabase storage key plus the
 * four API routes every workspace surface loads on mount. It is a labelled fixture: no provider
 * account, no production auth, no customer document. Extracted rather than copied a fifth time,
 * and deliberately left as a plain module so the existing specs keep their own copies until
 * someone has a reason to touch them.
 */

import type { Page } from "@playwright/test";

export const FIXTURE_USER_ID = "44444444-4444-4444-4444-444444444444";
export const FIXTURE_COLLECTION_ID = `collection-${"a".repeat(32)}`;

export function fixtureToken(userId = FIXTURE_USER_ID): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return [
    encode({ alg: "none", typ: "JWT" }),
    encode({ sub: userId, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }),
    "signature",
  ].join(".");
}

export async function installFixtureSession(page: Page, userId = FIXTURE_USER_ID): Promise<void> {
  await page.addInitScript(
    ({ accessToken, id }) => {
      const now = Math.floor(Date.now() / 1000);
      localStorage.setItem("sb-test-auth-token", JSON.stringify({
        access_token: accessToken,
        token_type: "bearer",
        expires_in: 3600,
        expires_at: now + 3600,
        refresh_token: "e2e-refresh-token",
        user: {
          id,
          aud: "authenticated",
          role: "authenticated",
          email: "audit-e2e@example.invalid",
          app_metadata: {},
          user_metadata: {},
          created_at: new Date().toISOString(),
        },
      }));
    },
    { accessToken: fixtureToken(userId), id: userId },
  );
}

export type BillingAccountFixture = {
  accessPlan: string | null;
  subscriptionStatus: string | null;
  creditBalance: number;
  lifetimeCreditsPurchased: number;
  lifetimeCreditsReversed: number;
  billingHold: boolean;
  paddleCustomerId: string | null;
  subscriptionCancelAt: string | null;
  updatedAt: string | null;
};

export const INACTIVE_BILLING: BillingAccountFixture = {
  accessPlan: null,
  subscriptionStatus: "inactive",
  creditBalance: 0,
  lifetimeCreditsPurchased: 0,
  lifetimeCreditsReversed: 0,
  billingHold: false,
  paddleCustomerId: null,
  subscriptionCancelAt: null,
  updatedAt: null,
};

/** A ready, readable source. `documentId` is the only field callers usually change. */
export function fixtureDocument(documentId = "audit-source-a", seed = "a") {
  const versionKey = seed.repeat(64);
  return {
    documentId,
    versionKey,
    sanitizedKey: `immutable/ws/${documentId}/${versionKey}/sanitized.pdf`,
    sanitizedSize: 1_000,
    ocrJsonKey: `immutable/ws/${documentId}/${versionKey}/ocr.json`,
    ocrJsonSize: 500,
    hasOcrJson: true,
    cdrReceiptKey: `immutable/ws/${documentId}/${versionKey}/cdr-receipt.json`,
    ocrReviewKey: null,
    processingState: "ocr_ready",
  };
}

export type WorkspaceRouteOptions = {
  documents?: unknown[];
  billing?: BillingAccountFixture | null;
  jobs?: unknown[];
  accessSource?: "owner" | "paid" | "trial";
};

/** The routes a workspace surface reads on mount. Anything a spec cares about it re-routes after. */
export async function installWorkspaceRoutes(page: Page, options: WorkspaceRouteOptions = {}): Promise<void> {
  const { documents = [], billing = INACTIVE_BILLING, jobs = [], accessSource = "owner" } = options;
  await page.route("**/api/access/bootstrap", route => route.fulfill({
    json: {
      code: "ACCESS_READY",
      access: {
        source: accessSource,
        accessPlan: accessSource === "trial" ? "observer_access" : "studio_access",
        billingExempt: accessSource === "owner",
        expiresAt: accessSource === "trial" ? new Date(Date.now() + 7 * 86_400_000).toISOString() : null,
        limits: accessSource === "trial" ? { files: 3, pages: 80, worlds: 1 } : null,
      },
    },
  }));
  await page.route("**/api/documents", route => route.fulfill({ json: { documents } }));
  await page.route("**/api/compile-jobs", route => route.fulfill({ json: { code: "OK", jobs } }));
  await page.route("**/api/connections", route => route.fulfill({ json: { connections: [] } }));
  await page.route("**/api/billing/status", route => route.fulfill(
    billing ? { json: { code: "OK", account: billing } } : { status: 503, json: { code: "BILLING_READ_FAILED" } },
  ));
}

/**
 * A compile-job event stream body.
 *
 * `lib/compile-job-client.ts` parses SSE by hand (it needs an Authorization header, which
 * `EventSource` cannot send), so a mocked stream has to be well formed: `id`, `event`, one
 * `data` line, blank line between frames. The observer stops at a resting state -- ready,
 * failed, cancelled, review_required -- so a stream that ends in one does not reconnect.
 */
export function sseFrames(frames: Record<string, unknown>[]): string {
  return frames
    .map(frame => `id: ${frame.sequence}\nevent: ${frame.eventType ?? "state_changed"}\ndata: ${JSON.stringify(frame)}\n\n`)
    .join("");
}
