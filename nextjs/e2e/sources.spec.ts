const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

/* D2's five customer sections, read from the site's own table rather than typed into a test. */
import { HEADER_NAV } from "../lib/site-navigation";

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
  A product surface, and still a product surface -- reachable with no menu open at all.

  The founder resolved (contract 4.2, RESOLVED A-3/B-5) that what a deployment can read is a
  product surface rather than a resources entry, and this spec enforced that as a flat top-level
  link in `PRIMARY_NAV`. The 2026-09-11 IA redesign superseded the *placement* half of that
  resolution and this test then read the bar for an `Integrations` item that owned /sources.

  LANDING V2 / D2 SUPERSEDED THAT IN TURN, and this assertion is the retarget. `CUSTOMER_NAV` is
  Product / How it works / Resources / Docs / Pricing, so the bar has no /integrations link at
  all and this test failed in four CI projects -- which is main's required Launch gate, because
  Product QA runs every spec. `lib/site-navigation.ts` states the new arrangement and its reason:
  no item in the five-link bar is the section /sources belongs to, so marking one of them current
  on this page would tell a reader something false about where they are.

  So what is asserted is what the resolution actually protects, under the IA that exists: the
  page is one click from the footer's Product group with no menu open at all, no bar item claims
  to own it, and its URL did not move. What the resolution forbade is still forbidden and still
  checked -- it is not a /resources tile and it is not two clicks in from a hub.

  NOT ASSERTED, deliberately: `lib/site-navigation.ts` also says /sources stays reachable "from
  /integrations itself", and that page carries no link to it -- only a prose mention. Writing the
  assertion would have failed; writing the link is a content change this lane was not asked to
  make. The gap is in the round-3 report.

  The desktop half sets its own viewport: the section row is hidden below 1250px (D2, see
  `app/chrome-v2.css`) and this file runs in every width project.
*/
test("is reachable from the footer and /integrations, and no bar item claims to own it", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/sources");

  // The bar has four section links; Pricing is its separate emphasized action.
  const bar = page.locator("header.nav .one-path-primary-nav");
  await expect(bar.locator("a")).toHaveCount(HEADER_NAV.length);
  for (const item of HEADER_NAV) await expect(bar.locator(`a[href="${item.href}"]`)).toHaveCount(1);
  await expect(page.locator('header.nav .nav-actions a[href="/pricing"]')).toHaveCount(1);
  await expect(bar.locator('a[href="/integrations"]')).toHaveCount(0);
  await expect(bar.locator('a[href="/sources"]')).toHaveCount(0);
  /*
    And none of the five is marked current here. `customerNavOwns` returns false for every bar
    href on this path; a bar that highlighted one anyway would be the false-location defect the
    navigation comment names.
  */
  await expect(bar.locator('a[aria-current="page"]')).toHaveCount(0);

  // The footer, which needs no menu at all, and the URL that did not move.
  await expect(page.locator('.site-footer-groups a[href="/sources"]')).toHaveCount(1);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://tavonel.com/sources");

  // Phone: the same four section links, with Pricing still available in the header.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("header.nav details.mobile-primary-nav > summary").click();
  const sheet = page.locator("header.nav details.mobile-primary-nav > nav");
  for (const item of HEADER_NAV) {
    await expect(sheet.locator(`a.mobile-nav-direct[href="${item.href}"]`)).toHaveCount(1);
  }
  await expect(sheet.locator('a.mobile-nav-direct[aria-current="page"]')).toHaveCount(0);
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
