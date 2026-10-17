import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import { preload } from "react-dom";
import FontOutlineProbe from "@/components/font-outline-probe";
import MarketingConsent from "@/components/marketing-consent";
import SkipLink from "@/components/skip-link";
import { BRAND_LINE } from "@/lib/site-navigation";
import { jsonLdHtml } from "@/lib/structured-data";
import "./globals.css";
import "./one-path.css";
import "./chrome-v2.css";
import "./landing-v2.css";
/*
  paper-product.css is not imported here. It styles three surfaces (Pricing, Explore, the
  evaluation page), and each imports it itself. From this layout it was a seventh render-blocking
  stylesheet on every route, Home included, which renders none of its classes: Lighthouse `/`
  render delay 23-37 ms -> 256-282 ms and LCP +80 ms locally, 3002-3172 ms in CI against the
  3000 ms budget (main 2815-2889 ms).
*/

/**
 * One text face: Wanted Sans Variable (decision.md G-B; UX-PLAN-2026-10-17 §4.4, lane UX-L3).
 *
 * Until UX-L3 this layout loaded Geist as the text and display face and Instrument Serif as a
 * landing accent, while most paper pages set `--f-sans` back to Wanted Sans on their own wrapper.
 * The routes that did not -- /knowledge-compiler, /reproducibility, /explore, /login -- rendered
 * Geist, so the site spoke in two faces, and no stylesheet used `--f-serif` at all. Both loads are
 * deleted, not replaced: `--f-sans` in tavonel.css is `--tv-font-sans`, and the faces are the
 * self-hosted OFL files under public/fonts (the @font-face blocks in tavonel.css and
 * wanted-sans-korean.css). No webfont host is contacted -- the CSP is `font-src 'self' data:`.
 *
 * WHY THE LATIN FILE IS PRELOADED ON EVERY ROUTE. Wanted Sans is declared `font-display:
 * optional`, because `swap` repainted /ko in the real face and QA round 4 (2026-09-19) measured
 * CLS 0.2351 at 1024 and 0.3059 at 768. An optional face that nobody preloads seldom arrives
 * inside the block period, and then the whole page view paints in the system fallback. Geist did
 * not have that problem because next/font preloaded it; Wanted Sans [90] (basic Latin, 44,356
 * bytes) takes over that preload. Home already hinted the same file, and React dedupes a preload
 * by href. [89] (Latin Extended) and the Hangul ranges stay on demand; /ko preloads its own four.
 *
 * IBM Plex Mono is unchanged: coordinates, digests, IDs, file names and code (UX-PLAN §5.3 R10).
 * `display: "optional"` for the same CLS reason.
 */
const WANTED_SANS_LATIN = "/fonts/WantedSansVariable.split.90.woff2";

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "optional",
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
  icons: {
    icon: [
      { url: "/brand/locus-v2.svg", type: "image/svg+xml", sizes: "any" },
      { url: "/brand/locus-v2-32.png", type: "image/png", sizes: "32x32" },
    ],
    shortcut: "/brand/locus-v2.ico",
  },
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
    /* D8 / BQ-061: one positioning line. This used to be a sixth sentence of its own. */
    title: BRAND_LINE.headline,
    description: BRAND_LINE.descriptor,
    type: "website",
    url: "/",
  },
};

/*
  BQ-062. The browser chrome, told which world it is in.

  `color-scheme: dark` in `tavonel.css` already handles scrollbars and form controls; this is the
  other half -- the address bar, the task-switcher card and the installed window title bar, which
  read `theme-color` and not CSS. Without it a near-black page sat inside a white shell on every
  Android and installed surface.
*/
export const viewport: Viewport = {
  themeColor: "#090D14",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  preload(WANTED_SANS_LATIN, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  return (
    <html lang="en" className={mono.variable}>
      <body>
        {/* The mono variable is on <html> so `--f-mono` in tavonel.css resolves everywhere,
            including in a portal rendered outside <body>. */}
        {/*
          A6 -- the first thing in the tab order, on every page.
          The header runs a wordmark, five section links and two actions before any page reaches
          its first sentence, and a keyboard or screen-reader visitor had to walk all of it every
          time. Visually hidden until focused, and then a real, visible control.
          (The mode badge, the four section links and the scene rail this comment used to name
          belonged to the client landing that Landing V2 replaced on 2026-09-19.)
        */}
        <FontOutlineProbe />
        <SkipLink />
        {/*
          Organization + WebSite + SoftwareApplication. No availability, offer, or
          aggregateRating — this deployment is a private pilot, not a GA claim.

          G1-031 asked for `WebSite`, and it is the one addition this graph can make honestly: it
          says the site has a name and an address, which the address bar already said. The three
          nodes are `@id`-linked so a consumer reads one entity with three facets rather than
          three unrelated things that share a URL — the site's publisher is the organization, and
          the software is what the organization makes.

          Deliberately absent, each for its own reason rather than by omission:

          - **`potentialAction` / `SearchAction` on the WebSite.** It declares a URL template a
            search engine may send a query to, and this site has no such URL: the documentation
            search is a client-side filter over already-rendered sections and puts no query in the
            address. Declaring one advertises an endpoint that answers nothing.
          - **`FAQPage`.** G1-031 asked for it too. No page here is written as questions and
            answers — `/trust` comes closest and is a table of where each answer lives — and
            marking prose up as an FAQ to win a SERP feature is the structured-data form of a
            claim with no source. When `/pricing` gains real FAQ copy, the markup belongs beside
            it in `lib/structured-data.ts`.
          - **A rating, a price or a review.** Nothing to cite. Unchanged, and the schema names
            are deliberately not written here: `lib/structured-data.test.ts` bans them as raw
            source across every JSON-LD emitter, which is exactly the guard that should refuse a
            comment talking itself into one.
        */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdHtml({
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "Organization",
                  "@id": "https://tavonel.com/#organization",
                  name: "TAVONEL",
                  url: "https://tavonel.com",
                  description:
                    "Compile documents, scans and connected systems into source-grounded knowledge.",
                },
                {
                  "@type": "WebSite",
                  "@id": "https://tavonel.com/#website",
                  name: "TAVONEL",
                  url: "https://tavonel.com",
                  inLanguage: "en",
                  publisher: { "@id": "https://tavonel.com/#organization" },
                },
                {
                  "@type": "SoftwareApplication",
                  "@id": "https://tavonel.com/#software",
                  name: "TAVONEL",
                  url: "https://tavonel.com",
                  applicationCategory: "Knowledge Compiler",
                  description:
                    "Compile documents, scans and connected systems into source-grounded knowledge.",
                  publisher: { "@id": "https://tavonel.com/#organization" },
                },
              ],
            }),
          }}
        />
        {/*
          BQ-057. `RouteBoot` is gone, and with it the "● ROUTING → /pricing" stamp it flashed in
          the corner on every navigation. It gated nothing and reported nothing -- a monospace
          readout of a fact the address bar had already shown -- which is the fake-terminal tell
          §16 of the handoff bars outright. `.route-boot` in `app/tavonel.css` is now dead and is
          L1's to delete.
        */}
        {/*
          The optional analytics choice is a document-flow notice above the public shell. Keeping
          it before page chrome gives the notice real space instead of placing it over the hero,
          pricing actions or mobile safe area. After a choice, the standing footer control remains
          the withdrawal path.

          P2-07: the Vercel collector is no longer mounted here. `MarketingConsent` loads it on
          demand, behind the flag and the same consent and public-path gate as the Google tag,
          because a collector mounted at the root loads before any choice and on the workspace
          (ANALYTICS-ACTIVATION-2026-10-17 §3).
        */}
        <MarketingConsent />
        {children}
      </body>
    </html>
  );
}
