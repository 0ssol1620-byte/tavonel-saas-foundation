const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

/*
  The two capability-truth routes, probed where a deployment is what answers.

  Gap matrix L-1: production serves neither `/sources` nor `/api/v1/capabilities` -- both 404 --
  while the integration Preview serves both, and the homepage already promises the surface. A
  route that exists in the repository and not in the deployment is invisible to every unit test
  in it, so the probe belongs in the launch suite, which runs against `PLAYWRIGHT_BASE_URL` when
  one is set and is therefore the only check that can be pointed at Preview or production.

  `e2e/sources.spec.ts` already holds the page's editorial and layout contract. This file is
  deliberately narrower: are the routes served, does the manifest carry the frozen schema
  version, and are the page and the API the same list of MIME types. Nothing else.
*/

const SCHEMA_VERSION = "tavonel.capability_manifest.v1";

type ManifestEntry = { mime: string; status: string };
type Manifest = { schemaVersion: string; defaultStatus: string; entries: ManifestEntry[] };

test("serves the capability manifest under its frozen schema version", async ({ request }) => {
  const response = await request.get("/api/v1/capabilities");
  expect(response.status(), "/api/v1/capabilities is not served by this deployment").toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");

  const manifest = (await response.json()) as Manifest;
  expect(manifest.schemaVersion).toBe(SCHEMA_VERSION);
  expect(manifest.defaultStatus).toBe("UNSUPPORTED");
  expect(manifest.entries.length).toBeGreaterThan(0);
  for (const entry of manifest.entries) {
    expect(entry.mime, "every entry carries a MIME type").toMatch(/^[a-z]+\/[A-Za-z0-9.+-]+$/);
    expect(entry.status, `${entry.mime} carries no support status`).toMatch(/^[A-Z_]{5,}$/);
  }
});

test("serves /sources and names a support status on it", async ({ page }) => {
  const response = await page.goto("/sources");
  expect(response?.status(), "/sources is not served by this deployment").toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const statuses = await page.locator("table.src-matrix .src-tier").allInnerTexts();
  expect(statuses.length, "the page names no source status at all").toBeGreaterThan(0);
  for (const status of statuses) expect(status.trim()).toMatch(/^[A-Z_]{5,}$/);
});

/*
  The same list, or the page is advertising something the deployment does not read.

  Row for row and in order: a page that prints a superset promises a format the upload route
  refuses, and a page that prints a subset hides one it accepts. Both are the failure this
  surface exists to make impossible, and only a deployment can be asked which it is doing.
*/
test("prints exactly the MIME rows the manifest serves", async ({ page }) => {
  const response = await page.request.get("/api/v1/capabilities");
  expect(response.status()).toBe(200);
  const manifest = (await response.json()) as Manifest;

  await page.goto("/sources");
  // The row header prints the MIME type and then the source family, both in an `i`. The first
  // one is the MIME; matching both would compare the page's families against the API's types.
  const printed = (await page
    .locator("table.src-matrix tbody th[scope='row'] > i:first-of-type")
    .allInnerTexts()).map((mime) => mime.trim());

  expect(printed).toEqual(manifest.entries.map((entry) => entry.mime));
});
