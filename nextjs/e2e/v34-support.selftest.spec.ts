/**
 * Self-test of the V34 QA harness (e2e/support/v34-*.ts). Each helper must catch a seeded
 * violation and pass a clean case, on small inline fixtures served from a route stub, so no
 * Next.js server is needed. Run with a config whose testMatch is this file.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, webkit, type Page } from "@playwright/test";
import {
  measureClippedRows,
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
  openContext,
  openZoomedContext,
  reducedMotionPass,
  statePass,
  textStructurePass,
} from "./support/v34-passes";
import { composite, contrastPass, contrastRatio, controlContrastPass, openContentDetails, requiredRatio } from "./support/v34-contrast";
import { escapeRestoresFocus, keyboardWalk } from "./support/v34-keyboard";
import { drawerPass, moreMenuPass } from "./support/v34-drawer";
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

  test("statePass with a scope: every control of a fixed panel outside main is hovered; an empty scope fails", async ({ page }) => {
    const css = `.l{color:#00e}.l:hover{color:#a00}.l:focus{outline:2px solid #00e}`;
    const panel = (link: string) => `<main><p>page</p></main><div data-p style="position:fixed;left:0;bottom:0;padding:8px"><p>notice ${link}</p><button class="l">Allow</button></div>`;
    await load(page, panel(`<a href="#n" style="color:#111" class="f">Privacy notice</a>`), `${css}.f:focus{outline:2px solid #00e}`);
    expect((await statePass(page, "[data-p]")).map(v => `${v.pass} ${v.selector}`)).toEqual(["state-hover a[Privacy notice]"]);
    await load(page, panel(`<a href="#n" class="l">Privacy notice</a>`), css);
    expect(await statePass(page, "[data-p]")).toEqual([]);
    expect((await statePass(page, "[data-absent]")).map(v => v.pass)).toEqual(["state-hover"]);
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
    // A strong-bordered select in a closed details body sits over dark text it does not paint: not measured until opened.
    const shut = `<main style="background:#fff;padding:12px"><details><summary>more</summary><select style="border:1px solid #555;background:#fff;width:300px;height:40px"><option>a</option></select></details><p style="background:#111;color:#111;height:60px;margin:0">x</p></main>`;
    await load(page, shut);
    expect(await controlContrastPass(page)).toEqual([]);
    await load(page, shut.replace("<details>", "<details open>").replace("#555", "#e2e2e2"));
    expect(await controlContrastPass(page)).toHaveLength(1);
  });

  test("control boundary: a transparent border on a transparent control is no boundary; a faint drawn one still fails", async ({ page }) => {
    await load(page, `<main style="background:#fff;padding:12px"><button style="border:1px solid transparent;background:transparent;width:40px;height:40px">v</button></main>`);
    expect(await controlContrastPass(page)).toEqual([]);
    await load(page, `<main style="background:#fff;padding:12px"><button style="border:1px solid #e2e2e2;background:transparent;width:40px;height:40px">v</button></main>`);
    expect(await controlContrastPass(page)).toHaveLength(1);
  });

  test("transparent-border input fails", async ({ page }) => {
    // The skip is for buttons. A field with no visible edge has no boundary to find, and 1.4.11 still applies.
    for (const field of [
      `<input style="border:1px solid transparent;background:transparent;width:200px;height:40px">`,
      `<select style="border:1px solid transparent;background:transparent;width:200px;height:40px"><option>a</option></select>`,
      `<textarea style="border:1px solid transparent;background:transparent;width:200px;height:60px"></textarea>`,
    ]) {
      await load(page, `<main style="background:#fff;padding:12px">${field}</main>`);
      expect(await controlContrastPass(page), field).toHaveLength(1);
    }
  });

  test("details: the content ones are opened, the header menu is not", async ({ page }) => {
    // An open header menu lies over the field: measured with it open, the field reads against the menu.
    const menu = `<header style="position:relative"><details id="menu"><summary>Menu</summary><div style="position:absolute;top:24px;left:0;width:400px;height:40px;background:#0050b4"></div></details></header>`;
    const field = `<main style="background:#fff;padding:12px"><details><summary>more</summary><textarea style="border:1px solid #555;background:#fff;width:300px;height:120px"></textarea></details></main>`;
    await load(page, menu + field);
    expect(await openContentDetails(page)).toBe(1);
    expect(await page.locator("#menu").evaluate(d => (d as HTMLDetailsElement).open)).toBe(false);
    expect(await controlContrastPass(page)).toEqual([]);
    await page.locator("#menu").evaluate(d => ((d as HTMLDetailsElement).open = true));
    expect(await controlContrastPass(page)).toHaveLength(1);
  });
});

test.describe("contrast: the colour and the pixels of a sample come from one state (WO-CI-31)", () => {
  // The page changes state after the pass has read the colours and before it takes the pixels, as /world in WebKit
  // went live and pressed its camera control in the middle of the pass. The flip here is triggered by the pass itself
  // (the attribute or style it sets on the element it samples), so it lands in that window on every run.
  const control = `<style>.t{color:#f2f7f0;background:#12251f;border:1px solid #5d8070;padding:10px 14px} .t.on{color:#0b1713;background:#c9f2a5;border-color:#c9f2a5} .t.bad{color:#f2f7f0;background:#c9f2a5}</style>`;
  const flipOn = (to: string, attribute: string) =>
    `<script>new MutationObserver(() => { document.getElementById("b").className = "t ${to}"; }).observe(document.body, { subtree: true, attributeFilter: ["${attribute}"] });</script>`;

  test("text: a state that changes mid-pass is measured in the state it changed to", async ({ page }) => {
    await load(page, `<main style="background:#07100e;padding:12px">${control}<button id="b" class="t"><span>Play camera</span></button></main>${flipOn("on", "data-v34-contrast-hide")}`);
    expect((await contrastPass(page)).violations).toEqual([]);
    // The state it changed to is still judged: a light label on the light fill fails, with the colour it has now.
    await load(page, `<main style="background:#07100e;padding:12px">${control}<button id="b" class="t"><span>Play camera</span></button></main>${flipOn("bad", "data-v34-contrast-hide")}`);
    const bad = await contrastPass(page);
    expect(bad.violations.map(v => v.detail)).toEqual([expect.stringMatching(/^"Play camera" 1\.\d+:1 needs 4\.5:1 .*fg rgb\(242,247,240\) over 201,242,165/)]);
  });

  test("control: a boundary that changes mid-pass is measured in the state it changed to", async ({ page }) => {
    const faint = `<style>main button{border:1px solid #e2e2e2;background:#fff;width:40px;height:40px} main button.t.on{border-color:#555}</style>`;
    await load(page, `<main style="background:#fff;padding:12px">${faint}<button id="b" class="t">v</button></main>${flipOn("on", "style")}`);
    expect(await controlContrastPass(page)).toEqual([]);
  });

  test("a running transition is waited out, not sampled half way", async ({ page }) => {
    // White text turning dark on white over 1.5 s: half way it is grey, and only its end state is what a reader is left with.
    await load(page, `<main style="background:#fff;padding:12px"><p id="p" style="background:#fff;margin:0">fading in to dark</p></main><script>const p = document.getElementById("p"); p.style.color = "#fff"; getComputedStyle(p).color; p.style.transition = "color 1.5s linear"; p.style.color = "#111";</script>`);
    expect((await contrastPass(page)).violations).toEqual([]);
  });

  test("a colour that never holds still is not measured, and that fails", async ({ page }) => {
    // Dark blue on white at every instant, so a single sample would pass it; no two reads agree, so nothing was measured.
    const cycling = `<style>@keyframes cycle { from { color: #000 } to { color: #00f } } #p { animation: cycle 1s linear infinite }</style>`;
    await load(page, `<main style="background:#fff;padding:12px">${cycling}<p id="p" style="background:#fff;margin:0">cycling text</p></main>`);
    const text = await contrastPass(page);
    expect(text.violations.map(v => v.detail)).toEqual([expect.stringContaining('"cycling text" changed colour while it was sampled, on each of 3 attempts')]);
    const edge = `<style>@keyframes edge { from { border-color: #000 } to { border-color: #00f } } main button { border: 2px solid #000; background: #fff; width: 40px; height: 40px; animation: edge 1s linear infinite }</style>`;
    await load(page, `<main style="background:#fff;padding:12px">${edge}<button>v</button></main>`);
    expect((await controlContrastPass(page)).map(v => v.detail)).toEqual([expect.stringContaining("boundary changed colour while it was sampled")]);
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

  test("a control in a closed details body is not owed a tab stop", async ({ page }) => {
    const ring = ".r:focus-visible{outline:2px solid #00e}";
    const pad = "padding:14px 20px";
    const body = `<button class="r" style="${pad}">first</button><details><summary class="r" style="${pad}">more</summary><select class="r"><option>a</option></select><input class="r"></details><button class="r" style="${pad}">last</button>`;
    await load(page, body, ring);
    expect((await keyboardWalk(page)).violations.filter(v => v.pass === "keyboard-trap")).toEqual([]);
    // WebKit is where it showed: its Tab order skips summary, so the walk wraps with the body still closed.
    const browser = await webkit.launch();
    try {
      const wk = await browser.newPage();
      await load(wk, body, ring);
      expect((await keyboardWalk(wk)).violations.filter(v => v.pass === "keyboard-trap")).toEqual([]);
    } finally {
      await browser.close();
    }
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
    // The home hero under 900px: every forced mode must report static.
    expect(assertWorldAgreement({ webgl: s("static"), canvas2d: s("static"), static: s("static") }, undefined, undefined, "static")).toEqual([]);
    expect(assertWorldAgreement({ webgl: s("webgl"), canvas2d: s("static"), static: s("static") }, undefined, undefined, "static")).toHaveLength(1);
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

test.describe("round 3: false positives found by the first integrated QA run", () => {
  test("sibling overlap: a wrapped inline link is judged by its line boxes, a padded stacked link still overlaps", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await load(page, `<p style="width:120px;margin:0"><a href="#a">first link</a> <a href="#b">second link that wraps to a new line</a></p>`);
    expect(await page.evaluate(measureSiblingOverlap)).toEqual([]);
    await load(page, `<p style="width:300px;margin:0"><a href="#a" style="display:inline-block;width:100%;padding-block:12px;margin-block:-12px">one</a><a href="#b" style="display:inline-block;width:100%;padding-block:12px;margin-block:-12px">two</a></p>`);
    expect((await page.evaluate(measureSiblingOverlap)).length).toBe(1);
  });

  test("occluded text: a closed details body and a stretched link are not covered; a real cover still is", async ({ page }) => {
    await load(page, `<details style="margin:20px"><summary>question</summary><p>answer text that is not painted</p></details><details><summary>another question</summary><p>second answer</p></details>`);
    expect((await page.evaluate(measureClippedText)).filter(v => v.pass === "occluded-text")).toEqual([]);
    await load(page, `<div data-v34-card style="position:relative;margin:20px"><p>card copy</p><a href="#x" class="s">Open card</a></div>`, `.s{position:static}.s::after{content:"";position:absolute;inset:0}`);
    expect((await page.evaluate(measureClippedText)).filter(v => v.pass === "occluded-text" && v.selector.startsWith("p"))).toEqual([]);
    await load(page, `<div style="position:relative;margin:20px"><p>card copy</p><a href="#x" class="s">Open card</a></div>`, `.s{position:static}.s::after{content:"";position:absolute;inset:0;background:#eee}`);
    expect((await page.evaluate(measureClippedText)).some(v => v.pass === "occluded-text")).toBe(true);
  });

  test("clipped text: a declared line clamp is not a defect, a plain clip is", async ({ page }) => {
    const clamp = "display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;width:120px;margin:0";
    await load(page, `<span style="${clamp}">one two three four five six seven eight nine ten eleven twelve thirteen</span>`);
    expect(await page.evaluate(measureClippedText)).toEqual([]);
    await load(page, `<p style="width:120px;height:20px;overflow:hidden;margin:0">one two three four five six seven eight nine ten eleven twelve</p>`);
    expect((await page.evaluate(measureClippedText)).some(v => v.pass === "clipped-text")).toBe(true);
  });

  test("clipped by an ancestor: a scrolling code box and a closed details pass, a plain clip fails", async ({ page }) => {
    await load(page, `<figure style="width:120px;overflow:hidden;margin:0"><pre style="overflow:auto;margin:0"><span>a very long line of code that scrolls inside its box</span></pre></figure>`);
    expect(await page.evaluate(measureClippedRows)).toEqual([]);
    await load(page, `<div style="width:120px;overflow:hidden"><details><summary>plan limits</summary><ul style="width:400px"><li>closed list item that is wider than the box</li></ul></details></div>`);
    expect(await page.evaluate(measureClippedRows)).toEqual([]);
    await load(page, `<figure style="width:120px;overflow:hidden;margin:0"><p style="margin:0;white-space:nowrap">a very long line of text clipped by the figure</p></figure>`);
    expect((await page.evaluate(measureClippedRows)).length).toBeGreaterThan(0);
  });

  test("contexts: the app's CSP does not stop the injected style, and the consent panel is answered", async ({ browser }) => {
    const ctx = await openContext(browser, 360);
    const page = await ctx.newPage();
    await page.route(`${ORIGIN}/**`, route =>
      route.fulfill({ contentType: "text/html", headers: { "content-security-policy": "style-src-elem 'self'" }, body: "<!doctype html><html lang=\"en\"><head><title>t</title></head><body><p>x</p></body></html>" }),
    );
    await page.goto(`${ORIGIN}/`);
    await applyTextZoom200(page);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("32px");
    expect(await page.evaluate(() => window.localStorage.getItem("tavonel.analytics-consent.v1"))).toContain('"allowed":false');
    await ctx.close();
    const pending = await openContext(browser, 360, { consent: "pending" });
    const p2 = await pending.newPage();
    await p2.route(`${ORIGIN}/**`, route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>t</title><p>x</p>" }));
    await p2.goto(`${ORIGIN}/`);
    expect(await p2.evaluate(() => window.localStorage.getItem("tavonel.analytics-consent.v1"))).toBeNull();
    await pending.close();
  });

  test("contrast: an element is sampled mid-screen, not under a sticky header", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await load(page, `<header style="position:sticky;top:0;height:70px;background:#f4f6fa"></header><div style="height:1500px"></div><h2 style="margin:0;font-size:30px;color:#f3f7f0;background:#0a1712;padding:12px">light heading on a dark ground</h2><div style="height:1500px"></div>`, "html{scroll-behavior:smooth}");
    const r = await contrastPass(page);
    expect(r.checked).toBe(1);
    expect(r.violations).toEqual([]);
  });

  test("contrast: a closed details body is not sampled, and tight leading does not pull in the line above", async ({ page }) => {
    await load(page, `<details open style="background:#fff"><summary>q</summary></details><details style="margin:0"><summary style="color:#111">question</summary><p style="color:#111;background:#111">hidden answer</p></details><div style="background:#111;height:60px"></div>`);
    expect((await contrastPass(page)).violations).toEqual([]);
    await load(page, `<div style="background:#0a1712;padding:20px"><h1 style="margin:0;font-size:60px;line-height:0.9;color:#f3f7f0">gggg yyyy<br><span style="color:#c6f0ab">second line accent</span></h1></div>`);
    expect((await contrastPass(page)).violations).toEqual([]);
    // and the sheet that hides the text is gone again afterwards
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("h1")!).color)).toBe("rgb(243, 247, 240)");
  });

  test("contrast: only the containing-block chain clips (fixed in a clip box, absolute past a static clip, html overflow-x)", async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 800 });
    const pale = "color:#ddd;font-size:16px";
    await load(page, `<div style="height:30px;overflow:hidden"><p style="position:fixed;top:100px;left:10px;margin:0;${pale}">fixed pale text</p></div>`);
    expect((await contrastPass(page)).violations).toHaveLength(1);
    await load(page, `<div style="height:30px;overflow:hidden"><p style="position:absolute;top:100px;left:10px;margin:0;${pale}">absolute pale text</p></div>`);
    expect((await contrastPass(page)).violations).toHaveLength(1);
    await load(page, `<div style="height:1600px"></div><p style="margin:0;${pale}">below the first screen, pale</p>`, "html{overflow-x:hidden}");
    expect((await contrastPass(page)).violations).toHaveLength(1);
  });

  test("contrast: text that runs past a scrolling box is sampled inside the box only, and an unreadable block still fails", async ({ page }) => {
    const block = (fg: string) => `<div style="width:200px;overflow-x:auto;background:#0a1712;border:1px solid #444"><pre style="margin:0;padding:8px;color:${fg};white-space:pre"><code>"TAVONEL_API_KEY": "your key, scoped to reads and nothing more"</code></pre></div>`;
    await load(page, block("#eff6ef"));
    expect((await contrastPass(page)).violations).toEqual([]);
    await load(page, block("#26382f"));
    expect((await contrastPass(page)).violations).toHaveLength(1);
  });

  test("keyboard: a smooth-scrolling page is waited for before the focus rect is read", async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 500 });
    await load(page, `<button class="r">top</button><div style="height:3000px"></div><button class="r">far below</button>`, ".r{padding:14px 20px}.r:focus-visible{outline:2px solid #00e}html{scroll-behavior:smooth}");
    const r = await keyboardWalk(page);
    expect(r.stops).toBe(2);
    expect(r.violations).toEqual([]);
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

  test("keyboard: an input that takes focus back on blur is a trap", async ({ page }) => {
    const a = (i: number) => `<a class="m" href="#${i}" style="display:inline-block;padding:14px">L${i}</a>`;
    await load(page, `<input class="m" aria-label="x" onblur="setTimeout(()=>this.focus())" style="padding:14px">${a(1)}${a(2)}`, ".m:focus-visible{outline:2px solid #00e}");
    const r = await keyboardWalk(page);
    expect(r.violations.some(v => v.pass === "keyboard-trap")).toBe(true);
  });
});

test.describe("QA 1 review: scroll axes, stretched links, text hiding, line clamp", () => {
  test("F6: overflow-x hidden with overflow-y auto still clips horizontally", async ({ page }) => {
    await load(page, `<div style="width:120px;overflow-x:hidden;overflow-y:auto;height:80px"><p style="margin:0;white-space:nowrap">a long line clipped on the right and never scrollable</p></div>`);
    expect((await page.evaluate(measureClippedRows)).length).toBeGreaterThan(0);
    await load(page, `<div style="width:120px;overflow-x:hidden;overflow-y:auto;height:40px"><p style="margin:0;width:100px">several words that wrap and scroll down inside this box</p></div>`);
    expect(await page.evaluate(measureClippedRows)).toEqual([]);
  });

  test("F7: a scrolling pre wider than its clipping figure is caught, one that fits passes", async ({ page }) => {
    await load(page, `<figure style="width:120px;overflow:hidden;margin:0"><pre style="overflow:auto;width:400px;margin:0"><span>code that fits the pre but not the figure</span></pre></figure>`);
    expect((await page.evaluate(measureClippedRows)).length).toBeGreaterThan(0);
    await load(page, `<figure style="width:300px;overflow:hidden;margin:0"><pre style="overflow:auto;width:280px;margin:0"><span>a very long line of code that scrolls inside its box and its figure</span></pre></figure>`);
    expect(await page.evaluate(measureClippedRows)).toEqual([]);
  });

  test("F5: a stretched link that leaks out of an unpositioned card still covers text", async ({ page }) => {
    await load(page, `<div style="position:relative"><div><p>card one copy</p><a class="s" href="#1">Open one</a></div><div><p>card two copy</p><a href="#2">Open two</a></div></div>`, `.s::after{content:"";position:absolute;inset:0}`);
    expect((await page.evaluate(measureClippedText)).some(v => v.pass === "occluded-text")).toBe(true);
    await load(page, `<div><div data-v34-card style="position:relative"><p>card one copy</p><a class="s" href="#1">Open one</a></div><div data-v34-card style="position:relative"><p>card two copy</p><a class="s" href="#2">Open two</a></div></div>`, `.s::after{content:"";position:absolute;inset:0}`);
    expect((await page.evaluate(measureClippedText)).filter(v => v.pass === "occluded-text")).toEqual([]);
  });

  test("stretched link: the exception is declared on the card, never inferred", async ({ page }) => {
    const css = `.s::after{content:"";position:absolute;inset:0}`;
    // The same positioned card without data-v34-card: its stretched link covers text like any other cover.
    await load(page, `<div style="position:relative;margin:20px"><p>card copy</p><a href="#x" class="s">Open card</a></div>`, css);
    expect((await page.evaluate(measureClippedText)).some(v => v.pass === "occluded-text")).toBe(true);
    // N1: one unpositioned card inside a positioned section; its link stretches over the section heading and lede.
    await load(page, `<section style="position:relative;padding:20px"><h2 style="margin:0 0 10px">Section heading copy</h2><p>section lede words here</p><div data-v34-card><p>card copy</p><a class="s" href="#1">Open</a></div></section>`, css);
    expect((await page.evaluate(measureClippedText)).some(v => v.pass === "occluded-text")).toBe(true);
    // N2: the leak of F5, with the neighbouring card's own link raised above it.
    await load(page, `<div style="position:relative"><div data-v34-card><p>card one copy</p><a class="s" href="#1">Open one</a></div><div data-v34-card><p>card two copy</p><a href="#2" style="position:relative;z-index:1">Open two</a></div></div>`, css);
    expect((await page.evaluate(measureClippedText)).some(v => v.pass === "occluded-text")).toBe(true);
  });

  test("fixed layer: text and controls beneath it are not judged by its pixels; its own text still is", async ({ page }) => {
    // Four full contrast passes, then a context teardown that ran past the 30s default on a loaded machine.
    test.setTimeout(60_000);
    const panel = (inner: string) => `<div style="position:fixed;left:0;right:0;bottom:0;height:140px;background:#fff;color:#111;padding:8px">${inner}</div>`;
    const beneath = `<div style="background:#0b1713;color:#eff6ef;height:100vh;display:flex;align-items:flex-end;gap:12px;padding:20px"><p style="margin:0">light footer text on its dark ground</p><button style="background:#0b1713;color:#eff6ef;border:1px solid #c9f2a5;padding:8px">Footer control</button></div>`;
    await load(page, beneath + panel("<p>panel copy that holds</p>"));
    expect((await contrastPass(page)).violations).toEqual([]);
    expect(await controlContrastPass(page)).toEqual([]);
    await load(page, beneath + panel(`<p style="color:#bbb">pale panel copy</p><button style="background:#fff;color:#111;border:1px solid #ddd;padding:8px">Pale edge</button>`));
    expect((await contrastPass(page)).violations.map(v => v.detail)).toEqual([expect.stringContaining("pale panel copy")]);
    expect((await controlContrastPass(page)).map(v => v.selector)).toEqual(["button"]);
  });

  test("F3: the contrast pass keeps a currentColor background, so text on it is still judged", async ({ page }) => {
    await load(page, `<p style="color:#262626;background:currentColor;padding:8px;display:inline-block;margin:20px">dark text on its own currentColor</p>`);
    expect((await contrastPass(page)).violations).toHaveLength(1);
  });

  test("F8: a line clamp whose fixed height cuts a line is reported, a clean clamp is not", async ({ page }) => {
    await load(page, `<p style="display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;width:120px;height:30px;margin:0;line-height:20px">one two three four five six seven eight nine ten eleven twelve</p>`);
    expect((await page.evaluate(measureClippedText)).some(v => v.pass === "clipped-text")).toBe(true);
    await load(page, `<p style="display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;width:120px;margin:0;line-height:20px">one two three four five six seven eight nine ten eleven twelve</p>`);
    expect(await page.evaluate(measureClippedText)).toEqual([]);
  });
});

/*
  The drawer pass (WO-CI-9) on a stand-in for the V34 shell's drawer: a header button that opens a
  modal <dialog> of links, wired the way components/v34/shell/mobile-drawer.tsx is (focus the trigger,
  showModal, close on a followed link; a followed link is a client navigation, history.pushState; a
  window capture key listener, added when the shell mounts, that keeps an Escape the open drawer
  consumes from every page listener). Each promise is broken on its own and must be caught; the
  clean drawer must pass.
*/
test.describe("drawer", () => {
  type Wiring = { hydrateMs?: number; closeOnLink?: boolean; escapeKeepsOpen?: boolean; escapeDropsFocus?: boolean; escapeLeaks?: boolean; escapeStopOnOpen?: boolean; escapeClosesUnstopped?: "sync" | "microtask"; noOpen?: boolean; drawerStyle?: string; linkStyle?: string; pageText?: string };
  // The shell's Escape guard (mobile-drawer.tsx before WO-CI-14 had none: the press reached every page listener).
  // escapeStopOnOpen adds it on open and removes it on close, the way more-menu.tsx's listener was scoped to `open`.
  // escapeClosesUnstopped: the guard closes the drawer itself, now or in a microtask, and does not stop the press.
  const stopEscape = (w: Wiring) =>
    w.escapeLeaks ? "" : `const stop = e => { if (e.key === "Escape" && d.open) ${
      w.escapeClosesUnstopped === "sync" ? "d.close();" : w.escapeClosesUnstopped === "microtask" ? "queueMicrotask(() => d.close());" : "e.stopImmediatePropagation();"} };
      ${w.escapeStopOnOpen ? `d.addEventListener("close", () => removeEventListener("keydown", stop, true));` : ""}`;
  const drawer = (w: Wiring = {}) => `
    <header data-v34-header><button aria-label="Open navigation" aria-expanded="false" style="width:44px;height:44px">=</button>
      <dialog style="box-sizing:border-box;position:fixed;inset:0;width:100%;max-width:none;height:100%;max-height:none;margin:0;padding:16px;border:0;background:#fff;color:#111;${w.drawerStyle ?? ""}">
        <a href="/" aria-label="Home" style="color:#111">Home</a>
        <nav><a href="/" style="color:#111;${w.linkStyle ?? ""}">This page</a><details><summary>Group</summary><a href="/other" style="color:#111">Another page</a></details></nav>
      </dialog></header>
    <main><h1>t</h1>${w.pageText ?? ""}</main>
    <script>
      const t = document.querySelector("button"), d = document.querySelector("dialog");
      ${stopEscape(w)}
      const hydrate = () => {
        t.addEventListener("click", () => { if (d.open) return; t.focus(); d.showModal(); t.setAttribute("aria-expanded", "true"); ${w.escapeStopOnOpen ? `addEventListener("keydown", stop, true);` : ""} });
        ${w.escapeLeaks || w.escapeStopOnOpen ? "" : `addEventListener("keydown", stop, true);`}
      };
      ${w.noOpen ? "" : `setTimeout(hydrate, ${w.hydrateMs ?? 0});`}
      d.addEventListener("close", () => t.setAttribute("aria-expanded", "false"));
      d.addEventListener("click", e => { const a = e.target.closest("a"); if (!a) return; e.preventDefault(); history.pushState({}, "", a.href); ${w.closeOnLink === false ? "" : "d.close();"} });
      ${w.escapeKeepsOpen ? `addEventListener("keydown", e => { if (e.key === "Escape") e.preventDefault(); }, true); d.addEventListener("cancel", e => e.preventDefault());` : ""}
      ${w.escapeDropsFocus ? `d.addEventListener("close", () => setTimeout(() => document.activeElement && document.activeElement.blur(), 0));` : ""}
    </script>`;
  const passes = (r: { violations: { pass: string }[] }) => [...new Set(r.violations.map(v => v.pass))].sort();

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test("a clean drawer passes, and where focus lands after a followed link is reported", async ({ page }) => {
    await load(page, drawer());
    const r = await drawerPass(page, "/");
    expect(r.violations).toEqual([]);
    expect(r.reported.filter(v => v.pass === "drawer-link-focus").map(v => v.selector)).toEqual(["a[Home] -> /", "a[This page] -> /", "a[Another page] -> /other"]);
    expect(r.reported.some(v => v.pass === "drawer-hydration")).toBe(false);
  });

  test("taps lost before the trigger is wired are reported, not judged", async ({ page }) => {
    await load(page, drawer({ hydrateMs: 700 }));
    const r = await drawerPass(page, "/");
    expect(r.violations).toEqual([]);
    expect(r.reported.find(v => v.pass === "drawer-hydration")?.detail).toMatch(/^[1-9]\d* tap\(s\) after the first response byte opened nothing/);
  });

  test("a trigger that never opens, and a drawer wider than the viewport, are caught", async ({ page }) => {
    await load(page, drawer({ noOpen: true }));
    expect((await drawerPass(page, "/")).violations.map(v => v.detail)).toEqual(["tapping the trigger for 10 s never opened the drawer"]);
    await load(page, drawer({ drawerStyle: "width:150vw" }));
    expect((await drawerPass(page, "/")).violations.map(v => v.detail)).toContainEqual(expect.stringMatching(/^spans 0\.\.585px of a 390px viewport$/));
  });

  test("Escape that leaves it open, and Escape that drops focus, are caught", async ({ page }) => {
    await load(page, drawer({ escapeKeepsOpen: true }));
    const open = await drawerPass(page, "/");
    expect(passes(open)).toEqual(["escape-restore"]);
    expect(open.violations.map(v => v.detail)).toContain("still open after Escape");
    await load(page, drawer({ escapeDropsFocus: true }));
    const lost = await drawerPass(page, "/");
    expect(passes(lost)).toEqual(["escape-restore"]);
    expect(lost.violations.map(v => v.detail)).toEqual(["focus went to body, not the trigger, after Escape", "focus did not return to the trigger"]);
  });

  test("an Escape the open drawer consumes that also reaches the page's key listeners is caught", async ({ page }) => {
    await load(page, drawer({ escapeLeaks: true }));
    const leak = await drawerPass(page, "/");
    expect(passes(leak)).toEqual(["escape-in-shell"]);
    expect(leak.violations.map(v => v.detail)).toEqual([
      "the Escape that closed the drawer also reached the page's key listeners: window capture, document capture, document bubble, window bubble",
    ]);
    // A shell that starts listening only when the drawer opens comes after a listener the page added at mount.
    await load(page, drawer({ escapeStopOnOpen: true }));
    const late = await drawerPass(page, "/");
    expect(passes(late)).toEqual(["escape-in-shell"]);
    expect(late.violations.map(v => v.detail)).toEqual(["the Escape that closed the drawer also reached the page's key listeners: window capture"]);
    // A shell that closes the drawer itself, first, and lets the press go on: the drawer is shut before any page listener runs.
    for (const timing of ["sync", "microtask"] as const) {
      await load(page, drawer({ escapeClosesUnstopped: timing }));
      const shut = await drawerPass(page, "/");
      expect(passes(shut), timing).toEqual(["escape-in-shell"]);
      expect(shut.violations.map(v => v.detail), timing).toEqual([
        "the Escape that closed the drawer also reached the page's key listeners: window capture, document capture, document bubble, window bubble",
      ]);
    }
  });

  test("a followed link that leaves the drawer open is caught for the page already open and for another page", async ({ page }) => {
    // The shell's scroll lock, from mobile-drawer.module.css.
    await load(page, drawer({ closeOnLink: false }), "html:has(dialog[open]){overflow:hidden}");
    const r = await drawerPass(page, "/");
    expect(passes(r)).toEqual(["drawer-link-close"]);
    expect([...new Set(r.violations.map(v => v.selector))]).toEqual(["a[Home] -> /", "a[This page] -> /", "a[Another page] -> /other"]);
    expect(r.violations.filter(v => v.selector === "a[Another page] -> /other").map(v => v.detail)).toEqual([
      "following a link to another page: the drawer is still open",
      "following a link to another page: the page is still scroll-locked",
    ]);
  });

  test("contrast is measured inside the open drawer only: pale drawer text fails, pale page text behind it does not", async ({ page }) => {
    await load(page, drawer({ linkStyle: "color:#bbb" }));
    const pale = await drawerPass(page, "/");
    expect(passes(pale)).toEqual(["contrast"]);
    expect(pale.violations[0].detail).toMatch(/^drawer open: "This page" /);
    await load(page, drawer({ pageText: `<p style="color:#ccc">pale page copy behind the drawer</p>` }));
    expect((await drawerPass(page, "/")).violations).toEqual([]);
  });

  test("a page without the V34 header says so", async ({ page }) => {
    await load(page, `<header><nav><a href="/">x</a></nav></header><main><h1>t</h1></main>`);
    const r = await drawerPass(page, "/");
    expect(r.hasHeader).toBe(false);
    expect(r.violations.map(v => v.detail)).toEqual(["the page renders no V34 header"]);
  });
});

/*
  The More menu (WO-CI-14), on a stand-in for components/v34/shell/more-menu.tsx: a button and the
  panel it controls. The clean menu closes on Escape from a window capture listener that stops the
  press; the leaking one is the menu before WO-CI-14, a document listener that closes it and lets the
  press go on to every other listener.
*/
test.describe("More menu", () => {
  const menu = (leak = false) => `
    <header data-v34-header><button aria-expanded="false" aria-controls="p">More</button><div id="p" hidden><a href="/x">X</a></div></header>
    <main><h1>t</h1></main>
    <script>
      const b = document.querySelector("button"), p = document.getElementById("p");
      const set = open => { p.hidden = !open; b.setAttribute("aria-expanded", String(open)); };
      b.addEventListener("click", () => set(p.hidden));
      ${leak
        ? `document.addEventListener("keydown", e => { if (e.key === "Escape" && !p.hidden) { set(false); b.focus(); } });`
        : `addEventListener("keydown", e => { if (e.key !== "Escape" || p.hidden) return; e.stopImmediatePropagation(); set(false); b.focus(); }, true);`}
    </script>`;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("a clean menu passes; an Escape it consumes that also reaches the page's key listeners is caught", async ({ page }) => {
    await load(page, menu());
    expect(await moreMenuPass(page)).toEqual([]);
    await load(page, menu(true));
    const leak = await moreMenuPass(page);
    expect(leak.map(v => v.pass)).toEqual(["escape-in-shell"]);
    expect(leak[0].detail).toMatch(/^the Escape that closed the More menu also reached the page's key listeners: window capture, document capture/);
  });

  /*
    Every shell closer, by where its key listener sits, whether it stops the press and when the panel
    closes (React flushes a discrete update in a microtask, so the panel is already hidden when the next
    listener runs). The probe's listeners come after the shell's, as a page body's do: a stopped press
    reaches the positions before the shell's in dispatch order; a press that is not stopped reaches all
    four. Only a stop at window capture keeps the press in the shell. The pass must say so in every case,
    whatever the panel's state when a later listener runs (WO-CI-14 r2: it read that state and saw nothing).
  */
  const POSITIONS = ["window capture", "document capture", "document bubble", "window bubble"] as const;
  const closer = (at: (typeof POSITIONS)[number], stop: boolean, timing: "sync" | "microtask") => {
    const [target, phase] = at.split(" ");
    return `
      <header data-v34-header><button aria-expanded="false" aria-controls="p">More</button><div id="p" hidden><a href="/x">X</a></div></header>
      <main><h1>t</h1></main>
      <script>
        const b = document.querySelector("button"), p = document.getElementById("p");
        const set = open => { p.hidden = !open; b.setAttribute("aria-expanded", String(open)); };
        const close = () => { set(false); b.focus(); };
        b.addEventListener("click", () => set(p.hidden));
        ${target}.addEventListener("keydown", e => { if (e.key !== "Escape" || p.hidden) return; ${stop ? "e.stopImmediatePropagation();" : ""} ${timing === "sync" ? "close();" : "queueMicrotask(close);"} }, ${phase === "capture"});
      </script>`;
  };
  for (const [index, at] of POSITIONS.entries()) {
    for (const stop of [true, false]) {
      for (const timing of ["sync", "microtask"] as const) {
        const reached = stop ? POSITIONS.slice(0, index) : POSITIONS;
        test(`a closer at ${at}, ${stop ? "stopping" : "not stopping"} the press, closing ${timing}: ${reached.length ? "caught" : "passes"}`, async ({ page }) => {
          await load(page, closer(at, stop, timing));
          expect(await moreMenuPass(page)).toEqual(
            reached.length === 0 ? [] : [{ pass: "escape-in-shell", selector: '[id="p"]', detail: `the Escape that closed the More menu also reached the page's key listeners: ${reached.join(", ")}` }],
          );
        });
      }
    }
  }

  test("a page without the V34 header, or without a visible More button, says so", async ({ page }) => {
    await load(page, `<header><nav><a href="/">x</a></nav></header><main><h1>t</h1></main>`);
    expect((await moreMenuPass(page)).map(v => v.detail)).toEqual(["the page renders no V34 header"]);
    await load(page, `<header data-v34-header><button aria-controls="p" style="display:none">More</button><div id="p" hidden></div></header><main><h1>t</h1></main>`);
    expect((await moreMenuPass(page)).map(v => v.detail)).toEqual(["no visible More button at 1440px"]);
  });
});

/*
  WO-CI-27 (lead decision 19): "painted" is what the browser paints, not "inside a closed <details>".
  The class: a closed <details> whose body the page shows anyway (the wide footer's ::details-content
  is display: block and content-visibility: visible). Its contents are painted and tabbable, so every
  helper measures them; a plain closed body stays unpainted and stays skipped (the cases above).
*/
test.describe("painted closed details", () => {
  const SHOWN = `.shown::details-content{display:block;content-visibility:visible}`;
  const ring = ".r:focus-visible{outline:2px solid #00e}";

  /** Ground truth that does not use checkVisibility: the fixture's details is closed and its body is hit-tested. */
  async function paintedClosed(page: Page, selector: string): Promise<void> {
    expect(await page.locator(selector).first().evaluate(e => {
      const r = e.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 20), r.top + r.height / 2);
      return { open: e.closest("details")!.open, hit: !!hit && (hit === e || e.contains(hit) || hit.contains(e)) };
    })).toEqual({ open: false, hit: true });
  }

  test("clipping: text in a painted closed body is measured", async ({ page }) => {
    const rows = `<div style="width:120px;overflow:hidden"><details class="shown"><summary>plan limits</summary><ul style="width:400px;margin:0"><li id="t">closed list item that is wider than the box</li></ul></details></div>`;
    await load(page, rows, SHOWN);
    await paintedClosed(page, "#t");
    expect((await page.evaluate(measureClippedRows)).length).toBeGreaterThan(0);
    await load(page, `<details class="shown"><summary>q</summary><p id="t" style="width:60px;overflow:hidden;white-space:nowrap;margin:0">a long clipped sentence here</p></details>`, SHOWN);
    await paintedClosed(page, "#t");
    expect((await page.evaluate(measureClippedText)).some(v => v.pass === "clipped-text")).toBe(true);
    // The same fixtures without the shown body are not painted, so not measured.
    await load(page, rows);
    expect(await page.evaluate(measureClippedRows)).toEqual([]);
  });

  test("clipping: an element with no box of its own (display: contents) is judged where its content is painted", async ({ page }) => {
    await load(page, `<div style="width:120px;overflow:hidden;white-space:nowrap"><span style="display:contents">a very long line of text clipped by the box</span></div>`);
    expect((await page.evaluate(measureClippedRows)).length).toBeGreaterThan(0);
    // Its parent is a details, but its content goes to the details' body: shown, painted; closed, not painted.
    const inBody = `<div style="width:120px;overflow:hidden;white-space:nowrap"><details class="shown"><summary>s</summary><span style="display:contents">a very long line of text clipped by the box</span></details></div>`;
    await load(page, inBody, SHOWN);
    expect((await page.evaluate(measureClippedRows)).length).toBeGreaterThan(0);
    await load(page, inBody);
    expect(await page.evaluate(measureClippedRows)).toEqual([]);
  });

  test("a summary inside a closed body is not painted, so not sampled (/pricing: the questions inside 'Questions before you buy')", async ({ page }) => {
    const nested = `<main style="background:#fff;padding:12px"><details><summary>outer</summary><details><summary id="t" style="color:#ccc">inner pale question</summary><p>answer</p></details></details></main>`;
    await load(page, nested);
    expect((await contrastPass(page)).violations).toEqual([]);
    // Opened, the same pale summary is painted and fails.
    await load(page, nested.replace("<details>", "<details open>"));
    expect((await contrastPass(page)).violations.map(v => v.selector)).toEqual(["summary#t"]);
  });

  test("contrast: text and a control in a painted closed body are sampled", async ({ page }) => {
    const body = `<main style="background:#fff;padding:12px"><details class="shown"><summary>more</summary><a id="t" href="#x" style="color:#ccc">pale painted link</a><br><input style="border:1px solid #e2e2e2;background:#fff;padding:6px"></details></main>`;
    await load(page, body, SHOWN);
    await paintedClosed(page, "#t");
    expect((await contrastPass(page)).violations.map(v => v.selector)).toEqual(["a#t"]);
    expect(await controlContrastPass(page)).toHaveLength(1);
    await load(page, body);
    expect((await contrastPass(page)).violations).toEqual([]);
    expect(await controlContrastPass(page)).toEqual([]);
  });

  test("keyboard: a link in a painted closed body is owed a tab stop", async ({ page }) => {
    // The second button sends focus back to the first, so the walk ends on a trap and lists what it never reached.
    const pad = "padding:14px 20px";
    const body = `<button id="f" class="r" style="${pad}">first</button><button class="r" style="${pad}" onfocus="f.focus()">bounce</button><details class="shown"><summary class="r" style="${pad}">group</summary><a id="t" class="r" href="#x" style="display:inline-block;${pad}">painted link</a></details>`;
    await load(page, body, ring + SHOWN);
    await paintedClosed(page, "#t");
    const trap = (await keyboardWalk(page)).violations.filter(v => v.pass === "keyboard-trap").map(v => v.detail);
    expect(trap).toHaveLength(1);
    expect(trap[0]).toContain("a#t[painted link]");
    await load(page, body, ring);
    const plain = (await keyboardWalk(page)).violations.filter(v => v.pass === "keyboard-trap").map(v => v.detail);
    expect(plain).toHaveLength(1);
    expect(plain[0]).not.toContain("a#t[painted link]");
  });
});
