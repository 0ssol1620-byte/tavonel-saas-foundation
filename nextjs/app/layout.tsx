import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { IBM_Plex_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  metadataBase: new URL("https://tavonel-saas-foundation.vercel.app"),
  title: "TAVONEL — The Knowledge Compiler",
  description:
    "Watch scattered files become one current world. TAVONEL compiles sources into knowledge that stays current, and returns every answer to its evidence.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "TAVONEL — The Knowledge Compiler",
    description: "Watch scattered files become one current world.",
    type: "website",
    url: "/",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={mono.variable}>
      <body>
        {/* The statement is the LCP element and it is set in Wanted Sans, so the Latin subset is
            requested with the document rather than after the stylesheet resolves. React hoists
            this into <head>; writing a literal <head> here displaces the one Next.js builds and
            the stylesheet link goes with it. Only the [90] subset is preloaded — it is the one
            an English page actually uses. */}
        <link
          rel="preload"
          as="font"
          type="font/woff2"
          href="/fonts/WantedSansVariable.split.90.woff2"
          crossOrigin="anonymous"
        />
        {/*
          A6 -- the first thing in the tab order, on every page.
          The landing page opens with a nav, a mode badge, four section links and a scene rail
          before it reaches a sentence, and a keyboard or screen-reader visitor had to walk all
          of it on every page. Visually hidden until focused, and then a real, visible control.
        */}
        <a className="skip" href="#main">Skip to content</a>
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
