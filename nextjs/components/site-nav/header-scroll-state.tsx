"use client";

import { useEffect } from "react";

/**
 * The header's scrolled state, blueprint §8: transparent over the top of the page, and after 40px
 * of scroll a ground of `rgba(8,9,11,.78)` behind 14px of blur with a hairline under it.
 *
 * This renders nothing. The attribute goes on the `<header>` because that is the element the
 * ground and the blur belong to, and the header is a server component -- it cannot hold a ref, and
 * making it a client component would pull `primaryCallToAction()` and the whole footer into the
 * browser bundle for one boolean. So the effect finds the bar by the class the header is rendered
 * with; `header.nav` is one element per document (it is `position: fixed` and every public surface
 * renders exactly one), and if it is ever not there this does nothing rather than guessing.
 *
 * SSR renders no attribute at all, which is the unscrolled state, so the first paint is correct
 * before this file has run. That matters for more than tidiness: the bar sits over a 900px hero,
 * and a server-rendered opaque bar that turns transparent on hydration is a visible flash on the
 * one element above the fold of every page.
 *
 * The listener is passive and coalesced into one `requestAnimationFrame`: a scroll handler that
 * writes to the DOM on every event is the standard way to make a smooth page janky, and the only
 * thing this needs to know is which side of 40px the page is on.
 */
export default function HeaderScrollState() {
  useEffect(() => {
    const header = document.querySelector<HTMLElement>("header.nav");
    if (!header) return;
    let frame = 0;
    const apply = () => {
      frame = 0;
      header.dataset.scrolled = window.scrollY > 40 ? "1" : "0";
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(apply);
    };
    // A reload lands mid-page often enough that reading the position once on mount is not optional.
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
      delete header.dataset.scrolled;
    };
  }, []);
  return null;
}
