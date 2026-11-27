import { expect, test, type Page } from "@playwright/test";
import { V34_ROUTE_KEYS, v34Route } from "../lib/v34/routes";

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
    the case the plan names -- Home's 24px 'Measured, with receipts.' (now 'Research figures, with receipts.') beside five 51.84px section
    H2s -- and it leaves a card's heading inside a section alone, because the card is not the
    section's sibling.
    Restated per role by WO-CI-20, lead decision 2: the V34 kit sets three H2 roles at three sizes,
    as the prototype does (route_preview/assets/site.css: `h2`, `.v33-bridge h2`, `.route-foot h2`):
    the Section title (`--v34-h2`), the Bridge title (`#v34-bridge-title`) and the FinalCta title
    (`#v34-final-title`). Sibling H2s OF ONE ROLE are one size; any H2 that is neither of the two ids
    is a Section H2, so a retained page's headings are held exactly as before.
  - The /ko meta line takes no capital tracking (§4.4 KO rules).

  Driven from the 1440 project at 1440 and 390, the two widths §8.2 names. /research/experiments is
  in §5.4 but serves a 404, so it is not measured (the same list as site-alignment.spec.ts).

  V34 (WO-CI-5a). A route the program moved answers 308 to its V34 page (`V34_REDIRECTS`,
  next.config.mjs), and that page is the one read. R2 is held per page by where it lands: a
  retained page is held to Display 2 as before; a page that lands on a V34 registry path
  (lib/v34/routes.ts) -- which since WO-CI-20 declares its template too, so the declaration no longer
  tells the two apart -- has its H1 held to the V34 display roles instead -- the size of one of `--v34-h1-sub` / `--v34-h1-split` as resolved on the page
  (components/v34/tokens.module.css; the Hero's sub and split variants and the article layout set
  their H1 from these), at the V34 title weight 500 and in the one face. Equal-but-wrong still
  fails: each H1 is compared to a token's resolved value, not only to its neighbours. And a template
  has ONE H1 role: V34 pages of one template that use both roles fail, and the mix is a filed defect
  (WO-CI-5a receipt, D19), not something either role excuses.
*/
/** The V34 heading weight (components/v34/ui/hero.module.css and article-layout.module.css `.title`). */
const V34_TITLE_WEIGHT = "500";
/**
 * Every V34 registry path whose body is a V34 page; a route that lands on one is held to the V34 roles.
 * /pricing is a registry path whose body is the retained pricing client, but since WO-UI-A1 its H1 is the V34
 * sub-hero's (components/pricing-page-client.tsx renders <Hero variant="sub">), so it is held to the V34 roles
 * like /contact. /evaluation is the one T2 page that is still a retained Display 2 page.
 */
const V34_PATHS: ReadonlySet<string> = new Set(V34_ROUTE_KEYS.map((key) => v34Route(key).path));

const TEMPLATES = {
  T0: ["/"],
  T1: [
    "/product", "/product/compiled-world", "/product/continuous-knowledge", "/product/document-understanding",
    "/product/knowledge-compiler", "/how-it-works", "/knowledge-compiler", "/solutions", "/solutions/ai-ready-knowledge",
    "/solutions/document-intelligence", "/solutions/knowledge-graph", "/solutions/source-grounded-assistants",
    "/solutions/knowledge-operations", "/integrations", "/demo",
  ],
  T2: ["/pricing", "/evaluation", "/contact"],
  T3: [
    "/docs", "/docs/quickstart", "/developers", "/api", "/cookbooks", "/cookbooks/documents-to-grounded-work", "/sources",
    "/changelog", "/resources", "/guide",
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
type H2Role = "Section" | "Bridge" | "FinalCta";
type Reading = {
  retiredFaces: string[];
  h1: (Signature & { text: string }) | null;
  displayTwo: Signature;
  /** The template the page root declares, or null when it declares none. */
  template: string | null;
  /** The V34 display roles (`--v34-h1-sub`, `--v34-h1-split`) resolved on this page; empty without the shell. */
  v34Roles: string[];
  h2Groups: { parent: string; items: { size: string; text: string; role: H2Role }[] }[];
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

  const site = document.querySelector("[data-v34-site]");
  const v34Roles: string[] = [];
  if (site) {
    for (const token of ["--v34-h1-sub", "--v34-h1-split"]) {
      const role = document.createElement("div");
      role.style.setProperty("position", "absolute");
      role.style.setProperty("font-size", `var(${token})`);
      site.append(role);
      v34Roles.push(getComputedStyle(role).fontSize);
      role.remove();
    }
  }

  const groups = new Map<Element | null, { size: string; text: string; role: H2Role }[]>();
  for (const heading of document.querySelectorAll("h2")) {
    if (!visible(heading)) continue;
    const parent = (heading.closest("section, article, aside") ?? heading).parentElement;
    groups.set(parent, [...(groups.get(parent) ?? []), {
      size: getComputedStyle(heading).fontSize,
      text: (heading.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 48),
      role: heading.id === "v34-final-title" ? "FinalCta" : heading.id === "v34-bridge-title" ? "Bridge" : "Section",
    }]);
  }

  /*
    FINAL-SPEC 2026-10-26: Home no longer uses `.lv2-meta`; its small label lines (the workbench status, the record's
    field names, the change panel's label, the receipt chips) are module classes. A meta line is read as what it is:
    a visible element whose own text holds Hangul and is set at 14px or less.
  */
  const meta = [...document.querySelectorAll<HTMLElement>("main *")].filter((el) => visible(el)
    && [...el.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && /[\uac00-\ud7a3]/.test(child.textContent ?? ""))
    && Number.parseFloat(getComputedStyle(el).fontSize) <= 14);
  const tracked = meta
    .map((el) => getComputedStyle(el).letterSpacing)
    .filter((spacing) => spacing !== "normal" && Number.parseFloat(spacing) !== 0);

  return {
    retiredFaces: [...retiredFaces],
    h1: h1 ? { ...signature(h1), text: (h1.textContent ?? "").trim().slice(0, 48) } : null,
    displayTwo,
    template: document.querySelector("[data-template]")?.getAttribute("data-template") ?? null,
    v34Roles,
    h2Groups: [...groups].map(([parent, items]) => ({ parent: name(parent), items })),
    koMeta: { count: meta.length, tracked },
  };
}

/** Sibling groups whose H2s of one role do not share one size, as readable lines. */
function mixedSiblings(reading: Reading): string[] {
  return reading.h2Groups.flatMap((group) => (["Section", "Bridge", "FinalCta"] as const)
    .map((role) => group.items.filter((item) => item.role === role))
    .filter((items) => items.length > 1 && new Set(items.map((item) => item.size)).size > 1)
    .map((items) => `${group.parent} (${items[0]!.role} H2s): ${items.map((item) => `${item.size} «${item.text}»`).join(" | ")}`));
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

/** Where a V34 page's H1 leaves the V34 display roles: a token size, the title weight, the one face. */
function v34Drift(readings: { route: string; h1: Signature | null; roles: string[] }[], face: string): string[] {
  const drift: string[] = [];
  for (const { route, h1, roles } of readings) {
    if (!h1) {
      drift.push(`${route}: no visible H1`);
      continue;
    }
    if (!roles.includes(h1.size)) drift.push(`${route}: H1 size ${h1.size}, expected one of the V34 roles ${roles.join(" / ") || "(no V34 shell)"}`);
    if (h1.weight !== V34_TITLE_WEIGHT) drift.push(`${route}: H1 weight ${h1.weight}, expected ${V34_TITLE_WEIGHT}`);
    if (h1.face !== face) drift.push(`${route}: H1 face ${h1.face}, expected ${face}`);
  }
  // One role per template: every V34 H1 of the template at one size.
  const bySize = new Map<string, string[]>();
  for (const { route, h1 } of readings) if (h1) bySize.set(h1.size, [...(bySize.get(h1.size) ?? []), route]);
  if (bySize.size > 1) {
    drift.push(`one H1 role per template, V34 pages use ${bySize.size}: ${[...bySize].map(([size, routes]) => `${size} (${routes.join(", ")})`).join(" / ")}`);
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
  return { ...(await page.evaluate(read)), landed: new URL(page.url()).pathname };
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
      const v34Readings: { route: string; h1: Signature | null; roles: string[] }[] = [];
      let displayTwo: Signature | undefined;
      for (const route of routes) {
        const reading = await readRoute(page, route);
        // T0 is Home's own pair; any other page that lands on a registry path is a V34 page.
        if (template === "T0" || !V34_PATHS.has(reading.landed)) readings.push({ route, h1: reading.h1 });
        else v34Readings.push({ route, h1: reading.h1, roles: reading.v34Roles });
        displayTwo ??= reading.displayTwo;
      }
      // Display 2 is the face the role names, at the token's size and decision.md G-B's 510.
      if (DISPLAY_TWO.includes(template)) {
        expect(displayTwo?.face).toBe("Wanted Sans Variable");
        expect(displayTwo?.weight).toBe("510");
        expect(displayTwo?.size).toBe(width === 1440 ? "52px" : "32px");
      }
      expect.soft(h1Drift(readings, DISPLAY_TWO.includes(template) ? displayTwo : undefined), `${template} @${width}`).toEqual([]);
      expect.soft(v34Drift(v34Readings, displayTwo?.face ?? "Wanted Sans Variable"), `${template} @${width}, V34 pages`).toEqual([]);
    });
  }
});

/*
  The failure path: each check fires on the defect it exists to catch. On Home and /evaluation, a
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

    /*
      The clean reading above already holds Home's FinalCta H2 (74.88px at 1440) beside its Section H2s:
      a role at its own size is not a defect. Two Section H2s of different sizes are: the probe is the
      first Section H2 that has a Section sibling (read() decides siblings and roles), shrunk to 24px.
    */
    const shrunk = await page.evaluate(() => {
      const sectionOf = (heading: Element) => heading.closest("section, article, aside") ?? heading;
      const isSection = (heading: Element) => heading.id !== "v34-final-title" && heading.id !== "v34-bridge-title";
      const headings = [...document.querySelectorAll("h2")].filter((heading) => heading.getBoundingClientRect().height > 1 && isSection(heading));
      const target = headings.find((heading) =>
        headings.some((other) => other !== heading && sectionOf(other).parentElement === sectionOf(heading).parentElement));
      if (!target) throw new Error("no Section H2 with a Section sibling H2 on /");
      target.setAttribute("data-type-scale-probe", "");
      return (target.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 48);
    });
    await set(page, "[data-type-scale-probe]", "font-size", "24px");
    const mixed = mixedSiblings(await page.evaluate(read));
    expect(mixed).toHaveLength(1);
    expect(mixed[0]).toContain("(Section H2s)");
    expect(mixed[0]).toContain(`24px «${shrunk}»`);

    // The rule itself, on a written reading: three roles at three sizes pass; two Section sizes fail
    // whatever the other roles do.
    const of = (items: Reading["h2Groups"][number]["items"]) => mixedSiblings({ ...clean, h2Groups: [{ parent: "main", items }] });
    expect(of([{ size: "32px", text: "a", role: "Section" }, { size: "36px", text: "b", role: "Bridge" }, { size: "26.4px", text: "c", role: "FinalCta" }])).toEqual([]);
    expect(of([{ size: "32px", text: "a", role: "Section" }, { size: "24px", text: "b", role: "Section" }, { size: "26.4px", text: "c", role: "FinalCta" }]))
      .toEqual(["main (Section H2s): 32px «a» | 24px «b»"]);

    // One element set in a retired face is reported.
    await set(page, "main h2", "font-family", "Geist, sans-serif");
    expect((await page.evaluate(read)).retiredFaces).toHaveLength(1);
  });

  test("reports an H1 that left the template's role", async ({ page }) => {
    // /evaluation is the T2 page that is still a retained Display 2 page; /pricing moved to the V34 roles (WO-UI-A1).
    const evaluation = await readRoute(page, "/evaluation");
    expect(h1Drift([{ route: "/evaluation", h1: evaluation.h1 }], evaluation.displayTwo)).toEqual([]);
    await set(page, "main h1", "font-size", "56px");
    const drifted = await page.evaluate(read);
    expect(h1Drift([{ route: "/evaluation", h1: drifted.h1 }], drifted.displayTwo)).toEqual(["/evaluation: H1 size 56px, expected 52px"]);
    // And pairwise, without the token: the same template, two different sizes.
    expect(h1Drift([{ route: "/contact", h1: evaluation.h1 }, { route: "/evaluation", h1: drifted.h1 }])).toEqual([
      "/evaluation: H1 size 56px, expected 52px",
    ]);
  });
});
