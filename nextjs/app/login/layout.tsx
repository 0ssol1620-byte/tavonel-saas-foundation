import type { Metadata } from "next";

/**
 * The page itself is a client component and cannot export metadata, so the title lives here.
 * All three surfaces used to share one title, which made a workspace tab and a marketing tab
 * indistinguishable in a browser with both open.
 */
export const metadata: Metadata = {
  title: "Sign in — TAVONEL",
  description: "Open your private, tenant-scoped TAVONEL workspace.",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
