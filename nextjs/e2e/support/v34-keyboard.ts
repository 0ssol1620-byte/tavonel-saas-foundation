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
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const stop: Stop | null = await page.evaluate(() => {
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
      return { selector: `${e.tagName.toLowerCase()}${id}${cls}[${label}]`, inViewport, indicator, w: r.width, h: r.height, inline, visits, isFirst };
    });
    if (!stop) {
      if (i > 0) break; // focus left the document: the walk is complete
      continue;
    }
    if (stop.isFirst && stop.visits === 2) break; // wrapped around to the first stop
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
