/**
 * Landing V2 browser contract for the structural Home candidate.
 *
 * Six beats: a short lead over one full-width workbench (source -> highlighted passage ->
 * record), why that passage is hard, what a reader receives, what changed in the sources, trust,
 * and the close. The workbench selects among its regions with native buttons, cites each one
 * exactly, shows the source page straight under its name (on a phone, in the first viewport, ahead
 * of the passage), and links the full SEC filing beside that page. Scene 02 keeps the four approved film
 * cuts behind a native disclosure that is closed on load -- no player, poster or video is
 * requested until a reader opens it. The retired CompilerSpecimen, proof tabs and Evidence
 * Inspector are not on Home.
 */

import { test, expect, type Page } from "@playwright/test";

const HEADLINE = "Your documents. Knowledge you can verify.";
const REQUIRED_WIDTHS = new Set(["1920", "1440", "1280", "1024", "768", "390", "360"]);
const SECTIONS = ["s1", "s2", "s3", "s4", "s5", "s6"] as const;
/* The four film cuts sit in Scene 02, after the difficulty list, behind a disclosure closed on load. */
const FILM_DISCLOSURE = '#s2 [data-testid="landing-film-disclosure"]';
const FILM = "#s2 .compile-film-sequence";
const FILM_SUMMARY = "Watch the illustrative product walkthrough";
const HERO_SOURCE = "#s1 article[data-source-digest]";
const HERO_VIDEO = "/film/compile-cut.mp4";
/* The default sample's one verified official filing (main2065 sources metadata). */
const SEC_FILING = "https://www.sec.gov/Archives/edgar/data/320193/000032019326000006/aapl-20251227.htm";
const STATUS = {
  "/": "Prepared demonstration / processing not yet run",
  "/ko": "준비된 시연 / 아직 처리를 실행하지 않음",
} as const;
const FULL_FILING = { "/": "Open full filing (SEC)", "/ko": "전체 공시 열기 (SEC)" } as const;
const OPEN_REGION = { "/": "Open this region in Explore", "/ko": "Explore에서 이 영역 열기" } as const;
/* While the server resolves access to /contact, the hero offers the document evaluation instead. */
const EVALUATION = {
  "/": { href: "/evaluation", label: "Evaluate your documents" },
  "/ko": { href: "/ko/evaluation", label: "내 문서 평가 상담" },
} as const;

async function openFilm(page: Page) {
  const disclosure = page.locator(FILM_DISCLOSURE);
  await disclosure.locator("summary", { hasText: FILM_SUMMARY }).click();
  await expect(disclosure).toHaveJSProperty("open", true);
  return page.locator(FILM);
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** The workbench's region buttons, in order, as the native list renders them. */
function regionButtons(page: Page) {
  return page.locator(`${HERO_SOURCE} ul button[aria-pressed]`);
}

/** Every region's exact Explore link, in region order, read from the card's Source details. */
async function regionHrefs(page: Page): Promise<string[]> {
  return page.locator(`${HERO_SOURCE} details li a[href]`).evaluateAll(links =>
    links.map(link => link.getAttribute("href") ?? ""),
  );
}

test.describe("six-beat page structure", () => {
  test("Korean close leads to a Korean inquiry and Korean pricing", async ({ page }) => {
    await page.goto("/ko");
    const close = page.locator("#s6");
    await expect(close.locator('[data-scene-next="start"]')).toHaveAttribute("href", "/ko/contact");
    await expect(close.getByRole("link", { name: "요금 보기" })).toHaveAttribute("href", "/ko/pricing");
    await close.locator('[data-scene-next="start"]').click();
    await expect(page).toHaveURL(/\/ko\/contact$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("도입을 함께 검토합니다");
    await expect(page.getByRole("button", { name: "문의 보내기" })).toBeVisible();
    await expect(page.locator('input[name="name"]')).toHaveAttribute("required", "");
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "English" })).toHaveAttribute("href", "/contact");
    if ((page.viewportSize()?.width ?? 1440) <= 390) {
      const formTop = await page.locator("form").evaluate((form) => form.getBoundingClientRect().top);
      expect(formTop, "the mobile inquiry form should begin in the first viewport").toBeLessThan(844);
    }
  });

  for (const path of ["/", "/ko"] as const) {
    test(`${path} leads with the actions over one full-width workbench, before the difficulty and the film`, async ({ page }) => {
      await page.goto(path);
      const actions = page.locator("#s1 .lv2-actions");
      const source = page.locator(HERO_SOURCE);
      const evidence = source.locator("[data-hero-evidence]");
      const heading = page.locator("#lv2-difficulty-title");
      const disclosure = page.locator(FILM_DISCLOSURE);
      await expect(actions.locator('[data-analytics="hero-primary"]')).toHaveCount(1);
      await expect(actions.locator('[data-analytics="hero-secondary"]')).toHaveCount(1);
      await expect(source).toHaveCount(1);
      await expect(evidence).toHaveCount(1);
      await expect(evidence).toHaveAttribute("href", /^\/explore\?act=evidence&evidence=/);
      await expect(page.locator("[data-compiler-specimen]")).toHaveCount(0);
      await expect(page.locator("main [role='tablist']")).toHaveCount(0);
      const actionBox = await actions.boundingBox();
      const sourceBox = await source.boundingBox();
      const evidenceBox = await evidence.boundingBox();
      const headingBox = await heading.boundingBox();
      const disclosureBox = await disclosure.boundingBox();
      expect(actionBox).not.toBeNull();
      expect(sourceBox).not.toBeNull();
      expect(evidenceBox).not.toBeNull();
      expect(headingBox).not.toBeNull();
      expect(disclosureBox).not.toBeNull();
      expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
      // Under the lead at every width, and as wide as the hero's content box.
      expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(sourceBox!.y);
      const spare = await source.evaluate(node => {
        const layout = node.parentElement!;
        const style = getComputedStyle(layout);
        const content = layout.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
        return content - node.getBoundingClientRect().width;
      });
      expect(Math.abs(spare), "the workbench takes the hero's full content width").toBeLessThanOrEqual(1);
      expect(evidenceBox!.y).toBeGreaterThanOrEqual(sourceBox!.y);
      expect(evidenceBox!.y + evidenceBox!.height).toBeLessThanOrEqual(sourceBox!.y + sourceBox!.height);
      expect(sourceBox!.y + sourceBox!.height).toBeLessThan(headingBox!.y);
      expect(headingBox!.y + headingBox!.height).toBeLessThan(disclosureBox!.y);
    });

    test(`${path} says the workbench is prepared and not run, and labels the passage as extracted`, async ({ page }) => {
      await page.goto(path);
      const source = page.locator(HERO_SOURCE);
      await expect(source).toHaveAttribute("data-case-status", "extracted");
      const status = source.locator('[data-run="not_run"]');
      await expect(status).toHaveCount(1);
      expect((await status.innerText()).trim()).toBe(STATUS[path]);
      await expect(source.getByText(path === "/ko" ? "기존 추출 구절" : "Existing extracted passage", { exact: true })).toBeVisible();
      await expect(source.locator("blockquote")).toHaveCount(1);
      await expect(source.locator("blockquote")).toHaveAttribute("lang", "en");
      const text = await source.innerText();
      expect(text).not.toMatch(/verified answer/i);
      expect(text).not.toContain(path === "/ko" ? "준비된 시연 ·" : "Prepared demonstration ·");
    });

    test(`${path} links the full SEC filing beside the page, and keeps the page and region links`, async ({ page }) => {
      await page.goto(path);
      const source = page.locator(HERO_SOURCE);
      const filing = source.locator("a[data-full-filing]");
      await expect(filing).toHaveCount(1);
      await expect(filing).toBeVisible();
      await expect(filing).toHaveAttribute("href", SEC_FILING);
      expect((await filing.innerText()).replace("↗", "").trim()).toBe(FULL_FILING[path]);
      // The provenance sentence is in Source details, closed on load.
      await expect(source.locator("details", { hasText: path === "/ko" ? "원본 HTML 공시" : "original HTML filing" })).toHaveCount(1);
      // Beside the page: under its window, in the full page's own link row, outside the closed details.
      const filingBox = await filing.boundingBox();
      const windowBox = await source.locator("[data-page-window]").boundingBox();
      expect(filingBox).not.toBeNull();
      expect(windowBox).not.toBeNull();
      expect(filingBox!.y).toBeGreaterThanOrEqual(windowBox!.y + windowBox!.height - 1);
      expect(filingBox!.height).toBeGreaterThanOrEqual(43.99);
      await expect(source.locator("details a[data-full-filing]")).toHaveCount(0);
      // The full-page overview and every exact region link are still there.
      const pageSrc = await source.locator("img").first().getAttribute("src");
      await expect(source.locator(`a[href="${pageSrc}"]`)).toHaveCount(1);
      await expect(source.locator("p", { has: page.locator("a[data-full-filing]") }).locator(`a[href="${pageSrc}"]`)).toHaveCount(1);
      const hrefs = await regionHrefs(page);
      expect(hrefs.length).toBeGreaterThan(1);
      for (const href of hrefs) expect(href).toMatch(/^\/explore\?act=evidence&evidence=/);
      await expect(source.locator("[data-region-id]")).toHaveCount(hrefs.length);
      await expect(source.getByRole("link", { name: OPEN_REGION[path] }).first()).toBeVisible();
    });
  }

  for (const path of ["/", "/ko"]) {
    test(`${path} renders six ordered, named scene landmarks`, async ({ page }) => {
      await page.goto(path);
      const sections = page.locator("main > section[data-scene]");
      await expect(sections).toHaveCount(SECTIONS.length);
      expect(await sections.evaluateAll(nodes => nodes.map(node => node.id))).toEqual([...SECTIONS]);
      expect(
        await sections.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-scene"))),
      ).toEqual(SECTIONS.map((_scene, index) => String(index + 1)));

      for (const id of SECTIONS) {
        const section = page.locator(`section#${id}`);
        await expect(section).toHaveAttribute("tabindex", "-1");
        const headingId = await section.getAttribute("aria-labelledby");
        expect(headingId, `${id} has no accessible name`).toBeTruthy();
        await expect(page.locator(`#${headingId}`)).toHaveCount(1);
      }

      await expect(page.locator("main#main")).toHaveCount(1);
      await expect(page.locator("main section section")).toHaveCount(0);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("main h2")).toHaveCount(SECTIONS.length);
    });
  }

  test("keeps the English brand line as the single H1", async ({ page }) => {
    await page.goto("/");
    const h1 = page.locator("h1#lv2-hero-title");
    await expect(h1).toHaveCount(1);
    if (process.env.NEXT_PUBLIC_LANDING_EXPERIMENT !== "headline") {
      expect((await h1.innerText()).replace(/\s+/g, " ").trim()).toBe(HEADLINE);
    }
  });

  for (const path of ["/", "/ko"]) {
    test(`${path} has no duplicate ids or broken in-page targets`, async ({ page }) => {
      await page.goto(path);
      const result = await page.evaluate(() => {
        const seen = new Map<string, number>();
        for (const node of document.querySelectorAll<HTMLElement>("[id]")) {
          seen.set(node.id, (seen.get(node.id) ?? 0) + 1);
        }
        const duplicateIds = [...seen.entries()]
          .filter(([, count]) => count > 1)
          .map(([id]) => id);
        const missingTargets = [...document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')]
          .map(link => link.hash.slice(1))
          .filter(id => id && !document.getElementById(id));
        return { duplicateIds, missingTargets };
      });
      expect(result).toEqual({ duplicateIds: [], missingTargets: [] });
    });
  }
});

for (const path of ["/", "/ko"] as const) {
  test(`${path} selects workbench regions with native buttons, by pointer and keyboard, and moves the citation with them`, async ({ page }) => {
    await page.goto(path);
    const source = page.locator(HERO_SOURCE);
    const buttons = regionButtons(page);
    const hrefs = await regionHrefs(page);
    await expect(buttons).toHaveCount(hrefs.length);
    await expect(source.locator('button[aria-pressed="true"]')).toHaveCount(1);
    const pane = source.locator('[aria-live="polite"]');
    const paneId = await pane.getAttribute("id");
    expect(paneId).toBeTruthy();
    const evidence = source.locator("[data-hero-evidence]");
    const quote = source.locator("blockquote");

    for (let index = 0; index < hrefs.length; index += 1) {
      const button = buttons.nth(index);
      await expect(button).toHaveAttribute("type", "button");
      await expect(button).toHaveAttribute("aria-controls", paneId!);
      const before = await quote.innerText();
      // Pointer, Enter and Space in turn: a native button answers all three.
      const how = (["click", "Enter", "Space"] as const)[index % 3]!;
      if (how === "click") {
        await button.click();
      } else {
        await button.focus();
        await page.keyboard.press(how);
      }
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(source.locator('button[aria-pressed="true"]')).toHaveCount(1);
      await expect(evidence).toHaveAttribute("href", hrefs[index]!);
      const regionId = decodeURIComponent(hrefs[index]!.split("evidence=").pop()!);
      await expect(source.locator('[data-region-id][data-selected="1"]')).toHaveAttribute("data-region-id", regionId);
      const where = (await button.innerText()).match(/bbox [\d,]+/)?.[0] ?? "";
      expect(where, "each button names its region's place").not.toBe("");
      await expect(source.locator("p", { hasText: where }).first()).toBeVisible();
      if (index > 0) expect(await quote.innerText()).not.toBe(before);
    }
  });

  test(`${path} opens the selected region at its exact place in Explore`, async ({ page }) => {
    await page.goto(path);
    const evidence = page.locator(`${HERO_SOURCE} [data-hero-evidence]`);
    const href = await evidence.getAttribute("href");
    expect(href).toMatch(/^\/explore\?act=evidence&evidence=/);
    await evidence.click();
    await expect(page).toHaveURL(new RegExp(`evidence=${href!.split("evidence=").pop()!.split("%3A")[0]}`));
    await expect(page.locator("main")).toContainText("apple-2026-q1-10-q-reference.pdf");
  });

  test(`${path} points every difficulty at a region the workbench shows`, async ({ page }) => {
    await page.goto(path);
    const hrefs = await regionHrefs(page);
    const links = page.locator("#s2 ol a[href]");
    await expect(links).toHaveCount(hrefs.length);
    for (const href of await links.evaluateAll(nodes => nodes.map(node => node.getAttribute("href") ?? ""))) {
      expect(hrefs).toContain(href);
    }
    await expect(page.locator("#s2").getByText(
      path === "/ko"
        ? "아직 처리, 적격 판정, 권리 허가를 거치지 않았으므로 그 내용은 보여 주지 않습니다."
        : "It has not been processed, qualified or rights-cleared, so nothing from it is shown.",
      { exact: false },
    )).toBeVisible();
  });

  test(`${path} opens the received record at its region and its original page`, async ({ page }) => {
    await page.goto(path);
    const record = page.locator("#s3 article");
    await expect(record).toHaveCount(1);
    await expect(record.locator("blockquote")).toHaveAttribute("lang", "en");
    await expect(record.locator('[data-analytics="source-open"]')).toHaveAttribute("href", /^\/explore\?act=evidence&evidence=/);
    await expect(record.locator('a[href^="/explore-sample/"]')).toHaveAttribute("href", /\.pdf#page=\d+$/);
    await expect(record.locator("code")).toHaveText(/^sha256:[0-9a-f]{64}$/);
  });

  test(`${path} links the source change to the actual change record and its contract`, async ({ page }) => {
    await page.goto(path);
    const change = page.locator("#s4");
    await expect(change.locator("a.lv2-text-link")).toHaveCount(1);
    await expect(change.locator("a.lv2-text-link")).toHaveAttribute("href", "/explore?act=change");
    await expect(change.locator("a.lv2-inline-link")).toHaveAttribute("href", "/product/continuous-knowledge");
    await change.locator("a.lv2-text-link").click();
    await expect(page).toHaveURL(/\/explore\?act=change$/);
  });

  /*
    The hero's access action follows the server's commercial state. The Korean close prints that
    resolved action unmapped (`/ko/contact` while access is by inquiry), so the state is read there
    rather than assumed: by inquiry, the hero maps it to the localized document evaluation; live,
    the hero keeps the resolved action and offers no evaluation link.
  */
  test(`${path} maps the hero's access action from the commercial state to a locale-correct destination`, async ({ page }) => {
    await page.goto("/ko");
    const resolved = await page.locator('#s6 [data-scene-next="start"]').getAttribute("href");
    expect(resolved).toMatch(/^\/[a-z]/);

    await page.goto(path);
    const actions = page.locator("#s1 .lv2-actions");
    const hrefs = await actions.locator("a").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")));
    expect(hrefs).toHaveLength(2);
    expect(hrefs).toContain("/explore");
    const access = actions.locator('a:not([href="/explore"])');
    await expect(access).toHaveCount(1);
    if (path === "/ko") expect(await access.getAttribute("href"), "the Korean hero never sends a reader to the English inquiry").not.toBe("/contact");

    if (resolved === "/ko/contact") {
      const evaluation = EVALUATION[path];
      await expect(access).toHaveAttribute("href", evaluation.href);
      await expect(access).toHaveText(evaluation.label);
      expect((await page.request.get(evaluation.href)).status(), `${evaluation.href} is a real route`).toBe(200);
      await access.click();
      await expect(page).toHaveURL(new RegExp(`${evaluation.href.replace(/\//g, "\\/")}$`));
    } else {
      await expect(access).toHaveAttribute("href", resolved!);
      await expect(page.locator('main a[href$="/evaluation"]')).toHaveCount(0);
    }
  });
}

test.describe("HeroFilm", () => {
  test("stays closed and unrequested on load, then opens the four-cut player in scene 02", async ({ page }) => {
    const filmRequests: string[] = [];
    page.on("request", request => {
      if (new URL(request.url()).pathname.startsWith("/film/")) filmRequests.push(request.url());
    });
    await page.goto("/");
    const disclosure = page.locator(FILM_DISCLOSURE);
    await expect(disclosure).toHaveCount(1);
    await expect(disclosure).toHaveJSProperty("open", false);
    await expect(page.locator(".compile-film-sequence")).toHaveCount(0);
    await expect(page.locator("main video")).toHaveCount(0);
    await expect(page.locator('main img[src*="/film/"]')).toHaveCount(0);
    /*
      Film bytes can only come from the player (mounted by onToggle, after open) or from rendered
      media/preloads, and the listener above records every /film/ request from before navigation.
      So the invariant needs render readiness, not network idleness: the closed disclosure in view
      (where any lazy or observer-driven load would fire), the images of the scenes up to it settled,
      and the frames after the scroll painted. "networkidle" waits on unrelated traffic -- consent,
      CSP reports, prefetches, dev-server connections -- and never settles while any of it repeats.
      (Images further down may be lazily deferred and never complete here, so they are not waited on.)
    */
    await disclosure.scrollIntoViewIfNeeded();
    await expect(disclosure).toBeInViewport();
    await expect.poll(() => page.locator("#s1 img, #s2 img").evaluateAll(images =>
      images.every(image => (image as HTMLImageElement).complete),
    )).toBe(true);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(disclosure).toHaveJSProperty("open", false);
    await expect(page.locator(".compile-film-sequence")).toHaveCount(0);
    await expect(page.locator("main video")).toHaveCount(0);
    await expect(page.locator('main img[src*="/film/"]')).toHaveCount(0);
    expect(filmRequests, "a closed film requests no poster or video").toEqual([]);

    const film = await openFilm(page);
    await expect(film).toHaveCount(1);
    await expect(film.locator(".compile-film-viewport")).toBeVisible();
    await expect(film.getByRole("tab")).toHaveCount(4);
    await expect(film.getByRole("tab")).toHaveText(["Files", "Organize", "Updates", "Use with AI"]);
    await expect(film.getByRole("button", { name: /the compilation film$/ })).toHaveCount(1);
    await expect(film).toHaveAttribute("data-mobile-view", "fit");
    await expect.poll(() => filmRequests.length, { message: "the opened film paints its poster or video" })
      .toBeGreaterThan(0);
    await expect(page.getByText("Choose a film cut")).toHaveCount(0);
    /* The film follows the difficulty list in its own landmark; the retired specimen and inspector are gone. */
    await expect(page.locator("#s2 #lv2-difficulty-title")).toHaveCount(1);
    await expect(page.locator("[data-compiler-specimen]")).toHaveCount(0);
    await expect(page.locator(".lv2-hero-inspector")).toHaveCount(0);
    await expect(page.locator("#s1 .compile-film-sequence")).toHaveCount(0);
    await expect(page.locator("#s2 .lv2-film-note")).toHaveCount(0);
    await expect(page.locator("#s1 canvas")).toHaveCount(0);
    await expect(page.locator("#s2 .compile-film-sequence canvas")).toHaveCount(0);
    const edges = await page.locator("#s2 .lv2-film").evaluate(root => {
      const caption = root.querySelector(".compile-film-caption")!.getBoundingClientRect();
      const note = root.querySelector(":scope > .fine")!.getBoundingClientRect();
      return { caption: caption.left, note: note.left, width: caption.width - note.width };
    });
    expect(Math.abs(edges.caption - edges.note)).toBeLessThanOrEqual(1);
    expect(Math.abs(edges.width)).toBeLessThanOrEqual(1);
    expect(await page.locator("main").innerText()).not.toContain(
      ["A directed film", "not a screen recording."].join(", "),
    );
  });

  test("opens phones on the full frame and toggles Focus details and back", async ({ page }, testInfo) => {
    test.skip(!["390", "360"].includes(testInfo.project.name), "the mobile film tools");
    await page.goto("/");
    const film = await openFilm(page);
    const toggle = film.locator(".compile-film-focus-control");
    await expect(toggle).toHaveCount(1);
    await expect(film).toHaveAttribute("data-mobile-view", "fit");
    await expect(toggle).toHaveText("Focus details");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    const controls = await toggle.getAttribute("aria-controls");
    expect(controls, "the framing control names what it frames").toBeTruthy();
    await expect(page.locator(`[id="${controls}"]`)).toHaveCount(1);
    await toggle.click();
    await expect(film).toHaveAttribute("data-mobile-view", "focus");
    await expect(toggle).toHaveText("Fit full frame");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(film).toHaveAttribute("data-mobile-view", "fit");
    await expect(toggle).toHaveText("Focus details");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    // The same round trip from the keyboard.
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(film).toHaveAttribute("data-mobile-view", "focus");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Space");
    await expect(film).toHaveAttribute("data-mobile-view", "fit");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    // The workbench adds no framing control of its own; Fit/Focus is the film's alone.
    await expect(page.locator(`${HERO_SOURCE} .compile-film-focus-control`)).toHaveCount(0);
    await expect(page.locator(".compile-film-focus-control")).toHaveCount(1);
  });

  test("closes and reopens from the keyboard and keeps roving cut selection", async ({ page }) => {
    await page.goto("/");
    const disclosure = page.locator(FILM_DISCLOSURE);
    const summary = disclosure.locator("summary", { hasText: FILM_SUMMARY });
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(disclosure).toHaveJSProperty("open", true);
    await expect(page.locator(FILM)).toHaveCount(1);
    await expect(summary).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(disclosure).toHaveJSProperty("open", false);
    await expect(page.locator(".compile-film-sequence")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(disclosure).toHaveJSProperty("open", true);
    const tabs = page.locator(FILM).getByRole("tab");
    await expect(tabs).toHaveCount(4);
    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
  });

  test("reduced motion opens on a still with a Play control", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "reduced-motion", "the reduced-motion project");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const film = await openFilm(page);
    await expect(film.getByRole("button", { name: "Play the compilation film" })).toBeVisible();
    await expect(film.locator("video")).toHaveCount(0);
    await expect(film.locator("img.compile-film-still")).toHaveCount(1);
  });

  test("server-renders the hero source evidence and no closed-film poster", async ({ page }) => {
    const response = await page.request.get("/");
    expect(response.status()).toBe(200);
    const html = await response.text();
    const disclosure = html.match(/<details[^>]*data-testid="landing-film-disclosure"[^>]*>/)?.[0] ?? "";
    expect(disclosure, "the film disclosure is server-rendered").not.toBe("");
    expect(disclosure, "and closed").not.toMatch(/\sopen(?:=|\s|>)/);
    /* The RSC payload may serialize the poster prop; only rendered media and preloads must not name a film asset. */
    const mediaTags = (html.match(/<(?:img|video|source|link)\b[^>]*>/gi) ?? []).filter(
      (tag) => !/^<link\b/i.test(tag) || /\srel="preload"/i.test(tag),
    );
    for (const tag of mediaTags) {
      expect(tag, "the closed film renders no poster media or preload").not.toMatch(
        /\s(?:src|srcset|poster|href|imagesrcset)="[^"]*\/film\//i,
      );
    }
    expect(html).not.toContain('class="compile-film-still"');
    expect(html).not.toMatch(/<video/i);
    for (const prioritized of html.match(/<img[^>]*fetchpriority="high"[^>]*>/gi) ?? []) {
      expect(prioritized, "a film poster may not take the eager image slot").not.toContain("/film/");
    }

    const card = html.match(/<article[^>]*data-source-digest="[^"]+"[^>]*>[\s\S]*?<\/article>/)?.[0] ?? "";
    expect(card, "the hero server-renders its source card").not.toBe("");
    const sourceImage = card.match(/<img[^>]*>/)?.[0] ?? "";
    expect(sourceImage, "the source page raster is the hero's paint").not.toBe("");
    expect(sourceImage).toMatch(/ width="[1-9]\d*"/);
    expect(sourceImage).toMatch(/ height="[1-9]\d*"/);
    expect(sourceImage).toMatch(/fetchpriority="high"/i);
    expect(sourceImage).toMatch(/loading="eager"/i);
    expect(sourceImage).toMatch(/decoding="async"/i);
    /* One drawn box per region button, each placed inside the page; exactly one is the selected one. */
    const regions = [...card.matchAll(/<span[^>]*data-region-id="([^"]+)"[^>]*>/g)];
    const regionIds = regions.map(match => match[1]!);
    expect(regionIds.length, "every evidence region is drawn on the page").toBeGreaterThan(1);
    expect(regionIds.length).toBe((card.match(/<button[^>]*aria-pressed="(?:true|false)"/g) ?? []).length);
    expect(new Set(regionIds).size, "each drawn region is a distinct region").toBe(regionIds.length);
    for (const [tag] of regions) {
      const style = Object.fromEntries(
        (tag.match(/ style="([^"]*)"/)?.[1] ?? "").split(";").map(rule => rule.split(":").map(part => part.trim())),
      );
      const [left, top, width, height] = ["left", "top", "width", "height"].map(edge => {
        expect(style[edge], `${edge} of ${tag}`).toMatch(/^[\d.]+%$/);
        return Number.parseFloat(style[edge]!);
      });
      expect(width!).toBeGreaterThan(0);
      expect(height!).toBeGreaterThan(0);
      expect(left! + width!, "the region box stays on the page").toBeLessThanOrEqual(100.01);
      expect(top! + height!, "the region box stays on the page").toBeLessThanOrEqual(100.01);
    }
    const selected = regions.filter(([tag]) => / data-selected="1"/.test(tag)).map(match => match[1]!);
    expect(selected, "exactly one region is drawn as selected").toHaveLength(1);
    const link = card.match(/<a[^>]*data-hero-evidence[^>]*>/)?.[0] ?? "";
    expect(link, "the card links its exact evidence").toMatch(/ href="\/explore\?act=evidence&amp;evidence=[^"]+"/);
    expect(decodeURIComponent(link.match(/evidence=([^"&]+)"/)![1]!), "the evidence link opens the selected region").toBe(selected[0]);
    const filing = card.match(/<a[^>]*data-full-filing[^>]*>/)?.[0] ?? "";
    expect(filing, "the card server-renders its full filing link").toContain(` href="${SEC_FILING}"`);
    expect(card).toContain('data-run="not_run"');

    /* The source page holds the priority slot; the retired specimen crop is not rendered. */
    expect(html).not.toContain('data-source-image="region"');
    expect(html.match(/<img[^>]*fetchpriority="high"[^>]*>/gi) ?? []).toContain(sourceImage);

    await page.goto("/");
    const source = page.locator(HERO_SOURCE);
    const image = source.locator("img").first();
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
    /* Hydration keeps the server's regions, in order, with the same one selected. */
    const boxes = source.locator("[data-region-id]");
    expect(await boxes.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-region-id")))).toEqual(regionIds);
    await expect(source.locator('[data-region-id][data-selected="1"]')).toHaveAttribute("data-region-id", selected[0]!);
    const imageBox = await image.boundingBox();
    const evidenceBox = await source.locator("[data-hero-evidence]").boundingBox();
    for (const box of [imageBox, evidenceBox]) {
      expect(box, "the hero evidence is laid out").not.toBeNull();
      expect(box!.width).toBeGreaterThan(0);
      expect(box!.height).toBeGreaterThan(0);
    }
    for (let index = 0; index < regionIds.length; index += 1) {
      const box = await boxes.nth(index).boundingBox();
      expect(box, `region ${regionIds[index]} is laid out`).not.toBeNull();
      expect(box!.width).toBeGreaterThan(0);
      expect(box!.height).toBeGreaterThan(0);
      // Drawn on the page raster, not beside it.
      expect(box!.x).toBeGreaterThanOrEqual(imageBox!.x - 1);
      expect(box!.y).toBeGreaterThanOrEqual(imageBox!.y - 1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(imageBox!.x + imageBox!.width + 1);
      expect(box!.y + box!.height).toBeLessThanOrEqual(imageBox!.y + imageBox!.height + 1);
    }
  });

  test("selects the verified locked master on desktop", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "1440", "the desktop source-selection contract");
    await page.goto("/");
    const film = await openFilm(page);
    await film.scrollIntoViewIfNeeded();
    await expect(film).toHaveAttribute("data-video-primary-src", HERO_VIDEO);
  });

  test("keeps the verified locked master on phones", async ({ page }, testInfo) => {
    test.skip(!["390", "360"].includes(testInfo.project.name), "the required phone sources");
    await page.goto("/");
    const film = await openFilm(page);
    await film.scrollIntoViewIfNeeded();
    await expect(film).toHaveAttribute("data-video-primary-src", HERO_VIDEO);
  });
});

test.describe("source identity and commercial destinations", () => {
  for (const path of ["/", "/ko"] as const) {
    test(`${path} prints the source's identity and digest from the data, with the long hash behind Source details`, async ({ page }) => {
      await page.goto(path);
      const source = page.locator(HERO_SOURCE);
      const digest = await source.getAttribute("data-source-digest");
      expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      await expect(source.locator("[data-derived='1']", { hasText: "apple-2026-q1-10-q-reference.pdf" }).first()).toBeVisible();
      await expect(source.locator("code[data-derived='1']", { hasText: digest!.slice(0, 15) }).first()).toBeVisible();
      const details = source.locator("details");
      await expect(details).toHaveJSProperty("open", false);
      await expect(details.locator("code", { hasText: digest! })).toBeHidden();
      await details.locator("summary").click();
      await expect(details.locator("code", { hasText: digest! })).toBeVisible();
      // Every digit the card prints is inside an element that says it was read, not typed.
      const undeclared = await source.evaluate(root => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const found: string[] = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (/\d/.test(node.textContent ?? "") && !node.parentElement?.closest("[data-derived]")) found.push(node.textContent!.trim());
        }
        return found;
      });
      expect(undeclared).toEqual([]);
    });
  }

  test("Korean pricing carries the selected plan into the inquiry", async ({ page }) => {
    await page.goto("/ko/pricing");
    await page.getByRole("link", { name: "Developer 도입 상담" }).click();
    await expect(page).toHaveURL(/\/ko\/contact\?plan=Developer$/);
    await expect(page.locator("[data-plan-intent]")).toHaveText("Developer 요금제 문의");
    await expect(page.locator('input[name="plan"]')).toHaveValue("Developer");
  });

  test("the English close keeps its start action on an English destination", async ({ page }) => {
    await page.goto("/");
    const close = page.locator("#s6");
    const start = close.locator('[data-scene-next="start"]');
    await expect(start).toHaveCount(1);
    const href = await start.getAttribute("href");
    expect(href).toMatch(/^\/[a-z]/);
    expect(href, "the English close never sends a reader to the Korean pages").not.toMatch(/^\/ko(\/|$)/);
  });
});

test.describe("responsive and reduced-motion parity", () => {
  for (const path of ["/", "/ko"]) {
    test(`${path} has zero horizontal overflow`, async ({ page }, testInfo) => {
      test.skip(!REQUIRED_WIDTHS.has(testInfo.project.name), "the seven required width projects");
      await page.goto(path);
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 480) {
          window.scrollTo(0, y);
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        window.scrollTo(0, 0);
      });
      expect(await horizontalOverflow(page), `${path} overflows at ${testInfo.project.name}px`).toBeLessThanOrEqual(1);
    });
  }

  for (const path of ["/", "/ko"] as const) {
    test(`${path} keeps every workbench control on the phone touch floor`, async ({ page }, testInfo) => {
      test.skip(!["390", "360"].includes(testInfo.project.name), "the two required phone widths");
      await page.goto(path);
      // Region buttons, and every link outside the closed Source details (filing, region, page).
      const short = await page.locator(`${HERO_SOURCE} button, ${HERO_SOURCE} a[href]:not(details a)`).evaluateAll(nodes =>
        nodes.map(node => ({ text: node.textContent?.trim(), height: node.getBoundingClientRect().height }))
          .filter(item => item.height < 43.99),
      );
      expect(short).toEqual([]);
    });

    /*
      The phone's first screen holds the real page, not only its name. Readiness and evidence are
      kept apart: readiness is the raster's own decode() resolving and two frames painting (not
      `complete` or naturalWidth alone); evidence is a screenshot of the page window where it sits
      in the unscrolled first viewport, decoded by the browser itself, counting ink outside the
      drawn region boxes and their letters. A blank white raster under the boxes fails it.
    */
    test(`${path} shows the decoded source page in the phone's first viewport, ahead of the passage`, async ({ page }, testInfo) => {
      test.skip(!["390", "360"].includes(testInfo.project.name), "the two required phone widths");
      await page.goto(path);
      const source = page.locator(HERO_SOURCE);
      const image = source.locator("[data-page-window] img");
      await expect(image).toHaveCount(1);
      await image.evaluate((node: HTMLImageElement) => node.decode());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

      const at = await source.evaluate(root => {
        const frame = root.querySelector<HTMLElement>("[data-page-window]")!;
        const box = frame.getBoundingClientRect();
        const marks = [...frame.querySelectorAll("[data-region-id], [data-region-id] > *")].map(node => {
          const rect = node.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        });
        return {
          scrollY,
          name: root.querySelector("p[data-derived]")!.getBoundingClientRect().bottom,
          quote: root.querySelector("blockquote")!.getBoundingClientRect().top,
          // Inside the window's own rule, which is not page ink.
          inner: { x: box.x + frame.clientLeft, y: box.y + frame.clientTop, width: frame.clientWidth, height: frame.clientHeight },
          marks,
        };
      });
      const viewport = page.viewportSize()!;
      expect(at.scrollY).toBe(0);
      expect(at.inner.y, "the page follows the source's name").toBeGreaterThanOrEqual(at.name);
      expect(at.inner.y + at.inner.height, "and precedes the passage").toBeLessThanOrEqual(at.quote);
      const shown = Math.min(at.inner.height, viewport.height - at.inner.y);
      expect(shown, "the page window reaches well into the first viewport").toBeGreaterThanOrEqual(Math.min(at.inner.height, 120));

      const clip = { x: at.inner.x, y: at.inner.y, width: at.inner.width, height: shown };
      const png = (await page.screenshot({ clip })).toString("base64");
      const ink = await page.evaluate(async ({ png, clip, marks }) => {
        const bytes = Uint8Array.from(atob(png), char => char.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d")!;
        context.drawImage(bitmap, 0, 0);
        const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
        const scale = bitmap.width / clip.width;
        const pad = 4; // a box's 2px outline, its 1px offset, and antialiasing
        const covered = marks.map(mark => ({
          x0: (mark.x - clip.x - pad) * scale,
          y0: (mark.y - clip.y - pad) * scale,
          x1: (mark.x + mark.width - clip.x + pad) * scale,
          y1: (mark.y + mark.height - clip.y + pad) * scale,
        }));
        let sampled = 0;
        let nonwhite = 0;
        for (let y = 0; y < bitmap.height; y += 1) {
          for (let x = 0; x < bitmap.width; x += 1) {
            if (covered.some(c => x >= c.x0 && x < c.x1 && y >= c.y0 && y < c.y1)) continue;
            const i = (y * bitmap.width + x) * 4;
            sampled += 1;
            if (Math.min(data[i]!, data[i + 1]!, data[i + 2]!) < 235) nonwhite += 1;
          }
        }
        return { sampled, nonwhite };
      }, { png, clip, marks: at.marks });
      expect(ink.sampled, "page pixels outside the region boxes").toBeGreaterThan(0);
      expect(ink.nonwhite / ink.sampled, "document ink, not a blank sheet under the boxes").toBeGreaterThan(0.01);
    });

    test(`${path} keeps the passage, page, filing link and regions inside the workbench at every width`, async ({ page }, testInfo) => {
      test.skip(!REQUIRED_WIDTHS.has(testInfo.project.name), "the seven required width projects");
      await page.goto(path);
      const source = page.locator(HERO_SOURCE);
      const clipped = await source.evaluate(root => {
        const bench = root.getBoundingClientRect();
        const targets = root.querySelectorAll("blockquote, img, a[data-full-filing], a[data-hero-evidence], button[aria-pressed]");
        return [...targets].flatMap(node => {
          const box = node.getBoundingClientRect();
          return box.left < bench.left - 1 || box.right > bench.right + 1 ? [node.tagName + " " + (node.textContent ?? "").trim().slice(0, 40)] : [];
        });
      });
      expect(clipped).toEqual([]);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    });
  }

  test("reduced motion keeps every workbench region selectable at once", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "reduced-motion", "the reduced-motion project");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const buttons = regionButtons(page);
    const hrefs = await regionHrefs(page);
    await expect(buttons).toHaveCount(hrefs.length);
    await buttons.last().click();
    await expect(buttons.last()).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`${HERO_SOURCE} [data-hero-evidence]`)).toHaveAttribute("href", hrefs[hrefs.length - 1]!);
    await expect(page.locator(FILM_DISCLOSURE)).toHaveJSProperty("open", false);
    await expect(page.locator("main video")).toHaveCount(0);
  });
});
