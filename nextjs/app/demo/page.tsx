import type { Metadata } from "next";
import SignedProductDemo from "@/components/signed-product-demo";
import { PublicSitePage } from "@/components/public-site-chrome";
import { signedProductDemo } from "@/lib/signed-product-demo";

export const metadata: Metadata = {
  title: "Signed product path — TAVONEL",
  description:
    "See a compile end to end: a source changes, a person reviews it, and the answer that follows opens at the page it came from.",
  alternates: { canonical: "/demo" },
  openGraph: { url: "/demo" },
};

export default function DemoPage() {
  return (
    <PublicSitePage>
      <SignedProductDemo demo={signedProductDemo} />
    </PublicSitePage>
  );
}
