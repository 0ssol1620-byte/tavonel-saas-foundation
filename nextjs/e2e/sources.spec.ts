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

/*
  BA-062: the six frozen tiers, and the label each one prints.

  The enum is still the enum -- it is what `/api/v1/capabilities` serves and what the server
  compares -- but a `SCREAMING_SNAKE_CASE` identifier rendered as a UI badge on a
  primary-navigation page is a machine word shown to a buyer. The pairing is what this file
  asserts, in both directions: every chip is a written label, no chip is an identifier, and the
  label on a row is the label of the tier the API sent for that row's MIME type.
*/
const TIER_LABEL: Record<string, string> = {
  VERIFIED_NATIVE: "Verified, native reader",
  VERIFIED_HYBRID: "Verified, native and checked",
  BEST_EFFORT: "Best effort",
  METADATA_ONLY: "Metadata only",
  REVIEW_REQUIRED: "Needs review",
  UNSUPPORTED: "Not read",
};

const TIERS = Object.values(TIER_LABEL);

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
  // BA-063: the headline names the product and leads with what the read produces.
  await expect(page.getByRole("heading", { level: 1 })).toContainText("what survives the read");

  const rows = page.locator("table.src-matrix tbody tr");
  await expect(rows).toHaveCount(served.entries.length);

  for (const entry of served.entries) {
    await expect(
      page.locator("table.src-matrix tbody i").filter({ hasText: entry.mime }),
      `${entry.mime} is served by the API and missing from the page`,
    ).toHaveCount(1);
  }

  // Every chip is a written label for one of the six frozen tiers, in the API's own row order.
  const chips = await page.locator("table.src-matrix .src-tier").allInnerTexts();
  expect(chips).toHaveLength(served.entries.length);
  for (const chip of chips) {
    expect(TIERS).toContain(chip.trim());
    expect(chip.trim(), "a manifest identifier is being printed as a badge").not.toMatch(/[A-Z]_[A-Z]/);
  }
  expect(chips.map((chip) => chip.trim())).toEqual(
    served.entries.map((entry) => TIER_LABEL[entry.status]),
  );
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
  await expect(table).not.toContainText(TIER_LABEL.VERIFIED_NATIVE!);
  await expect(table).not.toContainText(TIER_LABEL.VERIFIED_HYBRID!);

  // The legend still explains the tiers nothing has reached.
  await expect(page.locator(".src-legend")).toContainText(TIER_LABEL.VERIFIED_NATIVE!);

  /*
    BA-058. The bordered callout under the lede said nothing on this page is verified, which is
    what the table already says row by row, and it said it before a reader had read a row.

    What replaces it is the rule written forwards, in the fold that explains how a row is filled
    in -- so this pins two things the deleted sentence did not: that the page still states what
    earns a tier, and that it no longer announces the count of formats that have not earned one.
    A count sentence coming back fails here.
  */
  await page.evaluate(() => {
    for (const fold of document.querySelectorAll("details")) fold.open = true;
  });
  const main = page.locator("main");
  await expect(main).toContainText("A tier is earned by a measurement.");
  await expect(main).toContainText("a qualification run produces a receipt");
  await expect(main).not.toContainText("No format on this deployment");
  await expect(main).not.toContainText("carries a qualification receipt.");
});

test("states the refusal rule once and claims nothing it cannot support", async ({ page }) => {
  await page.goto("/sources");
  /*
    BA-068. The refusal rule is a clause of the lede now, not a tracked-uppercase line floating
    between two folds where it read as a system error. Still stated exactly once: the assertion
    is on the count as well as the wording, and the old standalone element is asserted gone.
  */
  await expect(page.locator(".src-refusal")).toHaveCount(0);
  await expect(page.locator("p.lede")).toContainText("refused at upload rather than accepted");
  expect(
    (await page.locator("main").innerText()).match(/refused at upload/g)?.length ?? 0,
    "the refusal rule is stated once",
  ).toBe(1);

  /*
    Open every fold before reading the page.

    The tier legend and the explanatory prose moved into `<details>` for §14.3, and `innerText`
    returns nothing for collapsed content -- so without this the barred-phrase scan would have
    quietly stopped covering the two blocks most likely to hold a claim, and passed while
    covering less than it did before.
  */
  await page.evaluate(() => {
    for (const fold of document.querySelectorAll("details")) fold.open = true;
  });

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
  A wider bar item is a header measurement, not a data change.

  `tavonel.css` swaps the section row for the phone disclosure at 1079px because the seven-link
  row pushed the primary action past the right edge up to 1076px, and `overflow-x: hidden` hid
  it from every document-overflow check. 1080px is the first width that shows the row, so it is
  where the bar gets measured. The 2026-09-11 IA redesign took the row from eight links to five
  items, which buys room rather than spending it -- but a group label is free to grow, and this
  test is what fails if the row stops fitting.
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
  A product surface, and still a product surface from three places.

  The founder resolved (contract 4.2, RESOLVED A-3/B-5) that what a deployment can read is a
  product surface rather than a resources entry, and this spec enforced that as a flat top-level
  link in `PRIMARY_NAV`. The 2026-09-11 IA redesign supersedes the *placement* half of that
  resolution and keeps the substance: the bar is five items, so Sources is a Product panel item
  now, and the compensation for losing the flat link is that it is also in the footer's Product
  group -- reachable with no menu open at all -- and that the Product trigger itself carries
  `aria-current` while a reader is on this page.

  What the resolution forbade has not changed: it is not a `/resources` tile, it is not two
  clicks in from a hub, and its URL did not move.

  The desktop half sets its own viewport, because the section row does not exist below 1080px and
  this file runs in every width project.
*/
test("is owned by Connect on desktop and phone and remains directly reachable from the footer", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/sources");

  // Sources is not another top-level choice: the customer-facing Connect destination owns it.
  const desktopConnect = page.locator('header.nav .one-path-primary-nav a[href="/integrations"]');
  await expect(desktopConnect).toHaveText("Connect");
  await expect(desktopConnect).toHaveAttribute("aria-current", "page");

  // The footer, which needs no menu at all.
  await expect(page.locator('.site-footer-groups a[href="/sources"]')).toHaveCount(1);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://tavonel.com/sources");

  // Phone: the same three-choice customer IA, with Connect marked current.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("header.nav details.mobile-primary-nav > summary").click();
  const mobileConnect = page.locator('header.nav details.mobile-primary-nav > nav a[href="/integrations"]');
  await expect(mobileConnect).toHaveText("Connect");
  await expect(mobileConnect).toHaveAttribute("aria-current", "page");
  await expect(page.locator("header.nav details.mobile-primary-nav details.mobile-nav-group")).toHaveCount(0);

  const sitemap = await page.request.get("/sitemap.xml");
  expect(await sitemap.text()).toContain("https://tavonel.com/sources");
});

/*
  §14.3's quick navigator, checked as a filter rather than as a control that exists.

  The failure this guards against is a filter that renders and does nothing -- or worse, one
  that promotes a status by showing a row under the wrong family. So it asserts the two things
  that make it useful: choosing a family leaves only that family's rows, and the counts on the
  buttons match what the API served. The unfiltered default is asserted first, because a page
  that starts filtered would hide formats from a reader who came to check one.
*/
test("filters the matrix by source family without changing any row's tier", async ({ page }) => {
  const served = await manifest(page);
  await page.goto("/sources");

  const rows = page.locator("table.src-matrix tbody tr");
  await expect(rows, "the page opens showing every format").toHaveCount(served.entries.length);

  const documents = page.getByRole("button", { name: /Documents and PDFs/ });
  await expect(documents).toBeVisible();
  const expected = served.entries.filter((entry) =>
    ["pdf", "wordprocessingml", "opendocument.text"].some((mark) => entry.mime.includes(mark)));
  expect(expected.length, "the manifest still has a document family").toBeGreaterThan(0);

  await documents.click();
  await expect(rows).toHaveCount(expected.length);
  const chips = await page.locator("table.src-matrix .src-tier").allInnerTexts();
  expect(
    chips.map((chip) => chip.trim()),
    "filtering may hide a row, never restate its tier",
  ).toEqual(expected.map((entry) => TIER_LABEL[entry.status]));

  await page.getByRole("button", { name: /All formats/ }).click();
  await expect(rows).toHaveCount(served.entries.length);
});
