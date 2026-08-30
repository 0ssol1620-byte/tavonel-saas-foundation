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
        {children}
        {/*
          Measurement, on the same terms as everything else here.

          Nothing in this product could be judged before this: the page argues for a sequence of
          eight scenes and nobody knew how far down anyone got. It is Vercel's own analytics for
          one specific reason -- it loads from `/_vercel/insights` on this origin, so the strict
          CSP above admits it without a single directive being widened, and no third party is
          contacted. It sets no cookie, which is why this page still has no consent banner to
          apologise for.
        */}
        <Analytics />
      </body>
    </html>
  );
}
