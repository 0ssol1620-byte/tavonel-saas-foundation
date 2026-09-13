const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

/*
  The Explore surface itself now has its own file.

  `/explore` is the Interactive Product Film -- an entry, three acts, an Ask command and a
  technical drawer -- and `e2e/explore.spec.ts` walks all of it, on desktop, on a phone and
  under reduced motion. What is left here is the part that belongs to no single page: that the
  landing actually reaches the sample, and that the sample opens as a sample. The mobile
  Source/World toggle and the `BBOX [...] / Open citation` readings that used to be asserted
  below described the diagnostic console this page was before, and both have moved -- the
  stacked phone flow and the drawer's coordinates are checked in the new file, against the new
  page, rather than restated here against a page that no longer exists.
*/
test("homepage Proof opens the no-login Compiled World sample on its real evidence", async ({ page }) => {
  await page.goto("/");
  const cta = page.locator("#proof .solution-proof-sample").getByRole("link", { name: "Inspect the evidence" });
  await cta.scrollIntoViewIfNeeded();
  await expect(cta).toBeVisible();
  await cta.click();
  await expect(page).toHaveURL(url => url.pathname === "/explore" && url.searchParams.get("act") === "evidence");
  await expect(page.locator('[data-visual-world="explore"]')).toHaveAttribute("data-world-act", "evidence");
  // The sample declares itself once, in the header badge. It used to say "DETERMINISTIC
  // PRODUCT SAMPLE" here and "not customer proof" further down, which is two answers to an
  // accusation nobody browsing a demo has made. The label has to survive; the arguing does not.
  await expect(page.getByText("INTERACTIVE SAMPLE")).toBeVisible();
});

test("the sample opens onto real provenance and claims nothing it has not compiled", async ({ page }) => {
  await page.goto("/explore");
  const stage = page.locator('[data-visual-world="explore"]');
  await page.getByRole("button", { name: "ENTER WORLD" }).click();
  /*
    A filing, opened the way a reader opens one: select the object, then ask for its evidence.

    This used to click a `Claim` node and expect an `fp-200-*.pdf` filename and an "Open source
    PDF" link -- three facts about a page that no longer exists. The opening composition is the
    declared presentation subset of §11.4, the corpus is five public SEC filings, and the sheet's
    footer link now says which bytes it opens. Selecting a node also does not open it; the World
    act's own button does.
  */
  await stage.locator('[data-visual-node][data-node-kind="Document"]').first().click();
  await page.getByRole("button", { name: "Open source evidence" }).click();
  /*
    A phone walks World → Object → Source as steps rather than opening two panels at once, so
    the source is one step further on. The branch is taken on the stage's own state rather than
    on whether a button happens to be visible yet: asking that question a frame too early left
    the run on the object step, where the filename is rendered but hidden, and the failure read
    as missing provenance rather than as a race.
  */
  await expect(stage).toHaveAttribute("data-world-act", /^(object_focus|evidence)$/);
  if ((await stage.getAttribute("data-world-act")) === "object_focus") {
    await page.getByRole("button", { name: /Open the source region/ }).click();
  }
  await expect(stage).toHaveAttribute("data-world-act", "evidence");
  /*
    Which filing, which page and which region are pinned by `lib/explore-sample.test.ts` and
    walked act by act in `e2e/explore.spec.ts`. What this test asserts is the part neither of
    those can see and no single page owns: that provenance reaches the screen at all, for a
    reader who arrived at `/explore` and pressed the buttons in front of them.

    Read through the source sheet: the object pane names the same file in its relation list,
    which a phone hides at this step, so an unscoped "first match" is a hidden element.
  */
  const sheet = page.locator("[data-source-sheet]");
  await expect(sheet.getByText(/^apple-[\w-]+\.pdf$/i).first()).toBeVisible();
  await expect(sheet.locator("[data-original-source]")).toBeVisible();
  await sheet.getByRole("tab", { name: "Parsed text" }).click();
  await expect(page.getByText(/^REGION ON PAGE \d+ OF \d+$/)).toBeVisible();
  // The footer names the bytes it opens: the committed PDF of the annual filing, or the
  // reference render of a 2026 filing. It may never offer one under the other's name.
  await expect(page.getByRole("link", { name: /Open (committed PDF|reference render)/ })).toBeVisible();
  // A RESEARCH FRONTIER card whose every field read `not_yet` used to stand here, and then the
  // `PAGE + BBOX BOUND` tile that replaced it. Both were a page claiming provenance in words.
  // What must still hold is that no placeholder renders as a fact.
  await expect(page.locator("html")).not.toContainText(/not_yet/i);
  // The page must label itself as a sample exactly once. More than once is the defensiveness
  // that made the strongest page on the site read as the weakest.
  await expect(page.getByText("INTERACTIVE SAMPLE")).toHaveCount(1);
  await expect(page.locator("html")).not.toContainText(/trusted by|customer success|certified/i);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("Security record exposes fail-closed controls without certification claims", async ({ page }) => {
  await page.goto("/security");
  await expect(page.getByRole("heading", { name: /Where your documents go/ })).toBeVisible();
  await expect(page.getByText(/Every external operation fails closed/)).toBeVisible();
  await expect(page.getByText("CURRENT DEPLOYMENT CONTROLS")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/SOC 2 certified|ISO 27001 certified/i);
});
