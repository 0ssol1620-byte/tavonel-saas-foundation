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

/** The hero's visual since 2026-09-20: the four locked cuts, in the site's one film player. */
const FILM = "#hero .compile-film-sequence";

/** The first cut's poster, which the player server-renders and both entry pages preload. */
const HERO_POSTER = "/film/poster-1-hero-2x.webp";

/** Every cut the strip has to be able to reach, in `COMPILE_STAGES` order. */
const CUTS = [
  "/film/compile-cut-hq.mp4",
  "/film/compile-cut-2.mp4",
  "/film/compile-cut-3.mp4",
  "/film/compile-cut-4.mp4",
] as const;

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

  /*
    FOUNDER DECISION 2026-09-20. The hero plays the four locked cuts, and §27's rule still holds.

    This asserted the opposite until today -- two committed rasters, no <video> and no <canvas> --
    because §27 bars an autoplay video from being the LCP element and §28 puts the hero in DOM and
    CSS. The founder replaced that hero with a centered statement over the films the previous
    landing played, so what is checked is the shape that keeps §27 true anyway: the element that
    paints above the fold is the poster, an <img> the player server-renders with its box declared,
    and the preload names that same file. The decoder starts later, on intersection.
  */
  test("the hero paints the film's poster first, and preloads that poster once", async ({ page }) => {
    await page.goto("/");
    /*
      Read off the SERVED document rather than the settled DOM, because the poster is the first
      frame and only the first frame.

      `CompileStagePlayer` renders the <img> while the film is out of view and swaps the decoder
      in when its IntersectionObserver fires, so on a 1440 page that mounts the film above the
      fold the element is gone within a second of load. That is the correct behaviour and it is
      also why asserting it in the browser measured a race: what the LCP measurement sees is the
      frame the server sent, and this is that frame.
    */
    const response = await page.request.get(page.url());
    const served = await response.text();
    const tag = served.match(/<img[^>]*class="compile-film-still"[^>]*>/)?.[0] ?? "";
    expect(tag, "the server sends the hero with no poster").toContain(HERO_POSTER);
    expect(tag, "the poster declares its box").toMatch(/ width="[1-9]\d*"/);
    expect(tag).toMatch(/ height="[1-9]\d*"/);
    expect(tag, "the poster is the LCP candidate").toMatch(/fetchpriority="high"/i);
    const alt = tag.match(/ alt="([^"]*)"/)?.[1] ?? "";
    expect(alt.trim().length, "the poster says what it is").toBeGreaterThan(0);
    // Contract rule 4: alt text carries no figure, because nothing in it has a receipt.
    expect(alt).not.toMatch(/\d/);
    // The bytes behind it are really there; a poster that 404s is a blank first paint.
    expect((await page.request.get(HERO_POSTER)).status(), "the poster does not resolve").toBe(200);
    // §28 still holds for everything this lane draws: no canvas anywhere on the entry page.
    await expect(page.locator("canvas")).toHaveCount(0);
    /*
      ONE preload for that file, in exactly one place -- and the place is the response header.

      F10 was written after MED-15 measured `react-dom`'s `preload()` never reaching the shipped
      HTML, and the fix it prescribed -- a real <link> element -- has its own failure: React keys
      an image preload and hoists it, so an element that also carried `href` registered under a
      second key and the document held two preloads for one file (P3 round 2, P2-2).

      What the helper does on THIS build, measured rather than assumed: React 19's Fizz sends an
      image preload as a `Link` response header whenever the hint carries no `imageSrcSet` and the
      header budget has room, and falls back to the head element when it does not. The hero's
      poster is one locked file at one size, so there is no srcset and it takes the header path --
      which is the earlier of the two forms, since it arrives with the response rather than after
      the parser reaches the head. Both places are counted, and the total has to be one.
    */
    const headerPreloads = (response.headers()["link"] ?? "")
      .split(/,(?=\s*<)/)
      .filter((entry) => /rel=preload/i.test(entry) && /as="?image"?/i.test(entry));
    const documentPreloads = served.match(/<link[^>]*rel="preload"[^>]*as="image"[^>]*>/g) ?? [];
    expect(headerPreloads.length + documentPreloads.length, "one image preload, in one place").toBe(1);
    expect([...headerPreloads, ...documentPreloads][0], "the preload is the poster the layout paints")
      .toContain(HERO_POSTER);
  });

  /*
    All four cuts are reachable, and the strip is how a reader reaches them.

    A hero that quietly fell back to the single cut the previous landing played would look correct
    in a screenshot and lose three quarters of what the founder asked for, so the tab strip is
    counted and each tab is asserted to name a stage. The sources themselves are read off the
    player's own element as it advances rather than out of the markup, in the autoplay test below.
  */
  test("offers all four locked cuts from one strip", async ({ page }) => {
    await page.goto("/");
    const tabs = page.locator(`${FILM} [role="tab"]`);
    await expect(tabs).toHaveCount(CUTS.length);
    for (const label of await tabs.allInnerTexts()) {
      expect(label.trim().length, "a stage tab with no name").toBeGreaterThan(0);
      expect(label, "a stage label states a figure").not.toMatch(/\d/);
    }
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    // One tabpanel, named by the selected tab, so the strip is a real tablist rather than buttons.
    const panel = page.locator(`${FILM} [role="tabpanel"]`);
    await expect(panel).toHaveCount(1);
    expect(await panel.getAttribute("aria-labelledby")).toBe(await tabs.first().getAttribute("id"));
  });

  /*
    §11.3 and contract rule 7: the film may not be on this page without its note.

    The cuts draw a ruled table, section-and-line labels and `.csv` sources, and this deployment
    emits none of the three -- it emits the paragraph as it was printed, the page it was read from
    and the box it sat in. The note is asserted as VISIBLE TEXT under the film rather than as a
    string in a module: a disclosure that only a test can see is not a disclosure.
  */
  for (const path of ["/", "/ko"]) {
    test(`${path} prints the directed-film note under the hero film`, async ({ page }) => {
      await page.goto(path);
      const note = page.locator("#hero .lv2-film-note");
      await expect(note).toHaveCount(1);
      await expect(note).toBeVisible();
      const text = await note.innerText();
      expect(text, "the note stops naming the .csv source").toContain(".csv");
      expect(text.trim().length, "the note is a sentence, not a label").toBeGreaterThan(80);
      const film = await page.locator(`${FILM}`).boundingBox();
      const box = await note.boundingBox();
      expect(box!.y, "the note sits under the film it qualifies").toBeGreaterThan(film!.y);
    });
  }

  /*
    Every control the film offers is reachable and clears the touch floor, at every width.

    Unlike the compiler demo this replaced, the film's controls exist on a phone too: the strip is
    the only way to reach a cut directly on a touch screen, and the motion control is WCAG 2.2.2's
    stop for an autoplay that runs well past five seconds. So this is not width-scoped.
  */
  test("gives the film a motion control and four stage tabs, all at the touch floor", async ({ page }) => {
    await page.goto("/");
    const motion = page.locator(`${FILM} .compile-film-motion-control`);
    await expect(motion).toHaveCount(1);
    await expect(motion).toBeVisible();
    // It reports its state to assistive technology and names itself in words.
    await expect(motion).toHaveAttribute("aria-pressed", /true|false/);
    expect((await motion.getAttribute("aria-label"))?.trim().length, "the control is named").toBeGreaterThan(0);
    for (const control of [motion, page.locator(`${FILM} [role="tab"]`)]) {
      const boxes = await control.evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect()).map((box) => ({ w: box.width, h: box.height })),
      );
      expect(boxes.length).toBeGreaterThan(0);
      for (const box of boxes) {
        expect(box.h, "44px touch floor").toBeGreaterThanOrEqual(44);
        expect(box.w, "44px touch floor").toBeGreaterThanOrEqual(44);
      }
    }
  });

  for (const path of ["/", "/ko"]) {
    test(`${path} prints no figure outside an element that declares it was measured`, async ({ page }) => {
      await page.goto(path);
      expect(await undeclaredFigures(page), "a digit with no receipt (contract rule 4)").toEqual([]);
    });
  }

  /*
    §39's "text overlap 0", over the hero as it is now.

    This used to sweep every pair of blocks in the compiler demo's grid, because the composition
    before it positioned seven panels as percentages of a fixed box and four pairs intersected at
    1440. The hero is a centered block over a film frame now, so what can still collide is the
    statement and the frame under it -- and the Korean block, which is taller, is the one that
    would do it first. Both locales, every width, measured rather than screenshotted.
  */
  for (const path of ["/", "/ko"]) {
    test(`${path} keeps the hero statement clear of the film under it`, async ({ page }) => {
      await page.goto(path);
      const text = await page.locator("#hero .lv2-hero-text").boundingBox();
      const film = await page.locator(FILM).boundingBox();
      expect(text && film).toBeTruthy();
      expect(Math.round(film!.y), "the film overlaps the statement above it")
        .toBeGreaterThanOrEqual(Math.round(text!.y + text!.height));
    });
  }

  /*
    The hero's own elements, and then every image on the page.

    §2.5's rule for the hero is one H1, one to two sentences of support, one visual, one primary
    action and one secondary. That is what is counted here -- the centered block's five parts and
    the one visual under it -- because the defect the founder named was a hero with more than one
    of each.
  */
  for (const path of ["/", "/ko"]) {
    test(`${path} shows one statement and one visual, and no more`, async ({ page }) => {
      await page.goto(path);
      const hero = page.locator("section#hero");
      await expect(hero.locator("h1")).toHaveCount(1);
      await expect(hero.locator(".lv2-hero-support")).toHaveCount(1);
      await expect(hero.locator(".lv2-hero-intake")).toHaveCount(1);
      await expect(hero.locator(".lv2-eyebrow")).toHaveCount(1);
      await expect(hero.locator(".compile-film-sequence")).toHaveCount(1);
      /*
        One visual: the film's frame, and no second picture competing with it. Counted as "no
        image that is not the film's own poster", because the poster is swapped for the decoder
        once the film is in view -- so a fixed count of 1 is a race, and a count of 0 would let a
        second raster back in.
      */
      await expect(hero.locator("img:not(.compile-film-still)")).toHaveCount(0);
      expect(await hero.locator("img").count(), "a second picture competes with the film")
        .toBeLessThanOrEqual(1);
      /*
        And the block really is centered, measured from paint. `text-align` is inherited by five
        children from one wrapper, so reading the wrapper is reading the decision.
      */
      const centered = await hero.locator(".lv2-hero-text").evaluate((node) => {
        const style = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        const parent = node.parentElement!.getBoundingClientRect();
        return {
          align: style.textAlign,
          left: box.left - parent.left,
          right: parent.right - box.right,
        };
      });
      expect(centered.align).toBe("center");
      expect(Math.abs(centered.left - centered.right), "the statement is not centered in its wrap")
        .toBeLessThanOrEqual(2);
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
  The hero at the width it is drawn against, as the founder's 2026-09-20 decision sets it.

  One centered block on a 760px measure inside the 1296 wrap, then the film frame under it. §32's
  42:58 split and its 600px text track went with the compiler demo; what replaced them is the
  pattern the competitor captures in `reports/landing-v2-0919/compare/` all use, and the numbers
  below are that pattern's: the block is centered to within a pixel, it ends high enough that the
  film's top third is above the fold, and the whole hero stays inside 1.3 viewports.
*/
test.describe("at 1440", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "1440", "the 1440 grid");
  });

  test("centers the statement on the shared measure and puts the film under it", async ({ page }) => {
    await page.goto("/");
    const text = await page.locator(".lv2-hero-text").boundingBox();
    const film = await page.locator("#hero .compile-film-viewport").boundingBox();
    expect(text && film).toBeTruthy();
    // C1: a 760 measure, centered in the 1296 wrap (72px gutters at >=1440).
    expect(Math.round(text!.width), "the statement's measure").toBeLessThanOrEqual(760);
    expect(Math.round(text!.x + text!.width / 2), "the statement is off centre").toBe(720);
    expect(Math.round(film!.x + film!.width / 2), "the film is off centre").toBe(720);
    /*
      C2: the film PANE is capped at 1120 and never reaches outside the wrap. The pane is the
      frame that holds the recording -- the tab strip, the caption and the directed-film note are
      siblings of it, and the note is deliberately set on its own longer measure, so measuring the
      block that contains all four would be measuring the note's line length.
    */
    expect(Math.round(film!.width), "the film pane is wider than its cap").toBeLessThanOrEqual(1120);
    expect(Math.round(film!.x), "the film reaches outside the wrap").toBeGreaterThanOrEqual(72);
    // The wordmark shares the wrap's left edge (D9), which is what the measure is drawn against.
    const wordmark = await page.locator("header.nav .wordmark").boundingBox();
    expect(Math.round(wordmark!.x)).toBe(72);
  });

  /*
    C1's vertical rhythm and C6's height bound, in both languages.

    The statement has to end high enough that the film's top third is above the fold -- that is
    what makes the first screen a sentence and a picture rather than a sentence -- and the hero as
    a whole has to stay inside 1.3 viewports so the page below it is still reachable by scrolling
    rather than by scrolling twice. The Korean block is the taller of the two and is measured at
    the same bounds rather than at relaxed ones.
  */
  for (const path of ["/", "/ko"]) {
    test(`${path} lands the statement above the fold and the hero inside 1.3 viewports`, async ({ page }) => {
      await page.goto(path);
      const viewport = page.viewportSize()!.height;
      const text = await page.locator(".lv2-hero-text").boundingBox();
      expect(Math.round(text!.y + text!.height), "the statement runs past C1's y=560")
        .toBeLessThanOrEqual(600);
      const film = await page.locator(FILM).boundingBox();
      expect(film!.y, "the film starts below the fold").toBeLessThan(viewport);
      expect(film!.y + film!.height / 3, "less than the film's top third is above the fold")
        .toBeLessThanOrEqual(viewport);
      const hero = await page.locator("section#hero").boundingBox();
      expect(Math.round(hero!.height), `hero ${hero!.height}px against a ${viewport}px viewport`)
        .toBeLessThanOrEqual(Math.round(viewport * 1.3));
    });
  }

  /*
    §23's other half: an autoplay loop does not run for a reader who has scrolled past it.

    `CompileStagePlayer` holds an IntersectionObserver over its own frame and, once the frame
    leaves the viewport, does something stronger than pausing: it renders the poster again and
    UNMOUNTS the decoder, so a reader two viewports down is not paying for a video element at all.
    That is why this counts the element rather than reading `paused` on it -- polling a detached
    node measures nothing, and "no decoder" is the guarantee worth pinning.
  */
  test("closes the film once the hero is off screen, and restarts it on return", async ({ page }) => {
    await page.goto("/");
    const video = page.locator(`${FILM} video`);
    await expect(video).toHaveCount(1);
    await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(false);
    await page.evaluate(() => window.scrollTo(0, window.innerHeight * 3));
    await expect(video, "the decoder outlives the hero").toHaveCount(0);
    await expect(page.locator("#hero img.compile-film-still"), "no poster in the closed frame")
      .toHaveCount(1);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(video).toHaveCount(1);
    await expect
      .poll(() => video.evaluate((node: HTMLVideoElement) => node.paused), { timeout: 10_000 })
      .toBe(false);
  });

  /*
    The strip really changes the cut, and it does it without tearing down the decoder.

    BQ-130: swapping <source> children of a live element does nothing, so the four cuts once
    shared a frame that only ever played the first one; keying the element per stage fixed that
    and aborted the fetch in flight on every advance. `src` on the element itself does both, and
    this is what says so from the browser rather than from the source.
  */
  test("changes the cut when a stage is chosen, on one decoder", async ({ page }) => {
    await page.goto("/");
    const video = page.locator(`${FILM} video`);
    const first = await video.evaluate((node: HTMLVideoElement) => node.currentSrc);
    expect(CUTS.some((cut) => first.endsWith(cut)), `${first} is not one of the locked cuts`).toBe(true);
    await page.locator(`${FILM} [role="tab"]`).nth(2).click();
    await expect
      .poll(() => video.evaluate((node: HTMLVideoElement) => node.currentSrc), { timeout: 10_000 })
      .not.toBe(first);
    const second = await video.evaluate((node: HTMLVideoElement) => node.currentSrc);
    expect(CUTS.some((cut) => second.endsWith(cut)), `${second} is not one of the locked cuts`).toBe(true);
    // Still one decoder: the element survived the change rather than being remounted.
    await expect(page.locator(`${FILM} video`)).toHaveCount(1);
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
  The phone hero (§25, contract rule 12). The same two parts, stacked, at the viewport's measure.

  There is no separate phone composition to check any more -- the desktop hero is already one
  column -- so what a phone needs checking for is what a phone breaks: the film pane taking the
  full width instead of a desktop cap, every reachable control still at 44px and inside the
  viewport, and the whole hero inside 1.5 viewports so the page below it is one scroll away.
*/
test.describe("at 390", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "390", "the phone composition");
  });

  test("stacks the statement over a full-width film, inside 1.5 viewports", async ({ page }) => {
    await page.goto("/");
    const text = await page.locator("#hero .lv2-hero-text").boundingBox();
    const film = await page.locator(FILM).boundingBox();
    expect(text && film).toBeTruthy();
    expect(Math.round(film!.y), "the film overlaps the statement")
      .toBeGreaterThanOrEqual(Math.round(text!.y + text!.height));
    // The pane takes the wrap rather than a desktop cap, and stays inside the viewport.
    expect(film!.width, "the film is narrower than the phone's wrap").toBeGreaterThan(320);
    expect(Math.round(film!.x + film!.width), "the film reaches past the viewport").toBeLessThanOrEqual(390);
    const viewport = page.viewportSize()!.height;
    const hero = await page.locator("section#hero").boundingBox();
    expect(Math.round(hero!.height), `hero ${hero!.height}px against a ${viewport}px viewport`)
      .toBeLessThanOrEqual(Math.round(viewport * 1.5));
    /*
      Every REACHABLE control clears the touch floor and sits inside the viewport.

      "Reachable" is the word the contract uses and `getClientRects()` is the browser's own answer
      to it: empty for a `display: none` subtree and for a `[hidden]` tab panel, non-empty for
      everything a pointer or a keyboard can hit. Nothing here is filtered by class name, so a
      control that becomes visible is measured on the run it becomes visible.
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
  Reduced motion (§26, contract rule 8): nothing plays by itself, and the reader is not shown an
  empty frame instead. The film holds its poster, the stage labels and the caption are still
  there, and the control is present and says "play" -- the preference bars AUTOplay, not play, so
  a reader who asks for it gets the film rather than a permanently frozen picture.
*/
test.describe("with reduced motion", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "reduced-motion", "the reduced-motion gate");
    /*
      THE PROJECT SETS `reducedMotion: "reduce"` AND IT DOES NOT ARRIVE. Emulate it on the page.

      `playwright.config.ts` declares the option on this project's context, which is the documented
      way, and in this installation of @playwright/test 1.62.0 the page still reports
      `prefers-reduced-motion: no-preference`. Round 2 opened the same build with the raw
      `playwright` library under `reducedMotion: "reduce"` and every assertion passed, while the
      same assertions under the test runner failed on the first -- the component's own
      `matchMedia` read the query correctly and was told there was no preference. So this gate was
      green over a product that had never been put in the state it gates. `emulateMedia` sets the
      emulation per page instead of per context and is idempotent with the project option, so it
      is correct whether or not the installation is ever repaired -- and repairing it means
      changing a dependency, which rule 1 of this campaign forbids outright.
    */
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("holds the poster, keeps the control, and starts nothing by itself", async ({ page }) => {
    await page.goto("/");
    // The still, not the decoder: no <video> is mounted at all until a reader asks for one.
    const poster = page.locator("#hero img.compile-film-still");
    await expect(poster).toBeVisible();
    expect(await poster.getAttribute("src")).toBe(HERO_POSTER);
    await expect(page.locator(`${FILM} video`)).toHaveCount(0);
    /*
      The control is present in the one state that most needs it, and it offers PLAY.

      film-01: the button used to be rendered only when reduced motion was off, which inverted it
      -- the two states where a still stands in for an unstarted film were the two with no way to
      start it. WCAG 2.2.2 allows a visitor-initiated play; the preference bars autoplay.
    */
    const control = page.locator(`${FILM} .compile-film-motion-control`);
    await expect(control).toBeVisible();
    await expect(control).toHaveAttribute("data-control", "play");
    // And the film's own words are still on the page: the four stage labels and the caption.
    await expect(page.locator(`${FILM} [role="tab"]`)).toHaveCount(CUTS.length);
    const caption = page.locator(`${FILM} .compile-film-caption p`);
    await expect(caption).toBeVisible();
    expect((await caption.innerText()).trim().length, "the caption is empty").toBeGreaterThan(0);
    // The statement under it is unchanged: reduced motion removes movement, not content.
    await expect(page.locator("#hero .lv2-hero-text h1")).toBeVisible();
    await expect(page.locator("#hero .lv2-film-note")).toBeVisible();
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
