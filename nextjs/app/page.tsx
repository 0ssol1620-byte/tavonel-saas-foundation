import type { Metadata } from "next";
import HomePageClient from "@/components/home-page-client";
import SolutionProofSample from "@/components/solution-proof-sample";
import { isLiveCommerce } from "@/lib/commercial-state";

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
export const metadata: Metadata = {
  title: "TAVONEL — Knowledge you can check",
  description: "Explore a published Compiled World. Open the source behind a result, inspect its evidence, and see how reviewed knowledge can be used in AI tools.",
  alternates: { canonical: "/", languages: { en: "/", ko: "/ko", "x-default": "/" } },
  openGraph: {
    title: "TAVONEL — Knowledge you can check",
    description: "Explore a published Compiled World. Open the source behind a result and inspect its evidence.",
    type: "website",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "TAVONEL — Knowledge you can check",
    description: "Explore a published Compiled World. Open the source behind a result and inspect its evidence.",
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
  return <HomePageClient liveCommerce={isLiveCommerce()} proof={<SolutionProofSample />} />;
}
