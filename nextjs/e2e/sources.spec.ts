const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

/*
  /sources, in a browser.

  The unit tests hold the manifest and its derivations. What only a browser can answer is
  whether the page and the API are actually the same list -- the whole point of the ticket is
  that the website cannot say yes while the backend says no, and a page that renders a
  hard-coded table would pass every unit test in the repository.

  So the assertions below read the API first and then require the page to match it row for row.
*/

const TIERS = [
  "VERIFIED_NATIVE",
  "VERIFIED_HYBRID",
  "BEST_EFFORT",
  "METADATA_ONLY",
  "REVIEW_REQUIRED",
  "UNSUPPORTED",
];

type ManifestEntry = { mime: string; status: string; qualificationReceipt: string | null };

async function manifest(page: { request: { get(url: string): Promise<{ ok(): boolean; json(): Promise<unknown> }> } }) {
  const response = await page.request.get("/api/v1/capabilities");
  expect(response.ok()).toBe(true);
  return (await response.json()) as { entries: ManifestEntry[]; contentSha256: string; defaultStatus: string };
}

test("prints the same capability manifest the API serves", async ({ page }) => {
  const served = await manifest(page);
  expect(served.defaultStatus).toBe("UNSUPPORTED");
  expect(served.contentSha256).toMatch(/^sha256:[0-9a-f]{64}$/);

  await page.goto("/sources");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("can actually read");

  const rows = page.locator("table.src-matrix tbody tr");
  await expect(rows).toHaveCount(served.entries.length);

  for (const entry of served.entries) {
    await expect(
      page.locator("table.src-matrix tbody i").filter({ hasText: entry.mime }),
      `${entry.mime} is served by the API and missing from the page`,
    ).toHaveCount(1);
  }

  // Every chip is one of the six frozen tiers, and every chip on the page is one the API sent.
  const chips = await page.locator("table.src-matrix .src-tier").allInnerTexts();
  expect(chips).toHaveLength(served.entries.length);
  for (const chip of chips) expect(TIERS).toContain(chip.trim());
  expect(chips.map((chip) => chip.trim())).toEqual(served.entries.map((entry) => entry.status));
});

test("shows no verified tier while no format carries a qualification receipt", async ({ page }) => {
  const served = await manifest(page);
  expect(
    served.entries.filter((entry) => entry.qualificationReceipt !== null),
    "this expectation flips in the commit that lands the first qualification receipt",
  ).toHaveLength(0);

  await page.goto("/sources");
  const table = page.locator("table.src-matrix");
  await expect(table.locator(".src-tier[data-token='verified']")).toHaveCount(0);
  await expect(table).not.toContainText("VERIFIED_NATIVE");
  await expect(table).not.toContainText("VERIFIED_HYBRID");

  // The legend still explains the tiers nothing has reached; the state line says why.
  await expect(page.locator(".src-legend")).toContainText("VERIFIED_NATIVE");
  await expect(page.locator("main")).toContainText("No format on this deployment carries a qualification receipt.");
});

test("states the refusal rule once and claims nothing it cannot support", async ({ page }) => {
  await page.goto("/sources");
  await expect(page.locator(".src-refusal")).toHaveText("Formats not listed are refused at upload.");

  const body = (await page.locator("main").innerText()).toLowerCase().replace(/\s+/g, " ");
  for (const barred of [
    "supports every file",
    "all files",
    "perfect parsing",
    "best ocr",
    "never stale",
    "always current",
    "industry-leading",
    "100% accurate",
  ]) {
    expect(body, `"${barred}" has no place on a support matrix`).not.toContain(barred);
  }
  expect(body, "a percentage here would be a number with no receipt").not.toMatch(/\d+(\.\d+)?\s*%/);
});

test("carries no empty structural cell and never overflows its viewport", async ({ page }) => {
  await page.goto("/sources");
  const result = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    width: window.innerWidth,
    empty: Array.from(document.querySelectorAll("td, th, .src-legend > div"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 100 && rect.height > 40 && (element.textContent ?? "").trim().length === 0;
      }).length,
  }));
  expect(result.overflow, `/sources overflows at ${result.width}px`).toBeLessThanOrEqual(1);
  expect(result.empty, "/sources contains an empty structural cell").toBe(0);
});

/*
  An eighth primary link is a header measurement, not a data change.

  `tavonel.css` swaps the section row for the phone disclosure at 1079px because the seven-link
  row pushed the primary action past the right edge up to 1076px, and `overflow-x: hidden` hid
  it from every document-overflow check. 1080px is the first width that shows the row, so it is
  where a link added to `PRIMARY_NAV` gets measured. This test fails if the row stops fitting,
  which is the only honest way to add to it.
*/
test("keeps the header's primary action reachable at the width the section row appears", async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 900 });
  await page.goto("/sources");
  const actions = page.locator("header.nav .nav-actions");
  await expect(actions).toBeVisible();
  const box = await actions.boundingBox();
  expect(box, "the header's action group has no box").not.toBeNull();
  expect(
    (box?.x ?? 0) + (box?.width ?? 0),
    "the header's primary action is laid out past the right edge and clipped",
  ).toBeLessThanOrEqual(1080);
});

/*
  Primary navigation, not the resources hub.

  The founder resolved this (contract 4.2, RESOLVED A-3/B-5): what a deployment can read is a
  product surface, so the row lives in `PRIMARY_NAV`. Both chromes render that list -- the
  desktop row and the phone disclosure -- and this asserts both, because the first version of
  this page was reachable only from a hub two clicks in.
*/
test("is in the primary navigation and listed in the sitemap", async ({ page }) => {
  await page.goto("/sources");
  await expect(page.locator('header.nav nav[aria-label="Sections"] a[href="/sources"]')).toHaveCount(1);
  await expect(page.locator('.mobile-primary-nav nav a[href="/sources"]')).toHaveCount(1);
  await expect(page.locator('.site-footer-groups a[href="/sources"]')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://tavonel.com/sources");

  const sitemap = await page.request.get("/sitemap.xml");
  expect(await sitemap.text()).toContain("https://tavonel.com/sources");
});
