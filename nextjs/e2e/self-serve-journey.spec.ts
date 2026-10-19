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

test.describe("production posture today (S1: account creation open, purchase and processing closed)", () => {
  test("every purchase entry ends at /contact or a stated sentence -- no checkout door, no Paddle, no raw code", async ({ page, request, baseURL }) => {
    test.setTimeout(90_000);
    // The two closed switches as this server answers them, not as a fixture says.
    const served = await (await request.get("/api/status/v2")).json() as { availableActions: Record<string, { enabled: boolean }> };
    expect(served.availableActions.purchasePlan.enabled, "purchase is closed on main").toBe(false);
    expect(served.availableActions.compileCustomerDocuments.enabled, "customer processing is closed on main").toBe(false);

    await declineAnalytics(page);
    await servePosture(page, "today");
    const paddle = await installFakePaddle(page);

    // H0. The hero's access action is the evaluation request, a contact form.
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Bring your own documents" })).toHaveAttribute("href", "/evaluation");
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
    await expect(page.getByRole("link", { name: "Talk to us about Team" })).toHaveAttribute("href", "/contact?plan=Team");
    for (const enterprise of await page.getByRole("link", { name: "Scope an Enterprise pilot" }).all()) {
      await expect(enterprise).toHaveAttribute("href", "/contact?plan=Enterprise");
    }
    await expect(page.locator('[data-purchase-gate="customerData"]')).toContainText(activationPolicy.customerData.reason);
    await expectNoCheckoutDoor(page);
    await developer.click();
    await expect(page).toHaveURL(/\/contact\?plan=Developer$/);
    await expect(page.locator("form.contact-form")).toBeVisible();

    // The Korean price page sends every plan to the Korean contact page.
    await page.goto("/ko/pricing");
    for (const plan of ["Developer", "Team", "Enterprise"]) {
      await expect(page.getByRole("link", { name: `${plan} 도입 상담` })).toHaveAttribute("href", `/ko/contact?plan=${plan}`);
    }
    await expectNoCheckoutDoor(page);

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

    // H15. The resumed checkout ends in a sentence, read as an alert, with nothing opened.
    const refusal = region(page, "alert", `Checkout is unavailable. ${failureSentence("BILLING_LAUNCH_PENDING", 503)}`);
    await expect(refusal).toBeVisible();
    await expect(refusal).not.toContainText("BILLING_LAUNCH_PENDING");
    await expect(page).toHaveURL(/\/workspace$/);
    expect(posts).toEqual([{ offerCode: "observer_access" }]);
    expect(paddle.loads(), "no Paddle script is fetched while purchase is closed").toBe(0);

    // H6. The closed workspace points at the public example and offers no file control.
    const strip = page.getByRole("status").filter({ hasText: "Workspace ready" });
    await expect(strip).toContainText("Source access pending");
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
  test("pricing → sign-in → callback → checkout → overlay → checkout.completed → entitlement without reload → portal", async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    await declineAnalytics(page);
    await servePosture(page, "switch-on");
    const paddle = await installFakePaddle(page);
    const authorize = await stubProvider(page);
    const portal = await installPortalStub(page);

    // H2. Developer goes through sign-in carrying the offer; Team stays a conversation.
    await page.goto("/pricing");
    const developer = page.getByRole("link", { name: "Get Developer access, via sign-in" });
    await expect(developer).toHaveAttribute("href", "/login?next=checkout&offer=observer_access");
    await expect(page.getByRole("link", { name: "Talk to us about Team" })).toHaveAttribute("href", "/contact?plan=Team");
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

    // H6 + H15. The held offer resumes once, as an offer code and nothing else.
    await expect(region(page, "status", "Developer sandbox checkout opened. Only a verified webhook can change entitlements.")).toBeVisible();
    await expect(page).toHaveURL(/\/workspace$/);
    expect(posts).toEqual([{ offerCode: "observer_access" }]);
    expect(paddle.loads()).toBe(1);
    expect(await paddleCalls(page)).toEqual({
      environments: ["sandbox"],
      initialized: [{ token: SANDBOX_CHECKOUT_READY.clientToken }],
      opened: [{
        items: [{ priceId: SANDBOX_CHECKOUT_READY.offer.priceId, quantity: 1 }],
        customer: SANDBOX_CHECKOUT_READY.customer,
        customData: SANDBOX_CHECKOUT_READY.customData,
        // Journey A11: the workspace is a dark page in English.
        settings: { displayMode: "overlay", theme: "dark", locale: "en" },
      }],
    });
    const trialStrip = page.getByRole("status").filter({ hasText: "Free evaluation" });
    await expect(trialStrip.getByRole("link", { name: "Upgrade to Developer" })).toHaveAttribute("href", "/pricing");
    await page.evaluate(() => { (window as unknown as { __journeyNoReload: boolean }).__journeyNoReload = true; });

    // H16. Paddle reports the payment; the signed webhook lands (billing and bootstrap turn paid).
    const bootstrapsBefore = state.bootstraps;
    state.account = ACTIVE_DEVELOPER;
    state.paid = true;
    expect(await emitPaddleEvent(page, "checkout.completed")).toBe(true);
    await expect(region(page, "status", "Paddle accepted the sandbox payment.")).toBeVisible();

    // H17 (journey A4). The bounded wait reads the arrival and the shell re-reads access, no reload.
    await expect(region(page, "status", entitlementActiveSentence("Developer"))).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => state.bootstraps).toBeGreaterThan(bootstrapsBefore);
    await expect(trialStrip).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __journeyNoReload?: boolean }).__journeyNoReload), "the page was not reloaded").toBe(true);
    await page.getByLabel("More workspace tools").first().click();
    await expect(page.getByRole("button", { name: "Developer tools" })).toBeVisible();

    expect(await journeyFunnel(page)).toEqual([
      { event: "login_reached_with_intent", offer: "observer_access" },
      { event: "signed_in", mode: "resume-checkout" },
      { event: "checkout_opened", offer: "observer_access" },
      { event: "checkout_completed", offer: "observer_access", mode: "sandbox" },
    ]);

    // H18. The billing card shows what the wait read, and Manage billing leaves for the portal.
    await page.getByRole("button", { name: "Settings" }).click();
    const card = page.locator("section.billing-card");
    await expect(card.getByRole("heading", { name: "observer access" })).toBeVisible();
    await expect(card.locator("dl")).toContainText("active");
    await card.getByRole("button", { name: "Manage billing" }).click();
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

  test("a signed-in upgrade opens the overlay over /pricing, in that page's language and scheme (A11)", async ({ page }) => {
    await declineAnalytics(page);
    await servePosture(page, "switch-on");
    await installFixtureSession(page);
    const paddle = await installFakePaddle(page);
    await page.route("**/api/billing/status", (route) => route.fulfill({ json: { code: "OK", account: INACTIVE_BILLING } }));
    const posts = await answerCheckout(page, () => ({ status: 200, json: SANDBOX_CHECKOUT_READY }));

    await page.goto("/pricing");
    await page.getByRole("link", { name: "Get Developer access", exact: true }).click();
    await expect(region(page, "status", "Developer sandbox checkout opened.")).toHaveCount(1);
    await expect(page).toHaveURL(/\/pricing$/);
    expect(posts).toEqual([{ offerCode: "observer_access" }]);
    expect(paddle.loads()).toBe(1);
    expect((await paddleCalls(page))?.opened.map((open) => open.settings)).toEqual([{ displayMode: "overlay", theme: "light", locale: "en" }]);
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
      await reachable(page, page.getByRole("link", { name: "Get Developer access, via sign-in" }), "switch-on Developer action");
      page = await open("switch-on", "/login?next=checkout&offer=observer_access", false);
      await reachable(page, page.getByRole("button", { name: "Continue with Google" }), "sign-in");
      page = await open("today", "/workspace?checkout=observer_access", true);
      const refusal = region(page, "alert", "Checkout is unavailable.");
      await expect(refusal).toBeVisible();
      await expect(refusal).toBeInViewport();
      await reachable(page, refusal, "checkout refusal");
      page = await open("switch-on", "/workspace/settings/usage", true);
      await reachable(page, page.locator("section.billing-card").getByRole("button", { name: "Manage billing" }), "Manage billing");

      await context.close();
    }
  });
});
