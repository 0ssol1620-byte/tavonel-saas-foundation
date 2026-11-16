/**
 * Keyboard pass (architecture section 5): a Tab walk of up to 250 stops. Every stop must be inside
 * the viewport with a visible focus indicator; the same element three times is a trap; targets
 * under 24px fail (WCAG 2.5.8) and under 44px are reported. Escape-closes-and-restores-focus is a
 * separate helper because it needs the page's own trigger selector.
 */

import type { Page } from "@playwright/test";
import type { Violation } from "./v34-measure";

export type KeyboardResult = { violations: Violation[]; reported: Violation[]; stops: number };

type Stop = {
  selector: string;
  inViewport: boolean;
  indicator: boolean;
  w: number;
  h: number;
  inline: boolean;
  visits: number;
  isFirst: boolean;
  /** Tabbable elements in document order not yet visited (set on every stop; used when focus returns to the first). */
  unvisited: string[];
};

export async function keyboardWalk(page: Page, max = 250): Promise<KeyboardResult> {
  const result: KeyboardResult = { violations: [], reported: [], stops: 0 };
  // Visits are counted per element identity (a WeakMap in the page), not per selector string.
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    const w = window as unknown as { __v34Visits?: WeakMap<Element, number>; __v34First?: Element | null };
    w.__v34Visits = new WeakMap();
    w.__v34First = null;
  });
  /*
    Playwright's WebKit does not put links in the Tab order (it follows Safari's default: Tab goes to
    form controls, Alt+Tab to links, and in this build Alt+Tab does not reach them either). The walk
    there sees buttons with the document body between them and would call the first body stop the
    end of the page. On WebKit a body stop is skipped, a run of them ends the walk, and anchors are
    left out of the "never reached" list; the result says so rather than judging links it cannot reach.
  */
  const webkit = page.context().browser()?.browserType().name() === "webkit";
  if (webkit) {
    result.reported.push({ pass: "keyboard-engine", selector: "webkit", detail: "this WebKit build does not Tab to links: anchors are judged on chromium and firefox only" });
  }
  let bodyStops = 0;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    /*
      Let a blur handler that schedules a refocus (setTimeout) land before focus is read, and let a
      scroll that focus started finish: with `scroll-behavior: smooth` the focused element is still
      on its way into view for a few hundred ms, and reading its rect then reports it off screen.
    */
    await page.evaluate(() => new Promise<void>(done => {
      const started = performance.now();
      let last = -1;
      let steady = 0;
      const poll = () => {
        const e = document.activeElement;
        const r = e && e !== document.body ? e.getBoundingClientRect() : null;
        const onScreen = !r || (r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth);
        const y = window.scrollY;
        steady = y === last ? steady + 1 : 0;
        last = y;
        // Off screen and still scrolling: wait. Off screen and the page has stopped: that is a finding.
        if (onScreen || steady >= 3 || performance.now() - started > 1200) done();
        else setTimeout(poll, 30);
      };
      setTimeout(poll, 16);
    }));
    const stop: Stop | null = await page.evaluate((skipAnchors) => {
      const e = document.activeElement;
      if (!e || e === document.body || e === document.documentElement) return null;
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      const inViewport = r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
      const indicator =
        (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0 && s.outlineColor !== "rgba(0, 0, 0, 0)") ||
        (s.boxShadow !== "none" && s.boxShadow !== "");
      const w = window as unknown as { __v34Visits: WeakMap<Element, number>; __v34First: Element | null };
      const visits = (w.__v34Visits.get(e) ?? 0) + 1;
      w.__v34Visits.set(e, visits);
      w.__v34First ??= e;
      const isFirst = w.__v34First === e;
      const inline = s.display === "inline" && !!e.closest("p, li, dd, td");
      const id = e.id ? `#${e.id}` : "";
      const cls = typeof e.className === "string" && e.className.trim() ? `.${e.className.trim().split(/\s+/)[0]}` : "";
      const label = (e.textContent ?? e.getAttribute("aria-label") ?? "").trim().slice(0, 24);
      const nm = (x: Element) => `${x.tagName.toLowerCase()}${x.id ? `#${x.id}` : ""}[${(x.textContent ?? x.getAttribute("aria-label") ?? "").trim().slice(0, 24)}]`;
      // Only computed when focus is back on the first stop: every tabbable element must have been reached.
      const unvisited: string[] = [];
      if (isFirst && visits === 2) {
        const sel = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable=""], [contenteditable="true"]';
        const groups = new Set<string>();
        for (const x of document.querySelectorAll(sel)) {
          const xs = getComputedStyle(x);
          const xr = x.getBoundingClientRect();
          if ((x as HTMLInputElement).disabled || (x as HTMLInputElement).type === "hidden" || (x as HTMLElement).tabIndex < 0) continue;
          if (xs.display === "none" || xs.visibility === "hidden" || (xr.width === 0 && xr.height === 0) || x.closest("[inert], [hidden]")) continue;
          if ((x as HTMLInputElement).type === "radio" && (x as HTMLInputElement).name) {
            // A radio group is one tab stop: any visited member counts.
            const key = (x as HTMLInputElement).name;
            if (groups.has(key)) continue;
            groups.add(key);
            const members = [...document.getElementsByName(key)];
            if (members.some(m => (w.__v34Visits.get(m) ?? 0) > 0)) continue;
          }
          if (skipAnchors && x.tagName === "A") continue;
          if (!w.__v34Visits.get(x)) unvisited.push(nm(x));
        }
      }
      return { selector: `${e.tagName.toLowerCase()}${id}${cls}[${label}]`, inViewport, indicator, w: r.width, h: r.height, inline, visits, isFirst, unvisited };
    }, webkit);
    if (!stop) {
      if (webkit) {
        if (++bodyStops >= 3) break;
        continue;
      }
      if (i > 0) break; // focus left the document: the walk is complete
      continue;
    }
    bodyStops = 0;
    if (stop.isFirst && stop.visits === 2) {
      // A natural wrap leaves the document (the null branch above). Landing on the first stop again
      // is only a wrap when nothing was skipped; otherwise focus was sent back: a trap.
      if (stop.unvisited.length) {
        result.violations.push({ pass: "keyboard-trap", selector: stop.selector, detail: `focus returned to the first stop; never reached: ${stop.unvisited.slice(0, 6).join(", ")}` });
      }
      break;
    }
    result.stops += 1;
    const n = stop.visits;
    if (n === 3) result.violations.push({ pass: "keyboard-trap", selector: stop.selector, detail: "received focus three times in one walk" });
    if (!stop.inViewport) result.violations.push({ pass: "focus-visible", selector: stop.selector, detail: "focused element is outside the viewport" });
    if (!stop.indicator) result.violations.push({ pass: "focus-visible", selector: stop.selector, detail: "no outline or box-shadow on focus" });
    if (!stop.inline) {
      if (stop.h < 24 || stop.w < 24) {
        result.violations.push({ pass: "target-size", selector: stop.selector, detail: `${Math.round(stop.w)}x${Math.round(stop.h)} is under 24px (2.5.8)` });
      } else if (stop.h < 44 || stop.w < 44) {
        result.reported.push({ pass: "target-size", selector: stop.selector, detail: `${Math.round(stop.w)}x${Math.round(stop.h)} is under 44px (reported)` });
      }
    }
    if (n >= 3) break;
  }
  return result;
}

/** Opens `trigger` from the keyboard, presses Escape, and checks the surface closed and focus returned to the trigger. */
export async function escapeRestoresFocus(page: Page, trigger: string, surface: string): Promise<Violation[]> {
  const t = page.locator(trigger).first();
  if (!(await t.isVisible())) return [{ pass: "escape-restore", selector: trigger, detail: "trigger not visible" }];
  await t.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  const s = page.locator(surface).first();
  const out: Violation[] = [];
  if (!(await s.isVisible())) out.push({ pass: "escape-restore", selector: surface, detail: "did not open from the trigger" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  if (await s.isVisible()) out.push({ pass: "escape-restore", selector: surface, detail: "still open after Escape" });
  const back = await t.evaluate(e => e === document.activeElement);
  if (!back) out.push({ pass: "escape-restore", selector: trigger, detail: "focus did not return to the trigger" });
  return out;
}
