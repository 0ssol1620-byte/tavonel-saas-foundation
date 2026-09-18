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
      <summary aria-label="Open site navigation">Menu</summary>
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
