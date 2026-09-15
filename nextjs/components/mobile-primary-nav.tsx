"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { NAV_OPEN_EVENT } from "@/lib/marketing-analytics";
import { CUSTOMER_NAV, customerNavOwns, type SiteLink } from "@/lib/site-navigation";

/** Native disclosure works without JavaScript. Escape returns focus; Tab never gets trapped. */
export default function MobilePrimaryNav({ cta }: { cta?: SiteLink }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  const close = useCallback(() => {
    const details = ref.current;
    if (details) details.open = false;
  }, []);
  useEffect(() => { close(); }, [pathname, close]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !ref.current?.open) return;
      close();
      ref.current.querySelector("summary")?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.dispatchEvent(new CustomEvent(NAV_OPEN_EVENT, { detail: { open: false } }));
    };
  }, [close]);
  return (
    <details className="mobile-primary-nav one-path-mobile-nav" ref={ref}
      onToggle={(event) => window.dispatchEvent(new CustomEvent(NAV_OPEN_EVENT, { detail: { open: event.currentTarget.open } }))}>
      {/*
        T1-006 -- no `aria-label`, on purpose.

        It read "Open site navigation" while the control reads MENU, so the accessible name did
        not contain the visible text: WCAG 2.5.3, and a real failure rather than a lint opinion --
        a voice-control user says "click menu" and nothing happens, because the name the assistive
        layer matches against is the label, not the word on screen. Native `<summary>` takes its
        name from its own text, and the text is the better name, so the fix is to delete the
        attribute rather than to rewrite it. Open/closed state is announced by the `<details>`
        element itself, which is what the label was trying to add and what it broke the name to
        say.
      */}
      <summary>Menu</summary>
      <nav aria-label="Mobile sections">
        {CUSTOMER_NAV.map((item) => (
          <a key={item.href} className="mobile-nav-direct" href={item.href}
            aria-current={customerNavOwns(item.href, pathname) ? "page" : undefined}
            onClick={close}>{item.label}</a>
        ))}
        {cta ? <a className="mobile-nav-cta btn small" href={cta.href} onClick={close}>{cta.label}</a> : null}
      </nav>
    </details>
  );
}
