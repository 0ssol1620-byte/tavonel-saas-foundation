import { PHONE_HERO_STILL_REASON, phoneShowsStill } from "../lib/hero-phone-mode";
import { contactErrorCopy } from "../lib/contact-locale";

const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

/*
  Release 2 (2026-10-15): the consent card is not on the first paint. It appears after the first
  scroll past 200px or 8 s after mount, whichever comes first (CONSENT_REVEAL in
  components/marketing-consent.tsx), and at once from the footer's Analytics preferences button.
  GA still loads only after consent.
*/
const PANEL = { name: /^(Optional analytics|선택 분석)$/ };
// The card arrives with a 180ms translate; measure where it lands, not where it is mid-flight.
const settle = (panel: import("@playwright/test").Locator) =>
  panel.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
async function revealConsent(page: import("@playwright/test").Page) {
  await page.evaluate(() => window.scrollTo(0, 300));
  const panel = page.getByRole("region", PANEL);
  await expect(panel).toBeVisible();
  await settle(panel);
  return panel;
}

/*
  V34 Home (WO-CI-5b). The Landing V2 Home put a one-row prompt under the header from 900px
  (`body:has([data-home-ia])` in components/marketing-consent.module.css) and kept it off the hero
  film. V34 Home has neither the marker nor a film, so the prompt is the same bottom card on every
  width: a 360px card at the bottom left from 900px, a two-row sheet across the foot below it.
  What this file keeps is what the visitor was promised: nothing on the first paint, the prompt
  arrives after a scroll or 8 s, and when it is there it never covers the headline, the sentence
  under it or the hero's two actions. The hero's art is held clear where V34 holds it (from 900px);
  at 390 and 360 the 8 s sheet does cover it, which is reported with the work order, not asserted.
*/
type Box = { x: number; y: number; width: number; height: number };
const HERO = '[aria-labelledby="v34-title"]';
/* The hero's own words and actions: the things a prompt must never sit on. */
const HERO_TARGETS = [
  `${HERO} h1`,
  `${HERO} h1 + div`,
  '[data-analytics="hero-primary"]',
  '[data-analytics="hero-secondary"]',
] as const;
const HERO_ART = "[data-world-instrument]";
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
async function expectClearOf(page: import("@playwright/test").Page, box: Box, targets: readonly string[], when: string) {
  for (const target of targets) {
    const rect = await page.locator(target).first().boundingBox();
    expect(rect, `${target} is measured`).not.toBeNull();
    expect(overlaps(box, rect!), `${when}: the prompt covers ${target}`).toBe(false);
  }
}

test("walkthrough engagement is counted once and carries only the step it opens", async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as Window & { __preparedEngagement: Record<string, unknown>[] };
    target.__preparedEngagement = [];
    window.addEventListener("tavonel:funnel", (event) => {
      target.__preparedEngagement.push((event as CustomEvent).detail);
    });
  });
  await page.goto("/");
  await revealConsent(page);
  await page.getByRole("button", { name: "No thanks", exact: true }).click();
  const tabs = page.locator("#walkthrough").getByRole("tab");
  await expect(tabs).toHaveCount(4);
  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await tabs.nth(2).click();
  await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
  const events = await page.evaluate(() =>
    (window as Window & { __preparedEngagement: Record<string, unknown>[] }).__preparedEngagement,
  );
  const engagement = events.filter((event) => event.event === "hero_demo_interact");
  expect(engagement, "two presses are one engagement").toHaveLength(1);
  // The one detail is the step index the first press opens (components/v34/routes/home/home-analytics.tsx):
  // no href, no label, no record id.
  expect(Object.keys(engagement[0]).filter((key) => !["event", "variant"].includes(key))).toEqual(["scene"]);
  expect(engagement[0].scene).toBe("1");
  expect(events.filter((event) => event.event === "source_open")).toEqual([]);
});

test("analytics remains optional, persists refusal, and fits the viewport", async ({ page }, testInfo) => {
  const googleRequests: string[] = [];
  page.on("request", request => {
    if (/google-analytics\.com|googletagmanager\.com/.test(request.url())) googleRequests.push(request.url());
  });
  const serverResponse = await page.request.get("/");
  expect(await serverResponse.text(), "the prompt is not on the first paint")
    .not.toContain("data-marketing-consent-panel");
  await page.goto("/");
  // (a) At scroll 0 and well under 8 s, no card.
  await page.waitForTimeout(1_500);
  await expect(page.getByRole("region", { name: "Optional analytics" })).toHaveCount(0);
  // (b) After a scroll it appears at the bottom of the viewport.
  const panel = await revealConsent(page);
  const bounds = await panel.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  // Brief 2026-10-15 move 6: a bottom-fixed card, never more than a quarter of the viewport.
  await expect(panel).toHaveCSS("position", "fixed");
  const viewportHeight = page.viewportSize()!.height;
  expect(bounds!.y + bounds!.height, "the card sits inside the viewport").toBeLessThanOrEqual(viewportHeight + 1);
  expect(bounds!.height, "the card is capped at 25% of the viewport").toBeLessThanOrEqual(viewportHeight * 0.25 + 1);
  expect(await page.evaluate(() => getComputedStyle(document.body).paddingBottom)).toBe("0px");
  // V34 Home has one placement on every width: at the bottom of the viewport (a card from 900px, a sheet below it).
  expect(bounds!.y + bounds!.height, "the card sits at the bottom").toBeGreaterThan(viewportHeight - 40);
  if (page.viewportSize()!.width < 900) expect(bounds!.height, "the phone card is two rows, at most 96px").toBeLessThanOrEqual(96);
  await testInfo.attach("analytics-choice", { body: await page.screenshot(), contentType: "image/png" });
  await page.getByRole("button", { name: "No thanks", exact: true }).click();
  await page.reload();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Analytics preferences" })).toBeVisible();
  expect(googleRequests).toEqual([]);
  await page.getByRole("button", { name: "Analytics preferences" }).click();
  await expect(panel).toBeVisible();
});

// UX-L6 (UX-PLAN-2026-10-17 §8.2, R4-MJ2): also in the 412x915 and 430x932 projects.
test("the consent notice never covers homepage or pricing actions at 1440, 430, 412, 390 and 360", async ({ page }, testInfo) => {
  test.skip(!["1440", "430", "412", "390", "360"].includes(testInfo.project.name), "focused visual contract widths");
  for (const route of ["/", "/pricing"]) {
    await page.goto(route);
    const panel = page.getByRole("region", { name: "Optional analytics" });
    if (route === "/") {
      // (d) The first screen has no card at all at scroll 0, so nothing can cover H1, support or action.
      await expect(panel).toHaveCount(0);
      for (const target of HERO_TARGETS) await expect(page.locator(target).first()).toBeVisible();
    }
    // (e) Once revealed, the card is at the viewport bottom.
    await revealConsent(page);
    const panelBox = await panel.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(panelBox!.y + panelBox!.height, `${route} card sits at the bottom at ${testInfo.project.name}px`).toBeGreaterThan(page.viewportSize()!.height - 40);
    if (route === "/") await expectClearOf(page, panelBox!, HERO_TARGETS, "once revealed");

    await page.evaluate(() => window.scrollTo(0, Math.min(1_000, document.documentElement.scrollHeight - innerHeight)));
    const movedPanel = await panel.boundingBox();
    expect(movedPanel, "the fixed card keeps its box after a scroll").not.toBeNull();
    expect(movedPanel!.y + movedPanel!.height, "the card stays at the viewport bottom").toBeGreaterThan(page.viewportSize()!.height - 40);
    if (route === "/") await expectClearOf(page, movedPanel!, HERO_TARGETS, "after the scroll");
    const stuckHeader = await page.locator("[data-v34-header]").boundingBox();
    expect(stuckHeader, "public header should remain available after a scroll").not.toBeNull();
    expect(Math.abs(stuckHeader!.y)).toBeLessThanOrEqual(1);
  }
});

test("on Home from 900px the 8 s prompt covers no title, support, action or hero art", async ({ page }, testInfo) => {
  test.skip(!["1920", "1440", "1280", "1024"].includes(testInfo.project.name), "the card is the desktop placement");
  await page.clock.install();
  await page.goto("/");
  const panel = page.getByRole("region", PANEL);
  await expect(panel).toHaveCount(0);
  // The timer path: no scroll at all, so the whole first screen is what the card must clear.
  await page.clock.fastForward(8_000);
  await expect(panel).toBeVisible();
  await settle(panel);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const box = (await panel.boundingBox())!;
  await expectClearOf(page, box, [...HERO_TARGETS, HERO_ART], "at 8 s");
  await testInfo.attach("home-card-8s", { body: await page.screenshot(), contentType: "image/png" });
});

test("on a Home phone the prompt never opens over the title, support or actions", async ({ page }, testInfo) => {
  test.skip(!["430", "412", "390", "360"].includes(testInfo.project.name), "the phone bottom sheet");
  await page.clock.install();
  await page.goto("/");
  const panel = page.getByRole("region", PANEL);
  await expect(page.locator(HERO_TARGETS[0])).toBeVisible();
  await expect(panel).toHaveCount(0);
  await page.clock.fastForward(8_000);
  await page.clock.runFor(500);
  await expect(panel, "the sheet opens at 8 s").toBeVisible();
  await settle(panel);
  expect(await page.evaluate(() => window.scrollY), "unscrolled").toBe(0);
  const height = page.viewportSize()!.height;
  const box = (await panel.boundingBox())!;
  await expectClearOf(page, box, HERO_TARGETS, "at 8 s");
  expect(box.y + box.height).toBeGreaterThan(height - 40);
  await page.evaluate(() => window.scrollTo(0, 300));
  const moved = (await panel.boundingBox())!;
  await expectClearOf(page, moved, HERO_TARGETS, "after a 300px scroll");
  expect(moved.y + moved.height).toBeGreaterThan(height - 40);
  await testInfo.attach("home-phone-sheet", { body: await page.screenshot(), contentType: "image/png" });
});

/*
  The two wide phones, 430x932 and 412x915, from project 390 (which sets its own viewport): the 8 s sheet
  opens and leaves the title, support and both actions alone.
*/
for (const [width, height] of [[430, 932], [412, 915]] as const) {
  test(`on a wide Home phone the 8 s sheet opens clear of the title, support and actions (${width}x${height})`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "390", "sets its own viewport");
    await page.setViewportSize({ width, height });
    await page.clock.install();
    await page.goto("/");
    const panel = page.getByRole("region", PANEL);
    await expect(page.locator(HERO_TARGETS[0])).toBeVisible();
    await expect(panel).toHaveCount(0);
    await page.clock.fastForward(8_000);
    await page.clock.runFor(500);
    expect(await page.evaluate(() => window.scrollY), `${width}: unscrolled`).toBe(0);
    await expect(panel, `${width}: the 8 s sheet opens`).toBeVisible();
    await settle(panel);
    await expectClearOf(page, (await panel.boundingBox())!, HERO_TARGETS, `${width} at 8 s`);
    await testInfo.attach(`home-phone-sheet-8s-${width}`, { body: await page.screenshot(), contentType: "image/png" });
  });
}

/*
  (b) The one path where the sheet's check of [data-film-reading] decides alone; without it the sheet
  opens on the block (verified in fix round 5 by removing `line` from the boxes in
  marketing-consent.tsx: this test failed, fix4/mutation-*.log).

  It was 430x932 in Focus details, scrolled 300px, with the reading line under the frame. FINAL-SPEC
  2026-10-26 removed the line and a phone's reading block is empty, so the scenario moves to the band
  where the block still has a box: 768-899px, the pan surface, with the pane strip under the frame
  and the bottom sheet still in use (the sheet's phone query runs to 899px). At 800x800 the page is
  scrolled until the frame's bottom is 4px above the zone, past the 200px trigger; the strip under
  it then reaches into the zone.
*/
test("in the 768-899 band in Focus the scrolled sheet never covers the reading block", async ({ page }, testInfo) => {
  test.skip(phoneShowsStill(testInfo.project.name), PHONE_HERO_STILL_REASON);
  test.skip(testInfo.project.name !== "390", "sets its own viewport");
  const [width, height] = [800, 800];
  await page.setViewportSize({ width, height });
  await page.goto("/");
  const film = page.locator('#walkthrough figure[data-testid="landing-hero-film"]');
  await expect(film.locator(".compile-film-sequence")).toHaveAttribute("data-narrow", "1");
  // Home opens compact (founder 2026-10-27); Focus, the taller frame this guards, is one press of Focus details.
  await expect(film.locator(".compile-film-sequence")).toHaveAttribute("data-mobile-view", "fit");
  await film.locator(".compile-film-focus-control").click();
  await expect(film.locator(".compile-film-sequence")).toHaveAttribute("data-mobile-view", "focus");
  const frameBottom = await film.locator(".compile-film-viewport").evaluate(node => node.getBoundingClientRect().bottom + scrollY);
  const scroll = Math.round(frameBottom - (height - 104) + 4);
  expect(scroll, "past the 200px reveal").toBeGreaterThan(200);
  await page.evaluate(y => window.scrollTo(0, y), scroll);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scroll);
  const frame = (await film.locator(".compile-film-viewport").boundingBox())!;
  /*
    Film re-record (2026-11-05): the cuts are product screens and STAGE_FRAMES has no `panes`, so the player draws no
    pane strip and there is no reading block under the frame. What is left to guard is the frame: out of the zone, and
    the sheet never over it. If a strip comes back, this fails and the reading-block check below applies again.
  */
  await expect(film.locator("[data-film-reading]")).toHaveCount(0);
  const reading = frame;
  expect(frame.y + frame.height, "frame above the sheet's zone").toBeLessThanOrEqual(height - 104);
  // Past the 200px trigger the sheet decides within a frame; give it the 180ms entry as well.
  await page.waitForTimeout(800);
  const panel = page.getByRole("region", PANEL);
  if (await panel.count()) {
    await settle(panel);
    const box = (await panel.boundingBox())!;
    expect(overlaps(box, reading), "the scrolled sheet covers the reading line").toBe(false);
  }
  await testInfo.attach("home-band-sheet-focus", { body: await page.screenshot(), contentType: "image/png" });
});

/*
  The card reads as its own surface. Text >= 4.5:1 on the card, and the two answers' borders >= 3:1 (WCAG 1.4.11)
  against the card; the card's ground is not the ground behind it (the legacy failure was a row the colour of the page).
*/
test("on Home from 900px the consent card reads as its own surface", async ({ page }, testInfo) => {
  test.skip(!["1920", "1440", "1280", "1024"].includes(testInfo.project.name), "the card is the desktop placement");
  await page.goto("/");
  const panel = await revealConsent(page);
  const contrast = await panel.evaluate(element => {
    const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
    const over = (fg: number[], bg: number[]) => [0, 1, 2].map(i => fg[i]! * (fg[3] ?? 1) + bg[i]! * (1 - (fg[3] ?? 1)));
    const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!); };
    const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x! + 0.05) / (y! + 0.05); };
    const style = getComputedStyle(element);
    const card = rgb(style.backgroundColor).slice(0, 3);
    const button = getComputedStyle(element.querySelector("button")!);
    // The ground behind the card: the first element under its centre that is not the card itself.
    const box = element.getBoundingClientRect();
    const behind = document.elementsFromPoint(box.x + box.width / 2, box.y + box.height / 2).find(node => !element.contains(node));
    let ground = [255, 255, 255];
    for (let node: Element | null = behind ?? null; node; node = node.parentElement) {
      const value = rgb(getComputedStyle(node).backgroundColor);
      if (value.length >= 3 && (value[3] ?? 1) > 0) { ground = value.slice(0, 3); break; }
    }
    return {
      text: ratio(over(rgb(getComputedStyle(element.querySelector("p")!).color), card), card),
      answer: ratio(over(rgb(button.color), card), card),
      answerBorder: ratio(over(rgb(button.borderTopColor), card), card),
      cardOnGround: ratio(card, ground),
      shadow: style.boxShadow,
      borderWidth: parseFloat(style.borderTopWidth),
    };
  });
  await testInfo.attach("home-card-contrast", { body: JSON.stringify(contrast, null, 2), contentType: "application/json" });
  expect(contrast.text).toBeGreaterThanOrEqual(4.5);
  expect(contrast.answer).toBeGreaterThanOrEqual(4.5);
  expect(contrast.answerBorder).toBeGreaterThanOrEqual(3);
  // Distinct from what is behind it by ground, or by an edge or a shadow of its own.
  expect(contrast.cardOnGround > 1.05 || contrast.shadow !== "none" || contrast.borderWidth >= 1, "the card is its own surface").toBe(true);
});

test("Escape inside the consent card refuses, persists, and loads no analytics", async ({ page }) => {
  const googleRequests: string[] = [];
  page.on("request", request => {
    if (/google-analytics\.com|googletagmanager\.com/.test(request.url())) googleRequests.push(request.url());
  });
  await page.goto("/");
  const panel = await revealConsent(page);
  await panel.getByRole("button", { name: "No thanks", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await page.reload();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Analytics preferences" })).toBeVisible();
  expect(googleRequests).toEqual([]);
});

test("consented measurement sanitizes URLs and excludes private events and routes", async ({ page, baseURL }) => {
  // Serve the local build at the production origin, with the vendor script stubbed.
  // This checks the production-only gate without sending synthetic visits to Google.
  await page.route("https://tavonel.com/**", async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${baseURL}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
  let tagRequests = 0;
  await page.route("https://www.googletagmanager.com/**", async route => {
    tagRequests++;
    await route.fulfill({ contentType: "application/javascript", body: "/* vendor intentionally stubbed */" });
  });
  await page.goto("https://tavonel.com/?email=private@example.com");
  await page.evaluate(() => window.scrollTo(0, 300));
  await expect(page.getByRole("button", { name: "Allow analytics" })).toBeVisible();
  expect(tagRequests).toBe(0);
  await page.getByRole("button", { name: "Allow analytics" }).click();
  await expect.poll(() => tagRequests).toBe(1);
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("tavonel:funnel", { detail: { event: "hero_start_clicked", filename: "secret.pdf" } }));
    window.dispatchEvent(new CustomEvent("tavonel:funnel", { detail: { event: "workspace_question", text: "secret question" } }));
  });
  const queue = await page.evaluate(() => Array.from((window as unknown as { dataLayer: IArguments[] }).dataLayer, call => Array.from(call)));
  expect(JSON.stringify(queue)).not.toMatch(/private@example|secret|workspace_question/);
  expect(queue).toContainEqual(["event", "page_view", { page_location: "https://tavonel.com/", page_title: "TAVONEL" }]);
  expect(queue).toContainEqual(["event", "hero_start_clicked", { page_location: "https://tavonel.com/", page_title: "TAVONEL" }]);
  await page.getByRole("button", { name: "Analytics preferences" }).click();
  await page.getByRole("button", { name: "No thanks" }).click();
  await expect(page.getByRole("button", { name: "Analytics preferences" })).toBeVisible();
  expect(tagRequests).toBe(1);
  // Login checks its auth configuration after hydration; finish those mocked requests
  // before closing the context instead of removing routes while handlers are running.
  await page.goto("https://tavonel.com/login", { waitUntil: "networkidle" });
  await expect(page.getByRole("region", { name: "Optional analytics" })).toHaveCount(0);
  expect(tagRequests).toBe(1);
});

test("only successful commercial inquiries produce a lead event", async ({ page }) => {
  await page.clock.install();
  let success = false;
  await page.route("**/api/contact", route => route.fulfill({ status: success ? 200 : 503, contentType: "application/json", body: success ? "{}" : '{"error":"Unavailable"}' }));
  await page.goto("/contact");
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.getByRole("button", { name: "No thanks" }).click();
  await page.getByRole("textbox", { name: /^Name\b/ }).fill("Test Visitor");
  await page.getByRole("textbox", { name: "Work email" }).fill("test@example.com");
  await page.getByRole("textbox", { name: /^What are you trying to do\?/ }).fill("Test inquiry with no production delivery.");
  await page.clock.fastForward(2_000);
  await page.getByRole("button", { name: "Send inquiry" }).click();
  // UX06: the status picks the public copy; the server's `error` string is never shown.
  const failure = page.locator('form [aria-live="polite"] [data-state="error"]');
  await expect(failure).toContainText(contactErrorCopy(503).message);
  await expect(failure).not.toContainText("Unavailable");
  const records = () => page.evaluate(() => JSON.parse(sessionStorage.getItem("tavonel.funnel-log") ?? "[]"));
  expect(await records()).not.toContainEqual({ event: "generate_lead" });
  success = true;
  await page.getByRole("button", { name: "Send inquiry" }).click();
  await expect(page.locator('[data-state="sent"]')).toBeVisible();
  expect(await records()).toContainEqual({ event: "generate_lead" });
  expect(JSON.stringify(await records())).not.toMatch(/test@example|Test Visitor|production delivery/);
});

