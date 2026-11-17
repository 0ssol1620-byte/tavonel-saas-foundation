import { PHONE_HERO_STILL_REASON, phoneShowsStill } from "../lib/hero-phone-mode";
import { expect, test } from "@playwright/test";

async function dismissConsent(page: import("@playwright/test").Page) {
  // Each test starts with fresh storage. The banner mounts after hydration;
  // an immediate visibility probe can miss it and measure controls underneath it.
  // Release 2: the consent card appears after a 200px scroll (or 8 s), not on the first paint.
  await page.evaluate(() => window.scrollTo(0, 300));
  const panel = page.getByRole("region", { name: "Optional analytics", exact: true });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "No thanks", exact: true }).click();
  await expect(panel).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, 0));
}

/*
  V34 Home (WO-CI-5b). Home ends on the shared closing strip (`section[aria-labelledby="v34-final-title"]`): one heading,
  the primary action and one more link. What a reader is owed is unchanged -- a real destination at a target a thumb can hit.
*/
test("the closing scene ends on usable next actions", async ({ page }) => {
  await page.goto("/");
  await dismissConsent(page);
  const scene = page.locator('section[aria-labelledby="v34-final-title"]');
  await expect(scene).toHaveCount(1);
  await scene.scrollIntoViewIfNeeded();
  const links = scene.locator("a");
  await expect(links).toHaveCount(2);
  for (const link of await links.all()) {
    // Reveal transforms can produce 43.999969 for a CSS 44px target; keep the threshold at
    // hundredth-pixel precision rather than loosening it.
    expect(Math.round((await link.boundingBox())!.height * 100) / 100, await link.innerText()).toBeGreaterThanOrEqual(44);
    expect(await link.getAttribute("href"), "a scene that ends nowhere is not a route").toMatch(/^\//);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("evidence actions fit the document without clipping long source links", async ({ page }) => {
  await page.goto("/evidence");
  await dismissConsent(page);
  const geometry = await page.evaluate(() => ({
    viewport: innerWidth,
    page: document.documentElement.scrollWidth,
    actions: [...document.querySelectorAll<HTMLElement>("main .actions .btn")]
      .map(element => ({ text: element.innerText, rect: element.getBoundingClientRect().toJSON() })),
  }));
  expect(geometry.page).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.actions.length).toBeGreaterThan(0);
  for (const action of geometry.actions) {
    expect(action.rect.x, action.text).toBeGreaterThanOrEqual(0);
    expect(action.rect.right, action.text).toBeLessThanOrEqual(geometry.viewport);
    expect(action.rect.height, action.text).toBeGreaterThanOrEqual(44);
  }
});

test("pricing puts catalog-backed choices before detailed explanations", async ({ page }) => {
  await page.goto("/pricing");
  await dismissConsent(page);
  const plans = page.locator(".pricing-page .plans");
  await expect(plans.locator(".plan")).toHaveCount(4);
  await expect(page.locator(".pricing-faq details")).toHaveCount(17);
  const planDetails = page.locator("#plan-details");
  await expect(planDetails).not.toHaveAttribute("open", "");
  await expect(page.locator(".pricing-details")).not.toBeVisible();
  await planDetails.locator(":scope > summary").click();
  await expect(page.locator(".pricing-details")).toBeVisible();
  /*
    Ten with the explicit human-activation policy beside the nine plan details. Refunds states
    the window and consumed share here rather than only in the FAQ below it.

    Still an exact count, not a floor -- this glance is the summary a buyer reads instead of the
    detail, so a row appearing has to be a decision someone made rather than something that
    accumulated -- and now the titles as well, in order, because a count alone cannot tell a
    renamed tile from a replaced one and three of these titles are the ones a claims guard in
    `lib/product-claims-sync.test.ts` reads the body of.
  */
  await expect(page.locator(".pricing-glance .tile h3")).toHaveText([
    "Base subscription",
    "Included pages",
    "Past the included pages",
    "Unused pages",
    "What differs by plan",
    "What does not consume pages",
    "Spreadsheets",
    "Refunds",
    "How to start",
    // D31: the tile is "Human activation" now. The `candidatePromotion` gate key below is an
    // identifier, not copy, so it stays exactly as the purchase gate publishes it.
    "Human activation",
  ]);
  await expect(page.locator('[data-purchase-gate="candidatePromotion"]'))
    .toContainText("Activation is always an explicit human decision.");
  const choice = await plans.boundingBox();
  const details = await page.locator(".pricing-details").boundingBox();
  expect(choice!.y + choice!.height).toBeLessThan(details!.y);
  expect(await plans.locator("a.btn").evaluateAll(elements => elements.every(e => e.getBoundingClientRect().height >= 44))).toBe(true);
  await expect(page.locator("#pricing-faq")).not.toHaveAttribute("open", "");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

/* V34 shell: from 1000px down the bar gives way to a modal <dialog> drawer (components/v34/shell/mobile-drawer.tsx). */
const DRAWER_MAX = 1000;

test("phone and tablet use real navigation targets instead of clickable decorative scene marks", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) > DRAWER_MAX, "Desktop uses the bar.");
  await page.goto("/");
  await dismissConsent(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Site navigation" });
  await expect(drawer).toBeVisible();
  // The sheet's rows: the five primary destinations, then Sign in and the start action. A group's links are its own targets.
  const targets = await drawer.locator('nav[aria-label="Site"] > ul a, a[href="/login"], a[data-analytics="header-start"]').evaluateAll(elements => elements.map(e => {
    const r = e.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return {
      text: e.textContent?.trim() ?? "",
      href: e.getAttribute("href"),
      width: r.width,
      height: r.height,
      inside: hit === e || e.contains(hit),
    };
  }));
  /*
    Pinning names and hrefs makes this catch an omitted destination, an invented one, or Pricing appearing twice.
    The five are the bar's own list (lib/v34/nav.ts, rendered into the page whatever the width), not typed here; Sign in
    and the start action follow.
  */
  const primary = await page.locator('[data-v34-header] nav[aria-label="Primary"] a').evaluateAll(links =>
    links.map(link => ({ text: link.textContent?.trim() ?? "", href: link.getAttribute("href") })),
  );
  expect(primary.length, "the bar names its primary destinations").toBeGreaterThanOrEqual(5);
  expect(targets.slice(0, primary.length).map(({ text, href }) => ({ text, href }))).toEqual(primary);
  expect(primary.map(item => item.href)).toContain("/pricing");
  expect(targets.slice(primary.length).map(({ href }) => href)).toContain("/login");
  expect(targets).toHaveLength(primary.length + 2);
  for (const target of targets) {
    expect(target.width, target.text).toBeGreaterThan(44);
    expect(target.height, target.text).toBeGreaterThanOrEqual(44);
    expect(target.inside, target.text).toBe(true);
  }
});

test("copy controls and navigation remain readable and operable", async ({ page }) => {
  await page.goto("/docs/quickstart");
  await dismissConsent(page);
  await expect(page.locator(".docs-copy").first()).toBeVisible();
  expect(await page.locator(".docs-copy").first().evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  const width = page.viewportSize()!.width;
  let pricing;
  if (width > DRAWER_MAX) {
    // The bar carries Pricing and the start action, inside the viewport.
    pricing = page.locator('[data-v34-header] nav[aria-label="Primary"] a[href="/pricing"]');
    const start = await page.locator('[data-v34-header] a[data-analytics="header-start"]:visible').boundingBox();
    expect(start).not.toBeNull();
    expect(start!.x + start!.width).toBeLessThanOrEqual(width);
  } else {
    // Below it the bar's items move into the drawer.
    await page.getByRole("button", { name: "Open navigation" }).click();
    pricing = page.getByRole("dialog", { name: "Site navigation" }).locator('nav[aria-label="Site"] > ul a[href="/pricing"]');
  }
  await expect(pricing).toBeVisible();
  expect(await pricing.evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(11.5);
});


test("the Home first screen puts actions before its four-cut hero film and source proof below it", async ({ page }, testInfo) => {
  test.skip(phoneShowsStill(testInfo.project.name), PHONE_HERO_STILL_REASON);
  const width = page.viewportSize()?.width ?? 0;
  test.skip(width !== 390 && width !== 1440, "Phone and desktop reference widths.");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const consent = page.getByRole("region", { name: "Optional analytics", exact: true });
  // Release 2: the first screen has no consent card at scroll 0, so the "card clears title and
  // action" branch below has nothing to measure until the reader scrolls (marketing-consent.spec).
  await expect(consent).toHaveCount(0);
  // Founder 2026-11-10: the hero film is the tabbed compile slot (hero-compile-tabs.tsx); the recorded walkthrough is below the fold.
  const film = page.locator('#s1 h1 + .lv2-hero-support + [data-testid="landing-hero-actions"] + figure[data-testid="hero-compile-tabs"]');
  await expect(film.getByRole("tab")).toHaveText(["Extract", "Link", "Update", "Use"]);
  // FINAL-SPEC 2026-10-26 D-9: the disclosure stays; its wording is the redesign's.
  await expect(film.locator("figcaption")).toHaveText("Product walkthrough on sample files");
  const measure = async () => page.evaluate(() => {
    const rect = (selector: string) => { const element = document.querySelector(selector); if (!element) throw Error("Missing Home element: " + selector); return element.getBoundingClientRect().toJSON(); };
    const banner = document.querySelector('[data-marketing-consent-panel]');
    return { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth - innerWidth,
      header: rect("header.nav"), title: rect("#lv2-hero-title"), film: rect('#s1 figure[data-testid="hero-compile-tabs"]'),
      action: rect("#s1 .lv2-actions a"), source: rect("#s2 article[data-case-status]"), banner: banner?.getBoundingClientRect().toJSON() ?? null };
  });
  for (const consentVisible of [true, false]) {
    if (!consentVisible) await dismissConsent(page);
    const layout = await measure();
    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(layout.title.top).toBeGreaterThanOrEqual(layout.header.bottom - 1);
    expect(layout.film.top).toBeGreaterThanOrEqual(layout.title.bottom);
    expect(layout.film.top).toBeLessThan(layout.height);
    expect(layout.film.left).toBeGreaterThanOrEqual(-1);
    expect(layout.film.right).toBeLessThanOrEqual(layout.width + 1);
    expect(layout.source.top).toBeGreaterThanOrEqual(layout.film.bottom);
    expect(layout.action.top).toBeGreaterThanOrEqual(layout.title.bottom);
    expect(layout.action.bottom).toBeLessThanOrEqual(layout.film.top);
    if (!consentVisible && width === 1440) expect(layout.action.bottom).toBeLessThanOrEqual(900);
    // Brief 2026-10-15 move 6: the consent card is bottom-fixed and must clear the title and action.
    if (consentVisible && layout.banner) {
      expect(layout.banner.bottom).toBeLessThanOrEqual(layout.height + 1);
      expect(layout.banner.top).toBeGreaterThanOrEqual(layout.title.bottom);
      expect(layout.banner.top).toBeGreaterThanOrEqual(layout.action.bottom);
    }
    await test.info().attach("home-first-screen-" + width + "-consent-" + consentVisible, {body: await page.screenshot({animations: "disabled"}), contentType: "image/png"});
  }
  const source = page.locator("#s2 article[data-case-status]");
  await source.scrollIntoViewIfNeeded();
  await expect(source).toContainText("processing not yet run");
  await expect(source.getByRole("button", {pressed: true})).toHaveCount(1);
  await expect(source.locator("img")).toBeVisible();
  await expect(source.locator("blockquote")).not.toHaveText("");
  await expect(source.locator("[data-hero-evidence]")).toHaveAttribute("href", /act=evidence/);
});
