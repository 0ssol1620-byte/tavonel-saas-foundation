import { expect, test, type Page, type Request } from "@playwright/test";
import { COOKBOOK_SLUGS, RECIPE_VERSION } from "../lib/cookbook-slugs";
import { installFixtureSession, installWorkspaceRoutes } from "./fixtures/workspace-fixture";

/*
  X08 / UX10 / UX21 -- content -> sign-in -> the same task, driven in a browser.

  The unit suite (`lib/recipe-intent.test.ts`) pins the precedence function and the SSR render of
  the continuation; neither can run the `useEffect` branches in `app/login/page.tsx` and
  `app/auth/callback/page.tsx` that decide whether a page redirects, renders the continuation or
  consumes the stored intent. This file does, with the fixtures the workspace specs already use:

    - the signed-in state is `installFixtureSession` -- an unsigned local JWT under the storage key
      of the e2e Supabase URL. It is a labelled fixture: no provider account, no Google round trip,
      no production auth. The OAuth hop itself is NOT exercised: the provider's authorize endpoint
      on the non-existent `test.supabase.co` is a local stub (`stubProvider`), and the callback is
      entered with the session already present, which is the state the provider leaves behind.
    - `/api/status/v2` and `/api/access/bootstrap` are fulfilled locally, as in
      `login-capability.spec.ts` and `workspace-fixture.ts`.
    - every redirect into `/workspace` is fulfilled with a stub document, so the assertion is the
      destination the sign-in pages chose and nothing downstream -- in particular no checkout
      script, no upload and no compile can start.

  Imported from `lib/cookbook-slugs.ts` rather than `lib/recipe-intent.ts`: the slug module has no
  imports of its own, so this spec does not depend on the `@/` alias resolving under Playwright.
  The URL is spelled with `URLSearchParams` in the shape `loginUrlForRecipe` writes, which
  `lib/recipe-intent.test.ts` pins exactly.
*/

const RECIPE = COOKBOOK_SLUGS[0]; // documents-to-grounded-work -> /workspace/sources
const NO_START = "portable-package-local-ai"; // RECIPE_START is null for this one
const DEVELOPER = "connect-external-ai-mcp-api"; // -> /workspace/developer
const INTENT_KEY = "tavonel.recipe-intent";
const CHECKOUT_KEY = "tavonel.checkout-intent";
const FUNNEL_LOG = "tavonel.funnel-log";

function recipeLogin(recipe: string, { v = RECIPE_VERSION, returnTo = `/cookbooks/${recipe}` } = {}) {
  return `/login?${new URLSearchParams({ next: "recipe", recipe, v, returnTo }).toString()}`;
}

const statusV2 = (compileCustomerDocuments: boolean) => ({
  schemaVersion: "tavonel.public_status.v2",
  service: { name: "TAVONEL", state: "not_assessed", commercialMode: "live" },
  availableActions: {
    readPublicWorld: { enabled: true, href: "/explore", reason: "Public World is available." },
    requestPilot: { enabled: true, href: "/contact", reason: "A pilot can be requested." },
    signIn: { enabled: true, href: "/login", reason: "Sign-in state." },
    createAccount: { enabled: false, href: "/contact", reason: "Account state." },
    purchasePlan: { enabled: false, href: "/contact", reason: "Purchase state." },
    compileCustomerDocuments: {
      enabled: compileCustomerDocuments,
      href: compileCustomerDocuments ? "/workspace" : "/contact",
      reason: "Compilation state.",
    },
  },
  checkedAt: "2026-09-20T00:00:00.000Z",
  evidenceFreshness: { basis: "configuration_snapshot", operationalProbe: "not_included" },
});

/** Status, a stub workspace document, and a log of every write the page attempts. */
async function prepare(page: Page, { processing = true } = {}) {
  await page.route("**/api/status/v2", (route) => route.fulfill({ json: statusV2(processing) }));
  await page.route((url) => /^\/workspace(\/|$)/.test(url.pathname), (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><title>workspace stub</title><main>workspace stub</main>",
  }));
  const writes: string[] = [];
  page.on("request", (request: Request) => {
    const url = new URL(request.url());
    if (request.method() !== "GET" && url.pathname.startsWith("/api/") && url.pathname !== "/api/access/bootstrap") {
      writes.push(`${request.method()} ${url.pathname}`);
    }
  });
  return writes;
}

/** Seeds sessionStorage once per tab, so a later navigation does not re-seed what was consumed. */
async function seedSessionStorageOnce(page: Page, entries: Record<string, string>) {
  await page.addInitScript((seed) => {
    if (sessionStorage.getItem("e2e.seeded") === "1") return;
    for (const [key, value] of Object.entries(seed)) sessionStorage.setItem(key, value);
    sessionStorage.setItem("e2e.seeded", "1");
  }, entries);
}

/*
  STUBBED PROVIDER. `test.supabase.co` is the e2e project URL from `playwright.config.ts` and does
  not exist. `signInWithOAuth` sends the window to its `/auth/v1/authorize` endpoint, which is
  fulfilled here with a local page: no Google, no credentials, no token. Every document request to
  it is counted, which is how a duplicate OAuth navigation would show up.
*/
async function stubProvider(page: Page) {
  const authorize: string[] = [];
  await page.route("https://test.supabase.co/auth/v1/authorize**", (route) => {
    authorize.push(route.request().url());
    return route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>provider stub</title><main>provider stub: no real sign-in happens here</main>",
    });
  });
  return authorize;
}

/** Counts the access bootstrap POSTs the callback makes; fulfilled by `installWorkspaceRoutes`. */
function countBootstraps(page: Page) {
  const calls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/access/bootstrap") calls.push(request.method());
  });
  return calls;
}

const stored = (page: Page, key: string) => page.evaluate((k) => sessionStorage.getItem(k), key);
const funnelLog = async (page: Page) => JSON.parse((await stored(page, FUNNEL_LOG)) ?? "[]") as Record<string, string>[];
const intentJson = (recipe: string) =>
  JSON.stringify({ recipeId: recipe, recipeVersion: RECIPE_VERSION, returnTo: `/cookbooks/${recipe}` });

test.describe("recipe continuation across sign-in", () => {
  test("signed out: the recipe is held, sign-in is offered, nothing continues yet", async ({ page }) => {
    const writes = await prepare(page);
    await page.goto(recipeLogin(RECIPE));
    await expect(page.getByRole("heading", { level: 1, name: "One step before you run this." })).toBeVisible();
    await expect(page.getByText("Your recipe is kept for you.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
    await expect(page.getByRole("link", { name: "Choose your documents" })).toHaveCount(0);
    expect(JSON.parse((await stored(page, INTENT_KEY)) ?? "null")).toEqual(JSON.parse(intentJson(RECIPE)));
    await expect.poll(async () => (await funnelLog(page)).filter((entry) => entry.event === "login_reached_with_intent"))
      .toEqual([{ event: "login_reached_with_intent", kind: "recipe" }]);
    expect(writes).toEqual([]);
  });

  test("already signed in: continues the same recipe with one explicit link, and consumes the intent", async ({ page }) => {
    await installFixtureSession(page);
    const writes = await prepare(page, { processing: true });
    const url = recipeLogin(RECIPE);
    await page.goto(url);
    await expect(page.getByRole("heading", { level: 1, name: "Continue your recipe." })).toBeVisible();
    await expect(page.getByText("You are signed in, and nothing has run.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Choose your documents" })).toHaveAttribute("href", "/workspace/sources");
    await expect(page.getByRole("link", { name: "Back to the recipe" })).toHaveAttribute("href", `/cookbooks/${RECIPE}`);
    await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
    await expect(page.locator("main form, main input[type=file]")).toHaveCount(0);
    // Not redirected (no loop, no empty workspace), and the stored copy is gone.
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(url);
    expect(await stored(page, INTENT_KEY)).toBeNull();
    // The continuation is not counted as a second arrival, and nothing identifying was logged.
    const log = await funnelLog(page);
    expect(log.filter((entry) => entry.event === "login_reached_with_intent")).toEqual([]);
    expect(JSON.stringify(log)).not.toContain(RECIPE);
    expect(writes, "nothing uploads, compiles, activates or charges on the way in").toEqual([]);
  });

  test("already signed in, customer processing closed: offers the workspace and says why", async ({ page }) => {
    await installFixtureSession(page);
    await prepare(page, { processing: false });
    await page.goto(recipeLogin(RECIPE));
    await expect(page.getByText("not open on this deployment yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open your workspace" })).toHaveAttribute("href", "/workspace");
    await expect(page.getByRole("link", { name: "Choose your documents" })).toHaveCount(0);
  });

  test("already signed in: a recipe with no start control says so; the developer recipe opens its page", async ({ page }) => {
    await installFixtureSession(page);
    await prepare(page, { processing: true });
    await page.goto(recipeLogin(NO_START));
    await expect(page.getByText("no starting control in the workspace yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open your workspace" })).toHaveAttribute("href", "/workspace");
    await page.goto(recipeLogin(DEVELOPER));
    await expect(page.getByRole("link", { name: "Open the developer page" })).toHaveAttribute("href", "/workspace/developer");
  });

  for (const [name, url] of [
    ["stale version", recipeLogin(RECIPE, { v: "2026-01-01" })],
    ["unknown recipe", recipeLogin("not-a-recipe")],
    ["off-list returnTo", recipeLogin(RECIPE, { returnTo: "//evil.example" })],
    ["absolute returnTo", recipeLogin(RECIPE, { returnTo: "https://evil.example/cookbooks/x" })],
  ] as const) {
    test(`already signed in, ${name}: falls closed to the workspace, never off-site`, async ({ page }) => {
      await installFixtureSession(page);
      await prepare(page);
      await page.goto(url);
      await expect(page).toHaveURL(/\/workspace$/);
      expect(new URL(page.url()).hostname).not.toContain("evil.example");
      await expect(page.getByText("workspace stub")).toBeVisible();
    });
  }

  test("already signed in: a held checkout keeps precedence over the recipe", async ({ page }) => {
    await installFixtureSession(page);
    await seedSessionStorageOnce(page, { [CHECKOUT_KEY]: "observer_access" });
    await prepare(page);
    await page.goto(recipeLogin(RECIPE));
    await expect(page).toHaveURL(/\/workspace\?checkout=observer_access$/);
    expect(await stored(page, INTENT_KEY), "the losing recipe is consumed too").toBeNull();
  });

  test("callback after a fresh sign-in: resumes to the continuation once, and a reload replays nothing", async ({ page }) => {
    await installFixtureSession(page);
    await installWorkspaceRoutes(page, { accessSource: "trial" });
    await seedSessionStorageOnce(page, { [INTENT_KEY]: intentJson(RECIPE) });
    const writes = await prepare(page, { processing: true });
    await page.goto("/auth/callback");
    await expect(page).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("recipe") === RECIPE);
    await expect(page.getByRole("heading", { level: 1, name: "Continue your recipe." })).toBeVisible();
    expect(await stored(page, INTENT_KEY)).toBeNull();
    const signedIn = (await funnelLog(page)).filter((entry) => entry.event === "signed_in");
    expect(signedIn).toEqual([{ event: "signed_in", mode: "resume-recipe" }]);

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Continue your recipe." })).toBeVisible();
    expect(new URL(page.url()).pathname, "the continuation never redirects itself").toBe("/login");
    expect(await stored(page, INTENT_KEY)).toBeNull();
    expect(writes).toEqual([]);
  });

  /*
    Wait for the landing page's settled state, not only its URL, before reading storage.

    For the owner, the callback consumes both intents and replaces to `/login?next=recipe…`. That
    page's effect re-stores the recipe from its own URL synchronously on mount, then confirms the
    session asynchronously and consumes it again in the same step that renders the continuation.
    Between the URL change and that render the key is legitimately present, so a read right after
    `toHaveURL` raced the page (the 1440 run failed both attempts at exactly that read). The
    continuation heading is the observable signal that the signed-in branch has run.

    For the paying account the landing page is the static workspace stub, which runs no script;
    its visible text is the signal that the navigation committed and `page.evaluate` is reading
    the right document.
  */
  for (const [accessSource, expected, wins, settled] of [
    ["trial", /\/workspace\?checkout=observer_access$/, "checkout wins", "workspace stub"],
    ["owner", /\/login\?next=recipe&/, "the recipe wins for a billing-exempt owner", "Continue your recipe."],
  ] as const) {
    test(`callback with both intents held, ${accessSource}: ${wins}, and both are consumed`, async ({ page }) => {
      await installFixtureSession(page);
      await installWorkspaceRoutes(page, { accessSource });
      await seedSessionStorageOnce(page, { [CHECKOUT_KEY]: "observer_access", [INTENT_KEY]: intentJson(RECIPE) });
      const writes = await prepare(page);
      await page.goto("/auth/callback");
      await expect(page).toHaveURL(expected);
      if (accessSource === "owner") {
        await expect(page.getByRole("heading", { level: 1, name: settled })).toBeVisible();
        await expect(page.getByRole("link", { name: "Choose your documents" })).toHaveAttribute("href", "/workspace/sources");
        expect(new URL(page.url()).searchParams.has("checkout"), "an owner never reaches checkout").toBe(false);
      } else {
        await expect(page.getByText(settled)).toBeVisible();
      }
      expect(await stored(page, INTENT_KEY)).toBeNull();
      expect(await stored(page, CHECKOUT_KEY)).toBeNull();
      expect(writes, "no write is started on either side of the precedence").toEqual([]);
    });
  }

  /*
    Site data blocked, simulated the way a browser that blocks it behaves: touching
    `sessionStorage` throws a SecurityError. Supabase keeps its session in localStorage, so the
    fixture session is unaffected and the signed-in half still has a session to find.
  */
  const blockSessionStorage = () => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() { throw new DOMException("blocked", "SecurityError"); },
    });
  };

  test("storage blocked, signed out: says the recipe is not held, and sign-in still works", async ({ page }) => {
    await page.addInitScript(blockSessionStorage);
    await prepare(page);
    await page.goto(recipeLogin(RECIPE));
    await expect(page.getByText("This browser is not keeping site data.")).toBeVisible();
    await expect(page.getByText("Your recipe is kept for you.")).toHaveCount(0);
    await expect(page.getByText("Where you land.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  });

  test("storage blocked, already signed in: still continues the recipe from its URL", async ({ page }) => {
    await installFixtureSession(page);
    await page.addInitScript(blockSessionStorage);
    await prepare(page);
    await page.goto(recipeLogin(RECIPE));
    await expect(page.getByRole("heading", { level: 1, name: "Continue your recipe." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Choose your documents" })).toHaveAttribute("href", "/workspace/sources");
  });
});

/*
  Interruption, duplicate actions and return navigation.

  The provider is the stub above; the signed-in state is the fixture session. Nothing here asserts
  what Google does -- only what TAVONEL's own pages do before and after the hop.
*/
test.describe("recipe continuation: interruption, duplicates and return navigation", () => {
  test("back to the recipe: lands on the closed original page, and re-entry continues again", async ({ page }) => {
    await installFixtureSession(page);
    const writes = await prepare(page);
    const continuationUrl = recipeLogin(RECIPE);
    await page.goto(continuationUrl);
    await expect(page.getByRole("heading", { level: 1, name: "Continue your recipe." })).toBeVisible();
    expect(await stored(page, INTENT_KEY)).toBeNull();

    await page.getByRole("link", { name: "Back to the recipe" }).click();
    await expect(page).toHaveURL((url) => url.pathname === `/cookbooks/${RECIPE}` && url.search === "");
    await expect(page.getByRole("link", { name: "Start this recipe" })).toBeVisible();
    expect(await stored(page, INTENT_KEY), "returning to the recipe re-stores nothing").toBeNull();

    // Browser Back re-renders the continuation from its URL: no redirect, no stored replay.
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "Continue your recipe." })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/login");
    expect(await stored(page, INTENT_KEY)).toBeNull();

    // Forward to the cookbook and start again: a signed-in reader continues, not an empty workspace.
    await page.goForward();
    await page.getByRole("link", { name: "Start this recipe" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("recipe") === RECIPE);
    await expect(page.getByRole("heading", { level: 1, name: "Continue your recipe." })).toBeVisible();
    expect(await stored(page, INTENT_KEY)).toBeNull();
    expect(writes).toEqual([]);
  });

  test("back to the recipe keeps a non-cookbook return path from the closed list", async ({ page }) => {
    await installFixtureSession(page);
    await prepare(page);
    await page.goto(recipeLogin(RECIPE, { returnTo: "/resources" }));
    const back = page.getByRole("link", { name: "Back to the recipe" });
    await expect(back).toHaveAttribute("href", "/resources");
    await back.click();
    await expect(page).toHaveURL((url) => url.pathname === "/resources");
    expect(await stored(page, INTENT_KEY)).toBeNull();
  });

  test("interrupted sign-in: leaving the stubbed provider returns to the same intent, with nothing started", async ({ page }) => {
    const writes = await prepare(page);
    const authorize = await stubProvider(page);
    await page.goto(recipeLogin(RECIPE));
    const origin = new URL(page.url()).origin;
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page).toHaveURL(/^https:\/\/test\.supabase\.co\/auth\/v1\/authorize/);
    expect(authorize).toHaveLength(1);
    // The provider is handed the fixed callback and nothing of the recipe: the intent stays in this tab.
    const sent = new URL(authorize[0]!);
    expect(sent.searchParams.get("provider")).toBe("google");
    expect(sent.searchParams.get("redirect_to")).toBe(`${origin}/auth/callback`);
    expect(authorize[0]).not.toMatch(/recipe|returnTo|cookbooks|workspace/i);

    // The reader abandons the provider and comes back.
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "One step before you run this." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" }), "not stuck on Opening Google").toBeEnabled();
    expect(await stored(page, INTENT_KEY)).toBe(intentJson(RECIPE));
    await expect(page.getByRole("link", { name: "Choose your documents" })).toHaveCount(0);
    expect(authorize, "coming back does not start the provider hop again by itself").toHaveLength(1);
    expect(writes).toEqual([]);
  });

  test("abandoned at the provider: the callback fails visibly, keeps the intent, and a retry resumes it once", async ({ page }) => {
    await seedSessionStorageOnce(page, { [INTENT_KEY]: intentJson(RECIPE) });
    const writes = await prepare(page);
    const bootstraps = countBootstraps(page);
    // No fixture session yet: the provider returned without one.
    await page.goto("/auth/callback?error_code=access_denied");
    await expect(page.getByRole("heading", { level: 1, name: "Sign-in did not complete." })).toBeVisible();
    await expect(page.getByText("Reference: ACCESS_DENIED")).toBeVisible();
    expect(new URL(page.url()).pathname, "a failed callback redirects nowhere").toBe("/auth/callback");
    expect(await stored(page, INTENT_KEY), "a failure does not consume the intent").toBe(intentJson(RECIPE));
    expect((await funnelLog(page)).filter((entry) => entry.event === "signed_in")).toEqual([]);
    expect(bootstraps).toEqual([]);

    // The retry succeeds (fixture session from here on) and resumes the same recipe, once.
    await installFixtureSession(page);
    await installWorkspaceRoutes(page, { accessSource: "trial" });
    await page.goto("/auth/callback");
    await expect(page).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("recipe") === RECIPE);
    await expect(page.getByRole("heading", { level: 1, name: "Continue your recipe." })).toBeVisible();
    expect(await stored(page, INTENT_KEY)).toBeNull();
    expect(writes).toEqual([]);
  });

  test("duplicate sign-in click: one stubbed provider navigation, one held intent", async ({ page }) => {
    const writes = await prepare(page);
    const authorize = await stubProvider(page);
    await page.goto(recipeLogin(RECIPE));
    const origin = new URL(page.url()).origin;
    const button = page.getByRole("button", { name: "Continue with Google" });
    await expect(button).toBeEnabled();
    // Two real input events, as a reader produces them -- not two calls inside one script task.
    await button.dblclick();
    await expect(page).toHaveURL(/^https:\/\/test\.supabase\.co\/auth\/v1\/authorize/);
    expect(authorize, "the second click must not start a second OAuth navigation").toHaveLength(1);

    /*
      The origin boundary. sessionStorage is partitioned per origin (and per tab): while this tab
      shows the stubbed provider, `page.evaluate` runs in https://test.supabase.co and would read
      that origin's empty storage, not TAVONEL's. So the held intent is read after the same tab
      returns to TAVONEL's own origin -- on /privacy, a route that neither reads nor writes the
      recipe intent. Returning to /login instead would prove nothing, because /login re-stores the
      intent from its own URL on load.
    */
    await page.goto(`${origin}/privacy`);
    expect(new URL(page.url()).origin).toBe(origin);
    expect(await stored(page, INTENT_KEY), "the intent held before the hop is still held, once").toBe(intentJson(RECIPE));
    expect(authorize, "returning starts no further OAuth navigation").toHaveLength(1);
    expect(writes).toEqual([]);
  });

  test("a reopened callback finds nothing left to resume, and opens the workspace", async ({ page }) => {
    await installFixtureSession(page);
    await installWorkspaceRoutes(page, { accessSource: "trial" });
    await seedSessionStorageOnce(page, { [INTENT_KEY]: intentJson(RECIPE) });
    const writes = await prepare(page);
    await page.goto("/auth/callback");
    await expect(page.getByRole("heading", { level: 1, name: "Continue your recipe." })).toBeVisible();

    await page.goto("/auth/callback");
    await expect(page).toHaveURL(/\/workspace$/);
    const modes = (await funnelLog(page)).filter((entry) => entry.event === "signed_in").map((entry) => entry.mode);
    expect(modes).toEqual(["resume-recipe", "workspace"]);
    expect(writes).toEqual([]);
  });

  /*
    Access check failed after a valid session: the page's own "Try again" control.

    Before, that control was a link to /login, and /login with a valid session consumed the held
    recipe and opened /workspace without it. These cases click the real control. The first
    `/api/access/bootstrap` is made to fail (a network abort, or a 503 with a code); the routes
    registered later win in Playwright, and `route.fallback()` hands every later request back to
    `installWorkspaceRoutes`' success response. The second request is held on a promise, released
    only after the in-flight state has been observed, so no sleep decides the order.
  */
  async function failFirstBootstrap(page: Page, failure: "abort" | "503") {
    let seen = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/access/bootstrap", async (route) => {
      seen += 1;
      if (seen === 1) {
        return failure === "abort"
          ? route.abort("connectionrefused")
          : route.fulfill({ status: 503, json: { code: "ACCESS_BOOTSTRAP_UNAVAILABLE" } });
      }
      await held;
      return route.fallback();
    });
    return release;
  }

  test("access check fails, the real Try again retries it here, and the same recipe continues once", async ({ page }) => {
    await installFixtureSession(page);
    await installWorkspaceRoutes(page, { accessSource: "trial" });
    const release = await failFirstBootstrap(page, "abort");
    await seedSessionStorageOnce(page, { [INTENT_KEY]: intentJson(RECIPE) });
    const writes = await prepare(page);
    const bootstraps = countBootstraps(page);

    await page.goto("/auth/callback");
    await expect(page.getByRole("heading", { level: 1, name: "Workspace access needs attention." })).toBeVisible();
    await expect(page.getByText("Reference: ACCESS_BOOTSTRAP_UNAVAILABLE")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/auth/callback");
    expect(await stored(page, INTENT_KEY), "a failed access check consumes nothing").toBe(intentJson(RECIPE));
    expect((await funnelLog(page)).filter((entry) => entry.event === "signed_in")).toEqual([]);
    // The recovery is a control on this page, not the old link to /login.
    await expect(page.getByRole("link", { name: "Try again" })).toHaveCount(0);

    await page.getByRole("button", { name: "Try again" }).click();
    const checking = page.getByRole("button", { name: "Checking access…" });
    await expect(checking).toBeDisabled();
    await expect(checking).toHaveAttribute("aria-busy", "true");
    await expect(page.getByText("Checking workspace access again.")).toBeVisible();
    // A second press while the check runs reaches no handler: a disabled button dispatches no click.
    await checking.click({ force: true });
    expect(await stored(page, INTENT_KEY), "still held while the retry is in flight").toBe(intentJson(RECIPE));

    release();
    await expect(page).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("recipe") === RECIPE);
    await expect(page.getByRole("heading", { level: 1, name: "Continue your recipe." })).toBeVisible();
    expect(await stored(page, INTENT_KEY)).toBeNull();
    const modes = (await funnelLog(page)).filter((entry) => entry.event === "signed_in").map((entry) => entry.mode);
    expect(modes, "signed in once, on the attempt that succeeded").toEqual(["resume-recipe"]);
    expect(bootstraps, "one failed check and one retry -- the forced second press added none").toHaveLength(2);
    expect(writes).toEqual([]);
  });

  for (const [accessSource, expected, mode] of [
    ["trial", /\/workspace\?checkout=observer_access$/, "resume-checkout"],
    ["owner", /\/login\?next=recipe&/, "resume-recipe"],
  ] as const) {
    test(`access check fails with both intents held, ${accessSource}: Try again keeps both until the precedence applies once`, async ({ page }) => {
      await installFixtureSession(page);
      await installWorkspaceRoutes(page, { accessSource });
      const release = await failFirstBootstrap(page, "503");
      await seedSessionStorageOnce(page, { [CHECKOUT_KEY]: "observer_access", [INTENT_KEY]: intentJson(RECIPE) });
      const writes = await prepare(page);
      const bootstraps = countBootstraps(page);

      await page.goto("/auth/callback");
      await expect(page.getByText("Reference: ACCESS_BOOTSTRAP_UNAVAILABLE")).toBeVisible();
      expect(await stored(page, CHECKOUT_KEY)).toBe("observer_access");
      expect(await stored(page, INTENT_KEY)).toBe(intentJson(RECIPE));

      await page.getByRole("button", { name: "Try again" }).click();
      await expect(page.getByRole("button", { name: "Checking access…" })).toBeDisabled();
      release();
      await expect(page).toHaveURL(expected);
      // Settled state before reading storage (see the owner race note above).
      if (accessSource === "owner") {
        await expect(page.getByRole("heading", { level: 1, name: "Continue your recipe." })).toBeVisible();
      } else {
        await expect(page.getByText("workspace stub")).toBeVisible();
      }
      expect(await stored(page, CHECKOUT_KEY)).toBeNull();
      expect(await stored(page, INTENT_KEY)).toBeNull();
      const modes = (await funnelLog(page)).filter((entry) => entry.event === "signed_in").map((entry) => entry.mode);
      expect(modes).toEqual([mode]);
      expect(bootstraps).toHaveLength(2);
      expect(writes).toEqual([]);
    });
  }

  /*
    Leaving while the retry is in flight.

    "Back to the site" is a client navigation (both routes share the root layout), so the held
    request is not aborted: its answer still reaches the old page's code after the reader is on
    Home. Before the lifetime guard, that late answer took both intents, logged `signed_in` and
    replaced Home with the precedence destination.

    The barrier is the bootstrap body read, counted by wrapping `Response.prototype.json` in the
    test page. The callback awaits that read and decides in the same microtask checkpoint, so
    once the second read has settled, `waitForFunction` -- which evaluates in a later task -- can
    only run after the late attempt has either acted or stopped. No sleep decides it, and the
    product code is not touched: the wrapper returns the same parsed body.
  */
  const countBootstrapBodyReads = () => {
    const read = Response.prototype.json;
    const counter = window as unknown as { __bootstrapBodiesRead: number };
    counter.__bootstrapBodiesRead = 0;
    Response.prototype.json = function json(this: Response) {
      const body = read.call(this);
      if (new URL(this.url).pathname !== "/api/access/bootstrap") return body;
      return body.finally(() => { counter.__bootstrapBodiesRead += 1; });
    };
  };

  test("access check fails, the reader leaves while Try again is in flight, and the late answer does nothing", async ({ page }) => {
    await installFixtureSession(page);
    await installWorkspaceRoutes(page, { accessSource: "trial" });
    const release = await failFirstBootstrap(page, "503");
    await seedSessionStorageOnce(page, { [CHECKOUT_KEY]: "observer_access", [INTENT_KEY]: intentJson(RECIPE) });
    await page.addInitScript(countBootstrapBodyReads);
    const writes = await prepare(page);
    const bootstraps = countBootstraps(page);
    const documents: string[] = [];
    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(new URL(request.url()).pathname);
    });

    await page.goto("/auth/callback");
    await expect(page.getByText("Reference: ACCESS_BOOTSTRAP_UNAVAILABLE")).toBeVisible();

    // The retry's request is on the wire and held before the reader leaves.
    const retried = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/access/bootstrap");
    await page.getByRole("button", { name: "Try again" }).click();
    await retried;
    await expect(page.getByRole("button", { name: "Checking access…" })).toBeDisabled();

    await page.getByRole("link", { name: "Back to the site" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/");
    await expect(page.locator("h1#lv2-hero-title")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1, name: "Workspace access needs attention." })).toHaveCount(0);

    // Release the held success, and wait until the callback's code has read it on this page.
    release();
    await page.waitForFunction(() => (window as unknown as { __bootstrapBodiesRead: number }).__bootstrapBodiesRead === 2);

    expect(new URL(page.url()).pathname, "the late answer redirects nowhere").toBe("/");
    await expect(page.locator("h1#lv2-hero-title")).toHaveCount(1);
    expect(await stored(page, CHECKOUT_KEY), "the late answer consumes nothing").toBe("observer_access");
    expect(await stored(page, INTENT_KEY)).toBe(intentJson(RECIPE));
    expect((await funnelLog(page)).filter((entry) => entry.event === "signed_in")).toEqual([]);
    expect(bootstraps).toHaveLength(2);
    expect(documents, "Home was a client navigation, and nothing replaced it").toEqual(["/auth/callback"]);
    expect(writes).toEqual([]);
  });

  test("double-clicking the continuation link only navigates; it starts no work", async ({ page }) => {
    await installFixtureSession(page);
    const writes = await prepare(page, { processing: true });
    await page.goto(recipeLogin(RECIPE));
    await page.getByRole("link", { name: "Choose your documents" }).dblclick();
    await expect(page).toHaveURL(/\/workspace\/sources$/);
    await expect(page.getByText("workspace stub")).toBeVisible();
    expect(await stored(page, INTENT_KEY)).toBeNull();
    // A link is a GET navigation; choosing, quoting and confirming files are separate workspace steps.
    expect(writes).toEqual([]);
  });
});
