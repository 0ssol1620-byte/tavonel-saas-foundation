/**
 * V34 QA harness, in-page measurements (architecture section 5).
 *
 * Every function exported as `measure*` is serialised by Playwright into the page, so each is
 * self-contained: no imports, no module-level helpers. They take one plain-object argument and
 * return plain data. The Node-side wrappers are in v34-passes.ts.
 *
 * Declared exceptions are carried by data attributes, never by selectors in this file:
 *   data-v34-scroll   a deliberate scroll surface (ScrollTable region): clipping and being wider
 *                     than the viewport are the point of it;
 *   data-v34-overlay  a deliberate layer (drawer, tooltip, World canvas label): it may sit over
 *                     other content, and its own text is not judged for occlusion;
 *   data-v34-layer    a child that is layered on purpose over its siblings.
 * `<canvas>` and `<svg>` subtrees are never judged for text clipping.
 */

export type Violation = {
  /** Pass name, e.g. "outside-bounds". */
  pass: string;
  selector: string;
  detail: string;
};

/** Runs in the page. Interactive elements that sit outside the viewport horizontally. */
export function measureOutsideBounds(): Violation[] {
  const out: Violation[] = [];
  const describe = (el: Element) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : "";
    return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 120);
  };
  const interactive = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [tabindex]:not([tabindex='-1'])";
  for (const el of document.querySelectorAll(interactive)) {
    if (el.closest("[data-v34-scroll], [data-v34-overlay], [hidden], [inert]")) continue;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // Fully off the left or top edge is the visually-hidden / skip-link technique, not a layout defect.
    if (r.right <= 0 || r.bottom <= 0) continue;
    if (r.left < -1 || r.right > window.innerWidth + 1) {
      out.push({
        pass: "outside-bounds",
        selector: describe(el),
        detail: `x ${Math.round(r.left)}..${Math.round(r.right)} outside 0..${window.innerWidth}`,
      });
    }
  }
  return out.slice(0, 40);
}

/**
 * Runs in the page. Text that is clipped (a clipping box narrower or shorter than its content,
 * with no ellipsis) or occluded (the topmost element at a sampled point of the text is an
 * unrelated element).
 */
export function measureClippedText(): Violation[] {
  const out: Violation[] = [];
  const describe = (el: Element) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : "";
    return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 120);
  };
  const exempt = (el: Element) => !!el.closest("[data-v34-scroll], [data-v34-overlay], canvas, svg, [hidden]");
  for (const el of document.querySelectorAll("body *")) {
    const own = [...el.childNodes].find(n => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 1);
    if (!own || exempt(el)) continue;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    const clipX = style.overflowX === "hidden" || style.overflowX === "clip";
    const clipY = style.overflowY === "hidden" || style.overflowY === "clip";
    const ellipsis = style.textOverflow === "ellipsis" && style.whiteSpace === "nowrap";
    if (clipX && !ellipsis && el.scrollWidth > el.clientWidth + 1) {
      out.push({ pass: "clipped-text", selector: describe(el), detail: `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}` });
    }
    if (clipY && el.scrollHeight > el.clientHeight + 1) {
      out.push({ pass: "clipped-text", selector: describe(el), detail: `scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}` });
    }
    // Occlusion: sample the middle of the text's own rect, only when it is inside the viewport.
    const range = document.createRange();
    range.selectNodeContents(own);
    const rr = range.getBoundingClientRect();
    if (rr.width < 2 || rr.height < 2) continue;
    const px = rr.left + rr.width / 2;
    const py = rr.top + rr.height / 2;
    if (px < 0 || py < 0 || px > window.innerWidth || py > window.innerHeight) continue;
    const top = document.elementFromPoint(px, py);
    if (!top || top === el || el.contains(top) || top.contains(el)) continue;
    if (top.closest("[data-v34-overlay]")) continue;
    const topStyle = getComputedStyle(top);
    if (topStyle.pointerEvents === "none" && topStyle.position === "fixed") continue;
    out.push({ pass: "occluded-text", selector: describe(el), detail: `covered by ${describe(top)} at ${Math.round(px)},${Math.round(py)}` });
  }
  return out.slice(0, 40);
}

/** Runs in the page. In-flow siblings whose boxes intersect without being declared layers. */
export function measureSiblingOverlap(): Violation[] {
  const out: Violation[] = [];
  const describe = (el: Element) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : "";
    return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 120);
  };
  let parents = 0;
  for (const parent of document.querySelectorAll("body *")) {
    if (parent.children.length < 2 || parent.closest("[data-v34-overlay], [data-v34-scroll], canvas, svg, [hidden]")) continue;
    if (++parents > 600) break;
    const kids = [...parent.children].filter(k => {
      if (k.hasAttribute("data-v34-layer") || k.hasAttribute("data-v34-overlay")) return false;
      const s = getComputedStyle(k);
      if (s.display === "none" || s.display === "contents" || s.visibility === "hidden") return false;
      if (s.position === "absolute" || s.position === "fixed") return false;
      if (s.zIndex !== "auto") return false;
      const r = k.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    });
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i].getBoundingClientRect();
        const b = kids[j].getBoundingClientRect();
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 2 && h > 2) {
          out.push({ pass: "sibling-overlap", selector: `${describe(kids[i])} + ${describe(kids[j])}`, detail: `overlap ${Math.round(w)}x${Math.round(h)} in ${describe(parent)}` });
        }
      }
    }
  }
  return out.slice(0, 40);
}

/**
 * Runs in the page. Heading and bold mid-word fragmentation: every alphabetic word (>= 2 letters)
 * of h1-h3, b and strong is wrapped in a Range; a word whose client rects fall on more than one
 * line was broken inside the word.
 */
export function measureWordFragmentation(): Violation[] {
  const out: Violation[] = [];
  for (const el of document.querySelectorAll("h1, h2, h3, b, strong")) {
    if (el.closest("[hidden], canvas, svg")) continue;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      for (const m of text.matchAll(/\p{L}{2,}/gu)) {
        const range = document.createRange();
        range.setStart(node, m.index ?? 0);
        range.setEnd(node, (m.index ?? 0) + m[0].length);
        const tops = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
        if (tops.length < 2) continue;
        const lines = new Set<number>();
        const first = tops[0];
        for (const r of tops) if (Math.abs(r.top - first.top) > first.height / 2) lines.add(Math.round(r.top));
        if (lines.size >= 1) {
          out.push({
            pass: "word-fragment",
            selector: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}`,
            detail: `"${m[0]}" is split over ${lines.size + 1} lines`,
          });
        }
      }
    }
  }
  return out.slice(0, 40);
}

/** Runs in the page. Exactly one visible h1, and header, nav, main and footer landmarks. */
export function measureStructure(): Violation[] {
  const out: Violation[] = [];
  const visible = (el: Element) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
  };
  const h1 = [...document.querySelectorAll("h1")].filter(visible);
  if (h1.length !== 1) out.push({ pass: "structure", selector: "h1", detail: `${h1.length} visible h1 elements, expected 1` });
  const landmarks: [string, string][] = [
    ["header", "header, [role=banner]"],
    ["nav", "nav, [role=navigation]"],
    ["main", "main, [role=main]"],
    ["footer", "footer, [role=contentinfo]"],
  ];
  for (const [name, selector] of landmarks) {
    if (!document.querySelector(selector)) out.push({ pass: "structure", selector: name, detail: `no ${name} landmark` });
  }
  return out;
}

/** Runs in the page. The sticky/fixed header must not sit over the first heading of `main`. */
export function measureHeaderCover(): Violation[] {
  const heading = document.querySelector("main h1, main h2, #main h1, #main h2");
  if (!heading) return [];
  const r = heading.getBoundingClientRect();
  const px = r.left + Math.min(r.width / 2, 40);
  const py = r.top + r.height / 2;
  if (py < 0 || py > window.innerHeight) return [];
  const top = document.elementFromPoint(px, py);
  if (!top || top === heading || heading.contains(top) || top.contains(heading)) return [];
  const header = top.closest("header, [role=banner]");
  if (!header) return [];
  return [{ pass: "header-cover", selector: header.tagName.toLowerCase(), detail: `covers the first heading "${(heading.textContent ?? "").trim().slice(0, 40)}"` }];
}

/**
 * Runs in the page. Content cut off by a clipping box (the .tiles shape that shipped on /trust):
 *  - text whose drawn rect passes an ancestor's overflow:hidden|clip padding box, vertically or
 *    horizontally (an overlay also checks its own box, which measureClippedText exempts);
 *  - in a clipping grid or flex container, an in-flow child whose border box passes the content
 *    box (copy of measureClippedRows in e2e/overflow-audit.spec.ts, vertical only there).
 * data-v34-scroll surfaces, line-clamp and ellipsis are declared clips and are not reported.
 */
export function measureClippedRows(): Violation[] {
  const out: Violation[] = [];
  const name = (el: Element) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : "";
    return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 120);
  };
  const clips = (v: string) => v === "hidden" || v === "clip";
  const live = (el: Element) => {
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) !== 0;
  };
  for (const el of document.querySelectorAll("body *")) {
    if (out.length >= 40) break;
    if (el.closest("[data-v34-scroll], canvas, svg, [hidden]") || !live(el)) continue;
    const own = [...el.childNodes].find(n => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 1);
    if (own) {
      const range = document.createRange();
      range.selectNodeContents(own);
      const t = range.getBoundingClientRect();
      if (t.width >= 2 && t.height >= 2 && getComputedStyle(el).textOverflow !== "ellipsis") {
        const start = el.closest("[data-v34-overlay]") ? el : el.parentElement;
        for (let a: Element | null = start; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
          if (a.closest("[data-v34-scroll]")) break;
          const s = getComputedStyle(a);
          const cx = clips(s.overflowX), cy = clips(s.overflowY);
          if (!cx && !cy) continue;
          if (a.clientHeight <= 2 || a.clientWidth <= 2) continue; // visually-hidden pattern
          if ((s as CSSStyleDeclaration & { webkitLineClamp?: string }).webkitLineClamp && (s as CSSStyleDeclaration & { webkitLineClamp?: string }).webkitLineClamp !== "none") continue;
          const b = a.getBoundingClientRect();
          const l = b.left + parseFloat(s.borderLeftWidth), r = b.right - parseFloat(s.borderRightWidth);
          const tp = b.top + parseFloat(s.borderTopWidth), bt = b.bottom - parseFloat(s.borderBottomWidth);
          const past = [
            cx && t.right > r + 1 ? `right ${Math.round(t.right - r)}px` : "",
            cx && t.left < l - 1 ? `left ${Math.round(l - t.left)}px` : "",
            cy && t.bottom > bt + 1 ? `bottom ${Math.round(t.bottom - bt)}px` : "",
            cy && t.top < tp - 1 ? `top ${Math.round(tp - t.top)}px` : "",
          ].filter(Boolean);
          if (past.length) {
            out.push({ pass: "clipped-by-ancestor", selector: name(el), detail: `text passes ${name(a)} (overflow clips) by ${past.join(", ")}` });
            break;
          }
        }
      }
    }
    // Row clip: a child sliced off by a clipping grid/flex container.
    const cs = getComputedStyle(el);
    if (clips(cs.overflowY) && /^(inline-)?(grid|flex)$/.test(cs.display) && el.clientHeight > 2) {
      const box = el.getBoundingClientRect();
      const bottom = box.bottom - parseFloat(cs.borderBottomWidth) - parseFloat(cs.paddingBottom);
      for (const child of el.children) {
        const k = getComputedStyle(child);
        if (k.display === "none" || k.visibility === "hidden" || k.position === "absolute" || k.position === "fixed") continue;
        const cb = child.getBoundingClientRect();
        if (cb.height >= 1 && cb.bottom - bottom > 1) {
          out.push({ pass: "clipped-rows", selector: name(child), detail: `passes ${name(el)} content box by ${Math.round(cb.bottom - bottom)}px` });
        }
      }
    }
  }
  return out.slice(0, 40);
}
