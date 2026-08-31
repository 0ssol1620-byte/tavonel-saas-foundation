import type { Metadata } from "next";

/**
 * The page itself is a client component and cannot export metadata, so the title lives here.
 * All three surfaces used to share one title, which made a workspace tab and a marketing tab
 * indistinguishable in a browser with both open.
 */
export const metadata: Metadata = {
  alternates: { canonical: "/login" },
  // Not a marketing page: an authenticated or transient surface must not be
  // indexed, and must not compete with a public page for the same canonical.
  robots: { index: false, follow: false },
  title: "Sign in — TAVONEL",
  description: "Open your private, tenant-scoped TAVONEL workspace.",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
