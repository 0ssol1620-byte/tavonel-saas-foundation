/**
 * Landing V2, measured in a browser (blueprint 2026-09-19; contract D9, D11, D13).
 *
 * The unit tests know what the page is made of: `lib/landing-v2-copy.test.ts` knows no sentence
 * in the copy deck contains a digit, `lib/landing-v2-hero.test.ts` knows the hero resolves to a
 * real region of a real filing, `lib/brand-copy.test.ts` knows the composition renders the nine
 * scenes in §9's order. None of them can see a rendered page, and every claim below is one only
 * a rendered page can settle: that the nine scenes are landmarks a reader can reach, that the H1
 * is the brand line and sets in at most 2.2 lines, that the hero paints a real raster and no
 * video, that the demo has exactly one control and that it is 44px, that no digit reaches the
 * page except through an element that declares it was measured, and that nothing overflows.
 *
 * Widths: the project name is the viewport, so each block skips at the others. 1440 is the grid
 * §32 is drawn against, 390 is the phone the founder checks, and `reduced-motion` is the release
 * gate §26 sets.
 */

import { test, expect, type Page } from "@playwright/test";
import { activationPolicy } from "../lib/activation-policy";
import { ACCESS_CTA, EXPLORE_CTA, KO_CHROME, SELF_SERVE_CTA } from "../lib/site-navigation";

/*
  Posture-agnostic, because CI's Product QA runs every spec under COMMERCIAL_MODE=live (contract
  section 4): the commercial action is "Start with your files" -> /login there and "Request
  access" -> /contact here. Asserting either literal would pass in one job and fail in the other,
  so what is asserted is membership in the pair -- and the Korean labels are `KO_CHROME.cta`'s.
*/
const ACCESS_HREFS: string[] = [ACCESS_CTA.href, SELF_SERVE_CTA.href];
const ACCESS_LABELS: string[] = [ACCESS_CTA.label, SELF_SERVE_CTA.label, ...Object.values(KO_CHROME.cta)];

/** §9's nine scenes, in order, with the `data-scene` index each one carries. */
const SCENES = ["hero", "proof", "sources", "evidence", "recompile", "why", "use", "trust", "start"] as const;

/** D5: the H1 is this string and no other, rendered from `BRAND_LINE.headline`. */
const HEADLINE = "AI-ready knowledge. Traceable to every source.";

const DEMO = ".lv2-demo";

/**
 * Wait until D11's entry animation has finished moving the hero demo's blocks.
 *
 * "The source arrives, rises 12px" is a transform on two grid children, and a transformed grid
 * child CAN overlap the row below it while it is still travelling: round 4 sampled
 * `matrix(1,0,0,1,0,3.09)` at t~200ms, and the same two boxes touch exactly (bottom 307, top 307)
 * from t=400ms to the end of the 14s loop. Measuring geometry immediately after `goto` therefore
 * measures the animation, not the layout. This waits for the thing under test to exist rather
 * than sleeping a guessed number of milliseconds.
 */
async function settledHero(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("#hero .lv2-demo-stage > *")].every((node) => {
        const transform = getComputedStyle(node).transform;
        return transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)";
      }),
    undefined,
    { timeout: 5_000 },
  );
}

/**
 * Text nodes inside `main`, each with the nearest ancestor that declares it was measured.
 *
 * `<script>` and `<style>` text is skipped, and that is not a loophole: it is never rendered, so
 * no reader ever meets a figure in it. The walk tripped on `/ko` at all five widths because that
 * page renders `BreadcrumbJsonLd` inside `LandingPage`, and a BreadcrumbList's `"position": 1`
 * is a digit inside `<script type="application/ld+json">`. Contract rule 4 is about what a
 * reader sees; structured data has its own guard in `lib/structured-data.test.ts`.
 */
async function undeclaredFigures(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) return ["no main landmark"];
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    const offenders: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      if (!/\d/.test(text.trim())) continue;
      const element = node.parentElement;
      if (element?.closest("script, style")) continue;
      if (element?.closest("[data-derived]")) continue;
      offenders.push(text.trim().slice(0, 80));
    }
    return offenders;
  });
}

/** Whether anything inside the document is wider than the viewport. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/*
  The nine scenes, and the one thing each of them owes a reader, at every width the suite runs.

  Not width-scoped, because the structure is not: a scene that stops being a named landmark on a
  phone is the same defect it is on a desktop, and the seven width projects are what make that
  cheap to check.
*/
test.describe("structure", () => {
  for (const path of ["/", "/ko"]) {
    test(`${path} renders the nine scenes in order, each a named landmark`, async ({ page }) => {
      await page.goto(path);
      const sections = page.locator("main > section[data-scene]");
      await expect(sections).toHaveCount(SCENES.length);
      expect(await sections.evaluateAll((nodes) => nodes.map((node) => node.id))).toEqual([...SCENES]);
      expect(await sections.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-scene")))).toEqual(
        SCENES.map((_scene, index) => String(index + 1)),
      );
      // Focusable, and named by a heading that exists. Both halves, because a `tabIndex` with a
      // dangling `aria-labelledby` is a landmark a screen reader cannot announce.
      for (const [index, id] of SCENES.entries()) {
        const section = page.locator(`section#${id}`);
        await expect(section).toHaveAttribute("tabindex", "-1");
        const labelledBy = await section.getAttribute("aria-labelledby");
        expect(labelledBy, `${id} names its heading`).toBe(`lv2-${id}-title`);
        await expect(page.locator(`#${labelledBy}`)).toHaveCount(1);
        // One next action per scene (§39). The hero's row is the two CTAs; the rest is one link.
        const actions = section.locator("a[href]");
        expect(await actions.count(), `${id} (scene ${index + 1}) offers nothing to do next`).toBeGreaterThan(0);
      }
      // The skip target is unchanged, and the scenes are inside it.
      await expect(page.locator("main#main")).toHaveCount(1);
    });
  }

  /** The rendered height of the H1 over its own computed line height. */
  async function headlineLines(page: Page): Promise<number> {
    return page.locator("h1#lv2-hero-title").evaluate((node) => {
      const style = getComputedStyle(node);
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
      return node.getBoundingClientRect().height / lineHeight;
    });
  }

  test("the H1 is the brand line, set as one heading within its line cap", async ({ page }, testInfo) => {
    await page.goto("/");
    const h1 = page.locator("h1#lv2-hero-title");
    await expect(h1).toHaveCount(1);
    expect((await h1.innerText()).replace(/\s+/g, " ").trim()).toBe(HEADLINE);
    /*
      §6's cap, measured rather than asserted. The headline sets as two blocks, one sentence each,
      so a third line means one of them wrapped.

      The phone gets three rather than 2.2, and that is the recomposition's decision rather than a
      relaxation: below 768 the measure is the viewport, and holding "Traceable to every source."
      on one line inside 320px would need about 31px -- a headline smaller than the section
      headings under it, which is the inversion this round exists to have fixed. The size wins and
      the longer sentence wraps once.
    */
    const phone = Number(testInfo.project.name) <= 767;
    const cap = phone ? 3.2 : 2.2;
    expect(await headlineLines(page), `the hero headline is capped at ${cap} lines`).toBeLessThanOrEqual(cap);
    // D3: the editorial serif carries one phrase of it, and only on the English page.
    await expect(h1.locator("em.lv2-serif")).toHaveCount(1);
    await page.goto("/ko");
    await expect(page.locator("h1#lv2-hero-title em")).toHaveCount(0);
  });

  /*
    §2.5 / §39: the hierarchy, measured at the top of the page in both languages.

    This is the defect round 3 escalated as a P0 -- a 45px H1 over a 54px H2 -- and a number in a
    stylesheet is not what stops it coming back. Both sizes are read off the rendered document, so
    a future change to either token fails here rather than in a screenshot review.
  */
  for (const path of ["/", "/ko"]) {
    test(`${path} sets the H1 larger than every section heading`, async ({ page }) => {
      await page.goto(path);
      const h1 = await page
        .locator("h1#lv2-hero-title")
        .evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
      const h2s = await page
        .locator("main h2")
        .evaluateAll((nodes) => nodes.map((node) => parseFloat(getComputedStyle(node).fontSize)));
      expect(h2s.length).toBeGreaterThan(0);
      expect(h1, `H1 ${h1}px against the largest H2 ${Math.max(...h2s)}px`).toBeGreaterThan(Math.max(...h2s));
    });
  }

  /*
    §6's cap on the OTHER page, which until this round nothing measured.

    The suite read the line count on "/" only, so the Korean headline -- a literal translation
    (D12) of the same sentence, in a script whose syllables are close to a full em each -- set in
    four lines at 1440 and at 360 without failing anything. It is capped here at its own gate
    rather than at the English one: 2.2 lines from the tablet width up, where `app/landing-v2.css`
    sizes it against §32's 510px measure, and three lines on a phone, where fitting both sentences
    on one line each inside a 320px measure would need about 24px. Two lines on a phone needs
    shorter Korean copy and that is D5's founder call; this bound is what stops it drifting back
    to four while that decision is open.
  */
  test("/ko caps its own headline, measured on the page that renders it", async ({ page }, testInfo) => {
    await page.goto("/ko");
    const phone = Number(testInfo.project.name) <= 767;
    const cap = phone ? 3.2 : 2.2;
    expect(await headlineLines(page), `the Korean headline is capped at ${cap} lines`).toBeLessThanOrEqual(cap);
  });

  test("the hero offers one filled Explore action and the access action as a text link", async ({ page }) => {
    await page.goto("/");
    const actions = page.locator('section#hero [data-scene-actions="1"]');
    await expect(actions).toHaveCount(1);
    const filled = actions.locator("a.btn");
    await expect(filled).toHaveCount(1);
    await expect(filled).toHaveAttribute("href", "/explore");
    // The second action is a link, not a second button, and it goes to an access destination.
    const secondary = actions.locator("a:not(.btn)");
    await expect(secondary).toHaveCount(1);
    expect(["/contact", "/login", "/workspace"]).toContain(await secondary.getAttribute("href"));
    /*
      §29: one filled control in the hero's action row, measured from paint rather than from a
      class. Scoped to the text column deliberately -- the demo beside it paints the compiled
      claim and the objects it connects to on their own panels, and those are surfaces, not
      calls to action.
    */
    const painted = await page.locator("section#hero .lv2-hero-text a").evaluateAll((nodes) =>
      nodes.filter((node) => {
        const background = getComputedStyle(node).backgroundColor;
        return background !== "transparent" && !/rgba\(0, 0, 0, 0\)/.test(background);
      }).length,
    );
    expect(painted, "one filled control in the hero").toBe(1);
  });

  test("the hero paints real source rasters and no video anywhere on the page", async ({ page }) => {
    await page.goto("/");
    /*
      Two rasters and one preload, which is the recomposition's shape.

      The READ strip is the region crop, first and largest, and it is the LCP candidate and the
      only image carrying `fetchPriority="high"`. The page thumbnail beside it is where that strip
      sits on the filing. Both are committed derivatives, both declare their size so the page
      cannot shift when they decode, and both name what they are.
    */
    const strip = page.locator("section#hero img.lv2-read-img--a");
    const thumbnail = page.locator("section#hero img.lv2-page-img");
    await expect(strip).toHaveCount(1);
    await expect(thumbnail).toHaveCount(1);
    for (const image of [strip, thumbnail]) {
      expect(await image.getAttribute("src")).toMatch(/^\/landing\/v2\/.+\.webp$/);
      expect(await image.getAttribute("srcset")).toContain("w");
      expect(Number(await image.getAttribute("width"))).toBeGreaterThan(0);
      expect(Number(await image.getAttribute("height"))).toBeGreaterThan(0);
      expect((await image.getAttribute("alt"))?.trim().length, "the image says what it is").toBeGreaterThan(0);
      expect(await image.evaluate((node: HTMLImageElement) => node.naturalWidth), "the raster decoded")
        .toBeGreaterThan(0);
    }
    // The strip's alt names the filing it was cut from, without stating a figure (rule 4).
    expect((await strip.getAttribute("alt")) ?? "").toMatch(/filing/i);
    expect((await strip.getAttribute("alt")) ?? "").not.toMatch(/\d/);
    // §27: no autoplay video is the LCP element, because there is no video at all.
    await expect(page.locator("video")).toHaveCount(0);
    await expect(page.locator("canvas")).toHaveCount(0);
    // Exactly one image is told to load first, and it is the one the preload names.
    const prioritised = await page
      .locator("section#hero img")
      .evaluateAll((nodes) => nodes.filter((node) => node.getAttribute("fetchpriority") === "high").length);
    expect(prioritised, "one image carries fetchPriority=high").toBe(1);
    const preloaded = await page
      .locator('link[rel="preload"][as="image"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("imagesrcset")));
    expect(preloaded, "the READ strip is preloaded by its own srcset").toContain(await strip.getAttribute("srcset"));
  });

  test("the demo has exactly one control, and it meets the touch floor", async ({ page }) => {
    await page.goto("/");
    const controls = page.locator(`${DEMO} button`);
    await expect(controls).toHaveCount(1);
    const box = await controls.boundingBox();
    expect(box?.height ?? 0, "44px touch floor").toBeGreaterThanOrEqual(44);
    // It says which state it is in, in words, and reports that state to assistive technology.
    await expect(controls).toHaveAttribute("aria-pressed", /true|false/);
    expect((await controls.innerText()).trim().length, "the control is labelled in words").toBeGreaterThan(0);
  });

  for (const path of ["/", "/ko"]) {
    test(`${path} prints no figure outside an element that declares it was measured`, async ({ page }) => {
      await page.goto(path);
      expect(await undeclaredFigures(page), "a digit with no receipt (contract rule 4)").toEqual([]);
    });
  }

  /*
    §39: "text overlap 0", measured instead of screenshotted, at every width the suite runs.

    The first hero composition positioned its seven panels as percentages of a fixed box, which is
    a technique that cannot know how tall its own content is: four pairs intersected at 1440, the
    worst of them 216x89. The stage is a grid of four blocks now and a grid cannot overlap -- this
    is what says so on every run, and what will catch the next percentage someone reaches for.
    Not width-scoped, because the arrangement changes at 1200 and 768 and each of those is a new
    chance to overlap; both locales, because the Korean labels are longer.
  */
  for (const path of ["/", "/ko"]) {
    test(`${path} lays the hero demo out with nothing on top of anything else`, async ({ page }) => {
      await page.goto(path);
      /* At rest. D11's entry lifts two blocks 12px and lands them; mid-flight they overlap by
         design, and the premise here -- "a grid cannot overlap" -- is about the layout. */
      await settledHero(page);
      const collisions = await page.locator(`${DEMO} .lv2-demo-stage > *`).evaluateAll((nodes) => {
        const boxes = nodes.map((node) => ({ name: node.className.toString().split(" ")[0], box: node.getBoundingClientRect() }));
        const found: string[] = [];
        for (let a = 0; a < boxes.length; a += 1) {
          for (let b = a + 1; b < boxes.length; b += 1) {
            const one = boxes[a]!.box;
            const two = boxes[b]!.box;
            // A shared edge is not an overlap; a shared pixel of area is.
            const width = Math.min(one.right, two.right) - Math.max(one.left, two.left);
            const height = Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top);
            if (width > 1 && height > 1) {
              found.push(`${boxes[a]!.name} x ${boxes[b]!.name} ${Math.round(width)}x${Math.round(height)}`);
            }
          }
        }
        return found;
      });
      expect(collisions, "blocks of the hero demo intersect").toEqual([]);
    });
  }

  /*
    One caption at a time, sampled while the sequence is held.

    The round-1 shape faded one caption out while the next faded in, which put two sentences at
    half opacity over the same lines. The windows are sequential with a gap now, so the invariant
    holds at every instant of the timeline rather than at most of them -- which is why sampling
    at arbitrary moments is a fair test of it.
  */
  test("shows one beat caption at a time", async ({ page }, testInfo) => {
    /*
      Not under reduced motion, where all eight are a list on purpose (§26): a reader who is not
      being shown the sequence is owed the whole story at once. That state has its own test below.
    */
    test.skip(testInfo.project.name === "reduced-motion", "the reduced-motion state is a list");
    await page.goto("/");
    for (let sample = 0; sample < 5; sample += 1) {
      const legible = await page
        .locator(".lv2-demo-caption")
        .evaluateAll((nodes) => nodes.filter((node) => Number(getComputedStyle(node).opacity) > 0.05).length);
      expect(legible, "two beat captions are legible at once").toBeLessThanOrEqual(1);
      await page.waitForTimeout(700);
    }
  });

  /*
    The strip is the hero's key visual, so it is the one image that may not be decorative.

    Its own element carries the region outline (the strip IS the box), the locator carries the
    same box drawn on the whole page, and the claim card is what was compiled out of it. §43's
    three parts, present at every width.
  */
  for (const path of ["/", "/ko"]) {
    test(`${path} shows the strip, the page it is on, the claim and the slot`, async ({ page }) => {
      await page.goto(path);
      for (const selector of [".lv2-read", ".lv2-locator", ".lv2-claim-block .lv2-claim", ".lv2-slot"]) {
        await expect(page.locator(selector), `${selector} is missing from the stage`).toHaveCount(1);
      }
      await expect(page.locator(".lv2-region--strip")).toHaveCount(1);
      await expect(page.locator(".lv2-locator-meta")).toBeVisible();
      // Every image on the page declares its size and says what it is.
      const images = await page.locator("main img").evaluateAll((nodes) =>
        nodes.map((node) => ({
          src: node.getAttribute("src"),
          width: node.getAttribute("width"),
          height: node.getAttribute("height"),
          alt: node.getAttribute("alt"),
        })),
      );
      expect(images.length).toBeGreaterThan(0);
      for (const image of images) {
        expect(Number(image.width), `${image.src} declares no width`).toBeGreaterThan(0);
        expect(Number(image.height), `${image.src} declares no height`).toBeGreaterThan(0);
        expect(image.alt, `${image.src} has no alt attribute`).not.toBeNull();
      }
    });
  }

  /* The footer states no deployment gate: it renders on /explore, where BA-028 forbids the phrase. */
  for (const path of ["/", "/ko"]) {
    test(`${path} keeps the deployment gate out of the footer`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("footer.site .site-footer-gate")).toHaveCount(0);
      expect(await page.locator("footer.site").innerText()).not.toMatch(/this deployment/i);
    });
  }

  for (const path of ["/", "/ko"]) {
    test(`${path} does not scroll sideways`, async ({ page }) => {
      await page.goto(path);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await horizontalOverflow(page), "horizontal overflow").toBeLessThanOrEqual(1);
    });
  }
});

/*
  The landmark and heading audit, ported from `e2e/landing.spec.ts` when that file retired.

  Its §5 checklist items were written against the five-section page and most of them counted that
  page's furniture -- four H2s, six H3s, three frames. What survives is everything that is a
  property of a document rather than of that layout: one H1 and it is the page's own headline, no
  skipped heading level, no nested section, no duplicate id, no chrome inside `main`, one banner
  and one contentinfo, no two navigation landmarks sharing a name, and every in-page link
  resolving to something that can take focus.

  What did NOT survive is the document-height ratchet (§5.7), and that is deliberate: its
  ceilings were re-derived from a fixture build of the old page, this lane runs no build, and a
  ceiling carried across a rewrite is a number with no measurement behind it. The QA lane
  re-derives it and puts it back.
*/
const AUDITED = [
  { path: "/", h1: "AI-ready knowledge. Traceable to every source." },
  { path: "/ko", h1: "AI가 바로 사용할 수 있는 지식. 모든 원문까지 추적됩니다." },
] as const;

for (const entry of AUDITED) {
  test(`${entry.path} holds the audited landmark and heading structure`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "1440", "one desktop width is enough for a DOM-shape contract");
    await page.goto(entry.path);

    await expect(page.locator("h1")).toHaveCount(1);
    expect((await page.locator("h1").innerText()).replace(/\s+/g, " ").trim()).toBe(entry.h1);

    const outline = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("main h1, main h2, main h3, main h4, main h5, main h6")].map((node) => ({
        level: Number(node.tagName[1]),
        text: (node.textContent ?? "").trim(),
        section: node.closest("section")?.id ?? null,
      })),
    );
    // No skipped heading level in the document order of the main region.
    for (let index = 1; index < outline.length; index += 1) {
      expect(outline[index]!.level - outline[index - 1]!.level, `heading level jumps at "${outline[index]!.text}"`)
        .toBeLessThanOrEqual(1);
    }
    // Eight H2s -- one per scene after the hero -- each in a different section, and no nesting.
    const h2s = outline.filter((heading) => heading.level === 2);
    expect(h2s).toHaveLength(SCENES.length - 1);
    expect(new Set(h2s.map((heading) => heading.section)).size).toBe(SCENES.length - 1);
    await expect(page.locator("main section section")).toHaveCount(0);

    const duplicateIds = await page.evaluate(() => {
      const seen = new Map<string, number>();
      for (const node of document.querySelectorAll<HTMLElement>("[id]")) seen.set(node.id, (seen.get(node.id) ?? 0) + 1);
      return [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
    });
    expect(duplicateIds).toEqual([]);

    // The page's chrome is around `main`, never inside it.
    await expect(page.locator("main header, main footer")).toHaveCount(0);
    await expect(page.locator("body > .page > header")).toHaveCount(1);
    await expect(page.locator("body > .page > footer")).toHaveCount(1);

    /*
      Every in-page link resolves, and its target can take focus. The checklist writes this as
      "the target is a section", which is true of the scene links and not of the skip link --
      `#main` targets the main region itself. Both are focusable by declaration, which is the
      property a keyboard user actually depends on.
    */
    const hashTargets = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')].map((link) => {
        const id = link.getAttribute("href")!.slice(1);
        const target = id ? document.getElementById(id) : null;
        return { href: link.getAttribute("href"), found: !!target, tabindex: target?.getAttribute("tabindex") ?? null };
      }),
    );
    for (const target of hashTargets) {
      expect(target.found, `${target.href} points at nothing`).toBe(true);
      expect(target.tabindex, `${target.href} cannot take focus`).toBe("-1");
    }

    // No two navigation landmarks share an accessible name, and there is one of each other kind.
    const navNames = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("nav")].map((node) => node.getAttribute("aria-label") ?? ""),
    );
    expect(new Set(navNames).size, "two navigation landmarks share a name").toBe(navNames.length);
  });
}

/*
  The §32 composition, at the width it is drawn against, as the 2026-09-19 recomposition sets it.

  Text 600, gap 28, visual 668 inside the 1296 measure: the text column starts on the wrap's left
  edge and the visual ends on its right one. The text column grew from §32's 520 because the H1
  has to be the largest type on the page and that headline needs about 575px at 56px; the visual
  gave up the 40px, keeping §32's 708:600 proportion and losing its absolute width.
*/
test.describe("at 1440", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "1440", "the 1440 grid");
  });

  test("lays the hero out on the shared measure, inside one viewport", async ({ page }) => {
    await page.goto("/");
    const text = await page.locator(".lv2-hero-text").boundingBox();
    const demo = await page.locator(DEMO).boundingBox();
    expect(text && demo).toBeTruthy();
    expect(Math.round(text!.x), "the text column starts on the wrap's left edge").toBe(72);
    expect(Math.round(text!.width), "the recomposed text width").toBe(600);
    expect(Math.round(demo!.x), "the visual's left edge").toBe(700);
    expect(Math.round(demo!.width), "the visual takes the rest of the measure").toBe(668);
    expect(Math.round(demo!.x + demo!.width), "and ends on the wrap's right edge").toBe(1368);
    // The wordmark shares that left edge (D9), which is the whole point of the measure.
    const wordmark = await page.locator("header.nav .wordmark").boundingBox();
    expect(Math.round(wordmark!.x)).toBe(72);
  });

  /*
    D9's hero canvas, which round 3 measured at 145vh and escalated.

    min(900px, 100vh) at 1440x900 is 900, and the header is `position: fixed` so the hero owns the
    whole fold. Eight pixels of tolerance for sub-pixel rounding of a clamped type scale, and not
    a line more: the point of the bound is that the compiled claim, the region it came from and
    the comparison are all in the first screen.
  */
  for (const path of ["/", "/ko"]) {
    test(`${path} keeps the hero inside the first viewport`, async ({ page }) => {
      await page.goto(path);
      const hero = await page.locator("section#hero").boundingBox();
      const viewport = page.viewportSize()!.height;
      expect(Math.round(hero!.height), `hero ${hero!.height}px against a ${viewport}px viewport`)
        .toBeLessThanOrEqual(viewport + 8);
      // And the payoff is in it: the claim card's bottom edge is above the fold.
      const claim = await page.locator(".lv2-claim").boundingBox();
      expect(Math.round(claim!.y + claim!.height), "the compiled claim is below the fold")
        .toBeLessThanOrEqual(viewport);
    });
  }

  /*
    Two things a reader has to be able to finish reading, both of which an earlier overlap hid.

    The origin of each relation (`entity-node.tsx`: the candidates are the filing's own edges, so
    a row that does not say which node it leaves reads as the compiled claim's), and the noun and
    the engine over the comparison figures -- contract rule 4's "shown with what they count" and
    BA-034's "named where the figure is printed", neither of which a state word alone satisfies.
  */
  test("states each relation's origin, what the figures count, and which engine counted", async ({ page }) => {
    await page.goto("/");
    const vias = page.locator(".lv2-node-via");
    expect(await vias.count(), "every object row names the node its relation leaves").toBeGreaterThan(0);
    expect(await vias.count()).toBe(await page.locator(".lv2-node").count());
    for (const text of await vias.allInnerTexts()) expect(text.trim().length).toBeGreaterThan(0);
    await expect(vias.first()).toBeVisible();
    // Never the topic edge: the production compiler contract does not claim it as an emission.
    for (const text of await page.locator(".lv2-node-rel").allInnerTexts()) {
      expect(text.toLowerCase(), "the hero shows a relation the engine is not described as emitting")
        .not.toContain("topic");
    }

    /*
      The counts are rendered twice -- once as the Recompile beat, once in the slot's resting
      stack -- so both instances are checked rather than the first. Each carries its own noun,
      its own qualifier, and a list that names the heading it belongs to.
    */
    const titles = page.locator(".lv2-counts-title");
    const count = await titles.count();
    expect(count, "the comparison is headed wherever it is printed").toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      const title = titles.nth(index);
      // A noun, not a figure: the label says what is counted and never states a count itself.
      expect((await title.innerText()).trim()).not.toMatch(/\d/);
      const list = page.locator(".lv2-counts-list").nth(index);
      expect(await list.getAttribute("aria-labelledby")).toBe(await title.getAttribute("id"));
    }
    const notes = page.locator(".lv2-counts-note");
    expect(await notes.count(), "BA-034: the engine is named with every printing of the figures").toBe(count);
    for (const text of await notes.allInnerTexts()) expect(text.trim().length).toBeGreaterThan(0);
    await expect(page.locator(".lv2-slot-static .lv2-counts-note")).toBeVisible();
  });

  test("runs the signature interaction from the keyboard", async ({ page }) => {
    await page.goto("/");
    const claim = page.locator("#hero .lv2-claim");
    await expect(claim).toHaveCount(1);
    /*
      Scoped to the hero, and that is the fix round 4 asked for rather than a looser number.

      The two regions here are the strip (which IS the box) and the thumbnail (where that box is
      on the page). Page-wide the selector now matches six, because Scenes 02 and 04 draw the
      same primitive on their own rasters exactly as D10 asked them to -- so an unscoped count
      was measuring the other lanes' work and contradicting `e2e/evidence-first.spec.ts`, which
      counts the same two in the same hero.
    */
    const regions = page.locator("#hero .lv2-region");
    await expect(regions).toHaveCount(2);
    await claim.focus();
    /*
      §4.1. Focusing the compiled object rings the region it was read from and draws the lines to
      it in full. Measured from paint, because the CSS does this with `:has()` and the attribute
      the JavaScript fallback writes -- and which of the two ran is not the thing under test.
    */
    await expect(regions.first()).toHaveCSS("outline-width", "2px");
    await expect(regions.nth(1)).toHaveCSS("outline-width", "2px");
    const drawn = await page.locator(".lv2-line").first().evaluate((node) => getComputedStyle(node).transform);
    expect(["none", "matrix(1, 0, 0, 1, 0, 0)"], "the evidence line is drawn in full while the claim is focused")
      .toContain(drawn);
    // And the coordinate label reads, with its unit stated beside it.
    const label = page.locator(".lv2-read-label");
    await expect(label).toContainText("SOURCE ·");
    await expect(label).toBeVisible();
    await expect(page.locator(".lv2-read-unit")).toContainText("per mille");
  });

  /*
    §23's other half: the loop does not run for a reader who has scrolled past it.

    `hero-compiler-demo.tsx` writes `data-offscreen` from an IntersectionObserver and the
    stylesheet pauses on it through the same rule the control uses. Two viewports down is well
    past a hero that fits in one.
  */
  test("stops the sequence once the hero is off screen, and restarts it on return", async ({ page }) => {
    await page.goto("/");
    const demo = page.locator(DEMO);
    await expect(demo).toHaveAttribute("data-offscreen", "0");
    await page.evaluate(() => window.scrollTo(0, window.innerHeight * 2));
    await expect(demo).toHaveAttribute("data-offscreen", "1");
    expect(
      await page.locator(".lv2-claim").evaluate((node) => getComputedStyle(node).animationPlayState),
      "the sequence keeps running out of view",
    ).toBe("paused");
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(demo).toHaveAttribute("data-offscreen", "0");
  });

  test("reaches the hero's actions from the skip link in a bounded number of stops", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab"); // the skip link
    const reached: string[] = [];
    for (let stop = 0; stop < 14; stop += 1) {
      const href = await page.evaluate(() => (document.activeElement as HTMLAnchorElement | null)?.getAttribute("href"));
      if (href) reached.push(href);
      if (href === "/explore") break;
      await page.keyboard.press("Tab");
    }
    expect(reached, "the hero's Explore action is reachable from the top of the page").toContain("/explore");
    expect(reached.length, "and is not behind a dozen chrome stops").toBeLessThanOrEqual(14);
  });
});

/*
  The phone composition (§25). A vertical narrative, not a scaled desktop demo: the source page,
  the evidence line and the compiled claim in the order the beats run, with the control still
  present and every reachable thing inside the viewport.
*/
test.describe("at 390", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "390", "the phone composition");
  });

  test("recomposes the hero as a column rather than shrinking it", async ({ page }) => {
    await page.goto("/");
    const stage = page.locator(".lv2-demo-stage");
    await expect(stage).toHaveCount(1);
    // In flow, not absolutely positioned: the desktop composition is a layer over this order.
    expect(await stage.evaluate((node) => getComputedStyle(node).display)).toBe("grid");
    const order = await stage.evaluate((node) =>
      [...node.children].map((child) => child.className.toString().split(" ")[0]),
    );
    expect(order).toEqual(["lv2-read", "lv2-locator", "lv2-claim-block", "lv2-slot"]);
    /*
      The strip is re-flowed as two halves rather than shrunk to six-pixel glyphs, and the halves
      are two elements of the same resource -- no scroller, no drag.
    */
    const halves = page.locator(".lv2-read-img");
    await expect(halves).toHaveCount(2);
    expect(await halves.nth(0).getAttribute("src")).toBe(await halves.nth(1).getAttribute("src"));
    for (let index = 0; index < 2; index += 1) {
      const box = await halves.nth(index).boundingBox();
      expect(box!.height, "a half of the strip is too short to read").toBeGreaterThan(40);
    }
    /*
      The beats are additive here: the slot's four panels are in flow, so nothing a reader is part
      way through disappears. The desktop's resting stack would restate three of them and is not
      rendered at this width.
    */
    expect(await page.locator(".lv2-slot-static").evaluate((node) => getComputedStyle(node).display)).toBe("none");
    for (const beat of ["structure", "change", "recompile", "use"]) {
      expect(
        await page.locator(`.lv2-slot-beat--${beat}`).evaluate((node) => getComputedStyle(node).position),
        `the ${beat} beat is stacked rather than in flow`,
      ).toBe("static");
    }
    /*
      Every REACHABLE control clears the touch floor and sits inside the viewport.

      "Reachable" is the word the contract uses and round 4 is why it is now enforced rather than
      assumed: the unscoped list caught four controls at 0x0 -- two `.lv2-node` links inside
      `DIV.lv2-slot-static`, which this very test asserts is `display: none` fifteen lines above,
      and two links inside `[hidden]` tab panels. A control with no box is not a small target; it
      is not a target, and no pointer or keyboard reaches it. `getClientRects()` is the browser's
      own answer to that question -- it is empty for `display: none` and for a `[hidden]` subtree
      and non-empty for everything a reader can hit -- so nothing here is filtered by a class
      name, and a control that becomes visible is measured on the run it becomes visible.
    */
    const boxes = await page.locator("main a[href], main button").evaluateAll((nodes) =>
      nodes
        .filter((node) => node.getClientRects().length > 0)
        .map((node) => {
          const box = node.getBoundingClientRect();
          return { height: box.height, right: box.right, left: box.left };
        }),
    );
    expect(boxes.length, "the page offers controls at all").toBeGreaterThan(0);
    for (const box of boxes) {
      expect(box.height, "44px touch floor").toBeGreaterThanOrEqual(44);
      expect(box.left).toBeGreaterThanOrEqual(-1);
      expect(box.right).toBeLessThanOrEqual(391);
    }
  });
});

/*
  Reduced motion (§26, contract rule 8): nothing travels, the control is still there, and the
  reader is given the complete state rather than the last frame of a sequence they never saw.
*/
test.describe("with reduced motion", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "reduced-motion", "the reduced-motion gate");
    /*
      THE PROJECT SETS `reducedMotion: "reduce"` AND IT DOES NOT ARRIVE. Emulate it on the page.

      `playwright.config.ts` declares the option on this project's context, which is the
      documented way, and in this installation of @playwright/test 1.62.0 the page still reports
      `prefers-reduced-motion: no-preference`. Round 2 opened the same build with the raw
      `playwright` library under `reducedMotion: "reduce"` and all five assertions below passed,
      while the same assertions under the test runner failed on the first --
      `.lv2-demo[data-playing="0"]` matched nothing, because the component's own `matchMedia`
      read the query correctly and was told there was no preference.

      So this gate was green over a product that had never been put in the state it gates, in
      CI's Launch job as well as here, and the product was right the whole time. `emulateMedia`
      sets the emulation per page instead of per context and is idempotent with the project
      option, so it is correct whether or not the installation is ever repaired -- and repairing
      it means changing a dependency, which rule 1 of this campaign forbids outright.
    */
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("stops the sequence, keeps the control, and shows the whole story at once", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(`${DEMO}[data-playing="0"]`)).toHaveCount(1);
    const control = page.locator(`${DEMO} button`);
    await expect(control).toHaveCount(1);
    await expect(control).toBeVisible();
    /*
      The composed state. The stylesheet collapses every animation to 1ms and one iteration, and a
      finished animation reverts each element to its base style -- which is written as the
      finished frame. At this width (1440) that is the strip with its box and its coordinate, the
      page it sits on, the compiled claim, and the slot's resting stack: the snapshot step, the
      comparison with its engine qualifier, and the objects bound to the region. The four
      rotating beats revert to hidden, which is correct -- their content is in that stack.
    */
    for (const selector of [
      ".lv2-read",
      ".lv2-region--strip",
      ".lv2-read-label",
      ".lv2-locator",
      ".lv2-claim",
      ".lv2-slot-static .lv2-revision",
      ".lv2-slot-static .lv2-counts",
      ".lv2-slot-static .lv2-counts-note",
      ".lv2-slot-static .lv2-nodes",
    ]) {
      await expect(page.locator(selector).first(), `${selector} is in the composed state`).toBeVisible();
    }
    // Nothing is stacked on top of it: the rotating beats are not painted at rest.
    const beatsShowing = await page
      .locator(".lv2-slot-beat")
      .evaluateAll((nodes) => nodes.filter((node) => Number(getComputedStyle(node).opacity) > 0.05).length);
    expect(beatsShowing, "a rotating beat is painted over the resting stack").toBe(0);
    // All eight beat captions are readable at once, as a list rather than as a stack of one.
    const captions = page.locator(".lv2-demo-caption");
    await expect(captions).toHaveCount(8);
    const opacities = await captions.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).opacity));
    expect(new Set(opacities), "every beat is legible under reduced motion").toEqual(new Set(["1"]));
    /*
      And the hero's document is not tilted: §22's perspective is a motion-adjacent flourish.

      Scoped: `.lv2-page` is the shared source-page primitive and eight of them are on the page
      now (Scenes 02, 03 and 04 each render it), which made an unscoped `evaluate` a strict-mode
      violation rather than a failed assertion. The subject is the hero's stage.
    */
    expect(await page.locator("#hero .lv2-page").first().evaluate((node) => getComputedStyle(node).transform)).toBe("none");
  });
});

/*
  THE EIGHT SCENES BELOW THE HERO (contract D9, D12, §39).

  The hero has its own blocks above; this one is about the page a reader reaches by scrolling.
  Every assertion here is one only a browser can settle -- that the scene is really visible when
  it is scrolled to, that its one next action is on screen and points where the contract says,
  that the two interactive scenes work from the keyboard, and that the close states the gate in
  the deployment's own words.

  The hrefs are written out rather than imported. Each is already pinned against the module that
  owns it by a `lib/landing-v2-*.test.ts` guard; what no unit test can see is whether the
  COMPOSITION still carries them. Importing those modules here would make this test agree with
  them by construction, which is the one thing it must not do.
*/
const NEXT_ACTION: Record<string, string> = {
  proof: EXPLORE_CTA.href,
  sources: "/explore?act=world",
  evidence: "/explore-sample/apple-2025-form-10-k.pdf#page=4",
  recompile: "/explore?act=change",
  why: "/knowledge-compiler",
  use: "/docs/use-with-ai",
  trust: "/security",
};

test.describe("the scenes below the hero", () => {
  for (const path of ["/", "/ko"]) {
    test(`${path} brings every scene into view with its next action on screen`, async ({ page }) => {
      await page.goto(path);
      for (const [id, href] of Object.entries(NEXT_ACTION)) {
        const section = page.locator(`section#${id}`);
        await section.scrollIntoViewIfNeeded();
        await expect(section, `${id} is not visible when scrolled to`).toBeVisible();
        const action = section.locator(`a[href="${href}"]`);
        await expect(action, `${id} lost its next action`).toHaveCount(1);
        await expect(action).toBeVisible();
      }
    });
  }

  test("the proof scene switches panes on click and on the arrow keys", async ({ page }) => {
    await page.goto("/");
    const scene = page.locator("section#proof");
    await scene.scrollIntoViewIfNeeded();
    const tabs = scene.getByRole("tab");
    await expect(tabs).toHaveCount(3);
    const selected = async () =>
      (await tabs.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-selected")))).indexOf("true");
    const shownPanel = async () =>
      scene.locator('[role="tabpanel"]:not([hidden])').getAttribute("aria-labelledby");
    // Exactly one pane is shown, and it is the one the selected tab controls.
    await expect(scene.locator('[role="tabpanel"]:not([hidden])')).toHaveCount(1);
    expect(await selected()).toBe(0);
    const first = await shownPanel();
    await tabs.nth(2).click();
    expect(await selected()).toBe(2);
    expect(await shownPanel()).not.toBe(first);
    // A roving tabindex: one stop for the whole row, and the arrow keys move the selection.
    await tabs.nth(0).focus();
    await page.keyboard.press("ArrowRight");
    expect(await selected()).toBe(1);
    await expect(tabs.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    expect(await selected()).toBe(0);
    // Every tab clears the touch floor (contract rule 8).
    for (const height of await tabs.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))) {
      expect(height).toBeGreaterThanOrEqual(44);
    }
  });

  test("the evidence inspector announces the copied citation", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "the clipboard permission this needs is a chromium API");
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    const scene = page.locator("section#evidence");
    await scene.scrollIntoViewIfNeeded();
    const copy = scene.locator("button[data-state]");
    await expect(copy).toHaveCount(1);
    await expect(copy).toHaveAttribute("data-state", "idle");
    const announcement = scene.locator('[role="status"][aria-live="polite"]');
    await expect(announcement).toHaveCount(1);
    await copy.click();
    await expect(copy).toHaveAttribute("data-state", "copied");
    await expect(announcement).not.toBeEmpty();
    // The citation is the record's own, so it names the filing rather than the page's copy.
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("apple-2025-form-10-k.pdf");
  });

  test("the recompile counts each print the noun that says what they count", async ({ page }) => {
    await page.goto("/");
    const scene = page.locator("section#recompile");
    await scene.scrollIntoViewIfNeeded();
    const counts = scene.locator("li:has(> b[data-derived])");
    expect(await counts.count()).toBeGreaterThanOrEqual(3);
    for (const text of await counts.allInnerTexts()) {
      expect(text.replace(/[\d,]/g, "").trim(), `a count printed without its noun: ${text}`).not.toBe("");
    }
    // The compiler contract is the secondary link, never a claim that this deployment does it.
    await expect(scene.locator('a[href="/product/continuous-knowledge"]')).toHaveCount(1);
  });

  test("the trust scene states four proofs and three routes that exist", async ({ page }) => {
    await page.goto("/");
    const scene = page.locator("section#trust");
    await scene.scrollIntoViewIfNeeded();
    await expect(scene.locator(".lv2-proof")).toHaveCount(4);
    await expect(scene.locator("a.lv2-text-link")).toHaveCount(3);
    for (const href of ["/security", "/trust", "/subprocessors"]) {
      await expect(scene.locator(`a[href="${href}"]`), `${href} left the trust scene`).toHaveCount(1);
    }
  });
});

test.describe("the close", () => {
  for (const path of ["/", "/ko"]) {
    test(`${path} closes with both actions and the gate in the deployment's own words`, async ({ page }) => {
      await page.goto(path);
      const scene = page.locator("section#start");
      await scene.scrollIntoViewIfNeeded();
      // The filled control here is the access action -- the one place on the page Explore is not.
      const cta = scene.locator("a[data-scene-next='start']");
      await expect(cta).toBeVisible();
      expect(ACCESS_HREFS, "a third access action").toContain(await cta.getAttribute("href"));
      expect(ACCESS_LABELS).toContain((await cta.innerText()).trim());
      const explore = scene.locator(`a[href="${EXPLORE_CTA.href}"]`);
      await expect(explore).toHaveCount(1);
      await expect(scene.locator('a[href="/pricing"]')).toHaveCount(1);
      // Contract rule 5: wherever the gate is stated it is `activationPolicy.customerData.reason`.
      const gate = scene.locator("[data-customer-data]");
      if (activationPolicy.customerData.enabled) {
        await expect(gate).toHaveCount(0);
      } else {
        await expect(gate).toHaveCount(1);
        // Verbatim in English. `/ko` carries the literal translation, which its copy test pins.
        if (path === "/") expect((await gate.innerText()).trim()).toBe(activationPolicy.customerData.reason);
      }
      // 44px on both controls, at every width this suite runs (contract rule 8).
      for (const control of [cta, explore]) {
        expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
    });
  }
});

/*
  D6: the six founder-approved Q&As left the landing for /contact, unchanged.

  Here rather than in a /contact spec of its own because the move is this campaign's decision,
  and this is the file that has to notice if the landing drops them without them arriving.
*/
test.describe("the FAQ that left the landing", () => {
  test("/contact carries the six questions, collapsed", async ({ page }) => {
    await page.goto("/contact");
    /*
      Scoped to the FAQ, not to every disclosure on the page.

      `components/contact-form.tsx` has carried its own qualification fold since before D6, and
      counting it made the number seven. The six that moved are the ones this test is named for;
      the form's fold is the form's and is exercised with the form.
    */
    const items = page.locator("main details:not(.contact-qualification-fold)");
    await expect(items).toHaveCount(6);
    const open = await items.evaluateAll((nodes) => nodes.map((node) => (node as HTMLDetailsElement).open));
    expect(open, "a question is expanded before the reader asks").toEqual(open.map(() => false));
    await expect(page.locator("main details:not(.contact-qualification-fold) > summary")).toHaveCount(6);
  });

  test("the landing itself no longer answers them", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main details")).toHaveCount(0);
  });
});
