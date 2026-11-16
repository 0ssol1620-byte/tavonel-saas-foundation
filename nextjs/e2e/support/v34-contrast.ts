/**
 * Rendered-pixel contrast (architecture section 5). The approach of contrast-zoom-audit.spec.ts
 * (colour from the browser's resolved style, normalised through a canvas, WCAG ratio) extended to
 * surfaces that audit calls unmeasurable: the background is not read from CSS but sampled from a
 * screenshot of the element's box with its text hidden, and the minimum and maximum luminance
 * pixels of that box stand for the gradient extremes. The text passes only if it holds against both.
 *
 * Thresholds are WCAG 2.1 AA as published: 4.5 normal text, 3.0 large text (>= 24px, or >= 18.66px
 * at weight >= 700), 3.0 for control boundaries. Disabled controls are reported, not failed.
 */

import type { Locator, Page } from "@playwright/test";
import type { Violation } from "./v34-measure";

export type Rgb = readonly [number, number, number];

export function luminance([r, g, b]: Rgb): number {
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Foreground with alpha over an opaque background. */
export function composite(fg: readonly [number, number, number, number], bg: Rgb): Rgb {
  return [0, 1, 2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3])) as unknown as Rgb;
}

export function requiredRatio(fontPx: number, weight: number, kind: "text" | "control"): number {
  if (kind === "control") return 3;
  return fontPx >= 24 || (fontPx >= 18.66 && weight >= 700) ? 3 : 4.5;
}

type Target = {
  index: number;
  selector: string;
  text: string;
  fg: [number, number, number, number];
  fontPx: number;
  weight: number;
  kind: "text" | "control";
  disabled: boolean;
};

const HIDE_ATTR = "data-v34-contrast-hide";

/** Runs in the page: elements that carry text, deduplicated by (colour, size class, surface class). */
function collectTargets(max: number): Target[] {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  const rgba = (value: string): [number, number, number, number] => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const seen = new Set<string>();
  const out: Target[] = [];
  const priority = (e: Element) => (e.matches("h1,h2,h3,a,button,label,summary,[role=button]") ? 0 : 1);
  const all = [...document.querySelectorAll("body *")]
    .filter(e => [...e.childNodes].some(n => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 1))
    .sort((a, b) => priority(a) - priority(b));
  document.querySelectorAll(`[${"data-v34-contrast-idx"}]`).forEach(e => e.removeAttribute("data-v34-contrast-idx"));
  for (const el of all) {
    if (el.closest("canvas, svg, [hidden], script, style")) continue;
    // A closed <details> body is not painted: its box is a leftover layout rect, and what a screenshot finds there is whatever sits beneath it.
    if (el.closest("details:not([open])") && !el.closest("summary")) continue;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (s.display === "none" || s.visibility === "hidden" || r.width < 2 || r.height < 2) continue;
    let opacity = 1;
    for (let n: Element | null = el; n; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
    if (opacity === 0) continue;
    const fg = rgba(s.color);
    fg[3] *= opacity;
    const fontPx = parseFloat(s.fontSize);
    const weight = Number(s.fontWeight) || 400;
    const surface = [...(el.parentElement?.classList ?? [])][0] ?? el.parentElement?.tagName ?? "";
    const named = el.matches("a, button, h1, h2, h3, label, summary, figcaption, [role=button]");
    const key = `${fg.join(",")}|${fontPx >= 24 ? "L" : fontPx}|${weight >= 700}|${surface}${named ? `|${el.tagName}` : ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const index = out.length;
    el.setAttribute("data-v34-contrast-idx", String(index));
    out.push({
      index,
      selector: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : ""}`,
      text: (el.textContent ?? "").trim().slice(0, 40),
      fg,
      fontPx,
      weight,
      kind: "text",
      disabled: el.matches(":disabled, [aria-disabled='true']"),
    });
    if (out.length >= max) break;
  }
  return out;
}

/** Runs in the page: decode a PNG (base64) and return the darkest and lightest pixel by luminance. */
async function extremes(b64: string): Promise<{ dark: Rgb; light: Rgb } | null> {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const lum = (r: number, g: number, b: number) => {
    const f = (v: number) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  let lo = Infinity;
  let hi = -Infinity;
  let dark: Rgb = [0, 0, 0];
  let light: Rgb = [255, 255, 255];
  for (let i = 0; i < d.length; i += 4) {
    const l = lum(d[i], d[i + 1], d[i + 2]);
    if (l < lo) { lo = l; dark = [d[i], d[i + 1], d[i + 2]]; }
    if (l > hi) { hi = l; light = [d[i], d[i + 1], d[i + 2]]; }
  }
  return { dark, light };
}

/**
 * Runs in the page: viewport rects of the element's own text nodes (not its children's), shrunk
 * inward to whole pixels so a border or rounded corner never enters the sample. At most 8 lines.
 */
function ownTextRects(el: Element): { x: number; y: number; width: number; height: number }[] {
  const out: { x: number; y: number; width: number; height: number }[] = [];
  // A text rect is the font's content area, which is taller than the line box when the leading is tight
  // (a display heading at line-height 1.01): its edges then hold the neighbouring lines' glyphs. Sample the line box.
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
  for (const n of el.childNodes) {
    if (n.nodeType !== Node.TEXT_NODE || (n.textContent ?? "").trim().length === 0) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      const trim = Number.isFinite(lineHeight) && lineHeight < r.height ? (r.height - lineHeight) / 2 : 0;
      const x0 = Math.max(0, Math.ceil(r.left) + 1);
      const y0 = Math.max(0, Math.ceil(r.top + trim) + 1);
      const x1 = Math.min(window.innerWidth, Math.floor(r.right) - 1);
      const y1 = Math.min(window.innerHeight, Math.floor(r.bottom - trim) - 1);
      if (x1 - x0 >= 2 && y1 - y0 >= 2) out.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
      if (out.length >= 8) return out;
    }
  }
  return out;
}

/**
 * Runs in the page: the rects whose centre is not covered by a position: fixed layer outside the
 * element (a consent panel over the footer). What a screenshot finds there is the layer, not the
 * element's surface, so the layer's pixels are never attributed to text or a control beneath it.
 */
function openRects(el: Element, rects: { x: number; y: number; width: number; height: number }[]) {
  return rects.filter(r => {
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    if (!top || top === el || el.contains(top) || top.contains(el)) return true;
    for (let n: Element | null = top; n && !n.contains(el); n = n.parentElement) {
      if (getComputedStyle(n).position === "fixed") return false;
    }
    return true;
  });
}

export type ContrastOptions = {
  /** Maximum number of sampled elements per page. */
  max?: number;
  /** Receipt exceptions: selector substring -> rationale. Matching findings are returned in `excepted`, not `violations`. */
  exceptions?: Record<string, string>;
};

export type ContrastResult = {
  violations: Violation[];
  excepted: (Violation & { rationale: string })[];
  reported: Violation[];
  checked: number;
};

/**
 * Brings an element to the middle of the viewport without animation. Scrolling it "into view" can
 * leave it flush with the top edge, under a sticky header whose pixels then land in the sample, and
 * a page with `scroll-behavior: smooth` would still be moving when the screenshot is taken.
 */
async function centreInView(handle: Locator): Promise<void> {
  await handle.evaluate(e => e.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }), undefined, { timeout: 2000 });
}

/** Pixel-sampled text contrast for the current page state. */
export async function contrastPass(page: Page, options: ContrastOptions = {}): Promise<ContrastResult> {
  const targets = await page.evaluate(collectTargets, options.max ?? 60);
  /*
    Every glyph on the page is made transparent (fill and decoration, not `color`, so a currentColor background or border still paints) for the duration of the pass, not only the element
    under test. A line's sample box is the line itself, and at tight leading the neighbouring lines'
    descenders and ascenders reach into it (a 75px headline at line-height 1.01); what must be found
    there is the surface, and any other text would be read as the lightest or darkest background.
  */
  const sheet = await page.addStyleTag({
    content: `html, html * { text-shadow: none !important; caret-color: transparent !important; -webkit-text-fill-color: transparent !important; text-decoration-color: transparent !important; }`,
  });
  const result: ContrastResult = { violations: [], excepted: [], reported: [], checked: 0 };
  for (const t of targets) {
    const handle = page.locator(`[data-v34-contrast-idx="${t.index}"]`).first();
    try {
      await centreInView(handle);
      await handle.evaluate((e, a) => e.setAttribute(a, ""), HIDE_ATTR);
      // Only the element's own text lines are sampled: its border, corners and child elements stay out.
      const own = await handle.evaluate(ownTextRects);
      const rects = await handle.evaluate(openRects, own);
      if (rects.length < own.length) {
        result.reported.push({ pass: "contrast", selector: t.selector, detail: `"${t.text}" ${own.length - rects.length} of ${own.length} line(s) under a fixed layer, not sampled` });
      }
      let ex: { dark: Rgb; light: Rgb } | null = null;
      for (const clip of rects) {
        const png = await page.screenshot({ type: "png", clip, timeout: 3000 });
        const e = await page.evaluate(extremes, png.toString("base64"));
        if (!e) continue;
        ex = ex
          ? { dark: luminance(e.dark) < luminance(ex.dark) ? e.dark : ex.dark, light: luminance(e.light) > luminance(ex.light) ? e.light : ex.light }
          : e;
      }
      await handle.evaluate((e, a) => e.removeAttribute(a), HIDE_ATTR);
      if (!ex) continue;
      const required = requiredRatio(t.fontPx, t.weight, t.kind);
      const worst = Math.min(
        ...[ex.dark, ex.light].map(bg => contrastRatio(composite(t.fg, bg), bg)),
      );
      result.checked += 1;
      if (worst + 0.005 >= required) continue;
      const v: Violation = {
        pass: "contrast",
        selector: t.selector,
        detail: `"${t.text}" ${worst.toFixed(2)}:1 needs ${required}:1 (${t.fontPx}px/${t.weight}, fg rgb(${t.fg.slice(0, 3).join(",")}) over ${ex.dark.join(",")} .. ${ex.light.join(",")})`,
      };
      const rationale = Object.entries(options.exceptions ?? {}).find(([k]) => t.selector.includes(k))?.[1];
      if (t.disabled) result.reported.push(v);
      else if (rationale) result.excepted.push({ ...v, rationale });
      else result.violations.push(v);
    } catch {
      await handle.evaluate((e, a) => e.removeAttribute(a), HIDE_ATTR).catch(() => undefined);
    }
  }
  await sheet.evaluate(e => e.remove()).catch(() => undefined);
  return result;
}

/**
 * Opens every closed <details> in `main` and returns how many it opened. Only content disclosures:
 * a <details> in the header is a site menu, and an open menu sheet lies over the content, so a
 * control under it would be measured against the menu (/evaluation at 412: the legacy header's
 * phone menu over the message field, 2.08:1).
 */
export function openContentDetails(page: Page): Promise<number> {
  return page.evaluate(() => {
    const shut = [...document.querySelectorAll("main details:not([open])")] as HTMLDetailsElement[];
    shut.forEach(d => (d.open = true));
    return shut.length;
  });
}

/** Runs in the page: visible bordered controls and their resolved border/fill colours. */
function collectControls(max: number): { index: number; selector: string; border: [number, number, number, number]; fill: [number, number, number, number]; borderPx: number }[] {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  const rgba = (value: string): [number, number, number, number] => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const out: { index: number; selector: string; border: [number, number, number, number]; fill: [number, number, number, number]; borderPx: number }[] = [];
  document.querySelectorAll("[data-v34-control-idx]").forEach(e => e.removeAttribute("data-v34-control-idx"));
  for (const el of document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, button, [role=button]")) {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (s.display === "none" || s.visibility === "hidden" || r.width < 8 || r.height < 8 || el.matches(":disabled, [aria-disabled='true']")) continue;
    // The same rule as the text pass: a control in a closed <details> body is not painted, and its leftover rect samples whatever lies beneath. The matrix opens the details and measures it there.
    if (el.closest("details:not([open])") && !el.closest("summary")) continue;
    const borderPx = parseFloat(s.borderTopWidth);
    if (s.borderTopStyle === "none" || borderPx <= 0) continue;
    const index = out.length;
    el.setAttribute("data-v34-control-idx", String(index));
    out.push({ index, selector: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : ""}`, border: rgba(s.borderTopColor), fill: rgba(s.backgroundColor), borderPx });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Non-text contrast, 3:1: a control's border (or, when the border is weaker, its fill) against the
 * surface behind it, the surface being sampled from a screenshot with the control hidden.
 */
export async function controlContrastPass(page: Page, max = 30): Promise<Violation[]> {
  const controls = await page.evaluate(collectControls, max);
  const out: Violation[] = [];
  for (const c of controls) {
    const handle = page.locator(`[data-v34-control-idx="${c.index}"]`).first();
    try {
      await centreInView(handle);
      const box = await handle.boundingBox();
      if (!box || (await handle.evaluate(openRects, [box])).length === 0) continue;
      await handle.evaluate(e => ((e as HTMLElement).style.visibility = "hidden"));
      const rect = await handle.boundingBox();
      const png = rect ? await page.screenshot({ type: "png", clip: rect, timeout: 3000 }) : null;
      await handle.evaluate(e => ((e as HTMLElement).style.visibility = ""));
      if (!png) continue;
      const ex = await page.evaluate(extremes, png.toString("base64"));
      if (!ex) continue;
      const edge = (paint: readonly [number, number, number, number]) =>
        paint[3] < 0.05 ? 1 : Math.min(...[ex.dark, ex.light].map(bg => contrastRatio(composite(paint, bg), bg)));
      const best = Math.max(edge(c.border), edge(c.fill));
      if (best + 0.005 < 3) out.push({ pass: "control-contrast", selector: c.selector, detail: `boundary ${best.toFixed(2)}:1 needs 3:1 (border rgb(${c.border.slice(0, 3).join(",")}) ${c.borderPx}px)` });
    } catch {
      await handle.evaluate(e => ((e as HTMLElement).style.visibility = "")).catch(() => undefined);
    }
  }
  return out;
}
