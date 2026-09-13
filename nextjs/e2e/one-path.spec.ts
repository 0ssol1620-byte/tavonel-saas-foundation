import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const widths = [360, 390, 412, 768, 1024, 1280, 1440, 1920];
const output = resolve("../.chatgpt2codex/e2e/one-path");
const labels = ["How it works", "Connect", "Pricing"];

for (const width of widths) {
  test(`film-first composition is usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await page.goto("/");
    await expect(page.locator("#one-path-title")).toContainText("ready for AI.");
    await expect(page.locator("main > section[data-scene]")).toHaveCount(6);
    const film = page.getByTestId("one-path-hero-film");
    await expect(film).toBeVisible();
    const bounds = await film.boundingBox();
    expect(bounds!.y).toBeLessThan(width < 768 ? 500 : 380);
    expect(bounds!.width).toBeGreaterThan(width < 768 ? width - 60 : width * .4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await expect(page.locator("#s1 .one-path-source-proof")).toHaveCount(0);
    await expect(page.locator("#proof .one-path-source-proof")).toHaveCount(1);
    await expect(page.locator(".one-path-film-note")).toContainText("approved source film is preserved");
    const sectionOrder = await page.locator("main > section[data-scene]").evaluateAll(nodes => nodes.map(node => node.id));
    expect(sectionOrder).toEqual(["s1", "how-it-works", "connect", "proof", "stays-current", "ready-for-ai"]);
    const desktop = page.locator(".one-path-primary-nav");
    if (await desktop.isVisible()) {
      await expect(desktop.getByRole("link")).toHaveText(labels);
    } else {
      const menu = page.locator(".one-path-mobile-nav");
      await menu.locator("summary").click();
      await expect(menu.locator(".mobile-nav-direct")).toHaveText(labels);
      await page.keyboard.press("Escape");
      await expect(menu).not.toHaveAttribute("open", "");
      await expect(menu.locator("summary")).toBeFocused();
    }
    const smallTargets = await page.locator("#s1 a, #s1 button").evaluateAll(elements => elements.filter(element => {
      const r = element.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.height < 43;
    }).map(element => element.textContent));
    expect(smallTargets).toEqual([]);
    mkdirSync(output, { recursive: true });
    await page.screenshot({ path: resolve(output, `home-${width}.png`) });
    await page.screenshot({ path: resolve(output, `home-${width}-full.png`), fullPage: true });
  });
}

test("hero is the accelerated V2 presentation and Works uses the supporting locked cuts", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const hero = page.getByTestId("one-path-hero-film");
  await hero.scrollIntoViewIfNeeded();
  await expect(hero.locator("video")).toHaveCount(1);
  await expect.poll(() => hero.locator("video").evaluate((video: HTMLVideoElement) => video.currentSrc)).toContain("compile-cut.mp4");
  await expect.poll(() => hero.locator("video").evaluate((video: HTMLVideoElement) => video.playbackRate)).toBe(1.5);
  await expect(hero.getByRole("tab")).toHaveCount(0);

  const film = page.getByTestId("one-path-works-film");
  await film.scrollIntoViewIfNeeded();
  const pairs = [["ORGANIZE", "compile-cut-2.mp4"], ["UPDATES", "compile-cut-3.mp4"]];
  for (const [label, name] of pairs) {
    await film.getByRole("tab", { name: label, exact: true }).click();
    await expect(film.getByRole("tab", { name: label, exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(film.locator("video")).toHaveCount(1);
    await expect.poll(() => film.locator("video").evaluate((video: HTMLVideoElement) => video.currentSrc)).toContain(name);
    await expect.poll(() => film.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(.05);
  }
});

test("reduced motion starts as a poster and explicit play/pause works", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const film = page.getByTestId("one-path-hero-film");
  await film.scrollIntoViewIfNeeded();
  await expect(film.locator("video")).toHaveCount(0);
  await expect(film.locator(".compile-film-still")).toBeVisible();
  await film.getByRole("button", { name: "Play the compilation film" }).click();
  await expect(film.locator("video")).toHaveCount(1);
  await film.getByRole("button", { name: "Pause the compilation film" }).click();
  await expect(film.locator("video")).toHaveCount(0);
  await expect(film.locator(".compile-film-still")).toBeVisible();
});

test("failed video keeps a usable poster instead of a blank hero", async ({ page }) => {
  await page.route("**/film/*.mp4", route => route.fulfill({ status: 404, body: "" }));
  await page.goto("/");
  const film = page.getByTestId("one-path-hero-film");
  await film.scrollIntoViewIfNeeded();
  await expect(film).toContainText("could not play the film", { timeout: 15_000 });
  await expect(film.locator(".compile-film-still")).toBeVisible();
  await expect(page.getByRole("link", { name: /Inspect the public source/ })).toBeVisible();
});

test("Korean entry keeps film first and the live example distinct", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ko");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("AI가 쓰는 지식으로.");
  await expect(page.locator(".one-path-hero-film")).toBeVisible();
  await expect(page.locator(".one-path-film-note")).toContainText("실제 서비스 화면 녹화가 아닙니다");
  await expect(page.getByRole("heading", { level: 2, name: /어려운 처리는 TAVONEL이 맡습니다/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: resolve(output, "ko-390.png") });
});

/** Local fixture only. Refuse any run against a public deployment before creating test state. */
async function localWorkspace(page: Page, baseURL: string | undefined, source: "owner" | "trial" = "owner") {
  if (!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) throw Error("Workspace fixtures require a loopback-only test server.");
  const user = { id: "44444444-4444-4444-4444-444444444444", aud: "authenticated", role: "authenticated", email: "one-path@example.invalid", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
  const encode = (object: unknown) => Buffer.from(JSON.stringify(object)).toString("base64url");
  const jwt = `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: user.id, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.test-signature`;
  await page.addInitScript(({ jwt, user }) => localStorage.setItem("sb-test-auth-token", JSON.stringify({ access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "fixture-not-valid", user })), { jwt, user });
  await page.route("https://test.supabase.co/**", route => route.fulfill({ json: user }));
  await page.route("**/api/access/bootstrap", route => route.fulfill({ json: { code: "ACCESS_READY", access: { source, accessPlan: "studio_access", billingExempt: source === "owner", expiresAt: null, limits: null } } }));
  await page.route("**/api/compile-jobs", route => route.fulfill({ json: { code: "OK", jobs: [] } }));
  await page.route("**/api/billing/status", route => route.fulfill({ json: { account: { accessPlan: null, subscriptionStatus: "inactive", creditBalance: 0, lifetimeCreditsPurchased: 0, lifetimeCreditsReversed: 0, billingHold: false, paddleCustomerId: null, subscriptionCancelAt: null, updatedAt: null } } }));
  await page.route("**/api/documents", route => route.fulfill({ json: { documents: [] } }));
}

test("empty workspace has four primary choices and optional tools remain reachable", async ({ page, baseURL }) => {
  await localWorkspace(page, baseURL);
  await page.goto("/workspace");
  await expect(page.locator("#workspace-state-title")).toHaveText("Add your knowledge.");
  const rail = page.getByRole("complementary", { name: "Workspace navigation" });
  await expect(rail.locator("nav > div")).toHaveCount(4);
  for (const label of ["Home", "Knowledge", "Use with AI"]) await expect(rail.getByRole("button", { name: label, exact: true })).toBeVisible();
  const more = rail.locator(".one-path-more");
  await more.locator("summary").click();
  for (const label of ["Review", "Changes", "Knowledge graph", "Connections", "Developer tools", "Activity", "Settings"]) await expect(more.getByRole("button", { name: label, exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(more.locator("summary")).toBeFocused();
  await expect(page.locator(".workspace-getting-started-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("CANDIDATE", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: resolve(output, "workspace-empty.png"), fullPage: true });
});

test("trial tools stay restricted inside the simplified More menu", async ({ page, baseURL }) => {
  await localWorkspace(page, baseURL, "trial");
  await page.goto("/workspace");
  await expect(page.locator(".one-path-workspace")).toHaveAttribute("data-access", "trial");
  const more = page.locator(".one-path-more");
  await more.locator("summary").click();
  await expect(more.getByRole("button", { name: "Connections", exact: true })).toHaveCount(0);
  await expect(more.getByRole("button", { name: "Developer tools", exact: true })).toHaveCount(0);
  await expect(more.getByRole("button", { name: "Review", exact: true })).toBeVisible();
});

test("AI destination setup is reachable without claiming a verified connection", async ({ page, baseURL }) => {
  await localWorkspace(page, baseURL);
  await page.goto("/workspace");
  await expect(page.locator("#workspace-state-title")).toHaveText("Add your knowledge.");
  await page.getByRole("complementary", { name: "Workspace navigation" }).getByRole("button", { name: "Use with AI", exact: true }).click();
  const guide = page.locator("#workspace-ask").getByTestId("workspace-ai-use-guide");
  await expect(guide).toBeVisible();
  await expect(guide.getByRole("tab", { name: "AI assistant", exact: true })).toHaveAttribute("aria-selected", "true");
  await guide.getByRole("tab", { name: "AI assistant", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(guide.getByRole("tab", { name: "My application", exact: true })).toBeFocused();
  await expect(guide.getByRole("link", { name: "Open the API quickstart" })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(guide.getByRole("tab", { name: "Local files", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(guide).toContainText("A folder path alone grants no access");
  await expect(guide).toContainText("An external AI connection has not been verified");
  await expect(page.locator("#ask-question")).toBeDisabled();
  await page.screenshot({ path: resolve(output, "workspace-ai-setup.png"), fullPage: true });
});
