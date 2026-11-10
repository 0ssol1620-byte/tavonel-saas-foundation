/**
 * Journey A7 / T1 (JOURNEY-MAP-2026-10-17 §8.1, lane P2-16) -- the self-serve journey, end to end
 * in a browser, against the production build, with nothing leaving the machine.
 *
 * Until this file no spec reached `/api/billing/checkout`, Paddle.js, the billing portal or a
 * successful switch-off upload (journey §5 D-12). Two postures are driven:
 *
 *   - today (S1, critic V20): account creation open, purchase and customer-file processing
 *     closed. Every purchase entry has to end at /contact (or the /evaluation contact form) or at
 *     a sentence a person can read -- never at a raw code, never at a Paddle script.
 *   - simulated switch-on: `purchasePlan`, `compileCustomerDocuments` and `createAccount` are
 *     flipped in this browser's copy of `/api/status/v2` and nowhere else. The server constant
 *     (`activationPolicy.customerData`) and every env switch stay as main ships them, so this
 *     file existing changes no production state (journey §10, A7).
 *
 * Every request bound off the machine is recorded and aborted by the fence in
 * `fixtures/paddle-fixture.ts`; each test ends by asserting the record is empty. The OAuth hop
 * is a stub at the non-existent e2e Supabase URL, Paddle is `installFakePaddle`, the object store
 * and the billing portal are fixture hosts. Nothing is charged and no account is created.
 *
 * The hold (journey A3, lane P2-29, register D-14) is driven in the switch-on posture: a resumed
 * checkout waits for the processing terms and the production release, and survives a reload. In
 * today's posture nothing is sold online, so the resumed request still goes out as on main and ends
 * in the server's refusal sentence.
 *
 * Not here, on purpose:
 *   - the login page's "Checkout opens by itself" sentence while purchase is closed (journey A2,
 *     V5) belongs to lane P2-10, which is not in this branch.
 *   - compile → review → activate → Ask → export are driven by world-lifecycle and compile-resume;
 *     this file stops at an accepted compile.
 */

import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { activationPolicy } from "../lib/activation-policy";
import { readCommercialState } from "../lib/commercial-state";
import { ENTITLEMENT_PENDING_SENTENCE, ENTITLEMENT_WAIT_DELAYS_MS, ENTITLEMENT_WAIT_WINDOW_MS, entitlementActiveSentence } from "../lib/entitlement-wait";
import { INTAKE_APPROVAL_ROLLOUT_ENABLED } from "../lib/intake-approval-rollout";
import { failureSentence } from "../lib/workspace-failure-copy";
import {
  FIXTURE_PORTAL_URL,
  FIXTURE_R2_ORIGIN,
  SANDBOX_CHECKOUT_READY,
  emitPaddleEvent,
  installFakePaddle,
  installNetworkFence,
  installPortalStub,
  paddleCalls,
  paddleClosed,
} from "./fixtures/paddle-fixture";
import {
  INACTIVE_BILLING,
  fixtureDocument,
  installFixtureSession,
  installWorkspaceRoutes,
  sseFrames,
  type BillingAccountFixture,
} from "./fixtures/workspace-fixture";

/** The fence is on for every test, and every test ends with it empty. */
const test = base.extend<{ fence: string[] }>({
  fence: [async ({ context, baseURL }, use) => {
    const records = await installNetworkFence(context, baseURL ?? "http://127.0.0.1");
    await use(records);
    expect(records, "requests that tried to leave the machine").toEqual([]);
  }, { auto: true }],
});

type Posture = "today" | "switch-on";

/*
  "today" is S1, what tavonel.com served on 2026-10-17 (journey-live-20261017/api-status-v2.json):
  createAccount on, purchasePlan and compileCustomerDocuments off. The two closed actions are
  passed through exactly as this server answered -- they follow `activationPolicy`, a constant --
  and only `createAccount` is pinned on, because it follows ACCESS_MODE, which production sets in
  vercel.json and a CI runner leaves unset.
*/
async function servePosture(page: Page, posture: Posture) {
  await page.route("**/api/status/v2", async (route) => {
    const response = await route.fetch();
    const body = await response.json() as { availableActions: Record<string, { enabled: boolean }> };
    const actions = body.availableActions;
    actions.createAccount.enabled = true;
    if (posture === "switch-on") {
      actions.purchasePlan.enabled = true;
      actions.compileCustomerDocuments.enabled = true;
    }
    await route.fulfill({ response, json: body });
  });
}

/** The consent sheet is not under test here; a declined record keeps it from covering a control. */
const declineAnalytics = (page: Page) => page.addInitScript(() => localStorage.setItem(
  "tavonel.analytics-consent.v1",
  JSON.stringify({ allowed: false, expires: Date.now() + 86_400_000 }),
));

/** The provider's authorize endpoint on the e2e Supabase URL, answered by a local page. */
async function stubProvider(page: Page) {
  const authorize: string[] = [];
  await page.route("https://test.supabase.co/auth/v1/authorize**", (route) => {
    authorize.push(route.request().url());
    return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>provider stub</title><main>provider stub: no real sign-in happens here</main>" });
  });
  return authorize;
}

type CheckoutReply = { status: number; json: unknown } | "abort";

/** Answers every checkout POST with `reply` and keeps each body, so a second POST shows up. */
async function answerCheckout(page: Page, reply: () => CheckoutReply) {
  const posts: unknown[] = [];
  await page.route("**/api/billing/checkout", (route) => {
    posts.push(route.request().postDataJSON());
    const answer = reply();
    return answer === "abort" ? route.abort("failed") : route.fulfill({ status: answer.status, json: answer.json });
  });
  return posts;
}

/** The published processing-terms offer, as `GET /api/access/processing-terms` serves it. */
const TERMS_OFFER = {
  version: "2026-09-30",
  terms: { path: "/policy/TAVONEL_SELF_SERVICE_TERMS_2026-09-30.md", sha256: `sha256:${"a".repeat(64)}` },
  processing: { path: "/policy/TAVONEL_PROCESSING_ADDENDUM_2026-09-30.md", sha256: `sha256:${"b".repeat(64)}` },
  scopes: ["direct_upload", "connector"],
};

/** Serves the terms offer and records each acceptance POST; `accepted` flips on the first one. */
async function installTermsRoutes(page: Page) {
  const state = { accepted: false, posts: 0 };
  await page.route("**/api/access/processing-terms", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: TERMS_OFFER });
    state.posts += 1;
    state.accepted = true;
    return route.fulfill({ status: 201, json: { code: "PROCESSING_TERMS_ACCEPTED", receipt: {
      acceptanceId: "5f2b8a4e-2c1d-4b7a-9e3f-0a1b2c3d4e5f", scope: "direct_upload", termsVersion: TERMS_OFFER.version,
      terms: TERMS_OFFER.terms, processing: TERMS_OFFER.processing, acceptedAt: "2026-11-10T10:00:00.000Z", idempotentReplay: false,
    } } });
  });
  return state;
}

/** A new account today: signed in, terms not yet accepted, no processing (journey H5-H6). */
const TODAY_NEW_ACCOUNT = {
  code: "ACCESS_READY_SOURCE_PENDING",
  sourcePending: "terms_acceptance_required",
  access: { source: "unentitled", accessPlan: null, billingExempt: false, expiresAt: null, limits: null, customerDataEnabled: false },
};

const bootstrapFor = (source: "trial" | "paid") => ({
  code: "ACCESS_READY",
  access: {
    source,
    accessPlan: "observer_access",
    billingExempt: false,
    expiresAt: source === "trial" ? new Date(Date.now() + 7 * 86_400_000).toISOString() : null,
    limits: source === "trial" ? { files: 3, pages: 80, worlds: 1 } : null,
    customerDataEnabled: true,
    // What app/api/access/bootstrap/route.ts sends with every open workspace; a held checkout reads it (P2-29).
    processingStage: "production",
  },
});

const ACTIVE_DEVELOPER: BillingAccountFixture = {
  ...INACTIVE_BILLING,
  accessPlan: "observer_access",
  subscriptionStatus: "active",
  creditBalance: 2_000,
  lifetimeCreditsPurchased: 2_000,
  paddleCustomerId: "ctm_fixture_journey",
  updatedAt: "2026-10-17T00:00:00Z",
};

const JOURNEY_EVENTS = ["login_reached_with_intent", "signed_in", "checkout_opened", "checkout_completed"];
async function journeyFunnel(page: Page) {
  const log = JSON.parse(await page.evaluate(() => sessionStorage.getItem("tavonel.funnel-log")) ?? "[]") as Array<Record<string, string>>;
  return log.filter((entry) => JOURNEY_EVENTS.includes(entry.event));
}

/** A notice region holding `text`. The workspace and /pricing render one status and one alert region. */
const region = (page: Page, role: "status" | "alert", text: string) => page.getByRole(role).filter({ hasText: text });

/** No link on the page opens a checkout, carries an offer into sign-in, or points at Paddle. */
async function expectNoCheckoutDoor(page: Page) {
  await expect(page.locator('a[href*="next=checkout"], a[href*="checkout="], a[href*="paddle.com"]')).toHaveCount(0);
}

/** Reaches `target` with Tab alone, so the decision is keyboard-reachable, not only focusable. */
async function tabTo(page: Page, target: Locator, limit = 150) {
  for (let presses = 0; presses < limit; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`not reachable with Tab within ${limit} presses`);
}

/*
  The fence's own failure path. Its hosts are ones the shipped CSP admits (connect-src
  *.supabase.co and *.paddle.com), because those are the requests a browser really sends; a
  CSP-refused host is stopped before the network and never reaches the fence. Run in a context of
  its own so the per-test "fence is empty" assertion is not the thing being tripped.
*/
test("the fence records and aborts what would leave the machine, and keeps unmocked API calls local", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  const records = await installNetworkFence(context, baseURL!);
  const page = await context.newPage();
  await page.goto("/pricing");
  const outcome = await page.evaluate(async () => {
    const attempt = (url: string) => fetch(url).then(() => "reached", () => "aborted");
    return {
      supabase: await attempt("https://probe-project.supabase.co/rest/v1/probe"),
      paddle: await attempt("https://api.paddle.com/probe"),
      unmockedApi: await fetch("/api/billing/status").then((response) => response.status),
      publicRead: await fetch("/api/status/v2").then((response) => response.status),
    };
  });
  expect(outcome).toEqual({ supabase: "aborted", paddle: "aborted", unmockedApi: 404, publicRead: 200 });
  await page.goto("https://probe-project.supabase.co/auth/v1/authorize").catch(() => undefined);
  expect(records).toEqual([
    "GET https://probe-project.supabase.co/rest/v1/probe",
    "GET https://api.paddle.com/probe",
    "GET https://probe-project.supabase.co/auth/v1/authorize",
  ]);
  await context.close();
});

/*
  D-12 (delegated decision 2026-11-09) moved `activationPolicy.customerData` to true. This server
  carries no launch flags (a CI runner sets none of COMMERCIAL_MODE, TAVONEL_BILLING_LAUNCH_APPROVED
  or VERCEL_ENV=production), so purchase stays closed here while customer processing is switched on:
  the posture every deployment without launch approval now serves. Every purchase door has to stay
  shut in it, which is what this test still holds.
*/
test.describe("launch approval withheld (purchase closed; customer processing switched on by D-12)", () => {
  test("every purchase entry ends at /contact or a stated sentence -- no checkout door, no Paddle, no raw code", async ({ page, request, baseURL }) => {
    test.setTimeout(90_000);
    // This posture is the absence of launch approval. A server started with the live-commerce flags (the
    // repair-scope browser bundle) is the other posture, and the simulated switch-on journey below covers it.
    test.skip(readCommercialState().liveChargesEnabled, "launch approval is granted on this server");
    // The two switches as this server answers them, not as a fixture says.
    const served = await (await request.get("/api/status/v2")).json() as { availableActions: Record<string, { enabled: boolean }> };
    expect(served.availableActions.purchasePlan.enabled, "purchase is closed without launch approval").toBe(false);
    expect(served.availableActions.compileCustomerDocuments.enabled, "customer processing is switched on (D-12)").toBe(true);
    expect(activationPolicy.customerData.enabled, "the server constant this posture follows").toBe(true);

    await declineAnalytics(page);
    await servePosture(page, "today");
    const paddle = await installFakePaddle(page);

    // H0. The hero's access action is the evaluation request, a contact form.
    await page.goto("/");
    // FINAL-SPEC 2026-10-26 §2.1 (D, veto): the hero's second action is named "Evaluate your documents".
    await expect(page.getByRole("link", { name: "Evaluate your documents" })).toHaveAttribute("href", "/evaluation");
    await expectNoCheckoutDoor(page);
    await page.goto("/evaluation");
    await expect(page.locator("form.contact-form")).toBeVisible();

    // H1. The sample's exit.
    await page.goto("/explore");
    await expect(page.getByRole("navigation", { name: "TAVONEL" }).getByRole("link", { name: "Request access" })).toHaveAttribute("href", "/contact");
    await expectNoCheckoutDoor(page);

    // H2. Every plan action is a conversation, and the gate is stated in the policy's own words.
    await page.goto("/pricing");
    const developer = page.getByRole("link", { name: "Request Developer access" });
    await expect(developer).toHaveAttribute("href", "/contact?plan=Developer");
    // Team self-serve (2026-11-10, intended): Team reads as Developer does while purchase is closed.
    await expect(page.getByRole("link", { name: "Request Team access" })).toHaveAttribute("href", "/contact?plan=Team");
    for (const enterprise of await page.getByRole("link", { name: "Scope an Enterprise pilot" }).all()) {
      await expect(enterprise).toHaveAttribute("href", "/contact?plan=Enterprise");
    }
    // The customer-data gate is open (D-12), so /pricing no longer states it.
    await expect(page.locator('[data-purchase-gate="customerData"]')).toHaveCount(0);
    await expectNoCheckoutDoor(page);
    await developer.click();
    await expect(page).toHaveURL(/\/contact\?plan=Developer$/);
    await expect(page.locator("form.contact-form")).toBeVisible();

    // H3-H5. The one door left: an offer typed into the sign-in URL by hand.
    const authorize = await stubProvider(page);
    await page.goto("/login?next=checkout&offer=observer_access");
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page).toHaveURL(/^https:\/\/test\.supabase\.co\/auth\/v1\/authorize/);
    expect(authorize).toHaveLength(1);
    expect(new URL(authorize[0]!).searchParams.get("redirect_to")).toBe(`${new URL(baseURL!).origin}/auth/callback`);

    await installFixtureSession(page);
    await installWorkspaceRoutes(page, { accessSource: "unentitled", customerDataEnabled: false });
    await page.route("**/api/access/bootstrap", (route) => route.fulfill({ json: TODAY_NEW_ACCOUNT }));
    // What app/api/billing/checkout/route.ts answers while purchasePlan is off (lib/checkout-policy.ts).
    const posts = await answerCheckout(page, () => ({ status: 503, json: { code: "BILLING_LAUNCH_PENDING" } }));
    await page.goto("/auth/callback");

    // H15. One-step buy (2026-11-10, intended): the held offer returns to /pricing, and the resumed
    // checkout ends there in a sentence in the Developer card, read as an alert, with nothing opened.
    const refusal = region(page, "alert", `Checkout is unavailable. ${failureSentence("BILLING_LAUNCH_PENDING", 503)}`);
    await expect(refusal).toBeVisible();
    await expect(refusal).not.toContainText("BILLING_LAUNCH_PENDING");
    await expect(page).toHaveURL(/\/pricing$/);
    expect(posts).toEqual([{ offerCode: "observer_access" }]);
    expect(paddle.loads(), "no Paddle script is fetched while purchase is closed").toBe(0);

    // H6. The closed workspace points at the public example and offers no file control.
    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    const strip = page.getByRole("status").filter({ hasText: "Workspace ready" });
    // FUNNEL-SIGNED-IN #5: before consent the strip names the one step left, not "pending".
    await expect(strip).toContainText("One step left");
    await expect(strip).not.toContainText("Source access pending");
    await expect(strip.getByRole("link", { name: "Explore example" })).toHaveAttribute("href", "/explore");
    await expect(page.getByRole("button", { name: "Choose files", exact: true })).toHaveCount(0);

    expect(await journeyFunnel(page)).toEqual([
      { event: "login_reached_with_intent", offer: "observer_access" },
      { event: "signed_in", mode: "resume-checkout" },
      { event: "checkout_opened", offer: "observer_access" },
    ]);
  });

  test("a switch-off upload succeeds on main's per-file path: capability, PUT, confirm, compile (D-12)", async ({ page }) => {
    test.skip(INTAKE_APPROVAL_ROLLOUT_ENABLED, "drives main's per-file path, which ships while the approval lineage is off");
    const DOC_ID = "00000000-0000-4000-8000-0000000000d1";
    const JOB_ID = `cjob-${"d".repeat(32)}`;
    const trace: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/uploads/approval") trace.push(`${request.method()} ${url.pathname}`);
    });

    await installFixtureSession(page);
    await installWorkspaceRoutes(page);
    let confirmed = false;
    await page.route("**/api/documents", (route) => route.fulfill({ json: { documents: confirmed ? [fixtureDocument(DOC_ID)] : [] } }));
    await page.route("**/api/uploads/capability", (route) => {
      const body = route.request().postDataJSON() as { originalFilename?: string; declaredMimeType?: string; requestedBytes?: number };
      trace.push(`POST capability ${body.originalFilename} ${body.declaredMimeType} ${body.requestedBytes! > 0}`);
      return route.fulfill({ json: {
        code: "QUALIFIED",
        documentId: DOC_ID,
        uploadUrl: `${FIXTURE_R2_ORIGIN}/quarantine/${DOC_ID}`,
        declaredMimeType: "application/pdf",
        sanitization: "pending_cdr",
      } });
    });
    await page.route(`${FIXTURE_R2_ORIGIN}/**`, (route) => {
      const origin = route.request().headers().origin ?? "";
      const method = route.request().method();
      if (method === "OPTIONS") {
        return route.fulfill({ status: 204, headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "PUT, OPTIONS",
          "access-control-allow-headers": "content-type",
        } });
      }
      trace.push(`${method} r2 ${route.request().headers()["content-type"]}`);
      return route.fulfill({ status: method === "PUT" ? 200 : 405, body: "", headers: { "access-control-allow-origin": origin } });
    });
    await page.route("**/api/uploads/confirm", (route) => {
      const body = route.request().postDataJSON() as { documentId?: string; sourceSha256?: string };
      trace.push(`POST confirm ${body.documentId === DOC_ID} ${/^[0-9a-f]{64}$|^sha256:/.test(body.sourceSha256 ?? "")}`);
      confirmed = true;
      return route.fulfill({ json: { code: "UPLOAD_CONFIRMED", result: {} } });
    });
    await page.route("**/api/compile-jobs", (route) => {
      if (route.request().method() !== "POST") return route.fulfill({ json: { code: "OK", jobs: [] } });
      trace.push(`POST compile ${JSON.stringify(route.request().postDataJSON())}`);
      return route.fulfill({ status: 202, json: { code: "COMPILE_JOB_ACCEPTED", jobId: JOB_ID, state: "preflight", documentsTotal: 1 } });
    });
    await page.route(`**/api/compile-jobs/${JOB_ID}/events**`, (route) => route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseFrames([
        { sequence: 1, eventType: "state_changed", state: "reading", documentsTotal: 1, documentsReady: 0, errorCode: null },
        { sequence: 2, eventType: "progressed", state: "review_required", documentsTotal: 1, documentsReady: 1, errorCode: null },
      ]),
    }));

    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".workspace-intake")).toHaveAttribute("data-inventory-state", "ready");
    await page.locator('input[type="file"][multiple]').first().setInputFiles({
      name: "journey-source.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\n% journey fixture\n"),
    });
    await page.getByRole("region", { name: "Compile preflight" }).getByRole("button", { name: /Upload & compile/ }).click();

    await expect.poll(() => trace.length, { timeout: 15_000 }).toBe(4);
    expect(trace).toEqual([
      "POST capability journey-source.pdf application/pdf true",
      "PUT r2 application/pdf",
      "POST confirm true true",
      `POST compile {"documentIds":["${DOC_ID}"]}`,
    ]);
    await expect(page.locator("section.workspace-compile-job")).toBeVisible();
  });
});

test.describe("simulated switch-on (browser mocks only)", () => {
  test("pricing → sign-in → back on pricing → checkout → overlay → checkout.completed → success on pricing → portal", async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    await declineAnalytics(page);
    await servePosture(page, "switch-on");
    const paddle = await installFakePaddle(page);
    const authorize = await stubProvider(page);
    const portal = await installPortalStub(page);

    // H2. Developer and Team go through sign-in carrying the offer (Team self-serve, 2026-11-10); Enterprise stays a conversation.
    await page.goto("/pricing");
    const developer = page.getByRole("link", { name: "Buy Developer — $29/month" });
    await expect(developer).toHaveAttribute("href", "/login?next=checkout&offer=observer_access");
    await expect(page.getByRole("link", { name: "Buy Team — $99/month" })).toHaveAttribute("href", "/login?next=checkout&offer=studio_access");
    await expect(page.getByRole("link", { name: "Scope an Enterprise pilot" }).first()).toHaveAttribute("href", "/contact?plan=Enterprise");
    await tabTo(page, developer);
    await page.keyboard.press("Enter");

    // H3-H4. Sign-in holds the offer in this tab and hands the provider nothing of it.
    await expect(page).toHaveURL(/\/login\?next=checkout&offer=observer_access$/);
    await expect(page.getByRole("heading", { level: 1, name: "One step before checkout." })).toBeVisible();
    const google = page.getByRole("button", { name: "Continue with Google" });
    await expect(google).toBeEnabled();
    await tabTo(page, google);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/^https:\/\/test\.supabase\.co\/auth\/v1\/authorize/);
    expect(authorize).toHaveLength(1);
    const sent = new URL(authorize[0]!);
    expect(sent.searchParams.get("provider")).toBe("google");
    expect(sent.searchParams.get("redirect_to")).toBe(`${new URL(baseURL!).origin}/auth/callback`);
    expect(authorize[0], "the offer never travels to the provider").not.toMatch(/offer|checkout|observer/);

    // H5. The provider returns with a session: a trial account in a processing workspace.
    await installFixtureSession(page);
    const state = { paid: false, account: { ...INACTIVE_BILLING } as BillingAccountFixture, bootstraps: 0 };
    await installWorkspaceRoutes(page, { accessSource: "trial" });
    await page.route("**/api/access/bootstrap", (route) => {
      state.bootstraps += 1;
      return route.fulfill({ json: bootstrapFor(state.paid ? "paid" : "trial") });
    });
    await page.route("**/api/billing/status", (route) => route.fulfill({ json: { code: "OK", account: state.account } }));
    await page.route("**/api/billing/portal", (route) => route.fulfill({ json: { code: "PORTAL_READY", url: FIXTURE_PORTAL_URL } }));
    const posts = await answerCheckout(page, () => ({ status: 200, json: SANDBOX_CHECKOUT_READY }));
    await page.goto("/auth/callback");

    // H6 + H15. One-step buy (2026-11-10, intended): sign-in returns to /pricing, which strips the
    // offer from the address and resumes it once, as an offer code and nothing else.
    await expect(region(page, "status", "Developer sandbox checkout opened. Only a verified webhook can change entitlements.")).toBeVisible();
    await expect(page).toHaveURL(/\/pricing$/);
    expect(posts).toEqual([{ offerCode: "observer_access" }]);
    expect(paddle.loads()).toBe(1);
    expect(await paddleCalls(page)).toEqual({
      environments: ["sandbox"],
      initialized: [{ token: SANDBOX_CHECKOUT_READY.clientToken }],
      opened: [{
        items: [{ priceId: SANDBOX_CHECKOUT_READY.offer.priceId, quantity: 1 }],
        customer: SANDBOX_CHECKOUT_READY.customer,
        customData: SANDBOX_CHECKOUT_READY.customData,
        // Journey A11: the overlay follows the page it opens on (English, and /pricing is a light page).
        settings: { displayMode: "overlay", theme: "light", locale: "en" },
      }],
    });
    await page.evaluate(() => { (window as unknown as { __journeyNoReload: boolean }).__journeyNoReload = true; });

    // H16. Paddle reports the payment; the signed webhook lands (billing turns paid). The page closes
    // the overlay and states the outcome itself, pending first.
    state.account = ACTIVE_DEVELOPER;
    state.paid = true;
    expect(await emitPaddleEvent(page, "checkout.completed")).toBe(true);
    const outcome = page.locator("section.pricing-purchase");
    await expect(outcome.getByRole("heading", { name: "Payment accepted." })).toBeVisible();
    await expect(outcome).toBeFocused();
    expect(await paddleClosed(page), "the buyer is not left on Paddle's own success screen").toBe(1);

    // H17 (journey A4). The bounded wait reads the arrival: the plan and its catalog pages, no reload.
    await expect(outcome.getByRole("heading", { name: "Developer is active." })).toBeVisible({ timeout: 10_000 });
    await expect(outcome).toContainText("500 pages this month.");
    expect(await page.evaluate(() => (window as unknown as { __journeyNoReload?: boolean }).__journeyNoReload), "the page was not reloaded").toBe(true);
    await expect(outcome.getByRole("link", { name: "Open your workspace" })).toHaveAttribute("href", "/workspace");

    expect(await journeyFunnel(page)).toEqual([
      { event: "login_reached_with_intent", offer: "observer_access" },
      { event: "signed_in", mode: "resume-checkout" },
      { event: "checkout_opened", offer: "observer_access" },
      { event: "checkout_completed", offer: "observer_access", mode: "sandbox" },
    ]);

    // H18. The workspace billing card shows the plan, and its portal action leaves for the portal.
    await page.goto("/workspace/settings/usage", { waitUntil: "domcontentloaded" });
    const card = page.locator("section.billing-card");
    await expect(card.getByRole("heading", { name: "observer access" })).toBeVisible();
    await expect(card.locator("dl").first()).toContainText("active");
    await card.getByRole("button", { name: "Manage or cancel subscription" }).click();
    await expect(page).toHaveURL(FIXTURE_PORTAL_URL);
    expect(portal).toEqual([FIXTURE_PORTAL_URL]);
    expect(posts, "one checkout for one offer").toHaveLength(1);
  });

  /*
    Journey A3 / defect D-01 (lane P2-29, register D-14): terms -> launch -> checkout. Before this
    the resumed checkout fired at mount, into a certain CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE
    refusal, and the intent was spent on it. Each stage is a reload, so the intent has to survive one.
  */
  test("checkout before release: the plan is held through terms and release, survives a reload, then opens once (D-01)", async ({ page }) => {
    test.setTimeout(90_000);
    await declineAnalytics(page);
    await servePosture(page, "switch-on");
    const paddle = await installFakePaddle(page);
    await installFixtureSession(page);
    await installWorkspaceRoutes(page, { accessSource: "unentitled", customerDataEnabled: false });
    const state: { bootstrap: unknown; reads: number } = { bootstrap: TODAY_NEW_ACCOUNT, reads: 0 };
    await page.route("**/api/access/bootstrap", (route) => (state.reads += 1, route.fulfill({ json: state.bootstrap })));
    const posts = await answerCheckout(page, () => ({ status: 200, json: SANDBOX_CHECKOUT_READY }));
    const held = region(page, "status", "Developer is held for you.");
    const reload = async (bootstrap: unknown) => {
      state.bootstrap = bootstrap;
      await page.reload({ waitUntil: "domcontentloaded" });
    };

    // H6, terms not accepted: held beside the terms review, with the live sentence and not its promise.
    await page.goto("/workspace?checkout=observer_access", { waitUntil: "domcontentloaded" });
    await expect(held).toBeVisible();
    await expect(page).toHaveURL(/\/workspace$/);
    await expect(page.getByRole("button", { name: "Review processing terms" })).toBeVisible();
    await expect(page.getByText("Checkout opens by itself", { exact: false })).toHaveCount(0);

    // Terms accepted, no production release yet: still held, from this tab's copy alone.
    await reload({ ...TODAY_NEW_ACCOUNT, sourcePending: "release_pending" });
    await expect(held).toBeVisible();
    await expect(page.getByText("File access for this workspace is awaiting release", { exact: false })).toBeVisible();

    // A qualification grant processes files but is never billable: still held.
    const open = bootstrapFor("trial");
    await reload({ ...open, access: { ...open.access, processingStage: "qualification" } });
    await expect(held).toBeVisible();
    expect(posts, "nothing is sent while the plan is held").toEqual([]);
    expect(paddle.loads()).toBe(0);

    // Released for production: the held offer resumes once, as an offer code and nothing else.
    await reload(open);
    await expect(region(page, "status", "Developer sandbox checkout opened. Only a verified webhook can change entitlements.")).toBeVisible();
    expect(posts).toEqual([{ offerCode: "observer_access" }]);
    expect(paddle.loads()).toBe(1);

    // Spent: the next visit reads access and opens nothing.
    const reads = state.reads;
    await reload(open);
    await expect.poll(() => state.reads).toBeGreaterThan(reads);
    await expect(held).toHaveCount(0);
    expect(posts).toHaveLength(1);
  });

  /*
    Review B1 (2026-10-19): a trial that ended (or was refused) leaves a released workspace with no
    entitlement and no file access, and bootstrap answers ACCESS_READY_NO_ENTITLEMENT. Buying is that
    person's way forward, so the held offer resumes once the stage is production -- and stays held
    while the workspace is only qualified.
  */
  test("a trial-expired buyer in a released workspace resumes the held checkout exactly once (review B1)", async ({ page }) => {
    await declineAnalytics(page);
    await servePosture(page, "switch-on");
    const paddle = await installFakePaddle(page);
    await installFixtureSession(page);
    await installWorkspaceRoutes(page, { accessSource: "unentitled", customerDataEnabled: false });
    const noEntitlement = (processingStage: "production" | "qualification") => ({
      code: "ACCESS_READY_NO_ENTITLEMENT",
      access: { source: "unentitled", accessPlan: null, billingExempt: false, expiresAt: null, limits: null, customerDataEnabled: false, processingStage },
    });
    const state = { bootstrap: noEntitlement("qualification"), reads: 0 };
    await page.route("**/api/access/bootstrap", (route) => (state.reads += 1, route.fulfill({ json: state.bootstrap })));
    const posts = await answerCheckout(page, () => ({ status: 200, json: SANDBOX_CHECKOUT_READY }));
    const held = region(page, "status", "Developer is held for you.");

    // Qualified, not released: held, nothing sent.
    await page.goto("/workspace?checkout=observer_access", { waitUntil: "domcontentloaded" });
    await expect(held).toBeVisible();
    expect(posts).toEqual([]);

    // Released for production with the trial over: one checkout, as an offer code and nothing else.
    state.bootstrap = noEntitlement("production");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(region(page, "status", "Developer sandbox checkout opened. Only a verified webhook can change entitlements.")).toBeVisible();
    await expect(held).toHaveCount(0);
    expect(posts).toEqual([{ offerCode: "observer_access" }]);
    expect(paddle.loads()).toBe(1);

    // Spent: the next visit reads access again and sends nothing.
    const reads = state.reads;
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(() => state.reads).toBeGreaterThan(reads);
    await expect(held).toHaveCount(0);
    expect(posts).toHaveLength(1);
  });

  test("a signed-in upgrade opens the overlay over /pricing, in that page's language and scheme (A11)", async ({ page }) => {
    await declineAnalytics(page);
    await servePosture(page, "switch-on");
    await installFixtureSession(page);
    const paddle = await installFakePaddle(page);
    await page.route("**/api/billing/status", (route) => route.fulfill({ json: { code: "OK", account: INACTIVE_BILLING } }));
    const posts = await answerCheckout(page, () => ({ status: 200, json: SANDBOX_CHECKOUT_READY }));

    await page.goto("/pricing");
    await page.getByRole("link", { name: "Buy Developer — $29/month", exact: true }).click();
    await expect(region(page, "status", "Developer sandbox checkout opened.")).toHaveCount(1);
    await expect(page).toHaveURL(/\/pricing$/);
    expect(posts).toEqual([{ offerCode: "observer_access" }]);
    expect(paddle.loads()).toBe(1);
    expect((await paddleCalls(page))?.opened.map((open) => open.settings)).toEqual([{ displayMode: "overlay", theme: "light", locale: "en" }]);
  });

  /*
    One-step buy (2026-11-10, replaces the hotfix toast). Signed in, terms not accepted: the server
    gate still refuses the checkout (403), and /pricing answers with the workspace's own terms step
    in a modal dialog -- same summary, documents, version, checkbox and POST. Escape closes it and
    hands focus back. Accepting records the agreement and opens the checkout on /pricing.
  */
  test("terms owed: the terms open in a dialog on /pricing, and accepting opens the checkout there", async ({ page }) => {
    test.setTimeout(90_000);
    await declineAnalytics(page);
    await servePosture(page, "switch-on");
    await installFixtureSession(page);
    const paddle = await installFakePaddle(page);
    await page.route("**/api/billing/status", (route) => route.fulfill({ json: { code: "OK", account: INACTIVE_BILLING } }));
    const terms = await installTermsRoutes(page);
    const posts = await answerCheckout(page, () => terms.accepted
      ? { status: 200, json: SANDBOX_CHECKOUT_READY }
      : { status: 403, json: { code: "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE" } });

    await page.goto("/pricing");
    const buy = page.getByRole("link", { name: "Buy Developer — $29/month", exact: true });
    await buy.click();
    const dialog = page.getByRole("dialog", { name: "Accept the processing terms" });
    await expect(dialog).toBeVisible();
    // No toast, no workspace detour: nothing is announced as a refusal.
    await expect(page.getByRole("alert").filter({ hasText: "Checkout is unavailable." })).toHaveCount(0);
    await expect(dialog).toContainText("Developer checkout opens as soon as you accept.");
    await expect(dialog.getByRole("list", { name: "The terms in brief" }).getByRole("listitem")).toHaveCount(3);
    await expect(dialog.getByRole("link", { name: "Self-Service Terms" })).toHaveAttribute("href", TERMS_OFFER.terms.path);
    await expect(dialog.getByRole("link", { name: "Processing Addendum" })).toHaveAttribute("href", TERMS_OFFER.processing.path);
    await expect(dialog).toContainText(`(version ${TERMS_OFFER.version})`);
    const accept = dialog.getByRole("button", { name: "Accept terms" });
    await expect(accept).toBeDisabled();

    // Keyboard: Tab stays inside, Escape closes, focus returns to the Buy control.
    for (let press = 0; press < 8; press += 1) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((node) => node.contains(document.activeElement)), `Tab left the dialog after ${press + 1}`).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(buy).toBeFocused();
    expect(terms.posts, "closing records nothing").toBe(0);

    // Again, and accept: the agreement is recorded once and the checkout opens on /pricing.
    await buy.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("checkbox", { name: /I have read and agree/ }).check();
    await accept.click();
    await expect(dialog).toHaveCount(0);
    await expect(region(page, "status", "Developer sandbox checkout opened.")).toBeVisible();
    await expect(page).toHaveURL(/\/pricing$/);
    expect(terms.posts).toBe(1);
    expect(posts).toEqual([{ offerCode: "observer_access" }, { offerCode: "observer_access" }, { offerCode: "observer_access" }]);
    expect(paddle.loads()).toBe(1);
    expect((await paddleCalls(page))?.opened).toHaveLength(1);
  });

  /*
    One-step buy (2026-11-10). Any other refusal is a sentence in the card of the plan it is about,
    in the page rather than a toast fixed to the foot of it, with a next step. Team (self-serve the
    same day) is refused for a workspace that already holds Developer, and the next step is the
    subscription portal. An offer code off the list in the address resumes nothing.
  */
  test("a refusal is an inline sentence in its plan card with a next step, and a bad offer in the address does nothing", async ({ page }) => {
    await declineAnalytics(page);
    await servePosture(page, "switch-on");
    await installFixtureSession(page);
    const paddle = await installFakePaddle(page);
    await page.route("**/api/billing/status", (route) => route.fulfill({ json: { code: "OK", account: INACTIVE_BILLING } }));
    let reply = { status: 403, json: { code: "BILLING_HOLD" } as unknown };
    const posts = await answerCheckout(page, () => reply);

    await page.goto("/pricing?checkout=enterprise_access");
    await expect(page.getByRole("link", { name: "Buy Developer — $29/month", exact: true })).toBeVisible();
    expect(posts, "an offer off the list resumes nothing").toEqual([]);

    await page.getByRole("link", { name: "Buy Developer — $29/month", exact: true }).click();
    const hold = region(page, "alert", failureSentence("BILLING_HOLD", 403));
    await expect(hold).toBeVisible();
    await expect(hold.locator("p")).toHaveCSS("position", "static");
    expect(await hold.evaluate((node) => node.closest("article")?.querySelector("h2")?.textContent)).toBe("Developer");
    await expect(hold.getByRole("link", { name: "Contact us about Developer" })).toHaveAttribute("href", "/contact?plan=Developer");

    reply = { status: 409, json: { code: "BILLING_PLAN_CHANGE_REQUIRED" } };
    await page.getByRole("link", { name: "Buy Team — $99/month", exact: true }).click();
    const change = region(page, "alert", failureSentence("BILLING_PLAN_CHANGE_REQUIRED", 409));
    await expect(change).toBeVisible();
    expect(await change.evaluate((node) => node.closest("article")?.querySelector("h2")?.textContent)).toBe("Team");
    await expect(change.getByRole("link", { name: "Manage or cancel subscription" })).toHaveAttribute("href", "/workspace/settings/usage");
    await expect(page.getByRole("link", { name: "Scope an Enterprise pilot" }).first()).toHaveAttribute("href", "/contact?plan=Enterprise");
    expect(posts).toEqual([{ offerCode: "observer_access" }, { offerCode: "studio_access" }]);
    expect(paddle.loads()).toBe(0);
  });

  test("Team is bought online: signed out it carries its offer into sign-in, signed in it opens the checkout", async ({ page }) => {
    // The paid outcome runs the bounded billing wait, as the other paid journeys here do.
    test.setTimeout(90_000);
    await declineAnalytics(page);
    await servePosture(page, "switch-on");
    await page.goto("/pricing");
    await expect(page.getByRole("link", { name: "Buy Team — $99/month", exact: true })).toHaveAttribute("href", "/login?next=checkout&offer=studio_access");

    await installFixtureSession(page);
    const paddle = await installFakePaddle(page);
    await page.route("**/api/billing/status", (route) => route.fulfill({ json: { code: "OK", account: INACTIVE_BILLING } }));
    const team = { ...SANDBOX_CHECKOUT_READY, offer: { ...SANDBOX_CHECKOUT_READY.offer, code: "studio_access", label: "Team", credits: 10_000 } };
    const posts = await answerCheckout(page, () => ({ status: 200, json: team }));
    await page.goto("/pricing");
    await page.getByRole("link", { name: "Buy Team — $99/month", exact: true }).click();
    await expect(region(page, "status", "Team sandbox checkout opened.")).toBeVisible();
    expect(posts).toEqual([{ offerCode: "studio_access" }]);
    expect(paddle.loads()).toBe(1);

    // R1 review (2026-11-10): Team includes guided onboarding, so the paid outcome says how it is arranged.
    expect(await emitPaddleEvent(page, "checkout.completed")).toBe(true);
    const outcome = page.locator("section.pricing-purchase");
    await expect(outcome).toContainText("We will contact you within 1 working day to schedule your guided onboarding.");
    await expect(outcome.getByRole("link", { name: "support@tavonel.com" })).toHaveAttribute("href", "mailto:support@tavonel.com");
  });

  /*
    Hotfix 2026-11-10. In production a first sign-in has no trial before the terms are accepted, so
    /api/documents is refused 402 SUBSCRIPTION_REQUIRED by the product gate. The terms step must
    render, not the load error, and accepting opens the drop zone with the inventory read again.
    A genuine read failure still says so.
  */
  async function installPreTermsWorkspace(page: Page, inventory: (accepted: boolean) => { status: number; json: unknown }) {
    await installFixtureSession(page);
    await installWorkspaceRoutes(page, { accessSource: "unentitled", customerDataEnabled: false });
    const state = { accepted: false, inventoryReads: 0 };
    const offer = {
      version: "2026-09-30",
      terms: { path: "/policy/TAVONEL_SELF_SERVICE_TERMS_2026-09-30.md", sha256: `sha256:${"a".repeat(64)}` },
      processing: { path: "/policy/TAVONEL_PROCESSING_ADDENDUM_2026-09-30.md", sha256: `sha256:${"b".repeat(64)}` },
      scopes: ["direct_upload", "connector"],
    };
    await page.route("**/api/access/bootstrap", (route) => route.fulfill({
      json: state.accepted
        ? { code: "ACCESS_READY", access: { ...TODAY_NEW_ACCOUNT.access, customerDataEnabled: true } }
        : TODAY_NEW_ACCOUNT,
    }));
    await page.route("**/api/access/processing-terms", async (route) => {
      if (route.request().method() === "GET") return route.fulfill({ json: offer });
      state.accepted = true;
      return route.fulfill({ status: 201, json: { code: "PROCESSING_TERMS_ACCEPTED", receipt: {
        acceptanceId: "5f2b8a4e-2c1d-4b7a-9e3f-0a1b2c3d4e5f", scope: "direct_upload", termsVersion: offer.version,
        terms: offer.terms, processing: offer.processing, acceptedAt: "2026-11-10T10:00:00.000Z", idempotentReplay: false,
      } } });
    });
    await page.route("**/api/documents", (route) => {
      state.inventoryReads += 1;
      const answer = inventory(state.accepted);
      return route.fulfill({ status: answer.status, json: answer.json });
    });
    return state;
  }

  test("a pre-terms inventory refusal shows the terms step, and acceptance opens the drop zone", async ({ page }) => {
    const state = await installPreTermsWorkspace(page, (accepted) => accepted
      ? { status: 200, json: { documents: [] } }
      : { status: 402, json: { code: "SUBSCRIPTION_REQUIRED" } });
    await page.goto("/workspace", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("To process your own files, review and accept the processing terms.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Start with your documents" })).toBeVisible();
    await expect(page.getByText("could not be loaded")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Retry loading sources" })).toHaveCount(0);

    await page.getByRole("button", { name: "Review processing terms" }).click();
    await page.getByRole("checkbox", { name: /I have read and agree/ }).check();
    await page.getByRole("button", { name: "Accept terms" }).click();
    await expect(page.getByRole("heading", { name: "Drop files, folders or ZIP here" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose files" })).toBeEnabled();
    expect(state.inventoryReads).toBeGreaterThanOrEqual(2);
  });

  test("a failed inventory read still says so while the terms are pending", async ({ page }) => {
    await installPreTermsWorkspace(page, () => ({ status: 503, json: { code: "SIGNER_NOT_CONFIGURED" } }));
    await page.goto("/workspace", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Your sources could not be loaded" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry loading sources" }).first()).toBeVisible();
  });

  test("webhook never arrives: the bounded wait ends in a stated pending sentence, not a spinner (D-04)", async ({ page }) => {
    // The page's clock, so the 60 s window is walked rather than waited out.
    await page.clock.install();
    await installFixtureSession(page);
    await installWorkspaceRoutes(page, { accessSource: "trial" });
    let reads = 0;
    await page.route("**/api/billing/status", (route) => {
      reads += 1;
      return route.fulfill({ json: { code: "OK", account: INACTIVE_BILLING } });
    });
    await installFakePaddle(page);
    await answerCheckout(page, () => ({ status: 200, json: SANDBOX_CHECKOUT_READY }));

    await page.goto("/workspace?checkout=observer_access", { waitUntil: "domcontentloaded" });
    await expect(region(page, "status", "Developer sandbox checkout opened.")).toBeVisible();
    const readsBefore = reads;
    expect(await emitPaddleEvent(page, "checkout.completed")).toBe(true);

    const pending = region(page, "status", ENTITLEMENT_PENDING_SENTENCE);
    for (let advanced = 0; advanced <= ENTITLEMENT_WAIT_WINDOW_MS + 5_000 && await pending.count() === 0; advanced += 250) {
      await page.clock.runFor(250);
    }
    await expect(pending).toBeVisible();
    expect(reads - readsBefore, "one read per scheduled delay, and no more").toBe(ENTITLEMENT_WAIT_DELAYS_MS.length);
    await expect(page.getByText(entitlementActiveSentence("Developer"))).toHaveCount(0);

    // Bounded: once it has said pending, time passing reads nothing more.
    await page.clock.runFor(ENTITLEMENT_WAIT_WINDOW_MS);
    expect(reads - readsBefore).toBe(ENTITLEMENT_WAIT_DELAYS_MS.length);
  });

  test("refusal matrix: each checkout answer ends in its own sentence, never the code, never Paddle", async ({ page }) => {
    test.setTimeout(90_000);
    await installFixtureSession(page);
    await installWorkspaceRoutes(page, { accessSource: "trial" });
    const paddle = await installFakePaddle(page);
    const cases: Array<{ offer: string; reply: CheckoutReply; role: "status" | "alert"; sentence: string; code?: string }> = [
      ...([
        ["BILLING_LAUNCH_PENDING", 503],
        ["BILLING_NOT_CONFIGURED", 503],
        ["PILOT_ACCESS_REQUIRED", 403],
        ["CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE", 403],
        ["PROCESSING_QUALIFICATION_NOT_BILLABLE", 403],
        ["AUTH_REQUIRED", 401],
      ] as const).map(([code, status]) => ({
        offer: "observer_access", reply: { status, json: { code } }, role: "alert" as const,
        sentence: `Checkout is unavailable. ${failureSentence(code, status)}`, code,
      })),
      // Team is sold through a conversation; a hand-made checkout URL for it is refused.
      { offer: "studio_access", reply: { status: 403, json: { code: "BILLING_OFFER_CONTACT_REQUIRED" } }, role: "alert",
        sentence: `Checkout is unavailable. ${failureSentence("BILLING_OFFER_CONTACT_REQUIRED", 403)}`, code: "BILLING_OFFER_CONTACT_REQUIRED" },
      { offer: "observer_access", reply: { status: 409, json: { code: "OWNER_ACCESS_ACTIVE" } }, role: "status",
        sentence: "Owner access is already active. No checkout or payment is required for this account.", code: "OWNER_ACCESS_ACTIVE" },
      { offer: "observer_access", reply: { status: 200, json: { code: "CHECKOUT_READY", environment: "sandbox" } }, role: "alert",
        sentence: "Checkout is unavailable. The checkout response was incomplete, so nothing was opened or charged." },
      { offer: "observer_access", reply: "abort", role: "alert", sentence: "Paddle checkout could not be opened. No entitlement was changed." },
    ];
    let current = cases[0]!;
    const posts = await answerCheckout(page, () => current.reply);
    for (const [index, entry] of cases.entries()) {
      current = entry;
      await page.goto(`/workspace?checkout=${entry.offer}`, { waitUntil: "domcontentloaded" });
      const notice = region(page, entry.role, entry.sentence);
      await expect(notice, `${entry.code ?? "no code"} -> its sentence`).toBeVisible();
      if (entry.code) await expect(page.locator("main")).not.toContainText(entry.code);
      expect(posts).toHaveLength(index + 1);
      expect(posts[index]).toEqual({ offerCode: entry.offer });
    }
    expect(paddle.loads(), "no refusal fetched the Paddle script").toBe(0);
  });

  test("360, 390 and 430 with reduced motion: the terms dialog and the paid outcome fit the phone", async ({ browser, baseURL, fence }) => {
    test.setTimeout(120_000);
    for (const width of [360, 390, 430]) {
      const context = await browser.newContext({ baseURL, viewport: { width, height: 844 }, reducedMotion: "reduce" });
      await installNetworkFence(context, baseURL!, fence);
      const page = await context.newPage();
      await declineAnalytics(page);
      await servePosture(page, "switch-on");
      await installFixtureSession(page);
      await installFakePaddle(page);
      await page.route("**/api/billing/status", (route) => route.fulfill({ json: { code: "OK", account: ACTIVE_DEVELOPER } }));
      const terms = await installTermsRoutes(page);
      await answerCheckout(page, () => terms.accepted
        ? { status: 200, json: SANDBOX_CHECKOUT_READY }
        : { status: 403, json: { code: "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE" } });
      await page.goto("/pricing", { waitUntil: "domcontentloaded" });
      const buy = page.getByRole("link", { name: "Buy Developer — $29/month", exact: true });
      await buy.scrollIntoViewIfNeeded();
      await buy.click();
      const dialog = page.getByRole("dialog", { name: "Accept the processing terms" });
      const accept = dialog.getByRole("button", { name: "Accept terms" });
      await expect(accept).toBeVisible();
      const box = (await dialog.boundingBox())!;
      expect(box.x >= 15 && box.x + box.width <= width - 15, `dialog keeps a 16px gutter at ${width}px`).toBe(true);
      expect(await dialog.evaluate((node) => node.scrollWidth - node.clientWidth), `no sideways scroll in the dialog at ${width}px`).toBeLessThanOrEqual(1);
      await dialog.getByRole("checkbox", { name: /I have read and agree/ }).check();
      await accept.scrollIntoViewIfNeeded();
      await accept.click({ trial: true });
      await accept.click();
      await expect(dialog).toHaveCount(0);
      await expect(region(page, "status", "Developer sandbox checkout opened.")).toBeVisible();
      expect(await emitPaddleEvent(page, "checkout.completed")).toBe(true);
      const outcome = page.locator("section.pricing-purchase");
      await expect(outcome.getByRole("heading", { name: "Developer is active." })).toBeVisible({ timeout: 10_000 });
      await expect(outcome).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `no sideways scroll at ${width}px`).toBeLessThanOrEqual(1);
      await context.close();
    }
  });

  test("360, 390 and 430 with reduced motion: every decision point fits and is reachable", async ({ browser, baseURL, fence }) => {
    test.setTimeout(120_000);
    for (const width of [360, 390, 430]) {
      const context = await browser.newContext({ baseURL, viewport: { width, height: 844 }, reducedMotion: "reduce" });
      await installNetworkFence(context, baseURL!, fence);

      const open = async (posture: Posture, url: string, signedIn: boolean) => {
        const page = await context.newPage();
        await declineAnalytics(page);
        await servePosture(page, posture);
        if (signedIn) {
          await installFixtureSession(page);
          await installWorkspaceRoutes(page, { accessSource: "trial", billing: ACTIVE_DEVELOPER });
          await answerCheckout(page, () => ({ status: 503, json: { code: "BILLING_LAUNCH_PENDING" } }));
        }
        await page.goto(url, { waitUntil: "domcontentloaded" });
        return page;
      };
      const reachable = async (page: Page, target: Locator, what: string) => {
        await target.scrollIntoViewIfNeeded();
        // Actionability: visible, stable, enabled and the topmost element where it would be clicked.
        await target.click({ trial: true });
        const box = (await target.boundingBox())!;
        expect(box.x >= 0 && box.x + box.width <= width + 1, `${what} inside ${width}px`).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${what}: no sideways scroll at ${width}px`).toBeLessThanOrEqual(1);
        await page.close();
      };

      let page = await open("today", "/pricing", false);
      await reachable(page, page.getByRole("link", { name: "Request Developer access" }), "today's Developer action");
      page = await open("switch-on", "/pricing", false);
      await reachable(page, page.getByRole("link", { name: "Buy Developer — $29/month" }), "switch-on Developer action");
      page = await open("switch-on", "/login?next=checkout&offer=observer_access", false);
      await reachable(page, page.getByRole("button", { name: "Continue with Google" }), "sign-in");
      page = await open("today", "/workspace?checkout=observer_access", true);
      const refusal = region(page, "alert", "Checkout is unavailable.");
      await expect(refusal).toBeVisible();
      await expect(refusal).toBeInViewport();
      await reachable(page, refusal, "checkout refusal");
      page = await open("switch-on", "/workspace/settings/usage", true);
      await reachable(page, page.locator("section.billing-card").getByRole("button", { name: "Manage or cancel subscription" }), "Manage or cancel subscription");

      await context.close();
    }
  });
});
