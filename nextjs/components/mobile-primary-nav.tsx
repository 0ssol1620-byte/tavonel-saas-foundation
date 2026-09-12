"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { NAV_OPEN_EVENT } from "@/lib/marketing-analytics";
import { NAV_GROUPS, NAV_PRICING, navSectionForPath, type SiteLink } from "@/lib/site-navigation";

/*
  A disclosure, kept a disclosure, with the sections grouped inside it.

  The panel is still a `<details>`: it works with no JavaScript, the summary is a real button to
  every assistive technology, and the browser owns the open state. What the element does not give
  is the two behaviours a menu needs once it is open -- Escape closes it, and following a link
  closes it. Both are added here rather than by replacing the element with a dialog, because a
  dialog would take focus captive and this is a list of links, not a modal task. Nothing here
  traps focus: Tab leaves the panel and reaches the page behind it, which is correct for a
  disclosure and is the reason it is one.

  Route changes close it too. `next/link` navigates without unmounting the shared header, so
  after the first tap the panel stayed open over the page the visitor had just asked for.

  What the 2026-09-11 IA redesign changed: the panel was a flat list of all eight top-level
  links, which is the desktop bar transcribed rather than a phone navigation. It is now the same
  four groups the desktop panels use, as nested disclosures, plus Pricing as a direct link. One
  group is open at a time, and the group that owns the current page starts open -- the flat list
  had no way to say where the reader already was.

  The desktop panel's two-column layout is deliberately not carried over. Two columns narrowed to
  a phone's width are two unreadable columns; a group's links are one stack here.
*/
/**
 * `cta` is the header's own action, handed down so the two widths cannot disagree about it.
 *
 * It is optional for one caller: `/contact` still hand-rolls its header (BA-250, a cross-lane
 * request to the lane that owns that page), and `/contact` is where the action goes anyway -- a
 * sheet that offers "Request access" on the request-access page is a button back to the page you
 * are reading. No caller may pass a label of its own: the object comes from the header.
 */
export default function MobilePrimaryNav({ cta }: { cta?: SiteLink }) {
  const ref = useRef<HTMLDetailsElement | null>(null);
  const pathname = usePathname();
  const current = navSectionForPath(pathname);

  const close = useCallback(() => {
    const element = ref.current;
    if (element?.open) element.open = false;
  }, []);

  useEffect(() => { close(); }, [pathname, close]);

  /*
    The current section's group starts open, set on the element rather than through `open` in JSX.

    A controlled `open` would re-assert itself on every render and fight a reader who collapsed
    it. This runs when the route changes, which is also when the whole panel is being closed, so
    the reader never watches a group reopen under them.
  */
  useEffect(() => {
    if (!current) return;
    const group = ref.current?.querySelector<HTMLDetailsElement>(`details[data-section="${current}"]`);
    if (group) group.open = true;
  }, [current]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const element = ref.current;
      if (!element?.open) return;
      close();
      // Escape returns the reader to the control they opened, not to the top of the document.
      element.querySelector("summary")?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close]);

  /*
    One group at a time, in JS rather than through `<details name>`.

    The `name` attribute gives exclusive accordions natively, but only in browsers new enough to
    implement it; where it is not, the panel silently becomes four groups open at once, which on a
    phone is the scrolling wall the grouping exists to remove. Five lines here behave the same
    everywhere.
  */
  const onGroupToggle = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    const opened = event.currentTarget;
    if (!opened.open) return;
    for (const other of ref.current?.querySelectorAll<HTMLDetailsElement>("details[data-section]") ?? []) {
      if (other !== opened) other.open = false;
    }
  };

  /*
    BA-245: the sheet says when it is open, and the consent banner stops drawing over it.

    On the element's own `toggle` rather than on the summary's click, so the state announced is
    the state the element is in however it got there -- Escape, a link, a route change and the
    `close()` calls above all route through here.
  */
  const onSheetToggle = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    window.dispatchEvent(new CustomEvent(NAV_OPEN_EVENT, { detail: { open: event.currentTarget.open } }));
  };

  return (
    <details className="mobile-primary-nav" ref={ref} onToggle={onSheetToggle}>
      <summary aria-label="Open site navigation">Menu</summary>
      <nav aria-label="Mobile sections">
        {NAV_GROUPS.map((group) => (
          <details
            className="mobile-nav-group"
            key={group.section}
            data-section={group.section}
            onToggle={onGroupToggle}
          >
            <summary aria-current={current === group.section ? "true" : undefined}>{group.label}</summary>
            <span className="mobile-nav-links">
              {group.columns.flatMap((column) => column.items).map((item) => (
                <Link key={item.href} href={item.href as Route} onClick={close}>{item.label}</Link>
              ))}
              {group.featured ? (
                <Link href={group.featured.href as Route} onClick={close}>{group.featured.label}</Link>
              ) : null}
            </span>
          </details>
        ))}
        <Link
          className="mobile-nav-direct"
          href={NAV_PRICING.href as Route}
          aria-current={current === "pricing" ? "true" : undefined}
          onClick={close}
        >
          {NAV_PRICING.label}
        </Link>
        {/*
          BA-232 / BA-245: the same action as the header bar, from the same object.

          The phone header offered "Request access" while the desktop bar said "Contact", because
          the two read different constants. They read one now, and the sheet ends on it -- the
          phone spec's bottom action, which is also the only control a reader reaches without
          closing the menu first.
        */}
        {cta ? (
          <Link className="mobile-nav-cta btn small" href={cta.href as Route} onClick={close}>
            {cta.label}
          </Link>
        ) : null}
      </nav>
    </details>
  );
}
