import type { Metadata } from "next";
import { cookies } from "next/headers";
import { preload } from "react-dom";
import { HERO_FILM_POSTER } from "@/components/landing-v2/hero-film";
import LandingPage from "@/components/landing-v2/landing-page";
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
    FOUNDER DECISION 2026-09-20: the LCP resource is the hero film's poster again.

    The centered hero paints one image above the fold -- `poster-1-hero-2x.webp`, the first frame
    of cut 1 at the size the frame paints it. `CompileStagePlayer` renders that poster on the
    server and swaps in the decoder only after the film is in view, so the poster is what the LCP
    measurement actually sees whether or not the video ever plays. It carries
    `fetchPriority="high"` there (`priorityPoster`), and this is the preload that matches it.

    §27 bars an autoplay VIDEO from being the LCP element, and it still is not one: the element
    that paints is an <img>. The film starts after it, on intersection.

    No `imageSrcSet`/`imageSizes`: the poster is one locked file at one size, so a candidate list
    would be a list of one and `sizes` would describe a choice the browser does not have.

    IT IS `react-dom`'s `preload()` AND NOT A <link> ELEMENT, WHICH REVERSES A CONTRACT RULE (F10).

    Contract rule 10 says "a real <link> element, not react-dom preload()", and it says so
    because audit MED-15 measured the helper never reaching the shipped HTML on the OLD landing
    (fixture build 2026-09-18, where the document's only rel=preload was a low-priority script).
    That page was a client component; this one is a server component, and React 19 flushes the
    resource into the head as a real <link rel="preload"> in the served document. That is
    verified rather than assumed: `e2e/landing-v2.spec.ts` counts it in the document the server
    sends, not in the DOM after hydration.

    What the element form could not do is be ONE preload. React hoists a <link rel="preload">
    into the head as a resource and ALSO renders the element where it sits in the tree, so the
    document carried two entries for one file (P3 QA round 2, P2-2) -- with `href` and, measured
    on this build rather than assumed, without it too. The helper emits the hoisted one alone.
  */
  preload(HERO_FILM_POSTER, { as: "image", fetchPriority: "high" });
  return (
    <>
      <LandingPage experiment={experiment} />
    </>
  );
}
