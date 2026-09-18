"use client";

import { useEffect } from "react";

/**
 * G1-014: `<html lang>` follows the page, for the one page that is not English.
 *
 * `/ko` served `<html lang="en">` around Korean copy, which tells a screen reader to pronounce
 * Hangul with an English voice and tells a translation tool the page is already in its target
 * language. The root layout stays `en` on purpose -- it is inherited by sixty English routes and
 * `app/layout.tsx` is another lane's file -- so the correction is made in two places that are
 * true at the same time.
 *
 * The wrapper `PublicSitePage` renders carries `lang="ko"`, which is what CSS `:lang(ko)` and an
 * assistive technology reading the subtree both act on, and this sets the document element on
 * mount for the tools that read only the root. It is an effect rather than markup because a
 * server component cannot reach outside its own tree, and it restores `en` on unmount so a
 * client-side navigation away from /ko does not leave the rest of the site labelled Korean.
 */
export default function DocumentLangKo() {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.lang;
    root.lang = "ko";
    return () => { root.lang = previous || "en"; };
  }, []);
  return null;
}
