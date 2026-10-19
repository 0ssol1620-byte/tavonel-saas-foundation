import { expect, test } from "@playwright/test";

/*
  Release 2 (2026-10-15), brief move 5: the workbench Evidence Line, and the header CTA guard.

  The line is drawn from a passage or region button to its own box on the page, with that region's
  coordinates as its label. It is a pointer-transparent overlay (CLS 0), it appears whole under
  reduced motion, and below the side-by-side workbench it is not drawn: the passage card carries
  the same label instead.

  UX-L10 (lane P2-09, UX-PLAN-2026-10-17 §4.2-1, §4.6, §4.9): the regions are reached with the Tab
  key alone, from the top of the document; each line comes with its coordinate chip (ink, the
  record's own page and bbox) and the accent outline of the box it points at; a line the keyboard
  starts is never animated, and under reduced motion nothing in the workbench animates or
  transitions. A pointer-started line is the detector that the animation count is not vacuous.

  "Transition 0" is counted three ways under reduced motion: no transition runs in the workbench
  (`transitionrun` events), no animation exists in it, and every element and pseudo-element in it
  declares a zero transition duration. The site's opacity fade (`app/landing-v2.css`, `.lv2 *`,
  120ms) still applies outside the workbench, which is the detector that the declared check can see
  a non-zero duration.
*/

const ACCENT = "rgb(0, 91, 179)"; // --tv-action, decision.md G-H 255°
const INK = "rgb(21, 25, 29)"; // --tv-ink, which Home's --home-ink reads

async function seedRefusal(page: import("@playwright/test").Page) {
  // Not a consent spec: start with a stored refusal so the delayed card never covers a target.
  await page.addInitScript(() => localStorage.setItem("tavonel.analytics-consent.v1", JSON.stringify({ allowed: false, expires: Date.now() + 86_400_000 })));
}

test("Tab alone reaches regions A, B and C, each with its line, outline and coordinate chip, unanimated and with no layout shift", async ({ page }, testInfo) => {
  test.skip(!["1440", "reduced-motion"].includes(testInfo.project.name), "side-by-side workbench widths");
  const reduced = testInfo.project.name === "reduced-motion";
  // The reduced-motion project's `use.reducedMotion` does not reach matchMedia in this runner (measured: false),
  // so the media is emulated here explicitly.
  if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
  await seedRefusal(page);
  await page.goto("/");
  const buttons = page.locator("#s2 button[data-line-region]");
  await expect(buttons).toHaveCount(3);
  // Every frame with an animation running inside the overlay, and every transition that starts inside
  // the workbench, is counted from before the first key press.
  await page.evaluate(() => {
    const win = window as unknown as { __lineFrames: number; __benchTransitions: string[] };
    win.__lineFrames = 0;
    win.__benchTransitions = [];
    document.addEventListener("transitionrun", event => {
      const target = event.target as Element;
      if (target.closest?.("#s2 article[data-case-status]")) win.__benchTransitions.push(`${target.tagName}.${target.className} ${event.propertyName}`);
    }, true);
    const tick = () => {
      if (document.getAnimations().some(animation =>
        ((animation.effect as KeyframeEffect | null)?.target as Element | null)?.closest?.("[data-evidence-line]"))) win.__lineFrames++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const lineFrames = () => page.evaluate(() => (window as unknown as { __lineFrames: number }).__lineFrames);
  const bench = page.locator("#s2 article[data-case-status]");

  // Tab from the top of the document until focus enters the workbench; count layout shifts from there.
  let presses = 0;
  while (!(await bench.evaluate(element => element.contains(document.activeElement)))) {
    expect(++presses, "the workbench is reachable with Tab").toBeLessThan(200);
    await page.keyboard.press("Tab");
  }
  await page.evaluate(() => {
    const win = window as unknown as { __shift: number };
    win.__shift = 0;
    new PerformanceObserver(list => {
      for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (!entry.hadRecentInput) win.__shift += entry.value;
      }
    }).observe({ type: "layout-shift" });
  });
  while (!(await buttons.first().evaluate(button => button === document.activeElement))) {
    expect(++presses, "region A is reachable with Tab").toBeLessThan(200);
    await page.keyboard.press("Tab");
  }

  const overlay = page.locator("#s2 [data-evidence-line]");
  const label = page.locator("#s2 [data-evidence-line-label]");
  for (let index = 0; index < 3; index++) {
    const button = buttons.nth(index);
    if (index > 0) await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    const region = (await button.getAttribute("data-line-region"))!;
    await expect(overlay).toHaveAttribute("data-evidence-line", region);
    // The chip is the record's own page and bbox, as the button names them for assistive technology.
    const [, pageNumber, bbox] = (await button.getAttribute("aria-label"))!.match(/p\.(\d+) · bbox (\d+,\d+,\d+,\d+)$/)!;
    const [x0, y0, x1, y1] = bbox!.split(",");
    await expect(label).toBeVisible();
    await expect(label).toContainText(`SOURCE · 10-Q · p.${pageNumber} · [${x0},${y0} → ${x1},${y1}]`);
    if (index === 0) await expect(label).toContainText(`page ${pageNumber} · region A`);
    const drawn = await page.evaluate(id => {
      const root = document.querySelector("#s2 [data-evidence-line]")!.getBoundingClientRect();
      const outline = document.querySelector<SVGRectElement>("#s2 [data-evidence-line] rect[data-evidence-line-box]")!;
      const line = document.querySelector<SVGLineElement>("#s2 [data-evidence-line] line")!;
      const box = document.querySelector(`#s2 [data-region-id="${CSS.escape(id)}"]`)!.getBoundingClientRect();
      const chip = getComputedStyle(document.querySelector("#s2 [data-evidence-line-label]")!);
      return {
        // The outline is drawn 2px outside the box on every side.
        offsets: [
          root.left + outline.x.baseVal.value + 2 - box.left,
          root.top + outline.y.baseVal.value + 2 - box.top,
          outline.width.baseVal.value - 4 - box.width,
          outline.height.baseVal.value - 4 - box.height,
        ],
        lineStroke: getComputedStyle(line).stroke,
        outlineStroke: getComputedStyle(outline).stroke,
        outlineWidth: getComputedStyle(outline).strokeWidth,
        chipColor: chip.color,
        chipBorder: chip.borderTopColor,
      };
    }, region);
    for (const offset of drawn.offsets) expect(Math.abs(offset)).toBeLessThan(0.5);
    expect(drawn.lineStroke).toBe(ACCENT);
    expect(drawn.outlineStroke).toBe(ACCENT);
    expect(drawn.outlineWidth).toBe("2px");
    expect(drawn.chipColor).toBe(INK);
    expect(drawn.chipBorder).not.toBe(ACCENT);
  }
  // §4.6: a line started from the keyboard is never drawn in, with or without reduced motion.
  expect(await lineFrames()).toBe(0);
  if (reduced) {
    // Nothing transitioned anywhere in the workbench on the whole keyboard path, and nothing animates now.
    expect(await page.evaluate(() => (window as unknown as { __benchTransitions: string[] }).__benchTransitions)).toEqual([]);
    expect(await bench.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
    // Nothing can transition: the workbench and everything in it, pseudo-elements included, declares 0s.
    const declared = await bench.evaluate(element => [element, ...element.querySelectorAll("*")].flatMap(node =>
      [null, "::before", "::after"].map(pseudo => ({
        node: `${node.tagName}.${node.getAttribute("class") ?? ""}${pseudo ?? ""}`,
        duration: getComputedStyle(node, pseudo).transitionDuration,
      }))));
    expect(declared.length).toBeGreaterThan(100);
    const moving = declared.filter(({ duration }) => !duration.split(",").every(part => Number.parseFloat(part) === 0));
    expect(moving).toEqual([]);
    // Detector: outside the workbench the site's reduced-motion opacity fade is still declared.
    expect(await page.locator("#s2").evaluate(section => getComputedStyle(section).transitionDuration)).toBe("0.12s");
  }
  await testInfo.attach("evidence-line", { body: await page.screenshot(), contentType: "image/png" });
  expect(await page.evaluate(() => (window as unknown as { __shift: number }).__shift)).toBe(0);

  // Detector: a pointer moving to another region does draw its line in -- except under reduced motion.
  await buttons.first().hover();
  await expect(overlay).toHaveAttribute("data-evidence-line", (await buttons.first().getAttribute("data-line-region"))!);
  if (reduced) {
    await page.waitForTimeout(400);
    expect(await lineFrames()).toBe(0);
  } else {
    await expect.poll(lineFrames, { timeout: 2_000 }).toBeGreaterThan(0);
  }
});

test("below the side-by-side workbench no line is drawn and the passage card carries the label", async ({ page }, testInfo) => {
  test.skip(!["390", "360"].includes(testInfo.project.name), "phone widths");
  await seedRefusal(page);
  await page.goto("/");
  const button = page.locator("#s2 button[data-line-region]").first();
  await button.scrollIntoViewIfNeeded();
  await button.focus();
  await expect(page.locator("#s2 [data-evidence-line]")).toHaveAttribute("data-evidence-line", "none");
  await expect(page.locator("#s2 [data-evidence-card-label]")).toBeVisible();
});

test("the region crop keeps the record bbox and shows a padded window around it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "1440", "one width is enough for a data contract");
  await seedRefusal(page);
  await page.goto("/");
  const crop = page.locator("#s2 [data-bbox1000]").first();
  await expect(crop).toHaveCount(1);
  const [bbox, shown] = await Promise.all([crop.getAttribute("data-bbox1000"), crop.getAttribute("data-crop1000")]);
  const [b0, b1, b2, b3] = bbox!.split(",").map(Number);
  const [w0, w1, w2, w3] = shown!.split(",").map(Number);
  expect(w0!).toBeLessThanOrEqual(b0!);
  expect(w1!).toBeLessThanOrEqual(b1!);
  expect(w2!).toBeGreaterThanOrEqual(b2!);
  expect(w3!).toBeGreaterThan(b3!);
});

test("the header CTA points at the public sample and is not a self-link", async ({ page }, testInfo) => {
  test.skip(!["1440", "1920"].includes(testInfo.project.name), "the header actions show from 1250px");
  await page.goto("/pricing");
  await expect(page.locator("header.nav .nav-actions a.btn")).toHaveAttribute("href", "/explore");
});
