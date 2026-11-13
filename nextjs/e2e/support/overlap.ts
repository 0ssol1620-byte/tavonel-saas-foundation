/**
 * Text and layout collisions on a rendered page (founder report 2026-11-10).
 *
 * The founder's example: the /docs/concepts lifecycle diagram printed its edge labels
 * ("compile", "activate", "read back") across the borders of the boxes on either side. No check
 * saw it. `measureOverflow` (support/overflow.ts) asks whether something leaves the viewport, and
 * this asks the other question -- whether two things that are both inside the viewport are drawn
 * on top of each other. Four measurements:
 *
 *   text-overlap   two visible text runs from different text nodes share pixels;
 *   text-on-edge   a text run crosses a visible border of a box, or an SVG outline (a box edge,
 *                  an arrow, an arrowhead) is drawn through an SVG label;
 *   text-spill     a text run reaches more than 2px past the side of the nearest box that paints
 *                  a border or a background around it (the box ends, the words do not);
 *   page-scroll    the document itself scrolls sideways;
 *   text-clipped   a text container that clips (`overflow: hidden|clip`) is narrower than its
 *                  text -- the words are cut off without an ellipsis that says so;
 *   fixed-covers   a fixed or sticky element covers text that is not its own, at load.
 *
 * Self-contained on purpose: Playwright serialises it into the page. Geometry is read in CSS px
 * of the viewport, at the current scroll position (the caller loads the page and does not
 * scroll).
 */

export type OverlapFinding = {
  kind: "text-overlap" | "text-on-edge" | "text-spill" | "page-scroll" | "text-clipped" | "fixed-covers";
  a: string;
  b: string;
  text: string;
  box: string;
};

/** Runs in the page. */
export function measureOverlap(): OverlapFinding[] {
  const findings: OverlapFinding[] = [];
  const LIMIT = 40;
  type Box = { left: number; top: number; right: number; bottom: number };

  const describe = (element: Element) => {
    const tag = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id}` : "";
    const raw = element.getAttribute("class") ?? "";
    const cls = raw.trim() ? `.${raw.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
    const parent = element.parentElement;
    const parentRaw = parent?.getAttribute("class") ?? "";
    const parentName = parent && parent !== document.body
      ? `${parent.tagName.toLowerCase()}${parentRaw.trim() ? `.${parentRaw.trim().split(/\s+/)[0]}` : ""} > `
      : "";
    return `${parentName}${tag}${id}${cls}`.slice(0, 140);
  };
  const fmt = (box: Box) => `${Math.round(box.right - box.left)}x${Math.round(box.bottom - box.top)} at ${Math.round(box.left)},${Math.round(box.top)}`;
  const intersect = (a: Box, b: Box): Box | null => {
    const left = Math.max(a.left, b.left), right = Math.min(a.right, b.right);
    const top = Math.max(a.top, b.top), bottom = Math.min(a.bottom, b.bottom);
    return right > left && bottom > top ? { left, top, right, bottom } : null;
  };
  const push = (finding: OverlapFinding) => {
    if (findings.length >= LIMIT) return;
    // One report per collision; the same pair of components on every line of a paragraph is one.
    if (findings.some(seen => seen.kind === finding.kind && seen.a === finding.a && seen.b === finding.b && seen.text === finding.text)) return;
    findings.push(finding);
  };

  /* Visibility, walked once per element and cached. Opacity 0 anywhere above hides the run, and a
     one-pixel clipped box is the visually-hidden pattern, which a screen reader reads and nobody sees. */
  const hiddenCache = new Map<Element, boolean>();
  const hidden = (element: Element | null): boolean => {
    if (!element || element === document.documentElement) return false;
    const cached = hiddenCache.get(element);
    if (cached !== undefined) return cached;
    const style = getComputedStyle(element);
    let result = style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse"
      || Number(style.opacity) === 0;
    if (!result && (style.clip === "rect(0px, 0px, 0px, 0px)" || /inset\(\s*50%/.test(style.clipPath))) result = true;
    if (!result && element instanceof HTMLElement && style.position === "absolute" && element.offsetWidth <= 1 && element.offsetHeight <= 1) result = true;
    /* The body of a closed <details> keeps a laid-out box in Chromium (its slot is
       `content-visibility: hidden`), so it measures as if drawn. It is not drawn. */
    const parent = element.parentElement;
    if (!result && parent instanceof HTMLDetailsElement && !parent.open && element.tagName !== "SUMMARY") result = true;
    if (!result && parent && getComputedStyle(parent).contentVisibility === "hidden") result = true;
    if (!result) result = hidden(parent);
    hiddenCache.set(element, result);
    return result;
  };

  /* What the ancestors' clipping leaves visible of a box. A run that a clipping ancestor cuts
     away is not drawn, so it collides with nothing (and is reported as clipped instead, below). */
  const clipCache = new Map<Element, Box | null>();
  const viewport: Box = { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 };
  const clipOf = (element: Element | null): Box | null => {
    if (!element || element === document.documentElement || element === document.body) return viewport;
    if (clipCache.has(element)) return clipCache.get(element)!;
    const above = clipOf(element.parentElement);
    let result = above;
    const style = getComputedStyle(element);
    if (above && (style.overflowX !== "visible" || style.overflowY !== "visible") && !(element instanceof SVGElement)) {
      const r = element.getBoundingClientRect();
      const own: Box = {
        left: style.overflowX === "visible" ? -1e6 : r.left,
        right: style.overflowX === "visible" ? 1e6 : r.right,
        top: style.overflowY === "visible" ? -1e6 : r.top,
        bottom: style.overflowY === "visible" ? 1e6 : r.bottom,
      };
      result = intersect(above, own);
    }
    clipCache.set(element, result);
    return result;
  };

  /* 1. Collect the visible text runs: one rect per line of every HTML text node, one bbox per SVG
        <text>. */
  type Run = { id: number; owner: Element; box: Box; text: string; svg: SVGSVGElement | null };
  const runs: Run[] = [];
  let nextId = 0;
  const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TITLE", "DESC", "OPTION"]);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const owner = node.parentElement;
    if (!owner || skip.has(owner.tagName.toUpperCase()) || !node.textContent?.trim()) continue;
    if (owner.closest("svg")) continue;
    if (hidden(owner)) continue;
    const clip = clipOf(owner);
    if (!clip) continue;
    range.selectNodeContents(node);
    const id = nextId++;
    for (const rect of range.getClientRects()) {
      if (rect.width < 1 || rect.height < 1) continue;
      const box = intersect(rect, clip);
      if (box) runs.push({ id, owner, box, text: node.textContent.trim().slice(0, 40), svg: null });
    }
  }
  for (const label of document.querySelectorAll("svg text")) {
    if (hidden(label) || label.closest("defs, symbol, marker, pattern, mask, clipPath")) continue;
    const rect = label.getBoundingClientRect();
    const clip = clipOf(label.closest("svg")!.parentElement);
    const box = clip && rect.width >= 1 && rect.height >= 1 ? intersect(rect, clip) : null;
    if (!box || !label.textContent?.trim()) continue;
    // A <tspan> inside a <text> is the same label; only the outermost <text> is measured.
    if (label.parentElement?.closest("text")) continue;
    runs.push({ id: nextId++, owner: label, box, text: label.textContent.trim().slice(0, 40), svg: label.closest("svg") });
  }

  /* 2. text-overlap. Content-area rects of neighbouring lines touch, and tight display leading
        lets them overlap by a fifth of a line; a collision is deeper than that. */
  const sorted = [...runs].sort((a, b) => a.box.top - b.box.top);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length && sorted[j].box.top < a.box.bottom; j++) {
      const b = sorted[j];
      if (a.id === b.id) continue;
      const hit = intersect(a.box, b.box);
      if (!hit) continue;
      const depth = Math.min(a.box.bottom - a.box.top, b.box.bottom - b.box.top);
      if (hit.right - hit.left < 3 || hit.bottom - hit.top < depth * 0.4) continue;
      push({ kind: "text-overlap", a: describe(a.owner), b: describe(b.owner), text: `"${a.text}" / "${b.text}"`, box: fmt(hit) });
    }
  }

  /* 3a. text-on-edge, HTML: a run that crosses a visible border strip of any box. An inline
         element's own border is drawn outside its content area, so its own text never reaches it. */
  const strips: { owner: Element; box: Box }[] = [];
  for (const element of document.querySelectorAll("body *")) {
    if (element instanceof SVGElement || hidden(element)) continue;
    const style = getComputedStyle(element);
    const r = element.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const clip = clipOf(element.parentElement);
    if (!clip) continue;
    const side = (name: "Top" | "Right" | "Bottom" | "Left") => {
      const width = parseFloat(style.getPropertyValue(`border-${name.toLowerCase()}-width`));
      const kind = style.getPropertyValue(`border-${name.toLowerCase()}-style`);
      const color = style.getPropertyValue(`border-${name.toLowerCase()}-color`);
      if (!(width >= 1) || kind === "none" || kind === "hidden" || /rgba\([^)]*,\s*0\)|transparent/.test(color)) return;
      const box = name === "Top" ? { left: r.left, right: r.right, top: r.top, bottom: r.top + width }
        : name === "Bottom" ? { left: r.left, right: r.right, top: r.bottom - width, bottom: r.bottom }
          : name === "Left" ? { left: r.left, right: r.left + width, top: r.top, bottom: r.bottom }
            : { left: r.right - width, right: r.right, top: r.top, bottom: r.bottom };
      const visible = intersect(box, clip);
      if (visible) strips.push({ owner: element, box: visible });
    };
    side("Top"); side("Right"); side("Bottom"); side("Left");
  }
  for (const run of runs) {
    if (run.svg) continue;
    for (const strip of strips) {
      const display = getComputedStyle(strip.owner).display;
      if ((display === "inline" || display === "contents") && strip.owner.contains(run.owner)) continue;
      const hit = intersect(run.box, strip.box);
      // Two pixels into the strip, so a glyph box that grazes a hairline at subpixel is not a collision.
      if (!hit) continue;
      const vertical = strip.box.bottom - strip.box.top > strip.box.right - strip.box.left;
      const into = vertical ? Math.min(run.box.right - strip.box.left, strip.box.right - run.box.left)
        : Math.min(run.box.bottom - strip.box.top, strip.box.bottom - run.box.top);
      const along = vertical ? hit.bottom - hit.top : hit.right - hit.left;
      if (into < 2 || along < 2) continue;
      push({ kind: "text-on-edge", a: describe(run.owner), b: `border of ${describe(strip.owner)}`, text: `"${run.text}"`, box: fmt(hit) });
    }
  }

  /* 3b. text-on-edge, SVG: an outline of any shape in the same drawing passing through a label's
         box. Sampled along the outline rather than compared bbox-to-bbox, so a label that sits
         inside its box (the box's bbox contains it) passes and a label that crosses the box's edge,
         an arrow or an arrowhead fails. */
  const shapes = "rect, path, line, polyline, polygon, circle, ellipse";
  for (const svg of new Set(runs.filter(run => run.svg).map(run => run.svg!))) {
    const labels = runs.filter(run => run.svg === svg);
    for (const shape of svg.querySelectorAll<SVGGeometryElement>(shapes)) {
      if (hidden(shape) || shape.closest("defs, symbol, marker, pattern, mask, clipPath, text")) continue;
      const style = getComputedStyle(shape);
      const stroked = style.stroke !== "none" && parseFloat(style.strokeWidth) > 0 && Number(style.strokeOpacity) > 0;
      const filled = style.fill !== "none" && Number(style.fillOpacity) > 0;
      if (!stroked && !filled) continue;
      const ctm = shape.getScreenCTM();
      if (!ctm || typeof shape.getTotalLength !== "function") continue;
      let length = 0;
      try { length = shape.getTotalLength(); } catch { continue; }
      if (!(length > 0)) continue;
      const steps = Math.min(800, Math.max(8, Math.ceil(length / 2)));
      for (const label of labels) {
        /* Two pixels of clearance around the glyph box, horizontally: a label whose ends sit on a
           box's edge reads as touching it even when the outline misses by a pixel ("activate" in
           the founder's diagram, 62px in a 64px gap). Not vertically -- the glyph box already
           carries the font's ascent and descent. */
        const inner = { left: label.box.left - 2, top: label.box.top + 1, right: label.box.right + 2, bottom: label.box.bottom - 1 };
        let crossed = false;
        for (let step = 0; step <= steps && !crossed; step++) {
          const point = shape.getPointAtLength((length * step) / steps);
          const screen = new DOMPoint(point.x, point.y).matrixTransform(ctm);
          crossed = screen.x > inner.left && screen.x < inner.right && screen.y > inner.top && screen.y < inner.bottom;
        }
        if (crossed) {
          push({ kind: "text-on-edge", a: describe(label.owner), b: `${shape.tagName.toLowerCase()} outline in ${describe(svg)}`, text: `"${label.text}"`, box: fmt(label.box) });
        }
      }
    }
  }

  /* 3c. text-spill: past the side of the nearest painted box around the run. Horizontal only --
         a box shorter than its text is the vertical clip `overflow-audit` already measures. */
  const transparent = (color: string) => color === "transparent" || /rgba\([^)]*,\s*0\)$/.test(color);
  const paintedCache = new Map<Element, Element | null>();
  const painted = (element: Element | null): Element | null => {
    if (!element || element === document.body || element === document.documentElement) return null;
    if (paintedCache.has(element)) return paintedCache.get(element)!;
    const style = getComputedStyle(element);
    const edge = (side: "Left" | "Right") => parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) >= 1
      && style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== "none"
      && !transparent(style.getPropertyValue(`border-${side.toLowerCase()}-color`));
    const own = !style.display.startsWith("inline") && style.display !== "contents"
      && (!transparent(style.backgroundColor) || edge("Left") || edge("Right"));
    const result = own ? element : painted(element.parentElement);
    paintedCache.set(element, result);
    return result;
  };
  for (const run of runs) {
    if (run.svg) continue;
    const box = painted(run.owner);
    if (!box) continue;
    const r = box.getBoundingClientRect();
    const past = Math.max(r.left - run.box.left, run.box.right - r.right);
    if (past > 2) push({ kind: "text-spill", a: describe(run.owner), b: describe(box), text: `"${run.text}"`, box: `${Math.round(past)}px past ${fmt(r)}` });
  }
  const scroll = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  if (scroll > 1) push({ kind: "page-scroll", a: "html", b: "viewport", text: "", box: `${scroll}px` });

  /* 4. text-clipped: a box that clips horizontally, holds text of its own and is narrower than it.
        A declared truncation (`text-overflow: ellipsis`, `line-clamp`) says it is cut; this is the
        case that does not. */
  for (const element of document.querySelectorAll<HTMLElement>("body *")) {
    if (element instanceof SVGElement || hidden(element)) continue;
    const style = getComputedStyle(element);
    if (style.overflowX !== "hidden" && style.overflowX !== "clip") continue;
    if (style.textOverflow === "ellipsis" || (style.webkitLineClamp && style.webkitLineClamp !== "none")) continue;
    if (element.clientWidth < 8 || element.scrollWidth <= element.clientWidth + 1) continue;
    if (!clipOf(element.parentElement)) continue;
    const ownText = [...element.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim());
    if (!ownText) continue;
    const r = element.getBoundingClientRect();
    push({ kind: "text-clipped", a: describe(element), b: `scrollWidth ${element.scrollWidth} > clientWidth ${element.clientWidth}`, text: `"${(element.textContent ?? "").trim().slice(0, 40)}"`, box: fmt(r) });
  }

  /* 5. fixed-covers: a fixed or sticky element on top of text that is not its own, at load. */
  for (const element of document.querySelectorAll<HTMLElement>("body *")) {
    if (element instanceof SVGElement) continue;
    const style = getComputedStyle(element);
    if (style.position !== "fixed" && style.position !== "sticky") continue;
    if (hidden(element) || style.pointerEvents === "none") continue;
    // Only the outermost fixed layer: its descendants are the same overlay.
    const outer = element.parentElement?.closest("*");
    let nested = false;
    for (let up = outer; up && up !== document.body; up = up.parentElement) {
      const position = getComputedStyle(up).position;
      if (position === "fixed" || position === "sticky") { nested = true; break; }
    }
    if (nested) continue;
    const r = element.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    for (const run of runs) {
      if (element.contains(run.owner)) continue;
      const hit = intersect(run.box, r);
      if (!hit || hit.right - hit.left < 3 || hit.bottom - hit.top < 3) continue;
      // Painted above the run? The topmost element at the hit's centre answers that.
      const top = document.elementFromPoint((hit.left + hit.right) / 2, (hit.top + hit.bottom) / 2);
      if (!top || !element.contains(top)) continue;
      push({ kind: "fixed-covers", a: describe(element), b: describe(run.owner), text: `"${run.text}"`, box: fmt(hit) });
    }
  }

  return findings;
}
