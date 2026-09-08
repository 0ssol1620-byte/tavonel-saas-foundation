const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

/*
  The two capability-truth routes, probed against a deployment when PLAYWRIGHT_BASE_URL is set.

  Gap matrix L-1: production serves neither `/sources` nor `/api/v1/capabilities` -- both 404 --
  while the integration Preview serves both, and the homepage already promises the surface. A
  route that exists in the repository and not in the deployment is invisible to every unit test
  in it, so the probe belongs in the launch suite: it is the only suite that can be pointed at a
  deployment at all.

  What that means for what a green run proves. `.github/workflows/launch-qa.yml` sets no
  PLAYWRIGHT_BASE_URL, so in CI `playwright.config.ts` starts `pnpm build && pnpm start` and this
  file probes that local server -- it says the routes are served by a production build of these
  files, and nothing whatever about tavonel.com. Only a run with PLAYWRIGHT_BASE_URL pointed at a
  deployment answers L-1, and until such a run exists L-1 stays IMPLEMENTED_NOT_LIVE.

  `e2e/sources.spec.ts` already holds the page's editorial and layout contract. This file is
  deliberately narrower: are the routes served, does the manifest carry the frozen schema
  version, and are the page and the API the same list of MIME types and statuses. Nothing else.
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

  Row for row: a page that prints a superset promises a format the upload route refuses, and a
  page that prints a subset hides one it accepts. Both are the failure this surface exists to
  make impossible, and only a deployment can be asked which it is doing.

  No longer in the manifest's order, as of 2026-09-08. That order is the order formats were
  added to the intake whitelist -- a fact about this repository's history -- and §14.3 asks for
  the most common first, so `SourceCapabilityTable` sorts by source family before rendering.
  Positional equality was asserting two things at once: that the sets match, and that nothing
  had been reordered. The second was incidental, and is now wrong on purpose.

  The pairing is therefore asserted directly, which is stricter than the two ordered lists it
  replaces rather than looser: "this MIME under this tier" survives any reordering of the rows,
  where two separately-ordered arrays agree even if every row swapped its tier with its
  neighbour's, so long as both lists shifted together.
*/
test("prints exactly the MIME rows the manifest serves", async ({ page }) => {
  const response = await page.request.get("/api/v1/capabilities");
  expect(response.status()).toBe(200);
  const manifest = (await response.json()) as Manifest;

  await page.goto("/sources");
  /*
    Each row prints its MIME type and then its source family, both in an `i`; the first is the
    MIME, and matching both would compare the page's families against the API's types. Reading
    the tier from inside the same row is what binds them: `tbody` alone keeps the legend's own
    .src-tier chips out, and the row scope keeps a tier from being paired with another row's
    format.
  */
  const rows = page.locator("table.src-matrix tbody tr");
  const rowCount = await rows.count();
  const printed: string[] = [];
  for (let index = 0; index < rowCount; index += 1) {
    const row = rows.nth(index);
    const mime = (await row.locator("th[scope='row'] > i").first().innerText()).trim();
    const tier = (await row.locator(".src-tier").first().innerText()).trim();
    printed.push(`${mime} ${tier}`);
  }

  expect(printed.sort()).toEqual(
    manifest.entries.map((entry) => `${entry.mime} ${entry.status}`).sort(),
  );
});
