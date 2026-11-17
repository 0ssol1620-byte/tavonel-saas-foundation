/**
 * Drawer pass (WO-CI-9): the V34 shell's phone and tablet menu, a modal <dialog> opened by the
 * header's "Open navigation" button at 1000px and below (components/v34/shell/mobile-drawer.tsx).
 *
 * Promises judged (each a violation when broken): a tap opens the drawer inside the viewport and
 * modal; its text and controls hold AA contrast while open, the closed groups opened; Escape closes
 * it and hands focus back to the trigger (`escapeRestoresFocus`); following any link in it — one to
 * the page already open, and one to another page — leaves no drawer open and the page scrollable.
 *
 * Measured and reported, not judged (the shell makes no promise about them): taps that opened
 * nothing before hydration, and where focus lands after a followed link.
 */

import type { Page } from "@playwright/test";
import { contrastPass, controlContrastPass } from "./v34-contrast";
import { escapeRestoresFocus } from "./v34-keyboard";
import type { Violation } from "./v34-measure";

export const DRAWER_HEADER = "[data-v34-header]";
export const DRAWER_TRIGGER = `${DRAWER_HEADER} button[aria-label="Open navigation"]`;
export const DRAWER = `${DRAWER_HEADER} dialog`;
/** The header gives its items to the drawer at this width and below (mobile-drawer.module.css). */
export const DRAWER_MAX_WIDTH = 1000;

export type DrawerResult = { violations: Violation[]; reported: Violation[]; hasHeader: boolean };

const isOpen = (page: Page) => page.locator(DRAWER).first().evaluate(d => (d as HTMLDialogElement).open);

/** Where focus is, as a short name; "trigger" when it is the drawer's own button. */
const focusName = (page: Page) =>
  page.evaluate(trigger => {
    const a = document.activeElement;
    if (!a || a === document.body || a === document.documentElement) return "body";
    if (a === document.querySelector(trigger)) return "trigger";
    return `${a.tagName.toLowerCase()}[${(a.getAttribute("aria-label") ?? a.textContent ?? "").trim().slice(0, 24)}]`;
  }, DRAWER_TRIGGER);

/** No modal dialog anywhere, no open drawer, and the root scrolls (the shell locks it while the drawer is open). */
const leftOpen = (page: Page) =>
  page.evaluate(drawer => {
    const found: string[] = [];
    if (document.querySelector(`${drawer}[open]`)) found.push("the drawer is still open");
    else if (document.querySelector(":modal")) found.push("a modal dialog is still open");
    if (getComputedStyle(document.documentElement).overflow === "hidden") found.push("the page is still scroll-locked");
    return found;
  }, DRAWER);

/**
 * Taps the trigger until the drawer opens, from as early as the page lets it be tapped. Returns the
 * number of taps that opened nothing and the time to the first open, or null if it never opened.
 */
export async function tapUntilOpen(page: Page, budgetMs = 10_000): Promise<{ lost: number; ms: number } | null> {
  const started = Date.now();
  let lost = 0;
  while (Date.now() - started < budgetMs) {
    await page.locator(DRAWER_TRIGGER).first().click({ timeout: 2000 }).catch(() => undefined);
    // A tap is answered in the same task (showModal is synchronous); one frame is enough to read it.
    await page.waitForTimeout(50);
    if (await isOpen(page)) return { lost, ms: Date.now() - started };
    lost += 1;
    await page.waitForTimeout(100);
  }
  return null;
}

/** Opens the drawer from a hydrated page; false if it does not open. */
async function open(page: Page): Promise<boolean> {
  if (await isOpen(page)) return true;
  await page.locator(DRAWER_TRIGGER).first().click({ timeout: 2000 }).catch(() => undefined);
  await page.waitForTimeout(100);
  return isOpen(page);
}

/** Same-origin links in the drawer: index among all its links, resolved path, and whether it sits in the drawer's nav. */
const drawerLinks = (page: Page) =>
  page.locator(DRAWER).first().evaluate(d =>
    [...d.querySelectorAll<HTMLAnchorElement>("a[href]")]
      .map((a, index) => ({ a, index, url: new URL(a.href, location.href) }))
      .filter(({ url }) => url.origin === location.origin)
      .map(({ a, index, url }) => ({ index, path: url.pathname, nav: !!a.closest("nav"), label: (a.getAttribute("aria-label") ?? a.textContent ?? "").trim().slice(0, 30) })),
  );

/** Follows the drawer's `index`th link (opening its group first) and returns what stayed open and where focus went. */
async function follow(page: Page, index: number, path: string): Promise<{ open: string[]; focus: string; url: string }> {
  const link = page.locator(DRAWER).first().locator("a[href]").nth(index);
  const group = link.locator("xpath=ancestor::details[1]");
  if ((await group.count()) > 0 && !(await group.evaluate(g => (g as HTMLDetailsElement).open))) {
    await group.locator(":scope > summary").click();
  }
  await link.click({ timeout: 3000 });
  await page.waitForURL(url => url.pathname === path, { timeout: 10_000 }).catch(() => undefined);
  await page.waitForLoadState("load").catch(() => undefined);
  // The close and any focus handling run in the click task or the next render; let both land.
  await page.waitForTimeout(400);
  return { open: await leftOpen(page), focus: await focusName(page), url: new URL(page.url()).pathname };
}

/**
 * The drawer pass for `route`, on a page navigated to it with `waitUntil: "commit"` and
 * nothing else done, so the first taps can land before hydration. The page is left on another route.
 */
export async function drawerPass(page: Page, route: string): Promise<DrawerResult> {
  const result: DrawerResult = { violations: [], reported: [], hasHeader: true };
  const v = (pass: string, selector: string, detail: string) => result.violations.push({ pass, selector, detail });
  const r = (pass: string, selector: string, detail: string) => result.reported.push({ pass, selector, detail });

  await page.locator(DRAWER_HEADER).first().waitFor({ state: "attached", timeout: 10_000 }).catch(() => undefined);
  if ((await page.locator(DRAWER_HEADER).count()) === 0) {
    result.hasHeader = false;
    v("drawer-open", DRAWER_HEADER, "the page renders no V34 header");
    return result;
  }
  const width = page.viewportSize()?.width ?? 0;
  if (!(await page.locator(DRAWER_TRIGGER).first().isVisible())) {
    v("drawer-open", DRAWER_TRIGGER, `no visible drawer trigger at ${width}px (the drawer serves ${DRAWER_MAX_WIDTH}px and below)`);
    return result;
  }

  /* 1. A tap opens it: inside the viewport, modal, and the trigger says so. */
  const first = await tapUntilOpen(page);
  if (!first) {
    v("drawer-open", DRAWER_TRIGGER, "tapping the trigger for 10 s never opened the drawer");
    return result;
  }
  if (first.lost > 0) {
    r("drawer-hydration", DRAWER_TRIGGER, `${first.lost} tap(s) after the first response byte opened nothing; the first open came ${first.ms} ms in`);
  }
  const state = await page.locator(DRAWER).first().evaluate((d, trigger) => {
    const b = d.getBoundingClientRect();
    return {
      left: b.left, right: b.right, top: b.top, width: b.width, height: b.height,
      inner: window.innerWidth,
      modal: d.matches(":modal"),
      expanded: document.querySelector(trigger)?.getAttribute("aria-expanded") ?? null,
    };
  }, DRAWER_TRIGGER);
  if (state.width < 1 || state.height < 1) v("drawer-open", DRAWER, "the open drawer has no box");
  if (state.left < -0.5 || state.right > state.inner + 0.5) v("drawer-open", DRAWER, `spans ${Math.round(state.left)}..${Math.round(state.right)}px of a ${state.inner}px viewport`);
  if (!state.modal) v("drawer-open", DRAWER, "open but not modal: the page behind it stays interactive");
  if (state.expanded !== "true") v("drawer-open", DRAWER_TRIGGER, `aria-expanded is ${JSON.stringify(state.expanded)} while the drawer is open`);

  /* 2. Contrast with the drawer open, every group expanded so the links inside are painted. */
  await page.locator(DRAWER).first().evaluate(d => d.querySelectorAll("details:not([open])").forEach(g => ((g as HTMLDetailsElement).open = true)));
  const text = await contrastPass(page, { scope: DRAWER });
  result.violations.push(...text.violations.map(x => ({ ...x, detail: `drawer open: ${x.detail}` })));
  result.reported.push(...text.reported);
  if (text.checked === 0) v("contrast", DRAWER, "drawer open: no text in the drawer could be sampled");
  result.violations.push(...(await controlContrastPass(page, 30, DRAWER)).map(x => ({ ...x, detail: `drawer open: ${x.detail}` })));

  /* 3. Escape closes it and focus returns to the trigger: from the open drawer, then again from the keyboard. */
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  if (await isOpen(page)) v("escape-restore", DRAWER, "still open after Escape");
  else if ((await focusName(page)) !== "trigger") v("escape-restore", DRAWER_TRIGGER, `focus went to ${await focusName(page)}, not the trigger, after Escape`);
  result.violations.push(...(await escapeRestoresFocus(page, DRAWER_TRIGGER, DRAWER)));
  const expanded = await page.locator(DRAWER_TRIGGER).first().getAttribute("aria-expanded");
  if (expanded !== "false") v("escape-restore", DRAWER_TRIGGER, `aria-expanded is ${JSON.stringify(expanded)} after the drawer closed`);
  if (await isOpen(page)) await page.keyboard.press("Escape");

  /* 4. A followed link closes it: every link to the page already open (no route change), then one to another page. */
  if (!(await open(page))) {
    v("drawer-link-close", DRAWER_TRIGGER, "the drawer did not reopen for the link checks");
    return result;
  }
  const links = await drawerLinks(page);
  const same = links.filter(l => l.path === route);
  const other = links.find(l => l.path !== route && l.nav) ?? links.find(l => l.path !== route);
  if (!other) v("drawer-link-close", DRAWER, "the drawer has no link to another page");
  for (const link of same) {
    if (!(await open(page))) {
      v("drawer-link-close", DRAWER_TRIGGER, "the drawer did not reopen for the link checks");
      return result;
    }
    const after = await follow(page, link.index, link.path);
    for (const o of after.open) v("drawer-link-close", `a[${link.label}] -> ${link.path}`, `following a link to the page already open: ${o}`);
    r("drawer-link-focus", `a[${link.label}] -> ${link.path}`, `focus after following a link to the page already open: ${after.focus}`);
    // A drawer the link failed to close is closed here, so the next check starts from a closed drawer.
    if (await isOpen(page)) await page.keyboard.press("Escape");
  }
  if (other) {
    if (!(await open(page))) {
      v("drawer-link-close", DRAWER_TRIGGER, "the drawer did not reopen for the link checks");
      return result;
    }
    const after = await follow(page, other.index, other.path);
    if (after.url !== other.path) v("drawer-link-close", `a[${other.label}] -> ${other.path}`, `following the link did not reach ${other.path} (at ${after.url})`);
    for (const o of after.open) v("drawer-link-close", `a[${other.label}] -> ${other.path}`, `following a link to another page: ${o}`);
    r("drawer-link-focus", `a[${other.label}] -> ${other.path}`, `focus after following a link to another page: ${after.focus}`);
  }
  return result;
}
