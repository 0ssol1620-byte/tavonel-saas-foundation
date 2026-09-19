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
    /*
      Scoped to the default arm (D8). Test 01 replaces the H1 with one of the copy deck's two
      experiment headlines, so this string is the page's H1 only while no experiment is running
      -- which is every deployment with `NEXT_PUBLIC_LANDING_EXPERIMENT` unset, CI included. The
      line cap below is NOT scoped: an arm that set in four lines would be the same defect.
    */
    const headlineExperiment = process.env.NEXT_PUBLIC_LANDING_EXPERIMENT === "headline";
    await page.goto("/");
    const h1 = page.locator("h1#lv2-hero-title");
    await expect(h1).toHaveCount(1);
    if (!headlineExperiment) expect((await h1.innerText()).replace(/\s+/g, " ").trim()).toBe(HEADLINE);
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
    // D3: the editorial serif carries one phrase of it, and only on the English page. The
    // accented phrase belongs to the brand line, so this is the default arm's too.
    if (!headlineExperiment) await expect(h1.locator("em.lv2-serif")).toHaveCount(1);
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
    /*
      F10: ONE image preload in the document, not two.

      React 19 keys an image preload by its `imagesrcset`/`imagesizes` pair and hoists it into the
      head; an element that also carried `href` registered under a second key, so the built
      document held two preloads for one file (P3 QA round 2, P2-2). `app/page.tsx` drops the
      `href` -- a responsive preload is selected from `imagesrcset` alone -- and this is the
      assertion that keeps the duplicate from coming back through the source.

      MEASURED ON THE SERVED DOCUMENT AND ON THE HEAD, which is where a preload does its work.
      React renders the same element again on the client, in place, and a <link rel=preload>
      appended to the body after load preloads nothing that is not already fetched -- so counting
      every node in the DOM would be counting a no-op and would fail for the wrong reason.
    */
    const served = await (await page.request.get(page.url())).text();
    expect(
      (served.match(/rel="preload"[^>]*as="image"/g) ?? []).length,
      "the served document preloads the hero raster more than once",
    ).toBe(1);
    expect(await page.locator(`head link[rel="preload"][as="image"]`).count(), "one preload in the head").toBe(1);
  });

  test("the demo has exactly one control, and it meets the touch floor", async ({ page }, testInfo) => {
    /*
      F4: below 768 there is no sequence, so there is no control -- a play button that cannot
      start anything is a 44px target that lies. The phone projects assert the static composition
      instead, in "at 390" further down.
    */
    test.skip(Number(testInfo.project.name) <= 767, "the phone hero has no sequence and no control");
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
      Not under reduced motion, where the last caption alone stands (§26, F5): every object the
      other six narrate is on screen at full strength there, so the transcript has nothing left to
      substitute for. That state has its own test below. Not on a phone either, where F4 hides the
      narration row with the sequence it describes.
    */
    test.skip(testInfo.project.name === "reduced-motion", "the reduced-motion state is the last caption");
    test.skip(Number(testInfo.project.name) <= 767, "the phone hero has no sequence and no narration row");
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
    three parts, present at every width -- and since F2 so are the other three objects, each in a
    grid cell of its own rather than taking turns in a rotating slot.
  */
  for (const path of ["/", "/ko"]) {
    test(`${path} shows the strip, the page it is on, the claim and the slot`, async ({ page }) => {
      await page.goto(path);
      for (const selector of [
        ".lv2-read",
        ".lv2-locator",
        ".lv2-claim-block .lv2-claim",
        ".lv2-demo-stage > .lv2-nodes",
        ".lv2-demo-stage > .lv2-revision",
        ".lv2-demo-stage > .lv2-counts",
      ]) {
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
      The counts are rendered ONCE since F2 -- they have a grid cell of their own instead of a
      turn in a rotating slot -- and this walks every instance rather than the first, which is
      what catches a second copy coming back. Each carries its own noun, its own qualifier, and a
      list that names the heading it belongs to.
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
    await expect(page.locator(".lv2-counts-note")).toBeVisible();
    /*
      F2: and every object is painted from the first frame rather than waiting for its beat. The
      sequence changes emphasis, not presence, so a screenshot at any instant of the loop holds
      the whole composition -- which is also why `vias.first()` above is a fair assertion again.
    */
    for (const selector of [".lv2-node", ".lv2-counts", ".lv2-revision", ".lv2-claim", ".lv2-read"]) {
      const opacity = await page.locator(`#hero ${selector}`).first().evaluate((node) => {
        let value = 1;
        for (let n: Element | null = node; n; n = n.parentElement) value *= Number(getComputedStyle(n).opacity);
        return value;
      });
      expect(opacity, `${selector} is below F2's resting emphasis at this instant`).toBeGreaterThanOrEqual(0.55);
    }
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
  The phone composition (§25, F4). A vertical narrative, not a scaled desktop demo -- and not a
  sequence either: below 768 the hero is the static complete composition, every object painted at
  full strength on the first frame, with no rotation, no narration row and no play/pause control.
  What is checked here is that all six objects are present and readable, that the strip is
  re-flowed rather than shrunk, and that every reachable control clears the touch floor inside the
  viewport.
*/
test.describe("at 390", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "390", "the phone composition");
  });

  test("renders the hero as the static complete composition, with no sequence", async ({ page }) => {
    await page.goto("/");
    const stage = page.locator(".lv2-demo-stage");
    await expect(stage).toHaveCount(1);
    expect(await stage.evaluate((node) => getComputedStyle(node).display)).toBe("grid");
    /*
      All six objects, in the order §25's vertical narrative reads them: the region that was read,
      where it sits on the filing, what was compiled out of it, the objects bound to it, what
      arrived later, and what the recompile compared. The grid pairs two of those rows sideways so
      the hero is not three viewports tall, but the DOM order is the narrative either way.
    */
    const order = await stage.evaluate((node) =>
      [...node.children].map((child) => child.className.toString().split(" ")[0]),
    );
    expect(order).toEqual(["lv2-read", "lv2-locator", "lv2-claim-block", "lv2-nodes", "lv2-revision", "lv2-counts"]);
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
      F4: STATIC AND COMPLETE. No beat rotates here, so nothing is at reduced emphasis and
      nothing is waiting for a turn -- every object is painted at full strength on the first
      frame, which is the state a reader who never scrolls back is owed.
    */
    for (const selector of [
      ".lv2-read",
      ".lv2-region--strip",
      ".lv2-locator",
      ".lv2-claim",
      ".lv2-demo-stage > .lv2-nodes",
      ".lv2-demo-stage > .lv2-revision",
      ".lv2-demo-stage > .lv2-counts",
    ]) {
      const target = page.locator(selector).first();
      await expect(target, `${selector} is missing from the phone composition`).toBeVisible();
      expect(
        await target.evaluate((node) => Number(getComputedStyle(node).opacity)),
        `${selector} is not at full strength`,
      ).toBe(1);
    }
    // And the objects' own rows are readable, not only present.
    await expect(page.locator(".lv2-node-via").first()).toBeVisible();
    await expect(page.locator(".lv2-counts-note")).toBeVisible();
    await expect(page.locator(".lv2-nodes-caveat")).toBeVisible();
    /*
      No play/pause control, because there is no sequence for it to control (F4). Asserted on what
      a reader can reach rather than on the DOM: the element is hidden by the stylesheet, which
      also takes it out of the tab order.
    */
    const controls = await page
      .locator(".lv2-demo button")
      .evaluateAll((nodes) => nodes.filter((node) => node.getClientRects().length > 0).length);
    expect(controls, "the phone hero renders a control for a sequence it does not run").toBe(0);
    await expect(page.locator(".lv2-demo-foot")).toBeHidden();
    /*
      Every REACHABLE control clears the touch floor and sits inside the viewport.

      "Reachable" is the word the contract uses, and `getClientRects()` is the browser's own
      answer to it: empty for a `display: none` subtree and for a `[hidden]` tab panel, non-empty
      for everything a pointer or a keyboard can hit. Nothing here is filtered by a class name, so
      a control that becomes visible is measured on the run it becomes visible.
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
      The composed state, which since F2 is the same picture as the loop's two-second hold.

      The stylesheet collapses every animation to 1ms and one iteration, and a finished animation
      reverts each element to its base style -- which is written as the finished frame. With no
      rotating slot left, there is no element whose base is hidden: the strip with its box and its
      coordinate, the page it sits on, the compiled claim, the objects bound to the region, the
      arrivals and the comparison with its engine qualifier are all painted, all at full strength.
    */
    for (const selector of [
      ".lv2-read",
      ".lv2-region--strip",
      ".lv2-read-label",
      ".lv2-locator",
      ".lv2-claim",
      ".lv2-demo-stage > .lv2-nodes",
      ".lv2-demo-stage > .lv2-revision",
      ".lv2-demo-stage > .lv2-counts",
      ".lv2-counts-note",
      ".lv2-nodes-caveat",
    ]) {
      const target = page.locator(selector).first();
      await expect(target, `${selector} is in the composed state`).toBeVisible();
      expect(
        await target.evaluate((node) => Number(getComputedStyle(node).opacity)),
        `${selector} is not at full emphasis`,
      ).toBe(1);
    }
    /*
      F5: the narration is the FINAL sentence and nothing else.

      Two earlier rounds argued this both ways, and both were right about a hero whose objects
      took turns: when four panels rotate, the transcript is the only place the whole story
      exists. That hero is gone -- every object the other six sentences describe is on screen
      above, at full strength -- so the complete static state §26 asks for is the composition
      itself, and the last caption is the one written about it.
    */
    const captions = page.locator(".lv2-demo-caption");
    await expect(captions).toHaveCount(7);
    const opacities = await captions.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).opacity));
    expect(opacities.filter((value) => Number(value) > 0.05), "one caption reads, and it is the last").toHaveLength(1);
    expect(Number(opacities[opacities.length - 1]), "the caption that reads is the final beat").toBe(1);
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
    /*
      ONE `.lv2-text-link`, NOT THREE (P3 QA round 1).

      Three was written when §18's three routes were three equal terminal links in one row. D6
      replaced that with one next action and a footnote, which is §39's "one next action per
      scene" -- so the count that is honest about this scene is one, and the rules the three was
      standing in for are asserted directly underneath instead of through a class name.
    */
    await expect(scene.locator("a.lv2-text-link")).toHaveCount(1);
    await expect(scene.locator("[data-scene-next]"), "one next action").toHaveCount(1);
    for (const href of ["/security", "/trust", "/subprocessors"]) {
      await expect(scene.locator(`a[href="${href}"]`), `${href} left the trust scene`).toHaveCount(1);
    }
    /*
      Every anchor in this scene clears the touch floor, including the ones inside prose.

      C4 put the four proof labels inline in their `<p>`s and D6 did the same to the references,
      and an inline anchor is as tall as its line box: the round measured 19px at every width and
      in both locales. Contract rule 8 puts the floor on every reachable control, so it is
      measured here as well as on the phone projects -- this was not a phone defect.
    */
    const short = await scene.locator("a").evaluateAll((nodes) =>
      nodes
        .map((node) => ({ text: (node.textContent ?? "").trim().slice(0, 40), height: node.getBoundingClientRect().height }))
        .filter((row) => row.height > 0 && row.height < 43.99),
    );
    expect(short, "a link in the trust scene is under the 44px floor").toEqual([]);
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

/*
  D7 / §30: the landing's funnel, measured where it actually fires.

  `lib/funnel-events.test.ts` can see that every declared name has a call site somewhere in the
  tree; it cannot see whether a click on the hero button reaches the listener, whether the tab
  index that travels with `proof_claim_switch` is the tab that was pressed, or whether the scroll
  quartiles ever arrive. Those are facts about a delegated listener over a rendered document, so
  they are settled here.

  `trackFunnel` dispatches `tavonel:funnel` on the window with the detail it is about to send, so
  the assertion reads exactly the record the collector would receive -- including the absence of
  anything that is not an enumerated UI state.
*/
test.describe("analytics", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "1440", "one width is enough for a listener contract");
  });

  type FunnelRecord = { event: string } & Record<string, string | undefined>;

  /** Collect the funnel records a page fires, with navigation suppressed so the page survives. */
  async function watchFunnel(page: Page): Promise<() => Promise<FunnelRecord[]>> {
    await page.addInitScript(() => {
      const seen: unknown[] = [];
      (window as unknown as { __funnel: unknown[] }).__funnel = seen;
      window.addEventListener("tavonel:funnel", (event) => seen.push((event as CustomEvent).detail));
      /*
        Capture phase, so the landing's own listener on `main` (bubble phase) still runs and only
        the navigation is cancelled. Clicking a real control is the point; leaving the page in
        the middle of it would end the test rather than measure it.
      */
      document.addEventListener(
        "click",
        (event) => {
          if ((event.target as Element | null)?.closest?.("a[href]")) event.preventDefault();
        },
        true,
      );
    });
    return () => page.evaluate(() => (window as unknown as { __funnel: FunnelRecord[] }).__funnel);
  }

  test("fires the hero, proof, depth and trust events with enumerated detail only", async ({ page }) => {
    const records = await watchFunnel(page);
    await page.goto("/");

    // The hero's filled control. Both names fire: D7's position name and the legacy destination
    // one the dashboard has been reading since before this page existed.
    await page.locator("#hero a.btn.lv2-cta").click();
    expect((await records()).map((record) => record.event)).toEqual(
      expect.arrayContaining(["hero_primary_click", "hero_explore_clicked", "cta_clicked"]),
    );

    // The hero's text link, which is the access action on the default arm.
    await page.locator('#hero a.lv2-text-link[data-analytics="hero-secondary"]').click();
    expect((await records()).map((record) => record.event)).toContain("hero_secondary_click");

    // Scene 02's tabs. The detail is the tab's POSITION in its group -- never its label.
    const tabs = page.locator('#proof [role="tab"]');
    await tabs.nth(1).click();
    const switched = (await records()).filter((record) => record.event === "proof_claim_switch");
    expect(switched).toHaveLength(1);
    expect(switched[0].cta).toBe("2");

    /*
      Scene 03 is the quarter mark: nine scenes, so scene index 2 of 8 is exactly 0.25. Scrolling
      to it must produce the first quartile and no deeper one.
    */
    await page.locator("section#sources").scrollIntoViewIfNeeded();
    await expect
      .poll(async () => (await records()).map((record) => record.event))
      .toContain("scroll_scene_25");
    expect((await records()).map((record) => record.event)).not.toContain("scroll_scene_75");

    // The Trust scene's next action, routed by destination rather than by a per-link hook.
    await page.locator('#trust a[href="/trust"]').first().click();
    expect((await records()).map((record) => record.event)).toContain("trust_open");

    /*
      And the privacy rule, over every record the page produced: the allowlist is enforced in
      `lib/funnel-events.ts`, and this is the end-to-end proof that no call site on this page
      tried to attach something else. Experiments are off in CI, so no `variant` travels either.
    */
    const produced = await records();
    expect(produced.length).toBeGreaterThan(4);
    for (const record of produced) {
      for (const [key, value] of Object.entries(record)) {
        expect(["event", "cta", "scene", "from", "variant"], `${record.event} attached ${key}`).toContain(key);
        // An enumerated UI state is a word or a digit, never a sentence, a path or a digest.
        expect(String(value).length, `${record.event}.${key} is not a UI state`).toBeLessThan(32);
      }
      expect(record.variant, "no experiment is running, so no arm may be reported").toBeUndefined();
    }
  });
});
