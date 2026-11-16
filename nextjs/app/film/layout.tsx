import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { heldVisible } from "@/lib/v34/release";

export const metadata: Metadata = {
  robots: { index: false, follow: true },
  alternates: { canonical: "/" },
};

export const dynamic = "force-dynamic";

/* The same fail-closed rule as releaseGate: only a preview deployment or V34_SHOW_HELD=1 renders /film. */
export default function FilmLayout({ children }: { children: React.ReactNode }) {
  if (!heldVisible()) notFound();
  return children;
}
