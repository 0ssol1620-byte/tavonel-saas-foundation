/** Active source-led Home contract. Retired specimen timers are outside this route. */
import { test, expect, type Page } from "@playwright/test";
const BENCH = "#s1 article[data-case-status]";
const FILM = "#s2 .compile-film-sequence";
const SECTIONS = ["s1", "s2", "s3", "s4", "s5", "s6"];
async function openFilm(page: Page) {
  await expect(page.locator("header.nav")).toHaveAttribute("data-scrolled", /./);
  const disclosure = page.getByTestId("landing-film-disclosure");
  await disclosure.locator("summary").click();
  await expect(disclosure).toHaveAttribute("open", "");
  await expect(page.locator(FILM)).toBeVisible();
  return page.locator(FILM);
}
for (const route of ["/", "/ko"]) {
  test(`${route} offers the next action before the source and difficult context`, async ({ page }) => {
    await page.goto(route);
    const actions = await page.locator("#s1 .lv2-actions").boundingBox();
    const source = await page.locator(BENCH).boundingBox();
    const context = await page.locator("#s2 h2").first().boundingBox();
    expect(actions).not.toBeNull(); expect(source).not.toBeNull(); expect(context).not.toBeNull();
    expect(actions!.y + actions!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect(actions!.y + actions!.height).toBeLessThan(source!.y);
    expect(source!.y + source!.height).toBeLessThan(context!.y);
    await expect(page.locator("[data-compiler-specimen]")).toHaveCount(0);
  });
  test(`${route} renders six ordered, named scene landmarks`, async ({ page }) => {
    await page.goto(route);
    const sections = page.locator("main > section[data-scene]");
    await expect(sections).toHaveCount(6);
    expect(await sections.evaluateAll(nodes => nodes.map(node => node.id))).toEqual(SECTIONS);
    expect(await sections.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-scene")))).toEqual(["1", "2", "3", "4", "5", "6"]);
    for (const id of SECTIONS) {
      const section = page.locator(`section#${id}`);
      await expect(section).toHaveAttribute("tabindex", "-1");
      const headingId = await section.getAttribute("aria-labelledby");
      expect(headingId).toBeTruthy();
      await expect(page.locator(`[id=${JSON.stringify(headingId)}]`)).toHaveCount(1);
    }
    await expect(page.locator("main#main")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("main > [data-home-reader-guide]")).toHaveCount(1);
  });
  test(`${route} has no duplicate ids, broken targets or horizontal overflow`, async ({ page }) => {
    await page.goto(route);
    const result = await page.evaluate(() => {
      const ids = [...document.querySelectorAll("[id]")].map(node => node.id);
      return { duplicates: ids.filter((id, i) => ids.indexOf(id) !== i),
        missing: [...document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')].map(link => link.hash.slice(1)).filter(id => id && !document.getElementById(id)),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    expect(result.duplicates).toEqual([]); expect(result.missing).toEqual([]);
    expect(result.overflow).toBeLessThanOrEqual(1);
  });
  test(`${route} keeps every selected passage bound to its source region`, async ({ page }) => {
    await page.goto(route);
    const bench = page.locator(BENCH), buttons = bench.getByRole("button");
    const digest = await bench.getAttribute("data-source-digest");
    expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    await expect(buttons).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await buttons.nth(i).click();
      await expect(buttons.nth(i)).toHaveAttribute("aria-pressed", "true");
      await expect(bench.locator('button[aria-pressed="true"]')).toHaveCount(1);
      const selected = bench.locator('[data-region-id][data-selected="1"]');
      await expect(selected).toHaveCount(1);
      const id = await selected.getAttribute("data-region-id");
      const href = await bench.locator("[data-hero-evidence]").getAttribute("href");
      expect(new URL(href!, "https://tavonel.com").searchParams.get("evidence")).toBe(id);
      await expect(bench.locator("blockquote")).not.toBeEmpty();
      await expect(bench).toHaveAttribute("data-source-digest", digest!);
    }
  });
  test(`${route} opens source details by keyboard and keeps all region links`, async ({ page }) => {
    await page.goto(route);
    const bench = page.locator(BENCH), details = bench.locator("details");
    await expect(details).not.toHaveAttribute("open");
    await details.locator("summary").focus(); await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("open", "");
    await expect(details.locator('a[href^="/explore?act=evidence"]')).toHaveCount(3);
    await expect(details).toContainText((await bench.getAttribute("data-source-digest"))!);
  });
}
test("keeps the English brand line as the single H1", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1#lv2-hero-title")).toHaveCount(1);
  expect((await page.locator("h1").innerText()).replace(/\s+/g, " ").trim()).toBe("Your documents. Knowledge you can verify.");
});
test("Korean close follows its commercial destination and keeps Korean pricing", async ({ page }) => {
  await page.goto("/ko");
  const close = page.locator("#s6"), action = close.locator('[data-scene-next="start"]');
  await expect(close.getByRole("link", { name: "요금 보기" })).toHaveAttribute("href", "/ko/pricing");
  const destination = await action.getAttribute("href");
  expect(destination).toMatch(/^(\/ko\/contact|\/login)$/);
  await Promise.all([page.waitForURL(url => url.pathname === destination), action.click()]);
  if (destination === "/ko/contact") {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("도입을 함께 검토합니다");
    await expect(page.getByRole("button", { name: "문의 보내기" })).toBeVisible();
    await expect(page.locator('input[name="name"]')).toHaveAttribute("required", "");
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "English" })).toHaveAttribute("href", "/contact");
  } else await expect(page.locator('input[type="email"]')).toBeVisible();
});
test("optional film starts closed with no mounted video or canvas", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("landing-film-disclosure")).not.toHaveAttribute("open");
  await expect(page.locator(".compile-film-sequence")).toHaveCount(0);
  await expect(page.locator("main video, main canvas")).toHaveCount(0);
});
test("optional film opens all four approved cuts with the locked video source", async ({ page }) => {
  await page.goto("/"); const film = await openFilm(page);
  await expect(film.getByRole("tab")).toHaveCount(4);
  await expect(film.getByRole("tab")).toHaveText(["Files", "Organize", "Updates", "Use with AI"]);
  await expect(film).toHaveAttribute("data-video-primary-src", "/film/compile-cut.mp4");
  await expect(page.getByTestId("landing-film-disclosure")).toContainText("Illustrative product walkthrough");
  await film.getByRole("tab").nth(2).click();
  await expect(film.getByRole("tab").nth(2)).toHaveAttribute("aria-selected", "true");
});
test("server-renders only the actual source page as the high-priority image", async ({ request }) => {
  const response = await request.get("/"); expect(response.status()).toBe(200);
  const html = await response.text();
  const high = [...html.matchAll(/<img[^>]*>/g)].map(match => match[0]).filter(tag => /fetchpriority="high"/i.test(tag));
  expect(high).toHaveLength(1); expect(high[0]).toContain("apple-2026-q1-10-q-reference-p004");
  expect(high[0]).toMatch(/loading="eager"/i); expect(high[0]).toMatch(/ width="[1-9]\d*"/); expect(high[0]).toMatch(/ height="[1-9]\d*"/);
  expect(html).not.toContain('class="compile-film-still"');
});
test("reduced motion opens a static poster and keeps all cuts selectable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.goto("/");
  const film = await openFilm(page);
  await expect(film.locator(".compile-film-still")).toBeVisible();
  await expect(film.getByRole("button", { name: "Play the compilation film", exact: true })).toBeVisible();
  await film.getByRole("tab").last().click();
  await expect(film.getByRole("tab").last()).toHaveAttribute("aria-selected", "true");
});
test("source controls clear the touch floor and keep selected regions inside the page window", async ({ page }) => {
  await page.goto("/"); const bench = page.locator(BENCH), buttons = bench.getByRole("button");
  await expect(buttons).toHaveCount(3);
  for (const button of await buttons.all()) {
    await button.click(); expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const window = (await bench.locator("[data-page-window]").boundingBox())!;
    const selected = (await bench.locator('[data-region-id][data-selected="1"]').boundingBox())!;
    expect(selected.x).toBeGreaterThanOrEqual(window.x - 1); expect(selected.x + selected.width).toBeLessThanOrEqual(window.x + window.width + 1);
    expect(selected.y).toBeGreaterThanOrEqual(window.y - 1); expect(selected.y + selected.height).toBeLessThanOrEqual(window.y + window.height + 1);
  }
});
test("Korean pricing carries the selected plan into the inquiry", async ({ page }) => {
  await page.goto("/ko/pricing"); await page.getByRole("link", { name: "Developer 도입 상담" }).click();
  await expect(page).toHaveURL(/\/ko\/contact\?plan=Developer$/);
  await expect(page.locator("[data-plan-intent]")).toHaveText("Developer 요금제 문의");
  await expect(page.locator('input[name="plan"]')).toHaveValue("Developer");
});
