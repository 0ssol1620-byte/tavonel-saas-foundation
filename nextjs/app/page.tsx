import type { Metadata } from "next";
import { cookies } from "next/headers";
import { preload } from "react-dom";
import { HERO_PROOF_IMAGE } from "@/components/landing-v2/hero-proof";
import LandingPage from "@/components/landing-v2/landing-page";
import {
  LANDING_VARIANT_COOKIE,
  LANDING_VARIANT_QUERY,
  landingVariantState,
} from "@/lib/landing-experiments";
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
  description:
    "Inspect a finished public Compiled World, follow one result to its exact source region, compare what changed, and review accepted sources and deployment boundaries before discussing your own sources.",
  alternates: {
    canonical: "/",
    languages: { en: "/", ko: "/ko", "x-default": "/" },
  },
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
    The one image above the fold, preloaded.

    This named the film poster while the film was the hero. Gap #1 moved the film into Scene 02,
    so the poster is now below the fold and the hero's own raster -- the sample World page the
    Evidence Inspector draws its regions on -- is what the first paint is waiting for. Preloading
    a below-fold video poster at high priority while the LCP element waits is the regression this
    line exists to avoid, not one to keep. `HERO_PROOF_IMAGE` is null only when the sample World
    publishes no render for its chosen page, in which case there is no raster to preload.
  */
  if (HERO_PROOF_IMAGE) preload(HERO_PROOF_IMAGE, { as: "image", fetchPriority: "high" });
  return (
    <>
      <LandingPage experiment={experiment} />
    </>
  );
}
