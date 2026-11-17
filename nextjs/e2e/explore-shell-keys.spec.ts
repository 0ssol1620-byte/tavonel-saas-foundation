import { test, expect, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";

/*
  WO-CI-6C: a key the V34 shell handles is not also the workbench's.

  /explore carries the V34 site header (D33 #4) above a workbench that listens for Escape and "/" on
  `window`. The header's More panel closes on Escape and its navigation drawer is a modal <dialog>;
  neither stops the key, so before the stage's guard (WO-CI-6B, M3) closing the menu also closed the
  Evidence act, dropped `evidence=` from the URL and pushed a history entry, and "/" typed in the open
  drawer opened Ask behind it. The promise, held for every key the workbench handles and every surface
  the header opens: while a shell surface is open, the Evidence act stays, the URL keeps `evidence=`
  and no history entry is added.

  The guard has to hold in both engines CI runs, and they differ exactly here: WebKit does not focus a
  button on click, so a key pressed after a mouse-opened More panel targets <body>, not the header.
  So every case runs in the project's Chromium and in a WebKit browser this file launches itself, as
  e2e/site-nav.spec.ts does -- Product QA (launch-qa.yml) installs WebKit and runs the 1440 project.

  The last case is the control: with nothing open, the same Escape does reach the workbench. Without
  it, a listener that never ran would pass every case above.
*/

/** The published Solutions link into /explore, read off the page rather than typed (a region id that moves breaks nothing here). */
async function evidencePath(page: Page): Promise<string> {
  await page.goto("/solutions/knowledge-operations");
  const href = await page.locator('main a[href*="/explore?"][href*="evidence="]').first().getAttribute("href");
  expect(href, "/solutions/knowledge-operations links one passage into /explore").toBeTruthy();
  return href!;
}

type Surface = { name: string; width: number; open: (page: Page) => Promise<void>; isOpen: (page: Page) => Promise<boolean> };

const header = (page: Page) => page.locator("[data-v34-header]");
const SURFACES: Surface[] = [
  {
    name: "the More panel (mouse) at 1440",
    width: 1440,
    open: (page) => header(page).getByRole("button", { name: "More" }).click(),
    isOpen: async (page) => (await header(page).getByRole("button", { name: "More" }).getAttribute("aria-expanded")) === "true",
  },
  {
    name: "the More panel (keyboard) at 1440",
    width: 1440,
    open: async (page) => {
      await header(page).getByRole("button", { name: "More" }).focus();
      await page.keyboard.press("Enter");
    },
    isOpen: async (page) => (await header(page).getByRole("button", { name: "More" }).getAttribute("aria-expanded")) === "true",
  },
  {
    name: "the navigation drawer at 390",
    width: 390,
    open: (page) => page.getByRole("button", { name: "Open navigation" }).click(),
    isOpen: (page) => page.evaluate(() => document.querySelector("dialog:modal") !== null),
  },
];
/** Every key the workbench's own listener acts on. */
const KEYS = ["Escape", "/"] as const;

type Reading = { act: string | null; evidence: boolean; history: number };
const read = (page: Page): Promise<Reading> => page.evaluate(() => ({
  act: document.querySelector("[data-world-act]")?.getAttribute("data-world-act") ?? null,
  evidence: new URLSearchParams(location.search).has("evidence"),
  history: history.length,
}));

/** Two frames and a beat: long enough for a React commit and a `pushState` to have happened if they were going to. */
const settle = (page: Page) => page.evaluate(() => new Promise<void>((done) => {
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 300)));
}));

async function openEvidence(browser: Browser, options: BrowserContextOptions, path: string, width: number) {
  const context = await browser.newContext({ ...options, viewport: { width, height: width <= 430 ? 844 : 900 } });
  const page = await context.newPage();
  await page.goto(path);
  await expect(page.locator("[data-world-act]")).toHaveAttribute("data-world-act", "evidence");
  await settle(page);
  return { context, page, before: await read(page) };
}

async function keysStayInTheShell(browser: Browser, options: BrowserContextOptions, path: string, engine: string) {
  for (const surface of SURFACES) {
    for (const key of KEYS) {
      await test.step(`${engine}: ${surface.name}, ${key}`, async () => {
        const { context, page, before } = await openEvidence(browser, options, path, surface.width);
        try {
          expect(before).toMatchObject({ act: "evidence", evidence: true });
          await surface.open(page);
          await expect.poll(() => surface.isOpen(page), `${surface.name} opened`).toBe(true);
          await page.keyboard.press(key);
          await settle(page);
          const after = await read(page);
          const at = `${engine}, ${surface.name}, ${key}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`;
          expect(after.act, `the Evidence act stays. ${at}`).toBe("evidence");
          expect(after.evidence, `the URL keeps evidence=. ${at}`).toBe(true);
          expect(after.history, `no history entry is added. ${at}`).toBe(before.history);
        } finally {
          await context.close();
        }
      });
    }
  }
  await test.step(`${engine}: control -- with nothing open, Escape reaches the workbench`, async () => {
    const { context, page } = await openEvidence(browser, options, path, 1440);
    try {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("Escape");
      await expect(page.locator("[data-world-act]")).not.toHaveAttribute("data-world-act", "evidence");
    } finally {
      await context.close();
    }
  });
}

test.describe("keys the V34 shell handles stay in the shell on /explore", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "1440", "drives its own widths and engines from the 1440 project");
  });

  test("chromium", async ({ browser, baseURL, page }) => {
    const path = await evidencePath(page);
    await keysStayInTheShell(browser, { baseURL }, path, "chromium");
  });

  test("webkit", async ({ playwright, baseURL, page }) => {
    test.setTimeout(180_000);
    const path = await evidencePath(page);
    const webkit = await playwright.webkit.launch();
    try {
      await keysStayInTheShell(webkit, { baseURL }, path, "webkit");
    } finally {
      await webkit.close();
    }
  });
});
