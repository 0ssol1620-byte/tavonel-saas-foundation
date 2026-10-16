import { expect, test, type Page } from "@playwright/test";

/*
  VISUAL_QA_REPORT: "/status still has a narrow reading column and substantial unused desktop
  width." The fix pairs related prose across the column on desktop and stacks it on a phone; this
  spec holds both shapes and the five sections they are made of.

  Each block sets its own viewport, so it runs only in the 1440 and 390 width projects and in
  reduced-motion (which is 1440 with motion reduced) rather than once per width.
*/
const SECTIONS = [
  "Configuration and activation state",
  "Scheduled dependency checks",
  "Incident history",
  "Getting told without coming back",
  "Incident contact",
] as const;

test.beforeEach(async ({}, testInfo) => {
  test.skip(!["1440", "390", "reduced-motion"].includes(testInfo.project.name), "sets its own viewport");
});

type Box = { left: number; right: number; top: number; bottom: number };

async function measure(page: Page) {
  return page.evaluate((names) => {
    const box = (element: Element | null | undefined): Box | null => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top + scrollY, bottom: rect.bottom + scrollY };
    };
    const headings = [...document.querySelectorAll<HTMLElement>("main .policy-copy h2")];
    const byName = (name: string) => headings.find((heading) => heading.textContent?.trim() === name);
    const paragraph = (start: string) =>
      [...document.querySelectorAll<HTMLElement>("main .policy-copy p")].find((p) => p.textContent?.trim().startsWith(start));
    return {
      headingNames: headings.map((heading) => heading.textContent?.trim()),
      headings: names.map((name) => box(byName(name))),
      sections: names.map((name) => box(byName(name)?.parentElement)),
      jumpLinks: names.map((name) => {
        const id = byName(name)?.id;
        return id ? document.querySelectorAll(`nav[aria-label="On this page"] a[href="#${id}"]`).length : 0;
      }),
      configurationList: box(document.querySelector("main .status-list")),
      checksExplanation: box(paragraph("Request checks here run on a schedule")),
      checksStamps: box(paragraph("Last check that passed")),
      paragraphs: [...document.querySelectorAll<HTMLElement>("main .policy-copy p")].map((p) => box(p)!),
      innerWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, [...SECTIONS]);
}

async function expectFiveSections(page: Page) {
  for (const name of SECTIONS) {
    await expect(page.getByRole("heading", { level: 2, name, exact: true })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
  }
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("/status spends the second column on paired guidance", async ({ page }) => {
    expect((await page.goto("/status"))?.status()).toBe(200);
    await expectFiveSections(page);
    const m = await measure(page);

    expect(m.headingNames).toEqual([...SECTIONS]);
    expect(m.jumpLinks).toEqual([1, 1, 1, 1, 1]);
    expect(m.overflow).toBeLessThanOrEqual(1);

    const list = m.configurationList!;
    const [, , history, subscribe] = m.sections as Box[];
    const [, , historyHeading, subscribeHeading] = m.headings as Box[];

    // Incident history and the update path share one row, side by side.
    expect(Math.abs(historyHeading.top - subscribeHeading.top)).toBeLessThanOrEqual(2);
    expect(subscribe.left).toBeGreaterThanOrEqual(history.right + 24);
    // The pair spans the same column the status grid does: first track at its left edge, second
    // track reaching its right edge, which the old single stack of 68ch paragraphs never did.
    expect(Math.abs(history.left - list.left)).toBeLessThanOrEqual(2);
    expect(subscribe.right).toBeGreaterThanOrEqual(list.right - 2);
    expect(subscribe.left).toBeGreaterThan((list.left + list.right) / 2);

    // The scheduled-check explanation and its last-run stamps sit beside each other.
    const explanation = m.checksExplanation!;
    const stamps = m.checksStamps!;
    expect(Math.abs(explanation.top - stamps.top)).toBeLessThanOrEqual(2);
    expect(stamps.left).toBeGreaterThanOrEqual(explanation.right + 24);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("/status stacks its five sections without horizontal overflow", async ({ page }) => {
    expect((await page.goto("/status"))?.status()).toBe(200);
    await expectFiveSections(page);
    const m = await measure(page);

    expect(m.headingNames).toEqual([...SECTIONS]);
    expect(m.jumpLinks).toEqual([1, 1, 1, 1, 1]);
    expect(m.overflow).toBeLessThanOrEqual(1);

    const sections = m.sections as Box[];
    const headings = m.headings as Box[];
    for (let index = 0; index < sections.length; index += 1) {
      const section = sections[index]!;
      expect(section.left, `${SECTIONS[index]} starts on screen`).toBeGreaterThanOrEqual(0);
      expect(section.right, `${SECTIONS[index]} ends on screen`).toBeLessThanOrEqual(m.innerWidth + 1);
      expect(Math.abs(headings[index]!.left - headings[0]!.left), `${SECTIONS[index]} shares the column`).toBeLessThanOrEqual(1);
      if (index > 0) {
        expect(section.top, `${SECTIONS[index]} follows the section before it`).toBeGreaterThanOrEqual(sections[index - 1]!.bottom);
      }
    }

    // Paired guidance is one column again: the stamps come after the explanation, not beside it.
    expect(m.checksStamps!.top).toBeGreaterThanOrEqual(m.checksExplanation!.bottom);
    expect(Math.abs(m.checksStamps!.left - m.checksExplanation!.left)).toBeLessThanOrEqual(1);
    for (const paragraph of m.paragraphs) {
      expect(paragraph.right).toBeLessThanOrEqual(m.innerWidth + 1);
    }
  });
});
