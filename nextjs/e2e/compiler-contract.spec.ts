/**
 * The Compiler Contract page, in a browser, at every width the suite runs.
 *
 * The unit test next to `lib/compiler-contract.ts` already holds the states honest. What only a
 * browser can answer is whether the reader actually sees them: a state chip that renders behind
 * its own row, a ten-box flow diagram scaled to a grey smear on a phone, or a wide drawing that
 * pushes the whole document sideways are all failures the type checker is blind to.
 *
 * The assertions are therefore about what is on screen and where: every clause carries a visible
 * state word, nothing overflows the thing that holds it, and the page never scrolls sideways at
 * any width. The reduced-motion project runs the same file, which is how "reduced motion removes
 * transitions, never content" gets checked -- the counts below must be identical in that project.
 */

const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;
import type { Page as BrowserPage } from "@playwright/test";

type Locator = {
  count: () => Promise<number>;
  first: () => Locator;
  nth: (index: number) => Locator;
  locator: (selector: string) => Locator;
  innerText: () => Promise<string>;
  /* `innerText` is an HTMLElement property, so it is not available on the SVG drawing. */
  textContent: () => Promise<string | null>;
  getAttribute: (name: string) => Promise<string | null>;
  isVisible: () => Promise<boolean>;
  click: () => Promise<void>;
};

type Page = {
  goto: (url: string) => Promise<unknown>;
  evaluate: <T>(fn: (...args: never[]) => T, arg?: unknown) => Promise<T>;
  locator: (selector: string) => Locator;
  title: () => Promise<string>;
};

const ROUTE = "/product/continuous-knowledge";

/** The two words this page is allowed to grade a clause with today. */
const ALLOWED_STATES = ["DEMONSTRATED", "DIRECTION"];

test("publishes the eight clauses, each with a state a reader can see", async ({ page }: { page: Page }) => {
  await page.goto(ROUTE);

  const clauses = page.locator("[data-contract-clause]");
  expect(await clauses.count()).toBe(8);

  for (let index = 0; index < 8; index += 1) {
    const clause = clauses.nth(index);
    const label = clause.locator("[data-state-label]").first();
    expect(await label.isVisible(), `clause ${index + 1} hides its state`).toBe(true);
    const text = (await label.innerText()).trim();
    expect(ALLOWED_STATES, `clause ${index + 1} is graded "${text}"`).toContain(text);
  }
});

/*
  The claim this page must never make by accident.

  "Qualified" means a receipt exists. None does on this deployment, and the page says so in its
  own copy -- but copy can be edited without editing the data, so the rendered document is
  checked for the word rather than the module that produces it.
*/
test("grades no clause as qualified, because no receipt is published here", async ({ page }: { page: Page }) => {
  await page.goto(ROUTE);

  const graded = await page.evaluate(() =>
    [...document.querySelectorAll("[data-contract-clause]")].map((node) => node.getAttribute("data-state")),
  );
  expect(graded).not.toContain("qualified");

  // Selective recompilation is the row the product is most tempted to upgrade, so it is named.
  const selective = page.locator("#selective-recompilation");
  expect(await selective.getAttribute("data-state")).toBe("direction");
  /*
     The wording moved on 2026-09-22 when the clause stopped narrating its own wiring; the fact
     it has to carry did not. What is asserted is still that the rendered row says the capability
     is not shipped, and the row must not name the environment flag it used to name.
  */
  await selective.locator("details > summary").click();
  expect(await selective.innerText()).toContain("is not available today");
  expect(await selective.innerText()).not.toContain("CORE_V2_REVISION_COMPILE");
});

test("draws the whole source-change flow, and says which half of it runs here", async ({ page }: { page: Page }) => {
  await page.goto(ROUTE);

  await page.locator('[data-contract-reference="flow"] > summary').click();
  const diagram = page.locator("[data-contract-flow]").first();
  expect(await diagram.isVisible()).toBe(true);
  // The accessible name is the drawing's only content for a reader who cannot see it.
  expect(await diagram.getAttribute("aria-labelledby")).toContain("contract-flow-desc");

  const stages = await page.evaluate(() =>
    [...document.querySelectorAll("[data-contract-stage]")].map((node) => ({
      id: node.getAttribute("data-contract-stage"),
      state: node.getAttribute("data-state"),
    })),
  );
  expect(stages.map((stage) => stage.id)).toEqual([
    "source-change",
    "semantic-diff",
    "dependency-impact",
    "preserved",
    "recompiled",
    "equivalence",
    "pass",
    "refuse",
    "new-world",
    "previous-world",
  ]);
  /*
    Two stages run here, and the assertion is written from that side.

    An earlier version listed the five stages that had to stay dashed, which pinned the other
    five as built without ever saying so -- and two of them (the semantic diff of a source change,
    and the dependency impact resolved from it) are not implemented anywhere in this deployment.
    Asserting the built set instead means adding a stage cannot silently promote it.
  */
  expect(stages.filter((stage) => stage.state === "built").map((stage) => stage.id))
    .toEqual(["source-change", "new-world"]);

  // And the one solid route between them is the full recompile, named in the drawing.
  const bypass = page.locator("[data-contract-edge='full-recompile']").first();
  expect(await bypass.getAttribute("data-state")).toBe("built");
  // textContent, not innerText: the label is three <text> nodes inside the SVG, and innerText
  // is an HTMLElement property that Playwright refuses on an SVG node.
  expect(((await page.locator("[data-contract-bypass]").first().textContent()) ?? "").replace(/\s+/g, " "))
    .toContain("FULL RECOMPILE");
});

/*
  The /product index it is linked from must not gain an orphan slot because of that link.

  A fourth card in a three-column grid leaves one card beside two empty tracks on row two, which
  the visual rules bar. This lane added the fourth card, so this lane checks the row.
*/
test("leaves no orphan slot in the product surface grid", async ({ page }: { page: Page }) => {
  await page.goto("/product");

  const layout = await page.evaluate(() => {
    const grid = document.querySelector(".product-surface-grid");
    if (!grid) return { columns: 0, cards: 0, rows: [] as number[] };
    const columns = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length;
    const rows = [...new Set([...grid.children].map((card) => Math.round(card.getBoundingClientRect().top)))];
    return { columns, cards: grid.children.length, rows };
  });

  expect(layout.cards).toBeGreaterThan(0);
  expect(layout.columns).toBeGreaterThan(0);
  expect(
    layout.cards % layout.columns,
    `${layout.cards} cards in ${layout.columns} columns leaves ${layout.columns - (layout.cards % layout.columns)} empty slot(s)`,
  ).toBe(0);
  expect(layout.rows.length).toBe(layout.cards / layout.columns);
});

test("lists the nine interchange standards without implying all nine are emitted", async ({ page }: { page: Page }) => {
  await page.goto(ROUTE);
  await page.locator('[data-contract-reference="interop"] > summary').click();
  expect(await page.locator('[data-interop-standards]').isVisible()).toBe(true);

  const rows = await page.evaluate(() =>
    [...document.querySelectorAll("[data-interop-standard]")].map((node) => ({
      name: node.querySelector("b")?.textContent ?? "",
      state: node.getAttribute("data-state"),
    })),
  );
  expect(rows.map((row) => row.name)).toEqual([
    "RDF",
    "Turtle",
    "JSON-LD",
    "OWL 2",
    "SHACL",
    "PROV-O",
    "OpenLineage",
    "OpenAPI",
    "MCP",
  ]);
  expect(rows.filter((row) => row.state === "demonstrated").map((row) => row.name))
    .toEqual(["RDF", "Turtle", "JSON-LD", "OpenAPI", "MCP"]);
});

/*
  Nothing sticks out of the thing that holds it.

  The wide drawing is the reason this test exists: a 980-unit flowchart with a `min-width` for
  phones is exactly the shape that turns a document into a horizontally scrolling one, and the
  fix -- a scroll container around the drawing rather than around the page -- is only observable
  in a browser at a real width.
*/
test("never scrolls the document sideways, at any width", async ({ page }: { page: Page }) => {
  await page.goto(ROUTE);

  await page.locator('[data-contract-reference="flow"] > summary').click();
  await page.locator('[data-contract-reference="interop"] > summary').click();
  const details = page.locator('[data-contract-detail] > summary');
  for (let index = 0; index < await details.count(); index += 1) await details.nth(index).click();
  const overflow = await page.evaluate(() => {
    const problems: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) {
      problems.push(`document scrolls sideways: ${doc.scrollWidth} > ${doc.clientWidth}`);
    }
    const containers = ["[data-contract-clauses]", "[data-interop-standards]"];
    for (const selector of containers) {
      const holder = document.querySelector(selector);
      if (!holder) {
        problems.push(`${selector} is missing`);
        continue;
      }
      const bounds = holder.getBoundingClientRect();
      for (const child of holder.children) {
        const box = child.getBoundingClientRect();
        if (box.right > bounds.right + 1 || box.left < bounds.left - 1) {
          problems.push(`${selector}: a child runs from ${Math.round(box.left)} to ${Math.round(box.right)} inside ${Math.round(bounds.left)}..${Math.round(bounds.right)}`);
        }
      }
    }
    return problems;
  });
  expect(overflow).toEqual([]);
});

test("is reachable from the product index and names itself in the tab", async ({ page }: { page: Page }) => {
  await page.goto("/product");
  const link = page.locator(`a[href="${ROUTE}"]`).first();
  expect(await link.isVisible()).toBe(true);

  await page.goto(ROUTE);
  expect(await page.title()).toContain("Continuous recompilation");
});

// TAV-014: product behaviour and real comparisons precede optional contract detail.
test("leads with version comparison and keeps technical explanations optional", async ({ page }: { page: Page }) => {
  await page.goto(ROUTE);
  expect(await page.locator("h1").innerText()).toBe("See what changed before you activate it.");
  expect(await page.locator(".world-recompile").isVisible()).toBe(true);
  const overview = page.locator('[aria-labelledby="working-summary"]');
  expect(await overview.innerText()).toContain("Selective recompilation is not available today");
  const change = overview.locator('a[href="/explore?act=change"]');
  expect(await change.isVisible()).toBe(true);
  expect(await overview.locator('a[href="#clauses"]').isVisible()).toBe(true);
  const defaultState = await page.evaluate(() => ({
    clauses: [...document.querySelectorAll("[data-contract-detail]")].map(element => element.hasAttribute("open")),
    references: [...document.querySelectorAll("[data-contract-reference]")].map(element => element.hasAttribute("open")),
    actions: [...document.querySelectorAll<HTMLElement>('[aria-labelledby="working-summary"] a')].map(element => ({ height: element.getBoundingClientRect().height, width: element.getBoundingClientRect().width })),
  }));
  expect(defaultState.clauses).toEqual(Array(8).fill(false));
  expect(defaultState.references).toEqual([false, false]);
  for (const action of defaultState.actions) { expect(action.height).toBeGreaterThanOrEqual(44); expect(action.width).toBeGreaterThanOrEqual(44); }
});

// TAV-014 follow-on: exercise the reader's actions, then retain both disclosure states as files.
test("keeps the summary first and supports keyboard reading and Change navigation", async ({ page }: { page: BrowserPage }) => {
  test.skip(!["390", "1440"].includes(test.info().project.name), "bounded phone and desktop acceptance");
  test.setTimeout(90_000);
  const width = page.viewportSize()!.width;
  expect([390, 1440]).toContain(width);
  await page.goto(ROUTE);
  const consent = page.getByRole("region", { name: "Optional analytics" });
  await expect(consent).toBeVisible();
  await page.getByRole("button", { name: "No thanks", exact: true }).click();
  await expect(consent).toBeHidden();

  const summary = page.locator('[aria-labelledby="working-summary"]');
  const compare = summary.getByRole("link", { name: "Compare the public World versions", exact: true });
  const contract = summary.getByRole("link", { name: "Read the eight-clause Compiler Contract", exact: true });
  const order = await page.evaluate(() => {
    const heading = document.querySelector("h1")!;
    const summary = document.querySelector('[aria-labelledby="working-summary"]')!;
    const timeline = document.querySelector(".world-recompile")!;
    return {
      headingBeforeSummary: Boolean(heading.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING),
      summaryBeforeTimeline: Boolean(summary.compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING),
      headingBottom: heading.getBoundingClientRect().bottom,
      summaryTop: summary.getBoundingClientRect().top,
      summaryBottom: summary.getBoundingClientRect().bottom,
      timelineTop: timeline.getBoundingClientRect().top,
    };
  });
  expect(order.headingBeforeSummary).toBe(true);
  expect(order.summaryBeforeTimeline).toBe(true);
  if (width === 390) {
    expect(order.headingBottom).toBeLessThanOrEqual(order.summaryTop + 1);
    expect(order.summaryBottom).toBeLessThanOrEqual(order.timelineTop + 1);
  }
  const disclosures = page.locator("[data-contract-detail], [data-contract-reference]");
  await expect(disclosures).toHaveCount(10);
  await expect(page.locator("[data-contract-detail][open], [data-contract-reference][open]")).toHaveCount(0);
  const capture = async (state: "default" | "expanded") => {
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
    const name = `continuous-knowledge-${state}-${width}.png`;
    const path = test.info().outputPath(name);
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    await test.info().attach(name, { path, contentType: "image/png" });
  };
  await capture("default");

  // Begin at the comparison action, then use the browser's real next-focus and activation keys.
  await compare.focus();
  await page.keyboard.press("Tab");
  await expect(contract).toBeFocused();
  await expect(contract).not.toHaveCSS("outline-style", "none");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/product\/continuous-knowledge#clauses$/);
  await expect.poll(() => page.evaluate(() => {
    const heading = document.querySelector("#clauses")!.getBoundingClientRect();
    const header = document.querySelector("header.nav")!.getBoundingClientRect();
    return heading.top >= header.bottom - 1 && heading.bottom <= innerHeight;
  }), { message: "the activated clauses heading clears the fixed public header" }).toBe(true);

  // Native summaries must open and close by keyboard, with their actual content visible only when open.
  for (const [selector, content] of [
    ["#evidence-preserving [data-contract-detail]", ":scope > div"],
    ['[data-contract-reference="flow"]', "[data-contract-flow]"],
    ['[data-contract-reference="interop"]', "[data-interop-standards]"],
  ]) {
    const disclosure = page.locator(selector);
    const toggle = disclosure.locator(":scope > summary");
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await expect(toggle).not.toHaveCSS("outline-style", "none");
    await page.keyboard.press("Enter");
    await expect(disclosure).toHaveAttribute("open", "");
    await expect(disclosure.locator(content)).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(disclosure).not.toHaveAttribute("open", "");
    await expect(disclosure.locator(content)).toBeHidden();
    await expect(toggle).toBeFocused();
  }

  for (let index = 0; index < await disclosures.count(); index += 1) {
    await disclosures.nth(index).locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
    await expect(disclosures.nth(index)).toHaveAttribute("open", "");
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await capture("expanded");

  await compare.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/explore\?act=(change|change_compare)$/);
  const changeStage = page.locator('[data-visual-world="explore"]');
  await expect(changeStage).toBeVisible();
  await expect(changeStage).toHaveAttribute("data-world-act", "change_compare");
});
