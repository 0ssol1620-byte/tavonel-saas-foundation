import { expect, test } from "@playwright/test";

const ROUTES = [
  "/enterprise",
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
  /*
    BQ-106 added the legend that says what the two access modes mean, so each term is now printed
    once more than the rows that carry it: three managed connectors plus the legend's own <dt>,
    two customer-run rows plus its <dt>. The contract is the one this always measured -- every row
    declares who holds the credential, and none of them says "Beta".
  */
  await expect(main.getByText("Read-only", { exact: true })).toHaveCount(4);
  await expect(main.getByText("Customer-run", { exact: true })).toHaveCount(3);
});

/*
  The property is about a grid with an odd number of cards: the last one spans the empty cell
  instead of leaving a hole. Which ROUTES happen to have an odd count is content, and content
  moves -- the ops lane's probe and error-rate rows took /status from five cards to six, and the
  loop below used to assert every listed route was odd, so a legitimate content change failed a
  test about CSS.

  So the geometry is asserted on the routes that exercise the case, and at least one route must
  still exercise it. Skipping the even ones silently would let this pass by covering nothing,
  which is the failure mode that matters for a test nobody looks at again.
*/
test("odd two-column record grids do not expose an empty placeholder cell", async ({ page }) => {
  let exercised = 0;
  // `/security` now uses a narrative controls list so public assurance does not expose an
  // implementation inventory. The two actual record grids remain the geometry fixtures.
  for (const route of ["/status", "/subprocessors"] as const) {
    await page.goto(route);
    const grid = page.locator(route === "/subprocessors" ? ".processor-list" : ".status-list").last();
    const geometry = await grid.evaluate((element) => {
      const last = element.lastElementChild;
      if (!(last instanceof HTMLElement)) throw new Error("record grid has no final item");
      const parentRect = element.getBoundingClientRect();
      const itemRect = last.getBoundingClientRect();
      return {
        childCount: element.children.length,
        leftGap: Math.abs(itemRect.left - parentRect.left),
        rightGap: Math.abs(itemRect.right - parentRect.right),
      };
    });

    if (geometry.childCount % 2 === 0) continue;
    exercised += 1;
    expect(geometry.leftGap, `${route} final card begins at the grid edge`).toBeLessThanOrEqual(1);
    expect(geometry.rightGap, `${route} final card fills the former empty cell`).toBeLessThanOrEqual(1);
  }
  expect(exercised, "no listed route has an odd grid any more, so this test proved nothing")
    .toBeGreaterThan(0);
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
    const navOverlapCount = navs.flatMap((nav, index) =>
      navs.slice(index + 1).filter((candidate) => intersects(nav.getBoundingClientRect(), candidate.getBoundingClientRect())),
    ).length;
    const linkOverlapCount = links.flatMap((link, index) =>
      links.slice(index + 1).filter((candidate) => intersects(link.getBoundingClientRect(), candidate.getBoundingClientRect())),
    ).length;

    return {
      columns: getComputedStyle(group).gridTemplateColumns.split(" ").filter(Boolean).length,
      footerHeight: element.getBoundingClientRect().height,
      groupHeight: group.getBoundingClientRect().height,
      linkHeights: links.map((link) => link.getBoundingClientRect().height),
      navOverlapCount,
      linkOverlapCount,
    };
  });

  expect(result.navOverlapCount).toBe(0);
  expect(result.linkOverlapCount).toBe(0);
  expect(result.groupHeight).toBeGreaterThan(100);
  if ((page.viewportSize()?.width ?? 0) <= 480) {
    expect(result.columns).toBe(2);
    expect(result.footerHeight).toBeLessThan((page.viewportSize()?.height ?? 844) * 0.9);
    expect(result.linkHeights.every((height) => height >= 43.99)).toBe(true);
  }
});

test("enterprise jump links keep separate touch targets", async ({ page }) => {
  await page.goto("/enterprise");
  const links = page.getByRole("navigation", { name: "On this page" }).getByRole("link");
  const geometry = await links.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: rect.height };
  }));

  expect(geometry.length).toBeGreaterThanOrEqual(3);
  if ((page.viewportSize()?.width ?? 0) <= 1079) {
    expect(geometry.every((item) => item.height >= 43.99)).toBe(true);
  }
  for (let index = 1; index < geometry.length; index += 1) {
    expect(geometry[index].top).toBeGreaterThanOrEqual(geometry[index - 1].bottom - 1);
  }
});
