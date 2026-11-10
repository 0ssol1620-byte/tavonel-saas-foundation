"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

/*
  NAV PANELS, 2026-11-09: this file does not import `lib/site-navigation`, and neither does
  `components/mobile-primary-nav.tsx`. They were the only client modules on / and /ko that did,
  and `/pricing` renders the header from a client component, so every export the header reads
  (the panels, their Korean) lands in that one shared module's chunk -- which / and /ko then
  loaded for three strings and one function. The server passes the strings and each item's owned
  paths instead; `lib/site-nav-model.test.ts` pins the parity of `navCurrent` with
  `customerNavCurrent` and the absence of the import.
*/

/**
 * `customerNavCurrent` (PR141), given the item's own `NAV_ALSO_OWNS` list: the exact page is
 * "page", a location inside the section is "location". A prefix counts only at a segment boundary.
 */
export function navCurrent(href: string, also: readonly string[], pathname: string): "page" | "location" | undefined {
  const path = pathname.replace(/\/+$/, "") || "/";
  const under = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
  if (path === href) return "page";
  return also.some(under) || under(href) ? "location" : undefined;
}

/*
  Founder, 2026-11-10: the header's action is the visitor's own next step, not the public sample ("Open the compiled
  sample" read as "enter the dashboard"). Signed out it is the start action and Sign in stays a plain link beside it;
  signed in it is "Open workspace". The session is read from the Supabase browser client's own storage key
  (lib/supabase-browser.ts: persistSession, default localStorage key `sb-<ref>-auth-token`) rather than by loading
  supabase-js on every public page: it is a hint, and /workspace still checks the session itself. Server-rendered
  signed out, so the first paint is the anonymous header and a returning reader's swaps after hydration.
*/
const SESSION_KEY = /^sb-.+-auth-token$/;

/** `explicit` (a caller that already asked Supabase, e.g. /pricing) wins over the storage hint. */
export function useSignedIn(explicit?: boolean): boolean {
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (explicit !== undefined) return;
    try { setHint(Object.keys(window.localStorage).some((key) => SESSION_KEY.test(key))); } catch { /* storage blocked: anonymous */ }
  }, [explicit]);
  return explicit ?? hint;
}

/** Sign in and the start action signed out; Open workspace signed in. */
export function HeaderAccountActions({ signedIn, start, labels, className, signInClassName }: {
  signedIn?: boolean;
  start: { href: string; label: string };
  labels: { signIn: string; workspace: string };
  className: string;
  signInClassName: string;
}) {
  const pathname = usePathname();
  if (useSignedIn(signedIn)) return <Link className={className} href="/workspace" prefetch={false} data-analytics="header-workspace">{labels.workspace}</Link>;
  return (
    <>
      <Link className={signInClassName} href="/login">{labels.signIn}</Link>
      {pathname === start.href ? null : <Link className={className} href={start.href as Route} prefetch={false} data-analytics="header-start">{start.label}</Link>}
    </>
  );
}

/**
 * A bar item: the one part of the server-rendered navigation that has to know the route.
 *
 * `also` is `navAlsoOwns(match)` from the server, and `match` is the href the item stands for when
 * it links elsewhere (the sheet's Pricing row points at /ko/pricing on /ko and is still /pricing).
 * The phone sheet's rows stay plain anchors, as they were before the panels came back.
 */
export function NavCurrentLink({ href, match = href, also, className, section, native = false, children }: {
  href: string;
  match?: string;
  also: readonly string[];
  className: string;
  /** Present only when the item opens a panel; the disclosure below reads it. */
  section?: string;
  native?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const props = { className, "data-section": section, "aria-current": navCurrent(match, also, pathname) };
  return native ? <a href={href} {...props}>{children}</a> : <Link href={href as Route} {...props}>{children}</Link>;
}

/*
  The pointer may cross the gap between a bar item and its panel, or a pixel outside both, without
  the panel dropping. Well inside the 180ms motion budget, so a close still reads as immediate.
*/
const CLOSE_DELAY_MS = 160;

/**
 * Opens and closes the panels its parent `<nav>` renders. Renders nothing visible.
 *
 * The open state is `aria-expanded` on each panel's toggle and nothing else: CSS draws the panel
 * from that attribute (`public-site-chrome.module.css`), so what assistive technology is told and what the
 * reader sees cannot disagree. The markup is server-rendered; this file only moves the attribute.
 *
 * `hover` is the desktop bar: a mouse over an item, its toggle or its panel opens that panel, and
 * leaving them closes it after the delay above. Escape closes it and returns focus to the toggle if
 * focus was in the bar, and focus or a press anywhere outside the open group closes it. Touch never
 * opens on hover -- a tap on a bar label is a tap on a link. Without `hover` this is the phone
 * sheet's accordion: one group open at a time, the toggles only, and the group that owns the page
 * being read starts open. Escape there belongs to the sheet itself (`mobile-primary-nav.tsx`).
 *
 * The markup it drives is `NavSections` in `components/public-site-chrome.tsx`.
 *
 * No focus trap and no menu role: these are links to pages, and Tab walks out of them.
 */
export function NavDisclosure({ hover = false }: { hover?: boolean }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    const root = anchor.current?.parentElement;
    if (!root) return;
    const toggles = [...root.querySelectorAll<HTMLButtonElement>("button[aria-controls]")];
    let timer = 0;
    const openToggle = () => toggles.find((toggle) => toggle.getAttribute("aria-expanded") === "true");
    const set = (next?: HTMLButtonElement) => {
      window.clearTimeout(timer);
      for (const toggle of toggles) toggle.setAttribute("aria-expanded", String(toggle === next));
      // The panel hangs under its own bar item rather than under the first one.
      const label = next?.previousElementSibling;
      if (hover && next && label instanceof HTMLElement) {
        document.getElementById(next.getAttribute("aria-controls") ?? "")?.style.setProperty("--nav-panel-x", `${label.offsetLeft}px`);
      }
    };
    const closeSoon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => set(), CLOSE_DELAY_MS);
    };
    const toggleOf = (target: EventTarget | null) => {
      const section = target instanceof Element ? target.closest("[data-section]")?.getAttribute("data-section") : null;
      return section ? toggles.find((toggle) => toggle.dataset.section === section) : undefined;
    };

    // A route change closes the bar; on a phone it opens the group whose label marks the new page.
    set(hover ? undefined : toggles.find((toggle) => toggle.previousElementSibling?.hasAttribute("aria-current")));

    const onClick = (event: MouseEvent) => {
      const target = event.target as Element;
      const toggle = target.closest<HTMLButtonElement>("button[aria-controls]");
      if (toggle && toggles.includes(toggle)) {
        // A mouse click on a toggle the pointer already opened keeps it open; keys and touch toggle.
        const pointerOpened = hover && event.detail > 0 && window.matchMedia("(hover: hover)").matches;
        set(openToggle() === toggle && !pointerOpened ? undefined : toggle);
        return;
      }
      if (hover && target.closest("a")) set();
    };
    root.addEventListener("click", onClick);
    if (!hover) return () => root.removeEventListener("click", onClick);

    const onOver = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const toggle = toggleOf(event.target);
      if (toggle) set(toggle);
      else if (openToggle()) closeSoon();
    };
    const onLeave = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && openToggle()) closeSoon();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const open = openToggle();
      if (event.key !== "Escape" || !open) return;
      set();
      if (root.contains(document.activeElement)) open.focus();
    };
    const onFocusIn = (event: FocusEvent) => {
      const open = openToggle();
      if (open && toggleOf(event.target) !== open) set();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (openToggle() && !root.contains(event.target as Node)) set();
    };
    root.addEventListener("pointerover", onOver);
    root.addEventListener("pointerleave", onLeave);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.clearTimeout(timer);
      root.removeEventListener("click", onClick);
      root.removeEventListener("pointerover", onOver);
      root.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [hover, pathname]);
  return <span hidden ref={anchor} />;
}
