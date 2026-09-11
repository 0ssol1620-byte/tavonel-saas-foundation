"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { NAV_GROUPS, NAV_PRICING, navSectionForPath } from "@/lib/site-navigation";

/*
  A disclosure navigation, not a menu bar.

  Four triggers, one panel open at a time, every destination a real `<a href>`. It is deliberately
  the W3C disclosure-navigation pattern and not the application-menu role: this is a set of links
  to pages, not a set of commands, and taking that role would promise arrow-key semantics a
  website navigation does not have and should not claim.

  Three things this does not do, each on purpose.

  It does not open on hover. Hover-open menus are unusable with a keyboard as the primary gesture,
  fire on pointer travel across the bar, and have no touch equivalent -- so the only open gesture
  is click / Enter / Space, which a `<button>` gives for free. With no hover-open there is also no
  premature-close gap to engineer around: moving the pointer from the trigger into the panel
  changes nothing, because nothing is listening.

  It does not trap focus. `components/world-visual/use-dialog-focus.ts` is the repository's focus
  trap and it is for Explore's modals; reaching for it here would be the regression
  `e2e/launch-qa-mobile-nav.spec.ts` has guarded against on the phone since the mobile menu
  shipped. Tab walks the panel's links and then leaves for the rest of the header.

  It does not navigate from the trigger. A control that both opens a panel and goes to a page is
  the one that cannot be operated confidently; the hub is a link inside the panel instead
  (`overviewHref`), which is why Product's panel leads with "Product overview".
*/
export default function DesktopPrimaryNav() {
  const [open, setOpen] = useState<string | null>(null);
  const root = useRef<HTMLElement | null>(null);
  const pathname = usePathname();
  const current = navSectionForPath(pathname);

  // The header survives a client navigation, so a panel left open would hang over the page the
  // reader just asked for -- the same failure the phone menu fixed with the same effect.
  useEffect(() => { setOpen(null); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(null);
      // Escape hands the reader back the trigger they opened, not the top of the document.
      root.current?.querySelector<HTMLButtonElement>(`#site-nav-trigger-${open}`)?.focus();
    };
    /*
      `pointerdown` rather than `click`, so a press that starts on the page closes the panel
      before the press completes. A press that starts anywhere inside the nav is the trigger's
      own business: that is what lets one trigger hand over to another without this handler and
      the button's `onClick` both firing and cancelling out.
    */
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target)) return;
      setOpen(null);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <nav aria-label="Sections" className="site-nav" ref={root}>
      {NAV_GROUPS.map((group) => (
        <span className="site-nav-group" key={group.section}>
          <button
            type="button"
            id={`site-nav-trigger-${group.section}`}
            className="site-nav-trigger"
            aria-expanded={open === group.section}
            aria-controls={`site-nav-${group.section}`}
            aria-current={current === group.section ? "true" : undefined}
            onClick={() => setOpen((value) => (value === group.section ? null : group.section))}
          >
            {group.label}
          </button>
          <div className="site-nav-panel" id={`site-nav-${group.section}`} hidden={open !== group.section}>
            <div className="site-nav-panel-inner">
              {group.columns.map((column) => (
                <div className="site-nav-column" key={column.title}>
                  <p className="site-nav-column-title">{column.title}</p>
                  {column.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href as Route}
                      data-overview={item.href === group.overviewHref ? "" : undefined}
                      onClick={() => setOpen(null)}
                    >
                      <b>{item.label}</b>
                      {item.description ? <i>{item.description}</i> : null}
                    </Link>
                  ))}
                </div>
              ))}
              {group.featured ? (
                <p className="site-nav-featured">
                  <Link
                    href={group.featured.href as Route}
                    data-overview={group.featured.href === group.overviewHref ? "" : undefined}
                    onClick={() => setOpen(null)}
                  >
                    {group.featured.label}
                  </Link>
                </p>
              ) : null}
            </div>
          </div>
        </span>
      ))}
      <Link
        href={NAV_PRICING.href as Route}
        aria-current={current === "pricing" ? "true" : undefined}
      >
        {NAV_PRICING.label}
      </Link>
    </nav>
  );
}
