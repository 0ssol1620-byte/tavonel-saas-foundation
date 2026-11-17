import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PUBLIC_CORPUS_PATH, PUBLIC_CORPUS_SHA256, PUBLIC_CORPUS_SRI } from "../lib/v34/public-corpus";

/*
  V34 Home (WO-CI-5b). What the Landing V2 Home specs promised and V34 Home must still keep, written against the
  V34 page and its data attributes. The first two replace the layout promises of landing-v2, hero-home-responsive,
  evidence-first and production-hardening (a hero that holds its title, actions and art at every width; bands that
  butt against one another, none collapsed and none an ocean). The third replaces home-measures: the figures the page
  prints are the ones in the hash-verified corpus the server serves, not typed numbers.
*/

const HERO = '[aria-labelledby="v34-title"]';
const count = (n: number) => n.toLocaleString("en-US");

test("the hero keeps its title, actions and art inside the viewport at every width", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const g = await page.evaluate((hero) => {
    const box = (selector: string) => {
      const node = document.querySelector(`${hero} ${selector}`) ?? document.querySelector(selector);
      if (!node) throw new Error(`missing Home element: ${selector}`);
      return node.getBoundingClientRect().toJSON() as DOMRect;
    };
    return {
      width: innerWidth, height: innerHeight,
      overflow: document.documentElement.scrollWidth - innerWidth,
      h1: box("h1"), primary: box('[data-analytics="hero-primary"]'), secondary: box('[data-analytics="hero-secondary"]'),
      art: box("[data-world-instrument]"),
      h1Count: document.querySelectorAll("h1").length,
    };
  }, HERO);
  await testInfo.attach("hero-geometry", { body: JSON.stringify(g, null, 2), contentType: "application/json" });
  expect(g.h1Count, "one h1").toBe(1);
  expect(g.overflow, "no horizontal overflow").toBeLessThanOrEqual(1);
  for (const [name, rect] of Object.entries({ h1: g.h1, primary: g.primary, secondary: g.secondary, art: g.art })) {
    expect(rect.left, `${name} left edge`).toBeGreaterThanOrEqual(-1);
    expect(rect.right, `${name} right edge`).toBeLessThanOrEqual(g.width + 1);
  }
  // Order: the title, then the actions; both start on the first screen.
  expect(g.primary.top, "the primary action follows the title").toBeGreaterThanOrEqual(g.h1.bottom - 1);
  expect(g.h1.top, "the title starts on the first screen").toBeLessThan(g.height);
  expect(g.primary.top, "the primary action starts on the first screen").toBeLessThan(g.height);
  // Targets: the primary action is a thumb target.
  expect(g.primary.height, "primary action height").toBeGreaterThanOrEqual(44);
  if (g.width >= 1440) expect(g.primary.bottom, "the actions fit the first screen at 1440").toBeLessThanOrEqual(g.height);
});

test("the bands of Home butt against one another, none collapsed and none an ocean", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "1440", "measured at 1440x900");
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const bands = await page.evaluate(() =>
    [...document.querySelectorAll("main section")]
      .filter(section => !section.parentElement!.closest("main section"))
      .map(section => {
        const rect = section.getBoundingClientRect();
        return { id: section.id || section.getAttribute("aria-labelledby") || "?", top: rect.top + scrollY, bottom: rect.bottom + scrollY, height: rect.height, clips: section.scrollHeight - section.clientHeight };
      }),
  );
  await testInfo.attach("bands", { body: JSON.stringify(bands, null, 2), contentType: "application/json" });
  expect(bands.length, "the hero, the walkthrough, the cases, the connect band, trust, the journal bridge and the close").toBeGreaterThanOrEqual(7);
  for (let index = 1; index < bands.length; index += 1) {
    expect(Math.abs(bands[index]!.top - bands[index - 1]!.bottom), `${bands[index - 1]!.id} to ${bands[index]!.id}`).toBeLessThanOrEqual(2);
  }
  const viewport = page.viewportSize()!.height;
  for (const band of bands) {
    // Collapsed means its content no longer fits its box (a min-height or a grid row that gave way), not a number of pixels:
    // the journal bridge is a slim strip by design (168px), where Landing V2's scenes were all taller than 180px.
    expect(band.height, `${band.id} has no height`).toBeGreaterThan(0);
    expect(band.clips, `${band.id} is collapsed: its content overflows its box`).toBeLessThanOrEqual(1);
    expect(band.height, `${band.id} is an ocean, not a band`).toBeLessThanOrEqual(viewport * 2);
  }
});

test("the figures Home prints are the ones in the verified corpus it serves", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "1440", "one width: a data contract");
  const response = await request.get(PUBLIC_CORPUS_PATH);
  expect(response.ok(), "the corpus file is served").toBe(true);
  const bytes = await response.body();
  expect(createHash("sha256").update(bytes).digest("hex"), "the served bytes are the receipted corpus").toBe(PUBLIC_CORPUS_SHA256);
  expect(`sha256-${createHash("sha256").update(bytes).digest("base64")}`).toBe(PUBLIC_CORPUS_SRI);
  const corpus = JSON.parse(bytes.toString("utf8")) as { nodes: unknown[]; edges: unknown[]; sources: Record<string, unknown> };

  await page.goto("/");
  const printed = await page.locator("#walkthrough dl > div").evaluateAll(rows =>
    Object.fromEntries(rows.map(row => [row.querySelector("dt")!.textContent!.trim(), row.querySelector("dd")!.textContent!.trim()])),
  );
  expect(printed).toEqual({
    Records: count(corpus.nodes.length),
    Relationships: count(corpus.edges.length),
    "Public sources": count(Object.keys(corpus.sources).length),
  });
  // The instrument's caption restates the same two figures.
  await expect(page.locator("[data-world-instrument] p").first())
    .toHaveText(`Public reference corpus · ${count(corpus.nodes.length)} records · ${count(corpus.edges.length)} relationships`);
});
