"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { NAV_OPEN_EVENT } from "@/lib/marketing-analytics";
import { CUSTOMER_NAV, KO_CHROME, customerNavOwns } from "@/lib/site-navigation";

/** Native disclosure works without JavaScript. Escape returns focus; Tab never gets trapped. */
export default function MobilePrimaryNav({ korean = false }: { korean?: boolean }) {
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

        It read "Open site navigation" while the control reads Menu, so the accessible name did
        not contain the visible text: WCAG 2.5.3, and a real failure rather than a lint opinion --
        a voice-control user says "click menu" and nothing happens, because the name the assistive
        layer matches against is the label, not the word on screen. Native `<summary>` takes its
        name from its own text, and the text is the better name, so the fix is to delete the
        attribute rather than to rewrite it. Open/closed state is announced by the `<details>`
        element itself, which is what the label was trying to add and what it broke the name to
        say.

        BQ-059 keeps that and changes what the word looks like: it was set in 9.5px monospace
        caps, below the site's 12px floor and in the instrument voice, for the one control that
        is the whole navigation on a phone. It is the page's own face at 13px now, in a 44px
        target, and it says "메뉴" on /ko like everything else around it.
      */}
      {/* The span is the hook one-path.css uses below 400px to keep the word as the name while the
          toggle is drawn as a 44px icon. */}
      <summary><span>{korean ? KO_CHROME.menu : "Menu"}</span></summary>
      <nav aria-label={korean ? "모바일 섹션" : "Mobile sections"}>
        {CUSTOMER_NAV.map((item) => (
          <a key={item.href} className="mobile-nav-direct" href={item.href}
            aria-current={customerNavOwns(item.href, pathname) ? "page" : undefined}
            onClick={close}>{korean ? KO_CHROME.nav[item.href] ?? item.label : item.label}</a>
        ))}
        {/*
          BQ-059. The panel no longer repeats the header's action.

          The access button is in the header at every width -- it is the one thing that may not
          be behind a disclosure -- and the sheet drew it a second time, forty pixels below the
          first, so a reader who opened the menu was offered the same destination twice and the
          three sections it was meant to show were pushed down by it.
        */}
      </nav>
    </details>
  );
}
