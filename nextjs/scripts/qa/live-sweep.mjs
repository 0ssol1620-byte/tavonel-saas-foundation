#!/usr/bin/env node
/*
  Live-site layout sweep — the defects a text audit and the per-check e2e specs cannot see.

  What already exists is not repeated. `e2e/overflow-audit.spec.ts` measures horizontal overflow
  on the *built branch* at seven widths, and `e2e/contrast-zoom-audit.spec.ts` measures contrast
  and 200% reflow on a route list. This script measures the same geometry against the **deployed**
  site, plus the four things nothing measured anywhere: text clipped by an `overflow: hidden`
  ancestor with no ellipsis, visible text boxes that overlap each other, media with no intrinsic
  dimensions (the CLS source), and tap targets under 44px outside /explore.

  It is a reporter, never a gate. It prints a JSON ledger; the fixes it finds are pinned by
  ordinary specs in `e2e/`, which run on the branch. Running a gate against production would make
  CI depend on a deploy.

  Themes: the site has one. `app/tavonel.css` paints every colour explicitly from tokens and
  carries no `prefers-color-scheme` block, so `--scheme` exists to *prove* that (run it both ways
  and compare the ledger) rather than to sweep a second design.

  Usage:
    node scripts/qa/live-sweep.mjs                              # full matrix, reduced motion
    node scripts/qa/live-sweep.mjs --widths 390 --routes / --shots all
    node scripts/qa/live-sweep.mjs --motion no-preference --shots none
  Flags: --base --widths --routes --browser chromium|webkit --scheme dark|light
         --motion reduce|no-preference --shots defects|all|none --out <dir> --jobs N
*/

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as playwright from "@playwright/test";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? fallback : argv[at + 1];
};

const BASE = flag("base", "https://tavonel.com").replace(/\/$/, "");
const WIDTHS = flag("widths", "360,390,430,768,1280,1536").split(",").map(Number);
const BROWSER = flag("browser", "chromium");
const SCHEME = flag("scheme", "dark");
const MOTION = flag("motion", "reduce");
const SHOTS = flag("shots", "defects");
const OUT = flag("out", "D:/CodexProjects/gates-lanes/polish-shots");
const JOBS = Number(flag("jobs", "4"));

const TAP_FLOOR = 44;
const FONT_FLOOR = 12;
const LINE_FLOOR = 1.15;
const CONTRAST_FLOOR = 4.5;

async function routes() {
  const explicit = flag("routes", "");
  if (explicit) return explicit.split(",");
  const xml = await fetch(`${BASE}/sitemap.xml`).then(r => r.text());
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map(m => m[1].replace(BASE, "") || "/")
    .filter(path => path.startsWith("/") && !path.endsWith(".xml"));
}

/* Runs in the page. One pass over the DOM; every finding carries the selector that caused it. */
function probe({ tapFloor, fontFloor, lineFloor, contrastFloor }) {
  const findings = [];
  const limit = window.innerWidth;
  const fold = window.innerHeight;

  const describe = element => {
    const id = element.id ? `#${element.id}` : "";
    const cls = typeof element.className === "string" && element.className.trim()
      ? `.${element.className.trim().split(/\s+/).slice(0, 2).join(".")}`
      : "";
    return `${element.tagName.toLowerCase()}${id}${cls}`.slice(0, 120);
  };
  const label = element => (element.getAttribute("aria-label") ?? element.textContent ?? "")
    .trim().replaceAll(/\s+/g, " ").slice(0, 60);

  /* sRGB byte triples through a canvas, so color-mix(), oklch() and every other modern syntax
     reads back as something comparable. Same technique as e2e/contrast-zoom-audit.spec.ts. */
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const rgba = value => {
    if (!value || value === "transparent") return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  };
  const luminance = ({ r, g, b }) => {
    const channel = byte => {
      const c = byte / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const ratio = (fg, bg) => {
    const a = luminance(fg) + 0.05;
    const b = luminance(bg) + 0.05;
    return Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100;
  };
  /* What is actually painted behind the text, read from the hit-test stack rather than the
     ancestor chain. The chain is the wrong answer wherever the page layers: the site header is
     a sibling of the article it floats over, so walking its parents reaches the dark `body`
     while the pixels behind it are the cream panel. Walking the stack found the cream.

     An image or gradient behind the text has no single colour to compare against, so those
     return null and are reported nowhere -- this measurement does not claim to have checked
     text on a gradient. */
  const backdrop = (element, x, y) => {
    const stack = document.elementsFromPoint(x, y);
    const start = stack.findIndex(node => node === element || node.contains(element));
    if (start === -1) return null;
    for (let index = start; index < stack.length; index += 1) {
      const style = getComputedStyle(stack[index]);
      if (index > start && style.backgroundImage !== "none") return null;
      const colour = rgba(style.backgroundColor);
      if (colour && colour.a > 0.95) return colour;
    }
    return null;
  };

  const visible = element => {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return null;
    /* The element's own opacity is not enough: a crossfaded panel stack renders both panels and
       hides one with `opacity: 0` on a *wrapper*, which read as two headings on top of each
       other. checkVisibility walks the chain. */
    if (element.checkVisibility && !element.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return null;
    if (element.closest("[hidden],[aria-hidden='true'],[inert]")) return null;
    const box = element.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return null;
    return { style, box };
  };
  const ownText = element => [...element.childNodes]
    .filter(node => node.nodeType === 3 && node.textContent.trim())
    .map(node => node.textContent.trim()).join(" ");
  const scrolledBy = element => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const overflowX = getComputedStyle(parent).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return true;
    }
    return false;
  };
  /* Text an ancestor clips away is not on screen, so it cannot collide with anything. Without
     this, every `-webkit-line-clamp` box reports its cut-off line overlapping the row below. */
  const clipToAncestors = (element, rect) => {
    let { top, bottom, left, right } = rect;
    // Starts at the element, not its parent: `-webkit-line-clamp` clips on the element that
    // carries the text, and skipping it left every clamped paragraph's cut-off line in play.
    for (let parent = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.overflow === "visible") continue;
      const bounds = parent.getBoundingClientRect();
      top = Math.max(top, bounds.top);
      bottom = Math.min(bottom, bounds.bottom);
      left = Math.max(left, bounds.left);
      right = Math.min(right, bounds.right);
      if (bottom - top <= 1 || right - left <= 1) return null;
    }
    return { top, bottom, left, right };
  };

  const push = (type, element, detail, box) => findings.push({
    type, selector: describe(element), text: label(element), detail,
    y: Math.round((box?.top ?? 0) + window.scrollY),
    aboveFold: (box?.top ?? Infinity) < fold,
  });

  const textBoxes = [];
  const contrastCandidates = [];
  for (const element of document.querySelectorAll("body *")) {
    const seen = visible(element);
    if (!seen) continue;
    const { style, box } = seen;
    const tag = element.tagName.toLowerCase();

    // (1) horizontal overflow — the element rule, not document.scrollWidth, because the site
    // sets overflow-x: hidden and a clipped block still looks clean at the document level.
    const inFlow = style.position === "static" || style.position === "relative";
    if ((box.width > limit + 1 || (inFlow && box.right > limit + 1)) && !scrolledBy(element)) {
      push("overflow", element,
        `${Math.round(box.width)}px wide, right edge ${Math.round(box.right)} > ${limit}`, box);
    }

    const text = ownText(element);
    if (text) {
      /* Overlap is measured on the *text* rectangles, not the element box. An inline element's
         border box spans the whole line it sits on, so sibling inline text would collide with
         every neighbour on that line and report nothing but noise. A Range over the element's
         own text nodes gives the rectangle the glyphs actually occupy. */
      const leading = style.lineHeight === "normal"
        ? Number.parseFloat(style.fontSize) * 1.2
        : Number.parseFloat(style.lineHeight);
      for (const node of element.childNodes) {
        if (node.nodeType !== 3 || !node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width <= 1 || rect.height <= 1) continue;
          /* A range rect is the font's ascent-to-descent band, which is taller than the line
             box whenever leading is tight. Two lines of a 1.05-leading headline therefore
             always "intersect" by a few pixels and are not a defect. Clamping each rect to its
             own line-height band measures the collision the reader would actually see. */
          const inset = Math.max(0, (rect.height - leading) / 2);
          const painted = clipToAncestors(element, {
            top: rect.top + inset, bottom: rect.bottom - inset, left: rect.left, right: rect.right,
          });
          if (painted) textBoxes.push({ element, text, box: painted });
        }
      }

      // (2) clipping — content larger than its own padding box, clipped by hidden overflow.
      // Three intentional patterns are not defects and are excluded: the 1x1 visually-hidden
      // box, `text-overflow: ellipsis`, and `-webkit-line-clamp`, which all *say* they truncate.
      const clipsX = style.overflowX === "hidden" || style.overflowX === "clip";
      const clipsY = style.overflowY === "hidden" || style.overflowY === "clip";
      const overX = element.scrollWidth - element.clientWidth > 1;
      const overY = element.scrollHeight - element.clientHeight > 1;
      const declaredTruncation = style.textOverflow === "ellipsis" || style.webkitLineClamp !== "none";
      /* The sr-only box, measured from the rendered rectangle rather than `clientWidth` --
         which is 0 on every non-replaced inline element and would have silenced every `code`
         and `span` on the site. */
      const visuallyHidden = box.width <= 1 || box.height <= 1;
      if (((clipsX && overX) || (clipsY && overY)) && !declaredTruncation && !visuallyHidden) {
        push("clipping", element,
          `content ${element.scrollWidth}x${element.scrollHeight} clipped to ${element.clientWidth}x${element.clientHeight}`, box);
      }

      // (4) type floor and contrast, on the element that owns the words. Nothing here applies
      // to the 1x1 visually-hidden box: it carries a label for a screen reader, not a colour or
      // a size a reader ever sees.
      const fontSize = Number.parseFloat(style.fontSize);
      const lineHeight = style.lineHeight === "normal" ? fontSize * 1.2 : Number.parseFloat(style.lineHeight);
      if (visuallyHidden) continue;
      if (fontSize < fontFloor) push("type-floor", element, `font-size ${fontSize}px < ${fontFloor}px`, box);
      /* The leading floor is a rule about reading paragraphs, not about display type: a 30px
         headline set at 1.1 is a deliberate optical choice, and a 12px icon-button label never
         wraps at all. So it applies below 20px, to text long enough to wrap, that did wrap. */
      else if (fontSize < 20 && lineHeight / fontSize < lineFloor
               && text.length > 40 && element.scrollHeight > lineHeight * 1.5) {
        push("line-height", element,
          `line-height ${Math.round((lineHeight / fontSize) * 100) / 100} on ${fontSize}px across ${Math.round(element.scrollHeight / lineHeight)} lines`, box);
      }
      /* The backdrop needs a hit test, and a hit test only reaches what is on screen, so the
         colour pair is resolved in the verification pass below after scrolling to it. */
      const ink = rgba(style.color);
      if (ink && ink.a > 0.95) {
        const bold = Number(style.fontWeight) >= 700;
        contrastCandidates.push({
          element, ink, fontSize,
          floor: fontSize >= 24 || (bold && fontSize >= 18.66) ? 3 : contrastFloor,
          x: box.left + Math.min(4, box.width / 2),
          docY: box.top + box.height / 2 + window.scrollY,
          top: Math.round(box.top + window.scrollY),
          aboveFold: box.top < fold,
        });
      }
    }

    /* (5) media whose box is not known until the bytes arrive -- the CLS source. An explicit
       `height` in CSS settles the box just as well as the attributes do, so the landing film's
       `<video>`, sized 1120x700 by the stylesheet, is not one of these. Only content-determined
       media reserves nothing. */
    if ((tag === "img" || tag === "video") && !(element.hasAttribute("width") && element.hasAttribute("height"))
        && style.aspectRatio === "auto" && style.position === "static"
        && (style.height === "auto" || style.width === "auto")) {
      push("media-dims", element, `<${tag}> reserves no box: no width/height attributes, no aspect-ratio, height ${style.height}`, box);
    }

    // (6) tap targets, mobile widths only.
    /* WCAG 2.5.8's own "inline" exception applies: a link inside a sentence cannot be sized to
       44px without breaking the paragraph it lives in. "Inside a sentence" means inline-level
       *and* sharing its parent with prose -- a nav full of inline-flex links is a row of
       controls, not a sentence, and has no such excuse. */
    const inSentence = style.display.startsWith("inline")
      && element.parentElement && ownText(element.parentElement) !== "";
    if (limit <= 430 && (tag === "a" || tag === "button" || element.getAttribute("role") === "button")
        && !element.querySelector("a,button") && text && !inSentence) {
      if (box.height < tapFloor - 0.5 || box.width < tapFloor - 0.5) {
        push("tap-target", element,
          `${Math.round(box.width)}x${Math.round(box.height)} < ${tapFloor}px`, box);
      }
    }
  }

  // (3) overlap — pairs of text-bearing boxes intersecting by more than 4px in both axes and
  // not in an ancestor/descendant relationship. Sorted by top so the scan stops early.
  textBoxes.sort((a, b) => a.box.top - b.box.top);
  const layered = element => {
    for (let node = element; node; node = node.parentElement) {
      const position = getComputedStyle(node).position;
      if (position === "fixed" || position === "sticky") return true;
      if (node.closest("[role='dialog'],dialog,[popover]")) return true;
    }
    return false;
  };
  /* Two rectangles can intersect and still look perfect, because one of them is painted over by
     an opaque box in front of it -- a `display: table-cell` header collapsed behind a stacked
     mobile card is the case that produced most of the raw hits. A collision the reader can see
     needs both texts to reach the same pixel with nothing opaque in between, which is what the
     hit-test stack at the intersection centre says. */
  const collide = (first, second, x, y) => {
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
    const stack = document.elementsFromPoint(x, y);
    const rankOf = element => stack.findIndex(node => node === element || node.contains(element));
    const above = rankOf(first);
    const below = rankOf(second);
    if (above === -1 || below === -1) return false;
    const [top, bottom] = above < below ? [above, below] : [below, above];
    for (let index = top; index < bottom; index += 1) {
      const paint = rgba(getComputedStyle(stack[index]).backgroundColor);
      if (paint && paint.a > 0.5) return false;
    }
    return true;
  };

  const candidates = [];
  for (let i = 0; i < textBoxes.length; i += 1) {
    const a = textBoxes[i];
    if (layered(a.element)) continue;
    for (let j = i + 1; j < textBoxes.length; j += 1) {
      const b = textBoxes[j];
      if (b.box.top >= a.box.bottom - 4) break;
      if (a.element === b.element) continue;
      if (a.element.contains(b.element) || b.element.contains(a.element)) continue;
      if (layered(b.element)) continue;
      const overlapX = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
      const overlapY = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
      if (overlapX <= 4 || overlapY <= 4) continue;
      candidates.push({
        a: a.element, b: b.element,
        x: (Math.max(a.box.left, b.box.left) + Math.min(a.box.right, b.box.right)) / 2,
        docY: (Math.max(a.box.top, b.box.top) + Math.min(a.box.bottom, b.box.bottom)) / 2 + window.scrollY,
        selector: `${describe(a.element)} ∩ ${describe(b.element)}`,
        text: `${a.text.slice(0, 30)} / ${b.text.slice(0, 30)}`,
        detail: `${Math.round(overlapX)}x${Math.round(overlapY)}px intersection`,
        top: Math.round(a.box.top + window.scrollY),
        aboveFold: a.box.top < fold,
      });
    }
  }

  /* The hit test only works on what is currently on screen, and these rectangles were measured
     at scroll 0, so each candidate is brought into view before it is judged. Every rectangle was
     collected from non-fixed, non-sticky content, so scrolling moves it by exactly the scroll
     delta and the recomputed y is the same pixel. */
  for (const candidate of candidates) {
    window.scrollTo(0, Math.max(0, candidate.docY - window.innerHeight / 2));
    if (!collide(candidate.a, candidate.b, candidate.x, candidate.docY - window.scrollY)) continue;
    findings.push({
      type: "overlap", selector: candidate.selector, text: candidate.text,
      detail: candidate.detail, y: candidate.top, aboveFold: candidate.aboveFold,
    });
  }

  for (const candidate of contrastCandidates) {
    window.scrollTo(0, Math.max(0, candidate.docY - window.innerHeight / 2));
    const ground = backdrop(candidate.element, candidate.x, candidate.docY - window.scrollY);
    if (!ground) continue;
    const measured = ratio(candidate.ink, ground);
    if (measured >= candidate.floor) continue;
    findings.push({
      type: "contrast", selector: describe(candidate.element), text: label(candidate.element),
      detail: `${measured}:1 < ${candidate.floor}:1 at ${candidate.fontSize}px`,
      y: candidate.top, aboveFold: candidate.aboveFold,
    });
  }
  window.scrollTo(0, 0);

  return {
    documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    background: getComputedStyle(document.body).backgroundColor,
    findings,
  };
}

const slug = route => (route === "/" ? "home" : route.replace(/^\//, "").replaceAll("/", "-"));

async function sweepWidth(browser, width) {
  const context = await browser.newContext({
    viewport: { width, height: width <= 430 ? 844 : 900 },
    colorScheme: SCHEME === "light" ? "light" : "dark",
    reducedMotion: MOTION === "reduce" ? "reduce" : "no-preference",
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const rows = [];
  for (const route of ALL_ROUTES) {
    let measured;
    try {
      const response = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      if ((response?.status() ?? 599) >= 400) {
        rows.push({ route, width, status: response?.status(), findings: [{ type: "http", selector: route, detail: `status ${response?.status()}` }] });
        continue;
      }
      await page.waitForTimeout(1200);
      measured = await page.evaluate(probe, { tapFloor: TAP_FLOOR, fontFloor: FONT_FLOOR, lineFloor: LINE_FLOOR, contrastFloor: CONTRAST_FLOOR });
    } catch (error) {
      rows.push({ route, width, findings: [{ type: "error", selector: route, detail: String(error).slice(0, 200) }] });
      continue;
    }
    const wanted = SHOTS === "all" || (SHOTS === "defects" && measured.findings.length > 0);
    let shot = null;
    if (wanted) {
      shot = join(OUT, `${BROWSER}-${SCHEME}-${MOTION}`, `${width}`, `${slug(route)}.png`);
      await mkdir(dirname(shot), { recursive: true });
      await page.screenshot({ path: shot, fullPage: true }).catch(() => { shot = null; });
    }
    rows.push({ route, width, background: measured.background, documentOverflow: measured.documentOverflow, shot, findings: measured.findings });
    process.stderr.write(`${BROWSER} ${width} ${route} — ${measured.findings.length}\n`);
  }
  await context.close();
  return rows;
}

const ALL_ROUTES = await routes();
const browser = await playwright[BROWSER].launch({ headless: true });
const queue = [...WIDTHS];
const rows = [];
await Promise.all(
  Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
    while (queue.length) rows.push(...(await sweepWidth(browser, queue.shift())));
  }),
);
await browser.close();

const target = join(OUT, `ledger-${BROWSER}-${SCHEME}-${MOTION}.json`);
await mkdir(OUT, { recursive: true });
await writeFile(target, JSON.stringify({ base: BASE, browser: BROWSER, scheme: SCHEME, motion: MOTION, at: new Date().toISOString(), rows }, null, 1));
const total = rows.reduce((sum, row) => sum + row.findings.length, 0);
console.log(`${target} — ${rows.length} route/width pairs, ${total} findings`);
