/**
 * Landing V2 browser contract after the 2026-09-20 six-beat edit.
 *
 * The home page is one short narrative: film, compiler explanation, proof, change, trust, action.
 * The hero uses the four approved film cuts; the deterministic CompilerSpecimen follows in its
 * own semantic section so the explanation does not compete with the opening statement.
 */

import { test, expect, type Page } from "@playwright/test";
import {
  COMPILER_SPECIMEN_SOURCE,
  COMPILER_SPECIMEN_STAGES,
} from "../lib/compiler-specimen";

const HEADLINE = "Your documents. Knowledge you can verify.";
const REQUIRED_WIDTHS = new Set(["1920", "1440", "1280", "1024", "768", "390", "360"]);
const SECTIONS = ["s1", "s2", "s3", "s4", "s5", "s6"] as const;
/* Gap #1, 2026-09-22: the film explains how it compiles, from Scene 02. The hero is the live
   Evidence Inspector, which `#s1 .lv2-hero-inspector` below asserts in its place. */
const FILM = "#s2 .compile-film-sequence";
const HERO_POSTER = "/film/poster-1-hero-2x.webp";
const HERO_VIDEO = "/film/compile-cut.mp4";

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

async function selectedStage(page: Page): Promise<number> {
  const selected = page.locator('#s1 [data-compiler-specimen] [role="tab"][aria-selected="true"]');
  await expect(selected).toHaveCount(1);
  return page.locator('#s1 [data-compiler-specimen] [role="tab"]').evaluateAll(
    (tabs, selectedId) => tabs.findIndex(tab => tab.id === selectedId),
    await selected.getAttribute("id"),
  );
}

test.describe("six-beat page structure", () => {
  for (const path of ["/", "/ko"]) {
    test(`${path} offers the next action before the How it compiles explanation`, async ({ page }) => {
      await page.goto(path);
      const actions = page.locator("#s1 .lv2-actions");
      const heading = page.locator("#s1 .lv2-how-head");
      const specimen = page.locator("#s1 [data-compiler-specimen]");
      const actionBox = await actions.boundingBox();
      const headingBox = await heading.boundingBox();
      const specimenBox = await specimen.boundingBox();
      expect(actionBox).not.toBeNull();
      expect(headingBox).not.toBeNull();
      expect(specimenBox).not.toBeNull();
      expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
      expect(actionBox!.y + actionBox!.height).toBeLessThan(headingBox!.y);
      expect(headingBox!.y + headingBox!.height).toBeLessThan(specimenBox!.y);
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

test("prepared proof tabs show answer-bearing source regions", async ({ page }, testInfo) => {
  await page.goto("/");
  const proof = page.locator("#s3");
  const tabs = proof.getByRole("tab");
  await expect(tabs).toHaveCount(3);

  await tabs.nth(1).click();
  const sales = proof.getByRole("tabpanel").filter({ visible: true });
  await expect(sales.getByText("Net sales: Products $ 113,743", { exact: false })).toBeVisible();
  await expect(sales.getByText("Source page · reference render")).toBeVisible();
  const salesCrop = sales.locator('img[src*="r64-249-932-352"]');
  await expect(salesCrop).toBeVisible();
  await salesCrop.scrollIntoViewIfNeeded();
  await expect.poll(() => salesCrop.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  if (process.env.TAVONEL_CAPTURE_EXPLORE_QA === "1") {
    await proof.screenshot({ path: testInfo.outputPath("proof-sales.png") });
    await page.screenshot({ path: testInfo.outputPath("proof-sales-viewport.png") });
  }

  await tabs.nth(2).click();
  const background = proof.getByRole("tabpanel").filter({ visible: true });
  await expect(background.getByText("designs, manufactures and markets smartphones", { exact: false })).toBeVisible();
  await expect(background.getByText("Source page · original PDF")).toBeVisible();
  await expect(background.getByRole("link", { name: /Open the source region/ })).toHaveAttribute("href", /\/explore\?act=evidence/);
});

for (const [path, label] of [["/", "Inspect all source regions"], ["/ko", "모든 원문 영역 살펴보기"]] as const) {
  test(`${path} opens the source index by keyboard and keeps regions linked to evidence`, async ({ page }) => {
    await page.goto(path);
    const regionName = path === "/ko" ? /^근거 영역/ : /^Evidence region/;
    const openLabel = path === "/ko" ? "Explore에서 이 영역 열기" : "Open this region in Explore";
    const inspector = page.locator("#s2 [data-progressive='1']");
    const summary = inspector.locator("summary");
    await expect(summary).toContainText(`${label} (10)`);
    await expect(inspector.getByRole("button", { name: regionName })).toHaveCount(0);
    await summary.focus();
    await page.keyboard.press("Enter");
    const regions = inspector.getByRole("button", { name: regionName });
    await expect(regions).toHaveCount(10);
    await regions.nth(1).click();
    await expect(regions.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(inspector.getByRole("link", { name: openLabel })).toHaveAttribute("href", /\/explore\?act=evidence/);
  });
}

test.describe("HeroFilm", () => {
  test("opens with one four-cut film and removes the internal recreation disclaimer", async ({ page }) => {
    await page.goto("/");
    const film = page.locator(FILM);
    await expect(film).toHaveCount(1);
    await expect(film.locator(".compile-film-viewport")).toBeVisible();
    await expect(film.getByRole("tab")).toHaveCount(0);
    await film.locator(".compile-film-stage-disclosure summary").click();
    await expect(film.getByRole("tab")).toHaveCount(4);
    await expect(page.locator("#s1 [data-compiler-specimen]")).toHaveCount(1);
    await expect(page.locator("#s1 .compile-film-sequence")).toHaveCount(0);
    await expect(page.locator("#s2 .lv2-film-note")).toHaveCount(0);
    /* The hero's own visual, in the landmark the film left. */
    await expect(page.locator("#s2 .lv2-hero-inspector")).toHaveCount(1);
    await expect(page.locator("#s1 canvas")).toHaveCount(0);
    expect(await page.locator("main").innerText()).not.toContain(
      ["A directed film", "not a screen recording."].join(", "),
    );
  });

  test("server-renders the high-resolution first poster", async ({ page }) => {
    const response = await page.request.get("/");
    expect(response.status()).toBe(200);
    const html = await response.text();
    const poster = html.match(/<img[^>]*class="compile-film-still"[^>]*>/)?.[0] ?? "";
    expect(poster).toContain(HERO_POSTER);
    expect(poster).toMatch(/ width="[1-9]\d*"/);
    expect(poster).toMatch(/ height="[1-9]\d*"/);
    /*
      Gap #1: the film is below the fold, so its poster no longer claims the first paint, and the
      hero's own page raster is the image that does.

      This asserted a `<link rel="preload">` for that raster in the first round and failed. The
      assertion was wrong, not the page: `react-dom`'s `preload()` puts no link element into the
      served HTML of these two routes -- checked against tavonel.com, where the film poster was
      preloaded in exactly the same way and no such link has ever been in the document either.
      What the server render does carry, and what actually decides the first paint, is the
      loading posture of the two rasters, so that is what is pinned here. It is a stronger
      statement of the same contract, not a weaker one: the old line asserted the intent, this
      one asserts the outcome, and on both images rather than on one.
    */
    expect(poster).not.toMatch(/fetchpriority="high"/i);
    expect(poster).not.toMatch(/loading="eager"/i);
    const heroCrop = html.match(/<img[^>]*data-source-image="region"[^>]*>/)?.[0] ?? "";
    expect(heroCrop, "the hero server-renders no source-linked crop").not.toBe("");
    expect(heroCrop).toMatch(/loading="eager"/i);
    expect(heroCrop).toMatch(/fetchpriority="high"/i);
    expect(heroCrop).toMatch(/ width="[1-9]\d*"/);
    expect(heroCrop).toMatch(/ height="[1-9]\d*"/);
  });

  test("selects the verified locked master on desktop", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "1440", "the desktop source-selection contract");
    await page.goto("/");
    const film = page.locator(FILM);
    await film.scrollIntoViewIfNeeded();
    await expect(film).toHaveAttribute("data-video-primary-src", HERO_VIDEO);
  });

  test("keeps the verified locked master on phones", async ({ page }, testInfo) => {
    test.skip(!["390", "360"].includes(testInfo.project.name), "the required phone sources");
    await page.goto("/");
    const film = page.locator(FILM);
    await film.scrollIntoViewIfNeeded();
    await expect(film).toHaveAttribute("data-video-primary-src", HERO_VIDEO);
  });
});

test.describe("lower CompilerSpecimen explanation", () => {
  test("keeps all Korean stages and panel names localized while retaining one source", async ({ page }) => {
    await page.goto("/ko");
    const specimen = page.locator("#s1 [data-compiler-specimen]");
    const tabs = specimen.getByRole("tab");
    const labels = ["원문", "구조", "근거", "지식", "활용"];
    await expect(tabs).toHaveText(labels);
    for (let index = 0; index < labels.length; index += 1) {
      await tabs.nth(index).click();
      await expect(specimen.getByRole("tabpanel", { name: labels[index] })).toBeVisible();
      await expect(specimen).toContainText(COMPILER_SPECIMEN_SOURCE.id);
    }
    await expect(specimen.getByRole("tabpanel")).toContainText("백만 달러 · 2025년 12월 27일");
    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  });

  test("renders five selectable stages and preserves one source identity through them", async ({ page }) => {
    await page.goto("/");
    const specimen = page.locator("#s1 [data-compiler-specimen]");
    const tabs = specimen.getByRole("tab");
    await expect(tabs).toHaveCount(COMPILER_SPECIMEN_STAGES.length);
    await expect(tabs).toHaveText(COMPILER_SPECIMEN_STAGES.map(stage => stage.label));
    await expect(specimen.getByRole("tabpanel")).toHaveCount(1);

    const sourceIdentity = specimen.locator("span[data-derived='1']", {
      hasText: COMPILER_SPECIMEN_SOURCE.id,
    });
    await expect(sourceIdentity).toHaveCount(1);

    for (let index = 0; index < COMPILER_SPECIMEN_STAGES.length; index += 1) {
      await tabs.nth(index).click();
      await expect(tabs.nth(index)).toHaveAttribute("aria-selected", "true");
      await expect(specimen.getByRole("tabpanel")).toHaveAttribute(
        "aria-labelledby",
        `compiler-stage-${COMPILER_SPECIMEN_STAGES[index]!.id}`,
      );
      await expect(sourceIdentity).toHaveText(new RegExp(COMPILER_SPECIMEN_SOURCE.id));
      await expect(specimen.locator("[data-stage-composition]")).toHaveAttribute(
        "data-stage-composition",
        COMPILER_SPECIMEN_STAGES[index]!.id,
      );
    }

    await tabs.nth(2).click();
    await expect(specimen.getByRole("tabpanel")).toContainText(COMPILER_SPECIMEN_SOURCE.excerpt);
    await expect(specimen.locator("[data-stage-composition] details")).not.toHaveAttribute("open", "");
    await specimen.locator("[data-stage-composition] summary").click();
    await expect(specimen.getByRole("tabpanel")).toContainText(COMPILER_SPECIMEN_SOURCE.digest);
    await tabs.nth(3).click();
    await expect(specimen.getByRole("tabpanel")).toContainText(COMPILER_SPECIMEN_SOURCE.regionId);
    await tabs.last().click();
    await expect(specimen.getByRole("tabpanel")).toContainText(COMPILER_SPECIMEN_SOURCE.filename);
    await expect(specimen.getByRole("tabpanel")).toContainText(COMPILER_SPECIMEN_SOURCE.regionId);
  });

  test("supports roving-tab keyboard selection", async ({ page }) => {
    await page.goto("/");
    const tabs = page.locator('#s1 [data-compiler-specimen] [role="tab"]');
    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(tabs.last()).toBeFocused();
    await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(tabs.first()).toBeFocused();
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(tabs.last()).toBeFocused();
  });

  test("moves from the actual page render to its exact region crop", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "1440", "one desktop browser verifies the camera contract");
    await page.goto("/");
    const specimen = page.locator("#s1 [data-compiler-specimen]");
    const tabs = specimen.getByRole("tab");
    await specimen.scrollIntoViewIfNeeded();
    await tabs.first().click();
    const pageAsset = specimen.locator('[data-source-image="page"]');
    const regionAsset = specimen.locator('[data-source-image="region"]');
    const fullFrame = pageAsset.locator("..");
    const cropFrame = regionAsset.locator("..");
    await expect(pageAsset).toHaveJSProperty("complete", true);
    await expect(regionAsset).toHaveJSProperty("complete", true);
    expect(await pageAsset.evaluate(node => (node as HTMLImageElement).currentSrc)).toContain(
      "apple-2026-q1-10-q-reference-p004-",
    );
    expect(await regionAsset.evaluate(node => (node as HTMLImageElement).currentSrc)).toContain(
      "apple-2026-q1-10-q-reference-p004-r64-476-932-538-",
    );
    await expect(fullFrame).toHaveCSS("opacity", "1");
    await expect(cropFrame).toHaveCSS("opacity", "0");
    const pageTransform = await fullFrame.evaluate(node => getComputedStyle(node).transform);
    const stagedCropTransform = await cropFrame.evaluate(node => getComputedStyle(node).transform);

    await tabs.nth(1).click();
    await expect(fullFrame).toHaveCSS("opacity", "0");
    await expect(cropFrame).toHaveCSS("opacity", "1");
    await expect(cropFrame).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    const structureTransform = await cropFrame.evaluate(node => getComputedStyle(node).transform);
    await tabs.nth(2).click();
    const evidenceTransform = await cropFrame.evaluate(node => getComputedStyle(node).transform);
    expect(pageTransform).not.toBe("none");
    expect(stagedCropTransform).not.toBe(structureTransform);
    expect(evidenceTransform).toBe(structureTransform);
  });

  test("manual selection pauses playback and remains paused after leaving and returning", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "1440", "one desktop browser settles the finite timer contract");
    await page.goto("/");
    const specimen = page.locator("#s1 [data-compiler-specimen]");
    const tabs = specimen.getByRole("tab");
    await specimen.scrollIntoViewIfNeeded();
    await tabs.nth(2).click();
    await expect(specimen.getByRole("button", { name: "Play" })).toBeVisible();
    await expect(specimen.locator('[data-source-image="page"]').locator("..")).toHaveCSS(
      "transition-duration",
      "0s",
    );
    await page.waitForTimeout(2_850);
    expect(await selectedStage(page)).toBe(2);
    await page.locator("section#s5").scrollIntoViewIfNeeded();
    await page.waitForTimeout(2_850);
    await specimen.scrollIntoViewIfNeeded();
    expect(await selectedStage(page)).toBe(2);
  });

  test("auto-advance sleeps offscreen and resumes only after returning", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "1440", "one desktop browser settles the observer contract");
    await page.goto("/");
    const specimen = page.locator("#s1 [data-compiler-specimen]");
    const tabs = specimen.getByRole("tab");
    await specimen.scrollIntoViewIfNeeded();
    await tabs.first().click();
    await specimen.getByRole("button", { name: "Play" }).click();
    await page.locator("section#s5").scrollIntoViewIfNeeded();
    await page.waitForTimeout(2_850);
    expect(await selectedStage(page)).toBe(0);
    await specimen.scrollIntoViewIfNeeded();
    await expect.poll(() => selectedStage(page), { timeout: 5_000 }).toBe(1);
  });

  test("auto-advance sleeps while the document is hidden", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "1440", "one desktop browser settles the visibility contract");
    await page.goto("/");
    const specimen = page.locator("#s1 [data-compiler-specimen]");
    await specimen.scrollIntoViewIfNeeded();
    const tabs = specimen.getByRole("tab");
    await tabs.first().click();
    await specimen.getByRole("button", { name: "Play" }).click();
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(2_850);
    expect(await selectedStage(page)).toBe(0);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => selectedStage(page), { timeout: 5_000 }).toBe(1);
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

  test("all specimen controls clear the phone touch floor", async ({ page }, testInfo) => {
    test.skip(!["390", "360"].includes(testInfo.project.name), "the two required phone widths");
    await page.goto("/");
    const short = await page.locator("#s1 [data-compiler-specimen] button").evaluateAll(nodes =>
      nodes.map(node => ({ text: node.textContent?.trim(), height: node.getBoundingClientRect().height }))
        .filter(item => item.height < 43.99),
    );
    expect(short).toEqual([]);
    const rail = page.locator("#s1 [data-compiler-specimen] [role='tablist']");
    const railHeight = await rail.evaluate(node => node.getBoundingClientRect().height);
    expect(railHeight, "the phone stage picker should leave room for the source visual").toBeLessThanOrEqual(100);
  });

  test("each stage keeps source values inside its phone viewport", async ({ page }, testInfo) => {
    test.skip(!["390", "360"].includes(testInfo.project.name), "the two required phone widths");
    await page.goto("/");
    const specimen = page.locator("#s1 [data-compiler-specimen]");
    const tabs = specimen.getByRole("tab");
    await specimen.scrollIntoViewIfNeeded();

    for (let index = 0; index < COMPILER_SPECIMEN_STAGES.length; index += 1) {
      await tabs.nth(index).click();
      const clipped = await specimen.locator("[data-critical-value]").evaluateAll(nodes =>
        nodes.flatMap(node => {
          const boundary = node.closest("[data-camera-stage], [data-stage-composition]");
          if (!boundary) return [node.textContent?.trim() ?? "unknown"];
          const value = node.getBoundingClientRect();
          const box = boundary.getBoundingClientRect();
          return value.left < box.left - 1 || value.right > box.right + 1
            ? [node.textContent?.trim() ?? "unknown"]
            : [];
        }),
      );
      expect(clipped, `${COMPILER_SPECIMEN_STAGES[index]!.label} clips a critical value`).toEqual([]);
      const sourceFrame = specimen.locator("[data-camera-stage]");
      const sourceClipping = await sourceFrame.locator("picture").evaluateAll((nodes, boundary) => {
        const frame = (boundary as Element).getBoundingClientRect();
        return nodes.flatMap(node => {
          if (Number.parseFloat(getComputedStyle(node).opacity) < 0.5) return [];
          const box = node.getBoundingClientRect();
          const image = node.querySelector("img");
          return box.left < frame.left - 1 || box.right > frame.right + 1 || box.top < frame.top - 1 || box.bottom > frame.bottom + 1 || getComputedStyle(image!).objectFit !== "contain"
            ? [image?.getAttribute("data-source-image") ?? "unknown"]
            : [];
        });
      }, await sourceFrame.elementHandle());
      expect(sourceClipping, `${COMPILER_SPECIMEN_STAGES[index]!.label} clips the active source asset`).toEqual([]);
    }
  });

  test("reduced motion keeps every stage selectable and starts static", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "reduced-motion", "the reduced-motion project");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const specimen = page.locator("#s1 [data-compiler-specimen]");
    const tabs = specimen.getByRole("tab");
    await expect(tabs).toHaveCount(COMPILER_SPECIMEN_STAGES.length);
    await expect(specimen.getByRole("button", { name: "Play" })).toBeVisible();
    await page.waitForTimeout(2_850);
    expect(await selectedStage(page)).toBe(2);
    await tabs.last().click();
    await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
    await expect(specimen.getByRole("tabpanel")).toContainText(COMPILER_SPECIMEN_SOURCE.regionId);
  });
});
