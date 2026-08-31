import type { Metadata } from "next";

/**
 * /pricing is a client component (it drives Paddle checkout), so it cannot export metadata
 * itself. Without this layout the route inherited the root canonical ("/") and told crawlers
 * the pricing page was the homepage — the same defect every other route had.
 */
export const metadata: Metadata = {
  title: "Pricing — TAVONEL",
  description: "Plans and measured compute for the TAVONEL Knowledge Compiler. Hard spend limits.",
  alternates: { canonical: "/pricing" },
  openGraph: { url: "/pricing" },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
