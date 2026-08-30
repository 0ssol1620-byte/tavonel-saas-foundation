const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

const routes = ["/", "/privacy", "/terms", "/security", "/contact", "/login"] as const;

for (const route of routes) {
  test(`${route} meets the launch semantic accessibility baseline`, async ({ page }) => {
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
