import type { Metadata } from "next";
import { cookies } from "next/headers";
import LandingPage, { HERO_IMAGE_SIZES, heroScene } from "@/components/landing-v2/landing-page";
import { LANDING_VARIANT_COOKIE, LANDING_VARIANT_QUERY, landingVariantState } from "@/lib/landing-experiments";
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

/*
  D8: the experiment arm, read on the server and never on the client.

  This page is already `force-dynamic` for the commercial posture, so reading a cookie costs it
  nothing it was not already paying, and it is what keeps the arm out of the first paint's
  critical path: a client that decided the headline after hydration would flash the control arm
  at every reader in the test. The cookie is WRITTEN in `middleware.ts`, which is the one place
  in Next 15 that can set one for the response a Server Component is rendering.

  With no experiment active this reads a cookie that is never set and returns the frozen default.
*/
export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = (await searchParams)?.[LANDING_VARIANT_QUERY];
  const experiment = landingVariantState({
    cookie: (await cookies()).get(LANDING_VARIANT_COOKIE)?.value,
    query: Array.isArray(query) ? query[0] : query,
  });
  /*
    Landing V2, 2026-09-19 (§27, contract rule 10). The LCP resource is the hero's READ strip.

    It moved from the whole-page render to the region crop with the hero recomposition: the strip
    is now the first and largest image on the page and the page render is a 200px thumbnail
    beside it, so preloading the page would be preloading the smaller, later resource. One image
    carries `fetchPriority="high"`, and it is this one.

    It replaces the film poster, because this landing plays no video at all -- §27 bars an
    autoplay video from being the LCP element, and §28 puts the hero in DOM and CSS. What is
    preloaded is the exact resource the layout paints: the same `srcset` and the same `sizes`
    the <img> carries, both from one constant, so the browser's candidate selection here and in
    the element cannot disagree.

    Still a real <link> element rather than react-dom's `preload()`: audit MED-15 measured that
    the helper never reached the shipped HTML on this route (fixture build 2026-09-18, where the
    document's only rel=preload was a low-priority script).
  */
  const hero = heroScene();
  return (
    <>
      <link
        rel="preload"
        as="image"
        href={hero.region.cropSrc}
        imageSrcSet={hero.region.cropSrcSet}
        imageSizes={HERO_IMAGE_SIZES}
        fetchPriority="high"
      />
      <LandingPage experiment={experiment} />
    </>
  );
}
