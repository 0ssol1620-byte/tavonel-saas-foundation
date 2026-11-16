/**
 * Self-test of the V34 QA harness (e2e/support/v34-*.ts). Each helper must catch a seeded
 * violation and pass a clean case, on small inline fixtures served from a route stub, so no
 * Next.js server is needed. Run with a config whose testMatch is this file.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  measureClippedText,
  measureOutsideBounds,
  measureSiblingOverlap,
  measureStructure,
  measureWordFragmentation,
} from "./support/v34-measure";
import {
  applyTextZoom200,
  colorSchemePass,
  forcedColorsPass,
  layoutPass,
  openZoomedContext,
  reducedMotionPass,
  statePass,
  textStructurePass,
} from "./support/v34-passes";
import { composite, contrastPass, contrastRatio, controlContrastPass, requiredRatio } from "./support/v34-contrast";
import { escapeRestoresFocus, keyboardWalk } from "./support/v34-keyboard";
import { assertWorldAgreement, forceWorldMode, readWorldState, type WorldState } from "./support/v34-world";
import { checkSeo, checkSeoUnique, parseSeo, type SeoExpectation } from "./support/v34-seo";
import { flushReceipt, record, routeKey } from "./support/v34-receipt";

const ORIGIN = "http://v34.selftest";

async function load(page: Page, body: string, head = ""): Promise<void> {
  await page.route(`${ORIGIN}/**`, route =>
    route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title><style>body{margin:0;font:16px/1.4 sans-serif;color:#111;background:#fff}${head}</style></head><body>${body}</body></html>` }),
  );
  await page.goto(`${ORIGIN}/`);
}

const STRUCTURE = `<header><nav><a href="#m">skip</a></nav></header><main id="m"><h1>Title</h1>`;
const END = `</main><footer>f</footer>`;

test.describe("in-page measurements", () => {
  test("outside-bounds: catches a control past the viewport, passes in-bounds and declared scroll surfaces", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await load(page, `<button style="margin-left:500px">far</button>`);
    expect((await page.evaluate(measureOutsideBounds)).map(v => v.pass)).toEqual(["outside-bounds"]);
    await load(page, `<button>near</button><div data-v34-scroll style="overflow:auto;width:100px"><button style="margin-left:500px">in scroller</button></div>`);
    expect(await page.evaluate(measureOutsideBounds)).toEqual([]);
  });

  test("clipped and occluded text", async ({ page }) => {
    await load(page, `<p id="c" style="width:60px;overflow:hidden;white-space:nowrap">a long clipped sentence here</p>`);
    expect((await page.evaluate(measureClippedText)).some(v => v.pass === "clipped-text")).toBe(true);
    await load(page, `<p style="width:60px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">a long sentence with ellipsis</p><div data-v34-scroll style="width:40px;overflow:hidden;white-space:nowrap">scroll surface text</div><svg width="20" height="20"><text>x</text></svg>`);
    expect(await page.evaluate(measureClippedText)).toEqual([]);
    await load(page, `<p style="margin:20px">covered text here</p><div style="position:absolute;left:0;top:0;width:300px;height:100px;background:#eee"></div>`);
    expect((await page.evaluate(measureClippedText)).some(v => v.pass === "occluded-text")).toBe(true);
    await load(page, `<p style="margin:20px">covered text here</p><div data-v34-overlay style="position:absolute;left:0;top:0;width:300px;height:100px;background:#eee"></div>`);
    expect(await page.evaluate(measureClippedText)).toEqual([]);
  });

  test("sibling overlap catches non-layered siblings only", async ({ page }) => {
    await load(page, `<div><div style="height:50px;background:#ccc">a</div><div style="height:50px;margin-top:-30px;background:#aaa">b</div></div>`);
    expect((await page.evaluate(measureSiblingOverlap)).length).toBe(1);
    await load(page, `<div><div style="height:50px">a</div><div data-v34-layer style="height:50px;margin-top:-30px">b</div></div><div><div style="height:50px">a</div><div style="height:50px">b</div></div>`);
    expect(await page.evaluate(measureSiblingOverlap)).toEqual([]);
  });

  test("word fragmentation inside headings and bold", async ({ page }) => {
    await load(page, `<h2 style="width:60px;overflow-wrap:anywhere;font-size:24px">Extraordinarily</h2>`);
    expect((await page.evaluate(measureWordFragmentation)).length).toBeGreaterThan(0);
    await load(page, `<h2 style="width:200px;font-size:24px">Two words wrap fine here and stay whole</h2><b>short</b>`);
    expect(await page.evaluate(measureWordFragmentation)).toEqual([]);
  });

  test("exactly one h1 and the four landmarks", async ({ page }) => {
    await load(page, `<main><h1>a</h1><h1>b</h1></main>`);
    const bad = await page.evaluate(measureStructure);
    expect(bad.map(v => v.selector).sort()).toEqual(["footer", "h1", "header", "nav"]);
    await load(page, `${STRUCTURE}${END}`);
    expect(await page.evaluate(measureStructure)).toEqual([]);
    expect(await textStructurePass(page)).toEqual([]);
  });
});

test.describe("passes", () => {
  test("layoutPass: root overflow", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await load(page, `${STRUCTURE}<div style="width:900px;height:20px;background:#ccc"></div>${END}`);
    expect((await layoutPass(page)).some(v => v.pass === "root-overflow")).toBe(true);
    await load(page, `${STRUCTURE}<p>fine</p>${END}`);
    expect(await layoutPass(page)).toEqual([]);
  });

  test("colorSchemePass", async ({ page }) => {
    await load(page, `${STRUCTURE}${END}`, `html{color-scheme:dark}`);
    expect(await colorSchemePass(page)).toHaveLength(1);
    await load(page, `${STRUCTURE}${END}`, `html{color-scheme:light}`);
    expect(await colorSchemePass(page)).toEqual([]);
  });

  test("reducedMotionPass", async ({ page }) => {
    const anim = `@keyframes spin{to{transform:rotate(1turn)}}.s{width:10px;height:10px;background:#000;animation:spin 1s linear infinite}`;
    await load(page, `<div class="s"></div>`, anim);
    expect((await reducedMotionPass(page)).length).toBeGreaterThan(0);
    await load(page, `<div class="s"></div>`, `${anim}@media (prefers-reduced-motion:reduce){.s{animation:none}}`);
    expect(await reducedMotionPass(page)).toEqual([]);
  });

  test("forcedColorsPass", async ({ page }) => {
    await load(page, `<button style="border:none;background:#eee">go</button>`);
    expect((await forcedColorsPass(page)).length).toBeGreaterThan(0);
    await load(page, `<button style="border:2px solid #000">go</button>`);
    expect(await forcedColorsPass(page)).toEqual([]);
  });

  test("statePass: hover and focus", async ({ page }) => {
    await load(page, `<main><a href="#x" style="outline:none">dead link</a></main>`);
    const dead = await statePass(page);
    expect(dead.map(v => v.pass).sort()).toEqual(["state-focus", "state-hover"]);
    await load(page, `<main><a href="#x" class="l">live link</a></main>`, `.l{color:#00e}.l:hover{color:#a00;text-decoration:underline}.l:focus{outline:2px solid #00e}`);
    expect(await statePass(page)).toEqual([]);
  });

  test("statePass: selected and error", async ({ page }) => {
    await load(page, `<main><div><button aria-pressed="true">a</button><button aria-pressed="false">b</button></div><input aria-invalid="true" aria-describedby="e"><input></main>`);
    const found = (await statePass(page)).map(v => v.pass);
    expect(found).toContain("state-selected");
    expect(found).toContain("state-error");
  });

  test("200% zoom helpers", async ({ browser }) => {
    const ctx = await openZoomedContext(browser, 1280);
    const page = await ctx.newPage();
    await load(page, `${STRUCTURE}<p style="width:700px">wide</p>${END}`);
    expect(await page.evaluate(() => [innerWidth, devicePixelRatio])).toEqual([640, 2]);
    expect((await layoutPass(page)).some(v => v.pass === "root-overflow")).toBe(true);
    await applyTextZoom200(page);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("32px");
    await ctx.close();
  });
});

test.describe("contrast", () => {
  test("pure maths and thresholds", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);
    expect(contrastRatio([119, 119, 119], [255, 255, 255])).toBeCloseTo(4.48, 1);
    expect(composite([0, 0, 0, 0.5], [255, 255, 255])[0]).toBeCloseTo(127.5, 1);
    expect(requiredRatio(16, 400, "text")).toBe(4.5);
    expect(requiredRatio(24, 400, "text")).toBe(3);
    expect(requiredRatio(19, 700, "text")).toBe(3);
    expect(requiredRatio(19, 400, "text")).toBe(4.5);
    expect(requiredRatio(12, 400, "control")).toBe(3);
  });

  test("catches grey-on-white and a gradient extreme, passes strong text", async ({ page }) => {
    await load(page, `<p style="color:#999;background:#fff;padding:8px">weak grey body text</p>`);
    const weak = await contrastPass(page);
    expect(weak.violations).toHaveLength(1);
    expect(weak.checked).toBe(1);
    // White text is fine on the dark end of this gradient and invisible on the light end: only the min/max sampling sees it.
    await load(page, `<p style="display:inline-block;color:#fff;padding:8px;background:linear-gradient(90deg,#102030,#f4f4f4)">gradient text over a light end</p>`);
    expect((await contrastPass(page)).violations).toHaveLength(1);
    await load(page, `<p style="color:#111;background:#fff;padding:8px">strong text</p><h2 style="font-size:28px;color:#777;background:#fff">large grey heading</h2>`);
    expect((await contrastPass(page)).violations).toEqual([]);
  });

  test("a bordered, rounded or chipped surface samples only its own text", async ({ page }) => {
    await load(page, `<button style="color:#fff;background:#111;border:2px solid #111;border-radius:12px;padding:10px 18px">Start</button>
      <a href="#x" style="display:inline-block;color:#fff;background:#111;border:1px solid #111;padding:10px 18px">Outline</a>
      <p style="color:#111;background:#fff">Plain <code style="background:#111;color:#fff;padding:2px 6px">chip</code> prose</p>`);
    expect((await contrastPass(page)).violations).toEqual([]);
  });

  test("exceptions and disabled controls are kept out of violations", async ({ page }) => {
    await load(page, `<p class="faint" style="color:#aaa;background:#fff">decorative faint</p><button disabled style="color:#bbb;background:#fff;border:0">off</button>`);
    const r = await contrastPass(page, { exceptions: { ".faint": "decor, rationale recorded" } });
    expect(r.violations).toEqual([]);
    expect(r.excepted).toHaveLength(1);
    expect(r.reported).toHaveLength(1);
  });

  test("control boundary 3:1", async ({ page }) => {
    await load(page, `<main style="background:#fff;padding:12px"><input style="border:1px solid #e2e2e2;background:#fff;padding:6px"></main>`);
    expect(await controlContrastPass(page)).toHaveLength(1);
    await load(page, `<main style="background:#fff;padding:12px"><input style="border:1px solid #555;background:#fff;padding:6px"></main>`);
    expect(await controlContrastPass(page)).toEqual([]);
  });
});

test.describe("keyboard", () => {
  test("walk catches a missing focus ring and a tiny target, passes a clean page", async ({ page }) => {
    await load(page, `<a href="#a" style="outline:none">a</a><a href="#b" class="ring" style="display:inline-block;width:10px;height:10px">b</a>`, `.ring:focus{outline:2px solid #00e}`);
    const bad = await keyboardWalk(page);
    expect(bad.stops).toBe(2);
    expect(bad.violations.map(v => v.pass).sort()).toEqual(["focus-visible", "target-size", "target-size"]);
    await load(page, `<a href="#a" class="r" style="display:inline-block;padding:14px 20px">first</a><button class="r" style="padding:14px 20px">second</button>`, `.r:focus-visible{outline:2px solid #00e}`);
    const good = await keyboardWalk(page);
    expect(good.violations).toEqual([]);
    expect(good.stops).toBe(2);
  });

  test("identity, not label, decides a trap or a wrap", async ({ page }) => {
    const ring = ".m:focus-visible{outline:2px solid #00e}";
    await load(page, `<a class="m" href="#1" style="display:inline-block;padding:14px">Read more</a><a class="m" href="#2" style="display:inline-block;padding:14px">Read more</a><a class="m" href="#3" style="display:inline-block;padding:14px">Read more</a><a class="m" href="#4" style="display:inline-block;padding:14px;outline:none">Other</a>`, ring);
    const r = await keyboardWalk(page);
    expect(r.stops).toBe(4);
    expect(r.violations.map(v => v.pass)).toEqual(["focus-visible"]);
  });

  test("escape closes the surface and restores focus", async ({ page }) => {
    const wiring = `<button id="t" onclick="s.hidden=false">open</button><div id="s" hidden>panel</div><script>addEventListener('keydown',e=>{if(e.key==='Escape'){s.hidden=true;window.__restore&&t.focus()}})</script>`;
    await load(page, wiring.replace("window.__restore&&", ""));
    expect(await escapeRestoresFocus(page, "#t", "#s")).toEqual([]);
    await load(page, wiring.replace("window.__restore&&t.focus()", "document.activeElement.blur()"));
    expect((await escapeRestoresFocus(page, "#t", "#s")).map(v => v.detail)).toEqual(["focus did not return to the trigger"]);
  });
});

test.describe("world", () => {
  const island = `<div id="w" data-node-count="5" data-edge-count="4"></div><script>
    const c=document.createElement('canvas');
    const mode=c.getContext('webgl')||c.getContext('webgl2')?'webgl':c.getContext('2d')?'canvas2d':'static';
    w.dataset.mode=mode;w.dataset.idsSha='abc';w.dataset.measured='true'</script>`;

  test("forceWorldMode drives the mode the page reports", async ({ page }) => {
    await forceWorldMode(page, "canvas2d");
    await load(page, island);
    expect((await readWorldState(page)).mode).toBe("canvas2d");
    await forceWorldMode(page, "static");
    await load(page, island);
    expect((await readWorldState(page, "static", 2000))).toMatchObject({ mode: "static", nodes: 5, edges: 4, sha: "abc" });
  });

  test("agreement: equal passes, differing digest and unreached mode are caught", () => {
    const s = (mode: string, sha = "abc", nodes = 5): WorldState => ({ mode, nodes, edges: 4, sha });
    expect(assertWorldAgreement({ canvas2d: s("canvas2d"), static: s("static") }, { nodes: 5, edges: 4 }, "abc")).toEqual([]);
    expect(assertWorldAgreement({ canvas2d: s("canvas2d"), static: s("static", "zzz") })).toHaveLength(1);
    expect(assertWorldAgreement({ canvas2d: s("canvas2d"), static: s("canvas2d") })).toHaveLength(1);
    expect(assertWorldAgreement({ canvas2d: s("canvas2d"), static: s("static") }, { nodes: 6, edges: 4 })).toHaveLength(1);
    expect(assertWorldAgreement({ static: s("static", "abc", 5) }, undefined, "def")).toHaveLength(1);
  });
});

test.describe("seo", () => {
  const page = (extra = "") =>
    `<title>Home</title><meta name="description" content="d"><link rel="canonical" href="https://tavonel.com/world"><meta name="robots" content="index,follow"><script type="application/ld+json">{"@type":"WebPage"}</script>${extra}`;
  const e: SeoExpectation = { route: "/world", release: "live", server: "production", inSitemap: true };

  test("a clean live route passes", () => {
    expect(checkSeo(parseSeo(page(), 200), e)).toEqual([]);
  });

  test("seeded defects are each caught", () => {
    const only = (html: string, status = 200, exp = e) => checkSeo(parseSeo(html, status), exp).map(v => v.detail);
    expect(only(page().replace("https://tavonel.com/world", "/world"))[0]).toContain("not absolute");
    expect(only(page().replace("https://tavonel.com/world", "https://tavonel.com/world/"))[0]).toContain("!=");
    expect(only(page('<link rel="canonical" href="https://tavonel.com/world">'))[0]).toContain("2 canonical");
    expect(only(page().replace("index,follow", "noindex"))[0]).toContain("noindex");
    expect(only(page().replace('{"@type":"WebPage"}', "{oops"))[0]).toContain("JSON-LD");
    expect(only(page(), 404)[0]).toContain("404");
    expect(only(page(), 200, { ...e, inSitemap: false })[0]).toContain("missing from sitemap");
  });

  test("held: 404 in production, noindex and out of the sitemap in QA mode", () => {
    const held = { route: "/teams", release: "held" } as const;
    expect(checkSeo(parseSeo("", 404), { ...held, server: "production" })).toEqual([]);
    expect(checkSeo(parseSeo(page(), 200), { ...held, server: "production" })[0].detail).toContain("expected 404");
    const qa = page().replace("https://tavonel.com/world", "https://tavonel.com/teams").replace("index,follow", "noindex");
    expect(checkSeo(parseSeo(qa, 200), { ...held, server: "qa", inSitemap: false })).toEqual([]);
    expect(checkSeo(parseSeo(qa, 200), { ...held, server: "qa", inSitemap: true })[0].detail).toContain("present in sitemap");
  });

  test("uniqueness across the set", () => {
    const a = parseSeo(page(), 200);
    expect(checkSeoUnique([{ route: "/a", facts: a }, { route: "/b", facts: parseSeo(page().replace("Home", "Other").replace('"d"', '"e"'), 200) }])).toEqual([]);
    expect(checkSeoUnique([{ route: "/a", facts: a }, { route: "/b", facts: a }])).toHaveLength(2);
  });
});

test("receipt: entries fold into one receipt.json with their violations", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "v34-receipt-"));
  const before = process.env.V34_QA_OUT;
  process.env.V34_QA_OUT = dir;
  try {
    const base = { route: "/", width: 412, engine: "chromium", colorScheme: "light" as const };
    record({ ...base, pass: "layout", violations: [] });
    record({ ...base, pass: "contrast", violations: [{ pass: "contrast", selector: "p.x", detail: "2:1" }] });
    const file = flushReceipt();
    expect(file).toBe(path.join(dir, "receipt.json"));
    const doc = JSON.parse(readFileSync(file!, "utf8")) as { total: number; failed: number; entries: { pass: string; ok: boolean; commit: string }[] };
    expect(doc).toMatchObject({ total: 2, failed: 1 });
    expect(doc.entries.map(x => [x.pass, x.ok])).toEqual([["layout", true], ["contrast", false]]);
    expect(routeKey("/")).toBe("home");
    expect(routeKey("/product/world")).toBe("product__world");
  } finally {
    if (before === undefined) delete process.env.V34_QA_OUT;
    else process.env.V34_QA_OUT = before;
  }
});

test.describe("round 2: overlays, ancestor clipping, keyboard traps", () => {
  const passes = async (page: Page) => (await layoutPass(page)).map(v => v.pass);

  test("overlay exceptions: a fixed sheet over text and overlay labels over a canvas pass; the same without the attribute fail", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    const sheet = (attr: string) => `${STRUCTURE}<p style="margin:0">body copy under the sheet</p><div ${attr} style="position:fixed;left:0;top:0;width:300px;height:120px;background:#eee">sheet text</div>${END}`;
    await load(page, sheet("data-v34-overlay"));
    expect(await layoutPass(page)).toEqual([]);
    // restored afterwards, not left hidden
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("[data-v34-overlay]")!).visibility)).toBe("visible");
    await load(page, sheet(""));
    expect((await passes(page)).length).toBeGreaterThan(0);
    const labels = (attr: string) => `${STRUCTURE}<div style="position:relative"><canvas width="300" height="150" style="display:block"></canvas><span ${attr} style="position:absolute;left:10px;top:10px">node A</span><span ${attr} style="position:absolute;left:12px;top:12px">node B</span></div>${END}`;
    await load(page, labels("data-v34-overlay"));
    expect(await layoutPass(page)).toEqual([]);
    await load(page, labels(""));
    expect((await passes(page)).length).toBeGreaterThan(0);
  });

  test("an overlay is still judged for its own text clipping", async ({ page }) => {
    await load(page, `${STRUCTURE}<div data-v34-overlay style="position:fixed;left:0;top:0;width:60px;overflow:hidden"><p style="white-space:nowrap;margin:0">overlay text far wider than its box</p></div>${END}`);
    expect((await passes(page)).includes("clipped-by-ancestor")).toBe(true);
  });

  test("clipped by an ancestor: horizontal, vertical, the grid row shape; scroll, ellipsis and a fitting box pass", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await load(page, `${STRUCTURE}<div style="width:80px;overflow:hidden"><p style="white-space:nowrap;margin:0">long text clipped by its ancestor box</p></div>${END}`);
    expect(await passes(page)).toContain("clipped-by-ancestor");
    await load(page, `${STRUCTURE}<div style="height:24px;overflow:hidden"><p style="margin:0;width:200px">several lines of text that wrap and run past the bottom edge of the ancestor box</p></div>${END}`);
    expect(await passes(page)).toContain("clipped-by-ancestor");
    await load(page, `${STRUCTURE}<div style="display:grid;grid-template-rows:20px;overflow:hidden;width:200px"><div style="padding:8px;height:60px"><p style="margin:0">tile</p><p style="margin:0">second line</p><p style="margin:0">third line</p></div></div>${END}`);
    const rows = await passes(page);
    expect(rows).toContain("clipped-rows");
    await load(page, `${STRUCTURE}<div data-v34-scroll style="width:80px;overflow-x:auto"><p style="white-space:nowrap;margin:0">wide text inside a scroll surface</p></div><div style="width:80px;overflow:hidden"><p style="white-space:nowrap;text-overflow:ellipsis;overflow:hidden;margin:0">ellipsis marks this clip</p></div><div style="width:300px;overflow:hidden;border-radius:8px"><p style="margin:0">fits</p></div>${END}`);
    expect(await layoutPass(page)).toEqual([]);
  });

  test("keyboard: a script that sends focus back to the first stop is a trap, a natural wrap is not", async ({ page }) => {
    const ring = ".m:focus-visible{outline:2px solid #00e}";
    const link = (i: number, extra = "") => `<a class="m" href="#${i}" style="display:inline-block;padding:14px" ${extra}>L${i}</a>`;
    await load(page, `${link(1, 'id="first"')}${link(2)}${link(3, "onfocus=\"document.getElementById('first').focus()\"")}${link(4)}`, ring);
    const trapped = await keyboardWalk(page);
    const t = trapped.violations.find(v => v.pass === "keyboard-trap");
    expect(t?.detail).toContain("L4");
    await load(page, `${link(1)}${link(2)}${link(3)}`, ring);
    const wrap = await keyboardWalk(page);
    expect(wrap.violations).toEqual([]);
    expect(wrap.stops).toBe(3);
  });

  test("keyboard: an input that swallows Tab and keeps focus is a trap", async ({ page }) => {
    await load(page, `<input class="m" id="i" aria-label="x" onkeydown="if(event.key==='Tab'){event.preventDefault();this.focus()}" style="padding:14px"><a class="m" href="#a" style="display:inline-block;padding:14px">after</a>`, ".m:focus-visible{outline:2px solid #00e}");
    const r = await keyboardWalk(page);
    expect(r.violations.some(v => v.pass === "keyboard-trap")).toBe(true);
  });
});
