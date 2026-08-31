import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { IBM_Plex_Mono } from "next/font/google";
import RouteBoot from "@/components/route-boot";
import "./globals.css";

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
  title: "Knowledge Compiler for AI — TAVONEL",
  description:
    "Compile documents, scans, code and connected systems into source-grounded, AI-ready knowledge with structured relationships, provenance and reusable retrieval artifacts.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Your knowledge already exists. Compile it.",
    description:
      "TAVONEL compiles documents, scans, code and connected systems into a source-grounded world AI can reason about.",
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
            __html: JSON.stringify({
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
          contacted. It sets no cookie, which is why this page still has no consent banner to
          apologise for.

          Rendered only on Vercel. `/_vercel/insights/script.js` exists only on the deployment
          that serves it, so anywhere else -- a local `next start`, a preview harness, the e2e
          run -- the tag produced a 404 and a console error on every page load. A collector that
          cannot collect should not be on the page at all, and a console that is quiet by default
          is what makes the e2e error assertion worth anything.
        */}
        {process.env.VERCEL ? <Analytics /> : null}
      </body>
    </html>
  );
}
