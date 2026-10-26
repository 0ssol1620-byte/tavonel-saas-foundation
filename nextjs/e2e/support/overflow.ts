/**
 * The horizontal-overflow measurement, shared by e2e/overflow-audit.spec.ts (V01) and
 * e2e/templates.spec.ts (UX-L7). Moved here unchanged from overflow-audit.spec.ts so the two specs
 * cannot disagree about what an overflow is; see that spec's header for why it is an element rule and
 * not `document.scrollWidth` alone.
 *
 * Self-contained on purpose: Playwright serialises it into the page.
 */

export type Offender = { selector: string; reason: string; box: string };

/** Runs in the page. Mirrors scripts/find-overflow.mjs, with the scroll-container exemption. */
export function measureOverflow(): { documentOverflow: number; offenders: Offender[] } {
  const limit = window.innerWidth;
  const describe = (element: Element) => {
    const tag = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id}` : "";
    const cls = typeof element.className === "string" && element.className.trim()
      ? `.${element.className.trim().split(/\s+/).slice(0, 2).join(".")}`
      : "";
    return `${tag}${id}${cls}`.slice(0, 120);
  };
  /* A wide child inside a real scroller is the supported pattern for tables and code. Only
     `auto` and `scroll` count: `hidden` is what turns a defect invisible. */
  const clippedByScroller = (element: Element) => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const overflowX = getComputedStyle(parent).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return true;
    }
    return false;
  };
  /*
    Release 3 (2026-10-16): the Home film's desktop reading crop, and nothing else.

    From 900px the film opens on a 2x crop of the stage's two reading panes
    (`.compile-film-sequence[data-wide-view="crop"]`), drawn as `transform: scale(2)` on the
    media inside `.compile-film-viewport`, which clips it (`overflow: hidden`). The transform makes
    the media's client rect twice the frame: measured on build sRc4B7jgCEvbjOa4NSbYo, the video's
    rect is 2396px at x=-478 (1440), 2396 at x=-238 (1920), 1942 at x=-459 (1024), while its layout
    box is 1198/1198/971px and the frame is 1200px at x=120-1320 / 360-1560 and 973px at x=26-998.
    Nothing reaches the viewport edge: what is painted is the frame, and "Fit full frame" shows the
    whole picture. The exemption holds only while all of that is true -- the crop is declared, the
    frame itself clips and lies inside the viewport, and the media's untransformed box fits the
    frame -- so a real overflow inside the film, or a frame that outgrows the page, still fails.
  */
  const declaredFilmCrop = (element: Element) => {
    const frame = element.parentElement;
    if (!frame?.matches('.compile-film-sequence[data-wide-view="crop"] .compile-film-viewport')) return false;
    const frameStyle = getComputedStyle(frame);
    if (frameStyle.overflowX !== "hidden" && frameStyle.overflowX !== "clip") return false;
    const frameBox = frame.getBoundingClientRect();
    if (frameBox.left < -1 || frameBox.right > limit + 1) return false;
    return getComputedStyle(element).transform !== "none" && (element as HTMLElement).offsetWidth <= frameBox.width + 1;
  };
  /*
    FINAL-SPEC 2026-10-26 §2.1: the Home phone pane, and nothing else. Below 768px the film opens on one source panel
    (`.compile-film-sequence[data-story-layout="1"][data-mobile-view="focus"]`): the 2880px cut is drawn at 2880/w of
    the 4:5 frame's width (w = the stage's rect width, the sequence's --pane-w, at most the spec's 684) and translated by the stage's pane offset, and the frame clips it (`overflow: clip`). The
    same conditions as the desktop crop, restated for the pane: the pane is declared, the frame clips and lies inside
    the viewport, the media is the film's own (video or still), absolutely positioned and translated, and its
    untransformed width is exactly the pane scale of the frame -- so a pane drawn at any other size, or a frame that
    outgrows the page, still fails.
  */
  const declaredPhonePane = (element: Element) => {
    if (!element.matches("video.compile-film-video, img.compile-film-still")) return false;
    const frame = element.closest('.compile-film-sequence[data-story-layout="1"][data-mobile-view="focus"] .compile-film-viewport');
    if (!frame || limit >= 768) return false;
    const frameStyle = getComputedStyle(frame);
    if (frameStyle.overflowX !== "hidden" && frameStyle.overflowX !== "clip") return false;
    const frameBox = frame.getBoundingClientRect();
    if (frameBox.left < -1 || frameBox.right > limit + 1) return false;
    const style = getComputedStyle(element);
    if (style.position !== "absolute" || style.transform === "none") return false;
    const paneW = Number(getComputedStyle(frame.closest(".compile-film-sequence")!).getPropertyValue("--pane-w"));
    if (!(paneW > 0 && paneW <= 684)) return false;
    return Math.abs((element as HTMLElement).offsetWidth - frame.clientWidth * 2880 / paneW) <= 2;
  };

  const offenders: Offender[] = [];
  for (const element of document.querySelectorAll("body *")) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
    const box = element.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;
    const wider = box.width > limit + 1;
    /* Only normal flow for the edge rule: a closed off-canvas drawer or a visually hidden skip
       link is parked outside the viewport on purpose and is not an overflow defect. */
    const inFlow = style.position === "static" || style.position === "relative";
    const pastEdge = inFlow && box.right > limit + 1;
    if (!wider && !pastEdge) continue;
    if (clippedByScroller(element) || declaredFilmCrop(element) || declaredPhonePane(element)) continue;
    offenders.push({
      selector: describe(element),
      reason: wider ? `wider than the ${limit}px viewport` : `extends ${Math.round(box.right - limit)}px past the right edge`,
      box: `${Math.round(box.width)}x${Math.round(box.height)} at x=${Math.round(box.left)}`,
    });
    if (offenders.length >= 12) break;
  }
  return {
    documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    offenders,
  };
}
