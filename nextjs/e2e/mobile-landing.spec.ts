/**
 * The landing page on a phone, at the widths a phone actually is.
 *
 * Three defects were on production main and none of them were visible to the existing suite.
 * The compile film mounted a live canvas whose four-column stage is composed in fixed pixels for
 * a 1440x900 frame and then sized to `canvas.clientWidth`, so at 390 it drew that composition
 * into 350px and the labels landed on top of each other. The mobile menu panel was positioned
 * against the MENU button rather than the header, so it opened with its left half off screen --
 * measured at x = -98 on a 390px viewport. And the stage strip advanced every 5,000ms against
 * an 18-second cut, so no visitor ever saw one end.
 *
 * What makes these assertions different from the ones already here is that they are geometric
 * and they run at narrow widths. `document.scrollWidth` was clean the whole time -- the site
 * sets `overflow-x: hidden`, which turns "outside the viewport" into "invisible" rather than
 * into a failing test.
 */

const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

/** The projects that stand in for a phone. 768 is the tablet edge; 1440 is the control. */
const PHONE = ["360", "390"];
const NARROW = ["360", "390", "768"];

async function showFilm(page) {
  await page.goto("/");
  await page.locator("#s3").scrollIntoViewIfNeeded();
  await page.locator("#s3 .compile-film-sequence").waitFor({ state: "visible" });
  await page.waitForTimeout(900);
}

/*
  The measurement that chose the breakpoint.

  `docs/audit/mobile/2026-09-05/column-fit.mjs` measures the strings cut 3 draws in its pane
  headers -- `SOURCES` beside `ops-manual-r9.pdf` is the widest pair -- and finds they need a
  144px column, which needs a 625px frame. `frame-sweep.mjs` measures the frame: 350px at a 390
  viewport, 372px at 412, 707px at 768. So the canvas is only mounted from 900px up, and not at
  all on a coarse pointer below 1024 (a phone in landscape is 844-932 CSS px, which a pure width
  rule would hand the canvas straight back).
*/
test("the live canvas is not mounted into a frame too narrow to draw it", async ({ page }, testInfo) => {
  test.skip(!NARROW.includes(testInfo.project.name), "the fallback rule is about narrow viewports");
  await showFilm(page);

  const sequence = page.locator("#s3 .compile-film-sequence");
  await expect(sequence).toHaveAttribute("data-film-renderer", "video-fallback");
  await expect(page.locator("#s3 .compile-film-live canvas")).toHaveCount(0);

  const video = page.locator("#s3 .compile-film-video");
  await expect(video).toHaveCount(1);
  await expect(video).toBeVisible();
  // One decoder at a time: the element carries exactly the source of the stage on screen.
  await expect(page.locator("#s3 .compile-film-video source")).toHaveCount(1);
  await expect(page.locator("#s3 .compile-film-video source")).toHaveAttribute("src", "/film/compile-cut.mp4");

  const attrs = await video.evaluate((element: HTMLVideoElement) => ({
    muted: element.muted,
    playsInline: element.playsInline,
    poster: element.getAttribute("poster"),
    visible: getComputedStyle(element).visibility,
  }));
  expect(attrs).toEqual({ muted: true, playsInline: true, poster: "/film/poster-1.webp", visible: "visible" });
});

test("the live canvas still runs where the composition fits", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "1440", "the canvas path is specified on a desktop width");
  await showFilm(page);
  await expect(page.locator("#s3 .compile-film-sequence")).toHaveAttribute("data-film-renderer", "live-canvas");
  await expect(page.locator("#s3 .compile-film-live canvas")).toHaveCount(1);
});

test("the compile frame keeps the film's own 16:10 shape on a phone", async ({ page }, testInfo) => {
  test.skip(!NARROW.includes(testInfo.project.name), "the narrow frame is what is under test");
  await showFilm(page);
  const frame = await page.locator("#s3 .compile-film-viewport").boundingBox();
  const ratio = (frame?.width ?? 0) / (frame?.height ?? 1);
  // The cuts are 2880x1800. A `min-height` in viewport units used to win over `aspect-ratio` and
  // made the box 1.53:1 at 360 and 1.48:1 at 768.
  expect(ratio, `frame is ${Math.round(frame?.width ?? 0)}x${Math.round(frame?.height ?? 0)} = ${ratio.toFixed(3)}:1`).toBeGreaterThan(1.58);
  expect(ratio).toBeLessThan(1.62);
});

test("the four stage tabs sit on one line and none of their labels is clipped", async ({ page }, testInfo) => {
  test.skip(!NARROW.includes(testInfo.project.name), "wrapping is a narrow-width failure");
  await showFilm(page);
  const strip = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("#s3 .compile-film-stages button")];
    return buttons.map((b) => ({
      label: b.textContent,
      top: Math.round(b.getBoundingClientRect().top),
      overflow: b.scrollWidth - b.clientWidth,
      height: Math.round(b.getBoundingClientRect().height),
    }));
  });
  expect(strip).toHaveLength(4);
  expect(new Set(strip.map((b) => b.top)).size, `tabs on ${new Set(strip.map((b) => b.top)).size} rows: ${JSON.stringify(strip)}`).toBe(1);
  for (const button of strip) expect(button.overflow, `${button.label} overflows its tab by ${button.overflow}px`).toBeLessThanOrEqual(1);
});

test("the caption and the progress counter are readable at phone size", async ({ page }, testInfo) => {
  test.skip(!PHONE.includes(testInfo.project.name), "the type sizes are set below 620px");
  await showFilm(page);
  const type = await page.evaluate(() => {
    const size = (selector: string) => Number.parseFloat(getComputedStyle(document.querySelector(selector)!).fontSize);
    return {
      caption: size("#s3 .compile-film-caption p"),
      progress: size("#s3 .compile-film-progress"),
      progressText: document.querySelector("#s3 .compile-film-progress")?.textContent ?? "",
      captionText: document.querySelector("#s3 .compile-film-caption p")?.textContent ?? "",
    };
  });
  expect(type.caption).toBeGreaterThanOrEqual(12);
  expect(type.progress).toBeGreaterThanOrEqual(10);
  expect(type.progressText).toMatch(/^\d\d \/ \d\d$/);
  expect(type.captionText.length).toBeGreaterThan(20);
});

test("nothing on the phone landing is laid out outside the viewport", async ({ page }, testInfo) => {
  test.skip(!NARROW.includes(testInfo.project.name), "an overflow check needs a narrow viewport");
  await page.goto("/");
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    window.scrollTo(0, 0);
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  /*
    Both halves. `document.scrollWidth` alone reports nothing here: `overflow-x: hidden` on the
    document clips whatever runs past the right edge, which is exactly how the header spent the
    761-1076px band laying its primary action out at x = 898 on a 768px screen with no test
    noticing. So the second assertion looks at the boxes themselves.
  */
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const escaped = await page.evaluate(() => {
    const found: { tag: string; cls: string; right: number }[] = [];
    for (const element of document.querySelectorAll("header.nav *, main *, footer.site *, .bar *")) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.right > window.innerWidth + 1 || box.left < -1) {
        found.push({ tag: element.tagName.toLowerCase(), cls: String(element.className || "").slice(0, 40), right: Math.round(box.right) });
      }
    }
    return found;
  });
  expect(escaped).toEqual([]);
});

/*
  The header is a row of three things and none of them may sit on another.
*/
test("the header keeps the wordmark, MENU and the primary action apart", async ({ page }, testInfo) => {
  test.skip(!NARROW.includes(testInfo.project.name), "the header collision is a narrow-width failure");
  await page.goto("/");
  const boxes = await page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: Math.round(rect.left), right: Math.round(rect.right) };
    };
    return {
      wordmark: box("header.nav .wordmark"),
      menu: box("header.nav .mobile-primary-nav summary"),
      actions: box("header.nav .nav-actions"),
      viewport: window.innerWidth,
    };
  });
  expect(boxes.wordmark).not.toBeNull();
  expect(boxes.menu, "the menu control must exist wherever the section links are hidden").not.toBeNull();
  expect(boxes.wordmark!.right, "wordmark overlaps MENU").toBeLessThanOrEqual(boxes.menu!.left);
  expect(boxes.menu!.right, "MENU overlaps the primary action").toBeLessThanOrEqual(boxes.actions!.left);
  expect(boxes.actions!.right, "the primary action is laid out past the right edge").toBeLessThanOrEqual(boxes.viewport);
});

test("the mobile menu opens inside the viewport and closes the way a menu closes", async ({ page }, testInfo) => {
  test.skip(!NARROW.includes(testInfo.project.name), "the menu only exists below 1080px");
  await page.goto("/");
  const menu = page.locator("header.nav details.mobile-primary-nav");
  await menu.locator("summary").click();

  const panel = page.locator("header.nav details.mobile-primary-nav nav");
  await expect(panel).toBeVisible();
  const geometry = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: Math.round(rect.left), right: Math.round(rect.right), viewport: window.innerWidth };
  });
  expect(geometry.left, `panel starts at x=${geometry.left}`).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);

  // Every section is reachable and every row is inside the viewport, not just the panel box.
  const links = panel.getByRole("link");
  await expect(links).toHaveCount(7);
  for (const label of ["Product", "Solutions", "Integrations", "Developers", "Security", "Pricing", "Resources"]) {
    await expect(panel.getByRole("link", { name: label, exact: true })).toBeVisible();
  }

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  // Escape hands the reader back the control they opened rather than the top of the document.
  await expect(menu.locator("summary")).toBeFocused();
});

test("the mobile menu closes when it is used", async ({ page }, testInfo) => {
  test.skip(!NARROW.includes(testInfo.project.name), "the menu only exists below 1080px");
  await page.goto("/");
  const menu = page.locator("header.nav details.mobile-primary-nav");
  await menu.locator("summary").click();
  await menu.getByRole("link", { name: "Pricing", exact: true }).click();
  await page.waitForURL(/\/pricing$/);
  // The header is shared across routes, so the panel survives the navigation unless it is told
  // not to: after the first tap it used to stay open over the page just asked for.
  await expect(page.locator("header.nav details.mobile-primary-nav nav")).toBeHidden();
});

/*
  A stage plays to the end of its cut, and a visitor who chooses one keeps it.

  `STAGE_MS` was 5,000 against `FILM_DURATION = 18`. The interval now comes from that constant,
  and the video path also advances on the element's own `ended`. The windows below are wide on
  purpose: the assertion is "not a five-second cycle" and "the cut got to finish", not a
  stopwatch on a decoder.
*/
test("a stage plays to the end of its cut before the strip moves", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "390", "one width is enough for a timing rule; it is slow");
  test.setTimeout(90_000);
  await showFilm(page);

  const selected = () => page.locator('#s3 .compile-film-stages button[aria-selected="true"]');
  await expect(selected()).toHaveText("SOURCES");
  await page.waitForTimeout(9_000);
  await expect(selected(), "a 5s cycle would have moved twice by now").toHaveText("SOURCES");
  await expect(selected()).toHaveText("READ", { timeout: 22_000 });
});

test("choosing a stage stops the player taking it back", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "390", "one width is enough for a timing rule; it is slow");
  test.setTimeout(90_000);
  await showFilm(page);

  await page.locator("#compile-stage-tab-structure").click();
  const selected = page.locator('#s3 .compile-film-stages button[aria-selected="true"]');
  await expect(selected).toHaveText("STRUCTURE");
  // Longer than one cut: an auto-cycle that was still armed would have moved to WORLD.
  await page.waitForTimeout(21_000);
  await expect(selected).toHaveText("STRUCTURE");
  await expect(page.locator("#s3 .compile-film-caption p")).toHaveText(
    "Meaning resolves across sources. Changes propagate only where they matter.",
  );
});

test("reduced motion keeps the still and arms no timer", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "reduced-motion", "the preference is set by this test");
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await showFilm(page);

  await expect(page.locator("#s3 .compile-film-still")).toBeVisible();
  await expect(page.locator("#s3 .compile-film-video")).toHaveCount(0);
  await expect(page.locator("#s3 .compile-film-live canvas")).toHaveCount(0);
  const selected = page.locator('#s3 .compile-film-stages button[aria-selected="true"]');
  await expect(selected).toHaveText("SOURCES");
  await page.waitForTimeout(21_000);
  await expect(selected, "reduced motion must not advance the stage on a timer").toHaveText("SOURCES");
  // Motion is removed; the strip is not. Selecting a stage still changes what is on screen.
  await page.locator("#compile-stage-tab-world").click();
  await expect(page.locator("#s3 .compile-film-still")).toHaveAttribute("src", "/film/poster-4.webp");
});

test("the stage strip is still a tablist", async ({ page }) => {
  await showFilm(page);
  const tabs = page.locator('#s3 .compile-film-stages [role="tab"]');
  await expect(tabs).toHaveCount(4);
  await expect(page.locator('#s3 .compile-film-stages[role="tablist"]')).toHaveCount(1);
  await expect(page.locator("#s3 #compile-stage-panel")).toHaveAttribute("role", "tabpanel");
});

/*
  Touch targets, measured on a touch context.

  The width projects run with a fine pointer, so `(pointer: coarse)` -- which is what the touch
  floor is keyed on -- does not match in them. This block asks for the same widths with a touch
  screen, which is the combination a phone actually presents.
*/
test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });

  test("every control a thumb can reach is at least 44px tall", async ({ page }, testInfo) => {
    test.skip(!NARROW.includes(testInfo.project.name), "the floor is specified for touch phones");
    await page.goto("/");
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 400) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      window.scrollTo(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    const short = await page.evaluate(() => {
      const found: { tag: string; cls: string; text: string; height: number }[] = [];
      for (const element of document.querySelectorAll("a, button, summary, [role='tab']")) {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.height < 44) found.push({ tag: element.tagName.toLowerCase(), cls: String(element.className || "").slice(0, 30), text: (element.textContent ?? "").trim().slice(0, 20), height: Math.round(rect.height) });
      }
      return found;
    });
    expect(short, `controls under 44px tall: ${JSON.stringify(short)}`).toEqual([]);
  });

  /*
    The touch floor costs width, and the header is where it is paid.

    Raising Sign in to a 44px target widened the header row by 18px, which at 360 put the access
    action's right edge at 370 in a 360px viewport -- invisible to every existing check, because
    `overflow-x: hidden` clips it and `document.scrollWidth` stays clean. This is the same header
    assertion as above, run with the pointer that turns the floor on.
  */
  test("the touch floor does not push the header past the right edge", async ({ page }, testInfo) => {
    test.skip(!NARROW.includes(testInfo.project.name), "the floor is specified for touch phones");
    await page.goto("/");
    const header = await page.evaluate(() => {
      const actions = document.querySelector("header.nav .nav-actions")!.getBoundingClientRect();
      const menu = document.querySelector("header.nav .mobile-primary-nav summary")!.getBoundingClientRect();
      return { actionsRight: Math.round(actions.right), menuRight: Math.round(menu.right), actionsLeft: Math.round(actions.left), viewport: window.innerWidth };
    });
    expect(header.actionsRight, `the access action ends at x=${header.actionsRight} in a ${header.viewport}px viewport`).toBeLessThanOrEqual(header.viewport);
    expect(header.menuRight).toBeLessThanOrEqual(header.actionsLeft);
  });
});
