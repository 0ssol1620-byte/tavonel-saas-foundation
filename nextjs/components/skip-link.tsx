"use client";

import { usePathname } from "next/navigation";

/**
 * BQ-013. The first control in the tab order, in the language of the page it is on.
 *
 * `/ko` is the site's one Korean URL and the first thing a Korean keyboard or screen-reader
 * visitor reached on it was "Skip to content". The rest of that page's chrome already follows
 * `KO_CHROME`; this was the one string left in the root layout, above every route, where a
 * `korean` prop cannot reach it.
 *
 * A client component reading the path is the whole fix: one string, one condition, no locale
 * layer for a site with one translated page.
 */
export default function SkipLink() {
  const korean = usePathname()?.startsWith("/ko") ?? false;
  return (
    <a className="skip" href="#main">{korean ? "본문으로 건너뛰기" : "Skip to content"}</a>
  );
}
