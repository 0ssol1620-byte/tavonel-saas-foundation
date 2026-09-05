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

type Locator = {
  count: () => Promise<number>;
  first: () => Locator;
  nth: (index: number) => Locator;
  locator: (selector: string) => Locator;
  innerText: () => Promise<string>;
  getAttribute: (name: string) => Promise<string | null>;
  isVisible: () => Promise<boolean>;
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
  expect(await selective.innerText()).toContain("Not offered as a shipped capability");
});

test("draws the whole source-change flow, and says which half of it runs here", async ({ page }: { page: Page }) => {
  await page.goto(ROUTE);

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
  expect((await page.locator("[data-contract-bypass]").first().innerText()).replace(/\s+/g, " "))
    .toContain("FULL RECOMPILE");
});

test("lists the nine interchange standards without implying all nine are emitted", async ({ page }: { page: Page }) => {
  await page.goto(ROUTE);

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
