import type { Metadata } from "next";

/**
 * Internal render harnesses. Never indexed, never linked from a public surface.
 *
 * These routes exist so a canvas component can be inspected and screenshotted without an
 * account. They render fixture-shaped props through production builders, so they are useful
 * for QA and worthless to a search engine — and a marketing page must never have to compete
 * with one.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function DevLayout({ children }: { children: React.ReactNode }) {
  return children;
}
