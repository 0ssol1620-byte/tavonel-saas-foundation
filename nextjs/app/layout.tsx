import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Geist, IBM_Plex_Mono, Instrument_Serif } from "next/font/google";
import MarketingConsent from "@/components/marketing-consent";
import SkipLink from "@/components/skip-link";
import { BRAND_LINE } from "@/lib/site-navigation";
import { jsonLdHtml } from "@/lib/structured-data";
import "./globals.css";
import "./one-path.css";
import "./chrome-v2.css";
import "./landing-v2.css";

/**
 * The three faces, landing V2 blueprint §6 / lane D3.
 *
 * All three come through `next/font/google`, which downloads the files at build time and serves
 * them from this origin. Nothing here contacts fonts.googleapis.com at runtime — the CSP is
 * `font-src 'self' data:` and a `<link>` to a font host would simply fail.
 *
 * Geist is the text and display face. No `weight` is passed on purpose: Geist publishes a
 * variable file with a real 100–900 axis, and asking for three static cuts would download three
 * files where the axis is one. Wanted Sans Variable stays behind it in `--f-sans` (its
 * `@font-face` blocks are still in `tavonel.css`) as the fallback that carries Hangul for `/ko`.
 *
 * Instrument Serif is an editorial accent and appears on the landing only — one phrase of the H1
 * and the manifesto line. `preload: false` because of that: preloading a face that most routes
 * never render spends the first-paint budget on nothing. Italic ships with it because the
 * accent is set in italic.
 *
 * IBM Plex Mono is unchanged and carries the instrument voice — clocks, counts, state labels,
 * source locations.
 *
 * WHY `display: "optional"` ON THE TWO PRELOADED FACES (QA round 4, 2026-09-19).
 * D3 asked for `swap`. `swap` paints the page in the fallback face and then repaints it in the
 * real one, and a repaint that changes glyph widths changes line counts: QA measured /ko at CLS
 * 0.2351 (1024) and 0.3059 (768) — one shift at ~322ms in which the hero support sentence lost a
 * line and everything under it (the action row, the intake line, the whole demo) was pulled up
 * 30px. That is six times the contract's 0.05 budget and above the CI Lighthouse gate, and
 * reserving height does not fix it, because the box SHRINKS when the real face arrives.
 * `optional` removes the second paint: the face is preloaded and used when it is ready inside
 * the block period, and otherwise that one page view renders in the metric-adjusted fallback
 * `next/font` already generates. `tavonel.css` made the same choice for Wanted Sans for the same
 * reason. Contract rule 10 (CLS) outranks D3's spelling of this option.
 *
 * Instrument Serif keeps `swap`: it is `preload: false` by design, and an unpreloaded `optional`
 * face would effectively never paint — which is not a font setting but a deletion of the accent.
 * It sets two words of the English H1 only (/ko passes no accent phrase) and English measured
 * 0.043 / 0.035, inside the budget.
 */
const sans = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "optional",
});

const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
  preload: false,
});

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
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body>
        {/* The three font variables are on <html> so `--f-sans`, `--f-serif` and `--f-mono` in
            tavonel.css resolve everywhere, including in a portal rendered outside <body>. */}
        {/*
          A6 -- the first thing in the tab order, on every page.
          The header runs a wordmark, five section links and two actions before any page reaches
          its first sentence, and a keyboard or screen-reader visitor had to walk all of it every
          time. Visually hidden until focused, and then a real, visible control.
          (The mode badge, the four section links and the scene rail this comment used to name
          belonged to the client landing that Landing V2 replaced on 2026-09-19.)
        */}
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
