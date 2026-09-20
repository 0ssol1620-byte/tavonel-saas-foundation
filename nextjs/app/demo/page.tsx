import type { Metadata } from "next";
import SignedProductDemo from "@/components/signed-product-demo";
import { PublicSitePage } from "@/components/public-site-chrome";
import { signedProductDemo } from "@/lib/signed-product-demo";

export const metadata: Metadata = {
  title: "Signed product path — TAVONEL",
  description:
    "A deterministic synthetic source-to-change-to-review-to-activation-to-answer-to-signed-export product demonstration.",
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
