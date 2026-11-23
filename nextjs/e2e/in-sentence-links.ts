// The classifier of "a link inside a sentence", shared by e2e/mobile-landing.spec.ts and e2e/p4-followups.spec.ts
// (WO-CI-36, decision 26). A module and not a spec, so importing it registers no tests. It runs in the page: no closure.

/*
  WO-CI-29, lead decision 23 (replaces decision 22). A 44px box inside a 19 to 30px line reaches into the
  lines above and below whatever the width, so a link inside a sentence of the V34 sheets is a plain inline
  box at every width (its target is its text, which WCAG 2.5.8 excepts), and a link that must be an easy tap
  gets a row of its own (the touch-floor rows above). Other sheets of the site may still give an in-sentence
  link a hit area (app/tavonel.css G1-TAP). The contract is chosen per link by what the link is, measured in
  the page -- never by route, selector, width, media query or project name:
  - plain: every box of the link lies inside the line box of its own text run on that box, within 1px;
  - hit area: any other link (a box taller than its line, or moved off it). A box that leaves its line but is
    under 44px is not a third kind: it is a hit-area link and fails (4).

  Found by measuring, not by class name: every painted, inline-level link in main whose paragraph
  holds words outside it, on its own lines (a link that is a flex or grid item, or alone in its block
  beside a heading or paragraph, is a row). Lines are read from the text, in layout's coordinates: every
  text run of the paragraph is clustered into lines, a run moved after layout by position: relative is
  put back by its offset, and a run moved by sticky or fixed positioning or a transform cannot be put
  back, so its line is unmeasured and fails. A run in the paragraph's own font that sits where the line
  put it (only plain inline, or a one-line inline-block whose baseline is its text's, baseline-aligned,
  unpositioned and untransformed, between it and the paragraph) gives the line's baseline and its strut:
  the run's content area extended by the half-leading of the paragraph's computed line height, which
  every line box contains (CSS 2.1 10.8.1). Every violation is returned.

  Both contracts:
  (1) the line that holds it is as tall as another line of the paragraph, within 1px (baseline to
      baseline): its next line, or on the last line the one before; a one-line paragraph is compared
      with its own computed line height. A link that fills a line of its own is measured the same way;
  (3) its computed font size is not smaller than the paragraph's.
  Plain:
  (2) each of its boxes lies inside the line box of its own text run on that box, within 1px -- the
      line that holds it in layout, so a link moved onto another line fails.
  Hit area:
  (2) its words lie inside the line box that holds them (the hit area may reach the lines above and
      below; the words may not leave their line);
  (4) each of its boxes is at least 44px high, within 1px;
  (5) none of its boxes intersects a box of any other link in main (in a sentence or not): the tap would
      land on the wrong link. Reported once per pair with both texts' lengths and the overlap rectangle.
      Overlap with plain text is allowed; that is what a hit area is. Two plain links fail the same rule when
      their boxes meet by 2px or more in both directions (WO-CI-30).
  No pixel value for a line height is written here; "line-height: normal" reads as NaN and fails.
*/
export function measureInSentenceLinks() {
  type Box = { top: number; bottom: number };
  type Rect = Box & { left: number; right: number };
  type Line = Box & { base: number | null; strut: Box | null };
  const inline = (element: Element) => getComputedStyle(element).display.startsWith("inline");
  const blockOf = (element: Element) => {
    let block: Element | null = element;
    while (block && inline(block)) block = block.parentElement;
    return block;
  };
  const moved = (style: CSSStyleDeclaration) =>
    style.transform !== "none" || ["translate", "rotate", "scale"].some(name => !["", "none"].includes(style.getPropertyValue(name)));
  // How far an element's content was moved after layout, up to its paragraph. position: relative is put back by its
  // used offset; sticky or fixed positioning, a transform, or an offset that does not resolve to a length cannot be (NaN).
  const offset = (value: string) => (value === "auto" ? 0 : value.endsWith("px") ? parseFloat(value) : NaN);
  const shiftOf = (element: Element | null, block: Element) => {
    let shift = 0;
    for (let e = element; e && e !== block; e = e.parentElement) {
      const style = getComputedStyle(e);
      if (style.position === "sticky" || style.position === "fixed" || moved(style)) return NaN;
      if (style.position === "relative") shift += style.top !== "auto" ? offset(style.top) : -offset(style.bottom);
    }
    return shift;
  };
  const range = document.createRange();
  const painted = (node: Node) => {
    range.selectNodeContents(node);
    return [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
  };
  const runs = (root: Element) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const out: { node: Text; rects: DOMRect[]; shift: number }[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      // The visually-hidden "(opens in a new tab)" is absolutely positioned and drawn nowhere.
      if (!parent || !node.textContent?.trim() || getComputedStyle(parent).position === "absolute") continue;
      // Only the paragraph's own lines: the text of a heading or paragraph nested in the same box is another block.
      if (blockOf(parent) !== root) continue;
      out.push({ node: node as Text, rects: painted(node), shift: shiftOf(parent, root) });
    }
    return out;
  };
  // A run's content area marks its line's baseline and strut only when it sits where the line put it: everything
  // between it and the paragraph is baseline-aligned, unpositioned and untransformed, and either plain inline or an
  // inline-block holding one line of text with visible overflow (whose baseline is that line's, CSS 2.1 10.8.1).
  const onBaseline = (node: Text, block: Element) => {
    for (let element = node.parentElement; element && element !== block; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (style.verticalAlign !== "baseline" || style.position !== "static" || moved(style)) return false;
      if (style.display === "inline") continue;
      if (style.display !== "inline-block" || style.overflowX !== "visible" || style.overflowY !== "visible") return false;
      const bottoms = painted(element).map(r => r.bottom);
      if (bottoms.length === 0 || Math.max(...bottoms) - Math.min(...bottoms) > 0.5) return false;
    }
    return true;
  };
  const px = (value: number) => (Number.isFinite(value) ? value.toFixed(2) : String(value));
  const mid = (b: Box) => (b.top + b.bottom) / 2;
  const unmoved = (rect: Box, shift: number) => ({ top: rect.top - shift, bottom: rect.bottom - shift });
  const rectsOf = (element: Element): Rect[] => [...element.getClientRects()].map(r => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right }));
  const found: { index: number; text: string; classes: string[]; contract: "plain" | "hit-area"; height: number; hold: number; next: number; pitches: (number | null)[]; lines: number; boxes: Rect[]; lineBoxes: (Box | null)[]; fontSize: number; paragraphFontSize: number; violations: string[] }[] = [];
  const anchors = [...document.querySelectorAll<HTMLElement>("main a[href]")];
  const hitAreas: { index: number; entry: (typeof found)[number] }[] = [];
  const linkEntries: typeof hitAreas = [];
  anchors.forEach((link, index) => {
    if (!inline(link) || link.getClientRects().length === 0) return;
    const block = blockOf(link);
    if (!block) return;
    const all = runs(block);
    // In a sentence: its paragraph has words outside the link. Wherever the link wraps to, even onto a
    // line of its own, it is still a line of that paragraph.
    if (!all.some(run => !link.contains(run.node) && run.rects.length > 0)) return;
    const own = getComputedStyle(block);
    const lineHeight = parseFloat(own.lineHeight);
    const lines: Line[] = [];
    const placed = all.filter(run => Number.isFinite(run.shift)).flatMap(run => run.rects.map(rect => unmoved(rect, run.shift)));
    for (const rect of placed.sort((a, b) => a.top - b.top)) {
      const last = lines.at(-1);
      if (last && mid(rect) < last.bottom) { last.top = Math.min(last.top, rect.top); last.bottom = Math.max(last.bottom, rect.bottom); }
      else lines.push({ top: rect.top, bottom: rect.bottom, base: null, strut: null });
    }
    const lineOf = (rect: Box) => lines.findIndex(line => mid(rect) >= line.top && mid(rect) <= line.bottom);
    for (const run of all) {
      const style = getComputedStyle(run.node.parentElement!);
      if (style.fontSize !== own.fontSize || style.fontFamily !== own.fontFamily || !onBaseline(run.node, block)) continue;
      for (const rect of run.rects) {
        const line = lines[lineOf(rect)];
        if (!line) continue;
        line.base = Math.max(line.base ?? -Infinity, rect.bottom);
        const half = (lineHeight - rect.height) / 2;
        line.strut = { top: Math.min(line.strut?.top ?? Infinity, rect.top - half), bottom: Math.max(line.strut?.bottom ?? -Infinity, rect.bottom + half) };
      }
    }
    // The link's own words: where each is drawn, and the line that holds it in layout (-1: no line, or not placeable).
    const words = all.filter(run => link.contains(run.node)).flatMap(run => run.rects.map(rect => ({ rect, line: Number.isFinite(run.shift) ? lineOf(unmoved(rect, run.shift)) : -1 })));
    const linkLines = new Set(words.map(word => word.line));
    const violations: string[] = [];
    if (words.length === 0 || linkLines.has(-1)) violations.push("(1) its words could not be placed on a line of its paragraph");
    const held = [...linkLines].filter(i => i >= 0);
    // pitches[i] runs from line i to line i + 1; null where either line has no baseline run in the paragraph's font.
    const pitches = lines.slice(1).map((line, i) => (line.base === null || lines[i].base === null ? null : line.base - lines[i].base!));
    const first = Math.min(...held);
    const last = Math.max(...held);
    const touching = pitches.filter((p, i): p is number => p !== null && (linkLines.has(i) || linkLines.has(i + 1)));
    // The paragraph's next line after the link; on the last line, the nearest one before it.
    const after = pitches.findIndex((p, i) => p !== null && i > last);
    let before = -1;
    pitches.forEach((p, i) => { if (p !== null && i + 1 < first) before = i; });
    const content = block.getBoundingClientRect().height - [own.paddingTop, own.paddingBottom, own.borderTopWidth, own.borderBottomWidth].reduce((sum, v) => sum + parseFloat(v), 0);
    // A one-line paragraph: the line is the content box, compared with the computed line height.
    const hold = held.length === 0 ? NaN : lines.length === 1 ? content : touching.length > 0 ? Math.max(...touching) : NaN;
    const next = after >= 0 ? pitches[after]! : before >= 0 ? pitches[before]! : lineHeight;
    if (!(Math.abs(hold - next) <= 1)) violations.push(`(1) the line that holds it measures ${px(hold)}px against the paragraph's next line ${px(next)}px`);

    const inside = (box: Box, strut: Box | null) => strut !== null && box.top >= strut.top - 1 && box.bottom <= strut.bottom + 1;
    const leaves = (what: string, box: Box, strut: Box | null) => strut
      ? `(2) ${what} ${px(box.top)}..${px(box.bottom)} leaves its line box ${px(strut.top)}..${px(strut.bottom)} by ${px(Math.max(0, strut.top - box.top))}px above and ${px(Math.max(0, box.bottom - strut.bottom))}px below`
      : `(2) ${what} ${px(box.top)}..${px(box.bottom)}: the line that holds it has no measured line box (line height ${own.lineHeight})`;
    const boxes = rectsOf(link);
    // The line box of its own text run on each box: the word drawn inside the box, placed where layout put it.
    const ownLine = boxes.map(box => words.find(w => w.line >= 0 && (w.rect.left + w.rect.right) / 2 >= box.left && (w.rect.left + w.rect.right) / 2 <= box.right && mid(w.rect) >= box.top && mid(w.rect) <= box.bottom));
    // What the link is: plain when every box is inside its own line box; anything else is a hit-area link.
    const contract: "plain" | "hit-area" = boxes.every((box, i) => ownLine[i] !== undefined && inside(box, lines[ownLine[i]!.line].strut)) ? "plain" : "hit-area";
    if (contract === "plain") {
      boxes.forEach((box, i) => {
        const word = ownLine[i];
        if (!word) violations.push(`(2) its box ${px(box.top)}..${px(box.bottom)} holds none of its words placed on a line`);
        else if (!inside(box, lines[word.line].strut)) violations.push(leaves("its box", box, lines[word.line].strut));
      });
    } else {
      for (const word of words) if (!inside(word.rect, lines[word.line]?.strut ?? null)) violations.push(leaves("its words", word.rect, lines[word.line]?.strut ?? null));
      for (const box of boxes) if (!(box.bottom - box.top >= 43)) violations.push(`(4) its box ${px(box.top)}..${px(box.bottom)} is ${px(box.bottom - box.top)}px high, under the 44px hit area`);
    }
    const fontSize = parseFloat(getComputedStyle(link).fontSize);
    const paragraphFontSize = parseFloat(own.fontSize);
    if (!(fontSize >= paragraphFontSize - 0.01)) violations.push(`(3) its font size ${px(fontSize)}px is smaller than the paragraph's ${px(paragraphFontSize)}px`);
    const entry = { index, text: (link.textContent ?? "").trim().slice(0, 40), classes: [...link.classList], contract, height: link.getBoundingClientRect().height, hold, next, pitches, lines: lines.length, boxes, lineBoxes: lines.map(line => line.strut), fontSize, paragraphFontSize, violations };
    found.push(entry);
    linkEntries.push({ index, entry });
    if (contract === "hit-area") hitAreas.push({ index, entry });
  });
  // (5) A hit-area link against every other link in main. A pair of two hit-area links is checked once, by the later.
  const hitIndex = new Set(hitAreas.map(h => h.index));
  for (const { index, entry } of hitAreas) {
    anchors.forEach((other, j) => {
      if (j === index || (hitIndex.has(j) && j > index) || other.contains(anchors[index]) || anchors[index].contains(other)) return;
      const otherLength = (other.textContent ?? "").trim().slice(0, 40).length;
      for (const p of entry.boxes) for (const q of rectsOf(other)) {
        const left = Math.max(p.left, q.left), right = Math.min(p.right, q.right), top = Math.max(p.top, q.top), bottom = Math.min(p.bottom, q.bottom);
        if (right - left > 0.01 && bottom - top > 0.01) entry.violations.push(`(5) the boxes of two links (of ${otherLength} and ${entry.text.length} characters) intersect over ${px(left)}..${px(right)} x ${px(top)}..${px(bottom)}`);
      }
    });
  }
  // (5) also between two plain links: boxes that meet by 2px or more in both directions (a negative margin, a shift)
  // put one link's tap on the other. Reported once per pair, on the later link, with both texts' lengths.
  const plain = linkEntries.filter(({ entry }) => entry.contract === "plain");
  plain.forEach((first, n) => plain.slice(n + 1).forEach(second => {
    if (anchors[first.index].contains(anchors[second.index]) || anchors[second.index].contains(anchors[first.index])) return;
    for (const p of first.entry.boxes) for (const q of second.entry.boxes) {
      const width = Math.min(p.right, q.right) - Math.max(p.left, q.left), height = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
      if (width >= 2 && height >= 2) second.entry.violations.push(`(5) the boxes of two plain links (of ${first.entry.text.length} and ${second.entry.text.length} characters) intersect by ${px(width)} x ${px(height)}px`);
    }
  }));
  return found;
}
