import type { ReactNode } from "react";
import { v34Route, type V34RouteKey } from "@/lib/v34/routes";
import tokens from "../tokens.module.css";
import { surfaceClass, type V34Surface } from "../ui/surface";
import SiteFooter from "./site-footer";
import SiteHeader from "./site-header";
import s from "./v34-page.module.css";

/**
 * The frame every V34 route renders inside: the token wrapper, the header, the one `<main>` and the
 * footer. A route's page file is thin: metadata, the release gate, then `<V34Page route="key">`.
 *
 * Landmarks: banner (header), navigation (primary, More, footer groups, each labelled), main and
 * contentinfo. The page's single h1 belongs to the page body (`Hero` or `ArticleLayout`), not to
 * this frame, so a body that forgets it is visible in review instead of being papered over here.
 *
 * The skip link is the root layout's `SkipLink`, which points at `#main`; `main` is focusable so
 * that jump lands the keyboard on the page body. No second skip link is rendered here.
 */
export default function V34Page({ route, surface = "paper", children }: {
  route: V34RouteKey;
  /** The surface the page body sits on before any band paints its own. */
  surface?: V34Surface;
  children: ReactNode;
}) {
  return (
    <div className={tokens.site} data-v34-site="">
      <SiteHeader currentPath={v34Route(route).path} />
      <main id="main" tabIndex={-1} className={`${surfaceClass(surface)} ${s.main}`}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
