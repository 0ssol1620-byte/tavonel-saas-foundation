import type { Metadata } from "next";

export const metadata: Metadata = {
  alternates: { canonical: "/auth/callback" },
  // Not a marketing page: an authenticated or transient surface must not be
  // indexed, and must not compete with a public page for the same canonical.
  robots: { index: false, follow: false }, title: "Signing in — TAVONEL" };

export default function AuthCallbackLayout({ children }: { children: React.ReactNode }) {
  return children;
}
