/**
 * V34 QA harness, Node-side passes (architecture section 5). Each pass takes a loaded Page and
 * returns Violation[]; none throws on a finding, so a caller can run every pass and report all
 * violations per route instead of stopping at the first.
 */

import type { Browser, BrowserContext, Page } from "@playwright/test";
import { measureOverflow } from "./overflow";
import { measureOverlap } from "./overlap";
import {
  measureClippedRows,
  measureClippedText,
  measureHeaderCover,
  measureOutsideBounds,
  measureSiblingOverlap,
  measureStructure,
  measureWordFragmentation,
  type Violation,
} from "./v34-measure";

export type { Violation } from "./v34-measure";

/** Viewport heights per width (the architecture's manual table; 412 is 412x915). */
export const V34_WIDTHS = [320, 360, 390, 412, 430, 768, 1024, 1280, 1440, 1920] as const;
export const V34_HEIGHTS: Record<number, number> = {
  320: 640, 360: 800, 390: 844, 412: 915, 430: 932, 768: 1024, 1024: 768, 1280: 800, 1440: 900, 1920: 1080,
};

/** Root overflow, interactive elements outside the viewport, clipped/occluded text, sibling overlap, text-on-text overlap. */
export async function layoutPass(page: Page): Promise<Violation[]> {
  const out: Violation[] = [];
  const overflow = await page.evaluate(measureOverflow);
  if (overflow.documentOverflow > 1) {
    out.push({ pass: "root-overflow", selector: "html", detail: `scrolls ${overflow.documentOverflow}px sideways` });
  }
  for (const o of overflow.offenders) out.push({ pass: "root-overflow", selector: o.selector, detail: `${o.reason} ${o.box}` });
  out.push(...(await page.evaluate(measureOutsideBounds)));
  out.push(...(await page.evaluate(measureClippedText)));
  out.push(...(await page.evaluate(measureSiblingOverlap)));
  out.push(...(await page.evaluate(measureClippedRows)));
  // Declared overlays sit over content on purpose: hide them while measuring everything else
  // (their own clipping is judged above, with them in place), and always restore.
  const hideOverlays = () => page.evaluate(() => {
    for (const e of document.querySelectorAll<HTMLElement>("[data-v34-overlay]")) {
      e.dataset.v34PrevVis = e.style.getPropertyValue("visibility") + "|" + e.style.getPropertyPriority("visibility");
      e.style.setProperty("visibility", "hidden", "important");
    }
  });
  const restoreOverlays = () => page.evaluate(() => {
    for (const e of document.querySelectorAll<HTMLElement>("[data-v34-overlay]")) {
      const [v, p] = (e.dataset.v34PrevVis ?? "|").split("|");
      if (v) e.style.setProperty("visibility", v, p); else e.style.removeProperty("visibility");
      delete e.dataset.v34PrevVis;
    }
  });
  await hideOverlays();
  try {
    const overlaps = await page.evaluate(measureOverlap);
    for (const o of overlaps) {
      if (o.kind === "text-overlap" || o.kind === "text-clipped" || o.kind === "fixed-covers") out.push({ pass: o.kind, selector: `${o.a} / ${o.b}`, detail: o.text.slice(0, 60) });
    }
  } finally {
    await restoreOverlays();
  }
  out.push(...(await page.evaluate(measureHeaderCover)));
  return out;
}

/** Heading and bold word fragmentation, one h1, landmarks. */
export async function textStructurePass(page: Page): Promise<Violation[]> {
  return [...(await page.evaluate(measureWordFragmentation)), ...(await page.evaluate(measureStructure))];
}

/** The computed `color-scheme` of the root; V34 renders its light palette in both OS appearances. */
export async function colorSchemePass(page: Page, expected = "light"): Promise<Violation[]> {
  const actual = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
  return actual.trim() === expected
    ? []
    : [{ pass: "color-scheme", selector: "html", detail: `computed color-scheme "${actual}", expected "${expected}"` }];
}

/** Reduced motion: no running animation, no element declaring `data-animating="true"`. Call after emulateMedia reduce. */
export async function reducedMotionPass(page: Page): Promise<Violation[]> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(300);
  const found = await page.evaluate(() => ({
    running: document
      .getAnimations()
      .filter(a => a.playState === "running")
      .map(a => `${(a.effect as KeyframeEffect | null)?.target?.tagName?.toLowerCase() ?? "?"}:${(a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? a.id}`),
    animating: [...document.querySelectorAll('[data-animating="true"]')].map(e => e.tagName.toLowerCase()),
    media: [...document.querySelectorAll("video, audio")].filter(m => (m as HTMLMediaElement).autoplay && !(m as HTMLMediaElement).paused).length,
  }));
  const out: Violation[] = found.running.map(r => ({ pass: "reduced-motion", selector: r, detail: "animation still running" }));
  for (const a of found.animating) out.push({ pass: "reduced-motion", selector: a, detail: 'data-animating="true"' });
  if (found.media) out.push({ pass: "reduced-motion", selector: "video,audio", detail: `${found.media} autoplaying media` });
  return out;
}

/**
 * Forced colors: buttons keep a border, selected controls an outline or border, and nothing sets
 * `forced-color-adjust: none` outside canvas and svg.
 */
export async function forcedColorsPass(page: Page): Promise<Violation[]> {
  await page.emulateMedia({ forcedColors: "active" });
  const found = await page.evaluate(() => {
    const out: { selector: string; detail: string }[] = [];
    const name = (e: Element) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""}${typeof e.className === "string" && e.className ? `.${e.className.split(/\s+/)[0]}` : ""}`;
    for (const b of document.querySelectorAll("button, [role=button]")) {
      const s = getComputedStyle(b);
      if (s.display === "none" || s.visibility === "hidden" || b.getBoundingClientRect().width === 0) continue;
      if (s.borderTopStyle === "none" && s.outlineStyle === "none" && s.boxShadow === "none") {
        out.push({ selector: name(b), detail: "no visible border, outline or shadow under forced colors" });
      }
    }
    for (const sel of document.querySelectorAll('[aria-selected="true"], [aria-current="page"], [aria-pressed="true"]')) {
      const s = getComputedStyle(sel);
      if (s.outlineStyle === "none" && s.borderTopStyle === "none" && s.textDecorationLine === "none") {
        out.push({ selector: name(sel), detail: "selected state has no outline, border or underline" });
      }
    }
    const all = [document.documentElement, document.body, ...document.querySelectorAll("main *")].slice(0, 600);
    for (const e of all) {
      if (e.closest("canvas, svg")) continue;
      if (getComputedStyle(e).forcedColorAdjust === "none") out.push({ selector: name(e), detail: "forced-color-adjust: none" });
    }
    return out.slice(0, 40);
  });
  return found.map(f => ({ pass: "forced-colors", ...f }));
}

/**
 * Hover, focus, selected, disabled and error states, where the page has them. A control passes
 * when its state changes at least one painted property against its resting style (or, for
 * selected, against an unselected sibling). Samples at most 12 hover targets per page.
 */
export async function statePass(page: Page): Promise<Violation[]> {
  const out: Violation[] = [];
  const sig = (el: Element) => {
    const s = getComputedStyle(el);
    return [s.color, s.backgroundColor, s.borderTopColor, s.borderTopWidth, s.outlineStyle, s.boxShadow, s.textDecorationLine, s.opacity, s.transform].join("|");
  };
  const controls = page.locator("main a[href]:visible, main button:not([disabled]):visible, header a[href]:visible");
  const count = Math.min(await controls.count(), 12);
  for (let i = 0; i < count; i++) {
    const c = controls.nth(i);
    if (!(await c.isVisible())) continue;
    await c.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    const rest = await c.evaluate(sig);
    await c.hover({ trial: false, timeout: 2000 }).catch(() => undefined);
    const hovered = await c.evaluate(sig);
    const label = await c.evaluate(e => `${e.tagName.toLowerCase()}[${(e.textContent ?? "").trim().slice(0, 24)}]`);
    // `transition` may still be in flight; give it one frame group before judging.
    await page.waitForTimeout(260);
    const settled = await c.evaluate(sig);
    if (rest === settled && rest === hovered) out.push({ pass: "state-hover", selector: label, detail: "hover changes nothing painted" });
    await c.focus();
    const focusSig = await c.evaluate(e => {
      const s = getComputedStyle(e);
      return s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0 ? "outline" : s.boxShadow !== "none" ? "shadow" : "";
    });
    if (!focusSig) out.push({ pass: "state-focus", selector: label, detail: "focus shows no outline or box-shadow" });
  }
  const aux = await page.evaluate(() => {
    const name = (e: Element) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""}`;
    const sg = (el: Element) => {
      const s = getComputedStyle(el);
      return [s.color, s.backgroundColor, s.borderTopColor, s.fontWeight, s.textDecorationLine].join("|");
    };
    const res: { pass: string; selector: string; detail: string }[] = [];
    for (const sel of document.querySelectorAll('[aria-selected="true"], [aria-pressed="true"], [aria-current="true"], [aria-current="page"]')) {
      const sibling = [...(sel.parentElement?.children ?? [])].find(s => s !== sel && s.tagName === sel.tagName && s.getAttribute("aria-selected") !== "true" && s.getAttribute("aria-pressed") !== "true" && !s.hasAttribute("aria-current"));
      if (sibling && sg(sel) === sg(sibling)) res.push({ pass: "state-selected", selector: name(sel), detail: "selected looks the same as an unselected sibling" });
    }
    for (const d of document.querySelectorAll(":disabled, [aria-disabled='true']")) {
      const s = getComputedStyle(d);
      if (s.opacity === "1" && s.cursor !== "not-allowed" && s.cursor !== "default") res.push({ pass: "state-disabled", selector: name(d), detail: "disabled has no opacity or cursor difference (reported)" });
    }
    for (const bad of document.querySelectorAll("[aria-invalid='true']")) {
      const good = [...document.querySelectorAll("input, textarea, select")].find(i => i !== bad && i.getAttribute("aria-invalid") !== "true" && i.tagName === bad.tagName);
      if (good && sg(bad) === sg(good)) res.push({ pass: "state-error", selector: name(bad), detail: "invalid control looks the same as a valid one" });
      if (!bad.getAttribute("aria-describedby") && !bad.closest("label")?.querySelector("[role=alert]")) res.push({ pass: "state-error", selector: name(bad), detail: "invalid control has no described error message" });
    }
    return res;
  });
  return [...out, ...aux.filter(a => a.pass !== "state-disabled")];
}

/** Opens a context at `width x height` for a pass, with the OS appearance and optional device scale factor. */
export async function openContext(
  browser: Browser,
  width: number,
  opts: { colorScheme?: "light" | "dark"; deviceScaleFactor?: number; height?: number; javaScriptEnabled?: boolean } = {},
): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width, height: opts.height ?? V34_HEIGHTS[width] ?? 900 },
    colorScheme: opts.colorScheme ?? "light",
    deviceScaleFactor: opts.deviceScaleFactor ?? 1,
    javaScriptEnabled: opts.javaScriptEnabled ?? true,
  });
}

/**
 * 200% browser zoom, as a browser applies it (the contrast-zoom-audit technique): the CSS
 * viewport halves and the device pixel ratio doubles. Only meaningful for widths >= 640.
 */
export function openZoomedContext(browser: Browser, width: number, colorScheme: "light" | "dark" = "light"): Promise<BrowserContext> {
  const height = Math.round((V34_HEIGHTS[width] ?? 900) / 2);
  return openContext(browser, Math.round(width / 2), { colorScheme, deviceScaleFactor: 2, height });
}

/** 200% text zoom: `html { font-size: 200% }` injected, then the caller re-runs the layout pass. */
export async function applyTextZoom200(page: Page): Promise<void> {
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await page.waitForTimeout(150);
}

/** Runs every named pass, tags each violation with the pass group, and never throws on a finding. */
export async function collect(runs: Record<string, () => Promise<Violation[]>>): Promise<Violation[]> {
  const all: Violation[] = [];
  for (const [name, run] of Object.entries(runs)) {
    try {
      all.push(...(await run()));
    } catch (error) {
      all.push({ pass: `${name}:error`, selector: "-", detail: error instanceof Error ? error.message.split("\n")[0] : String(error) });
    }
  }
  return all;
}
