const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

const PHONE = ["360", "390"];
const NARROW = ["360", "390", "768"];

async function openHome(page) {
  await page.goto("/");
  await expect(page.getByTestId("one-path-hero-film")).toBeVisible();
}

async function openWorksFilm(page) {
  await page.goto("/");
  const film = page.getByTestId("one-path-works-film");
  await film.scrollIntoViewIfNeeded();
  await expect(film.locator(".compile-film-sequence")).toBeVisible();
  return film;
}

test("the hero uses the approved encoded film instead of mounting a crushed live canvas", async ({ page }, testInfo) => {
  test.skip(!NARROW.includes(testInfo.project.name), "the narrow encoded-film path is the risk under test");
  await openHome(page);
  const hero = page.getByTestId("one-path-hero-film");
  await expect(hero.locator(".compile-film-sequence")).toHaveAttribute("data-film-renderer", "video-fallback");
  await expect(hero.locator(".compile-film-live canvas")).toHaveCount(0);
  const video = hero.locator(".compile-film-video");
  await expect(video).toBeVisible();
  await expect(video.locator("source")).toHaveCount(1);
  await expect(video.locator("source")).toHaveAttribute("src", "/film/compile-cut.mp4");
  await expect(video).toHaveAttribute("poster", "/film/poster-1-hero.webp");
});

/*
  G1-012 (2026-09-16). Below 900px the film pans instead of shrinking: the frame is a horizontal
  scroll-snap container and the recording inside it keeps its 16:10 at the frame's full height,
  so a phone reader sees one legible column at a time rather than a 370px thumbnail of four. What
  is pinned is therefore the recording's shape and that the frame really scrolls -- the frame's
  own box is now portrait on purpose. Above 900px the panes are `display: none` and the frame
  itself is the 16:10 box, as before.
*/
test("the hero film keeps its 16:10 source shape on a narrow screen", async ({ page }, testInfo) => {
  test.skip(!NARROW.includes(testInfo.project.name), "the narrow frame is what is under test");
  await openHome(page);
  const viewport = page.getByTestId("one-path-hero-film").locator(".compile-film-viewport");
  const measured = await viewport.evaluate((frame: HTMLElement) => {
    const panes = frame.querySelector<HTMLElement>(".compile-film-panes");
    const pans = !!panes && getComputedStyle(panes).display !== "none";
    const box = (pans ? panes : frame).getBoundingClientRect();
    return { pans, ratio: box.width / box.height, overflowX: getComputedStyle(frame).overflowX, scrollable: frame.scrollWidth > frame.clientWidth + 1 };
  });
  expect(measured.ratio).toBeGreaterThan(1.58);
  expect(measured.ratio).toBeLessThan(1.62);
  if (measured.pans) {
    expect(measured.overflowX, "the panning frame must be a real scroller, not a clipped box").toBe("auto");
    expect(measured.scrollable, "the recording is wider than the frame and can be panned").toBe(true);
  }
});

test("the customer film vocabulary stays readable without reintroducing technical stage names", async ({ page }, testInfo) => {
  test.skip(!NARROW.includes(testInfo.project.name), "the phone chip row is under test");
  await openHome(page);
  const chips = page.locator(".one-path-hero-film-steps span");
  await expect(chips).toHaveCount(4);
  await expect(chips).toHaveText(["SOURCE", "READ", "ORGANIZE", "READY FOR AI"]);
  const boxes = await chips.evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, width: rect.width };
  }));
  expect(new Set(boxes.map(box => Math.round(box.top))).size).toBe(1);
  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(-1);
    expect(box.right).toBeLessThanOrEqual((page.viewportSize()?.width ?? 390) + 1);
    expect(box.width).toBeGreaterThan(40);
  }
});

test("the Works film remains a two-stage accessible tablist with readable caption and progress", async ({ page }, testInfo) => {
  test.skip(!NARROW.includes(testInfo.project.name), "the supporting film is checked where labels have the least room");
  const film = await openWorksFilm(page);
  const tabs = film.locator('.compile-film-stages[role="tablist"] [role="tab"]');
  await expect(tabs).toHaveCount(2);
  await expect(tabs).toHaveText(["ORGANIZE", "UPDATES"]);
  await expect(film.locator('.compile-film-viewport[role="tabpanel"]')).toHaveCount(1);
  await expect(film.locator(".compile-film-caption p")).toContainText(/knowledge|source/i);
  await expect(film.locator(".compile-film-progress")).toHaveText(/^\d\d \/ 02$/);
  const size = await film.locator(".compile-film-caption p").evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(size).toBeGreaterThanOrEqual(12);
});

test("a visitor-selected Works stage stays selected when the current cut ends", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "390", "one phone width is enough for the manual-hold state machine");
  const film = await openWorksFilm(page);
  const updates = film.getByRole("tab", { name: "UPDATES" });
  await updates.click();
  await expect(updates).toHaveAttribute("aria-selected", "true");
  const video = film.locator(".compile-film-video");
  await expect(video).toBeVisible();
  await video.dispatchEvent("ended");
  await expect(updates).toHaveAttribute("aria-selected", "true");
  await expect(film.locator(".compile-film-caption p")).toContainText("changed source");
});

test("reduced motion starts from a still and provides explicit playback", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "reduced-motion", "the project supplies prefers-reduced-motion");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openHome(page);
  const hero = page.getByTestId("one-path-hero-film");
  await expect(hero.locator(".compile-film-still")).toBeVisible();
  await expect(hero.locator(".compile-film-video")).toHaveCount(0);
  const play = hero.getByRole("button", { name: "Play the compilation film" });
  await expect(play).toBeVisible();
  await play.click();
  await expect(hero.locator(".compile-film-video")).toBeVisible();
  await expect(hero.getByRole("button", { name: "Pause the compilation film" })).toBeVisible();
});

test("nothing on the narrow landing is laid out outside the viewport", async ({ page }, testInfo) => {
  test.skip(!NARROW.includes(testInfo.project.name), "an overflow check needs a narrow viewport");
  await page.goto("/");
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 480) {
      window.scrollTo(0, y);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    window.scrollTo(0, 0);
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  const escaped = await page.evaluate(() => {
    const result: string[] = [];
    /*
      G1-012: the film pans below 900px, so its panes and recording sit past the right edge inside
      a real `overflow-x: auto` frame. That is the supported wide-content pattern (the same rule
      `overflow-audit.spec.ts` applies to tables and code); `overflow-x: hidden` is not a scroller
      and still counts, because hidden is what made these defects invisible in the first place.
    */
    const clippedByScroller = (element: HTMLElement) => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const overflowX = getComputedStyle(parent).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") return true;
      }
      return false;
    };
    for (const element of document.querySelectorAll<HTMLElement>("header.nav *, main *, footer.site *")) {
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      if ((box.left < -1 || box.right > innerWidth + 1) && !clippedByScroller(element)) result.push(`${element.tagName}.${String(element.className).slice(0, 36)}`);
    }
    return result;
  });
  expect(escaped).toEqual([]);
});

test("the narrow header keeps brand, menu and commercial action inside one row", async ({ page }, testInfo) => {
  test.skip(!NARROW.includes(testInfo.project.name), "the collision risk is narrow-only");
  await page.goto("/");
  const boxes = await page.evaluate(() => {
    const read = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    };
    return { wordmark: read("header.nav .wordmark"), menu: read("header.nav .mobile-primary-nav summary"), actions: read("header.nav .nav-actions"), viewport: innerWidth };
  });
  expect(boxes.wordmark).not.toBeNull();
  expect(boxes.menu).not.toBeNull();
  expect(boxes.actions).not.toBeNull();
  expect(boxes.wordmark!.right).toBeLessThanOrEqual(boxes.menu!.left + 1);
  expect(boxes.menu!.right).toBeLessThanOrEqual(boxes.actions!.left + 1);
  expect(boxes.actions!.right).toBeLessThanOrEqual(boxes.viewport + 1);
});

test("the mobile menu exposes only the three customer choices plus the commercial action", async ({ page }, testInfo) => {
  test.skip(!NARROW.includes(testInfo.project.name), "the mobile disclosure only renders below the desktop breakpoint");
  await page.goto("/");
  const menu = page.locator("header.nav details.mobile-primary-nav");
  await menu.locator(":scope > summary").click();
  const panel = menu.locator(":scope > nav");
  await expect(panel).toBeVisible();
  const direct = panel.locator("a.mobile-nav-direct");
  await expect(direct).toHaveCount(3);
  await expect(direct).toHaveText(["How it works", "Connect", "Pricing"]);
  await expect(panel.locator("a.mobile-nav-cta")).toHaveCount(1);
  await expect(panel.locator("details.mobile-nav-group")).toHaveCount(0);
  const geometry = await panel.boundingBox();
  expect(geometry).not.toBeNull();
  expect(geometry!.x).toBeGreaterThanOrEqual(-1);
  expect(geometry!.x + geometry!.width).toBeLessThanOrEqual((page.viewportSize()?.width ?? 390) + 1);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(menu.locator(":scope > summary")).toBeFocused();
});

test("Connect owns the Sources route and using a mobile customer link closes the sheet", async ({ page }, testInfo) => {
  test.skip(!NARROW.includes(testInfo.project.name), "the mobile disclosure only renders below the desktop breakpoint");
  await page.goto("/sources");
  const menu = page.locator("header.nav details.mobile-primary-nav");
  await menu.locator(":scope > summary").click();
  await expect(menu.getByRole("link", { name: "Connect", exact: true })).toHaveAttribute("aria-current", "page");
  await menu.getByRole("link", { name: "Pricing", exact: true }).click({ noWaitAfter: true });
  await expect(menu.locator(":scope > nav")).toBeHidden();
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });

  test("every reachable control keeps the 44px touch floor", async ({ page }, testInfo) => {
    test.skip(!PHONE.includes(testInfo.project.name), "the touch floor is a phone contract");
    await page.goto("/");
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 480) {
        window.scrollTo(0, y);
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      window.scrollTo(0, 0);
    });
    const short = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("a, button, summary, [role='tab']")]
      .map(element => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0 && rect.height < 43.99)
      .map(({ element, rect }) => ({ tag: element.tagName, text: (element.textContent ?? "").trim().slice(0, 30), height: rect.height })));
    expect(short).toEqual([]);
  });
});
