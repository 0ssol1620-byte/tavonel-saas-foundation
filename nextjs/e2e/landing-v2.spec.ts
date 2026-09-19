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

/** §9's nine scenes, in order, with the `data-scene` index each one carries. */
const SCENES = ["hero", "proof", "sources", "evidence", "recompile", "why", "use", "trust", "start"] as const;

/** D5: the H1 is this string and no other, rendered from `BRAND_LINE.headline`. */
const HEADLINE = "AI-ready knowledge. Traceable to every source.";

const DEMO = ".lv2-demo";

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

  test("the H1 is the brand line, set as one heading in at most 2.2 lines", async ({ page }) => {
    await page.goto("/");
    const h1 = page.locator("h1#lv2-hero-title");
    await expect(h1).toHaveCount(1);
    expect((await h1.innerText()).replace(/\s+/g, " ").trim()).toBe(HEADLINE);
    /*
      §6's hard cap, measured rather than asserted. The headline sets as two blocks, one sentence
      each, so three lines here means one of them wrapped -- the failure this bound exists to
      catch.
    */
    expect(await headlineLines(page), "the hero headline is capped at 2.2 lines").toBeLessThanOrEqual(2.2);
    // D3: the editorial serif carries one phrase of it, and only on the English page.
    await expect(h1.locator("em.lv2-serif")).toHaveCount(1);
    await page.goto("/ko");
    await expect(page.locator("h1#lv2-hero-title em")).toHaveCount(0);
  });

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

  test("the hero paints a real source raster and no video anywhere on the page", async ({ page }) => {
    await page.goto("/");
    const raster = page.locator("section#hero img.lv2-page-img");
    await expect(raster).toHaveCount(1);
    // A committed derivative, sized by the element so the page cannot shift when it decodes.
    expect(await raster.getAttribute("src")).toMatch(/^\/landing\/v2\/.+\.webp$/);
    expect(await raster.getAttribute("srcset")).toContain("w");
    expect(Number(await raster.getAttribute("width"))).toBeGreaterThan(0);
    expect(Number(await raster.getAttribute("height"))).toBeGreaterThan(0);
    expect(await raster.evaluate((node: HTMLImageElement) => node.naturalWidth), "the raster decoded")
      .toBeGreaterThan(0);
    // §27: no autoplay video is the LCP element, because there is no video at all.
    await expect(page.locator("video")).toHaveCount(0);
    await expect(page.locator("canvas")).toHaveCount(0);
    // And the resource the layout paints is the one the document preloads.
    const preloaded = await page
      .locator('link[rel="preload"][as="image"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("imagesrcset")));
    expect(preloaded, "the hero raster is preloaded by its own srcset").toContain(await raster.getAttribute("srcset"));
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
  The §32 composition, at the width it is drawn against.

  Text 520, gap 68, visual 708 inside a 1296 measure: the text column starts on the wrap's left
  edge and the visual ends on its right one. The ratio is what §32 asks for (42 : 58); the
  absolute numbers follow from it and from the gutter the header shares.
*/
test.describe("at 1440", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "1440", "the 1440 grid");
  });

  test("lays the hero out 42 : 58 on the shared measure", async ({ page }) => {
    await page.goto("/");
    const text = await page.locator(".lv2-hero-text").boundingBox();
    const demo = await page.locator(DEMO).boundingBox();
    expect(text && demo).toBeTruthy();
    expect(Math.round(text!.x), "the text column starts on the wrap's left edge").toBe(72);
    expect(Math.round(text!.width), "§32 text width").toBe(520);
    expect(Math.round(demo!.x), "§32 visual left edge").toBe(660);
    expect(Math.round(demo!.width), "§32 visual width").toBe(708);
    // The wordmark shares that left edge (D9), which is the whole point of the measure.
    const wordmark = await page.locator("header.nav .wordmark").boundingBox();
    expect(Math.round(wordmark!.x)).toBe(72);
  });

  /*
    §39: "text overlap 0", measured instead of screenshotted.

    The first hero composition positioned its seven panels as percentages of a fixed box, which
    is a technique that cannot know how tall its own content is: four pairs intersected at 1440,
    the worst of them 216x89, and the §4.1 label that says which node a relation leaves was
    entirely behind the revision panel. The panels are a grid now and a grid cannot overlap --
    this is what says so on every run, and what will catch the next percentage someone reaches
    for. Both locales, because the Korean labels are longer and the arrangement is the same.
  */
  for (const path of ["/", "/ko"]) {
    test(`${path} lays the hero demo out with nothing on top of anything else`, async ({ page }) => {
      await page.goto(path);
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
      expect(collisions, "panels of the hero demo intersect").toEqual([]);
    });
  }

  /*
    Two things a reader has to be able to finish reading, both of which the overlap was hiding.

    The origin of each relation (`entity-node.tsx`: the candidate set is widened to the filing's
    edges, so a row that does not say which node it leaves reads as the compiled claim's own),
    and the noun over the four comparison figures -- contract rule 4's "shown with what they
    count", which four state words alone do not satisfy.
  */
  test("states each relation's origin and what the four figures count", async ({ page }) => {
    await page.goto("/");
    const vias = page.locator(".lv2-node-via");
    expect(await vias.count(), "every object row names the node its relation leaves").toBeGreaterThan(0);
    expect(await vias.count()).toBe(await page.locator(".lv2-node").count());
    for (const text of await vias.allInnerTexts()) expect(text.trim().length).toBeGreaterThan(0);
    await expect(vias.first()).toBeVisible();

    const title = page.locator(".lv2-counts-title");
    await expect(title).toHaveCount(1);
    await expect(title).toBeVisible();
    // A noun, not a figure: the label says what is counted and never states a count itself.
    expect((await title.innerText()).trim()).not.toMatch(/\d/);
    const list = page.locator(".lv2-counts-list");
    expect(await list.getAttribute("aria-labelledby")).toBe(await title.getAttribute("id"));
  });

  test("runs the signature interaction from the keyboard", async ({ page }) => {
    await page.goto("/");
    const claim = page.locator(".lv2-claim");
    await expect(claim).toHaveCount(1);
    const region = page.locator(".lv2-region");
    await expect(region).toHaveCount(1);
    await claim.focus();
    /*
      §4.1. Focusing the compiled object rings the region it was read from and draws the line to
      it in full. Measured from paint, because the CSS does this with `:has()` and the attribute
      the JavaScript fallback writes -- and which of the two ran is not the thing under test.
    */
    await expect(region).toHaveCSS("outline-width", "2px");
    const drawn = await page.locator(".lv2-line").first().evaluate((node) => getComputedStyle(node).transform);
    expect(["none", "matrix(1, 0, 0, 1, 0, 0)"], "the evidence line is drawn in full while the claim is focused")
      .toContain(drawn);
    // And the label naming the region is on the page, in the source colour, with its unit stated.
    await expect(page.locator(".lv2-region-label")).toContainText("SOURCE ·");
    await expect(page.locator(".lv2-src-unit")).toContainText("per mille");
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
    expect(order.slice(0, 4)).toEqual(["lv2-src", "lv2-line", "lv2-claim", "lv2-nodes"]);
    // Every reachable control clears the touch floor and sits inside the viewport.
    const boxes = await page.locator("main a[href], main button").evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return { height: box.height, right: box.right, left: box.left };
      }),
    );
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
      finished frame. So the claim, the region, the counts and the answer are all on screen.
    */
    for (const selector of [".lv2-src", ".lv2-region", ".lv2-claim", ".lv2-nodes", ".lv2-revision", ".lv2-counts", ".lv2-ask"]) {
      await expect(page.locator(selector).first(), `${selector} is in the composed state`).toBeVisible();
    }
    // All eight beat captions are readable at once, as a list rather than as a stack of one.
    const captions = page.locator(".lv2-demo-caption");
    await expect(captions).toHaveCount(8);
    const opacities = await captions.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).opacity));
    expect(new Set(opacities), "every beat is legible under reduced motion").toEqual(new Set(["1"]));
    // And the document is not tilted: §22's perspective is a motion-adjacent flourish.
    expect(await page.locator(".lv2-page").evaluate((node) => getComputedStyle(node).transform)).toBe("none");
  });
});
