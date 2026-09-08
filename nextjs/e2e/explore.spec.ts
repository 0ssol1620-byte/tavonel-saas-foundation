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

/*
  Narrow is a breakpoint, not a list of project names.

  These tests used to branch on `project.name === "390" || "360"`, which is only the same
  question as "is this the stacked flow?" for the two projects someone happened to think of. The
  stage's breakpoint is `NARROW_STAGE_QUERY` in `components/world-visual/use-stage-media.ts` --
  `(max-width: 820px)` -- so the 768 project was on the phone path while every desktop-only
  assertion in this file still ran against it, and five tests failed for a reason none of them
  was about: no inline edge labels, an object that stops on the object step, no Previous/Next
  until the step after that.

  The viewport width is the part a `test.skip` can read before the page exists. `Act 1` asserts
  below that the stage's own `data-narrow` agrees with it, so this constant cannot drift away
  from the stylesheet without a test saying so.
*/
const NARROW_STAGE_MAX = 820;
const isNarrow = (page: Page) => (page.viewportSize()?.width ?? 1440) <= NARROW_STAGE_MAX;

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
  // The stage's own answer to "am I the stacked flow?", pinned against the width this file
  // branches on. If the stylesheet's breakpoint moves, this is where it is noticed.
  await expect(page.locator(STAGE)).toHaveAttribute("data-narrow", isNarrow(page) ? "1" : "0");
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
  // §11.4's declared presentation subset: one node per compiled filing, plus the objects named
  // in `PRESENTATION_OBJECTS`. Anything else in the opening frame means the subset stopped being
  // one; `visual-world-model.test.ts` is what proves each of those names still resolves.
  expect(drawn.kinds).toContain("Document");
  expect(drawn.kinds).toContain("Entity");
  expect([...new Set(drawn.kinds)].sort()).toEqual(["Document", "Entity"]);
  // The opening composition is colourless: nothing here is claimed as an active fact.
  expect([...new Set(drawn.states)]).toEqual(["candidate"]);

  await expect(page.getByText("SELECT AN OBJECT")).toBeVisible();
  await expect(page.getByText(/^SHOWING \d+ OF \d+ COMPILED OBJECTS$/)).toBeVisible();

  const firstFiling = page.locator(`${STAGE} ${NODE}[data-node-kind="Document"]`).first();
  await firstFiling.click();
  await expect(page.locator(STAGE)).toHaveAttribute("data-world-act", "world");
  await expect(firstFiling).toHaveAttribute("data-selected", "1");
  if (isNarrow(page)) {
    // The narrow composition removes unrelated nodes and inline SVG edge labels rather than
    // shrinking a desktop hairball. The same compiled predicates remain readable in the
    // selected object's Direct relations list.
    await expect(page.locator('[aria-label="Direct relations"]')).toBeVisible();
    await expect(page.locator(`${STAGE} ${NODE}[data-focus-dimmed="1"]`).first()).toBeHidden();
  } else {
    await expect(page.locator(`${STAGE} [data-relation-label]`).first()).toBeVisible();
    await expect(page.locator(`${STAGE} ${NODE}[data-focus-dimmed="1"]`).first()).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Open source evidence" })).toBeVisible();
});

test("Act 1 offers the same composition as an accessible list", async ({ page }) => {
  // §20: the canvas is not the only reading. Every drawn object, its relations and its evidence
  // link have to be reachable as text, on every width.
  await enterWorld(page);
  const list = page.locator("details", { hasText: "Objects, relations and evidence as a list" });
  await list.getByRole("group").or(list.locator("summary")).first().click();
  const objects = list.locator("[data-parallel-object]");
  const drawn = await page.locator(`${STAGE} ${NODE}`).count();
  expect(await objects.count()).toBe(drawn);
  await expect(list.getByRole("button", { name: /^Open evidence · \d+ source regions?$/ }).first()).toBeVisible();

  await objects.first().click();
  await expect(page.locator(STAGE)).toHaveAttribute("data-world-act", "world");
  await expect(page.locator(`${STAGE} ${NODE}[data-selected="1"]`)).toHaveCount(1);
});

test("Act 2 opens an object onto the page region it was compiled from", async ({ page }) => {
  test.skip(isNarrow(page));
  await enterWorld(page);
  await page.locator(`${STAGE} ${NODE}[data-node-kind="Document"]`).first().click();
  await page.getByRole("button", { name: "Open source evidence" }).click();
  await expect(page.locator(STAGE)).toHaveAttribute("data-world-act", "evidence");

  // The source sheet names the file, not the relation list that happens to name it too.
  const sheet = page.locator("[data-source-sheet]");
  await expect(sheet.getByText(/^apple-\d{4}(-\d+)?-.*\.pdf$/i).first()).toBeVisible();
  await expect(page.getByText(/^REGION ON PAGE \d+ OF \d+$/)).toBeVisible();
  await expect(page.getByText("This object is supported by this exact source region.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Verify on SEC/ })).toBeVisible();
  // The marked line is the region the object came from, and it is one line, not the page.
  await expect(page.locator("[data-active-region]")).toHaveCount(1);
  // The tether is the drawn claim: object to region, measured rather than described.
  await expect(page.locator(`${STAGE} svg path[pathLength="1"]`)).toHaveCount(1);

  /*
    §11.3 and §11.6, and the one deliberate exception to "no machine detail on the default
    surface".

    The evidence view is the single place a digest belongs on screen, because it is the single
    place the distinction can be misread: for a 2026 filing the page shown is a reference render
    of an SEC EDGAR HTML primary document, and a reader given a rendered page and one hash would
    reasonably take it for the original. So the sheet prints filing, source, representation, both
    digests, page, bbox, accession and authority -- and everything else about the compile stays
    behind TECHNICAL DETAILS.
  */
  const provenance = page.locator("[data-source-provenance]");
  await expect(provenance).toBeVisible();
  await expect(provenance.getByText(/^(Reference render|Original) · apple-/)).toBeVisible();
  await expect(provenance.getByText(/bbox \(per mille\) \d+, \d+, \d+, \d+/)).toBeVisible();
  await expect(provenance.getByText(/^\d{10}-\d{2}-\d{6}$/)).toBeVisible();
  await expect(provenance.getByText("official")).toBeVisible();
  const digests = await provenance.getByText(/^sha256:[a-f0-9]{64}$/).count();
  expect(digests, "an original and its representation are two digests, never one").toBeGreaterThan(0);
});

test("a reference render never presents itself as the acquired original", async ({ page }) => {
  test.skip(isNarrow(page));
  /*
    The single most convenient untruth available on this page. The 2026 filings' acquired sources
    are HTML; the committed PDFs are deterministic renders of them. Opening one of those filings
    has to say so, in words, and offer both files.
  */
  await enterWorld(page);
  await page.locator(`${STAGE} ${NODE}[data-node-kind="Document"]`).nth(1).click();
  await page.getByRole("button", { name: "Open source evidence" }).click();
  const provenance = page.locator("[data-source-provenance]");
  await expect(provenance.locator('[data-representation="reference_render"]'))
    .toContainText(/^Reference render · apple-2026-.*\.pdf/);
  await expect(provenance.locator("[data-acquired-original]"))
    .toContainText(/^SEC EDGAR primary document · apple-2026-.*\.html/);
  await expect(provenance.getByText(/^sha256:[a-f0-9]{64}$/)).toHaveCount(2);
  await expect(page.getByRole("link", { name: /Open reference render/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open acquired original/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open committed PDF/ })).toHaveCount(0);
});

test("an object with many regions is walked with previous and next", async ({ page }) => {
  test.skip(isNarrow(page));
  // §19.1: a twenty-region object cannot be navigated by a row of twenty numbered chips.
  await enterWorld(page);
  await page.locator(`${STAGE} ${NODE}[data-node-kind="Document"]`).first().click();
  await page.getByRole("button", { name: "Open source evidence" }).click();
  const group = page.getByRole("group", { name: "Source regions for this object" });
  await expect(group.getByText(/^REGION 1 OF \d+$/)).toBeVisible();
  await expect(group.getByRole("button", { name: "← PREVIOUS" })).toBeDisabled();
  await group.getByRole("button", { name: "NEXT →" }).click();
  await expect(group.getByText(/^REGION 2 OF \d+$/)).toBeVisible();
  await expect(group.getByRole("button", { name: "← PREVIOUS" })).toBeEnabled();
  await group.getByRole("button", { name: "← PREVIOUS" }).click();
  await expect(group.getByText(/^REGION 1 OF \d+$/)).toBeVisible();
});

test("Act 3 reports the arriving filings with derived counts and claims no equivalence", async ({ page }) => {
  await page.goto("/explore?act=change");
  await expect(page.locator(STAGE)).toHaveAttribute("data-world-act", "change_compare");

  await expect(page.getByText("2025 FORM 10-K → 2025 FORM 10-K + FOUR 2026 FILINGS")).toBeVisible();
  await expect(page.getByText("FILINGS THAT ARRIVED", { exact: true })).toBeVisible();

  /*
    Four filings, each opened on a region of itself, each labelled a reference render because
    that is what the compiler read. Their order is their filing order, so the Act reads as a
    timeline rather than as a ranking.
  */
  const arrivals = page.locator("[data-arrival]");
  await expect(arrivals).toHaveCount(4);
  await expect(arrivals.getByText(/^REFERENCE RENDER · /)).toHaveCount(4);
  const filed = await arrivals.locator("header b").allInnerTexts();
  expect(filed).toHaveLength(4);
  expect(filed.map((label) => label.replace(/^.*FILED /, ""))).toEqual(
    [...filed.map((label) => label.replace(/^.*FILED /, ""))].sort(),
  );
  await expect(page.locator("[data-change-breakdown]"))
    .toContainText(/\d+ source versions? added · \d+ removed · \d+ carried unchanged/);
  // `exact` because the caption above the figures uses the same words in a sentence; the
  // assertion is about the labelled figure, not about the prose that introduces it.
  await expect(page.getByText("Objects reached", { exact: true })).toBeVisible();
  await expect(page.getByText("Unchanged object identities", { exact: true })).toBeVisible();
  await expect(page.getByText(/\d+ added · \d+ removed · \d+ rebuilt in place/)).toBeVisible();

  // The world reports the diff honestly, including the identities the arrivals did not disturb.
  await expect(page.locator(`${NODE}[data-node-state="affected"]`).first()).toBeVisible();
  const unchangedCount = Number(await page.getByText("Unchanged object identities", { exact: true })
    .locator("xpath=following-sibling::dd").textContent());
  if (unchangedCount === 0) await expect(page.locator(`${NODE}[data-node-state="dim"]`)).toHaveCount(0);

  await expect(page.getByText("FULL-REBUILD EQUIVALENCE", { exact: true })).toBeVisible();
  await expect(page.getByText("NOT ESTABLISHED IN THIS DEPLOYMENT", { exact: true })).toBeVisible();
  await expect(page.getByText(/the comparison is between two complete compiles/)).toBeVisible();
  // No badge for a check that did not run.
  await expect(page.getByText("PASS", { exact: true })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/not_yet/i);
});

test("Ask quotes the source and its citation lands in the Evidence act", async ({ page }) => {
  test.skip(isNarrow(page));
  await enterWorld(page);
  await page.getByRole("button", { name: /Ask this World/ }).click();
  const panel = page.getByRole("dialog", { name: "Ask this World" });
  await expect(panel).toBeVisible();

  // Four prepared questions, reaching three different filings of the corpus.
  await expect(panel.getByRole("button", { name: /\?$/ })).toHaveCount(4);
  await panel.getByRole("button", { name: "What were net sales by reportable segment?" }).click();
  await expect(panel.getByText(/Americas/).first()).toBeVisible();
  await expect(panel.getByText(/^\d+ SOURCE REGIONS?$/)).toBeVisible();
  // §49 keeps the relevance decimal off the stage.
  await expect(panel).not.toContainText(/relevance/i);

  await panel.getByRole("button", { name: /apple-2025-form-10-k\.pdf/ }).first().click();
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
  await expect(drawer.getByText(/3 of 16 baseline labels were true positives/)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("the world is navigable from the keyboard and Escape steps back", async ({ page }) => {
  test.skip(isNarrow(page));
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

test("a phone walks World, Object, Source as steps rather than shrinking three panels", async ({ page }) => {
  test.skip(!isNarrow(page));
  await enterWorld(page);
  await page.locator(`${STAGE} ${NODE}[data-node-kind="Document"]`).first().click();
  await expect(page.locator(`${STAGE} ${NODE}[data-focus-dimmed="1"]`).first()).toBeHidden();
  await page.getByRole("button", { name: "Open source evidence" }).click();
  await expect(page.locator(STAGE)).toHaveAttribute("data-world-act", "object_focus");
  await expect(page.getByRole("link", { name: /Open committed PDF/ })).toBeHidden();

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
