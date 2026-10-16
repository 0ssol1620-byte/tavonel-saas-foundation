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
  Release 3 (2026-10-15): on Home from 900px the prompt is one row directly under the header
  (components/marketing-consent.module.css). The Release 2 bottom-left card opened over the film's
  SOURCES pane at 1440 on both triggers, and no bottom placement clears a film that fills the
  lower half of the first screen. Phones and every other page keep the bottom card.
*/
type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
/*
  `atReveal`: the moment the row appears (after the 300px scroll, or at 8 s unscrolled) it must
  not sit on the film stage. Scrolled further, content passes under it as it passes under the
  header, so only its place is checked then.
*/
async function expectHomeRowUnderHeader(page: import("@playwright/test").Page, box: Box, atReveal = true) {
  const header = await page.locator("header.nav").boundingBox();
  expect(Math.abs(box.y - (header!.y + header!.height)), "the row starts at the header's foot").toBeLessThanOrEqual(1);
  expect(box.height, "one row, not a card").toBeLessThanOrEqual(56);
  if (!atReveal) return;
  const stage = await page.locator("#s1 .compile-film-viewport").boundingBox();
  expect(stage, "the film stage is measured").not.toBeNull();
  expect(overlaps(box, stage!), "the row does not open over the film stage").toBe(false);
}

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
  if (page.viewportSize()!.width < 900) {
    expect(bounds!.y + bounds!.height, "the card sits at the bottom").toBeGreaterThan(viewportHeight - 40);
    expect(bounds!.height, "the phone card is two rows, at most 96px").toBeLessThanOrEqual(96);
  } else {
    await expectHomeRowUnderHeader(page, bounds!);
  }
  await testInfo.attach("analytics-choice", { body: await page.screenshot(), contentType: "image/png" });
  await page.getByRole("button", { name: "No thanks", exact: true }).click();
  await page.reload();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Analytics preferences" })).toBeVisible();
  expect(googleRequests).toEqual([]);
  await page.getByRole("button", { name: "Analytics preferences" }).click();
  await expect(panel).toBeVisible();
});

test("the consent notice never covers homepage or pricing actions at 1440, 390 and 360", async ({ page }, testInfo) => {
  test.skip(!["1440", "390", "360"].includes(testInfo.project.name), "focused visual contract widths");
  for (const route of ["/", "/pricing"]) {
    await page.goto(route);
    const panel = page.getByRole("region", { name: "Optional analytics" });
    if (route === "/") {
      // (d) The first screen has no card at all at scroll 0, so nothing can cover H1, support or action.
      await expect(panel).toHaveCount(0);
      for (const target of [page.locator("#s1 h1"), page.locator("#s1 .lv2-hero-support"), page.locator('#s1 a[href="/explore"]').first()]) {
        await expect(target).toBeVisible();
      }
    }
    // (e) Once revealed, the card is at the viewport bottom -- or, on Home from 900px, under the header.
    const homeRow = route === "/" && page.viewportSize()!.width >= 900;
    await revealConsent(page);
    const panelBox = await panel.boundingBox();
    expect(panelBox).not.toBeNull();
    if (homeRow) await expectHomeRowUnderHeader(page, panelBox!);
    else expect(panelBox!.y + panelBox!.height, `${route} card sits at the bottom at ${testInfo.project.name}px`).toBeGreaterThan(page.viewportSize()!.height - 40);

    await page.evaluate(() => window.scrollTo(0, Math.min(1_000, document.documentElement.scrollHeight - innerHeight)));
    const movedPanel = await panel.boundingBox();
    expect(movedPanel, "the fixed card keeps its box after a scroll").not.toBeNull();
    if (homeRow) await expectHomeRowUnderHeader(page, movedPanel!, false);
    else expect(movedPanel!.y + movedPanel!.height, "the card stays at the viewport bottom").toBeGreaterThan(page.viewportSize()!.height - 40);
    const stuckHeader = await page.locator("header.nav").boundingBox();
    expect(stuckHeader, "public header should remain available after a scroll").not.toBeNull();
    expect(Math.abs(stuckHeader!.y)).toBeLessThanOrEqual(1);
  }
});

test("on Home from 900px the 8 s prompt covers no title, support, action or film", async ({ page }, testInfo) => {
  test.skip(!["1920", "1440", "1280", "1024"].includes(testInfo.project.name), "the Home row exists from 900px");
  await page.clock.install();
  await page.goto("/");
  const panel = page.getByRole("region", PANEL);
  await expect(panel).toHaveCount(0);
  // The timer path: no scroll at all, so the whole first screen is what the row must clear.
  await page.clock.fastForward(8_000);
  await expect(panel).toBeVisible();
  await settle(panel);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const box = (await panel.boundingBox())!;
  await expectHomeRowUnderHeader(page, box);
  for (const target of ["#s1 h1", "#s1 .lv2-hero-support", "#s1 .lv2-actions", "#s1 .compile-film-viewport"]) {
    const rect = await page.locator(target).first().boundingBox();
    expect(rect, target).not.toBeNull();
    expect(overlaps(box, rect!), `the 8 s row covers ${target}`).toBe(false);
  }
  await testInfo.attach("home-row-8s", { body: await page.screenshot(), contentType: "image/png" });
});

/*
  Fix round 3 (judge gap 3), phones. At 8 s with no scroll the hero film fills the foot of a
  360-430px first screen, where the bottom sheet sits, so the sheet waits until the film is out of
  its zone and never opens over the film; the 200px scroll path is always clear. Neither path
  shows anything on the first paint.

  Fix round 4 (M3): the zone is kept clear of the frame and the stage's reading line together (at
  430 the 8 s sheet cleared the frame and covered the line under it). Both boxes are checked on
  both paths.
*/
test("on a Home phone the prompt never opens over the hero film", async ({ page }, testInfo) => {
  test.skip(!["390", "360"].includes(testInfo.project.name), "the phone bottom sheet");
  await page.clock.install();
  await page.goto("/");
  const panel = page.getByRole("region", PANEL);
  // Hydrated (the player has read its media query) before the clock moves.
  await expect(page.locator("#s1 .compile-film-sequence")).toHaveAttribute("data-narrow", "1");
  await expect(panel).toHaveCount(0);
  await page.clock.fastForward(8_000);
  await page.clock.runFor(500);
  const film = (await page.locator("#s1 .compile-film-viewport").boundingBox())!;
  const line = (await page.locator("#s1 [data-film-reading] p").boundingBox())!;
  const height = page.viewportSize()!.height;
  if (await panel.count()) {
    const box = (await panel.boundingBox())!;
    expect(overlaps(box, film), "the 8 s sheet covers the film").toBe(false);
    expect(overlaps(box, line), "the 8 s sheet covers the reading line").toBe(false);
  } else {
    // Waiting, because the film and its line reach into the sheet's 104px zone at the foot of the screen.
    expect(Math.max(film.y + film.height, line.y + line.height)).toBeGreaterThan(height - 104);
    expect(Math.min(film.y, line.y)).toBeLessThan(height);
  }
  await page.evaluate(() => window.scrollTo(0, 300));
  await expect(panel).toBeVisible();
  await settle(panel);
  const box = (await panel.boundingBox())!;
  const moved = (await page.locator("#s1 .compile-film-viewport").boundingBox())!;
  const movedLine = (await page.locator("#s1 [data-film-reading] p").boundingBox())!;
  expect(overlaps(box, moved), "the scrolled sheet covers the film").toBe(false);
  expect(overlaps(box, movedLine), "the scrolled sheet covers the reading line").toBe(false);
  expect(box.y + box.height).toBeGreaterThan(height - 40);
  await testInfo.attach("home-phone-sheet", { body: await page.screenshot(), contentType: "image/png" });
});

/*
  Fix round 3 (judge gap 3), 1440. The row under the header was #faf9f6 on the #faf9f6 page with a
  1.31:1 rule. Text >= 4.5:1, and the rule and the two answers' borders >= 3:1 (WCAG 1.4.11) against
  the row and the page.
*/
test("on Home from 900px the consent row reads as its own row", async ({ page }, testInfo) => {
  test.skip(!["1920", "1440", "1280", "1024"].includes(testInfo.project.name), "the Home row exists from 900px");
  await page.goto("/");
  const panel = await revealConsent(page);
  const contrast = await panel.evaluate(element => {
    const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
    const over = (fg: number[], bg: number[]) => [0, 1, 2].map(i => fg[i]! * (fg[3] ?? 1) + bg[i]! * (1 - (fg[3] ?? 1)));
    const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!); };
    const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x! + 0.05) / (y! + 0.05); };
    const style = getComputedStyle(element);
    const row = rgb(style.backgroundColor).slice(0, 3);
    const pageGround = rgb(getComputedStyle(document.querySelector("#s1")!).backgroundColor).slice(0, 3);
    const rule = rgb(style.borderBottomColor);
    const button = getComputedStyle(element.querySelector("button")!);
    return {
      text: ratio(over(rgb(getComputedStyle(element.querySelector("p")!).color), row), row),
      answer: ratio(over(rgb(button.color), row), row),
      ruleWidth: parseFloat(style.borderBottomWidth),
      ruleOnRow: ratio(over(rule, row), row),
      ruleOnPage: ratio(over(rule, pageGround), pageGround),
      answerBorder: ratio(over(rgb(button.borderTopColor), row), row),
    };
  });
  await testInfo.attach("home-row-contrast", { body: JSON.stringify(contrast, null, 2), contentType: "application/json" });
  expect(contrast.text).toBeGreaterThanOrEqual(4.5);
  expect(contrast.answer).toBeGreaterThanOrEqual(4.5);
  expect(contrast.ruleWidth).toBeGreaterThanOrEqual(1);
  expect(contrast.ruleOnRow).toBeGreaterThanOrEqual(3);
  expect(contrast.ruleOnPage).toBeGreaterThanOrEqual(3);
  expect(contrast.answerBorder).toBeGreaterThanOrEqual(3);
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
  await expect(page.getByText("Unavailable", { exact: true })).toBeVisible();
  const records = () => page.evaluate(() => JSON.parse(sessionStorage.getItem("tavonel.funnel-log") ?? "[]"));
  expect(await records()).not.toContainEqual({ event: "generate_lead" });
  success = true;
  await page.getByRole("button", { name: "Send inquiry" }).click();
  await expect(page.locator('[data-state="sent"]')).toBeVisible();
  expect(await records()).toContainEqual({ event: "generate_lead" });
  expect(JSON.stringify(await records())).not.toMatch(/test@example|Test Visitor|production delivery/);
});

/*
  Stage-A open risk 5, proven where it actually renders.

  `/ko` became a measured public page, and the banner it then showed was the English one. The
  unit test beside `consentCopy` holds the selection; this holds the render, because the failure
  was visible in a screenshot and invisible to every assertion in the repository.
*/
test("the Korean entry page asks for consent in Korean, and other pages do not", async ({ page }) => {
  await page.goto("/ko");
  await revealConsent(page);
  const korean = page.getByRole("region", { name: "선택 분석" });
  await expect(korean).toBeVisible();
  await expect(page.getByRole("button", { name: "분석 허용", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "허용하지 않음", exact: true })).toBeVisible();
  // The same two choices, and the same behaviour behind them.
  await expect(page.getByRole("button", { name: "Allow analytics" })).toHaveCount(0);
  await page.getByRole("button", { name: "허용하지 않음", exact: true }).click();
  await expect(korean).toHaveCount(0);
  await expect(page.getByRole("button", { name: "분석 설정" })).toBeVisible();

  // And the refusal is one choice for the whole site, not one per language.
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Optional analytics" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Analytics preferences" })).toBeVisible();
});
