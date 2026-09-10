import { expect, test } from "@playwright/test";

const ROUTES = [
  "/integrations",
  "/docs",
  "/docs/quickstart",
  "/changelog",
  "/evidence",
  "/security",
  "/benchmarks",
  "/research",
  "/subprocessors",
] as const;

test("long-form public pages keep supporting content in the reading column", async ({ page }) => {
  for (const route of ROUTES) {
    await page.goto(route);
    const result = await page.evaluate(() => {
      const visible = (element: Element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const bodies = [...document.querySelectorAll("main .body")].map((body) => ({
        directChildren: [...body.children]
          .filter((element) => visible(element) && !element.classList.contains("trust-next"))
          .length,
      }));
      const narrowParagraphs = innerWidth < 1181 ? [] : [...document.querySelectorAll("main p")]
        .filter(visible)
        .map((paragraph) => ({
          width: paragraph.getBoundingClientRect().width,
          words: (paragraph.textContent ?? "").trim().split(/\s+/).filter(Boolean).length,
        }))
        .filter((paragraph) => paragraph.width < 330 && paragraph.words >= 28);
      return {
        bodies,
        narrowParagraphs,
        overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      };
    });

    expect(result.overflow, `${route} has no horizontal overflow`).toBeLessThanOrEqual(1);
    expect(result.bodies.every((body) => body.directChildren <= 2), `${route} preserves the two-column body contract`).toBe(true);
    expect(result.narrowParagraphs, `${route} has no long paragraph trapped in a narrow desktop column`).toEqual([]);
  }
});

test("integration marketing copy uses access modes instead of beta badges", async ({ page }) => {
  await page.goto("/integrations");
  const main = page.locator("main");
  await expect(main).not.toContainText(/\bBeta\b/i);
  await expect(main.getByText("Read-only", { exact: true })).toHaveCount(3);
  await expect(main.getByText("Customer-run", { exact: true })).toHaveCount(2);
});

test("the public footer stays compact and fully painted on narrow screens", async ({ page }) => {
  await page.goto("/integrations");
  const footer = page.locator("footer.site");
  await footer.scrollIntoViewIfNeeded();

  const result = await footer.evaluate((element) => {
    const group = element.querySelector<HTMLElement>(".site-footer-groups")!;
    const navs = [...group.querySelectorAll<HTMLElement>(":scope > nav")];
    const links = [...group.querySelectorAll<HTMLElement>("a")];
    const intersects = (a: DOMRect, b: DOMRect) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    const overlapCount = navs.flatMap((nav, index) =>
      navs.slice(index + 1).filter((candidate) => intersects(nav.getBoundingClientRect(), candidate.getBoundingClientRect())),
    ).length;

    return {
      columns: getComputedStyle(group).gridTemplateColumns.split(" ").filter(Boolean).length,
      footerHeight: element.getBoundingClientRect().height,
      groupHeight: group.getBoundingClientRect().height,
      linkHeights: links.map((link) => link.getBoundingClientRect().height),
      overlapCount,
    };
  });

  expect(result.overlapCount).toBe(0);
  expect(result.groupHeight).toBeGreaterThan(100);
  if ((page.viewportSize()?.width ?? 0) <= 480) {
    expect(result.columns).toBe(2);
    expect(result.footerHeight).toBeLessThan((page.viewportSize()?.height ?? 844) * 0.9);
    expect(result.linkHeights.every((height) => height >= 43.99)).toBe(true);
  }
});
