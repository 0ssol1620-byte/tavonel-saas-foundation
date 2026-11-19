import { PHONE_HERO_STILL_REASON, phoneShowsStill } from "../lib/hero-phone-mode";
import { test, expect } from "@playwright/test";
import { activationPolicy } from "../lib/activation-policy";
import { EXPLORE_CTA } from "../lib/site-navigation";
import { HOME_MOUNTS_LANDING_V2, HOME_NOT_MOUNTED_REASON } from "./support/held-feature";

/*
  V34 (WO-CI-5a): the chrome is the V34 shell (`[data-v34-header]`, the page's contentinfo footer), Home is
  the V34 page (its H1 is `#v34-title`, its hero a `section[aria-labelledby="v34-title"]` whose first
  child is the shell-width column), and /product answers 308 to /platform. Promises are unchanged; the
  four-stage hero film is not on V34 Home (/film is held, ADR D01 A9), so its half of the edge test is
  its own test and runs when Home mounts landing-v2 (e2e/support/held-feature.ts) -- not removed.
*/
const HEADER = "[data-v34-header]";
const FOOTER = "[data-v34-site] > footer";

test("navigation and hero actions keep readable labels", async ({ page }) => {
  await page.goto("/");
  for (const selector of [`${HEADER} nav[aria-label="Primary"] a[href="/pricing"]`, '[data-analytics="hero-primary"]']) {
    const contrast = await page.locator(selector).first().evaluate(element => {
      const style = getComputedStyle(element);
      const channels = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const luminance = (value: string) => {
        const [r, g, b] = channels(value).map(channel => {
          const normalized = channel / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const foreground = luminance(style.color);
      let ancestor: Element | null = element;
      let ground = "rgb(255, 255, 255)";
      while (ancestor) {
        const value = getComputedStyle(ancestor).backgroundColor;
        const rgba = value.match(/[\d.]+/g)?.map(Number) ?? [];
        if (rgba.length === 3 || (rgba.length === 4 && rgba[3]! >= 0.99)) {
          ground = value;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      const background = luminance(ground);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    expect(contrast, `${selector} label contrast`).toBeGreaterThanOrEqual(4.5);
  }
});

/*
  The film sat under the centered opening statement in Scene 01. V34 Home's hero and the section after
  it keep the wordmark's measured outer edge, and the hero's art (the World instrument) stays inside
  that column and the viewport. The film half is the next test.
*/
for (const path of ["/"]) {
  test(`${path} shares a measured outer edge and keeps the hero's art inside it`, async ({ page }, testInfo) => {
    test.skip(phoneShowsStill(testInfo.project.name), PHONE_HERO_STILL_REASON);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(path);
    const hero = page.locator('main section[aria-labelledby="v34-title"]');
    const wrap = await hero.locator(":scope > div").first().boundingBox();
    // The next section's column: the first child of the section after the hero.
    const next = await page.locator('main section[aria-labelledby="v34-title"] + section > div').first().boundingBox();
    const mark = await page.locator(`${HEADER} a[aria-label="TAVONEL home"]`).first().boundingBox();
    const art = await hero.locator(":scope > div > div").nth(1).boundingBox();
    expect(wrap && next && mark && art).toBeTruthy();
    expect(Math.abs(wrap!.x - mark!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(next!.x - mark!.x)).toBeLessThanOrEqual(1);
    expect(art!.x).toBeGreaterThanOrEqual(wrap!.x - 1);
    expect(art!.x + art!.width).toBeLessThanOrEqual(wrap!.x + wrap!.width + 1);
    expect(art!.x).toBeGreaterThanOrEqual(0);
    expect(art!.x + art!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  });

  test(`${path} keeps the opened walkthrough inside the shared edge`, async ({ page }, testInfo) => {
    test.skip(!HOME_MOUNTS_LANDING_V2, HOME_NOT_MOUNTED_REASON);
    test.skip(phoneShowsStill(testInfo.project.name), PHONE_HERO_STILL_REASON);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(path);
    const filmWrap = await page.locator('main section[aria-labelledby="v34-title"] > div').first().boundingBox();
    expect(filmWrap).toBeTruthy();
    const disclosure = page.getByTestId("landing-hero-film");
    await expect(disclosure).toBeVisible();
    await expect(disclosure.locator(".compile-film-viewport")).toBeVisible();
    const film = (await disclosure.locator(".compile-film-viewport").boundingBox())!;
    // FINAL-SPEC 2026-10-26 §2.1: below 768px the source pane is the column plus 16px (8px each side), and nothing more.
    const bleed = page.viewportSize()!.width < 768 ? 8 : 0;
    expect(film.x).toBeGreaterThanOrEqual(filmWrap!.x - bleed - 1);
    expect(film.x + film.width).toBeLessThanOrEqual(filmWrap!.x + filmWrap!.width + bleed + 1);
    expect(film.x).toBeGreaterThanOrEqual(0);
    expect(film.x + film.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  });
}

test("every source has matching upright typography, not a substituted italic face", async ({ page }) => {
  await page.goto("/");
  // V34 Home's H1 is `#v34-title`; every run inside it (the accent span) is held to the H1's own face.
  const runs = await page.locator("h1#v34-title").evaluate(h1 => [h1, ...h1.querySelectorAll("*")].map(element => {
    const style = getComputedStyle(element);
    const parent = getComputedStyle(element === h1 ? h1 : element.closest("h1")!);
    return { family: style.fontFamily, parentFamily: parent.fontFamily, size: style.fontSize,
      parentSize: parent.fontSize, style: style.fontStyle, weight: style.fontWeight, parentWeight: parent.fontWeight, synthesis: style.fontSynthesis, parentSynthesis: parent.fontSynthesis };
  }));
  expect(runs.length, "the H1 and its runs").toBeGreaterThanOrEqual(1);
  for (const typography of runs) {
    expect(typography.family).toBe(typography.parentFamily);
    expect(typography.size).toBe(typography.parentSize);
    expect(typography.style).toBe("normal");
    expect(typography.weight).toBe(typography.parentWeight);
    expect(typography.synthesis).toBe(typography.parentSynthesis);
  }
});

test("footer labels use their own cells without clipped or escaping text", async ({ page }) => {
  await page.goto("/product");
  await page.locator(FOOTER).scrollIntoViewIfNeeded();
  /*
    WO-CI-22 (lead decision 7): on a phone each group is a native <details> whose summary is its label;
    a closed group's links are not painted, so every group is opened by its summary before its labels
    are read. Wide, no summary is drawn and nothing is opened.
  */
  for (const summary of await page.locator(`${FOOTER} nav > details > summary`).all()) {
    if (await summary.isVisible()) await summary.click();
  }
  const violations = await page.locator(`${FOOTER} nav a, ${FOOTER} nav summary`).evaluateAll(labels =>
    labels.flatMap(label => {
      const box = label.getBoundingClientRect();
      if (label.tagName === "SUMMARY" && box.height === 0) return []; // not drawn at this width
      return !label.checkVisibility() || label.scrollWidth > label.clientWidth + 1 || box.height < 44
        ? [{ text: label.textContent, painted: label.checkVisibility(), scroll: label.scrollWidth, width: label.clientWidth, height: box.height }] : [];
    }));
  expect(violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator(`${FOOTER} a[href="/subprocessors"]`)).toBeVisible();
});

test("the first developer request remains keyboard reachable on a narrow screen", async ({ page }) => {
  await page.goto("/developers");
  /*
    Gap #7 made the one block four, and the role moved with it.

    What this pinned was a lone `<pre role="region" aria-label="First API request example">`. It
    is now the APG tab group `/api` and the quickstart already use -- cURL, TypeScript, Python and
    MCP -- and an element that is a `tabpanel` cannot also be a `region`: the two roles are
    mutually exclusive, and the accessible name of a panel is the tab that controls it. So the
    selector had to move. The contract did not, and it is held harder than before: the group still
    carries this test's name, every panel is in the HTML with code in it, the panel a reader is
    looking at takes focus from the keyboard, and the strip is one Tab stop rather than four.
  */
  /*
    V34 /developers shows its requests as separate code blocks (components/v34/routes/developers/
    code-block.tsx) rather than the legacy cURL / TypeScript / Python / MCP tab group, so the tab
    strip's roving tabindex has no counterpart. The contract it held stays: every sample is in the
    HTML with code in it, each sits in a named region a keyboard reaches (one Tab stop each, so a
    long line scrolls inside it rather than widening the page), and the first one takes focus.
    The count is pinned, not floored: V34 /developers renders exactly the four first-request samples
    (`FIRST_CALL_SNIPPETS`, cURL / TypeScript / Python / MCP, lib/developer-snippets.test.ts), as the tab
    group had four panels. A code block is a scroll region holding a `pre`; the package table's scroll
    region is not one.
  */
  const samples = page.locator('main [role="region"][data-v34-scroll]:has(> pre)');
  await expect(samples, "the four first-request samples on /developers").toHaveCount(4);
  expect(await samples.evaluateAll(regions => regions.map(region => region.getAttribute("aria-label"))))
    .toEqual(["cURL", "TypeScript", "Python", "MCP"].map(language => `First request in ${language}`));
  for (const code of await samples.locator("pre").allTextContents()) {
    expect(code.trim().length).toBeGreaterThan(0);
  }
  for (const label of await samples.evaluateAll(regions => regions.map(region => region.getAttribute("aria-label") ?? ""))) {
    expect(label.trim().length, "each sample region is named").toBeGreaterThan(0);
  }
  expect(await samples.evaluateAll(regions => regions.map(region => (region as HTMLElement).tabIndex)))
    .toEqual(Array(await samples.count()).fill(0));

  const first = samples.first();
  await first.focus();
  await expect(first).toBeFocused();
  await expect(first.locator("pre")).not.toHaveText("");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

/*
  UX01. The closed customer-data gate, stated where the journey ends and before the first
  authenticated read.

  Measured at 390, where the reason and its two actions wrap the most. Order is document order
  rather than position on screen, because that is the order a keyboard or screen-reader user meets
  them in. The server half is read through `page.request`, because the note is a standing fact
  and has to be in what the server sent, not only in what the browser ends up showing.
*/
/*
  D-12 (delegated decision 2026-11-09): the gate is open, so /developers sends no gate note, and the
  narrow-screen contract below only applies the day it closes again (the test then runs as before).
*/
test("an open customer-data gate leaves no gate note on /developers", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "390", "the narrow-screen contract is measured at 390");
  test.skip(!activationPolicy.customerData.enabled, "describes the open gate");
  const served = await (await page.request.get("/developers")).text();
  expect(served).not.toContain('data-capability-gate="customerData"');
  await page.goto("/developers");
  await expect(page.locator('[data-capability-gate="customerData"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("the closed customer-data gate precedes the first developer request on a narrow screen", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "390", "the narrow-screen contract is measured at 390");
  test.skip(activationPolicy.customerData.enabled, "describes the closed gate; D-12 opened it on 2026-11-09");

  const served = (await (await page.request.get("/developers")).text())
    .match(/<p [^>]*data-capability-gate="customerData"[^>]*>([\s\S]*?)<\/p>/)?.[1];
  expect(served, "the note is in the server HTML").toBeDefined();
  expect(served).toContain(activationPolicy.customerData.reason);

  await page.goto("/developers");
  const gate = page.locator('[data-capability-gate="customerData"]');
  await expect(gate).toBeVisible();
  await expect(gate).toContainText(activationPolicy.customerData.reason);

  const explore = gate.getByRole("link", { name: EXPLORE_CTA.label, exact: true });
  const contact = gate.getByRole("link", { name: "Discuss your sources", exact: true });
  await expect(explore).toHaveAttribute("href", EXPLORE_CTA.href);
  await expect(contact).toHaveAttribute("href", "/contact");
  for (const action of [explore, contact]) {
    await action.focus();
    await expect(action).toBeFocused();
  }

  const order = await gate.getByRole("link").evaluateAll(links => {
    const examples = document.querySelector('[role="tablist"][aria-label="First API request example"]');
    return links.map(link =>
      examples !== null && Boolean(link.compareDocumentPosition(examples) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(order, "both actions come before the First API request tablist").toEqual([true, true]);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
