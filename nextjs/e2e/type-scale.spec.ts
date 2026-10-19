import { expect, test, type Page } from "@playwright/test";

/*
  UX-L3 (lane P2-05): one face, one type scale, one section head, read off the browser.
  UX-PLAN-2026-10-17 §4.4 (type scale), §5.3 rules R2 and R3, §8.2 (UX-L3 acceptance).

  - One face. decision.md G-B chose Wanted Sans Variable; the layout also loaded Geist (the root
    --f-sans) and Instrument Serif, so /knowledge-compiler, /reproducibility, /explore and /login
    rendered Geist. No element on a public route may compute a Geist or Instrument Serif family, and
    no such @font-face may be registered at all.
  - R2. One H1 role per template, so routes of one template compute the same H1 size, weight and
    face. T1-T5 are all Display 2 (--tv-fs-h1, weight 510), so each of them is held to the token's
    resolved value rather than only to its neighbours: equal-but-wrong would pass a pairwise check.
    T0 (Home, Display 1) is its own pair, / and /ko.
  - R3. Sibling H2s on a page are one size. Siblings are the headings of sections that share a
    parent: an H2's section is its nearest <section>, <article> or <aside> (or the H2 itself when it
    has none), and two H2s are siblings when those sections are children of one element. That is
    the case the plan names -- Home's 24px 'Measured, with receipts.' beside five 51.84px section
    H2s -- and it leaves a card's heading inside a section alone, because the card is not the
    section's sibling.
  - The /ko meta line takes no capital tracking (§4.4 KO rules).

  Driven from the 1440 project at 1440 and 390, the two widths §8.2 names. /research/experiments is
  in §5.4 but serves a 404, so it is not measured (the same list as site-alignment.spec.ts).
*/

const TEMPLATES = {
  T0: ["/", "/ko"],
  T1: [
    "/product", "/product/compiled-world", "/product/continuous-knowledge", "/product/document-understanding",
    "/product/knowledge-compiler", "/how-it-works", "/knowledge-compiler", "/solutions", "/solutions/ai-ready-knowledge",
    "/solutions/document-intelligence", "/solutions/knowledge-graph", "/solutions/source-grounded-assistants",
    "/solutions/knowledge-operations", "/integrations", "/demo",
  ],
  T2: ["/pricing", "/ko/pricing", "/evaluation", "/ko/evaluation", "/contact", "/ko/contact"],
  T3: [
    "/docs", "/docs/quickstart", "/developers", "/api", "/cookbooks", "/cookbooks/documents-to-grounded-work", "/sources",
    "/changelog", "/resources", "/guide", "/ko/guide",
  ],
  T4: ["/explore"],
  T5: [
    "/trust", "/security", "/enterprise", "/status", "/evidence", "/benchmarks", "/benchmarks/gdp-pdf", "/research",
    "/research/notes", "/reproducibility", "/privacy", "/terms", "/refunds", "/subprocessors",
  ],
} as const;
type Template = keyof typeof TEMPLATES;
const DISPLAY_TWO: readonly Template[] = ["T1", "T2", "T3", "T4", "T5"];
// /login is T6 (an app surface, no H1 role here) but it is public, so it is held to the one face.
const PUBLIC_ROUTES = [...Object.values(TEMPLATES).flat(), "/login"];

const WIDTHS = [1440, 390] as const;
const viewportOf = (width: number) => ({ width, height: width <= 390 ? 844 : 900 });

type Signature = { size: string; weight: string; variation: string; face: string };
type Reading = {
  retiredFaces: string[];
  h1: (Signature & { text: string }) | null;
  displayTwo: Signature;
  h2Groups: { parent: string; items: { size: string; text: string }[] }[];
  koMeta: { count: number; tracked: string[] };
};

/** Runs in the page; self-contained because Playwright serialises it. */
function read(): Reading {
  const retired = /geist|instrument serif/i;
  const visible = (el: Element) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width > 1 && box.height > 1 && style.visibility !== "hidden" && style.display !== "none";
  };
  const name = (el: Element | null) => {
    if (!el) return "null";
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "";
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls ? `.${cls}` : ""}`;
  };
  const signature = (el: Element): Signature => {
    const style = getComputedStyle(el);
    return {
      size: style.fontSize,
      weight: style.fontWeight,
      variation: style.fontVariationSettings,
      face: style.fontFamily.split(",")[0]!.trim().replace(/^["']|["']$/g, ""),
    };
  };

  const retiredFaces = new Set<string>();
  for (const el of [document.documentElement, ...document.querySelectorAll("*")]) {
    const family = getComputedStyle(el).fontFamily;
    if (retired.test(family)) retiredFaces.add(`${name(el)}: ${family.slice(0, 80)}`);
  }
  for (const face of document.fonts) if (retired.test(face.family)) retiredFaces.add(`@font-face ${face.family}`);

  const h1 = [...document.querySelectorAll("h1")].find(visible) ?? null;

  // The token's resolved value, measured the way the H1 is: an element that reads only the role.
  const probe = document.createElement("div");
  probe.textContent = "Display 2";
  for (const [property, value] of [
    ["position", "absolute"], ["left", "-9999px"], ["font-family", "var(--f-sans)"], ["font-size", "var(--tv-fs-h1)"],
    ["font-weight", "var(--tv-w-title)"], ["font-variation-settings", "\"wght\" var(--tv-w-title)"],
  ]) probe.style.setProperty(property, value);
  document.body.append(probe);
  const displayTwo = signature(probe);
  probe.remove();

  const groups = new Map<Element | null, { size: string; text: string }[]>();
  for (const heading of document.querySelectorAll("h2")) {
    if (!visible(heading)) continue;
    const parent = (heading.closest("section, article, aside") ?? heading).parentElement;
    groups.set(parent, [...(groups.get(parent) ?? []), {
      size: getComputedStyle(heading).fontSize,
      text: (heading.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 48),
    }]);
  }

  const meta = [...document.querySelectorAll("main .lv2-meta")].filter(visible);
  const tracked = meta
    .map((el) => getComputedStyle(el).letterSpacing)
    .filter((spacing) => spacing !== "normal" && Number.parseFloat(spacing) !== 0);

  return {
    retiredFaces: [...retiredFaces],
    h1: h1 ? { ...signature(h1), text: (h1.textContent ?? "").trim().slice(0, 48) } : null,
    displayTwo,
    h2Groups: [...groups].map(([parent, items]) => ({ parent: name(parent), items })),
    koMeta: { count: meta.length, tracked },
  };
}

/** Sibling groups whose H2s do not share one size, as readable lines. */
function mixedSiblings(reading: Reading): string[] {
  return reading.h2Groups
    .filter((group) => group.items.length > 1 && new Set(group.items.map((item) => item.size)).size > 1)
    .map((group) => `${group.parent}: ${group.items.map((item) => `${item.size} «${item.text}»`).join(" | ")}`);
}

/** Where a set of H1 signatures differs from the first one (or from `expected`). */
function h1Drift(readings: { route: string; h1: Signature | null }[], expected?: Signature): string[] {
  const reference = expected ?? readings[0]?.h1 ?? null;
  const drift: string[] = [];
  for (const { route, h1 } of readings) {
    if (!h1 || !reference) {
      drift.push(`${route}: no visible H1`);
      continue;
    }
    for (const key of ["size", "weight", "variation", "face"] as const) {
      if (h1[key] !== reference[key]) drift.push(`${route}: H1 ${key} ${h1[key]}, expected ${reference[key]}`);
    }
  }
  return drift;
}

async function seedRefusal(page: Page) {
  // Not a consent spec: a stored refusal keeps the optional-analytics card out of the reading.
  await page.addInitScript(() =>
    localStorage.setItem("tavonel.analytics-consent.v1", JSON.stringify({ allowed: false, expires: Date.now() + 86_400_000 })),
  );
}

async function readRoute(page: Page, route: string) {
  const response = await page.goto(route);
  expect(response?.status(), `${route} answers`).toBeLessThan(400);
  return page.evaluate(read);
}

for (const width of WIDTHS) test.describe(`type scale (UX-L3) at ${width}`, () => {
  test.use({ viewport: viewportOf(width) });
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "1440", "drives 1440 and 390 from the 1440 project");
    await seedRefusal(page);
  });

  for (const route of PUBLIC_ROUTES) {
    test(`${route}: one face, and sibling H2s share one size`, async ({ page }) => {
      const reading = await readRoute(page, route);
      expect.soft(reading.retiredFaces, `${route} @${width} computes a retired face`).toEqual([]);
      expect.soft(mixedSiblings(reading), `${route} @${width}: sibling H2s of different sizes`).toEqual([]);
    });
  }

  for (const [template, routes] of Object.entries(TEMPLATES) as [Template, readonly string[]][]) {
    test(`${template}: every route computes the same H1`, async ({ page }) => {
      const readings: { route: string; h1: Signature | null }[] = [];
      let displayTwo: Signature | undefined;
      for (const route of routes) {
        const reading = await readRoute(page, route);
        readings.push({ route, h1: reading.h1 });
        displayTwo ??= reading.displayTwo;
      }
      // Display 2 is the face the role names, at the token's size and decision.md G-B's 510.
      if (DISPLAY_TWO.includes(template)) {
        expect(displayTwo?.face).toBe("Wanted Sans Variable");
        expect(displayTwo?.weight).toBe("510");
        expect(displayTwo?.size).toBe(width === 1440 ? "52px" : "32px");
      }
      expect(h1Drift(readings, DISPLAY_TWO.includes(template) ? displayTwo : undefined), `${template} @${width}`).toEqual([]);
    });
  }

  test("/ko: the meta line takes no capital tracking", async ({ page }) => {
    const reading = await readRoute(page, "/ko");
    expect(reading.koMeta.count, "the /ko page renders meta lines").toBeGreaterThan(0);
    expect(reading.koMeta.tracked, "tracked .lv2-meta on /ko").toEqual([]);
  });
});

/*
  The failure path: each check fires on the defect it exists to catch. On Home and /pricing, a
  sibling H2 shrunk back to 24px, one element set in Geist, and one H1 set at the old 56px are each
  injected and must each be reported. A reading that cannot fail proves nothing.
*/
test.describe("the type-scale detector", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "1440", "one width is enough to prove the detector");
    await seedRefusal(page);
  });

  // The CSP forbids injected <style>; CSSOM writes are not stylesheets and are allowed.
  const set = (page: Page, selector: string, property: string, value: string) =>
    page.evaluate(([s, p, v]) => {
      const el = document.querySelector<HTMLElement>(s);
      if (!el) throw new Error(`no ${s}`);
      el.style.setProperty(p, v, "important");
    }, [selector, property, value] as const);

  test("reports mixed sibling H2s and a retired face", async ({ page }) => {
    const clean = await readRoute(page, "/");
    expect(mixedSiblings(clean)).toEqual([]);
    expect(clean.retiredFaces).toEqual([]);

    await set(page, "#home-measures-title", "font-size", "24px");
    const mixed = mixedSiblings(await page.evaluate(read));
    expect(mixed).toHaveLength(1);
    expect(mixed[0]).toContain("24px «Measured, with receipts.»");

    await set(page, "#s2 .lv2-scene-support", "font-family", "Geist, sans-serif");
    expect((await page.evaluate(read)).retiredFaces).toHaveLength(1);
  });

  test("reports an H1 that left the template's role", async ({ page }) => {
    const pricing = await readRoute(page, "/pricing");
    expect(h1Drift([{ route: "/pricing", h1: pricing.h1 }], pricing.displayTwo)).toEqual([]);
    await set(page, "main h1", "font-size", "56px");
    const drifted = await page.evaluate(read);
    expect(h1Drift([{ route: "/pricing", h1: drifted.h1 }], drifted.displayTwo)).toEqual(["/pricing: H1 size 56px, expected 52px"]);
    // And pairwise, without the token: the same template, two different sizes.
    expect(h1Drift([{ route: "/contact", h1: pricing.h1 }, { route: "/pricing", h1: drifted.h1 }])).toEqual([
      "/pricing: H1 size 56px, expected 52px",
    ]);
  });
});
