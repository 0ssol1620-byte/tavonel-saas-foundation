import type { Metadata } from "next";
import { CAPABILITY_MANIFEST, describeAcceptedFormats } from "../../shared/capabilityManifest";
import HomePageClient from "@/components/home-page-client";
import { isLiveCommerce } from "@/lib/commercial-state";
import { BRAND_LINE } from "@/lib/site-navigation";

/**
 * The English entry point, and one half of the site's only hreflang pair.
 *
 * `/` and `/ko` are each the site's entry point in their own language, so each names the other and
 * `x-default` is the English one, which has the whole site behind it. The pair lives here rather
 * than on the root layout because layout metadata is inherited by every page that declares no
 * `alternates`, which put the annotation on seven retired-URL stubs -- see the comment in
 * `app/layout.tsx`. `canonical` is restated because declaring `alternates` replaces the inherited
 * object rather than merging into it.
 */
/*
  D26 / BQ-134. One tab-title pattern, and this page is its one named exception.

  Every other page on the site is "X — TAVONEL", which reads correctly when the section is the
  thing being named. The home tab has no section to name, so it names the product and what the
  product is -- and both halves come from `BRAND_LINE`, the constant the footer tagline, the OG
  card and the root metadata description already derive from, rather than from a fifth and sixth
  positioning sentence typed here.
*/
export const metadata: Metadata = {
  title: `TAVONEL — ${BRAND_LINE.descriptor}`,
  description: "TAVONEL is the Knowledge Compiler for AI: every compiled result keeps a traceable path back to the page it was read from. A public Compiled World is open to read in full today.",
  alternates: { canonical: "/", languages: { en: "/", ko: "/ko", "x-default": "/" } },
  openGraph: {
    title: BRAND_LINE.headline,
    description: BRAND_LINE.descriptor,
    type: "website",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: BRAND_LINE.headline,
    description: BRAND_LINE.descriptor,
  },
};

/**
 * The landing CTA is commercial state, not static content.
 *
 * Vercel can qualify a Production build in an environment where the build-time commercial flags
 * are intentionally scrubbed while the deployed runtime is live. If this route is prerendered,
 * that safe build-time "pilot" result gets frozen into the HTML and a live self-service site can
 * keep saying "Request access" even while /api/status correctly reports selfService=true.
 *
 * Resolve the state on each request instead. The page itself is light, the deployed function is in
 * the same region as the rest of the app, and this avoids a wrong CTA or a hydration-time label
 * swap on the most important conversion surface.
 */
export const dynamic = "force-dynamic";

export default function HomePage() {
  // The hero poster is the homepage LCP resource. It is declared as a real <link> element, which
  // React hoists into <head>, because `preload()` from react-dom never reached the shipped HTML
  // here (audit MED-15, verified on the fixture build 2026-09-18: the only rel=preload in the
  // document was a low-priority script). The poster is the re-rendered master's own frame at
  // the size the hero paints it.
  return (
    <>
      <link rel="preload" as="image" href="/film/poster-1-hero-2x.webp" fetchPriority="high" />
      <HomePageClient liveCommerce={isLiveCommerce()} formats={describeAcceptedFormats(CAPABILITY_MANIFEST)} />
    </>
  );
}
