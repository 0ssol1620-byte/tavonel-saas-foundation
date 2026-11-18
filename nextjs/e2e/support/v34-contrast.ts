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
};

const HIDE_ATTR = "data-v34-contrast-hide";

type Paint = {
  fg: [number, number, number, number];
  border: [number, number, number, number];
  fill: [number, number, number, number];
  text: string;
  disabled: boolean;
  /** Everything a sample of the element depends on: its text, its disabled state, and the colours, fills and opacity of it and every ancestor. */
  state: string;
};

/**
 * Runs in the page: the element's paint as it is now. Its text colour carries the opacity of every ancestor, as in
 * collectTargets, whose canvas normalisation this repeats: a function evaluated in the page cannot share a closure.
 */
function readPaint(el: Element): Paint {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context to resolve a colour");
  const rgba = (value: string): [number, number, number, number] => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  let opacity = 1;
  const chain: string[] = [];
  for (let n: Element | null = el; n; n = n.parentElement) {
    const s = getComputedStyle(n);
    opacity *= Number(s.opacity);
    chain.push(`${s.color} ${s.backgroundColor} ${s.backgroundImage} ${s.borderTopColor} ${s.opacity} ${s.filter}`);
  }
  const s = getComputedStyle(el);
  const fg = rgba(s.color);
  fg[3] *= opacity;
  const text = (el.textContent ?? "").trim().slice(0, 40);
  const disabled = el.matches(":disabled, [aria-disabled='true']");
  return { fg, border: rgba(s.borderTopColor), fill: rgba(s.backgroundColor), text, disabled, state: `${text} ${disabled}\n${chain.join("\n")}` };
}

/**
 * Runs in the page: resolves when every finite animation or transition on the element or an ancestor has ended.
 * An infinite one never ends; the paint check in sampleSettled then decides whether it touches what is sampled.
 */
function transitionsEnded(el: Element): Promise<unknown> {
  const own = document.getAnimations().filter(a => {
    const effect = a.effect instanceof KeyframeEffect ? a.effect : null;
    const target = effect?.target ?? null;
    return effect !== null && target !== null && target.contains(el) && a.playState === "running" && Number.isFinite(Number(effect.getComputedTiming().endTime));
  });
  return Promise.all(own.map(a => a.finished.catch(() => undefined)));
}

const SAMPLE_ATTEMPTS = 3;

/**
 * Takes `sample` (the screenshots) between two reads of the element's paint and returns them only when both reads
 * agree, so the colour and the pixels belong to one state of the page. Read once at collection and sampled later,
 * they did not: in WebKit /world goes live 546-915 ms after load, after the matrix's 500 ms settle, and the pass read
 * the camera control's label while the control was disabled (#f2f7f0 at opacity 0.5) and took its surface after the
 * view had pressed it (#c9f2a5): 1.07:1 that no frame ever showed (WO-CI-31). Finite transitions are waited out first.
 * A paint that changes on every attempt is returned as null: the caller fails it, it is never passed.
 */
async function sampleSettled<T>(handle: Locator, sample: () => Promise<T>): Promise<{ paint: Paint; value: T } | null> {
  for (let attempt = 0; attempt < SAMPLE_ATTEMPTS; attempt++) {
    await handle.evaluate(transitionsEnded);
    const before = await handle.evaluate(readPaint);
    const value = await sample();
    const after = await handle.evaluate(readPaint);
    if (before.state === after.state) return { paint: after, value };
  }
  return null;
}

/** Runs in the page: elements that carry text (inside `scope` when given), deduplicated by (colour, size class, surface class). */
function collectTargets([max, scope]: [number, string | null]): Target[] {
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
  const all = [...document.querySelectorAll(scope ? `${scope} *` : "body *")]
    .filter(e => [...e.childNodes].some(n => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 1))
    .sort((a, b) => priority(a) - priority(b));
  document.querySelectorAll(`[${"data-v34-contrast-idx"}]`).forEach(e => e.removeAttribute("data-v34-contrast-idx"));
  // The predicate of v34-measure.ts (WO-CI-27): what the browser paints, e.g. not a closed <details> body unless the page shows it.
  const painted = (e: Element): boolean => {
    const opts = { contentVisibilityAuto: false, opacityProperty: false, visibilityProperty: false };
    if (getComputedStyle(e).display !== "contents") return e.checkVisibility(opts);
    const probe = e.appendChild(document.createElement("v34-paint-probe"));
    try { return probe.checkVisibility(opts); } finally { probe.remove(); }
  };
  for (const el of all) {
    if (el.closest("canvas, svg, [hidden], script, style")) continue;
    // An unpainted element's box is a leftover layout rect (a closed <details> body), and what a screenshot finds there is whatever sits beneath it.
    if (!painted(el)) continue;
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
  // A scrolling or clipping ancestor paints only its padding box: text that runs past it is not on screen, and a
  // screenshot of that part would sample the page behind the box (a mcpServers block wider than its region, 1.03:1).
  // Only ancestors in the element's containing-block chain clip it: a fixed element is clipped by none, an absolute one
  // skips the static ancestors before its containing block, and the root's overflow belongs to the viewport (bounded below).
  // ponytail: a transform counts as a containing block for absolute; filter/contain/will-change do not, so those clip less than CSS does.
  const clips: { l: number; t: number; r: number; b: number }[] = [];
  const own = getComputedStyle(el).position;
  let escaping = own === "absolute";
  for (let p = own === "fixed" ? null : el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
    const ps = getComputedStyle(p);
    if (escaping && ps.position === "static" && ps.transform === "none") continue;
    escaping = ps.position === "absolute";
    if (ps.overflowX !== "visible" || ps.overflowY !== "visible") {
      const pr = p.getBoundingClientRect();
      clips.push({ l: pr.left + p.clientLeft, t: pr.top + p.clientTop, r: pr.left + p.clientLeft + p.clientWidth, b: pr.top + p.clientTop + p.clientHeight });
    }
    if (ps.position === "fixed") break;
  }
  for (const n of el.childNodes) {
    if (n.nodeType !== Node.TEXT_NODE || (n.textContent ?? "").trim().length === 0) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      const trim = Number.isFinite(lineHeight) && lineHeight < r.height ? (r.height - lineHeight) / 2 : 0;
      const x0 = Math.max(0, Math.ceil(Math.max(r.left, ...clips.map(c => c.l))) + 1);
      const y0 = Math.max(0, Math.ceil(Math.max(r.top + trim, ...clips.map(c => c.t))) + 1);
      const x1 = Math.min(window.innerWidth, Math.floor(Math.min(r.right, ...clips.map(c => c.r))) - 1);
      const y1 = Math.min(window.innerHeight, Math.floor(Math.min(r.bottom - trim, ...clips.map(c => c.b))) - 1);
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
  /** Only text inside this selector is sampled (an open drawer, whose page behind is inert). */
  scope?: string;
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
  const targets = await page.evaluate(collectTargets, [options.max ?? 60, options.scope ?? null] as [number, string | null]);
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
      const got = await sampleSettled(handle, async () => {
        // Only the element's own text lines are sampled: its border, corners and child elements stay out.
        const own = await handle.evaluate(ownTextRects);
        const rects = await handle.evaluate(openRects, own);
        let ex: { dark: Rgb; light: Rgb } | null = null;
        for (const clip of rects) {
          const png = await page.screenshot({ type: "png", clip, timeout: 3000 });
          const e = await page.evaluate(extremes, png.toString("base64"));
          if (!e) continue;
          ex = ex
            ? { dark: luminance(e.dark) < luminance(ex.dark) ? e.dark : ex.dark, light: luminance(e.light) > luminance(ex.light) ? e.light : ex.light }
            : e;
        }
        return { lines: own.length, open: rects.length, ex };
      });
      await handle.evaluate((e, a) => e.removeAttribute(a), HIDE_ATTR);
      if (!got) {
        result.violations.push({ pass: "contrast", selector: t.selector, detail: `"${t.text}" changed colour while it was sampled, on each of ${SAMPLE_ATTEMPTS} attempts: not measured` });
        continue;
      }
      const { paint, value: { lines, open, ex } } = got;
      if (open < lines) {
        result.reported.push({ pass: "contrast", selector: t.selector, detail: `"${paint.text}" ${lines - open} of ${lines} line(s) under a fixed layer, not sampled` });
      }
      if (!ex) continue;
      const required = requiredRatio(t.fontPx, t.weight, t.kind);
      const worst = Math.min(
        ...[ex.dark, ex.light].map(bg => contrastRatio(composite(paint.fg, bg), bg)),
      );
      result.checked += 1;
      if (worst + 0.005 >= required) continue;
      const v: Violation = {
        pass: "contrast",
        selector: t.selector,
        detail: `"${paint.text}" ${worst.toFixed(2)}:1 needs ${required}:1 (${t.fontPx}px/${t.weight}, fg rgb(${paint.fg.slice(0, 3).join(",")}) over ${ex.dark.join(",")} .. ${ex.light.join(",")})`,
      };
      const rationale = Object.entries(options.exceptions ?? {}).find(([k]) => t.selector.includes(k))?.[1];
      if (paint.disabled) result.reported.push(v);
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
function collectControls([max, scope]: [number, string | null]): { index: number; selector: string; border: [number, number, number, number]; fill: [number, number, number, number]; borderPx: number }[] {
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
  const kinds = ["input:not([type=hidden]):not([type=checkbox]):not([type=radio])", "select", "textarea", "button", "[role=button]"];
  for (const el of document.querySelectorAll(kinds.map(k => (scope ? `${scope} ${k}` : k)).join(", "))) {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (s.display === "none" || s.visibility === "hidden" || r.width < 8 || r.height < 8 || el.matches(":disabled, [aria-disabled='true']")) continue;
    // The same rule as the text pass: a control in an unpainted closed <details> body has a leftover rect that samples whatever lies beneath. The matrix opens the details and measures it there.
    if (!el.checkVisibility({ contentVisibilityAuto: false, opacityProperty: false, visibilityProperty: false })) continue;
    const borderPx = parseFloat(s.borderTopWidth);
    if (s.borderTopStyle === "none" || borderPx <= 0) continue;
    const border = rgba(s.borderTopColor), fill = rgba(s.backgroundColor);
    // A transparent border on a transparent button draws no boundary, exactly as border: none does. It is
    // the forced-colours border (the system draws it in the user's colour), so there is nothing here to measure.
    // Buttons only: a text field, select or textarea drawn that way shows no edge at all, and still fails 1.4.11.
    if (border[3] < 0.05 && fill[3] < 0.05 && el.matches("button, [role=button]")) continue;
    const index = out.length;
    el.setAttribute("data-v34-control-idx", String(index));
    out.push({ index, selector: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : ""}`, border, fill, borderPx });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Non-text contrast, 3:1: a control's border (or, when the border is weaker, its fill) against the
 * surface behind it, the surface being sampled from a screenshot with the control hidden.
 */
export async function controlContrastPass(page: Page, max = 30, scope?: string): Promise<Violation[]> {
  const controls = await page.evaluate(collectControls, [max, scope ?? null] as [number, string | null]);
  const out: Violation[] = [];
  for (const c of controls) {
    const handle = page.locator(`[data-v34-control-idx="${c.index}"]`).first();
    try {
      await centreInView(handle);
      const box = await handle.boundingBox();
      if (!box || (await handle.evaluate(openRects, [box])).length === 0) continue;
      // The border and fill are read again around the screenshot, as in the text pass: one state for both.
      const got = await sampleSettled(handle, async () => {
        await handle.evaluate(e => ((e as HTMLElement).style.visibility = "hidden"));
        const rect = await handle.boundingBox();
        const png = rect ? await page.screenshot({ type: "png", clip: rect, timeout: 3000 }) : null;
        await handle.evaluate(e => ((e as HTMLElement).style.visibility = ""));
        return png;
      });
      if (!got) {
        out.push({ pass: "control-contrast", selector: c.selector, detail: `boundary changed colour while it was sampled, on each of ${SAMPLE_ATTEMPTS} attempts: not measured` });
        continue;
      }
      const { paint, value: png } = got;
      // Disabled since collection: skipped, as collectControls skips it.
      if (!png || paint.disabled) continue;
      const ex = await page.evaluate(extremes, png.toString("base64"));
      if (!ex) continue;
      const edge = (colour: readonly [number, number, number, number]) =>
        colour[3] < 0.05 ? 1 : Math.min(...[ex.dark, ex.light].map(bg => contrastRatio(composite(colour, bg), bg)));
      const best = Math.max(edge(paint.border), edge(paint.fill));
      if (best + 0.005 < 3) out.push({ pass: "control-contrast", selector: c.selector, detail: `boundary ${best.toFixed(2)}:1 needs 3:1 (border rgb(${paint.border.slice(0, 3).join(",")}) ${c.borderPx}px)` });
    } catch {
      await handle.evaluate(e => ((e as HTMLElement).style.visibility = "")).catch(() => undefined);
    }
  }
  return out;
}
