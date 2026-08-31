import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Trust Center | TAVONEL",
  description: "Live deployment controls, claim vocabulary, data handling records, and operational evidence.",
  alternates: { canonical: "/trust" },
  openGraph: { url: "/trust" },
};

export default function TrustLayout({ children }: { children: ReactNode }) {
  return children;
}