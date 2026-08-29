import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import "./globals.css";

/**
 * SPEC §6.11 keeps the existing TAVONEL stack and forbids introducing a new display face.
 * Wanted Sans is not vendored into this repository, so the stack in `tavonel.css` names it
 * first and falls through to these two self-hosted faces. Adding the licensed family later is
 * a font-file change, not a design change.
 */
const sans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "TAVONEL — The Knowledge Compiler",
  description:
    "Watch scattered files become one current world. TAVONEL compiles sources into knowledge that stays current, and returns every answer to its evidence.",
  openGraph: {
    title: "TAVONEL — The Knowledge Compiler",
    description: "Watch scattered files become one current world.",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
