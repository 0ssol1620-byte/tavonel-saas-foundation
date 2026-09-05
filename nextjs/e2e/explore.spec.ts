const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

type Page = import("@playwright/test").Page;

/*
  The Explore stage, act by act.

  The unit tests own the arithmetic: `explore-change.test.ts` proves the counts came from two
  compiles, `visual-world-model.test.ts` proves the composition was chosen from the read model.
  What only a browser can answer is whether any of it reaches the screen -- whether the world is
  drawn, whether an object opens onto its own page region, whether the machine detail is really
  absent until it is asked for, and whether a phone gets a stacked flow instead of a squeezed
  desktop.
*/

const STAGE = '[data-visual-world="explore"]';
const NODE = "[data-visual-node]";

async function enterWorld(page: Page) {
  await page.goto("/explore");
  await page.getByRole("button", { name: "ENTER WORLD" }).click();
  await expect(page.locator(STAGE)).toHaveAttribute("data-world-act", "world");
}

test("the entry is one way in, with the world already behind it", async ({ page }) => {
  await page.goto("/explore");
  await expect(page.getByRole("heading", { name: "Step inside a Compiled World." })).toBeVisible();
  await expect(
    page.getByText(/Explore how knowledge, relationships and answers remain connected/),
  ).toBeVisible();
  await expect(page.locator(STAGE)).toHaveAttribute("data-world-act", "entry");
  // The sample declares itself once, in the header badge, and never argues with itself again.
  await expect(page.getByText("INTERACTIVE SAMPLE")).toHaveCount(1);
  // §49: none of this is on the default surface.
  await expect(page.locator("body")).not.toContainText(/sha256:/);
  await expect(page.locator("body")).not.toContainText(/BBOX|not_yet/i);
  await expect(page.locator("body")).not.toContainText(/trusted by|customer success|certified/i);
});

test("Act 1 draws a curated composition of compiled objects", async ({ page }) => {
  await enterWorld(page);
  const nodes = page.locator(`${STAGE} ${NODE}`);
  const count = await nodes.count();
  // §18: 7-12 curated objects, never a hairball.
  expect(count).toBeGreaterThanOrEqual(7);
  expect(count).toBeLessThanOrEqual(12);

  // Every drawn node names the object it is, and every drawn edge joins two drawn nodes.
  const drawn = await page.evaluate(([stage, node]) => {
    const root = document.querySelector(stage)!;
    const ids = new Set(Array.from(root.querySelectorAll(node)).map((el) => el.getAttribute("data-node-id")));
    const edges = Array.from(root.querySelectorAll("[data-visual-edge]"));
    return {
      ids: [...ids],
      kinds: Array.from(root.querySelectorAll(node)).map((el) => el.getAttribute("data-node-kind")),
      states: Array.from(root.querySelectorAll(node)).map((el) => el.getAttribute("data-node-state")),
      danglingEdges: edges.filter((edge) =>
        !ids.has(edge.getAttribute("data-edge-from")) || !ids.has(edge.getAttribute("data-edge-to"))).length,
      edgeCount: edges.length,
    };
  }, [STAGE, NODE]);

  expect(drawn.ids.length).toBe(count);
  expect(drawn.danglingEdges, "an edge must join two drawn objects").toBe(0);
  expect(drawn.edgeCount).toBeGreaterThan(0);
  expect(drawn.kinds).toContain("Claim");
  expect(drawn.kinds).toContain("Evidence");
  // The opening composition is colourless: nothing here is claimed as an active fact.
  expect([...new Set(drawn.states)]).toEqual(["candidate"]);

  await expect(page.getByText("SELECT AN OBJECT")).toBeVisible();
  await expect(page.getByText(/^SHOWING \d+ OF \d+ COMPILED OBJECTS$/)).toBeVisible();
});

test("Act 2 opens an object onto the page region it was compiled from", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "390" || testInfo.project.name === "360");
  await enterWorld(page);
  await page.locator(`${STAGE} ${NODE}[data-node-kind="Claim"]`).first().click();
  await expect(page.locator(STAGE)).toHaveAttribute("data-world-act", "evidence");

  // The source sheet names the file, not the relation list that happens to name it too.
  await expect(page.locator("[data-source-sheet]").getByText(/^fp-200-[a-z0-9-]+\.pdf$/i)).toBeVisible();
  await expect(page.getByText(/^REGION ON PAGE \d+ OF \d+$/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Open source PDF/ })).toBeVisible();
  // The marked line is the region the object came from, and it is one line, not the page.
  await expect(page.locator("[data-active-region]")).toHaveCount(1);
  // The tether is the drawn claim: object to region, measured rather than described.
  await expect(page.locator(`${STAGE} svg path[pathLength="1"]`)).toHaveCount(1);
  // Still no machine detail until it is asked for.
  await expect(page.locator("body")).not.toContainText(/sha256:/);
});

test("Act 3 reports the revision with derived counts and claims no equivalence", async ({ page }) => {
  await page.goto("/explore?act=change");
  await expect(page.locator(STAGE)).toHaveAttribute("data-world-act", "change_compare");

  await expect(page.getByText("REVISION B → REVISION C")).toBeVisible();
  await expect(page.getByText(/every 1,500 operating hours/)).toBeVisible();
  await expect(page.getByText(/every 2,000 operating hours/).first()).toBeVisible();
  // `exact` because the caption above the figures uses the same words in a sentence; the
  // assertion is about the labelled figure, not about the prose that introduces it.
  await expect(page.getByText("Objects reached", { exact: true })).toBeVisible();
  await expect(page.getByText("Carried over untouched", { exact: true })).toBeVisible();
  await expect(page.getByText(/\d+ added · \d+ removed · \d+ rebuilt in place/)).toBeVisible();

  // The world reports both halves of the sentence it is making.
  await expect(page.locator(`${NODE}[data-node-state="affected"]`).first()).toBeVisible();
  await expect(page.locator(`${NODE}[data-node-state="dim"]`).first()).toBeVisible();

  await expect(page.getByText("FULL-REBUILD EQUIVALENCE", { exact: true })).toBeVisible();
  await expect(page.getByText("NOT ESTABLISHED IN THIS DEPLOYMENT", { exact: true })).toBeVisible();
  await expect(page.getByText(/the comparison is between two complete compiles/)).toBeVisible();
  // No badge for a check that did not run.
  await expect(page.getByText("PASS", { exact: true })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/not_yet/i);
});

test("Ask quotes the source and its citation lands in the Evidence act", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "390" || testInfo.project.name === "360");
  await enterWorld(page);
  await page.getByRole("button", { name: /Ask this World/ }).click();
  const panel = page.getByRole("dialog", { name: "Ask this World" });
  await expect(panel).toBeVisible();

  await panel.getByRole("button", { name: "How many operating hours between full services?" }).click();
  await expect(panel.getByText(/2,000 operating hours/).first()).toBeVisible();
  await expect(panel.getByText(/^\d+ SOURCE REGIONS?$/)).toBeVisible();
  // §49 keeps the relevance decimal off the stage.
  await expect(panel).not.toContainText(/relevance/i);

  await panel.getByRole("button", { name: /fp-200-.*\.pdf/ }).first().click();
  await expect(page.locator(STAGE)).toHaveAttribute("data-world-act", "evidence");
  await expect(page.locator("[data-active-region]")).toHaveCount(1);
});

test("the technical drawer holds everything the stage keeps out of the way", async ({ page }) => {
  await enterWorld(page);
  await expect(page.locator("body")).not.toContainText(/sha256:/);

  await page.getByRole("button", { name: "TECHNICAL DETAILS" }).click();
  const drawer = page.getByRole("dialog", { name: "TECHNICAL DETAILS" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText(/^sha256:[a-f0-9]{64}$/).first()).toBeVisible();
  await expect(drawer.getByText("Manifest digest")).toBeVisible();
  await expect(drawer.getByText("Evidence id")).toBeVisible();
  await expect(drawer.getByText("Bbox (per mille)")).toBeVisible();
  await expect(drawer.getByText(/tavonel-collection-compiler/)).toBeVisible();
  // §49 moved the entity qualifier here; it must still be legible somewhere.
  await expect(drawer.getByText(/capitalised-token heuristic, not by a resolver/)).toBeVisible();
  await expect(drawer.getByText(/3 of 15 baseline labels were true positives/)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("the world is navigable from the keyboard and Escape steps back", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "390" || testInfo.project.name === "360");
  await enterWorld(page);
  const first = page.locator(`${STAGE} ${NODE}`).first();
  await first.focus();
  await expect(first).toBeFocused();

  await page.keyboard.press("ArrowDown");
  const afterDown = await page.evaluate(() => document.activeElement?.getAttribute("data-node-id"));
  expect(afterDown, "ArrowDown moves within a source column").not.toBeNull();

  await page.keyboard.press("ArrowRight");
  const afterRight = await page.evaluate(() => document.activeElement?.getAttribute("data-node-id"));
  expect(afterRight, "ArrowRight moves to the next source").not.toBe(afterDown);

  await page.keyboard.press("Enter");
  await expect(page.locator(STAGE)).toHaveAttribute("data-world-act", "evidence");
  await page.keyboard.press("Escape");
  await expect(page.locator(STAGE)).toHaveAttribute("data-world-act", "world");
});

test("a phone walks World, Object, Source as steps rather than shrinking three panels", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "390" && testInfo.project.name !== "360");
  await enterWorld(page);
  await page.locator(`${STAGE} ${NODE}[data-node-kind="Claim"]`).first().click();
  await expect(page.locator(STAGE)).toHaveAttribute("data-world-act", "object_focus");
  await expect(page.getByRole("link", { name: /Open source PDF/ })).toBeHidden();

  await page.getByRole("button", { name: /Open the source region/ }).click();
  await expect(page.locator(STAGE)).toHaveAttribute("data-world-act", "evidence");
  await expect(page.getByText(/^REGION ON PAGE \d+ OF \d+$/)).toBeVisible();

  await page.getByRole("button", { name: "Back to the World" }).click();
  await expect(page.locator(STAGE)).toHaveAttribute("data-world-act", "object_focus");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the stage must not scroll sideways on a phone").toBeLessThanOrEqual(1);
});

test("reduced motion removes the transitions and none of the content", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "reduced-motion");
  /*
    The preference is set here as well as in the project.

    `playwright.config.ts` declares `use: { reducedMotion: "reduce" }` for this project and the
    resolved config carries it, but on this runner the context does not act on it: inside the
    project, `matchMedia("(prefers-reduced-motion: reduce)")` answers false until
    `page.emulateMedia` is called, so every reduced-motion reading taken without this line is a
    reading of the ordinary page. Asserting on that would be worse than not asserting at all --
    it would report a stillness nobody had checked. The project option is left alone; this makes
    the preference true for the one test that depends on it.
  */
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/explore?act=world");
  await expect(page.locator(STAGE)).toHaveAttribute("data-world-act", "world");
  // The state swap is immediate; the objects are still all there.
  const timings = await page.$$eval("[data-visual-node]", (elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element);
      return `${style.transitionDuration}|${style.animationDuration}`;
    }));
  expect(timings.length).toBeGreaterThanOrEqual(7);
  expect([...new Set(timings)]).toEqual(["0s|0s"]);

  await page.goto("/explore?act=change");
  await expect(page.locator(STAGE)).toHaveAttribute("data-world-act", "change_compare");
  await expect(page.getByText("FULL-REBUILD EQUIVALENCE", { exact: true })).toBeVisible();
  await expect(page.locator(`${NODE}[data-node-state="affected"]`).first()).toBeVisible();
  const pulses = await page.$$eval('[data-node-state="affected"]', (elements) =>
    elements.map((element) => getComputedStyle(element).animationName));
  expect([...new Set(pulses)]).toEqual(["none"]);
});

test("the closing action offers the reader their own sources", async ({ page }) => {
  await page.goto("/explore");
  await expect(page.getByRole("heading", { name: "Try the same path with your own knowledge." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start with your files" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect a source" })).toBeVisible();
  await expect(page.getByRole("link", { name: "How compilation works" })).toBeVisible();
});
