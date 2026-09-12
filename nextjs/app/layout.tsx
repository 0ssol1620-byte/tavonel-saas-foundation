import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { IBM_Plex_Mono } from "next/font/google";
import RouteBoot from "@/components/route-boot";
import MarketingConsent from "@/components/marketing-consent";
import { jsonLdHtml } from "@/lib/structured-data";
import "./globals.css";
import "./evidence-first.css";

/**
 * SPEC §6.11 — Wanted Sans is the display and text face. It is self-hosted from
 * `public/fonts` (see the @font-face block at the top of `tavonel.css`), so no
 * webfont host is contacted for it. Only the monospace utility face is fetched
 * from Google; it carries the instrument voice — clocks, counts, state labels.
 */
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

/**
 * Category title. The document-change question is a campaign line, not the product name.
 * robots.ts still disallows the index for the private pilot.
 */
export const metadata: Metadata = {
  /*
    D6 -- the site has a domain, so it has one name.
    Until this line changed, every canonical link, every og:url and the OG image itself named
    tavonel-saas-foundation.vercel.app while the site answered on tavonel.com. That is one
    product living at two hostnames: a shared link previews from the wrong origin, and the page
    tells a crawler to prefer an address nobody was given. The apex is the canonical one --
    www.tavonel.com already 308s to it.
  */
  metadataBase: new URL("https://tavonel.com"),
  verification: {
    other: { "naver-site-verification": "8543297cf37328d0919d31e4d3d618beecc532de" },
  },
  title: "Knowledge Compiler for AI — TAVONEL",
  /*
    "code" came off both descriptions with the RESOLVED A-2 hero.

    No reader in this deployment reads a repository: the manifest on /sources lists eleven
    document and image MIME types and the upload route refuses everything else, so a search
    result promising compiled code advertised a source family that is rejected at intake.
  */
  description:
    "Compile the documents, scans and connected systems you already have into a current, traceable world your AI can use, with structured relationships, provenance and reusable retrieval artifacts.",
  alternates: {
    canonical: "/",
    /*
      §12.4's hreflang pair is **not** here, and that is the point of this comment.

      It was, for one commit: the reverse half of the pair `/ko` declares (seo-i18n CROSS-LANE 1)
      was added to this layout, and metadata declared on a layout is inherited by every page that
      declares no `alternates` of its own. In the built output that was `/ko` plus `_not-found`,
      `/customers`, `/film-2`, `/film-3`, `/film-4`, `/product/knowledge-compiler` and
      `/research/experiments` -- seven 404 stubs and a permanent redirect, each telling a crawler
      it had a Korean counterpart. Harmless while they 404, and exactly the kind of annotation
      that stops being harmless the day one of those paths becomes a real page.

      So the pair lives on the two pages that have a counterpart: `app/page.tsx` and
      `app/ko/page.tsx`, each naming the other. `canonical` stays here as the safety net it has
      always been -- every advertised page declares its own, which
      `lib/route-canonical-metadata.test.ts` enforces -- and `lib/seo-surface.test.ts` now fails
      if `languages` returns to this file or appears on a noindex page.
    */
  },
  openGraph: {
    title: "Your knowledge already exists. Compile it.",
    description:
      "TAVONEL compiles your own sources into a current, traceable world your AI can use.",
    type: "website",
    url: "/",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={mono.variable}>
      <body>
        {/* Wanted Sans is font-display: optional. Constrained clients keep the system fallback
            instead of competing with the verified hero proof frame for initial bandwidth. */}
        {/*
          A6 -- the first thing in the tab order, on every page.
          The landing page opens with a nav, a mode badge, four section links and a scene rail
          before it reaches a sentence, and a keyboard or screen-reader visitor had to walk all
          of it on every page. Visually hidden until focused, and then a real, visible control.
        */}
        <a className="skip" href="#main">Skip to content</a>
        {/*
          Organization + SoftwareApplication only. No availability, offer, or
          aggregateRating — this deployment is a private pilot, not a GA claim.
        */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdHtml({
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "Organization",
                  name: "TAVONEL",
                  url: "https://tavonel.com",
                  description:
                    "Compile documents, scans, code and connected systems into source-grounded knowledge.",
                },
                {
                  "@type": "SoftwareApplication",
                  name: "TAVONEL",
                  url: "https://tavonel.com",
                  applicationCategory: "Knowledge Compiler",
                  description:
                    "Compile documents, scans, code and connected systems into source-grounded knowledge.",
                },
              ],
            }),
          }}
        />
        <RouteBoot />
        {children}
        {/*
          Measurement, on the same terms as everything else here.

          Nothing in this product could be judged before this: the page argues for a sequence of
          scenes and nobody knew how far down anyone got. It is Vercel's own analytics for
          one specific reason -- it loads from `/_vercel/insights` on this origin, so the strict
          CSP above admits it without a single directive being widened, and no third party is
          contacted by that collector. It sets no cookie. The separate Google Analytics
          integration below requires an explicit visitor choice before loading.

          Analytics is fail-closed. Vercel exposes observability build variables even when Web
          Analytics is not enabled for the project; rendering the component in that state points
          the browser at a deployment-specific 404. The explicit public flag is set only after the
          collector is enabled and verified, so local, preview and unconfigured production builds
          stay quiet and do not imply that measurement is active.
        */}
        {process.env.NEXT_PUBLIC_TAVONEL_ANALYTICS_ENABLED === "1" ? <Analytics /> : null}
        <MarketingConsent />
      </body>
    </html>
  );
}
