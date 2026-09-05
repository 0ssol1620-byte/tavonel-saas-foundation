"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { PRIMARY_NAV } from "@/lib/site-navigation";

/*
  A disclosure, kept a disclosure.

  The panel is still a `<details>`: it works with no JavaScript, the summary is a real button to
  every assistive technology, and the browser owns the open state. What the element does not give
  is the two behaviours a menu needs once it is open — Escape closes it, and following a link
  closes it. Both are added here rather than by replacing the element with a dialog, because a
  dialog would take focus captive and this is a seven-link menu, not a modal task. Nothing here
  traps focus: Tab leaves the panel and reaches the page behind it, which is correct for a
  disclosure and is the reason it is one.

  Route changes close it too. `next/link` navigates without unmounting the shared header, so
  after the first tap the panel stayed open over the page the visitor had just asked for.
*/
export default function MobilePrimaryNav() {
  const ref = useRef<HTMLDetailsElement | null>(null);
  const pathname = usePathname();

  const close = useCallback(() => {
    const element = ref.current;
    if (element?.open) element.open = false;
  }, []);

  useEffect(() => { close(); }, [pathname, close]);

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

  return (
    <details className="mobile-primary-nav" ref={ref}>
      <summary aria-label="Open site navigation">Menu</summary>
      <nav aria-label="Mobile sections">
        {PRIMARY_NAV.map((link) => (
          <Link key={link.href} href={link.href as Route} onClick={close}>{link.label}</Link>
        ))}
      </nav>
    </details>
  );
}
