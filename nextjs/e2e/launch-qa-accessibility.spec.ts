const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

/*
  V03: the six routes this suite launched with were the legal and entry pages. The pages a
  customer actually evaluates -- pricing, the product index, the solution page, the docs, the
  developer surface and the compiled-world sample -- were never held to the same baseline.
  Extending the array is the whole change; every check below is route-agnostic.
*/
const routes = [
  "/",
  "/privacy",
  "/terms",
  "/security",
  "/contact",
  "/login",
  "/pricing",
  "/product",
  "/solutions/ai-ready-knowledge",
  "/docs",
  "/developers",
  "/explore",
] as const;

/*
  All six routes meet the baseline now, and the list below is empty.

  /pricing rendered its four plan cards as `<h3>` directly under the page `<h1>`, so a
  screen-reader user moving by heading level dropped from h1 to h3 with nothing between. Fixed
  at integration (stage 2 C4), together with the CSS selector that carried the card treatment,
  so the accessibility fix did not become a visual regression.

  A second instance of the same defect was found on `/` by running this spec against the merged
  branch: the landing page had gained three `<h3>` job cards directly under its hero. Neither
  lane could have seen that one -- the QA lane audited production main, where the block did not
  exist. Both are fixed; the list and the `test.fail()` mechanism stay for the next one.
*/
const KNOWN_HEADING_DEFECT: readonly string[] = [];

for (const route of routes) {
  test(`${route} meets the launch semantic accessibility baseline`, async ({ page }) => {
    test.fail(
      KNOWN_HEADING_DEFECT.includes(route),
      `${route} jumps h1 -> h3; see CROSS-LANE REQUESTS in CA_LANE_REPORT_qa.md`,
    );
    await page.goto(route, { waitUntil: "domcontentloaded" });
    const violations = await page.evaluate(() => {
      const issues: string[] = [];
      const visible = (element: Element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
      };
      const accessibleName = (element: Element) => {
        const labelledBy = element.getAttribute("aria-labelledby");
        if (labelledBy) {
          return labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? "").join(" ").trim();
        }
        const explicitLabel = element.id
          ? document.querySelector(`label[for='${CSS.escape(element.id)}']`)?.textContent
          : null;
        const wrappingLabel = element.closest("label")?.textContent;
        return (element.getAttribute("aria-label")
          ?? element.getAttribute("alt")
          ?? element.getAttribute("title")
          ?? explicitLabel
          ?? wrappingLabel
          ?? element.textContent
          ?? "").trim();
      };

      if (!document.documentElement.lang.trim()) issues.push("html element has no language");
      if (!document.title.trim()) issues.push("document has no title");
      if (document.querySelectorAll("main").length !== 1) issues.push("page must contain exactly one main landmark");
      if (document.querySelectorAll("h1").length !== 1) issues.push("page must contain exactly one h1");

      const ids = new Set<string>();
      document.querySelectorAll("[id]").forEach(element => {
        const id = element.id;
        if (ids.has(id)) issues.push(`duplicate id: ${id}`);
        ids.add(id);
      });

      document.querySelectorAll("img").forEach(image => {
        if (!image.hasAttribute("alt") && image.getAttribute("role") !== "presentation") {
          issues.push(`image has no alt: ${image.getAttribute("src") ?? "inline"}`);
        }
      });

      document.querySelectorAll("a[href], button, input, select, textarea, [role='button']").forEach(element => {
        if (visible(element) && !accessibleName(element)) {
          issues.push(`unnamed interactive element: ${element.tagName.toLowerCase()}`);
        }
      });

      document.querySelectorAll("input:not([type='hidden']), select, textarea").forEach(control => {
        if (!visible(control)) return;
        const id = control.id;
        const labelled = control.hasAttribute("aria-label")
          || control.hasAttribute("aria-labelledby")
          || (id.length > 0 && document.querySelector(`label[for='${CSS.escape(id)}']`) !== null)
          || control.closest("label") !== null;
        if (!labelled) issues.push(`form control has no label: ${control.tagName.toLowerCase()}#${id}`);
      });

      let previous = 0;
      document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach(heading => {
        if (!visible(heading)) return;
        const level = Number(heading.tagName.slice(1));
        if (previous > 0 && level > previous + 1) issues.push(`heading level jumps from h${previous} to h${level}`);
        previous = level;
      });
      return issues;
    });
    expect(violations, `${route} accessibility violations`).toEqual([]);
  });
}

test("provides a working, visible keyboard skip link", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name === "launch-webkit",
    "TOOL_BLOCKER: WebKit upgrades the local HTTP fragment navigation to HTTPS under the production CSP.",
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const skip = page.locator("a.skip[href='#main']");
  await skip.focus();
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.querySelector("#main")?.contains(document.activeElement))).toBe(true);
});
