const playwrightPackage =
  process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } =
  "test" in playwrightModule ? playwrightModule : playwrightModule.default;

/*
  WO-WS-1: /workspace/ask opened without `collection` and `manifest` asks the server which Worlds
  are active. Several are offered for a choice and none is loaded silently; a failed listing says
  it could not check instead of "No active World yet". Fixture build only; every API is mocked.
  WO-WS-3: until the listing answers the panel says it is checking, and a 401/402/403 is a refusal.
*/

type Route = {
  fulfill: (options: { json?: unknown; status?: number }) => Promise<void>;
  request: () => { url: () => string };
};
type Page = {
  addInitScript: (fn: (arg: { accessToken: string }) => void, arg: { accessToken: string }) => Promise<void>;
  route: (url: string, handler: (route: Route) => Promise<void>) => Promise<void>;
  goto: (url: string) => Promise<unknown>;
  url: () => string;
  getByText: (text: string, options?: { exact?: boolean }) => unknown;
  getByLabel: (text: string) => { selectOption: (value: string) => Promise<unknown> };
  getByRole: (role: string, options: { name: string }) => { click: () => Promise<void> };
};

const first = `collection-${"a".repeat(32)}`;
const second = `collection-${"b".repeat(32)}`;

function token() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: "44444444-4444-4444-4444-444444444444", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.signature`;
}

async function signedInWorkspace(page: Page, listing: { status: number; json: unknown }) {
  await page.addInitScript(({ accessToken }) => {
    const now = Math.floor(Date.now() / 1000);
    localStorage.setItem("sb-test-auth-token", JSON.stringify({
      access_token: accessToken, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: "e2e-refresh-token",
      user: { id: "44444444-4444-4444-4444-444444444444", aud: "authenticated", role: "authenticated", email: "foundation-e2e@example.invalid", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
    }));
  }, { accessToken: token() });
  await page.route("**/api/access/bootstrap", (route) => route.fulfill({ json: { code: "ACCESS_READY", access: { source: "owner", accessPlan: "studio_access", billingExempt: true, expiresAt: null, limits: null, customerDataEnabled: true } } }));
  await page.route("**/api/compile-jobs", (route) => route.fulfill({ json: { code: "OK", jobs: [] } }));
  await page.route("**/api/documents", (route) => route.fulfill({ json: { documents: [] } }));
  await page.route("**/api/billing/status", (route) => route.fulfill({ json: { account: null } }));
  await page.route("**/api/v1/collections?**", (route) => route.fulfill(listing));
}

test("several active Worlds are offered for a choice; none is loaded silently", async ({ page }: { page: Page }) => {
  const opened: string[] = [];
  await signedInWorkspace(page, { status: 200, json: { code: "COLLECTIONS_LISTED", collections: [
    { collectionId: first, manifestDigest: `sha256:${"a".repeat(64)}`, revision: 1, updatedAt: "2026-11-01T00:00:00.000Z" },
    { collectionId: second, manifestDigest: `sha256:${"b".repeat(64)}`, revision: 2, updatedAt: "2026-11-22T00:00:00.000Z" },
  ], page: { limit: 50, cursor: null, nextCursor: null } } });
  await page.route("**/api/collections/collection-*", async (route) => { opened.push(route.request().url()); await route.fulfill({ status: 404, json: { code: "COLLECTION_NOT_FOUND" } }); });
  await page.goto("/workspace/ask");
  await expect(page.getByText("This workspace has 2 active Worlds.")).toBeVisible();
  await expect(page.getByText("No active World yet.")).toHaveCount(0);
  expect(opened).toEqual([]);
  await page.getByLabel("Active World").selectOption(second);
  await page.getByRole("button", { name: "Ask this World" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("collection")).toBe(second);
});

test("a failed listing says it could not check, never 'No active World yet'", async ({ page }: { page: Page }) => {
  await signedInWorkspace(page, { status: 503, json: { code: "WORLD_STORE_READ_FAILED" } });
  await page.goto("/workspace/ask");
  await expect(page.getByText("Active Worlds could not be checked.")).toBeVisible();
  await expect(page.getByText("No active World yet.")).toHaveCount(0);
});

test("a refused listing (403) is worded as a refusal, not an outage", async ({ page }: { page: Page }) => {
  await signedInWorkspace(page, { status: 403, json: { code: "NOT_A_KNOWN_CODE" } });
  await page.goto("/workspace/ask");
  await expect(page.getByText("This session may not list the workspace's active Worlds.")).toBeVisible();
  await expect(page.getByText("Our servers could not complete this.", { exact: false })).toHaveCount(0);
  await expect(page.getByText("No active World yet.")).toHaveCount(0);
});

test("until the listing answers, Ask says it is checking -- never 'No active World yet'", async ({ page }: { page: Page }) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await signedInWorkspace(page, { status: 200, json: { code: "COLLECTIONS_LISTED", collections: [], page: { limit: 50, cursor: null, nextCursor: null } } });
  // Registered last, so it answers first: the listing is held until the assertions below ran.
  await page.route("**/api/v1/collections?**", async (route) => {
    await held;
    await route.fulfill({ status: 200, json: { code: "COLLECTIONS_LISTED", collections: [], page: { limit: 50, cursor: null, nextCursor: null } } });
  });
  await page.goto("/workspace/ask");
  await expect(page.getByText("Checking this workspace for an active World…")).toBeVisible();
  await expect(page.getByText("No active World yet.")).toHaveCount(0);
  release();
  await expect(page.getByText("No active World yet.")).toBeVisible();
});

test("an empty listing keeps 'No active World yet'", async ({ page }: { page: Page }) => {
  await signedInWorkspace(page, { status: 200, json: { code: "COLLECTIONS_LISTED", collections: [], page: { limit: 50, cursor: null, nextCursor: null } } });
  await page.goto("/workspace/ask");
  await expect(page.getByText("No active World yet.")).toBeVisible();
});

test("one active World whose open is refused says it could not be opened", async ({ page }: { page: Page }) => {
  await signedInWorkspace(page, { status: 200, json: { code: "COLLECTIONS_LISTED", collections: [
    { collectionId: first, manifestDigest: `sha256:${"a".repeat(64)}`, revision: 1, updatedAt: "2026-11-01T00:00:00.000Z" },
  ], page: { limit: 50, cursor: null, nextCursor: null } } });
  await page.route("**/api/collections/collection-*", (route) => route.fulfill({ status: 404, json: { code: "COLLECTION_NOT_FOUND" } }));
  await page.goto("/workspace/ask");
  await expect(page.getByText("The active World could not be opened.")).toBeVisible();
  await expect(page.getByText("No active World yet.")).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get("collection")).toBe(first);
});
